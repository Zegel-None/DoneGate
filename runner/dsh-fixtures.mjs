#!/usr/bin/env node
// DSH Web 原生插件包、dsh-doc 规范、Windows (win32) 跨平台路径与浏览器端插槽 VM 端到端自检夹具（<= 225 行）
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  buildDshFileResourceAddress, resolveDshHome,
  resolveDshProfileDir, toSafeFileUrl
} from './dsh/win-paths.mjs';
import {
  buildElementQuotePayload, buildMicroVerdictCard,
  parseQuotedTargetsFromMessage
} from './dsh/quote-protocol.mjs';
import {
  executeDeterministicWorkflowRun, preflightWorkflowPack
} from './dsh/workflow-runner.mjs';
import {
  buildDshBundleDirectory, installDshWebBundle, uninstallDshWebBundle
} from './dsh/install-dsh-web.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function runAllDshChecks() {
  let passed = 0;
  const check = async (label, fn) => {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  };

  await check('1. Windows (win32) 含空格与中文路径归一化及 file:/// / dsh-resource:// 协议安全编码', () => {
    const mockHome = win32.join('C:', 'Users', 'DevUser');
    const winEnv = { USERPROFILE: mockHome };
    assert.equal(resolveDshHome(winEnv, 'win32'), win32.join(mockHome, '.dsh'));
    assert.equal(resolveDshProfileDir('web', winEnv, 'win32'), win32.join(mockHome, '.dsh', 'profiles', 'web'));
    const url = toSafeFileUrl(win32.join('D:', 'Agent-Studio', 'DSH-Work', 'DoneGate V4(完结门)', 'runner', 'dsh', 'host-routes.mjs'));
    assert.ok(url.startsWith('file:///D:/Agent-Studio/DSH-Work/'));
    assert.ok(url.includes('%20'));
    const mockRoot = win32.join('D:', 'Agent-Studio', 'DoneGate');
    const resUri = buildDshFileResourceAddress('sess-01', mockRoot, win32.join(mockRoot, 'runner', 'dsh', 'workflow-runner.mjs'));
    assert.equal(resUri, 'dsh-resource://file/session/sess-01/runner/dsh/workflow-runner.mjs');
    const cmdBytes = readFileSync(join(ROOT, 'install-dsh-web.cmd'), 'utf8');
    assert.ok(cmdBytes.includes('\r\n'), 'install-dsh-web.cmd 必须保持 Windows CRLF 换行');
    assert.ok(cmdBytes.includes('chcp 65001'), 'install-dsh-web.cmd 必须切换 UTF-8 代码页');
  });

  await check('2. DSH 原生蓝色引用胶囊多元素累加（卡片 + 连线 + 按钮）与两行验真微卡协议', () => {
    const q1 = buildElementQuotePayload({ kind: 'node', id: 'n-ui', label: 'UI 组件层', contractIds: ['verdict-core'], scopePaths: ['runner/atlas'] });
    const q2 = buildElementQuotePayload({ kind: 'link', id: 'lk-loop-1', label: '门禁失败回跳线' });
    const q3 = buildElementQuotePayload({ kind: 'control', id: 'tb:bypass', label: '跳过' });
    assert.equal(q1.summary.label, '[节点]');
    assert.equal(q2.summary.label, '[连线]');
    assert.equal(q3.summary.label, '[按钮]');
    assert.equal(q3.summary.body, '跳过');

    const prompt = `${q1.text}\n${q2.text}\n${q3.text}\n请把跳过按钮改成琥珀色并检查这条回跳线的门禁上限`;
    const targets = parseQuotedTargetsFromMessage(prompt);
    assert.equal(targets.length, 3);
    assert.equal(targets[0].kind, 'node');
    assert.equal(targets[1].kind, 'link');
    assert.equal(targets[2].kind, 'control');

    const card = buildMicroVerdictCard({
      ticketId: 'tkt-01',
      targetUri: q1.uri,
      exitCode: 0,
      headline: '已更新按钮配色并通过确定性门禁校验',
      passedGates: 3,
      totalGates: 3,
      touchedFiles: ['runner\\atlas\\wb-dsh-style.mjs'],
      addedLines: 12,
      removedLines: 2,
      canRollback: true
    });
    assert.ok(card.headline.length <= 22);
    assert.equal(card.tone, 'ok');
    assert.equal(card.touchedFiles[0], 'runner/atlas/wb-dsh-style.mjs');
    assert.equal(card.canRollback, true);
  });

  await check('3. DSH 创造模式 (dsh-doc) 官方规范校验（manifest / engines.dsh / locale / 纯几何 SVG 图标与预览图）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-bundle-'));
    try {
      const { bundleDir } = buildDshBundleDirectory(ROOT, join(tmp, 'dsh-donegate'));
      const pkg = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, '@local/dsh-donegate');
      assert.equal(pkg.engines.dsh, '^0.2.2-alpha.2');
      assert.equal(pkg.dsh.client.platform, 'web');
      assert.equal(pkg.dsh.client.immediately, true);
      assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
      assert.equal(pkg.exports['./icon'], './icon.svg');

      const zh = JSON.parse(readFileSync(join(bundleDir, 'locale', 'zh.json'), 'utf8'));
      const en = JSON.parse(readFileSync(join(bundleDir, 'locale', 'en.json'), 'utf8'));
      assert.equal(en.meta.title, 'DoneGate workbench');
      assert.ok(existsSync(join(bundleDir, zh.meta.detail)));
      assert.ok(existsSync(join(bundleDir, en.meta.detail)));

      const iconSvg = readFileSync(join(bundleDir, 'icon.svg'), 'utf8');
      const prevSvg = readFileSync(join(bundleDir, 'docs', 'preview.svg'), 'utf8');
      assert.ok(iconSvg.includes('viewBox="0 0 36 36"'));
      assert.ok(prevSvg.includes('viewBox="0 0 640 300"'));
      for (const forbidden of ['<text', '<style', '<script', 'foreignObject']) {
        assert.ok(!iconSvg.includes(forbidden), `icon.svg 禁止包含 ${forbidden}`);
        assert.ok(!prevSvg.includes(forbidden), `preview.svg 禁止包含 ${forbidden}`);
      }

      const patchYml = readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8');
      assert.ok(patchYml.includes("process.platform === 'win32'"));
      assert.ok(patchYml.includes('@deepseek-ai/dsh-pwsh-sandbox'));
      assert.ok(patchYml.includes('id: preset-donegate-router'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('4. Windows Profile 双形态安装/卸载仿真（含 package.json bundles 列表模式与纯 patch 兜底模式）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-winprof-'));
    try {
      const profWithPkg = join(tmp, 'dsh-home', 'profiles', 'web');
      mkdirSync(profWithPkg, { recursive: true });
      writeFileSync(join(profWithPkg, 'package.json'), JSON.stringify({
        name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app'] } }
      }, null, 2));

      const res = installDshWebBundle({
        projectRoot: ROOT,
        dshHome: join(tmp, 'dsh-home'),
        profileDir: profWithPkg,
        platform: 'win32'
      });
      assert.equal(res.registeredInManifest, true);
      const afterPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(afterPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
      assert.ok(existsSync(join(profWithPkg, 'node_modules', '@local', 'dsh-donegate', 'lib', 'client.js')));

      uninstallDshWebBundle({ dshHome: join(tmp, 'dsh-home'), profileDir: profWithPkg, platform: 'win32' });
      const cleanedPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(!cleanedPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('5. 浏览器端 __ModuleLoader__ 沙箱加载与插槽注册 + 确定性工作流状态机验真', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-vm-'));
    try {
      const { bundleDir } = buildDshBundleDirectory(ROOT, join(tmp, 'bundle'));
      const clientCode = readFileSync(join(bundleDir, 'lib', 'client.js'), 'utf8');
      let loadedMod = null;
      const registeredSlots = [];
      const sandbox = {
        window: {
          __ModuleLoader__: { load(spec) { loadedMod = spec; } },
          addEventListener() {},
          removeEventListener() {}
        },
        encodeURIComponent,
        Boolean,
        String,
        Array,
        Map,
        Set
      };
      vm.runInNewContext(clientCode, sandbox);
      assert.ok(loadedMod && loadedMod.id === '@local/dsh-donegate');
      const plugin = loadedMod.factory((modName) => {
        if (modName === 'react') return { createElement: (...a) => a, useRef: () => ({ current: null }), useEffect() {} };
        throw new Error('Unexpected require: ' + modName);
      });
      plugin.apply({
        effect(fn) { fn(); },
        locale: { register() { return () => {}; }, bind() { return (k) => k; } },
        slots: {
          inject(_slot, cb) { cb(); },
          register(opts, comp) { registeredSlots.push({ opts, comp }); return () => {}; }
        },
        get() { return null; }
      });
      const slotNames = registeredSlots.map((s) => `${s.opts.name}:${s.opts.id}`);
      assert.ok(slotNames.includes('conversation.view:donegate'));
      assert.ok(slotNames.includes('conversation.input.dock:donegate-dock'));
      assert.ok(slotNames.includes('conversation.input.left:donegate-switch'));

      const pre = preflightWorkflowPack({
        id: 'wf-blank', name: '含空白节点流',
        nodes: [{ id: 'b1', title: '待定模块', isBlank: true }], links: []
      });
      assert.equal(pre.ok, false);
      assert.equal(pre.exitCode, 3);

      const workRoot = join(tmp, 'proj');
      mkdirSync(workRoot, { recursive: true });
      const runRes = await executeDeterministicWorkflowRun(
        workRoot,
        { ticketId: 'tkt-vm-1', targetUri: 'dg://node/g1', headline: '确定性门禁通过' },
        {
          id: 'wf-ok',
          name: '门禁直通验证流',
          nodes: [{ id: 'g1', title: '确定性门禁核验', exec: { kind: 'mortar_gate', nodeArgs: ['-e', 'process.exit(0)'] } }],
          links: []
        }
      );
      assert.equal(runRes.ok, true);
      assert.equal(runRes.exitCode, 0);
      assert.equal(runRes.card.tone, 'ok');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(`RESULT: PASS DSH Web 插件与 Windows 跨平台全套 ${passed} 项端到端断言通过`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runAllDshChecks().catch((err) => {
    console.error('RESULT: FAIL', err);
    process.exit(1);
  });
}
