#!/usr/bin/env node
// 文档词数/字节预算与反废话 Slop Checklist 硬门禁（防 AGENTS.md 膨胀腐化）
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './fs-walk.mjs';
import { readJsonStrict, readMaybe, relTo } from './io.mjs';

const CDB_SKIP_DIRS = [
  '.git', 'node_modules', '.donegate', '.deps', '.dsh', '.stryker-tmp',
  'dist', '_dist', 'coverage', 'reports', 'vendor', '参考', '归档', '设计', '证据', 'decisions'
];

const CDB_DEFAULT_BUDGETS = Object.freeze({
  rootAgentsMaxLines: 130,
  rootAgentsMaxBytes: 8192,
  subtreeAgentsMaxLines: 80,
  subtreeAgentsMaxBytes: 6144,
  maxParagraphLines: 14
});

const CDB_PERISHABLE_RE = /\b(?:WIP|TEMP|TBD|TODO|FIXME|XXX)\b|待补充|临时占位|暂未完成/i;

export function cdbLoadDocBudgets(projectRoot) {
  const thPath = join(resolve(projectRoot), 'thresholds.json');
  const res = existsSync(thPath) ? readJsonStrict(thPath) : { ok: false };
  const baseRaw = res.ok && res.value?.docBudgets && typeof res.value.docBudgets === 'object'
    ? res.value.docBudgets
    : {};
  let envRaw = {};
  if (process.env.DG_NODE_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.DG_NODE_CONFIG);
      if (parsed && typeof parsed === 'object') envRaw = parsed;
    } catch (err) { void err; }
  }
  const raw = { ...baseRaw, ...envRaw };
  return {
    rootAgentsMaxLines: Number(raw.rootAgentsMaxLines) || CDB_DEFAULT_BUDGETS.rootAgentsMaxLines,
    rootAgentsMaxBytes: Number(raw.rootAgentsMaxBytes) || CDB_DEFAULT_BUDGETS.rootAgentsMaxBytes,
    subtreeAgentsMaxLines: Number(raw.subtreeAgentsMaxLines) || CDB_DEFAULT_BUDGETS.subtreeAgentsMaxLines,
    subtreeAgentsMaxBytes: Number(raw.subtreeAgentsMaxBytes) || CDB_DEFAULT_BUDGETS.subtreeAgentsMaxBytes,
    maxParagraphLines: Number(raw.maxParagraphLines) || CDB_DEFAULT_BUDGETS.maxParagraphLines
  };
}

