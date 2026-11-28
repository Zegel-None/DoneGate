// 非焦点超长文件行号骨架与词法命中函数切片器（伴生子模块，继承 verdict-core 归属，<= 155 行）
import { extname } from 'node:path';
import { maskCommentsAndStrings } from '../ast-stub.mjs';

export const DEFAULT_VIEWER_MAX_FULL_LINES = 350;
const LINE_NUMBER_PAD_WIDTH = 6, DEFAULT_HEAD_WINDOW_LINES = 8, DEFAULT_TAIL_WINDOW_LINES = 4;
const MAX_SIGNATURE_SCAN_LINES = 16, MAX_IMPORT_SCAN_LINES = 40, MIN_OMITTED_GAP_LINES = 2;
const JS_TOP_BLOCK_RE = /^\s*(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function(?:\s*\*)?\s*([A-Za-z_$][\w$]*)?|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/;
const JS_TOP_DECL_RE = /^\s*export\s+(?:const|let|var|interface|type|enum|\*|\{)/;
const PY_TOP_BLOCK_RE = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)|^class\s+([A-Za-z_][\w]*)/;
const vsPadLineNo = (ln, text) => `${String(ln).padStart(LINE_NUMBER_PAD_WIDTH, ' ')}| ${text}`;
const vsIsJsImportDone = (ml) => ml.includes(';') || /\bfrom\s*['"]|^import\s*['"]/.test(ml.trim());

function vsStepBraces(maskedLine, startDepth) {
  let depth = startDepth, opened = false;
  for (const ch of maskedLine) if (ch === '{') { depth++; opened = true; } else if (ch === '}') depth = Math.max(0, depth - 1);
  return { depth, opened };
}
function vsFindJsBlockEnd(maskedLines, startIdx) {
  let depth = 0, opened = false;
  for (let i = startIdx; i < maskedLines.length; i++) {
    const step = vsStepBraces(maskedLines[i], depth);
    depth = step.depth;
    if (step.opened) opened = true;
    if ((opened && depth === 0) || (!opened && maskedLines[i].includes(';'))) return i;
  }
  return startIdx;
}
function vsFindPyBlockEnd(rawLines, startIdx) {
  let last = startIdx;
  for (let i = startIdx + 1; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (!t || t.startsWith('#')) continue;
    if (/^\S/.test(rawLines[i])) break;
    last = i;
  }
  return last;
}
function vsFindSignatureEnd(maskedLines, startIdx, endIdx, isPy) {
  for (let i = startIdx; i <= Math.min(endIdx, startIdx + MAX_SIGNATURE_SCAN_LINES); i++) {
    if ((isPy && maskedLines[i].trimEnd().endsWith(':')) || (!isPy && /[{;]|=>/.test(maskedLines[i]))) return i;
  }
  return startIdx;
}
function vsMarkImportSpan(maskedLines, startIdx, isPy, keepSet) {
  let openParens = 0;
  for (let j = startIdx; j <= Math.min(maskedLines.length - 1, startIdx + MAX_IMPORT_SCAN_LINES); j++) {
    keepSet.add(j + 1);
    const ml = maskedLines[j];
    openParens = Math.max(0, openParens + (ml.match(/\(/g) || []).length - (ml.match(/\)/g) || []).length);
    if (isPy ? openParens === 0 : vsIsJsImportDone(ml)) return j;
  }
  return startIdx;
}
const vsAddLeadingDocLine = (rawLines, idx, keepSet) => { if (idx > 0 && /^\s*(?:\/\*\*|\*\/|\/\/|#)/.test(rawLines[idx - 1])) keepSet.add(idx); };
function vsAddClassMethodSignatures(maskedLines, sigEnd, endIdx, keepSet) {
  let innerDepth = 0;
  for (let j = sigEnd + 1; j < endIdx; j++) {
    const m = innerDepth === 0 ? maskedLines[j].match(/^\s*(?:(?:async|static|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/) : null;
    if (m && !/^(?:if|for|while|switch|catch)$/.test(m[1])) keepSet.add(j + 1);
    innerDepth = vsStepBraces(maskedLines[j], innerDepth).depth;
  }
}
function vsRecordTopBlock(rawLines, maskedLines, i, blkMatch, isPy, keepSet, blocks) {
  const name = blkMatch[1] || blkMatch[2] || blkMatch[3] || 'anonymous';
  const endIdx = isPy ? vsFindPyBlockEnd(rawLines, i) : vsFindJsBlockEnd(maskedLines, i), sigEnd = vsFindSignatureEnd(maskedLines, i, endIdx, isPy);
  vsAddLeadingDocLine(rawLines, i, keepSet);
  for (let k = i; k <= sigEnd; k++) keepSet.add(k + 1);
  if (!isPy && /^\s*(?:export\s+(?:default\s+)?)?class\b/.test(maskedLines[i]) && endIdx > sigEnd) {
    vsAddClassMethodSignatures(maskedLines, sigEnd, endIdx, keepSet);
    keepSet.add(endIdx + 1);
  }
  blocks.push({ name, startLine: i + 1, endLine: endIdx + 1 });
  return endIdx;
}
function vsStepTopLevelLine(rawLines, maskedLines, i, isPy, keepSet, blocks) {
  const ml = maskedLines[i], trimmed = ml.trim();
  if (isPy ? /^(?:import\s|from\s+\S+\s+import\b)/.test(trimmed) : /^import[\s({'"]/.test(trimmed)) return vsMarkImportSpan(maskedLines, i, isPy, keepSet);
  const blkMatch = isPy ? ml.match(PY_TOP_BLOCK_RE) : ml.match(JS_TOP_BLOCK_RE);
  if (blkMatch) return vsRecordTopBlock(rawLines, maskedLines, i, blkMatch, isPy, keepSet, blocks);
  if (!isPy && JS_TOP_DECL_RE.test(ml)) {
    const endIdx = vsFindJsBlockEnd(maskedLines, i);
    keepSet.add(i + 1);
    if (endIdx > i) keepSet.add(endIdx + 1);
  }
  return i;
}
function vsCollectBlocksAndSkeleton(rawLines, maskedLines, isPy) {
  const keepSet = new Set(), blocks = [];
  let braceDepth = 0;
  for (let i = 0; i < rawLines.length; i++) {
    if (braceDepth === 0 && maskedLines[i].trim()) {
      const nextIdx = vsStepTopLevelLine(rawLines, maskedLines, i, isPy, keepSet, blocks);
      if (nextIdx > i) { i = nextIdx; continue; }
    }
    if (!isPy) braceDepth = vsStepBraces(maskedLines[i], braceDepth).depth;
  }
  return { keepSet, blocks };
}
function vsExpandLexicalMatches(rawLines, blocks, terms, keepSet) {
  if (terms.length === 0) return [];
  const matchedBlocks = [];
  for (const blk of blocks) {
    if (!terms.some((t) => blk.name.includes(t) || rawLines.slice(blk.startLine - 1, blk.endLine).join('\n').includes(t))) continue;
    matchedBlocks.push(blk);
    vsAddLeadingDocLine(rawLines, blk.startLine - 1, keepSet);
    for (let ln = blk.startLine; ln <= blk.endLine; ln++) keepSet.add(ln);
  }
  return matchedBlocks;
}
function vsEmitGapOrLines(normPath, rawLines, gapStart, gapEnd, outLines, omittedRanges) {
  if (gapEnd - gapStart + 1 < MIN_OMITTED_GAP_LINES) {
    for (let g = gapStart; g <= gapEnd; g++) outLines.push(vsPadLineNo(g, rawLines[g - 1]));
    return;
  }
  omittedRanges.push({ startLine: gapStart, endLine: gapEnd });
  outLines.push(`... (lines ${gapStart}-${gapEnd} omitted, use zoom ${normPath}:${gapStart}-${gapEnd} --source to expand) ...`);
}
function vsRenderNumberedSlice(normPath, rawLines, keepSet) {
  const totalLines = rawLines.length, outLines = [], omittedRanges = [];
  for (let ln = 2; ln < totalLines; ln++) if (!keepSet.has(ln) && keepSet.has(ln - 1) && keepSet.has(ln + 1)) keepSet.add(ln);
  for (let ln = 1; ln <= totalLines;) {
    if (keepSet.has(ln)) { outLines.push(vsPadLineNo(ln, rawLines[ln - 1])); ln++; continue; }
    const gapStart = ln;
    while (ln <= totalLines && !keepSet.has(ln)) ln++;
    vsEmitGapOrLines(normPath, rawLines, gapStart, ln - 1, outLines, omittedRanges);
  }
  return { outLines, omittedRanges };
}
export function buildViewerFocusedFileSlice(fileRel, sourceText, opts = {}) {
  const normPath = String(fileRel || '').replace(/\\/g, '/'), raw = String(sourceText ?? '');
  const normRaw = raw.replace(/\r\n/g, '\n'), splitLines = normRaw.split('\n');
  const rawLines = normRaw.endsWith('\n') ? splitLines.slice(0, -1) : splitLines, totalLines = rawLines.length;
  const maxFullLines = Number(opts.maxFullLines) > 0 ? Number(opts.maxFullLines) : DEFAULT_VIEWER_MAX_FULL_LINES;
  if (opts.isFocusSeed || totalLines <= maxFullLines) {
    return { sliced: false, path: normPath, totalLines, maxFullLines, keptLines: totalLines, omittedRanges: [], matchedBlocks: [], role: '全量展开', content: raw };
  }
  const ext = extname(normPath).toLowerCase() || '.mjs', isPy = ext === '.py';
  const { keepSet, blocks } = vsCollectBlocksAndSkeleton(rawLines, maskCommentsAndStrings(rawLines.join('\n'), ext).split('\n'), isPy);
  const headCap = Math.min(totalLines, Math.max(1, Number(opts.headWindowLines) || DEFAULT_HEAD_WINDOW_LINES)), tailCap = Math.max(1, Number(opts.tailWindowLines) || DEFAULT_TAIL_WINDOW_LINES);
  for (let ln = 1; ln <= headCap; ln++) keepSet.add(ln);
  for (let ln = Math.max(1, totalLines - tailCap + 1); ln <= totalLines; ln++) keepSet.add(ln);
  const terms = [...(opts.lexicalTerms || []), ...(opts.focusSymbols || [])].map((t) => String(t || '').trim()).filter(Boolean);
  const matchedBlocks = vsExpandLexicalMatches(rawLines, blocks, terms, keepSet);
  const { outLines, omittedRanges } = vsRenderNumberedSlice(normPath, rawLines, keepSet);
  return { sliced: true, path: normPath, totalLines, maxFullLines, keptLines: outLines.length - omittedRanges.length, omittedRanges, matchedBlocks, role: matchedBlocks.length > 0 ? '骨架+词法聚焦切片' : '大文件行号骨架切片', content: `${outLines.join('\n')}\n` };
}
