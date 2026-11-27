// 主控三级按需变焦命令调度器（通用图谱/源码下钻 + 可插拔宿主适配层，<= 350 行）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { cmdImpact, fileBelongsToScopes, getCbmGraphSummary, isSharedGovernanceFile, queryCbmFileGraph } from '../core/index.mjs';
import { finalizeCliTextView, finalizeZoomCliResult, parseBudgetOption } from './cockpit-budget.mjs';
import { buildCockpitGraphIndex, extractFullHeaderComment, resolveCockpitAdapter } from './cockpit-index.mjs';
import { renderBuiltinZoomTopic, renderDecisionsZoom, renderDomainOrContract, renderSingleFileZoom } from './cockpit-render.mjs';
import { formatPathGovernanceLines, renderBoundedSourceSlice, renderCbmSymbolZoom, renderFileSkeletonZoom } from './cockpit-source.mjs';

const BUILTIN_TOPICS = new Set(['rules', 'tests', 'gaps', 'all']);
const CKC_CAPSULE_BUDGET_TOK = 160000;

function ckcComputeContractLayers(nodes) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]));
  const memo = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const deps = (byId.get(id)?.dependsOnIds || []).filter((d) => byId.has(d));
    const depth = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    visiting.delete(id);
    memo.set(id, depth);
    return depth;
  };
  for (const n of nodes || []) depthOf(n.id);
  return memo;
}

export function cmdBrief(projectRoot, opts = {}) {
  const budgetOpt = parseBudgetOption(opts.budget);
  if (!budgetOpt.ok) return { exitCode: 3, stderr: budgetOpt.stderr };
  const adapter = resolveCockpitAdapter(opts.adapter);
  const idx = buildCockpitGraphIndex(projectRoot, { adapter });
  const cbm = getCbmGraphSummary(idx.root);
  if (opts.json) {
    const payload = adapter.id === 'generic'
      ? {
        head: idx.gitHead, project: idx.atlas.project.name,
        moduleCount: idx.atlas.project.moduleCount, domains: idx.domains.length,
        languages: idx.liveMeta.languages, tests: idx.liveMeta.testSummaries.length, cbmGraph: cbm
      }
      : {
        head: idx.gitHead, moduleCount: idx.atlas.project.moduleCount, domains: idx.domains.length,
        contracts: idx.graph.topoOrder, adrs: idx.adrs.length, gaps: idx.gaps.length, cbmGraph: cbm,
        capsuleBudgetTokens: CKC_CAPSULE_BUDGET_TOK
      };
    const out = JSON.stringify(payload, null, 2);
    return { exitCode: 0, stdout: out };
  }
  const layerMap = (idx.graph.nodes || []).length > 0 ? ckcComputeContractLayers(idx.graph.nodes) : new Map();
  const md = adapter.renderBriefMarkdown(idx, cbm, layerMap);
  const view = finalizeCliTextView(md.trimEnd(), budgetOpt.value, `${adapter.cliPrefix} brief`);
  if (!view.ok) return { exitCode: view.exitCode, stderr: view.stderr };
  if (typeof opts.out === 'string' && opts.out.trim()) {
    const absOut = resolve(projectRoot, opts.out.trim());
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, `${view.stdout}\n`, 'utf8');
  }
  return { exitCode: 0, stdout: view.stdout };
}

function ckcLookupFileInfo(idx, target) {
  let rel = idx.fileHeaders[target] !== undefined
    ? target
    : Object.keys(idx.fileHeaders).find((f) => f.endsWith('/' + target));
  if (!rel) {
    const candAbs = resolve(idx.root, target);
    const r = relative(idx.root, candAbs).split(sep).join('/');
    if (!r || isAbsolute(r) || r.startsWith('..') || !existsSync(candAbs)) return null;
    try { if (!statSync(candAbs).isFile()) return null; } catch { return null; }
    rel = r;
  }
  const abs = resolve(idx.root, rel);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const isGen = idx.adapterId === 'generic';
  const owners = isGen ? [] : (idx.graph.nodes || []).filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
  return {
    file: rel, owners, isSharedGov: isGen ? false : isSharedGovernanceFile(rel),
    header: idx.fileHeaders[rel] || extractFullHeaderComment(raw) || '源码模块',
    totalLines: raw.split(/\r?\n/).length
  };
}

