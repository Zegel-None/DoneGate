#!/usr/bin/env node
// L3 治理策略指纹计算、子层 Overlay 单调收紧校验与在途契约重算（归属契约：governance-autopilot，<= 255 行）
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict, readMaybe } from '../../../skill/io.mjs';
import { GOVERNANCE_OVERRIDES_REL } from '../../core/contract.mjs';
import { runAutopilotGcAudit } from './autopilot-gc.mjs';
import { validateEgressAllowlist } from './egress-allowlist-proxy.mjs';

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

function peNormList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => String(x || '').trim()).filter(Boolean);
}

function peExtractEffectSets(policy = {}) {
  const deny = new Set([...peNormList(policy.deny), ...peNormList(policy.deniedPaths), ...peNormList(policy.deniedCommands)]);
  const allow = new Set([...peNormList(policy.allow), ...peNormList(policy.allowedPaths), ...peNormList(policy.allowedCommands)]);
  for (const r of Array.isArray(policy.rules) ? policy.rules : []) {
    const key = String(r?.target || r?.id || r?.action || '').trim();
    if (!key) continue;
    if (r.effect === 'deny') deny.add(key);
    else if (r.effect === 'allow') allow.add(key);
  }
  for (const [k, eff] of Object.entries(policy.effects || {})) {
    if (eff === 'deny') deny.add(k);
    else if (eff === 'allow') allow.add(k);
  }
  return { deny, allow };
}

