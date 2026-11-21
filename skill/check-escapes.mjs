#!/usr/bin/env node
// 漏网之鱼（Escaped-Bug）识别、根因门禁与社区反馈组件
//
// 为什么要有它：
//   当项目全部门禁都报「全绿」、实际用起来却还是出了 bug，说明门禁存在盲区。
//   单靠打点补丁只是治标——每次漏网，必须把「为什么当时全绿没拦住」「根因是什么」
//   「同类隐患在哪」「怎么用一条独立门禁永久锁死」落盘并跑通，完成自我迭代。
//
// 用法：
//   node skill/check-escapes.mjs                      # 核验 DoneGate 自身 escapes.jsonl 与 E01-E06 回归门禁
//   node skill/check-escapes.mjs --only E01           # 只跑指定编号的自检门禁
//   node skill/check-escapes.mjs --project <项目根>   # 核验用户项目 .donegate/escapes.jsonl 并实跑每条自建门禁
//   node skill/check-escapes.mjs --record --project <项目根> --id <id> --symptom <现象> --why-missed <为何全绿漏过> --root-cause <根因> --scope-fix <同类横扫> --gate <门禁命令>
//   node skill/check-escapes.mjs --report-template [--symptom <现象>] [--why-missed <原因>]
//   node skill/check-escapes.mjs --red-self-test      # 负样本自检（确认坏台账 / 失败门禁一定退 1）
//
// 退出码：0 全部通过；1 发现门禁缺口、校验失败或回归红灯；3 参数或环境读取错误
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { appendProgressNote, renderProgressBlock, renderWorryBlock, verifyProjectNotes } from '../runner/core/progress.mjs';
import { walkByExt } from './fs-walk.mjs';
import { cleanScratchDir } from './check-commit-hygiene.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REPO_URL = 'https://github.com/q862877400-ux/DoneGate';
const COMMUNITY_MOTTO = '众人拾柴火焰高——你踩过的坑反馈上来，修成一条新门禁，下次拉取更新时所有人的成果都能直接为你守门。欢迎提个 Issue，你也来添一把柴！';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(k);

const REQUIRED_FIELDS = ['id', 'date', 'symptom', 'whyMissed', 'rootCause', 'scopeFix', 'gateCommand'];
const PLACEHOLDERS = new Set(['todo', 'tbd', 'none', 'na', 'n/a', '无', '待补充', '待定', '暂无']);

export function validateEscapeEntry(entry, lineNo) {
  const errs = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`第 ${lineNo} 行不是 JSON 对象`];
  }
  for (const f of REQUIRED_FIELDS) {
    const v = typeof entry[f] === 'string' ? entry[f].trim() : '';
    if (!v) errs.push(`第 ${lineNo} 行（${entry.id || '?'}）缺少必填字段 ${f}`);
    else if (PLACEHOLDERS.has(v.toLowerCase())) errs.push(`第 ${lineNo} 行（${entry.id || '?'}）字段 ${f} 不许填占位词「${v}」`);
  }
  if (typeof entry.gateCommand === 'string' && /\|\|\s*true\b|continue-on-error/.test(entry.gateCommand)) {
    errs.push(`第 ${lineNo} 行（${entry.id || '?'}）gateCommand 含吞错写法（违反 INV-10 / 门禁纪律）`);
  }
  return errs;
}

export function auditEscapesFile(jsonlPath, execCwd, opts = {}) {
  const onlyId = opts.onlyId || null;
  const runGates = opts.runGates !== false;
  const fails = [];
  const passed = [];
  if (!existsSync(jsonlPath)) {
    return { exists: false, entries: [], passed, fails };
  }
  const raw = readFileSync(jsonlPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seenIds = new Set();
  const entries = [];
  lines.forEach((line, idx) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      fails.push(`第 ${idx + 1} 行 JSON 损坏：${e.message}`);
      return;
    }
    const errs = validateEscapeEntry(obj, idx + 1);
    if (seenIds.has(obj.id)) errs.push(`第 ${idx + 1} 行 id 重复：${obj.id}`);
    seenIds.add(obj.id);
    if (errs.length) { fails.push(...errs); return; }
    entries.push(obj);
  });

  if (runGates) {
    for (const e of entries) {
      if (onlyId && e.id !== onlyId) continue;
      if (opts.builtinGates && opts.builtinGates[e.id]) {
        const res = opts.builtinGates[e.id]();
        if (!res.ok) fails.push(`${e.id} 回归门禁红灯：${res.detail}`);
        else passed.push(`${e.id}: ${res.detail}`);
      } else {
        const r = spawnSync(e.gateCommand, { cwd: execCwd, shell: true, encoding: 'utf8', timeout: 120000 });
        if (r.error || r.status !== 0) {
          fails.push(`${e.id} 门禁命令失败（exit=${r.status}）：${e.gateCommand}\n${(r.stderr || r.stdout || '').trim()}`);
        } else {
          passed.push(`${e.id}: ${e.gateCommand} → exit 0`);
        }
      }
    }
  }
  return { exists: true, entries, passed, fails };
}

