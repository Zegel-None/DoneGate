// 声明式默认治理工作流编译器（Base Preset + Project Overlay + Seam 插槽 + Coeffect 探针 + 提案确认）
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict } from '../../../skill/io.mjs';
import {
  GOVERNANCE_OVERRIDES_REL,
  gdFormatIntegrityBannerText,
  probeTreeSitterWasmCell
} from '../../core/contract.mjs';
import { uleResolvePlaywrightModule } from '../uiboard/index.mjs';
import { aosProbeOsSandbox } from './autopilot-os-sandbox.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const GOVERNANCE_DEFAULTS_REL = 'workflows/defaults';
export const GOVERNANCE_PROPOSALS_REL = '.donegate/workflows/proposals';

export const GOVERNANCE_SEAM_CATALOG = Object.freeze({
  'gate:lint-edit': ['builtin-lint-edit', 'adp-biome', 'adp-ruff'],
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
  'gate:gc': ['builtin-autopilot-gc'],
  'gate:py-lint': ['adp-ruff'],
  'gate:py-complexity': ['adp-complexipy', 'adp-fuck-u-code'],
  'gate:py-types': ['adp-ty', 'adp-pyright'],
  'gate:py-test': ['adp-pytest'],
  'gate:py-arch': ['adp-import-linter']
});

