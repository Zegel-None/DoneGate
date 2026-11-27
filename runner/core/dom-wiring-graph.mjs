// 浏览器拼接脚本隐式耦合图（wb.* / data-action / DOM ID）、@subpack 焦点别名与过程函数双指标计算器
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { maskCommentsAndStrings } from './ast-stub.mjs';

export const ATLAS_SUBPACK_DEFAULTS = Object.freeze({});

const COMMON_WB_CONTAINERS = new Set([
  'state', 'data', 'dom', 'els', 'el', 'root', 'app', 'cfg', 'config', 'opts', 'options',
  'store', 'cache', 'ui', 'ctx', 'svg', 'canvas', 'nodes', 'links', 'edges', 'toast',
  'esc', 'escapeHtml', 'render', 'scheduleRender', 'fetchJson', 'api', 'log'
]);

const ACTION_HANDLER_RE = /\bcase\s+['"]([A-Za-z0-9_:-]{2,64})['"]\s*:|\b(?:action|act|cmd|actName|actionName)\s*===?\s*['"]([A-Za-z0-9_:-]{2,64})['"]|['"]([A-Za-z0-9_:-]{2,64})['"]\s*===?\s*\b(?:action|act|cmd|actName|actionName)\b/g;

function findBal(text, startIdx, openCh, closeCh) {
  for (let i = startIdx, depth = 0; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

function parseExportedSubpacksFromContract(contractFileAbs, dirPrefix) {
  if (!existsSync(contractFileAbs)) return null;
  let src = '';
  try { src = readFileSync(contractFileAbs, 'utf8'); } catch (err) { void err; return null; }
  const decl = src.match(/export\s+const\s+[A-Z0-9_]*SUBPACKS\s*=\s*(?:Object\.freeze\s*\(\s*)?\{/);
  if (!decl) return null;
  const openBrace = decl.index + decl[0].length - 1;
  const closeBrace = findBal(src, openBrace, '{', '}');
  if (closeBrace < 0) return null;
  const body = src.slice(openBrace + 1, closeBrace);
  const out = {};
  for (const m of body.matchAll(/(?:['"](@?[A-Za-z0-9_-]+)['"]|([A-Za-z0-9_-]+))\s*:\s*(?:Object\.freeze\s*\(\s*)?\[([\s\S]*?)\]/g)) {
    const rawKey = m[1] || m[2];
    const key = rawKey.startsWith('@') ? rawKey : `@${rawKey}`;
    const files = [...m[3].matchAll(/['"]([^'"]+)['"]/g)].map((fm) => {
      const clean = fm[1].replace(/\\/g, '/').replace(/^\.\//, '');
      return (dirPrefix && !clean.includes('/')) ? `${dirPrefix}/${clean}` : clean;
    });
    if (files.length > 0) out[key] = files;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function collectTargetContractFacades(target) {
  const candidates = new Set();
  for (const f of target?.stub?.facadeFiles || []) {
    if (f === 'contract.mjs' || f.endsWith('/contract.mjs')) candidates.add(f);
  }
  for (const rawScope of target?.scope || []) {
    const clean = String(rawScope || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (clean && !/\.[a-z0-9]+$/i.test(clean)) candidates.add(`${clean}/contract.mjs`);
  }
  return [...candidates];
}

export function resolveSubpackFocusPatterns(projectRoot, target, focusPatterns = []) {
  const map = { ...(target?.subpacks && typeof target.subpacks === 'object' ? target.subpacks : {}) };
  for (const f of collectTargetContractFacades(target)) {
    const dirPref = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const parsed = parseExportedSubpacksFromContract(join(projectRoot, f), dirPref);
    if (parsed) Object.assign(map, parsed);
  }
  const expanded = [];
  for (const pat of focusPatterns) {
    if (pat.startsWith('@') && Array.isArray(map[pat])) expanded.push(...map[pat]);
    else expanded.push(pat);
  }
  return [...new Set(expanded)];
}

function isHexColorToken(token) {
  return !token.includes('-') && !token.includes('_') && /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(token);
}

function dwgCollectWbProps(masked, wbDefs, wbRefs) {
  for (const m of masked.matchAll(/\bwb\.([A-Za-z_$][\w$]*)\s*(=)?(?!=)/g)) {
    const prop = m[1];
    if (COMMON_WB_CONTAINERS.has(prop)) continue;
    if (m[2] === '=') wbDefs.add(prop);
    else wbRefs.add(prop);
  }
  for (const am of masked.matchAll(/Object\.assign\s*\(\s*wb\s*,\s*\{([^}]{1,2000})\}/g)) {
    for (const km of am[1].matchAll(/(?:^|[,{\n])\s*([A-Za-z_$][\w$]*)\s*(?::|\()/g)) {
      if (!COMMON_WB_CONTAINERS.has(km[1])) wbDefs.add(km[1]);
    }
  }
}

function dwgAddNonHexMatches(source, re, targetSet) {
  for (const m of source.matchAll(re)) {
    if (!isHexColorToken(m[1])) targetSet.add(m[1]);
  }
}

export function extractFileDomWiring(source, relPath = '') {
  if (!source) {
    return { relPath, wbDefs: [], wbRefs: [], actionTriggers: [], actionHandlers: [], actions: [], domDefs: [], domRefs: [], domIds: [] };
  }
  const wbDefs = new Set(), wbRefs = new Set();
  const actionTriggers = new Set(), actionHandlers = new Set();
  const domDefs = new Set(), domRefs = new Set();
  const masked = maskCommentsAndStrings(source, extname(relPath).toLowerCase() || '.mjs');

  dwgCollectWbProps(masked, wbDefs, wbRefs);
  for (const tm of source.matchAll(/data-action\s*=\s*\\?['"]([A-Za-z0-9_:-]{2,64})\\?['"]/g)) actionTriggers.add(tm[1]);
  for (const hm of source.matchAll(ACTION_HANDLER_RE)) actionHandlers.add(hm[1] || hm[2] || hm[3]);
  dwgAddNonHexMatches(source, /\bid\s*=\s*\\?['"]([A-Za-z][A-Za-z0-9_:-]{1,63})\\?['"]/g, domDefs);
  dwgAddNonHexMatches(source, /\bgetElementById\s*\(\s*['"]([A-Za-z][A-Za-z0-9_:-]{1,63})['"]\s*\)/g, domRefs);
  dwgAddNonHexMatches(source, /\b(?:querySelector|querySelectorAll|closest|matches|\$\$?)\s*\(\s*['"`][^'"`\n]{0,120}?#([A-Za-z][A-Za-z0-9_-]{1,63})\b/g, domRefs);

  return {
    relPath,
    wbDefs: [...wbDefs].sort(),
    wbRefs: [...wbRefs].sort(),
    actionTriggers: [...actionTriggers].sort(),
    actionHandlers: [...actionHandlers].sort(),
    actions: [...new Set([...actionTriggers, ...actionHandlers])].sort(),
    domDefs: [...domDefs].sort(),
    domRefs: [...domRefs].sort(),
    domIds: [...new Set([...domDefs, ...domRefs])].sort()
  };
}

function dwgLinkFiles(edges, a, b) {
  if (a !== b) {
    edges.get(a)?.add(b);
    edges.get(b)?.add(a);
  }
}

function dwgIndexWiringPair(byFile, edges, producersFn, consumersFn, allowKey = () => true) {
  const prodMap = new Map();
  for (const [f, w] of byFile.entries()) {
    for (const k of producersFn(w).filter(allowKey)) {
      if (!prodMap.has(k)) prodMap.set(k, []);
      prodMap.get(k).push(f);
    }
  }
  for (const [f, w] of byFile.entries()) {
    for (const k of consumersFn(w).filter(allowKey)) {
      for (const pf of prodMap.get(k) || []) dwgLinkFiles(edges, f, pf);
    }
  }
}

export function buildDomWiringGraph(rawByFile) {
  const byFile = new Map(), edges = new Map();
  const files = [...rawByFile.keys()].sort();
  for (const f of files) {
    byFile.set(f, extractFileDomWiring(rawByFile.get(f) || '', f));
    edges.set(f, new Set());
  }
  const propTouchCount = new Map();
  for (const w of byFile.values()) {
    for (const p of new Set([...w.wbDefs, ...w.wbRefs])) {
      propTouchCount.set(p, (propTouchCount.get(p) || 0) + 1);
    }
  }
  const hubCap = Math.max(5, Math.ceil(files.length * 0.35));
  dwgIndexWiringPair(byFile, edges, (w) => w.wbDefs, (w) => [...w.wbRefs, ...w.wbDefs], (p) => (propTouchCount.get(p) || 0) <= hubCap);
  dwgIndexWiringPair(byFile, edges, (w) => w.actionTriggers, (w) => w.actionHandlers);
  dwgIndexWiringPair(byFile, edges, (w) => w.domDefs, (w) => w.domRefs);
  return { byFile, edges };
}

export function formatDomWiringStubComment(relPath, wiring) {
  if (!wiring) return '';
  const isBrowserScript = /^(?:wb|ui)-/i.test(basename(relPath));
  const hasAny = wiring.wbDefs.length > 0 || wiring.actions.length > 0 || wiring.domIds.length > 0;
  if (!isBrowserScript && !hasAny) return '';
  const fmtList = (arr) => arr.slice(0, 16).join(', ') + (arr.length > 16 ? `, +${arr.length - 16}` : '');
  return `// [DOM & Action Wiring] wbDefs=[${fmtList(wiring.wbDefs)}] actions=[${fmtList(wiring.actions)}] domIds=[${fmtList(wiring.domIds)}]`;
}

function dwgFindLineIndex(lineStarts, idx) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= idx) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function dwgSkipNonTemplateToken(source, i) {
  const n = source.length, c = source[i], c2 = source.slice(i, i + 2);
  if (c2 === '//') {
    const nl = source.indexOf('\n', i + 2);
    return nl < 0 ? n : nl;
  }
  if (c2 === '/*') {
    const end = source.indexOf('*/', i + 2);
    return end < 0 ? n : end + 2;
  }
  if (c === '"' || c === "'") {
    let cur = i + 1;
    while (cur < n && source[cur] !== c) cur += source[cur] === '\\' ? 2 : 1;
    return cur + 1;
  }
  return i + 1;
}

function dwgScanTemplateEnd(source, startIdx) {
  let i = startIdx + 1, interpDepth = 0;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (interpDepth === 0 && source[i] === '`') return i + 1;
    if (source.slice(i, i + 2) === '${') { interpDepth++; i += 2; continue; }
    if (interpDepth > 0 && source[i] === '{') interpDepth++;
    else if (interpDepth > 0 && source[i] === '}') interpDepth--;
    i++;
  }
  return i;
}

function dwgCollectJoinArrayDeductions(masked, lineStarts, deducted) {
  for (const m of masked.matchAll(/\[/g)) {
    const closeIdx = findBal(masked, m.index, '[', ']');
    if (closeIdx < 0 || !/^\s*\.join\s*\(/.test(masked.slice(closeIdx + 1, closeIdx + 24))) continue;
    const sLine = dwgFindLineIndex(lineStarts, m.index), eLine = dwgFindLineIndex(lineStarts, closeIdx);
    if (eLine - sLine + 1 < 12 || /[A-Za-z0-9_$();{}]/.test(masked.slice(m.index + 1, closeIdx))) continue;
    for (let ln = sLine + 1; ln < eLine; ln++) deducted.add(ln);
  }
}

function collectDeductedStaticLines(source, masked, lineStarts) {
  const deducted = new Set(), rawLines = source.split(/\r?\n/);
  for (let i = 0, n = source.length; i < n;) {
    if (source[i] !== '`') {
      i = dwgSkipNonTemplateToken(source, i);
      continue;
    }
    const sIdx = i;
    i = dwgScanTemplateEnd(source, sIdx);
    const sLine = dwgFindLineIndex(lineStarts, sIdx), eLine = dwgFindLineIndex(lineStarts, Math.max(sIdx, i - 1));
    if (eLine - sLine + 1 >= 12) {
      for (let ln = sLine + 1; ln < eLine; ln++) {
        if (!rawLines[ln]?.includes('${')) deducted.add(ln);
      }
    }
  }
  dwgCollectJoinArrayDeductions(masked, lineStarts, deducted);
  return deducted;
}

function dwgCollectFunctionSpans(masked, lineStarts) {
  const fnSpans = [];
  for (const fm of masked.matchAll(/\bfunction\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g)) {
    const cp = findBal(masked, fm.index + fm[0].length - 1, '(', ')');
    const ob = cp > 0 ? masked.indexOf('{', cp) : -1;
    const cb = (ob > 0 && ob - cp < 80) ? findBal(masked, ob, '{', '}') : -1;
    if (cb > ob) fnSpans.push([dwgFindLineIndex(lineStarts, fm.index), dwgFindLineIndex(lineStarts, cb)]);
  }
  for (const am of masked.matchAll(/=>\s*(\{)?/g)) {
    const endIdx = am[1] === '{'
      ? findBal(masked, am.index + am[0].length - 1, '{', '}')
      : masked.indexOf(';', am.index);
    if (endIdx > am.index) fnSpans.push([dwgFindLineIndex(lineStarts, am.index), dwgFindLineIndex(lineStarts, endIdx)]);
  }
  return fnSpans;
}

function dwgIsCommentOnlyLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || (trimmed.startsWith('/*') && trimmed.endsWith('*/'));
}

function dwgCountProceduralSpanLines(rawLines, deducted, sL, eL) {
  let cnt = 0;
  for (let ln = sL; ln <= eL; ln++) {
    const tr = rawLines[ln]?.trim();
    if (!tr || deducted.has(ln) || dwgIsCommentOnlyLine(tr)) continue;
    cnt++;
  }
  return cnt;
}

export function computeFileLineMetrics(source, relPath = '') {
  const ext = extname(relPath).toLowerCase() || '.mjs';
  const masked = maskCommentsAndStrings(source, ext);
  const rawLines = source.split(/\r?\n/), maskedLines = masked.split(/\r?\n/);
  let physicalLines = 0, effectiveLines = 0;
  const lineStarts = [];
  for (let i = 0, pos = 0; i < rawLines.length; i++) {
    lineStarts.push(pos);
    pos += rawLines[i].length + (source[pos + rawLines[i].length] === '\r' ? 2 : 1);
    if (rawLines[i].trim()) physicalLines++;
    if (maskedLines[i]?.trim()) effectiveLines++;
  }
  if (ext === '.py' || ext === '.go') return { effectiveLines, physicalLines, maxProceduralFnLines: effectiveLines };

  const deducted = collectDeductedStaticLines(source, masked, lineStarts);
  let maxProceduralFnLines = 0;
  for (const [sL, eL] of dwgCollectFunctionSpans(masked, lineStarts)) {
    maxProceduralFnLines = Math.max(maxProceduralFnLines, dwgCountProceduralSpanLines(rawLines, deducted, sL, eL));
  }
  return { effectiveLines, physicalLines, maxProceduralFnLines };
}
