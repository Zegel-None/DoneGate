import { test } from 'vitest';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  SUBAGENT_HUMAN_ISOLATION_MSG,
  installSubagentHumanIsolationGuard
} from '../runner/dsh/host/subagent-isolation.mjs';
import { renderDshBundlePackageJson, renderDshHostIndexJs } from '../runner/dsh/host/bundle-templates.mjs';
import { renderDshClientBundleJs } from '../runner/dsh/host/client-bundle-gen.mjs';

test('Host 隔离守卫拦截浏览器人类直发 prompt，同时 100% 放行主控 sendMessage 与中断', async () => {
  const calls = [];
  const fakeSubagents = {
    async prompt(req) {
      calls.push(['prompt', req]);
      return { messageId: 'msg-human' };
    },
    async sendMessage(sender, targetId, content) {
      calls.push(['sendMessage', sender.id, targetId, content]);
      return 'msg-lead-steer';
    },
    interruptByUser(childSessionId) {
      calls.push(['interruptByUser', childSessionId]);
      return { accepted: true };
    }
  };

  const dispose = installSubagentHumanIsolationGuard(fakeSubagents, { env: {} });
  // 幂等重复安装不会多层包裹
  const disposeAgain = installSubagentHumanIsolationGuard(fakeSubagents, { env: {} });
  assert.equal(dispose, disposeAgain);

  await assert.rejects(
    () => fakeSubagents.prompt({ childSessionId: 'sub-worker-1', content: [{ type: 'text', text: '人类直接插话' }] }),
    (err) => err.code === 'subagent/not-resumable' && err.message === SUBAGENT_HUMAN_ISOLATION_MSG
  );

  // 主控 Super Agent 的 send_message 工具调用走 sendMessage，完全不受阻断
  const msgId = await fakeSubagents.sendMessage({ id: 'lead-session' }, 'sub-worker-1', [{ type: 'text', text: '主控续调工单' }]);
  assert.equal(msgId, 'msg-lead-steer');
  assert.deepEqual(fakeSubagents.interruptByUser('sub-worker-1'), { accepted: true });
  assert.equal(calls.length, 2);

  // 卸载守卫后恢复原方法
  dispose();
  const afterDispose = await fakeSubagents.prompt({ childSessionId: 'sub-worker-1', content: [] });
  assert.equal(afterDispose.messageId, 'msg-human');
});

test('Host 隔离守卫支持 DG_ALLOW_HUMAN_SUBAGENT_PROMPT=1 调试逃生阀', async () => {
  const fakeSubagents = {
    async prompt() {
      return { messageId: 'allowed-debug' };
    }
  };
  const dispose = installSubagentHumanIsolationGuard(fakeSubagents, {
    env: { DG_ALLOW_HUMAN_SUBAGENT_PROMPT: '1' }
  });
  const res = await fakeSubagents.prompt({ childSessionId: 'sub-debug', content: [] });
  assert.equal(res.messageId, 'allowed-debug');
  dispose();
});

test('Client 插件包在 conversation.composer 注册 priority -5 只读槽位，拦截 continuable 子智能体而放行主对话', () => {
  const pkg = JSON.parse(renderDshBundlePackageJson());
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'));

  const hostJs = renderDshHostIndexJs('/workspace/demo');
  assert.match(hostJs, /installSubagentHumanIsolationGuard/);

  const clientJs = renderDshClientBundleJs();
  let capturedFactory = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(spec) {
          capturedFactory = spec.factory;
        }
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      innerHeight: 900
    }
  };
  vm.runInNewContext(clientJs, sandbox);
  assert.equal(typeof capturedFactory, 'function');

  const fakeReact = {
    createElement(tag, props, ...children) {
      return { tag, props: props || {}, children };
    },
    useRef: (v) => ({ current: v }),
    useEffect: () => {},
    useState: (v) => [v, () => {}]
  };
  const plugin = capturedFactory((modName) => {
    if (modName === 'react') return fakeReact;
    throw new Error('unexpected require: ' + modName);
  });

  const registeredSlots = [];
  const openedSessions = [];
  plugin.apply({
    effect: () => {},
    locale: {
      register: () => () => {},
      bind: () => (k) => k
    },
    get(service) {
      if (service === 'uiWorkspace') {
        return { openSession: (sid) => openedSessions.push(sid) };
      }
      return null;
    },
    slots: {
      inject(_slotName, fn) {
        fn();
      },
      register(meta, component) {
        registeredSlots.push({ meta, component });
        return () => {};
      }
    }
  });

  const composerSlot = registeredSlots.find((s) => s.meta.name === 'conversation.composer');
  assert.ok(composerSlot, '必须注册 conversation.composer 链式槽位');
  assert.equal(composerSlot.meta.priority, -5);

  // 普通主对话 session.subagent === null -> 返回 null，交还原生 InputBar
  assert.equal(composerSlot.meta.select({ session: { id: 'lead-1', subagent: null } }), null);

  // continuable 子智能体 -> 命中只读匹配并携带 parentSessionId
  const match = composerSlot.meta.select({
    session: {
      id: 'worker-1',
      subagent: { address: { parentSessionId: 'lead-1', mode: 'continuable' } }
    }
  });
  assert.deepEqual({ ...match }, { parentSessionId: 'lead-1', mode: 'continuable' });

  // 渲染只读组件并点击「返回主对话」按钮可跳回父会话
  const injected = composerSlot.meta.inject();
  const tree = composerSlot.component({
    matched: match,
    t: (k) => k,
    ...injected
  });
  assert.equal(tree.props['data-donegate-subagent-readonly'], '1');
  const backBtn = tree.children.find((c) => c && c.tag === 'button');
  assert.ok(backBtn, '应渲染返回主对话按钮');
  backBtn.props.onClick();
  assert.deepEqual(openedSessions, ['lead-1']);
});
