// 门 5 跨进程只读异构自动盲审桥与非对称负评二次元验证消噪器（归属契约：verdict-core，<= 350 行）
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { VC_ITEMS, vcEvaluateVerdictMatrix, vcValidateSemiFormalProof } from './verify-consensus.mjs';
import { classifySandboxDenialOutput, sanitizeReviewEvidence, stripCrossSessionReasoning } from './review-evidence-sanitizer.mjs';

const GIB_BYTES = 1024 ** 3, GIB_PER_SLOT = 2;
export const VERIFIER_MEM_RESERVE_BYTES = GIB_PER_SLOT * GIB_BYTES;
export const MIN_CONCURRENT_VERIFIERS = 1, MAX_CONCURRENT_VERIFIERS = 3, DEFAULT_JUDGE_TIMEOUT_MS = 120_000;

export function computeMaxConcurrentVerifiers(freeMemBytes = freemem()) {
  const n = Number(freeMemBytes), safe = Number.isFinite(n) && n > 0 ? n : 0;
  return Math.min(MAX_CONCURRENT_VERIFIERS, Math.max(MIN_CONCURRENT_VERIFIERS, Math.floor(safe / VERIFIER_MEM_RESERVE_BYTES)));
}

export function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export function terminateProcessTree(pid, opts = {}) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: 'invalid-pid' };
  if ((opts.platform || process.platform) === 'win32') {
    const r = (opts.spawnSyncFn || spawnSync)('taskkill', ['/PID', String(n), '/T', '/F'], { shell: false, windowsHide: true, encoding: 'utf8' });
    return { ok: r?.status === 0, method: 'taskkill', shell: false, exitCode: r?.status ?? null };
  }
  const killFn = opts.killFn || process.kill, sig = opts.signal || 'SIGKILL';
  try {
    killFn(-n, sig);
    return { ok: true, method: 'process-group', target: -n };
  } catch (err) {
    void err;
  }
  try {
    killFn(n, sig);
    return { ok: true, method: 'direct-pid', target: n };
  } catch (err) {
    return { ok: false, method: 'direct-pid', code: err?.code || 'KILL_FAILED' };
  }
}

export function buildDataFreeBlockedReceipt(reasonCode, meta = {}) {
  const code = String(reasonCode || 'GUARDRAIL_BLOCKED').trim() || 'GUARDRAIL_BLOCKED';
  const safeTool = typeof meta?.toolName === 'string' ? meta.toolName.trim().slice(0, 80) : null;
  const rawBytes = typeof meta?.byteLength === 'number' ? meta.byteLength : Buffer.byteLength(String(meta?.rawOutput || ''), 'utf8');
  return Object.freeze({ schema: 'donegate-blocked-tool-receipt/v1', blocked: true, dataStripped: true, reasonCode: code, toolName: safeTool, redactedBytes: Math.max(0, Math.trunc(rawBytes)), message: `[DoneGate Guardrail] Tool output blocked (${code}); raw payload stripped.` });
}

function ajbParseJudgeJson(rawStdout) {
  const direct = stripCrossSessionReasoning(rawStdout).trim();
  const m = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const cand of [direct, m ? m[1].trim() : '']) {
    if (!cand) continue;
    try {
      return JSON.parse(cand);
    } catch (err) {
      void err;
    }
  }
  return null;
}

function ajbInterpretSpawnOutcome(r, opts) {
  if (r?.error?.code === 'ETIMEDOUT') {
    if (r.pid && isProcessAlive(r.pid)) terminateProcessTree(r.pid, opts);
    return { ok: false, exitCode: 3, state: 'unknown', reasonCode: 'judge-timeout' };
  }
  if (r?.blockedReasonCode) return { ok: false, exitCode: 2, state: 'fail', receipt: buildDataFreeBlockedReceipt(r.blockedReasonCode, r) };
  const status = r?.status ?? 1;
  if (status !== 0) {
    const d = classifySandboxDenialOutput(r?.stdout, r?.stderr, status);
    return d.sandboxDenied ? { ok: false, exitCode: 3, state: 'unknown', reasonCode: d.reasonCode, matchedPattern: d.matchedPattern } : { ok: false, exitCode: 3, state: 'unknown', reasonCode: 'judge-cli-error', stderr: String(r?.stderr || '').slice(0, 400) };
  }
  const parsed = ajbParseJudgeJson(r?.stdout || '');
  return (parsed && typeof parsed === 'object') ? { ok: true, exitCode: 0, verdict: parsed, runnerPid: r?.pid || process.pid } : { ok: false, exitCode: 3, state: 'unknown', reasonCode: 'invalid-judge-json' };
}

