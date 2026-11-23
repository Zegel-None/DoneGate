// 浏览器拼接脚本隐式耦合图（wb.* / data-action / DOM ID）、@subpack 焦点别名与过程函数双指标计算器
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { maskCommentsAndStrings } from './ast-stub.mjs';

export const ATLAS_SUBPACK_DEFAULTS = {
  '@scanner': [
    'runner/atlas/assemble-atlas.mjs', 'runner/atlas/scan-branches.mjs', 'runner/atlas/scan-entries.mjs',
    'runner/atlas/scan-graph.mjs', 'runner/atlas/humanize.mjs', 'runner/atlas/hydrate-workbench.mjs'
  ],
  '@canvas': [
    'runner/atlas/render-html.mjs', 'runner/atlas/serve-atlas.mjs', 'runner/atlas/ui-shell.mjs',
    'runner/atlas/ui-views.mjs', 'runner/atlas/wb-dom.mjs', 'runner/atlas/wb-events-actions.mjs',
    'runner/atlas/wb-events-pointer.mjs', 'runner/atlas/wb-events-wheel-drop.mjs', 'runner/atlas/wb-graph-engine.mjs',
    'runner/atlas/wb-history.mjs', 'runner/atlas/wb-inline-rename.mjs', 'runner/atlas/wb-layout-tidy.mjs',
    'runner/atlas/wb-menus-viewport.mjs', 'runner/atlas/wb-render-cards.mjs', 'runner/atlas/wb-render-wires.mjs',
    'runner/atlas/wb-snap-rulers.mjs', 'runner/atlas/wb-style-base.mjs', 'runner/atlas/wb-style-canvas.mjs',
    'runner/atlas/wb-viewport-ops.mjs'
  ],
  '@uiboard': [
    'runner/atlas/wb-uiboard.mjs', 'runner/atlas/ui-shell.mjs', 'runner/atlas/ui-views.mjs',
    'runner/atlas/wb-dom.mjs', 'runner/atlas/wb-style-base.mjs', 'runner/atlas/render-html.mjs'
  ],
  '@workflow': [
    'runner/atlas/wb-jit-workflow.mjs', 'runner/atlas/wb-catalog.mjs', 'runner/atlas/wb-subagent.mjs',
    'runner/atlas/wb-events-actions.mjs', 'runner/atlas/hydrate-workbench.mjs'
  ],
  '@dsh-dock': [
    'runner/atlas/wb-dsh-bridge.mjs', 'runner/atlas/wb-dsh-shell.mjs', 'runner/atlas/wb-dsh-style.mjs',
    'runner/atlas/wb-subagent.mjs', 'runner/atlas/serve-atlas.mjs'
  ]
};

