// CBM 文件级加权图谱与个性化 PageRank 排序内核（L1 无头内核，<= 350 行）
import { applyExportTruthToSymbols, isPhantomHubTarget, readExportTruth } from './cbm-export-truth.mjs';
import { buildCallEdgeTrustContext, classifyCallEdge } from './cbm-edge-trust.mjs';
import { openCbmGraphHandle } from './cockpit-cbm.mjs';
import { estimateTokens, getSeedMatchedTerms, isRankSourceFile, scoreSeeds } from './cbm-rank-terms.mjs';

export { estimateTokens, scoreSeeds };

const RANK_GRAPH_CACHE = new Map();
const RANK_GRAPH_CACHE_MAX = 8;

const RANK_EDGE_WEIGHTS = {
  IMPORTS: 1.0,
  CALLS: 0.8,
  USAGE: 0.5,
  FILE_CHANGES_WITH: 0.6,
  SIMILAR_TO: 0.3,
  SEMANTICALLY_RELATED: 0.3
};

function recordEdge(rawOut, viaSources, u, v, w, type) {
  rawOut[u].set(v, (rawOut[u].get(v) || 0) + w);
  let targetSources = viaSources.get(v);
  if (!targetSources) {
    targetSources = new Map();
    viaSources.set(v, targetSources);
  }
  const prev = targetSources.get(u);
  if (!prev || w > prev.weight) {
    targetSources.set(u, { fromIdx: u, type, weight: w });
  }
}

function buildNormalizedAdjacency(rawOut, inDeg = null) {
  return rawOut.map((row) => {
    const outRow = new Map();
    let total = 0;
    for (const [v, sum] of row) {
      const damp = inDeg && inDeg[v] > 1 ? (inDeg[v] ** 0.35) : 1;
      const w = Math.log1p(sum) / damp;
      if (w > 0) {
        outRow.set(v, w);
        total += w;
      }
    }
    if (total > 0) {
      for (const [v, w] of outRow) outRow.set(v, w / total);
    }
    return outRow;
  });
}

function collectEdgeWeight(root, row, trustCtx) {
  const base = RANK_EDGE_WEIGHTS[row.type];
  if (!base) return 0;
  const sf = String(row.sf || '').replace(/\\/g, '/');
  const tf = String(row.tf || '').replace(/\\/g, '/');
  if (row.type === 'CALLS') {
    if (isPhantomHubTarget(root, { label: row.tLabel, file: tf, symbol: row.tName })
      || classifyCallEdge(sf, tf, row.tName, trustCtx) === 'inferred') {
      return base * 0.2;
    }
  } else if (row.type === 'USAGE') {
    if (isPhantomHubTarget(root, { label: row.tLabel, file: tf, symbol: row.tName })) {
      return base * 0.2;
    }
  }
  return base;
}

function buildRankGraphFromHandle(h) {
  const fileRows = h.db.prepare(
    "SELECT DISTINCT file_path FROM nodes WHERE project = ? AND label = 'File' AND file_path != '' ORDER BY file_path ASC"
  ).all(h.project);
  const files = fileRows.map((r) => String(r.file_path).replace(/\\/g, '/')).filter(isRankSourceFile);
  const idx = new Map(files.map((f, i) => [f, i]));
  const rawOut = files.map(() => new Map());
  const inDeg = new Float64Array(files.length);
  const viaSources = new Map();
  if (files.length === 0) return { files, idx, out: rawOut, viaSources };

  const edgeRows = h.db.prepare(
    "SELECT s.file_path AS sf, t.file_path AS tf, e.type AS type, t.label AS tLabel, t.name AS tName FROM edges e JOIN nodes s ON s.id = e.source_id JOIN nodes t ON t.id = e.target_id WHERE e.project = ? AND s.project = ? AND t.project = ? AND s.file_path != '' AND t.file_path != '' AND s.file_path != t.file_path AND e.type IN ('IMPORTS', 'CALLS', 'USAGE', 'FILE_CHANGES_WITH', 'SIMILAR_TO', 'SEMANTICALLY_RELATED')"
  ).all(h.project, h.project, h.project);

  const trustCtx = buildCallEdgeTrustContext(h.root, { handle: h });
  for (const r of edgeRows) {
    const u = idx.get(String(r.sf || '').replace(/\\/g, '/'));
    const v = idx.get(String(r.tf || '').replace(/\\/g, '/'));
    if (u === undefined || v === undefined) continue;
    const w = collectEdgeWeight(h.root, r, trustCtx);
    if (w <= 0) continue;
    recordEdge(rawOut, viaSources, u, v, w, r.type);
    recordEdge(rawOut, viaSources, v, u, w * 0.5, r.type);
    inDeg[v] += 1;
    inDeg[u] += 0.5;
  }
  return { files, idx, out: buildNormalizedAdjacency(rawOut, inDeg), viaSources };
}

