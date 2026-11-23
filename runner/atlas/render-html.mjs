// 零外网依赖单文件工作台 HTML 拼装器（由 WB_CONCAT_MANIFEST 单一数据源驱动样式、骨架与前端模块顺序拼装）
import { buildWbStyleBase } from './wb-style-base.mjs';
import { buildWbStyleCanvas } from './wb-style-canvas.mjs';
import { buildWbDshStyle } from './wb-dsh-style.mjs';
import { buildWbDom } from './wb-dom.mjs';
import { buildWbCatalog } from './wb-catalog.mjs';
import { buildWbGraphEngine } from './wb-graph-engine.mjs';
import { buildWbLayoutTidy } from './wb-layout-tidy.mjs';
import { buildWbRenderCards } from './wb-render-cards.mjs';
import { buildWbRenderWires } from './wb-render-wires.mjs';
import { buildWbSubagent } from './wb-subagent.mjs';
import { buildWbSnapRulers } from './wb-snap-rulers.mjs';
import { buildWbMenusViewport } from './wb-menus-viewport.mjs';
import { buildWbViewportOps } from './wb-viewport-ops.mjs';
import { buildWbEventsWheelDrop } from './wb-events-wheel-drop.mjs';
import { buildWbEventsPointer } from './wb-events-pointer.mjs';
import { buildWbInlineRename } from './wb-inline-rename.mjs';
import { buildWbEventsActions } from './wb-events-actions.mjs';
import { buildWbHistoryScript } from './wb-history.mjs';
import { buildViewsScript } from './ui-views.mjs';
import { buildWbDshBridge } from './wb-dsh-bridge.mjs';
import { buildWbUiBoardScript } from './wb-uiboard.mjs';
import { buildWbJitWorkflowScript } from './wb-jit-workflow.mjs';
import { buildShellScript } from './ui-shell.mjs';
import { buildWbDshShell } from './wb-dsh-shell.mjs';

const WB_CONCAT_ENTRIES = [
  { stage: 'style', path: 'runner/atlas/wb-style-base.mjs', exportName: 'buildWbStyleBase', subpack: '@canvas', build: buildWbStyleBase },
  { stage: 'style', path: 'runner/atlas/wb-style-canvas.mjs', exportName: 'buildWbStyleCanvas', subpack: '@canvas', build: buildWbStyleCanvas },
  { stage: 'style', path: 'runner/atlas/wb-dsh-style.mjs', exportName: 'buildWbDshStyle', subpack: '@dsh-dock', build: buildWbDshStyle },
  { stage: 'dom', path: 'runner/atlas/wb-dom.mjs', exportName: 'buildWbDom', subpack: '@canvas', build: buildWbDom },
  { stage: 'script', path: 'runner/atlas/wb-catalog.mjs', exportName: 'buildWbCatalog', subpack: '@workflow', build: buildWbCatalog },
  { stage: 'script', path: 'runner/atlas/wb-graph-engine.mjs', exportName: 'buildWbGraphEngine', subpack: '@canvas', build: buildWbGraphEngine },
  { stage: 'script', path: 'runner/atlas/wb-layout-tidy.mjs', exportName: 'buildWbLayoutTidy', subpack: '@canvas', build: buildWbLayoutTidy },
  { stage: 'script', path: 'runner/atlas/wb-render-cards.mjs', exportName: 'buildWbRenderCards', subpack: '@canvas', build: buildWbRenderCards },
  { stage: 'script', path: 'runner/atlas/wb-render-wires.mjs', exportName: 'buildWbRenderWires', subpack: '@canvas', build: buildWbRenderWires },
  { stage: 'script', path: 'runner/atlas/wb-subagent.mjs', exportName: 'buildWbSubagent', subpack: '@workflow', build: buildWbSubagent },
  { stage: 'script', path: 'runner/atlas/wb-snap-rulers.mjs', exportName: 'buildWbSnapRulers', subpack: '@canvas', build: buildWbSnapRulers },
  { stage: 'script', path: 'runner/atlas/wb-menus-viewport.mjs', exportName: 'buildWbMenusViewport', subpack: '@canvas', build: buildWbMenusViewport },
  { stage: 'script', path: 'runner/atlas/wb-viewport-ops.mjs', exportName: 'buildWbViewportOps', subpack: '@canvas', build: buildWbViewportOps },
  { stage: 'script', path: 'runner/atlas/wb-events-wheel-drop.mjs', exportName: 'buildWbEventsWheelDrop', subpack: '@canvas', build: buildWbEventsWheelDrop },
  { stage: 'script', path: 'runner/atlas/wb-events-pointer.mjs', exportName: 'buildWbEventsPointer', subpack: '@canvas', build: buildWbEventsPointer },
  { stage: 'script', path: 'runner/atlas/wb-inline-rename.mjs', exportName: 'buildWbInlineRename', subpack: '@canvas', build: buildWbInlineRename },
  { stage: 'script', path: 'runner/atlas/wb-events-actions.mjs', exportName: 'buildWbEventsActions', subpack: '@canvas', build: buildWbEventsActions },
  { stage: 'script', path: 'runner/atlas/wb-history.mjs', exportName: 'buildWbHistoryScript', subpack: '@canvas', build: buildWbHistoryScript },
  { stage: 'script', path: 'runner/atlas/ui-views.mjs', exportName: 'buildViewsScript', subpack: '@scanner', build: buildViewsScript },
  { stage: 'script', path: 'runner/atlas/wb-dsh-bridge.mjs', exportName: 'buildWbDshBridge', subpack: '@dsh-dock', build: buildWbDshBridge },
  { stage: 'script', path: 'runner/atlas/wb-uiboard.mjs', exportName: 'buildWbUiBoardScript', subpack: '@uiboard', build: buildWbUiBoardScript },
  { stage: 'script', path: 'runner/atlas/wb-jit-workflow.mjs', exportName: 'buildWbJitWorkflowScript', subpack: '@workflow', build: buildWbJitWorkflowScript },
  { stage: 'script', path: 'runner/atlas/ui-shell.mjs', exportName: 'buildShellScript', subpack: '@workflow', build: buildShellScript },
  { stage: 'script', path: 'runner/atlas/wb-dsh-shell.mjs', exportName: 'buildWbDshShell', subpack: '@dsh-dock', build: buildWbDshShell }
];

export const WB_CONCAT_MANIFEST = Object.freeze(
  WB_CONCAT_ENTRIES.map(({ stage, path, exportName, subpack }) => Object.freeze({ stage, path, exportName, subpack }))
);

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAtlasWorkbenchHtml(atlas) {
  const safeJson = JSON.stringify(atlas || {}).replace(/</g, '\\u003c');
  const projName = escapeHtml(atlas?.project?.name || 'DoneGate');

  const cssText = WB_CONCAT_ENTRIES.filter((x) => x.stage === 'style').map((x) => x.build()).join('\n');
  const domText = WB_CONCAT_ENTRIES.filter((x) => x.stage === 'dom').map((x) => x.build()).join('\n');
  const scriptText = [
    `let ATLAS = ${safeJson};`,
    ...WB_CONCAT_ENTRIES.filter((x) => x.stage === 'script').map((x) => x.build())
  ].join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN" data-theme="light">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${projName} · 完结门工作台（DeepSeek Harness Web 视图）</title>`,
    '  <style>',
    cssText,
    '  </style>',
    '</head>',
    '<body class="flex flex-col">',
    domText,
    '  <script>',
    scriptText,
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
}
