// 覆盖率采集与三色依赖边出图命令（graph，<= 350 行聚焦子模块）
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { readMaybe } from '../../skill/io.mjs';
import { loadContracts, loadThresholds } from './gates.mjs';
import { extractPythonImportTargets } from './python-imports.mjs';

const GE3_STATIC_IMPORT_RE = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
const GE3_DYNAMIC_IMPORT_RE = /\b(?:import|require)\s*\(\s*[^'")\s]/g;

const GE3_ROOT_TOOLING_CONFIG_RE = /^(?:\.dependency-cruiser\.cjs|stryker\.config\.mjs|vitest\.config\.mjs)$/i;

export function collectCodeFilesForCoverage(projectRoot) {
  const { files } = walk(projectRoot, {
    skipDirs: ['node_modules', '.git', '.donegate', '.deps', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports', '参考', '归档', '设计', '证据']
  });
  const codeExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);
  const codeFiles = [];
  const testFiles = [];
  const oversizedFiles = [];
  for (const f of files) {
    const rel = relative(projectRoot, f).replace(/\\/g, '/');
    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    if (!codeExts.has(ext)) continue;
    if (GE3_ROOT_TOOLING_CONFIG_RE.test(rel)) continue;
    if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|(?:^|\/)fixtures-[^/]+\.mjs$|-fixtures\.mjs$/i.test(rel)) {
      testFiles.push(rel);
      continue;
    }
    let len = 0;
    try { len = readFileSync(f, 'utf8').length; } catch { continue; }
    if (len > 262144) {
      oversizedFiles.push(rel);
      continue;
    }
    codeFiles.push(rel);
  }
  return { codeFiles, testFiles, oversizedFiles };
}

function ge3CompanionDirForFileScope(ns) {
  if (!ns || ns.endsWith('/')) return null;
  const m = ns.match(/^(.+)\.(?:mjs|cjs|js|ts|tsx|jsx|py|go)$/i);
  if (!m) return null;
  const base = m[1].split('/').pop();
  if (!base || base === 'index') return null;
  return `${m[1]}/`;
}

function ge3FileMatchesScope(relFile, scopeItem) {
  const ns = scopeItem.replace(/\\/g, '/').replace(/^\.\//, '');
  if (ns.endsWith('/')) return relFile.startsWith(ns);
  if (relFile === ns || relFile.startsWith(ns + '/')) return true;
  const compDir = ge3CompanionDirForFileScope(ns);
  return Boolean(compDir && relFile.startsWith(compDir));
}

function ge3OwnersOfFile(activeContracts, relFile) {
  return activeContracts.filter((c) => (c.scope || []).some((s) => ge3FileMatchesScope(relFile, s))).map((c) => c.id);
}

function ge3ResolveRelativeTarget(cf, spec, codeSet) {
  if (!spec.startsWith('.')) return null;
  const rawTarget = normalize(join(dirname(cf), spec)).replace(/\\/g, '/');
  const candidates = [
    rawTarget,
    rawTarget + '.mjs', rawTarget + '.js', rawTarget + '.cjs',
    rawTarget + '.ts', rawTarget + '.tsx', rawTarget + '.jsx',
    rawTarget + '/index.mjs', rawTarget + '/index.js', rawTarget + '/index.cjs',
    rawTarget + '/index.ts', rawTarget + '/index.tsx', rawTarget + '/index.jsx'
  ];
  return candidates.find((cand) => codeSet.has(cand)) || null;
}

function ge3StripJsComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function ge3AddOwnerPairs(srcOwners, dstOwners, actualPairs) {
  for (const dstOwner of dstOwners) {
    for (const srcOwner of srcOwners) {
      if (srcOwner !== dstOwner) actualPairs.add(`${srcOwner}->${dstOwner}`);
    }
  }
}

function ge3ScanFileImports(projectRoot, cf, srcOwners, activeContracts, codeSet, actualPairs) {
  const body = readMaybe(join(projectRoot, cf));
  if (body === null) return 0;
  if (cf.endsWith('.py')) {
    for (const hit of extractPythonImportTargets(cf, body, codeSet)) {
      ge3AddOwnerPairs(srcOwners, ge3OwnersOfFile(activeContracts, hit), actualPairs);
    }
    return /\bimportlib\.import_module\s*\(/.test(body) ? 1 : 0;
  }
  const stripped = ge3StripJsComments(body);
  for (const m of stripped.matchAll(GE3_STATIC_IMPORT_RE)) {
    const hit = ge3ResolveRelativeTarget(cf, m[1].split(/[?#]/)[0], codeSet);
    if (hit) ge3AddOwnerPairs(srcOwners, ge3OwnersOfFile(activeContracts, hit), actualPairs);
  }
  let invisible = 0;
  for (const dm of stripped.matchAll(GE3_DYNAMIC_IMPORT_RE)) {
    if (dm) invisible++;
  }
  return invisible;
}

export function computeThreeColorEdges(projectRoot, activeContracts, codeFiles) {
  const codeSet = new Set(codeFiles);
  const actualPairs = new Set();
  let invisible = 0;

  for (const cf of codeFiles) {
    const srcOwners = ge3OwnersOfFile(activeContracts, cf);
    if (srcOwners.length === 0) continue;
    invisible += ge3ScanFileImports(projectRoot, cf, srcOwners, activeContracts, codeSet, actualPairs);
  }

  const declaredPairs = new Set();
  for (const c of activeContracts) {
    for (const dep of (c.dependsOn || [])) declaredPairs.add(`${c.id}->${dep}`);
  }
  const solid = [], dashed = [], red = [];
  for (const pair of declaredPairs) {
    const [from, to] = pair.split('->');
    if (actualPairs.has(pair)) solid.push({ from, to });
    else dashed.push({ from, to });
  }
  for (const pair of actualPairs) {
    if (!declaredPairs.has(pair)) {
      const [from, to] = pair.split('->');
      red.push({ from, to });
    }
  }
  return { solid, dashed, red, invisible };
}

function ge3ComputeLayerGroups(active, solidEdges) {
  const depsById = new Map(active.map((c) => [c.id, []]));
  for (const e of solidEdges) {
    if (depsById.has(e.from) && depsById.has(e.to)) depsById.get(e.from).push(e.to);
  }
  const memo = new Map();
  const visiting = new Set();
  let hasCycle = false;
  const depthOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) { hasCycle = true; return 0; }
    visiting.add(id);
    const deps = depsById.get(id) || [];
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const c of active) depthOf(c.id);
  if (hasCycle || memo.size === 0) return null;
  const groups = new Map();
  for (const c of active) {
    const lv = memo.get(c.id) || 0;
    if (!groups.has(lv)) groups.set(lv, []);
    groups.get(lv).push(c.id);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]);
}

function ge3AppendMermaidNodes(lines, active, solidEdges) {
  const layers = ge3ComputeLayerGroups(active, solidEdges);
  if (!layers || layers.length <= 1) {
    for (const c of active) lines.push(`  ${c.id}["${c.id}"]`);
    return;
  }
  for (const [lv, ids] of layers) {
    const label = lv === 0 ? 'L0 · 纯叶底座' : `L${lv}`;
    lines.push(`  subgraph L${lv}["${label}"]`);
    for (const id of ids.sort()) lines.push(`    ${id}["${id}"]`);
    lines.push('  end');
  }
}

export function cmdGraph(projectRoot) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors } = loadContracts(projectRoot);
  if (errors.length > 0) return { exitCode: 3, stderr: '契约读取错误，无法出图' };
  const active = contracts.filter((c) => !c.retired && c.track !== 'explore');
  const { codeFiles, testFiles, oversizedFiles } = collectCodeFilesForCoverage(projectRoot);

  const claimed = [];
  const orphans = [];
  for (const cf of codeFiles) {
    const matched = active.some((c) => (c.scope || []).some((s) => ge3FileMatchesScope(cf, s)));
    if (matched) claimed.push(cf);
    else orphans.push(cf);
  }
  const pct = codeFiles.length === 0 ? 100 : Math.round((claimed.length / codeFiles.length) * 100);
  const emptyContracts = active.filter((c) => !Array.isArray(c.obligations) || c.obligations.length === 0).map((c) => c.id);
  const edges = computeThreeColorEdges(projectRoot, active, codeFiles);
  const edgeSummary = `实线 ${edges.solid.length} 条 | 虚线 ${edges.dashed.length} 条 | 红线 ${edges.red.length} 条 | 不可见 ${edges.invisible} 处`;

  // 三档出图（08-失效链 链 C / INV-09）
  if (pct < thresholds.coverageMinPct) {
    const needCount = Math.max(1, Math.ceil(orphans.length * 0.8));
    const lines = [
      `覆盖率 ${pct}%（${claimed.length}/${codeFiles.length}，低于 ${thresholds.coverageMinPct}% 拒绝出图，INV-09 退 1）`,
      `孤儿代码 ${orphans.length} 个 | 空契约 ${emptyContracts.length} 个 | 测试文件 ${testFiles.length} 个（不计入分母） | 过大文件 ${oversizedFiles.length} 个`,
      edgeSummary,
      ...(active.length === 0 ? ['提示：当前仓库尚未建立 contracts/ 契约（零契约公开/轻量模式）；浏览全仓业务域与模块拓扑请运行 node runner/donegate.mjs brief 或 zoom all'] : []),
      '孤儿清单（覆盖 80% 孤儿所需最少 scope 增补建议）：',
      ...orphans.slice(0, needCount).map((o) => `  - ${o}`)
    ];
    return { exitCode: 1, stdout: lines.join('\n'), coveragePct: pct, tier: 3, orphans, edges };
  }

  const lines = [
    `覆盖率 ${pct}%（${claimed.length}/${codeFiles.length}） | 孤儿 ${orphans.length} 个 | 空契约 ${emptyContracts.length} 个 | ${edgeSummary}`
  ];
  const renderEdges = (out) => {
    for (const e of edges.solid) out.push(`  ${e.from} -->|实线| ${e.to}`);
    for (const e of edges.dashed) out.push(`  ${e.from} -.->|虚线:未接通| ${e.to}`);
    for (const e of edges.red) out.push(`  ${e.from} --x|红线:未声明| ${e.to}`);
  };
  if (pct < thresholds.coverageFullPct) {
    lines.push(`二档图（30%–60%：只画已认领部分 + 显式灰区）`);
    lines.push('```mermaid\nflowchart TD');
    for (const c of active) lines.push(`  ${c.id}["${c.id}"]`);
    renderEdges(lines);
    lines.push(`  GREY_ZONE["░ 未覆盖灰区：${orphans.length} 个文件（点开孤儿清单查看）"]`);
    lines.push('  style GREY_ZONE fill:#475569,stroke:#94a3b8,stroke-width:3px,color:#f8fafc');
    lines.push('```');
    return { exitCode: 0, stdout: lines.join('\n'), coveragePct: pct, tier: 2, orphans, edges };
  }

  lines.push('一档图（≥60%：完整分层金字塔图 + 三色依赖连线）');
  lines.push('```mermaid\nflowchart TD');
  ge3AppendMermaidNodes(lines, active, edges.solid);
  renderEdges(lines);
  lines.push('```');
  return { exitCode: 0, stdout: lines.join('\n'), coveragePct: pct, tier: 1, orphans, edges };
}
