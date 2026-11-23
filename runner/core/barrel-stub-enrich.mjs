// 1-Hop 桶门面重导出多跳解引用（真实参数列表 + @param/@returns/@typedef JSDoc）与 HTTP 路由契约提取器
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const compactSig = (t) => t.replace(/\s+/g, ' ').replace(/\s*([(),:;])\s*/g, '$1 ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function stripCommentsKeepStrings(src) {
  const out = src.split('');
  for (let i = 0, n = src.length; i < n;) {
    const c = src[i], c2 = src.slice(i, i + 2);
    if (c2 === '//') { while (i < n && src[i] !== '\n') { if (out[i] !== '\r') out[i] = ' '; i++; } }
    else if (c2 === '/*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && src.slice(i, i + 2) !== '*/') { if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; if (i + 1 < n) out[i + 1] = ' '; i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
      i++;
    } else i++;
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
    return m ? { orig: m[1], exported: m[2] } : (/^[A-Za-z_$][\w$]*$/.test(p) ? { orig: p, exported: p } : null);
  }).filter(Boolean);
}

function extractBindings(source, maskFn) {
  const map = new Map();
  if (!source) return map;
  const masked = maskFn(source, '.ts');
  for (const im of source.matchAll(/(?:^|\n)\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    if (masked[im.index + im[0].indexOf('import')] === ' ') continue;
    for (const sp of parseSpecifiers(`{${im[1]}}`)) {
      map.set(sp.exported, { symbol: sp.exported, doc: '', importedFrom: im[2], origSymbol: sp.orig, signature: `export { ${sp.orig}${sp.exported !== sp.orig ? ` as ${sp.exported}` : ''} } from '${im[2]}';` });
    }
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*(async\s+)?function(\s*\*)?\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const kwIdx = m.index + m[0].search(/\b(?:async|function)\b/);
    if (masked.slice(Math.max(0, kwIdx - 10), kwIdx).includes('export')) continue;
    const openP = m.index + m[0].length - 1, closeP = findBal(masked, openP, '(', ')');
    if (closeP > openP) map.set(m[3], { symbol: m[3], doc: extractDocBefore(source, kwIdx), signature: `export ${m[1] ? 'async ' : ''}function ${m[2] ? '* ' : ''}${m[3]}${compactSig(source.slice(openP, closeP + 1))};` });
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n]+?))?\s*=\s*/g)) {
    const kwIdx = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (masked.slice(Math.max(0, kwIdx - 10), kwIdx).includes('export')) continue;
    const [kind, name, rawType] = [m[1], m[2], m[3] ? compactSig(m[3]) : ''];
    const rhsStart = m.index + m[0].length, rhsSlice = masked.slice(rhsStart, rhsStart + 200);
    const arrowP = rhsSlice.match(/^(async\s+)?\(/), fnE = rhsSlice.match(/^(async\s+)?function\s*\(/);
    let sig = `export ${kind} ${name}${rawType ? ': ' + rawType : ''};`;
    if (arrowP || fnE) {
      const openI = rhsStart + rhsSlice.indexOf('('), closeI = findBal(masked, openI, '(', ')');
      sig = `export ${(arrowP?.[1] || fnE?.[1]) ? 'async ' : ''}function ${name}${closeI > openI ? compactSig(source.slice(openI, closeI + 1)) : '(...args)'}${rawType ? ': ' + rawType : ''};`;
    }
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

function resolveModuleTable(relFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot = '', visited = new Set()) {
  if (visited.has(relFile)) return { items: [], bySymbol: new Map(), typedefs: [] };
  const nextVisited = new Set([...visited, relFile]);
  const raw = rawByFile.get(relFile) || '', parsed = fileMetrics.get(relFile);
  const localDecls = extractBindings(raw, maskFn), typedefSet = new Set(extractTypedefJsDocs(raw));
  const items = [], bySymbol = new Map();
  const reg = (it) => { items.push(it); if (!it.symbol.startsWith('reexport:')) bySymbol.set(it.symbol, it); };

  for (const ex of parsed?.exports || []) {
    if (!ex.symbol.startsWith('reexport:')) { reg({ symbol: ex.symbol, doc: ex.doc || '', signature: ex.signature }); continue; }
    const reMatch = ex.signature.match(/^export\s+(\*(?:\s+as\s+([A-Za-z_$][\w$]*))?|\{[\s\S]+?\})(?:\s+from\s+['"]([^'"]+)['"])?\s*;?$/);
    if (!reMatch) { reg(ex); continue; }
    const [, clause, nsAlias, fromSpec] = reMatch;
    if (!fromSpec && clause.startsWith('{')) {
      for (const sp of parseSpecifiers(clause)) {
        const loc = localDecls.get(sp.orig);
        if (loc?.importedFrom && projectRoot) {
          const extAbs = resolve(projectRoot, dirname(relFile), loc.importedFrom);
          try {
            const extFn = existsSync(extAbs) ? readFileSync(extAbs, 'utf8').match(new RegExp(`export\\s+(async\\s+)?function\\s+${loc.origSymbol}\\s*(\\([^)]*\\))`)) : null;
            if (extFn) { reg({ symbol: sp.exported, doc: '', signature: `export ${extFn[1] ? 'async ' : ''}function ${sp.exported}${compactSig(extFn[2])};` }); continue; }
          } catch (err) { void err; }
        }
        reg(loc ? { symbol: sp.exported, doc: loc.doc, signature: renameSym(loc.signature, sp.orig, sp.exported) } : { symbol: sp.exported, doc: '', signature: `export const ${sp.exported}: unknown;` });
      }
      continue;
    }
    const targetFile = resolveScopeTarget(relFile, fromSpec, scopeSet);
    if (!targetFile) { reg(ex); continue; }
    const sub = resolveModuleTable(targetFile, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot, nextVisited);
    for (const td of sub.typedefs) typedefSet.add(td);
    if (clause.startsWith('*')) {
      if (nsAlias) reg({ symbol: nsAlias, doc: '', signature: `export const ${nsAlias}: { ${[...sub.bySymbol.keys()].filter((k) => k !== 'defaultExport').join(', ')} };` });
      else for (const subItem of sub.items) if (subItem.symbol !== 'defaultExport') reg(subItem);
    } else {
      for (const sp of parseSpecifiers(clause)) {
        const key = sp.orig === 'default' ? (sub.bySymbol.has('defaultExport') ? 'defaultExport' : 'default') : sp.orig;
        const hit = sub.bySymbol.get(key);
        reg(hit ? { symbol: sp.exported, doc: hit.doc || '', signature: renameSym(hit.signature, hit.symbol, sp.exported) } : { symbol: sp.exported, doc: '', signature: `export { ${sp.orig}${sp.exported !== sp.orig ? ` as ${sp.exported}` : ''} } from '${fromSpec}';` });
      }
    }
  }
  return { items, bySymbol, typedefs: [...typedefSet] };
}

export function enrichBarrelFacadeExports(facadeFiles, rawByFile, fileMetrics, scopeSet, maskFn, projectRoot = '') {
  const facadeSet = new Set(facadeFiles), emittedTypedefs = new Set(), entriesByFacade = new Map();
  for (const entryRel of facadeFiles) {
    const parsed = fileMetrics.get(entryRel);
    if (!parsed || parsed.exports.length === 0) continue;
    const entryTypedefs = [], resolvedExports = [], seenSymbols = new Set();
    for (const td of extractTypedefJsDocs(rawByFile.get(entryRel) || '')) if (!emittedTypedefs.has(td)) { emittedTypedefs.add(td); entryTypedefs.push(td); }
    for (const ex of parsed.exports) {
      if (!ex.symbol.startsWith('reexport:')) {
        if (!seenSymbols.has(ex.symbol)) { seenSymbols.add(ex.symbol); resolvedExports.push({ symbol: ex.symbol, doc: ex.doc || '', signature: ex.signature }); }
        continue;
      }
      const reMatch = ex.signature.match(/^export\s+(\*(?:\s+as\s+([A-Za-z_$][\w$]*))?|\{[\s\S]+?\})(?:\s+from\s+['"]([^'"]+)['"])?\s*;?$/);
      const targetFile = reMatch?.[3] ? resolveScopeTarget(entryRel, reMatch[3], scopeSet) : null;
      if (!reMatch || (reMatch[1] === '*' && targetFile && facadeSet.has(targetFile))) { resolvedExports.push(ex); continue; }
      const single = resolveModuleTable(entryRel, rawByFile, new Map([...fileMetrics.entries(), [entryRel, { ...parsed, exports: [ex] }]]), scopeSet, maskFn, projectRoot);
      for (const td of single.typedefs) if (!emittedTypedefs.has(td)) { emittedTypedefs.add(td); entryTypedefs.push(td); }
      for (const item of single.items) if (!seenSymbols.has(item.symbol)) { seenSymbols.add(item.symbol); resolvedExports.push(item); }
    }
    entriesByFacade.set(entryRel, { typedefs: entryTypedefs, exports: resolvedExports });
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

export function extractHttpRouteContracts(rawByFile) {
  const seen = new Map();
  const cardHasDgPrefix = [...rawByFile.values()].some((v) => v && v.includes('/donegate/api'));
  const routeRe = /(['"`])(?:(GET|POST|PUT|DELETE|PATCH)\s+)?(\/(?:donegate\/api|api)\/[A-Za-z0-9/_:${}.-]+)\1|\/(\^?\\\/(?:donegate\\\/api|api)\\\/[^\s/;]+)\/[gimsuy]*/g;
  const subRe = /(['"`])(?:(GET|POST|PUT|DELETE|PATCH)\s+)(\/[A-Za-z0-9/_:${}.-]+)\1|(?:sub|p|rel|subPath|subRoute|routePath|relPath|apiPath|pathname|route)\s*===?\s*(['"`])(\/[A-Za-z0-9/_:${}.-]+)\4/g;

  for (const [relFile, raw] of [...rawByFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!raw || ['.py', '.go'].includes(extname(relFile).toLowerCase())) continue;
    const base = basename(relFile), isRouteName = /(?:route|server|serve|handler|endpoint|api)/i.test(base);
    if (/^(?:wb|ui)-/i.test(base) && !isRouteName) continue;
    let cleanSrc = stripCommentsKeepStrings(raw);
    if (!isRouteName && !/\b(?:req\.method|req\.url|res\.writeHead|res\.end|createServer|pathname|router\.|app\.(?:get|post|put|delete))\b/.test(cleanSrc)) continue;
    for (const cm of cleanSrc.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*['"](\/(?:donegate\/api|api)[A-Za-z0-9/_-]*)['"]/g)) {
      cleanSrc = cleanSrc.replace(new RegExp(`\\$\\{${cm[1]}\\}`, 'g'), cm[2].replace(/\/+$/, ''));
    }
    const rawHits = [...cleanSrc.matchAll(routeRe)];
    for (let i = 0; i < rawHits.length; i++) {
      const rp = normRoute(rawHits[i][3] || rawHits[i][4]);
      if (!rp) continue;
      for (const mth of (rawHits[i][2] ? [rawHits[i][2].toUpperCase()] : inferMethods(cleanSrc, rawHits[i].index, rawHits[i + 1]?.index ?? cleanSrc.length))) {
        if (!seen.has(`${mth} ${rp}`)) seen.set(`${mth} ${rp}`, { method: mth, path: rp, file: relFile });
      }
    }
    if (cleanSrc.includes('/donegate/api') || (cardHasDgPrefix && isRouteName)) {
      const subHits = [...cleanSrc.matchAll(subRe)];
      for (let i = 0; i < subHits.length; i++) {
        const sr = subHits[i][3] || subHits[i][5];
        const rp = (sr && !sr.startsWith('/donegate/api') && !sr.startsWith('/api/')) ? normRoute(sr, '/donegate/api') : null;
        if (!rp) continue;
        for (const mth of (subHits[i][2] ? [subHits[i][2].toUpperCase()] : inferMethods(cleanSrc, subHits[i].index, subHits[i + 1]?.index ?? cleanSrc.length))) {
          if (!seen.has(`${mth} ${rp}`)) seen.set(`${mth} ${rp}`, { method: mth, path: rp, file: relFile });
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path) || HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method));
}
