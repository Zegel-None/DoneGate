// 适配器 · Knip 死代码与无用依赖观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'knip',
  defaultRole: 'soft',
  degradedTo: '人工核对 package.json 依赖清单与各模块未引用文件',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--reporter', 'json']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'knip 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'knip');
    if (!parsed || !Array.isArray(parsed.issues)) ctx.fail(3, 'knip 报告缺少 issues 数组');
    const unusedFiles = Array.isArray(parsed.files) ? parsed.files.map(String) : [];
    const unusedDeps = [], unlistedDeps = [], unusedExports = [];
    for (const iss of parsed.issues) {
      const f = String(iss.file || '');
      for (const d of (iss.dependencies || [])) unusedDeps.push({ file: f, name: d.name || String(d) });
      for (const d of (iss.devDependencies || [])) unusedDeps.push({ file: f, name: d.name || String(d), dev: true });
      for (const d of (iss.unlisted || [])) unlistedDeps.push({ file: f, name: d.name || String(d) });
      for (const ex of (iss.exports || [])) unusedExports.push({ file: f, name: ex.name || String(ex) });
      for (const uf of (iss.files || [])) unusedFiles.push(String(uf.name || uf));
    }
    const observation = {
      unusedFilesCount: new Set(unusedFiles).size,
      unusedDepsCount: unusedDeps.length,
      unlistedDepsCount: unlistedDeps.length,
      unusedExportsCount: unusedExports.length,
      unusedDeps,
      unlistedDeps
    };
    return {
      rawJson: parsed,
      observation,
      claimText: `检出无用依赖 ${observation.unusedDepsCount}、未声明引用 ${observation.unlistedDepsCount}、未使用文件 ${observation.unusedFilesCount}、死导出 ${observation.unusedExportsCount}，明细见 ${ctx.obsRelPath}`,
      summaryLog: `unusedDeps=${observation.unusedDepsCount}, unusedFiles=${observation.unusedFilesCount}`
    };
  }
});
