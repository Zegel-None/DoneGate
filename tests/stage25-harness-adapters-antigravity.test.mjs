// Stage 25：可插拔 AI Harness 宿主适配层、多工作区治理 MCP 与 Antigravity 原生插件/随身质检钩子单测
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { createPlannedHarnessStub, listHarnessAdapters, registerHarnessAdapter } from '../runner/harnesses/index.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI_PATH = join(REPO_ROOT, 'runner', 'donegate.mjs');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function spawnGovMcp(extraArgs = []) {
  const child = spawn(process.execPath, [CLI_PATH, 'mcp', ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let buf = '';
  const queue = [];
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (waiters.length > 0) waiters.shift()(msg);
      else queue.push(msg);
    }
  });
  return {
    send: (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`),
    next: () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
    close: () => new Promise((r) => { child.once('close', (code) => r(code)); child.stdin.end(); })
  };
}

function runHookScript(hookPath, payload) {
  const r = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    windowsHide: true
  });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout || '{}');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }); } catch (err) { void err; }
  }
});

describe('stage25: pluggable harness adapters, --require-root governance MCP, and Antigravity plugin', () => {
  it('① harness list 列出 DSH / Antigravity / Claude Code / Codex 四宿主适配器，支持占位桩与动态插拔注册', () => {
    const res = dispatchCommand(['harness', 'list', '--json'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    const data = JSON.parse(res.stdout);
    const ids = data.harnesses.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['dsh', 'antigravity', 'claude-code', 'codex']));
    expect(data.harnesses.find((h) => h.id === 'antigravity').implemented).toBe(true);
    expect(data.harnesses.find((h) => h.id === 'claude-code').implemented).toBe(true);
    expect(data.harnesses.find((h) => h.id === 'codex').implemented).toBe(true);

    const planned = createPlannedHarnessStub({
      id: 'planned-stub',
      displayName: 'Planned Stub',
      description: 'reserved stub',
      targetHint: '/workspace/repo/.planned'
    });
    expect(planned.implemented).toBe(false);
    expect(planned.install().exitCode).toBe(3);

    registerHarnessAdapter({
      id: 'demo-harness',
      displayName: 'Demo Harness',
      description: 'test plugin',
      implemented: true,
      detect: () => ({ available: true, installed: false, state: 'available', detail: 'ok' }),
      status: () => ({ ok: true, id: 'demo-harness', installed: false, summary: 'ready' }),
      install: () => ({ ok: true, exitCode: 0, id: 'demo-harness', summary: 'installed' }),
      uninstall: () => ({ ok: true, exitCode: 0, id: 'demo-harness', summary: 'removed' })
    });
    expect(listHarnessAdapters().some((h) => h.id === 'demo-harness')).toBe(true);
  });

  it('② donegate mcp --require-root --governance-only 仅暴露 4 个治理工具并强制多工作区 root 隔离', async () => {
    const repoA = makeTempDir('dg-mcp-root-a-');
    mkdirSync(join(repoA, 'src', 'billing'), { recursive: true });
    writeFileSync(join(repoA, 'src', 'billing', 'calc.mjs'), 'export const sum = (a, b) => a + b;\n');
    expect(dispatchCommand(['init', '--discover', '--root', repoA], REPO_ROOT).exitCode).toBe(0);

    const mcp = spawnGovMcp(['--require-root', '--governance-only']);
    try {
      mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
      const init = await mcp.next();
      expect(init.result.serverInfo.name).toBe('donegate-governance');

      mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const listed = await mcp.next();
      expect(listed.result.tools.map((t) => t.name)).toEqual(['dg_status', 'dg_slice', 'dg_lint_edit', 'dg_check_node']);
      for (const tool of listed.result.tools) {
        expect(tool.inputSchema.required).toContain('root');
      }

      mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dg_status', arguments: {} } });
      const missingRoot = await mcp.next();
      expect(missingRoot.result.isError).toBe(true);
      expect(missingRoot.result.content[0].text).toContain('--require-root');

      mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dg_brief', arguments: { root: repoA } } });
      const hiddenBase = await mcp.next();
      expect(hiddenBase.error.code).toBe(-32602);

      mcp.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'dg_status', arguments: { root: repoA } } });
      const okStatus = await mcp.next();
      expect(okStatus.result.isError).toBeUndefined();
      expect(okStatus.result.content[0].text).toContain('探索中');
    } finally {
      expect(await mcp.close()).toBe(0);
    }
  }, 20000);

  it('③ Antigravity 原生插件安装、随身质检钩子（普通仓静默 / DoneGate 仓拦截）与卸载全链路', () => {
    const pluginDir = makeTempDir('dg-agy-plugin-');
    const inst = dispatchCommand(['harness', 'install', 'antigravity', '--dir', pluginDir, '--json'], REPO_ROOT);
    expect(inst.exitCode).toBe(0);
    const instData = JSON.parse(inst.stdout);
    expect(instData.ok).toBe(true);
    expect(instData.hooksEnabled).toBe(true);
    expect(instData.skills).toEqual(expect.arrayContaining(['donegate', 'donegate-judge', 'donegate-forge']));

    const manifest = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('donegate');
    expect(typeof manifest.repository).toBe('string');

    const mcpCfg = JSON.parse(readFileSync(join(pluginDir, 'mcp_config.json'), 'utf8'));
    expect(mcpCfg.mcpServers.governance.args).toEqual(expect.arrayContaining(['mcp', '--require-root', '--governance-only']));

    const rulesText = readFileSync(join(pluginDir, 'rules', 'AGENTS.md'), 'utf8');
    expect(rulesText).toMatch(/^---\r?\ntrigger: always_on\r?\n---/);

    const hookScript = join(pluginDir, 'hooks', 'donegate-guard.mjs');
    expect(existsSync(hookScript)).toBe(true);

    // 1) 普通非 DoneGate 仓库：静默跳过不打扰
    const plainRepo = makeTempDir('dg-plain-repo-');
    const plainFile = join(plainRepo, 'index.mjs');
    writeFileSync(plainFile, '// ' + 'TODO: quick scratch\n');
    expect(runHookScript(hookScript, {
      hookEventName: 'PostToolUse',
      workspacePaths: [plainRepo],
      toolCall: { name: 'edit_file', args: { Path: plainFile } }
    })).toEqual({});
    expect(runHookScript(hookScript, {
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
      workspacePaths: [plainRepo]
    })).toEqual({ decision: 'allow' });

    // 2) DoneGate 治理仓库：改坏文件 -> PostToolUse 记警报 -> PreInvocation 注入提醒 / Stop 拦截
    const dgRepo = makeTempDir('dg-guarded-repo-');
    expect(dispatchCommand(['init', '--root', dgRepo], REPO_ROOT).exitCode).toBe(0);
    mkdirSync(join(dgRepo, 'src'), { recursive: true });
    const badFile = join(dgRepo, 'src', 'app.mjs');
    writeFileSync(badFile, 'export function run() { // ' + 'TODO: unfinished\n  return 1;\n}\n');

    expect(runHookScript(hookScript, {
      hookEventName: 'PostToolUse',
      conversationId: 'conv-1',
      workspacePaths: [dgRepo],
      toolCall: { name: 'edit_file', args: { Path: badFile } }
    })).toEqual({});

    const pre = runHookScript(hookScript, {
      hookEventName: 'PreInvocation',
      conversationId: 'conv-1',
      workspacePaths: [dgRepo]
    });
    expect(pre.injectSteps?.[0]?.systemMessage?.systemMessage).toContain('随身质检提醒');

    // 再触发一次 PostToolUse 测 Stop 兜底拦截
    runHookScript(hookScript, {
      hookEventName: 'PostToolUse',
      conversationId: 'conv-1',
      workspacePaths: [dgRepo],
      toolCall: { name: 'edit_file', args: { Path: badFile } }
    });
    const stopBlocked = runHookScript(hookScript, {
      hookEventName: 'Stop',
      terminationReason: 'NO_TOOL_CALL',
      continuationActive: false,
      conversationId: 'conv-1',
      workspacePaths: [dgRepo]
    });
    expect(stopBlocked.decision).toBe('continue');
    expect(stopBlocked.reason).toContain('随身质检拦截');

    const st = dispatchCommand(['harness', 'status', 'antigravity', '--dir', pluginDir, '--json'], REPO_ROOT);
    expect(st.exitCode).toBe(0);
    const stData = JSON.parse(st.stdout);
    expect(stData.ok).toBe(true);
    if (stData.agnix?.checked) expect(stData.agnix.ok).toBe(true);

    const uninst = dispatchCommand(['harness', 'uninstall', 'antigravity', '--dir', pluginDir], REPO_ROOT);
    expect(uninst.exitCode).toBe(0);
    expect(existsSync(pluginDir)).toBe(false);
  });
});
