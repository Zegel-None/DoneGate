// 共享底座池只读探针：多层级 manifest.json 兼容解析、_shared/{npm,npm-cells} 包入口验真与磁盘实体库存扫描
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';

const MANIFEST_META_KEYS = new Set([
  'schema', 'schemaVersion', 'packId', 'workflowId', 'label', 'packName', 'updatedAt', 'generatedAt',
  'seq', 'refreshedAt', 'installed', 'deps', 'entries', 'items', 'tools', 'packages', 'note', 'version', 'summary'
]);
const SPP_CONTAINER_KEYS = ['tools', 'packages', 'items', 'entries', 'deps', 'installed'];
const SPP_ENTRY_SIGNAL_FIELDS = ['ready', 'status', 'state', 'bin', 'pkg', 'repo', 'dist', 'ref', 'sharedPool', 'detectedVersion', 'verified'];
const SPP_FALSE_STATUSES = new Set(['pending', 'missing-on-disk', 'version-mismatch', 'failed', 'error']);
const SPP_TRUE_STATUSES = new Set(['ready', 'ok', 'installed', 'verified', 'pass']);
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

function sppCollectNpmCellBases(root, pkgName) {
  const cellsRoot = join(root, 'workflows', '.deps', '_shared', 'npm-cells');
  if (!existsSync(cellsRoot)) return [];
  const out = [];
  const seen = new Set();
  const pushCell = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ scope: 'shared', base: join(cellsRoot, name, 'node_modules') });
  };
  const pkgTail = String(pkgName || '').split('/').pop();
  if (pkgTail) pushCell(sanitizePoolId(pkgTail));
  try {
    for (const ent of readdirSync(cellsRoot, { withFileTypes: true })) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) pushCell(ent.name);
    }
  } catch (err) { void err; }
  return out;
}

export function verifyInstalledNpmPackage(projectRoot, pkgName, packId = null) {
  if (!projectRoot || !pkgName) return { ok: false, reason: 'missing-pkg' };
  const root = resolve(projectRoot);
  const segs = String(pkgName).split('/').filter(Boolean);
  const candidates = [
    { scope: 'shared', base: join(root, 'workflows', '.deps', '_shared', 'npm', 'node_modules') },
    { scope: 'shared', base: join(root, 'workflows', '.deps', '_shared', 'node_modules') },
    ...sppCollectNpmCellBases(root, pkgName)
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
    const hasBinDecl = Boolean(r.value.bin && (typeof r.value.bin === 'string' || Object.keys(r.value.bin).length > 0));
    if (entryRel && !existsSync(entryAbs) && !hasBinDecl) continue;
    const effectiveEntry = existsSync(entryAbs) ? entryAbs : pkgJsonPath;
    return {
      ok: true, scope: cand.scope, pkg: pkgName, version: normDepVer(r.value.version || ''),
      exportsCount: r.value.exports && typeof r.value.exports === 'object' ? Object.keys(r.value.exports).length : 1,
      pkgJsonPath, entryPath: effectiveEntry,
      relPkgJson: normalizeSlashes(pkgJsonPath.slice(root.length).replace(/^[\\/]+/, '')),
      relEntry: normalizeSlashes(effectiveEntry.slice(root.length).replace(/^[\\/]+/, ''))
    };
  }
  return { ok: false, reason: 'not-found' };
}

