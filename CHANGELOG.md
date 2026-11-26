# Changelog

## 1.0.0

- **严格单向无环分层架构与 100% 零复杂度超标**：剥离 L0 共享原语底座（`runner/shared/`）、纯化 L1 无头判定核（`runner/core/`）、独立 L5 变焦驾驶舱（`runner/cockpit/`）并将 DSH 编排拆分为 `deps/` · `uiboard/` · `autopilot/` · `host/` 四个高内聚子域；全仓 215 个 JS/TS 文件认知复杂度 100% ≤ 25，全跨层强制走公共门面且 10 条分层铁律 0 违规。
- **变焦驾驶舱分层节奏升级**：`donegate brief` 展示无环 DAG 健康标、`[L0]–[Ln]` 分层徽章与 10 格容量水位条；`donegate graph` 输出分层 `subgraph` 金字塔 Mermaid 拓扑图。
- **Python 一等公民 + OpenSpec 双轨探索态 + 独占资源混合挂机调度**：31 个外部确定性工具适配器（含 `ruff` / `ty` / `complexipy` / `import-linter` / `pytest`）、`contract new --explore` / `contract promote` 探索双轨，以及纯代码 Worktree 并行 + 桌面/硬件独占资源宿主机串行混合调度。
- **36 项控制面安全与防伪加固**：本地控制面会话令牌与 Loopback Host/Origin 守卫、SSRF 代理防护、路径穿越阻断、门 5 多模型共识与 Held-Out 防篡改验真。
- **零代码一站式安装验真与无限画布工作台**：`node skill/verify-install.mjs --install` 六道防撒谎真机验真回执、Louvain 自适应无限画布、DSH 子智能体人机直聊隔离锁与共享依赖池 `npm-cells/<id>/`。
