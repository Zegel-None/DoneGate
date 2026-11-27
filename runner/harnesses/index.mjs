// DoneGate 可插拔 AI Harness 宿主适配器注册表与 CLI 入口（donegate harness list|install|status|uninstall，L5，<= 150 行）
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlannedHarnessStub, validateHarnessAdapter } from './protocol.mjs';
import { dshHarnessAdapter } from './dsh-adapter.mjs';
import { antigravityHarnessAdapter } from './antigravity-adapter.mjs';

const DONEGATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const claudeCodeStub = createPlannedHarnessStub({
  id: 'claude-code',
  displayName: 'Claude Code',
  description: '预留适配器：后续对接 Claude Code 插件包（.claude/plugins + settings.json hooks + .mcp.json）。',
  targetHint: '~/.claude/plugins/donegate/ + .mcp.json',
  capabilities: ['mcp-require-root', 'hooks', 'skills']
});

const codexStub = createPlannedHarnessStub({
  id: 'codex',
  displayName: 'OpenAI Codex CLI',
  description: '预留适配器：后续对接 Codex CLI（~/.codex/config.toml MCP + AGENTS.md + skills）。',
  targetHint: '~/.codex/config.toml + ~/.codex/skills/donegate/',
  capabilities: ['mcp-require-root', 'skills', 'rules']
});

const HARNESS_MAP = new Map([
  [dshHarnessAdapter.id, dshHarnessAdapter],
  [antigravityHarnessAdapter.id, antigravityHarnessAdapter],
  [claudeCodeStub.id, claudeCodeStub],
  [codexStub.id, codexStub]
]);

export function registerHarnessAdapter(adapter) {
  const valid = validateHarnessAdapter(adapter);
  HARNESS_MAP.set(valid.id, valid);
  return valid;
}

export function getHarnessAdapter(id) {
  return HARNESS_MAP.get(String(id || '').trim().toLowerCase()) || null;
}

export function listHarnessAdapters(opts = {}) {
  return [...HARNESS_MAP.values()].map((a) => ({
    id: a.id,
    displayName: a.displayName,
    description: a.description,
    implemented: Boolean(a.implemented),
    capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
    detection: a.detect(opts)
  }));
}

function formatListText(items) {
  const lines = [`DoneGate 可插拔 AI Harness 宿主适配器（共 ${items.length} 个）：`];
  for (const it of items) {
    const tag = !it.implemented ? '预留占位' : (it.detection.installed ? '已安装' : (it.detection.available ? '可安装' : '未检测到宿主'));
    lines.push(`  - ${it.id.padEnd(12)} [${tag}] ${it.displayName} — ${it.detection.detail}`);
  }
  lines.push('用法：node runner/donegate.mjs harness <list|status|install|uninstall> <id> [--no-hooks] [--full-mcp] [--dir <path>] [--json]');
  return lines.join('\n');
}

function hrDispatchAdapterAction(adapter, sub, ctx, asJson) {
  if (sub === 'status') {
    const st = adapter.status(ctx);
    return { exitCode: st.ok ? 0 : 1, status: st, stdout: asJson ? JSON.stringify(st, null, 2) : `[${adapter.id}] ${st.summary}` };
  }
  if (sub === 'install' || sub === 'uninstall') {
    const res = adapter[sub](ctx);
    if (!res.ok) return { exitCode: res.exitCode || 1, stderr: res.reason || res.summary, result: res };
    return { exitCode: 0, result: res, stdout: asJson ? JSON.stringify(res, null, 2) : res.summary };
  }
  return { exitCode: 3, stderr: `未知 harness 子命令：${sub}（支持 list | status | install | uninstall）` };
}

export function cmdHarness(projectRoot, opts = {}) {
  const sub = String(opts.sub || 'list').trim().toLowerCase();
  const targetId = String(opts.targetId || '').trim().toLowerCase();
  const ctx = {
    projectRoot: resolve(projectRoot || process.cwd()),
    donegateRoot: DONEGATE_ROOT,
    dir: opts.dir,
    configRoot: opts.configRoot,
    noHooks: Boolean(opts.noHooks),
    fullMcp: Boolean(opts.fullMcp)
  };
  if (sub === 'list') {
    const items = listHarnessAdapters(ctx);
    return {
      exitCode: 0,
      harnesses: items,
      stdout: opts.json ? JSON.stringify({ ok: true, harnesses: items }, null, 2) : formatListText(items)
    };
  }
  const adapter = getHarnessAdapter(targetId);
  if (!adapter) {
    return { exitCode: 3, stderr: `未知宿主适配器：${targetId || '(空)'}（可用：${[...HARNESS_MAP.keys()].join(' | ')}）` };
  }
  return hrDispatchAdapterAction(adapter, sub, ctx, Boolean(opts.json));
}
