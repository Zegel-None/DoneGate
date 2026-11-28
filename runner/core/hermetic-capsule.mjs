// L1 密封施工胶囊打包器（1M×40%=400k 预算 · 隐式 DOM 耦合闭包 · Louvain 分片建议 · 双指标 TOC，<= 350 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { UNTRUSTED_SYSTEM_CLAUSE, buildUntrustedEnvelopeSection, makeUntrustedNonce, wrapUntrustedBlock } from '../shared/untrusted-envelope.mjs';
import { extractFileInterfaceStub, maskCommentsAndStrings } from './ast-stub.mjs';
import { extractPythonImportTargets } from './python-imports.mjs';
import { inspectCrossCardFocusPatterns, writeProjectRouter } from './context-router.mjs';
import { buildDomWiringGraph, computeFileLineMetrics, formatDomWiringStubComment, resolveSubpackFocusPatterns } from './dom-wiring-graph.mjs';
import { adviseCapsuleModularitySplit } from './capsule-shard-advisor.mjs';
import { assembleDynamicBodyWithToc, hcapBuildCapsulePayload, hcapBuildStaticPrefixLines } from './capsule-markdown.mjs';

const HCAP_GENERIC_STEMS = new Set(['index', 'contract', 'main', 'types', 'utils', '_shared']);
const HCAP_IMPORT_RE = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

export function frozenStubPathOf(projectRoot, nodeId) { return join(projectRoot, '.donegate', 'stubs', `${nodeId}.frozen.json`); }

