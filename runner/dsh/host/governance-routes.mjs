// 默认治理工作流同源 HTTP 子路由（/donegate/api/governance/*：极简开关清单、参数微调、AI 提案对比确认与一键还原）
import { sendJson } from './http-utils.mjs';
import {
  GOVERNANCE_SEAM_CATALOG,
  wfcCompileWorkflow,
  wfcConfirmProposal,
  wfcCreateProposal,
  wfcResetProjectOverlay,
  wfcSaveProjectOverlay
} from '../autopilot/workflow-compiler.mjs';
import { buildGovernanceSummaryPayload } from '../autopilot/index.mjs';
import { cmdGovernanceFlow } from '../autopilot/index.mjs';
import { tlComputeRestrainedSuggestions, tlDismissSuggestion } from '../autopilot/index.mjs';
import { gtApplyPersonalTemplate, gtListPersonalTemplates, gtSavePersonalTemplate } from '../autopilot/index.mjs';

export { buildGovernanceSummaryPayload };

function govrResolveActorRole(req, body) {
  const hdr = req.headers && (req.headers['x-donegate-role'] || req.headers['X-DoneGate-Role']);
  return String(hdr || body?.actorRole || 'human').trim();
}

function govrHandleGetRoutes(req, res, cleanPath, root) {
  if (cleanPath === '/governance/summary' && req.method === 'GET') {
    sendJson(res, 200, buildGovernanceSummaryPayload(root));
    return true;
  }
  if (cleanPath === '/governance/flow' && req.method === 'GET') {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const flowId = u.searchParams.get('id') || u.searchParams.get('flowId') || '';
    const comp = wfcCompileWorkflow(root, flowId);
    if (!comp.ok) {
      sendJson(res, 404, comp);
      return true;
    }
    sendJson(res, 200, { ...comp, seamCatalog: GOVERNANCE_SEAM_CATALOG });
    return true;
  }
  if (cleanPath === '/governance/trust-suggestions' && req.method === 'GET') {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const modelId = u.searchParams.get('modelId') || undefined;
    sendJson(res, 200, tlComputeRestrainedSuggestions(root, { modelId }));
    return true;
  }
  if (cleanPath === '/governance/templates' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, templates: gtListPersonalTemplates() });
    return true;
  }
  return false;
}

async function govrHandleOverlayRoute(req, res, root, hub, readJsonBody) {
  const body = await readJsonBody(req);
  const actorRole = govrResolveActorRole(req, body);
  const out = wfcSaveProjectOverlay(root, body.flowId, body.patch || body, {
    actorRole,
    confirmedByHuman: body.confirmedByHuman === true
  });
  if (!out.ok) {
    sendJson(res, out.exitCode === 2 ? 403 : 400, out);
    return true;
  }
  const tone = out.disabledIntegrityRules.length > 0 ? 'bad' : 'ok';
  const title = out.disclosureBanner || `⚙ 已更新默认治理流「${out.effectivePack.name}」（${out.overrideDiff.length} 项微调生效）`;
  hub.emit({ type: 'governance_updated', flowId: out.flowId, workflowHash: out.workflowHash, summary: buildGovernanceSummaryPayload(root) });
  hub.emit({ type: 'dock_item', item: { id: `gov-${Date.now()}`, kind: 'summary', tone, title } });
  sendJson(res, 200, { ...out, summary: buildGovernanceSummaryPayload(root) });
  return true;
}

async function govrHandleProposeRoute(req, res, root, hub, readJsonBody) {
  const body = await readJsonBody(req);
  const out = wfcCreateProposal(root, body.flowId, body.patch || {}, {
    proposedBy: body.proposedBy || govrResolveActorRole(req, body),
    summary: body.summary
  });
  if (!out.ok) {
    sendJson(res, 400, out);
    return true;
  }
  hub.emit({ type: 'governance_proposal_ready', proposal: out.proposal });
  hub.emit({
    type: 'dock_item',
    item: {
      id: `govp-${Date.now()}`,
      kind: 'question',
      tone: out.proposal.willDisableIntegrity.length > 0 ? 'bad' : 'warn',
      title: `📝 AI 提议微调治理流「${out.proposal.flowName}」：${out.proposal.summary}（待你点【确认生效】）`
    }
  });
  sendJson(res, 200, out);
  return true;
}

