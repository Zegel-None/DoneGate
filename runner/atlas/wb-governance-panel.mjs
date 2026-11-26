// 工作台「默认极简治理开关清单 + AI 提案确认卡 + 动态 configSchema 调参 + 高级画布入口」前端面板
const WB_GOVERNANCE_PANEL_SCRIPT = String.raw`
(function initDoneGateGovernancePanel() {
  const GOV_STYLE_ID = 'dg-gov-panel-styles';
  if (typeof document !== 'undefined' && !document.getElementById(GOV_STYLE_ID)) {
    const st = document.createElement('style');
    st.id = GOV_STYLE_ID;
    st.textContent = [
      '.dg-gov-fab { position: fixed; right: 18px; bottom: 18px; z-index: 220; display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-main); font-size: 12px; font-weight: 600; box-shadow: 0 6px 18px rgba(0,0,0,0.14); cursor: pointer; }',
      '.dg-gov-fab.is-danger { border-color: #dc2626; color: #dc2626; background: #fef2f2; }',
      '.dg-gov-backdrop { position: fixed; inset: 0; z-index: 280; background: rgba(0,0,0,0.45); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 16px; }',
      '.dg-gov-modal { width: min(760px, 96vw); max-height: 88vh; overflow-y: auto; border-radius: 18px; background: var(--surface); color: var(--text-main); border: 1px solid var(--border-strong); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }',
      '.dg-gov-banner-red { padding: 10px 12px; border-radius: 10px; border: 1.5px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 12px; font-weight: 600; }',
      '.dg-gov-banner-info { padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface-soft); font-size: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }',
      '.dg-gov-group { border: 1px solid var(--border-subtle); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }',
      '.dg-gov-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 8px; border-radius: 8px; background: var(--surface-soft); font-size: 12px; }',
      '.dg-gov-tag { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 6px; font-size: 10.5px; font-weight: 600; }',
      '.dg-gov-tag.integrity { background: #fee2e2; color: #b91c1c; }',
      '.dg-gov-tag.recommended { background: #dbeafe; color: #1d4ed8; }',
      '.dg-gov-tag.optional { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border-subtle); }',
      '.dg-gov-btn { padding: 5px 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-main); font-size: 11.5px; cursor: pointer; }',
      '.dg-gov-btn.primary { background: var(--primary); color: #fff; border-color: transparent; }',
      '.dg-gov-cfg { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px dashed var(--border-strong); display: flex; flex-direction: column; gap: 6px; font-size: 11.5px; }'
    ].join('\n');
    document.head.appendChild(st);
  }
})();

const dgGovUiState = {
  open: false,
  summary: (typeof ATLAS !== 'undefined' && ATLAS && ATLAS.workbench && ATLAS.workbench.governance) ? ATLAS.workbench.governance : null,
  trustSuggestion: null,
  templates: [],
  expandedNodeKey: '',
  busy: false
};

function dgGovEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dgGovSyncFab() {
  if (typeof document === 'undefined') return;
  let btn = document.getElementById('dg-gov-fab-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'dg-gov-fab-btn';
    btn.type = 'button';
    btn.className = 'dg-gov-fab';
    btn.setAttribute('data-ui-owner', 'runner/atlas/wb-governance-panel.mjs');
    btn.addEventListener('click', () => { window.openGovernancePanel(); });
    document.body.appendChild(btn);
  }
  const s = dgGovUiState.summary;
  const disCnt = (s && s.disclosure && s.disclosure.count) || 0;
  const propCnt = (s && Array.isArray(s.pendingProposals)) ? s.pendingProposals.length : 0;
  btn.classList.toggle('is-danger', disCnt > 0);
  btn.textContent = disCnt > 0
    ? ('🚨 治理规则 · 已关底线(' + disCnt + ')')
    : (propCnt > 0 ? ('📝 治理规则 · 待确认(' + propCnt + ')') : '⚙ 默认治理规则');
}

async function dgGovRefreshSummary() {
  if (typeof fetchDoneGateApi !== 'function') return dgGovUiState.summary;
  try {
    const [rSum, rTrust, rTpl] = await Promise.all([
      fetchDoneGateApi('/donegate/api/governance/summary'),
      fetchDoneGateApi('/donegate/api/governance/trust-suggestions'),
      fetchDoneGateApi('/donegate/api/governance/templates')
    ]);
    if (rSum && rSum.ok) dgGovUiState.summary = await rSum.json();
    if (rTrust && rTrust.ok) {
      const tj = await rTrust.json();
      dgGovUiState.trustSuggestion = (tj && tj.suggestion) ? tj.suggestion : null;
    }
    if (rTpl && rTpl.ok) {
      const tpj = await rTpl.json();
      dgGovUiState.templates = Array.isArray(tpj && tpj.templates) ? tpj.templates : [];
    }
    dgGovSyncFab();
    if (dgGovUiState.open) dgGovRenderModal();
  } catch (err) {
    void err;
  }
  return dgGovUiState.summary;
}
window.dgGovRefreshSummary = dgGovRefreshSummary;

function dgGovRenderNodeInspectorHtml(flow, node) {
  const fields = Array.isArray(node.configSchema) ? node.configSchema : [];
  const bricks = Array.isArray(node.availableBricks) ? node.availableBricks : [];
  const parts = [];
  if (bricks.length > 1) {
    const opts = bricks.map((b) => '<option value="' + dgGovEsc(b) + '"' + (b === node.activeBrick ? ' selected' : '') + '>' + dgGovEsc(b) + '</option>').join('');
    parts.push('<label>能力插槽工具：<select data-gov-swap-brick="' + dgGovEsc(flow.id) + ':' + dgGovEsc(node.id) + '">' + opts + '</select></label>');
  }
  for (const f of fields) {
    const curVal = node.config && node.config[f.key] !== undefined ? node.config[f.key] : f.default;
    if (f.type === 'boolean') {
      parts.push('<label><input type="checkbox" data-gov-cfg-key="' + dgGovEsc(f.key) + '"' + (curVal ? ' checked' : '') + '> ' + dgGovEsc(f.label) + '</label>');
    } else if (f.type === 'enum' && Array.isArray(f.options)) {
      const eOpts = f.options.map((v) => '<option value="' + dgGovEsc(v) + '"' + (v === curVal ? ' selected' : '') + '>' + dgGovEsc(v) + '</option>').join('');
      parts.push('<label>' + dgGovEsc(f.label) + '：<select data-gov-cfg-key="' + dgGovEsc(f.key) + '">' + eOpts + '</select></label>');
    } else {
      parts.push('<label>' + dgGovEsc(f.label) + '：<input type="number" value="' + dgGovEsc(curVal) + '" data-gov-cfg-key="' + dgGovEsc(f.key) + '" style="width:92px"></label>');
    }
  }
  if (parts.length === 0) parts.push('<div>当前节点暂无可调参数。</div>');
  parts.push('<div><button type="button" class="dg-gov-btn primary" data-gov-save-cfg="' + dgGovEsc(flow.id) + ':' + dgGovEsc(node.id) + '">保存参数并生效</button></div>');
  return '<div class="dg-gov-cfg" data-gov-cfg-box="' + dgGovEsc(flow.id) + ':' + dgGovEsc(node.id) + '">' + parts.join('') + '</div>';
}

function dgGovRenderModal() {
  if (typeof document === 'undefined') return;
  let rootEl = document.getElementById('dg-gov-modal-backdrop');
  if (!dgGovUiState.open) {
    if (rootEl) rootEl.remove();
    return;
  }
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'dg-gov-modal-backdrop';
    rootEl.className = 'dg-gov-backdrop';
    document.body.appendChild(rootEl);
  }
  const s = dgGovUiState.summary || { flows: [], disclosure: { hasDisabledIntegrity: false, count: 0 }, pendingProposals: [], newOfficialNodes: [] };
  const banners = [];
  if (s.disclosureBanner) {
    banners.push('<div class="dg-gov-banner-red">' + dgGovEsc(s.disclosureBanner) + '</div>');
  }
  if (Array.isArray(s.newOfficialNodes) && s.newOfficialNodes.length > 0) {
    banners.push('<div class="dg-gov-banner-info"><span>✨ 官方升级新增 ' + s.newOfficialNodes.length + ' 项默认规则，未改动部分已自动继承</span></div>');
  }
  for (const p of (s.pendingProposals || [])) {
    banners.push(
      '<div class="dg-gov-banner-info">' +
      '<span>📝 AI 提案（' + dgGovEsc(p.flowName) + '）：' + dgGovEsc(p.summary) + '（' + (p.diffPreview ? p.diffPreview.length : 0) + ' 处变更）</span>' +
      '<button type="button" class="dg-gov-btn primary" data-gov-confirm-prop="' + dgGovEsc(p.proposalId) + '">确认生效</button>' +
      '</div>'
    );
  }
  if (dgGovUiState.trustSuggestion) {
    const ts = dgGovUiState.trustSuggestion;
    banners.push(
      '<div class="dg-gov-banner-info">' +
      '<span>🧭 模型信任阶梯建议（' + dgGovEsc(ts.modelId || '当前模型') + '）：' + dgGovEsc(ts.message || '表现稳定，可松绑低风险推荐项') + '</span>' +
      '<div style="display:flex;gap:6px"><button type="button" class="dg-gov-btn" data-gov-trust-dismiss="' + dgGovEsc(ts.modelId || '') + '">本次暂不</button></div>' +
      '</div>'
    );
  }
  const tplOpts = (dgGovUiState.templates || []).map((tp) => '<option value="' + dgGovEsc(tp.name) + '">' + dgGovEsc(tp.name) + '</option>').join('');
  banners.push(
    '<div class="dg-gov-banner-info">' +
    '<span>📦 个人跨项目规则模板（已存 ' + (dgGovUiState.templates || []).length + ' 套）</span>' +
    '<div style="display:flex;gap:6px;align-items:center">' +
    (tplOpts ? '<select id="dg-gov-tpl-select" style="font-size:11.5px;padding:3px 6px">' + tplOpts + '</select><button type="button" class="dg-gov-btn" data-gov-tpl-apply="1">套用模板</button>' : '') +
    '<button type="button" class="dg-gov-btn" data-gov-tpl-save="1">存为个人模板</button>' +
    '</div></div>'
  );
  const groupsHtml = (s.flows || []).map((flow) => {
    const rows = (flow.nodes || []).map((n) => {
      const nKey = flow.id + ':' + n.id;
      const tierTxt = n.tier === 'integrity' ? '防伪底线' : (n.tier === 'recommended' ? '推荐护栏' : '按需可选');
      const checked = !n.bypassed ? ' checked' : '';
      const cfgHtml = dgGovUiState.expandedNodeKey === nKey ? dgGovRenderNodeInspectorHtml(flow, n) : '';
      return '<div class="dg-gov-row"><div>' +
        '<span class="dg-gov-tag ' + dgGovEsc(n.tier) + '">' + tierTxt + '</span> ' +
        '<strong>' + dgGovEsc(n.title) + '</strong>' +
        (n.envSkipped ? ' <span style="opacity:.65">(当前环境自动跳过)</span>' : '') +
        '</div><div style="display:flex;align-items:center;gap:6px">' +
        '<button type="button" class="dg-gov-btn" data-gov-expand="' + dgGovEsc(nKey) + '">调参</button>' +
        '<label><input type="checkbox" data-gov-toggle="' + dgGovEsc(nKey) + '"' + checked + '> 启用</label>' +
        '</div></div>' + cfgHtml;
    }).join('');
    return '<div class="dg-gov-group"><div style="display:flex;justify-content:space-between;align-items:center">' +
      '<strong>' + dgGovEsc(flow.timing || flow.id) + ' · ' + dgGovEsc(flow.name) + '</strong>' +
      '<div style="display:flex;gap:6px">' +
      (flow.customized ? '<button type="button" class="dg-gov-btn" data-gov-reset="' + dgGovEsc(flow.id) + '">还原默认</button>' : '') +
      '<button type="button" class="dg-gov-btn" data-gov-canvas="' + dgGovEsc(flow.id) + '">进入高级画布 →</button>' +
      '</div></div>' + rows + '</div>';
  }).join('');

  rootEl.innerHTML =
    '<div class="dg-gov-modal" data-ui-owner="runner/atlas/wb-governance-panel.mjs">' +
    '<div style="display:flex;justify-content:space-between;align-items:center">' +
    '<strong>⚙ DoneGate 默认治理规则清单（极简视图）</strong>' +
    '<button type="button" class="dg-gov-btn" data-gov-close="1">关闭</button>' +
    '</div>' + banners.join('') + groupsHtml + '</div>';
}

async function dgGovPostApi(path, bodyObj) {
  if (typeof fetchDoneGateApi !== 'function') return null;
  const r = await fetchDoneGateApi('/donegate/api' + path, undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  });
  if (!r) return null;
  const data = await r.json();
  if (data && data.summary) {
    dgGovUiState.summary = data.summary;
    dgGovSyncFab();
    dgGovRenderModal();
  }
  return data;
}

window.openGovernancePanel = function openGovernancePanel() {
  dgGovUiState.open = true;
  dgGovRenderModal();
  dgGovRefreshSummary();
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.id === 'dg-gov-modal-backdrop' || t.closest('[data-gov-close]')) {
      dgGovUiState.open = false;
      dgGovRenderModal();
      return;
    }
    const exp = t.closest('[data-gov-expand]');
    if (exp) {
      const k = exp.getAttribute('data-gov-expand');
      dgGovUiState.expandedNodeKey = dgGovUiState.expandedNodeKey === k ? '' : k;
      dgGovRenderModal();
      return;
    }
    const cv = t.closest('[data-gov-canvas]');
    if (cv) {
      const fid = cv.getAttribute('data-gov-canvas');
      dgGovUiState.open = false;
      dgGovRenderModal();
      if (typeof WORKFLOW_PACKS !== 'undefined' && WORKFLOW_PACKS[fid] && typeof state !== 'undefined') {
        state.activePackId = fid;
        state.page = 'workshop';
        state.leftTab = 'workflows';
        if (typeof renderAll === 'function') renderAll();
      }
      return;
    }
    const rst = t.closest('[data-gov-reset]');
    if (rst) {
      dgGovPostApi('/governance/reset', { flowId: rst.getAttribute('data-gov-reset'), confirmedByHuman: true });
      return;
    }
    const cfm = t.closest('[data-gov-confirm-prop]');
    if (cfm) {
      dgGovPostApi('/governance/confirm', { proposalId: cfm.getAttribute('data-gov-confirm-prop'), confirmedByHuman: true });
      return;
    }
    const td = t.closest('[data-gov-trust-dismiss]');
    if (td) {
      dgGovUiState.trustSuggestion = null;
      dgGovRenderModal();
      dgGovPostApi('/governance/trust-dismiss', { modelId: td.getAttribute('data-gov-trust-dismiss') || 'default' });
      return;
    }
    if (t.closest('[data-gov-tpl-save]')) {
      const name = (typeof window.prompt === 'function' ? window.prompt('输入个人规则模板名称：', 'my-default') : 'my-default');
      if (name && name.trim()) dgGovPostApi('/governance/templates/save', { name: name.trim(), confirmedByHuman: true }).then(() => dgGovRefreshSummary());
      return;
    }
    if (t.closest('[data-gov-tpl-apply]')) {
      const sel = document.getElementById('dg-gov-tpl-select');
      if (sel && sel.value) dgGovPostApi('/governance/templates/apply', { name: sel.value, confirmedByHuman: true }).then(() => dgGovRefreshSummary());
      return;
    }
    const sv = t.closest('[data-gov-save-cfg]');
    if (sv) {
      const key = sv.getAttribute('data-gov-save-cfg');
      const [flowId, nodeId] = key.split(':');
      const box = document.querySelector('[data-gov-cfg-box="' + key + '"]');
      if (!box) return;
      const cfgPatch = {};
      for (const el of box.querySelectorAll('[data-gov-cfg-key]')) {
        const ck = el.getAttribute('data-gov-cfg-key');
        cfgPatch[ck] = el.type === 'checkbox' ? Boolean(el.checked) : (el.type === 'number' ? Number(el.value) : el.value);
      }
      const swapEl = box.querySelector('[data-gov-swap-brick]');
      const patch = { patchConfig: { [nodeId]: cfgPatch } };
      if (swapEl && swapEl.value) patch.swapBrick = { [nodeId]: swapEl.value };
      dgGovPostApi('/governance/overlay', { flowId, confirmedByHuman: true, patch });
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute('data-gov-toggle')) return;
    const [flowId, nodeId] = el.getAttribute('data-gov-toggle').split(':');
    const bypassed = !el.checked;
    dgGovPostApi('/governance/overlay', {
      flowId,
      confirmedByHuman: true,
      patch: { toggleNodes: { [nodeId]: { bypassed, reason: bypassed ? '业主在极简规则面板手动关闭' : '' } } }
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dgGovSyncFab);
  else dgGovSyncFab();
}
`;

export function buildWbGovernancePanelScript() {
  return WB_GOVERNANCE_PANEL_SCRIPT;
}
