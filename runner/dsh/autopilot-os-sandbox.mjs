// 过夜挂机可选 OS 级沙箱包装器（srt 探针、scope 锁定策略、Windows Alpha 软降级与 --strict-sandbox 硬阻断，<= 170 行）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hagSanitizeSubagentEnv } from './host-auth-guard.mjs';
import { findExecutableInDirs, getSharedWorkflowDepsPaths } from './workflow-deps.mjs';
import { normalizeSlashes } from './win-paths.mjs';

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

export function wrapCommandWithOsSandbox(projectRoot, command, opts = {}) {
  const root = resolve(projectRoot);
  const policy = opts.policy || aosBuildSandboxPolicy(root, opts);
  const sanitizedEnv = hagSanitizeSubagentEnv(opts.env || process.env);
  const probe = aosProbeOsSandbox(root, opts);
  const strict = opts.strict === true;

  if (probe.readyForDefaultUse) {
    const policyDir = join(root, '.donegate', 'sandbox');
    mkdirSync(policyDir, { recursive: true });
    const policyPath = join(policyDir, `srt-policy-${String(opts.runId || 'latest').replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
    writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n', 'utf8');
    return {
      ok: true,
      exitCode: 0,
      mode: 'os-sandbox-srt',
      degraded: false,
      binPath: probe.binPath,
      policyPath,
      policy,
      command: `${JSON.stringify(probe.binPath)} --settings ${JSON.stringify(policyPath)} -- ${command}`,
      env: sanitizedEnv,
      warning: null
    };
  }

  const reason = probe.isWinAlpha
    ? 'Windows 平台下 anthropics/sandbox-runtime (srt) 仍处于官方 Alpha（需管理员一次配置 WFP），默认降级为 Git Worktree + 写范围门禁 + 环境变量清洗'
    : '未在共享池或 PATH 检测到 OS 级沙箱可执行文件 srt，已降级为 Git Worktree + 写范围门禁 + 环境变量清洗';

  if (strict) {
    return {
      ok: false,
      exitCode: 3,
      code: 'OS_SANDBOX_REQUIRED',
      mode: 'blocked-strict',
      degraded: false,
      policy,
      env: sanitizedEnv,
      reason: `已启用 --strict-sandbox 强沙箱模式，但无法激活 OS 级沙箱：${reason}`
    };
  }

  return {
    ok: true,
    exitCode: 0,
    mode: 'worktree-soft-degrade',
    degraded: true,
    policy,
    command,
    env: sanitizedEnv,
    warning: `⚠ ${reason}`
  };
}
