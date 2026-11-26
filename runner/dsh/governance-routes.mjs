// 默认治理工作流同源 HTTP 子路由（/donegate/api/governance/*：极简开关清单、参数微调、AI 提案对比确认与一键还原）
import { resolve } from 'node:path';
import { sendJson } from './http-utils.mjs';
import {
  gdCollectDisabledIntegrityRules,
  gdFormatIntegrityBannerText
} from '../core/contract.mjs';
import {
  GOVERNANCE_SEAM_CATALOG,
  wfcCompileWorkflow,
  wfcConfirmProposal,
  wfcCreateProposal,
  wfcListDefaultWorkflows,
  wfcListPendingProposals,
  wfcResetProjectOverlay,
  wfcSaveProjectOverlay
} from './workflow-compiler.mjs';
import { cmdGovernanceFlow } from './governance-flow-cli.mjs';
import { tlComputeRestrainedSuggestions, tlDismissSuggestion } from './trust-ladder.mjs';
import { gtApplyPersonalTemplate, gtListPersonalTemplates, gtSavePersonalTemplate } from './governance-templates.mjs';

function govrResolveActorRole(req, body) {
  const hdr = req.headers && (req.headers['x-donegate-role'] || req.headers['X-DoneGate-Role']);
  return String(hdr || body?.actorRole || 'human').trim();
}

export function buildGovernanceSummaryPayload(projectRoot) {
  const root = resolve(projectRoot);
  const defaults = wfcListDefaultWorkflows(root)
    .sort((a, b) => Number(a.stageOrder || 99) - Number(b.stageOrder || 99));
  const flows = [];
  const newOfficialNodes = [];
  for (const f of defaults) {
    const c = wfcCompileWorkflow(root, f);
    if (!c.ok) continue;
    for (const nn of c.newOfficialNodes) newOfficialNodes.push({ flowId: f.id, flowName: f.name, ...nn });
    flows.push({
      id: f.id,
      stageOrder: Number(f.stageOrder || 99),
      timing: f.timing || '',
      name: f.name,
      tip: f.tip || '',
      presetVersion: c.presetVersion,
      workflowHash: c.workflowHash,
      customized: c.customized,
      overrideDiff: c.overrideDiff,
      disabledIntegrityRules: c.disabledIntegrityRules,
      nodes: c.effectivePack.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        tip: n.tip || '',
        tier: n.tier || 'recommended',
        slot: n.slot || '',
        activeBrick: n.activeBrick || n.tplId || '',
        availableBricks: GOVERNANCE_SEAM_CATALOG[n.slot] || [],
        bypassed: Boolean(n.bypassed),
        bypassReason: n.bypassReason || '',
        envSkipped: Boolean(n.envSkipped),
        config: n.config || {},
        configSchema: Array.isArray(n.configSchema) ? n.configSchema : []
      }))
    });
  }
  const disclosure = gdCollectDisabledIntegrityRules(root);
  return {
    ok: true,
    flows,
    disclosure,
    disclosureBanner: gdFormatIntegrityBannerText(disclosure),
    pendingProposals: wfcListPendingProposals(root),
    newOfficialNodes,
    seamCatalog: GOVERNANCE_SEAM_CATALOG
  };
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

async function govrHandleMutationRoutes(req, res, cleanPath, root, hub, readJsonBody) {
  if (cleanPath === '/governance/overlay' && req.method === 'POST') {
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

  if (cleanPath === '/governance/propose' && req.method === 'POST') {
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

  if (cleanPath === '/governance/confirm' && req.method === 'POST') {
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

  if (cleanPath === '/governance/reset' && req.method === 'POST') {
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

  if (cleanPath === '/governance/run' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const runRes = cmdGovernanceFlow(root, ['run', String(body.flowId || ''), ...(body.staged ? ['--staged'] : []), '--json']);
    sendJson(res, 200, runRes);
    return true;
  }
  if (cleanPath === '/governance/trust-dismiss' && req.method === 'POST') {
    const body = await readJsonBody(req);
    sendJson(res, 200, tlDismissSuggestion(root, body));
    return true;
  }
  if (cleanPath === '/governance/templates/save' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const saved = gtSavePersonalTemplate(root, body.name, { description: body.description, templatesDir: body.templatesDir });
    sendJson(res, 200, saved);
    return true;
  }
  if (cleanPath === '/governance/templates/apply' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const resApp = gtApplyPersonalTemplate(root, body.name || body.templateId, {
      actorRole: govrResolveActorRole(req, body),
      confirmedByHuman: body.confirmedByHuman === true,
      templatesDir: body.templatesDir
    });
    if (!resApp.ok) {
      sendJson(res, resApp.exitCode === 2 ? 403 : 400, resApp);
      return true;
    }
    sendJson(res, 200, { ...resApp, summary: buildGovernanceSummaryPayload(root) });
    return true;
  }
  return false;
}

export async function handleGovernanceSubRoute(req, res, cleanPath, root, hub, readJsonBody) {
  if (govrHandleGetRoutes(req, res, cleanPath, root)) return true;
  return govrHandleMutationRoutes(req, res, cleanPath, root, hub, readJsonBody);
}
