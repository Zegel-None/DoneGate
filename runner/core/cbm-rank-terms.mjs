// 任务查询切词、多路种子文件打分与 token 估算内核（L1 无头内核，<= 350 行）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { openCbmGraphHandle } from './cockpit-cbm.mjs';
import { CK_SKIP_DIRS } from './cockpit-cache.mjs';

const RANK_SRC_EXT_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|mts|py|go|rs)$/i;
const RANK_EXCLUDE_RE = /(?:^|\/)(?:tests?|__tests__|归档|参考|设计|证据|node_modules|\.git|\.donegate|\.stryker-tmp|reports|coverage)(?:\/|$)|-fixtures\.mjs$|\.(?:test|spec)\.[^/]+$/i;
const RANK_STOP_WORDS = new Set(['the', 'a', 'to', 'of', 'and', 'for', 'in', 'fix', 'feat', 'add', 'update']);
const SEED_TERMS_MAP = new WeakMap();
const HEADER_CACHE = new Map();
const HEADER_CACHE_MAX = 512;

export function isRankSourceFile(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return Boolean(norm) && RANK_SRC_EXT_RE.test(norm) && !RANK_EXCLUDE_RE.test(norm);
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3);
}

export function getSeedMatchedTerms(seeds, file) {
  if (!seeds || typeof seeds !== 'object') return [];
  const rec = SEED_TERMS_MAP.get(seeds);
  return rec ? (rec.get(file) || []) : [];
}

function pushTermWeight(termMap, term, weight, isCjkGram) {
  const prev = termMap.get(term);
  if (prev === undefined || weight > prev.weight) {
    termMap.set(term, { term, weight, isCjkGram });
  }
}

export function tokenizeRankQuery(query) {
  const raw = String(query || '');
  const termMap = new Map();
  for (const m of raw.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    pushTermWeight(termMap, run, 1.0, false);
    if (run.length >= 4) {
      for (let i = 0; i <= run.length - 2; i++) {
        pushTermWeight(termMap, run.slice(i, i + 2), 0.25, true);
      }
    }
  }
  const ascii = raw
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  for (const part of ascii.split(/[^A-Za-z0-9]+/)) {
    const low = part.toLowerCase();
    if (low.length > 2 && !RANK_STOP_WORDS.has(low)) {
      pushTermWeight(termMap, low, 1.0, false);
    }
  }
  return [...termMap.values()];
}

