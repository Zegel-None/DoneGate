// 判据执行增强子模块：blocked_impossible 合法挂起退出、HEAD~1 Fail-to-Pass 基线回退验证与 0 字节假产物守卫（<= 200 行）
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSanitizedEnv, checkCommandBans } from '../isolation.mjs';

export const DEFAULT_F2P_BASE_REF = 'HEAD~1';
export const BLOCKED_IMPOSSIBLE_CATEGORIES = Object.freeze(['contract_conflict', 'environment_broken', 'missing_external_dependency']);
const EXIT_OK = 0, EXIT_FAIL = 1, EXIT_ACCIDENT = 2, EXIT_UNKNOWN = 3;
const DEFAULT_F2P_TIMEOUT_SEC = 120, MIN_BLOCKED_REASON_LEN = 8, MAX_DIAG_CHARS = 600, MIN_CONFLICTING_OBS = 2;
const ASCII_WS_BYTES = new Set([9, 10, 13, 32]);
const TEST_REL_RE = /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.(?:test|spec|check)|[-_](?:repro|test))\.[a-z0-9]+$|(?:^|\/)(?:repro|test)[-_][^/]+\.[a-z0-9]+$/i;
const ZERO_TESTS_OUT_RE = /\b0\s+(?:passed|tests?\b)|no\s+tests?\s+(?:found|ran)\b/i;
const POSITIVE_TESTS_OUT_RE = /\b[1-9]\d*\s+(?:passed|tests?\b)/i;

const f2pNormRel = (raw) => String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
function f2pIsSafeInsideRoot(rootAbs, targetAbs) {
  const rel = relative(rootAbs, targetAbs), norm = rel.replace(/\\/g, '/');
  return Boolean(norm && !isAbsolute(rel) && !norm.startsWith('..') && !/^[A-Za-z]:/.test(norm));
}

function f2pPickFirstString(obj, keys) {
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  return '';
}

function f2pExtractEvidence(spec) {
  const conflicts = Array.isArray(spec.conflictingObligations) ? spec.conflictingObligations.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (conflicts.length >= MIN_CONFLICTING_OBS) return { kind: 'conflicting_obligations', conflictingObligations: conflicts };
  const ev = spec.evidence && typeof spec.evidence === 'object' ? spec.evidence : spec;
  const cmd = f2pPickFirstString(ev, ['reproCommand', 'command']), out = f2pPickFirstString(ev, ['observedOutput', 'output', 'stderr']);
  const hasExit = Number.isInteger(ev.observedExitCode) && ev.observedExitCode !== EXIT_OK;
  if (!cmd || (!out && !hasExit)) return null;
  return { kind: 'deterministic_repro', reproCommand: cmd, observedExitCode: hasExit ? ev.observedExitCode : null, observedOutput: out.slice(0, MAX_DIAG_CHARS) };
}

export function recordBlockedImpossible(projectRoot, spec = {}) {
  const rootAbs = resolve(projectRoot), contractId = String(spec.contractId || spec.id || '').trim(), reason = String(spec.reason || '').trim();
  if (!contractId || reason.length < MIN_BLOCKED_REASON_LEN) {
    return { ok: false, status: 'rejected_missing_evidence', exitCode: EXIT_FAIL, code: 'BLOCKED_REASON_TOO_SHORT', stderr: '申报 blocked_impossible 需提供合法 contractId 与不少于 8 字的具体原因说明' };
  }
  const category = BLOCKED_IMPOSSIBLE_CATEGORIES.includes(spec.category) ? spec.category : 'contract_conflict';
  const evidence = f2pExtractEvidence(spec);
  if (!evidence) {
    return { ok: false, status: 'rejected_missing_evidence', exitCode: EXIT_FAIL, code: 'BLOCKED_EVIDENCE_MISSING', stderr: '申报 blocked_impossible 必须附带确定性复现命令输出或冲突判据对，拒绝无证据弃权' };
  }
  if (evidence.reproCommand) {
    const bans = checkCommandBans(evidence.reproCommand);
    if (bans.length > 0) return { ok: false, status: 'rejected_banned_repro', exitCode: EXIT_ACCIDENT, code: 'BLOCKED_REPRO_BANNED', stderr: bans.join('；') };
  }
  const outDir = join(rootAbs, '.donegate', 'blocked');
  mkdirSync(outDir, { recursive: true });
  const recordPath = join(outDir, `${contractId.replace(/[^a-zA-Z0-9._-]/g, '_')}.blocked.json`);
  const record = { schema: 'donegate-blocked-impossible/v1', status: 'blocked_impossible', exitCode: EXIT_UNKNOWN, contractId, category, reason, evidence, recordedAt: new Date().toISOString() };
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { ok: true, status: 'blocked_impossible', exitCode: EXIT_UNKNOWN, code: 'BLOCKED_IMPOSSIBLE', recordPath, record, stdout: `[blocked_impossible:${contractId}] category=${category} → 已记录确定性证据并安全挂起交人类裁决 (exit 3)` };
}

