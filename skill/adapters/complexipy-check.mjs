// 适配器 · Complexipy Python 认知复杂度观测（Campbell 2018 · Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'complexipy',
  defaultRole: 'soft',
  degradedTo: '使用 python3 ast 人工核查深层嵌套函数，将单函数认知复杂度控制在 25 以内',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    const maxAllowed = Number(ctx.arg('--max-complexity', '25')) || 25;
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin([targetDir, '--max-complexity-allowed', String(maxAllowed), '--output-format', 'json']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'complexipy 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'complexipy');
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.functions) ? parsed.functions : null);
    if (!list) ctx.fail(3, 'complexipy 报告缺少函数复杂度数组');
    const offenders = [];
    let maxComplexity = 0;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const cx = Number(item.complexity ?? item.cognitive_complexity ?? 0);
      if (cx > maxComplexity) maxComplexity = cx;
      if (cx > maxAllowed) {
        offenders.push({ file: String(item.path || item.file || ''), fn: String(item.function_name || item.name || ''), complexity: cx });
      }
    }
    const observation = {
      functionsAnalyzed: list.length,
      maxAllowed,
      maxComplexity,
      overThresholdCount: offenders.length,
      offenders: offenders.slice(0, 30)
    };
    return {
      rawJson: parsed,
      observation,
      claimText: `Complexipy ${ctx.toolVer} 对 ${targetDir} 分析 ${list.length} 个 Python 函数，最高认知复杂度 ${maxComplexity}，超过上限 ${maxAllowed} 共 ${offenders.length} 个，明细见 ${ctx.obsRelPath}`,
      summaryLog: `analyzed=${list.length}, max=${maxComplexity}, overThreshold=${offenders.length}`
    };
  }
});
