# ATLAS 画布工作台模块导航索引 (`runner/atlas/`)

> 本索引与 `runner/atlas/contract.mjs` 中的 `ATLAS_SUBPACKS`、`WB_CONCAT_MANIFEST` 保持同步，帮助人类开发者与 AI Agent 通过 `DG-TARGET` 的 `uiOwner` / `sliceCmd` 零盲搜直达目标模块。

## 一、五大功能子包清单 (`ATLAS_SUBPACKS`)

| 子包键名 | 职责边界 | 管辖模块 (`runner/atlas/*.mjs`（私有仓）) |
|---|---|---|
| `@scanner` | 全栈入口盘点、跨语言依赖图谱、Git 支线撞车雷达、看板注水与全景体检四视图 | `contract.mjs`, `index.mjs`, `assemble-atlas.mjs`, `scan-entries.mjs`, `scan-graph.mjs`, `scan-branches.mjs`, `hydrate-workbench.mjs`, `humanize.mjs`, `serve-atlas.mjs`, `ui-views.mjs` |
| `@canvas` | 无限画布引擎、样式与 DOM 骨架、卡片/连线/组合框渲染、拓扑自动整理、级联菜单、视口与 100 步撤销栈 | `render-html.mjs`, `wb-style-base.mjs`, `wb-style-canvas.mjs`, `wb-dom.mjs`, `wb-graph-engine.mjs`, `wb-layout-tidy.mjs`, `wb-render-cards.mjs`, `wb-render-wires.mjs`, `wb-snap-rulers.mjs`, `wb-menus-viewport.mjs`, `wb-viewport-ops.mjs`, `wb-events-wheel-drop.mjs`, `wb-events-pointer.mjs`, `wb-inline-rename.mjs`, `wb-events-actions.mjs`, `wb-history.mjs` |
| `@uiboard` | Agent Native UI 看板前端控制器：实时换肤、同源代理预览、跨窗口拾取桥接收与假动作转真后端 | `wb-uiboard.mjs` |
| `@workflow` | 预置工作流目录、节点级即时派生（JIT）弹窗、实时后端水合外壳与过夜挂机调度、会话子代理联动 | `wb-catalog.mjs`, `wb-jit-workflow.mjs`, `ui-shell.mjs`, `wb-subagent.mjs` |
| `@dsh-dock` | DSH `postMessage` 引用胶囊编码、全元素 `Alt+Click` `resolveUiOwner` 拾取监听与卡包抽卡式底部对话抽屉 | `wb-dsh-style.mjs`, `wb-dsh-bridge.mjs`, `wb-dsh-shell.mjs` |

## 二、工作台前端拼装顺序 (`WB_CONCAT_MANIFEST` 单一数据源)

`runner/atlas/render-html.mjs` 导出只读常量 `WB_CONCAT_MANIFEST`（并在 `contract.mjs` / `index.mjs` 同步导出），按以下三阶段严格保序拼装：

1. **`style` 样式层**：`wb-style-base.mjs` → `wb-style-canvas.mjs` → `wb-dsh-style.mjs`
2. **`dom` 骨架层**：`wb-dom.mjs`
3. **`script` 脚本层**：`wb-catalog.mjs` → `wb-graph-engine.mjs` → `wb-layout-tidy.mjs` → `wb-render-cards.mjs` → `wb-render-wires.mjs` → `wb-subagent.mjs` → `wb-snap-rulers.mjs` → `wb-menus-viewport.mjs` → `wb-viewport-ops.mjs` → `wb-events-wheel-drop.mjs` → `wb-events-pointer.mjs` → `wb-inline-rename.mjs` → `wb-events-actions.mjs` → `wb-history.mjs` → `ui-views.mjs` → `wb-dsh-bridge.mjs` → `wb-uiboard.mjs` → `wb-jit-workflow.mjs` → `ui-shell.mjs` → `wb-dsh-shell.mjs`

