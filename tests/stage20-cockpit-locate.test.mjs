// Stage 20 · 任务描述直达定位命令 (donegate locate) 单测
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cmdLocate } from '../runner/cockpit/cockpit-locate.mjs';
import { estimateTokens, explainRank, resolveCbmBinary } from '../runner/core/index.mjs';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Stage 20 · 任务直达定位命令 (donegate locate)', () => {
  it('① 参数校验与空种子/缺 CBM 退出码符合四值规范', () => {
    const emptyQuery = cmdLocate(REPO_ROOT, { query: '   ' });
    expect(emptyQuery.exitCode).toBe(3);
    expect(emptyQuery.stderr).toContain('用法');

    for (const badBudget of [0, -10, true, 'abc', NaN]) {
      const bad = cmdLocate(REPO_ROOT, { query: 'kneedle', budget: badBudget });
      expect(bad.exitCode).toBe(3);
      expect(bad.stderr).toContain('参数错误');
    }
    expect(cmdLocate(REPO_ROOT, { query: 'kneedle', k: 0 }).exitCode).toBe(3);

    const missingCbm = cmdLocate(resolve(REPO_ROOT, 'non-existent-locate-dir'), { query: 'kneedle' });
    expect(missingCbm.exitCode).toBe(3);

    if (!resolveCbmBinary(REPO_ROOT)) return;

    const noSeedText = cmdLocate(REPO_ROOT, { query: 'the a to of and for in fix feat' });
    expect(noSeedText.exitCode).toBe(1);
    expect(noSeedText.stdout).toContain('建议');

    const noSeedJson = cmdLocate(REPO_ROOT, { query: 'the a to of and for', json: true });
    expect(noSeedJson.exitCode).toBe(1);
    const parsed = JSON.parse(noSeedJson.stdout);
    expect(parsed.seeds).toEqual([]);
    expect(parsed.results).toEqual([]);
    expect(typeof parsed.suggestion).toBe('string');
  });

  it('② --budget 800 严格控制输出 token <= 880 并附省略与 3 条下一步提示', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const res = dispatchCommand(['locate', '承重接口 Kneedle', '--budget', '800', '--root', REPO_ROOT]);
    expect(res.exitCode).toBe(0);
    expect(estimateTokens(res.stdout)).toBeLessThanOrEqual(800 * 1.1);
    expect(res.stdout).toContain('已省略');
    expect(res.stdout).toContain('--budget 1600');
    expect(res.stdout).toContain('--skeleton');
    expect(res.stdout).toContain('impact ');
    expect(res.stdout).toMatch(/node runner\/donegate\.mjs (?:slice|zoom) /);
  });

  it('③ --json 结构完整且包含种子词与图谱传播依据', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const res = dispatchCommand(['locate', '承重接口 Kneedle', '--k', '15', '--json', '--root', REPO_ROOT]);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.query).toBe('承重接口 Kneedle');
    expect(Array.isArray(parsed.seeds)).toBe(true);
    expect(parsed.seeds.length).toBeGreaterThan(0);
    expect(typeof parsed.seeds[0]).toBe('string');
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(typeof parsed.omitted).toBe('number');
    expect(typeof parsed.tokens).toBe('number');
    expect(parsed.tokens).toBeGreaterThan(0);

    for (const item of parsed.results) {
      expect(typeof item.file).toBe('string');
      expect(typeof item.score).toBe('number');
      expect(typeof item.contract).toBe('string');
      expect(typeof item.reason).toBe('string');
    }
    expect(parsed.results.some((r) => r.reason.startsWith('种子词:'))).toBe(true);
    expect(parsed.results.some((r) => /^经 .+ ← .+ 传播$/.test(r.reason))).toBe(true);
  });

  it('④ 零词汇重叠隐藏依赖查询在 Top-5 命中至少 1 题标准答案', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const inlineRes = cmdLocate(REPO_ROOT, { query: 'brief 首页的契约卡容量条', k: 5, json: true });
    expect(inlineRes.exitCode).toBe(0);
    const inlineFiles = JSON.parse(inlineRes.stdout).results.map((r) => r.file);
    const inlineGold = new Set([
      'runner/cockpit/cockpit-commands.mjs',
      'runner/core/context-router.mjs',
      'runner/core/ast-stub.mjs'
    ]);
    expect(inlineFiles.some((f) => inlineGold.has(f))).toBe(true);

    const hiddenPath = join(REPO_ROOT, 'tests', 'cockpit-nav-eval', 'hidden-deps.json');
    if (existsSync(hiddenPath)) {
      const items = JSON.parse(readFileSync(hiddenPath, 'utf8'));
      let hits = 0;
      for (const item of items) {
        const r = cmdLocate(REPO_ROOT, { query: item.query, k: 5, json: true });
        if (r.exitCode !== 0) continue;
        const top5 = JSON.parse(r.stdout).results.map((x) => x.file);
        if (item.gold.some((g) => top5.includes(g))) hits++;
      }
      expect(hits).toBeGreaterThanOrEqual(1);
    }
  });

  it('⑤ 极小 --budget 返回退出码 3 与最小预算提示，--budget 200 保持 <= 200 tok', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    for (const tiny of [1, 50]) {
      const res = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: tiny });
      expect(res.exitCode).toBe(3);
      expect(res.stderr).toContain('过小');
      const m = res.stderr.match(/至少需要约\s+(\d+)\s+tok/);
      expect(m).toBeTruthy();
      const suggested = Number(m[1]);
      const retry = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: suggested, json: true });
      expect(retry.exitCode).toBe(0);
      const retryJson = JSON.parse(retry.stdout);
      expect(retryJson.results.length).toBeGreaterThanOrEqual(1);
      expect(retryJson.tokens).toBeLessThanOrEqual(suggested);
    }

    const res200Text = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: 200 });
    expect(res200Text.exitCode).toBe(0);
    expect(estimateTokens(res200Text.stdout)).toBeLessThanOrEqual(200);

    const res200Json = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: 200, json: true });
    expect(res200Json.exitCode).toBe(0);
    const parsed200 = JSON.parse(res200Json.stdout);
    expect(parsed200.results.length).toBeGreaterThanOrEqual(1);
    expect(parsed200.tokens).toBeLessThanOrEqual(200);
  });

  it('⑥ 查询含反斜杠与换行时文本头与省略展开行保持单行且正确转义', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const rawQuery = 'kneedle "bar" \\\nexport';
    const textRes = cmdLocate(REPO_ROOT, { query: rawQuery, budget: 300 });
    expect(textRes.exitCode).toBe(0);
    const lines = textRes.stdout.split('\n');
    expect(lines[0]).toContain('locate "kneedle \\"bar\\" \\\\ export"');
    const omitLine = lines.find((l) => l.includes('已省略'));
    expect(omitLine).toBeTruthy();
    expect(omitLine).toContain('展开：locate "kneedle \\"bar\\" \\\\ export" --budget 600');

    const jsonRes = cmdLocate(REPO_ROOT, { query: rawQuery, budget: 300, json: true });
    expect(jsonRes.exitCode).toBe(0);
    expect(JSON.parse(jsonRes.stdout).query).toBe(rawQuery);
  });

  it('⑦ explainRank 支持 seeds Map 中的 Windows 反斜杠与 ./ 路径键', () => {
    const graph = {
      files: ['runner/a.mjs', 'runner/b.mjs', 'runner/c.mjs'],
      idx: new Map([['runner/a.mjs', 0], ['runner/b.mjs', 1], ['runner/c.mjs', 2]]),
      out: [new Map([[2, 0.5]]), new Map([[2, 0.8]]), new Map()],
      viaSources: new Map([
        [2, new Map([
          [0, { fromIdx: 0, type: 'IMPORTS', weight: 1.0 }],
          [1, { fromIdx: 1, type: 'CALLS', weight: 0.8 }]
        ])]
      ])
    };
    const posixExp = explainRank(graph, new Map([['runner/a.mjs', 1]]), 'runner/c.mjs');
    const winExp = explainRank(graph, new Map([['.\\runner\\a.mjs', 1]]), 'runner\\c.mjs');
    expect(winExp.via).toEqual(posixExp.via);
    expect(winExp.via[0]).toEqual({ from: 'runner/a.mjs', type: 'IMPORTS' });
  });
});
