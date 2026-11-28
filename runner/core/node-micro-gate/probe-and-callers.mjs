// 单卡微门禁伴生诊断器：ANTE 动作前预期转绿断言对撞、一跳上游调用方导出签名摘要与连败最小单点观测探针
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { walk } from '../../../skill/fs-walk.mjs';
import { extractFileInterfaceStub, maskCommentsAndStrings } from '../ast-stub.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from '../context-router.mjs';
import { extractFileFullstackWiring } from '../dom-wiring-graph/fullstack-edges.mjs';
import { resolvePythonImport } from '../python-imports.mjs';

const CALLER_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', '.deps', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports'];
const CODE_SCAN_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.py']);
const TEST_FILE_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$/i;
const JS_IMPORT_STMT_RE = /(?:import\s+(?:([\s\S]*?)\s+from\s+)?|export\s+(\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
const PY_FROM_IMPORT_RE = /^\s*from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+([^\n#]+)/gm;
const PY_PLAIN_IMPORT_RE = /^\s*import\s+([A-Za-z0-9_.,\s]+)/gm;
const MIN_PROBE_RETRY_STREAK = 1;

export function parseExpectedPassingIds(rawExpected) {
  if (!rawExpected) return [];
  const rawList = Array.isArray(rawExpected) ? rawExpected : String(rawExpected).split(',');
  return [...new Set(rawList.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function evaluateAnteExpectationCollision(rawExpected, cmdObs = [], passedObligations = []) {
  const expectedPassingIds = parseExpectedPassingIds(rawExpected);
  if (expectedPassingIds.length === 0) return null;
  const passedSet = new Set(passedObligations || []), knownSet = new Set((cmdObs || []).map((o) => o.id));
  const unmetExpectedIds = expectedPassingIds.filter((id) => !passedSet.has(id));
  const unknownExpectedIds = expectedPassingIds.filter((id) => !knownSet.has(id));
  const unexpectedPassingIds = (passedObligations || []).filter((id) => !expectedPassingIds.includes(id));
  const collision = unmetExpectedIds.length > 0;
  const summary = collision
    ? `ANTE 预期锚定对撞失配：预期转绿 [${expectedPassingIds.join(', ')}]，未达标 [${unmetExpectedIds.join(', ')}]，实测通过 [${[...passedSet].join(', ') || '无'}]`
    : `ANTE 预期锚定吻合：预期转绿 [${expectedPassingIds.join(', ')}] 全部实测通过`;
  return { expectedPassingIds, actualPassingIds: [...passedSet], unmetExpectedIds, unknownExpectedIds, unexpectedPassingIds, collision, summary };
}

function pacResolveJsImportTarget(fromRel, rawSpec, repoFileSet) {
  if (!rawSpec || !rawSpec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromRel), rawSpec.split(/[?#]/)[0])).replace(/\\/g, '/');
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}/index.mjs`, `${base}/index.js`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((cand) => repoFileSet.has(cand)) || null;
}

function pacParseJsNamedClause(rawClause) {
  const clause = String(rawClause || '').trim();
  if (!clause) return [];
  const braceMatch = clause.match(/\{([^}]*)\}/), symbols = [];
  const defaultPart = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  if (defaultPart && !defaultPart.startsWith('*')) symbols.push(defaultPart);
  if (!braceMatch) return symbols;
  for (const part of braceMatch[1].split(',')) {
    const clean = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (clean) symbols.push(clean);
  }
  return symbols;
}

function pacScanJsImportsToSeeds(fromRel, source, repoFileSet, targetSet) {
  const masked = maskCommentsAndStrings(source, extname(fromRel).toLowerCase() || '.mjs');
  const matchedTargets = new Set(), importedSymbols = new Set();
  for (const m of source.matchAll(JS_IMPORT_STMT_RE)) {
    if (masked[m.index] === ' ') continue;
    const dst = pacResolveJsImportTarget(fromRel, m[3], repoFileSet);
    if (!dst || !targetSet.has(dst)) continue;
    matchedTargets.add(dst);
    for (const sym of pacParseJsNamedClause(m[1] || m[2] || '')) importedSymbols.add(sym);
  }
  return { matchedTargets: [...matchedTargets], importedSymbols: [...importedSymbols] };
}

function pacScanPyPlainModules(fromRel, source, repoFileSet, targetSet, matchedTargets) {
  for (const m of source.matchAll(PY_PLAIN_IMPORT_RE)) {
    for (const part of m[1].split(',')) {
      const dst = resolvePythonImport(fromRel, part.trim().split(/\s+as\s+/)[0].trim(), 0, repoFileSet);
      if (dst && targetSet.has(dst)) matchedTargets.add(dst);
    }
  }
}

function pacScanPyImportsToSeeds(fromRel, source, repoFileSet, targetSet) {
  const matchedTargets = new Set(), importedSymbols = new Set();
  for (const m of source.matchAll(PY_FROM_IMPORT_RE)) {
    const dst = resolvePythonImport(fromRel, m[2] || '', m[1].length, repoFileSet);
    if (!dst || !targetSet.has(dst)) continue;
    matchedTargets.add(dst);
    for (const part of String(m[3] || '').split(',')) {
      const sym = part.trim().split(/\s+as\s+/)[0].trim();
      if (sym && sym !== '*') importedSymbols.add(sym);
    }
  }
  pacScanPyPlainModules(fromRel, source, repoFileSet, targetSet, matchedTargets);
  return { matchedTargets: [...matchedTargets], importedSymbols: [...importedSymbols] };
}

function pacCollectSeedRouteSet(projectRoot, seedFiles) {
  const routes = new Set();
  for (const rel of seedFiles) {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) continue;
    try {
      for (const r of extractFileFullstackWiring(readFileSync(abs, 'utf8'), rel).apiRoutes) routes.add(r);
    } catch (err) { void err; }
  }
  return routes;
}

function pacCollectRepoProdFiles(projectRoot) {
  const files = [];
  for (const abs of walk(resolve(projectRoot), { skipDirs: CALLER_SKIP_DIRS }).files) {
    const rel = relative(projectRoot, abs).replace(/\\/g, '/');
    if (CODE_SCAN_EXTS.has(extname(rel).toLowerCase()) && !TEST_FILE_RE.test(rel)) files.push(rel);
  }
  return files.sort();
}

function pacExtractCallerSignatures(source, relPath) {
  const sigs = extractFileInterfaceStub(source, relPath).exports.filter((ex) => ex.signature && !ex.symbol.startsWith('reexport:')).map((ex) => ex.signature);
  if (sigs.length > 0) return sigs;
  const fallback = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/gm)].map((m) => `function ${m[1]}(${m[2].trim()});`);
  return fallback.length > 0 ? fallback : [`// [entry-caller: ${relPath}]`];
}

function pacFindOwnerContractId(relPath, graphNodes) {
  const hit = (graphNodes || []).find((node) => fileBelongsToScopes(relPath, node.scope || []));
  return hit ? hit.id : null;
}

function pacInspectCandidateCaller(projectRoot, candRel, ctx) {
  let source = '';
  try { source = readFileSync(join(projectRoot, candRel), 'utf8'); } catch (err) { void err; return null; }
  const imp = candRel.endsWith('.py') ? pacScanPyImportsToSeeds(candRel, source, ctx.repoFileSet, ctx.targetSet) : pacScanJsImportsToSeeds(candRel, source, ctx.repoFileSet, ctx.targetSet);
  const routeHits = (ctx.seedRoutes.size > 0 && !candRel.endsWith('.py'))
    ? extractFileFullstackWiring(source, candRel).apiRoutes.filter((rt) => ctx.seedRoutes.has(rt))
    : [];
  if (imp.matchedTargets.length === 0 && routeHits.length === 0) return null;
  return {
    file: candRel, contractId: pacFindOwnerContractId(candRel, ctx.graphNodes), targetFiles: imp.matchedTargets,
    coupledRoutes: routeHits, importedSymbols: imp.importedSymbols, signatures: pacExtractCallerSignatures(source, candRel)
  };
}

function pacBuildTargetSeedSet(contract, currentStub, touchedProd) {
  const seedFiles = touchedProd.length > 0 ? touchedProd : (currentStub?.scopeFiles || []);
  const targetSet = new Set(seedFiles);
  if (touchedProd.length > 0) {
    for (const f of currentStub?.facadeFiles || []) {
      if (fileBelongsToScopes(f, contract?.scope || [])) targetSet.add(f);
    }
  }
  return { seedFiles, seedSet: new Set(seedFiles), targetSet };
}

export function collectOneHopCallerSignatures(projectRoot, contract, currentStub, touchedFiles = []) {
  const repoProdFiles = pacCollectRepoProdFiles(projectRoot), repoFileSet = new Set(repoProdFiles);
  const touchedProd = (touchedFiles || []).filter((f) => repoFileSet.has(f));
  const { seedFiles, seedSet, targetSet } = pacBuildTargetSeedSet(contract, currentStub, touchedProd);
  if (seedFiles.length === 0) return { callers: [], summary: '' };
  const graph = discoverHermeticGraph(projectRoot);
  const ctx = { repoFileSet, targetSet, seedRoutes: pacCollectSeedRouteSet(projectRoot, seedFiles), graphNodes: graph.ok ? graph.nodes : [] };
  const callers = [];
  for (const candRel of repoProdFiles) {
    if (!seedSet.has(candRel)) {
      const hit = pacInspectCandidateCaller(projectRoot, candRel, ctx);
      if (hit) callers.push(hit);
    }
  }
  const summary = callers.map((c) => `${c.file}${c.importedSymbols.length ? ` [imports: ${c.importedSymbols.join(', ')}]` : ''} -> ${c.signatures.join(' | ')}`).join('\n');
  return { callers, summary };
}

function pacBuildProbeCommand(rawCommand) {
  const cmd = String(rawCommand || '').trim();
  if (!cmd) return '';
  if (/\bvitest\b/.test(cmd) && !/--reporter/.test(cmd)) return `${cmd} --reporter=verbose --bail=1`;
  if (/\bpytest\b/.test(cmd) && !/-vv\b/.test(cmd)) return `${cmd} -vv --tb=short -x`;
  return /^node\s+(?!--trace-uncaught\b)/.test(cmd) ? cmd.replace(/^node\s+/, 'node --trace-uncaught ') : cmd;
}

export function buildMinimalObservationProbe(retryStreak, failedObligations = [], touchedFiles = []) {
  if (Number(retryStreak || 0) < MIN_PROBE_RETRY_STREAK || !Array.isArray(failedObligations) || failedObligations.length === 0) return null;
  const firstFailed = failedObligations[0], probeCommand = pacBuildProbeCommand(firstFailed.command);
  return {
    retryStreak: Number(retryStreak), failedObligationId: firstFailed.id, failedCommand: firstFailed.command, touchedFiles: touchedFiles || [], probeCommand,
    guidance: `连续失败第 ${retryStreak} 轮：请先零侵入运行单点观测探针 \`${probeCommand}\` 核实真实运行态输出，并在下轮携带 expectedPassingIds 预期锚定后再修改业务源码`
  };
}

export function attachFailureContextAndProbe(projectRoot, contract, currentStub, gitState, failedObligations, receipt) {
  if (!receipt || receipt.exitCode === 0) return;
  const callerInfo = collectOneHopCallerSignatures(projectRoot, contract, currentStub, gitState?.touchedFiles || []);
  if (callerInfo.callers.length > 0) {
    receipt.callerSignatures = callerInfo.callers;
    receipt.callerSignatureSummary = callerInfo.summary;
  }
  const probe = buildMinimalObservationProbe(receipt.retryStreak, failedObligations, gitState?.touchedFiles || []);
  if (probe) receipt.observationProbe = probe;
}
