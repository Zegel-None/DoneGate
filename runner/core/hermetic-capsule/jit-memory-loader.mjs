// 四分类读时验活项目记忆加载器（伴生子模块，继承 verdict-core 归属，<= 195 行）
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MEMORY_CATEGORIES = Object.freeze(['architecture', 'pitfall', 'convention', 'recipe']);
export const MAX_MEMORY_LINES = 200;
export const MAX_MEMORY_BYTES = 25_600;

const MEMORY_DIR_SEGMENTS = ['.donegate', 'memory'];
const DEFAULT_MEMORY_CATEGORY = 'convention';
const MIN_LINE_NUMBER = 1;
const HEADER_LINE_RESERVE = 3;
const CATEGORY_SET = new Set(MEMORY_CATEGORIES);
const CITATION_ANCHOR_RE = /(?:^|[\s(`\[])([A-Za-z0-9_.\-/\\]+\.[A-Za-z0-9]+):L?(\d+)(?:[-–]L?(\d+))?/g;

const jmlNormPosix = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const jmlIsWithin = (baseAbs, targetAbs) => {
  const rel = relative(baseAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function jmlStripQuotes(val) {
  const t = String(val || '').trim();
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted ? t.slice(1, -1).trim() : t;
}

function jmlParseScopesValue(rawVal) {
  if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
    const inner = rawVal.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => jmlNormPosix(jmlStripQuotes(s))).filter(Boolean) : [];
  }
  const single = jmlNormPosix(jmlStripQuotes(rawVal));
  return single ? [single] : [];
}

function jmlStepFrontmatterLine(state, line) {
  if (state.inScopesList && line.startsWith('-')) {
    const item = jmlNormPosix(jmlStripQuotes(line.slice(1)));
    if (item) state.scopes.push(item);
    return;
  }
  const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!kv) return;
  const key = kv[1].toLowerCase();
  const val = kv[2].trim();
  state.inScopesList = (key === 'scopes' || key === 'scope') && !val;
  if (key === 'category') state.rawCategory = jmlStripQuotes(val).toLowerCase();
  else if (key === 'summary') state.summary = jmlStripQuotes(val);
  else if ((key === 'scopes' || key === 'scope') && val) state.scopes.push(...jmlParseScopesValue(val));
}

export function parseMemoryFrontmatter(rawText) {
  const text = String(rawText ?? '').replace(/\r\n/g, '\n');
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!fmMatch) {
    return { hasFrontmatter: false, validCategory: true, category: DEFAULT_MEMORY_CATEGORY, scopes: [], summary: '', body: text.trim() };
  }
  const state = { rawCategory: '', summary: '', scopes: [], inScopesList: false };
  for (const rawLine of fmMatch[1].split('\n')) {
    const line = rawLine.trim();
    if (line && !line.startsWith('#')) jmlStepFrontmatterLine(state, line);
  }
  const category = state.rawCategory || DEFAULT_MEMORY_CATEGORY;
  return { hasFrontmatter: true, validCategory: CATEGORY_SET.has(category), category, scopes: [...new Set(state.scopes)], summary: state.summary, body: String(fmMatch[2] || '').trim() };
}

function jmlVerifySymlinkSafety(rootAbs, memRootAbs, targetAbs, rawStr) {
  try {
    const realMem = realpathSync(memRootAbs);
    if (!jmlIsWithin(realpathSync(rootAbs), realMem)) return { ok: false, code: 'MEMORY_ROOT_SYMLINK_ESCAPED', reason: '.donegate/memory 软链越界' };
    const lst = lstatSync(targetAbs);
    const realTarget = realpathSync(targetAbs);
    if (!jmlIsWithin(realMem, realTarget) || (!lst.isFile() && !lst.isSymbolicLink()) || !statSync(realTarget).isFile()) {
      return { ok: false, code: 'MEMORY_SYMLINK_ESCAPED', reason: `记忆文件软链或类型越界：${rawStr}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, code: 'MEMORY_SYMLINK_ESCAPED', reason: `记忆文件不可读或悬空软链 (${err?.code || 'ERR'})：${rawStr}` };
  }
}

