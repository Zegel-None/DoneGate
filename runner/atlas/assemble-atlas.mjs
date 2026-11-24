// 项目活体全景账本拼装器：合并全栈入口、跨语言调用链、Git 分支雷达与契约状态，产出 atlas.json / PROJECT-MAP.md / project.c4（<= 300 行）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { computeProjectStatus } from '../core/contract.mjs';
import { readMaybe } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import {
  buildAiPromptForBranch, buildAiPromptForModule, extractHumanTitleFromSource,
  humanKindLabel, humanizeDomainTitle, humanizeVerdictStatus
} from './humanize.mjs';
import { scanProjectEntries, walkSourceTree } from './scan-entries.mjs';
import { scanCrossLanguageGraph } from './scan-graph.mjs';
import { scanGitBranchRadar, scanSpecsAndBeads } from './scan-branches.mjs';
import { hydrateWorkbenchData } from './hydrate-workbench.mjs';

function inferDomainKey(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length <= 1) return 'root';
  if (['apps', 'packages', 'services', 'modules'].includes(parts[0]) && parts.length >= 3) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

function classifyArchLane(mod, entrypointsOfMod) {
  if (entrypointsOfMod.some((e) => e.kind === 'web-page') || /\.(?:tsx|jsx|vue)$/.test(mod.path)) return 'ui';
  if (entrypointsOfMod.some((e) => ['fastapi-route', 'flask-route', 'node-api'].includes(e.kind))) return 'api';
  if (entrypointsOfMod.some((e) => ['node-cli', 'py-cli', 'ai-skill'].includes(e.kind))) return 'tool';
  return 'core';
}

