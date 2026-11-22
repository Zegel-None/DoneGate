# 软件开发十阶段预置工作流架构规范与调研评审重构说明

本文档记录完结门工作台（DoneGate v0.4）如何吸收《软件开发十阶段：通用复用底座 + 覆盖族 + 流程控制层 + 实践者经验》调研草图的合理内核，修正其与确定性契约工作台冲突的 7 处工程硬伤，并落地为 [`workflows/`](./README.md) 下 **8 条可热插拔、支持懒加载依赖与断点挂机的声明式开发流**。

---

## 一、对原十阶段调研草图的工程评审（哪些对、哪些必须改）

### 1.1 原调研判断准确、予以完整保留的四大设计内核

1. **单一真值原则（P3）与互补覆盖族（P2）区分清晰**：
   - 数据库迁移工具（`flyway` vs `atlas`）属于**状态真值族**：同一仓库只准认领一个主真值（如 `flyway` 版本脚本），另一方（`atlas`）只能以 `schema diff` / `migrate lint` **只读对账**，严禁双写迁移表。
   - 漏洞与安全扫描（锁文件 `osv-scanner`、容器与 IaC `trivy`、源码 SAST `semgrep`）属于**检测覆盖族**：数据源正交互补，必须并联采集后统一去重，而不是只留一把漏检另一半。
2. **阶段 4「先定交互模式、再画界面」切中 AI 前端返工病根**：
   - 先盘点选项数、即时生效性、操作可逆性与五态（空态 / 加载 / 报错 / 无权限 / 正常），再生成 UI 代码，能直接消灭「把 3 个状态塞进下拉框」「危险可逆操作乱弹确认框」等典型 AI 界面通病。
3. **显式有限状态机 + 有上限回跳（`maxLoops`）+ 持久人工闸门（`human-gate`）**：
   - 拒绝无限重试空烧 Token；不可逆节点（契约冻结、破坏性 DDL、安全豁免、生产放量）必须硬挂起等人工拍板，且挂起期间零算力消耗。
4. **实证红线清醒（SusVibes & METR）**：
   - SusVibes（功能测试通过率 57% vs 安全率仅 11.8%）证明**功能测试全绿绝不等于安全过关**，阶段 7 安全流必须独立成流；METR 随机对照试验提醒严禁无度量空喊提速倍数。

### 1.2 原调研存在的 7 处工程缺陷及 DoneGate 重构方案

