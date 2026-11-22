// L1 邻域接口存根剥离器（保留前置 JSDoc 契约注释 + 桶文件门面与显式入口混合识别）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';

const CODE_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);
const SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const FACADE_BASENAMES = new Set(['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'contract.mjs', 'contract.js', 'contract.ts']);

export function maskCommentsAndStrings(src, ext = '.mjs') {
  const out = src.split('');
  const n = src.length;
  const isPy = ext === '.py';
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i], c2 = src.slice(i, i + 2), c3 = src.slice(i, i + 3);
    if ((!isPy && c2 === '//') || (isPy && c === '#')) {
      const s = i;
      while (i < n && src[i] !== '\n') i++;
      blank(s, i);
    } else if (!isPy && c2 === '/*') {
      const s = i;
      i += 2;
      while (i < n && src.slice(i, i + 2) !== '*/') i++;
      i = Math.min(n, i + 2);
      blank(s, i);
    } else if (isPy && (c3 === '"""' || c3 === "'''")) {
      const s = i;
      i += 3;
      while (i < n && src.slice(i, i + 3) !== c3) { if (src[i] === '\\') i++; i++; }
      i = Math.min(n, i + 3);
      blank(s, i);
    } else if (c === '"' || c === "'" || (!isPy && c === '`')) {
      const s = i;
      i++;
      while (i < n && src[i] !== c) { i += src[i] === '\\' ? 2 : 1; }
      i = Math.min(n, i + 1);
      blank(s + 1, Math.max(s + 1, i - 1));
    } else i++;
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
  const m = source.slice(Math.max(0, declIndex - 1200), declIndex).match(/(\/\*\*[\s\S]*?\*\/)\s*$/);
  return m ? m[1].trim() : '';
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

function extractJsTsExports(source) {
  const masked = maskCommentsAndStrings(source, '.ts');
  const entries = [];
  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(default\s+)?(async\s+)?function(\s*\*)?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = findBalancedEnd(masked, openParen, '(', ')');
    if (closeParen < 0) continue;
    let tailEnd = closeParen + 1;
    while (tailEnd < masked.length && !'{;\n'.includes(masked[tailEnd])) tailEnd++;
    const name = m[4] || 'defaultExport';
    entries.push({
      symbol: name,
      doc: extractLeadingJsDoc(source, m.index, m[0]),
      signature: `export ${m[1] ? 'default ' : ''}${m[2] ? 'async ' : ''}function ${m[3] ? '* ' : ''}${name}${compactWs(source.slice(openParen, tailEnd))};`
    });
  }

  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(default\s+)?class\s+([A-Za-z_$][\w$]*)([^{\n]*)\{/g)) {
    const openBrace = m.index + m[0].length - 1;
    const closeBrace = findBalancedEnd(masked, openBrace, '{', '}');
    const name = m[2];
    const heritage = compactWs(source.slice(m.index + m[0].indexOf(name) + name.length, openBrace));
    const methods = closeBrace > openBrace ? extractJsClassMethods(source.slice(openBrace + 1, closeBrace), masked.slice(openBrace + 1, closeBrace)) : [];
    entries.push({
      symbol: name,
      doc: extractLeadingJsDoc(source, m.index, m[0]),
      signature: `export ${m[1] ? 'default ' : ''}class ${name}${heritage ? ' ' + heritage : ''}${methods.length > 0 ? ` { ${methods.join(' ')} }` : ' {}'}`
    });
  }

  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*([^=\n]+?))?\s*=\s*/g)) {
    const [kind, name, rawType] = [m[1], m[2], m[3] ? compactWs(m[3]) : ''];
    const doc = extractLeadingJsDoc(source, m.index, m[0]);
    const rhsStart = m.index + m[0].length;
    const rhsSlice = masked.slice(rhsStart, rhsStart + 200);
    const arrowParen = rhsSlice.match(/^(async\s+)?\(/);
    const arrowIdent = rhsSlice.match(/^(async\s+)?([A-Za-z_$][\w$]*)\s*=>/);
    const fnExpr = rhsSlice.match(/^(async\s+)?function\s*\(/);
    if (arrowParen || fnExpr) {
      const openIdx = rhsStart + rhsSlice.indexOf('(');
      const closeIdx = findBalancedEnd(masked, openIdx, '(', ')');
      const params = closeIdx > openIdx ? compactWs(source.slice(openIdx, closeIdx + 1)) : '(...args)';
      entries.push({ symbol: name, doc, signature: `export ${(arrowParen?.[1] || fnExpr?.[1]) ? 'async ' : ''}function ${name}${params}${rawType ? ': ' + rawType : ''};` });
    } else if (arrowIdent) {
      entries.push({ symbol: name, doc, signature: `export ${arrowIdent[1] ? 'async ' : ''}function ${name}(${arrowIdent[2]});` });
    } else if (rhsSlice.trimStart().startsWith('{')) {
      const openBrace = rhsStart + rhsSlice.indexOf('{');
      const closeBrace = findBalancedEnd(masked, openBrace, '{', '}');
      const objSlice = closeBrace > openBrace ? masked.slice(openBrace + 1, Math.min(closeBrace, openBrace + 2400)) : '';
      const keys = [...objSlice.matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*(?::|\()/g)].map((k) => k[1]).slice(0, 24);
      entries.push({ symbol: name, doc, signature: `export ${kind} ${name}: ${rawType || (keys.length > 0 ? `{ ${keys.join(', ')} }` : 'Record<string, unknown>')};` });
    } else {
      entries.push({ symbol: name, doc, signature: `export ${kind} ${name}${rawType ? ': ' + rawType : ''};` });
    }
  }

  for (const m of masked.matchAll(/(?:^|\n)\s*export\s+(interface|type|enum)\s+([A-Za-z_$][\w$]*)([^\n;{]*)(?:\{|;|=)/g)) {
    const doc = extractLeadingJsDoc(source, m.index, m[0]);
    const kwPos = m[0].search(/\bexport\b/);
    const declIdx = m.index + (kwPos >= 0 ? kwPos : 0);
    const openBrace = (m[1] === 'interface' || m[1] === 'enum') ? source.indexOf('{', declIdx) : -1;
    const closeBrace = openBrace >= 0 ? findBalancedEnd(masked, openBrace, '{', '}') : -1;
    const sig = (closeBrace > openBrace && closeBrace - openBrace <= 1600)
      ? compactWs(source.slice(declIdx, closeBrace + 1))
      : `export ${m[1]} ${m[2]}${compactWs(m[3]) ? ' ' + compactWs(m[3]) : ''};`;
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
  let effectiveLines = 0;
  for (const line of masked.split(/\r?\n/)) if (line.trim()) effectiveLines++;
  const exports = (ext === '.py' || ext === '.go') ? extractPyOrGoExports(source, ext) : extractJsTsExports(source);
  return { relPath, effectiveLines, sourceChars: source.length, exports };
}

export function resolveNodeScopeFiles(projectRoot, scopes = []) {
  const found = new Set(), relatedTests = new Set(), publicEntries = new Set();
  let hasBarrel = false;
  for (const rawScope of (Array.isArray(scopes) ? scopes : [])) {
    const clean = String(rawScope || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!clean) continue;
    const abs = resolve(projectRoot, clean);
    if (!existsSync(abs)) continue;
    let st;
    try { st = statSync(abs); } catch (err) { void err; continue; }
    if (st.isFile() && CODE_EXTS.has(extname(clean).toLowerCase())) {
      if (/\.(test|spec)\.[a-z0-9]+$|.*-fixtures\.mjs$/i.test(clean)) relatedTests.add(clean);
      else { found.add(clean); publicEntries.add(clean); }
    } else if (st.isDirectory()) {
      const dirClean = clean.replace(/\/+$/, '');
      const dirCodeFiles = [];
      for (const f of walk(abs, { skipDirs: SKIP_DIRS }).files) {
        const rel = relative(projectRoot, f).replace(/\\/g, '/');
        if (!CODE_EXTS.has(extname(rel).toLowerCase())) continue;
        if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|.*-fixtures\.mjs$/i.test(rel)) relatedTests.add(rel);
        else { found.add(rel); dirCodeFiles.push(rel); }
      }
      const barrels = dirCodeFiles.filter((f) => {
        const slash = f.lastIndexOf('/');
        const dir = slash >= 0 ? f.slice(0, slash) : '', base = slash >= 0 ? f.slice(slash + 1) : f;
        return dir === dirClean && FACADE_BASENAMES.has(base);
      });
      if (barrels.length > 0) {
        hasBarrel = true;
        for (const b of barrels) publicEntries.add(b);
      } else {
        for (const df of dirCodeFiles) publicEntries.add(df);
      }
    }
  }
  const scopeFiles = [...found].sort();
  const facadeFiles = publicEntries.size > 0 ? [...publicEntries].sort() : scopeFiles;
  return { scopeFiles, relatedTestFiles: [...relatedTests].sort(), facadeMode: hasBarrel ? 'barrel' : 'module-exports', facadeFiles };
}

export function buildNodeInterfaceStub(projectRoot, node) {
  const { scopeFiles, relatedTestFiles, facadeMode, facadeFiles } = resolveNodeScopeFiles(projectRoot, node.scope || []);
  let sourceChars = 0, effectiveLines = 0, maxFileEffectiveLines = 0, maxFile = null;
  const fileMetrics = new Map();
  for (const rel of scopeFiles) {
    let raw = '';
    try { raw = readFileSync(join(projectRoot, rel), 'utf8'); } catch (err) { void err; continue; }
    const parsed = extractFileInterfaceStub(raw, rel);
    sourceChars += parsed.sourceChars;
    effectiveLines += parsed.effectiveLines;
    if (parsed.effectiveLines > maxFileEffectiveLines) { maxFileEffectiveLines = parsed.effectiveLines; maxFile = rel; }
    fileMetrics.set(rel, parsed);
  }
  const exportedSymbols = [], hashLines = [], richLines = [];
  for (const entryRel of facadeFiles) {
    const parsed = fileMetrics.get(entryRel);
    if (!parsed || parsed.exports.length === 0) continue;
    hashLines.push(`// [entry: ${entryRel}]`);
    richLines.push(`// [entry: ${entryRel}]`);
    for (const ex of parsed.exports) {
      exportedSymbols.push({ file: entryRel, symbol: ex.symbol, signature: ex.signature });
      hashLines.push(ex.signature);
      if (ex.doc) richLines.push(ex.doc);
      richLines.push(ex.signature);
    }
  }
  const stubHash = sha256(hashLines.join('\n') || `empty:${node.id}`).slice(0, 16);
  const header = `// @donegate-stub node=${node.id} mode=${facadeMode} hash=${stubHash}`;
  const stubText = richLines.length > 0 ? `${header}\n${richLines.join('\n')}\n` : `${header}\n// (no public code exports)\n`;
  return {
    nodeId: node.id, facadeMode, facadeFiles, scopeFiles, relatedTestFiles,
    effectiveLines, maxFileEffectiveLines, maxFile, sourceChars,
    sourceTokens: Math.ceil(sourceChars / 4), stubTokens: Math.ceil(stubText.length / 4),
    stubHash, exportedSymbols, stubText
  };
}
