// 四维结构化提交门禁 — 有效代码行度量、重定位搬移折算与预算加载原语
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStrict } from './io.mjs';

export const DEFAULT_HYGIENE_BUDGETS = {
  warnCommitCodeLines: 250,
  maxCommitCodeLines: 450,
  maxRawCommitCodeLines: 900,
  maxProdCommitFiles: 6,
  maxCommitFiles: 10,
  warnEffectiveFileLines: 600,
  maxEffectiveFileLines: 850,
  maxFileLines: 1200,
  warnFunctionLines: 160,
  warnCognitiveComplexity: 15,
  maxCognitiveComplexity: 25
};

const MIN_DECLARATIVE_BLOCK_LINES = 12, FOLDED_DECLARATIVE_LINES = 6;
const FN_DECL_START_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s*\*)?(?:\s+[A-Za-z0-9_$]+)?\s*\(|^(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z0-9_$]+\s*=>)/;
const PURE_STR_ELEM_RE = /^(?:(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)\s*,?\s*)+(?:\s*\/\/.*)?$/;

function hyFindStringJoinEnd(rawLines, startIdx, lineEffective, plainCodeLine) {
  for (let j = startIdx + 1; j < rawLines.length; j++) {
    if (!lineEffective[j]) continue;
    if (!plainCodeLine[j]) return -1;
    const tj = rawLines[j].trim();
    if (/^\]\s*\.join\s*\(/.test(tj)) return j;
    if (!PURE_STR_ELEM_RE.test(tj)) return -1;
  }
  return -1;
}

