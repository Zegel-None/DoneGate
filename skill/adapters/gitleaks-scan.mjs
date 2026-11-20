// 砂浆适配器 · gitleaks 密钥泄漏观测（Mortar Protocol v1.1 · role=hard，零状态/禁词键）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
const registryId = arg('--registry-id', 'gitleaks@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'gitleaks') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32' ? join(process.env.USERPROFILE || 'C:\\Users\\Zegel', 'bin', spec + '.exe') : '';
  return fallback && existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'gitleaks'));
if (!binPath) fail(3, 'gitleaks 不在 PATH 或不可用');
const verR = spawnSync(binPath, ['version'], { encoding: 'utf8', timeout: 15000 });
if (verR.status !== 0) fail(3, '无法运行 gitleaks version');
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 gitleaks 版本：' + verR.stdout);
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
  const tmpOut = mkdtempSync(join(tmpdir(), 'gitleaks-out-'));
  try {
    const rpt = join(tmpOut, 'gitleaks.json');
    const r = spawnSync(binPath, ['detect', '--source', rootDir, '--no-git', '--report-format', 'json', '--report-path', rpt, '--exit-code', '0'], { encoding: 'utf8', timeout: 60000 });
    if (r.error || r.status !== 0 || !existsSync(rpt)) fail(3, 'gitleaks 执行失败：' + (r.stderr || r.error?.message));
    rawText = readFileSync(rpt, 'utf8');
  } finally { rmSync(tmpOut, { recursive: true, force: true }); }
}
let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'gitleaks 输出 JSON 截断或损坏：' + e.message); }
if (!Array.isArray(parsed)) fail(3, 'gitleaks 报告不是数组');

const findings = parsed.map((x) => ({
  ruleId: String(x.RuleID || x.ruleId || 'unknown'),
  file: String(x.File || x.file || '').replace(/\\/g, '/'),
  line: Number(x.StartLine || x.line || 0)
}));

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/gitleaks/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-gitleaks.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = { findingCount: findings.length, findings };
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'gitleaks-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'gitleaks-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{ text: `gitleaks 扫描检出 ${findings.length} 条疑似密钥条目，明细见 ${relPath(obsPath)}`, checkedBy: entry.checkedBy }],
  unresolved: [],
  degradedTo: '人工按同一格式逐文件核查密钥与凭据残留'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（findings=${findings.length}）`);
process.exit(0);
