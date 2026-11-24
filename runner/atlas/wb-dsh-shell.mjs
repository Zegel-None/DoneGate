// DSH 全屏沉浸式外壳装配、Alt+单击拾取监听、卡包抽卡式零缝隙主对话复刻抽屉与实时明暗主题同步（零外网依赖）
const WB_UI_OWNER_RESOLVER_SCRIPT = String.raw`
const DG_UI_ACTION_OWNER_MAP = {
  "export-workflow-json": "runner/atlas/ui-shell.mjs",
  "import-workflow-json": "runner/atlas/ui-shell.mjs",
  "approve-autopilot-gate": "runner/atlas/ui-shell.mjs",
  "close-import-project-modal": "runner/atlas/ui-shell.mjs",
  "confirm-import-project": "runner/atlas/ui-shell.mjs",
  "toggle-wf-grp": "runner/atlas/wb-layout-tidy.mjs",
  "toggle-node-cat": "runner/atlas/wb-layout-tidy.mjs",
  "provision-pack-deps": "runner/atlas/wb-layout-tidy.mjs",
  "focus-wf-group": "runner/atlas/wb-layout-tidy.mjs",
  "create-host-project": "runner/atlas/wb-layout-tidy.mjs",
  "open-import-project-modal": "runner/atlas/wb-layout-tidy.mjs",
  "toggle-proj-import-dd": "runner/atlas/wb-layout-tidy.mjs",
  "import-repo-as-node": "runner/atlas/wb-layout-tidy.mjs",
  "enter-subgraph": "runner/atlas/wb-render-cards.mjs",
  "toggle-gh-star": "runner/atlas/wb-render-cards.mjs",
  "inspect-version": "runner/atlas/wb-render-cards.mjs",
  "provision-node-dep": "runner/atlas/wb-render-cards.mjs",
  "preview-node-obs": "runner/atlas/wb-render-cards.mjs",
  "toggle-slot": "runner/atlas/wb-render-cards.mjs",
  "restore-card-height": "runner/atlas/wb-render-cards.mjs",
  "drill-subrepo": "runner/atlas/wb-render-cards.mjs",
  "toggle-sb-expand": "runner/atlas/wb-render-cards.mjs",
  "group-to-subgraph": "runner/atlas/wb-render-cards.mjs",
  "start-edit-group-title": "runner/atlas/wb-render-cards.mjs",
  "loop-dec": "runner/atlas/wb-render-wires.mjs",
  "loop-inc": "runner/atlas/wb-render-wires.mjs",
  "select-link": "runner/atlas/wb-render-wires.mjs"
};
const DG_UI_CTRL_OWNER_MAP = {
  "id:btn-undo": "runner/atlas/wb-history.mjs",
  "id:btn-redo": "runner/atlas/wb-history.mjs",
  "id:btn-auto-tidy": "runner/atlas/wb-layout-tidy.mjs",
  "id:btn-tidy-mode-cycle": "runner/atlas/wb-layout-tidy.mjs",
  "id:btn-atlas-overview": "runner/atlas/ui-views.mjs",
  "id:btn-zoom-in": "runner/atlas/wb-menus-viewport.mjs",
  "id:btn-zoom-out": "runner/atlas/wb-menus-viewport.mjs",
  "id:btn-zoom-pct": "runner/atlas/wb-menus-viewport.mjs",
  "id:btn-fit": "runner/atlas/wb-menus-viewport.mjs",
  "uib-theme-select": "runner/atlas/wb-uiboard.mjs"
};
function resolveUiOwner(el, meta) {
  if (el && typeof el.closest === "function") {
    const owned = el.closest("[data-ui-owner]");
    const direct = owned && owned.getAttribute ? owned.getAttribute("data-ui-owner") : "";
    if (direct) return String(direct).replace(/\\/g, "/");
  }
  let cur = el;
  while (cur && (typeof document === "undefined" || cur !== document.body)) {
    const attr = cur.getAttribute ? cur.getAttribute("data-ui-owner") : "";
    if (attr) return String(attr).replace(/\\/g, "/");
    cur = cur.parentElement;
  }
  const getAttr = (k) => (el && el.getAttribute ? (el.getAttribute(k) || "") : "");
  if (getAttr("data-uib-act") || getAttr("data-uib-vp") || (meta && meta.kind === "ui")) return "runner/atlas/wb-uiboard.mjs";
  if (getAttr("data-jit-open") || getAttr("data-jit-add-tpl") || getAttr("data-jit-rm-tpl") || getAttr("data-jit-promote-btn") || getAttr("data-jit-approve-floor") || getAttr("data-jit-quick-promote")) return "runner/atlas/wb-jit-workflow.mjs";
  const ctrlId = (meta && meta.controlRef) || getAttr("data-ctrl-id") || (el && el.id ? ("id:" + el.id) : "");
  if (ctrlId && DG_UI_CTRL_OWNER_MAP[ctrlId]) return DG_UI_CTRL_OWNER_MAP[ctrlId];
  if (ctrlId.startsWith("star:") || ctrlId.startsWith("tb:")) return "runner/atlas/wb-render-cards.mjs";
  const act = getAttr("data-action");
  if (act && DG_UI_ACTION_OWNER_MAP[act]) return DG_UI_ACTION_OWNER_MAP[act];
  if (el && typeof el.closest === "function") {
    if (el.closest("#uiboard-stage")) return "runner/atlas/wb-uiboard.mjs";
    if (el.closest("#dg-jit-modal-root, .dg-jit-modal, .dg-sb-wf-bar")) return "runner/atlas/wb-jit-workflow.mjs";
    if (el.closest("#atlas-overview-modal")) return "runner/atlas/ui-views.mjs";
    if (el.closest(".node-card, .group-frame, .selection-toolbox")) return "runner/atlas/wb-render-cards.mjs";
    if (el.closest("#ctx-root-menu, #ctx-sub-menu, #folder-modal, #drilldown-bar")) return "runner/atlas/wb-menus-viewport.mjs";
    if (el.closest("#left-drawer")) return "runner/atlas/wb-layout-tidy.mjs";
    if (el.closest("#right-sidebar")) return "runner/atlas/wb-subagent.mjs";
    if (el.closest("#dsh-composer-shell, #dsh-input-dock, #dsh-right-preview")) return "runner/atlas/wb-dsh-shell.mjs";
  }
  const kind = meta && meta.kind;
  if (kind === "card" || kind === "multi" || kind === "group") return "runner/atlas/wb-render-cards.mjs";
  if (kind === "wire") return "runner/atlas/wb-render-wires.mjs";
  if (kind === "workflow" || kind === "project") return "runner/atlas/wb-layout-tidy.mjs";
  return "runner/atlas/ui-shell.mjs";
}
if (typeof window !== "undefined") window.resolveUiOwner = resolveUiOwner;
`;

