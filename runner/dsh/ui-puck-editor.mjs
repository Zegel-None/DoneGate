// Puck 可视化积木拖拽编排画布渲染器（检测 @puckeditor/core 就绪后激活 ?editor=puck 实时排序、属性内联编辑与一键落盘）

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPuckInteractiveEditorHtml(ctx) {
  const { layout, wiring, activeProposalId, archetype, cssVars, puckVersion, blockTemplates, toolchain } = ctx;
  const blocks = Array.isArray(layout?.content) ? layout.content : [];
  const wireById = new Map(((wiring && wiring.actions) || []).map((a) => [a.actionId, a.status]));
  const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(layout?.root?.title || 'Puck Visual Editor')} · Puck 编排模式</title>
  <style>
${cssVars}
    * { box-sizing: border-box; }
    html, body { height: 100%; min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans, system-ui, sans-serif); }
    .pk-shell { display: grid; grid-template-rows: 44px minmax(0, 1fr); height: 100vh; }
    .pk-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; background: var(--ui-surface); border-bottom: 1px solid var(--ui-border); font-size: 12px; }
    .pk-main { display: grid; grid-template-columns: 232px minmax(0, 1fr) 264px; min-height: 0; }
    @media (max-width: 900px) { .pk-main { grid-template-columns: 1fr; } }
    .pk-col { background: var(--ui-surface); overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .pk-col-l { border-right: 1px solid var(--ui-border); }
    .pk-col-r { border-left: 1px solid var(--ui-border); }
    .pk-stage { overflow: auto; padding: 18px 22px; background: var(--ui-bg); display: flex; flex-direction: column; gap: 12px; }
    .pk-sec-title { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--ui-muted); text-transform: uppercase; }
    .pk-tpl-btn { width: 100%; text-align: left; padding: 8px 10px; border-radius: var(--ui-radius); border: 1px solid var(--ui-border); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
    .pk-tpl-btn:hover { border-color: var(--ui-primary); }
    .pk-tree-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid transparent; font-size: 12px; cursor: pointer; }
    .pk-tree-row.is-sel { background: var(--ui-surface-muted); border-color: var(--ui-primary); font-weight: 600; }
    .pk-blk-card { border: 1.5px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); box-shadow: var(--ui-shadow); padding: 14px 16px; transition: border-color 0.12s ease; cursor: grab; }
    .pk-blk-card.is-sel { border-color: var(--ui-primary); box-shadow: 0 0 0 2px rgba(37,99,235,0.18); }
    .pk-blk-card.is-dragover { border-style: dashed; border-color: var(--ui-primary); }
    .pk-blk-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px dashed var(--ui-border); font-size: 11.5px; color: var(--ui-muted); }
    .pk-mini-btn { padding: 2px 7px; border-radius: 5px; border: 1px solid var(--ui-border); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 11px; cursor: pointer; }
    .pk-primary-btn { padding: 6px 12px; border-radius: var(--ui-radius); border: 1px solid var(--ui-primary); background: var(--ui-primary); color: var(--ui-primary-fg); font-size: 12px; font-weight: 600; cursor: pointer; }
    .pk-field { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; }
    .pk-field input { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--ui-border); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 12px; }
    .pk-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--ui-surface-muted); color: var(--ui-primary); }
  </style>