export function freezeNodeStubBaseline(projectRoot, nodeId, stubInfo) {
  const p = frozenStubPathOf(projectRoot, nodeId);
  mkdirSync(dirname(p), { recursive: true });
  const payload = { nodeId, stubHash: stubInfo.stubHash, facadeMode: stubInfo.facadeMode, exportedSymbols: stubInfo.exportedSymbols, frozenAt: new Date().toISOString() };
  writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function diffAgainstFrozenStub(projectRoot, nodeId, currentStub) {
  const p = frozenStubPathOf(projectRoot, nodeId);
  if (!existsSync(p)) return { hasFrozenBaseline: false, stubChanged: false, breakingChanges: [], addedExports: [] };
  const r = readJsonStrict(p);
  if (!r.ok || !r.value) return { hasFrozenBaseline: true, stubChanged: true, breakingChanges: ['冻结存根基线 JSON 损坏'], addedExports: [] };
  const prevMap = new Map((r.value.exportedSymbols || []).map((s) => [`${s.file}::${s.symbol}`, s.signature]));
  const currMap = new Map((currentStub.exportedSymbols || []).map((s) => [`${s.file}::${s.symbol}`, s.signature]));
  const breakingChanges = [], addedExports = [];
  for (const [key, prevSig] of prevMap.entries()) {
    if (!currMap.has(key)) breakingChanges.push(`移除已导出符号 ${key}（原签名：${prevSig}）`);
    else if (currMap.get(key) !== prevSig) breakingChanges.push(`篡改已冻结导出签名 ${key}：原为 \`${prevSig}\`，现为 \`${currMap.get(key)}\``);
  }
  for (const key of currMap.keys()) if (!prevMap.has(key)) addedExports.push(key);
  return { hasFrozenBaseline: true, previousHash: r.value.stubHash, stubChanged: r.value.stubHash !== currentStub.stubHash, breakingChanges, addedExports };
}

function resolveNeighborStubSnapshot(projectRoot, nb) {
  const frzPath = frozenStubPathOf(projectRoot, nb.id);
  const frz = existsSync(frzPath) ? readJsonStrict(frzPath) : { ok: false };
  if (frz.ok && frz.value?.stubHash && frz.value.stubHash !== nb.stub.stubHash) {
    const facadeMode = frz.value.facadeMode || nb.stub.facadeMode;
    const lines = [`// @donegate-stub node=${nb.id} mode=${facadeMode} hash=${frz.value.stubHash}`];
    let lastFile = '';
    for (const s of frz.value.exportedSymbols || []) {
      if (s.file && s.file !== lastFile) { lines.push(`// [entry: ${s.file}]`); lastFile = s.file; }
      if (s.signature) lines.push(s.signature);
    }
    if (lines.length === 1) lines.push('// (no public code exports)');
    return { facadeMode, stubHash: frz.value.stubHash, stubText: `${lines.join('\n')}\n` };
  }
  const dtsPath = join(projectRoot, '.donegate', 'stubs', `${nb.id}.stub.d.ts`);
  const stubText = existsSync(dtsPath) ? readFileSync(dtsPath, 'utf8') : nb.stub.stubText;
  return { facadeMode: nb.stub.facadeMode, stubHash: nb.stub.stubHash, stubText };
}

function collectMatchingNodeTests(projectRoot, target, repoTestFiles = []) {
  const matched = new Set(target.stub.relatedTestFiles || []);
  for (const o of target.obligations || []) {
    if (typeof o.command !== 'string') continue;
    for (const m of o.command.matchAll(/([A-Za-z0-9_./-]+\.(?:mjs|js|ts|py|go))/g)) {
      const cand = m[1].replace(/^\.\//, '');
      if (existsSync(join(projectRoot, cand)) && !target.stub.scopeFiles.includes(cand)) matched.add(cand);
    }
  }
  const scopePrefixes = (target.scope || []).map((s) => String(s || '').replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean);
  for (const tf of repoTestFiles) {
    const raw = readMaybe(join(projectRoot, tf));
    if (raw !== null && (raw.includes(target.id) || scopePrefixes.some((sp) => raw.includes(sp)))) matched.add(tf);
  }
  return [...matched].sort();
}

export function parseFocusPatterns(rawFocus) {
  const arr = Array.isArray(rawFocus) ? rawFocus : (typeof rawFocus === 'string' ? rawFocus.split(',') : []);
  return arr.map((s) => String(s || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
}
export function parseLexicalTerms(rawLexical) {
  const arr = Array.isArray(rawLexical) ? rawLexical : (typeof rawLexical === 'string' ? rawLexical.split(',') : []);
  return arr.map((s) => String(s || '').trim()).filter(Boolean);
}
function matchesFocusPattern(relPath, patterns) {
  const rel = String(relPath || '').replace(/\\/g, '/'), base = basename(rel), stem = basename(rel, extname(rel));
  return patterns.some((p) => {
    const cleanDir = p.replace(/\/+$/, '');
    return rel === p || (cleanDir && rel.startsWith(`${cleanDir}/`)) || rel.endsWith(`/${p}`) || base === p || stem === p;
  });
}

function hcapResolveIntraJsImport(src, spec, scopeSet) {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(src), spec)).replace(/\\/g, '/');
  const cands = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}/index.mjs`, `${base}/index.js`];
  return cands.find((c) => scopeSet.has(c)) || null;
}

function hcapAddIntraFileImports(src, body, scopeSet, seedSet, closure) {
  if (src.endsWith('.py')) {
    for (const dst of extractPythonImportTargets(src, body, scopeSet)) {
      if (seedSet.has(src) || seedSet.has(dst)) {
        closure.add(src);
        closure.add(dst);
      }
    }
    return;
  }
  const masked = maskCommentsAndStrings(body, extname(src).toLowerCase());
  for (const m of body.matchAll(HCAP_IMPORT_RE)) {
    if (masked[m.index] === ' ') continue;
    const dst = hcapResolveIntraJsImport(src, m[1].split(/[?#]/)[0], scopeSet);
    if (dst && dst !== src && (seedSet.has(src) || seedSet.has(dst))) {
      closure.add(src);
      closure.add(dst);
    }
  }
}

function computeIntraHopFocusClosure(scopeSet, rawByFile, seedSet, facadeFiles, domGraph) {
  const closure = new Set([...seedSet]);
  if (seedSet.size === 0) return closure;
  for (const f of facadeFiles || []) {
    if (scopeSet.has(f)) closure.add(f);
  }
  for (const [src, body] of rawByFile.entries()) {
    hcapAddIntraFileImports(src, body, scopeSet, seedSet, closure);
  }
  for (const seed of seedSet) {
    for (const linked of domGraph.edges.get(seed) || []) {
      if (scopeSet.has(linked)) closure.add(linked);
    }
  }
  return closure;
}

function hcapResolveZeroHopRole(narrowMode, isSeed, isLexical) {
  if (!narrowMode) return '全量展开';
  if (isSeed) return '目标源码（全量）';
  return isLexical ? '词法命中（全量）' : '同卡依赖闭包（全量）';
}

function hcapLoadScopeSources(projectRoot, scopeFiles, maxEff) {
  const rawByFile = new Map(), metaByFile = new Map();
  let cardMaxProcFn = 0;
  for (const rel of scopeFiles) {
    const content = readMaybe(join(projectRoot, rel));
    if (content === null) continue;
    rawByFile.set(rel, content);
    const parsed = extractFileInterfaceStub(content, rel), lm = computeFileLineMetrics(content, rel);
    if (lm.maxProceduralFnLines > cardMaxProcFn) cardMaxProcFn = lm.maxProceduralFnLines;
    metaByFile.set(rel, { content, parsed, lm, headroom: Math.max(0, maxEff - lm.effectiveLines) });
  }
  return { rawByFile, metaByFile, cardMaxProcFn };
}

function hcapBuildSiblingStub(rel, meta, wiring) {
  const { parsed, lm, headroom } = meta;
  return { path: rel, effectiveLines: lm.effectiveLines, physicalLines: lm.physicalLines, maxProceduralFnLines: lm.maxProceduralFnLines, headroom, exports: parsed.exports, wiringComment: formatDomWiringStubComment(rel, wiring) };
}

function hcapOrderCandidates(metaByFile, isPriority) {
  return [...metaByFile.keys()].sort((a, b) => (isPriority(a) ? 0 : 1) - (isPriority(b) ? 0 : 1) || a.localeCompare(b));
}

function hcapSelectZeroHopSources(metaByFile, domGraph, selCtx) {
  const { narrowMode, closureSet, seedSources, lexicalSources, zeroHopCharCap } = selCtx;
  const isPriority = (f) => seedSources.has(f) || lexicalSources.has(f);
  const zeroHopMap = new Map(), siblingStubs = [], truncatedFiles = [];
  let usedChars = 0;
  for (const rel of hcapOrderCandidates(metaByFile, isPriority)) {
    const meta = metaByFile.get(rel), wiring = domGraph.byFile.get(rel);
    if (narrowMode && !closureSet.has(rel)) { siblingStubs.push(hcapBuildSiblingStub(rel, meta, wiring)); continue; }
    if (usedChars + meta.content.length <= zeroHopCharCap) {
      usedChars += meta.content.length;
      const { lm, headroom, content } = meta, role = hcapResolveZeroHopRole(narrowMode, seedSources.has(rel), lexicalSources.has(rel));
      zeroHopMap.set(rel, { path: rel, kind: 'source', role, isSeed: !narrowMode || isPriority(rel), content, effectiveLines: lm.effectiveLines, physicalLines: lm.physicalLines, maxProceduralFnLines: lm.maxProceduralFnLines, headroom });
    } else {
      truncatedFiles.push(rel);
      if (narrowMode) siblingStubs.push(hcapBuildSiblingStub(rel, meta, wiring));
    }
  }
  siblingStubs.sort((a, b) => a.path.localeCompare(b.path));
  return { zeroHopFiles: [...zeroHopMap.values()].sort((a, b) => a.path.localeCompare(b.path)), siblingStubs, truncatedFiles, usedChars };
}

function hcapBuildSeedHints(zeroHopFiles) {
  return zeroHopFiles.filter((f) => f.isSeed).flatMap((f) => {
    const base = basename(f.path), stem = basename(f.path, extname(f.path)), noExt = f.path.slice(0, f.path.length - extname(f.path).length);
    return HCAP_GENERIC_STEMS.has(stem) ? [f.path, noExt, f.path.split('/').slice(-2).join('/')] : [f.path, noExt, base, stem];
  });
}

function hcapSelectZeroHopTests(projectRoot, candidateTests, testCtx) {
  const { maxEff, narrowMode, lexicalMode, lexicalTerms, seedTests, obHints, closureHints, zeroHopCharCap } = testCtx;
  let { usedChars } = testCtx;
  const zeroHopTests = [];
  for (const tf of candidateTests) {
    const content = readMaybe(join(projectRoot, tf));
    if (content === null) continue;
    const lm = computeFileLineMetrics(content, tf);
    const lexHit = lexicalMode && lexicalTerms.some((t) => content.includes(t));
    const needed = !narrowMode || seedTests.has(tf) || lexHit || obHints.some((c) => c.includes(tf)) || closureHints.some((h) => h && content.includes(h));
    if (needed && usedChars + content.length <= zeroHopCharCap) {
      usedChars += content.length;
      zeroHopTests.push({ path: tf, kind: 'test', content, effectiveLines: lm.effectiveLines, physicalLines: lm.physicalLines, maxProceduralFnLines: lm.maxProceduralFnLines, headroom: Math.max(0, maxEff - lm.effectiveLines) });
    }
  }
  return zeroHopTests;
}

function partitionZeroHopAssets(projectRoot, target, graph, budget, focusPatterns, lexicalTerms, hasCrossCardWarn) {
  const maxEff = graph.thresholds?.maxEffectiveFileLines || 850, zeroHopCharCap = budget.zeroHopSourceBudgetTokens * 4;
  const focusMode = focusPatterns.length > 0, lexicalMode = lexicalTerms.length > 0, narrowMode = focusMode || lexicalMode;
  const { rawByFile, metaByFile, cardMaxProcFn } = hcapLoadScopeSources(projectRoot, target.stub.scopeFiles, maxEff);
  const scopeSet = new Set(rawByFile.keys());
  const seedSources = new Set([...scopeSet].filter((rel) => focusMode && matchesFocusPattern(rel, focusPatterns)));
  const lexicalSources = new Set([...scopeSet].filter((rel) => lexicalMode && lexicalTerms.some((t) => (rawByFile.get(rel) || '').includes(t))));
  const candidateTests = collectMatchingNodeTests(projectRoot, target, graph.testFiles || []);
  const seedTests = new Set(candidateTests.filter((tf) => focusMode && matchesFocusPattern(tf, focusPatterns)));
  if (focusMode && !lexicalMode && !hasCrossCardWarn && seedSources.size === 0 && seedTests.size === 0) return { emptyFocusMatch: true };
  const domGraph = buildDomWiringGraph(rawByFile);
  const closureSet = computeIntraHopFocusClosure(scopeSet, rawByFile, seedSources, target.stub.facadeFiles, domGraph);
  for (const lx of lexicalSources) closureSet.add(lx);
  const { zeroHopFiles, siblingStubs, truncatedFiles, usedChars } = hcapSelectZeroHopSources(metaByFile, domGraph, { narrowMode, closureSet, seedSources, lexicalSources, zeroHopCharCap });
  const shardAdvice = adviseCapsuleModularitySplit(target, rawByFile, domGraph, budget, truncatedFiles.length);
  const obHints = (target.obligations || []).map((o) => String(o.command || ''));
  const zeroHopTests = hcapSelectZeroHopTests(projectRoot, candidateTests, { maxEff, narrowMode, lexicalMode, lexicalTerms, seedTests, obHints, closureHints: hcapBuildSeedHints(zeroHopFiles), zeroHopCharCap, usedChars });
  return { maxEff, focusMode, lexicalMode, lexicalMatches: [...lexicalSources].sort(), cardMaxProcFn, emptyFocusMatch: false, zeroHopFiles, siblingStubs, zeroHopTests, truncatedFiles, shardAdvice };
}

function hcapWriteOptionalOut(projectRoot, outRel, asJson, payload, markdown) {
  if (!outRel) return;
  const outAbs = resolve(projectRoot, outRel);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, asJson ? JSON.stringify(payload, null, 2) : markdown, 'utf8');
}

function hcapResolveNeighborRelation(target, nid) {
  const isUp = target.dependsOnIds.includes(nid), isDown = target.dependedByIds.includes(nid);
  if (isUp && isDown) return 'bidirectional';
  return isUp ? 'upstream-provider' : 'downstream-consumer';
}

function hcapBuildOneHopNeighbors(projectRoot, target, graph, budget) {
  const oneHopCharCap = budget.oneHopContractBudgetTokens * 4, neighborIds = [...new Set([...target.dependsOnIds, ...target.dependedByIds])].sort(), neighbors = [];
  let usedOneHopChars = 0;
  for (const nid of neighborIds) {
    const nb = graph.nodes.find((x) => x.id === nid);
    if (!nb) continue;
    const sharedObs = (nb.obligations || []).filter((o) => Array.isArray(o.spansContracts) && o.spansContracts.includes(target.id)).map((o) => `${o.id}: ${o.claim || ''}`);
    const snap = resolveNeighborStubSnapshot(projectRoot, nb);
    const stubSlice = usedOneHopChars + snap.stubText.length <= oneHopCharCap ? snap.stubText : snap.stubText.slice(0, Math.max(400, oneHopCharCap - usedOneHopChars));
    usedOneHopChars += stubSlice.length;
    neighbors.push({ nodeId: nid, title: nb.title || nid, why: nb.why || '', relation: hcapResolveNeighborRelation(target, nid), facadeMode: snap.facadeMode, stubHash: snap.stubHash, stubTokens: Math.ceil(stubSlice.length / 4), sharedBoundaryClaims: sharedObs, stubText: stubSlice });
  }
  return { neighborIds, neighbors };
}

function hcapParseWorryLine(line, targetId) {
  try {
    const n = JSON.parse(line);
    const isWorry = n.kind === 'worry' || n.kind === 'alert';
    if (!isWorry || (n.contractId && n.contractId !== targetId)) return null;
    return { kind: 'worry-note', text: [n.title, n.detail].filter(Boolean).join('：') };
  } catch (err) { void err; return null; }
}

function hcapCollectUntrustedEntries(projectRoot, target, opts) {
  const toArr = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
  const refs = toArr(opts.externalRefs || target.externalRefs).map((r) => (typeof r === 'object' ? r : { kind: 'external-ref', text: r }));
  const diskRaw = opts.includeWorryNotes === false ? '' : (readMaybe(join(projectRoot, '.donegate', 'notes.jsonl')) || '');
  const diskWorries = diskRaw.split(/\r?\n/).filter(Boolean).slice(-8).map((ln) => hcapParseWorryLine(ln, target.id)).filter(Boolean);
  const optWorries = toArr(opts.worryNotes).map((w) => ({ kind: 'worry-note', text: String(w) }));
  const errLog = String(opts.errorLog || opts.failureLog || readMaybe(join(projectRoot, '.donegate', 'capsules', `${target.id}.error.log`)) || '').trim();
  const baseSec = buildUntrustedEnvelopeSection([...refs, ...diskWorries, ...optWorries]);
  if (!errLog) return baseSec;
  const errBlock = wrapUntrustedBlock('error-log', errLog, { nonce: makeUntrustedNonce() });
  const head = baseSec.hasUntrusted ? baseSec.lines : ['', '## 6. 外源不可信参考、历史报忧与报错日志（Nonce 物理隔离区）', `> ${UNTRUSTED_SYSTEM_CLAUSE}`, ''];
  return { hasUntrusted: true, count: baseSec.count + 1, blocks: [...baseSec.blocks, errBlock], lines: [...head, ...errBlock.split(/\r?\n/), ''] };
}

export function cmdSlice(projectRoot, opts = {}) {
  const routerRes = writeProjectRouter(projectRoot, opts);
  if (!routerRes.ok) return { exitCode: 3, stderr: '契约读取错误，无法生成路由与局部胶囊' };
  const { graph, budget, payload: routerPayload, markdown: routerMd } = routerRes;
  if (opts.routerOnly || !opts.id) {
    if (graph.nodes.length === 0) return { exitCode: 3, stderr: '当前项目尚无活跃契约或画布组件节点，请先初始化契约后再执行 slice' };
    hcapWriteOptionalOut(projectRoot, opts.out, opts.json, routerPayload, routerMd);
    return { exitCode: 0, router: routerPayload, stdout: opts.json ? JSON.stringify(routerPayload, null, 2) : routerMd };
  }
  const target = graph.nodes.find((n) => n.id === opts.id);
  if (!target) return { exitCode: 3, stderr: `找不到目标节点「${opts.id}」（可选节点：${graph.nodes.map((n) => n.id).join(', ') || '无'}）` };
  if (opts.freezeStub || (target.isFrozenContract && !existsSync(frozenStubPathOf(projectRoot, target.id)))) {
    freezeNodeStubBaseline(projectRoot, target.id, target.stub);
  }

  const rawFocusPatterns = parseFocusPatterns(opts.focus);
  const { warnings, crossCardRoutes } = inspectCrossCardFocusPatterns(target, rawFocusPatterns, graph);
  const focusPatterns = resolveSubpackFocusPatterns(projectRoot, target, rawFocusPatterns);
  const lexicalTerms = parseLexicalTerms(opts.lexical);
  const { neighborIds, neighbors } = hcapBuildOneHopNeighbors(projectRoot, target, graph, budget);
  const visibleSet = new Set([target.id, ...neighborIds]);
  const hiddenNodeIds = graph.nodes.filter((n) => !visibleSet.has(n.id)).map((n) => n.id).sort();
  const microGateCommand = `node runner/donegate.mjs check-node ${target.id} --allow-dirty --receipt`;

  const assets = partitionZeroHopAssets(projectRoot, target, graph, budget, focusPatterns, lexicalTerms, warnings.length > 0);
  if (assets.emptyFocusMatch) {
    return { exitCode: 3, warnings, stderr: `--focus 未匹配到节点「${target.id}」内的任何 0-Hop 源码或测试文件：${focusPatterns.join(', ')}` };
  }
  const untrusted = hcapCollectUntrustedEntries(projectRoot, target, opts);
  const rawPrefix = hcapBuildStaticPrefixLines(target, budget, neighbors, hiddenNodeIds, warnings, microGateCommand);
  const prefixLines = untrusted.hasUntrusted ? [rawPrefix[0], '', `> 🛡️ ${UNTRUSTED_SYSTEM_CLAUSE}`, ...rawPrefix.slice(1)] : rawPrefix;
  const { fullLines, tocEntries } = assembleDynamicBodyWithToc(prefixLines, assets, target, budget);
  const capsuleMarkdown = [...fullLines, ...untrusted.lines].join('\n') + '\n';
  const capsulePayload = { ...hcapBuildCapsulePayload({
    target, budget, routerPayload, hiddenNodeIds, neighbors, assets, tocEntries,
    focusPatterns, lexicalTerms, warnings, crossCardRoutes, microGateCommand, capsuleMarkdown
  }), untrustedEnvelope: { enabled: untrusted.hasUntrusted, count: untrusted.count } };

  const capDir = join(projectRoot, '.donegate', 'capsules');
  const defaultMdPath = join(capDir, `${target.id}.capsule.md`);
  mkdirSync(capDir, { recursive: true });
  writeFileSync(defaultMdPath, capsuleMarkdown, 'utf8');
  writeFileSync(join(capDir, `${target.id}.capsule.json`), JSON.stringify(capsulePayload, null, 2), 'utf8');
  hcapWriteOptionalOut(projectRoot, opts.out, opts.json, capsulePayload, capsuleMarkdown);
  return { exitCode: 0, warnings, capsule: capsulePayload, capsulePath: defaultMdPath, stdout: opts.json ? JSON.stringify(capsulePayload, null, 2) : capsuleMarkdown };
}
