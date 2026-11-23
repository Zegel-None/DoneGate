// 注入被预览应用 <iframe> 的零依赖通信桥：全窗口原生交互放行 + 纯 Alt+单击 (e.altKey) 源码与 uiOwner 定位拾取桥（防双发胶囊）

function buildUiBridgeDomHelpersSource() {
  return `  var hoverBox = null;
  var selectBox = null;
  var tagPill = null;
  var selectedEl = null;
  var suppressAltClickUntil = 0;

  function ensureOverlays() {
    if (hoverBox || !document.body) return;
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
  }

  function resolveElementSource(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      var insp = cur.getAttribute && (cur.getAttribute('data-insp-path') || cur.getAttribute('data-dg-source') || cur.getAttribute('data-source-loc') || cur.getAttribute('data-v-inspector'));
      if (insp) {
        var parts = insp.split(':');
        return { file: parts[0], line: Number(parts[1] || 1), col: Number(parts[2] || 1), component: cur.getAttribute('data-dg-component') || cur.tagName.toLowerCase() };
      }
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
    return { file: window.location.pathname === '/' ? '.donegate/ui-prototype/index.html' : window.location.pathname.replace(/^\\/+/, ''), line: 1, col: 1, component: (el && el.tagName ? el.tagName.toLowerCase() : 'div') };
  }

  function resolveUiOwner(el, meta) {
    if (el && typeof el.closest === 'function') {
      var owned = el.closest('[data-ui-owner]');
      var directOwner = owned && owned.getAttribute ? owned.getAttribute('data-ui-owner') : null;
      if (directOwner) return String(directOwner).replace(/\\\\/g, '/');
    }
    var cur = el;
    while (cur && cur !== document.body) {
      var attrOwner = cur.getAttribute ? cur.getAttribute('data-ui-owner') : null;
      if (attrOwner) return String(attrOwner).replace(/\\\\/g, '/');
      cur = cur.parentElement;
    }
    var srcFile = meta && meta.file ? String(meta.file).replace(/\\\\/g, '/') : '';
    if (srcFile.indexOf('runner/atlas/') === 0 || srcFile.indexOf('runner/dsh/') === 0) {
      return srcFile;
    }
    var act = el && el.getAttribute ? (el.getAttribute('data-uib-act') || el.getAttribute('data-dg-action') || el.getAttribute('data-action') || '') : '';
    var ctrl = el && el.getAttribute ? (el.getAttribute('data-ctrl-id') || '') : '';
    if (act.indexOf('jit-') === 0 || ctrl.indexOf('jit:') === 0) return 'runner/atlas/wb-jit-workflow.mjs';
    return 'runner/atlas/wb-uiboard.mjs';
  }

  function deriveBridgeSliceCmd(uiOwner) {
    var clean = String(uiOwner || '').replace(/\\\\/g, '/');
    if (clean.indexOf('runner/dsh/') === 0) return 'node runner/donegate.mjs slice dsh-orchestrator --focus ' + clean;
    if (clean.indexOf('runner/atlas/') === 0) return 'node runner/donegate.mjs slice atlas-workbench --focus ' + clean;
    return null;
  }

  function buildCssPath(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var act = el.getAttribute && el.getAttribute('data-dg-action');
    if (act) return '[data-dg-action="' + act + '"]';
    return el.tagName.toLowerCase();
  }

  function placeBox(box, el, showPill) {
    if (!box || !el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = Math.round(r.left) + 'px';
    box.style.top = Math.round(r.top) + 'px';
    box.style.width = Math.max(12, Math.round(r.width)) + 'px';
    box.style.height = Math.max(12, Math.round(r.height)) + 'px';
    if (showPill && tagPill) {
      var src = resolveElementSource(el);
      var txt = String(el.innerText || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || '').trim().slice(0, 16);
      var wire = el.getAttribute && el.getAttribute('data-dg-wiring');
      var wTag = wire === 'mock' ? ' · 🔌待接后端' : (wire === 'wired' ? ' · ✓真逻辑' : '');
      tagPill.textContent = '<' + el.tagName.toLowerCase() + '>' + (txt ? ' "' + txt + '"' : '') + ' · ' + src.file.split('/').pop() + ':' + src.line + wTag;
      tagPill.style.display = 'block';
      tagPill.style.left = Math.max(6, Math.min((window.innerWidth || 800) - 260, Math.round(r.left))) + 'px';
      tagPill.style.top = (r.top > 28 ? Math.round(r.top - 24) : Math.round(r.bottom + 4)) + 'px';
    }
  }`;
}

