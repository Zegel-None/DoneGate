import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildProjectAtlas, renderAtlasWorkbenchHtml } from '../runner/atlas/contract.mjs';
import { buildViewsScript } from '../runner/atlas/ui-views.mjs';
import { buildShellScript } from '../runner/atlas/ui-shell.mjs';
import { countEffectiveCodeLines } from '../skill/check-commit-hygiene.mjs';
import { analyzeCodeComplexityAndGolfing } from '../skill/cognitive-complexity.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function createToolbarDomHarness(atlas) {
  const elements = new Map();
  const ovTabButtons = [];
  const toasts = [];

  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...cls) => cls.forEach((c) => set.add(c)),
      remove: (...cls) => cls.forEach((c) => set.delete(c)),
      toggle: (c, force) => {
        const next = typeof force === 'boolean' ? force : !set.has(c);
        if (next) set.add(c);
        else set.delete(c);
        return next;
      },
      contains: (c) => set.has(c)
    };
  };

  const makeEl = (id, tag = 'DIV', initialText = '', initialClasses = [], initialAttrs = {}) => {
    const attrs = { ...initialAttrs };
    const listeners = {};
    const el = {
      id,
      tagName: tag,
      textContent: initialText,
      innerHTML: '',
      style: {},
      classList: makeClassList(initialClasses),
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      trigger(ev, payload = {}) { (listeners[ev] || []).forEach((fn) => fn(payload)); },
      querySelector: () => null,
      closest: () => null
    };
    if (id) elements.set(id, el);
    return el;
  };

  makeEl('btn-run-check', 'BUTTON', '', [], {
    'data-tip': '输入：当前工作区项目源码 → 执行：按画布连线依次真实运行各检查节点工具 → 输出：点亮每张卡片过关/拦截状态并生成可查看的检查记录'
  });
  makeEl('run-btn-label', 'SPAN', '▶ 运行检查流');

  const autopilotDot = makeEl('autopilot-pulse-dot', 'I', '', ['hidden']);
  const autopilotLabel = makeEl('autopilot-btn-label', 'SPAN', '🌙 挂机长跑');
  const autopilotBtn = makeEl('btn-autopilot', 'BUTTON', '', [], {
    'aria-pressed': 'false',
    'data-autopilot-active': '0'
  });
  autopilotBtn.querySelector = (sel) => (sel === 'span' ? autopilotLabel : null);

  makeEl('btn-refresh-live', 'BUTTON', '', [], {
    'aria-label': '↻ 同步依赖状态',
    'data-tip': '重新核对共享底座池与各工作流所需工具的安装就绪状态'
  });
  makeEl('refresh-live-icon', 'SPAN', '↻');
  makeEl('refresh-live-label', 'SPAN', '同步依赖状态');

  makeEl('atlas-overview-modal', 'DIV', '', ['hidden']);
  makeEl('atlas-ov-title', 'SPAN', '项目全景体检单');
  makeEl('atlas-ov-pct', 'SPAN', '验收进度 0%');
  makeEl('atlas-ov-sync', 'SPAN', '离线快照');
  makeEl('atlas-ov-intro', 'DIV', '一页看懂当前项目全局健康度：一共做了哪些功能、哪些已通过自动验收、多分支同时改代码有没有撞车风险、下一步该做什么。');
  makeEl('atlas-ov-body', 'DIV', '');

  for (const [tabKey, label] of [
    ['mindmap', '1. 项目有哪些功能'],
    ['arch', '2. 功能怎么串起来的'],
    ['branches', '3. 多分支撞车提醒'],
    ['ledger', '4. 自动验收与下一步建议']
  ]) {
    ovTabButtons.push(makeEl('', 'BUTTON', label, tabKey === 'mindmap' ? ['is-active'] : [], { 'data-ov-tab': tabKey }));
  }

  const documentStub = {
    hidden: false,
    documentElement: makeEl('', 'HTML'),
    body: makeEl('', 'BODY'),
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (sel) => (sel === '[data-ov-tab]' ? ovTabButtons : []),
    createElement: (tag) => makeEl('', String(tag).toUpperCase()),
    addEventListener() {}
  };

  const state = {
    theme: 'light',
    page: 'workshop',
    leftTab: 'workflows',
    activePackId: 'pack-default',
    hostWorkspaceId: 'host-ws',
    viewingRepoId: 'host-ws',
    autopilotActive: false,
    selectedNodeIds: new Set(),
    chatMessages: [],
    starredRepos: new Set(),
    customTextOverrides: {},
    textStyleOverrides: {},
    controlStyleOverrides: {}
  };

  const WORKFLOW_PACKS = {
    'pack-default': {
      id: 'pack-default',
      name: '标准质量检查流',
      group: '默认工作流',
      deps: [],
      nodes: [{ id: 'wf-n1', title: '代码规范检查', tplId: 'tpl-adp-biome' }],
      links: []
    }
  };
  const REPO_SANDBOXES = {
    'host-ws': {
      id: 'host-ws',
      name: 'DoneGate',
      nodes: [{ id: 'sb-n1', title: '工作台核心' }],
      links: [],
      groups: []
    }
  };

  const vmCtx = vm.createContext({
    addEventListener() {},
    parent: null,
    location: { protocol: 'file:', search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    document: documentStub,
    ATLAS: atlas,
    state,
    BLOCK_TEMPLATES: {},
    CATEGORY_LIST: [],
    WORKFLOW_PACKS,
    WORKFLOW_GROUPS: ['默认工作流'],
    REPO_SANDBOXES,
    Map,
    Set,
    Date,
    Math,
    Object,
    String,
    Number,
    Array,
    Boolean,
    RegExp,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    showToast: (msg) => { toasts.push(String(msg)); },
    renderHeader() {},
    renderLeftDrawer() {},
    renderCanvas() {},
    renderWires() {},
    renderAll() {},
    setupAllEvents() {},
    fitCanvas() {},
    reloadUiBoardIframe() {},
    getActiveNodesList: () => (REPO_SANDBOXES[state.hostWorkspaceId]?.nodes || []),
    getActiveSandboxContainer: () => (REPO_SANDBOXES[state.hostWorkspaceId] || { nodes: [], links: [] }),
    getActiveWorkshopGraph: () => (WORKFLOW_PACKS[state.activePackId] || { nodes: [], links: [] }),
    computeClientPackDepSummary: () => ({ missingCount: 0, missing: [], depsDir: 'workflows/.deps/pack-default' })
  });
  vmCtx.window = vmCtx;

  vm.runInContext([buildViewsScript(), buildShellScript()].join('\n'), vmCtx);

  return { elements, ovTabButtons, autopilotDot, toasts, vmCtx, state };
}

