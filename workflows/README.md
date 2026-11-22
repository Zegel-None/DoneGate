# 声明式预置开发流目录（`workflows/` · 类 ComfyUI 轻量装配）

本目录存放完结门工作台（DoneGate v0.4）预置与自定义的声明式开发流定义文件（`<id>.workflow.json`），以及十阶段工作流装配规范 [`ARCHITECTURE-10-STAGES.md`](./ARCHITECTURE-10-STAGES.md)。

## 一、核心设计纪律：只装流拓扑与薄适配，不捆绑第三方仓库

1. **轻量化入库**：本目录仅提交轻量的 `<id>.workflow.json` 拓扑连线、阶段回跳上限（`maxLoops`）、人工闸门（`tpl-human-gate`）与依赖清单（`deps[]`），**绝不把外部开源项目的源码仓库、二进制包或虚拟环境塞进 Git 仓库**。
2. **缺依赖硬门禁（类 ComfyUI 缺模型禁跑）**：当某条开发流中未跳过（非 `bypassed`）的节点声明了外部开源工具且尚未就位时，预检引擎（`preflightWorkflowPack`）直接阻断运行（退 `3`），并在画布与左侧开发流列表中标出缺失项数量。
3. **行内按钮与右键菜单按需懒加载**：在完结门工作台左侧「开发流」列表中，点击任意开发流右侧的 **「补齐」** 按钮，或右键选择 **「一键补齐此开发流依赖」**，系统与后台 Agent 自动将该开发流所需的 GitHub 项目与环境依赖拉取至已加入 `.gitignore` 的隔离目录：
   - 存放路径：跨开发流共享底座池 `workflows/.deps/_shared/` 与单流隔离目录 `workflows/.deps/<workflowId>/`（内含 `repos/`、`npm/`、`venv/`、`.bin/`、`PROVISION-PLAN.json` 与 `manifest.json`）
   - 运行时注入：执行该开发流时仅向当前子进程注入 `workflows/.deps/<workflowId>/` 与 `workflows/.deps/_shared/` 可执行路径，零污染宿主系统全局环境。
4. **适配器协议 v1.1 与六大普适形态**：所有节点适配器严守 [`../skill/17-适配器协议.md`](../skill/17-适配器协议.md)（`<= 90` 行薄壳、三值适配器退出码 `0/2/3`、九字段 `claim.json` 哈希验真、零主观裁决禁词）与 [`../donegate-forge/references/卡-普适提取与卡片封装.md`](../donegate-forge/references/卡-普适提取与卡片封装.md)（重 UI 去壳取核 `ui-extract`、守护进程单次探针 `runtime-service`、内置规则卡 `knowledge-skill`、覆盖族归并卡 `aggregator`）。

---

## 二、预置八条全周期开发流一览

| 编号 | 开发流文件 | 覆盖阶段 | 外部依赖数 | 核心装配亮点 |
| :--- | :--- | :--- | :---: | :--- |
| `00` | [`00-zero-dep-guardrail.workflow.json`](./00-zero-dep-guardrail.workflow.json) | 全阶段底座 | **0（开箱即跑）** | 内置防 AI 手搓护栏 + [`ui-interaction-matrix`](../skill/adapters/ui-interaction-matrix.mjs) 16 条控件规则 + 2 轮熔断路由 + 过夜挂机人工审批闸门 |
| `01` | [`01-spec-and-architecture.workflow.json`](./01-spec-and-architecture.workflow.json) | 阶段 1（需求与架构） | 3（按需补齐） | `srclight` 代码原语索引校验 → `openspec` 规格审校（3 轮收敛）→ `beads` 只读 DAG 拓扑拆解 → 立约冻结闸门 |
| `02` | [`02-db-migration-rehearsal.workflow.json`](./02-db-migration-rehearsal.workflow.json) | 阶段 2（数据库演进） | 3（按需补齐） | 恪守单一真值：`sqlfluff` 锁表审计 → `flyway` 唯一迁移真值正反向演练 → `atlas` 只读漂移对账 → DBA/业主审批闸门 |
| `03` | [`03-api-contract-and-fuzz.workflow.json`](./03-api-contract-and-fuzz.workflow.json) | 阶段 3（后端契约与接口） | 5（按需补齐） | `spectral` OpenAPI 契约先行 → `pyright` + `ruff` 反幻觉护栏 → `schemathesis` 属性 Fuzz 猎杀 500（4 轮回修）→ `hurl` 多步业务链路断言 |
| `04` | [`04-ui-interaction-and-a11y.workflow.json`](./04-ui-interaction-and-a11y.workflow.json) | 阶段 4（前端交互与无障碍） | 4（按需补齐） | 先定交互再画界面：`ui-interaction-matrix` 控件与五态卡 → 人工设计冻结 → `storybook` 去壳无头 `index.json` 提取 → `biome`+`knip` → `playwright`+Axe → `lighthouse` |
| `05` | [`05-red-green-teeth-gate.workflow.json`](./05-red-green-teeth-gate.workflow.json) | 阶段 5 & 6（有牙测试与审查） | 6（按需补齐） | 内置防手搓 → `biome` → `typos` 标识符防滑移 → `depcruise` 模块分层边界 → `codegraph` 改动波及图 → `stryker` 变异测试有牙实验 → `actionlint` |
| `06` | [`06-security-coverage-family.workflow.json`](./06-security-coverage-family.workflow.json) | 阶段 7（安全覆盖族） | 5（按需补齐） | `gitleaks` → [`syft`](../skill/adapters/syft-sbom.mjs) CycloneDX SBOM → `osv-scanner` + `trivy` + [`semgrep`](../skill/adapters/semgrep-sast.mjs) → 内置 [`vuln-merge`](../skill/adapters/vuln-merge.mjs) 跨源去重与 P0-P3 定级 → 授权闸门 |
| `07` | [`07-perf-docs-and-canary-release.workflow.json`](./07-perf-docs-and-canary-release.workflow.json) | 阶段 8–10（压测、文档与发布） | 5（按需补齐） | `k6` 单次阈值压测探针（3 轮回修）→ `vale`+`lychee` 术语与死链核验 → `git-cliff` 真实提交变更日志 → 人工灰度放量闸门 → `flagger` 金丝雀单次健康快照 |
