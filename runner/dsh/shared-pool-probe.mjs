// 共享底座池只读探针：多层级 manifest.json 兼容解析、_shared/npm 包入口验真与磁盘实体库存扫描
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';

const MANIFEST_META_KEYS = new Set([
  'schema', 'schemaVersion', 'packId', 'workflowId', 'label', 'packName', 'updatedAt', 'generatedAt',
  'seq', 'refreshedAt', 'installed', 'deps', 'entries', 'items', 'tools', 'packages', 'note', 'version', 'summary'
]);
const sanitizePoolId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
const normDepVer = (v) => String(v ?? '').trim().replace(/^v/i, '');

function pickPackageExportEntry(pkgJson) {
  const findStr = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      for (const k of ['import', 'default', 'node', 'browser', 'require', '.']) {
        if (k in v) { const hit = findStr(v[k]); if (hit) return hit; }
      }
      for (const sub of Object.values(v)) { const hit = findStr(sub); if (hit) return hit; }
    }
    return '';
  };
  return String(findStr(pkgJson?.exports) || pkgJson?.module || pkgJson?.main || '').trim().replace(/^\.\//, '');
}

export function verifyInstalledNpmPackage(projectRoot, pkgName, packId = null) {
  if (!projectRoot || !pkgName) return { ok: false, reason: 'missing-pkg' };
  const root = resolve(projectRoot);
  const segs = String(pkgName).split('/').filter(Boolean);
  const candidates = [
    { scope: 'shared', base: join(root, 'workflows', '.deps', '_shared', 'npm', 'node_modules') },
    { scope: 'shared', base: join(root, 'workflows', '.deps', '_shared', 'node_modules') }
  ];
  if (packId && packId !== '_shared') {
    const safeId = sanitizePoolId(packId);
    candidates.unshift(
      { scope: 'workflow', base: join(root, 'workflows', '.deps', safeId, 'npm', 'node_modules') },
      { scope: 'workflow', base: join(root, 'workflows', '.deps', safeId, 'node_modules') }
    );
  }
  for (const cand of candidates) {
    const pkgDir = join(cand.base, ...segs), pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const r = readJsonStrict(pkgJsonPath);
    if (!r.ok || !r.value) continue;
    const entryRel = pickPackageExportEntry(r.value);
    const entryAbs = entryRel ? resolve(pkgDir, entryRel) : pkgJsonPath;
    if (entryRel && !existsSync(entryAbs)) continue;
    return {
      ok: true, scope: cand.scope, pkg: pkgName, version: normDepVer(r.value.version || ''),
      exportsCount: r.value.exports && typeof r.value.exports === 'object' ? Object.keys(r.value.exports).length : 1,
      pkgJsonPath, entryPath: entryAbs,
      relPkgJson: normalizeSlashes(pkgJsonPath.slice(root.length).replace(/^[\\/]+/, '')),
      relEntry: normalizeSlashes(entryAbs.slice(root.length).replace(/^[\\/]+/, ''))
    };
  }
  return { ok: false, reason: 'not-found' };
}

