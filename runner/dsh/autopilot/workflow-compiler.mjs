// 声明式默认治理工作流编译器（Base Preset + Project Overlay + Seam 插槽 + Coeffect 探针 + 提案确认）
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict, readMaybe } from '../../../skill/io.mjs';
import {
  GOVERNANCE_OVERRIDES_REL,
  gdFormatIntegrityBannerText,
  probeTreeSitterWasmCell
} from '../../core/contract.mjs';
import { uleResolvePlaywrightModule } from '../uiboard/index.mjs';
import { aosProbeOsSandbox } from './autopilot-os-sandbox.mjs';
import { isPrivateNetworkAddress, validateEgressAllowlist } from './egress-allowlist-proxy.mjs';

const DEFAULT_HTTPS_PORT = 443, DEFAULT_HTTP_PORT = 80;

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const GOVERNANCE_DEFAULTS_REL = 'workflows/defaults';
export const GOVERNANCE_PROPOSALS_REL = '.donegate/workflows/proposals';

export const GOVERNANCE_SEAM_CATALOG = Object.freeze({
  'gate:lint-edit': ['builtin-lint-edit', 'adp-oxlint', 'adp-biome', 'adp-ruff'],
  'gate:js-correctness': ['adp-oxlint', 'adp-biome'],
  'gate:commit-hygiene': ['builtin-commit-hygiene'],
  'gate:arch-boundary': ['adp-depcruise', 'adp-codegraph'],
  'gate:shell-lint': ['adp-shellcheck'],
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
  'adp-oxlint': { kind: 'adapter_node', tool: 'oxlint', entryRel: 'skill/adapters/oxlint-check.mjs', registryId: 'oxlint@stage4' },
  'adp-biome': { kind: 'adapter_node', tool: 'biome', entryRel: 'skill/adapters/biome-lint.mjs', registryId: 'biome@stage4', obligationId: 'biome-no-errors' },
  'adp-depcruise': { kind: 'adapter_node', tool: 'depcruise', entryRel: 'skill/adapters/depcruise-arch.mjs', registryId: 'depcruise@stage4', obligationId: 'depcruise-no-violations' },
  'adp-codegraph': { kind: 'adapter_node', tool: 'codegraph', entryRel: 'skill/adapters/codegraph-impact.mjs', registryId: 'codegraph@stage4', obligationId: 'codegraph-no-cycles' },
  'adp-shellcheck': { kind: 'adapter_node', tool: 'shellcheck', entryRel: 'skill/adapters/shellcheck-lint.mjs', registryId: 'shellcheck@stage4' },
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

function wfcDirHasExtFile(dirPath, extRe) {
  if (!existsSync(dirPath)) return false;
  try {
    return readdirSync(dirPath).some((name) => extRe.test(name));
  } catch (err) {
    void err;
    return false;
  }
}

function wfcDetectPythonProject(root) {
  if (['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].some((f) => existsSync(join(root, f)))) return true;
  return wfcDirHasExtFile(root, /\.py$/i) || wfcDirHasExtFile(join(root, 'src'), /\.py$/i);
}

function wfcDetectJsProject(root) {
  if (existsSync(join(root, 'package.json'))) return true;
  return ['src', 'runner', 'lib'].some((d) => wfcDirHasExtFile(join(root, d), /\.(?:mjs|cjs|js|ts|tsx|jsx)$/i));
}

function wfcDetectShellScripts(root) {
  if (existsSync(join(root, '.githooks', 'pre-commit'))) return true;
  return wfcDirHasExtFile(root, /\.(?:sh|bash)$/i) || wfcDirHasExtFile(join(root, 'scripts'), /\.(?:sh|bash)$/i);
}

function wfcHasDepcruiseConfig(root) {
  return ['.dependency-cruiser.cjs', '.dependency-cruiser.js', '.dependency-cruiser.json'].some((f) => existsSync(join(root, f)));
}

function wfcProbeBinFast(root, binName) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
  const sharedRoot = join(root, 'workflows', '.deps', '_shared');
  const venvDirs = [
    ...(isWin
      ? [join(root, '.venv', 'Scripts'), join(root, 'venv', 'Scripts'), join(sharedRoot, 'venv', 'Scripts')]
      : [join(root, '.venv', 'bin'), join(root, 'venv', 'bin'), join(sharedRoot, 'venv', 'bin')]),
    join(sharedRoot, '.bin'),
    join(sharedRoot, 'npm', 'node_modules', '.bin'),
    join(sharedRoot, 'npm-cells', binName, 'node_modules', '.bin')
  ];
  const pathDirs = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const d of [...venvDirs, ...pathDirs]) {
    for (const ext of exts) {
      if (existsSync(join(d, binName + ext))) return true;
    }
  }
  return false;
}

const WFC_DIFF_CODE_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const WFC_DIFF_TEST_RE = /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.(?:test|spec)|[-_]fixtures?|-self-test)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|rs)$/i;
const WFC_DIFF_CONTRACT_RE = /^(?:contracts\/|INTENT\.md$|CONSTRAINTS\.md$|decisions\/)/;
const WFC_DIFF_HOOK_SCRIPT_RE = /^(?:\.githooks\/|skill\/|scripts\/)|\.(?:sh|bash|cmd|ps1)$/i;
const WFC_DIFF_DEPS_CFG_RE = /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pyproject\.toml|requirements[^/]*\.txt|Cargo\.toml|go\.mod|thresholds\.json|\.dependency-cruiser\.[a-z]+)$/i;

