// 适配器 · Beads 只读依赖排序（Adapter Protocol v1.1 · 严禁回写状态，委托 _shared.mjs）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'beads',
  defaultBin: 'bd',
  defaultRole: 'soft',
  degradedTo: '人工按同一格式手写缺口优先级前 3 位排序清单',
  collect(ctx) {
    let readyRaw = ctx.readRawOverride('--raw-ready');
    if (readyRaw === null) {
      if (!existsSync(join(ctx.rootDir, '.beads'))) ctx.fail(3, '工作区未初始化 .beads/ 目录');
      const r = ctx.runBin(['ready', '--json']);
      if (r.error || r.status !== 0) ctx.fail(3, 'bd ready --json 失败：' + (r.stderr || r.stdout));
      readyRaw = r.stdout || '';
    }
    const items = ctx.parseJsonOrFail(readyRaw, 'bd ready');
    if (!Array.isArray(items)) ctx.fail(3, 'bd ready 输出不是数组');
    const ordered = items.map((x) => ({ id: x.id, title: x.title || '', priority: x.priority ?? null }));
    const observation = { readyCount: ordered.length, readyQueue: ordered };
    return {
      rawFileName: 'raw-ready.json',
      rawKind: 'beads-ready-raw',
      rawJson: items,
      observation,
      claimText: `只读采集 Beads 就绪排序队列 ${ordered.length} 项，明细见 ${ctx.obsRelPath}`,
      summaryLog: `ready=${ordered.length}`
    };
  }
});
