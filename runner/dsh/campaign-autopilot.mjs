// 项目看板多组件拓扑级过夜挂机总控编排器（Campaign Autopilot）：按组件依赖顺序自动选配/派生、分组件校验写入范围、共享 Worktree 汇总合回
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildDashboardPayload } from '../core/index.mjs';
import { readSavedWorkbenchState } from '../atlas/contract.mjs';
import { approveAutopilotHumanGate } from './autopilot-state.mjs';
import { finalizeAutopilotWorktree, prepareAutopilotWorktree } from './autopilot-worktree.mjs';
import { assignComponentWorkflow } from './workflow-jit.mjs';
import { collectGitDiffStats, executeDeterministicWorkflowRun, getRunEventHub } from './workflow-runner.mjs';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { planCampaignExecutionStrategy } from './campaign-routing.mjs';

function campTopoIsActiveNode(n) {
  if (!n || !n.id) return false;
  return !n.bypassed && !n.isBoundary && !n.isSubRepoRef && !n.isBlank;
}

function campTopoAddEdge(byId, adj, indeg, from, to) {
  if (!from || !to || from === to) return;
  if (!byId.has(from) || !byId.has(to)) return;
  const set = adj.get(from);
  if (set.has(to)) return;
  set.add(to);
  indeg.set(to, (indeg.get(to) || 0) + 1);
}

function campTopoBuildGraph(active, links) {
  const byId = new Map(active.map((n) => [n.id, n]));
  const adj = new Map(active.map((n) => [n.id, new Set()]));
  const indeg = new Map(active.map((n) => [n.id, 0]));
  for (const n of active) {
    const nextIds = Array.isArray(n.nextIds) ? n.nextIds : [];
    for (const nxt of nextIds) campTopoAddEdge(byId, adj, indeg, n.id, nxt);
  }
  const linkList = Array.isArray(links) ? links : [];
  for (const lk of linkList) {
    campTopoAddEdge(byId, adj, indeg, lk.fromNode || lk.from || lk.src, lk.toNode || lk.to || lk.dst);
  }
  return { byId, adj, indeg };
}

function campTopoDrainZeroIndegree(byId, adj, indeg, queue) {
  const ordered = [];
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    ordered.push(byId.get(id));
    for (const dst of adj.get(id) || []) {
      const nextDeg = (indeg.get(dst) || 1) - 1;
      indeg.set(dst, nextDeg);
      if (nextDeg <= 0 && !visited.has(dst)) queue.push(dst);
    }
  }
  return { ordered, visited };
}

export function sortSandboxComponentsTopologically(nodes = [], links = []) {
  const rawList = Array.isArray(nodes) ? nodes : [];
  const active = rawList.filter(campTopoIsActiveNode);
  const { byId, adj, indeg } = campTopoBuildGraph(active, links);
  const queue = active.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const { ordered, visited } = campTopoDrainZeroIndegree(byId, adj, indeg, queue);
  for (const n of active) {
    if (!visited.has(n.id)) ordered.push(n);
  }
  return ordered;
}

