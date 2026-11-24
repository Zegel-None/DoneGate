// 适配器 · Maestro 移动端模拟器 UI 流程观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'maestro',
  defaultRole: 'hard',
  env: { MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
  binFallbacks: (home) => [join(home, 'maestro', 'bin', 'maestro.bat'), join(home, '.maestro', 'bin', 'maestro')],
  degradedTo: '人工在 Android 模拟器与 iOS 真机逐条点击验证 App 界面流',
  collect(ctx) {
    const rawOv = ctx.arg('--raw-report');
    let rawText, reportSource = '';
    if (rawOv) {
      const abs = resolve(ctx.rootDir, rawOv);
      rawText = ctx.checkFreshFileOrFail(abs, rawOv, ctx.dryRun, ctx.headCommitSec, '陈旧 Maestro 报告退 3').toString('utf8');
      reportSource = ctx.relPath(abs);
    } else {
      const flowTarget = ctx.arg('--flows', existsSync(join(ctx.rootDir, '.maestro')) ? '.maestro' : (existsSync(join(ctx.rootDir, 'maestro')) ? 'maestro' : null));
      if (!flowTarget) ctx.fail(3, '未找到 .maestro/ 或 maestro/ 用例目录（可传 --flows 或 --raw-report）');
      rawText = ctx.withTempDir('maestro-out-', (tmpOut) => {
        const outXml = join(tmpOut, 'maestro-junit.xml');
        const r = ctx.runBin(['test', '--no-ansi', '--format', 'JUNIT', '--output', outXml, flowTarget]);
        if (r.error || !existsSync(outXml)) ctx.fail(3, 'maestro test 执行失败或未产出 JUNIT 报告：' + (r.stderr || r.stdout));
        return readFileSync(outXml, 'utf8');
      });
      reportSource = flowTarget;
    }
    if (!rawText.trim()) ctx.fail(3, 'Maestro 报告内容为空');
    let totalFlows = 0, failureCount = 0, errorCount = 0, skippedCount = 0;
    const failingFlows = [];
    if (rawText.trim().startsWith('{')) {
      const parsed = ctx.parseJsonOrFail(rawText, 'Maestro JSON 报告');
      if (!parsed || typeof parsed.totalFlows !== 'number') ctx.fail(3, 'Maestro JSON 报告缺少 totalFlows');
      totalFlows = parsed.totalFlows;
      failureCount = Number(parsed.failureCount || 0);
      errorCount = Number(parsed.errorCount || 0);
      skippedCount = Number(parsed.skippedCount || 0);
      if (Array.isArray(parsed.failingFlows)) failingFlows.push(...parsed.failingFlows.map(String));
    } else {
      if (!/<testsuite\b/i.test(rawText)) ctx.fail(3, 'Maestro JUNIT XML 报告损坏（缺少 <testsuite>）');
      for (const m of rawText.matchAll(/<testsuite\b([^>]*)>/gi)) {
        const num = (k) => Number((m[1].match(new RegExp(`\\b${k}=["'](\\d+)["']`)) || [])[1] || 0);
        totalFlows += num('tests');
        failureCount += num('failures');
        errorCount += num('errors');
        skippedCount += num('skipped');
      }
      for (const m of rawText.matchAll(/<testcase\b([^>]*[^/])>([\s\S]*?)<\/testcase>/gi)) {
        if (/<(?:failure|error)\b/i.test(m[2])) failingFlows.push((m[1].match(/\bname=["']([^"']+)["']/) || [])[1] || 'unnamed-flow');
      }
    }
    if (totalFlows === 0) ctx.fail(3, 'Maestro 用例数为 0（防空跑退 3）');
    const completedFlows = Math.max(0, totalFlows - failureCount - errorCount - skippedCount);
    const observation = { reportSource, totalFlows, completedFlows, failureCount, errorCount, skippedCount, failingFlows };
    return {
      rawFileName: rawText.trim().startsWith('{') ? 'raw-maestro.json' : 'raw-maestro.xml',
      rawContent: rawText,
      observation,
      claimText: `移动端 UI 流共 ${totalFlows} 条（completed=${completedFlows}, failures=${failureCount}, errors=${errorCount}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `flows=${totalFlows}, failures=${failureCount}`
    };
  }
});
