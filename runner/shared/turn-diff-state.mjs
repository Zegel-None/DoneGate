// L0 回合级增量代码快照、工作树哈希乒乓环检测、流式复读 Stall 熔断与 Stop 防死锁熔断器（<= 300 行）
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { walkByExt } from '../../skill/fs-walk.mjs';
import { materialFingerprintOf, sha256, sha256Short } from '../../skill/hash.mjs';

export const TURN_STATE_TTL_MS = 30 * 60 * 1000;
export const MAX_STOP_STRIKES = 3;
export const DEFAULT_PING_PONG_HISTORY_WINDOW = 4;
export const DEFAULT_STALL_REPEAT_WINDOW_TOKENS = 20;
export const DEFAULT_STALL_REPEAT_MIN_CYCLES = 3;
export const DEFAULT_STALL_MIN_PHRASE_TOKENS = 3;
export const DEFAULT_STALL_MIN_DISTINCT_LEXICAL = 2;
const TDS_CODE_EXTS = ['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs'];
const TDS_CODE_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TDS_SKIP_PREFIX_RE = /^(?:\.donegate\/|node_modules\/|workflows\/\.deps\/|\.git\/)/;
const STALL_TOKEN_RE = /[A-Za-z0-9_$]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9_$\u4e00-\u9fff]/g;
const LEXICAL_TOKEN_RE = /[A-Za-z0-9_$\u4e00-\u9fff]/;
const STALL_TAIL_BUFFER_CYCLES = 2;
const STALL_SAMPLE_MAX_CHARS = 120;
const MIN_RING_CAP = 2;

