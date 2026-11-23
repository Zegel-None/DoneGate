---
name: donegate-forge
description: >-
  扩展工坊（开源工具适配与卡片/工作流封装技能）：给 DoneGate 接入外部项目、提取节点卡片或编排多阶段工作流时用。
  用户说「把这个 GitHub 项目接进来」「提取成卡片」「写个适配器」「加工作流」「带 UI / 无二进制项目怎么接」时用。
  覆盖六类形态：诊断探针、工件生成、带 UI 去壳提取、运行时服务、无二进制规则包、覆盖族归并。
  NOT for: 日常判「这轮做完没有」（用 donegate）；独立盲审（用 donegate-judge）；仅修改判定核内部算法。
---

# DoneGate 扩展工坊（Forge · 工具适配与节点封装标准）

## 零、定位与原则

外部开源工具（CLI、生成器、带 Web UI 应用、常驻服务、纯规则文档）统一经**「薄适配器 + 节点能力声明」**接入判定核与工作台，严守底线、放开形态：
- **三条底线**：① 适配器只产客观观测与工件，禁输出 `verdict / passed / score` 等业务结论；② 退出码仅限 `0（产出声明）/ 2（协议事故）/ 3（无法判断）`；③ 必填 `blindSpots`，全部输入输出计算 64 位裸 SHA-256。
- **形态自由**：支持 CLI、无头导出、HTTP 快照、静态产物与纯规则包，不限语言，支持 `1–20` 阶段工作流，纯 JSON 声明免改前端源码。

## 一、四条边界

1. **只产声明不产状态**（adr/002（调研/评审材料，不在公开分发包内））：`claim.json` 含状态禁词直接退 `2`。
2. **适配器永不返回 `1`**：上游检出的违例或差异如实写入 `observation.json`、`artifacts[]`、`claims[]` 并退 `0`，由判定核或观测断言裁决。
3. **去壳取核**：带 UI 项目按「无头导出 → HTTP 快照 → 落盘文件」提取数据，禁 fork 或在画布内嵌外部前端页面。
4. **互补并存、重复二选一**：数据源/对象/语言/精度互补可组「覆盖族」配归并节点；四维完全重合才淘汰。

## 二、路由导航

| 任务 | 操作卡 | 依据 |
|---|---|---|
| 评估准入价值、区分互补覆盖族与重复工具 | [`references/卡-选型调研.md`](references/卡-选型调研.md) | `skill/15` （私有仓）§一、§二；P1–P4 |
| 将任意形态项目抽成画布节点卡片与工作流 | [`references/卡-普适提取与卡片封装.md`](references/卡-普适提取与卡片封装.md) | 六类形态、`bricks/` 与 `workflows/` |
| 按适配器协议编写薄适配器 | [`references/卡-适配器实现.md`](references/卡-适配器实现.md) | `skill/17` §二、§三、§八 |
| 编写三组必红夹具验证异常与越权拦截 | [`references/卡-三组必红夹具.md`](references/卡-三组必红夹具.md) | `skill/17` §七 |
| 登记注册表与台账，执行准入与三批淘汰 | [`references/卡-准入与登记.md`](references/卡-准入与登记.md) | `skill/17` §七；`skill/15` （私有仓）§四 |
| 查看端到端接入实例 | [`references/卡-首批示范.md`](references/卡-首批示范.md) | `biome` 适配器完整链路 |

## 三、固定六步流程

1. **栈盘点与缺口框定**：写清缺哪项观测或工件、当前兜底方式、服务哪条判据或下游节点，并按 P4 列出不覆盖项。
2. **候选调研**：核查 LICENSE、活跃度与提取面（CLI / HTTP / 产物 / 规则包），标注【实测】或【盘上】；互补工具规划覆盖族归并。
3. **选型判定**：归入六类形态（`scanner` / `generator` / `ui-extract` / `runtime-service` / `knowledge-skill` / `aggregator`），确定去壳方式。
4. **造适配器**：运行 `node skill/new-adapter.mjs <tool> --archetype <形态>` 生成 `<=45` 行薄适配器与 `bricks/<tool>/capabilities.json`，按需编写 `workflows/<id>.workflow.json`。
5. **三组必红夹具**：覆盖映射反转必红、输入缺失退 `3`、产物截断退 `3` 及非法 `--registry-id` 退 `2`。
6. **登记与准入**：写入 `adapters.registry.json`、`bricks/<tool>/capabilities.json`、`ledger.json`（未绑硬判据标 `advisory`），跑绿 `check-declarations`、`check-brick-capabilities`、`check-brick-liveness`。

## 四、交付清单

```text
① 形态声明：形态=<archetype>；提取面=<CLI/HTTP/产物/规则包>；不覆盖=<blindSpots>
② 节点落盘：bricks/<tool>/capabilities.json + 可选 workflows/<id>.workflow.json
③ 门禁全绿：new-adapter / check-declarations / check-brick-capabilities / check-escapes --self-check 全退 0
```

## 五、延伸索引

| 主题 | 文档 |
|---|---|
| 六类形态提取与节点端口定义 | [`references/卡-普适提取与卡片封装.md`](references/卡-普适提取与卡片封装.md) |
| 九字段声明、免二进制模式与阶段规范 | [`skill/17-适配器协议.md`](../skill/17-适配器协议.md) |
| 适配器禁产状态原则 | `设计/adr/002-适配器只产声明不产状态.md` （私有仓）|
| 声明校验与工作台注水实现 | `skill/check-declarations.mjs`、`runner/atlas/hydrate-workbench.mjs` |

**诚实边界**（adr/007（调研/评审材料，不在公开分发包内））：本标准保证外部工具统一无侵入接入，但不替代人类对交互体验与业务架构的价值裁决；不可逆节点仍须保留人工闸门。