function wbDshSaveSimPref(k, v) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, String(v));
  } catch (err) {
    void err;
  }
}

function wbDshShouldSuppressStandaloneDock() {
  if (IS_DSH_EMBED) return true;
  const embedMode = DSH_URL_PARAMS.get('embed');
  const isSubagent = DSH_URL_PARAMS.get('subagent') === '1';
  return Boolean(embedMode === 'uiboard' || isSubagent || window.__DG_UIBOARD_SELF_EMBED__);
}

function wbDshInitThemeAndViewport() {
  const suppressDock = wbDshShouldSuppressStandaloneDock();
  document.body.classList.add(suppressDock ? 'is-dsh-embed' : 'has-dsh-dock');
  state.rightOpen = false;
  const hostTheme = DSH_URL_PARAMS.get('theme');
  if (suppressDock && (hostTheme === 'dark' || hostTheme === 'light')) {
    state.theme = hostTheme;
    applyThemeClasses(hostTheme);
  }
  if (suppressDock && window.innerWidth < 820) state.leftOpen = false;
  window.addEventListener('resize', () => {
    if (suppressDock && window.innerWidth < 780 && state.leftOpen) {
      state.leftOpen = false;
      renderLeftDrawer();
      requestAnimationFrame(fitCanvas);
    }
  });
}

