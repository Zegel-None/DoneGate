// L3 默认治理工作流纯只读汇总器（零 HTTP 路由依赖，供 L4 工作台水合与 L5 宿主路由单向复用）
import { resolve } from 'node:path';
import {
  gdCollectDisabledIntegrityRules,
  gdFormatIntegrityBannerText
} from '../../core/contract.mjs';
import {
  GOVERNANCE_SEAM_CATALOG,
  wfcCompileWorkflow,
  wfcListDefaultWorkflows,
  wfcListPendingProposals
} from './workflow-compiler.mjs';

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
