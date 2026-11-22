// 适配器 · actionlint GitHub Actions 工作流静态核查观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'actionlint',
  defaultRole: 'hard',
  versionArgs: ['-version'],
  degradedTo: '人工逐行核对 .github/workflows/*.yml 的 Action 参数、表达式与权限配置',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      if (!existsSync(join(ctx.rootDir, '.github', 'workflows'))) {
        ctx.fail(3, '目标项目不存在 .github/workflows 目录，无法运行 actionlint');
      }
      const r = ctx.runBin(['-format', '{{json .}}']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'actionlint 执行失败：' + (r.stderr || r.error?.message));
      rawText = (r.stdout || '').trim() || '[]';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'actionlint');
    if (!Array.isArray(parsed)) ctx.fail(3, 'actionlint 报告顶层必须是数组');
    const byKind = {};
    const fileSet = new Set();
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.message !== 'string' || typeof item.filepath !== 'string') {
        ctx.fail(3, 'actionlint 错误条目缺少 message 或 filepath 字段');
      }
      byKind[String(item.kind || 'unknown')] = (byKind[String(item.kind || 'unknown')] || 0) + 1;
      fileSet.add(item.filepath);
    }
    const observation = { errorCount: parsed.length, workflowFilesWithErrors: fileSet.size, byKind };
    return {
      rawJson: parsed,
      observation,
      claimText: `actionlint ${ctx.toolVer} 检出 GitHub Actions 工作流错误 ${observation.errorCount} 处，涉及 ${observation.workflowFilesWithErrors} 个文件，明细见 ${ctx.obsRelPath}`,
      summaryLog: `errors=${observation.errorCount}, files=${observation.workflowFilesWithErrors}`
    };
  }
});
