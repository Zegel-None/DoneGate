// 无数据库挂机工作树与进程存活对账器及纯函数会话状态投影（继承 governance-autopilot 归属，<= 215 行）
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { cleanGitEnv } from './autopilot-worktree.mjs';

export const SESSION_PHASES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  SUSPENDED: 'suspended',
  FAILED: 'failed',
  COMPLETED: 'completed'
});

const SIGNAL_PROBE_ALIVE = 0;
const MIN_RETRY_ROUND = 2;
const LOCK_NAME_RE = /(?:^|[._-])(?:lock|lease)(?:\.json|\.pid)?$/i;
const ACTIVE_STATES = new Set(['RUNNING', 'PREFLIGHT']);

export function isPidAlive(pid, killProbe = process.kill) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) return false;
  try {
    killProbe(numPid, SIGNAL_PROBE_ALIVE);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function srUpdateBestGates(acc, candidate) {
  const num = Number(candidate);
  if (Number.isFinite(num) && num > acc.bestPassedGates) acc.bestPassedGates = num;
}

function srHandleSettledEvent(acc, evt) {
  const nodeId = String(evt.nodeId || evt.componentId || '').trim();
  const passed = evt.ok === true || evt.exitCode === 0 || evt.state === 'pass' || evt.state === 'cached';
  if (nodeId) {
    acc[passed ? 'completedSet' : 'failedSet'].add(nodeId);
    acc[passed ? 'failedSet' : 'completedSet'].delete(nodeId);
  }
  srUpdateBestGates(acc, evt.bestPassedGates ?? evt.passedGates ?? acc.completedSet.size);
}

const SESSION_EVENT_HANDLERS = {
  campaign_started: (acc) => { acc.phase = SESSION_PHASES.RUNNING; },
  session_started: (acc) => { acc.phase = SESSION_PHASES.RUNNING; },
  preflight: (acc) => { acc.phase = SESSION_PHASES.RUNNING; },
  node_enter: (acc, evt) => {
    acc.phase = SESSION_PHASES.RUNNING;
    if (Number(evt.round ?? evt.attempt ?? 1) >= MIN_RETRY_ROUND || evt.isRetry === true) acc.retryCount += 1;
  },
  component_started: (acc, evt) => SESSION_EVENT_HANDLERS.node_enter(acc, evt),
  retry: (acc, evt) => { acc.retryCount += 1; srUpdateBestGates(acc, evt.bestPassedGates); },
  attempt_retry: (acc, evt) => SESSION_EVENT_HANDLERS.retry(acc, evt),
  ratchet_rollback: (acc, evt) => SESSION_EVENT_HANDLERS.retry(acc, evt),
  gate_settled: srHandleSettledEvent,
  node_completed: srHandleSettledEvent,
  component_settled: srHandleSettledEvent,
  ratchet_updated: (acc, evt) => srUpdateBestGates(acc, evt.bestPassedGates),
  micro_card_ready: (acc, evt) => srUpdateBestGates(acc, evt.bestPassedGates ?? evt.card?.passedGates),
  human_gate_suspended: (acc) => { acc.phase = SESSION_PHASES.SUSPENDED; acc.activePid = null; },
  campaign_suspended: (acc) => { acc.phase = SESSION_PHASES.SUSPENDED; acc.activePid = null; },
  campaign_aborted: (acc, evt) => SESSION_EVENT_HANDLERS.campaign_failed(acc, evt),
  breaker_tripped: (acc, evt) => SESSION_EVENT_HANDLERS.campaign_failed(acc, evt),
  campaign_failed: (acc, evt) => {
    acc.phase = SESSION_PHASES.FAILED;
    acc.activePid = null;
    const failedId = String(evt.failedComponentId || evt.nodeId || '').trim();
    if (failedId) acc.failedSet.add(failedId);
  },
  campaign_completed: (acc, evt) => {
    acc.phase = SESSION_PHASES.COMPLETED;
    acc.activePid = null;
    srUpdateBestGates(acc, evt.passedGates ?? acc.completedSet.size);
  },
  session_completed: (acc, evt) => SESSION_EVENT_HANDLERS.campaign_completed(acc, evt),
  dock_item: (acc, evt) => {
    if (evt.item?.kind === 'summary' && evt.item?.tone === 'ok') {
      acc.phase = SESSION_PHASES.COMPLETED;
      acc.activePid = null;
      srUpdateBestGates(acc, evt.item?.card?.passedGates ?? acc.completedSet.size);
    }
  },
  process_exited: (acc) => { acc.activePid = null; },
  pid_cleared: (acc) => { acc.activePid = null; }
};

function srFoldSingleEvent(acc, evt) {
  if (!evt || typeof evt !== 'object') return acc;
  const rawPid = Number(evt.activePid ?? evt.pid);
  if (Number.isInteger(rawPid) && rawPid > 0) acc.activePid = rawPid;
  const handler = SESSION_EVENT_HANDLERS[String(evt.type || '')];
  if (handler) handler(acc, evt);
  return acc;
}

export function projectCampaignSessionState(events = []) {
  const list = Array.isArray(events) ? events : [];
  const acc = list.reduce(srFoldSingleEvent, {
    phase: SESSION_PHASES.IDLE, completedSet: new Set(), failedSet: new Set(),
    activePid: null, retryCount: 0, bestPassedGates: 0
  });
  return {
    phase: acc.phase, completedNodeIds: [...acc.completedSet], failedNodeIds: [...acc.failedSet],
    activePid: acc.activePid, retryCount: acc.retryCount, bestPassedGates: acc.bestPassedGates
  };
}

const srRecordPid = (obj) => obj?.pid ?? obj?.activePid ?? obj?.ownerPid ?? obj?.leasePid ?? null;
function srSafeUnlink(absPath, relLabel, cleanedLocks) {
  try { unlinkSync(absPath); cleanedLocks.push(relLabel); } catch (err) { void err; }
}

function srSweepDirLocks(dirAbs, relPrefix, isAliveFn, ctx) {
  if (!existsSync(dirAbs)) return;
  for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
    if (!ent.isFile() || !LOCK_NAME_RE.test(ent.name)) continue;
    const lockAbs = join(dirAbs, ent.name);
    const parsed = readJsonStrict(lockAbs);
    const pid = parsed.ok ? srRecordPid(parsed.value) : null;
    if (pid !== null && isAliveFn(pid)) { ctx.livePids.add(Number(pid)); continue; }
    srSafeUnlink(lockAbs, `${relPrefix}/${ent.name}`, ctx.cleanedLocks);
  }
}

