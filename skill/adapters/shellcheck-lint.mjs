// 适配器 · ShellCheck Shell 与 Git 钩子脚本静态核查观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runAdapter } from './_shared.mjs';

const SKIP_DIRS = new Set(['.git', '.donegate', '.dsh', 'node_modules', '.venv', 'venv', 'dist', 'build', 'coverage']);

function collectShellTargets(rootDir, curDir = rootDir, out = []) {
  if (!existsSync(curDir) || out.length >= 200) return out;
  for (const ent of readdirSync(curDir, { withFileTypes: true })) {
    if (ent.name === '_shared' || SKIP_DIRS.has(ent.name)) continue;
    const abs = join(curDir, ent.name);
    if (ent.isDirectory()) {
      collectShellTargets(rootDir, abs, out);
    } else if (ent.isFile() && /\.(?:sh|bash)$/i.test(ent.name)) {
      out.push(relative(rootDir, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

function collectGitHookScripts(rootDir) {
  const hooksDir = join(rootDir, '.githooks');
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir, { withFileTypes: true })
    .filter((e) => e.isFile() && !/\.(?:sample|md|json|cmd|bat|ps1)$/i.test(e.name))
    .map((e) => `.githooks/${e.name}`);
}

runAdapter({
  tool: 'shellcheck',
  defaultRole: 'soft',
  degradedTo: '人工逐行核查 .sh 与 .githooks 脚本的变量双引号包裹、退出码传递与换行符',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    const targets = [...new Set([...collectGitHookScripts(ctx.rootDir), ...collectShellTargets(ctx.rootDir)])];
    if (rawText === null) {
      if (targets.length === 0) ctx.fail(3, '目标项目未检出 .sh 或 .githooks 脚本，无法运行 shellcheck');
      const r = ctx.runBin(['--format=json', ...targets]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'shellcheck 执行失败：' + (r.stderr || r.error?.message));
      rawText = (r.stdout || '').trim() || '[]';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'shellcheck');
    if (!Array.isArray(parsed)) ctx.fail(3, 'shellcheck 报告顶层必须是数组');
    const byCode = {}, fileSet = new Set();
    let errorCount = 0, warningCount = 0;
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || typeof item.message !== 'string' || typeof item.level !== 'string') {
        ctx.fail(3, 'shellcheck 条目缺少 level 或 message 字段');
      }
      if (item.level === 'error') errorCount++;
      else if (item.level === 'warning') warningCount++;
      const codeKey = item.code !== undefined ? `SC${item.code}` : 'unknown';
      byCode[codeKey] = (byCode[codeKey] || 0) + 1;
      if (item.file) fileSet.add(String(item.file));
    }
    const observation = { errorCount, warningCount, issueCount: parsed.length, filesWithIssues: fileSet.size, byCode };
    return {
      rawJson: parsed,
      observation,
      claimText: `shellcheck ${ctx.toolVer} 扫描检出 error ${errorCount}、warning ${warningCount}（共 ${parsed.length} 项），涉及 ${fileSet.size} 个脚本，明细见 ${ctx.obsRelPath}`,
      summaryLog: `errors=${errorCount}, warnings=${warningCount}, issues=${parsed.length}`
    };
  }
});
