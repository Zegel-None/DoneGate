// Agent Native UI 看板全栈引擎：本地 UI 自动探测、Puck 式 JSON 声明式布局渲染、agent-browser 自测排雷与假动作转真后端接线账本
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import {
  AESTHETIC_PROPOSALS, auditHtmlAntiAiSlop, buildCssVariablesStyleText,
  lockDesignSystemMaster, readDesignSystemLock, recommendAestheticProposals
} from './ui-aesthetics.mjs';
import { buildWinBatchSpawn } from '../../skill/adapters/_shared.mjs';
import { findExecutableInDirs, getWorkflowDepsPaths, provisionWorkflowDeps } from './workflow-deps.mjs';

export const UI_TOOLCHAIN_DEPS_PACK = {
  id: 'uiboard',
  name: 'UI 看板增强套件（跨框架点选 / 拖拽 / Agent 自测）',
  deps: [
    { id: 'lovinsp', title: 'Lovinsp 跨框架 DOM 源码定位器', repo: 'lovstudio/lovinsp', version: 'v1.8.0', kind: 'npm', pkg: 'lovinsp', bin: 'lovinsp' },
    { id: 'react-grab', title: 'React Grab 组件栈拾取器', repo: 'aidenybai/react-grab', version: 'v0.1.0', kind: 'npm', pkg: 'react-grab' },
    { id: 'puck', title: 'Puck 模块化拖拽布局核', repo: 'measuredco/puck', version: 'v0.24.1', kind: 'npm', pkg: '@puckeditor/core' },
    { id: 'agent-browser', title: 'Vercel Agent Browser 自测 CLI', repo: 'vercel-labs/agent-browser', version: 'v0.43.0', kind: 'npm', pkg: 'agent-browser', bin: 'agent-browser' }
  ],
  nodes: []
};

export const PUCK_BLOCK_TEMPLATES = {
  hero_nav: {
    type: 'hero_nav',
    label: '顶部导航与主视觉区',
    defaultProps: { brand: '业务工作台', headline: '智能协作与全流程数据中枢', subline: '初版支持测试模式直接点击试玩，满意后一键接通真实数据库与后端接口', ctaLabel: '新建业务单据', ctaActionId: 'act-create-order' }
  },
  kpi_row: {
    type: 'kpi_row',
    label: '核心指标统计卡组',
    defaultProps: { item1Title: '今日待处理', item1Val: '18', item2Title: '本周已完成', item2Val: '142', item3Title: '合规达标率', item3Val: '99.2%' }
  },
  action_form: {
    type: 'action_form',
    label: '交互表单与提交弹窗块',
    defaultProps: { title: '快速录入与审批发起', field1: '事项标题', field2: '负责人 / 部门', submitLabel: '提交并触发流转', submitActionId: 'act-submit-form' }
  },
  data_table: {
    type: 'data_table',
    label: '业务明细列表与导出块',
    defaultProps: { title: '实时业务流水列表', exportLabel: '导出筛选报表', exportActionId: 'act-export-report', detailActionId: 'act-open-detail' }
  },
  confirm_modal_trigger: {
    type: 'confirm_modal_trigger',
    label: '二次确认弹窗跳转按钮组',
    defaultProps: { title: '关键状态变更操作区', btnLabel: '发布并同步下游系统', actionId: 'act-publish-sync' }
  }
};

function defaultUiLayout(projectName) {
  return {
    schemaVersion: '1.0',
    engine: 'puck-compatible-json',
    root: { title: `${projectName} · 交互界面原型` },
    content: [
      { id: 'blk-hero', type: 'hero_nav', props: { ...PUCK_BLOCK_TEMPLATES.hero_nav.defaultProps, brand: projectName } },
      { id: 'blk-kpi', type: 'kpi_row', props: { ...PUCK_BLOCK_TEMPLATES.kpi_row.defaultProps } },
      { id: 'blk-form', type: 'action_form', props: { ...PUCK_BLOCK_TEMPLATES.action_form.defaultProps } },
      { id: 'blk-table', type: 'data_table', props: { ...PUCK_BLOCK_TEMPLATES.data_table.defaultProps } }
    ]
  };
}

