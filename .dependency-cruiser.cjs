/**
 * dependency-cruiser 配置 —— DoneGate V4 六层严格单向无环架构铁律
 *
 * 机器强制锁定十条不可逆架构纪律（L0 → L5 严格单向，零文件环、零跨层回指）：
 *   1. no-circular                        全局禁止循环依赖
 *   2. mortar-must-stay-thin              适配器层只许用 node 内置与同目录引用
 *   3. core-must-not-know-bricks          runner/ 禁止直接 import 具体适配器
 *   4. core-must-not-import-pilot-tools   runner/ 禁止依赖历史试点脚本
 *   5. layer0-shared-no-upward            L0 runner/shared/ 禁止依赖任何上层 runner 模块
 *   6. layer1-core-must-stay-headless     L1 runner/core/ 禁止依赖 atlas/dsh/cockpit/donegate.mjs
 *   7. layer1-deps-no-upward              L1 runner/dsh/deps/ 禁止依赖 uiboard/autopilot/host/atlas/core
 *   8. layer2-uiboard-no-upward           L2 runner/dsh/uiboard/ 禁止依赖 autopilot/host/atlas/core
 *   9. layer3-autopilot-no-host-or-atlas  L3 runner/dsh/autopilot/ 禁止依赖 host/atlas/cockpit
 *  10. layer4-atlas-no-host-or-cli        L4 runner/atlas/ 禁止依赖 dsh/host、dsh 顶层门面、cockpit 与 donegate.mjs
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖让影响面计算不可信，也让改动互相拖死',
      from: {},
      to: { circular: true }
    },
    {
      name: 'mortar-must-stay-thin',
      severity: 'error',
      comment: '适配器层（skill/adapters/）只许用 node 内置模块与自身目录内的相对引用，不许 import 判定核、门禁脚本或任何 npm 依赖',
      from: { path: '^skill/adapters/' },
      to: { pathNot: '^skill/adapters/', dependencyTypesNot: ['core'] }
    },
    {
      name: 'core-must-not-know-bricks',
      severity: 'error',
      comment: '判定核不许直接 import 具体适配器：核只消费 .donegate/adapters/ 下的声明文件',
      from: { path: '^runner/' },
      to: { path: '^skill/adapters/' }
    },
    {
      name: 'core-must-not-import-pilot-tools',
      severity: 'error',
      comment: '判定核不许依赖历史试点评分器（已归档，绝不许变成运行时依赖）',
      from: { path: '^runner/' },
      to: { path: '^skill/pilot-' }
    },
    {
      name: 'layer0-shared-no-upward',
      severity: 'error',
      comment: 'L0 共享底座（runner/shared/）禁止向上依赖 core/atlas/dsh/cockpit/donegate.mjs',
      from: { path: '^runner/shared/' },
      to: { path: '^runner/(core|atlas|dsh|cockpit|donegate\\.mjs)' }
    },
    {
      name: 'layer1-core-must-stay-headless',
      severity: 'error',
      comment: 'L1 无头判定核（runner/core/）禁止依赖工作台、DSH、变焦驾驶舱视图或顶层 CLI 入口',
      from: { path: '^runner/core/' },
      to: { path: '^runner/(atlas|dsh|cockpit|donegate\\.mjs)' }
    },
    {
      name: 'layer1-deps-no-upward',
      severity: 'error',
      comment: 'L1 共享依赖池（runner/dsh/deps/）仅可依赖 L0 原语，禁止向上依赖 uiboard/autopilot/host/atlas/core/cockpit',
      from: { path: '^runner/dsh/deps/' },
      to: { path: '^runner/(core|atlas|cockpit|donegate\\.mjs|dsh/(uiboard|autopilot|host|index\\.mjs|contract\\.mjs))' }
    },
    {
      name: 'layer2-uiboard-no-upward',
      severity: 'error',
      comment: 'L2 页面工坊（runner/dsh/uiboard/）仅可依赖 L0/L1 deps，禁止向上依赖 autopilot/host/atlas/core/cockpit',
      from: { path: '^runner/dsh/uiboard/' },
      to: { path: '^runner/(core|atlas|cockpit|donegate\\.mjs|dsh/(autopilot|host|index\\.mjs|contract\\.mjs))' }
    },
    {
      name: 'layer3-autopilot-no-host-or-atlas',
      severity: 'error',
      comment: 'L3 治理流与挂机引擎（runner/dsh/autopilot/）禁止反向依赖 DSH 宿主路由、工作台或驾驶舱',
      from: { path: '^runner/dsh/autopilot/' },
      to: { path: '^runner/(atlas|cockpit|donegate\\.mjs|dsh/(host|index\\.mjs|contract\\.mjs))' }
    },
    {
      name: 'layer4-atlas-no-host-or-cli',
      severity: 'error',
      comment: 'L4 工作台（runner/atlas/）禁止反向依赖 DSH 宿主层、dsh 顶层门面、驾驶舱视图或 CLI 总入口',
      from: { path: '^runner/atlas/' },
      to: { path: '^runner/(cockpit|donegate\\.mjs|dsh/(host|index\\.mjs|contract\\.mjs))' }
    }
  ],
  options: {
    doNotFollow: { path: '(^|/)(node_modules|\\.git|\\.donegate|reports|coverage|\\.stryker-tmp)(/|$)' },
    exclude: { path: '(^|/)(node_modules|\\.git|\\.donegate|reports|coverage|\\.stryker-tmp)(/|$)' },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } }
  }
};
