// 适配器 · jscpd 重复率与克隆对观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'jscpd',
  defaultRole: 'soft',
  degradedTo: '人工按同一格式手写跨文件重复代码清单',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      rawText = ctx.withTempDir('jscpd-out-', (tmpOut) => {
        const r = ctx.runBin(['--reporters', 'json', '--output', tmpOut, '--silent', ctx.arg('--target', '.')]);
        const rpt = join(tmpOut, 'jscpd-report.json');
        if (r.status !== 0 || !existsSync(rpt)) ctx.fail(3, 'jscpd 执行失败或未产出 jscpd-report.json');
        return readFileSync(rpt, 'utf8');
      });
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'jscpd');
    if (!parsed || !Array.isArray(parsed.duplicates)) ctx.fail(3, 'jscpd 报告缺少 duplicates 数组');
    const clonePairs = parsed.duplicates.map((d) => ({
      firstFile: String(d.firstFile?.name || '').replace(/\\/g, '/'),
      secondFile: String(d.secondFile?.name || '').replace(/\\/g, '/'),
      lines: Number(d.lines || 0)
    }));
    const observation = { cloneCount: clonePairs.length, clonePairs };
    return {
      rawJson: parsed,
      observation,
      claimText: `检出 ${clonePairs.length} 组代码克隆对，明细见 ${ctx.obsRelPath}`,
      summaryLog: `clones=${clonePairs.length}`
    };
  }
});
