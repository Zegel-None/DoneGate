// DSH 全屏沉浸式外壳装配、Alt+单击拾取监听、卡包抽卡式零缝隙主对话复刻抽屉与实时明暗主题同步（零外网依赖）
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
        '<div id="dsh-input-dock"></div>',
        '<div id="dsh-standalone-card">',
        '  <div id="dsh-quote-row" class="flex flex-wrap items-center gap-1.5"></div>',
        '  <div class="flex items-center gap-2.5">',
        '    <input id="dsh-sim-input" type="text" placeholder="发消息或创建任务，/ 调用指令，@ 文件或对话" class="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none" style="color:var(--text-main);">',
        '    <button type="button" id="dsh-sim-send" class="w-7 h-7 rounded-full inline-flex items-center justify-center shrink-0" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);" aria-label="发送">',
        '      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8.31 0.98c.36.07.67.22.95.45.22.18.47.43.72.68l4.73 4.72-1.42 1.42L9 3.96v11.08H7V3.96L2.71 8.25 1.29 6.83l4.73-4.72c.25-.25.49-.5.72-.68.24-.19.54-.39.95-.45.21-.03.41-.02.62 0Z"/></svg>',
        '    </button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(shell);
    }

    function saveSimPref(k, v) {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, String(v)); } catch (err) { void err; }
    }

    window.renderDshStandaloneShell = function renderDshStandaloneShell() {
      if (IS_DSH_EMBED) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: 'donegate-canvas',
            sessionId: DSH_SESSION_ID,
            type: 'dg:dock-sync',
            items: dshRuntime.dockItems,
            messages: dshRuntime.chatHistory
          }, '*');
        }
        return;
      }
      const qRow = document.getElementById('dsh-quote-row');
      if (qRow) {
        qRow.innerHTML = dshRuntime.quotes.map((q, idx) => (
          '<span class="dsh-quote-chip" data-tip="' + esc(q.summary.title + ' · ' + q.summary.detail) + '">' +
          '<span>' + esc(q.summary.label) + '</span>' +
          '<button type="button" data-rm-quote="' + idx + '" aria-label="移除引用">×</button></span>'
        )).join('');
      }
      const dock = document.getElementById('dsh-input-dock');
      if (dock) {
        const top = dshRuntime.dockItems[0] || null;
        const isQ = Boolean(top && (top.kind === 'question' || top.kind === 'blocked'));
        const exp = Boolean(dshRuntime.dockPinned || dshRuntime.dockExpanded || dshRuntime.isResizingDock || isQ);
        const hPx = Math.max(128, Math.min(640, Number(dshRuntime.dockHeight || 280)));
        const agName = String(dshRuntime.agentName || 'Agent');
        dock.style.height = ((exp ? hPx : 34) + 28) + 'px';
        dock.className = (exp ? 'is-expanded ' : '') + (dshRuntime.isResizingDock ? 'is-dragging ' : '') + (isQ ? 'is-question' : '');

        let latestAgentTxt = '';
        for (let i = dshRuntime.chatHistory.length - 1; i >= 0; i--) {
          if (dshRuntime.chatHistory[i] && dshRuntime.chatHistory[i].role === 'assistant' && dshRuntime.chatHistory[i].text) {
            latestAgentTxt = String(dshRuntime.chatHistory[i].text).replace(/\s+/g, ' ').trim();
            break;
          }
        }
        if (!latestAgentTxt && top && top.title) latestAgentTxt = String(top.title).trim();

        const prefixHtml = dshRuntime.editingAgentName
          ? '<input id="dg-sim-agent-name-inp" type="text" value="' + esc(agName) + '" class="px-1.5 py-0.5 rounded text-xs font-semibold outline-none" style="width:88px;background:var(--bg);color:var(--text-main);border:0.5px solid var(--border-strong);">'
          : '<span data-dg-rename-agent="1" title="双击可给 Agent 改名（如：小小张）" class="font-semibold shrink-0 select-none cursor-text" style="color:var(--text-main);">' + esc(agName) + '：</span>';

        if (exp) {
          const pinBtn = '<button type="button" data-dg-toggle-pin="1" style="position:absolute;top:8px;right:12px;z-index:8;height:24px;padding:0 9px;border-radius:8px;font-size:11.5px;font-weight:500;cursor:pointer;border:0.5px solid var(--border-strong);background:' + (dshRuntime.dockPinned ? 'var(--btn-primary-bg)' : 'var(--surface-soft)') + ';color:' + (dshRuntime.dockPinned ? 'var(--btn-primary-fg)' : 'var(--text-secondary)') + ';">📌 ' + (dshRuntime.dockPinned ? '已固定' : '固定') + '</button>';
          const resizeGrip = '<div data-dg-sim-resize="1" title="上下拖动调整窗口高度（自动记忆）" style="position:absolute;top:0;left:0;right:0;height:10px;cursor:ns-resize;z-index:7;display:flex;align-items:center;justify-content:center;"><span style="width:32px;height:3px;border-radius:999px;background:var(--text-muted);opacity:0.35;"></span></div>';
          const turnsHtml = dshRuntime.chatHistory.length
            ? dshRuntime.chatHistory.map((m) => (
              m.role === 'user'
                ? '<div class="dsh-chat-bubble is-user">' + esc(m.text) + '</div>'
                : '<div class="dsh-chat-bubble is-agent"><div class="mb-0.5">' + prefixHtml + '</div><div style="white-space:pre-wrap;">' + esc(m.text) + '</div></div>'
            )).join('')
            : '<div class="text-xs py-1" style="color:var(--text-muted);">暂无历史对话，直接在下方输入框发送消息即可开始协作。</div>';

          dock.innerHTML = resizeGrip + pinBtn +
            '<div id="dg-sim-chat-scroll" class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3 flex flex-col gap-3">' +
            turnsHtml +
            (top && top.targetNodeId ? '<div class="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-lg" style="background:var(--surface-soft);color:var(--text-secondary);"><span class="truncate">' + esc(top.title) + '</span><button type="button" class="dg-micro-btn shrink-0" data-dock-fly="' + esc(top.targetNodeId) + '">定位节点</button></div>' : '') +
            '</div>';
          const sc = document.getElementById('dg-sim-chat-scroll');
          if (sc) sc.scrollTop = sc.scrollHeight;
        } else {
          const isLong = latestAgentTxt.length > 40;
          dock.innerHTML = '<div style="height:34px;padding:0 16px;display:flex;align-items:center;gap:4px;font-size:13px;overflow:hidden;">' +
            prefixHtml +
            '<div class="dg-sim-pop flex-1 min-w-0 overflow-hidden whitespace-nowrap" style="color:' + (latestAgentTxt ? 'var(--text-secondary)' : 'var(--text-muted)') + ';">' +
            '<span class="' + (isLong ? 'dg-sim-marquee' : '') + '">' + esc(latestAgentTxt || '等待新消息…') + '</span></div></div>';
        }
        if (dshRuntime.editingAgentName) {
          const ni = document.getElementById('dg-sim-agent-name-inp');
          if (ni) {
            ni.focus();
            ni.select();
            const commit = () => {
              const nv = String(ni.value || '').trim().slice(0, 24) || 'Agent';
              dshRuntime.agentName = nv;
              dshRuntime.editingAgentName = false;
              saveSimPref('dg_dsh_agent_name', nv);
              renderDshStandaloneShell();
            };
            ni.onblur = commit;
            ni.onkeydown = (ke) => {
              ke.stopPropagation();
              if (ke.key === 'Enter') commit();
              else if (ke.key === 'Escape') { dshRuntime.editingAgentName = false; renderDshStandaloneShell(); }
            };
          }
        }
      }
      const rp = document.getElementById('dsh-right-preview');
      if (rp) {
        rp.classList.toggle('is-open', Boolean(dshRuntime.rightPreview.open));
        if (dshRuntime.rightPreview.open) {
          rp.innerHTML = '<div class="px-3 py-2 border-b flex items-center justify-between text-xs" style="border-color:var(--border-subtle);">' +
            '<span class="font-semibold truncate">源码与改动预览 · ' + esc(dshRuntime.rightPreview.title) + '</span>' +
            '<button type="button" class="dg-micro-btn" data-close-rp="1">关闭</button></div>' +
            '<div class="px-3 py-1.5 text-[11px] font-mono border-b truncate" style="color:var(--text-secondary);border-color:var(--border-subtle);">' + esc(dshRuntime.rightPreview.path) + '</div>' +
            '<pre class="flex-1 overflow-auto p-3 m-0 text-[11px] font-mono leading-relaxed" style="background:var(--surface-soft);color:var(--text-main);">' + esc(dshRuntime.rightPreview.diffText) + '</pre>';
        }
      }
    };

    function dispatchDshInstruction(rawPrompt) {
      const prompt = String(rawPrompt || '').trim();
      if (!prompt && !dshRuntime.quotes.length) return;
      const targets = dshRuntime.quotes.slice();
      const quoteTagStr = targets.map((t) => t.summary.label).join(' ');
      dshRuntime.chatHistory.push({
        id: 'u-' + Date.now(),
        role: 'user',
        text: (quoteTagStr ? quoteTagStr + ' ' : '') + (prompt || '执行改码与门禁验真')
      });
      dshRuntime.quotes = [];
      const inp = document.getElementById('dsh-sim-input');
      if (inp) inp.value = '';
      if (!targets.length) {
        const scopeTitle = state.page === 'workshop' ? WORKFLOW_PACKS[state.activePackId].name : (state.page === 'uiboard' ? 'UI 看板实时舞台' : REPO_SANDBOXES[state.viewingRepoId].name);
        const reply = '已扫描当前「' + scopeTitle + '」并对齐确定性门禁状态。';
        dshRuntime.chatHistory.push({ id: 'a-' + Date.now(), role: 'assistant', text: reply });
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
          const cname = prompt.includes('红') ? '#dc2626' : (prompt.includes('绿') ? '#16a34a' : (prompt.includes('琥珀') || prompt.includes('黄') ? '#d97706' : '#3f3f46'));
          state.controlStyleOverrides[t.controlRef] = { color: cname };
          applyAllControlStyleOverrides();
          if (typeof recordHistoryCheckpoint === 'function') recordHistoryCheckpoint();
        }
        dshRuntime.anchors.set(t.key, { mode: 'pill', tone: 'run', targetKind: t.kind, targetId: t.id, badge: '改码验真中 · 1/2' });
        renderDshCanvasAnchors();
        setTimeout(() => {
          dshRuntime.anchors.set(t.key, {
            mode: 'verdict', tone: 'ok', targetKind: t.kind, targetId: t.id,
            firstFile: t.firstFile,
            line1: '🟢 门禁通过 · 已改好',
            line2: '门禁 3/3 · 1 文件 (+14/-3)'
          });
          renderDshCanvasAnchors();
        }, 380);
      });
      dshRuntime.chatHistory.push({
        id: 'a-' + Date.now(),
        role: 'assistant',
        text: isAsk
          ? '已在对应元素上方挂出契约与职责说明。'
          : '已对 ' + targets.map((t) => '「' + t.title + '」').join('、') + ' 完成改码并通过确定性门禁验真。'
      });
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
      dockEl.addEventListener('mouseleave', () => {
        if (!dshRuntime.editingAgentName && !dshRuntime.isResizingDock) {
          dshRuntime.dockExpanded = false;
          renderDshStandaloneShell();
        }
      });
      dockEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
      dockEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-dg-rename-agent]')) {
          e.preventDefault();
          e.stopPropagation();
          dshRuntime.editingAgentName = true;
          renderDshStandaloneShell();
        }
      });
      dockEl.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('[data-dg-sim-resize]')) return;
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startH = Number(dshRuntime.dockHeight || 280);
        dshRuntime.isResizingDock = true;
        dockEl.classList.add('is-dragging');
        const onMove = (ev) => {
          const nextH = Math.max(128, Math.min(640, Math.round(startH + (startY - ev.clientY))));
          dshRuntime.dockHeight = nextH;
          dockEl.style.height = (nextH + 28) + 'px';
        };
        const onUp = () => {
          dshRuntime.isResizingDock = false;
          dockEl.classList.remove('is-dragging');
          saveSimPref('dg_dsh_dock_height', dshRuntime.dockHeight || 280);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
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
      if (e.target.closest('[data-dg-toggle-pin]')) {
        e.preventDefault();
        e.stopPropagation();
        dshRuntime.dockPinned = !dshRuntime.dockPinned;
        saveSimPref('dg_dsh_dock_pinned', dshRuntime.dockPinned ? '1' : '0');
        renderDshStandaloneShell();
        return;
      }
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
        if (nd) { nd.isBlank = false; nd.title = '确定性门禁节点'; nd.sub = 'adapter_gate · exit 0/1/2/3'; }
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
      if (d.type === 'dg:agent-name-sync' && d.agentName) {
        dshRuntime.agentName = String(d.agentName);
        saveSimPref('dg_dsh_agent_name', dshRuntime.agentName);
        renderDshStandaloneShell();
      }
      if (d.type === 'dg:theme-sync' && (d.theme === 'dark' || d.theme === 'light') && state.theme !== d.theme) {
        state.theme = d.theme;
        applyThemeClasses(d.theme);
      }
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
