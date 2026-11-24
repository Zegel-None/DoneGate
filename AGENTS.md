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

## 1. 项目施工第一铁律：先读路由表，按节点领胶囊局部施工

1. **生成并只读 L0 全局路由表（禁扫全仓）**：
   在已初始化契约（`contracts/`）或已保存画布组件（`.donegate/workbench-state.json`）的项目根目录，第一条命令固定执行：
   ```bash
   node runner/donegate.mjs slice --router-only
   ```
   仅阅读生成的 `.donegate/ROUTER.md` 锁定目标节点 ID、管辖路径（`scope`）与上下游依赖拓扑，不预加载无关目录源码。
2. **按节点切出 L2 密封施工胶囊（默认 1M×40% = 400,000 Tokens 五段预算）**：
   ```bash
   node runner/donegate.mjs slice <nodeId> --freeze-stub
   # 若子代理上下文窗口较小（如 128k 模型），按同比例缩放预算：
   node runner/donegate.mjs slice <nodeId> --context-window 128000 --utilization 0.4
   ```
   子代理仅加载 `.donegate/capsules/<nodeId>.capsule.md`（含本节点 0-Hop 全量源码与关联测试 `160k` + 上下游 1-Hop 只读 `.stub.d.ts` 接口存根 `48k`；2-Hop 以外节点物理屏蔽）。
3. **严守单点门面出口与单卡四重微门禁**：
   - 模块目录若含 `index.mjs` 或 `contract.mjs` 门面出口，跨节点引用只准经由门面导入，严禁深层私引邻居内部实现文件。
   - 节点施工完毕后执行单卡微门禁：
     ```bash
     node runner/donegate.mjs check-node <nodeId> --allow-dirty --receipt
     ```
     自动拦截越界改写非本卡 `scope` 文件、私改已冻结导出签名、绕过门面私引内部实现与未声明红线依赖；退出码为 `0` 后，子代理仅将输出的 **500 Tokens 以内 JSON 回执**交回总控会话，随即销毁子会话上下文。

## 2. 四维工程与提交红线

- **跨平台兼容**：路径处理统一使用 `node:path`，禁止硬编码盘符或个人本机绝对路径；工作流外部 npm CLI 依赖统一走 `node workflows/.deps/_shared/dg-deps-cli.mjs install-npm` 隔离装入 `npm-cells/<id>/`，禁止使用 `--no-save` 互删依赖。
- **四维结构化预算**：`tests/**` （私有仓）与 `*-fixtures.mjs` 豁免生产代码行数配额（鼓励逻辑与单测同批提交）；单次提交净增生产代码 `<= 250` 行绿灯、`251–450` 行软提示、`> 450` 行硬阻断，生产文件 `<= 6` 个（含测试总文件 `<= 10` 个）；单函数认知复杂度 `<= 15` 预警、`> 25` 硬阻断，严禁单行压码钻空子；单文件有效代码 `600` 行预警 / `850` 行硬顶，禁止按字母机械切碎文件。
- **严禁凑绿**：禁止 `.skip/.only/.todo`、恒真断言、删断言凑绿、静态检查豁免注释、`|| true` 吞退出码或 `TODO/FIXME` 空壳实现。

## 3. 提交前全套自检（退出码须全为 `0`）

```bash
node skill/verify-install.mjs --red-self-test
node skill/check-escapes.mjs --self-check
node skill/check-commit-hygiene.mjs --audit-repo
node runner/self-test.mjs
node runner/dsh-fixtures.mjs
node runner/atlas-fixtures.mjs
```