function srReconcileRunDir(runDirAbs, runName, isAliveFn, ctx) {
  srSweepDirLocks(runDirAbs, `.donegate/runs/${runName}`, isAliveFn, ctx);
  const cpPath = join(runDirAbs, 'checkpoint.json');
  const cpRes = existsSync(cpPath) ? readJsonStrict(cpPath) : { ok: false };
  if (!cpRes.ok || !cpRes.value || typeof cpRes.value !== 'object') return;
  const cp = cpRes.value, pid = srRecordPid(cp);
  if (pid !== null && isAliveFn(pid)) {
    ctx.livePids.add(Number(pid));
    ctx.activeRuns.push({ runId: cp.runId || runName, pid: Number(pid), state: cp.state });
    return;
  }
  const doneIds = (Array.isArray(cp.completedNodes) ? cp.completedNodes : []).map((n) => (typeof n === 'string' ? n : n?.nodeId)).filter(Boolean);
  for (const id of doneIds) ctx.recoveredNodeIds.add(id);
  if (!ACTIVE_STATES.has(cp.state)) return;
  const healed = { ...cp, state: 'STOPPED', reconciledAt: new Date().toISOString(), reconciledDeadPid: pid !== null ? Number(pid) : null };
  delete healed.activePid;
  writeFileSync(cpPath, JSON.stringify(healed, null, 2) + '\n', 'utf8');
  ctx.reconciledRuns.push({ runId: cp.runId || runName, deadPid: healed.reconciledDeadPid, completedNodeIds: doneIds });
}

