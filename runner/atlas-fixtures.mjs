// 全栈项目活体全景工作台（工作流 + 项目看板 + 无界画布 + uiOwner 全链路路由 + 单卡微门禁解耦）端到端自检夹具
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createChecks } from '../skill/assert.mjs';
import { dispatchCommand } from './donegate.mjs';
import { ATLAS_SUBPACKS, buildProjectAtlas, startAtlasHttpServer, WB_CONCAT_MANIFEST } from './atlas/index.mjs';
import { buildWbDshBridge } from './atlas/wb-dsh-bridge.mjs';
import { buildWbDshShell } from './atlas/wb-dsh-shell.mjs';
import { buildWbUiBoardScript } from './atlas/wb-uiboard.mjs';
import { parseQuoteCapsule } from './dsh/contract.mjs';
import { exportDashboardHtml } from './core/index.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'dg-atlas-e2e-'));

function git(cwd, args, extraEnv = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout || '').trim();
}

try {
  // 1. 构造含 Next.js 前端 + FastAPI 后端 + 双语言 CLI + OpenSpec + Beads + 多支线撞车/休眠的真实项目
  const proj = join(tmp, 'fullstack-shop');
  mkdirSync(proj, { recursive: true });
  dispatchCommand(['init', '.'], proj);
  writeFileSync(join(proj, '.gitignore'), '.donegate/\nworkflows/.deps/\n');
  writeFileSync(join(proj, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['apps/web/*'] } }
  }, null, 2));
  writeFileSync(join(proj, 'package.json'), JSON.stringify({
    name: 'fullstack-shop',
    bin: { 'shop-sync': './packages/cli/sync.mjs' }
  }, null, 2));
  writeFileSync(join(proj, 'pyproject.toml'), [
    '[project]',
    'name = "shop-backend"',
    '[project.scripts]',
    'export-csv = "services.cli.legacy_csv:run_export"'
  ].join('\n') + '\n');

  mkdirSync(join(proj, 'apps/web/lib'), { recursive: true });
  mkdirSync(join(proj, 'apps/web/app/checkout'), { recursive: true });
  writeFileSync(join(proj, 'apps/web/lib/http.ts'), '// 统一网络请求封装\nexport async function apiPost(url: string) { return fetch(url); }\n');
  writeFileSync(join(proj, 'apps/web/app/checkout/page.tsx'), [
    'import { apiPost } from "@/lib/http";',
    'export default function CheckoutPage(orderId: string) {',
    '  fetch(`/api/v1/orders/${orderId}`);',
    '  apiPost("/api/v1/orders");',
    '  return <main><h1>确认结账付款</h1></main>;',
    '}'
  ].join('\n') + '\n');

  mkdirSync(join(proj, 'services/core'), { recursive: true });
  mkdirSync(join(proj, 'services/api'), { recursive: true });
  mkdirSync(join(proj, 'services/cli'), { recursive: true });
  writeFileSync(join(proj, 'services/core/__init__.py'), '');
  writeFileSync(join(proj, 'services/core/ledger.py'), '"""账本清结算核心"""\ndef append_entry(amount: int) -> bool:\n    return amount > 0\n');
  writeFileSync(join(proj, 'services/api/orders.py'), [
    'from fastapi import APIRouter',
    'from ..core.ledger import append_entry',
    'router = APIRouter(prefix="/api/v1")',
    '@router.post("/orders", summary="提交新订单")',
    'async def create_order():',
    '    return append_entry(100)',
    '@router.get("/orders/{order_id}")',
    'def get_order_detail(order_id: str):',
    '    """查询单笔订单详情"""',
    '    return {"id": order_id}'
  ].join('\n') + '\n');

  writeFileSync(join(proj, 'services/cli/legacy_csv.py'), [
    '# 历史账单表格导出工具',
    'from services.core.ledger import append_entry',
    'def run_export():',
    '    return append_entry(1)'
  ].join('\n') + '\n');

  mkdirSync(join(proj, 'packages/cli'), { recursive: true });
  writeFileSync(join(proj, 'packages/cli/sync.mjs'), '// 每日订单自动对账脚本\nexport function syncOrders() { return true; }\n');

  mkdirSync(join(proj, 'openspec/specs/checkout'), { recursive: true });
  writeFileSync(join(proj, 'openspec/specs/checkout/spec.md'), '# 结账与支付主流程\n');
  mkdirSync(join(proj, 'openspec/changes/partial-refund'), { recursive: true });
  writeFileSync(join(proj, 'openspec/changes/partial-refund/proposal.md'), '# 支持订单部分退款\n');
  mkdirSync(join(proj, '.beads'), { recursive: true });
  writeFileSync(join(proj, '.beads/issues.jsonl'), JSON.stringify({ id: 'bd-12', title: '核对退款幂等性', status: 'open' }) + '\n');

  dispatchCommand(['contract', 'new', 'shop-main', '--title', '商城核心链路', '--scope', 'apps/web/,services/api/,services/core/,packages/cli/'], proj);

  git(proj, ['init', '-q', '-b', 'main']);
  git(proj, ['config', 'user.email', 'dev@local']);
  git(proj, ['config', 'user.name', 'Dev']);
  git(proj, ['add', '.']);
  git(proj, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init main']);

  git(proj, ['checkout', '-q', '-b', 'feat/card-pay']);
  writeFileSync(join(proj, 'services/api/orders.py'), readFileSync(join(proj, 'services/api/orders.py'), 'utf8') + '\n# card pay hook\n');
  git(proj, ['add', '.']);
  git(proj, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add card pay']);

  git(proj, ['checkout', '-q', 'main']);
  git(proj, ['checkout', '-q', '-b', 'feat/refund-v2']);
  writeFileSync(join(proj, 'services/api/orders.py'), readFileSync(join(proj, 'services/api/orders.py'), 'utf8') + '\n# refund v2 hook\n');
  git(proj, ['add', '.']);
  git(proj, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add refund v2']);

  git(proj, ['checkout', '-q', 'main']);
  git(proj, ['checkout', '-q', '-b', 'exp/old-csv']);
  writeFileSync(join(proj, 'services/cli/legacy_csv.py'), readFileSync(join(proj, 'services/cli/legacy_csv.py'), 'utf8') + '\n# wip csv\n');
  git(proj, ['add', '.']);
  const pastIso = new Date(Date.now() - 20 * 86400000).toISOString();
  git(proj, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'wip csv export'], {
    GIT_AUTHOR_DATE: pastIso,
    GIT_COMMITTER_DATE: pastIso
  });
  git(proj, ['checkout', '-q', 'main']);

  // 2. 执行全景盘点与工作台注水断言
  const atlas = buildProjectAtlas(proj);

  const epCheckout = atlas.entrypoints.find((e) => e.kind === 'web-page' && e.routePath === '/checkout');
  c.check('自动提取 Next.js 页面路由与 <h1> 大白话标题',
    Boolean(epCheckout && epCheckout.humanTitle === '确认结账付款'), JSON.stringify(epCheckout));

  const epPostOrder = atlas.entrypoints.find((e) => e.kind === 'fastapi-route' && e.routePath === '/api/v1/orders');
  const epGetOrder = atlas.entrypoints.find((e) => e.kind === 'fastapi-route' && e.routePath === '/api/v1/orders/{order_id}');
  c.check('自动拼合 FastAPI prefix 路由并提取 summary 与 docstring 白话标题',
    Boolean(epPostOrder?.humanTitle === '提交新订单' && epGetOrder?.humanTitle === '查询单笔订单详情'));

  const hasBinCli = atlas.entrypoints.some((e) => e.kind === 'node-cli' && e.id === 'ep:bin:shop-sync');
  const hasPyCli = atlas.entrypoints.some((e) => e.kind === 'py-cli' && e.id === 'ep:pyscript:export-csv');
  c.check('同时识别 package.json bin 与 pyproject.toml scripts 命令行入口', hasBinCli && hasPyCli);

  const hasTsAliasEdge = atlas.edges.some((e) => e.from === 'mod:apps/web/app/checkout/page.tsx' && e.to === 'mod:apps/web/lib/http.ts');
  const hasHttpBridge = atlas.edges.some((e) => e.kind === 'http-bridge' && e.from === 'mod:apps/web/app/checkout/page.tsx' && e.to === 'mod:services/api/orders.py');
  const hasPyRelEdge = atlas.edges.some((e) => e.kind === 'py-import' && e.from === 'mod:services/api/orders.py' && e.to === 'mod:services/core/ledger.py');
  c.check('打通 TS @/ 别名、前端到 FastAPI 跨语言 HTTP 桥接与 Python 相对包导入完整调用链',
    hasTsAliasEdge && hasHttpBridge && hasPyRelEdge);

  const wildMod = atlas.modules.find((m) => m.path === 'services/cli/legacy_csv.py');
  c.check('未挂契约模块自动标为「还没加保护」并生成自然语言 AI 补保护指令',
    Boolean(wildMod && wildMod.isWild && wildMod.vibeLabel === '还没加保护' && wildMod.aiPrompt.includes('services/cli/legacy_csv.py')));

  const brCard = atlas.branches.find((b) => b.name === 'feat/card-pay');
  const brCsv = atlas.branches.find((b) => b.name === 'exp/old-csv');
  c.check('Git 支线雷达精准检出跨支线撞车（orders.py）与 20 天停工搁置支线',
    Boolean(brCard?.status === 'collision-warn' && brCard.collidesWith.some((x) => x.branch === 'feat/refund-v2' && x.files.includes('services/api/orders.py')) && brCsv?.status === 'dormant' && brCsv.idleDays >= 19));

  c.check('自动汇聚 OpenSpec 已沉淀规格、在研变更提案与 Beads 待办任务',
    atlas.specs.settled.length === 1 && atlas.specs.activeChanges.length === 1 && atlas.specs.beadsOpen.length === 1);

  const hostSb = atlas.workbench?.hostSandbox;
  const webNode = hostSb?.nodes?.find((n) => (n.scopePaths || []).includes('apps/web/'));
  const hasAdpCatalog = Array.isArray(atlas.workbench?.registeredTemplates) &&
    atlas.workbench.registeredTemplates.some((t) => t.tplId === 'tpl-adp-stryker' && t.repoUrl.startsWith('https://github.com/'));
  c.check('工作台按契约 scope[] 映射项目看板真实目录（ADR-005）并注入适配器注册表外部工具与锁死版本',
    Boolean(hostSb && hostSb.isHost === true && hostSb.readonly === false && webNode && webNode.contractIds.includes('shop-main') && hasAdpCatalog));

  // 3. 核验零外网单文件工作台 HTML（含无界拖曳、100步 Ctrl+Z/Ctrl+Y、工作流一键补齐依赖按钮与右键菜单）
  const stHtml = dispatchCommand(['status', '--html', '.donegate/dashboard.html'], proj);
  const htmlPath = join(proj, '.donegate', 'dashboard.html');
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
  const hasExternalUrl = /<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*['"]https?:\/\//i.test(html);
  const hasOldCoordClamp = /Math\.max\(16,\s*Math\.round\(orig\./.test(html) || /Math\.max\(54,\s*Math\.round\(orig\./.test(html);
  c.check('生成零外网单文件工作台 HTML（含无界拖曳、100 步撤销重做、工作流行内补齐按钮与右键依赖菜单）',
    stHtml.exitCode === 0 &&
    !hasExternalUrl &&
    !hasOldCoordClamp &&
    html.includes('undoLastAction()') &&
    html.includes('redoLastAction()') &&
    html.includes('maxSteps: 100') &&
    html.includes('stepEdgeAutoPan') &&
    html.includes('body.dark-mode') &&
    html.includes('toggleTheme()') &&
    html.includes('refreshBackendData()') &&
    html.includes('刷新最新数据') &&
    html.includes('项目看板') &&
    html.includes('工作流') &&
    html.includes('provision-pack-deps') &&
    html.includes('openWorkflowPackContextMenu') &&
    html.includes('一键补齐此工作流依赖') &&
    html.includes('triggerProvisionWorkflowDeps') &&
    html.includes('dg-card-telemetry') &&
    html.includes('exportActiveWorkflowJson') &&
    html.includes('importWorkflowJsonText') &&
    html.includes('triggerJudgePackForCard') &&
    html.includes('id="uiboard-stage"') &&
    html.includes('renderUiBoardDrawer') &&
    html.includes('在文件夹中打开') &&
    html.includes('data-sel-text') &&
    existsSync(join(proj, '.donegate/atlas.json')) &&
    existsSync(join(proj, '.donegate/project.c4')));

  c.check('Alt+单击防双蓝胶囊、SVG/下拉实名拾取与工作流/项目条目蓝胶囊完备',
    ['_suppressAltClickUntil', 'swallowAltFollowup', "closest('button, select')", 'data-ctrl-id', "workflow: '工作流'", "project: '项目'"].every((k) => html.includes(k)));

  c.check('/donegate/api/* 优先探测、真编队补齐子代理、真 GitHub Star 与项目导入/分组折叠事件接线完备',
    ['/donegate/api/ping', 'spawnSubagent: true', 'dg:dispatch-subagent', 'provision-node-dep', '/donegate/api/github/star', '/donegate/api/project/init', '/donegate/api/project/import', 'toggle-wf-grp', 'toggle-node-cat', 'focus-wf-group', 'rename-pack'].every((k) => html.includes(k)) &&
    !html.includes('state.provisionedPacks[pk.id] = true') && !html.includes("e.target.id === 'sel-host-sim'"));

  c.check('UI 看板 <optgroup> 分组下拉、去手搓模式按钮、.h-full 全高内嵌窗口与 JIT 双窗口对比标绿完备',
    ['<optgroup', 'uib-theme-select', 'h-full', 'flex:1 1 0%;width:100%;height:100%;border:0;display:block;', "kind: 'ui'", '基准工作流：', '当前生效确定性工作流', 'Agent根据需求微调', 'deriveAutonomousTunedTplIds', 'is-diff-green'].every((k) => html.includes(k)) &&
    ['uib-mode-edit', 'data-uib-act="add-block"', 'data-jit-switch-macro', 'dg-jit-req-input', 'data-jit-run-mutate'].every((k) => !html.includes(k)));

  const railAssetsIdx = html.indexOf('data-rail-tab="assets"');
  const railWfIdx = html.indexOf('data-rail-tab="workflows"');
  const railNodesIdx = html.indexOf('data-rail-tab="nodes"');
  c.check('左栏快捷导航顺序为「项目 → 工作流 → 节点」',
    railAssetsIdx > 0 && railWfIdx > railAssetsIdx && railNodesIdx > railWfIdx);

  // 3b. 核验五大功能子包 ATLAS_SUBPACKS、WB_CONCAT_MANIFEST 顺序同步与全区域 data-ui-owner / DG-TARGET 拾取闭环
  const subpackKeys = Object.keys(ATLAS_SUBPACKS);
  const allSubpackFiles = subpackKeys.flatMap((k) => ATLAS_SUBPACKS[k]);
  const diskAtlasFiles = readdirSync(join(REPO, 'runner/atlas'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `runner/atlas/${f}`)
    .sort();
  const renderHtmlSrc = readFileSync(join(REPO, 'runner/atlas/render-html.mjs'), 'utf8');
  const manifestPaths = WB_CONCAT_MANIFEST.map((x) => x.path);
  let lastImportPos = -1;
  const manifestOrderMatchesRender = manifestPaths.every((relPath) => {
    const baseFile = `./${relPath.slice('runner/atlas/'.length)}`;
    const pos = renderHtmlSrc.indexOf(baseFile);
    const ok = pos > lastImportPos && ATLAS_SUBPACKS[WB_CONCAT_MANIFEST.find((m) => m.path === relPath).subpack]?.includes(relPath);
    lastImportPos = pos;
    return ok;
  });
  c.check('ATLAS_SUBPACKS 五大功能子包零遗漏覆盖全部模块，且 WB_CONCAT_MANIFEST 与 render-html.mjs 拼装顺序一致',
    JSON.stringify(subpackKeys) === JSON.stringify(['@scanner', '@canvas', '@uiboard', '@workflow', '@dsh-dock']) &&
    JSON.stringify([...allSubpackFiles].sort()) === JSON.stringify(diskAtlasFiles) &&
    new Set(allSubpackFiles).size === allSubpackFiles.length &&
    WB_CONCAT_MANIFEST.length === 24 &&
    manifestOrderMatchesRender);

  const requiredOwnerSnippets = [
    '<header data-ui-owner="runner/atlas/ui-shell.mjs"',
    'id="left-icon-rail" data-ui-owner="runner/atlas/ui-shell.mjs"',
    'id="left-drawer" data-ui-owner="runner/atlas/wb-layout-tidy.mjs"',
    'id="cards-layer" data-ui-owner="runner/atlas/wb-render-cards.mjs"',
    'data-ui-owner="runner/atlas/wb-render-cards.mjs"',
    'id="uiboard-stage" data-ui-owner="runner/atlas/wb-uiboard.mjs"',
    'class="dg-jit-modal" data-ui-owner="runner/atlas/wb-jit-workflow.mjs"',
    'id="ctx-root-menu" data-ui-owner="runner/atlas/wb-menus-viewport.mjs"',
    'id="atlas-overview-modal" data-ui-owner="runner/atlas/ui-views.mjs"',
    'id="dsh-input-dock" data-ui-owner="runner/atlas/wb-dsh-shell.mjs"'
  ];
  c.check('工作台 HTML 顶栏、左栏、画布节点卡、UI 看板、JIT 弹窗、菜单、子视图与抽屉均含精准 data-ui-owner 标注',
    requiredOwnerSnippets.every((s) => html.includes(s)));

  // 在隔离 VM 中实跑 wb-dsh-bridge + wb-uiboard + wb-dsh-shell 拾取器，验证点击外壳/左栏/节点卡/弹窗/UI看板均注入准确 uiOwner 与 sliceCmd
  {
    const docListeners = {};
    const winListeners = {};
    const makeDomEl = (opts = {}) => {
      const attrs = opts.attrs || {};
      const el = {
        id: opts.id || '',
        tagName: opts.tag || 'DIV',
        textContent: opts.text || '',
        className: '',
        style: {},
        parentElement: opts.parent || null,
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
        appendChild() {},
        focus() {},
        addEventListener() {},
        querySelectorAll: () => [],
        closest(sel) {
          let cur = el;
          while (cur) {
            if (sel === '[data-ui-owner]' && cur.getAttribute('data-ui-owner')) return cur;
            if (sel === 'button, select' && (cur.tagName === 'BUTTON' || cur.tagName === 'SELECT')) return cur;
            if (sel === '[data-switch-pack]' && cur.getAttribute('data-switch-pack')) return cur;
            if (sel === '[data-card-id]' && cur.getAttribute('data-card-id')) return cur;
            cur = cur.parentElement;
          }
          return null;
        }
      };
      return el;
    };
    const bodyEl = makeDomEl({ tag: 'BODY' });
    const vmWin = {
      location: { search: '', protocol: 'file:' },
      innerWidth: 1280,
      addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); }
    };
    const vmDoc = {
      body: bodyEl,
      documentElement: makeDomEl({ tag: 'HTML' }),
      getElementById: () => null,
      querySelector: () => null,
      createElement: (t) => makeDomEl({ tag: String(t).toUpperCase() }),
      addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); }
    };
    const vmCtx = vm.createContext({
      window: vmWin, location: vmWin.location, document: vmDoc, URLSearchParams, Map, Set, Date, Math, Object, String, Number, Array, Boolean, JSON,
      encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
      esc: (s) => String(s ?? ''), showToast() {}, renderAll() {}, renderLeftDrawer() {}, fitCanvas() {},
      closeCascadingMenus() {}, applyThemeClasses() {}, applyAllControlStyleOverrides() {},
      state: { page: 'sandbox', activePackId: 'pack-web', viewingRepoId: 'host-workspace', selectedNodeIds: new Set(), controlStyleOverrides: {}, panX: 0, panY: 0, scale: 1 },
      WORKFLOW_PACKS: { 'pack-web': { id: 'pack-web', name: '现代前端工作流', nodes: [] } },
      REPO_SANDBOXES: { 'host-workspace': { id: 'host-workspace', name: '商城主仓', isHost: true, nodes: [webNode] } },
      ATLAS: atlas,
      getActiveNodesList: () => [webNode],
      getActiveGroupsList: () => [],
      getSelectionInfo: () => ({ kind: 'single', node: webNode }),
      resolveNodeFolders: (nd) => (nd.scopePaths || []).map((d) => ({ dir: d, file: d, note: '' }))
    });
    Object.assign(vmCtx, vmWin); vmCtx.window = vmCtx;
    vm.runInContext([buildWbDshBridge(), buildWbUiBoardScript(), buildWbDshShell(), 'window.__dshRuntime = dshRuntime;'].join('\n'), vmCtx);

    const fireAltDown = (target) => {
      const ev = { target, altKey: true, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
      for (const fn of (docListeners.pointerdown || [])) fn(ev);
    };
    const headerDom = makeDomEl({ tag: 'HEADER', attrs: { 'data-ui-owner': 'runner/atlas/ui-shell.mjs' }, parent: bodyEl });
    const headerBtn = makeDomEl({ tag: 'BUTTON', id: 'btn-autopilot', text: '挂机长跑', parent: headerDom });
    const drawerDom = makeDomEl({ tag: 'ASIDE', id: 'left-drawer', attrs: { 'data-ui-owner': 'runner/atlas/wb-layout-tidy.mjs' }, parent: bodyEl });
    const wfRowEl = makeDomEl({ tag: 'DIV', text: '现代前端工作流', attrs: { 'data-switch-pack': 'pack-web' }, parent: drawerDom });
    const cardDom = makeDomEl({ tag: 'ARTICLE', attrs: { 'data-card-id': webNode.id, 'data-ui-owner': 'runner/atlas/wb-render-cards.mjs' }, parent: bodyEl });
    const jitBtn = makeDomEl({ tag: 'BUTTON', text: '+ gitleaks', attrs: { 'data-jit-add-tpl': 'tpl-adp-gitleaks' }, parent: bodyEl });

    fireAltDown(headerBtn);
    fireAltDown(wfRowEl);
    fireAltDown(cardDom);
    fireAltDown(jitBtn);
    for (const fn of (winListeners.message || [])) {
      await fn({
        data: {
          source: 'dg-ui-bridge',
          type: 'dg-ui:element-selected',
          payload: { tag: 'button', label: '立即付款', sourceFile: 'apps/web/PayBtn.tsx', sourceLine: 19, actionId: 'act-pay', uiOwner: 'runner/atlas/wb-uiboard.mjs' }
        }
      });
    }

    const parsedQuotes = vmCtx.__dshRuntime.quotes.map((q) => parseQuoteCapsule(q.text));
    c.check('wb-dsh-shell 与 ui-board-bridge 拾取全区域元素 100% 注入 uiOwner/sliceCmd，且画布契约节点卡同时保留业务域 scopes',
      parsedQuotes.length === 5 &&
      parsedQuotes[0]?.uiOwner === 'runner/atlas/ui-shell.mjs' &&
      parsedQuotes[0]?.sliceCmd === 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/ui-shell.mjs' &&
      parsedQuotes[1]?.uiOwner === 'runner/atlas/wb-layout-tidy.mjs' &&
      parsedQuotes[2]?.uiOwner === 'runner/atlas/wb-render-cards.mjs' &&
      parsedQuotes[2]?.contracts.includes('shop-main') &&
      parsedQuotes[2]?.scopes.includes('apps/web/') &&
      parsedQuotes[3]?.uiOwner === 'runner/atlas/wb-jit-workflow.mjs' &&
      parsedQuotes[4]?.uiOwner === 'runner/atlas/wb-uiboard.mjs' &&
      parsedQuotes[4]?.scopes.includes('apps/web/PayBtn.tsx') &&
      parsedQuotes[4]?.sliceCmd === 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-uiboard.mjs');
  }

  // 4. 真测后台实时服务：刷新重扫 + 负坐标落盘 + 目录解析 + 工作流依赖巡检与隔离补齐路由
  const srvInfo = await startAtlasHttpServer(proj, { port: 0, idleExitSec: 30 });
  try {
    const beforeCount = atlas.project.moduleCount;
    writeFileSync(join(proj, 'services/api/coupons.py'), [
      'from fastapi import APIRouter',
      'router = APIRouter(prefix="/api/v1")',
      '@router.post("/coupons", summary="发放优惠券")',
      'def issue_coupon():',
      '    return {"issued": True}'
    ].join('\n') + '\n');
    const resp = await fetch(`${srvInfo.url}api/atlas/refresh`, { method: 'POST' });
    const refreshed = await resp.json();
    const diskHtmlAfter = readFileSync(htmlPath, 'utf8');
    c.check('点击「刷新最新数据」触发后台重扫全仓，新增接口即时入账并同步落盘',
      Boolean(
        resp.ok &&
        refreshed.ok &&
        refreshed.atlas.project.moduleCount === beforeCount + 1 &&
        refreshed.atlas.entrypoints.some((e) => e.humanTitle === '发放优惠券') &&
        diskHtmlAfter.includes('发放优惠券')
      ));

    const saveResp = await fetch(`${srvInfo.url}api/workbench/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customPacks: { 'pack-u-e2e': { id: 'pack-u-e2e', name: '端到端持久化包', group: '客户端与全栈', nodes: [], links: [] } },
        hostNodeLayouts: { [webNode.id]: { x: -640, y: -1280, w: 310, h: 220, color: 'blue' } },
        textOverrides: { 'chrome:agent-title': '专职验收子代理' }
      })
    });
    const saveJson = await saveResp.json();
    const rehydrated = buildProjectAtlas(proj);
    const savedWeb = rehydrated.workbench.hostSandbox.nodes.find((n) => n.id === webNode.id);
    c.check('工作台负向无界拖曳坐标 (-640, -1280)、自定义开发包与文本改名实时落盘且重扫不丢',
      Boolean(
        saveResp.ok &&
        saveJson.ok &&
        existsSync(join(proj, '.donegate/workbench-state.json')) &&
        rehydrated.workbench.savedState.customPacks['pack-u-e2e']?.name === '端到端持久化包' &&
        savedWeb?.x === -640 && savedWeb?.y === -1280 && savedWeb?.w === 310 &&
        rehydrated.workbench.savedState.textOverrides['chrome:agent-title'] === '专职验收子代理'
      ));

    const provResp = await fetch(`${srvInfo.url}donegate/api/workflow-deps/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pack: {
          id: 'pack-stage-01',
          name: '阶段一规格审校流',
          deps: [{ id: 'spec-cli-x', title: 'SpecCLI', repo: 'acme/spec-cli-x', version: 'v1.0.0', kind: 'git', bin: 'spec-cli-x-uninstalled', allowHostEnv: false }],
          nodes: []
        }
      })
    });
    const provJson = await provResp.json();
    c.check('工作台一键补齐依赖接口自动建好 workflows/.deps/<id>/ 并返回后台 Agent 补齐工单',
      Boolean(
        provResp.ok &&
        provJson.ok &&
        provJson.depsDir === 'workflows/.deps/pack-stage-01' &&
        provJson.missingCount === 1 &&
        existsSync(join(proj, 'workflows/.deps/pack-stage-01/PROVISION-PLAN.json'))
      ));

    const wfSaveResp = await fetch(`${srvInfo.url}donegate/api/workflow-pack/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pack: { id: "shared-comfy-flow", name: "跨团队共享工作流", group: "项目声明式工作流", nodes: [{ id: "n1", title: "静态体检", tplId: "tpl-adp-biome" }], links: [] }
      })
    });
    const wfSaveJson = await wfSaveResp.json();
    mkdirSync(join(proj, ".donegate/adapters/biome"), { recursive: true });
    writeFileSync(join(proj, ".donegate/adapters/biome/observation.json"), JSON.stringify({ errors: 0, checkedFiles: 12 }, null, 2));
    const obsPrevResp = await fetch(`${srvInfo.url}donegate/api/observation-preview?tool=biome&nodeId=n1`);
    const obsPrevJson = await obsPrevResp.json();
    const judgePreResp = await fetch(`${srvInfo.url}donegate/api/judge/pack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId: "non-existent" })
    });
    const judgePreJson = await judgePreResp.json();
    c.check("工作流 .workflow.json 导入落盘、适配器 observation.json 直看与门 5 盲审打包接口全链路联通",
      Boolean(
        wfSaveResp.ok && wfSaveJson.ok && existsSync(join(proj, "workflows/shared-comfy-flow.workflow.json")) &&
        obsPrevResp.ok && obsPrevJson.ok && obsPrevJson.content.includes('"checkedFiles": 12') &&
        judgePreResp.ok && judgePreJson.exitCode === 3
      ));

    // 真测三阶段 Agent Native UI 看板全套接口（含本地 DevServer 同源注入代理与 SSRF 拦截）
    const mockDevSrv = createServer((mReq, mRes) => {
      mRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      mRes.end('<!DOCTYPE html><html><head><title>DevApp</title></head><body><button data-insp-path="apps/web/PayBtn.tsx:19:5">立即付款</button></body></html>');
    });
    await new Promise((r) => mockDevSrv.listen(0, '127.0.0.1', r));
    const devPort = mockDevSrv.address().port;
    try {
      const uibSt = await (await fetch(`${srvInfo.url}donegate/api/uiboard/status`)).json();
      const bridgeTxt = await (await fetch(`${srvInfo.url}donegate/api/uiboard/bridge.js`)).text();
      const proxyHtml = await (await fetch(`${srvInfo.url}donegate/api/uiboard/proxy?url=` + encodeURIComponent(`http://127.0.0.1:${devPort}/`))).text();
      const ssrfResp = await fetch(`${srvInfo.url}donegate/api/uiboard/proxy?url=` + encodeURIComponent('https://example.com/'));
      const lockRes = await (await fetch(`${srvInfo.url}donegate/api/uiboard/theme-lock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: 'industrial-dark', projectName: 'DemoApp' })
      })).json();
      const layRes = await (await fetch(`${srvInfo.url}donegate/api/uiboard/layout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'add', blockType: 'confirm_modal_trigger' })
      })).json();
      const spRes = await (await fetch(`${srvInfo.url}donegate/api/uiboard/self-play`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      })).json();
      const wireRes = await (await fetch(`${srvInfo.url}donegate/api/uiboard/wire-backend`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionIds: ['act-create-order'], markWired: true })
      })).json();
      const uibProv = await (await fetch(`${srvInfo.url}donegate/api/uiboard/provision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      })).json();
      c.check('UI 看板三阶段闭环：同源代理注入桥（防 SSRF）、多套美学锁 MASTER.md、JSON 拖拽加块、Agent 自测与假动作转真后端全通',
        Boolean(
          uibSt.ok && (uibSt.uiboard.allProposals || uibSt.uiboard.proposals).length >= 3 &&
          bridgeTxt.includes('dg-ui:element-selected') && bridgeTxt.includes('resolveUiOwner') && bridgeTxt.includes('dg-ui:apply-tokens') && !bridgeTxt.includes('dg-ui:set-mode') &&
          proxyHtml.includes('PayBtn.tsx:19:5') && proxyHtml.includes('/donegate/api/uiboard/bridge.js') &&
          ssrfResp.status === 400 &&
          lockRes.ok && existsSync(join(proj, 'design-system/MASTER.md')) &&
          layRes.ok && layRes.layout.content.length === 5 &&
          spRes.ok && spRes.checkedControls >= 5 && spRes.aestheticsPass === true &&
          wireRes.ok && wireRes.targetCount === 1 && wireRes.uiboard.wiring.actions.find((a) => a.actionId === 'act-create-order')?.status === 'wired' &&
          uibProv.ok && uibProv.depsDir === 'workflows/.deps/uiboard'
        ));
    } finally {
      mockDevSrv.close();
    }

    const folderResp = await fetch(`${srvInfo.url}api/workbench/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['apps/web/', 'services/api/orders.py', '../../../etc/passwd'], openOs: false })
    });
    const folderJson = await folderResp.json();
    const rList = folderJson.resolved || [];
    c.check('「在文件夹中打开」精确解析契约 scope[] 真实目录，并拦截越界路径穿越',
      Boolean(
        folderResp.ok &&
        folderJson.ok &&
        rList[0]?.exists === true && rList[0]?.blocked === false &&
        rList[1]?.exists === true && rList[1]?.absPath?.endsWith('api') &&
        rList[2]?.blocked === true && rList[2]?.absPath === null
      ));
  } finally {
    srvInfo.server.close();
  }

  // 5. 本仓自举导出冒烟
  const selfOut = join(tmp, 'self-dashboard.html');
  const selfRes = exportDashboardHtml(REPO, selfOut);
  c.check('本仓自举导出离线全景工作台 HTML 成功', selfRes.ok && existsSync(selfOut));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let ranCrossCardDshSuite = false;
if (process.env.DONEGATE_MICRO_GATE !== '1') {
  const { runAllDshChecks } = await import('./dsh-fixtures.mjs');
  await runAllDshChecks();
  ranCrossCardDshSuite = true;
}
c.check(
  process.env.DONEGATE_MICRO_GATE === '1'
    ? '单卡微门禁模式 (DONEGATE_MICRO_GATE=1) 已解耦跳过跨卡 runAllDshChecks()'
    : 'DSH Web 创造模式插件包、Windows 路径与插槽 VM 自检全过',
  ranCrossCardDshSuite === (process.env.DONEGATE_MICRO_GATE !== '1')
);
c.summary('Project Atlas 全栈工作台端到端自检');
process.exit(c.bad > 0 ? 1 : 0);
