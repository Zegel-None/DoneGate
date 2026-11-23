// Windows 11 共享底座池安装器（纯 ASCII 启动器守卫、.gradle-home 沙盒目录、双层 manifest 原子落盘与免 401 状态戳）
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { cleanSubprocessGitEnv, downloadWithRangeResume, extractArchiveToDir, provisionCleanRepoSnapshot } from './shared-pool-net.mjs';
import { buildWinCmdSpawn, normalizeLf, normalizeSlashes, toCrlf } from './win-paths.mjs';

const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const sanitizePoolId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';

export function writeJsonAtomic(filePath, data) {
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, abs);
  } catch {
    if (existsSync(abs)) rmSync(abs, { force: true });
    renameSync(tmp, abs);
  }
  return abs;
}

export function isWritableDir(dirPath) {
  if (!dirPath) return false;
  try {
    const abs = resolve(dirPath);
    mkdirSync(abs, { recursive: true });
    const probe = join(abs, `.dg-probe-${process.pid}-${Date.now()}`);
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function ensureSharedPoolSkeleton(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const sharedDir = join(root, 'workflows', '.deps', '_shared');
  const binDir = join(sharedDir, '.bin'), distsDir = join(sharedDir, 'dists');
  const reposDir = join(sharedDir, 'repos'), npmDir = join(sharedDir, 'npm');
  const gradleHomeDir = join(sharedDir, '.gradle-home');
  for (const d of [binDir, distsDir, reposDir, npmDir]) mkdirSync(d, { recursive: true });
  const needGradle = Boolean(opts.includeGradleHome || String(opts.toolId || '').toLowerCase() === 'gradle' || String(opts.binName || '').toLowerCase() === 'gradle');
  if (needGradle) mkdirSync(gradleHomeDir, { recursive: true });
  for (const extra of (Array.isArray(opts.extraSandboxDirs) ? opts.extraSandboxDirs : [])) {
    if (SAFE_TOKEN_RE.test(String(extra))) mkdirSync(join(sharedDir, String(extra)), { recursive: true });
  }
  return {
    root, sharedRelDir: 'workflows/.deps/_shared', sharedDir, binDir, distsDir, reposDir, npmDir,
    gradleHomeDir, manifestPath: join(sharedDir, 'manifest.json'), refreshStampPath: join(sharedDir, '.refresh-stamp.json')
  };
}

export function resolvePoolGradleUserHome(projectRoot, baseEnv = process.env) {
  const extHome = String(baseEnv?.GRADLE_USER_HOME || '').trim();
  if (extHome && isWritableDir(extHome)) return extHome;
  return ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: true }).gradleHomeDir;
}

export function assertPureAsciiBatch(content, label = 'batch-launcher') {
  const txt = String(content ?? '');
  if (!/^[\x00-\x7F]*$/.test(txt)) throw new Error(`[${label}] NON_ASCII_BATCH_CONTENT: Windows .bat/.cmd must contain 100% pure ASCII characters`);
  if (/(^|[^\r])\n/.test(txt)) throw new Error(`[${label}] NON_CRLF_BATCH_CONTENT: Windows .bat/.cmd must use CRLF (\\r\\n) line endings`);
  return txt;
}

