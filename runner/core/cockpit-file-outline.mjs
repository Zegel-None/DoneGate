// Zoom-2 括号平衡单文件结构大纲提取器（穿透 barrel 门面与前端拼接器，剥离内嵌测试字符串噪声，<= 350 行）
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { maskCommentsAndStrings } from './ast-stub.mjs';
import { SHARED_GOVERNANCE_GLOBS } from './context-router.mjs';

function cfoFindBalanced(text, startIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

export function extractFullHeaderComment(raw) {
  const comments = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#!')) continue;
    if (t.startsWith('//')) comments.push(t.replace(/^\/\/+\s*/, '').trim());
    else if (comments.length > 0 || t !== '') break;
  }
  return comments.join(' ').trim();
}

function cfoCheckSharedGovernance(relFile) {
  return SHARED_GOVERNANCE_GLOBS.some((g) => (g.endsWith('/') ? relFile.startsWith(g) : relFile === g));
}

function cfoExtractJsonOutline(raw, relFile, ownerIds) {
  let topKeys = [];
  let preview = [];
  try {
    const parsed = JSON.parse(raw);
    topKeys = Array.isArray(parsed) ? [`Array(${parsed.length})`] : Object.keys(parsed);
    const shouldPreview = relFile === 'thresholds.json'
      || relFile.endsWith('.workflow.json')
      || relFile.endsWith('capabilities.json');
    if (shouldPreview) preview = [JSON.stringify(parsed, null, 2)];
  } catch (err) {
    void err;
  }
  return {
    file: relFile,
    owners: ownerIds,
    isSharedGov: cfoCheckSharedGovernance(relFile),
    header: relFile.endsWith('.workflow.json') ? '声明式工作流定义 JSON' : 'JSON 声明式配置/台账文件',
    exports: topKeys.map((k) => `key: ${k}`),
    internalFunctions: [],
    browserInlineFunctions: [],
    constantsPreview: preview,
    httpRoutes: [],
    domAnchors: [],
    imports: [],
    referencedPaths: []
  };
}

function cfoScanExportedFunctions(raw, masked, exportsOut) {
  const fnRe = /export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  for (const m of masked.matchAll(fnRe)) {
    const openP = m.index + m[0].length - 1;
    const closeP = cfoFindBalanced(masked, openP, '(', ')');
    const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
    const asyncTag = m[1] ? 'async ' : '';
    exportsOut.push(`${asyncTag}function ${m[2]}(${params})`);
  }
  const arrowRe = /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/g;
  for (const m of masked.matchAll(arrowRe)) {
    const openP = m.index + m[0].length - 1;
    const closeP = cfoFindBalanced(masked, openP, '(', ')');
    const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
    exportsOut.push(`const ${m[1]} = (${params}) => …`);
  }
}

