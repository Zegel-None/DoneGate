#!/usr/bin/env node
// DSH Web 原生插件包、dsh-doc 规范、Windows 路径、类 ComfyUI 补齐与过夜挂机状态机自检夹具
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  buildDshFileResourceAddress, resolveDshHome,
  resolveDshProfileDir, toSafeFileUrl
} from './dsh/win-paths.mjs';
import {
  buildElementQuotePayload, buildMicroVerdictCard, deriveSliceCmdFromUiOwner,
  formatQuoteCapsule, parseQuoteCapsule, parseQuotedTargetsFromMessage, verifySubagentNodeReceipt
} from './dsh/quote-protocol.mjs';
import {
  executeDeterministicWorkflowRun, preflightWorkflowPack
} from './dsh/workflow-runner.mjs';
import {
  buildWorkflowDepEnv, inspectWorkflowDeps, provisionWorkflowDeps, runNpmPrefixInstall
} from './dsh/workflow-deps.mjs';
import {
  buildDshBundleDirectory, installDshWebBundle, stripCordisPatchText, uninstallDshWebBundle
} from './dsh/install-dsh-web.mjs';
import { runAutopilotSandboxChecks } from './dsh/fixtures-autopilot-sandbox.mjs';
import { runJitAndCampaignChecks } from './dsh/fixtures-campaign-jit.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function verifyWinPathsAndCmdScript(check) {
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
    const lowerDriveUri = buildDshFileResourceAddress('sess-01', mockRoot, win32.join('d:', 'agent-studio', 'donegate', 'runner', 'dsh', 'workflow-runner.mjs'));
    assert.equal(lowerDriveUri, 'dsh-resource://file/session/sess-01/runner/dsh/workflow-runner.mjs');
    const cmdBytes = readFileSync(join(ROOT, 'install-dsh-web.cmd'), 'utf8');
    assert.ok(cmdBytes.includes('\r\n'), 'install-dsh-web.cmd 必须保持 Windows CRLF 换行');
    assert.ok(cmdBytes.includes('chcp 65001'), 'install-dsh-web.cmd 必须切换 UTF-8 代码页');
    assert.ok(cmdBytes.includes('"%~1"'), 'install-dsh-web.cmd 必须使用 %~1 兼容带引号参数');
    const gitAttrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
    assert.ok(gitAttrs.includes('*.cmd text eol=crlf') && gitAttrs.includes('* text=auto eol=lf'));
  });
}

