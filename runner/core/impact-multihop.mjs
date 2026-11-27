// 基于 CBM 静态导入闭包的 <= 3 跳单测与夹具反向追踪（无 CBM 时优雅降级，<= 350 行）
import { openCbmGraphHandle } from './cockpit-cbm.mjs';

export const IR_TEST_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$|^runner\/self-test\.mjs$/i;

const IR_EXCLUDE_PREFIX_RE = /^(?:归档|参考|设计|证据)\/|(?:^|\/)(?:node_modules|\.git|\.donegate|\.dsh|\.deps|dist|_dist|coverage|reports|\.stryker-tmp)\//i;

export function normalizeImpactRelPath(p) {
  return String(p || '').trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

function sortedUniqueSeedFiles(seedFiles) {
  const seen = new Set();
  for (const raw of seedFiles || []) {
    const norm = normalizeImpactRelPath(raw);
    if (norm) seen.add(norm);
  }
  return [...seen].sort();
}

function addNormalizedNeighbors(adjMap, rawKey, rawVals) {
  const key = normalizeImpactRelPath(rawKey);
  if (!key || rawVals == null || typeof rawVals === 'string') return;
  if (typeof rawVals[Symbol.iterator] !== 'function') return;
  let bucket = adjMap.get(key);
  if (!bucket) {
    bucket = new Set();
    adjMap.set(key, bucket);
  }
  for (const item of rawVals) {
    const norm = normalizeImpactRelPath(item);
    if (norm) bucket.add(norm);
  }
}

function normalizeReverseAdj(revAdj) {
  const rawBuckets = new Map();
  if (revAdj instanceof Map) {
    for (const [k, v] of revAdj.entries()) addNormalizedNeighbors(rawBuckets, k, v);
  } else if (revAdj && typeof revAdj === 'object') {
    for (const k of Object.keys(revAdj)) addNormalizedNeighbors(rawBuckets, k, revAdj[k]);
  }
  const normalized = new Map();
  for (const [k, set] of rawBuckets.entries()) {
    if (set.size > 0) normalized.set(k, [...set].sort());
  }
  return normalized;
}

function expandMultiHopStep(normRevAdj, frontier, hop, visited, found) {
  const next = [];
  for (const node of frontier) {
    for (const caller of normRevAdj.get(node.file) || []) {
      if (visited.has(caller)) continue;
      visited.add(caller);
      const nextPath = [...node.path, caller];
      if (IR_TEST_RE.test(caller)) {
        found.push({ file: caller, hops: hop, path: nextPath });
        continue;
      }
      next.push({ file: caller, path: nextPath });
    }
  }
  return next;
}

export function collectMultiHopTestsFromReverseAdj(revAdj, seedFiles, maxHops = 3) {
  const seeds = sortedUniqueSeedFiles(seedFiles);
  if (seeds.length === 0 || !(Number.isFinite(maxHops) && maxHops >= 1)) return [];
  const cap = Math.floor(maxHops);
  const normRevAdj = normalizeReverseAdj(revAdj);
  const visited = new Set(seeds);
  let frontier = seeds.map((s) => ({ file: s, path: [s] }));
  const found = [];
  for (let hop = 1; hop <= cap && frontier.length > 0; hop++) {
    frontier = expandMultiHopStep(normRevAdj, frontier, hop, visited, found);
  }
  return found.sort((a, b) => a.hops - b.hops || a.file.localeCompare(b.file));
}

function queryCbmReverseImportAdj(handle) {
  if (typeof handle?.db?.prepare !== 'function') return new Map();
  let rows = [];
  try {
    rows = handle.db.prepare(`
      SELECT DISTINCT s.file_path AS src, t.file_path AS dst
      FROM edges e
      JOIN nodes s ON s.id = e.source_id
      JOIN nodes t ON t.id = e.target_id
      WHERE e.type = 'IMPORTS' AND e.project = ?
        AND s.file_path != '' AND t.file_path != '' AND s.file_path != t.file_path
      ORDER BY s.file_path ASC
    `).all(handle.project);
  } catch (err) {
    return err ? new Map() : new Map();
  }
  const revAdj = new Map();
  for (const row of rows || []) {
    const src = normalizeImpactRelPath(row?.src);
    const dst = normalizeImpactRelPath(row?.dst);
    if (!src || !dst || src === dst) continue;
    if (IR_EXCLUDE_PREFIX_RE.test(src) || IR_EXCLUDE_PREFIX_RE.test(dst)) continue;
    if (!revAdj.has(dst)) revAdj.set(dst, []);
    revAdj.get(dst).push(src);
  }
  return revAdj;
}

export function irInferMultiHopTests(projectRoot, seedFiles, { maxHops = 3, handle = undefined } = {}) {
  const seeds = sortedUniqueSeedFiles(seedFiles);
  if (seeds.length === 0 || !(Number.isFinite(maxHops) && maxHops >= 1)) return [];
  const h = handle !== undefined ? handle : openCbmGraphHandle(projectRoot);
  if (!h || !h.db || !h.project) return [];
  const revAdj = queryCbmReverseImportAdj(h);
  return collectMultiHopTestsFromReverseAdj(revAdj, seeds, maxHops);
}

export function formatMultiHopSectionLines(multiHopTests, secNum) {
  const list = Array.isArray(multiHopTests) ? multiHopTests : [];
  const lines = [`${secNum}. 多跳覆盖单测（≤3 跳，CBM 反向导入闭包 ${list.length} 个）：`];
  for (const t of list) {
    lines.push(`   · ${t.file} [${t.hops}跳: ${t.path.join(' ← ')}]`);
  }
  return lines;
}
