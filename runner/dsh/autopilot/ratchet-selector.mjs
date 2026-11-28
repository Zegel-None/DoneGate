// 拓扑挂机组件级最佳树棘轮选择器（git write-tree 零污染快照、判据退化/语法崩盘自动回滚与状态错题本记录）
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict } from '../../../skill/io.mjs';
import { hagSanitizeId } from '../../shared/subagent-env.mjs';
import { cleanGitEnv } from './autopilot-worktree.mjs';

export const REJECTED_PATCHES_SCHEMA = 'donegate-rejected-patches/v1';

const EXECUTABLE_GIT_MODE = '100755', EXECUTABLE_FILE_PERM = 0o755;
const MAX_RECENT_HANDOFF_ENTRIES = 2, SHORT_HASH_DISPLAY_LEN = 12, MAX_DIFF_SUMMARY_PREVIEW_LINES = 6;
const JS_CHECK_EXT_RE = /\.(?:mjs|cjs|js)$/i;
const SYNTAX_DIAG_RE = /\bSyntaxError\b|M1\s+JS\/ESM\s+语法错误|M5\s+JSONL?\s+.*损坏|括号\/大括号未闭合失衡/;
let tempIndexCounter = 0;

function rsIsInternalMetaPath(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  return !norm || norm.startsWith('.donegate/') || norm.startsWith('workflows/.deps/');
}

function rsRunGit(cwd, args, extraEnv = null) {
  const env = extraEnv ? { ...cleanGitEnv(), ...extraEnv } : cleanGitEnv();
  return spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', env, windowsHide: true });
}

