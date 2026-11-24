// 全栈功能与入口零配置盘点器：JS/TS 页面路由与 CLI + Python FastAPI/Flask/CLI + 技能目录（<= 300 行聚焦子模块）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { extractHumanTitleFromSource, translateSlugToChinese } from './humanize.mjs';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.donegate', '.dsh', '.deps', '.codegraph', '.stryker-tmp',
  'dist', 'build', '_dist', '.next', 'out', 'coverage', 'reports',
  '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'vendor', '参考', '归档', '证据', '设计'
]);

const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.py']);
const TEST_RE = /(^|\/)(tests?|__tests__|fixtures?)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$/i;

export function walkSourceTree(projectRoot) {
  const sourceFiles = [];
  const skillDirs = [];
  const packageJsons = [];
  const pyprojects = [];

  const rec = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      const rel = relative(projectRoot, full).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (existsSync(join(full, 'SKILL.md'))) skillDirs.push(rel);
        rec(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name === 'package.json') packageJsons.push(rel);
      else if (e.name === 'pyproject.toml') pyprojects.push(rel);
      const ext = extname(e.name).toLowerCase();
      if (CODE_EXTS.has(ext) && !TEST_RE.test(rel)) sourceFiles.push(rel);
    }
  };
  rec(projectRoot);
  return {
    sourceFiles: sourceFiles.sort(),
    skillDirs: skillDirs.sort(),
    packageJsons: packageJsons.sort(),
    pyprojects: pyprojects.sort()
  };
}

function normalizeHttpPath(prefix, sub) {
  const p = ('/' + String(prefix || '').trim() + '/' + String(sub || '').trim())
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return p || '/';
}