function saveCampaignState(projectRoot, stateObj) {
  const dir = join(resolve(projectRoot), '.donegate', 'autopilot');
  mkdirSync(dir, { recursive: true });
  const out = { ...stateObj, updatedAt: new Date().toISOString() };
  writeFileSync(join(dir, `campaign-${out.campaignId}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'campaign-latest.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

export function loadCampaignCheckpoint(projectRoot, campaignId = null) {
  const dir = join(resolve(projectRoot), '.donegate', 'autopilot');
  const p = campaignId ? join(dir, `campaign-${campaignId}.json`) : join(dir, 'campaign-latest.json');
  if (!existsSync(p)) return null;
  const r = readJsonStrict(p);
  return r.ok ? r.value : null;
}

export function stopCampaignAutopilot(projectRoot, { campaignId = null, by = '业主', note = '手动停止项目拓扑挂机' } = {}) {
  const cur = loadCampaignCheckpoint(projectRoot, campaignId);
  if (!cur) return { ok: true, noop: true, campaign: null };
  if (cur.state === 'COMPLETED') return { ok: true, noop: true, campaign: cur };
  const stopped = saveCampaignState(projectRoot, {
    ...cur,
    state: 'STOPPED',
    stoppedInfo: { by, note, at: new Date().toISOString() }
  });
  return { ok: true, noop: false, campaign: stopped };
}

function campRunNodePreFlightPlug(cwd, nodeExec) {
  if (!nodeExec || !nodeExec.preFlightPlug) return { ok: true };
  const r = spawnSync(nodeExec.preFlightPlug, { cwd, shell: true, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.error || r.status !== 0) {
    const msg = ((r.stderr || '') + '\n' + (r.stdout || '')).trim().slice(0, 400) || (r.error && r.error.message) || `exit=${r.status}`;
    return { ok: false, exitCode: 3, code: 'PREFLIGHT_PLUG_FAILED', reason: `前置护栏未通过 (${nodeExec.preFlightPlug})：${msg}` };
  }
  return { ok: true };
}

async function runSingleCampaignComponent(ctx, comp) {
  const { root, hub, campaignId, workCwd, existing, bindingsByNode, spec, hooks, executionPlan, approvedOperatorNodes } = ctx;
  const nodeExec = executionPlan?.nodeExecutionModes?.[comp.id] || { sandbox: 'worktree', resourceLocks: [], preFlightPlug: null, requiresOperatorGate: false };
  const effectiveCwd = nodeExec.sandbox === 'host-local' ? root : workCwd;
  if (nodeExec.requiresOperatorGate && !approvedOperatorNodes.has(comp.id)) {
    return {
      binding: { mode: 'operator-gate', baseMacroName: '人工目视/真机确认闸门' },
      subOut: {
        ok: true,
        suspended: true,
        runId: `${campaignId}-${comp.id}-operator`,
        pendingHumanGate: {
          kind: 'operator-visual-check',
          nodeId: comp.id,
          title: comp.title || comp.id,
          sandbox: nodeExec.sandbox,
          resourceLocks: nodeExec.resourceLocks,
          reason: `组件「${comp.title || comp.id}」声明了真机目视确认或人工判据（resourceLocks=${nodeExec.resourceLocks.join(',') || 'none'}），过夜阶段自动挂起等待人工实机确认后放行`
        }
      }
    };
  }
  const plugChk = campRunNodePreFlightPlug(effectiveCwd, nodeExec);
  if (!plugChk.ok) {
    return {
      binding: { mode: 'host-serial', baseMacroName: '前置护栏检查' },
      subOut: { ok: false, exitCode: plugChk.exitCode, code: plugChk.code, reason: plugChk.reason, runId: `${campaignId}-${comp.id}-plug` }
    };
  }
  let binding = bindingsByNode[comp.id];
  if (!binding || !binding.pack || !Array.isArray(binding.pack.nodes)) {
    const assigned = assignComponentWorkflow(root, comp, { actorRole: 'super-agent' });
    if (!assigned.ok) return { fatalAssign: assigned };
    binding = assigned.binding;
    bindingsByNode[comp.id] = binding;
    hub.emit({ type: 'jit_workflow_updated', nodeId: comp.id, binding });
  }
  hub.emit({ type: 'node_enter', nodeId: comp.id, title: comp.title, campaignId, sandbox: nodeExec.sandbox });
  const baselineFiles = collectGitDiffStats(effectiveCwd).files;
  const isResumingHere = existing?.suspendedComponentId === comp.id && existing?.suspendedSubRunId && existing?.pendingHumanGate?.kind !== 'operator-visual-check';
  const subRunId = isResumingHere ? existing.suspendedSubRunId : `${campaignId}-${comp.id}`;
  const ticket = {
    ticketId: subRunId,
    targetUri: `dg://sandbox/card/${encodeURIComponent(comp.id)}`,
    headline: `组件「${comp.title}」(${binding.baseMacroName || binding.mode})`,
    worktreePath: effectiveCwd,
    mandate: { allowedWriteScopes: Array.isArray(comp.scopePaths) ? comp.scopePaths : [] }
  };
  const subHookMap = (hooks.componentHooks && hooks.componentHooks[comp.id]) || hooks;
  const subOut = await executeDeterministicWorkflowRun(root, ticket, binding.pack, {
    resumeRunId: isResumingHere ? existing.suspendedSubRunId : null,
    useWorktreeSandbox: false,
    useFingerprintCache: spec.useFingerprintCache !== false,
    enforceDeps: spec.enforceDeps,
    baselineTouchedFiles: baselineFiles,
    runAgentStep: subHookMap.runAgentStep
  });
  return { binding, subOut, sandboxUsed: nodeExec.sandbox, effectiveCwd };
}

export async function executeProjectCampaignAutopilot(projectRoot, spec = {}, hooks = {}) {
  const root = resolve(projectRoot);
  const hub = getRunEventHub(root);
  const existing = spec.resumeCampaignId ? loadCampaignCheckpoint(root, spec.resumeCampaignId) : null;
  const campaignId = existing ? existing.campaignId : String(spec.campaignId || `camp-${Date.now()}`);
  const rawNodes = Array.isArray(spec.nodes) && spec.nodes.length > 0
    ? spec.nodes
    : (existing?.nodes || buildDashboardPayload(root)?.workbench?.hostSandbox?.nodes || []);
  const rawLinks = Array.isArray(spec.links) ? spec.links : (existing?.links || []);
  const ordered = sortSandboxComponentsTopologically(rawNodes, rawLinks);
  if (ordered.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_PROJECT_COMPONENTS', reason: '当前项目看板无可挂机组件节点（已跳过空白与外部子仓节点）' };
  }
  const executionPlan = planCampaignExecutionStrategy(rawNodes, rawLinks, {
    projectRoot: root,
    tools: spec.tools,
    maxConcurrency: spec.maxConcurrency,
    hasSharedExternalState: spec.hasSharedExternalState
  });

  const allHostLocal = ordered.every((c) => executionPlan.nodeExecutionModes?.[c.id]?.sandbox === 'host-local');
  const wtInfo = (spec.useWorktreeSandbox !== false && !allHostLocal) ? prepareAutopilotWorktree(root, campaignId) : { ok: false };
  const workCwd = wtInfo.ok ? wtInfo.worktreePath : root;
  const bindingsByNode = { ...(readSavedWorkbenchState(root).componentWorkflows || {}), ...(spec.componentWorkflows || {}) };
  const completedComponentIds = new Set(existing?.completedComponentIds || []);
  const approvedOperatorNodes = new Set([...(existing?.approvedOperatorNodes || []), ...(spec.approvedOperatorNodes || [])]);
  const componentReports = Array.isArray(existing?.componentReports) ? [...existing.componentReports] : [];
  let totalCacheHits = Number(existing?.totalCacheHits || 0);
  let totalPassedGates = Number(existing?.totalPassedGates || 0);
  let totalGates = Number(existing?.totalGates || 0);
  const orderedIds = ordered.map((x) => x.id);

  for (const comp of ordered) {
    if (completedComponentIds.has(comp.id)) continue;
    const step = await runSingleCampaignComponent({ root, hub, campaignId, workCwd, existing, bindingsByNode, spec, hooks, executionPlan, approvedOperatorNodes }, comp);
    if (step.fatalAssign) return step.fatalAssign;
    const { binding, subOut, sandboxUsed } = step;
    totalCacheHits += Number(subOut.cacheHits || 0);

    if (subOut.suspended && subOut.pendingHumanGate) {
      const campState = saveCampaignState(root, {
        campaignId, state: 'SUSPENDED_HUMAN_GATE', nodes: rawNodes, links: rawLinks, orderedIds, executionPlan,
        completedComponentIds: [...completedComponentIds], approvedOperatorNodes: [...approvedOperatorNodes], componentReports,
        suspendedComponentId: comp.id, suspendedComponentTitle: comp.title,
        suspendedSubRunId: subOut.runId, pendingHumanGate: subOut.pendingHumanGate,
        sandboxWorktree: finalizeAutopilotWorktree(root, wtInfo, 'SUSPENDED', campaignId),
        totalCacheHits, totalPassedGates, totalGates
      });
      return {
        ok: true, suspended: true, exitCode: 0, campaignId, state: campState.state, executionPlan,
        suspendedComponentId: comp.id, suspendedSubRunId: subOut.runId,
        pendingHumanGate: subOut.pendingHumanGate, sandboxWorktree: campState.sandboxWorktree, campaign: campState
      };
    }

    hub.emit({
      type: 'gate_settled', nodeId: comp.id, exitCode: subOut.exitCode,
      durationMs: subOut.checkpoint?.completedNodes?.length || 0, cacheHit: false,
      diagSummary: subOut.reason || `${binding.baseMacroName || '工作流'} -> exit ${subOut.exitCode}`
    });
    componentReports.push({
      nodeId: comp.id, title: comp.title, workflowName: binding.baseMacroName || binding.pack?.name || binding.mode,
      mode: binding.mode, sandboxUsed: sandboxUsed || 'worktree', runId: subOut.runId, ok: Boolean(subOut.ok), exitCode: subOut.exitCode,
      code: subOut.code || null, reason: subOut.reason || subOut.breaker?.reason || null
    });

    if (!subOut.ok) {
      const quarantined = finalizeAutopilotWorktree(root, wtInfo, 'ABORTED', campaignId);
      const campState = saveCampaignState(root, {
        campaignId, state: 'ABORTED_BREAKER', failedComponentId: comp.id, failedComponentTitle: comp.title,
        code: subOut.code || 'COMPONENT_FAILED',
        reason: subOut.reason || subOut.breaker?.reason || `组件「${comp.title}」未通过工作流门禁`,
        orderedIds, completedComponentIds: [...completedComponentIds], componentReports,
        sandboxWorktree: quarantined, totalCacheHits
      });
      return {
        ok: false, exitCode: subOut.exitCode || 1, code: campState.code, reason: campState.reason,
        campaignId, failedComponentId: comp.id, componentReports, sandboxWorktree: quarantined, campaign: campState
      };
    }

    completedComponentIds.add(comp.id);
    totalPassedGates += Number(subOut.checkpoint?.passedGates || 1);
    totalGates += Math.max(1, Number(subOut.checkpoint?.totalGates || 1));
  }

  const finalDiff = collectGitDiffStats(workCwd);
  const finalizedWt = finalizeAutopilotWorktree(root, wtInfo, 'COMPLETED', campaignId);
  const campState = saveCampaignState(root, {
    campaignId, state: 'COMPLETED', orderedIds, completedComponentIds: [...completedComponentIds],
    componentReports, sandboxWorktree: finalizedWt, totalCacheHits, totalPassedGates, totalGates, executionPlan
  });
  const summaryCard = buildMicroVerdictCard({
    ticketId: campaignId, targetUri: null, exitCode: 0,
    headline: `项目全看板 ${ordered.length} 个组件拓扑挂机全绿通关`,
    passedGates: Math.max(totalPassedGates, ordered.length), totalGates: Math.max(totalGates, ordered.length),
    touchedFiles: finalDiff.files, addedLines: finalDiff.added, removedLines: finalDiff.removed, canRollback: false
  });
  hub.emit({
    type: 'dock_item',
    item: {
      id: campaignId, kind: 'summary', tone: 'ok',
      title: `🌅 项目拓扑挂机完成：按序跑通 ${ordered.length}/${ordered.length} 个组件专属工作流（缓存命中 ${totalCacheHits} 项）`,
      card: summaryCard
    }
  });
  return {
    ok: true, exitCode: 0, campaignId, state: 'COMPLETED', orderedIds, executionPlan,
    completedCount: completedComponentIds.size, totalComponents: ordered.length,
    cacheHits: totalCacheHits, componentReports, sandboxWorktree: finalizedWt, campaign: campState
  };
}

export async function approveAndResumeCampaignAutopilot(projectRoot, opts = {}, hooks = {}) {
  const root = resolve(projectRoot);
  const camp = loadCampaignCheckpoint(root, opts.campaignId || null);
  if (!camp || camp.state !== 'SUSPENDED_HUMAN_GATE') {
    return { ok: false, error: '未找到处于人工闸门挂起状态的项目级拓扑挂机单' };
  }
  const approvedOperatorNodes = [...new Set(Array.isArray(camp.approvedOperatorNodes) ? camp.approvedOperatorNodes : [])];
  if (camp.pendingHumanGate?.kind === 'operator-visual-check') {
    if (camp.suspendedComponentId && !approvedOperatorNodes.includes(camp.suspendedComponentId)) {
      approvedOperatorNodes.push(camp.suspendedComponentId);
    }
  } else {
    const app = approveAutopilotHumanGate(root, {
      runId: camp.suspendedSubRunId,
      nodeId: opts.nodeId || camp.pendingHumanGate?.nodeId || null,
      by: opts.by || '业主',
      note: opts.note || '项目拓扑挂机早间人工放行'
    });
    if (!app.ok) return app;
  }
  return executeProjectCampaignAutopilot(root, {
    campaignId: camp.campaignId,
    resumeCampaignId: camp.campaignId,
    approvedOperatorNodes,
    useWorktreeSandbox: Boolean(camp.sandboxWorktree?.active),
    useFingerprintCache: opts.useFingerprintCache !== false,
    enforceDeps: opts.enforceDeps
  }, hooks);
}