| 缺陷编号 | 原调研草图的问题 | DoneGate v0.4 落地重构方案 |
| :--- | :--- | :--- |
| **问题 1：75 节点大瀑布 vs 场景化任务流** | 把阶段 1→10 串成单条超长线性瀑布，甚至把「测试」排在阶段 2/3/4 写完数据库、后端、前端之后的阶段 5，违背契约驱动与增量红绿循环。 | 拆分为 **8 条 5–8 节点的高内聚场景流**（见 [`README.md`](./README.md)）：每条编码流内建静态类型/语法/有牙实验闭环，另提供 **0 外部依赖** 的 [`00-zero-dep-guardrail.workflow.json`](./00-zero-dep-guardrail.workflow.json) 开箱即跑。 |
| **问题 2：Agent 套娃与重型编排器叠床架屋** | 建议在工作台外再套一层 94k Star Docker 重容器 `OpenHands` 与 `Temporal` 集群，与完结门内核职责直接冲突。 | 直接复用完结门原生引擎：`runner/dsh/workflow-runner.mjs`（Git Worktree 零污染沙箱 + 材料指纹免跑缓存 + `maxLoops` 三重熔断）与 `runner/dsh/autopilot-state.mjs`（`MORNING-BRIEF.md` 早间简报断点续跑），零外部服务器依赖。 |
| **问题 3：反幻觉第一防线漏选静态类型与死代码积木** | 18 个底座工具漏掉了拦截 AI 幻觉最有效的**跨文件类型检查（`tsc`/`pyright`）**、**死代码与幽灵依赖清理（`knip`）**、**标识符拼写防滑移（`typos`）** 与 **CI 语法检查（`actionlint`）**。 | 在阶段 3（[`03-api-contract-and-fuzz.workflow.json`](./03-api-contract-and-fuzz.workflow.json)）与阶段 5/6（[`05-red-green-teeth-gate.workflow.json`](./05-red-green-teeth-gate.workflow.json)）前置接入 `pyright`、`knip`、`typos`、`depcruise`、`codegraph`、`actionlint`。 |
| **问题 4：阶段 7 堆砌 15 把扫描器导致超时与越权外连风险** | 将秒级 PR 扫描器与 GB 级慢扫（`dependency-check`、`CodeQL`）、主动外连验活（`trufflehog` 在线校验）、侵入式爬虫（`ZAP` 主动攻击）混在同一环节，必破 120s 确定性超时且易打坏测试库。 | 严格分层：**Tier-1 PR 快扫覆盖族**（`gitleaks` 离线规则 + `syft` SBOM + `osv-scanner` + `trivy` + `semgrep`）进默认流 [`06-security-coverage-family.workflow.json`](./06-security-coverage-family.workflow.json)；重型 CodeQL 与主动 DAST 置于末尾 `tpl-human-gate` 人工授权目标域名后按需触发。 |
| **问题 5：把常驻守护进程当成顺序流步骤** | 在阶段 8 与阶段 10 把 `prometheus`、`grafana`、`jaeger`、`argocd`、`flagger`、`chaos-mesh` 列为顺序节点，一旦常驻监听就会永久卡死工作流游标。 | 严格执行 [`../donegate-forge/references/卡-普适提取与卡片封装.md`](../donegate-forge/references/卡-普适提取与卡片封装.md) 的 `runtime-service` **单次探针化纪律**：节点只跑单次 `k6` 阈值压测或单次读取 Flagger Canary CRD 健康快照即刻返回 `0-3` 状态码，Grafana 面板通过卡片 `uiExternalUrl` 外链按需查看。 |
| **问题 6：重型 Web UI 项目未做「去壳取核」** | 直接引入 `penpot`、`storybook`、`allure2`、`docusaurus` 全套前端服务，破坏工作台一致性并拖慢执行。 | 全面实施 `ui-extract` **去壳取核**：例如阶段 4 中 `storybook` 节点只无头导出 `storybook-static/index.json` 校验每个组件是否齐备五态 Story，绝不在完结门内嵌 iframe 套壳。 |
| **问题 7：原调研留白的两个「无现成开源工具缺口」未落地** | 原文指出「多扫描器 `(包名, 版本, CVE)` 去重定级」与「交互控件映射矩阵检查」无现成轻量工具，仅停留在文字建议。 | 按适配器协议 v1.1（[`../skill/17-适配器协议.md`](../skill/17-适配器协议.md)）自研补齐两款**零外部二进制内置适配器节点**：[`ui-interaction-matrix.mjs`](../skill/adapters/ui-interaction-matrix.mjs)（`knowledge-skill`）与 [`vuln-merge.mjs`](../skill/adapters/vuln-merge.mjs)（`aggregator`），加上 [`syft-sbom.mjs`](../skill/adapters/syft-sbom.mjs) 与 [`semgrep-sast.mjs`](../skill/adapters/semgrep-sast.mjs)，全部 `<= 90` 行并接入 `adapters.registry.json`。 |

---

## 二、十阶段到八条预置工作流的映射矩阵

