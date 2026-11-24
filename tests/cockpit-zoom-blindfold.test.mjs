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

  it('donegate brief 生成五大业务域、51 条 DSH 路由、平衡括号函数签名与实时四维阈值', () => {
    const res = dispatchCommand(['brief'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('主控全局根视口（Zoom-0');
    expect(res.stdout).toContain('[01] 沟通需求与定好验收标准');
    expect(res.stdout).toContain('[02] 界面实时预览与分派助手');
    expect(res.stdout).toContain('物理目录：`runner/dsh/`');
    expect(res.stdout).toContain('HTTP 路由：52 条');
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
    expect(cmdZoom.stdout).toContain('批处理执行步骤');
    expect(cmdZoom.stdout).not.toContain('export cmd:');

    const pfZoom = dispatchCommand(['zoom', 'skill/preflight-subagent.mjs'], REPO_ROOT);
    expect(pfZoom.stdout).toContain('--expect-branch');
    expect(pfZoom.stdout).toContain('--node');
    expect(pfZoom.stdout).toContain('--target-node');
  });
});