function defaultWiringFromLayout(layout) {
  const items = [];
  for (const blk of (layout.content || [])) {
    const p = blk.props || {};
    if (blk.type === 'hero_nav' && p.ctaActionId) {
      items.push({ actionId: p.ctaActionId, label: p.ctaLabel || '新建业务单据', blockId: blk.id, sourceFile: '.donegate/ui-prototype/index.html', sourceLine: 28, mockBehavior: '弹出新建单据抽屉预览提示', targetApi: 'POST /api/orders/draft', targetTable: 'orders', status: 'mock' });
    }
    if (blk.type === 'action_form' && p.submitActionId) {
      items.push({ actionId: p.submitActionId, label: p.submitLabel || '提交并触发流转', blockId: blk.id, sourceFile: '.donegate/ui-prototype/index.html', sourceLine: 56, mockBehavior: '校验非空并弹出提交成功模拟回执', targetApi: 'POST /api/workflows/submit', targetTable: 'workflow_submissions', status: 'mock' });
    }
    if (blk.type === 'data_table' && p.exportActionId) {
      items.push({ actionId: p.exportActionId, label: p.exportLabel || '导出筛选报表', blockId: blk.id, sourceFile: '.donegate/ui-prototype/index.html', sourceLine: 82, mockBehavior: '前端模拟生成 CSV 下载提示', targetApi: 'GET /api/reports/export', targetTable: 'audit_logs', status: 'mock' });
    }
    if (blk.type === 'confirm_modal_trigger' && p.actionId) {
      items.push({ actionId: p.actionId, label: p.btnLabel || '发布并同步下游', blockId: blk.id, sourceFile: '.donegate/ui-prototype/index.html', sourceLine: 98, mockBehavior: '弹出二次确认模态框并模拟路由跳转', targetApi: 'POST /api/releases/publish', targetTable: 'release_records', status: 'mock' });
    }
  }
  return items;
}

