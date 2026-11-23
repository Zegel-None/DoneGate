# AGENTS.md · AI 编码代理局部切片与守门规范

欢迎接入 **DoneGate（完结门）**。任何零记忆 AI 编码代理（DeepSeek Harness、Claude Code、Cursor、Codex、Gemini 等）使用本工具治理用户项目或扩展本仓时，**必须遵守以下局部切片与防伪守门纪律，严禁一进场就盲目通读全仓源码**。

## 1. 开工第一铁律：先读路由表，按节点领胶囊局部施工

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

## 2. 工程与提交红线

- **跨平台兼容**：路径处理统一使用 `node:path`，禁止硬编码盘符或个人本机绝对路径。
- **小步增量预算**：单次提交新增代码 `<= 300` 行、涉及代码文件 `<= 8` 个；单文件有效代码 `600` 行预警 / `850` 行硬顶，禁止按字母机械切碎文件。
- **严禁凑绿**：禁止 `.skip/.only/.todo`、恒真断言、删断言凑绿、静态检查豁免注释、`|| true` 吞退出码或 `TODO/FIXME` 空壳实现。
- **适配器与工作流扩展**：新增外部工具统一使用 `node skill/new-adapter.mjs <tool> --archetype <形态> --card-json` 委托 `skill/adapters/_shared.mjs`（`runAdapter`），外部依赖按需补齐至 `workflows/.deps/_shared/`，严禁将第三方源码或二进制提交入库。

## 3. 提交前全套自检（退出码须全为 `0`）

```bash
node skill/check-escapes.mjs --self-check
node runner/self-test.mjs
node runner/dsh-fixtures.mjs
node runner/atlas-fixtures.mjs
```
