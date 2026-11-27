# Changelog

## 1.0.0

- **严格单向无环分层架构与 100% 零复杂度超标**：剥离 L0 共享原语底座（`runner/shared/`）、纯化 L1 无头判定核（`runner/core/`）、独立 L5 变焦驾驶舱（`runner/cockpit/`）并将 DSH 编排拆分为 `deps/` · `uiboard/` · `autopilot/` · `host/` 四个高内聚子域；全仓 JS/TS 源码认知复杂度 100% ≤ 25，全跨层强制走公共门面且 10 条分层铁律 0 违规。
- **图谱变焦驾驶舱与零依赖 MCP 服务**：内置入度阻尼 CBM 加权图个性化 PageRank 任务定位（`donegate locate`，Recall@5 较 `grep` 高 +18.3 pp，零词汇重叠隐藏依赖 64.7% vs 5.9%）、Agentless 骨架视图（`zoom --skeleton`，平均压缩 > 84%）、全视图 `--budget` 成本自报、多跳（≤3 跳）`impact` 测试反推、调用边三级置信度标注与 `donegate mcp` 零依赖 stdio MCP 服务。
- **声明式默认治理流与 33 个确定性工具适配器**：内置 `donegate flow` 五条官方默认治理流（Base+Overlay 编译、业主关闭防伪底线红字披露），接入 `oxlint` / `shellcheck` / `depcruise` / `ruff` / `ty` / `complexipy` / `import-linter` / `pytest` 等 33 个外部确定性工具适配器及头注自述防腐、布尔 `sort` 比较器拦截微门禁。
- **Python 一等公民 + OpenSpec 双轨探索态 + 独占资源混合挂机调度**：支持 `contract new --explore` / `contract promote` 探索双轨，以及纯代码 Git Worktree 并行 + 桌面/硬件独占资源宿主机串行混合调度。
- **36 项控制面安全加固与一站式安装验真**：本地控制面会话令牌与 Loopback Host/Origin 守卫、SSRF 代理防护、路径穿越阻断、门 5 多模型共识、Held-Out 防篡改验真、`node skill/verify-install.mjs --install` 六道防撒谎真机回执、Louvain 自适应无限画布与共享依赖池 `npm-cells/<id>/`。
