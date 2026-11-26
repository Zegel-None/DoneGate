// DSH 宿主插件对外统一门面（严格通过下层各域公共 barrel 透传，零越界私引）
export {
  BUILTIN_CATALOG_PACK_SPECS, DEFAULT_RANGE_CHUNK_BYTES, assertPureAsciiBatch,
  buildProvisionAgentPrompt, buildSharedPoolLauncherScripts, buildWinHardenedGitArgs,
  buildWorkflowDepEnv, cleanStaleGitIndexLock, downloadWithRangeResume,
  ensureSharedPoolSkeleton, inspectAllKnownWorkflowPacks, inspectWorkflowDeps,
  installSharedPoolBinaryDep, parseFlexibleDepsManifest, provisionCleanRepoSnapshot,
  provisionWorkflowDeps, readSharedRefreshStamp, readWorkflowDepsStatus,
  reconcileSharedPoolOnRefresh, recordSharedPoolDepReady, refreshWorkflowDepsStamp,
  repairGitRepoCleanIndex, resolvePoolGradleUserHome, resolveSafeWorkspaceFolders,
  runWorkflowDepsCli, scanSharedPoolDiskInventory, summarizeSharedPoolStatus,
  verifyInstalledNpmPackage, verifySharedPoolLauncher, writeSharedPoolLaunchers,
  writeStandaloneDepsCli
} from './deps/index.mjs';
export {
  AESTHETIC_GROUPS, AESTHETIC_PROPOSALS, ARCHETYPE_CSS, UI_TOOLCHAIN_DEPS_PACK,
  buildInjectedUiBridgeScript, isPuckInstalled, readUiToolchainStatus,
  renderProposalArchetypeBody, resolveProposalArchetype
} from './uiboard/index.mjs';
export {
  buildElementQuotePayload, buildGovernanceSummaryPayload, deriveSliceCmdFromUiOwner,
  formatQuoteCapsule, normalizeUiOwner, parseQuoteCapsule,
  parseQuotedTargetsFromMessage, verifySubagentNodeReceipt
} from './autopilot/index.mjs';
export {
  hagCreateControlPlaneGuard, hagInjectSessionTokenHtml,
  hagIsLoopbackHost, hagValidateControlPlaneRequest
} from './host/host-auth-guard.mjs';
export {
  SUBAGENT_HUMAN_ISOLATION_MSG, buildClientSubagentReadOnlyComposerSource,
  createSubagentHumanBlockedError, installSubagentHumanIsolationGuard
} from './host/subagent-isolation.mjs';
