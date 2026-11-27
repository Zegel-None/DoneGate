// 调用边置信度分类器（L1 无头判定内核：直连导入、多跳桶重导出、两步转发与同契约作用域判定，<= 250 行）
import { readFileSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileBelongsToScopes } from './context-router.mjs';
import { loadContracts } from './gates.mjs';

const BARREL_REEXPORT_RE = /^export\s*(?:\*(?:\s+as\s+([A-Za-z_$][\w$]*))?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/gm;
const IMPORT_LIST_RE = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
const EXPORT_LIST_ONLY_RE = /^export\s*\{([^}]*)\}(?!\s*from\b)/gm;
const BARREL_EXT_PROBES = ['', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.mts', '/index.mjs', '/index.js', '/index.ts'];
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const TRUST_RANK = { proven: 3, 'same-contract': 2, inferred: 1 };
const BARREL_FILE_CACHE = new Map();

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}
function ownObjVal(obj, key) {
  return obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined;
}
function toSafeStrList(raw) {
  if (raw == null || typeof raw === 'string' || typeof raw[Symbol.iterator] !== 'function') return [];
  return [...raw].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}
function addBarrelName(map, target, name) {
  if (!target || !name) return;
  let set = map.get(target);
  if (!set) {
    set = new Set();
    map.set(target, set);
  }
  set.add(name);
}
function tryStatFile(abs) {
  try {
    const st = statSync(abs);
    return st.isFile() ? st : null;
  } catch (err) { void err; return null; }
}
function resolveRelativeModule(root, fromFile, spec) {
  if (!root || !spec || !spec.startsWith('.')) return '';
  const dir = posix.dirname(fromFile);
  const raw = posix.normalize(dir === '.' ? spec : `${dir}/${spec}`);
  if (raw.startsWith('..')) return '';
  const base = raw === '.' ? '' : raw.replace(/\/+$/, '');
  for (const ext of BARREL_EXT_PROBES) {
    const cand = base ? `${base}${ext}` : ext.replace(/^\//, '');
    if (cand && tryStatFile(resolve(root, cand))) return cand;
  }
  return '';
}
function collectSpecPairNames(part) {
  const cleaned = part.trim().replace(/^type\s+/, '').trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+as\s+/).slice(0, 2).map((x) => x.trim()).filter((x) => IDENT_RE.test(x));
}
function collectReexports(text, root, fromFile, out) {
  for (const m of text.matchAll(BARREL_REEXPORT_RE)) {
    const target = resolveRelativeModule(root, fromFile, m[3]);
    if (!target) continue;
    if (m[1]) addBarrelName(out, target, m[1]);
    else if (m[2] !== undefined) {
      for (const part of m[2].split(',')) {
        for (const name of collectSpecPairNames(part)) addBarrelName(out, target, name);
      }
    } else addBarrelName(out, target, '*');
  }
}
function parseNamedImports(text, root, fromFile) {
  const localMap = new Map();
  for (const m of text.matchAll(IMPORT_LIST_RE)) {
    const target = resolveRelativeModule(root, fromFile, m[2]);
    if (!target) continue;
    for (const part of m[1].split(',')) {
      const pair = collectSpecPairNames(part);
      if (pair.length > 0) localMap.set(pair[1] || pair[0], { target, imported: pair[0] });
    }
  }
  return localMap;
}
function collectTwoStepExports(text, localMap, out) {
  if (localMap.size === 0) return;
  for (const m of text.matchAll(EXPORT_LIST_ONLY_RE)) {
    for (const part of m[1].split(',')) {
      const pair = collectSpecPairNames(part);
      const hit = pair.length > 0 ? localMap.get(pair[0]) : null;
      if (!hit) continue;
      addBarrelName(out, hit.target, hit.imported);
      addBarrelName(out, hit.target, pair[0]);
      if (pair[1]) addBarrelName(out, hit.target, pair[1]);
    }
  }
}
function readFileBarrelForwards(root, relFile) {
  if (!root || !relFile) return null;
  const abs = resolve(root, relFile);
  const st = tryStatFile(abs);
  if (!st) return null;
  const hit = BARREL_FILE_CACHE.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.forwards;
  const forwards = new Map();
  try {
    const text = readFileSync(abs, 'utf8');
    collectReexports(text, root, relFile, forwards);
    collectTwoStepExports(text, parseNamedImports(text, root, relFile), forwards);
  } catch (err) { void err; }
  BARREL_FILE_CACHE.set(abs, { mtimeMs: st.mtimeMs, size: st.size, forwards });
  return forwards;
}
function getBarrelForwards(file, ctx) {
  const raw = ctx?.barrels instanceof Map ? ctx.barrels.get(file) : ownObjVal(ctx?.barrels, file);
  if (!raw || typeof raw !== 'object') return raw == null ? readFileBarrelForwards(ctx?.root, file) : new Map();
  const map = new Map();
  const entries = raw instanceof Map ? raw.entries() : Array.isArray(raw)
    ? raw.map((x) => [x?.target || x?.file || x?.to, x?.symbols ?? x?.names ?? (x?.symbol ? [x.symbol] : ['*'])])
    : Object.entries(raw);
  for (const [t, syms] of entries) {
    const nt = normPath(t);
    for (const s of toSafeStrList(syms)) addBarrelName(map, nt, s);
  }
  return map;
}
function stepBarrelNode(cur, target, symbol, ctx, visited, queue) {
  const forwards = getBarrelForwards(cur.file, ctx);
  if (!forwards || forwards.size === 0) return false;
  for (const [nextFile, names] of forwards) {
    if (symbol && !names.has('*') && !names.has(symbol)) continue;
    if (nextFile === target) return true;
    if (cur.hop < 4 && !visited.has(nextFile)) {
      visited.add(nextFile);
      queue.push({ file: nextFile, hop: cur.hop + 1 });
    }
  }
  return false;
}
function isBarrelForwarded(imp, target, symbol, ctx) {
  const visited = new Set([imp]);
  const queue = [{ file: imp, hop: 1 }];
  while (queue.length > 0) {
    if (stepBarrelNode(queue.shift(), target, symbol, ctx, visited, queue)) return true;
  }
  return false;
}
function resolveCtxContracts(ctx) {
  if (ctx?._contractsLoaded) return ctx._contracts || [];
  let contracts = Array.isArray(ctx?.contracts) ? ctx.contracts : [];
  if (!Array.isArray(ctx?.contracts) && ctx?.root) {
    try { contracts = (loadContracts(ctx.root)?.contracts || []).filter((c) => !c.retired); } catch (err) { void err; }
  }
  if (ctx && typeof ctx === 'object') {
    ctx._contracts = contracts;
    ctx._contractsLoaded = true;
  }
  return contracts;
}
function getFileOwners(file, ctx) {
  if (ctx?.ownerMap) {
    const raw = ctx.ownerMap instanceof Map ? ctx.ownerMap.get(file) : ownObjVal(ctx.ownerMap, file);
    return typeof raw === 'string' ? [raw.trim()].filter(Boolean) : toSafeStrList(raw);
  }
  return resolveCtxContracts(ctx).filter((c) => fileBelongsToScopes(file, c.scope || [])).map((c) => c.id);
}
function queryDirectImportsFromDb(db, project) {
  const map = new Map();
  if (typeof db?.prepare !== 'function') return map;
  try {
    const sql = project
      ? "SELECT DISTINCT s.file_path AS sf, t.file_path AS tf FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.project = ? AND s.project = ? AND t.project = ? AND e.type = 'IMPORTS' AND s.file_path != '' AND t.file_path != ''"
      : "SELECT DISTINCT s.file_path AS sf, t.file_path AS tf FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'IMPORTS' AND s.file_path != '' AND t.file_path != ''";
    const rows = project ? db.prepare(sql).all(project, project, project) : db.prepare(sql).all();
    for (const r of rows) addBarrelName(map, normPath(r.sf), normPath(r.tf));
  } catch (err) { void err; }
  return map;
}
function normalizeFileMap(raw, allowStr, mapItem = (x) => x) {
  if (!raw || typeof raw !== 'object') return null;
  const map = new Map();
  const isMap = raw instanceof Map;
  for (const k of isMap ? raw.keys() : Object.keys(raw)) {
    const nk = normPath(k);
    if (!nk) continue;
    const v = isMap ? raw.get(k) : raw[k];
    const items = allowStr && typeof v === 'string' ? [v.trim()].filter(Boolean) : toSafeStrList(v);
    for (const item of items) addBarrelName(map, nk, mapItem(item));
  }
  return map;
}

