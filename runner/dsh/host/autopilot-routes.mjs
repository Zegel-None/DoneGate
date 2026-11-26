// 过夜挂机 HTTP 子路由：承接单工作流挂机与项目看板多组件拓扑挂机（Campaign Autopilot）
import { resolve } from 'node:path';
import { buildDashboardPayload } from '../../atlas/dashboard.mjs';
import { approveAutopilotHumanGate, loadAutopilotCheckpoint, stopAutopilotRun } from '../autopilot/index.mjs';
import {
  approveAndResumeCampaignAutopilot,
  executeProjectCampaignAutopilot,
  loadCampaignCheckpoint,
  stopCampaignAutopilot
} from '../autopilot/campaign-autopilot.mjs';
import { hagSanitizeHttpWorkflowPack, hagSanitizeId } from './host-auth-guard.mjs';
import { normalizeWinDriveKey } from '../deps/index.mjs';
import { executeDeterministicWorkflowRun } from '../autopilot/index.mjs';

const ACTIVE_AUTOPILOT_ROOTS = new Set();

function apAcquireLock(root, res) {
  const key = normalizeWinDriveKey(resolve(root));
  if (ACTIVE_AUTOPILOT_ROOTS.has(key)) {
    sendJson(res, 409, { ok: false, code: 'AUTOPILOT_ALREADY_RUNNING', reason: '当前工作区已有正在执行的挂机任务，请等待完成或先手动停止' });
    return null;
  }
  ACTIVE_AUTOPILOT_ROOTS.add(key);
  return key;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function apSanitizeCampaignNode(n) {
  if (!n || typeof n !== 'object') return n;
  if (!n.execution || typeof n.execution !== 'object') return n;
  const { preFlightPlug: _dropPlug, ...safeExec } = n.execution;
  void _dropPlug;
  return { ...n, execution: safeExec };
}

function apSanitizeCampaignNodes(nodes) {
  if (!Array.isArray(nodes)) return null;
  return nodes.map(apSanitizeCampaignNode);
}

function apSanitizeComponentWorkflows(componentWorkflows) {
  if (!componentWorkflows || typeof componentWorkflows !== 'object') return null;
  return Object.fromEntries(
    Object.entries(componentWorkflows).map(([k, v]) => [
      k,
      v && v.pack ? { ...v, pack: hagSanitizeHttpWorkflowPack(v.pack) } : v
    ])
  );
}

function apHandleStatusRoute(req, res, root) {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const cp = loadAutopilotCheckpoint(root, u.searchParams.get('runId') || null);
  const campaign = loadCampaignCheckpoint(root, u.searchParams.get('campaignId') || null);
  sendJson(res, 200, { ok: true, autopilot: cp, campaign });
  return true;
}

async function apHandleStartRoute(req, res, root, readJsonBody) {
  const body = await readJsonBody(req);
  const lockKey = apAcquireLock(root, res);
  if (!lockKey) return true;
  try {
    const pack = hagSanitizeHttpWorkflowPack(body.pack || {});
    const ticket = {
      ticketId: hagSanitizeId(body.runId, `night-${Date.now()}`),
      headline: body.headline || '',
      mandate: { allowedWriteScopes: Array.isArray(body.allowedWriteScopes) ? body.allowedWriteScopes : [] }
    };
    const out = await executeDeterministicWorkflowRun(root, ticket, pack, {
      resumeRunId: body.resumeRunId ? hagSanitizeId(body.resumeRunId, '') : null,
      requireCleanGit: body.requireCleanGit === true,
      useWorktreeSandbox: body.useWorktreeSandbox !== false,
      useFingerprintCache: body.useFingerprintCache !== false
    });
    sendJson(res, 200, out);
    return true;
  } finally {
    ACTIVE_AUTOPILOT_ROOTS.delete(lockKey);
  }
}

async function apHandleStartProjectRoute(req, res, root, readJsonBody) {
  const body = await readJsonBody(req);
  const lockKey = apAcquireLock(root, res);
  if (!lockKey) return true;
  try {
    const safeNodes = apSanitizeCampaignNodes(body.nodes);
    const safeCompWfs = apSanitizeComponentWorkflows(body.componentWorkflows);
    const out = await executeProjectCampaignAutopilot(root, {
      campaignId: body.campaignId ? hagSanitizeId(body.campaignId, `camp-${Date.now()}`) : null,
      resumeCampaignId: body.resumeCampaignId ? hagSanitizeId(body.resumeCampaignId, '') : null,
      nodes: safeNodes,
      links: Array.isArray(body.links) ? body.links : [],
      componentWorkflows: safeCompWfs,
      hasSharedExternalState: body.hasSharedExternalState === true,
      useWorktreeSandbox: body.useWorktreeSandbox !== false,
      useFingerprintCache: body.useFingerprintCache !== false,
      enforceDeps: body.enforceDeps
    }, {
      resolveAtlasNodes: (r) => buildDashboardPayload(r)?.workbench?.hostSandbox?.nodes || []
    });
    sendJson(res, 200, out);
    return true;
  } finally {
    ACTIVE_AUTOPILOT_ROOTS.delete(lockKey);
  }
}

async function apHandleApproveSingle(root, res, body) {
  const app = approveAutopilotHumanGate(root, {
    runId: body.runId || null,
    nodeId: body.nodeId || null,
    by: body.by || '业主',
    note: body.note || '早间人工确认放行'
  });
  if (!app.ok) {
    sendJson(res, 400, app);
    return true;
  }
  if (body.pack && Array.isArray(body.pack.nodes)) {
    const resumed = await executeDeterministicWorkflowRun(root, app.checkpoint.ticket || {}, hagSanitizeHttpWorkflowPack(body.pack), {
      resumeRunId: app.runId,
      useFingerprintCache: body.useFingerprintCache !== false
    });
    sendJson(res, 200, resumed);
    return true;
  }
  sendJson(res, 200, app);
  return true;
}

async function apHandleApproveRoute(req, res, root, readJsonBody) {
  const body = await readJsonBody(req);
  const lockKey = apAcquireLock(root, res);
  if (!lockKey) return true;
  try {
    if (body.campaignId) {
      const campOut = await approveAndResumeCampaignAutopilot(root, {
        campaignId: body.campaignId,
        nodeId: body.nodeId || null,
        by: body.by || '业主',
        note: body.note || '早间人工确认放行',
        useFingerprintCache: body.useFingerprintCache !== false
      });
      const status = campOut.ok === false && campOut.error ? 400 : 200;
      sendJson(res, status, campOut);
      return true;
    }
    return await apHandleApproveSingle(root, res, body);
  } finally {
    ACTIVE_AUTOPILOT_ROOTS.delete(lockKey);
  }
}

async function apHandleStopRoute(req, res, root, readJsonBody) {
  const body = await readJsonBody(req);
  const singleOut = stopAutopilotRun(root, { runId: body.runId || null, by: body.by || '业主', note: body.note });
  const campOut = stopCampaignAutopilot(root, { campaignId: body.campaignId || null, by: body.by || '业主', note: body.note });
  sendJson(res, 200, { ok: true, stopped: true, autopilot: singleOut.checkpoint, campaign: campOut.campaign });
  return true;
}

export async function handleAutopilotSubRoute(req, res, cleanPath, root, readJsonBody) {
  if (cleanPath === '/autopilot/status' && req.method === 'GET') {
    return apHandleStatusRoute(req, res, root);
  }
  if (req.method !== 'POST') return false;
  if (cleanPath === '/autopilot/start') {
    return apHandleStartRoute(req, res, root, readJsonBody);
  }
  if (cleanPath === '/autopilot/start-project') {
    return apHandleStartProjectRoute(req, res, root, readJsonBody);
  }
  if (cleanPath === '/autopilot/approve') {
    return apHandleApproveRoute(req, res, root, readJsonBody);
  }
  if (cleanPath === '/autopilot/stop') {
    return apHandleStopRoute(req, res, root, readJsonBody);
  }
  return false;
}
