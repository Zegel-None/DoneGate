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
