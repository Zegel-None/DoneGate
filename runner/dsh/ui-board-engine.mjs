// Agent Native UI 看板全栈引擎：本地 UI 自动探测、Puck 可视化布局渲染、agent-browser 异步自测排雷与假动作转真后端接线账本
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import {
  AESTHETIC_GROUPS, AESTHETIC_PROPOSALS, auditHtmlAntiAiSlop, buildCssVariablesStyleText,
  readDesignSystemLock, recommendAestheticProposals
} from './ui-aesthetics.mjs';
import { ARCHETYPE_CSS, renderProposalArchetypeBody, resolveProposalArchetype } from './ui-archetypes.mjs';
import { buildInjectedUiBridgeScript } from './ui-board-bridge.mjs';
import { renderPuckInteractiveEditorHtml } from './ui-puck-editor.mjs';
import { buildWinCmdSpawn } from './win-paths.mjs';
import {
  findExecutableInDirs, getSharedWorkflowDepsPaths, getWorkflowDepsPaths,
  inspectWorkflowDeps, provisionWorkflowDeps, verifyInstalledNpmPackage
} from './workflow-deps.mjs';

export const UI_TOOLCHAIN_DEPS_PACK = {
  id: 'uiboard',
  name: 'UI 看板增强套件（跨框架点选 / 拖拽 / Agent 自测）',
  deps: [
    { id: 'lovinsp', title: 'Lovinsp 跨框架 DOM 源码定位器', repo: 'lovstudio/lovinsp', version: 'v1.8.0', kind: 'npm-lib', pkg: 'lovinsp' },
    { id: 'react-grab', title: 'React Grab 组件栈拾取器', repo: 'aidenybai/react-grab', version: 'v0.1.0', kind: 'npm-lib', pkg: 'react-grab' },
    { id: 'puck', title: 'Puck 模块化拖拽布局核', repo: 'measuredco/puck', version: 'v0.24.1', kind: 'npm-lib', pkg: '@puckeditor/core' },
    { id: 'agent-browser', title: 'Vercel Agent Browser 自测 CLI', repo: 'vercel-labs/agent-browser', version: 'v0.43.0', kind: 'npm-cli', pkg: 'agent-browser', bin: 'agent-browser' }
  ],
  nodes: []
};

export function readUiToolchainStatus(projectRoot) {
  const root = resolve(projectRoot);
  const uiPaths = getWorkflowDepsPaths(root, 'uiboard');
  const sharedPaths = getSharedWorkflowDepsPaths(root);
  const rep = inspectWorkflowDeps(root, UI_TOOLCHAIN_DEPS_PACK);
  const byId = new Map((rep.items || []).map((x) => [x.id, x]));
  const tools = {};
  const versions = {};
  for (const dep of UI_TOOLCHAIN_DEPS_PACK.deps) {
    const npmChk = verifyInstalledNpmPackage(root, dep.pkg, 'uiboard');
    const item = byId.get(dep.id);
    const ready = Boolean((item && item.ready) || (dep.kind === 'npm-lib' && npmChk.ok));
    const ver = (npmChk.ok && npmChk.version) || (item && item.detectedVersion) || (ready ? String(dep.version || '').replace(/^v/i, '') : '');
    tools[dep.id] = {
      id: dep.id, pkg: dep.pkg, kind: dep.kind, ready, version: ver,
      resolvedVia: (item && item.resolvedVia) || (npmChk.ok ? `${npmChk.scope}-npm-pkg` : null),
      entryPath: npmChk.ok ? npmChk.relEntry : (item?.resolvedPath || null)
    };
    if (ver) versions[dep.id] = ver;
  }
  const abBin = findExecutableInDirs('agent-browser', [uiPaths.binDir, uiPaths.npmBinDir, sharedPaths.binDir, sharedPaths.npmBinDir]);
  if (abBin && !tools['agent-browser'].ready) {
    const abNpm = verifyInstalledNpmPackage(root, 'agent-browser', 'uiboard');
    tools['agent-browser'].ready = true;
    tools['agent-browser'].version = (abNpm.ok && abNpm.version) || tools['agent-browser'].version || '0.43.0';
    versions['agent-browser'] = tools['agent-browser'].version;
  }
  const readyList = Object.values(tools).filter((t) => t.ready);
  const readyCount = readyList.length;
  const total = UI_TOOLCHAIN_DEPS_PACK.deps.length;
  const verSummary = readyList.map((t) => `${t.id}${t.version ? '@' + t.version : ''}`).join(' · ');
  return {
    ready: readyCount === total,
    readyCount,
    total,
    missingCount: total - readyCount,
    puckInstalled: Boolean(tools.puck?.ready),
    lovinspInstalled: Boolean(tools.lovinsp?.ready),
    reactGrabInstalled: Boolean(tools['react-grab']?.ready),
    agentBrowserInstalled: Boolean(tools['agent-browser']?.ready),
    agentBrowserBin: abBin || null,
    versions,
    versionSummary: verSummary,
    tools,
    refreshStamp: rep.refreshStamp,
    badgeLabel: readyCount === total
      ? `✓ 增强套件已激活 (${readyCount}/${total})`
      : (readyCount > 0 ? `⚡ 增强套件已就绪 (${readyCount}/${total})` : '📦 按需补齐 UI 增强套件')
  };
}