export function parseFlexibleDepsManifest(rawDoc) {
  const entriesById = {}, aliasIndex = new Map();
  if (!rawDoc || typeof rawDoc !== 'object') return { entriesById, topLabel: '', lookup: () => null };

  const normSlashTail = (val) => {
    const parts = normalizeSlashes(val).replace(/\.(?:exe|cmd|bat|com|ps1|sh)$/i, '').split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '';
  };
  const registerAlias = (token, entry) => {
    const clean = String(token || '').trim().toLowerCase();
    if (!clean) return;
    if (!aliasIndex.has(clean)) aliasIndex.set(clean, entry);
    const slashTail = normSlashTail(clean);
    if (slashTail && !aliasIndex.has(slashTail)) aliasIndex.set(slashTail, entry);
  };

  const ingestOne = (hintKey, rawVal) => {
    if (!rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) return;
    const id = String(rawVal.id || rawVal.tool || rawVal.name || hintKey || '').trim();
    if (!id) return;
    const wantVer = normDepVer(rawVal.version || rawVal.expectedVersion || rawVal.pinnedVersion || '');
    const hasDet = rawVal.detectedVersion !== undefined && rawVal.detectedVersion !== null && String(rawVal.detectedVersion).trim() !== '';
    const detVer = hasDet ? normDepVer(rawVal.detectedVersion) : '';
    const rawStatus = String(rawVal.status || rawVal.state || '').trim().toLowerCase();
    const verMismatch = rawStatus === 'version-mismatch' || Boolean(wantVer && hasDet && (!detVer || wantVer !== detVer)) || /version\s*mismatch/i.test(String(rawVal.note || ''));
    const explicitFalse = rawVal.ready === false || ['pending', 'missing-on-disk', 'version-mismatch', 'failed', 'error'].includes(rawStatus);
    const explicitTrue = rawVal.ready === true || ['ready', 'ok', 'installed', 'verified', 'pass'].includes(rawStatus);
    const ready = !verMismatch && !explicitFalse && explicitTrue;
    const refStr = typeof rawVal.ref === 'string' ? rawVal.ref : (typeof rawVal.sharedRef === 'string' ? rawVal.sharedRef : '');
    const sharedPool = Boolean(rawVal.sharedPool === true || rawVal.sharedManifest || refStr.includes('_shared'));
    const binRel = rawVal.bin ? normalizeSlashes(rawVal.bin) : '';
    const distRel = rawVal.dist ? normalizeSlashes(rawVal.dist) : '';
    const repoStr = rawVal.repo ? normalizeSlashes(rawVal.repo) : '';
    const pkgStr = String(rawVal.pkg || rawVal.package || '').trim();
    const entry = {
      ...rawVal, id, ready,
      status: verMismatch ? 'version-mismatch' : (rawStatus || (ready ? 'ready' : 'pending')),
      version: wantVer || detVer || '',
      detectedVersion: detVer || (ready ? wantVer : ''),
      bin: binRel, dist: distRel, repo: repoStr, ...(pkgStr ? { pkg: pkgStr } : {}),
      verifyPath: rawVal.verifyPath ? normalizeSlashes(rawVal.verifyPath) : '',
      sharedPool, versionMismatch: verMismatch
    };
    entriesById[id] = entry;
    for (const k of [id, hintKey, rawVal.tool, rawVal.binName, pkgStr, binRel, repoStr]) registerAlias(k, entry);
  };

  const ingestContainer = (container) => {
    if (!container) return;
    if (Array.isArray(container)) { for (const item of container) ingestOne('', item); }
    else if (typeof container === 'object') { for (const [k, v] of Object.entries(container)) ingestOne(k, v); }
  };

  for (const key of ['tools', 'packages', 'items', 'entries', 'deps', 'installed']) ingestContainer(rawDoc[key]);
  for (const [k, v] of Object.entries(rawDoc)) {
    if (MANIFEST_META_KEYS.has(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (['ready', 'status', 'state', 'bin', 'pkg', 'repo', 'dist', 'ref', 'sharedPool', 'detectedVersion', 'verified'].some((f) => f in v)) ingestOne(k, v);
  }

  const lookup = (candidates = []) => {
    for (const c of candidates) {
      const clean = String(c || '').trim().toLowerCase();
      if (!clean) continue;
      if (aliasIndex.has(clean)) return aliasIndex.get(clean);
      const tail = normSlashTail(clean);
      if (tail && aliasIndex.has(tail)) return aliasIndex.get(tail);
    }
    return null;
  };
  return { entriesById, topLabel: String(rawDoc.label || '').trim(), lookup };
}

export function scanSharedPoolDiskInventory(projectRoot, platform = process.platform) {
  const root = resolve(projectRoot), sharedDir = join(root, 'workflows', '.deps', '_shared');
  const binDir = join(sharedDir, '.bin'), distsDir = join(sharedDir, 'dists'), reposDir = join(sharedDir, 'repos');
  const byKey = new Map();
  if (!existsSync(sharedDir)) return { exists: false, tools: [], lookup: () => null };

  const distMap = new Map();
  if (existsSync(distsDir)) {
    try {
      for (const ent of readdirSync(distsDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const m = ent.name.match(/^([A-Za-z0-9._-]+?)-v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/);
        if (m) distMap.set(m[1].toLowerCase(), { distSubdir: ent.name, version: m[2], relDist: `workflows/.deps/_shared/dists/${ent.name}` });
        else distMap.set(ent.name.toLowerCase(), { distSubdir: ent.name, version: '', relDist: `workflows/.deps/_shared/dists/${ent.name}` });
      }
    } catch (err) { void err; }
  }

  const repoSet = new Set();
  if (existsSync(reposDir)) {
    try {
      for (const ent of readdirSync(reposDir, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const full = join(reposDir, ent.name);
        if (existsSync(join(full, '.git')) || readdirSync(full).length > 0) repoSet.add(ent.name.toLowerCase());
      }
    } catch (err) { void err; }
  }

  if (existsSync(binDir)) {
    const grouped = new Map();
    try {
      for (const ent of readdirSync(binDir, { withFileTypes: true })) {
        if (ent.name.startsWith('.')) continue;
        const ext = extname(ent.name).toLowerCase(), isWinExt = ['.exe', '.cmd', '.bat', '.com', '.ps1'].includes(ext);
        const stem = isWinExt ? ent.name.slice(0, -ext.length) : ent.name, key = stem.toLowerCase();
        const cur = grouped.get(key) || { id: stem, hasPosix: false, hasWin: false, winFile: null, posixFile: null };
        if (isWinExt) { cur.hasWin = true; if (!cur.winFile || ext === '.bat' || ext === '.exe') cur.winFile = ent.name; }
        else { cur.hasPosix = true; cur.posixFile = ent.name; }
        grouped.set(key, cur);
      }
    } catch (err) { void err; }

    for (const [key, g] of grouped.entries()) {
      const distInfo = distMap.get(key) || null, hasRepo = repoSet.has(key);
      const runnable = platform === 'win32' ? g.hasWin : (g.hasPosix || (g.hasWin && Boolean(distInfo || hasRepo)));
      if (!runnable) continue;
      const chosenFile = platform === 'win32' ? g.winFile : (g.posixFile || g.winFile);
      byKey.set(key, {
        id: g.id, key, ready: true, version: distInfo?.version || '',
        relBin: `workflows/.deps/_shared/.bin/${chosenFile}`,
        canonicalRelBin: `workflows/.deps/_shared/.bin/${g.id}`,
        relDist: distInfo?.relDist || '',
        relRepo: hasRepo ? `workflows/.deps/_shared/repos/${g.id}` : ''
      });
    }
  }

  const lookup = (candidates = []) => {
    for (const c of candidates) {
      const raw = normalizeSlashes(String(c || '').trim()).toLowerCase();
      if (!raw) continue;
      if (byKey.has(raw)) return byKey.get(raw);
      const tail = raw.replace(/\.(?:exe|cmd|bat|com|ps1|sh)$/i, '').split('/').filter(Boolean).pop();
      if (tail && byKey.has(tail)) return byKey.get(tail);
    }
    return null;
  };
  return { exists: true, tools: [...byKey.values()], lookup };
}
