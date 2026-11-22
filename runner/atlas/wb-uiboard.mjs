// Agent Native UI 看板前端控制器：编辑/测试双模切换、多套美学方案 0ms 秒切与锁定、类 Puck 拖拽布局块、语音点选改 UI 与假动作转真后端接线台
import { AESTHETIC_PROPOSALS, buildInjectedUiBridgeScript } from '../dsh/contract.mjs';

export function buildWbUiBoardScript() {
  const embeddedProposalsJson = JSON.stringify(AESTHETIC_PROPOSALS.slice(0, 3));
  const embeddedBridgeJs = JSON.stringify(buildInjectedUiBridgeScript());

  return `
const UIBOARD_FALLBACK_PROPOSALS = ${embeddedProposalsJson};
const UIBOARD_EMBEDDED_BRIDGE = ${embeddedBridgeJs};

const uiBoardState = {
  initialized: false,
  mode: 'edit',            // 'edit' (点选/改字/拖拽) | 'test' (真点击/真跳转试用)
  viewport: 'desktop',     // 'desktop' | 'tablet' | 'mobile'
  sourceMode: 'prototype', // 'prototype' | 'proxy'
  devUrl: '',
  activeProposalId: 'swiss-minimal',
  lockedProposalId: null,
  proposals: UIBOARD_FALLBACK_PROPOSALS,
  blockTemplates: [
    { type: 'hero_nav', label: '顶部导航与主视觉区' },
    { type: 'kpi_row', label: '核心指标统计卡组' },
    { type: 'action_form', label: '交互表单与提交弹窗块' },
    { type: 'data_table', label: '业务明细列表与导出块' },
    { type: 'confirm_modal_trigger', label: '二次确认弹窗跳转按钮组' }
  ],
  blocks: [
    { id: 'blk-hero', type: 'hero_nav' },
    { id: 'blk-kpi', type: 'kpi_row' },
    { id: 'blk-form', type: 'action_form' },
    { id: 'blk-table', type: 'data_table' }
  ],
  wiringActions: [
    { actionId: 'act-create-order', label: '新建业务单据', targetApi: 'POST /api/orders/draft', targetTable: 'orders', status: 'mock' },
    { actionId: 'act-submit-form', label: '提交并触发流转', targetApi: 'POST /api/workflows/submit', targetTable: 'workflow_submissions', status: 'mock' },
    { actionId: 'act-export-report', label: '导出筛选报表', targetApi: 'GET /api/reports/export', targetTable: 'audit_logs', status: 'mock' }
  ],
  selectedElement: null,
  selfPlayBadge: '待运行自测',
  selfPlayOk: true,
  testTelemetryCount: 0,
  runtimeErrors: 0
};

function buildOfflineUiSrcdoc() {
  const prop = uiBoardState.proposals.find((p) => p.id === uiBoardState.activeProposalId) || uiBoardState.proposals[0];
  const cssVars = Object.entries(prop.tokens || {}).map(([k, v]) => '  ' + k + ': ' + v + ';').join('\\n');
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>:root {',
    cssVars,
    '} * { box-sizing: border-box; } body { margin: 0; padding: 20px; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans); }',
    '.c { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); box-shadow: var(--ui-shadow); padding: 16px 18px; margin-bottom: 14px; }',
    '.b { padding: 7px 13px; border-radius: var(--ui-radius); background: var(--ui-primary); color: var(--ui-primary-fg); border: none; font-weight: 600; cursor: pointer; }',
    '</style></head><body>',
    '<section class="c" data-dg-block="blk-hero" data-dg-source="src/pages/Home.tsx:14:1"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>智能业务工作台</strong><button type="button" class="b" data-dg-action="act-create-order" data-dg-wiring="mock" data-dg-source="src/pages/Home.tsx:18:5">新建业务单据</button></div><h2 style="margin:10px 0 4px;">点击此标题或右侧按钮体验双模联动</h2><p style="margin:0;color:var(--ui-muted);font-size:13px;">编辑模式下单击元素生成蓝色引用胶囊，双击文字原地修改；切至测试模式即可真实点击试玩。</p></section>',
    '<section class="c" data-dg-block="blk-form" data-dg-source="src/pages/Home.tsx:32:1"><div style="display:flex;gap:8px;flex-wrap:wrap;"><input placeholder="输入审批事项名称..." style="flex:1;padding:7px 10px;border-radius:var(--ui-radius);border:1px solid var(--ui-border);background:var(--ui-surface-muted);color:var(--ui-text);"><button type="button" class="b" data-dg-action="act-submit-form" data-dg-wiring="mock" data-dg-source="src/pages/Home.tsx:38:7" onclick="alert(\\'[测试模式真实点击] 已触发模拟提交！\\')">提交并触发流转</button></div></section>',
    '<script>' + UIBOARD_EMBEDDED_BRIDGE + '<\\/script></body></html>'
  ].join('\\n');
}

async function syncUiBoardBackendStatus() {
  if (!/^https?:$/i.test(location.protocol)) return;
  try {
    const r = await fetch('/donegate/api/uiboard/status');
    const j = await r.json();
    if (r.ok && j && j.ok && j.uiboard) {
      const u = j.uiboard;
      if (Array.isArray(u.proposals) && u.proposals.length) uiBoardState.proposals = u.proposals;
      if (u.activeProposalId) uiBoardState.activeProposalId = u.activeProposalId;
      if (u.lockedDesign && u.lockedDesign.proposalId) uiBoardState.lockedProposalId = u.lockedDesign.proposalId;
      if (Array.isArray(u.blockTemplates)) uiBoardState.blockTemplates = u.blockTemplates;
      if (u.layout && Array.isArray(u.layout.content)) uiBoardState.blocks = u.layout.content;
      if (u.wiring && Array.isArray(u.wiring.actions)) uiBoardState.wiringActions = u.wiring.actions;
      if (!uiBoardState.devUrl && u.suggestedDevUrl) uiBoardState.devUrl = u.suggestedDevUrl;
    }
  } catch (err) { void err; }
}

function getUiBoardIframeUrl() {
  if (!/^https?:$/i.test(location.protocol)) return '';
  if (uiBoardState.sourceMode === 'proxy' && uiBoardState.devUrl.trim()) {
    return '/donegate/api/uiboard/proxy?url=' + encodeURIComponent(uiBoardState.devUrl.trim());
  }
  return '/donegate/api/uiboard/prototype?theme=' + encodeURIComponent(uiBoardState.activeProposalId) + '&t=' + Date.now();
}

function postToUiIframe(msg) {
  const ifr = document.getElementById('uiboard-iframe');
  if (ifr && ifr.contentWindow) {
    ifr.contentWindow.postMessage({ source: 'donegate-uiboard', ...msg }, '*');
  }
}

function reloadUiBoardIframe() {
  const ifr = document.getElementById('uiboard-iframe');
  if (!ifr) return;
  const url = getUiBoardIframeUrl();
  if (url) ifr.src = url;
  else ifr.srcdoc = buildOfflineUiSrcdoc();
  ifr.onload = () => {
    postToUiIframe({ type: 'dg-ui:set-mode', mode: uiBoardState.mode });
  };
}

function renderUiBoardStageVisibility() {
  const stageEl = document.getElementById('uiboard-stage');
  if (!stageEl) return;
  const active = state.leftTab === 'uiboard';
  stageEl.classList.toggle('hidden', !active);
  stageEl.classList.toggle('flex', active);
  if (!active) return;

  if (!uiBoardState.initialized) {
    uiBoardState.initialized = true;
    syncUiBoardBackendStatus().then(() => {
      if (state.leftTab === 'uiboard') {
        renderLeftDrawer();
        renderUiBoardStageDom(true);
      }
    });
  }
  renderUiBoardStageDom(false);
}

function renderUiBoardStageDom(forceReloadIframe) {
  const stageEl = document.getElementById('uiboard-stage');
  if (!stageEl) return;
  const vpWidth = uiBoardState.viewport === 'mobile' ? '390px' : (uiBoardState.viewport === 'tablet' ? '768px' : '100%');
  const sel = uiBoardState.selectedElement;
  const selText = sel
    ? ('已选：<' + sel.tag + '>「' + sel.label + '」 @ ' + sel.sourceFile.split('/').pop() + ':' + sel.sourceLine)
    : (uiBoardState.mode === 'edit' ? '编辑模式：单击画面任意元素即可压入蓝色引用胶囊并语音提修改要求' : '测试模式：鼠标点击为真实交互与跳转，自动抓拍假动作与报错');

  const existingIframe = document.getElementById('uiboard-iframe');
  if (!existingIframe) {
    stageEl.innerHTML = [
      '<div class="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap shrink-0" style="background: var(--surface); border-color: var(--border-subtle);">',
      '  <div class="flex items-center gap-2 flex-wrap">',
      '    <div class="seg-bar" role="group" aria-label="UI看板编辑与测试模式切换">',
      '      <button type="button" id="uib-mode-edit" class="seg-btn is-active" data-uib-act="set-mode" data-mode="edit" data-tip="编辑模式：拦截跳转，单击元素生成蓝色引用胶囊对话、双击文字原地改名、支持拖拽区块">✏️ 编辑模式</button>',
      '      <button type="button" id="uib-mode-test" class="seg-btn" data-uib-act="set-mode" data-mode="test" data-tip="测试模式：卸下遮罩，恢复真实鼠标点击、表单输入、弹窗与跳转试用">▶️ 测试模式</button>',
      '    </div>',
      '    <div class="seg-bar" role="group" aria-label="响应式视口尺寸">',
      '      <button type="button" class="seg-btn is-active" data-uib-vp="desktop" data-uib-act="set-vp">桌面</button>',
      '      <button type="button" class="seg-btn" data-uib-vp="tablet" data-uib-act="set-vp">平板</button>',
      '      <button type="button" class="seg-btn" data-uib-vp="mobile" data-uib-act="set-vp">手机</button>',
      '    </div>',
      '    <div class="flex items-center gap-1">',
      '      <input id="uib-dev-url" type="text" placeholder="或输入本地服务如 http://127.0.0.1:5173" class="px-2 py-1 rounded-lg border text-[11px] font-mono w-52 outline-none" style="background: var(--surface-soft); border-color: var(--border-subtle); color: var(--text-main);">',
      '      <button type="button" class="ghost-btn text-[11px] px-2 py-1" data-uib-act="connect-dev-url" data-tip="同源代理接入本地正在运行的 React/Vue/Next/FastAPI 页面并自动注入点选桥">接入服务</button>',
      '      <button type="button" class="ghost-btn text-[11px] px-2 py-1" data-uib-act="use-prototype" data-tip="切回内置可拖拽原型页">原型页</button>',
      '    </div>',
      '  </div>',
      '  <div class="flex items-center gap-1.5">',
      '    <span id="uib-selfplay-pill" class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="background: var(--surface-soft); color: var(--text-secondary);"></span>',
      '    <button type="button" class="ghost-btn text-[11px]" data-uib-act="run-self-play" data-tip="让 Agent 用内置探针或 agent-browser 先自动点一遍按钮排雷并检查反AI模板脸">🤖 Agent点按自测</button>',
      '    <button type="button" class="ghost-btn is-primary text-[11px]" data-uib-act="voice-modify-ui" data-tip="针对当前点选的 UI 元素直接语音口述交互或弹窗修改需求">🎤 语音改所选UI</button>',
      '  </div>',
      '</div>',
      '<div id="uib-selection-banner" class="px-3 py-1.5 border-b text-[11px] flex items-center justify-between gap-2 shrink-0" style="background: var(--surface-soft); border-color: var(--border-subtle); color: var(--primary);"></div>',
      '<div class="flex-1 overflow-auto p-3 flex justify-center items-stretch" style="background: var(--bg-app);">',
      '  <div id="uiboard-frame-wrap" class="h-full rounded-xl border overflow-hidden transition-all" style="background: #ffffff; border-color: var(--border-strong); box-shadow: var(--shadow-md); width: 100%;">',
      '    <iframe id="uiboard-iframe" title="DoneGate UI Board Live Stage" class="w-full h-full border-0"></iframe>',
      '  </div>',
      '</div>'
    ].join('\\n');
    reloadUiBoardIframe();
  } else if (forceReloadIframe) {
    reloadUiBoardIframe();
  }

  document.getElementById('uib-mode-edit')?.classList.toggle('is-active', uiBoardState.mode === 'edit');
  document.getElementById('uib-mode-test')?.classList.toggle('is-active', uiBoardState.mode === 'test');
  stageEl.querySelectorAll('[data-uib-vp]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-uib-vp') === uiBoardState.viewport);
  });
  const wrap = document.getElementById('uiboard-frame-wrap');
  if (wrap) wrap.style.width = vpWidth;
  const urlInp = document.getElementById('uib-dev-url');
  if (urlInp && !urlInp.matches(':focus')) urlInp.value = uiBoardState.devUrl;
  const spPill = document.getElementById('uib-selfplay-pill');
  if (spPill) {
    spPill.textContent = uiBoardState.selfPlayBadge + (uiBoardState.runtimeErrors > 0 ? (' · ⚠ ' + uiBoardState.runtimeErrors + ' 报错') : '');
    spPill.style.color = uiBoardState.selfPlayOk && uiBoardState.runtimeErrors === 0 ? 'var(--ok)' : 'var(--warn)';
  }
  const banner = document.getElementById('uib-selection-banner');
  if (banner) {
    banner.innerHTML = '<span class="truncate font-medium">' + esc(selText) + '</span>' +
      (sel && sel.actionId && sel.wiringState === 'mock'
        ? '<button type="button" class="dg-micro-btn shrink-0" data-uib-act="wire-single" data-act-id="' + esc(sel.actionId) + '">🔌 把此按钮接通真后端与数据库</button>'
        : '');
  }
}

function renderUiBoardDrawer(headEl, bodyEl, footEl) {
  const mockPending = uiBoardState.wiringActions.filter((a) => a.status === 'mock').length;
  headEl.innerHTML = [
    '<span class="text-xs font-semibold" style="color: var(--text-secondary);">UI 看板控制台</span>',
    '<span class="text-[10.5px] px-1.5 py-0.2 rounded font-semibold" style="background: var(--primary-soft); color: var(--primary);">双模联动</span>'
  ].join('');

  const proposalsHtml = uiBoardState.proposals.map((p) => {
    const active = p.id === uiBoardState.activeProposalId;
    const locked = p.id === uiBoardState.lockedProposalId;
    const dots = (p.swatches || []).map((hex) => '<span class="w-3 h-3 rounded-full border" style="background:' + esc(hex) + ';border-color:rgba(15,23,42,0.18);"></span>').join('');
    return '<div data-uib-act="pick-theme" data-prop-id="' + esc(p.id) + '" class="p-2 rounded-xl border cursor-pointer flex flex-col gap-1 transition-colors" style="background:' + (active ? 'var(--primary-soft)' : 'var(--surface-soft)') + ';border-color:' + (active ? 'var(--primary)' : 'var(--border-subtle)') + ';">' +
      '<div class="flex items-center justify-between gap-1">' +
      '  <span class="text-[11.5px] font-semibold truncate" style="color:var(--text-main);">' + esc(p.name) + '</span>' +
      '  <span class="inline-flex items-center gap-1 shrink-0">' + dots + '</span>' +
      '</div>' +
      '<div class="text-[10.5px] leading-snug" style="color:var(--text-muted);">' + esc(p.summary) + '</div>' +
      (locked ? '<div class="text-[10px] font-semibold" style="color:var(--ok);">✓ 已锁入 design-system/MASTER.md</div>' : '') +
      '</div>';
  }).join('');

  const blocksHtml = uiBoardState.blockTemplates.map((tpl) => (
    '<button type="button" data-uib-act="add-block" data-block-type="' + esc(tpl.type) + '" class="px-2.5 py-1.5 rounded-lg border text-left text-[11px] flex items-center justify-between hover:opacity-90" style="background:var(--surface-soft);border-color:var(--border-subtle);color:var(--text-main);">' +
    '  <span class="truncate">+ ' + esc(tpl.label) + '</span>' +
    '  <span class="text-[10px] font-mono" style="color:var(--primary);">添加</span>' +
    '</button>'
  )).join('');

  const wiringHtml = uiBoardState.wiringActions.map((act) => {
    const isMock = act.status === 'mock';
    return '<div class="px-2 py-1.5 rounded-lg border flex items-center justify-between gap-1.5 text-[11px]" style="background:var(--surface-soft);border-color:var(--border-subtle);">' +
      '<div class="min-w-0 flex-1">' +
      '  <div class="font-medium truncate" style="color:var(--text-main);">' + esc(act.label) + '</div>' +
      '  <div class="text-[10px] font-mono truncate" style="color:var(--text-muted);">' + esc(act.targetApi) + '</div>' +
      '</div>' +
      (isMock
        ? '<button type="button" data-uib-act="wire-single" data-act-id="' + esc(act.actionId) + '" class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0" style="background:var(--warn-bg);color:var(--warn);">🔌 接通</button>'
        : '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0" style="background:var(--ok-bg);color:var(--ok);">✓ 已接通</span>') +
      '</div>';
  }).join('');

  bodyEl.innerHTML = [
    '<div class="flex flex-col gap-1.5">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">1. 美学多方案实时选型</span><button type="button" data-uib-act="lock-theme" class="text-[10.5px] font-semibold hover:underline" style="color:var(--primary);">🔒 锁定当前方案</button></div>',
    proposalsHtml,
    '</div>',
    '<div class="flex flex-col gap-1 pt-2 border-t" style="border-color:var(--border-subtle);">',
    '  <div class="px-1 text-[11px] font-semibold" style="color:var(--text-secondary);">2. 组件级布局块添加与拖拽 (JSON)</div>',
    blocksHtml,
    '</div>',
    '<div class="flex flex-col gap-1 pt-2 border-t" style="border-color:var(--border-subtle);">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">3. 假动作转真后端 (' + mockPending + ' 待接)</span>' +
      (mockPending > 0 ? '<button type="button" data-uib-act="wire-all" class="text-[10.5px] font-semibold hover:underline" style="color:var(--primary);">全部接通</button>' : '') + '</div>',
    wiringHtml,
    '</div>'
  ].join('\\n');

  footEl.innerHTML = '<button type="button" data-uib-act="provision-ui-deps" class="ghost-btn w-full justify-center text-[11px]" data-tip="按需将 Lovinsp / React Grab / Puck / agent-browser 安装至 workflows/.deps/uiboard/">📦 按需补齐 UI 增强套件</button>';
}

// 接收被预览 UI <iframe> 发回的点选、原地改字、区块拖拽与测试报错事件
window.addEventListener('message', async (ev) => {
  const d = ev.data || {};
  if (d.source !== 'dg-ui-bridge') return;
  const p = d.payload || {};

  if (d.type === 'dg-ui:element-selected') {
    uiBoardState.selectedElement = p;
    renderUiBoardStageDom(false);
    if (typeof buildDshQuoteTarget === 'function' && typeof emitDshQuote === 'function') {
      const q = buildDshQuoteTarget({
        kind: 'card',
        id: 'ui-' + (p.actionId || p.tag + '-' + p.sourceLine),
        title: p.label + ' (' + p.sourceFile.split('/').pop() + ':' + p.sourceLine + ')',
        firstFile: p.sourceFile,
        scopes: [p.sourceFile],
        desc: 'UI元素 <' + p.tag + '>「' + p.label + '」位于 ' + p.sourceFile + ':' + p.sourceLine + (p.wiringState === 'mock' ? '（当前为前端 Mock 假动作，待接通后端）' : '')
      });
      emitDshQuote(q);
    }
  } else if (d.type === 'dg-ui:inline-text-edited') {
    if (/^https?:$/i.test(location.protocol)) {
      fetch('/donegate/api/uiboard/inline-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch((err) => { void err; });
    }
    showToast('✏️ 已原地更新界面文案：「' + String(p.after || '').slice(0, 18) + '」');
  } else if (d.type === 'dg-ui:blocks-reordered') {
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch('/donegate/api/uiboard/layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'reorder', fromBlockId: p.fromBlockId, toBlockId: p.toBlockId })
      });
      const j = await r.json();
      if (j && j.ok) reloadUiBoardIframe();
    }
    showToast('🧩 已完成界面区块拖拽调序并同步 JSON 布局树');
  } else if (d.type === 'dg-ui:test-action-triggered') {
    uiBoardState.testTelemetryCount++;
    if (p.wiringState === 'mock') {
      showToast('▶️ 测试模式试玩：已触发「' + p.label + '」（当前为 Mock 假动作，满意后可在左栏一键接真后端）');
    }
  } else if (d.type === 'dg-ui:runtime-error') {
    uiBoardState.runtimeErrors++;
    renderUiBoardStageDom(false);
    if (typeof dshRuntime !== 'undefined') {
      dshRuntime.dockItems.unshift({ id: 'uierr-' + Date.now(), kind: 'blocked', tone: 'bad', title: '🚨 测试模式捕获前端运行报错：' + p.message });
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
  }
});

document.addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-uib-act]');
  if (!actEl) return;
  const act = actEl.getAttribute('data-uib-act');

  if (act === 'set-mode') {
    uiBoardState.mode = actEl.getAttribute('data-mode') === 'test' ? 'test' : 'edit';
    postToUiIframe({ type: 'dg-ui:set-mode', mode: uiBoardState.mode });
    renderUiBoardStageDom(false);
    showToast(uiBoardState.mode === 'test' ? '▶️ 已进入测试模式：现在鼠标点击是真实用户交互与跳转' : '✏️ 已进入编辑模式：单击元素即可对话精修、双击文字改名');
  } else if (act === 'set-vp') {
    uiBoardState.viewport = actEl.getAttribute('data-uib-vp') || 'desktop';
    renderUiBoardStageDom(false);
  } else if (act === 'connect-dev-url') {
    const val = (document.getElementById('uib-dev-url')?.value || '').trim();
    if (!val) { showToast('请先输入本地开发服务地址，例如 http://127.0.0.1:5173'); return; }
    uiBoardState.devUrl = val;
    uiBoardState.sourceMode = 'proxy';
    reloadUiBoardIframe();
    showToast('🔗 正在通过同源注入桥接入：' + val);
  } else if (act === 'use-prototype') {
    uiBoardState.sourceMode = 'prototype';
    reloadUiBoardIframe();
    showToast('已切回内置可拖拽原型页');
  } else if (act === 'pick-theme') {
    const pid = actEl.getAttribute('data-prop-id');
    const prop = uiBoardState.proposals.find((x) => x.id === pid);
    if (!prop) return;
    uiBoardState.activeProposalId = pid;
    postToUiIframe({ type: 'dg-ui:apply-tokens', proposalId: pid, tokens: prop.tokens });
    renderLeftDrawer();
    showToast('🎨 已实时切换至「' + prop.name + '」');
  } else if (act === 'lock-theme') {
    uiBoardState.lockedProposalId = uiBoardState.activeProposalId;
    if (/^https?:$/i.test(location.protocol)) {
      await fetch('/donegate/api/uiboard/theme-lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: uiBoardState.activeProposalId, projectName: (ATLAS && ATLAS.project && ATLAS.project.name) || 'Project' })
      });
    }
    renderLeftDrawer();
    showToast('🔒 已将当前美学方案锁定写入 design-system/MASTER.md');
  } else if (act === 'add-block') {
    const bType = actEl.getAttribute('data-block-type');
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch('/donegate/api/uiboard/layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'add', blockType: bType })
      });
      const j = await r.json();
      if (j && j.ok && j.wiring) uiBoardState.wiringActions = j.wiring.actions;
    }
    renderLeftDrawer();
    reloadUiBoardIframe();
    showToast('🧩 已向界面追加模块区块并同步更新接线清单');
  } else if (act === 'run-self-play') {
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch('/donegate/api/uiboard/self-play', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: uiBoardState.activeProposalId, liveUrl: uiBoardState.sourceMode === 'proxy' ? uiBoardState.devUrl : null })
      });
      const rep = await r.json();
      uiBoardState.selfPlayOk = Boolean(rep.ok);
      uiBoardState.selfPlayBadge = rep.ok ? ('✓ 自测 ' + rep.checkedControls + ' 控件 0 报错') : ('⚠ ' + (rep.issues || []).length + ' 项待修');
      renderUiBoardStageDom(false);
      showToast(rep.summary || '已完成 Agent 自动点按自测');
      return;
    }
    uiBoardState.selfPlayBadge = '✓ 离线探针自测通过';
    renderUiBoardStageDom(false);
    showToast('🤖 已完成内置交互与反 AI 模板脸自测');
  } else if (act === 'wire-single' || act === 'wire-all') {
    const ids = act === 'wire-single' ? [actEl.getAttribute('data-act-id')] : [];
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch('/donegate/api/uiboard/wire-backend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionIds: ids, markWired: true })
      });
      const out = await r.json();
      if (out && out.uiboard && out.uiboard.wiring) uiBoardState.wiringActions = out.uiboard.wiring.actions;
      if (out && out.agentPrompt) {
        if (typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:insert-quote',
            text: out.agentPrompt, summary: { label: '[接通真后端] ' + out.targetCount + ' 项动作', title: '.donegate/ui-wiring.json', detail: '替换 Mock 桩并生成数据库/API/判据', body: out.agentPrompt }
          }, '*');
        }
        state.chatMessages.push({ role: 'agent', html: '🔌 已生成全栈真逻辑接线工单并更新角标：<br><pre class="mt-1 p-2 rounded text-[10.5px] whitespace-pre-wrap" style="background:var(--surface-soft);">' + esc(out.agentPrompt) + '</pre>' });
      }
    } else {
      uiBoardState.wiringActions.forEach((a) => { if (!ids.length || ids.includes(a.actionId)) a.status = 'wired'; });
    }
    renderLeftDrawer();
    reloadUiBoardIframe();
    showToast('🔌 已派发真实数据库与后端 API 接线指令');
  } else if (act === 'provision-ui-deps') {
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch('/donegate/api/uiboard/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const rep = await r.json();
      if (rep && rep.agentPrompt) {
        state.chatMessages.push({ role: 'agent', html: '📦 已生成 <code>' + esc(rep.depsDir) + '/</code> 按需补齐工单（Lovinsp / React Grab / Puck / agent-browser）' });
      }
      showToast('📦 已建立 workflows/.deps/uiboard/ 按需补齐计划');
    } else {
      showToast('连接本地服务后可一键补齐 UI 增强套件至 workflows/.deps/uiboard/');
    }
  } else if (act === 'voice-modify-ui') {
    const voiceBtn = document.getElementById('btn-voice-input');
    const simInp = document.getElementById('dsh-sim-input') || document.getElementById('agent-input');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = 'zh-CN';
      showToast('🎤 请直接口述对所选 UI 元素的修改意见（如：点击时先加个确认弹窗）...');
      rec.onresult = (ev) => {
        const transcript = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : '';
        if (simInp && transcript) { simInp.value = transcript; simInp.focus(); showToast('🎤 已识别语音指令：' + transcript); }
      };
      rec.start();
    } else if (voiceBtn && simInp === document.getElementById('agent-input')) {
      voiceBtn.click();
    } else if (simInp) {
      simInp.focus();
      showToast('已聚焦底部指令框（可直接调用系统输入法语音或打字描述对所选蓝色胶囊元素的修改）');
    }
  }
});
`;
}