// ── DoneGate 自身 E01–E06 真实回归门禁（把沙箱实测暴露的坑永久锁死） ──
const BUILTIN_GATES = {
  E01() {
    if (!existsSync(join(ROOT, 'skill/check-cards.mjs')) && !existsSync(join(ROOT, '设计'))) {
      return { ok: true, detail: '公开运行版已剥离内部单卡与设计原稿，母仓构建期已核验' };
    }
    const tmp = mkdtempSync(join(tmpdir(), 'dg-esc-e01-'));
    try {
      for (const dir of ['donegate', 'donegate-judge', 'donegate-forge', '设计', 'tools', '参考']) {
        if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(tmp, dir), { recursive: true });
      }
      mkdirSync(join(tmp, 'skill'), { recursive: true });
      for (const f of ['check-cards.mjs', 'check-skills.mjs', 'io.mjs', '10-规格缺口定论（技能版）.md']) {
        cpSync(join(ROOT, 'skill', f), join(tmp, 'skill', f));
      }
      for (const s of ['donegate/SKILL.md', 'donegate-judge/SKILL.md', 'donegate-forge/SKILL.md']) {
        const p = join(tmp, s);
        const crlf = readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n');
        writeFileSync(p, crlf, 'utf8');
      }
      const r1 = spawnSync(process.execPath, [join(tmp, 'skill/check-cards.mjs')], { cwd: tmp, encoding: 'utf8' });
      const r2 = spawnSync(process.execPath, [join(tmp, 'skill/check-skills.mjs'), '--root', tmp], { cwd: tmp, encoding: 'utf8' });
      if (r1.status !== 0) return { ok: false, detail: `CRLF 环境下 check-cards.mjs 退出码 ${r1.status}：\n${r1.stdout}${r1.stderr}` };
      if (r2.status !== 0) return { ok: false, detail: `CRLF 环境下 check-skills.mjs 退出码 ${r2.status}` };
      // 负样本：破坏首行 --- 必须真的拦住（退 1）
      writeFileSync(join(tmp, 'donegate/SKILL.md'), 'broken\r\nname: donegate\r\n', 'utf8');
      const rBad = spawnSync(process.execPath, [join(tmp, 'skill/check-cards.mjs')], { cwd: tmp, encoding: 'utf8' });
      if (rBad.status !== 1) return { ok: false, detail: `坏 frontmatter 负样本未退 1（got ${rBad.status}）` };
      return { ok: true, detail: 'CRLF 正样本双绿 + 坏 frontmatter 负样本必红' };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
  E02() {
    const adpDir = join(ROOT, 'skill', 'adapters');
    const bad = [];
    for (const f of readdirSync(adpDir).filter((x) => x.endsWith('.mjs'))) {
      const txt = readFileSync(join(adpDir, f), 'utf8');
      const m = txt.match(/arg\(\s*['"]--target['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      if (m && m[1] !== '.') bad.push(`${f} 默认 --target 为 '${m[1]}'`);
    }
    if (bad.length) return { ok: false, detail: bad.join('；') };
    return { ok: true, detail: '全部适配器默认 --target 均不硬编码内部目录' };
  },
  E03() {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-esc-e03-'));
    try {
      dispatchCommand(['init', '.'], tmp);
      writeFileSync(join(tmp, '.gitignore'), '.donegate/\n');
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src/m.mjs'), 'export const add = (a, b) => a + b;\n');
      dispatchCommand(['contract', 'new', 'c1', '--title', 'add', '--scope', 'src/m.mjs'], tmp);
      const cp = join(tmp, 'contracts/c1/contract.json');
      const c = JSON.parse(readFileSync(cp, 'utf8'));
      c.why = 'test';
      c.obligations = [{
        id: 'o1', kind: 'command', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 },
        required: true, claim: 'ok', observable: 'exit 0', scope: 'src/m.mjs', inputClasses: ['正常'], servesSuccessCriterion: 's'
      }];
      writeFileSync(cp, JSON.stringify(c, null, 2));
      spawnSync('git', ['-C', tmp, 'init', '-q']);
      spawnSync('git', ['-C', tmp, 'config', 'user.email', 't@local']);
      spawnSync('git', ['-C', tmp, 'config', 'user.name', 'T']);
      spawnSync('git', ['-C', tmp, 'add', '.']);
      spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
      dispatchCommand(['contract', 'freeze', 'c1', '--by', '业主'], tmp);
      const rTeeth = dispatchCommand(['teeth', 'c1', 'o1'], tmp);
      if (rTeeth.exitCode !== 3 || !/contract freeze/.test(rTeeth.stderr || '')) {
        return { ok: false, detail: `缺 breakPatch 提示不清：${rTeeth.stderr}` };
      }
      const c2 = JSON.parse(readFileSync(cp, 'utf8'));
      c2.obligations[0].breakPatch = { file: 'src/m.mjs', from: 'a + b', to: 'a - b' };
      writeFileSync(cp, JSON.stringify(c2, null, 2));
      spawnSync('git', ['-C', tmp, 'add', '.']);
      spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add bp']);
      const rCheck = dispatchCommand(['check', 'c1'], tmp);
      if (rCheck.exitCode !== 1 || !/breakPatch/.test(rCheck.stdout + (rCheck.stderr || ''))) {
        return { ok: false, detail: `冻结后补 breakPatch 报错未点名 breakPatch：${rCheck.stdout}` };
      }
      return { ok: true, detail: 'teeth 缺 breakPatch 与冻结后补 breakPatch 均给出清晰提示' };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
  E04() {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-esc-e04-'));
    try {
      dispatchCommand(['init', '.'], tmp);
      const r = dispatchCommand(['handover'], tmp);
      if (r.exitCode !== 0) return { ok: false, detail: `外部项目 handover 失败：${r.stderr}` };
      const ho = readFileSync(join(tmp, 'HANDOVER.md'), 'utf8');
      if (/\bnode\s+runner\/donegate\.mjs\b/.test(ho)) {
        return { ok: false, detail: '外部项目 HANDOVER.md 仍写出悬空的 node runner/donegate.mjs' };
      }
      if (!ho.includes('donegate.mjs')) return { ok: false, detail: 'HANDOVER.md 缺 donegate.mjs 运行命令' };
      return { ok: true, detail: '外部项目 HANDOVER.md 自动解析真实 donegate.mjs 路径' };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
  E05() {
    const src = readFileSync(join(ROOT, 'skill/adapters/srclight-fresh.mjs'), 'utf8');
    if (/\[\s*['"]status['"]\s*,\s*['"]--root['"]/.test(src)) {
      return { ok: false, detail: 'srclight-fresh.mjs 仍向 srclight status 传递无效参数 --root' };
    }
    return { ok: true, detail: 'srclight-fresh.mjs 不再传递无效 --root 参数' };
  },
  E06() {
    const src = readFileSync(join(ROOT, 'skill/adapters/codegraph-impact.mjs'), 'utf8');
    if (!/codegraph sync/.test(src.slice(src.indexOf('index.state'), src.indexOf('index.state') + 260))) {
      return { ok: false, detail: 'codegraph-impact.mjs 索引未完成提示缺少 codegraph sync' };
    }
    return { ok: true, detail: 'codegraph-impact.mjs 明确提示 codegraph init + codegraph sync' };
  },
  E07() {
    const targets = [];
    for (const d of ['runner', 'tools', 'skill/adapters']) {
      if (existsSync(join(ROOT, d))) targets.push(...walkByExt(join(ROOT, d), ['.mjs']));
    }
    for (const f of readdirSync(join(ROOT, 'skill'), { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.mjs')) continue;
      if (f.name.startsWith('pilot-') || f.name.endsWith('-fixtures.mjs')) continue;
      targets.push(join(ROOT, 'skill', f.name));
    }
    const hits = scanHardcodedPaths(targets, ROOT);
    if (hits.length) return { ok: false, detail: `发现个人/机器硬编码路径：\n    ` + hits.join('\n    ') };
    return { ok: true, detail: `${targets.length} 份可执行代码零个人/机器路径硬编码` };
  },
  E08() {
    const hasBuilders = existsSync(join(ROOT, 'skill/build-public.mjs')) && existsSync(join(ROOT, 'skill/build-dist.mjs'));
    const verifyShippedDir = (dir, label) => {
      const sk = readFileSync(join(dir, 'donegate/SKILL.md'), 'utf8');
      if (/^node\s+"?skill\/check-plan\.mjs"?/m.test(sk)) {
        return `${label}: donegate/SKILL.md 仍指示用户跑不在包里的 skill/check-plan.mjs`;
      }
      for (const f of walkByExt(dir, ['.md'])) {
        if (relative(dir, f).split(sep)[0].startsWith('.')) continue;
        const t = readFileSync(f, 'utf8');
        if (t.includes('`标签（调研/评审材料')) return `${label}: ${relative(dir, f)} 反引号内链接示例被误降级`;
        for (const m of t.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const ls = t.lastIndexOf('\n', m.index) + 1;
          if ((t.slice(ls, m.index).match(/`/g) || []).length % 2 === 1) continue;
          const u = m[1].replace(/^<(.*)>$/, '$1');
          if (/^(https?:|#|mailto:)/.test(u)) continue;
          if (!existsSync(resolve(dirname(f), u.replace(/#.*$/, '')))) {
            return `${label}: ${relative(dir, f)} 存在死链 ${m[1]}`;
          }
        }
      }
      return null;
    };

    if (!hasBuilders) {
      const err = verifyShippedDir(ROOT, '公开包');
      return err ? { ok: false, detail: err } : { ok: true, detail: '公开包链接、反引号示例与 SKILL.md 自检命令均自洽' };
    }

    const tmpPub = mkdtempSync(join(tmpdir(), 'dg-esc-e08p-'));
    const tmpDist = mkdtempSync(join(tmpdir(), 'dg-esc-e08d-'));
    try {
      const rPub = spawnSync(process.execPath, [join(ROOT, 'skill/build-public.mjs'), '--out', tmpPub], { cwd: ROOT, encoding: 'utf8' });
      if (rPub.status !== 0) return { ok: false, detail: `build-public 失败：\n${rPub.stdout}${rPub.stderr}` };
      const errPub = verifyShippedDir(tmpPub, 'public产物');
      if (errPub) return { ok: false, detail: errPub };

      const rDist = spawnSync(process.execPath, [join(ROOT, 'skill/build-dist.mjs'), '--out', tmpDist], { cwd: ROOT, encoding: 'utf8' });
      if (rDist.status !== 0) return { ok: false, detail: `build-dist 失败：\n${rDist.stdout}${rDist.stderr}` };
      const errDist = verifyShippedDir(tmpDist, 'dist产物');
      if (errDist) return { ok: false, detail: errDist };
      return { ok: true, detail: 'build-public 与 build-dist 双产物均过空格链接/反引号/README先后序/自检命令门禁' };
    } finally {
      rmSync(tmpPub, { recursive: true, force: true });
      rmSync(tmpDist, { recursive: true, force: true });
    }
  }
};

// ── 个人/机器绝对路径硬编码扫描（工程级口径：区分 OS 系统兜底与个人绝对路径） ──
// 允许：import.meta.url 相对解析、homedir()/tmpdir()、process.cwd()、以及标准系统根兜底（如 SystemRoot 指向的 Windows 系统目录）。
// 禁止：盘符硬编码工作区路径、/Users/<name>、/home/<name>、作者用户名/仓名硬编码。
const CODE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs'];
const WIN_DRIVE_RE = /\b[A-Za-z]:(?:\\\\|\\|\/)[^\s'"`)]+/g;
const UNIX_HOME_RE = /(?:^|['"`(\s])(\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s'"`)]*)?)/g;

export function scanHardcodedPaths(files, baseDir) {
  const hits = [];
  for (const f of files) {
    const rel = relative(baseDir, f).split(sep).join('/');
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\/\/\s*portable-ok|#\s*portable-ok/.test(line)) continue;
      // 跳过纯 URL（如 https://... 或 file://...）
      const cleanLine = line.replace(/(?:https?|file):\/\/\S+/g, '');
      for (const m of cleanLine.matchAll(WIN_DRIVE_RE)) {
        const val = m[0];
        // 允许标准 OS 系统根目录兜底（如 SystemRoot || 'C:\\Windows'）
        if (/^[Cc]:(?:\\\\|\\|\/)Windows$/i.test(val) && /SystemRoot/i.test(line)) continue;
        hits.push(`${rel}:${i + 1} 含 Windows 绝对路径硬编码 ${val}`);
      }
      for (const m of cleanLine.matchAll(UNIX_HOME_RE)) {
        hits.push(`${rel}:${i + 1} 含本机家目录硬编码 ${m[1]}`);
      }
    }
  }
  return hits;
}

function collectProjectCode(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.donegate' || e.name === 'dist' || e.name === 'build') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (CODE_EXTS.some((ext) => e.name.endsWith(ext))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function printReportTemplate() {
  const pkgVer = existsSync(join(ROOT, 'VERSION')) ? readFileSync(join(ROOT, 'VERSION'), 'utf8').trim() : 'unknown';
  const symptom = arg('--symptom', '（请填写：当时所有门禁都绿了，但实际遇到了什么 bug / 报错）');
  const whyMissed = arg('--why-missed', '（请填写：为什么当时没被拦住？例如跨平台换行、默认参数、漏网场景）');
  const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  const ghReady = ghCheck.status === 0;

  console.log('=== DoneGate 漏网问题反馈草稿（脱敏模板） ===\n');
  console.log(`仓库：${REPO_URL}/issues/new`);
  console.log(`环境：DoneGate ${pkgVer} | Node ${process.version} | OS ${process.platform} ${process.arch}`);
  console.log('\n建议标题：');
  console.log('  [Escape] <一句话描述：全绿之后仍漏出了什么问题>');
  console.log('\n建议正文（复制即用，已不含你的项目业务代码）：');
  console.log('```markdown');
  console.log(`### 1. 遇到了什么现象\n${symptom}\n`);
  console.log(`### 2. 当时哪些门禁是绿的、为什么没拦住\n${whyMissed}\n`);
  console.log(`### 3. 最小复现步骤\n1. ...\n2. ...\n`);
  console.log(`### 4. 希望补上什么门禁\n（如果有根因或单条检测思路，欢迎一起贴上）\n`);
  console.log(`### 环境信息\n- DoneGate: ${pkgVer}\n- Node: ${process.version}\n- OS: ${process.platform} (${process.arch})`);
  console.log('```');
  console.log('');
  if (ghReady) {
    console.log('本机 `gh` CLI 已登录 GitHub。经你确认后，Agent 可直接运行：');
    console.log('  gh issue create --repo q862877400-ux/DoneGate --title "..." --body "..."');
  } else {
    console.log(`直接打开浏览器提交即可：${REPO_URL}/issues/new`);
  }
  console.log(`\n${COMMUNITY_MOTTO}`);
}

function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-esc-red-'));
  try {
    const badPath = join(tmp, 'bad-escapes.jsonl');
    writeFileSync(badPath, JSON.stringify({ id: 'E-BAD', date: '2026-11-20', symptom: '全绿后还是挂了', whyMissed: '未测', rootCause: '', scopeFix: 'todo', gateCommand: '' }) + '\n');
    const r1 = auditEscapesFile(badPath, tmp);
    if (r1.fails.length === 0) { console.error('FAIL: 缺 rootCause/gateCommand 的坏记录竟然放过了'); process.exit(1); }

    const failGatePath = join(tmp, 'fail-gate.jsonl');
    writeFileSync(failGatePath, JSON.stringify({
      id: 'E-FAILGATE', date: '2026-11-20', symptom: '计算错误', whyMissed: '无单测',
      rootCause: '边界减一错', scopeFix: '全仓核查 3 处索引减法', gateCommand: 'node -e "process.exit(1)"'
    }) + '\n');
    const r2 = auditEscapesFile(failGatePath, tmp);
    if (r2.fails.length === 0) { console.error('FAIL: 门禁命令退 1 的假记录竟然放过了'); process.exit(1); }

    const badCode = join(tmp, 'src_bad.mjs');
    const badPathLiteral = ['C:', 'Users', 'Someone', 'secret'].join('\\\\');
    writeFileSync(badCode, `export const p = "${badPathLiteral}";\n`);
    const r3 = scanHardcodedPaths([badCode], tmp);
    if (r3.length === 0) { console.error('FAIL: 代码里硬编码个人盘符路径竟然放过了'); process.exit(1); }

    const sysFallback = join(tmp, 'src_sys.mjs');
    const winRootLiteral = ['C:', 'Windows'].join('\\\\');
    writeFileSync(sysFallback, `export const w = process.env.SystemRoot || "${winRootLiteral}";\n`);
    const r4 = scanHardcodedPaths([sysFallback], tmp);
    if (r4.length !== 0) { console.error('FAIL: 合法 SystemRoot 系统兜底被误报：' + r4.join('; ')); process.exit(1); }

    // 负样本 4：自定义报喜不带真凭据、冒充 100% 进度条、或手改 notes.jsonl 必被抓
    const nDir = join(tmp, 'note-proj');
    mkdirSync(join(nDir, '.donegate'), { recursive: true });
    const rEmptyGood = appendProgressNote(nDir, { kind: 'good', stage: 2, title: '已完成真机实测' });
    if (rEmptyGood.ok) { console.error('FAIL: 空口报喜竟然放过了'); process.exit(1); }
    const rSpoof = appendProgressNote(nDir, { kind: 'worry', stage: 2, title: '总进度 100% 全部通关' });
    if (rSpoof.ok || rSpoof.exitCode !== 2) { console.error('FAIL: 冒充 100%/通关词竟然没退 2'); process.exit(1); }
    writeFileSync(join(nDir, '.donegate/notes.jsonl'), JSON.stringify({ kind: 'good', stage: 2, title: '伪造完成', verifyCmd: 'echo ok', exitCode: 0 }) + '\n');
    const rTamperNote = verifyProjectNotes(nDir);
    if (rTamperNote.ok || rTamperNote.invalid.length === 0) { console.error('FAIL: 绕过脚本手写 notes.jsonl 竟然放过了'); process.exit(1); }

    console.log('  ✓ 负样本 1：缺根因/占位词/缺门禁命令的记录被拒（' + r1.fails.length + ' 项报错）');
    console.log('  ✓ 负样本 2：自建门禁命令退 1 被拒');
    console.log('  ✓ 负样本 3：代码里个人绝对路径硬编码被抓（' + r3[0] + '），合法 SystemRoot 兜底放行');
    console.log('  ✓ 负样本 4：空口报喜拒收 + 冒充100%/通关词退 2 + 手改 notes.jsonl 封印校验必红');
    console.log('RESULT: PASS check-escapes 负样本自检有牙');
    process.exit(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (has('--red-self-test')) {
  runRedSelfTest();
}

if (has('--report-template')) {
  printReportTemplate();
  process.exit(0);
}

if (has('--self-check')) {
  const suites = [
    ['tools/check-package.mjs', []],
    ['tools/verify-spec.mjs', []],
    ['tools/check-rot.mjs', []],
    ['skill/check-skills.mjs', ['--root', ROOT]],
    ['skill/check-cards.mjs', []],
    ['skill/check-reviewpack.mjs', []],
    ['skill/check-declarations.mjs', []],
    ['skill/check-brick-liveness.mjs', []],
    ['skill/check-forge-cards.mjs', []],
    ['skill/check-brick-capabilities.mjs', []],
    ['skill/check-decisions.mjs', []],
    ['skill/check-ai-habits.mjs', ['--red-self-test']],
    ['skill/check-commit-hygiene.mjs', ['--red-self-test']],
    ['skill/check-module-integrity.mjs', ['--red-self-test']],
    ['skill/install-hooks.mjs', ['--red-self-test']],
    ['skill/new-adapter.mjs', ['--self-test']],
    ['runner/atlas-fixtures.mjs', []],
    ['skill/gen-feature-overview.mjs', ['--check']],
    ['skill/check-escapes.mjs', []],
    ['skill/check-escapes.mjs', ['--red-self-test']],
    ['runner/donegate.mjs', ['--help']]
  ];
  let bad = 0;
  console.log('=== DoneGate 自我核查（先扫自己，全绿才准提交生效） ===');
  const isFullMotherRepo = existsSync(join(ROOT, '设计')) && existsSync(join(ROOT, 'decisions'));
  const leanOptional = new Set([
    'tools/check-package.mjs', 'tools/verify-spec.mjs', 'tools/check-rot.mjs',
    'skill/check-cards.mjs', 'skill/check-brick-capabilities.mjs', 'skill/check-decisions.mjs',
    'skill/check-ai-habits.mjs', 'skill/gen-feature-overview.mjs'
  ]);
  for (const [script, sArgs] of suites) {
    const abs = join(ROOT, script);
    if (!existsSync(abs)) {
      if (!isFullMotherRepo && leanOptional.has(script)) continue;
      console.log(`  ✗ 缺核心门禁脚本：${script}`);
      bad++;
      continue;
    }
    const r = spawnSync(process.execPath, [abs, ...sArgs], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.error || r.status !== 0) {
      bad++;
      console.log(`  ✗ ${script} ${sArgs.join(' ')} → exit ${r.status}`);
      const detail = (r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-5).join('\n    ');
      if (detail) console.log('    ' + detail);
    } else {
      console.log(`  ✓ ${script} ${sArgs.join(' ')} → exit 0`);
    }
  }
  const projOpt = arg('--project');
  if (projOpt) {
    const projRoot = resolve(projOpt);
    const rProj = spawnSync(process.execPath, [join(ROOT, 'skill/check-escapes.mjs'), '--project', projRoot], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (rProj.error || rProj.status !== 0) {
      bad++;
      console.log(`  ✗ 用户项目漏网与硬编码核查失败 (${projRoot}) → exit ${rProj.status}`);
      console.log((rProj.stderr || rProj.stdout || '').trim());
    } else {
      console.log(`  ✓ 用户项目漏网与硬编码核查通过 (${projRoot})`);
    }
    if (existsSync(join(projRoot, 'contracts'))) {
      const rSt = dispatchCommand(['status'], projRoot);
      if (rSt.exitCode !== 0 && rSt.exitCode !== 1) {
        bad++;
        console.log(`  ✗ 用户项目 donegate status 事故态退 ${rSt.exitCode}：${rSt.stderr || rSt.stdout}`);
      } else {
        console.log(`  ✓ 用户项目 donegate status 可正常计算（exit ${rSt.exitCode}）`);
      }
    }
  }
  if (bad > 0) {
    console.error(`RESULT: FAIL 自我核查 ${bad} 项未通过——禁止提交生效，请先修到全绿！`);
    if (projOpt && existsSync(join(resolve(projOpt), 'INTENT.md'))) {
      console.error('\n' + renderWorryBlock(resolve(projOpt), {
        exitCode: 1, stage: 4, stageTitle: '提交前自我核查（安全拦截）',
        title: `自我核查有 ${bad} 项未通过，已拦截提交`,
        reason: '新增门禁或项目改动触发了回归失败/硬编码告警',
        action: '按上面 ❌ 报错修到全绿，或回滚本次改动后再提交'
      }));
    }
    process.exit(1);
  }
  const targetCleanupRoot = projOpt ? resolve(projOpt) : ROOT;
  const scCleaned = cleanScratchDir(targetCleanupRoot);
  if (scCleaned.cleaned > 0) console.log(`  ✓ 已自动清空 .donegate/scratch/ 一次性草稿 ${scCleaned.cleaned} 项`);
  console.log('RESULT: PASS 自我核查全绿，可安全提交生效');
  if (projOpt && existsSync(join(resolve(projOpt), 'INTENT.md')) && existsSync(join(resolve(projOpt), '.donegate', 'chain.jsonl'))) {
    console.log('\n' + renderProgressBlock(resolve(projOpt), { headline: '✅ 自我核查全绿（可安全提交生效） · 总进度 {{PCT}}' }));
  }
  process.exit(0);
}

if (has('--record')) {
  const proj = resolve(arg('--project', process.cwd()));
  const entry = {
    id: arg('--id', ''),
    date: new Date().toISOString().slice(0, 10),
    symptom: arg('--symptom', ''),
    whyMissed: arg('--why-missed', ''),
    rootCause: arg('--root-cause', ''),
    scopeFix: arg('--scope-fix', ''),
    gateCommand: arg('--gate', ''),
    status: 'gated'
  };
  const errs = validateEscapeEntry(entry, 1);
  if (errs.length) {
    console.error('拒绝登记漏网问题：\n  - ' + errs.join('\n  - '));
    process.exit(1);
  }
  // 写入前先试跑该门禁命令：防止小模型写了一条本身就崩/过不了的假门禁
  const preRun = spawnSync(entry.gateCommand, { cwd: proj, shell: true, encoding: 'utf8', timeout: 120000 });
  if (preRun.error || preRun.status !== 0) {
    console.error(`拒绝登记：新门禁命令试跑失败（exit=${preRun.status}），请先确认修复已生效且门禁本身可跑通：\n  ${entry.gateCommand}`);
    if (preRun.stderr || preRun.stdout) console.error((preRun.stderr || preRun.stdout).trim());
    process.exit(1);
  }
  const dir = join(proj, '.donegate');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'escapes.jsonl');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } });
    if (existing.includes(entry.id)) {
      console.error('id 已存在，禁止覆盖或重复登记：' + entry.id);
      process.exit(1);
    }
  }
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  console.log(`已登记漏网问题 ${entry.id} 到 ${file}（新门禁试跑 exit 0）`);
  if (existsSync(join(proj, 'INTENT.md')) && existsSync(join(proj, '.donegate', 'chain.jsonl'))) {
    console.log('\n' + renderProgressBlock(proj, { headline: `✅ 漏网问题 ${entry.id} 已登记并过试跑 · 总进度 {{PCT}}` }));
  }
  console.log(`提交生效前请务必先跑自我核查：node "${join(ROOT, 'skill/check-escapes.mjs')}" --self-check --project "${proj}"`);
  process.exit(0);
}

// ── 主模式：核验用户项目 or 核验 DoneGate 自身 ──
const projArg = arg('--project');
if (projArg) {
  const projRoot = resolve(projArg);
  const file = join(projRoot, '.donegate', 'escapes.jsonl');
  const res = auditEscapesFile(file, projRoot, { onlyId: arg('--only') });
  const pathHits = scanHardcodedPaths(collectProjectCode(projRoot), projRoot);
  const notesChk = verifyProjectNotes(projRoot, { rerunCmds: true });
  const noteFails = notesChk.invalid.map((b) => `自定义进度条目第 ${b.lineNo} 行「${b.title}」防撒谎门禁失败：${b.reason}`);
  const totalFails = [...res.fails, ...pathHits, ...noteFails];

  if (!res.exists && !notesChk.exists && pathHits.length === 0) {
    console.log(`未发现 ${file}（暂无登记的漏网之鱼），且项目代码零个人路径硬编码。`);
    console.log('若全绿后仍发现 bug，可用 --record 记下根因、同类排查与独立门禁，形成自我迭代闭环。');
    console.log(COMMUNITY_MOTTO);
    process.exit(0);
  }
  console.log(`核验项目漏网门禁与可移植性：${projRoot}（漏网记录 ${res.entries.length} 条）`);
  for (const p of res.passed) console.log('  ✓ ' + p);
  if (pathHits.length === 0) console.log('  ✓ 项目源码零个人/本机绝对路径硬编码');
  for (const f of totalFails) console.log('  ✗ ' + f);
  if (totalFails.length > 0) {
    console.log('RESULT: FAIL 存在漏网门禁缺口、未通过项或绝对路径硬编码');
    process.exit(1);
  }
  console.log('RESULT: PASS 所有已登记漏网问题均有根因修复与在跑门禁，且代码零个人路径硬编码');
  console.log(`\n提示：若这次漏网源于 DoneGate 自身盲区，欢迎提 Issue：${REPO_URL}/issues/new`);
  console.log(COMMUNITY_MOTTO);
  process.exit(0);
}

const ownFile = join(ROOT, 'escapes.jsonl');
if (!existsSync(ownFile)) {
  console.error('缺少 DoneGate 漏网台账：' + ownFile);
  process.exit(3);
}
const onlyId = arg('--only');
const res = auditEscapesFile(ownFile, ROOT, { onlyId, builtinGates: BUILTIN_GATES });
console.log(`DoneGate 漏网回归门禁核验（${onlyId ? onlyId : `${res.entries.length} 条`}）：`);
for (const p of res.passed) console.log('  ✓ ' + p);
for (const f of res.fails) console.log('  ✗ ' + f);
if (res.fails.length > 0) {
  console.log('RESULT: FAIL 存在漏网回归门禁未通过');
  process.exit(1);
}
console.log(`RESULT: PASS ${res.passed.length} 条历史漏网问题回归门禁全绿`);
console.log(`\n${COMMUNITY_MOTTO}（反馈入口：${REPO_URL}/issues/new）`);
process.exit(0);
