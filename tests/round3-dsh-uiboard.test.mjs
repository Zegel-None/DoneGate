// 《测试问题记录 3》#5 / #8 / #9 专项回归单测：移除输入栏小框、子代理会话禁挂完结门抽屉/视图、UI看板自举套娃与传达到项目看板 grill me 闭环
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildWbDshBridge } from '../runner/atlas/wb-dsh-bridge.mjs';
import { buildWbDshShell } from '../runner/atlas/wb-dsh-shell.mjs';
import { buildWbUiBoardScript } from '../runner/atlas/wb-uiboard.mjs';
import { renderDshClientBundleJs } from '../runner/dsh/host/client-bundle-gen.mjs';
import { buildDshBundleDirectory } from '../runner/dsh/host/install-dsh-web.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadClientPluginInSandbox() {
  const clientCode = renderDshClientBundleJs();
  let loadedMod = null;
  const registeredSlots = [];
  const activatedViews = [];
  let mockViewMode = 'donegate';
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(spec) {
          loadedMod = spec;
        }
      },
      addEventListener() {},
      removeEventListener() {}
    },
    encodeURIComponent,
    Boolean,
    String,
    Array,
    Map,
    Set
  };
  vm.runInNewContext(clientCode, sandbox);
  const plugin = loadedMod.factory((modName) => {
    if (modName === 'react') {
      return {
        createElement: (...args) => args,
        useRef: () => ({ current: null }),
        useEffect() {}
      };
    }
    throw new Error('Unexpected require: ' + modName);
  });
  plugin.apply({
    effect(fn) {
      fn();
    },
    locale: {
      register() {
        return () => {};
      },
      bind() {
        return (k) => k;
      }
    },
    slots: {
      inject(_slot, cb) {
        cb();
      },
      register(opts, comp) {
        registeredSlots.push({ opts, comp });
        return () => {};
      }
    },
    get(svc) {
      if (svc === 'uiConversation') {
        return {
          binding(sid) {
            return {
              store: { getSnapshot: () => ({ view: mockViewMode }) },
              activate(v) {
                mockViewMode = v;
                activatedViews.push({ sid, view: v });
              }
            };
          }
        };
      }
      return null;
    }
  });
  return {
    clientCode,
    registeredSlots,
    activatedViews,
    setViewMode(v) {
      mockViewMode = v;
    }
  };
}