function f2pInspectSingleOutputFile(rootAbs, rawRel) {
  const normRel = f2pNormRel(rawRel), abs = resolve(rootAbs, normRel);
  if (!normRel || !f2pIsSafeInsideRoot(rootAbs, abs)) return { file: normRel || String(rawRel), code: 'OUTPUT_PATH_OUT_OF_ROOT', reason: `期望产物路径越出项目根目录：${rawRel}` };
  let st = null;
  try { st = existsSync(abs) ? statSync(abs) : null; } catch (err) { void err; st = null; }
  if (!st || !st.isFile()) return { file: normRel, code: 'OUTPUT_FILE_MISSING', reason: `期望产物不存在：${normRel}` };
  const buf = readFileSync(abs);
  if (buf.length === 0) return { file: normRel, code: 'OUTPUT_ZERO_BYTES', reason: `期望产物为 0 字节空文件：${normRel}` };
  if (buf.every((b) => b === 0)) return { file: normRel, code: 'OUTPUT_ALL_ZERO_BYTES', reason: `期望产物为全零字节空壳：${normRel}` };
  if (buf.every((b) => ASCII_WS_BYTES.has(b))) return { file: normRel, code: 'OUTPUT_WHITESPACE_EMPTY', reason: `期望产物仅含空白字符：${normRel}` };
  return null;
}

export function verifyExpectedOutputFiles(projectRoot, expectedOutputFiles = []) {
  if (!Array.isArray(expectedOutputFiles) || expectedOutputFiles.length === 0) return { ok: true, checkedCount: 0, violations: [] };
  const rootAbs = resolve(projectRoot), violations = [];
  for (const item of expectedOutputFiles) {
    const v = f2pInspectSingleOutputFile(rootAbs, item);
    if (v) violations.push(v);
  }
  return { ok: violations.length === 0, checkedCount: expectedOutputFiles.length, violations };
}

function f2pTryAddExistingTestRel(rootAbs, rawPath, set, requireTestPattern) {
  const rel = f2pNormRel(rawPath);
  if (!rel || rel.startsWith('-') || (requireTestPattern && !TEST_REL_RE.test(rel))) return;
  const abs = resolve(rootAbs, rel);
  if (!f2pIsSafeInsideRoot(rootAbs, abs) || !existsSync(abs)) return;
  try { if (statSync(abs).isFile()) set.add(rel); } catch (err) { void err; }
}