export function invokeCliJudgeSafely(cliSpec, stdinPayload, opts = {}) {
  if (!cliSpec || typeof cliSpec.bin !== 'string' || !cliSpec.bin.trim()) return { ok: false, exitCode: 3, state: 'unknown', reasonCode: 'missing-judge-bin' };
  const args = Array.isArray(cliSpec.args) ? cliSpec.args.map(String) : [];
  const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_JUDGE_TIMEOUT_MS;
  return ajbInterpretSpawnOutcome((opts.spawnSyncFn || spawnSync)(cliSpec.bin, args, { cwd: opts.cwd || process.cwd(), input: String(stdinPayload ?? ''), encoding: 'utf8', shell: false, windowsHide: true, timeout }), opts);
}

function ajbHydrateFromPackDir(packDir, state) {
  if (!packDir || !existsSync(packDir)) return '';
  const readSub = (sub, ext) => {
    const dir = join(packDir, sub), hit = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(ext)) : null;
    return hit ? (readMaybe(join(dir, hit)) || '') : '';
  };
  state.cid = state.cid || basename(resolve(packDir));
  state.contractText = state.contractText || readSub('criterion', '.json');
  state.diffText = state.diffText || readSub('diff', '.diff');
  for (const rel of ['contract-scope-why.md', '完成声称.md']) {
    const txt = readMaybe(join(packDir, rel));
    if (txt !== null) state.items.push({ kind: 'pack_doc', name: rel, content: txt });
  }
  return readMaybe(join(packDir, 'MANIFEST.txt')) || '';
}

function ajbLoadPackContext(projectRoot, packDir, opts) {
  const root = resolve(projectRoot), state = { cid: String(opts.contractId || '').trim(), diffText: String(opts.diffText || ''), contractText: String(opts.contractText || ''), items: Array.isArray(opts.evidenceItems) ? [...opts.evidenceItems] : [] };
  const manifestRaw = ajbHydrateFromPackDir(packDir, state);
  const governancePrefix = opts.governancePrefix || { intentMd: readMaybe(join(root, 'INTENT.md')), constraintsMd: readMaybe(join(root, 'CONSTRAINTS.md')), contractJson: state.cid ? readMaybe(join(root, 'contracts', state.cid, 'contract.json')) : null };
  const sanitizedEvidence = sanitizeReviewEvidence(state.items, { governancePrefix });
  return { root, contractId: state.cid || 'unknown-contract', diffText: state.diffText, contractText: state.contractText, sanitizedEvidence, packManifestSha256: opts.packManifestSha256 || sha256(manifestRaw || JSON.stringify(sanitizedEvidence)) };
}

async function ajbVerifyFailItemsWithMeta(ctx, rawVerdict, metaJudgeRunner) {
  const nextVerdict = { ...rawVerdict }, downgraded = [];
  let metaChecksRun = 0;
  for (const k of VC_ITEMS) {
    const entry = rawVerdict[k], val = typeof entry === 'string' ? entry : entry?.verdict;
    if (val !== 'fail') continue;
    const pChk = vcValidateSemiFormalProof(k, entry, 'fail');
    if (!pChk.ok) return { ok: false, exitCode: 3, code: pChk.code, stderr: pChk.reason };
    const cleanReason = stripCrossSessionReasoning(String(entry.reason || entry.rationale || ''));
    const rawTrace = entry.proof.executionTrace;
    const cleanProof = { premise: stripCrossSessionReasoning(String(entry.proof.premise || '')), executionTrace: Array.isArray(rawTrace) ? rawTrace.map((x) => stripCrossSessionReasoning(String(x))) : stripCrossSessionReasoning(String(rawTrace || '')), conclusion: stripCrossSessionReasoning(String(entry.proof.conclusion || '')) };
    if (typeof metaJudgeRunner !== 'function') {
      nextVerdict[k] = { verdict: 'fail', reason: cleanReason, proof: cleanProof };
      continue;
    }
    metaChecksRun++;
    const metaRes = await metaJudgeRunner({ contractId: ctx.contractId, itemKey: k, dropThought: true, contractText: ctx.contractText, diffText: ctx.diffText, sanitizedReason: cleanReason, proof: cleanProof });
    if (!(metaRes?.verifiedFail ?? (metaRes?.verdict === 'fail'))) {
      const metaWhy = stripCrossSessionReasoning(String(metaRes?.reason || metaRes?.metaReason || '二审判定反例路径不可达或属非契约挑刺'));
      nextVerdict[k] = { verdict: 'pass', reason: `初审负评经二审元验证消噪转 pass：${metaWhy}` };
      downgraded.push({ at: new Date().toISOString(), itemKey: k, originalReason: cleanReason, originalProof: cleanProof, metaReason: metaWhy, dropThought: true });
    } else nextVerdict[k] = { verdict: 'fail', reason: cleanReason, proof: cleanProof };
  }
  return { ok: true, verdict: nextVerdict, metaChecksRun, downgraded };
}

