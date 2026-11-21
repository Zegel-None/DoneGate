// 完结门开发流确定性运行引擎与脉冲事件总线（对齐 DSH workflow/ralph 与完结门 INV-01/INV-10，<= 200 行）
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildMicroVerdictCard } from './quote-protocol.mjs';
import { normalizeLf, normalizeSlashes } from './win-paths.mjs';

const HUB_MAP = new Map();

export function getRunEventHub(projectRoot) {
  const key = normalizeSlashes(resolve(projectRoot));
  if (!HUB_MAP.has(key)) {
    const listeners = new Set();
    const recentEvents = [];
    const activeCards = new Map();
    const dockItems = [];
    HUB_MAP.set(key, {
      listeners,
      recentEvents,
      activeCards,
      dockItems,
      emit(evt) {
        const record = { seq: recentEvents.length + 1, ts: Date.now(), ...evt };
        recentEvents.push(record);
        if (recentEvents.length > 200) recentEvents.shift();
        if (record.type === 'micro_card_ready' && record.card?.targetUri) {
          activeCards.set(record.card.targetUri, record.card);
        }
        if (record.type === 'dock_item' && record.item) {
          const idx = dockItems.findIndex((x) => x.id === record.item.id);
          if (idx >= 0) dockItems[idx] = record.item;
          else dockItems.unshift(record.item);
          if (dockItems.length > 16) dockItems.pop();
        }
        for (const fn of listeners) {
          try { fn(record); } catch (err) { void err; }
        }
        return record;
      }
    });
  }
  return HUB_MAP.get(key);
}

