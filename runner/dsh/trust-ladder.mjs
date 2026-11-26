// 零开局选档 · 模型信任阶梯（按模型实绩克制建议撤枷锁，换弱模型或漏网复发提醒系回安全带，<= 190 行）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { wfcCompileWorkflow, wfcListDefaultWorkflows } from './workflow-compiler.mjs';

export const TRUST_LADDER_DEFAULT_STREAK = 8;
export const TRUST_LADDER_MAX_SUGGESTIONS = 1;
const TL_LEDGER_REL = '.donegate/trust-ledger.json';

function tlKey(modelId, flowId, nodeId) {
  return `${String(modelId || 'default').trim()}::${flowId}::${nodeId}`;
}

export function tlLoadTrustLedger(projectRoot) {
  const p = join(resolve(projectRoot), TL_LEDGER_REL);
  if (!existsSync(p)) {
    return { schema: 'donegate-trust-ledger/v1', lastModelId: null, updatedAt: null, records: {} };
  }
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value.records !== 'object') {
    return { schema: 'donegate-trust-ledger/v1', lastModelId: null, updatedAt: null, records: {} };
  }
  return r.value;
}

export function tlSaveTrustLedger(projectRoot, ledger) {
  const root = resolve(projectRoot);
  const dir = join(root, '.donegate');
  mkdirSync(dir, { recursive: true });
  const next = { ...ledger, schema: 'donegate-trust-ledger/v1', updatedAt: new Date().toISOString() };
  writeFileSync(join(root, TL_LEDGER_REL), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function tlRecordRuleOutcomes(projectRoot, { modelId = 'default', flowId = '', outcomes = [] } = {}) {
  const ledger = tlLoadTrustLedger(projectRoot);
  const cleanModel = String(modelId || 'default').trim() || 'default';
  const now = new Date().toISOString();
  ledger.lastModelId = cleanModel;

  for (const item of Array.isArray(outcomes) ? outcomes : []) {
    if (!item || !item.nodeId || item.skipped) continue;
    const k = tlKey(cleanModel, flowId || item.flowId || 'default', item.nodeId);
    const prev = ledger.records[k] || {
      modelId: cleanModel,
      flowId: flowId || item.flowId || 'default',
      nodeId: item.nodeId,
      title: String(item.title || item.nodeId),
      tier: item.tier || 'recommended',
      cleanStreak: 0,
      totalRuns: 0,
      catches: 0,
      escapeRelapses: 0,
      dismissed: false,
      lastAt: now
    };
    prev.totalRuns += 1;
    prev.lastAt = now;
    if (item.title) prev.title = String(item.title);
    if (item.tier) prev.tier = item.tier;
    if (item.passed) {
      prev.cleanStreak += 1;
    } else {
      prev.cleanStreak = 0;
      prev.catches += 1;
    }
    ledger.records[k] = prev;
  }
  return tlSaveTrustLedger(projectRoot, ledger);
}

export function tlRecordEscapeRelapse(projectRoot, { modelId = 'default', flowId = '', nodeId = '' } = {}) {
  const ledger = tlLoadTrustLedger(projectRoot);
  const cleanModel = String(modelId || ledger.lastModelId || 'default').trim();
  const k = tlKey(cleanModel, flowId, nodeId);
  const prev = ledger.records[k] || {
    modelId: cleanModel, flowId, nodeId, title: nodeId, tier: 'recommended',
    cleanStreak: 0, totalRuns: 0, catches: 0, escapeRelapses: 0, dismissed: false
  };
  prev.cleanStreak = 0;
  prev.escapeRelapses = Number(prev.escapeRelapses || 0) + 1;
  prev.dismissed = false;
  prev.lastAt = new Date().toISOString();
  ledger.records[k] = prev;
  return tlSaveTrustLedger(projectRoot, ledger);
}

export function tlDismissSuggestion(projectRoot, { modelId = '', flowId = '', nodeId = '' } = {}) {
  const ledger = tlLoadTrustLedger(projectRoot);
  const targetModel = String(modelId || ledger.lastModelId || 'default').trim();
  const k = tlKey(targetModel, flowId, nodeId);
  if (ledger.records[k]) {
    ledger.records[k].dismissed = true;
    ledger.records[k].dismissedAt = new Date().toISOString();
    tlSaveTrustLedger(projectRoot, ledger);
  }
  return { ok: true, key: k };
}

function tlScanFlowCandidates(comp, ledger, targetModel, minStreak) {
  const relaxCands = [];
  const reenableCands = [];
  for (const node of comp.effectivePack.nodes || []) {
    const rec = ledger.records[tlKey(targetModel, comp.flowId, node.id)] || null;
    if (node.bypassed === true) {
      const hasRelapse = Number(rec?.escapeRelapses || 0) > 0;
      const unobservedModel = !rec || Number(rec.cleanStreak || 0) < minStreak;
      if (hasRelapse || (node.tier !== 'optional' && unobservedModel)) {
        reenableCands.push({
          kind: 'reenable',
          modelId: targetModel,
          flowId: comp.flowId,
          flowName: comp.effectivePack.name,
          nodeId: node.id,
          title: node.title,
          tier: node.tier || 'recommended',
          reason: hasRelapse
            ? `近期在「${node.title}」关联区域出现漏网复发，建议重新开启这条安全带`
            : `当前模型「${targetModel}」尚未积累足够稳定记录，建议先重新开启「${node.title}」`
        });
      }
      continue;
    }
    if (node.tier === 'integrity' || !rec || rec.dismissed) continue;
    if (rec.cleanStreak >= minStreak && Number(rec.escapeRelapses || 0) === 0) {
      relaxCands.push({
        kind: 'relax',
        modelId: targetModel,
        flowId: comp.flowId,
        flowName: comp.effectivePack.name,
        nodeId: node.id,
        title: node.title,
        tier: node.tier || 'recommended',
        cleanStreak: rec.cleanStreak,
        reason: `模型「${targetModel}」已连续 ${rec.cleanStreak} 轮稳定通过「${node.title}」且零漏网，要不要将其调为关闭以减负提速？（仍由你最终决定）`
      });
    }
  }
  return { relaxCands, reenableCands };
}

export function tlComputeRestrainedSuggestions(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const ledger = tlLoadTrustLedger(root);
  const targetModel = String(opts.modelId || ledger.lastModelId || '').trim();
  const minStreak = Number(opts.minStreak || TRUST_LADDER_DEFAULT_STREAK);
  const maxSuggestions = Number(opts.maxSuggestions || TRUST_LADDER_MAX_SUGGESTIONS);
  if (!targetModel) {
    return { ok: true, modelId: null, minStreak, suggestions: [], reenableAlerts: [] };
  }

  const allRelax = [];
  const allReenable = [];
  for (const wf of wfcListDefaultWorkflows(root)) {
    const comp = wfcCompileWorkflow(root, wf);
    if (!comp.ok) continue;
    const { relaxCands, reenableCands } = tlScanFlowCandidates(comp, ledger, targetModel, minStreak);
    allRelax.push(...relaxCands);
    allReenable.push(...reenableCands);
  }
  allRelax.sort((a, b) => b.cleanStreak - a.cleanStreak);
  return {
    ok: true,
    modelId: targetModel,
    minStreak,
    suggestions: allRelax.slice(0, Math.max(1, maxSuggestions)),
    reenableAlerts: allReenable.slice(0, 3)
  };
}
