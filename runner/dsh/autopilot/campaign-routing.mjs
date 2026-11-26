// 自适应执行路由与子代理工具/自愈预算控制（基于依赖耦合度与写范围冲突决定顺序或并行 Worktree）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { loadContracts } from '../../core/contract.mjs';
import { normalizeSlashes } from '../deps/index.mjs';

export const AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS = 2;
export const AUTOPILOT_MAX_SUBAGENT_TOOLS = 10;

export function crLoadAutopilotLimits(projectRoot) {
  const defaults = {
    maxSelfHealRounds: AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS,
    maxSubagentTools: AUTOPILOT_MAX_SUBAGENT_TOOLS
  };
  if (!projectRoot) return defaults;
  const thPath = join(resolve(projectRoot), 'thresholds.json');
  if (!existsSync(thPath)) return defaults;
  const r = readJsonStrict(thPath);
  const lim = r.ok && r.value && typeof r.value.autopilotLimits === 'object' ? r.value.autopilotLimits : null;
  if (!lim) return defaults;
  const rounds = Number(lim.maxSelfHealRounds);
  const tools = Number(lim.maxSubagentTools);
  return {
    maxSelfHealRounds: Number.isFinite(rounds) && rounds >= 1 ? Math.floor(rounds) : defaults.maxSelfHealRounds,
    maxSubagentTools: Number.isFinite(tools) && tools >= 1 ? Math.floor(tools) : defaults.maxSubagentTools
  };
}

