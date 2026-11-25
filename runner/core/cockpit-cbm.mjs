// 开源代码知识图谱单底座桥接器（对接 MIT 协议 codebase-memory-mcp 持久化 SQLite、FTS5 与调用枢纽，<= 350 行）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { sha256 } from '../../skill/hash.mjs';
import { readJsonStrict } from '../../skill/io.mjs';
import { computeQuickRepoFingerprint, tryAcquireExclusiveLock } from './cockpit-cache.mjs';

const CBM_WAIT_SLICE = new Int32Array(new SharedArrayBuffer(4));
const CBM_MEM_CACHE = new Map();
let cachedSqliteCtor = undefined;

// Satopää et al. (2011) Kneedle 无参最大曲率拐点（均匀分布返回 0，绝不硬凑假中心）
export function kneedleElbowCount(sortedDescWeights) {
  const pos = (sortedDescWeights || []).filter((w) => w > 0);
  const n = pos.length;
  if (n <= 1) return n;
  const sum = pos.reduce((a, b) => a + b, 0);
  let cum = 0, maxDiff = 0, knee = 0;
  for (let i = 0; i < n; i++) {
    cum += pos[i];
    const diff = (cum / sum) - ((i + 1) / n);
    if (diff > maxDiff + 1e-9) {
      maxDiff = diff;
      knee = i + 1;
    }
  }
  return knee;
}

function loadDatabaseSyncCtor() {
  if (cachedSqliteCtor !== undefined) return cachedSqliteCtor;
  const origEmit = process.emitWarning;
  process.emitWarning = function suppressExperimentalSqlite(warning, ...rest) {
    const msg = typeof warning === 'string' ? warning : warning?.message || '';
    if (msg.includes('SQLite')) return;
    return origEmit.call(this, warning, ...rest);
  };
  try {
    cachedSqliteCtor = createRequire(import.meta.url)('node:sqlite')?.DatabaseSync || null;
  } catch {
    cachedSqliteCtor = null;
  }
  return cachedSqliteCtor;
}

export function resolveCbmBinary(projectRoot) {
  const envBin = process.env.DONEGATE_CBM_BIN;
  if (envBin && existsSync(envBin)) return envBin;
  const exe = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  if (projectRoot) {
    const sharedBin = join(resolve(projectRoot), 'workflows', '.deps', '_shared', '.bin', exe);
    if (existsSync(sharedBin)) return sharedBin;
  }
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const cand = join(dir, exe);
    if (existsSync(cand)) return cand;
  }
  return null;
}

function readValidSlotReady(readyFile, fp) {
  if (!existsSync(readyFile)) return null;
  const doc = readJsonStrict(readyFile);
  return (doc.ok && doc.value?.fp === fp && doc.value?.dbPath && existsSync(doc.value.dbPath)) ? doc.value : null;
}

function locateProjectSqliteFile(slotDir, stdoutText) {
  const firstBrace = stdoutText.indexOf('{');
  if (firstBrace >= 0) {
    try {
      const parsed = JSON.parse(stdoutText.slice(firstBrace).split(/\r?\n/)[0]);
      const byName = parsed?.project ? join(slotDir, `${parsed.project}.db`) : '';
      if (byName && existsSync(byName)) return { project: parsed.project, dbPath: byName };
    } catch { /* fall through */ }
  }
  const dbName = readdirSync(slotDir).find((f) => f.endsWith('.db') && f !== '_config.db' && f !== 'activity.db');
  return dbName ? { project: dbName.slice(0, -3), dbPath: join(slotDir, dbName) } : null;
}

