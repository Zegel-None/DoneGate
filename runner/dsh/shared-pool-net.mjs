// Windows 11 共享依赖池网络与 Git 零脏索引底座（OpenSSL Git 参数、陈旧 index.lock 清理、1 MiB HTTP Range 断点续传）
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha256 } from '../../skill/hash.mjs';
import { normalizeLf } from './win-paths.mjs';

export const DEFAULT_RANGE_CHUNK_BYTES = 1048576; // 1 MiB：代理链路实测最稳，规避 4 MiB 超时
export const DEFAULT_MAX_CHUNK_RETRIES = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const GIT_ENV_SCRUB = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];

export function cleanSubprocessGitEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const k of GIT_ENV_SCRUB) delete env[k];
  return env;
}

export function resolveGitProxyConfigs(env = process.env) {
  const allProxy = String(env?.ALL_PROXY || env?.all_proxy || '').trim();
  const httpProxy = String(env?.HTTP_PROXY || env?.http_proxy || allProxy).trim();
  const httpsProxy = String(env?.HTTPS_PROXY || env?.https_proxy || httpProxy || allProxy).trim();
  const args = [];
  if (httpProxy) args.push('-c', `http.proxy=${httpProxy}`);
  if (httpsProxy) args.push('-c', `https.proxy=${httpsProxy}`);
  return args;
}

export function buildWinHardenedGitArgs(extraArgs = [], env = process.env) {
  return [
    '-c', 'core.longpaths=true', '-c', 'core.quotepath=false',
    '-c', 'core.autocrlf=false', '-c', 'http.sslBackend=openssl',
    ...resolveGitProxyConfigs(env), ...extraArgs
  ];
}

export function runHardenedGit(cwd, gitArgs, env = process.env, timeoutMs = 120000) {
  const fullArgs = ['-C', resolve(cwd), ...buildWinHardenedGitArgs(gitArgs, env)];
  const r = spawnSync('git', fullArgs, { encoding: 'utf8', env: cleanSubprocessGitEnv(env), timeout: timeoutMs, windowsHide: true });
  return { ok: r.status === 0, status: typeof r.status === 'number' ? r.status : 1, stdout: normalizeLf(r.stdout || ''), stderr: normalizeLf(r.stderr || ''), args: fullArgs };
}

export function resolveGitAdminDir(repoDir) {
  if (!repoDir) return null;
  const dotGit = join(resolve(repoDir), '.git');
  if (!existsSync(dotGit)) return null;
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (st.isFile()) {
      const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (m && m[1]) return resolve(repoDir, m[1].trim());
    }
  } catch (err) { void err; }
  return null;
}

export function cleanStaleGitIndexLock(repoDir, opts = {}) {
  const gitDir = resolveGitAdminDir(repoDir);
  if (!gitDir) return { existed: false, removed: false, lockPath: null };
  const lockPath = join(gitDir, 'index.lock');
  if (!existsSync(lockPath)) return { existed: false, removed: false, lockPath };
  if (typeof opts.isLockActive === 'function' && opts.isLockActive(lockPath) === true) {
    return { existed: true, removed: false, active: true, lockPath };
  }
  if (opts.takeover === false && typeof opts.staleMs === 'number' && opts.staleMs > 0) {
    try {
      if (Date.now() - statSync(lockPath).mtimeMs < opts.staleMs) return { existed: true, removed: false, active: true, lockPath };
    } catch (err) { void err; }
  }
  try {
    unlinkSync(lockPath);
    return { existed: true, removed: true, lockPath };
  } catch (err) {
    return { existed: true, removed: false, error: String(err.message || err), lockPath };
  }
}

export function countPorcelainDeletedEntries(porcelainText) {
  let count = 0;
  for (const line of normalizeLf(porcelainText || '').split('\n')) {
    if (line.length >= 3 && line.slice(0, 2).includes('D')) count++;
  }
  return count;
}

