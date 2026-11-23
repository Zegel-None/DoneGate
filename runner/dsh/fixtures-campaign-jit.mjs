// DSH 预置工作流打底、节点级即时派生 (JIT)、真实适配器观测、GitHub Star、项目导入与 UI 桥端到端断言夹具
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { executeDeterministicWorkflowRun } from './workflow-runner.mjs';
import { inspectWorkflowDeps, provisionWorkflowDeps } from './workflow-deps.mjs';
import {
  assignComponentWorkflow, mutateComponentWorkflowJit, promoteComponentJitToMacro
} from './workflow-jit.mjs';
import { executeProjectCampaignAutopilot } from './campaign-autopilot.mjs';
import { AESTHETIC_GROUPS, AESTHETIC_PROPOSALS, buildInjectedUiBridgeScript } from './contract.mjs';
import { auditHtmlAntiAiSlop } from './ui-aesthetics.mjs';
import { detectProjectUiEntry, renderPrototypeHtml } from './ui-board-engine.mjs';
import { createDoneGateWebRouteHandler } from './host-routes.mjs';

function verifyJitMacroLifecycle() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-jit-wf-'));
  try {
    const uiComp = {
      id: 'calc-ui', title: '计算器按键与显示屏界面', tip: 'React 界面与弹窗交互',
      scopePaths: ['src/ui/'], modules: [{ name: 'CalcView', role: '界面', path: 'src/ui/CalcView.tsx' }]
    };
    const engineComp = {
      id: 'calc-engine', title: '科学计算核心逻辑模块', tip: '纯函数四则与浮点运算',
      scopePaths: ['src/core/'], modules: [{ name: 'evalExpr', role: '逻辑', path: 'src/core/eval.mjs' }]
    };

    // (A) 执行端 Worker 严禁选配或篡改验收工作流
    const deniedAssign = assignComponentWorkflow(tmp, engineComp, { actorRole: 'worker' });
    assert.equal(deniedAssign.ok, false);
    assert.equal(deniedAssign.code, 'WORKER_CANNOT_MUTATE_WORKFLOW');

    // (B) 总控自动为不同组件匹配对应基准工作流（且优先命中零外部未装依赖的 pack-core-logic）
    const assignedUi = assignComponentWorkflow(tmp, uiComp, { actorRole: 'super-agent' });
    const assignedEng = assignComponentWorkflow(tmp, engineComp, { actorRole: 'super-agent' });
    assert.equal(assignedUi.ok, true);
    assert.equal(assignedUi.binding.baseMacroId, 'pack-web');
    assert.equal(assignedEng.ok, true);
    assert.equal(assignedEng.binding.baseMacroId, 'pack-core-logic');
    assert.equal(assignedEng.binding.depsReady, true);

    // (C) 改需求时在当前节点局部节点派生（不污染全局工作流，且禁止注入非标脚本）
    const badBrick = mutateComponentWorkflowJit(tmp, engineComp, { actorRole: 'super-agent', addTplIds: ['raw-shell-hack'] });
    assert.equal(badBrick.ok, false);
    assert.equal(badBrick.code, 'UNKNOWN_BRICK_REJECTED');

    const mutated = mutateComponentWorkflowJit(tmp, engineComp, {
      actorRole: 'super-agent',
      requirementText: '改需求：支持自定义公式语法解析，并联网拉取实时汇率 API'
    });
    assert.equal(mutated.ok, true);
    assert.equal(mutated.binding.mode, 'jit-forked');
    assert.ok(mutated.binding.tplIds.includes('tpl-openspec'));
    assert.ok(mutated.binding.tplIds.includes('tpl-gitleaks'));
    assert.ok(mutated.binding.tplIds.includes('tpl-anti-slop'));
    assert.ok(mutated.binding.deltaCount >= 2);

    // (D) 底座护栏「只增不减」安全锁：自动卸载底线护栏必须被拦截并要求人工审批
    const apiComp = {
      id: 'calc-rate-api', title: '汇率鉴权与收银接口', tip: 'OAuth 与密钥签名',
      scopePaths: ['src/api/'], modules: [{ name: 'rateApi', role: '接口', path: 'src/api/rate.ts' }]
    };
    assignComponentWorkflow(tmp, apiComp, { actorRole: 'super-agent' });
    const locked = mutateComponentWorkflowJit(tmp, apiComp, {
      actorRole: 'super-agent',
      removeTplIds: ['tpl-gitleaks']
    });
    assert.equal(locked.ok, false);
    assert.equal(locked.code, 'MANDATORY_FLOOR_LOCKED');
    assert.equal(locked.requiresHumanApproval, true);

    const humanOk = mutateComponentWorkflowJit(tmp, apiComp, {
      actorRole: 'human',
      removeTplIds: ['tpl-gitleaks'],
      humanApprovedFloorRemoval: true
    });
    assert.equal(humanOk.ok, true);
    assert.ok(!humanOk.binding.tplIds.includes('tpl-gitleaks'));
    assert.ok(humanOk.binding.tplIds.includes('tpl-anti-slop'), '防手搓核心护栏仍保持守底');

    // (E) 一键另存为全局预置工作流 (.workflow.json)
    const promoted = promoteComponentJitToMacro(tmp, engineComp.id, {
      actorRole: 'human',
      macroId: 'calc-formula-fx',
      name: '公式与汇率联防工作流'
    });
    assert.equal(promoted.ok, true);
    assert.ok(existsSync(join(tmp, 'workflows', 'calc-formula-fx.workflow.json')));
    assert.equal(promoted.binding.mode, 'macro');
    assert.equal(promoted.binding.baseMacroId, 'calc-formula-fx');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function verifySharedDepsAndRealAdapter(tmp) {
  const gitInit = (args) => spawnSync('git', ['-C', tmp, ...args], { encoding: 'utf8' });
  gitInit(['init', '-q', '-b', 'main']);
  gitInit(['config', 'user.email', 'test@donegate.local']);
  gitInit(['config', 'user.name', 'DoneGate Test']);
  writeFileSync(join(tmp, '.gitignore'), '.donegate/\nworkflows/.deps/\n');
  writeFileSync(join(tmp, '.gitleaksignore'), '.donegate/**\nworkflows/.deps/**\n');
  mkdirSync(join(tmp, 'src/core'), { recursive: true });
  mkdirSync(join(tmp, 'src/api'), { recursive: true });
  mkdirSync(join(tmp, 'src/ui'), { recursive: true });
  writeFileSync(join(tmp, 'src/core/calc.mjs'), 'export const add = (a, b) => a + b;\n');
  writeFileSync(join(tmp, 'src/api/rate.mjs'), 'export const rate = () => 7.2;\n');
  writeFileSync(join(tmp, 'src/ui/view.mjs'), "export const render = () => 'ok';\n");
  gitInit(['add', '-A']);
  gitInit(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init project']);

  // (A) 共享底座池 workflows/.deps/_shared/：一次补齐后，派生 JIT 工作流零重复下载直接复用
  const webPack = { id: 'pack-web', name: '网页全栈开发包', nodes: [{ id: 'n1', tplId: 'tpl-playwright' }, { id: 'n2', tplId: 'tpl-biome-knip' }] };
  provisionWorkflowDeps(tmp, webPack, { markInstalledIds: ['playwright', 'biome'] });
  const uiNode = { id: 'comp-ui', title: '界面视图组件', scopePaths: ['src/ui/'], modules: [{ name: 'view', role: '界面', path: 'src/ui/view.mjs' }] };
  assignComponentWorkflow(tmp, uiNode, { actorRole: 'super-agent' });
  const forkedUi = mutateComponentWorkflowJit(tmp, uiNode, { actorRole: 'super-agent', requirementText: '新增复杂公式语法解析规格校验' });
  assert.equal(forkedUi.ok, true);
  provisionWorkflowDeps(tmp, { id: 'seed-os', nodes: [{ id: 'no', tplId: 'tpl-openspec' }] }, { markInstalledIds: ['openspec'] });
  const depForked = inspectWorkflowDeps(tmp, forkedUi.binding.pack, { env: { PATH: '' } });
  assert.equal(depForked.ready, true, '派生 JIT 新版工作流必须直接命中 _shared 共享底座池就绪状态');
  assert.ok(depForked.items.some((x) => x.resolvedVia === 'shared-manifest'));

  // (B) 真实适配器执行桥：构造共享池 mock gitleaks（兼容 noexec 宿主真机 gitleaks），验证落盘 observation.json 与 1/0 裁决
  const sharedBin = join(tmp, 'workflows', '.deps', '_shared', '.bin');
  mkdirSync(sharedBin, { recursive: true });
  const mockLeakTrigger = join(tmp, 'LEAK_MODE.flag');
  const mockGitleaksImpl = join(sharedBin, 'mock-gitleaks-impl.cjs');
  writeFileSync(mockGitleaksImpl, `const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "version") { console.log("8.30.1"); process.exit(0); }
const i = a.indexOf("--report-path");
const leak = fs.existsSync(${JSON.stringify(mockLeakTrigger)});
fs.writeFileSync(a[i + 1], JSON.stringify(leak ? [{ RuleID: "generic-api-key", File: "src/api/rate.mjs", StartLine: 1 }] : []));
`, 'utf8');
  const mockGitleaks = join(sharedBin, process.platform === 'win32' ? 'gitleaks.cmd' : 'gitleaks');
  if (process.platform === 'win32') {
    writeFileSync(mockGitleaks, `@echo off\r\n"${process.execPath}" "%~dp0mock-gitleaks-impl.cjs" %*\r\n`, 'utf8');
  } else {
    writeFileSync(mockGitleaks, `#!/usr/bin/env sh\nexec "${process.execPath}" "${mockGitleaksImpl}" "$@"\n`, { mode: 0o755 });
  }
  const apiNode = { id: 'comp-api', title: '汇率鉴权接口', scopePaths: ['src/api/'], modules: [{ name: 'rate', role: '接口', path: 'src/api/rate.mjs' }] };
  const apiAssign = assignComponentWorkflow(tmp, apiNode, { actorRole: 'super-agent', preferredMacroId: 'pack-api-guard' });
  assert.equal(apiAssign.ok, true);

  writeFileSync(mockLeakTrigger, 'GITHUB_TOKEN=ghp_' + 'x9k2m4p7'.repeat(5) + '\n');
  gitInit(['add', '-A']);
  gitInit(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'enable leak simulation']);
  const leakRun = await executeDeterministicWorkflowRun(tmp, { ticketId: 'real-adp-fail' }, apiAssign.binding.pack, { useWorktreeSandbox: false, useFingerprintCache: false });
  assert.equal(leakRun.ok, false, '检出疑似密钥时必须经 check-brick-observations 判红返回 exit 1');
  assert.equal(leakRun.exitCode, 1);
  assert.ok(existsSync(join(tmp, '.donegate/adapters/gitleaks/observation.json')), '必须真实调用适配器落盘 observation.json');

  rmSync(mockLeakTrigger, { force: true });
  rmSync(join(tmp, '.donegate/adapters/gitleaks'), { recursive: true, force: true });
  gitInit(['add', '-A']);
  gitInit(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'clean leak simulation']);
  const cleanRun = await executeDeterministicWorkflowRun(tmp, { ticketId: 'real-adp-pass' }, apiAssign.binding.pack, { useWorktreeSandbox: false, useFingerprintCache: false });
  assert.equal(cleanRun.ok, true, '密钥清零后真实适配器 + 观测断言器应返回 exit 0');

  return { uiNode, apiNode };
}

