// Stage 23 · 变焦驾驶舱通用组件与 DoneGate 适配层解耦回归测试（外部多语言裸仓 CLI + stdio MCP + 依赖边界守卫）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveCbmBinary } from '../runner/core/index.mjs';
import { dispatchCockpitCommand } from '../runner/cockpit/cli.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const STANDALONE_CLI = join(REPO_ROOT, 'runner', 'cockpit', 'cli.mjs');

function createPolyglotExternalRepo(baseDir) {
  mkdirSync(join(baseDir, 'src', 'auth'), { recursive: true });
  mkdirSync(join(baseDir, 'src', 'api'), { recursive: true });
  mkdirSync(join(baseDir, 'workers'), { recursive: true });
  mkdirSync(join(baseDir, 'tests'), { recursive: true });

  writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'acme-polyglot-app', version: '0.2.0' }, null, 2));
  writeFileSync(join(baseDir, 'src', 'auth', 'token.ts'), [
    '// JWT session token verifier and role claims extractor',
    'export interface TokenClaims { sub: string; role: string; }',
    'export function verifySessionToken(raw: string): TokenClaims {',
    '  if (!raw.startsWith("tok_")) throw new Error("invalid");',
    '  return { sub: raw.slice(4), role: "member" };',
    '}'
  ].join('\n'));
  writeFileSync(join(baseDir, 'src', 'api', 'routes.ts'), [
    '/** HTTP route handlers for user profile and billing endpoints */',
    "import { verifySessionToken } from '../auth/token';",
    'export function handleProfileEndpoint(authHeader: string) {',
    '  const claims = verifySessionToken(authHeader);',
    '  return { path: "/api/v1/profile", user: claims.sub };',
    '}'
  ].join('\n'));
  writeFileSync(join(baseDir, 'workers', ' billing_sync.py'.trim()), [
    '"""Nightly Stripe invoice reconciliation worker."""',
    'import json',
    '',
    'def reconcile_invoices(batch_id: str) -> dict:',
    '    return {"batch": batch_id, "reconciled": True}'
  ].join('\n'));
  writeFileSync(join(baseDir, 'tests', 'auth.test.ts'), [
    '// Unit tests for token verification and profile route',
    "import { handleProfileEndpoint } from '../src/api/routes';",
    "import { verifySessionToken } from '../src/auth/token';",
    "describe('auth & profile', () => {",
    "  it('verifies valid session token', () => { verifySessionToken('tok_u1'); handleProfileEndpoint('tok_u1'); });",
    '});'
  ].join('\n'));
  writeFileSync(join(baseDir, 'tests', 'test_billing.py'), [
    '# Pytest suite for nightly invoice worker',
    'from workers.billing_sync import reconcile_invoices',
    '',
    'def test_reconcile_invoices_ok():',
    '    assert reconcile_invoices("b1")["reconciled"] is True'
  ].join('\n'));

  spawnSync('git', ['-C', baseDir, 'init', '-q']);
  spawnSync('git', ['-C', baseDir, 'config', 'user.email', 'dev@acme.test']);
  spawnSync('git', ['-C', baseDir, 'config', 'user.name', 'Acme Dev']);
  spawnSync('git', ['-C', baseDir, 'add', '-A']);
  spawnSync('git', ['-C', baseDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat: initial polyglot app']);
}

describe('Stage 23 · 独立通用变焦驾驶舱组件与 DoneGate 适配层解耦', () => {
  let extRepo = '';

  beforeAll(() => {
    extRepo = mkdtempSync(join(tmpdir(), 'cockpit-ext-polyglot-'));
    createPolyglotExternalRepo(extRepo);
  });

  afterAll(() => {
    if (!extRepo) return;
    try { rmSync(extRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (err) { void err; }
  });

  it('① 任意外部 TS + Python 裸仓运行 brief / zoom 零 DoneGate 概念泄漏且多语言头注与测试命令准确', () => {
    const briefRes = dispatchCockpitCommand(['brief'], extRepo);
    expect(briefRes.exitCode).toBe(0);
    expect(briefRes.stdout).toContain('# acme-polyglot-app · 代码仓库变焦驾驶舱');
    expect(briefRes.stdout).toContain('src/ 目录模块组');
    expect(briefRes.stdout).toContain('workers/ 目录模块组');
    expect(briefRes.stdout).toContain('zoom-cockpit locate');
    expect(briefRes.stdout).not.toContain('INTENT=');
    expect(briefRes.stdout).not.toContain('契约归属');
    expect(briefRes.stdout).not.toContain('runner/donegate.mjs');
    expect(briefRes.stdout).not.toContain('SHARED_GOVERNANCE_GLOBS');

    const briefJson = JSON.parse(dispatchCockpitCommand(['brief', '--json'], extRepo).stdout);
    expect(briefJson.project).toBe('acme-polyglot-app');
    expect(briefJson.languages['.ts']).toBe(3);
    expect(briefJson.languages['.py']).toBe(2);
    expect(briefJson.contracts).toBeUndefined();

    // Zoom-1 domain & tests topic (detects both vitest & pytest)
    const testsZoom = dispatchCockpitCommand(['zoom', 'tests'], extRepo);
    expect(testsZoom.exitCode).toBe(0);
    expect(testsZoom.stdout).toContain('npx vitest run tests/auth.test.ts');
    expect(testsZoom.stdout).toContain('pytest tests/test_billing.py');

    // Polyglot docstring extraction (JSDoc /** */ + Python """ """) & clean --source slice
    const domAll = dispatchCockpitCommand(['zoom', 'all'], extRepo);
    expect(domAll.exitCode).toBe(0);
    expect(domAll.stdout).toContain('HTTP route handlers for user profile and billing endpoints');
    expect(domAll.stdout).toContain('Nightly Stripe invoice reconciliation worker.');
    expect(domAll.stdout).not.toContain('零契约公开模式');

    const srcSlice = dispatchCockpitCommand(['zoom', 'workers/billing_sync.py:1-5', '--source'], extRepo);
    expect(srcSlice.exitCode).toBe(0);
    expect(srcSlice.stdout).toContain('模块目录: workers/（通用代码仓库模式）');
    expect(srcSlice.stdout).toContain('def reconcile_invoices');
    expect(srcSlice.stdout).not.toContain('契约归属');
  });

  it('② 外部裸仓 impact 动态发现任意目录并自动推导 TS vitest 与 Python pytest 命令，CBM 可用时 locate 精准命中', () => {
    const tsImpact = dispatchCockpitCommand(['impact', 'src/auth/token.ts'], extRepo);
    expect(tsImpact.exitCode).toBe(0);
    expect(tsImpact.stdout).toContain('跨文件符号、CBM 图谱与路由影响面雷达');
    expect(tsImpact.stdout).toContain('src/api/routes.ts');
    expect(tsImpact.stdout).toContain('tests/auth.test.ts');
    expect(tsImpact.stdout).toContain('npx vitest run tests/auth.test.ts');
    expect(tsImpact.stdout).not.toContain('本卡归属契约');

    const pyImpact = dispatchCockpitCommand(['impact', 'workers/billing_sync.py'], extRepo);
    expect(pyImpact.exitCode).toBe(0);
    expect(pyImpact.stdout).toContain('tests/test_billing.py');
    expect(pyImpact.stdout).toContain('pytest tests/test_billing.py');

    const cbmBin = resolveCbmBinary(REPO_ROOT);
    if (cbmBin) {
      const prevBin = process.env.COCKPIT_CBM_BIN;
      process.env.COCKPIT_CBM_BIN = cbmBin;
      try {
        const locRes = dispatchCockpitCommand(['locate', 'Stripe invoice reconciliation'], extRepo);
        expect(locRes.exitCode).toBe(0);
        expect(locRes.stdout).toContain('workers/billing_sync.py');
        expect(locRes.stdout).toMatch(/\[\d+\.\d{4} \| workers\]/);
        expect(locRes.stdout).toContain('def reconcile_invoices');
        expect(locRes.stdout).toContain('zoom-cockpit zoom workers/billing_sync.py --skeleton');
        expect(locRes.stdout).not.toContain('runner/donegate.mjs');
      } finally {
        if (prevBin === undefined) delete process.env.COCKPIT_CBM_BIN;
        else process.env.COCKPIT_CBM_BIN = prevBin;
      }
    }
  });

  it('③ 独立 CLI 子进程启动通用 MCP 服务暴露无前缀工具名 (brief/locate/zoom/impact) 并锁定边界零反向耦合', async () => {
    const child = spawn(process.execPath, [STANDALONE_CLI, 'mcp', '--root', extRepo], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let waiter = null;
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push(JSON.parse(line));
        nl = buf.indexOf('\n');
      }
      if (waiter && lines.length > 0) { const w = waiter; waiter = null; w(); }
    });
    const nextMsg = async () => {
      if (lines.length > 0) return lines.shift();
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('standalone mcp timeout')), 15000);
        waiter = () => { clearTimeout(t); res(); };
      });
      return lines.shift();
    };

    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })}\n`);
      const initMsg = await nextMsg();
      expect(initMsg.result.serverInfo.name).toBe('zoom-cockpit');

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
      const listMsg = await nextMsg();
      expect(listMsg.result.tools.map((t) => t.name)).toEqual(['brief', 'locate', 'zoom', 'impact']);

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brief', arguments: { budget: 800 } } })}\n`);
      const callMsg = await nextMsg();
      expect(callMsg.result.isError).toBeUndefined();
      expect(callMsg.result.content[0].text).toContain('acme-polyglot-app');
      expect(callMsg.result.content[0].text).not.toContain('INTENT=');
    } finally {
      child.stdin.end();
      await new Promise((r) => child.on('close', r));
    }

    // Verify architectural boundary: cockpit files outside adapters/ do NOT import atlas or commit-hygiene-metrics
    for (const f of ['adapter-protocol.mjs', 'cli.mjs', 'cockpit-budget.mjs', 'cockpit-commands.mjs', 'cockpit-locate.mjs', 'cockpit-mcp.mjs', 'cockpit-render.mjs', 'cockpit-source.mjs']) {
      const src = readFileSync(join(REPO_ROOT, 'runner', 'cockpit', f), 'utf8');
      expect(src, f).not.toMatch(/atlas\/contract\.mjs|commit-hygiene-metrics\.mjs|SHARED_GOVERNANCE_GLOBS/);
    }
  });
});
