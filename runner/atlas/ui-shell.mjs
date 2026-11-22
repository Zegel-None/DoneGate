// 工作台实时后端桥接外壳：ATLAS 注水、SSE 脉冲呼吸灯、依赖补齐、过夜挂机、盲判打包与 .workflow.json 导入导出
export function buildShellScript() {
  return String.raw`
let liveServerConnected = false;
let persistTimer = null;
let dgEventSource = null;

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
  if (!state.nodeTelemetry) state.nodeTelemetry = {};
  if (!state.componentWorkflows) state.componentWorkflows = {};

  if (Array.isArray(wb.registeredTemplates)) {
    wb.registeredTemplates.forEach((tpl) => {
      if (tpl && tpl.tplId && !BLOCK_TEMPLATES[tpl.tplId]) BLOCK_TEMPLATES[tpl.tplId] = tpl;
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
    if (!preservePositions) { state.hostWorkspaceId = nextHost.id; state.viewingRepoId = nextHost.id; }
  }

  if (Array.isArray(wb.siblingSandboxes)) {
    wb.siblingSandboxes.forEach((sib) => {
      if (sib && sib.id && !REPO_SANDBOXES[sib.id]) REPO_SANDBOXES[sib.id] = sib;
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
    if (sv.componentWorkflows && typeof sv.componentWorkflows === 'object') state.componentWorkflows = { ...state.componentWorkflows, ...sv.componentWorkflows };
    if (Array.isArray(sv.starredRepos) && sv.starredRepos.length > 0) state.starredRepos = new Set(sv.starredRepos);
    if (sv.textOverrides && typeof sv.textOverrides === 'object') state.customTextOverrides = { ...state.customTextOverrides, ...sv.textOverrides };
    if (sv.textStyles && typeof sv.textStyles === 'object') state.textStyleOverrides = { ...state.textStyleOverrides, ...sv.textStyles };
    if (sv.controlStyles && typeof sv.controlStyles === 'object') state.controlStyleOverrides = { ...state.controlStyleOverrides, ...sv.controlStyles };
  }
}

function connectDoneGateLiveEvents() {
  if (!/^https?:$/i.test(location.protocol) || typeof EventSource === 'undefined' || dgEventSource) return;
  try {
    dgEventSource = new EventSource('/donegate/api/events');
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
          state.nodeTelemetry[msg.nodeId] = {
            nodeId: msg.nodeId,
            state: msg.cacheHit ? 'cached' : (msg.exitCode === 0 ? 'pass' : (msg.exitCode === 1 ? 'fail' : 'fault')),
            exitCode: msg.exitCode,
            durationMs: msg.durationMs || 0,
            cacheHit: Boolean(msg.cacheHit),
            diagSummary: msg.diagSummary || ''
          };
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
        } else if (msg.type === 'workflow_deps_updated' && msg.packId && msg.report) {
          state.packDepReports = { ...(state.packDepReports || {}), [msg.packId]: msg.report };
          renderLeftDrawer();
          renderCanvas();
        }
      } catch (err) { void err; }
    };
  } catch (err) { void err; }
}

async function previewNodeObservation(nodeId) {
  const nd = getActiveNodesList().find((n) => n.id === nodeId);
  if (!nd) return;
  const slug = nd.repoSlug || (BLOCK_TEMPLATES[nd.tplId] && BLOCK_TEMPLATES[nd.tplId].repoSlug) || '';
  const tool = slug ? slug.split('/').pop().toLowerCase() : String(nd.tplId || '').replace(/^tpl-adp-/, '');
  const tel = state.nodeTelemetry && state.nodeTelemetry[nodeId];
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const r = await fetch('/donegate/api/observation-preview?tool=' + encodeURIComponent(tool) + '&nodeId=' + encodeURIComponent(nodeId));
      const j = await r.json();
      if (r.ok && j && j.ok) {
        openRightFilePreview(j.sourcePath || ('bricks/' + tool + '/capabilities.json'), nd.title + ' · 观测与门禁输出', j.content);
        return;
      }
    } catch (err) { void err; }
  }
  const fallbackTxt = tel
    ? JSON.stringify(tel, null, 2)
    : ('// 节点「' + nd.title + '」实时观测预览\n// 连接本地服务并运行检查后，此处直接展示 .donegate/adapters/' + (tool || 'tool') + '/observation.json 原文');
  openRightFilePreview('.donegate/adapters/' + (tool || 'node') + '/observation.json', nd.title + ' · 观测输出', fallbackTxt);
}

async function triggerJudgePackForCard(nodeId) {
  const nd = getActiveNodesList().find((n) => n.id === nodeId);
  if (!nd) return;
  const cid = nd.primaryContractId || (Array.isArray(nd.contractIds) && nd.contractIds[0]) || (Array.isArray(nd.contracts) && nd.contracts[0]) || '';
  if (!cid) {
    showToast('该模块尚未关联契约，请先通过「❝ 引用」让 Agent 建立 contract.json');
    return;
  }
  if (!/^https?:$/i.test(location.protocol)) {
    showToast('连接本地服务后可一键打包契约「' + cid + '」的门 5 盲判复核包');
    return;
  }
  showToast('⚖️ 正在打包契约「' + cid + '」门 5 独立盲判材料包...');
  try {
    const r = await fetch('/donegate/api/judge/pack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractId: cid })
    });
    const out = await r.json();
    if (out && out.ok && out.relPackDir) {
      if (typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:insert-quote',
          text: out.judgePrompt, summary: { label: '[盲判包] ' + cid, title: out.relPackDir, detail: 'SHA-256: ' + String(out.packageHash || '').slice(0, 12), body: out.judgePrompt }
        }, '*');
      }
      state.chatMessages.push({
        role: 'agent',
        html: '⚖️ 契约「<b>' + esc(cid) + '</b>」门 5 盲判复核包已通过 INV-14 白名单校验并落盘：<br><code>' + esc(out.relPackDir) + '</code><br>可直接复制发给独立判方会话：<br><code>' + esc(out.judgePrompt) + '</code>'
      });
      renderAll();
      showToast('⚖️ 盲判包已生成：' + out.relPackDir);
    } else {
      const msg = String((out && out.stderr) || '需先跑通 check 生成干净运行证据').split('\n')[0];
      showToast('⚖️ 暂无法打包：' + msg);
    }
  } catch (err) { void err; showToast('盲判打包请求失败'); }
}

function exportActiveWorkflowJson(packId) {
  const pk = WORKFLOW_PACKS[packId || state.activePackId];
  if (!pk) return;
  const safeId = String(pk.id || 'workflow').replace(/[^a-zA-Z0-9._-]/g, '-');
  const payload = {
    schemaVersion: '1.0',
    id: safeId,
    name: pk.name || safeId,
    group: pk.group || '项目声明式开发流',
    tip: pk.tip || '',
    exportedAt: new Date().toISOString(),
    deps: Array.isArray(pk.deps) ? pk.deps : [],
    nodes: pk.nodes || [],
    links: pk.links || [],
    groups: pk.groups || []
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeId + '.workflow.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('⬇ 已导出开发流文件：' + safeId + '.workflow.json');
}

async function importWorkflowJsonText(rawText, sourceName) {
  let parsed = null;
  try { parsed = JSON.parse(rawText); } catch (err) { void err; showToast('导入失败：JSON 语法格式无效'); return; }
  if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    showToast('导入失败：不是有效的 .workflow.json（缺少 nodes 节点列表）');
    return;
  }
  const baseId = String(parsed.id || String(sourceName || 'imported').replace(/\.workflow\.json$|\.json$/i, '')).replace(/[^a-zA-Z0-9._-]/g, '-');
  const packId = baseId || ('pack-u-' + Date.now());
  const normalized = {
    schemaVersion: parsed.schemaVersion || '1.0',
    id: packId,
    name: parsed.name || packId,
    group: parsed.group || '项目声明式开发流',
    tip: parsed.tip || ('自 ' + (sourceName || '.workflow.json') + ' 导入的开发流'),
    deps: Array.isArray(parsed.deps) ? parsed.deps : [],
    nodes: parsed.nodes,
    links: Array.isArray(parsed.links) ? parsed.links : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : []
  };
  if (!WORKFLOW_GROUPS.includes(normalized.group)) WORKFLOW_GROUPS.push(normalized.group);
  WORKFLOW_PACKS[packId] = normalized;
  state.page = 'workshop';
  state.leftTab = 'workflows';
  state.activePackId = packId;
  state.wsSubgraphStack = [];
  state.selectedNodeIds = normalized.nodes[0] ? new Set([normalized.nodes[0].id]) : new Set();

  if (/^https?:$/i.test(location.protocol)) {
    try {
      await fetch('/donegate/api/workflow-pack/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: normalized })
      });
      await syncAllWorkflowDepsFromBackend(packId);
    } catch (err) { void err; }
  }
  renderAll();
  requestAnimationFrame(fitCanvas);
  showToast('⬆ 已导入开发流「' + normalized.name + '」（如缺外部依赖可点右侧「补齐」）');
}

function triggerWorkflowJsonFilePicker() {
  let inp = document.getElementById('wf-file-import-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.id = 'wf-file-import-input';
    inp.type = 'file';
    inp.accept = '.json,.workflow.json';
    inp.className = 'hidden';
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packs: WORKFLOW_PACKS })
    });
    const j = await r.json();
    if (r.ok && j && j.reports) {
      state.packDepReports = { ...(state.packDepReports || {}), ...j.reports };
      renderLeftDrawer();
      renderCanvas();
      if (focusPackId && j.reports[focusPackId]) {
        const rep = j.reports[focusPackId];
        showToast(rep.ready ? ('✓「' + rep.packName + '」全部 ' + rep.total + ' 项依赖已就位') : ('「' + rep.packName + '」尚缺 ' + rep.missingCount + ' 项依赖待补齐'));
      }
    }
  } catch (err) { void err; }
}

async function syncAutopilotMorningBrief() {
  if (!/^https?:$/i.test(location.protocol)) return;
  try {
    const r = await fetch('/donegate/api/autopilot/status');
    const j = await r.json();
    const ap = j && j.autopilot;
    if (!ap || ap.state === 'COMPLETED') return;
    if (typeof dshRuntime !== 'undefined') {
      dshRuntime.dockItems.unshift({
        id: 'ap-' + ap.runId,
        kind: ap.state === 'SUSPENDED_HUMAN_GATE' ? 'question' : 'blocked',
        tone: ap.state === 'SUSPENDED_HUMAN_GATE' ? 'warn' : 'bad',
        title: ap.morningSummaryLine || ('挂机单 ' + ap.runId + ' 状态：' + ap.state),
        targetNodeId: ap.cursorNodeId || null,
        approveRunId: ap.state === 'SUSPENDED_HUMAN_GATE' ? ap.runId : null,
        approveNodeId: ap.pendingHumanGate ? ap.pendingHumanGate.nodeId : null
      });
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
  } catch (err) { void err; }
}

async function triggerStartAutopilot() {
  if (!/^https?:$/i.test(location.protocol)) {
    showToast('连接本地实时服务或 DSH Web 后即可启动过夜断点续跑状态机');
    return;
  }
  if (state.page === 'sandbox') {
    const cont = getActiveSandboxContainer();
    const nodes = getActiveNodesList().filter((n) => !n.isBoundary && !n.isSubRepoRef && !n.bypassed);
    if (!nodes.length) { showToast('当前项目看板无可挂机组件节点'); return; }
    showToast('🌙 已启动全看板 ' + nodes.length + ' 个组件拓扑级过夜挂机（共享 Git Worktree 沙箱 + 组件级写边界锁）...');
    try {
      const r = await fetch('/donegate/api/autopilot/start-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, links: cont.links || [], componentWorkflows: state.componentWorkflows || {}, useWorktreeSandbox: true, useFingerprintCache: true })
      });
      const out = await r.json();
      if (out && out.suspended && out.pendingHumanGate) {
        state.chatMessages.push({
          role: 'agent',
          html: '⏸ 项目拓扑挂机在组件「<b>' + esc(out.suspendedComponentId || '') + '</b>」人工闸门「<b>' + esc(out.pendingHumanGate.title) + '</b>」安全挂起。<br><br><button type="button" class="ghost-btn is-primary text-[11px]" data-action="approve-autopilot-gate" data-campaign="' + esc(out.campaignId) + '" data-run="' + esc(out.suspendedSubRunId || '') + '" data-node="' + esc(out.pendingHumanGate.nodeId) + '">✓ 批准闸门并续跑剩余拓扑组件</button>'
        });
        renderAll();
        showToast('⏸ 项目挂机已停在人工闸门待拍板');
      } else if (out && !out.ok) {
        renderAll();
        showToast('🛑 组件挂机拦截（主工作区已隔离零污染）：' + (out.reason || out.code || '未通过'));
      } else {
        renderAll();
        showToast('🌅 全项目 ' + (out.completedCount || nodes.length) + ' 个组件拓扑挂机通关（缓存命中 ' + (out.cacheHits || 0) + ' 项）');
      }
    } catch (err) { void err; showToast('项目拓扑挂机请求异常'); }
    return;
  }
  const pk = WORKFLOW_PACKS[state.activePackId];
  if (!pk) return;
  showToast('🌙 已启动过夜挂机长跑（独立 Git Worktree 零污染沙箱 + 断点续跑）...');
  try {
    const r = await fetch('/donegate/api/autopilot/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: pk, useWorktreeSandbox: true, useFingerprintCache: true })
    });
    const out = await r.json();
    if (out && out.suspended && out.pendingHumanGate) {
      state.chatMessages.push({
        role: 'agent',
        html: '⏸ 过夜挂机已运行至人工闸门「<b>' + esc(out.pendingHumanGate.title) + '</b>」安全挂起（已存盘断点 <code>' + esc(out.runId) + '</code>）。<br><br><button type="button" class="ghost-btn is-primary text-[11px]" data-action="approve-autopilot-gate" data-run="' + esc(out.runId) + '" data-node="' + esc(out.pendingHumanGate.nodeId) + '">✓ 批准闸门并从断点续跑</button>'
      });
      await syncAutopilotMorningBrief();
      renderAll();
      showToast('⏸ 已停在人工闸门待你拍板');
    } else if (out && !out.ok) {
      renderAll();
      showToast('🛑 挂机拦截（主工作区已隔离保护）：' + (out.reason || out.code || '未通过'));
    } else {
      renderAll();
      showToast('🌅 挂机长跑全部完成（免跑缓存命中 ' + ((out && out.cacheHits) || 0) + ' 项）');
    }
  } catch (err) { void err; showToast('挂机服务请求异常'); }
}

async function approveAndResumeAutopilot(runId, nodeId, campaignId) {
  const pk = WORKFLOW_PACKS[state.activePackId];
  if (!/^https?:$/i.test(location.protocol)) return;
  try {
    const r = await fetch('/donegate/api/autopilot/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, nodeId, campaignId: campaignId || null, pack: campaignId ? null : pk, by: '业主' })
    });
    const out = await r.json();
    if (typeof dshRuntime !== 'undefined') {
      dshRuntime.dockItems = dshRuntime.dockItems.filter((x) => x.approveRunId !== runId);
      if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
    }
    state.chatMessages.push({
      role: 'agent',
      html: out && out.ok && !out.suspended
        ? '🌅 已批准人工闸门并从断点续跑收工（已完成全部下游门禁）！'
        : ('⚡ 已批准当前闸门，当前状态：' + esc((out && out.state) || '运行中'))
    });
    renderAll();
    showToast(out && out.ok && !out.suspended ? '🌅 断点续跑已全部通关！' : '✓ 闸门已放行并继续执行');
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: pk })
      });
      const rep = await r.json();
      if (r.ok && rep && rep.ok) {
        state.packDepReports = { ...(state.packDepReports || {}), [pk.id]: rep };
        if (rep.ready) { showToast('✅「' + pk.name + '」依赖已全部就位（' + rep.depsDir + '/）'); renderAll(); return; }
        if (typeof IS_DSH_EMBED !== 'undefined' && IS_DSH_EMBED && window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:insert-quote',
            text: rep.agentPrompt, summary: { label: '[补齐依赖] ' + pk.name, title: rep.depsDir, detail: '待装 ' + rep.missingCount + ' 项开源组件与环境', body: rep.agentPrompt }
          }, '*');
        }
        if (typeof dshRuntime !== 'undefined') {
          dshRuntime.dockItems.unshift({ id: 'dep-' + Date.now(), kind: 'receipt', title: '📦 已建好 ' + rep.depsDir + '/ 隔离清单，后台 Agent 正在拉取 ' + rep.missingCount + ' 项项目与环境依赖' });
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
  state.chatMessages.push({ role: 'agent', html: '📦 离线预览模式：连接 DSH 后点击「补齐」会自动把所需开源项目与环境安装到 <code>' + esc(fallbackDir) + '/</code>。' });
  renderAll();
  showToast('已生成 ' + fallbackDir + '/ 补齐指令');
}

function collectPersistedSnapshot() {
  const customPacks = {};
  Object.entries(WORKFLOW_PACKS).forEach(([id, pk]) => { if (id.startsWith('pack-u-')) customPacks[id] = pk; });
  const hostRepo = REPO_SANDBOXES[state.hostWorkspaceId];
  const hostNodeLayouts = {};
  if (hostRepo && Array.isArray(hostRepo.nodes)) {
    hostRepo.nodes.forEach((n) => {
      hostNodeLayouts[n.id] = { x: Math.round(n.x || 0), y: Math.round(n.y || 0), w: Math.round(n.w || 252), h: n.h ? Math.round(n.h) : null, color: n.color || 'none', bypassed: Boolean(n.bypassed), collapsed: Boolean(n.collapsed), expanded: Boolean(n.expanded) };
    });
  }
  return { customPacks, hostNodeLayouts, hostGroups: (hostRepo && Array.isArray(hostRepo.groups)) ? hostRepo.groups : [], starredRepos: [...state.starredRepos], textOverrides: state.customTextOverrides, textStyles: state.textStyleOverrides, controlStyles: state.controlStyleOverrides };
}

function persistWorkbenchStateSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const snap = collectPersistedSnapshot();
    try { localStorage.setItem('dg_v5_wb_state', JSON.stringify(snap)); } catch (err) { void err; }
    if (!liveServerConnected && !/^https?:$/i.test(location.protocol)) return;
    try {
      const r = await fetch('/api/workbench/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
      if (r.ok) liveServerConnected = true;
    } catch (err) { void err; }
  }, 420);
}

async function refreshBackendData() {
  const icon = document.getElementById('refresh-live-icon');
  if (icon) icon.classList.add('dg-spin');
  try {
    if (!/^https?:$/i.test(location.protocol)) { showToast('当前为离线快照；运行 node runner/donegate.mjs status --open 开启实时服务'); return; }
    const resp = await fetch('/api/atlas/refresh', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok || !data || !data.ok || !data.atlas) { showToast('刷新失败：' + ((data && data.reason) || resp.status)); return; }
    ATLAS = data.atlas;
    liveServerConnected = true;
    const syncBadge = document.getElementById('atlas-ov-sync');
    if (syncBadge) syncBadge.textContent = '实时同步已连接';
    hydrateWorkbenchFromAtlas(ATLAS, true);
    await syncAllWorkflowDepsFromBackend();
    renderAll();
    if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
    showToast('已重扫全仓最新代码、入口与门禁状态（共 ' + ((ATLAS.project && ATLAS.project.moduleCount) || 0) + ' 个模块）');
  } catch (err) { void err; showToast('本地同步服务未启动'); } finally { if (icon) icon.classList.remove('dg-spin'); }
}

async function openFolderViaBackend(dirPath) {
  if (!dirPath) return;
  if (/^https?:$/i.test(location.protocol)) {
    try {
      const resp = await fetch('/api/workbench/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [dirPath], openOs: true }) });
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

(function bootDoneGateWorkbench() {
  try { const savedTheme = localStorage.getItem('dg_v5_theme'); if (savedTheme === 'dark' || savedTheme === 'light') state.theme = savedTheme; } catch (err) { void err; }
  applyThemeClasses(state.theme);
  hydrateWorkbenchFromAtlas(ATLAS, false);
  setupAllEvents();
  renderAll();
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
  if (/^https?:$/i.test(location.protocol)) {
    fetch('/api/ping').then((r) => r.json()).then((j) => {
      if (j && j.ok) {
        liveServerConnected = true;
        const syncBadge = document.getElementById('atlas-ov-sync');
        if (syncBadge) syncBadge.textContent = '实时同步已连接';
        syncAllWorkflowDepsFromBackend();
        syncAutopilotMorningBrief();
        connectDoneGateLiveEvents();
      }
    }).catch((err) => { void err; });
  }
})();
`;
}
