// 适配器 · Stryker 有牙观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

const STATES = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Pending'];

runAdapter({
  tool: 'stryker',
  defaultRole: 'hard',
  requireRegistryId: true,
  enforceTestedRange: true,
  degradedTo: '人工按同一格式手写档 A 改坏实验记录（breakPatch 与红绿实测退出码）',
  resolveVersion({ arg, repoDir, fail }) {
    const pkgPath = resolve(arg('--stryker-pkg', join(repoDir, 'node_modules/@stryker-mutator/core/package.json')));
    try { return JSON.parse(readFileSync(pkgPath, 'utf8')).version; } catch { fail(3, '无法读取 @stryker-mutator/core 版本：' + pkgPath); }
  },
  collect(ctx) {
    const reportRel = ctx.arg('--report', 'reports/mutation/mutation.json');
    const reportAbs = resolve(ctx.rootDir, reportRel);
    const repBuf = ctx.checkFreshFileOrFail(reportAbs, reportRel, ctx.dryRun, ctx.headCommitSec, '陈旧报告退 3');
    const repJson = ctx.parseJsonOrFail(repBuf.toString('utf8'), 'Stryker 报告');
    if (!repJson || typeof repJson !== 'object' || !repJson.files || typeof repJson.files !== 'object' || Array.isArray(repJson.files)) {
      ctx.fail(3, 'Stryker 报告缺少必填顶层字段 files');
    }
    const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
    const sortedFiles = Object.keys(repJson.files).sort();
    const inputs = ctx.hashInputFiles(ctx.rootDir, sortedFiles, '报告引用的源码文件');
    const subjects = sortedFiles.map((f) => f.replace(/\\/g, '/'));
    const unresolved = [];
    for (const fp of sortedFiles) {
      const norm = fp.replace(/\\/g, '/');
      const fObj = repJson.files[fp];
      if (!fObj || !Array.isArray(fObj.mutants)) ctx.fail(3, `Stryker 报告缺少 ${norm} 的 mutants 数组`);
      for (const m of fObj.mutants) {
        if (!m || !STATES.includes(m.status)) ctx.fail(2, `未知 Stryker 变异体状态：mutant=${m && m.id} status=${m && m.status}`);
        counts[m.status]++;
        if (m.status === 'Ignored' || m.status === 'Pending') {
          unresolved.push({ text: `${norm} mutant#${m.id} (${m.mutatorName || 'unknown'}) 处于 ${m.status}`, stage: ctx.entry.stage });
        }
      }
    }
    const totalMutants = STATES.reduce((s, k) => s + counts[k], 0);
    const summaryParts = STATES.filter((s) => counts[s] > 0).map((s) => `${s}=${counts[s]}`);
    const observation = { subject: subjects.join(', '), totalMutants, countsByStatus: counts };
    return {
      existingReportAbs: reportAbs,
      existingReportBuf: repBuf,
      rawKind: 'stryker-mutation-report',
      inputs,
      observation,
      unresolved,
      claimText: `${observation.subject || '(none)'} 执行 ${totalMutants} 个变异体（${summaryParts.join(', ') || 'total=0'}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `total=${totalMutants}, ${summaryParts.join(', ') || '0'}`
    };
  }
});
