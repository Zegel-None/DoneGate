// 工作台活体数据注水层：将全仓扫描的模块/入口/契约 scope[] 与砂浆注册表映射为「项目看板 + 开发流」交互模型（<= 300 行）
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const UPSTREAM_GITHUB_MAP = {
  stryker: ['stryker-mutator/stryker-js', 'v8.7.1', 'v8.8.0'],
  gitleaks: ['gitleaks/gitleaks', 'v8.18.4', 'v8.21.2'],
  'osv-scanner': ['google/osv-scanner', 'v1.9.1', 'v1.9.2'],
  depcruise: ['sverweij/dependency-cruiser', 'v16.8.0', 'v16.9.0'],
  knip: ['webpro-nl/knip', 'v5.39.0', 'v5.41.0'],
  biome: ['biomejs/biome', 'v1.9.4', 'v1.9.4'],
  playwright: ['microsoft/playwright', 'v1.48.0', 'v1.49.1'],
  semgrep: ['semgrep/semgrep', 'v1.99.0', 'v1.101.0'],
  ruff: ['astral-sh/ruff', 'v0.8.2', 'v0.8.4'],
  pyright: ['microsoft/pyright', 'v1.1.389', 'v1.1.390'],
  vitest: ['vitest-dev/vitest', 'v2.1.6', 'v2.1.8'],
  shellcheck: ['koalaman/shellcheck', 'v0.10.0', 'v0.10.0'],
  hadolint: ['hadolint/hadolint', 'v2.12.0', 'v2.12.0'],
  actionlint: ['rhysd/actionlint', 'v1.7.4', 'v1.7.4'],
  sqlfluff: ['sqlfluff/sqlfluff', 'v3.2.5', 'v3.3.0'],
  maestro: ['mobile-dev-inc/Maestro', 'v1.38.1', 'v1.39.0'],
  openspec: ['Fission-AI/OpenSpec', 'v0.2.4', 'v0.3.0']
};

function defaultSavedState() {
  return {
    schemaVersion: '1.0',
    customPacks: {},
    componentWorkflows: {},
    hostNodeLayouts: {},
    hostGroups: [],
    hostSubgraphs: [],
    workshopOverrides: {},
    textOverrides: {},
    textStyles: {},
    controlStyles: {},
    starredRepos: ['mobile-dev-inc/Maestro', 'biomejs/biome'],
    updatedAt: null
  };
}

export function readSavedWorkbenchState(projectRoot) {
  const p = join(resolve(projectRoot), '.donegate', 'workbench-state.json');
  if (!existsSync(p)) return defaultSavedState();
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') return defaultSavedState();
  return { ...defaultSavedState(), ...r.value };
}

function laneOrderRank(lane) {
  return lane === 'ui' ? 0 : (lane === 'api' ? 1 : (lane === 'tool' ? 2 : 3));
}

function mapModRoleLabel(mod) {
  if (mod.lane === 'ui') return '界面';
  if (mod.lane === 'api') return '接口';
  if (mod.lane === 'tool') return '工具';
  return '底座';
}

function mapModState(mod) {
  if ((mod.touchedByBranches || []).length > 1 || mod.tone === 'bad') return 'err';
  if (mod.isWild || mod.tone === 'warn') return 'warn';
  return 'ok';
}

