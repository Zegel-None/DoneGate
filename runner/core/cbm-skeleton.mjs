// Agentless 式文件骨架生成器：基于 CBM 符号行区间与源码词法掩码生成高压缩比骨架视图（<= 350 行）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { openCbmGraphHandle } from './cockpit-cbm.mjs';
import { applyExportTruthToSymbols, readExportTruth } from './cbm-export-truth.mjs';
import { estimateTokens } from './cbm-rank-terms.mjs';
import { maskCommentsAndStrings, stripCommentsKeepStrings } from './js-mask-lexer.mjs';

const CONTAINER_LABELS = new Set(['Function', 'Method', 'Class']);
const MAX_DECL_CHARS = 120;

function skTruncate(text, maxLen = MAX_DECL_CHARS) {
  const s = String(text || '').trimEnd();
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

function skResolveValidFile(projectRoot, relFile) {
  if (!projectRoot || !relFile) return null;
  const cleaned = String(relFile).replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!cleaned) return null;
  const rootAbs = resolve(projectRoot);
  const abs = resolve(rootAbs, cleaned);
  const rel = relative(rootAbs, abs).split(sep).join('/');
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !existsSync(abs)) return null;
  try {
    return statSync(abs).isFile() ? { rootAbs, abs, norm: rel } : null;
  } catch {
    return null;
  }
}

function skParseIsExported(rawProps) {
  try { return Boolean(JSON.parse(rawProps || '{}').is_exported); } catch { return false; }
}

function skQueryCbmNodes(rootAbs, norm, handle) {
  const h = handle !== undefined ? handle : openCbmGraphHandle(rootAbs);
  if (!h) return null;
  const rows = h.db.prepare(
    "SELECT name, label, start_line, end_line, properties FROM nodes WHERE project = ? AND file_path = ? AND label IN ('Function', 'Method', 'Class', 'Variable') ORDER BY start_line ASC, id ASC"
  ).all(h.project, norm);
  return {
    truthRoot: h.root || rootAbs,
    rawSyms: rows.map((r) => ({
      name: r.name,
      label: r.label,
      startLine: Number(r.start_line || 0),
      endLine: Number(r.end_line || 0),
      isExported: skParseIsExported(r.properties)
    }))
  };
}

function skLoadSymbols(rootAbs, norm, handle, customSymbols) {
  let truthRoot = rootAbs;
  let rawSyms = null;
  if (Array.isArray(customSymbols)) {
    rawSyms = customSymbols.map((s) => ({
      name: s.name || '',
      label: s.label || 'Function',
      startLine: Number(s.startLine || 0),
      endLine: Number(s.endLine || 0),
      isExported: Boolean(s.isExported)
    }));
  } else {
    const queried = skQueryCbmNodes(rootAbs, norm, handle);
    if (!queried) return null;
    truthRoot = queried.truthRoot;
    rawSyms = queried.rawSyms;
  }
  return applyExportTruthToSymbols(rawSyms, readExportTruth(truthRoot, norm));
}

function skIsStrictlyEnclosed(inner, containers) {
  return containers.some((o) => (
    o !== inner && o.startLine <= inner.startLine && inner.endLine <= o.endLine
    && (o.startLine < inner.startLine || inner.endLine < o.endLine)
  ));
}

function skFilterTopLevelSymbols(syms, lines) {
  const maxLine = lines.length;
  const containers = syms.filter((s) => CONTAINER_LABELS.has(s.label) && s.startLine >= 1 && s.startLine <= maxLine && s.endLine >= s.startLine);
  const topSyms = [];
  const seenStartLines = new Set();
  for (const s of syms) {
    if (s.startLine < 1 || s.startLine > maxLine || s.nested || skIsStrictlyEnclosed(s, containers)) continue;
    if (s.label === 'Variable' && /^\s+/.test(lines[s.startLine - 1] || '')) continue;
    if (seenStartLines.has(s.startLine)) continue;
    seenStartLines.add(s.startLine);
    topSyms.push({ ...s, endLine: Math.min(maxLine, Math.max(s.startLine, s.endLine)) });
  }
  return { topSyms, containers };
}

function skCleanBlockCommentLine(line) {
  return line.trim().replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\*\s?/, '').trim();
}

function skExtractLineHeader(lines, startIdx, prefix) {
  let text = '';
  let j = startIdx;
  while (j < lines.length && lines[j].trim().startsWith(prefix)) {
    const cleaned = lines[j].trim().slice(prefix.length).trim();
    if (!text && cleaned) text = lines[j].trim();
    j++;
  }
  return { text: text ? skTruncate(text) : '', headerEndLine: j };
}

function skExtractBlockHeader(lines, startIdx) {
  let text = '';
  let j = startIdx;
  while (j < lines.length) {
    const cleaned = skCleanBlockCommentLine(lines[j]);
    if (!text && cleaned) text = `// ${cleaned}`;
    if (lines[j].includes('*/')) { j++; break; }
    j++;
  }
  return { text: text ? skTruncate(text) : '', headerEndLine: j };
}

