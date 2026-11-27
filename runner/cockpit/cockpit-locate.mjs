// 任务描述直达定位命令（FTS 种子 + 个性化 PageRank + token 预算打包，<= 350 行）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFileSkeleton, discoverHermeticGraph, estimateTokens, explainRank, isSharedGovernanceFile,
  loadRankGraph, openCbmGraphHandle, personalizedPageRank, scoreSeeds
} from '../core/index.mjs';
import { resolveFileContractOwners } from './cockpit-source.mjs';

const LOCATE_CONTRACT_CACHE = new Map();
const LOCATE_CACHE_MAX = 8;

function clParsePosInt(raw, fallback, flagName) {
  if (raw === undefined) return { ok: true, value: fallback };
  if (raw === true || raw === false || raw === '' || raw === null) {
    return { ok: false, stderr: `参数错误：--${flagName} 需要正整数。` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, stderr: `参数错误：--${flagName} 必须为正整数（收到 ${String(raw)}）。` };
  }
  return { ok: true, value: n };
}

function clLoadContractNodes(rootDir, cacheKey) {
  if (LOCATE_CONTRACT_CACHE.has(cacheKey)) return LOCATE_CONTRACT_CACHE.get(cacheKey);
  let nodes = [];
  if (existsSync(join(rootDir, 'contracts'))) {
    try {
      nodes = discoverHermeticGraph(rootDir).nodes || [];
    } catch (err) {
      void err;
      nodes = [];
    }
  }
  if (LOCATE_CONTRACT_CACHE.size >= LOCATE_CACHE_MAX) {
    const oldest = LOCATE_CONTRACT_CACHE.keys().next().value;
    if (oldest !== undefined) LOCATE_CONTRACT_CACHE.delete(oldest);
  }
  LOCATE_CONTRACT_CACHE.set(cacheKey, nodes);
  return nodes;
}

function clResolveContractInfo(nodes, file) {
  const ownerIds = resolveFileContractOwners(nodes, file);
  let contract = ownerIds.join(',');
  if (!contract) {
    if (nodes.length === 0) contract = '零契约';
    else if (isSharedGovernanceFile(file)) contract = '共享治理';
    else contract = '未归属';
  }
  return { ownerIds, contract };
}

function clResolveSkeletonBudget(budget) {
  return budget <= 300 ? 50 : 80;
}

function clFormatSkeletonLine(line) {
  const m = line.match(/^… \(已省略 (\d+) 行\)$/);
  return m ? `   … (+${m[1]} 骨架行)` : `   ${line}`;
}

function clReadSkeletonSummary(projectRoot, file, skelMaxTok) {
  const skel = buildFileSkeleton(projectRoot, file, { maxTokens: skelMaxTok });
  if (!skel || !skel.text) return ['   源码模块'];
  return skel.text.split('\n').map(clFormatSkeletonLine);
}

function clFormatReason(graph, seeds, file) {
  const exp = explainRank(graph, seeds, file);
  if (exp.seedTerms.length > 0) return `种子词: ${exp.seedTerms.slice(0, 5).join(', ')}`;
  if (exp.via.length > 0) return `经 ${exp.via[0].type} ← ${exp.via[0].from} 传播`;
  return '图谱关联传播';
}

function clBuildCandidate(projectRoot, graph, seeds, nodes, item, skelMaxTok) {
  const { ownerIds, contract } = clResolveContractInfo(nodes, item.file);
  return {
    file: item.file,
    score: item.score,
    ownerIds,
    contract,
    skeletonLines: clReadSkeletonSummary(projectRoot, item.file, skelMaxTok),
    reason: clFormatReason(graph, seeds, item.file)
  };
}

function clFormatCandidateBlock(rankNum, cand) {
  return [
    `${rankNum}. ${cand.file} [${cand.score.toFixed(4)} | ${cand.contract}]`,
    ...cand.skeletonLines,
    `   依据: ${cand.reason}`
  ].join('\n');
}

function clBuildFooterLines(top1) {
  const third = top1.ownerIds.length > 0
    ? `node runner/donegate.mjs slice ${top1.ownerIds[0]}`
    : `node runner/donegate.mjs zoom ${top1.file}`;
  return [
    '',
    '下一步：',
    `  1) node runner/donegate.mjs zoom ${top1.file} --skeleton`,
    `  2) node runner/donegate.mjs impact ${top1.file}`,
    `  3) ${third}`
  ];
}

function clRenderLocateText(header, blocks, omitted, safeQuery, budget, footerLines) {
  const parts = [header, '', ...blocks];
  if (omitted > 0) {
    parts.push(`已省略 ${omitted} 个候选，展开：locate "${safeQuery}" --budget ${budget * 2}`);
  }
  parts.push(...footerLines);
  return parts.join('\n');
}

function clNoSeedResponse(query, json) {
  const suggestion = '请补充具体模块名、符号名或中文功能关键词（避免仅使用通用停用词）。';
  const msg = `未命中任何种子词：${query}\n建议：${suggestion}`;
  if (!json) return { exitCode: 1, stdout: msg };
  return {
    exitCode: 1,
    stdout: JSON.stringify({ query, seeds: [], results: [], omitted: 0, tokens: estimateTokens(msg), suggestion }, null, 2)
  };
}

function clBuildHeader(safeQuery, seedsCount, candCount, totalRanked, budget) {
  return `locate "${safeQuery}" · 种子 ${seedsCount} 文件 · 候选 ${candCount}/${totalRanked} (预算 ${budget} tok)`;
}

