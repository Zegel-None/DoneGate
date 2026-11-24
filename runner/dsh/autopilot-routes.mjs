// 过夜挂机 HTTP 子路由：承接单工作流挂机与项目看板多组件拓扑挂机（Campaign Autopilot）
import { approveAutopilotHumanGate, loadAutopilotCheckpoint, stopAutopilotRun } from './autopilot-state.mjs';
import {
  approveAndResumeCampaignAutopilot,
  executeProjectCampaignAutopilot,
  loadCampaignCheckpoint,
  stopCampaignAutopilot
} from './campaign-autopilot.mjs';
import { executeDeterministicWorkflowRun } from './workflow-runner.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

export async function handleAutopilotSubRoute(req, res, cleanPath, root, readJsonBody) {
  if (cleanPath === '/autopilot/status' && req.method === 'GET') {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const cp = loadAutopilotCheckpoint(root, u.searchParams.get('runId') || null);
    const campaign = loadCampaignCheckpoint(root, u.searchParams.get('campaignId') || null);
    sendJson(res, 200, { ok: true, autopilot: cp, campaign });
    return true;
  }

  if (cleanPath === '/autopilot/start' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const pack = body.pack || {};
    const ticket = {
      ticketId: body.runId || `night-${Date.now()}`,
      headline: body.headline || '',
      mandate: { allowedWriteScopes: Array.isArray(body.allowedWriteScopes) ? body.allowedWriteScopes : [] }
    };
    const out = await executeDeterministicWorkflowRun(root, ticket, pack, {
      resumeRunId: body.resumeRunId || null,
      requireCleanGit: body.requireCleanGit === true,
      useWorktreeSandbox: body.useWorktreeSandbox !== false,
      useFingerprintCache: body.useFingerprintCache !== false
    });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/autopilot/start-project' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = await executeProjectCampaignAutopilot(root, {
      campaignId: body.campaignId || null,
      resumeCampaignId: body.resumeCampaignId || null,
      nodes: Array.isArray(body.nodes) ? body.nodes : null,
      links: Array.isArray(body.links) ? body.links : [],
      componentWorkflows: body.componentWorkflows || null,
      useWorktreeSandbox: body.useWorktreeSandbox !== false,
      useFingerprintCache: body.useFingerprintCache !== false,
      enforceDeps: body.enforceDeps
    });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/autopilot/approve' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (body.campaignId) {
      const campOut = await approveAndResumeCampaignAutopilot(root, {
        campaignId: body.campaignId,
        nodeId: body.nodeId || null,
        by: body.by || '业主',
        note: body.note || '早间人工确认放行',
        useFingerprintCache: body.useFingerprintCache !== false
      });
      sendJson(res, campOut.ok === false && campOut.error ? 400 : 200, campOut);
      return true;
    }
    const app = approveAutopilotHumanGate(root, {
      runId: body.runId || null,
      nodeId: body.nodeId || null,
      by: body.by || '业主',
      note: body.note || '早间人工确认放行'
    });
    if (!app.ok) { sendJson(res, 400, app); return true; }
    if (body.pack && Array.isArray(body.pack.nodes)) {
      const resumed = await executeDeterministicWorkflowRun(root, app.checkpoint.ticket || {}, body.pack, {
        resumeRunId: app.runId,
        useFingerprintCache: body.useFingerprintCache !== false
      });
      sendJson(res, 200, resumed);
      return true;
    }
    sendJson(res, 200, app);
    return true;
  }

  if (cleanPath === '/autopilot/stop' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const singleOut = stopAutopilotRun(root, { runId: body.runId || null, by: body.by || '业主', note: body.note });
    const campOut = stopCampaignAutopilot(root, { campaignId: body.campaignId || null, by: body.by || '业主', note: body.note });
    sendJson(res, 200, { ok: true, stopped: true, autopilot: singleOut.checkpoint, campaign: campOut.campaign });
    return true;
  }

  return false;
}