async function verifyQuoteAndReceiptProtocol(check) {
  await check('2. DSH 原生蓝色引用胶囊（含 uiOwner / sliceCmd 全链路直达与旧格式向后兼容）及两行验真微卡协议', async () => {
    const q1 = buildElementQuotePayload({
      kind: 'node', id: 'n-ui', label: 'UI 组件层',
      contractIds: ['verdict-core'], scopePaths: ['runner/core/'],
      uiOwner: 'runner\\atlas\\wb-render-cards.mjs'
    });
    const q2 = buildElementQuotePayload({ kind: 'link', id: 'lk-loop-1', label: '门禁失败回跳线' });
    const q3 = buildElementQuotePayload({ kind: 'control', id: 'tb:bypass', label: '跳过', uiOwner: 'runner/atlas/ui-shell.mjs' });
    assert.equal(q1.summary.label, '[节点]');
    assert.equal(q2.summary.label, '[连线]');
    assert.equal(q3.summary.label, '[按钮]');
    assert.equal(q3.summary.body, '跳过');
    assert.equal(q1.uiOwner, 'runner/atlas/wb-render-cards.mjs');
    assert.equal(q1.sliceCmd, 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-render-cards.mjs');
    assert.equal(q2.uiOwner, null, '不含 uiOwner 的元素必须保持 null 向后兼容');
    assert.equal(q2.sliceCmd, null);
    assert.ok(!q2.text.includes('uiOwner='), '不含 uiOwner 时不强塞多余字段');

    const dshCap = formatQuoteCapsule({
      kind: 'ui', id: 'bridge-el-1', label: '保存按钮',
      scopes: ['apps/web/Form.tsx'], uiOwner: 'runner/dsh/ui-board-bridge.mjs'
    });
    const parsedDshCap = parseQuoteCapsule(dshCap);
    assert.equal(parsedDshCap.uiOwner, 'runner/dsh/ui-board-bridge.mjs');
    assert.equal(parsedDshCap.sliceCmd, 'node runner/donegate.mjs slice dsh-orchestrator --focus runner/dsh/ui-board-bridge.mjs');
    assert.equal(deriveSliceCmdFromUiOwner('runner/atlas/wb-uiboard.mjs'), 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-uiboard.mjs');
    assert.equal(deriveSliceCmdFromUiOwner('runner/dsh/quote-protocol.mjs'), 'node runner/donegate.mjs slice dsh-orchestrator --focus runner/dsh/quote-protocol.mjs');
    assert.equal(deriveSliceCmdFromUiOwner('../evil.mjs'), null);

    // 验证旧格式胶囊 100% 向后兼容与无显式 sliceCmd 时自动按 uiOwner 补推
    const legacyCap = '[DG-TARGET uri=dg://sandbox/card/host-dom-core | kind=card | id=host-dom-core | label=判定核 | contracts=verdict-core | scopes=runner/core/]';
    const parsedLegacy = parseQuoteCapsule(legacyCap);
    assert.equal(parsedLegacy.kind, 'card');
    assert.equal(parsedLegacy.id, 'host-dom-core');
    assert.equal(parsedLegacy.name, '判定核');
    assert.deepEqual(parsedLegacy.contracts, ['verdict-core']);
    assert.deepEqual(parsedLegacy.scopes, ['runner/core/']);
    assert.equal(parsedLegacy.uiOwner, null);
    assert.equal(parsedLegacy.sliceCmd, null);
    assert.equal(parseQuoteCapsule('纯普通闲聊无胶囊文本'), null);

    const uiOnlyCap = '[DG-TARGET uri=dg://workshop/button/id%3Abtn-theme | kind=button | id=id:btn-theme | label=暗黑 | contracts=- | scopes=- | uiOwner=runner/atlas/ui-shell.mjs]';
    const parsedUiOnly = parseQuoteCapsule(uiOnlyCap);
    assert.deepEqual(parsedUiOnly.contracts, []);
    assert.deepEqual(parsedUiOnly.scopes, []);
    assert.equal(parsedUiOnly.uiOwner, 'runner/atlas/ui-shell.mjs');
    assert.equal(parsedUiOnly.sliceCmd, 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/ui-shell.mjs');

    const prompt = `${q1.text}\n${q2.text}\n${q3.text}\n请把跳过按钮改成琥珀色并检查这条回跳线的门禁上限`;
    const targets = parseQuotedTargetsFromMessage(prompt);
    assert.equal(targets.length, 3);
    assert.equal(targets[0].kind, 'node');
    assert.equal(targets[0].uiOwner, 'runner/atlas/wb-render-cards.mjs');
    assert.equal(targets[0].sliceCmd, 'node runner/donegate.mjs slice atlas-workbench --focus runner/atlas/wb-render-cards.mjs');
    assert.equal(targets[1].kind, 'link');
    assert.equal(targets[1].uiOwner, null);
    assert.equal(targets[2].kind, 'control');
    assert.equal(targets[2].uiOwner, 'runner/atlas/ui-shell.mjs');

    const card = buildMicroVerdictCard({
      ticketId: 'tkt-01', targetUri: q1.uri, exitCode: 0,
      headline: '已更新按钮配色并通过确定性门禁校验', passedGates: 3, totalGates: 3,
      touchedFiles: ['runner\\atlas\\wb-dsh-style.mjs'], addedLines: 12, removedLines: 2, canRollback: true
    });
    assert.ok(card.headline.length <= 22);
    assert.equal(card.tone, 'ok');
    assert.equal(card.touchedFiles[0], 'runner/atlas/wb-dsh-style.mjs');
    assert.equal(card.canRollback, true);

    const tmpRcpt = mkdtempSync(join(tmpdir(), 'dg-rcpt-verify-'));
    try {
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node', { exitCode: 0 }).ok, false, '无盘上 .receipt.json 必须拒收口头完成声称');
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node').exitCode, 3);
      mkdirSync(join(tmpRcpt, 'src'), { recursive: true });
      mkdirSync(join(tmpRcpt, 'contracts', 'demo-node'), { recursive: true });
      mkdirSync(join(tmpRcpt, '.donegate', 'capsules'), { recursive: true });
      writeFileSync(join(tmpRcpt, 'src', 'index.mjs'), 'export function ping(x) { return x; }\n', 'utf8');
      writeFileSync(join(tmpRcpt, 'contracts', 'demo-node', 'contract.json'), JSON.stringify({ id: 'demo-node', scope: ['src/'] }, null, 2));
      writeFileSync(join(tmpRcpt, '.donegate', 'capsules', 'demo-node.receipt.json'), JSON.stringify({ nodeId: 'demo-node', verdict: 'FAIL', exitCode: 1, stubHash: 'a'.repeat(64) }), 'utf8');
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node').ok, false, 'exitCode !== 0 必须判否');
      writeFileSync(join(tmpRcpt, '.donegate', 'capsules', 'demo-node.receipt.json'), JSON.stringify({ nodeId: 'demo-node', verdict: 'PASS', exitCode: 0, stubHash: 'short16hash00000' }), 'utf8');
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node').exitCode, 2, '非 64 位 SHA-256 stubHash 必须拒收');
      const mismatch = verifySubagentNodeReceipt(tmpRcpt, 'demo-node');
      assert.equal(mismatch.ok, false);
      const { buildNodeInterfaceStub } = await import('./core/contract.mjs');
      const realHash = buildNodeInterfaceStub(tmpRcpt, { id: 'demo-node', scope: ['src/'] }).stubHash;
      assert.equal(realHash.length, 64);
      writeFileSync(join(tmpRcpt, '.donegate', 'capsules', 'demo-node.receipt.json'), JSON.stringify({ schema: 'donegate-node-receipt/v1', nodeId: 'demo-node', verdict: 'PASS', exitCode: 0, stubHash: realHash }), 'utf8');
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node', { exitCode: 0, stubHash: 'b'.repeat(64) }).ok, false, '自报哈希与落盘哈希不符必须拒收');
      assert.equal(verifySubagentNodeReceipt(tmpRcpt, 'demo-node', { exitCode: 0, stubHash: realHash }).ok, true, '盘上存在且 64 位 stubHash 匹配的回执应验真通过');
    } finally {
      rmSync(tmpRcpt, { recursive: true, force: true });
    }
  });
}

async function verifyDshDocBundleSpec(check) {
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
      assert.ok(patchYml.includes('@deepseek-ai/dsh-tool-pwsh') && patchYml.includes('@deepseek-ai/dsh-tool-bash'));
      assert.ok(!patchYml.includes('@deepseek-ai/dsh-bash-sandbox'), '禁止在预设内重复嵌套宿主层 bash-sandbox 以免挂载报错');
      assert.ok(patchYml.includes('sampleOverCapGlobResults: false'), 'tool-fs-search 必须声明 sampleOverCapGlobResults: false 以通过 rc.5 校验');
      assert.ok(patchYml.includes('@deepseek-ai/dsh-tool-ask-user'), '主调度预设须挂载 dsh-tool-ask-user 支持原生选择框提问');
      assert.ok(patchYml.includes('id: preset-donegate-router'));
      assert.equal((patchYml.match(/compaction:\s*true/g) || []).length, 2, 'router 与 worker 两个预设均须挂载 isolate.compaction 压缩隔离组');
      assert.equal((patchYml.match(/@deepseek-ai\/dsh-compaction-basic/g) || []).length, 2, '压缩隔离组内须默认挂载官方 dsh-compaction-basic');
      assert.ok(patchYml.includes('[DG-TARGET]') && patchYml.includes('非工程问答直通退让'), '主调度预设描述须包含非工程问答直通退让规则');
      assert.ok(patchYml.includes('slice atlas-workbench --focus <uiOwner>') && patchYml.includes('sliceCmd'), 'Router 与 Worker 预设须包含 sliceCmd 直达 UI 模块指引');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

async function verifyWinProfileInstallLifecycle(check) {
  await check('4. Windows Profile 双形态安装/卸载仿真（含 package.json bundles 列表模式与纯 patch 兜底模式）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-winprof-'));
    try {
      const profWithPkg = join(tmp, 'dsh-home', 'profiles', 'web');
      mkdirSync(profWithPkg, { recursive: true });
      writeFileSync(join(profWithPkg, 'package.json'), JSON.stringify({
        name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app'] } }
      }, null, 2));

      const fakeDshHome = join(tmp, 'dsh-home');
      const fakeProj = join(tmp, 'proj-copy');
      for (const sk of ['donegate', 'donegate-judge', 'donegate-forge']) {
        mkdirSync(join(fakeDshHome, 'skills', sk), { recursive: true });
        writeFileSync(join(fakeDshHome, 'skills', sk, 'SKILL.md'), 'legacy polluted global skill\n', 'utf8');
        mkdirSync(join(fakeProj, sk), { recursive: true });
        writeFileSync(join(fakeProj, sk, 'SKILL.md'), readFileSync(join(ROOT, sk, 'SKILL.md'), 'utf8'), 'utf8');
      }
      const res = installDshWebBundle({ projectRoot: fakeProj, dshHome: fakeDshHome, profileDir: profWithPkg, platform: 'win32' });
      assert.equal(res.registeredInManifest, true);
      for (const sk of ['donegate', 'donegate-judge', 'donegate-forge']) {
        assert.equal(existsSync(join(fakeDshHome, 'skills', sk)), false, `禁止向全局 dshHome/skills 写入且必须清除历史残留 ${sk}`);
        assert.equal(existsSync(join(fakeProj, '.dsh', 'skills', sk, 'SKILL.md')), true, '项目级 .dsh/skills 必须保留技能副本');
      }
      const afterPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(afterPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
      assert.ok(existsSync(join(profWithPkg, 'node_modules', '@local', 'dsh-donegate', 'lib', 'client.js')));

      writeFileSync(join(profWithPkg, 'cordis.patch.yml'), '# --- BEGIN DONEGATE-V4 BUNDLE ---\n- insert: []\n# --- END DONEGATE-V4 BUNDLE ---\n', 'utf8');
      assert.equal(stripCordisPatchText(readFileSync(join(profWithPkg, 'cordis.patch.yml'), 'utf8')), '[]\n', '剥离完结门补丁块后为空时必须回写合法顶层 YAML 空数组 []');
      uninstallDshWebBundle({ dshHome: join(tmp, 'dsh-home'), profileDir: profWithPkg, platform: 'win32' });
      assert.equal(readFileSync(join(profWithPkg, 'cordis.patch.yml'), 'utf8'), '[]\n');
      const cleanedPkg = JSON.parse(readFileSync(join(profWithPkg, 'package.json'), 'utf8'));
      assert.ok(!cleanedPkg.dsh.profile.bundles.includes('@local/dsh-donegate'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

async function verifyClientSandboxAndRunner(check) {
  await check('5. 浏览器端 __ModuleLoader__ 沙箱加载、dispatchSubagent 编队子代理桥与确定性工作流状态机验真', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-dsh-vm-'));
    try {
      const { bundleDir } = buildDshBundleDirectory(ROOT, join(tmp, 'bundle'));
      const clientCode = readFileSync(join(bundleDir, 'lib', 'client.js'), 'utf8');
      let loadedMod = null;
      const registeredSlots = [];
      const winMsgHandlers = [];
      const sandbox = {
        window: {
          __ModuleLoader__: { load(spec) { loadedMod = spec; } },
          addEventListener(ev, fn) { if (ev === 'message') winMsgHandlers.push(fn); },
          removeEventListener() {}
        },
        encodeURIComponent, Boolean, String, Array, Map, Set
      };
      vm.runInNewContext(clientCode, sandbox);
      assert.ok(loadedMod && loadedMod.id === '@local/dsh-donegate');
      const plugin = loadedMod.factory((modName) => {
        if (modName === 'react') return { createElement: (...a) => a, useRef: () => ({ current: null }), useEffect(fn) { fn(); } };
        throw new Error('Unexpected require: ' + modName);
      });
      let mockViewMode = 'chat';
      plugin.apply({
        effect(fn) { fn(); },
        locale: { register() { return () => {}; }, bind() { return (k) => k; } },
        slots: { inject(_slot, cb) { cb(); }, register(opts, comp) { registeredSlots.push({ opts, comp }); return () => {}; } },
        get(svc) {
          if (svc === 'uiConversation') {
            return { binding(sid) { if (sid === 'throw-sid') throw new Error('boom'); return { store: { getSnapshot: () => ({ view: mockViewMode }) } }; } };
          }
          return null;
        }
      });
      const slotNames = registeredSlots.map((s) => `${s.opts.name}:${s.opts.id}`);
      assert.ok(slotNames.includes('conversation.view:donegate'));
      assert.ok(slotNames.includes('conversation.input.dock:donegate-dock'));
      assert.ok(slotNames.includes('conversation.input.left:donegate-switch'));
      const viewEntry = registeredSlots.find((s) => s.opts.id === 'donegate');
      assert.equal(viewEntry.opts.order, 85, '完结门视图 order 必须后置为 85，严禁抢占默认聊天视图');
      assert.ok(clientCode.includes('data-conversation-composer-overlay'), '必须启用 DSH 全屏覆盖模式使工作台铺满输入框底部区域');
      assert.ok(
        clientCode.includes('[data-question-key] > *') &&
        clientCode.includes('[data-approval-key] > *') &&
        clientCode.includes('[data-plan-review-key] > *') &&
        clientCode.includes("data-slot='conversation.composer'] > :not([data-chain-overlay-fallback])"),
        '完结门全屏覆盖下必须恢复主对话选择框、审批框与计划评审卡片的 pointer-events 点击响应'
      );
      assert.ok(clientCode.includes('--dsh-composer-card-max-width'), '顶部消息栏必须与下方输入框严格共享 --dsh-composer-card-max-width 等宽');
      assert.ok(clientCode.includes('--dsw-specific-input-major') && clientCode.includes('--dsw-radius-xl'), '必须复用 DSH 官方输入框表面与圆角令牌');
      assert.ok(!clientCode.includes('切回对话页') && !clientCode.includes('对话与回执'), '必须彻底移除多余的对话与回执顶栏及切回对话页按钮');
      assert.ok(clientCode.includes('dg_dsh_agent_name') && clientCode.includes('dg_dsh_dock_pinned') && clientCode.includes('dg_dsh_dock_height'), '必须持久化自定义 Agent 名字、右上角固定状态与手动拖拽高度');
      assert.ok(clientCode.includes('sliceHints') && clientCode.includes('slice atlas-workbench --focus'), '客户端引用提取须支持解析 uiOwner 与推导 sliceCmd');

      let draftedText = '';
      let submittedCount = 0;
      viewEntry.comp({
        sessionId: 's-draft',
        inputActions: { setDraft(txt) { draftedText = txt; }, submit() { submittedCount++; } }
      });
      for (const h of winMsgHandlers) {
        h({ data: { source: 'donegate-canvas', sessionId: 's-draft', type: 'dg:dispatch-subagent', prompt: '请补齐单节点工作流依赖' } });
      }
      assert.equal(draftedText, '请补齐单节点工作流依赖');
      assert.equal(submittedCount, 1);

      const hostMod = await import(toSafeFileUrl(join(bundleDir, 'lib', 'index.js')));
      assert.deepEqual(hostMod.inject, ['webServer'], 'Host 插件必须保持最小 inject: ["webServer"]');
      const workRoot = join(tmp, 'proj');
      mkdirSync(workRoot, { recursive: true });
      let hostRoute = null;
      let capturedActivation = null;
      await hostMod.apply({
        webServer: { register(spec) { hostRoute = spec.handler; return () => {}; } },
        effect() {},
        get(svc) {
          if (svc === 'agents') return { get: () => null, list: () => [], resume: async ({ sessionId }) => ({ agent: { id: sessionId } }) };
          if (svc === 'subagents') return { startActivation: async (cfg) => { capturedActivation = cfg; return { name: 'worker-alpha', childId: 'child-1' }; } };
          return null;
        }
      }, { projectRoot: workRoot });

      const callHost = async (method, urlPath, bodyObj = null) => {
        let code = 200;
        let outTxt = '';
        await hostRoute({
          method, url: urlPath, headers: {},
          on(ev, cb) { if (ev === 'data' && bodyObj) cb(Buffer.from(JSON.stringify(bodyObj))); if (ev === 'end') cb(); },
          destroy() {}
        }, { writeHead(s) { code = s; }, end(c) { outTxt = c || ''; } });
        return { code, json: outTxt ? JSON.parse(outTxt) : null };
      };
      const pingRes = await callHost('GET', '/donegate/api/ping');
      assert.equal(pingRes.json.ok, true);
      assert.equal(pingRes.json.mode, 'dsh-web');
      const provRes = await callHost('POST', '/donegate/api/workflow-deps/provision', {
        sessionId: 'sess-resume-1', spawnSubagent: true, onlyNodeId: 'node-target',
        pack: {
          id: 'pack-multi', name: '多节点工作流',
          deps: [{ id: 'pack-level-dep', bin: 'never-pack-bin', allowHostEnv: false }],
          nodes: [
            { id: 'node-target', title: '目标节点', installSpec: { id: 'only-dep', bin: 'never-only-bin', allowHostEnv: false } },
            { id: 'node-other', title: '旁路节点', installSpec: { id: 'other-dep', bin: 'never-other-bin', allowHostEnv: false } }
          ]
        }
      });
      assert.equal(provRes.json.ready, false, '未实际装完前严禁把 ready 标为 true');
      assert.deepEqual(provRes.json.items.map((x) => x.id), ['only-dep'], 'onlyNodeId 必须精准过滤为单节点依赖');
      assert.equal(provRes.json.subagentDispatched, true);
      assert.equal(provRes.json.subagentName, 'worker-alpha');
      assert.equal(provRes.json.fallbackAutoSubmit, false);
      assert.equal(capturedActivation.agentPreset, 'dsh-donegate-worker');

      const dockEntry = registeredSlots.find((s) => s.opts.id === 'donegate-dock');
      const injectedDockProps = dockEntry.opts.inject();
      assert.equal(injectedDockProps.isDoneGateActive('default'), false);
      assert.equal(injectedDockProps.isDoneGateActive(''), false);
      assert.equal(injectedDockProps.isDoneGateActive('throw-sid'), false);
      assert.equal(injectedDockProps.isDoneGateActive('s-live'), false);
      assert.equal(dockEntry.comp({ sessionId: 'default', ...injectedDockProps }), null);
      assert.equal(dockEntry.comp({ sessionId: 's-live', ...injectedDockProps }), null);
      mockViewMode = 'donegate';
      assert.equal(injectedDockProps.isDoneGateActive('s-live'), true);
      const mockTree = JSON.stringify(dockEntry.comp({
        sessionId: 's-live',
        ...injectedDockProps,
        useConversation: (sel) => sel({ views: { get: (v) => v === 'chat' ? { legacy: { nodes: [{ kind: 'user', seq: 1, content: [{ type: 'text', text: '帮我检查计算模块' }] }, { kind: 'assistant', seq: 2, turn: 1, blocks: [{ kind: 'text', text: '已完成计算模块门禁扫描，零违规放行。' }] }], partial: null } } : null } })
      }));
      assert.ok(mockTree.includes('calc(0px - var(--dsh-composer-stack-gap, 6px) - 28px)') && mockTree.includes('"paddingBottom":"28px"'));
      assert.ok(mockTree.includes('Agent：') && mockTree.includes('已完成计算模块门禁扫描，零违规放行。'));

      const pre = preflightWorkflowPack({ id: 'wf-blank', name: '含空白节点流', nodes: [{ id: 'b1', title: '待定模块', isBlank: true }], links: [] });
      assert.equal(pre.ok, false);
      assert.equal(pre.exitCode, 3);

      const runRes = await executeDeterministicWorkflowRun(workRoot, { ticketId: 'tkt-vm-1', targetUri: 'dg://node/g1', headline: '确定性门禁通过' }, {
        id: 'wf-ok', name: '门禁直通验证流',
        nodes: [{ id: 'g1', title: '确定性门禁核验', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(0)'] } }],
        links: []
      });
      assert.equal(runRes.ok, true);
      assert.equal(runRes.exitCode, 0);
      assert.equal(runRes.card.tone, 'ok');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

async function verifyWorkflowDepsIsolation(check) {
  await check('6. 类 ComfyUI 工作流缺依赖硬阻断、空仓库防误判、workflows/.deps/<id>/ 隔离补齐与 PATH 自动注入闭环', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-wf-deps-'));
    try {
      const pack = {
        id: 'stage-sec-demo', name: '供应链漏洞核验流',
        deps: [{ id: 'mock-sec-cli', title: 'MockSec 开源扫描器', repo: 'acme/mock-sec-cli', version: 'v1.2.0', kind: 'binary', bin: 'mock-sec-cli-never-installed', allowHostEnv: false }],
        nodes: [{ id: 'n-sec', title: 'MockSec 扫描卡', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'if (!process.env.DG_WORKFLOW_DEPS_DIR) process.exit(2); process.exit(0);'] } }],
        links: []
      };
      const blocked = await executeDeterministicWorkflowRun(tmp, { ticketId: 'tkt-dep-1' }, pack);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.exitCode, 3);
      assert.equal(blocked.code, 'MISSING_WORKFLOW_DEPS');

      const repoOnlyPack = { id: 'repo-only', deps: [{ id: 'empty-repo-lib', repo: 'acme/empty-repo-lib', kind: 'git', bin: '' }], nodes: [] };
      const emptyRepoDir = join(tmp, 'workflows', '.deps', '_shared', 'repos', 'empty-repo-lib');
      mkdirSync(emptyRepoDir, { recursive: true });
      assert.equal(inspectWorkflowDeps(tmp, repoOnlyPack).ready, false, '空仓库目录严禁误判为 ready: true');
      mkdirSync(join(emptyRepoDir, '.git'), { recursive: true });
      assert.equal(inspectWorkflowDeps(tmp, repoOnlyPack).ready, true, '含 .git 的非空仓库目录应判定为 ready: true');

      const prov1 = provisionWorkflowDeps(tmp, pack);
      assert.equal(prov1.ready, false);
      assert.ok(existsSync(join(tmp, 'workflows', '.deps', 'stage-sec-demo', 'PROVISION-PLAN.json')));

      const binFile = join(tmp, 'workflows', '.deps', 'stage-sec-demo', '.bin', 'mock-sec-cli-never-installed');
      writeFileSync(binFile, '#!/bin/sh\necho 1.2.0\n', 'utf8');
      try { chmodSync(binFile, 0o755); } catch (err) { void err; }
      assert.equal(inspectWorkflowDeps(tmp, pack, { platform: 'win32' }).ready, false, 'Windows 下严禁误把无扩展名 POSIX shell 包装脚本判为可执行');

      writeFileSync(binFile + '.cmd', '@echo off\r\necho 1.2.0\r\n', 'utf8');
      assert.equal(inspectWorkflowDeps(tmp, pack, { platform: 'win32' }).ready, true, 'Windows 下补齐 .cmd 入口后就位探针通过');

      const afterInspect = inspectWorkflowDeps(tmp, pack);
      assert.equal(afterInspect.ready, true);
      const wfEnv = buildWorkflowDepEnv(tmp, pack.id, { PATH: '/usr/bin' });
      assert.ok(wfEnv.PATH.includes(join('workflows', '.deps', 'stage-sec-demo', '.bin')));
      const sys32 = win32.join('C:', 'Windows', 'System32');
      const wfWinEnv = buildWorkflowDepEnv(tmp, pack.id, { Path: sys32 }, 'win32');
      assert.equal('Path' in wfWinEnv, false, 'Windows 环境变量对象不得并存 Path 与 PATH 双键');
      assert.ok(wfWinEnv.PATH.endsWith(';' + sys32));
      assert.equal(runNpmPrefixInstall(tmp, 'bad;echo', tmp, 'win32').status, 2);

      const unblocked = await executeDeterministicWorkflowRun(tmp, { ticketId: 'tkt-dep-2' }, pack);
      assert.equal(unblocked.ok, true);
      assert.equal(unblocked.exitCode, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

export async function runAllDshChecks() {
  let passed = 0;
  const check = async (label, fn) => {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  };

  await verifyWinPathsAndCmdScript(check);
  await verifyQuoteAndReceiptProtocol(check);
  await verifyDshDocBundleSpec(check);
  await verifyWinProfileInstallLifecycle(check);
  await verifyClientSandboxAndRunner(check);
  await verifyWorkflowDepsIsolation(check);
  await runAutopilotSandboxChecks(check);
  await runJitAndCampaignChecks(check);

  console.log(`RESULT: PASS DSH Web 插件与 Windows 跨平台全套 ${passed} 项端到端断言通过`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  runAllDshChecks().catch((err) => {
    console.error('RESULT: FAIL', err);
    process.exit(1);
  });
}
