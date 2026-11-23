// 生成并落盘目标工作区零外部依赖单文件 CLI：workflows/.deps/_shared/dg-deps-cli.mjs
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function renderStandaloneDepsCliSource() {
  const hashAlgExpr = "'sha' + '256'";
  return `#!/usr/bin/env node
// Auto-generated zero-dependency DoneGate shared-pool helper CLI (workflows/.deps/_shared/dg-deps-cli.mjs)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RANGE_CHUNK_BYTES = 1048576;
const REDIRECTS = new Set([301, 302, 303, 307, 308]), SAFE_RE = /^[A-Za-z0-9._-]+$/;
const GIT_SCRUB = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
const normLf = (s) => String(s ?? '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
const normSlash = (p) => String(p ?? '').replace(/\\\\/g, '/'), normVer = (v) => String(v ?? '').trim().replace(/^v/i, '');
const sanitizeId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
const sha256Hex = (buf) => createHash(${hashAlgExpr}).update(buf).digest('hex');
const readJsonSafe = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch (e) { void e; return null; } };

export function writeJsonAtomic(filePath, data) {
  const abs = resolve(filePath), tmp = \`\${abs}.tmp-\${process.pid}-\${Date.now()}\`;
  mkdirSync(dirname(abs), { recursive: true }); writeFileSync(tmp, JSON.stringify(data, null, 2) + '\\n', 'utf8');
  try { renameSync(tmp, abs); } catch (e) { void e; if (existsSync(abs)) rmSync(abs, { force: true }); renameSync(tmp, abs); }
  return abs;
}

export function ensureSharedPoolSkeleton(projectRoot, opts = {}) {
  const root = resolve(projectRoot || process.cwd()), sharedDir = join(root, 'workflows', '.deps', '_shared');
  const binDir = join(sharedDir, '.bin'), distsDir = join(sharedDir, 'dists'), reposDir = join(sharedDir, 'repos'), npmDir = join(sharedDir, 'npm'), gradleHomeDir = join(sharedDir, '.gradle-home');
  for (const d of [binDir, distsDir, reposDir, npmDir]) mkdirSync(d, { recursive: true });
  if (opts.includeGradleHome || String(opts.binName || opts.toolId || '').toLowerCase() === 'gradle') mkdirSync(gradleHomeDir, { recursive: true });
  return { root, sharedDir, binDir, distsDir, reposDir, npmDir, gradleHomeDir, manifestPath: join(sharedDir, 'manifest.json'), refreshStampPath: join(sharedDir, '.refresh-stamp.json'), rootRefreshStampPath: join(root, 'workflows', '.deps', '.refresh-stamp.json') };
}

function pickPkgEntryRel(pkgJson) {
  const findStr = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      for (const k of ['import', 'default', 'node', 'browser', 'require', '.']) if (k in v && findStr(v[k])) return findStr(v[k]);
      for (const sub of Object.values(v)) if (findStr(sub)) return findStr(sub);
    }
    return '';
  };
  return findStr(pkgJson.exports) || String(pkgJson.module || pkgJson.main || '').trim();
}

export function verifyInstalledNpmPkg(projectRoot, pkgName, workflowId = null) {
  if (!pkgName) return { ok: false, reason: 'missing-pkg-name' };
  const root = resolve(projectRoot || process.cwd()), segs = String(pkgName).split('/').filter(Boolean);
  const bases = [{ scope: 'shared', dir: join(root, 'workflows', '.deps', '_shared', 'npm', 'node_modules') }, { scope: 'shared', dir: join(root, 'workflows', '.deps', '_shared', 'node_modules') }];
  if (workflowId && workflowId !== '_shared') {
    const safeWf = sanitizeId(workflowId);
    bases.push({ scope: 'workflow', dir: join(root, 'workflows', '.deps', safeWf, 'npm', 'node_modules') }, { scope: 'workflow', dir: join(root, 'workflows', '.deps', safeWf, 'node_modules') });
  }
  for (const b of bases) {
    const pkgDir = join(b.dir, ...segs), pkgJsonPath = join(pkgDir, 'package.json'), pkgJson = readJsonSafe(pkgJsonPath);
    if (!pkgJson) continue;
    const entryRel = pickPkgEntryRel(pkgJson), entryAbs = entryRel ? resolve(pkgDir, entryRel) : pkgJsonPath;
    if (entryRel && !existsSync(entryAbs)) continue;
    return { ok: true, scope: b.scope, pkg: pkgName, version: normVer(pkgJson.version || ''), relPkgJson: normSlash(pkgJsonPath.slice(root.length).replace(/^[\\\\/]+/, '')), relEntry: normSlash(entryAbs.slice(root.length).replace(/^[\\\\/]+/, '')) };
  }
  return { ok: false, reason: 'not-installed' };
}

function parseContentRange(raw) {
  const val = String(raw || '').trim(), m = val.match(/^bytes\\s+(\\d+)-(\\d+)\\/(\\d+|\\*)$/i);
  if (m) return { unsatisfied: false, start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) };
  const u = val.match(/^bytes\\s+\\*\\/(\\d+)$/i);
  return u ? { unsatisfied: true, start: null, end: null, total: Number(u[1]) } : null;
}

async function fetchFollow(fetchFn, startUrl, headers, maxRedirects = 8) {
  let curUrl = startUrl, hops = 0; const curHeaders = { ...headers };
  while (hops <= maxRedirects) {
    const res = await fetchFn(curUrl, { method: 'GET', headers: curHeaders, redirect: 'manual' });
    if (REDIRECTS.has(res.status)) {
      const loc = res.headers?.get?.('location'); if (!loc) throw new Error(\`HTTP \${res.status} missing Location\`);
      const nextUrl = new URL(loc, curUrl).href; if (new URL(nextUrl).origin !== new URL(curUrl).origin) delete curHeaders.Authorization;
      curUrl = nextUrl; hops++; continue;
    }
    return { res, finalUrl: (res.url && String(res.url).startsWith('http')) ? res.url : curUrl, hops };
  }
  throw new Error(\`Too many redirects for \${startUrl}\`);
}

export async function downloadWithRangeResume(url, destPath, opts = {}) {
  const fetchFn = opts.fetchImpl || globalThis.fetch; if (typeof fetchFn !== 'function') throw new Error('Global fetch unavailable');
  const absDest = resolve(destPath), partPath = \`\${absDest}.part\`; mkdirSync(dirname(absDest), { recursive: true });
  const chunkSize = Math.max(1024, Number(opts.chunkSize || DEFAULT_RANGE_CHUNK_BYTES)), maxRetries = Math.max(1, Number(opts.maxRetries ?? 8)), baseDelayMs = Math.max(1, Number(opts.baseDelayMs ?? 100));
  const resumedFromBytes = existsSync(partPath) ? statSync(partPath).size : 0;
  let offset = resumedFromBytes, totalBytes = null, activeUrl = String(url), redirectsFollowed = 0, retriesUsed = 0, chunksDownloaded = 0, mode = 'range-206';
  while (totalBytes === null || offset < totalBytes) {
    let chunkDone = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rangeEnd = totalBytes !== null ? Math.min(offset + chunkSize - 1, totalBytes - 1) : offset + chunkSize - 1;
        const { res, finalUrl, hops } = await fetchFollow(fetchFn, activeUrl, { ...(opts.headers || {}), Range: \`bytes=\${offset}-\${rangeEnd}\` });
        activeUrl = finalUrl; redirectsFollowed += hops;
        if (res.status === 416 && offset > 0) {
          const cr416 = parseContentRange(res.headers?.get?.('content-range'));
          if (cr416 && typeof cr416.total === 'number') {
            if (offset === cr416.total) { totalBytes = cr416.total; chunkDone = true; break; }
            if (offset > cr416.total) { writeFileSync(partPath, Buffer.alloc(0)); offset = 0; totalBytes = cr416.total; continue; }
          }
        }
        if (res.status === 200) {
          const buf = Buffer.from(await res.arrayBuffer()), cl = res.headers?.get?.('content-length');
          if (cl !== null && cl !== undefined && /^\\d+$/.test(String(cl)) && buf.byteLength !== Number(cl)) throw new Error(\`HTTP 200 incomplete: \${buf.byteLength} !== \${cl}\`);
          writeFileSync(partPath, buf); offset = buf.byteLength; totalBytes = buf.byteLength; chunksDownloaded = 1; mode = 'stream-200'; chunkDone = true; break;
        }
        if (res.status === 206) {
          const cr = parseContentRange(res.headers?.get?.('content-range'));
          if (!cr || cr.unsatisfied || cr.start !== offset || typeof cr.total !== 'number') throw new Error(\`Invalid Content-Range at \${offset}\`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength !== cr.end - cr.start + 1) throw new Error(\`Chunk size mismatch at \${offset}\`);
          if (offset === 0 && !existsSync(partPath)) writeFileSync(partPath, buf); else appendFileSync(partPath, buf);
          offset += buf.byteLength; totalBytes = cr.total; chunksDownloaded++; mode = 'range-206'; chunkDone = true; break;
        }
        throw new Error(\`HTTP \${res.status}\`);
      } catch (err) {
        if (attempt >= maxRetries) throw new Error(\`Download failed at \${offset}: \${err.message || err}\`);
        retriesUsed++; await new Promise((r) => setTimeout(r, Math.min(4000, baseDelayMs * Math.pow(2, attempt - 1))));
      }
    }
    if (!chunkDone) break;
  }
  const finalSize = existsSync(partPath) ? statSync(partPath).size : 0;
  if (totalBytes !== null && finalSize !== totalBytes) throw new Error(\`Size mismatch: \${finalSize} !== \${totalBytes}\`);
  const actualSha256 = sha256Hex(readFileSync(partPath));
  if (opts.expectedSha256) {
    const want = String(opts.expectedSha256).trim().replace(/^sha256:/i, '').toLowerCase();
    if (actualSha256 !== want) { rmSync(partPath, { force: true }); if (existsSync(absDest)) rmSync(absDest, { force: true }); throw new Error(\`SHA-256 mismatch: expected \${want}, got \${actualSha256}\`); }
  }
  if (existsSync(absDest)) rmSync(absDest, { force: true }); renameSync(partPath, absDest);
  return { ok: true, destPath: absDest, finalUrl: activeUrl, bytes: finalSize, sha256: actualSha256, mode, chunksDownloaded, retriesUsed, redirectsFollowed, resumedFromBytes };
}

function resolveGitDir(repoDir) {
  const dotGit = join(resolve(repoDir), '.git'); if (!existsSync(dotGit)) return null;
  try { const st = statSync(dotGit); if (st.isDirectory()) return dotGit; const m = st.isFile() ? readFileSync(dotGit, 'utf8').match(/^gitdir:\\s*(.+)$/m) : null; return m && m[1] ? resolve(repoDir, m[1].trim()) : null; } catch (e) { void e; return null; }
}

function runGit(repoDir, args, env = process.env) {
  const cleanEnv = { ...env }; for (const k of GIT_SCRUB) delete cleanEnv[k];
  const proxy = String(env?.HTTPS_PROXY || env?.https_proxy || env?.HTTP_PROXY || env?.http_proxy || env?.ALL_PROXY || '').trim();
  const cfg = ['-C', resolve(repoDir), '-c', 'core.longpaths=true', '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'http.sslBackend=openssl', ...(proxy ? ['-c', \`http.proxy=\${proxy}\`, '-c', \`https.proxy=\${proxy}\`] : [])];
  const r = spawnSync('git', [...cfg, ...args], { encoding: 'utf8', env: cleanEnv, timeout: 120000, windowsHide: true });
  return { ok: r.status === 0, stdout: normLf(r.stdout || ''), stderr: normLf(r.stderr || '') };
}

const countDeleted = (p) => normLf(p).split('\\n').filter((l) => l.length >= 3 && l.slice(0, 2).includes('D')).length;

export function repairGitRepoCleanIndex(repoDir, env = process.env) {
  const absRepo = resolve(repoDir), gitDir = resolveGitDir(absRepo);
  if (!gitDir) return { ok: true, hasGit: false, lockRemoved: false, dirtyDeletionsBefore: 0, dirtyDeletionsAfter: 0 };
  const lockPath = join(gitDir, 'index.lock'), lockRemoved = existsSync(lockPath) ? (unlinkSync(lockPath), true) : false;
  const dirtyDeletionsBefore = countDeleted(runGit(absRepo, ['status', '--porcelain'], env).stdout), headRes = runGit(absRepo, ['rev-parse', '--verify', 'HEAD'], env);
  if (!headRes.ok || !headRes.stdout.trim()) return { ok: false, hasGit: true, lockRemoved, reason: 'MISSING_GIT_HEAD' };
  runGit(absRepo, ['read-tree', '--reset', 'HEAD'], env);
  const afterSt = runGit(absRepo, ['status', '--porcelain'], env), dirtyDeletionsAfter = countDeleted(afterSt.stdout);
  return { ok: afterSt.ok && dirtyDeletionsAfter === 0, hasGit: true, head: headRes.stdout.trim(), lockRemoved, dirtyDeletionsBefore, dirtyDeletionsAfter, porcelain: afterSt.stdout.trim() };
}

export function assertPureAsciiBatch(content, label = 'batch-launcher') {
  const txt = String(content ?? '');
  if (!/^[\\x00-\\x7F]*$/.test(txt)) throw new Error(\`[\${label}] NON_ASCII_BATCH_CONTENT\`);
  if (/(^|[^\\r])\\n/.test(txt)) throw new Error(\`[\${label}] NON_CRLF_BATCH_CONTENT\`);
  return txt;
}

export function writeSharedPoolLaunchers(projectRoot, spec = {}) {
  const binName = String(spec.binName || spec.id || '').trim(); if (!SAFE_RE.test(binName)) throw new Error('Unsafe binName');
  const isGradle = Boolean(spec.useGradleHome || binName.toLowerCase() === 'gradle'), skel = ensureSharedPoolSkeleton(projectRoot, { includeGradleHome: isGradle });
  const rawComment = String(spec.comment || \`DoneGate shared-pool launcher for \${binName}\`);
  if (spec.strictAsciiInput && !/^[\\x00-\\x7F]*$/.test(rawComment)) throw new Error('NON_ASCII_BATCH_CONTENT');
  const note = rawComment.replace(/[^\\x20-\\x7E]+/g, ' ').replace(/\\s+/g, ' ').trim() || \`DoneGate launcher \${binName}\`, npmBinBase = join(skel.npmDir, 'node_modules', '.bin');
  const useNpmBin = Boolean(spec.npmBin === true || spec.kind === 'npm-cli' || (!spec.distSubdir && (existsSync(join(npmBinBase, binName)) || existsSync(join(npmBinBase, \`\${binName}.cmd\`)) || existsSync(join(npmBinBase, \`\${binName}.exe\`)))));
  let shLines, batLines;
  if (useNpmBin) {
    const hasExe = existsSync(join(npmBinBase, \`\${binName}.exe\`));
    shLines = ['#!/bin/sh', \`# \${note}\`, 'DG_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"', \`exec "$DG_BIN_DIR/../npm/node_modules/.bin/\${binName}" "$@"\`, ''];
    batLines = ['@echo off', 'setlocal', \`rem \${note}\`, 'set "DG_BIN_DIR=%~dp0"', 'for %%I in ("%DG_BIN_DIR%..\\\\npm\\\\node_modules\\\\.bin") do set "DG_NPM_BIN=%%~fI"', hasExe ? \`"%DG_NPM_BIN%\\\\\${binName}.exe" %*\` : \`call "%DG_NPM_BIN%\\\\\${binName}.cmd" %*\`, 'exit /b %ERRORLEVEL%', ''];
  } else {
    const distSubdir = String(spec.distSubdir || '').trim(); if (!SAFE_RE.test(distSubdir)) throw new Error('Unsafe or missing distSubdir');
    const distBase = join(skel.distsDir, distSubdir), posixEntry = normSlash(spec.posixEntryRel || ([\`bin/\${binName}\`, binName].find((r) => existsSync(join(distBase, r))) || \`bin/\${binName}\`)).replace(/^\\/+/, '');
    const winDefault = [\`bin/\${binName}.bat\`, \`bin/\${binName}.cmd\`, \`bin/\${binName}.exe\`, \`\${binName}.exe\`, \`\${binName}.bat\`].find((r) => existsSync(join(distBase, r))) || (isGradle ? \`bin/\${binName}.bat\` : \`bin/\${binName}.exe\`);
    const winEntry = String(spec.winEntryRel || winDefault).replace(/\\//g, '\\\\').replace(/^\\\\+/, '');
    shLines = ['#!/bin/sh', \`# \${note}\`, 'DG_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"', \`DG_DIST_DIR="$(CDPATH= cd -- "$DG_BIN_DIR/../dists/\${distSubdir}" && pwd)"\`, ...(isGradle ? ['GRADLE_HOME="$DG_DIST_DIR"', 'export GRADLE_HOME', 'DG_POOL_GRADLE_HOME="$DG_BIN_DIR/../.gradle-home"', 'mkdir -p "$DG_POOL_GRADLE_HOME" 2>/dev/null || true', 'if [ -z "\${GRADLE_USER_HOME:-}" ] || ! mkdir -p "$GRADLE_USER_HOME" 2>/dev/null || [ ! -w "$GRADLE_USER_HOME" ]; then GRADLE_USER_HOME="$(CDPATH= cd -- "$DG_POOL_GRADLE_HOME" && pwd)"; fi', 'export GRADLE_USER_HOME'] : []), \`exec "$DG_DIST_DIR/\${posixEntry}" "$@"\`, ''];
    batLines = ['@echo off', 'setlocal', \`rem \${note}\`, 'set "DG_BIN_DIR=%~dp0"', \`for %%I in ("%DG_BIN_DIR%..\\\\dists\\\\\${distSubdir}") do set "DG_DIST_DIR=%%~fI"\`, ...(isGradle ? ['set "GRADLE_HOME=%DG_DIST_DIR%"', 'for %%I in ("%DG_BIN_DIR%..\\\\.gradle-home") do set "DG_POOL_GRADLE_HOME=%%~fI"', 'if not exist "%DG_POOL_GRADLE_HOME%" mkdir "%DG_POOL_GRADLE_HOME%" >nul 2>nul', 'set "GRADLE_USER_HOME=%DG_POOL_GRADLE_HOME%"'] : []), /\\.(?:bat|cmd)$/i.test(winEntry) ? \`call "%DG_DIST_DIR%\\\\\${winEntry}" %*\` : \`"%DG_DIST_DIR%\\\\\${winEntry}" %*\`, 'exit /b %ERRORLEVEL%', ''];
  }
  const batContent = assertPureAsciiBatch(normLf(batLines.join('\\n')).replace(/\\n/g, '\\r\\n'), \`\${binName}.bat\`);
  const posixPath = join(skel.binDir, binName), batPath = join(skel.binDir, \`\${binName}.bat\`), cmdPath = join(skel.binDir, \`\${binName}.cmd\`);
  writeFileSync(posixPath, normLf(shLines.join('\\n')), 'utf8'); try { chmodSync(posixPath, 0o755); } catch (e) { void e; }
  writeFileSync(batPath, batContent, 'ascii'); writeFileSync(cmdPath, batContent, 'ascii');
  return { ok: true, binName, mode: useNpmBin ? 'npm-cli' : 'archive-bin', posixPath, batPath, cmdPath, relBin: \`workflows/.deps/_shared/.bin/\${binName}\` };
}

function extractExistingEntries(doc) {
  const out = {}; if (!doc || typeof doc !== 'object') return out;
  for (const k of ['installed', 'deps', 'entries', 'items']) if (doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k])) Object.assign(out, doc[k]);
  const skip = new Set(['schema', 'schemaVersion', 'packId', 'workflowId', 'label', 'packName', 'updatedAt', 'generatedAt', 'seq', 'refreshedAt', 'installed', 'deps', 'entries', 'items', 'tools', 'packages', 'note', 'version', 'summary']);
  for (const [k, v] of Object.entries(doc)) if (!skip.has(k) && v && typeof v === 'object' && !Array.isArray(v) && ('ready' in v || 'status' in v || 'bin' in v || 'pkg' in v)) out[k] = v;
  return out;
}

function writeDualStamp(skel, meta, installed) {
  const s1 = readJsonSafe(skel.refreshStampPath), s2 = readJsonSafe(skel.rootRefreshStampPath);
  const readyIds = Object.entries(installed || {}).filter(([, v]) => v && (v.ready === true || v.status === 'ready')).map(([k]) => k).sort();
  const stamp = { schema: 'donegate-deps-refresh/v1', seq: Math.max(Number(s1?.seq || 0), Number(s2?.seq || 0)) + 1, refreshedAt: new Date().toISOString(), trigger: String(meta.trigger || 'cli-refresh'), workflowId: meta.workflowId || null, depId: meta.depId || null, readyIds };
  writeJsonAtomic(skel.refreshStampPath, stamp); writeJsonAtomic(skel.rootRefreshStampPath, stamp);
  return stamp;
}

export function recordSharedPoolDepReady(projectRoot, spec = {}) {
  const depId = String(spec.id || spec.binName || '').trim(); if (!depId) throw new Error('mark-ready requires --id');
  const skel = ensureSharedPoolSkeleton(projectRoot, { toolId: depId }), now = new Date().toISOString(), wfId = String(spec.workflowId || spec.packId || '').trim(), pkgName = String(spec.pkg || '').trim();
  const kind = String(spec.kind || (pkgName && !spec.bin ? 'npm-lib' : 'archive-bin')).trim(), npmProbe = (kind === 'npm-lib' || pkgName) ? verifyInstalledNpmPkg(projectRoot, pkgName || depId, wfId) : { ok: false };
  const wantVer = normVer(spec.version), hasDet = spec.detectedVersion !== undefined && spec.detectedVersion !== null && String(spec.detectedVersion).trim() !== '';
  const detectedVer = hasDet ? normVer(spec.detectedVersion) : (npmProbe.ok && npmProbe.version ? npmProbe.version : wantVer);
  const verOk = !wantVer || (Boolean(detectedVer) && wantVer === detectedVer), npmMissing = kind === 'npm-lib' && pkgName && !hasDet && !npmProbe.ok;
  const ready = (spec.pending === true || spec.ready === false || npmMissing) ? false : verOk, status = ready ? 'ready' : (!verOk ? 'version-mismatch' : (npmMissing ? 'missing-on-disk' : 'pending'));
  const note = !verOk ? \`version mismatch: detected \${detectedVer || 'none'}, expected \${wantVer}\` : '', itemLabel = String(spec.label || '').trim(), relBin = kind === 'npm-lib' ? '' : normSlash(spec.bin || \`workflows/.deps/_shared/.bin/\${spec.binName || depId}\`);
  const prevShared = readJsonSafe(skel.manifestPath) || {}, sharedInstalled = extractExistingEntries(prevShared);
  const sharedEntry = { id: depId, ...(itemLabel ? { label: itemLabel } : {}), kind, ...(pkgName ? { pkg: pkgName } : {}), ready, status, version: wantVer || detectedVer, detectedVersion: detectedVer || '', ...(npmProbe.ok ? { entry: npmProbe.relEntry, packageJson: npmProbe.relPkgJson } : {}), ...(relBin ? { bin: relBin } : {}), ...(spec.repo ? { repo: normSlash(spec.repo) } : {}), ...(spec.distSubdir ? { dist: \`workflows/.deps/_shared/dists/\${spec.distSubdir}\` } : {}), ...(note ? { note } : {}), updatedAt: now };
  sharedInstalled[depId] = sharedEntry; writeJsonAtomic(skel.manifestPath, { packId: '_shared', ...(prevShared.label ? { label: prevShared.label } : {}), updatedAt: now, installed: sharedInstalled });
  let workflowManifestPath = null, workflowEntry = null;
  if (wfId && wfId !== '_shared') {
    const safeWf = sanitizeId(wfId); workflowManifestPath = join(skel.root, 'workflows', '.deps', safeWf, 'manifest.json');
    const prevWf = readJsonSafe(workflowManifestPath) || {}, wfInstalled = extractExistingEntries(prevWf), preservedWfLabel = String(spec.workflowLabel || prevWf.label || prevWf.packName || '').trim();
    workflowEntry = { id: depId, ...(itemLabel ? { label: itemLabel } : {}), kind, ...(pkgName ? { pkg: pkgName } : {}), ready, status, sharedPool: true, sharedManifest: '../_shared/manifest.json', version: sharedEntry.version, detectedVersion: sharedEntry.detectedVersion, ...(relBin ? { bin: relBin } : {}), ...(npmProbe.ok ? { entry: npmProbe.relEntry } : {}), ...(note ? { note } : {}), updatedAt: now };
    wfInstalled[depId] = workflowEntry; writeJsonAtomic(workflowManifestPath, { packId: safeWf, ...(preservedWfLabel ? { label: preservedWfLabel } : {}), updatedAt: now, installed: wfInstalled });
  }
  return { ok: ready, ready, depId, status, sharedEntry, workflowEntry, sharedManifestPath: skel.manifestPath, workflowManifestPath, refreshStamp: writeDualStamp(skel, { trigger: 'cli-mark-ready', workflowId: wfId || null, depId }, sharedInstalled) };
}

export function refreshWorkflowDepsStamp(projectRoot, meta = {}) {
  const skel = ensureSharedPoolSkeleton(projectRoot), now = new Date().toISOString(), prevShared = readJsonSafe(skel.manifestPath) || {}, nextInstalled = {};
  for (const [id, rec] of Object.entries(extractExistingEntries(prevShared))) {
    if (!rec || typeof rec !== 'object') continue;
    const wantVer = normVer(rec.version), isNpmLib = rec.kind === 'npm-lib' || (rec.pkg && !rec.bin), npmProbe = isNpmLib ? verifyInstalledNpmPkg(skel.root, rec.pkg || id, meta.workflowId) : null;
    const detVer = rec.detectedVersion !== undefined && String(rec.detectedVersion).trim() !== '' ? normVer(rec.detectedVersion) : (npmProbe?.ok ? npmProbe.version : wantVer);
    const verMismatch = (wantVer && (!detVer || wantVer !== detVer)) || rec.status === 'version-mismatch', binRel = normSlash(rec.bin || \`workflows/.deps/_shared/.bin/\${id}\`);
    const onDisk = isNpmLib ? Boolean(npmProbe?.ok) : (existsSync(resolve(skel.root, binRel)) || existsSync(resolve(skel.root, \`\${binRel}.bat\`)) || existsSync(resolve(skel.root, \`\${binRel}.cmd\`)));
    const ready = verMismatch || !onDisk ? false : (rec.status !== 'pending' ? true : Boolean(rec.ready)), status = verMismatch ? 'version-mismatch' : (!onDisk ? 'missing-on-disk' : (ready ? 'ready' : 'pending'));
    nextInstalled[id] = { ...rec, ready, status, detectedVersion: detVer, updatedAt: now };
  }
  writeJsonAtomic(skel.manifestPath, { packId: '_shared', ...(prevShared.label ? { label: prevShared.label } : {}), updatedAt: now, installed: nextInstalled });
  return writeDualStamp(skel, { trigger: 'cli-refresh', workflowId: meta.workflowId || null }, nextInstalled);
}

export async function runStandaloneCli(argv = process.argv.slice(2)) {
  const cmd = String(argv[0] || '').trim(), pull = (f, fb = null) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb; };
  const root = resolve(pull('--project', pull('--root', process.cwd())));
  if (cmd === 'download') { const url = pull('--url', ''), dest = pull('--dest', pull('--out', '')); return (!url || !dest) ? { exitCode: 3, payload: { ok: false, error: 'download requires --url and --dest' } } : { exitCode: 0, payload: await downloadWithRangeResume(url, resolve(root, dest), { expectedSha256: pull('--sha256', ''), chunkSize: Number(pull('--chunk-size', DEFAULT_RANGE_CHUNK_BYTES)) }) }; }
  if (cmd === 'repair-git') { const repo = pull('--repo', ''); if (!repo) return { exitCode: 3, payload: { ok: false, error: 'repair-git requires --repo' } }; const out = repairGitRepoCleanIndex(resolve(root, repo)); return { exitCode: out.ok ? 0 : 1, payload: out }; }
  if (cmd === 'write-launchers') { const binName = pull('--bin', pull('--id', '')), distSubdir = pull('--dist', ''), npmBin = argv.includes('--npm-bin') || pull('--kind', '') === 'npm-cli'; return (!binName || (!distSubdir && !npmBin)) ? { exitCode: 3, payload: { ok: false, error: 'write-launchers requires --bin and (--dist or --npm-bin)' } } : { exitCode: 0, payload: writeSharedPoolLaunchers(root, { binName, distSubdir, npmBin, comment: pull('--comment', '') }) }; }
  if (cmd === 'verify-npm') { const pkg = pull('--pkg', pull('--id', '')); if (!pkg) return { exitCode: 3, payload: { ok: false, error: 'verify-npm requires --pkg' } }; const res = verifyInstalledNpmPkg(root, pkg, pull('--workflow', null)), want = normVer(pull('--version', '')), ok = res.ok && (!want || res.version === want); return { exitCode: ok ? 0 : 1, payload: { ...res, ok } }; }
  if (cmd === 'mark-ready') {
    const id = pull('--id', ''), kind = pull('--kind', ''); if (!id) return { exitCode: 3, payload: { ok: false, error: 'mark-ready requires --id' } };
    let detVer = pull('--detected-version', undefined);
    if (argv.includes('--run-verify') && kind !== 'npm-lib') {
      const binName = pull('--bin-name', id), binExec = join(root, 'workflows', '.deps', '_shared', '.bin', process.platform === 'win32' ? \`\${binName}.bat\` : binName);
      const vr = process.platform === 'win32' ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', \`""\${binExec}" --version"\`], { cwd: root, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true }) : spawnSync(binExec, ['--version'], { cwd: root, encoding: 'utf8' });
      if (vr.status !== 0) return { exitCode: 1, payload: { ok: false, stage: 'verify', stderr: vr.stderr || vr.stdout } };
      const m = String(vr.stdout || '').match(/v?(\\d+\\.\\d+(?:\\.\\d+)?(?:-[0-9A-Za-z.-]+)?)/); if (m && detVer === undefined) detVer = m[1];
    }
    return { exitCode: 0, payload: recordSharedPoolDepReady(root, { id, label: pull('--label', ''), workflowLabel: pull('--workflow-label', ''), kind, pkg: pull('--pkg', ''), binName: pull('--bin-name', id), workflowId: pull('--workflow', pull('--pack', '')), version: pull('--version', ''), detectedVersion: detVer, tag: pull('--tag', ''), commit: pull('--commit', ''), repo: pull('--repo', ''), bin: pull('--bin', ''), distSubdir: pull('--dist', ''), pending: argv.includes('--pending') }) };
  }
  if (cmd === 'refresh') return { exitCode: 0, payload: { ok: true, refreshStamp: refreshWorkflowDepsStamp(root, { workflowId: pull('--workflow', pull('--pack', null)) }) } };
  return { exitCode: 3, payload: { ok: false, error: \`Unknown subcommand: \${cmd || '(empty)'}\` } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStandaloneCli(process.argv.slice(2)).then(({ exitCode, payload }) => { console.log(JSON.stringify(payload, null, 2)); process.exit(exitCode); }).catch((err) => { console.error(JSON.stringify({ ok: false, error: String(err.message || err) })); process.exit(1); });
}
`;
}

export function writeStandaloneDepsCli(projectRoot) {
  const root = resolve(projectRoot), cliPath = join(root, 'workflows', '.deps', '_shared', 'dg-deps-cli.mjs');
  mkdirSync(dirname(cliPath), { recursive: true });
  const source = renderStandaloneDepsCliSource();
  let unchanged = false;
  if (existsSync(cliPath)) { try { unchanged = readFileSync(cliPath, 'utf8') === source; } catch (e) { void e; } }
  if (!unchanged) { writeFileSync(cliPath, source, 'utf8'); try { chmodSync(cliPath, 0o755); } catch (e) { void e; } }
  return { cliPath, cliRelPath: 'workflows/.deps/_shared/dg-deps-cli.mjs' };
}