function sanitizeAsciiNote(raw, fallback, strictAscii = false) {
  const s = String(raw ?? '').trim();
  if (strictAscii && !/^[\x00-\x7F]*$/.test(s)) throw new Error(`Batch comment/identifier contains non-ASCII characters: ${s}`);
  return s.replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

export function buildSharedPoolLauncherScripts(spec = {}) {
  const binName = String(spec.binName || spec.id || '').trim();
  const distSubdir = String(spec.distSubdir || '').trim();
  if (!SAFE_TOKEN_RE.test(binName)) throw new Error(`Invalid non-ASCII or unsafe binName: ${binName}`);
  if (!SAFE_TOKEN_RE.test(distSubdir)) throw new Error(`Invalid non-ASCII or unsafe distSubdir: ${distSubdir}`);

  const posixEntry = normalizeSlashes(spec.posixEntryRel || `bin/${binName}`).replace(/^\/+/, '');
  const winEntry = String(spec.winEntryRel || (binName.toLowerCase() === 'gradle' ? `bin\\${binName}.bat` : `bin\\${binName}.exe`)).replace(/\//g, '\\').replace(/^\\+/, '');
  if (!/^[\x20-\x7E]+$/.test(posixEntry) || !/^[\x20-\x7E]+$/.test(winEntry)) throw new Error('Launcher relative target path must be pure ASCII');
  const note = sanitizeAsciiNote(spec.comment, `DoneGate shared-pool launcher for ${binName}`, spec.strictAsciiInput === true);
  const isGradle = Boolean(spec.useGradleHome || binName.toLowerCase() === 'gradle' || String(spec.toolId || '').toLowerCase() === 'gradle');
  const isWinBatchTarget = /\.(?:bat|cmd)$/i.test(winEntry);

  const shLines = [
    '#!/bin/sh', `# ${note}`,
    'DG_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `DG_DIST_DIR="$(CDPATH= cd -- "$DG_BIN_DIR/../dists/${distSubdir}" && pwd)"`
  ];
  if (isGradle) {
    shLines.push(
      'GRADLE_HOME="$DG_DIST_DIR"', 'export GRADLE_HOME',
      'DG_POOL_GRADLE_HOME="$DG_BIN_DIR/../.gradle-home"',
      'mkdir -p "$DG_POOL_GRADLE_HOME" 2>/dev/null || true',
      'if [ -z "${GRADLE_USER_HOME:-}" ] || ! mkdir -p "$GRADLE_USER_HOME" 2>/dev/null || [ ! -w "$GRADLE_USER_HOME" ]; then',
      '  GRADLE_USER_HOME="$(CDPATH= cd -- "$DG_POOL_GRADLE_HOME" && pwd)"',
      'fi', 'export GRADLE_USER_HOME'
    );
  }
  shLines.push(`exec "$DG_DIST_DIR/${posixEntry}" "$@"`, '');

  const batLines = [
    '@echo off', 'setlocal', `rem ${note}`,
    'set "DG_BIN_DIR=%~dp0"',
    `for %%I in ("%DG_BIN_DIR%..\\dists\\${distSubdir}") do set "DG_DIST_DIR=%%~fI"`
  ];
  if (isGradle) {
    batLines.push(
      'set "GRADLE_HOME=%DG_DIST_DIR%"',
      'for %%I in ("%DG_BIN_DIR%..\\.gradle-home") do set "DG_POOL_GRADLE_HOME=%%~fI"',
      'if not exist "%DG_POOL_GRADLE_HOME%" mkdir "%DG_POOL_GRADLE_HOME%" >nul 2>nul',
      'if not defined GRADLE_USER_HOME (',
      '  set "GRADLE_USER_HOME=%DG_POOL_GRADLE_HOME%"',
      ') else (',
      '  mkdir "%GRADLE_USER_HOME%" >nul 2>nul',
      '  copy /y nul "%GRADLE_USER_HOME%\\.dg-probe" >nul 2>nul',
      '  if errorlevel 1 ( set "GRADLE_USER_HOME=%DG_POOL_GRADLE_HOME%" ) else ( del /q "%GRADLE_USER_HOME%\\.dg-probe" >nul 2>nul )',
      ')'
    );
  }
  batLines.push(isWinBatchTarget ? `call "%DG_DIST_DIR%\\${winEntry}" %*` : `"%DG_DIST_DIR%\\${winEntry}" %*`, 'exit /b %ERRORLEVEL%', '');

  const shContent = normalizeLf(shLines.join('\n'));
  const batContent = assertPureAsciiBatch(toCrlf(batLines.join('\n')), `${binName}.bat`);
  const cmdContent = assertPureAsciiBatch(toCrlf(batLines.join('\n')), `${binName}.cmd`);
  return { shContent, batContent, cmdContent, isGradle };
}

function detectDistEntries(distsDir, distSubdir, binName) {
  const base = join(distsDir, distSubdir);
  const posixCand = [`bin/${binName}`, binName].find((rel) => existsSync(join(base, rel)));
  const winCand = [`bin/${binName}.bat`, `bin/${binName}.cmd`, `bin/${binName}.exe`, `${binName}.exe`, `${binName}.bat`].find((rel) => existsSync(join(base, rel)));
  return {
    posixEntryRel: posixCand || `bin/${binName}`,
    winEntryRel: (winCand || (binName.toLowerCase() === 'gradle' ? `bin/${binName}.bat` : `bin/${binName}.exe`)).replace(/\//g, '\\')
  };
}

export function writeSharedPoolLaunchers(projectRoot, spec = {}) {
  const binName = String(spec.binName || spec.id || '').trim();
  const isGradle = Boolean(spec.useGradleHome || binName.toLowerCase() === 'gradle' || String(spec.toolId || '').toLowerCase() === 'gradle');
  const skel = ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: isGradle });
  const detected = detectDistEntries(skel.distsDir, spec.distSubdir, binName);
  const built = buildSharedPoolLauncherScripts({ ...spec, binName, posixEntryRel: spec.posixEntryRel || detected.posixEntryRel, winEntryRel: spec.winEntryRel || detected.winEntryRel });
  const posixPath = join(skel.binDir, binName), batPath = join(skel.binDir, `${binName}.bat`), cmdPath = join(skel.binDir, `${binName}.cmd`);
  writeFileSync(posixPath, built.shContent, 'utf8');
  try { chmodSync(posixPath, 0o755); } catch (err) { void err; }
  writeFileSync(batPath, built.batContent, 'ascii');
  writeFileSync(cmdPath, built.cmdContent, 'ascii');
  return { ok: true, binName, posixPath, batPath, cmdPath, relBin: `workflows/.deps/_shared/.bin/${binName}`, gradleHomeDir: isGradle ? skel.gradleHomeDir : null };
}

export function readSharedRefreshStamp(projectRoot) {
  const stampPath = join(resolve(projectRoot), 'workflows', '.deps', '_shared', '.refresh-stamp.json');
  if (!existsSync(stampPath)) return { exists: false, seq: 0, refreshedAt: null, readyIds: [] };
  const r = readJsonStrict(stampPath);
  return (r.ok && r.value) ? { exists: true, ...r.value } : { exists: false, seq: 0, refreshedAt: null, readyIds: [] };
}

export function refreshWorkflowDepsStamp(projectRoot, meta = {}) {
  const skel = ensureSharedPoolSkeleton(projectRoot);
  const prev = readSharedRefreshStamp(projectRoot);
  const sharedRes = existsSync(skel.manifestPath) ? readJsonStrict(skel.manifestPath) : { ok: false };
  const installed = (sharedRes.ok && sharedRes.value && sharedRes.value.installed) || {};
  const readyIds = Object.entries(installed).filter(([, v]) => v && v.ready === true).map(([k]) => k).sort();
  const stamp = {
    schema: 'donegate-deps-refresh/v1', seq: Number(prev.seq || 0) + 1, refreshedAt: new Date().toISOString(),
    trigger: String(meta.trigger || 'local-refresh'), workflowId: meta.workflowId ? String(meta.workflowId) : null,
    depId: meta.depId ? String(meta.depId) : null, readyIds
  };
  writeJsonAtomic(skel.refreshStampPath, stamp);
  return stamp;
}

export function recordSharedPoolDepReady(projectRoot, spec = {}) {
  const depId = String(spec.id || spec.binName || '').trim();
  if (!depId) throw new Error('recordSharedPoolDepReady requires dep id');
  const skel = ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: Boolean(spec.useGradleHome || depId.toLowerCase() === 'gradle') });
  const now = new Date().toISOString();
  const prevShared = existsSync(skel.manifestPath) ? (readJsonStrict(skel.manifestPath).value || {}) : {};
  const rawVer = String(spec.version || '').trim(), cleanVer = rawVer.replace(/^v/i, '');
  const relBin = normalizeSlashes(spec.bin || `workflows/.deps/_shared/.bin/${spec.binName || depId}`);
  const sharedEntry = {
    id: depId, ready: true, version: cleanVer || rawVer,
    tag: String(spec.tag || (cleanVer ? `v${cleanVer}` : '')).trim(),
    commit: String(spec.commit || '').trim(),
    repo: normalizeSlashes(spec.repo || `workflows/.deps/_shared/repos/${depId}`),
    bin: relBin,
    ...(spec.distSubdir ? { dist: `workflows/.deps/_shared/dists/${spec.distSubdir}` } : {}),
    verified: { command: String(spec.verified?.command || spec.verifyCommand || `${relBin} --version`), output: String(spec.verified?.output || spec.verifyOutput || 'pass').slice(0, 2000), status: 'pass' },
    updatedAt: now
  };
  writeJsonAtomic(skel.manifestPath, { packId: '_shared', updatedAt: now, installed: { ...(prevShared.installed || {}), [depId]: sharedEntry } });

  let workflowManifestPath = null, workflowEntry = null;
  const wfId = String(spec.workflowId || spec.packId || '').trim();
  if (wfId && wfId !== '_shared') {
    const safeWf = sanitizePoolId(wfId);
    workflowManifestPath = join(skel.root, 'workflows', '.deps', safeWf, 'manifest.json');
    const prevWf = existsSync(workflowManifestPath) ? (readJsonStrict(workflowManifestPath).value || {}) : {};
    workflowEntry = { id: depId, ready: true, sharedPool: true, sharedManifest: '../_shared/manifest.json', version: sharedEntry.version, tag: sharedEntry.tag, commit: sharedEntry.commit, bin: relBin, updatedAt: now };
    writeJsonAtomic(workflowManifestPath, { packId: safeWf, updatedAt: now, installed: { ...(prevWf.installed || {}), [depId]: workflowEntry } });
  }
  const refreshStamp = refreshWorkflowDepsStamp(projectRoot, { trigger: spec.trigger || 'mark-ready', workflowId: wfId || null, depId });
  return { ok: true, depId, sharedManifestPath: skel.manifestPath, workflowManifestPath, sharedEntry, workflowEntry, refreshStamp };
}