function tdsSafeConvKey(conversationId) {
  const clean = String(conversationId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return clean || 'default';
}

export function resolveTurnStatePath(projectRoot, conversationId = 'default') {
  return join(resolve(projectRoot), '.donegate', 'scratch', `turn-state-${tdsSafeConvKey(conversationId)}.json`);
}

function tdsNormalizeGitRel(raw) {
  let rel = String(raw || '').trim();
  if (rel.includes(' -> ')) rel = rel.split(' -> ').pop().trim();
  return rel.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
}

function tdsReadGitHead(rootAbs) {
  const r = spawnSync('git', ['-C', rootAbs, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

function tdsCollectGitDirtyAndCommittedCode(rootAbs, baseHead = null) {
  const st = spawnSync('git', ['-C', rootAbs, '-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], {
    encoding: 'utf8', windowsHide: true, timeout: 8000
  });
  if (st.status !== 0) return null;
  const relSet = new Set();
  for (const line of (st.stdout || '').split(/\r?\n/)) {
    if (line.length < 4) continue;
    const rel = tdsNormalizeGitRel(line.slice(3));
    if (rel && TDS_CODE_RE.test(rel) && !TDS_SKIP_PREFIX_RE.test(rel)) relSet.add(rel);
  }
  const curHead = tdsReadGitHead(rootAbs);
  if (baseHead && curHead && baseHead !== curHead) {
    const df = spawnSync('git', ['-C', rootAbs, '-c', 'core.quotepath=false', 'diff', '--name-only', `${baseHead}..${curHead}`], {
      encoding: 'utf8', windowsHide: true, timeout: 8000
    });
    if (df.status === 0) {
      for (const raw of (df.stdout || '').split(/\r?\n/)) {
        const rel = tdsNormalizeGitRel(raw);
        if (rel && TDS_CODE_RE.test(rel) && !TDS_SKIP_PREFIX_RE.test(rel)) relSet.add(rel);
      }
    }
  }
  return { headSha: curHead, relFiles: [...relSet].sort() };
}

function tdsSnapshotWorkspaceCodeHashes(rootAbs, baseHead = null) {
  const gitScan = existsSync(join(rootAbs, '.git')) ? tdsCollectGitDirtyAndCommittedCode(rootAbs, baseHead) : null;
  const fileHashes = {};
  if (gitScan) {
    for (const rel of gitScan.relFiles) {
      const abs = join(rootAbs, rel);
      if (existsSync(abs)) {
        try { fileHashes[rel] = sha256(readFileSync(abs)); } catch (err) { void err; }
      }
    }
    return { isGit: true, headSha: gitScan.headSha, fileHashes };
  }
  const files = walkByExt(rootAbs, TDS_CODE_EXTS, { skipDirs: ['.git', 'node_modules', '.donegate', '.deps'] }).slice(0, 500);
  for (const abs of files) {
    const rel = relative(rootAbs, abs).replace(/\\/g, '/');
    if (!TDS_SKIP_PREFIX_RE.test(rel)) {
      try { fileHashes[rel] = sha256(readFileSync(abs)); } catch (err) { void err; }
    }
  }
  return { isGit: false, headSha: null, fileHashes };
}

export function loadTurnState(projectRoot, conversationId = 'default') {
  const p = resolveTurnStatePath(projectRoot, conversationId);
  if (!existsSync(p)) return null;
  try {
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    if (!obj || (Date.now() - Number(obj.updatedAt || 0)) > TURN_STATE_TTL_MS) return null;
    return obj;
  } catch {
    return null;
  }
}

function tdsSaveTurnState(projectRoot, conversationId, state) {
  const p = resolveTurnStatePath(projectRoot, conversationId);
  mkdirSync(dirname(p), { recursive: true });
  const next = { ...state, updatedAt: Date.now() };
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function tdsNormalizeHistoryEntry(raw = {}) {
  const touchedFiles = (Array.isArray(raw.touchedFiles) ? raw.touchedFiles : []).map((f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean).sort();
  const lineRanges = (Array.isArray(raw.lineRanges) ? raw.lineRanges : []).map((r) => (typeof r === 'string' ? r.trim() : `${r?.start ?? ''}-${r?.end ?? ''}`)).filter(Boolean);
  const filesDigest = String(raw.filesDigest || (raw.fileHashes ? materialFingerprintOf(raw.fileHashes) : '')).trim();
  return { filesDigest, errorSignature: String(raw.errorSignature ?? '').trim(), touchedFiles, lineRanges };
}

function tdsResolveIncrementalExemption(priorList, cand) {
  if (priorList.length === 0 || !cand.filesDigest || priorList.some((h) => h.filesDigest === cand.filesDigest)) return null;
  const prev = priorList[priorList.length - 1], prevSet = new Set(prev.touchedFiles || []);
  if (cand.touchedFiles.length > 0 && cand.touchedFiles.some((f) => !prevSet.has(f))) return 'cross-file-batch-progress';
  const prevRanges = new Set(prev.lineRanges || []);
  return (cand.lineRanges.length > 0 && cand.lineRanges.some((r) => !prevRanges.has(r))) ? 'distinct-line-range-progress' : null;
}

export function detectWorkspacePingPong(historyRing = [], candidate = {}, opts = {}) {
  const winCap = Math.max(MIN_RING_CAP, Number(opts.pingPongHistoryWindow ?? opts.profile?.pingPongHistoryWindow) || DEFAULT_PING_PONG_HISTORY_WINDOW);
  const prior = (Array.isArray(historyRing) ? historyRing : []).map(tdsNormalizeHistoryEntry).slice(-(winCap - 1));
  const cand = tdsNormalizeHistoryEntry(candidate), nextHistory = [...prior, cand];
  if (!cand.filesDigest) return { loopDetected: false, pingPong: false, exempted: false, exemptionReason: null, reasonCode: null, historyRing: nextHistory };
  for (let i = prior.length - MIN_RING_CAP; i >= 0; i--) {
    if (prior[i].filesDigest === cand.filesDigest && prior.slice(i + 1).some((mid) => mid.filesDigest !== cand.filesDigest)) {
      return { loopDetected: true, pingPong: true, exempted: false, exemptionReason: null, reasonCode: 'WORKSPACE_PING_PONG_LOOP', cycleLength: prior.length - i, matchedErrorSignature: cand.errorSignature || prior[i].errorSignature || null, historyRing: nextHistory };
    }
  }
  const exemption = tdsResolveIncrementalExemption(prior, cand);
  return { loopDetected: false, pingPong: false, exempted: Boolean(exemption), exemptionReason: exemption, reasonCode: null, historyRing: nextHistory };
}

export function recordTurnStepHistory(projectRoot, conversationId = 'default', stepInfo = {}, opts = {}) {
  const rootAbs = resolve(projectRoot), cur = loadTurnState(rootAbs, conversationId) || captureTurnBaseline(rootAbs, conversationId);
  const snap = stepInfo.fileHashes ? { fileHashes: stepInfo.fileHashes } : tdsSnapshotWorkspaceCodeHashes(rootAbs, cur.headSha || null);
  const prevMap = cur.lastStepHashes || cur.baselineHashes || {}, keys = new Set([...Object.keys(prevMap), ...Object.keys(snap.fileHashes)]);
  const touchedFiles = Array.isArray(stepInfo.touchedFiles) ? stepInfo.touchedFiles : [...keys].filter((k) => prevMap[k] !== snap.fileHashes[k]).sort();
  const rawErr = String(stepInfo.errorSignature ?? '').trim(), filesDigest = stepInfo.filesDigest || materialFingerprintOf(snap.fileHashes);
  const errorSignature = rawErr && stepInfo.hashErrorSignature ? sha256Short(rawErr) : rawErr;
  const loopRes = detectWorkspacePingPong(cur.historyRing || [], { filesDigest, errorSignature, touchedFiles, lineRanges: stepInfo.lineRanges || [] }, opts);
  const saved = tdsSaveTurnState(rootAbs, conversationId, { ...cur, historyRing: loopRes.historyRing, lastStepHashes: snap.fileHashes });
  return { ...loopRes, filesDigest, touchedFiles, state: saved };
}

function tdsHasRepeatingCycleAt(normTokens, endIdx, period, minCycles) {
  const start = endIdx - period * minCycles, lexicalSet = new Set();
  for (let j = 0; j < period; j++) {
    const baseTok = normTokens[start + j];
    if (LEXICAL_TOKEN_RE.test(baseTok)) lexicalSet.add(baseTok);
    for (let c = 1; c < minCycles; c++) { if (normTokens[start + c * period + j] !== baseTok) return false; }
  }
  return lexicalSet.size >= DEFAULT_STALL_MIN_DISTINCT_LEXICAL;
}

function tdsScanTokenPeriods(tailRaw, tailNorm, minPhrase, windowTokens, minCycles) {
  for (let period = minPhrase; period <= windowTokens; period++) {
    const needed = period * minCycles;
    if (tailNorm.length < needed) break;
    for (let endIdx = needed; endIdx <= tailNorm.length; endIdx++) {
      if (tdsHasRepeatingCycleAt(tailNorm, endIdx, period, minCycles)) return { period, sample: tailRaw.slice(endIdx - period, endIdx).join(' ').slice(0, STALL_SAMPLE_MAX_CHARS) };
    }
  }
  return null;
}

export function detectStreamingReasoningStall(textChunk, opts = {}) {
  const windowTokens = Math.max(DEFAULT_STALL_MIN_PHRASE_TOKENS, Number(opts.stallRepeatWindowTokens ?? opts.profile?.stallRepeatWindowTokens) || DEFAULT_STALL_REPEAT_WINDOW_TOKENS);
  const minCycles = Math.max(MIN_RING_CAP, Number(opts.stallRepeatMinCycles ?? opts.profile?.stallRepeatMinCycles) || DEFAULT_STALL_REPEAT_MIN_CYCLES);
  const minPhrase = Math.max(MIN_RING_CAP, Number(opts.minPhraseTokens) || DEFAULT_STALL_MIN_PHRASE_TOKENS);
  const cleaned = opts.scanCodeBlocks ? String(textChunk || '') : String(textChunk || '').replace(/```[\s\S]*?```/g, ' ');
  const tailRaw = (cleaned.match(STALL_TOKEN_RE) || []).slice(-(windowTokens * (minCycles + STALL_TAIL_BUFFER_CYCLES)));
  const hit = tdsScanTokenPeriods(tailRaw, tailRaw.map((t) => t.toLowerCase()), minPhrase, windowTokens, minCycles);
  if (!hit) return { stalled: false, action: 'continue', reasonCode: null, periodTokens: 0, repeatCycles: 0, repeatedSample: '' };
  return { stalled: true, action: 'abort-and-discard-turn', reasonCode: 'REASONING_LOOP_STALL', periodTokens: hit.period, repeatCycles: minCycles, repeatedSample: hit.sample };
}

export function captureTurnBaseline(projectRoot, conversationId = 'default', { forceReset = false } = {}) {
  const rootAbs = resolve(projectRoot);
  const existing = !forceReset ? loadTurnState(rootAbs, conversationId) : null;
  if (existing && existing.turnActive) {
    return tdsSaveTurnState(rootAbs, conversationId, existing);
  }
  const snap = tdsSnapshotWorkspaceCodeHashes(rootAbs, null);
  return tdsSaveTurnState(rootAbs, conversationId, {
    schema: 'donegate-turn-state/v1',
    conversationId: tdsSafeConvKey(conversationId),
    turnActive: true,
    headSha: snap.headSha,
    baselineHashes: snap.fileHashes,
    lastStepHashes: snap.fileHashes,
    historyRing: existing?.historyRing || [],
    verifiedHashes: existing?.verifiedHashes || {},
    stopStrikes: 0
  });
}

export function recordFileVerified(projectRoot, conversationId, relPath) {
  const rootAbs = resolve(projectRoot);
  const normRel = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = join(rootAbs, normRel);
  if (!normRel || !existsSync(abs)) return null;
  const digest = sha256(readFileSync(abs));
  const cur = loadTurnState(rootAbs, conversationId) || captureTurnBaseline(rootAbs, conversationId);
  cur.verifiedHashes = { ...(cur.verifiedHashes || {}), [normRel]: digest };
  return tdsSaveTurnState(rootAbs, conversationId, cur);
}

export function computeTurnDelta(projectRoot, conversationId = 'default') {
  const rootAbs = resolve(projectRoot);
  const state = loadTurnState(rootAbs, conversationId);
  const baseHashes = state?.baselineHashes || {};
  const verifiedHashes = state?.verifiedHashes || {};
  const snap = tdsSnapshotWorkspaceCodeHashes(rootAbs, state?.headSha || null);
  const allTouchedFiles = [];
  const unverifiedFiles = [];
  for (const [rel, curHash] of Object.entries(snap.fileHashes)) {
    if (baseHashes[rel] === curHash) continue;
    allTouchedFiles.push(rel);
    if (verifiedHashes[rel] !== curHash) unverifiedFiles.push(rel);
  }
  return { allTouchedFiles, unverifiedFiles, currentHashes: snap.fileHashes, filesDigest: materialFingerprintOf(snap.fileHashes), hasBaseline: Boolean(state) };
}

export function finishTurnCleanly(projectRoot, conversationId = 'default', verifiedRels = []) {
  const rootAbs = resolve(projectRoot);
  const cur = loadTurnState(rootAbs, conversationId);
  if (!cur) return;
  const verifiedHashes = { ...(cur.verifiedHashes || {}) };
  for (const rel of verifiedRels) {
    const abs = join(rootAbs, rel);
    if (existsSync(abs)) {
      try { verifiedHashes[rel] = sha256(readFileSync(abs)); } catch (err) { void err; }
    }
  }
  tdsSaveTurnState(rootAbs, conversationId, { ...cur, turnActive: false, stopStrikes: 0, verifiedHashes });
}

function tdsAppendCircuitBreakerWorryNote(rootAbs, conversationId, failingFiles) {
  const at = new Date().toISOString();
  const title = '随身质检连续三次未修绿触发防死锁放行';
  const detail = `会话 ${tdsSafeConvKey(conversationId)} 收尾拦截达 ${MAX_STOP_STRIKES} 次上限后自动熔断放行，待人工关注：${failingFiles.slice(0, 5).join(', ')}`;
  const sealPayload = {
    at, kind: 'worry', stage: 2, title, detail,
    verifyCmd: '', exitCode: null, stdoutSha256: '', evidencePath: '', evidenceSha256: ''
  };
  const entry = { ...sealPayload, noteHash: sha256(JSON.stringify(sealPayload)) };
  const notesPath = join(rootAbs, '.donegate', 'notes.jsonl');
  mkdirSync(dirname(notesPath), { recursive: true });
  appendFileSync(notesPath, JSON.stringify(entry) + '\n', 'utf8');
}

export function consumeStopStrike(projectRoot, conversationId = 'default', failingFiles = [], maxStrikes = MAX_STOP_STRIKES, opts = {}) {
  const rootAbs = resolve(projectRoot);
  const stepRes = recordTurnStepHistory(rootAbs, conversationId, { errorSignature: failingFiles.slice().sort().join(',') }, opts);
  const cur = stepRes.state;
  const nextStrike = Number(cur.stopStrikes || 0) + 1;
  if (nextStrike <= maxStrikes) {
    tdsSaveTurnState(rootAbs, conversationId, { ...cur, turnActive: true, stopStrikes: nextStrike });
    return { shouldBlock: true, strike: nextStrike, maxStrikes, circuitBroken: false, pingPong: stepRes.pingPong, reasonCode: stepRes.reasonCode };
  }
  tdsSaveTurnState(rootAbs, conversationId, { ...cur, turnActive: false, stopStrikes: 0 });
  try { tdsAppendCircuitBreakerWorryNote(rootAbs, conversationId, failingFiles); } catch (err) { void err; }
  return { shouldBlock: false, strike: nextStrike, maxStrikes, circuitBroken: true, pingPong: stepRes.pingPong, reasonCode: stepRes.reasonCode };
}

export function clearTurnState(projectRoot, conversationId = 'default') {
  try { rmSync(resolveTurnStatePath(projectRoot, conversationId), { force: true }); } catch (err) { void err; }
}
