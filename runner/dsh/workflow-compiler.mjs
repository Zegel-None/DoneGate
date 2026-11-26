// 声明式默认治理工作流编译器（Base Preset + Project Overlay + Seam 插槽 + Coeffect 探针 + 提案确认）
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../skill/hash.mjs';
import { readJsonStrict } from '../../skill/io.mjs';
import {
  GOVERNANCE_OVERRIDES_REL,
  gdFormatIntegrityBannerText
} from '../core/contract.mjs';
import { uleResolvePlaywrightModule } from './ui-live-evaluator.mjs';
import { aosProbeOsSandbox } from './autopilot-os-sandbox.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GOVERNANCE_DEFAULTS_REL = 'workflows/defaults';
export const GOVERNANCE_PROPOSALS_REL = '.donegate/workflows/proposals';

export const GOVERNANCE_SEAM_CATALOG = Object.freeze({
  'gate:lint-edit': ['builtin-lint-edit', 'adp-biome'],
  'gate:commit-hygiene': ['builtin-commit-hygiene'],
  'gate:doc-budget': ['builtin-doc-budgets'],
  'gate:module-integrity': ['builtin-module-integrity'],
  'gate:terminology': ['builtin-terminology'],
  'gate:decisions': ['builtin-decisions'],
  'gate:heldout': ['builtin-heldout-verify'],
  'gate:mutation': ['builtin-teeth-ach', 'adp-stryker'],
  'gate:catch': ['builtin-jit-catch'],
  'gate:pbt': ['adp-pbt-fastcheck'],
  'gate:ui-eval': ['builtin-ui-live-eval', 'adp-playwright'],
  'gate:judge': ['builtin-judge-consensus'],
  'gate:sandbox': ['builtin-os-sandbox', 'builtin-worktree'],
  'gate:gc': ['builtin-autopilot-gc']
});

export function wfcAssertHumanAuthority(actorRole = 'human', confirmedByHuman = false) {
  const norm = String(actorRole || 'human').trim().toLowerCase();
  if (norm === 'worker' || norm === 'executor' || norm === 'coder' || norm === 'subagent') {
    return {
      ok: false,
      exitCode: 2,
      code: 'WORKER_CANNOT_MUTATE_GOVERNANCE',
      reason: '权限拦截：执行端 Worker 禁止修改或关闭治理工作流规则，仅允许业主本人确认后变更'
    };
  }
  if (confirmedByHuman !== true) {
    return {
      ok: false,
      exitCode: 2,
      code: 'HUMAN_CONFIRMATION_REQUIRED',
      reason: '安全拦截：AI 只能提交改动对比提案，必须由业主本人点击【确认生效】(confirmedByHuman=true) 后才能写入规则'
    };
  }
  return { ok: true, exitCode: 0 };
}

export function wfcProbeEnvCoeffects(projectRoot) {
  const root = resolve(projectRoot);
  const pw = uleResolvePlaywrightModule(root);
  const srt = aosProbeOsSandbox(root);
  return {
    platform: process.platform,
    hasGit: existsSync(join(root, '.git')),
    hasContracts: existsSync(join(root, 'contracts')),
    hasThresholds: existsSync(join(root, 'thresholds.json')),
    hasDecisions: existsSync(join(root, 'decisions')),
    hasSymbolsBaseline: existsSync(join(root, 'skill', 'symbols.baseline.json')),
    hasPlaywright: pw.available,
    hasSrt: srt.readyForDefaultUse
  };
}

function wfcResolveDefaultsDir(projectRoot) {
  const localDir = join(resolve(projectRoot), GOVERNANCE_DEFAULTS_REL);
  if (existsSync(localDir)) return localDir;
  return join(DG_ROOT, GOVERNANCE_DEFAULTS_REL);
}

export function wfcListDefaultWorkflows(projectRoot) {
  const dir = wfcResolveDefaultsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const items = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.workflow.json')) continue;
    const r = readJsonStrict(join(dir, name));
    if (r.ok && r.value && r.value.id) items.push(r.value);
  }
  return items;
}