function wbDshMountShellDom() {
  const hint = document.getElementById('subtle-canvas-hint');
  if (hint) hint.textContent = 'Alt+单击任意卡片/连线/按钮累加引用 · 双击文字改名';
  const world = document.getElementById('canvas-world');
  if (world && !document.getElementById('dsh-anchors-layer')) {
    const ancLayer = document.createElement('div');
    ancLayer.id = 'dsh-anchors-layer';
    ancLayer.setAttribute('data-ui-owner', 'runner/atlas/wb-dsh-bridge.mjs');
    world.appendChild(ancLayer);
  }
  if (wbDshShouldSuppressStandaloneDock()) return;
  const stageEl = document.getElementById('canvas-stage');
  const mainRow = stageEl ? stageEl.parentElement : null;
  if (mainRow && !document.getElementById('dsh-right-preview')) {
    const rp = document.createElement('aside');
    rp.id = 'dsh-right-preview';
    rp.setAttribute('data-ui-owner', 'runner/atlas/wb-dsh-shell.mjs');
    rp.className = 'selectable-text';
    mainRow.appendChild(rp);
  }
  if (!document.getElementById('dsh-composer-shell') && !document.getElementById('dg-dsh-standalone-dock')) {
    const shell = document.createElement('footer');
    shell.id = 'dsh-composer-shell';
    shell.setAttribute('data-ui-owner', 'runner/atlas/wb-dsh-shell.mjs');
    shell.innerHTML = [
      '<div id="dg-dsh-standalone-dock" style="display:contents;" data-ui-owner="runner/atlas/wb-dsh-shell.mjs">',
      '  <div id="dsh-input-dock" data-ui-owner="runner/atlas/wb-dsh-shell.mjs"></div>',
      '  <div id="dsh-standalone-card" data-ui-owner="runner/atlas/wb-dsh-shell.mjs">',
      '    <div id="dsh-quote-row" class="flex flex-wrap items-center gap-1.5"></div>',
      '    <div class="flex items-center gap-2.5">',
      '      <input id="dsh-sim-input" type="text" placeholder="发消息或创建任务，/ 调用指令，@ 文件或对话" class="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none" style="color:var(--text-main);">',
      '      <button type="button" id="dsh-sim-send" class="w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);" aria-label="发送">',
      '        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.31 0.98c.36.07.67.22.95.45.22.18.47.43.72.68l4.73 4.72-1.42 1.42L9 3.96v11.08H7V3.96L2.71 8.25 1.29 6.83l4.73-4.72c.25-.25.49-.5.72-.68.24-.19.54-.39.95-.45.21-.03.41-.02.62 0Z"/></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(shell);
  }
}

function wbDshFindLatestAgentText(top) {
  for (let i = dshRuntime.chatHistory.length - 1; i >= 0; i--) {
    const msg = dshRuntime.chatHistory[i];
    if (msg && msg.role === 'assistant' && msg.text) {
      return String(msg.text).replace(/\s+/g, ' ').trim();
    }
  }
  if (top && top.title) return String(top.title).trim();
  return '';
}

function wbDshBuildAgentPrefixHtml(agName) {
  if (dshRuntime.editingAgentName) {
    return '<input id="dg-sim-agent-name-inp" type="text" value="' + esc(agName) +
      '" class="px-1.5 py-0.5 rounded text-xs font-semibold outline-none" style="width:88px;background:var(--bg);color:var(--text-main);border:0.5px solid var(--border-strong);">';
  }
  return '<span data-dg-rename-agent="1" title="双击可给 Agent 改名（如：小小张）" class="font-semibold shrink-0 select-none cursor-text" style="color:var(--text-main);">' + esc(agName) + '：</span>';
}

function wbDshBuildChatTurnsHtml(prefixHtml) {
  if (!dshRuntime.chatHistory.length) {
    return '<div class="text-xs py-1" style="color:var(--text-muted);">暂无历史对话，直接在下方输入框发送消息即可开始协作。</div>';
  }
  return dshRuntime.chatHistory.map((m) => {
    if (m.role === 'user') return '<div class="dsh-chat-bubble is-user">' + esc(m.text) + '</div>';
    return '<div class="dsh-chat-bubble is-agent"><div class="mb-0.5">' + prefixHtml +
      '</div><div style="white-space:pre-wrap;">' + esc(m.text) + '</div></div>';
  }).join('');
}

function wbDshBuildExpandedDockHtml(prefixHtml, top) {
  const pinned = Boolean(dshRuntime.dockPinned);
  const pinBg = pinned ? 'var(--btn-primary-bg)' : 'var(--surface-soft)';
  const pinFg = pinned ? 'var(--btn-primary-fg)' : 'var(--text-secondary)';
  const pinTxt = pinned ? '已固定' : '固定';
  const pinBtn = '<button type="button" data-dg-toggle-pin="1" style="position:absolute;top:8px;right:12px;z-index:8;height:24px;padding:0 9px;border-radius:8px;font-size:11.5px;font-weight:500;cursor:pointer;border:0.5px solid var(--border-strong);background:' +
    pinBg + ';color:' + pinFg + ';">📌 ' + pinTxt + '</button>';
  const resizeGrip = '<div data-dg-sim-resize="1" title="上下拖动调整窗口高度（自动记忆）" style="position:absolute;top:0;left:0;right:0;height:10px;cursor:ns-resize;z-index:7;display:flex;align-items:center;justify-content:center;"><span style="width:32px;height:3px;border-radius:999px;background:var(--text-muted);opacity:0.35;"></span></div>';
  let targetBar = '';
  if (top && top.targetNodeId) {
    targetBar = '<div class="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg" style="background:var(--surface-soft);color:var(--text-secondary);"><span class="truncate">' +
      esc(top.title) + '</span><button type="button" class="dg-micro-btn shrink-0" data-dock-fly="' + esc(top.targetNodeId) + '">定位节点</button></div>';
  }
  return resizeGrip + pinBtn +
    '<div id="dg-sim-chat-scroll" class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3 flex flex-col gap-3">' +
    wbDshBuildChatTurnsHtml(prefixHtml) + targetBar + '</div>';
}

function wbDshBuildCollapsedDockHtml(prefixHtml, latestAgentTxt) {
  const colorVar = latestAgentTxt ? 'var(--text-secondary)' : 'var(--text-muted)';
  const cls = latestAgentTxt.length > 40 ? 'dg-sim-marquee' : '';
  return '<div style="height:34px;padding:0 16px;display:flex;align-items:center;gap:4px;font-size:13px;overflow:hidden;">' +
    prefixHtml +
    '<div class="dg-sim-pop flex-1 min-w-0 overflow-hidden whitespace-nowrap" style="color:' + colorVar + ';">' +
    '<span class="' + cls + '">' + esc(latestAgentTxt || '等待新消息…') + '</span></div></div>';
}

function wbDshComputeDockClassName(exp, isQ) {
  const parts = [];
  if (exp) parts.push('is-expanded ');
  if (dshRuntime.isResizingDock) parts.push('is-dragging ');
  if (isQ) parts.push('is-question');
  return parts.join('');
}

function wbDshBindAgentNameInput() {
  if (!dshRuntime.editingAgentName) return;
  const ni = document.getElementById('dg-sim-agent-name-inp');
  if (!ni) return;
  ni.focus();
  ni.select();
  const commit = () => {
    const nv = String(ni.value || '').trim().slice(0, 24) || 'Agent';
    dshRuntime.agentName = nv;
    dshRuntime.editingAgentName = false;
    wbDshSaveSimPref('dg_dsh_agent_name', nv);
    window.renderDshStandaloneShell();
  };
  ni.onblur = commit;
  ni.onkeydown = (ke) => {
    ke.stopPropagation();
    if (ke.key === 'Enter') {
      commit();
    } else if (ke.key === 'Escape') {
      dshRuntime.editingAgentName = false;
      window.renderDshStandaloneShell();
    }
  };
}

function wbDshRenderInputDock() {
  const dock = document.getElementById('dsh-input-dock');
  if (!dock) return;
  const top = dshRuntime.dockItems[0] || null;
  const isQ = Boolean(top && (top.kind === 'question' || top.kind === 'blocked'));
  const exp = Boolean(dshRuntime.dockPinned || dshRuntime.dockExpanded || dshRuntime.isResizingDock || isQ);
  const hPx = Math.max(128, Math.min(640, Number(dshRuntime.dockHeight || 280)));
  const agName = String(dshRuntime.agentName || 'Agent');
  const innerH = exp ? hPx : 34;
  dock.style.height = (innerH + 28) + 'px';
  dock.className = wbDshComputeDockClassName(exp, isQ);
  const prefixHtml = wbDshBuildAgentPrefixHtml(agName);
  if (exp) {
    dock.innerHTML = wbDshBuildExpandedDockHtml(prefixHtml, top);
    const sc = document.getElementById('dg-sim-chat-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  } else {
    dock.innerHTML = wbDshBuildCollapsedDockHtml(prefixHtml, wbDshFindLatestAgentText(top));
  }
  wbDshBindAgentNameInput();
}

function wbDshRenderShell() {
  if (DSH_URL_PARAMS.get('subagent') === '1' || DSH_URL_PARAMS.get('embed') === 'uiboard' || window.__DG_UIBOARD_SELF_EMBED__) {
    return;
  }
  if (IS_DSH_EMBED) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        source: 'donegate-canvas',
        sessionId: DSH_SESSION_ID,
        type: 'dg:dock-sync',
        items: dshRuntime.dockItems,
        messages: dshRuntime.chatHistory
      }, '*');
    }
    return;
  }
  const qRow = document.getElementById('dsh-quote-row');
  if (qRow) {
    qRow.innerHTML = dshRuntime.quotes.map((q, idx) => (
      '<span class="dsh-quote-chip" data-tip="' + esc(q.summary.title + ' · ' + q.summary.detail) + '">' +
      '<span>' + esc(q.summary.label) + '</span>' +
      '<button type="button" data-rm-quote="' + idx + '" aria-label="移除引用">×</button></span>'
    )).join('');
  }
  wbDshRenderInputDock();
  const rp = document.getElementById('dsh-right-preview');
  if (rp) {
    rp.classList.toggle('is-open', Boolean(dshRuntime.rightPreview.open));
    if (dshRuntime.rightPreview.open) {
      rp.innerHTML = '<div class="px-3 py-2 border-b flex items-center justify-between text-xs" style="border-color:var(--border-subtle);">' +
        '<span class="font-semibold truncate">源码与改动预览 · ' + esc(dshRuntime.rightPreview.title) + '</span>' +
        '<button type="button" class="dg-micro-btn" data-close-rp="1">关闭</button></div>' +
        '<div class="px-3 py-1.5 text-[11px] font-mono border-b truncate" style="color:var(--text-secondary);border-color:var(--border-subtle);">' + esc(dshRuntime.rightPreview.path) + '</div>' +
        '<pre class="flex-1 overflow-auto p-3 m-0 text-[11px] font-mono leading-relaxed" style="background:var(--surface-soft);color:var(--text-main);">' + esc(dshRuntime.rightPreview.diffText) + '</pre>';
    }
  }
}

