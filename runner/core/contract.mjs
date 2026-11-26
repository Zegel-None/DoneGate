// 判定核 L0 纯叶契约门面（仅导出无 UI 依赖的状态与门校验原语，阻断跨层循环引用）
export { computeProjectStatus, evaluateGate0, evaluateGate1, evaluateGate2, loadContracts, loadThresholds } from './gates.mjs';
export { buildNodeInterfaceStub, extractFileInterfaceStub, maskCommentsAndStrings, resolveNodeScopeFiles } from './ast-stub.mjs';
export { extractPythonImportTargets, probeTreeSitterWasmCell, resolvePythonImport } from './python-imports.mjs';
export { buildSanitizedEnv, probeExecutableTmpDir } from './isolation.mjs';
export { enrichBarrelFacadeExports, extractHttpRouteContracts, extractTypedefJsDocs } from './barrel-stub-enrich.mjs';
export {
  ATLAS_SUBPACK_DEFAULTS, buildDomWiringGraph, computeFileLineMetrics,
  extractFileDomWiring, formatDomWiringStubComment, resolveSubpackFocusPatterns
} from './dom-wiring-graph.mjs';
export { SHARED_GOVERNANCE_GLOBS, fileBelongsToScopes, inspectCrossCardFocusPatterns, isSharedGovernanceFile } from './context-router.mjs';
export { parseFocusPatterns, parseLexicalTerms } from './hermetic-capsule.mjs';
export { collectGitNodeChanges } from './node-micro-gate.mjs';
export {
  GOVERNANCE_OVERRIDES_REL,
  gdCollectDisabledIntegrityRules,
  gdFormatIntegrityBannerMarkdown,
  gdFormatIntegrityBannerText
} from './governance-disclosure.mjs';
