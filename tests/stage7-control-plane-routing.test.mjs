// Stage 7：本地控制面会话令牌与 Loopback Host 鉴权、环境变量清洗及自适应编排路由单测
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDoneGateWebRouteHandler } from '../runner/dsh/host/host-routes.mjs';
import {
  CONTROL_PLANE_AUTH_DENIED_CODE,
  CONTROL_PLANE_TOKEN_HEADER,
  hagCreateSessionToken,
  hagInjectSessionTokenHtml,
  hagIsLoopbackHost,
  hagSanitizeSubagentEnv
} from '../runner/dsh/host/host-auth-guard.mjs';
import {
  AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS,
  AUTOPILOT_MAX_SUBAGENT_TOOLS,
  crPruneSubagentToolList,
  planCampaignExecutionStrategy
} from '../runner/dsh/autopilot/campaign-routing.mjs';
import { executeDeterministicWorkflowRun } from '../runner/dsh/autopilot/workflow-runner.mjs';

async function invokeRoute(handler, { method = 'GET', subPath = '/ping', headers = {}, body = null } = {}) {
  let status = 200;
  let respHeaders = {};
  let rawBody = '';
  const req = {
    method,
    url: `/donegate/api${subPath}`,
    headers,
    on(ev, cb) {
      if (ev === 'data' && body !== null) cb(Buffer.from(JSON.stringify(body)));
      if (ev === 'end') cb();
    },
    destroy() {}
  };
  const res = {
    writeHead(code, hdrs = {}) {
      status = code;
      respHeaders = hdrs;
    },
    end(chunk = '') {
      rawBody = String(chunk || '');
    }
  };
  await handler(req, res, subPath);
  const ct = String(respHeaders['Content-Type'] || '');
  return {
    status,
    headers: respHeaders,
    text: rawBody,
    json: ct.includes('application/json') && rawBody ? JSON.parse(rawBody) : null
  };
}

