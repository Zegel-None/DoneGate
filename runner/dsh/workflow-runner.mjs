// 完结门工作流确定性运行引擎与挂机持久状态机（真实适配器接线 + 缺依赖禁跑 + Worktree 沙箱 + 指纹免跑缓存 + 三重熔断）
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { normalizeLf, normalizeSlashes, normalizeWinDriveKey } from './win-paths.mjs';
import { buildWorkflowDepEnv, inspectWorkflowDeps } from './workflow-deps.mjs';
import {
  AUTOPILOT_STATES, createInitialCheckpoint, isHumanGateNode,
  loadAutopilotCheckpoint, saveAutopilotCheckpoint, tripAutopilotBreaker
} from './autopilot-state.mjs';
import { cleanGitEnv, finalizeAutopilotWorktree, prepareAutopilotWorktree } from './autopilot-worktree.mjs';
import { lookupFingerprintCache, recordFingerprintCache } from './fingerprint-cache.mjs';
import { buildBrickNodeExecSpec, executeBrickGateNode } from './brick-exec.mjs';

const HUB_MAP = new Map();

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

function wfrResumeExistingCheckpoint(root, existingCp) {
  const cleaned = { ...existingCp, state: AUTOPILOT_STATES.RUNNING, breaker: null };
  delete cleaned.briefMarkdown;
  delete cleaned.checkpointFile;
  return saveAutopilotCheckpoint(root, cleaned);
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

  const logEvent = (payload) => {
    const rec = hub.emit({ runId, ...payload });
    appendFileSync(journalPath, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  };

  const pre = preflightWorkflowPack(pack, { projectRoot: root, enforceDeps: hooks.enforceDeps });
  if (!pre.ok) {
    logEvent({ type: 'dock_item', item: { id: runId, kind: 'question', tone: 'warn', title: pre.reason, targetNodeId: pre.nodeId || null, provisionPackId: pre.code === 'MISSING_WORKFLOW_DEPS' ? (pack.id || 'default') : null } });
    return { ok: false, exitCode: pre.exitCode, code: pre.code, reason: pre.reason, missingDeps: pre.missingDeps || [], depsDir: pre.depsDir || null, runId };
  }

  const cp = existingCp
    ? wfrResumeExistingCheckpoint(root, existingCp)
    : createInitialCheckpoint(root, runId, pack, ticket);

  if (hooks.requireCleanGit === true) {
    const st = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', env: cleanGitEnv(), windowsHide: true });
    if (st.status !== 0 || st.stdout.trim() !== '') {
      tripAutopilotBreaker(root, cp, { code: 'DIRTY_WORKTREE_FAULT', nodeId: cp.cursorNodeId, reason: '挂机前检测到脏工作区或未提交文件，已触发安全隔离熔断' });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine } });
      return { ok: false, exitCode: 3, code: 'DIRTY_WORKTREE_FAULT', state: cp.state, reason: cp.breaker.reason, runId, checkpoint: cp };
    }
  }

  const wantSandbox = hooks.useWorktreeSandbox === true || Boolean(existingCp?.sandboxWorktree?.active);
  const wtInfo = wantSandbox ? prepareAutopilotWorktree(root, runId) : { ok: false };
  const workCwd = wtInfo.ok
    ? wtInfo.worktreePath
    : (ticket?.worktreePath ? resolve(root, ticket.worktreePath) : root);
  if (wtInfo.ok) {
    cp.sandboxWorktree = { active: true, status: 'running', worktreePath: wtInfo.relWorktreePath, branchName: wtInfo.branchName };
    saveAutopilotCheckpoint(root, cp);
  }
  const baselineFiles = new Set(Array.isArray(hooks.baselineTouchedFiles) ? hooks.baselineTouchedFiles : []);

  const abortWithBreaker = (exitCode, code, nodeId, reason) => {
    cp.sandboxWorktree = finalizeAutopilotWorktree(root, wtInfo, 'ABORTED', runId);
    tripAutopilotBreaker(root, cp, { code, nodeId, reason });
    logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine, targetNodeId: nodeId } });
    return { ok: false, exitCode, code, state: cp.state, runId, breaker: cp.breaker, sandboxWorktree: cp.sandboxWorktree, checkpoint: cp };
  };

  const wfEnv = buildWorkflowDepEnv(root, pack.id || 'default');
  const useCache = hooks.useFingerprintCache === true;
  const nodesById = new Map(pack.nodes.map((n) => [n.id, n]));
  const links = Array.isArray(pack.links) ? pack.links : [];
  const incomingCount = new Map(pack.nodes.map((n) => [n.id, 0]));
  for (const lk of links) {
    if (lk.fromNode !== lk.toNode && incomingCount.has(lk.toNode)) incomingCount.set(lk.toNode, incomingCount.get(lk.toNode) + 1);
  }

  const entryNode = pack.nodes.find((n) => (incomingCount.get(n.id) || 0) === 0) || pack.nodes[0];
  let current = (cp.cursorNodeId && nodesById.get(cp.cursorNodeId)) || entryNode;
  cp.state = AUTOPILOT_STATES.RUNNING;
  const loopCounters = new Map(Object.entries(cp.loopCounts || {}).map(([k, v]) => [k, Number(v)]));
  let lastExitCode = Number(cp.lastExitCode || 0);
  let lastDiag = '';
  const failedGateRecords = [];
  let passedGates = Number(cp.passedGates || 0);
  let totalGates = Number(cp.totalGates || 0);
  let cacheHits = 0;
  const maxEnvFaults = Number(hooks.maxConsecEnvFaults || 2);
  let stepGuard = 0;

  while (current && stepGuard < 36) {
    stepGuard++;
    cp.cursorNodeId = current.id;
    saveAutopilotCheckpoint(root, cp);

    if (current.bypassed) {
      logEvent({ type: 'node_bypassed', nodeId: current.id });
      const nextLink = links.find((l) => l.fromNode === current.id);
      current = nextLink ? nodesById.get(nextLink.toNode) : null;
      continue;
    }

    if (isHumanGateNode(current) && !(cp.approvedGates && cp.approvedGates[current.id])) {
      cp.state = AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE;
      cp.sandboxWorktree = finalizeAutopilotWorktree(root, wtInfo, 'SUSPENDED', runId);
      cp.pendingHumanGate = {
        nodeId: current.id,
        title: current.title || current.id,
        prompt: current.tip || '该节点涉及架构定稿、破坏性变更或上线放量，需人工确认后继续。',
        suspendedAt: new Date().toISOString()
      };
      saveAutopilotCheckpoint(root, cp);
      logEvent({ type: 'human_gate_suspended', nodeId: current.id, title: current.title });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'question', tone: 'warn', title: cp.morningSummaryLine, targetNodeId: current.id, approveRunId: runId, approveNodeId: current.id } });
      return { ok: true, suspended: true, exitCode: 0, state: cp.state, runId, pendingHumanGate: cp.pendingHumanGate, sandboxWorktree: cp.sandboxWorktree, checkpoint: cp };
    }

    const round = (loopCounters.get(current.id) || 0) + 1;
    logEvent({ type: 'node_enter', nodeId: current.id, title: current.title, round });

    const resolvedSpec = current.exec || buildBrickNodeExecSpec(current.tplId, current, root);
    const isRouter = current.tplId === 'tpl-router-rule' || resolvedSpec.kind === 'rule_router';
    const isAgent = resolvedSpec.kind === 'agent_step' || current.tplId === 'tpl-deai-polish' || current.tplId === 'tpl-prompt-gen' || current.tplId === 'tpl-router-ai';

    if (isRouter) {
      const slotNeeded = lastExitCode === 0 ? 'out_0' : (lastExitCode === 1 ? 'out_1' : 'out_3');
      const matchedLink = links.find((l) => l.fromNode === current.id && l.fromSlot === slotNeeded) || links.find((l) => l.fromNode === current.id);
      if (!matchedLink) break;
      if (matchedLink.maxLoops) {
        const used = (loopCounters.get(matchedLink.id) || 0) + 1;
        if (used > matchedLink.maxLoops) {
          cp.loopCounts = Object.fromEntries(loopCounters);
          return abortWithBreaker(1, 'MAX_LOOPS_EXCEEDED', current.id, `单判据连续回跳已达上限 (${matchedLink.maxLoops} 次) 仍未过关，自动熔断防空烧 Token`);
        }
        loopCounters.set(matchedLink.id, used);
        cp.loopCounts = Object.fromEntries(loopCounters);
        logEvent({ type: 'loop_back', linkId: matchedLink.id, loopCount: used, maxLoops: matchedLink.maxLoops, mode: 'fresh_ralph', handoff: lastDiag.slice(0, 16384) });
      } else {
        logEvent({ type: 'edge_traverse', linkId: matchedLink.id });
      }
      current = nodesById.get(matchedLink.toNode);
      continue;
    }

    let stepExitCode = 0;
    let stepDurationMs = 0;
    let stepDiag = '';
    let stepHumanReason = '';

    if (isHumanGateNode(current)) {
      logEvent({ type: 'human_gate_passed', nodeId: current.id, approvedBy: cp.approvedGates[current.id]?.by || '业主' });
      lastExitCode = 0;
    } else if (isAgent) {
      const t0 = Date.now();
      if (typeof hooks.runAgentStep === 'function') {
        const res = await hooks.runAgentStep({ node: current, round, handoff: lastDiag.slice(0, 16384), ticket, workCwd });
        stepDiag = String(res?.summary || '');
        lastDiag = stepDiag;
      } else {
        stepDiag = failedGateRecords.length > 0
          ? `已汇总上游 ${failedGateRecords.length} 项拦截问题（${failedGateRecords.map((x) => x.title).join('、')}），可一键发往主对话派工修复`
          : '上游门禁全部通过，无需生成额外修改指令';
      }
      stepDurationMs = Date.now() - t0;
      stepExitCode = 0;
      logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: 0, durationMs: stepDurationMs, diagSummary: stepDiag.slice(0, 240), humanReason: '' });
    } else {
      totalGates++;
      const cacheKeyArgs = Array.isArray(current.exec?.nodeArgs)
        ? current.exec.nodeArgs
        : [resolvedSpec.entryRel || resolvedSpec.scriptRel || current.tplId || current.id, resolvedSpec.obligationId || ''];
      const cacheRes = (useCache && current.cacheable !== false) ? lookupFingerprintCache(root, workCwd, current, cacheKeyArgs) : { hit: false, fp: null };
      if (cacheRes.hit) {
        stepExitCode = 0;
        lastExitCode = 0;
        stepDiag = `⚡ 命中指纹缓存免跑 (${cacheRes.fp.watchedCount} 文件未变)`;
        lastDiag = cacheRes.entry.diagSummary || stepDiag;
        passedGates++;
        cacheHits++;
        cp.consecEnvFaults = 0;
        logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: 0, durationMs: 0, cacheHit: true, diagSummary: stepDiag, humanReason: '' });
      } else {
        const execOut = executeBrickGateNode(root, workCwd, current, wfEnv);
        stepExitCode = execOut.exitCode;
        stepDurationMs = execOut.durationMs;
        stepDiag = execOut.diagSummary || '';
        lastExitCode = stepExitCode;
        lastDiag = stepDiag;
        if (stepExitCode === 0) {
          passedGates++;
          cp.consecEnvFaults = 0;
          if (useCache && cacheRes.fp) recordFingerprintCache(root, cacheRes.fp, { durationMs: stepDurationMs, diagSummary: stepDiag });
        } else {
          stepHumanReason = wfrSummarizeHumanReason(current, stepExitCode, stepDiag);
          failedGateRecords.push({ nodeId: current.id, title: current.title || current.id, exitCode: stepExitCode, humanReason: stepHumanReason });
          if (stepExitCode >= 2) {
            cp.consecEnvFaults = (cp.consecEnvFaults || 0) + 1;
            if (cp.consecEnvFaults >= maxEnvFaults) {
              cp.totalGates = totalGates; cp.passedGates = passedGates; cp.lastExitCode = stepExitCode;
              return abortWithBreaker(stepExitCode, 'ENV_OR_PROTOCOL_FAULT', current.id, `节点「${current.title}」连续 ${cp.consecEnvFaults} 次报环境/协议异常 (exit ${stepExitCode})：${stepHumanReason}`);
            }
          }
        }
        logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: stepExitCode, durationMs: stepDurationMs, cacheHit: false, diagSummary: stepDiag.slice(0, 320), humanReason: stepHumanReason });
      }
    }

    const stepDiff = collectGitDiffStats(workCwd);
    const newlyTouched = stepDiff.files.filter((f) => !baselineFiles.has(f));
    const stepScope = checkWriteScopeMandate(newlyTouched, ticket?.mandate?.allowedWriteScopes || cp.ticket?.allowedWriteScopes);
    if (!stepScope.ok) {
      return abortWithBreaker(2, 'WRITE_SCOPE_VIOLATION', current.id, `越界修改了未授权范围文件：${stepScope.violated.join(', ')}`);
    }

    const selfLoop = !isAgent && stepExitCode !== 0 && links.find((l) => l.fromNode === current.id && l.toNode === current.id && l.maxLoops);
    if (selfLoop) {
      const used = (loopCounters.get(selfLoop.id) || 0) + 1;
      if (used <= selfLoop.maxLoops) {
        loopCounters.set(selfLoop.id, used);
        cp.loopCounts = Object.fromEntries(loopCounters);
        cp.lastExitCode = lastExitCode; cp.passedGates = passedGates; cp.totalGates = totalGates;
        saveAutopilotCheckpoint(root, cp);
        logEvent({ type: 'loop_back', linkId: selfLoop.id, loopCount: used, maxLoops: selfLoop.maxLoops, mode: 'fresh_ralph' });
        continue;
      }
      cp.loopCounts = Object.fromEntries(loopCounters);
      cp.lastExitCode = lastExitCode; cp.passedGates = passedGates; cp.totalGates = totalGates;
      return abortWithBreaker(lastExitCode, 'MAX_LOOPS_EXCEEDED', current.id, `节点「${current.title}」自循环已达上限 (${selfLoop.maxLoops} 次) 仍未达标，自动熔断停机`);
    }

    cp.completedNodes.push({
      nodeId: current.id,
      title: current.title || current.id,
      exitCode: stepExitCode,
      durationMs: stepDurationMs,
      diagSummary: stepDiag.slice(0, 320),
      humanReason: stepHumanReason,
      at: new Date().toISOString()
    });
    cp.lastExitCode = failedGateRecords.length > 0 ? failedGateRecords[0].exitCode : lastExitCode;
    cp.passedGates = passedGates;
    cp.totalGates = totalGates;
    cp.loopCounts = Object.fromEntries(loopCounters);

    const outLink = links.find((l) => l.fromNode === current.id && l.toNode !== current.id);
    if (outLink) logEvent({ type: 'edge_traverse', linkId: outLink.id });
    current = outLink ? nodesById.get(outLink.toNode) : null;
    cp.cursorNodeId = current ? current.id : null;
    saveAutopilotCheckpoint(root, cp);
  }

  const finalExitCode = failedGateRecords.length > 0 ? failedGateRecords[0].exitCode : lastExitCode;
  const diff = collectGitDiffStats(workCwd);
  cp.sandboxWorktree = finalizeAutopilotWorktree(root, wtInfo, finalExitCode === 0 ? 'COMPLETED' : 'ABORTED', runId);
  cp.state = AUTOPILOT_STATES.COMPLETED;
  cp.cursorNodeId = null;
  cp.lastExitCode = finalExitCode;
  saveAutopilotCheckpoint(root, cp);

  const card = buildMicroVerdictCard({
    ticketId: runId, targetUri: ticket?.targetUri || null, exitCode: finalExitCode,
    headline: ticket?.headline || (finalExitCode === 0 ? `${pack.name}验证通过` : `${pack.name}未通过拦截`),
    passedGates, totalGates: Math.max(totalGates, 1),
    touchedFiles: diff.files, addedLines: diff.added, removedLines: diff.removed, canRollback: diff.files.length > 0
  });
  logEvent({ type: 'micro_card_ready', card });
  logEvent({ type: 'dock_item', item: { id: runId, kind: 'summary', tone: card.tone, title: `${card.headline} · ${card.gateBadge} · ${card.diffBadge}`, card } });
  const savedLog = existsSync(journalPath) ? readFileSync(journalPath, 'utf8').trim().split('\n').length : 0;
  return { ok: finalExitCode === 0, exitCode: finalExitCode, failedNodes: failedGateRecords, state: cp.state, runId, cacheHits, sandboxWorktree: cp.sandboxWorktree, card, checkpoint: cp, eventCount: savedLog };
}
