// M-02 最小内核试水：判据运行器（**不是插件版**，只有一件事——退出码直读 + 挡模型自述）
// 用法：
//   node runner/run-criterion.mjs <contract.json> [--report <out.json>] [--compare <模型自述的report.json>]
// 退出码（严格照 设计/02-规格.md §八 四值）：
//   0 = 全部判据通过        1 = 有判据未通过
//   2 = 确定出了问题        3 = 无法判断（命令跑不起来/超时/契约读不出）
//
// 它只做三件被读数支持的事（08 §54）：
//   1. 退出码由子进程直读，落进 report.json——**不看、不采信任何模型自述的退出码**
//   2. `--compare` 拿模型自述的退出码与实测比，对不上即事故（exit 2）——这条能红（self-test 第 4 例）
//   3. 命令原文原样落盘，便于复核「它到底跑的是什么」
// 它**不做**：状态判定、六栏总账、证据三件套（那些是 M-01/M-03/M-06，未获授权）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, delimiter, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../skill/hash.mjs';
import { validateContractSchema } from '../skill/schema-lite.mjs';

// 「命令跑不起来」与「命令跑了但失败」在 §八 里是两个退出码（3 与 1）。
// shell 下两者都只是「非 0」，所以先自己做一次可执行性预检——预检不过 = 3，不猜。
const 内置命令 = new Set(['echo', 'cd', 'set', 'type', 'dir']);
const 首词 = (cmd) => { const m = cmd.trim().match(/^"([^"]+)"|^(\S+)/); return (m && (m[1] || m[2])) || ''; };
const 可执行 = (tok) => {
  if (!tok) return false;
  if (内置命令.has(tok.toLowerCase())) return true;
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  if (isAbsolute(tok) || /^[A-Za-z]:[\\/]/.test(tok) || /[\\/]/.test(tok)) {
    const base = /^[A-Za-z]:[\\/]/.test(tok) && !isAbsolute(tok) ? tok : resolve(process.cwd(), tok);
    return ['', ...exts].some((e) => existsSync(base + e));
  }
  const pathRaw = process.env.PATH || process.env.Path || '';
  for (const p of pathRaw.split(delimiter)) {
    if (!p) continue;
    for (const e of ['', ...exts]) { if (existsSync(join(p, tok + e))) return true; }
  }
  return false;
};

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--report', '--compare', '--evidence-dir'].includes(argv[i - 1]));
const CONTRACT = positional[0] ? resolve(positional[0]) : null;
const REPORT = flag('--report') ? resolve(flag('--report')) : null;
const COMPARE = flag('--compare') ? resolve(flag('--compare')) : null;
const EVIDENCE_DIR = flag('--evidence-dir') ? resolve(flag('--evidence-dir')) : null;
const GATE4 = argv.includes('--gate4');

function collectGitAnchor(cwd) {
  const inside = spawnSync('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') {
    return { head: null, worktreeHash: null, isDirty: null };
  }
  const headR = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const stR = spawnSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' });
  const wtR = spawnSync('git', ['-C', cwd, 'write-tree'], { encoding: 'utf8' });
  return {
    head: headR.status === 0 ? headR.stdout.trim() : null,
    worktreeHash: wtR.status === 0 ? wtR.stdout.trim() : null,
    isDirty: stR.status === 0 ? stR.stdout.trim().length > 0 : null
  };
}

if (!CONTRACT || !existsSync(CONTRACT)) { console.error('契约读不出来：' + CONTRACT); process.exit(3); }
let contract;
try { contract = JSON.parse(readFileSync(CONTRACT, 'utf8')); } catch (e) { console.error('契约不是合法 JSON：' + e.message); process.exit(2); }
const schemaErrs = validateContractSchema(contract, { full: false });
if (schemaErrs.length > 0) {
  for (const se of schemaErrs) console.error('契约 schema 错误：' + se);
  console.log('\nRESULT: 事故——契约结构/类型不合法（§八 退 2）');
  process.exit(2);
}
const obligations = contract.obligations;
const anchor = collectGitAnchor(process.cwd());
if (GATE4 && anchor.isDirty !== false) {
  console.error('门 4 拒绝：工作区存在未提交改动或非 git 仓库（§8.2.2 脏树禁进门 4，退 3）');
  process.exit(3);
}

const startedAt = new Date().toISOString();
const contractRaw = readFileSync(CONTRACT);
let startRaw = null;
if (EVIDENCE_DIR) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const startObj = {
    contract: contract.id,
    contractPath: CONTRACT,
    criterion: obligations.map((o) => o.id).join(','),
    command: obligations.filter((o) => o.kind === 'command').map((o) => o.command).join(' ; '),
    run: { head: anchor.head, criteriaHash: sha256(contractRaw) },
    worktreeHash: anchor.worktreeHash,
    isDirty: anchor.isDirty,
    gate4Blocked: anchor.isDirty !== false,
    startedAt,
    runnerVersion: 'donegate-runner/4.0'
  };
  startRaw = JSON.stringify(startObj, null, 2);
  writeFileSync(join(EVIDENCE_DIR, 'start.json'), startRaw);
}