</head>
<body data-puck-editor="active" data-puck-version="${esc(puckVersion)}" data-proposal-id="${esc(activeProposalId)}" data-archetype="${esc(archetype)}" data-lovinsp-active="${toolchain?.lovinspInstalled ? '1' : '0'}" data-react-grab-active="${toolchain?.reactGrabInstalled ? '1' : '0'}">
  <div class="pk-shell">
    <header class="pk-top">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong>Puck 可视化积木编排台</strong>
        <span class="pk-badge">@puckeditor/core@${esc(puckVersion)} 已激活</span>
        <span id="pk-status-msg" style="color:var(--ui-muted);">拖拽积木卡片可上下重排，右侧面板实时改属性并落盘 ui-layout.json</span>
      </div>
      <button type="button" id="pk-save-btn" class="pk-primary-btn">保存布局至 ui-layout.json</button>
    </header>
    <div class="pk-main">
      <aside class="pk-col pk-col-l">
        <div class="pk-sec-title">1. 组件积木库 (点击或拖入画布)</div>
        <div id="pk-palette" style="display:flex;flex-direction:column;gap:6px;"></div>
        <div class="pk-sec-title" style="margin-top:8px;">2. 组件大纲树 (Outline)</div>
        <div id="pk-outline" style="display:flex;flex-direction:column;gap:4px;"></div>
      </aside>
      <main id="pk-stage" class="pk-stage" aria-label="Puck 可视化拖拽画布"></main>
      <aside class="pk-col pk-col-r">
        <div class="pk-sec-title">3. 选中积木属性实时编辑</div>
        <div id="pk-inspector" style="display:flex;flex-direction:column;gap:8px;"></div>
      </aside>
    </div>
  </div>
  <script>
    (function initPuckCanvas() {
      var TEMPLATES = ${safeJson(blockTemplates)};
      var WIRE_MAP = ${safeJson(Object.fromEntries(wireById))};
      var state = { blocks: ${safeJson(blocks)}, selectedId: ${safeJson(blocks[0]?.id || null)}, dragBlkId: null, dragTplType: null };
      var qsSess = new URLSearchParams(window.location.search).get('sessionId') || '';
      var apiUrl = '/donegate/api/uiboard/layout' + (qsSess ? ('?sessionId=' + encodeURIComponent(qsSess)) : '');
      function escH(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
      function setStatus(txt) { var el = document.getElementById('pk-status-msg'); if (el) el.textContent = txt; }
      async function postMutation(payload, msg) {
        try {
          var r = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          var j = await r.json();
          if (j && j.ok && j.layout && Array.isArray(j.layout.content)) {
            state.blocks = j.layout.content;
            if (!state.blocks.some(function(b) { return b.id === state.selectedId; })) state.selectedId = state.blocks[0] ? state.blocks[0].id : null;
            renderAll();
            setStatus(msg || '已同步写入 .donegate/ui-layout.json');
          }
        } catch (err) { void err; setStatus('保存请求异常'); }
      }
      function renderBlockSummary(b) {
        var p = b.props || {};
        if (b.type === 'hero_nav') return '<div style="font-weight:700;font-size:16px;">' + escH(p.brand) + ' · ' + escH(p.headline) + '</div><div style="font-size:12px;color:var(--ui-muted);margin:4px 0 8px;">' + escH(p.subline) + '</div><button type="button" class="pk-primary-btn" data-dg-action="' + escH(p.ctaActionId || 'act-cta') + '" data-dg-wiring="' + escH(WIRE_MAP[p.ctaActionId] || 'mock') + '">' + escH(p.ctaLabel || '主按钮') + '</button>';
        if (b.type === 'kpi_row') return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;"><div><small>' + escH(p.item1Title) + '</small><div style="font-size:20px;font-weight:700;color:var(--ui-primary);">' + escH(p.item1Val) + '</div></div><div><small>' + escH(p.item2Title) + '</small><div style="font-size:20px;font-weight:700;">' + escH(p.item2Val) + '</div></div><div><small>' + escH(p.item3Title) + '</small><div style="font-size:20px;font-weight:700;">' + escH(p.item3Val) + '</div></div></div>';
        return '<div style="font-weight:600;margin-bottom:6px;">' + escH(p.title || b.type) + '</div><div style="font-size:12px;color:var(--ui-muted);">' + Object.keys(p).map(function(k) { return escH(k) + '=' + escH(p[k]); }).join(' · ') + '</div>';
      }
      function renderAll() {
        var pal = document.getElementById('pk-palette');
        pal.innerHTML = Object.keys(TEMPLATES).map(function(tKey) {
          var t = TEMPLATES[tKey];
          return '<button type="button" class="pk-tpl-btn" draggable="true" data-puck-insert="' + escH(t.type) + '"><span>' + escH(t.label) + '</span><span>+ 添加</span></button>';
        }).join('');
        var out = document.getElementById('pk-outline');
        out.innerHTML = state.blocks.map(function(b, idx) {
          return '<div class="pk-tree-row' + (b.id === state.selectedId ? ' is-sel' : '') + '" data-puck-select="' + escH(b.id) + '"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (idx + 1) + '. ' + escH((TEMPLATES[b.type] && TEMPLATES[b.type].label) || b.type) + '</span><span style="display:inline-flex;gap:3px;"><button type="button" class="pk-mini-btn" data-puck-move="up" data-id="' + escH(b.id) + '">↑</button><button type="button" class="pk-mini-btn" data-puck-move="down" data-id="' + escH(b.id) + '">↓</button></span></div>';
        }).join('');
        var stg = document.getElementById('pk-stage');
        stg.innerHTML = state.blocks.map(function(b, idx) {
          var ln = 12 + idx * 14;
          return '<section class="pk-blk-card' + (b.id === state.selectedId ? ' is-sel' : '') + '" draggable="true" data-puck-blk="' + escH(b.id) + '" data-dg-block="' + escH(b.id) + '" data-insp-path=".donegate/ui-layout.json:' + ln + ':1" data-component-stack="PuckEditor > ${esc(archetype)} > ' + escH(b.type) + '(' + escH(b.id) + ')"><div class="pk-blk-head"><span>[' + escH(b.type) + '] #' + escH(b.id) + '</span><span style="display:inline-flex;gap:4px;"><button type="button" class="pk-mini-btn" data-puck-move="up" data-id="' + escH(b.id) + '">上移</button><button type="button" class="pk-mini-btn" data-puck-move="down" data-id="' + escH(b.id) + '">下移</button><button type="button" class="pk-mini-btn" data-puck-remove="' + escH(b.id) + '">删除</button></span></div>' + renderBlockSummary(b) + '</section>';
        }).join('');
        renderInspector();
      }
      function renderInspector() {
        var box = document.getElementById('pk-inspector');
        var cur = state.blocks.find(function(b) { return b.id === state.selectedId; });
        if (!cur) { box.innerHTML = '<div style="font-size:12px;color:var(--ui-muted);">点击画布任意积木即可编辑属性</div>'; return; }
        var props = cur.props || {};
        box.innerHTML = '<div class="pk-badge">当前积木：' + escH(cur.id) + '</div>' + Object.keys(props).map(function(k) {
          return '<label class="pk-field"><span>' + escH(k) + '</span><input type="text" data-puck-prop="' + escH(k) + '" value="' + escH(props[k]) + '"></label>';
        }).join('');
      }
      document.addEventListener('click', function(e) {
        if (e.altKey) return;
        var ins = e.target.closest('[data-puck-insert]');
        if (ins) { postMutation({ op: 'add', blockType: ins.getAttribute('data-puck-insert') }, '已新增积木并落盘'); return; }
        var rem = e.target.closest('[data-puck-remove]');
        if (rem) { postMutation({ op: 'remove', blockId: rem.getAttribute('data-puck-remove') }, '已删除积木并落盘'); return; }
        var mv = e.target.closest('[data-puck-move]');
        if (mv) {
          var id = mv.getAttribute('data-id'), idx = state.blocks.findIndex(function(x) { return x.id === id; });
          var targetIdx = mv.getAttribute('data-puck-move') === 'up' ? idx - 1 : idx + 1;
          if (idx >= 0 && state.blocks[targetIdx]) postMutation({ op: 'reorder', fromBlockId: id, toBlockId: state.blocks[targetIdx].id }, '已调整积木顺序并落盘');
          return;
        }
        var sel = e.target.closest('[data-puck-select], [data-puck-blk]');
        if (sel) { state.selectedId = sel.getAttribute('data-puck-select') || sel.getAttribute('data-puck-blk'); renderAll(); }
      });
      document.addEventListener('input', function(e) {
        var key = e.target && e.target.getAttribute && e.target.getAttribute('data-puck-prop');
        if (!key) return;
        var cur = state.blocks.find(function(b) { return b.id === state.selectedId; });
        if (cur) { cur.props = cur.props || {}; cur.props[key] = e.target.value; setStatus('属性已修改，点击右上角保存或失焦自动落盘'); }
      });
      document.addEventListener('change', function(e) {
        var key = e.target && e.target.getAttribute && e.target.getAttribute('data-puck-prop');
        var cur = key && state.blocks.find(function(b) { return b.id === state.selectedId; });
        if (cur) postMutation({ op: 'update_props', blockId: cur.id, props: cur.props }, '已保存属性变更至 ui-layout.json');
      });
      document.getElementById('pk-save-btn').addEventListener('click', function() {
        var cur = state.blocks.find(function(b) { return b.id === state.selectedId; });
        if (cur) postMutation({ op: 'update_props', blockId: cur.id, props: cur.props }, '✓ 已将最新布局保存至 .donegate/ui-layout.json');
      });
      document.addEventListener('dragstart', function(e) {
        var blk = e.target.closest('[data-puck-blk]'), tpl = e.target.closest('[data-puck-insert]');
        state.dragBlkId = blk ? blk.getAttribute('data-puck-blk') : null;
        state.dragTplType = tpl ? tpl.getAttribute('data-puck-insert') : null;
      });
      document.addEventListener('dragover', function(e) {
        if (e.target.closest('#pk-stage')) e.preventDefault();
      });
      document.addEventListener('drop', function(e) {
        if (!e.target.closest('#pk-stage')) return;
        e.preventDefault();
        if (state.dragTplType) { var t = state.dragTplType; state.dragTplType = null; postMutation({ op: 'add', blockType: t }, '已拖入新积木并落盘'); return; }
        var over = e.target.closest('[data-puck-blk]');
        if (state.dragBlkId && over && over.getAttribute('data-puck-blk') !== state.dragBlkId) {
          var fromId = state.dragBlkId; state.dragBlkId = null;
          postMutation({ op: 'reorder', fromBlockId: fromId, toBlockId: over.getAttribute('data-puck-blk') }, '已拖拽重排积木并落盘');
        }
      });
      renderAll();
    })();
  </script>
  <script src="/donegate/api/uiboard/bridge.js"></script>
</body>
</html>`;
}