function buildHostSandboxFromAtlas(baseAtlas, savedState) {
  const domains = [...(baseAtlas.domains || [])].sort((a, b) => {
    const lr = laneOrderRank(a.primaryLane) - laneOrderRank(b.primaryLane);
    return lr !== 0 ? lr : a.key.localeCompare(b.key);
  });
  const rawById = new Map((baseAtlas.rawContracts || []).map((c) => [c.id, c]));
  const summaryById = new Map(((baseAtlas.status && baseAtlas.status.contractSummaries) || []).map((s) => [s.id, s]));
  const modsByDom = new Map();
  for (const m of (baseAtlas.modules || [])) {
    if (!modsByDom.has(m.domainId)) modsByDom.set(m.domainId, []);
    modsByDom.get(m.domainId).push(m);
  }

  // Build cross-domain edges
  const domByModId = new Map((baseAtlas.modules || []).map((m) => [m.id, m.domainId]));
  const nextDomMap = new Map();
  for (const e of (baseAtlas.edges || [])) {
    const dFrom = domByModId.get(e.from);
    const dTo = domByModId.get(e.to);
    if (dFrom && dTo && dFrom !== dTo) {
      if (!nextDomMap.has(dFrom)) nextDomMap.set(dFrom, new Set());
      nextDomMap.get(dFrom).add(dTo);
    }
  }

  // Assign topological column for clean default x/y coordinates
  const colCounts = new Map();
  const nodes = domains.map((dom, idx) => {
    const domMods = modsByDom.get(dom.id) || [];
    const col = laneOrderRank(dom.primaryLane);
    const rowIdx = colCounts.get(col) || 0;
    colCounts.set(col, rowIdx + 1);

    const contractIds = [...new Set(domMods.map((m) => m.contractId).filter(Boolean))];
    const scopeSet = new Set([dom.key === 'root' ? './' : `${dom.key}/`]);
    for (const cid of contractIds) {
      const rc = rawById.get(cid);
      for (const sp of (rc?.scope || [])) {
        if (typeof sp === 'string' && sp.trim()) scopeSet.add(sp.trim().replace(/\\/g, '/'));
      }
    }

    const nodeId = `host-dom-${dom.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const saved = (savedState.hostNodeLayouts || {})[nodeId] || {};
    const nextDomIds = [...(nextDomMap.get(dom.id) || [])];
    const nextNodeIds = nextDomIds.map((did) => {
      const target = domains.find((d) => d.id === did);
      return target ? `host-dom-${target.key.replace(/[^A-Za-z0-9_-]/g, '-')}` : null;
    }).filter(Boolean);

    const collisionBranches = dom.activeBranches || [];
    const tipParts = [`共 ${domMods.length} 个源码模块`];
    if (dom.wildCount > 0) tipParts.push(`${dom.wildCount} 个尚未挂入契约保护`);
    if (contractIds.length > 0) tipParts.push(`关联契约：${contractIds.join('、')}`);
    if (collisionBranches.length > 1) tipParts.push(`活跃支线：${collisionBranches.join(' / ')}`);

    return {
      id: nodeId,
      step: String(idx + 1).padStart(2, '0'),
      title: dom.humanTitle || dom.key,
      tip: tipParts.join(' · '),
      contractIds,
      primaryContractId: contractIds[0] || null,
      lifecycleLabel: (contractIds[0] && summaryById.get(contractIds[0])?.lifecycleLabel) || (contractIds.length ? "草稿待冻结" : "未挂契约"),
      scopePaths: [...scopeSet],
      workflowBinding: (savedState.componentWorkflows || {})[nodeId] || null,
      bypassed: Boolean(saved.bypassed || false),
      collapsed: Boolean(saved.collapsed || false),
      expanded: saved.expanded !== undefined ? Boolean(saved.expanded) : domMods.length <= 4,
      color: saved.color || 'none',
      x: typeof saved.x === 'number' ? saved.x : 56 + col * 316,
      y: typeof saved.y === 'number' ? saved.y : 68 + rowIdx * 238,
      w: typeof saved.w === 'number' ? saved.w : 256,
      h: typeof saved.h === 'number' ? saved.h : null,
      nextIds: nextNodeIds,
      modules: domMods.slice(0, 14).map((m) => {
        const epNames = (m.entrypoints || []).map((ep) => ep.humanTitle).filter(Boolean);
        const label = epNames.length > 0 ? `${m.humanTitle}（${epNames.join(' / ')}）` : m.humanTitle;
        return {
          name: label,
          role: mapModRoleLabel(m),
          state: mapModState(m),
          path: m.path,
          vibeLabel: m.vibeLabel,
          aiPrompt: m.aiPrompt,
          techSummary: m.techSummary
        };
      })
    };
  });

  return {
    id: 'host-workspace',
    name: `${baseAtlas.project.name}（当前本仓）`,
    repoSlug: `local/${baseAtlas.project.name}`,
    isHost: true,
    readonly: false,
    tip: `${baseAtlas.project.summary} · 支持基于契约 scope[] 右键定位真实目录`,
    nodes,
    groups: Array.isArray(savedState.hostGroups) ? savedState.hostGroups : []
  };
}

function scanSiblingWorkspaces(projectRoot) {
  const absRoot = resolve(projectRoot);
  const parentDir = dirname(absRoot);
  const out = [];
  try {
    for (const ent of readdirSync(parentDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
      const full = join(parentDir, ent.name);
      if (resolve(full) === absRoot) continue;
      const hasMarker = existsSync(join(full, 'contracts')) || existsSync(join(full, '.donegate')) ||
        existsSync(join(full, 'package.json')) || existsSync(join(full, 'pyproject.toml'));
      if (!hasMarker) continue;
      out.push({
        id: `sib-${ent.name.replace(/[^A-Za-z0-9_-]/g, '-')}`,
        name: `相邻仓：${ent.name}`,
        repoSlug: `sibling/${ent.name}`,
        isHost: false,
        readonly: true,
        tip: `同级目录只读参考工作区（../${ent.name}）：可作为汇总节点引入或复制卡片结构`,
        nodes: [{
          id: `sib-n-${ent.name.slice(0, 8)}`,
          step: '外仓',
          title: `${ent.name} 核心入口`,
          tip: `位于 ../${ent.name}/ 的相邻工程目录`,
          scopePaths: [`../${ent.name}/`],
          bypassed: false, collapsed: false, expanded: true, x: 80, y: 120, w: 252, h: null, nextIds: [],
          modules: [{ name: `${ent.name} 工程根目录`, role: '外仓', state: 'ok', path: `../${ent.name}/package.json` }]
        }]
      });
      if (out.length >= 3) break;
    }
  } catch (err) {
    void err;
  }
  return out;
}

function loadRegisteredAdapterTemplates(projectRoot) {
  const localReg = join(resolve(projectRoot), 'adapters.registry.json');
  const regPath = existsSync(localReg) ? localReg : join(DG_ROOT, 'adapters.registry.json');
  const regRes = readJsonStrict(regPath);
  if (!regRes.ok || !Array.isArray(regRes.value?.adapters)) return [];

  const seenTools = new Set();
  const templates = [];
  for (const adp of regRes.value.adapters) {
    const tool = String(adp.tool || '').trim();
    if (!tool || seenTools.has(tool)) continue;
    seenTools.add(tool);

    const localCap = join(resolve(projectRoot), 'bricks', tool, 'capabilities.json');
    const capPath = existsSync(localCap) ? localCap : join(DG_ROOT, 'bricks', tool, 'capabilities.json');
    const capRes = readJsonStrict(capPath);
    const capDoc = capRes.value || {};
    const cardCfg = (capDoc.card && typeof capDoc.card === 'object') ? capDoc.card : {};
    const upCfg = (capDoc.upstream && typeof capDoc.upstream === 'object') ? capDoc.upstream : {};
    const obsList = Array.isArray(capDoc.observables) ? capDoc.observables.slice(0, 3) : [];
    const up = UPSTREAM_GITHUB_MAP[tool] || [upCfg.repo || `opensource/${tool}`, adp.testedToolRange || 'v1.0.0', adp.testedToolRange || 'v1.0.0'];
    const repoSlug = upCfg.repo || up[0];
    const cat = cardCfg.category || (['gitleaks', 'osv-scanner', 'semgrep'].includes(tool)
      ? '安全与运维'
      : (['playwright', 'maestro', 'vitest'].includes(tool) ? '端侧与构建' : '代码护栏'));
    const inputs = Array.isArray(cardCfg.inputs) && cardCfg.inputs.length > 0
      ? cardCfg.inputs
      : [{ id: 'in_src', name: '代码或构建快照', type: 'ARTIFACT' }];
    const outputs = Array.isArray(cardCfg.outputs) && cardCfg.outputs.length > 0
      ? cardCfg.outputs
      : [{ id: 'out_sig', name: '0-3 判定码', type: 'SIGNAL' }, { id: 'out_obs', name: '观测声明原文', type: 'TEXT' }];
    const slots = Array.isArray(cardCfg.slots) && cardCfg.slots.length > 0
      ? cardCfg.slots
      : (obsList.length > 0
          ? obsList.map((o, i) => ({ id: `ob_${i}`, label: String(o.description || o.id || '观测项').slice(0, 20), wired: o.wired !== false, boundOut: outputs[Math.min(i, outputs.length - 1)].id }))
          : [{ id: 'ob_0', label: `${tool} 核心能力`, wired: true, boundOut: outputs[0].id }]);

    templates.push({
      tplId: `tpl-adp-${tool}`,
      category: cat,
      title: cardCfg.title || `${tool} 砂浆转接积木`,
      archetype: capDoc.archetype || 'scanner',
      uiExternalUrl: upCfg.uiExternalUrl || null,
      repoSlug,
      repoUrl: upCfg.homepage || `https://github.com/${repoSlug}`,
      pinnedVersion: up[1],
      latestUpstream: up[2],
      entryPath: adp.entry || `skill/adapters/${tool}.mjs`,
      brickDir: `bricks/${tool}/`,
      tip: cardCfg.summary || ((adp.blindSpots && adp.blindSpots[0]) ? `砂浆协议 v${adp.protocolVersion} · 边界：${adp.blindSpots[0]}` : `砂浆协议外部工具转接卡（${tool}）`),
      inputs,
      outputs,
      slots
    });
  }
  return templates;
}

