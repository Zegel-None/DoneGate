// UI 看板多套结构化骨架原型渲染器（纯叶节点模块：服务端原型与离线 srcdoc 共用同一套真实异构 DOM 与排版阶梯）

export const ARCHETYPE_CSS = [
  '.arch-root { min-height: 100vh; width: 100%; color: var(--ui-text); background: var(--ui-bg); font-family: var(--ui-font-sans); }',
  '.arch-root a, .arch-root button, .arch-root input { font-family: inherit; }',
  '.ui-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border-radius: var(--ui-radius); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--ui-border); transition: transform 0.12s ease, opacity 0.14s ease; }',
  '.ui-btn:hover { opacity: 0.92; }',
  '.ui-btn-primary { background: var(--ui-primary); color: var(--ui-primary-fg); border-color: var(--ui-primary); }',
  '.ui-btn-ghost { background: var(--ui-surface-muted); color: var(--ui-text); }',
  '.ui-input { width: 100%; padding: 8px 12px; border-radius: var(--ui-radius); border: 1px solid var(--ui-border); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 13px; outline: none; }',
  '.ui-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--ui-surface-muted); color: var(--ui-primary); }',
  '.ui-extra-stack { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }',
  '/* 1. 方案 A / F：瑞士非对称编辑部双栏留白流 (3 细线开放区，衬线大标题，零卡片阴影) */',
  '.arch-editorial { padding: 28px 44px 56px; max-width: 1080px; margin: 0 auto; }',
  '.ed-masthead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1.5px solid var(--ui-text); margin-bottom: 38px; flex-wrap: wrap; }',
  '.ed-serial { font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ui-muted); }',
  '.ed-nav-links { display: flex; align-items: center; gap: 22px; font-size: 13px; color: var(--ui-muted); }',
  '.ed-nav-links span { border-bottom: 1px solid transparent; padding-bottom: 2px; }',
  '.ed-nav-links span.is-cur { color: var(--ui-text); border-color: var(--ui-text); font-weight: 600; }',
  '.ed-spread { display: grid; grid-template-columns: minmax(260px, 5fr) minmax(320px, 7fr); gap: 48px; align-items: start; }',
  '@media (max-width: 760px) { .ed-spread { grid-template-columns: 1fr; gap: 28px; } .arch-editorial { padding: 20px; } }',
  '.ed-h1 { font-family: var(--ui-font-display, Georgia, "Noto Serif SC", serif); font-size: 38px; font-weight: 500; line-height: 1.14; letter-spacing: -0.03em; margin: 10px 0 16px; }',
  '.ed-lead { font-size: 14.5px; line-height: 1.78; color: var(--ui-muted); margin: 0 0 28px; }',
  '.ed-metrics { border-top: 1px solid var(--ui-border); }',
  '.ed-metric-row { display: flex; align-items: baseline; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--ui-border); }',
  '.ed-metric-num { font-family: var(--ui-font-display, Georgia, serif); font-size: 32px; font-weight: 500; color: var(--ui-primary); font-variant-numeric: tabular-nums; }',
  '.ed-zone { border-top: 1.5px solid var(--ui-text); padding-top: 18px; margin-bottom: 34px; background: transparent; }',
  '.ed-idx { font-family: var(--ui-font-mono, monospace); font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ui-muted); margin-bottom: 6px; }',
  '.ed-line-input { width: 100%; border: 0; border-bottom: 1px solid var(--ui-border); background: transparent; padding: 10px 2px; font-size: 14px; color: var(--ui-text); outline: none; margin-bottom: 12px; }',
  '.ed-ledger-row { display: grid; grid-template-columns: 76px 1fr auto; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--ui-border); font-size: 13.5px; align-items: center; }',
  '/* 2. 方案 B：浮岛胶囊导航 + 12 栅格 6 卡错落便当盒 (Tactile Bento Mosaic) */',
  '.arch-bento { padding: 20px 26px 40px; max-width: 1120px; margin: 0 auto; }',
  '.bt-pill-island { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 780px; margin: 0 auto 24px; padding: 8px 10px 8px 18px; border-radius: 999px; background: var(--ui-surface); border: 1px solid var(--ui-border); box-shadow: var(--ui-shadow); flex-wrap: wrap; }',
  '.bt-tabs { display: inline-flex; gap: 4px; background: var(--ui-surface-muted); padding: 3px; border-radius: 999px; font-size: 12px; }',
  '.bt-tabs span { padding: 4px 12px; border-radius: 999px; color: var(--ui-muted); }',
  '.bt-tabs span.is-cur { background: var(--ui-surface); color: var(--ui-text); font-weight: 600; }',
  '.bt-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }',
  '.bt-card { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 22px; box-shadow: var(--ui-shadow); padding: 20px 22px; display: flex; flex-direction: column; justify-content: space-between; }',
  '.bt-card.is-spotlight { background: var(--ui-primary); color: var(--ui-primary-fg); border-color: var(--ui-primary); }',
  '.bt-span-7 { grid-column: span 7; } .bt-span-5 { grid-column: span 5; } .bt-span-4 { grid-column: span 4; } .bt-span-12 { grid-column: span 12; }',
  '@media (max-width: 820px) { .bt-span-7, .bt-span-5, .bt-span-4 { grid-column: span 12; } }',
  '.bt-h1 { font-size: 27px; font-weight: 700; line-height: 1.24; letter-spacing: -0.02em; margin: 8px 0; }',
  '.bt-big-num { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; margin: 10px 0 6px; }',
  '.bt-feed { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }',
  '.bt-feed-item { padding: 12px 14px; border-radius: 14px; background: var(--ui-surface-muted); display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }',
  '/* 3. 方案 C / H / I：左侧垂直图标轨 + 顶栏遥测条 + 8 面板紧凑分栏驾驶舱 (Industrial Cockpit) */',
  '.arch-cockpit { display: grid; grid-template-columns: 54px minmax(0, 1fr); min-height: 100vh; }',
  '.ck-icon-rail { background: var(--ui-surface); border-right: 1px solid var(--ui-border); display: flex; flex-direction: column; align-items: center; padding: 12px 0; gap: 14px; }',
  '.ck-rail-dot { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--ui-border); color: var(--ui-muted); font-family: var(--ui-font-mono, monospace); font-size: 11px; }',
  '.ck-rail-dot.is-cur { border-color: var(--ui-primary); color: var(--ui-primary); background: var(--ui-surface-muted); }',
  '.ck-main { display: flex; flex-direction: column; min-width: 0; }',
  '.ck-telemetry-bar { height: 42px; padding: 0 16px; border-bottom: 1px solid var(--ui-border); background: var(--ui-surface); display: flex; align-items: center; justify-content: space-between; gap: 12px; font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 11.5px; }',
  '.ck-workspace { padding: 12px; display: flex; flex-direction: column; gap: 10px; }',
  '.ck-stat-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }',
  '.ck-split-body { display: grid; grid-template-columns: 7fr 5fr; gap: 10px; align-items: stretch; }',
  '@media (max-width: 820px) { .ck-stat-strip { grid-template-columns: repeat(2, 1fr); } .ck-split-body { grid-template-columns: 1fr; } }',
  '.ck-panel { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); padding: 12px 14px; font-size: 12px; }',
  '.ck-mono-num { font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 22px; font-weight: 700; color: var(--ui-primary); font-variant-numeric: tabular-nums; }',
  '.ck-table { width: 100%; border-collapse: collapse; font-family: var(--ui-font-mono, ui-monospace, monospace); font-size: 11.5px; margin-top: 8px; }',
  '.ck-table th, .ck-table td { text-align: left; padding: 7px 6px; border-top: 1px solid var(--ui-border); }',
  '/* 4. 方案 D：粗黑实线横幅 + 5 卡硬阴影错位海报工坊 (Neo-Brutalist Poster) */',
  '.arch-brutal { padding: 22px 26px 44px; max-width: 1040px; margin: 0 auto; }',
  '.nb-topbar { border: 3px solid var(--ui-border); background: var(--ui-surface-muted); box-shadow: 5px 5px 0 var(--ui-border); padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 10px; }',
  '.nb-collage { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 18px; }',
  '.nb-box { border: 2.5px solid var(--ui-border); background: var(--ui-surface); box-shadow: 4px 4px 0 var(--ui-border); padding: 18px; }',
  '.nb-s4 { grid-column: span 4; } .nb-s2 { grid-column: span 2; } .nb-s3 { grid-column: span 3; }',
  '@media (max-width: 760px) { .nb-s4, .nb-s2, .nb-s3 { grid-column: span 6; } }',
  '.nb-h1 { font-size: 33px; font-weight: 800; line-height: 1.08; text-transform: uppercase; margin: 6px 0 10px; }',
  '/* 5. 方案 E / J / K：双层政企面包屑顶栏 + 左侧分类树 + 7 区主从合规台账台 */',
  '.arch-ledger { display: flex; flex-direction: column; min-height: 100vh; }',
  '.ep-govbar { background: var(--ui-primary); color: var(--ui-primary-fg); padding: 8px 20px; display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 600; }',
  '.ep-subbar { background: var(--ui-surface); border-bottom: 1px solid var(--ui-border); padding: 8px 20px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--ui-muted); }',
  '.ep-body { display: grid; grid-template-columns: 176px minmax(0, 1fr); flex: 1; }',
  '.ep-sidebar { background: var(--ui-surface); border-right: 1px solid var(--ui-border); padding: 14px 10px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }',
  '.ep-tree-item { padding: 6px 10px; border-radius: 4px; color: var(--ui-muted); }',
  '.ep-tree-item.is-cur { background: var(--ui-surface-muted); color: var(--ui-primary); font-weight: 600; }',
  '.ep-main { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }',
  '.ep-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }',
  '.ep-panel { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); padding: 12px 14px; font-size: 12.5px; }',
  '@media (max-width: 780px) { .ep-body { grid-template-columns: 1fr; } .ep-kpis { grid-template-columns: repeat(2, 1fr); } }',
  '/* 6. 方案 G / L：居中双线刊头 + 5 卡时间轴专题瀑布流 (Chronicle Cascade) */',
  '.arch-chronicle { padding: 30px 32px 54px; max-width: 900px; margin: 0 auto; }',
  '.ch-header { text-align: center; border-top: 3px double var(--ui-text); border-bottom: 1px solid var(--ui-border); padding: 18px 0; margin-bottom: 28px; }',
  '.ch-h1 { font-family: var(--ui-font-display, "Playfair Display", "Songti SC", Georgia, serif); font-size: 34px; font-weight: 600; margin: 8px 0; }',
  '.ch-spine { list-style: none; margin: 0; padding: 0 0 0 22px; border-left: 2px solid var(--ui-border); display: flex; flex-direction: column; gap: 18px; }',
  '.ch-entry { position: relative; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); box-shadow: var(--ui-shadow); padding: 18px 20px; }',
  '.ch-entry::before { content: ""; position: absolute; left: -29px; top: 22px; width: 10px; height: 10px; border-radius: 999px; background: var(--ui-primary); border: 2px solid var(--ui-bg); }'
].join('\n');

