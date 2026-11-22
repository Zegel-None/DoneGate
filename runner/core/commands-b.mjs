// 十二条命令 · 后六条、健康自检与密封契约切片聚合导出（子模块均 <= 350 行）
export { runHealthChecks, cmdStatus, cmdGaps } from './cmd-inspect.mjs';
export { cmdGraph } from './graph-edges.mjs';
export { cmdHandover, cmdVerifyPack, cmdVerifyApply } from './cmd-handover-verify.mjs';
export { discoverHermeticGraph, resolveSubagentBudgetProfile, writeProjectRouter } from './context-router.mjs';
export { cmdSlice, freezeNodeStubBaseline, diffAgainstFrozenStub } from './hermetic-capsule.mjs';
export { cmdCheckNode } from './node-micro-gate.mjs';
