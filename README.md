# DoneGate（完工门）0.4.0

**一句话**：用 AI 做项目时，把「AI 嘴上说做完了」变成**「从前期规划、确定性开发流派生到多组件过夜挂机，每一步都有硬门禁拦着、有真凭实据给你看」**。

**它是三层协同，不是一摞空谈的提示词剧本：**

- **底座 · 零依赖防伪判定核（`runner/`）**：纯 Node.js 原生实现，只认冻结的验收判据、SHA-256 防篡改证据链与真实退出码（`0=通过 / 1=判否 / 2=事故 / 3=无法判断`）。外部工具一律只交观测，由断言器独立裁决，无权越俎代庖下结论。
- **画布 · 智能选配看板与拓扑级过夜挂机台（`runner/atlas/` + `runner/dsh/`）**：深度集成 **DeepSeek Harness (`dsh web`)** Web UI（含零缝隙「卡包抽卡式」主对话复刻抽屉、双击改名与拖拽高度记忆），提供无限画布项目看板、**预置宏打底 + 节点级即时派生（JIT）**、跨开发流共享底座池（`workflows/.deps/_shared`），以及带 **Git Worktree 零污染沙箱 + 组件拓扑编排 + 三重熔断 + 早间简报** 的过夜挂机引擎。
- **工坊 · 普适六形态工具扩展（`donegate-forge/`）**：遇到任何 GitHub 开源工具或长尾技术栈（CLI / 语言库 / 本地服务 / 自带 UI 应用 / 静态规范包 / MCP 工具），按 `skill/17-适配器协议.md` 提炼为画布模块化卡片，自动接入 22 块真实适配器观测链路。

## 30 秒零依赖快速上手（推荐）

**不需要预先安装十几个外部命令行工具！** DoneGate 本体内核与全套门禁脚本均为零第三方依赖，装好即可直接运行；只有当你点选某条含外部工具的开发流时，才像 ComfyUI 缺模型一样点击**「补齐」**按需拉取至共享池。

### 方式一：发一段话让 DeepSeek Harness 自动装好

把下面这段话原封不动发给你的 **DeepSeek Harness (`dsh web`)** 会话：

> 请帮我安装并挂载 **DoneGate**（仓库地址：`https://github.com/q862877400-ux/DoneGate.git`）：
> 1. 确认本机已有 `node`（v22.12+ 最佳，v18.20+ 即可跑零依赖内核）与 `git`。
> 2. 将仓库克隆到干净技能目录（如 `D:\skills\DoneGate` 或 `~/skills/DoneGate`，根目录直接可见 `donegate/`、`donegate-judge/`、`donegate-forge/`）。
> 3. 运行根目录 `install-dsh-web.cmd`（或 `node runner/dsh/install-dsh-web.mjs`）一键生成并挂载 `@local/dsh-donegate` Web 插件包。
> 4. 按需运行 `npm install`（仅用于本地跑 Vitest 单测与 Stryker 变异测试），无需预先全局安装任何外部扫描工具。
> 5. 运行 `node skill/check-escapes.mjs --self-check`、`node runner/self-test.mjs` 与 `node runner/dsh-fixtures.mjs`，把实测结果汇报给我。

### 方式二：手动两步安装（Windows / macOS / Linux）

```powershell
# 1. 克隆仓库（零依赖内核开箱即用）
git clone https://github.com/q862877400-ux/DoneGate.git D:\skills\DoneGate
cd D:\skills\DoneGate

# 2. 一键构建并挂载 DeepSeek Harness Web 插件包（非 Windows 可运行 node runner/dsh/install-dsh-web.mjs）
.\install-dsh-web.cmd
```

若使用自定义技能目录配置，也可在 `%DSH_HOME%\profiles\web\cordis.patch.yml` 中声明：

```yaml
- id: skill
  config:
    customSkillDirs:
      - D:\skills\DoneGate
```

## 类 ComfyUI 开发流与跨开发流共享依赖池（`workflows/.deps/_shared`）

DoneGate 在 `workflows/` 目录下采用轻量化 `.workflow.json` 分发开发流，绝不把体积庞大的第三方 GitHub 仓库强塞进安装包：

