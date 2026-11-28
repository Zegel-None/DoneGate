// 项目看板多组件拓扑级过夜挂机总控编排器（Campaign Autopilot）：按组件依赖顺序自动选配/派生、分组件校验写入范围、共享 Worktree 汇总合回
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { readSavedWorkbenchState } from '../../shared/workbench-state.mjs';
import { classifySandboxExecResult, verifySandboxEnforcementProbe, wrapCommandWithOsSandbox } from './autopilot-os-sandbox.mjs';
import { approveAutopilotHumanGate } from './autopilot-state.mjs';
import { finalizeAutopilotWorktree, prepareAutopilotWorktree } from './autopilot-worktree.mjs';
import { hagSanitizeId, hagSanitizeSubagentEnv } from '../../shared/subagent-env.mjs';
import { DEFAULT_EGRESS_IDLE_TIMEOUT_MS, startEgressAllowlistProxy, validateEgressAllowlist } from './egress-allowlist-proxy.mjs';
import { assignComponentWorkflow } from './workflow-jit.mjs';
import { collectGitDiffStats, executeDeterministicWorkflowRun, getRunEventHub } from './workflow-runner.mjs';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { crLoadAutopilotLimits, planCampaignExecutionStrategy } from './campaign-routing.mjs';
import { runAutopilotGcAudit } from './autopilot-gc.mjs';
import {
  captureGitWorkingTreeSha, evaluateAndApplyRatchetStep,
  formatRejectedPatchesHandoff, loadRejectedPatchesLedger
} from './ratchet-selector.mjs';
import { projectCampaignSessionState, reconcileAutopilotWorktreesAndPids } from './session-reconciler.mjs';

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
  const queue = active.filter((n) => (indeg.get(n.id) || 0).valueOf() === 0).map((n) => n.id);
  const { ordered, visited } = campTopoDrainZeroIndegree(byId, adj, indeg, queue);
  for (const n of active) {
    if (!visited.has(n.id)) ordered.push(n);
  }
  return ordered;
}

