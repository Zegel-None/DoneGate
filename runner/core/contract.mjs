// 判定核 L0 纯叶契约门面（仅导出无 UI 依赖的状态与门校验原语，阻断跨层循环引用）
export { computeProjectStatus, evaluateGate0, evaluateGate1, evaluateGate2, loadContracts, loadThresholds } from './gates.mjs';
export { buildNodeInterfaceStub, extractFileInterfaceStub } from './ast-stub.mjs';
