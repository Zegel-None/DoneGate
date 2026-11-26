// 共享底座池、完结门画布实时刷新、DSH 动态会话工作区与 UI 看板四件套真激活端到端回归单测
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CATALOG_PACK_SPECS, buildInjectedUiBridgeScript, parseFlexibleDepsManifest,
  provisionWorkflowDeps, readUiToolchainStatus, readWorkflowDepsStatus
} from '../runner/dsh/index.mjs';
import { buildDshBundleDirectory } from '../runner/dsh/install-dsh-web.mjs';

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeExecutableMock(binDir, name, jsBody) {
  mkdirSync(binDir, { recursive: true });
  const impl = join(binDir, `${name}-impl.cjs`);
  writeFileSync(impl, jsBody, 'utf8');
  const posix = join(binDir, name);
  writeFileSync(posix, `#!/usr/bin/env sh\nexec "${process.execPath}" "${impl}" "$@"\n`, 'utf8');
  try { chmodSync(posix, 0o755); } catch (err) { void err; }
  writeFileSync(posix + '.cmd', `@echo off\r\n"${process.execPath}" "%~dp0${name}-impl.cjs" %*\r\n`, 'utf8');
  writeFileSync(posix + '.bat', `@echo off\r\n"${process.execPath}" "%~dp0${name}-impl.cjs" %*\r\n`, 'utf8');
}

