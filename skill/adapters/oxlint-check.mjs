// 适配器 · Oxlint Rust 高速 JS/TS 语义正确性静态观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

function tallyOxlintDiagnostics(diagnostics, fail) {
  const byRule = {}, fileSet = new Set();
  let errorCount = 0, warningCount = 0;
  for (const d of diagnostics) {
    if (!d || typeof d !== 'object' || typeof d.message !== 'string') {
      fail(3, 'oxlint 诊断条目缺少 message 字段');
    }
    const sev = String(d.severity || 'warning').toLowerCase();
    if (sev === 'error') errorCount++;
    else warningCount++;
    const ruleKey = String(d.code || 'unknown');
    byRule[ruleKey] = (byRule[ruleKey] || 0) + 1;
    if (d.filename) fileSet.add(String(d.filename));
  }
  return { errorCount, warningCount, filesWithDiagnostics: fileSet.size, byRule };
}

runAdapter({
  tool: 'oxlint',
  defaultRole: 'soft',
  degradedTo: '人工审查 JS/TS 死循环方向、常量重赋值、重复对象键与可疑条件分支',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--format', 'json', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'oxlint 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'oxlint');
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.diagnostics)) {
      ctx.fail(3, 'oxlint 报告缺少 diagnostics 数组字段');
    }
    const filesScanned = Number(parsed.number_of_files ?? 0);
    if (ctx.arg('--raw-report') === null && filesScanned === 0) {
      ctx.fail(3, 'oxlint 扫描到 0 个 JS/TS 文件（防空跑假绿退 3）');
    }
    const stats = tallyOxlintDiagnostics(parsed.diagnostics, ctx.fail);
    const observation = { ...stats, diagnosticsCount: parsed.diagnostics.length, filesScanned };
    return {
      rawJson: parsed,
      observation,
      claimText: `Oxlint ${ctx.toolVer} 扫描 ${filesScanned} 个文件检出 error ${stats.errorCount}、warning ${stats.warningCount}，涉及 ${stats.filesWithDiagnostics} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `errors=${stats.errorCount}, warnings=${stats.warningCount}, files=${filesScanned}`
    };
  }
});
