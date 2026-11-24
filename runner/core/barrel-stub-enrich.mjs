// 1-Hop 桶门面重导出多跳解引用（真实参数列表 + @param/@returns/@typedef JSDoc）与 HTTP 路由契约提取器
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const REEXPORT_SIG_RE = /^export\s+(\*(?:\s+as\s+([A-Za-z_$][\w$]*))?|\{[\s\S]+?\})(?:\s+from\s+['"]([^'"]+)['"])?\s*;?$/;
const ROUTE_FULL_RE = /(['"`])(?:(GET|POST|PUT|DELETE|PATCH)\s+)?(\/(?:donegate\/api|api)\/[A-Za-z0-9/_:${}.-]+)\1|\/(\^?\\\/(?:donegate\\\/api|api)\\\/[^\s/;]+)\/[gimsuy]*/g;
const ROUTE_SUB_RE = /(['"`])(?:(GET|POST|PUT|DELETE|PATCH)\s+)(\/[A-Za-z0-9/_:${}.-]+)\1|(?:sub|p|rel|subPath|subRoute|routePath|relPath|apiPath|pathname|route)\s*===?\s*(['"`])(\/[A-Za-z0-9/_:${}.-]+)\4/g;
const SERVER_SIGNAL_RE = /\b(?:req\.method|req\.url|res\.writeHead|res\.end|createServer|pathname|router\.|app\.(?:get|post|put|delete))\b/;
const compactSig = (t) => t.replace(/\s+/g, ' ').replace(/\s*([(),:;])\s*/g, '$1 ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function bseBlankLineComment(src, out, start) {
  let i = start;
  while (i < src.length && src[i] !== '\n') {
    if (out[i] !== '\r') out[i] = ' ';
    i++;
  }
  return i;
}

function bseBlankBlockComment(src, out, start) {
  const end = src.indexOf('*/', start + 2);
  const limit = end >= 0 ? end + 2 : src.length;
  for (let k = start; k < limit; k++) {
    if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  }
  return limit;
}

function bseSkipQuotedString(src, start) {
  const q = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
  return i + 1;
}

function stripCommentsKeepStrings(src) {
  const out = src.split('');
  for (let i = 0, n = src.length; i < n;) {
    const c = src[i], c2 = src.slice(i, i + 2);
    if (c2 === '//') i = bseBlankLineComment(src, out, i);
    else if (c2 === '/*') i = bseBlankBlockComment(src, out, i);
    else if (c === '"' || c === "'" || c === '`') i = bseSkipQuotedString(src, i);
    else i++;
  }
  return out.join('');
}

function findBal(text, startIdx, openCh, closeCh) {
  for (let i = startIdx, depth = 0; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

function extractDocBefore(source, declIndex) {
  const win = source.slice(Math.max(0, declIndex - 2000), declIndex);
  const endComment = win.search(/\*\/\s*$/);
  if (endComment < 0) return '';
  const lastOpen = win.lastIndexOf('/**', endComment);
  return (lastOpen < 0 || win.slice(lastOpen + 3, endComment).includes('*/')) ? '' : win.slice(lastOpen, endComment + 2).trim();
}

export function extractTypedefJsDocs(source) {
  return source ? [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)].filter((m) => /@typedef\b/.test(m[0])).map((m) => m[0].trim()) : [];
}

function parseSpecifiers(clause) {
  return clause.replace(/^\{|\}$/g, '').split(',').map((raw) => raw.trim().replace(/^type\s+/, '')).filter(Boolean).map((p) => {
    const m = p.match(/^([A-Za-z_$][\w$]*|default)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (m) return { orig: m[1], exported: m[2] };
    return /^[A-Za-z_$][\w$]*$/.test(p) ? { orig: p, exported: p } : null;
  }).filter(Boolean);
}

function bseFormatVarBindingSig(source, masked, rhsStart, kind, name, rawType) {
  const typeSuffix = rawType ? `: ${rawType}` : '';
  const rhsSlice = masked.slice(rhsStart, rhsStart + 200);
  const arrowP = rhsSlice.match(/^(async\s+)?\(/), fnE = rhsSlice.match(/^(async\s+)?function\s*\(/);
  if (!arrowP && !fnE) return `export ${kind} ${name}${typeSuffix};`;
  const openI = rhsStart + rhsSlice.indexOf('('), closeI = findBal(masked, openI, '(', ')');
  const asyncPref = (arrowP?.[1] || fnE?.[1]) ? 'async ' : '';
  const params = closeI > openI ? compactSig(source.slice(openI, closeI + 1)) : '(...args)';
  return `export ${asyncPref}function ${name}${params}${typeSuffix};`;
}

function extractBindings(source, maskFn) {
  const map = new Map();
  if (!source) return map;
  const masked = maskFn(source, '.ts');
  for (const im of source.matchAll(/(?:^|\n)\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    if (masked[im.index + im[0].indexOf('import')] === ' ') continue;
    for (const sp of parseSpecifiers(`{${im[1]}}`)) {
      const aliasPart = sp.exported !== sp.orig ? ` as ${sp.exported}` : '';
      map.set(sp.exported, { symbol: sp.exported, doc: '', importedFrom: im[2], origSymbol: sp.orig, signature: `export { ${sp.orig}${aliasPart} } from '${im[2]}';` });
    }
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*(async\s+)?function(\s*\*)?\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const kwIdx = m.index + m[0].search(/\b(?:async|function)\b/);
    if (masked.slice(Math.max(0, kwIdx - 10), kwIdx).includes('export')) continue;
    const openP = m.index + m[0].length - 1, closeP = findBal(masked, openP, '(', ')');
    if (closeP <= openP) continue;
    const asyncPref = m[1] ? 'async ' : '', genStar = m[2] ? '* ' : '';
    map.set(m[3], { symbol: m[3], doc: extractDocBefore(source, kwIdx), signature: `export ${asyncPref}function ${genStar}${m[3]}${compactSig(source.slice(openP, closeP + 1))};` });
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n]+?))?\s*=\s*/g)) {
    const kwIdx = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (masked.slice(Math.max(0, kwIdx - 10), kwIdx).includes('export')) continue;
    const [kind, name, rawType] = [m[1], m[2], m[3] ? compactSig(m[3]) : ''];
    const sig = bseFormatVarBindingSig(source, masked, m.index + m[0].length, kind, name, rawType);
    map.set(name, { symbol: name, doc: extractDocBefore(source, kwIdx), signature: sig });
  }
  return map;
}

function resolveScopeTarget(fromFile, spec, scopeSet) {
  if (!spec || !spec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromFile), spec.split(/[?#]/)[0])).replace(/\\/g, '/');
  return [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}/index.mjs`, `${base}/index.js`, `${base}/index.ts`].find((c) => scopeSet.has(c)) || null;
}

const renameSym = (sig, oldS, newS) => (!oldS || !newS || oldS === newS) ? sig : sig.replace(new RegExp(`\\b${oldS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), newS);

function bseResolveLocalReexport(sp, relFile, localDecls, projectRoot) {
  const loc = localDecls.get(sp.orig);
  if (loc?.importedFrom && projectRoot) {
    const extAbs = resolve(projectRoot, dirname(relFile), loc.importedFrom);
    try {
      const extRe = new RegExp(`export\\s+(async\\s+)?function\\s+${loc.origSymbol}\\s*(\\([^)]*\\))`);
      const extFn = existsSync(extAbs) ? readFileSync(extAbs, 'utf8').match(extRe) : null;
      if (extFn) {
        const asyncPref = extFn[1] ? 'async ' : '';
        return { symbol: sp.exported, doc: '', signature: `export ${asyncPref}function ${sp.exported}${compactSig(extFn[2])};` };
      }
    } catch (err) { void err; }
  }
  if (loc) return { symbol: sp.exported, doc: loc.doc, signature: renameSym(loc.signature, sp.orig, sp.exported) };
  return { symbol: sp.exported, doc: '', signature: `export const ${sp.exported}: unknown;` };
}

function bseFormatNamedSubExport(sp, fromSpec, sub) {
  const defKey = sub.bySymbol.has('defaultExport') ? 'defaultExport' : 'default';
  const key = sp.orig === 'default' ? defKey : sp.orig;
  const hit = sub.bySymbol.get(key);
  if (hit) return { symbol: sp.exported, doc: hit.doc || '', signature: renameSym(hit.signature, hit.symbol, sp.exported) };
  const aliasPart = sp.exported !== sp.orig ? ` as ${sp.exported}` : '';
  return { symbol: sp.exported, doc: '', signature: `export { ${sp.orig}${aliasPart} } from '${fromSpec}';` };
}

function bseMergeSubModuleExports(clause, nsAlias, fromSpec, sub, reg) {
  if (clause.startsWith('*')) {
    if (nsAlias) {
      const keys = [...sub.bySymbol.keys()].filter((k) => k !== 'defaultExport').join(', ');
      reg({ symbol: nsAlias, doc: '', signature: `export const ${nsAlias}: { ${keys} };` });
      return;
    }
    for (const subItem of sub.items) {
      if (subItem.symbol !== 'defaultExport') reg(subItem);
    }
    return;
  }
  for (const sp of parseSpecifiers(clause)) reg(bseFormatNamedSubExport(sp, fromSpec, sub));
}

function bseProcessModuleExport(ex, relFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot, nextVisited, localDecls, typedefSet, reg) {
  if (!ex.symbol.startsWith('reexport:')) {
    reg({ symbol: ex.symbol, doc: ex.doc || '', signature: ex.signature });
    return;
  }
  const reMatch = ex.signature.match(REEXPORT_SIG_RE);
  if (!reMatch) { reg(ex); return; }
  const [, clause, nsAlias, fromSpec] = reMatch;
  if (!fromSpec && clause.startsWith('{')) {
    for (const sp of parseSpecifiers(clause)) reg(bseResolveLocalReexport(sp, relFile, localDecls, projectRoot));
    return;
  }
  const targetFile = resolveScopeTarget(relFile, fromSpec, scopeSet);
  if (!targetFile) { reg(ex); return; }
  const sub = resolveModuleTable(targetFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot, nextVisited);
  for (const td of sub.typedefs) typedefSet.add(td);
  bseMergeSubModuleExports(clause, nsAlias, fromSpec, sub, reg);
}

function resolveModuleTable(relFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot = '', visited = new Set()) {
  if (visited.has(relFile)) return { items: [], bySymbol: new Map(), typedefs: [] };
  const nextVisited = new Set([...visited, relFile]);
  const raw = rawByFile.get(relFile) || '', parsed = fileMetrics.get(relFile);
  const localDecls = extractBindings(raw, maskFn), typedefSet = new Set(extractTypedefJsDocs(raw));
  const items = [], bySymbol = new Map();
  const reg = (it) => {
    items.push(it);
    if (!it.symbol.startsWith('reexport:')) bySymbol.set(it.symbol, it);
  };
  for (const ex of parsed?.exports || []) {
    bseProcessModuleExport(ex, relFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot, nextVisited, localDecls, typedefSet, reg);
  }
  return { items, bySymbol, typedefs: [...typedefSet] };
}

function bseAddUniqueTypedefs(list, emittedTypedefs, out) {
  for (const td of list) {
    if (!emittedTypedefs.has(td)) { emittedTypedefs.add(td); out.push(td); }
  }
}

function bseAddUniqueExports(items, seenSymbols, out) {
  for (const item of items) {
    if (!seenSymbols.has(item.symbol)) { seenSymbols.add(item.symbol); out.push(item); }
  }
}

function bseEnrichSingleFacade(entryRel, parsed, facadeSet, emittedTypedefs, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot) {
  const entryTypedefs = [], resolvedExports = [], seenSymbols = new Set();
  bseAddUniqueTypedefs(extractTypedefJsDocs(rawByFile.get(entryRel) || ''), emittedTypedefs, entryTypedefs);
  for (const ex of parsed.exports) {
    if (!ex.symbol.startsWith('reexport:')) {
      bseAddUniqueExports([{ symbol: ex.symbol, doc: ex.doc || '', signature: ex.signature }], seenSymbols, resolvedExports);
      continue;
    }
    const reMatch = ex.signature.match(REEXPORT_SIG_RE);
    const targetFile = reMatch?.[3] ? resolveScopeTarget(entryRel, reMatch[3], scopeSet) : null;
    if (!reMatch || (reMatch[1] === '*' && targetFile && facadeSet.has(targetFile))) { resolvedExports.push(ex); continue; }
    const singleMetrics = new Map([...fileMetrics.entries(), [entryRel, { ...parsed, exports: [ex] }]]);
    const single = resolveModuleTable(entryRel, rawByFile, singleMetrics, scopeSet, maskFn, projectRoot);
    bseAddUniqueTypedefs(single.typedefs, emittedTypedefs, entryTypedefs);
    bseAddUniqueExports(single.items, seenSymbols, resolvedExports);
  }
  return { typedefs: entryTypedefs, exports: resolvedExports };
}

export function enrichBarrelFacadeExports(facadeFiles, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot = '') {
  const facadeSet = new Set(facadeFiles), emittedTypedefs = new Set(), entriesByFacade = new Map();
  for (const entryRel of facadeFiles) {
    const parsed = fileMetrics.get(entryRel);
    if (!parsed || parsed.exports.length === 0) continue;
    entriesByFacade.set(entryRel, bseEnrichSingleFacade(entryRel, parsed, facadeSet, emittedTypedefs, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot));
  }
  return entriesByFacade;
}

function normRoute(rawRoute, prefix = '') {
  const full = prefix && rawRoute.startsWith('/') && !rawRoute.startsWith('/donegate/api') && !rawRoute.startsWith('/api/') ? `${prefix}${rawRoute}` : String(rawRoute || '');
  const clean = full.replace(/\\\//g, '/').replace(/^\^+|\$+$/g, '').replace(/\$\{([A-Za-z_$][\w$]*)(?:[^}]*)\}/g, ':$1').replace(/\$\{[^}]+\}|\(\?:[^)]+\)|\([^)]+\)/g, ':param').split(/[?#]/)[0].replace(/\/+$/, '');
  const m = clean.match(/^(\/(?:donegate\/api|api)\/[A-Za-z0-9/_:-]+)/);
  return (m && !/\.(?:mjs|js|ts|cjs|css|png|svg)$/i.test(m[1])) ? m[1] : null;
}

function inferMethods(cleanSrc, matchIdx, nextIdx) {
  const rv = cleanSrc.slice(Math.max(0, matchIdx - 36), matchIdx).match(/\.\s*(get|post|put|delete|patch)\s*\(\s*$/i);
  if (rv) return [rv[1].toUpperCase()];
  const stmtBreak = Math.max(cleanSrc.lastIndexOf('\n', matchIdx), cleanSrc.lastIndexOf(';', matchIdx), cleanSrc.lastIndexOf('}', matchIdx));
  const hStart = Math.max(0, stmtBreak + 1);
  const bLim = Math.min(cleanSrc.length, nextIdx > matchIdx ? nextIdx : matchIdx + 520, matchIdx + 520);
  const brace = cleanSrc.indexOf('{', matchIdx);
  const hEnd = (brace >= 0 && brace < bLim && brace - matchIdx < 180) ? brace : Math.min(bLim, matchIdx + 140);
  const methodRe = /\b(?:req\.method|method)\s*===?\s*['"](GET|POST|PUT|DELETE|PATCH)['"]|['"](GET|POST|PUT|DELETE|PATCH)['"]\s*===?\s*(?:req\.method|method)|\bmethod\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/g;
  const hits = new Set([...cleanSrc.slice(hStart, hEnd).matchAll(methodRe)].map((m) => (m[1] || m[2] || m[3]).toUpperCase()));
  if (hits.size > 0) return [...hits];
  if (brace >= 0 && brace < bLim) {
    const closeB = findBal(cleanSrc, brace, '{', '}');
    const body = cleanSrc.slice(brace, closeB > brace ? Math.min(closeB + 1, bLim) : bLim);
    for (const bm of body.matchAll(methodRe)) hits.add((bm[1] || bm[2] || bm[3]).toUpperCase());
    if (hits.size > 0) return [...hits];
    const neg = body.match(/\b(?:req\.method|method)\s*!==?\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/);
    if (neg) return [neg[1].toUpperCase()];
  }
  return ['GET'];
}

function bsePrepareRouteSource(relFile, raw) {
  if (!raw || ['.py', '.go'].includes(extname(relFile).toLowerCase())) return null;
  const base = basename(relFile), isRouteName = /(?:route|server|serve|handler|endpoint|api)/i.test(base);
  if (/^(?:wb|ui)-/i.test(base) && !isRouteName) return null;
  let cleanSrc = stripCommentsKeepStrings(raw);
  if (!isRouteName && !SERVER_SIGNAL_RE.test(cleanSrc)) return null;
  for (const cm of cleanSrc.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*['"](\/(?:donegate\/api|api)[A-Za-z0-9/_-]*)['"]/g)) {
    cleanSrc = cleanSrc.replace(new RegExp(`\\$\\{${cm[1]}\\}`, 'g'), cm[2].replace(/\/+$/, ''));
  }
  return { cleanSrc, isRouteName };
}

function bsePickSubRoute(hit) {
  const sr = hit[3] || hit[5];
  return (sr && !sr.startsWith('/donegate/api') && !sr.startsWith('/api/')) ? normRoute(sr, '/donegate/api') : null;
}

function bseRecordRouteHits(cleanSrc, hits, pickRoute, relFile, seen) {
  for (let i = 0; i < hits.length; i++) {
    const rp = pickRoute(hits[i]);
    if (!rp) continue;
    const methods = hits[i][2] ? [hits[i][2].toUpperCase()] : inferMethods(cleanSrc, hits[i].index, hits[i + 1]?.index ?? cleanSrc.length);
    for (const mth of methods) {
      const key = `${mth} ${rp}`;
      if (!seen.has(key)) seen.set(key, { method: mth, path: rp, file: relFile });
    }
  }
}

export function extractHttpRouteContracts(rawByFile) {
  const seen = new Map();
  const cardHasDgPrefix = [...rawByFile.values()].some((v) => v && v.includes('/donegate/api'));
  for (const [relFile, raw] of [...rawByFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prep = bsePrepareRouteSource(relFile, raw);
    if (!prep) continue;
    const { cleanSrc, isRouteName } = prep;
    bseRecordRouteHits(cleanSrc, [...cleanSrc.matchAll(ROUTE_FULL_RE)], (h) => normRoute(h[3] || h[4]), relFile, seen);
    if (cleanSrc.includes('/donegate/api') || (cardHasDgPrefix && isRouteName)) {
      bseRecordRouteHits(cleanSrc, [...cleanSrc.matchAll(ROUTE_SUB_RE)], bsePickSubRoute, relFile, seen);
    }
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path) || HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method));
}