async function govrHandleConfirmRoute(req, res, root, hub, readJsonBody) {
  const body = await readJsonBody(req);
  const out = wfcConfirmProposal(root, body.proposalId, {
    actorRole: govrResolveActorRole(req, body),
    confirmedByHuman: body.confirmedByHuman === true
  });
  if (!out.ok) {
    sendJson(res, out.exitCode === 2 ? 403 : 400, out);
    return true;
  }
  hub.emit({ type: 'governance_updated', flowId: out.flowId, workflowHash: out.workflowHash, summary: buildGovernanceSummaryPayload(root) });
  sendJson(res, 200, { ...out, summary: buildGovernanceSummaryPayload(root) });
  return true;
}

async function govrHandleResetRoute(req, res, root, hub, readJsonBody) {
  const body = await readJsonBody(req);
  const out = wfcResetProjectOverlay(root, body.flowId, {
    actorRole: govrResolveActorRole(req, body),
    confirmedByHuman: body.confirmedByHuman === true
  });
  if (!out.ok) {
    sendJson(res, out.exitCode === 2 ? 403 : 400, out);
    return true;
  }
  hub.emit({ type: 'governance_updated', flowId: out.flowId, workflowHash: out.workflowHash, summary: buildGovernanceSummaryPayload(root) });
  sendJson(res, 200, { ...out, summary: buildGovernanceSummaryPayload(root) });
  return true;
}

async function govrHandleRunRoute(req, res, root, _hub, readJsonBody) {
  const body = await readJsonBody(req);
  const runRes = cmdGovernanceFlow(root, ['run', String(body.flowId || ''), ...(body.staged ? ['--staged'] : []), '--json']);
  sendJson(res, 200, runRes);
  return true;
}

async function govrHandleTrustDismissRoute(req, res, root, _hub, readJsonBody) {
  const body = await readJsonBody(req);
  sendJson(res, 200, tlDismissSuggestion(root, body));
  return true;
}

async function govrHandleTemplateSaveRoute(req, res, root, _hub, readJsonBody) {
  const body = await readJsonBody(req);
  const saved = gtSavePersonalTemplate(root, body.name, {
    actorRole: govrResolveActorRole(req, body),
    description: body.description
  });
  if (!saved.ok) {
    sendJson(res, saved.exitCode === 2 ? 403 : 400, saved);
    return true;
  }
  sendJson(res, 200, saved);
  return true;
}

async function govrHandleTemplateApplyRoute(req, res, root, _hub, readJsonBody) {
  const body = await readJsonBody(req);
  const resApp = gtApplyPersonalTemplate(root, body.name || body.templateId, {
    actorRole: govrResolveActorRole(req, body),
    confirmedByHuman: body.confirmedByHuman === true
  });
  if (!resApp.ok) {
    sendJson(res, resApp.exitCode === 2 ? 403 : 400, resApp);
    return true;
  }
  sendJson(res, 200, { ...resApp, summary: buildGovernanceSummaryPayload(root) });
  return true;
}

async function govrHandleMutationRoutes(req, res, cleanPath, root, hub, readJsonBody) {
  if (req.method !== 'POST') return false;
  if (cleanPath === '/governance/overlay') {
    return govrHandleOverlayRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/propose') {
    return govrHandleProposeRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/confirm') {
    return govrHandleConfirmRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/reset') {
    return govrHandleResetRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/run') {
    return govrHandleRunRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/trust-dismiss') {
    return govrHandleTrustDismissRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/templates/save') {
    return govrHandleTemplateSaveRoute(req, res, root, hub, readJsonBody);
  }
  if (cleanPath === '/governance/templates/apply') {
    return govrHandleTemplateApplyRoute(req, res, root, hub, readJsonBody);
  }
  return false;
}

export async function handleGovernanceSubRoute(req, res, cleanPath, root, hub, readJsonBody) {
  if (govrHandleGetRoutes(req, res, cleanPath, root)) return true;
  return govrHandleMutationRoutes(req, res, cleanPath, root, hub, readJsonBody);
}
