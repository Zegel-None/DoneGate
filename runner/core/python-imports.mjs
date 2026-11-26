// 零依赖 Python 导入解析与可选 WASM Tree-sitter 工具舱探针（供 graph-edges / context-router / hermetic-capsule 共享）
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

export function extractPythonImportTargets(fromRel, source, fileSet) {
  const hits = new Set();
  const stripped = String(source || '')
    .replace(/#.*$/gm, '')
    .replace(/\(\s*([\s\S]*?)\s*\)/g, (m, inner) => (/\bimport\b/.test(inner) ? m : inner.replace(/\r?\n/g, ' ')));
  for (const m of stripped.matchAll(/^\s*from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+([^\r\n;]+)/gm)) {
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
  for (const m of stripped.matchAll(/^\s*import\s+([A-Za-z0-9_.,\s]+)/gm)) {
    for (const part of m[1].split(',')) {
      const modName = part.trim().split(/\s+/)[0];
      const hit = resolvePythonImport(fromRel, modName, 0, fileSet);
      if (hit && hit !== fromRel) hits.add(hit);
    }
  }
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
