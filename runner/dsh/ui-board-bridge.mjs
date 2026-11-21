// 注入被预览应用 <iframe> 的 8KB 零依赖双模通信桥：编辑模式（点选源码定位 + 双击改字 + 区块拖拽）↔ 测试模式（真点击 + 报错/假动作抓拍）
export function buildInjectedUiBridgeScript() {
  return `(function initDoneGateUiBridge() {
  if (window.__DG_UI_BRIDGE_ACTIVE__) return;
  window.__DG_UI_BRIDGE_ACTIVE__ = true;

  var mode = 'edit'; // 'edit' | 'test'
  var hoverBox = null;
  var selectBox = null;
  var tagPill = null;
  var selectedEl = null;
  var dragBlockSrcId = null;

  function ensureOverlays() {
    if (hoverBox) return;
    var style = document.createElement('style');
    style.id = 'dg-ui-bridge-style';
    style.textContent = [
      'body.dg-mode-edit [data-dg-action] { position: relative; }',
      'body.dg-mode-edit [data-dg-wiring="mock"]::after { content: "🔌 待接后端"; position: absolute; top: -8px; right: -6px; font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 999px; background: #fef3c7; color: #b45309; border: 1px solid #f59e0b; font-weight: 700; pointer-events: none; z-index: 9990; white-space: nowrap; }',
      'body.dg-mode-edit [data-dg-wiring="wired"]::after { content: "✓ 已接真逻辑"; position: absolute; top: -8px; right: -6px; font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 999px; background: #dcfce7; color: #15803d; border: 1px solid #22c55e; font-weight: 700; pointer-events: none; z-index: 9990; white-space: nowrap; }',
      'body.dg-mode-edit [data-dg-block] { transition: outline 0.12s ease; }',
      'body.dg-mode-edit [data-dg-block]:hover { outline: 1px dashed rgba(37, 99, 235, 0.45); outline-offset: 4px; }',
      '.dg-block-drag-chip { display: none; position: absolute; top: 6px; right: 8px; padding: 2px 7px; border-radius: 6px; background: rgba(15, 23, 42, 0.78); color: #fff; font-size: 10px; cursor: grab; z-index: 9985; user-select: none; }',
      'body.dg-mode-edit [data-dg-block] { position: relative; }',
      'body.dg-mode-edit [data-dg-block]:hover > .dg-block-drag-chip { display: inline-flex; align-items: center; gap: 4px; }'
    ].join('\\n');
    document.head.appendChild(style);

    hoverBox = document.createElement('div');
    hoverBox.setAttribute('data-dg-bridge-ui', '1');
    hoverBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;border:1.5px dashed #3b82f6;background:rgba(59,130,246,0.06);border-radius:6px;display:none;transition:all 0.06s ease;';
    selectBox = document.createElement('div');
    selectBox.setAttribute('data-dg-bridge-ui', '1');
    selectBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #2563eb;background:rgba(37,99,235,0.08);border-radius:6px;display:none;box-shadow:0 0 0 3px rgba(37,99,235,0.16);';
    tagPill = document.createElement('div');
    tagPill.setAttribute('data-dg-bridge-ui', '1');
    tagPill.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;padding:3px 8px;border-radius:6px;background:#1d4ed8;color:#fff;font:600 11px/1.3 system-ui,sans-serif;white-space:nowrap;display:none;box-shadow:0 4px 12px rgba(15,23,42,0.25);';
    document.body.appendChild(hoverBox);
    document.body.appendChild(selectBox);
    document.body.appendChild(tagPill);
    decorateDraggableBlocks();
  }

  function decorateDraggableBlocks() {
    var blocks = document.querySelectorAll('[data-dg-block]');
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i];
      blk.setAttribute('draggable', mode === 'edit' ? 'true' : 'false');
      if (!blk.querySelector('.dg-block-drag-chip')) {
        var chip = document.createElement('span');
        chip.className = 'dg-block-drag-chip';
        chip.setAttribute('data-dg-bridge-ui', '1');
        chip.textContent = '⋮⋮ 拖拽调序';
        blk.appendChild(chip);
      }
    }
  }

  // 跨框架源码行列提取：兼容 Lovinsp/code-inspector、React Fiber (react-grab 思路)、Vue VNode 与原生标注
  function resolveElementSource(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      var insp = cur.getAttribute('data-insp-path') || cur.getAttribute('data-dg-source') || cur.getAttribute('data-source-loc') || cur.getAttribute('data-v-inspector');
      if (insp) {
        var parts = insp.split(':');
        return { file: parts[0], line: Number(parts[1] || 1), col: Number(parts[2] || 1), component: cur.getAttribute('data-dg-component') || cur.tagName.toLowerCase() };
      }
      // React 17/18/19 Fiber _debugSource 穿透底层 components/ui 包装组件
      var keys = Object.keys(cur);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].indexOf('__reactFiber$') === 0 || keys[k].indexOf('__reactInternalInstance$') === 0) {
          var fiber = cur[keys[k]];
          var fallbackSrc = null;
          while (fiber) {
            var src = fiber._debugSource || (fiber._debugOwner && fiber._debugOwner._debugSource);
            var fnName = (fiber.type && (fiber.type.displayName || fiber.type.name)) || '';
            if (src && src.fileName) {
              var clean = String(src.fileName).replace(/\\\\/g, '/');
              if (!fallbackSrc) fallbackSrc = { file: clean, line: src.lineNumber || 1, col: src.columnNumber || 1, component: fnName || cur.tagName.toLowerCase() };
              if (clean.indexOf('/components/ui/') === -1 && clean.indexOf('node_modules') === -1) {
                return { file: clean, line: src.lineNumber || 1, col: src.columnNumber || 1, component: fnName || cur.tagName.toLowerCase() };
              }
            }
            fiber = fiber.return;
          }
          if (fallbackSrc) return fallbackSrc;
        }
      }
      if (cur.__vueParentComponent && cur.__vueParentComponent.type && cur.__vueParentComponent.type.__file) {
        return { file: cur.__vueParentComponent.type.__file, line: 1, col: 1, component: cur.__vueParentComponent.type.name || 'VueComponent' };
      }
      cur = cur.parentElement;
    }
    return { file: window.location.pathname === '/' ? '.donegate/ui-prototype/index.html' : window.location.pathname.replace(/^\\/+/, ''), line: 1, col: 1, component: el.tagName.toLowerCase() };
  }

  function buildCssPath(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var act = el.getAttribute('data-dg-action');
    if (act) return '[data-dg-action="' + act + '"]';
    return el.tagName.toLowerCase();
  }

  function placeBox(box, el, showPill) {
    if (!box || !el) return;
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = Math.round(r.left) + 'px';
    box.style.top = Math.round(r.top) + 'px';
    box.style.width = Math.max(12, Math.round(r.width)) + 'px';
    box.style.height = Math.max(12, Math.round(r.height)) + 'px';
    if (showPill && tagPill) {
      var src = resolveElementSource(el);
      var txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 16);
      var wire = el.getAttribute('data-dg-wiring');
      var wTag = wire === 'mock' ? ' · 🔌待接后端' : (wire === 'wired' ? ' · ✓真逻辑' : '');
      tagPill.textContent = '<' + el.tagName.toLowerCase() + '>' + (txt ? ' "' + txt + '"' : '') + ' · ' + src.file.split('/').pop() + ':' + src.line + wTag;
      tagPill.style.display = 'block';
      tagPill.style.left = Math.max(6, Math.min(window.innerWidth - 260, Math.round(r.left))) + 'px';
      tagPill.style.top = (r.top > 28 ? Math.round(r.top - 24) : Math.round(r.bottom + 4)) + 'px';
    }
  }

  function postUp(type, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'dg-ui-bridge', type: type, payload: payload }, '*');
    }
  }

  function applyBridgeMode(nextMode) {
    mode = nextMode === 'test' ? 'test' : 'edit';
    document.body.classList.toggle('dg-mode-edit', mode === 'edit');
    document.body.classList.toggle('dg-mode-test', mode === 'test');
    ensureOverlays();
    decorateDraggableBlocks();
    if (mode === 'test') {
      if (hoverBox) hoverBox.style.display = 'none';
      if (selectBox) selectBox.style.display = 'none';
      if (tagPill) tagPill.style.display = 'none';
    } else if (selectedEl) {
      placeBox(selectBox, selectedEl, true);
    }
    postUp('dg-ui:mode-synced', { mode: mode });
  }

  document.addEventListener('pointermove', function(e) {
    if (mode !== 'edit') return;
    ensureOverlays();
    var t = e.target;
    if (!t || t === document.body || t === document.documentElement || t.getAttribute('data-dg-bridge-ui')) return;
    placeBox(hoverBox, t, !selectedEl);
  }, true);

  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || t.getAttribute('data-dg-bridge-ui')) return;
    if (mode === 'edit') {
      if (t.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      var pick = t.closest('button, a, input, select, textarea, [data-dg-action], [data-dg-component], h1, h2, h3, p, label') || t;
      selectedEl = pick;
      ensureOverlays();
      placeBox(selectBox, pick, true);
      var src = resolveElementSource(pick);
      var label = (pick.innerText || pick.value || pick.getAttribute('placeholder') || pick.getAttribute('aria-label') || pick.tagName).replace(/\\s+/g, ' ').trim().slice(0, 28);
      postUp('dg-ui:element-selected', {
        tag: pick.tagName.toLowerCase(),
        label: label || pick.tagName.toLowerCase(),
        sourceFile: src.file,
        sourceLine: src.line,
        component: src.component,
        selector: buildCssPath(pick),
        actionId: pick.getAttribute('data-dg-action') || null,
        wiringState: pick.getAttribute('data-dg-wiring') || null,
        outerSnippet: pick.outerHTML.slice(0, 280)
      });
      return;
    }
    // 测试模式：放行真实点击，同时抓拍点击了哪个待接后端的假动作
    var actEl = t.closest('[data-dg-action]');
    if (actEl) {
      postUp('dg-ui:test-action-triggered', {
        actionId: actEl.getAttribute('data-dg-action'),
        wiringState: actEl.getAttribute('data-dg-wiring') || 'mock',
        label: (actEl.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
      });
    }
  }, true);

  // 编辑模式双击原地改文案
  document.addEventListener('dblclick', function(e) {
    if (mode !== 'edit') return;
    var t = e.target.closest('h1, h2, h3, h4, p, span, button, a, label, th, td');
    if (!t || t.getAttribute('data-dg-bridge-ui')) return;
    e.preventDefault();
    e.stopPropagation();
    var before = t.innerText;
    t.contentEditable = 'true';
    t.focus();
    var finish = function() {
      t.contentEditable = 'false';
      t.removeEventListener('blur', finish);
      var after = t.innerText;
      if (after !== before) {
        var src = resolveElementSource(t);
        postUp('dg-ui:inline-text-edited', { before: before, after: after, sourceFile: src.file, sourceLine: src.line, selector: buildCssPath(t) });
      }
    };
    t.addEventListener('blur', finish);
  }, true);

  // 编辑模式组件区块拖拉拽调序
  document.addEventListener('dragstart', function(e) {
    if (mode !== 'edit') return;
    var blk = e.target.closest('[data-dg-block]');
    if (!blk) return;
    dragBlockSrcId = blk.getAttribute('data-dg-block');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', function(e) {
    if (mode !== 'edit' || !dragBlockSrcId) return;
    if (e.target.closest('[data-dg-block]')) e.preventDefault();
  });
  document.addEventListener('drop', function(e) {
    if (mode !== 'edit' || !dragBlockSrcId) return;
    var targetBlk = e.target.closest('[data-dg-block]');
    if (!targetBlk) return;
    e.preventDefault();
    var dstId = targetBlk.getAttribute('data-dg-block');
    if (dstId && dstId !== dragBlockSrcId) {
      postUp('dg-ui:blocks-reordered', { fromBlockId: dragBlockSrcId, toBlockId: dstId });
    }
    dragBlockSrcId = null;
  });

  // 测试模式运行期异常自动抓拍
  window.addEventListener('error', function(ev) {
    postUp('dg-ui:runtime-error', { message: String(ev.message || 'Runtime Error'), file: ev.filename || '', line: ev.lineno || 0 });
  });
  window.addEventListener('unhandledrejection', function(ev) {
    postUp('dg-ui:runtime-error', { message: 'Unhandled Rejection: ' + String(ev.reason || '') });
  });

  window.addEventListener('message', function(ev) {
    var d = ev.data || {};
    if (d.source !== 'donegate-uiboard') return;
    if (d.type === 'dg-ui:set-mode') applyBridgeMode(d.mode);
    else if (d.type === 'dg-ui:apply-tokens' && d.tokens) {
      var root = document.documentElement;
      Object.keys(d.tokens).forEach(function(k) { root.style.setProperty(k, d.tokens[k]); });
      postUp('dg-ui:tokens-applied', { proposalId: d.proposalId });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { applyBridgeMode('edit'); });
  } else {
    applyBridgeMode('edit');
  }
})();`;
}
