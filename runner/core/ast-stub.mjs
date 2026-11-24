// L1 邻域接口存根剥离器（保留前置 JSDoc 契约注释 + 伴生子模块闭包 + 桶文件门面重导出解引用与 HTTP 路由契约提取）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { enrichBarrelFacadeExports, extractHttpRouteContracts } from './barrel-stub-enrich.mjs';

const CODE_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);
const SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const FACADE_BASENAMES = new Set(['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'contract.mjs', 'contract.js', 'contract.ts']);
const REGEX_PREV_KW = new Set(['return', 'case', 'throw', 'typeof', 'void', 'delete', 'in', 'of', 'await', 'yield']);

function canStartRegexLiteral(src, slashIdx) {
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

function scanRegexLiteralEnd(src, slashIdx) {
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

function astStubBlankRange(out, from, to) {
  for (let k = from; k < to; k++) {
    if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  }
}

function astStubFindClosingDelim(src, start, delim) {
  let i = start;
  while (i < src.length && !src.startsWith(delim, i)) {
    i += src[i] === '\\' ? 2 : 1;
  }
  return Math.min(src.length, i + delim.length);
}

function astStubMaskComment(src, out, i, isPy) {
  const n = src.length, c2 = src.slice(i, i + 2);
  if ((!isPy && c2 === '//') || (isPy && src[i] === '#')) {
    const nl = src.indexOf('\n', i);
    const end = nl < 0 ? n : nl;
    astStubBlankRange(out, i, end);
    return end;
  }
  if (!isPy && c2 === '/*') {
    const close = src.indexOf('*/', i + 2);
    const end = close < 0 ? n : close + 2;
    astStubBlankRange(out, i, end);
    return end;
  }
  return -1;
}

function astStubMaskString(src, out, i, isPy) {
  const c = src[i], c3 = src.slice(i, i + 3);
  if (isPy && (c3 === '"""' || c3 === "'''")) {
    const end = astStubFindClosingDelim(src, i + 3, c3);
    astStubBlankRange(out, i, end);
    return end;
  }
  if (c === '"' || c === "'" || (!isPy && c === '`')) {
    const end = astStubFindClosingDelim(src, i + 1, c);
    astStubBlankRange(out, i + 1, Math.max(i + 1, end - 1));
    return end;
  }
  return -1;
}

export function maskCommentsAndStrings(src, ext = '.mjs') {
  const out = src.split(''), n = src.length, isPy = ext === '.py';
  let i = 0;
  while (i < n) {
    const afterComment = astStubMaskComment(src, out, i, isPy);
    if (afterComment >= 0) { i = afterComment; continue; }
    if (!isPy && src[i] === '/' && canStartRegexLiteral(src, i)) {
      const regEnd = scanRegexLiteralEnd(src, i);
      if (regEnd > i + 1) astStubBlankRange(out, i + 1, regEnd - 1);
      i = regEnd > i + 1 ? regEnd : i + 1;
      continue;
    }
    const afterStr = astStubMaskString(src, out, i, isPy);
    i = afterStr >= 0 ? afterStr : i + 1;
  }
  return out.join('');
}

function findBalancedEnd(masked, startIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = startIdx; i < masked.length; i++) {
    if (masked[i] === openCh) depth++;
    else if (masked[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

const compactWs = (t) => t.replace(/\s+/g, ' ').replace(/\s*([(),:;])\s*/g, '$1 ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function extractLeadingJsDoc(source, matchStart, matchStr) {
  const kwPos = matchStr.search(/\bexport\b/);
  const declIndex = matchStart + (kwPos >= 0 ? kwPos : 0);
  const win = source.slice(Math.max(0, declIndex - 1600), declIndex);
  const endComment = win.search(/\*\/\s*$/);
  if (endComment < 0) return '';
  const lastOpen = win.lastIndexOf('/**', endComment);
  if (lastOpen < 0 || win.slice(lastOpen + 3, endComment).includes('*/')) return '';
  return win.slice(lastOpen, endComment + 2).trim();
}

function extractJsClassMethods(rawBlock, maskedBlock) {
  const methods = [];
  const methodRe = /(?:^|\n)\s*(?:(async|static|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of maskedBlock.matchAll(methodRe)) {
    const name = m[2];
    if (!name || /^(if|for|while|switch|catch)$/.test(name)) continue;
    const openParen = m.index + m[0].length - 1;
    const closeParen = findBalancedEnd(maskedBlock, openParen, '(', ')');
    if (closeParen < 0) continue;
    methods.push(`${m[1] ? m[1] + ' ' : ''}${name}${compactWs(rawBlock.slice(openParen, closeParen + 1))};`);
  }
  return methods;
}

function astStubFormatVarExport(source, masked, m) {
  const [kind, name, rawType] = [m[1], m[2], m[3] ? compactWs(m[3]) : ''];
  const doc = extractLeadingJsDoc(source, m.index, m[0]);
  const typeSuffix = rawType ? `: ${rawType}` : '';
  const rhsStart = m.index + m[0].length, rhsSlice = masked.slice(rhsStart, rhsStart + 200);
  const arrowParen = rhsSlice.match(/^(async\s+)?\(/), arrowIdent = rhsSlice.match(/^(async\s+)?([A-Za-z_$][\w$]*)\s*=>/);
  const fnExpr = rhsSlice.match(/^(async\s+)?function\s*\(/);
  if (arrowParen || fnExpr) {
    const openIdx = rhsStart + rhsSlice.indexOf('('), closeIdx = findBalancedEnd(masked, openIdx, '(', ')');
    const params = closeIdx > openIdx ? compactWs(source.slice(openIdx, closeIdx + 1)) : '(...args)';
    const asyncPref = (arrowParen?.[1] || fnExpr?.[1]) ? 'async ' : '';
    return { symbol: name, doc, signature: `export ${asyncPref}function ${name}${params}${typeSuffix};` };
  }
  if (arrowIdent) {
    const asyncPref = arrowIdent[1] ? 'async ' : '';
    return { symbol: name, doc, signature: `export ${asyncPref}function ${name}(${arrowIdent[2]});` };
  }
  if (rhsSlice.trimStart().startsWith('{')) {
    const openBrace = rhsStart + rhsSlice.indexOf('{'), closeBrace = findBalancedEnd(masked, openBrace, '{', '}');
    const objSlice = closeBrace > openBrace ? masked.slice(openBrace + 1, Math.min(closeBrace, openBrace + 2400)) : '';
    const keys = [...objSlice.matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*(?::|\()/g)].map((k) => k[1]).slice(0, 24);
    const inferredType = keys.length > 0 ? `{ ${keys.join(', ')} }` : 'Record<string, unknown>';
    return { symbol: name, doc, signature: `export ${kind} ${name}: ${rawType || inferredType};` };
  }
  return { symbol: name, doc, signature: `export ${kind} ${name}${typeSuffix};` };
}

function extractJsTsExports(source) {
  const masked = maskCommentsAndStrings(source, '.ts');
  const entries = [];
  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(default\s+)?(async\s+)?function(\s*\*)?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const openParen = m.index + m[0].length - 1, closeParen = findBalancedEnd(masked, openParen, '(', ')');
    if (closeParen < 0) continue;
    let tailEnd = closeParen + 1;
    while (tailEnd < masked.length && !'{;\n'.includes(masked[tailEnd])) tailEnd++;
    const name = m[4] || 'defaultExport';
    const defPref = m[1] ? 'default ' : '', asyncPref = m[2] ? 'async ' : '', genStar = m[3] ? '* ' : '';
    entries.push({ symbol: name, doc: extractLeadingJsDoc(source, m.index, m[0]), signature: `export ${defPref}${asyncPref}function ${genStar}${name}${compactWs(source.slice(openParen, tailEnd))};` });
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(default\s+)?class\s+([A-Za-z_$][\w$]*)([^{\n]*)\{/g)) {
    const openBrace = m.index + m[0].length - 1, closeBrace = findBalancedEnd(masked, openBrace, '{', '}'), name = m[2];
    const heritage = compactWs(source.slice(m.index + m[0].indexOf(name) + name.length, openBrace));
    const methods = closeBrace > openBrace ? extractJsClassMethods(source.slice(openBrace + 1, closeBrace), masked.slice(openBrace + 1, closeBrace)) : [];
    const defPref = m[1] ? 'default ' : '', heritagePart = heritage ? ` ${heritage}` : '';
    const bodyPart = methods.length > 0 ? ` { ${methods.join(' ')} }` : ' {}';
    entries.push({ symbol: name, doc: extractLeadingJsDoc(source, m.index, m[0]), signature: `export ${defPref}class ${name}${heritagePart}${bodyPart}` });
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n]+?))?\s*=\s*/g)) {
    entries.push(astStubFormatVarExport(source, masked, m));
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(interface|type|enum)\s+([A-Za-z_$][\w$]*)([^\n;{]*)(?:\{|;|=)/g)) {
    const doc = extractLeadingJsDoc(source, m.index, m[0]), kwPos = m[0].search(/\bexport\b/), declIdx = m.index + (kwPos >= 0 ? kwPos : 0);
    const openBrace = (m[1] === 'interface' || m[1] === 'enum') ? source.indexOf('{', declIdx) : -1;
    const closeBrace = openBrace >= 0 ? findBalancedEnd(masked, openBrace, '{', '}') : -1, tail = compactWs(m[3]);
    const sig = (closeBrace > openBrace && closeBrace - openBrace <= 1600) ? compactWs(source.slice(declIdx, closeBrace + 1)) : `export ${m[1]} ${m[2]}${tail ? ' ' + tail : ''};`;
    entries.push({ symbol: m[2], doc, signature: sig });
  }
  for (const m of source.matchAll(/(?:^|\n)\s*export\s+(\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]+\})\s*(?:from\s*(['"][^'"]+['"]))?\s*;?/g)) {
    if (masked[m.index + m[0].indexOf('export')] === ' ') continue;
    const clause = compactWs(m[1]), fromPart = m[2] ? ` from ${m[2]}` : '';
    entries.push({ symbol: `reexport:${clause}${fromPart}`, doc: '', signature: `export ${clause}${fromPart};` });
  }
  return entries;
}

function extractPyOrGoExports(source, ext) {
  const masked = maskCommentsAndStrings(source, ext);
  const entries = [];
  if (ext === '.py') {
    for (const m of masked.matchAll(/^(async\s+def|def|class)\s+([A-Za-z][\w]*)\s*(\([^)]*\))?\s*(?:->\s*([^:\n]+))?:/gm)) {
      if (!m[2].startsWith('_')) entries.push({ symbol: m[2], doc: '', signature: `${compactWs(source.slice(m.index, source.indexOf(':', m.index)))}: ...` });
    }
  } else if (ext === '.go') {
    for (const m of masked.matchAll(/^func\s+([A-Z][\w]*)\s*\(/gm)) {
      const openParen = m.index + m[0].length - 1, closeParen = findBalancedEnd(masked, openParen, '(', ')');
      if (closeParen < 0) continue;
      let endIdx = closeParen + 1;
      while (endIdx < masked.length && !'{\n'.includes(masked[endIdx])) endIdx++;
      entries.push({ symbol: m[1], doc: '', signature: compactWs(source.slice(m.index, endIdx)) });
    }
    for (const m of masked.matchAll(/^type\s+([A-Z][\w]*)\s+(struct|interface)\b/gm)) {
      entries.push({ symbol: m[1], doc: '', signature: `type ${m[1]} ${m[2]}` });
    }
  }
  return entries;
}

export function extractFileInterfaceStub(source, relPath = '') {
  const ext = extname(relPath).toLowerCase() || '.mjs';
  const masked = maskCommentsAndStrings(source, ext);
  let effectiveLines = 0, physicalLines = 0;
  for (const line of source.split(/\r?\n/)) if (line.trim()) physicalLines++;
  for (const line of masked.split(/\r?\n/)) if (line.trim()) effectiveLines++;
  const exports = (ext === '.py' || ext === '.go') ? extractPyOrGoExports(source, ext) : extractJsTsExports(source);
  return { relPath, effectiveLines, physicalLines, sourceChars: source.length, exports };
}

function astStubStatSafe(abs) {
  if (!existsSync(abs)) return null;
  try { return statSync(abs); } catch (err) { void err; return null; }
}

function astStubIsTestRelPath(rel, includeTestDirs) {
  if (includeTestDirs && /(^|\/)(tests?|__tests__)(\/|$)/i.test(rel)) return true;
  return /\.(test|spec)\.[a-z0-9]+$|.*-fixtures\.mjs$/i.test(rel);
}

function astStubWalkCodeIntoSets(projectRoot, absDir, found, relatedTests) {
  const dirCodeFiles = [];
  for (const f of walk(absDir, { skipDirs: SKIP_DIRS }).files) {
    const rel = relative(projectRoot, f).replace(/\\/g, '/');
    if (!CODE_EXTS.has(extname(rel).toLowerCase())) continue;
    if (astStubIsTestRelPath(rel, true)) relatedTests.add(rel);
    else { found.add(rel); dirCodeFiles.push(rel); }
  }
  return dirCodeFiles;
}

function astStubCollectScopeDir(projectRoot, abs, dirClean, found, relatedTests, publicEntries) {
  const dirCodeFiles = astStubWalkCodeIntoSets(projectRoot, abs, found, relatedTests);
  const barrels = dirCodeFiles.filter((f) => {
    const slash = f.lastIndexOf('/');
    const dir = slash >= 0 ? f.slice(0, slash) : '', base = slash >= 0 ? f.slice(slash + 1) : f;
    return dir === dirClean && FACADE_BASENAMES.has(base);
  });
  for (const item of (barrels.length > 0 ? barrels : dirCodeFiles)) publicEntries.add(item);
  return barrels.length > 0;
}

function astStubAddScopeEntry(projectRoot, rawScope, found, relatedTests, publicEntries) {
  const clean = String(rawScope || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = clean ? resolve(projectRoot, clean) : '', st = clean ? astStubStatSafe(abs) : null;
  if (!st) return false;
  if (st.isDirectory()) return astStubCollectScopeDir(projectRoot, abs, clean.replace(/\/+$/, ''), found, relatedTests, publicEntries);
  if (!st.isFile() || !CODE_EXTS.has(extname(clean).toLowerCase())) return false;
  if (astStubIsTestRelPath(clean, false)) relatedTests.add(clean);
  else {
    found.add(clean);
    publicEntries.add(clean);
    const companionAbs = resolve(projectRoot, clean.slice(0, clean.length - extname(clean).length));
    if (astStubStatSafe(companionAbs)?.isDirectory()) astStubWalkCodeIntoSets(projectRoot, companionAbs, found, relatedTests);
  }
  return false;
}

export function resolveNodeScopeFiles(projectRoot, scopes = []) {
  const found = new Set(), relatedTests = new Set(), publicEntries = new Set();
  let hasBarrel = false;
  for (const rawScope of (Array.isArray(scopes) ? scopes : [])) {
    if (astStubAddScopeEntry(projectRoot, rawScope, found, relatedTests, publicEntries)) hasBarrel = true;
  }
  const scopeFiles = [...found].sort();
  const facadeFiles = publicEntries.size > 0 ? [...publicEntries].sort() : scopeFiles;
  return { scopeFiles, relatedTestFiles: [...relatedTests].sort(), facadeMode: hasBarrel ? 'barrel' : 'module-exports', facadeFiles };
}

export function buildNodeInterfaceStub(projectRoot, node) {
  const { scopeFiles, relatedTestFiles, facadeMode, facadeFiles } = resolveNodeScopeFiles(projectRoot, node.scope || []);
  let sourceChars = 0, effectiveLines = 0, physicalLines = 0, maxFileEffectiveLines = 0, maxFile = null;
  const fileMetrics = new Map(), rawByFile = new Map(), scopeSet = new Set(scopeFiles);
  for (const rel of scopeFiles) {
    let raw = '';
    try { raw = readFileSync(join(projectRoot, rel), 'utf8'); } catch (err) { void err; continue; }
    rawByFile.set(rel, raw);
    const parsed = extractFileInterfaceStub(raw, rel);
    sourceChars += parsed.sourceChars;
    effectiveLines += parsed.effectiveLines;
    physicalLines += parsed.physicalLines;
    if (parsed.effectiveLines > maxFileEffectiveLines) { maxFileEffectiveLines = parsed.effectiveLines; maxFile = rel; }
    fileMetrics.set(rel, parsed);
  }
  const barrelEnriched = facadeMode === 'barrel'
    ? enrichBarrelFacadeExports(facadeFiles, rawByFile, fileMetrics, scopeSet, maskCommentsAndStrings, projectRoot)
    : null;
  const httpRoutes = extractHttpRouteContracts(rawByFile);

  const exportedSymbols = [], hashLines = [], richLines = [];
  for (const entryRel of facadeFiles) {
    const entryPack = barrelEnriched ? barrelEnriched.get(entryRel) : fileMetrics.get(entryRel);
    if (!entryPack || entryPack.exports.length === 0) continue;
    hashLines.push(`// [entry: ${entryRel}]`);
    richLines.push(`// [entry: ${entryRel}]`);
    for (const td of entryPack.typedefs || []) if (!entryPack.exports.some((e) => e.doc === td)) richLines.push(td);
    for (const ex of entryPack.exports) {
      exportedSymbols.push({ file: entryRel, symbol: ex.symbol, signature: ex.signature });
      hashLines.push(ex.signature);
      if (ex.doc) richLines.push(ex.doc);
      richLines.push(ex.signature);
    }
  }
  if (httpRoutes.length > 0) {
    richLines.push('// === HTTP Route Contracts ===');
    for (const rt of httpRoutes) {
      const routeLine = `// ${rt.method} ${rt.path} [${rt.file}]`;
      hashLines.push(routeLine);
      richLines.push(routeLine);
    }
  }
  const stubHash = sha256(hashLines.join('\n') || `empty:${node.id}`);
  const header = `// @donegate-stub node=${node.id} mode=${facadeMode} hash=${stubHash}`;
  const stubText = richLines.length > 0 ? `${header}\n${richLines.join('\n')}\n` : `${header}\n// (no public code exports)\n`;
  return {
    nodeId: node.id, facadeMode, facadeFiles, scopeFiles, relatedTestFiles,
    effectiveLines, physicalLines, maxFileEffectiveLines, maxFile, sourceChars,
    sourceTokens: Math.ceil(sourceChars / 4), stubTokens: Math.ceil(stubText.length / 4),
    stubHash, exportedSymbols, httpRoutes, stubText
  };
}