export function crPruneSubagentToolList(tools = [], maxTools = AUTOPILOT_MAX_SUBAGENT_TOOLS) {
  const limit = Number.isFinite(Number(maxTools)) && Number(maxTools) >= 1
    ? Math.floor(Number(maxTools))
    : AUTOPILOT_MAX_SUBAGENT_TOOLS;
  const seen = new Set();
  const unique = [];
  for (const item of Array.isArray(tools) ? tools : []) {
    const name = String(item || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  const kept = unique.slice(0, limit);
  const dropped = unique.slice(limit);
  return {
    tools: kept,
    pruned: dropped.length > 0,
    droppedCount: dropped.length,
    droppedTools: dropped,
    limit
  };
}

function crIsActiveNode(n) {
  if (!n || !n.id) return false;
  return !n.bypassed && !n.isBoundary && !n.isSubRepoRef && !n.isBlank;
}

function crNormalizeScope(raw) {
  return normalizeSlashes(String(raw || '').trim()).replace(/^\.\//, '').replace(/\/+$/, '');
}

function crScopesOverlap(scopesA, scopesB) {
  const listA = (Array.isArray(scopesA) ? scopesA : []).map(crNormalizeScope).filter(Boolean);
  const listB = (Array.isArray(scopesB) ? scopesB : []).map(crNormalizeScope).filter(Boolean);
  if (listA.length === 0 || listB.length === 0) return false;
  for (const a of listA) {
    for (const b of listB) {
      if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) return true;
    }
  }
  return false;
}

function crWaveHasScopeConflict(waveNodes) {
  for (let i = 0; i < waveNodes.length; i++) {
    for (let j = i + 1; j < waveNodes.length; j++) {
      if (crScopesOverlap(waveNodes[i].scopePaths, waveNodes[j].scopePaths)) {
        return true;
      }
    }
  }
  return false;
}

function crBuildAdjacency(active, links) {
  const byId = new Map(active.map((n) => [n.id, n]));
  const adj = new Map(active.map((n) => [n.id, new Set()]));
  const indeg = new Map(active.map((n) => [n.id, 0]));
  const addEdge = (from, to) => {
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) return;
    const set = adj.get(from);
    if (set.has(to)) return;
    set.add(to);
    indeg.set(to, (indeg.get(to) || 0) + 1);
  };
  for (const n of active) {
    for (const nxt of Array.isArray(n.nextIds) ? n.nextIds : []) addEdge(n.id, nxt);
  }
  for (const lk of Array.isArray(links) ? links : []) {
    addEdge(lk.fromNode || lk.from || lk.src, lk.toNode || lk.to || lk.dst);
  }
  return { byId, adj, indeg };
}

function crResolveNodeExecutionProfile(node, contractMap) {
  const cid = node.contractId || node.id;
  const linked = (cid && contractMap.get(cid)) || null;
  const exec = { ...(linked?.execution || {}), ...(node.execution || {}) };
  const resourceLocks = [...new Set((Array.isArray(exec.resourceLocks) ? exec.resourceLocks : []).map((s) => String(s || '').trim()).filter(Boolean))];
  const sandbox = exec.sandbox === 'host-local' || resourceLocks.length > 0 ? 'host-local' : 'worktree';
  const hasHumanOb = Array.isArray(linked?.obligations) && linked.obligations.some((o) => o && o.kind === 'human');
  const requiresOperatorGate = Boolean(exec.operatorVisualCheck || hasHumanOb);
  return {
    sandbox,
    resourceLocks,
    preFlightPlug: typeof exec.preFlightPlug === 'string' && exec.preFlightPlug.trim() ? exec.preFlightPlug.trim() : null,
    envPassthrough: Array.isArray(exec.envPassthrough) ? exec.envPassthrough : [],
    operatorVisualCheck: Boolean(exec.operatorVisualCheck),
    hasHumanObligation: hasHumanOb,
    requiresOperatorGate
  };
}

function crWaveHasResourceConflict(waveNodes, execMap) {
  const seenLocks = new Set();
  for (const n of waveNodes) {
    const ex = execMap.get(n.id);
    if (!ex) continue;
    if (ex.sandbox === 'host-local' && waveNodes.length > 1) return true;
    for (const lk of ex.resourceLocks) {
      if (seenLocks.has(lk)) return true;
      seenLocks.add(lk);
    }
  }
  return false;
}

export function crComputeDependencyWaves(nodes = [], links = [], execMap = new Map()) {
  const active = (Array.isArray(nodes) ? nodes : []).filter(crIsActiveNode);
  const { byId, adj, indeg } = crBuildAdjacency(active, links);
  const waves = [];
  const visited = new Set();
  let frontier = active.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);

  while (frontier.length > 0) {
    const waveNodes = frontier.map((id) => byId.get(id)).filter(Boolean);
    for (const id of frontier) visited.add(id);
    const scopeConflict = crWaveHasScopeConflict(waveNodes);
    const resourceConflict = crWaveHasResourceConflict(waveNodes, execMap);
    const hasHostLocal = waveNodes.some((n) => execMap.get(n.id)?.sandbox === 'host-local');
    waves.push({
      waveIndex: waves.length,
      nodeIds: waveNodes.map((n) => n.id),
      hasScopeConflict: scopeConflict,
      hasResourceConflict: resourceConflict,
      sandboxMode: hasHostLocal ? 'host-local' : 'worktree',
      parallelizable: waveNodes.length > 1 && !scopeConflict && !resourceConflict && !hasHostLocal
    });
    const nextFrontier = [];
    for (const id of frontier) {
      for (const dst of adj.get(id) || []) {
        const nextDeg = (indeg.get(dst) || 1) - 1;
        indeg.set(dst, nextDeg);
        if (nextDeg <= 0 && !visited.has(dst) && !nextFrontier.includes(dst)) nextFrontier.push(dst);
      }
    }
    frontier = nextFrontier;
  }

  const cyclic = active.filter((n) => !visited.has(n.id));
  if (cyclic.length > 0) {
    waves.push({
      waveIndex: waves.length,
      nodeIds: cyclic.map((n) => n.id),
      hasScopeConflict: true,
      hasResourceConflict: false,
      sandboxMode: 'worktree',
      parallelizable: false
    });
  }
  return waves;
}

function crLoadContractMap(projectRoot) {
  const contractMap = new Map();
  if (!projectRoot) return contractMap;
  const absRoot = resolve(projectRoot);
  if (!existsSync(join(absRoot, 'contracts'))) return contractMap;
  const loaded = loadContracts(absRoot);
  for (const c of loaded.contracts || []) {
    if (c && c.id) contractMap.set(c.id, c);
  }
  return contractMap;
}

function crResolveConcurrencyCap(rawMax) {
  const parsed = Number(rawMax);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  return 4;
}

