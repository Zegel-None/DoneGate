// OpenAI Codex CLI 原生宿主适配器（config.toml MCP + 官方 Schema hooks.json + 技能与网络通配符校验，L5，<= 115 行）
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateHarnessAdapter } from './protocol.mjs';
import { HARNESS_SKILL_DIRS, buildAntigravityMcpConfig, formatHarnessDetection, hasManagedHooksReady, installHarnessSkills, pruneEmptyDir, readJsonObjectSafe, syncManagedHooksConfig, uninstallHarnessSkills } from './antigravity-assets.mjs';

const TOML_START = '# >>> donegate-managed-start >>>';
const TOML_END = '# <<< donegate-managed-end <<<';

export function resolveCodexConfigRoot(opts = {}) {
  if (typeof opts.configRoot === 'string' && opts.configRoot.trim()) return resolve(opts.configRoot);
  if (typeof opts.dir === 'string' && opts.dir.trim()) return resolve(opts.dir);
  if (typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.trim()) return resolve(process.env.CODEX_HOME);
  return join(homedir(), '.codex');
}

function isValidPort(p) {
  if (!p) return true;
  const n = Number(p);
  return /^\d+$/.test(p) && n >= 1 && n <= 65535;
}

export function validateCodexNetworkRuleHost(rawHost, opts = {}) {
  const text = String(rawHost || '').trim();
  if (!text) return { ok: false, code: 'EMPTY_NETWORK_HOST', reason: '策略网络规则主机名不能为空' };
  if (/^[a-z]+:\/\//i.test(text) || /[/?#@\s]/.test(text)) return { ok: false, code: 'INVALID_NETWORK_HOST', reason: `非法主机格式：${text}` };
  const colonIdx = text.lastIndexOf(':');
  const hostPart = colonIdx > 0 ? text.slice(0, colonIdx) : text;
  if (!isValidPort(colonIdx > 0 ? text.slice(colonIdx + 1) : '')) return { ok: false, code: 'INVALID_NETWORK_PORT', reason: `非法端口：${text}` };
  const allowSubWild = Boolean(opts.allowSubdomainWildcard) && /^\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(hostPart);
  if (hostPart.includes('*') && !allowSubWild) return { ok: false, code: 'WILDCARD_NETWORK_HOST_DENIED', reason: `REF-07 安全红线：严禁放行通配符网络主机规则「${text}」` };
  if (!/^(?:\*\.)?[a-z0-9.-]+$/i.test(hostPart) || hostPart === '0.0.0.0') return { ok: false, code: 'INVALID_NETWORK_HOST', reason: `非法主机：${text}` };
  return { ok: true, normalizedHost: text.toLowerCase() };
}

export function validateCodexNetworkAllowlist(hosts = [], opts = {}) {
  const list = Array.isArray(hosts) ? hosts : String(hosts || '').split(',').map((s) => s.trim()).filter(Boolean);
  const normalized = [];
  for (const h of list) {
    const r = validateCodexNetworkRuleHost(h, opts);
    if (!r.ok) return r;
    normalized.push(r.normalizedHost);
  }
  return { ok: true, hosts: normalized };
}

function stripDoneGateToml(rawToml) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const step1 = String(rawToml || '').replace(new RegExp(`\\n?${esc(TOML_START)}[\\s\\S]*?${esc(TOML_END)}\\n?`, 'g'), '\n');
  return step1.replace(/\n?\[mcp_servers\.donegate\][^\n]*(?:\n(?!\[)[^\n]*)*/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function inspectCodex(codexDir) {
  const rawToml = existsSync(join(codexDir, 'config.toml')) ? readFileSync(join(codexDir, 'config.toml'), 'utf8') : '';
  const mcpConfigured = /\[mcp_servers\.donegate\]/.test(rawToml);
  const hjRes = readJsonObjectSafe(join(codexDir, 'hooks.json'));
  const hooksEnabled = !hjRes.error && hasManagedHooksReady(hjRes.value, join(codexDir, 'hooks', 'donegate-guard.mjs'));
  const skills = HARNESS_SKILL_DIRS.filter((s) => existsSync(join(codexDir, 'skills', s, 'SKILL.md')));
  return { mcpConfigured, hooksEnabled, skills, installed: mcpConfigured && skills.length === HARNESS_SKILL_DIRS.length };
}

export const codexHarnessAdapter = validateHarnessAdapter({
  id: 'codex',
  displayName: 'OpenAI Codex CLI',
  description: 'OpenAI Codex CLI 原生宿主适配器：生成官方 Schema hooks.json、挂载 config.toml [mcp_servers.donegate]、部署三套技能与网络规则校验。',
  implemented: true,
  capabilities: ['mcp-require-root', 'lifecycle-hooks', 'skills', 'network-policy-guard'],
  detect(opts = {}) {
    const codexDir = resolveCodexConfigRoot(opts);
    return formatHarnessDetection(inspectCodex(codexDir).installed, existsSync(codexDir), codexDir, '未检测到 ~/.codex');
  },
  status(ctx = {}) {
    const codexDir = resolveCodexConfigRoot(ctx);
    const info = inspectCodex(codexDir);
    const summary = info.installed ? `已安装且就绪（${codexDir} | 钩子=${info.hooksEnabled ? '开启' : '关闭'} | 技能=${info.skills.length}）` : `尚未安装（${codexDir}）`;
    return { ok: true, id: 'codex', displayName: 'OpenAI Codex CLI', implemented: true, installed: info.installed, configRoot: codexDir, mcpConfigured: info.mcpConfigured, hooksEnabled: info.hooksEnabled, skills: info.skills, summary };
  },
  install(ctx = {}) {
    const netCheck = validateCodexNetworkAllowlist(ctx.allowedNetworkHosts || []);
    if (!netCheck.ok) return { ok: false, exitCode: 2, id: 'codex', code: netCheck.code, reason: netCheck.reason };
    const donegateRoot = resolve(ctx.donegateRoot);
    const codexDir = resolveCodexConfigRoot(ctx);
    const withHooks = !ctx.noHooks;
    const fullMcp = Boolean(ctx.fullMcp);
    mkdirSync(codexDir, { recursive: true });
    const hookRes = syncManagedHooksConfig({ jsonFilePath: join(codexDir, 'hooks.json'), guardPath: join(codexDir, 'hooks', 'donegate-guard.mjs'), donegateRoot, host: 'codex', postMatcher: 'Bash|Write|Edit', withHooks });
    if (!hookRes.ok) return { ok: false, exitCode: 1, id: 'codex', reason: hookRes.reason };
    const mcp = buildAntigravityMcpConfig({ donegateRoot, fullMcp }).mcpServers.governance;
    const dgBlock = [TOML_START, '[mcp_servers.donegate]', `command = ${JSON.stringify(mcp.command)}`, `args = [${mcp.args.map((a) => JSON.stringify(a)).join(', ')}]`, TOML_END].join('\n');
    const tomlPath = join(codexDir, 'config.toml');
    const baseToml = existsSync(tomlPath) ? stripDoneGateToml(readFileSync(tomlPath, 'utf8')) : '';
    writeFileSync(tomlPath, (baseToml ? `${baseToml}\n\n${dgBlock}` : dgBlock) + '\n', 'utf8');
    const skills = installHarnessSkills(donegateRoot, join(codexDir, 'skills'), codexDir);
    return { ok: true, exitCode: 0, id: 'codex', configRoot: codexDir, hooksEnabled: withHooks, fullMcp, allowedNetworkHosts: netCheck.hosts, skills, summary: `已安装 Codex CLI 宿主配置 → ${codexDir}` };
  },
  uninstall(ctx = {}) {
    const codexDir = resolveCodexConfigRoot(ctx);
    if (!existsSync(codexDir)) return { ok: true, exitCode: 0, id: 'codex', configRoot: codexDir, summary: `目录不存在（${codexDir}）` };
    const tomlPath = join(codexDir, 'config.toml');
    if (existsSync(tomlPath)) {
      const rest = stripDoneGateToml(readFileSync(tomlPath, 'utf8'));
      if (rest) writeFileSync(tomlPath, `${rest}\n`, 'utf8');
      else rmSync(tomlPath, { force: true });
    }
    syncManagedHooksConfig({ jsonFilePath: join(codexDir, 'hooks.json'), guardPath: join(codexDir, 'hooks', 'donegate-guard.mjs'), donegateRoot: ctx.donegateRoot || codexDir, host: 'codex', postMatcher: 'Bash|Write|Edit', withHooks: false });
    uninstallHarnessSkills(join(codexDir, 'skills'));
    pruneEmptyDir(join(codexDir, 'skills'));
    pruneEmptyDir(codexDir);
    return { ok: true, exitCode: 0, id: 'codex', configRoot: codexDir, summary: `已卸载 DoneGate Codex CLI 托管配置（${codexDir}）` };
  }
});
