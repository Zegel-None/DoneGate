// L2 密封施工胶囊打包器（1M×40%=400k 预算 · 隐式 DOM 耦合闭包 · Louvain 分片建议 · 双指标 TOC，<= 350 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { extractFileInterfaceStub, maskCommentsAndStrings } from './ast-stub.mjs';
import { inspectCrossCardFocusPatterns, writeProjectRouter } from './context-router.mjs';
import { buildDomWiringGraph, computeFileLineMetrics, formatDomWiringStubComment, resolveSubpackFocusPatterns } from './dom-wiring-graph.mjs';
import { adviseCapsuleModularitySplit, formatShardAdviceLines } from './capsule-shard-advisor.mjs';

const HCAP_GENERIC_STEMS = new Set(['index', 'contract', 'main', 'types', 'utils', '_shared']);
const HCAP_IMPORT_RE = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

export function frozenStubPathOf(projectRoot, nodeId) {
  return join(projectRoot, '.donegate', 'stubs', `${nodeId}.frozen.json`);
}

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

function computeIntraHopFocusClosure(scopeSet, rawByFile, seedSet, facadeFiles, domGraph) {
  const closure = new Set([...seedSet]);
  if (seedSet.size === 0) return closure;
  for (const f of facadeFiles || []) if (scopeSet.has(f)) closure.add(f);
  for (const [src, body] of rawByFile.entries()) {
    const masked = maskCommentsAndStrings(body, extname(src).toLowerCase());
    for (const m of body.matchAll(HCAP_IMPORT_RE)) {
      if (masked[m.index] === ' ') continue;
      const spec = m[1].split(/[?#]/)[0];
      if (!spec.startsWith('.')) continue;
      const base = normalize(join(dirname(src), spec)).replace(/\\/g, '/');
      const dst = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}/index.mjs`, `${base}/index.js`].find((c) => scopeSet.has(c));
      if (dst && dst !== src && (seedSet.has(src) || seedSet.has(dst))) { closure.add(src); closure.add(dst); }
    }
  }
  for (const seed of seedSet) {
    for (const linked of domGraph.edges.get(seed) || []) if (scopeSet.has(linked)) closure.add(linked);
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

function renderSiblingStubLines(siblingStubs, maxEff) {
  const out = [];
  for (const sb of siblingStubs) {
    out.push(`// [sibling: ${sb.path}] effectiveLines=${sb.effectiveLines}/${maxEff} physicalLines=${sb.physicalLines} maxProceduralFnLines=${sb.maxProceduralFnLines} headroom=${sb.headroom}`);
    if (sb.wiringComment) out.push(sb.wiringComment);
    if (sb.exports.length === 0) { out.push('// (内部实现或脚本入口，无具名导出)'); continue; }
    for (const ex of sb.exports) {
      if (ex.doc) out.push(...ex.doc.split(/\r?\n/));
      out.push(ex.signature);
    }
  }
  return out;
}

function assembleDynamicBodyWithToc(staticPrefixLines, assets, target, budget) {
  const { maxEff, zeroHopFiles, siblingStubs, zeroHopTests, truncatedFiles, shardAdvice } = assets;
  const blocks = [];
  for (const f of zeroHopFiles) {
    blocks.push({ category: '0-Hop 源码', path: f.path, effText: `${f.effectiveLines} / ${maxEff}`, physText: `${f.physicalLines}`, procText: `${f.maxProceduralFnLines}`, headroomText: `${f.headroom} 行`, effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines, modeText: f.role, lines: [`### \`${f.path}\``, '```js', ...f.content.trimEnd().split(/\r?\n/), '```'] });
  }
  if (siblingStubs.length > 0) {
    blocks.push({ category: '0-Hop 正交存根', path: `同卡零直连正交兄弟 (${siblingStubs.length} 个)`, effText: '见存根头', physText: '见存根头', procText: '见存根头', headroomText: '见存根头', effectiveLines: null, physicalLines: null, maxProceduralFnLines: null, modeText: 'AST 存根', lines: ['### 0-Hop 同卡正交兄弟文件 AST 存根与行数余量（与目标文件无直接调用耦合）', '```ts', ...renderSiblingStubLines(siblingStubs, maxEff), '```'] });
  }
  blocks.push({ isDivider: true, lines: ['', '## 5. 0-Hop 关联单测与验收夹具（动态断言区）', ...(zeroHopTests.length === 0 ? ['（暂无关联单测或验收夹具）'] : [])] });
  for (const tf of zeroHopTests) {
    blocks.push({ category: '0-Hop 单测', path: tf.path, effText: `${tf.effectiveLines} / ${maxEff}`, physText: `${tf.physicalLines}`, procText: `${tf.maxProceduralFnLines}`, headroomText: `${tf.headroom} 行`, effectiveLines: tf.effectiveLines, physicalLines: tf.physicalLines, maxProceduralFnLines: tf.maxProceduralFnLines, modeText: '全量展开', lines: [`### \`${tf.path}\``, '```js', ...tf.content.trimEnd().split(/\r?\n/), '```'] });
  }
  if (truncatedFiles.length > 0) {
    blocks.push({ isDivider: true, lines: ['', `> ⚠ 预算溢出提示：当前节点超出了 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t 源码上限（剩余 ${truncatedFiles.length} 个文件仅附存根）。`, '### 未全量展开文件的 AST 存根', '```ts', ...target.stub.stubText.trimEnd().split(/\r?\n/), '```'] });
  }
  if (shardAdvice) blocks.push({ isDivider: true, lines: formatShardAdviceLines(shardAdvice) });
  const tocHeader = ['', '## 4. 0-Hop 本卡全量源码（动态读写施工区）', `> 动态范围统计：0-Hop 展开源码 ${zeroHopFiles.length} 个${siblingStubs.length > 0 ? `（含目标与同卡调用闭包）+ 正交兄弟存根 ${siblingStubs.length} 个` : ''}（全卡有效代码 ${target.stub.effectiveLines} 行 / 非空物理行 ${target.stub.physicalLines} 行） | 关联单测 ${zeroHopTests.length} 个`, '', '### 0-Hop 胶囊精确行号导航目录与单文件行数余量（TOC）', '| 类别 | 路径 | 胶囊行号范围 | 有效代码 / 硬顶 | 非空物理行 | 最大过程函数行 | 剩余行数余量 | 形态 |', '|---|---|---|---|---|---|---|---|'];
  let cursor = staticPrefixLines.length + tocHeader.length + Math.max(1, blocks.filter((b) => !b.isDivider).length) + 2;
  const tocEntries = [], tocRows = [], bodyLines = [''];
  for (const b of blocks) {
    if (b.isDivider) { bodyLines.push(...b.lines); cursor += b.lines.length; continue; }
    const startLine = cursor, endLine = cursor + b.lines.length - 1;
    cursor += b.lines.length;
    bodyLines.push(...b.lines);
    tocEntries.push({ category: b.category, path: b.path, startLine, endLine, effectiveLines: b.effectiveLines, physicalLines: b.physicalLines, maxProceduralFnLines: b.maxProceduralFnLines, mode: b.modeText });
    tocRows.push(`| ${b.category} | \`${b.path}\` | \`L${startLine}-L${endLine}\` | \`${b.effText}\` | \`${b.physText}\` | \`${b.procText}\` | \`${b.headroomText}\` | ${b.modeText} |`);
  }
  if (tocRows.length === 0) tocRows.push('| — | （无 0-Hop 文件） | — | — | — | — | — | — |');
  return { fullLines: [...staticPrefixLines, ...tocHeader, ...tocRows, ...bodyLines], tocEntries };
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
  if (opts.freezeStub || (target.isFrozenContract && !existsSync(frozenStubPathOf(projectRoot, target.id)))) freezeNodeStubBaseline(projectRoot, target.id, target.stub);

  const rawFocusPatterns = parseFocusPatterns(opts.focus), { warnings, crossCardRoutes } = inspectCrossCardFocusPatterns(target, rawFocusPatterns, graph);
  const focusPatterns = resolveSubpackFocusPatterns(projectRoot, target, rawFocusPatterns), lexicalTerms = parseLexicalTerms(opts.lexical);
  const { neighborIds, neighbors } = hcapBuildOneHopNeighbors(projectRoot, target, graph, budget);
  const visibleSet = new Set([target.id, ...neighborIds]);
  const hiddenNodeIds = graph.nodes.filter((n) => !visibleSet.has(n.id)).map((n) => n.id).sort();
  const utilPct = Math.round(budget.targetUtilization * 100), microGateCommand = `node runner/donegate.mjs check-node ${target.id} --allow-dirty --receipt`;
  const hasTwoTierBarrel = target.stub.facadeMode === 'barrel' && target.stub.facadeFiles.some((f) => f.endsWith('/contract.mjs')) && target.stub.facadeFiles.some((f) => f.endsWith('/index.mjs'));
  const barrelNote = hasTwoTierBarrel ? '（双层桶防环：`contract.mjs` 仅放零跨卡环路纯叶导出，跨卡编排导出放 `index.mjs`）' : '';
  const warnBanner = warnings.length > 0 ? ['> ⚠️ 跨卡焦点路由提示', ...warnings.map((w) => `> - ${w}`), ''] : [];
  const rawPrefix = [
    `# DoneGate 密封施工胶囊：${target.id}（${target.title}）`, '', ...warnBanner, '## 1. 静态路由规则与阅后即焚收口指令',
    `- **五段配额**：子代理总预算 **${budget.contextWindowTokens.toLocaleString()} × ${utilPct}% = ${budget.totalSessionBudgetTokens.toLocaleString()} Tokens**（L0 路由 ${budget.routerBudgetTokens.toLocaleString()}t | 0-Hop 上限 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t | 1-Hop 存根上限 ${budget.oneHopContractBudgetTokens.toLocaleString()}t | 按需展开预留 ${budget.onDemandExpandBudgetTokens.toLocaleString()}t | 多轮思考与微门禁迭代预留 ${budget.multiTurnReserveTokens.toLocaleString()}t）`,
    `- **门面与隔离约束**：只准修改本节点 \`scope\`（含显式文件同名伴生子模块目录）与关联单测；跨节点调用必须经由 1-Hop 门面存根（直连邻居 ${neighbors.length} 个节点），2-Hop+ 节点物理屏蔽（共屏蔽 ${hiddenNodeIds.length} 个节点）。`,
    `- **阅后即焚收口指令**：局部快检执行 \`${microGateCommand}\`；退出码为 0 后仅将结构化回执（上限 ${budget.receiptBudgetTokens} Tokens）交回总控，随即销毁当前子会话上下文。`, '',
    '## 2. 本卡契约声明（0-Hop Mandate）', `- **节点 ID**：\`${target.id}\``, `- **业务职责**：${target.why || target.title}`,
    `- **允许写入路径 (scope)**：${(target.scope || []).map((s) => `\`${s}\``).join(', ') || '（未声明）'}`,
    `- **门面模式**：\`${target.stub.facadeMode}\`（当前 \`stubHash=${target.stub.stubHash}\`）${barrelNote}`,
    ...(target.obligations.length > 0 ? ['- **本卡验收判据**：', ...target.obligations.map((o) => `  - \`${o.id}\` (${o.kind})：${o.claim || ''} → \`${o.command || o.expect?.standard || ''}\``)] : ['- **本卡验收判据**：（待补充）']), '',
    '## 3. 1-Hop 邻域冻结接口存根（只读契约签名 · 物理隐藏邻居内部实现）'
  ];
  if (neighbors.length === 0) rawPrefix.push('（无 1-Hop 上下游直连节点，本卡为独立自治节点）');
  for (const nb of neighbors) {
    rawPrefix.push(`### [${nb.relation}] \`${nb.nodeId}\` — ${nb.title}${nb.why ? `（${nb.why}）` : ''}（存根：\`.donegate/stubs/${nb.nodeId}.stub.d.ts\`）`);
    if (nb.sharedBoundaryClaims.length > 0) rawPrefix.push(...nb.sharedBoundaryClaims.map((c) => `- 联调判据：${c}`));
    rawPrefix.push('```ts', nb.stubText.trimEnd(), '```');
  }
  const assets = partitionZeroHopAssets(projectRoot, target, graph, budget, focusPatterns, lexicalTerms, warnings.length > 0);
  if (assets.emptyFocusMatch) return { exitCode: 3, warnings, stderr: `--focus 未匹配到节点「${target.id}」内的任何 0-Hop 源码或测试文件：${focusPatterns.join(', ')}` };

  const { fullLines, tocEntries } = assembleDynamicBodyWithToc(rawPrefix.join('\n').split(/\r?\n/), assets, target, budget);
  const capsuleMarkdown = fullLines.join('\n') + '\n', capsuleBytes = Buffer.byteLength(capsuleMarkdown, 'utf8'), capsuleTokens = Math.ceil(capsuleMarkdown.length / 4);
  const capsulePayload = {
    schema: 'donegate-hermetic-capsule/v1', nodeId: target.id, title: target.title, scope: target.scope, facadeMode: target.stub.facadeMode, stubHash: target.stub.stubHash,
    effectiveLines: target.stub.effectiveLines, physicalLines: target.stub.physicalLines, maxProceduralFnLines: assets.cardMaxProcFn, budgetProfile: budget,
    focusMode: assets.focusMode, focusPatterns, lexicalMode: assets.lexicalMode, lexicalTerms, lexicalMatches: assets.lexicalMatches, warnings, crossCardFocus: crossCardRoutes,
    capsuleBytes, capsuleTokens, remainingSessionHeadroomTokens: Math.max(0, budget.totalSessionBudgetTokens - capsuleTokens), repoTotalSourceTokens: routerPayload.totalSourceTokens,
    omittedTwoHopNodes: hiddenNodeIds, oneHopStubs: neighbors, toc: tocEntries, truncatedFiles: assets.truncatedFiles, shardAdvice: assets.shardAdvice || null, microGateCommand,
    zeroHopFiles: assets.zeroHopFiles.map((f) => ({ path: f.path, role: f.role, tokens: Math.ceil(f.content.length / 4), effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines, headroom: f.headroom })),
    siblingStubFiles: assets.siblingStubs.map((s) => ({ path: s.path, effectiveLines: s.effectiveLines, physicalLines: s.physicalLines, maxProceduralFnLines: s.maxProceduralFnLines, headroom: s.headroom, exportCount: s.exports.length })),
    zeroHopTests: assets.zeroHopTests.map((f) => ({ path: f.path, tokens: Math.ceil(f.content.length / 4), effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines }))
  };
  const capDir = join(projectRoot, '.donegate', 'capsules'), defaultMdPath = join(capDir, `${target.id}.capsule.md`);
  mkdirSync(capDir, { recursive: true });
  writeFileSync(defaultMdPath, capsuleMarkdown, 'utf8');
  writeFileSync(join(capDir, `${target.id}.capsule.json`), JSON.stringify(capsulePayload, null, 2), 'utf8');
  hcapWriteOptionalOut(projectRoot, opts.out, opts.json, capsulePayload, capsuleMarkdown);
  return { exitCode: 0, warnings, capsule: capsulePayload, capsulePath: defaultMdPath, stdout: opts.json ? JSON.stringify(capsulePayload, null, 2) : capsuleMarkdown };
}
