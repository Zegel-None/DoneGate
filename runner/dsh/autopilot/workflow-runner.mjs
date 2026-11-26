// 完结门工作流确定性运行引擎与挂机持久状态机（真实适配器接线 + 缺依赖禁跑 + Worktree 沙箱 + 指纹免跑缓存 + 三重熔断）
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { normalizeLf, normalizeSlashes, normalizeWinDriveKey } from '../deps/index.mjs';
import { buildWorkflowDepEnv, inspectWorkflowDeps } from '../deps/index.mjs';
import {
  AUTOPILOT_BREAKER_CODES, AUTOPILOT_DEFAULT_MAX_ENV_FAULTS, AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS, AUTOPILOT_STATES,
  createInitialCheckpoint, isHumanGateNode, loadAutopilotCheckpoint, saveAutopilotCheckpoint, tripAutopilotBreaker
} from './autopilot-state.mjs';
import { cleanGitEnv, finalizeAutopilotWorktree, prepareAutopilotWorktree } from './autopilot-worktree.mjs';
import { lookupFingerprintCache, recordFingerprintCache } from '../deps/index.mjs';
import { buildBrickNodeExecSpec, executeBrickGateNode } from './brick-exec.mjs';
import { hagSanitizeSubagentEnv } from '../../shared/subagent-env.mjs';
import { crLoadAutopilotLimits } from './campaign-routing.mjs';
import { tlRecordRuleOutcomes } from './trust-ladder.mjs';

const HUB_MAP = new Map();

function wfrResolveEffectiveMaxLoops(linkMaxLoops, capLimit, allowExceed) {
  const n = Number(linkMaxLoops);
  if (!Number.isFinite(n) || n <= 0) return capLimit;
  return allowExceed ? Math.floor(n) : Math.min(Math.floor(n), capLimit);
}

function wfrResolveGateTelemetryState(record) {
  if (record.cacheHit) return 'cached';
  if (record.exitCode === 0) return 'pass';
  if (record.exitCode === 1) return 'fail';
  return 'fault';
}

function wfrUpsertDockItem(dockItems, item) {
  const idx = dockItems.findIndex((x) => x.id === item.id);
  if (idx >= 0) dockItems[idx] = item;
  else dockItems.unshift(item);
  if (dockItems.length > 16) dockItems.pop();
}

function wfrSummarizeHumanReason(node, exitCode, rawDiag) {
  if (exitCode === 0) return '';
  const lines = String(rawDiag || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const keyLine = lines.find((l) => /FAIL|拦截|违例|error|Error|未通过|缺失|不可用/i.test(l)) || lines[0] || '';
  const clean = keyLine.replace(/^\[[^\]]+\]\s*/, '').slice(0, 110);
  if (clean) return clean;
  return exitCode >= 2
    ? `运行环境或工具异常 (exit ${exitCode})，请点「检查记录」查看详情`
    : `检出代码或规则未达标项 (exit 1)，可交由主对话定位修复`;
}

function wfrApplyHubRecord(hubState, record) {
  const { recentEvents, activeCards, nodeTelemetry, dockItems } = hubState;
  recentEvents.push(record);
  if (recentEvents.length > 200) recentEvents.shift();
  if (record.type === 'micro_card_ready' && record.card?.targetUri) {
    activeCards.set(record.card.targetUri, record.card);
  }
  if (record.type === 'node_enter' && record.nodeId) {
    nodeTelemetry.set(record.nodeId, { nodeId: record.nodeId, state: 'running', updatedAt: record.ts });
  }
  if (record.type === 'gate_settled' && record.nodeId) {
    nodeTelemetry.set(record.nodeId, {
      nodeId: record.nodeId,
      state: wfrResolveGateTelemetryState(record),
      exitCode: record.exitCode,
      durationMs: record.durationMs || 0,
      cacheHit: Boolean(record.cacheHit),
      diagSummary: record.diagSummary || '',
      humanReason: record.humanReason || '',
      updatedAt: record.ts
    });
  }
  if (record.type === 'dock_item' && record.item) {
    wfrUpsertDockItem(dockItems, record.item);
  }
}

function wfrCreateHubInstance() {
  const listeners = new Set();
  const recentEvents = [];
  const activeCards = new Map();
  const nodeTelemetry = new Map();
  const dockItems = [];
  const hubState = { listeners, recentEvents, activeCards, nodeTelemetry, dockItems };
  return {
    listeners,
    recentEvents,
    activeCards,
    nodeTelemetry,
    dockItems,
    emit(evt) {
      const record = { seq: recentEvents.length + 1, ts: Date.now(), ...evt };
      wfrApplyHubRecord(hubState, record);
      for (const fn of listeners) {
        try {
          fn(record);
        } catch (err) {
          void err;
        }
      }
      return record;
    }
  };
}