function clCalcMinBudget(candidates, safeQuery, seedsCount, totalRanked, footerLines, initialEst, projectRoot, skelMaxTok) {
  let est = Math.max(1, initialEst);
  let cand0 = candidates[0];
  let curSkelTok = skelMaxTok;
  for (let step = 0; step < 4; step++) {
    const targetSkelTok = clResolveSkeletonBudget(est);
    if (targetSkelTok !== curSkelTok) {
      curSkelTok = targetSkelTok;
      cand0 = { ...cand0, skeletonLines: clReadSkeletonSummary(projectRoot, cand0.file, curSkelTok) };
    }
    const header = clBuildHeader(safeQuery, seedsCount, candidates.length, totalRanked, est);
    const block0 = clFormatCandidateBlock(1, cand0);
    const text = clRenderLocateText(header, [block0], candidates.length - 1, safeQuery, est, footerLines);
    const next = estimateTokens(text);
    if (next <= est) break;
    est = next;
  }
  return est;
}

function clPackCandidates(candidates, header, safeQuery, budget, footerLines) {
  const kept = [];
  const keptBlocks = [];
  let minNeeded = 0;
  for (let i = 0; i < candidates.length; i++) {
    const block = clFormatCandidateBlock(i + 1, candidates[i]);
    const nextBlocks = [...keptBlocks, block];
    const nextOmitted = candidates.length - (kept.length + 1);
    const tentative = clRenderLocateText(header, nextBlocks, nextOmitted, safeQuery, budget, footerLines);
    const tok = estimateTokens(tentative);
    if (i === 0) minNeeded = tok;
    if (tok <= budget) {
      kept.push(candidates[i]);
      keptBlocks.push(block);
    } else {
      break;
    }
  }
  const omitted = candidates.length - kept.length;
  const renderedText = clRenderLocateText(header, keptBlocks, omitted, safeQuery, budget, footerLines);
  return { kept, omitted, renderedText, tokens: estimateTokens(renderedText), minNeeded };
}

function clRankCandidates(graph, seeds, alpha, k) {
  const scores = personalizedPageRank(graph, seeds, { alpha });
  const rankedAll = [];
  for (let i = 0; i < graph.files.length; i++) {
    if (scores[i] > 0) rankedAll.push({ file: graph.files[i], score: scores[i] });
  }
  rankedAll.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return { total: rankedAll.length, topSlice: rankedAll.slice(0, k) };
}

export function cmdLocate(projectRoot, opts = {}) {
  const query = String(opts.query || '').trim();
  if (!query) {
    return { exitCode: 3, stderr: '用法：node runner/donegate.mjs locate "<任务描述>" [--budget <tok>] [--k <n>] [--json]' };
  }
  const budgetOpt = clParsePosInt(opts.budget, 4000, 'budget');
  if (!budgetOpt.ok) return { exitCode: 3, stderr: budgetOpt.stderr };
  const kOpt = clParsePosInt(opts.k, 15, 'k');
  if (!kOpt.ok) return { exitCode: 3, stderr: kOpt.stderr };

  const graph = loadRankGraph(projectRoot);
  if (!graph) {
    return { exitCode: 3, stderr: '缺少 CBM 图谱索引（codebase-memory-mcp 未就绪），无法执行 locate。' };
  }
  const seeds = scoreSeeds(projectRoot, query);
  if (seeds.size === 0) return clNoSeedResponse(query, Boolean(opts.json));

  const ranked = clRankCandidates(graph, seeds, opts.alpha ?? 0.65, kOpt.value);
  if (ranked.topSlice.length === 0) return clNoSeedResponse(query, Boolean(opts.json));

  const h = openCbmGraphHandle(projectRoot);
  const rootDir = h?.root || projectRoot;
  const nodes = clLoadContractNodes(rootDir, h ? `${h.root}|${h.fp}` : rootDir);
  const skelMaxTok = clResolveSkeletonBudget(budgetOpt.value);
  const candidates = ranked.topSlice.map((item) => clBuildCandidate(projectRoot, graph, seeds, nodes, item, skelMaxTok));
  const singleLineQuery = query.replace(/[\r\n\t]+/g, ' ').trim();
  const safeQuery = singleLineQuery.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const header = clBuildHeader(safeQuery, seeds.size, candidates.length, ranked.total, budgetOpt.value);
  const footerLines = clBuildFooterLines(candidates[0]);
  const packed = clPackCandidates(candidates, header, safeQuery, budgetOpt.value, footerLines);
  if (packed.kept.length === 0) {
    const minNeeded = clCalcMinBudget(candidates, safeQuery, seeds.size, ranked.total, footerLines, packed.minNeeded, projectRoot, skelMaxTok);
    return {
      exitCode: 3,
      stderr: `参数错误：--budget ${budgetOpt.value} 过小，当前检索结果至少需要约 ${minNeeded} tok 以容纳 1 个候选。`
    };
  }

  if (!opts.json) return { exitCode: 0, stdout: packed.renderedText };
  const seedList = [...seeds.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
  const results = packed.kept.map(({ file, score, contract, reason }) => ({ file, score: Number(score.toFixed(6)), contract, reason }));
  return { exitCode: 0, stdout: JSON.stringify({ query, seeds: seedList, results, omitted: packed.omitted, tokens: packed.tokens }, null, 2) };
}
