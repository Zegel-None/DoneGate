// 四维门禁第四维：零依赖 JS/TS 词法认知复杂度（SonarSource Campbell 2018 规范）与反压行钻空子检测原语
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { walkByExt } from './fs-walk.mjs';

const COG_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'catch', 'function', 'break', 'continue', 'return', 'async', 'class']);
const REGEX_PREV_TOKENS = new Set(['', '=', '(', '[', ',', ':', '!', '&', '|', '?', ';', '{', '}', '~', '^', '+', '-', '*', '%', '<', '>', '=>', '&&', '||', '??', 'return']);
const MULTI_OPS_3 = new Set(['===', '!==', '??=', '&&=', '||=', '...']);
const MULTI_OPS_2 = new Set(['&&', '||', '??', '?.', '=>', '==', '!=', '<=', '>=']);
const LOOP_OR_BRANCH_KWS = new Set(['if', 'for', 'while', 'switch', 'catch']);

function cogSkipQuoted(src, start, quote, lineRef) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\n') lineRef.line++;
    if (src[i] === '\\') { if (src[i + 1] === '\n') lineRef.line++; i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function cogSkipRegex(src, start, lineRef) {
  let i = start + 1, inClass = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { lineRef.line++; return i + 1; }
    if (ch === '\\') { i += 2; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return i;
}

function cogSkipComment(src, i, next, lineRef) {
  if (next === '/') {
    let cur = i + 2;
    while (cur < src.length && src[cur] !== '\n') cur++;
    return cur;
  }
  let cur = i + 2;
  while (cur < src.length && !(src[cur] === '*' && src[cur + 1] === '/')) {
    if (src[cur] === '\n') lineRef.line++;
    cur++;
  }
  return cur + 2;
}

function cogStepTemplate(src, i, topTpl, tplStack, tokens, lineRef) {
  if (src[i] === '\n') { lineRef.line++; return { nextIdx: i + 1, prevSig: null }; }
  if (src[i] === '\\') {
    if (src[i + 1] === '\n') lineRef.line++;
    return { nextIdx: i + 2, prevSig: null };
  }
  if (src[i] === '$' && src[i + 1] === '{') {
    topTpl.inText = false;
    topTpl.braceDepth = 1;
    tokens.push({ type: 'punc', val: '${', line: lineRef.line });
    return { nextIdx: i + 2, prevSig: '{' };
  }
  if (src[i] === '`') {
    tplStack.pop();
    return { nextIdx: i + 1, prevSig: '`' };
  }
  return { nextIdx: i + 1, prevSig: null };
}

function cogReadWordOrNumber(src, i, prevSig, tokens, line) {
  if (/[A-Za-z_$]/.test(src[i])) {
    let end = i + 1;
    while (end < src.length && /[A-Za-z0-9_$]/.test(src[end])) end++;
    const word = src.slice(i, end), isProp = prevSig === '.';
    tokens.push({ type: !isProp && COG_KEYWORDS.has(word) ? 'kw' : 'id', val: word, line, isProp });
    return { nextIdx: end, prevSig: word };
  }
  let end = i + 1;
  while (end < src.length && /[0-9a-fA-FxXoObBn_.]/.test(src[end])) end++;
  tokens.push({ type: 'num', val: src.slice(i, end), line });
  return { nextIdx: end, prevSig: 'num' };
}

function cogStepPlainToken(src, i, prevSig, tplStack, tokens, lineRef) {
  const ch = src[i], next = src[i + 1] || '', topTpl = tplStack[tplStack.length - 1];
  if (ch === '/' && (next === '/' || next === '*')) return { nextIdx: cogSkipComment(src, i, next, lineRef), prevSig };
  if (ch === "'" || ch === '"') return { nextIdx: cogSkipQuoted(src, i, ch, lineRef), prevSig: 'str' };
  if (ch === '`') { tplStack.push({ inText: true, braceDepth: 0 }); return { nextIdx: i + 1, prevSig }; }
  if (ch === '/' && REGEX_PREV_TOKENS.has(prevSig)) return { nextIdx: cogSkipRegex(src, i, lineRef), prevSig: 're' };
  if (/[A-Za-z0-9_$]/.test(ch)) return cogReadWordOrNumber(src, i, prevSig, tokens, lineRef.line);
  const s3 = src.slice(i, i + 3), s2 = src.slice(i, i + 2);
  const multi = MULTI_OPS_3.has(s3) ? s3 : (MULTI_OPS_2.has(s2) ? s2 : null);
  if (multi) {
    tokens.push({ type: 'op', val: multi, line: lineRef.line });
    return { nextIdx: i + multi.length, prevSig: multi };
  }
  if (ch === '{' && topTpl && !topTpl.inText) topTpl.braceDepth++;
  if (ch === '}' && topTpl && !topTpl.inText && --topTpl.braceDepth === 0) {
    topTpl.inText = true;
    tokens.push({ type: 'punc', val: '}', line: lineRef.line });
    return { nextIdx: i + 1, prevSig: '}' };
  }
  tokens.push({ type: '{}()[];,.'.includes(ch) ? 'punc' : 'op', val: ch, line: lineRef.line });
  return { nextIdx: i + 1, prevSig: ch };
}

export function cogTokenizeJs(text) {
  const src = String(text || ''), tokens = [], tplStack = [], lineRef = { line: 1 };
  let i = src.startsWith('#!') ? (src.indexOf('\n') < 0 ? src.length : src.indexOf('\n')) : 0, prevSig = '';
  while (i < src.length) {
    const topTpl = tplStack[tplStack.length - 1];
    if (topTpl && topTpl.inText) {
      const r = cogStepTemplate(src, i, topTpl, tplStack, tokens, lineRef);
      i = r.nextIdx;
      if (r.prevSig !== null) prevSig = r.prevSig;
      continue;
    }
    if (src[i] === '\n') { lineRef.line++; i++; continue; }
    if (/\s/.test(src[i])) { i++; continue; }
    const r = cogStepPlainToken(src, i, prevSig, tplStack, tokens, lineRef);
    i = r.nextIdx;
    prevSig = r.prevSig;
  }
  return tokens;
}

function cogFindClose(tokens, openIdx, openChar, closeChar) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].val === openChar) depth++;
    else if (tokens[i].val === closeChar && --depth === 0) return i;
  }
  return -1;
}