function skExtractHeader(lines) {
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#!'))) i++;
  if (i >= lines.length) return { text: '', headerEndLine: 0 };
  const first = lines[i].trim();
  if (first.startsWith('//') || first.startsWith('#')) return skExtractLineHeader(lines, i, first.startsWith('//') ? '//' : '#');
  if (first.startsWith('/*')) return skExtractBlockHeader(lines, i);
  return { text: '', headerEndLine: 0 };
}

function skInsideContainer(lineNo, containers) {
  return containers.some((c) => lineNo >= c.startLine && lineNo <= c.endLine);
}

function skAddImport(imports, seenImports, spec) {
  if (spec && !seenImports.has(spec)) {
    seenImports.add(spec);
    imports.push(spec);
  }
}

function skCollectJsImportEnd(maskedLines, startIdx) {
  let buf = '';
  for (let j = startIdx; j < Math.min(maskedLines.length, startIdx + 60); j++) {
    buf += (buf ? ' ' : '') + maskedLines[j].trim();
    if (buf.includes(';') || /\bfrom\s*['"][^'"]*['"]/.test(buf) || /^import\s+(?:type\s+)?['"][^'"]*['"]/.test(buf)) return j;
  }
  return startIdx;
}

const STAR_REEXPORT_RE = /^export\s+\*(?:\s*as\s+[A-Za-z_$][\w$]*\s+|\s*)from\s*['"][^'"]*['"]/;

function skCollectJsReexportEnd(maskedLines, startIdx) {
  let buf = '';
  for (let j = startIdx; j < Math.min(maskedLines.length, startIdx + 60); j++) {
    buf += (buf ? ' ' : '') + maskedLines[j].trim();
    if (buf.includes(';') || STAR_REEXPORT_RE.test(buf)) return j;
    const closeIdx = buf.indexOf('}');
    if (/^export\s*\{/.test(buf) && closeIdx >= 0) {
      const tail = buf.slice(closeIdx + 1).trim();
      const nextTrim = (maskedLines[j + 1] || '').trim();
      if (/\bfrom\s*['"][^'"]*['"]/.test(tail) || (!tail && !nextTrim.startsWith('from'))) return j;
    }
  }
  return startIdx;
}

function skJoinParenLines(lines, maskedLines, startIdx) {
  let buf = lines[startIdx].trim();
  let endIdx = startIdx;
  if (!maskedLines[startIdx].includes('(') || maskedLines[startIdx].includes(')')) return { buf, endIdx };
  for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + 60); j++) {
    buf += ' ' + lines[j].trim();
    endIdx = j;
    if (maskedLines[j].includes(')')) break;
  }
  return { buf, endIdx };
}

function skCollectPythonImport(lines, maskedLines, startIdx, imports, seenImports) {
  const { buf, endIdx } = skJoinParenLines(lines, maskedLines, startIdx);
  const fromMatch = buf.match(/^from\s+([^\s]+)\s+import\b/);
  if (fromMatch) {
    skAddImport(imports, seenImports, fromMatch[1]);
    return endIdx;
  }
  const impMatch = buf.match(/^import\s+(.+)$/);
  if (!impMatch) return endIdx;
  for (const part of impMatch[1].split(',')) {
    skAddImport(imports, seenImports, part.trim().split(/\s+as\s+/)[0].trim());
  }
  return endIdx;
}