function cfoSummarizeConstRhs(raw, masked, rhsStart) {
  let p = rhsStart;
  while (p < masked.length && /\s/.test(masked[p])) p++;
  const freezeM = raw.slice(p, p + 24).match(/^Object\.freeze\s*\(\s*/);
  if (freezeM) p += freezeM[0].length;
  if (raw[p] === '[') {
    const closeB = cfoFindBalanced(masked, p, '[', ']');
    const seg = closeB > p ? raw.slice(p + 1, closeB) : raw.slice(p + 1, p + 240);
    const items = [...seg.matchAll(/['"]([^'"]+)['"]/g)].map((x) => `'${x[1]}'`);
    return `[${items.slice(0, 24).join(', ')}${items.length > 24 ? ', …' : ''}]`;
  }
  if (raw[p] === '{') {
    const closeB = cfoFindBalanced(masked, p, '{', '}');
    const seg = closeB > p ? raw.slice(p + 1, closeB) : raw.slice(p + 1, p + 320);
    const kv = [];
    for (const kl of seg.split(/\r?\n/)) {
      const km = kl.match(/^\s{2}(['"]?[A-Za-z0-9_@-]+['"]?)\s*:\s*([^,\n]+)/);
      if (km) kv.push(`${km[1]}: ${km[2].trim().replace(/\{.*$/, '{…}').replace(/\[.*$/, '[…]').slice(0, 48)}`);
    }
    return `{ ${kv.join(', ')} }`;
  }
  const lineEnd = raw.indexOf('\n', p);
  const firstLine = raw.slice(p, lineEnd > p ? lineEnd : p + 80).replace(/;\s*$/, '').trim();
  return firstLine.slice(0, 80);
}

function cfoScanExportedConstsAndReexports(raw, masked, exportsOut) {
  for (const m of masked.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*/g)) {
    const name = m[1];
    if (exportsOut.some((e) => e.includes(`const ${name} =`))) continue;
    const summary = cfoSummarizeConstRhs(raw, masked, m.index + m[0].length);
    exportsOut.push(`const ${name} = ${summary}`);
  }
  for (const m of masked.matchAll(/export\s+\*\s+(?:as\s+[A-Za-z0-9_$]+\s+)?from\s+['"]\s*['"]/g)) {
    const stmt = raw.slice(m.index, m.index + m[0].length).replace(/\s+/g, ' ').trim();
    exportsOut.push(`re-export ${stmt.replace(/^export\s+/, '')}`);
  }
  for (const m of masked.matchAll(/export\s*\{/g)) {
    const openB = m.index + m[0].length - 1;
    const closeB = cfoFindBalanced(masked, openB, '{', '}');
    if (closeB <= openB) continue;
    const tail = raw.slice(closeB + 1, closeB + 120).match(/^\s*from\s*['"]([^'"]+)['"]/);
    const names = raw.slice(openB + 1, closeB).replace(/\s+/g, ' ').trim();
    if (tail) exportsOut.push(`re-export { ${names} } from '${tail[1]}'`);
    else exportsOut.push(`{ ${names} }`);
  }
}

function cfoScanFunctionsAndBrowserStrings(raw, masked, relFile, exportedNames) {
  const internalFunctions = [];
  const browserInlineFunctions = [];
  const seenBrowser = new Set();
  const isBrowserBuilder = relFile.startsWith('runner/atlas/') || relFile.startsWith('runner/dsh/ui-');

  for (const m of raw.matchAll(/(?:^|\n|['"`])\s*(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    const fnName = m[2];
    if (exportedNames.has(fnName)) continue;
    const fnIdx = m.index + m[0].indexOf('function');
    const openP = m.index + m[0].length - 1;
    if (masked[fnIdx] !== ' ') {
      const closeP = cfoFindBalanced(masked, openP, '(', ')');
      const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
      internalFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${params})`);
    } else if (isBrowserBuilder && !seenBrowser.has(fnName)) {
      const closeP = cfoFindBalanced(raw, openP, '(', ')');
      const params = (closeP > openP && closeP - openP < 120) ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
      seenBrowser.add(fnName);
      browserInlineFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${params})`);
    }
  }
  return { internalFunctions, browserInlineFunctions };
}

function cfoScanUpperConstantsAndImports(raw, masked) {
  const constantsPreview = [];
  for (const m of masked.matchAll(/(?:const|export\s+const)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g)) {
    const name = m[1];
    if (name.endsWith('_LINES')) continue;
    const openB = m.index + m[0].length - 1;
    const closeB = cfoFindBalanced(masked, openB, '[', ']');
    if (closeB <= openB) continue;
    const inner = raw.slice(openB + 1, closeB);
    const idents = name.endsWith('_FNS') ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const vals = idents.length === 0 ? [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((x) => `'${x[1]}'`) : [];
    if (idents.length > 0) constantsPreview.push(`${name} = [${idents.join(', ')}]`);
    else if (vals.length > 0 && vals.length <= 30) constantsPreview.push(`${name} = [${vals.join(', ')}]`);
  }

  const imports = [];
  for (const m of masked.matchAll(/import\s*\{/g)) {
    const openB = m.index + m[0].length - 1;
    const closeB = cfoFindBalanced(masked, openB, '{', '}');
    if (closeB <= openB) continue;
    const fromM = raw.slice(closeB + 1, closeB + 140).match(/^\s*from\s*['"]([^'"]+)['"]/);
    if (fromM) imports.push(`{ ${raw.slice(openB + 1, closeB).replace(/\s+/g, ' ').trim()} } <- '${fromM[1]}'`);
  }
  for (const m of masked.matchAll(/import\s+([A-Za-z0-9_$*]+(?:\s+as\s+[A-Za-z0-9_$]+)?)\s+from\s+['"]\s*['"]/g)) {
    const seg = raw.slice(m.index, m.index + m[0].length).match(/^import\s+([^\n;]+?)\s+from\s+['"]([^'"]+)['"]/);
    if (seg) imports.push(`${seg[1].trim()} <- '${seg[2]}'`);
  }
  return { constantsPreview, imports };
}

function cfoScanRoutesAnchorsAndPaths(raw, relFile, attributedRoutes) {
  const isRedSelfTestHost = relFile.startsWith('skill/check-') || relFile === 'skill/lint-edit.mjs';
  const httpRoutes = new Set(attributedRoutes || []);
  if (!isRedSelfTestHost) {
    for (const m of raw.matchAll(/['"`](\/(?:donegate\/)?api\/[A-Za-z0-9_/-]{2,})['"`]/g)) {
      if (![...httpRoutes].some((r) => r.endsWith(m[1]))) httpRoutes.add(`FETCH/ROUTE ${m[1]}`);
    }
  }
  const domAnchors = new Set();
  if (!isRedSelfTestHost) {
    for (const m of raw.matchAll(/\bid=(?:\\)?["']([A-Za-z][A-Za-z0-9_-]{3,})(?:\\)?["']/g)) {
      if (!m[1].includes('${')) domAnchors.add(`#${m[1]}`);
    }
    for (const m of raw.matchAll(/\b(data-[a-z][a-z0-9-]*)=(?:\\)?["']([A-Za-z0-9_-]{2,})(?:\\)?["']/g)) {
      if (m[1] !== 'data-tip' && !m[2].includes('${')) domAnchors.add(`[${m[1]}="${m[2]}"]`);
    }
  }
  const referencedPaths = new Set();
  for (const m of raw.matchAll(/['"`]((?:\.donegate\/|workflows\/|bricks\/|contracts\/|decisions\/)[A-Za-z0-9_./*-]*)['"`]/g)) {
    referencedPaths.add(m[1]);
  }
  for (const m of raw.matchAll(/['"`]([A-Za-z0-9_.-]+\.(?:json|jsonl|cmd))['"`]/g)) {
    if (!m[1].startsWith('broken')) referencedPaths.add(m[1]);
  }
  return { httpRoutes: [...httpRoutes], domAnchors: [...domAnchors], referencedPaths: [...referencedPaths] };
}

export function buildSingleFileOutline(projectRoot, relFile, ownerIds = [], attributedRoutes = []) {
  const abs = join(projectRoot, relFile);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  if (relFile.endsWith('.json')) return cfoExtractJsonOutline(raw, relFile, ownerIds);
  if (!/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(relFile)) {
    return {
      file: relFile, owners: ownerIds, isSharedGov: cfoCheckSharedGovernance(relFile),
      header: (raw.split(/\r?\n/)[0] || '').slice(0, 140),
      exports: [], internalFunctions: [], browserInlineFunctions: [],
      constantsPreview: [], httpRoutes: [], domAnchors: [], imports: [], referencedPaths: []
    };
  }

  const masked = maskCommentsAndStrings(raw, extname(relFile).toLowerCase());
  const exports = [];
  cfoScanExportedFunctions(raw, masked, exports);
  cfoScanExportedConstsAndReexports(raw, masked, exports);
  const exportedNames = new Set(exports.map((e) => (e.match(/(?:function|const)\s+([A-Za-z0-9_$]+)/) || [])[1]).filter(Boolean));
  const { internalFunctions, browserInlineFunctions } = cfoScanFunctionsAndBrowserStrings(raw, masked, relFile, exportedNames);
  const { constantsPreview, imports } = cfoScanUpperConstantsAndImports(raw, masked);
  const { httpRoutes, domAnchors, referencedPaths } = cfoScanRoutesAnchorsAndPaths(raw, relFile, attributedRoutes);

  return {
    file: relFile,
    owners: ownerIds,
    isSharedGov: cfoCheckSharedGovernance(relFile),
    header: extractFullHeaderComment(raw) || '源码模块',
    exports,
    internalFunctions,
    browserInlineFunctions,
    constantsPreview,
    httpRoutes,
    domAnchors,
    imports,
    referencedPaths
  };
}