describe('Round 3 顶栏精简、挂机状态切换、上下文感知工具栏与白话全景体检回归', () => {
  const repoAtlas = buildProjectAtlas(REPO_ROOT);
  const html = renderAtlasWorkbenchHtml(repoAtlas);

  it('ui-shell.mjs 有效代码行数严格 <= 830 且零认知复杂度/C4g 违规，wb-dom.mjs SVG y1 属性合法', () => {
    const uiShellSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/ui-shell.mjs'), 'utf8');
    const metrics = countEffectiveCodeLines(uiShellSrc);
    expect(metrics.effectiveLines).toBeLessThanOrEqual(830);

    const cx = analyzeCodeComplexityAndGolfing(uiShellSrc);
    expect(cx.maxCognitive).toBeLessThanOrEqual(25);
    expect(cx.golfingIssues).toHaveLength(0);

    const wbDomSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/wb-dom.mjs'), 'utf8');
    expect(wbDomSrc).toContain('<line x1=\\"3\\" y1=\\"9\\" x2=\\"21\\" y2=\\"9\\"/>');
    expect(wbDomSrc).not.toContain('<line x1=\\"3\\" y=\\"9\\"');
  });

  it('覆盖 #4 与 #18：工作台 HTML 移除顶栏旧双页签 tab-page-sandbox / tab-page-workshop 与底部 subtle-canvas-hint', () => {
    expect(html).not.toContain('id="tab-page-sandbox"');
    expect(html).not.toContain('id="tab-page-workshop"');
    expect(html).not.toContain('id="subtle-canvas-hint"');
  });

  it('覆盖 #11：#btn-autopilot 默认显示「🌙 挂机长跑」，激活后切换为「🟢 挂机运行中」并同步无障碍状态', async () => {
    expect(html).toContain('id="btn-autopilot"');
    expect(html).toContain('data-autopilot-active="0"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('<span id="autopilot-btn-label">🌙 挂机长跑</span>');

    const { elements, autopilotDot, vmCtx } = createToolbarDomHarness(repoAtlas);
    const btn = elements.get('btn-autopilot');
    const label = elements.get('autopilot-btn-label');

    expect(btn.getAttribute('data-autopilot-active')).toBe('0');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(label.textContent).toBe('🌙 挂机长跑');
    expect(autopilotDot.classList.contains('hidden')).toBe(true);

    await vmCtx.triggerStartAutopilot();
    expect(btn.getAttribute('data-autopilot-active')).toBe('1');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(label.textContent).toBe('🟢 挂机运行中');
    expect(autopilotDot.classList.contains('hidden')).toBe(false);

    await vmCtx.triggerStartAutopilot();
    expect(btn.getAttribute('data-autopilot-active')).toBe('0');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(label.textContent).toBe('🌙 挂机长跑');
    expect(autopilotDot.classList.contains('hidden')).toBe(true);
  });

  it('覆盖 #12：#atlas-ov-intro 含白话总览导语，4 个标签页为白话标题且渲染结果不泄漏内部术语', () => {
    expect(html).toContain('id="atlas-ov-intro"');
    expect(html).toContain('一页看懂当前项目全局健康度：一共做了哪些功能、哪些已通过自动验收、多分支同时改代码有没有撞车风险、下一步该做什么。');
    expect(html).toContain('>1. 项目有哪些功能</button>');
    expect(html).toContain('>2. 功能怎么串起来的</button>');
    expect(html).toContain('>3. 多分支撞车提醒</button>');
    expect(html).toContain('>4. 自动验收与下一步建议</button>');

    const atlasWithInternalTerms = {
      ...repoAtlas,
      modules: [
        ...(repoAtlas.modules || []),
        {
          path: 'src/order.mjs',
          humanTitle: '订单结算模块',
          tone: 'warn',
          lines: 88,
          vibeLabel: 'DRAFT provisional check',
          vibeExplain: 'stubHash mismatch on obligation o1'
        }
      ],
      edges: [
        ...(repoAtlas.edges || []),
        { fromTitle: '前端结账页', toTitle: '订单接口', health: 'bridge', detail: 'provisional stubHash obligation link' }
      ],
      contracts: [
        ...(repoAtlas.contracts || []),
        { id: 'order-core', title: '订单核心链路', lifecycleState: 'FROZEN provisional stubHash obligations', passTrusted: 2, passTotal: 3 }
      ]
    };

    const { elements, vmCtx } = createToolbarDomHarness(atlasWithInternalTerms);
    const intro = elements.get('atlas-ov-intro');
    const body = elements.get('atlas-ov-body');

    vmCtx.openAtlasOverviewModal('mindmap');
    expect(intro.textContent).toContain('一页看懂当前项目全局健康度');

    for (const tab of ['mindmap', 'arch', 'branches', 'ledger']) {
      vmCtx.switchAtlasOvTab(tab);
      expect(body.innerHTML.length).toBeGreaterThan(20);
      expect(body.innerHTML).not.toMatch(/stubHash|provisional|obligation/i);
    }
  });

  it('覆盖 #15 与 #16：#btn-run-check 与 #btn-refresh-live 随工作流页 / 看板页 / UI看板页精准切换文案与气泡说明', async () => {
    expect(html).not.toContain('重扫全仓代码');

    const { elements, vmCtx, state, toasts } = createToolbarDomHarness(repoAtlas);
    const runBtn = elements.get('btn-run-check');
    const runLabel = elements.get('run-btn-label');
    const refBtn = elements.get('btn-refresh-live');
    const refLabel = elements.get('refresh-live-label');

    // 1) 工作流页（workshop + workflows）
    state.page = 'workshop';
    state.leftTab = 'workflows';
    vmCtx.renderAll();
    expect(runLabel.textContent).toBe('▶ 运行检查流');
    expect(runBtn.getAttribute('data-tip')).toContain('输入：');
    expect(runBtn.getAttribute('data-tip')).toContain('执行：');
    expect(runBtn.getAttribute('data-tip')).toContain('输出：');
    expect(refLabel.textContent).toBe('同步依赖状态');
    expect(refBtn.getAttribute('aria-label')).not.toContain('重扫全仓代码');
    expect(refBtn.getAttribute('data-tip')).not.toContain('重扫全仓代码');

    // 2) 项目看板页（sandbox + assets）
    state.page = 'sandbox';
    state.leftTab = 'assets';
    vmCtx.renderAll();
    expect(runLabel.textContent).toBe('▶ 全面体检项目');
    expect(runBtn.getAttribute('data-tip')).toContain('输入：');
    expect(runBtn.getAttribute('data-tip')).toContain('执行：');
    expect(runBtn.getAttribute('data-tip')).toContain('输出：');
    expect(refLabel.textContent).toBe('重扫项目代码');
    expect(refBtn.getAttribute('data-refresh-mode')).toBe('sandbox');

    // 3) UI看板页（uiboard）
    state.leftTab = 'uiboard';
    vmCtx.renderLeftDrawer();
    expect(refLabel.textContent).toBe('刷新界面预览');
    expect(refBtn.getAttribute('data-refresh-mode')).toBe('uiboard');

    // 验证运行检查汇总反馈
    state.page = 'sandbox';
    state.leftTab = 'assets';
    await vmCtx.uiShHandleRunCheckClick();
    expect(toasts.some((t) => t.includes('执行完成') && t.includes('目标工作区'))).toBe(true);
  });
});
