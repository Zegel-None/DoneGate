// Windows (win32) 优先跨平台路径、DSH_HOME 探测与安全资源管理器定位原语（零第三方依赖，<= 200 行）
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path, { join, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeSlashes(rawPath) {
  return String(rawPath || '').replace(/\\/g, '/');
}

export function normalizeLf(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function toCrlf(text) {
  return normalizeLf(text).replace(/\n/g, '\r\n');
}

export function resolveDshHome(env = process.env, platform = process.platform) {
  const explicit = String(env?.DSH_HOME || '').trim();
  if (explicit) {
    return platform === 'win32' ? win32.normalize(explicit) : resolve(explicit);
  }
  if (platform === 'win32') {
    const profileHome = String(env?.USERPROFILE || '').trim() ||
      (env?.HOMEDRIVE && env?.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : '') ||
      String(env?.HOME || '').trim() ||
      win32.join(String(env?.SystemDrive || 'C:'), 'Users', 'Default');
    return win32.join(profileHome, '.dsh');
  }
  const unixHome = String(env?.HOME || env?.USERPROFILE || '/tmp').trim();
  return posix.join(normalizeSlashes(unixHome), '.dsh');
}

export function resolveDshProfileDir(profileName = 'web', env = process.env, platform = process.platform) {
  const safeProfile = String(profileName || 'web').trim().replace(/[^A-Za-z0-9_-]/g, '') || 'web';
  const home = resolveDshHome(env, platform);
  return platform === 'win32'
    ? win32.join(home, 'profiles', safeProfile)
    : posix.join(normalizeSlashes(home), 'profiles', safeProfile);
}

export function toSafeFileUrl(absPath) {
  const raw = String(absPath || '').trim();
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    const clean = win32.resolve(raw).replace(/\\/g, '/');
    return `file:///${encodeURI(clean).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  }
  return pathToFileURL(resolve(raw)).href;
}

export function normalizeWinDriveKey(rawPath) {
  const clean = normalizeSlashes(rawPath).replace(/\/+$/, '');
  return /^[a-z]:(?=\/|$)/.test(clean) ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

export function buildDshFileResourceAddress(sessionId, projectRoot, targetRelOrAbs) {
  const sid = encodeURIComponent(String(sessionId || '').trim());
  const rootPosix = normalizeSlashes(projectRoot).replace(/\/+$/, '');
  const rawPosix = normalizeSlashes(targetRelOrAbs).replace(/^\.\//, '');
  let rel = rawPosix;
  if (rawPosix.startsWith(rootPosix + '/')) {
    rel = rawPosix.slice(rootPosix.length + 1);
  } else if (/^[A-Za-z]:\//.test(rootPosix) && rawPosix.toLowerCase().startsWith(rootPosix.toLowerCase() + '/')) {
    rel = rawPosix.slice(rootPosix.length + 1);
  }
  const safeSegments = [];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      safeSegments.pop();
      continue;
    }
    safeSegments.push(encodeURIComponent(seg));
  }
  return `dsh-resource://file/session/${sid}/${safeSegments.join('/')}`;
}

export function openInWindowsOrHostExplorer(targetPath, platform = process.platform) {
  const raw = String(targetPath || '').trim();
  if (!raw) return false;
  try {
    if (platform === 'win32') {
      const winTarget = win32.normalize(raw);
      const child = spawn('explorer.exe', [winTarget], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      return true;
    }
    if (!existsSync(raw)) return false;
    const cmd = platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(cmd, [raw], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

export function findDshExecutable(env = process.env, platform = process.platform) {
  const pathRaw = String(env?.PATH || env?.Path || '');
  const sep = platform === 'win32' ? ';' : ':';
  const candidates = platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh'] : ['dsh'];
  for (const dir of pathRaw.split(sep).map((s) => s.trim()).filter(Boolean)) {
    for (const bin of candidates) {
      const full = platform === 'win32' ? win32.join(dir, bin) : join(dir, bin);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

export function buildWinCmdSpawn(binPath, args = []) {
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const cmdLine = `"${esc(binPath)}${args.length ? " " + args.map(esc).join(" ") : ""}"`;
  return { cmd: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", cmdLine], extraOpts: { windowsVerbatimArguments: true, windowsHide: true } };
}

export function resolveSafeWorkspaceFolders(projectRoot, requestedPaths, pathMod = path) {
  const root = pathMod.resolve(projectRoot);
  const list = Array.isArray(requestedPaths) ? requestedPaths : [];
  const resolved = [];
  for (const raw of list.slice(0, 16)) {
    const clean = String(raw || "").trim().replace(/\\/g, "/");
    if (!clean) continue;
    const candidate = pathMod.resolve(root, clean);
    const rawRel = pathMod.relative(root, candidate);
    const relToRoot = rawRel.replace(/\\/g, "/");
    if (pathMod.isAbsolute(rawRel) || /^[A-Za-z]:/.test(relToRoot) || relToRoot === ".." || relToRoot.startsWith("../") || relToRoot.includes("/../")) {
      resolved.push({ requested: clean, absPath: null, exists: false, blocked: true });
      continue;
    }
    let targetDir = candidate;
    let exists = existsSync(candidate);
    if (exists) {
      try { if (!statSync(candidate).isDirectory()) targetDir = pathMod.dirname(candidate); } catch (err) { void err; }
    } else if (existsSync(pathMod.dirname(candidate))) {
      targetDir = pathMod.dirname(candidate);
      exists = true;
    }
    resolved.push({ requested: clean, absPath: targetDir, exists, blocked: false });
  }
  return resolved;
}
