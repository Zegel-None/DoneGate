# 声明式开发流目录（`workflows/` · 类 ComfyUI 轻量预置）

本目录用于存放预置或自定义的声明式开发流定义文件（`<id>.workflow.json`）。

## 核心设计原则：只装流定义与薄适配，不捆绑第三方仓库

1. **轻量化入库**：本目录仅提交轻量的 `<id>.workflow.json` 拓扑连线、阶段规则与依赖清单（`deps[]`），**绝不把外部开源项目的源码仓库、二进制包或虚拟环境直接塞进 Git 仓库**。
2. **缺依赖硬门禁（类 ComfyUI 缺模型禁跑）**：当某条开发流中未跳过（非 `bypassed`）的节点所声明的外部开源工具或环境尚未就位时，预检引擎（`preflightWorkflowPack`）会直接阻断运行（退 `3`），并在画布与开发流列表中标出缺失项数量。
3. **行内按钮与右键菜单一键补齐**：在完结门工作台左侧「开发流」列表中，点击任意开发流右侧的 **「补齐」** 按钮，或在开发流条目上**右键选择「一键补齐此开发流依赖」**，系统与后台 Agent 会自动将该开发流所需的 GitHub 项目与环境依赖拉取并安装至已加入 `.gitignore` 的专属隔离目录：
   - 存放路径：`workflows/.deps/<workflowId>/`（内含 `repos/`、`npm/`、`venv/`、`.bin/` 与 `manifest.json`）
   - 运行时注入：该开发流执行时自动将 `workflows/.deps/<workflowId>/` 下的可执行路径注入当前运行环境，不污染全局系统环境。

## `<id>.workflow.json` 依赖声明示例

既支持复用 `bricks/<tool>/capabilities.json` 中的 `install` / `upstream` 字段，也支持在 `<id>.workflow.json` 顶层显式声明 `deps[]`：

```json
{
  "id": "stage-04-security-family",
  "group": "预置十阶段开发流",
  "name": "阶段四 · 供应链与密钥覆盖族开发流",
  "tip": "串联锁文件、容器层漏洞扫描与归并去重卡；首次使用请先点右侧「补齐」自动配置环境",
  "deps": [
    {
      "id": "osv-scanner",
      "title": "OSV-Scanner 锁文件漏洞扫描",
      "repo": "google/osv-scanner",
      "version": "v1.9.2",
      "kind": "go",
      "bin": "osv-scanner",
      "installCmd": "go install github.com/google/osv-scanner/cmd/osv-scanner@v1.9.2"
    }
  ],
  "nodes": [],
  "links": []
}
```