function skHandleTopLevelLine(lines, maskedLines, i, isPy, state) {
  const mLine = maskedLines[i].trim();
  if (!mLine) return i;
  if (isPy) {
    const isTopPyImp = !/^\s/.test(lines[i]) && /^(?:from\s+[^\s]+\s+import|import\s+)/.test(mLine);
    return isTopPyImp ? skCollectPythonImport(lines, maskedLines, i, state.imports, state.seenImports) : i;
  }
  if (/^import\b/.test(mLine) && !/^import\s*[.(]/.test(mLine)) {
    const endIdx = skCollectJsImportEnd(maskedLines, i);
    const cleanStmt = stripCommentsKeepStrings(lines.slice(i, endIdx + 1).join('\n')).trim();
    const modMatch = cleanStmt.match(/\bfrom\s*['"]([^'"]+)['"]/) || cleanStmt.match(/^import\s+(?:type\s+)?['"]([^'"]+)['"]/);
    if (modMatch) skAddImport(state.imports, state.seenImports, modMatch[1]);
    return endIdx;
  }
  if (/^export\s+(?:\*|\{)/.test(mLine)) {
    const endIdx = skCollectJsReexportEnd(maskedLines, i);
    const compact = lines.slice(i, endIdx + 1).map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
    state.reexports.push({ kind: 'reexport', startLine: i + 1, endLine: i + 1, text: compact });
    return endIdx;
  }
  return i;
}

function skCollectImportsAndReexports(lines, maskedLines, ext, containers) {
  const isPy = ext === '.py';
  const state = { imports: [], seenImports: new Set(), reexports: [] };
  for (let i = 0; i < maskedLines.length; i++) {
    if (!skInsideContainer(i + 1, containers)) {
      i = skHandleTopLevelLine(lines, maskedLines, i, isPy, state);
    }
  }
  return { imports: state.imports, reexports: state.reexports };
}

function skExtractLineCommentAbove(lines, idx, headerEndLine, prefix) {
  let top = idx;
  while (top - 1 >= headerEndLine && lines[top - 1].trim().startsWith(prefix)) top--;
  for (let k = top; k <= idx; k++) {
    if (lines[k].trim().slice(prefix.length).trim()) return skTruncate(lines[k].trim());
  }
  return null;
}

function skExtractBlockCommentAbove(lines, idx, headerEndLine) {
  const minIdx = Math.max(headerEndLine, idx - 30);
  for (let top = idx; top >= minIdx; top--) {
    if (!lines[top].includes('/*')) continue;
    if (!lines[top].trim().startsWith('/*')) return null;
    for (let k = top; k <= idx; k++) {
      const cleaned = skCleanBlockCommentLine(lines[k]);
      if (cleaned) return skTruncate(`// ${cleaned}`);
    }
    return null;
  }
  return null;
}

function skExtractLeadingComment(lines, startLine, headerEndLine) {
  const idx = startLine - 2;
  if (idx < 0 || idx >= lines.length || idx + 1 <= headerEndLine) return null;
  const t = lines[idx].trim();
  if (t.startsWith('//') || t.startsWith('#')) {
    return skExtractLineCommentAbove(lines, idx, headerEndLine, t.startsWith('//') ? '//' : '#');
  }
  return t.endsWith('*/') ? skExtractBlockCommentAbove(lines, idx, headerEndLine) : null;
}

function skFormatItems(lines, topSyms, reexports, headerEndLine, highlightLines) {
  const items = [...topSyms.map((s) => ({ kind: 'sym', ...s })), ...reexports].sort((a, b) => a.startLine - b.startLine);
  const out = [];
  for (const item of items) {
    const comment = skExtractLeadingComment(lines, item.startLine, headerEndLine);
    if (comment) out.push(comment);
    const mark = highlightLines?.has(item.startLine) ? '▶ ' : '';
    if (item.kind === 'reexport') {
      out.push(`${mark}L${item.startLine}: ${skTruncate(item.text)}`);
      continue;
    }
    const decl = skTruncate((lines[item.startLine - 1] || '').trimEnd());
    const span = (item.label !== 'Variable' && item.endLine > item.startLine) ? `  … { ${item.endLine - item.startLine + 1} 行 }` : '';
    out.push(`${mark}L${item.startLine}: ${decl}${span}`);
  }
  return out;
}

function skApplyTokenBudget(outLines, maxTokens) {
  const full = outLines.join('\n');
  if (!(maxTokens > 0) || estimateTokens(full) <= maxTokens) return full;
  for (let keep = outLines.length - 1; keep >= 1; keep--) {
    const cand = `${outLines.slice(0, keep).join('\n')}\n… (已省略 ${outLines.length - keep} 行)`;
    if (estimateTokens(cand) <= maxTokens) return cand;
  }
  const first = outLines[0] || '';
  if (estimateTokens(first) <= maxTokens) return first;
  const maxChars = Math.max(1, maxTokens * 3);
  return maxChars > 1 ? `${full.slice(0, maxChars - 1)}…` : full.slice(0, maxChars);
}

export function buildFileSkeleton(projectRoot, relFile, opts = {}) {
  const fileSpec = skResolveValidFile(projectRoot, relFile);
  if (!fileSpec) return null;
  const { maxTokens = 0, highlightLines = null, handle = undefined, symbols = null } = opts;
  const raw = readFileSync(fileSpec.abs, 'utf8');
  const rawTokens = estimateTokens(raw);
  const syms = skLoadSymbols(fileSpec.rootAbs, fileSpec.norm, handle, symbols);
  if (!syms) return null;

  const lines = raw.split(/\r?\n/);
  const ext = extname(fileSpec.norm).toLowerCase();
  const maskedLines = maskCommentsAndStrings(raw, ext === '.py' ? '.py' : '.mjs').split(/\r?\n/);
  const { topSyms, containers } = skFilterTopLevelSymbols(syms, lines);
  const { text: headerText, headerEndLine } = skExtractHeader(lines);
  const { imports, reexports } = skCollectImportsAndReexports(lines, maskedLines, ext, containers);

  const outLines = [];
  if (headerText) outLines.push(headerText);
  if (imports.length > 0) outLines.push(`imports: ${imports.join(', ')}`);
  outLines.push(...skFormatItems(lines, topSyms, reexports, headerEndLine, highlightLines));
  if (outLines.length === 0) outLines.push(`(无顶层符号，共 ${lines.length} 行)`);

  const text = skApplyTokenBudget(outLines, maxTokens);
  return { text, rawTokens, skeletonTokens: estimateTokens(text) };
}
