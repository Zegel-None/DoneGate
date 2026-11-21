// 砂浆适配器 · dotenv-linter 环境变量文件规范与键对比观测（Mortar Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'dotenv-linter',
  defaultRole: 'soft',
  degradedTo: '人工逐键比对 .env.example 与本地 .env',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    const diffIssues = [];
    if (rawText !== null) {
      if (!rawText.trim()) ctx.fail(3, 'raw-report 内容为空');
    } else {
      if (readdirSync(ctx.rootDir).filter((f) => /^\.env(\.|$)/.test(f)).length === 0) {
        ctx.fail(3, '项目根目录未发现任何 .env* 文件（防空跑退 3）');
      }
      const r = ctx.runBin(['--plain', 'check', '.']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'dotenv-linter check 执行失败：' + (r.stderr || r.error?.message));
      rawText = (r.stdout || '') + (r.stderr || '');
      if (existsSync(join(ctx.rootDir, '.env.example')) && existsSync(join(ctx.rootDir, '.env'))) {
        const dr = ctx.runBin(['--plain', 'diff', '.env.example', '.env']);
        if (dr.status === 1 && dr.stdout) {
          rawText += '\n--- diff .env.example vs .env ---\n' + dr.stdout;
          for (const l of dr.stdout.split(/\r?\n/)) {
            const t = l.trim();
            if (t && !t.startsWith('Comparing') && !t.startsWith('Found ')) diffIssues.push(t);
          }
        }
      }
    }
    const lintIssues = [];
    for (const line of rawText.split(/\r?\n/)) {
      const m = line.trim().match(/^(\S+?:\d+)\s+([A-Za-z0-9_]+):\s*(.+)$/);
      if (m) lintIssues.push({ location: m[1], rule: m[2], message: m[3] });
    }
    const observation = { lintIssueCount: lintIssues.length, diffIssueCount: diffIssues.length, totalIssues: lintIssues.length + diffIssues.length, lintIssues, diffIssues };
    return {
      rawFileName: 'raw-dotenv.txt',
      rawKind: 'dotenv-raw',
      obsKind: 'dotenv-observation',
      rawContent: rawText,
      observation,
      claimText: `检出 .env 规范问题 ${observation.lintIssueCount} 条、.env.example 键差异 ${observation.diffIssueCount} 条，明细见 ${ctx.obsRelPath}`,
      summaryLog: `lint=${observation.lintIssueCount}, diff=${observation.diffIssueCount}`
    };
  }
});
