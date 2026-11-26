// L2 可视化页面工坊与美学评测门面（仅依赖 L0 shared-primitives 与 L1 shared-deps-pool）
export {
  AESTHETIC_GROUPS, AESTHETIC_PROPOSALS, auditHtmlAntiAiSlop,
  lockDesignSystemMaster, recommendAestheticProposals
} from './ui-aesthetics.mjs';
export { ARCHETYPE_CSS, renderProposalArchetypeBody, resolveProposalArchetype } from './ui-archetypes.mjs';
export { buildInjectedUiBridgeScript } from './ui-board-bridge.mjs';
export {
  PUCK_BLOCK_TEMPLATES, UI_TOOLCHAIN_DEPS_PACK, addUiBoardRequirement,
  buildBackendWiringPlan, conveyUiBoardRequirementsToKanban, detectProjectUiEntry,
  findRealProjectHtmlEntry, isPuckInstalled, isSelfDoneGateProject,
  loadOrInitUiLayoutAndWiring, loadUiBoardRequirements, mutateUiLayoutBlocks,
  provisionUiBoardDeps, readUiToolchainStatus, renderPrototypeHtml, runUiAgentSelfPlayCheck
} from './ui-board-engine.mjs';
export { runUiLiveEvaluation, uleResolvePlaywrightModule, uleValidateLocalTargetUrl } from './ui-live-evaluator.mjs';