export function scanProjectEntries(projectRoot, tree = null) {
  const { sourceFiles, skillDirs, packageJsons, pyprojects } = tree || walkSourceTree(projectRoot);
  const entrypoints = [];
  const fileSourceMap = new Map();
  const stacks = new Set();

  for (const rel of sourceFiles) {
    const content = readMaybe(join(projectRoot, rel)) || '';
    fileSourceMap.set(rel, content);
    const ext = extname(rel).toLowerCase();
    if (ext === '.py') stacks.add('python');
    else if (ext === '.tsx' || ext === '.jsx' || ext === '.vue') stacks.add('web-ui');
    else stacks.add('js-ts');
  }

  // 1. Scan Python FastAPI include_router prefixes across files (varName -> prefix)
  const pyRouterPrefixes = new Map();
  for (const [rel, src] of fileSourceMap.entries()) {
    if (!rel.endsWith('.py')) continue;
    for (const m of src.matchAll(/(\w+)\s*=\s*APIRouter\([^)]*?prefix\s*=\s*['"]([^'"]+)['"]/g)) {
      pyRouterPrefixes.set(`${rel}:${m[1]}`, m[2]);
    }
    for (const m of src.matchAll(/(\w+)\s*=\s*Blueprint\([^,]+,[^)]*?url_prefix\s*=\s*['"]([^'"]+)['"]/g)) {
      pyRouterPrefixes.set(`${rel}:${m[1]}`, m[2]);
    }
  }

  // 2. Scan per-file routes & CLI entrypoints
  for (const [rel, src] of fileSourceMap.entries()) {
    // 2a. Next.js App Router pages & API route handlers
    const appPage = rel.match(/(?:^|\/)app\/(?:(.*)\/)?page\.(?:tsx|jsx|ts|js)$/);
    if (appPage) {
      const rawSeg = (appPage[1] || '').split('/').filter((s) => s && !/^\(.+\)$/.test(s)).join('/');
      const routePath = '/' + rawSeg;
      const human = extractHumanTitleFromSource(rel, src);
      entrypoints.push({
        id: `ep:page:${routePath}`, kind: 'web-page', method: 'PAGE', routePath,
        humanTitle: human, techLabel: `页面路由 ${routePath}`, modulePath: rel
      });
    }
    const appApi = rel.match(/(?:^|\/)app\/(.+)\/route\.(?:ts|js)$/);
    if (appApi) {
      const routePath = '/' + appApi[1].split('/').filter((s) => s && !/^\(.+\)$/.test(s)).join('/');
      for (const hm of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/g)) {
        entrypoints.push({
          id: `ep:api:${hm[1]}:${routePath}`, kind: 'node-api', method: hm[1], routePath,
          humanTitle: `${translateSlugToChinese(routePath)}（接口）`,
          techLabel: `${hm[1]} ${routePath}`, modulePath: rel
        });
      }
    }

    // 2b. Pages Router (Next.js / Vite / Vue)
    const pagesHit = rel.match(/(?:^|\/)pages\/(.+)\.(?:tsx|jsx|vue|ts|js)$/);
    if (pagesHit && !/^_(?:app|document|error)$/.test(pagesHit[1])) {
      const sub = pagesHit[1].replace(/\/index$/, '').replace(/^index$/, '');
      if (sub.startsWith('api/')) {
        const routePath = '/' + sub;
        entrypoints.push({
          id: `ep:api:ALL:${routePath}`, kind: 'node-api', method: 'API', routePath,
          humanTitle: extractHumanTitleFromSource(rel, src), techLabel: `API ${routePath}`, modulePath: rel
        });
      } else {
        const routePath = '/' + sub;
        entrypoints.push({
          id: `ep:page:${routePath}`, kind: 'web-page', method: 'PAGE', routePath,
          humanTitle: extractHumanTitleFromSource(rel, src), techLabel: `页面路由 ${routePath}`, modulePath: rel
        });
      }
    }

    // 2c. React Router <Route path="/..." /> & Express/Fastify/Hono routes
    if (/\.(?:tsx|jsx|ts|js|mjs)$/.test(rel)) {
      for (const rm of src.matchAll(/<Route\b[^>]*?\bpath\s*=\s*['"](\/[^'"]*)['"]/g)) {
        entrypoints.push({
          id: `ep:page:${rm[1]}`, kind: 'web-page', method: 'PAGE', routePath: rm[1],
          humanTitle: translateSlugToChinese(rm[1]), techLabel: `前端路由 ${rm[1]}`, modulePath: rel
        });
      }
      for (const em of src.matchAll(/\b(?:app|router|server)\.(get|post|put|delete|patch)\(\s*['"](\/[^'"]*)['"]/gi)) {
        const verb = em[1].toUpperCase();
        entrypoints.push({
          id: `ep:api:${verb}:${em[2]}`, kind: 'node-api', method: verb, routePath: em[2],
          humanTitle: `${translateSlugToChinese(em[2])}（${verb === 'GET' ? '读取' : '提交'}接口）`,
          techLabel: `${verb} ${em[2]}`, modulePath: rel
        });
      }
    }

    // 2d. Python FastAPI & Flask routes + Python CLI
    if (rel.endsWith('.py')) {
      stacks.add('python');
      const fastRe = /@(\w+)\.(get|post|put|delete|patch)\(\s*['"]([^'"]*)['"]([^)]*)\)[ \t]*(?:\r?\n)+[ \t]*(?:async\s+)?def\s+(\w+)\s*\([^)]*\)(?:\s*->[^:]+)?:[ \t]*(?:\r?\n[ \t]*[rRuU]?(?:"""|''')\s*([^\r\n"']+))?/g;
      for (const fm of src.matchAll(fastRe)) {
        const [, objName, verbRaw, subPath, extraArgs, fnName, docLine] = fm;
        stacks.add('python-fastapi');
        const prefix = pyRouterPrefixes.get(`${rel}:${objName}`) || '';
        const fullPath = normalizeHttpPath(prefix, subPath);
        const sumMatch = (extraArgs || '').match(/summary\s*=\s*['"]([^'"]+)['"]/);
        const human = (sumMatch && sumMatch[1].trim()) || (docLine && docLine.trim()) || translateSlugToChinese(`${fnName}-${fullPath}`);
        const verb = verbRaw.toUpperCase();
        entrypoints.push({
          id: `ep:fastapi:${verb}:${fullPath}`, kind: 'fastapi-route', method: verb, routePath: fullPath,
          symbol: fnName, humanTitle: human, techLabel: `${verb} ${fullPath} → ${fnName}()`, modulePath: rel
        });
      }

      const flaskRe = /@(\w+)\.route\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]+)\])?[^)]*\)\s*(?:\r?\n)+\s*def\s+(\w+)/g;
      for (const fl of src.matchAll(flaskRe)) {
        const [, objName, subPath, methodsRaw, fnName] = fl;
        stacks.add('python-flask');
        const prefix = pyRouterPrefixes.get(`${rel}:${objName}`) || '';
        const fullPath = normalizeHttpPath(prefix, subPath);
        const verb = methodsRaw ? methodsRaw.replace(/['"\s]/g, '').split(',')[0].toUpperCase() : 'GET';
        entrypoints.push({
          id: `ep:flask:${verb}:${fullPath}`, kind: 'flask-route', method: verb, routePath: fullPath,
          symbol: fnName, humanTitle: translateSlugToChinese(`${fnName}-${fullPath}`),
          techLabel: `${verb} ${fullPath} → ${fnName}()`, modulePath: rel
        });
      }

      if (/@(?:\w+\.)?command\(/.test(src) || /ArgumentParser\s*\(/.test(src)) {
        entrypoints.push({
          id: `ep:pycli:${rel}`, kind: 'py-cli', method: 'CLI', routePath: null,
          humanTitle: extractHumanTitleFromSource(rel, src), techLabel: `Python CLI: ${rel}`, modulePath: rel
        });
      }
    }
  }

  // 3. package.json bin entries & pyproject.toml [project.scripts]
  for (const pkgRel of packageJsons) {
    const r = readJsonStrict(join(projectRoot, pkgRel));
    if (!r.ok || !r.value?.bin) continue;
    const pkgDir = dirname(pkgRel);
    const bins = typeof r.value.bin === 'string' ? { [r.value.name || 'cli']: r.value.bin } : r.value.bin;
    for (const [cmdName, targetRel] of Object.entries(bins)) {
      const modPath = join(pkgDir === '.' ? '' : pkgDir, String(targetRel)).replace(/\\/g, '/').replace(/^\.\//, '');
      if (!fileSourceMap.has(modPath)) continue;
      entrypoints.push({
        id: `ep:bin:${cmdName}`, kind: 'node-cli', method: 'CLI', routePath: null,
        humanTitle: `${extractHumanTitleFromSource(modPath, fileSourceMap.get(modPath))}（命令 ${cmdName}）`,
        techLabel: `bin: ${cmdName} → ${modPath}`, modulePath: modPath
      });
    }
  }

  for (const pypRel of pyprojects) {
    const raw = readMaybe(join(projectRoot, pypRel)) || '';
    const sec = raw.split(/^\[project\.scripts\]\s*$/m)[1];
    if (!sec) continue;
    const body = sec.split(/^\[/m)[0];
    for (const m of body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*['"]([^:'"]+)(?::(\w+))?['"]/gm)) {
      const [, scriptName, modDots, fnName] = m;
      const cand1 = modDots.replace(/\./g, '/') + '.py';
      const cand2 = 'src/' + cand1;
      const hit = fileSourceMap.has(cand1) ? cand1 : (fileSourceMap.has(cand2) ? cand2 : null);
      if (!hit) continue;
      entrypoints.push({
        id: `ep:pyscript:${scriptName}`, kind: 'py-cli', method: 'CLI', routePath: null,
        symbol: fnName || null,
        humanTitle: `${extractHumanTitleFromSource(hit, fileSourceMap.get(hit))}（脚本 ${scriptName}）`,
        techLabel: `script: ${scriptName} → ${hit}`, modulePath: hit
      });
    }
  }

  // 4. AI Skill packages (if present)
  for (const sDir of skillDirs) {
    const skTxt = readMaybe(join(projectRoot, sDir, 'SKILL.md')) || '';
    const descMatch = skTxt.match(/^#\s+(.+)$/m);
    const refsDir = join(projectRoot, sDir, 'references');
    let cardCount = 0;
    try { if (existsSync(refsDir)) cardCount = readdirSync(refsDir).filter((x) => x.endsWith('.md')).length; } catch { /* ignore */ }
    entrypoints.push({
      id: `ep:skill:${sDir}`, kind: 'ai-skill', method: 'SKILL', routePath: null,
      humanTitle: descMatch ? descMatch[1].trim().slice(0, 32) : `技能包 ${sDir}`,
      techLabel: `${sDir}/SKILL.md（含 ${cardCount} 张参考卡）`, modulePath: `${sDir}/SKILL.md`
    });
  }

  // Deduplicate by id
  const seen = new Set();
  const uniqueEntries = entrypoints.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return { sourceFiles, fileSourceMap, entrypoints: uniqueEntries, stacks: [...stacks], skillDirs };
}