export function validateMemoryPathWithinRoot(projectRoot, candidateInput) {
  const rootAbs = resolve(projectRoot);
  const memRootAbs = join(rootAbs, ...MEMORY_DIR_SEGMENTS);
  const rawStr = String(candidateInput ?? '');
  if (!rawStr.trim() || rawStr.includes('\0') || rawStr.replace(/\\/g, '/').split('/').includes('..')) {
    return { ok: false, code: 'MEMORY_PATH_ESCAPED', reason: `拒绝非法或目录穿越记忆路径：${rawStr}` };
  }
  const targetAbs = isAbsolute(rawStr) ? resolve(rawStr) : resolve(memRootAbs, rawStr);
  if (!jmlIsWithin(memRootAbs, targetAbs)) {
    return { ok: false, code: 'MEMORY_PATH_ESCAPED', reason: `记忆路径越出 .donegate/memory 边界：${rawStr}` };
  }
  if (existsSync(memRootAbs)) {
    const symChk = jmlVerifySymlinkSafety(rootAbs, memRootAbs, targetAbs, rawStr);
    if (!symChk.ok) return symChk;
  }
  return { ok: true, absPath: targetAbs, relFile: relative(memRootAbs, targetAbs).split(sep).join('/') };
}

export function matchesMemoryScopes(memoryScopes = [], contractScopes = []) {
  const memList = (Array.isArray(memoryScopes) ? memoryScopes : []).map(jmlNormPosix).filter(Boolean);
  if (memList.length === 0 || memList.includes('*')) return true;
  const targetList = (Array.isArray(contractScopes) ? contractScopes : []).map(jmlNormPosix).filter(Boolean);
  return memList.some((ms) => targetList.some((cs) => cs === ms || cs.startsWith(`${ms}/`) || ms.startsWith(`${cs}/`)));
}

function jmlReadTotalLines(absFile, lineCache) {
  if (lineCache.has(absFile)) return lineCache.get(absFile);
  const raw = readFileSync(absFile, 'utf8').replace(/\r\n/g, '\n');
  const count = raw.length === 0 ? 0 : (raw.endsWith('\n') ? raw.split('\n').length - 1 : raw.split('\n').length);
  lineCache.set(absFile, count);
  return count;
}

function jmlCheckAnchorMiss(rootAbs, rawRel, startLine, endLine, hasRange, lineCache) {
  const rel = rawRel.replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = resolve(rootAbs, rel);
  if (!jmlIsWithin(rootAbs, abs) || !existsSync(abs)) return `${rel}:L${startLine}（文件不存在或越界）`;
  try {
    if (!statSync(abs).isFile()) return `${rel}:L${startLine}（目标不是普通文件）`;
    const total = jmlReadTotalLines(abs, lineCache);
    if (startLine < MIN_LINE_NUMBER || endLine < startLine || endLine > total) {
      return `${rel}:${hasRange ? `L${startLine}-L${endLine}` : `L${startLine}`}（行号越界，共 ${total} 行）`;
    }
    return null;
  } catch (err) { void err; return `${rel}:L${startLine}（文件不可读）`; }
}

export function verifyMemoryCitations(projectRoot, bodyText, lineCache = new Map()) {
  const rootAbs = resolve(projectRoot);
  const misses = [], anchors = [];
  for (const m of String(bodyText || '').matchAll(CITATION_ANCHOR_RE)) {
    if (m[1].startsWith('http') || m[1].includes('...')) continue;
    const startLine = Number(m[2]), endLine = m[3] !== undefined ? Number(m[3]) : startLine;
    anchors.push({ file: m[1].replace(/\\/g, '/'), startLine, endLine });
    const miss = jmlCheckAnchorMiss(rootAbs, m[1], startLine, endLine, m[3] !== undefined, lineCache);
    if (miss) misses.push(miss);
  }
  return { ok: misses.length === 0, checked: anchors.length, anchors, misses };
}