export function verifySharedPoolLauncher(projectRoot, spec = {}) {
  const root = resolve(projectRoot), platform = spec.platform || process.platform;
  const binName = String(spec.binName || spec.id || '').trim();
  const skel = ensureSharedPoolSkeleton(root, { binName });
  const targetBin = platform === 'win32' ? join(skel.binDir, `${binName}.bat`) : join(skel.binDir, binName);
  const args = Array.isArray(spec.verifyArgs) && spec.verifyArgs.length > 0 ? spec.verifyArgs : ['--version'];
  const env = cleanSubprocessGitEnv({ ...(spec.env || process.env) });
  if (binName.toLowerCase() === 'gradle' || spec.useGradleHome === true) env.GRADLE_USER_HOME = resolvePoolGradleUserHome(root, env);
  const r = platform === 'win32'
    ? (() => { const sp = buildWinCmdSpawn(targetBin, args); return spawnSync(sp.cmd, sp.args, { cwd: root, env, encoding: 'utf8', timeout: 120000, ...sp.extraOpts }); })()
    : spawnSync(targetBin, args, { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const relCmd = `${platform === 'win32' ? `workflows/.deps/_shared/.bin/${binName}.bat` : `workflows/.deps/_shared/.bin/${binName}`} ${args.join(' ')}`;
  return { ok: r.status === 0, exitCode: typeof r.status === 'number' ? r.status : 2, command: relCmd, output: normalizeLf(`${r.stdout || ''}\n${r.stderr || ''}`).trim() };
}

export async function installSharedPoolBinaryDep(projectRoot, spec = {}) {
  const root = resolve(projectRoot), depId = String(spec.id || spec.binName || '').trim(), binName = String(spec.binName || depId).trim();
  const skel = ensureSharedPoolSkeleton(root, { toolId: depId, binName });
  let downloadResult = null;
  if (spec.archiveUrl) {
    const archiveDest = join(skel.distsDir, spec.archiveFileName || `${depId}-${String(spec.version || 'latest').replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`);
    downloadResult = await downloadWithRangeResume(spec.archiveUrl, archiveDest, spec.downloadOpts || {});
    extractArchiveToDir(archiveDest, spec.extractToSubdir ? join(skel.distsDir, spec.distSubdir) : skel.distsDir, { stripComponents: spec.stripComponents ?? 0, extractFn: spec.extractFn });
  }
  let repoResult = null;
  if (spec.tarballUrl || spec.cloneRepoSnapshot) {
    repoResult = await provisionCleanRepoSnapshot({ id: depId, repo: spec.repoSlug, ref: spec.tag || spec.version, tarballUrl: spec.tarballUrl, repoDir: join(skel.reposDir, sanitizePoolId(depId)), archivePath: join(skel.distsDir, `${depId}-src.tar.gz`), ...(spec.repoOpts || {}) });
  }
  const launchers = writeSharedPoolLaunchers(root, { ...spec, id: depId, binName });
  const verification = spec.skipVerify === true ? { ok: true, exitCode: 0, command: `${launchers.relBin} --version`, output: 'skip-verify' } : verifySharedPoolLauncher(root, { ...spec, id: depId, binName });
  if (!verification.ok) return { ok: false, stage: 'verify', launchers, verification, download: downloadResult, repo: repoResult };
  const recorded = recordSharedPoolDepReady(root, { ...spec, id: depId, binName, bin: launchers.relBin, verified: { command: verification.command, output: verification.output, status: 'pass' } });
  return { ok: true, ...recorded, launchers, verification, download: downloadResult, repo: repoResult };
}
