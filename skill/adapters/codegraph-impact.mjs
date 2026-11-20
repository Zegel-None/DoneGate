// 砂浆适配器 · codegraph 影响面与循环依赖观测（Mortar Protocol v1.1 · 零第三方依赖）
// 诚实边界：只产出严格九字段 claim.json 与 observation.json；即使 cycleCount > 0 也退 0，业务判红交判定核。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'codegraph') : null;
if (!entry) fail(2, '未在 adapters.registry.json 登记的 --registry-id：' + registryId);
if (entry.protocolVersion !== '1.1' || !Number.isInteger(entry.stage) || entry.stage < 1 || entry.stage > 7 ||
  !Array.isArray(entry.checkedBy) || entry.checkedBy.length < 2 ||
  entry.checkedBy.some((cb) => typeof cb !== 'string' || !/^[^/]+\/[^/]+$/.test(cb))) {
  fail(2, 'registry 条目协议版本或 checkedBy 非法：' + registryId);
}

const binSpec = arg('--bin', 'codegraph');
function resolveBin(spec) {
  if (process.platform !== 'win32') return { cmd: spec, prefixArgs: [] };
  if (/[\\/]/.test(spec)) {
    if (!existsSync(spec)) return null;
    if (/\.(cmd|bat)$/i.test(spec)) return { cmd: 'cmd.exe', prefixArgs: ['/d', '/c', spec] };
    return { cmd: spec, prefixArgs: [] };
  }
  const w = spawnSync('where.exe', [spec], { encoding: 'utf8' });
  if (w.status !== 0 || !w.stdout.trim()) return null;
  const lines = w.stdout.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const exe = lines.find((l) => /\.exe$/i.test(l));
  if (exe) return { cmd: exe, prefixArgs: [] };
  const cmdFile = lines.find((l) => /\.(cmd|bat)$/i.test(l)) || lines[0];
  return { cmd: 'cmd.exe', prefixArgs: ['/d', '/c', cmdFile] };
}
const resolvedBin = resolveBin(binSpec);
if (!resolvedBin) fail(3, 'codegraph 不在 PATH 或路径不存在：' + binSpec);
const runCg = (args) => spawnSync(resolvedBin.cmd, [...resolvedBin.prefixArgs, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 60000 });

const verR = runCg(['--version']);
if (verR.status !== 0) fail(3, '无法运行 codegraph --version：' + (verR.stderr || verR.error?.message || ''));
const toolVerMatch = (verR.stdout || '').trim().match(/(\d+\.\d+\.\d+)/);
if (!toolVerMatch) fail(3, '无法解析 codegraph 版本号：' + verR.stdout);
const toolVer = toolVerMatch[1];
const semverOk = (v, range) => {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/), rm = String(range || '').match(/^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)\.(\d+)\.(\d+)$/);
  if (!m || !rm) return false;
  const cmp = (a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2];
  const cur = [+m[1], +m[2], +m[3]];
  return cmp(cur, [+rm[1], +rm[2], +rm[3]]) >= 0 && cmp(cur, [+rm[4], +rm[5], +rm[6]]) < 0;
};
if (!semverOk(toolVer, entry.testedToolRange)) fail(3, `codegraph 版本 ${toolVer} 超出 testedToolRange (${entry.testedToolRange})`);

const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
let anchor = { head: null, worktreeHash: null, isDirty: false };
if (!dryRun) {
  const st = git(['status', '--porcelain']);
  if (st.status !== 0) fail(3, '工作区不是有效的 git 仓库，无法锚定');
  if (st.stdout.trim() !== '') fail(3, '工作区存在未提交改动（脏树拒收退 3，请先 commit 或 stash，调试请加 --dry-run）');
  const h = git(['rev-parse', 'HEAD']), wt = git(['rev-parse', 'HEAD^{tree}']);
  if (h.status !== 0 || wt.status !== 0) fail(3, '读取 git HEAD/tree 失败');
  anchor = { head: h.stdout.trim(), worktreeHash: wt.stdout.trim(), isDirty: false };
}

const rawCyclesPath = arg('--raw-cycles');
const rawImpactPath = arg('--raw-impact');

// 校验索引状态（除非仅测试离线截断产物）
if (!rawCyclesPath && !rawImpactPath) {
  const stR = runCg(['status', '--json', rootDir]);
  if (stR.status !== 0) fail(3, 'codegraph status 失败：' + (stR.stderr || stR.stdout));
  let stJson;
  try { stJson = JSON.parse(stR.stdout); } catch (e) { fail(3, 'codegraph status JSON 损坏：' + e.message); }
  if (!stJson || !stJson.initialized || !stJson.index || stJson.index.state !== 'complete') {
    fail(3, 'codegraph 索引未初始化或未完成，请先运行 codegraph init 并执行 codegraph sync');
  }
  const pc = stJson.pendingChanges || {};
  if ((pc.added || 0) + (pc.modified || 0) + (pc.removed || 0) > 0 || (stJson.index.filesNeedingReindex || 0) > 0) {
    fail(3, 'codegraph 索引已过期，请先运行 codegraph sync / index');
  }
}