function asmAtlasFindOwnerContract(activeContracts, relFile) {
  return activeContracts.find((c) => (c.scope || []).some((s) => {
    const ns = String(s).replace(/\\/g, '/').replace(/^\.\//, '');
    return ns.endsWith('/') ? relFile.startsWith(ns) : (relFile === ns || relFile.startsWith(ns + '/'));
  })) || null;
}

function asmAtlasIndexInputs(st, gitRadar, entryData, graphData) {
  const activeContracts = (st.contracts || []).filter((c) => !c.retired);
  const summaryById = new Map((st.contractSummaries || []).map((cs) => [cs.id, cs]));
  const branchesByFile = new Map();
  for (const b of gitRadar.branches) {
    if (b.isDefault) continue;
    for (const cf of b.changedFiles) {
      if (!branchesByFile.has(cf)) branchesByFile.set(cf, []);
      branchesByFile.get(cf).push(b.name);
    }
  }
  const entriesByMod = new Map();
  for (const ep of entryData.entrypoints) {
    if (!entriesByMod.has(ep.modulePath)) entriesByMod.set(ep.modulePath, []);
    entriesByMod.get(ep.modulePath).push(ep);
  }
  const inDegree = new Map();
  for (const e of graphData.edges) inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  return { activeContracts, summaryById, branchesByFile, entriesByMod, inDegree };
}

function asmAtlasResolveWorstSubclass(cs) {
  const nonA1 = cs?.obligations?.find((o) => o.subclass && o.subclass !== 'A1')?.subclass;
  return nonA1 || (cs?.passTrusted > 0 ? 'A1' : '');
}

function asmAtlasBuildModuleRecord(rel, idxCtx, entryData, graphData) {
  const { activeContracts, summaryById, branchesByFile, entriesByMod, inDegree } = idxCtx;
  const src = entryData.fileSourceMap.get(rel) || '';
  const domKey = inferDomainKey(rel);
  const owner = asmAtlasFindOwnerContract(activeContracts, rel);
  const cs = owner ? summaryById.get(owner.id) : null;
  const isWild = activeContracts.length > 0 ? !owner : true;
  const humanVerdict = humanizeVerdictStatus({
    state: cs?.state, subclass: asmAtlasResolveWorstSubclass(cs),
    cleared: Boolean(cs?.cleared), pendingRecheck: Boolean(cs?.obligations?.some((o) => o.pendingRecheck)), isWild
  });
  const modEntries = entriesByMod.get(rel) || [];
  const primaryKind = modEntries[0]?.kind || 'module';
  const modObj = {
    id: `mod:${rel}`, path: rel, domainId: `dom:${domKey}`, domainKey: domKey,
    lane: classifyArchLane({ path: rel }, modEntries),
    kind: primaryKind, kindLabel: humanKindLabel(primaryKind),
    lang: rel.endsWith('.py') ? 'python' : 'js-ts',
    lines: src.split(/\r?\n/).length,
    humanTitle: modEntries[0]?.humanTitle || extractHumanTitleFromSource(rel, src),
    exports: graphData.exportsByFile.get(rel) || [],
    entrypoints: modEntries, isWild,
    isUnusedHint: modEntries.length === 0 && (inDegree.get(rel) || 0) === 0 && !/index\.|__init__\.|commands-|gates\.mjs/.test(rel),
    contractId: owner ? owner.id : null,
    contractTitle: cs?.title || owner?.title || null,
    vibeLabel: humanVerdict.vibeLabel, tone: humanVerdict.tone,
    vibeExplain: humanVerdict.vibeExplain, techSummary: humanVerdict.techSummary,
    touchedByBranches: branchesByFile.get(rel) || [], aiPrompt: ''
  };
  modObj.aiPrompt = buildAiPromptForModule(modObj);
  return modObj;
}

function asmAtlasRecordDomainModule(domainsMap, modObj) {
  const domKey = modObj.domainKey;
  if (!domainsMap.has(domKey)) {
    domainsMap.set(domKey, {
      id: `dom:${domKey}`, key: domKey, humanTitle: humanizeDomainTitle(domKey),
      moduleCount: 0, wildCount: 0, badCount: 0, warnCount: 0, okCount: 0,
      lanes: new Set(), activeBranches: new Set()
    });
  }
  const dm = domainsMap.get(domKey);
  dm.moduleCount++;
  dm.lanes.add(modObj.lane);
  if (modObj.tone === 'wild') dm.wildCount++;
  else if (modObj.tone === 'bad') dm.badCount++;
  else if (modObj.tone === 'warn') dm.warnCount++;
  else if (modObj.tone === 'ok') dm.okCount++;
  for (const bn of modObj.touchedByBranches) dm.activeBranches.add(bn);
}

function asmAtlasResolveDomainTone(d) {
  if (d.badCount > 0) return 'bad';
  if (d.warnCount > 0) return 'warn';
  if (d.wildCount === d.moduleCount) return 'wild';
  return d.okCount > 0 ? 'ok' : 'todo';
}

function asmAtlasResolvePrimaryLane(lanes) {
  for (const lane of ['ui', 'api', 'tool']) {
    if (lanes.has(lane)) return lane;
  }
  return 'core';
}

function asmAtlasEvalEdgeHealth(e, srcM, dstM, declaredPairs, hasActiveContracts) {
  if (e.kind === 'http-bridge') return 'bridge';
  if (srcM?.contractId && dstM?.contractId && srcM.contractId !== dstM.contractId) {
    return declaredPairs.has(`${srcM.contractId}->${dstM.contractId}`) ? 'solid' : 'red';
  }
  if (srcM?.isWild && dstM && !dstM.isWild && hasActiveContracts) return 'wild-call';
  return 'solid';
}

function asmAtlasEnrichEdges(edges, modules, activeContracts) {
  const modByPath = new Map(modules.map((m) => [m.path, m]));
  const declaredPairs = new Set();
  for (const c of activeContracts) {
    for (const dep of (c.dependsOn || [])) declaredPairs.add(`${c.id}->${dep}`);
  }
  return edges.map((e) => {
    const srcM = modByPath.get(e.from);
    const dstM = modByPath.get(e.to);
    return {
      from: `mod:${e.from}`, to: `mod:${e.to}`,
      fromTitle: srcM?.humanTitle || e.from, toTitle: dstM?.humanTitle || e.to,
      kind: e.kind, detail: e.detail,
      health: asmAtlasEvalEdgeHealth(e, srcM, dstM, declaredPairs, activeContracts.length > 0)
    };
  });
}

export function buildProjectAtlas(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const st = opts.statusData || computeProjectStatus(root);
  const intent = readMaybe(join(root, 'INTENT.md')) || '';
  const projectSummary = (intent.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('（')) || '').trim();
  const projectName = basename(root);

  const entryData = scanProjectEntries(root, walkSourceTree(root));
  const graphData = scanCrossLanguageGraph(root, entryData);
  const specs = scanSpecsAndBeads(root);
  const gitRadar = scanGitBranchRadar(root, { domainOfFile: inferDomainKey, staleDays: st.thresholds?.branchStaleDays || 14 });

  const idxCtx = asmAtlasIndexInputs(st, gitRadar, entryData, graphData);
  const domainsMap = new Map();
  const modules = [];
  for (const rel of entryData.sourceFiles) {
    const modObj = asmAtlasBuildModuleRecord(rel, idxCtx, entryData, graphData);
    modules.push(modObj);
    asmAtlasRecordDomainModule(domainsMap, modObj);
  }

  const domains = [...domainsMap.values()].map((d) => ({
    id: d.id, key: d.key, humanTitle: d.humanTitle, moduleCount: d.moduleCount, wildCount: d.wildCount,
    tone: asmAtlasResolveDomainTone(d), primaryLane: asmAtlasResolvePrimaryLane(d.lanes), activeBranches: [...d.activeBranches]
  }));

  const enrichedEdges = asmAtlasEnrichEdges(graphData.edges, modules, idxCtx.activeContracts);
  const domTitleByKey = new Map(domains.map((d) => [d.key, d.humanTitle]));
  const enrichedBranches = gitRadar.branches.map((b) => {
    const brObj = { ...b, humanDomains: b.touchedDomains.map((k) => domTitleByKey.get(k) || k) };
    brObj.aiPrompt = buildAiPromptForBranch(brObj);
    return brObj;
  });

  const governedCount = modules.filter((m) => !m.isWild).length;
  const baseAtlas = {
    schemaVersion: '1.1',
    generatedAt: new Date().toISOString(),
    project: {
      name: projectName,
      summary: projectSummary || `自动盘点 ${modules.length} 个代码模块与 ${entryData.entrypoints.length} 处功能入口`,
      stacks: entryData.stacks, totalPct: opts.totalPct ?? 0,
      moduleCount: modules.length, governedCount, wildCount: modules.length - governedCount,
      entrypointCount: entryData.entrypoints.length,
      livePort: 41200 + (parseInt(sha256(root).slice(0, 4), 16) % 7000)
    },
    ledger: st.ledger, humanStats: st.humanStats, domains,
    entrypoints: entryData.entrypoints.map((ep) => ({ ...ep, moduleId: `mod:${ep.modulePath}` })),
    modules, edges: enrichedEdges, branches: enrichedBranches, specs,
    contracts: st.contractSummaries || [], rawContracts: st.contracts || []
  };
  baseAtlas.workbench = hydrateWorkbenchData(root, baseAtlas);
  return baseAtlas;
}

