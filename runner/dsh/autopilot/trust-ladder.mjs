// 零开局选档 · 模型信任阶梯、观察期采纳率与门禁误拦无助率账本评估（<= 335 行）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { wfcCompileWorkflow, wfcListDefaultWorkflows } from './workflow-compiler.mjs';

export const TRUST_LADDER_DEFAULT_STREAK = 8;
export const TRUST_LADDER_MAX_SUGGESTIONS = 1;
export const OBSERVE_MIN_PROMOTE_FIRES = 3;
export const OBSERVE_PROMOTE_FIX_RATE = 0.75;
export const OBSERVE_MIN_PRUNE_FIRES = 5;
export const OBSERVE_PRUNE_MAX_FIX_RATE = 0.2;
export const RULE_UNHELPFUL_MIN_SAMPLES = 4;
export const RULE_UNHELPFUL_DOWNGRADE_RATE = 0.5;
export const RULE_UNHELPFUL_PRUNE_RATE = 0.75;
const RATE_DECIMALS = 4, PERCENT_SCALE = 100;
const TL_LEDGER_REL = '.donegate/trust-ledger.json';
const UNHELPFUL_OUTCOMES = new Set(['overridden', 'reverted', 'dismissed', 'bypassed', 'false-positive']);

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
  mkdirSync(join(root, '.donegate'), { recursive: true });
  const next = { ...ledger, schema: 'donegate-trust-ledger/v1', updatedAt: new Date().toISOString() };
  writeFileSync(join(root, TL_LEDGER_REL), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function tlCreateDefaultRecord(cleanModel, flowId, item, now) {
  return {
    modelId: cleanModel,
    flowId,
    nodeId: item.nodeId,
    title: String(item.title || item.nodeId),
    tier: item.tier || 'recommended',
    mode: item.mode || 'enforce',
    cleanStreak: 0,
    totalRuns: 0,
    catches: 0,
    warnFired: 0,
    warnFixed: 0,
    warnIgnored: 0,
    pendingWarn: false,
    escapeRelapses: 0,
    dismissed: false,
    lastAt: now
  };
}

function tlUpdateRecordCounters(rec, passed, isObserve) {
  if (passed) {
    if (rec.pendingWarn) {
      rec.warnFixed = Number(rec.warnFixed || 0) + 1;
      rec.pendingWarn = false;
    }
    rec.cleanStreak = Number(rec.cleanStreak || 0) + 1;
    return;
  }
  rec.cleanStreak = 0;
  if (!isObserve) {
    rec.catches = Number(rec.catches || 0) + 1;
    return;
  }
  if (rec.pendingWarn) rec.warnIgnored = Number(rec.warnIgnored || 0) + 1;
  rec.warnFired = Number(rec.warnFired || 0) + 1;
  rec.pendingWarn = true;
}

function tlApplySingleOutcome(rec, item, now) {
  rec.totalRuns = Number(rec.totalRuns || 0) + 1;
  rec.lastAt = now;
  if (item.title) rec.title = String(item.title);
  if (item.tier) rec.tier = item.tier;
  if (item.mode) rec.mode = item.mode;
  tlUpdateRecordCounters(rec, Boolean(item.passed), item.mode === 'observe');
}

export function tlRecordRuleOutcomes(projectRoot, { modelId = 'default', flowId = '', outcomes = [] } = {}) {
  const ledger = tlLoadTrustLedger(projectRoot);
  const cleanModel = String(modelId || 'default').trim() || 'default';
  const now = new Date().toISOString();
  ledger.lastModelId = cleanModel;

  for (const item of Array.isArray(outcomes) ? outcomes : []) {
    if (!item || !item.nodeId || item.skipped) continue;
    const effFlowId = flowId || item.flowId || 'default';
    const k = tlKey(cleanModel, effFlowId, item.nodeId);
    const rec = ledger.records[k] || tlCreateDefaultRecord(cleanModel, effFlowId, item, now);
    tlApplySingleOutcome(rec, item, now);
    ledger.records[k] = rec;
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

function tlEvalBypassedCandidate(comp, node, rec, targetModel, minStreak) {
  const hasRelapse = Number(rec?.escapeRelapses || 0) > 0;
  const unobservedModel = !rec || Number(rec.cleanStreak || 0) < minStreak;
  if (!hasRelapse && (node.tier === 'optional' || !unobservedModel)) return null;
  const reason = hasRelapse
    ? `近期在「${node.title}」关联区域出现漏网复发，建议重新开启这条安全带`
    : `当前模型「${targetModel}」尚未积累足够稳定记录，建议先重新开启「${node.title}」`;
  return {
    kind: 'reenable',
    modelId: targetModel,
    flowId: comp.flowId,
    flowName: comp.effectivePack.name,
    nodeId: node.id,
    title: node.title,
    tier: node.tier || 'recommended',
    reason
  };
}

function tlEvalRelaxCandidate(comp, node, rec, targetModel, minStreak) {
  if (node.tier === 'integrity' || node.mode === 'observe' || !rec || rec.dismissed) return null;
  if (rec.cleanStreak < minStreak || Number(rec.escapeRelapses || 0) !== 0) return null;
  return {
    kind: 'relax',
    modelId: targetModel,
    flowId: comp.flowId,
    flowName: comp.effectivePack.name,
    nodeId: node.id,
    title: node.title,
    tier: node.tier || 'recommended',
    cleanStreak: rec.cleanStreak,
    reason: `模型「${targetModel}」已连续 ${rec.cleanStreak} 轮稳定通过「${node.title}」且零漏网，要不要将其调为关闭以减负提速？（仍由你最终决定）`
  };
}

function tlEvalObserveCandidate(comp, node, rec, targetModel) {
  if (node.mode !== 'observe' || !rec || rec.dismissed) return null;
  const fired = Number(rec.warnFired || 0);
  if (fired < OBSERVE_MIN_PROMOTE_FIRES) return null;
  const fixed = Number(rec.warnFixed || 0);
  const fixRate = Number((fixed / fired).toFixed(4));
  if (fired >= OBSERVE_MIN_PROMOTE_FIRES && fixRate >= OBSERVE_PROMOTE_FIX_RATE) {
    return {
      kind: 'promote-enforce',
      modelId: targetModel,
      flowId: comp.flowId,
      flowName: comp.effectivePack.name,
      nodeId: node.id,
      title: node.title,
      warnFired: fired,
      warnFixed: fixed,
      fixRate,
      reason: `观察期规则「${node.title}」已触发 ${fired} 次且真实修复采纳率达 ${Math.round(fixRate * 100)}%，建议晋升为正式阻断 (enforce)`
    };
  }
  if (fired >= OBSERVE_MIN_PRUNE_FIRES && fixRate < OBSERVE_PRUNE_MAX_FIX_RATE) {
    return {
      kind: 'prune-noisy',
      modelId: targetModel,
      flowId: comp.flowId,
      flowName: comp.effectivePack.name,
      nodeId: node.id,
      title: node.title,
      warnFired: fired,
      warnFixed: fixed,
      fixRate,
      reason: `观察期规则「${node.title}」已触发 ${fired} 次但采纳率仅 ${Math.round(fixRate * 100)}%（疑似高误报），建议直接关闭修剪`
    };
  }
  return null;
}

function tlScanFlowCandidates(comp, ledger, targetModel, minStreak) {
  const relaxCands = [];
  const reenableCands = [];
  const observeDecisions = [];
  for (const node of comp.effectivePack.nodes || []) {
    const rec = ledger.records[tlKey(targetModel, comp.flowId, node.id)] || null;
    if (node.bypassed === true) {
      const cand = tlEvalBypassedCandidate(comp, node, rec, targetModel, minStreak);
      if (cand) reenableCands.push(cand);
      continue;
    }
    const obsDec = tlEvalObserveCandidate(comp, node, rec, targetModel);
    if (obsDec) observeDecisions.push(obsDec);
    const relax = tlEvalRelaxCandidate(comp, node, rec, targetModel, minStreak);
    if (relax) relaxCands.push(relax);
  }
  return { relaxCands, reenableCands, observeDecisions };
}

export function tlComputeRestrainedSuggestions(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const ledger = tlLoadTrustLedger(root);
  const targetModel = String(opts.modelId || ledger.lastModelId || '').trim();
  const minStreak = Number(opts.minStreak || TRUST_LADDER_DEFAULT_STREAK);
  const maxSuggestions = Number(opts.maxSuggestions || TRUST_LADDER_MAX_SUGGESTIONS);
  if (!targetModel) {
    return { ok: true, modelId: null, minStreak, suggestions: [], reenableAlerts: [], observeDecisions: [] };
  }

  const allRelax = [];
  const allReenable = [];
  const allObserve = [];
  for (const wf of wfcListDefaultWorkflows(root)) {
    const comp = wfcCompileWorkflow(root, wf);
    if (!comp.ok) continue;
    const { relaxCands, reenableCands, observeDecisions } = tlScanFlowCandidates(comp, ledger, targetModel, minStreak);
    allRelax.push(...relaxCands);
    allReenable.push(...reenableCands);
    allObserve.push(...observeDecisions);
  }
  allRelax.sort((a, b) => b.cleanStreak - a.cleanStreak);
  return {
    ok: true,
    modelId: targetModel,
    minStreak,
    suggestions: allRelax.slice(0, Math.max(1, maxSuggestions)),
    reenableAlerts: allReenable.slice(0, 3),
    observeDecisions: allObserve
  };
}

function tlExtractEntryCounts(entry) {
  if (typeof entry.totalFires === 'number' || typeof entry.fired === 'number') {
    const fires = Math.max(0, Number(entry.totalFires ?? entry.fired ?? 0));
    const badRaw = entry.unhelpfulCount ?? entry.overriddenCount ?? (typeof entry.unhelpful === 'number' ? entry.unhelpful : 0);
    return { fires, bad: Math.min(fires, Math.max(0, Number(badRaw || 0))) };
  }
  const outcome = String(entry.outcome || entry.action || '').trim().toLowerCase();
  const isUnhelpful = entry.unhelpful === true || entry.overridden === true || entry.reverted === true
    || entry.falsePositive === true || entry.helpful === false || UNHELPFUL_OUTCOMES.has(outcome);
  return { fires: 1, bad: isUnhelpful ? 1 : 0 };
}

function tlClassifyRuleLedgerAction(stat, minSamples, downgradeRate, pruneRate) {
  if (stat.tier === 'integrity') return { action: 'keep-integrity', flagged: false };
  if (stat.totalFires < minSamples) return { action: 'keep', flagged: false };
  if (stat.unhelpfulRate >= pruneRate) return { action: 'prune', flagged: true };
  if (stat.unhelpfulRate >= downgradeRate) return { action: 'downgrade-observe', flagged: true };
  return { action: 'keep', flagged: false };
}

function tlResolveEntryRuleId(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.ruleId ?? entry.nodeId ?? entry.id ?? '').trim();
}

function tlAccumulateRuleStats(list) {
  const byRule = new Map();
  for (const entry of list) {
    const ruleId = tlResolveEntryRuleId(entry);
    if (!ruleId) continue;
    const prev = byRule.get(ruleId) || { ruleId, title: String(entry.title ?? ruleId), tier: String(entry.tier ?? 'recommended'), totalFires: 0, unhelpfulCount: 0 };
    if (entry.tier === 'integrity') prev.tier = 'integrity';
    const { fires, bad } = tlExtractEntryCounts(entry);
    prev.totalFires += fires;
    prev.unhelpfulCount += bad;
    byRule.set(ruleId, prev);
  }
  return [...byRule.values()];
}

function tlBuildRecommendation(r) {
  const actionLabel = r.action === 'prune' ? '修剪关闭 (prune)' : '降级观察 (downgrade-observe)';
  const pct = Math.round(r.unhelpfulRate * PERCENT_SCALE);
  return {
    ruleId: r.ruleId, title: r.title, action: r.action, unhelpfulRate: r.unhelpfulRate,
    totalFires: r.totalFires, unhelpfulCount: r.unhelpfulCount,
    reason: `软门禁「${r.title}」触发 ${r.totalFires} 次中被撤销/覆盖 ${r.unhelpfulCount} 次（无助率 ${pct}%），建议执行 ${actionLabel}`
  };
}

export function evaluateGateRuleUnhelpfulLedger(ledgerEntries = [], opts = {}) {
  const list = Array.isArray(ledgerEntries) ? ledgerEntries : [];
  const minSamples = Number(opts.minSamples ?? RULE_UNHELPFUL_MIN_SAMPLES);
  const downgradeThreshold = Number(opts.maxUnhelpfulRate ?? opts.downgradeThreshold ?? RULE_UNHELPFUL_DOWNGRADE_RATE);
  const pruneThreshold = Number(opts.pruneThreshold ?? RULE_UNHELPFUL_PRUNE_RATE);
  const rules = tlAccumulateRuleStats(list).map((r) => {
    const unhelpfulRate = r.totalFires > 0 ? Number((r.unhelpfulCount / r.totalFires).toFixed(RATE_DECIMALS)) : 0;
    const cls = tlClassifyRuleLedgerAction({ ...r, unhelpfulRate }, minSamples, downgradeThreshold, pruneThreshold);
    return { ...r, helpfulCount: r.totalFires - r.unhelpfulCount, unhelpfulRate, ...cls };
  }).sort((a, b) => (b.unhelpfulRate - a.unhelpfulRate) || a.ruleId.localeCompare(b.ruleId));
  const flaggedRules = rules.filter((r) => r.flagged);
  return { ok: flaggedRules.length === 0, totalEntries: list.length, minSamples, downgradeThreshold, pruneThreshold, rules, flaggedRules, recommendations: flaggedRules.map(tlBuildRecommendation) };
}