// 1. cycles 观测（注意 codegraph cycles 在存在环路时退出码为 1，不算故障）
let cyclesRawText;
if (rawCyclesPath) {
  const abs = resolve(rootDir, rawCyclesPath);
  if (!existsSync(abs)) fail(3, 'raw-cycles 文件不存在：' + rawCyclesPath);
  try { cyclesRawText = readFileSync(abs, 'utf8'); } catch (e) { fail(3, 'raw-cycles 不可读：' + e.message); }
} else {
  const cyR = runCg(['cycles', '--json', rootDir]);
  if (cyR.error || (cyR.status !== 0 && cyR.status !== 1)) fail(3, 'codegraph cycles 执行失败：' + (cyR.stderr || cyR.error?.message));
  cyclesRawText = cyR.stdout || '';
}
let cyclesJson;
try { cyclesJson = JSON.parse(cyclesRawText); } catch (e) { fail(3, 'codegraph cycles 输出 JSON 截断或损坏（缺 count/cycles）：' + e.message); }
if (!cyclesJson || typeof cyclesJson.count !== 'number' || !Array.isArray(cyclesJson.cycles)) {
  fail(3, 'codegraph cycles 输出缺少必填字段 count 或 cycles');
}

// 2. impact 观测
const changedFiles = (arg('--changed', '') || '').split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
const inputs = [];
for (const fp of changedFiles) {
  const abs = resolve(rootDir, fp);
  if (!existsSync(abs)) fail(3, '变更输入文件不存在：' + fp);
  let buf;
  try { buf = readFileSync(abs); } catch (e) { fail(3, '变更输入文件不可读：' + fp); }
  inputs.push({ path: fp, sha256: shaBytes(buf) });
}

const impactedSet = new Set();
const rawImpacts = [];
if (rawImpactPath) {
  const abs = resolve(rootDir, rawImpactPath);
  if (!existsSync(abs)) fail(3, 'raw-impact 文件不存在：' + rawImpactPath);
  let impJson;
  try { impJson = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { fail(3, 'codegraph impact JSON 截断或损坏（缺 affected）：' + e.message); }
  if (!impJson || !Array.isArray(impJson.affected)) fail(3, 'codegraph impact 输出缺少必填字段 affected');
  rawImpacts.push(impJson);
  for (const n of impJson.affected) if (n && typeof n.filePath === 'string') impactedSet.add(n.filePath.replace(/\\/g, '/'));
} else {
  for (const fp of changedFiles) {
    const nodeR = runCg(['node', '-p', rootDir, '-f', fp, '--symbols-only']);
    if (nodeR.status !== 0) fail(3, `codegraph node 失败 (${fp})：${nodeR.stderr || nodeR.stdout}`);
    const nodeOut = nodeR.stdout || '';
    const usedLine = nodeOut.match(/used by \d+ files?:\s*([^\r\n]+)/i);
    if (usedLine) {
      for (const dep of usedLine[1].split(',').map((s) => s.trim().replace(/\\/g, '/')).filter((s) => s && !/^\+\d+\s+more$/i.test(s))) {
        impactedSet.add(dep);
      }
    }
    const syms = [...nodeOut.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
    for (const sym of syms) {
      const impR = runCg(['impact', '-p', rootDir, '-f', fp, '-d', '5', '--json', sym]);
      if (impR.status !== 0) fail(3, `codegraph impact 失败 (${fp}#${sym})：${impR.stderr || impR.stdout}`);
      let impJson;
      try { impJson = JSON.parse(impR.stdout || ''); } catch (e) { fail(3, 'codegraph impact 输出 JSON 截断或损坏（缺 affected）：' + e.message); }
      if (!impJson || !Array.isArray(impJson.affected)) fail(3, 'codegraph impact 输出缺少必填字段 affected');
      rawImpacts.push({ file: fp, symbol: sym, affected: impJson.affected });
      for (const n of impJson.affected) if (n && typeof n.filePath === 'string') impactedSet.add(n.filePath.replace(/\\/g, '/'));
    }
  }
}
for (const fp of changedFiles) impactedSet.delete(fp);
const impactedFiles = [...impactedSet].sort();

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/codegraph/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-impact.json');
const obsPath = join(outDir, 'observation.json');
const anchorPath = join(outDir, 'git-anchor.json');

const rawPayload = { cycles: cyclesJson, impacts: rawImpacts };
const obsObj = { changedFiles, impactedFiles, cycleCount: cyclesJson.count, cycles: cyclesJson.cycles };
const rawBuf = Buffer.from(JSON.stringify(rawPayload, null, 2) + '\n', 'utf8');
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage,
  tool: entry.tool,
  version: toolVer,
  role: entry.role || 'hard',
  inputs,
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'codegraph-impact-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'codegraph-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [
    {
      text: `变更 ${changedFiles.join(', ') || '(none)'} 影响 ${impactedFiles.length} 个下游文件，明细见 ${relPath(obsPath)}`,
      checkedBy: entry.checkedBy[0]
    },
    {
      text: `全仓检出 ${cyclesJson.count} 条循环依赖环路，明细见 ${relPath(obsPath)}`,
      checkedBy: entry.checkedBy[1]
    }
  ],
  unresolved: [],
  degradedTo: '人工按同一格式手写受影响文件清单与静态循环引用核查记录'
};

if (dryRun) {
  console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2));
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf);
writeFileSync(obsPath, obsBuf);
writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（impacted=${impactedFiles.length}, cycles=${cyclesJson.count}）`);
process.exit(0);