function saveCampaignState(projectRoot, stateObj) {
  const dir = join(resolve(projectRoot), '.donegate', 'autopilot');
  mkdirSync(dir, { recursive: true });
  const safeId = hagSanitizeId(stateObj?.campaignId, `camp-${Date.now()}`);
  const out = { ...stateObj, campaignId: safeId, updatedAt: new Date().toISOString() };
  writeFileSync(join(dir, `campaign-${safeId}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'campaign-latest.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

export function loadCampaignCheckpoint(projectRoot, campaignId = null) {
  const dir = join(resolve(projectRoot), '.donegate', 'autopilot');
  const safeId = campaignId ? hagSanitizeId(campaignId, '') : '';
  if (campaignId && !safeId) return null;
  const p = safeId ? join(dir, `campaign-${safeId}.json`) : join(dir, 'campaign-latest.json');
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

function campBuildComponentSandboxPlan(ctx, comp, effectiveCwd, nodeExec, subRunId) {
  if (nodeExec.sandbox === 'host-local') return { ok: true, mode: 'host-local', egressMode: 'none', env: hagSanitizeSubagentEnv(process.env), command: nodeExec.preFlightPlug || '' };
  const { root, spec, activeProxyUrl } = ctx;
  return wrapCommandWithOsSandbox(root, nodeExec.preFlightPlug || 'node -e "process.exit(0)"', {
    worktreePath: effectiveCwd,
    allowedWriteScopes: Array.isArray(comp.scopePaths) ? comp.scopePaths : [],
    allowNetwork: Boolean(activeProxyUrl || spec.allowNetwork),
    allowedHosts: Array.isArray(spec.egressAllowedHosts) ? spec.egressAllowedHosts : [],
    proxyUrl: activeProxyUrl || null,
    noProxy: spec.noProxy,
    strict: spec.strictSandbox === true,
    runId: subRunId,
    simulateMissing: spec.simulateMissingOsSandbox,
    mockBinPath: spec.mockOsSandboxBinPath,
    platform: spec.sandboxPlatform,
    allowWin32Alpha: spec.allowWin32Alpha
  });
}

function campRunNodePreFlightPlug(cwd, nodeExec, sandboxPlan) {
  if (!nodeExec || !nodeExec.preFlightPlug) return { ok: true };
  const plugEnv = { ...(sandboxPlan?.env || hagSanitizeSubagentEnv(process.env)) };
  for (const k of Array.isArray(nodeExec.envPassthrough) ? nodeExec.envPassthrough : []) {
    if (k && Object.prototype.hasOwnProperty.call(process.env, k)) plugEnv[k] = process.env[k];
  }
  const cmd = sandboxPlan?.mode === 'os-sandbox-srt' ? sandboxPlan.command : nodeExec.preFlightPlug;
  const r = spawnSync(cmd, { cwd, env: plugEnv, shell: true, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.error || r.status !== 0) {
    const cls = classifySandboxExecResult({ stdout: r.stdout, stderr: r.stderr, exitCode: r.status });
    const msg = ((r.stderr || '') + '\n' + (r.stdout || '')).trim().slice(0, 400) || (r.error && r.error.message) || `exit=${r.status}`;
    return {
      ok: false, exitCode: 3,
      code: cls.sandboxDenied ? 'SANDBOX_DENIED' : 'PREFLIGHT_PLUG_FAILED',
      verdictState: cls.state, reasonCode: cls.reasonCode,
      reason: `前置护栏未通过 (${nodeExec.preFlightPlug})：${msg}`
    };
  }
  return { ok: true };
}

function campMaybeSettleIntraLoopRatchet(ratchetCtx, stepArgs) {
  if (!ratchetCtx || Number(stepArgs.round || 1) <= 1 || ratchetCtx.attemptRound > 1) return;
  const touched = collectGitDiffStats(ratchetCtx.effectiveCwd).files.filter((f) => !ratchetCtx.baseSet.has(f));
  evaluateAndApplyRatchetStep({
    projectRoot: ratchetCtx.root, campaignId: ratchetCtx.campaignId, componentId: ratchetCtx.compId,
    workCwd: ratchetCtx.effectiveCwd, ratchet: ratchetCtx.ratchet, round: stepArgs.round - 1,
    touchedFiles: touched, subOut: { ok: false, handoff: stepArgs.handoff || '' }
  });
}

function campWrapSubAgentHook(rawAgentHook, sandboxPlan, activeProxyUrl, ratchetCtx = null) {
  if (typeof rawAgentHook !== 'function') return undefined;
  return async (stepArgs) => {
    campMaybeSettleIntraLoopRatchet(ratchetCtx, stepArgs);
    const ledger = ratchetCtx ? loadRejectedPatchesLedger(ratchetCtx.root, ratchetCtx.campaignId) : null;
    const compEntries = ledger ? ledger.entries.filter((e) => e.componentId === ratchetCtx.compId) : [];
    const mergedHandoff = [stepArgs.handoff || '', ratchetCtx?.attemptHandoff || '', formatRejectedPatchesHandoff(compEntries)].filter(Boolean).join('\n\n');
    return rawAgentHook({
      ...stepArgs,
      round: ratchetCtx && ratchetCtx.attemptRound > 1 ? ratchetCtx.attemptRound : stepArgs.round,
      handoff: mergedHandoff,
      rejectedPatches: compEntries,
      bestTreeSha: ratchetCtx?.ratchet?.bestTreeSha || null,
      bestPassedGates: ratchetCtx?.ratchet?.bestPassedGates ?? 0,
      env: sandboxPlan.env,
      sandbox: { mode: sandboxPlan.mode, egressMode: sandboxPlan.egressMode, proxyUrl: activeProxyUrl || null, policyPath: sandboxPlan.policyPath || null }
    });
  };
}

function campResolveComponentRetryBudget(root, spec, comp, pack, rawAgentHook) {
  if (typeof rawAgentHook !== 'function') return 1;
  const hasInternalLoop = Array.isArray(pack?.links) && pack.links.some((lk) => Number(lk?.maxLoops) > 0);
  const explicitRetries = comp?.maxSelfHealRounds ?? spec?.maxSelfHealRounds;
  if (hasInternalLoop && explicitRetries === undefined) return 1;
  const healRounds = Number(explicitRetries ?? crLoadAutopilotLimits(root).maxSelfHealRounds);
  return 1 + (Number.isFinite(healRounds) && healRounds >= 0 ? Math.floor(healRounds) : 0);
}

function campBuildComponentTicket(comp, binding, effectiveCwd, sbPlan, activeProxyUrl, runIdForAttempt) {
  return {
    ticketId: runIdForAttempt, targetUri: `dg://sandbox/card/${encodeURIComponent(comp.id)}`,
    headline: `组件「${comp.title}」(${binding.baseMacroName || binding.mode})`, worktreePath: effectiveCwd,
    mandate: { allowedWriteScopes: Array.isArray(comp.scopePaths) ? comp.scopePaths : [] },
    sandbox: { mode: sbPlan.mode, egressMode: sbPlan.egressMode, proxyUrl: activeProxyUrl || null }
  };
}

function campIsHardStopOutcome(subOut) {
  return Boolean(subOut.suspended || subOut.code === 'WRITE_SCOPE_VIOLATION' || subOut.code === 'DIRTY_WORKTREE_FAULT');
}

function campShouldStopComponentRetries(subOut, ratchet) {
  if (subOut.ok || campIsHardStopOutcome(subOut)) return true;
  return subOut.exitCode >= 2 && !ratchet.lastRollback;
}

function campFormatAttemptFailureHandoff(subOut) {
  if (subOut.reason) return subOut.reason;
  return (subOut.failedNodes || []).map((n) => `${n.title}: ${n.humanReason}`).join('；');
}

async function campRunComponentWithRatchet(ctx, comp, binding, effectiveCwd, subRunId, sbPlan, isResumingHere) {
  const { root, campaignId, existing, spec, hooks, activeProxyUrl } = ctx;
  const subHookMap = (hooks.componentHooks && hooks.componentHooks[comp.id]) || hooks;
  const baselineFiles = collectGitDiffStats(effectiveCwd).files;
  const baseSet = new Set(baselineFiles);
  const ratchet = { bestTreeSha: captureGitWorkingTreeSha(effectiveCwd), bestPassedGates: Number(comp.baselinePassedGates ?? 0), rollbacks: 0, lastRollback: null };
  const maxAttempts = isResumingHere ? 1 : campResolveComponentRetryBudget(root, spec, comp, binding.pack, subHookMap.runAgentStep);
  let subOut = null, attemptHandoff = '';

  const useCacheFirst = spec.useFingerprintCache !== false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ticket = campBuildComponentTicket(comp, binding, effectiveCwd, sbPlan, activeProxyUrl, attempt === 1 ? subRunId : `${subRunId}-r${attempt}`);
    const ratchetCtx = { root, campaignId, compId: comp.id, effectiveCwd, baseSet, ratchet, attemptRound: attempt, attemptHandoff };
    subOut = await executeDeterministicWorkflowRun(root, ticket, binding.pack, {
      resumeRunId: isResumingHere ? existing.suspendedSubRunId : null, useWorktreeSandbox: false,
      useFingerprintCache: useCacheFirst && attempt === 1, enforceDeps: spec.enforceDeps, baselineTouchedFiles: baselineFiles,
      runAgentStep: campWrapSubAgentHook(subHookMap.runAgentStep, sbPlan, activeProxyUrl, ratchetCtx)
    });
    if (campIsHardStopOutcome(subOut)) break;
    const touchedNow = collectGitDiffStats(effectiveCwd).files.filter((f) => !baseSet.has(f));
    evaluateAndApplyRatchetStep({ projectRoot: root, campaignId, componentId: comp.id, workCwd: effectiveCwd, ratchet, round: attempt, touchedFiles: touchedNow, subOut });
    if (campShouldStopComponentRetries(subOut, ratchet)) break;
    attemptHandoff = campFormatAttemptFailureHandoff(subOut);
  }
  return { subOut: { ...subOut, ratchet }, ratchet };
}