function foldPureStringJoinBlocks(rawLines, lineEffective, plainCodeLine, foldedLines) {
  for (let i = 0; i < rawLines.length; i++) {
    if (!plainCodeLine[i] || !/(?:=|\breturn|,|\()\s*\[\s*$/.test(rawLines[i].replace(/\/\/.*$/, '').trim())) continue;
    const closeIdx = hyFindStringJoinEnd(rawLines, i, lineEffective, plainCodeLine);
    if (closeIdx <= i) continue;
    const effIdx = [];
    for (let k = i; k <= closeIdx; k++) {
      if (lineEffective[k] && !foldedLines.has(k)) effIdx.push(k);
    }
    if (effIdx.length >= MIN_DECLARATIVE_BLOCK_LINES) {
      for (let m = FOLDED_DECLARATIVE_LINES; m < effIdx.length; m++) foldedLines.add(effIdx[m]);
    }
    i = closeIdx;
  }
}

function hySkipRegexChar(raw, startIdx) {
  let i = startIdx + 1, inCls = false;
  while (i < raw.length) {
    if (raw[i] === '\\') { i += 2; continue; }
    if (raw[i] === '[') inCls = true;
    else if (raw[i] === ']') inCls = false;
    else if (raw[i] === '/' && !inCls) {
      i++;
      while (i < raw.length && /[a-z]/i.test(raw[i])) i++;
      return i;
    }
    i++;
  }
  return i;
}

function hyStepTplMode(raw, i, li, top, modeStack, foldedLines, lineSt) {
  if (raw[i] === '\\') { lineSt.hasEffective = true; return i + 2; }
  if (raw[i] === '$' && raw[i + 1] === '{') {
    lineSt.hasEffective = true;
    modeStack.push({ kind: 'tpl-expr', depth: 1, startLine: li });
    lineSt.prevNonSpace = '{';
    return i + 2;
  }
  if (raw[i] === '`') {
    lineSt.hasEffective = true;
    modeStack.pop();
    if (!top.exprLines.has(li)) top.pureLines.push(li);
    if (top.pureLines.length >= MIN_DECLARATIVE_BLOCK_LINES) {
      for (let k = FOLDED_DECLARATIVE_LINES; k < top.pureLines.length; k++) foldedLines.add(top.pureLines[k]);
    }
    lineSt.prevNonSpace = '`';
    return i + 1;
  }
  if (!/\s/.test(raw[i])) lineSt.hasEffective = true;
  return i + 1;
}

function hyStepBrace(ch, li, modeStack, st) {
  const top = modeStack[modeStack.length - 1];
  if (ch === '{') {
    if (top?.kind === 'tpl-expr') top.depth++;
    else st.jsBraceDepth++;
    return;
  }
  if (ch !== '}') return;
  if (top?.kind === 'tpl-expr' && --top.depth === 0) {
    const popped = modeStack.pop(), parentTpl = modeStack[modeStack.length - 1];
    if (parentTpl && popped.startLine < li) parentTpl.exprLines.add(li);
  } else if (!top && st.jsBraceDepth > 0) {
    st.jsBraceDepth--;
  }
}

function hyStepCodeChar(raw, i, li, modeStack, st, lineSt) {
  const ch = raw[i], next = raw[i + 1] || '';
  if (/\s/.test(ch)) return i + 1;
  if (ch === '/' && next === '/') return raw.length;
  if (ch === '/' && next === '*') { st.inBlockComment = true; return i + 2; }
  if (ch === "'" || ch === '"') {
    lineSt.hasEffective = true;
    let cur = i + 1;
    while (cur < raw.length && raw[cur] !== ch) cur += raw[cur] === '\\' ? 2 : 1;
    lineSt.prevNonSpace = ch;
    return cur + 1;
  }
  if (ch === '`') {
    lineSt.hasEffective = true;
    modeStack.push({ kind: 'tpl', pureLines: [], exprLines: new Set() });
    return i + 1;
  }
  if (ch === '/' && (lineSt.prevNonSpace === '' || '=([,:!&|?;{}~^+-*%<>'.includes(lineSt.prevNonSpace))) {
    lineSt.hasEffective = true;
    lineSt.prevNonSpace = '/';
    return hySkipRegexChar(raw, i);
  }
  lineSt.hasEffective = true;
  hyStepBrace(ch, li, modeStack, st);
  lineSt.prevNonSpace = ch;
  return i + 1;
}

function hyScanSingleLine(raw, li, modeStack, foldedLines, st) {
  let i = 0;
  const lineSt = { hasEffective: false, prevNonSpace: '' };
  while (i < raw.length) {
    if (st.inBlockComment) {
      const endIdx = raw.indexOf('*/', i);
      if (endIdx < 0) break;
      st.inBlockComment = false;
      i = endIdx + 2;
      continue;
    }
    const top = modeStack[modeStack.length - 1];
    if (top?.kind === 'tpl') i = hyStepTplMode(raw, i, li, top, modeStack, foldedLines, lineSt);
    else i = hyStepCodeChar(raw, i, li, modeStack, st, lineSt);
  }
  return lineSt;
}

function hyTrackFnSpan(trimmed, li, startsInPlainCode, braceBefore, hasEffective, prevNonSpace, modeStack, st, fnSpans) {
  if (st.curFn === null && startsInPlainCode && braceBefore === 0 && hasEffective && FN_DECL_START_RE.test(trimmed)) {
    st.curFn = { start: li, opened: st.jsBraceDepth > 0 };
  } else if (st.curFn && !st.curFn.opened && st.jsBraceDepth > 0) {
    st.curFn.opened = true;
  }
  const closed = st.curFn && !st.inBlockComment && modeStack.length === 0 &&
    ((st.curFn.opened && st.jsBraceDepth === 0) || (!st.curFn.opened && prevNonSpace === ';'));
  if (closed) {
    fnSpans.push([st.curFn.start, li]);
    st.curFn = null;
  }
}

export function countEffectiveCodeLines(text) {
  const rawLines = String(text || '').split(/\r?\n/), n = rawLines.length;
  const lineEffective = new Array(n).fill(false), plainCodeLine = new Array(n).fill(false), foldedLines = new Set();
  const fnSpans = [], modeStack = [], st = { inBlockComment: false, jsBraceDepth: 0, curFn: null };
  let effectiveLines = 0;

  for (let li = 0; li < n; li++) {
    const raw = rawLines[li], trimmed = raw.trim(), topAtStart = modeStack[modeStack.length - 1];
    const startsInPlainCode = !st.inBlockComment && topAtStart?.kind !== 'tpl';
    plainCodeLine[li] = startsInPlainCode;
    if (!trimmed || (startsInPlainCode && trimmed.startsWith('#') && !trimmed.startsWith('#!'))) continue;
    const braceBefore = st.jsBraceDepth;
    const lineSt = hyScanSingleLine(raw, li, modeStack, foldedLines, st);
    if (lineSt.hasEffective) {
      lineEffective[li] = true;
      effectiveLines++;
      const topAfter = modeStack[modeStack.length - 1];
      if (topAfter?.kind === 'tpl' && !topAfter.exprLines.has(li)) topAfter.pureLines.push(li);
      else if (topAfter?.kind === 'tpl-expr' && modeStack[modeStack.length - 2]?.kind === 'tpl') modeStack[modeStack.length - 2].exprLines.add(li);
    }
    hyTrackFnSpan(trimmed, li, startsInPlainCode, braceBefore, lineSt.hasEffective, lineSt.prevNonSpace, modeStack, st, fnSpans);
  }

  foldPureStringJoinBlocks(rawLines, lineEffective, plainCodeLine, foldedLines);
  let maxFnLines = 0;
  for (const [fnStart, fnEnd] of fnSpans) {
    let fnLogical = 0;
    for (let k = fnStart; k <= fnEnd; k++) {
      if (lineEffective[k] && !foldedLines.has(k)) fnLogical++;
    }
    if (fnLogical > maxFnLines) maxFnLines = fnLogical;
  }
  return { rawLines: n, effectiveLines, maxFnLines };
}

function normalizeRelocatedLine(raw) {
  const t = String(raw || '').trim();
  if (t.length < 10 || /^[{}()[\];,\s]+$/.test(t) || /^(?:\/\/|\/\*|\*|\*\/|#(?!!))/.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

export function computeRelocatedCodeLines(removedLines, addedLines) {
  const bag = new Map();
  for (const line of removedLines) {
    const key = normalizeRelocatedLine(line);
    if (key) bag.set(key, (bag.get(key) || 0) + 1);
  }
  let relocated = 0;
  for (const line of addedLines) {
    const key = normalizeRelocatedLine(line), left = key ? (bag.get(key) || 0) : 0;
    if (left > 0) {
      relocated++;
      bag.set(key, left - 1);
    }
  }
  return relocated;
}

export function loadHygieneBudgets(projectRoot) {
  const p = join(projectRoot, 'thresholds.json');
  const base = { ...DEFAULT_HYGIENE_BUDGETS, maxFunctionLines: 0, allowedRootDirs: [], bannedPatterns: [] };
  if (!existsSync(p)) return base;
  const r = readJsonStrict(p);
  if (!r.ok || !r.value) return base;
  const v = r.value;
  return {
    warnCommitCodeLines: Number(v.warnCommitCodeLines) || DEFAULT_HYGIENE_BUDGETS.warnCommitCodeLines,
    maxCommitCodeLines: Number(v.maxCommitCodeLines) || DEFAULT_HYGIENE_BUDGETS.maxCommitCodeLines,
    maxRawCommitCodeLines: Number(v.maxRawCommitCodeLines) || DEFAULT_HYGIENE_BUDGETS.maxRawCommitCodeLines,
    maxProdCommitFiles: Number(v.maxProdCommitFiles) || DEFAULT_HYGIENE_BUDGETS.maxProdCommitFiles,
    maxCommitFiles: Number(v.maxCommitFiles) || DEFAULT_HYGIENE_BUDGETS.maxCommitFiles,
    warnEffectiveFileLines: Number(v.warnEffectiveFileLines) || DEFAULT_HYGIENE_BUDGETS.warnEffectiveFileLines,
    maxEffectiveFileLines: Number(v.maxEffectiveFileLines) || DEFAULT_HYGIENE_BUDGETS.maxEffectiveFileLines,
    maxFileLines: Number(v.maxFileLines) || DEFAULT_HYGIENE_BUDGETS.maxFileLines,
    warnFunctionLines: Number(v.warnFunctionLines) || DEFAULT_HYGIENE_BUDGETS.warnFunctionLines,
    maxFunctionLines: Number(v.maxFunctionLines) || 0,
    warnCognitiveComplexity: Number(v.warnCognitiveComplexity) || DEFAULT_HYGIENE_BUDGETS.warnCognitiveComplexity,
    maxCognitiveComplexity: Number(v.maxCognitiveComplexity) || DEFAULT_HYGIENE_BUDGETS.maxCognitiveComplexity,
    allowedRootDirs: Array.isArray(v.allowedRootDirs) ? v.allowedRootDirs.map(String) : [],
    bannedPatterns: Array.isArray(v.bannedPatterns) ? v.bannedPatterns : []
  };
}
