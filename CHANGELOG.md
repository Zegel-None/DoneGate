# Changelog

## 0.4.0

- 新增工业级密封契约切片与单卡阅后即焚微门禁（`donegate slice` / `donegate check-node`）：自动生成 `.donegate/ROUTER.md` 三级渐进路由与 AST 接口存根（`.stub.d.ts`），实现 0-Hop 源码读写 + 1-Hop 只读存根 + 2-Hop+ 物理屏蔽与 80-Token 结构化回执。
- 深度绑定 DeepSeek Harness (dsh web) Web UI：提供符合创造模式 (dsh-doc) 规范的 `@local/dsh-donegate` 插件包与 Windows `install-dsh-web.cmd` 一键安装。
- 支持类 ComfyUI 轻量预置开发流：未就位依赖自动禁跑，点击开发流右侧「补齐」或右键菜单即可由后台 Agent 将开源项目与环境隔离安装至 `workflows/.deps/<id>/`。
- 公开运行版已彻底剥离内部规格、调研分册与评审过程文档，零额外 Token 负担。