export function buildCallEdgeTrustContext(projectRoot, opts = {}) {
  const root = projectRoot ? resolve(projectRoot) : '';
  const db = opts.db || opts.handle?.db || null;
  const project = opts.project ?? opts.handle?.project ?? '';
  const directImports = opts.directImports
    ? (normalizeFileMap(opts.directImports, false, normPath) || new Map())
    : queryDirectImportsFromDb(db, project);
  const ownerMap = opts.ownerMap ? normalizeFileMap(opts.ownerMap, true) : null;
  return { root, directImports, barrels: opts.barrels || null, ownerMap, contracts: opts.contracts || null };
}

export function classifyCallEdge(callerFile, targetFile, symbol, ctx) {
  const caller = normPath(callerFile);
  const target = normPath(targetFile);
  if (!caller || !target) return 'inferred';
  if (caller === target) return 'proven';
  const rawImps = ctx?.directImports instanceof Map ? ctx.directImports.get(caller) : ownObjVal(ctx?.directImports, caller);
  const imps = rawImps instanceof Set ? rawImps : new Set(toSafeStrList(rawImps).map(normPath).filter(Boolean));
  if (imps.has(target)) return 'proven';
  const sym = String(symbol || '').trim();
  for (const imp of imps) {
    if (isBarrelForwarded(imp, target, sym, ctx)) return 'proven';
  }
  const callerOwners = getFileOwners(caller, ctx);
  if (callerOwners.length > 0 && callerOwners.some((id) => getFileOwners(target, ctx).includes(id))) {
    return 'same-contract';
  }
  return 'inferred';
}

export function pickBestCallEdgeTrust(callerFile, targetFile, symbols, ctx) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  if (list.length === 0) return classifyCallEdge(callerFile, targetFile, '', ctx);
  let best = 'inferred';
  for (const sym of list) {
    const t = classifyCallEdge(callerFile, targetFile, sym, ctx);
    if (TRUST_RANK[t] > TRUST_RANK[best]) best = t;
    if (best === 'proven') break;
  }
  return best;
}
