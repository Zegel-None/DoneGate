// 零魔法数字项目看板拓扑生长引擎：
// 1. Blondel et al. (2008) 多尺度 Louvain 社团发现 (ΔQ > 0) 识别非均衡递归业务子图（纯线性稀疏小项目保持 100% 平铺）；
// 2. Serrano et al. (PNAS 2009) 主干流提取 + Eades-Lin-Smyth 净流向无环排序 + Aho-Garey-Ullman (1972) 精确传递约简，保留并行分流、消除跨层蜘蛛网连线。
import { basename } from 'node:path';

const HUMAN_CAPABILITY_TITLES = {
  'host-dom-root': '项目基础设置与测试开关',
  'host-dom-runner': '接收指令并启动各项检查',
  'host-dom-core-cmds': '记录每项功能的完成进度',
  'host-dom-core-slice': '只挑相关文件发给 AI',
  'host-dom-core-verdict': '真跑测试打分并留存记录',
  'host-dom-atlas-scanner': '自动盘点项目功能与改乱风险',
  'host-dom-atlas-shell': '实时状态同步与过夜挂机',
  'host-dom-atlas-canvas': '流程图拖拽、连线与展开收起',
  'host-dom-dsh-deps': '自动安装检查工具（免配环境）',
  'host-dom-dsh-uiboard': '边看网页效果、边点选修改处',
  'host-dom-dsh-host': '安排后台小助手分头改代码',
  'host-dom-skill-adapters': '调用开源工具查漏洞与坏味道',
  'host-dom-skill-gates': '拦截 AI 偷懒删功能与绕脑代码',
  'host-dom-skill-kit': '基础文件读写与公开发布打包',
  'host-dom-tools': '核对说明文档与实际功能一致'
};

const DOMAIN_ARCHETYPES = [
  {
    key: 'intent',
    match: (id) => id === 'host-dom-grill-me' || id === 'host-dom-root' || id.includes('openspec'),
    title: '沟通需求与定好验收标准',
    colorKey: 'blue',
    baseTier: 0
  },
  {
    key: 'atlas',
    match: (id) => id.includes('atlas-'),
    title: '可视化项目看板与过夜挂机',
    colorKey: 'teal',
    baseTier: 2
  },
  {
    key: 'dsh',
    match: (id) => id.includes('dsh-'),
    title: '界面实时预览与分派助手',
    colorKey: 'emerald',
    baseTier: 2
  },
  {
    key: 'core',
    match: (id) => id === 'host-dom-runner' || id.includes('core-'),
    title: '精准挑文件与真跑验收',
    colorKey: 'indigo',
    baseTier: 3
  },
  {
    key: 'gates',
    match: (id) => id.includes('skill-') || id.includes('tools'),
    title: '防 AI 偷懒与代码质量体检',
    colorKey: 'amber',
    baseTier: 5
  }
];

const GENERIC_SUBGRAPH_PALETTE = ['blue', 'teal', 'emerald', 'indigo', 'amber'];