function ckcLooksLikeExplicitFilePath(target) {
  if (target.startsWith('/donegate/api') || target.startsWith('/api/')) return false;
  return target.includes('/') || /\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h|toml|json|jsonl|cmd|sh|md|yml|yaml)$/i.test(target);
}

function ckcIsStandaloneZoomTarget(idx, tok) {
  if (!tok) return false;
  const c = tok.replace(/^\.\//, '');
  if (BUILTIN_TOPICS.has(c)) return true;
  if (idx.domains.some((d) => d.step === c || d.id === c)) return true;
  if ((idx.graph.nodes || []).some((n) => n.id === c)) return true;
  return Boolean(ckcLookupFileInfo(idx, c));
}

function ckcResolveAllTarget(idx, adapter, stubsFlag, hasContracts) {
  if (stubsFlag && adapter.id !== 'generic') {
    const stubOut = (idx.graph.nodes || []).map((c) => renderDomainOrContract(null, c, true, hasContracts)).join('\n\n');
    if (stubOut) return stubOut;
    const layerMap = hasContracts ? ckcComputeContractLayers(idx.graph.nodes) : new Map();
    return adapter.renderBriefMarkdown(idx, getCbmGraphSummary(idx.root), layerMap);
  }
  const isGen = adapter.id === 'generic';
  return idx.domains.map((d) => renderDomainOrContract(d, null, false, hasContracts, true, isGen)).join('\n\n');
}

function ckcTryTopicOrFileZoom(idx, adapter, target, arg1, hasContracts, opts = {}) {
  const builtinOut = renderBuiltinZoomTopic(idx, target, arg1, adapter);
  if (builtinOut !== null) return builtinOut;
  const fileInfo = ckcLookupFileInfo(idx, target);
  if (!fileInfo) return null;
  if (opts?.skeleton) return renderFileSkeletonZoom(idx, fileInfo, hasContracts);
  const adrLines = formatPathGovernanceLines(idx, fileInfo.file, hasContracts, true).slice(1);
  return renderSingleFileZoom(fileInfo, hasContracts, {
    adapterId: adapter.id,
    cliPrefix: adapter.cliPrefix,
    sharedGovLabel: adapter.sharedGovLabel,
    adrLines,
    cbmGraph: queryCbmFileGraph(idx.root, fileInfo.file)
  });
}

function ckcResolveSingleTarget(idx, adapter, target, arg1, opts, batchCtx = null) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  if (opts.source) return renderBoundedSourceSlice(idx, target, hasContracts, batchCtx?.seenAdrFiles || null);
  if (opts.decisions) return renderDecisionsZoom(idx, target, Boolean(opts.full), arg1 || '');
  if (target === 'all') return ckcResolveAllTarget(idx, adapter, Boolean(opts.stubs), hasContracts);
  if (!opts.stubs && !opts.trace) {
    const tf = ckcTryTopicOrFileZoom(idx, adapter, target, arg1, hasContracts, opts);
    if (tf !== null) return tf;
  }
  const dom = idx.domains.find((d) => d.step === target || d.id === target);
  const con = (idx.graph.nodes || []).find((c) => c.id === target);
  if (dom || con) {
    return renderDomainOrContract(dom, con, Boolean(opts.stubs), hasContracts, Boolean(batchCtx?.multiDomain), adapter.id === 'generic');
  }
  return (!opts.stubs && !ckcLooksLikeExplicitFilePath(target)) ? renderCbmSymbolZoom(idx, target, hasContracts, opts) : null;
}