async function runSingleCampaignComponent(ctx, comp) {
  const { root, hub, campaignId, workCwd, existing, bindingsByNode, spec, hooks, executionPlan, approvedOperatorNodes, activeProxyUrl } = ctx;
  const nodeExec = executionPlan?.nodeExecutionModes?.[comp.id] || { sandbox: 'worktree', resourceLocks: [], preFlightPlug: null, requiresOperatorGate: false };
  const effectiveCwd = nodeExec.sandbox === 'host-local' ? root : workCwd;
  if (nodeExec.requiresOperatorGate && !approvedOperatorNodes.has(comp.id)) {
    return {
      binding: { mode: 'operator-gate', baseMacroName: '人工目视/真机确认闸门' }, sandboxUsed: nodeExec.sandbox,
      subOut: {
        ok: true, suspended: true, runId: `${campaignId}-${comp.id}-operator`,
        pendingHumanGate: {
          kind: 'operator-visual-check', nodeId: comp.id, title: comp.title || comp.id, sandbox: nodeExec.sandbox, resourceLocks: nodeExec.resourceLocks,
          reason: `组件「${comp.title || comp.id}」声明了真机目视确认或人工判据（resourceLocks=${nodeExec.resourceLocks.join(',') || 'none'}），过夜阶段自动挂起等待人工实机确认后放行`
        }
      }
    };
  }
  const isResumingHere = existing?.suspendedComponentId === comp.id && existing?.suspendedSubRunId && existing?.pendingHumanGate?.kind !== 'operator-visual-check';
  const subRunId = isResumingHere ? existing.suspendedSubRunId : `${campaignId}-${comp.id}`;
  const sbPlan = campBuildComponentSandboxPlan(ctx, comp, effectiveCwd, nodeExec, subRunId);
  if (!sbPlan.ok) {
    return {
      binding: { mode: 'os-sandbox', baseMacroName: 'OS 强沙箱守卫' }, sandboxUsed: nodeExec.sandbox, osSandboxMode: sbPlan.mode, egressMode: sbPlan.egressMode,
      subOut: { ok: false, exitCode: sbPlan.exitCode, code: sbPlan.code, reason: sbPlan.reason, runId: `${subRunId}-sandbox` }
    };
  }
  const plugChk = campRunNodePreFlightPlug(effectiveCwd, nodeExec, sbPlan);
  if (!plugChk.ok) {
    return {
      binding: { mode: 'host-serial', baseMacroName: '前置护栏检查' }, sandboxUsed: nodeExec.sandbox, osSandboxMode: sbPlan.mode, egressMode: sbPlan.egressMode,
      subOut: { ok: false, exitCode: plugChk.exitCode, code: plugChk.code, verdictState: plugChk.verdictState, reasonCode: plugChk.reasonCode, reason: plugChk.reason, runId: `${campaignId}-${comp.id}-plug` }
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
  hub.emit({ type: 'node_enter', nodeId: comp.id, title: comp.title, campaignId, sandbox: nodeExec.sandbox, osSandboxMode: sbPlan.mode, egressMode: sbPlan.egressMode });
  const { subOut, ratchet } = await campRunComponentWithRatchet(ctx, comp, binding, effectiveCwd, subRunId, sbPlan, isResumingHere);
  return { binding, subOut, ratchet, sandboxUsed: nodeExec.sandbox, osSandboxMode: sbPlan.mode, egressMode: sbPlan.egressMode, effectiveCwd };
}

function campResolveInitialInputs(root, spec, hooks, existing) {
  const campaignId = existing ? existing.campaignId : hagSanitizeId(spec.campaignId, `camp-${Date.now()}`);
  const resolveNodes = typeof hooks.resolveAtlasNodes === 'function'
    ? hooks.resolveAtlasNodes
    : (typeof spec.resolveAtlasNodes === 'function' ? spec.resolveAtlasNodes : null);
  let rawNodes = [];
  if (Array.isArray(spec.nodes) && spec.nodes.length > 0) rawNodes = spec.nodes;
  else if (existing?.nodes) rawNodes = existing.nodes;
  else if (resolveNodes) rawNodes = resolveNodes(root) || [];
  const rawLinks = Array.isArray(spec.links) && spec.links.length > 0 ? spec.links : (existing?.links || []);
  const ordered = sortSandboxComponentsTopologically(rawNodes, rawLinks);
  const toolsOpt = spec.tools !== undefined ? spec.tools : existing?.tools;
  const sharedExtOpt = spec.hasSharedExternalState !== undefined ? spec.hasSharedExternalState : existing?.hasSharedExternalState;
  return { campaignId, rawNodes, rawLinks, ordered, toolsOpt, sharedExtOpt };
}

function campInitRunState(root, hub, spec, hooks, existing, inputs) {
  const { campaignId, rawNodes, rawLinks, ordered, toolsOpt, sharedExtOpt } = inputs;
  const executionPlan = planCampaignExecutionStrategy(rawNodes, rawLinks, {
    projectRoot: root, tools: toolsOpt, maxConcurrency: spec.maxConcurrency, hasSharedExternalState: sharedExtOpt
  });
  const allHostLocal = ordered.every((c) => executionPlan.nodeExecutionModes?.[c.id]?.sandbox === 'host-local');
  const wtInfo = (spec.useWorktreeSandbox !== false && !allHostLocal) ? prepareAutopilotWorktree(root, campaignId) : { ok: false };
  const workCwd = wtInfo.ok ? wtInfo.worktreePath : root;
  const bindingsByNode = {
    ...(readSavedWorkbenchState(root).componentWorkflows || {}),
    ...(existing?.componentWorkflows || {}),
    ...(spec.componentWorkflows || {})
  };
  return {
    root, hub, campaignId, rawNodes, rawLinks, ordered, orderedIds: ordered.map((x) => x.id),
    toolsOpt, sharedExtOpt, executionPlan, wtInfo, workCwd, existing, spec, hooks, bindingsByNode,
    activeProxyUrl: spec.proxyUrl || null, sessionEvents: [], reconciliation: spec.reconciliationResult || null,
    completedComponentIds: new Set(existing?.completedComponentIds || []),
    approvedOperatorNodes: new Set([...(existing?.approvedOperatorNodes || []), ...(spec.approvedOperatorNodes || [])]),
    componentReports: Array.isArray(existing?.componentReports) ? [...existing.componentReports] : [],
    totalCacheHits: Number(existing?.totalCacheHits || 0),
    totalPassedGates: Number(existing?.totalPassedGates || 0),
    totalGates: Number(existing?.totalGates || 0)
  };
}

function campBuildSharedStateSnapshot(st) {
  return {
    campaignId: st.campaignId, nodes: st.rawNodes, links: st.rawLinks,
    componentWorkflows: st.bindingsByNode, hasSharedExternalState: Boolean(st.sharedExtOpt),
    tools: st.toolsOpt || null, orderedIds: st.orderedIds,
    completedComponentIds: [...st.completedComponentIds], approvedOperatorNodes: [...st.approvedOperatorNodes],
    componentReports: st.componentReports, totalCacheHits: st.totalCacheHits
  };
}

function campHandleFatalAssign(st, comp, fatalAssign) {
  const quarantined = finalizeAutopilotWorktree(st.root, st.wtInfo, 'ABORTED', st.campaignId);
  saveCampaignState(st.root, {
    ...campBuildSharedStateSnapshot(st), state: 'ABORTED_BREAKER', failedComponentId: comp.id,
    code: fatalAssign.code || 'ASSIGN_FAILED', reason: fatalAssign.reason || '组件工作流分配失败', sandboxWorktree: quarantined
  });
  return { ...fatalAssign, sandboxWorktree: quarantined };
}

function campHandleSuspendedComponent(st, comp, subOut) {
  st.hub.emit({ type: 'campaign_suspended', campaignId: st.campaignId, nodeId: comp.id });
  const sessionProjection = projectCampaignSessionState(st.sessionEvents);
  const campState = saveCampaignState(st.root, {
    ...campBuildSharedStateSnapshot(st), state: 'SUSPENDED_HUMAN_GATE', activePid: null, sessionProjection, executionPlan: st.executionPlan,
    suspendedComponentId: comp.id, suspendedComponentTitle: comp.title, suspendedSubRunId: subOut.runId,
    pendingHumanGate: subOut.pendingHumanGate, sandboxWorktree: finalizeAutopilotWorktree(st.root, st.wtInfo, 'SUSPENDED', st.campaignId),
    totalPassedGates: st.totalPassedGates, totalGates: st.totalGates
  });
  return {
    ok: true, suspended: true, exitCode: 0, campaignId: st.campaignId, state: campState.state,
    executionPlan: st.executionPlan, suspendedComponentId: comp.id, suspendedSubRunId: subOut.runId,
    pendingHumanGate: subOut.pendingHumanGate, sandboxWorktree: campState.sandboxWorktree, sessionProjection, reconciliation: st.reconciliation, campaign: campState
  };
}

function campHandleFailedComponent(st, comp, subOut) {
  st.hub.emit({ type: 'campaign_failed', campaignId: st.campaignId, failedComponentId: comp.id });
  const sessionProjection = projectCampaignSessionState(st.sessionEvents);
  const quarantined = finalizeAutopilotWorktree(st.root, st.wtInfo, 'ABORTED', st.campaignId);
  const campState = saveCampaignState(st.root, {
    ...campBuildSharedStateSnapshot(st), state: 'ABORTED_BREAKER', activePid: null, sessionProjection, failedComponentId: comp.id, failedComponentTitle: comp.title,
    code: subOut.code || 'COMPONENT_FAILED', reason: subOut.reason || subOut.breaker?.reason || `组件「${comp.title}」未通过工作流门禁`,
    sandboxWorktree: quarantined
  });
  return {
    ok: false, exitCode: subOut.exitCode || 1, code: campState.code, reasonCode: subOut.reasonCode || null,
    verdictState: subOut.verdictState || null, reason: campState.reason,
    campaignId: st.campaignId, failedComponentId: comp.id, componentReports: st.componentReports,
    sandboxWorktree: quarantined, sessionProjection, reconciliation: st.reconciliation, campaign: campState
  };
}

function campRecordSettledComponent(st, comp, step) {
  const { binding, subOut, sandboxUsed, osSandboxMode, egressMode } = step;
  const rawDiag = subOut.reason || subOut.breaker?.reason || '';
  const denialCls = !subOut.ok ? classifySandboxExecResult({ stderr: rawDiag, exitCode: subOut.exitCode }) : null;
  st.hub.emit({
    type: 'gate_settled', nodeId: comp.id, exitCode: subOut.exitCode,
    durationMs: subOut.checkpoint?.completedNodes?.length || 0, cacheHit: false,
    diagSummary: rawDiag || `${binding.baseMacroName || '工作流'} -> exit ${subOut.exitCode}`
  });
  st.componentReports.push({
    nodeId: comp.id, title: comp.title, workflowName: binding.baseMacroName || binding.pack?.name || binding.mode,
    mode: binding.mode, sandboxUsed: sandboxUsed || 'worktree', osSandboxMode: osSandboxMode || null, egressMode: egressMode || 'none',
    runId: subOut.runId, ok: Boolean(subOut.ok), exitCode: subOut.exitCode,
    verdictState: subOut.verdictState || denialCls?.state || (subOut.ok ? 'pass' : 'fail'),
    reasonCode: subOut.reasonCode || denialCls?.reasonCode || null,
    code: subOut.code || null, reason: rawDiag || null,
    bestTreeSha: step.ratchet?.bestTreeSha || null, bestPassedGates: step.ratchet?.bestPassedGates ?? 0,
    ratchetRollbacks: step.ratchet?.rollbacks || 0
  });
}

function campFinalizeCompletedCampaign(st, egressSummary) {
  const wtDiff = collectGitDiffStats(st.workCwd);
  const hostUsed = st.componentReports.some((r) => r.sandboxUsed === 'host-local');
  const hostDiff = (st.wtInfo.ok && hostUsed) ? collectGitDiffStats(st.root) : { files: [], added: 0, removed: 0 };
  const finalDiff = { files: [...new Set([...wtDiff.files, ...hostDiff.files])], added: wtDiff.added + hostDiff.added, removed: wtDiff.removed + hostDiff.removed };
  const finalizedWt = finalizeAutopilotWorktree(st.root, st.wtInfo, 'COMPLETED', st.campaignId);
  const gcReport = st.spec?.runGcOnComplete ? runAutopilotGcAudit(st.root, st.spec.gcOptions || {}) : null;
  const campState = saveCampaignState(st.root, {
    campaignId: st.campaignId, state: 'COMPLETED', orderedIds: st.orderedIds,
    completedComponentIds: [...st.completedComponentIds], componentReports: st.componentReports,
    sandboxWorktree: finalizedWt, totalCacheHits: st.totalCacheHits,
    totalPassedGates: st.totalPassedGates, totalGates: st.totalGates, executionPlan: st.executionPlan, gcReport
  });
  const summaryCard = buildMicroVerdictCard({
    ticketId: st.campaignId, targetUri: null, exitCode: 0, headline: `项目全看板 ${st.ordered.length} 个组件拓扑挂机全绿通关`,
    passedGates: Math.max(st.totalPassedGates, st.ordered.length), totalGates: Math.max(st.totalGates, st.ordered.length),
    touchedFiles: finalDiff.files, addedLines: finalDiff.added, removedLines: finalDiff.removed, canRollback: false
  });
  st.hub.emit({
    type: 'dock_item',
    item: {
      id: st.campaignId, kind: 'summary', tone: 'ok',
      title: `🌅 项目拓扑挂机完成：按序跑通 ${st.ordered.length}/${st.ordered.length} 个组件专属工作流（缓存命中 ${st.totalCacheHits} 项）`,
      card: summaryCard
    }
  });
  const sessionProjection = projectCampaignSessionState(st.sessionEvents);
  const finalCamp = saveCampaignState(st.root, { ...campState, activePid: null, sessionProjection });
  return {
    ok: true, exitCode: 0, campaignId: st.campaignId, state: 'COMPLETED', orderedIds: st.orderedIds,
    executionPlan: st.executionPlan, completedCount: st.completedComponentIds.size, totalComponents: st.ordered.length,
    cacheHits: st.totalCacheHits, componentReports: st.componentReports, sandboxWorktree: finalizedWt, egressProxy: egressSummary, gcReport, sessionProjection, reconciliation: st.reconciliation, campaign: finalCamp
  };
}

async function campSetupEgressAndProbe(root, st, spec) {
  let proxy = null;
  if (spec.egressAllowedHosts !== undefined) {
    const check = validateEgressAllowlist(spec.egressAllowedHosts);
    if (!check.ok) {
      const quarantined = finalizeAutopilotWorktree(root, st.wtInfo, 'ABORTED', st.campaignId);
      return { ok: false, proxy: null, failure: { ok: false, exitCode: 3, code: check.reasonCode, reasonCode: check.reasonCode, reason: `出口白名单配置非法：${check.invalid.join(', ')}`, campaignId: st.campaignId, sandboxWorktree: quarantined } };
    }
    if (spec.egressAllowedHosts.length > 0) {
      proxy = await startEgressAllowlistProxy({
        allowedHosts: spec.egressAllowedHosts,
        idleTimeoutMs: spec.egressIdleTimeoutMs || DEFAULT_EGRESS_IDLE_TIMEOUT_MS,
        auditLogPath: spec.egressAuditLogPath,
        projectRoot: root
      });
      st.activeProxyUrl = proxy.proxyUrl;
    }
  }
  const needProbe = Boolean(proxy || spec.verifySandboxProbe === true || spec.proxyUrl || spec.protectedProbePath || spec.writeProbeRunner);
  if (!needProbe) return { ok: true, proxy };
  const probeRes = await verifySandboxEnforcementProbe(root, {
    proxyUrl: st.activeProxyUrl, expectEgressBlocked: Boolean(proxy || spec.proxyUrl || spec.expectEgressBlocked),
    probeBlockedHost: spec.probeBlockedHost, protectedProbePath: spec.protectedProbePath, writeProbeRunner: spec.writeProbeRunner,
    strict: spec.strictSandbox === true, mockBinPath: spec.mockOsSandboxBinPath, simulateMissing: spec.simulateMissingOsSandbox,
    platform: spec.sandboxPlatform, allowWin32Alpha: spec.allowWin32Alpha
  });
  if (!probeRes.ok) {
    if (proxy) await proxy.close();
    const quarantined = finalizeAutopilotWorktree(root, st.wtInfo, 'ABORTED', st.campaignId);
    return { ok: false, proxy: null, failure: { ok: false, exitCode: 3, code: probeRes.reasonCode, reasonCode: probeRes.reasonCode, reason: probeRes.reason, campaignId: st.campaignId, sandboxWorktree: quarantined } };
  }
  return { ok: true, proxy };
}

async function campExecuteOrderedComponents(st) {
  for (const comp of st.ordered) {
    if (st.completedComponentIds.has(comp.id)) continue;
    const step = await runSingleCampaignComponent(st, comp);
    if (step.fatalAssign) return campHandleFatalAssign(st, comp, step.fatalAssign);
    const { subOut } = step;
    st.totalCacheHits += Number(subOut.cacheHits || 0);
    if (subOut.suspended && subOut.pendingHumanGate) return campHandleSuspendedComponent(st, comp, subOut);
    campRecordSettledComponent(st, comp, step);
    if (!subOut.ok) return campHandleFailedComponent(st, comp, subOut);
    st.completedComponentIds.add(comp.id);
    st.totalPassedGates += Number(subOut.checkpoint?.passedGates || 1);
    st.totalGates += Math.max(1, Number(subOut.checkpoint?.totalGates || 1));
  }
  return null;
}

function campResolveExistingWithReconcile(root, spec, reconciliation) {
  const base = spec.resumeCampaignId ? loadCampaignCheckpoint(root, spec.resumeCampaignId) : null;
  if (base) return { ...base, completedComponentIds: [...new Set([...(base.completedComponentIds || []), ...reconciliation.recoveredCompletedComponentIds])] };
  const adopt = reconciliation.adoptableCampaign;
  if (spec.autoAdoptReconciled === false || !adopt) return null;
  if (spec.campaignId && adopt.campaignId !== spec.campaignId) return null;
  return { ...adopt, completedComponentIds: [...new Set([...(adopt.completedComponentIds || []), ...reconciliation.recoveredCompletedComponentIds])] };
}

export async function executeProjectCampaignAutopilot(projectRoot, spec = {}, hooks = {}) {
  const root = resolve(projectRoot), hub = getRunEventHub(root);
  const reconciliation = reconcileAutopilotWorktreesAndPids(root, {
    campaignId: spec.resumeCampaignId || spec.campaignId || null, killProbe: spec.killProbe, selfPid: spec.selfPid
  });
  const existing = campResolveExistingWithReconcile(root, spec, reconciliation);
  const enrichedSpec = { ...spec, reconciliationResult: reconciliation };
  const inputs = campResolveInitialInputs(root, enrichedSpec, hooks, existing);
  if (inputs.ordered.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_PROJECT_COMPONENTS', reason: '当前项目看板无可挂机组件节点（已跳过空白与外部子仓节点）' };
  }
  const st = campInitRunState(root, hub, enrichedSpec, hooks, existing, inputs);
  const onHubEvt = (evt) => st.sessionEvents.push(evt);
  hub.listeners.add(onHubEvt);
  hub.emit({ type: 'campaign_started', campaignId: st.campaignId, pid: process.pid });
  saveCampaignState(root, { ...campBuildSharedStateSnapshot(st), state: 'RUNNING', activePid: process.pid });
  const netGuard = await campSetupEgressAndProbe(root, st, enrichedSpec);
  if (!netGuard.ok) { hub.listeners.delete(onHubEvt); return netGuard.failure; }

  try {
    const halted = await campExecuteOrderedComponents(st);
    if (halted) return halted;
    const egressSummary = netGuard.proxy ? { proxyUrl: netGuard.proxy.proxyUrl, deniedCount: netGuard.proxy.deniedCount(), closed: true } : null;
    return campFinalizeCompletedCampaign(st, egressSummary);
  } finally {
    hub.listeners.delete(onHubEvt);
    if (netGuard.proxy) await netGuard.proxy.close();
  }
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
    saveCampaignState(root, { ...camp, approvedOperatorNodes });
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
    componentWorkflows: camp.componentWorkflows,
    hasSharedExternalState: camp.hasSharedExternalState,
    tools: camp.tools,
    useWorktreeSandbox: Boolean(camp.sandboxWorktree?.active),
    useFingerprintCache: opts.useFingerprintCache !== false,
    enforceDeps: opts.enforceDeps
  }, hooks);
}
