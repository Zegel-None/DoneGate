// L0 回合级增量代码快照、文件指纹去重缓存与 Stop 连续 3 次拦截防死锁熔断器（<= 205 行）
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { walkByExt } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';

export const TURN_STATE_TTL_MS = 30 * 60 * 1000;
export const MAX_STOP_STRIKES = 3;
const TDS_CODE_EXTS = ['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs'];
const TDS_CODE_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TDS_SKIP_PREFIX_RE = /^(?:\.donegate\/|node_modules\/|workflows\/\.deps\/|\.git\/)/;

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
  return { allTouchedFiles, unverifiedFiles, currentHashes: snap.fileHashes, hasBaseline: Boolean(state) };
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

export function consumeStopStrike(projectRoot, conversationId = 'default', failingFiles = [], maxStrikes = MAX_STOP_STRIKES) {
  const rootAbs = resolve(projectRoot);
  const cur = loadTurnState(rootAbs, conversationId) || captureTurnBaseline(rootAbs, conversationId);
  const nextStrike = Number(cur.stopStrikes || 0) + 1;
  if (nextStrike <= maxStrikes) {
    tdsSaveTurnState(rootAbs, conversationId, { ...cur, turnActive: true, stopStrikes: nextStrike });
    return { shouldBlock: true, strike: nextStrike, maxStrikes, circuitBroken: false };
  }
  tdsSaveTurnState(rootAbs, conversationId, { ...cur, turnActive: false, stopStrikes: 0 });
  try { tdsAppendCircuitBreakerWorryNote(rootAbs, conversationId, failingFiles); } catch (err) { void err; }
  return { shouldBlock: false, strike: nextStrike, maxStrikes, circuitBroken: true };
}

export function clearTurnState(projectRoot, conversationId = 'default') {
  try { rmSync(resolveTurnStatePath(projectRoot, conversationId), { force: true }); } catch (err) { void err; }
}
