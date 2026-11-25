// 主控聚焦驾驶舱（单一 MIT 开源图谱 CBM + FTS5 第一跳兜底 + 极薄契约/ADR 挂载 + 末步直读源码 + 1-Hop 单测反推）端到端单测
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { kneedleElbowCount, resolveCbmBinary } from '../runner/core/index.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('DoneGate 主控聚焦驾驶舱 (CBM 单底座 + 极薄契约/ADR + 末步 --source + impact)', () => {
  it('Satopää Kneedle 无参最大曲率拐点对均匀分布返回 0，对强偏态分布精准切出头部枢纽', () => {
    expect(kneedleElbowCount([])).toBe(0);
    expect(kneedleElbowCount([1, 1, 1, 1, 1, 1])).toBe(0);
    expect(kneedleElbowCount([5, 5, 5, 5])).toBe(0);
    expect(kneedleElbowCount([42])).toBe(1);
    const skewed = kneedleElbowCount([39, 22, 13, 10, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(skewed).toBeGreaterThanOrEqual(3);
    expect(skewed).toBeLessThanOrEqual(5);
  });

  it('donegate brief 生成五大业务域、物理目录、CBM 开源图谱统计与实时四维阈值', () => {
    const res = dispatchCommand(['brief'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('主控全局根视口（Zoom-0');
    expect(res.stdout).toContain('[01] 沟通需求与定好验收标准');
    expect(res.stdout).toContain('[02] 界面实时预览与分派助手');
    expect(res.stdout).toContain('物理目录：`runner/dsh/`');
    expect(res.stdout).toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.01 项目基础设置与测试开关');
    expect(res.stdout).not.toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.02');
    expect(res.stdout).toContain('[03] 可视化项目看板与过夜挂机');
    expect(res.stdout).toContain('四维门禁实时阈值');

    const jsonRes = dispatchCommand(['brief', '--json'], REPO_ROOT);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.domains).toBeGreaterThanOrEqual(4);
    expect(parsed.moduleCount).toBeGreaterThan(150);
    if (resolveCbmBinary(REPO_ROOT)) {
      expect(parsed.cbmGraph.available).toBe(true);
      expect(parsed.cbmGraph.totalNodes).toBeGreaterThan(1000);
      expect(parsed.cbmGraph.totalEdges).toBeGreaterThan(1000);
    }
  });

  it('donegate zoom Zoom-1 准确输出完整中文标题、实时真源字典 (rules)、测试清单与契约适配 ADR 视图', () => {
    const dom04 = dispatchCommand(['zoom', '04'], REPO_ROOT);
    expect(dom04.exitCode).toBe(0);
    expect(dom04.stdout).toContain('接收指令并启动各项检查');
    expect(dom04.stdout).not.toContain('检等环节');

    const rulesRes = dispatchCommand(['zoom', 'rules'], REPO_ROOT);
    expect(rulesRes.exitCode).toBe(0);
    const rules = JSON.parse(rulesRes.stdout);
    expect(rules.thresholds.maxCommitCodeLines).toBe(450);
    expect(rules.newAdapterArchetypes).toEqual([
      'scanner', 'generator', 'ui-extract', 'runtime-service', 'knowledge-skill', 'aggregator'
    ]);
    expect(rules.sharedPoolLayout.binDir).toBe('workflows/.deps/_shared/.bin/');
    expect(rules.declarativeWorkflows.length).toBeGreaterThanOrEqual(8);

    const decRes = dispatchCommand(['zoom', '02', '--decisions'], REPO_ROOT);
    expect(decRes.exitCode).toBe(0);
    if (existsSync(join(REPO_ROOT, 'decisions'))) {
      expect(decRes.stdout).toContain('2026-11-24-04');
      expect(decRes.stdout).not.toContain('2026-11-21-04');
    } else {
      expect(decRes.stdout).toContain('公开脱敏分发包默认剥离内部研发决策记录');
    }
  });

  it('donegate zoom Zoom-2 单一真源展示 CBM 符号行号、IMPORTS、Callers/Callees 与 --source 句柄，且支持单测/根配置下钻', () => {
    const allRes = dispatchCommand(['zoom', 'all'], REPO_ROOT);
    expect(allRes.exitCode).toBe(0);
    expect(allRes.stdout).toContain('[01]');
    expect(allRes.stdout).toContain('[05]');

    const wfDepsZoom = dispatchCommand(['zoom', 'runner/dsh/workflow-deps.mjs'], REPO_ROOT);
    expect(wfDepsZoom.exitCode).toBe(0);
    expect(wfDepsZoom.stdout).toContain('=== [Zoom-2 单文件图谱视图] runner/dsh/workflow-deps.mjs');
    expect(wfDepsZoom.stdout).toContain('末步直读源码句柄:');
    if (resolveCbmBinary(REPO_ROOT)) {
      expect(wfDepsZoom.stdout).toContain('provisionWorkflowDeps(projectRoot, pack, opts = {})');
      expect(wfDepsZoom.stdout).toContain('runWorkflowDepsCli(argv = process.argv.slice(2), defaultRoot = process.cwd())');
      expect(wfDepsZoom.stdout).toContain('CBM 依赖导入 IMPORTS');
      expect(wfDepsZoom.stdout).toContain('CBM 跨文件上游调用方 Callers');
    }

    const testZoom = dispatchCommand(['zoom', 'tests/verify-install.test.mjs', 'stryker.config.mjs', 'install-dsh-web.cmd'], REPO_ROOT);
    expect(testZoom.exitCode).toBe(0);
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件图谱视图] tests/verify-install.test.mjs');
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件图谱视图] stryker.config.mjs');
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件图谱视图] install-dsh-web.cmd');

    const missZoom = dispatchCommand(['zoom', 'runner/dsh/install-dsh-web-typo.mjs'], REPO_ROOT);
    expect(missZoom.exitCode).toBe(1);

    if (existsSync(join(REPO_ROOT, 'contracts'))) {
      const brief = dispatchCommand(['brief', '--json'], REPO_ROOT);
      const contracts = JSON.parse(brief.stdout).contracts;
      expect(contracts.indexOf('gate-tooling')).toBeLessThan(contracts.indexOf('atlas-workbench'));
      expect(contracts.indexOf('gate-tooling')).toBeLessThan(contracts.indexOf('publish-tooling'));
      expect(contracts[contracts.length - 1]).toBe('publish-tooling');
    }
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

  it('跨进程单飞文件锁缓存：回收死进程残留锁并防止多子进程冷启动惊群重算', async () => {
    const { mkdtempSync, rmSync, writeFileSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { spawn, spawnSync } = await import('node:child_process');
    const cacheDir = mkdtempSync(join(tmpdir(), 'dg-sf-cache-'));
    try {
      const { computeQuickRepoFingerprint, CK_CACHE_SCHEMA } = await import('../runner/core/cockpit-cache.mjs');
      const head = (spawnSync('git', ['-C', REPO_ROOT, 'log', '-1', '--format=%h (%cs) %s'], { encoding: 'utf8' }).stdout || '').trim();
      const fp = computeQuickRepoFingerprint(REPO_ROOT, head);
      writeFileSync(join(cacheDir, `dg-${CK_CACHE_SCHEMA}-${fp}.json.lock`), JSON.stringify({ pid: 99999999 }), 'utf8');

      const runChild = (target) => new Promise((resolveChild) => {
        const ch = spawn(process.execPath, [join(REPO_ROOT, 'runner/donegate.mjs'), 'zoom', target, '--root', REPO_ROOT], {
          cwd: REPO_ROOT,
          env: { ...process.env, DONEGATE_COCKPIT_CACHE_DIR: cacheDir }
        });
        let out = '';
        ch.stdout.on('data', (d) => { out += d.toString(); });
        ch.on('close', (code) => resolveChild({ code, out }));
      });

      const results = await Promise.all([runChild('01'), runChild('02'), runChild('03'), runChild('rules')]);
      for (const r of results) expect(r.code).toBe(0);
      const remainingLocks = readdirSync(cacheDir).filter((f) => f.endsWith('.lock'));
      expect(remainingLocks).toEqual([]);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('三步聚焦新底座：CBM 2-Hop 符号追踪、FTS5 模糊第一跳兜底、多主题容错批处理与 --source 末步直读源码', () => {
    const multiTopics = dispatchCommand(['zoom', 'rules', 'tests', 'gaps'], REPO_ROOT);
    expect(multiTopics.exitCode).toBe(0);
    expect(multiTopics.stdout).toContain('"thresholds"');
    expect(multiTopics.stdout).toContain('=== 全仓单测与夹具目录');
    expect(multiTopics.stdout).toContain('=== 本地分支雷达 ===');

    const partialBatch = dispatchCommand(['zoom', 'install-dsh-web.cmd', 'runner/dsh/nonexistent-ghost.mjs'], REPO_ROOT);
    expect(partialBatch.exitCode).toBe(1);
    expect(partialBatch.stdout).toContain('=== [Zoom-2 单文件图谱视图] install-dsh-web.cmd');
    expect(partialBatch.stdout).toContain('部分目标未命中告警');

    const wbEvents = dispatchCommand(['zoom', 'runner/atlas/wb-events-actions.mjs', 'runner/dsh/ui-aesthetics.mjs'], REPO_ROOT);
    expect(wbEvents.exitCode).toBe(0);
    expect(wbEvents.stdout.length).toBeLessThan(8000);

    const sliceByRange = dispatchCommand(['zoom', 'runner/dsh/workflow-jit.mjs:108-120', '--source'], REPO_ROOT);
    expect(sliceByRange.exitCode).toBe(0);
    expect(sliceByRange.stdout).toContain('=== [末步源码真源直读] runner/dsh/workflow-jit.mjs:L108-L120 ===');
    expect(sliceByRange.stdout).toContain('assertPlannerAuthority');
    if (existsSync(join(REPO_ROOT, 'decisions'))) {
      expect(sliceByRange.stdout).toContain('2026-11-24-04');
    }

    if (resolveCbmBinary(REPO_ROOT)) {
      const symTrace = dispatchCommand(['zoom', 'mutateComponentWorkflowJit'], REPO_ROOT);
      expect(symTrace.exitCode).toBe(0);
      expect(symTrace.stdout).toContain('CBM 开源图谱符号定位与双向 2-Hop 调用链');
      expect(symTrace.stdout).toContain('runner/dsh/workflow-jit.mjs');
      expect(symTrace.stdout).toContain('handleWorkflowJitSubRoute');
      expect(symTrace.stdout).toContain('assertPlannerAuthority');

      const fuzzyFirstHop = dispatchCommand(['zoom', 'runVerifyInstall'], REPO_ROOT);
      expect(fuzzyFirstHop.exitCode).toBe(0);
      expect(fuzzyFirstHop.stdout).toContain('skill/verify-install.mjs');

      const symSlice = dispatchCommand(['zoom', 'mutateComponentWorkflowJit', '--source'], REPO_ROOT);
      expect(symSlice.exitCode).toBe(0);
      expect(symSlice.stdout).toContain('export function mutateComponentWorkflowJit');
    }
  });
});