function cogFindOpenRev(tokens, closeIdx) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (tokens[i].val === ')') depth++;
    else if (tokens[i].val === '(' && --depth === 0) return i;
  }
  return -1;
}

function cogInferArrowName(tokens, arrowIdx) {
  if (tokens[arrowIdx - 1]?.type === 'id' && tokens[arrowIdx - 2]?.val === '=' && tokens[arrowIdx - 3]?.type === 'id') {
    return tokens[arrowIdx - 3].val;
  }
  if (tokens[arrowIdx - 1]?.val !== ')') return '<arrow>';
  const openP = cogFindOpenRev(tokens, arrowIdx - 1);
  if (openP <= 0) return '<arrow>';
  const eqIdx = tokens[openP - 1]?.val === 'async' ? openP - 2 : openP - 1;
  return tokens[eqIdx]?.val === '=' && tokens[eqIdx - 1]?.type === 'id' ? tokens[eqIdx - 1].val : '<arrow>';
}

function cogScanExprEnd(tokens, startIdx, limitEnd) {
  let end = startIdx, pDepth = 0, bDepth = 0;
  while (end <= limitEnd) {
    const v = tokens[end].val;
    if (v === '(' || v === '[') pDepth++;
    else if (v === ')' || v === ']') { if (pDepth === 0) break; pDepth--; }
    else if (v === '{' || v === '${') bDepth++;
    else if (v === '}') { if (bDepth === 0) break; bDepth--; }
    else if ((v === ';' || v === ',') && pDepth === 0 && bDepth === 0) break;
    end++;
  }
  return Math.max(startIdx, end - 1);
}

