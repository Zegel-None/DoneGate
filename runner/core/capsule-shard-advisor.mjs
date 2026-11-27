// L1 胶囊高水位 Louvain 模块度弹性分片建议器（Blondel et al. 2008，<= 350 行）
// 当单张契约卡 0-Hop 源码逼近预算上限（>= 80% 或发生截断）时，基于模块间导入、DOM 耦合与同族前缀自动计算最优拆分切口
import { basename, dirname, extname, join, normalize } from 'node:path';
import { maskCommentsAndStrings } from './ast-stub.mjs';

const CSA_IMPORT_RE = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
const CSA_HIGH_WATER_RATIO = 0.80;

function csaResolveImportTarget(src, spec, scopeSet) {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(src), spec)).replace(/\\/g, '/');
  const cands = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}/index.mjs`, `${base}/index.js`];
  return cands.find((c) => scopeSet.has(c)) || null;
}

function csaExtractStemGroup(relPath) {
  const stem = basename(relPath, extname(relPath));
  const parts = stem.split('-').filter(Boolean);
  if (parts.length >= 2) return `${dirname(relPath)}/${parts[0]}-${parts[1]}`;
  return `${dirname(relPath)}/${parts[0] || stem}`;
}

function csaAddUndirectedWeight(adj, a, b, w) {
  if (a === b || w <= 0) return;
  adj.get(a).set(b, (adj.get(a).get(b) || 0) + w);
  adj.get(b).set(a, (adj.get(b).get(a) || 0) + w);
}

function csaAddPrefixAffinityEdges(files, adj) {
  const byPrefix = new Map();
  for (const f of files) {
    const key = csaExtractStemGroup(f);
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push(f);
  }
  for (const group of byPrefix.values()) {
    if (group.length < 2 || group.length > 10) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) csaAddUndirectedWeight(adj, group[i], group[j], 0.6);
    }
  }
}

function csaBuildCouplingGraph(files, rawByFile, domGraph) {
  const scopeSet = new Set(files);
  const adj = new Map(files.map((f) => [f, new Map()]));
  for (const src of files) {
    const body = rawByFile.get(src) || '';
    const masked = maskCommentsAndStrings(body, extname(src).toLowerCase());
    for (const m of body.matchAll(CSA_IMPORT_RE)) {
      if (masked[m.index] === ' ') continue;
      const dst = csaResolveImportTarget(src, m[1].split(/[?#]/)[0], scopeSet);
      if (dst) csaAddUndirectedWeight(adj, src, dst, 3.0);
    }
    for (const linked of domGraph?.edges?.get(src) || []) {
      if (scopeSet.has(linked)) csaAddUndirectedWeight(adj, src, linked, 1.5);
    }
  }
  csaAddPrefixAffinityEdges(files, adj);
  return adj;
}

function csaSumCommunityWeights(node, commOf, adj) {
  const weightsByComm = new Map();
  for (const [nbr, w] of adj.get(node).entries()) {
    const c = commOf.get(nbr);
    weightsByComm.set(c, (weightsByComm.get(c) || 0) + w);
  }
  return weightsByComm;
}

function csaFindBestMove(f, curC, k_i, m2, adj, commOf, sigmaTot) {
  const nbrCommWeights = csaSumCommunityWeights(f, commOf, adj);
  const k_i_cur = nbrCommWeights.get(curC) || 0;
  const totCurWithout = (sigmaTot.get(curC) || 0) - k_i;
  let bestComm = curC;
  let bestGain = 1e-9;
  for (const [candC, k_i_in] of nbrCommWeights.entries()) {
    if (candC === curC) continue;
    const totCand = sigmaTot.get(candC) || 0;
    const gain = (k_i_in - k_i_cur) / m2 - (k_i * (totCand - totCurWithout)) / (m2 * m2 / 2);
    if (gain > bestGain) {
      bestGain = gain;
      bestComm = candC;
    }
  }
  return bestComm;
}

function csaComputeModularityQ(files, adj, commOf, strength, m2) {
  if (m2 <= 0) return 0;
  let q = 0;
  for (const u of files) {
    for (const v of files) {
      if (commOf.get(u) !== commOf.get(v)) continue;
      const a_uv = adj.get(u).get(v) || 0;
      q += a_uv - ((strength.get(u) || 0) * (strength.get(v) || 0)) / m2;
    }
  }
  return Math.round((q / m2) * 1000) / 1000;
}

function csaPartitionLouvain(files, adj) {
  const strength = new Map();
  let m2 = 0;
  for (const f of files) {
    let deg = 0;
    for (const w of adj.get(f).values()) deg += w;
    strength.set(f, deg);
    m2 += deg;
  }
  if (m2 <= 0) {
    const mid = Math.ceil(files.length / 2);
    return { commOf: new Map(files.map((f, idx) => [f, idx < mid ? 0 : 1])), modularityQ: 0 };
  }
  const commOf = new Map(files.map((f, idx) => [f, idx]));
  const sigmaTot = new Map(files.map((f, idx) => [idx, strength.get(f) || 0]));
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const f of files) {
      const curC = commOf.get(f), k_i = strength.get(f) || 0;
      const bestComm = csaFindBestMove(f, curC, k_i, m2, adj, commOf, sigmaTot);
      if (bestComm !== curC) {
        sigmaTot.set(curC, (sigmaTot.get(curC) || 0) - k_i);
        sigmaTot.set(bestComm, (sigmaTot.get(bestComm) || 0) + k_i);
        commOf.set(f, bestComm);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { commOf, modularityQ: csaComputeModularityQ(files, adj, commOf, strength, m2) };
}

function csaDeriveShardSlug(nodeId, shardFiles, idx) {
  const stems = shardFiles.map((f) => basename(f, extname(f)).split('-')[0]).filter(Boolean);
  const counts = new Map();
  for (const s of stems) counts.set(s, (counts.get(s) || 0) + 1);
  const topStem = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || `shard${idx + 1}`;
  return `${nodeId}-${topStem}-${idx + 1}`;
}

function csaBuildShardDescriptor(nodeId, shardFiles, idx, rawByFile, adj) {
  const shardSet = new Set(shardFiles);
  const chars = shardFiles.reduce((s, f) => s + (rawByFile.get(f)?.length || 0), 0);
  let cutEdges = 0;
  for (const f of shardFiles) {
    for (const nbr of adj.get(f).keys()) {
      if (!shardSet.has(nbr)) cutEdges++;
    }
  }
  return {
    suggestedContractId: csaDeriveShardSlug(nodeId, shardFiles, idx),
    fileCount: shardFiles.length,
    estimatedTokens: Math.ceil(chars / 4),
    crossCutLinks: cutEdges,
    files: shardFiles
  };
}

export function adviseCapsuleModularitySplit(target, rawByFile, domGraph, budget, truncatedCount = 0) {
  const files = [...rawByFile.keys()].sort();
  const capTokens = Math.max(1, budget?.zeroHopSourceBudgetTokens || 160000);
  const usedTokens = target?.stub?.sourceTokens || Math.ceil([...rawByFile.values()].reduce((s, t) => s + t.length, 0) / 4);
  const utilizationRatio = Math.round((usedTokens / capTokens) * 1000) / 1000;
  if (files.length < 2 || (utilizationRatio < CSA_HIGH_WATER_RATIO && truncatedCount === 0)) return null;

  const adj = csaBuildCouplingGraph(files, rawByFile, domGraph);
  const { commOf, modularityQ } = csaPartitionLouvain(files, adj);
  const groups = new Map();
  for (const f of files) {
    const cid = commOf.get(f);
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(f);
  }
  if (groups.size < 2) {
    const mid = Math.ceil(files.length / 2);
    groups.clear();
    groups.set(0, files.slice(0, mid));
    groups.set(1, files.slice(mid));
  }
  const shards = [...groups.values()]
    .sort((a, b) => b.length - a.length)
    .map((sf, idx) => csaBuildShardDescriptor(target.id, sf, idx, rawByFile, adj));

  return {
    triggeredBy: truncatedCount > 0 ? 'budget-overflow' : 'high-water-mark',
    utilizationRatio,
    sourceTokens: usedTokens,
    budgetTokens: capTokens,
    modularityQ,
    recommendedShardCount: shards.length,
    shards
  };
}

export function formatShardAdviceLines(shardAdvice) {
  if (!shardAdvice) return [];
  return [
    '',
    `> 💡 Louvain 模块度容量分片建议（水位 ${Math.round(shardAdvice.utilizationRatio * 100)}%，Q=${shardAdvice.modularityQ}）：`,
    ...shardAdvice.shards.map((s) => `> - 建议子契约 \`${s.suggestedContractId}\`（${s.fileCount} 个文件，约 ${s.estimatedTokens}t，跨切口边 ${s.crossCutLinks} 条）：${s.files.slice(0, 4).map((x) => `\`${x}\``).join(', ')}`)
  ];
}
