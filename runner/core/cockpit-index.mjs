// 极薄契约、业务域与五段式 ADR 路径索引器（零手写代码解析器，代码图谱与枢纽全权委托 CBM 开源底座，<= 350 行）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadHygieneBudgets } from '../../skill/commit-hygiene-metrics.mjs';
import { walk } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { ATLAS_SUBPACKS, buildProjectAtlas } from '../atlas/contract.mjs';
import { collectGapsList } from './cmd-inspect.mjs';
import { CK_SKIP_DIRS, listRootRegularFiles, runWithSingleflightCache } from './cockpit-cache.mjs';
import { kneedleElbowCount, queryCbmContractHubs } from './cockpit-cbm.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from './context-router.mjs';
import { computeProjectStatus } from './gates.mjs';

export { kneedleElbowCount };

const CK_ADR_KEYWORD_HINTS = [
  { test: (r) => r.includes('runner/dsh') || r.includes('DeepSeek-Harness'), dom: '02', cid: 'dsh-orchestrator' },
  { test: (r) => r.includes('runner/atlas') || r.includes('Louvain'), dom: '03', cid: null },
  { test: (r) => r.includes('runner/core'), dom: '04', cid: 'verdict-core' },
  { test: (r) => r.includes('skill/adapters'), dom: '05', cid: 'masonry-adapters' },
  { test: (r) => r.includes('wiring-baseline') || r.includes('capabilities.json') || r.includes('advisory'), dom: '05', cid: 'brick-observations' }
];

export function extractFullHeaderComment(raw) {
  const comments = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#!')) continue;
    if (t.startsWith('//')) comments.push(t.replace(/^\/\/+\s*/, '').trim());
    else if (comments.length > 0 || t !== '') break;
  }
  return comments.join(' ').trim();
}

function ckRegisterPathOwners(rel, graphNodes, allFiles, fileOwners) {
  allFiles.add(rel);
  if (!fileOwners.has(rel)) fileOwners.set(rel, []);
  const owners = graphNodes.filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
  const existing = fileOwners.get(rel);
  for (const ow of owners) {
    if (!existing.includes(ow)) existing.push(ow);
  }
}

function ckCollectHsNodeModulePaths(nodes, out) {
  for (const nd of nodes || []) {
    for (const m of nd.modules || []) {
      if (m.path) out.push(m.path);
    }
    if (nd.subgraph?.nodes) ckCollectHsNodeModulePaths(nd.subgraph.nodes, out);
  }
}

function ckCollectProjectFileOwners(root, graphNodes, hsNodes) {
  const allFiles = new Set(), fileOwners = new Map();
  for (const n of graphNodes) {
    for (const sf of n.stub?.scopeFiles || []) ckRegisterPathOwners(sf, graphNodes, allFiles, fileOwners);
  }
  for (const d of ['runner', 'skill', 'workflows', 'bricks', 'tools']) {
    const absD = join(root, d);
    if (!existsSync(absD)) continue;
    for (const absF of walk(absD, { skipDirs: CK_SKIP_DIRS }).files) {
      ckRegisterPathOwners(absF.slice(root.length + 1).replace(/\\/g, '/'), graphNodes, allFiles, fileOwners);
    }
  }
  for (const cfg of listRootRegularFiles(root)) ckRegisterPathOwners(cfg, graphNodes, allFiles, fileOwners);
  const hooksDir = join(root, '.githooks');
  if (existsSync(hooksDir)) {
    for (const hf of readdirSync(hooksDir)) {
      if (statSync(join(hooksDir, hf)).isFile()) ckRegisterPathOwners(`.githooks/${hf}`, graphNodes, allFiles, fileOwners);
    }
  }
  const hsPaths = [];
  ckCollectHsNodeModulePaths(hsNodes, hsPaths);
  for (const hp of hsPaths) {
    if (existsSync(join(root, hp))) ckRegisterPathOwners(hp, graphNodes, allFiles, fileOwners);
  }
  return { allFiles, fileOwners };
}