export function loadRankGraph(projectRoot) {
  const h = openCbmGraphHandle(projectRoot);
  if (!h) return null;
  const cacheKey = `${h.root}|${h.fp}`;
  const cached = RANK_GRAPH_CACHE.get(cacheKey);
  if (cached) return cached;

  const graph = buildRankGraphFromHandle(h);
  if (RANK_GRAPH_CACHE.size >= RANK_GRAPH_CACHE_MAX) {
    const oldest = RANK_GRAPH_CACHE.keys().next().value;
    if (oldest !== undefined) RANK_GRAPH_CACHE.delete(oldest);
  }
  RANK_GRAPH_CACHE.set(cacheKey, graph);
  return graph;
}

function populateSeedVec(s, idx, seeds) {
  if (seeds instanceof Float64Array || Array.isArray(seeds)) {
    const len = Math.min(s.length, seeds.length);
    for (let i = 0; i < len; i++) {
      if (Number.isFinite(seeds[i]) && seeds[i] > 0) s[i] = seeds[i];
    }
    return;
  }
  const entries = seeds instanceof Map ? seeds.entries() : Object.entries(seeds);
  for (const [file, val] of entries) {
    const norm = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const i = idx.get(norm);
    const num = Number(val);
    if (i !== undefined && Number.isFinite(num) && num > 0) s[i] += num;
  }
}

function buildSeedVector(graph, seeds) {
  const n = graph?.files?.length || 0;
  const s = new Float64Array(n);
  if (n === 0 || !seeds || typeof seeds !== 'object') return { vec: s, hasMass: false };
  populateSeedVec(s, graph.idx, seeds);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i];
  if (sum <= 0) return { vec: s, hasMass: false };
  for (let i = 0; i < n; i++) s[i] /= sum;
  return { vec: s, hasMass: true };
}

function buildRowSums(out, n) {
  const sums = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    const row = out[u];
    if (!row || row.size === 0) continue;
    let total = 0;
    for (const w of row.values()) {
      if (w > 0) total += w;
    }
    sums[u] = total;
  }
  return sums;
}

function pprStep(out, r, s, rowSums, alpha) {
  const n = r.length;
  const next = new Float64Array(n);
  let dangling = 0;
  for (let u = 0; u < n; u++) {
    const ru = r[u];
    if (ru === 0) continue;
    if (rowSums[u] <= 0) {
      dangling += ru;
      continue;
    }
    const scale = ((1 - alpha) * ru) / rowSums[u];
    for (const [v, w] of out[u]) {
      if (w > 0) next[v] += scale * w;
    }
  }
  const teleport = alpha + (1 - alpha) * dangling;
  let l1 = 0;
  for (let i = 0; i < n; i++) {
    next[i] += teleport * s[i];
    l1 += Math.abs(next[i] - r[i]);
  }
  return { next, l1 };
}