async function verifyProjectCampaignTopology(tmp, { uiNode, apiNode }) {
  const executionOrder = [];
  const coreNode = { id: 'comp-core', title: '计算核心底座', scopePaths: ['src/core/'], nextIds: ['comp-api'], modules: [{ name: 'calc', role: '逻辑', path: 'src/core/calc.mjs' }] };
  const apiNodeDag = { ...apiNode, nextIds: ['comp-ui'] };
  const uiNodeDag = { ...uiNode, nextIds: [] };
  assignComponentWorkflow(tmp, coreNode, { actorRole: 'super-agent', preferredMacroId: 'pack-core-logic' });
  assignComponentWorkflow(tmp, uiNodeDag, { actorRole: 'super-agent', preferredMacroId: 'pack-core-logic', forceReassign: true });

  const badCampaign = await executeProjectCampaignAutopilot(tmp, {
    campaignId: 'camp-scope-breach', nodes: [uiNodeDag, apiNodeDag, coreNode], useWorktreeSandbox: true
  }, {
    componentHooks: {
      'comp-core': {
        runAgentStep: ({ workCwd }) => {
          writeFileSync(join(workCwd, 'src/ui/view.mjs'), 'export const hacked = true;\n');
          return { summary: 'out-of-scope write' };
        }
      }
    }
  });
  assert.equal(badCampaign.ok, false);
  assert.equal(badCampaign.code, 'WRITE_SCOPE_VIOLATION');
  assert.equal(badCampaign.failedComponentId, 'comp-core');
  assert.equal(readFileSync(join(tmp, 'src/ui/view.mjs'), 'utf8'), "export const render = () => 'ok';\n", '越界熔断后主工作区必须 100% 干净零污染');

  const okCampaign = await executeProjectCampaignAutopilot(tmp, {
    campaignId: 'camp-clean-pass', nodes: [uiNodeDag, apiNodeDag, coreNode], useWorktreeSandbox: true
  }, {
    componentHooks: {
      'comp-core': {
        runAgentStep: ({ workCwd }) => {
          executionOrder.push('comp-core');
          writeFileSync(join(workCwd, 'src/core/calc.mjs'), 'export const add = (a, b) => Number(a) + Number(b);\n');
          return { summary: 'hardened core' };
        }
      },
      'comp-ui': {
        runAgentStep: ({ workCwd }) => {
          executionOrder.push('comp-ui');
          writeFileSync(join(workCwd, 'src/ui/view.mjs'), "export const render = () => 'v2-ok';\n");
          return { summary: 'updated ui' };
        }
      }
    }
  });
  assert.equal(okCampaign.ok, true);
  assert.deepEqual(okCampaign.orderedIds, ['comp-core', 'comp-api', 'comp-ui'], '必须按组件依赖拓扑顺序依次挂机');
  assert.deepEqual(executionOrder, ['comp-core', 'comp-ui']);
  assert.equal(okCampaign.sandboxWorktree.mergedToMain, true);
  assert.ok(readFileSync(join(tmp, 'src/core/calc.mjs'), 'utf8').includes('Number(a)'));
  assert.ok(readFileSync(join(tmp, 'src/ui/view.mjs'), 'utf8').includes('v2-ok'));
}

