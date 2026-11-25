// 主控零魔法数字三级变焦驾驶舱（donegate brief + donegate zoom + CBM 图谱底座 + 末步直读源码 + 1-Hop 单测反推）端到端单测
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { kneedleElbowCount, resolveCbmBinary } from '../runner/core/index.mjs';

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

  it('donegate brief 生成五大业务域、51 条 DSH 路由、平衡括号函数签名与实时四维阈值', () => {
    const res = dispatchCommand(['brief'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('主控全局根视口（Zoom-0');
    expect(res.stdout).toContain('[01] 沟通需求与定好验收标准');
    expect(res.stdout).toContain('[02] 界面实时预览与分派助手');
    expect(res.stdout).toContain('物理目录：`runner/dsh/`');
    expect(res.stdout).toContain('HTTP 路由：53 条');
    expect(res.stdout).toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.01 项目基础设置与测试开关');
    expect(res.stdout).not.toContain('01.00 先把想法聊透、列好验收清单(1项) → 01.02');
    expect(res.stdout).toContain('[03] 可视化项目看板与过夜挂机');
    expect(res.stdout).toContain('exportDashboardHtml(projectRoot, outPath, opts)');
    expect(res.stdout).not.toContain("dashboard.html'), opts)");
    expect(res.stdout).toContain('四维门禁实时阈值');

    const jsonRes = dispatchCommand(['brief', '--json'], REPO_ROOT);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.domains).toBeGreaterThanOrEqual(4);
    expect(parsed.moduleCount).toBeGreaterThan(150);
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

  it('donegate zoom Zoom-2 穿透嵌套模板字符串、早退守卫路由、代码生成模板、CLI 标志与 .cmd 脚本', () => {
    const wfDepsZoom = dispatchCommand(['zoom', 'runner/dsh/workflow-deps.mjs'], REPO_ROOT);
    expect(wfDepsZoom.exitCode).toBe(0);
    expect(wfDepsZoom.stdout).toContain('provisionWorkflowDeps(projectRoot, pack, opts = {})');
    expect(wfDepsZoom.stdout).toContain('runWorkflowDepsCli(argv = process.argv.slice(2), defaultRoot = process.cwd())');

    const hostZoom = dispatchCommand(['zoom', 'runner/dsh/host-routes.mjs'], REPO_ROOT);
    expect(hostZoom.exitCode).toBe(0);
    expect(hostZoom.stdout).toContain('POST /donegate/api/workflow-pack/save');

    const codegenZoom = dispatchCommand(['zoom', 'runner/dsh/dg-deps-cli-gen.mjs'], REPO_ROOT);
    expect(codegenZoom.exitCode).toBe(0);
    expect(codegenZoom.stdout).toContain('[codegen] function writeJsonAtomic(filePath, data)');

    const verifyZoom = dispatchCommand(['zoom', 'skill/verify-install.mjs'], REPO_ROOT);
    expect(verifyZoom.exitCode).toBe(0);
    expect(verifyZoom.stdout).toContain('--install');
    expect(verifyZoom.stdout).toContain('runner/dsh/install-dsh-web.mjs');

    const cmdFileZoom = dispatchCommand(['zoom', 'install-dsh-web.cmd'], REPO_ROOT);
    expect(cmdFileZoom.exitCode).toBe(0);
    expect(cmdFileZoom.stdout).toContain('winget install');

    const graphZoom = dispatchCommand(['zoom', 'runner/atlas/wb-graph-engine.mjs'], REPO_ROOT);
    expect(graphZoom.exitCode).toBe(0);
    expect(graphZoom.stdout).toContain('[browser] function createGroupFromNodes(nodeIds, opts = {})');

    const hygieneZoom = dispatchCommand(['zoom', 'skill/check-commit-hygiene.mjs'], REPO_ROOT);
    expect(hygieneZoom.exitCode).toBe(0);
    expect(hygieneZoom.stdout).not.toContain('/api/items');
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

  it('跨进程单飞文件锁缓存：回收死进程残留锁并防止多子进程冷启动惊群重算，且提取顶层箭头函数与 %~dp0 路径', async () => {
    const { mkdtempSync, rmSync, writeFileSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { spawn } = await import('node:child_process');
    const cacheDir = mkdtempSync(join(tmpdir(), 'dg-sf-cache-'));
    try {
      const { computeQuickRepoFingerprint, CK_CACHE_SCHEMA } = await import('../runner/core/cockpit-cache.mjs');
      const { spawnSync } = await import('node:child_process');
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

      const skillsZoom = dispatchCommand(['zoom', 'skill/check-skills.mjs'], REPO_ROOT);
      expect(skillsZoom.exitCode).toBe(0);
      expect(skillsZoom.stdout).toContain('function parseFrontmatter(text)');
      expect(skillsZoom.stdout).toContain('function checkSkill(dir)');
      expect(skillsZoom.stdout).toContain('function runCheck(root)');

      const cmdZoom = dispatchCommand(['zoom', 'install-dsh-web.cmd'], REPO_ROOT);
      expect(cmdZoom.exitCode).toBe(0);
      expect(cmdZoom.stdout).toContain('skill/verify-install.mjs');
      expect(cmdZoom.stdout).not.toContain('dp0skill/verify-install.mjs');
      expect(cmdZoom.stdout).not.toContain('Node.js');

      const verZoom = dispatchCommand(['zoom', 'skill/verify-install.mjs'], REPO_ROOT);
      expect(verZoom.stdout).toContain('runner/atlas/index.mjs');
      expect(verZoom.stdout).toContain('runner/dsh/workflow-deps.mjs');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('闭世界引用完整性：zoom all、单测文件、根配置文件均可直接下钻，且无 export re-export 或 export cmd 冗余前缀', () => {
    const allRes = dispatchCommand(['zoom', 'all'], REPO_ROOT);
    expect(allRes.exitCode).toBe(0);
    expect(allRes.stdout).toContain('[01]');
    expect(allRes.stdout).toContain('[05]');

    const testZoom = dispatchCommand(['zoom', 'tests/verify-install.test.mjs', 'stryker.config.mjs', 'vitest.config.mjs'], REPO_ROOT);
    expect(testZoom.exitCode).toBe(0);
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件结构大纲] tests/verify-install.test.mjs ===');
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件结构大纲] stryker.config.mjs ===');
    expect(testZoom.stdout).toContain('=== [Zoom-2 单文件结构大纲] vitest.config.mjs ===');

    const dshIdxZoom = dispatchCommand(['zoom', 'runner/dsh/index.mjs'], REPO_ROOT);
    expect(dshIdxZoom.exitCode).toBe(0);
    expect(dshIdxZoom.stdout).not.toContain('export re-export');

    const cmdZoom = dispatchCommand(['zoom', 'install-dsh-web.cmd'], REPO_ROOT);
    expect(cmdZoom.stdout).toContain('脚本执行步骤');
    expect(cmdZoom.stdout).not.toContain('export cmd:');

    const pfZoom = dispatchCommand(['zoom', 'skill/preflight-subagent.mjs'], REPO_ROOT);
    expect(pfZoom.stdout).toContain('--expect-branch');
    expect(pfZoom.stdout).toContain('--node');
    expect(pfZoom.stdout).toContain('--target-node');
  });

  it('L1 根因回归：最内层括号作用域 HTTP 方法推导、内联脚本结构识别、配对引号数组、顶层对象键与 Tarjan 缩点序', () => {
    const srvZoom = dispatchCommand(['zoom', 'runner/atlas/serve-atlas.mjs'], REPO_ROOT);
    expect(srvZoom.exitCode).toBe(0);
    expect(srvZoom.stdout).toContain('POST /api/workbench/import-project');
    expect(srvZoom.stdout).not.toContain('GET /api/workbench/import-project');
    expect(srvZoom.stdout).toContain('--port');
    expect(srvZoom.stdout).toContain('--root');

    const hostZoom = dispatchCommand(['zoom', 'runner/dsh/host-routes.mjs'], REPO_ROOT);
    expect(hostZoom.stdout).toContain('POST /donegate/api/workflow-deps/refresh');
    expect(hostZoom.stdout).not.toContain('GET /donegate/api/workflow-deps/refresh');
    expect(hostZoom.stdout).toContain('POST /donegate/api/workflow-deps/provision');
    expect(hostZoom.stdout).not.toContain('GET /donegate/api/workflow-deps/provision');
    expect(hostZoom.stdout).toContain('POST /donegate/api/workflow-deps/inspect');
    expect(hostZoom.stdout).toContain('POST /donegate/api/atlas/refresh');
    expect(hostZoom.stdout).not.toContain('GET /donegate/api/atlas/refresh');

    const chatZoom = dispatchCommand(['zoom', 'runner/dsh/client-chat-extract.mjs', 'runner/dsh/subagent-isolation.mjs', 'runner/dsh/shared-pool-installer.mjs', 'runner/atlas/wb-catalog.mjs'], REPO_ROOT);
    expect(chatZoom.exitCode).toBe(0);
    expect(chatZoom.stdout).toContain('[browser] function parseUserQuoteTags(rawText)');
    expect(chatZoom.stdout).toContain('[browser] function DoneGateSubagentReadOnlyComposer(props)');
    expect(chatZoom.stdout).toContain("POSIX_NULL_SINK = ['', 'd', 'ev', 'null']");
    const hookZoom = dispatchCommand(['zoom', '.githooks/pre-commit'], REPO_ROOT);
    if (existsSync(join(REPO_ROOT, '.githooks/pre-commit'))) {
      expect(hookZoom.exitCode).toBe(0);
      expect(hookZoom.stdout).toContain('脚本执行步骤');
      expect(hookZoom.stdout).toContain('SHARED_GOVERNANCE_GLOBS');
    }
    expect(chatZoom.stdout).not.toContain("Object.freeze({\n");

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

  it('三步聚焦新底座：CBM 图谱符号 2-Hop 追踪、路径直连 ADR 挂载、多主题容错批处理与 --source 末步直读源码', () => {
    const multiTopics = dispatchCommand(['zoom', 'rules', 'tests', 'gaps'], REPO_ROOT);
    expect(multiTopics.exitCode).toBe(0);
    expect(multiTopics.stdout).toContain('"thresholds"');
    expect(multiTopics.stdout).toContain('=== 全仓单测与夹具目录');
    expect(multiTopics.stdout).toContain('=== 本地分支雷达 ===');

    const partialBatch = dispatchCommand(['zoom', 'install-dsh-web.cmd', 'runner/dsh/nonexistent-ghost.mjs'], REPO_ROOT);
    expect(partialBatch.exitCode).toBe(1);
    expect(partialBatch.stdout).toContain('=== [Zoom-2 单文件结构大纲] install-dsh-web.cmd ===');
    expect(partialBatch.stdout).toContain('部分目标未命中告警');

    const wbEvents = dispatchCommand(['zoom', 'runner/atlas/wb-events-actions.mjs', 'runner/dsh/ui-aesthetics.mjs'], REPO_ROOT);
    expect(wbEvents.exitCode).toBe(0);
    expect(wbEvents.stdout).not.toContain('WB_EVENTS_ACTIONS_PART1 =');
    expect(wbEvents.stdout.length).toBeLessThan(12000);

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

      const symSlice = dispatchCommand(['zoom', 'mutateComponentWorkflowJit', '--source'], REPO_ROOT);
      expect(symSlice.exitCode).toBe(0);
      expect(symSlice.stdout).toContain('export function mutateComponentWorkflowJit');
    }
  });
});