const rows = [];
for (const o of obligations) {
  if (o.kind !== 'command') { rows.push({ id: o.id, kind: o.kind, skipped: '非命令型（human 判据由人执行，见门 5）' }); continue; }
  if (typeof o.command !== 'string' || !o.command.trim()) { rows.push({ id: o.id, error: 'command 为空' }); continue; }
  const exe = 首词(o.command);
  if (!可执行(exe)) {
    rows.push({ id: o.id, command: o.command, verdict: 'unknown', why: '命令跑不起来：' + exe + ' 不在 PATH 里也无法解析为绝对路径' });
    continue;
  }
  const t0 = Date.now();
  // shell:true 是刻意的：规格允许「单条命令」，而单条命令在 Windows 上带空格/引号时
  // 只有 shell 能正确解析。代价是包装层（pnpm/npm/npx）也可能被写进 command——
  // 那不是本内核负责拦的（M-02 的前提未复现，见 README），本内核只如实记录命令原文。
  const r = spawnSync(o.command, { shell: true, encoding: 'utf8', timeout: (o.timeoutSec || 600) * 1000 });
  const ms = Date.now() - t0;
  const row = {
    id: o.id,
    command: o.command,
    exitCode: r.status,
    signal: r.signal || null,
    spawnError: r.error ? (r.error.code || String(r.error.message)) : null,
    ms,
    stdoutSha256: sha256(r.stdout),
    stderrSha256: sha256(r.stderr),
    expectExitCode: o.expect && typeof o.expect.exitCode === 'number' ? o.expect.exitCode : null
  };
  if (row.spawnError || row.signal === 'SIGTERM') row.verdict = 'unknown';      // 跑不起来 / 超时
  else if (row.expectExitCode === null) row.verdict = 'unknown';                // 没有期望值，判断不了
  else if (row.exitCode !== row.expectExitCode) row.verdict = 'fail';
  else if (o.expect && o.expect.stdoutMatches !== undefined) {
    const trimmedOut = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    row.verdict = trimmedOut === o.expect.stdoutMatches ? 'pass' : 'fail';
  } else row.verdict = 'pass';
  rows.push(row);
}

// 与模型自述对账：只认实测，自述对不上就是事故（M-19 的机读落点）
const mismatches = [];
if (COMPARE) {
  if (!existsSync(COMPARE)) { console.error('自述 report 读不出来：' + COMPARE); process.exit(2); }
  let claimed;
  try { claimed = JSON.parse(readFileSync(COMPARE, 'utf8')); } catch (e) { console.error('自述 report 不是合法 JSON：' + e.message); process.exit(2); }
  const list = Array.isArray(claimed) ? claimed : (claimed.rows || claimed.results || []);
  for (const c of list) {
    const m = rows.find((x) => x.id === c.id);
    if (!m) { mismatches.push({ id: c.id, why: '自述里有、契约里没有' }); continue; }
    if (typeof c.exitCode === 'number' && c.exitCode !== m.exitCode) {
      mismatches.push({ id: c.id, why: '自述退出码 ' + c.exitCode + ' ≠ 实测 ' + m.exitCode });
    }
  }
}

const report = {
  at: new Date().toISOString(),
  contract: CONTRACT,
  contractId: contract.id || null,
  head: anchor.head,
  worktreeHash: anchor.worktreeHash,
  isDirty: anchor.isDirty,
  gate4Eligible: anchor.isDirty === false,
  ...(startRaw ? { hashStart: sha256(startRaw), startSha256: sha256(startRaw) } : {}),
  rows,
  mismatches,
  honesty: '退出码列全部来自子进程，本次运行没有采信任何模型自述值'
};
const reportRaw = JSON.stringify(report, null, 2);
if (REPORT) writeFileSync(REPORT, reportRaw);
if (EVIDENCE_DIR) writeFileSync(join(EVIDENCE_DIR, 'report.json'), reportRaw);
for (const r of rows) {
  console.log(JSON.stringify(r));
}
if (COMPARE) {
  console.log('\n== 与模型自述对账 ==');
  if (mismatches.length === 0) console.log('（无差异：自述与实测一致）');
  for (const m of mismatches) console.log('✗ ' + m.id + '：' + m.why);
}

const bad = rows.filter((r) => r.verdict === 'fail').length;
const unknown = rows.filter((r) => r.verdict === 'unknown' && !r.skipped).length;
const finalExit = mismatches.length > 0 ? 2 : bad > 0 ? 1 : unknown > 0 ? 3 : 0;
if (EVIDENCE_DIR) {
  writeFileSync(join(EVIDENCE_DIR, 'end.json'), JSON.stringify({
    result: finalExit === 0 ? 'success' : 'failure',
    exitCode: finalExit,
    hashReport: sha256(reportRaw),
    reportSha256: sha256(reportRaw),
    gate4Eligible: anchor.isDirty === false,
    endedAt: new Date().toISOString()
  }, null, 2));
}
if (mismatches.length > 0) { console.log('\nRESULT: 事故——自述与实测对不上（§八 退 2）'); process.exit(2); }
if (bad > 0) { console.log('\nRESULT: 有判据未通过 ' + bad + ' 条（§八 退 1）'); process.exit(1); }
if (unknown > 0) { console.log('\nRESULT: 无法判断 ' + unknown + ' 条（§八 退 3）'); process.exit(3); }
console.log('\nRESULT: 全部判据通过（§八 退 0）');
process.exit(0);
