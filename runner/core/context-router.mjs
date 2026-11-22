// L0 三级渐进全局路由生成器（适配 1M 窗口 × 40% = 400k Tokens 五段式子代理预算）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildNodeInterfaceStub, maskCommentsAndStrings } from './ast-stub.mjs';
import { computeProjectStatus, loadContracts, loadThresholds } from './gates.mjs';
import { DEFAULT_SUBAGENT_BUDGET } from './project-loader.mjs';
import { collectCodeFilesForCoverage } from './graph-edges.mjs';

const normalizeScopePrefix = (s) => String(s || '').replace(/\\/g, '/').replace(/^\.\//, '');

export function fileBelongsToScopes(relFile, scopes = []) {
  const rf = normalizeScopePrefix(relFile);
  return (Array.isArray(scopes) ? scopes : []).some((s) => {
    const ns = normalizeScopePrefix(s);
    return ns ? (ns.endsWith('/') ? rf.startsWith(ns) : (rf === ns || rf.startsWith(ns + '/'))) : false;
  });
}

export function resolveSubagentBudgetProfile(thresholds, opts = {}) {
  const base = { ...DEFAULT_SUBAGENT_BUDGET, ...(thresholds?.subagentContextBudget || {}) };
  const win = Number(opts.contextWindow) > 0 ? Math.round(Number(opts.contextWindow)) : base.contextWindowTokens;
  const utilRaw = Number(opts.utilization);
  const util = (utilRaw > 0 && utilRaw <= 0.9) ? utilRaw : base.targetUtilization;
  const hasCustomScale = Number(opts.contextWindow) > 0 || (utilRaw > 0 && utilRaw <= 0.9);
  const total = hasCustomScale ? Math.round(win * util) : (base.totalSessionBudgetTokens || Math.round(win * util));

  const routerBudgetTokens = hasCustomScale ? Math.max(800, Math.round(total * 0.02)) : base.routerBudgetTokens;
  const zeroHopSourceBudgetTokens = Number(opts.maxTokens) > 0
    ? Math.round(Number(opts.maxTokens))
    : (hasCustomScale ? Math.round(total * 0.40) : base.zeroHopSourceBudgetTokens);
  const oneHopContractBudgetTokens = hasCustomScale ? Math.round(total * 0.12) : base.oneHopContractBudgetTokens;
  const onDemandExpandBudgetTokens = hasCustomScale ? Math.round(total * 0.16) : base.onDemandExpandBudgetTokens;
  const multiTurnReserveTokens = hasCustomScale ? Math.round(total * 0.30) : base.multiTurnReserveTokens;
  return {
    contextWindowTokens: win,
    targetUtilization: util,
    totalSessionBudgetTokens: total,
    routerBudgetTokens,
    zeroHopSourceBudgetTokens,
    oneHopContractBudgetTokens,
    onDemandExpandBudgetTokens,
    multiTurnReserveTokens,
    capsuleInitialMaxTokens: routerBudgetTokens + zeroHopSourceBudgetTokens + oneHopContractBudgetTokens,
    receiptBudgetTokens: base.receiptBudgetTokens || 500
  };
}

function loadCanvasExtraNodes(projectRoot, existingIds) {
  const wbPath = join(projectRoot, '.donegate', 'workbench-state.json');
  if (!existsSync(wbPath)) return { extraNodes: [], canvasEdges: [] };
  const r = readJsonStrict(wbPath);
  if (!r.ok || !r.value || typeof r.value !== 'object') return { extraNodes: [], canvasEdges: [] };
  const extraNodes = [];
  for (const n of (Array.isArray(r.value.nodes) ? r.value.nodes : [])) {
    if (!n || !n.id || n.bypassed || n.isBoundary || n.isSubRepoRef || n.isBlank) continue;
    const cid = n.contractId || n.id;
    const scopes = Array.isArray(n.scopes) ? n.scopes : (Array.isArray(n.scope) ? n.scope : []);
    if (existingIds.has(cid) || scopes.length === 0) continue;
    existingIds.add(cid);
    extraNodes.push({
      id: cid, title: n.name || n.title || cid, why: n.desc || n.summary || '画布组件节点',
      scope: scopes, dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn : [], obligations: [], sourceKind: 'canvas'
    });
  }
  const canvasEdges = (Array.isArray(r.value.links) ? r.value.links : [])
    .map((lk) => ({ from: lk.fromNode || lk.from || lk.src, to: lk.toNode || lk.to || lk.dst }))
    .filter((e) => e.from && e.to && e.from !== e.to);
  return { extraNodes, canvasEdges };
}

function sortNodesTopologically(nodes, providerMap) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const dependents = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const n of nodes) {
    for (const dep of providerMap.get(n.id) || []) {
      if (!byId.has(dep) || dep === n.id) continue;
      dependents.get(dep).add(n.id);
      indeg.set(n.id, (indeg.get(n.id) || 0) + 1);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
  const ordered = [], seen = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const dst of [...(dependents.get(id) || [])].sort()) {
      const nd = (indeg.get(dst) || 1) - 1;
      indeg.set(dst, nd);
      if (nd <= 0 && !seen.has(dst)) { queue.push(dst); queue.sort(); }
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) ordered.push(n.id);
  return ordered;
}

