// 砂浆适配器 · Knip 死代码与无用依赖观测（Mortar Protocol v1.1 · role=soft，零状态/禁词键）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const registryId = arg('--registry-id', 'knip@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'knip') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

const binSpec = arg('--bin', 'knip');
const runCmd = (args) => process.platform === 'win32' && !/[\\/]/.test(binSpec)
  ? spawnSync('cmd.exe', ['/d', '/c', binSpec, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 90000 })
  : spawnSync(binSpec, args, { cwd: rootDir, encoding: 'utf8', timeout: 90000 });
const verR = runCmd(['--version']);
if (verR.error || verR.status !== 0) fail(3, 'knip 不可用：' + binSpec);
const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 knip 版本');
const toolVer = verMatch[1];

const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
let anchor = { head: null, worktreeHash: null, isDirty: false };
if (!dryRun) {
  const st = git(['status', '--porcelain']);
  if (st.status !== 0 || st.stdout.trim() !== '') fail(3, '脏树或非 git 仓库拒收退 3');
  anchor = { head: git(['rev-parse', 'HEAD']).stdout.trim(), worktreeHash: git(['rev-parse', 'HEAD^{tree}']).stdout.trim(), isDirty: false };
}

const rawOverride = arg('--raw-report');
let rawText;
if (rawOverride) {
  try { rawText = readFileSync(resolve(rootDir, rawOverride), 'utf8'); } catch { fail(3, 'raw-report 不可读'); }
} else {
  const r = runCmd(['--reporter', 'json']);
  // knip 找到问题时退 1，干净退 0；其它错误或无输出则判 3
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'knip 执行失败：' + (r.stderr || r.error?.message));
  rawText = r.stdout || '';
}

let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'knip 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || !Array.isArray(parsed.issues)) fail(3, 'knip 报告缺少 issues 数组');

const unusedFiles = Array.isArray(parsed.files) ? parsed.files.map((x) => String(x)) : [];
const unusedDeps = [];
const unlistedDeps = [];
const unusedExports = [];
for (const iss of parsed.issues) {
  const f = String(iss.file || '');
  for (const d of (iss.dependencies || [])) unusedDeps.push({ file: f, name: d.name || String(d) });
  for (const d of (iss.devDependencies || [])) unusedDeps.push({ file: f, name: d.name || String(d), dev: true });
  for (const d of (iss.unlisted || [])) unlistedDeps.push({ file: f, name: d.name || String(d) });
  for (const ex of (iss.exports || [])) unusedExports.push({ file: f, name: ex.name || String(ex) });
  for (const uf of (iss.files || [])) unusedFiles.push(String(uf.name || uf));
}

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/knip/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-knip.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = {
  unusedFilesCount: new Set(unusedFiles).size,
  unusedDepsCount: unusedDeps.length,
  unlistedDepsCount: unlistedDeps.length,
  unusedExportsCount: unusedExports.length,
  unusedDeps,
  unlistedDeps
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'soft',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'knip-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'knip-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `检出无用依赖 ${obsObj.unusedDepsCount}、未声明引用 ${obsObj.unlistedDepsCount}、未使用文件 ${obsObj.unusedFilesCount}、死导出 ${obsObj.unusedExportsCount}，明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: [],
  degradedTo: '人工核对 package.json 依赖清单与各模块未引用文件'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（unusedDeps=${obsObj.unusedDepsCount}, unusedFiles=${obsObj.unusedFilesCount}）`);
process.exit(0);