export function repairGitRepoCleanIndex(repoDir, env = process.env, opts = {}) {
  const absRepo = resolve(repoDir);
  const lockClean = cleanStaleGitIndexLock(absRepo, opts);
  const gitDir = resolveGitAdminDir(absRepo);
  if (!gitDir) return { ok: true, hasGit: false, lockRemoved: lockClean.removed, dirtyDeletionsBefore: 0, dirtyDeletionsAfter: 0 };
  if (lockClean.existed && !lockClean.removed) {
    return { ok: false, hasGit: true, lockRemoved: false, reason: 'ACTIVE_INDEX_LOCK', lockPath: lockClean.lockPath };
  }
  const beforeSt = runHardenedGit(absRepo, ['status', '--porcelain'], env);
  const dirtyDeletionsBefore = countPorcelainDeletedEntries(beforeSt.stdout);
  const headRes = runHardenedGit(absRepo, ['rev-parse', '--verify', 'HEAD'], env);
  if (!headRes.ok || !headRes.stdout.trim()) {
    if (opts.degradeBrokenGitToSnapshot !== false) {
      rmSync(gitDir, { recursive: true, force: true });
      return { ok: true, hasGit: false, degradedToSnapshot: true, lockRemoved: lockClean.removed, dirtyDeletionsBefore, dirtyDeletionsAfter: 0 };
    }
    return { ok: false, hasGit: true, lockRemoved: lockClean.removed, reason: 'MISSING_GIT_HEAD' };
  }

  // 严禁执行 git add -A（防止静默吞掉工作树人工改动或纳入未跟踪文件）；仅重置索引至 HEAD 清除虚假 D 记录
  runHardenedGit(absRepo, ['read-tree', '--reset', 'HEAD'], env);
  const afterSt = runHardenedGit(absRepo, ['status', '--porcelain'], env);
  const dirtyDeletionsAfter = countPorcelainDeletedEntries(afterSt.stdout);
  if (dirtyDeletionsAfter > 0 && opts.degradeBrokenGitToSnapshot === true) {
    rmSync(gitDir, { recursive: true, force: true });
    return { ok: true, hasGit: false, degradedToSnapshot: true, lockRemoved: lockClean.removed, dirtyDeletionsBefore, dirtyDeletionsAfter: 0 };
  }
  return {
    ok: afterSt.ok && dirtyDeletionsAfter === 0, hasGit: true, head: headRes.stdout.trim(),
    lockRemoved: lockClean.removed, dirtyDeletionsBefore, dirtyDeletionsAfter, porcelain: afterSt.stdout.trim()
  };
}

function parseContentRangeHeader(raw) {
  const val = String(raw || '').trim();
  const mPart = val.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (mPart) return { unsatisfied: false, start: Number(mPart[1]), end: Number(mPart[2]), total: mPart[3] === '*' ? null : Number(mPart[3]) };
  const mUnsat = val.match(/^bytes\s+\*\/(\d+)$/i);
  return mUnsat ? { unsatisfied: true, start: null, end: null, total: Number(mUnsat[1]) } : null;
}

async function fetchFollowingRedirects(fetchFn, startUrl, headers, maxRedirects = 8) {
  let curUrl = startUrl, hops = 0;
  const curHeaders = { ...headers };
  while (hops <= maxRedirects) {
    const res = await fetchFn(curUrl, { method: 'GET', headers: curHeaders, redirect: 'manual' });
    if (REDIRECT_STATUSES.has(res.status)) {
      const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
      if (!loc) throw new Error(`HTTP ${res.status} redirect missing Location header`);
      const nextUrl = new URL(loc, curUrl).href;
      if (new URL(nextUrl).origin !== new URL(curUrl).origin) delete curHeaders.Authorization;
      curUrl = nextUrl; hops++; continue;
    }
    const resolvedUrl = (res.url && String(res.url).startsWith('http')) ? res.url : curUrl;
    return { res, finalUrl: resolvedUrl, hops };
  }
  throw new Error(`Too many HTTP redirects (> ${maxRedirects}) for ${startUrl}`);
}