export function captureGitWorkingTreeSha(workCwd) {
  const cwd = resolve(workCwd);
  const inside = rsRunGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') return null;
  const tmpDir = join(cwd, '.donegate', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  tempIndexCounter += 1;
  const tempIndex = join(tmpDir, `ratchet-index-${process.pid}-${Date.now()}-${tempIndexCounter}`);
  const idxEnv = { GIT_INDEX_FILE: tempIndex };
  try {
    const head = rsRunGit(cwd, ['rev-parse', '--verify', 'HEAD']);
    if (head.status === 0 && (head.stdout || '').trim()) rsRunGit(cwd, ['read-tree', 'HEAD'], idxEnv);
    rsRunGit(cwd, ['add', '-A', '--', '.', ':!.donegate', ':!workflows/.deps'], idxEnv);
    const wt = rsRunGit(cwd, ['write-tree'], idxEnv), sha = (wt.stdout || '').trim();
    return wt.status === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } finally {
    if (existsSync(tempIndex)) {
      try { unlinkSync(tempIndex); } catch (err) { void err; }
    }
  }
}

function rsParseLsTreeEntries(rawStdout) {
  const entries = new Map();
  for (const chunk of String(rawStdout || '').split('\0')) {
    const tabIdx = chunk ? chunk.indexOf('\t') : -1;
    if (tabIdx < 0) continue;
    const meta = chunk.slice(0, tabIdx).trim().split(/\s+/), relPath = chunk.slice(tabIdx + 1).replace(/\\/g, '/');
    if (meta.length >= 3 && meta[1] === 'blob' && !rsIsInternalMetaPath(relPath)) entries.set(relPath, { mode: meta[0], blobSha: meta[2] });
  }
  return entries;
}

function rsCollectCurrentWorkingFiles(cwd) {
  const files = new Set();
  for (const args of [['ls-files', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    for (const rel of String(rsRunGit(cwd, args).stdout || '').split('\0')) {
      if (rel && !rsIsInternalMetaPath(rel)) files.add(rel.replace(/\\/g, '/'));
    }
  }
  return files;
}

function rsWriteBlobToDisk(cwd, relPath, entry) {
  const blobRes = spawnSync('git', ['-C', cwd, 'cat-file', 'blob', entry.blobSha], { env: cleanGitEnv(), windowsHide: true });
  if (blobRes.status !== 0 || !Buffer.isBuffer(blobRes.stdout)) return false;
  const abs = join(cwd, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, blobRes.stdout);
  if (entry.mode === EXECUTABLE_GIT_MODE) {
    try { chmodSync(abs, EXECUTABLE_FILE_PERM); } catch (err) { void err; }
  }
  return true;
}

export function restoreGitWorkingTreeFromSha(workCwd, treeSha) {
  const cwd = resolve(workCwd);
  if (!treeSha || !/^[0-9a-f]{40}$/i.test(treeSha)) return { ok: false, restoredCount: 0 };
  const lsRes = rsRunGit(cwd, ['ls-tree', '-r', '-z', treeSha]);
  if (lsRes.status !== 0) return { ok: false, restoredCount: 0 };
  const targetEntries = rsParseLsTreeEntries(lsRes.stdout);
  let removedCount = 0, restoredCount = 0;
  for (const curRel of rsCollectCurrentWorkingFiles(cwd)) {
    if (!targetEntries.has(curRel) && existsSync(join(cwd, curRel))) {
      try { unlinkSync(join(cwd, curRel)); removedCount += 1; } catch (err) { void err; }
    }
  }
  for (const [relPath, entry] of targetEntries.entries()) {
    if (rsWriteBlobToDisk(cwd, relPath, entry)) restoredCount += 1;
  }
  return { ok: true, treeSha, restoredCount, removedCount };
}

export function summarizeTreeDiff(workCwd, fromTreeSha, toTreeSha) {
  const cwd = resolve(workCwd);
  if (!fromTreeSha || !toTreeSha || fromTreeSha === toTreeSha) return '(working tree unchanged)';
  const statTxt = (rsRunGit(cwd, ['diff-tree', '-r', '--stat', fromTreeSha, toTreeSha]).stdout || '').trim();
  const patchLines = (rsRunGit(cwd, ['diff', '--unified=1', fromTreeSha, toTreeSha]).stdout || '').trim().split(/\r?\n/).filter((l) => !l.startsWith('index '));
  return [statTxt, ...patchLines].filter(Boolean).join('\n').trim();
}

function rsCheckSingleFileSyntax(absPath, relPath) {
  if (extname(relPath).toLowerCase() === '.json') {
    try { JSON.parse(readFileSync(absPath, 'utf8')); return null; } catch (e) { return `JSON 语法损坏 (${relPath}): ${e.message}`; }
  }
  if (!JS_CHECK_EXT_RE.test(relPath)) return null;
  const chk = spawnSync(process.execPath, ['--check', absPath], { encoding: 'utf8', windowsHide: true });
  if (chk.status === 0) return null;
  const firstErr = String(chk.stderr || '').trim().split(/\r?\n/).find((l) => /SyntaxError/.test(l)) || 'SyntaxError';
  return `JS 语法崩盘 (${relPath}): ${firstErr.trim()}`;
}

export function detectWorkingTreeSyntaxCrash(workCwd, candidateFiles = [], subOut = null) {
  const cwd = resolve(workCwd);
  for (const rel of candidateFiles || []) {
    if (rsIsInternalMetaPath(rel) || !existsSync(join(cwd, rel))) continue;
    const err = rsCheckSingleFileSyntax(join(cwd, rel), rel);
    if (err) return { crashed: true, detail: err };
  }
  const diagTexts = [subOut?.reason || '', subOut?.handoff || '', ...(subOut?.checkpoint?.completedNodes || []).map((n) => n.diagSummary || '')].join('\n');
  if (SYNTAX_DIAG_RE.test(diagTexts)) return { crashed: true, detail: diagTexts.split(/\r?\n/).find((l) => SYNTAX_DIAG_RE.test(l))?.trim() || 'SyntaxError' };
  return { crashed: false, detail: '' };
}

export function extractAttemptGateScore(subOut) {
  let obligationPassed = 0, hasObligationBreakdown = false;
  for (const item of Array.isArray(subOut?.checkpoint?.completedNodes) ? subOut.checkpoint.completedNodes : []) {
    const diag = String(item?.diagSummary || '');
    const m = diag.match(/\bpassed=(\d+)\/(\d+)\b/) || diag.match(/"passed"\s*:\s*(\d+)/);
    if (m) {
      hasObligationBreakdown = true;
      obligationPassed += Number(m[1]);
    }
  }
  if (hasObligationBreakdown) return obligationPassed;
  const handoffMatch = String(subOut?.handoff || '').match(/\bpassed=(\d+)\/(\d+)\b/);
  if (handoffMatch) return Number(handoffMatch[1]);
  return typeof subOut?.checkpoint?.passedGates === 'number' ? subOut.checkpoint.passedGates : (subOut?.ok ? 1 : 0);
}

export function rejectedPatchesPathOf(projectRoot, campaignId) {
  return join(resolve(projectRoot), '.donegate', 'runs', `${hagSanitizeId(campaignId, 'campaign')}-rejected-patches.json`);
}

export function loadRejectedPatchesLedger(projectRoot, campaignId) {
  const filePath = rejectedPatchesPathOf(projectRoot, campaignId);
  const parsed = existsSync(filePath) ? readJsonStrict(filePath) : { ok: false };
  if (parsed.ok && parsed.value && Array.isArray(parsed.value.entries)) return parsed.value;
  return { schema: REJECTED_PATCHES_SCHEMA, campaignId: hagSanitizeId(campaignId, 'campaign'), entries: [] };
}

export function recordRejectedPatchEntry(projectRoot, campaignId, entry) {
  const filePath = rejectedPatchesPathOf(projectRoot, campaignId);
  mkdirSync(dirname(filePath), { recursive: true });
  const ledger = loadRejectedPatchesLedger(projectRoot, campaignId);
  const stateHash = sha256(`${entry.componentId}|${entry.bestTreeSha || ''}|${entry.diffSummary || ''}`);
  const existing = ledger.entries.find((e) => e.stateHash === stateHash), now = new Date().toISOString();
  if (existing) {
    existing.occurrences = Number(existing.occurrences || 1) + 1;
    existing.updatedAt = now;
  } else {
    ledger.entries.push({
      componentId: entry.componentId, round: entry.round, stateHash, bestTreeSha: entry.bestTreeSha,
      rejectedTreeSha: entry.rejectedTreeSha, bestPassedGates: entry.bestPassedGates, candidatePassedGates: entry.candidatePassedGates,
      syntaxCrash: Boolean(entry.syntaxCrash), reason: entry.reason || '', diffSummary: entry.diffSummary || '', occurrences: 1, recordedAt: now
    });
  }
  ledger.updatedAt = now;
  writeFileSync(filePath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  return { filePath, ledger, stateHash };
}

export function formatRejectedPatchesHandoff(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const lines = ['[棘轮错题本 · 严禁重踩以下已退化回滚的失败改法]'];
  for (const item of entries.slice(-MAX_RECENT_HANDOFF_ENTRIES)) {
    const tag = item.syntaxCrash ? '语法崩盘' : `通过数退化 ${item.bestPassedGates}->${item.candidatePassedGates}`;
    lines.push(`- [round=${item.round} | ${tag} | state=${item.stateHash.slice(0, SHORT_HASH_DISPLAY_LEN)}] ${item.reason}`);
    if (item.diffSummary) lines.push(`  Diff摘要: ${item.diffSummary.split(/\r?\n/).slice(0, MAX_DIFF_SUMMARY_PREVIEW_LINES).join(' ; ')}`);
  }
  return lines.join('\n');
}

export function evaluateAndApplyRatchetStep(params) {
  const { projectRoot, campaignId, componentId, workCwd, ratchet, round, touchedFiles, subOut } = params;
  const candidateTreeSha = captureGitWorkingTreeSha(workCwd);
  const syntaxRes = detectWorkingTreeSyntaxCrash(workCwd, touchedFiles, subOut);
  const candidatePassedGates = syntaxRes.crashed ? 0 : extractAttemptGateScore(subOut);
  const regressed = Boolean(ratchet.bestTreeSha && candidateTreeSha && candidateTreeSha !== ratchet.bestTreeSha && (syntaxRes.crashed || candidatePassedGates < ratchet.bestPassedGates));

  if (regressed) {
    const diffSummary = summarizeTreeDiff(workCwd, ratchet.bestTreeSha, candidateTreeSha);
    restoreGitWorkingTreeFromSha(workCwd, ratchet.bestTreeSha);
    const reason = syntaxRes.crashed ? syntaxRes.detail : `已通过门禁数从 ${ratchet.bestPassedGates} 退化至 ${candidatePassedGates}`;
    const rec = recordRejectedPatchEntry(projectRoot, campaignId, {
      componentId, round, bestTreeSha: ratchet.bestTreeSha, rejectedTreeSha: candidateTreeSha,
      bestPassedGates: ratchet.bestPassedGates, candidatePassedGates, syntaxCrash: syntaxRes.crashed, reason, diffSummary
    });
    ratchet.rollbacks += 1;
    ratchet.lastRollback = { round, restoredToTreeSha: ratchet.bestTreeSha, rejectedTreeSha: candidateTreeSha, reason, stateHash: rec.stateHash, ledgerPath: rec.filePath };
    return { action: 'rolled_back', candidatePassedGates, syntaxCrash: syntaxRes.crashed, ledgerPath: rec.filePath };
  }
  if (!syntaxRes.crashed && candidateTreeSha && candidatePassedGates >= ratchet.bestPassedGates) {
    ratchet.bestTreeSha = candidateTreeSha;
    ratchet.bestPassedGates = candidatePassedGates;
  }
  return { action: 'kept', candidatePassedGates, syntaxCrash: syntaxRes.crashed, ledgerPath: null };
}