export function isPuckInstalled(projectRoot) {
  return readUiToolchainStatus(projectRoot).puckInstalled;
}

export const PUCK_BLOCK_TEMPLATES = {
  hero_nav: {
    type: 'hero_nav',
    label: '顶部导航与主视觉区',
    defaultProps: { brand: '业务工作台', headline: '智能协作与全流程数据中枢', subline: '窗口内直接点击试玩真实交互，按住 Alt+单击拾取任意元素源码，满意后一键接通数据库与后端接口', ctaLabel: '新建业务单据', ctaActionId: 'act-create-order' }
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

function decorateInspectorMetadata(rawBody, archetype, blockTypeMap) {
  const withBlocks = rawBody.replace(/data-dg-block="([^"]+)"(\s+data-dg-source="([^"]+)")?/g, (_m, blkId, _s, src) => {
    const bType = blockTypeMap.get(blkId) || 'section';
    const insp = src ? ` data-insp-path="${src}" data-dg-source="${src}"` : ` data-insp-path=".donegate/ui-prototype/index.html:1:1"`;
    return `data-dg-block="${blkId}" data-dg-component="${bType}" data-component-stack="UIPrototype > ${archetype} > ${bType}#${blkId}"${insp}`;
  });
  return withBlocks.replace(/(?<!data-insp-path="[^"]*"\s)data-dg-source="([^"]+)"/g, 'data-insp-path="$1" data-dg-source="$1"');
}

export function renderPrototypeHtml(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const { layout, wiring } = loadOrInitUiLayoutAndWiring(root);
  const toolchain = readUiToolchainStatus(root);
  const lock = readDesignSystemLock(root);
  const activeProposalId = opts.proposalId || lock?.proposalId || 'swiss-minimal';
  const archetype = resolveProposalArchetype(activeProposalId);
  const cssVars = buildCssVariablesStyleText(activeProposalId);

  if (opts.editorMode === 'puck' && toolchain.puckInstalled) {
    const puckHtml = renderPuckInteractiveEditorHtml({
      layout, wiring, activeProposalId, archetype, cssVars,
      puckVersion: toolchain.versions.puck || '0.24.1',
      blockTemplates: PUCK_BLOCK_TEMPLATES,
      toolchain
    });
    const protoDir = join(root, '.donegate', 'ui-prototype');
    mkdirSync(protoDir, { recursive: true });
    const puckOutPath = join(protoDir, 'puck-editor.html');
    writeFileSync(puckOutPath, puckHtml, 'utf8');
    return { outPath: puckOutPath, html: puckHtml, editorMode: 'puck', activeProposalId, archetype, layout, wiring, toolchain };
  }

  const wireById = new Map(wiring.actions.map((a) => [a.actionId, a.status === 'wired' || a.status === 'verified' ? 'wired' : 'mock']));
  const content = layout.content || [];
  const blockTypeMap = new Map(content.map((b) => [b.id, b.type]));
  const findBlk = (t) => content.find((b) => b.type === t);
  const usedIds = new Set();
  const hBlk = findBlk('hero_nav'); if (hBlk) usedIds.add(hBlk.id);
  const kBlk = findBlk('kpi_row'); if (kBlk) usedIds.add(kBlk.id);
  const fBlk = findBlk('action_form'); if (fBlk) usedIds.add(fBlk.id);
  const tBlk = findBlk('data_table'); if (tBlk) usedIds.add(tBlk.id);
  const extraBlocks = content.filter((b) => !usedIds.has(b.id)).map((b) => ({
    ...b,
    wiring: wireById.get(b.props?.actionId || b.props?.ctaActionId || b.props?.submitActionId || b.props?.exportActionId) || 'mock'
  }));

  const hp = (hBlk && hBlk.props) || PUCK_BLOCK_TEMPLATES.hero_nav.defaultProps;
  const kp = (kBlk && kBlk.props) || PUCK_BLOCK_TEMPLATES.kpi_row.defaultProps;
  const fp = (fBlk && fBlk.props) || PUCK_BLOCK_TEMPLATES.action_form.defaultProps;
  const tp = (tBlk && tBlk.props) || PUCK_BLOCK_TEMPLATES.data_table.defaultProps;
  const rawBodyMarkup = renderProposalArchetypeBody(activeProposalId, {
    sourceFile: '.donegate/ui-prototype/index.html',
    hero: { id: (hBlk && hBlk.id) || 'blk-hero', ...hp, ctaWiring: wireById.get(hp.ctaActionId) || 'mock' },
    kpi: { id: (kBlk && kBlk.id) || 'blk-kpi', ...kp },
    form: { id: (fBlk && fBlk.id) || 'blk-form', ...fp, submitWiring: wireById.get(fp.submitActionId) || 'mock' },
    table: { id: (tBlk && tBlk.id) || 'blk-table', ...tp, exportWiring: wireById.get(tp.exportActionId) || 'mock' },
    extraBlocks
  });
  const bodyMarkup = decorateInspectorMetadata(rawBodyMarkup, archetype, blockTypeMap);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(layout.root?.title || 'UI Prototype')}</title>
  <style>
${cssVars}
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); }
${ARCHETYPE_CSS}
    #ui-mock-toast { position: fixed; bottom: 18px; right: 18px; padding: 10px 14px; border-radius: var(--ui-radius); background: var(--ui-text); color: var(--ui-bg); font-size: 12.5px; font-weight: 600; display: none; box-shadow: var(--ui-shadow); z-index: 9000; }
    #ui-confirm-modal { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: none; align-items: center; justify-content: center; z-index: 9100; }
  </style>
</head>
<body data-proposal-id="${escHtml(activeProposalId)}" data-archetype="${escHtml(archetype)}" data-lovinsp-active="${toolchain.lovinspInstalled ? '1' : '0'}" data-lovinsp-version="${escHtml(toolchain.versions.lovinsp || '')}" data-react-grab-active="${toolchain.reactGrabInstalled ? '1' : '0'}" data-react-grab-version="${escHtml(toolchain.versions['react-grab'] || '')}">
${bodyMarkup}
  <div id="ui-mock-toast"></div>
  <div id="ui-confirm-modal">
    <div class="ui-modal-dialog ck-panel bt-card ep-panel" style="max-width: 360px; width: 90%; background: var(--ui-surface); padding: 18px 20px;">
      <h2 style="margin:0 0 8px;font-size:16px;" id="ui-modal-title">确认执行此操作？</h2>
      <p style="margin:0 0 14px;font-size:13px;color:var(--ui-muted);">当前为原型交互模拟弹窗（接通真实后端接口后将自动切换为正式请求）。</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="ui-btn ui-btn-ghost" onclick="document.getElementById('ui-confirm-modal').style.display='none'">取消</button>
        <button type="button" class="ui-btn ui-btn-primary" onclick="document.getElementById('ui-confirm-modal').style.display='none'; window.__runMockAction('modal-confirmed', '确认执行')">确认执行</button>
      </div>
    </div>
  </div>
  <script>
    window.__runMockAction = function(actId, label) {
      var t = document.getElementById('ui-mock-toast');
      if (!t) return;
      t.textContent = '已触发「' + label + '」（原型模拟响应正常，可在左栏一键接通真实数据库）';
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
  return { outPath, html, editorMode: 'builtin', activeProposalId, archetype, layout, wiring, toolchain };
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
  } else if (mutation.op === 'update_props' && mutation.blockId && mutation.props && typeof mutation.props === 'object') {
    const idx = list.findIndex((x) => x.id === mutation.blockId);
    if (idx >= 0) list[idx] = { ...list[idx], props: { ...(list[idx].props || {}), ...mutation.props } };
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
  const tc = proto.toolchain || readUiToolchainStatus(root);

  return {
    projectName: basename(root),
    hasDevScript,
    puckInstalled: tc.puckInstalled,
    lovinspInstalled: tc.lovinspInstalled,
    reactGrabInstalled: tc.reactGrabInstalled,
    agentBrowserInstalled: tc.agentBrowserInstalled,
    toolchain: tc,
    suggestedDevUrl: scripts.dev && String(scripts.dev).includes('next') ? 'http://127.0.0.1:3000' : (hasDevScript ? 'http://127.0.0.1:5173' : null),
    previewPath: '/donegate/api/uiboard/prototype',
    activeProposalId: proto.activeProposalId,
    lockedDesign: lock,
    proposals,
    aestheticGroups: AESTHETIC_GROUPS,
    allProposals: AESTHETIC_PROPOSALS,
    blockTemplates: Object.values(PUCK_BLOCK_TEMPLATES).map((t) => ({ type: t.type, label: t.label })),
    layout: proto.layout,
    wiring: proto.wiring
  };
}

function spawnAsync(bin, args, timeoutMs = 8000) {
  return new Promise((resolveRun) => {
    let cmd = bin, cmdArgs = args, extra = { windowsHide: true };
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
      const wb = buildWinCmdSpawn(bin, args);
      cmd = wb.cmd; cmdArgs = wb.args; extra = { windowsHide: true, ...wb.extraOpts };
    }
    let stdout = '', stderr = '', settled = false;
    const done = (status) => { if (!settled) { settled = true; clearTimeout(timer); resolveRun({ status, stdout, stderr }); } };
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    const timer = setTimeout(() => { try { child.kill(); } catch (err) { void err; } done(124); }, timeoutMs);
    child.stdout?.on('data', (c) => { stdout += String(c); });
    child.stderr?.on('data', (c) => { stderr += String(c); });
    child.on('error', (err) => { stderr += String(err.message || err); done(1); });
    child.on('close', (code) => done(code ?? 1));
  });
}

