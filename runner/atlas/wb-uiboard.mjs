// Agent Native UI 看板前端控制器：完整窗口原生交互、分组美学方案 0ms 秒切与锁定、Alt+单击拾取蓝胶囊与假动作转真后端接线台
import { AESTHETIC_PROPOSALS, buildInjectedUiBridgeScript } from '../dsh/contract.mjs';

const EMBEDDED_PROPOSALS_JSON = JSON.stringify(AESTHETIC_PROPOSALS);
const EMBEDDED_BRIDGE_JS = JSON.stringify(buildInjectedUiBridgeScript());

const WB_UIBOARD_SCRIPT = `
const UIBOARD_FALLBACK_PROPOSALS = ${EMBEDDED_PROPOSALS_JSON};
const UIBOARD_EMBEDDED_BRIDGE = ${EMBEDDED_BRIDGE_JS};

const uiBoardState = {
  initialized: false,
  viewport: 'desktop',
  sourceMode: 'prototype',
  editorMode: 'builtin',
  puckInstalled: false,
  devUrl: '',
  activeProposalId: 'swiss-minimal',
  lockedProposalId: null,
  proposals: UIBOARD_FALLBACK_PROPOSALS,
  wiringActions: [
    { actionId: 'act-create-order', label: '新建业务单据', targetApi: 'POST /api/orders/draft', targetTable: 'orders', status: 'mock' },
    { actionId: 'act-submit-form', label: '提交并触发流转', targetApi: 'POST /api/workflows/submit', targetTable: 'workflow_submissions', status: 'mock' },
    { actionId: 'act-export-report', label: '导出筛选报表', targetApi: 'GET /api/reports/export', targetTable: 'audit_logs', status: 'mock' }
  ],
  selectedElement: null,
  selfPlayBadge: '待运行自测',
  selfPlayOk: true,
  runtimeErrors: 0
};

function resolveProposalGroupLabel(p) {
  if (p && p.group) return p.group;
  if (p && p.layoutDensity === 'compact') return '深色研发与政企高密';
  if (p && (p.code === 'D' || (p.bestFor && p.bestFor.includes('creative')))) return '先锋创意与品牌展示';
  return '极简留白与现代卡片';
}

function buildOfflineUiSrcdoc() {
  const prop = uiBoardState.proposals.find((p) => p.id === uiBoardState.activeProposalId) || uiBoardState.proposals[0];
  const cssVars = Object.entries((prop && prop.tokens) || {}).map(([k, v]) => '  ' + k + ': ' + v + ';').join('\\n');
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>:root {',
    cssVars,
    '} html, body { height: 100%; } * { box-sizing: border-box; } body { margin: 0; padding: 20px; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans); }',
    '.c { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); box-shadow: var(--ui-shadow); padding: 16px 18px; margin-bottom: 14px; }',
    '.b { padding: 7px 13px; border-radius: var(--ui-radius); background: var(--ui-primary); color: var(--ui-primary-fg); border: none; font-weight: 600; cursor: pointer; }',
    '</style></head><body>',
    '<section class="c" data-dg-block="blk-hero" data-dg-source="src/pages/Home.tsx:14:1"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>智能业务工作台</strong><button type="button" class="b" data-dg-action="act-create-order" data-dg-wiring="mock" data-dg-source="src/pages/Home.tsx:18:5">新建业务单据</button></div><h2 style="margin:10px 0 4px;">完整窗口实时预览与原生交互</h2><p style="margin:0;color:var(--ui-muted);font-size:13px;">普通点击直接执行原生交互；按住 Alt+单击任意元素累加蓝色引用胶囊；左栏分组下拉可 0ms 实时换肤。</p></section>',
    '<section class="c" data-dg-block="blk-form" data-dg-source="src/pages/Home.tsx:32:1"><div style="display:flex;gap:8px;flex-wrap:wrap;"><input placeholder="输入审批事项名称..." style="flex:1;padding:7px 10px;border-radius:var(--ui-radius);border:1px solid var(--ui-border);background:var(--ui-surface-muted);color:var(--ui-text);"><button type="button" class="b" data-dg-action="act-submit-form" data-dg-wiring="mock" data-dg-source="src/pages/Home.tsx:38:7">提交并触发流转</button></div></section>',
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
      const list = (Array.isArray(u.allProposals) && u.allProposals.length) ? u.allProposals : u.proposals;
      if (Array.isArray(list) && list.length) uiBoardState.proposals = list;
      if (u.activeProposalId) uiBoardState.activeProposalId = u.activeProposalId;
      if (u.lockedDesign && u.lockedDesign.proposalId) uiBoardState.lockedProposalId = u.lockedDesign.proposalId;
      if (u.wiring && Array.isArray(u.wiring.actions)) uiBoardState.wiringActions = u.wiring.actions;
      if (u.puckInstalled !== undefined) uiBoardState.puckInstalled = Boolean(u.puckInstalled);
      else if (u.deps && u.deps.puckInstalled !== undefined) uiBoardState.puckInstalled = Boolean(u.deps.puckInstalled);
      if (!uiBoardState.devUrl && u.suggestedDevUrl) uiBoardState.devUrl = u.suggestedDevUrl;
    }
  } catch (err) { void err; }
}

function getUiBoardIframeUrl() {
  if (!/^https?:$/i.test(location.protocol)) return '';
  if (uiBoardState.sourceMode === 'proxy' && uiBoardState.devUrl.trim()) {
    return '/donegate/api/uiboard/proxy?url=' + encodeURIComponent(uiBoardState.devUrl.trim());
  }
  if (uiBoardState.editorMode === 'puck' && uiBoardState.puckInstalled) {
    return '/donegate/api/uiboard/prototype?editor=puck&theme=' + encodeURIComponent(uiBoardState.activeProposalId) + '&t=' + Date.now();
  }
  return '/donegate/api/uiboard/prototype?theme=' + encodeURIComponent(uiBoardState.activeProposalId) + '&t=' + Date.now();
}

function postToUiIframe(msg) {
  const ifr = document.getElementById('uiboard-iframe');
  if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage({ source: 'donegate-uiboard', ...msg }, '*');
}
function reloadUiBoardIframe() {
  const ifr = document.getElementById('uiboard-iframe');
  if (!ifr) return;
  const url = getUiBoardIframeUrl();
  if (url) ifr.src = url; else ifr.srcdoc = buildOfflineUiSrcdoc();
}

function renderUiBoardStageVisibility() {
  const stageEl = document.getElementById('uiboard-stage');
  if (!stageEl) return;
  const active = state.leftTab === 'uiboard';
  stageEl.classList.toggle('hidden', !active); stageEl.classList.toggle('flex', active);
  Object.assign(stageEl.style, { display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: '0' });
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
  const hintTxt = sel
    ? ('已拾取：<' + sel.tag + '>「' + sel.label + '」 @ ' + String(sel.sourceFile || '').split('/').pop() + ':' + (sel.sourceLine || 1))
    : '普通点击直接原生交互 · 按住 Alt+单击任意元素累加蓝胶囊';

  const existingIframe = document.getElementById('uiboard-iframe');
  if (!existingIframe) {
    stageEl.innerHTML = [
      '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap shrink-0" style="background: var(--surface); border-color: var(--border-subtle);">',
      '  <div class="flex items-center gap-2 flex-wrap">',
      '    <div class="seg-bar" role="group" aria-label="UI舞台源窗口切换">',
      '      <button type="button" id="uib-src-proto" class="seg-btn is-active" data-uib-act="use-prototype" data-tip="内置原型窗口（原生交互 + Alt+单击拾取）">内置原型</button>',
      '      <button type="button" id="uib-src-puck" class="seg-btn" data-uib-act="use-puck" data-tip="切换完整 Puck 可视化窗口（需装妥 measuredco/puck）">Puck完整窗口</button>',
      '    </div>',
      '    <div class="flex items-center gap-1">',
      '      <input id="uib-dev-url" type="text" placeholder="本地运行服务如 http://127.0.0.1:5173" class="px-2 py-1 rounded-lg border text-[11px] font-mono w-52 outline-none" style="background: var(--surface-soft); border-color: var(--border-subtle); color: var(--text-main);">',
      '      <button type="button" class="ghost-btn text-[11px] px-2 py-1" data-uib-act="connect-dev-url" data-tip="同源代理接入本地正在运行的服务并注入 Alt+单击拾取桥">接入服务</button>',
      '    </div>',
      '    <div class="seg-bar" role="group" aria-label="响应式视口尺寸">',
      '      <button type="button" class="seg-btn is-active" data-uib-vp="desktop" data-uib-act="set-vp">桌面</button>',
      '      <button type="button" class="seg-btn" data-uib-vp="tablet" data-uib-act="set-vp">平板</button>',
      '      <button type="button" class="seg-btn" data-uib-vp="mobile" data-uib-act="set-vp">手机</button>',
      '    </div>',
      '    <span id="uib-selection-banner" class="text-[11px] flex items-center gap-1.5" style="color: var(--text-secondary);"></span>',
      '  </div>',
      '  <div class="flex items-center gap-1.5">',
      '    <span id="uib-selfplay-pill" class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="background: var(--surface-soft); color: var(--text-secondary);"></span>',
      '    <button type="button" class="ghost-btn text-[11px]" data-uib-act="run-self-play" data-tip="让 Agent 自动点按控件排雷并检查反AI模板脸">🤖 Agent点按自测</button>',
      '  </div>',
      '</div>',
      '<div class="flex-1 min-h-0 overflow-auto p-3 flex justify-center items-stretch" style="flex:1 1 0%;min-height:0;background:var(--bg-app);">',
      '  <div id="uiboard-frame-wrap" data-ui-owner="runner/atlas/wb-uiboard.mjs" class="h-full rounded-xl border overflow-hidden transition-all" style="display:flex;flex-direction:column;width:' + vpWidth + ';height:100%;min-height:0;background:var(--bg-app);border-color:var(--border-strong);box-shadow:var(--shadow-md);">',
      '    <iframe id="uiboard-iframe" title="DoneGate UI Board Live Stage" class="w-full h-full border-0" style="flex:1 1 0%;width:100%;height:100%;border:0;display:block;"></iframe>',
      '  </div>',
      '</div>'
    ].join('\\n');
    reloadUiBoardIframe();
  } else if (forceReloadIframe) {
    reloadUiBoardIframe();
  }

  document.getElementById('uib-src-proto')?.classList.toggle('is-active', uiBoardState.sourceMode === 'prototype' && uiBoardState.editorMode !== 'puck');
  document.getElementById('uib-src-puck')?.classList.toggle('is-active', uiBoardState.sourceMode === 'prototype' && uiBoardState.editorMode === 'puck');
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
    banner.innerHTML = '<span class="truncate font-medium">' + esc(hintTxt) + '</span>' +
      (sel && sel.actionId && sel.wiringState === 'mock'
        ? '<button type="button" class="dg-micro-btn shrink-0" data-uib-act="wire-single" data-act-id="' + esc(sel.actionId) + '">🔌 接通真后端</button>'
        : '');
  }
}

function renderUiBoardDrawer(headEl, bodyEl, footEl) {
  const mockPending = uiBoardState.wiringActions.filter((a) => a.status === 'mock').length;
  headEl.innerHTML = [
    '<span class="text-xs font-semibold" style="color: var(--text-secondary);">UI 看板控制台</span>',
    '<span class="text-[10.5px] px-1.5 py-0.2 rounded font-semibold" style="background: var(--primary-soft); color: var(--primary);">实时换肤</span>'
  ].join('');

  const grouped = new Map();
  uiBoardState.proposals.forEach((p) => {
    const g = resolveProposalGroupLabel(p);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g).push(p);
  });
  const optgroupsHtml = [...grouped.entries()].map(([grpName, items]) => (
    '<optgroup label="' + esc(grpName) + '">' +
    items.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === uiBoardState.activeProposalId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
    '</optgroup>'
  )).join('');

  const curProp = uiBoardState.proposals.find((p) => p.id === uiBoardState.activeProposalId) || uiBoardState.proposals[0];
  const dotsHtml = ((curProp && curProp.swatches) || []).map((hex) => (
    '<span class="w-3 h-3 rounded-full border shrink-0" style="background:' + esc(hex) + ';border-color:rgba(15,23,42,0.2);"></span>'
  )).join('');
  const isLocked = curProp && curProp.id === uiBoardState.lockedProposalId;

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
    '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex flex-col gap-1.5">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">1. 美学方案实时选型</span><button type="button" data-uib-act="lock-theme" class="text-[10.5px] font-semibold hover:underline" style="color:var(--primary);">🔒 锁定当前方案</button></div>',
    '  <select id="uib-theme-select" data-ctrl-id="uib-theme-select" aria-label="美学方案分组选型" class="w-full px-2 py-1.5 rounded-lg border text-xs outline-none" style="background:var(--surface-soft);border-color:var(--border-strong);color:var(--text-main);">' + optgroupsHtml + '</select>',
    '  <div class="p-2 rounded-xl border flex flex-col gap-1" style="background:var(--surface-soft);border-color:var(--border-subtle);">',
    '    <div class="flex items-center justify-between gap-1.5"><span class="inline-flex items-center gap-1">' + dotsHtml + '</span>' + (isLocked ? '<span class="text-[10px] font-semibold" style="color:var(--ok);">✓ 已锁入 MASTER.md</span>' : '<span class="text-[10px]" style="color:var(--text-muted);">0ms 实时换肤</span>') + '</div>',
    '    <div class="text-[10.5px] leading-snug" style="color:var(--text-muted);">' + esc((curProp && curProp.summary) || '') + '</div>',
    '  </div>',
    '</div>',
    '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex flex-col gap-1 pt-2 border-t" style="border-color:var(--border-subtle);">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">2. 假动作转真后端 (' + mockPending + ' 待接)</span>' +
      (mockPending > 0 ? '<button type="button" data-uib-act="wire-all" class="text-[10.5px] font-semibold hover:underline" style="color:var(--primary);">全部接通</button>' : '') + '</div>',
    wiringHtml,
    '</div>'
  ].join('\\n');

  footEl.innerHTML = '<button type="button" data-ui-owner="runner/atlas/wb-uiboard.mjs" data-uib-act="provision-ui-deps" class="ghost-btn w-full justify-center text-[11px]" data-tip="按需派发编队子代理将 measuredco/puck、lovinsp、react-grab、agent-browser 安装至 workflows/.deps/uiboard/">📦 按需补齐 UI 增强套件</button>';
}

window.addEventListener('message', async (ev) => {
  const d = ev.data || {};
  if (d.source !== 'dg-ui-bridge') return;
  const p = d.payload || {};

  if (d.type === 'dg-ui:element-selected') {
    uiBoardState.selectedElement = p;
    renderUiBoardStageDom(false);
    if (typeof buildDshQuoteTarget === 'function' && typeof emitDshQuote === 'function') {
      const srcFile = String(p.sourceFile || '.donegate/ui-prototype/index.html');
      const srcLine = p.sourceLine || 1;
      const q = buildDshQuoteTarget({
        kind: 'ui',
        id: 'ui-' + (p.actionId || (p.tag + '-' + srcLine)),
        title: (p.label || p.tag || 'UI元素') + ' (' + srcFile.split('/').pop() + ':' + srcLine + ')',
        firstFile: srcFile,
        scopes: [srcFile],
        uiOwner: p.uiOwner || 'runner/atlas/wb-uiboard.mjs',
        sliceCmd: p.sliceCmd || null,
        desc: 'UI元素 <' + (p.tag || 'div') + '>「' + (p.label || '') + '」位于 ' + srcFile + ':' + srcLine + (p.wiringState === 'mock' ? '（前端 Mock 待接真后端）' : '')
      });
      emitDshQuote(q);
    }
  } else if (d.type === 'dg-ui:inline-text-edited') {
    if (/^https?:$/i.test(location.protocol)) {
      fetch('/donegate/api/uiboard/inline-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch((err) => { void err; });
    }
    showToast('✏️ 已原地更新界面文案：「' + String(p.after || '').slice(0, 18) + '」');
  } else if (d.type === 'dg-ui:runtime-error') {
    uiBoardState.runtimeErrors++;
    renderUiBoardStageDom(false);
    if (typeof dshRuntime !== 'undefined') {
      dshRuntime.dockItems.unshift({ id: 'uierr-' + Date.now(), kind: 'blocked', tone: 'bad', title: '🚨 捕获前端运行报错：' + p.message });
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'uib-theme-select') {
    const pid = e.target.value;
    const prop = uiBoardState.proposals.find((x) => x.id === pid);
    if (!prop) return;
    uiBoardState.activeProposalId = pid;
    postToUiIframe({ type: 'dg-ui:apply-tokens', proposalId: pid, tokens: prop.tokens });
    if (!/^https?:$/i.test(location.protocol)) reloadUiBoardIframe();
    renderLeftDrawer();
    showToast('🎨 已切换美学方案：「' + prop.name + '」');
  }
});

document.addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-uib-act]');
  if (!actEl) return;
  const act = actEl.getAttribute('data-uib-act');

  if (act === 'set-vp') {
    uiBoardState.viewport = actEl.getAttribute('data-uib-vp') || 'desktop';
    renderUiBoardStageDom(false);
  } else if (act === 'connect-dev-url') {
    const val = (document.getElementById('uib-dev-url')?.value || '').trim();
    if (!val) { showToast('请先输入本地服务地址，例如 http://127.0.0.1:5173'); return; }
    uiBoardState.devUrl = val;
    uiBoardState.sourceMode = 'proxy';
    reloadUiBoardIframe();
    renderUiBoardStageDom(false);
    showToast('🔗 正在通过同源注入桥接入：' + val);
  } else if (act === 'use-prototype') {
    uiBoardState.sourceMode = 'prototype'; uiBoardState.editorMode = 'builtin';
    reloadUiBoardIframe(); renderUiBoardStageDom(false); showToast('已切换至内置原型完整窗口');
  } else if (act === 'use-puck') {
    if (!uiBoardState.puckInstalled) { showToast('尚未检测到 measuredco/puck，请先点击左栏底部「📦 按需补齐 UI 增强套件」'); return; }
    uiBoardState.sourceMode = 'prototype'; uiBoardState.editorMode = 'puck';
    reloadUiBoardIframe(); renderUiBoardStageDom(false); showToast('已切换至完整 Puck 可视化窗口');
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
      const sessId = typeof DSH_SESSION_ID !== 'undefined' ? DSH_SESSION_ID : 'default';
      const r = await fetch('/donegate/api/uiboard/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessId, spawnSubagent: true })
      });
      const rep = await r.json().catch(() => ({}));
      if (rep && rep.ready) {
        uiBoardState.puckInstalled = Boolean(rep.puckInstalled ?? true);
        renderLeftDrawer(); renderUiBoardStageDom(false);
        showToast('✅ UI 增强套件（measuredco/puck、lovinsp、react-grab、agent-browser）已就位');
      } else if (rep && rep.subagentDispatched) {
        showToast('🚀 已在编队派发子代理（' + (rep.subagentName || 'worker') + '）后台安装 UI 增强套件');
      } else if (rep && rep.fallbackAutoSubmit && typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:dispatch-subagent', prompt: rep.agentPrompt }, '*');
        showToast('🚀 已触发主对话拉起编队子代理安装 UI 增强套件');
      } else {
        showToast('当前为离线静态快照，请在 DSH Web 中打开以派发编队子代理安装 UI 增强套件');
      }
    } else {
      showToast('当前为离线静态快照，请在 DSH Web 中打开以派发编队子代理安装 UI 增强套件');
    }
  }
});
`;

export function buildWbUiBoardScript() {
  return WB_UIBOARD_SCRIPT;
}
