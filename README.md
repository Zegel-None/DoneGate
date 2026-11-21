# DoneGate（完工门）0.4.0

**一句话**：用 AI 做项目时，把「AI 嘴上说做完了」变成**「从前期规划到后期维护，每一步都有硬门禁拦着、有真凭实据给你看」**。

**它是两层，不是一个包：**

- **底座 · 防伪裁判**：零依赖的判定核只认冻结的判据与真实运行证据，外部工具一律只能「上交观测」、无权下结论。这一层管的是**不许假绿**。
- **工坊 · 搭积木**：遇到长尾技术栈（iOS / Rust / 嵌入式 / 桌面端），`donegate-forge` 带你按固定六步把外部开源工具造成一块能入网、能淘汰的砖：调研选型 → 按协议写适配器 → 三组必红夹具 → 登记与 3 批淘汰。这一层管的是**你自己就能扩展它，不用改判定核一行代码**。

**与同类「AI 工程技能包」的差别，说清楚**：它们大多本质是 Markdown 剧本——强在广度，弱在无法判定「到底做完没有」。DoneGate 不跟它们比广度，**比的是两件它们给不了的事**：① 每一句「做完了」都要过一次真实运行与冻结判据；② 这套判定核是**可插拔**的，任何人能按协议往里加砖，而不是只能等作者更新。

---

## 你是不是也遇到过这些事？

- **开工前没想清楚**，AI 写到一半才发现和昨天说好的不是一回事，越改越乱。
- **AI 自信满满地说「全搞定了」**，你一打开页面还是报错，或者修好新功能却把老功能弄坏了。
- **让你跑个测试，它专挑简单的测**，或者干脆在写完代码之后把测试改松来凑通过。
- **做了一两周、换了十几次对话之后**，谁也不记得哪些功能真测过、哪些只是 AI 觉得「应该没问题」。

**DoneGate 就是来管这件事的。** 它不负责让你写代码更快，它负责让你**少返工、少踩假完成的坑**。

---

## 它覆盖一个项目的全周期

DoneGate 把「技能说明书 + 我们自研的零依赖检查内核与门禁脚本 + 外部专业工具」串成一条完整的验收流水线，覆盖从**立项到维护**的每一步：

1. **前期拷问澄清与定底线**
   开工前，AI 不会瞎猜需求，而是先像产品面试官一样逐个追问关键边界（`grill-me` 决策树拷问法，附推荐选项让你快速拍板）；改老项目时还会先用 `CodeGraph` 摸清现有模块结构。确认清楚后用人话把「要做成什么样」「哪些底线绝对不能碰」锁进文件，条件允许时再由零上下文独立视角挑一遍毛病。
2. **任务排序，不乱开工**
   需求一多容易东一榔头西一棒槌。先把要做的事按先后依赖排好序，每次只专注做眼下最该做的那一小块。
3. **先定验收标准，再写代码**
   每做一块功能前，AI 先和你确认「做成什么样才算过、用什么命令检查」，并把标准**锁死**。写代码过程中不许临时改标准——想偷改会被内核当场拦下。
4. **改了这里，查查有没有弄坏别处**
   代码写完后，不只看新功能跑通没，还要查**影响面**——这次改动牵连到了哪些旧模块、有没有引入循环依赖或越界引用，被牵连到的老功能会自动标成「待重验」，必须重新跑过才算完。
5. **挤干测试和代码里的水分**
   - **查测试是不是摆设**：故意把代码改坏一点，看测试能不能抓出来——抓不出来的绿灯不算数。
   - **代码与安全体检**：查有没有漏进代码里的 API Key / 密码、有没有带已知漏洞的第三方包、有没有到处复制粘贴的重复代码、代码结构有没有越写越绕。
6. **叫第二个独立 AI 来查账（`/donegate-judge`）**
   不放心干活的 AI？手打 `/donegate-judge` 叫来一个全新的独立 AI。门禁脚本会提前把干活 AI 的废话和思路草稿过滤掉，只把原始验收标准、代码改动和实际运行输出交给它，只给你三个回答：**通过 / 不通过 / 证据不够**。
7. **交接、查总账与长期维护**
   换新对话、或者隔了几天回来继续做时，一键打包交接清单，清楚列出「哪些已通过、哪些没测、哪些因为别的改动过期了要重测」；不再需要的旧功能也能干净退场。

---

## 怎么安装（两种方式）

### 方式一：让你的 AI Agent 帮你全自动装好（推荐）