export function getRunEventHub(projectRoot) {
  const key = normalizeWinDriveKey(resolve(projectRoot));
  if (!HUB_MAP.has(key)) {
    HUB_MAP.set(key, wfrCreateHubInstance());
  }
  return HUB_MAP.get(key);
}

export function preflightWorkflowPack(pack, opts = {}) {
  if (!pack || !Array.isArray(pack.nodes) || pack.nodes.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_WORKFLOW', reason: '工作流为空或缺少节点定义' };
  }
  const blankNode = pack.nodes.find((n) => (n.isBlank || n.tplId === 'tpl-blank') && !n.bypassed);
  if (blankNode) {
    return { ok: false, exitCode: 3, code: 'BLANK_NODE', nodeId: blankNode.id, reason: `节点「${blankNode.title || blankNode.id}」仍是空白待定节点，请先绑定节点或开启跳过` };
  }
  const uncfgCustom = pack.nodes.find((n) => n && n.isCustom && !n.customConfigured && !n.exec && !n.tool && !n.repoSlug && !n.bypassed);
  if (uncfgCustom) {
    return {
      ok: false, exitCode: 3, code: 'UNCONFIGURED_CUSTOM_NODE', nodeId: uncfgCustom.id,
      reason: `自定义节点「${uncfgCustom.title || uncfgCustom.id}」尚未配置检查规则，请先点击卡片「❝ 引用配规则」让主对话接入逻辑，或开启跳过`
    };
  }
  if (opts.enforceDeps !== false) {
    const depReport = inspectWorkflowDeps(opts.projectRoot || process.cwd(), pack, opts.env ? { env: opts.env } : {});
    if (!depReport.ready) {
      const names = depReport.missing.slice(0, 4).map((x) => x.title || x.id).join('、');
      return {
        ok: false, exitCode: 3, code: 'MISSING_WORKFLOW_DEPS',
        nodeId: depReport.missing[0]?.nodeIds?.[0] || null,
        depsDir: depReport.depsDir, sharedDepsDir: depReport.sharedDepsDir,
        missingDeps: depReport.missing, agentPrompt: depReport.agentPrompt,
        reason: `工作流缺少 ${depReport.missingCount} 项开源/环境依赖（${names}），无法运行；请先点击工作流旁「补齐依赖」安装至共享池 ${depReport.sharedDepsDir || depReport.depsDir}`
      };
    }
  }
  return { ok: true, exitCode: 0 };
}

function wfrIsInternalRuntimePath(normPath) {
  return normPath.startsWith('.donegate/') || normPath.startsWith('workflows/.deps/');
}

function wfrAccumulateNumstatStdout(stdout, files) {
  let added = 0;
  let removed = 0;
  for (const line of normalizeLf(stdout).split('\n').filter(Boolean)) {
    const [a, d, f] = line.split('\t');
    if (!f) continue;
    const norm = normalizeSlashes(f.trim());
    if (wfrIsInternalRuntimePath(norm)) continue;
    files.add(norm);
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) removed += Number(d);
  }
  return { added, removed };
}

function wfrCollectUntrackedFiles(stdout, files) {
  for (const u of normalizeLf(stdout).split('\n').map((s) => s.trim()).filter(Boolean)) {
    const norm = normalizeSlashes(u);
    if (!wfrIsInternalRuntimePath(norm)) files.add(norm);
  }
}

export function collectGitDiffStats(cwd) {
  const gitOpts = { encoding: 'utf8', env: cleanGitEnv(), windowsHide: true };
  const r = spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', 'diff', '--numstat', 'HEAD'], gitOpts);
  const rFallback = r.status === 0 ? r : spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', 'diff', '--numstat'], gitOpts);
  const files = new Set();
  const counts = rFallback.status === 0
    ? wfrAccumulateNumstatStdout(rFallback.stdout, files)
    : { added: 0, removed: 0 };
  const untracked = spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'], gitOpts);
  if (untracked.status === 0) {
    wfrCollectUntrackedFiles(untracked.stdout, files);
  }
  return { files: [...files], added: counts.added, removed: counts.removed };
}

