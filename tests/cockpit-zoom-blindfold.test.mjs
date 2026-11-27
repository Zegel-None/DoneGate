// 主控聚焦驾驶舱（单一 MIT 开源图谱 CBM + FTS5 第一跳兜底 + 极薄契约/ADR 挂载 + 末步直读源码 + 1-Hop 单测反推）端到端单测
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { applyBudget, estimateTokens } from '../runner/cockpit/cockpit-budget.mjs';
import { kneedleElbowCount, queryCbmContractHubs, queryCbmFileGraph, queryCbmSymbolTrace, resolveCbmBinary } from '../runner/core/index.mjs';
import { applyExportTruthToSymbols, isPhantomHubTarget, kneedleElbowCount as rawKneedle, readExportTruth } from '../runner/core/cbm-export-truth.mjs';

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
    expect(res.stdout).toContain('可视化项目看板与过夜挂机');
    expect(res.stdout).toContain('界面实时预览与分派助手');
    expect(res.stdout).toContain('runner/dsh/');
    expect(res.stdout).toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.01 项目基础设置与测试开关');
    expect(res.stdout).not.toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.02');
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
    const dom03 = dispatchCommand(['zoom', '03'], REPO_ROOT);
    expect(dom03.exitCode).toBe(0);
    expect(dom03.stdout).toContain('接收指令并启动各项检查');
    expect(dom03.stdout).not.toContain('检等环节');

    const rulesRes = dispatchCommand(['zoom', 'rules'], REPO_ROOT);
    expect(rulesRes.exitCode).toBe(0);
    const rules = JSON.parse(rulesRes.stdout);
    expect(rules.thresholds.maxCommitCodeLines).toBe(450);
    expect(rules.newAdapterArchetypes).toEqual([
      'scanner', 'generator', 'ui-extract', 'runtime-service', 'knowledge-skill', 'aggregator'
    ]);
    expect(rules.sharedPoolLayout.binDir).toBe('workflows/.deps/_shared/.bin/');
    expect(rules.declarativeWorkflows.length).toBeGreaterThanOrEqual(8);

    const decRes = dispatchCommand(['zoom', '04', '--decisions'], REPO_ROOT);
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

    const wfDepsZoom = dispatchCommand(['zoom', 'runner/dsh/deps/workflow-deps.mjs'], REPO_ROOT);
    expect(wfDepsZoom.exitCode).toBe(0);
    expect(wfDepsZoom.stdout).toContain('=== [Zoom-2 单文件图谱视图] runner/dsh/deps/workflow-deps.mjs');
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
      expect(contracts.indexOf('shared-primitives')).toBeLessThan(contracts.indexOf('verdict-core'));
      expect(contracts.indexOf('verdict-core')).toBeLessThan(contracts.indexOf('atlas-workbench'));
      expect(contracts.indexOf('atlas-workbench')).toBeLessThan(contracts.indexOf('donegate-cli'));
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
    expect(routeData.affectedProdFiles.some((p) => p.file === 'runner/dsh/host/ui-board-routes.mjs')).toBe(true);
    expect(routeData.transitiveTests.some((t) => t.file === 'tests/round3-dsh-uiboard.test.mjs')).toBe(true);

    // 传入目录路径不抛 EISDIR，而是展开目录下源码与配置联合分析波及面
    const dirImpact = dispatchCommand(['impact', 'runner/core', '--json'], REPO_ROOT);
    expect(dirImpact.exitCode).toBe(0);
    const dirData = JSON.parse(dirImpact.stdout);
    expect(dirData.affectedTests.some((t) => t.file === 'tests/cockpit-zoom-blindfold.test.mjs')).toBe(true);
    expect(dirData.affectedProdFiles.length).toBeGreaterThanOrEqual(5);
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

    const wbEvents = dispatchCommand(['zoom', 'runner/atlas/wb-events-actions.mjs', 'runner/dsh/uiboard/ui-aesthetics.mjs'], REPO_ROOT);
    expect(wbEvents.exitCode).toBe(0);
    expect(wbEvents.stdout.length).toBeLessThan(8000);

    const sliceByRange = dispatchCommand(['zoom', 'runner/dsh/autopilot/workflow-jit.mjs:108-120', '--source'], REPO_ROOT);
    expect(sliceByRange.exitCode).toBe(0);
    expect(sliceByRange.stdout).toContain('=== [末步源码真源直读] runner/dsh/autopilot/workflow-jit.mjs:L108-L120 ===');
    expect(sliceByRange.stdout).toContain('assertPlannerAuthority');
    if (existsSync(join(REPO_ROOT, 'decisions'))) {
      expect(sliceByRange.stdout).toContain('2026-11-24-04');
    }

    if (resolveCbmBinary(REPO_ROOT)) {
      const symTrace = dispatchCommand(['zoom', 'mutateComponentWorkflowJit'], REPO_ROOT);
      expect(symTrace.exitCode).toBe(0);
      expect(symTrace.stdout).toContain('CBM 开源图谱符号定位与双向 2-Hop 调用链');
      expect(symTrace.stdout).toContain('runner/dsh/autopilot/workflow-jit.mjs');
      expect(symTrace.stdout).toContain('handleWorkflowJitSubRoute');
      expect(symTrace.stdout).toContain('assertPlannerAuthority');

      const fuzzyFirstHop = dispatchCommand(['zoom', 'runVerifyInstall'], REPO_ROOT);
      expect(fuzzyFirstHop.exitCode).toBe(0);
      expect(fuzzyFirstHop.stdout).toContain('skill/verify-install.mjs');

      const symSlice = dispatchCommand(['zoom', 'mutateComponentWorkflowJit', '--source'], REPO_ROOT);
      expect(symSlice.exitCode).toBe(0);
      expect(symSlice.stdout).toContain('export function mutateComponentWorkflowJit');

      // 同批多符号 --source 对重复路径直连 ADR 自动去重，避免刷屏截断源码
      const batchSlice = dispatchCommand(['zoom', 'resolveCbmBinary', 'getCbmGraphSummary', '--source'], REPO_ROOT);
      expect(batchSlice.exitCode).toBe(0);
      expect(batchSlice.stdout).toContain('export function resolveCbmBinary');
      expect(batchSlice.stdout).toContain('export function getCbmGraphSummary');
      if (existsSync(join(REPO_ROOT, 'decisions'))) {
        expect(batchSlice.stdout).toContain('已于同批前文展示');
      }
    }
  });
});

