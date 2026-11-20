// 砂浆适配器 · Maestro 移动端/跨端模拟器 UI 流程观测（Mortar Protocol v1.1 · role=hard，零状态/禁词键）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shaBytes = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (code, msg) => { console.error(msg); process.exit(code); };
const argv = process.argv.slice(2);
if (argv.includes('--stage') || argv.includes('--checked-by')) fail(2, '协议违规：禁止传入 --stage 或 --checked-by');
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const dryRun = argv.includes('--dry-run');
const rootDir = resolve(arg('--root', process.cwd()));
const registryId = arg('--registry-id', 'maestro@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'maestro') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32'
    ? join(process.env.USERPROFILE || homedir(), 'maestro', 'bin', 'maestro.bat')
    : join(homedir(), '.maestro', 'bin', 'maestro');
  return existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'maestro'));
if (!binPath) fail(3, 'maestro 不在 PATH 或不可用');

const runCmd = (args) => {
  const env = { ...process.env, MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' };
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(binPath)) {
    return spawnSync('cmd.exe', ['/d', '/c', binPath, ...args], { cwd: rootDir, env, encoding: 'utf8', timeout: 120000 });
  }
  return spawnSync(binPath, args, { cwd: rootDir, env, encoding: 'utf8', timeout: 120000 });
};
const verR = runCmd(['--version']);
if (verR.error || verR.status !== 0) fail(3, '无法运行 maestro --version');
const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 maestro 版本');
const toolVer = verMatch[1];

const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
let anchor = { head: null, worktreeHash: null, isDirty: false };
let headCommitSec = 0;
if (!dryRun) {
  const st = git(['status', '--porcelain']);
  if (st.status !== 0 || st.stdout.trim() !== '') fail(3, '脏树或非 git 仓库拒收退 3');
  anchor = { head: git(['rev-parse', 'HEAD']).stdout.trim(), worktreeHash: git(['rev-parse', 'HEAD^{tree}']).stdout.trim(), isDirty: false };
  const ct = git(['show', '-s', '--format=%ct', 'HEAD']);
  if (ct.status === 0) headCommitSec = Number(ct.stdout.trim()) || 0;
}

const rawOverride = arg('--raw-report');
let rawText;
let reportSource = '';
if (rawOverride) {
  const abs = resolve(rootDir, rawOverride);
  if (!existsSync(abs)) fail(3, 'raw-report 不存在：' + rawOverride);
  if (!dryRun && headCommitSec > 0 && statSync(abs).mtimeMs / 1000 < headCommitSec) {
    fail(3, '陈旧 Maestro 报告退 3（报告早于 HEAD 提交，须先重跑移动端流）');
  }
  try { rawText = readFileSync(abs, 'utf8'); } catch { fail(3, 'raw-report 不可读'); }
  reportSource = relative(rootDir, abs).replace(/\\/g, '/');
} else {
  const flowTarget = arg('--flows', existsSync(join(rootDir, '.maestro')) ? '.maestro' : (existsSync(join(rootDir, 'maestro')) ? 'maestro' : null));
  if (!flowTarget) fail(3, '未找到 .maestro/ 或 maestro/ 用例目录（可传 --flows 或 --raw-report）');
  const tmpOut = mkdtempSync(join(tmpdir(), 'maestro-out-'));
  try {
    const outXml = join(tmpOut, 'maestro-junit.xml');
    const r = runCmd(['test', '--no-ansi', '--format', 'JUNIT', '--output', outXml, flowTarget]);
    if (r.error || !existsSync(outXml)) fail(3, 'maestro test 执行失败或未产出 JUNIT 报告：' + (r.stderr || r.stdout));
    rawText = readFileSync(outXml, 'utf8');
    reportSource = flowTarget;
  } finally { rmSync(tmpOut, { recursive: true, force: true }); }
}

if (!rawText.trim()) fail(3, 'Maestro 报告内容为空');

let totalFlows = 0, failureCount = 0, errorCount = 0, skippedCount = 0;
const failingFlows = [];
if (rawText.trim().startsWith('{')) {
  let parsed;
  try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'Maestro JSON 报告截断或损坏：' + e.message); }
  if (!parsed || typeof parsed.totalFlows !== 'number') fail(3, 'Maestro JSON 报告缺少 totalFlows');
  totalFlows = parsed.totalFlows;
  failureCount = Number(parsed.failureCount || 0);
  errorCount = Number(parsed.errorCount || 0);
  skippedCount = Number(parsed.skippedCount || 0);
  if (Array.isArray(parsed.failingFlows)) failingFlows.push(...parsed.failingFlows.map(String));
} else {
  if (!/<testsuite\b/i.test(rawText)) fail(3, 'Maestro JUNIT XML 报告损坏（缺少 <testsuite>）');
  for (const m of rawText.matchAll(/<testsuite\b([^>]*)>/gi)) {
    const attrs = m[1];
    const num = (k) => { const am = attrs.match(new RegExp(`\\b${k}=["'](\\d+)["']`)); return am ? Number(am[1]) : 0; };
    totalFlows += num('tests');
    failureCount += num('failures');
    errorCount += num('errors');
    skippedCount += num('skipped');
  }
  for (const m of rawText.matchAll(/<testcase\b([^>]*[^/])>([\s\S]*?)<\/testcase>/gi)) {
    if (/<(?:failure|error)\b/i.test(m[2])) {
      const nm = m[1].match(/\bname=["']([^"']+)["']/);
      failingFlows.push(nm ? nm[1] : 'unnamed-flow');
    }
  }
}
if (totalFlows === 0) fail(3, 'Maestro 用例数为 0（防空跑退 3）');
const completedFlows = Math.max(0, totalFlows - failureCount - errorCount - skippedCount);

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/maestro/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawExt = rawText.trim().startsWith('{') ? 'json' : 'xml';
const rawPath = join(outDir, `raw-maestro.${rawExt}`), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(rawText, 'utf8');
const obsObj = {
  reportSource,
  totalFlows,
  completedFlows,
  failureCount,
  errorCount,
  skippedCount,
  failingFlows
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'maestro-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'maestro-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `移动端 UI 流共 ${totalFlows} 条（completed=${completedFlows}, failures=${failureCount}, errors=${errorCount}），明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: [],
  degradedTo: '人工在 Android 模拟器与 iOS 真机逐条点击验证 App 界面流'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（flows=${totalFlows}, failures=${failureCount}）`);
process.exit(0);
