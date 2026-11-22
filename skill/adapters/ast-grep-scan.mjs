// 适配器 · ast-grep 结构搜索观测（Adapter Protocol v1.1 · grep 语义 0=命中 / 1=无命中，委托 _shared.mjs）
import { relative, sep } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'ast-grep',
  defaultRole: 'soft',
  degradedTo: '人工按同一模式用编辑器正则或读代码逐处确认',
  validateArgs({ rawArgAfter, arg, fail }) {
    const pRaw = rawArgAfter('--pattern'), lRaw = rawArgAfter('--lang');
    if (pRaw !== null && !String(pRaw).trim()) fail(2, '缺少 --pattern（结构搜索必须给出模式，不许回落默认值）');
    if (lRaw !== null && !String(lRaw).trim()) fail(2, '缺少 --lang');
    if (!String(arg('--pattern', 'console.log($$$A)')).trim()) fail(2, '缺少 --pattern');
    if (!String(arg('--lang', 'js')).trim()) fail(2, '缺少 --lang');
  },
  collect(ctx) {
    const pattern = ctx.arg('--pattern', 'console.log($$$A)');
    const lang = ctx.arg('--lang', 'js');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['run', '--pattern', pattern, '--lang', lang, '--json=pretty', ctx.arg('--target', '.')]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'ast-grep 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '[]';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'ast-grep');
    if (!Array.isArray(parsed)) ctx.fail(3, 'ast-grep 报告不是匹配数组');
    const files = new Set(), sample = [];
    for (const m of parsed) {
      const r = relative(ctx.rootDir, String((m && m.file) || ''));
      const f = (r.startsWith('..') ? String((m && m.file) || '') : r).split(sep).join('/');
      if (f) files.add(f);
      if (sample.length < 20) {
        const st = (m && m.range && m.range.start) || {};
        sample.push({ file: f, line: Number(st.line || 0) + 1, column: Number(st.column || 0) + 1, text: String((m && m.text) || '').slice(0, 120) });
      }
    }
    const observation = { pattern, lang, matchCount: parsed.length, fileCount: files.size, files: [...files].slice(0, 50), sample };
    return {
      rawJson: parsed,
      observation,
      claimText: `ast-grep ${ctx.toolVer} 用模式「${pattern}」（lang=${lang}）在 ${files.size} 个文件中检出 ${parsed.length} 处结构匹配，明细见 ${ctx.obsRelPath}`,
      summaryLog: `matches=${parsed.length}, files=${files.size}`
    };
  }
});
