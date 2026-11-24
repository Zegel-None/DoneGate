// 主控零魔法数字三级变焦驾驶舱（donegate brief + donegate zoom + 1-Hop 单测反推）端到端单测
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { kneedleElbowCount } from '../runner/core/index.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('DoneGate 主控零魔法数字三级按需变焦驾驶舱 (brief / zoom / 1-hop impact)', () => {
  it('Satopää Kneedle 无参最大曲率拐点对均匀分布返回 0，对强偏态分布精准切出头部枢纽', () => {
    expect(kneedleElbowCount([])).toBe(0);
    expect(kneedleElbowCount([1, 1, 1, 1, 1, 1])).toBe(0);
    expect(kneedleElbowCount([5, 5, 5, 5])).toBe(0);
    expect(kneedleElbowCount([42])).toBe(1);
    const skewed = kneedleElbowCount([39, 22, 13, 10, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(skewed).toBeGreaterThanOrEqual(3);
    expect(skewed).toBeLessThanOrEqual(5);
  });

  it('donegate brief 生成与画布同构的五大业务域、49 条 HTTP 路由、实时四维阈值与三级确定性寻址句柄', () => {
    const res = dispatchCommand(['brief'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('主控全局根视口（Zoom-0');
    expect(res.stdout).toContain('[01] 沟通需求与定好验收标准');
    expect(res.stdout).toContain('[02] 界面实时预览与分派助手');
    expect(res.stdout).toContain('HTTP 路由：49 条');
    expect(res.stdout).toContain('[03] 可视化项目看板与过夜挂机');
    expect(res.stdout).toContain('四维门禁实时阈值');
    expect(res.stdout).toContain('SHARED_GOVERNANCE_GLOBS');
    expect(res.stdout).toContain('--allow-cross-scope');

    const jsonRes = dispatchCommand(['brief', '--json'], REPO_ROOT);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.domains).toBeGreaterThanOrEqual(4);
    expect(parsed.moduleCount).toBeGreaterThan(150);
  });

  it('donegate zoom Zoom-1 准确输出业务域树、实时真源字典 (rules)、测试清单与契约适配 ADR 视图', () => {
    const domRes = dispatchCommand(['zoom', '03'], REPO_ROOT);
    expect(domRes.exitCode).toBe(0);
    expect(domRes.stdout).toContain('runner/atlas/wb-uiboard.mjs');

    const rulesRes = dispatchCommand(['zoom', 'rules'], REPO_ROOT);
    expect(rulesRes.exitCode).toBe(0);
    const rules = JSON.parse(rulesRes.stdout);
    expect(rules.thresholds.maxCommitCodeLines).toBe(450);
    expect(rules.newAdapterArchetypes).toEqual([
      'scanner', 'generator', 'ui-extract', 'runtime-service', 'knowledge-skill', 'aggregator'
    ]);
    expect(rules.sharedPoolLayout.binDir).toBe('workflows/.deps/_shared/.bin/');
    expect(rules.declarativeWorkflows.length).toBeGreaterThanOrEqual(8);

    const testsRes = dispatchCommand(['zoom', 'tests', 'uiboard'], REPO_ROOT);
    expect(testsRes.exitCode).toBe(0);
    expect(testsRes.stdout).toContain('tests/round3-dsh-uiboard.test.mjs');

    const decRes = dispatchCommand(['zoom', '02', '--decisions'], REPO_ROOT);
    expect(decRes.exitCode).toBe(0);
    if (existsSync(join(REPO_ROOT, 'decisions'))) {
      expect(decRes.stdout).toContain('2026-11-21-07');
      expect(decRes.stdout).not.toContain('2026-11-21-04');
    } else {
      expect(decRes.stdout).toContain('公开脱敏分发包默认剥离内部研发决策记录');
    }
  });

  it('donegate zoom Zoom-2 括号平衡穿透 barrel 子模块与字符串数组拼接器，且剥离红测夹具噪声', () => {
    const routesZoom = dispatchCommand(['zoom', 'runner/dsh/ui-board-routes.mjs'], REPO_ROOT);
    expect(routesZoom.exitCode).toBe(0);
    expect(routesZoom.stdout).toContain('handleUiBoardSubRoute(req, res, subPath, rootDir, hub, readJsonBody, opts = {})');
    expect(routesZoom.stdout).toContain('./ui-board-engine.mjs');
    expect(routesZoom.stdout).toContain('POST /donegate/api/uiboard/inline-edit');

    const autoZoom = dispatchCommand(['zoom', 'runner/dsh/autopilot-routes.mjs'], REPO_ROOT);
    expect(autoZoom.exitCode).toBe(0);
    expect(autoZoom.stdout).toContain('POST /donegate/api/autopilot/start');

    const graphZoom = dispatchCommand(['zoom', 'runner/atlas/wb-graph-engine.mjs'], REPO_ROOT);
    expect(graphZoom.exitCode).toBe(0);
    expect(graphZoom.stdout).toContain('[browser] function createGroupFromNodes(nodeIds, opts = {})');

    const hygieneZoom = dispatchCommand(['zoom', 'skill/check-commit-hygiene.mjs'], REPO_ROOT);
    expect(hygieneZoom.exitCode).toBe(0);
    expect(hygieneZoom.stdout).not.toContain('/api/items');
    expect(hygieneZoom.stdout).not.toContain('export re-export');
  });

  it('donegate impact 支持含点号配置文件锚点并自动执行 1-Hop 生产模块覆盖单测反推', () => {
    const cfgImpact = dispatchCommand(['impact', 'adapters.registry.json', '--json'], REPO_ROOT);
    expect(cfgImpact.exitCode).toBe(0);
    const cfgData = JSON.parse(cfgImpact.stdout);
    expect(cfgData.affectedProdFiles.length).toBeGreaterThanOrEqual(8);

    const routeImpact = dispatchCommand(['impact', '/donegate/api/uiboard/inline-edit', '--json'], REPO_ROOT);
    expect(routeImpact.exitCode).toBe(0);
    const routeData = JSON.parse(routeImpact.stdout);
    expect(routeData.affectedProdFiles.some((p) => p.file === 'runner/dsh/ui-board-routes.mjs')).toBe(true);
    expect(routeData.transitiveTests.some((t) => t.file === 'tests/round3-dsh-uiboard.test.mjs')).toBe(true);
  });
});