function ckBuildDomainOwnerMap(hsNodes) {
  const ownerMap = new Map(), groupIds = [];
  for (const sn of hsNodes || []) {
    const paths = [];
    ckCollectHsNodeModulePaths([sn], paths);
    groupIds.push(sn.step);
    for (const p of paths) ownerMap.set(p, [sn.step]);
  }
  return { ownerMap, groupIds };
}

function ckFirstProposition(linesArr) {
  const cleaned = (linesArr || [])
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('```') && !l.startsWith('|'))
    .map((l) => l.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''));
  if (cleaned.length === 0) return '—';
  const head = /[：:]$/.test(cleaned[0]) && cleaned[1] ? `${cleaned[0].replace(/[：:]$/, '')}：${cleaned[1]}` : cleaned[0];
  const stripped = head.replace(/^选\s*(?:方案\s*)?[A-Z]\s*[：:，,·]?\s*/i, '');
  const m = stripped.match(/^(.+?[。；])/);
  return (m ? m[1] : stripped).replace(/[。；]+$/, '').trim();
}

function ckCollectAdrPathContracts(raw, graphNodes, matchedContracts) {
  const pathRe = /`((?:runner|skill|contracts|bricks|workflows|donegate-forge)\/[A-Za-z0-9_./*-]*)`|`(adapters\.registry\.json)`/g;
  for (const pm of raw.matchAll(pathRe)) {
    const p = (pm[1] || pm[2]).replace(/\*+$/, '');
    for (const n of graphNodes) {
      const scopes = n.scope || [];
      if (fileBelongsToScopes(p, scopes) || scopes.some((s) => s.startsWith(p) || p.startsWith(s))) matchedContracts.add(n.id);
    }
  }
}

function ckMatchAdrScopes(raw, graphNodes, hsNodes) {
  const matchedDomains = new Set();
  const matchedContracts = new Set(graphNodes.filter((n) => raw.includes(n.id)).map((n) => n.id));
  ckCollectAdrPathContracts(raw, graphNodes, matchedContracts);
  for (const sn of hsNodes) {
    if ((sn.contractIds || []).some((cid) => matchedContracts.has(cid))) matchedDomains.add(sn.step);
  }
  for (const h of CK_ADR_KEYWORD_HINTS) {
    if (!h.test(raw)) continue;
    matchedDomains.add(h.dom);
    if (h.cid) matchedContracts.add(h.cid);
  }
  if (matchedDomains.size === 0 || raw.includes('INTENT.md') || raw.includes('CHANGELOG.md')) matchedDomains.add('01');
  return { domains: [...matchedDomains].sort(), contracts: [...matchedContracts].sort() };
}

function ckParseSingleAdrRecord(adrDir, f, graphNodes, hsNodes) {
  const raw = readFileSync(join(adrDir, f), 'utf8');
  const { domains, contracts } = ckMatchAdrScopes(raw, graphNodes, hsNodes);
  const secs = {};
  let cur = '';
  for (const line of raw.split(/\r?\n/)) {
    const hm = line.match(/^#{2,3}\s*(.+)$/);
    if (hm) { cur = hm[1].trim(); secs[cur] = []; }
    else if (cur) secs[cur].push(line);
  }
  const pick = (kw) => {
    const k = Object.keys(secs).find((h) => h.includes(kw));
    return k ? ckFirstProposition(secs[k]) : '—';
  };
  return { file: f, domains, contracts, chosenDigest: pick('选了哪个'), whyDigest: pick('为什么'), reopenDigest: pick('什么条件下翻案'), content: raw };
}

function ckCollectMountedDecisions(root, graphNodes, hsNodes) {
  const adrDir = join(root, 'decisions');
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir).filter((f) => f.endsWith('.md')).sort().map((f) => ckParseSingleAdrRecord(adrDir, f, graphNodes, hsNodes));
}