| 软件工程十阶段 | 对应预置工作流 | 关键收敛环（`tpl-router-rule`） | 不可逆人工闸门（`tpl-human-gate`） |
| :--- | :--- | :--- | :--- |
| **阶段 0 · 通用底座自检** | [`00-zero-dep-guardrail.workflow.json`](./00-zero-dep-guardrail.workflow.json) | 内置护栏 + UI 规则审查（`maxLoops: 2`） | 过夜挂机早间简报断点确认 |
| **阶段 1 · 需求澄清与架构立约** | [`01-spec-and-architecture.workflow.json`](./01-spec-and-architecture.workflow.json) | `openspec` 规格冲突打回重修（`maxLoops: 3`） | 契约 `scope[]` 与 ADR 冻结签字 |
| **阶段 2 · 数据库建模与迁移演进** | [`02-db-migration-rehearsal.workflow.json`](./02-db-migration-rehearsal.workflow.json) | `flyway` 真值演练 + `atlas` 漂移回修（`maxLoops: 3`） | 生产扩缩契约（Expand-Migrate-Contract）签字 |
| **阶段 3 · 后端接口契约与逻辑** | [`03-api-contract-and-fuzz.workflow.json`](./03-api-contract-and-fuzz.workflow.json) | `schemathesis` 500 反例自动回修（`maxLoops: 4`） | （纯确定性测试流，全绿直通） |
| **阶段 4 · 前端交互、五态与无障碍** | [`04-ui-interaction-and-a11y.workflow.json`](./04-ui-interaction-and-a11y.workflow.json) | `playwright` + Axe 无障碍联调回修（`maxLoops: 3`） | 16 条控件选型与 `uiboard` 审美方向冻结 |
| **阶段 5 & 6 · 有牙测试与代码审查** | [`05-red-green-teeth-gate.workflow.json`](./05-red-green-teeth-gate.workflow.json) | `stryker` 存活变异体补断言回修（`maxLoops: 3`） | （PR 自动化门禁流，存活变异 > 0 硬拦） |
| **阶段 7 · 供应链与代码安全覆盖族** | [`06-security-coverage-family.workflow.json`](./06-security-coverage-family.workflow.json) | `vuln-merge` 检出 P0 可达高危回修（`maxLoops: 3`） | 高危风险豁免签字 / 夜间深度 DAST 域名授权 |
| **阶段 8–10 · 性能、文档与灰度发布** | [`07-perf-docs-and-canary-release.workflow.json`](./07-perf-docs-and-canary-release.workflow.json) | `k6` P95/P99 退化超阈值回修（`maxLoops: 3`） | 生产环境金丝雀流量放量签字 |

---

## 三、新增四个适配器协议 v1.1 节点说明

1. **`ui-interaction-matrix@stage4`**（[`../bricks/ui-interaction-matrix/capabilities.json`](../bricks/ui-interaction-matrix/capabilities.json) · `knowledge-skill`）：
   - 内置 [`../bricks/ui-interaction-matrix/interaction-matrix.json`](../bricks/ui-interaction-matrix/interaction-matrix.json) 16 条控件映射规则（`UI-R01`–`UI-R16`）与 5 类必填页面状态，零外部二进制，核对 `--features-file` 中的控件反模式并锁定 SHA-256 证据。
2. **`vuln-merge@stage4`**（[`../bricks/vuln-merge/capabilities.json`](../bricks/vuln-merge/capabilities.json) · `aggregator`）：
   - 零外部二进制，消费 `osv-scanner`、`trivy`、`grype`、`pip-audit` 或通用漏洞 JSON，按 `package@version#vulnId` 跨源去重，保留最高严重度，并按 `高危 × 可达性 × 运行时依赖` 自动排定 `P0`–`P3` 修复优先级。
3. **`syft@stage4`**（[`../bricks/syft/capabilities.json`](../bricks/syft/capabilities.json) · `generator`）：
   - 驱动 Anchore Syft 生成标准 CycloneDX SBOM 清单并登记 `extraArtifacts` SHA-256，供下游覆盖族复用。
4. **`semgrep@stage4`**（[`../bricks/semgrep/capabilities.json`](../bricks/semgrep/capabilities.json) · `scanner`）：
   - 驱动 Semgrep 对目标目录（默认 `.`）执行快速多语言 SAST 扫描，统计 `ERROR` / `WARNING` 命中文件与行号。
