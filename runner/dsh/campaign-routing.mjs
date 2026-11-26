// 自适应执行路由与子代理工具/自愈预算控制（基于依赖耦合度与写范围冲突决定顺序或并行 Worktree）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';

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

export function crComputeDependencyWaves(nodes = [], links = []) {
  const active = (Array.isArray(nodes) ? nodes : []).filter(crIsActiveNode);
  const { byId, adj, indeg } = crBuildAdjacency(active, links);
  const waves = [];
  const visited = new Set();
  let frontier = active.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);

  while (frontier.length > 0) {
    const waveNodes = frontier.map((id) => byId.get(id)).filter(Boolean);
    for (const id of frontier) visited.add(id);
    waves.push({
      waveIndex: waves.length,
      nodeIds: waveNodes.map((n) => n.id),
      hasScopeConflict: crWaveHasScopeConflict(waveNodes),
      parallelizable: waveNodes.length > 1 && !crWaveHasScopeConflict(waveNodes)
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
      parallelizable: false
    });
  }
  return waves;
}

export function planCampaignExecutionStrategy(nodes = [], links = [], opts = {}) {
  const limits = crLoadAutopilotLimits(opts.projectRoot || null);
  const active = (Array.isArray(nodes) ? nodes : []).filter(crIsActiveNode);
  const waves = crComputeDependencyWaves(active, links);
  const maxWaveWidth = waves.reduce((mx, w) => Math.max(mx, w.nodeIds.length), 0);
  const hasConflict = waves.some((w) => w.hasScopeConflict);
  const hasParallelWave = waves.some((w) => w.parallelizable);
  const sharedState = opts.hasSharedExternalState === true;
  const toolBudget = Array.isArray(opts.tools)
    ? crPruneSubagentToolList(opts.tools, opts.maxSubagentTools || limits.maxSubagentTools)
    : null;

  let mode = 'single-agent-sequential';
  let maxConcurrency = 1;
  let reason = '组件数量 <= 1 或为纯顺序依赖链，采用单代理顺序执行以避免多代理协调损耗';
  if (sharedState) {
    reason = '存在共享外部状态约束，强制退回单代理顺序执行以确保确定性';
  } else if (hasConflict && !hasParallelWave) {
    reason = '同波次组件存在写范围重叠，自动降级为单代理顺序执行防止合并冲突';
  } else if (active.length > 1 && hasParallelWave) {
    mode = 'parallel-worktree';
    const cap = Number.isFinite(Number(opts.maxConcurrency)) && Number(opts.maxConcurrency) >= 1
      ? Math.floor(Number(opts.maxConcurrency))
      : 4;
    maxConcurrency = Math.min(maxWaveWidth, cap);
    reason = `检测到同波次存在 ${maxWaveWidth} 个写范围互不重叠的独立组件，启用按波次多 Worktree 并行执行`;
  }

  return {
    mode,
    reason,
    activeCount: active.length,
    waveCount: waves.length,
    maxWaveWidth,
    maxConcurrency,
    maxSelfHealRounds: Number(opts.maxSelfHealRounds || limits.maxSelfHealRounds),
    maxSubagentTools: Number(opts.maxSubagentTools || limits.maxSubagentTools),
    waves,
    toolBudget
  };
}
