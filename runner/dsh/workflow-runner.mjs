// 完结门开发流确定性运行引擎与挂机持久状态机（类 ComfyUI 缺依赖禁跑 + 断点续跑 + 三重熔断 + 人工闸门，<= 285 行）
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { normalizeLf, normalizeSlashes } from './win-paths.mjs';
import { buildWorkflowDepEnv, inspectWorkflowDeps } from './workflow-deps.mjs';
import {
  AUTOPILOT_STATES, createInitialCheckpoint, isHumanGateNode,
  loadAutopilotCheckpoint, saveAutopilotCheckpoint, tripAutopilotBreaker
} from './autopilot-state.mjs';

const HUB_MAP = new Map();

export function getRunEventHub(projectRoot) {
  const key = normalizeSlashes(resolve(projectRoot));
  if (!HUB_MAP.has(key)) {
    const listeners = new Set();
    const recentEvents = [];
    const activeCards = new Map();
    const dockItems = [];
    HUB_MAP.set(key, {
      listeners, recentEvents, activeCards, dockItems,
      emit(evt) {
        const record = { seq: recentEvents.length + 1, ts: Date.now(), ...evt };
        recentEvents.push(record);
        if (recentEvents.length > 200) recentEvents.shift();
        if (record.type === 'micro_card_ready' && record.card?.targetUri) activeCards.set(record.card.targetUri, record.card);
        if (record.type === 'dock_item' && record.item) {
          const idx = dockItems.findIndex((x) => x.id === record.item.id);
          if (idx >= 0) dockItems[idx] = record.item;
          else dockItems.unshift(record.item);
          if (dockItems.length > 16) dockItems.pop();
        }
        for (const fn of listeners) { try { fn(record); } catch (err) { void err; } }
        return record;
      }
    });
  }
  return HUB_MAP.get(key);
}

export function preflightWorkflowPack(pack, opts = {}) {
  if (!pack || !Array.isArray(pack.nodes) || pack.nodes.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_WORKFLOW', reason: '工作流为空或缺少节点定义' };
  }
  const blankNode = pack.nodes.find((n) => (n.isBlank || n.tplId === 'tpl-blank') && !n.bypassed);
  if (blankNode) {
    return { ok: false, exitCode: 3, code: 'BLANK_NODE', nodeId: blankNode.id, reason: `节点「${blankNode.title || blankNode.id}」仍是空白待定节点，请先绑定积木或开启跳过` };
  }
  if (opts.enforceDeps !== false) {
    const depReport = inspectWorkflowDeps(opts.projectRoot || process.cwd(), pack);
    if (!depReport.ready) {
      const names = depReport.missing.slice(0, 4).map((x) => x.title || x.id).join('、');
      return {
        ok: false, exitCode: 3, code: 'MISSING_WORKFLOW_DEPS',
        nodeId: depReport.missing[0]?.nodeIds?.[0] || null,
        depsDir: depReport.depsDir, missingDeps: depReport.missing, agentPrompt: depReport.agentPrompt,
        reason: `开发流缺少 ${depReport.missingCount} 项开源/环境依赖（${names}），无法运行；请先点击开发流旁「补齐依赖」安装至 ${depReport.depsDir}`
      };
    }
  }
  return { ok: true, exitCode: 0 };
}

function collectGitDiffStats(cwd) {
  const r = spawnSync('git', ['-C', cwd, 'diff', '--numstat'], { encoding: 'utf8' });
  if (r.status !== 0) return { files: [], added: 0, removed: 0 };
  const files = [];
  let added = 0;
  let removed = 0;
  for (const line of normalizeLf(r.stdout).split('\n').filter(Boolean)) {
    const [a, d, f] = line.split('\t');
    if (!f) continue;
    files.push(normalizeSlashes(f.trim()));
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) removed += Number(d);
  }
  return { files, added, removed };
}