function wfcProbeGitDiffCoeffects(root) {
  const empty = {
    diffFileCount: 0, diffHasCode: false, diffTouchesTests: false,
    diffTouchesContracts: false, diffTouchesHooksOrScripts: false, diffTouchesDepsOrConfig: false
  };
  if (!existsSync(join(root, '.git'))) return empty;
  const st = spawnSync('git', ['-C', root, '-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], {
    encoding: 'utf8', windowsHide: true, timeout: 5000
  });
  if (st.status !== 0 || !(st.stdout || '').trim()) return empty;
  const files = [];
  for (const line of st.stdout.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const raw = line.slice(3).split(' -> ').pop().trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
    if (raw && !raw.startsWith('.donegate/')) files.push(raw);
  }
  return {
    diffFileCount: files.length,
    diffHasCode: files.some((f) => WFC_DIFF_CODE_RE.test(f)),
    diffTouchesTests: files.some((f) => WFC_DIFF_TEST_RE.test(f)),
    diffTouchesContracts: files.some((f) => WFC_DIFF_CONTRACT_RE.test(f)),
    diffTouchesHooksOrScripts: files.some((f) => WFC_DIFF_HOOK_SCRIPT_RE.test(f)),
    diffTouchesDepsOrConfig: files.some((f) => WFC_DIFF_DEPS_CFG_RE.test(f))
  };
}