const COMMON_WB_CONTAINERS = new Set([
  'state', 'data', 'dom', 'els', 'el', 'root', 'app', 'cfg', 'config', 'opts', 'options',
  'store', 'cache', 'ui', 'ctx', 'svg', 'canvas', 'nodes', 'links', 'edges', 'toast',
  'esc', 'escapeHtml', 'render', 'scheduleRender', 'fetchJson', 'api', 'log'
]);

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
  const decl = src.match(/export\s+const\s+(?:ATLAS_SUBPACKS|[A-Z0-9_]*SUBPACKS)\s*=\s*\{/);
  if (!decl) return null;
  const openBrace = decl.index + decl[0].length - 1;
  const closeBrace = findBal(src, openBrace, '{', '}');
  if (closeBrace < 0) return null;
  const body = src.slice(openBrace + 1, closeBrace);
  const out = {};
  for (const m of body.matchAll(/(?:['"](@?[A-Za-z0-9_-]+)['"]|([A-Za-z0-9_-]+))\s*:\s*\[([\s\S]*?)\]/g)) {
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

export function resolveSubpackFocusPatterns(projectRoot, target, focusPatterns = []) {
  const map = {};
  const isAtlas = target?.id === 'atlas-workbench' || (target?.scope || []).some((s) => String(s).replace(/\\/g, '/').includes('runner/atlas'));
  if (isAtlas) Object.assign(map, ATLAS_SUBPACK_DEFAULTS);
  for (const f of target?.stub?.facadeFiles || []) {
    if (!f.endsWith('/contract.mjs') && f !== 'contract.mjs') continue;
    const dirPref = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    const parsed = parseExportedSubpacksFromContract(join(projectRoot, f), dirPref);
    if (parsed) Object.assign(map, parsed);
  }
  if (isAtlas) {
    const parsedAtlas = parseExportedSubpacksFromContract(join(projectRoot, 'runner/atlas/contract.mjs'), 'runner/atlas');
    if (parsedAtlas) Object.assign(map, parsedAtlas);
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

export function extractFileDomWiring(source, relPath = '') {
  const wbDefs = new Set(), wbRefs = new Set();
  const actionTriggers = new Set(), actionHandlers = new Set();
  const domDefs = new Set(), domRefs = new Set();
  if (!source) return { relPath, wbDefs: [], wbRefs: [], actionTriggers: [], actionHandlers: [], actions: [], domDefs: [], domRefs: [], domIds: [] };

  const masked = maskCommentsAndStrings(source, extname(relPath).toLowerCase() || '.mjs');
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
  for (const tm of source.matchAll(/data-action\s*=\s*\\?['"]([A-Za-z0-9_:-]{2,64})\\?['"]/g)) actionTriggers.add(tm[1]);
  for (const hm of source.matchAll(/\bcase\s+['"]([A-Za-z0-9_:-]{2,64})['"]\s*:|\b(?:action|act|cmd|actName|actionName)\s*===?\s*['"]([A-Za-z0-9_:-]{2,64})['"]|['"]([A-Za-z0-9_:-]{2,64})['"]\s*===?\s*\b(?:action|act|cmd|actName|actionName)\b/g)) {
    actionHandlers.add(hm[1] || hm[2] || hm[3]);
  }
  for (const dm of source.matchAll(/\bid\s*=\s*\\?['"]([A-Za-z][A-Za-z0-9_:-]{1,63})\\?['"]/g)) {
    if (!isHexColorToken(dm[1])) domDefs.add(dm[1]);
  }
  for (const gm of source.matchAll(/\bgetElementById\s*\(\s*['"]([A-Za-z][A-Za-z0-9_:-]{1,63})['"]\s*\)/g)) {
    if (!isHexColorToken(gm[1])) domRefs.add(gm[1]);
  }
  for (const qm of source.matchAll(/\b(?:querySelector|querySelectorAll|closest|matches|\$\$?)\s*\(\s*['"`][^'"`\n]{0,120}?#([A-Za-z][A-Za-z0-9_-]{1,63})\b/g)) {
    if (!isHexColorToken(qm[1])) domRefs.add(qm[1]);
  }

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

export function buildDomWiringGraph(rawByFile) {
  const byFile = new Map();
  const edges = new Map();
  const files = [...rawByFile.keys()].sort();
  for (const f of files) {
    byFile.set(f, extractFileDomWiring(rawByFile.get(f) || '', f));
    edges.set(f, new Set());
  }
  const propTouchCount = new Map();
  for (const w of byFile.values()) {
    for (const p of new Set([...w.wbDefs, ...w.wbRefs])) propTouchCount.set(p, (propTouchCount.get(p) || 0) + 1);
  }
  const hubCap = Math.max(5, Math.ceil(files.length * 0.35));
  const link = (a, b) => { if (a !== b) { edges.get(a)?.add(b); edges.get(b)?.add(a); } };

  const indexPair = (producersFn, consumersFn, allowKey = () => true) => {
    const prodMap = new Map();
    for (const [f, w] of byFile.entries()) {
      for (const k of producersFn(w)) {
        if (!allowKey(k)) continue;
        if (!prodMap.has(k)) prodMap.set(k, []);
        prodMap.get(k).push(f);
      }
    }
    for (const [f, w] of byFile.entries()) {
      for (const k of consumersFn(w)) {
        if (!allowKey(k)) continue;
        for (const pf of prodMap.get(k) || []) link(f, pf);
      }
    }
  };

  indexPair((w) => w.wbDefs, (w) => [...w.wbRefs, ...w.wbDefs], (p) => (propTouchCount.get(p) || 0) <= hubCap);
  indexPair((w) => w.actionTriggers, (w) => w.actionHandlers);
  indexPair((w) => w.domDefs, (w) => w.domRefs);

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

function collectDeductedStaticLines(source, masked, lineStarts) {
  const deducted = new Set();
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= idx) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(0, hi);
  };
  const rawLines = source.split(/\r?\n/);

  for (let i = 0, n = source.length; i < n;) {
    const c = source[i], c2 = source.slice(i, i + 2);
    if (c2 === '//') { while (i < n && source[i] !== '\n') i++; }
    else if (c2 === '/*') { i += 2; while (i < n && source.slice(i, i + 2) !== '*/') i++; i += 2; }
    else if (c === '"' || c === "'") { i++; while (i < n && source[i] !== c) i += source[i] === '\\' ? 2 : 1; i++; }
    else if (c === '`') {
      const sIdx = i;
      i++;
      let interpDepth = 0;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (interpDepth === 0 && source[i] === '`') { i++; break; }
        if (source.slice(i, i + 2) === '${') { interpDepth++; i += 2; continue; }
        if (interpDepth > 0 && source[i] === '{') interpDepth++;
        else if (interpDepth > 0 && source[i] === '}') interpDepth--;
        i++;
      }
      const sLine = lineOf(sIdx), eLine = lineOf(Math.max(sIdx, i - 1));
      if (eLine - sLine + 1 >= 12) {
        for (let ln = sLine + 1; ln < eLine; ln++) if (!rawLines[ln]?.includes('${')) deducted.add(ln);
      }
    } else i++;
  }

  for (const m of masked.matchAll(/\[/g)) {
    const closeIdx = findBal(masked, m.index, '[', ']');
    if (closeIdx < 0 || !/^\s*\.join\s*\(/.test(masked.slice(closeIdx + 1, closeIdx + 24))) continue;
    const sLine = lineOf(m.index), eLine = lineOf(closeIdx);
    if (eLine - sLine + 1 < 12) continue;
    const inner = masked.slice(m.index + 1, closeIdx);
    if (!/[A-Za-z0-9_$();{}]/.test(inner)) {
      for (let ln = sLine + 1; ln < eLine; ln++) deducted.add(ln);
    }
  }
  return deducted;
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
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lineStarts[mid] <= idx) lo = mid + 1; else hi = mid - 1; }
    return Math.max(0, hi);
  };
  const fnSpans = [];
  for (const fm of masked.matchAll(/\bfunction\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g)) {
    const cp = findBal(masked, fm.index + fm[0].length - 1, '(', ')');
    const ob = cp > 0 ? masked.indexOf('{', cp) : -1;
    const cb = (ob > 0 && ob - cp < 80) ? findBal(masked, ob, '{', '}') : -1;
    if (cb > ob) fnSpans.push([lineOf(fm.index), lineOf(cb)]);
  }
  for (const am of masked.matchAll(/=>\s*(\{)?/g)) {
    if (am[1] === '{') {
      const ob = am.index + am[0].length - 1, cb = findBal(masked, ob, '{', '}');
      if (cb > ob) fnSpans.push([lineOf(am.index), lineOf(cb)]);
    } else {
      const semi = masked.indexOf(';', am.index);
      if (semi > am.index) fnSpans.push([lineOf(am.index), lineOf(semi)]);
    }
  }
  let maxProceduralFnLines = 0;
  for (const [sL, eL] of fnSpans) {
    let cnt = 0;
    for (let ln = sL; ln <= eL; ln++) {
      if (!rawLines[ln]?.trim() || deducted.has(ln)) continue;
      const tr = rawLines[ln].trim();
      if (tr.startsWith('//') || (tr.startsWith('/*') && tr.endsWith('*/')) || tr.startsWith('*')) continue;
      cnt++;
    }
    if (cnt > maxProceduralFnLines) maxProceduralFnLines = cnt;
  }
  return { effectiveLines, physicalLines, maxProceduralFnLines };
}
