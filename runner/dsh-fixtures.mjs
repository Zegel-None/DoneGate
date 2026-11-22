#!/usr/bin/env node
// DSH Web 原生插件包、dsh-doc 规范、Windows 路径、类 ComfyUI 补齐与过夜挂机状态机自检夹具（<= 325 行）
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { cleanGitEnv } from './dsh/autopilot-worktree.mjs';
import {
  buildDshFileResourceAddress, resolveDshHome,
  resolveDshProfileDir, toSafeFileUrl
} from './dsh/win-paths.mjs';
import {
  buildElementQuotePayload, buildMicroVerdictCard,
  parseQuotedTargetsFromMessage
} from './dsh/quote-protocol.mjs';
import {
  executeDeterministicWorkflowRun, preflightWorkflowPack
} from './dsh/workflow-runner.mjs';
import {
  buildWorkflowDepEnv, inspectWorkflowDeps, provisionWorkflowDeps, runNpmPrefixInstall
} from './dsh/workflow-deps.mjs';
import {
  AUTOPILOT_STATES, approveAutopilotHumanGate, loadAutopilotCheckpoint
} from './dsh/autopilot-state.mjs';
import {
  buildDshBundleDirectory, installDshWebBundle, uninstallDshWebBundle
} from './dsh/install-dsh-web.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function runAllDshChecks() {
  let passed = 0;
  const check = async (label, fn) => {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  };

  await check('1. Windows (win32) 含空格与中文路径归一化及 file:/// / dsh-resource:// 协议安全编码', () => {
    const mockHome = win32.join('C:', 'Users', 'DevUser');
    const winEnv = { USERPROFILE: mockHome };
    assert.equal(resolveDshHome(winEnv, 'win32'), win32.join(mockHome, '.dsh'));
    assert.equal(resolveDshProfileDir('web', winEnv, 'win32'), win32.join(mockHome, '.dsh', 'profiles', 'web'));
    const url = toSafeFileUrl(win32.join('D:', 'Agent-Studio', 'DSH-Work', 'DoneGate V4(完结门)', 'runner', 'dsh', 'host-routes.mjs'));
    assert.ok(url.startsWith('file:///D:/Agent-Studio/DSH-Work/'));
    assert.ok(url.includes('%20'));
    const mockRoot = win32.join('D:', 'Agent-Studio', 'DoneGate');
    const resUri = buildDshFileResourceAddress('sess-01', mockRoot, win32.join(mockRoot, 'runner', 'dsh', 'workflow-runner.mjs'));
    assert.equal(resUri, 'dsh-resource://file/session/sess-01/runner/dsh/workflow-runner.mjs');
    const lowerDriveUri = buildDshFileResourceAddress('sess-01', mockRoot, win32.join('d:', 'agent-studio', 'donegate', 'runner', 'dsh', 'workflow-runner.mjs'));
    assert.equal(lowerDriveUri, 'dsh-resource://file/session/sess-01/runner/dsh/workflow-runner.mjs');
    const cmdBytes = readFileSync(join(ROOT, 'install-dsh-web.cmd'), 'utf8');
    assert.ok(cmdBytes.includes('\r\n'), 'install-dsh-web.cmd 必须保持 Windows CRLF 换行');
    assert.ok(cmdBytes.includes('chcp 65001'), 'install-dsh-web.cmd 必须切换 UTF-8 代码页');
    assert.ok(cmdBytes.includes('"%~1"'), 'install-dsh-web.cmd 必须使用 %~1 兼容带引号参数');
    const gitAttrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
    assert.ok(gitAttrs.includes('*.cmd text eol=crlf') && gitAttrs.includes('* text=auto eol=lf'));
  });

  await check('2. DSH 原生蓝色引用胶囊多元素累加（卡片 + 连线 + 按钮）与两行验真微卡协议', () => {
    const q1 = buildElementQuotePayload({ kind: 'node', id: 'n-ui', label: 'UI 组件层', contractIds: ['verdict-core'], scopePaths: ['runner/atlas'] });
    const q2 = buildElementQuotePayload({ kind: 'link', id: 'lk-loop-1', label: '门禁失败回跳线' });
    const q3 = buildElementQuotePayload({ kind: 'control', id: 'tb:bypass', label: '跳过' });
    assert.equal(q1.summary.label, '[节点]');
    assert.equal(q2.summary.label, '[连线]');
    assert.equal(q3.summary.label, '[按钮]');
    assert.equal(q3.summary.body, '跳过');

    const prompt = `${q1.text}\n${q2.text}\n${q3.text}\n请把跳过按钮改成琥珀色并检查这条回跳线的门禁上限`;
    const targets = parseQuotedTargetsFromMessage(prompt);
    assert.equal(targets.length, 3);
    assert.equal(targets[0].kind, 'node');
    assert.equal(targets[1].kind, 'link');
    assert.equal(targets[2].kind, 'control');

    const card = buildMicroVerdictCard({
      ticketId: 'tkt-01', targetUri: q1.uri, exitCode: 0,
      headline: '已更新按钮配色并通过确定性门禁校验', passedGates: 3, totalGates: 3,
      touchedFiles: ['runner\\atlas\\wb-dsh-style.mjs'], addedLines: 12, removedLines: 2, canRollback: true
    });
    assert.ok(card.headline.length <= 22);
    assert.equal(card.tone, 'ok');
    assert.equal(card.touchedFiles[0], 'runner/atlas/wb-dsh-style.mjs');
    assert.equal(card.canRollback, true);
  });

  await check('3. DSH 创造模式 (dsh-doc) 官方规范校验（manifest / engines.dsh / locale / 纯几何 SVG 图标与预览图）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-bundle-'));
    try {
      const { bundleDir } = buildDshBundleDirectory(ROOT, join(tmp, 'dsh-donegate'));
      const pkg = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, '@local/dsh-donegate');
      assert.equal(pkg.engines.dsh, '^0.2.2-alpha.2');
      assert.equal(pkg.dsh.client.platform, 'web');
      assert.equal(pkg.dsh.client.immediately, true);
      assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
      assert.equal(pkg.exports['./icon'], './icon.svg');

      const zh = JSON.parse(readFileSync(join(bundleDir, 'locale', 'zh.json'), 'utf8'));
      const en = JSON.parse(readFileSync(join(bundleDir, 'locale', 'en.json'), 'utf8'));
      assert.equal(en.meta.title, 'DoneGate workbench');
      assert.ok(existsSync(join(bundleDir, zh.meta.detail)));
      assert.ok(existsSync(join(bundleDir, en.meta.detail)));

      const iconSvg = readFileSync(join(bundleDir, 'icon.svg'), 'utf8');
      const prevSvg = readFileSync(join(bundleDir, 'docs', 'preview.svg'), 'utf8');
      assert.ok(iconSvg.includes('viewBox="0 0 36 36"'));
      assert.ok(prevSvg.includes('viewBox="0 0 640 300"'));
      for (const forbidden of ['<text', '<style', '<script', 'foreignObject']) {
        assert.ok(!iconSvg.includes(forbidden), `icon.svg 禁止包含 ${forbidden}`);
        assert.ok(!prevSvg.includes(forbidden), `preview.svg 禁止包含 ${forbidden}`);
      }

      const patchYml = readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8');
      assert.ok(patchYml.includes("process.platform === 'win32'"));
      assert.ok(patchYml.includes('@deepseek-ai/dsh-pwsh-sandbox'));
      assert.ok(patchYml.includes('id: preset-donegate-router'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('4. Windows Profile 双形态安装/卸载仿真（含 package.json bundles 列表模式与纯 patch 兜底模式）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-winprof-'));
    try {
      const profWithPkg = join(tmp, 'dsh-home', 'profiles', 'web');
      mkdirSync(profWithPkg, { recursive: true });
      writeFileSync(join(profWithPkg, 'package.json'), JSON.stringify({
        name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app'] } }
      }, null, 2));

      const res = installDshWebBundle({ projectRoot: ROOT, dshHome: join(tmp, 'dsh-home'), profileDir: profWithPkg, platform: 'win32' });
      assert.equal(res.registeredInManifest, true);
      const afterPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(afterPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
      assert.ok(existsSync(join(profWithPkg, 'node_modules', '@local', 'dsh-donegate', 'lib', 'client.js')));

      uninstallDshWebBundle({ dshHome: join(tmp, 'dsh-home'), profileDir: profWithPkg, platform: 'win32' });
      const cleanedPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(!cleanedPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('5. 浏览器端 __ModuleLoader__ 沙箱加载与插槽注册 + 确定性工作流状态机验真', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-vm-'));
    try {
      const { bundleDir } = buildDshBundleDirectory(ROOT, join(tmp, 'bundle'));
      const clientCode = readFileSync(join(bundleDir, 'lib', 'client.js'), 'utf8');
      let loadedMod = null;
      const registeredSlots = [];
      const sandbox = {
        window: { __ModuleLoader__: { load(spec) { loadedMod = spec; } }, addEventListener() {}, removeEventListener() {} },
        encodeURIComponent, Boolean, String, Array, Map, Set
      };
      vm.runInNewContext(clientCode, sandbox);
      assert.ok(loadedMod && loadedMod.id === '@local/dsh-donegate');
      const plugin = loadedMod.factory((modName) => {
        if (modName === 'react') return { createElement: (...a) => a, useRef: () => ({ current: null }), useEffect() {} };
        throw new Error('Unexpected require: ' + modName);
      });
      plugin.apply({
        effect(fn) { fn(); },
        locale: { register() { return () => {}; }, bind() { return (k) => k; } },
        slots: { inject(_slot, cb) { cb(); }, register(opts, comp) { registeredSlots.push({ opts, comp }); return () => {}; } },
        get() { return null; }
      });
      const slotNames = registeredSlots.map((s) => `${s.opts.name}:${s.opts.id}`);
      assert.ok(slotNames.includes('conversation.view:donegate'));
      assert.ok(slotNames.includes('conversation.input.dock:donegate-dock'));
      assert.ok(slotNames.includes('conversation.input.left:donegate-switch'));
      assert.ok(clientCode.includes('data-conversation-composer-overlay'), '必须启用 DSH 全屏覆盖模式使工作台铺满输入框底部区域');
      assert.ok(clientCode.includes('--dsh-composer-card-max-width'), '顶部消息栏必须与下方输入框严格共享 --dsh-composer-card-max-width 等宽');
      assert.ok(clientCode.includes('--dsw-specific-input-major') && clientCode.includes('--dsw-radius-xl'), '必须复用 DSH 官方输入框表面与圆角令牌');

      const pre = preflightWorkflowPack({ id: 'wf-blank', name: '含空白节点流', nodes: [{ id: 'b1', title: '待定模块', isBlank: true }], links: [] });
      assert.equal(pre.ok, false);
      assert.equal(pre.exitCode, 3);

      const workRoot = join(tmp, 'proj');
      mkdirSync(workRoot, { recursive: true });
      const runRes = await executeDeterministicWorkflowRun(workRoot, { ticketId: 'tkt-vm-1', targetUri: 'dg://node/g1', headline: '确定性门禁通过' }, {
        id: 'wf-ok', name: '门禁直通验证流',
        nodes: [{ id: 'g1', title: '确定性门禁核验', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'process.exit(0)'] } }],
        links: []
      });
      assert.equal(runRes.ok, true);
      assert.equal(runRes.exitCode, 0);
      assert.equal(runRes.card.tone, 'ok');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('6. 类 ComfyUI 开发流缺依赖硬阻断、workflows/.deps/<id>/ 隔离补齐与 PATH 自动注入闭环', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-wf-deps-'));
    try {
      const pack = {
        id: 'stage-sec-demo', name: '供应链漏洞核验流',
        deps: [{ id: 'mock-sec-cli', title: 'MockSec 开源扫描器', repo: 'acme/mock-sec-cli', version: 'v1.2.0', kind: 'binary', bin: 'mock-sec-cli-never-installed', allowHostEnv: false }],
        nodes: [{ id: 'n-sec', title: 'MockSec 扫描卡', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'if (!process.env.DG_WORKFLOW_DEPS_DIR) process.exit(2); process.exit(0);'] } }],
        links: []
      };
      const blocked = await executeDeterministicWorkflowRun(tmp, { ticketId: 'tkt-dep-1' }, pack);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.exitCode, 3);
      assert.equal(blocked.code, 'MISSING_WORKFLOW_DEPS');

      const prov1 = provisionWorkflowDeps(tmp, pack);
      assert.equal(prov1.ready, false);
      assert.ok(existsSync(join(tmp, 'workflows', '.deps', 'stage-sec-demo', 'PROVISION-PLAN.json')));

      const binFile = join(tmp, 'workflows', '.deps', 'stage-sec-demo', '.bin', 'mock-sec-cli-never-installed');
      writeFileSync(binFile, '#!/bin/sh\necho 1.2.0\n', 'utf8');
      try { chmodSync(binFile, 0o755); } catch (err) { void err; }
      assert.equal(inspectWorkflowDeps(tmp, pack, { platform: 'win32' }).ready, false, 'Windows 下严禁误把无扩展名 POSIX shell 包装脚本判为可执行');

      writeFileSync(binFile + '.cmd', '@echo off\r\necho 1.2.0\r\n', 'utf8');
      assert.equal(inspectWorkflowDeps(tmp, pack, { platform: 'win32' }).ready, true, 'Windows 下补齐 .cmd 入口后就位探针通过');

      const afterInspect = inspectWorkflowDeps(tmp, pack);
      assert.equal(afterInspect.ready, true);
      const wfEnv = buildWorkflowDepEnv(tmp, pack.id, { PATH: '/usr/bin' });
      assert.ok(wfEnv.PATH.includes(join('workflows', '.deps', 'stage-sec-demo', '.bin')));
      const sys32 = win32.join('C:', 'Windows', 'System32');
      const wfWinEnv = buildWorkflowDepEnv(tmp, pack.id, { Path: sys32 }, 'win32');
      assert.equal('Path' in wfWinEnv, false, 'Windows 环境变量对象不得并存 Path 与 PATH 双键');
      assert.ok(wfWinEnv.PATH.endsWith(';' + sys32));
      assert.equal(runNpmPrefixInstall(tmp, 'bad;echo', tmp, 'win32').status, 2);

      const unblocked = await executeDeterministicWorkflowRun(tmp, { ticketId: 'tkt-dep-2' }, pack);
      assert.equal(unblocked.ok, true);
      assert.equal(unblocked.exitCode, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('7. 过夜挂机长跑状态机：断点续跑不重跑已完成节点、human-gate 早间简报挂起与三重防烧钱熔断', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-autopilot-'));
    try {
      const counterFile = join(tmp, 'step1-count.txt');
      writeFileSync(counterFile, '0', 'utf8');
      const nightPack = {
        id: 'pack-overnight', name: '数据库迁移过夜流',
        nodes: [
          {
            id: 's1', title: '空库迁移演练',
            exec: { kind: 'mortar_gate', nodeArgs: ['-e', `const fs=require("fs");const n=Number(fs.readFileSync(${JSON.stringify(counterFile)},"utf8"))+1;fs.writeFileSync(${JSON.stringify(counterFile)},String(n));process.exit(0);`] }
          },
          { id: 's2-gate', tplId: 'tpl-human-gate', isHumanGate: true, title: '不可逆迁移上线闸门', tip: '确认备份无误后放行' },
          { id: 's3', title: '对账校验收尾', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'process.exit(0)'] } }
        ],
        links: [
          { id: 'l1', fromNode: 's1', fromSlot: 'out', toNode: 's2-gate', toSlot: 'in' },
          { id: 'l2', fromNode: 's2-gate', fromSlot: 'out_go', toNode: 's3', toSlot: 'in' }
        ]
      };

      const pass1 = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-01' }, nightPack);
      assert.equal(pass1.suspended, true);
      assert.equal(pass1.state, AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE);
      assert.equal(readFileSync(counterFile, 'utf8'), '1');
      const cp1 = loadAutopilotCheckpoint(tmp, 'night-01');
      assert.ok(cp1.briefMarkdown.includes('不可逆迁移上线闸门'));

      const app = approveAutopilotHumanGate(tmp, { runId: 'night-01', by: '业主' });
      assert.equal(app.ok, true);
      const pass2 = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-01' }, nightPack, { resumeRunId: 'night-01' });
      assert.equal(pass2.ok, true);
      assert.equal(pass2.state, AUTOPILOT_STATES.COMPLETED);
      assert.equal(readFileSync(counterFile, 'utf8'), '1', '断点续跑严禁重复执行已完成的上游节点 s1');

      const loopPack = {
        id: 'pack-loop-burn', name: '死循环熔断测试流',
        nodes: [{ id: 'bad1', title: '恒败单测', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'process.exit(1)'] } }],
        links: [{ id: 'self-lk', fromNode: 'bad1', fromSlot: 'out', toNode: 'bad1', toSlot: 'in', maxLoops: 2 }]
      };
      const trippedLoop = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-loop' }, loopPack);
      assert.equal(trippedLoop.ok, false);
      assert.equal(trippedLoop.code, 'MAX_LOOPS_EXCEEDED');
      assert.equal(trippedLoop.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);

      const gitDir = join(tmp, 'scoped-repo');
      mkdirSync(join(gitDir, 'src'), { recursive: true });
      mkdirSync(join(gitDir, 'secret'), { recursive: true });
      writeFileSync(join(gitDir, '.gitignore'), '.donegate/\n');
      writeFileSync(join(gitDir, 'src/ok.mjs'), 'export const x = 1;\n');
      writeFileSync(join(gitDir, 'secret/prod.env'), 'KEY=1\n');
      spawnSync('git', ['-C', gitDir, 'init', '-q'], { env: cleanGitEnv() });
      spawnSync('git', ['-C', gitDir, 'config', 'user.email', 't@local'], { env: cleanGitEnv() });
      spawnSync('git', ['-C', gitDir, 'config', 'user.name', 'T'], { env: cleanGitEnv() });
      spawnSync('git', ['-C', gitDir, 'add', '.'], { env: cleanGitEnv() });
      spawnSync('git', ['-C', gitDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { env: cleanGitEnv() });

      const scopePack = {
        id: 'pack-scope', name: '越界写拦截测试流',
        nodes: [{ id: 'rogue', title: '偷改禁区文件', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'require("fs").writeFileSync("secret/prod.env","KEY=2\\n");process.exit(0);'] } }],
        links: []
      };
      const trippedScope = await executeDeterministicWorkflowRun(gitDir, { ticketId: 'night-scope', mandate: { allowedWriteScopes: ['src/'] } }, scopePack);
      assert.equal(trippedScope.ok, false);
      assert.equal(trippedScope.exitCode, 2);
      assert.equal(trippedScope.code, 'WRITE_SCOPE_VIOLATION');
      assert.equal(trippedScope.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);

      const trippedDirty = await executeDeterministicWorkflowRun(gitDir, { ticketId: 'night-dirty' }, { id: 'p-clean', name: '净树检查流', nodes: [{ id: 'c1', title: '探针', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'process.exit(0)'] } }], links: [] }, { requireCleanGit: true });
      assert.equal(trippedDirty.ok, false);
      assert.equal(trippedDirty.code, 'DIRTY_WORKTREE_FAULT');
      assert.equal(trippedDirty.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });


  await check("8. 过夜挂机 Git Worktree 零污染隔离沙箱与输入材料指纹免跑缓存", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "dg-wt-cache-"));
    try {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(join(tmp, ".gitignore"), ".donegate/\n");
      writeFileSync(join(tmp, "src/main.mjs"), "export const val = 1;\n");
      spawnSync('git', ["-C", tmp, "init", "-q"], { env: cleanGitEnv() });
      spawnSync('git', ["-C", tmp, "config", "user.email", "t@local"], { env: cleanGitEnv() });
      spawnSync('git', ["-C", tmp, "config", "user.name", "T"], { env: cleanGitEnv() });
      spawnSync('git', ["-C", tmp, "add", "."], { env: cleanGitEnv() });
      spawnSync('git', ["-C", tmp, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"], { env: cleanGitEnv() });

      // (A) Worktree 熔断测试：沙箱内污染 src/main.mjs 后触发自循环熔断 -> 主工作区必须 100% 干净零污染！
      const failWtPack = {
        id: "pack-wt-fail", name: "沙箱脏改熔断流",
        nodes: [{
          id: "dirty-fail", title: "改坏源码但测试不过",
          exec: { kind: "mortar_gate", nodeArgs: ["-e", "require(\"fs\").writeFileSync(\"src/main.mjs\", \"BROKEN_NIGHT_CODE\\n\"); process.exit(1);"] }
        }],
        links: [{ id: "lk-f", fromNode: "dirty-fail", fromSlot: "out", toNode: "dirty-fail", toSlot: "in", maxLoops: 1 }]
      };
      const rFail = await executeDeterministicWorkflowRun(tmp, { ticketId: "wt-fail-01" }, failWtPack, { useWorktreeSandbox: true });
      assert.equal(rFail.ok, false);
      assert.equal(rFail.sandboxWorktree.status, "quarantined_clean_main");
      assert.equal(readFileSync(join(tmp, "src/main.mjs"), "utf8"), "export const val = 1;\n", "主工作区源码严禁被失败的过夜挂机污染");
      const mainSt = spawnSync("git", ["-C", tmp, "status", "--porcelain"], { encoding: "utf8", env: cleanGitEnv() });
      assert.equal(mainSt.stdout.trim(), "", "熔断后主工作区 git status 必须保持 100% 干净");

      // (B) Worktree 全绿测试：沙箱内演进源码并通过门禁 -> 自动提交并快进合回主分支且清理临时目录！
      const okWtPack = {
        id: "pack-wt-ok", name: "沙箱全绿合入流",
        nodes: [{
          id: "ok-edit", title: "修复并通过验收",
          exec: { kind: "mortar_gate", nodeArgs: ["-e", "require(\"fs\").writeFileSync(\"src/main.mjs\", \"export const val = 42;\\n\"); process.exit(0);"] }
        }],
        links: []
      };
      const rOk = await executeDeterministicWorkflowRun(tmp, { ticketId: "wt-ok-01" }, okWtPack, { useWorktreeSandbox: true });
      assert.equal(rOk.ok, true);
      assert.equal(rOk.sandboxWorktree.mergedToMain, true);
      assert.equal(readFileSync(join(tmp, "src/main.mjs"), "utf8"), "export const val = 42;\n", "全绿挂机成果应自动快进合回主分支");

      // (C) 材料指纹免跑缓存测试：输入未变二次运行自动免跑跳过，改动输入后自动失效重跑！
      const markerPath = join(tmp, ".donegate", "cache-runs.txt");
      const cachePack = {
        id: "pack-fp-cache", name: "指纹免跑验证流",
        nodes: [{
          id: "fp-node", title: "昂贵静态扫描", inputs: ["src/"],
          exec: { kind: "mortar_gate", nodeArgs: ["-e", `const fs=require("fs"),p=${JSON.stringify(markerPath)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p,"utf8"):0)+1));process.exit(0);`] }
        }],
        links: []
      };
      const runA = await executeDeterministicWorkflowRun(tmp, { ticketId: "fp-1" }, cachePack, { useFingerprintCache: true });
      assert.equal(runA.ok, true);
      assert.equal(runA.cacheHits, 0);
      assert.equal(readFileSync(markerPath, "utf8"), "1");

      const runB = await executeDeterministicWorkflowRun(tmp, { ticketId: "fp-2" }, cachePack, { useFingerprintCache: true });
      assert.equal(runB.ok, true);
      assert.equal(runB.cacheHits, 1, "源码未改动时第二次运行必须命中指纹缓存免跑");
      assert.equal(readFileSync(markerPath, "utf8"), "1", "命中缓存时底层子进程严禁被重复拉起");

      writeFileSync(join(tmp, "src/main.mjs"), "export const val = 99;\n");
      const runC = await executeDeterministicWorkflowRun(tmp, { ticketId: "fp-3" }, cachePack, { useFingerprintCache: true });
      assert.equal(runC.cacheHits, 0, "源码变更后材料指纹变化，必须自动失效并重跑真机节点");
      assert.equal(readFileSync(markerPath, "utf8"), "2");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(`RESULT: PASS DSH Web 插件与 Windows 跨平台全套 ${passed} 项端到端断言通过`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runAllDshChecks().catch((err) => {
    console.error('RESULT: FAIL', err);
    process.exit(1);
  });
}
