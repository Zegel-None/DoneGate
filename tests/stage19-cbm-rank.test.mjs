// Stage 19 · CBM 文件级加权图与个性化 PageRank 排序内核单测
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildCallEdgeTrustContext,
  classifyCallEdge,
  estimateTokens,
  explainRank,
  loadRankGraph,
  personalizedPageRank,
  pickBestCallEdgeTrust,
  resolveCbmBinary,
  scoreSeeds
} from '../runner/core/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

function makeHandGraph(files, edges) {
  const idx = new Map(files.map((f, i) => [f, i]));
  const out = files.map(() => new Map());
  for (const [from, to, w] of edges) {
    out[idx.get(from)].set(idx.get(to), w);
  }
  return { files, idx, out };
}

describe('Stage 19 · CBM 图排序内核 (cbm-rank)', () => {
  it('① 3 节点手造图 PPR 概率和为 1 且种子节点分最高', () => {
    const graph = makeHandGraph(['a.mjs', 'b.mjs', 'c.mjs'], [
      ['a.mjs', 'b.mjs', 1],
      ['b.mjs', 'c.mjs', 1],
      ['c.mjs', 'a.mjs', 1],
      ['b.mjs', 'a.mjs', 0.5]
    ]);
    const seeds = new Map([['a.mjs', 1]]);
    const ranks = personalizedPageRank(graph, seeds);
    expect(ranks).toBeInstanceOf(Float64Array);
    expect(ranks.length).toBe(3);
    const sum = ranks[0] + ranks[1] + ranks[2];
    expect(sum).toBeCloseTo(1, 6);
    expect(ranks[0]).toBeGreaterThan(ranks[1]);
    expect(ranks[0]).toBeGreaterThan(ranks[2]);

    const exp = explainRank(graph, seeds, 'b.mjs');
    expect(exp.seedTerms).toEqual([]);
    expect(exp.via[0]).toEqual({ from: 'a.mjs', type: 'EDGE' });
  });

  it('② 链式图 A→B→C 仅种子 A 时传播至 C（C > 0 且 A > B > C）', () => {
    const graph = makeHandGraph(['A.mjs', 'B.mjs', 'C.mjs'], [
      ['A.mjs', 'B.mjs', 1],
      ['B.mjs', 'C.mjs', 1]
    ]);
    const ranks = personalizedPageRank(graph, new Map([['A.mjs', 1]]), { alpha: 0.15 });
    const sum = ranks[0] + ranks[1] + ranks[2];
    expect(sum).toBeCloseTo(1, 6);
    expect(ranks[2]).toBeGreaterThan(0);
    expect(ranks[0]).toBeGreaterThan(ranks[1]);
    expect(ranks[1]).toBeGreaterThan(ranks[2]);
  });

  it('边界条件：全停用词返回空种子、空种子 PPR 返回零向量、estimateTokens 按 ceil(len/3)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(2);

    const emptySeeds = scoreSeeds(REPO_ROOT, 'the a to of and for in fix feat add update', {
      handle: null,
      files: ['runner/core/cbm-rank.mjs'],
      fileHeaders: { 'runner/core/cbm-rank.mjs': 'rank kernel' }
    });
    expect(emptySeeds.size).toBe(0);

    const graph = makeHandGraph(['x.mjs', 'y.mjs'], [['x.mjs', 'y.mjs', 1]]);
    const zeroVec = personalizedPageRank(graph, emptySeeds);
    expect(Array.from(zeroVec)).toEqual([0, 0]);
    expect(loadRankGraph(resolve(REPO_ROOT, 'non-existent-dir-stage19-xyz'))).toBeNull();
  });

  it('③ 真仓查询「承重接口 Kneedle」在默认与调优 alpha 下前 5 均含 runner/core/cockpit-cbm.mjs', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;
    const graph = loadRankGraph(REPO_ROOT);
    expect(graph).not.toBeNull();
    expect(graph.files.length).toBeGreaterThan(150);

    const seeds = scoreSeeds(REPO_ROOT, '承重接口 Kneedle');
    expect(seeds.size).toBeGreaterThan(0);

    for (const alpha of [0.15, 0.65]) {
      const scores = personalizedPageRank(graph, seeds, { alpha });
      const top5 = graph.files
        .map((file, i) => ({ file, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.file);
      expect(top5).toContain('runner/core/cockpit-cbm.mjs');
    }

    const explained = explainRank(graph, seeds, 'runner/core/cockpit-cbm.mjs');
    expect(explained.via.some((v) => v.from === 'runner/core/cbm-export-truth.mjs')).toBe(true);
  });

  it('④ 真仓全图单次 PPR 耗时 < 300ms 且 inferred CALLS 边按 0.2 降权', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;
    const graph = loadRankGraph(REPO_ROOT);
    const seeds = scoreSeeds(REPO_ROOT, '承重接口 Kneedle');
    const t0 = performance.now();
    const scores = personalizedPageRank(graph, seeds);
    const elapsedMs = performance.now() - t0;
    expect(scores.length).toBe(graph.files.length);
    expect(elapsedMs).toBeLessThan(300);

    // skill/gen-feature-overview.mjs 无 IMPORTS 到 skill/build-public.mjs（仅为同名 filter 的 inferred 边），出度归一化权重被降权
    const u = graph.idx.get('skill/gen-feature-overview.mjs');
    const v = graph.idx.get('skill/build-public.mjs');
    if (u !== undefined && v !== undefined) {
      const w = graph.out[u].get(v) || 0;
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(0.15);
    }
  });
});

