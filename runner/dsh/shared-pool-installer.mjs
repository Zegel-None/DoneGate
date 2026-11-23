// Windows 11 共享底座池安装器（纯 ASCII 启动器守卫、.gradle-home 沙盒、版本核验与双层状态戳）
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { writeStandaloneDepsCli } from './dg-deps-cli-gen.mjs';
import { cleanSubprocessGitEnv, downloadWithRangeResume, extractArchiveToDir, provisionCleanRepoSnapshot } from './shared-pool-net.mjs';
import { parseFlexibleDepsManifest, scanSharedPoolDiskInventory, verifyInstalledNpmPackage } from './shared-pool-probe.mjs';
import { buildWinCmdSpawn, normalizeLf, normalizeSlashes, toCrlf } from './win-paths.mjs';

export { parseFlexibleDepsManifest, scanSharedPoolDiskInventory, verifyInstalledNpmPackage, writeStandaloneDepsCli };

const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const sanitizePoolId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
const normDepVer = (v) => String(v ?? '').trim().replace(/^v/i, '');

export function writeJsonAtomic(filePath, data) {
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, abs);
  } catch (err) {
    void err;
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
  } catch (err) {
    void err;
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
  const cliInfo = opts.skipCliScript === true
    ? { cliPath: join(sharedDir, 'dg-deps-cli.mjs'), cliRelPath: 'workflows/.deps/_shared/dg-deps-cli.mjs' }
    : writeStandaloneDepsCli(root);
  return {
    root, sharedRelDir: 'workflows/.deps/_shared', sharedDir, binDir, distsDir, reposDir, npmDir,
    gradleHomeDir, manifestPath: join(sharedDir, 'manifest.json'),
    refreshStampPath: join(sharedDir, '.refresh-stamp.json'),
    rootRefreshStampPath: join(root, 'workflows', '.deps', '.refresh-stamp.json'),
    ...cliInfo
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
  if (!SAFE_TOKEN_RE.test(binName)) throw new Error(`Invalid non-ASCII or unsafe binName: ${binName}`);
  const note = sanitizeAsciiNote(spec.comment, `DoneGate shared-pool launcher for ${binName}`, spec.strictAsciiInput === true);
  const isGradle = Boolean(spec.useGradleHome || binName.toLowerCase() === 'gradle' || String(spec.toolId || '').toLowerCase() === 'gradle');
  const useNpmBin = Boolean(spec.npmBin === true || spec.kind === 'npm-cli');

  let shLines, batLines;
  if (useNpmBin) {
    const winTarget = spec.preferNpmExe ? `${binName}.exe` : `${binName}.cmd`;
    shLines = [
      '#!/bin/sh', `# ${note}`,
      'DG_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      `exec "$DG_BIN_DIR/../npm/node_modules/.bin/${binName}" "$@"`, ''
    ];
    batLines = [
      '@echo off', 'setlocal', `rem ${note}`,
      'set "DG_BIN_DIR=%~dp0"',
      'for %%I in ("%DG_BIN_DIR%..\\npm\\node_modules\\.bin") do set "DG_NPM_BIN=%%~fI"',
      spec.preferNpmExe ? `"%DG_NPM_BIN%\\${winTarget}" %*` : `call "%DG_NPM_BIN%\\${winTarget}" %*`,
      'exit /b %ERRORLEVEL%', ''
    ];
  } else {
    const distSubdir = String(spec.distSubdir || '').trim();
    if (!SAFE_TOKEN_RE.test(distSubdir)) throw new Error(`Invalid non-ASCII or unsafe distSubdir: ${distSubdir}`);
    const posixEntry = normalizeSlashes(spec.posixEntryRel || `bin/${binName}`).replace(/^\/+/, '');
    const winEntry = String(spec.winEntryRel || (binName.toLowerCase() === 'gradle' ? `bin\\${binName}.bat` : `bin\\${binName}.exe`)).replace(/\//g, '\\').replace(/^\\+/, '');
    if (!/^[\x20-\x7E]+$/.test(posixEntry) || !/^[\x20-\x7E]+$/.test(winEntry)) throw new Error('Launcher relative target path must be pure ASCII');
    const isWinBatchTarget = /\.(?:bat|cmd)$/i.test(winEntry);

    shLines = [
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

    batLines = [
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
  }

  const shContent = normalizeLf(shLines.join('\n'));
  const batContent = assertPureAsciiBatch(toCrlf(batLines.join('\n')), `${binName}.bat`);
  const cmdContent = assertPureAsciiBatch(toCrlf(batLines.join('\n')), `${binName}.cmd`);
  return { shContent, batContent, cmdContent, isGradle, useNpmBin };
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
  const npmBinDir = join(skel.npmDir, 'node_modules', '.bin');
  const autoNpm = !spec.distSubdir && (existsSync(join(npmBinDir, binName)) || existsSync(join(npmBinDir, `${binName}.cmd`)) || existsSync(join(npmBinDir, `${binName}.exe`)));
  const useNpmBin = Boolean(spec.npmBin === true || spec.kind === 'npm-cli' || autoNpm);
  const preferNpmExe = useNpmBin && existsSync(join(npmBinDir, `${binName}.exe`));
  const detected = useNpmBin ? { posixEntryRel: null, winEntryRel: null } : detectDistEntries(skel.distsDir, spec.distSubdir || '', binName);
  const built = buildSharedPoolLauncherScripts({
    ...spec, binName, npmBin: useNpmBin, preferNpmExe,
    posixEntryRel: spec.posixEntryRel || detected.posixEntryRel,
    winEntryRel: spec.winEntryRel || detected.winEntryRel
  });
  const posixPath = join(skel.binDir, binName), batPath = join(skel.binDir, `${binName}.bat`), cmdPath = join(skel.binDir, `${binName}.cmd`);
  writeFileSync(posixPath, built.shContent, 'utf8');
  try { chmodSync(posixPath, 0o755); } catch (err) { void err; }
  writeFileSync(batPath, built.batContent, 'ascii');
  writeFileSync(cmdPath, built.cmdContent, 'ascii');
  return { ok: true, binName, mode: useNpmBin ? 'npm-cli' : 'archive-bin', posixPath, batPath, cmdPath, relBin: `workflows/.deps/_shared/.bin/${binName}`, gradleHomeDir: isGradle ? skel.gradleHomeDir : null };
}

export function readSharedRefreshStamp(projectRoot) {
  const root = resolve(projectRoot);
  const pShared = join(root, 'workflows', '.deps', '_shared', '.refresh-stamp.json');
  const pDeps = join(root, 'workflows', '.deps', '.refresh-stamp.json');
  const r1 = existsSync(pShared) ? readJsonStrict(pShared) : { ok: false };
  const r2 = existsSync(pDeps) ? readJsonStrict(pDeps) : { ok: false };
  const s1 = r1.ok && r1.value && typeof r1.value === 'object' ? r1.value : null;
  const s2 = r2.ok && r2.value && typeof r2.value === 'object' ? r2.value : null;
  if (!s1 && !s2) return { exists: false, seq: 0, refreshedAt: null, readyIds: [] };
  const primary = (!s1 ? s2 : (!s2 ? s1 : (Number(s2.seq || 0) > Number(s1.seq || 0) ? s2 : s1)));
  const readyIds = [...new Set([...(Array.isArray(s1?.readyIds) ? s1.readyIds : []), ...(Array.isArray(s2?.readyIds) ? s2.readyIds : [])])].sort();
  return { exists: true, ...primary, seq: Math.max(Number(s1?.seq || 0), Number(s2?.seq || 0)), readyIds };
}

export function refreshWorkflowDepsStamp(projectRoot, meta = {}) {
  const skel = ensureSharedPoolSkeleton(projectRoot);
  const prev = readSharedRefreshStamp(projectRoot);
  const sharedRes = existsSync(skel.manifestPath) ? readJsonStrict(skel.manifestPath) : { ok: false };
  const parsed = sharedRes.ok && sharedRes.value ? parseFlexibleDepsManifest(sharedRes.value) : { entriesById: {}, lookup: () => null };
  const disk = scanSharedPoolDiskInventory(projectRoot, meta.platform || process.platform);
  const readySet = new Set(Object.values(parsed.entriesById).filter((v) => v && v.ready === true).map((v) => v.id));
  for (const t of disk.tools) {
    const known = parsed.lookup([t.id]);
    if (!known || (!known.versionMismatch && known.status !== 'pending')) readySet.add(t.id);
  }
  const stamp = {
    schema: 'donegate-deps-refresh/v1', seq: Number(prev.seq || 0) + 1, refreshedAt: new Date().toISOString(),
    trigger: String(meta.trigger || 'local-refresh'), workflowId: meta.workflowId ? String(meta.workflowId) : null,
    depId: meta.depId ? String(meta.depId) : null, readyIds: [...readySet].sort()
  };
  writeJsonAtomic(skel.refreshStampPath, stamp);
  writeJsonAtomic(skel.rootRefreshStampPath, stamp);
  return stamp;
}

export function reconcileSharedPoolOnRefresh(projectRoot, workflowId = null, opts = {}) {
  const root = resolve(projectRoot), sharedDir = join(root, 'workflows', '.deps', '_shared');
  const sharedManifestPath = join(sharedDir, 'manifest.json');
  const disk = scanSharedPoolDiskInventory(root, opts.platform || process.platform);
  const hasSharedManifest = existsSync(sharedManifestPath), hasSharedNpm = existsSync(join(sharedDir, 'npm', 'node_modules'));
  if (!disk.exists && !hasSharedManifest && !hasSharedNpm) return { updated: false, refreshStamp: readSharedRefreshStamp(root), entries: {} };
  const skel = ensureSharedPoolSkeleton(root), now = new Date().toISOString();
  const prevDoc = hasSharedManifest ? (readJsonStrict(sharedManifestPath).value || {}) : {};
  const parsed = parseFlexibleDepsManifest(prevDoc), nextInstalled = {};

  for (const [id, rec] of Object.entries(parsed.entriesById)) {
    const wantVer = normDepVer(rec.version), isNpmLib = rec.kind === 'npm-lib' || (Boolean(rec.pkg) && !rec.bin);
    const npmHit = isNpmLib ? verifyInstalledNpmPackage(root, rec.pkg || id, workflowId) : null;
    const hasDet = rec.detectedVersion !== undefined && String(rec.detectedVersion).trim() !== '';
    const detVer = hasDet ? normDepVer(rec.detectedVersion) : (npmHit?.ok ? npmHit.version : '');
    const diskHit = isNpmLib ? null : disk.lookup([id, rec.bin, rec.repo]);
    const verMismatch = rec.versionMismatch || Boolean(wantVer && hasDet && (!detVer || wantVer !== detVer)) || Boolean(wantVer && !hasDet && diskHit?.version && normDepVer(diskHit.version) !== wantVer);
    const binCheckRel = normalizeSlashes(rec.bin || `workflows/.deps/_shared/.bin/${id}`);
    const onDisk = isNpmLib ? Boolean(npmHit?.ok) : (Boolean(diskHit) || existsSync(resolve(root, binCheckRel)) || existsSync(resolve(root, `${binCheckRel}.bat`)) || existsSync(resolve(root, `${binCheckRel}.cmd`)) || (rec.repo ? existsSync(resolve(root, rec.repo)) : false));
    let ready = rec.ready, status = rec.status || (ready ? 'ready' : 'pending');
    if (verMismatch) { ready = false; status = 'version-mismatch'; }
    else if (!onDisk && rec.ready) { ready = false; status = 'missing-on-disk'; }
    else if (onDisk && rec.status !== 'pending') { ready = true; status = 'ready'; }
    nextInstalled[id] = { ...rec, id, ready, status, version: wantVer || normDepVer(npmHit?.version || diskHit?.version || ''), detectedVersion: detVer || normDepVer(npmHit?.version || diskHit?.version || wantVer), ...(isNpmLib ? {} : { bin: rec.bin || diskHit?.canonicalRelBin || binCheckRel }), updatedAt: now };
  }
  for (const t of disk.tools) {
    if (!parsed.lookup([t.id])) nextInstalled[t.id] = { id: t.id, ready: true, status: 'ready', version: t.version || '', detectedVersion: t.version || '', bin: t.canonicalRelBin, ...(t.relDist ? { dist: t.relDist } : {}), ...(t.relRepo ? { repo: t.relRepo } : {}), source: 'disk-reconciled', updatedAt: now };
  }
  writeJsonAtomic(skel.manifestPath, { packId: '_shared', ...(parsed.topLabel ? { label: parsed.topLabel } : {}), updatedAt: now, installed: nextInstalled });
  return { updated: true, refreshStamp: refreshWorkflowDepsStamp(root, { trigger: opts.trigger || 'reconcile-refresh', workflowId, platform: opts.platform }), entries: nextInstalled };
}

function resolveDetectedVersionForRecord(spec, cleanVer, npmCheck) {
  if (spec.detectedVersion !== undefined && spec.detectedVersion !== null && String(spec.detectedVersion).trim() !== '') return { hasExplicit: true, value: normDepVer(spec.detectedVersion) };
  if (npmCheck?.ok && npmCheck.version) return { hasExplicit: true, value: normDepVer(npmCheck.version) };
  const rawOut = String(spec.verified?.output || spec.verifyOutput || '').trim();
  if (rawOut && rawOut !== 'pass' && rawOut !== 'skip-verify') {
    const m = rawOut.match(/v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/);
    if (m) return { hasExplicit: true, value: normDepVer(m[1]) };
  }
  return { hasExplicit: false, value: cleanVer };
}

export function recordSharedPoolDepReady(projectRoot, spec = {}) {
  const depId = String(spec.id || spec.binName || '').trim();
  if (!depId) throw new Error('recordSharedPoolDepReady requires dep id');
  const skel = ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: Boolean(spec.useGradleHome || depId.toLowerCase() === 'gradle') });
  const now = new Date().toISOString(), wfId = String(spec.workflowId || spec.packId || '').trim();
  const prevParsed = parseFlexibleDepsManifest(existsSync(skel.manifestPath) ? (readJsonStrict(skel.manifestPath).value || {}) : {});
  const kind = String(spec.kind || (spec.pkg && !spec.bin ? 'npm-lib' : 'archive-bin')).trim(), pkgName = String(spec.pkg || '').trim(), isNpmLib = kind === 'npm-lib';
  const npmCheck = (isNpmLib || pkgName) ? verifyInstalledNpmPackage(projectRoot, pkgName || depId, wfId) : { ok: false };
  const rawVer = String(spec.version || '').trim(), cleanVer = normDepVer(rawVer), det = resolveDetectedVersionForRecord(spec, cleanVer, npmCheck);
  const verOk = !cleanVer || (Boolean(det.value) && cleanVer === det.value), npmLibMissing = isNpmLib && pkgName && !det.hasExplicit && !npmCheck.ok;
  const ready = (spec.pending === true || spec.ready === false || npmLibMissing) ? false : verOk;
  const status = ready ? 'ready' : (!verOk ? 'version-mismatch' : (npmLibMissing ? 'missing-on-disk' : 'pending'));
  const note = !verOk ? `version mismatch: detected ${det.value || 'none'}, expected ${cleanVer}` : String(spec.note || '').trim();
  const itemLabel = String(spec.label || '').trim(), relBin = isNpmLib ? '' : normalizeSlashes(spec.bin || `workflows/.deps/_shared/.bin/${spec.binName || depId}`);
  const sharedEntry = {
    id: depId, ...(itemLabel ? { label: itemLabel } : {}), kind, ...(pkgName ? { pkg: pkgName } : {}), ready, status,
    version: cleanVer || det.value || rawVer, detectedVersion: det.value || '', tag: String(spec.tag || (cleanVer ? `v${cleanVer}` : '')).trim(), commit: String(spec.commit || '').trim(),
    ...(spec.repo || !isNpmLib ? { repo: normalizeSlashes(spec.repo || (isNpmLib ? '' : `workflows/.deps/_shared/repos/${depId}`)) } : {}),
    ...(relBin ? { bin: relBin } : {}), ...(npmCheck.ok ? { entry: npmCheck.relEntry, packageJson: npmCheck.relPkgJson } : {}),
    ...(spec.distSubdir ? { dist: `workflows/.deps/_shared/dists/${spec.distSubdir}` } : {}), ...(note ? { note } : {}),
    verified: { command: String(spec.verified?.command || spec.verifyCommand || (isNpmLib ? `npm-pkg:${pkgName || depId}` : `${relBin} --version`)), output: String(spec.verified?.output || spec.verifyOutput || (ready ? 'pass' : status)).slice(0, 2000), status: ready ? 'pass' : status },
    updatedAt: now
  };
  writeJsonAtomic(skel.manifestPath, { packId: '_shared', ...(prevParsed.topLabel ? { label: prevParsed.topLabel } : {}), updatedAt: now, installed: { ...prevParsed.entriesById, [depId]: sharedEntry } });

  let workflowManifestPath = null, workflowEntry = null;
  if (wfId && wfId !== '_shared') {
    const safeWf = sanitizePoolId(wfId); workflowManifestPath = join(skel.root, 'workflows', '.deps', safeWf, 'manifest.json');
    const prevWfDoc = existsSync(workflowManifestPath) ? (readJsonStrict(workflowManifestPath).value || {}) : {}, prevWfParsed = parseFlexibleDepsManifest(prevWfDoc);
    const topWfLabel = String(spec.workflowLabel || prevWfParsed.topLabel || prevWfDoc.packName || '').trim();
    workflowEntry = { id: depId, ...(itemLabel ? { label: itemLabel } : {}), kind, ...(pkgName ? { pkg: pkgName } : {}), ready, status, sharedPool: true, sharedManifest: '../_shared/manifest.json', version: sharedEntry.version, detectedVersion: sharedEntry.detectedVersion, tag: sharedEntry.tag, commit: sharedEntry.commit, ...(relBin ? { bin: relBin } : {}), ...(npmCheck.ok ? { entry: npmCheck.relEntry } : {}), ...(note ? { note } : {}), updatedAt: now };
    writeJsonAtomic(workflowManifestPath, { packId: safeWf, ...(topWfLabel ? { label: topWfLabel } : {}), updatedAt: now, installed: { ...prevWfParsed.entriesById, [depId]: workflowEntry } });
  }
  return { ok: ready, depId, status, sharedManifestPath: skel.manifestPath, workflowManifestPath, sharedEntry, workflowEntry, refreshStamp: refreshWorkflowDepsStamp(projectRoot, { trigger: spec.trigger || 'mark-ready', workflowId: wfId || null, depId }) };
}

export function verifySharedPoolLauncher(projectRoot, spec = {}) {
  const root = resolve(projectRoot), platform = spec.platform || process.platform, binName = String(spec.binName || spec.id || '').trim();
  const skel = ensureSharedPoolSkeleton(root, { binName }), targetBin = platform === 'win32' ? join(skel.binDir, `${binName}.bat`) : join(skel.binDir, binName);
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
  return { ...recorded, launchers, verification, download: downloadResult, repo: repoResult };
}