function wbDshResolveCurrentScopeTitle() {
  if (state.page === 'workshop') return WORKFLOW_PACKS[state.activePackId].name;
  if (state.page === 'uiboard') return 'UI 看板实时舞台';
  return REPO_SANDBOXES[state.viewingRepoId].name;
}

function wbDshPickPromptColor(prompt) {
  if (prompt.includes('红')) return '#dc2626';
  if (prompt.includes('绿')) return '#16a34a';
  if (prompt.includes('琥珀') || prompt.includes('黄')) return '#d97706';
  return '#3f3f46';
}

function wbDshApplyInstructionTarget(t, prompt, isAsk) {
  if (t.isBlank && !isAsk) {
    dshRuntime.dockItems.unshift({
      id: 'q-' + Date.now(),
      kind: 'question',
      targetNodeId: t.id,
      confirmBlankNodeId: t.id,
      title: '「' + t.title + '」尚为空白待定节点，要先挂载确定性门禁模块再派工吗？'
    });
    return;
  }
  if (isAsk) {
    const body = t.kind === 'wire'
      ? '此连线负责将上游产物契约化传递给下游，并在门禁未绿 (exit 1/2/3) 时按上限自动触发 fresh_ralph 干净上下文重试。'
      : '「' + t.title + '」受契约范围保护，仅允许被指派的工兵子代理在授权目录内写入并通过 0/1/2/3 退出码验真。';
    dshRuntime.anchors.set(t.key, { mode: 'explain', targetKind: t.kind, targetId: t.id, title: t.title, body });
    return;
  }
  if (t.kind === 'button' && t.controlRef && /(红|绿|蓝|黄|琥珀|紫)/.test(prompt)) {
    state.controlStyleOverrides[t.controlRef] = { color: wbDshPickPromptColor(prompt) };
    applyAllControlStyleOverrides();
    if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
  }
  dshRuntime.anchors.set(t.key, { mode: 'pill', tone: 'run', targetKind: t.kind, targetId: t.id, badge: '改码验真中 · 1/2' });
  renderDshCanvasAnchors();
  setTimeout(() => {
    dshRuntime.anchors.set(t.key, {
      mode: 'verdict', tone: 'ok', targetKind: t.kind, targetId: t.id,
      firstFile: t.firstFile, line1: '🟢 门禁通过 · 已改好', line2: '门禁 3/3 · 1 文件 (+14/-3)'
    });
    renderDshCanvasAnchors();
  }, 380);
}

