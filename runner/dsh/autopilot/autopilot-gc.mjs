// 过夜挂机与批次收尾周期性文档/符号/术语/经验引用与门禁误拦率漂移巡检（Autopilot GC，<= 120 行）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateGateRuleUnhelpfulLedger } from './trust-ladder.mjs';

const CHECK_TIMEOUT_MS = 60_000;
const MAX_HEADLINE_LEN = 180;
const MEMORY_CITATION_RE = /(?:^|[\s(`\[])([A-Za-z0-9_.\-/\\]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|md)):L?(\d+)(?:[-–]L?(\d+))?/g;

export const AGC_CHECKS = [
  { id: 'symbols', label: '符号与重复函数门禁', script: 'skill/check-symbols.mjs', args: ['--gate'], requireFile: 'skill/symbols-baseline.json' },
  { id: 'doc-budgets', label: '文档字节/行数与防废话预算', script: 'skill/check-doc-budgets.mjs', args: [] },
  { id: 'terminology', label: '工程名词归一化门禁', script: 'skill/check-terminology.mjs', args: [] }
];

export function verifyMemoryMarkdownCitations(projectRoot, mdFilePath) {
  const body = readFileSync(mdFilePath, 'utf8');
  const misses = [];
  let checked = 0;
  for (const m of body.matchAll(MEMORY_CITATION_RE)) {
    const rel = m[1].replace(/\\/g, '/');
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    if (rel.startsWith('http') || rel.includes('...')) continue;
    checked++;
    const abs = resolve(projectRoot, rel);
    if (!existsSync(abs)) { misses.push(`${rel}:${start}`); continue; }
    const maxLine = readFileSync(abs, 'utf8').split(/\r?\n/).length;
    if (start < 1 || end < start || end > maxLine) misses.push(`${rel}:${start}-${end}`);
  }
  return { checked, misses };
}

function agcRunSingleCheck(root, spec) {
  const scriptAbs = join(root, spec.script);
  if (!existsSync(scriptAbs) || (spec.requireFile && !existsSync(join(root, spec.requireFile)))) {
    const missingRel = !existsSync(scriptAbs) ? spec.script : spec.requireFile;
    return { id: spec.id, label: spec.label, skipped: true, exitCode: 0, ok: true, headline: `跳过（仓库未包含 ${missingRel}）` };
  }
  const r = spawnSync(process.execPath, [scriptAbs, ...spec.args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: CHECK_TIMEOUT_MS });
  const combined = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const headline = combined.find((l) => /RESULT:|PASS|FAIL|✗|违例/i.test(l)) || combined[combined.length - 1] || `exit=${r.status}`;
  return { id: spec.id, label: spec.label, skipped: false, exitCode: r.status ?? 3, ok: r.status === 0, headline: headline.slice(0, MAX_HEADLINE_LEN) };
}

function agcAuditMemoryCitations(root) {
  const memDir = join(root, '.donegate', 'memory');
  if (!existsSync(memDir)) {
    return { id: 'memory-citations', label: '项目经验文件行号验活', skipped: true, exitCode: 0, ok: true, staleFiles: [], headline: '跳过（尚未建立 .donegate/memory 目录）' };
  }
  const mdFiles = readdirSync(memDir).filter((f) => f.endsWith('.md')).sort();
  const staleFiles = [];
  let totalRefs = 0;
  for (const f of mdFiles) {
    const res = verifyMemoryMarkdownCitations(root, join(memDir, f));
    totalRefs += res.checked;
    if (res.misses.length > 0) staleFiles.push({ file: f, misses: res.misses });
  }
  const ok = staleFiles.length === 0;
  return {
    id: 'memory-citations', label: '项目经验文件行号验活', skipped: false, exitCode: ok ? 0 : 1, ok, staleFiles,
    headline: ok ? `PASS ${mdFiles.length} 份经验卡共 ${totalRefs} 处源码锚点全部存活` : `检出 ${staleFiles.length} 份过期经验卡含失效行号引用`
  };
}

function agcAuditRuleLedger(root, opts) {
  const ledgerPath = join(root, '.donegate', 'rule-ledger.jsonl');
  if (!existsSync(ledgerPath)) return null;
  const entries = [];
  for (const line of readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch (err) { void err; }
  }
  const ledgerEval = evaluateGateRuleUnhelpfulLedger(entries, opts.ruleLedgerOptions);
  const flaggedCount = ledgerEval.flaggedRules.length;
  const check = {
    id: 'rule-ledger', label: '软门禁误拦率账本巡检', skipped: false, exitCode: ledgerEval.ok ? 0 : 1, ok: ledgerEval.ok,
    flaggedRules: ledgerEval.flaggedRules, recommendations: ledgerEval.recommendations,
    headline: ledgerEval.ok
      ? `PASS 共评估 ${ledgerEval.rules.length} 条门禁规则，无高误拦膨胀项`
      : `检出 ${flaggedCount} 条高无助率门禁规则建议降级或修剪`
  };
  return { check, ledgerEval };
}

export function runAutopilotGcAudit(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const specs = Array.isArray(opts.checks) ? opts.checks : AGC_CHECKS;
  const results = specs.map((s) => agcRunSingleCheck(root, s));
  if (opts.includeMemoryCitations !== false) results.push(agcAuditMemoryCitations(root));
  const ledgerOut = opts.includeRuleLedger !== false ? agcAuditRuleLedger(root, opts) : null;
  if (ledgerOut) results.push(ledgerOut.check);
  const failed = results.filter((r) => !r.ok);
  const ok = failed.length === 0;
  const recLines = ledgerOut?.ledgerEval.recommendations.length
    ? ['', '## 门禁降级与修剪建议', ...ledgerOut.ledgerEval.recommendations.map((x) => `- \`${x.ruleId}\` (${x.action})：${x.reason}`)]
    : [];
  const lines = [
    '# Autopilot GC · 周期性熵增与漂移体检报告', '',
    `- **生成时间**：${new Date().toISOString()}`,
    `- **总结论**：${ok ? '✅ 全绿（无符号重复、文档超载、术语漂移或过期经验锚点）' : `❌ 检出 ${failed.length} 项漂移待清理`}`,
    '', '## 检查项明细',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.label}**（\`${r.id}\` · exit \`${r.exitCode}\`）：${r.headline}`),
    ...recLines, ''
  ];
  const outDir = join(root, '.donegate', 'runs');
  mkdirSync(outDir, { recursive: true });
  const reportPath = opts.outPath ? resolve(root, opts.outPath) : join(outDir, 'GC-REPORT.md');
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return {
    ok, exitCode: ok ? 0 : 1, reportPath, checks: results, failedCount: failed.length,
    ruleLedger: ledgerOut ? ledgerOut.ledgerEval : null,
    summary: ok ? `✅ Autopilot GC 巡检通过（${results.length}/${results.length} 项零漂移）` : `❌ Autopilot GC 检出 ${failed.length} 项漂移，详情见 ${reportPath}`
  };
}
