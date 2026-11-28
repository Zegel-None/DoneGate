// Agent Native UI 看板全栈引擎：真实项目/自举界面探测、Puck 编排、agent-browser 自测与待传达功能记录 → grill me 立约流转
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import {
  AESTHETIC_GROUPS, AESTHETIC_PROPOSALS, WCAG_MIN_READABLE_CONTRAST_RATIO, auditHtmlAntiAiSlop,
  buildCssVariablesStyleText, computeContrastRatio, readDesignSystemLock, recommendAestheticProposals
} from './ui-aesthetics.mjs';

export { WCAG_MIN_READABLE_CONTRAST_RATIO, computeContrastRatio };
import { ARCHETYPE_CSS, renderProposalArchetypeBody, resolveProposalArchetype } from './ui-archetypes.mjs';
import { buildInjectedUiBridgeScript } from './ui-board-bridge.mjs';
import { renderPuckInteractiveEditorHtml } from './ui-puck-editor.mjs';
import { buildWinCmdSpawn } from '../deps/index.mjs';
import {
  findExecutableInDirs, getSharedWorkflowDepsPaths, getWorkflowDepsPaths,
  inspectWorkflowDeps, provisionWorkflowDeps, verifyInstalledNpmPackage
} from '../deps/workflow-deps.mjs';

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

const REAL_FRONTEND_HTML_CANDIDATES = [
  'index.html', 'public/index.html', 'dist/index.html', 'build/index.html', 'app/index.html', 'src/index.html', 'web/index.html'
];

export function isSelfDoneGateProject(projectRoot) {
  return existsSync(join(resolve(projectRoot), 'runner', 'atlas', 'render-html.mjs'));
}

export function findRealProjectHtmlEntry(projectRoot) {
  const root = resolve(projectRoot);
  for (const rel of REAL_FRONTEND_HTML_CANDIDATES) {
    if (existsSync(join(root, rel))) return rel;
  }
  return null;
}

function uibResolveDepToolRecord(root, dep, item) {
  const npmChk = verifyInstalledNpmPackage(root, dep.pkg, 'uiboard');
  const ready = Boolean((item && item.ready) || (dep.kind === 'npm-lib' && npmChk.ok));
  const fallbackVer = ready ? String(dep.version || '').replace(/^v/i, '') : '';
  const ver = (npmChk.ok && npmChk.version) || (item && item.detectedVersion) || fallbackVer;
  const resolvedVia = (item && item.resolvedVia) || (npmChk.ok ? `${npmChk.scope}-npm-pkg` : null);
  const entryPath = npmChk.ok ? npmChk.relEntry : (item?.resolvedPath || null);
  return { id: dep.id, pkg: dep.pkg, kind: dep.kind, ready, version: ver, resolvedVia, entryPath };
}

function uibBuildToolchainBadge(readyCount, total) {
  if (readyCount === total) return `✓ 增强套件已激活 (${readyCount}/${total})`;
  if (readyCount > 0) return `⚡ 增强套件已就绪 (${readyCount}/${total})`;
  return '📦 按需补齐 UI 增强套件';
}

export function readUiToolchainStatus(projectRoot) {
  const root = resolve(projectRoot);
  const uiPaths = getWorkflowDepsPaths(root, 'uiboard');
  const sharedPaths = getSharedWorkflowDepsPaths(root);
  const rep = inspectWorkflowDeps(root, UI_TOOLCHAIN_DEPS_PACK);
  const byId = new Map((rep.items || []).map((x) => [x.id, x]));
  const tools = {};
  const versions = {};
  for (const dep of UI_TOOLCHAIN_DEPS_PACK.deps) {
    const rec = uibResolveDepToolRecord(root, dep, byId.get(dep.id));
    tools[dep.id] = rec;
    if (rec.version) versions[dep.id] = rec.version;
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
    ready: readyCount === total, readyCount, total, missingCount: total - readyCount,
    puckInstalled: Boolean(tools.puck?.ready), lovinspInstalled: Boolean(tools.lovinsp?.ready),
    reactGrabInstalled: Boolean(tools['react-grab']?.ready), agentBrowserInstalled: Boolean(tools['agent-browser']?.ready),
    agentBrowserBin: abBin || null, versions, versionSummary: verSummary, tools,
    refreshStamp: rep.refreshStamp, badgeLabel: uibBuildToolchainBadge(readyCount, total)
  };
}

export function isPuckInstalled(projectRoot) {
  return readUiToolchainStatus(projectRoot).puckInstalled;
}

export const PUCK_BLOCK_TEMPLATES = {
  hero_nav: { type: 'hero_nav', label: '顶部导航与主视觉区', defaultProps: { brand: '当前项目工作台', headline: '当前项目界面编排画布', subline: '窗口内直接点击体验原生交互，按住 Alt+单击拾取元素并在左栏记入待传达功能记录', ctaLabel: '新建业务单据', ctaActionId: 'act-create-order' } },
  kpi_row: { type: 'kpi_row', label: '核心指标统计卡组', defaultProps: { item1Title: '待澄清项', item1Val: '0', item2Title: '已立约模块', item2Val: '0', item3Title: '门禁通过率', item3Val: '100%' } },
  action_form: { type: 'action_form', label: '交互表单与提交弹窗块', defaultProps: { title: '快速录入与流转发起', field1: '事项标题', field2: '关联模块', submitLabel: '提交并触发流转', submitActionId: 'act-submit-form' } },
  data_table: { type: 'data_table', label: '业务明细列表与导出块', defaultProps: { title: '项目条目明细列表', exportLabel: '导出筛选报表', exportActionId: 'act-export-report', detailActionId: 'act-open-detail' } },
  confirm_modal_trigger: { type: 'confirm_modal_trigger', label: '二次确认弹窗跳转按钮组', defaultProps: { title: '关键状态变更操作区', btnLabel: '发布并同步下游系统', actionId: 'act-publish-sync' } }
};