export async function downloadWithRangeResume(url, destPath, opts = {}) {
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('No fetch implementation available');
  const absDest = resolve(destPath), partPath = `${absDest}.part`;
  mkdirSync(dirname(absDest), { recursive: true });

  const chunkSize = Math.max(1024, Number(opts.chunkSize || DEFAULT_RANGE_CHUNK_BYTES));
  const maxRetries = Math.max(1, Number(opts.maxRetries ?? DEFAULT_MAX_CHUNK_RETRIES));
  const baseDelayMs = Math.max(1, Number(opts.baseDelayMs ?? 100));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const resumedFromBytes = existsSync(partPath) ? statSync(partPath).size : 0;
  let offset = resumedFromBytes, totalBytes = null, activeUrl = String(url);
  let redirectsFollowed = 0, retriesUsed = 0, chunksDownloaded = 0, mode = 'range-206';

  while (totalBytes === null || offset < totalBytes) {
    let chunkDone = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rangeEnd = totalBytes !== null ? Math.min(offset + chunkSize - 1, totalBytes - 1) : offset + chunkSize - 1;
        const { res, finalUrl, hops } = await fetchFollowingRedirects(fetchFn, activeUrl, { ...(opts.headers || {}), Range: `bytes=${offset}-${rangeEnd}` });
        activeUrl = finalUrl; redirectsFollowed += hops;

        if (res.status === 416 && offset > 0) {
          const cr416 = parseContentRangeHeader(res.headers?.get?.('content-range'));
          if (cr416 && typeof cr416.total === 'number') {
            if (offset === cr416.total) { totalBytes = cr416.total; chunkDone = true; break; }
            if (offset > cr416.total) { writeFileSync(partPath, Buffer.alloc(0)); offset = 0; totalBytes = cr416.total; continue; }
          }
        }
        if (res.status === 200) {
          const buf = Buffer.from(await res.arrayBuffer());
          const cl = res.headers?.get?.('content-length');
          if (cl !== null && cl !== undefined && /^\d+$/.test(String(cl)) && buf.byteLength !== Number(cl)) {
            throw new Error(`HTTP 200 incomplete body: got ${buf.byteLength}, expected ${cl}`);
          }
          writeFileSync(partPath, buf);
          offset = buf.byteLength; totalBytes = buf.byteLength; chunksDownloaded = 1; mode = 'stream-200'; chunkDone = true; break;
        }
        if (res.status === 206) {
          const cr = parseContentRangeHeader(res.headers?.get?.('content-range'));
          if (!cr || cr.unsatisfied || cr.start !== offset || typeof cr.total !== 'number') {
            throw new Error(`Invalid Content-Range header at offset ${offset}: ${res.headers?.get?.('content-range')}`);
          }
          const expectedLen = cr.end - cr.start + 1;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength !== expectedLen) throw new Error(`Chunk byte length mismatch at ${offset}: got ${buf.byteLength}, expected ${expectedLen}`);
          if (offset === 0 && !existsSync(partPath)) writeFileSync(partPath, buf);
          else appendFileSync(partPath, buf);
          offset += buf.byteLength; totalBytes = cr.total; chunksDownloaded++; mode = 'range-206'; chunkDone = true; break;
        }
        throw new Error(`Unexpected HTTP status ${res.status}`);
      } catch (err) {
        if (attempt >= maxRetries) throw new Error(`Range download failed at byte ${offset} after ${maxRetries} attempts: ${err.message || err}`);
        retriesUsed++;
        await sleep(Math.min(4000, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
    if (!chunkDone) break;
  }

  const finalSize = existsSync(partPath) ? statSync(partPath).size : 0;
  if (totalBytes !== null && finalSize !== totalBytes) throw new Error(`Final byte size mismatch: ${finalSize} !== ${totalBytes}`);
  const actualSha256 = sha256(readFileSync(partPath));
  if (opts.expectedSha256) {
    const want = String(opts.expectedSha256).trim().replace(/^sha256:/i, '').toLowerCase();
    if (actualSha256 !== want) {
      rmSync(partPath, { force: true });
      if (existsSync(absDest)) rmSync(absDest, { force: true });
      throw new Error(`SHA-256 verification failed: expected ${want}, got ${actualSha256}`);
    }
  }
  if (existsSync(absDest)) rmSync(absDest, { force: true });
  renameSync(partPath, absDest);
  return { ok: true, destPath: absDest, finalUrl: activeUrl, bytes: finalSize, sha256: actualSha256, mode, chunksDownloaded, retriesUsed, redirectsFollowed, resumedFromBytes };
}

export function extractArchiveToDir(archivePath, targetDir, opts = {}) {
  const absArchive = resolve(archivePath), absTarget = resolve(targetDir);
  mkdirSync(absTarget, { recursive: true });
  if (typeof opts.extractFn === 'function') { opts.extractFn(absArchive, absTarget); return { ok: true, targetDir: absTarget }; }
  const strip = Number(opts.stripComponents ?? 0);
  const flag = /\.(?:tar\.gz|tgz)$/i.test(absArchive) ? '-xzf' : '-xf';
  const tarArgs = [flag, absArchive, ...(strip > 0 ? [`--strip-components=${strip}`] : []), '-C', absTarget];
  const r = spawnSync('tar', tarArgs, { encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (r.status === 0) return { ok: true, targetDir: absTarget };
  throw new Error(`Archive extraction failed (${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
}

export async function provisionCleanRepoSnapshot(opts = {}) {
  const repoDir = resolve(opts.repoDir), env = opts.env || process.env;
  const ref = String(opts.ref || opts.tag || opts.version || 'HEAD').trim();
  const tarballUrl = opts.tarballUrl || (opts.repo ? `https://codeload.github.com/${opts.repo}/tar.gz/${encodeURIComponent(ref)}` : '');
  if (!tarballUrl) throw new Error('provisionCleanRepoSnapshot requires tarballUrl or repo');

  cleanStaleGitIndexLock(repoDir, opts);
  const archivePath = resolve(opts.archivePath || join(dirname(repoDir), `${opts.id || 'repo'}-${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}-src.tar.gz`));
  const dl = await downloadWithRangeResume(tarballUrl, archivePath, opts);
  extractArchiveToDir(archivePath, repoDir, { stripComponents: opts.stripComponents ?? 1, extractFn: opts.extractFn });

  if (opts.initGitMetadata === true && opts.remoteUrl) {
    if (!resolveGitAdminDir(repoDir)) runHardenedGit(repoDir, ['init', '-q'], env);
    runHardenedGit(repoDir, ['remote', 'remove', 'origin'], env);
    runHardenedGit(repoDir, ['remote', 'add', 'origin', opts.remoteUrl], env);
    const fetchRes = runHardenedGit(repoDir, ['fetch', '--depth', '1', '--filter=blob:none', 'origin', ref], env);
    if (fetchRes.ok) runHardenedGit(repoDir, ['update-ref', 'HEAD', 'FETCH_HEAD'], env);
    else if (opts.allowSnapshotFallback !== false) {
      const gitDir = resolveGitAdminDir(repoDir);
      if (gitDir) rmSync(gitDir, { recursive: true, force: true });
    }
  }
  const indexReport = repairGitRepoCleanIndex(repoDir, env, { ...opts, degradeBrokenGitToSnapshot: opts.allowSnapshotFallback !== false });
  return { ok: indexReport.ok, repoDir, archivePath, download: dl, indexReport };
}
