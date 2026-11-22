// 适配器 · srclight 索引新鲜度观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'srclight',
  defaultRole: 'soft',
  degradedTo: '人工按同一格式核查代码索引是否覆盖当前提交',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const dbArg = ctx.arg('--db');
      const slArgs = dbArg ? ['status', '--db', resolve(ctx.rootDir, dbArg)] : ['status'];
      const r = ctx.runBin(slArgs);
      if (r.error || r.status !== 0) ctx.fail(3, 'srclight status 失败（请先在项目根运行 srclight index）：' + (r.stderr || r.stdout));
      rawText = r.stdout || '';
    }
    if (!rawText.trim()) ctx.fail(3, 'srclight status 输出为空');
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch { /* 纯文本输出亦可解析文件计数 */ }
    const filesMatch = rawText.match(/(\d+)\s+files?/i);
    const indexedFiles = parsed && Number.isInteger(parsed.indexedFiles) ? parsed.indexedFiles : (filesMatch ? Number(filesMatch[1]) : 0);
    const observation = { indexedFiles, statusDigest: rawText.trim().slice(0, 500) };
    return {
      rawFileName: 'raw-srclight.txt',
      rawContent: rawText,
      observation,
      claimText: `srclight 索引状态采集完成（files=${indexedFiles}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `indexedFiles=${indexedFiles}`
    };
  }
});