function buildUiBridgeEventListenersSource() {
  return `  function hideHoverBox() {
    if (hoverBox) hoverBox.style.display = 'none';
    if (!selectedEl && tagPill) tagPill.style.display = 'none';
    else if (selectedEl && selectBox && selectBox.style.display === 'block') placeBox(selectBox, selectedEl, true);
  }

  function postUp(type, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'dg-ui-bridge', type: type, payload: payload }, '*');
    }
  }

  document.addEventListener('pointermove', function(e) {
    if (!e.altKey) {
      hideHoverBox();
      return;
    }
    ensureOverlays();
    var t = e.target;
    if (!t || t === document.body || t === document.documentElement || (t.getAttribute && t.getAttribute('data-dg-bridge-ui'))) return;
    placeBox(hoverBox, t, true);
  }, true);

  window.addEventListener('keyup', function(e) {
    if (e.key === 'Alt' || !e.altKey) hideHoverBox();
  }, true);
  window.addEventListener('blur', hideHoverBox);
  document.addEventListener('mouseleave', hideHoverBox);

  document.addEventListener('pointerdown', function(e) {
    if (!e.altKey || e.button !== 0) return;
    var t = e.target;
    if (!t || (t.getAttribute && t.getAttribute('data-dg-bridge-ui'))) return;
    suppressAltClickUntil = Date.now() + 800;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var pick = (t.closest && t.closest('button, a, input, select, textarea, [data-dg-action], [data-dg-component], h1, h2, h3, p, label')) || t;
    selectedEl = pick;
    ensureOverlays();
    if (hoverBox) hoverBox.style.display = 'none';
    placeBox(selectBox, pick, true);
    var src = resolveElementSource(pick);
    var uiOwner = resolveUiOwner(pick, src);
    var sliceCmd = deriveBridgeSliceCmd(uiOwner);
    var label = String(pick.innerText || pick.value || (pick.getAttribute && (pick.getAttribute('placeholder') || pick.getAttribute('aria-label'))) || pick.tagName).replace(/\\s+/g, ' ').trim().slice(0, 28);
    postUp('dg-ui:element-selected', {
      tag: pick.tagName.toLowerCase(),
      label: label || pick.tagName.toLowerCase(),
      sourceFile: src.file,
      sourceLine: src.line,
      component: src.component,
      uiOwner: uiOwner,
      sliceCmd: sliceCmd,
      selector: buildCssPath(pick),
      actionId: (pick.getAttribute && pick.getAttribute('data-dg-action')) || null,
      wiringState: (pick.getAttribute && pick.getAttribute('data-dg-wiring')) || null,
      outerSnippet: String(pick.outerHTML || '').slice(0, 280)
    });
  }, true);

  document.addEventListener('pointerup', function(e) {
    if (e.altKey || Date.now() < suppressAltClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (e.altKey || Date.now() < suppressAltClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    var t = e.target;
    if (!t || !t.closest) return;
    var actEl = t.closest('[data-dg-action]');
    if (actEl) {
      postUp('dg-ui:test-action-triggered', {
        actionId: actEl.getAttribute('data-dg-action'),
        wiringState: actEl.getAttribute('data-dg-wiring') || 'mock',
        label: String(actEl.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
      });
    }
  }, true);

  window.addEventListener('error', function(ev) {
    postUp('dg-ui:runtime-error', { message: String(ev.message || 'Runtime Error'), file: ev.filename || '', line: ev.lineno || 0 });
  });
  window.addEventListener('unhandledrejection', function(ev) {
    postUp('dg-ui:runtime-error', { message: 'Unhandled Rejection: ' + String(ev.reason || '') });
  });

  window.addEventListener('message', function(ev) {
    var d = (ev && ev.data) || {};
    if (d.source !== 'donegate-uiboard') return;
    if (d.type === 'dg-ui:clear-selection') {
      selectedEl = null;
      if (selectBox) selectBox.style.display = 'none';
      if (tagPill) tagPill.style.display = 'none';
    } else if (d.type === 'dg-ui:apply-tokens' && d.tokens) {
      var root = document.documentElement;
      Object.keys(d.tokens).forEach(function(k) { root.style.setProperty(k, d.tokens[k]); });
      postUp('dg-ui:tokens-applied', { proposalId: d.proposalId });
    }
  });`;
}

export function buildInjectedUiBridgeScript() {
  return [
    '(function initDoneGateUiBridge() {',
    '  if (window.__DG_UI_BRIDGE_ACTIVE__) return;',
    '  window.__DG_UI_BRIDGE_ACTIVE__ = true;',
    buildUiBridgeDomHelpersSource(),
    buildUiBridgeEventListenersSource(),
    '})();'
  ].join('\n');
}
