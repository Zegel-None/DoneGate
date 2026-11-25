# AGENTS.md · AI 编码代理安装验真、三级变焦冷启动、局部切片与守门规范

欢迎接入 **DoneGate（完结门）**。任何零记忆 AI 编码代理（DeepSeek Harness、Claude Code、Cursor、Codex、Windsurf、Trae、Gemini 等）替零编程基础的 Vibecoder 安装配置本工具、治理用户项目或扩展本仓时，**必须遵守以下防撒谎安装验真、主控三级变焦冷启动与工程守门纪律**。

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

## 1. 项目施工第一铁律：主控三级变焦掌控全局 · 区分双模式闭环

1. **主控冷启动三级按需变焦（禁一进仓盲扫全仓源码文件；多目标查询优先合并为单条命令）**：
   新开会话的主控代理或开源协作者首先执行 `Zoom-0` 全局根视口简报（实时统计模块总数、导出符号与 HTTP 路由规模），再按信息气味做确定性 `O(1)` 下钻：
   ```bash
   # Zoom-0：生成与「完结门」画布 1:1 同构的五大业务域、跨域 Kneedle 承重接口与实时阈值
   node runner/donegate.mjs brief
   # Zoom-1：支持单条命令一次展开多个业务域（如 zoom 01 02 03），或查规则阈值/单测/缺口字典
   node runner/donegate.mjs zoom <域编号 01..05 | all | rules | tests | gaps> [更多域...]
   # Zoom-2：支持单条命令一次穿透多个文件，查看全签名、CLI 参数、内联脚本函数、HTTP 路由与跨脚本路径
   node runner/donegate.mjs zoom <文件路径1> [文件路径2...]
   # 跨文件波及面雷达：修改任意符号、HTTP 路由、DOM ID 或配置文件前自动推导 1-Hop 关联单测
   node runner/donegate.mjs impact <目标文件、符号、HTTP 路由、DOM ID 或配置文件名>
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