export function discoverHermeticGraph(projectRoot) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors } = loadContracts(projectRoot);
  if (errors.length > 0) return { ok: false, errors, nodes: [] };

  const activeContracts = contracts.filter((c) => !c.retired).map((c) => ({ ...c, sourceKind: 'contract' }));
  const idSet = new Set(activeContracts.map((c) => c.id));
  const { extraNodes, canvasEdges } = loadCanvasExtraNodes(projectRoot, idSet);
  const allNodes = [...activeContracts, ...extraNodes].sort((a, b) => a.id.localeCompare(b.id));

  const stubByNode = new Map();
  const coverageScan = collectCodeFilesForCoverage(projectRoot);
  const allScopedFiles = new Set(coverageScan.codeFiles);
  for (const node of allNodes) {
    const stub = buildNodeInterfaceStub(projectRoot, node);
    stubByNode.set(node.id, stub);
    for (const sf of stub.scopeFiles) allScopedFiles.add(sf);
  }

  const ownersOf = (relFile) => allNodes.filter((n) => fileBelongsToScopes(relFile, n.scope)).map((n) => n.id);
  const declaredDeps = new Map(allNodes.map((n) => [n.id, new Set((n.dependsOn || []).filter((d) => idSet.has(d) && d !== n.id))]));
  for (const ce of canvasEdges) {
    if (idSet.has(ce.from) && idSet.has(ce.to)) declaredDeps.get(ce.to)?.add(ce.from);
  }
  const providerMap = new Map(allNodes.map((n) => [n.id, new Set(declaredDeps.get(n.id) || [])]));
  const consumerMap = new Map(allNodes.map((n) => [n.id, new Set()]));
  for (const [nid, deps] of providerMap.entries()) for (const dep of deps) consumerMap.get(dep)?.add(nid);

  const redImports = [], facadeViolations = [];
  const importRe = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const cf of [...allScopedFiles].sort()) {
    const srcOwners = ownersOf(cf);
    if (srcOwners.length === 0) continue;
    let body = '';
    try { body = readFileSync(join(projectRoot, cf), 'utf8'); } catch (err) { void err; continue; }
    const masked = maskCommentsAndStrings(body, extname(cf).toLowerCase());
    for (const m of body.matchAll(importRe)) {
      if (masked[m.index] === ' ') continue;
      const spec = m[1].split(/[?#]/)[0];
      if (!spec.startsWith('.')) continue;
      const rawTarget = normalize(join(dirname(cf), spec)).replace(/\\/g, '/');
      const hit = [rawTarget, `${rawTarget}.mjs`, `${rawTarget}.js`, `${rawTarget}.ts`, `${rawTarget}.tsx`, `${rawTarget}/index.mjs`, `${rawTarget}/index.js`, `${rawTarget}/index.ts`].find((cand) => allScopedFiles.has(cand));
      if (!hit) continue;
      for (const dstOwner of ownersOf(hit)) {
        for (const srcOwner of srcOwners) {
          if (srcOwner === dstOwner) continue;
          providerMap.get(srcOwner)?.add(dstOwner);
          consumerMap.get(dstOwner)?.add(srcOwner);
          if (!declaredDeps.get(srcOwner)?.has(dstOwner)) redImports.push({ fromNode: srcOwner, fromFile: cf, toNode: dstOwner, toFile: hit });
          const dstStub = stubByNode.get(dstOwner);
          if (dstStub && dstStub.facadeMode === 'barrel' && !dstStub.facadeFiles.includes(hit)) {
            facadeViolations.push({ fromNode: srcOwner, fromFile: cf, toNode: dstOwner, toFile: hit, expectedFacades: dstStub.facadeFiles });
          }
        }
      }
    }
  }

  const topoOrder = sortNodesTopologically(allNodes, providerMap);
  const enrichedNodes = allNodes.map((n) => {
    const stub = stubByNode.get(n.id);
    return {
      id: n.id, title: n.title || n.id, why: n.why || '', sourceKind: n.sourceKind, scope: n.scope || [],
      declaredDependsOn: [...(declaredDeps.get(n.id) || [])].sort(),
      dependsOnIds: [...(providerMap.get(n.id) || [])].sort(),
      dependedByIds: [...(consumerMap.get(n.id) || [])].sort(),
      isFrozenContract: Boolean(n.frozenHash && !n.provisional),
      frozenHash: n.frozenHash || null,
      obligations: Array.isArray(n.obligations) ? n.obligations : [],
      stub
    };
  });
  return { ok: true, errors: [], thresholds, testFiles: coverageScan.testFiles, topoOrder, nodes: enrichedNodes, redImports, facadeViolations };
}

export function writeProjectRouter(projectRoot, opts = {}) {
  const graph = discoverHermeticGraph(projectRoot);
  if (!graph.ok) return { ok: false, errors: graph.errors, nodes: [] };

  const budget = resolveSubagentBudgetProfile(graph.thresholds, opts);
  const statusSnap = computeProjectStatus(projectRoot);
  const statusByContract = new Map((statusSnap.contractSummaries || []).map((c) => [c.id, c]));
  const stubsDir = join(projectRoot, '.donegate', 'stubs');
  mkdirSync(stubsDir, { recursive: true });

  let totalSourceTokens = 0, totalStubTokens = 0;
  for (const n of graph.nodes) {
    totalSourceTokens += n.stub.sourceTokens;
    totalStubTokens += n.stub.stubTokens;
    writeFileSync(join(stubsDir, `${n.id}.stub.d.ts`), n.stub.stubText, 'utf8');
    writeFileSync(join(stubsDir, `${n.id}.stub.json`), JSON.stringify({
      nodeId: n.id, facadeMode: n.stub.facadeMode, facadeFiles: n.stub.facadeFiles, stubHash: n.stub.stubHash,
      effectiveLines: n.stub.effectiveLines, sourceTokens: n.stub.sourceTokens, stubTokens: n.stub.stubTokens, exportedSymbols: n.stub.exportedSymbols
    }, null, 2), 'utf8');
  }

  const utilPct = Math.round(budget.targetUtilization * 100);
  const md = [
    '# DoneGate L0 全局渐进路由表（ROUTER.md）',
    '',
    `> 子代理目标预算：**${budget.contextWindowTokens.toLocaleString()} 窗口 × ${utilPct}% = ${budget.totalSessionBudgetTokens.toLocaleString()} Tokens**（初始胶囊上限 ${budget.capsuleInitialMaxTokens.toLocaleString()}t + 按需局部展开 ${budget.onDemandExpandBudgetTokens.toLocaleString()}t + 多轮推理施工留白 ${budget.multiTurnReserveTokens.toLocaleString()}t）`,
    `> 拓扑施工顺序：\`${graph.topoOrder.join(' → ') || '（空）'}\``,
    '',
    '| 节点 ID | 职责与边界 | 管辖范围 (scope) | 1-Hop 上游 | 1-Hop 下游 | 0-Hop 源码 | 1-Hop 存根 | 状态 | stubHash |',
    '|---|---|---|---|---|---|---|---|---|'
  ];

  for (const id of graph.topoOrder) {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) continue;
    const st = statusByContract.get(id);
    const stateLabel = st ? st.state : (n.isFrozenContract ? '已冻结' : '待冻结');
    const scopeSummary = (n.scope || []).slice(0, 3).map((s) => `\`${s}\``).join(', ') + ((n.scope || []).length > 3 ? ` +${n.scope.length - 3}` : '');
    const up = n.dependsOnIds.length > 0 ? n.dependsOnIds.map((d) => `\`${d}\``).join(', ') : '—';
    const down = n.dependedByIds.length > 0 ? n.dependedByIds.map((d) => `\`${d}\``).join(', ') : '—';
    const titleShort = String(`${n.title}${n.why ? '：' + n.why : ''}`).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 42);
    md.push(`| \`${n.id}\` | ${titleShort} | ${scopeSummary || '—'} | ${up} | ${down} | ${n.stub.sourceTokens}t | ${n.stub.stubTokens}t | ${stateLabel} | \`${n.stub.stubHash.slice(0, 10)}\` |`);
  }

  if (graph.redImports.length > 0 || graph.facadeViolations.length > 0) {
    md.push('', '## 边界告警（门 0 地基巡检）');
    for (const r of graph.redImports.slice(0, 8)) md.push(`- 红线未声明依赖：\`${r.fromNode}\` (${r.fromFile}) → \`${r.toNode}\` (${r.toFile})`);
    for (const v of graph.facadeViolations.slice(0, 8)) md.push(`- 越过门面私引内部实现：\`${v.fromNode}\` (${v.fromFile}) 私引 \`${v.toFile}\`（应经由 \`${v.expectedFacades.join(', ')}\`）`);
  }

  md.push(
    '',
    `## 子代理五段式预算配额（${budget.totalSessionBudgetTokens.toLocaleString()} Tokens 总盘）`,
    `- **L0 全局路由区**：上限 ${budget.routerBudgetTokens.toLocaleString()}t | **0-Hop 本卡源码+单测区**：上限 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t | **1-Hop 邻域契约存根区**：上限 ${budget.oneHopContractBudgetTokens.toLocaleString()}t`,
    `- **按需局部展开池**：预留 ${budget.onDemandExpandBudgetTokens.toLocaleString()}t | **多轮推理与测试迭代留白**：预留 ${budget.multiTurnReserveTokens.toLocaleString()}t | **交回总控结构化回执**：上限 ${budget.receiptBudgetTokens}t`
  );

  const routerTokens = Math.ceil((md.join('\n') + '\n').length / 4);
  const savingsPct = totalSourceTokens > 0 ? Math.max(0, Math.round((1 - routerTokens / totalSourceTokens) * 1000) / 10) : 100;
  md.splice(4, 0, `> 全局源码压缩：全仓源码约 ${totalSourceTokens.toLocaleString()}t → 全仓 L1 存根 ${totalStubTokens.toLocaleString()}t → 本 L0 路由表 ${routerTokens.toLocaleString()}t（首屏节省 ${savingsPct}%）`);
  const markdown = md.join('\n') + '\n';

  const routerDir = join(projectRoot, '.donegate');
  mkdirSync(routerDir, { recursive: true });
  writeFileSync(join(routerDir, 'ROUTER.md'), markdown, 'utf8');
  const routerPayload = {
    schema: 'donegate-router/v1', generatedAt: new Date().toISOString(), budgetProfile: budget,
    topoOrder: graph.topoOrder, totalSourceTokens, totalStubTokens, routerTokens: Math.ceil(markdown.length / 4),
    savingsPct, redImports: graph.redImports, facadeViolations: graph.facadeViolations,
    nodes: graph.nodes.map((n) => ({
      id: n.id, title: n.title, why: n.why, scope: n.scope, dependsOnIds: n.dependsOnIds, dependedByIds: n.dependedByIds,
      facadeMode: n.stub.facadeMode, facadeFiles: n.stub.facadeFiles, effectiveLines: n.stub.effectiveLines,
      sourceTokens: n.stub.sourceTokens, stubTokens: n.stub.stubTokens, stubHash: n.stub.stubHash, stubPath: `.donegate/stubs/${n.id}.stub.d.ts`
    }))
  };
  writeFileSync(join(routerDir, 'router.json'), JSON.stringify(routerPayload, null, 2), 'utf8');
  return { ok: true, markdown, budget, payload: routerPayload, graph };
}