function wbDshDispatchInstruction(rawPrompt) {
  const prompt = String(rawPrompt || '').trim();
  if (!prompt && !dshRuntime.quotes.length) return;
  const targets = dshRuntime.quotes.slice();
  const quoteTagStr = targets.map((t) => t.summary.label).join(' ');
  const prefix = quoteTagStr ? quoteTagStr + ' ' : '';
  dshRuntime.chatHistory.push({
    id: 'u-' + Date.now(),
    role: 'user',
    text: prefix + (prompt || '执行改码与门禁验真')
  });
  dshRuntime.quotes = [];
  const inp = document.getElementById('dsh-sim-input');
  if (inp) inp.value = '';
  if (!targets.length) {
    const reply = '已扫描当前「' + wbDshResolveCurrentScopeTitle() + '」并对齐确定性门禁状态。';
    dshRuntime.chatHistory.push({ id: 'a-' + Date.now(), role: 'assistant', text: reply });
    window.renderDshStandaloneShell();
    return;
  }
  const isAsk = /(解释|什么意思|干什么|用途|为什么|含义|\?|？)/.test(prompt);
  targets.forEach((t) => {
    wbDshApplyInstructionTarget(t, prompt, isAsk);
  });
  const replyText = isAsk
    ? '已在对应元素上方挂出契约与职责说明。'
    : '已对 ' + targets.map((t) => '「' + t.title + '」').join('、') + ' 完成改码并通过确定性门禁验真。';
  dshRuntime.chatHistory.push({ id: 'a-' + Date.now(), role: 'assistant', text: replyText });
  renderDshCanvasAnchors();
  window.renderDshStandaloneShell();
}

function wbDshStartDockResize(e, dockEl) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const startH = Number(dshRuntime.dockHeight || 280);
  dshRuntime.isResizingDock = true;
  dockEl.classList.add('is-dragging');
  const onMove = (ev) => {
    const nextH = Math.max(128, Math.min(640, Math.round(startH + (startY - ev.clientY))));
    dshRuntime.dockHeight = nextH;
    dockEl.style.height = (nextH + 28) + 'px';
  };
  const onUp = () => {
    dshRuntime.isResizingDock = false;
    dockEl.classList.remove('is-dragging');
    wbDshSaveSimPref('dg_dsh_dock_height', dshRuntime.dockHeight || 280);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function wbDshBindDockEvents() {
  const dockEl = document.getElementById('dsh-input-dock');
  if (!dockEl) return;
  dockEl.addEventListener('mouseenter', () => {
    dshRuntime.dockExpanded = true;
    window.renderDshStandaloneShell();
  });
  dockEl.addEventListener('mouseleave', () => {
    if (!dshRuntime.editingAgentName && !dshRuntime.isResizingDock) {
      dshRuntime.dockExpanded = false;
      window.renderDshStandaloneShell();
    }
  });
  dockEl.addEventListener('wheel', (e) => {
    e.stopPropagation();
  }, { passive: true });
  dockEl.addEventListener('dblclick', (e) => {
    if (!e.target.closest('[data-dg-rename-agent]')) return;
    e.preventDefault();
    e.stopPropagation();
    dshRuntime.editingAgentName = true;
    window.renderDshStandaloneShell();
  });
  dockEl.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-dg-sim-resize]')) return;
    wbDshStartDockResize(e, dockEl);
  });
}

