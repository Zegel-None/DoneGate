// Stage 17 · 架构优雅与单向无环分层金字塔永久回归守护测试（@dg-public-ok）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { discoverHermeticGraph } from '../runner/core/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Stage 17 · 六层严格无环金字塔、零孤儿覆盖、门面封装与变焦驾驶舱节奏', () => {
  it('契约级零强连通环、100% 生产代码覆盖、零红线/虚线/门面私引，且单卡水位均衡无分片告警', () => {
    if (!existsSync(join(REPO_ROOT, 'contracts/shared-primitives/contract.json'))) return;

    const hermetic = discoverHermeticGraph(REPO_ROOT);
    expect(hermetic.sccCycles).toEqual([]);
    expect(hermetic.redImports).toEqual([]);
    expect(hermetic.facadeViolations).toEqual([]);

    const graphRes = dispatchCommand(['graph'], REPO_ROOT);
    expect(graphRes.exitCode).toBe(0);
    expect(graphRes.coveragePct).toBe(100);
    expect(graphRes.orphans).toEqual([]);
    expect(graphRes.edges.dashed).toEqual([]);
    expect(graphRes.edges.red).toEqual([]);
    expect(graphRes.stdout).toContain('subgraph L0["L0 · 纯叶底座"]');

    const routerRes = dispatchCommand(['slice', '--router-only', '--json'], REPO_ROOT);
    expect(routerRes.exitCode).toBe(0);
    const capBudget = routerRes.router.budgetProfile.capsuleInitialMaxTokens;
    for (const node of routerRes.router.nodes) {
      const util = node.sourceTokens / capBudget;
      expect(util, `${node.id} 胶囊水位应控制在 80% 以内`).toBeLessThanOrEqual(0.8);
    }
  });

  it('donegate brief 呈现严格单向无环 DAG 健康标、L0–Ln 分层徽章与 10 格容量水位条', () => {
    if (!existsSync(join(REPO_ROOT, 'contracts/shared-primitives/contract.json'))) return;

    const briefRes = dispatchCommand(['brief'], REPO_ROOT);
    expect(briefRes.exitCode).toBe(0);
    expect(briefRes.stdout).toContain('严格单向无环 DAG');
    expect(briefRes.stdout).toContain('[L0] `shared-primitives`');
    expect(briefRes.stdout).toContain('[L1] `verdict-core`');
    expect(briefRes.stdout).not.toContain('含互引强连通簇');
    expect(briefRes.stdout).toMatch(/\[[█░]{10}\]\s+\d+%/);
  });
});