function jmlEvaluateCandidate(rootAbs, rawName, scopes, lineCache) {
  const pathChk = validateMemoryPathWithinRoot(rootAbs, rawName);
  if (!pathChk.ok) return { kind: 'blocked', item: { file: String(rawName), code: pathChk.code, reason: pathChk.reason } };
  const fm = parseMemoryFrontmatter(readFileSync(pathChk.absPath, 'utf8'));
  if (!fm.validCategory) return { kind: 'blocked', item: { file: pathChk.relFile, code: 'INVALID_MEMORY_CATEGORY', reason: `未知记忆分类：${fm.category}` } };
  if (!matchesMemoryScopes(fm.scopes, scopes)) return { kind: 'skipped', item: pathChk.relFile };
  const id = basename(pathChk.relFile, extname(pathChk.relFile));
  const cit = verifyMemoryCitations(rootAbs, fm.body, lineCache);
  if (!cit.ok) return { kind: 'stale', item: { id, file: pathChk.relFile, category: fm.category, summary: fm.summary, scopes: fm.scopes, misses: cit.misses } };
  const head = `### [${fm.category}] \`${id}\`${fm.summary ? ` — ${fm.summary}` : ''}`;
  const entryLines = [head, ...(fm.body ? fm.body.split('\n') : [])];
  return { kind: 'live', entryLines, meta: { id, file: pathChk.relFile, category: fm.category, summary: fm.summary, scopes: fm.scopes, checkedAnchors: cit.checked } };
}

function jmlListCandidateNames(rootAbs, memRootAbs, extraCandidates) {
  try {
    if (!jmlIsWithin(realpathSync(rootAbs), realpathSync(memRootAbs))) return { escaped: true, names: [] };
    const names = readdirSync(memRootAbs).filter((n) => n.endsWith('.md')).sort((a, b) => a.localeCompare(b));
    return { escaped: false, names: [...names, ...(Array.isArray(extraCandidates) ? extraCandidates : [])] };
  } catch (err) { void err; return { escaped: false, names: [] }; }
}

export function loadVerifiedJitMemories(projectRoot, opts = {}) {
  const empty = { entries: [], staleEvicted: [], scopeSkipped: [], blockedEntries: [], budgetTruncated: false, totalLines: 0, totalBytes: 0, lines: [] };
  if (opts.disabled) return empty;
  const rootAbs = resolve(projectRoot), memRootAbs = join(rootAbs, ...MEMORY_DIR_SEGMENTS);
  if (!existsSync(memRootAbs)) return empty;
  const listed = jmlListCandidateNames(rootAbs, memRootAbs, opts.extraCandidates);
  if (listed.escaped) return { ...empty, blockedEntries: [{ file: '.donegate/memory', code: 'MEMORY_ROOT_SYMLINK_ESCAPED', reason: '.donegate/memory 软链越界' }] };

  const maxLines = Number(opts.maxLines) || MAX_MEMORY_LINES, maxBytes = Number(opts.maxBytes) || MAX_MEMORY_BYTES;
  const buck = { blocked: [], skipped: [], stale: [], entries: [], bodyLines: [], usedLines: HEADER_LINE_RESERVE, usedBytes: 0, budgetTruncated: false };
  const lineCache = new Map();
  for (const name of listed.names) {
    const res = jmlEvaluateCandidate(rootAbs, name, opts.scopes || [], lineCache);
    if (res.kind !== 'live') { buck[res.kind].push(res.item); continue; }
    const addBytes = Buffer.byteLength(res.entryLines.join('\n') + '\n', 'utf8');
    if (buck.usedLines + res.entryLines.length > maxLines || buck.usedBytes + addBytes > maxBytes) { buck.budgetTruncated = true; continue; }
    buck.usedLines += res.entryLines.length;
    buck.usedBytes += addBytes;
    buck.entries.push(res.meta);
    buck.bodyLines.push(...res.entryLines);
  }
  const lines = buck.entries.length > 0 ? ['', '## 项目验活记忆（JIT Verified Memory · 动态尾部挂载）', `> 已通过实时行号验活 ${buck.entries.length} 条记忆（剔除失效锚点 ${buck.stale.length} 条）`, ...buck.bodyLines] : [];
  return { entries: buck.entries, staleEvicted: buck.stale, scopeSkipped: buck.skipped, blockedEntries: buck.blocked, budgetTruncated: buck.budgetTruncated, totalLines: lines.length, totalBytes: Buffer.byteLength(lines.join('\n'), 'utf8'), lines };
}
