// 适配器 · OpenSpec 规格校验观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'openspec',
  defaultRole: 'soft',
  degradedTo: '人工按同一格式逐份核对规格文件格式与约束条文',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      if (!existsSync(join(ctx.rootDir, 'openspec'))) ctx.fail(3, '工作区未初始化 openspec/ 目录');
      const r = ctx.runBin(['validate', '--all', '--strict', '--json']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'openspec validate 失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'openspec');
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) ctx.fail(3, 'openspec 报告缺少 items 数组');
    const issueItems = parsed.items.filter((x) => x && x.valid === false).map((x) => ({ name: x.name || 'unknown', issues: x.issues || [] }));
    const observation = { itemCount: parsed.items.length, invalidCount: issueItems.length, issueItems };
    return {
      rawJson: parsed,
      observation,
      claimText: `openspec 校验 ${parsed.items.length} 项规格，发现 ${issueItems.length} 项待修正，明细见 ${ctx.obsRelPath}`,
      summaryLog: `items=${parsed.items.length}, issues=${issueItems.length}`
    };
  }
});
