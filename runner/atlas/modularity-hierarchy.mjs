// 零魔法数字项目看板拓扑生长引擎：基于 Newman-Girvan 模块度增益 (ΔQ > 0) 的非均衡递归业务子图与多对多代码胶囊绑定
import { basename } from 'node:path';

const HUMAN_CAPABILITY_TITLES = {
  'host-dom-root': '工程配置与根级启动入口',
  'host-dom-runner': '命令行总控与统一调度入口',
  'host-dom-core-cmds': '契约生命周期与进度核验',
  'host-dom-core-slice': '改动波及切片与上下文路由',
  'host-dom-core-verdict': '12 令确定性判定与哈希证据链',
  'host-dom-atlas-scanner': '项目全栈测绘与支线冲突感知',
  'host-dom-atlas-shell': '实时工作台服务与过夜挂机面板',
  'host-dom-atlas-canvas': '无限画布、连线与子流交互',
  'host-dom-dsh-deps': '共享依赖池与按需工作流派生',
  'host-dom-dsh-uiboard': 'UI 看板实时预览与点选拾取',
  'host-dom-dsh-host': 'DSH 主从隔离调度与断点沙箱',
  'host-dom-skill-adapters': '22 类开源检查工具转接套件',
  'host-dom-skill-gates': '四维认知复杂度与代码合规门禁',
  'host-dom-skill-kit': '公共底座原语与安装包构建',
  'host-dom-tools': '规格一致性与文档防腐化巡检'
};

const CLUSTER_DOMAIN_LABELS = [
  { test: (ids) => ids.some((id) => id.includes('grill-me') || id.includes('uiboard') || id.includes('slice')), title: '用户意图澄清与需求切片', colorKey: 'blue' },
  { test: (ids) => ids.some((id) => id.includes('atlas-')), title: '可视化看板与画布编排', colorKey: 'teal' },
  { test: (ids) => ids.some((id) => id.includes('dsh-')), title: '主从隔离调度与挂机运行时', colorKey: 'emerald' },
  { test: (ids) => ids.some((id) => id.includes('skill-') || id.includes('verdict') || id.includes('cmds') || id.includes('tools')), title: '确定性门禁与工具体检底座', colorKey: 'amber' }
];

export function createGrillMeCapabilityNode(savedGrill, downstreamIds = []) {
  const base = (savedGrill && typeof savedGrill === 'object') ? savedGrill : {};
  const scopes = Array.isArray(base.scopePaths) && base.scopePaths.length ? base.scopePaths : ['INTENT.md', 'contracts/'];
  const defaultMods = [{ name: '需求追问与验收边界立约 (grill me)', role: '立约', state: 'ok', path: 'INTENT.md' }];
  return {
    ...base,
    id: 'host-dom-grill-me',
    step: '00',
    title: 'grill me · 需求澄清与立约',
    sublinePath: '.donegate/grill-me-inbox.jsonl',
    tip: base.tip || '把模糊想法或 UI 看板拾取记录追问澄清为可验收契约边界（contract.json）',
    scopePaths: scopes,
    contractIds: Array.isArray(base.contractIds) ? base.contractIds : [],
    codeCapsule: { moduleCount: 1, sharedCount: 0, scopePaths: scopes },
    bypassed: false,
    collapsed: false,
    expanded: false,
    color: 'blue',
    colorKey: 'blue',
    x: 56,
    y: 88,
    w: 256,
    h: null,
    nextIds: downstreamIds,
    modules: Array.isArray(base.modules) && base.modules.length ? base.modules : defaultMods
  };
}

