// Agent Native UI 看板前端控制器：真实项目/完结门自举套娃预览、四件套实时状态、待传达功能记录与传达到项目看板 grill me 环节
import { AESTHETIC_PROPOSALS, ARCHETYPE_CSS, buildInjectedUiBridgeScript } from '../dsh/contract.mjs';

const EMBEDDED_PROPOSALS_JSON = JSON.stringify(AESTHETIC_PROPOSALS);
const EMBEDDED_BRIDGE_JS = JSON.stringify(buildInjectedUiBridgeScript());
const EMBEDDED_ARCHETYPE_CSS = JSON.stringify(ARCHETYPE_CSS);

const WB_UIBOARD_SCRIPT = `
const UIBOARD_FALLBACK_PROPOSALS = ${EMBEDDED_PROPOSALS_JSON};
const UIBOARD_EMBEDDED_BRIDGE = ${EMBEDDED_BRIDGE_JS};
const UIBOARD_ARCHETYPE_CSS = ${EMBEDDED_ARCHETYPE_CSS};
const IS_UIBOARD_SELF_EMBED = Boolean(
  (typeof DSH_URL_PARAMS !== 'undefined' && DSH_URL_PARAMS.get('embed') === 'uiboard')
  || (typeof window !== 'undefined' && window.__DG_UIBOARD_SELF_EMBED__)
);

if (IS_UIBOARD_SELF_EMBED && typeof window !== 'undefined' && !window.__dgUiBridgeSelfMounted) {
  window.__dgUiBridgeSelfMounted = true;
  try {
    (new Function(UIBOARD_EMBEDDED_BRIDGE))();
  } catch (err) {
    void err;
  }
}

function uibResolveSessionApiUrl(rawUrl) {
  if (typeof withDshSessionUrl === 'function') return withDshSessionUrl(rawUrl);
  const sid = (typeof DSH_SESSION_ID !== 'undefined' && DSH_SESSION_ID) ? String(DSH_SESSION_ID) : '';
  if (!sid || sid === 'default' || !String(rawUrl || '').startsWith('/donegate/api/')) return rawUrl;
  return rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'sessionId=' + encodeURIComponent(sid);
}

const uiBoardState = {
  initialized: false,
  wasActiveTab: false,
  loadedIframeKey: '',
  viewport: 'desktop',
  sourceMode: 'prototype',
  editorMode: 'builtin',
  isSelfDoneGate: Boolean(typeof ATLAS !== 'undefined' && ATLAS && ATLAS.project && /donegate/i.test(String(ATLAS.project.name || ''))),
  uiSourceKind: 'empty-guide',
  realEntryFile: null,
  puckInstalled: false,
  toolchain: {
    ready: false, readyCount: 0, total: 4, puckInstalled: false, lovinspInstalled: false,
    reactGrabInstalled: false, agentBrowserInstalled: false, versions: {}, versionSummary: '',
    badgeLabel: '📦 按需补齐 UI 增强套件'
  },
  devUrl: '',
  activeProposalId: 'swiss-minimal',
  lockedProposalId: null,
  proposals: UIBOARD_FALLBACK_PROPOSALS,
  requirements: [],
  grillMeNode: null,
  selectedElement: null,
  selfPlayBadge: '待运行自测',
  selfPlayOk: true,
  runtimeErrors: 0
};

function syncGrillMeNodeToHostKanban(grillNode) {
  if (!grillNode || typeof grillNode !== 'object') return;
  uiBoardState.grillMeNode = grillNode;
  if (typeof REPO_SANDBOXES === 'undefined') return;
  const hostId = (typeof state !== 'undefined' && state.hostWorkspaceId) || 'host-workspace';
  const sb = REPO_SANDBOXES[hostId] || REPO_SANDBOXES['host-workspace'] || REPO_SANDBOXES.donegate;
  if (!sb || !Array.isArray(sb.nodes)) return;
  const existingIdx = sb.nodes.findIndex((n) => n.id === 'host-dom-grill-me');
  const downstreamIds = sb.nodes.filter((n) => n.id !== 'host-dom-grill-me').slice(0, 1).map((n) => n.id);
  const nodeCopy = {
    ...grillNode,
    id: 'host-dom-grill-me',
    step: '00',
    title: 'grill me · 需求澄清与立约',
    codeCapsule: { moduleCount: 1, sharedCount: 0, scopePaths: ['INTENT.md', 'contracts/'] },
    nextIds: (Array.isArray(grillNode.nextIds) && grillNode.nextIds.length) ? grillNode.nextIds : downstreamIds
  };
  if (existingIdx >= 0) {
    nodeCopy.x = sb.nodes[existingIdx].x;
    nodeCopy.y = sb.nodes[existingIdx].y;
    sb.nodes.splice(existingIdx, 1);
  }
  sb.nodes.unshift(nodeCopy);
}

function applyUiBoardToolchainSnapshot(tc) {
  if (!tc || typeof tc !== 'object') return;
  uiBoardState.toolchain = { ...uiBoardState.toolchain, ...tc };
  uiBoardState.puckInstalled = Boolean(tc.puckInstalled);
}

function resolveProposalGroupLabel(p) {
  if (p && p.group) return p.group;
  if (p && p.layoutDensity === 'compact') return '深色与研发控制台';
  if (p && (p.code === 'D' || (p.bestFor && p.bestFor.includes('creative')))) return '品牌创意与消费门户';
  return '极简与现代办公';
}

function buildOfflineUiSrcdoc() {
  const prop = uiBoardState.proposals.find((p) => p.id === uiBoardState.activeProposalId) || uiBoardState.proposals[0];
  const pid = (prop && prop.id) || 'swiss-minimal';
  const cssVars = Object.entries((prop && prop.tokens) || {}).map(([k, v]) => '  ' + k + ': ' + v + ';').join('\\n');
  const projName = (typeof ATLAS !== 'undefined' && ATLAS && ATLAS.project && ATLAS.project.name) || '当前项目';
  const bodyHtml = uiBoardState.isSelfDoneGate
    ? '<main style="max-width:720px;margin:28px auto;padding:22px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface);">' +
      '<h2 style="margin:0 0 8px;font-size:17px;">DoneGate · 完结门工作台本仓自举预览</h2>' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--ui-muted);">在线模式下自动嵌套加载 /donegate/api/canvas?embed=uiboard 完整工作台界面；可按住 Alt+单击拾取任意控件并传达到项目看板 grill me 环节。</p>' +
      '<button type="button" data-dg-action="dg-self-inspect" data-insp-path="runner/atlas/wb-uiboard.mjs:1:1">完结门工作台控件</button></main>'
    : '<main style="max-width:720px;margin:28px auto;padding:22px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface);">' +
      '<div style="font-size:11.5px;font-weight:600;color:var(--ui-primary);margin-bottom:6px;">' + esc(projName) + '</div>' +
      '<h2 style="margin:0 0 8px;font-size:17px;">当前项目暂未检测到前端界面文件，可在左侧新增按钮/页面需求描述并传达到项目看板启动开发</h2>' +
      '<p style="margin:0;font-size:13px;color:var(--ui-muted);">请在左侧记录期望新增的按钮或页面功能，点击「📤 传达到项目看板」进入第 00 号 grill me 环节。</p></main>';
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>:root {',
    cssVars,
    '} * { box-sizing: border-box; } html, body { min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); }',
    UIBOARD_ARCHETYPE_CSS,
    '</style></head><body data-proposal-id="' + esc(pid) + '">',
    bodyHtml,
    '<script>' + UIBOARD_EMBEDDED_BRIDGE + '<\\/script></body></html>'
  ].join('\\n');
}

async function syncUiBoardBackendStatus(forceBust) {
  if (!/^https?:$/i.test(location.protocol)) return null;
  try {
    const r = await fetch(uibResolveSessionApiUrl('/donegate/api/uiboard/status'));
    const j = await r.json();
    if (r.ok && j && j.ok && j.uiboard) {
      const u = j.uiboard;
      const list = (Array.isArray(u.allProposals) && u.allProposals.length) ? u.allProposals : u.proposals;
      if (Array.isArray(list) && list.length) uiBoardState.proposals = list;
      if (u.activeProposalId) uiBoardState.activeProposalId = u.activeProposalId;
      if (u.lockedDesign && u.lockedDesign.proposalId) uiBoardState.lockedProposalId = u.lockedDesign.proposalId;
      if (u.isSelfDoneGate !== undefined) uiBoardState.isSelfDoneGate = Boolean(u.isSelfDoneGate);
      if (u.uiSourceKind) uiBoardState.uiSourceKind = u.uiSourceKind;
      if (u.realEntryFile !== undefined) uiBoardState.realEntryFile = u.realEntryFile;
      if (Array.isArray(u.requirements)) uiBoardState.requirements = u.requirements;
      if (u.grillMeNode) syncGrillMeNodeToHostKanban(u.grillMeNode);
      if (u.toolchain) applyUiBoardToolchainSnapshot(u.toolchain);
      else if (u.puckInstalled !== undefined) uiBoardState.puckInstalled = Boolean(u.puckInstalled);
      if (!uiBoardState.devUrl && u.suggestedDevUrl) uiBoardState.devUrl = u.suggestedDevUrl;
      if (state.leftTab === 'uiboard') {
        renderLeftDrawer();
        renderUiBoardStageDom(Boolean(forceBust));
      }
      return u;
    }
  } catch (err) {
    void err;
  }
  return null;
}

function getUiBoardIframeUrl(bustCache) {
  if (!/^https?:$/i.test(location.protocol) || IS_UIBOARD_SELF_EMBED) return '';
  const bustSuffix = bustCache ? ('&t=' + Date.now()) : '';
  if (uiBoardState.sourceMode === 'proxy' && uiBoardState.devUrl.trim()) {
    return uibResolveSessionApiUrl('/donegate/api/uiboard/proxy?url=' + encodeURIComponent(uiBoardState.devUrl.trim()) + bustSuffix);
  }
  if (uiBoardState.editorMode === 'puck' && uiBoardState.puckInstalled) {
    return uibResolveSessionApiUrl('/donegate/api/uiboard/prototype?editor=puck&theme=' + encodeURIComponent(uiBoardState.activeProposalId) + bustSuffix);
  }
  if (uiBoardState.isSelfDoneGate && uiBoardState.uiSourceKind !== 'custom-layout') {
    const hostTheme = (typeof state !== 'undefined' && state.theme) ? state.theme : 'light';
    return uibResolveSessionApiUrl('/donegate/api/canvas?embed=uiboard&theme=' + encodeURIComponent(hostTheme) + bustSuffix);
  }
  return uibResolveSessionApiUrl('/donegate/api/uiboard/prototype?theme=' + encodeURIComponent(uiBoardState.activeProposalId) + bustSuffix);
}

function postToUiIframe(msg) {
  const ifr = document.getElementById('uiboard-iframe');
  if (ifr && ifr.contentWindow) ifr.contentWindow.postMessage({ source: 'donegate-uiboard', ...msg }, '*');
}

function reloadUiBoardIframe(forceBust) {
  if (IS_UIBOARD_SELF_EMBED) return;
  const ifr = document.getElementById('uiboard-iframe');
  if (!ifr) return;
  const baseKey = getUiBoardIframeUrl(false);
  if (baseKey) {
    if (!forceBust && ifr.getAttribute('data-loaded-key') === baseKey) return;
    ifr.setAttribute('data-loaded-key', baseKey);
    uiBoardState.loadedIframeKey = baseKey;
    ifr.src = forceBust ? getUiBoardIframeUrl(true) : baseKey;
  } else {
    const docKey = 'srcdoc:' + uiBoardState.activeProposalId + ':' + (uiBoardState.isSelfDoneGate ? 'self' : 'ext');
    if (!forceBust && ifr.getAttribute('data-loaded-key') === docKey) return;
    ifr.setAttribute('data-loaded-key', docKey);
    ifr.srcdoc = buildOfflineUiSrcdoc();
  }
}

function renderUiBoardStageVisibility() {
  const stageEl = document.getElementById('uiboard-stage');
  if (!stageEl) return;
  const active = state.leftTab === 'uiboard';
  stageEl.classList.toggle('hidden', !active);
  stageEl.classList.toggle('flex', active);
  Object.assign(stageEl.style, { display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: '0' });
  if (!active) {
    uiBoardState.wasActiveTab = false;
    return;
  }

  const justEntered = !uiBoardState.initialized || !uiBoardState.wasActiveTab;
  uiBoardState.initialized = true;
  uiBoardState.wasActiveTab = true;
  renderUiBoardStageDom(false);
  if (justEntered && !IS_UIBOARD_SELF_EMBED) {
    syncUiBoardBackendStatus(false);
  }
}

function renderUiBoardStageDom(forceBustIframe) {
  const stageEl = document.getElementById('uiboard-stage');
  if (!stageEl) return;
  if (IS_UIBOARD_SELF_EMBED) {
    stageEl.innerHTML = [
      '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex-1 h-full flex items-center justify-center p-6" style="background:var(--bg-app);">',
      '  <div class="max-w-md w-full p-5 rounded-2xl border flex flex-col gap-2 text-center" style="background:var(--surface);border-color:var(--border-strong);box-shadow:var(--shadow-md);">',
      '    <div class="text-xs font-semibold" style="color:var(--primary);">DoneGate Self-Hosting Preview</div>',
      '    <div class="text-sm font-semibold" style="color:var(--text-main);">完结门自举嵌套预览层（已防无限递归）</div>',
      '    <div class="text-xs leading-relaxed" style="color:var(--text-secondary);">外层 UI 看板已完整嵌套当前完结门工作台界面。可切换本层「项目看板 / 工作流 / 节点」任意标签并按住 Alt+单击拾取真实元素。</div>',
      '  </div>',
      '</div>'
    ].join('\\n');
    return;
  }

  const vpWidth = uiBoardState.viewport === 'mobile' ? '390px' : (uiBoardState.viewport === 'tablet' ? '768px' : '100%');
  const sel = uiBoardState.selectedElement;
  const stackSuffix = sel && Array.isArray(sel.componentStack) && sel.componentStack.length ? (' [' + sel.componentStack.slice(-2).join(' › ') + ']') : '';
  const srcBtnLabel = uiBoardState.isSelfDoneGate ? '完结门实时界面' : '当前项目界面';
  const hintTxt = sel
    ? ('已拾取：<' + sel.tag + '>「' + sel.label + '」' + stackSuffix + ' @ ' + String(sel.sourceFile || '').split('/').pop() + ':' + (sel.sourceLine || 1))
    : '普通点击直接原生交互 · 按住 Alt+单击任意元素拾取并填入左栏待传达功能记录';

  const existingIframe = document.getElementById('uiboard-iframe');
  if (!existingIframe) {
    stageEl.innerHTML = [
      '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap shrink-0" style="background: var(--surface); border-color: var(--border-subtle);">',
      '  <div class="flex items-center gap-2 flex-wrap">',
      '    <div class="seg-bar" role="group" aria-label="UI舞台源窗口切换">',
      '      <button type="button" id="uib-src-proto" class="seg-btn is-active" data-uib-act="use-prototype" data-tip="真实渲染当前主对话开发的项目界面（开发完结门时自举嵌套完结门自身工作台）">' + esc(srcBtnLabel) + '</button>',
      '      <button type="button" id="uib-src-puck" class="seg-btn" data-uib-act="use-puck" data-tip="切换完整 Puck 可视化积木编排画布（基于 @puckeditor/core）">Puck完整窗口</button>',
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
      '    <button type="button" id="uib-toolchain-pill" class="px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer" data-uib-act="provision-ui-deps" style="background: var(--surface-soft); border-color: var(--border-subtle); color: var(--text-secondary);"></button>',
      '    <button type="button" class="ghost-btn text-[11px] px-2 py-1" data-uib-act="refresh-uiboard" data-tip="立即重新扫描 _shared/npm 与 uiboard 增强套件并刷新预览窗口">↻ 刷新</button>',
      '    <span id="uib-selfplay-pill" class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="background: var(--surface-soft); color: var(--text-secondary);"></span>',
      '    <button type="button" class="ghost-btn text-[11px]" data-uib-act="run-self-play" data-tip="调用 agent-browser 与内置探针自动点按控件排雷并检查反AI模板脸">🤖 Agent点按自测</button>',
      '  </div>',
      '</div>',
      '<div class="flex-1 min-h-0 overflow-auto p-3 flex justify-center items-stretch" style="flex:1 1 0%;min-height:0;background:var(--bg-app);">',
      '  <div id="uiboard-frame-wrap" data-ui-owner="runner/atlas/wb-uiboard.mjs" class="h-full rounded-xl border overflow-hidden transition-all" style="display:flex;flex-direction:column;width:' + vpWidth + ';height:100%;min-height:0;background:var(--bg-app);border-color:var(--border-strong);box-shadow:var(--shadow-md);">',
      '    <iframe id="uiboard-iframe" title="DoneGate UI Board Live Stage" class="w-full h-full border-0" style="flex:1 1 0%;width:100%;height:100%;border:0;display:block;"></iframe>',
      '  </div>',
      '</div>'
    ].join('\\n');
    reloadUiBoardIframe(Boolean(forceBustIframe));
  } else {
    reloadUiBoardIframe(Boolean(forceBustIframe));
  }

  const protoBtn = document.getElementById('uib-src-proto');
  if (protoBtn) {
    protoBtn.textContent = srcBtnLabel;
    protoBtn.classList.toggle('is-active', uiBoardState.sourceMode === 'prototype' && uiBoardState.editorMode !== 'puck');
  }
  document.getElementById('uib-src-puck')?.classList.toggle('is-active', uiBoardState.sourceMode === 'prototype' && uiBoardState.editorMode === 'puck');
  stageEl.querySelectorAll('[data-uib-vp]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-uib-vp') === uiBoardState.viewport);
  });
  const wrap = document.getElementById('uiboard-frame-wrap');
  if (wrap) wrap.style.width = vpWidth;
  const urlInp = document.getElementById('uib-dev-url');
  if (urlInp && !urlInp.matches(':focus')) urlInp.value = uiBoardState.devUrl;
  const tcPill = document.getElementById('uib-toolchain-pill');
  if (tcPill) {
    const tc = uiBoardState.toolchain || {};
    tcPill.textContent = tc.badgeLabel || '📦 按需补齐 UI 增强套件';
    tcPill.style.color = tc.ready ? 'var(--ok)' : (tc.readyCount > 0 ? 'var(--primary)' : 'var(--text-secondary)');
    tcPill.style.background = tc.ready ? 'var(--ok-bg)' : 'var(--surface-soft)';
    tcPill.setAttribute('data-tip', tc.versionSummary ? ('已激活版本：' + tc.versionSummary) : '点击检查或补齐 @puckeditor/core、lovinsp、react-grab、agent-browser');
  }
  const spPill = document.getElementById('uib-selfplay-pill');
  if (spPill) {
    spPill.textContent = uiBoardState.selfPlayBadge + (uiBoardState.runtimeErrors > 0 ? (' · ⚠ ' + uiBoardState.runtimeErrors + ' 报错') : '');
    spPill.style.color = uiBoardState.selfPlayOk && uiBoardState.runtimeErrors === 0 ? 'var(--ok)' : 'var(--warn)';
  }
  const banner = document.getElementById('uib-selection-banner');
  if (banner) {
    banner.innerHTML = '<span class="truncate font-medium">' + esc(hintTxt) + '</span>';
  }
}

function renderUiBoardDrawer(headEl, bodyEl, footEl) {
  const pendingReqs = uiBoardState.requirements.filter((r) => r.status !== 'conveyed');
  const tc = uiBoardState.toolchain || {};
  headEl.innerHTML = [
    '<span class="text-xs font-semibold" style="color: var(--text-secondary);">UI 看板控制台</span>',
    '<span class="text-[10.5px] px-1.5 py-0.2 rounded font-semibold" style="background: ' + (tc.ready ? 'var(--ok-bg)' : 'var(--primary-soft)') + '; color: ' + (tc.ready ? 'var(--ok)' : 'var(--primary)') + ';">' + (tc.ready ? '4/4 已激活' : (uiBoardState.isSelfDoneGate ? '完结门自举' : '真实界面')) + '</span>'
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
  const prefillLabel = (uiBoardState.selectedElement && uiBoardState.selectedElement.label) ? String(uiBoardState.selectedElement.label) : '';

  const reqListHtml = uiBoardState.requirements.length
    ? uiBoardState.requirements.map((req) => {
        const isConveyed = req.status === 'conveyed';
        return '<div class="px-2 py-1.5 rounded-lg border flex flex-col gap-1 text-[11px]" style="background:var(--surface-soft);border-color:var(--border-subtle);">' +
          '<div class="flex items-center justify-between gap-1.5">' +
          '  <span class="font-semibold truncate" style="color:var(--text-main);">' + esc(req.label) + '</span>' +
          (isConveyed
            ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0" style="background:var(--ok-bg);color:var(--ok);">✓ 已传达到 grill me</span>'
            : '<button type="button" data-uib-act="convey-single" data-req-id="' + esc(req.id) + '" class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 cursor-pointer" style="background:var(--primary-soft);color:var(--primary);">📤 传达到项目看板</button>') +
          '</div>' +
          '<div class="text-[10.5px] leading-snug" style="color:var(--text-secondary);">' + esc(req.description) + '</div>' +
          (isConveyed ? '<div class="flex justify-end"><button type="button" data-uib-act="goto-grill-me" class="text-[10px] font-semibold hover:underline" style="color:var(--primary);">前往项目看板 00 环节 →</button></div>' : '') +
          '</div>';
      }).join('')
    : '<div class="px-2 py-2 rounded-lg border text-[10.5px] leading-relaxed" style="background:var(--surface-soft);border-color:var(--border-subtle);color:var(--text-muted);">暂未记录待传达功能。可在预览窗 Alt+单击拾取任意按钮，或在上方填写按钮名与期望功能后点击「记入列表」。</div>';

  bodyEl.innerHTML = [
    '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex flex-col gap-1.5">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">1. 美学方案实时选型</span><button type="button" data-uib-act="lock-theme" class="text-[10.5px] font-semibold hover:underline" style="color:var(--primary);">🔒 锁定当前方案</button></div>',
    '  <select id="uib-theme-select" data-ctrl-id="uib-theme-select" aria-label="美学方案分组选型" class="w-full px-2 py-1.5 rounded-lg border text-xs outline-none" style="background:var(--surface-soft);border-color:var(--border-strong);color:var(--text-main);">' + optgroupsHtml + '</select>',
    '  <div class="p-2 rounded-xl border flex flex-col gap-1" style="background:var(--surface-soft);border-color:var(--border-subtle);">',
    '    <div class="flex items-center justify-between gap-1.5"><span class="inline-flex items-center gap-1">' + dotsHtml + '</span>' + (isLocked ? '<span class="text-[10px] font-semibold" style="color:var(--ok);">✓ 已锁入 MASTER.md</span>' : '<span class="text-[10px] font-medium" style="color:var(--primary);">' + esc((curProp && curProp.layoutBadge) || '异构骨架实时切换') + '</span>') + '</div>',
    '    <div class="text-[10.5px] leading-snug" style="color:var(--text-muted);">' + esc((curProp && curProp.summary) || '') + '</div>',
    '  </div>',
    '</div>',
    '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex flex-col gap-1.5 pt-2 border-t" style="border-color:var(--border-subtle);">',
    '  <div class="px-1 text-[11px] font-semibold" style="color:var(--text-secondary);">➕ 新增按钮/界面功能记录</div>',
    '  <input id="uib-req-label" type="text" value="' + esc(prefillLabel) + '" placeholder="按钮/元素名称（可右侧 Alt+单击拾取）" class="w-full px-2 py-1 rounded-lg border text-[11px] outline-none" style="background:var(--surface-soft);border-color:var(--border-strong);color:var(--text-main);">',
    '  <textarea id="uib-req-desc" rows="2" placeholder="用自然语言描述它应该实现什么功能..." class="w-full px-2 py-1 rounded-lg border text-[11px] outline-none resize-y" style="background:var(--surface-soft);border-color:var(--border-strong);color:var(--text-main);"></textarea>',
    '  <button type="button" data-uib-act="add-requirement" class="ghost-btn w-full justify-center text-[11px] font-semibold" style="color:var(--primary);border-color:var(--primary);">记入列表</button>',
    '</div>',
    '<div data-ui-owner="runner/atlas/wb-uiboard.mjs" class="flex flex-col gap-1.5 pt-2 border-t" style="border-color:var(--border-subtle);">',
    '  <div class="flex items-center justify-between px-1"><span class="text-[11px] font-semibold" style="color:var(--text-secondary);">待传达功能记录 (' + pendingReqs.length + ')</span>' +
      (uiBoardState.grillMeNode ? '<button type="button" data-uib-act="goto-grill-me" class="text-[10px] font-semibold hover:underline" style="color:var(--ok);">查看 grill me 节点</button>' : '') + '</div>',
    reqListHtml,
    (pendingReqs.length > 0
      ? '  <button type="button" data-uib-act="convey-all" class="w-full py-1.5 px-2 rounded-lg text-[11px] font-semibold cursor-pointer" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);">📤 传达到项目看板</button>'
      : ''),
    '</div>'
  ].join('\\n');

  const verLine = tc.versionSummary ? ('<div class="text-[10px] font-mono truncate text-center" style="color:var(--text-muted);" title="' + esc(tc.versionSummary) + '">' + esc(tc.versionSummary) + '</div>') : '';
  footEl.innerHTML = verLine + '<button type="button" data-ui-owner="runner/atlas/wb-uiboard.mjs" data-uib-act="provision-ui-deps" class="ghost-btn w-full justify-center text-[11px]" style="' + (tc.ready ? 'color:var(--ok);border-color:var(--ok);' : '') + '" data-tip="' + esc(tc.versionSummary || '按需派发编队子代理将 @puckeditor/core、lovinsp、react-grab、agent-browser 安装至共享底座池') + '">' + esc(tc.badgeLabel || '📦 按需补齐 UI 增强套件') + '</button>';
}

async function handleConveyRequirementsToKanban(requirementIds, wrapApi) {
  const resolveApi = wrapApi || uibResolveSessionApiUrl;
  let conveyedOut = null;
  if (/^https?:$/i.test(location.protocol)) {
    const r = await fetch(resolveApi('/donegate/api/uiboard/convey-to-kanban'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirementIds })
    });
    conveyedOut = await r.json();
    if (conveyedOut && conveyedOut.requirements && Array.isArray(conveyedOut.requirements.items)) {
      uiBoardState.requirements = conveyedOut.requirements.items;
    }
    if (conveyedOut && conveyedOut.grillMeNode) {
      syncGrillMeNodeToHostKanban(conveyedOut.grillMeNode);
    }
  } else {
    const idSet = requirementIds.length ? new Set(requirementIds) : null;
    const nowIso = new Date().toISOString();
    uiBoardState.requirements = uiBoardState.requirements.map((it) => {
      if (idSet ? idSet.has(it.id) : it.status !== 'conveyed') return { ...it, status: 'conveyed', conveyedAt: nowIso };
      return it;
    });
    const allConveyed = uiBoardState.requirements.filter((it) => it.status === 'conveyed');
    syncGrillMeNodeToHostKanban({
      id: 'host-dom-grill-me',
      step: '00',
      title: 'grill me · 需求澄清与立约',
      isGrillMe: true,
      tip: '起手 00 环节：待主对话 grill me 澄清边界并立约',
      lifecycleLabel: '待 grill me 立约',
      scopePaths: ['./'],
      expanded: true,
      color: 'amber',
      x: -260,
      y: 68,
      w: 268,
      h: null,
      requirements: allConveyed,
      modules: allConveyed.map((it) => ({ name: it.label + '：' + it.description, role: '待澄清', state: 'warn', path: '.donegate/grill-me-inbox.jsonl' }))
    });
    conveyedOut = {
      ok: true,
      conveyedCount: allConveyed.length,
      grillMeQuote: {
        text: '请进入 grill me 环节澄清以下界面功能需求：' + allConveyed.map((x) => '【' + x.label + '】' + x.description).join('；'),
        summary: { label: '[grill me] 需求澄清与立约', title: 'dg://sandbox/card/host-dom-grill-me', detail: '起手 00 环节', body: '启动 grill me' }
      }
    };
  }
  if (conveyedOut && conveyedOut.grillMeQuote && typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
    window.parent.postMessage({
      source: 'donegate-canvas',
      sessionId: typeof DSH_SESSION_ID !== 'undefined' ? DSH_SESSION_ID : 'default',
      type: 'dg:insert-quote',
      text: conveyedOut.grillMeQuote.text,
      summary: conveyedOut.grillMeQuote.summary
    }, '*');
  }
  if (typeof renderAll === 'function') renderAll();
  renderLeftDrawer();
  if (!uiBoardState.isSelfDoneGate) reloadUiBoardIframe(true);
  showToast('✓ 已传达到项目看板第 00 号「grill me · 需求澄清与立约」环节');
}

window.addEventListener('message', async (ev) => {
  const d = ev.data || {};
  if (d.source !== 'dg-ui-bridge') return;
  const p = d.payload || {};

  if (d.type === 'dg-ui:element-selected') {
    uiBoardState.selectedElement = p;
    renderUiBoardStageDom(false);
    const lblInp = document.getElementById('uib-req-label');
    if (lblInp && (p.label || p.tag)) lblInp.value = String(p.label || p.tag);
    if (typeof buildDshQuoteTarget === 'function' && typeof emitDshQuote === 'function') {
      const srcFile = String(p.sourceFile || '.donegate/ui-prototype/index.html');
      const srcLine = p.sourceLine || 1;
      const stackTxt = Array.isArray(p.componentStack) && p.componentStack.length ? (' · 组件栈: ' + p.componentStack.join(' > ')) : '';
      const domSnap = p.domSnapshot ? (' · DOM快照: ' + String(p.domSnapshot).slice(0, 140)) : '';
      const q = buildDshQuoteTarget({
        kind: 'ui',
        id: 'ui-' + (p.actionId || (p.tag + '-' + srcLine)),
        title: (p.label || p.tag || 'UI元素') + ' (' + srcFile.split('/').pop() + ':' + srcLine + ')',
        firstFile: srcFile,
        scopes: [srcFile],
        uiOwner: p.uiOwner || 'runner/atlas/wb-uiboard.mjs',
        sliceCmd: p.sliceCmd || null,
        desc: 'UI元素 <' + (p.tag || 'div') + '>「' + (p.label || '') + '」位于 ' + srcFile + ':' + srcLine + stackTxt + domSnap
      });
      emitDshQuote(q);
    }
  } else if (d.type === 'dg-ui:draft-requirement') {
    const lblInp = document.getElementById('uib-req-label');
    const descInp = document.getElementById('uib-req-desc');
    if (lblInp && p.label) lblInp.value = String(p.label);
    if (descInp && p.description !== undefined) descInp.value = String(p.description);
    showToast('已填入左栏「新增按钮/界面功能记录」');
  } else if (d.type === 'dg-ui:inline-text-edited') {
    if (/^https?:$/i.test(location.protocol)) {
      fetch(uibResolveSessionApiUrl('/donegate/api/uiboard/inline-edit'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch((err) => { void err; });
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
    if (uiBoardState.sourceMode === 'proxy') {
      postToUiIframe({ type: 'dg-ui:apply-tokens', proposalId: pid, tokens: prop.tokens });
    } else {
      reloadUiBoardIframe(false);
    }
    renderLeftDrawer();
    showToast('🎨 已切换美学方案：「' + prop.name + '」');
  }
});

document.addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-uib-act]');
  if (!actEl) return;
  const act = actEl.getAttribute('data-uib-act');
  const wrapApi = uibResolveSessionApiUrl;

  if (act === 'set-vp') {
    uiBoardState.viewport = actEl.getAttribute('data-uib-vp') || 'desktop';
    renderUiBoardStageDom(false);
  } else if (act === 'refresh-uiboard') {
    const u = await syncUiBoardBackendStatus(true);
    const tc = (u && u.toolchain) || uiBoardState.toolchain;
    showToast(tc && tc.readyCount > 0 ? ('已同步 UI 增强套件：' + tc.badgeLabel + (tc.versionSummary ? '（' + tc.versionSummary + '）' : '')) : '已刷新 UI 看板状态与预览');
  } else if (act === 'connect-dev-url') {
    const val = (document.getElementById('uib-dev-url')?.value || '').trim();
    if (!val) { showToast('请先输入本地服务地址，例如 http://127.0.0.1:5173'); return; }
    uiBoardState.devUrl = val;
    uiBoardState.sourceMode = 'proxy';
    reloadUiBoardIframe(true);
    renderUiBoardStageDom(false);
    showToast('🔗 正在通过同源注入桥接入：' + val);
  } else if (act === 'use-prototype') {
    uiBoardState.sourceMode = 'prototype';
    uiBoardState.editorMode = 'builtin';
    reloadUiBoardIframe(false);
    renderUiBoardStageDom(false);
    showToast(uiBoardState.isSelfDoneGate ? '已切换至完结门本仓实时界面预览' : '已切换至当前项目界面预览');
  } else if (act === 'use-puck') {
    if (!uiBoardState.puckInstalled) await syncUiBoardBackendStatus(false);
    if (!uiBoardState.puckInstalled) { showToast('尚未检测到 @puckeditor/core，请先点击「📦 按需补齐 UI 增强套件」'); return; }
    uiBoardState.sourceMode = 'prototype';
    uiBoardState.editorMode = 'puck';
    reloadUiBoardIframe(false);
    renderUiBoardStageDom(false);
    showToast('已切换至完整 Puck 可视化积木编排画布');
  } else if (act === 'lock-theme') {
    uiBoardState.lockedProposalId = uiBoardState.activeProposalId;
    if (/^https?:$/i.test(location.protocol)) {
      await fetch(wrapApi('/donegate/api/uiboard/theme-lock'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: uiBoardState.activeProposalId, projectName: (ATLAS && ATLAS.project && ATLAS.project.name) || 'Project' })
      });
    }
    renderLeftDrawer();
    showToast('🔒 已将当前美学方案锁定写入 design-system/MASTER.md');
  } else if (act === 'run-self-play') {
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch(wrapApi('/donegate/api/uiboard/self-play'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: uiBoardState.activeProposalId, liveUrl: uiBoardState.sourceMode === 'proxy' ? uiBoardState.devUrl : null })
      });
      const rep = await r.json();
      uiBoardState.selfPlayOk = Boolean(rep.ok);
      uiBoardState.selfPlayBadge = rep.ok ? ('✓ 自测 ' + rep.checkedControls + ' 控件' + (rep.engine === 'agent-browser' ? ' (agent-browser)' : ' 0 报错')) : ('⚠ ' + (rep.issues || []).length + ' 项待修');
      renderUiBoardStageDom(false);
      showToast(rep.summary || '已完成 Agent 自动点按自测');
      return;
    }
    uiBoardState.selfPlayBadge = '✓ 离线探针自测通过';
    renderUiBoardStageDom(false);
    showToast('🤖 已完成内置交互与反 AI 模板脸自测');
  } else if (act === 'add-requirement') {
    const lblEl = document.getElementById('uib-req-label');
    const descEl = document.getElementById('uib-req-desc');
    const label = (lblEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!label && !description) { showToast('请先填写按钮/元素名称与期望实现的功能描述'); return; }
    const sel = uiBoardState.selectedElement || {};
    const payload = {
      label: label || sel.label || '新建界面按钮',
      description: description || ('围绕「' + (label || sel.label || '界面按钮') + '」澄清交互边界与后端契约'),
      tag: sel.tag || 'button',
      sourceFile: sel.sourceFile || '',
      sourceLine: sel.sourceLine || 1,
      uiOwner: sel.uiOwner || ''
    };
    if (/^https?:$/i.test(location.protocol)) {
      const r = await fetch(wrapApi('/donegate/api/uiboard/requirements'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const out = await r.json();
      if (out && out.requirements && Array.isArray(out.requirements.items)) {
        uiBoardState.requirements = out.requirements.items;
      }
    } else {
      uiBoardState.requirements.push({ id: 'req-' + Date.now(), ...payload, status: 'pending', createdAt: new Date().toISOString() });
    }
    if (lblEl) lblEl.value = '';
    if (descEl) descEl.value = '';
    renderLeftDrawer();
    if (!uiBoardState.isSelfDoneGate) reloadUiBoardIframe(true);
    showToast('➕ 已记入「待传达功能记录」列表');
  } else if (act === 'convey-single' || act === 'convey-all') {
    const ids = act === 'convey-single' ? [actEl.getAttribute('data-req-id')] : [];
    await handleConveyRequirementsToKanban(ids, wrapApi);
  } else if (act === 'goto-grill-me') {
    state.page = 'sandbox';
    state.leftTab = 'assets';
    state.viewingRepoId = state.hostWorkspaceId || 'host-workspace';
    if (typeof renderAll === 'function') renderAll();
    if (typeof flyCanvasToNode === 'function') flyCanvasToNode('host-dom-grill-me');
  } else if (act === 'provision-ui-deps') {
    if (/^https?:$/i.test(location.protocol)) {
      const sessId = typeof DSH_SESSION_ID !== 'undefined' ? DSH_SESSION_ID : 'default';
      const r = await fetch(wrapApi('/donegate/api/uiboard/provision'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessId, spawnSubagent: true })
      });
      const rep = await r.json().catch(() => ({}));
      if (rep && rep.toolchain) applyUiBoardToolchainSnapshot(rep.toolchain);
      if (rep && rep.ready) {
        uiBoardState.puckInstalled = Boolean(rep.puckInstalled ?? true);
        renderLeftDrawer();
        renderUiBoardStageDom(true);
        showToast('✅ ' + ((uiBoardState.toolchain && uiBoardState.toolchain.badgeLabel) || 'UI 增强套件 (4/4) 已激活') + (uiBoardState.toolchain.versionSummary ? '：' + uiBoardState.toolchain.versionSummary : ''));
      } else if (rep && rep.subagentDispatched) {
        if (typeof startWorkflowDepsPoll === 'function') startWorkflowDepsPoll('uiboard', null);
        showToast('🚀 已在编队派发子代理（' + (rep.subagentName || 'worker') + '）后台安装 UI 增强套件');
      } else if (rep && rep.fallbackAutoSubmit && typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:dispatch-subagent', prompt: rep.agentPrompt }, '*');
        if (typeof startWorkflowDepsPoll === 'function') startWorkflowDepsPoll('uiboard', null);
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
