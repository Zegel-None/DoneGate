// 砂浆适配器 · dependency-cruiser 依赖方向与环路观测（Mortar Protocol v1.1 · role=hard，0 模块退 3）
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
const registryId = arg('--registry-id', 'depcruise@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'depcruise') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

const binSpec = arg('--bin', 'depcruise');
const runDc = (args) => process.platform === 'win32' && !/[\\/]/.test(binSpec)
  ? spawnSync('cmd.exe', ['/d', '/c', binSpec, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 60000 })
  : spawnSync(binSpec, args, { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
const verR = runDc(['--version']);
if (verR.error || verR.status !== 0) fail(3, 'depcruise 不可用：' + binSpec);
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 depcruise 版本');
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
  const targetDir = arg('--target', 'runner');
  const dcArgs = ['--output-type', 'json', '--no-config', targetDir];
  const r = runDc(dcArgs);
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'depcruise 执行失败：' + (r.stderr || r.error?.message));
  rawText = r.stdout || '';
}
let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'depcruise 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || !Array.isArray(parsed.modules) || !parsed.summary) fail(3, 'depcruise 报告缺少 modules 或 summary');
if (parsed.modules.length === 0) fail(3, 'depcruise 巡航到 0 个模块（防空跑假绿退 3）');

const violations = (parsed.summary.violations || []).map((v) => ({
  rule: v.rule?.name || 'unknown',
  from: String(v.from || '').replace(/\\/g, '/'),
  to: String(v.to || '').replace(/\\/g, '/')
}));

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/depcruise/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-depcruise.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = { modulesCount: parsed.modules.length, violationCount: violations.length, violations };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'depcruise-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'depcruise-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{ text: `depcruise 巡航 ${parsed.modules.length} 个模块，检出 ${violations.length} 条规则违例，明细见 ${relPath(obsPath)}`, checkedBy: entry.checkedBy }],
  unresolved: [],
  degradedTo: '人工按同一格式静态核查模块 import 方向与循环依赖'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（modules=${parsed.modules.length}, violations=${violations.length}）`);
process.exit(0);