1. **未就位自动禁跑保护**：当某条开发流包含尚未安装的外部工具（如 `gitleaks`、`playwright`、`depcruise`）时，引擎前置门禁会精准拦截（返回 `MISSING_WORKFLOW_DEPS`），绝不假跑或静默跳过。
2. **共享底座池一次补齐、全宏与派生通用**：点击开发流右侧的橙色 **「补齐(N)」** 按钮，后台 Agent 会将所需项目与运行环境优先安装到项目级共享底座池 `workflows/.deps/_shared/` 下——装过一次后，无论切换其他预置宏还是节点中途局部 JIT 派生，均可 0 重复下载直接复用。
3. **拖拽导入与一键沉淀为宏**：支持将任意 `.workflow.json` 直接拖入左侧抽屉复用，也支持把项目看板单个节点在需求变更中调教好用的私有派生开发流一键点击「💾 存宏」沉淀为全局宏。

## 六大核心体验

1. **预置宏打底 + 节点级即时派生（JIT Workflow Mutator）**
   开发包含多个组件的项目时，总控 Super Agent 会按各组件的职责与本地就绪依赖自动选配基准预置宏；中途改需求（如增加公式语法解析或联网汇率接口）时，直接在当前组件卡片上局部派生增补节点，同时强制执行**「总控/Worker 权限硬隔离」**（严禁执行端 Worker 篡改验收开发流）与**「底座护栏只增不减安全锁」**（未经人工批准严禁卸载底线护栏）。
2. **卡包抽卡式一体主对话抽屉与画布引用联动**
   底部输入框上方嵌有零缝隙 `28px` 圆角下压叠层的卡包式对话抽屉：收起时仅探出单行滚动最新消息（双击 `Agent：` 即可自定义昵称），鼠标悬停即从输入框圆角底下丝滑抽出完整双向主对话历史（支持滚轮上下翻阅、右上角固定与顶部拖拽调高持久化）；在画布 `Alt + 单击` 任意卡片、连线或按钮即可累加蓝色引用胶囊。
3. **Agent Native UI 看板（编辑/测试双模 + 多套美学方案 + 假动作转真后端）**
   点开左侧「UI 看板」即可实时运行本地项目界面：一键切换 **✏️ 编辑模式**（单击提取源码行列压入引用胶囊、语音口述改交互、原地双击改字、JSON 布局块拖拽）与 **▶️ 测试模式**（恢复真实点击弹窗试用）；内置多套反 AI 模板脸美学方案 0ms 秒切，满意后一键将 `🔌 待接后端` 假动作升级为真实数据库与 API 实现。
4. **项目全看板多组件拓扑级过夜挂机与 Git Worktree 零污染沙箱**
   在项目看板点击顶栏「🌙 挂机」，总控会在独立临时 `git worktree` 沙箱内按组件依赖拓扑顺序依次调度各组件的专属开发流（真跑 `skill/adapters/` 产出 `.donegate/adapters/<tool>/observation.json`），逐组件校验 `scopePaths` 写入范围：**全绿过关才无损快进合回 `main`，一旦触发三重熔断（死循环上限 / 环境异常 / 越界写文件）立即停机保留沙箱现场，主工作区 100% 零污染**；遇到 `human-gate` 自动挂起出早间简报，次日一键批准续跑。
5. **双盲独立裁判（`/donegate-judge`）**
   在项目看板右键卡片即可一键打包门 5 复核包（自动剥离写方 AI 的辩解与草稿，只保留冻结判据、Git Diff 与真实运行三件套），交由独立会话 `/donegate-judge` 冷酷裁决 `pass / fail / unknown` 并一键回填上链。
6. **防假绿与小模型防翻车硬门禁**
   内置提交前卫生门禁（智能有效代码行预算、禁止 `.skip`/恒真断言/删断言凑绿、拦截懒惰截断删码、禁止机械按字母切碎文件）与有牙变异实验（故意改坏实现验证判据真能变红）。

## 装完自检

在 `DoneGate` 根目录运行以下四条命令，全绿即代表内核、画布、插件包与跨平台门禁全部就绪：

```powershell
node skill/check-escapes.mjs --self-check  # 检查技能加载、模块完整性、工坊卡与历史漏网回归门禁
node runner/self-test.mjs                  # 检查零依赖判定核四值退出码与防篡改哈希链
node runner/dsh-fixtures.mjs               # 检查 DSH 插件包、JIT 派生、共享依赖池、真实适配器与多组件拓扑挂机
node runner/atlas-fixtures.mjs             # 检查无限画布工作台测绘、SSE 水合与目录边界保护
```