## 三、`data-ui-owner` 界面归属矩阵与聚焦切片示例

在工作台或 UI 看板按住 `Alt+Click` 拾取元素时，`wb-dsh-shell.mjs` 与 `runner/dsh/ui-board-bridge.mjs` 中的 `resolveUiOwner(el, meta)` 会向上查找 `[data-ui-owner]` 并回退动作/控件映射表，将 `uiOwner` 与 `sliceCmd` 注入 `[DG-TARGET]` 胶囊：

| 界面区域 / 交互组件 | DOM 选择器与特征属性 | `data-ui-owner` 归属模块 | 所属子包 |
|---|---|---|---|
| 顶栏主控按钮、主题切换、挂机、左侧快捷导航栏与导入/保存弹窗 | `header`, `#left-icon-rail`, `#save-modal`, `#import-project-modal` | `runner/atlas/ui-shell.mjs` | `@workflow` |
| 左栏抽屉（项目列表、工作流列表、节点库）与一键整理按钮组 | `#left-drawer`, `.tidy-split-wrap`, `[data-switch-pack]`, `[data-view-repo]` | `runner/atlas/wb-layout-tidy.mjs` | `@canvas` |
| 全景体检单弹窗（功能清单、跨栈调用链、支线撞车雷达、验收体检单） | `#atlas-overview-modal`, `#btn-atlas-overview`, `[data-ov-tab]` | `runner/atlas/ui-views.mjs` | `@scanner` |
| 画布业务/工作流节点卡、自适应组合框与选中悬浮工具条 | `#cards-layer`, `.node-card`, `#groups-layer`, `.group-frame`, `.selection-toolbox` | `runner/atlas/wb-render-cards.mjs` | `@canvas` |
| 画布贝塞尔连线与自循环回跳次数胶囊 | `#wires-svg`, `.wire-hit`, `#loop-badges-layer`, `.loop-pill` | `runner/atlas/wb-render-wires.mjs` | `@canvas` |
| 节点级即时派生（JIT）双窗对比弹窗与卡片工作流胶囊条 | `#dg-jit-modal-root`, `.dg-jit-modal`, `.dg-sb-wf-bar`, `[data-jit-open]` | `runner/atlas/wb-jit-workflow.mjs` | `@workflow` |
| UI 看板实时舞台、顶部视口/代理工具条、左栏美学选型与内嵌原型元素 | `#uiboard-stage`, `#uiboard-frame-wrap`, `[data-uib-act]`, `#uib-theme-select` | `runner/atlas/wb-uiboard.mjs` | `@uiboard` |
| 级联右键菜单、面包屑下钻栏、右下角缩放全览 HUD 与源码目录弹窗 | `#ctx-root-menu`, `#ctx-sub-menu`, `#drilldown-bar`, `#folder-modal` | `runner/atlas/wb-menus-viewport.mjs` | `@canvas` |
| 辅助会话子代理面板 | `#right-sidebar` | `runner/atlas/wb-subagent.mjs` | `@workflow` |
| 底部卡包抽卡式对话抽屉壳层与源码改动预览浮层 | `#dsh-composer-shell`, `#dsh-input-dock`, `#dsh-right-preview` | `runner/atlas/wb-dsh-shell.mjs` | `@dsh-dock` |

### 聚焦切片直达命令示例

```bash
# 1. 直接执行 DG-TARGET 胶囊内自动生成的单模块聚焦切片（零手动 grep）
node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-render-cards.mjs
node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-uiboard.mjs
node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/ui-shell.mjs

# 2. 跨多关联 UI 模块组合聚焦切片
node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-dsh-shell.mjs,runner/atlas/wb-dsh-bridge.mjs,runner/atlas/wb-jit-workflow.mjs

# 3. 跨 iframe 拾取桥聚焦切片
node runner/donegate.mjs slice dsh-orchestrator --focus runner/dsh/ui-board-bridge.mjs,runner/dsh/quote-protocol.mjs
```
