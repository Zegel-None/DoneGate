// 砂浆适配器 · osv-scanner 依赖漏洞观测（Mortar Protocol v1.1 · role=hard，发现漏洞仍退 0 交核判）
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
const registryId = arg('--registry-id', 'osv-scanner@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'osv-scanner') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32' ? join(process.env.USERPROFILE || homedir(), 'bin', spec + '.exe') : '';
  return fallback && existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'osv-scanner'));
if (!binPath) fail(3, 'osv-scanner 不在 PATH 或不可用');
const verR = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
if (verR.status !== 0) fail(3, '无法运行 osv-scanner --version');
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 osv-scanner 版本：' + verR.stdout);
const toolVer = verMatch[1];

const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
let anchor = { head: null, worktreeHash: null, isDirty: false };
if (!dryRun) {
  const st = git(['status', '--porcelain']);
  if (st.status !== 0 || st.stdout.trim() !== '') fail(3, '脏树或非 git 仓库拒收退 3');
  anchor = { head: git(['rev-parse', 'HEAD']).stdout.trim(), worktreeHash: git(['rev-parse', 'HEAD^{tree}']).stdout.trim(), isDirty: false };
}

const lockRel = arg('--lockfile', 'package-lock.json');
const lockAbs = resolve(rootDir, lockRel);
const inputs = [];
if (existsSync(lockAbs)) {
  try { inputs.push({ path: lockRel.replace(/\\/g, '/'), sha256: shaBytes(readFileSync(lockAbs)) }); }
  catch { fail(3, 'lockfile 不可读：' + lockRel); }
}

const rawOverride = arg('--raw-report');
let rawText;
if (rawOverride) {
  try { rawText = readFileSync(resolve(rootDir, rawOverride), 'utf8'); } catch { fail(3, 'raw-report 不可读'); }
} else {
  if (!existsSync(lockAbs)) fail(3, '缺少 lockfile：' + lockRel);
  const r = spawnSync(binPath, ['scan', 'source', '-L', lockAbs, '--format', 'json'], { cwd: rootDir, encoding: 'utf8', timeout: 90000 });
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'osv-scanner 执行失败：' + (r.stderr || r.error?.message));
  rawText = r.stdout || '';
}
let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'osv-scanner 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || !Array.isArray(parsed.results)) fail(3, 'osv-scanner 报告缺少 results 数组');

const vulnerabilities = [];
for (const res of parsed.results) {
  for (const pkg of (res.packages || [])) {
    const pkgName = pkg.package?.name || 'unknown';
    const pkgVer = pkg.package?.version || '';
    for (const v of (pkg.vulnerabilities || [])) {
      vulnerabilities.push({ package: pkgName, version: pkgVer, id: v.id || 'unknown', summary: String(v.summary || '').slice(0, 120) });
    }
  }
}

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/osv-scanner/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-osv.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = { lockfile: lockRel, vulnCount: vulnerabilities.length, vulnerabilities };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs,
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'osv-scanner-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'osv-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{ text: `osv-scanner 扫描 ${lockRel} 检出 ${vulnerabilities.length} 条已知漏洞，明细见 ${relPath(obsPath)}`, checkedBy: entry.checkedBy }],
  unresolved: [],
  degradedTo: '人工按同一格式核查 package-lock.json 新增依赖与安全公告'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（vulns=${vulnerabilities.length}）`);
process.exit(0);
