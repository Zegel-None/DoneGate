// 砂浆适配器 · Trivy IaC/Dockerfile/文件系统安全配置与漏洞观测（Mortar Protocol v1.1 · role=hard，零状态/禁词键）
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
const registryId = arg('--registry-id', 'trivy@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'trivy') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

const binSpec = arg('--bin', 'trivy');
const runCmd = (args) => process.platform === 'win32' && !/[\\/]/.test(binSpec)
  ? spawnSync('cmd.exe', ['/d', '/c', binSpec, ...args], { cwd: rootDir, encoding: 'utf8', timeout: 120000 })
  : spawnSync(binSpec, args, { cwd: rootDir, encoding: 'utf8', timeout: 120000 });
const verR = runCmd(['--version']);
if (verR.error || verR.status !== 0) fail(3, 'trivy 不可用：' + binSpec);
const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 trivy 版本');
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
  const scanners = arg('--scanners', 'misconfig');
  const targetDir = arg('--target', '.');
  const r = runCmd(['fs', '--scanners', scanners, '--format', 'json', '--quiet', targetDir]);
  if (r.error || (r.status !== 0 && r.status !== 1)) fail(3, 'trivy fs 执行失败：' + (r.stderr || r.error?.message));
  rawText = r.stdout || '';
}

let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'Trivy 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.Results) && typeof parsed.SchemaVersion !== 'number')) {
  fail(3, 'Trivy 报告缺少 Results / SchemaVersion 字段');
}

const results = Array.isArray(parsed.Results) ? parsed.Results : [];
let misconfigCount = 0, vulnCount = 0, secretCount = 0;
const findings = [];
for (const res of results) {
  const target = String(res.Target || '');
  for (const m of (res.Misconfigurations || [])) {
    if (m.Status && m.Status !== 'FAIL') continue;
    misconfigCount++;
    findings.push({ kind: 'misconfig', id: String(m.ID || ''), target, severity: String(m.Severity || ''), title: String(m.Title || '') });
  }
  for (const v of (res.Vulnerabilities || [])) {
    vulnCount++;
    findings.push({ kind: 'vuln', id: String(v.VulnerabilityID || ''), target, severity: String(v.Severity || ''), pkg: String(v.PkgName || '') });
  }
  for (const s of (res.Secrets || [])) {
    secretCount++;
    findings.push({ kind: 'secret', id: String(s.RuleID || ''), target, severity: String(s.Severity || ''), title: String(s.Title || '') });
  }
}

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/trivy/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-trivy.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = {
  targetCount: results.length,
  misconfigCount,
  vulnCount,
  secretCount,
  totalFindings: misconfigCount + vulnCount + secretCount,
  findings: findings.slice(0, 100)
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'trivy-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'trivy-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `Trivy 检出配置缺陷 ${misconfigCount}、漏洞 ${vulnCount}、密钥 ${secretCount}，明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: [],
  degradedTo: '人工审查 Dockerfile、容器配置与 IaC 清单中的高危配置项'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（misconfig=${misconfigCount}, vuln=${vulnCount}）`);
process.exit(0);
