# AGENTS.md · AI 编码代理安装验真、局部切片与守门规范

欢迎接入 **DoneGate（完结门）**。任何零记忆 AI 编码代理（DeepSeek Harness、Claude Code、Cursor、Codex、Windsurf、Trae、Gemini 等）替零编程基础的 Vibecoder 安装配置本工具、治理用户项目或扩展本仓时，**必须遵守以下防撒谎安装验真、局部切片与工程守门纪律**。

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

## 1. 项目施工第一铁律：启动探针 · 局部领胶囊 · 单文件即时微检

1. **工作树健康探针（多代理并行工作树必跑）**：
   子代理进入隔离工作树第一条命令运行 `node runner/donegate.mjs preflight`；若返回退出码 `78`（`WORKTREE_EXPIRED`），必须立即停止操作回报总控重派，严禁自行探测系统目录。
2. **生成并只读 L0 全局路由表（禁扫全仓）**：
   在已初始化契约（`contracts/`）或已保存画布组件（`.donegate/workbench-state.json`）的项目根目录执行：
   ```bash
   node runner/donegate.mjs slice --router-only
   ```
   仅阅读生成的 `.donegate/ROUTER.md` 锁定目标节点 ID、管辖路径（`scope`）与上下游依赖拓扑，不预加载无关目录源码。
3. **按节点切出 L2 密封胶囊 + 跨文件锚点影响面预检**：
   ```bash
   node runner/donegate.mjs slice <nodeId> --freeze-stub
   # 修改共享 DOM ID、data-* 属性、API 路由或导出符号前，先预检波及单测与跨卡调用方：
   node runner/donegate.mjs impact <目标文件或锚点名>
   ```
   子代理仅加载 `.donegate/capsules/<nodeId>.capsule.md`；当显式文件 `foo.mjs` 过长时，支持直接拆分为同名伴生子模块目录 `foo/*.mjs`（自动继承契约 `scope` 且保持门面 `stubHash` 不变）。
4. **每改完单文件跑 `lint-edit` 即时微门禁 + 收尾跑 `check-node`**：
   ```bash
   # 每写完 1 个文件，100ms 内即时定位语法、认知复杂度、压行、术语与内联脚本漏挂：
   node runner/donegate.mjs lint-edit <文件路径>
   # 节点全部改完后执行单卡四重微门禁并交回 500-Token 回执：
   node runner/donegate.mjs check-node <nodeId> --allow-dirty --receipt
   ```

## 2. 四维工程与提交红线

- **跨平台兼容**：路径处理统一使用 `node:path`，禁止硬编码盘符或个人本机绝对路径；工作流外部 npm CLI 依赖统一走 `node workflows/.deps/_shared/dg-deps-cli.mjs install-npm` 隔离装入 `npm-cells/<id>/`，禁止使用 `--no-save` 互删依赖。
- **四维结构化预算**：`tests/**` （私有仓）与 `*-fixtures.mjs` 豁免生产代码行数配额（鼓励逻辑与单测同批提交）；单次提交净增生产代码 `<= 250` 行绿灯、`251–450` 行软提示、`> 450` 行硬阻断，生产文件 `<= 6` 个（含测试总文件 `<= 10` 个）；单函数认知复杂度 `<= 15` 预警、`> 25` 硬阻断，严禁单行压码钻空子；单文件有效代码 `600` 行预警 / `850` 行硬顶，禁止按字母机械切碎文件。
- **严禁凑绿**：禁止 `.skip/.only/.todo`、恒真断言、删断言凑绿、静态检查豁免注释、`|| true` 吞退出码或 `TODO/FIXME` 空壳实现。

## 3. 提交前全套自检（退出码须全为 `0`）

```bash
node skill/verify-install.mjs --red-self-test
node skill/lint-edit.mjs --red-self-test
node skill/preflight-subagent.mjs --red-self-test
node skill/check-escapes.mjs --self-check
node skill/check-commit-hygiene.mjs --audit-repo
node runner/self-test.mjs
node runner/dsh-fixtures.mjs
node runner/atlas-fixtures.mjs
```