export function preflightWorkflowPack(pack) {
  if (!pack || !Array.isArray(pack.nodes) || pack.nodes.length === 0) {
    return { ok: false, exitCode: 3, reason: '工作流为空或缺少节点定义' };
  }
  const blankNode = pack.nodes.find((n) => (n.isBlank || n.tplId === 'tpl-blank') && !n.bypassed);
  if (blankNode) {
    return {
      ok: false,
      exitCode: 3,
      nodeId: blankNode.id,
      reason: `节点「${blankNode.title || blankNode.id}」仍是空白待定节点，请先绑定积木或开启跳过`
    };
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
  const runId = String(ticket?.ticketId || `run-${Date.now()}`);
  const runDir = join(root, '.donegate', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const journalPath = join(runDir, 'events.jsonl');
  writeFileSync(join(runDir, 'ticket.json'), JSON.stringify(ticket || {}, null, 2) + '\n', 'utf8');

  const logEvent = (payload) => {
    const rec = hub.emit({ runId, ...payload });
    appendFileSync(journalPath, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  };

  const pre = preflightWorkflowPack(pack);
  if (!pre.ok) {
    logEvent({ type: 'dock_item', item: { id: runId, kind: 'question', tone: 'warn', title: pre.reason, targetNodeId: pre.nodeId || null } });
    return { ok: false, exitCode: pre.exitCode, reason: pre.reason, runId };
  }

  const nodesById = new Map(pack.nodes.map((n) => [n.id, n]));
  const links = Array.isArray(pack.links) ? pack.links : [];
  const incomingCount = new Map(pack.nodes.map((n) => [n.id, 0]));
  for (const lk of links) {
    if (lk.fromNode !== lk.toNode && incomingCount.has(lk.toNode)) {
      incomingCount.set(lk.toNode, incomingCount.get(lk.toNode) + 1);
    }
  }

  let current = pack.nodes.find((n) => (incomingCount.get(n.id) || 0) === 0) || pack.nodes[0];
  const loopCounters = new Map();
  let lastExitCode = 0;
  let lastDiag = '';
  let passedGates = 0;
  let totalGates = 0;
  let stepGuard = 0;

  while (current && stepGuard < 24) {
    stepGuard++;
    if (current.bypassed) {
      logEvent({ type: 'node_bypassed', nodeId: current.id });
      const nextLink = links.find((l) => l.fromNode === current.id);
      current = nextLink ? nodesById.get(nextLink.toNode) : null;
      continue;
    }

    const round = (loopCounters.get(current.id) || 0) + 1;
    logEvent({ type: 'node_enter', nodeId: current.id, title: current.title, round });

    const isRouter = current.tplId === 'tpl-router-rule' || current.exec?.kind === 'rule_router';
    const isAgent = current.exec?.kind === 'agent_step' || current.tplId === 'tpl-deai-polish' || current.tplId === 'tpl-prompt-gen';

    if (isRouter) {
      const slotNeeded = lastExitCode === 0 ? 'out_0' : (lastExitCode === 1 ? 'out_1' : 'out_3');
      const matchedLink = links.find((l) => l.fromNode === current.id && l.fromSlot === slotNeeded) ||
        links.find((l) => l.fromNode === current.id);
      if (!matchedLink) break;
      if (matchedLink.maxLoops) {
        const used = (loopCounters.get(matchedLink.id) || 0) + 1;
        if (used > matchedLink.maxLoops) {
          lastExitCode = 1;
          logEvent({ type: 'dock_item', item: { id: runId, kind: 'blocked', tone: 'bad', title: `循环已达上限 (${matchedLink.maxLoops} 次) 仍未过关，请人工裁决`, targetNodeId: current.id } });
          break;
        }
        loopCounters.set(matchedLink.id, used);
        logEvent({ type: 'loop_back', linkId: matchedLink.id, loopCount: used, maxLoops: matchedLink.maxLoops, mode: 'fresh_ralph', handoff: lastDiag.slice(0, 16384) });
      } else {
        logEvent({ type: 'edge_traverse', linkId: matchedLink.id });
      }
      current = nodesById.get(matchedLink.toNode);
      continue;
    }

    if (isAgent && typeof hooks.runAgentStep === 'function') {
      const res = await hooks.runAgentStep({ node: current, round, handoff: lastDiag.slice(0, 16384), ticket });
      lastDiag = String(res?.summary || '');
    } else if (!isAgent) {
      totalGates++;
      const workCwd = ticket?.worktreePath ? resolve(root, ticket.worktreePath) : root;
      const args = Array.isArray(current.exec?.nodeArgs)
        ? current.exec.nodeArgs
        : [join(root, 'skill', 'check-module-integrity.mjs'), '--root', workCwd];
      const r = spawnSync(process.execPath, args, { cwd: workCwd, encoding: 'utf8', timeout: 120000 });
      lastExitCode = typeof r.status === 'number' ? r.status : 2;
      lastDiag = normalizeLf((r.stdout || '') + '\n' + (r.stderr || '')).trim();
      if (lastExitCode === 0) passedGates++;
      logEvent({ type: 'gate_settled', nodeId: current.id, exitCode: lastExitCode, diagSummary: lastDiag.slice(0, 240) });
    }

    const selfLoop = lastExitCode !== 0 && links.find((l) => l.fromNode === current.id && l.toNode === current.id && l.maxLoops);
    if (selfLoop) {
      const used = (loopCounters.get(selfLoop.id) || 0) + 1;
      if (used <= selfLoop.maxLoops) {
        loopCounters.set(selfLoop.id, used);
        logEvent({ type: 'loop_back', linkId: selfLoop.id, loopCount: used, maxLoops: selfLoop.maxLoops, mode: 'fresh_ralph' });
        continue;
      }
    }

    const outLink = links.find((l) => l.fromNode === current.id && l.toNode !== current.id);
    if (outLink) logEvent({ type: 'edge_traverse', linkId: outLink.id });
    current = outLink ? nodesById.get(outLink.toNode) : null;
  }

  const workCwd = ticket?.worktreePath ? resolve(root, ticket.worktreePath) : root;
  const diff = collectGitDiffStats(workCwd);
  const scopeCheck = checkWriteScopeMandate(diff.files, ticket?.mandate?.allowedWriteScopes);
  if (!scopeCheck.ok) {
    lastExitCode = 2;
    lastDiag = `越界修改了未授权文件：${scopeCheck.violated.join(', ')}`;
  }

  const card = buildMicroVerdictCard({
    ticketId: runId,
    targetUri: ticket?.targetUri || null,
    exitCode: lastExitCode,
    headline: ticket?.headline || (lastExitCode === 0 ? `${pack.name}验证通过` : `${pack.name}未通过拦截`),
    passedGates,
    totalGates: Math.max(totalGates, 1),
    touchedFiles: diff.files,
    addedLines: diff.added,
    removedLines: diff.removed,
    canRollback: diff.files.length > 0
  });
  logEvent({ type: 'micro_card_ready', card });
  logEvent({ type: 'dock_item', item: { id: runId, kind: 'summary', tone: card.tone, title: `${card.headline} · ${card.gateBadge} · ${card.diffBadge}`, card } });
  const savedLog = existsSync(journalPath) ? readFileSync(journalPath, 'utf8').trim().split('\n').length : 0;
  return { ok: lastExitCode === 0, exitCode: lastExitCode, runId, card, eventCount: savedLog };
}