describe('变焦驾驶舱 CBM 源码真值校正（导出重判、嵌套函数、幻影承重接口、模糊命中分级与分层排序）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-export-truth-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('JS 行首导出声明、export 列表本地名与默认导出被识别，局部与模板字符串内函数不算导出', () => {
    writeFileSync(join(tmp, 'a.mjs'), [
      'function helper() {}', 'export function pub() {}', 'export async function* gen() {}',
      'export default class Box {}', 'export const K = 1;', 'const a = 1, b = 2;',
      'export { a, b as renamed };', 'const html = `', '  function test(r) {}', '`;'
    ].join('\n'));
    const truth = readExportTruth(tmp, 'a.mjs');
    expect([...truth].sort()).toEqual(['Box', 'K', 'a', 'b', 'gen', 'pub']);
    expect(truth.has('helper')).toBe(false);
    expect(truth.has('test')).toBe(false);
  });

  it('Python 取列 0 非下划线 def/class；未知扩展名、缺失文件与纯 CJS 返回 null（沿用 CBM 原值）', () => {
    writeFileSync(join(tmp, 'm.py'), 'def run():\n    def inner():\n        pass\nasync def go():\n    pass\nclass Svc:\n    pass\ndef _private():\n    pass\n');
    expect([...readExportTruth(tmp, 'm.py')].sort()).toEqual(['Svc', 'go', 'run']);
    writeFileSync(join(tmp, 'c.cjs'), 'function f() {}\nmodule.exports = { f };\n');
    expect(readExportTruth(tmp, 'c.cjs')).toBeNull();
    writeFileSync(join(tmp, 'x.html'), '<script>function renderAll() {}</script>');
    expect(readExportTruth(tmp, 'x.html')).toBeNull();
    expect(readExportTruth(tmp, 'missing.mjs')).toBeNull();
  });

  it('嵌套函数打 nested 且一律非导出；幻影承重接口过滤不误伤类方法与未知扩展名；Kneedle 门面重导出同一实现', () => {
    const syms = [
      { name: 'outer', label: 'Function', startLine: 1, endLine: 10, isExported: false },
      { name: 'depthOf', label: 'Function', startLine: 3, endLine: 6, isExported: true },
      { name: 'other', label: 'Function', startLine: 12, endLine: 14, isExported: true }
    ];
    const fixed = applyExportTruthToSymbols(syms, new Set(['outer', 'depthOf']));
    expect(fixed.map((s) => [s.name, s.isExported, s.nested])).toEqual([['outer', true, false], ['depthOf', false, true], ['other', false, false]]);
    expect(applyExportTruthToSymbols(syms, null).map((s) => s.isExported)).toEqual([false, false, true]);
    expect(isPhantomHubTarget(tmp, { file: 'a.mjs', symbol: 'test', label: 'Function' })).toBe(true);
    expect(isPhantomHubTarget(tmp, { file: 'a.mjs', symbol: 'pub', label: 'Function' })).toBe(false);
    expect(isPhantomHubTarget(tmp, { file: 'a.mjs', symbol: 'render', label: 'Method' })).toBe(false);
    expect(isPhantomHubTarget(tmp, { file: 'x.html', symbol: 'renderAll', label: 'Function' })).toBe(false);
    expect(kneedleElbowCount).toBe(rawKneedle);
  });

  it('zoom rules 压缩子包与意图为字符串数组；无关符号查询不再假命中', () => {
    const rules = JSON.parse(dispatchCommand(['zoom', 'rules'], REPO_ROOT).stdout);
    expect(Array.isArray(rules.intent) && rules.intent.every((l) => typeof l === 'string' && l.trim())).toBe(true);
    expect(Array.isArray(rules.constraints)).toBe(true);
    for (const files of Object.values(rules.annotatedSubpacks)) expect(files.every((f) => typeof f === 'string' && f.includes(' ← '))).toBe(true);
    if (!resolveCbmBinary(REPO_ROOT)) return;
    const ghost = dispatchCommand(['zoom', 'no_such_thing_xyz'], REPO_ROOT);
    expect(ghost.exitCode).toBe(1);
    expect(ghost.stderr).toContain('未找到匹配');
    expect(dispatchCommand(['zoom', 'runVerifyInstall'], REPO_ROOT).stdout).toContain('未精确命中符号名');
    const fileView = dispatchCommand(['zoom', 'runner/cockpit/cockpit-commands.mjs'], REPO_ROOT).stdout;
    expect(fileView).toContain('↳ depthOf(');
    expect(fileView).not.toContain('export depthOf');
  });

  it('brief 契约段按层级单调输出且孤立卡标签准确', () => {
    const md = dispatchCommand(['brief'], REPO_ROOT).stdout;
    expect(md).toContain('去重函数名');
    if (!md.includes('密封契约卡分层边界')) return;
    const layers = [...md.matchAll(/^- \*\*\[L(\d+)\] `/gm)].map((m) => Number(m[1]));
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((v, i) => i === 0 || v >= layers[i - 1])).toBe(true);
    if (md.includes('`brick-observations`')) expect(md).toMatch(/`brick-observations`.*孤立卡/);
  });
});

function assertCostFooterMatches(stdout) {
  const m = stdout.match(/\n— 本视图约 (\d+) tok —$/);
  expect(m).not.toBeNull();
  expect(Number(m[1])).toBe(estimateTokens(stdout));
}

describe('S5 全视图 token 预算与成本自报（brief / zoom / impact）', () => {
  it('默认无 --budget 时 brief / zoom / impact 均在尾行自报精准视图 token 成本', () => {
    for (const args of [
      ['brief'],
      ['zoom', '03'],
      ['zoom', 'all'],
      ['impact', 'runner/cockpit/cockpit-render.mjs']
    ]) {
      const res = dispatchCommand(args, REPO_ROOT);
      expect(res.exitCode).toBe(0);
      assertCostFooterMatches(res.stdout);
    }
  });

  it('brief --budget 900、zoom all --budget 1800 与 impact runner/core --budget 900 遵守预算并带显式省略提示', () => {
    const brief900 = dispatchCommand(['brief', '--budget', '900'], REPO_ROOT);
    expect(brief900.exitCode).toBe(0);
    expect(estimateTokens(brief900.stdout)).toBeLessThanOrEqual(900);
    expect(estimateTokens(brief900.stdout)).toBeLessThanOrEqual(990);
    expect(brief900.stdout).toContain('已省略');
    expect(brief900.stdout).toContain('§');
    expect(brief900.stdout).toContain('展开命令：');
    assertCostFooterMatches(brief900.stdout);

    const zoom1800 = dispatchCommand(['zoom', 'all', '--budget', '1800'], REPO_ROOT);
    expect(zoom1800.exitCode).toBe(0);
    expect(estimateTokens(zoom1800.stdout)).toBeLessThanOrEqual(1800);
    expect(zoom1800.stdout).toContain('已省略');
    expect(zoom1800.stdout).toContain('展开命令：');
    assertCostFooterMatches(zoom1800.stdout);

    const impact900 = dispatchCommand(['impact', 'runner/core', '--budget', '900'], REPO_ROOT);
    expect(impact900.exitCode).toBe(0);
    expect(estimateTokens(impact900.stdout)).toBeLessThanOrEqual(900);
    expect(impact900.stdout).toContain('已省略');
    expect(impact900.stdout).toContain('展开命令：');
    assertCostFooterMatches(impact900.stdout);
  });

  it('--json 模式与单目标 zoom rules 保持纯 JSON 输出且不附加成本尾行', () => {
    for (const args of [
      ['brief', '--json', '--budget', '100'],
      ['impact', 'runner/core', '--json', '--budget', '100'],
      ['zoom', 'rules']
    ]) {
      const res = dispatchCommand(args, REPO_ROOT);
      expect(res.exitCode).toBe(0);
      expect(() => JSON.parse(res.stdout)).not.toThrow();
      expect(res.stdout).not.toContain('— 本视图约');
    }
  });

  it('非法 --budget（0 / 负数 / 非数字 / 无值布尔）与过小 --budget 5 在三命令均退 3', () => {
    for (const bad of ['0', '-5', 'abc']) {
      expect(dispatchCommand(['brief', '--budget', bad], REPO_ROOT).exitCode).toBe(3);
      expect(dispatchCommand(['zoom', '03', '--budget', bad], REPO_ROOT).exitCode).toBe(3);
      expect(dispatchCommand(['impact', 'runner/core', '--budget', bad], REPO_ROOT).exitCode).toBe(3);
    }
    expect(dispatchCommand(['brief', '--budget'], REPO_ROOT).exitCode).toBe(3);
    expect(dispatchCommand(['zoom', '03', '--budget'], REPO_ROOT).exitCode).toBe(3);
    expect(dispatchCommand(['impact', 'runner/core', '--budget'], REPO_ROOT).exitCode).toBe(3);

    expect(dispatchCommand(['brief', '--budget', '5'], REPO_ROOT).exitCode).toBe(3);
    expect(dispatchCommand(['zoom', '03', '--budget', '5'], REPO_ROOT).exitCode).toBe(3);
    expect(dispatchCommand(['impact', 'runner/core', '--budget', '5'], REPO_ROOT).exitCode).toBe(3);
  });

  it('applyBudget 保持段落顺序、支持单段行级截断且极小预算非静默提示', () => {
    const multiSec = [
      '# 概览\n第一部分简短导言。',
      `## 1. 第一节\n${'A'.repeat(180)}`,
      `## 2. 第二节\n${'B'.repeat(400)}`,
      `## 3. 第三节\n${'C'.repeat(400)}`
    ].join('\n\n');
    const clipped = applyBudget(multiSec, 130, 'node runner/donegate.mjs brief');
    expect(clipped).toContain('# 概览');
    expect(clipped).toContain('## 1. 第一节');
    expect(clipped).not.toContain('## 2. 第二节');
    expect(clipped.indexOf('# 概览')).toBeLessThan(clipped.indexOf('## 1. 第一节'));
    expect(clipped).toContain('已省略：');
    expect(clipped).toContain('展开命令：node runner/donegate.mjs brief');
    expect(estimateTokens(clipped)).toBeLessThanOrEqual(130);

    const singleSec = ['=== 单文件视图 ===', ...Array.from({ length: 40 }, (_, i) => `line-${i}: ${'x'.repeat(30)}`)].join('\n');
    const singleClipped = applyBudget(singleSec, 120, 'node runner/donegate.mjs zoom foo');
    expect(singleClipped).toContain('=== 单文件视图 ===');
    expect(singleClipped).toContain('line-0:');
    expect(singleClipped).toContain('余');
    expect(singleClipped).toContain('展开命令：node runner/donegate.mjs zoom foo');
    expect(estimateTokens(singleClipped)).toBeLessThanOrEqual(120);

    const tinyNotice = applyBudget(multiSec, 5, 'node runner/donegate.mjs brief');
    expect(tinyNotice).toContain('已省略：');
    expect(tinyNotice).toContain('展开命令：node runner/donegate.mjs brief');
  });
});

