// 生成符合 DSH 创造模式 (dsh-doc) 规范的 package.json、Windows/POSIX 自适应 cordis.patch.yml 与服务端入口（<= 220 行）
import { normalizeSlashes, toSafeFileUrl } from './win-paths.mjs';

export const DSH_BUNDLE_NAME = '@local/dsh-donegate';

export function renderDshBundlePackageJson() {
  return JSON.stringify({
    name: DSH_BUNDLE_NAME,
    version: '0.4.0',
    private: true,
    license: 'MIT',
    description: 'DoneGate V4 workbench bundle for DeepSeek Harness Web UI: visual kanban, deterministic workflow gates, and quote-driven Super-Agent dispatch.',
    icon: './icon.svg',
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './locale/*.json': './locale/*.json',
      './icon': './icon.svg',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json'
    },
    files: [
      'lib',
      'cordis.patch.yml',
      'locale/*.json',
      'docs',
      'icon.svg',
      'skills'
    ],
    dsh: {
      bundle: {
        patch: './cordis.patch.yml'
      },
      client: {
        platform: 'web',
        immediately: true,
        inject: [
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-sessions',
          '@deepseek-ai/dsh-client-ui-conversation',
          '@deepseek-ai/dsh-client-ui-slots'
        ]
      }
    },
    engines: {
      node: '>=22.19.0 || >=24.0.0',
      dsh: '^0.2.2-alpha.2'
    }
  }, null, 2) + '\n';
}

export function renderDshBundleCordisPatch(projectRoot) {
  const safeRoot = normalizeSlashes(projectRoot);
  return `# DoneGate V4 (完结门) DSH Web Bundle 编排补丁（遵循 dsh-doc 规范，自动适配 Windows pwsh-sandbox 与 Linux/macOS bash-sandbox）
- insert:
    - id: dsh-donegate
      name: '${DSH_BUNDLE_NAME}'
      config:
        projectRoot: "${safeRoot}"
    - id: preset-donegate-router
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-donegate-router
        name: 完结门 · Super Agent 主调度
        description: "承接画布蓝色引用胶囊与全局工程指令，指派 Worker 子代理挂载开发流执行并以零废话微卡回传。【非工程问答直通退让】若消息不含 [DG-TARGET] 蓝色引用胶囊且属于查天气、日常闲聊等非软件工程请求，立即按普通助手简明作答，严禁运行 donegate 命令、严禁生成画布节点或门禁微卡。"
        order: 85
        plugins:
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              write: false
              edit: false
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
              - id: tool-subagent
                name: '@deepseek-ai/dsh-tool-subagent'
                config:
                  provider: spawn
                  toolName: subagent
                  modelSelection: true
                  modelDiscovery: true
                  agentPreset: dsh-donegate-worker
    - id: preset-donegate-worker
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-donegate-worker
        name: 完结门 · 工作流施工工兵
        description: 由 Super Agent 派工调用，在授权契约 scope 内修改代码并接受完结门 0/1/2/3 确定性门禁验真。
        order: 86
        plugins:
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: shell
            name: cordis:group
            group: true
            isolate:
              shell: true
            config:
              - id: bash-sandbox
                name: '@deepseek-ai/dsh-bash-sandbox'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 10000
                  maxTimeoutMs: 60000
              - id: pwsh-sandbox
                name: '@deepseek-ai/dsh-pwsh-sandbox'
                disabled: !!js process.platform !== 'win32'
                config:
                  timeoutMs: 10000
                  maxTimeoutMs: 60000
              - id: tool-bash
                name: '@deepseek-ai/dsh-tool-bash'
                disabled: !!js process.platform === 'win32'
              - id: tool-pwsh
                name: '@deepseek-ai/dsh-tool-pwsh'
                disabled: !!js process.platform !== 'win32'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
    - id: preset-donegate-judge
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-donegate-judge
        name: 完结门 · 只读异构盲审官
        description: 仅读取 verify pack 五要素输出 pass/fail/unknown，物理关闭文件写权限（严守写判分离 G-10）。
        order: 87
        plugins:
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              write: false
              edit: false
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
`;
}

export function renderDshHostIndexJs(projectRoot) {
  const routesModuleUrl = toSafeFileUrl(`${normalizeSlashes(projectRoot).replace(/\/+$/, '')}/runner/dsh/host-routes.mjs`);
  const cleanRoot = normalizeSlashes(projectRoot);
  return `// DSH 0.2.2-rc.5 Host 端插件入口（遵循 dsh-doc 单一 apply 导出规范，通过 file:// URL 安全加载 Windows/POSIX 完结门路由）
export const inject = ['webServer'];

export async function apply(ctx, config) {
  const root = (config && config.projectRoot) || ${JSON.stringify(cleanRoot)};
  const mod = await import(${JSON.stringify(routesModuleUrl)});
  const handleRoute = mod.createDoneGateWebRouteHandler(root);

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: '/donegate',
    handler: async (req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      if (!u.pathname.startsWith('/donegate/api/')) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const subPath = '/' + u.pathname.slice('/donegate/api/'.length);
      try {
        const handled = await handleRoute(req, res, subPath);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '未知完结门接口: ' + subPath }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
      }
    }
  });

  ctx.effect(() => () => { disposeRoute(); });
}
`;
}
