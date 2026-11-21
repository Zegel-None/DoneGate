// 零外网依赖单文件工作台 HTML 拼装器（汇聚 12 个高内聚语义模块，浏览器端合并为单脚本零请求开销）
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
import { buildWbMenusViewport } from './wb-menus-viewport.mjs';
import { buildWbEventsPointer } from './wb-events-pointer.mjs';
import { buildWbEventsActions } from './wb-events-actions.mjs';
import { buildWbHistoryScript } from './wb-history.mjs';
import { buildViewsScript } from './ui-views.mjs';
import { buildWbDshBridge } from './wb-dsh-bridge.mjs';
import { buildWbUiBoardScript } from './wb-uiboard.mjs';
import { buildShellScript } from './ui-shell.mjs';
import { buildWbDshShell } from './wb-dsh-shell.mjs';

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAtlasWorkbenchHtml(atlas) {
  const safeJson = JSON.stringify(atlas || {}).replace(/</g, '\\u003c');
  const projName = escapeHtml(atlas?.project?.name || 'DoneGate');

  const cssText = [
    buildWbStyleBase(),
    buildWbStyleCanvas(),
    buildWbDshStyle()
  ].join('\n');

  const domText = buildWbDom();

  const scriptText = [
    `let ATLAS = ${safeJson};`,
    buildWbCatalog(),
    buildWbGraphEngine(),
    buildWbLayoutTidy(),
    buildWbRenderCards(),
    buildWbRenderWires(),
    buildWbSubagent(),
    buildWbMenusViewport(),
    buildWbEventsPointer(),
    buildWbEventsActions(),
    buildWbHistoryScript(),
    buildViewsScript(),
    buildWbDshBridge(),
    buildWbUiBoardScript(),
    buildShellScript(),
    buildWbDshShell()
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
