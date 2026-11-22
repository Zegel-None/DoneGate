# ATLAS 画布工作台模块导航索引 (`runner/atlas/`)

> 本索引替代早期的 `wb-logic-a..x` 机械字母切片，帮助人类开发者与 AI Agent 一步定位职责模块，零盲搜成本。

## 一、数据扫描与服务端入口层

| 模块文件 | 核心导出 | 职责边界 |
|---|---|---|
| `assemble-atlas.mjs` | `assembleProjectAtlas` | 汇总全栈入口、调用图、Git 雷达与契约状态，产出 `atlas.json` 与 `PROJECT-MAP.md` |
| `scan-entries.mjs` | `scanProjectEntries` | 零配置盘点 JS/TS 路由、CLI 脚本、Python FastAPI/Flask 入口与技能目录 |
| `scan-graph.mjs` | `scanDependencyGraph` | 静态模块依赖图谱与前后端 API 调用链跨栈缝合 |
| `scan-branches.mjs` | `scanGitRadar` | Git 分支、Worktree、撞车预警与休眠分支扫描 |
| `hydrate-workbench.mjs` | `hydrateWorkbenchPayload` | 将 `atlas.json` 与 `workflows/*.workflow.json` （私有仓）注水为看板和开发流画布模型 |
| `humanize.mjs` | `humanizeAtlas` | 面向非专业开发者的白话翻译与自然语言派工提示词生成 |
| `serve-atlas.mjs` | `serveAtlasWorkbench` | 本地独立 HTTP + SSE 实时工作台服务与安全目录打开校验 |
| `render-html.mjs` | `renderAtlasWorkbenchHtml` | 将下列样式、DOM 与交互语义模块拼装为零外网依赖单文件 HTML |

## 二、工作台前端语义模块层（由 `render-html.mjs` 统一拼装）

| 模块文件 | 导出函数 | 涵盖章节与核心函数 |
|---|---|---|
| `wb-style-base.mjs` | `buildWbStyleBase` | 设计令牌、暗黑/亮色主题变量、离线原子工具类、顶栏与左右抽屉样式 |
| `wb-style-canvas.mjs` | `buildWbStyleCanvas` | 画布卡片、连线端口、自适应组合框、级联右键菜单与模态窗样式 |
| `wb-dsh-style.mjs` | `buildWbDshStyle` | DSH 引用胶囊、卡包抽卡式底部对话抽屉、两行验真微卡与补齐按钮样式 |
| `wb-dom.mjs` | `buildWbDom` | 顶栏、面包屑、左栏目录、无限画布舞台、右栏子代理与全景弹窗骨架 |
| `wb-catalog.mjs` | `buildWbCatalog` | §1 `BLOCK_TEMPLATES`（含人工确认闸门）、§2 `WORKFLOW_PACKS`、§3 `REPO_SANDBOXES` |
| `wb-graph-engine.mjs` | `buildWbGraphEngine` | §4 全局 `state`、§5 ComfyUI 子流 `mergeSelectedIntoSubgraph` / `unpackSelectedSubgraph` |
| `wb-layout-tidy.mjs` | `buildWbLayoutTidy` | §6 拓扑自动整理 `autoArrangeNodesSubset`、§7 端口静音、§8 `renderHeader` / `renderLeftDrawer` |
| `wb-render-cards.mjs` | `buildWbRenderCards` | §9 `renderWorkshopCardHtml` / `renderSandboxCardHtml`、§10 组合框与悬浮工具条 |
| `wb-render-wires.mjs` | `buildWbRenderWires` | §11 `renderWires` 贝塞尔连线、响应式高度底线保护、§12a 控件选中与样式覆盖 |
| `wb-subagent.mjs` | `buildWbSubagent` | §12b `renderRightSidebar` / `handleSubagentMessage` 自然语言局部改 UI 与拓扑 |
| `wb-snap-rulers.mjs` | `buildWbSnapRulers` | §13b Visual Studio 风格等宽/等高标尺磁吸与边缘对齐参考线 |
| `wb-menus-viewport.mjs` | `buildWbMenusViewport` | §13c 卡片/组合框/开发流/连线级联右键菜单与源码目录定位模态框 |
| `wb-viewport-ops.mjs` | `buildWbViewportOps` | §14 视窗变换、自适应居中、剪贴板复制粘贴、跳过折叠与跨子仓钻取 |
| `wb-events-wheel-drop.mjs` | `buildWbEventsWheelDrop` | 画布右键唤出、双击钻取/尺寸复位、滚轮无级缩放与左栏 `.workflow.json` 拖放导入 |
| `wb-events-pointer.mjs` | `buildWbEventsPointer` | `setupAllEvents` 指针平移、框选、卡片/组合框拖拽缩放与端口连线吸附 |
| `wb-inline-rename.mjs` | `buildWbInlineRename` | 画布内外文本、组合框标题与卡片标题原地双击改名及防重绘连击检测 |
| `wb-events-actions.mjs` | `buildWbEventsActions` | `setupActionAndKeyEvents` 全局按钮点击委托、工具栏动作与键盘快捷键 |
| `wb-history.mjs` | `buildWbHistoryScript` | 100 步快照撤销/重做栈与自动防抖落盘 |
| `ui-views.mjs` / `ui-shell.mjs` | `buildViewsScript` / `buildShellScript` | 四标签活体全景体检弹窗、实时 SSE 水合刷新与单流/全项目拓扑过夜挂机入口 |
| `wb-dsh-bridge.mjs` / `wb-dsh-shell.mjs` | `buildWbDshBridge` / `buildWbDshShell` | DSH Web `postMessage` 引用胶囊桥接与卡包抽卡式零缝隙主对话复刻抽屉 |
| `wb-uiboard.mjs` | `buildWbUiBoardScript` | Agent Native UI 看板控制器：编辑/测试双模、美学方案锁定与真后端接线台 |
| `wb-jit-workflow.mjs` | `buildWbJitWorkflowScript` | 预置宏打底 + 节点级即时派生（JIT）控制器：底座只增不减锁审批与一键沉淀为宏 |
