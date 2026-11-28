// 过夜挂机可选 OS 级沙箱包装器、网络隔离诚实分级与开跑前主动自验探针（归属契约：governance-autopilot，<= 230 行）
import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { classifySandboxDenialOutput } from '../../core/index.mjs';
import { hagSanitizeSubagentEnv } from '../../shared/subagent-env.mjs';
import { findExecutableInDirs, getSharedWorkflowDepsPaths, normalizeSlashes } from '../deps/index.mjs';

export const AOS_DEFAULT_DENY_PATHS = Object.freeze([
  'contracts/',
  'skill/',
  '.githooks/',
  '.donegate/chain.jsonl',
  '~/.ssh',
  '~/.aws',
  '.env',
  '.env.*'
]);

export function aosProbeOsSandbox(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const platform = opts.platform || process.platform;
  const shared = getSharedWorkflowDepsPaths(root);
  const sharedBase = shared.depsDir || join(root, 'workflows', '.deps', '_shared');
  const searchDirs = [
    join(sharedBase, 'npm-cells', 'srt', 'node_modules', '.bin'),
    shared.binDir,
    shared.npmBinDir
  ].filter(Boolean);
  const binPath = opts.simulateMissing === true
    ? null
    : (opts.mockBinPath || findExecutableInDirs('srt', searchDirs, platform));
  const isWinAlpha = platform === 'win32';
  return {
    available: Boolean(binPath),
    binPath: binPath || null,
    platform,
    isWinAlpha,
    readyForDefaultUse: Boolean(binPath) && (!isWinAlpha || opts.allowWin32Alpha === true)
  };
}

export function resolveSandboxEgressMode(opts = {}, probe = null) {
  const platform = opts.platform || probe?.platform || process.platform;
  const hasOsNetIsolation = opts.osNetIsolation === true || Boolean(probe?.readyForDefaultUse && platform !== 'win32');
  if (hasOsNetIsolation) return 'enforced-egress';
  const env = opts.env || {};
  const hasProxy = Boolean(opts.proxyUrl || env.HTTPS_PROXY || env.HTTP_PROXY || env.https_proxy || env.http_proxy);
  return hasProxy ? 'cooperative-proxy' : 'none';
}

export function classifySandboxExecResult(execOut = {}) {
  const rawExit = typeof execOut.exitCode === 'number' ? execOut.exitCode : execOut.status;
  const exitCode = typeof rawExit === 'number' ? rawExit : 1;
  const cls = classifySandboxDenialOutput(execOut.stdout || '', execOut.stderr || execOut.reason || '', exitCode);
  return {
    exitCode,
    state: cls.state,
    sandboxDenied: cls.sandboxDenied,
    reasonCode: cls.reasonCode,
    matchedPattern: cls.matchedPattern
  };
}

