import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchCommand } from '../runner/donegate.mjs';
import { buildBrowserOpenCommand } from '../runner/core/dashboard.mjs';
import { buildSanitizedEnv } from '../runner/core/isolation.mjs';
import { resolveSafeWorkspaceFolders, startAtlasHttpServer } from '../runner/atlas/serve-atlas.mjs';
import { checkWriteScopeMandate, collectGitDiffStats, getRunEventHub } from '../runner/dsh/workflow-runner.mjs';
import { buildWinBatchSpawn } from '../skill/adapters/_shared.mjs';
import { computeProjectStatus } from '../runner/core/state-calc.mjs';
import { countEffectiveCodeLines } from '../skill/check-commit-hygiene.mjs';
import { auditHtmlAntiAiSlop, recommendAestheticProposals } from '../runner/dsh/ui-aesthetics.mjs';
import { buildPreCommitScript, resolveSkillPrefix } from '../skill/install-hooks.mjs';

describe('DoneGate 0.4.0 复核包、全流程进度卡、完结门工作台与跨盘符钩子', () => {
  it('verify pack 多契约同批提交不误报越界、保留跨 scope 源码 diff、且拒绝空提交伪造 diff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-vitest5-'));
    try {
      dispatchCommand(['init', '.'], dir);
      writeFileSync(join(dir, '.gitignore'), '.donegate/\n');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/a.mjs'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'src/b.mjs'), 'export const b = 1;\n');
      dispatchCommand(['contract', 'new', 'ca', '--title', 'A', '--scope', 'src/a.mjs'], dir);
      dispatchCommand(['contract', 'new', 'cb', '--title', 'B', '--scope', 'src/b.mjs'], dir);
      for (const id of ['ca', 'cb']) {
        const p = join(dir, `contracts/${id}/contract.json`);
        const c = JSON.parse(readFileSync(p, 'utf8'));
        c.why = 'test';
        c.obligations = [{
          id: 'o1', kind: 'command', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 },
          required: true, claim: 'ok', observable: 'exit 0', scope: `src/${id[1]}.mjs`, inputClasses: ['正常'], servesSuccessCriterion: 's'
        }];
        writeFileSync(p, JSON.stringify(c, null, 2));
      }
      spawnSync('git', ['-C', dir, 'init', '-q']);
      spawnSync('git', ['-C', dir, 'config', 'user.email', 't@local']);
      spawnSync('git', ['-C', dir, 'config', 'user.name', 'T']);
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
      dispatchCommand(['contract', 'freeze', 'ca', '--by', '业主'], dir);
      dispatchCommand(['contract', 'freeze', 'cb', '--by', '业主'], dir);
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'freeze both']);

      writeFileSync(join(dir, 'src/a.mjs'), 'export const a = 2;\n');
      writeFileSync(join(dir, 'src/b.mjs'), 'export const b = 2;\n');
      writeFileSync(join(dir, 'src/extra.mjs'), 'export const ex = 1;\n');
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'impl both']);

      expect(dispatchCommand(['check', 'ca'], dir).exitCode).toBe(0);
      const pk = dispatchCommand(['verify', 'pack', 'ca'], dir);
      expect(pk.exitCode).toBe(0);
      const diffBody = readFileSync(join(pk.packDir, 'diff/ca.diff'), 'utf8');
      expect(diffBody).toContain('src/a.mjs');
      expect(diffBody).toContain('src/extra.mjs');
      expect(diffBody).not.toContain('contracts/cb/');

      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'empty']);
      const pkEmpty = dispatchCommand(['verify', 'pack', 'ca', '--base', 'HEAD~1', '--head', 'HEAD'], dir);
      expect(pkEmpty.exitCode).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('全流程命令机械触发分阶段缩进进度卡：动态读取项目模块名、实时递增且脏运行不虚涨', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-vitest6-'));
    const grabPct = (txt) => {
      const m = String(txt || '').match(/DoneGate · 验收进度\s+[█░]{10}\s+(\d+)%/);
      return m ? Number(m[1]) : null;
    };
    try {
      const rInit = dispatchCommand(['init', '.'], dir);
      expect(rInit.exitCode).toBe(0);
      expect(rInit.stdout).toContain('#### 📊 DoneGate · 验收进度');
      expect(rInit.stdout).toContain('  1-1 ✅');
      const pInit = grabPct(rInit.stdout);
      expect(pInit).toBe(5);

      mkdirSync(join(dir, 'app'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), '.donegate/\n');
      writeFileSync(join(dir, 'app/auth.mjs'), 'export const login = (u) => Boolean(u);\n');

      const rNew = dispatchCommand(['contract', 'new', 'auth-mod', '--title', '安卓登录鉴权', '--scope', 'app/auth.mjs'], dir);
      expect(rNew.exitCode).toBe(0);
      expect(rNew.stdout).toContain('  2-1 ⏳ 安卓登录鉴权');
      const pNew = grabPct(rNew.stdout);
      expect(pNew).toBe(10);

      const cPath = join(dir, 'contracts/auth-mod/contract.json');
      const c = JSON.parse(readFileSync(cPath, 'utf8'));
      c.why = '用户登录';
      c.obligations = [{
        id: 'login-ok', kind: 'command', command: 'node -e "import(\'./app/auth.mjs\').then(m=>process.exit(m.login(\'a\')?0:1))"',
        expect: { exitCode: 0 }, required: true, claim: '合法账号登录返回 true', observable: 'exit 0',
        scope: 'app/auth.mjs', inputClasses: ['正常'], servesSuccessCriterion: 's',
        breakPatch: { file: 'app/auth.mjs', from: 'Boolean(u)', to: 'false' }
      }];
      writeFileSync(cPath, JSON.stringify(c, null, 2));

      spawnSync('git', ['-C', dir, 'init', '-q']);
      spawnSync('git', ['-C', dir, 'config', 'user.email', 't@local']);
      spawnSync('git', ['-C', dir, 'config', 'user.name', 'T']);
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

      const rFreeze = dispatchCommand(['contract', 'freeze', 'auth-mod', '--by', '业主'], dir);
      expect(rFreeze.exitCode).toBe(0);
      expect(rFreeze.stdout).toContain('🔒 「安卓登录鉴权」1 项验收标准已锁定');
      const pFreeze = grabPct(rFreeze.stdout);
      expect(pFreeze).toBeGreaterThan(pNew);

      writeFileSync(join(dir, 'app/dirty.txt'), 'uncommitted');
      const rDirty = dispatchCommand(['check', '--allow-dirty', 'auth-mod'], dir);
      expect(rDirty.stdout).toContain('⚠️ 脏工作区调试运行');
      expect(grabPct(rDirty.stdout)).toBe(pFreeze);
      rmSync(join(dir, 'app/dirty.txt'));

      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'freeze']);

      const rCheck = dispatchCommand(['check', 'auth-mod'], dir);
      expect(rCheck.exitCode).toBe(0);
      expect(rCheck.stdout).toContain('✅ 「安卓登录鉴权」1/1 项检查通过');
      const pCheck = grabPct(rCheck.stdout);
      expect(pCheck).toBeGreaterThan(pFreeze);

      const rTeeth = dispatchCommand(['teeth', 'auth-mod', 'login-ok'], dir);
      expect(rTeeth.exitCode).toBe(0);
      expect(rTeeth.stdout).toContain('✅ [3-1]');
      const pTeeth = grabPct(rTeeth.stdout);
      expect(pTeeth).toBeGreaterThan(pCheck);

      const rHo = dispatchCommand(['handover'], dir);
      expect(rHo.exitCode).toBe(0);
      expect(rHo.stdout).toContain('✅ [4-2] 交接包 HANDOVER.md 已生成');
      expect(grabPct(rHo.stdout)).toBeGreaterThan(pTeeth);

      writeFileSync(join(dir, 'app/temp.txt'), 'dirty');
      const rWarn3 = dispatchCommand(['check', 'auth-mod'], dir);
      expect(rWarn3.exitCode).toBe(3);
      expect(rWarn3.stderr).toContain('⚠️ DoneGate · 进度受阻（阻断提醒');
      rmSync(join(dir, 'app/temp.txt'));

      const beforeNotePct = grabPct(dispatchCommand(['status'], dir).stdout);
      const noteCli = join(process.cwd(), 'skill/progress-note.mjs');
      const rEmptyGood = spawnSync(process.execPath, [noteCli, '--kind', 'good', '--stage', '2', '--title', '已完成真机实测', '--root', dir], { encoding: 'utf8' });
      expect(rEmptyGood.status).toBe(1);
      const rFailGood = spawnSync(process.execPath, [noteCli, '--kind', 'good', '--stage', '2', '--title', '已完成真机实测', '--verify-cmd', 'node -e "process.exit(1)"', '--root', dir], { encoding: 'utf8' });
      expect(rFailGood.status).toBe(1);
      const rSpoofGood = spawnSync(process.execPath, [noteCli, '--kind', 'worry', '--stage', '2', '--title', '总进度 100% 全部通关', '--root', dir], { encoding: 'utf8' });
      expect(rSpoofGood.status).toBe(2);

      const rGoodNote = spawnSync(process.execPath, [noteCli, '--kind', 'good', '--stage', '2', '--title', '已完成华为机型真机冷启动实测', '--verify-cmd', 'node -e "process.exit(0)"', '--root', dir], { encoding: 'utf8' });
      expect(rGoodNote.status).toBe(0);
      expect(rGoodNote.stdout).toContain('  2-💬 ✅ [补充·已验真] 已完成华为机型真机冷启动实测');
      const rWorryNote = spawnSync(process.execPath, [noteCli, '--kind', 'worry', '--stage', '3', '--title', '弱网 3G 下登录超时待优化', '--root', dir], { encoding: 'utf8' });
      expect(rWorryNote.status).toBe(0);
      expect(rWorryNote.stdout).toContain('  3-💬 ⚠️ [报忧] 弱网 3G 下登录超时待优化');
      expect(grabPct(rWorryNote.stdout)).toBe(beforeNotePct);

      const rVerifyNotes = spawnSync(process.execPath, [noteCli, '--verify-all', '--rerun', '--root', dir], { encoding: 'utf8' });
      expect(rVerifyNotes.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('超大项目（>6 模块）自动折叠聊天进度、输出完结门工作台离线看板且 handover 吐出高熵注入块', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-vitest7-'));
    try {
      dispatchCommand(['init', '.'], dir);
      for (let i = 1; i <= 8; i++) {
        dispatchCommand(['contract', 'new', `mod-${i}`, '--title', `核心业务模块 ${i}`], dir);
      }
      const st = dispatchCommand(['status'], dir);
      expect(st.exitCode).toBe(0);
      expect(st.stdout).toContain('已自动折叠');
      expect(st.stdout).toContain('.donegate/dashboard.html');
      const dashHtml = readFileSync(join(dir, '.donegate', 'dashboard.html'), 'utf8');
      expect(dashHtml).toContain('完结门工作台');
      expect(dashHtml).toContain('let ATLAS =');
      expect(dashHtml).toContain('flyCanvasToNode');
      expect(dashHtml).toContain('核心业务模块 8');

      const ho = dispatchCommand(['handover'], dir);
      expect(ho.exitCode).toBe(0);
      expect(ho.stdout).toContain('下一棒直接注入上下文块');
      expect(ho.stdout).toContain('1. 项目与红线：本项目核心目标是');
      expect(ho.stdout).toContain('3. 本轮唯一目标：请接手契约');
      expect(ho.stdout).toContain('.donegate/dashboard.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("智能有效代码行剥离注释空行，且契约显式生命周期状态机 (DRAFT -> FROZEN -> IMPLEMENTED) 精确推演", () => {
    const sample = [
      "// 顶部模块说明注释",
      "/* 多行块注释第一行",
      " * 多行块注释第二行 */",
      "",
      "export function calcTotal(items) {",
      "  // 内部行注释不计入有效代码上限",
      "  return items.reduce((s, x) => s + x, 0);",
      "}"
    ].join("\n");
    const m = countEffectiveCodeLines(sample);
    expect(m.rawLines).toBe(8);
    expect(m.effectiveLines).toBe(3);
    expect(m.maxFnLines).toBe(3);

    const dir = mkdtempSync(join(tmpdir(), "dg-lifecycle-"));
    try {
      dispatchCommand(["init", "."], dir);
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/core.mjs"), "export const ok = () => true;\n");
      dispatchCommand(["contract", "new", "auth-flow", "--title", "认证闭环", "--scope", "src/"], dir);

      let st = computeProjectStatus(dir);
      let cs = st.contractSummaries.find((x) => x.id === "auth-flow");
      expect(cs.lifecycleState).toBe("DRAFT");
      expect(cs.nextCommand).toContain("contract freeze auth-flow");

      const cPath = join(dir, "contracts/auth-flow/contract.json");
      const cDoc = JSON.parse(readFileSync(cPath, "utf8"));
      cDoc.obligations = [{
        id: "ob-pass",
        kind: "command",
        command: "node -e \"process.exit(0)\"",
        expect: { exitCode: 0 },
        scopeAck: { by: "业主", at: "2026-11-21T00:00:00Z" }
      }];
      writeFileSync(cPath, JSON.stringify(cDoc, null, 2));
      spawnSync("git", ["-C", dir, "init", "-q"]);
      spawnSync("git", ["-C", dir, "config", "user.email", "t@local"]);
      spawnSync("git", ["-C", dir, "config", "user.name", "T"]);
      spawnSync("git", ["-C", dir, "add", "."]);
      spawnSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);

      const frz = dispatchCommand(["contract", "freeze", "auth-flow", "--by", "业主"], dir);
      expect(frz.exitCode).toBe(0);
      spawnSync("git", ["-C", dir, "add", "."]);
      spawnSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "freeze"]);

      st = computeProjectStatus(dir);
      cs = st.contractSummaries.find((x) => x.id === "auth-flow");
      expect(cs.lifecycleState).toBe("FROZEN");
      expect(cs.nextCommand).toContain("check auth-flow");

      const chk = dispatchCommand(["check", "auth-flow", "--skip-gates"], dir);
      expect(chk.exitCode).toBe(0);
      st = computeProjectStatus(dir);
      cs = st.contractSummaries.find((x) => x.id === "auth-flow");
      expect(cs.lifecycleState).toBe("IMPLEMENTED");
      expect(cs.nextCommand).toContain("teeth auth-flow ob-pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UI 看板美学引擎精准拦截紫粉渐变/纯 Emoji 反模式并按行业推荐 3 套差异化方案', () => {
    const badSlop = '<div style="background: linear-gradient(90deg, #8b5cf6, #ec4899)"><button>🚀</button></div>';
    const badAudit = auditHtmlAntiAiSlop(badSlop);
    expect(badAudit.pass).toBe(false);
    expect(badAudit.warnings.length).toBe(2);

    const cleanUi = '<div style="background: var(--ui-surface)"><button class="ui-btn">新建工单</button></div>';
    expect(auditHtmlAntiAiSlop(cleanUi).pass).toBe(true);

    const props = recommendAestheticProposals('企业安全合规监控与审批台账', 3);
    expect(props.length).toBe(3);
    expect(new Set(props.map((p) => p.id)).size).toBe(3);
  });

  it('install-hooks 兼顾 Windows 盘符大小写、跨盘符绝对路径与 0.4.0 精简公开仓自检钩子', () => {
    const winDg = win32.join('D:', 'skills', 'DoneGate');
    const expectedWinSkill = win32.join(winDg, 'skill').replace(/\\/g, '/');
    const winCrossTmp = win32.join('C:', 'Users', 'Dev', 'AppData', 'Local', 'Temp', 'dg-hook-test');
    const winParent = win32.join('D:');
    const winSameCaseDiff = win32.join('d:', 'skills', 'donegate');

    expect(resolveSkillPrefix(winCrossTmp, winDg, win32)).toBe(expectedWinSkill);
    expect(resolveSkillPrefix(winParent, winDg, win32)).toBe(expectedWinSkill);
    expect(resolveSkillPrefix(winSameCaseDiff, winDg, win32)).toBe('skill');

    const crossScript = buildPreCommitScript(winCrossTmp, winDg, win32);
    expect(crossScript).toContain(`DG_SKILL="${expectedWinSkill}"`);
    expect(crossScript).not.toContain('DG_SKILL="skill"');
    expect(crossScript).toContain('[ -f "skill/check-escapes.mjs" ] && [ -f "escapes.jsonl" ]');

    expect(resolveSkillPrefix('/workspace/DoneGate', '/workspace/DoneGate', posix)).toBe('skill');
    expect(resolveSkillPrefix('/workspace', '/workspace/DoneGate', posix)).toBe('/workspace/DoneGate/skill');
    expect(resolveSkillPrefix('/tmp/demo-proj', '/workspace/DoneGate', posix)).toBe('/workspace/DoneGate/skill');
  });

  it('Windows (win32) 专项回归：跨盘符越界拦截、浏览器 URL 直开、.cmd 含空格双引号转义、白名单环境与中文路径写范围核验', async () => {
    // 1. Windows 跨盘符 path.win32.relative 越界防护
    const winWorkApp = win32.join('D:', 'Work', 'MyApp');
    const winSys32 = win32.join('C:', 'Windows', 'System32');
    const folders = resolveSafeWorkspaceFolders(winWorkApp, [
      winSys32,
      win32.join('..', '..', 'Secret'),
      win32.join('..', 'SharedLib')
    ], win32);
    expect(folders[0].blocked).toBe(true);
    expect(folders[0].absPath).toBeNull();
    expect(folders[1].blocked).toBe(true);
    expect(folders[2].blocked).toBe(false);

    // 2. openInSystemBrowser / buildBrowserOpenCommand 不再用 path.resolve 破坏 http:// URL 且开启 verbatim 参数
    const urlCmd = buildBrowserOpenCommand('http://127.0.0.1:43180/', 'win32', win32);
    expect(urlCmd.cmd).toBe('cmd.exe');
    expect(urlCmd.args).toEqual(['/d', '/s', '/c', '"start "" "http://127.0.0.1:43180/""']);
    expect(urlCmd.opts.windowsVerbatimArguments).toBe(true);
    expect(urlCmd.opts.windowsHide).toBe(true);

    const winDashHtml = win32.join('D:', 'My Project', '.donegate', 'dashboard.html');
    const fileCmd = buildBrowserOpenCommand(winDashHtml, 'win32', win32);
    expect(fileCmd.args[3]).toBe(`"start "" "${winDashHtml}""`);

    // 3. 适配器 Windows .cmd 批处理含空格/括号双路径安全封装
    const winBiomeCmd = win32.join('C:', 'Users', 'Dev User', 'AppData', 'Roaming', 'npm', 'biome.cmd');
    const winTargetSrc = win32.join('D:', 'DoneGate V4(完结门)', 'src');
    const wb = buildWinBatchSpawn(winBiomeCmd, ['check', winTargetSrc]);
    expect(wb.args).toEqual([
      '/d', '/s', '/c',
      `""${winBiomeCmd}" check "${winTargetSrc}""`
    ]);
    expect(wb.extraOpts.windowsVerbatimArguments).toBe(true);

    // 4. 隔离运行器环境白名单保留 Windows 关键目录并合并 Path -> PATH，同时剥离敏感密钥
    const winNodeDir = win32.join('C:', 'Program Files', 'nodejs');
    const winAppData = win32.join('C:', 'Users', 'Dev', 'AppData', 'Roaming');
    const winLocalAppData = win32.join('C:', 'Users', 'Dev', 'AppData', 'Local');
    const winDir = win32.join('C:', 'Windows');
    const san = buildSanitizedEnv({
      Path: `${winSys32};${winNodeDir}`,
      APPDATA: winAppData,
      LOCALAPPDATA: winLocalAppData,
      SystemDrive: 'C:',
      WINDIR: winDir,
      OPENAI_API_KEY: 'sk-should-not-leak'
    });
    expect(san.PATH).toContain(winNodeDir);
    expect(san.APPDATA).toBe(winAppData);
    expect(san.LOCALAPPDATA).toBe(winLocalAppData);
    expect(san.SystemDrive).toBe('C:');
    expect(san.OPENAI_API_KEY).toBeUndefined();

    // 5. 中文路径 git diff (core.quotepath=false) 写范围校验 + /file-preview 目录 EISDIR 与同前缀越界防护
    const baseTmp = mkdtempSync(join(tmpdir(), 'dg-win-audit-'));
    const dir = join(baseTmp, 'proj');
    const siblingDir = join(baseTmp, 'proj-secret');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, 'leak.txt'), 'TOP_SECRET\n', 'utf8');
    writeFileSync(join(dir, '.gitignore'), '.donegate/\n', 'utf8');
    writeFileSync(join(dir, 'docs/说明文档.md'), '# 初版\n', 'utf8');
    spawnSync('git', ['-C', dir, 'init', '-q']);
    spawnSync('git', ['-C', dir, 'config', 'user.email', 't@local']);
    spawnSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    spawnSync('git', ['-C', dir, 'add', '.']);
    spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

    writeFileSync(join(dir, 'docs/说明文档.md'), '# 第二版（中文路径不触发八进制转义误判）\n', 'utf8');
    const diff = collectGitDiffStats(dir);
    expect(diff.files).toEqual(['docs/说明文档.md']);
    expect(checkWriteScopeMandate(diff.files, ['DOCS/'], 'win32').ok).toBe(true);
    expect(getRunEventHub(dir)).toBe(getRunEventHub(dir));

    dispatchCommand(['init', '.'], dir);
    const srv = await startAtlasHttpServer(dir, { port: 0, idleExitSec: 15 });
    try {
      const rRootDir = await fetch(`${srv.url}donegate/api/file-preview?path=`);
      expect(rRootDir.status).toBe(404);
      const rSubDir = await fetch(`${srv.url}donegate/api/file-preview?path=docs`);
      expect(rSubDir.status).toBe(404);
      const rSibling = await fetch(`${srv.url}donegate/api/file-preview?path=../proj-secret/leak.txt`);
      expect(rSibling.status).toBe(404);
      const rValid = await fetch(`${srv.url}donegate/api/file-preview?path=${encodeURIComponent('docs/说明文档.md')}`);
      expect(rValid.status).toBe(200);
      const body = await rValid.json();
      expect(body.ok).toBe(true);
      expect(body.content).toContain('第二版');
    } finally {
      srv.server.close();
      rmSync(baseTmp, { recursive: true, force: true });
    }
  });

  it("混合选配与节点级即时派生 HTTP 闭环：Worker 403 拦截、需求变更局部派生、底座锁 409 拦截与一键沉淀宏", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dg-jit-http-"));
    dispatchCommand(["init", "."], dir);
    mkdirSync(join(dir, "src/core"), { recursive: true });
    writeFileSync(join(dir, "src/core/calc.mjs"), "// 计算器核心运算模块\nexport const add = (a, b) => a + b;\n", "utf8");
    const srv = await startAtlasHttpServer(dir, { port: 0, idleExitSec: 15 });
    try {
      const calcNode = {
        id: "node-calc-core",
        title: "计算器核心运算模块",
        tip: "负责四则运算与表达式求值",
        scopePaths: ["src/core/"],
        modules: [{ name: "核心运算模块", role: "逻辑", path: "src/core/calc.mjs" }]
      };

      // 1) Worker 角色越权请求 -> 403 WORKER_CANNOT_MUTATE_WORKFLOW
      const rWorker = await fetch(`${srv.url}donegate/api/jit/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DoneGate-Role": "worker" },
        body: JSON.stringify({ nodeId: calcNode.id, node: calcNode, removeTplIds: ["tpl-anti-slop"] })
      });
      expect(rWorker.status).toBe(403);
      const jWorker = await rWorker.json();
      expect(jWorker.code).toBe("WORKER_CANNOT_MUTATE_WORKFLOW");

      // 2) Super Agent 自动选配 + 按新需求即时派生
      const rAssign = await fetch(`${srv.url}donegate/api/jit/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DoneGate-Role": "super-agent" },
        body: JSON.stringify({ nodeId: calcNode.id, node: calcNode })
      });
      expect(rAssign.status).toBe(200);
      const jAssign = await rAssign.json();
      expect(jAssign.binding.baseMacroId).toBe("pack-core-logic");

      const rMut = await fetch(`${srv.url}donegate/api/jit/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DoneGate-Role": "super-agent" },
        body: JSON.stringify({
          nodeId: calcNode.id,
          node: calcNode,
          requirementText: "改需求：增加自定义公式解析并在前端弹窗展示实时汇率 API"
        })
      });
      expect(rMut.status).toBe(200);
      const jMut = await rMut.json();
      expect(jMut.binding.mode).toBe("jit-forked");
      expect(jMut.binding.tplIds).toContain("tpl-openspec");
      expect(jMut.binding.tplIds).toContain("tpl-gitleaks");
      expect(jMut.binding.tplIds).toContain("tpl-playwright");

      // 3) 试图删除底座护栏 tpl-anti-slop -> 409 MANDATORY_FLOOR_LOCKED
      const rFloor = await fetch(`${srv.url}donegate/api/jit/mutate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DoneGate-Role": "super-agent" },
        body: JSON.stringify({ nodeId: calcNode.id, node: calcNode, removeTplIds: ["tpl-anti-slop"] })
      });
      expect(rFloor.status).toBe(409);
      const jFloor = await rFloor.json();
      expect(jFloor.code).toBe("MANDATORY_FLOOR_LOCKED");
      expect(jFloor.requiresHumanApproval).toBe(true);

      // 4) 一键另存为预置宏 -> 写入 workflows/*.workflow.json
      const rPromo = await fetch(`${srv.url}donegate/api/jit/promote-macro`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DoneGate-Role": "human" },
        body: JSON.stringify({ nodeId: calcNode.id, macroId: "calc-fx-ui-macro", name: "计算器公式汇率全栈宏" })
      });
      expect(rPromo.status).toBe(200);
      const jPromo = await rPromo.json();
      expect(jPromo.ok).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "workflows/calc-fx-ui-macro.workflow.json"), "utf8")).name).toBe("计算器公式汇率全栈宏");
    } finally {
      srv.server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
