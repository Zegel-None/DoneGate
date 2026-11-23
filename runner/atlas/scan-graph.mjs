// 多语言模块依赖图谱与「前端请求 ↔ 后端路由 / 根目录配置入口 ↔ 下游模块」调用链缝合器
import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';

function loadTsPathAliases(projectRoot) {
  for (const cfgName of ['tsconfig.json', 'jsconfig.json']) {
    const raw = readMaybe(join(projectRoot, cfgName));
    if (!raw) continue;
    try {
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*([}\]])/g, '$1');
      const cfg = JSON.parse(stripped);
      const baseUrl = cfg?.compilerOptions?.baseUrl || '.';
      const paths = cfg?.compilerOptions?.paths || {};
      const aliases = [];
      for (const [pat, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || !targets[0]) continue;
        const prefix = pat.replace(/\*$/, '');
        const targetPrefix = join(baseUrl, String(targets[0]).replace(/\*$/, '')).replace(/\\/g, '/').replace(/^\.\//, '');
        aliases.push({ prefix, targetPrefix });
      }
      return aliases;
    } catch (err) {
      void err;
    }
  }
  return [];
}

function resolveModuleCandidate(rawBase, fileSet) {
  const clean = rawBase.replace(/\\/g, '/').replace(/^\.\//, '');
  const exts = ['', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.cjs', '.vue', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];
  for (const ext of exts) {
    if (fileSet.has(clean + ext)) return clean + ext;
  }
  if (clean.endsWith('.js')) {
    const stem = clean.slice(0, -3);
    if (fileSet.has(stem + '.ts')) return stem + '.ts';
    if (fileSet.has(stem + '.tsx')) return stem + '.tsx';
  }
  return null;
}

function resolvePythonImport(fromRel, modSpec, levelDots, fileSet) {
  let baseParts = [];
  if (levelDots > 0) {
    const dirParts = dirname(fromRel).split('/').filter((p) => p && p !== '.');
    baseParts = dirParts.slice(0, Math.max(0, dirParts.length - (levelDots - 1)));
  }
  const subParts = modSpec ? modSpec.split('.').filter(Boolean) : [];
  const joined = [...baseParts, ...subParts].join('/');
  const roots = levelDots > 0 ? [joined] : [joined, `src/${joined}`];
  for (const r of roots) {
    if (!r) continue;
    if (fileSet.has(`${r}.py`)) return `${r}.py`;
    if (fileSet.has(`${r}/__init__.py`)) return `${r}/__init__.py`;
  }
  return null;
}

export function extractExportsOfFile(rel, src) {
  const out = new Set();
  if (rel.endsWith('.py')) {
    for (const m of src.matchAll(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
      if (!m[1].startsWith('_')) out.add(m[1] + '()');
    }
    for (const m of src.matchAll(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)) {
      if (!m[1].startsWith('_')) out.add(m[1]);
    }
  } else {
    for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1] + '()');
    for (const m of src.matchAll(/\bexport\s+(?:const|let)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]);
  }
  return [...out].slice(0, 10);
}

function routeToPatternRegex(routePath) {
  const segs = String(routePath || '/').split('/').filter(Boolean).map((seg) => {
    if (/^\{[^}]+\}$|^:[A-Za-z0-9_]+$|^<[^>]+>$|^\[[^\]]+\]$/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^/' + segs.join('/') + '/?$');
}

function pickDirRepresentativeFile(dirPrefix, sourceFiles) {
  const cleanDir = dirPrefix.replace(/^\^+/, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') + '/';
  const cands = sourceFiles.filter((f) => f.startsWith(cleanDir));
  if (cands.length === 0) return null;
  return cands.find((f) => /(?:^|\/)(?:donegate|index|main|app|contract)\.[a-z0-9]+$/i.test(f)) || cands[0];
}

function scanScriptAndRootEntryRefs(projectRoot, sourceFiles, fileSourceMap, fileSet, addEdge) {
  const pathTokenRe = /(?:^|['"`\s=(%~0\\/-])((?:\.\/)?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.(?:mjs|cjs|js|ts|tsx|jsx|py))\b/g;
  for (const rel of sourceFiles) {
    const src = fileSourceMap.get(rel) || '';
    for (const m of src.matchAll(pathTokenRe)) {
      const clean = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
      if (fileSet.has(clean) && clean !== rel) {
        addEdge(rel, clean, !rel.includes('/') ? 'entry-ref' : 'script-ref', clean);
      }
    }
    if (!rel.includes('/')) {
      for (const dm of src.matchAll(/['"`]\^?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)\/(?:\.\*)?['"`]/g)) {
        const rep = pickDirRepresentativeFile(dm[1], sourceFiles);
        if (rep && rep !== rel) addEdge(rel, rep, 'config-ref', `${dm[1]}/`);
      }
    }
  }

  const rootAnchor = sourceFiles.find((f) => !f.includes('/'));
  if (!rootAnchor) return;
  const rootTexts = [];
  for (const name of ['package.json', 'adapters.registry.json']) {
    const raw = readMaybe(join(projectRoot, name));
    if (raw) rootTexts.push([name, raw]);
  }
  try {
    for (const ent of readdirSync(projectRoot, { withFileTypes: true })) {
      if (ent.isFile() && /\.(?:cmd|sh)$/i.test(ent.name)) {
        const raw = readMaybe(join(projectRoot, ent.name));
        if (raw) rootTexts.push([ent.name, raw]);
      }
    }
  } catch (err) {
    void err;
  }
  for (const [label, txt] of rootTexts) {
    for (const m of txt.matchAll(pathTokenRe)) {
      const clean = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
      if (fileSet.has(clean) && clean !== rootAnchor) addEdge(rootAnchor, clean, 'entry-ref', `${label} -> ${clean}`);
    }
  }
}

export function scanCrossLanguageGraph(projectRoot, { sourceFiles, fileSourceMap, entrypoints }) {
  const fileSet = new Set(sourceFiles);
  const aliases = loadTsPathAliases(projectRoot);
  const edges = [];
  const edgeDedup = new Set();
  const exportsByFile = new Map();

  const addEdge = (from, to, kind, detail = '') => {
    if (!from || !to || from === to) return;
    const key = `${from}->${to}:${kind}`;
    if (edgeDedup.has(key)) return;
    edgeDedup.add(key);
    edges.push({ from, to, kind, detail });
  };

  const backendRoutes = entrypoints
    .filter((e) => ['fastapi-route', 'flask-route', 'node-api'].includes(e.kind) && e.routePath)
    .map((e) => ({ ...e, re: routeToPatternRegex(e.routePath) }));

  for (const rel of sourceFiles) {
    const src = fileSourceMap.get(rel) || '';
    exportsByFile.set(rel, extractExportsOfFile(rel, src));
    const ext = extname(rel).toLowerCase();

    if (ext === '.py') {
      const stripped = src.replace(/#.*$/gm, '');
      for (const m of stripped.matchAll(/^\s*from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+([^\r\n#]+)/gm)) {
        const dots = (m[1] || '').length;
        const modName = m[2] || '';
        const hit = resolvePythonImport(rel, modName, dots, fileSet);
        if (hit) addEdge(rel, hit, 'py-import', `import ${modName || m[3].trim()}`);
        else {
          for (const subSym of m[3].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)) {
            const subHit = resolvePythonImport(rel, modName ? `${modName}.${subSym}` : subSym, dots, fileSet);
            if (subHit) addEdge(rel, subHit, 'py-import', `import ${subSym}`);
          }
        }
      }
      for (const m of stripped.matchAll(/^\s*import\s+([A-Za-z0-9_.,\s]+)/gm)) {
        for (const part of m[1].split(',')) {
          const modName = part.trim().split(/\s+/)[0];
          const hit = resolvePythonImport(rel, modName, 0, fileSet);
          if (hit) addEdge(rel, hit, 'py-import', `import ${modName}`);
        }
      }
      continue;
    }

    for (const m of src.matchAll(/(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+[^\n;]*?\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1].split(/[?#]/)[0].trim();
      if (!spec) continue;
      let hit = null;
      if (spec.startsWith('.')) {
        const raw = normalize(join(dirname(rel), spec));
        hit = resolveModuleCandidate(raw, fileSet);
      } else {
        for (const al of aliases) {
          if (spec.startsWith(al.prefix)) {
            hit = resolveModuleCandidate(al.targetPrefix + spec.slice(al.prefix.length), fileSet);
            if (hit) break;
          }
        }
      }
      if (hit) addEdge(rel, hit, 'js-import', spec);
    }

    if (backendRoutes.length > 0) {
      const httpCallRe = /\b(?:fetch|axios(?:\.(?:get|post|put|delete|patch))?|request|apiClient|http(?:\.(?:get|post|put|delete|patch))?)\s*\(\s*(['"`])(\/[^'"`\s)]+)\1/g;
      for (const hm of src.matchAll(httpCallRe)) {
        const rawUrl = hm[2].split('?')[0].replace(/\$\{[^}]+\}/g, ':param');
        for (const br of backendRoutes) {
          if (br.modulePath !== rel && br.re.test(rawUrl)) {
            addEdge(rel, br.modulePath, 'http-bridge', `${br.method} ${br.routePath}`);
          }
        }
      }
    }
  }

  scanScriptAndRootEntryRefs(projectRoot, sourceFiles, fileSourceMap, fileSet, addEdge);

  let cycleCount = 0;
  const cgObsPath = join(projectRoot, '.donegate', 'adapters', 'codegraph', 'observation.json');
  if (existsSync(cgObsPath)) {
    const cgRes = readJsonStrict(cgObsPath);
    if (cgRes.ok && typeof cgRes.value?.cycleCount === 'number') cycleCount = cgRes.value.cycleCount;
  }

  return { edges, exportsByFile, cycleCount };
}
