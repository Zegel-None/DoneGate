// L1 门禁与状态现算聚合导出（子模块均 <= 350 行：project-loader / state-calc / gate-checks）
export {
  DEFAULT_THRESHOLDS,
  SELF_WRITER_RE,
  isDeliveryContract,
  isSelfWriterIdentity,
  loadThresholds,
  loadContracts,
  loadFunctions
} from './project-loader.mjs';
export { evaluateObligationState, computeProjectStatus } from './state-calc.mjs';
export { evaluateGate0, evaluateGate1, evaluateGate2 } from './gate-checks.mjs';
