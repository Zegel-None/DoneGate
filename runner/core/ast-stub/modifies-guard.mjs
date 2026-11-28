// 导出符号级 modifies 帧写锁与签名变更下游调用方待改义务推导器（<= 260 行）
import { sha256 } from '../../../skill/hash.mjs';
import { maskCommentsAndStrings } from '../js-mask-lexer.mjs';

const STMT_LOOKAHEAD_CAP = 200;
const mgNormPath = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
const mgToIterableArray = (val) => (val instanceof Set ? [...val] : (Array.isArray(val) ? val : []));

function mgCompactSignatureWs(raw) {
  return String(raw || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),:;{}])\s*/g, '$1 ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function mgConsumeQuotedLiteral(src, startIdx) {
  const quote = src[startIdx];
  let i = startIdx + 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return src.length;
}

function mgStepLiteralOrComment(src, i) {
  const ch = src[i], next = src[i + 1] || '';
  if (ch === "'" || ch === '"' || ch === '`') {
    const end = mgConsumeQuotedLiteral(src, i);
    return { chunk: src.slice(i, end), nextIdx: end };
  }
  if (ch === '/' && next === '/') {
    const nl = src.indexOf('\n', i + 2);
    return { chunk: ' ', nextIdx: nl < 0 ? src.length : nl + 1 };
  }
  if (ch === '/' && next === '*') {
    const end = src.indexOf('*/', i + 2);
    return { chunk: ' ', nextIdx: end < 0 ? src.length : end + 2 };
  }
  return { chunk: ch, nextIdx: i + 1 };
}

export function mgNormalizeCodePreservingLiterals(rawSlice) {
  const src = String(rawSlice || ''), parts = [];
  let i = 0;
  while (i < src.length) {
    const step = mgStepLiteralOrComment(src, i);
    parts.push(step.chunk);
    i = step.nextIdx;
  }
  return parts.join('').replace(/\s+/g, ' ').replace(/\s*([{}()[\];,:])\s*/g, '$1').trim();
}

