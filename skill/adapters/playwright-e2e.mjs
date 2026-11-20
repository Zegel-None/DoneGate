// 砂浆适配器 · Playwright Web 真实浏览器端到端观测（Mortar Protocol v1.1 · role=hard，零状态/禁词键）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const registryId = arg('--registry-id', 'playwright@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'playwright') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

const binSpec = arg('--bin', 'playwright');
const runCmd = (args) => process.platform === 'win32' && !/[\\/]/.test(binSpec)
  ? spawnSync('cmd.exe', ['/d', '/c', binSpec, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 120000 })
  : spawnSync(binSpec, args, { cwd: rootDir, encoding: 'utf8', timeout: 120000 });
const verR = runCmd(['--version']);
if (verR.error || verR.status !== 0) fail(3, 'playwright 不可用：' + binSpec);
const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 playwright 版本');
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
    fail(3, '陈旧 Playwright 报告退 3（报告修改时间早于 HEAD 提交，须先重跑浏览器测试）');
  }
  try { rawText = readFileSync(abs, 'utf8'); } catch { fail(3, 'raw-report 不可读'); }
  reportSource = relative(rootDir, abs).replace(/\\/g, '/');
} else {
  const hasCfg = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some((f) => existsSync(join(rootDir, f)));
  if (hasCfg) {
    const r = runCmd(['test', '--reporter=json']);
    if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'playwright test 执行失败：' + (r.stderr || r.error?.message));
    rawText = r.stdout || '';
    reportSource = 'playwright-cli';
  } else {
    const cand = ['playwright-report/results.json', 'test-results.json', '.donegate/playwright-results.json']
      .map((p) => join(rootDir, p)).find((p) => existsSync(p));
    if (!cand) fail(3, '未找到 playwright.config.* 或 Playwright JSON 报告（请先运行测试产出 results.json 或传 --raw-report）');
    if (!dryRun && headCommitSec > 0 && statSync(cand).mtimeMs / 1000 < headCommitSec) {
      fail(3, '陈旧 Playwright 报告退 3（报告早于 HEAD 提交）');
    }
    rawText = readFileSync(cand, 'utf8');
    reportSource = relative(rootDir, cand).replace(/\\/g, '/');
  }
}

let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'Playwright 报告 JSON 截断或损坏：' + e.message); }
if (!parsed || typeof parsed !== 'object' || (!parsed.stats && !Array.isArray(parsed.suites))) {
  fail(3, 'Playwright 报告缺少 stats 或 suites 字段');
}

const stats = parsed.stats || {};
const expectedCount = Number(stats.expected || 0);
const unexpectedCount = Number(stats.unexpected || 0);
const flakyCount = Number(stats.flaky || 0);
const skippedCount = Number(stats.skipped || 0);
const totalSpecs = expectedCount + unexpectedCount + flakyCount + skippedCount;
if (totalSpecs === 0 && Array.isArray(parsed.suites) && parsed.suites.length === 0) {
  fail(3, 'Playwright 报告用例数为 0（防空跑退 3）');
}

const unexpectedSpecs = [];
function walkSuite(s) {
  for (const sp of (s.specs || [])) {
    if (sp.ok === false || (Array.isArray(sp.tests) && sp.tests.some((t) => t.status === 'unexpected'))) {
      unexpectedSpecs.push(String(sp.title || sp.id || 'unnamed'));
    }
  }
  for (const ch of (s.suites || [])) walkSuite(ch);
}
for (const s of (parsed.suites || [])) walkSuite(s);

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/playwright/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-playwright.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = {
  reportSource,
  totalSpecs,
  expectedCount,
  unexpectedCount,
  flakyCount,
  skippedCount,
  unexpectedSpecs
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'playwright-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'playwright-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `Web E2E 共 ${totalSpecs} 项（expected=${expectedCount}, unexpected=${unexpectedCount}, flaky=${flakyCount}），明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: flakyCount > 0 ? [`存在 ${flakyCount} 条 flaky 波动用例`] : [],
  degradedTo: '人工在桌面与移动端浏览器逐页点测全部交互路径与控制台报错'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（expected=${expectedCount}, unexpected=${unexpectedCount}）`);
process.exit(0);
