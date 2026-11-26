// 十二条命令 · 前六条聚合导出（子模块均 <= 350 行：cmd-lifecycle / cmd-execute / cmd-teeth）
export { cmdInit, cmdContractNew, cmdContractFreeze, cmdContractPromote, cmdRetire } from './cmd-lifecycle.mjs';
export { cmdCheck } from './cmd-execute.mjs';
export { cmdTeeth } from './cmd-teeth.mjs';