function mountWorkbenchInVm(searchQuery = '', extraAtlas = {}) {
  const appendedBodyIds = [];
  const byId = new Map();
  const makeEl = (tag, id = '') => {
    const attrs = {};
    const el = {
      id,
      tagName: tag,
      textContent: '',
      innerHTML: '',
      className: '',
      style: {},
      parentElement: null,
      classList: {
        classes: new Set(),
        add(c) {
          this.classes.add(c);
        },
        remove(c) {
          this.classes.delete(c);
        },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) {
            this.classes.add(c);
          } else {
            this.classes.delete(c);
          }
        }
      },
      setAttribute(k, v) {
        attrs[k] = String(v);
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      hasAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k);
      },
      appendChild(child) {
        if (child && child.id) {
          byId.set(child.id, child);
          appendedBodyIds.push(child.id);
        }
      },
      addEventListener() {},
      querySelectorAll: () => [],
      closest: () => null
    };
    if (id) byId.set(id, el);
    return el;
  };
  const bodyEl = makeEl('BODY', 'body');
  const stageParent = makeEl('MAIN', 'main-row');
  const canvasStage = makeEl('DIV', 'canvas-stage');
  canvasStage.parentElement = stageParent;
  const uiboardStage = makeEl('DIV', 'uiboard-stage');
  const postedToParent = [];
  const docClicks = [];
  const vmCtx = vm.createContext({
    window: null,
    location: { search: searchQuery, protocol: 'http:' },
    document: {
      body: bodyEl,
      documentElement: makeEl('HTML'),
      getElementById: (id) => byId.get(id) || null,
      createElement: (t) => makeEl(String(t).toUpperCase()),
      addEventListener(ev, fn) {
        if (ev === 'click') docClicks.push(fn);
      }
    },
    URLSearchParams,
    Map,
    Set,
    Date,
    Math,
    Object,
    String,
    Number,
    Array,
    Boolean,
    JSON,
    Function,
    encodeURIComponent,
    decodeURIComponent,
    fetch: null,
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame() {},
    esc: (s) => String(s ?? ''),
    showToast() {},
    renderAll() {},
    renderLeftDrawer() {},
    fitCanvas() {},
    closeCascadingMenus() {},
    applyThemeClasses() {},
    applyAllControlStyleOverrides() {},
    flyCanvasToNode() {},
    state: {
      page: 'sandbox',
      leftOpen: true,
      leftTab: 'uiboard',
      theme: 'light',
      activePackId: 'pack-web',
      hostWorkspaceId: 'host-workspace',
      viewingRepoId: 'host-workspace',
      selectedNodeIds: new Set(),
      controlStyleOverrides: {}
    },
    WORKFLOW_PACKS: { 'pack-web': { id: 'pack-web', name: '网页工作流', nodes: [] } },
    REPO_SANDBOXES: {
      'host-workspace': {
        id: 'host-workspace',
        name: '测试主仓',
        isHost: true,
        nodes: [{ id: 'host-dom-core', step: '01', title: '核心模块', scopePaths: ['src/'] }]
      }
    },
    ATLAS: { project: { name: 'DoneGate' }, workbench: { savedState: {} }, ...extraAtlas },
    getActiveNodesList: () => [],
    getActiveGroupsList: () => [],
    getSelectionInfo: () => ({ kind: 'none' })
  });
  vmCtx.window = vmCtx;
  vmCtx.innerWidth = 1280;
  vmCtx.addEventListener = () => {};
  vmCtx.parent = {
    postMessage(msg) {
      postedToParent.push(msg);
    }
  };
  vm.runInContext([buildWbDshBridge(), buildWbUiBoardScript(), buildWbDshShell()].join('\n'), vmCtx);
  return { vmCtx, byId, bodyEl, uiboardStage, appendedBodyIds, postedToParent, docClicks };
}