function cogMatchFunctionAt(tokens, idx) {
  const tk = tokens[idx];
  if (tk.type === 'kw' && tk.val === 'function') {
    let cur = tokens[idx + 1]?.val === '*' ? idx + 2 : idx + 1;
    const name = tokens[cur]?.type === 'id' ? tokens[cur++].val : '<anonymous>';
    if (tokens[cur]?.val !== '(') return null;
    const closeP = cogFindClose(tokens, cur, '(', ')');
    if (closeP < 0 || tokens[closeP + 1]?.val !== '{') return null;
    const closeB = cogFindClose(tokens, closeP + 1, '{', '}');
    return closeB > closeP ? { name, headIdx: idx, bodyStart: closeP + 1, bodyEnd: closeB } : null;
  }
  if (tk.type === 'op' && tk.val === '=>') {
    const name = cogInferArrowName(tokens, idx);
    if (tokens[idx + 1]?.val === '{') {
      const closeB = cogFindClose(tokens, idx + 1, '{', '}');
      return closeB > idx ? { name, headIdx: idx, bodyStart: idx + 1, bodyEnd: closeB } : null;
    }
    return { name, headIdx: idx, bodyStart: idx + 1, bodyEnd: cogScanExprEnd(tokens, idx + 1, tokens.length - 1) };
  }
  return null;
}

function cogPushBodyEnd(tokens, afterIdx, limitEnd, nestEnds) {
  if (afterIdx > limitEnd) return;
  if (tokens[afterIdx]?.val === '{') {
    const end = cogFindClose(tokens, afterIdx, '{', '}');
    if (end > afterIdx) nestEnds.push(Math.min(end - 1, limitEnd));
    return;
  }
  nestEnds.push(cogScanExprEnd(tokens, afterIdx, limitEnd));
}

function cogStepOperatorScore(tk, depth, st) {
  const v = tk.val;
  if (tk.type === 'op' && (v === '&&' || v === '||' || v === '??')) {
    if (st.lastLogicOp !== v) { st.score += 1; st.lastLogicOp = v; }
    return true;
  }
  if (v === ';' || v === '{' || v === '}' || v === ',' || v === '=>' || v === '(' || v === ')') st.lastLogicOp = null;
  if (tk.type === 'op' && v === '?') {
    st.score += 1 + depth + st.ternaryPending;
    st.ternaryPending++;
    st.lastLogicOp = null;
    return true;
  }
  if (v === ':' && st.ternaryPending > 0) { st.ternaryPending--; st.lastLogicOp = null; return true; }
  if (v === ';' || v === '}') st.ternaryPending = 0;
  return false;
}

function cogStepControlKeyword(tk, i, endIdx, tokens, depth, st) {
  const v = tk.val;
  if (v === 'break' || v === 'continue') {
    if (tokens[i + 1]?.type === 'id' && tokens[i + 1].line === tk.line) st.score += 1;
    return;
  }
  if (v === 'else') {
    st.score += 1;
    if (tokens[i + 1]?.type === 'kw' && tokens[i + 1].val === 'if') st.elseIfSet.add(i + 1);
    else cogPushBodyEnd(tokens, i + 1, endIdx, st.nestEnds);
    return;
  }
  if (v === 'do') {
    st.score += 1 + depth;
    cogPushBodyEnd(tokens, i + 1, endIdx, st.nestEnds);
    return;
  }
  if (!LOOP_OR_BRANCH_KWS.has(v)) return;
  if (!st.elseIfSet.has(i)) st.score += 1 + depth;
  const cp = tokens[i + 1]?.val === '(' ? cogFindClose(tokens, i + 1, '(', ')') : -1;
  cogPushBodyEnd(tokens, cp > i ? cp + 1 : i + 1, endIdx, st.nestEnds);
}

function cogScoreTokenRange(tokens, startIdx, endIdx) {
  const st = { nestEnds: [], elseIfSet: new Set(), score: 0, maxNest: 0, lastLogicOp: null, ternaryPending: 0 };
  for (let i = startIdx; i <= endIdx; i++) {
    while (st.nestEnds.length > 0 && i > st.nestEnds[st.nestEnds.length - 1]) st.nestEnds.pop();
    const depth = st.nestEnds.length, tk = tokens[i];
    if (depth > st.maxNest) st.maxNest = depth;
    if (cogStepOperatorScore(tk, depth, st)) continue;
    if (tk.type === 'kw') cogStepControlKeyword(tk, i, endIdx, tokens, depth, st);
    if (i > startIdx && ((tk.type === 'kw' && tk.val === 'function') || (tk.type === 'op' && tk.val === '=>'))) {
      const nested = cogMatchFunctionAt(tokens, i);
      if (nested && nested.bodyEnd <= endIdx) st.nestEnds.push(nested.bodyEnd);
    }
  }
  return { score: st.score, maxNest: st.maxNest };
}