function crSelectExecutionMode(summary, opts) {
  const {
    activeCount, maxWaveWidth, hasConflict, hasParallelWave,
    hasHostLocalNodes, exclusiveResourceLocks, sharedState
  } = summary;
  const lockDesc = exclusiveResourceLocks.join(',') || 'host-local';
  if (sharedState) {
    return {
      mode: 'single-agent-sequential',
      maxConcurrency: 1,
      reason: '存在共享外部状态约束，强制退回单代理顺序执行以确保确定性'
    };
  }
  if (hasHostLocalNodes && !hasParallelWave) {
    return {
      mode: 'host-serial-exclusive',
      maxConcurrency: 1,
      reason: `检测到宿主机独占节点（resourceLocks=${lockDesc}），自动采用宿主机单源串行执行`
    };
  }
  if (hasHostLocalNodes && hasParallelWave) {
    const cap = crResolveConcurrencyCap(opts.maxConcurrency);
    return {
      mode: 'hybrid-worktree-and-host-serial',
      maxConcurrency: Math.min(maxWaveWidth, cap),
      reason: `混合分波调度：纯隔离组件走 Worktree 波次，宿主机独占组件（${lockDesc}）在宿主目录串行执行`
    };
  }
  if (hasConflict && !hasParallelWave) {
    return {
      mode: 'single-agent-sequential',
      maxConcurrency: 1,
      reason: '同波次组件存在写范围或独占资源锁重叠，自动降级为单代理顺序执行防止冲突'
    };
  }
  if (activeCount > 1 && hasParallelWave) {
    const cap = crResolveConcurrencyCap(opts.maxConcurrency);
    return {
      mode: 'parallel-worktree',
      maxConcurrency: Math.min(maxWaveWidth, cap),
      reason: `检测到同波次存在 ${maxWaveWidth} 个写范围互不重叠的独立组件，启用按波次多 Worktree 并行执行`
    };
  }
  return {
    mode: 'single-agent-sequential',
    maxConcurrency: 1,
    reason: '组件数量 <= 1 或为纯顺序依赖链，采用单代理顺序执行以避免多代理协调损耗'
  };
}

export function planCampaignExecutionStrategy(nodes = [], links = [], opts = {}) {
  const limits = crLoadAutopilotLimits(opts.projectRoot || null);
  const active = (Array.isArray(nodes) ? nodes : []).filter(crIsActiveNode);
  const contractMap = crLoadContractMap(opts.projectRoot);
  const execMap = new Map(active.map((n) => [n.id, crResolveNodeExecutionProfile(n, contractMap)]));
  const nodeExecutionModes = Object.fromEntries(execMap.entries());
  const exclusiveResourceLocks = [...new Set([...execMap.values()].flatMap((e) => e.resourceLocks))];
  const hasHostLocalNodes = [...execMap.values()].some((e) => e.sandbox === 'host-local');
  const waves = crComputeDependencyWaves(active, links, execMap);
  const maxWaveWidth = waves.reduce((mx, w) => Math.max(mx, w.nodeIds.length), 0);
  const hasConflict = waves.some((w) => w.hasScopeConflict || w.hasResourceConflict);
  const hasParallelWave = waves.some((w) => w.parallelizable);
  const toolBudget = Array.isArray(opts.tools)
    ? crPruneSubagentToolList(opts.tools, opts.maxSubagentTools || limits.maxSubagentTools)
    : null;

  const picked = crSelectExecutionMode({
    activeCount: active.length,
    maxWaveWidth,
    hasConflict,
    hasParallelWave,
    hasHostLocalNodes,
    exclusiveResourceLocks,
    sharedState: opts.hasSharedExternalState === true
  }, opts);

  return {
    mode: picked.mode,
    reason: picked.reason,
    activeCount: active.length,
    waveCount: waves.length,
    maxWaveWidth,
    maxConcurrency: picked.maxConcurrency,
    hasHostLocalNodes,
    exclusiveResourceLocks,
    nodeExecutionModes,
    maxSelfHealRounds: Number(opts.maxSelfHealRounds || limits.maxSelfHealRounds),
    maxSubagentTools: Number(opts.maxSubagentTools || limits.maxSubagentTools),
    waves,
    toolBudget
  };
}