function extractHeaderComment(lines) {
  const out = [];
  for (const line of lines.slice(0, 8)) {
    const t = line.trim();
    if (t.startsWith('#!')) continue;
    if (t.startsWith('//') || t.startsWith('#')) {
      out.push(t.replace(/^(?:\/\/+|#+)\s*/, ''));
      if (out.length >= 5) break;
    } else if (out.length > 0 || t !== '') {
      break;
    }
  }
  return out.join(' ').toLowerCase();
}

function readFileRankMeta(absPath) {
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(absPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return { header: '', body: '' };
  }
  const cached = HEADER_CACHE.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;
  let header = '';
  let body = '';
  try {
    const raw = readFileSync(absPath, 'utf8');
    header = extractHeaderComment(raw.split(/\r?\n/));
    body = raw.toLowerCase();
  } catch {
    header = '';
    body = '';
  }
  if (!HEADER_CACHE.has(absPath) && HEADER_CACHE.size >= HEADER_CACHE_MAX) {
    const oldest = HEADER_CACHE.keys().next().value;
    if (oldest !== undefined) HEADER_CACHE.delete(oldest);
  }
  const entry = { mtimeMs, size, header, body };
  HEADER_CACHE.set(absPath, entry);
  return entry;
}

function collectRankCandidateFiles(projectRoot, handle, opts) {
  if (Array.isArray(opts.files)) {
    return opts.files.map((f) => String(f).replace(/\\/g, '/')).filter(isRankSourceFile);
  }
  if (handle) {
    const rows = handle.db.prepare(
      "SELECT DISTINCT file_path FROM nodes WHERE project = ? AND label = 'File' AND file_path != '' ORDER BY file_path ASC"
    ).all(handle.project);
    return rows.map((r) => String(r.file_path).replace(/\\/g, '/')).filter(isRankSourceFile);
  }
  if (!projectRoot || !existsSync(projectRoot)) return [];
  const out = [];
  for (const abs of walk(projectRoot, { skipDirs: CK_SKIP_DIRS }).files) {
    const rel = relative(projectRoot, abs).split(sep).join('/');
    if (isRankSourceFile(rel)) out.push(rel);
  }
  return out.sort();
}

function resolveFileRankMeta(projectRoot, file, fileHeaders) {
  if (fileHeaders instanceof Map && fileHeaders.has(file)) {
    return { header: String(fileHeaders.get(file) || '').toLowerCase(), body: '' };
  }
  if (fileHeaders && typeof fileHeaders === 'object' && Object.hasOwn(fileHeaders, file)) {
    return { header: String(fileHeaders[file] || '').toLowerCase(), body: '' };
  }
  return projectRoot ? readFileRankMeta(join(projectRoot, file)) : { header: '', body: '' };
}

function queryFtsFileRanks(handle, term, fileSet) {
  const ranks = new Map();
  if (!handle) return ranks;
  const ftsTerm = `"${term.replace(/"/g, '')}"`;
  let rows = [];
  try {
    rows = handle.db.prepare(
      "SELECT n.file_path FROM nodes_fts f JOIN nodes n ON n.id = f.rowid WHERE nodes_fts MATCH ? AND n.project = ? AND n.label != 'Section' AND n.file_path != '' AND n.file_path NOT LIKE 'tests/%' ORDER BY bm25(nodes_fts) ASC LIMIT 400"
    ).all(ftsTerm, handle.project);
  } catch {
    return ranks;
  }
  let idx = 0;
  for (const r of rows) {
    const norm = String(r.file_path || '').replace(/\\/g, '/');
    if (!fileSet.has(norm) || ranks.has(norm)) continue;
    ranks.set(norm, 1 / (1 + idx));
    idx++;
  }
  return ranks;
}

function resolveBodyHitWeight(term, isCjkGram) {
  if (isCjkGram) return 0;
  return /^[a-z0-9_]+$/.test(term) ? 0.8 : 0.5;
}

function collectSingleTermHits(metaList, ftsRanks, { term, isCjkGram }) {
  const bodyW = resolveBodyHitWeight(term, isCjkGram);
  const hits = [];
  for (const m of metaList) {
    let s = ftsRanks.get(m.file) || 0;
    if (m.header.includes(term)) s += 2.5;
    if (m.lowerPath.includes(term)) s += 2.5;
    if (bodyW > 0 && m.body.includes(term)) s += bodyW;
    if (s > 0) hits.push({ file: m.file, s });
  }
  return hits;
}

function normalizeSeedScores(rawScore, matchedTerms) {
  const out = new Map();
  let sum = 0;
  for (const [file, base] of rawScore) {
    const nTerms = (matchedTerms.get(file) || []).length || 1;
    const boosted = base * (nTerms ** 1.5);
    out.set(file, boosted);
    sum += boosted;
  }
  if (sum <= 0) return new Map();
  for (const [file, val] of out) out.set(file, val / sum);
  SEED_TERMS_MAP.set(out, matchedTerms);
  return out;
}

export function scoreSeeds(projectRoot, query, opts = {}) {
  const terms = tokenizeRankQuery(query);
  if (terms.length === 0) return new Map();
  const handle = opts.handle !== undefined ? opts.handle : openCbmGraphHandle(projectRoot);
  const files = collectRankCandidateFiles(projectRoot, handle, opts);
  const totalFiles = files.length;
  if (totalFiles === 0) return new Map();

  const fileSet = new Set(files);
  const metaList = files.map((file) => {
    const { header, body } = resolveFileRankMeta(projectRoot, file, opts.fileHeaders);
    return { file, lowerPath: file.toLowerCase(), header, body };
  });
  const rawScore = new Map();
  const matchedTerms = new Map();

  for (const termObj of terms) {
    const ftsRanks = queryFtsFileRanks(handle, termObj.term, fileSet);
    const hits = collectSingleTermHits(metaList, ftsRanks, termObj);
    if (hits.length === 0) continue;
    const idf = Math.log(1 + totalFiles / (1 + hits.length));
    for (const h of hits) {
      rawScore.set(h.file, (rawScore.get(h.file) || 0) + h.s * idf * termObj.weight);
      const list = matchedTerms.get(h.file) || [];
      list.push(termObj.term);
      matchedTerms.set(h.file, list);
    }
  }
  return normalizeSeedScores(rawScore, matchedTerms);
}