export function aosBuildSandboxPolicy(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const worktreePath = opts.worktreePath ? resolve(root, opts.worktreePath) : root;
  const rawScopes = Array.isArray(opts.allowedWriteScopes) ? opts.allowedWriteScopes : [];
  const cleanScopes = rawScopes
    .map((s) => normalizeSlashes(String(s || '').trim()).replace(/^\.\//, ''))
    .filter(Boolean);
  const writablePaths = cleanScopes.length > 0
    ? cleanScopes.map((s) => normalizeSlashes(join(worktreePath, s)))
    : [normalizeSlashes(worktreePath)];

  return {
    schema: 'donegate-os-sandbox-policy/v1',
    worktreePath: normalizeSlashes(worktreePath),
    network: { enabled: opts.allowNetwork === true, allowedHosts: opts.allowNetwork === true ? (opts.allowedHosts || []) : [] },
    filesystem: {
      writablePaths,
      deniedWritePaths: [...AOS_DEFAULT_DENY_PATHS, ...(Array.isArray(opts.extraDenyPaths) ? opts.extraDenyPaths : [])],
      deniedReadPaths: ['~/.ssh', '~/.aws', '.env', '.env.*']
    }
  };
}

function aosInjectProxyEnv(baseEnv, proxyUrl, noProxy) {
  if (!proxyUrl) return baseEnv;
  const bypass = noProxy || '127.0.0.1,localhost';
  return {
    ...baseEnv,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: bypass,
    no_proxy: bypass
  };
}

export function wrapCommandWithOsSandbox(projectRoot, command, opts = {}) {
  const root = resolve(projectRoot);
  const policy = opts.policy || aosBuildSandboxPolicy(root, opts);
  const sanitizedEnv = aosInjectProxyEnv(hagSanitizeSubagentEnv(opts.env || process.env), opts.proxyUrl, opts.noProxy);
  const probe = aosProbeOsSandbox(root, opts);
  const egressMode = resolveSandboxEgressMode({ ...opts, env: sanitizedEnv }, probe);

  if (probe.readyForDefaultUse) {
    const policyDir = join(root, '.donegate', 'sandbox');
    mkdirSync(policyDir, { recursive: true });
    const policyPath = join(policyDir, `srt-policy-${String(opts.runId || 'latest').replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
    writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n', 'utf8');
    return {
      ok: true, exitCode: 0, mode: 'os-sandbox-srt', egressMode, degraded: false,
      binPath: probe.binPath, policyPath, policy,
      command: `${JSON.stringify(probe.binPath)} --settings ${JSON.stringify(policyPath)} -- ${command}`,
      env: sanitizedEnv, warning: null
    };
  }

  const reason = probe.isWinAlpha
    ? 'Windows 平台下 anthropics/sandbox-runtime (srt) 仍处于官方 Alpha（需管理员一次配置 WFP），默认降级为 Git Worktree + 写范围门禁 + 环境变量清洗'
    : '未在共享池或 PATH 检测到 OS 级沙箱可执行文件 srt，已降级为 Git Worktree + 写范围门禁 + 环境变量清洗';

  if (opts.strict === true) {
    return {
      ok: false, exitCode: 3, code: 'OS_SANDBOX_REQUIRED', mode: 'blocked-strict', egressMode,
      degraded: false, policy, env: sanitizedEnv,
      reason: `已启用 --strict-sandbox 强沙箱模式，但无法激活 OS 级沙箱：${reason}`
    };
  }

  return {
    ok: true, exitCode: 0, mode: 'worktree-soft-degrade', egressMode, degraded: true,
    policy, command, env: sanitizedEnv, warning: `⚠ ${reason}`
  };
}

function aosProbeProxyBlocksConnect(proxyUrl, blockedTarget, timeoutMs = 1500) {
  return new Promise((res) => {
    let parsed;
    try { parsed = new URL(proxyUrl); } catch { res({ blocked: false, statusCode: 0 }); return; }
    const req = http.request({
      host: parsed.hostname,
      port: Number(parsed.port) || 80,
      method: 'CONNECT',
      path: blockedTarget,
      timeout: timeoutMs
    });
    const finish = (blocked, statusCode) => { req.destroy(); res({ blocked, statusCode }); };
    req.once('connect', (upRes, sock) => { sock.destroy(); finish(upRes.statusCode === 403, upRes.statusCode || 0); });
    req.once('response', (upRes) => { upRes.resume(); finish(upRes.statusCode === 403, upRes.statusCode || 0); });
    req.once('timeout', () => finish(false, 0));
    req.once('error', () => finish(false, 0));
    req.end();
  });
}

async function aosProbeReadOnlyWriteBlocked(targetPath, writeProbeRunner) {
  if (typeof writeProbeRunner === 'function') {
    const out = await writeProbeRunner(targetPath);
    if (out && out.blocked === true) return true;
    return Boolean(out && typeof out.exitCode === 'number' && out.exitCode !== 0);
  }
  const abs = resolve(targetPath);
  const isExistingDir = existsSync(abs) && statSync(abs).isDirectory();
  const probeFile = isExistingDir ? join(abs, `.dg-ro-probe-${process.pid}`) : abs;
  const existedBefore = existsSync(probeFile);
  try {
    appendFileSync(probeFile, '');
    if (!existedBefore) {
      try { unlinkSync(probeFile); } catch (err) { void err; }
    }
    return false;
  } catch (err) {
    const cls = classifySandboxDenialOutput('', String(err?.code || err?.message || 'EACCES'), 1);
    return cls.sandboxDenied || Boolean(err);
  }
}

function aosFailProbe(egressMode, failedProbe, reason, extra = {}) {
  return { ok: false, exitCode: 3, code: 'SANDBOX_PROBE_BYPASSED', reasonCode: 'SANDBOX_PROBE_BYPASSED', egressMode, failedProbe, reason, ...extra };
}

export async function verifySandboxEnforcementProbe(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const probe = aosProbeOsSandbox(root, opts);
  const egressMode = resolveSandboxEgressMode(opts, probe);
  const hasRoCheck = Boolean(opts.protectedProbePath || typeof opts.writeProbeRunner === 'function');
  const hasEgressCheck = Boolean(opts.proxyUrl || opts.expectEgressBlocked === true);

  if (opts.strict === true && !probe.readyForDefaultUse && !hasRoCheck && !hasEgressCheck) {
    return aosFailProbe(egressMode, 'missing-enforcement', '沙箱主动探针失败：严格模式下未激活任何可验证的沙箱或代理边界');
  }
  if (hasRoCheck) {
    const roBlocked = await aosProbeReadOnlyWriteBlocked(opts.protectedProbePath || root, opts.writeProbeRunner);
    if (!roBlocked) return aosFailProbe(egressMode, 'readonly-write', `沙箱主动探针失败：受保护只读路径写探针未被阻断 (${opts.protectedProbePath || 'custom'})`);
  }
  if (hasEgressCheck) {
    if (!opts.proxyUrl) return aosFailProbe(egressMode, 'egress-blacklist', '沙箱主动探针失败：要求出口白名单拦截但缺少代理地址');
    const blockedTarget = opts.probeBlockedHost || 'sandbox-probe-forbidden.invalid:443';
    const egRes = await aosProbeProxyBlocksConnect(opts.proxyUrl, blockedTarget, opts.probeTimeoutMs || 1500);
    if (!egRes.blocked) {
      return aosFailProbe(egressMode, 'egress-blacklist', `沙箱主动探针失败：未授权黑名单域名请求 (${blockedTarget}) 未被拦截 (status=${egRes.statusCode})`, { statusCode: egRes.statusCode });
    }
  }
  return { ok: true, exitCode: 0, code: null, reasonCode: null, egressMode };
}
