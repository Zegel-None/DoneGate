// 适配器 · Pyright 跨文件静态类型与属性签名观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'pyright',
  defaultRole: 'soft',
  timeoutMs: 180000,
  degradedTo: '人工核对跨文件函数签名、返回类型与对象属性调用关系',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--outputjson', ctx.arg('--target', '.')]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'pyright 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'pyright');
    if (!parsed || typeof parsed !== 'object' || !parsed.summary || !Array.isArray(parsed.generalDiagnostics)) {
      ctx.fail(3, 'pyright 报告缺少 summary 或 generalDiagnostics 字段');
    }
    const sum = parsed.summary;
    if (typeof sum.errorCount !== 'number' || typeof sum.filesAnalyzed !== 'number') {
      ctx.fail(3, 'pyright summary 缺少数值型 errorCount / filesAnalyzed');
    }
    const byRule = {}, fileSet = new Set();
    for (const d of parsed.generalDiagnostics) {
      const rule = d && d.rule ? String(d.rule) : 'unruled';
      byRule[rule] = (byRule[rule] || 0) + 1;
      if (d && d.file) fileSet.add(String(d.file));
    }
    const observation = {
      filesAnalyzed: Number(sum.filesAnalyzed || 0),
      errorCount: Number(sum.errorCount || 0),
      warningCount: Number(sum.warningCount || 0),
      informationCount: Number(sum.informationCount || 0),
      filesWithDiagnostics: fileSet.size,
      byRule
    };
    return {
      rawJson: parsed,
      observation,
      claimText: `Pyright ${ctx.toolVer} 分析 ${observation.filesAnalyzed} 个文件，检出类型 error ${observation.errorCount}、warning ${observation.warningCount}，明细见 ${ctx.obsRelPath}`,
      summaryLog: `files=${observation.filesAnalyzed}, errors=${observation.errorCount}`
    };
  }
});
