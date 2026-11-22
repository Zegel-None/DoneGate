// 适配器 · Ruff Python 静态错误与幻觉符号观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'ruff',
  defaultRole: 'soft',
  degradedTo: '使用 python3 -m py_compile 逐文件验语法并人工排查未定义变量与裸 except',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['check', '--output-format', 'json', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'ruff check 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'ruff');
    if (!Array.isArray(parsed)) ctx.fail(3, 'ruff 报告顶层必须是诊断数组');
    const byRuleCode = {}, fileSet = new Set();
    let syntaxErrorCount = 0, undefinedNameCount = 0, fixableCount = 0;
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.message !== 'string' || !item.location) {
        ctx.fail(3, 'ruff 诊断条目缺少 message 或 location 字段');
      }
      const code = item.code === null ? 'invalid-syntax' : String(item.code || 'unknown');
      byRuleCode[code] = (byRuleCode[code] || 0) + 1;
      if (code === 'invalid-syntax' || code === 'E999') syntaxErrorCount++;
      if (code === 'F821' || code === 'F822' || code === 'F823') undefinedNameCount++;
      if (item.fix) fixableCount++;
      if (item.filename) fileSet.add(String(item.filename));
    }
    const observation = { violationCount: parsed.length, syntaxErrorCount, undefinedNameCount, fixableCount, filesWithViolations: fileSet.size, byRuleCode };
    return {
      rawJson: parsed,
      observation,
      claimText: `Ruff ${ctx.toolVer} 对 ${targetDir} 检出违规 ${observation.violationCount} 条（语法错 ${syntaxErrorCount}、未定义名 ${undefinedNameCount}），涉及 ${fileSet.size} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `violations=${observation.violationCount}, undefinedName=${undefinedNameCount}`
    };
  }
});
