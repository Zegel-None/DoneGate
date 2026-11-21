// 十二条命令 · 后六条与健康自检聚合导出（子模块均 <= 350 行：cmd-inspect / graph-edges / cmd-handover-verify）
export { runHealthChecks, cmdStatus, cmdGaps } from './cmd-inspect.mjs';
export { cmdGraph } from './graph-edges.mjs';
export { cmdHandover, cmdVerifyPack, cmdVerifyApply } from './cmd-handover-verify.mjs';
