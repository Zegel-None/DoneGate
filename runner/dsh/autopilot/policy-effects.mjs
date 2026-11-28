#!/usr/bin/env node
// L3 治理策略指纹计算、在途契约失配重算与 GC 漂移巡检入口（归属契约：governance-autopilot，<= 130 行）
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict, readMaybe } from '../../../skill/io.mjs';
import { GOVERNANCE_OVERRIDES_REL } from '../../core/contract.mjs';
import { runAutopilotGcAudit } from './autopilot-gc.mjs';

const DIGEST_KEYS = ['intentHash', 'constraintsHash', 'overlayHash'];

function peHashDoc(absPath, tag) {
  const raw = readMaybe(absPath);
  return raw === null ? sha256(`__MISSING__:${tag}`) : sha256(raw.replace(/\r\n/g, '\n'));
}

function peStripVolatileOverlayMeta(val) {
  if (!val || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(peStripVolatileOverlayMeta);
  const out = {};
  for (const k of Object.keys(val).sort()) {
    if (k !== 'updatedAt' && k !== 'confirmedAt') out[k] = peStripVolatileOverlayMeta(val[k]);
  }
  return out;
}

function peComputeOverlayHash(root) {
  const entries = [];
  const rootOverlayPath = join(root, '.donegate', 'governance-overlay.json');
  const rootRaw = readMaybe(rootOverlayPath);
  if (rootRaw !== null) {
    const parsed = readJsonStrict(rootOverlayPath);
    entries.push(['governance-overlay.json', parsed.ok ? peStripVolatileOverlayMeta(parsed.value) : rootRaw.trim()]);
  }
  const ovDir = join(root, GOVERNANCE_OVERRIDES_REL);
  const ovNames = existsSync(ovDir) ? readdirSync(ovDir).filter((n) => n.endsWith('.overlay.json')).sort() : [];
  for (const name of ovNames) {
    const r = readJsonStrict(join(ovDir, name));
    entries.push([name, r.ok ? peStripVolatileOverlayMeta(r.value) : null]);
  }
  return sha256(JSON.stringify(entries));
}

export function computeGovernancePolicyDigest(projectRoot) {
  const root = resolve(projectRoot);
  const intentHash = peHashDoc(join(root, 'INTENT.md'), 'INTENT.md');
  const constraintsHash = peHashDoc(join(root, 'CONSTRAINTS.md'), 'CONSTRAINTS.md');
  const overlayHash = peComputeOverlayHash(root);
  return { policyVersion: sha256(`${intentHash}:${constraintsHash}:${overlayHash}`), intentHash, constraintsHash, overlayHash };
}

function peListSubdirs(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function peScanAffectedTargets(root, changedFields) {
  const affectedContracts = [];
  for (const name of peListSubdirs(join(root, 'contracts'))) {
    const doc = readJsonStrict(join(root, 'contracts', name, 'contract.json')).value;
    if (!doc || doc.retired === true || doc.status === 'retired') continue;
    affectedContracts.push({ contractId: String(doc.id || name), status: 'stale', reasonCode: 'policy-changed', changedFields: [...changedFields] });
  }
  affectedContracts.sort((a, b) => a.contractId.localeCompare(b.contractId));
  const affectedVerifyPacks = peListSubdirs(join(root, '.donegate', 'verify')).map((packId) => ({
    packId, packPath: `.donegate/verify/${packId}`, status: 'stale', reasonCode: 'policy-changed', changedFields: [...changedFields]
  }));
  return { affectedContracts, affectedVerifyPacks };
}

function peDiffDigestFields(prevDigest, next) {
  if (!prevDigest || typeof prevDigest !== 'object') return [];
  const changed = DIGEST_KEYS.filter((k) => Boolean(prevDigest[k]) && prevDigest[k] !== next[k]);
  if (changed.length === 0 && prevDigest.policyVersion && prevDigest.policyVersion !== next.policyVersion) return ['policyVersion'];
  return changed;
}

export function evaluateInFlightPolicyEffects(projectRoot, prevDigest, nextDigest, opts = {}) {
  const root = resolve(projectRoot);
  const next = nextDigest || computeGovernancePolicyDigest(root);
  const changedFields = peDiffDigestFields(prevDigest, next);
  const policyChanged = changedFields.length > 0;
  const targets = policyChanged ? peScanAffectedTargets(root, changedFields) : { affectedContracts: [], affectedVerifyPacks: [] };
  const payload = {
    schema: 'donegate-policy-effects/v1', evaluatedAt: new Date().toISOString(),
    policyChanged, status: policyChanged ? 'stale' : 'clean', reasonCode: policyChanged ? 'policy-changed' : null,
    changedFields, previousDigest: prevDigest || null, currentDigest: next, ...targets
  };
  let outPath = null;
  if (opts.write || opts.persist || opts.outPath) {
    outPath = opts.outPath ? resolve(root, opts.outPath) : join(root, '.donegate', 'policy-effects.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  }
  return { ok: true, ...payload, outPath };
}

export function runAutopilotGcWithPolicySweep(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const prev = readJsonStrict(join(root, '.donegate', 'policy-effects.json')).value?.currentDigest || null;
  const policyEffects = evaluateInFlightPolicyEffects(root, prev, computeGovernancePolicyDigest(root), { write: opts.writePolicy !== false });
  return { ...runAutopilotGcAudit(root, opts), policyEffects };
}

function peRunCli(argv) {
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  const prev = readJsonStrict(join(root, '.donegate', 'policy-effects.json')).value?.currentDigest || null;
  const res = argv.includes('--gc-audit') ? runAutopilotGcWithPolicySweep(root) : evaluateInFlightPolicyEffects(root, prev, null, { write: true });
  console.log(argv.includes('--json') ? JSON.stringify(res, null, 2) : (res.summary || `policy=${res.status}`));
  return res.exitCode ?? 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(peRunCli(process.argv.slice(2)));