export function wfcProbeEnvCoeffects(projectRoot) {
  const root = resolve(projectRoot);
  const pw = uleResolvePlaywrightModule(root);
  const srt = aosProbeOsSandbox(root);
  const hasPython = wfcDetectPythonProject(root);
  const hasJsOrTs = wfcDetectJsProject(root);
  const hasShellScripts = wfcDetectShellScripts(root);
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
    hasJsOrTs,
    hasOxlint: hasJsOrTs && wfcProbeBinFast(root, 'oxlint'),
    hasDepcruiseConfig: wfcHasDepcruiseConfig(root),
    hasDepcruise: wfcProbeBinFast(root, 'depcruise'),
    hasShellScripts,
    hasShellcheck: hasShellScripts && wfcProbeBinFast(root, 'shellcheck'),
    hasPython,
    hasPyVenv,
    hasRuff: hasPython && wfcProbeBinFast(root, 'ruff'),
    hasComplexipy: hasPython && wfcProbeBinFast(root, 'complexipy'),
    hasPytest: hasPython && wfcProbeBinFast(root, 'pytest'),
    hasPyTypeChecker: hasPython && (wfcProbeBinFast(root, 'ty') || wfcProbeBinFast(root, 'basedpyright') || wfcProbeBinFast(root, 'pyright')),
    hasImportLinter: hasPython && existsSync(join(root, '.importlinter')) && wfcProbeBinFast(root, 'lint-imports'),
    hasTreeSitterWasm: tsCell.available,
    ...wfcProbeGitDiffCoeffects(root)
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

function wfcApplyNodeModePatch(node, overlay, overrideDiff) {
  const patchedMode = overlay?.patchMode?.[node.id] || overlay?.toggleNodes?.[node.id]?.mode;
  if (patchedMode !== 'observe' && patchedMode !== 'enforce') return;
  if (patchedMode === 'observe' && node.tier === 'integrity') return;
  if (patchedMode !== node.mode) {
    node.mode = patchedMode;
    overrideDiff.push({ kind: 'mode', nodeId: node.id, title: node.title, mode: patchedMode });
  }
}

function wfcApplyNodeOverlay(baseNode, overlay, coeffects, overrideDiff) {
  const tier = baseNode.tier || 'recommended';
  const node = {
    ...baseNode,
    config: { ...(baseNode.config || {}) },
    tier,
    mode: (baseNode.mode === 'observe' && tier !== 'integrity') ? 'observe' : 'enforce'
  };
  const tog = overlay?.toggleNodes?.[node.id];
  if (tog && typeof tog.bypassed === 'boolean') {
    node.bypassed = tog.bypassed;
    node.bypassReason = tog.reason || '';
    overrideDiff.push({ kind: 'toggle', nodeId: node.id, title: node.title, bypassed: tog.bypassed, reason: tog.reason || '' });
  }
  wfcApplyNodeModePatch(node, overlay, overrideDiff);
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

function wfcAppendInsertedNodes(effectiveNodes, overlay, coeffects, overrideDiff) {
  const extras = Array.isArray(overlay?.insertNodes) ? overlay.insertNodes : [];
  for (const extra of extras) {
    if (!extra || !extra.id || effectiveNodes.some((x) => x.id === extra.id)) continue;
    const tier = extra.tier || 'optional';
    const mode = (extra.mode === 'observe' && tier !== 'integrity') ? 'observe' : 'enforce';
    const co = wfcCheckNodeCoeffects(extra, coeffects);
    effectiveNodes.push({
      ...extra,
      tier,
      mode,
      coeffectState: co,
      ...(co.skippedByEnv ? { envSkipped: true } : {}),
      insertedByOverlay: true
    });
    overrideDiff.push({ kind: 'insert', nodeId: extra.id, title: extra.title || extra.id, mode });
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
      tier: n.tier || 'recommended',
      mode: n.mode || 'enforce',
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
  if (!wfcHasActiveOverlay(overlay)) return wfcCompileNoOverlayFastPath(baseDoc, coeffects);
  const overrideDiff = [];
  const effectiveNodes = baseDoc.nodes.map((n) => wfcApplyNodeOverlay(n, overlay, coeffects, overrideDiff));
  wfcAppendInsertedNodes(effectiveNodes, overlay, coeffects, overrideDiff);

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
    identityPassthrough: false,
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
    patchMode: { ...(prev.patchMode || {}), ...(patch.patchMode || {}) },
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
    patchMode: { ...(prev.patchMode || {}), ...(safePatch.patchMode || {}) },
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

function wfcHasActiveOverlay(overlay) {
  if (!overlay || typeof overlay !== 'object') return false;
  const mapKeys = ['toggleNodes', 'patchMode', 'patchConfig', 'swapBrick'];
  if (mapKeys.some((k) => overlay[k] && Object.keys(overlay[k]).length > 0)) return true;
  return ['insertNodes', 'patchLinks', 'seenNodeIds'].some((k) => Array.isArray(overlay[k]) && overlay[k].length > 0);
}

function wfcCompileNoOverlayFastPath(baseDoc, coeffects) {
  let hasEnvSkip = false;
  const nodes = baseDoc.nodes.map((n) => {
    const co = wfcCheckNodeCoeffects(n, coeffects);
    if (!co.skippedByEnv && !(n.tier === 'integrity' && n.mode === 'observe')) return n;
    hasEnvSkip = true;
    return { ...n, ...(n.tier === 'integrity' && n.mode === 'observe' ? { mode: 'enforce' } : {}), ...(co.skippedByEnv ? { envSkipped: true } : {}) };
  });
  const baseLinks = Array.isArray(baseDoc.links) ? baseDoc.links : [];
  const identityPassthrough = !hasEnvSkip && Array.isArray(baseDoc.links);
  const effectivePack = identityPassthrough ? baseDoc : { ...baseDoc, nodes, links: baseLinks };
  return {
    ok: true, exitCode: 0, flowId: baseDoc.id, presetVersion: baseDoc.presetVersion || '1.0.0',
    effectivePack, workflowHash: wfcComputeWorkflowHash(baseDoc, effectivePack.nodes, baseLinks),
    coeffects, customized: false, identityPassthrough, overrideDiff: [],
    newOfficialNodes: [], disabledIntegrityRules: [],
    disclosureBanner: gdFormatIntegrityBannerText({ hasDisabledIntegrity: false, count: 0, items: [] })
  };
}

const EGRESS_URL_CALL_RE = /\b(?:fetch|got|ky|urlopen|(?:axios|undici|requests|httpx)\s*\.\s*[a-zA-Z]+|https?\s*\.\s*(?:request|get)|new\s+(?:URL|WebSocket|EventSource))\s*\(\s*(['""`])((?:https?|wss?):\/\/[^'""`\s]+)\1/g;
const NODE_HTTP_OBJ_RE = /\b(https?)\s*\.\s*(?:request|get)\s*\(\s*\{([\s\S]{1,360}?)\}/g;

function wfcStripCommentsKeepStrings(code) {
  return String(code || '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => (m.startsWith('/') ? ' ' : m));
}

function wfcRecordCandidateHost(map, rawHost, rawPort, scheme, fileLabel, callKind, includeLoopback) {
  if (!rawHost || rawHost.includes('${') || rawHost.includes('*')) return;
  const cleanHost = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!includeLoopback && (cleanHost === 'localhost' || cleanHost.endsWith('.localhost') || isPrivateNetworkAddress(cleanHost))) return;
  const port = rawPort ? Number(rawPort) : ((scheme === 'http' || scheme === 'ws') ? DEFAULT_HTTP_PORT : DEFAULT_HTTPS_PORT);
  const hostPort = `${cleanHost}:${port}`;
  if (!validateEgressAllowlist([hostPort]).ok) return;
  const cur = map.get(hostPort) || { hostPort, host: cleanHost, port, sources: new Set(), callKinds: new Set() };
  cur.sources.add(fileLabel);
  cur.callKinds.add(callKind);
  map.set(hostPort, cur);
}

function wfcScanSingleSourceFile(fileLabel, rawCode, map, includeLoopback) {
  const code = wfcStripCommentsKeepStrings(rawCode);
  for (const m of code.matchAll(EGRESS_URL_CALL_RE)) {
    try {
      const u = new URL(m[2].split('${')[0]);
      wfcRecordCandidateHost(map, u.hostname, u.port, u.protocol.replace(/:$/, '').toLowerCase(), fileLabel, 'url-literal', includeLoopback);
    } catch (err) { void err; }
  }
  for (const m of code.matchAll(NODE_HTTP_OBJ_RE)) {
    const hostMatch = m[2].match(/\b(?:hostname|host)\s*:\s*(['""])([^'"\s]+)\1/);
    if (!hostMatch) continue;
    const portMatch = m[2].match(/\bport\s*:\s*(\d{1,5})\b/);
    const [hPart, inlinePort] = hostMatch[2].split(':');
    wfcRecordCandidateHost(map, hPart, portMatch ? portMatch[1] : inlinePort, m[1].toLowerCase(), fileLabel, `${m[1].toLowerCase()}.request`, includeLoopback);
  }
}

export function extractStaticEgressHostCandidates(sourceFiles = [], opts = {}) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) return { hosts: [], candidates: [], requiresHumanReview: true, fileCount: 0 };
  const baseRoot = resolve(opts.projectRoot || process.cwd()), includeLoopback = opts.includeLoopback === true, map = new Map();
  let fileCount = 0;
  for (const item of sourceFiles) {
    if (typeof item === 'string') {
      const txt = readMaybe(resolve(baseRoot, item));
      if (txt !== null) { fileCount++; wfcScanSingleSourceFile(item, txt, map, includeLoopback); }
    } else if (item && typeof item === 'object') {
      fileCount++;
      wfcScanSingleSourceFile(String(item.path || item.file || `inline-${fileCount}`), String(item.content ?? item.code ?? item.source ?? ''), map, includeLoopback);
    }
  }
  const candidates = [...map.values()].sort((a, b) => a.hostPort.localeCompare(b.hostPort))
    .map((c) => ({ hostPort: c.hostPort, host: c.host, port: c.port, sources: [...c.sources].sort(), callKinds: [...c.callKinds].sort() }));
  return { hosts: candidates.map((c) => c.hostPort), candidates, requiresHumanReview: true, fileCount };
}
