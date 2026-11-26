// Base-Branch / 只读镜像 Held-Out 判据防篡改校核器与结构化自首单（ConfessionReport，<= 180 行）
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { frozenHashOf, sha256Short } from '../../skill/hash.mjs';
import { readJsonStrict } from '../../skill/io.mjs';

const HV_PROTECTED_GATE_RE = /^(?:\.githooks\/|skill\/check-[^/]+\.mjs$)/;
const HV_VALID_RISKS = new Set(['low', 'medium', 'high']);

export function hvReadGitObjectAtRef(projectRoot, ref, relPath) {
  if (!ref || !relPath) return { ok: false, content: null };
  const cleanRel = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  const r = spawnSync('git', ['-C', resolve(projectRoot), 'show', `${ref}:${cleanRel}`], {
    encoding: 'utf8', windowsHide: true, timeout: 15000
  });
  if (r.error || r.status !== 0) return { ok: false, content: null };
  return { ok: true, content: r.stdout || '' };
}

export function hvLoadHeldOutContract(projectRoot, contractId, opts = {}) {
  const root = resolve(projectRoot);
  if (opts.heldOutDir) {
    const baseDir = resolve(root, opts.heldOutDir);
    const cands = [
      join(baseDir, contractId, 'contract.json'),
      join(baseDir, 'contracts', contractId, 'contract.json'),
      join(baseDir, `${contractId}.contract.json`)
    ];
    for (const p of cands) {
      if (!existsSync(p)) continue;
      const r = readJsonStrict(p);
      if (r.ok && r.value) return { available: true, source: `heldout-dir:${p}`, contract: r.value };
      return { available: true, corrupt: true, source: `heldout-dir:${p}`, contract: null };
    }
  }
  const baseRef = typeof opts.baseRef === 'string' ? opts.baseRef.trim() : '';
  if (!baseRef) return { available: false, reason: 'no-base-ref', contract: null };
  const gitObj = hvReadGitObjectAtRef(root, baseRef, `contracts/${contractId}/contract.json`);
  if (!gitObj.ok) return { available: false, reason: 'not-in-base', contract: null };
  try {
    return { available: true, source: `git:${baseRef}`, contract: JSON.parse(gitObj.content) };
  } catch {
    return { available: true, corrupt: true, source: `git:${baseRef}`, contract: null };
  }
}

export function hvCheckProtectedGateFiles(contractId, touchedFiles = []) {
  if (contractId === 'gate-tooling') return [];
  const hits = [];
  for (const raw of touchedFiles || []) {
    const rel = String(raw || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (HV_PROTECTED_GATE_RE.test(rel)) {
      hits.push(`HELDOUT_GATE_TAMPERED: 非 gate-tooling 契约 (${contractId}) 严禁修改守门资产 ${rel}`);
    }
  }
  return hits;
}

function hvCompareFrozenObligation(baseOb, curOb, fails) {
  if (!curOb) {
    fails.push(`HELDOUT_CONTRACT_TAMPERED: 基线已冻结判据 ${baseOb.id} 在当前分支被删除`);
    return;
  }
  const curComputed = frozenHashOf(curOb);
  if (curOb.frozenHash && curOb.frozenHash !== curComputed) {
    fails.push(`HELDOUT_CONTRACT_TAMPERED: 判据 ${baseOb.id} 的 frozenHash 与正文不匹配（疑似未重签私改）`);
    return;
  }
  const baseHash = baseOb.frozenHash || frozenHashOf(baseOb);
  if (curComputed !== baseHash) {
    fails.push(`HELDOUT_CONTRACT_TAMPERED: 判据 ${baseOb.id} 偏离基线只读冻结哈希 (${baseHash.slice(0, 10)})，分支内禁止私改或代签判据`);
  }
}

export function verifyHeldOutContract(projectRoot, contract, opts = {}) {
  const cid = contract?.id || opts.contractId || '';
  if (!cid) return { ok: true, checked: false, reason: 'missing-id', fails: [] };
  const gateTamper = hvCheckProtectedGateFiles(cid, opts.touchedFiles);
  if (gateTamper.length > 0) {
    return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_GATE_TAMPERED', fails: gateTamper };
  }
  const held = hvLoadHeldOutContract(projectRoot, cid, opts);
  if (!held.available) return { ok: true, checked: false, reason: held.reason, fails: [] };
  if (held.corrupt || !held.contract) {
    return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_CONTRACT_TAMPERED', fails: [`HELDOUT_CONTRACT_TAMPERED: 基线判据镜像损坏 (${held.source})`] };
  }
  const baseObs = Array.isArray(held.contract.obligations) ? held.contract.obligations : [];
  const curById = new Map((Array.isArray(contract?.obligations) ? contract.obligations : []).map((o) => [o.id, o]));
  const fails = [];
  for (const b of baseObs) {
    if (!b || !b.id) continue;
    const isFrozenInBase = Boolean(b.signedBy && String(b.signedBy).trim() && b.frozenHash);
    if (isFrozenInBase) hvCompareFrozenObligation(b, curById.get(b.id), fails);
  }
  if (fails.length > 0) {
    return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_CONTRACT_TAMPERED', baseSource: held.source, fails };
  }
  return { ok: true, checked: true, exitCode: 0, baseSource: held.source, fails: [] };
}

export function hvBuildConfessionReport(rawInput, evidenceSeed = '') {
  if (!rawInput) return null;
  let obj = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      try { obj = JSON.parse(trimmed); } catch { return null; }
    } else if (existsSync(trimmed)) {
      try { obj = JSON.parse(readFileSync(trimmed, 'utf8')); } catch { return null; }
    } else {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const toList = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12) : []);
  const riskRaw = String(obj.shortcutRisk || 'low').trim().toLowerCase();
  const payload = {
    untestedEdges: toList(obj.untestedEdges),
    assumptions: toList(obj.assumptions),
    shortcutRisk: HV_VALID_RISKS.has(riskRaw) ? riskRaw : 'medium'
  };
  return {
    ...payload,
    evidenceHash: sha256Short(`${JSON.stringify(payload)}|${String(evidenceSeed || '')}`, 16)
  };
}