export function personalizedPageRank(graph, seeds, { alpha = 0.15, iters = 40, tol = 1e-6 } = {}) {
  const n = graph?.files?.length || 0;
  if (n === 0) return new Float64Array(0);
  const { vec: s, hasMass } = buildSeedVector(graph, seeds);
  if (!hasMass) return s;

  const rowSums = buildRowSums(graph.out || [], n);
  let r = new Float64Array(s);
  for (let iter = 0; iter < iters; iter++) {
    const step = pprStep(graph.out || [], r, s, rowSums, alpha);
    r = step.next;
    if (step.l1 < tol) break;
  }
  return r;
}

function normalizeSeedLookup(seeds) {
  if (!seeds || seeds instanceof Float64Array || Array.isArray(seeds) || typeof seeds !== 'object') return seeds;
  const normMap = new Map();
  const entries = seeds instanceof Map ? seeds.entries() : Object.entries(seeds);
  for (const [k, v] of entries) {
    const norm = String(k || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const num = Number(v);
    if (norm && Number.isFinite(num) && num > 0) normMap.set(norm, (normMap.get(norm) || 0) + num);
  }
  return normMap;
}

function getSeedWeight(seeds, file, fileIdx) {
  if (!seeds) return 0;
  if (seeds instanceof Map) return Number(seeds.get(file) || 0);
  if (seeds instanceof Float64Array || Array.isArray(seeds)) {
    const w = Number(seeds[fileIdx]);
    return Number.isFinite(w) && w > 0 ? w : 0;
  }
  if (typeof seeds === 'object') return Number(seeds[file] || 0);
  return 0;
}

function collectExplainCandidates(graph, seeds, targetIdx) {
  const normSeeds = normalizeSeedLookup(seeds);
  const out = graph.out || [];
  const srcMap = graph.viaSources?.get(targetIdx);
  const list = [];
  if (srcMap) {
    for (const [u, info] of srcMap) {
      const from = graph.files[u];
      const sw = getSeedWeight(normSeeds, from, u);
      const score = (sw > 0 ? sw * 100 : 0) + (out[u]?.get(targetIdx) || 0);
      list.push({ from, type: info.type, score });
    }
    return list;
  }
  for (let u = 0; u < out.length; u++) {
    const transW = out[u]?.get(targetIdx) || 0;
    if (u === targetIdx || transW <= 0) continue;
    const from = graph.files[u];
    const sw = getSeedWeight(normSeeds, from, u);
    list.push({ from, type: 'EDGE', score: (sw > 0 ? sw * 100 : 0) + transW });
  }
  return list;
}

export function explainRank(graph, seeds, file) {
  const norm = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const seedTerms = getSeedMatchedTerms(seeds, norm);
  const targetIdx = graph?.idx?.get(norm);
  if (targetIdx === undefined) return { seedTerms, via: [] };
  const candidates = collectExplainCandidates(graph, seeds, targetIdx);
  candidates.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from));
  return {
    seedTerms,
    via: candidates.slice(0, 3).map(({ from, type }) => ({ from, type }))
  };
}

function parseRankProps(raw) {
  if (!raw || raw === '{}') return {};
  try { return JSON.parse(raw); } catch (err) { void err; return {}; }
}

export function queryCbmFileExports(projectRoot, relFile) {
  const h = openCbmGraphHandle(projectRoot);
  const norm = String(relFile || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!h || !norm) return [];
  const rows = h.db.prepare(
    "SELECT name, label, start_line, end_line, properties FROM nodes WHERE project = ? AND file_path = ? AND label IN ('Function', 'Method', 'Class') ORDER BY start_line ASC, id ASC"
  ).all(h.project, norm);
  const rawSyms = rows.map((r) => {
    const p = parseRankProps(r.properties);
    return {
      name: r.name, label: r.label,
      startLine: Number(r.start_line || 0), endLine: Number(r.end_line || 0),
      isExported: Boolean(p.is_exported), signature: p.signature || ''
    };
  });
  return applyExportTruthToSymbols(rawSyms, readExportTruth(h.root, norm))
    .filter((s) => s.isExported && !s.nested)
    .map(({ name, label, signature, startLine, endLine }) => ({ name, label, signature, startLine, endLine }));
}