function ckcFormatMissingZoomError(idx, target) {
  const stem = target.split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  const tokens = stem.split(/[-_.]+/).filter((t) => t.length >= 3);
  const cands = Object.keys(idx.fileHeaders).filter((f) => {
    const low = f.toLowerCase();
    return low.includes(stem) || (tokens.length > 0 && tokens.every((tk) => low.includes(tk)));
  }).slice(0, 5);
  const hint = cands.length > 0 ? `（仓库内相近真实路径：${cands.join(', ')}）` : '';
  const targetLabel = idx.adapterId === 'generic' ? '目录组编号、文件路径或图谱符号' : '域编号、契约 ID、文件路径或图谱符号';
  return `未找到匹配${targetLabel}：${target}${hint}`;
}

function ckcRunZoomTargetLoop(idx, adapter, targets, opts) {
  const chunks = [], errors = [];
  const domHits = targets.filter((t) => idx.domains.some((d) => d.step === t || d.id === t)).length;
  const batchCtx = { seenAdrFiles: new Set(), multiDomain: domHits > 1 };
  for (let i = 0; i < targets.length; i++) {
    const cleanT = targets[i].replace(/^\.\//, '');
    const canTakeFilter = !opts.source && (cleanT === 'tests' || cleanT === 'gaps') && i + 1 < targets.length;
    const arg1 = (canTakeFilter && !ckcIsStandaloneZoomTarget(idx, targets[i + 1])) ? targets[++i] : '';
    const out = ckcResolveSingleTarget(idx, adapter, cleanT, arg1, opts, batchCtx);
    if (out !== null) chunks.push(out);
    else errors.push(ckcFormatMissingZoomError(idx, cleanT));
  }
  return { chunks, errors };
}

export function cmdZoom(projectRoot, opts = {}) {
  const budgetOpt = parseBudgetOption(opts.budget);
  if (!budgetOpt.ok) return { exitCode: 3, stderr: budgetOpt.stderr };
  const adapter = resolveCockpitAdapter(opts.adapter);
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  if (targets.length === 0) {
    const usage = adapter.id === 'generic'
      ? `用法：${adapter.cliPrefix} zoom <组编号|文件路径[:起-止]|符号名|rules|tests|gaps|all> [更多目标...] [--skeleton] [--source] [--budget <n>]`
      : '用法：donegate zoom <域编号|契约ID|文件路径[:起-止]|符号名|rules|tests|gaps|all> [更多目标...] [--stubs] [--decisions] [--full [关键词]] [--skeleton] [--source] [--budget <n>]';
    return { exitCode: 3, stderr: usage };
  }
  if (targets[0] === 'impact') {
    return cmdImpact(projectRoot, { targets: targets.slice(1), json: opts.json, budget: opts.budget, adapterId: adapter.id, cliPrefix: adapter.cliPrefix });
  }
  const idx = buildCockpitGraphIndex(projectRoot, { adapter });
  const resultOpts = { ...opts, cliPrefix: adapter.cliPrefix };
  if (opts.decisions) {
    const first = targets[0].replace(/^\.\//, '');
    const out = ckcResolveSingleTarget(idx, adapter, first, targets[1] || '', opts);
    if (out === null) return { exitCode: 1, stderr: ckcFormatMissingZoomError(idx, first) };
    return finalizeZoomCliResult(out, 0, null, targets, resultOpts, budgetOpt.value);
  }
  const { chunks, errors } = ckcRunZoomTargetLoop(idx, adapter, targets, opts);
  if (errors.length === 0) return finalizeZoomCliResult(chunks.join('\n\n'), 0, null, targets, resultOpts, budgetOpt.value);
  if (chunks.length === 0) return { exitCode: 1, stderr: errors.join('\n') };
  const partial = [...chunks, `=== [部分目标未命中告警 (${errors.length} 项)] ===\n${errors.map((e) => `  ✗ ${e}`).join('\n')}`].join('\n\n');
  return finalizeZoomCliResult(partial, 1, errors.join('\n'), targets, resultOpts, budgetOpt.value);
}