function wbDshResolveButtonLabel(btn) {
  const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
  if (txt) return txt;
  const aria = (btn.getAttribute('aria-label') || '').trim();
  if (aria) return aria;
  const tip = (btn.getAttribute('data-tip') || '').split(/[：·(]/)[0].trim();
  return tip || '控件';
}

function wbDshBuildButtonQuote(btn) {
  const lbl = wbDshResolveButtonLabel(btn);
  let ckey = btn.getAttribute('data-ctrl-id');
  if (!ckey) {
    ckey = btn.id ? ('id:' + btn.id) : ('tb:' + (btn.getAttribute('data-tb-act') || lbl));
  }
  return buildDshQuoteTarget({
    kind: 'button', id: ckey, title: lbl, controlRef: ckey, el: btn,
    uiOwner: resolveUiOwner(btn, { kind: 'button', controlRef: ckey }), desc: '界面控件「' + lbl + '」'
  });
}

function wbDshBuildWorkflowQuote(wfRow) {
  const pid = wfRow.getAttribute('data-switch-pack');
  const pk = WORKFLOW_PACKS[pid];
  const safeId = String(pid || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  const wfTitle = (pk && pk.name) || (wfRow.textContent || '').replace(/\s+/g, ' ').trim() || pid;
  return buildDshQuoteTarget({
    kind: 'workflow', id: pid, title: wfTitle, scopes: ['workflows/.deps/' + safeId + '/'],
    el: wfRow, uiOwner: resolveUiOwner(wfRow, { kind: 'workflow' }), desc: '工作流「' + wfTitle + '」'
  });
}

function wbDshBuildRepoQuote(repoRow) {
  const rid = repoRow.getAttribute('data-view-repo');
  const rp = REPO_SANDBOXES[rid];
  const rpTitle = (rp && rp.name) || (repoRow.textContent || '').replace(/\s+/g, ' ').trim() || rid;
  let rpScopes = ['../' + rid + '/'];
  if (rp && rp.targetDir) rpScopes = [rp.targetDir];
  else if (rp && rp.isHost) rpScopes = ['./'];
  return buildDshQuoteTarget({
    kind: 'project', id: rid, title: rpTitle, scopes: rpScopes,
    el: repoRow, uiOwner: resolveUiOwner(repoRow, { kind: 'project' }), desc: '项目看板「' + rpTitle + '」'
  });
}

function wbDshBuildNodeQuote(nd, el) {
  const m = resolveNodeScopeMeta(nd);
  return buildDshQuoteTarget({
    kind: 'card', id: nd.id, title: nd.title, isBlank: Boolean(nd.isBlank),
    contracts: m.contracts, scopes: m.scopes, firstFile: m.firstFile,
    el, uiOwner: resolveUiOwner(el, { kind: 'card' })
  });
}

function wbDshPickCanvasQuoteTarget(target) {
  const wireTarget = target.closest('[data-loop-link]') || target.closest('[data-link-id], [data-sb-link]');
  if (wireTarget) {
    const lid = wireTarget.getAttribute('data-loop-link') || wireTarget.getAttribute('data-link-id') || wireTarget.getAttribute('data-sb-link');
    return buildDshQuoteTarget({
      kind: 'wire', id: lid, title: '连线 ' + lid, el: wireTarget,
      uiOwner: resolveUiOwner(wireTarget, { kind: 'wire' }), desc: '画布上下游连线'
    });
  }
  const cardEl = target.closest('[data-card-id]');
  if (cardEl) {
    const nd = getActiveNodesList().find((n) => n.id === cardEl.getAttribute('data-card-id'));
    return nd ? wbDshBuildNodeQuote(nd, cardEl) : null;
  }
  const grpEl = target.closest('[data-drag-group], [data-group-id]');
  if (grpEl) {
    const gid = grpEl.getAttribute('data-drag-group') || grpEl.getAttribute('data-group-id');
    const g = getActiveGroupsList().find((x) => x.id === gid);
    return g ? buildDshQuoteTarget({ kind: 'group', id: g.id, title: g.title, el: grpEl, uiOwner: resolveUiOwner(grpEl, { kind: 'group' }) }) : null;
  }
  const txt = target.closest('[data-sel-text]');
  if (txt) {
    const k = txt.getAttribute('data-sel-text');
    return buildDshQuoteTarget({ kind: 'text', id: k, title: (txt.textContent || '').trim(), textKey: k, el: txt, uiOwner: resolveUiOwner(txt, { kind: 'text' }) });
  }
  return null;
}

function wbDshResolveAltClickQuote(target) {
  const btn = target.closest('button, select');
  if (btn) {
    if (!btn.hasAttribute('data-dsh-quote')) return wbDshBuildButtonQuote(btn);
    return wbDshPickCanvasQuoteTarget(target);
  }
  const wfRow = target.closest('[data-switch-pack]');
  if (wfRow) return wbDshBuildWorkflowQuote(wfRow);
  const repoRow = target.closest('[data-view-repo]');
  if (repoRow) return wbDshBuildRepoQuote(repoRow);
  return wbDshPickCanvasQuoteTarget(target);
}

function wbDshCloseExplainAnchors() {
  let closedExplain = false;
  dshRuntime.anchors.forEach((v, k) => {
    if (v.mode === 'explain') {
      dshRuntime.anchors.delete(k);
      closedExplain = true;
    }
  });
  if (closedExplain) renderDshCanvasAnchors();
}

function wbDshHandlePointerDown(e) {
  if (e.altKey && e.button === 0) {
    const q = wbDshResolveAltClickQuote(e.target);
    if (q) {
      dshRuntime._suppressAltClickUntil = Date.now() + 800;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      emitDshQuote(q);
      return;
    }
  }
  if (!e.target.closest('.dg-micro-card, .dg-micro-pill, #ctx-root-menu')) {
    wbDshCloseExplainAnchors();
  }
}

function wbDshHandleContextAction(dctx) {
  const mode = dctx.getAttribute('data-dsh-ctx');
  if (mode === 'quote-card') {
    const nd = getActiveNodesList().find((n) => n.id === dctx.getAttribute('data-node'));
    if (nd) {
      const cDom = document.getElementById('card-' + nd.id);
      emitDshQuote(wbDshBuildNodeQuote(nd, cDom));
    }
  } else if (mode === 'preview-card') {
    const nd = getActiveNodesList().find((n) => n.id === dctx.getAttribute('data-node'));
    if (nd) {
      const m = resolveNodeScopeMeta(nd);
      openRightFilePreview(m.firstFile, nd.title);
    }
  } else if (mode === 'quote-wire') {
    const lid = dctx.getAttribute('data-link');
    emitDshQuote(buildDshQuoteTarget({ kind: 'wire', id: lid, title: '连线 ' + lid, uiOwner: 'runner/atlas/wb-render-wires.mjs' }));
  }
  closeCascadingMenus();
}

function wbDshPinAnchorNote(key) {
  const a = dshRuntime.anchors.get(key);
  const nd = a ? getActiveNodesList().find((n) => n.id === a.targetId) : null;
  if (nd && a) {
    nd.tip = a.body;
    showToast('📌 已存入「' + nd.title + '」节点悬停备注');
  }
  dshRuntime.anchors.delete(key);
  renderDshCanvasAnchors();
}

function wbDshHandleAnchorClick(target) {
  const wExp = target.closest('[data-wire-ctx="explain"]');
  if (wExp) {
    const lid = wExp.getAttribute('data-link');
    dshRuntime.anchors.set('wire:' + lid, {
      mode: 'explain', targetKind: 'wire', targetId: lid, title: '连线说明',
      body: '此连线传递上游确定性契约信号，门禁未通过时按回跳上限触发干净上下文修复。'
    });
    closeCascadingMenus();
    renderDshCanvasAnchors();
    return true;
  }
  const ancClose = target.closest('[data-anc-close]');
  if (ancClose) {
    dshRuntime.anchors.delete(ancClose.getAttribute('data-anc-close'));
    renderDshCanvasAnchors();
    return true;
  }
  const ancDiff = target.closest('[data-anc-diff]');
  if (ancDiff) {
    const a = dshRuntime.anchors.get(ancDiff.getAttribute('data-anc-diff'));
    if (a) openRightFilePreview(a.firstFile, a.line1);
    return true;
  }
  const ancUndo = target.closest('[data-anc-undo]');
  if (ancUndo) {
    dshRuntime.anchors.delete(ancUndo.getAttribute('data-anc-undo'));
    if (typeof undoLastAction === 'function') undoLastAction();
    renderDshCanvasAnchors();
    return true;
  }
  const ancPin = target.closest('[data-anc-pin-note]');
  if (ancPin) {
    wbDshPinAnchorNote(ancPin.getAttribute('data-anc-pin-note'));
    return true;
  }
  return false;
}

function wbDshConfirmBlankNode(nid) {
  const nd = getActiveNodesList().find((n) => n.id === nid);
  if (nd) {
    nd.isBlank = false;
    nd.title = '确定性门禁节点';
    nd.sub = 'adapter_gate · exit 0/1/2/3';
  }
  dshRuntime.dockItems.shift();
  renderAll();
  window.renderDshStandaloneShell();
  showToast('✓ 已挂载确定性门禁模块');
}

function wbDshHandleDockActionClick(target) {
  const rmQ = target.closest('[data-rm-quote]');
  if (rmQ) {
    dshRuntime.quotes.splice(Number(rmQ.getAttribute('data-rm-quote')), 1);
    window.renderDshStandaloneShell();
    return true;
  }
  if (target.closest('[data-dock-dismiss]')) {
    dshRuntime.dockItems.shift();
    window.renderDshStandaloneShell();
    return true;
  }
  const flyBtn = target.closest('[data-dock-fly]');
  if (flyBtn) {
    flyCanvasToNode(flyBtn.getAttribute('data-dock-fly'));
    return true;
  }
  const blankBtn = target.closest('[data-dock-confirm-blank]');
  if (blankBtn) {
    wbDshConfirmBlankNode(blankBtn.getAttribute('data-dock-confirm-blank'));
    return true;
  }
  if (target.closest('[data-close-rp]')) {
    dshRuntime.rightPreview.open = false;
    window.renderDshStandaloneShell();
    return true;
  }
  if (target.closest('#dsh-sim-send')) {
    const inp = document.getElementById('dsh-sim-input');
    wbDshDispatchInstruction(inp ? inp.value : '');
    return true;
  }
  return false;
}

function wbDshHandleClick(e) {
  if (e.target.closest('[data-dg-toggle-pin]')) {
    e.preventDefault();
    e.stopPropagation();
    dshRuntime.dockPinned = !dshRuntime.dockPinned;
    wbDshSaveSimPref('dg_dsh_dock_pinned', dshRuntime.dockPinned ? '1' : '0');
    window.renderDshStandaloneShell();
    return;
  }
  if (e.target.closest('[data-dsh-quote="selection"]')) {
    emitDshQuote(collectCurrentSelectionAsQuote());
    return;
  }
  const dctx = e.target.closest('[data-dsh-ctx]');
  if (dctx) {
    wbDshHandleContextAction(dctx);
    return;
  }
  if (wbDshHandleAnchorClick(e.target)) return;
  wbDshHandleDockActionClick(e.target);
}

function wbDshHandleHostMessage(ev) {
  const d = ev && ev.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'dg:focus-node' && d.nodeId) flyCanvasToNode(String(d.nodeId));
  if (d.type === 'dg:agent-name-sync' && d.agentName) {
    dshRuntime.agentName = String(d.agentName);
    wbDshSaveSimPref('dg_dsh_agent_name', dshRuntime.agentName);
    window.renderDshStandaloneShell();
  }
  if (d.type === 'dg:theme-sync' && (d.theme === 'dark' || d.theme === 'light') && state.theme !== d.theme) {
    state.theme = d.theme;
    applyThemeClasses(d.theme);
  }
}

function wbDshApplyPulseEvent(rawData) {
  try {
    const p = JSON.parse(rawData || '{}');
    if (!p.nodeId) return;
    if (p.status === 'passed') {
      dshRuntime.anchors.set('card:' + p.nodeId, {
        mode: 'verdict', tone: 'ok', targetKind: 'card', targetId: p.nodeId,
        firstFile: 'runner/donegate.mjs', line1: '🟢 门禁通过 · 已改好', line2: p.badgeText || '🟢 exit 0'
      });
    } else {
      const tone = p.status === 'failed' ? 'bad' : 'run';
      dshRuntime.anchors.set('card:' + p.nodeId, {
        mode: 'pill', tone, targetKind: 'card', targetId: p.nodeId, badge: p.badgeText || '⚡ 执行中'
      });
    }
    renderDshCanvasAnchors();
  } catch (err) {
    void err;
  }
}

function wbDshConnectEventStream() {
  if (!/^https?:$/i.test(location.protocol) || typeof EventSource !== 'function') return;
  try {
    const es = new EventSource('/donegate/api/events?sessionId=' + encodeURIComponent(DSH_SESSION_ID));
    es.addEventListener('pulse', (ev) => {
      wbDshApplyPulseEvent(ev.data);
    });
    es.onerror = () => {
      try {
        es.close();
      } catch (err) {
        void err;
      }
    };
  } catch (err) {
    void err;
  }
}

function wbDshSwallowAltFollowup(ev) {
  if (ev.altKey || Date.now() < (dshRuntime._suppressAltClickUntil || 0)) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }
}

