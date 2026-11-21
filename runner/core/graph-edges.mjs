// 覆盖率采集与三色依赖边出图命令（graph，<= 350 行聚焦子模块）
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { loadContracts, loadThresholds } from './gates.mjs';

export function collectCodeFilesForCoverage(projectRoot) {
  const { files } = walk(projectRoot, { skipDirs: ['node_modules', '.git', '.donegate', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports'] });
  const codeExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);
  const codeFiles = [];
  const testFiles = [];
  const oversizedFiles = [];
  for (const f of files) {
    const rel = relative(projectRoot, f).replace(/\\/g, '/');
    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    if (!codeExts.has(ext)) continue;
    if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$/i.test(rel)) {
      testFiles.push(rel);
      continue;
    }
    let len = 0;
    try { len = readFileSync(f, 'utf8').length; } catch { continue; }
    if (Math.ceil(len / 4) > 5000) {
      oversizedFiles.push(rel);
      continue;
    }
    codeFiles.push(rel);
  }
  return { codeFiles, testFiles, oversizedFiles };
}

export function computeThreeColorEdges(projectRoot, activeContracts, codeFiles) {
  const ownersOf = (relFile) => activeContracts.filter((c) => (c.scope || []).some((s) => {
    const ns = s.replace(/\\/g, '/').replace(/^\.\//, '');
    return ns.endsWith('/') ? relFile.startsWith(ns) : (relFile === ns || relFile.startsWith(ns + '/'));
  })).map((c) => c.id);

  const codeSet = new Set(codeFiles);
  const actualPairs = new Set();
  let invisible = 0;

  for (const cf of codeFiles) {
    const srcOwners = ownersOf(cf);
    if (srcOwners.length === 0) continue;
    let body = '';
    try { body = readFileSync(join(projectRoot, cf), 'utf8'); } catch { continue; }
    for (const m of body.matchAll(/(?:import\s+(?:[^\n;]*?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1].split(/[?#]/)[0];
      if (!spec.startsWith('.')) continue;
      const baseDir = dirname(cf);
      const rawTarget = normalize(join(baseDir, spec)).replace(/\\/g, '/');
      const candidates = [rawTarget, rawTarget + '.mjs', rawTarget + '.js', rawTarget + '.ts', rawTarget + '/index.mjs', rawTarget + '/index.js'];
      const hit = candidates.find((cand) => codeSet.has(cand));
      if (!hit) continue;
      for (const dstOwner of ownersOf(hit)) {
        for (const srcOwner of srcOwners) {
          if (srcOwner !== dstOwner) actualPairs.add(`${srcOwner}->${dstOwner}`);
        }
      }
    }
    for (const dm of body.matchAll(/\b(?:import|require)\s*\(\s*[^'")\s]/g)) {
      if (dm) invisible++;
    }
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

export function cmdGraph(projectRoot) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors } = loadContracts(projectRoot);
  if (errors.length > 0) return { exitCode: 3, stderr: '契约读取错误，无法出图' };
  const active = contracts.filter((c) => !c.retired);
  const { codeFiles, testFiles, oversizedFiles } = collectCodeFilesForCoverage(projectRoot);

  const claimed = [];
  const orphans = [];
  for (const cf of codeFiles) {
    const matched = active.some((c) => (c.scope || []).some((s) => {
      const ns = s.replace(/\\/g, '/').replace(/^\.\//, '');
      return ns.endsWith('/') ? cf.startsWith(ns) : (cf === ns || cf.startsWith(ns + '/'));
    }));
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

  lines.push('一档图（≥60%：完整图 + 三色依赖连线）');
  lines.push('```mermaid\nflowchart TD');
  for (const c of active) lines.push(`  ${c.id}["${c.id}"]`);
  renderEdges(lines);
  lines.push('```');
  return { exitCode: 0, stdout: lines.join('\n'), coveragePct: pct, tier: 1, orphans, edges };
}