function runCbmIndexSync(bin, root, slotDir, readyFile, fp) {
  mkdirSync(slotDir, { recursive: true });
  const r = spawnSync(bin, ['cli', '--quiet', 'index_repository', JSON.stringify({ repo_path: root })], {
    cwd: root, env: { ...process.env, CBM_CACHE_DIR: slotDir }, encoding: 'utf8', timeout: 60000
  });
  if (r.error || r.status !== 0) return null;
  const found = locateProjectSqliteFile(slotDir, r.stdout || '');
  if (!found) return null;
  const payload = { fp, project: found.project, dbPath: found.dbPath };
  const tmpFile = `${readyFile}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(payload), 'utf8');
  renameSync(tmpFile, readyFile);
  return payload;
}

export function openCbmGraphHandle(projectRoot) {
  const DatabaseSync = loadDatabaseSyncCtor();
  const bin = resolveCbmBinary(projectRoot);
  if (!DatabaseSync || !bin || !existsSync(projectRoot)) return null;
  const root = realpathSync(resolve(projectRoot));
  const fp = computeQuickRepoFingerprint(root);
  const memKey = `${root}|${fp}`;
  if (CBM_MEM_CACHE.has(memKey)) return CBM_MEM_CACHE.get(memKey);

  const baseDir = process.env.DONEGATE_CBM_CACHE_DIR || join(tmpdir(), 'donegate-cbm-v1');
  mkdirSync(baseDir, { recursive: true });
  const slotKey = sha256(root).slice(0, 16);
  const slotDir = join(baseDir, `repo-${slotKey}`);
  const readyFile = join(slotDir, 'dg-ready.json');
  const lockPath = join(baseDir, `repo-${slotKey}.lock`);

  let ready = readValidSlotReady(readyFile, fp);
  while (!ready) {
    const st = tryAcquireExclusiveLock(lockPath);
    if (st === 'UNAVAILABLE') return null;
    if (st === 'ACQUIRED') {
      try {
        ready = readValidSlotReady(readyFile, fp) || runCbmIndexSync(bin, root, slotDir, readyFile, fp);
      } finally {
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      }
      break;
    }
    Atomics.wait(CBM_WAIT_SLICE, 0, 0, 25);
    ready = readValidSlotReady(readyFile, fp);
  }
  if (!ready) return null;
  try {
    const db = new DatabaseSync(ready.dbPath, { open: true, readOnly: true });
    const handle = { db, project: ready.project, dbPath: ready.dbPath, root, fp };
    CBM_MEM_CACHE.set(memKey, handle);
    return handle;
  } catch {
    return null;
  }
}

function parseJsonProps(raw) {
  if (!raw || raw === '{}') return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function getCbmGraphSummary(projectRoot) {
  const h = openCbmGraphHandle(projectRoot);
  if (!h) return { available: false, engine: 'codebase-memory-mcp', totalNodes: 0, totalEdges: 0, byLabel: {} };
  const labelRows = h.db.prepare('SELECT label, COUNT(*) AS cnt FROM nodes GROUP BY label').all();
  const edgeRow = h.db.prepare('SELECT COUNT(*) AS cnt FROM edges').get();
  const byLabel = {};
  let totalNodes = 0;
  for (const r of labelRows) {
    byLabel[r.label] = Number(r.cnt);
    totalNodes += Number(r.cnt);
  }
  return { available: true, engine: 'codebase-memory-mcp v0.12.1 (MIT)', totalNodes, totalEdges: Number(edgeRow?.cnt || 0), byLabel };
}

export function queryCbmFileGraph(projectRoot, relFile) {
  const h = openCbmGraphHandle(projectRoot);
  const norm = String(relFile || '').replace(/\\/g, '/');
  if (!h || !norm) return null;
  const symRows = h.db.prepare(
    "SELECT name, label, start_line, end_line, properties FROM nodes WHERE file_path = ? AND label IN ('Function', 'Variable') ORDER BY start_line ASC, id ASC"
  ).all(norm);
  const symbols = symRows.map((r) => {
    const p = parseJsonProps(r.properties);
    return {
      name: r.name, label: r.label, startLine: Number(r.start_line || 0), endLine: Number(r.end_line || 0),
      isExported: Boolean(p.is_exported), signature: p.signature || '', cognitive: Number(p.cognitive || 0)
    };
  });
  const impRows = h.db.prepare(
    "SELECT DISTINCT t.file_path AS file, t.name AS name FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'IMPORTS' AND s.file_path = ? AND t.file_path != '' ORDER BY t.file_path"
  ).all(norm);
  const inRows = h.db.prepare(
    "SELECT s.file_path AS file, s.name AS symbol, MIN(CAST(coalesce(json_extract(e.properties,'$.line'), 0) AS INTEGER)) AS line FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'CALLS' AND t.file_path = ? AND s.file_path != '' AND s.file_path != ? GROUP BY s.file_path, s.name ORDER BY s.file_path, s.name"
  ).all(norm, norm);
  const outRows = h.db.prepare(
    "SELECT DISTINCT t.file_path AS file, t.name AS symbol, t.start_line AS targetLine FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'CALLS' AND s.file_path = ? AND t.file_path != '' AND t.file_path != ? ORDER BY t.file_path, t.name"
  ).all(norm, norm);
  const spawnRows = h.db.prepare(
    "SELECT t.name AS program, MIN(CAST(coalesce(json_extract(e.properties,'$.line'), 0) AS INTEGER)) AS line FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'SPAWNS' AND s.file_path = ? AND t.name != '<dynamic>' GROUP BY t.name ORDER BY t.name"
  ).all(norm);
  const httpRows = h.db.prepare(
    "SELECT DISTINCT t.name AS route FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'HTTP_CALLS' AND s.file_path = ? ORDER BY t.name"
  ).all(norm);
  const docRows = h.db.prepare(
    "SELECT DISTINCT s.file_path AS docFile, s.label AS docLabel, s.name AS title FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type IN ('REFERENCES_FILE', 'MENTIONS') AND t.file_path = ? AND s.file_path LIKE '%.md' ORDER BY s.file_path"
  ).all(norm);
  return {
    symbols,
    imports: impRows.map((r) => r.file || r.name).filter(Boolean),
    inboundCallers: inRows.map((r) => ({ file: r.file, symbol: r.symbol, line: Number(r.line || 0) })),
    outboundCallees: outRows.map((r) => ({ file: r.file, symbol: r.symbol, targetLine: Number(r.targetLine || 0) })),
    spawns: spawnRows.map((r) => ({ program: r.program, line: Number(r.line || 0) })),
    httpRoutes: httpRows.map((r) => r.route).filter(Boolean),
    docMentions: docRows.map((r) => ({ docFile: r.docFile, docLabel: r.docLabel, title: r.title }))
  };
}

function collectTwoHopCalls(db, seedIds, direction) {
  if (seedIds.length === 0) return [];
  const sql = direction === 'in'
    ? "SELECT s.id, s.name, s.file_path, s.start_line, s.end_line FROM edges e JOIN nodes s ON e.source_id = s.id WHERE e.type = 'CALLS' AND e.target_id = ? AND s.file_path != ''"
    : "SELECT t.id, t.name, t.file_path, t.start_line, t.end_line FROM edges e JOIN nodes t ON e.target_id = t.id WHERE e.type = 'CALLS' AND e.source_id = ? AND t.file_path != ''";
  const stmt = db.prepare(sql);
  const visited = new Set(seedIds), out = [];
  let frontier = [...seedIds];
  for (let hop = 1; hop <= 2; hop++) {
    const next = [];
    for (const nid of frontier) {
      for (const r of stmt.all(nid)) {
        if (visited.has(r.id)) continue;
        visited.add(r.id);
        next.push(r.id);
        out.push({ hop, name: r.name, file: r.file_path, startLine: Number(r.start_line || 0), endLine: Number(r.end_line || 0) });
      }
    }
    frontier = next;
  }
  return out;
}

function queryCbmFtsFallback(db, term) {
  const words = term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9\u4e00-\u9fff]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  const ftsQuery = words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');
  try {
    return db.prepare(
      "SELECT n.id, n.name, n.label, n.file_path, n.start_line, n.end_line, n.properties FROM nodes_fts f JOIN nodes n ON n.id = f.rowid WHERE nodes_fts MATCH ? AND n.label IN ('Function', 'Variable', 'Route', 'File') AND (n.file_path != '' OR n.label = 'Route') ORDER BY bm25(nodes_fts) ASC LIMIT 12"
    ).all(ftsQuery);
  } catch {
    return [];
  }
}

export function queryCbmSymbolTrace(projectRoot, queryTerm) {
  const h = openCbmGraphHandle(projectRoot);
  const term = String(queryTerm || '').trim();
  if (!h || !term) return null;
  let defs = h.db.prepare(
    "SELECT id, name, label, file_path, start_line, end_line, properties FROM nodes WHERE name = ? AND label IN ('Function', 'Variable', 'Route') AND (file_path != '' OR label = 'Route') ORDER BY start_line ASC"
  ).all(term);
  if (defs.length === 0) {
    defs = h.db.prepare(
      "SELECT id, name, label, file_path, start_line, end_line, properties FROM nodes WHERE name LIKE ? AND label IN ('Function', 'Variable', 'Route') AND (file_path != '' OR label = 'Route') ORDER BY length(name) ASC, start_line ASC LIMIT 20"
    ).all(`%${term}%`);
  }
  if (defs.length === 0) defs = queryCbmFtsFallback(h.db, term);
  if (defs.length === 0) return null;
  const fnIds = defs.filter((d) => d.label === 'Function').map((d) => d.id);
  return {
    definitions: defs.map((d) => ({
      name: d.name, label: d.label, file: d.file_path,
      startLine: Number(d.start_line || 0), endLine: Number(d.end_line || 0),
      signature: parseJsonProps(d.properties).signature || ''
    })),
    callers: collectTwoHopCalls(h.db, fnIds, 'in'),
    callees: collectTwoHopCalls(h.db, fnIds, 'out')
  };
}

export function queryCbmContractHubs(projectRoot, ownerMap, groupIds, isZeroContract) {
  const h = openCbmGraphHandle(projectRoot);
  if (!h) return { uniqueSymbolCount: 0, hubsByContract: {}, hubsByDomain: {} };
  const rows = h.db.prepare(
    "SELECT t.id, t.file_path AS file, t.name AS symbol, t.properties AS props, s.file_path AS callerFile FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'CALLS' AND t.label = 'Function' AND t.file_path != '' AND s.file_path != '' AND s.file_path != t.file_path"
  ).all();
  const byFn = new Map();
  for (const r of rows) {
    const owners = ownerMap.get(r.file) || [];
    if (owners.length === 0) continue;
    let rec = byFn.get(r.id);
    if (!rec) {
      const sig = parseJsonProps(r.props).signature || '()';
      rec = { file: r.file, symbol: r.symbol, signature: `${r.symbol}${sig}`, owners, callerFiles: new Set(), crossGroups: new Set() };
      byFn.set(r.id, rec);
    }
    rec.callerFiles.add(r.callerFile);
    for (const so of ownerMap.get(r.callerFile) || []) {
      if (so && !owners.includes(so)) rec.crossGroups.add(so);
    }
  }
  const hubsMap = {};
  for (const gid of groupIds) {
    const mine = [...byFn.values()].filter((x) => x.owners.includes(gid)).map((x) => ({
      signature: x.signature, extFiles: x.callerFiles.size, crossContracts: [...x.crossGroups]
    }));
    const crossList = mine.filter((s) => s.crossContracts.length > 0).sort((a, b) => (b.crossContracts.length * b.extFiles) - (a.crossContracts.length * a.extFiles) || b.extFiles - a.extFiles);
    const crossKnee = kneedleElbowCount(crossList.map((s) => s.crossContracts.length * s.extFiles));
    const selectedCross = crossList.slice(0, crossKnee);
    const intraList = mine.filter((s) => s.crossContracts.length === 0 && s.extFiles > 0).sort((a, b) => b.extFiles - a.extFiles);
    const intraKnee = selectedCross.length <= 1 ? kneedleElbowCount(intraList.map((s) => s.extFiles)) : 0;
    hubsMap[gid] = {
      totalExported: mine.length, crossTotal: crossList.length,
      uniformCross: crossList.length > 1 && crossKnee === 0,
      selectedCross, selectedIntra: intraList.slice(0, intraKnee)
    };
  }
  const fnCountRow = h.db.prepare("SELECT COUNT(DISTINCT name) AS cnt FROM nodes WHERE label = 'Function' AND file_path != ''").get();
  return {
    uniqueSymbolCount: Number(fnCountRow?.cnt || 0),
    hubsByContract: isZeroContract ? {} : hubsMap,
    hubsByDomain: isZeroContract ? hubsMap : {}
  };
}

export function queryCbmImpactGraph(projectRoot, selfFilesSet, rawTargets = []) {
  const h = openCbmGraphHandle(projectRoot);
  if (!h) return [];
  const hits = [];
  const fileEdgeStmt = h.db.prepare(
    "SELECT DISTINCT s.file_path AS file, e.type AS edgeType, t.name AS sym, e.properties AS props FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE t.file_path = ? AND e.type IN ('CALLS', 'IMPORTS', 'REFERENCES_FILE') AND s.file_path != '' AND s.file_path NOT LIKE '%.md'"
  );
  for (const sf of selfFilesSet) {
    for (const r of fileEdgeStmt.all(sf)) {
      if (!selfFilesSet.has(r.file)) {
        hits.push({ file: r.file, token: r.sym || sf, kind: `cbm-${r.edgeType.toLowerCase()}`, line: Number(parseJsonProps(r.props).line || 1) });
      }
    }
  }
  const symStmt = h.db.prepare(
    "SELECT DISTINCT s.file_path AS file, t.name AS sym, e.properties AS props FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id WHERE e.type = 'CALLS' AND t.name = ? AND s.file_path != ''"
  );
  for (const rt of rawTargets) {
    if (rt.includes('/') || rt.startsWith('#')) continue;
    for (const r of symStmt.all(rt)) {
      if (!selfFilesSet.has(r.file)) {
        hits.push({ file: r.file, token: r.sym, kind: 'cbm-calls', line: Number(parseJsonProps(r.props).line || 1) });
      }
    }
  }
  return hits;
}