export function renderLikeC4Model(atlas) {
  const safeId = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'n_$1');
  const lines = [
    '// 自动由 DoneGate Project Atlas 生成（可直接运行 npx likec4 serve .donegate 查看多层 C4 架构站）',
    'specification {', '  element domain', '  element module', '}', 'model {'
  ];
  for (const d of atlas.domains) {
    lines.push(`  ${safeId(d.id)} = domain '${d.humanTitle.replaceAll("'", "")}' {`);
    for (const m of atlas.modules.filter((x) => x.domainId === d.id)) {
      lines.push(`    ${safeId(m.id)} = module '${m.humanTitle.replaceAll("'", "")}' '${m.vibeLabel}'`);
    }
    lines.push('  }');
  }
  for (const e of atlas.edges) {
    lines.push(`  ${safeId(e.from)} -> ${safeId(e.to)} '${(e.detail || e.kind).replaceAll("'", "").slice(0, 40)}'`);
  }
  lines.push('}', 'views {', '  view index {', '    title "项目全局功能域视图"', '    include *', '  }', '}');
  return lines.join('\n') + '\n';
}

export function renderProjectMapMarkdown(atlas) {
  const L = [`# ${atlas.project.name} · 功能与支线全景地图`, ''];
  const groups = [
    ['网页界面', atlas.entrypoints.filter((e) => e.kind === 'web-page')],
    ['后台接口', atlas.entrypoints.filter((e) => ['fastapi-route', 'flask-route', 'node-api'].includes(e.kind))],
    ['命令行与自动工具', atlas.entrypoints.filter((e) => ['node-cli', 'py-cli', 'ai-skill'].includes(e.kind))]
  ];
  for (const [gName, list] of groups) {
    if (list.length === 0) continue;
    L.push(`## ${gName}（${list.length}）`);
    for (const item of list) L.push(`- **${item.humanTitle}**（\`${item.techLabel}\`）`);
    L.push('');
  }
  if (atlas.branches.length > 0) {
    L.push(`## 支线进度（${atlas.branches.length}）`);
    for (const b of atlas.branches) {
      L.push(`- **${b.name}**：${b.isDefault ? '主线基线' : `距主线 +${b.ahead}/-${b.behind}，停工 ${b.idleDays} 天`}`);
    }
  }
  return L.join('\n') + '\n';
}

export function writeAtlasSidecars(projectRoot, atlas) {
  const dgDir = join(projectRoot, '.donegate');
  if (!existsSync(dgDir)) mkdirSync(dgDir, { recursive: true });
  writeFileSync(join(dgDir, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n', 'utf8');
  writeFileSync(join(dgDir, 'PROJECT-MAP.md'), renderProjectMapMarkdown(atlas), 'utf8');
  writeFileSync(join(dgDir, 'project.c4'), renderLikeC4Model(atlas), 'utf8');
}
