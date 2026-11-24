# DoneGate · 完结门（v0.4.0）

> **专为不懂写代码的 Vibecoder 打造的「AI 工程监理 + 可视化产品指挥台」**
>
> 你只管用大白话提想法、看界面、做选择题、拍板签收；把**「防 AI 嘴硬假交工、防改崩老功能、防代码变屎山、防半夜挂机翻车」**全部交给完结门的机器硬门禁。

## 一、为什么 Vibecoding 总是「前三天爽上天，第四天火葬场」？

很多没有编程背景的朋友用 AI 做软件时，都会经历一模一样的崩溃循环：开头一句话生成个网页觉得自己无所不能，可一旦想做成真正能用的产品，立刻撞上 **七堵墙**。完结门就是专门把这七堵墙拆掉的工具：

| 你在 Vibecoding 时天天踩的痛点 | 没有完结门时会发生什么 | 完结门怎么替你镇住场子 |
|---|---|---|
| **1. AI 嘴硬「假交工」** | AI 每次都信誓旦旦回你「已完美修复！全部搞定！」，结果你一点开页面不是白屏就是按钮没反应 | **不听 AI 自夸，只认机器实测证据**：开工前先锁死验收标准，改完真跑通过才算过；还能一键送交**双盲独立裁判（`/donegate-judge`）**，剥掉写代码 AI 的一切辩解冷酷判分 |
| **2. 拆东墙补西墙、沦为屎山** | 让它加个导出按钮，它顺手把昨天调好的登录页改崩了；文件越塞越长，最后连 AI 自己都改不动只能推倒重来 | **施工围挡（密封胶囊）+ 四维防屎山硬门禁**：给每个模块划定物理围挡，修 A 模块时严禁乱改 B 模块文件；提交前自动拦截超长单文件、删测试凑绿与静默吞报错 |
| **3. 满屏英文代码文件两眼一抹黑** | 左边几百个源码文件完全看不懂，不知道项目长啥样、哪块坏了、想改个地方说破嘴 AI 还找错文件 | **说人话的「项目看板」无限画布**：小项目直接平铺成清爽的业务卡片；大项目按网络科学 [Louvain 社团发现算法](https://en.wikipedia.org/wiki/Louvain_method) 自动折叠高内聚业务，点**「⊞ 原地展开」**层层下钻，按住 `Alt + 点击` 任意卡片就像微信引用一样指哪打哪 |
| **4. 界面一股「AI 紫蓝渐变模板味」** | 做出来的网页千篇一律像套壳模板，想挪个按钮、改句文案，来回对话十几轮越改越歪 | **所见即所得「UI 看板」**：在画布里直接真跑你的界面，一键切换 **✏️ 编辑模式**（点页面元素自动定位代码位置、双击原地改字、多套去 AI 味美学方案秒切）与 **▶️ 测试模式**，满意后再把假动作一键升级为真后端 |
| **5. 一句话没说透，AI 瞎脑补半小时** | 你只提了个大概想法，AI 自己脑补出一堆你根本不要的复杂设计，方向跑偏白烧额度 | **开工前「需求澄清立约（grill-me）」**：第一站先用说人话的选择题把模糊地带问透、立下字据再动手；UI 看板试出的改动也能一键**「📤 传达到项目看板」**走正规立约流程 |
| **6. 想测安全性或体验，掉进配环境地狱** | 想查查有没有漏密钥、网页卡不卡，结果一装测试工具就是版本冲突、满屏红字报错 | **零依赖内核 + 类 [ComfyUI](https://docs.comfy.org/custom-nodes/js/subgraphs) 按需补齐舱**：完结门本体零第三方依赖；点选专业检查工作流时，缺啥点一下橙色**「补齐」**，后台自动装进互不打架的独立工具舱（`workflows/.deps/_shared`），装一次全项目通用 |
| **7. 不敢挂机睡觉、多开子代理聊串台** | 想让 AI 晚上自己推进几个模块，又怕它半夜把正式代码改烂；后台开了子代理还不小心点进去插话搞乱上下文 | **零污染过夜挂机台 + 子智能体双层隔离锁**：点顶栏**「🌙 挂机」**在独立临时沙箱（Git Worktree）施工，全绿才无损合回正式项目，出错立即熔断且主项目零污染；子智能体默认只读隔离（保留查看与紧急喊停），绝不误触串台 |

## 二、安装指南（小白零命令行，直接让你的 AI 代劳！）

你**不需要**自己去搜什么 Node.js 安装包、不需要自己敲黑框框命令、更不需要自己配什么系统环境变量。即便你手头是一台**刚买回来、什么编程软件都没装过的全新 Windows 或 Mac 电脑**，也请直接交给你的 AI Agent 全程代劳。

### 第一步（首选）：复制下面这段话，原封不动发给你的 AI Agent

打开你正在用的 **DeepSeek Harness (`dsh web`)**（或 Claude Code / Cursor / Windsurf / Trae 等具备终端执行能力的 Agent），把下面整段引用块复制发给它：

> 请帮我在本机全自动安装并真机验真 **DoneGate（完结门）**，仓库地址：`https://github.com/q862877400-ux/DoneGate.git`。我是零编程基础用户，**假设我这台电脑什么开发环境都没装过**，请你全程代劳并严格遵守以下五条铁律：
>
> 1. **先探测裸机环境，缺啥自动补啥（别让我手动装软件或配环境变量）**：
>    - 先检查本机是否有 `node`（要求 `>= v18.20`，推荐 `v22 LTS`）、`npm` 与 `git`。
>    - 若在 Windows 上缺少 `Node.js` 或 `Git`，请优先用系统自带 `winget` 替我自动安装：`winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements` 与 `winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements`（若精简版系统无 `winget`，请用 PowerShell 从官方源下载安装）。
>    - **Windows 关键防坑**：刚装完软件后，你必须在当前终端立即从注册表热刷新 `PATH`（执行 `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`），严禁因为当前窗口没刷新环境变量就报错让我自己去点系统设置！（macOS 若缺底座请用 `brew` 或官方包自动补齐。）
> 2. **克隆到干净固定目录（兼容中文与空格用户名）**：
>    - 将仓库克隆到用户目录下的 `.donegate-home/DoneGate`（Windows 为 `"$HOME\.donegate-home\DoneGate"`，macOS/Linux 为 `"$HOME/.donegate-home/DoneGate"`，路径全程加双引号，严禁多套一层空文件夹，确保该目录下直接能看到 `donegate/`、`donegate-judge/`、`donegate-forge/`）。
> 3. **运行一站式安装、Windows 排雷与六道真机验真门禁**：
>    - 进入该仓库根目录，执行：`node "skill/verify-install.mjs" --install`
>    - 该命令会自动修复 Windows PowerShell 禁跑脚本策略（`Restricted -> RemoteSigned`）、开启 `git core.longpaths` 防长路径报错、把 `@local/dsh-donegate` Web 插件包与三套技能自动挂载到本机全部 DSH Profile、在内存沙箱试装顶栏「完结门」视图与子智能体隔离槽位，并真跑防篡改哈希链自检。
> 4. **绝对禁止「假装装好了」**：
>    - 只要 `node "skill/verify-install.mjs" --install` 的退出码不为 `0`，或者没有输出 `RESULT: PASS` 与 `DG-INSTALL-OK-` 开头的验真防伪码，**严禁向我声称安装完成**！你必须根据终端打印的修复指令自行排障重跑，直到 `6/6 硬门禁全绿`。
> 5. **向我交差的方式**：
>    - 验真全绿后，把终端打印的 **【✅ 完结门 (DoneGate) 安装验真回执】整个方框** 原封不动贴给我看；并根据回执里 `[G6]` 的探测结果，用一句大白话告诉我：我现在是**「直接刷新网页就能在顶部看到『完结门』按钮」**，还是**「需要关掉重开一次软件就能看到」**。

### 3 秒防忽悠验货口诀：怎么确认你的 Agent 没有骗你？

你完全不用看懂任何技术词，只看 Agent 回复里有没有贴出下面这种带 **`🔑 验真防伪码：DG-INSTALL-OK-...`** 的方框：

```text
╔══════════════════════════════════════════════════════════════════════╗
║  ✅ 完结门 (DoneGate) 安装验真回执 · 6/6 硬门禁全绿                  ║
╠══════════════════════════════════════════════════════════════════════╣
║  ✓ [G1] 核心底座与裸机排雷：Node v22.x | Git 2.x (worktree 就绪)
║  ✓ [G2] 三套技能与模块树完整性：donegate / judge / forge 三套技能与全仓 ESM 导入绑定 0 断链
║  ✓ [G3] DSH 插件挂载与槽位试装：已覆盖 [web] Profile，顶栏「完结门」视图、对话抽屉与子智能体只读隔离三槽位均通过 VM 试装
║  ✓ [G4] 无限画布与模块度引擎实测：无限画布与模块度引擎实渲染就绪
║  ✓ [G5] 防篡改判定核真机演练：SHA-256 防篡改哈希链与四值退出码判定核实测通过
║  ✓ [G6] 宿主状态与按需生态盘点：检测到运行中的 DSH Web 已热加载完结门...
║  🔑 验真防伪码：DG-INSTALL-OK-XXXXXXXXXXXX
╚══════════════════════════════════════════════════════════════════════╝
```

- **看到这个框 + `DG-INSTALL-OK-` 防伪码**：说明在你的电脑硬盘上真刀真枪跑通了六道体检，放心开用！
- **没看到这个框，Agent 只用嘴说「帮你装好啦」**：它大概率偷懒跳步了，直接回它一句：**「请运行 `node "skill/verify-install.mjs" --install` 并把带 `DG-INSTALL-OK-` 的验真回执框贴出来再交差。」**

<details>
<summary>备选方式：如果你不想让 Agent 克隆，想自己双击脚本安装（点此展开）</summary>

1. 下载或克隆本仓库到任意文件夹（如 `D:\DoneGate`）。
2. **Windows 用户**直接双击仓库根目录的 `install-dsh-web.cmd`（脚本若发现缺 Node.js 或 Git 会自动调用系统 `winget` 补齐，并自动跑完六道验真门禁）。
3. **macOS / Linux 用户**在仓库目录执行：`node skill/verify-install.mjs --install`。

</details>

## 三、装好之后，不懂编程的你平时怎么用？

在 **DeepSeek Harness (`dsh web`)** 会话顶部点开 **「完结门」** 标签页，你会看到画布工作台，底部依然保留你熟悉的主对话输入框（带丝滑抽卡式历史消息抽屉）：

1. **第一步 · 聊想法与立规矩（`grill-me`）**：直接在底部对话框用大白话告诉 AI 你想做什么软件。AI 会先用选择题帮你把模糊需求问清楚，锁成双方认账的验收标准，不会一上来就闷头瞎写。
2. **第二步 · 在「UI 看板」捏界面、试手感**：点左侧栏 **「UI 看板」**，像玩换装游戏一样秒切不同视觉风格；切到 **✏️ 编辑模式**，直接用鼠标点网页上不顺眼的按钮或双击改文字，需求会自动变成蓝色引用胶囊塞进输入框，再也不用费劲描述「右上角往下数第三个框」。
3. **第三步 · 在「项目看板」看全局进度**：点左侧栏 **「项目」**，你的软件不再是一堆天书代码，而是一张清晰的业务流程图。小项目直接平铺展示；项目变大后自动聚合成业务大卡片，点卡片上的 **「⊞ 原地展开」** 就能像放大地图一样看清内部步骤，想看底层文件关联时再点顶栏 **「🔬 代码透视图」**。
4. **第四步 · 点「跑检查」看人话体检单**：每次 AI 说改完了，点一下顶栏 **「跑检查」**。没过关的卡片会亮红灯并直接用大白话写出原因，点卡片上的 **「🔧 派主对话修」**（或顶部横幅 **「🔧 一键汇总派主对话修」**），就能把报错连同精确位置一键甩给主对话返工。
5. **第五步 · 睡前点「🌙 挂机」，早起看简报签收**：有多个模块要推进时，点顶栏 **「🌙 挂机」**。AI 会在隔离沙箱里按顺序逐个模块写代码、跑验收——全部达标才合进你的正式项目；遇到拿不准的产品决定会自动停下等你早上拍板，绝不擅自乱改。

## 四、给进阶玩家与 AI 代理看的底层硬核机制

完结门对小白极度友好，是因为把复杂度全部封在了底层确定性引擎里：

- **零依赖防篡改判定核（`runner/`）**：纯 Node.js 标准库实现，只认冻结判据、SHA-256 证据哈希链与四值退出码（`0=通过 / 1=判否 / 2=环境事故 / 3=无法判断`）。外部扫描器一律只交原始观测数据，无权越俎代庖替裁判下结论。
- **零魔法数字自适应分层（`runner/atlas/modularity-hierarchy.mjs`）**：拒绝一刀切硬凑固定卡片数，采用 Newman-Girvan 模块度增益判据（$\Delta Q > 0$）结合有向无环凸性约束做非均衡递归聚合——简单线性项目 100% 平铺零套娃，复杂内聚子系统自动成组并支持拓扑鱼眼原地展开（参考 [C4 Model](https://c4model.com/diagrams)、[IcePanel Flows](https://docs.icepanel.io/visual-storytelling/flows) 与 [Zooming User Interface](https://en.wikipedia.org/wiki/Zooming_user_interface)）。
- **密封契约切片与 400k 五段式派工预算（`donegate slice` / `check-node`）**：按百万窗口模型注意力黄金甜点（`1M × 40% = 400,000 Tokens`，亦支持小窗口按比例缩放）切出密封施工胶囊——0-Hop 本卡源码与测试 `160k` + 1-Hop 只读接口存根 `48k`，2-Hop 以外无关代码物理屏蔽；子智能体完工跑 `check-node --receipt` 秒级拦截越界改文件与私改接口，仅回传 500-Token 回执即可销毁子上下文。
- **独立工具舱共享依赖池（`workflows/.deps/_shared/npm-cells/`）**：每款外部 CLI 工具（如 Storybook、Lighthouse CI、Playwright、Gitleaks）按确定性精确版本隔离安装进各自的 `npm-cells/<id>/` 独立舱室并生成跨目录 `NODE_PATH` 启动器，彻底根绝跨大版本依赖打架（如 Vite 6 vs 8）与 `npm` 互删顽疾。
- **双层子智能体人机隔离锁（`runner/dsh/subagent-isolation.mjs`）**：前端在 `conversation.composer` 注册只读隔离槽位、后端宿主拦截人类直发 `subagents.prompt` RPC，同时 100% 保留主控 Super Agent `send_message` 续调与人类紧急停止按钮，防止手工插话绕过契约门禁。
- **普适六形态工坊与漏网免疫闭环（`donegate-forge/` + `skill/check-escapes.mjs`）**：支持将任意开源工具按 `skill/17-适配器协议.md` 接入 26 个真实适配器链路；一旦出现「门禁全绿仍漏过 Bug」，通过 `node skill/check-escapes.mjs --report-template` 一键生成脱敏 Issue，修成新门禁让所有人永久免疫。

## 五、仓库目录速览与手工自检命令

| 目录 / 文件 | 它是干什么的 |
|---|---|
| `skill/verify-install.mjs` | **一站式安装与六道防撒谎真机验真器**（裸机排雷、全 Profile 挂载、VM 试装、输出 `DG-INSTALL-OK-` 防伪码） |
| `install-dsh-web.cmd` | Windows 双击一键安装与环境自动补齐脚本 |
| `donegate/` · `donegate-judge/` · `donegate-forge/` | 三套核心技能：写方立约施工、双盲独立冷酷裁判、外部开源工具扩展工坊 |
| `runner/atlas/` · `runner/dsh/` | 无限画布工作台（项目看板 / 工作流 / UI 看板）、DSH Web 插件总装与 Git Worktree 过夜挂机引擎 |
| `runner/donegate.mjs` | 判定核统一命令行入口（含 `brief` / `zoom` 三级变焦驾驶舱、`impact` 波及面雷达、`lint-edit` 微门禁与 `slice` 密封切片） |
| `workflows/` · `bricks/` · `skill/adapters/` | 预置工作流清单、工具能力台账与 26 个外部确定性工具适配器 |

若你想在本地随时重跑全套工程健康自检，在仓库根目录执行：

```powershell
node skill/verify-install.mjs              # 复核本机安装状态与 6 道真机验真门禁
node skill/check-escapes.mjs --self-check  # 跑全套代码完整性、名词规范与历史漏网回归门禁
node runner/dsh-fixtures.mjs               # 跑 DSH 插件包、共享依赖池与过夜挂机端到端夹具
node runner/atlas-fixtures.mjs             # 跑无限画布测绘、自适应模块度分层与 UI 看板夹具
```

### 面向开源协作者与 AI 代理的代码寻路入口

如果你是来阅读源码、排查问题或提交 PR 的开发者 / AI 编码代理，**请先阅读根目录 `AGENTS.md`**，无需盲翻全仓 165 个源码模块，直接用内置零依赖三级按需变焦驾驶舱 `O(1)` 定位：

```bash
node runner/donegate.mjs brief                       # Zoom-0：一屏看清五大业务域、58 条 HTTP 路由、Kneedle 承重接口与四维提交红线
node runner/donegate.mjs zoom <01..05|rules|tests>   # Zoom-1：展开目标业务域模块树、实时阈值规则字典或全仓单测清单
node runner/donegate.mjs zoom <相对文件路径>          # Zoom-2：穿透查看单文件导出/内部/内联生成函数签名、CLI 参数与跨脚本路径
node runner/donegate.mjs impact <符号|路由|文件路径>   # 影响面雷达：自动反查跨文件调用点并推导 1-Hop 必跑回归单测
node runner/donegate.mjs lint-edit <修改文件路径>      # 毫秒级微门禁：即时检查语法、认知复杂度（<=15 绿灯 / >25 硬拦）与反压行
```

> **关于「运行时零依赖」与开发期单测的说明**：完结门 CLI 与判定核运行时 **100% 零第三方 npm 依赖**（裸克隆直接 `node runner/donegate.mjs ...` 即可运行）；`tests/*.test.mjs` 单元测试使用可选开发依赖 `vitest`，裸克隆首次运行 `npm test` 前请先执行一次 `npm install`。提交代码须遵守四维预算（净增生产代码 `<= 250` 绿灯 / `> 450` 硬拦，生产文件 `<= 6` 个 / 含测试总文件 `<= 10` 个，单函数认知复杂度 `<= 25`）。

## 致谢

感谢以下开源项目为完结门外部工具生态提供灵感与支持：[StrykerJS](https://github.com/stryker-mutator/stryker-js)、[CodeGraph](https://github.com/colbymchenry/codegraph)、[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)、[Knip](https://knip.dev)、[Playwright](https://playwright.dev)、[Maestro](https://github.com/mobile-dev-inc/maestro)、[Schemathesis](https://github.com/schemathesis/schemathesis)、[Gitleaks](https://github.com/gitleaks/gitleaks)、[OSV-Scanner](https://google.github.io/osv-scanner/)、[Trivy](https://trivy.dev)、[OpenSpec](https://github.com/Fission-AI/OpenSpec)、[Beads](https://github.com/steveyegge/beads)、[Biome](https://biomejs.dev) 与 [ast-grep](https://ast-grep.github.io)。