function f2pCollectOverlayTestFiles(rootAbs, testCmd, baseSha, explicitTests = []) {
  const set = new Set();
  for (const f of (Array.isArray(explicitTests) ? explicitTests : [])) f2pTryAddExistingTestRel(rootAbs, f, set, false);
  for (const tok of (String(testCmd || '').match(/(?:"[^"]*"|'[^']*'|[^\s"';&|]+)/g) || [])) f2pTryAddExistingTestRel(rootAbs, tok, set, true);
  const diffR = spawnSync('git', ['-C', rootAbs, '-c', 'core.quotepath=false', 'diff', '--name-only', baseSha], { encoding: 'utf8', windowsHide: true });
  const untrackedR = spawnSync('git', ['-C', rootAbs, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true });
  for (const line of `${diffR.stdout || ''}\n${untrackedR.stdout || ''}`.split(/\r?\n/)) f2pTryAddExistingTestRel(rootAbs, line, set, true);
  return [...set].sort();
}

function f2pPrepareBaseWorktree(rootAbs, wtDir, baseSha, overlayTestFiles) {
  const addR = spawnSync('git', ['-C', rootAbs, 'worktree', 'add', '--detach', wtDir, baseSha], { encoding: 'utf8', windowsHide: true });
  if (addR.status !== 0) return { ok: false, reason: (addR.stderr || '创建基线临时工作树失败').trim() };
  const hostNm = join(rootAbs, 'node_modules'), wtNm = join(wtDir, 'node_modules');
  if (existsSync(hostNm) && !existsSync(wtNm)) {
    try { symlinkSync(hostNm, wtNm, process.platform === 'win32' ? 'junction' : 'dir'); } catch (err) { void err; }
  }
  for (const rel of overlayTestFiles) {
    const dst = join(wtDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(rootAbs, rel), dst);
  }
  return { ok: true };
}

function f2pRunOnBaseWorktree(rootAbs, cmd, baseRef, baseSha, overlayTestFiles, timeoutMs) {
  const wtDir = mkdtempSync(join(tmpdir(), 'dg-f2p-base-'));
  try {
    const prep = f2pPrepareBaseWorktree(rootAbs, wtDir, baseSha, overlayTestFiles);
    if (!prep.ok) return { ok: false, exitCode: EXIT_UNKNOWN, code: 'F2P_WORKTREE_ERROR', baseRef, reason: prep.reason };
    const baseRun = spawnSync(cmd, { cwd: wtDir, shell: true, env: buildSanitizedEnv(process.env, {}, { cwd: wtDir }), encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    if (baseRun.status === EXIT_OK) {
      return { ok: false, exitCode: EXIT_FAIL, code: 'F2P_PASSED_ON_BASE', baseRef, baseExitCode: EXIT_OK, currentExitCode: EXIT_OK, overlayTestFiles, reason: `Fail-to-Pass 验证未通过：新增测试在基线 ${baseRef} 上已退出 0，未能复现原缺陷` };
    }
    return { ok: true, exitCode: EXIT_OK, code: 'F2P_VERIFIED', baseRef, baseExitCode: baseRun.status, currentExitCode: EXIT_OK, overlayTestFiles };
  } finally {
    try { rmSync(wtDir, { recursive: true, force: true }); } catch (err) { void err; }
    spawnSync('git', ['-C', rootAbs, 'worktree', 'prune'], { encoding: 'utf8', windowsHide: true });
  }
}

export function verifyFailToPassOnBase(projectRoot, testCmd, baseRef = DEFAULT_F2P_BASE_REF, opts = {}) {
  const rootAbs = resolve(projectRoot), cmd = String(testCmd || '').trim();
  if (!cmd) return { ok: false, exitCode: EXIT_UNKNOWN, code: 'F2P_EMPTY_COMMAND', reason: '缺少待验证测试命令' };
  const bans = checkCommandBans(cmd);
  if (bans.length > 0) return { ok: false, exitCode: EXIT_ACCIDENT, code: 'F2P_COMMAND_BANNED', reason: bans.join('；') };
  const revR = spawnSync('git', ['-C', rootAbs, 'rev-parse', '--verify', `${baseRef}^{commit}`], { encoding: 'utf8', windowsHide: true });
  if (revR.status !== 0 || !(revR.stdout || '').trim()) return { ok: false, exitCode: EXIT_UNKNOWN, code: 'F2P_BASE_UNAVAILABLE', baseRef, reason: `无法解析基线提交 ${baseRef}` };
  const baseSha = revR.stdout.trim(), timeoutMs = Number(opts.timeoutSec || DEFAULT_F2P_TIMEOUT_SEC) * 1000;
  const curEnv = opts.sanitizedEnv || buildSanitizedEnv(process.env, {}, { cwd: rootAbs });
  const curRun = spawnSync(cmd, { cwd: rootAbs, shell: true, env: curEnv, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  const curOut = `${curRun.stdout || ''}\n${curRun.stderr || ''}`;
  if (curRun.status !== EXIT_OK) {
    return { ok: false, exitCode: EXIT_FAIL, code: 'F2P_CURRENT_NOT_PASSING', baseRef, baseExitCode: null, currentExitCode: curRun.status, reason: `Fail-to-Pass 验证未通过：当前补丁树执行测试退出码为 ${curRun.status}（必须为 0）` };
  }
  if (ZERO_TESTS_OUT_RE.test(curOut) && !POSITIVE_TESTS_OUT_RE.test(curOut)) {
    return { ok: false, exitCode: EXIT_FAIL, code: 'F2P_ZERO_TESTS_RUN', baseRef, baseExitCode: null, currentExitCode: EXIT_OK, reason: 'Fail-to-Pass 验证未通过：测试运行器报告 0 用例执行（疑似空跑假绿）' };
  }
  return f2pRunOnBaseWorktree(rootAbs, cmd, baseRef, baseSha, f2pCollectOverlayTestFiles(rootAbs, cmd, baseSha, opts.testFiles), timeoutMs);
}

export function f2pEvaluateCriterionExtras(projectRoot, o, rStatus, aborted, ctx) {
  const outChk = verifyExpectedOutputFiles(projectRoot, o.expectedOutputFiles);
  const f2p = (o.requireFailOnBase === true && !aborted && rStatus === o.expect?.exitCode)
    ? verifyFailToPassOnBase(projectRoot, o.command, o.baseRef || ctx.opts?.base || DEFAULT_F2P_BASE_REF, { sanitizedEnv: ctx.sanitizedEnv, timeoutSec: o.timeoutSec })
    : null;
  const reportExtras = { ...(outChk.checkedCount > 0 ? { expectedOutputCheck: outChk } : {}), ...(f2p ? { failToPass: f2p } : {}) };
  return { reportExtras, extraUnknown: Boolean(f2p && !f2p.ok && f2p.exitCode === EXIT_UNKNOWN), extraFail: !outChk.ok || Boolean(f2p && !f2p.ok && f2p.exitCode !== EXIT_UNKNOWN) };
}