function ckCollectTestSummaries(root) {
  const testSummaries = [];
  const testsDir = join(root, 'tests');
  const fromDir = existsSync(testsDir) ? walk(testsDir).files.sort().map((absT) => absT.slice(root.length + 1).replace(/\\/g, '/')) : [];
  for (const rel of [...fromDir, 'runner/self-test.mjs', 'runner/dsh-fixtures.mjs', 'runner/atlas-fixtures.mjs']) {
    if (!/\.(?:mjs|js|ts)$/.test(rel) || !existsSync(join(root, rel))) continue;
    const raw = readFileSync(join(root, rel), 'utf8');
    const cases = [...raw.matchAll(/\b(?:describe|test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]).slice(0, 10);
    const header = extractFullHeaderComment(raw) || cases[0] || '自动化单元测试套件';
    testSummaries.push({ file: rel, header, cases });
  }
  return testSummaries;
}

function ckExtractLiveRulesAndTests(root, allFiles, fileOwners) {
  const newAdpRaw = readMaybe(join(root, 'skill/new-adapter.mjs')) || '';
  const archMatch = newAdpRaw.match(/ARCHETYPES\s*=\s*\[([^\]]+)\]/);
  const archetypes = archMatch ? [...archMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];
  const workflows = [...allFiles].filter((f) => f.endsWith('.workflow.json')).sort().map((f) => {
    const doc = readJsonStrict(join(root, f)).value || {};
    return { file: f, id: doc.id, name: doc.name || doc.title, nodeCount: (doc.nodes || []).length, deps: (doc.deps || []).map((d) => d.id) };
  });
  const annotatedSubpacks = {};
  for (const [spKey, files] of Object.entries(ATLAS_SUBPACKS)) {
    annotatedSubpacks[spKey] = files.map((f) => ({ file: f, contractOwner: (fileOwners.get(f) || []).filter(Boolean).join(',') || '未归属' }));
  }
  return {
    archetypes, newAdapterHeader: extractFullHeaderComment(newAdpRaw),
    workflows, annotatedSubpacks,
    sharedPoolLayout: {
      rootDir: 'workflows/.deps/_shared/', binDir: 'workflows/.deps/_shared/.bin/', distsDir: 'workflows/.deps/_shared/dists/',
      npmBinDir: 'workflows/.deps/_shared/npm/node_modules/.bin/', npmCellsDir: 'workflows/.deps/_shared/npm-cells/<id>/',
      venvDir: 'workflows/.deps/_shared/venv/', installerCli: 'workflows/.deps/_shared/dg-deps-cli.mjs', manifestPath: 'workflows/.deps/_shared/manifest.json'
    },
    testSummaries: ckCollectTestSummaries(root)
  };
}

function ckCollectFileHeaders(root, allFiles) {
  const headers = {};
  for (const f of [...allFiles].sort()) {
    const raw = readMaybe(join(root, f));
    if (raw === null) continue;
    const h = extractFullHeaderComment(raw);
    headers[f] = h || (f.endsWith('.json') ? 'JSON 声明式配置/台账文件' : f.endsWith('.cmd') ? 'Windows 批处理脚本' : '源码模块');
  }
  return headers;
}

function ckEstimateRepoSourceTokens(root, allFiles) {
  let bytes = 0;
  for (const f of allFiles) {
    if (!/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(f)) continue;
    try { bytes += statSync(join(root, f)).size; } catch { /* ignore */ }
  }
  return Math.ceil(bytes / 4);
}

