// 工作台全局撤销与重做引擎（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，默认保留 100 步完整状态栈，<= 250 行）
export function buildWbHistoryScript() {
  return String.raw`
const WB_HISTORY = {
  undoStack: [],
  redoStack: [],
  maxSteps: 100,
  baselineKey: '',
  baselinePayload: null,
  restoring: false
};

function captureContentFingerprintObj() {
  const tplCats = {};
  Object.keys(BLOCK_TEMPLATES).forEach((k) => { tplCats[k] = BLOCK_TEMPLATES[k].category; });
  return {
    packs: WORKFLOW_PACKS,
    sandboxes: REPO_SANDBOXES,
    categories: CATEGORY_LIST,
    tplCats,
    customTextOverrides: state.customTextOverrides,
    textStyleOverrides: state.textStyleOverrides,
    controlStyleOverrides: state.controlStyleOverrides,
    starredRepos: [...state.starredRepos]
  };
}

function captureFullHistoryEntry() {
  const contentJson = JSON.stringify(captureContentFingerprintObj());
  const viewCtx = {
    page: state.page,
    activePackId: state.activePackId,
    viewingRepoId: state.viewingRepoId,
    drillFromRepoId: state.drillFromRepoId,
    sandboxLayout: state.sandboxLayout,
    tidyMode: state.tidyMode,
    wsStackIds: (state.wsSubgraphStack || []).map((f) => f.sgNode.id),
    sbStackIds: (state.sbSubgraphStack || []).map((f) => f.sgNode.id)
  };
  return { contentJson, viewCtx };
}

function applyHistoryEntry(entry) {
  if (!entry || !entry.contentJson) return;
  WB_HISTORY.restoring = true;
  try {
    const data = JSON.parse(entry.contentJson);
    const vc = entry.viewCtx || {};

    Object.keys(WORKFLOW_PACKS).forEach((k) => { delete WORKFLOW_PACKS[k]; });
    Object.entries(data.packs || {}).forEach(([k, v]) => { WORKFLOW_PACKS[k] = v; });

    Object.keys(REPO_SANDBOXES).forEach((k) => { delete REPO_SANDBOXES[k]; });
    Object.entries(data.sandboxes || {}).forEach(([k, v]) => { REPO_SANDBOXES[k] = v; });

    CATEGORY_LIST.length = 0;
    (data.categories || []).forEach((c) => CATEGORY_LIST.push(c));
    Object.entries(data.tplCats || {}).forEach(([k, cat]) => {
      if (BLOCK_TEMPLATES[k]) BLOCK_TEMPLATES[k].category = cat;
    });

    state.customTextOverrides = data.customTextOverrides || {};
    state.textStyleOverrides = data.textStyleOverrides || {};
    state.controlStyleOverrides = data.controlStyleOverrides || {};
    state.starredRepos = new Set(data.starredRepos || []);

    if (vc.page) state.page = vc.page;
    if (vc.activePackId && WORKFLOW_PACKS[vc.activePackId]) {
      state.activePackId = vc.activePackId;
    } else if (!WORKFLOW_PACKS[state.activePackId]) {
      state.activePackId = Object.keys(WORKFLOW_PACKS)[0];
    }
    if (vc.viewingRepoId && REPO_SANDBOXES[vc.viewingRepoId]) {
      state.viewingRepoId = vc.viewingRepoId;
    } else if (!REPO_SANDBOXES[state.viewingRepoId]) {
      state.viewingRepoId = state.hostWorkspaceId;
    }
    state.drillFromRepoId = vc.drillFromRepoId || null;
    if (vc.sandboxLayout) state.sandboxLayout = vc.sandboxLayout;
    if (vc.tidyMode) state.tidyMode = vc.tidyMode;

    state.wsSubgraphStack = [];
    let wsNodes = (WORKFLOW_PACKS[state.activePackId] && WORKFLOW_PACKS[state.activePackId].nodes) || [];
    for (const sgId of (vc.wsStackIds || [])) {
      const found = wsNodes.find((n) => n.id === sgId && n.isSubgraph && n.subgraph);
      if (!found) break;
      state.wsSubgraphStack.push({ sgNode: found, title: found.title });
      wsNodes = found.subgraph.nodes || [];
    }

    state.sbSubgraphStack = [];
    let sbNodes = (REPO_SANDBOXES[state.viewingRepoId] && REPO_SANDBOXES[state.viewingRepoId].nodes) || [];
    for (const sgId of (vc.sbStackIds || [])) {
      const found = sbNodes.find((n) => n.id === sgId && n.isSubgraph && n.subgraph);
      if (!found) break;
      state.sbSubgraphStack.push({ sgNode: found, title: found.title });
      sbNodes = found.subgraph.nodes || [];
    }

    const validNodeIds = new Set(getActiveNodesList().map((n) => n.id));
    state.selectedNodeIds = new Set([...state.selectedNodeIds].filter((id) => validNodeIds.has(id)));
    const validGrpIds = new Set(getActiveGroupsList().map((g) => g.id));
    if (state.selectedGroupId && !validGrpIds.has(state.selectedGroupId)) state.selectedGroupId = null;
    state.editingGroupId = null;
    state.editingCardTitleId = null;
  } finally {
    WB_HISTORY.restoring = false;
  }
}

function syncHistoryButtonsUI() {
  const uBtn = document.getElementById('btn-undo');
  const rBtn = document.getElementById('btn-redo');
  const uLen = WB_HISTORY.undoStack.length;
  const rLen = WB_HISTORY.redoStack.length;
  if (uBtn) {
    uBtn.classList.toggle('opacity-45', uLen === 0);
    uBtn.setAttribute('data-tip', '撤销上一步更改 (Ctrl+Z) · 当前可回退 ' + uLen + ' / ' + WB_HISTORY.maxSteps + ' 步');
  }
  if (rBtn) {
    rBtn.classList.toggle('opacity-45', rLen === 0);
    rBtn.setAttribute('data-tip', '重做上一步更改 (Ctrl+Y 或 Ctrl+Shift+Z) · 当前可重做 ' + rLen + ' 步');
  }
}

function initHistoryBaseline() {
  const cur = captureFullHistoryEntry();
  WB_HISTORY.baselineKey = cur.contentJson;
  WB_HISTORY.baselinePayload = cur;
  WB_HISTORY.undoStack = [];
  WB_HISTORY.redoStack = [];
  syncHistoryButtonsUI();
}

function recordHistoryCheckpoint() {
  if (WB_HISTORY.restoring) return;
  if (typeof window.__isWorkbenchDragging === 'function' && window.__isWorkbenchDragging()) return;
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList && (activeEl.classList.contains('inline-text-rename') || activeEl.classList.contains('group-title-input'))) return;

  const cur = captureFullHistoryEntry();
  if (!WB_HISTORY.baselineKey) {
    WB_HISTORY.baselineKey = cur.contentJson;
    WB_HISTORY.baselinePayload = cur;
    syncHistoryButtonsUI();
    return;
  }
  if (cur.contentJson === WB_HISTORY.baselineKey) {
    // Keep view context fresh without wasting an undo step on pure navigation/selection
    WB_HISTORY.baselinePayload.viewCtx = cur.viewCtx;
    return;
  }

  WB_HISTORY.undoStack.push(WB_HISTORY.baselinePayload);
  if (WB_HISTORY.undoStack.length > WB_HISTORY.maxSteps) {
    WB_HISTORY.undoStack.shift();
  }
  WB_HISTORY.redoStack = [];
  WB_HISTORY.baselineKey = cur.contentJson;
  WB_HISTORY.baselinePayload = cur;
  syncHistoryButtonsUI();
}

function undoLastAction() {
  recordHistoryCheckpoint();
  if (WB_HISTORY.undoStack.length === 0) {
    showToast('已退回最早一步，没有更多可撤销更改');
    return false;
  }
  const prev = WB_HISTORY.undoStack.pop();
  WB_HISTORY.redoStack.push(WB_HISTORY.baselinePayload);
  WB_HISTORY.baselineKey = prev.contentJson;
  WB_HISTORY.baselinePayload = prev;
  applyHistoryEntry(prev);
  renderAll();
  syncHistoryButtonsUI();
  if (typeof persistWorkbenchStateSoon === 'function') persistWorkbenchStateSoon();
  showToast('已撤销上一步更改（剩余 ' + WB_HISTORY.undoStack.length + '/' + WB_HISTORY.maxSteps + ' 步可退，Ctrl+Y 重做）');
  return true;
}

function redoLastAction() {
  if (WB_HISTORY.redoStack.length === 0) {
    showToast('没有可重做的步骤');
    return false;
  }
  const next = WB_HISTORY.redoStack.pop();
  WB_HISTORY.undoStack.push(WB_HISTORY.baselinePayload);
  if (WB_HISTORY.undoStack.length > WB_HISTORY.maxSteps) WB_HISTORY.undoStack.shift();
  WB_HISTORY.baselineKey = next.contentJson;
  WB_HISTORY.baselinePayload = next;
  applyHistoryEntry(next);
  renderAll();
  syncHistoryButtonsUI();
  if (typeof persistWorkbenchStateSoon === 'function') persistWorkbenchStateSoon();
  showToast('已重做更改（剩余 ' + WB_HISTORY.redoStack.length + ' 步可重做）');
  return true;
}

function setMaxUndoSteps(nextMax) {
  const n = Math.min(500, Math.max(10, Math.round(Number(nextMax) || 100)));
  WB_HISTORY.maxSteps = n;
  while (WB_HISTORY.undoStack.length > n) WB_HISTORY.undoStack.shift();
  syncHistoryButtonsUI();
  return n;
}
`;
}
