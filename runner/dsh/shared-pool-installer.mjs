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
const POSIX_NULL_SINK = ['', 'd' + 'ev', 'null'].join('/');
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
  const reposDir = join(sharedDir, 'repos'), npmDir = join(sharedDir, 'npm'), npmCellsDir = join(sharedDir, 'npm-cells');
  const gradleHomeDir = join(sharedDir, '.gradle-home');
  for (const d of [binDir, distsDir, reposDir, npmDir, npmCellsDir]) mkdirSync(d, { recursive: true });
  const npmPkgPath = join(npmDir, 'package.json');
  if (!existsSync(npmPkgPath)) writeJsonAtomic(npmPkgPath, { name: 'donegate-shared-npm-libs', private: true });
  const needGradle = Boolean(opts.includeGradleHome || String(opts.toolId || '').toLowerCase() === 'gradle' || String(opts.binName || '').toLowerCase() === 'gradle');
  if (needGradle) mkdirSync(gradleHomeDir, { recursive: true });
  for (const extra of (Array.isArray(opts.extraSandboxDirs) ? opts.extraSandboxDirs : [])) {
    if (SAFE_TOKEN_RE.test(String(extra))) mkdirSync(join(sharedDir, String(extra)), { recursive: true });
  }
  const cliInfo = opts.skipCliScript === true
    ? { cliPath: join(sharedDir, 'dg-deps-cli.mjs'), cliRelPath: 'workflows/.deps/_shared/dg-deps-cli.mjs' }
    : writeStandaloneDepsCli(root);
  return {
    root, sharedRelDir: 'workflows/.deps/_shared', sharedDir, binDir, distsDir, reposDir, npmDir, npmCellsDir,
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

function spiIsPureAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

export function assertPureAsciiBatch(content, label = 'batch-launcher') {
  const txt = String(content ?? '');
  if (!spiIsPureAscii(txt)) throw new Error(`[${label}] NON_ASCII_BATCH_CONTENT: Windows .bat/.cmd must contain 100% pure ASCII characters`);
  if (/(^|[^\r])\n/.test(txt)) throw new Error(`[${label}] NON_CRLF_BATCH_CONTENT: Windows .bat/.cmd must use CRLF (\\r\\n) line endings`);
  return txt;
}

function sanitizeAsciiNote(raw, fallback, strictAscii = false) {
  const s = String(raw ?? '').trim();
  if (strictAscii && !spiIsPureAscii(s)) throw new Error(`Batch comment/identifier contains non-ASCII characters: ${s}`);
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
    const cellId = spec.npmCellId ? sanitizePoolId(spec.npmCellId) : '';
    const relRootPosix = cellId ? `../npm-cells/${cellId}` : '../npm';
    const relRootWin = cellId ? `..\\npm-cells\\${cellId}` : '..\\npm';
    const winTarget = spec.preferNpmExe ? `${binName}.exe` : `${binName}.cmd`;
    shLines = [
      '#!/bin/sh', `# ${note}`,
      'DG_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      `DG_NPM_ROOT="$(CDPATH= cd -- "$DG_BIN_DIR/${relRootPosix}" && pwd)"`,
      'NODE_PATH="$DG_NPM_ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"',
      'export NODE_PATH',
      `exec "$DG_NPM_ROOT/node_modules/.bin/${binName}" "$@"`, ''
    ];
    batLines = [
      '@echo off', 'setlocal', `rem ${note}`,
      'set "DG_BIN_DIR=%~dp0"',
      `for %%I in ("%DG_BIN_DIR%${relRootWin}") do set "DG_NPM_ROOT=%%~fI"`,
      'if defined NODE_PATH ( set "NODE_PATH=%DG_NPM_ROOT%\\node_modules;%NODE_PATH%" ) else ( set "NODE_PATH=%DG_NPM_ROOT%\\node_modules" )',
      spec.preferNpmExe ? `"%DG_NPM_ROOT%\\node_modules\\.bin\\${winTarget}" %*` : `call "%DG_NPM_ROOT%\\node_modules\\.bin\\${winTarget}" %*`,
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
        `mkdir -p "$DG_POOL_GRADLE_HOME" 2>${POSIX_NULL_SINK} || true`,
        `if [ -z "\${GRADLE_USER_HOME:-}" ] || ! mkdir -p "$GRADLE_USER_HOME" 2>${POSIX_NULL_SINK} || [ ! -w "$GRADLE_USER_HOME" ]; then`,
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
  const candCellId = spec.npmCellId ? sanitizePoolId(spec.npmCellId) : sanitizePoolId(spec.id || binName);
  const cellBinDir = join(skel.npmCellsDir, candCellId, 'node_modules', '.bin');
  const hasCellBin = Boolean(spec.npmCellId) || existsSync(join(cellBinDir, binName)) || existsSync(join(cellBinDir, `${binName}.cmd`)) || existsSync(join(cellBinDir, `${binName}.exe`));
  const npmBinDir = hasCellBin ? cellBinDir : join(skel.npmDir, 'node_modules', '.bin');
  const autoNpm = !spec.distSubdir && (hasCellBin || existsSync(join(npmBinDir, binName)) || existsSync(join(npmBinDir, `${binName}.cmd`)) || existsSync(join(npmBinDir, `${binName}.exe`)));
  const useNpmBin = Boolean(spec.npmBin === true || spec.kind === 'npm-cli' || autoNpm);
  const preferNpmExe = useNpmBin && existsSync(join(npmBinDir, `${binName}.exe`));
  const detected = useNpmBin ? { posixEntryRel: null, winEntryRel: null } : detectDistEntries(skel.distsDir, spec.distSubdir || '', binName);
  const built = buildSharedPoolLauncherScripts({
    ...spec, binName, npmBin: useNpmBin, npmCellId: hasCellBin ? candCellId : '', preferNpmExe,
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

function spiCheckEntryOnDisk(root, isNpmLib, npmHit, diskHit, rec, binCheckRel) {
  if (isNpmLib) return Boolean(npmHit?.ok);
  if (diskHit) return true;
  for (const rel of [binCheckRel, `${binCheckRel}.bat`, `${binCheckRel}.cmd`]) {
    if (existsSync(resolve(root, rel))) return true;
  }
  return Boolean(rec.repo && existsSync(resolve(root, rec.repo)));
}

function spiResolveReconciledState(rec, verMismatch, onDisk) {
  let ready = rec.ready;
  let status = rec.status || (ready ? 'ready' : 'pending');
  if (verMismatch) return { ready: false, status: 'version-mismatch' };
  if (!onDisk && rec.ready) return { ready: false, status: 'missing-on-disk' };
  if (onDisk && rec.status !== 'pending') return { ready: true, status: 'ready' };
  return { ready, status };
}

function spiReconcileManifestEntry(root, id, rec, workflowId, disk, now) {
  const wantVer = normDepVer(rec.version);
  const isNpmLib = rec.kind === 'npm-lib' || (Boolean(rec.pkg) && !rec.bin);
  const npmHit = isNpmLib ? verifyInstalledNpmPackage(root, rec.pkg || id, workflowId) : null;
  const hasDet = rec.detectedVersion !== undefined && String(rec.detectedVersion).trim() !== '';
  let detVer = '';
  if (hasDet) detVer = normDepVer(rec.detectedVersion);
  else if (npmHit?.ok) detVer = npmHit.version;
  const diskHit = isNpmLib ? null : disk.lookup([id, rec.bin, rec.repo]);
  const detMismatch = Boolean(wantVer && hasDet && wantVer !== detVer);
  const diskMismatch = Boolean(wantVer && !hasDet && diskHit?.version && normDepVer(diskHit.version) !== wantVer);
  const verMismatch = Boolean(rec.versionMismatch || detMismatch || diskMismatch);
  const binCheckRel = normalizeSlashes(rec.bin || `workflows/.deps/_shared/.bin/${id}`);
  const onDisk = spiCheckEntryOnDisk(root, isNpmLib, npmHit, diskHit, rec, binCheckRel);
  const state = spiResolveReconciledState(rec, verMismatch, onDisk);
  const fallbackVer = normDepVer(npmHit?.version || diskHit?.version || '');
  const entry = {
    ...rec,
    id,
    ready: state.ready,
    status: state.status,
    version: wantVer || fallbackVer,
    detectedVersion: detVer || fallbackVer || wantVer,
    updatedAt: now
  };
  if (!isNpmLib) {
    entry.bin = rec.bin || diskHit?.canonicalRelBin || binCheckRel;
  }
  return entry;
}

function spiBuildDiskToolEntry(tool, now) {
  const entry = {
    id: tool.id,
    ready: true,
    status: 'ready',
    version: tool.version || '',
    detectedVersion: tool.version || '',
    bin: tool.canonicalRelBin,
    source: 'disk-reconciled',
    updatedAt: now
  };
  if (tool.relDist) entry.dist = tool.relDist;
  if (tool.relRepo) entry.repo = tool.relRepo;
  return entry;
}

export function reconcileSharedPoolOnRefresh(projectRoot, workflowId = null, opts = {}) {
  const root = resolve(projectRoot);
  const sharedDir = join(root, 'workflows', '.deps', '_shared');
  const sharedManifestPath = join(sharedDir, 'manifest.json');
  const disk = scanSharedPoolDiskInventory(root, opts.platform || process.platform);
  const hasSharedManifest = existsSync(sharedManifestPath);
  const hasSharedNpm = existsSync(join(sharedDir, 'npm', 'node_modules'));
  if (!disk.exists && !hasSharedManifest && !hasSharedNpm) {
    return { updated: false, refreshStamp: readSharedRefreshStamp(root), entries: {} };
  }
  const skel = ensureSharedPoolSkeleton(root);
  const now = new Date().toISOString();
  const prevDoc = hasSharedManifest ? (readJsonStrict(sharedManifestPath).value || {}) : {};
  const parsed = parseFlexibleDepsManifest(prevDoc);
  const nextInstalled = {};

  for (const [id, rec] of Object.entries(parsed.entriesById)) {
    nextInstalled[id] = spiReconcileManifestEntry(root, id, rec, workflowId, disk, now);
  }
  for (const t of disk.tools) {
    if (!parsed.lookup([t.id])) nextInstalled[t.id] = spiBuildDiskToolEntry(t, now);
  }
  const labelField = parsed.topLabel ? { label: parsed.topLabel } : {};
  writeJsonAtomic(skel.manifestPath, { packId: '_shared', ...labelField, updatedAt: now, installed: nextInstalled });
  return {
    updated: true,
    refreshStamp: refreshWorkflowDepsStamp(root, { trigger: opts.trigger || 'reconcile-refresh', workflowId, platform: opts.platform }),
    entries: nextInstalled
  };
}

function resolveDetectedVersionForRecord(spec, cleanVer, npmCheck) {
  if (spec.detectedVersion !== undefined && spec.detectedVersion !== null && String(spec.detectedVersion).trim() !== '') {
    return { hasExplicit: true, value: normDepVer(spec.detectedVersion) };
  }
  if (npmCheck?.ok && npmCheck.version) return { hasExplicit: true, value: normDepVer(npmCheck.version) };
  const rawOut = String(spec.verified?.output || spec.verifyOutput || '').trim();
  if (rawOut && rawOut !== 'pass' && rawOut !== 'skip-verify') {
    const m = rawOut.match(/v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/);
    if (m) return { hasExplicit: true, value: normDepVer(m[1]) };
  }
  return { hasExplicit: false, value: cleanVer };
}

function spiEvalDepRecordReadiness(spec, cleanVer, det, isNpmLib, pkgName, npmCheck) {
  const verOk = !cleanVer || (Boolean(det.value) && cleanVer === det.value);
  const npmLibMissing = Boolean(isNpmLib && pkgName && !det.hasExplicit && !npmCheck.ok);
  const ready = (spec.pending === true || spec.ready === false || npmLibMissing) ? false : verOk;
  let status = 'pending';
  if (ready) status = 'ready';
  else if (!verOk) status = 'version-mismatch';
  else if (npmLibMissing) status = 'missing-on-disk';
  const note = !verOk
    ? `version mismatch: detected ${det.value || 'none'}, expected ${cleanVer}`
    : String(spec.note || '').trim();
  return { ready, status, note };
}

function spiBuildVerifiedSummary(spec, isNpmLib, pkgName, depId, relBin, ready, status) {
  const defaultCmd = isNpmLib ? `npm-pkg:${pkgName || depId}` : `${relBin} --version`;
  const verifyStatus = ready ? 'pass' : status;
  const command = String(spec.verified?.command || spec.verifyCommand || defaultCmd);
  const output = String(spec.verified?.output || spec.verifyOutput || verifyStatus).slice(0, 2000);
  return { command, output, status: verifyStatus };
}

function spiBuildSharedDepEntry(ctx) {
  const { depId, spec, itemLabel, kind, pkgName, isNpmLib, npmCheck, rawVer, cleanVer, det, state, relBin, now } = ctx;
  const entry = { id: depId };
  if (itemLabel) entry.label = itemLabel;
  entry.kind = kind;
  if (pkgName) entry.pkg = pkgName;
  Object.assign(entry, {
    ready: state.ready,
    status: state.status,
    version: cleanVer || det.value || rawVer,
    detectedVersion: det.value || '',
    tag: String(spec.tag || (cleanVer ? `v${cleanVer}` : '')).trim(),
    commit: String(spec.commit || '').trim()
  });
  if (spec.repo || !isNpmLib) {
    const fallbackRepo = isNpmLib ? '' : `workflows/.deps/_shared/repos/${depId}`;
    entry.repo = normalizeSlashes(spec.repo || fallbackRepo);
  }
  if (relBin) entry.bin = relBin;
  if (npmCheck.ok) {
    entry.entry = npmCheck.relEntry;
    entry.packageJson = npmCheck.relPkgJson;
  }
  if (spec.distSubdir) entry.dist = `workflows/.deps/_shared/dists/${spec.distSubdir}`;
  if (state.note) entry.note = state.note;
  entry.verified = spiBuildVerifiedSummary(spec, isNpmLib, pkgName, depId, relBin, state.ready, state.status);
  entry.updatedAt = now;
  return entry;
}

function spiWriteWorkflowDepEntry(root, wfId, spec, sharedEntry, ctx) {
  const { depId, itemLabel, kind, pkgName, state, relBin, npmCheck, now } = ctx;
  const safeWf = sanitizePoolId(wfId);
  const workflowManifestPath = join(root, 'workflows', '.deps', safeWf, 'manifest.json');
  const prevWfDoc = existsSync(workflowManifestPath) ? (readJsonStrict(workflowManifestPath).value || {}) : {};
  const prevWfParsed = parseFlexibleDepsManifest(prevWfDoc);
  const topWfLabel = String(spec.workflowLabel || prevWfParsed.topLabel || prevWfDoc.packName || '').trim();
  const workflowEntry = { id: depId };
  if (itemLabel) workflowEntry.label = itemLabel;
  workflowEntry.kind = kind;
  if (pkgName) workflowEntry.pkg = pkgName;
  Object.assign(workflowEntry, {
    ready: state.ready,
    status: state.status,
    sharedPool: true,
    sharedManifest: '../_shared/manifest.json',
    version: sharedEntry.version,
    detectedVersion: sharedEntry.detectedVersion,
    tag: sharedEntry.tag,
    commit: sharedEntry.commit
  });
  if (relBin) workflowEntry.bin = relBin;
  if (npmCheck.ok) workflowEntry.entry = npmCheck.relEntry;
  if (state.note) workflowEntry.note = state.note;
  workflowEntry.updatedAt = now;
  const labelField = topWfLabel ? { label: topWfLabel } : {};
  writeJsonAtomic(workflowManifestPath, {
    packId: safeWf, ...labelField, updatedAt: now,
    installed: { ...prevWfParsed.entriesById, [depId]: workflowEntry }
  });
  return { workflowManifestPath, workflowEntry };
}

export function recordSharedPoolDepReady(projectRoot, spec = {}) {
  const depId = String(spec.id || spec.binName || '').trim();
  if (!depId) throw new Error('recordSharedPoolDepReady requires dep id');
  const skel = ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: Boolean(spec.useGradleHome || depId.toLowerCase() === 'gradle') });
  const now = new Date().toISOString();
  const wfId = String(spec.workflowId || spec.packId || '').trim();
  const prevDoc = existsSync(skel.manifestPath) ? (readJsonStrict(skel.manifestPath).value || {}) : {};
  const prevParsed = parseFlexibleDepsManifest(prevDoc);
  const pkgName = String(spec.pkg || '').trim();
  const kind = String(spec.kind || (pkgName && !spec.bin ? 'npm-lib' : 'archive-bin')).trim();
  const isNpmLib = kind === 'npm-lib';
  const npmCheck = (isNpmLib || pkgName) ? verifyInstalledNpmPackage(projectRoot, pkgName || depId, wfId) : { ok: false };
  const rawVer = String(spec.version || '').trim();
  const cleanVer = normDepVer(rawVer);
  const det = resolveDetectedVersionForRecord(spec, cleanVer, npmCheck);
  const state = spiEvalDepRecordReadiness(spec, cleanVer, det, isNpmLib, pkgName, npmCheck);
  const itemLabel = String(spec.label || '').trim();
  const relBin = isNpmLib ? '' : normalizeSlashes(spec.bin || `workflows/.deps/_shared/.bin/${spec.binName || depId}`);

  const ctx = { depId, spec, itemLabel, kind, pkgName, isNpmLib, npmCheck, rawVer, cleanVer, det, state, relBin, now };
  const sharedEntry = spiBuildSharedDepEntry(ctx);
  const sharedLabel = prevParsed.topLabel ? { label: prevParsed.topLabel } : {};
  writeJsonAtomic(skel.manifestPath, {
    packId: '_shared', ...sharedLabel, updatedAt: now,
    installed: { ...prevParsed.entriesById, [depId]: sharedEntry }
  });

  let workflowManifestPath = null;
  let workflowEntry = null;
  if (wfId && wfId !== '_shared') {
    const wfOut = spiWriteWorkflowDepEntry(skel.root, wfId, spec, sharedEntry, ctx);
    workflowManifestPath = wfOut.workflowManifestPath;
    workflowEntry = wfOut.workflowEntry;
  }
  const refreshStamp = refreshWorkflowDepsStamp(projectRoot, {
    trigger: spec.trigger || 'mark-ready', workflowId: wfId || null, depId
  });
  return {
    ok: state.ready, depId, status: state.status,
    sharedManifestPath: skel.manifestPath, workflowManifestPath, sharedEntry, workflowEntry, refreshStamp
  };
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