export function checkWriteScopeMandate(files, allowedScopes, platform = process.platform) {
  if (!Array.isArray(allowedScopes) || allowedScopes.length === 0) return { ok: true, violated: [] };
  const fold = (s) => (platform === 'win32' ? s.toLowerCase() : s);
  const cleanScopes = allowedScopes.map((s) => fold(normalizeSlashes(s).replace(/^\.\//, '')));
  if (cleanScopes.includes('') || cleanScopes.includes('./')) return { ok: true, violated: [] };
  const violated = files.filter((rawFile) => {
    const f = fold(normalizeSlashes(rawFile).replace(/^\.\//, ''));
    return !cleanScopes.some((s) => (s.endsWith('/') ? f.startsWith(s) : (f === s || f.startsWith(s + '/'))));
  });
  return { ok: violated.length === 0, violated };
}

function wfrRehydrateFailedGateMap(existingCp) {
  const map = new Map();
  for (const item of Array.isArray(existingCp?.completedNodes) ? existingCp.completedNodes : []) {
    if (!item || !item.nodeId) continue;
    if (Number(item.exitCode || 0) === 0) map.delete(item.nodeId);
    else map.set(item.nodeId, { nodeId: item.nodeId, title: item.title || item.nodeId, exitCode: item.exitCode, humanReason: item.humanReason || '' });
  }
  return map;
}

function wfrAdvanceDagCursor(curId, links, nodesById, pendingQueue, queuedIds, logEvent) {
  const outLinks = links.filter((l) => l.fromNode === curId && l.toNode !== curId);
  for (let i = 1; i < outLinks.length; i++) {
    const branchId = outLinks[i].toNode;
    if (nodesById.has(branchId) && !queuedIds.has(branchId)) {
      queuedIds.add(branchId);
      pendingQueue.push(branchId);
    }
  }
  if (outLinks.length > 0) {
    logEvent({ type: 'edge_traverse', linkId: outLinks[0].id });
    return nodesById.get(outLinks[0].toNode) || null;
  }
  while (pendingQueue.length > 0) {
    const nextId = pendingQueue.shift();
    if (nodesById.has(nextId)) return nodesById.get(nextId);
  }
  return null;
}

function wfrResumeExistingCheckpoint(root, existingCp) {
  const cleaned = { ...existingCp, state: AUTOPILOT_STATES.RUNNING, breaker: null };
  delete cleaned.briefMarkdown;
  delete cleaned.checkpointFile;
  return saveAutopilotCheckpoint(root, cleaned);
}

function wfrCheckCleanGitPrecondition(root, cp, runId, logEvent) {
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', env: cleanGitEnv(), windowsHide: true });
  if (st.status === 0 && st.stdout.trim() === '') return null;
  tripAutopilotBreaker(root, cp, {
    code: AUTOPILOT_BREAKER_CODES.DIRTY_WORKTREE_FAULT,
    nodeId: cp.cursorNodeId,
    reason: '挂机前检测到脏工作区或未提交文件，已触发安全隔离熔断'
  });
  logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine } });
  return { ok: false, exitCode: 3, code: AUTOPILOT_BREAKER_CODES.DIRTY_WORKTREE_FAULT, state: cp.state, reason: cp.breaker.reason, runId, checkpoint: cp };
}

function wfrSetupWorktreeSandbox(root, runId, ticket, existingCp, cp, hooks) {
  const wantSandbox = hooks.useWorktreeSandbox === true || Boolean(existingCp?.sandboxWorktree?.active);
  const wtInfo = wantSandbox ? prepareAutopilotWorktree(root, runId) : { ok: false };
  const fallbackCwd = ticket?.worktreePath ? resolve(root, ticket.worktreePath) : root;
  const workCwd = wtInfo.ok ? wtInfo.worktreePath : fallbackCwd;
  if (wtInfo.ok) {
    cp.sandboxWorktree = { active: true, status: 'running', worktreePath: wtInfo.relWorktreePath, branchName: wtInfo.branchName };
    saveAutopilotCheckpoint(root, cp);
  }
  return { wtInfo, workCwd };
}

function wfrBuildDagIndex(pack, cp) {
  const nodesById = new Map(pack.nodes.map((n) => [n.id, n]));
  const links = Array.isArray(pack.links) ? pack.links : [];
  const incomingCount = new Map(pack.nodes.map((n) => [n.id, 0]));
  for (const lk of links) {
    if (lk.fromNode !== lk.toNode && incomingCount.has(lk.toNode)) {
      incomingCount.set(lk.toNode, incomingCount.get(lk.toNode) + 1);
    }
  }
  const entryNode = pack.nodes.find((n) => (incomingCount.get(n.id) || 0) === 0) || pack.nodes[0];
  const startNode = (cp.cursorNodeId && nodesById.get(cp.cursorNodeId)) || entryNode;
  return { nodesById, links, startNode };
}

function wfrAbortWithBreaker(ctx, exitCode, code, nodeId, reason) {
  ctx.cp.sandboxWorktree = finalizeAutopilotWorktree(ctx.root, ctx.wtInfo, 'ABORTED', ctx.runId);
  tripAutopilotBreaker(ctx.root, ctx.cp, { code, nodeId, reason });
  ctx.logEvent({ type: 'dock_item', item: { id: ctx.runId, kind: 'blocked', tone: 'bad', title: ctx.cp.morningSummaryLine, targetNodeId: nodeId } });
  return { ok: false, exitCode, code, state: ctx.cp.state, runId: ctx.runId, breaker: ctx.cp.breaker, sandboxWorktree: ctx.cp.sandboxWorktree, checkpoint: ctx.cp };
}

function wfrSuspendAtHumanGate(ctx, current) {
  ctx.cp.state = AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE;
  ctx.cp.sandboxWorktree = finalizeAutopilotWorktree(ctx.root, ctx.wtInfo, 'SUSPENDED', ctx.runId);
  ctx.cp.pendingHumanGate = {
    nodeId: current.id,
    title: current.title || current.id,
    prompt: current.tip || '该节点涉及架构定稿、破坏性变更或上线放量，需人工确认后继续。',
    suspendedAt: new Date().toISOString()
  };
  saveAutopilotCheckpoint(ctx.root, ctx.cp);
  ctx.logEvent({ type: 'human_gate_suspended', nodeId: current.id, title: current.title });
  ctx.logEvent({
    type: 'dock_item',
    item: {
      id: ctx.runId, kind: 'question', tone: 'warn',
      title: ctx.cp.morningSummaryLine, targetNodeId: current.id, approveRunId: ctx.runId, approveNodeId: current.id
    }
  });
  return {
    ok: true, suspended: true, exitCode: 0, state: ctx.cp.state, runId: ctx.runId,
    pendingHumanGate: ctx.cp.pendingHumanGate, sandboxWorktree: ctx.cp.sandboxWorktree, checkpoint: ctx.cp
  };
}

function wfrStepRuleRouter(ctx, current) {
  let slotNeeded = 'out_3';
  if (ctx.lastExitCode === 0) slotNeeded = 'out_0';
  else if (ctx.lastExitCode === 1) slotNeeded = 'out_1';
  const matchedLink = ctx.links.find((l) => l.fromNode === current.id && l.fromSlot === slotNeeded)
    || ctx.links.find((l) => l.fromNode === current.id);
  if (!matchedLink) {
    ctx.current = ctx.pendingQueue.length > 0 ? ctx.nodesById.get(ctx.pendingQueue.shift()) : null;
    return null;
  }
  if (matchedLink.maxLoops) {
    const effMaxLoops = wfrResolveEffectiveMaxLoops(matchedLink.maxLoops, ctx.maxSelfHealCap, ctx.allowExceedLoops);
    const used = (ctx.loopCounters.get(matchedLink.id) || 0) + 1;
    if (used > effMaxLoops) {
      ctx.cp.loopCounts = Object.fromEntries(ctx.loopCounters);
      return wfrAbortWithBreaker(ctx, 1, AUTOPILOT_BREAKER_CODES.MAX_LOOPS_EXCEEDED, current.id, `单判据连续回跳已达上限 (${effMaxLoops} 次) 仍未过关，自动熔断防空烧 Token`);
    }
    ctx.loopCounters.set(matchedLink.id, used);
    ctx.cp.loopCounts = Object.fromEntries(ctx.loopCounters);
    ctx.logEvent({ type: 'loop_back', linkId: matchedLink.id, loopCount: used, maxLoops: effMaxLoops, mode: 'fresh_ralph', handoff: ctx.lastDiag.slice(0, 16384) });
  } else {
    ctx.logEvent({ type: 'edge_traverse', linkId: matchedLink.id });
  }
  ctx.current = ctx.nodesById.get(matchedLink.toNode);
  return null;
}

async function wfrExecuteAgentStep(ctx, current, round) {
  const t0 = Date.now();
  let stepDiag = '';
  if (typeof ctx.hooks.runAgentStep === 'function') {
    const res = await ctx.hooks.runAgentStep({
      node: current, round, handoff: ctx.lastDiag.slice(0, 16384), ticket: ctx.ticket, workCwd: ctx.workCwd
    });
    stepDiag = String(res?.summary || '');
    ctx.lastDiag = stepDiag;
  } else {
    const activeFails = [...ctx.failedGateMap.values()];
    stepDiag = activeFails.length > 0
      ? `已汇总上游 ${activeFails.length} 项拦截问题（${activeFails.map((x) => x.title).join('、')}），可一键发往主对话派工修复`
      : '上游门禁全部通过，无需生成额外修改指令';
  }
  const stepDurationMs = Date.now() - t0;
  ctx.logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: 0, durationMs: stepDurationMs, diagSummary: stepDiag.slice(0, 240), humanReason: '' });
  return { exitCode: 0, durationMs: stepDurationMs, diag: stepDiag, humanReason: '', abortResult: null };
}

