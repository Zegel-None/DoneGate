// 工作台实时后端桥接外壳：ATLAS 活体数据注水、明暗双主题切换、撤销历史基线初始化、重扫后端与目录定位（<= 260 行）
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
      Object.entries(sv.customPacks).forEach(([k, v]) => { if (v && v.id) WORKFLOW_PACKS[k] = v; });
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
      }
    }).catch((err) => { void err; });
  }
})();
`;
}
