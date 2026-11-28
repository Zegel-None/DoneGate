// L1 子代理专属协议配置、首条消息整数推理强度路由与缓存保活解析器（归属契约：verdict-core，<= 120 行）
import { appendCapsuleDynamicTail } from '../capsule-markdown.mjs';
import { guardActiveToolSessionMessages } from '../review-evidence-sanitizer.mjs';

export const V41_FLASH_PROFILE_ID = 'deepseek-v4.1-flash-1017';
export const V41_FLASH_MODEL_RE = /deepseek-v4\.1-flash/i;
export const V41_REASONING_EFFORT_MIN = 1;
export const V41_REASONING_EFFORT_MAX = 100;
export const V41_EFFECTIVE_MESSAGE_INDEX = 0;
export const DEFAULT_V41_REASONING_EFFORT_BY_ROLE = Object.freeze({ explore: 50, implement: 75, judge: 100 });
export const DEFAULT_V41_FLASH_PROFILE = Object.freeze({
  contextWindowTokens: 1048576, zeroHopSourceBudgetTokens: 160000, compactDefault: false,
  preserveReasoningWithTools: true, reasoningEffortByRole: DEFAULT_V41_REASONING_EFFORT_BY_ROLE,
  thinkingTokenBudget: 3072, stallRepeatWindowTokens: 20, stallRepeatMinCycles: 3, pingPongHistoryWindow: 4
});
const ROLE_TO_TIER = Object.freeze({
  explore: 'explore', locate: 'explore', low: 'explore',
  implement: 'implement', verify: 'implement', medium: 'implement', high: 'implement', xhigh: 'implement',
  judge: 'judge', max: 'judge'
});

function v41ClampEffort(rawVal, fallback) {
  const num = Number(rawVal);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(V41_REASONING_EFFORT_MAX, Math.max(V41_REASONING_EFFORT_MIN, Math.round(num)));
}

function v41BuildEffortDescriptor(role, canonicalRole, effort) {
  const renderedPrefix = `Reasoning Effort: ${effort} (range 1-100, the higher the value, the more thorough the reasoning)\n\n`;
  return { role, canonicalRole, effort, effectiveMessageIndex: V41_EFFECTIVE_MESSAGE_INDEX, immutableMidSession: true, switchStrategy: 'spawn-new-subsession-at-index-0', renderedPrefix };
}

export function resolveModelReasoningEffort(profileConfig = {}, role = 'implement') {
  const byRole = { ...DEFAULT_V41_REASONING_EFFORT_BY_ROLE, ...(profileConfig?.reasoningEffortByRole || {}) };
  if (typeof role === 'number' && Number.isFinite(role)) {
    return v41BuildEffortDescriptor('custom', 'custom', v41ClampEffort(role, byRole.implement));
  }
  const normRole = String(role || 'implement').trim().toLowerCase() || 'implement';
  const tier = ROLE_TO_TIER[normRole] || 'implement';
  const effort = v41ClampEffort(profileConfig?.reasoningEffortByRole?.[normRole] ?? byRole[tier], DEFAULT_V41_REASONING_EFFORT_BY_ROLE[tier]);
  return v41BuildEffortDescriptor(normRole, tier, effort);
}

export function lookupHarnessProfileConfig(thresholds, opts = {}) {
  const rawName = String(opts.harnessProfile || opts.profile || process.env.DG_HARNESS_PROFILE || '').trim();
  const modelId = String(opts.modelId || opts.model || process.env.DG_MODEL_ID || '').trim();
  const profiles = thresholds?.harnessProfiles || {};
  const exact = rawName ? profiles[rawName] : null;
  if (rawName === V41_FLASH_PROFILE_ID || V41_FLASH_MODEL_RE.test(rawName) || V41_FLASH_MODEL_RE.test(modelId)) {
    return { harnessProfile: V41_FLASH_PROFILE_ID, prof: { ...DEFAULT_V41_FLASH_PROFILE, ...(profiles[V41_FLASH_PROFILE_ID] || exact || {}) }, isV41Flash: true };
  }
  return (exact && typeof exact === 'object') ? { harnessProfile: rawName, prof: exact, isV41Flash: false } : { harnessProfile: null, prof: null, isV41Flash: false };
}

function v41HasProtocolFields(prof) {
  return Boolean(prof?.thinkingTokenBudget || prof?.reasoningEffortByRole || prof?.preserveReasoningWithTools);
}

export function enrichSubagentBudgetForProfile(baseBudget, lookup, opts = {}) {
  const { prof, isV41Flash } = lookup;
  if (!isV41Flash && !v41HasProtocolFields(prof)) return baseBudget;
  const effortAdvice = resolveModelReasoningEffort(prof, opts.role ?? opts.reasoningEffort ?? 'implement');
  const preserveReasoningWithTools = typeof prof?.preserveReasoningWithTools === 'boolean' ? prof.preserveReasoningWithTools : isV41Flash;
  const thinkingTokenBudget = Math.round(Number(opts.thinkingTokenBudget ?? prof?.thinkingTokenBudget ?? DEFAULT_V41_FLASH_PROFILE.thinkingTokenBudget));
  const sessionGuardPreview = Array.isArray(opts.sessionMessages) ? guardActiveToolSessionMessages(opts.sessionMessages, { hasTools: preserveReasoningWithTools, ...prof }) : null;
  const capsuleWithTail = typeof opts.baseCapsuleText === 'string' ? appendCapsuleDynamicTail(opts.baseCapsuleText, opts.tailOpts || {}) : null;
  return {
    ...baseBudget, preserveReasoningWithTools, thinkingTokenBudget,
    reasoningEffort: effortAdvice.effort,
    reasoningEffortByRole: { ...DEFAULT_V41_REASONING_EFFORT_BY_ROLE, ...(prof?.reasoningEffortByRole || {}) },
    reasoningEffortAdvice: effortAdvice,
    kvCachePolicy: { lockStaticPrefixAtIndex0: true, appendOnlyTailUpdates: true, immutableMidSessionEffort: true, preserveReasoningWithTools },
    stallGuard: {
      stallRepeatWindowTokens: Number(prof?.stallRepeatWindowTokens ?? DEFAULT_V41_FLASH_PROFILE.stallRepeatWindowTokens),
      stallRepeatMinCycles: Number(prof?.stallRepeatMinCycles ?? DEFAULT_V41_FLASH_PROFILE.stallRepeatMinCycles),
      pingPongHistoryWindow: Number(prof?.pingPongHistoryWindow ?? DEFAULT_V41_FLASH_PROFILE.pingPongHistoryWindow)
    },
    ...(sessionGuardPreview ? { sessionGuardPreview } : {}),
    ...(capsuleWithTail !== null ? { capsuleWithTail } : {})
  };
}
