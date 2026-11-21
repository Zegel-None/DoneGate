// 零外网依赖单文件工作台 HTML 拼装器（汇聚无界无限画布、100步撤销重做、DSH原生引用胶囊、悬停扁条与两行验真微卡，<= 150 行）
import { buildWbStyleA } from './wb-style-a.mjs';
import { buildWbStyleB } from './wb-style-b.mjs';
import { buildWbStyleC } from './wb-style-c.mjs';
import { buildWbStyleD } from './wb-style-d.mjs';
import { buildWbDshStyle } from './wb-dsh-style.mjs';
import { buildWbDomA } from './wb-dom-a.mjs';
import { buildWbDomB } from './wb-dom-b.mjs';
import { buildWbLogicA } from './wb-logic-a.mjs';
import { buildWbLogicB } from './wb-logic-b.mjs';
import { buildWbLogicC } from './wb-logic-c.mjs';
import { buildWbLogicD } from './wb-logic-d.mjs';
import { buildWbLogicE } from './wb-logic-e.mjs';
import { buildWbLogicF } from './wb-logic-f.mjs';
import { buildWbLogicG } from './wb-logic-g.mjs';
import { buildWbLogicH } from './wb-logic-h.mjs';
import { buildWbLogicI } from './wb-logic-i.mjs';
import { buildWbLogicJ } from './wb-logic-j.mjs';
import { buildWbLogicK } from './wb-logic-k.mjs';
import { buildWbLogicL } from './wb-logic-l.mjs';
import { buildWbLogicM } from './wb-logic-m.mjs';
import { buildWbLogicN } from './wb-logic-n.mjs';
import { buildWbLogicO } from './wb-logic-o.mjs';
import { buildWbLogicP } from './wb-logic-p.mjs';
import { buildWbLogicQ } from './wb-logic-q.mjs';
import { buildWbLogicR } from './wb-logic-r.mjs';
import { buildWbLogicS } from './wb-logic-s.mjs';
import { buildWbLogicT } from './wb-logic-t.mjs';
import { buildWbLogicU } from './wb-logic-u.mjs';
import { buildWbLogicV } from './wb-logic-v.mjs';
import { buildWbLogicW } from './wb-logic-w.mjs';
import { buildWbLogicX } from './wb-logic-x.mjs';
import { buildWbHistoryScript } from './wb-history.mjs';
import { buildViewsScript } from './ui-views.mjs';
import { buildWbDshBridge } from './wb-dsh-bridge.mjs';
import { buildShellScript } from './ui-shell.mjs';
import { buildWbDshShell } from './wb-dsh-shell.mjs';

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAtlasWorkbenchHtml(atlas) {
  const safeJson = JSON.stringify(atlas || {}).replace(/</g, '\\u003c');
  const projName = escapeHtml(atlas?.project?.name || 'DoneGate');

  const cssText = [
    buildWbStyleA(),
    buildWbStyleB(),
    buildWbStyleC(),
    buildWbStyleD(),
    buildWbDshStyle()
  ].join('\n');

  const domText = [
    buildWbDomA(),
    buildWbDomB()
  ].join('\n');

  const scriptText = [
    `let ATLAS = ${safeJson};`,
    buildWbLogicA(),
    buildWbLogicB(),
    buildWbLogicC(),
    buildWbLogicD(),
    buildWbLogicE(),
    buildWbLogicF(),
    buildWbLogicG(),
    buildWbLogicH(),
    buildWbLogicI(),
    buildWbLogicJ(),
    buildWbLogicK(),
    buildWbLogicL(),
    buildWbLogicM(),
    buildWbLogicN(),
    buildWbLogicO(),
    buildWbLogicP(),
    buildWbLogicQ(),
    buildWbLogicR(),
    buildWbLogicS(),
    buildWbLogicT(),
    buildWbLogicU(),
    buildWbLogicV(),
    buildWbLogicW(),
    buildWbLogicX(),
    buildWbHistoryScript(),
    buildViewsScript(),
    buildWbDshBridge(),
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
