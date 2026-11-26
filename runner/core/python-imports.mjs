// 零依赖 Python 导入解析与可选 WASM Tree-sitter 工具舱探针（供 graph-edges / context-router / hermetic-capsule 共享）
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const pyCompactWs = (t) => t.replace(/\s+/g, ' ').replace(/\s*([(),:;])\s*/g, '$1 ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function pyFindBal(masked, startIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = startIdx; i < masked.length; i++) {
    if (masked[i] === openCh) depth++;
    else if (masked[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

function pyShouldExportName(name, isNested) {
  if (!name.startsWith('_')) return true;
  return isNested && name.startsWith('__') && name.endsWith('__');
}

function pyFindHeaderColon(masked, startPos) {
  let cursor = startPos;
  while (cursor < masked.length && /[ \t]/.test(masked[cursor])) cursor++;
  if (masked[cursor] === '[') {
    const closeGen = pyFindBal(masked, cursor, '[', ']');
    if (closeGen < 0) return -1;
    cursor = closeGen + 1;
    while (cursor < masked.length && /[ \t]/.test(masked[cursor])) cursor++;
  }
  if (masked[cursor] === '(') {
    const closeIdx = pyFindBal(masked, cursor, '(', ')');
    if (closeIdx < 0) return -1;
    cursor = closeIdx + 1;
  }
  let depth = 0;
  for (let i = cursor; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

function pyExtractInitReexports(masked, relPath) {
  if (!/(^|\/)__init__\.py$/i.test(String(relPath || '').replace(/\\/g, '/'))) return [];
  const collapsed = masked.replace(/\\[ \t]*\r?\n/g, ' ').replace(/\(\s*([^()]*?)\s*\)/g, (_m, inner) => `(${inner.replace(/\r?\n/g, ' ')})`);
  const entries = [];
  for (const m of collapsed.matchAll(/^[ \t]*from[ \t]+(\.+)([A-Za-z0-9_.]*)[ \t]+import[ \t]+([^\r\n;]+)/gm)) {
    const clause = pyCompactWs(m[3].replace(/[()]/g, ''));
    const sig = `from ${m[1]}${m[2]} import ${clause}`;
    entries.push({ symbol: `reexport:py:${sig}`, doc: '', signature: sig });
  }
  return entries;
}

export function extractPythonExportsBalanced(source, masked, relPath = '') {
  const entries = [];
  let topBlockKind = null;
  for (const m of masked.matchAll(/^([ \t]*)(async\s+def|def|class)\s+([A-Za-z_][\w]*)/gm)) {
    const indent = m[1] || '', indentLen = indent.replace(/\t/g, '    ').length, isNested = indentLen > 0;
    const isClass = m[2] === 'class';
    if (!isNested) topBlockKind = isClass ? 'class' : 'def';
    else if (topBlockKind !== 'class' || indentLen > 4) continue;
    if (!pyShouldExportName(m[3], isNested)) continue;
    const colonIdx = pyFindHeaderColon(masked, m.index + m[0].length);
    if (colonIdx < 0) continue;
    const header = pyCompactWs(source.slice(m.index + indent.length, colonIdx));
    const sym = isClass ? m[3] : (isNested ? `.${m[3]}` : m[3]);
    entries.push({ symbol: sym, doc: '', signature: `${isNested ? '  ' : ''}${header}: ...` });
  }
  return [...entries, ...pyExtractInitReexports(masked, relPath)];
}

export function pyInitHasPublicSurface(absPath) {
  try {
    const masked = maskPythonCommentsAndStrings(readFileSync(absPath, 'utf8'));
    return /^(?:async\s+def|def|class)\s+[A-Za-z]|^[ \t]*from[ \t]+\.+[A-Za-z0-9_.]*[ \t]+import\b|^[ \t]*__all__[ \t]*=/m.test(masked);
  } catch (err) {
    void err;
    return false;
  }
}

export function resolvePythonImport(fromRel, modSpec, levelDots, fileSet) {
  let baseParts = [];
  if (levelDots > 0) {
    const dirParts = dirname(String(fromRel || '').replace(/\\/g, '/')).split('/').filter((p) => p && p !== '.');
    baseParts = dirParts.slice(0, Math.max(0, dirParts.length - (levelDots - 1)));
  }
  const subParts = modSpec ? String(modSpec).split('.').filter(Boolean) : [];
  const joined = [...baseParts, ...subParts].join('/');
  const roots = levelDots > 0 ? [joined] : [joined, `src/${joined}`];
  for (const r of roots) {
    if (!r) continue;
    if (fileSet.has(`${r}.py`)) return `${r}.py`;
    if (fileSet.has(`${r}/__init__.py`)) return `${r}/__init__.py`;
  }
  return null;
}

function pySkipString(src, startIdx, out) {
  const q = src[startIdx];
  const isTriple = src[startIdx + 1] === q && src[startIdx + 2] === q;
  const delimLen = isTriple ? 3 : 1;
  for (let k = 0; k < delimLen; k++) out.push(' ');
  let i = startIdx + delimLen;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      out.push(' ', src[i + 1] === '\n' ? '\n' : ' ');
      i += 2;
      continue;
    }
    if (isTriple && ch === q && src[i + 1] === q && src[i + 2] === q) {
      out.push(' ', ' ', ' ');
      return i + 3;
    }
    if (!isTriple && (ch === q || ch === '\n')) {
      out.push(ch === '\n' ? '\n' : ' ');
      return i + 1;
    }
    out.push(ch === '\n' ? '\n' : ' ');
    i++;
  }
  return i;
}

export function maskPythonCommentsAndStrings(source) {
  const src = String(source || '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (ch === '\'' || ch === '"') {
      i = pySkipString(src, i, out);
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
}

function pyCollapseImportParens(masked) {
  let out = '';
  let i = 0;
  while (i < masked.length) {
    if (masked[i] === '(') {
      let depth = 1, j = i + 1;
      while (j < masked.length && depth > 0) {
        if (masked[j] === '(') depth++;
        else if (masked[j] === ')') depth--;
        j++;
      }
      if (depth === 0) {
        const inner = masked.slice(i + 1, j - 1);
        out += /\bimport\b/.test(inner) ? masked.slice(i, j) : `(${inner.replace(/\r?\n/g, ' ')})`;
        i = j;
        continue;
      }
    }
    out += masked[i];
    i++;
  }
  return out;
}

function pyCollectFromImports(fromRel, normalized, fileSet, hits) {
  for (const m of normalized.matchAll(/^[ \t]*from[ \t]+(\.*)([A-Za-z0-9_.]*)[ \t]+import[ \t]+([^\r\n;]+)/gm)) {
    const dots = (m[1] || '').length;
    const modName = m[2] || '';
    const hit = resolvePythonImport(fromRel, modName, dots, fileSet);
    if (hit && hit !== fromRel) hits.add(hit);
    for (const rawSym of m[3].replace(/[()]/g, '').split(',')) {
      const sym = rawSym.trim().split(/\s+/)[0];
      if (!sym || sym === '*') continue;
      const subHit = resolvePythonImport(fromRel, modName ? `${modName}.${sym}` : sym, dots, fileSet);
      if (subHit && subHit !== fromRel) hits.add(subHit);
    }
  }
}

function pyCollectBareImports(fromRel, normalized, fileSet, hits) {
  for (const m of normalized.matchAll(/^[ \t]*import[ \t]+([A-Za-z0-9_., \t]+)/gm)) {
    for (const part of m[1].split(',')) {
      const modName = part.trim().split(/[ \t]+/)[0];
      if (!modName) continue;
      const hit = resolvePythonImport(fromRel, modName, 0, fileSet);
      if (hit && hit !== fromRel) hits.add(hit);
    }
  }
}

export function extractPythonImportTargets(fromRel, source, fileSet) {
  const hits = new Set();
  const masked = maskPythonCommentsAndStrings(source).replace(/\\[ \t]*\r?\n/g, ' ');
  const normalized = pyCollapseImportParens(masked);
  pyCollectFromImports(fromRel, normalized, fileSet, hits);
  pyCollectBareImports(fromRel, normalized, fileSet, hits);
  return [...hits].sort();
}

export function probeTreeSitterWasmCell(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const cellDir = join(root, 'workflows', '.deps', '_shared', 'npm-cells', 'tree-sitter');
  const runtimePath = join(cellDir, 'node_modules', 'web-tree-sitter', 'package.json');
  const wasmsPath = join(cellDir, 'node_modules', 'tree-sitter-wasms', 'out', 'tree-sitter-python.wasm');
  const available = existsSync(runtimePath) && existsSync(wasmsPath);
  return {
    available,
    engine: available ? 'web-tree-sitter-wasm' : 'zero-dep-balanced-scanner',
    cellDir: 'workflows/.deps/_shared/npm-cells/tree-sitter',
    pythonWasmReady: existsSync(wasmsPath)
  };
}