export const WFC_BRICK_EXEC_MAP = Object.freeze({
  'builtin-lint-edit': { kind: 'builtin_gate', scriptRel: 'skill/lint-edit.mjs', args: ['--changed'] },
  'adp-biome': { kind: 'adapter_node', tool: 'biome', entryRel: 'skill/adapters/biome-lint.mjs', registryId: 'biome@stage4', obligationId: 'biome-no-errors' },
  'adp-ruff': { kind: 'adapter_node', tool: 'ruff', entryRel: 'skill/adapters/ruff-lint.mjs', registryId: 'ruff@stage4', obligationId: 'ruff-no-violations' },
  'adp-complexipy': { kind: 'adapter_node', tool: 'complexipy', entryRel: 'skill/adapters/complexipy-check.mjs', registryId: 'complexipy@stage4', obligationId: 'complexipy-under-cap' },
  'adp-fuck-u-code': { kind: 'adapter_node', tool: 'fuck-u-code', entryRel: 'skill/adapters/fuck-u-code.mjs', registryId: 'fuck-u-code@stage4', obligationId: 'fuck-u-code-no-hot-files' },
  'adp-ty': { kind: 'adapter_node', tool: 'ty', entryRel: 'skill/adapters/ty-check.mjs', registryId: 'ty@stage4', obligationId: 'ty-no-errors' },
  'adp-pyright': { kind: 'adapter_node', tool: 'pyright', entryRel: 'skill/adapters/pyright-types.mjs', registryId: 'pyright@stage4', obligationId: 'pyright-no-errors' },
  'adp-pytest': { kind: 'adapter_node', tool: 'pytest', entryRel: 'skill/adapters/pytest-run.mjs', registryId: 'pytest@stage4', obligationId: 'pytest-all-pass' },
  'adp-import-linter': { kind: 'adapter_node', tool: 'import-linter', entryRel: 'skill/adapters/import-linter.mjs', registryId: 'import-linter@stage4', obligationId: 'import-linter-no-broken-contracts' },
  'builtin-teeth-ach': { kind: 'donegate_cmd', args: ['status', '--json'] },
  'adp-stryker': { kind: 'adapter_node', tool: 'stryker', entryRel: 'skill/adapters/stryker-teeth.mjs', registryId: 'stryker@stage4', obligationId: 'stryker-no-survivors' },
  'builtin-ui-live-eval': { kind: 'donegate_cmd', args: ['status', '--json'] },
  'adp-playwright': { kind: 'adapter_node', tool: 'playwright', entryRel: 'skill/adapters/playwright-e2e.mjs', registryId: 'playwright@stage4' }
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

function wfcDirHasPyFile(dirPath) {
  if (!existsSync(dirPath)) return false;
  try {
    return readdirSync(dirPath).some((name) => name.endsWith('.py'));
  } catch (err) {
    void err;
    return false;
  }
}

function wfcDetectPythonProject(root) {
  if (['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].some((f) => existsSync(join(root, f)))) return true;
  return wfcDirHasPyFile(root) || wfcDirHasPyFile(join(root, 'src'));
}

function wfcProbeBinFast(root, binName) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
  const venvDirs = isWin
    ? [join(root, '.venv', 'Scripts'), join(root, 'venv', 'Scripts'), join(root, 'workflows', '.deps', '_shared', 'venv', 'Scripts')]
    : [join(root, '.venv', 'bin'), join(root, 'venv', 'bin'), join(root, 'workflows', '.deps', '_shared', 'venv', 'bin')];
  const pathDirs = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const d of [...venvDirs, ...pathDirs]) {
    for (const ext of exts) {
      if (existsSync(join(d, binName + ext))) return true;
    }
  }
  return false;
}

export function wfcProbeEnvCoeffects(projectRoot) {
  const root = resolve(projectRoot);
  const pw = uleResolvePlaywrightModule(root);
  const srt = aosProbeOsSandbox(root);
  const hasPython = wfcDetectPythonProject(root);
  const hasPyVenv = existsSync(join(root, '.venv')) || existsSync(join(root, 'venv'));
  const tsCell = probeTreeSitterWasmCell(root);
  return {
    platform: process.platform,
    hasGit: existsSync(join(root, '.git')),
    hasContracts: existsSync(join(root, 'contracts')),
    hasThresholds: existsSync(join(root, 'thresholds.json')),
    hasDecisions: existsSync(join(root, 'decisions')),
    hasSymbolsBaseline: existsSync(join(root, 'skill', 'symbols-baseline.json')),
    hasPlaywright: pw.available,
    hasSrt: srt.readyForDefaultUse,
    hasPython,
    hasPyVenv,
    hasRuff: hasPython && wfcProbeBinFast(root, 'ruff'),
    hasComplexipy: hasPython && wfcProbeBinFast(root, 'complexipy'),
    hasPytest: hasPython && wfcProbeBinFast(root, 'pytest'),
    hasPyTypeChecker: hasPython && (wfcProbeBinFast(root, 'ty') || wfcProbeBinFast(root, 'basedpyright') || wfcProbeBinFast(root, 'pyright')),
    hasImportLinter: hasPython && existsSync(join(root, '.importlinter')) && wfcProbeBinFast(root, 'lint-imports'),
    hasTreeSitterWasm: tsCell.available
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
    if (WFC_BRICK_EXEC_MAP[node.activeBrick]) {
      node.exec = { ...WFC_BRICK_EXEC_MAP[node.activeBrick] };
    }
    overrideDiff.push({ kind: 'swap', nodeId: node.id, title: node.title, brick: node.activeBrick });
  }
  const co = wfcCheckNodeCoeffects(node, coeffects);
  node.coeffectState = co;
  if (co.skippedByEnv) node.envSkipped = true;
  return node;
}

function wfcAppendInsertedNodes(effectiveNodes, overlay, overrideDiff) {
  const extras = Array.isArray(overlay?.insertNodes) ? overlay.insertNodes : [];
  for (const extra of extras) {
    if (!extra || !extra.id || effectiveNodes.some((x) => x.id === extra.id)) continue;
    effectiveNodes.push({ ...extra, tier: extra.tier || 'optional', insertedByOverlay: true });
    overrideDiff.push({ kind: 'insert', nodeId: extra.id, title: extra.title || extra.id });
  }
}

function wfcCollectNewOfficialNodes(baseDoc, overlay) {
  const seenSet = new Set(Array.isArray(overlay?.seenNodeIds) ? overlay.seenNodeIds : []);
  if (!overlay || seenSet.size === 0) return [];
  return baseDoc.nodes
    .filter((n) => !seenSet.has(n.id))
    .map((n) => ({ id: n.id, title: n.title, tier: n.tier || 'recommended' }));
}

function wfcCollectDisabledIntegrityRules(baseDocId, effectiveNodes, overlay) {
  return effectiveNodes
    .filter((n) => n.tier === 'integrity' && n.bypassed === true)
    .map((n) => ({
      flowId: baseDocId,
      nodeId: n.id,
      title: n.title || n.id,
      reason: n.bypassReason || '业主主动关闭',
      confirmedAt: overlay?.toggleNodes?.[n.id]?.confirmedAt || overlay?.updatedAt || ''
    }));
}

function wfcComputeWorkflowHash(baseDoc, effectiveNodes, effectiveLinks) {
  return sha256(JSON.stringify({
    id: baseDoc.id,
    presetVersion: baseDoc.presetVersion || '1.0.0',
    nodes: effectiveNodes.map((n) => ({
      id: n.id,
      tier: n.tier,
      bypassed: Boolean(n.bypassed),
      activeBrick: n.activeBrick || n.tplId || '',
      config: n.config || {}
    })),
    links: effectiveLinks
  }));
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
  wfcAppendInsertedNodes(effectiveNodes, overlay, overrideDiff);

  const newOfficialNodes = wfcCollectNewOfficialNodes(baseDoc, overlay);
  const disabledIntegrityRules = wfcCollectDisabledIntegrityRules(baseDoc.id, effectiveNodes, overlay);
  const baseLinks = Array.isArray(baseDoc.links) ? baseDoc.links : [];
  const patchLinks = Array.isArray(overlay?.patchLinks) ? overlay.patchLinks : [];
  const effectiveLinks = [...baseLinks, ...patchLinks];
  const effectivePack = { ...baseDoc, nodes: effectiveNodes, links: effectiveLinks };
  const workflowHash = wfcComputeWorkflowHash(baseDoc, effectiveNodes, effectiveLinks);
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

function wfcSanitizeInsertNodes(rawNodes) {
  if (!Array.isArray(rawNodes)) return [];
  return rawNodes
    .filter((nd) => nd && typeof nd === 'object' && nd.id)
    .map((nd) => {
      const copy = { ...nd };
      if (copy.exec && typeof copy.exec === 'object') {
        const { nodeArgs: _dropArgs, ...rest } = copy.exec;
        void _dropArgs;
        if (rest.kind === 'external_bin' || (!rest.kind && Array.isArray(copy.exec.nodeArgs))) {
          delete copy.exec;
        } else {
          copy.exec = rest;
        }
      }
      return copy;
    });
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
    insertNodes: Array.isArray(patch.insertNodes) ? wfcSanitizeInsertNodes(patch.insertNodes) : wfcSanitizeInsertNodes(prev.insertNodes || []),
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
  const safePatch = {
    ...patch,
    ...(Array.isArray(patch.insertNodes) ? { insertNodes: wfcSanitizeInsertNodes(patch.insertNodes) } : {})
  };
  const previewOverlay = {
    ...prev,
    flowId: baseDoc.id,
    toggleNodes: wfcNormalizeToggleNodes(baseDoc, { ...(prev.toggleNodes || {}), ...(safePatch.toggleNodes || {}) }, nowIso),
    patchConfig: { ...(prev.patchConfig || {}), ...(safePatch.patchConfig || {}) },
    swapBrick: { ...(prev.swapBrick || {}), ...(safePatch.swapBrick || {}) },
    insertNodes: Array.isArray(safePatch.insertNodes) ? safePatch.insertNodes : wfcSanitizeInsertNodes(prev.insertNodes || []),
    patchLinks: Array.isArray(safePatch.patchLinks) ? safePatch.patchLinks : (prev.patchLinks || [])
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
    patch: safePatch,
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
