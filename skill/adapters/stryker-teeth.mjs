// 砂浆适配器 · Stryker 有牙观测（Mortar Protocol v1.1 · 目标 90-130 行，零第三方依赖）
// 诚实边界：只产出严格九字段 claim.json 与 observation.json，绝不输出 verdict/score/ratio/teeth；状态由核现算。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Pending'];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shaBytes = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (code, msg) => { console.error(msg); process.exit(code); };
const argv = process.argv.slice(2);
if (argv.includes('--stage') || argv.includes('--checked-by')) fail(2, '协议违规：禁止传入 --stage 或 --checked-by（仅从 registry 抄录）');
const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const dryRun = argv.includes('--dry-run');
const rootDir = resolve(arg('--root', process.cwd()));
const registryId = arg('--registry-id');
if (!registryId) fail(2, '缺少必填参数 --registry-id');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'adapters.registry.json 不可读或损坏：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'stryker') : null;
if (!entry) fail(2, '未在 adapters.registry.json 登记的 --registry-id：' + registryId);
if (entry.protocolVersion !== '1.1' || !Number.isInteger(entry.stage) || entry.stage < 1 || entry.stage > 7 || typeof entry.checkedBy !== 'string' || !/^[^/]+\/[^/]+$/.test(entry.checkedBy)) {
  fail(2, 'registry 条目协议版本或字段非法：' + registryId);
}

const pkgPath = resolve(arg('--stryker-pkg', join(REPO, 'node_modules/@stryker-mutator/core/package.json')));
let toolVer;
try { toolVer = JSON.parse(readFileSync(pkgPath, 'utf8')).version; } catch { fail(3, '无法读取 @stryker-mutator/core 版本：' + pkgPath); }
const semverOk = (v, range) => {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/), rm = String(range || '').match(/^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)\.(\d+)\.(\d+)$/);
  if (!m || !rm) return false;
  const cmp = (a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2];
  const cur = [+m[1], +m[2], +m[3]];
  return cmp(cur, [+rm[1], +rm[2], +rm[3]]) >= 0 && cmp(cur, [+rm[4], +rm[5], +rm[6]]) < 0;
};
if (!semverOk(toolVer, entry.testedToolRange)) fail(3, `Stryker 版本 ${toolVer} 超出 testedToolRange (${entry.testedToolRange})`);

const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
let anchor = { head: null, worktreeHash: null, isDirty: false };
let headSec = 0;
if (!dryRun) {
  const st = git(['status', '--porcelain']);
  if (st.status !== 0) fail(3, '工作区不是有效的 git 仓库，无法锚定');
  if (st.stdout.trim() !== '') fail(3, '工作区存在未提交改动（脏树拒收退 3，请先 commit 或 stash，调试请加 --dry-run）');
  const h = git(['rev-parse', 'HEAD']), wt = git(['rev-parse', 'HEAD^{tree}']), ct = git(['log', '-1', '--format=%ct']);
  if (h.status !== 0 || wt.status !== 0 || ct.status !== 0) fail(3, '读取 git HEAD/tree 失败');
  headSec = Number(ct.stdout.trim()) || 0;
  anchor = { head: h.stdout.trim(), worktreeHash: wt.stdout.trim(), isDirty: false };
}

const reportRel = arg('--report', 'reports/mutation/mutation.json');
const reportAbs = resolve(rootDir, reportRel);
if (!existsSync(reportAbs)) fail(3, 'Stryker 报告不存在：' + reportRel);
let repStat, repBuf;
try { repStat = statSync(reportAbs); repBuf = readFileSync(reportAbs); } catch (e) { fail(3, 'Stryker 报告不可读：' + e.message); }
if (!dryRun && headSec > 0 && repStat.mtimeMs <= headSec * 1000) {
  fail(3, `陈旧报告退 3：${reportRel} mtime 晚于限制不成立（mtime <= HEAD 提交时间）`);
}
let repJson;
try { repJson = JSON.parse(repBuf.toString('utf8')); } catch (e) { fail(3, 'Stryker 报告 JSON 截断或损坏：' + e.message); }
if (!repJson || typeof repJson !== 'object' || !repJson.files || typeof repJson.files !== 'object' || Array.isArray(repJson.files)) {
  fail(3, 'Stryker 报告缺少必填顶层字段 files');
}

const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
const inputs = [], subjects = [], unresolved = [];
for (const fp of Object.keys(repJson.files).sort()) {
  const norm = fp.replace(/\\/g, '/');
  const srcAbs = resolve(rootDir, norm);
  if (!existsSync(srcAbs)) fail(3, '报告引用的源码文件不存在：' + norm);
  let srcBuf;
  try { srcBuf = readFileSync(srcAbs); } catch (e) { fail(3, '源码文件不可读：' + norm); }
  inputs.push({ path: norm, sha256: shaBytes(srcBuf) });
  subjects.push(norm);
  const fObj = repJson.files[fp];
  if (!fObj || !Array.isArray(fObj.mutants)) fail(3, `Stryker 报告缺少 ${norm} 的 mutants 数组`);
  for (const m of fObj.mutants) {
    if (!m || !STATES.includes(m.status)) fail(2, `未知 Stryker 变异体状态：mutant=${m && m.id} status=${m && m.status}`);
    counts[m.status]++;
    if (m.status === 'Ignored' || m.status === 'Pending') {
      unresolved.push({ text: `${norm} mutant#${m.id} (${m.mutatorName || 'unknown'}) 处于 ${m.status}`, stage: entry.stage });
    }
  }
}

const totalMutants = STATES.reduce((s, k) => s + counts[k], 0);
const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/stryker/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const obsObj = { subject: subjects.join(', '), totalMutants, countsByStatus: counts };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');
const obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');

const summaryParts = STATES.filter((s) => counts[s] > 0).map((s) => `${s}=${counts[s]}`);
const claimObj = {
  stage: entry.stage,
  tool: entry.tool,
  version: toolVer,
  role: entry.role || 'hard',
  inputs,
  artifacts: [
    { path: relPath(reportAbs), sha256: shaBytes(repBuf), kind: 'stryker-mutation-report', bytes: repBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'stryker-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `${obsObj.subject || '(none)'} 执行 ${totalMutants} 个变异体（${summaryParts.join(', ') || 'total=0'}），明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved,
  degradedTo: '人工按同一格式手写档 A 改坏实验记录（breakPatch 与红绿实测退出码）'
};

if (dryRun) {
  console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2));
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(obsPath, obsBuf);
writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（total=${totalMutants}, ${summaryParts.join(', ') || '0'}）`);
process.exit(0);
