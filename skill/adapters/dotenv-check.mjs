// 砂浆适配器 · dotenv-linter 环境变量文件规范与键对比观测（Mortar Protocol v1.1 · role=soft）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const registryId = arg('--registry-id', 'dotenv-linter@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'dotenv-linter') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32' ? join(process.env.USERPROFILE || homedir(), 'bin', spec + '.exe') : '';
  return fallback && existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'dotenv-linter'));
if (!binPath) fail(3, 'dotenv-linter 不在 PATH 或不可用');
const verR = spawnSync(binPath, ['--version'], { encoding: 'utf8', timeout: 15000 });
if (verR.status !== 0) fail(3, '无法运行 dotenv-linter --version');
const verMatch = (verR.stdout || '').match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 dotenv-linter 版本');
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
let diffIssues = [];
if (rawOverride) {
  try { rawText = readFileSync(resolve(rootDir, rawOverride), 'utf8'); } catch { fail(3, 'raw-report 不可读'); }
  if (!rawText.trim()) fail(3, 'raw-report 内容为空');
} else {
  const envFiles = readdirSync(rootDir).filter((f) => /^\.env(\.|$)/.test(f));
  if (envFiles.length === 0) fail(3, '项目根目录未发现任何 .env* 文件（防空跑退 3）');
  const r = spawnSync(binPath, ['--plain', 'check', '.'], { cwd: rootDir, encoding: 'utf8', timeout: 30000 });
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'dotenv-linter check 执行失败：' + (r.stderr || r.error?.message));
  rawText = (r.stdout || '') + (r.stderr || '');
  if (existsSync(join(rootDir, '.env.example')) && existsSync(join(rootDir, '.env'))) {
    const dr = spawnSync(binPath, ['--plain', 'diff', '.env.example', '.env'], { cwd: rootDir, encoding: 'utf8', timeout: 30000 });
    if (dr.status === 1 && dr.stdout) {
      rawText += '\n--- diff .env.example vs .env ---\n' + dr.stdout;
      for (const l of dr.stdout.split(/\r?\n/)) {
        const t = l.trim();
        if (t && !t.startsWith('Comparing') && !t.startsWith('Found ')) diffIssues.push(t);
      }
    }
  }
}

const lintIssues = [];
for (const line of rawText.split(/\r?\n/)) {
  const m = line.trim().match(/^(\S+?:\d+)\s+([A-Za-z0-9_]+):\s*(.+)$/);
  if (m) lintIssues.push({ location: m[1], rule: m[2], message: m[3] });
}

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/dotenv-linter/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-dotenv.txt'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(rawText, 'utf8');
const obsObj = {
  lintIssueCount: lintIssues.length,
  diffIssueCount: diffIssues.length,
  totalIssues: lintIssues.length + diffIssues.length,
  lintIssues,
  diffIssues
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'soft',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'dotenv-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'dotenv-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `检出 .env 规范问题 ${obsObj.lintIssueCount} 条、.env.example 键差异 ${obsObj.diffIssueCount} 条，明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: [],
  degradedTo: '人工逐键比对 .env.example 与本地 .env'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（lint=${obsObj.lintIssueCount}, diff=${obsObj.diffIssueCount}）`);
process.exit(0);