function collectNodeNormalizedPaths(nd) {
  const paths = new Set((nd.modules || []).map((m) => m.path).filter(Boolean));
  for (const sp of (nd.scopePaths || [])) {
    const clean = String(sp || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (clean && clean !== './') paths.add(clean);
  }
  return paths;
}

function countSharedModulesMap(unitNodes) {
  const counts = new Map();
  for (const nd of unitNodes) {
    for (const p of collectNodeNormalizedPaths(nd)) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  return counts;
}

function toLeafBusinessNode(nd, sharedMap) {
  const mods = Array.isArray(nd.modules) ? nd.modules : [];
  const scopes = Array.isArray(nd.scopePaths) ? nd.scopePaths : [];
  const sharedModCount = mods.filter((m) => (sharedMap.get(m.path) || 0) > 1).length;
  const scopeShared = scopes.filter((sp) => (sharedMap.get(String(sp || '').replace(/^\.\//, '')) || 0) > 1).length;
  const friendly = HUMAN_CAPABILITY_TITLES[nd.id] || nd.title || basename(nd.sublinePath || nd.id);
  return {
    ...nd,
    nextIds: [...(nd.nextIds || [])],
    title: friendly,
    isBusinessLeaf: true,
    expanded: false,
    codeCapsule: {
      moduleCount: mods.length,
      sharedCount: Math.max(sharedModCount, scopeShared),
      scopePaths: scopes
    }
  };
}

export function enrichLeafBusinessCapabilityNodes(codeUnitNodes, savedState = {}) {
  const sharedMap = countSharedModulesMap(codeUnitNodes);
  const leaves = codeUnitNodes.map((nd) => toLeafBusinessNode(nd, sharedMap));
  if (!savedState?.grillMeNode) return leaves;
  const firstTarget = leaves[0] ? [leaves[0].id] : [];
  return [createGrillMeCapabilityNode(savedState.grillMeNode, firstTarget), ...leaves];
}

function computeSemanticAffinity(na, nb) {
  const pa = String(na.sublinePath || '').replace(/^\.\//, '').split('/').filter(Boolean);
  const pb = String(nb.sublinePath || '').replace(/^\.\//, '').split('/').filter(Boolean);
  let w = 0;
  if (pa.length >= 2 && pb.length >= 2 && pa[0] === pb[0] && pa[1] === pb[1]) w += 3.2;
  else if (pa.length >= 1 && pb.length >= 1 && pa[0] === pb[0]) w += 1.8;
  const ca = new Set(na.contractIds || []);
  if ((nb.contractIds || []).some((c) => ca.has(c))) w += 2.0;
  return w;
}

function addDirectedEdgesToCoupling(nodes, idxById, symW, dirAdj) {
  for (let i = 0; i < nodes.length; i++) {
    for (const tid of (nodes[i].nextIds || [])) {
      const j = idxById.get(tid);
      if (j === undefined || i === j) continue;
      dirAdj[i].add(j);
      symW[i][j] += 2.0;
      symW[j][i] += 2.0;
    }
  }
}

function addSemanticEdgesToCoupling(nodes, symW) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sem = computeSemanticAffinity(nodes[i], nodes[j]);
      if (sem <= 0) continue;
      symW[i][j] += sem;
      symW[j][i] += sem;
    }
  }
}

function buildCouplingMatrix(nodes) {
  const n = nodes.length;
  const idxById = new Map(nodes.map((nd, i) => [nd.id, i]));
  const symW = Array.from({ length: n }, () => new Array(n).fill(0));
  const dirAdj = Array.from({ length: n }, () => new Set());
  addDirectedEdgesToCoupling(nodes, idxById, symW, dirAdj);
  addSemanticEdgesToCoupling(nodes, symW);
  return { symW, dirAdj };
}

function buildCondensedGroupAdjacency(groups, dirAdj) {
  const gCount = groups.length;
  const groupOf = new Map();
  groups.forEach((members, gi) => members.forEach((u) => groupOf.set(u, gi)));
  const gAdj = Array.from({ length: gCount }, () => new Set());
  groups.forEach((members, gi) => {
    for (const u of members) {
      for (const v of dirAdj[u]) {
        const gj = groupOf.get(v);
        if (gj !== undefined && gj !== gi) gAdj[gi].add(gj);
      }
    }
  });
  return gAdj;
}

function dfsFindCycle(u, gAdj, visitState) {
  visitState[u] = 1;
  for (const v of gAdj[u]) {
    if (visitState[v] === 1) return true;
    if (visitState[v] === 0 && dfsFindCycle(v, gAdj, visitState)) return true;
  }
  visitState[u] = 2;
  return false;
}

function hasCondensedDagCycle(groups, dirAdj) {
  const gAdj = buildCondensedGroupAdjacency(groups, dirAdj);
  const visitState = new Array(groups.length).fill(0);
  for (let i = 0; i < groups.length; i++) {
    if (visitState[i] === 0 && dfsFindCycle(i, gAdj, visitState)) return true;
  }
  return false;
}

function computeModularityDelta(membersA, membersB, symW, deg, twoM) {
  let eAB = 0;
  for (const u of membersA) {
    for (const v of membersB) eAB += symW[u][v];
  }
  if (eAB <= 0) return -1;
  const kA = membersA.reduce((s, u) => s + deg[u], 0);
  const kB = membersB.reduce((s, u) => s + deg[u], 0);
  return (2 * eAB) / twoM - (2 * kA * kB) / (twoM * twoM);
}

function evaluateCandidateMerge(groups, a, b, ctx, bestGain) {
  if (groups[a].some((u) => ctx.pinnedIdxSet.has(u)) || groups[b].some((u) => ctx.pinnedIdxSet.has(u))) return -1;
  const maxGroupSize = Math.ceil(ctx.n * 0.62);
  if (groups[a].length + groups[b].length > maxGroupSize) return -1;
  const gain = computeModularityDelta(groups[a], groups[b], ctx.symW, ctx.deg, ctx.twoM);
  if (gain <= bestGain) return -1;
  const nextGroups = groups.filter((_, idx) => idx !== a && idx !== b);
  nextGroups.push([...groups[a], ...groups[b]]);
  return hasCondensedDagCycle(nextGroups, ctx.dirAdj) ? -1 : gain;
}

function findBestModularityMerge(groups, ctx) {
  let bestGain = 0.015;
  let bestPair = null;
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const gain = evaluateCandidateMerge(groups, a, b, ctx, bestGain);
      if (gain > bestGain) {
        bestGain = gain;
        bestPair = [a, b];
      }
    }
  }
  return bestPair;
}

function partitionByModularityGain(nodes, pinnedLeafIds = new Set()) {
  const n = nodes.length;
  if (n <= 3) return nodes.map((_, i) => [i]);
  const { symW, dirAdj } = buildCouplingMatrix(nodes);
  const deg = symW.map((row) => row.reduce((a, b) => a + b, 0));
  const twoM = deg.reduce((a, b) => a + b, 0);
  // 纯稀疏线性短链（无内聚团块）直接保持平铺，绝不硬套空盒
  if (twoM <= 0 || twoM / Math.max(1, n) <= 2.75) return nodes.map((_, i) => [i]);

  const pinnedIdxSet = new Set();
  nodes.forEach((nd, i) => { if (pinnedLeafIds.has(nd.id)) pinnedIdxSet.add(i); });
  const ctx = { n, symW, dirAdj, deg, twoM, pinnedIdxSet };
  let groups = nodes.map((_, i) => [i]);
  while (groups.length > 2) {
    const bestPair = findBestModularityMerge(groups, ctx);
    if (!bestPair) break;
    const [a, b] = bestPair;
    const merged = [...groups[a], ...groups[b]];
    groups = groups.filter((_, idx) => idx !== a && idx !== b);
    groups.push(merged);
  }
  return groups;
}

function toScopeSlug(rawStr) {
  return String(rawStr || '').replace(/^\.?\//, '').replace(/\/+$/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24);
}

function resolveStableSubgraphId(scopePaths, allIds, depth, seqIdx, savedKeys) {
  const candidateSlugs = [
    ...[...(scopePaths || [])].filter((s) => s && s !== './').sort().map(toScopeSlug),
    ...[...allIds].sort().map(toScopeSlug)
  ].filter(Boolean);
  for (const slug of candidateSlugs) {
    const candidateId = `sg-mod-d${depth}-${slug}`;
    if (savedKeys.has(candidateId)) return candidateId;
  }
  const primary = candidateSlugs[0] || `g${seqIdx}`;
  return `sg-mod-d${depth}-${primary}`;
}

function deriveSubgraphMeta(memberNodes, scopePaths, depth, seqIdx, savedKeys) {
  const allIds = memberNodes.flatMap((n) => (n.isSubgraph && n.subgraph ? n.subgraph.nodes.map((c) => c.id) : [n.id]));
  const hit = CLUSTER_DOMAIN_LABELS.find((d) => d.test(allIds));
  const leadTitle = String(memberNodes[0]?.title || '业务环节').replace(/\s*[·(（].*$/, '');
  const title = (depth === 0 && hit) ? hit.title : `${leadTitle}等业务流 (${memberNodes.length} 步)`;
  const colorKey = hit ? hit.colorKey : (memberNodes[0]?.colorKey || 'teal');
  const id = resolveStableSubgraphId(scopePaths, allIds, depth, seqIdx, savedKeys);
  return {
    id,
    title,
    colorKey,
    tip: `按模块度内聚度自动收拢的业务子流（内含：${memberNodes.map((n) => n.title).join('、')}）· 可点「⊞ 原地展开」在当前画布直接查看，或点「进入子流」全屏聚焦`
  };
}

function relaxDagDepthOnce(nodes, byId, depthMap) {
  for (const u of nodes) {
    const du = depthMap.get(u.id) || 0;
    for (const vid of (u.nextIds || [])) {
      if (!byId.has(vid)) continue;
      if ((depthMap.get(vid) || 0) < du + 1) depthMap.set(vid, du + 1);
    }
  }
}

function computeLongestDagDepths(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthMap = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    relaxDagDepthOnce(nodes, byId, depthMap);
  }
  return depthMap;
}

function applySavedNodeLayout(nd, saved, idx, col, row) {
  const hasSavedColor = Boolean(saved.color && saved.color !== 'none');
  return {
    ...nd,
    step: nd.id === 'host-dom-grill-me' ? '00' : String(idx + 1).padStart(2, '0'),
    x: typeof saved.x === 'number' ? saved.x : 56 + col * 316,
    y: typeof saved.y === 'number' ? saved.y : 76 + row * 226,
    w: typeof saved.w === 'number' ? saved.w : (nd.w || 256),
    h: typeof saved.h === 'number' ? saved.h : (nd.h ?? null),
    color: hasSavedColor ? saved.color : (nd.color || 'none'),
    colorKey: hasSavedColor ? saved.color : nd.colorKey,
    bypassed: saved.bypassed !== undefined ? Boolean(saved.bypassed) : Boolean(nd.bypassed),
    collapsed: saved.collapsed !== undefined ? Boolean(saved.collapsed) : Boolean(nd.collapsed),
    expanded: saved.expanded !== undefined ? Boolean(saved.expanded) : Boolean(nd.expanded)
  };
}

function layoutDagLayerNodes(nodes, savedState = {}) {
  const depthMap = computeLongestDagDepths(nodes);
  const colRows = new Map();
  const layouts = savedState?.hostNodeLayouts || {};
  const ordered = [...nodes].sort((a, b) => (depthMap.get(a.id) || 0) - (depthMap.get(b.id) || 0));
  return ordered.map((nd, idx) => {
    const col = depthMap.get(nd.id) || 0;
    const row = colRows.get(col) || 0;
    colRows.set(col, row + 1);
    return applySavedNodeLayout(nd, layouts[nd.id] || {}, idx, col, row);
  });
}

function buildMultiMemberGroupRecord(rawMembers, depth, gIdx, savedKeys) {
  const memberIdSet = new Set(rawMembers.map((m) => m.id));
  const scopedMembers = rawMembers.map((m) => ({
    ...m,
    nextIds: (m.nextIds || []).filter((tid) => memberIdSet.has(tid))
  }));
  const innerHierarchy = scopedMembers.length >= 4
    ? buildHierarchyRecursive(scopedMembers, depth + 1, {})
    : layoutDagLayerNodes(scopedMembers, {});
  const scopePaths = [...new Set(rawMembers.flatMap((m) => m.scopePaths || []))];
  const meta = deriveSubgraphMeta(innerHierarchy, scopePaths, depth, gIdx, savedKeys);
  const contractIds = [...new Set(rawMembers.flatMap((m) => m.contractIds || []))];
  const sharedSum = rawMembers.reduce((s, m) => s + (m.codeCapsule?.sharedCount || 0), 0);
  const modSum = rawMembers.reduce((s, m) => s + (m.codeCapsule?.moduleCount || (m.modules || []).length), 0);
  return {
    single: false,
    rawIds: memberIdSet,
    rawMembers,
    node: {
      id: meta.id,
      step: '子流',
      title: meta.title,
      tip: meta.tip,
      isSubgraph: true,
      colorKey: meta.colorKey,
      scopePaths,
      contractIds,
      primaryContractId: contractIds[0] || null,
      codeCapsule: { moduleCount: modSum, sharedCount: sharedSum, scopePaths },
      subgraph: { nodes: innerHierarchy, groups: [], _entryMap: [], _exitMap: [] },
      bypassed: false,
      collapsed: false,
      expanded: false,
      x: 56,
      y: 76,
      w: 268,
      h: null,
      nextIds: [],
      modules: []
    }
  };
}

function connectCrossGroupPair(srcRawId, dstRawId, srcRec, dstRec) {
  const srcTopId = srcRec.node.id;
  const dstTopId = dstRec.node.id;
  if (!srcRec.node.nextIds.includes(dstTopId)) srcRec.node.nextIds.push(dstTopId);
  if (!srcRec.single && srcRec.node.subgraph) {
    srcRec.node.subgraph._exitMap.push({ fromInner: srcRawId, toExternal: dstTopId });
  }
  if (!dstRec.single && dstRec.node.subgraph) {
    dstRec.node.subgraph._entryMap.push({ fromExternal: srcTopId, toInner: dstRawId });
  }
}

function rewireCrossGroupEdges(nodes, groupRecords) {
  const ownerByRawId = new Map();
  for (const rec of groupRecords) {
    for (const rid of rec.rawIds) ownerByRawId.set(rid, rec);
  }
  for (const srcRaw of nodes) {
    const srcRec = ownerByRawId.get(srcRaw.id);
    if (!srcRec) continue;
    for (const tid of (srcRaw.nextIds || [])) {
      const dstRec = ownerByRawId.get(tid);
      if (dstRec && dstRec !== srcRec) connectCrossGroupPair(srcRaw.id, tid, srcRec, dstRec);
    }
  }
}

function buildHierarchyRecursive(nodes, depth, savedState) {
  const rootSaved = depth === 0 ? savedState : {};
  if (nodes.length <= 3 || depth >= 3) return layoutDagLayerNodes(nodes, rootSaved);
  const savedKeys = depth === 0 ? new Set(Object.keys(savedState?.hostNodeLayouts || {})) : new Set();
  const groups = partitionByModularityGain(nodes, savedKeys);
  // 若没有任何 ΔQ > 0 的多节点合并，直接停止递归，原样平铺！
  if (groups.every((g) => g.length === 1)) return layoutDagLayerNodes(nodes, rootSaved);

  const usedSavedIds = new Set();
  const groupRecords = groups.map((memberIdxs, gIdx) => {
    const rawMembers = memberIdxs.map((i) => nodes[i]);
    if (rawMembers.length === 1) {
      return { single: true, rawIds: new Set([rawMembers[0].id]), node: { ...rawMembers[0], nextIds: [] } };
    }
    const availSaved = new Set([...savedKeys].filter((k) => !usedSavedIds.has(k)));
    const rec = buildMultiMemberGroupRecord(rawMembers, depth, gIdx, availSaved);
    usedSavedIds.add(rec.node.id);
    return rec;
  });

  rewireCrossGroupEdges(nodes, groupRecords);
  return layoutDagLayerNodes(groupRecords.map((r) => r.node), rootSaved);
}

export function buildAdaptiveBusinessHierarchy(codeUnitNodes, savedState = {}, hasInitializedIntent = false) {
  if (codeUnitNodes.length === 0) {
    if (!hasInitializedIntent && !savedState?.grillMeNode) return [];
    return [createGrillMeCapabilityNode(savedState?.grillMeNode, [])];
  }
  const leaves = enrichLeafBusinessCapabilityNodes(codeUnitNodes, savedState);
  return buildHierarchyRecursive(leaves, 0, savedState);
}
