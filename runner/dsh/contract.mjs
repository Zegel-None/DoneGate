// DSH 编排层纯叶节点契约门面（零 core/atlas 反向依赖，供工作台安全调用）
export { resolveSafeWorkspaceFolders } from './win-paths.mjs';
export {
  buildElementQuotePayload,
  deriveSliceCmdFromUiOwner,
  formatQuoteCapsule,
  normalizeUiOwner,
  parseQuoteCapsule,
  parseQuotedTargetsFromMessage,
  verifySubagentNodeReceipt
} from './quote-protocol.mjs';
export { buildInjectedUiBridgeScript } from './ui-board-bridge.mjs';
export { AESTHETIC_GROUPS, AESTHETIC_PROPOSALS } from './ui-aesthetics.mjs';
export { ARCHETYPE_CSS, renderProposalArchetypeBody, resolveProposalArchetype } from './ui-archetypes.mjs';
export {
  DEFAULT_RANGE_CHUNK_BYTES,
  assertPureAsciiBatch,
  buildProvisionAgentPrompt,
  buildSharedPoolLauncherScripts,
  buildWinHardenedGitArgs,
  buildWorkflowDepEnv,
  cleanStaleGitIndexLock,
  downloadWithRangeResume,
  ensureSharedPoolSkeleton,
  installSharedPoolBinaryDep,
  inspectWorkflowDeps,
  provisionCleanRepoSnapshot,
  provisionWorkflowDeps,
  readSharedRefreshStamp,
  readWorkflowDepsStatus,
  recordSharedPoolDepReady,
  refreshWorkflowDepsStamp,
  repairGitRepoCleanIndex,
  resolvePoolGradleUserHome,
  runWorkflowDepsCli,
  verifySharedPoolLauncher,
  writeSharedPoolLaunchers
} from './workflow-deps.mjs';