不用自己一行行敲命令。本项目深度绑定 **DeepSeek Harness (`dsh web`)** Web UI 生态（Windows 优先，无桌面端包袱）。把下面这段话**原封不动发给你的 DeepSeek Harness 会话**，它会自动检查本机环境、克隆项目、挂载技能、安装所有需要的外部工具（「砖头」），最后跑通自检向你汇报：

> 请帮我完整安装并配置 **DoneGate**（仓库地址：`https://github.com/q862877400-ux/DoneGate.git`）：
> 1. 检查本机 `node`（建议 v20+）、`git`、`npm`、`python` / `uv`、`go` 等基础环境是否就绪。
> 2. 把 DoneGate 克隆到一个干净的技能目录（例如 `D:\skills\DoneGate` 或 `~/skills/DoneGate`，注意不要多套一层目录，根目录必须直接看到 `donegate/`、`donegate-judge/`、`donegate-forge/`）。
> 3. 运行仓库根目录的 `install-dsh-web.cmd`（或 `node runner/dsh/install-dsh-web.mjs`）一键生成符合 DSH 创造模式（`dsh-doc`）规范的 `@local/dsh-donegate` Web 插件包并挂载到 `web` Profile（也可在 DSH Web 左栏「插件 > 添加插件」直接选择 `.donegate/dsh-bundle/dsh-donegate` 本地目录安装）。
> 4. 进入克隆好的 DoneGate 目录，按需运行 `npm install`（用于安装可选的 `vitest` 和 `stryker`）。
> 5. 逐个检查并尽量帮我装好配套外部工具（「砖头」，按需用于全周期不同阶段）：`codegraph`、`dependency-cruiser`（`depcruise`）、`jscpd`、`knip`、`@fission-ai/openspec`、`gitleaks`、`osv-scanner`、`dotenv-linter`、`trivy`、`beads`（`bd`）、`srclight`、`schemathesis`、`playwright`、`maestro`、`fuck-u-code`、`@biomejs/biome`、`@ast-grep/cli`（以及阶段 2 编码可选的 Context7 MCP）；遇到本机缺包管理器装不上的，如实列出原因和手动装法，不要假装装好。
> 6. 最后在 DoneGate 目录下跑完 `node skill/check-escapes.mjs --self-check`、`node runner/self-test.mjs` 与 `node runner/dsh-fixtures.mjs`，把每一项的实际结果汇报给我。

---

### 方式二：自己用命令行安装

#### 第一步：装好 DoneGate 本体

```powershell
# 1. 克隆到本地（注意不要多套一层目录）
git clone https://github.com/q862877400-ux/DoneGate.git D:\skills\DoneGate
cd D:\skills\DoneGate

# 2. （可选）装上测试与变异测试引擎（Vitest + StrykerJS）；本体内核与门禁零依赖，不装也能跑
npm install
```

然后在 DSH 的配置文件（`%DSH_HOME%\profiles\web\cordis.patch.yml`，没有就新建）里挂上技能目录，保存后重启 DSH：

```yaml
- id: skill
  config:
    customSkillDirs:
      - D:\skills\DoneGate
```

#### 第二步：快速装好全套外部工具（「砖头」，按需安装）

DoneGate 的判定内核与全部门禁脚本都是**自研且零第三方依赖**的；下面这些是配套干苦力的开源外部工具，按你的系统和需求用一条命令装好即可：

```powershell
# 1. Node / npm 生态一把装（架构边界 + 重复代码 + 死依赖清理 + 规格提案 + Web E2E + 静态检查 + 结构搜索）
npm install -g dependency-cruiser jscpd knip @fission-ai/openspec playwright @biomejs/biome @ast-grep/cli

# 2. Windows 常用二进制（密钥扫描 + 漏洞扫描 + .env 体检 + 安全配置扫描；macOS 可改用 brew）
winget install Gitleaks.Gitleaks
winget install Google.OSVScanner
winget install AquaSecurity.Trivy
# dotenv-linter 可从官方 GitHub Releases 下载并放到 PATH 中

# 3. Python 生态（代码索引新鲜度 + API 边界模糊测试；需先有 uv）
uv tool install srclight
uv tool install schemathesis

# 4. Go 生态（代码复杂度体检；需先有 Go）
go install github.com/Done-0/fuck-u-code/cmd/fuck-u-code@latest
```

