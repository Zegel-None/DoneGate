// Stage 12 测试：DSH 插件 P0 止血（Puck/多工作区 Token 共享、安全 bundle 默认产出、9 处 sessionId 透传与治理 SSE/面板）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderDshHostIndexJs } from '../runner/dsh/bundle-templates.mjs';
import { createDoneGateWebRouteHandler } from '../runner/dsh/host-routes.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function makeMockRes() {
  let statusCode = 200;
  const headers = {};
  let body = '';
  return {
    writeHead(code, hdrs = {}) { statusCode = code; Object.assign(headers, hdrs); },
    end(chunk = '') { body += String(chunk || ''); },
    result() { return { statusCode, headers, body }; }
  };
}

function makeMockReq(method, url, headers = {}, bodyStr = '') {
  const req = Readable.from(bodyStr ? [Buffer.from(bodyStr, 'utf8')] : []);
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:3080', ...headers };
  return req;
}

describe('Stage 12: DSH 插件鉴权与合规安装 P0 加固', () => {
  it('renderDshHostIndexJs 导出 Config Schema 并在多工作区之间共享单一 instanceSessionToken', () => {
    const src = renderDshHostIndexJs(REPO_ROOT);
    expect(src).toContain('export const Config =');
    expect(src).toContain('instanceSessionToken');
    expect(src).toContain('randomBytes(32)');
    expect(src).toContain('sessionToken: instanceSessionToken');
  });

  it('requireAuth=true 时 GET /uiboard/prototype 注入 Session Token，且 POST /uiboard/layout 带令牌 200、缺令牌 403', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s12-puck-'));
    try {
      const handler = createDoneGateWebRouteHandler(tmp, { requireAuth: true, sessionToken: 'a'.repeat(64) });
      const getRes = makeMockRes();
      const handledGet = await handler(makeMockReq('GET', '/donegate/api/uiboard/prototype?editor=puck'), getRes, '/uiboard/prototype');
      expect(handledGet).toBe(true);
      const html = getRes.result().body;
      expect(html).toContain('donegate-session-token');
      expect(html).toContain('a'.repeat(64));

      const deniedRes = makeMockRes();
      await handler(makeMockReq('POST', '/donegate/api/uiboard/layout', { 'content-type': 'application/json' }, JSON.stringify({ action: 'reorder', blockIds: [] })), deniedRes, '/uiboard/layout');
      expect(deniedRes.result().statusCode).toBe(403);

      const okRes = makeMockRes();
      await handler(makeMockReq('POST', '/donegate/api/uiboard/layout', {
        'content-type': 'application/json',
        'x-donegate-session-token': 'a'.repeat(64)
      }, JSON.stringify({ action: 'add', block: { id: 'b1', type: 'hero', title: 'Test' } })), okRes, '/uiboard/layout');
      expect(okRes.result().statusCode).toBe(200);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('install-dsh-web.mjs CLI 默认仅安全生成 workspace bundle，绝不触碰 DSH_HOME/profiles/web；支持 --dry-run', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s12-install-'));
    try {
      const fakeDshHome = join(tmp, 'fake-dsh');
      const fakeProfile = join(fakeDshHome, 'profiles', 'web');
      mkdirSync(fakeProfile, { recursive: true });
      const origPkg = JSON.stringify({ name: 'web-profile', dependencies: {} }, null, 2);
      writeFileSync(join(fakeProfile, 'package.json'), origPkg, 'utf8');
      const outDir = join(tmp, 'out-bundle');

      const dry = spawnSync(process.execPath, [join(REPO_ROOT, 'runner/dsh/install-dsh-web.mjs'), '--dry-run', '--out', outDir], {
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME: fakeDshHome }
      });
      expect(dry.status).toBe(0);
      expect(existsSync(outDir)).toBe(false);

      const run = spawnSync(process.execPath, [join(REPO_ROOT, 'runner/dsh/install-dsh-web.mjs'), '--out', outDir], {
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME: fakeDshHome }
      });
      expect(run.status).toBe(0);
      expect(existsSync(join(outDir, 'package.json'))).toBe(true);
      expect(existsSync(join(fakeProfile, 'node_modules', '@local', 'dsh-donegate'))).toBe(false);
      expect(readFileSync(join(fakeProfile, 'package.json'), 'utf8')).toBe(origPkg);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wb-events-actions 与 wb-jit-workflow 不存在绕过 withDshSessionUrl 的裸 POST，且 SSE/治理面板已接线', () => {
    const evSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/wb-events-actions.mjs'), 'utf8');
    const jitSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/wb-jit-workflow.mjs'), 'utf8');
    const shellSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/ui-shell.mjs'), 'utf8');
    const govSrc = readFileSync(join(REPO_ROOT, 'runner/atlas/wb-governance-panel.mjs'), 'utf8');
    expect(evSrc).not.toMatch(/fetch\('\/donegate\/api\//);
    expect(jitSrc).not.toMatch(/fetch\('\/donegate\/api\//);
    expect(jitSrc).not.toMatch(/fetch\(endpoint,/);
    expect(shellSrc).toContain("msg.type === 'governance_updated'");
    expect(shellSrc).toContain("msg.type === 'governance_proposal_ready'");
    expect(govSrc).toContain('/donegate/api/governance/trust-suggestions');
    expect(govSrc).toContain('/donegate/api/governance/templates');
  });
});