async function ajbInvokePrimaryJudge(ctx, maxConcurrency, opts) {
  if (typeof opts.judgeRunner === 'function') {
    const out = await opts.judgeRunner({ contractId: ctx.contractId, sanitizedEvidence: ctx.sanitizedEvidence, diffText: ctx.diffText, contractText: ctx.contractText, maxConcurrency });
    const parsed = typeof out === 'string' ? ajbParseJudgeJson(out) : out;
    return (parsed && typeof parsed === 'object') ? { ok: true, verdict: parsed } : { ok: false, exitCode: 3, state: 'unknown', stderr: '初审裁判未返回有效 JSON 判定书（退 3）' };
  }
  if (opts.cliJudge) return invokeCliJudgeSafely(opts.cliJudge, JSON.stringify({ contractId: ctx.contractId, evidence: ctx.sanitizedEvidence, diff: ctx.diffText }), opts);
  return { ok: false, exitCode: 3, state: 'unknown', stderr: '未提供 judgeRunner 或可用 cliJudge 配置（退 3）' };
}

export async function runAutoJudgeBridge(opts = {}) {
  const ctx = ajbLoadPackContext(opts.projectRoot || '.', opts.packDir, opts), maxConcurrency = computeMaxConcurrentVerifiers(opts.freeMemBytes);
  const primary = await ajbInvokePrimaryJudge(ctx, maxConcurrency, opts);
  if (!primary.ok) return primary;
  const { thought: _t, reasoning_content: _rc, ...restVerdict } = primary.verdict;
  let finalVerdict = { ...restVerdict, contractId: restVerdict.contractId || ctx.contractId };
  const allPass = VC_ITEMS.every((k) => (typeof finalVerdict[k] === 'string' ? finalVerdict[k] : finalVerdict[k]?.verdict) === 'pass');
  let metaChecksRun = 0, downgradedObservations = [], observePath = null;
  if (!allPass) {
    const mOut = await ajbVerifyFailItemsWithMeta(ctx, finalVerdict, opts.metaJudgeRunner);
    if (!mOut.ok) return mOut;
    finalVerdict = mOut.verdict;
    metaChecksRun = mOut.metaChecksRun;
    downgradedObservations = mOut.downgraded;
    if (downgradedObservations.length > 0) {
      const verifyDir = join(ctx.root, '.donegate', 'verify');
      mkdirSync(verifyDir, { recursive: true });
      observePath = join(verifyDir, `observe-${ctx.contractId}.json`);
      const prev = existsSync(observePath) ? (readJsonStrict(observePath).value?.observations || []) : [];
      writeFileSync(observePath, JSON.stringify({ schema: 'donegate-judge-observe/v1', contractId: ctx.contractId, observations: [...prev, ...downgradedObservations] }, null, 2) + '\n', 'utf8');
    }
  }
  const evalRes = vcEvaluateVerdictMatrix(finalVerdict, opts.envelopeOpts || {});
  if (!evalRes.ok) return evalRes;
  let exitCode = evalRes.hasUnknown ? 3 : 0;
  if (evalRes.isContradiction) exitCode = 2;
  else if (evalRes.hasFail) exitCode = 1;
  return { ok: exitCode === 0, exitCode, contractId: ctx.contractId, maxConcurrency, verdict: finalVerdict, metaChecksRun, downgradedObservations, observePath, sanitizedEvidence: ctx.sanitizedEvidence };
}

export async function cmdVerifyAutoJudge(projectRoot, pos = [], flags = {}) {
  const cliJudge = flags.judgeBin ? { bin: String(flags.judgeBin), args: flags.judgeArgs ? String(flags.judgeArgs).split(',') : [] } : null;
  return runAutoJudgeBridge({ projectRoot, packDir: pos[2] || flags.pack || null, contractId: flags.contract, cliJudge });
}

function ajbReadCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] || null) : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cmdVerifyAutoJudge(resolve(ajbReadCliArg('--root') || process.cwd()), [null, null, ajbReadCliArg('--pack')], { judgeBin: ajbReadCliArg('--judge-bin') }).then((res) => {
    console.log(JSON.stringify({ ok: res.ok, exitCode: res.exitCode, contractId: res.contractId }));
    process.exit(res.exitCode ?? 3);
  });
}
