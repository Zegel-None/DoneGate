// 零依赖 JS/TS/Py 词法掩码原语：支持嵌套模板字符串 `${`...`}`、正则字面量与多行注释无偏掩码（<= 350 行）
const REGEX_PREV_KW = new Set(['return', 'case', 'throw', 'typeof', 'void', 'delete', 'in', 'of', 'await', 'yield']);

function jmlBlankRange(out, from, to) {
  for (let k = from; k < to; k++) {
    if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  }
}

export function canStartRegexLiteral(src, slashIdx) {
  let p = slashIdx - 1;
  while (p >= 0 && /\s/.test(src[p])) p--;
  if (p < 0 || '(,=:[!&|?{};~^%+-*<>'.includes(src[p])) return true;
  if (/[A-Za-z_$]/.test(src[p])) {
    const kwEnd = p + 1;
    while (p >= 0 && /[A-Za-z0-9_$]/.test(src[p])) p--;
    return REGEX_PREV_KW.has(src.slice(p + 1, kwEnd));
  }
  return false;
}

export function scanRegexLiteralEnd(src, slashIdx) {
  let inCharClass = false;
  for (let i = slashIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n' || ch === '\r') return -1;
    if (ch === '\\') { i++; continue; }
    if (ch === '[') inCharClass = true;
    else if (ch === ']') inCharClass = false;
    else if (ch === '/' && !inCharClass) return i + 1;
  }
  return -1;
}

function jmlFindSimpleQuoteEnd(src, start, delim) {
  let i = start;
  while (i < src.length && !src.startsWith(delim, i)) {
    i += src[i] === '\\' ? 2 : 1;
  }
  return Math.min(src.length, i + delim.length);
}

function jmlSkipCommentAt(src, i) {
  const c2 = src.slice(i, i + 2);
  if (c2 === '//') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl;
  }
  if (c2 === '/*') {
    const cl = src.indexOf('*/', i + 2);
    return cl < 0 ? src.length : cl + 2;
  }
  return -1;
}

function jmlAdvanceInsideExpr(src, i) {
  const afterCom = jmlSkipCommentAt(src, i);
  if (afterCom >= 0) return afterCom;
  const ch = src[i];
  if (ch === '"' || ch === "'") return jmlFindSimpleQuoteEnd(src, i + 1, ch);
  if (ch === '`') return scanTemplateLiteralEnd(src, i);
  if (ch === '/' && canStartRegexLiteral(src, i)) {
    const reEnd = scanRegexLiteralEnd(src, i);
    return reEnd > i + 1 ? reEnd : i + 1;
  }
  return -1;
}

function jmlScanTemplateExprEnd(src, exprStart) {
  let depth = 1;
  let i = exprStart;
  while (i < src.length && depth > 0) {
    const jumped = jmlAdvanceInsideExpr(src, i);
    if (jumped >= 0) { i = jumped; continue; }
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return i;
}

export function scanTemplateLiteralEnd(src, openTickIdx) {
  let i = openTickIdx + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '`') return i + 1;
    if (src[i] === '$' && src[i + 1] === '{') {
      i = jmlScanTemplateExprEnd(src, i + 2);
      continue;
    }
    i++;
  }
  return src.length;
}

function jmlMaskComment(src, out, i, isPy) {
  const n = src.length, c2 = src.slice(i, i + 2);
  if ((!isPy && c2 === '//') || (isPy && src[i] === '#')) {
    const nl = src.indexOf('\n', i);
    const end = nl < 0 ? n : nl;
    jmlBlankRange(out, i, end);
    return end;
  }
  if (!isPy && c2 === '/*') {
    const close = src.indexOf('*/', i + 2);
    const end = close < 0 ? n : close + 2;
    jmlBlankRange(out, i, end);
    return end;
  }
  return -1;
}

function jmlMaskString(src, out, i, isPy) {
  const c = src[i], c3 = src.slice(i, i + 3);
  if (isPy && (c3 === '"""' || c3 === "'''")) {
    const end = jmlFindSimpleQuoteEnd(src, i + 3, c3);
    jmlBlankRange(out, i, end);
    return end;
  }
  if (!isPy && c === '`') {
    const end = scanTemplateLiteralEnd(src, i);
    jmlBlankRange(out, i + 1, Math.max(i + 1, end - 1));
    return end;
  }
  if (c === '"' || c === "'") {
    const end = jmlFindSimpleQuoteEnd(src, i + 1, c);
    jmlBlankRange(out, i + 1, Math.max(i + 1, end - 1));
    return end;
  }
  return -1;
}

export function maskCommentsAndStrings(src, ext = '.mjs') {
  const out = src.split(''), n = src.length, isPy = ext === '.py';
  let i = 0;
  while (i < n) {
    const afterComment = jmlMaskComment(src, out, i, isPy);
    if (afterComment >= 0) { i = afterComment; continue; }
    if (!isPy && src[i] === '/' && canStartRegexLiteral(src, i)) {
      const regEnd = scanRegexLiteralEnd(src, i);
      if (regEnd > i + 1) jmlBlankRange(out, i + 1, regEnd - 1);
      i = regEnd > i + 1 ? regEnd : i + 1;
      continue;
    }
    const afterStr = jmlMaskString(src, out, i, isPy);
    i = afterStr >= 0 ? afterStr : i + 1;
  }
  return out.join('');
}

export function stripCommentsKeepStrings(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const afterComment = jmlMaskComment(src, out, i, false);
    if (afterComment >= 0) { i = afterComment; continue; }
    if (src[i] === '`') { i = scanTemplateLiteralEnd(src, i); continue; }
    if (src[i] === '"' || src[i] === "'") { i = jmlFindSimpleQuoteEnd(src, i + 1, src[i]); continue; }
    if (src[i] === '/' && canStartRegexLiteral(src, i)) {
      const regEnd = scanRegexLiteralEnd(src, i);
      i = regEnd > i + 1 ? regEnd : i + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}