function cdbScanSlopChecklist(raw, rel, maxParagraphLines, fails) {
  const lines = raw.split(/\r?\n/);
  const seenHeadings = new Set();
  let inFence = false;
  let proseStreak = 0;
  let proseStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      proseStreak = 0;
      continue;
    }
    if (inFence) continue;
    const hMatch = trimmed.match(/^(#{2,6})\s+(.+)$/);
    if (hMatch) {
      proseStreak = 0;
      const normKey = `${hMatch[1]}:${hMatch[2].trim().toLowerCase()}`;
      if (seenHeadings.has(normKey)) {
        fails.push(`DB3 Slop 重复章节标题 (${rel}:L${i + 1})：「${hMatch[2].trim()}」`);
      }
      seenHeadings.add(normKey);
      continue;
    }
    if (!trimmed || /^[-*+|>\d]/.test(trimmed) || /^---+$/.test(trimmed)) {
      proseStreak = 0;
    } else {
      if (proseStreak === 0) proseStart = i + 1;
      proseStreak++;
      if (proseStreak === maxParagraphLines + 1) {
        fails.push(`DB4 Slop 超长段落墙 (${rel}:L${proseStart})：连续正文超过 ${maxParagraphLines} 行，请拆分为条目或外链`);
      }
    }
    const stripped = trimmed.replace(/`[^`]*`/g, '');
    if (CDB_PERISHABLE_RE.test(stripped)) {
      fails.push(`DB5 Slop 易腐临时标记 (${rel}:L${i + 1})：常驻地图禁止残留 WIP/TEMP/TODO 等易腐状态标签`);
    }
  }
}

function cdbAuditSingleDoc(root, absFile, isRootDoc, budgets, fails, reports) {
  const rel = relTo(root, absFile);
  const raw = readMaybe(absFile);
  if (raw === null) return;
  const lineCount = raw.split(/\r?\n/).length;
  const byteSize = Buffer.byteLength(raw, 'utf8');
  const maxLines = isRootDoc ? budgets.rootAgentsMaxLines : budgets.subtreeAgentsMaxLines;
  const maxBytes = isRootDoc ? budgets.rootAgentsMaxBytes : budgets.subtreeAgentsMaxBytes;
  const before = fails.length;
  if (lineCount > maxLines) {
    fails.push(`DB1 文档行数超预算 (${rel})：${lineCount} 行 > 上限 ${maxLines} 行`);
  }
  if (byteSize > maxBytes) {
    fails.push(`DB2 文档字节超预算 (${rel})：${byteSize} B > 上限 ${maxBytes} B（请精简为地图指针）`);
  }
  cdbScanSlopChecklist(raw, rel, budgets.maxParagraphLines, fails);
  reports.push({ file: rel, isRootDoc, lineCount, byteSize, maxLines, maxBytes, ok: fails.length === before });
}

export function auditDocBudgets(projectRoot) {
  const root = resolve(projectRoot);
  const budgets = cdbLoadDocBudgets(root);
  const fails = [];
  const reports = [];
  const seen = new Set();

  for (const rootRel of ['AGENTS.md', 'docs/public-AGENTS.md']) {
    const abs = join(root, rootRel);
    if (!existsSync(abs)) continue;
    seen.add(abs);
    cdbAuditSingleDoc(root, abs, true, budgets, fails, reports);
  }

  for (const abs of walk(root, { skipDirs: CDB_SKIP_DIRS }).files) {
    if (seen.has(abs)) continue;
    if (basename(abs) !== 'AGENTS.md') continue;
    seen.add(abs);
    cdbAuditSingleDoc(root, abs, false, budgets, fails, reports);
  }

  return { exitCode: fails.length > 0 ? 1 : 0, budgets, files: reports, fails };
}

function cdbRunRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-doc-budget-'));
  let bad = 0;
  const t = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };
  try {
    writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## 规则\n\n- 保持精简。\n', 'utf8');
    mkdirSync(join(tmp, 'sub'), { recursive: true });
    writeFileSync(join(tmp, 'sub', 'AGENTS.md'), '# sub/AGENTS.md\n\n## 局部约定\n\n- 仅放本子树入口。\n', 'utf8');
    const rOk = auditDocBudgets(tmp);
    t('正样本：合规根 AGENTS.md 与子树 AGENTS.md 全绿放行', rOk.exitCode === 0 && rOk.files.length === 2);

    writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n' + '很长一段冗余说明。'.repeat(400) + '\n', 'utf8');
    const rBytes = auditDocBudgets(tmp);
    t('必红样本 1：根 AGENTS.md 超 8192 字节预算当场判红 (DB2)', rBytes.exitCode === 1 && rBytes.fails.some((f) => f.includes('DB2')));

    writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS.md\n\n## 规则\n\n- 合规。\n', 'utf8');
    writeFileSync(join(tmp, 'sub', 'AGENTS.md'), Array.from({ length: 85 }, (_, i) => `- 规则 ${i + 1}`).join('\n') + '\n', 'utf8');
    const rSub = auditDocBudgets(tmp);
    t('必红样本 2：子树 AGENTS.md 超 80 行预算当场判红 (DB1)', rSub.exitCode === 1 && rSub.fails.some((f) => f.includes('DB1')));

    writeFileSync(join(tmp, 'sub', 'AGENTS.md'), '# sub\n\n## 规则\n\n- 项 1\n\n## 规则\n\n此处 待补充 细节\n', 'utf8');
    const rSlop = auditDocBudgets(tmp);
    t('必红样本 3：Slop Checklist 拦截重复标题 (DB3) 与易腐状态标签 (DB5)', rSlop.exitCode === 1 && rSlop.fails.some((f) => f.includes('DB3')) && rSlop.fails.some((f) => f.includes('DB5')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(bad === 0 ? '\nRESULT: PASS 文档词数预算与 Slop Checklist 门禁 4 组样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(cdbRunRedSelfTest());
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  const res = auditDocBudgets(root);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    for (const f of res.files) {
      console.log(`  ${f.ok ? '✓' : '✗'} ${f.file} [${f.lineCount}/${f.maxLines} 行 | ${f.byteSize}/${f.maxBytes} B]`);
    }
    for (const fl of res.fails) console.log(`  ✗ ${fl}`);
    console.log(res.exitCode === 0 ? `RESULT: PASS 文档预算与 Slop 核查通过 (${res.files.length} 个文件)` : `RESULT: FAIL 文档预算检出 ${res.fails.length} 项违规`);
  }
  process.exit(res.exitCode);
}
