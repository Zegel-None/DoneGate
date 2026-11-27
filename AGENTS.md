# AGENTS.md · AI 编码代理安装验真、三步聚焦冷启动、局部切片与守门规范

欢迎接入 **DoneGate（完结门）**。任何零记忆 AI 编码代理（DeepSeek Harness、Claude Code、Cursor、Codex、Windsurf、Trae、Gemini 等）替零编程基础的 Vibecoder 安装配置本工具、治理用户项目或扩展本仓时，**必须遵守以下防撒谎安装验真、三步聚焦图谱寻路与工程守门纪律**。

## 0. 替用户安装完结门时的第一铁律：裸机探测 + 真机防伪回执

1. **严禁假设用户电脑已有开发环境**：
   - 在全新 Windows 10/11 或 macOS 电脑上，先探测 `node`（需 `>= v18.20`，推荐 `v22 LTS`）、`npm` 与 `git`。
   - Windows 缺底座时优先用 `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements` 与 `winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements` 自动安装，并在当前终端**立即从注册表热刷新 `PATH`**（`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`），绝不允许把环境变量配置推给不懂编程的用户。
2. **必须跑通六道安装验真门禁才准交差**：
   - 克隆完成后，必须执行一站式安装排雷与真机验真命令：
     ```bash
     node "skill/verify-install.mjs" --install
     ```
   - 只要退出码不为 `0`，或未打印 `RESULT: PASS` 与 `DG-INSTALL-OK-` 防伪码，**严禁向用户声称「已安装完成」**；必须排障重跑至全绿，并将输出的 **【✅ 完结门安装验真回执】框** 原样贴给用户。

## 1. 项目施工第一铁律：三步聚焦掌控全局 · 区分双模式闭环

1. **三步聚焦按需寻路（`locate` → `zoom --skeleton` → `zoom --source`，禁一进仓盲扫全仓或全仓盲 `grep`）**：
   新开会话的主控代理或开源协作者先用内置驾驶舱（对接 `codebase-memory-mcp` MIT 持久化 SQLite 图谱，支持 `node runner/donegate.mjs mcp` stdio 服务）完成语义定位与骨架下钻，**最后一步再对锁定的 2~5 个目标精确行号直读源码真源**：
   ```bash
   # 第一步 · 任务定位与全局定向（PPR 图排序 + 全局根视口 + 跨文件多跳波及面雷达）：
   node runner/donegate.mjs locate "<任务描述>" [--budget 4000]
   node runner/donegate.mjs brief [--budget 4000]
   node runner/donegate.mjs impact <目标文件、符号、HTTP 路由、DOM ID 或配置文件名> [--budget 4000]
   # 第二步 · 骨架视图下钻（约 85% 压缩仅看签名/注释摘要，支持多目标并列传入）：
   node runner/donegate.mjs zoom <文件或符号1> [更多文件或符号...] --skeleton [--budget 4000]
   node runner/donegate.mjs zoom <01..05|rules|tests|gaps>
   # 第三步 · 最后一步按行直读真实源码（锁准具体文件与 [L起-L止] 区间后必看真源，禁靠大纲盲猜细微分支）：
   node runner/donegate.mjs zoom <文件路径[:起始行-结束行] | 函数符号名> --source
   ```
2. **场景 A · 直接开发或扩展本公开仓库（零契约轻量模式）**：
   本公开分发仓默认不含私有契约目录，修改本仓源码时**无需传入 `<nodeId>`**，直接按以下闭环施工：
   ```bash
   # 每写完 1 个文件，100ms 内即时校验语法、认知复杂度、反压行、术语与内联脚本漏挂：
   node runner/donegate.mjs lint-edit <文件路径>
   # 提交前跑全仓自检与单测（注：判定核运行时零第三方依赖；首次跑 Vitest 单测请先执行一次 npm install）：
   node skill/check-escapes.mjs --self-check
   npm test
   ```
3. **场景 B · 用完结门治理外部用户项目（启用 `contracts/` 密封切片模式）**：
   对外部项目执行 `node runner/donegate.mjs init` 建立 `INTENT.md` 与契约节点后，开启多代理工作树探针与 L2 密封胶囊围挡：
   ```bash
   node runner/donegate.mjs preflight   # 若返回退出码 78 (WORKTREE_EXPIRED) 或目录已空报 MODULE_NOT_FOUND，第 1 秒立即停机回报重派
   node runner/donegate.mjs slice <nodeId> [--focus <路径|@subpack>]
   node runner/donegate.mjs check-node <nodeId> [--allow-dirty] [--allow-cross-scope] --receipt
   ```
   当受契约保护的显式单文件 `foo.mjs` 过长时，可直接拆分为同名伴生子模块目录 `foo/*.mjs`（自动继承归属且保持门面 `stubHash` 零漂移）。

## 2. 四维工程与提交红线

- **跨平台兼容**：路径处理统一使用 `node:path`，禁止硬编码盘符或个人本机绝对路径；工作流外部二进制与 npm CLI 依赖统一走 `workflows/.deps/_shared/`（含 `.bin/`、`dists/` 及隔离 `npm-cells/<id>/` 工具舱），禁止使用 `--no-save` 互删依赖。
- **四维结构化预算**：`tests/**`、`*-fixtures.mjs` 与 `.json/.md` 豁免生产代码行数配额（鼓励逻辑与单测同批提交）；单次提交净增生产代码 `<= 250` 行绿灯、`251–450` 行软提示、`> 450` 行硬阻断，生产文件 `<= 6` 个（含测试总文件 `<= 10` 个）；单函数认知复杂度 `<= 15` 绿灯、`> 25` 硬阻断，严禁单行压码钻空子；单文件有效代码 `600` 行预警 / `850` 行硬顶（`runner/core` 核心子模块 `<= 350` 行，具体适配器 `<= 90` 行），禁止按字母机械切碎文件。
- **严禁凑绿**：禁止 `.skip/.only/.todo`、恒真断言、删断言凑绿、静态检查豁免注释、`|| true` 吞退出码或 `TODO/FIXME` 空壳实现。

## 3. 提交前全套自检（退出码须全为 `0`）

```bash
# 若裸克隆尚未安装开发期测试框架 vitest，首次跑 npm test 前先执行一次 npm install
node skill/verify-install.mjs --red-self-test
node skill/lint-edit.mjs --red-self-test
node skill/preflight-subagent.mjs --red-self-test
node skill/check-escapes.mjs --self-check
node skill/check-brick-liveness.mjs --root . --skip-contract-lookup
node skill/check-commit-hygiene.mjs --audit-repo
npm test
node runner/self-test.mjs
node runner/dsh-fixtures.mjs
node runner/atlas-fixtures.mjs
```