function wbDshBindEvents() {
  wbDshBindDockEvents();
  const swallowAltFollowup = wbDshSwallowAltFollowup;
  document.addEventListener('click', swallowAltFollowup, true);
  document.addEventListener('pointerup', swallowAltFollowup, true);
  document.addEventListener('pointerdown', wbDshHandlePointerDown, true);
  document.addEventListener('click', wbDshHandleClick);
  const simInp = document.getElementById('dsh-sim-input');
  if (simInp) {
    simInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        wbDshDispatchInstruction(simInp.value);
      }
    });
  }
  window.addEventListener('message', wbDshHandleHostMessage);
}

function wbDshSyncInitialGrillMeNode() {
  if (typeof ATLAS === 'undefined' || !ATLAS || !ATLAS.workbench || !ATLAS.workbench.savedState) return;
  const savedGrill = ATLAS.workbench.savedState.grillMeNode;
  if (savedGrill && typeof syncGrillMeNodeToHostKanban === 'function') {
    syncGrillMeNodeToHostKanban(savedGrill);
  }
}

function initDoneGateDshIntegration() {
  wbDshInitThemeAndViewport();
  wbDshMountShellDom();
  wbDshSyncInitialGrillMeNode();
  window.renderDshStandaloneShell = wbDshRenderShell;
  const origRenderAll = window.renderAll || renderAll;
  renderAll = function patchedRenderAll() {
    origRenderAll();
    renderDshCanvasAnchors();
  };
  wbDshBindEvents();
  wbDshConnectEventStream();
  window.renderDshStandaloneShell();
  renderDshCanvasAnchors();
}

