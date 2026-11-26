// L1 共享依赖底座池与跨平台路径门面（仅依赖 L0 shared-primitives，零 UI/编排/宿主依赖）
export {
  buildDshFileResourceAddress, buildWinCmdSpawn, findDshExecutable, normalizeLf, normalizeSlashes,
  normalizeWinDriveKey, openInWindowsOrHostExplorer, resolveDshHome, resolveDshProfileDir,
  resolveSafeWorkspaceFolders, toCrlf, toSafeFileUrl
} from './win-paths.mjs';
export {
  BUILTIN_CATALOG_PACK_SPECS, DEFAULT_RANGE_CHUNK_BYTES, assertPureAsciiBatch,
  buildProvisionAgentPrompt, buildSharedPoolLauncherScripts, buildWinHardenedGitArgs,
  buildWorkflowDepEnv, cleanStaleGitIndexLock, downloadWithRangeResume,
  ensureSharedPoolSkeleton, findExecutableInDirs, getSharedWorkflowDepsPaths,
  inspectAllKnownWorkflowPacks, inspectWorkflowDeps, installSharedPoolBinaryDep,
  parseFlexibleDepsManifest, provisionCleanRepoSnapshot, provisionWorkflowDeps,
  readSharedRefreshStamp, readWorkflowDepsStatus, reconcileSharedPoolOnRefresh,
  recordSharedPoolDepReady, refreshWorkflowDepsStamp, repairGitRepoCleanIndex,
  resolvePoolGradleUserHome, runWorkflowDepsCli, scanSharedPoolDiskInventory,
  summarizeSharedPoolStatus, verifyInstalledNpmPackage, verifySharedPoolLauncher,
  writeSharedPoolLaunchers, writeStandaloneDepsCli
} from './workflow-deps.mjs';
export { lookupFingerprintCache, recordFingerprintCache } from './fingerprint-cache.mjs';
