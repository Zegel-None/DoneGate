// 开发看板「宏打底 + 节点级即时变招 (JIT)」前端控制器：卡片连招胶囊、需求变更派生微调、底座只增不减锁审批与一键沉淀为工作流宏
export function buildWbJitWorkflowScript() {
  return String.raw`
(function initDoneGateJitWorkflowModule() {
  const JIT_STYLE_ID = 'dg-jit-workflow-styles';
  if (typeof document !== 'undefined' && !document.getElementById(JIT_STYLE_ID)) {
    const st = document.createElement('style');
    st.id = JIT_STYLE_ID;
    st.textContent = [
      '.dg-sb-wf-bar { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 12px 7px; font-size: 10.5px; }',
      '.dg-sb-wf-pill { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; padding: 2px 8px; border-radius: 8px; border: 0.5px solid var(--border-subtle); background: var(--surface-soft); color: var(--text-main); font-weight: 500; cursor: pointer; transition: background 0.14s ease, border-color 0.14s ease; }',
      '.dg-sb-wf-pill:hover { border-color: var(--border-strong); opacity: 0.94; }',
      '.dg-sb-wf-pill.is-forked { border-color: var(--text-secondary); background: var(--primary-soft); color: var(--text-main); }',
      '.dg-sb-wf-mini { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 6px; border: 0.5px solid var(--border-subtle); background: transparent; color: var(--text-secondary); font-size: 10px; cursor: pointer; flex-shrink: 0; }',
      '.dg-sb-wf-mini:hover { background: var(--surface-soft); color: var(--text-main); }',
      '.dg-jit-backdrop { position: fixed; inset: 0; z-index: 260; background: rgba(0, 0, 0, 0.42); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 16px; }',
      '.dg-jit-modal { width: min(660px, 96vw); max-height: 86vh; overflow-y: auto; border-radius: 20px; background: var(--surface); color: var(--text-main); border: 0.5px solid var(--border-strong); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }',
      '.dg-jit-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-radius: 14px; background: var(--surface-soft); border: 0.5px solid var(--border-subtle); }',
      '.dg-jit-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 8px; background: var(--surface); border: 0.5px solid var(--border-subtle); font-size: 11.5px; color: var(--text-main); }',
      '.dg-jit-chip.is-floor { border-color: var(--text-secondary); font-weight: 600; }',
      '.dg-jit-chip.is-added { border-style: dashed; border-color: var(--ok); }',
      '.dg-jit-input { width: 100%; padding: 8px 11px; border-radius: 10px; border: 0.5px solid var(--border-strong); background: var(--surface-soft); color: var(--text-main); font-size: 12px; outline: none; }',
      '.dg-jit-btn { padding: 6px 12px; border-radius: 8px; border: 0.5px solid var(--border-strong); background: var(--surface-soft); color: var(--text-main); font-size: 11.5px; font-weight: 500; cursor: pointer; }',
      '.dg-jit-btn.is-solid { background: var(--primary); color: var(--primary-fg, #ffffff); border-color: transparent; }',
      'body.dark-mode .dg-jit-btn.is-solid { color: #151517; }',
      '.dg-jit-banner-warn { padding: 10px 12px; border-radius: 12px; border: 0.5px solid var(--warn); background: var(--warn-bg); color: var(--text-main); font-size: 11.5px; display: flex; flex-direction: column; gap: 8px; }'
    ].join('\n');
    document.head.appendChild(st);
  }
})();

const jitUiState = {
  modalNodeId: null,
  lastError: '',
  pendingApproval: null
};

function inferClientDefaultMacroForNode(node) {
  const hay = [
    node.title || '', node.tip || '',
    ...((node.scopePaths || [])),
    ...((node.modules || []).map((m) => (m.name || '') + ' ' + (m.role || '') + ' ' + (m.path || '')))
  ].join(' ').toLowerCase();
  const roles = new Set((node.modules || []).map((m) => m.role));
  let macroId = 'pack-core-logic';
  if (roles.has('界面') || /界面|ui|画布|前端|页面|弹窗|视图|按钮|\.tsx|\.jsx|\.vue/.test(hay)) macroId = 'pack-web';
  else if (roles.has('接口') || roles.has('安全') || /接口|鉴权|收银|支付|账本|密钥|订单|oauth|webhook/.test(hay)) macroId = 'pack-api-guard';
  else if (/安卓|android|apk|gradle/.test(hay)) macroId = 'pack-android';
  else if (/润色|文案|立约|契约|\.md/.test(hay)) macroId = 'pack-polish-loop';
  else if (/总装|灰度|上线|发版|分发/.test(hay)) macroId = 'pack-release';

  const pk = WORKFLOW_PACKS[macroId] || WORKFLOW_PACKS['pack-web'] || Object.values(WORKFLOW_PACKS)[0];
  const tplIds = pk && Array.isArray(pk.nodes) ? pk.nodes.map((n) => n.tplId).filter((t) => t && t !== 'tpl-blank') : ['tpl-anti-slop', 'tpl-router-rule'];
  const depSum = pk && typeof computeClientPackDepSummary === 'function' ? computeClientPackDepSummary(pk) : { missingCount: 0 };
  return {
    nodeId: node.id,
    nodeTitle: node.title,
    mode: 'macro',
    baseMacroId: pk ? pk.id : macroId,
    baseMacroName: pk ? pk.name : '核心纯逻辑护栏包',
    mandatoryFloorTplIds: ['tpl-anti-slop'],
    tplIds: tplIds.includes('tpl-anti-slop') ? tplIds : ['tpl-anti-slop', ...tplIds],
    addedTplIds: [],
    deltaCount: 0,
    depsReady: (depSum.missingCount || 0) === 0,
    missingDepsCount: depSum.missingCount || 0,
    reason: '总控按模块职责与路径自动预选基准连招宏'
  };
}

window.resolveClientComponentWorkflow = function resolveClientComponentWorkflow(node) {
  if (!node) return null;
  if (!state.componentWorkflows) state.componentWorkflows = {};
  if (state.componentWorkflows[node.id]) return state.componentWorkflows[node.id];
  if (node.workflowBinding && node.workflowBinding.tplIds) {
    state.componentWorkflows[node.id] = node.workflowBinding;
    return node.workflowBinding;
  }
  return inferClientDefaultMacroForNode(node);
};

window.renderSandboxWorkflowBadgeHtml = function renderSandboxWorkflowBadgeHtml(node, ro) {
  if (!node || node.isSubRepoRef || node.isBoundary) return '';
  const wf = window.resolveClientComponentWorkflow(node);
  if (!wf) return '';
  const isForked = wf.mode === 'jit-forked' || wf.mode === 'jit-synthesized' || (wf.deltaCount || 0) > 0;
  const dotColor = wf.depsReady === false ? 'var(--warn)' : 'var(--ok)';
  const deltaNum = wf.deltaCount || (wf.addedTplIds || []).length;
  const label = isForked
    ? ('⚡ ' + (wf.baseMacroName || '派生连招') + ' (+' + deltaNum + ')')
    : ('连招：' + (wf.baseMacroName || '基准护栏'));
  const totalCount = (wf.tplIds || []).length;
  const tip = isForked
    ? ('已按节点新需求局部变招（共 ' + totalCount + ' 块积木，底座护栏已锁死）· 点击打开连招微调与沉淀面板')
    : ((wf.reason || '总控自动配招') + '（共 ' + totalCount + ' 块积木）· 点击可按新需求局部变招');
  const rightPart = (!ro && isForked)
    ? ('<button type="button" class="dg-sb-wf-mini" data-jit-quick-promote="' + esc(node.id) + '" data-stop-drag="1" data-tip="将此节点实战验证好用的私有连招一键另存为全局工作流宏">💾 存宏</button>')
    : '<span class="text-[10px] shrink-0" style="color:var(--text-muted);" data-tip="底座护栏只增不减锁已生效">🔒底座</span>';
  return '<div class="dg-sb-wf-bar" data-stop-drag="1">'
    + '<button type="button" class="dg-sb-wf-pill ' + (isForked ? 'is-forked' : '') + '" data-jit-open="' + esc(node.id) + '" data-stop-drag="1" data-tip="' + esc(tip) + '">'
    + '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + dotColor + ';"></span>'
    + '<span class="truncate">' + esc(label) + '</span>'
    + '</button>'
    + rightPart
    + '</div>';
};

function applyOfflineJitMutation(node, opts) {
  const prev = window.resolveClientComponentWorkflow(node);
  const floorSet = new Set(['tpl-anti-slop', ...(prev.mandatoryFloorTplIds || [])]);
  const reqRemove = Array.isArray(opts.removeTplIds) ? opts.removeTplIds : [];
  const blocked = reqRemove.filter((id) => floorSet.has(id));
  if (blocked.length > 0 && !opts.humanApprovedFloorRemoval) {
    const names = blocked.map((id) => (BLOCK_TEMPLATES[id] && BLOCK_TEMPLATES[id].title) || id);
    return {
      ok: false,
      requiresHumanApproval: true,
      blockedTplIds: blocked,
      blockedTitles: names,
      reason: '触发「底座只增不减」安全锁：禁止擅自卸载核心护栏（' + names.join('、') + '）。如确需移除请点下方人工批准放行'
    };
  }
  if (blocked.length > 0 && opts.humanApprovedFloorRemoval) {
    blocked.forEach((id) => { if (id !== 'tpl-anti-slop') floorSet.delete(id); });
  }
  const q = String(opts.requirementText || '').toLowerCase();
  const pre = [];
  const post = [...(opts.addTplIds || [])];
  if (/公式|解析|语法|规格|复杂规则|重构|边界|表达式/.test(q)) pre.push('tpl-openspec');
  if (/文案|润色|提示语|说明|报告/.test(q)) pre.push('tpl-deai-polish');
  if (/联网|汇率|api|密钥|token|支付|鉴权|webhook/.test(q)) { post.push('tpl-gitleaks', 'tpl-router-rule'); }
  if (/界面|ui|按钮|弹窗|跳转|交互|点击|表单/.test(q)) post.push('tpl-playwright');
  if (/上线|迁移|不可逆|生产|审批/.test(q)) post.push('tpl-human-gate');

  const rmSet = new Set(reqRemove.filter((id) => !floorSet.has(id)));
  const cur = (prev.tplIds || ['tpl-anti-slop']).filter((id) => !rmSet.has(id));
  floorSet.forEach((f) => { if (!cur.includes(f)) cur.unshift(f); });
  const merged = [...new Set([...pre, ...cur, ...post])].filter((id) => BLOCK_TEMPLATES[id]);
  const basePk = prev.baseMacroId && WORKFLOW_PACKS[prev.baseMacroId];
  const baseSet = new Set(basePk ? basePk.nodes.map((n) => n.tplId) : ['tpl-anti-slop']);
  const added = merged.filter((id) => !baseSet.has(id));
  const next = {
    ...prev,
    mode: added.length > 0 || rmSet.size > 0 ? 'jit-forked' : prev.mode,
    mandatoryFloorTplIds: [...floorSet],
    tplIds: merged,
    addedTplIds: added,
    deltaCount: added.length,
    lastRequirement: String(opts.requirementText || '').trim(),
    reason: opts.requirementText ? ('已按新需求「' + String(opts.requirementText).slice(0, 36) + '」局部变招') : '已更新节点私有连招',
    updatedAt: new Date().toISOString()
  };
  state.componentWorkflows[node.id] = next;
  return { ok: true, binding: next };
}

window.requestJitAssignNode = async function requestJitAssignNode(nodeId, preferredMacroId) {
  const node = getActiveNodesList().find((n) => n.id === nodeId);
  if (!node) return null;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const r = await fetch('/donegate/api/jit/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Role': preferredMacroId ? 'human' : 'super-agent' },
        body: JSON.stringify({ nodeId: node.id, node, preferredMacroId: preferredMacroId || null })
      });
      const j = await r.json();
      if (r.ok && j && j.ok && j.binding) {
        if (!state.componentWorkflows) state.componentWorkflows = {};
        state.componentWorkflows[node.id] = j.binding;
        renderCanvas();
        if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
        showToast('🎯 已为「' + node.title + '」配招：' + j.binding.baseMacroName);
        return j.binding;
      }
    } catch (err) { void err; }
  }
  const pk = preferredMacroId && WORKFLOW_PACKS[preferredMacroId];
  const fallback = pk ? {
    ...inferClientDefaultMacroForNode(node),
    baseMacroId: pk.id,
    baseMacroName: pk.name,
    tplIds: pk.nodes.map((n) => n.tplId).filter((t) => t && t !== 'tpl-blank'),
    pinnedByHuman: true
  } : inferClientDefaultMacroForNode(node);
  if (!state.componentWorkflows) state.componentWorkflows = {};
  state.componentWorkflows[node.id] = fallback;
  renderCanvas();
  if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
  showToast('🎯 已为「' + node.title + '」挂载连招：' + fallback.baseMacroName);
  return fallback;
};

window.requestJitAssignAllSandbox = async function requestJitAssignAllSandbox() {
  const nodes = getActiveNodesList().filter((n) => !n.isSubRepoRef && !n.isBoundary);
  if (!nodes.length) return;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const r = await fetch('/donegate/api/jit/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Role': 'super-agent' },
        body: JSON.stringify({ nodes, forceReassign: false })
      });
      const j = await r.json();
      if (r.ok && j && j.ok && j.bindings) {
        state.componentWorkflows = { ...(state.componentWorkflows || {}), ...j.bindings };
        renderCanvas();
        showToast('🎯 总控已为全部 ' + j.assignedCount + ' 个看板组件自动配妥最佳连招');
        return;
      }
    } catch (err) { void err; }
  }
  if (!state.componentWorkflows) state.componentWorkflows = {};
  nodes.forEach((n) => { state.componentWorkflows[n.id] = inferClientDefaultMacroForNode(n); });
  renderCanvas();
  showToast('🎯 总控已为全部 ' + nodes.length + ' 个组件匹配连招');
};

window.requestJitMutateNode = async function requestJitMutateNode(nodeId, opts = {}) {
  const node = getActiveNodesList().find((n) => n.id === nodeId);
  if (!node) return null;
  jitUiState.lastError = '';
  jitUiState.pendingApproval = null;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const endpoint = opts.humanApprovedFloorRemoval ? '/donegate/api/jit/approve-floor' : '/donegate/api/jit/mutate';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Role': opts.actorRole || 'super-agent' },
        body: JSON.stringify({
          nodeId: node.id,
          node,
          requirementText: opts.requirementText || '',
          addTplIds: opts.addTplIds,
          removeTplIds: opts.removeTplIds,
          humanApprovedFloorRemoval: Boolean(opts.humanApprovedFloorRemoval)
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        jitUiState.lastError = j.reason || j.error || '连招微调被安全护栏拦截';
        if (j.requiresHumanApproval) {
          jitUiState.pendingApproval = { nodeId: node.id, blockedTplIds: j.blockedTplIds || [], blockedTitles: j.blockedTitles || [], requirementText: opts.requirementText || '' };
        }
        if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
        showToast(jitUiState.lastError);
        return j;
      }
      if (!state.componentWorkflows) state.componentWorkflows = {};
      state.componentWorkflows[node.id] = j.binding;
      renderCanvas();
      if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
      showToast('⚡ 「' + node.title + '」已按新需求局部变招（+' + j.binding.deltaCount + ' 积木）');
      return j;
    } catch (err) { void err; }
  }
  const off = applyOfflineJitMutation(node, opts);
  if (!off.ok) {
    jitUiState.lastError = off.reason;
    if (off.requiresHumanApproval) {
      jitUiState.pendingApproval = { nodeId: node.id, blockedTplIds: off.blockedTplIds, blockedTitles: off.blockedTitles, requirementText: opts.requirementText || '' };
    }
    if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
    showToast(off.reason);
    return off;
  }
  renderCanvas();
  if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
  showToast('⚡ 「' + node.title + '」已按新需求局部变招（+' + off.binding.deltaCount + ' 积木）');
  return off;
};

window.requestJitPromoteToMacro = async function requestJitPromoteToMacro(nodeId, customName) {
  const node = getActiveNodesList().find((n) => n.id === nodeId);
  if (!node) return null;
  const wf = window.resolveClientComponentWorkflow(node);
  const macroName = String(customName || (node.title + '沉淀连招')).trim();
  if (/^https?:$/i.test(location.protocol)) {
    try {
      await window.requestJitAssignNode(node.id, wf.baseMacroId);
      if (wf.mode === 'jit-forked' || (wf.addedTplIds && wf.addedTplIds.length)) {
        await fetch('/donegate/api/jit/mutate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DoneGate-Role': 'super-agent' },
          body: JSON.stringify({ nodeId: node.id, node, requirementText: wf.lastRequirement || '', addTplIds: wf.addedTplIds || [] })
        });
      }
      const r = await fetch('/donegate/api/jit/promote-macro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DoneGate-Role': 'human' },
        body: JSON.stringify({ nodeId: node.id, name: macroName })
      });
      const j = await r.json();
      if (r.ok && j && j.ok && j.macro) {
        WORKFLOW_PACKS[j.macro.id] = j.macro;
        if (j.macro.group && !WORKFLOW_GROUPS.includes(j.macro.group)) WORKFLOW_GROUPS.push(j.macro.group);
        state.componentWorkflows[node.id] = j.binding;
        renderLeftDrawer();
        renderCanvas();
        if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
        showToast('💾 已沉淀为全局宏「' + j.macro.name + '」，可在「开发流」页随时复用');
        return j.macro;
      }
    } catch (err) { void err; }
  }
  const macroId = 'macro-' + node.id.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + Date.now().toString(36).slice(-3);
  const builtNodes = (wf.tplIds || ['tpl-anti-slop']).map((tplId, idx) => instantiateWorkshopNode(tplId, 'm-' + (idx + 1), 48 + idx * 304, 96));
  const builtLinks = [];
  for (let i = 0; i < builtNodes.length - 1; i++) {
    const a = builtNodes[i];
    const b = builtNodes[i + 1];
    if (a.outputs[0] && b.inputs[0]) {
      builtLinks.push({ id: 'ml-' + (i + 1), fromNode: a.id, fromSlot: a.outputs[0].id, toNode: b.id, toSlot: b.inputs[0].id, type: a.outputs[0].type || 'ANY' });
    }
  }
  const newMacro = { id: macroId, group: '项目沉淀连招宏', name: macroName, tip: '由组件「' + node.title + '」一键沉淀复用', nodes: builtNodes, links: builtLinks, groups: [] };
  WORKFLOW_PACKS[macroId] = newMacro;
  if (!WORKFLOW_GROUPS.includes('项目沉淀连招宏')) WORKFLOW_GROUPS.push('项目沉淀连招宏');
  state.componentWorkflows[node.id] = { ...wf, mode: 'macro', baseMacroId: macroId, baseMacroName: macroName, addedTplIds: [], deltaCount: 0 };
  renderLeftDrawer();
  renderCanvas();
  if (jitUiState.modalNodeId === node.id) renderJitWorkflowModal();
  showToast('💾 已另存为工作流宏「' + macroName + '」');
  return newMacro;
};

window.handleSubagentJitChat = async function handleSubagentJitChat(node, text) {
  if (/另存为宏|沉淀为宏|保存为工作流/.test(text)) {
    const saved = await window.requestJitPromoteToMacro(node.id);
    if (saved) {
      state.chatMessages.push({
        role: 'agent',
        html: '已将节点「<b>' + esc(node.title) + '</b>」的私有连招一键沉淀为全局工作流宏「<b>' + esc(saved.name) + '</b>」，已同步至「开发流」列表供所有后续组件直接套用。'
      });
      renderRightSidebar();
      return true;
    }
  }
  const res = await window.requestJitMutateNode(node.id, { requirementText: text, actorRole: 'super-agent' });
  if (res && res.ok && res.binding) {
    const chainNames = (res.binding.tplIds || []).map((id) => (BLOCK_TEMPLATES[id] && BLOCK_TEMPLATES[id].title) || id).join(' → ');
    state.chatMessages.push({
      role: 'agent',
      html: '⚡ <b>总控已完成节点级即时变招</b>（执行端 Worker 只读锁定）：<br>• 适用组件：<b>' + esc(node.title) + '</b><br>• 当前连招链：<code>' + esc(chainNames) + '</code><br>• 底座护栏锁：<code>防 AI 手搓护栏套件</code> 保持锁死不可删减。'
    });
    renderRightSidebar();
    return true;
  }
  return false;
};

window.openJitWorkflowModal = function openJitWorkflowModal(nodeId) {
  jitUiState.modalNodeId = nodeId;
  jitUiState.lastError = '';
  jitUiState.pendingApproval = null;
  renderJitWorkflowModal();
};

window.closeJitWorkflowModal = function closeJitWorkflowModal() {
  jitUiState.modalNodeId = null;
  const old = document.getElementById('dg-jit-modal-root');
  if (old) old.remove();
};

function renderJitWorkflowModal() {
  let rootEl = document.getElementById('dg-jit-modal-root');
  if (!jitUiState.modalNodeId) {
    if (rootEl) rootEl.remove();
    return;
  }
  const node = getActiveNodesList().find((n) => n.id === jitUiState.modalNodeId);
  if (!node) { window.closeJitWorkflowModal(); return; }
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'dg-jit-modal-root';
    rootEl.className = 'dg-jit-backdrop';
    document.body.appendChild(rootEl);
  }
  const wf = window.resolveClientComponentWorkflow(node);
  const floorSet = new Set(['tpl-anti-slop', ...(wf.mandatoryFloorTplIds || [])]);
  const addedSet = new Set(wf.addedTplIds || []);
  const allMacros = Object.values(WORKFLOW_PACKS);
  const candidateBricks = Object.values(BLOCK_TEMPLATES).filter((b) => b && !b.isBlank && !(wf.tplIds || []).includes(b.tplId)).slice(0, 8);

  const chainHtml = (wf.tplIds || []).map((tplId, idx) => {
    const tpl = BLOCK_TEMPLATES[tplId] || { title: tplId };
    const isFloor = floorSet.has(tplId);
    const isAdded = addedSet.has(tplId);
    const arrow = idx > 0 ? '<span class="text-xs opacity-60">→</span>' : '';
    const icon = isFloor ? '🔒' : (isAdded ? '⚡' : '•');
    const rmTitle = isFloor ? '底座护栏默认锁死（点击将触发人工审批保护）' : '移除此增量积木';
    return arrow
      + '<span class="dg-jit-chip ' + (isFloor ? 'is-floor ' : '') + (isAdded ? 'is-added' : '') + '">'
      + '<span>' + icon + ' ' + esc(tpl.title || tplId) + '</span>'
      + '<button type="button" class="opacity-65 hover:opacity-100 px-1 text-[11px]" data-jit-rm-tpl="' + esc(tplId) + '" title="' + rmTitle + '">×</button>'
      + '</span>';
  }).join('');

  const approvalHtml = jitUiState.pendingApproval
    ? ('<div class="dg-jit-banner-warn">'
      + '<div><b>🔒 底座护栏「只增不减」安全拦截</b>：' + esc(jitUiState.lastError) + '</div>'
      + '<div class="flex items-center gap-2">'
      + '<button type="button" class="dg-jit-btn is-solid" data-jit-approve-floor="1">人工确认批准摘除（' + esc((jitUiState.pendingApproval.blockedTitles || []).join('、')) + '）</button>'
      + '<button type="button" class="dg-jit-btn" data-jit-cancel-floor="1">保持底座锁死</button>'
      + '</div></div>')
    : '';

  const macroOptions = allMacros.map((m) =>
    '<option value="' + esc(m.id) + '" ' + (m.id === wf.baseMacroId ? 'selected' : '') + '>' + esc(m.name) + '</option>'
  ).join('');

  const addButtons = candidateBricks.map((b) =>
    '<button type="button" class="dg-jit-btn text-[11px]" data-jit-add-tpl="' + esc(b.tplId) + '">+ ' + esc(b.title) + '</button>'
  ).join('');

  const jumpBtnHtml = (wf.baseMacroId && WORKFLOW_PACKS[wf.baseMacroId])
    ? ('<button type="button" class="dg-jit-btn" data-jit-jump-workshop="' + esc(wf.baseMacroId) + '">去「开发流」页查看 ↗</button>')
    : '';

  rootEl.innerHTML = '<div class="dg-jit-modal" data-stop-drag="1">'
    + '<div class="flex items-start justify-between gap-3">'
    + '<div>'
    + '<div class="text-sm font-semibold">节点连招装配与即时变招 · 「' + esc(node.title) + '」</div>'
    + '<div class="text-[11px] mt-0.5" style="color: var(--text-muted);">🛡️ 权限隔离：总控 (Super Agent) 动态配招变招 · 执行端 (Worker) 只读过关 · 底座护栏只增不减</div>'
    + '</div>'
    + '<button type="button" class="dg-jit-btn" data-jit-close="1">关闭</button>'
    + '</div>'
    + '<div class="flex flex-wrap items-center justify-between gap-2 text-xs">'
    + '<div class="flex items-center gap-2">'
    + '<span style="color: var(--text-secondary);">打底预置宏：</span>'
    + '<select id="dg-jit-macro-select" class="dg-jit-input" style="width: auto; padding: 4px 8px;">' + macroOptions + '</select>'
    + '<button type="button" class="dg-jit-btn" data-jit-switch-macro="1">套用此宏</button>'
    + '</div>'
    + '<span class="text-[11px]" style="color: var(--text-muted);">' + (wf.mode === 'jit-forked' ? '当前状态：节点私有派生连招（不污染全局宏）' : '当前状态：复用基准工作流宏') + '</span>'
    + '</div>'
    + '<div>'
    + '<div class="text-[11px] mb-1.5 font-medium" style="color: var(--text-secondary);">当前生效确定性连招链（共 ' + (wf.tplIds || []).length + ' 块积木）：</div>'
    + '<div class="dg-jit-chain">' + chainHtml + '</div>'
    + '</div>'
    + approvalHtml
    + '<div class="flex flex-col gap-1.5">'
    + '<label class="text-[11px] font-medium" style="color: var(--text-secondary);">改需求即时变招（描述新需求，总控自动前置/追加匹配积木）：</label>'
    + '<div class="flex items-center gap-2">'
    + '<input id="dg-jit-req-input" type="text" class="dg-jit-input flex-1" placeholder="例如：改需求支持自定义公式解析，并联网拉取实时汇率 API..." value="' + esc(wf.lastRequirement || '') + '">'
    + '<button type="button" class="dg-jit-btn is-solid shrink-0" data-jit-run-mutate="1">⚡ 按新需求变招</button>'
    + '</div></div>'
    + '<div>'
    + '<div class="text-[11px] mb-1.5" style="color: var(--text-secondary);">或从原子积木池手动点选追加：</div>'
    + '<div class="flex flex-wrap gap-1.5">' + addButtons + '</div>'
    + '</div>'
    + '<div class="pt-2 border-t flex flex-wrap items-center justify-between gap-2" style="border-color: var(--border-subtle);">'
    + '<div class="flex items-center gap-2 flex-1 min-w-[220px]">'
    + '<input id="dg-jit-promote-name" type="text" class="dg-jit-input" style="max-width: 220px;" placeholder="输入新工作流宏名称..." value="' + esc(node.title + '专属连招') + '">'
    + '<button type="button" class="dg-jit-btn" data-jit-promote-btn="1">💾 另存为工作流宏</button>'
    + '</div>'
    + jumpBtnHtml
    + '</div></div>';
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-jit-open]');
    if (openBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeCascadingMenus();
      window.openJitWorkflowModal(openBtn.getAttribute('data-jit-open'));
      return;
    }
    const quickPromote = e.target.closest('[data-jit-quick-promote]');
    if (quickPromote) {
      e.preventDefault();
      e.stopPropagation();
      window.requestJitPromoteToMacro(quickPromote.getAttribute('data-jit-quick-promote'));
      return;
    }
    const ctxOpen = e.target.closest('[data-card-ctx="jit-open"]');
    if (ctxOpen) {
      closeCascadingMenus();
      window.openJitWorkflowModal(ctxOpen.getAttribute('data-node'));
      return;
    }
    const ctxAssign = e.target.closest('[data-card-ctx="jit-auto-assign"]');
    if (ctxAssign) {
      closeCascadingMenus();
      window.requestJitAssignNode(ctxAssign.getAttribute('data-node'));
      return;
    }
    const ctxPromote = e.target.closest('[data-card-ctx="jit-promote"]');
    if (ctxPromote) {
      closeCascadingMenus();
      window.requestJitPromoteToMacro(ctxPromote.getAttribute('data-node'));
      return;
    }
    const ctxAll = e.target.closest('[data-ctx-simple="jit-assign-all"]');
    if (ctxAll) {
      closeCascadingMenus();
      window.requestJitAssignAllSandbox();
      return;
    }
    if (!jitUiState.modalNodeId) return;
    if (e.target.id === 'dg-jit-modal-root' || e.target.closest('[data-jit-close]')) {
      window.closeJitWorkflowModal();
      return;
    }
    if (e.target.closest('[data-jit-switch-macro]')) {
      const sel = document.getElementById('dg-jit-macro-select');
      if (sel && sel.value) window.requestJitAssignNode(jitUiState.modalNodeId, sel.value);
      return;
    }
    if (e.target.closest('[data-jit-run-mutate]')) {
      const inp = document.getElementById('dg-jit-req-input');
      window.requestJitMutateNode(jitUiState.modalNodeId, { requirementText: inp ? inp.value : '', actorRole: 'super-agent' });
      return;
    }
    const addBtn = e.target.closest('[data-jit-add-tpl]');
    if (addBtn) {
      const inp = document.getElementById('dg-jit-req-input');
      window.requestJitMutateNode(jitUiState.modalNodeId, { requirementText: inp ? inp.value : '', addTplIds: [addBtn.getAttribute('data-jit-add-tpl')], actorRole: 'super-agent' });
      return;
    }
    const rmBtn = e.target.closest('[data-jit-rm-tpl]');
    if (rmBtn) {
      window.requestJitMutateNode(jitUiState.modalNodeId, { removeTplIds: [rmBtn.getAttribute('data-jit-rm-tpl')], actorRole: 'super-agent' });
      return;
    }
    if (e.target.closest('[data-jit-approve-floor]') && jitUiState.pendingApproval) {
      window.requestJitMutateNode(jitUiState.modalNodeId, {
        requirementText: jitUiState.pendingApproval.requirementText || '人工批准调整底座护栏',
        removeTplIds: jitUiState.pendingApproval.blockedTplIds || [],
        actorRole: 'human',
        humanApprovedFloorRemoval: true
      });
      return;
    }
    if (e.target.closest('[data-jit-cancel-floor]')) {
      jitUiState.pendingApproval = null;
      jitUiState.lastError = '';
      renderJitWorkflowModal();
      return;
    }
    if (e.target.closest('[data-jit-promote-btn]')) {
      const nameInp = document.getElementById('dg-jit-promote-name');
      window.requestJitPromoteToMacro(jitUiState.modalNodeId, nameInp ? nameInp.value : '');
      return;
    }
    const jumpBtn = e.target.closest('[data-jit-jump-workshop]');
    if (jumpBtn) {
      const packId = jumpBtn.getAttribute('data-jit-jump-workshop');
      window.closeJitWorkflowModal();
      if (WORKFLOW_PACKS[packId]) state.activePackId = packId;
      state.page = 'workshop';
      state.leftTab = 'workflows';
      renderAll();
    }
  });
}
`;
}