const WB_DSH_HELPER_FNS = [
  wbDshSaveSimPref, wbDshShouldSuppressStandaloneDock, wbDshInitThemeAndViewport, wbDshMountShellDom,
  wbDshFindLatestAgentText, wbDshBuildAgentPrefixHtml, wbDshBuildChatTurnsHtml, wbDshBuildExpandedDockHtml,
  wbDshBuildCollapsedDockHtml, wbDshComputeDockClassName, wbDshBindAgentNameInput, wbDshRenderInputDock,
  wbDshRenderShell, wbDshResolveCurrentScopeTitle, wbDshPickPromptColor, wbDshApplyInstructionTarget,
  wbDshDispatchInstruction, wbDshStartDockResize, wbDshBindDockEvents, wbDshResolveButtonLabel,
  wbDshBuildButtonQuote, wbDshBuildWorkflowQuote, wbDshBuildRepoQuote, wbDshBuildNodeQuote,
  wbDshPickCanvasQuoteTarget, wbDshResolveAltClickQuote, wbDshCloseExplainAnchors, wbDshHandlePointerDown,
  wbDshHandleContextAction, wbDshPinAnchorNote, wbDshHandleAnchorClick, wbDshConfirmBlankNode,
  wbDshHandleDockActionClick, wbDshHandleClick, wbDshHandleHostMessage, wbDshApplyPulseEvent,
  wbDshConnectEventStream, wbDshSwallowAltFollowup, wbDshBindEvents, wbDshSyncInitialGrillMeNode
];

export function buildWbDshShell() {
  const body = [
    ...WB_DSH_HELPER_FNS.map((fn) => fn.toString()),
    `(${initDoneGateDshIntegration.toString()})();`
  ].join('\n');
  return [WB_UI_OWNER_RESOLVER_SCRIPT, `(() => {\n${body}\n})();`].join('\n');
}
