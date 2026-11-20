// 砂浆适配器 · srclight 索引新鲜度观测（Mortar Protocol v1.1 · role=soft）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
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
const registryId = arg('--registry-id', 'srclight@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'srclight') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32' ? join(process.env.USERPROFILE || homedir(), '.local', 'bin', spec + '.exe') : '';
  return fallback && existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'srclight'));
if (!binPath) fail(3, 'srclight 不在 PATH 或不可用');
const verR = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
if (verR.status !== 0) fail(3, '无法运行 srclight --version');
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 srclight 版本');
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
  const dbArg = arg('--db');
  const slArgs = dbArg ? ['status', '--db', resolve(rootDir, dbArg)] : ['status'];
  const r = spawnSync(binPath, slArgs, { cwd: rootDir, encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) fail(3, 'srclight status 失败（请先在项目根运行 srclight index）：' + (r.stderr || r.stdout));
  rawText = r.stdout || '';
}
let parsed = null;
try { parsed = JSON.parse(rawText); } catch { /* srclight status may output text; accept non-empty text or parse JSON */ }
if (!rawText.trim()) fail(3, 'srclight status 输出为空');

const filesMatch = rawText.match(/(\d+)\s+files?/i);
const indexedFiles = parsed && Number.isInteger(parsed.indexedFiles) ? parsed.indexedFiles : (filesMatch ? Number(filesMatch[1]) : 0);

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/srclight/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-srclight.txt'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(rawText, 'utf8');
const obsObj = { indexedFiles, statusDigest: rawText.trim().slice(0, 500) };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'soft',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'srclight-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'srclight-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{ text: `srclight 索引状态采集完成（files=${indexedFiles}），明细见 ${relPath(obsPath)}`, checkedBy: entry.checkedBy }],
  unresolved: [],
  degradedTo: '人工按同一格式核查代码索引是否覆盖当前提交'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（indexedFiles=${indexedFiles}）`);
process.exit(0);