function cogCollectLineGolfHits(countsMap, rawLines, kind, hardMin, longMin, longLen, out) {
  for (const [lineNo, count] of countsMap.entries()) {
    const raw = rawLines[lineNo - 1] || '';
    if (/dg-allow\s*:/.test(raw)) continue;
    if (count >= hardMin || (count >= longMin && raw.trim().length > longLen)) {
      out.push({ kind, line: lineNo, count, preview: raw.trim().slice(0, 100) });
    }
  }
}

export function cogDetectGolfing(text, tokens) {
  const rawLines = String(text || '').split(/\r?\n/), semiPerLine = new Map(), ternPerLine = new Map();
  let forParenEnd = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'kw' && tk.val === 'for' && tokens[i + 1]?.val === '(') {
      forParenEnd = cogFindClose(tokens, i + 1, '(', ')');
    }
    if (tk.val === ';' && (forParenEnd < 0 || i > forParenEnd)) semiPerLine.set(tk.line, (semiPerLine.get(tk.line) || 0) + 1);
    if (tk.type === 'op' && tk.val === '?') ternPerLine.set(tk.line, (ternPerLine.get(tk.line) || 0) + 1);
  }
  const issues = [];
  cogCollectLineGolfHits(semiPerLine, rawLines, 'dense-statements', 4, 3, 130, issues);
  cogCollectLineGolfHits(ternPerLine, rawLines, 'nested-ternary', 4, 3, 120, issues);
  return issues;
}

export function analyzeCodeComplexityAndGolfing(text) {
  const tokens = cogTokenizeJs(text), topFunctions = [];
  let braceDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (braceDepth === 0 && ((tk.type === 'kw' && tk.val === 'function') || (tk.type === 'op' && tk.val === '=>'))) {
      const fn = cogMatchFunctionAt(tokens, i);
      if (fn) {
        const { score, maxNest } = cogScoreTokenRange(tokens, fn.bodyStart, fn.bodyEnd);
        topFunctions.push({ name: fn.name, startLine: tokens[fn.headIdx].line, endLine: tokens[fn.bodyEnd].line, cognitiveComplexity: score, maxNesting: maxNest });
      }
    }
    if (tk.val === '{' || tk.val === '${') braceDepth++;
    else if (tk.val === '}' && braceDepth > 0) braceDepth--;
  }
  const golfingIssues = cogDetectGolfing(text, tokens);
  const maxCognitive = topFunctions.reduce((mx, f) => Math.max(mx, f.cognitiveComplexity), 0);
  return { functions: topFunctions, maxCognitive, golfingIssues };
}

export function auditRepository4D(projectRoot, budgets) {
  const report = [];
  for (const d of ['runner', 'skill']) {
    const absDir = join(projectRoot, d);
    if (!existsSync(absDir)) continue;
    for (const absFile of walkByExt(absDir, ['.mjs'])) {
      const rel = relative(projectRoot, absFile).split(sep).join('/');
      if (/(?:-fixtures\.mjs$|^skill\/pilot-)/.test(rel)) continue;
      const cx = analyzeCodeComplexityAndGolfing(readFileSync(absFile, 'utf8'));
      const overMaxFns = cx.functions.filter((f) => f.cognitiveComplexity > budgets.maxCognitiveComplexity);
      const warnFns = cx.functions.filter((f) => f.cognitiveComplexity > budgets.warnCognitiveComplexity && f.cognitiveComplexity <= budgets.maxCognitiveComplexity);
      if (overMaxFns.length > 0 || warnFns.length > 0 || cx.golfingIssues.length > 0) {
        report.push({ file: rel, maxCognitive: cx.maxCognitive, overMaxFns, warnFns, golfingIssues: cx.golfingIssues });
      }
    }
  }
  return report.sort((a, b) => b.maxCognitive - a.maxCognitive);
}
