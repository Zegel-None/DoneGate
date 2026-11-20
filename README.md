# DoneGate（完工门）0.2.0

**一句话**：用 AI 做项目时，把「AI 嘴上说做完了」变成**「从前期规划到后期维护，每一步都有硬门禁拦着、有真凭实据给你看」**。

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

1. **前期规划与定底线**
   开工前，先用人话写清楚「这个项目要做成什么样」「哪些底线绝对不能碰」（比如不能删老数据、不能改某个核心接口）。条件允许时，先让一个没有历史包袱的独立视角帮你审一遍方案，再动手。
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

不用自己一行行敲命令。把下面这段话**原封不动发给你的 Agent**（DSH / Claude Code / Cursor 等），它会自动检查本机环境、克隆项目、挂载技能、安装所有需要的外部工具（「砖头」），最后跑通自检向你汇报：

> 请帮我完整安装并配置 **DoneGate**（仓库地址：`https://github.com/q862877400-ux/DoneGate.git`）：
> 1. 检查本机 `node`（建议 v20+）、`git`、`npm`、`python` / `uv`、`go` 等基础环境是否就绪。
> 2. 把 DoneGate 克隆到一个干净的技能目录（例如 `D:\skills\DoneGate` 或 `~/skills/DoneGate`，注意不要多套一层目录，根目录必须直接看到 `donegate/` 和 `donegate-judge/`）。
> 3. 如果我在用 DSH，把该目录加到 `%DSH_HOME%\profiles\web\cordis.patch.yml` 的 `skill.config.customSkillDirs` 中（其他宿主请按对应技能目录规范挂载）。
> 4. 进入克隆好的 DoneGate 目录，按需运行 `npm install`（用于安装可选的 `vitest` 和 `stryker`）。
> 5. 逐个检查并尽量帮我装好配套外部工具（「砖头」）：`codegraph`、`dependency-cruiser`（`depcruise`）、`jscpd`、`@fission-ai/openspec`、`gitleaks`、`osv-scanner`、`beads`（`bd`）、`srclight`、`fuck-u-code`；遇到本机缺包管理器（如没装 Go/uv）装不上的，如实列出原因和手动装法，不要假装装好。
> 6. 最后在 DoneGate 目录下依次跑完：`node tools/check-package.mjs`、`node tools/verify-spec.mjs`、`node tools/check-rot.mjs`、`node skill/check-skills.mjs --root .` 以及 `node runner/donegate.mjs --help`，把每一项的实际结果汇报给我。

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
# 1. Node / npm 生态一把装（架构边界 + 重复代码 + 规格提案 + 规格工具）
npm install -g dependency-cruiser jscpd @fission-ai/openspec

# 2. Windows 常用二进制（密钥扫描 + 漏洞扫描；macOS 可改用 brew install gitleaks osv-scanner）
winget install Gitleaks.Gitleaks
winget install Google.OSVScanner

# 3. Python 生态（代码索引新鲜度；需先有 uv 或 pip）
uv tool install srclight

