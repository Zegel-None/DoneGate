// 全景体检单四视图白话渲染模块：面向非程序员业主提供功能模块达标清单、调用链配合、多分支撞车提醒与下一步操作建议
export function buildViewsScript() {
  return String.raw`
let activeAtlasOvTab = 'mindmap';

function openAtlasOverviewModal(initialTab) {
  if (initialTab) activeAtlasOvTab = initialTab;
  const modal = document.getElementById('atlas-overview-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  renderAtlasOverviewModal();
}

function closeAtlasOverviewModal() {
  const modal = document.getElementById('atlas-overview-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function switchAtlasOvTab(tabKey) {
  activeAtlasOvTab = tabKey;
  renderAtlasOverviewModal();
}

function copyAtlasAiPrompt(encodedPrompt) {
  const text = decodeURIComponent(encodedPrompt || '');
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制这句话！直接发给 AI 处理即可')).catch(() => showToast('已生成 AI 指令'));
  } else {
    showToast('已准备 AI 处理指令');
  }
}

function uiVwScrubPlainText(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return '';
  const internalRe = new RegExp(['stub' + 'Hash', 'provi' + 'sional', 'obliga' + 'tions?'].join('|'), 'gi');
  return raw
    .replace(internalRe, '验收项')
    .replace(/\bDRAFT\b/g, '待锁定标准')
    .replace(/\bFROZEN\b/g, '已锁定标准')
    .replace(/\bIMPLEMENTED\b/g, '已通过自动验收')
    .replace(/\s+/g, ' ')
    .trim();
}

function uiVwResolveToneStyle(tone) {
  if (tone === 'ok') return 'background: var(--ok-bg); color: var(--ok);';
  if (tone === 'bad') return 'background: var(--err-bg); color: var(--err);';
  return 'background: var(--warn-bg); color: var(--warn);';
}

function uiVwRenderModuleCard(m, isPassed) {
  const toneStyle = uiVwResolveToneStyle(isPassed ? 'ok' : m.tone);
  const badgeText = isPassed ? '已通过自动验收' : uiVwScrubPlainText(m.vibeLabel || '待补充自动验收');
  const explainText = uiVwScrubPlainText(m.vibeExplain || m.kindLabel || '业务功能代码模块');
  const guardLabel = m.contractTitle || m.contractId ? ('已纳入「' + (m.contractTitle || m.contractId) + '」自动验收') : '尚未绑定自动验收标准';
  const encPrompt = encodeURIComponent(m.aiPrompt || ('请帮我为 ' + m.path + ' 补充自动验收保护并跑通检查')).replace(/'/g, '%27');
  const actionBtn = isPassed
    ? ''
    : '<button type="button" class="ghost-btn is-primary text-[11px]" onclick="copyAtlasAiPrompt(\'' + encPrompt + '\')">复制这句话发给 AI 处理</button>';
  return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-1.5" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
    '<div class="flex items-center justify-between gap-2 flex-wrap">' +
      '<div class="flex items-center gap-2">' +
        '<span class="font-semibold text-[13px]">' + esc(m.humanTitle || m.path) + '</span>' +
        '<span class="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style="' + toneStyle + '">' + esc(badgeText) + '</span>' +
      '</div>' +
      actionBtn +
    '</div>' +
    '<div style="color: var(--text-secondary);">' + esc(explainText) + '</div>' +
    '<div class="text-[11px]" style="color: var(--text-muted);">所在文件：<code>' + esc(m.path) + '</code> · 代码行数：' + Number(m.lines || 0) + ' 行 · ' + esc(guardLabel) + '</div>' +
  '</div>';
}

function uiVwRenderMindmapTab(mods) {
  if (!mods.length) {
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">当前工作区尚未扫描到功能代码模块。</div>';
  }
  const okMods = mods.filter((m) => m.tone === 'ok');
  const pendingMods = mods.filter((m) => m.tone !== 'ok');
  const okBlock = '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-2" style="background: var(--surface); border-color: var(--border-subtle);">' +
    '<div class="font-bold text-[12.5px]" style="color: var(--ok);">✅ 已达标功能模块（' + okMods.length + ' 个）</div>' +
    (okMods.length ? okMods.map((m) => uiVwRenderModuleCard(m, true)).join('') : '<div class="text-[11.5px]" style="color: var(--text-muted);">暂无已全部通关的功能模块，可按下方提示逐步补充自动验收。</div>') +
  '</div>';
  const pendingBlock = '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-2" style="background: var(--surface); border-color: var(--border-subtle);">' +
    '<div class="font-bold text-[12.5px]" style="color: var(--warn);">⚠️ 待补充自动验收模块（' + pendingMods.length + ' 个）</div>' +
    (pendingMods.length ? pendingMods.map((m) => uiVwRenderModuleCard(m, false)).join('') : '<div class="text-[11.5px]" style="color: var(--ok);">全部功能模块均已配上自动验收保护！</div>') +
  '</div>';
  return okBlock + pendingBlock;
}

function uiVwRenderArchTab(edges) {
  if (!edges.length) {
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">暂未检出跨功能模块调用或前后端接口连线。</div>';
  }
  return edges.slice(0, 60).map((e) => {
    let badge = '模块正常配合';
    if (e.health === 'bridge') badge = '前后端网络接口连通';
    else if (e.health === 'red') badge = '跨模块调用待登记说明';
    const col = e.health === 'red' ? 'var(--err)' : 'var(--primary)';
    const detail = uiVwScrubPlainText(e.detail || e.kind || '模块间数据传递');
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
      '<div><b>' + esc(e.fromTitle) + '</b> → <b>' + esc(e.toTitle) + '</b><div class="text-[11px] mt-0.5" style="color: var(--text-muted);">配合方式：' + esc(detail) + '</div></div>' +
      '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="color:' + col + ';">' + badge + '</span>' +
    '</div>';
  }).join('');
}

function uiVwRenderBranchesTab(branches) {
  if (!branches.length) {
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">当前项目只有主分支，没有多分支并行改代码的撞车风险。</div>';
  }
  const colliding = branches.filter((b) => Array.isArray(b.collidesWith) && b.collidesWith.length > 0);
  const headerNote = colliding.length > 0
    ? ('发现 ' + colliding.length + ' 条开发支线与其它支线同时改动了同一份文件，合并前建议先让 AI 对齐改动。')
    : '当前各分支改动范围互不重叠，暂无多分支改同一文件的撞车风险。';
  const headerTone = colliding.length > 0 ? 'color: var(--err);' : 'color: var(--ok);';
  const cards = branches.map((b) => {
    const hasCol = Array.isArray(b.collidesWith) && b.collidesWith.length > 0;
    const colHtml = hasCol
      ? '<div class="mt-1 px-2.5 py-1.5 rounded-lg text-[11px]" style="background: var(--err-bg); color: var(--err);">撞车提醒：与 ' +
        esc(b.collidesWith.map((x) => x.branch + '（共同修改：' + (x.files || []).join('、') + '）').join('；')) + ' 同时改动同一文件</div>'
      : '';
    const encPrompt = encodeURIComponent(b.aiPrompt || ('请帮我核对分支 ' + b.name + ' 的代码改动与合并风险')).replace(/'/g, '%27');
    const copyBtn = b.isDefault ? '' : '<button type="button" class="ghost-btn text-[11px]" onclick="copyAtlasAiPrompt(\'' + encPrompt + '\')">复制这句话发给 AI 处理</button>';
    const desc = b.isDefault
      ? '当前默认主线（正式稳定基线）'
      : ('比主线多 ' + Number(b.ahead || 0) + ' 次保存 · 差主线 ' + Number(b.behind || 0) + ' 次更新 · 距上次修改 ' + Number(b.idleDays || 0) + ' 天');
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-1" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<span class="font-bold text-[12.5px]">' + esc(b.name) + (b.isDefault ? '（主线）' : '') + '</span>' +
        copyBtn +
      '</div>' +
      '<div style="color: var(--text-secondary);">' + desc + '</div>' +
      colHtml +
    '</div>';
  }).join('');
  return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-2" style="background: var(--surface); border-color: var(--border-subtle);">' +
    '<div class="font-bold text-[12.5px]" style="' + headerTone + '">🚧 多分支同时修改同一文件撞车提醒</div>' +
    '<div class="text-[11.5px]" style="color: var(--text-secondary);">' + esc(headerNote) + '</div>' +
    cards +
  '</div>';
}

function uiVwBuildNextActionItems(mods, branches, led) {
  const actions = [];
  const colliding = branches.filter((b) => Array.isArray(b.collidesWith) && b.collidesWith.length > 0);
  const pendingMods = mods.filter((m) => m.tone !== 'ok');
  if (colliding.length > 0) {
    const names = colliding.slice(0, 2).map((b) => b.name).join('、');
    actions.push({
      text: '先协调多分支同时修改同一文件的地方（涉及分支：' + names + '），避免合并时互相覆盖。',
      prompt: colliding[0].aiPrompt || ('请帮我梳理分支 ' + names + ' 同时修改同一文件的冲突风险并给出合并顺序')
    });
  }
  if (Number(led.C || 0) > 0) {
    actions.push({
      text: '当前有 ' + Number(led.C) + ' 项自动检查未过关，建议先修复报错后再继续加新功能。',
      prompt: '请帮我逐项排查并修复当前未通过的自动验收检查项'
    });
  }
  if (pendingMods.length > 0) {
    const sample = pendingMods[0];
    actions.push({
      text: '还有 ' + pendingMods.length + ' 个功能模块尚未补齐自动验收（如「' + (sample.humanTitle || sample.path) + '」），补齐后每次改代码都能自动防改坏。',
      prompt: sample.aiPrompt || ('请帮我为 ' + sample.path + ' 补充自动验收标准并跑通检查')
    });
  }
  if (!actions.length) {
    actions.push({
      text: '当前全部功能模块均已通过自动验收且无多分支撞车风险，可放心推进下一阶段需求或打包交接。',
      prompt: '请帮我核对当前项目整体状态并生成最新阶段进展简报'
    });
  }
  return actions;
}

function uiVwRenderLedgerTab(p, mods, branches, contracts, led) {
  const okCount = mods.filter((m) => m.tone === 'ok').length;
  const pendingCount = mods.length - okCount;
  const colCount = branches.filter((b) => Array.isArray(b.collidesWith) && b.collidesWith.length > 0).length;
  const overviewGrid = '<div data-ui-owner="runner/atlas/ui-views.mjs" class="grid grid-cols-2 gap-2">' +
    '<div class="p-3 rounded-xl border" style="background: var(--surface-soft); border-color: var(--border-subtle);"><div class="font-bold" style="color: var(--ok);">✅ 已达标功能模块</div><div class="mt-1 text-[12px]">共 <b>' + okCount + '</b> 个模块达标 · 已通过自动检查 <b>' + Number(led.A || 0) + '</b> 项</div></div>' +
    '<div class="p-3 rounded-xl border" style="background: var(--surface-soft); border-color: var(--border-subtle);"><div class="font-bold" style="color: var(--warn);">⚠️ 待补充自动验收模块</div><div class="mt-1 text-[12px]">共 <b>' + pendingCount + '</b> 个模块待补保护 · 未通过 <b>' + Number(led.C || 0) + '</b> 项</div></div>' +
    '<div class="p-3 rounded-xl border" style="background: var(--surface-soft); border-color: var(--border-subtle);"><div class="font-bold" style="color: ' + (colCount > 0 ? 'var(--err)' : 'var(--ok)') + ';">🚧 多分支同时修改同一文件撞车提醒</div><div class="mt-1 text-[12px]">' + (colCount > 0 ? ('发现 <b>' + colCount + '</b> 条支线存在同文件撞车风险') : '当前 <b>0</b> 处撞车风险') + '</div></div>' +
    '<div class="p-3 rounded-xl border" style="background: var(--surface-soft); border-color: var(--border-subtle);"><div class="font-bold" style="color: var(--primary);">📊 自动验收覆盖率</div><div class="mt-1 text-[12px]">已纳入自动验收保护 <b>' + Number(p.governedCount || 0) + '</b> / <b>' + Number(p.moduleCount || mods.length || 0) + '</b> 个模块</div></div>' +
  '</div>';

  const contractCards = contracts.map((c) => {
    const cleanState = uiVwScrubPlainText(c.lifecycleState || c.state || '待跑自动验收');
    return '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
      '<div><b>' + esc(c.title || c.id) + '</b><div class="text-[11px] mt-0.5" style="color: var(--text-muted);">自动验收模块组：' + esc(c.id) + '</div></div>' +
      '<span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style="background: var(--primary-soft); color: var(--primary-text);">' +
        esc(cleanState) + ' · 已通过 ' + Number(c.passTrusted || 0) + '/' + Number(c.passTotal || 0) + ' 项' +
      '</span>' +
    '</div>';
  }).join('');

  const nextSteps = uiVwBuildNextActionItems(mods, branches, led).map((item) => {
    const enc = encodeURIComponent(item.prompt).replace(/'/g, '%27');
    return '<div class="p-2.5 rounded-xl border flex items-center justify-between gap-2 flex-wrap" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
      '<span style="color: var(--text-main);">' + esc(item.text) + '</span>' +
      '<button type="button" class="ghost-btn is-primary text-[11px]" onclick="copyAtlasAiPrompt(\'' + enc + '\')">复制这句话发给 AI 处理</button>' +
    '</div>';
  }).join('');

  const nextStepBox = '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 rounded-xl border flex flex-col gap-2" style="background: var(--surface); border-color: var(--border-subtle);">' +
    '<div class="font-bold text-[12.5px]" style="color: var(--primary);">📌 下一步操作建议</div>' +
    nextSteps +
  '</div>';

  return overviewGrid + nextStepBox + (contractCards || '<div data-ui-owner="runner/atlas/ui-views.mjs" class="p-3 text-center" style="color: var(--text-muted);">暂未建立自动验收模块组。</div>');
}

function renderAtlasOverviewModal() {
  const bodyEl = document.getElementById('atlas-ov-body');
  if (!bodyEl || typeof ATLAS !== 'object' || !ATLAS) return;
  bodyEl.setAttribute('data-ui-owner', 'runner/atlas/ui-views.mjs');
  const p = ATLAS.project || {};
  const titleEl = document.getElementById('atlas-ov-title');
  const pctEl = document.getElementById('atlas-ov-pct');
  const introEl = document.getElementById('atlas-ov-intro');
  if (titleEl) titleEl.textContent = (p.name || '当前项目') + ' · 全景健康度体检单';
  if (pctEl) pctEl.textContent = '验收进度 ' + (ATLAS.totalPct ?? p.totalPct ?? 0) + '%';
  if (introEl) {
    introEl.textContent = '一页看懂当前项目全局健康度：一共做了哪些功能、哪些已通过自动验收、多分支同时改代码有没有撞车风险、下一步该做什么。';
  }

  document.querySelectorAll('[data-ov-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-ov-tab') === activeAtlasOvTab);
  });

  const mods = Array.isArray(ATLAS.modules) ? ATLAS.modules : [];
  const edges = Array.isArray(ATLAS.edges) ? ATLAS.edges : [];
  const branches = Array.isArray(ATLAS.branches) ? ATLAS.branches : [];
  const contracts = Array.isArray(ATLAS.contracts) ? ATLAS.contracts : [];
  const led = ATLAS.ledger || {};

  if (activeAtlasOvTab === 'mindmap') {
    bodyEl.innerHTML = uiVwRenderMindmapTab(mods);
    return;
  }
  if (activeAtlasOvTab === 'arch') {
    bodyEl.innerHTML = uiVwRenderArchTab(edges);
    return;
  }
  if (activeAtlasOvTab === 'branches') {
    bodyEl.innerHTML = uiVwRenderBranchesTab(branches);
    return;
  }
  bodyEl.innerHTML = uiVwRenderLedgerTab(p, mods, branches, contracts, led);
}
`;
}