function loadDeclarativeWorkflowPacks(projectRoot) {
  const packs = {};
  for (const base of [DG_ROOT, resolve(projectRoot)]) {
    const wfDir = join(base, 'workflows');
    if (!existsSync(wfDir)) continue;
    try {
      for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.workflow.json'))) {
        const r = readJsonStrict(join(wfDir, f));
        if (r.ok && r.value && r.value.id && Array.isArray(r.value.nodes)) {
          packs[r.value.id] = { group: r.value.group || '项目声明式开发流', ...r.value, links: r.value.links || [], groups: r.value.groups || [] };
        }
      }
    } catch (err) { void err; }
  }
  return packs;
}

export function hydrateWorkbenchData(projectRoot, baseAtlas) {
  const savedState = readSavedWorkbenchState(projectRoot);
  savedState.customPacks = { ...loadDeclarativeWorkflowPacks(projectRoot), ...(savedState.customPacks || {}) };
  const hostSandbox = buildHostSandboxFromAtlas(baseAtlas, savedState);
  const siblingSandboxes = scanSiblingWorkspaces(projectRoot);
  const registeredTemplates = loadRegisteredAdapterTemplates(projectRoot);
  return {
    hostId: hostSandbox.id,
    hostSandbox,
    siblingSandboxes,
    registeredTemplates,
    savedState
  };
}