# 4. Go 生态（代码复杂度体检；需先有 Go）
go install github.com/Done-0/fuck-u-code/cmd/fuck-u-code@latest
```

另外三块工具建议按官方文档安装：
- **CodeGraph**（影响面与循环依赖）：按 [CodeGraph](https://github.com/colbymchenry/codegraph) 官方发布安装 `codegraph` CLI（支持一键接入各主流 AI Agent）。
- **Beads (`bd`)**（任务依赖排序）：按 [Beads](https://github.com/steveyegge/beads) 官方说明安装 `bd` CLI。
- **EGM (`dsh-egm`)**（前期零上下文评审）：通过 DSH 插件市场安装。

> **提示**：不装上面这些外部工具，DoneGate 的内核、门禁脚本和纯技能流程一样能用（配合你项目自带的测试命令即可）；装了哪几块，就能多出哪几块全自动体检能力。

---

## 平时怎么用

装好之后，直接用自然语言跟 AI 对话就行（需要时 AI 会调用 `runner/donegate.mjs` 和各门禁脚本）：

- **立项 / 规划前**：「帮我把目标和绝对不能碰的底线先定下来」
- **写功能前**：「帮我定一下这轮的验收标准并锁死」
- **AI 说做完时**：「这轮做完了吗？」/「改这里影响了哪些老功能，都重新验了吗？」
- **想找第二个 AI 复核时**：直接输入 `/donegate-judge`
- **换新对话 / 收尾时**：「帮我做个交接，列出已通过和还没测的」

命令行常用入口（在你的项目目录下调用）：

```text
node <DoneGate路径>/runner/donegate.mjs --help   # 查看全部 12 条命令
```

---

## 装完自检

在 `DoneGate` 目录下运行下面几条命令，全部通过就说明文件完整、内核正常、AI 也能正常加载：

```text
node tools/check-package.mjs               # 检查目录结构和文档链接
node tools/verify-spec.mjs                 # 检查验收规则本身是否自洽
node tools/check-rot.mjs                   # 检查文档描述有没有过期
node skill/check-skills.mjs --root .       # 检查 AI 能不能正常加载这两个技能
node runner/donegate.mjs --help            # 检查判定核命令是否可执行
```

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
| `runner/` | **自研判定核**（零依赖 Node.js）：命令入口、状态计算、防篡改账本、隔离与越界拦截、交接与复核包生成 |
| `skill/` | **自研硬门禁脚本**（复核包白名单、引用核查、阶段卡控、砖头淘汰等）+ 10 个外部工具适配器（`adapters/`） |
| `tools/` | 结构、规则、文档腐化自检脚本 |
| `设计/`、`参考/` | 背后的规则原文与依据（供 AI 按需查阅，平时不用自己翻） |
| `adapters.registry.json`、`ledger.json`、`batches.jsonl` | 外部工具适配器的注册表与使用台账 |
| `README.md`、`CHANGELOG.md`、`VERSION`、`LICENSE` | 本说明、更新记录、版本号、MIT 开源协议 |

---

## 依赖项目与致谢

DoneGate 的全周期验收思路与配套工具链，站在下面这些优秀的开源项目肩膀上；在此一并声明依赖并致谢：

- **[StrykerJS](https://github.com/stryker-mutator/stryker-js)** — 变异测试框架，用来验证测试「有没有牙」，是防止假绿灯最核心的一块砖。
- **[CodeGraph](https://github.com/colbymchenry/codegraph)** — 代码知识图谱与影响面分析，帮我们在改动后找出受牵连的模块与循环依赖。
- **[dependency-cruiser](https://github.com/sverweij/dependency-cruiser)** — 模块依赖边界检查，防止代码越写越乱。
- **[Beads](https://github.com/steveyegge/beads)** — 面向 AI 编程的任务依赖图与优先级排序工具。
- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** & **[Spec Kit](https://github.com/github/spec-kit)** — 轻量规格驱动开发工作流，启发并支撑了前期的变更提案与规格梳理。
- **[Gitleaks](https://github.com/gitleaks/gitleaks)** — 静态密钥扫描，守住不把密码和 Token 写进仓库的底线。
- **[OSV-Scanner](https://github.com/google/osv-scanner)** — Google 开源的依赖漏洞扫描器，核验第三方包安全。
- **[jscpd](https://github.com/kucherenko/jscpd)** — 跨文件代码克隆检测。
- **[Srclight](https://github.com/srclight/srclight)** — 带索引新鲜度标识的代码检索服务。
- **[fuck-u-code](https://github.com/Done-0/fuck-u-code)** — 代码复杂度与坏味道体检工具。
- **[Vitest](https://github.com/vitest-dev/vitest)** — 现代前端与 Node 测试运行器。

同时也感谢 **Elephant-Goldfish Model (EGM)** 的零上下文评审思路对前期方案审查环节的启发。

---

## 版本与开源协议

当前版本见同目录 `VERSION`，更新记录见 `CHANGELOG.md`。本项目按 **MIT** 协议开源（见 `LICENSE`）。
