// 工作台实时后端桥接外壳：ATLAS 活体数据注水、开发流依赖就位巡检与一键后台补齐、明暗主题与目录定位（<= 295 行）
export function buildShellScript() {
  return String.raw`
let liveServerConnected = false;
let persistTimer = null;

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
  if (!state.provisionedPacks) state.provisionedPacks = {};

  if (Array.isArray(wb.registeredTemplates)) {
    wb.registeredTemplates.forEach((tpl) => {
      if (tpl && tpl.tplId && !BLOCK_TEMPLATES[tpl.tplId]) {
        BLOCK_TEMPLATES[tpl.tplId] = tpl;
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
        if (old) {
          n.x = old.x; n.y = old.y; n.w = old.w; n.h = old.h;
          n.color = old.color; n.bypassed = old.bypassed; n.collapsed = old.collapsed;
        }
      });
      if (Array.isArray(prevHost.groups)) nextHost.groups = prevHost.groups;
    }
    REPO_SANDBOXES[nextHost.id] = nextHost;
    if (!preservePositions) {
      state.hostWorkspaceId = nextHost.id;
      state.viewingRepoId = nextHost.id;
    }
  }

  if (Array.isArray(wb.siblingSandboxes)) {
    wb.siblingSandboxes.forEach((sib) => {
      if (sib && sib.id && !REPO_SANDBOXES[sib.id]) {
        REPO_SANDBOXES[sib.id] = sib;
      }
    });
  }

  const sv = wb.savedState;
  if (!preservePositions && sv && typeof sv === 'object') {
    if (sv.customPacks && typeof sv.customPacks === 'object') {
      Object.entries(sv.customPacks).forEach(([k, v]) => {
        if (v && v.id) {
          WORKFLOW_PACKS[k] = v;
          if (v.group && !WORKFLOW_GROUPS.includes(v.group)) WORKFLOW_GROUPS.push(v.group);
        }
      });
    }
    if (Array.isArray(sv.starredRepos) && sv.starredRepos.length > 0) {
      state.starredRepos = new Set(sv.starredRepos);
    }
    if (sv.textOverrides && typeof sv.textOverrides === 'object') {
      state.customTextOverrides = { ...state.customTextOverrides, ...sv.textOverrides };
    }
    if (sv.textStyles && typeof sv.textStyles === 'object') {
      state.textStyleOverrides = { ...state.textStyleOverrides, ...sv.textStyles };
    }
    if (sv.controlStyles && typeof sv.controlStyles === 'object') {
      state.controlStyleOverrides = { ...state.controlStyleOverrides, ...sv.controlStyles };
    }
  }
}

async function syncAllWorkflowDepsFromBackend(focusPackId) {
  if (!/^https?:$/i.test(location.protocol)) {
    if (focusPackId && WORKFLOW_PACKS[focusPackId]) {
      const s = computeClientPackDepSummary(WORKFLOW_PACKS[focusPackId]);
      showToast(s.missingCount > 0 ? ('离线检查：尚缺 ' + s.missingCount + ' 项依赖') : '离线检查：依赖已就位');
    }
    return;
  }
  try {
    const r = await fetch('/donegate/api/workflow-deps/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packs: WORKFLOW_PACKS })
    });
    const j = await r.json();
    if (r.ok && j && j.reports) {
      state.packDepReports = { ...(state.packDepReports || {}), ...j.reports };
      renderLeftDrawer();
      if (focusPackId && j.reports[focusPackId]) {
        const rep = j.reports[focusPackId];
        showToast(rep.ready ? ('✓「' + rep.packName + '」全部 ' + rep.total + ' 项依赖已就位') : ('「' + rep.packName + '」尚缺 ' + rep.missingCount + ' 项依赖待补齐'));
      }
    }
  } catch (err) { void err; }
}

async function triggerProvisionWorkflowDeps(packId) {
  const pk = WORKFLOW_PACKS[packId || state.activePackId];
  if (!pk) return;
  const safeId = String(pk.id || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fallbackDir = 'workflows/.deps/' + safeId;
  showToast('📦 正在准备「' + pk.name + '」专属依赖目录 ' + fallbackDir + '/...');

  if (/^https?:$/i.test(location.protocol)) {
    try {
      const r = await fetch('/donegate/api/workflow-deps/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: pk })
      });
      const rep = await r.json();
      if (r.ok && rep && rep.ok) {
        state.packDepReports = { ...(state.packDepReports || {}), [pk.id]: rep };
        if (rep.ready) {
          showToast('✅「' + pk.name + '」依赖已全部就位（' + rep.depsDir + '/）');
          renderAll();
          return;
        }
        if (typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: 'donegate-canvas',
            sessionId: DSH_SESSION_ID,
            type: 'dg:insert-quote',
            text: rep.agentPrompt,
            summary: { label: '[补齐依赖] ' + pk.name, title: rep.depsDir, detail: '待装 ' + rep.missingCount + ' 项开源组件与环境', body: rep.agentPrompt }
          }, '*');
        }
        if (typeof dshRuntime !== 'undefined') {
          dshRuntime.dockItems.unshift({
            id: 'dep-' + Date.now(),
            kind: 'receipt',
            title: '📦 已建好 ' + rep.depsDir + '/ 隔离清单，后台 Agent 正在拉取 ' + rep.missingCount + ' 项项目与环境依赖'
          });
          if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
        }
        state.chatMessages.push({
          role: 'agent',
          html: '📦 已为「<b>' + esc(pk.name) + '</b>」创建专属目录 <code>' + esc(rep.depsDir) + '/</code> 并生成补齐工单（共 <b>' + rep.missingCount + '</b> 项待装）：<br><pre class="mt-1 p-2 rounded text-[10.5px] whitespace-pre-wrap" style="background:var(--surface-soft);">' + esc(rep.agentPrompt) + '</pre>'
        });
        renderAll();
        showToast('📦 已派发后台 Agent 补齐工单至 ' + rep.depsDir + '/');
        return;
      }
    } catch (err) { void err; }
  }

  state.provisionedPacks[pk.id] = true;
  state.chatMessages.push({
    role: 'agent',
    html: '📦 离线预览模式：正式连接本地服务或 DSH 后，点击「补齐」会自动将「<b>' + esc(pk.name) + '</b>」所需开源项目与环境安装到 <code>' + esc(fallbackDir) + '/</code>。'
  });
  renderAll();
  showToast('已生成 ' + fallbackDir + '/ 补齐指令（连接 DSH 后自动后台执行）');
}

function collectPersistedSnapshot() {
  const customPacks = {};
  Object.entries(WORKFLOW_PACKS).forEach(([id, pk]) => {
    if (id.startsWith('pack-u-')) customPacks[id] = pk;
  });
  const hostRepo = REPO_SANDBOXES[state.hostWorkspaceId];
  const hostNodeLayouts = {};
  if (hostRepo && Array.isArray(hostRepo.nodes)) {
    hostRepo.nodes.forEach((n) => {
      hostNodeLayouts[n.id] = {
        x: Math.round(n.x || 0), y: Math.round(n.y || 0),
        w: Math.round(n.w || 252), h: n.h ? Math.round(n.h) : null,
        color: n.color || 'none', bypassed: Boolean(n.bypassed),
        collapsed: Boolean(n.collapsed), expanded: Boolean(n.expanded)
      };
    });
  }
  return {
    customPacks,
    hostNodeLayouts,
    hostGroups: (hostRepo && Array.isArray(hostRepo.groups)) ? hostRepo.groups : [],
    starredRepos: [...state.starredRepos],
    textOverrides: state.customTextOverrides,
    textStyles: state.textStyleOverrides,
    controlStyles: state.controlStyleOverrides
  };
}

function persistWorkbenchStateSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const snap = collectPersistedSnapshot();
    try { localStorage.setItem('dg_v5_wb_state', JSON.stringify(snap)); } catch (err) { void err; }
    if (!liveServerConnected && !/^https?:$/i.test(location.protocol)) return;
    try {
      const r = await fetch('/api/workbench/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap)
      });
      if (r.ok) liveServerConnected = true;
    } catch (err) { void err; }
  }, 420);
}

async function refreshBackendData() {
  const icon = document.getElementById('refresh-live-icon');
  if (icon) icon.classList.add('dg-spin');
  try {
    if (!/^https?:$/i.test(location.protocol)) {
      showToast('当前为离线 HTML 快照；运行 node runner/donegate.mjs status --open 可开启实时重扫服务');
      return;
    }
    const resp = await fetch('/api/atlas/refresh', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok || !data || !data.ok || !data.atlas) {
      showToast('刷新失败：' + ((data && data.reason) || resp.status));
      return;
    }
    ATLAS = data.atlas;
    liveServerConnected = true;
    const syncBadge = document.getElementById('atlas-ov-sync');
    if (syncBadge) syncBadge.textContent = '实时同步已连接';
    hydrateWorkbenchFromAtlas(ATLAS, true);
    await syncAllWorkflowDepsFromBackend();
    renderAll();
    if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
    const ovModal = document.getElementById('atlas-overview-modal');
    if (ovModal && !ovModal.classList.contains('hidden')) renderAtlasOverviewModal();
    showToast('已重扫全仓最新代码、入口与门禁状态（共 ' + ((ATLAS.project && ATLAS.project.moduleCount) || 0) + ' 个模块）');
  } catch (err) {
    void err;
    showToast('本地同步服务未启动，可运行 node runner/donegate.mjs status --open 开启');
  } finally {
    if (icon) icon.classList.remove('dg-spin');
  }
}

async function openFolderViaBackend(dirPath) {
  if (!dirPath) return;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const resp = await fetch('/api/workbench/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [dirPath], openOs: true })
      });
      const data = await resp.json();
      if (resp.ok && data && data.ok && Array.isArray(data.resolved) && data.resolved[0]) {
        const item = data.resolved[0];
        showToast(item.exists ? ('已定位并请求打开目录：' + item.absPath) : ('路径尚未落盘：' + dirPath));
        return;
      }
    } catch (err) { void err; }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(dirPath).catch((err) => { void err; });
  }
  showToast('已复制目录路径：' + dirPath);
}

(function bootDoneGateWorkbench() {
  try {
    const savedTheme = localStorage.getItem('dg_v5_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') state.theme = savedTheme;
  } catch (err) { void err; }
  applyThemeClasses(state.theme);

  hydrateWorkbenchFromAtlas(ATLAS, false);
  setupAllEvents();
  renderAll();
  if (typeof initHistoryBaseline === 'function') initHistoryBaseline();
  requestAnimationFrame(fitCanvas);

  const checkHistoryAndPersist = () => {
    requestAnimationFrame(() => {
      if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
      persistWorkbenchStateSoon();
    });
  };
  window.addEventListener('pointerup', checkHistoryAndPersist);
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#btn-undo, #btn-redo')) return;
    checkHistoryAndPersist();
  });
  document.addEventListener('drop', checkHistoryAndPersist);
  document.addEventListener('focusout', checkHistoryAndPersist);
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) return;
    if (['Enter', 'Delete', 'Backspace'].includes(e.key) || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
      checkHistoryAndPersist();
    }
  });

  if (/^https?:$/i.test(location.protocol)) {
    fetch('/api/ping').then((r) => r.json()).then((j) => {
      if (j && j.ok) {
        liveServerConnected = true;
        const syncBadge = document.getElementById('atlas-ov-sync');
        if (syncBadge) syncBadge.textContent = '实时同步已连接';
        syncAllWorkflowDepsFromBackend();
      }
    }).catch((err) => { void err; });
  }
})();
`;
}