describe('S7 · 调用边置信度分类 (cbm-edge-trust) 与种子权重边界', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-edge-trust-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('直连 IMPORTS（含 Windows 反斜杠与 ./ 前缀）及同文件调用均判为 proven', () => {
    const ctx = buildCallEdgeTrustContext('', {
      directImports: new Map([['runner\\core\\a.mjs', ['./runner/core/b.mjs']]])
    });
    expect(classifyCallEdge('', 'runner/core/b.mjs', 'fn', ctx)).toBe('inferred');
    expect(classifyCallEdge('runner/core/a.mjs', '././runner\\core\\a.mjs', 'localFn', ctx)).toBe('proven');
    expect(classifyCallEdge('./runner/core/a.mjs', 'runner\\core\\b.mjs', 'fn', ctx)).toBe('proven');
    expect(pickBestCallEdgeTrust('runner/core/a.mjs', 'runner/core/b.mjs', ['x', 'fn'], ctx)).toBe('proven');
  });

  it('支持多跳 export { x } from、别名 as、export * from 与两步 import/export 桶转发（<= 4 跳）', () => {
    mkdirSync(join(tmp, 'src/deep'), { recursive: true });
    writeFileSync(join(tmp, 'src/b1.mjs'), "export { targetFn } from './b2.mjs';\nexport { origFn as aliasFn } from './deep/target.mjs';\n", 'utf8');
    writeFileSync(join(tmp, 'src/b2.mjs'), "export * from './b3';\n", 'utf8');
    writeFileSync(join(tmp, 'src/b3.mjs'), "import { targetFn, stepFn } from './deep/target.mjs';\nexport { targetFn, stepFn };\n", 'utf8');
    writeFileSync(join(tmp, 'src/b4.mjs'), "export * from './b1.mjs';\n", 'utf8');
    writeFileSync(join(tmp, 'src/b5.mjs'), "export * from './b4.mjs';\n", 'utf8');
    writeFileSync(join(tmp, 'src/deep/target.mjs'), 'export function targetFn() {}\nexport function origFn() {}\nexport function stepFn() {}\n', 'utf8');

    const ctx = buildCallEdgeTrustContext(tmp, {
      directImports: new Map([
        ['src/caller.mjs', ['src/b1.mjs']],
        ['src/stepCaller.mjs', ['src/b3.mjs']],
        ['src/tooDeepCaller.mjs', ['src/b5.mjs']]
      ])
    });
    expect(classifyCallEdge('src/caller.mjs', 'src/deep/target.mjs', 'targetFn', ctx)).toBe('proven');
    expect(classifyCallEdge('src/caller.mjs', 'src/deep/target.mjs', 'origFn', ctx)).toBe('proven');
    expect(classifyCallEdge('src/caller.mjs', 'src/deep/target.mjs', 'aliasFn', ctx)).toBe('proven');
    expect(classifyCallEdge('src/caller.mjs', 'src/deep/target.mjs', '', ctx)).toBe('proven');
    expect(classifyCallEdge('src/stepCaller.mjs', 'src/deep/target.mjs', 'stepFn', ctx)).toBe('proven');
    expect(classifyCallEdge('src/caller.mjs', 'src/deep/target.mjs', 'otherFn', ctx)).toBe('inferred');
    // b5 -> b4 -> b1 -> b2 -> b3 -> deep/target 为 5 跳，超过 4 跳上限退化为 inferred
    expect(classifyCallEdge('src/tooDeepCaller.mjs', 'src/deep/target.mjs', 'targetFn', ctx)).toBe('inferred');

    const unitCtx = buildCallEdgeTrustContext('', {
      directImports: { 'a.mjs': ['barrel.mjs'] },
      barrels: new Map([
        ['barrel.mjs', [{ target: 'loop.mjs', symbols: ['x'] }]],
        ['loop.mjs', [{ target: 'barrel.mjs', symbols: ['x'] }, { target: 'leaf.mjs', symbols: ['x'] }]]
      ])
    });
    expect(classifyCallEdge('a.mjs', 'leaf.mjs', 'x', unitCtx)).toBe('proven');
    expect(classifyCallEdge('a.mjs', 'missing.mjs', 'x', unitCtx)).toBe('inferred');
  });

  it('无导入时同契约判为 same-contract，跨契约同名（如 walk）判为 inferred，且缺 contracts/ 或损坏句柄安全降级', () => {
    const cRoot = join(tmp, 'with-contracts');
    mkdirSync(join(cRoot, 'contracts/c1'), { recursive: true });
    mkdirSync(join(cRoot, 'contracts/c2'), { recursive: true });
    writeFileSync(join(cRoot, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['src/alpha/'] }), 'utf8');
    writeFileSync(join(cRoot, 'contracts/c2/contract.json'), JSON.stringify({ id: 'c2', scope: ['src/beta/'] }), 'utf8');

    const ctx = buildCallEdgeTrustContext(cRoot, { directImports: new Map() });
    expect(classifyCallEdge('src/alpha/a.mjs', 'src/alpha/b.mjs', 'helper', ctx)).toBe('same-contract');
    expect(classifyCallEdge('src/alpha/a.mjs', 'src/beta/w.mjs', 'walk', ctx)).toBe('inferred');
    expect(pickBestCallEdgeTrust('src/alpha/a.mjs', 'src/alpha/b.mjs', ['helper'], ctx)).toBe('same-contract');

    const noContractRoot = join(tmp, 'no-contracts');
    mkdirSync(noContractRoot, { recursive: true });
    const brokenCtx = buildCallEdgeTrustContext(noContractRoot, {
      db: { prepare() { throw new Error('SQLITE_CLOSED'); } }
    });
    expect(brokenCtx.directImports.size).toBe(0);
    expect(classifyCallEdge('a.mjs', 'b.mjs', 'walk', brokenCtx)).toBe('inferred');
    expect(classifyCallEdge('a.mjs', 'b.mjs', 'walk', buildCallEdgeTrustContext(noContractRoot, { handle: null }))).toBe('inferred');

    const memDb = new DatabaseSync(':memory:');
    memDb.exec('CREATE TABLE nodes (id INT, project TEXT, label TEXT, file_path TEXT); CREATE TABLE edges (project TEXT, source_id INT, target_id INT, type TEXT);');
    memDb.exec("INSERT INTO nodes VALUES (1,'p','File','x.mjs'),(2,'p','Module','y.mjs'); INSERT INTO edges VALUES ('p',1,2,'IMPORTS');");
    const dbCtx = buildCallEdgeTrustContext(noContractRoot, { db: memDb, project: 'p' });
    expect(classifyCallEdge('x.mjs', 'y.mjs', 'foo', dbCtx)).toBe('proven');
    memDb.close();
  });

  it('getSeedWeight 对 Array / Float64Array 中的 Infinity / NaN / 负数做有限正数守卫', () => {
    const graph = makeHandGraph(['a.mjs', 'b.mjs', 'c.mjs'], [
      ['a.mjs', 'c.mjs', 0.5],
      ['b.mjs', 'c.mjs', 0.6]
    ]);
    const expArr = explainRank(graph, [Infinity, 1, 0], 'c.mjs');
    expect(expArr.via[0].from).toBe('b.mjs');
    const expTyped = explainRank(graph, new Float64Array([Number.NaN, 1, -2]), 'c.mjs');
    expect(expTyped.via[0].from).toBe('b.mjs');
  });

  it('buildCallEdgeTrustContext 对非可迭代对象属性与反斜杠/./路径 ownerMap 安全归一化', () => {
    const badCtx = buildCallEdgeTrustContext('', {
      directImports: { 'a.mjs': 123, 'b.mjs': null, 'c.mjs': ['d.mjs'] },
      ownerMap: { 'a.mjs': 123, 'src\\x.mjs': ['c1'], './src/y.mjs': 'c1' },
      barrels: { 'b.mjs': [{ target: 't.mjs', symbols: 123 }] }
    });
    expect(classifyCallEdge('a.mjs', 'b.mjs', 'fn', badCtx)).toBe('inferred');
    expect(classifyCallEdge('b.mjs', 't.mjs', 'fn', badCtx)).toBe('inferred');
    expect(classifyCallEdge('c.mjs', 'd.mjs', 'fn', badCtx)).toBe('proven');
    expect(classifyCallEdge('src/x.mjs', 'src/y.mjs', 'fn', badCtx)).toBe('same-contract');
    expect(classifyCallEdge('toString', 'src/y.mjs', 'fn', badCtx)).toBe('inferred');
    expect(classifyCallEdge('constructor', 'b.mjs', 'fn', badCtx)).toBe('inferred');
  });

  it('直接传给 classifyCallEdge 的原始普通对象在原型键与非可迭代值下不抛 TypeError', () => {
    const rawCtx = {
      directImports: { 'a.mjs': 123, 'b.mjs': ['barrel.mjs'] },
      ownerMap: { 'a.mjs': 123, 'x.mjs': ['c1'], 'y.mjs': ['c1'] },
      barrels: { 'barrel.mjs': [{ target: 't.mjs', symbols: 123 }] }
    };
    expect(classifyCallEdge('toString', 'b.mjs', 'fn', rawCtx)).toBe('inferred');
    expect(classifyCallEdge('constructor', 'b.mjs', 'fn', rawCtx)).toBe('inferred');
    expect(classifyCallEdge('a.mjs', 'b.mjs', 'fn', rawCtx)).toBe('inferred');
    expect(classifyCallEdge('b.mjs', 't.mjs', 'fn', rawCtx)).toBe('inferred');
    expect(classifyCallEdge('b.mjs', 'toString', 'fn', rawCtx)).toBe('inferred');
    expect(classifyCallEdge('x.mjs', 'y.mjs', 'fn', rawCtx)).toBe('same-contract');

    const ownProtoCtx = {
      directImports: { toString: ['t.mjs'] },
      ownerMap: { constructor: ['c1'], 'z.mjs': ['c1'] }
    };
    expect(classifyCallEdge('toString', 't.mjs', 'fn', ownProtoCtx)).toBe('proven');
    expect(classifyCallEdge('constructor', 'z.mjs', 'fn', ownProtoCtx)).toBe('same-contract');
    expect(classifyCallEdge('a.mjs', 't.mjs', 'fn', {
      directImports: { 'a.mjs': ['toString'] },
      barrels: { 'b.mjs': [{ target: 't.mjs', symbols: ['fn'] }] }
    })).toBe('inferred');
  });
});
