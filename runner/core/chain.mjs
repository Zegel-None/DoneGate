// L0 哈希链与冻结-实现绑定核验（02-规格.md §八 & §8.2.2，零第三方依赖）
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256, sortKeysDeep } from '../../skill/hash.mjs';

export const ZERO_HASH = '0'.repeat(64);

export function chainEntryHash(entry) {
  return sha256(JSON.stringify(sortKeysDeep(entry)));
}

export function readAndVerifyChain(projectRoot) {
  const p = join(projectRoot, '.donegate', 'chain.jsonl');
  if (!existsSync(p)) return { ok: true, entries: [], path: p };
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { return { ok: false, exitCode: 3, reason: 'chain.jsonl 不可读：' + e.message, entries: [] }; }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch (e) { return { ok: false, exitCode: 2, reason: `chain.jsonl 第 ${i + 1} 行 JSON 损坏`, entries }; }
    if (!obj || obj.seq !== i + 1) {
      return { ok: false, exitCode: 2, reason: `chain.jsonl seq 跳号或非 1 起步：第 ${i + 1} 行 seq=${obj && obj.seq}`, entries };
    }
    const expectedPrev = i === 0 ? ZERO_HASH : chainEntryHash(entries[i - 1]);
    if (obj.prevHash !== expectedPrev) {
      return { ok: false, exitCode: 2, reason: `chain.jsonl 第 ${i + 1} 行 prevHash 断裂`, entries };
    }
    entries.push(obj);
  }
  return { ok: true, entries, path: p };
}

export function appendChainEntry(projectRoot, fields) {
  const verified = readAndVerifyChain(projectRoot);
  if (!verified.ok) return verified;
  const entries = verified.entries;
  const seq = entries.length + 1;
  const prevHash = entries.length === 0 ? ZERO_HASH : chainEntryHash(entries[entries.length - 1]);
  const entry = {
    seq,
    ...fields,
    prevHash,
    recordedAt: fields.recordedAt || new Date().toISOString()
  };
  mkdirSync(dirname(verified.path), { recursive: true });
  appendFileSync(verified.path, JSON.stringify(entry) + '\n', 'utf8');
  return { ok: true, entry, entries: [...entries, entry] };
}

export function verifyFreezeImplementRun(projectRoot, contractId, runRecord) {
  const verified = readAndVerifyChain(projectRoot);
  if (!verified.ok) return verified;
  const entries = verified.entries;
  const freezes = entries.filter((e) => e.kind === 'freeze' && e.contractId === contractId);
  const impls = entries.filter((e) => e.kind === 'implement' && e.contractId === contractId);
  if (freezes.length === 0) return { ok: false, exitCode: 1, reason: `契约 ${contractId} 无 freeze 记录` };
  const latestImpl = impls[impls.length - 1];
  const latestFreeze = latestImpl && latestImpl.frozenSeq
    ? freezes.find((f) => f.seq === latestImpl.frozenSeq)
    : freezes[freezes.length - 1];
  if (!latestFreeze) return { ok: false, exitCode: 2, reason: `implement.frozenSeq 未命中有效 freeze` };

  if (latestFreeze.freezeCommit) {
    const gitChk = spawnSync('git', ['-C', projectRoot, 'cat-file', '-e', latestFreeze.freezeCommit + '^{commit}'], { encoding: 'utf8' });
    if (gitChk.status !== 0) return { ok: false, exitCode: 2, reason: `freezeCommit ${latestFreeze.freezeCommit} 在 git 中不存在` };
  }
  if (latestImpl) {
    if (!latestImpl.versionRange || latestImpl.versionRange.base !== latestFreeze.freezeCommit) {
      return { ok: false, exitCode: 2, reason: `① implement.versionRange.base (${latestImpl.versionRange?.base}) ≠ freeze.freezeCommit (${latestFreeze.freezeCommit})` };
    }
    if (runRecord && runRecord.head !== latestImpl.versionRange.head) {
      return { ok: false, exitCode: 3, reason: `③ run.head (${runRecord.head}) ≠ implement.versionRange.head (${latestImpl.versionRange.head})` };
    }
  }
  if (runRecord && latestFreeze.criteriaHashes && runRecord.criterionId) {
    const expectedHash = latestFreeze.criteriaHashes[runRecord.criterionId];
    if (expectedHash && runRecord.criteriaHash !== expectedHash) {
      return { ok: false, exitCode: 2, reason: `② run.criteriaHash 与独立冻结记录不符` };
    }
  }
  return { ok: true, freeze: latestFreeze, implement: latestImpl || null };
}