describe('问题 #5 与问题 #9：精简输入栏完结门小框 + 严禁子代理/内嵌会话出现完结门抽屉与画布', () => {
  it('彻底移除 conversation.input.left 完结门小框，仅保留顶部会话视图标签与主对话抽屉', () => {
    const { clientCode, registeredSlots } = loadClientPluginInSandbox();
    const slotIds = registeredSlots.map((s) => `${s.opts.name}:${s.opts.id}`);
    expect(slotIds).toEqual(['conversation.view:donegate', 'conversation.input.dock:donegate-dock', 'conversation.composer:donegate-subagent-readonly']);
    expect(slotIds).not.toContain('conversation.input.left:donegate-switch');
    expect(clientCode).not.toContain('DoneGateQuickSwitch');
    expect(clientCode).not.toContain('conversation.input.left');
  });

  it('子代理会话 4 类信号下 DoneGateInputDock 立即返回 null，DoneGateCanvasView 自动切回 chat 并返回 null', () => {
    const { clientCode, registeredSlots, activatedViews, setViewMode } = loadClientPluginInSandbox();
    expect(clientCode).toContain('[data-sidebar-chat] [data-donegate-dock-wrap], [data-sidebar-chat] [data-donegate-overlay] { display: none !important; }');

    const viewEntry = registeredSlots.find((s) => s.opts.id === 'donegate');
    const dockEntry = registeredSlots.find((s) => s.opts.id === 'donegate-dock');
    const dockInjected = dockEntry.opts.inject();
    const viewInjected = viewEntry.opts.inject();

    const subagentCases = [
      { label: 'props.session.subagent', props: { sessionId: 'sub-1', session: { id: 'sub-1', subagent: { parentId: 'main-1' } } } },
      { label: 'props.useSession', props: { sessionId: 'sub-2', useSession: (fn) => fn({ id: 'sub-2', subagent: { role: 'worker' } }) } },
      { label: 'props.useSessions', props: { sessionId: 'sub-3', useSessions: (fn) => fn({ byId: { 'sub-3': { id: 'sub-3', origin: 'subagent' } } }) } },
      { label: 'variant=embedded', props: { sessionId: 'sub-4', variant: 'embedded' } },
      { label: 'sidebar-chat container', props: { sessionId: 'sub-5', containerEl: { closest: (sel) => (sel === '[data-sidebar-chat]' ? {} : null) } } }
    ];

    for (const c of subagentCases) {
      setViewMode('donegate');
      const dockRes = dockEntry.comp({ ...dockInjected, ...c.props });
      expect(dockRes, `DoneGateInputDock 必须在 ${c.label} 下返回 null`).toBeNull();

      const viewRes = viewEntry.comp({ ...viewInjected, ...c.props });
      expect(viewRes, `DoneGateCanvasView 必须在 ${c.label} 下返回 null`).toBeNull();
    }
    expect(activatedViews.map((x) => `${x.sid}:${x.view}`)).toEqual([
      'sub-1:chat', 'sub-2:chat', 'sub-3:chat', 'sub-4:chat', 'sub-5:chat'
    ]);
  });

  it('wb-dsh-shell 在独立打开时挂载底部对话框，在 embed=uiboard 或 subagent=1 时严禁挂载 #dg-dsh-standalone-dock', () => {
    const standalone = mountWorkbenchInVm('');
    expect(standalone.byId.has('dsh-composer-shell')).toBe(true);
    expect(standalone.byId.get('dsh-composer-shell').innerHTML).toContain('id="dg-dsh-standalone-dock"');

    const embedUi = mountWorkbenchInVm('?embed=uiboard');
    expect(embedUi.byId.has('dsh-composer-shell')).toBe(false);
    expect(embedUi.byId.has('dg-dsh-standalone-dock')).toBe(false);
    vm.runInContext('renderUiBoardStageDom(false);', embedUi.vmCtx);
    expect(embedUi.uiboardStage.innerHTML).toContain('完结门自举嵌套预览层（已防无限递归）');

    const subagentWb = mountWorkbenchInVm('?subagent=1');
    expect(subagentWb.byId.has('dsh-composer-shell')).toBe(false);
    expect(subagentWb.byId.has('dg-dsh-standalone-dock')).toBe(false);
  });
});

