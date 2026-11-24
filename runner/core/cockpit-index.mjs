// 零魔法数字主控三级按需变焦索引器（画布双生拓扑 × 作用域 ADR 挂载 × 代码真源实时抽取，<= 350 行）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadHygieneBudgets } from '../../skill/commit-hygiene-metrics.mjs';
import { walk } from '../../skill/fs-walk.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { ATLAS_SUBPACKS, buildProjectAtlas } from '../atlas/contract.mjs';
import { extractHttpRouteContracts } from './barrel-stub-enrich.mjs';
import { collectGapsList } from './cmd-inspect.mjs';
import { buildSingleFileOutline, extractFullHeaderComment } from './cockpit-file-outline.mjs';
import { computeContractKneedleHubs, kneedleElbowCount } from './cockpit-hubs.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from './context-router.mjs';
import { computeProjectStatus } from './gates.mjs';

export { kneedleElbowCount };

const CK_SCAN_DIRS = ['runner', 'skill', 'workflows', 'bricks', 'tools'];
const CK_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const CK_ROOT_CFGS = ['thresholds.json', 'adapters.registry.json', 'ledger.json', 'batches.jsonl', 'package.json'];

const CK_ADR_KEYWORD_HINTS = [
  { test: (r) => r.includes('runner/dsh') || r.includes('DeepSeek-Harness'), dom: '02', cid: 'dsh-orchestrator' },
  { test: (r) => r.includes('runner/atlas') || r.includes('Louvain'), dom: '03', cid: null },
  { test: (r) => r.includes('runner/core'), dom: '04', cid: 'verdict-core' },
  { test: (r) => r.includes('skill/adapters'), dom: '05', cid: 'masonry-adapters' },
  { test: (r) => r.includes('wiring-baseline') || r.includes('capabilities.json') || r.includes('advisory'), dom: '05', cid: 'brick-observations' }
];

function ckRegisterPathOwners(rel, graphNodes, allFiles, fileOwners) {
  allFiles.add(rel);
  if (!fileOwners.has(rel)) fileOwners.set(rel, []);
  const owners = graphNodes.filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
  const existing = fileOwners.get(rel);
  for (const ow of owners) {
    if (!existing.includes(ow)) existing.push(ow);
  }
}

function ckCollectProjectFileOwners(root, graphNodes) {
  const allFiles = new Set();
  const fileOwners = new Map();
  for (const n of graphNodes) {
    for (const sf of n.stub?.scopeFiles || []) ckRegisterPathOwners(sf, graphNodes, allFiles, fileOwners);
  }
  for (const d of CK_SCAN_DIRS) {
    const absD = join(root, d);
    if (!existsSync(absD)) continue;
    for (const absF of walk(absD, { skipDirs: CK_SKIP_DIRS }).files) {
      ckRegisterPathOwners(absF.slice(root.length + 1).replace(/\\/g, '/'), graphNodes, allFiles, fileOwners);
    }
  }
  for (const cfg of CK_ROOT_CFGS) {
    if (existsSync(join(root, cfg))) ckRegisterPathOwners(cfg, graphNodes, allFiles, fileOwners);
  }
  return { allFiles, fileOwners };
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
  return {
    file: f, domains, contracts,
    chosenDigest: pick('选了哪个'), whyDigest: pick('为什么'), reopenDigest: pick('什么条件下翻案'), content: raw
  };
}

function ckCollectMountedDecisions(root, graphNodes, hsNodes) {
  const adrDir = join(root, 'decisions');
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => ckParseSingleAdrRecord(adrDir, f, graphNodes, hsNodes));
}

function ckCollectTestSummaries(root) {
  const testSummaries = [];
  const testsDir = join(root, 'tests');
  const fromDir = existsSync(testsDir) ? walk(testsDir).files.sort().map((absT) => absT.slice(root.length + 1).replace(/\\/g, '/')) : [];
  for (const rel of [...fromDir, 'runner/self-test.mjs', 'runner/dsh-fixtures.mjs', 'runner/atlas-fixtures.mjs']) {
    if (!/\.(?:mjs|js|ts)$/.test(rel) || !existsSync(join(root, rel))) continue;
    const raw = readFileSync(join(root, rel), 'utf8');
    const cases = [...raw.matchAll(/\b(?:describe|test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]).slice(0, 10);
    testSummaries.push({ file: rel, header: extractFullHeaderComment(raw), cases });
  }
  return testSummaries;
}

function ckExtractLiveRulesAndTests(root, allFiles, fileOwners, fileOutlines) {
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
    archetypes,
    newAdapterHeader: extractFullHeaderComment(newAdpRaw),
    declarationProtocolConsts: fileOutlines['skill/check-declarations.mjs']?.constantsPreview || [],
    workflows,
    annotatedSubpacks,
    sharedPoolLayout: {
      rootDir: 'workflows/.deps/_shared/', binDir: 'workflows/.deps/_shared/.bin/', distsDir: 'workflows/.deps/_shared/dists/',
      npmBinDir: 'workflows/.deps/_shared/npm/node_modules/.bin/', npmCellsDir: 'workflows/.deps/_shared/npm-cells/<id>/',
      venvDir: 'workflows/.deps/_shared/venv/', installerCli: 'workflows/.deps/_shared/dg-deps-cli.mjs', manifestPath: 'workflows/.deps/_shared/manifest.json'
    },
    testSummaries: ckCollectTestSummaries(root)
  };
}