async function verifyStarImportAestheticsAndUiBridge(tmp) {
  // 1) 12 套分组美学方案 + Puck 安装探测 + 全屏无白底高度
  assert.equal(AESTHETIC_GROUPS.length, 4);
  assert.equal(AESTHETIC_PROPOSALS.length, 12);
  for (const id of ['swiss-minimal', 'bento-craft', 'industrial-dark', 'neo-brutal', 'enterprise-dense']) {
    assert.ok(AESTHETIC_PROPOSALS.some((p) => p.id === id), `必须保留兼容方案 ${id}`);
  }
  for (const p of AESTHETIC_PROPOSALS) {
    assert.ok(AESTHETIC_GROUPS.includes(p.group), `方案 ${p.id} 分组必须合法`);
    const proto = renderPrototypeHtml(tmp, { proposalId: p.id });
    assert.equal(auditHtmlAntiAiSlop(proto.html).pass, true, `方案 ${p.id} 不得含紫粉渐变或 Emoji 按钮`);
    assert.ok(proto.html.includes('html, body { min-height: 100%; margin: 0;'));
  }
  assert.equal(detectProjectUiEntry(tmp).puckInstalled, false);
  const puckPkg = join(tmp, 'workflows', '.deps', '_shared', 'npm', 'node_modules', '@puckeditor', 'core', 'package.json');
  mkdirSync(join(puckPkg, '..'), { recursive: true });
  writeFileSync(puckPkg, '{"name":"@puckeditor/core"}\n', 'utf8');
  assert.equal(detectProjectUiEntry(tmp).puckInstalled, true);

  // 2) UI 桥纯 Alt+单击拾取：普通点击 100% 原生放行，Alt+左键仅发 1 次胶囊且抑制 800ms 内 pointerup/click
  const docListeners = {};
  const winListeners = {};
  const posted = [];
  const appended = [];
  const btnEl = {
    tagName: 'BUTTON', id: 'save-btn', innerText: '保存单据', outerHTML: '<button id="save-btn">保存单据</button>',
    getAttribute: (k) => (k === 'data-dg-action' ? 'act-save' : (k === 'data-dg-wiring' ? 'mock' : (k === 'data-dg-source' ? 'src/App.tsx:42:3' : null))),
    closest: () => btnEl,
    getBoundingClientRect: () => ({ left: 20, top: 40, bottom: 72, width: 96, height: 32 })
  };
  const bodyEl = { appendChild: (el) => appended.push(el) };
  const winObj = {
    location: { pathname: '/' }, innerWidth: 1024,
    parent: { postMessage: (msg) => posted.push(msg) },
    addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); }
  };
  const docObj = {
    body: bodyEl, documentElement: { style: { setProperty() {} } },
    createElement: () => ({ style: {}, setAttribute() {}, getAttribute: () => '1' }),
    addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); }
  };
  vm.runInNewContext(buildInjectedUiBridgeScript(), { window: winObj, document: docObj, Date, Math, Object, String, Number });

  const makeEv = (extra = {}) => {
    const ev = { target: btnEl, altKey: false, button: 0, prevented: false, stopped: false, ...extra };
    ev.preventDefault = () => { ev.prevented = true; };
    ev.stopPropagation = () => { ev.stopped = true; };
    ev.stopImmediatePropagation = () => { ev.stopped = true; };
    return ev;
  };
  const normalClick = makeEv({ altKey: false });
  for (const fn of (docListeners.click || [])) fn(normalClick);
  assert.equal(normalClick.prevented, false, '普通点击严禁被 preventDefault 拦截');
  assert.equal(posted.filter((m) => m.type === 'dg-ui:element-selected').length, 0);
  assert.equal(posted.filter((m) => m.type === 'dg-ui:test-action-triggered').length, 1);

  for (const fn of (docListeners.pointermove || [])) fn(makeEv({ altKey: true }));
  assert.equal(appended[0].style.display, 'block', 'Alt 悬停时必须显示蓝色虚线 hoverBox');
  for (const fn of (winListeners.keyup || [])) fn({ key: 'Alt', altKey: false });
  assert.equal(appended[0].style.display, 'none', '松开 Alt 时必须立即隐藏 hoverBox');

  const altDown = makeEv({ altKey: true, button: 0 });
  const altUp = makeEv({ altKey: false, button: 0 });
  const altFollowClick = makeEv({ altKey: false, button: 0 });
  for (const fn of (docListeners.pointerdown || [])) fn(altDown);
  for (const fn of (docListeners.pointerup || [])) fn(altUp);
  for (const fn of (docListeners.click || [])) fn(altFollowClick);
  assert.equal(altDown.prevented && altUp.prevented && altFollowClick.prevented, true, 'Alt 拾取必须拦截按下与释放余波');
  const selMsgs = posted.filter((m) => m.type === 'dg-ui:element-selected');
  assert.equal(selMsgs.length, 1, '一次 Alt+单击必须且只能发送 1 次选中胶囊');
  assert.equal(selMsgs[0].payload.sourceFile, 'src/App.tsx');
  assert.equal(selMsgs[0].payload.sourceLine, 42);

  // 3) GitHub Star 204/401 本地仿真与外部陈旧项目导入路由
  const mockGh = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    res.writeHead(auth === 'Bearer valid-tok' ? 204 : 401);
    res.end();
  });
  await new Promise((r) => mockGh.listen(0, '127.0.0.1', r));
  const ghBase = `http://127.0.0.1:${mockGh.address().port}`;
  const emptyHome = join(tmp, 'empty-home');
  mkdirSync(emptyHome, { recursive: true });
  try {
    const invokeRoute = async (method, subPath, bodyObj, routeOpts = {}) => {
      const handler = createDoneGateWebRouteHandler(tmp, routeOpts);
      let status = 200;
      let raw = '';
      const fakeReq = {
        method, url: `/donegate/api${subPath}`, headers: {},
        on(ev, cb) {
          if (ev === 'data' && bodyObj !== null) cb(Buffer.from(JSON.stringify(bodyObj)));
          if (ev === 'end') cb();
        },
        destroy() {}
      };
      const fakeRes = { writeHead(s) { status = s; }, end(chunk) { raw = chunk || ''; } };
      await handler(fakeReq, fakeRes, subPath);
      return { status, json: raw ? JSON.parse(raw) : null };
    };

    const badSlug = await invokeRoute('POST', '/github/star', { repoSlug: '../evil' }, { githubApiBase: ghBase, skipGhCli: true });
    assert.equal(badSlug.status, 400);
    const r401 = await invokeRoute('POST', '/github/star', { repoSlug: 'measuredco/puck' }, { githubApiBase: ghBase, skipGhCli: true, githubToken: 'bad-tok', homeDir: emptyHome });
    assert.equal(r401.status, 200);
    assert.equal(r401.json.ok, false);
    assert.equal(r401.json.unauthenticated, true);

    const r204 = await invokeRoute('POST', '/github/star', { repoSlug: 'measuredco/puck', star: true }, { githubApiBase: ghBase, skipGhCli: true, githubToken: 'valid-tok', homeDir: emptyHome });
    assert.equal(r204.status, 200);
    assert.equal(r204.json.ok, true);
    assert.equal(r204.json.via, 'github-rest');
    const stAfterStar = JSON.parse(readFileSync(join(tmp, '.donegate', 'workbench-state.json'), 'utf8'));
    assert.ok(stAfterStar.starredRepos.includes('measuredco/puck'));

    const legacyDir = join(tmp, 'legacy-erp');
    mkdirSync(join(legacyDir, 'src'), { recursive: true });
    writeFileSync(join(legacyDir, 'package.json'), '{"name":"legacy-erp"}\n', 'utf8');
    writeFileSync(join(legacyDir, 'src', 'billing.mjs'), 'export const bill = () => 100;\n', 'utf8');
    const impRes = await invokeRoute('POST', '/project/import', { targetDir: legacyDir });
    assert.equal(impRes.status, 200);
    assert.equal(impRes.json.ok, true);
    assert.equal(impRes.json.sandbox.id, 'imp-legacy-erp');
    assert.equal(impRes.json.sandbox.importedFrom, resolve(legacyDir));
    assert.ok(impRes.json.sandbox.nodes.length >= 1);
  } finally {
    mockGh.close();
  }
}

export async function runJitAndCampaignChecks(check) {
  await check('9. 预置工作流打底 + 节点级即时派生 (JIT)：总控/Worker 权限隔离、底座只增不减安全锁与一键另存为工作流', () => {
    verifyJitMacroLifecycle();
  });

  await check('10. 真实适配器观测落盘、跨工作流共享池、项目挂机、GitHub Star/导入与 UI 桥纯 Alt 拾取闭环', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-p0-full-'));
    try {
      const ctx = await verifySharedDepsAndRealAdapter(tmp);
      await verifyProjectCampaignTopology(tmp, ctx);
      await verifyStarImportAestheticsAndUiBridge(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
