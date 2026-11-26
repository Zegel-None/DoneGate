// 生成符合 DSH 创造模式 (dsh-doc) 规范的 package.json、Windows/POSIX 自适应 cordis.patch.yml 与动态会话路由入口
import { normalizeSlashes, toSafeFileUrl } from '../deps/index.mjs';

export const DSH_BUNDLE_NAME = '@local/dsh-donegate';

export function renderDshBundlePackageJson() {
  return JSON.stringify({
    name: DSH_BUNDLE_NAME,
    version: '1.0.0',
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
          '@deepseek-ai/dsh-client-ui-workspace',
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
  return `# DoneGate V4 (完结门) DSH Web Bundle 编排补丁（遵循 dsh-doc 规范，自动适配 Windows tool-pwsh 与 Linux/macOS tool-bash 宿主沙箱）
- insert:
    - id: dsh-donegate
      name: '${DSH_BUNDLE_NAME}'
      config:
        projectRoot: "${safeRoot}"
        requireAuth: true
    - id: preset-donegate-router
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-donegate-router
        name: 完结门 · Super Agent 主调度
        description: "承接画布蓝色引用胶囊与全局工程指令，指派 Worker 子代理挂载工作流执行并以零废话微卡回传。【UI直达路由】收到含 [DG-TARGET] 的消息时，若改界面交互/样式优先直接运行胶囊给出的 sliceCmd（即 node runner/donegate.mjs slice atlas-workbench --focus <uiOwner>），零手动 grep 直达目标 UI 模块。【非工程问答直通退让】若消息不含 [DG-TARGET] 蓝色引用胶囊且属于查天气、日常闲聊等非软件工程请求，立即按普通助手简明作答，严禁运行 donegate 命令、严禁生成画布节点或门禁微卡。"
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
          - id: tool-ask-user
            name: '@deepseek-ai/dsh-tool-ask-user'
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
        description: "由 Super Agent 派工调用，在授权契约 scope 内修改代码并接受完结门 0/1/2/3 确定性门禁验真。收到含 [DG-TARGET] 的消息时，若改界面交互/样式优先直接运行胶囊给出的 sliceCmd（即 node runner/donegate.mjs slice atlas-workbench --focus <uiOwner>），零手动 grep 直达目标 UI 模块。"
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
            config:
              sampleOverCapGlobResults: false
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
  const routesModuleUrl = toSafeFileUrl(`${normalizeSlashes(projectRoot).replace(/\/+$/, '')}/runner/dsh/host/host-routes.mjs`);
  const cleanRoot = normalizeSlashes(projectRoot);
  return `// DSH Host 端插件入口（遵循 dsh-doc 单一 apply 导出规范，按会话工作区动态路由完结门接口并隔离人类直连子代理）
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const inject = ['webServer'];
export const Config = {
  type: 'object',
  properties: {
    projectRoot: { type: 'string' },
    requireAuth: { type: 'boolean', default: true },
    sessionToken: { type: 'string' }
  }
};

function isExistingDir(dirPath) {
  try { return Boolean(dirPath && typeof dirPath === 'string' && existsSync(dirPath) && statSync(dirPath).isDirectory()); }
  catch (err) { void err; return false; }
}

export async function apply(ctx, config) {
  const defaultRoot = (config && config.projectRoot) || ${JSON.stringify(cleanRoot)};
  const mod = await import(${JSON.stringify(routesModuleUrl)});

  let disposeSubagentGuard = () => {};
  if (typeof mod.installSubagentHumanIsolationGuard === 'function') {
    const tryInstallGuard = (svc) => {
      if (svc) disposeSubagentGuard = mod.installSubagentHumanIsolationGuard(svc);
    };
    tryInstallGuard(ctx.get && ctx.get('subagents'));
    if (typeof ctx.inject === 'function') {
      ctx.inject(['subagents'], (innerCtx) => {
        const d = mod.installSubagentHumanIsolationGuard(innerCtx.get ? innerCtx.get('subagents') : innerCtx.subagents);
        innerCtx.effect(() => () => { d(); });
      });
    }
  }

  const dispatchSubagent = async ({ sessionId, label, prompt } = {}) => {
    try {
      const subagents = ctx.get && ctx.get('subagents');
      const agents = ctx.get && ctx.get('agents');
      if (subagents && agents) {
        let parent = (sessionId && agents.get && agents.get(sessionId)) || (agents.list && agents.list()[0]) || null;
        if (!parent && sessionId && typeof agents.resume === 'function') {
          try {
            const h = await agents.resume({ sessionId });
            parent = (h && h.agent) || (agents.get && agents.get(sessionId)) || null;
          } catch (err) { void err; }
        }
        if (parent && typeof subagents.startActivation === 'function') {
          const pCwd = parent.cwd || parent.workDir || parent.workspaceDir || parent.options?.cwd || '';
          if (isExistingDir(pCwd) && typeof mod.writeStandaloneDepsCli === 'function') {
            try { mod.writeStandaloneDepsCli(resolve(pCwd)); } catch (err) { void err; }
          }
          const act = await subagents.startActivation({
            provider: 'spawn',
            label: String(label || '补齐工作流依赖').slice(0, 48),
            prompt: [{ type: 'text', text: String(prompt || '') }],
            parent,
            agentPreset: 'dsh-donegate-worker',
            signal: new AbortController().signal,
            delivery: 'parent'
          });
          return { dispatched: true, name: act.name, childId: act.childId };
        }
      }
    } catch (err) { void err; }
    return { dispatched: false, fallbackAutoSubmit: true };
  };

  const handlerByRoot = new Map();
  const requireAuth = !config || config.requireAuth !== false;
  const instanceSessionToken = (config && typeof config.sessionToken === 'string' && config.sessionToken.trim())
    ? config.sessionToken.trim()
    : (requireAuth ? randomBytes(32).toString('hex') : undefined);
  const authOpts = { requireAuth, sessionToken: instanceSessionToken };
  const getHandler = (rootDir) => {
    const key = resolve(rootDir || defaultRoot);
    if (!handlerByRoot.has(key)) handlerByRoot.set(key, mod.createDoneGateWebRouteHandler(key, { dispatchSubagent, ...authOpts }));
    return handlerByRoot.get(key);
  };
  getHandler(defaultRoot);

  const collectAllowedWorkspaceRoots = () => {
    const allowed = new Set([resolve(defaultRoot)]);
    try {
      const agents = ctx.get && ctx.get('agents');
      const sessions = ctx.get && ctx.get('sessions');
      const list = (agents && typeof agents.list === 'function' ? agents.list() : []) || [];
      for (const ag of list) {
        for (const c of [ag?.cwd, ag?.workDir, ag?.workspaceDir, ag?.projectRoot, ag?.options?.cwd, ag?.config?.cwd]) {
          if (isExistingDir(c)) allowed.add(resolve(c));
        }
      }
      const sList = (sessions && typeof sessions.list === 'function' ? sessions.list() : []) || [];
      for (const ss of sList) {
        for (const c of [ss?.cwd, ss?.workDir, ss?.workspaceDir, ss?.workspacePath, ss?.projectRoot]) {
          if (isExistingDir(c)) allowed.add(resolve(c));
        }
      }
    } catch (err) { void err; }
    return allowed;
  };

  const resolveRequestRoot = (req, u) => {
    const hdrs = (req && req.headers) || {};
    const sid = u.searchParams.get('sessionId') || hdrs['x-dsh-session-id'] || '';
    const allowedRoots = collectAllowedWorkspaceRoots();
    try {
      const agents = ctx.get && ctx.get('agents');
      const sessions = ctx.get && ctx.get('sessions');
      const ag = (sid && agents && agents.get && agents.get(sid)) || (!sid && agents && agents.list && agents.list()[0]) || null;
      const ss = (sid && sessions && sessions.get && sessions.get(sid)) || null;
      const cands = [
        ag?.cwd, ag?.workDir, ag?.workspaceDir, ag?.projectRoot, ag?.options?.cwd, ag?.config?.cwd,
        ss?.cwd, ss?.workDir, ss?.workspaceDir, ss?.workspacePath, ss?.projectRoot
      ];
      for (const c of cands) {
        if (isExistingDir(c)) allowedRoots.add(resolve(c));
      }
      const explicitRoot = u.searchParams.get('workspace') || hdrs['x-donegate-root'] || '';
      if (isExistingDir(explicitRoot) && allowedRoots.has(resolve(explicitRoot))) {
        return resolve(explicitRoot);
      }
      for (const c of cands) if (isExistingDir(c)) return resolve(c);
    } catch (err) { void err; }
    return defaultRoot;
  };

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
        const activeRoot = resolveRequestRoot(req, u);
        const handled = await getHandler(activeRoot)(req, res, subPath);
        if (!handled && !res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '未知完结门接口: ' + subPath }));
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(Number(err?.statusCode) || 500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
        }
      }
    }
  });

  ctx.effect(() => () => {
    disposeSubagentGuard();
    disposeRoute();
  });
}
`;
}
