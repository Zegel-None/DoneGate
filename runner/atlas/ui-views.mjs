// 全景体检单四视图渲染模块：在项目看板内提供大白话功能清单、跨栈调用链、支线撞车提醒与验收体检单（<= 250 行）
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

function renderAtlasOverviewModal() {
  const bodyEl = document.getElementById('atlas-ov-body');
  if (!bodyEl || typeof ATLAS !== 'object' || !ATLAS) return;
  const p = ATLAS.project || {};
  const titleEl = document.getElementById('atlas-ov-title');
  const pctEl = document.getElementById('atlas-ov-pct');
  if (titleEl) titleEl.textContent = (p.name || '当前项目') + ' · 全景功能与支线体检单';
  if (pctEl) pctEl.textContent = '验收进度 ' + (ATLAS.totalPct ?? p.totalPct ?? 0) + '%';

  document.querySelectorAll('[data-ov-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-ov-tab') === activeAtlasOvTab);
  });

  const mods = Array.isArray(ATLAS.modules) ? ATLAS.modules : [];
  const edges = Array.isArray(ATLAS.edges) ? ATLAS.edges : [];
  const branches = Array.isArray(ATLAS.branches) ? ATLAS.branches : [];
  const contracts = Array.isArray(ATLAS.contracts) ? ATLAS.contracts : [];

  if (activeAtlasOvTab === 'mindmap') {
    if (!mods.length) {
      bodyEl.innerHTML = '<div class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">当前目录尚未扫描到源码模块。</div>';
      return;
    }
    bodyEl.innerHTML = mods.map((m) => {
      const toneStyle = m.tone === 'ok'
        ? 'background: var(--ok-bg); color: var(--ok);'
        : (m.tone === 'bad' ? 'background: var(--err-bg); color: var(--err);' : 'background: var(--warn-bg); color: var(--warn);');
      const encPrompt = encodeURIComponent(m.aiPrompt || ('请帮我为 ' + m.path + ' 补充契约验收保护'));
      return '<div class="p-3 rounded-xl border flex flex-col gap-1.5" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
        '<div class="flex items-center justify-between gap-2 flex-wrap">' +
          '<div class="flex items-center gap-2">' +
            '<span class="font-semibold text-[13px]">' + esc(m.humanTitle || m.path) + '</span>' +
            '<span class="px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style="' + toneStyle + '">' + esc(m.vibeLabel || '待核验') + '</span>' +
          '</div>' +
          '<button type="button" class="ghost-btn is-primary text-[11px]" onclick="copyAtlasAiPrompt(\'' + encPrompt + '\')">复制这句话发给 AI 处理</button>' +
        '</div>' +
        '<div style="color: var(--text-secondary);">' + esc(m.vibeExplain || m.kindLabel || '') + '</div>' +
        '<details class="tech-fold"><summary>展开开发者技术细节</summary>' +
          '<div class="font-mono text-[11px] mt-1.5 leading-relaxed" style="color: var(--text-secondary);">' +
            '路径：' + esc(m.path) + ' · 行数：' + Number(m.lines || 0) + ' · 契约：' + esc(m.contractId || '未认领') + '<br/>' +
            esc(m.techSummary || '') +
          '</div>' +
        '</details>' +
      '</div>';
    }).join('');
    return;
  }

  if (activeAtlasOvTab === 'arch') {
    if (!edges.length) {
      bodyEl.innerHTML = '<div class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">暂未检出跨模块调用或跨语言 HTTP 桥接连线。</div>';
      return;
    }
    bodyEl.innerHTML = edges.slice(0, 60).map((e) => {
      const badge = e.health === 'bridge' ? '跨语言 HTTP 桥接' : (e.health === 'red' ? '越界未声明依赖' : '正常调用');
      const col = e.health === 'red' ? 'var(--err)' : 'var(--primary)';
      return '<div class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
        '<div><b>' + esc(e.fromTitle) + '</b> → <b>' + esc(e.toTitle) + '</b><div class="font-mono text-[11px] mt-0.5" style="color: var(--text-muted);">' + esc(e.detail || e.kind) + '</div></div>' +
        '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="color:' + col + ';">' + badge + '</span>' +
      '</div>';
    }).join('');
    return;
  }

  if (activeAtlasOvTab === 'branches') {
    if (!branches.length) {
      bodyEl.innerHTML = '<div class="p-4 rounded-xl text-center" style="background: var(--surface-soft); color: var(--text-muted);">当前工作区暂无多支线记录。</div>';
      return;
    }
    bodyEl.innerHTML = branches.map((b) => {
      const colWarn = Array.isArray(b.collidesWith) && b.collidesWith.length > 0
        ? '<div class="mt-1 px-2.5 py-1.5 rounded-lg text-[11px]" style="background: var(--err-bg); color: var(--err);">撞车预警：与 ' +
          esc(b.collidesWith.map((x) => x.branch + ' (' + (x.files || []).join(', ') + ')').join('；')) + ' 同时改动同一文件</div>'
        : '';
      const encPrompt = encodeURIComponent(b.aiPrompt || ('请检查分支 ' + b.name + ' 的合并冲突与验收状态'));
      return '<div class="p-3 rounded-xl border flex flex-col gap-1" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<span class="font-mono font-bold text-[12.5px]">' + esc(b.name) + (b.isDefault ? '（主线）' : '') + '</span>' +
          (!b.isDefault ? '<button type="button" class="ghost-btn text-[11px]" onclick="copyAtlasAiPrompt(\'' + encPrompt + '\')">复制这句话发给 AI 处理</button>' : '') +
        '</div>' +
        '<div style="color: var(--text-secondary);">' + (b.isDefault ? '默认主分支基线' : ('领先 +' + b.ahead + ' / 落后 -' + b.behind + ' · 距上次提交 ' + b.idleDays + ' 天')) + '</div>' +
        colWarn +
      '</div>';
    }).join('');
    return;
  }

  const led = ATLAS.ledger || {};
  const summaryTop = '<div class="p-3 rounded-xl border flex items-center justify-between flex-wrap gap-2" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
    '<span>总判据 <b>' + Number(led.N || 0) + '</b> 项：通过 <b>' + Number(led.A || 0) + '</b> · 未通过 <b>' + Number(led.C || 0) + '</b> · 未验证 <b>' + Number(led.D || 0) + '</b></span>' +
    '<span class="font-mono text-[11px]" style="color: var(--text-muted);">受契约保护模块 ' + Number(p.governedCount || 0) + '/' + Number(p.moduleCount || 0) + '</span>' +
  '</div>';
  const contractCards = contracts.map((c) => (
    '<div class="p-2.5 rounded-xl border flex items-center justify-between gap-2" style="background: var(--surface-soft); border-color: var(--border-subtle);">' +
      '<div><b>' + esc(c.title || c.id) + '</b> <span class="font-mono text-[11px]" style="color: var(--text-muted);">(' + esc(c.id) + ')</span></div>' +
      '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" style="background: var(--primary-soft); color: var(--primary-text);">' +
        esc(c.state || '未验证') + ' · ' + Number(c.passTrusted || 0) + '/' + Number(c.passTotal || 0) +
      '</span>' +
    '</div>'
  )).join('');
  bodyEl.innerHTML = summaryTop + (contractCards || '<div class="p-3 text-center" style="color: var(--text-muted);">暂未建立契约验收项。</div>');
}
`;
}