function wfrHandleGateCacheHit(ctx, current, cacheRes) {
  const stepDiag = `⚡ 命中指纹缓存免跑 (${cacheRes.fp.watchedCount} 文件未变)`;
  ctx.lastExitCode = 0;
  ctx.lastDiag = cacheRes.entry.diagSummary || stepDiag;
  ctx.passedGates++;
  ctx.cacheHits++;
  ctx.cp.consecEnvFaults = 0;
  ctx.failedGateMap.delete(current.id);
  ctx.logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: 0, durationMs: 0, cacheHit: true, diagSummary: stepDiag, humanReason: '' });
  return { exitCode: 0, durationMs: 0, diag: stepDiag, humanReason: '', abortResult: null };
}

function wfrHandleGateFailure(ctx, current, stepExitCode, stepDiag) {
  const stepHumanReason = wfrSummarizeHumanReason(current, stepExitCode, stepDiag);
  ctx.failedGateMap.set(current.id, {
    nodeId: current.id, title: current.title || current.id, exitCode: stepExitCode, humanReason: stepHumanReason
  });
  if (stepExitCode < 2) return { stepHumanReason, abortResult: null };
  ctx.cp.consecEnvFaults = (ctx.cp.consecEnvFaults || 0) + 1;
  if (ctx.cp.consecEnvFaults < ctx.maxEnvFaults) return { stepHumanReason, abortResult: null };
  ctx.cp.totalGates = ctx.totalGates;
  ctx.cp.passedGates = ctx.passedGates;
  ctx.cp.lastExitCode = stepExitCode;
  const abortResult = wfrAbortWithBreaker(
    ctx, stepExitCode, AUTOPILOT_BREAKER_CODES.ENV_OR_PROTOCOL_FAULT, current.id,
    `节点「${current.title}」连续 ${ctx.cp.consecEnvFaults} 次报环境/协议异常 (exit ${stepExitCode})：${stepHumanReason}`
  );
  return { stepHumanReason, abortResult };
}