function mgFindBalanced(masked, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === openCh) depth++;
    else if (masked[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

function mgFindVarStatementEnd(masked, rhsStart) {
  let depth = 0;
  for (let i = rhsStart; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && ch === ';') return i + 1;
    if (depth === 0 && ch === '\n') {
      const prev = masked.slice(rhsStart, i).trimEnd();
      if (prev && !prev.endsWith('=>') && !prev.endsWith('=')) return i;
    }
  }
  return masked.length;
}

function mgBuildVarSignature(source, masked, kind, name, rawType, rhsStart) {
  const typeSuffix = rawType ? `: ${mgCompactSignatureWs(rawType)}` : '';
  const slice = masked.slice(rhsStart, rhsStart + STMT_LOOKAHEAD_CAP);
  const fnHead = slice.match(/^(async\s+)?(?:function\s*)?\(/);
  if (fnHead) {
    const openIdx = rhsStart + slice.indexOf('('), closeIdx = mgFindBalanced(masked, openIdx, '(', ')');
    const params = closeIdx > openIdx ? mgCompactSignatureWs(source.slice(openIdx, closeIdx + 1)) : '(...args)';
    return `export ${fnHead[1] ? 'async ' : ''}function ${name}${params}${typeSuffix};`;
  }
  const singleArrow = slice.match(/^(async\s+)?([A-Za-z_$][\w$]*)\s*=>/);
  if (singleArrow) return `export ${singleArrow[1] ? 'async ' : ''}function ${name}(${singleArrow[2]})${typeSuffix};`;
  return `export ${kind} ${name}${typeSuffix};`;
}

function mgFormatFnSignatureHead(m, symbol, headerTail) {
  const kwParts = ['export'];
  if (m[2]) kwParts.push('default');
  if (m[3]) kwParts.push('async');
  kwParts.push(m[4] ? 'function*' : 'function');
  return `${kwParts.join(' ')} ${symbol}${headerTail};`;
}

function mgExtractFunctionExports(source, masked, map) {
  const fnRe = /(?:^|\n)\s*(export\s+(default\s+)?(async\s+)?function(\s*\*)?\s*([A-Za-z_$][\w$]*)?\s*\()/g;
  for (const m of masked.matchAll(fnRe)) {
    const declStart = m.index + m[0].indexOf('export'), openParen = m.index + m[0].length - 1;
    const closeParen = mgFindBalanced(masked, openParen, '(', ')');
    if (closeParen < 0) continue;
    const openBrace = masked.indexOf('{', closeParen + 1);
    const closeBrace = openBrace >= 0 ? mgFindBalanced(masked, openBrace, '{', '}') : -1;
    const endIdx = closeBrace > openBrace ? closeBrace + 1 : closeParen + 1, symbol = m[5] || 'default';
    const headerTail = mgCompactSignatureWs(source.slice(openParen, openBrace > closeParen ? openBrace : endIdx));
    map.set(symbol, { symbol, signature: mgFormatFnSignatureHead(m, symbol, headerTail), bodyHash: sha256(mgNormalizeCodePreservingLiterals(source.slice(declStart, endIdx))) });
  }
}

function mgExtractClassExports(source, masked, map) {
  const clsRe = /(?:^|\n)\s*(export\s+(default\s+)?class\s+([A-Za-z_$][\w$]*)([^{\n]*)\{)/g;
  for (const m of masked.matchAll(clsRe)) {
    const declStart = m.index + m[0].indexOf('export'), openBrace = m.index + m[0].length - 1;
    const closeBrace = mgFindBalanced(masked, openBrace, '{', '}');
    const endIdx = closeBrace > openBrace ? closeBrace + 1 : openBrace + 1, symbol = m[3];
    const heritage = mgCompactSignatureWs(source.slice(m.index + m[0].indexOf(symbol) + symbol.length, openBrace));
    const defKw = m[2] ? 'default ' : '', heritageTail = heritage ? ` ${heritage}` : '';
    map.set(symbol, { symbol, signature: `export ${defKw}class ${symbol}${heritageTail}`, bodyHash: sha256(mgNormalizeCodePreservingLiterals(source.slice(declStart, endIdx))) });
  }
}

export function extractExportedSymbolFingerprints(source, ext = '.mjs') {
  const raw = String(source || ''), masked = maskCommentsAndStrings(raw, ext), map = new Map();
  mgExtractFunctionExports(raw, masked, map);
  mgExtractClassExports(raw, masked, map);
  const varRe = /(?:^|\n)\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n]+?))?\s*=\s*/g;
  for (const m of masked.matchAll(varRe)) {
    const declStart = m.index + m[0].indexOf('export'), rhsStart = m.index + m[0].length, stmtEnd = mgFindVarStatementEnd(masked, rhsStart);
    const symbol = m[2], signature = mgBuildVarSignature(raw, masked, m[1], symbol, m[3] || '', rhsStart);
    map.set(symbol, { symbol, signature, bodyHash: sha256(mgNormalizeCodePreservingLiterals(raw.slice(declStart, stmtEnd))) });
  }
  return map;
}

function mgBuildAllowedSymbolChecker(allowedSymbols, relPath) {
  const exactSet = new Set(), bareSet = new Set();
  for (const raw of mgToIterableArray(allowedSymbols)) {
    const item = String(raw || '').trim();
    if (!item) continue;
    if (item === '*') return { allowedList: ['*'], isAllowed: () => true };
    exactSet.add(item);
    if (!item.includes('::') || !relPath || item.startsWith(`${relPath}::`)) bareSet.add(item.split('::').pop());
  }
  return { allowedList: [...exactSet], isAllowed: (sym) => bareSet.has(sym) || Boolean(relPath && exactSet.has(`${relPath}::${sym}`)) };
}

function mgDiffExistingSymbol(sym, prev, curr, relPath, isAllowed, acc) {
  if (!curr) {
    acc.modifiedSymbols.push(sym);
    acc.signatureChanges.push({ symbol: sym, file: relPath || null, changeKind: 'removed', beforeSignature: prev.signature, afterSignature: null });
    if (!isAllowed(sym)) acc.violations.push({ symbol: sym, kind: 'deleted_unauthorized_export', beforeSignature: prev.signature, afterSignature: null, reason: `MODIFIES_VIOLATION: 未授权删除导出符号 ${sym}` });
    return;
  }
  const sigChanged = curr.signature !== prev.signature, bodyChanged = curr.bodyHash !== prev.bodyHash;
  if (!sigChanged && !bodyChanged) return;
  acc.modifiedSymbols.push(sym);
  if (sigChanged) acc.signatureChanges.push({ symbol: sym, file: relPath || null, changeKind: 'signature_changed', beforeSignature: prev.signature, afterSignature: curr.signature });
  if (!isAllowed(sym)) {
    const kind = sigChanged ? 'signature_tampered' : 'implementation_tampered';
    acc.violations.push({ symbol: sym, kind, beforeSignature: prev.signature, afterSignature: curr.signature, reason: `MODIFIES_VIOLATION: 未获 modifiesSymbols 授权篡改导出符号 ${sym} (${kind})` });
  }
}

export function verifyAllowedModifiedSymbols(beforeSrc, afterSrc, allowedSymbols = [], opts = {}) {
  const relPath = mgNormPath(opts.relPath || opts.file || '');
  const ext = opts.ext || (relPath.includes('.') ? `.${relPath.split('.').pop().toLowerCase()}` : '.mjs');
  const { allowedList, isAllowed } = mgBuildAllowedSymbolChecker(allowedSymbols, relPath);
  const beforeMap = extractExportedSymbolFingerprints(beforeSrc, ext), afterMap = extractExportedSymbolFingerprints(afterSrc, ext);
  const acc = { modifiedSymbols: [], signatureChanges: [], violations: [] };
  for (const [sym, prev] of beforeMap.entries()) mgDiffExistingSymbol(sym, prev, afterMap.get(sym), relPath, isAllowed, acc);
  for (const [sym, curr] of afterMap.entries()) {
    if (beforeMap.has(sym)) continue;
    acc.modifiedSymbols.push(sym);
    if (!opts.allowNewExports && !isAllowed(sym)) acc.violations.push({ symbol: sym, kind: 'added_unauthorized_export', beforeSignature: null, afterSignature: curr.signature, reason: `MODIFIES_VIOLATION: 未授权新增导出符号 ${sym}` });
  }
  const ok = acc.violations.length === 0;
  return { ok, exitCode: ok ? 0 : 1, code: ok ? 'MODIFIES_FRAME_CLEAN' : 'MODIFIES_FRAME_VIOLATION', allowedSymbols: allowedList, modifiedSymbols: acc.modifiedSymbols, unauthorizedSymbols: acc.violations.map((v) => v.symbol), signatureChanges: acc.signatureChanges, violations: acc.violations };
}

function mgParseSingleChangedItem(item) {
  if (typeof item === 'string' && item.trim()) {
    const clean = item.trim(), parts = clean.includes('::') ? clean.split('::') : [null, clean];
    return { file: parts[0] ? mgNormPath(parts[0]) : null, symbol: parts[1], key: clean };
  }
  if (!item || typeof item !== 'object' || !item.symbol) return null;
  if (item.beforeSignature !== undefined && item.afterSignature !== undefined && item.beforeSignature === item.afterSignature) return null;
  const file = item.file ? mgNormPath(item.file) : null, sym = String(item.symbol).trim();
  return { file, symbol: sym, key: file ? `${file}::${sym}` : sym };
}

function mgAddCallerBucketEntry(buckets, key, rawCaller) {
  const file = mgNormPath(typeof rawCaller === 'string' ? rawCaller : (rawCaller?.file || rawCaller?.callerFile || rawCaller?.from || ''));
  if (!file) return;
  if (!buckets.has(key)) buckets.set(key, new Set());
  buckets.get(key).add(file);
}

function mgAddEdgeEntries(edgeArr, buckets) {
  for (const e of edgeArr) {
    const sym = String(e?.calleeSymbol || e?.symbol || e?.toSymbol || '').trim(), tgtFile = e?.targetFile || e?.calleeFile || e?.toFile;
    if (!sym) continue;
    mgAddCallerBucketEntry(buckets, sym, e);
    if (tgtFile) mgAddCallerBucketEntry(buckets, `${mgNormPath(tgtFile)}::${sym}`, e);
  }
}

function mgBuildCallerBuckets(callerGraph) {
  const buckets = new Map();
  if (!callerGraph) return buckets;
  const edgeArr = Array.isArray(callerGraph) ? callerGraph : (Array.isArray(callerGraph.edges) ? callerGraph.edges : null);
  if (edgeArr) {
    mgAddEdgeEntries(edgeArr, buckets);
    return buckets;
  }
  for (const [k, list] of (callerGraph instanceof Map ? [...callerGraph.entries()] : Object.entries(callerGraph))) {
    for (const c of mgToIterableArray(list instanceof Set || Array.isArray(list) ? list : [list])) mgAddCallerBucketEntry(buckets, k.trim(), c);
  }
  return buckets;
}

export function computeSignatureChangeObligations(changedSymbols, callerGraph, opts = {}) {
  const normSymbols = mgToIterableArray(changedSymbols).map(mgParseSingleChangedItem).filter(Boolean), buckets = mgBuildCallerBuckets(callerGraph), byFile = new Map();
  for (const item of normSymbols) {
    const merged = new Set([...(buckets.get(item.file ? `${item.file}::${item.symbol}` : '') || []), ...(buckets.get(item.symbol) || [])]);
    for (const callerFile of merged) {
      if (item.file && callerFile === item.file && !opts.includeDefiningFile) continue;
      if (!byFile.has(callerFile)) byFile.set(callerFile, new Set());
      byFile.get(callerFile).add(item.key);
    }
  }
  const sortedFiles = [...byFile.keys()].sort();
  const obligations = sortedFiles.map((file) => {
    const symbols = [...byFile.get(file)].sort();
    return { file, symbols, reasons: symbols.map((s) => `上游导出签名变更 (${s})，需同步核验并更新调用点 ${file}`) };
  });
  return { changedSymbols: normSymbols.map((s) => s.key), affectedFiles: sortedFiles, obligations, totalObligations: obligations.length };
}
