// DSH 三分屏夺舍外壳装配、Alt+单击拾取监听、悬停折叠回执扁条与派工闭环（零外网依赖，<= 245 行）
export function buildWbDshShell() {
  const fn = function initDoneGateDshIntegration() {
    document.body.classList.add(IS_DSH_EMBED ? 'is-dsh-embed' : 'has-dsh-dock');
    state.rightOpen = false;
    const hostTheme = DSH_URL_PARAMS.get('theme');
    if (IS_DSH_EMBED && (hostTheme === 'dark' || hostTheme === 'light')) {
      state.theme = hostTheme;
      applyThemeClasses(hostTheme);
    }
    if (IS_DSH_EMBED && window.innerWidth < 820) { state.leftOpen = false; }
    window.addEventListener('resize', () => {
      if (IS_DSH_EMBED && window.innerWidth < 780 && state.leftOpen) {
        state.leftOpen = false;
        renderLeftDrawer();
        requestAnimationFrame(fitCanvas);
      }
    });
    const hint = document.getElementById('subtle-canvas-hint');
    if (hint) hint.textContent = 'Alt+单击任意卡片/连线/按钮累加引用 · 双击文字改名';
    const world = document.getElementById('canvas-world');
    if (world && !document.getElementById('dsh-anchors-layer')) {
      const ancLayer = document.createElement('div');
      ancLayer.id = 'dsh-anchors-layer';
      world.appendChild(ancLayer);
    }
    const mainRow = document.getElementById('canvas-stage') ? document.getElementById('canvas-stage').parentElement : null;
    if (!IS_DSH_EMBED && mainRow && !document.getElementById('dsh-right-preview')) {
      const rp = document.createElement('aside');
      rp.id = 'dsh-right-preview';
      rp.className = 'selectable-text';
      mainRow.appendChild(rp);
    }
    if (!IS_DSH_EMBED && !document.getElementById('dsh-composer-shell')) {
      const shell = document.createElement('footer');
      shell.id = 'dsh-composer-shell';
      shell.innerHTML = [
        '<div id="dsh-input-dock" class="hidden"></div>',
        '<div class="rounded-2xl border px-3 py-2 flex flex-col gap-1.5" style="background:var(--surface-soft);border-color:var(--border-strong);">',
        '  <div id="dsh-quote-row" class="flex flex-wrap items-center gap-1.5"></div>',
        '  <div class="flex items-center gap-2">',
        '    <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0" style="background:rgba(37,99,235,0.12);color:var(--primary);" data-tip="主对话担任 Super Agent，负责理解引用胶囊并指派后台工兵按开发流跑门禁">⛩ Super Agent</span>',
        '    <input id="dsh-sim-input" type="text" placeholder="发消息或指令（点卡片「❝ 引用」或 Alt+单击任意元素可累加多个蓝色引用胶囊）..." class="flex-1 min-w-0 bg-transparent text-xs outline-none" style="color:var(--text-main);">',
        '    <button type="button" id="dsh-sim-send" class="px-3 py-1 rounded-full text-xs font-semibold shrink-0" style="background:var(--primary);color:#fff;">↑ 发送</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(shell);
    }
    window.renderDshStandaloneShell = function renderDshStandaloneShell() {
      if (IS_DSH_EMBED) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'donegate-canvas', sessionId: DSH_SESSION_ID, type: 'dg:dock-sync', items: dshRuntime.dockItems }, '*');
        }
        return;
      }
      const qRow = document.getElementById('dsh-quote-row');
      if (qRow) {
        qRow.innerHTML = dshRuntime.quotes.map((q, idx) => (
          '<span class="dsh-quote-chip" data-tip="' + esc(q.summary.title + ' · ' + q.summary.detail) + '">' +
          '<span>“ ' + esc(q.summary.label) + '</span>' +
          '<button type="button" data-rm-quote="' + idx + '" aria-label="移除引用">×</button></span>'
        )).join('');
      }
      const dock = document.getElementById('dsh-input-dock');
      if (dock) {
        if (!dshRuntime.dockItems.length) {
          dock.className = 'hidden';
          dock.innerHTML = '';
        } else {
          const top = dshRuntime.dockItems[0];
          const isQ = top.kind === 'question';
          const exp = Boolean(dshRuntime.dockExpanded || isQ);
          dock.className = (exp ? 'is-expanded ' : '') + (isQ ? 'is-question' : '');
          const moreHtml = exp && dshRuntime.dockItems.length > 1
            ? '<div class="mt-1.5 pt-1 border-t text-[11px]" style="border-color:var(--border-subtle);color:var(--text-muted);">' +
              dshRuntime.dockItems.slice(1, 4).map((it) => '<div>· ' + esc(it.title) + '</div>').join('') + '</div>'
            : '';
          dock.innerHTML = '<div class="flex items-center justify-between gap-2">' +
            '<div class="' + (exp ? '' : 'truncate ') + 'flex-1"><b style="color:var(--primary);margin-right:6px;">' +
            (isQ ? '❓ 待你拍板' : '⚡ 完结门回执') + '</b>' + esc(top.title) + '</div>' +
            '<div class="flex items-center gap-1.5 shrink-0">' +
            (top.confirmBlankNodeId ? '<button type="button" class="dg-micro-btn" data-dock-confirm-blank="' + esc(top.confirmBlankNodeId) + '">套用门禁模块并继续</button>' : '') +
            (top.targetNodeId ? '<button type="button" class="dg-micro-btn" data-dock-fly="' + esc(top.targetNodeId) + '">🎯 飞去节点</button>' : '') +
            '<button type="button" class="dg-micro-btn" data-dock-dismiss="1">×</button>' +
            '</div></div>' + moreHtml;
        }
      }
      const rp = document.getElementById('dsh-right-preview');
      if (rp) {
        rp.classList.toggle('is-open', Boolean(dshRuntime.rightPreview.open));
        if (dshRuntime.rightPreview.open) {
          rp.innerHTML = '<div class="px-3 py-2 border-b flex items-center justify-between text-xs" style="border-color:var(--border-subtle);">' +
            '<span class="font-bold truncate">📄 右栏源码与改动预览 · ' + esc(dshRuntime.rightPreview.title) + '</span>' +
            '<button type="button" class="dg-micro-btn" data-close-rp="1">关闭</button></div>' +
            '<div class="px-3 py-1.5 text-[11px] font-mono border-b truncate" style="color:var(--primary);border-color:var(--border-subtle);">' + esc(dshRuntime.rightPreview.path) + '</div>' +
            '<pre class="flex-1 overflow-auto p-3 m-0 text-[11px] font-mono leading-relaxed" style="background:var(--surface-soft);color:var(--text-main);">' + esc(dshRuntime.rightPreview.diffText) + '</pre>';
        }
      }
    };
    function dispatchDshInstruction(rawPrompt) {
      const prompt = String(rawPrompt || '').trim();
      if (!prompt && !dshRuntime.quotes.length) return;
      const targets = dshRuntime.quotes.slice();
      dshRuntime.quotes = [];
      const inp = document.getElementById('dsh-sim-input');
      if (inp) inp.value = '';
      if (!targets.length) {
        dshRuntime.dockItems.unshift({
          id: 'dk-' + Date.now(),
          kind: 'receipt',
          title: '全局回执：已扫描当前「' + (state.page === 'workshop' ? WORKFLOW_PACKS[state.activePackId].name : REPO_SANDBOXES[state.viewingRepoId].name) + '」（鼠标悬停展开详情，移开自动折成一行）'
        });
        renderDshStandaloneShell();
        return;
      }
      const isAsk = /(解释|什么意思|干什么|用途|为什么|含义|\?|？)/.test(prompt);
      targets.forEach((t) => {
        if (t.isBlank && !isAsk) {
          dshRuntime.dockItems.unshift({
            id: 'q-' + Date.now(),
            kind: 'question',
            targetNodeId: t.id,
            confirmBlankNodeId: t.id,
            title: '「' + t.title + '」尚为空白待定节点，要先挂载确定性门禁模块再派工吗？'
          });
          return;
        }
        if (isAsk) {
          dshRuntime.anchors.set(t.key, {
            mode: 'explain', targetKind: t.kind, targetId: t.id, title: t.title,
            body: t.kind === 'wire'
              ? '此连线负责将上游产物契约化传递给下游，并在门禁未绿 (exit 1/2/3) 时按上限自动触发 fresh_ralph 干净上下文重试。'
              : '「' + t.title + '」受契约范围保护，仅允许被指派的工兵子代理在授权目录内写入并通过 0/1/2/3 退出码验真。'
          });
          return;
        }
        if (t.kind === 'button' && t.controlRef && /(红|绿|蓝|黄|琥珀|紫)/.test(prompt)) {
          const cname = prompt.includes('红') ? '#dc2626' : (prompt.includes('绿') ? '#16a34a' : (prompt.includes('琥珀') || prompt.includes('黄') ? '#d97706' : '#2563eb'));
          state.controlStyleOverrides[t.controlRef] = { color: cname };
          applyAllControlStyleOverrides();
          if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
        }
        dshRuntime.anchors.set(t.key, { mode: 'pill', tone: 'run', targetKind: t.kind, targetId: t.id, badge: '⚡ 改码验真 1/2' });
        renderDshCanvasAnchors();
        setTimeout(() => {
          dshRuntime.anchors.set(t.key, {
            mode: 'verdict', tone: 'ok', targetKind: t.kind, targetId: t.id,
            firstFile: t.firstFile,
            line1: '🟢 改好啦 · 门禁通过',
            line2: '🟢 门禁 3/3 · 📄 1 文件 (+14/-3)'
          });
          renderDshCanvasAnchors();
        }, 380);
      });
      if (targets.length > 1) {
        dshRuntime.dockItems.unshift({
          id: 'multi-' + Date.now(), kind: 'receipt', targetNodeId: targets[0].id,
          title: '批量派工已回传：共处理 ' + targets.length + ' 个引用目标，验真微卡已锚定至对应元素'
        });
      }
      renderDshCanvasAnchors();
      renderDshStandaloneShell();
    }
    const origRenderAll = window.renderAll || renderAll;
    renderAll = function patchedRenderAll() {
      origRenderAll();
      renderDshCanvasAnchors();
    };
    const dockEl = document.getElementById('dsh-input-dock');
    if (dockEl) {
      dockEl.addEventListener('mouseenter', () => { dshRuntime.dockExpanded = true; renderDshStandaloneShell(); });
      dockEl.addEventListener('mouseleave', () => { dshRuntime.dockExpanded = false; renderDshStandaloneShell(); });
    }
    document.addEventListener('pointerdown', (e) => {
      if (e.altKey && e.button === 0) {
        const btn = e.target.closest('button');
        const txt = e.target.closest('[data-sel-text]');
        const loopPill = e.target.closest('[data-loop-link]');
        const wireEl = e.target.closest('[data-link-id], [data-sb-link]');
        const cardEl = e.target.closest('[data-card-id]');
        const grpEl = e.target.closest('[data-drag-group], [data-group-id]');
        let q = null;
        if (btn && !btn.hasAttribute('data-dsh-quote')) {
          const lbl = (btn.textContent || btn.getAttribute('aria-label') || '按钮').trim();
          const ckey = btn.id ? ('id:' + btn.id) : ('tb:' + (btn.getAttribute('data-tb-act') || lbl));
          q = buildDshQuoteTarget({ kind: 'button', id: ckey, title: lbl, controlRef: ckey, desc: '界面控件按钮「' + lbl + '」' });
        } else if (loopPill || wireEl) {
          const lid = loopPill ? loopPill.getAttribute('data-loop-link') : (wireEl.getAttribute('data-link-id') || wireEl.getAttribute('data-sb-link'));
          q = buildDshQuoteTarget({ kind: 'wire', id: lid, title: '连线 ' + lid, desc: '画布上下游连线' });
        } else if (cardEl) {
          const nid = cardEl.getAttribute('data-card-id');
          const nd = getActiveNodesList().find((n) => n.id === nid);
          if (nd) {
            const meta = resolveNodeScopeMeta(nd);
            q = buildDshQuoteTarget({ kind: 'card', id: nd.id, title: nd.title, isBlank: Boolean(nd.isBlank), contracts: meta.contracts, scopes: meta.scopes, firstFile: meta.firstFile });
          }
        } else if (grpEl) {
          const gid = grpEl.getAttribute('data-drag-group') || grpEl.getAttribute('data-group-id');
          const g = getActiveGroupsList().find((x) => x.id === gid);
          if (g) q = buildDshQuoteTarget({ kind: 'group', id: g.id, title: g.title });
        } else if (txt) {
          const k = txt.getAttribute('data-sel-text');
          q = buildDshQuoteTarget({ kind: 'text', id: k, title: (txt.textContent || '').trim(), textKey: k });
        }
        if (q) { e.preventDefault(); e.stopPropagation(); emitDshQuote(q); return; }
      }
      if (!e.target.closest('.dg-micro-card, .dg-micro-pill, #ctx-root-menu')) {
        let closedExplain = false;
        dshRuntime.anchors.forEach((v, k) => { if (v.mode === 'explain') { dshRuntime.anchors.delete(k); closedExplain = true; } });
        if (closedExplain) renderDshCanvasAnchors();
      }
    }, true);
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-dsh-quote="selection"]')) { emitDshQuote(collectCurrentSelectionAsQuote()); return; }
      const dctx = e.target.closest('[data-dsh-ctx]');
      if (dctx) {
        const mode = dctx.getAttribute('data-dsh-ctx');
        if (mode === 'quote-card') {
          const nd = getActiveNodesList().find((n) => n.id === dctx.getAttribute('data-node'));
          if (nd) { const m = resolveNodeScopeMeta(nd); emitDshQuote(buildDshQuoteTarget({ kind: 'card', id: nd.id, title: nd.title, isBlank: Boolean(nd.isBlank), contracts: m.contracts, scopes: m.scopes, firstFile: m.firstFile })); }
        } else if (mode === 'preview-card') {
          const nd = getActiveNodesList().find((n) => n.id === dctx.getAttribute('data-node'));
          if (nd) { const m = resolveNodeScopeMeta(nd); openRightFilePreview(m.firstFile, nd.title); }
        } else if (mode === 'quote-wire') {
          const lid = dctx.getAttribute('data-link');
          emitDshQuote(buildDshQuoteTarget({ kind: 'wire', id: lid, title: '连线 ' + lid }));
        }
        closeCascadingMenus();
        return;
      }
      const wExp = e.target.closest('[data-wire-ctx="explain"]');
      if (wExp) {
        const lid = wExp.getAttribute('data-link');
        dshRuntime.anchors.set('wire:' + lid, { mode: 'explain', targetKind: 'wire', targetId: lid, title: '连线说明', body: '此连线传递上游确定性契约信号，门禁未通过时按回跳上限触发干净上下文修复。' });
        closeCascadingMenus(); renderDshCanvasAnchors(); return;
      }
      const rmQ = e.target.closest('[data-rm-quote]');
      if (rmQ) { dshRuntime.quotes.splice(Number(rmQ.getAttribute('data-rm-quote')), 1); renderDshStandaloneShell(); return; }
      const ancClose = e.target.closest('[data-anc-close]');
      if (ancClose) { dshRuntime.anchors.delete(ancClose.getAttribute('data-anc-close')); renderDshCanvasAnchors(); return; }
      const ancDiff = e.target.closest('[data-anc-diff]');
      if (ancDiff) { const a = dshRuntime.anchors.get(ancDiff.getAttribute('data-anc-diff')); if (a) openRightFilePreview(a.firstFile, a.line1); return; }
      const ancUndo = e.target.closest('[data-anc-undo]');
      if (ancUndo) { dshRuntime.anchors.delete(ancUndo.getAttribute('data-anc-undo')); if (typeof undoLastAction === 'function') undoLastAction(); renderDshCanvasAnchors(); return; }
      const ancPin = e.target.closest('[data-anc-pin-note]');
      if (ancPin) {
        const k = ancPin.getAttribute('data-anc-pin-note'); const a = dshRuntime.anchors.get(k);
        const nd = a ? getActiveNodesList().find((n) => n.id === a.targetId) : null;
        if (nd && a) { nd.tip = a.body; showToast('📌 已存入「' + nd.title + '」节点悬停备注'); }
        dshRuntime.anchors.delete(k); renderDshCanvasAnchors(); return;
      }
      if (e.target.closest('[data-dock-dismiss]')) { dshRuntime.dockItems.shift(); renderDshStandaloneShell(); return; }
      const flyBtn = e.target.closest('[data-dock-fly]');
      if (flyBtn) { flyCanvasToNode(flyBtn.getAttribute('data-dock-fly')); return; }
      const blankBtn = e.target.closest('[data-dock-confirm-blank]');
      if (blankBtn) {
        const nid = blankBtn.getAttribute('data-dock-confirm-blank');
        const nd = getActiveNodesList().find((n) => n.id === nid);
        if (nd) { nd.isBlank = false; nd.title = '确定性门禁节点'; nd.sub = 'mortar_gate · exit 0/1/2/3'; }
        dshRuntime.dockItems.shift(); renderAll(); renderDshStandaloneShell(); showToast('✓ 已挂载确定性门禁模块'); return;
      }
      if (e.target.closest('[data-close-rp]')) { dshRuntime.rightPreview.open = false; renderDshStandaloneShell(); return; }
      if (e.target.closest('#dsh-sim-send')) { const inp = document.getElementById('dsh-sim-input'); dispatchDshInstruction(inp ? inp.value : ''); }
    });
    const simInp = document.getElementById('dsh-sim-input');
    if (simInp) simInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dispatchDshInstruction(simInp.value); } });
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'dg:focus-node' && d.nodeId) flyCanvasToNode(String(d.nodeId));
    });
    if (/^https?:$/i.test(location.protocol) && typeof EventSource === 'function') {
      try {
        const es = new EventSource('/donegate/api/events?sessionId=' + encodeURIComponent(DSH_SESSION_ID));
        es.addEventListener('pulse', (ev) => {
          try {
            const p = JSON.parse(ev.data || '{}');
            if (p.nodeId) {
              dshRuntime.anchors.set('card:' + p.nodeId, p.status === 'passed'
                ? { mode: 'verdict', tone: 'ok', targetKind: 'card', targetId: p.nodeId, firstFile: 'runner/donegate.mjs', line1: '🟢 门禁通过 · 已改好', line2: p.badgeText || '🟢 exit 0' }
                : { mode: 'pill', tone: p.status === 'failed' ? 'bad' : 'run', targetKind: 'card', targetId: p.nodeId, badge: p.badgeText || '⚡ 执行中' });
              renderDshCanvasAnchors();
            }
          } catch (err) { void err; }
        });
        es.onerror = () => { try { es.close(); } catch (err) { void err; } };
      } catch (err) { void err; }
    }
    renderDshStandaloneShell();
    renderDshCanvasAnchors();
  };
  return `(${fn.toString()})();`;
}