function wfrExecuteGateStep(ctx, current, resolvedSpec) {
  ctx.totalGates++;
  const cacheKeyArgs = Array.isArray(current.exec?.nodeArgs)
    ? current.exec.nodeArgs
    : [resolvedSpec.entryRel || resolvedSpec.scriptRel || current.tplId || current.id, resolvedSpec.obligationId || ''];
  const cacheRes = (ctx.useCache && current.cacheable !== false)
    ? lookupFingerprintCache(ctx.root, ctx.workCwd, current, cacheKeyArgs)
    : { hit: false, fp: null };
  if (cacheRes.hit) return wfrHandleGateCacheHit(ctx, current, cacheRes);

  const execOut = executeBrickGateNode(ctx.root, ctx.workCwd, current, ctx.wfEnv);
  const stepExitCode = execOut.exitCode;
  const stepDurationMs = execOut.durationMs;
  const stepDiag = execOut.diagSummary || '';
  ctx.lastExitCode = stepExitCode;
  ctx.lastDiag = stepDiag;
  let stepHumanReason = '';

  if (stepExitCode === 0) {
    ctx.passedGates++;
    ctx.cp.consecEnvFaults = 0;
    ctx.failedGateMap.delete(current.id);
    if (ctx.useCache && cacheRes.fp) recordFingerprintCache(ctx.root, cacheRes.fp, { durationMs: stepDurationMs, diagSummary: stepDiag });
  } else {
    const failRes = wfrHandleGateFailure(ctx, current, stepExitCode, stepDiag);
    if (failRes.abortResult) return { exitCode: stepExitCode, durationMs: stepDurationMs, diag: stepDiag, humanReason: failRes.stepHumanReason, abortResult: failRes.abortResult };
    stepHumanReason = failRes.stepHumanReason;
  }
  ctx.logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: stepExitCode, durationMs: stepDurationMs, cacheHit: false, diagSummary: stepDiag.slice(0, 320), humanReason: stepHumanReason });
  return { exitCode: stepExitCode, durationMs: stepDurationMs, diag: stepDiag, humanReason: stepHumanReason, abortResult: null };
}

