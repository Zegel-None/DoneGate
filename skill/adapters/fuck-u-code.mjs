// 砂浆适配器 · fuck-u-code 复杂度观测（Mortar Protocol v1.1 · 委托 _shared.mjs）
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'fuck-u-code',
  defaultRole: 'soft',
  degradedTo: '人工按同一格式手写圈复杂度与高风险文件清单',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['analyze', ctx.arg('--target', '.'), '-f', 'json']);
      if (r.error || r.status !== 0) ctx.fail(3, 'fuck-u-code analyze 失败：' + (r.stderr || r.stdout));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'fuck-u-code');
    if (!parsed || typeof parsed !== 'object') ctx.fail(3, 'fuck-u-code 输出缺少对象根节点');
    const rawFiles = Array.isArray(parsed.files) ? parsed.files : (Array.isArray(parsed.topFiles) ? parsed.topFiles : []);
    const hotFiles = rawFiles.slice(0, 20).map((f) => {
      const metrics = Array.isArray(f.metrics) ? f.metrics : [];
      const cyc = metrics.find((m) => m && m.name === 'cyclomatic_complexity');
      const warnCount = metrics.filter((m) => m && ['warning', 'error', 'critical'].includes(m.severity)).length;
      return {
        file: String(f.file || f.path || f.name || '').replace(/\\/g, '/'),
        issuesCount: Number(f.issuesCount || f.issues?.length || warnCount || 0),
        complexity: Number(f.complexity || f.cyclomaticComplexity || cyc?.value || 0)
      };
    });
    const observation = { filesAnalyzed: Number(parsed.summary?.totalFiles || parsed.totalFiles || hotFiles.length), hotFiles };
    return {
      rawFileName: 'raw-fuc.json',
      rawJson: parsed,
      observation,
      claimText: `扫描 ${observation.filesAnalyzed} 个文件并提取 ${hotFiles.length} 条复杂度读数，明细见 ${ctx.obsRelPath}`,
      summaryLog: `files=${observation.filesAnalyzed}`
    };
  }
});
