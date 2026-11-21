// 砂浆适配器 · dependency-cruiser 依赖方向与环路观测（Mortar Protocol v1.1 · 0 模块退 3，委托 _shared.mjs）
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'depcruise',
  defaultRole: 'hard',
  degradedTo: '人工按同一格式静态核查模块 import 方向与循环依赖',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--output-type', 'json', '--no-progress', ctx.arg('--target', '.')]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'depcruise 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'depcruise');
    if (!parsed || !Array.isArray(parsed.modules) || !parsed.summary) ctx.fail(3, 'depcruise 报告缺少 modules 或 summary');
    if (parsed.modules.length === 0) ctx.fail(3, 'depcruise 巡航到 0 个模块（防空跑假绿退 3）');
    const violations = (parsed.summary.violations || []).map((v) => ({
      rule: v.rule?.name || 'unknown',
      from: String(v.from || '').replace(/\\/g, '/'),
      to: String(v.to || '').replace(/\\/g, '/')
    }));
    const observation = { modulesCount: parsed.modules.length, violationCount: violations.length, violations };
    return {
      rawJson: parsed,
      observation,
      claimText: `depcruise 巡航 ${parsed.modules.length} 个模块，检出 ${violations.length} 条规则违例，明细见 ${ctx.obsRelPath}`,
      summaryLog: `modules=${parsed.modules.length}, violations=${violations.length}`
    };
  }
});