function peItemCoveredByParentAllow(childItem, baseAllowSet) {
  if (baseAllowSet.has(childItem) || baseAllowSet.has('*')) return true;
  for (const p of baseAllowSet) {
    if (p.endsWith('/') && childItem.startsWith(p)) return true;
    if (p.endsWith('*') && childItem.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

function peMatchesParentDeny(item, baseDenySet) {
  if (baseDenySet.has(item)) return true;
  for (const d of baseDenySet) {
    if (d.endsWith('/') && item.startsWith(d)) return true;
    if (d.endsWith('*') && item.startsWith(d.slice(0, -1))) return true;
  }
  return false;
}

function peHostCoveredByBaseRule(childRule, baseRule) {
  if (baseRule.port !== null && childRule.port !== baseRule.port) return false;
  if (!baseRule.isSubdomain) return !childRule.isSubdomain && childRule.domain === baseRule.domain;
  if (childRule.isSubdomain) {
    return childRule.domain === baseRule.domain || childRule.domain.endsWith(`.${baseRule.domain}`);
  }
  return childRule.domain.endsWith(`.${baseRule.domain}`);
}

function peAuditEgressOverlay(basePolicy, childOverlay, violations) {
  const rawBase = basePolicy.allowedHosts ?? basePolicy.egressAllowedHosts ?? basePolicy.network?.allowedHosts;
  const rawChild = childOverlay.allowedHosts ?? childOverlay.egressAllowedHosts ?? childOverlay.network?.allowedHosts;
  if (!Array.isArray(rawChild)) return Array.isArray(rawBase) ? [...rawBase] : undefined;
  const childParsed = validateEgressAllowlist(rawChild);
  if (!childParsed.ok) {
    for (const bad of childParsed.invalid) {
      violations.push({ code: 'EGRESS_HOST_ESCALATION', target: bad, reason: `子层 Overlay 含非法通配出站域名规则「${bad}」` });
    }
    return rawChild;
  }
  const baseParsed = validateEgressAllowlist(Array.isArray(rawBase) ? rawBase : []);
  for (const idx of childParsed.rules.keys()) {
    const cr = childParsed.rules[idx];
    if (!baseParsed.rules.some((br) => peHostCoveredByBaseRule(cr, br))) {
      violations.push({ code: 'EGRESS_HOST_ESCALATION', target: rawChild[idx], reason: `子层 Overlay 严禁扩权放行父层未授权的外网域名「${rawChild[idx]}」` });
    }
  }
  return [...rawChild];
}

function peAuditNodeGateRelaxation(basePolicy, childOverlay, violations) {
  const baseNodes = new Map((Array.isArray(basePolicy.nodes) ? basePolicy.nodes : []).map((n) => [n.id, n]));
  for (const [nodeId, tog] of Object.entries(childOverlay.toggleNodes || {})) {
    const bn = baseNodes.get(nodeId);
    if (tog?.bypassed === true && (!bn || bn.bypassed !== true)) {
      violations.push({ code: 'GATE_RELAXATION_FORBIDDEN', target: nodeId, reason: `子层 Overlay 严禁关闭父层门禁节点「${nodeId}」` });
    }
  }
  for (const [nodeId, mode] of Object.entries(childOverlay.patchMode || {})) {
    const bn = baseNodes.get(nodeId);
    if (mode === 'observe' && (!bn || bn.mode !== 'observe')) {
      violations.push({ code: 'GATE_RELAXATION_FORBIDDEN', target: nodeId, reason: `子层 Overlay 严禁将强制门禁「${nodeId}」降级为 observe` });
    }
  }
}

function peAuditAllowAndDenySets(baseSets, childSets, childOverlay, violations) {
  for (const allowItem of childSets.allow) {
    if (peMatchesParentDeny(allowItem, baseSets.deny)) {
      violations.push({ code: 'DENY_FLIPPED_TO_ALLOW', target: allowItem, reason: `子层 Overlay 严禁将父层 deny 项「${allowItem}」翻转为 allow` });
    } else if (baseSets.allow.size > 0 && !peItemCoveredByParentAllow(allowItem, baseSets.allow)) {
      violations.push({ code: 'ALLOW_SET_WIDENED', target: allowItem, reason: `子层 Overlay 严禁扩宽父层 allow 白名单边界「${allowItem}」` });
    }
  }
  for (const removed of peNormList(childOverlay.removeDeny)) {
    if (peMatchesParentDeny(removed, baseSets.deny)) {
      violations.push({ code: 'DENY_FLIPPED_TO_ALLOW', target: removed, reason: `子层 Overlay 严禁移除父层已锁定的 deny 规则「${removed}」` });
    }
  }
}

function peComputeMergedAllow(baseSets, childSets, childOverlay) {
  const hasChildAllow = [childOverlay.allow, childOverlay.allowedPaths, childOverlay.allowedCommands].some(Array.isArray);
  if (!hasChildAllow) return [...baseSets.allow].filter((x) => !childSets.deny.has(x)).sort();
  return [...childSets.allow]
    .filter((x) => !peMatchesParentDeny(x, baseSets.deny) && (baseSets.allow.size === 0 || peItemCoveredByParentAllow(x, baseSets.allow)))
    .sort();
}

export function verifyMonotonicPolicyOverlay(basePolicy = {}, childOverlay = {}) {
  if (!childOverlay || typeof childOverlay !== 'object') {
    return { ok: true, monotonic: true, reasonCode: null, violations: [], effectivePolicy: basePolicy };
  }
  const violations = [];
  const baseSets = peExtractEffectSets(basePolicy);
  const childSets = peExtractEffectSets(childOverlay);
  peAuditAllowAndDenySets(baseSets, childSets, childOverlay, violations);
  const effectiveHosts = peAuditEgressOverlay(basePolicy, childOverlay, violations);
  peAuditNodeGateRelaxation(basePolicy, childOverlay, violations);
  const effectivePolicy = {
    ...basePolicy,
    deny: [...new Set([...baseSets.deny, ...childSets.deny])].sort(),
    allow: peComputeMergedAllow(baseSets, childSets, childOverlay),
    ...(effectiveHosts !== undefined ? { allowedHosts: effectiveHosts } : {})
  };
  const ok = violations.length === 0;
  return { ok, monotonic: ok, reasonCode: violations[0]?.code || null, violations, effectivePolicy };
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