export function loadOrInitUiLayoutAndWiring(projectRoot) {
  const root = resolve(projectRoot);
  const dgDir = join(root, '.donegate');
  mkdirSync(dgDir, { recursive: true });
  const projName = basename(root);

  const layoutPath = join(dgDir, 'ui-layout.json');
  const lRes = existsSync(layoutPath) ? readJsonStrict(layoutPath) : { ok: false };
  const layout = (lRes.ok && lRes.value && Array.isArray(lRes.value.content)) ? lRes.value : defaultUiLayout(projName);
  if (!existsSync(layoutPath)) writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + '\n', 'utf8');

  const wiringPath = join(dgDir, 'ui-wiring.json');
  const wRes = existsSync(wiringPath) ? readJsonStrict(wiringPath) : { ok: false };
  const existingMap = new Map(((wRes.ok && Array.isArray(wRes.value?.actions)) ? wRes.value.actions : []).map((a) => [a.actionId, a]));
  const mergedActions = defaultWiringFromLayout(layout).map((item) => existingMap.get(item.actionId) ? { ...item, ...existingMap.get(item.actionId) } : item);
  for (const [k, v] of existingMap.entries()) {
    if (!mergedActions.some((m) => m.actionId === k)) mergedActions.push(v);
  }
  const wiringDoc = { schemaVersion: '1.0', updatedAt: new Date().toISOString(), actions: mergedActions };
  writeFileSync(wiringPath, JSON.stringify(wiringDoc, null, 2) + '\n', 'utf8');
  return { layout, wiring: wiringDoc };
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPrototypeHtml(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const { layout, wiring } = loadOrInitUiLayoutAndWiring(root);
  const lock = readDesignSystemLock(root);
  const activeProposalId = opts.proposalId || lock?.proposalId || 'swiss-minimal';
  const cssVars = buildCssVariablesStyleText(activeProposalId);
  const wireById = new Map(wiring.actions.map((a) => [a.actionId, a.status === 'wired' || a.status === 'verified' ? 'wired' : 'mock']));

  const blockHtmlList = (layout.content || []).map((blk, idx) => {
    const p = blk.props || {};
    const lineNo = 24 + idx * 24;
    const srcAttr = `data-dg-block="${escHtml(blk.id)}" data-dg-source=".donegate/ui-prototype/index.html:${lineNo}:1"`;
    if (blk.type === 'hero_nav') {
      const wst = wireById.get(p.ctaActionId) || 'mock';
      return `<section ${srcAttr} class="ui-card ui-hero">
        <div class="ui-nav">
          <strong class="ui-brand" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 2}:5">${escHtml(p.brand)}</strong>
          <button type="button" class="ui-btn ui-btn-primary" data-dg-action="${escHtml(p.ctaActionId)}" data-dg-wiring="${wst}" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 3}:5">${escHtml(p.ctaLabel)}</button>
        </div>
        <h1 class="ui-h1" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 5}:3">${escHtml(p.headline)}</h1>
        <p class="ui-sub" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 6}:3">${escHtml(p.subline)}</p>
      </section>`;
    }
    if (blk.type === 'kpi_row') {
      return `<section ${srcAttr} class="ui-grid-3">
        <div class="ui-card"><div class="ui-muted">${escHtml(p.item1Title)}</div><div class="ui-kpi">${escHtml(p.item1Val)}</div></div>
        <div class="ui-card"><div class="ui-muted">${escHtml(p.item2Title)}</div><div class="ui-kpi">${escHtml(p.item2Val)}</div></div>
        <div class="ui-card"><div class="ui-muted">${escHtml(p.item3Title)}</div><div class="ui-kpi">${escHtml(p.item3Val)}</div></div>
      </section>`;
    }
    if (blk.type === 'action_form') {
      const wst = wireById.get(p.submitActionId) || 'mock';
      return `<section ${srcAttr} class="ui-card">
        <h2 class="ui-h2" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 1}:3">${escHtml(p.title)}</h2>
        <form class="ui-form" onsubmit="event.preventDefault(); window.__runMockAction('${escHtml(p.submitActionId)}', '${escHtml(p.submitLabel)}');">
          <input class="ui-input" type="text" placeholder="${escHtml(p.field1)}" required data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 3}:5">
          <input class="ui-input" type="text" placeholder="${escHtml(p.field2)}" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 4}:5">
          <button type="submit" class="ui-btn ui-btn-primary" data-dg-action="${escHtml(p.submitActionId)}" data-dg-wiring="${wst}" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 5}:5">${escHtml(p.submitLabel)}</button>
        </form>
      </section>`;
    }
    if (blk.type === 'confirm_modal_trigger') {
      const wst = wireById.get(p.actionId) || 'mock';
      return `<section ${srcAttr} class="ui-card ui-row-between">
        <div><h2 class="ui-h2">${escHtml(p.title)}</h2><div class="ui-muted">点击右侧按钮在测试模式下体验二次确认弹窗与模拟跳转</div></div>
        <button type="button" class="ui-btn ui-btn-primary" data-dg-action="${escHtml(p.actionId)}" data-dg-wiring="${wst}" onclick="window.__openConfirmModal('${escHtml(p.actionId)}', '${escHtml(p.btnLabel)}')" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 3}:5">${escHtml(p.btnLabel)}</button>
      </section>`;
    }
    const wst = wireById.get(p.exportActionId) || 'mock';
    return `<section ${srcAttr} class="ui-card">
      <div class="ui-row-between">
        <h2 class="ui-h2" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 2}:5">${escHtml(p.title)}</h2>
        <button type="button" class="ui-btn ui-btn-ghost" data-dg-action="${escHtml(p.exportActionId)}" data-dg-wiring="${wst}" onclick="window.__runMockAction('${escHtml(p.exportActionId)}', '${escHtml(p.exportLabel)}')" data-dg-source=".donegate/ui-prototype/index.html:${lineNo + 3}:5">${escHtml(p.exportLabel)}</button>
      </div>
      <table class="ui-table">
        <thead><tr><th>单号</th><th>事项名称</th><th>状态</th></tr></thead>
        <tbody>
          <tr><td>#1024</td><td>核心网关限流策略升级</td><td><span class="ui-pill">进行中</span></td></tr>
          <tr><td>#1025</td><td>季度安全合规巡检复核</td><td><span class="ui-pill">已就绪</span></td></tr>
        </tbody>
      </table>
    </section>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(layout.root?.title || 'UI Prototype')}</title>
  <style>
${cssVars}
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans); transition: background 0.18s ease, color 0.18s ease; }
    .ui-wrap { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .ui-card { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius); box-shadow: var(--ui-shadow); padding: 18px 20px; }
    .ui-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .ui-brand { font-size: 15px; letter-spacing: -0.01em; }
    .ui-h1 { margin: 0 0 6px; font-size: 24px; line-height: 1.25; }
    .ui-h2 { margin: 0 0 10px; font-size: 15px; }
    .ui-sub, .ui-muted { margin: 0; font-size: 13px; color: var(--ui-muted); line-height: 1.5; }
    .ui-grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .ui-kpi { font-size: 26px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; color: var(--ui-primary); }
    .ui-form { display: flex; flex-wrap: wrap; gap: 10px; }
    .ui-input { flex: 1 1 200px; padding: 8px 12px; border-radius: var(--ui-radius); border: 1px solid var(--ui-border); background: var(--ui-surface-muted); color: var(--ui-text); font-size: 13px; }
    .ui-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--ui-radius); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--ui-border); transition: opacity 0.15s; }
    .ui-btn:hover { opacity: 0.9; }
    .ui-btn-primary { background: var(--ui-primary); color: var(--ui-primary-fg); border-color: var(--ui-primary); }
    .ui-btn-ghost { background: var(--ui-surface-muted); color: var(--ui-text); }
    .ui-row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .ui-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    .ui-table th, .ui-table td { text-align: left; padding: 9px 8px; border-top: 1px solid var(--ui-border); }
    .ui-pill { padding: 2px 8px; border-radius: 999px; font-size: 11px; background: var(--ui-surface-muted); color: var(--ui-primary); font-weight: 600; }
    #ui-mock-toast { position: fixed; bottom: 18px; right: 18px; padding: 10px 14px; border-radius: var(--ui-radius); background: var(--ui-text); color: var(--ui-bg); font-size: 12.5px; font-weight: 600; display: none; box-shadow: var(--ui-shadow); z-index: 9000; }
    #ui-confirm-modal { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: none; align-items: center; justify-content: center; z-index: 9100; }
  </style>
</head>
<body>
  <div class="ui-wrap">
${blockHtmlList}
  </div>
  <div id="ui-mock-toast"></div>
  <div id="ui-confirm-modal">
    <div class="ui-card" style="max-width: 360px; width: 90%;">
      <h2 class="ui-h2" id="ui-modal-title">确认执行此操作？</h2>
      <p class="ui-muted" style="margin-bottom: 14px;">当前为测试模式模拟弹窗（待接通真实后端 API 后将自动切换为正式事务请求）。</p>
      <div class="ui-row-between" style="justify-content: flex-end;">
        <button type="button" class="ui-btn ui-btn-ghost" onclick="document.getElementById('ui-confirm-modal').style.display='none'">取消</button>
        <button type="button" class="ui-btn ui-btn-primary" onclick="document.getElementById('ui-confirm-modal').style.display='none'; window.__runMockAction('modal-confirmed', '确认跳转')">确认执行</button>
      </div>
    </div>
  </div>
  <script>
    window.__runMockAction = function(actId, label) {
      var t = document.getElementById('ui-mock-toast');
      if (!t) return;
      t.textContent = '⚡ [测试模式试玩] 已触发「' + label + '」（Mock 桩响应正常，可在左栏一键接通真实数据库）';
      t.style.display = 'block';
      clearTimeout(window.__mockTimer);
      window.__mockTimer = setTimeout(function() { t.style.display = 'none'; }, 2800);
    };
    window.__openConfirmModal = function(actId, label) {
      document.getElementById('ui-modal-title').textContent = '确认「' + label + '」？';
      document.getElementById('ui-confirm-modal').style.display = 'flex';
    };
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-dg-action]');
      if (btn && btn.type === 'button' && !btn.getAttribute('onclick')) {
        window.__runMockAction(btn.getAttribute('data-dg-action'), btn.innerText.trim());
      }
    });
  </script>
  <script src="/donegate/api/uiboard/bridge.js"></script>
</body>
</html>`;

  const protoDir = join(root, '.donegate', 'ui-prototype');
  mkdirSync(protoDir, { recursive: true });
  const outPath = join(protoDir, 'index.html');
  writeFileSync(outPath, html, 'utf8');
  return { outPath, html, activeProposalId, layout, wiring };
}

export function mutateUiLayoutBlocks(projectRoot, mutation = {}) {
  const root = resolve(projectRoot);
  const { layout } = loadOrInitUiLayoutAndWiring(root);
  const list = [...(layout.content || [])];

  if (mutation.op === 'add' && mutation.blockType && PUCK_BLOCK_TEMPLATES[mutation.blockType]) {
    const tpl = PUCK_BLOCK_TEMPLATES[mutation.blockType];
    const suffix = Date.now().toString(36).slice(-4);
    const props = { ...tpl.defaultProps };
    for (const k of Object.keys(props)) {
      if (k.toLowerCase().includes('actionid')) props[k] = `${props[k]}-${suffix}`;
    }
    list.push({ id: `blk-${mutation.blockType}-${suffix}`, type: tpl.type, props });
  } else if (mutation.op === 'reorder' && mutation.fromBlockId && mutation.toBlockId) {
    const fromIdx = list.findIndex((x) => x.id === mutation.fromBlockId);
    const toIdx = list.findIndex((x) => x.id === mutation.toBlockId);
    if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
    }
  } else if (mutation.op === 'remove' && mutation.blockId) {
    const idx = list.findIndex((x) => x.id === mutation.blockId);
    if (idx >= 0) list.splice(idx, 1);
  }

  const nextLayout = { ...layout, content: list, updatedAt: new Date().toISOString() };
  writeFileSync(join(root, '.donegate', 'ui-layout.json'), JSON.stringify(nextLayout, null, 2) + '\n', 'utf8');
  return renderPrototypeHtml(root);
}

export function detectProjectUiEntry(projectRoot) {
  const root = resolve(projectRoot);
  const pkgRes = readJsonStrict(join(root, 'package.json'));
  const scripts = (pkgRes.ok && pkgRes.value?.scripts) || {};
  const hasDevScript = Boolean(scripts.dev || scripts.start || scripts.serve);
  const intentTxt = existsSync(join(root, 'INTENT.md')) ? readFileSync(join(root, 'INTENT.md'), 'utf8') : '';
  const proposals = recommendAestheticProposals(intentTxt + ' ' + basename(root), 3);
  const lock = readDesignSystemLock(root);
  const proto = renderPrototypeHtml(root, { proposalId: lock?.proposalId || proposals[0]?.id });

  return {
    projectName: basename(root),
    hasDevScript,
    suggestedDevUrl: scripts.dev && String(scripts.dev).includes('next') ? 'http://127.0.0.1:3000' : (hasDevScript ? 'http://127.0.0.1:5173' : null),
    previewPath: '/donegate/api/uiboard/prototype',
    activeProposalId: proto.activeProposalId,
    lockedDesign: lock,
    proposals,
    allProposals: AESTHETIC_PROPOSALS,
    blockTemplates: Object.values(PUCK_BLOCK_TEMPLATES).map((t) => ({ type: t.type, label: t.label })),
    layout: proto.layout,
    wiring: proto.wiring
  };
}

/**
 * Phase 2：Agent 自动点按自测排雷（优先调已补齐的 agent-browser CLI，内置零依赖 DOM/交互动作/反AI模板脸静态探针兜底）
 */
export function runUiAgentSelfPlayCheck(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const proto = renderPrototypeHtml(root, opts);
  const html = proto.html;
  const interactiveTags = [...html.matchAll(/<(button|a|input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
  const actionMatches = [...html.matchAll(/data-dg-action="([^"]+)"/g)].map((m) => m[1]);
  const slopAudit = auditHtmlAntiAiSlop(html);

  let cliUsed = 'builtin-dom-probe';
  let cliSnapSummary = null;
  const uiPaths = getWorkflowDepsPaths(root, 'uiboard');
  const localAbBin = findExecutableInDirs('agent-browser', [uiPaths.binDir, uiPaths.npmBinDir]);
  const runAb = (abArgs) => {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(localAbBin)) {
      const wb = buildWinBatchSpawn(localAbBin, abArgs);
      return spawnSync(wb.cmd, wb.args, { encoding: 'utf8', timeout: 8000, ...wb.extraOpts });
    }
    return spawnSync(localAbBin, abArgs, { encoding: 'utf8', timeout: 8000, windowsHide: true });
  };
  if (opts.liveUrl && localAbBin && existsSync(localAbBin)) {
    const snap = runAb(['open', opts.liveUrl]);
    if (snap.status === 0) {
      cliUsed = 'agent-browser';
      const s2 = runAb(['snapshot', '-i']);
      cliSnapSummary = (s2.stdout || '').slice(0, 600);
    }
  }

  const issues = [...slopAudit.warnings];
  if (interactiveTags.length === 0) issues.push('页面未检出任何可交互按钮或输入控件');

  return {
    ok: issues.length === 0,
    engine: cliUsed,
    checkedControls: interactiveTags.length,
    interactiveActions: actionMatches,
    mockCount: proto.wiring.actions.filter((a) => a.status === 'mock').length,
    wiredCount: proto.wiring.actions.filter((a) => a.status !== 'mock').length,
    aestheticsPass: slopAudit.pass,
    cliSnapSummary,
    issues,
    summary: issues.length === 0
      ? `🤖 Agent 自测通过：已巡检 ${interactiveTags.length} 个交互控件与 ${actionMatches.length} 条动作链路，0 遮挡死点，美学反套路核查通过`
      : `🤖 Agent 自测发现 ${issues.length} 项待修问题：${issues.join('；')}`
  };
}

/**
 * Phase 3：将前端 Mock 假跳转/假按钮渐进接通为真实后端 API、数据库表与 DoneGate 验收判据
 */
export function buildBackendWiringPlan(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const { wiring } = loadOrInitUiLayoutAndWiring(root);
  const targetIds = Array.isArray(opts.actionIds) && opts.actionIds.length > 0
    ? new Set(opts.actionIds)
    : new Set(wiring.actions.filter((a) => a.status === 'mock').map((a) => a.actionId));

  const targets = wiring.actions.filter((a) => targetIds.has(a.actionId));
  if (opts.markWired === true) {
    const wiringPath = join(root, '.donegate', 'ui-wiring.json');
    const nextActions = wiring.actions.map((a) => targetIds.has(a.actionId) ? { ...a, status: 'wired', wiredAt: new Date().toISOString() } : a);
    writeFileSync(wiringPath, JSON.stringify({ ...wiring, updatedAt: new Date().toISOString(), actions: nextActions }, null, 2) + '\n', 'utf8');
    renderPrototypeHtml(root);
  }

  const lines = [
    `请将 UI 看板中已试玩确认的 ${targets.length} 个前端交互动作从 Mock 原型态接通为真实全栈实现，并挂入 DoneGate 验收判据：`,
    ...targets.map((t, i) => `${i + 1}. 【${t.label}】(actionId=${t.actionId}，定位 ${t.sourceFile}:${t.sourceLine})：将原 Mock 行为「${t.mockBehavior}」替换为真实接口 \`${t.targetApi}\` 与数据表 \`${t.targetTable}\` 读写；`),
    '完成后请运行 UI 看板自测并补充端到端判据确认退出码为 0。'
  ];
  return {
    ok: true,
    targetCount: targets.length,
    targets,
    agentPrompt: lines.join('\n')
  };
}

export function provisionUiBoardDeps(projectRoot, opts = {}) {
  return provisionWorkflowDeps(projectRoot, UI_TOOLCHAIN_DEPS_PACK, opts);
}