function checkWriteScopeMandate(files, allowedScopes) {
  if (!Array.isArray(allowedScopes) || allowedScopes.length === 0) return { ok: true, violated: [] };
  const cleanScopes = allowedScopes.map((s) => normalizeSlashes(s).replace(/^\.\//, ''));
  if (cleanScopes.includes('') || cleanScopes.includes('./')) return { ok: true, violated: [] };
  const violated = files.filter((f) => !cleanScopes.some((s) => (s.endsWith('/') ? f.startsWith(s) : (f === s || f.startsWith(s + '/')))));
  return { ok: violated.length === 0, violated };
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
    ? (() => { const c = { ...existingCp, state: AUTOPILOT_STATES.RUNNING, breaker: null }; delete c.briefMarkdown; delete c.checkpointFile; return saveAutopilotCheckpoint(root, c); })()
    : createInitialCheckpoint(root, runId, pack, ticket);

  const workCwd = ticket?.worktreePath ? resolve(root, ticket.worktreePath) : root;
  if (hooks.requireCleanGit === true) {
    const st = spawnSync('git', ['-C', workCwd, 'status', '--porcelain'], { encoding: 'utf8' });
    if (st.status !== 0 || st.stdout.trim() !== '') {
      tripAutopilotBreaker(root, cp, { code: 'DIRTY_WORKTREE_FAULT', nodeId: cp.cursorNodeId, reason: '挂机前检测到脏工作区或未提交文件，已触发安全隔离熔断' });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine } });
      return { ok: false, exitCode: 3, code: 'DIRTY_WORKTREE_FAULT', state: cp.state, reason: cp.breaker.reason, runId, checkpoint: cp };
    }
  }

  const wfEnv = buildWorkflowDepEnv(root, pack.id || 'default');
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
  let passedGates = Number(cp.passedGates || 0);
  let totalGates = Number(cp.totalGates || 0);
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
      cp.pendingHumanGate = {
        nodeId: current.id,
        title: current.title || current.id,
        prompt: current.tip || '该节点涉及架构定稿、破坏性变更或上线放量，需人工确认后继续。',
        suspendedAt: new Date().toISOString()
      };
      saveAutopilotCheckpoint(root, cp);
      logEvent({ type: 'human_gate_suspended', nodeId: current.id, title: current.title });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'question', tone: 'warn', title: cp.morningSummaryLine, targetNodeId: current.id, approveRunId: runId, approveNodeId: current.id } });
      return { ok: true, suspended: true, exitCode: 0, state: cp.state, runId, pendingHumanGate: cp.pendingHumanGate, checkpoint: cp };
    }

    const round = (loopCounters.get(current.id) || 0) + 1;
    logEvent({ type: 'node_enter', nodeId: current.id, title: current.title, round });

    const isRouter = current.tplId === 'tpl-router-rule' || current.exec?.kind === 'rule_router';
    const isAgent = current.exec?.kind === 'agent_step' || current.tplId === 'tpl-deai-polish' || current.tplId === 'tpl-prompt-gen';

    if (isRouter) {
      const slotNeeded = lastExitCode === 0 ? 'out_0' : (lastExitCode === 1 ? 'out_1' : 'out_3');
      const matchedLink = links.find((l) => l.fromNode === current.id && l.fromSlot === slotNeeded) || links.find((l) => l.fromNode === current.id);
      if (!matchedLink) break;
      if (matchedLink.maxLoops) {
        const used = (loopCounters.get(matchedLink.id) || 0) + 1;
        if (used > matchedLink.maxLoops) {
          lastExitCode = 1;
          cp.loopCounts = Object.fromEntries(loopCounters);
          tripAutopilotBreaker(root, cp, { code: 'MAX_LOOPS_EXCEEDED', nodeId: current.id, reason: `单判据连续回跳已达上限 (${matchedLink.maxLoops} 次) 仍未过关，自动熔断防空烧 Token` });
          logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine, targetNodeId: current.id } });
          return { ok: false, exitCode: 1, code: 'MAX_LOOPS_EXCEEDED', state: cp.state, runId, breaker: cp.breaker, checkpoint: cp };
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

    if (isHumanGateNode(current)) {
      logEvent({ type: 'human_gate_passed', nodeId: current.id, approvedBy: cp.approvedGates[current.id]?.by || '业主' });
      lastExitCode = 0;
    } else if (isAgent && typeof hooks.runAgentStep === 'function') {
      const res = await hooks.runAgentStep({ node: current, round, handoff: lastDiag.slice(0, 16384), ticket });
      lastDiag = String(res?.summary || '');
    } else if (!isAgent) {
      totalGates++;
      const args = Array.isArray(current.exec?.nodeArgs) ? current.exec.nodeArgs : [join(root, 'skill', 'check-module-integrity.mjs'), '--root', workCwd];
      const r = spawnSync(process.execPath, args, { cwd: workCwd, env: wfEnv, encoding: 'utf8', timeout: 120000 });
      lastExitCode = typeof r.status === 'number' ? r.status : 2;
      lastDiag = normalizeLf((r.stdout || '') + '\n' + (r.stderr || '')).trim();
      if (lastExitCode === 0) { passedGates++; cp.consecEnvFaults = 0; }
      else if (lastExitCode >= 2) {
        cp.consecEnvFaults = (cp.consecEnvFaults || 0) + 1;
        if (cp.consecEnvFaults >= maxEnvFaults) {
          cp.totalGates = totalGates; cp.passedGates = passedGates; cp.lastExitCode = lastExitCode;
          tripAutopilotBreaker(root, cp, { code: 'ENV_OR_PROTOCOL_FAULT', nodeId: current.id, reason: `节点「${current.title}」连续 ${cp.consecEnvFaults} 次报环境/协议异常 (exit ${lastExitCode})，已自动熔断停机` });
          logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine, targetNodeId: current.id } });
          return { ok: false, exitCode: lastExitCode, code: 'ENV_OR_PROTOCOL_FAULT', state: cp.state, runId, breaker: cp.breaker, checkpoint: cp };
        }
      }
      logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: lastExitCode, diagSummary: lastDiag.slice(0, 240) });
    }

    const stepDiff = collectGitDiffStats(workCwd);
    const stepScope = checkWriteScopeMandate(stepDiff.files, ticket?.mandate?.allowedWriteScopes || cp.ticket?.allowedWriteScopes);
    if (!stepScope.ok) {
      lastExitCode = 2;
      tripAutopilotBreaker(root, cp, { code: 'WRITE_SCOPE_VIOLATION', nodeId: current.id, reason: `越界修改了未授权范围文件：${stepScope.violated.join(', ')}` });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine, targetNodeId: current.id } });
      return { ok: false, exitCode: 2, code: 'WRITE_SCOPE_VIOLATION', state: cp.state, runId, breaker: cp.breaker, checkpoint: cp };
    }

    const selfLoop = lastExitCode !== 0 && links.find((l) => l.fromNode === current.id && l.toNode === current.id && l.maxLoops);
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
      tripAutopilotBreaker(root, cp, { code: 'MAX_LOOPS_EXCEEDED', nodeId: current.id, reason: `节点「${current.title}」自循环已达上限 (${selfLoop.maxLoops} 次) 仍未达标，自动熔断停机` });
      logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: cp.morningSummaryLine, targetNodeId: current.id } });
      return { ok: false, exitCode: lastExitCode, code: 'MAX_LOOPS_EXCEEDED', state: cp.state, runId, breaker: cp.breaker, checkpoint: cp };
    }

    cp.completedNodes.push({ nodeId: current.id, title: current.title || current.id, exitCode: lastExitCode, at: new Date().toISOString() });
    cp.lastExitCode = lastExitCode;
    cp.passedGates = passedGates;
    cp.totalGates = totalGates;
    cp.loopCounts = Object.fromEntries(loopCounters);

    const outLink = links.find((l) => l.fromNode === current.id && l.toNode !== current.id);
    if (outLink) logEvent({ type: 'edge_traverse', linkId: outLink.id });
    current = outLink ? nodesById.get(outLink.toNode) : null;
    cp.cursorNodeId = current ? current.id : null;
    saveAutopilotCheckpoint(root, cp);
  }

  const diff = collectGitDiffStats(workCwd);
  cp.state = AUTOPILOT_STATES.COMPLETED;
  cp.cursorNodeId = null;
  saveAutopilotCheckpoint(root, cp);

  const card = buildMicroVerdictCard({
    ticketId: runId, targetUri: ticket?.targetUri || null, exitCode: lastExitCode,
    headline: ticket?.headline || (lastExitCode === 0 ? `${pack.name}验证通过` : `${pack.name}未通过拦截`),
    passedGates, totalGates: Math.max(totalGates, 1),
    touchedFiles: diff.files, addedLines: diff.added, removedLines: diff.removed, canRollback: diff.files.length > 0
  });
  logEvent({ type: 'micro_card_ready', card });
  logEvent({ type: 'dock_item', item: { id: runId, kind: 'summary', tone: card.tone, title: `${card.headline} · ${card.gateBadge} · ${card.diffBadge}`, card } });
  const savedLog = existsSync(journalPath) ? readFileSync(journalPath, 'utf8').trim().split('\n').length : 0;
  return { ok: lastExitCode === 0, exitCode: lastExitCode, state: cp.state, runId, card, checkpoint: cp, eventCount: savedLog };
}