describe('问题 #8：UI 看板默认真实展示当前开发项目（开发完结门时套娃嵌套自身）+ 待传达功能记录进入 grill me 环节', () => {
  it('开发完结门自身时嵌套渲染完结门真实工作台 UI，其他项目按真实前端文件或诚实引导页展示，且传达到项目看板落入 00 grill me 环节', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-r3-uib-'));
    const bundleDir = join(tmp, 'bundle');
    const emptyProj = join(tmp, 'empty-backend-proj');
    const htmlProj = join(tmp, 'real-web-proj');
    mkdirSync(emptyProj, { recursive: true });
    mkdirSync(join(htmlProj, 'public'), { recursive: true });
    writeFileSync(join(emptyProj, 'package.json'), '{"name":"pure-api-service"}\n', 'utf8');
    writeFileSync(join(htmlProj, 'public', 'index.html'), '<!DOCTYPE html><html><body><h1>真实外部商城首页</h1><button id="pay">去结算</button></body></html>\n', 'utf8');

    buildDshBundleDirectory(REPO_ROOT, bundleDir);
    const hostMod = await import(pathToFileURL(join(bundleDir, 'lib', 'index.js')).href);
    let hostHandler = null;
    const sessionCwds = {
      'sess-self': REPO_ROOT,
      'sess-empty': emptyProj,
      'sess-real': htmlProj
    };
    await hostMod.apply({
      webServer: {
        register(spec) {
          hostHandler = spec.handler;
          return () => {};
        }
      },
      effect() {},
      get(svc) {
        if (svc === 'agents') {
          return {
            get: (sid) => (sessionCwds[sid] ? { id: sid, cwd: sessionCwds[sid] } : null),
            list: () => []
          };
        }
        return null;
      }
    }, { projectRoot: REPO_ROOT });

    const server = createServer((req, res) => hostHandler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1) 开发 DoneGate 本仓时：自举“套娃”真实嵌套渲染完结门自身完整工作台 UI
      const selfSt = await (await fetch(`${baseUrl}/donegate/api/uiboard/status?sessionId=sess-self`)).json();
      expect(selfSt.ok).toBe(true);
      expect(selfSt.uiboard.isSelfDoneGate).toBe(true);
      expect(selfSt.uiboard.uiSourceKind).toBe('donegate-self');
      expect(selfSt.uiboard.previewPath).toBe('/donegate/api/canvas?embed=uiboard');

      const selfProtoHtml = await (await fetch(`${baseUrl}/donegate/api/uiboard/prototype?sessionId=sess-self`)).text();
      expect(selfProtoHtml).toContain('完结门工作台');
      expect(selfProtoHtml).toContain('/donegate/api/uiboard/bridge.js');
      expect(selfProtoHtml).toContain('UIBOARD_EMBEDDED_BRIDGE');
      expect(selfProtoHtml).not.toContain('智能协作与全流程数据中枢');

      // 2) 含真实 public/index.html 的其他项目：渲染真实页面并注入拾取桥（绝不向第三方项目页面注入控制面令牌）
      const realProtoHtml = await (await fetch(`${baseUrl}/donegate/api/uiboard/prototype?sessionId=sess-real`)).text();
      expect(realProtoHtml).toContain('真实外部商城首页');
      expect(realProtoHtml).toContain('/donegate/api/uiboard/bridge.js');
      expect(realProtoHtml).not.toContain('donegate-session-token');
      expect(realProtoHtml).not.toContain('智能协作与全流程数据中枢');

      // 3) 尚无前端界面文件的项目：展示诚实引导页，绝不展示虚假样板间
      const emptyProtoHtml = await (await fetch(`${baseUrl}/donegate/api/uiboard/prototype?sessionId=sess-empty`)).text();
      expect(emptyProtoHtml).toContain('当前项目暂未检测到前端界面文件，可在左侧新增按钮/页面需求描述并传达到项目看板启动开发');
      expect(emptyProtoHtml).not.toContain('智能协作与全流程数据中枢');
      const tokMatch = emptyProtoHtml.match(/name="donegate-session-token"\s+content="([^"]+)"/);
      expect(tokMatch).toBeTruthy();
      const sessionTok = tokMatch[1];

      // 4) 新增按钮/界面功能记录 -> 保存在 .donegate/uiboard-requirements.json -> 点击「传达到项目看板」落入 grill me 环节
      const addReq = await (await fetch(`${baseUrl}/donegate/api/uiboard/requirements?sessionId=sess-empty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Session-Token': sessionTok },
        body: JSON.stringify({
          label: '导出月度对账单按钮',
          description: '点击后校验账期范围，异步生成 CSV 并写入审计流水',
          sourceFile: 'apps/web/BillingToolbar.tsx',
          sourceLine: 28
        })
      })).json();
      expect(addReq.ok).toBe(true);
      const reqDisk = JSON.parse(readFileSync(join(emptyProj, '.donegate', 'uiboard-requirements.json'), 'utf8'));
      expect(reqDisk.items).toHaveLength(1);
      expect(reqDisk.items[0].status).toBe('pending');

      const conveyRes = await (await fetch(`${baseUrl}/donegate/api/uiboard/convey-to-kanban?sessionId=sess-empty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Session-Token': sessionTok },
        body: JSON.stringify({ requirementIds: [addReq.item.id] })
      })).json();
      expect(conveyRes.ok).toBe(true);
      expect(conveyRes.conveyedCount).toBe(1);
      expect(conveyRes.grillMeNode.step).toBe('00');
      expect(conveyRes.grillMeNode.title).toBe('grill me · 需求澄清与立约');

      const inboxLines = readFileSync(join(emptyProj, '.donegate', 'grill-me-inbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(inboxLines).toHaveLength(1);
      expect(inboxLines[0].label).toBe('导出月度对账单按钮');
      expect(inboxLines[0].stage).toBe('grill-me');

      const wbState = JSON.parse(readFileSync(join(emptyProj, '.donegate', 'workbench-state.json'), 'utf8'));
      expect(wbState.grillMeNode.id).toBe('host-dom-grill-me');
      expect(wbState.grillMeNode.step).toBe('00');
      expect(wbState.grillMeNode.title).toBe('grill me · 需求澄清与立约');

      // 5) 验证前端左栏文案为「待传达功能记录」与「📤 传达到项目看板」（彻底移除“接通”字样），且 DSH 嵌入态自动 postMessage dg:insert-quote 进入 grill me
      const dshEmbedVm = mountWorkbenchInVm('?dsh=1&sessionId=sess-empty', {
        project: { name: 'pure-api-service' }
      });
      dshEmbedVm.vmCtx.fetch = (url, init) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        const mergedInit = init ? { ...init, headers: { ...(init.headers || {}), 'X-DoneGate-Session-Token': sessionTok } } : init;
        return fetch(fullUrl, mergedInit);
      };
      await vm.runInContext('syncUiBoardBackendStatus(false)', dshEmbedVm.vmCtx);
      const headEl = { innerHTML: '' };
      const bodyEl = { innerHTML: '' };
      const footEl = { innerHTML: '' };
      dshEmbedVm.vmCtx.__h = headEl;
      dshEmbedVm.vmCtx.__b = bodyEl;
      dshEmbedVm.vmCtx.__f = footEl;
      vm.runInContext('renderUiBoardDrawer(__h, __b, __f)', dshEmbedVm.vmCtx);
      expect(bodyEl.innerHTML).toContain('➕ 新增按钮/界面功能记录');
      expect(bodyEl.innerHTML).toContain('待传达功能记录');
      expect(bodyEl.innerHTML).toContain('✓ 已传达到 grill me');
      expect(bodyEl.innerHTML).not.toContain('假动作转真后端');
      expect(bodyEl.innerHTML).not.toContain('一键接通');
      expect(dshEmbedVm.vmCtx.REPO_SANDBOXES['host-workspace'].nodes[0].id).toBe('host-dom-grill-me');
      expect(dshEmbedVm.vmCtx.REPO_SANDBOXES['host-workspace'].nodes[0].step).toBe('00');

      // 再新增一条并触发前端传达，验证按钮「📤 传达到项目看板」与 postMessage dg:insert-quote
      await fetch(`${baseUrl}/donegate/api/uiboard/requirements?sessionId=sess-empty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Session-Token': sessionTok },
        body: JSON.stringify({ label: '批量归档按钮', description: '勾选多条已完成单据后一键归档' })
      });
      await vm.runInContext('syncUiBoardBackendStatus(false)', dshEmbedVm.vmCtx);
      vm.runInContext('renderUiBoardDrawer(__h, __b, __f)', dshEmbedVm.vmCtx);
      expect(bodyEl.innerHTML).toContain('📤 传达到项目看板');
      await vm.runInContext('handleConveyRequirementsToKanban([])', dshEmbedVm.vmCtx);
      const quoteMsg = dshEmbedVm.postedToParent.find((m) => m.type === 'dg:insert-quote');
      expect(quoteMsg).toBeTruthy();
      expect(quoteMsg.text).toContain('grill me · 需求澄清与立约');
      expect(quoteMsg.text).toContain('批量归档按钮');
    } finally {
      server.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