另外四块工具建议按官方文档按需安装：
- **CodeGraph**（规划摸底 + 影响面与循环依赖）：按 [CodeGraph](https://github.com/colbymchenry/codegraph) 官方发布安装 `codegraph` CLI。
- **Maestro**（Android / iOS 本地模拟器 UI 测试）：按 [Maestro](https://github.com/mobile-dev-inc/maestro) 官方发布安装 `maestro` CLI（依赖 JDK 17+）。
- **Beads (`bd`)**（超长项目任务排序）：按 [Beads](https://github.com/steveyegge/beads) 官方说明安装 `bd` CLI。
- **Context7 MCP / EGM (`dsh-egm`)**：编码期防幻觉 API 可选配 [Context7](https://github.com/upstash/context7) MCP；前期零上下文方案评审可通过 DSH 安装 EGM。

> **提示**：不装上面这些外部工具，DoneGate 的内核、门禁脚本和纯技能流程一样能用（配合你项目自带的测试命令即可）；装了哪几块，就能多出哪几块全自动体检能力。

---

## 平时怎么用

装好之后，直接用自然语言跟 AI 对话就行（需要时 AI 会调用 `runner/donegate.mjs` 和各门禁脚本）：

- **立项 / 规划前**：「帮我把目标和绝对不能碰的底线先定下来」
- **写功能前**：「帮我定一下这轮的验收标准并锁死」
- **AI 说做完时**：「这轮做完了吗？」/「改这里影响了哪些老功能，都重新验了吗？」
- **找第二个 AI 复核时**：直接输入 `/donegate-judge`
- **想给新工具/新技术栈加砖时**：叫 **`donegate-forge`**——「把这个工具接进来」「帮我接 Rust / iOS / 嵌入式」；它会先调研值不值得接，再按协议写适配器、配三组必红夹具，最后登记入网并接受淘汰考核
- **换新对话 / 收尾时**：「帮我做个交接，列出已通过和还没测的」

命令行常用入口（在你的项目目录下调用）：

```text
node <DoneGate路径>/runner/donegate.mjs --help   # 查看全部 12 条命令
```

---

## 装完自检

在 `DoneGate` 目录下运行下面几条命令，全部通过就说明文件完整、内核正常、AI 也能正常加载：

```text
node skill/check-escapes.mjs --self-check  # 一键检查技能加载、模块完整性、工坊卡与回归门禁
node runner/self-test.mjs                  # 检查零依赖判定核四值退出码与防撒谎哈希链
node runner/dsh-fixtures.mjs               # 检查 DSH Web 插件包规范与 Windows 跨平台路径适配
node runner/donegate.mjs --help            # 检查判定核 12 条命令是否可执行
```

---

## 全绿还是出了 Bug？漏网门禁与社区共建

最怕的不是报错，而是**「整套检查都亮绿灯，结果一上手还是有 bug」**。DoneGate 内置了一套 **漏网之鱼（Escaped-Bug）门禁闭环**（`skill/check-escapes.mjs`）：

1. **不只是修这一个点**：一旦遇到「全绿却踩坑」，修完当前问题后，必须顺藤摸瓜找出**深层根因**，并把项目里所有同款隐患一起清掉。
2. **加一条永久门禁**：把复现条件写成一条独立检测，登记进项目的 `.donegate/escapes.jsonl`，防止同款坑以后再过绿灯。
3. **改完先自我核查一遍，全绿才准提交**：防止模型补门禁时把项目本身或现有检查改崩，提交生效前必须运行：
   `node <DoneGate路径>/skill/check-escapes.mjs --self-check --project .`
   把所有门禁、硬编码扫描和状态计算从头核查一遍，全绿才准 `git commit`。
4. **如果你有 GitHub，欢迎随手提个 Issue**：要是盲区出在 DoneGate 自己身上，可以直接运行下面的命令生成一份**已脱敏的反馈草稿**（如果你本机登录了 `gh` CLI，AI 也能经你确认后直接帮你发到 GitHub）：

```text
node <DoneGate路径>/skill/check-escapes.mjs --report-template
```

> **众人拾柴火焰高——你踩过的坑反馈上来，修成一条新门禁，下次拉取更新时所有人的成果都能直接为你守门。欢迎到 [GitHub Issues](https://github.com/q862877400-ux/DoneGate/issues/new) 提一条反馈，你也来添一把柴！**

---

## 用之前先说实话（能力边界）

- **它管不住「AI 偷懒挑简单题测」**：如果 AI 把检查范围划得很窄，只测最容易过的部分，检查虽然全绿，漏掉的地方还是会坏。
- **它不提升写代码速度，也不保证 AI 天生老实**：它的作用是把每一步的门禁卡死、把证据摆在明面上，方便你和独立 AI 核对。

---

## 仓库里有什么

| 目录 / 文件 | 是什么 |
|---|---|
| `donegate/` | 主技能：带 AI 走完定标准、防改坏、留证据、做交接的全流程 |
| `donegate-judge/` | 独立复核技能：只用 `/donegate-judge` 触发，冷酷查账 |
| `donegate-forge/` | 搭积木工坊：把外部开源工具造成能入网的砖（调研选型 → 按协议写适配器 → 三组必红夹具 → 登记与 3 批淘汰） |
| `runner/` | **自研判定核**（零依赖 Node.js）：命令入口、状态计算、防篡改账本、隔离与越界拦截、交接与复核包生成 |
| `install-dsh-web.cmd` | **Windows 一键安装器**：免编译生成并挂载 `@local/dsh-donegate` Web 插件包 |
| `skill/` | **自研硬门禁脚本**（提交前反作弊、模块完整性、复核包白名单、阶段卡控、漏网闭环等）+ 22 个外部工具适配器（`adapters/`） |
| `adapters.registry.json`、`ledger.json`、`batches.jsonl`、`escapes.jsonl` | 外部工具适配器的注册表、砖头台账与历史漏网门禁台账 |
| `README.md`、`CHANGELOG.md`、`VERSION`、`LICENSE` | 本说明、更新记录、版本号、MIT 开源协议 |

---

## 依赖项目与致谢

DoneGate 的全周期验收思路与配套工具链，站在下面这些优秀的开源项目肩膀上；在此一并声明依赖并致谢：

- **[StrykerJS](https://github.com/stryker-mutator/stryker-js)** — 变异测试框架，用来验证测试「有没有牙」，是防止假绿灯最核心的一块砖。
- **[CodeGraph](https://github.com/colbymchenry/codegraph)** — 代码知识图谱与影响面分析，规划期看清结构、改动后找出受牵连模块与循环依赖。
- **[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)** — 模块依赖边界检查，防止代码越写越乱。
- **[Knip](https://knip.dev)** — 查找并清理 JS/TS 项目中装了却没用、或导出了无人引用的死代码与依赖。
- **[Playwright](https://playwright.dev)** — Web 真实浏览器端到端验收，真实点击网页并核对控制台报错。
- **[Maestro](https://github.com/mobile-dev-inc/maestro)** — 极简 YAML 驱动的本地 Android / iOS 模拟器 UI 流程测试。
- **[Schemathesis](https://github.com/schemathesis/schemathesis)** — 依据 OpenAPI / GraphQL 文档自动对后端接口做边界异常压测。
- **[Trivy](https://github.com/aquasecurity/trivy)** — 文件系统、Dockerfile 与 IaC 安全配置及漏洞扫描。
- **[dotenv-linter](https://github.com/dotenv-linter/dotenv-linter)** — 检查 `.env` 语法、重复键及与 `.env.example` 的差异，防环境漏配。
- **[Beads](https://github.com/steveyegge/beads)** — 面向 AI 编程的任务依赖图与优先级排序工具。
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** & **[Spec Kit](https://github.com/github/spec-kit)** — 轻量规格驱动开发工作流，启发并支撑了前期的变更提案与规格梳理。
- **[Gitleaks](https://github.com/gitleaks/gitleaks)** — 静态密钥扫描，守住不把密码和 Token 写进仓库的底线。
- **[OSV-Scanner](https://github.com/google/osv-scanner)** — Google 开源的依赖漏洞扫描器，核验第三方包安全。
- **[jscpd](https://github.com/kucherenko/jscpd)** — 跨文件代码克隆检测。
- **[Srclight](https://github.com/srclight/srclight)** — 带索引新鲜度标识的代码检索服务。
- **[fuck-u-code](https://github.com/Done-0/fuck-u-code)** — 代码复杂度与坏味道体检工具。
- **[Context7](https://github.com/upstash/context7)** — 编码期按库版本拉取真实 API 文档的 MCP 工具，减少接口幻觉。
- **[Vitest](https://github.com/vitest-dev/vitest)** — 现代前端与 Node 测试运行器。
- **[Biome](https://biomejs.dev)** — JS/TS 静态检查与格式化，给出「可疑写法」的机器读数（工坊首批示范砖之一）。
- **[ast-grep](https://github.com/ast-grep/ast-grep)** — 按语法结构搜索代码，能表达「所有 console.log」这类形状（工坊首批示范砖之一）。

同时也感谢 **[grill-me](https://github.com/mattpocock/skills)** 的决策树追问思路以及 **Elephant-Goldfish Model (EGM)** 的零上下文评审思路对前期设计与方案审查环节的启发。

---

## 版本与开源协议

当前版本见同目录 `VERSION`，更新记录见 `CHANGELOG.md`。本项目按 **MIT** 协议开源（见 `LICENSE`）。