function wfrTrySelfLoop(ctx, current, isAgent, stepExitCode) {
  const selfLoop = !isAgent && stepExitCode !== 0 && ctx.links.find((l) => l.fromNode === current.id && l.toNode === current.id && l.maxLoops);
  if (!selfLoop) return { action: 'none', result: null };
  const effSelfMax = wfrResolveEffectiveMaxLoops(selfLoop.maxLoops, ctx.maxSelfHealCap, ctx.allowExceedLoops);
  const used = (ctx.loopCounters.get(selfLoop.id) || 0) + 1;
  ctx.cp.lastExitCode = ctx.lastExitCode;
  ctx.cp.passedGates = ctx.passedGates;
  ctx.cp.totalGates = ctx.totalGates;
  if (used <= effSelfMax) {
    ctx.loopCounters.set(selfLoop.id, used);
    ctx.cp.loopCounts = Object.fromEntries(ctx.loopCounters);
    saveAutopilotCheckpoint(ctx.root, ctx.cp);
    ctx.logEvent({ type: 'loop_back', linkId: selfLoop.id, loopCount: used, maxLoops: effSelfMax, mode: 'fresh_ralph' });
    return { action: 'continue', result: null };
  }
  ctx.cp.loopCounts = Object.fromEntries(ctx.loopCounters);
  const abortRes = wfrAbortWithBreaker(ctx, ctx.lastExitCode, AUTOPILOT_BREAKER_CODES.MAX_LOOPS_EXCEEDED, current.id, `节点「${current.title}」自循环已达上限 (${effSelfMax} 次) 仍未达标，自动熔断停机`);
  return { action: 'abort', result: abortRes };
}

function wfrRecordCompletedStep(ctx, current, step) {
  ctx.cp.completedNodes.push({
    nodeId: current.id,
    title: current.title || current.id,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    diagSummary: step.diag.slice(0, 320),
    humanReason: step.humanReason,
    at: new Date().toISOString()
  });
  const curFailed = [...ctx.failedGateMap.values()];
  ctx.cp.lastExitCode = curFailed.length > 0 ? curFailed[0].exitCode : ctx.lastExitCode;
  ctx.cp.passedGates = ctx.passedGates;
  ctx.cp.totalGates = ctx.totalGates;
  ctx.cp.loopCounts = Object.fromEntries(ctx.loopCounters);

  ctx.current = wfrAdvanceDagCursor(current.id, ctx.links, ctx.nodesById, ctx.pendingQueue, ctx.queuedIds, ctx.logEvent);
  ctx.cp.cursorNodeId = ctx.current ? ctx.current.id : null;
  saveAutopilotCheckpoint(ctx.root, ctx.cp);
}