（若已运行 `npm install`，还可运行 `npm test` 执行 Vitest 单元测试套件；仓库亦内置 `.github/workflows/donegate-ci.yml` 在 Linux + Windows × Node 22/24 矩阵自动守门。）

## 进阶：全局预装常用外部工具（完全可选）

如果你希望在本机全局预装常用外部静态扫描或测试 CLI（而非走共享池 `workflows/.deps/_shared` 按需补齐），可按自己项目的语言栈挑选安装：

```powershell
# JS / TS 核心节点（模块边界 + 重复率 + 死依赖 + 规格提案 + 浏览器 E2E + 静态检查 + AST 搜索）
npm install -g dependency-cruiser jscpd knip @fission-ai/openspec playwright @biomejs/biome @ast-grep/cli

# 安全与密钥体检（Windows 可用 winget，macOS 可用 brew）
winget install Gitleaks.Gitleaks Google.OSVScanner AquaSecurity.Trivy

# Python / Go / 移动端扩展栈（仅对应技术栈项目按需选装）
uv tool install srclight
uv tool install schemathesis
go install github.com/Done-0/fuck-u-code/cmd/fuck-u-code@latest
```

另有 [CodeGraph](https://github.com/colbymchenry/codegraph)（调用图与影响面）、[Maestro](https://github.com/mobile-dev-inc/maestro)（移动端 UI 测试）、[Beads](https://github.com/steveyegge/beads)（长周期任务依赖）与 [Context7](https://github.com/upstash/context7) MCP 可按需接入。

## 全绿还是出了 Bug？漏网门禁与社区共建

一旦遇到「门禁全绿却仍踩出 bug」，DoneGate 通过 `skill/check-escapes.mjs` 形成永久免疫闭环：定位根因 → 横扫同类隐患 → 写成独立回归门禁登记入账 → 全仓复检通过才准提交。若发现 DoneGate 自身盲区，欢迎生成脱敏草稿并提交至 [GitHub Issues](https://github.com/q862877400-ux/DoneGate/issues/new)：

```powershell
node skill/check-escapes.mjs --report-template
```

## 仓库目录速览

| 目录 / 文件 | 职责说明 |
|---|---|
| `donegate/` | 写方主技能：定标准、锁判据、查影响面、留证据与生成交接包 |
| `donegate-judge/` | 独立判方技能：仅由 `/donegate-judge` 唤起，对复核包输出冷酷裁决 |
| `donegate-forge/` | 普适六形态工坊：将任意开源项目提炼为薄适配器与模块化画布卡片 |
| `runner/` | 零依赖判定核（`runner/donegate.mjs` 12 条命令）、`runner/atlas/` 画布工作台与 `runner/dsh/` 宿主插件及挂机引擎 |
| `workflows/`、`bricks/` | 轻量预置开发流目录（外部依赖按需补齐至 `workflows/.deps/_shared`）与工具端口能力台账 |
| `skill/` | 提交前反作弊、模块完整性、复核包白名单、漏网闭环等硬门禁 + `skill/adapters/` 22 个适配器 |
| `install-dsh-web.cmd` | Windows 一键构建并挂载 `@local/dsh-donegate` Web 插件包脚本 |
| `.github/workflows/donegate-ci.yml` | Linux + Windows × Node 22/24 自动门禁与端到端夹具流水线 |

## 依赖项目与致谢

感谢以下优秀开源项目为 DoneGate 外部工具提供灵感与底座支持：[StrykerJS](https://github.com/stryker-mutator/stryker-js)、[CodeGraph](https://github.com/colbymchenry/codegraph)、[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)、[Knip](https://knip.dev)、[Playwright](https://playwright.dev)、[Maestro](https://github.com/mobile-dev-inc/maestro)、[Schemathesis](https://github.com/schemathesis/schemathesis)、[Gitleaks](https://github.com/gitleaks/gitleaks)、[OSV-Scanner](https://google.github.io/osv-scanner/)、[Trivy](https://trivy.dev)、[OpenSpec](https://github.com/Fission-AI/OpenSpec)、[Beads](https://github.com/steveyegge/beads)、[Biome](https://biomejs.dev) 与 [ast-grep](https://ast-grep.github.io)。