export function createGrillMeCapabilityNode(savedGrill, downstreamIds = []) {
  const base = (savedGrill && typeof savedGrill === 'object') ? savedGrill : {};
  const scopes = Array.isArray(base.scopePaths) && base.scopePaths.length ? base.scopePaths : ['INTENT.md', 'contracts/'];
  const defaultMods = [{ name: '先把模糊想法问清楚并写成可自动检查的清单', role: '定标准', state: 'ok', path: 'INTENT.md' }];
  return {
    ...base,
    id: 'host-dom-grill-me',
    step: '00',
    archTier: 0,
    title: '先把想法聊透、列好验收清单',
    sublinePath: 'INTENT.md',
    tip: base.tip || '先把模糊想法或界面点选记录聊清楚，变成一条条可自动验收的清单',
    scopePaths: scopes,
    contractIds: Array.isArray(base.contractIds) ? base.contractIds : [],
    codeCapsule: { moduleCount: 1, sharedCount: 0, scopePaths: scopes },
    bypassed: false,
    collapsed: false,
    expanded: false,
    color: 'blue',
    colorKey: 'blue',
    x: 64,
    y: 120,
    w: 268,
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
    for (const p of collectNodeNormalizedPaths(nd)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  return counts;
}

function inferNodeArchTier(nd) {
  if (typeof nd.archTier === 'number') return nd.archTier;
  if (nd.id === 'host-dom-grill-me' || nd.id === 'host-dom-root') return 0;
  if (nd.id === 'host-dom-runner') return 1;
  const hit = DOMAIN_ARCHETYPES.find((d) => d.match(nd.id));
  return hit ? hit.baseTier : 2;
}

function toLeafBusinessNode(nd, sharedMap) {
  const mods = Array.isArray(nd.modules) ? nd.modules : [];
  const scopes = Array.isArray(nd.scopePaths) ? nd.scopePaths : [];
  const sharedModCount = mods.filter((m) => (sharedMap.get(m.path) || 0) > 1).length;
  const scopeShared = scopes.filter((sp) => (sharedMap.get(String(sp || '').replace(/^\.\//, '')) || 0) > 1).length;
  const friendly = HUMAN_CAPABILITY_TITLES[nd.id] || nd.title || basename(nd.sublinePath || nd.id);
  return {
    ...nd,
    archTier: inferNodeArchTier(nd),
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

export function enrichLeafBusinessCapabilityNodes(codeUnitNodes, savedState = {}, includeGrillMe = false) {
  const sharedMap = countSharedModulesMap(codeUnitNodes);
  const leaves = codeUnitNodes.map((nd) => toLeafBusinessNode(nd, sharedMap));
  if (!includeGrillMe && !savedState?.grillMeNode) return leaves;
  const entryTargets = leaves
    .filter((n) => n.archTier <= 2 || n.id.includes('slice') || n.id.includes('root'))
    .map((n) => n.id);
  const fallbackTargets = entryTargets.length > 0 ? entryTargets : (leaves[0] ? [leaves[0].id] : []);
  return [createGrillMeCapabilityNode(savedState?.grillMeNode, fallbackTargets), ...leaves];
}

function computeSemanticAffinity(na, nb) {
  if ((na.id === 'host-dom-grill-me' && nb.id === 'host-dom-root') || (nb.id === 'host-dom-grill-me' && na.id === 'host-dom-root')) {
    return 8.0;
  }
  const pa = String(na.sublinePath || '').replace(/^\.\//, '').split('/').filter(Boolean);
  const pb = String(nb.sublinePath || '').replace(/^\.\//, '').split('/').filter(Boolean);
  let w = 0;
  if (pa.length >= 2 && pb.length >= 2 && pa[0] === pb[0] && pa[1] === pb[1]) w += 5.4;
  else if (pa.length >= 1 && pb.length >= 1 && pa[0] === pb[0]) w += 2.6;
  const ca = new Set(na.contractIds || []);
  if (ca.size > 0 && (nb.contractIds || []).some((c) => ca.has(c))) w += 3.0;
  return w;
}

function buildCouplingMatrices(nodes) {
  const n = nodes.length;
  const idxById = new Map(nodes.map((nd, i) => [nd.id, i]));
  const symW = Array.from({ length: n }, () => new Array(n).fill(0));
  const dirW = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (const tid of (nodes[i].nextIds || [])) {
      const j = idxById.get(tid);
      if (j === undefined || i === j) continue;
      dirW[i][j] += 1;
      if (nodes[i].id !== 'host-dom-grill-me') {
        symW[i][j] += 1.4;
        symW[j][i] += 1.4;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sem = computeSemanticAffinity(nodes[i], nodes[j]);
      if (sem <= 0) continue;
      symW[i][j] += sem;
      symW[j][i] += sem;
    }
  }
  return { symW, dirW };
}

function computeCommEdgeSum(nodeIdx, targetComm, commOf, symW) {
  let sum = 0;
  for (let j = 0; j < commOf.length; j++) {
    if (j !== nodeIdx && commOf[j] === targetComm) sum += symW[nodeIdx][j];
  }
  return sum;
}

function findBestCommunityMove(i, commOf, commSize, sigmaTot, deg, symW, twoM, gamma) {
  const n = commOf.length;
  const curC = commOf[i];
  const ki = deg[i];
  const kiOut = computeCommEdgeSum(i, curC, commOf, symW);
  const sigmaOldWithout = sigmaTot[curC] - ki;
  const tested = new Set([curC]);
  let bestC = curC;
  let bestDeltaQ = 1e-6;

  for (let j = 0; j < n; j++) {
    if (symW[i][j] <= 0) continue;
    const candC = commOf[j];
    if (tested.has(candC)) continue;
    tested.add(candC);
    if (commSize[candC] + 1 >= n) continue;
    const kiIn = computeCommEdgeSum(i, candC, commOf, symW);
    const deltaEdge = (2 * (kiIn - kiOut)) / twoM;
    const deltaNull = gamma * ((2 * ki * (sigmaTot[candC] - sigmaOldWithout)) / (twoM * twoM));
    const deltaQ = deltaEdge - deltaNull;
    if (deltaQ > bestDeltaQ) {
      bestDeltaQ = deltaQ;
      bestC = candC;
    }
  }
  return bestC;
}

function partitionByLouvainModularity(nodes, depth = 0) {
  const n = nodes.length;
  if (n <= 3) return nodes.map((_, i) => [i]);
  const { symW, dirW } = buildCouplingMatrices(nodes);
  const deg = symW.map((row) => row.reduce((a, b) => a + b, 0));
  const twoM = deg.reduce((a, b) => a + b, 0);
  if (twoM <= 0 || twoM / Math.max(1, n) <= 2.9) {
    return { groups: nodes.map((_, i) => [i]), dirW };
  }

  const gamma = 1 + depth * 0.42;
  const commOf = nodes.map((_, i) => i);
  const commSize = new Array(n).fill(1);
  const sigmaTot = [...deg];

  for (let pass = 0; pass < 16; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const prevC = commOf[i];
      const nextC = findBestCommunityMove(i, commOf, commSize, sigmaTot, deg, symW, twoM, gamma);
      if (nextC !== prevC) {
        commOf[i] = nextC;
        commSize[prevC] -= 1;
        commSize[nextC] += 1;
        sigmaTot[prevC] -= deg[i];
        sigmaTot[nextC] += deg[i];
        moved = true;
      }
    }
    if (!moved) break;
  }

  const bucketMap = new Map();
  commOf.forEach((c, idx) => {
    if (!bucketMap.has(c)) bucketMap.set(c, []);
    bucketMap.get(c).push(idx);
  });
  return { groups: [...bucketMap.values()], dirW };
}

function collectLeafIds(memberNodes) {
  return memberNodes.flatMap((n) => (n.isSubgraph && n.subgraph ? collectLeafIds(n.subgraph.nodes) : [n.id]));
}

function toScopeSlug(rawStr) {
  return String(rawStr || '').replace(/^\.?\//, '').replace(/\/+$/, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24);
}

function resolveStableSubgraphId(scopePaths, allIds, depth, seqIdx, usedIds) {
  const slugs = [
    ...[...(scopePaths || [])].filter((s) => s && s !== './').sort().map(toScopeSlug),
    ...[...allIds].sort().map(toScopeSlug)
  ].filter(Boolean);
  for (const s of slugs) {
    const cand = `sg-mod-d${depth}-${s}`;
    if (!usedIds.has(cand)) {
      usedIds.add(cand);
      return cand;
    }
  }
  let suffix = seqIdx + 1;
  let fallback = `sg-mod-d${depth}-${slugs[0] || 'g'}-${suffix}`;
  while (usedIds.has(fallback)) {
    suffix += 1;
    fallback = `sg-mod-d${depth}-${slugs[0] || 'g'}-${suffix}`;
  }
  usedIds.add(fallback);
  return fallback;
}

function pickUniqueArchetype(allIds, usedTitles) {
  let best = null;
  let bestHits = 0;
  for (const arch of DOMAIN_ARCHETYPES) {
    if (usedTitles.has(arch.title)) continue;
    const hits = allIds.filter((id) => arch.match(id)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = arch;
    }
  }
  return best;
}

const SUBFLOW_PLAIN_TITLES = [
  { match: (ids) => ids.some((x) => x.includes('core-verdict') || x.includes('core-slice')), title: '挑准文件与真跑打分' },
  { match: (ids) => ids.some((x) => x.includes('skill-gates') || x.includes('skill-adapters')), title: '拦截偷懒与开源扫描' },
  { match: (ids) => ids.some((x) => x.includes('skill-kit') || x.includes('tools')), title: '基础读写与文档对账' }
];

function buildGenericSubgraphTitle(memberNodes, scopePaths, usedTitles, allIds = []) {
  const hit = SUBFLOW_PLAIN_TITLES.find((r) => !usedTitles.has(r.title) && r.match(allIds));
  if (hit) return hit.title;
  const cleanFirst = String(memberNodes[0]?.title || '核心步骤').replace(/\s*[·(（].*$/, '').trim();
  const cleanSecond = String(memberNodes[1]?.title || '').replace(/\s*[·(（].*$/, '').trim();
  const scopeHint = (scopePaths || []).map((s) => s.replace(/^\.?\//, '').replace(/\/+$/, '')).find(Boolean) || '';
  let cand = cleanSecond && cleanFirst.length + cleanSecond.length <= 16
    ? `${cleanFirst}与${cleanSecond}`
    : `${cleanFirst}等环节`;
  if (usedTitles.has(cand) && scopeHint) cand = `${cleanFirst} (${scopeHint})`;
  return cand;
}

function deriveSubgraphMeta(memberNodes, scopePaths, depth, seqIdx, usedTitles, usedIds) {
  const allIds = collectLeafIds(memberNodes);
  const arch = depth === 0 ? pickUniqueArchetype(allIds, usedTitles) : null;
  const title = arch ? arch.title : buildGenericSubgraphTitle(memberNodes, scopePaths, usedTitles, allIds);
  usedTitles.add(title);
  const fallbackColor = GENERIC_SUBGRAPH_PALETTE[seqIdx % GENERIC_SUBGRAPH_PALETTE.length];
  const colorKey = arch ? arch.colorKey : (memberNodes[0]?.colorKey || fallbackColor);
  const id = resolveStableSubgraphId(scopePaths, allIds, depth, seqIdx, usedIds);
  return {
    id,
    title,
    colorKey,
    tip: `按模块度内聚自动收拢的业务子流（内含 ${memberNodes.length} 步：${memberNodes.map((n) => n.title).join('、')}）· 可点「⊞ 原地展开」在当前画布直接查看，或点「进入子流」下钻`
  };
}

function canReachInGeneralPath(start, target, adj) {
  const visited = new Set([start]);
  const stack = [...(adj.get(start) || [])].filter((w) => w !== target);
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const nxt of (adj.get(cur) || [])) {
      if (!visited.has(nxt)) stack.push(nxt);
    }
  }
  return false;
}

export function transitivelyReduceDag(nodes) {
  const idSet = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, (n.nextIds || []).filter((t) => idSet.has(t) && t !== n.id)]));
  for (const n of nodes) {
    const direct = adj.get(n.id) || [];
    if (direct.length <= 1) {
      n.nextIds = direct;
      continue;
    }
    n.nextIds = direct.filter((target) => {
      const reducedAdj = new Map(adj);
      reducedAdj.set(n.id, direct.filter((w) => w !== target));
      return !canReachInGeneralPath(n.id, target, reducedAdj);
    });
    adj.set(n.id, n.nextIds);
  }
  return nodes;
}

function collectDagSourcesAndSinks(innerNodes) {
  const idSet = new Set(innerNodes.map((n) => n.id));
  const indeg = new Map(innerNodes.map((n) => [n.id, 0]));
  const outdeg = new Map(innerNodes.map((n) => [n.id, 0]));
  for (const u of innerNodes) {
    for (const v of (u.nextIds || [])) {
      if (!idSet.has(v) || v === u.id) continue;
      outdeg.set(u.id, (outdeg.get(u.id) || 0) + 1);
      indeg.set(v, (indeg.get(v) || 0) + 1);
    }
  }
  const sources = innerNodes.filter((n) => (indeg.get(n.id) || 0) === 0);
  const sinks = innerNodes.filter((n) => (outdeg.get(n.id) || 0) === 0);
  return {
    sources: sources.length ? sources : innerNodes.slice(0, 1),
    sinks: sinks.length ? sinks : innerNodes.slice(-1)
  };
}

function wireBoundaryPortMaps(srcRec, dstRec) {
  const srcTopId = srcRec.node.id;
  const dstTopId = dstRec.node.id;
  if (!srcRec.single && srcRec.node.subgraph) {
    const { sinks } = collectDagSourcesAndSinks(srcRec.node.subgraph.nodes);
    for (const tail of sinks) {
      srcRec.node.subgraph._exitMap.push({ fromInner: tail.id, toExternal: dstTopId });
    }
  }
  if (!dstRec.single && dstRec.node.subgraph) {
    const { sources } = collectDagSourcesAndSinks(dstRec.node.subgraph.nodes);
    for (const head of sources) {
      dstRec.node.subgraph._entryMap.push({ fromExternal: srcTopId, toInner: head.id });
    }
  }
}

function computeQuotientWeights(groupRecords, dirW) {
  const k = groupRecords.length;
  const qDir = Array.from({ length: k }, () => new Array(k).fill(0));
  const strength = new Array(k).fill(0);
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      let fab = 0;
      let fba = 0;
      for (const u of groupRecords[a].memberIdxs) {
        for (const v of groupRecords[b].memberIdxs) {
          fab += dirW[u][v];
          fba += dirW[v][u];
        }
      }
      qDir[a][b] = fab;
      qDir[b][a] = fba;
      strength[a] += fab + fba;
      strength[b] += fab + fba;
    }
  }
  return { qDir, strength };
}

function shouldKeepBackbonePair(a, b, qDir, strength, k, recA, recB) {
  const wab = qDir[a][b] + qDir[b][a];
  if (wab <= 0) return false;
  // 同层并列平级业务子系统（如两个并行中台/界面子系统）若仅存在偶发单边辅助引用，按 Serrano 主干准则不强串成先后链
  const sameStage = !recA.hasGrill && !recB.hasGrill && Math.abs(recA.meanTier - recB.meanTier) < 0.45;
  const uniformShare = 1 / Math.max(2, k - 1);
  const shareA = wab / Math.max(1, strength[a]);
  const shareB = wab / Math.max(1, strength[b]);
  if (sameStage && Math.max(shareA, shareB) < uniformShare) return false;
  return true;
}

function compareGroupOrderItems(a, b) {
  if (a.hasGrill !== b.hasGrill) return a.hasGrill ? -1 : 1;
  if (Math.abs(a.tier - b.tier) >= 0.45) return a.tier - b.tier;
  return b.netFlow - a.netFlow;
}

function computeGroupRankMap(groupRecords, qDir) {
  const orderedIdx = groupRecords
    .map((rec, idx) => {
      const outSum = qDir[idx].reduce((s, v) => s + v, 0);
      const inSum = qDir.reduce((s, row) => s + row[idx], 0);
      return { idx, tier: rec.meanTier, hasGrill: rec.hasGrill, netFlow: outSum - inSum };
    })
    .sort(compareGroupOrderItems)
    .map((x) => x.idx);
  return new Map(orderedIdx.map((origIdx, r) => [origIdx, r]));
}

function wireAllReducedGroupPorts(groupRecords) {
  const recById = new Map(groupRecords.map((r) => [r.node.id, r]));
  for (const srcRec of groupRecords) {
    for (const tid of (srcRec.node.nextIds || [])) {
      const dstRec = recById.get(tid);
      if (dstRec) wireBoundaryPortMaps(srcRec, dstRec);
    }
  }
}

function orientAndReduceGroupRecords(groupRecords, dirW) {
  const k = groupRecords.length;
  const { qDir, strength } = computeQuotientWeights(groupRecords, dirW);
  const rankOf = computeGroupRankMap(groupRecords, qDir);
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      if (!shouldKeepBackbonePair(a, b, qDir, strength, k, groupRecords[a], groupRecords[b])) continue;
      const aFirst = (rankOf.get(a) || 0) < (rankOf.get(b) || 0);
      const srcNode = groupRecords[aFirst ? a : b].node;
      const dstNode = groupRecords[aFirst ? b : a].node;
      if (!srcNode.nextIds.includes(dstNode.id)) srcNode.nextIds.push(dstNode.id);
    }
  }
  transitivelyReduceDag(groupRecords.map((r) => r.node));
  wireAllReducedGroupPorts(groupRecords);
}

function relaxDagDepthOnce(nodes, byId, depthMap) {
  for (const u of nodes) {
    const du = depthMap.get(u.id) || 0;
    for (const vid of (u.nextIds || [])) {
      if (byId.has(vid) && (depthMap.get(vid) || 0) < du + 1) depthMap.set(vid, du + 1);
    }
  }
}

function computeLongestDagDepths(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthMap = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) relaxDagDepthOnce(nodes, byId, depthMap);
  return depthMap;
}

function applySavedNodeLayout(nd, saved, idx, col, row, colCount, maxColCount) {
  const hasSavedColor = Boolean(saved.color && saved.color !== 'none');
  const rowPitch = 198;
  const yCenterOffset = Math.round(((maxColCount - colCount) * rowPitch) / 2);
  return {
    ...nd,
    step: nd.id === 'host-dom-grill-me' ? '00' : String(idx + 1).padStart(2, '0'),
    x: typeof saved.x === 'number' ? saved.x : 64 + col * 342,
    y: typeof saved.y === 'number' ? saved.y : 88 + yCenterOffset + row * rowPitch,
    w: typeof saved.w === 'number' ? saved.w : (nd.w || 272),
    h: typeof saved.h === 'number' ? saved.h : (nd.h ?? null),
    color: hasSavedColor ? saved.color : (nd.color || 'none'),
    colorKey: hasSavedColor ? saved.color : nd.colorKey,
    bypassed: saved.bypassed !== undefined ? Boolean(saved.bypassed) : Boolean(nd.bypassed),
    collapsed: saved.collapsed !== undefined ? Boolean(saved.collapsed) : Boolean(nd.collapsed),
    expanded: saved.expanded !== undefined ? Boolean(saved.expanded) : false
  };
}

function layoutDagLayerNodes(nodes, savedState = {}) {
  transitivelyReduceDag(nodes);
  const depthMap = computeLongestDagDepths(nodes);
  const colTotals = new Map();
  for (const nd of nodes) {
    const c = depthMap.get(nd.id) || 0;
    colTotals.set(c, (colTotals.get(c) || 0) + 1);
  }
  const maxColCount = Math.max(1, ...colTotals.values());
  const colRows = new Map();
  const layouts = savedState?.hostNodeLayouts || {};
  const ordered = [...nodes].sort((a, b) => {
    const dDiff = (depthMap.get(a.id) || 0) - (depthMap.get(b.id) || 0);
    return dDiff !== 0 ? dDiff : (inferNodeArchTier(a) - inferNodeArchTier(b));
  });
  return ordered.map((nd, idx) => {
    const col = depthMap.get(nd.id) || 0;
    const row = colRows.get(col) || 0;
    colRows.set(col, row + 1);
    return applySavedNodeLayout(nd, layouts[nd.id] || {}, idx, col, row, colTotals.get(col) || 1, maxColCount);
  });
}

function buildMultiMemberGroupRecord(rawMembers, memberIdxs, depth, gIdx, usedTitles, usedIds) {
  const memberIdSet = new Set(rawMembers.map((m) => m.id));
  const scopedMembers = rawMembers.map((m) => ({
    ...m,
    nextIds: (m.nextIds || []).filter((tid) => memberIdSet.has(tid))
  }));
  const innerHierarchy = scopedMembers.length >= 4
    ? buildHierarchyRecursive(scopedMembers, depth + 1, {}, usedIds)
    : layoutDagLayerNodes(scopedMembers, {});
  const scopePaths = [...new Set(rawMembers.flatMap((m) => m.scopePaths || []))];
  const meta = deriveSubgraphMeta(innerHierarchy, scopePaths, depth, gIdx, usedTitles, usedIds);
  const contractIds = [...new Set(rawMembers.flatMap((m) => m.contractIds || []))];
  const sharedSum = rawMembers.reduce((s, m) => s + (m.codeCapsule?.sharedCount || 0), 0);
  const modSum = rawMembers.reduce((s, m) => s + (m.codeCapsule?.moduleCount || (m.modules || []).length), 0);
  const hasGrill = rawMembers.some((m) => m.id === 'host-dom-grill-me');
  const meanTier = hasGrill ? -1 : (rawMembers.reduce((s, m) => s + inferNodeArchTier(m), 0) / rawMembers.length);

  return {
    single: false,
    hasGrill,
    meanTier,
    memberIdxs,
    node: {
      id: meta.id,
      step: '01',
      archTier: Math.max(0, Math.round(meanTier)),
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
      x: 64,
      y: 88,
      w: 274,
      h: null,
      nextIds: [],
      modules: []
    }
  };
}

function buildHierarchyRecursive(nodes, depth, savedState, usedIds = new Set()) {
  const rootSaved = depth === 0 ? savedState : {};
  if (nodes.length <= 3 || depth >= 3) return layoutDagLayerNodes(nodes, rootSaved);
  const part = partitionByLouvainModularity(nodes, depth);
  const groups = Array.isArray(part) ? part : part.groups;
  if (groups.every((g) => g.length === 1)) return layoutDagLayerNodes(nodes, rootSaved);

  const usedTitles = new Set();
  const groupRecords = groups.map((memberIdxs, gIdx) => {
    const rawMembers = memberIdxs.map((i) => nodes[i]);
    if (rawMembers.length === 1) {
      const m = rawMembers[0];
      return {
        single: true,
        hasGrill: m.id === 'host-dom-grill-me',
        meanTier: inferNodeArchTier(m),
        memberIdxs,
        node: { ...m, nextIds: [] }
      };
    }
    return buildMultiMemberGroupRecord(rawMembers, memberIdxs, depth, gIdx, usedTitles, usedIds);
  });

  orientAndReduceGroupRecords(groupRecords, part.dirW);
  return layoutDagLayerNodes(groupRecords.map((r) => r.node), rootSaved);
}

export function buildAdaptiveBusinessHierarchy(codeUnitNodes, savedState = {}, hasInitializedIntent = false) {
  if (codeUnitNodes.length === 0) {
    if (!hasInitializedIntent && !savedState?.grillMeNode) return [];
    return [createGrillMeCapabilityNode(savedState?.grillMeNode, [])];
  }
  const leaves = enrichLeafBusinessCapabilityNodes(codeUnitNodes, savedState, hasInitializedIntent);
  const usedIds = new Set(leaves.map((n) => n.id));
  return buildHierarchyRecursive(leaves, 0, savedState, usedIds);
}