function ckAppendRouteEntry(routesByFile, r) {
  if (!r.file) return;
  if (!routesByFile.has(r.file)) routesByFile.set(r.file, []);
  const label = `${r.method || 'API'} ${r.path || r}`;
  if (!routesByFile.get(r.file).includes(label)) routesByFile.get(r.file).push(label);
}

function ckCollectUncoveredCodeFiles(root, allFiles, covered) {
  const uncovRaw = new Map();
  for (const f of allFiles) {
    if (!covered.has(f) && /\.(?:mjs|cjs|js|ts)$/.test(f)) uncovRaw.set(f, readMaybe(join(root, f)) || '');
  }
  return uncovRaw;
}

function ckBuildRoutesByFile(root, graphNodes, allFiles) {
  const routesByFile = new Map();
  const covered = new Set();
  for (const n of graphNodes || []) {
    for (const sf of n.stub?.scopeFiles || []) covered.add(sf);
    for (const r of n.stub?.httpRoutes || []) ckAppendRouteEntry(routesByFile, r);
  }
  const uncovRaw = ckCollectUncoveredCodeFiles(root, allFiles, covered);
  for (const r of extractHttpRouteContracts(uncovRaw)) ckAppendRouteEntry(routesByFile, r);
  return routesByFile;
}

function ckEstimateRepoSourceTokens(root, allFiles) {
  let bytes = 0;
  for (const f of allFiles) {
    if (!/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(f)) continue;
    try { bytes += statSync(join(root, f)).size; } catch { /* ignore */ }
  }
  return Math.ceil(bytes / 4);
}

function ckEnrichDomainTree(nodes, fileOutlines, fileOwners) {
  return (nodes || []).map((nd) => ({
    ...nd,
    subgraph: nd.subgraph ? { ...nd.subgraph, nodes: ckEnrichDomainTree(nd.subgraph.nodes, fileOutlines, fileOwners) } : undefined,
    modules: (nd.modules || []).map((m) => ({
      ...m, fullHeader: fileOutlines[m.path]?.header || m.name, ownerContracts: (fileOwners.get(m.path) || []).filter(Boolean)
    }))
  }));
}

export function buildCockpitGraphIndex(projectRoot) {
  const root = resolve(projectRoot);
  const atlas = buildProjectAtlas(root);
  const graph = discoverHermeticGraph(root);
  const status = computeProjectStatus(root);
  const gaps = collectGapsList(root, status);
  const hsNodes = atlas.workbench?.hostSandbox?.nodes || [];
  const gNodes = graph.nodes || [];
  const { allFiles, fileOwners } = ckCollectProjectFileOwners(root, gNodes);
  const routesByFile = ckBuildRoutesByFile(root, gNodes, allFiles);

  const fileOutlines = {};
  for (const f of [...allFiles].sort()) {
    const out = buildSingleFileOutline(root, f, fileOwners.get(f) || [], routesByFile.get(f) || []);
    if (out) fileOutlines[f] = out;
  }
  const intentRaw = readMaybe(join(root, 'INTENT.md')) || '';
  const constraintsRaw = readMaybe(join(root, 'CONSTRAINTS.md')) || '';
  const gitOut = spawnSync('git', ['-C', root, 'log', '-1', '--format=%h (%cs) %s'], { encoding: 'utf8' }).stdout;

  return {
    root, atlas, graph, status, gaps,
    gitHead: (gitOut || '').trim() || 'uncommitted',
    hasDecisionsDir: existsSync(join(root, 'decisions')),
    intentHash: intentRaw ? sha256(intentRaw).slice(0, 12) : '—',
    constraintsHash: constraintsRaw ? sha256(constraintsRaw).slice(0, 12) : '—',
    intentText: intentRaw, constraintsText: constraintsRaw,
    thresholds: loadHygieneBudgets(root),
    fallbackSourceTokens: ckEstimateRepoSourceTokens(root, allFiles),
    domains: ckEnrichDomainTree(hsNodes, fileOutlines, fileOwners),
    adrs: ckCollectMountedDecisions(root, gNodes, hsNodes),
    hubs: computeContractKneedleHubs(root, gNodes, allFiles, fileOwners, hsNodes, fileOutlines),
    liveMeta: ckExtractLiveRulesAndTests(root, allFiles, fileOwners, fileOutlines),
    fileOutlines
  };
}
