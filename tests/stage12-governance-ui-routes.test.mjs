// Stage 12：治理工作流控制面 HTTP 接口、AI 提案对比确认闭环与工作台极简开关清单单测
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDoneGateWebRouteHandler } from '../runner/dsh/host/host-routes.mjs';
import { CONTROL_PLANE_TOKEN_HEADER } from '../runner/dsh/host/host-auth-guard.mjs';
import { buildWbGovernancePanelScript } from '../runner/atlas/wb-governance-panel.mjs';
import { renderAtlasWorkbenchHtml } from '../runner/atlas/render-html.mjs';
import { buildDashboardPayload } from '../runner/atlas/dashboard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function callGov(handler, { method = 'GET', subPath, headers = {}, body = null }) {
  let status = 200;
  let raw = '';
  const req = {
    method,
    url: `/donegate/api${subPath}`,
    headers: { host: '127.0.0.1:3000', ...headers },
    on(ev, cb) {
      if (ev === 'data' && body !== null) cb(Buffer.from(JSON.stringify(body)));
      if (ev === 'end') cb();
    },
    destroy() {}
  };
  const res = {
    writeHead(code) { status = code; },
    end(chunk = '') { raw = String(chunk || ''); }
  };
  await handler(req, res, subPath);
  return { status, json: raw ? JSON.parse(raw) : null };
}

describe('stage12: governance HTTP routes, auth boundaries & AI proposal confirmation', () => {
  it('serves 5 default flows summary, rejects worker mutations (403), and completes propose -> human confirm -> reset', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s12-gov-'));
    try {
      const handler = createDoneGateWebRouteHandler(tmp, { requireAuth: true });
      const authHdr = { [CONTROL_PLANE_TOKEN_HEADER]: handler.sessionToken };

      const sum0 = await callGov(handler, { method: 'GET', subPath: '/governance/summary' });
      expect(sum0.status).toBe(200);
      expect(sum0.json.flows).toHaveLength(5);
      expect(sum0.json.disclosure.hasDisabledIntegrity).toBe(false);

      // Worker role blocked with 403 even with valid session token
      const workerDeny = await callGov(handler, {
        method: 'POST',
        subPath: '/governance/overlay',
        headers: { ...authHdr, 'x-donegate-role': 'worker' },
        body: { flowId: 'dg-pre-commit', confirmedByHuman: true, patch: { toggleNodes: { 'pc-doc-budgets': { bypassed: true } } } }
      });
      expect(workerDeny.status).toBe(403);
      expect(workerDeny.json.code).toBe('WORKER_CANNOT_MUTATE_GOVERNANCE');

      // AI creates a proposal (does not mutate active overlay yet)
      const propRes = await callGov(handler, {
        method: 'POST',
        subPath: '/governance/propose',
        headers: authHdr,
        body: {
          flowId: 'dg-pre-commit',
          summary: '临时关闭四维提交预算以便原型探索',
          patch: { toggleNodes: { 'pc-commit-hygiene': { bypassed: true, reason: '原型阶段临时关闭' } } }
        }
      });
      expect(propRes.status).toBe(200);
      expect(propRes.json.proposal.willDisableIntegrity).toHaveLength(1);

      const sumPending = await callGov(handler, { method: 'GET', subPath: '/governance/summary' });
      expect(sumPending.json.pendingProposals).toHaveLength(1);
      expect(sumPending.json.disclosure.hasDisabledIntegrity).toBe(false);

      // Human confirms the proposal -> becomes active and red disclosure banner turns on
      const confirmRes = await callGov(handler, {
        method: 'POST',
        subPath: '/governance/confirm',
        headers: authHdr,
        body: { proposalId: propRes.json.proposal.proposalId, confirmedByHuman: true }
      });
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.json.summary.disclosure.hasDisabledIntegrity).toBe(true);
      expect(confirmRes.json.summary.disclosureBanner).toContain('已关闭防伪底线');

      // Human resets flow -> back to official clean defaults
      const resetRes = await callGov(handler, {
        method: 'POST',
        subPath: '/governance/reset',
        headers: authHdr,
        body: { flowId: 'dg-pre-commit', confirmedByHuman: true }
      });
      expect(resetRes.status).toBe(200);
      expect(resetRes.json.summary.disclosure.hasDisabledIntegrity).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hydrates governance summary and 5 default flows into offline dashboard HTML with valid JS syntax', () => {
    const script = buildWbGovernancePanelScript();
    expect(() => new Function(script)).not.toThrow();
    const payload = buildDashboardPayload(REPO_ROOT);
    expect(payload.workbench.governance.flows).toHaveLength(5);
    expect(payload.workbench.savedState.customPacks['dg-pre-commit']).toBeDefined();
    const html = renderAtlasWorkbenchHtml(payload);
    expect(html).toContain('openGovernancePanel');
    expect(html).toContain('DoneGate 默认治理规则清单');
  });
});