function sppNormSlashTail(val) {
  const parts = normalizeSlashes(val).replace(/\.(?:exe|cmd|bat|com|ps1|sh)$/i, '').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function sppRegisterAlias(aliasIndex, token, entry) {
  const clean = String(token || '').trim().toLowerCase();
  if (!clean) return;
  if (!aliasIndex.has(clean)) aliasIndex.set(clean, entry);
  if (clean.startsWith('@')) return;
  const slashTail = sppNormSlashTail(clean);
  if (slashTail && !aliasIndex.has(slashTail)) aliasIndex.set(slashTail, entry);
}

function sppDetectVersionMismatch(rawVal, wantVer, hasDet, detVer, rawStatus) {
  if (rawStatus === 'version-mismatch') return true;
  if (wantVer && hasDet && wantVer !== detVer) return true;
  return /version\s*mismatch/i.test(String(rawVal.note || ''));
}

function sppResolveManifestStatus(rawVal) {
  const wantVer = normDepVer(rawVal.version || rawVal.expectedVersion || rawVal.pinnedVersion || '');
  const rawDet = rawVal.detectedVersion;
  const hasDet = rawDet !== undefined && rawDet !== null && String(rawDet).trim() !== '';
  const detVer = hasDet ? normDepVer(rawDet) : '';
  const rawStatus = String(rawVal.status || rawVal.state || '').trim().toLowerCase();
  const verMismatch = sppDetectVersionMismatch(rawVal, wantVer, hasDet, detVer, rawStatus);
  const explicitFalse = rawVal.ready === false || SPP_FALSE_STATUSES.has(rawStatus);
  const explicitTrue = rawVal.ready === true || SPP_TRUE_STATUSES.has(rawStatus);
  const ready = !verMismatch && !explicitFalse && explicitTrue;
  let fallbackStatus = 'pending';
  if (ready) fallbackStatus = 'ready';
  return {
    ready,
    verMismatch,
    status: verMismatch ? 'version-mismatch' : (rawStatus || fallbackStatus),
    version: wantVer || detVer || '',
    detectedVersion: detVer || (ready ? wantVer : '')
  };
}

function sppResolveSharedPoolFlag(rawVal) {
  if (rawVal.sharedPool === true || rawVal.sharedManifest) return true;
  let refStr = '';
  if (typeof rawVal.ref === 'string') refStr = rawVal.ref;
  else if (typeof rawVal.sharedRef === 'string') refStr = rawVal.sharedRef;
  return refStr.includes('_shared');
}

function sppIngestManifestEntry(hintKey, rawVal, entriesById, aliasIndex) {
  if (!rawVal || typeof rawVal !== 'object' || Array.isArray(rawVal)) return;
  const id = String(rawVal.id || rawVal.tool || rawVal.name || hintKey || '').trim();
  if (!id) return;
  const st = sppResolveManifestStatus(rawVal);
  const binRel = rawVal.bin ? normalizeSlashes(rawVal.bin) : '';
  const distRel = rawVal.dist ? normalizeSlashes(rawVal.dist) : '';
  const repoStr = rawVal.repo ? normalizeSlashes(rawVal.repo) : '';
  const pkgStr = String(rawVal.pkg || rawVal.package || '').trim();
  const verifyPath = rawVal.verifyPath ? normalizeSlashes(rawVal.verifyPath) : '';
  const entry = {
    ...rawVal,
    id,
    ready: st.ready,
    status: st.status,
    version: st.version,
    detectedVersion: st.detectedVersion,
    bin: binRel,
    dist: distRel,
    repo: repoStr,
    verifyPath,
    sharedPool: sppResolveSharedPoolFlag(rawVal),
    versionMismatch: st.verMismatch
  };
  if (pkgStr) entry.pkg = pkgStr;
  entriesById[id] = entry;
  for (const k of [id, hintKey, rawVal.tool, rawVal.binName, pkgStr, binRel, repoStr]) {
    sppRegisterAlias(aliasIndex, k, entry);
  }
}

function sppIngestContainer(container, entriesById, aliasIndex) {
  if (!container || typeof container !== 'object') return;
  if (Array.isArray(container)) {
    for (const item of container) sppIngestManifestEntry('', item, entriesById, aliasIndex);
    return;
  }
  for (const [k, v] of Object.entries(container)) {
    sppIngestManifestEntry(k, v, entriesById, aliasIndex);
  }
}

function sppLookupAlias(aliasIndex, candidates = []) {
  for (const c of candidates) {
    const clean = String(c || '').trim().toLowerCase();
    if (!clean) continue;
    if (aliasIndex.has(clean)) return aliasIndex.get(clean);
    if (clean.startsWith('@')) continue;
    const tail = sppNormSlashTail(clean);
    if (tail && aliasIndex.has(tail)) return aliasIndex.get(tail);
  }
  return null;
}

export function parseFlexibleDepsManifest(rawDoc) {
  const entriesById = {};
  const aliasIndex = new Map();
  if (!rawDoc || typeof rawDoc !== 'object') {
    return { entriesById, topLabel: '', lookup: () => null };
  }
  for (const key of SPP_CONTAINER_KEYS) {
    sppIngestContainer(rawDoc[key], entriesById, aliasIndex);
  }
  for (const [k, v] of Object.entries(rawDoc)) {
    if (MANIFEST_META_KEYS.has(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    if (SPP_ENTRY_SIGNAL_FIELDS.some((f) => f in v)) {
      sppIngestManifestEntry(k, v, entriesById, aliasIndex);
    }
  }
  return {
    entriesById,
    topLabel: String(rawDoc.label || '').trim(),
    lookup: (candidates = []) => sppLookupAlias(aliasIndex, candidates)
  };
}

function sppScanNpmCellsMap(sharedDir) {
  const cellMap = new Map();
  const cellsDir = join(sharedDir, 'npm-cells');
  if (!existsSync(cellsDir)) return cellMap;
  try {
    for (const ent of readdirSync(cellsDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const pj = readJsonStrict(join(cellsDir, ent.name, 'package.json'));
      const deps = (pj.ok && pj.value && pj.value.dependencies && typeof pj.value.dependencies === 'object') ? pj.value.dependencies : {};
      const firstPkg = Object.keys(deps)[0] || '';
      const rawVer = firstPkg ? normDepVer(String(deps[firstPkg] || '').replace(/^[~^]/, '')) : '';
      cellMap.set(ent.name.toLowerCase(), { cellId: ent.name, version: rawVer, relCell: `workflows/.deps/_shared/npm-cells/${ent.name}` });
    }
  } catch (err) { void err; }
  return cellMap;
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
  const cellMap = sppScanNpmCellsMap(sharedDir);

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
      const distInfo = distMap.get(key) || null, cellInfo = cellMap.get(key) || null, hasRepo = repoSet.has(key);
      const runnable = platform === 'win32' ? g.hasWin : (g.hasPosix || (g.hasWin && Boolean(distInfo || cellInfo || hasRepo)));
      if (!runnable) continue;
      const chosenFile = platform === 'win32' ? g.winFile : (g.posixFile || g.winFile);
      byKey.set(key, {
        id: g.id, key, ready: true, version: distInfo?.version || cellInfo?.version || '',
        relBin: `workflows/.deps/_shared/.bin/${chosenFile}`,
        canonicalRelBin: `workflows/.deps/_shared/.bin/${g.id}`,
        relDist: distInfo?.relDist || cellInfo?.relCell || '',
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
