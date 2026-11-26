// 适配器 · Pytest Python 单元与集成测试观测（支持 xdist_group · Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

function parsePytestSummaryText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let targetLine = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\b\d+\s+(?:passed|failed|skipped|errors?|xfailed|xpassed|deselected)\b/i.test(lines[i])) {
      targetLine = lines[i];
      break;
    }
  }
  const pick = (kw) => {
    const m = targetLine.match(new RegExp(`(\\d+)\\s+${kw}\\b`, 'i'));
    return m ? Number(m[1]) : 0;
  };
  return {
    passedCount: pick('passed'),
    failedCount: pick('failed'),
    skippedCount: pick('skipped'),
    errorCount: pick('errors?')
  };
}

runAdapter({
  tool: 'pytest',
  defaultRole: 'soft',
  degradedTo: '直接执行 python -m unittest discover 核验核心用例并记录退出码',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    const expr = ctx.arg('--k', '');
    let rawText = ctx.readRawOverride('--raw-report');
    let parsed = null;
    let binExitStatus = null;
    if (rawText === null) {
      const args = ['-q', '--tb=short', ...(expr ? ['-k', expr] : []), targetDir];
      const r = ctx.runBin(args);
      if (r.error || (r.status !== 0 && r.status !== 1 && r.status !== 5)) {
        ctx.fail(3, 'pytest 执行失败：' + (r.stderr || r.error?.message));
      }
      binExitStatus = r.status;
      rawText = (r.stdout || '') + '\n' + (r.stderr || '');
    }
    const trimmed = rawText.trim();
    let counts;
    if (trimmed.startsWith('{')) {
      parsed = ctx.parseJsonOrFail(trimmed, 'pytest');
      const sm = parsed.summary || parsed;
      counts = {
        passedCount: Number(sm.passedCount ?? sm.passed ?? 0),
        failedCount: Number(sm.failedCount ?? sm.failed ?? 0),
        skippedCount: Number(sm.skippedCount ?? sm.skipped ?? 0),
        errorCount: Number(sm.errorCount ?? sm.error ?? 0)
      };
    } else {
      counts = parsePytestSummaryText(trimmed);
      if (binExitStatus === 1 && counts.failedCount === 0 && counts.errorCount === 0) {
        counts.errorCount = 1;
      }
      parsed = { rawSummary: trimmed.slice(0, 4000), ...counts };
    }
    const totalCount = counts.passedCount + counts.failedCount + counts.skippedCount + counts.errorCount;
    const observation = { totalCount, ...counts };
    return {
      rawJson: parsed,
      observation,
      claimText: `Pytest ${ctx.toolVer} 对 ${targetDir} 运行 ${totalCount} 项用例（通过 ${counts.passedCount}、失败 ${counts.failedCount}、错误 ${counts.errorCount}、跳过 ${counts.skippedCount}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `total=${totalCount}, failed=${counts.failedCount}, errors=${counts.errorCount}`
    };
  }
});
