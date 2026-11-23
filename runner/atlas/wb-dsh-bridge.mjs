// DSH 原生引用胶囊编码（含 uiOwner / sliceCmd 直达路由）、Alt+单击全元素拾取、画布跟随微卡与源码预览联动桥
const WB_DSH_BRIDGE_SCRIPT = `
const DSH_URL_PARAMS = (() => {
  try { return new URLSearchParams(window.location.search || ''); } catch (err) { void err; return new URLSearchParams(); }
})();
const IS_DSH_EMBED = DSH_URL_PARAMS.get('dsh') === '1';
const DSH_SESSION_ID = DSH_URL_PARAMS.get('sessionId') || 'default';

const dshRuntime = {
  quotes: [],
  anchors: new Map(),
  dockItems: [],
  chatHistory: [],
  agentName: (typeof localStorage !== 'undefined' && localStorage.getItem('dg_dsh_agent_name')) || 'Agent',
  dockPinned: (typeof localStorage !== 'undefined' && localStorage.getItem('dg_dsh_dock_pinned') === '1'),
  dockHeight: Number((typeof localStorage !== 'undefined' && localStorage.getItem('dg_dsh_dock_height')) || 280),
  dockExpanded: false,
  rightPreview: { open: false, title: '', path: '', diffText: '' }
};

function clipLabelText(str, maxLen) {
  const s = String(str || '').replace(/\\s+/g, ' ').trim();
  if (!s) return '未命名元素';
  return s.length > maxLen ? s.slice(0, Math.max(1, maxLen - 1)) + '…' : s;
}

function resolveNodeScopeMeta(node) {
  if (!node) return { contracts: [], scopes: [], firstFile: 'runner/donegate.mjs' };
  const folders = typeof resolveNodeFolders === 'function' ? resolveNodeFolders(node) : [];
  const rawScopes = [
    ...(Array.isArray(node.scopePaths) ? node.scopePaths : []),
    ...folders.map((f) => f.dir)
  ].filter(Boolean);
  const dedupScopes = [...new Set(rawScopes)].slice(0, 4);
  const modPath = (node.entryPath) || (Array.isArray(node.modules) && node.modules[0] && node.modules[0].path) || '';
  const folderFile = (folders[0] && folders[0].file && !String(folders[0].file).includes('anti-slop')) ? folders[0].file : '';
  const firstFile = modPath || folderFile || (node.tplId === 'tpl-anti-slop' || node.id === 'n-guard' ? 'skill/check-commit-hygiene.mjs' : 'runner/donegate.mjs');
  const contracts = (Array.isArray(node.contractIds) && node.contractIds.length)
    ? node.contractIds
    : ((Array.isArray(node.contracts) && node.contracts.length)
        ? node.contracts
        : (node.primaryContractId ? [node.primaryContractId] : (node.contractId ? [node.contractId] : ['verdict-core'])));
  const scopes = dedupScopes.length ? dedupScopes : contracts;
  return { contracts, scopes, firstFile };
}

function fallbackUiOwnerByKind(kind) {
  if (kind === 'card' || kind === 'multi' || kind === 'group') return 'runner/atlas/wb-render-cards.mjs';
  if (kind === 'wire') return 'runner/atlas/wb-render-wires.mjs';
  if (kind === 'ui') return 'runner/atlas/wb-uiboard.mjs';
  if (kind === 'workflow' || kind === 'project') return 'runner/atlas/wb-layout-tidy.mjs';
  return 'runner/atlas/ui-shell.mjs';
}

function buildDshQuoteTarget(rawTarget) {
  if (!rawTarget || !rawTarget.id) return null;
  const kindMap = {
    card: '卡片',
    multi: '多选',
    group: '组合框',
    wire: '连线',
    text: '文本',
    button: '按钮',
    ui: 'UI元素',
    workflow: '工作流',
    project: '项目'
  };
  const kindCn = kindMap[rawTarget.kind] || '元素';
  const shortName = clipLabelText(rawTarget.title, 18);
  const chipLabel = \`[\${kindCn}] \${shortName}\`;
  const uri = \`dg://\${state.page}/\${rawTarget.kind}/\${encodeURIComponent(String(rawTarget.id))}\`;
  const contracts = (rawTarget.contracts || []).join(',') || '-';
  const scopes = (rawTarget.scopes || []).join(',') || '-';
  const resolvedOwner = rawTarget.uiOwner
    || ((typeof window !== 'undefined' && typeof window.resolveUiOwner === 'function')
        ? window.resolveUiOwner(rawTarget.el || null, rawTarget)
        : fallbackUiOwnerByKind(rawTarget.kind));
  const uiOwner = String(resolvedOwner || fallbackUiOwnerByKind(rawTarget.kind)).replace(/\\\\/g, '/');
  const sliceCmd = rawTarget.sliceCmd || (uiOwner.startsWith('runner/dsh/')
    ? \`node runner/donegate.mjs slice dsh-orchestrator --focus \${uiOwner}\`
    : \`node runner/donegate.mjs slice atlas-workbench --focus \${uiOwner}\`);
  const summary = {
    label: chipLabel,
    title: uri,
    detail: scopes !== '-' ? \`契约范围: \${scopes} · UI归属: \${uiOwner}\` : \`UI归属: \${uiOwner}\`,
    body: rawTarget.desc || \`\${kindCn}「\${rawTarget.title}」\`
  };
  const text = \`[DG-TARGET uri=\${uri} | kind=\${rawTarget.kind} | id=\${rawTarget.id} | label=\${shortName} | contracts=\${contracts} | scopes=\${scopes} | uiOwner=\${uiOwner} | sliceCmd=\${JSON.stringify(sliceCmd)}]\`;
  return {
    key: \`\${rawTarget.kind}:\${rawTarget.id}\`,
    kind: rawTarget.kind,
    id: rawTarget.id,
    title: rawTarget.title,
    firstFile: rawTarget.firstFile || 'runner/donegate.mjs',
    isBlank: Boolean(rawTarget.isBlank),
    controlRef: rawTarget.controlRef || null,
    textKey: rawTarget.textKey || null,
    uiOwner,
    sliceCmd,
    summary,
    text
  };
}

function collectCurrentSelectionAsQuote() {
  const sel = getSelectionInfo();
  if (sel.kind === 'single' && sel.node) {
    const meta = resolveNodeScopeMeta(sel.node);
    const cardDom = typeof document !== 'undefined' ? document.getElementById('card-' + sel.node.id) : null;
    return buildDshQuoteTarget({
      kind: 'card', id: sel.node.id, title: sel.node.title, isBlank: Boolean(sel.node.isBlank),
      contracts: meta.contracts, scopes: meta.scopes, firstFile: meta.firstFile,
      el: cardDom, uiOwner: 'runner/atlas/wb-render-cards.mjs',
      desc: sel.node.tip || sel.node.sub || '画布业务/工作流节点'
    });
  }
  if (sel.kind === 'multi' && sel.nodes && sel.nodes.length) {
    const names = sel.nodes.slice(0, 3).map((n) => n.title).join('、');
    const meta = resolveNodeScopeMeta(sel.nodes[0]);
    const cardDom = typeof document !== 'undefined' ? document.getElementById('card-' + sel.nodes[0].id) : null;
    return buildDshQuoteTarget({
      kind: 'multi', id: sel.nodes.map((n) => n.id).join('+'),
      title: \`\${sel.nodes.length}张卡片(\${names})\`,
      contracts: meta.contracts, scopes: meta.scopes, firstFile: meta.firstFile,
      el: cardDom, uiOwner: 'runner/atlas/wb-render-cards.mjs',
      desc: \`批量选中 \${sel.nodes.length} 张卡片\`
    });
  }
  if (sel.kind === 'group' && sel.group) {
    const grpDom = typeof document !== 'undefined' ? document.getElementById('group-' + sel.group.id) : null;
    return buildDshQuoteTarget({
      kind: 'group', id: sel.group.id, title: sel.group.title,
      el: grpDom, uiOwner: 'runner/atlas/wb-render-cards.mjs',
      desc: \`包含 \${(sel.group.memberIds || []).length} 个内部节点的组合框\`
    });
  }
  if ((sel.kind === 'link' || sel.kind === 'sb-link') && sel.link) {
    const label = sel.src && sel.dst
      ? (sel.src.id === sel.dst.id ? \`\${sel.src.title} 自循环\` : \`\${sel.src.title} → \${sel.dst.title}\`)
      : sel.link.id;
    return buildDshQuoteTarget({
      kind: 'wire', id: sel.link.id, title: label,
      uiOwner: 'runner/atlas/wb-render-wires.mjs',
      desc: sel.link.maxLoops ? \`循环回跳上限 \${sel.link.maxLoops} 次\` : '上下游信号与契约数据连线'
    });
  }
  if (state.selectedTextItem) {
    const txtDom = (typeof document !== 'undefined' && document.querySelector)
      ? document.querySelector('[data-sel-text="' + state.selectedTextItem.key + '"]')
      : null;
    return buildDshQuoteTarget({
      kind: 'text', id: state.selectedTextItem.key, title: state.selectedTextItem.text,
      el: txtDom,
      textKey: state.selectedTextItem.key, desc: \`界面可编辑文本 (\${state.selectedTextItem.key})\`
    });
  }
  return null;
}

function emitDshQuote(quoteObj) {
  if (!quoteObj) {
    showToast('请先点选卡片、连线、组合框，或按住 Alt 单击任意按钮');
    return;
  }
  if (IS_DSH_EMBED && window.parent && window.parent !== window) {
    window.parent.postMessage({
      source: 'donegate-canvas',
      sessionId: DSH_SESSION_ID,
      type: 'dg:insert-quote',
      text: quoteObj.text,
      summary: quoteObj.summary
    }, '*');
    showToast('❝ 已引用至底部输入框：' + quoteObj.summary.label);
    return;
  }
  if (!dshRuntime.quotes.some((q) => q.key === quoteObj.key)) {
    dshRuntime.quotes.push(quoteObj);
  }
  if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
  const inp = document.getElementById('dsh-sim-input');
  if (inp) inp.focus();
  showToast('❝ 已累加蓝色引用胶囊：' + quoteObj.summary.label);
}

function openRightFilePreview(filePath, title, customDiff) {
  const cleanFile = String(filePath || 'runner/donegate.mjs').replace(/^\\/+/, '');
  const dshAddr = \`dsh-resource://file/session/\${encodeURIComponent(DSH_SESSION_ID)}/\${cleanFile}\`;
  if (IS_DSH_EMBED && window.parent && window.parent !== window) {
    window.parent.postMessage({
      source: 'donegate-canvas',
      sessionId: DSH_SESSION_ID,
      type: 'dg:open-right-file',
      address: dshAddr
    }, '*');
    showToast('👁 已打开关联源码预览：' + cleanFile);
    return;
  }
  dshRuntime.rightPreview = {
    open: true,
    title: title || cleanFile,
    path: cleanFile,
    diffText: customDiff || [
      \`// 完结门契约绑定文件预览：\${cleanFile}\`,
      \`// DSH 源码预览协议地址：\${dshAddr}\`,
      '@@ -14,6 +14,11 @@ export async function runGateStep(ctx) {',
      '-  const timeoutMs = 5000;',
      '+  const timeoutMs = Number(ctx.timeoutMs || 10000);',
      '+  const verdict = await verifyDeterministicGate(ctx);',
      '+  if (verdict.exitCode !== 0) return { ok: false, exitCode: verdict.exitCode };',
      '   return { ok: true, exitCode: 0 };',
      ' }'
    ].join('\\n')
  };
  if (typeof renderDshStandaloneShell === 'function') renderDshStandaloneShell();
}

function resolveAnchorWorldPoint(anchor) {
  if (anchor.targetKind === 'card' || anchor.targetKind === 'multi') {
    const firstId = String(anchor.targetId || '').split('+')[0];
    const el = document.getElementById(\`card-\${firstId}\`);
    if (el) return { x: Math.round(el.offsetLeft + el.offsetWidth / 2), y: Math.max(12, el.offsetTop - 8) };
    const nd = getActiveNodesList().find((n) => n.id === firstId);
    if (nd) return { x: Math.round((nd.x || 0) + (nd.w || 252) / 2), y: Math.round((nd.y || 0) - 8) };
  }
  if (anchor.targetKind === 'group') {
    const grpEl = document.getElementById(\`group-\${anchor.targetId}\`);
    if (grpEl) return { x: Math.round(grpEl.offsetLeft + grpEl.offsetWidth / 2), y: grpEl.offsetTop - 8 };
  }
  if (anchor.targetKind === 'wire') {
    const pill = document.querySelector(\`[data-loop-link="\${anchor.targetId}"]\`);
    if (pill) return { x: pill.offsetLeft, y: pill.offsetTop - 14 };
    const graph = state.page === 'workshop' ? getActiveWorkshopGraph() : getActiveSandboxGraph();
    const lk = (graph.links || []).find((l) => l.id === anchor.targetId);
    if (lk) {
      const s = getActiveNodesList().find((n) => n.id === (lk.from || lk.src));
      const d = getActiveNodesList().find((n) => n.id === (lk.to || lk.dst));
      if (s && d) return { x: Math.round(((s.x || 0) + (d.x || 0)) / 2 + 120), y: Math.round(((s.y || 0) + (d.y || 0)) / 2 + 20) };
    }
  }
  return { x: Math.round((-state.panX + 420) / state.scale), y: Math.round((-state.panY + 180) / state.scale) };
}

function renderDshCanvasAnchors() {
  const layer = document.getElementById('dsh-anchors-layer');
  if (!layer) return;
  const html = [];
  dshRuntime.anchors.forEach((anc, key) => {
    const pt = resolveAnchorWorldPoint(anc);
    if (anc.mode === 'pill') {
      const cls = anc.tone === 'ok' ? 'is-ok' : (anc.tone === 'bad' ? 'is-bad' : 'is-running');
      html.push(\`<div class="dg-micro-pill \${cls}" style="left:\${pt.x}px;top:\${pt.y}px;" data-anc-click="\${esc(key)}">\${esc(clipLabelText(anc.badge, 14))}</div>\`);
    } else if (anc.mode === 'explain') {
      html.push(\`
        <div class="dg-micro-card tone-info" style="left:\${pt.x}px;top:\${pt.y}px;" data-stop-drag="1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-[11.5px]" style="color:var(--primary);">💡 \${esc(clipLabelText(anc.title, 18))}</span>
            <button type="button" class="dg-micro-btn" data-anc-close="\${esc(key)}">×</button>
          </div>
          <div class="text-[11px]" style="color:var(--text-secondary);">\${esc(anc.body || '')}</div>
          <div class="flex items-center justify-end gap-1.5 pt-0.5">
            \${anc.targetKind === 'card' ? \`<button type="button" class="dg-micro-btn" data-anc-pin-note="\${esc(key)}">📌 存入节点备注</button>\` : ''}
          </div>
        </div>
      \`);
    } else {
      const toneCls = anc.tone === 'bad' ? 'tone-bad' : 'tone-ok';
      html.push(\`
        <div class="dg-micro-card \${toneCls}" style="left:\${pt.x}px;top:\${pt.y}px;" data-stop-drag="1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-[11.5px]">\${esc(clipLabelText(anc.line1 || '🟢 门禁通过 · 已改好', 22))}</span>
            <button type="button" class="dg-micro-btn" data-anc-close="\${esc(key)}">×</button>
          </div>
          <div class="flex items-center justify-between gap-1.5 flex-wrap text-[10.5px]" style="color:var(--text-secondary);">
            <span>\${esc(anc.line2 || '🟢 门禁 3/3 · 📄 1 文件 (+12/-3)')}</span>
            <span class="inline-flex items-center gap-1">
              <button type="button" class="dg-micro-btn" data-anc-diff="\${esc(key)}">👁 查看改动</button>
              <button type="button" class="dg-micro-btn" data-anc-undo="\${esc(key)}">↩ 撤销</button>
            </span>
          </div>
        </div>
      \`);
    }
  });
  layer.innerHTML = html.join('');
}

function flyCanvasToNode(nodeId) {
  const nd = getActiveNodesList().find((n) => n.id === nodeId);
  if (!nd) return;
  const stage = document.getElementById('canvas-stage');
  const rect = stage ? stage.getBoundingClientRect() : { width: 900, height: 600 };
  state.scale = Math.max(0.75, Math.min(1.15, state.scale || 1));
  state.panX = Math.round(rect.width / 2 - ((nd.x || 0) + (nd.w || 252) / 2) * state.scale);
  state.panY = Math.round(rect.height / 2 - ((nd.y || 0) + 90) * state.scale);
  state.selectedNodeIds.clear();
  state.selectedNodeIds.add(nd.id);
  renderAll();
  renderDshCanvasAnchors();
}
`;

export function buildWbDshBridge() {
  return WB_DSH_BRIDGE_SCRIPT;
}
