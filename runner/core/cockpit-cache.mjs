// 跨进程单飞文件锁 JSON 缓存与快速仓库指纹计算器（O_CREAT|O_EXCL + kill(pid,0) ESRCH 死锁自愈，<= 350 行）
import { closeSync, existsSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { readJsonStrict } from '../../skill/io.mjs';

export const CK_CACHE_SCHEMA = 'cockpit-idx-v7';
export const CK_SCAN_DIRS = ['runner', 'skill', 'workflows', 'bricks', 'tools', 'contracts', 'decisions'];
export const CK_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const CK_ROOT_FILE_RE = /\.(?:mjs|cjs|js|ts|json|jsonl|cmd|yml|yaml)$/i;
const CK_WAIT_SLICE = new Int32Array(new SharedArrayBuffer(4));

export function listRootRegularFiles(root) {
  const out = [];
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (ent.isFile() && !ent.name.startsWith('.git') && CK_ROOT_FILE_RE.test(ent.name)) out.push(ent.name);
  }
  return out.sort();
}

export function computeQuickRepoFingerprint(root, gitHead) {
  let count = 0, maxMtime = 0, totalSize = 0;
  const bump = (abs) => {
    try {
      const st = statSync(abs);
      count++;
      totalSize += st.size;
      if (st.mtimeMs > maxMtime) maxMtime = Math.floor(st.mtimeMs);
    } catch { /* ignore */ }
  };
  for (const cfg of [...listRootRegularFiles(root), 'INTENT.md', 'CONSTRAINTS.md']) {
    const p = join(root, cfg);
    if (existsSync(p)) bump(p);
  }
  for (const d of [...CK_SCAN_DIRS, 'tests']) {
    const absD = join(root, d);
    if (!existsSync(absD)) continue;
    for (const f of walk(absD, { skipDirs: CK_SKIP_DIRS }).files) bump(f);
  }
  return sha256(`${CK_CACHE_SCHEMA}|${root}|${gitHead}|${count}|${maxMtime}|${totalSize}`).slice(0, 24);
}

function tryReadValidCache(cacheFile, root) {
  if (!existsSync(cacheFile)) return null;
  const cached = readJsonStrict(cacheFile);
  return (cached.ok && cached.value?.root === root) ? cached.value : null;
}

function isLockHolderDead(lockPath) {
  const info = readJsonStrict(lockPath);
  const pid = info.ok ? Number(info.value?.pid) : 0;
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e?.code === 'ESRCH';
  }
}

function tryAcquireExclusiveLock(lockPath) {
  try {
    const fd = openSync(lockPath, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid }), 'utf8');
    closeSync(fd);
    return 'ACQUIRED';
  } catch (e) {
    if (e?.code !== 'EEXIST') return 'UNAVAILABLE';
    if (isLockHolderDead(lockPath)) {
      try { unlinkSync(lockPath); } catch { /* ignore race */ }
    }
    return 'CONTENDED';
  }
}

function persistBuiltCache(cacheFile, computeFn) {
  const built = computeFn();
  try {
    const tmpWrite = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmpWrite, JSON.stringify(built), 'utf8');
    renameSync(tmpWrite, cacheFile);
  } catch { /* ignore write failure */ }
  return built;
}

export function runWithSingleflightCache(root, gitHead, computeFn) {
  const cacheDir = process.env.DONEGATE_COCKPIT_CACHE_DIR || tmpdir();
  const cacheFile = join(cacheDir, `dg-${CK_CACHE_SCHEMA}-${computeQuickRepoFingerprint(root, gitHead)}.json`);
  const lockPath = `${cacheFile}.lock`;
  for (;;) {
    const hit = tryReadValidCache(cacheFile, root);
    if (hit) return hit;
    const state = tryAcquireExclusiveLock(lockPath);
    if (state === 'UNAVAILABLE') return computeFn();
    if (state === 'ACQUIRED') {
      try {
        return tryReadValidCache(cacheFile, root) || persistBuiltCache(cacheFile, computeFn);
      } finally {
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      }
    }
    Atomics.wait(CK_WAIT_SLICE, 0, 0, 25);
  }
}