function ckEnrichDomainTree(nodes, fileHeaders, fileOwners, hasIntentFile) {
  return (nodes || []).map((nd) => ({
    ...nd,
    subgraph: nd.subgraph ? { ...nd.subgraph, nodes: ckEnrichDomainTree(nd.subgraph.nodes, fileHeaders, fileOwners, hasIntentFile) } : undefined,
    modules: (nd.modules || []).map((m) => {
      const isVirtualIntent = m.path === 'INTENT.md' && !hasIntentFile;
      const fullHeader = isVirtualIntent ? `${m.name}（画布虚拟立约起点，执行 donegate init 后生成实体 INTENT.md）` : (fileHeaders[m.path] || m.name);
      return { ...m, fullHeader, ownerContracts: (fileOwners.get(m.path) || []).filter(Boolean) };
    })
  }));
}

function ckSlimGraphProjection(graph) {
  return {
    topoOrder: graph.topoOrder || [],
    sccCycles: graph.sccCycles || [],
    nodes: (graph.nodes || []).map((n) => ({
      id: n.id, title: n.title, why: n.why, scope: n.scope,
      declaredDependsOn: n.declaredDependsOn, dependsOnIds: n.dependsOnIds, dependedByIds: n.dependedByIds,
      obligations: n.obligations,
      stub: n.stub ? {
        sourceTokens: n.stub.sourceTokens || 0, stubTokens: n.stub.stubTokens || 0,
        scopeFiles: n.stub.scopeFiles || [],
        stubText: n.stub.stubText || '', httpRoutes: n.stub.httpRoutes || []
      } : null
    }))
  };
}

function ckComputeFullIndex(root) {
  const gitHead = (spawnSync('git', ['-C', root, 'log', '-1', '--format=%h (%cs) %s'], { encoding: 'utf8' }).stdout || '').trim() || 'uncommitted';
  const atlas = buildProjectAtlas(root);
  const graph = discoverHermeticGraph(root);
  const gaps = collectGapsList(root, computeProjectStatus(root));
  const hsNodes = atlas.workbench?.hostSandbox?.nodes || [];
  const gNodes = graph.nodes || [];
  const { allFiles, fileOwners } = ckCollectProjectFileOwners(root, gNodes, hsNodes);
  const fileHeaders = ckCollectFileHeaders(root, allFiles);
  const isZeroContract = gNodes.length === 0;
  const hubInput = isZeroContract ? ckBuildDomainOwnerMap(hsNodes) : { ownerMap: fileOwners, groupIds: gNodes.map((n) => n.id) };
  const hasIntentFile = existsSync(join(root, 'INTENT.md'));
  const intentRaw = readMaybe(join(root, 'INTENT.md')) || '', constraintsRaw = readMaybe(join(root, 'CONSTRAINTS.md')) || '';
  return {
    root,
    atlas: { project: atlas.project || { name: 'project', moduleCount: 0 }, branches: atlas.branches || [] },
    graph: ckSlimGraphProjection(graph),
    gaps, gitHead,
    hasDecisionsDir: existsSync(join(root, 'decisions')),
    hasThresholdsFile: existsSync(join(root, 'thresholds.json')),
    intentHash: intentRaw ? sha256(intentRaw).slice(0, 12) : '未初始化（零契约模式）',
    constraintsHash: constraintsRaw ? sha256(constraintsRaw).slice(0, 12) : '未初始化（零契约模式）',
    intentText: intentRaw, constraintsText: constraintsRaw,
    thresholds: loadHygieneBudgets(root),
    fallbackSourceTokens: ckEstimateRepoSourceTokens(root, allFiles),
    domains: ckEnrichDomainTree(hsNodes, fileHeaders, fileOwners, hasIntentFile),
    adrs: ckCollectMountedDecisions(root, gNodes, hsNodes),
    hubs: queryCbmContractHubs(root, hubInput.ownerMap, hubInput.groupIds, isZeroContract),
    liveMeta: ckExtractLiveRulesAndTests(root, allFiles, fileOwners),
    fileHeaders
  };
}

export function buildCockpitGraphIndex(projectRoot) {
  const root = resolve(projectRoot);
  return runWithSingleflightCache(root, '', () => ckComputeFullIndex(root));
}
