// 适配器 · Astral ty Python 高速类型检查观测（Rust 单二进制 · Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'ty',
  defaultRole: 'soft',
  degradedTo: '使用 basedpyright --writebaseline 或 pyright 逐模块核查跨文件参数与返回类型',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['check', '--output-format', 'gitlab', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'ty check 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '[]';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'ty');
    const diags = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : null);
    if (!diags) ctx.fail(3, 'ty 报告缺少诊断数组');
    let errorCount = 0;
    let warningCount = 0;
    const fileSet = new Set();
    for (const d of diags) {
      if (!d || typeof d !== 'object') continue;
      const sev = String(d.severity || 'major').toLowerCase();
      if (sev === 'info' || sev === 'minor' || sev === 'warning') warningCount++;
      else errorCount++;
      const fp = d.location?.path || d.file || d.path || '';
      if (fp) fileSet.add(String(fp));
    }
    const observation = { errorCount, warningCount, totalDiagnostics: diags.length, filesWithDiagnostics: fileSet.size };
    return {
      rawJson: parsed,
      observation,
      claimText: `Astral ty ${ctx.toolVer} 对 ${targetDir} 检出类型错误 ${errorCount} 条、警告 ${warningCount} 条，涉及 ${fileSet.size} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `errors=${errorCount}, warnings=${warningCount}`
    };
  }
});
