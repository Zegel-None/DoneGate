// 四维门禁第四维：零依赖 JS/TS 词法认知复杂度（SonarSource Campbell 2018 规范）与反压行钻空子检测原语
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { walk } from './fs-walk.mjs';

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
    const v = tokens[i].val;
    if (v === openChar || (openChar === '{' && v === '${')) depth++;
    else if (v === closeChar && --depth === 0) return i;
  }
  return -1;
}

function cogSkipBalancedAngles(tokens, idx) {
  if (tokens[idx]?.val !== '<') return idx;
  let depth = 0;
  for (let i = idx; i < tokens.length; i++) {
    const v = tokens[i].val;
    if (v === '<') depth++;
    else if (v === '>' && --depth === 0) return i + 1;
    else if (v === ';' || v === '{' || v === '}') return idx;
  }
  return idx;
}

function cogSkipTsReturnType(tokens, idx) {
  if (tokens[idx]?.val !== ':') return idx;
  let aDepth = 0, pDepth = 0, bDepth = 0;
  for (let i = idx + 1; i < tokens.length; i++) {
    const v = tokens[i].val;
    if (v === '<') aDepth++;
    else if (v === '>' && aDepth > 0) aDepth--;
    else if (v === '(' || v === '[') pDepth++;
    else if ((v === ')' || v === ']') && pDepth > 0) pDepth--;
    else if (v === '{' && aDepth === 0 && pDepth === 0 && bDepth === 0) return i;
    else if (v === '{' || v === '${') bDepth++;
    else if (v === '}') {
      if (bDepth === 0) return -1;
      bDepth--;
    } else if (v === ';' && aDepth === 0 && pDepth === 0 && bDepth === 0) return -1;
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

function cogFindArrowCloseParen(tokens, arrowIdx) {
  if (tokens[arrowIdx - 1]?.val === ')') return arrowIdx - 1;
  let depth = 0;
  for (let i = arrowIdx - 1; i >= 0; i--) {
    const v = tokens[i].val;
    if (v === '>' || v === ')' || v === ']' || v === '}') depth++;
    else if ((v === '<' || v === '(' || v === '[' || v === '{') && depth > 0) depth--;
    else if (v === ':' && depth === 0 && tokens[i - 1]?.val === ')') return i - 1;
    else if ((v === ';' || v === '=' || v === '=>' || v === '{') && depth === 0) break;
  }
  return -1;
}

function cogInferArrowName(tokens, arrowIdx) {
  if (tokens[arrowIdx - 1]?.type === 'id' && tokens[arrowIdx - 2]?.val === '=' && tokens[arrowIdx - 3]?.type === 'id') {
    return tokens[arrowIdx - 3].val;
  }
  const closeP = cogFindArrowCloseParen(tokens, arrowIdx);
  if (closeP < 0) return '<arrow>';
  const openP = cogFindOpenRev(tokens, closeP);
  if (openP <= 0) return '<arrow>';
  let cur = openP - 1;
  if (tokens[cur]?.val === '>') {
    let aDepth = 0;
    while (cur >= 0) {
      if (tokens[cur].val === '>') aDepth++;
      else if (tokens[cur].val === '<' && --aDepth === 0) { cur--; break; }
      cur--;
    }
  }
  const eqIdx = tokens[cur]?.val === 'async' ? cur - 1 : cur;
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
    cur = cogSkipBalancedAngles(tokens, cur);
    if (tokens[cur]?.val !== '(') return null;
    const closeP = cogFindClose(tokens, cur, '(', ')');
    if (closeP < 0) return null;
    const bodyOpen = cogSkipTsReturnType(tokens, closeP + 1);
    if (bodyOpen < 0 || tokens[bodyOpen]?.val !== '{') return null;
    const closeB = cogFindClose(tokens, bodyOpen, '{', '}');
    return closeB > bodyOpen ? { name, headIdx: idx, bodyStart: bodyOpen, bodyEnd: closeB } : null;
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

const COG_METHOD_SKIP_PREV = new Set(['.', 'new', 'return', 'typeof', 'void', 'delete', 'throw', 'case', 'else', 'in', 'of']);

function cogMatchClassMethodAt(tokens, idx, className) {
  const tk = tokens[idx];
  if (tk.type !== 'id' || tk.isProp) return null;
  if (idx > 0 && COG_METHOD_SKIP_PREV.has(tokens[idx - 1]?.val)) return null;
  const cur = cogSkipBalancedAngles(tokens, idx + 1);
  if (tokens[cur]?.val !== '(') return null;
  const closeP = cogFindClose(tokens, cur, '(', ')');
  if (closeP < 0) return null;
  const bodyOpen = cogSkipTsReturnType(tokens, closeP + 1);
  if (bodyOpen < 0 || tokens[bodyOpen]?.val !== '{') return null;
  const closeB = cogFindClose(tokens, bodyOpen, '{', '}');
  if (closeB <= bodyOpen) return null;
  const methodName = className ? `${className}.${tk.val}` : tk.val;
  return { name: methodName, headIdx: idx, bodyStart: bodyOpen, bodyEnd: closeB };
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

function cogStepDoKeyword(i, endIdx, tokens, depth, st) {
  st.score += 1 + depth;
  const bodyStart = i + 1;
  let afterBody = bodyStart;
  if (tokens[bodyStart]?.val === '{') {
    const closeB = cogFindClose(tokens, bodyStart, '{', '}');
    if (closeB > bodyStart) {
      st.nestEnds.push(Math.min(closeB - 1, endIdx));
      afterBody = closeB + 1;
    }
  } else {
    const stmtEnd = cogScanExprEnd(tokens, bodyStart, endIdx);
    st.nestEnds.push(stmtEnd);
    afterBody = stmtEnd + 1;
  }
  if (tokens[afterBody]?.type === 'kw' && tokens[afterBody].val === 'while') st.doWhileSet.add(afterBody);
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
  if (v === 'do') { cogStepDoKeyword(i, endIdx, tokens, depth, st); return; }
  if (!LOOP_OR_BRANCH_KWS.has(v) || (v === 'while' && st.doWhileSet.has(i))) return;
  if (!st.elseIfSet.has(i)) st.score += 1 + depth;
  const cp = tokens[i + 1]?.val === '(' ? cogFindClose(tokens, i + 1, '(', ')') : -1;
  cogPushBodyEnd(tokens, cp > i ? cp + 1 : i + 1, endIdx, st.nestEnds);
}

function cogScoreTokenRange(tokens, startIdx, endIdx) {
  const st = { nestEnds: [], elseIfSet: new Set(), doWhileSet: new Set(), score: 0, maxNest: 0, lastLogicOp: null, ternaryPending: 0 };
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

function cogMatchTopOrMethodFn(tokens, i, braceDepth, activeClass) {
  const tk = tokens[i];
  if (braceDepth === 0 && ((tk.type === 'kw' && tk.val === 'function') || (tk.type === 'op' && tk.val === '=>'))) {
    return cogMatchFunctionAt(tokens, i);
  }
  if (activeClass && braceDepth === activeClass.depth && tk.type === 'id') {
    return cogMatchClassMethodAt(tokens, i, activeClass.name);
  }
  return null;
}

function cogStepClassBrace(tk, scanSt) {
  if (tk.type === 'kw' && tk.val === 'class') {
    const next = scanSt.tokens[scanSt.i + 1];
    scanSt.pendingClass = { name: next?.type === 'id' ? next.val : '<class>' };
  }
  if (tk.val === '{' || tk.val === '${') {
    scanSt.braceDepth++;
    if (tk.val === '{' && scanSt.pendingClass) {
      scanSt.classStack.push({ name: scanSt.pendingClass.name, depth: scanSt.braceDepth });
      scanSt.pendingClass = null;
    }
  } else if (tk.val === '}' && scanSt.braceDepth > 0) {
    const top = scanSt.classStack[scanSt.classStack.length - 1];
    if (top && scanSt.braceDepth === top.depth) scanSt.classStack.pop();
    scanSt.braceDepth--;
  }
}

export function analyzeCodeComplexityAndGolfing(text) {
  const tokens = cogTokenizeJs(text), topFunctions = [];
  const scanSt = { tokens, i: 0, braceDepth: 0, pendingClass: null, classStack: [] };
  for (let i = 0; i < tokens.length; i++) {
    scanSt.i = i;
    const activeClass = scanSt.classStack[scanSt.classStack.length - 1];
    const fn = cogMatchTopOrMethodFn(tokens, i, scanSt.braceDepth, activeClass);
    if (fn) {
      const { score, maxNest } = cogScoreTokenRange(tokens, fn.bodyStart, fn.bodyEnd);
      topFunctions.push({ name: fn.name, startLine: tokens[fn.headIdx].line, endLine: tokens[fn.bodyEnd].line, cognitiveComplexity: score, maxNesting: maxNest });
    }
    cogStepClassBrace(tokens[i], scanSt);
  }
  const golfingIssues = cogDetectGolfing(text, tokens);
  const maxCognitive = topFunctions.reduce((mx, f) => Math.max(mx, f.cognitiveComplexity), 0);
  return { functions: topFunctions, maxCognitive, golfingIssues };
}

const AUDIT_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.venv', 'venv', '__pycache__', '.deps', 'dist', '_dist', 'build', 'coverage', 'vendor', 'tests', 'test', '__tests__'];
const AUDIT_JS_EXTS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx']);

function cogDiscoverAuditDirs(projectRoot) {
  const isSelf = existsSync(join(projectRoot, 'runner', 'donegate.mjs')) && existsSync(join(projectRoot, 'skill', 'check-commit-hygiene.mjs'));
  if (isSelf) return { dirs: ['runner', 'skill'], isDoneGateSelf: true };
  const stdDirs = ['src', 'lib', 'app', 'packages', 'runner', 'skill'].filter((d) => existsSync(join(projectRoot, d)));
  return { dirs: stdDirs.length > 0 ? stdDirs : ['.'], isDoneGateSelf: false };
}

function cogAuditSingleJsFile(projectRoot, absFile, budgets) {
  const rel = relative(projectRoot, absFile).split(sep).join('/');
  if (/(?:-fixtures\.mjs$|^skill\/pilot-|\.(?:test|spec)\.[a-z0-9]+$)/.test(rel)) return null;
  const cx = analyzeCodeComplexityAndGolfing(readFileSync(absFile, 'utf8'));
  const overMaxFns = cx.functions.filter((f) => f.cognitiveComplexity > budgets.maxCognitiveComplexity);
  const warnFns = cx.functions.filter((f) => f.cognitiveComplexity > budgets.warnCognitiveComplexity && f.cognitiveComplexity <= budgets.maxCognitiveComplexity);
  if (overMaxFns.length === 0 && warnFns.length === 0 && cx.golfingIssues.length === 0) return { scanned: true, item: null };
  return { scanned: true, item: { file: rel, maxCognitive: cx.maxCognitive, overMaxFns, warnFns, golfingIssues: cx.golfingIssues } };
}

export function auditRepository4DWithStats(projectRoot, budgets) {
  const { dirs, isDoneGateSelf } = cogDiscoverAuditDirs(projectRoot);
  const items = [];
  let scannedJsFiles = 0;
  let detectedPyFiles = 0;
  for (const d of dirs) {
    const absDir = d === '.' ? projectRoot : join(projectRoot, d);
    if (!existsSync(absDir)) continue;
    for (const absFile of walk(absDir, { skipDirs: AUDIT_SKIP_DIRS }).files) {
      const ext = extname(absFile).toLowerCase();
      if (ext === '.py') { detectedPyFiles++; continue; }
      if (isDoneGateSelf ? ext !== '.mjs' : !AUDIT_JS_EXTS.has(ext)) continue;
      const res = cogAuditSingleJsFile(projectRoot, absFile, budgets);
      if (!res) continue;
      scannedJsFiles++;
      if (res.item) items.push(res.item);
    }
  }
  items.sort((a, b) => b.maxCognitive - a.maxCognitive);
  return { items, scannedJsFiles, detectedPyFiles, scannedRoots: dirs };
}

export function auditRepository4D(projectRoot, budgets) {
  return auditRepository4DWithStats(projectRoot, budgets).items;
}