function wfrCreateRunLogger(hub, runId, journalPath) {
  return (payload) => {
    const rec = hub.emit({ runId, ...payload });
    appendFileSync(journalPath, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  };
}

function wfrHandlePreflightFailure(runId, pack, pre, logEvent) {
  const provisionPackId = pre.code === 'MISSING_WORKFLOW_DEPS' ? (pack.id || 'default') : null;
  logEvent({
    type: 'dock_item',
    item: { id: runId, kind: 'question', tone: 'warn', title: pre.reason, targetNodeId: pre.nodeId || null, provisionPackId }
  });
  return {
    ok: false, exitCode: pre.exitCode, code: pre.code, reason: pre.reason,
    missingDeps: pre.missingDeps || [], depsDir: pre.depsDir || null, runId
  };
}

function wfrCreateRunContext(params) {
  const { root, ticket, pack, hooks, runId, journalPath, logEvent, cp, existingCp, wtInfo, workCwd } = params;
  const { nodesById, links, startNode } = wfrBuildDagIndex(pack, cp);
  cp.state = AUTOPILOT_STATES.RUNNING;
  const autopilotLimits = crLoadAutopilotLimits(root);
  const maxSelfHealCap = Number(hooks.maxSelfHealRounds || autopilotLimits.maxSelfHealRounds || AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS);
  const loopEntries = Object.entries(cp.loopCounts || {}).map(([k, v]) => [k, Number(v)]);
  return {
    root, ticket, pack, hooks, runId, journalPath, logEvent, cp, wtInfo, workCwd,
    baselineFiles: new Set(Array.isArray(hooks.baselineTouchedFiles) ? hooks.baselineTouchedFiles : []),
    wfEnv: hagSanitizeSubagentEnv(buildWorkflowDepEnv(root, pack.id || 'default')),
    maxSelfHealCap,
    allowExceedLoops: hooks.allowExceedSelfHealCap === true,
    useCache: hooks.useFingerprintCache === true,
    maxEnvFaults: Number(hooks.maxConsecEnvFaults || AUTOPILOT_DEFAULT_MAX_ENV_FAULTS),
    nodesById, links, current: startNode,
    loopCounters: new Map(loopEntries),
    nodeVisitCounts: new Map(),
    pendingQueue: [],
    queuedIds: new Set(startNode ? [startNode.id] : []),
    lastExitCode: Number(cp.lastExitCode || 0),
    lastDiag: '',
    failedGateMap: wfrRehydrateFailedGateMap(existingCp),
    passedGates: Number(cp.passedGates || 0),
    totalGates: Number(cp.totalGates || 0),
    cacheHits: 0,
    stepGuard: 0
  };
}

async function wfrExecuteActiveNode(ctx, current, round, resolvedSpec, isAgent) {
  if (isHumanGateNode(current)) {
    ctx.logEvent({ type: 'human_gate_passed', nodeId: current.id, approvedBy: ctx.cp.approvedGates[current.id]?.by || '业主' });
    ctx.lastExitCode = 0;
    return { exitCode: 0, durationMs: 0, diag: '', humanReason: '', abortResult: null };
  }
  if (isAgent) return wfrExecuteAgentStep(ctx, current, round);
  return wfrExecuteGateStep(ctx, current, resolvedSpec);
}

async function wfrStepWorkflowNode(ctx) {
  const current = ctx.current;
  ctx.stepGuard++;
  ctx.cp.cursorNodeId = current.id;
  saveAutopilotCheckpoint(ctx.root, ctx.cp);

  if (current.bypassed || current.envSkipped) {
    ctx.logEvent({ type: current.bypassed ? 'node_bypassed' : 'node_skipped_env', nodeId: current.id });
    ctx.current = wfrAdvanceDagCursor(current.id, ctx.links, ctx.nodesById, ctx.pendingQueue, ctx.queuedIds, ctx.logEvent);
    return null;
  }
  if (isHumanGateNode(current) && !(ctx.cp.approvedGates && ctx.cp.approvedGates[current.id])) {
    return wfrSuspendAtHumanGate(ctx, current);
  }

  const round = (ctx.nodeVisitCounts.get(current.id) || 0) + 1;
  ctx.nodeVisitCounts.set(current.id, round);
  ctx.logEvent({ type: 'node_enter', nodeId: current.id, title: current.title, round });

  const resolvedSpec = current.exec || buildBrickNodeExecSpec(current.tplId, current, ctx.root);
  const isRouter = current.tplId === 'tpl-router-rule' || resolvedSpec.kind === 'rule_router';
  if (isRouter) return wfrStepRuleRouter(ctx, current);

  const isAgent = resolvedSpec.kind === 'agent_step' || current.tplId === 'tpl-deai-polish' || current.tplId === 'tpl-prompt-gen' || current.tplId === 'tpl-router-ai';
  const step = await wfrExecuteActiveNode(ctx, current, round, resolvedSpec, isAgent);
  if (step.abortResult) return step.abortResult;

  const newlyTouched = collectGitDiffStats(ctx.workCwd).files.filter((f) => !ctx.baselineFiles.has(f));
  const stepScope = checkWriteScopeMandate(newlyTouched, ctx.ticket?.mandate?.allowedWriteScopes || ctx.cp.ticket?.allowedWriteScopes);
  if (!stepScope.ok) {
    return wfrAbortWithBreaker(ctx, 2, AUTOPILOT_BREAKER_CODES.WRITE_SCOPE_VIOLATION, current.id, `越界修改了未授权范围文件：${stepScope.violated.join(', ')}`);
  }

  const loopRes = wfrTrySelfLoop(ctx, current, isAgent, step.exitCode);
  if (loopRes.action === 'continue') return null;
  if (loopRes.action === 'abort') return loopRes.result;

  wfrRecordCompletedStep(ctx, current, step);
  return null;
}

function wfrFinalizeWorkflowRun(ctx) {
  const failedGateRecords = [...ctx.failedGateMap.values()];
  const finalExitCode = failedGateRecords.length > 0 ? failedGateRecords[0].exitCode : ctx.lastExitCode;
  const diff = collectGitDiffStats(ctx.workCwd);
  ctx.cp.sandboxWorktree = finalizeAutopilotWorktree(ctx.root, ctx.wtInfo, finalExitCode === 0 ? 'COMPLETED' : 'ABORTED', ctx.runId);
  ctx.cp.state = AUTOPILOT_STATES.COMPLETED;
  ctx.cp.cursorNodeId = null;
  ctx.cp.lastExitCode = finalExitCode;
  saveAutopilotCheckpoint(ctx.root, ctx.cp);

  if (typeof ctx.hooks.modelId === 'string' && ctx.hooks.modelId.trim()) {
    tlRecordRuleOutcomes(ctx.root, {
      modelId: ctx.hooks.modelId,
      flowId: ctx.pack.id || 'default',
      outcomes: (ctx.cp.completedNodes || []).map((n) => ({ nodeId: n.nodeId, title: n.title, passed: n.exitCode === 0 }))
    });
  }
  const defaultHeadline = finalExitCode === 0 ? `${ctx.pack.name}验证通过` : `${ctx.pack.name}未通过拦截`;
  const card = buildMicroVerdictCard({
    ticketId: ctx.runId, targetUri: ctx.ticket?.targetUri || null, exitCode: finalExitCode,
    headline: ctx.ticket?.headline || defaultHeadline,
    passedGates: ctx.passedGates, totalGates: Math.max(ctx.totalGates, 1),
    touchedFiles: diff.files, addedLines: diff.added, removedLines: diff.removed, canRollback: diff.files.length > 0
  });
  ctx.logEvent({ type: 'micro_card_ready', card });
  ctx.logEvent({ type: 'dock_item', item: { id: ctx.runId, kind: 'summary', tone: card.tone, title: `${card.headline} · ${card.gateBadge} · ${card.diffBadge}`, card } });
  const savedLog = existsSync(ctx.journalPath) ? readFileSync(ctx.journalPath, 'utf8').trim().split('\n').length : 0;
  return {
    ok: finalExitCode === 0, exitCode: finalExitCode, failedNodes: failedGateRecords,
    state: ctx.cp.state, runId: ctx.runId, cacheHits: ctx.cacheHits,
    sandboxWorktree: ctx.cp.sandboxWorktree, card, checkpoint: ctx.cp, eventCount: savedLog
  };
}

export async function executeDeterministicWorkflowRun(projectRoot, ticket, pack, hooks = {}) {
  const root = resolve(projectRoot);
  const hub = getRunEventHub(root);
  const existingCp = hooks.resumeRunId ? loadAutopilotCheckpoint(root, hooks.resumeRunId) : null;
  const runId = existingCp ? existingCp.runId : String(ticket?.ticketId || `run-${Date.now()}`);
  const runDir = join(root, '.donegate', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const journalPath = join(runDir, 'events.jsonl');
  if (!existingCp) writeFileSync(join(runDir, 'ticket.json'), JSON.stringify(ticket || {}, null, 2) + '\n', 'utf8');

  const logEvent = wfrCreateRunLogger(hub, runId, journalPath);
  const pre = preflightWorkflowPack(pack, { projectRoot: root, enforceDeps: hooks.enforceDeps });
  if (!pre.ok) return wfrHandlePreflightFailure(runId, pack, pre, logEvent);

  const cp = existingCp ? wfrResumeExistingCheckpoint(root, existingCp) : createInitialCheckpoint(root, runId, pack, ticket);
  if (hooks.requireCleanGit === true) {
    const dirtyRes = wfrCheckCleanGitPrecondition(root, cp, runId, logEvent);
    if (dirtyRes) return dirtyRes;
  }

  const { wtInfo, workCwd } = wfrSetupWorktreeSandbox(root, runId, ticket, existingCp, cp, hooks);
  const ctx = wfrCreateRunContext({ root, ticket, pack, hooks, runId, journalPath, logEvent, cp, existingCp, wtInfo, workCwd });

  while (ctx.current && ctx.stepGuard < 36) {
    const stopRes = await wfrStepWorkflowNode(ctx);
    if (stopRes) return stopRes;
  }
  if (ctx.current && ctx.stepGuard >= 36) {
    return wfrAbortWithBreaker(ctx, 1, AUTOPILOT_BREAKER_CODES.MAX_LOOPS_EXCEEDED, ctx.current.id, '工作流步数已达硬上限 (36 步) 仍未收敛，自动熔断停机');
  }
  return wfrFinalizeWorkflowRun(ctx);
}
