// 砂浆适配器 · OpenSpec 规格校验观测（Mortar Protocol v1.1 · role=soft）
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
const registryId = arg('--registry-id', 'openspec@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'openspec') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

const binSpec = arg('--bin', 'openspec');
const runOs = (args) => process.platform === 'win32' && !/[\\/]/.test(binSpec)
  ? spawnSync('cmd.exe', ['/d', '/c', binSpec, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 60000 })
  : spawnSync(binSpec, args, { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
const verR = runOs(['--version']);
if (verR.error || verR.status !== 0) fail(3, 'openspec 不可用：' + binSpec);
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 openspec 版本');
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
  if (!existsSync(join(rootDir, 'openspec'))) fail(3, '工作区未初始化 openspec/ 目录');
  const r = runOs(['validate', '--all', '--strict', '--json']);
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'openspec validate 失败：' + (r.stderr || r.error?.message));
  rawText = r.stdout || '';
}
let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'openspec 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) fail(3, 'openspec 报告缺少 items 数组');

const issueItems = parsed.items.filter((x) => x && x.valid === false).map((x) => ({ name: x.name || 'unknown', issues: x.issues || [] }));

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/openspec/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-openspec.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = { itemCount: parsed.items.length, invalidCount: issueItems.length, issueItems };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'soft',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'openspec-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'openspec-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{ text: `openspec 校验 ${parsed.items.length} 项规格，发现 ${issueItems.length} 项待修正，明细见 ${relPath(obsPath)}`, checkedBy: entry.checkedBy }],
  unresolved: [],
  degradedTo: '人工按同一格式逐份核对规格文件格式与约束条文'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（items=${parsed.items.length}, issues=${issueItems.length}）`);
process.exit(0);
