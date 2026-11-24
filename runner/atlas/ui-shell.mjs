// 工作台实时后端桥接外壳：ATLAS 注水、SSE 脉冲呼吸灯、顶栏上下文自同步、共享池依赖对账、过夜挂机切换与安全预览
const WB_UI_SHELL_SCRIPT = String.raw`
let liveServerConnected = false;
let persistTimer = null;
let dgEventSource = null;
let lastAutoDepSyncTs = 0;
let uiShAutopilotToken = 0;
let uiShAutopilotPinned = false;
const dgDepPollTimers = new Map();

const UI_SH_RUN_CHECK_TIP = '输入：当前工作区项目源码 → 执行：按画布连线依次真实运行各检查节点工具 → 输出：点亮每张卡片过关/拦截状态并生成可查看的检查记录';
const UI_SH_AUTOPILOT_IDLE_TIP = '启动过夜无人值守长跑：每步落盘断点检查点，遇三重防烧钱熔断或人工闸门自动安全停机并生成早间简报';
const UI_SH_AUTOPILOT_ACTIVE_TIP = '挂机正在后台自动推进（每步自动落盘断点检查点）· 再次点击可立即停止挂机';

function withDshSessionUrl(rawUrl) {
  const sid = (typeof DSH_SESSION_ID !== 'undefined' && DSH_SESSION_ID) ? String(DSH_SESSION_ID) : '';
  if (!sid || sid === 'default' || !String(rawUrl || '').startsWith('/donegate/api/')) return rawUrl;
  return rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'sessionId=' + encodeURIComponent(sid);
}

async function fetchDoneGateApi(primaryUrl, fallbackUrl, init) {
  const sid = (typeof DSH_SESSION_ID !== 'undefined' && DSH_SESSION_ID && DSH_SESSION_ID !== 'default') ? String(DSH_SESSION_ID) : '';
  const mergedInit = sid ? { ...(init || {}), headers: { ...((init && init.headers) || {}), 'x-dsh-session-id': sid } } : init;
  const r = await fetch(withDshSessionUrl(primaryUrl), mergedInit);
  return (r.status === 404 && fallbackUrl) ? fetch(fallbackUrl, init) : r;
}

function uiShResolveToolbarMeta() {
  const isWS = state.page === 'workshop';
  const runLabel = isWS ? '▶ 运行检查流' : '▶ 全面体检项目';
  if (state.leftTab === 'uiboard') {
    return { mode: 'uiboard', runLabel, refreshShort: '刷新界面预览', refreshFull: '↻ 刷新界面预览', refreshTip: '刷新当前项目的实时界面预览与 UI 增强套件状态' };
  }
  if (!isWS) {
    return { mode: 'sandbox', runLabel, refreshShort: '重扫项目代码', refreshFull: '↻ 重扫项目代码', refreshTip: '重新扫描当前工作区项目的文件结构、模块连线与验收状态' };
  }
  return { mode: 'workshop', runLabel, refreshShort: '同步依赖状态', refreshFull: '↻ 同步依赖状态', refreshTip: '重新核对共享底座池与各工作流所需工具的安装就绪状态' };
}

function uiShRenderAutopilotButton() {
  const btn = document.getElementById('btn-autopilot');
  if (!btn) return;
  const active = Boolean(state.autopilotActive);
  const dot = document.getElementById('autopilot-pulse-dot');
  const labelEl = document.getElementById('autopilot-btn-label') || btn.querySelector('span');
  btn.setAttribute('data-autopilot-active', active ? '1' : '0');
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.setAttribute('data-tip', active ? UI_SH_AUTOPILOT_ACTIVE_TIP : UI_SH_AUTOPILOT_IDLE_TIP);
  if (dot) dot.classList.toggle('hidden', !active);
  if (labelEl) labelEl.textContent = active ? '🟢 挂机运行中' : '🌙 挂机长跑';
  Object.assign(btn.style, active
    ? { background: 'rgba(22, 163, 74, 0.16)', borderColor: '#16a34a', color: 'var(--ok)', fontWeight: '600' }
    : { background: '', borderColor: '', color: '', fontWeight: '' });
}

function uiShSyncToolbarContext() {
  const meta = uiShResolveToolbarMeta();
  const runBtn = document.getElementById('btn-run-check');
  const runLabelEl = document.getElementById('run-btn-label');
  if (runLabelEl) runLabelEl.textContent = meta.runLabel;
  if (runBtn) {
    runBtn.setAttribute('aria-label', meta.runLabel);
    runBtn.setAttribute('data-tip', UI_SH_RUN_CHECK_TIP);
  }
  const refBtn = document.getElementById('btn-refresh-live');
  const refLabelEl = document.getElementById('refresh-live-label');
  if (refLabelEl) refLabelEl.textContent = meta.refreshShort;
  if (refBtn) {
    refBtn.setAttribute('aria-label', meta.refreshFull);
    refBtn.setAttribute('data-refresh-mode', meta.mode);
    refBtn.setAttribute('data-tip', meta.refreshTip);
  }
  uiShRenderAutopilotButton();
}

function applySyncedDepReports(reports, sharedPool, uiboardTc) {
  if (!state.packDepReports) state.packDepReports = {};
  if (sharedPool && typeof sharedPool === 'object') state.sharedPool = sharedPool;
  if (reports && typeof reports === 'object') {
    state.packDepReports = { ...state.packDepReports, ...reports };
    Object.entries(reports).forEach(([pid, rep]) => {
      if (!rep || typeof rep !== 'object') return;
      if (rep.ready && state.provisioningPacks) delete state.provisioningPacks[pid];
      if (Array.isArray(rep.items)) {
        rep.items.filter((it) => it && it.ready).forEach((it) => {
          (it.nodeIds || []).forEach((nid) => {
            if (state.provisioningNodes) delete state.provisioningNodes[nid];
            if (state.nodeTelemetry && state.nodeTelemetry[nid] && state.nodeTelemetry[nid].exitCode === 3) delete state.nodeTelemetry[nid];
          });
        });
      }
    });
  }
  if (uiboardTc && typeof applyUiBoardToolchainSnapshot === 'function') applyUiBoardToolchainSnapshot(uiboardTc);
}

function applyThemeClasses(theme) {
  const isDark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.body.classList.toggle('dark-mode', isDark);
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  applyThemeClasses(state.theme);
  try { localStorage.setItem('dg_v5_theme', state.theme); } catch (err) { void err; }
  renderHeader();
  renderWires();
}

function hydrateWorkbenchFromAtlas(atlasData, preservePositions) {
  if (!atlasData || typeof atlasData !== 'object') return;
  const wb = atlasData.workbench || {};
  if (!state.packDepReports) state.packDepReports = {};
  if (!state.provisioningPacks) state.provisioningPacks = {};
  if (!state.provisioningNodes) state.provisioningNodes = {};
  if (!state.nodeTelemetry) state.nodeTelemetry = {};
  if (!state.componentWorkflows) state.componentWorkflows = {};
  if (typeof state.autopilotActive !== 'boolean') state.autopilotActive = false;
  if (!(state.collapsedWfGroups instanceof Set)) state.collapsedWfGroups = new Set();
  if (!(state.collapsedNodeCats instanceof Set)) state.collapsedNodeCats = new Set();
  applySyncedDepReports(wb.packDepReports, wb.sharedPool, wb.uiboardToolchain);

  if (Array.isArray(wb.registeredTemplates)) {
    wb.registeredTemplates.forEach((tpl) => {
      if (tpl && tpl.tplId && !BLOCK_TEMPLATES[tpl.tplId]) {
        BLOCK_TEMPLATES[tpl.tplId] = tpl;
        if (tpl.category && !CATEGORY_LIST.includes(tpl.category)) CATEGORY_LIST.push(tpl.category);
      }
    });
  }

  if (wb.hostSandbox && Array.isArray(wb.hostSandbox.nodes) && wb.hostSandbox.nodes.length > 0) {
    const prevHost = REPO_SANDBOXES[wb.hostSandbox.id];
    const nextHost = JSON.parse(JSON.stringify(wb.hostSandbox));
    if (preservePositions && prevHost && Array.isArray(prevHost.nodes)) {
      const prevMap = new Map(prevHost.nodes.map((n) => [n.id, n]));
      nextHost.nodes.forEach((n) => {
        const old = prevMap.get(n.id);
        if (old) Object.assign(n, { x: old.x, y: old.y, w: old.w, h: old.h, color: old.color, bypassed: old.bypassed, collapsed: old.collapsed });
      });
      if (Array.isArray(prevHost.groups)) nextHost.groups = prevHost.groups;
    }
    REPO_SANDBOXES[nextHost.id] = nextHost;
    if (!preservePositions) { state.hostWorkspaceId = nextHost.id; state.viewingRepoId = nextHost.id; }
  }

  if (Array.isArray(wb.siblingSandboxes)) {
    wb.siblingSandboxes.forEach((sib) => { if (sib && sib.id && !REPO_SANDBOXES[sib.id]) REPO_SANDBOXES[sib.id] = sib; });
  }

  const sv = wb.savedState;
  if (sv && typeof sv === 'object' && sv.importedSandboxes) {
    const impList = Array.isArray(sv.importedSandboxes) ? sv.importedSandboxes : Object.values(sv.importedSandboxes);
    impList.forEach((sb) => { if (sb && sb.id) REPO_SANDBOXES[sb.id] = { ...sb, isImported: true }; });
  }
  if (!preservePositions && sv && typeof sv === 'object') {
    if (sv.customPacks && typeof sv.customPacks === 'object') {
      Object.entries(sv.customPacks).forEach(([k, v]) => {
        if (v && v.id) { WORKFLOW_PACKS[k] = v; if (v.group && !WORKFLOW_GROUPS.includes(v.group)) WORKFLOW_GROUPS.push(v.group); }
      });
    }
    if (sv.componentWorkflows && typeof sv.componentWorkflows === 'object') state.componentWorkflows = { ...state.componentWorkflows, ...sv.componentWorkflows };
    if (Array.isArray(sv.starredRepos) && sv.starredRepos.length > 0) state.starredRepos = new Set(sv.starredRepos);
    if (Array.isArray(sv.collapsedWfGroups)) state.collapsedWfGroups = new Set(sv.collapsedWfGroups);
    if (Array.isArray(sv.collapsedNodeCats)) state.collapsedNodeCats = new Set(sv.collapsedNodeCats);
    if (sv.textOverrides && typeof sv.textOverrides === 'object') state.customTextOverrides = { ...state.customTextOverrides, ...sv.textOverrides };
    if (sv.textStyles && typeof sv.textStyles === 'object') state.textStyleOverrides = { ...state.textStyleOverrides, ...sv.textStyles };
    if (sv.controlStyles && typeof sv.controlStyles === 'object') state.controlStyleOverrides = { ...state.controlStyleOverrides, ...sv.controlStyles };
  }
}

function connectDoneGateLiveEvents() {
  if (!/^https?:$/i.test(location.protocol) || typeof EventSource === 'undefined' || dgEventSource) return;
  try {
    dgEventSource = new EventSource(withDshSessionUrl('/donegate/api/events'));
    dgEventSource.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data || '{}');
        if (!state.nodeTelemetry) state.nodeTelemetry = {};
        if (msg.type === 'connected' && msg.nodeTelemetry) {
          state.nodeTelemetry = { ...state.nodeTelemetry, ...msg.nodeTelemetry };
          renderCanvas();
        } else if (msg.type === 'node_enter' && msg.nodeId) {
          state.nodeTelemetry[msg.nodeId] = { nodeId: msg.nodeId, state: 'running', updatedAt: Date.now() };
          renderCanvas();
        } else if (msg.type === 'gate_settled' && msg.nodeId) {
          const nextSt = msg.cacheHit ? 'cached' : (msg.exitCode === 0 ? 'pass' : (msg.exitCode === 1 ? 'fail' : 'fault'));
          state.nodeTelemetry[msg.nodeId] = { nodeId: msg.nodeId, state: nextSt, exitCode: msg.exitCode, durationMs: msg.durationMs || 0, cacheHit: Boolean(msg.cacheHit), diagSummary: msg.diagSummary || '' };
          renderCanvas();
        } else if (msg.type === 'jit_workflow_updated' && msg.nodeId && msg.binding) {
          state.componentWorkflows = { ...(state.componentWorkflows || {}), [msg.nodeId]: msg.binding };
          renderCanvas();
        } else if (msg.type === 'jit_workflows_batch_assigned' && msg.bindings) {
          state.componentWorkflows = { ...(state.componentWorkflows || {}), ...msg.bindings };
          renderCanvas();
        } else if (msg.type === 'workflow_pack_saved' && msg.packId && msg.pack) {
          WORKFLOW_PACKS[msg.packId] = msg.pack;
          if (msg.pack.group && !WORKFLOW_GROUPS.includes(msg.pack.group)) WORKFLOW_GROUPS.push(msg.pack.group);
          renderLeftDrawer();
        } else if (msg.type === 'workflow_deps_updated') {
          if (msg.reports || msg.report || msg.sharedPool || msg.uiboardToolchain) {
            const repMap = { ...(msg.reports || {}), ...(msg.packId && msg.report ? { [msg.packId]: msg.report } : {}) };
            applySyncedDepReports(repMap, msg.sharedPool, msg.uiboardToolchain);
            renderAll();
            if (state.leftTab === 'uiboard' && typeof renderUiBoardStageDom === 'function') renderUiBoardStageDom(true);
          } else {
            syncAllWorkflowDepsFromBackend(state.activePackId, true);
          }
        }
      } catch (err) { void err; }
    };
  } catch (err) { void err; }
}

function uiShIsRealWorkspacePreviewFile(j) {
  if (!j || !j.ok || j.exists === false || j.virtual === true) return false;
  const sp = String(j.sourcePath || '').trim();
  if (!sp || !/^[A-Za-z0-9._/-]+$/.test(sp) || sp.startsWith('.donegate/runs/telemetry/')) return false;
  return !String(j.content || '').trim().startsWith('// 该节点当前尚无');
}

function uiShShowSafeInlineObservation(nd, tool, detailText, toastText) {
  const title = (nd.title || tool || '检查节点') + ' · 检查记录说明';
  if ((typeof IS_DSH_EMBED === 'undefined' || !IS_DSH_EMBED) && typeof dshRuntime !== 'undefined') {
    dshRuntime.rightPreview = { open: true, title, path: '内置检查说明（尚未生成盘上文件）', diffText: detailText };
    if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
  }
  if (Array.isArray(state.chatMessages)) {
    const preHtml = '<pre class="mt-1 p-2 rounded text-[11px] overflow-auto font-mono" style="background: var(--surface-soft); white-space: pre-wrap;">' + esc(detailText) + '</pre>';
    state.chatMessages.push({ role: 'agent', html: '📊 <b>' + esc(title) + '</b><br>' + preHtml });
    state.rightOpen = true;
    if (typeof renderRightSidebar === 'function') renderRightSidebar();
  }
  showToast(toastText);
}

async function previewNodeObservation(nodeId) {
  const nd = getActiveNodesList().find((n) => n.id === nodeId);
  if (!nd) return;
  const slug = nd.repoSlug || (BLOCK_TEMPLATES[nd.tplId] && BLOCK_TEMPLATES[nd.tplId].repoSlug) || '';
  const tool = slug ? slug.split('/').pop().toLowerCase() : String(nd.tplId || '').replace(/^tpl-adp-/, '');
  const tel = state.nodeTelemetry && state.nodeTelemetry[nodeId];
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const r = await fetchDoneGateApi('/donegate/api/observation-preview?tool=' + encodeURIComponent(tool) + '&nodeId=' + encodeURIComponent(nodeId));
      const j = await r.json();
      if (r.ok && uiShIsRealWorkspacePreviewFile(j)) {
        openRightFilePreview(j.sourcePath, nd.title + ' · 观测与门禁输出', j.content);
        return;
      }
      if (r.ok && j && j.ok && j.content) {
        uiShShowSafeInlineObservation(nd, tool, j.content, '📊 已在内置面板展示「' + nd.title + '」检查说明（运行检查流后生成实体记录）');
        return;
      }
    } catch (err) { void err; }
  }
  const fallbackTxt = tel ? JSON.stringify(tel, null, 2) : ('节点「' + nd.title + '」当前尚未生成本地检查记录文件。\n请先点击顶栏「▶ 运行检查流」真实执行检查节点，生成记录后即可直接查看详细输出。');
  uiShShowSafeInlineObservation(nd, tool, fallbackTxt, '📊 尚未生成盘上检查记录，已在内置面板展示可读说明');
}

async function triggerJudgePackForCard(nodeId) {
  const nd = getActiveNodesList().find((n) => n.id === nodeId);
  if (!nd) return;
  const cid = nd.primaryContractId || (Array.isArray(nd.contractIds) && nd.contractIds[0]) || (Array.isArray(nd.contracts) && nd.contracts[0]) || '';
  if (!cid) { showToast('该模块尚未关联契约，请先通过「❝ 引用」让 Agent 建立 contract.json'); return; }
  if (!/^https?:$/i.test(location.protocol)) { showToast('连接本地服务后可一键打包契约「' + cid + '」的门 5 复核包'); return; }
  showToast('⚖️ 正在打包契约「' + cid + '」门 5 独立复核包...');
  try {
    const r = await fetchDoneGateApi('/donegate/api/judge/pack', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractId: cid }) });
    const out = await r.json();
    if (out && out.ok && out.relPackDir) {
      if (typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
        const summary = { label: '[复核包] ' + cid, title: out.relPackDir, detail: 'SHA-256: ' + String(out.packageHash || '').slice(0, 12), body: out.judgePrompt };
        window.parent.postMessage({ source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:insert-quote', text: out.judgePrompt, summary }, '*');
      }
      const msgHtml = '⚖️ 契约「<b>' + esc(cid) + '</b>」门 5 复核包已通过 INV-14 白名单校验并落盘：<br><code>' + esc(out.relPackDir) + '</code><br>可直接复制发给独立判方会话：<br><code>' + esc(out.judgePrompt) + '</code>';
      state.chatMessages.push({ role: 'agent', html: msgHtml });
      renderAll();
      showToast('⚖️ 复核包已生成：' + out.relPackDir);
    } else {
      showToast('⚖️ 暂无法打包：' + String((out && out.stderr) || '需先跑通 check 生成干净运行证据').split('\n')[0]);
    }
  } catch (err) { void err; showToast('盲审打包请求失败'); }
}

function exportActiveWorkflowJson(packId) {
  const pk = WORKFLOW_PACKS[packId || state.activePackId];
  if (!pk) return;
  const safeId = String(pk.id || 'workflow').replace(/[^a-zA-Z0-9._-]/g, '-');
  const payload = {
    schemaVersion: '1.0', id: safeId, name: pk.name || safeId, group: pk.group || '项目声明式工作流', tip: pk.tip || '',
    exportedAt: new Date().toISOString(), deps: Array.isArray(pk.deps) ? pk.deps : [], nodes: pk.nodes || [], links: pk.links || [], groups: pk.groups || []
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = safeId + '.workflow.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('⬇ 已导出工作流文件：' + safeId + '.workflow.json');
}

async function importWorkflowJsonText(rawText, sourceName) {
  let parsed = null;
  try { parsed = JSON.parse(rawText); } catch (err) { void err; showToast('导入失败：JSON 语法格式无效'); return; }
  if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    showToast('导入失败：不是有效的 .workflow.json（缺少 nodes 节点列表）'); return;
  }
  const baseId = String(parsed.id || String(sourceName || 'imported').replace(/\.workflow\.json$|\.json$/i, '')).replace(/[^a-zA-Z0-9._-]/g, '-');
  const packId = baseId || ('pack-u-' + Date.now());
  const normalized = {
    schemaVersion: parsed.schemaVersion || '1.0', id: packId, name: parsed.name || packId, group: parsed.group || '项目声明式工作流',
    tip: parsed.tip || ('自 ' + (sourceName || '.workflow.json') + ' 导入的工作流'), deps: Array.isArray(parsed.deps) ? parsed.deps : [],
    nodes: parsed.nodes, links: Array.isArray(parsed.links) ? parsed.links : [], groups: Array.isArray(parsed.groups) ? parsed.groups : []
  };
  if (!WORKFLOW_GROUPS.includes(normalized.group)) WORKFLOW_GROUPS.push(normalized.group);
  WORKFLOW_PACKS[packId] = normalized;
  state.page = 'workshop'; state.leftTab = 'workflows'; state.activePackId = packId; state.wsSubgraphStack = [];
  state.selectedNodeIds = normalized.nodes[0] ? new Set([normalized.nodes[0].id]) : new Set();
  if (/^https?:$/i.test(location.protocol)) {
    try {
      await fetchDoneGateApi('/donegate/api/workflow-pack/save', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: normalized }) });
      await syncAllWorkflowDepsFromBackend(packId);
    } catch (err) { void err; }
  }
  renderAll();
  requestAnimationFrame(fitCanvas);
  showToast('⬆ 已导入工作流「' + normalized.name + '」（如缺外部依赖可点「补齐」）');
}

function triggerWorkflowJsonFilePicker() {
  let inp = document.getElementById('wf-file-import-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.id = 'wf-file-import-input'; inp.type = 'file'; inp.accept = '.json,.workflow.json'; inp.className = 'hidden';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importWorkflowJsonText(String(reader.result || ''), f.name);
      reader.readAsText(f, 'utf-8');
      inp.value = '';
    });
    document.body.appendChild(inp);
  }
  inp.click();
}

async function syncAllWorkflowDepsFromBackend(focusPackId, silent, forceReconcile) {
  if (!/^https?:$/i.test(location.protocol)) {
    if (!silent && focusPackId && WORKFLOW_PACKS[focusPackId]) {
      const s = computeClientPackDepSummary(WORKFLOW_PACKS[focusPackId]);
      showToast(s.missingCount > 0 ? ('离线核对：尚缺 ' + s.missingCount + ' 项工具依赖') : '离线核对：所需工具依赖均已就绪');
    }
    return null;
  }
  try {
    const endpoint = forceReconcile ? '/donegate/api/workflow-deps/refresh' : '/donegate/api/workflow-deps/inspect';
    const body = JSON.stringify({ workflowId: focusPackId || state.activePackId || null, packs: WORKFLOW_PACKS });
    const r = await fetchDoneGateApi(endpoint, null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = await r.json();
    if (r.ok && j && (j.reports || j.report)) {
      const repMap = j.reports || { [j.report.packId]: j.report };
      applySyncedDepReports(repMap, j.sharedPool, j.uiboardToolchain);
      renderHeader(); renderLeftDrawer(); renderCanvas();
      if (!silent && focusPackId && state.packDepReports[focusPackId]) {
        const rep = state.packDepReports[focusPackId];
        showToast(rep.ready ? ('✓「' + rep.packName + '」全部 ' + rep.total + ' 项依赖已就位') : ('「' + rep.packName + '」尚缺 ' + rep.missingCount + ' 项依赖待补齐'));
      }
      return state.packDepReports;
    }
  } catch (err) { void err; }
  return null;
}

function uiShIsAutopilotServerActive(rec) {
  return Boolean(rec && typeof rec === 'object' && ['PREFLIGHT', 'RUNNING', 'SUSPENDED_HUMAN_GATE'].includes(rec.state));
}

function uiShIsAutopilotServerHalted(rec) {
  return Boolean(rec && typeof rec === 'object' && ['TRIPPED_CIRCUIT_BREAKER', 'IDLE', 'STOPPED', 'ABORTED'].includes(rec.state));
}

async function syncAutopilotMorningBrief() {
  if (!/^https?:$/i.test(location.protocol)) { uiShRenderAutopilotButton(); return; }
  try {
    const r = await fetchDoneGateApi('/donegate/api/autopilot/status');
    const j = await r.json();
    const ap = j && j.autopilot;
    const camp = j && j.campaign;
    const srvActive = uiShIsAutopilotServerActive(ap) || uiShIsAutopilotServerActive(camp);
    const srvHalted = uiShIsAutopilotServerHalted(ap) || uiShIsAutopilotServerHalted(camp);
    if (srvActive) state.autopilotActive = true;
    else if (srvHalted || !uiShAutopilotPinned) {
      state.autopilotActive = false;
      if (srvHalted) uiShAutopilotPinned = false;
    }
    uiShRenderAutopilotButton();
    if (!ap || ap.state === 'COMPLETED') return;
    if (typeof dshRuntime !== 'undefined') {
      const dockId = 'ap-' + ap.runId;
      const isGate = ap.state === 'SUSPENDED_HUMAN_GATE';
      dshRuntime.dockItems = dshRuntime.dockItems.filter((x) => x.id !== dockId);
      dshRuntime.dockItems.unshift({
        id: dockId, kind: isGate ? 'question' : 'blocked', tone: isGate ? 'warn' : 'bad',
        title: ap.morningSummaryLine || ('挂机单 ' + ap.runId + ' 状态：' + ap.state),
        targetNodeId: ap.cursorNodeId || null, approveRunId: isGate ? ap.runId : null, approveNodeId: ap.pendingHumanGate ? ap.pendingHumanGate.nodeId : null
      });
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
  } catch (err) { void err; }
}

function uiShStopAutopilotMode() {
  uiShAutopilotToken += 1;
  uiShAutopilotPinned = false;
  state.autopilotActive = false;
  renderAll();
  if (/^https?:$/i.test(location.protocol)) {
    fetchDoneGateApi('/donegate/api/autopilot/stop', null, { method: 'POST', body: '{}' }).catch((err) => { void err; });
  }
  showToast('⏹ 已停止挂机长跑（已完成节点的断点记录已安全保留）');
}

async function triggerStartAutopilot() {
  if (state.autopilotActive) { uiShStopAutopilotMode(); return; }
  if (state.page === 'sandbox') {
    const cont = getActiveSandboxContainer();
    const nodes = getActiveNodesList().filter((n) => !n.isBoundary && !n.isSubRepoRef && !n.bypassed);
    if (!nodes.length) { showToast('当前项目看板无可挂机组件节点'); return; }
    const myToken = ++uiShAutopilotToken;
    uiShAutopilotPinned = true; state.autopilotActive = true; renderAll();
    if (!/^https?:$/i.test(location.protocol)) {
      showToast('🟢 挂机运行中（再次点击可停止；连接本地服务后自动执行后台拓扑挂机）'); return;
    }
    showToast('🟢 挂机运行中：已启动全看板 ' + nodes.length + ' 个组件拓扑级自动推进...');
    try {
      const reqBody = JSON.stringify({ nodes, links: cont.links || [], componentWorkflows: state.componentWorkflows || {}, useWorktreeSandbox: true, useFingerprintCache: true });
      const r = await fetchDoneGateApi('/donegate/api/autopilot/start-project', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody });
      const out = await r.json();
      if (myToken !== uiShAutopilotToken || !state.autopilotActive) return;
      if (out && out.suspended && out.pendingHumanGate) {
        const gateHtml = '⏸ 项目拓扑挂机在组件「<b>' + esc(out.suspendedComponentId || '') + '</b>」人工闸门「<b>' + esc(out.pendingHumanGate.title) + '</b>」安全挂起。<br><br><button type="button" class="ghost-btn is-primary text-[11px]" data-action="approve-autopilot-gate" data-campaign="' + esc(out.campaignId) + '" data-run="' + esc(out.suspendedSubRunId || '') + '" data-node="' + esc(out.pendingHumanGate.nodeId) + '">✓ 批准闸门并续跑剩余拓扑组件</button>';
        state.chatMessages.push({ role: 'agent', html: gateHtml });
        renderAll(); showToast('⏸ 项目挂机已停在人工闸门待拍板');
      } else if (out && !out.ok) {
        uiShAutopilotPinned = false; state.autopilotActive = false;
        renderAll(); showToast('🛑 组件挂机拦截（主工作区已隔离零污染）：' + (out.reason || out.code || '未通过'));
      } else {
        renderAll(); showToast('🌅 全项目 ' + (out.completedCount || nodes.length) + ' 个组件拓扑挂机通关（缓存命中 ' + (out.cacheHits || 0) + ' 项）');
      }
    } catch (err) { void err; uiShAutopilotPinned = false; state.autopilotActive = false; renderAll(); showToast('项目拓扑挂机请求异常'); }
    return;
  }
  const pk = WORKFLOW_PACKS[state.activePackId];
  if (!pk) return;
  const myToken = ++uiShAutopilotToken;
  uiShAutopilotPinned = true; state.autopilotActive = true; renderAll();
  if (!/^https?:$/i.test(location.protocol)) {
    showToast('🟢 挂机运行中（再次点击可停止；连接本地服务后自动执行后台断点续跑）'); return;
  }
  showToast('🟢 挂机运行中：已在独立沙箱启动后台无人值守长跑...');
  try {
    const reqBody = JSON.stringify({ pack: pk, useWorktreeSandbox: true, useFingerprintCache: true });
    const r = await fetchDoneGateApi('/donegate/api/autopilot/start', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody });
    const out = await r.json();
    if (myToken !== uiShAutopilotToken || !state.autopilotActive) return;
    if (out && out.suspended && out.pendingHumanGate) {
      const gateHtml = '⏸ 过夜挂机已运行至人工闸门「<b>' + esc(out.pendingHumanGate.title) + '</b>」安全挂起（已存盘断点 <code>' + esc(out.runId) + '</code>）。<br><br><button type="button" class="ghost-btn is-primary text-[11px]" data-action="approve-autopilot-gate" data-run="' + esc(out.runId) + '" data-node="' + esc(out.pendingHumanGate.nodeId) + '">✓ 批准闸门并从断点续跑</button>';
      state.chatMessages.push({ role: 'agent', html: gateHtml });
      await syncAutopilotMorningBrief(); renderAll(); showToast('⏸ 已停在人工闸门待你拍板');
    } else if (out && !out.ok) {
      uiShAutopilotPinned = false; state.autopilotActive = false;
      renderAll(); showToast('🛑 挂机拦截（主工作区已隔离保护）：' + (out.reason || out.code || '未通过'));
    } else {
      renderAll(); showToast('🌅 挂机长跑全部完成（免跑缓存命中 ' + ((out && out.cacheHits) || 0) + ' 项）');
    }
  } catch (err) { void err; uiShAutopilotPinned = false; state.autopilotActive = false; renderAll(); showToast('挂机服务请求异常'); }
}

async function approveAndResumeAutopilot(runId, nodeId, campaignId) {
  const pk = WORKFLOW_PACKS[state.activePackId];
  if (!/^https?:$/i.test(location.protocol)) return;
  try {
    const body = JSON.stringify({ runId, nodeId, campaignId: campaignId || null, pack: campaignId ? null : pk, by: '业主' });
    const r = await fetchDoneGateApi('/donegate/api/autopilot/approve', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const out = await r.json();
    if (typeof dshRuntime !== 'undefined') {
      dshRuntime.dockItems = dshRuntime.dockItems.filter((x) => x.approveRunId !== runId);
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
    const doneOk = Boolean(out && out.ok && !out.suspended);
    state.chatMessages.push({ role: 'agent', html: doneOk ? '🌅 已批准人工闸门并从断点续跑收工（已完成全部下游门禁）！' : ('⚡ 已批准当前闸门，当前状态：' + esc((out && out.state) || '运行中')) });
    renderAll();
    showToast(doneOk ? '🌅 断点续跑已全部通关！' : '✓ 闸门已放行并继续执行');
  } catch (err) { void err; }
}

function uiShGetActiveWorkspaceLabel() {
  const host = REPO_SANDBOXES[state.hostWorkspaceId];
  if (host && host.name) return host.name;
  return (typeof ATLAS === 'object' && ATLAS && ATLAS.project && ATLAS.project.name) ? ATLAS.project.name : '当前工作区';
}

function uiShRecordRunSummary(workspaceName, flowTitle, runCount, passCount, blockCount) {
  const icon = blockCount > 0 ? '⛔' : '✅';
  const summaryLine = icon + ' 执行完成 · 目标工作区：' + workspaceName + ' · 运行节点：' + runCount + ' 个 · 通过 ' + passCount + ' / 拦截 ' + blockCount;
  if (Array.isArray(state.chatMessages)) {
    const html = icon + ' <b>' + esc(flowTitle) + ' · 检查执行汇总</b><br>目标工作区：<b>' + esc(workspaceName) + '</b><br>运行节点数：<b>' + Number(runCount) + '</b> 个 · 通过：<b>' + Number(passCount) + '</b> · 拦截：<b>' + Number(blockCount) + '</b>';
    state.chatMessages.push({ role: 'agent', html });
  }
  renderAll();
  showToast(summaryLine);
}

async function uiShExecuteWorkshopRunCheck() {
  const pk = WORKFLOW_PACKS[state.activePackId];
  if (!pk) return;
  const nodes = getActiveWorkshopGraph().nodes.filter((n) => !n.isBoundary);
  const blankNd = nodes.find((n) => n.isBlank && !n.bypassed);
  if (blankNd) {
    state.selectedNodeIds = new Set([blankNd.id]); renderAll();
    showToast('⛔ 无法运行：「' + blankNd.title + '」仍是空白待定节点，请先绑定检查节点或开启跳过'); return;
  }
  const dep = computeClientPackDepSummary(pk);
  if (dep.missingCount > 0) {
    const names = dep.missing.slice(0, 3).map((x) => x.title || x.id).join('、');
    const depHtml = '⛔ 工作流「<b>' + esc(pk.name) + '</b>」尚缺 <b>' + dep.missingCount + '</b> 项外部开源/环境依赖（' + esc(names) + '），已按类 ComfyUI 规则阻断运行。<br><br><button type="button" class="ghost-btn is-primary text-[11px]" data-action="provision-pack-deps" data-pack="' + esc(pk.id) + '">📦 一键后台补齐至 ' + esc(dep.depsDir) + '/</button>';
    state.chatMessages.push({ role: 'agent', html: depHtml });
    renderAll(); showToast('⛔ 缺 ' + dep.missingCount + ' 项依赖未就位，请先点工作流旁「补齐」按钮'); return;
  }
  const activeNodes = nodes.filter((n) => !n.bypassed);
  const wsName = uiShGetActiveWorkspaceLabel();
  if (!state.nodeTelemetry) state.nodeTelemetry = {};

  if (/^https?:$/i.test(location.protocol)) {
    showToast('▶ 正在对「' + wsName + '」按连线运行 ' + activeNodes.length + ' 个检查节点...');
    try {
      const body = JSON.stringify({ pack: pk, headline: pk.name + ' 检查流运行', useFingerprintCache: false });
      const r = await fetchDoneGateApi('/donegate/api/dispatch', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const out = await r.json();
      const completed = (out && out.checkpoint && Array.isArray(out.checkpoint.completedNodes)) ? out.checkpoint.completedNodes : [];
      completed.forEach((c) => {
        state.nodeTelemetry[c.nodeId] = { nodeId: c.nodeId, state: c.exitCode === 0 ? 'pass' : (c.exitCode === 1 ? 'fail' : 'fault'), exitCode: c.exitCode };
      });
      if (out && out.breaker && out.breaker.nodeId) {
        state.nodeTelemetry[out.breaker.nodeId] = { nodeId: out.breaker.nodeId, state: 'fail', exitCode: out.exitCode || 1, diagSummary: out.breaker.reason || '' };
      }
      const passCount = completed.filter((c) => c.exitCode === 0).length;
      const failInCompleted = completed.filter((c) => c.exitCode !== 0).length;
      const breakerExtra = (out && !out.ok && failInCompleted === 0) ? 1 : 0;
      const blockCount = failInCompleted + breakerExtra;
      uiShRecordRunSummary(wsName, pk.name, (completed.length + breakerExtra) || activeNodes.length, passCount, blockCount);
      return;
    } catch (err) { void err; }
  }

  activeNodes.forEach((nd) => {
    if (!state.nodeTelemetry[nd.id]) state.nodeTelemetry[nd.id] = { nodeId: nd.id, state: 'pass', exitCode: 0 };
  });
  const passOff = activeNodes.filter((nd) => (state.nodeTelemetry[nd.id]?.exitCode ?? 0) === 0).length;
  uiShRecordRunSummary(wsName, pk.name, activeNodes.length, passOff, activeNodes.length - passOff);
}

async function uiShHandleRunCheckClick() {
  if (state.page === 'workshop') { await uiShExecuteWorkshopRunCheck(); return; }
  const wsName = uiShGetActiveWorkspaceLabel();
  if (/^https?:$/i.test(location.protocol)) await uiShRescanProjectAtlas(true);
  const sbNodes = getActiveNodesList().filter((n) => !n.isBoundary && !n.isSubRepoRef && !n.bypassed);
  const mods = (typeof ATLAS === 'object' && ATLAS && Array.isArray(ATLAS.modules)) ? ATLAS.modules : [];
  const runCount = sbNodes.length || mods.length;
  const passCount = mods.length > 0 ? mods.filter((m) => m.tone === 'ok').length : sbNodes.length;
  const blockCount = mods.length > 0 ? mods.filter((m) => m.tone === 'bad').length : 0;
  uiShRecordRunSummary(wsName, '项目全面体检', runCount, passCount, blockCount);
}

function startWorkflowDepsPoll(packId, onlyNodeId) {
  const pollKey = packId + ':' + (onlyNodeId || '*');
  if (dgDepPollTimers.has(pollKey)) clearInterval(dgDepPollTimers.get(pollKey));
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    const reports = await syncAllWorkflowDepsFromBackend(packId, true, true);
    if (packId === 'uiboard' && typeof syncUiBoardBackendStatus === 'function') await syncUiBoardBackendStatus(true);
    const rep = reports && reports[packId];
    const nodeReady = Boolean(onlyNodeId && rep && Array.isArray(rep.missing) && !rep.missing.some((m) => (Array.isArray(m.nodeIds) && m.nodeIds.includes(onlyNodeId)) || m.nodeId === onlyNodeId));
    if ((rep && rep.ready) || nodeReady || attempts >= 24) {
      clearInterval(timer); dgDepPollTimers.delete(pollKey);
      if (state.provisioningPacks && (!rep || rep.ready || attempts >= 24)) delete state.provisioningPacks[packId];
      if (onlyNodeId && state.provisioningNodes) delete state.provisioningNodes[onlyNodeId];
      renderAll();
      if ((rep && rep.ready) || nodeReady) showToast('✅「' + ((WORKFLOW_PACKS[packId] && WORKFLOW_PACKS[packId].name) || packId) + '」依赖已安装就位');
    }
  }, 2500);
  dgDepPollTimers.set(pollKey, timer);
}

async function triggerProvisionWorkflowDeps(packId, opts = {}) {
  const pk = WORKFLOW_PACKS[packId || state.activePackId];
  if (!pk) return;
  const onlyNodeId = (opts && opts.onlyNodeId) || null;
  if (!state.provisioningPacks) state.provisioningPacks = {};
  state.provisioningPacks[pk.id] = true;
  if (onlyNodeId) { if (!state.provisioningNodes) state.provisioningNodes = {}; state.provisioningNodes[onlyNodeId] = true; }
  renderAll();
  const clearProvisioning = () => {
    if (state.provisioningPacks) delete state.provisioningPacks[pk.id];
    if (onlyNodeId && state.provisioningNodes) delete state.provisioningNodes[onlyNodeId];
  };

  if (/^https?:$/i.test(location.protocol)) {
    try {
      const sessId = typeof DSH_SESSION_ID !== 'undefined' ? DSH_SESSION_ID : 'default';
      const body = JSON.stringify({ pack: pk, onlyNodeId, sessionId: sessId, spawnSubagent: true });
      const r = await fetchDoneGateApi('/donegate/api/workflow-deps/provision', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const rep = await r.json();
      if (r.ok && rep && rep.ok) {
        applySyncedDepReports({ [pk.id]: rep }, null, null);
        if (rep.ready === true) {
          clearProvisioning(); renderAll();
          showToast('✅「' + pk.name + '」依赖已全部就位（' + rep.depsDir + '/）');
          return;
        }
        if (rep.missingCount > 0) {
          if (rep.subagentDispatched) {
            renderAll();
            showToast('🚀 已在编队派发子代理（' + (rep.subagentName || 'worker') + '）后台安装依赖');
            startWorkflowDepsPoll(pk.id, onlyNodeId);
            return;
          }
          if (rep.fallbackAutoSubmit && typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
            window.parent.postMessage({ source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:dispatch-subagent', prompt: rep.agentPrompt }, '*');
            renderAll();
            showToast('🚀 已自动触发主对话拉起编队子代理后台安装依赖');
            startWorkflowDepsPoll(pk.id, onlyNodeId);
            return;
          }
          clearProvisioning(); renderAll();
          showToast('当前为离线静态快照，请在 DSH Web 中打开以派发编队子代理安装依赖');
          return;
        }
      }
    } catch (err) { void err; }
  }
  clearProvisioning(); renderAll();
  showToast('当前为离线静态快照，请在 DSH Web 中打开以派发编队子代理安装依赖');
}

function collectPersistedSnapshot() {
  const customPacks = {};
  Object.entries(WORKFLOW_PACKS).forEach(([id, pk]) => { if (id.startsWith('pack-u-')) customPacks[id] = pk; });
  const importedSandboxes = {};
  Object.entries(REPO_SANDBOXES).forEach(([id, rp]) => { if (rp && (rp.isImported || String(id).startsWith('imp-'))) importedSandboxes[id] = rp; });
  const hostRepo = REPO_SANDBOXES[state.hostWorkspaceId];
  const hostNodeLayouts = {};
  if (hostRepo && Array.isArray(hostRepo.nodes)) {
    hostRepo.nodes.forEach((n) => {
      hostNodeLayouts[n.id] = { x: Math.round(n.x || 0), y: Math.round(n.y || 0), w: Math.round(n.w || 252), h: n.h ? Math.round(n.h) : null, color: n.color || 'none', bypassed: Boolean(n.bypassed), collapsed: Boolean(n.collapsed), expanded: Boolean(n.expanded) };
    });
  }
  return {
    hostLayoutVer: 2, customPacks, importedSandboxes, componentWorkflows: state.componentWorkflows || {}, hostNodeLayouts,
    hostGroups: (hostRepo && Array.isArray(hostRepo.groups)) ? hostRepo.groups : [], starredRepos: [...state.starredRepos],
    collapsedWfGroups: state.collapsedWfGroups instanceof Set ? [...state.collapsedWfGroups] : [],
    collapsedNodeCats: state.collapsedNodeCats instanceof Set ? [...state.collapsedNodeCats] : [],
    textOverrides: state.customTextOverrides, textStyles: state.textStyleOverrides, controlStyles: state.controlStyleOverrides
  };
}

function persistWorkbenchStateSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const snap = collectPersistedSnapshot();
    try { localStorage.setItem('dg_v5_wb_state', JSON.stringify(snap)); } catch (err) { void err; }
    if (!liveServerConnected && !/^https?:$/i.test(location.protocol)) return;
    try {
      const r = await fetchDoneGateApi('/donegate/api/state', '/api/workbench/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
      if (r.ok) liveServerConnected = true;
    } catch (err) { void err; }
  }, 420);
}

async function uiShRescanProjectAtlas(silentToast) {
  const resp = await fetchDoneGateApi('/donegate/api/atlas/refresh', '/api/atlas/refresh', { method: 'POST' });
  const data = await resp.json();
  if (!resp.ok || !data || !data.ok || !data.atlas) {
    if (!silentToast) showToast('刷新失败：' + ((data && data.reason) || resp.status));
    return false;
  }
  ATLAS = data.atlas; liveServerConnected = true;
  const syncBadge = document.getElementById('atlas-ov-sync');
  if (syncBadge) syncBadge.textContent = '实时同步已连接';
  applySyncedDepReports(data.packDepReports, data.sharedPool, data.uiboardToolchain);
  hydrateWorkbenchFromAtlas(ATLAS, true);
  await syncAllWorkflowDepsFromBackend(state.activePackId, true, true);
  await syncAutopilotMorningBrief();
  renderAll();
  const ovModal = document.getElementById('atlas-overview-modal');
  if (ovModal && !ovModal.classList.contains('hidden') && typeof renderAtlasOverviewModal === 'function') renderAtlasOverviewModal();
  if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
  if (!silentToast) showToast('✓ 已重新扫描当前工作区项目结构与验收状态（共 ' + ((ATLAS.project && ATLAS.project.moduleCount) || 0) + ' 个模块）');
  return true;
}

async function refreshBackendData() {
  const icon = document.getElementById('refresh-live-icon');
  if (icon) icon.classList.add('dg-spin');
  const meta = uiShResolveToolbarMeta();
  const ovModal = document.getElementById('atlas-overview-modal');
  const isOverviewOpen = Boolean(ovModal && !ovModal.classList.contains('hidden'));
  try {
    if (!/^https?:$/i.test(location.protocol)) {
      if (meta.mode === 'uiboard' && !isOverviewOpen) {
        if (typeof reloadUiBoardIframe === 'function') reloadUiBoardIframe();
        showToast('✓ 已刷新实时界面预览与 UI 增强套件状态');
      } else if (meta.mode === 'workshop' && !isOverviewOpen) {
        await syncAllWorkflowDepsFromBackend(state.activePackId, false, false);
      } else {
        showToast('当前为离线快照；运行 node runner/donegate.mjs status --open 开启实时服务');
      }
      return;
    }
    if (meta.mode === 'uiboard' && !isOverviewOpen) {
      await syncAllWorkflowDepsFromBackend('uiboard', true, true);
      if (typeof syncUiBoardBackendStatus === 'function') await syncUiBoardBackendStatus(true);
      await syncAutopilotMorningBrief();
      if (typeof renderUiBoardStageDom === 'function') renderUiBoardStageDom(true);
      renderAll();
      const uibTc = typeof uiBoardState !== 'undefined' && uiBoardState.toolchain;
      showToast('✓ 已刷新实时界面预览与 UI 增强套件状态' + (uibTc && uibTc.readyCount > 0 ? ('（' + uibTc.badgeLabel + '）') : ''));
      return;
    }
    if (meta.mode === 'workshop' && !isOverviewOpen) {
      await syncAllWorkflowDepsFromBackend(state.activePackId, true, true);
      await syncAutopilotMorningBrief();
      renderAll();
      const curRep = state.packDepReports && state.packDepReports[state.activePackId];
      if (state.sharedPool && state.sharedPool.readyCount > 0 && state.sharedPool.summaryLabel) {
        showToast('✓ 已同步依赖状态：共享底座池 ' + state.sharedPool.summaryLabel);
      } else if (curRep) {
        showToast(curRep.ready ? ('✓ 已同步依赖状态：「' + curRep.packName + '」全部依赖均已就绪') : ('已同步依赖状态：「' + curRep.packName + '」尚有 ' + curRep.missingCount + ' 项待安装'));
      } else {
        showToast('✓ 已同步共享底座池与各工作流工具依赖状态');
      }
      return;
    }
    await uiShRescanProjectAtlas(false);
  } catch (err) { void err; showToast('本地同步服务未启动'); } finally { if (icon) icon.classList.remove('dg-spin'); }
}

async function openFolderViaBackend(dirPath) {
  if (!dirPath) return;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const resp = await fetchDoneGateApi('/donegate/api/open-folder', '/api/workbench/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [dirPath], openOs: true }) });
      const data = await resp.json();
      if (resp.ok && data && data.ok && Array.isArray(data.resolved) && data.resolved[0]) {
        const item = data.resolved[0];
        showToast(item.exists ? ('已定位并请求打开目录：' + item.absPath) : ('路径尚未落盘：' + dirPath));
        return;
      }
    } catch (err) { void err; }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dirPath).catch((err) => { void err; });
  showToast('已复制目录路径：' + dirPath);
}

function uiShInstallToolbarPatches() {
  const dummyEl = { classList: { toggle() {} } };
  const baseGetById = document.getElementById.bind(document);
  const baseRenderHeader = renderHeader;
  renderHeader = function uiShPatchedRenderHeader() {
    document.getElementById = (id) => baseGetById(id) || (String(id).startsWith('tab-page-') ? dummyEl : null);
    try { baseRenderHeader(); } finally { document.getElementById = baseGetById; }
    uiShSyncToolbarContext();
  };
  if (typeof renderLeftDrawer === 'function') {
    const baseRenderLeftDrawer = renderLeftDrawer;
    renderLeftDrawer = function uiShPatchedRenderLeftDrawer() { baseRenderLeftDrawer(); uiShSyncToolbarContext(); };
  }
  if (typeof renderAll === 'function') {
    const baseRenderAll = renderAll;
    renderAll = function uiShPatchedRenderAll() { baseRenderAll(); uiShSyncToolbarContext(); };
  }
}

function uiShRebindRunCheckButton() {
  const oldBtn = document.getElementById('btn-run-check');
  if (!oldBtn) return;
  if (oldBtn.parentNode && typeof oldBtn.cloneNode === 'function') {
    const freshBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(freshBtn, oldBtn);
    freshBtn.addEventListener('click', () => { uiShHandleRunCheckClick(); });
    return;
  }
  oldBtn.addEventListener('click', (ev) => {
    if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    uiShHandleRunCheckClick();
  }, true);
}

(function bootDoneGateWorkbench() {
  try { const savedTheme = localStorage.getItem('dg_v5_theme'); if (savedTheme === 'dark' || savedTheme === 'light') state.theme = savedTheme; } catch (err) { void err; }
  uiShInstallToolbarPatches();
  applyThemeClasses(state.theme);
  hydrateWorkbenchFromAtlas(ATLAS, false);
  setupAllEvents();
  uiShRebindRunCheckButton();
  renderAll();
  uiShSyncToolbarContext();
  if (typeof initHistoryBaseline === 'function') initHistoryBaseline();
  requestAnimationFrame(fitCanvas);
  const checkHistoryAndPersist = () => { requestAnimationFrame(() => { if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint(); persistWorkbenchStateSoon(); }); };
  window.addEventListener('pointerup', checkHistoryAndPersist);
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#btn-undo, #btn-redo')) return; checkHistoryAndPersist(); });
  document.addEventListener('drop', checkHistoryAndPersist);
  document.addEventListener('focusout', checkHistoryAndPersist);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) return;
    if (['Enter', 'Delete', 'Backspace'].includes(e.key) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) checkHistoryAndPersist();
  });
  const triggerFocusAutoSync = () => {
    if (!/^https?:$/i.test(location.protocol) || Date.now() - lastAutoDepSyncTs < 1200) return;
    lastAutoDepSyncTs = Date.now();
    syncAllWorkflowDepsFromBackend(state.activePackId, true, true);
    syncAutopilotMorningBrief();
    if (state.leftTab === 'uiboard' && typeof syncUiBoardBackendStatus === 'function') syncUiBoardBackendStatus(true);
  };
  window.addEventListener('focus', triggerFocusAutoSync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) triggerFocusAutoSync(); });
  if (/^https?:$/i.test(location.protocol)) {
    fetchDoneGateApi('/donegate/api/ping', '/api/ping').then((r) => r.json()).then((j) => {
      if (j && j.ok) {
        liveServerConnected = true;
        const syncBadge = document.getElementById('atlas-ov-sync');
        if (syncBadge) syncBadge.textContent = '实时同步已连接';
      }
      syncAllWorkflowDepsFromBackend(state.activePackId, true, true);
      if (typeof syncUiBoardBackendStatus === 'function') syncUiBoardBackendStatus(false);
      syncAutopilotMorningBrief();
      connectDoneGateLiveEvents();
    }).catch(() => { syncAllWorkflowDepsFromBackend(state.activePackId, true, false); });
  }
})();
`;

export function buildShellScript() {
  return WB_UI_SHELL_SCRIPT;
}