export function wfcLoadDefaultWorkflow(projectRoot, flowId) {
  const safeId = String(flowId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) return null;
  const dir = wfcResolveDefaultsDir(projectRoot);
  const exact = join(dir, `${safeId}.workflow.json`);
  if (existsSync(exact)) {
    const r = readJsonStrict(exact);
    if (r.ok && r.value) return r.value;
  }
  return wfcListDefaultWorkflows(projectRoot).find((w) => w.id === safeId) || null;
}

export function wfcReadProjectOverlay(projectRoot, flowId) {
  const safeId = String(flowId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const p = join(resolve(projectRoot), GOVERNANCE_OVERRIDES_REL, `${safeId}.overlay.json`);
  if (!existsSync(p)) return null;
  const r = readJsonStrict(p);
  return r.ok && r.value ? r.value : null;
}

function wfcCheckNodeCoeffects(node, coeffects) {
  const reqs = Array.isArray(node.requires) ? node.requires : [];
  const missing = reqs.filter((k) => !coeffects[k]);
  if (missing.length === 0) return { active: true, skippedByEnv: false, missingCoeffects: [] };
  const mode = node.onMissing || 'skip';
  return {
    active: mode === 'hard-block',
    skippedByEnv: mode === 'skip' || mode === 'degrade',
    onMissing: mode,
    missingCoeffects: missing
  };
}

function wfcApplyNodeOverlay(baseNode, overlay, coeffects, overrideDiff) {
  const node = {
    ...baseNode,
    config: { ...(baseNode.config || {}) },
    tier: baseNode.tier || 'recommended'
  };
  const tog = overlay?.toggleNodes?.[node.id];
  if (tog && typeof tog.bypassed === 'boolean') {
    node.bypassed = tog.bypassed;
    node.bypassReason = tog.reason || '';
    overrideDiff.push({ kind: 'toggle', nodeId: node.id, title: node.title, bypassed: tog.bypassed, reason: tog.reason || '' });
  }
  const cfgPatch = overlay?.patchConfig?.[node.id];
  if (cfgPatch && typeof cfgPatch === 'object') {
    node.config = { ...node.config, ...cfgPatch };
    overrideDiff.push({ kind: 'config', nodeId: node.id, title: node.title, patch: cfgPatch });
  }
  const swap = overlay?.swapBrick?.[node.id];
  if (typeof swap === 'string' && swap.trim()) {
    node.activeBrick = swap.trim();
    overrideDiff.push({ kind: 'swap', nodeId: node.id, title: node.title, brick: node.activeBrick });
  }
  const co = wfcCheckNodeCoeffects(node, coeffects);
  node.coeffectState = co;
  if (co.skippedByEnv) node.envSkipped = true;
  return node;
}

export function wfcCompileWorkflow(projectRoot, flowIdOrDoc, opts = {}) {
  const root = resolve(projectRoot);
  const baseDoc = typeof flowIdOrDoc === 'string'
    ? wfcLoadDefaultWorkflow(root, flowIdOrDoc)
    : flowIdOrDoc;
  if (!baseDoc || !baseDoc.id || !Array.isArray(baseDoc.nodes)) {
    return { ok: false, exitCode: 3, code: 'WORKFLOW_NOT_FOUND', reason: `找不到治理工作流：${String(flowIdOrDoc || '')}` };
  }
  const overlay = opts.overlay !== undefined ? opts.overlay : wfcReadProjectOverlay(root, baseDoc.id);
  const coeffects = opts.coeffects || wfcProbeEnvCoeffects(root);
  const overrideDiff = [];
  const effectiveNodes = baseDoc.nodes.map((n) => wfcApplyNodeOverlay(n, overlay, coeffects, overrideDiff));

  for (const extra of Array.isArray(overlay?.insertNodes) ? overlay.insertNodes : []) {
    if (!extra || !extra.id || effectiveNodes.some((x) => x.id === extra.id)) continue;
    effectiveNodes.push({ ...extra, tier: extra.tier || 'optional', insertedByOverlay: true });
    overrideDiff.push({ kind: 'insert', nodeId: extra.id, title: extra.title || extra.id });
  }

  const seenSet = new Set(Array.isArray(overlay?.seenNodeIds) ? overlay.seenNodeIds : []);
  const newOfficialNodes = overlay && seenSet.size > 0
    ? baseDoc.nodes.filter((n) => !seenSet.has(n.id)).map((n) => ({ id: n.id, title: n.title, tier: n.tier || 'recommended' }))
    : [];

  const disabledIntegrityRules = effectiveNodes
    .filter((n) => n.tier === 'integrity' && n.bypassed === true)
    .map((n) => ({
      flowId: baseDoc.id,
      nodeId: n.id,
      title: n.title || n.id,
      reason: n.bypassReason || '业主主动关闭',
      confirmedAt: overlay?.toggleNodes?.[n.id]?.confirmedAt || overlay?.updatedAt || ''
    }));

  const effectiveLinks = [...(Array.isArray(baseDoc.links) ? baseDoc.links : []), ...(Array.isArray(overlay?.patchLinks) ? overlay.patchLinks : [])];
  const effectivePack = { ...baseDoc, nodes: effectiveNodes, links: effectiveLinks };
  const workflowHash = sha256(JSON.stringify({
    id: effectivePack.id,
    presetVersion: baseDoc.presetVersion || '1.0.0',
    nodes: effectiveNodes.map((n) => ({ id: n.id, tier: n.tier, bypassed: Boolean(n.bypassed), activeBrick: n.activeBrick || n.tplId || '', config: n.config || {} })),
    links: effectiveLinks
  }));
  const disclosure = { hasDisabledIntegrity: disabledIntegrityRules.length > 0, count: disabledIntegrityRules.length, items: disabledIntegrityRules };
  return {
    ok: true,
    exitCode: 0,
    flowId: baseDoc.id,
    presetVersion: baseDoc.presetVersion || '1.0.0',
    effectivePack,
    workflowHash,
    coeffects,
    customized: overrideDiff.length > 0,
    overrideDiff,
    newOfficialNodes,
    disabledIntegrityRules,
    disclosureBanner: gdFormatIntegrityBannerText(disclosure)
  };
}

function wfcNormalizeToggleNodes(baseDoc, rawToggles, nowIso) {
  const byId = new Map((baseDoc.nodes || []).map((n) => [n.id, n]));
  const out = {};
  for (const [nodeId, val] of Object.entries(rawToggles || {})) {
    if (!val || typeof val !== 'object') continue;
    const baseNode = byId.get(nodeId);
    out[nodeId] = {
      bypassed: Boolean(val.bypassed),
      reason: String(val.reason || '').slice(0, 140),
      tier: baseNode?.tier || val.tier || 'recommended',
      title: baseNode?.title || val.title || nodeId,
      confirmedAt: val.confirmedAt || nowIso
    };
  }
  return out;
}

export function wfcSaveProjectOverlay(projectRoot, flowId, patch = {}, opts = {}) {
  const auth = wfcAssertHumanAuthority(opts.actorRole, opts.confirmedByHuman);
  if (!auth.ok) return auth;
  const root = resolve(projectRoot);
  const baseDoc = wfcLoadDefaultWorkflow(root, flowId);
  if (!baseDoc) return { ok: false, exitCode: 3, code: 'WORKFLOW_NOT_FOUND', reason: `找不到默认治理流：${flowId}` };
  const prev = wfcReadProjectOverlay(root, baseDoc.id) || {};
  const nowIso = new Date().toISOString();
  const merged = {
    schema: 'donegate-workflow-overlay/v1',
    flowId: baseDoc.id,
    baseVersion: baseDoc.presetVersion || '1.0.0',
    updatedAt: nowIso,
    confirmedByHuman: true,
    seenNodeIds: baseDoc.nodes.map((n) => n.id),
    toggleNodes: wfcNormalizeToggleNodes(baseDoc, { ...(prev.toggleNodes || {}), ...(patch.toggleNodes || {}) }, nowIso),
    patchConfig: { ...(prev.patchConfig || {}), ...(patch.patchConfig || {}) },
    swapBrick: { ...(prev.swapBrick || {}), ...(patch.swapBrick || {}) },
    insertNodes: Array.isArray(patch.insertNodes) ? patch.insertNodes : (prev.insertNodes || []),
    patchLinks: Array.isArray(patch.patchLinks) ? patch.patchLinks : (prev.patchLinks || [])
  };
  const ovDir = join(root, GOVERNANCE_OVERRIDES_REL);
  mkdirSync(ovDir, { recursive: true });
  const ovPath = join(ovDir, `${baseDoc.id}.overlay.json`);
  writeFileSync(ovPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return { ...wfcCompileWorkflow(root, baseDoc, { overlay: merged }), overlayPath: ovPath, overlay: merged };
}

export function wfcCreateProposal(projectRoot, flowId, patch = {}, opts = {}) {
  const root = resolve(projectRoot);
  const baseDoc = wfcLoadDefaultWorkflow(root, flowId);
  if (!baseDoc) return { ok: false, exitCode: 3, code: 'WORKFLOW_NOT_FOUND', reason: `找不到默认治理流：${flowId}` };
  const before = wfcCompileWorkflow(root, baseDoc);
  const prev = wfcReadProjectOverlay(root, baseDoc.id) || {};
  const nowIso = new Date().toISOString();
  const previewOverlay = {
    ...prev,
    flowId: baseDoc.id,
    toggleNodes: wfcNormalizeToggleNodes(baseDoc, { ...(prev.toggleNodes || {}), ...(patch.toggleNodes || {}) }, nowIso),
    patchConfig: { ...(prev.patchConfig || {}), ...(patch.patchConfig || {}) },
    swapBrick: { ...(prev.swapBrick || {}), ...(patch.swapBrick || {}) }
  };
  const after = wfcCompileWorkflow(root, baseDoc, { overlay: previewOverlay });
  const proposalId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const proposal = {
    proposalId,
    flowId: baseDoc.id,
    flowName: baseDoc.name,
    status: 'pending_human_confirmation',
    proposedBy: String(opts.proposedBy || 'ai-assistant'),
    summary: String(opts.summary || '调整默认治理流规则配置').slice(0, 180),
    createdAt: nowIso,
    patch,
    diffPreview: after.overrideDiff,
    beforeHash: before.workflowHash,
    afterHash: after.workflowHash,
    willDisableIntegrity: after.disabledIntegrityRules
  };
  const propDir = join(root, GOVERNANCE_PROPOSALS_REL);
  mkdirSync(propDir, { recursive: true });
  writeFileSync(join(propDir, `${proposalId}.json`), JSON.stringify(proposal, null, 2) + '\n', 'utf8');
  return { ok: true, exitCode: 0, proposal };
}

export function wfcListPendingProposals(projectRoot) {
  const propDir = join(resolve(projectRoot), GOVERNANCE_PROPOSALS_REL);
  if (!existsSync(propDir)) return [];
  const out = [];
  for (const name of readdirSync(propDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const r = readJsonStrict(join(propDir, name));
    if (r.ok && r.value && r.value.status === 'pending_human_confirmation') out.push(r.value);
  }
  return out;
}

export function wfcConfirmProposal(projectRoot, proposalId, opts = {}) {
  const auth = wfcAssertHumanAuthority(opts.actorRole, opts.confirmedByHuman);
  if (!auth.ok) return auth;
  const root = resolve(projectRoot);
  const safeId = String(proposalId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const propPath = join(root, GOVERNANCE_PROPOSALS_REL, `${safeId}.json`);
  if (!existsSync(propPath)) return { ok: false, exitCode: 3, code: 'PROPOSAL_NOT_FOUND', reason: `找不到待确认提案：${safeId}` };
  const r = readJsonStrict(propPath);
  if (!r.ok || !r.value) return { ok: false, exitCode: 2, code: 'PROPOSAL_CORRUPT', reason: '提案文件损坏' };
  const prop = r.value;
  const applied = wfcSaveProjectOverlay(root, prop.flowId, prop.patch || {}, { actorRole: 'human', confirmedByHuman: true });
  if (!applied.ok) return applied;
  prop.status = 'confirmed';
  prop.confirmedAt = new Date().toISOString();
  writeFileSync(propPath, JSON.stringify(prop, null, 2) + '\n', 'utf8');
  return { ...applied, proposal: prop };
}

export function wfcResetProjectOverlay(projectRoot, flowId, opts = {}) {
  const auth = wfcAssertHumanAuthority(opts.actorRole, opts.confirmedByHuman);
  if (!auth.ok) return auth;
  const root = resolve(projectRoot);
  const safeId = String(flowId || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const ovPath = join(root, GOVERNANCE_OVERRIDES_REL, `${safeId}.overlay.json`);
  if (existsSync(ovPath)) rmSync(ovPath, { force: true });
  return wfcCompileWorkflow(root, safeId);
}