describe('S7 调用边置信度：符号与文件视图 ≈ 标注、桶转发与承重接口过滤', () => {
  it('walk 同名碰撞标为 inferred 并渲染 ≈，readJsonStrict 与桶转发调用判为 proven', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;
    const walkTrace = queryCbmSymbolTrace(REPO_ROOT, 'walk');
    expect(walkTrace).not.toBeNull();
    expect(walkTrace.callers.some((c) => c.file.startsWith('归档/pilots/') && c.trust === 'inferred')).toBe(true);
    expect(walkTrace.callers.some((c) => c.file === 'runner/core/cockpit-cache.mjs' && c.trust === 'proven')).toBe(true);

    const walkZoom = dispatchCommand(['zoom', 'walk'], REPO_ROOT);
    expect(walkZoom.exitCode).toBe(0);
    expect(walkZoom.stdout).toContain('≈');

    const aiHabitsGraph = queryCbmFileGraph(REPO_ROOT, 'skill/check-ai-habits.mjs');
    expect(aiHabitsGraph.inboundCallers.some((c) => c.file.startsWith('归档/pilots/') && c.trust === 'inferred')).toBe(true);
    const aiHabitsZoom = dispatchCommand(['zoom', 'skill/check-ai-habits.mjs'], REPO_ROOT);
    expect(aiHabitsZoom.exitCode).toBe(0);
    expect(aiHabitsZoom.stdout).toContain('≈');

    const rjTrace = queryCbmSymbolTrace(REPO_ROOT, 'readJsonStrict');
    expect(rjTrace.callers.some((c) => c.file === 'runner/core/gate-checks.mjs' && c.trust === 'proven')).toBe(true);
    expect(rjTrace.callers.some((c) => c.file === 'runner/core/cockpit-cbm.mjs' && c.trust === 'proven')).toBe(true);

    const estTrace = queryCbmSymbolTrace(REPO_ROOT, 'estimateTokens');
    expect(estTrace.callers.some((c) => c.file === 'runner/cockpit/cockpit-locate.mjs' && c.trust === 'proven')).toBe(true);

    const impTrace = queryCbmSymbolTrace(REPO_ROOT, 'cmdImpact');
    expect(impTrace.callers.some((c) => c.file === 'runner/donegate.mjs' && c.trust === 'proven')).toBe(true);
  });

  it('queryCbmContractHubs 排除 inferred 调用边并保留 proven 跨文件调用统计', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;
    const ownerMap = new Map([
      ['skill/check-ai-habits.mjs', ['gate-tooling']],
      ['skill/fs-walk.mjs', ['shared-primitives']]
    ]);
    const hubs = queryCbmContractHubs(REPO_ROOT, ownerMap, ['gate-tooling', 'shared-primitives'], false);
    expect(hubs.hubsByContract['gate-tooling'].totalExported).toBe(0);
    expect(hubs.hubsByContract['shared-primitives'].selectedIntra.some((s) => s.signature.startsWith('walk('))).toBe(true);
  });
});
