// 适配器 · Playwright Web 真实浏览器端到端观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'playwright',
  defaultRole: 'hard',
  degradedTo: '人工在桌面与移动端浏览器逐页点测全部交互路径与控制台报错',
  collect(ctx) {
    const rawOv = ctx.arg('--raw-report');
    let rawText, reportSource = '';
    if (rawOv) {
      const abs = resolve(ctx.rootDir, rawOv);
      rawText = ctx.checkFreshFileOrFail(abs, rawOv, ctx.dryRun, ctx.headCommitSec, '陈旧 Playwright 报告退 3').toString('utf8');
      reportSource = ctx.relPath(abs);
    } else if (['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some((f) => existsSync(join(ctx.rootDir, f)))) {
      const r = ctx.runBin(['test', '--reporter=json']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'playwright test 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
      reportSource = 'playwright-cli';
    } else {
      const cand = ['playwright-report/results.json', 'test-results.json', '.donegate/playwright-results.json']
        .map((p) => join(ctx.rootDir, p)).find((p) => existsSync(p));
      if (!cand) ctx.fail(3, '未找到 playwright.config.* 或 Playwright JSON 报告');
      rawText = ctx.checkFreshFileOrFail(cand, ctx.relPath(cand), ctx.dryRun, ctx.headCommitSec, '陈旧 Playwright 报告退 3').toString('utf8');
      reportSource = ctx.relPath(cand);
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'Playwright 报告');
    if (!parsed || typeof parsed !== 'object' || (!parsed.stats && !Array.isArray(parsed.suites))) {
      ctx.fail(3, 'Playwright 报告缺少 stats 或 suites 字段');
    }
    const stats = parsed.stats || {};
    const expectedCount = Number(stats.expected || 0), unexpectedCount = Number(stats.unexpected || 0);
    const flakyCount = Number(stats.flaky || 0), skippedCount = Number(stats.skipped || 0);
    const totalSpecs = expectedCount + unexpectedCount + flakyCount + skippedCount;
    if (totalSpecs === 0 && Array.isArray(parsed.suites) && parsed.suites.length === 0) ctx.fail(3, 'Playwright 报告用例数为 0（防空跑退 3）');
    const unexpectedSpecs = [];
    const walkSuite = (s) => {
      for (const sp of (s.specs || [])) {
        if (sp.ok === false || (Array.isArray(sp.tests) && sp.tests.some((t) => t.status === 'unexpected'))) unexpectedSpecs.push(String(sp.title || sp.id || 'unnamed'));
      }
      for (const ch of (s.suites || [])) walkSuite(ch);
    };
    for (const s of (parsed.suites || [])) walkSuite(s);
    const observation = { reportSource, totalSpecs, expectedCount, unexpectedCount, flakyCount, skippedCount, unexpectedSpecs };
    return {
      rawJson: parsed,
      observation,
      unresolved: flakyCount > 0 ? [`存在 ${flakyCount} 条 flaky 波动用例`] : [],
      claimText: `Web E2E 共 ${totalSpecs} 项（expected=${expectedCount}, unexpected=${unexpectedCount}, flaky=${flakyCount}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `expected=${expectedCount}, unexpected=${unexpectedCount}`
    };
  }
});