function srReconcileRunsRoot(rootAbs, isAliveFn, ctx) {
  const runsRoot = join(rootAbs, '.donegate', 'runs');
  if (!existsSync(runsRoot)) return;
  srSweepDirLocks(runsRoot, '.donegate/runs', isAliveFn, ctx);
  for (const ent of readdirSync(runsRoot, { withFileTypes: true })) {
    if (ent.isDirectory()) srReconcileRunDir(join(runsRoot, ent.name), ent.name, isAliveFn, ctx);
  }
  const ptrPath = join(runsRoot, 'active-autopilot.json');
  const ptr = existsSync(ptrPath) ? readJsonStrict(ptrPath) : { ok: false };
  if (ptr.ok && ptr.value && ACTIVE_STATES.has(ptr.value.state) && !isAliveFn(srRecordPid(ptr.value))) {
    writeFileSync(ptrPath, JSON.stringify({ ...ptr.value, state: 'STOPPED', activePid: null, reconciledAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  }
}

function srReconcileCampaignState(rootAbs, targetCampaignId, isAliveFn, ctx) {
  const autoDir = join(rootAbs, '.donegate', 'autopilot');
  if (!existsSync(autoDir)) return null;
  srSweepDirLocks(autoDir, '.donegate/autopilot', isAliveFn, ctx);
  const targetPath = join(autoDir, targetCampaignId ? `campaign-${targetCampaignId}.json` : 'campaign-latest.json');
  const res = existsSync(targetPath) ? readJsonStrict(targetPath) : { ok: false };
  if (!res.ok || !res.value) return null;
  const camp = res.value, pid = srRecordPid(camp);
  if (pid !== null && isAliveFn(pid)) { ctx.livePids.add(Number(pid)); return null; }
  const doneIds = Array.isArray(camp.completedComponentIds) ? camp.completedComponentIds.filter(Boolean) : [];
  for (const id of doneIds) ctx.recoveredComponentIds.add(id);
  if (!ACTIVE_STATES.has(camp.state)) return camp.state !== 'COMPLETED' && doneIds.length > 0 ? camp : null;
  const healed = { ...camp, state: 'STOPPED', activePid: null, reconciledDeadPid: pid !== null ? Number(pid) : null, reconciledAt: new Date().toISOString() };
  writeFileSync(targetPath, JSON.stringify(healed, null, 2) + '\n', 'utf8');
  return healed;
}

function srReconcileWorktrees(rootAbs, hasLive, cleanedLocks) {
  const wtRoot = join(rootAbs, '.donegate', 'worktrees');
  if (!existsSync(wtRoot)) return [];
  const preserved = [];
  for (const ent of readdirSync(wtRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    preserved.push(`.donegate/worktrees/${ent.name}`);
    const idxLock = join(wtRoot, ent.name, '.git', 'index.lock');
    if (!hasLive && existsSync(idxLock)) srSafeUnlink(idxLock, `.donegate/worktrees/${ent.name}/.git/index.lock`, cleanedLocks);
  }
  spawnSync('git', ['-C', rootAbs, 'worktree', 'prune'], { encoding: 'utf8', env: cleanGitEnv(), windowsHide: true });
  return preserved;
}

export function reconcileAutopilotWorktreesAndPids(projectRoot, opts = {}) {
  const rootAbs = resolve(projectRoot), probe = typeof opts.killProbe === 'function' ? opts.killProbe : process.kill;
  const selfPid = Number(opts.selfPid ?? process.pid);
  const isAliveFn = (pid) => (opts.ignoreSelfPid !== false && Number(pid) === selfPid ? false : isPidAlive(pid, probe));
  const ctx = { cleanedLocks: [], reconciledRuns: [], activeRuns: [], livePids: new Set(), recoveredNodeIds: new Set(), recoveredComponentIds: new Set() };
  srReconcileRunsRoot(rootAbs, isAliveFn, ctx);
  const adoptableCampaign = srReconcileCampaignState(rootAbs, opts.campaignId || null, isAliveFn, ctx);
  const preservedWorktrees = srReconcileWorktrees(rootAbs, ctx.livePids.size > 0, ctx.cleanedLocks);
  return {
    ok: true, cleanedLocks: ctx.cleanedLocks, reconciledRuns: ctx.reconciledRuns, activeRuns: ctx.activeRuns,
    livePids: [...ctx.livePids], recoveredNodeIds: [...ctx.recoveredNodeIds],
    recoveredCompletedComponentIds: [...ctx.recoveredComponentIds], adoptableCampaign, preservedWorktrees
  };
}