describe('stage7: control-plane host/token auth guard & env sanitization', () => {
  it('blocks non-loopback Host/Origin and requires X-DoneGate-Session-Token on mutating routes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage7-auth-'));
    try {
      const handler = createDoneGateWebRouteHandler(tmp, { requireAuth: true });
      expect(typeof handler.sessionToken).toBe('string');
      expect(handler.sessionToken.length).toBe(64);
      expect(hagIsLoopbackHost('127.0.0.1:8080')).toBe(true);
      expect(hagIsLoopbackHost('localhost:3000')).toBe(true);
      expect(hagIsLoopbackHost('[::1]:8080')).toBe(true);
      expect(hagIsLoopbackHost('evil.example.com:8080')).toBe(false);

      const evilHost = await invokeRoute(handler, {
        method: 'GET',
        subPath: '/ping',
        headers: { host: 'evil.example.com:3000' }
      });
      expect(evilHost.status).toBe(403);
      expect(evilHost.json?.code).toBe(CONTROL_PLANE_AUTH_DENIED_CODE);

      const evilOrigin = await invokeRoute(handler, {
        method: 'GET',
        subPath: '/ping',
        headers: { host: '127.0.0.1:3000', origin: 'https://attacker.invalid' }
      });
      expect(evilOrigin.status).toBe(403);
      expect(evilOrigin.json?.code).toBe(CONTROL_PLANE_AUTH_DENIED_CODE);

      const okPing = await invokeRoute(handler, {
        method: 'GET',
        subPath: '/ping',
        headers: { host: '127.0.0.1:3000' }
      });
      expect(okPing.status).toBe(200);
      expect(okPing.json?.ok).toBe(true);

      const noTokPost = await invokeRoute(handler, {
        method: 'POST',
        subPath: '/state',
        headers: { host: '127.0.0.1:3000' },
        body: { theme: 'dark' }
      });
      expect(noTokPost.status).toBe(403);
      expect(noTokPost.json?.code).toBe(CONTROL_PLANE_AUTH_DENIED_CODE);

      const wrongTokPost = await invokeRoute(handler, {
        method: 'POST',
        subPath: '/state',
        headers: { host: '127.0.0.1:3000', [CONTROL_PLANE_TOKEN_HEADER]: '0'.repeat(64) },
        body: { theme: 'dark' }
      });
      expect(wrongTokPost.status).toBe(403);

      const validPost = await invokeRoute(handler, {
        method: 'POST',
        subPath: '/state',
        headers: { host: '127.0.0.1:3000', [CONTROL_PLANE_TOKEN_HEADER]: handler.sessionToken },
        body: { theme: 'dark' }
      });
      expect(validPost.status).toBe(200);
      expect(validPost.json?.ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('injects session token into HTML and strips sensitive token env vars for subagents', () => {
    const tok = hagCreateSessionToken();
    const html = hagInjectSessionTokenHtml('<html><head><title>DG</title></head><body></body></html>', tok);
    expect(html).toContain('name="donegate-session-token"');
    expect(html).toContain(tok);
    expect(html).toContain('X-DoneGate-Session-Token');

    const cleaned = hagSanitizeSubagentEnv({
      PATH: '/usr/bin',
      DONEGATE_SESSION_TOKEN: tok,
      DONEGATE_CONTROL_PLANE_TOKEN: 'secret',
      DSH_SESSION_TOKEN: 'secret2',
      X_DONEGATE_SESSION_TOKEN: 'secret3',
      NODE_ENV: 'test'
    });
    expect(cleaned.PATH).toBe('/usr/bin');
    expect(cleaned.NODE_ENV).toBe('test');
    expect(cleaned.DONEGATE_SESSION_TOKEN).toBeUndefined();
    expect(cleaned.DONEGATE_CONTROL_PLANE_TOKEN).toBeUndefined();
    expect(cleaned.DSH_SESSION_TOKEN).toBeUndefined();
    expect(cleaned.X_DONEGATE_SESSION_TOKEN).toBeUndefined();
  });
});

describe('stage7: scaling-law campaign routing, tool pruning & 2-round self-heal cap', () => {
  it('routes sequential chains or overlapping scopes to single-agent-sequential and disjoint waves to parallel-worktree', () => {
    const seqPlan = planCampaignExecutionStrategy(
      [
        { id: 'n1', scopePaths: ['src/a/'] },
        { id: 'n2', scopePaths: ['src/b/'] }
      ],
      [{ fromNode: 'n1', toNode: 'n2' }]
    );
    expect(seqPlan.mode).toBe('single-agent-sequential');
    expect(seqPlan.maxConcurrency).toBe(1);
    expect(seqPlan.maxSelfHealRounds).toBe(AUTOPILOT_DEFAULT_MAX_SELF_HEAL_ROUNDS);

    const conflictPlan = planCampaignExecutionStrategy(
      [
        { id: 'n1', scopePaths: ['src/shared/'] },
        { id: 'n2', scopePaths: ['src/shared/utils.mjs'] }
      ],
      []
    );
    expect(conflictPlan.mode).toBe('single-agent-sequential');
    expect(conflictPlan.waves[0].hasScopeConflict).toBe(true);

    const parallelPlan = planCampaignExecutionStrategy(
      [
        { id: 'n1', scopePaths: ['src/auth/'] },
        { id: 'n2', scopePaths: ['src/billing/'] },
        { id: 'n3', scopePaths: ['src/ui/'] }
      ],
      [],
      { tools: Array.from({ length: 14 }, (_, i) => `tool_${i + 1}`) }
    );
    expect(parallelPlan.mode).toBe('parallel-worktree');
    expect(parallelPlan.maxConcurrency).toBe(3);
    expect(parallelPlan.toolBudget.tools.length).toBe(AUTOPILOT_MAX_SUBAGENT_TOOLS);
    expect(parallelPlan.toolBudget.droppedCount).toBe(4);

    const pruned = crPruneSubagentToolList(['a', 'b', 'a', 'c', 'd'], 3);
    expect(pruned.tools).toEqual(['a', 'b', 'c']);
    expect(pruned.pruned).toBe(true);
    expect(pruned.droppedCount).toBe(1);
  });

  it('caps self-heal retries at 2 rounds even when a workflow link specifies maxLoops > 2', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage7-cap-'));
    try {
      const pack = {
        id: 'pack-cap-2',
        name: '两轮自愈熔断上限验证流',
        nodes: [{ id: 'g1', title: '恒败节点', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(1)'] } }],
        links: [{ id: 'lk-self', fromNode: 'g1', fromSlot: 'out', toNode: 'g1', toSlot: 'in', maxLoops: 5 }]
      };
      const out = await executeDeterministicWorkflowRun(tmp, { ticketId: 'cap-01' }, pack);
      expect(out.ok).toBe(false);
      expect(out.code).toBe('MAX_LOOPS_EXCEEDED');
      expect(out.checkpoint.loopCounts['lk-self']).toBe(2);
      expect(out.breaker.reason).toContain('(2 次)');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
