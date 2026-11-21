// 砂浆适配器 · typos 源码标识符与配置键拼写幻觉观测（Mortar Protocol v1.1 · 0/2 归一化，委托 _shared.mjs）
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'typos',
  defaultRole: 'soft',
  degradedTo: '人工审查新增标识符、配置键名与错误提示是否存在拼写滑移',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--format', 'json', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 2)) ctx.fail(3, 'typos 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const typoItems = [], fileSet = new Set(), byTypo = {};
    for (const [idx, line] of lines.entries()) {
      let obj;
      try { obj = JSON.parse(line); } catch (e) { ctx.fail(3, `typos 输出第 ${idx + 1} 行 JSONL 截断或损坏：${e.message}`); }
      if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') ctx.fail(3, `typos 输出第 ${idx + 1} 行缺少 type 字段`);
      if (obj.type === 'typo') {
        if (typeof obj.typo !== 'string' || !Array.isArray(obj.corrections)) ctx.fail(3, `typos 第 ${idx + 1} 行缺少 typo 或 corrections`);
        typoItems.push(obj);
        if (obj.path) fileSet.add(String(obj.path));
        byTypo[obj.typo] = (byTypo[obj.typo] || 0) + 1;
      }
    }
    const observation = {
      typoCount: typoItems.length,
      filesWithTypos: fileSet.size,
      byTypo,
      sampleFindings: typoItems.slice(0, 20).map((t) => ({ path: t.path || '', lineNum: Number(t.line_num || 0), typo: t.typo, corrections: t.corrections }))
    };
    return {
      rawFileName: 'raw-typos.jsonl',
      rawContent: lines.length ? lines.join('\n') + '\n' : '',
      observation,
      claimText: `typos ${ctx.toolVer} 对 ${targetDir} 检出拼写疑似项 ${observation.typoCount} 处，涉及 ${fileSet.size} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `typos=${observation.typoCount}, files=${fileSet.size}`
    };
  }
});