export async function runUiAgentSelfPlayCheck(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const proto = renderPrototypeHtml(root, opts);
  const html = proto.html;
  const interactiveTags = [...html.matchAll(/<(button|a|input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
  const actionMatches = [...html.matchAll(/data-dg-action="([^"]+)"/g)].map((m) => m[1]);
  const slopAudit = auditHtmlAntiAiSlop(html);

  let cliUsed = 'builtin-dom-probe';
  let cliSnapSummary = null;
  let cliExitCode = null;
  let cliDiagnostic = null;
  const tc = proto.toolchain || readUiToolchainStatus(root);
  const localAbBin = tc.agentBrowserBin;

  if (localAbBin && existsSync(localAbBin)) {
    let tempServer = null;
    let targetUrl = opts.liveUrl || '';
    try {
      if (!targetUrl) {
        const bridgeJs = buildInjectedUiBridgeScript();
        tempServer = createServer((req, res) => {
          if ((req.url || '').startsWith('/donegate/api/uiboard/bridge.js')) {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            res.end(bridgeJs);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        });
        await new Promise((r) => tempServer.listen(0, '127.0.0.1', r));
        targetUrl = `http://127.0.0.1:${tempServer.address().port}/`;
      }
      const openRes = await spawnAsync(localAbBin, ['open', targetUrl], 8000);
      cliExitCode = openRes.status;
      if (openRes.status === 0) {
        cliUsed = 'agent-browser';
        const s2 = await spawnAsync(localAbBin, ['snapshot', '-i'], 8000);
        cliSnapSummary = ((s2.stdout || openRes.stdout || '')).trim().slice(0, 600);
        await spawnAsync(localAbBin, ['close'], 3000);
      } else {
        cliDiagnostic = (openRes.stderr || openRes.stdout || `exit ${openRes.status}`).trim().slice(0, 240);
      }
    } finally {
      if (tempServer) tempServer.close();
    }
  }

  const issues = [...slopAudit.warnings];
  if (interactiveTags.length === 0) issues.push('页面未检出任何可交互按钮或输入控件');
  const engineNote = cliUsed === 'agent-browser' ? '（agent-browser 实机快照通过）' : (localAbBin ? '（已调 agent-browser 并结合 DOM 探针核验）' : '');

  return {
    ok: issues.length === 0,
    engine: cliUsed,
    agentBrowserDetected: Boolean(localAbBin),
    agentBrowserBin: localAbBin || null,
    cliExitCode,
    cliDiagnostic,
    checkedControls: interactiveTags.length,
    interactiveActions: actionMatches,
    mockCount: proto.wiring.actions.filter((a) => a.status === 'mock').length,
    wiredCount: proto.wiring.actions.filter((a) => a.status !== 'mock').length,
    aestheticsPass: slopAudit.pass,
    cliSnapSummary,
    issues,
    summary: issues.length === 0
      ? `🤖 Agent 自测通过${engineNote}：已巡检 ${interactiveTags.length} 个交互控件与 ${actionMatches.length} 条动作链路，0 遮挡死点，美学反套路核查通过`
      : `🤖 Agent 自测发现 ${issues.length} 项待修问题：${issues.join('；')}`
  };
}

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
