// 过夜挂机周期性文档/符号/术语漂移清理巡检（Autopilot GC，<= 120 行）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const AGC_CHECKS = [
  { id: 'symbols', label: '符号与重复函数门禁', script: 'skill/check-symbols.mjs', args: ['--gate'], requireFile: 'skill/symbols-baseline.json' },
  { id: 'doc-budgets', label: '文档字节/行数与防废话预算', script: 'skill/check-doc-budgets.mjs', args: [] },
  { id: 'terminology', label: '工程名词归一化门禁', script: 'skill/check-terminology.mjs', args: [] }
];

function agcRunSingleCheck(root, spec) {
  const scriptAbs = join(root, spec.script);
  if (!existsSync(scriptAbs) || (spec.requireFile && !existsSync(join(root, spec.requireFile)))) {
    return {
      id: spec.id,
      label: spec.label,
      skipped: true,
      exitCode: 0,
      ok: true,
      headline: `跳过（仓库未包含 ${!existsSync(scriptAbs) ? spec.script : spec.requireFile}）`
    };
  }
  const r = spawnSync(process.execPath, [scriptAbs, ...spec.args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000
  });
  const combined = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const headline = combined.find((l) => /RESULT:|PASS|FAIL|✗|违例/i.test(l)) || combined[combined.length - 1] || `exit=${r.status}`;
  return {
    id: spec.id,
    label: spec.label,
    skipped: false,
    exitCode: r.status ?? 3,
    ok: r.status === 0,
    headline: headline.slice(0, 180)
  };
}

export function runAutopilotGcAudit(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const specs = Array.isArray(opts.checks) ? opts.checks : AGC_CHECKS;
  const results = specs.map((s) => agcRunSingleCheck(root, s));
  const failed = results.filter((r) => !r.ok);
  const ok = failed.length === 0;
  const now = new Date().toISOString();

  const lines = [
    '# Autopilot GC · 周期性熵增与漂移体检报告',
    '',
    `- **生成时间**：${now}`,
    `- **总结论**：${ok ? '✅ 全绿（无符号重复、文档超载或术语漂移）' : `❌ 检出 ${failed.length} 项漂移待清理`}`,
    '',
    '## 检查项明细',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.label}**（\`${r.id}\` · exit \`${r.exitCode}\`）：${r.headline}`),
    ''
  ];

  const outDir = join(root, '.donegate', 'runs');
  mkdirSync(outDir, { recursive: true });
  const reportPath = opts.outPath ? resolve(root, opts.outPath) : join(outDir, 'GC-REPORT.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');

  return {
    ok,
    exitCode: ok ? 0 : 1,
    reportPath,
    checks: results,
    failedCount: failed.length,
    summary: ok
      ? `✅ Autopilot GC 巡检通过（${results.length}/${results.length} 项零漂移）`
      : `❌ Autopilot GC 检出 ${failed.length} 项漂移，详情见 ${reportPath}`
  };
}