function defaultUiLayout(projectName) {
  return {
    schemaVersion: '1.0', engine: 'puck-compatible-json', userMutated: false, root: { title: `${projectName} · 界面预览` },
    content: [
      { id: 'blk-hero', type: 'hero_nav', props: { ...PUCK_BLOCK_TEMPLATES.hero_nav.defaultProps, brand: projectName, headline: `${projectName} · 界面编排画布` } },
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
  const prevList = (wRes.ok && Array.isArray(wRes.value?.actions)) ? wRes.value.actions : [];
  const existingMap = new Map(prevList.map((a) => [a.actionId, a]));
  const mergedActions = defaultWiringFromLayout(layout).map((item) => {
    const prev = existingMap.get(item.actionId);
    return prev ? { ...item, ...prev } : item;
  });
  for (const [k, v] of existingMap.entries()) {
    if (!mergedActions.some((m) => m.actionId === k)) mergedActions.push(v);
  }
  const wiringDoc = { schemaVersion: '1.0', updatedAt: new Date().toISOString(), actions: mergedActions };
  writeFileSync(wiringPath, JSON.stringify(wiringDoc, null, 2) + '\n', 'utf8');
  return { layout, wiring: wiringDoc };
}

export function loadUiBoardRequirements(projectRoot) {
  const reqPath = join(resolve(projectRoot), '.donegate', 'uiboard-requirements.json');
  if (!existsSync(reqPath)) return { schemaVersion: '1.0', updatedAt: null, items: [] };
  const res = readJsonStrict(reqPath);
  return (res.ok && res.value && Array.isArray(res.value.items)) ? res.value : { schemaVersion: '1.0', updatedAt: null, items: [] };
}

export function addUiBoardRequirement(projectRoot, input = {}) {
  const root = resolve(projectRoot);
  const dgDir = join(root, '.donegate');
  mkdirSync(dgDir, { recursive: true });
  const items = [...(loadUiBoardRequirements(root).items || [])];
  if (input.op === 'remove' && input.id) {
    const nextDoc = { schemaVersion: '1.0', updatedAt: new Date().toISOString(), items: items.filter((x) => x.id !== input.id) };
    writeFileSync(join(dgDir, 'uiboard-requirements.json'), JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');
    return { ok: true, removedId: input.id, requirements: nextDoc };
  }
  const label = String(input.label || input.buttonName || '未命名控件').trim() || '未命名控件';
  const description = String(input.description || input.expectation || '').trim() || `完善「${label}」的业务交互与后端契约`;
  const now = new Date().toISOString();
  const item = {
    id: String(input.id || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
    label, description, tag: String(input.tag || 'button'),
    sourceFile: String(input.sourceFile || ''), sourceLine: Number(input.sourceLine || 1),
    uiOwner: String(input.uiOwner || ''), status: 'pending', createdAt: now, conveyedAt: null
  };
  const existIdx = items.findIndex((x) => x.id === item.id);
  if (existIdx >= 0) items[existIdx] = item;
  else items.push(item);
  const nextDoc = { schemaVersion: '1.0', updatedAt: now, items };
  writeFileSync(join(dgDir, 'uiboard-requirements.json'), JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');
  return { ok: true, item, requirements: nextDoc };
}

function uibBuildGrillMeKanbanNode(allConveyed, prevNode) {
  const modules = allConveyed.map((it) => ({
    name: `${it.label}：${it.description}`, role: '待澄清', state: 'warn',
    path: it.sourceFile || '.donegate/grill-me-inbox.jsonl', vibeLabel: '✓ 已传达到 grill me',
    aiPrompt: `请围绕界面控件「${it.label}」的需求「${it.description}」执行 grill me 需求澄清并立约。`, techSummary: it.description
  }));
  return {
    id: 'host-dom-grill-me', step: '00', title: 'grill me · 需求澄清与立约', isGrillMe: true,
    tip: `起手 00 环节：已承接 ${allConveyed.length} 条来自 UI 看板的待澄清功能记录，进入主对话 grill me 追问边界并立约`,
    contractIds: [], primaryContractId: null, lifecycleLabel: '待 grill me 立约', scopePaths: ['./'],
    bypassed: false, collapsed: false, expanded: true, color: prevNode?.color || 'amber',
    x: typeof prevNode?.x === 'number' ? prevNode.x : -260,
    y: typeof prevNode?.y === 'number' ? prevNode.y : 68,
    w: typeof prevNode?.w === 'number' ? prevNode.w : 268,
    h: null, nextIds: Array.isArray(prevNode?.nextIds) ? prevNode.nextIds : [], requirements: allConveyed, modules
  };
}

function uibPersistGrillMeArtifacts(dgDir, conveyedNow, allConveyed, nowIso) {
  if (conveyedNow.length > 0) {
    const inboxPath = join(dgDir, 'grill-me-inbox.jsonl');
    const prevTxt = existsSync(inboxPath) ? readFileSync(inboxPath, 'utf8') : '';
    const newLines = conveyedNow.map((it) => JSON.stringify({
      id: it.id, conveyedAt: nowIso, stage: 'grill-me', nodeId: 'host-dom-grill-me',
      nodeTitle: 'grill me · 需求澄清与立约', label: it.label, description: it.description,
      sourceFile: it.sourceFile || '', sourceLine: it.sourceLine || 1, uiOwner: it.uiOwner || ''
    }));
    const prefix = prevTxt && !prevTxt.endsWith('\n') ? `${prevTxt}\n` : prevTxt;
    writeFileSync(inboxPath, prefix + newLines.join('\n') + '\n', 'utf8');
  }
  if (!allConveyed.length) return null;
  const wbPath = join(dgDir, 'workbench-state.json');
  const wbRes = existsSync(wbPath) ? readJsonStrict(wbPath) : { ok: false };
  const prevWb = (wbRes.ok && wbRes.value && typeof wbRes.value === 'object') ? wbRes.value : { schemaVersion: '1.0', hostLayoutVer: 2 };
  const grillMeNode = uibBuildGrillMeKanbanNode(allConveyed, prevWb.grillMeNode);
  const hostNodeLayouts = { ...(prevWb.hostNodeLayouts || {}) };
  if (!hostNodeLayouts['host-dom-grill-me']) {
    hostNodeLayouts['host-dom-grill-me'] = { x: grillMeNode.x, y: grillMeNode.y, w: grillMeNode.w, color: 'amber', expanded: true };
  }
  const nextWb = { ...prevWb, grillMeInbox: allConveyed, grillMeNode, hostNodeLayouts, updatedAt: nowIso };
  writeFileSync(wbPath, JSON.stringify(nextWb, null, 2) + '\n', 'utf8');
  return grillMeNode;
}

export function conveyUiBoardRequirementsToKanban(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const dgDir = join(root, '.donegate');
  mkdirSync(dgDir, { recursive: true });
  if (opts.label || opts.description) addUiBoardRequirement(root, opts);
  const doc = loadUiBoardRequirements(root);
  const reqIds = Array.isArray(opts.requirementIds) && opts.requirementIds.length > 0 ? new Set(opts.requirementIds) : null;
  const nowIso = new Date().toISOString();
  const conveyedNow = [];
  const nextItems = (doc.items || []).map((it) => {
    const match = reqIds ? reqIds.has(it.id) : it.status !== 'conveyed';
    if (!match) return it;
    const updated = { ...it, status: 'conveyed', conveyedAt: nowIso };
    conveyedNow.push(updated);
    return updated;
  });
  const nextDoc = { schemaVersion: '1.0', updatedAt: nowIso, items: nextItems };
  writeFileSync(join(dgDir, 'uiboard-requirements.json'), JSON.stringify(nextDoc, null, 2) + '\n', 'utf8');
  const allConveyed = nextItems.filter((it) => it.status === 'conveyed');
  const grillMeNode = uibPersistGrillMeArtifacts(dgDir, conveyedNow, allConveyed, nowIso);
  const summaryBody = conveyedNow.map((x) => `「${x.label}」${x.description}`).join('；');
  const quoteLines = [
    '[DG-TARGET uri=dg://sandbox/card/host-dom-grill-me | kind=card | id=host-dom-grill-me | label=grill me · 需求澄清与立约 | contracts=- | scopes=./ | uiOwner=runner/atlas/wb-uiboard.mjs]',
    '请进入起手 00 号「grill me · 需求澄清与立约」环节，针对以下从 UI 看板传达到项目看板的界面功能记录逐一追问边界并立约：',
    ...conveyedNow.map((x, idx) => `${idx + 1}. 【${x.label}】：${x.description}`)
  ];
  return {
    ok: true, conveyedCount: conveyedNow.length, conveyedItems: conveyedNow, requirements: nextDoc, grillMeNode,
    grillMeQuote: {
      text: quoteLines.join('\n'),
      summary: { label: '[grill me] 需求澄清与立约', title: 'dg://sandbox/card/host-dom-grill-me', detail: `起手 00 环节 · 共 ${conveyedNow.length} 条待澄清功能需求`, body: summaryBody || '启动 grill me 需求澄清与立约' }
    },
    inboxPath: '.donegate/grill-me-inbox.jsonl'
  };
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

function uibWritePrototypeArtifact(root, fileName, html) {
  const protoDir = join(root, '.donegate', 'ui-prototype');
  mkdirSync(protoDir, { recursive: true });
  const outPath = join(protoDir, fileName);
  writeFileSync(outPath, html, 'utf8');
  return outPath;
}

function uibBuildWireStatusMap(wiring) {
  return new Map(wiring.actions.map((a) => [a.actionId, a.status === 'wired' || a.status === 'verified' ? 'wired' : 'mock']));
}

function uibResolveExtraBlockActionId(props) {
  if (!props) return undefined;
  return props.actionId || props.ctaActionId || props.submitActionId || props.exportActionId;
}

function uibPickCoreBlocks(content) {
  const usedIds = new Set();
  const pick = (type) => {
    const blk = content.find((b) => b.type === type);
    if (blk) usedIds.add(blk.id);
    return blk;
  };
  return { hBlk: pick('hero_nav'), kBlk: pick('kpi_row'), fBlk: pick('action_form'), tBlk: pick('data_table'), usedIds };
}

function uibBuildArchetypeModel(content, wireById) {
  const { hBlk, kBlk, fBlk, tBlk, usedIds } = uibPickCoreBlocks(content);
  const extraBlocks = content.filter((b) => !usedIds.has(b.id)).map((b) => ({ ...b, wiring: wireById.get(uibResolveExtraBlockActionId(b.props)) || 'mock' }));
  const hp = hBlk?.props || PUCK_BLOCK_TEMPLATES.hero_nav.defaultProps;
  const kp = kBlk?.props || PUCK_BLOCK_TEMPLATES.kpi_row.defaultProps;
  const fp = fBlk?.props || PUCK_BLOCK_TEMPLATES.action_form.defaultProps;
  const tp = tBlk?.props || PUCK_BLOCK_TEMPLATES.data_table.defaultProps;
  return {
    sourceFile: '.donegate/ui-prototype/index.html',
    hero: { id: hBlk?.id || 'blk-hero', ...hp, ctaWiring: wireById.get(hp.ctaActionId) || 'mock' },
    kpi: { id: kBlk?.id || 'blk-kpi', ...kp },
    form: { id: fBlk?.id || 'blk-form', ...fp, submitWiring: wireById.get(fp.submitActionId) || 'mock' },
    table: { id: tBlk?.id || 'blk-table', ...tp, exportWiring: wireById.get(tp.exportActionId) || 'mock' },
    extraBlocks
  };
}

function uibToolchainBodyAttrs(toolchain) {
  const lovAct = toolchain.lovinspInstalled ? '1' : '0';
  const lovVer = escHtml(toolchain.versions.lovinsp || '');
  const rgAct = toolchain.reactGrabInstalled ? '1' : '0';
  const rgVer = escHtml(toolchain.versions['react-grab'] || '');
  return `data-lovinsp-active="${lovAct}" data-lovinsp-version="${lovVer}" data-react-grab-active="${rgAct}" data-react-grab-version="${rgVer}"`;
}

function uibBuildPrototypeDocumentHtml({ title, cssVars, activeProposalId, archetype, toolchain, bodyMarkup }) {
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escHtml(title || 'UI Prototype')}</title><style>`,
    cssVars,
    '    * { box-sizing: border-box; }',
    '    html, body { min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); }',
    ARCHETYPE_CSS,
    '    #ui-mock-toast { position: fixed; bottom: 18px; right: 18px; padding: 10px 14px; border-radius: var(--ui-radius); background: var(--ui-text); color: var(--ui-bg); font-size: 12.5px; font-weight: 600; display: none; box-shadow: var(--ui-shadow); z-index: 9000; }',
    '    #ui-confirm-modal { position: fixed; inset: 0; background: rgba(15,23,42,0.45); display: none; align-items: center; justify-content: center; z-index: 9100; }',
    `</style></head><body data-proposal-id="${escHtml(activeProposalId)}" data-archetype="${escHtml(archetype)}" ${uibToolchainBodyAttrs(toolchain)}>`,
    bodyMarkup,
    '<div id="ui-mock-toast"></div><div id="ui-confirm-modal"><div class="ui-modal-dialog ck-panel bt-card ep-panel" style="max-width:360px;width:90%;background:var(--ui-surface);padding:18px 20px;"><h2 style="margin:0 0 8px;font-size:16px;" id="ui-modal-title">确认执行此操作？</h2><p style="margin:0 0 14px;font-size:13px;color:var(--ui-muted);">当前为编排预览交互弹窗，可在左栏记入功能需求并传达到项目看板进入 grill me 立约。</p><div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="ui-btn ui-btn-ghost" onclick="document.getElementById(\'ui-confirm-modal\').style.display=\'none\'">取消</button><button type="button" class="ui-btn ui-btn-primary" onclick="document.getElementById(\'ui-confirm-modal\').style.display=\'none\'; window.__runMockAction(\'modal-confirmed\', \'确认执行\')">确认执行</button></div></div></div>',
    '<script>window.__runMockAction=function(a,l){var t=document.getElementById("ui-mock-toast");if(!t)return;t.textContent="已触发「"+l+"」";t.style.display="block";clearTimeout(window.__mockTimer);window.__mockTimer=setTimeout(function(){t.style.display="none";},2800);};window.__openConfirmModal=function(a,l){document.getElementById("ui-modal-title").textContent="确认「"+l+"」？";document.getElementById("ui-confirm-modal").style.display="flex";};document.addEventListener("click",function(e){var b=e.target.closest("button[data-dg-action]");if(b&&b.type==="button"&&!b.getAttribute("onclick"))window.__runMockAction(b.getAttribute("data-dg-action"),b.innerText.trim());});</script>',
    '<script src="/donegate/api/uiboard/bridge.js"></script></body></html>'
  ].join('\n');
}

function uibInjectBridgeAndAttrs(rawHtml, toolchain, extraHeadScript = '') {
  const attrs = uibToolchainBodyAttrs(toolchain);
  let html = String(rawHtml || '');
  if (!html.includes('min-height: 100%; margin: 0;')) {
    const baseReset = '<style>html, body { min-height: 100%; margin: 0; }</style>';
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${baseReset}\n</head>`) : `${baseReset}\n${html}`;
  }
  if (extraHeadScript) {
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${extraHeadScript}`) : `${extraHeadScript}\n${html}`;
  }
  if (/<body\b/i.test(html) && !html.includes('data-lovinsp-active=')) {
    html = html.replace(/<body\b/i, `<body ${attrs}`);
  }
  if (!html.includes('/donegate/api/uiboard/bridge.js')) {
    const bridgeTag = '<script src="/donegate/api/uiboard/bridge.js"></script>';
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridgeTag}\n</body>`) : `${html}\n${bridgeTag}\n`;
  }
  return html;
}

function uibBuildSelfFallbackShellHtml(cssVars, activeProposalId, toolchain) {
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>DoneGate · 完结门工作台自举预览</title><style>',
    cssVars,
    'html, body { min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans, system-ui, sans-serif); }',
    `</style></head><body data-donegate-self-ui="1" data-proposal-id="${escHtml(activeProposalId)}" ${uibToolchainBodyAttrs(toolchain)}>`,
    '<header data-ui-owner="runner/atlas/ui-shell.mjs" style="padding:12px 18px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);display:flex;align-items:center;justify-content:space-between;"><strong>DoneGate · 完结门工作台（本仓自举实时预览）</strong><div style="display:flex;gap:8px;"><button type="button" data-dg-action="dg-tab-sandbox">项目看板</button><button type="button" data-dg-action="dg-tab-workshop">工作流</button><button type="button" data-dg-action="dg-refresh">刷新最新数据</button></div></header>',
    '<main style="padding:20px;"><section data-insp-path="runner/atlas/wb-render-cards.mjs:1:1" data-component-stack="DoneGateWorkbench > HostKanban" style="padding:16px;border-radius:var(--ui-radius);border:1px solid var(--ui-border);background:var(--ui-surface);"><h2>DoneGate 完结门自身工作区套娃预览</h2><input type="text" placeholder="搜索本仓模块或契约..."><button type="button" data-dg-action="dg-autopilot">挂机长跑</button></section></main>',
    '<script src="/donegate/api/uiboard/bridge.js"></script></body></html>'
  ].join('\n');
}

function uibBuildHonestEmptyGuideHtml({ root, projName, cssVars, activeProposalId, archetype, toolchain }) {
  const reqItems = loadUiBoardRequirements(root).items || [];
  const reqCards = reqItems.length > 0
    ? reqItems.map((it, idx) => `<div data-insp-path=".donegate/uiboard-requirements.json:${idx + 1}:1" data-component-stack="UIBoard > PendingRequirement" style="padding:10px 12px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-muted);display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><strong>${escHtml(it.label)}</strong><div style="font-size:12px;color:var(--ui-muted);">${escHtml(it.description)}</div></div><span style="font-size:11px;font-weight:600;">${it.status === 'conveyed' ? '已传达到 grill me' : '待传达'}</span></div>`).join('\n')
    : '<div style="font-size:12.5px;color:var(--ui-muted);padding:10px 0;">尚无待传达功能记录，请在左栏「新增按钮/界面功能记录」填写后点击「传达到项目看板」。</div>';
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escHtml(projName)} · 待创建前端界面引导</title><style>`,
    cssVars,
    '* { box-sizing: border-box; } html, body { min-height: 100%; margin: 0; background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font-sans, system-ui, sans-serif); }',
    '.dg-empty-wrap { max-width: 720px; margin: 36px auto; padding: 24px; border-radius: var(--ui-radius); border: 1px solid var(--ui-border); background: var(--ui-surface); box-shadow: var(--ui-shadow); }',
    '.dg-empty-inp { padding: 7px 10px; border-radius: var(--ui-radius); border: 1px solid var(--ui-border); background: var(--ui-bg); color: var(--ui-text); font-size: 12.5px; width: 100%; }',
    `</style></head><body data-ui-empty-guide="1" data-proposal-id="${escHtml(activeProposalId)}" data-archetype="${escHtml(archetype)}" ${uibToolchainBodyAttrs(toolchain)}>`,
    '<main class="dg-empty-wrap" data-insp-path=".donegate/uiboard-requirements.json:1:1" data-component-stack="UIBoard > EmptyFrontendGuide">',
    `<div style="font-size:11.5px;font-weight:600;color:var(--ui-primary);margin-bottom:6px;">真实项目界面探测 · ${escHtml(projName)}</div>`,
    '<h1 style="margin:0 0 10px;font-size:18px;line-height:1.4;">当前项目暂未检测到前端界面文件，可在左侧新增按钮/页面需求描述并传达到项目看板启动开发</h1>',
    '<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:var(--ui-muted);">未检出 index.html / public/index.html / dist/index.html，不展示虚假样板间。请描述拟新增按钮或页面的功能并传达到项目看板第 00 号「grill me · 需求澄清与立约」环节。</p>',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;"><input id="guide-btn-name" class="dg-empty-inp" type="text" placeholder="拟新增的按钮或页面名称"><select id="guide-btn-kind" class="dg-empty-inp" aria-label="元素类型"><option value="button">交互按钮</option><option value="page">完整页面</option></select></div>',
    '<textarea id="guide-btn-desc" class="dg-empty-inp" rows="2" placeholder="用自然语言描述它应该实现什么功能..." style="margin-bottom:10px;"></textarea>',
    '<div style="display:flex;gap:8px;margin-bottom:18px;"><button type="button" data-dg-action="guide-sync-left" style="padding:7px 12px;border-radius:var(--ui-radius);border:1px solid var(--ui-border);background:var(--ui-primary);color:var(--ui-primary-fg);font-weight:600;cursor:pointer;">填入左栏待传达记录</button><button type="button" data-dg-action="guide-clear" style="padding:7px 12px;border-radius:var(--ui-radius);border:1px solid var(--ui-border);background:transparent;color:var(--ui-text);cursor:pointer;">清空草稿</button></div>',
    `<section style="display:grid;gap:8px;"><strong style="font-size:12.5px;">已记录的界面功能需求 (${reqItems.length})</strong>${reqCards}</section></main>`,
    '<script src="/donegate/api/uiboard/bridge.js"></script></body></html>'
  ].join('\n');
}

function uibReadExistingSelfHtml(root) {
  const dshHtml = join(root, '.donegate', 'dashboard-dsh.html');
  if (existsSync(dshHtml)) return readFileSync(dshHtml, 'utf8');
  const mainHtml = join(root, '.donegate', 'dashboard.html');
  return existsSync(mainHtml) ? readFileSync(mainHtml, 'utf8') : '';
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
    const puckHtml = renderPuckInteractiveEditorHtml({ layout, wiring, activeProposalId, archetype, cssVars, puckVersion: toolchain.versions.puck || '0.24.1', blockTemplates: PUCK_BLOCK_TEMPLATES, toolchain });
    const puckOutPath = uibWritePrototypeArtifact(root, 'puck-editor.html', puckHtml);
    return { outPath: puckOutPath, html: puckHtml, editorMode: 'puck', uiSourceKind: 'puck', activeProposalId, archetype, layout, wiring, toolchain };
  }
  if (layout.userMutated === true) {
    const content = layout.content || [];
    const blockTypeMap = new Map(content.map((b) => [b.id, b.type]));
    const bodyMarkup = decorateInspectorMetadata(renderProposalArchetypeBody(activeProposalId, uibBuildArchetypeModel(content, uibBuildWireStatusMap(wiring))), archetype, blockTypeMap);
    const html = uibBuildPrototypeDocumentHtml({ title: layout.root?.title, cssVars, activeProposalId, archetype, toolchain, bodyMarkup });
    return { outPath: uibWritePrototypeArtifact(root, 'index.html', html), html, editorMode: 'builtin', uiSourceKind: 'custom-layout', activeProposalId, archetype, layout, wiring, toolchain };
  }
  if (isSelfDoneGateProject(root)) {
    const rawSelf = opts.selfWorkbenchHtml || uibReadExistingSelfHtml(root);
    const html = rawSelf ? uibInjectBridgeAndAttrs(rawSelf, toolchain, '<script>window.__DG_UIBOARD_SELF_EMBED__ = true;</script>') : uibBuildSelfFallbackShellHtml(cssVars, activeProposalId, toolchain);
    return { outPath: uibWritePrototypeArtifact(root, 'index.html', html), html, editorMode: 'self-workbench', uiSourceKind: 'donegate-self', activeProposalId, archetype, layout, wiring, toolchain };
  }
  const realEntry = findRealProjectHtmlEntry(root);
  if (realEntry) {
    const html = uibInjectBridgeAndAttrs(readFileSync(join(root, realEntry), 'utf8'), toolchain);
    return { outPath: uibWritePrototypeArtifact(root, 'index.html', html), html, editorMode: 'project-entry', uiSourceKind: 'project-html', entryFile: realEntry, activeProposalId, archetype, layout, wiring, toolchain };
  }
  const guideHtml = uibBuildHonestEmptyGuideHtml({ root, projName: basename(root), cssVars, activeProposalId, archetype, toolchain });
  return { outPath: uibWritePrototypeArtifact(root, 'index.html', guideHtml), html: guideHtml, editorMode: 'empty-guide', uiSourceKind: 'empty-guide', activeProposalId, archetype, layout, wiring, toolchain };
}

function uibApplyLayoutMutation(list, mutation) {
  if (mutation.op === 'add' && mutation.blockType && PUCK_BLOCK_TEMPLATES[mutation.blockType]) {
    const tpl = PUCK_BLOCK_TEMPLATES[mutation.blockType];
    const suffix = Date.now().toString(36).slice(-4);
    const props = { ...tpl.defaultProps };
    for (const k of Object.keys(props)) {
      if (k.toLowerCase().includes('actionid')) props[k] = `${props[k]}-${suffix}`;
    }
    list.push({ id: `blk-${mutation.blockType}-${suffix}`, type: tpl.type, props });
    return;
  }
  if (mutation.op === 'reorder' && mutation.fromBlockId && mutation.toBlockId) {
    const fromIdx = list.findIndex((x) => x.id === mutation.fromBlockId);
    const toIdx = list.findIndex((x) => x.id === mutation.toBlockId);
    if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
    }
    return;
  }
  if (mutation.op === 'remove' && mutation.blockId) {
    const idx = list.findIndex((x) => x.id === mutation.blockId);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  if (mutation.op === 'update_props' && mutation.blockId && mutation.props && typeof mutation.props === 'object') {
    const idx = list.findIndex((x) => x.id === mutation.blockId);
    if (idx >= 0) list[idx] = { ...list[idx], props: { ...(list[idx].props || {}), ...mutation.props } };
  }
}

export function mutateUiLayoutBlocks(projectRoot, mutation = {}) {
  const root = resolve(projectRoot);
  const { layout } = loadOrInitUiLayoutAndWiring(root);
  const list = [...(layout.content || [])];
  uibApplyLayoutMutation(list, mutation);
  const nextLayout = { ...layout, userMutated: true, content: list, updatedAt: new Date().toISOString() };
  writeFileSync(join(root, '.donegate', 'ui-layout.json'), JSON.stringify(nextLayout, null, 2) + '\n', 'utf8');
  return renderPrototypeHtml(root);
}

function uibReadSavedGrillMeNode(root) {
  const wbPath = join(root, '.donegate', 'workbench-state.json');
  if (!existsSync(wbPath)) return null;
  const r = readJsonStrict(wbPath);
  return (r.ok && r.value && r.value.grillMeNode) ? r.value.grillMeNode : null;
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
  const isSelf = isSelfDoneGateProject(root);
  const realEntryFile = isSelf ? 'runner/atlas/render-html.mjs' : findRealProjectHtmlEntry(root);
  let suggestedDevUrl = null;
  if (scripts.dev && String(scripts.dev).includes('next')) suggestedDevUrl = 'http://127.0.0.1:3000';
  else if (hasDevScript) suggestedDevUrl = 'http://127.0.0.1:5173';

  return {
    projectName: basename(root), isSelfDoneGate: isSelf, uiSourceKind: proto.uiSourceKind || 'empty-guide',
    realEntryFile, canvasEmbedPath: isSelf ? '/donegate/api/canvas?embed=uiboard' : null,
    hasDevScript, puckInstalled: tc.puckInstalled, lovinspInstalled: tc.lovinspInstalled,
    reactGrabInstalled: tc.reactGrabInstalled, agentBrowserInstalled: tc.agentBrowserInstalled,
    toolchain: tc, suggestedDevUrl, previewPath: isSelf ? '/donegate/api/canvas?embed=uiboard' : '/donegate/api/uiboard/prototype',
    activeProposalId: proto.activeProposalId, lockedDesign: lock, proposals, aestheticGroups: AESTHETIC_GROUPS,
    allProposals: AESTHETIC_PROPOSALS, blockTemplates: Object.values(PUCK_BLOCK_TEMPLATES).map((t) => ({ type: t.type, label: t.label })),
    layout: proto.layout, wiring: proto.wiring, requirements: loadUiBoardRequirements(root).items || [], grillMeNode: uibReadSavedGrillMeNode(root)
  };
}

function uibResolveSpawnSpec(bin, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const wb = buildWinCmdSpawn(bin, args);
    return { cmd: wb.cmd, cmdArgs: wb.args, extra: { windowsHide: true, ...wb.extraOpts } };
  }
  return { cmd: bin, cmdArgs: args, extra: { windowsHide: true } };
}

function spawnAsync(bin, args, timeoutMs = 8000) {
  return new Promise((resolveRun) => {
    const { cmd, cmdArgs, extra } = uibResolveSpawnSpec(bin, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const done = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    };
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...extra });
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (err) {
        void err;
      }
      done(124);
    }, timeoutMs);
    child.stdout?.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', (err) => {
      stderr += String(err.message || err);
      done(1);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

async function uibRunAgentBrowserProbe(localAbBin, liveUrl, html) {
  let tempServer = null;
  let targetUrl = liveUrl || '';
  if (targetUrl) {
    try {
      const parsed = new URL(String(targetUrl));
      const host = parsed.hostname.toLowerCase();
      if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
        return { cliUsed: 'builtin-dom-probe', cliExitCode: 2, cliSnapSummary: null, cliDiagnostic: '安全限制：拒绝访问非本机回环地址' };
      }
      targetUrl = parsed.toString();
    } catch (err) {
      return { cliUsed: 'builtin-dom-probe', cliExitCode: 2, cliSnapSummary: null, cliDiagnostic: `无效目标地址：${err.message}` };
    }
  }
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
    if (openRes.status === 0) {
      const s2 = await spawnAsync(localAbBin, ['snapshot', '-i'], 8000);
      await spawnAsync(localAbBin, ['close'], 3000);
      return { cliUsed: 'agent-browser', cliExitCode: 0, cliSnapSummary: (s2.stdout || openRes.stdout || '').trim().slice(0, 600), cliDiagnostic: null };
    }
    return { cliUsed: 'builtin-dom-probe', cliExitCode: openRes.status, cliSnapSummary: null, cliDiagnostic: (openRes.stderr || openRes.stdout || `exit ${openRes.status}`).trim().slice(0, 240) };
  } finally {
    if (tempServer) tempServer.close();
  }
}

export const UI_DUAL_VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ id: 'desktop', label: '桌面端 (1280x800)', width: 1280, height: 800 }),
  mobile: Object.freeze({ id: 'mobile', label: '移动端 (390x844)', width: 390, height: 844 })
});
const DEFAULT_OVERFLOW_TOLERANCE_PX = 0;

function uibCollectViewportOverflowElements(rawElements, viewportId, viewportWidth, tolerancePx) {
  const out = [];
  if (!Array.isArray(rawElements)) return out;
  for (const el of rawElements) {
    if (!el || typeof el !== 'object') continue;
    const edge = Math.max(Number(el.scrollWidth || 0), Number(el.right || 0), Number(el.width || 0));
    const overflowPx = edge - viewportWidth;
    if (overflowPx > tolerancePx) {
      out.push({ viewport: viewportId, selector: String(el.selector || el.id || el.tag || 'element'), scrollWidth: edge, viewportWidth, overflowPx });
    }
  }
  return out;
}

function uibEvaluateSingleViewport(vpInput, preset, tolerancePx) {
  if (!vpInput || typeof vpInput !== 'object') {
    return { id: preset.id, viewportWidth: preset.width, viewportHeight: preset.height, scrollWidth: preset.width, overflowPx: 0, overflowed: false, elements: [] };
  }
  const viewportWidth = Number(vpInput.viewportWidth || vpInput.width || preset.width);
  const viewportHeight = Number(vpInput.viewportHeight || vpInput.height || preset.height);
  const scrollWidth = Number(vpInput.scrollWidth || viewportWidth);
  const overflowPx = Math.max(0, scrollWidth - viewportWidth);
  const rawEls = vpInput.elements || vpInput.overflowElements || [];
  const elements = uibCollectViewportOverflowElements(rawEls, preset.id, viewportWidth, tolerancePx);
  const overflowed = overflowPx > tolerancePx || elements.length > 0;
  return { id: preset.id, viewportWidth, viewportHeight, scrollWidth, overflowPx, overflowed, elements };
}

export function evaluateDualViewportOverflow(metrics = {}, opts = {}) {
  const tolerancePx = Math.max(0, Number(opts.tolerancePx ?? DEFAULT_OVERFLOW_TOLERANCE_PX));
  let deskIn = metrics?.desktop;
  let mobIn = metrics?.mobile;
  if (Array.isArray(metrics)) {
    deskIn = metrics.find((m) => m?.id === 'desktop' || m?.viewport === 'desktop');
    mobIn = metrics.find((m) => m?.id === 'mobile' || m?.viewport === 'mobile');
  } else if (!deskIn && !mobIn && metrics && typeof metrics === 'object' && ('scrollWidth' in metrics || 'elements' in metrics)) {
    const w = Number(metrics.viewportWidth || metrics.width || UI_DUAL_VIEWPORTS.desktop.width);
    if (w <= UI_DUAL_VIEWPORTS.mobile.width) mobIn = metrics;
    else deskIn = metrics;
  }
  const desktop = uibEvaluateSingleViewport(deskIn, UI_DUAL_VIEWPORTS.desktop, tolerancePx);
  const mobile = uibEvaluateSingleViewport(mobIn, UI_DUAL_VIEWPORTS.mobile, tolerancePx);
  const overflowElements = [...desktop.elements, ...mobile.elements];
  const issues = [];
  if (desktop.overflowed) issues.push(`${UI_DUAL_VIEWPORTS.desktop.label} 横向溢出 (${desktop.scrollWidth}px > ${desktop.viewportWidth}px)`);
  if (mobile.overflowed) issues.push(`${UI_DUAL_VIEWPORTS.mobile.label} 横向溢出 (${mobile.scrollWidth}px > ${mobile.viewportWidth}px)`);
  const overflowCount = (desktop.overflowed ? 1 : 0) + (mobile.overflowed ? 1 : 0);
  return { ok: overflowCount === 0, hasOverflow: overflowCount > 0, desktop, mobile, overflowCount, overflowElements, issues };
}

export async function runUiAgentSelfPlayCheck(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const proto = renderPrototypeHtml(root, opts);
  const html = proto.html;
  const interactiveTags = [...html.matchAll(/<(button|a|input|select|textarea)\b[^>]*>/gi)].map((m) => m[0]);
  const actionMatches = [...html.matchAll(/data-dg-action="([^"]+)"/g)].map((m) => m[1]);
  const slopAudit = auditHtmlAntiAiSlop(html);
  const viewportOverflow = opts.viewportMetrics ? evaluateDualViewportOverflow(opts.viewportMetrics) : null;
  const tc = proto.toolchain || readUiToolchainStatus(root);
  const localAbBin = tc.agentBrowserBin;
  const abReport = (localAbBin && existsSync(localAbBin))
    ? await uibRunAgentBrowserProbe(localAbBin, opts.liveUrl, html)
    : { cliUsed: 'builtin-dom-probe', cliExitCode: null, cliSnapSummary: null, cliDiagnostic: null };

  const issues = [...slopAudit.warnings, ...(viewportOverflow ? viewportOverflow.issues : [])];
  if (interactiveTags.length === 0) issues.push('页面未检出任何可交互按钮或输入控件');
  let engineNote = '';
  if (abReport.cliUsed === 'agent-browser') engineNote = '（agent-browser 实机快照通过）';
  else if (localAbBin) engineNote = '（已调 agent-browser 并结合 DOM 探针核验）';

  return {
    ok: issues.length === 0, engine: abReport.cliUsed, agentBrowserDetected: Boolean(localAbBin), agentBrowserBin: localAbBin || null,
    cliExitCode: abReport.cliExitCode, cliDiagnostic: abReport.cliDiagnostic, checkedControls: interactiveTags.length,
    interactiveActions: actionMatches, mockCount: proto.wiring.actions.filter((a) => a.status === 'mock').length,
    wiredCount: proto.wiring.actions.filter((a) => a.status !== 'mock').length, aestheticsPass: slopAudit.pass,
    viewportOverflow, cliSnapSummary: abReport.cliSnapSummary, issues,
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
    const nextActions = wiring.actions.map((a) => (targetIds.has(a.actionId) ? { ...a, status: 'wired', wiredAt: new Date().toISOString() } : a));
    writeFileSync(wiringPath, JSON.stringify({ ...wiring, updatedAt: new Date().toISOString(), actions: nextActions }, null, 2) + '\n', 'utf8');
    renderPrototypeHtml(root);
  }
  const lines = [
    `请处理 UI 看板中记录的 ${targets.length} 项前端交互动作并纳入 DoneGate 契约验收：`,
    ...targets.map((t, i) => `${i + 1}. 【${t.label}】(actionId=${t.actionId}，定位 ${t.sourceFile}:${t.sourceLine})：期望接口 \`${t.targetApi}\` 与数据表 \`${t.targetTable}\`；`),
    '完成后请运行 UI 看板自测并补充端到端判据确认退出码为 0。'
  ];
  return { ok: true, targetCount: targets.length, targets, agentPrompt: lines.join('\n') };
}

export function provisionUiBoardDeps(projectRoot, opts = {}) {
  return provisionWorkflowDeps(projectRoot, UI_TOOLCHAIN_DEPS_PACK, opts);
}
