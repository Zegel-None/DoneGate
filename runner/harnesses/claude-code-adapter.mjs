// Claude Code 原生宿主适配器（.mcp.json + .claude/settings.json 钩子 + STEER 热纠偏尾部追加，L5，<= 95 行）
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateHarnessAdapter } from './protocol.mjs';
import { HARNESS_SKILL_DIRS, appendLiveSteerTail as appendSharedSteerTail, buildAntigravityMcpConfig, formatHarnessDetection, hasManagedHooksReady, installHarnessSkills, pruneEmptyDir, readJsonObjectSafe, syncManagedHooksConfig, uninstallHarnessSkills } from './antigravity-assets.mjs';

export function appendLiveSteerTail(projectRoot, baseInput = '', opts = {}) {
  return appendSharedSteerTail(projectRoot, baseInput, { ...opts, host: 'claude-code' });
}

export function resolveClaudeCodeRoot(opts = {}) {
  if (typeof opts.configRoot === 'string' && opts.configRoot.trim()) return resolve(opts.configRoot);
  if (typeof opts.dir === 'string' && opts.dir.trim()) return resolve(opts.dir);
  return homedir();
}

function inspectClaude(rootDir) {
  const claudeDir = join(rootDir, '.claude');
  const mcpRes = readJsonObjectSafe(join(rootDir, '.mcp.json'));
  const setRes = readJsonObjectSafe(join(claudeDir, 'settings.json'));
  const mcpConfigured = Boolean(!mcpRes.error && mcpRes.value?.mcpServers?.donegate);
  const hooksEnabled = !setRes.error && hasManagedHooksReady(setRes.value, join(claudeDir, 'hooks', 'donegate-guard.mjs'));
  const skills = HARNESS_SKILL_DIRS.filter((s) => existsSync(join(claudeDir, 'skills', s, 'SKILL.md')));
  return { claudeDir, mcpRes, setRes, mcpConfigured, hooksEnabled, skills, installed: mcpConfigured && skills.length === HARNESS_SKILL_DIRS.length };
}

export const claudeCodeHarnessAdapter = validateHarnessAdapter({
  id: 'claude-code',
  displayName: 'Claude Code',
  description: 'Claude Code 原生宿主适配器：合并 .mcp.json 治理 MCP、挂载 .claude/settings.json 守护钩子并部署三套技能。',
  implemented: true,
  capabilities: ['mcp-require-root', 'lifecycle-hooks', 'skills', 'live-steer-tail'],
  appendLiveSteerTail(projectRoot, baseInput = '', opts = {}) {
    return appendLiveSteerTail(projectRoot, baseInput, opts);
  },
  detect(opts = {}) {
    const rootDir = resolveClaudeCodeRoot(opts);
    const info = inspectClaude(rootDir);
    return formatHarnessDetection(info.installed, existsSync(info.claudeDir) || existsSync(join(rootDir, '.mcp.json')), info.claudeDir, '未检测到 ~/.claude');
  },
  status(ctx = {}) {
    const rootDir = resolveClaudeCodeRoot(ctx);
    const info = inspectClaude(rootDir);
    const err = info.mcpRes.error || info.setRes.error || null;
    let summary = `尚未安装（${rootDir}）`;
    if (err) summary = `配置损坏：${err}`;
    else if (info.installed) summary = `已安装且就绪（${rootDir} | 钩子=${info.hooksEnabled ? '开启' : '关闭'} | 技能=${info.skills.length}）`;
    return { ok: !err, id: 'claude-code', displayName: 'Claude Code', implemented: true, installed: info.installed, configRoot: rootDir, mcpConfigured: info.mcpConfigured, hooksEnabled: info.hooksEnabled, skills: info.skills, summary };
  },
  install(ctx = {}) {
    const donegateRoot = resolve(ctx.donegateRoot);
    const rootDir = resolveClaudeCodeRoot(ctx);
    const info = inspectClaude(rootDir);
    if (info.mcpRes.error || info.setRes.error) return { ok: false, exitCode: 1, id: 'claude-code', reason: info.mcpRes.error || info.setRes.error };
    const withHooks = !ctx.noHooks;
    const fullMcp = Boolean(ctx.fullMcp);
    mkdirSync(info.claudeDir, { recursive: true });
    const dgServer = buildAntigravityMcpConfig({ donegateRoot, fullMcp }).mcpServers.governance;
    const nextMcp = { ...info.mcpRes.value, mcpServers: { ...(info.mcpRes.value.mcpServers || {}), donegate: dgServer } };
    writeFileSync(join(rootDir, '.mcp.json'), JSON.stringify(nextMcp, null, 2) + '\n', 'utf8');
    syncManagedHooksConfig({ jsonFilePath: join(info.claudeDir, 'settings.json'), guardPath: join(info.claudeDir, 'hooks', 'donegate-guard.mjs'), donegateRoot, host: 'claude-code', postMatcher: 'Write|Edit|MultiEdit', withHooks });
    const skills = installHarnessSkills(donegateRoot, join(info.claudeDir, 'skills'), info.claudeDir);
    return { ok: true, exitCode: 0, id: 'claude-code', configRoot: rootDir, hooksEnabled: withHooks, fullMcp, skills, summary: `已安装 Claude Code 宿主配置 → ${rootDir}` };
  },
  uninstall(ctx = {}) {
    const rootDir = resolveClaudeCodeRoot(ctx);
    const info = inspectClaude(rootDir);
    if (info.mcpRes.exists && !info.mcpRes.error) {
      const next = { ...info.mcpRes.value };
      const rest = { ...(next.mcpServers || {}) };
      delete rest.donegate;
      if (Object.keys(rest).length > 0) next.mcpServers = rest;
      else delete next.mcpServers;
      if (Object.keys(next).length === 0) rmSync(join(rootDir, '.mcp.json'), { force: true });
      else writeFileSync(join(rootDir, '.mcp.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
    }
    syncManagedHooksConfig({ jsonFilePath: join(info.claudeDir, 'settings.json'), guardPath: join(info.claudeDir, 'hooks', 'donegate-guard.mjs'), donegateRoot: ctx.donegateRoot || rootDir, host: 'claude-code', postMatcher: 'Write|Edit|MultiEdit', withHooks: false });
    uninstallHarnessSkills(join(info.claudeDir, 'skills'));
    pruneEmptyDir(join(info.claudeDir, 'skills'));
    pruneEmptyDir(info.claudeDir);
    return { ok: true, exitCode: 0, id: 'claude-code', configRoot: rootDir, summary: `已卸载 DoneGate Claude Code 托管配置（${rootDir}）` };
  }
});