describe('共享底座池自包含 CLI、repair-git 安全锁、版本一致性与多形态清单兜底', () => {
  it('无 runner 目录的纯外部用户工作区可直接运行 dg-deps-cli.mjs，且 repair-git 绝不吞人类未提交改动', () => {
    const extWs = makeTempDir('dg-ext-ws-');
    try {
      expect(existsSync(join(extWs, 'runner'))).toBe(false);
      const prov = provisionWorkflowDeps(extWs, BUILTIN_CATALOG_PACK_SPECS['pack-android']);
      const cliAbs = join(extWs, 'workflows', '.deps', '_shared', 'dg-deps-cli.mjs');
      expect(existsSync(cliAbs)).toBe(true);
      expect(prov.agentPrompt).toContain('workflows/.deps/_shared/dg-deps-cli.mjs');
      expect(prov.agentPrompt).not.toContain('runner/dsh/workflow-deps.mjs');

      writeExecutableMock(join(extWs, 'workflows', '.deps', '_shared', 'dists', 'gradle-8.10.2', 'bin'), 'gradle',
        'console.log("Gradle 8.10.2");\n');

      const lnRes = spawnSync(process.execPath, [cliAbs, 'write-launchers', '--bin', 'gradle', '--dist', 'gradle-8.10.2'], { cwd: extWs, encoding: 'utf8' });
      expect(lnRes.status).toBe(0);
      const batTxt = readFileSync(join(extWs, 'workflows', '.deps', '_shared', '.bin', 'gradle.bat'), 'utf8');
      expect(Buffer.from(batTxt, 'utf8').every((b) => b <= 0x7f)).toBe(true);
      expect(batTxt).toContain('..\\.gradle-home');
      expect(batTxt).toContain('GRADLE_USER_HOME=');

      const mkOk = spawnSync(process.execPath, [
        cliAbs, 'mark-ready', '--id', 'gradle', '--workflow', 'pack-android', '--workflow-label', '安卓应用工作流',
        '--label', 'Gradle 8.10.2', '--version', '8.10.2', '--detected-version', '8.10.2', '--dist', 'gradle-8.10.2', '--run-verify'
      ], { cwd: extWs, encoding: 'utf8' });
      expect(mkOk.status).toBe(0);

      // 版本号不一致拦截：expected 1.39.0 vs detected 1.38.0 严禁标绿，refresh 亦不得洗白
      const mkBadVer = spawnSync(process.execPath, [
        cliAbs, 'mark-ready', '--id', 'maestro', '--workflow', 'pack-android', '--label', 'Maestro CLI',
        '--version', '1.39.0', '--detected-version', '1.38.0'
      ], { cwd: extWs, encoding: 'utf8' });
      expect(mkBadVer.status).toBe(0);
      expect(JSON.parse(mkBadVer.stdout).ready).toBe(false);
      expect(JSON.parse(mkBadVer.stdout).status).toBe('version-mismatch');

      const wfManifest = JSON.parse(readFileSync(join(extWs, 'workflows', '.deps', 'pack-android', 'manifest.json'), 'utf8'));
      expect(wfManifest.label).toBe('安卓应用工作流');

      const rfRes = spawnSync(process.execPath, [cliAbs, 'refresh', '--workflow', 'pack-android'], { cwd: extWs, encoding: 'utf8' });
      expect(rfRes.status).toBe(0);
      const packRep = readWorkflowDepsStatus(extWs, BUILTIN_CATALOG_PACK_SPECS['pack-android']);
      expect(packRep.items.find((x) => x.id === 'gradle')?.ready).toBe(true);
      expect(packRep.items.find((x) => x.id === 'maestro')?.ready).toBe(false);

      // 验证 repair-git 仅清理 index.lock + read-tree --reset HEAD，绝不执行 git add -A 吞掉人类未暂存/未跟踪文件
      const gitRun = (args) => spawnSync('git', ['-C', extWs, ...args], { encoding: 'utf8' });
      gitRun(['init', '-q', '-b', 'main']);
      gitRun(['config', 'user.email', 'dev@local.test']);
      gitRun(['config', 'user.name', 'Dev']);
      writeFileSync(join(extWs, 'tracked.txt'), 'v1\n', 'utf8');
      gitRun(['add', 'tracked.txt']);
      gitRun(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
      writeFileSync(join(extWs, 'tracked.txt'), 'v2-human-dirty\n', 'utf8');
      writeFileSync(join(extWs, 'human-draft.md'), 'keep untracked\n', 'utf8');
      writeFileSync(join(extWs, '.git', 'index.lock'), 'stale', 'utf8');

      const repGit = spawnSync(process.execPath, [cliAbs, 'repair-git', '--repo', '.'], { cwd: extWs, encoding: 'utf8' });
      expect(repGit.status).toBe(0);
      expect(existsSync(join(extWs, '.git', 'index.lock'))).toBe(false);
      expect(gitRun(['diff', '--cached', '--name-only']).stdout.trim()).toBe('');
      expect(readFileSync(join(extWs, 'tracked.txt'), 'utf8')).toBe('v2-human-dirty\n');
      expect(readFileSync(join(extWs, 'human-draft.md'), 'utf8')).toBe('keep untracked\n');
    } finally {
      rmSync(extWs, { recursive: true, force: true });
    }
  });

  it('兼容多形态 manifest.json 结构（deps / entries / tools[] / 顶层键值）', () => {
    const p1 = parseFlexibleDepsManifest({ deps: { gradle: { status: 'ready', version: '8.10.2', repo: 'gradle/gradle' } } });
    expect(p1.lookup(['gradle/gradle'])?.ready).toBe(true);
    const p2 = parseFlexibleDepsManifest({ tools: [{ name: 'maestro', ready: true, version: '1.39.0' }] });
    expect(p2.lookup(['maestro'])?.ready).toBe(true);
    const p3 = parseFlexibleDepsManifest({ gradle: { status: 'ready', version: '8.10.2' } });
    expect(p3.lookup(['gradle'])?.ready).toBe(true);
    const p4 = parseFlexibleDepsManifest({ installed: { puck: { id: 'puck', pkg: '@puckeditor/core', ready: true, version: '0.24.1' } } });
    expect(p4.lookup(['@puckeditor/core'])?.id).toBe('puck');
    expect(p4.lookup(['@stryker-mutator/core'])).toBeNull();
  });
});

describe('DSH 会话动态工作区、免重下二进制兜底识别、画布刷新同步与 UI 看板四件套真激活', () => {
  it('动态路由至用户会话工作区，点刷新同步 Gradle 8.10.2 变绿并真激活 UI 看板四件套', async () => {
    const rootTmp = makeTempDir('dg-dsh-e2e-');
    const bundleDir = join(rootTmp, 'bundle');
    const installRoot = process.cwd();
    const sessionWs = join(rootTmp, 'DSH-DoneGate V4');
    mkdirSync(sessionWs, { recursive: true });
    writeFileSync(join(sessionWs, 'package.json'), '{"name":"user-win11-app"}\n', 'utf8');

    buildDshBundleDirectory(installRoot, bundleDir);
    const hostMod = await import(pathToFileURL(join(bundleDir, 'lib', 'index.js')).href);
    let hostHandler = null;
    await hostMod.apply({
      webServer: { register(spec) { hostHandler = spec.handler; return () => {}; } },
      effect() {},
      get(svc) {
        if (svc === 'agents') return { get: (sid) => (sid === 'sess-w11' ? { id: sid, cwd: sessionWs } : null), list: () => [] };
        return null;
      }
    }, { projectRoot: installRoot });

    const server = createServer((req, res) => hostHandler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1) 验证 sessionId 动态定位到外部会话目录而非插件安装目录
      const ping = await (await fetch(`${baseUrl}/donegate/api/ping?sessionId=sess-w11`)).json();
      expect(ping.ok).toBe(true);
      expect(ping.root).toBe(sessionWs);

      // 2) 仅落盘 _shared/.bin/gradle(.bat) + dists/gradle-8.10.2（模拟无标准 manifest 的存量 175MB 产物）
      writeExecutableMock(join(sessionWs, 'workflows', '.deps', '_shared', 'dists', 'gradle-8.10.2', 'bin'), 'gradle',
        'console.log("Gradle 8.10.2");\n');
      writeExecutableMock(join(sessionWs, 'workflows', '.deps', '_shared', '.bin'), 'gradle',
        'console.log("Gradle 8.10.2");\n');

      // 点击画布「刷新最新数据」调用 /donegate/api/atlas/refresh
      const refRes = await (await fetch(`${baseUrl}/donegate/api/atlas/refresh?sessionId=sess-w11`, { method: 'POST' })).json();
      expect(refRes.ok).toBe(true);
      expect(refRes.sharedPool.summaryLabel).toContain('Gradle 8.10.2');
      expect(refRes.packDepReports['pack-android'].items.find((x) => x.id === 'gradle')?.ready).toBe(true);
      const maestroItem = refRes.packDepReports['pack-android'].items.find((x) => x.id === 'maestro');
      expect(maestroItem).toBeTruthy();
      if (maestroItem.ready) {
        expect(maestroItem.resolvedVia).toBe('host-env');
        expect(refRes.packDepReports['pack-android'].missingCount).toBe(0);
      } else {
        expect(refRes.packDepReports['pack-android'].missingCount).toBe(1);
      }

      // 初次打开 / 重进画布水合即携带已就绪的 pack-android 依赖状态
      const canvasHtml = await (await fetch(`${baseUrl}/donegate/api/canvas?dsh=1&sessionId=sess-w11`)).text();
      expect(canvasHtml).toContain('"packDepReports"');
      expect(canvasHtml).toContain('Gradle 8.10.2');

      // 3) 模拟 UI 看板增强四件套落盘于 workflows/.deps/_shared/npm/（含 @puckeditor/cli canary .bin 抢占干扰）
      const npmMods = join(sessionWs, 'workflows', '.deps', '_shared', 'npm', 'node_modules');
      const writeNpmPkg = (relDir, name, version, entryRel = 'dist/index.js') => {
        const dir = join(npmMods, ...relDir.split('/'));
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, entryRel), 'export default {};\n', 'utf8');
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, main: entryRel }, null, 2), 'utf8');
      };
      writeNpmPkg('lovinsp', 'lovinsp', '1.8.0');
      writeNpmPkg('react-grab', 'react-grab', '0.1.0');
      writeNpmPkg('@puckeditor/core', '@puckeditor/core', '0.24.1');
      writeNpmPkg('agent-browser', 'agent-browser', '0.43.0');
      // 干扰项：.bin/puck 输出 0.25.0-canary，验证 puck 按 npm-lib 读取 @puckeditor/core@0.24.1
      writeExecutableMock(join(npmMods, '.bin'), 'puck', 'console.log("0.25.0-canary");\n');
      writeExecutableMock(join(npmMods, '.bin'), 'agent-browser', `
        const a = process.argv.slice(2);
        if (a[0] === 'open') {
          fetch(a[1]).then((r) => r.text()).then((t) => { console.log('OPENED:' + t.length); process.exit(0); }).catch(() => process.exit(2));
        } else if (a[0] === 'snapshot') {
          console.log('@e1 [button] "新建业务单据"');
          process.exit(0);
        } else {
          process.exit(0);
        }
      `);

      const cliAbs = join(sessionWs, 'workflows', '.deps', '_shared', 'dg-deps-cli.mjs');
      spawnSync(process.execPath, [cliAbs, 'write-launchers', '--bin', 'agent-browser', '--npm-bin'], { cwd: sessionWs, encoding: 'utf8' });
      // 连续对多包执行 mark-ready --label，验证不覆盖 uiboard 顶层套件名且不抹掉 _shared 已有的 gradle！
      provisionWorkflowDeps(sessionWs, BUILTIN_CATALOG_PACK_SPECS.uiboard);
      spawnSync(process.execPath, [cliAbs, 'mark-ready', '--id', 'lovinsp', '--kind', 'npm-lib', '--pkg', 'lovinsp', '--workflow', 'uiboard', '--label', 'Lovinsp 1.8.0', '--version', '1.8.0'], { cwd: sessionWs });
      spawnSync(process.execPath, [cliAbs, 'mark-ready', '--id', 'puck', '--kind', 'npm-lib', '--pkg', '@puckeditor/core', '--workflow', 'uiboard', '--label', 'Puck 0.24.1', '--version', '0.24.1'], { cwd: sessionWs });

      const uibManifest = JSON.parse(readFileSync(join(sessionWs, 'workflows', '.deps', 'uiboard', 'manifest.json'), 'utf8'));
      expect(uibManifest.label).toContain('UI 看板增强套件');
      const sharedManifest = JSON.parse(readFileSync(join(sessionWs, 'workflows', '.deps', '_shared', 'manifest.json'), 'utf8'));
      expect(sharedManifest.installed.gradle?.ready).toBe(true);

      const tc = readUiToolchainStatus(sessionWs);
      expect(tc.ready).toBe(true);
      expect(tc.badgeLabel).toBe('✓ 增强套件已激活 (4/4)');
      expect(tc.versions.puck).toBe('0.24.1');

      // 4) 真激活 ?editor=puck 可视化编排画布 + layout 属性实时落盘
      const puckHtml = await (await fetch(`${baseUrl}/donegate/api/uiboard/prototype?editor=puck&sessionId=sess-w11`)).text();
      expect(puckHtml).toContain('data-puck-editor="active"');
      expect(puckHtml).toContain('@puckeditor/core@0.24.1 已激活');

      const mutRes = await (await fetch(`${baseUrl}/donegate/api/uiboard/layout?sessionId=sess-w11`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'update_props', blockId: 'blk-hero', props: { headline: 'Puck 实时拖拽编排已落盘' } })
      })).json();
      expect(mutRes.ok).toBe(true);

      // 5) 真激活 lovinsp + react-grab 组件栈与 DOM 快照抓取
      const protoHtml = await (await fetch(`${baseUrl}/donegate/api/uiboard/prototype?sessionId=sess-w11`)).text();
      expect(protoHtml).toContain('data-lovinsp-active="1"');
      expect(protoHtml).toContain('data-react-grab-active="1"');
      expect(protoHtml).toContain('data-insp-path=');
      expect(protoHtml).toContain('data-component-stack=');
      expect(protoHtml).toContain('Puck 实时拖拽编排已落盘');

      const docEvents = {}, posted = [];
      const mockSection = {
        tagName: 'SECTION', parentElement: null,
        getAttribute: (k) => (k === 'data-component-stack' ? 'UIPrototype > editorial-asymmetric > hero_nav#blk-hero' : (k === 'data-insp-path' ? '.donegate/ui-prototype/index.html:24:1' : null))
      };
      const mockBtn = {
        tagName: 'BUTTON', id: 'cta-1', innerText: '新建业务单据', outerHTML: '<button id="cta-1" data-dg-action="act-create-order">新建业务单据</button>',
        parentElement: mockSection, closest: () => mockBtn,
        getAttribute: (k) => (k === 'data-dg-action' ? 'act-create-order' : (k === 'data-dg-wiring' ? 'mock' : null)),
        getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 50, width: 100, height: 30 })
      };
      const bodyMock = { appendChild() {}, getAttribute: (k) => ((k === 'data-lovinsp-active' || k === 'data-react-grab-active') ? '1' : null) };
      vm.runInNewContext(buildInjectedUiBridgeScript(), {
        window: { location: { pathname: '/' }, innerWidth: 1024, parent: { postMessage: (m) => posted.push(m) }, addEventListener() {} },
        document: {
          body: bodyMock,
          documentElement: { style: { setProperty() {} } },
          createElement: () => ({ style: {}, setAttribute() {}, getAttribute: () => '1' }),
          addEventListener: (ev, fn) => {
            if (!docEvents[ev]) docEvents[ev] = [];
            docEvents[ev].push(fn);
          }
        },
        Date, Math, Object, String, Number
      });
      for (const fn of (docEvents.pointerdown || [])) {
        fn({ target: mockBtn, altKey: true, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
      }
      expect(posted[0].type).toBe('dg-ui:element-selected');
      expect(posted[0].payload.componentStack).toEqual(['UIPrototype', 'editorial-asymmetric', 'hero_nav#blk-hero']);
      expect(posted[0].payload.domSnapshot).toContain('act-create-order');

      // 6) 真激活 agent-browser 异步回环自测（不传 liveUrl 亦自动拉起本机回环页实跑快照）
      const spRes = await (await fetch(`${baseUrl}/donegate/api/uiboard/self-play?sessionId=sess-w11`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      })).json();
      expect(spRes.ok).toBe(true);
      expect(spRes.engine).toBe('agent-browser');
      expect(spRes.cliSnapSummary).toContain('新建业务单据');
    } finally {
      server.close();
      rmSync(rootTmp, { recursive: true, force: true });
    }
  });
});
