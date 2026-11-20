// 砂浆适配器 · Schemathesis OpenAPI/GraphQL 接口边界模糊测试观测（Mortar Protocol v1.1 · role=hard，零状态/禁词键）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
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
const registryId = arg('--registry-id', 'schemathesis@stage4');

const regPath = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(REPO, 'adapters.registry.json');
let reg;
try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'registry 不可读：' + e.message); }
const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === 'schemathesis') : null;
if (!entry) fail(2, '未登记的 --registry-id：' + registryId);

function findBin(spec) {
  if (/[\\/]/.test(spec)) return existsSync(spec) ? spec : null;
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [spec], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split(/\r?\n/)[0].trim();
  const fallback = process.platform === 'win32'
    ? join(process.env.USERPROFILE || homedir(), '.local', 'bin', spec + '.exe')
    : join(homedir(), '.local', 'bin', spec);
  return existsSync(fallback) ? fallback : null;
}
const binPath = findBin(arg('--bin', 'schemathesis'));
if (!binPath) fail(3, 'schemathesis 不在 PATH 或不可用');

const utf8Env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const verR = spawnSync(binPath, ['--version'], { env: utf8Env, encoding: 'utf8', timeout: 20000 });
if (verR.error || verR.status !== 0) fail(3, '无法运行 schemathesis --version');
const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
if (!verMatch) fail(3, '无法解析 schemathesis 版本');
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
  const schemaArg = arg('--schema', ['openapi.json', 'openapi.yaml', 'openapi.yml'].find((f) => existsSync(join(rootDir, f))));
  const baseUrl = arg('--url');
  if (!schemaArg || !baseUrl) fail(3, '缺少 --schema (openapi.json/yaml) 或 --url http://...（可传 --raw-report 测试离线报告）');
  const tmpOut = mkdtempSync(join(tmpdir(), 'sch-out-'));
  try {
    const outJson = join(tmpOut, 'schemathesis-report.json');
    const maxEx = arg('--max-examples', '10');
    const r = spawnSync(binPath, ['run', resolve(rootDir, schemaArg), '--url', baseUrl, '--max-examples', maxEx, '--report', 'json', '--report-json-path', outJson], {
      cwd: rootDir, env: utf8Env, encoding: 'utf8', timeout: 120000
    });
    if (r.error || !existsSync(outJson)) fail(3, 'schemathesis run 未产出 JSON 报告：' + (r.stderr || r.stdout));
    rawText = readFileSync(outJson, 'utf8');
  } finally { rmSync(tmpOut, { recursive: true, force: true }); }
}

let parsed;
try { parsed = JSON.parse(rawText); } catch (e) { fail(3, 'Schemathesis 输出 JSON 截断或损坏：' + e.message); }
if (!parsed || typeof parsed !== 'object' || !parsed.operations || !parsed.test_cases) {
  fail(3, 'Schemathesis 报告缺少 operations 或 test_cases 字段');
}

const operationsTotal = Number(parsed.operations.total || 0);
const operationsTested = Number(parsed.operations.tested || 0);
const casesGenerated = Number(parsed.test_cases.generated || 0);
const uniqueFailuresCount = Number(parsed.test_cases.unique_failures || 0);
const failures = Array.isArray(parsed.failures) ? parsed.failures : [];
const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
if (operationsTotal === 0) fail(3, 'Schemathesis 未覆盖任何 API 接口（防空跑退 3）');

const failureSummaries = failures.slice(0, 50).map((f) => ({
  code: String(f.code || f.type || ''),
  title: String(f.title || ''),
  count: Number(f.count || 1),
  operations: Array.isArray(f.operations) ? f.operations : []
}));

const outPath = resolve(rootDir, arg('--out', '.donegate/adapters/schemathesis/claim.json'));
const outDir = dirname(outPath);
const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
const rawPath = join(outDir, 'raw-schemathesis.json'), obsPath = join(outDir, 'observation.json'), anchorPath = join(outDir, 'git-anchor.json');
const rawBuf = Buffer.from(JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const obsObj = {
  operationsTotal,
  operationsTested,
  casesGenerated,
  uniqueFailuresCount,
  failureGroupsCount: failures.length,
  errorCount: errors.length,
  failureSummaries
};
const obsBuf = Buffer.from(JSON.stringify(obsObj, null, 2) + '\n', 'utf8');
const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

const claimObj = {
  stage: entry.stage, tool: entry.tool, version: toolVer, role: entry.role || 'hard',
  inputs: [],
  artifacts: [
    { path: relPath(rawPath), sha256: shaBytes(rawBuf), kind: 'schemathesis-raw', bytes: rawBuf.length },
    { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: 'schemathesis-observation', bytes: obsBuf.length },
    { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
  ],
  claims: [{
    text: `API 模糊测试覆盖 ${operationsTested}/${operationsTotal} 接口，生成 ${casesGenerated} 用例，检出 ${uniqueFailuresCount} 类异常响应与 ${errors.length} 处错误，明细见 ${relPath(obsPath)}`,
    checkedBy: entry.checkedBy
  }],
  unresolved: errors.length > 0 ? [`存在 ${errors.length} 条接口调用错误`] : [],
  degradedTo: '人工对照 OpenAPI 文档逐接口发送异常参数并核验 HTTP 状态码与返回体'
};

if (dryRun) { console.log(JSON.stringify({ observation: obsObj, claim: claimObj }, null, 2)); process.exit(0); }
mkdirSync(outDir, { recursive: true });
writeFileSync(rawPath, rawBuf); writeFileSync(obsPath, obsBuf); writeFileSync(anchorPath, anchorBuf);
writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
console.log(`产出声明：${relPath(outPath)}（tested=${operationsTested}/${operationsTotal}, uniqueFailures=${uniqueFailuresCount}）`);
process.exit(0);