const UI_ARCHETYPE_BY_PROPOSAL = {
  'bento-craft': 'tactile-bento',
  'industrial-dark': 'cockpit-split',
  'obsidian-terminal': 'cockpit-split',
  'graphite-ops': 'cockpit-split',
  'neo-brutal': 'brutal-poster',
  'enterprise-dense': 'ledger-workbench',
  'fin-ledger': 'ledger-workbench',
  'ehs-command': 'ledger-workbench',
  'warm-paper': 'chronicle-cascade',
  'editorial-serif': 'chronicle-cascade'
};

function uiArchLookupProposal(proposalId) {
  const id = String(proposalId || 'swiss-minimal');
  return Object.prototype.hasOwnProperty.call(UI_ARCHETYPE_BY_PROPOSAL, id)
    ? UI_ARCHETYPE_BY_PROPOSAL[id]
    : 'editorial-asymmetric';
}

export function resolveProposalArchetype(proposalId) {
  return uiArchLookupProposal(proposalId);
}

export function renderProposalArchetypeBody(proposalId, rawModel) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const jsAttr = (s) => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
  const uiArchOr = (v, fb) => (v ? v : fb);
  const m = uiArchOr(rawModel, {});
  const hero = uiArchOr(m.hero, { id: 'blk-hero', brand: '业务工作台', headline: '智能协作与全流程数据中枢', subline: '直接点击体验原生交互，按住 Alt+单击拾取任意元素源码', ctaLabel: '新建业务单据', ctaActionId: 'act-create-order', ctaWiring: 'mock' });
  const kpi = uiArchOr(m.kpi, { id: 'blk-kpi', item1Title: '今日待处理', item1Val: '18', item2Title: '本周已完成', item2Val: '142', item3Title: '合规达标率', item3Val: '99.2%' });
  const form = uiArchOr(m.form, { id: 'blk-form', title: '快速录入与审批发起', field1: '事项标题', field2: '负责人 / 部门', submitLabel: '提交并触发流转', submitActionId: 'act-submit-form', submitWiring: 'mock' });
  const table = uiArchOr(m.table, { id: 'blk-table', title: '实时业务流水列表', exportLabel: '导出筛选报表', exportActionId: 'act-export-report', exportWiring: 'mock' });
  const extras = Array.isArray(m.extraBlocks) ? m.extraBlocks : [];
  const srcFile = uiArchOr(m.sourceFile, '.donegate/ui-prototype/index.html');
  const pid = String(uiArchOr(proposalId, 'swiss-minimal'));
  const archMap = {
    'bento-craft': 'tactile-bento',
    'industrial-dark': 'cockpit-split',
    'obsidian-terminal': 'cockpit-split',
    'graphite-ops': 'cockpit-split',
    'neo-brutal': 'brutal-poster',
    'enterprise-dense': 'ledger-workbench',
    'fin-ledger': 'ledger-workbench',
    'ehs-command': 'ledger-workbench',
    'warm-paper': 'chronicle-cascade',
    'editorial-serif': 'chronicle-cascade'
  };
  const arch = Object.prototype.hasOwnProperty.call(archMap, pid) ? archMap[pid] : 'editorial-asymmetric';

  const uiArchRenderExtra = (b, i) => {
    const bp = uiArchOr(b.props, {});
    const ln = 120 + i * 16;
    if (b.type === 'confirm_modal_trigger') {
      const actId = esc(uiArchOr(bp.actionId, 'act-publish-sync'));
      const wiring = esc(uiArchOr(b.wiring, 'mock'));
      const modalTitleJs = jsAttr(uiArchOr(bp.btnLabel, '确认发布'));
      const actIdJs = jsAttr(uiArchOr(bp.actionId, 'act-publish-sync'));
      const btnText = esc(uiArchOr(bp.btnLabel, '发布并同步下游系统'));
      const secTitle = esc(uiArchOr(bp.title, '关键变更确认'));
      return '<section data-dg-block="' + esc(b.id) + '" data-dg-source="' + srcFile + ':' + ln + ':1" class="ui-surface-card ck-panel bt-card ep-panel"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><strong>' + secTitle + '</strong><div style="font-size:12px;color:var(--ui-muted);">点击按钮打开二次确认弹窗</div></div><button type="button" class="ui-btn ui-btn-primary" data-dg-action="' + actId + '" data-dg-wiring="' + wiring + '" onclick="window.__openConfirmModal && window.__openConfirmModal(\'' + actIdJs + '\', \'' + modalTitleJs + '\')" data-dg-source="' + srcFile + ':' + (ln + 3) + ':5">' + btnText + '</button></div></section>';
    }
    const heading = uiArchOr(uiArchOr(bp.title, bp.headline), b.type);
    return '<section data-dg-block="' + esc(b.id) + '" data-dg-source="' + srcFile + ':' + ln + ':1" class="ui-surface-card ck-panel bt-card ep-panel"><strong>' + esc(heading) + '</strong></section>';
  };
  const extraHtml = extras.length ? ('<div class="ui-extra-stack">' + extras.map(uiArchRenderExtra).join('') + '</div>') : '';

  const uiArchDispatch = {
    'editorial-asymmetric': () => '<div class="arch-root arch-editorial" data-ui-archetype="editorial-asymmetric">'
      + '<header class="ed-masthead" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1">'
      + '<div><div class="ed-serial">EDITION 04 / SWISS EDITORIAL</div><strong style="font-size:16px;" data-dg-source="' + srcFile + ':26:5">' + esc(hero.brand) + '</strong></div>'
      + '<nav class="ed-nav-links" aria-label="章节导航"><span class="is-cur">01 概览</span><span>02 录入单据</span><span>03 归档索引</span></nav>'
      + '<button type="button" class="ui-btn ui-btn-primary" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '" data-dg-source="' + srcFile + ':29:5">' + esc(hero.ctaLabel) + '</button>'
      + '</header>'
      + '<div class="ed-spread">'
      + '<aside class="ui-surface-card ed-zone" data-dg-block="' + esc(kpi.id) + '" data-dg-source="' + srcFile + ':38:1"><div class="ed-idx">01 / MANIFESTO &amp; KEY FIGURES</div><h1 class="ed-h1" data-dg-source="' + srcFile + ':40:3">' + esc(hero.headline) + '</h1><p class="ed-lead" data-dg-source="' + srcFile + ':42:3">' + esc(hero.subline) + '</p>'
      + '<div class="ed-metrics"><div class="ed-metric-row"><span>' + esc(kpi.item1Title) + '</span><span class="ed-metric-num">' + esc(kpi.item1Val) + '</span></div><div class="ed-metric-row"><span>' + esc(kpi.item2Title) + '</span><span class="ed-metric-num">' + esc(kpi.item2Val) + '</span></div><div class="ed-metric-row"><span>' + esc(kpi.item3Title) + '</span><span class="ed-metric-num">' + esc(kpi.item3Val) + '</span></div></div></aside>'
      + '<div><section class="ui-surface-card ed-zone" data-dg-block="' + esc(form.id) + '" data-dg-source="' + srcFile + ':58:1"><div class="ed-idx">02 / DISPATCH ENTRY</div><h2 style="margin:0 0 14px;font-size:18px;font-weight:500;">' + esc(form.title) + '</h2><form onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><input class="ed-line-input" type="text" placeholder="' + esc(form.field1) + '" required data-dg-source="' + srcFile + ':62:5"><input class="ed-line-input" type="text" placeholder="' + esc(form.field2) + '" data-dg-source="' + srcFile + ':64:5"><button type="submit" class="ui-btn ui-btn-primary" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '" data-dg-source="' + srcFile + ':66:5">' + esc(form.submitLabel) + '</button></form></section>'
      + '<section class="ui-surface-card ed-zone" data-dg-block="' + esc(table.id) + '" data-dg-source="' + srcFile + ':76:1"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;"><div><div class="ed-idx">03 / CHRONOLOGICAL LEDGER</div><h2 style="margin:0;font-size:18px;font-weight:500;">' + esc(table.title) + '</h2></div><button type="button" class="ui-btn ui-btn-ghost" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '" data-dg-source="' + srcFile + ':80:5">' + esc(table.exportLabel) + '</button></div><div class="ed-ledger-row"><span>#1024</span><span>核心网关限流策略升级</span><span class="ui-pill">进行中</span></div><div class="ed-ledger-row"><span>#1025</span><span>季度安全合规巡检复核</span><span class="ui-pill">已就绪</span></div></section>' + extraHtml + '</div></div></div>',

    'tactile-bento': () => '<div class="arch-root arch-bento" data-ui-archetype="tactile-bento">'
      + '<nav class="bt-pill-island" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1"><strong style="font-size:15px;" data-dg-source="' + srcFile + ':26:5">' + esc(hero.brand) + '</strong><div class="bt-tabs"><span class="is-cur">便当盒总览</span><span>协作看板</span><span>数据报表</span></div><button type="button" class="ui-btn ui-btn-primary" style="border-radius:999px;" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '" data-dg-source="' + srcFile + ':29:5">' + esc(hero.ctaLabel) + '</button></nav>'
      + '<main class="bt-grid">'
      + '<section class="ui-surface-card bt-card bt-span-7"><span class="ui-pill">Tactile Bento · 模块工作区</span><h1 class="bt-h1" data-dg-source="' + srcFile + ':36:3">' + esc(hero.headline) + '</h1><p style="margin:0;font-size:13.5px;color:var(--ui-muted);line-height:1.6;">' + esc(hero.subline) + '</p></section>'
      + '<section class="ui-surface-card bt-card is-spotlight bt-span-5" data-dg-block="' + esc(kpi.id) + '" data-dg-source="' + srcFile + ':44:1"><div style="font-size:12.5px;opacity:0.88;">' + esc(kpi.item1Title) + '</div><div class="bt-big-num">' + esc(kpi.item1Val) + '</div><div style="font-size:12px;opacity:0.85;">优先队列实时同步中</div></section>'
      + '<section class="ui-surface-card bt-card bt-span-4"><div style="font-size:12.5px;color:var(--ui-muted);">' + esc(kpi.item2Title) + '</div><div class="bt-big-num" style="font-size:34px;color:var(--ui-primary);">' + esc(kpi.item2Val) + '</div><span class="ui-pill">较上周 +18%</span></section>'
      + '<section class="ui-surface-card bt-card bt-span-4"><div style="font-size:12.5px;color:var(--ui-muted);">' + esc(kpi.item3Title) + '</div><div class="bt-big-num" style="font-size:34px;color:var(--ui-accent);">' + esc(kpi.item3Val) + '</div><span class="ui-pill">全链路受控</span></section>'
      + '<section class="ui-surface-card bt-card bt-span-4" data-dg-block="' + esc(form.id) + '" data-dg-source="' + srcFile + ':62:1"><strong style="font-size:14.5px;margin-bottom:8px;">' + esc(form.title) + '</strong><form style="display:flex;flex-direction:column;gap:8px;" onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><input class="ui-input" style="border-radius:999px;" type="text" placeholder="' + esc(form.field1) + '" required data-dg-source="' + srcFile + ':65:5"><input class="ui-input" style="border-radius:999px;" type="text" placeholder="' + esc(form.field2) + '" data-dg-source="' + srcFile + ':66:5"><button type="submit" class="ui-btn ui-btn-primary" style="border-radius:999px;" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '" data-dg-source="' + srcFile + ':68:5">' + esc(form.submitLabel) + '</button></form></section>'
      + '<section class="ui-surface-card bt-card bt-span-12" data-dg-block="' + esc(table.id) + '" data-dg-source="' + srcFile + ':78:1"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><strong style="font-size:15px;">' + esc(table.title) + '</strong><button type="button" class="ui-btn ui-btn-ghost" style="border-radius:999px;" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '" data-dg-source="' + srcFile + ':81:5">' + esc(table.exportLabel) + '</button></div><div class="bt-feed"><div class="bt-feed-item"><span>#1024 核心网关限流策略升级</span><span class="ui-pill">进行中</span></div><div class="bt-feed-item"><span>#1025 季度安全合规巡检复核</span><span class="ui-pill">已就绪</span></div><div class="bt-feed-item"><span>#1026 多端库存锁并发对账</span><span class="ui-pill">待排期</span></div></div></section>'
      + '</main>' + extraHtml + '</div>',

    'cockpit-split': () => '<div class="arch-root arch-cockpit" data-ui-archetype="cockpit-split">'
      + '<aside class="ck-icon-rail" aria-label="控制台侧轨"><span class="ck-rail-dot is-cur">CMD</span><span class="ck-rail-dot">LOG</span><span class="ck-rail-dot">NET</span><span class="ck-rail-dot">CFG</span></aside>'
      + '<div class="ck-main"><header class="ck-telemetry-bar" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1"><div><strong data-dg-source="' + srcFile + ':25:5">' + esc(hero.brand) + '</strong> <span style="color:var(--ui-muted);">// LIVE TELEMETRY · 12.4ms</span></div><button type="button" class="ui-btn ui-btn-primary" style="padding:4px 11px;font-size:11.5px;" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '" data-dg-source="' + srcFile + ':28:5">' + esc(hero.ctaLabel) + '</button></header>'
      + '<div class="ck-workspace">'
      + '<div class="ck-stat-strip" data-dg-block="' + esc(kpi.id) + '" data-dg-source="' + srcFile + ':36:1">'
      + '<div class="ui-surface-card ck-panel"><div style="color:var(--ui-muted);">' + esc(kpi.item1Title) + '</div><div class="ck-mono-num">' + esc(kpi.item1Val) + '</div><svg width="100%" height="18" viewBox="0 0 120 18"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="0,14 28,10 56,12 84,5 120,3"/></svg></div>'
      + '<div class="ui-surface-card ck-panel"><div style="color:var(--ui-muted);">' + esc(kpi.item2Title) + '</div><div class="ck-mono-num">' + esc(kpi.item2Val) + '</div><svg width="100%" height="18" viewBox="0 0 120 18"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="0,15 30,13 62,8 92,6 120,2"/></svg></div>'
      + '<div class="ui-surface-card ck-panel"><div style="color:var(--ui-muted);">' + esc(kpi.item3Title) + '</div><div class="ck-mono-num">' + esc(kpi.item3Val) + '</div><svg width="100%" height="18" viewBox="0 0 120 18"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="0,6 32,5 64,6 96,4 120,4"/></svg></div>'
      + '<div class="ui-surface-card ck-panel"><div style="color:var(--ui-muted);">节点响应中位数</div><div class="ck-mono-num">14ms</div><svg width="100%" height="18" viewBox="0 0 120 18"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="0,9 25,11 55,7 88,9 120,6"/></svg></div>'
      + '</div>'
      + '<div class="ck-split-body">'
      + '<section class="ui-surface-card ck-panel" data-dg-block="' + esc(table.id) + '" data-dg-source="' + srcFile + ':58:1"><div style="display:flex;justify-content:space-between;align-items:center;"><strong data-dg-source="' + srcFile + ':60:5">' + esc(hero.headline) + ' · ' + esc(table.title) + '</strong><button type="button" class="ui-btn ui-btn-ghost" style="padding:4px 10px;font-size:11px;" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '" data-dg-source="' + srcFile + ':62:5">' + esc(table.exportLabel) + '</button></div><table class="ck-table"><thead><tr><th>ID</th><th>PIPELINE</th><th>LATENCY</th><th>STATE</th></tr></thead><tbody><tr><td>#1024</td><td>核心网关限流策略升级</td><td>11ms</td><td><span class="ui-pill">ACTIVE</span></td></tr><tr><td>#1025</td><td>季度安全合规巡检复核</td><td>08ms</td><td><span class="ui-pill">READY</span></td></tr><tr><td>#1026</td><td>冷备账本快照增量核验</td><td>19ms</td><td><span class="ui-pill">SYNCED</span></td></tr></tbody></table></section>'
      + '<div style="display:flex;flex-direction:column;gap:10px;">'
      + '<section class="ui-surface-card ck-panel" data-dg-block="' + esc(form.id) + '" data-dg-source="' + srcFile + ':76:1"><strong>' + esc(form.title) + '</strong><form style="display:flex;flex-direction:column;gap:8px;margin-top:8px;" onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><input class="ui-input" type="text" placeholder="&gt; ' + esc(form.field1) + '" required data-dg-source="' + srcFile + ':79:5"><input class="ui-input" type="text" placeholder="&gt; ' + esc(form.field2) + '" data-dg-source="' + srcFile + ':80:5"><button type="submit" class="ui-btn ui-btn-primary" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '" data-dg-source="' + srcFile + ':82:5">' + esc(form.submitLabel) + '</button></form></section>'
      + '<section class="ui-surface-card ck-panel"><div style="font-family:var(--ui-font-mono,monospace);font-size:11px;color:var(--ui-muted);">[STREAM] ' + esc(hero.subline) + '</div></section>'
      + '<section class="ui-surface-card ck-panel"><div style="display:flex;justify-content:space-between;font-family:var(--ui-font-mono,monospace);font-size:11px;"><span>WATCHDOG: ARMED</span><span style="color:var(--ui-accent);">4/4 NODES HEALTHY</span></div></section>'
      + '</div></div>' + extraHtml + '</div></div></div>',

    'brutal-poster': () => '<div class="arch-root arch-brutal" data-ui-archetype="brutal-poster">'
      + '<header class="nb-topbar" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1"><strong>[RAW STUDIO] ' + esc(hero.brand) + '</strong><button type="button" class="ui-btn ui-btn-primary" style="border:2px solid var(--ui-border);box-shadow:3px 3px 0 var(--ui-border);" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '" data-dg-source="' + srcFile + ':27:5">' + esc(hero.ctaLabel) + '</button></header>'
      + '<main class="nb-collage">'
      + '<section class="ui-surface-card nb-box nb-s4"><div class="nb-h1">' + esc(hero.headline) + '</div><p style="margin:0;font-size:13.5px;">' + esc(hero.subline) + '</p></section>'
      + '<section class="ui-surface-card nb-box nb-s2" data-dg-block="' + esc(kpi.id) + '" data-dg-source="' + srcFile + ':38:1"><div>' + esc(kpi.item1Title) + '</div><div style="font-size:40px;font-weight:900;">' + esc(kpi.item1Val) + '</div><div>' + esc(kpi.item3Title) + ': ' + esc(kpi.item3Val) + '</div></section>'
      + '<section class="ui-surface-card nb-box nb-s3" data-dg-block="' + esc(form.id) + '" data-dg-source="' + srcFile + ':48:1"><strong>' + esc(form.title) + '</strong><form style="display:flex;flex-direction:column;gap:8px;margin-top:10px;" onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><input class="ui-input" type="text" placeholder="' + esc(form.field1) + '" required><input class="ui-input" type="text" placeholder="' + esc(form.field2) + '"><button type="submit" class="ui-btn ui-btn-primary" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '">' + esc(form.submitLabel) + '</button></form></section>'
      + '<section class="ui-surface-card nb-box nb-s3" data-dg-block="' + esc(table.id) + '" data-dg-source="' + srcFile + ':62:1"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>' + esc(table.title) + '</strong><button type="button" class="ui-btn ui-btn-ghost" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '">' + esc(table.exportLabel) + '</button></div><div style="margin-top:10px;font-weight:700;">#1024 核心网关限流策略升级 [ACTIVE]</div><div style="margin-top:6px;">#1025 季度安全合规巡检复核 [READY]</div></section>'
      + '<section class="ui-surface-card nb-box nb-s4" style="grid-column:span 6;display:flex;justify-content:space-between;"><span>累计交付：' + esc(kpi.item2Val) + '</span><span>BOLD NEO-BRUTALIST GRID</span></section>'
      + '</main>' + extraHtml + '</div>',

    'ledger-workbench': () => '<div class="arch-root arch-ledger" data-ui-archetype="ledger-workbench">'
      + '<header class="ep-govbar" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1"><span>' + esc(hero.brand) + ' · 合规内控与台账管理中心</span><button type="button" class="ui-btn ui-btn-ghost" style="padding:4px 12px;font-size:12px;" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '" data-dg-source="' + srcFile + ':26:5">' + esc(hero.ctaLabel) + '</button></header>'
      + '<div class="ep-subbar"><span>首页 / 台账复核 / ' + esc(hero.headline) + '</span><span>数据口径：实时核对</span></div>'
      + '<div class="ep-body"><aside class="ep-sidebar"><div class="ep-tree-item is-cur">全部业务台账</div><div class="ep-tree-item">待复核单据</div><div class="ep-tree-item">已归档记录</div><div class="ep-tree-item">审计导出历史</div></aside>'
      + '<main class="ep-main"><div class="ep-kpis" data-dg-block="' + esc(kpi.id) + '" data-dg-source="' + srcFile + ':38:1"><div class="ui-surface-card ep-panel"><div>' + esc(kpi.item1Title) + '</div><strong style="font-size:22px;color:var(--ui-primary);">' + esc(kpi.item1Val) + '</strong></div><div class="ui-surface-card ep-panel"><div>' + esc(kpi.item2Title) + '</div><strong style="font-size:22px;">' + esc(kpi.item2Val) + '</strong></div><div class="ui-surface-card ep-panel"><div>' + esc(kpi.item3Title) + '</div><strong style="font-size:22px;color:var(--ui-accent);">' + esc(kpi.item3Val) + '</strong></div><div class="ui-surface-card ep-panel"><div>复核退回率</div><strong style="font-size:22px;">0.4%</strong></div></div>'
      + '<section class="ui-surface-card ep-panel" data-dg-block="' + esc(form.id) + '" data-dg-source="' + srcFile + ':52:1"><form style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;" onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><strong style="margin-right:8px;">' + esc(form.title) + '：</strong><input class="ui-input" style="flex:1 1 180px;" type="text" placeholder="' + esc(form.field1) + '" required><input class="ui-input" style="flex:1 1 160px;" type="text" placeholder="' + esc(form.field2) + '"><button type="submit" class="ui-btn ui-btn-primary" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '">' + esc(form.submitLabel) + '</button></form></section>'
      + '<section class="ui-surface-card ep-panel" data-dg-block="' + esc(table.id) + '" data-dg-source="' + srcFile + ':66:1"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>' + esc(table.title) + '</strong><button type="button" class="ui-btn ui-btn-ghost" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '">' + esc(table.exportLabel) + '</button></div><table class="ck-table"><thead><tr><th>单据编号</th><th>业务事项</th><th>责任部门</th><th>复核状态</th></tr></thead><tbody><tr><td>#1024</td><td>核心网关限流策略升级</td><td>基础架构组</td><td><span class="ui-pill">进行中</span></td></tr><tr><td>#1025</td><td>季度安全合规巡检复核</td><td>安全内控办</td><td><span class="ui-pill">已就绪</span></td></tr></tbody></table></section>'
      + '<section class="ui-surface-card ep-panel" style="font-size:12px;color:var(--ui-muted);">' + esc(hero.subline) + '</section>' + extraHtml + '</main></div></div>'
  };

  if (Object.prototype.hasOwnProperty.call(uiArchDispatch, arch)) {
    return uiArchDispatch[arch]();
  }

  return '<div class="arch-root arch-chronicle" data-ui-archetype="chronicle-cascade">'
    + '<header class="ch-header" data-dg-block="' + esc(hero.id) + '" data-dg-source="' + srcFile + ':24:1"><div class="ed-serial">' + esc(hero.brand) + ' · CHRONICLE EDITION</div><h1 class="ch-h1">' + esc(hero.headline) + '</h1><p style="margin:6px auto 14px;max-width:580px;font-size:13.5px;color:var(--ui-muted);">' + esc(hero.subline) + '</p><button type="button" class="ui-btn ui-btn-primary" data-dg-action="' + esc(hero.ctaActionId) + '" data-dg-wiring="' + esc(hero.ctaWiring) + '">' + esc(hero.ctaLabel) + '</button></header>'
    + '<ol class="ch-spine">'
    + '<li class="ui-surface-card ch-entry" data-dg-block="' + esc(kpi.id) + '"><strong>一、阶段指标纪要</strong><div style="display:flex;gap:28px;margin-top:8px;flex-wrap:wrap;"><span>' + esc(kpi.item1Title) + '：<b>' + esc(kpi.item1Val) + '</b></span><span>' + esc(kpi.item2Title) + '：<b>' + esc(kpi.item2Val) + '</b></span><span>' + esc(kpi.item3Title) + '：<b>' + esc(kpi.item3Val) + '</b></span></div></li>'
    + '<li class="ui-surface-card ch-entry" data-dg-block="' + esc(form.id) + '"><strong>二、' + esc(form.title) + '</strong><form style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;" onsubmit="event.preventDefault(); window.__runMockAction && window.__runMockAction(\'' + jsAttr(form.submitActionId) + '\', \'' + jsAttr(form.submitLabel) + '\');"><input class="ui-input" style="flex:1 1 180px;" type="text" placeholder="' + esc(form.field1) + '" required><input class="ui-input" style="flex:1 1 180px;" type="text" placeholder="' + esc(form.field2) + '"><button type="submit" class="ui-btn ui-btn-primary" data-dg-action="' + esc(form.submitActionId) + '" data-dg-wiring="' + esc(form.submitWiring) + '">' + esc(form.submitLabel) + '</button></form></li>'
    + '<li class="ui-surface-card ch-entry" data-dg-block="' + esc(table.id) + '"><div style="display:flex;justify-content:space-between;align-items:center;"><strong>三、' + esc(table.title) + '</strong><button type="button" class="ui-btn ui-btn-ghost" data-dg-action="' + esc(table.exportActionId) + '" data-dg-wiring="' + esc(table.exportWiring) + '">' + esc(table.exportLabel) + '</button></div><p style="margin:8px 0 0;font-size:13px;">#1024 核心网关限流策略升级（进行中） · #1025 季度安全合规巡检复核（已就绪）</p></li>'
    + '<li class="ui-surface-card ch-entry"><strong>四、编辑部审校批注</strong><p style="margin:6px 0 0;font-size:13px;color:var(--ui-muted);">温润纸感衬线排版与时间轴叙事脉络，适合品牌专题、知识库与深度内容产品。</p></li>'
    + '<li class="ui-surface-card ch-entry"><strong>五、归档签署状态</strong><span class="ui-pill">等待接通真实后端持久化</span></li>'
    + '</ol>' + extraHtml + '</div>';
}
