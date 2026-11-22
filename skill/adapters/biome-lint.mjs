// 适配器 · Biome 静态检查观测（Adapter Protocol v1.1 · 遵守 .gitignore 排除生成物，委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'biome',
  defaultRole: 'soft',
  degradedTo: '人工读 diff 并对照 Biome 规则文档逐条确认可疑写法',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['lint', '--reporter=json', '--vcs-enabled=true', '--vcs-client-kind=git', '--vcs-use-ignore-file=true', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'biome lint 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'biome');
    if (!parsed || typeof parsed !== 'object' || !parsed.summary || !Array.isArray(parsed.diagnostics)) {
      ctx.fail(3, 'biome 报告缺少 summary / diagnostics 字段');
    }
    const summary = parsed.summary || {};
    const byCategory = {};
    const fileSet = new Set();
    for (const d of parsed.diagnostics) {
      const cat = String(d.category || 'unknown');
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (d.location && d.location.path) fileSet.add(String(d.location.path));
    }
    const observation = {
      errors: Number(summary.errors || 0),
      warnings: Number(summary.warnings || 0),
      infos: Number(summary.infos || 0),
      diagnosticsCount: parsed.diagnostics.length,
      filesWithDiagnostics: fileSet.size,
      byCategory
    };
    return {
      rawJson: parsed,
      observation,
      claimText: `Biome ${ctx.toolVer} 对 ${targetDir} 检出 error ${observation.errors}、warning ${observation.warnings}，涉及 ${observation.filesWithDiagnostics} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `errors=${observation.errors}, warnings=${observation.warnings}`
    };
  }
});
