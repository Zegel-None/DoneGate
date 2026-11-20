// 引用行验真（skill/15 表3 openqodex 自写例外 ≤80 行，零依赖）：核实文本中引用的 file:line 是否真实存在且行号不越界。
// 用法：node skill/check-citations.mjs [--root <项目根>] <file1> ...   （无文件参数时运行内置正负夹具）
// 退出码：0 全部引用真实存在 / 1 存在幻觉引用或越界行号 / 3 传入文件不可读。
// 诚实边界：只验「文件存在且行号 ≤ 文件总行数」，不验该行代码语义是否支撑作者论断。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CITATION_RE = /(?:^|[\s(`\[])([A-Za-z0-9_.\-/\\]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|md)):L?(\d+)(?:[-–]L?(\d+))?/g;

export function verifyFileCitations(projectRoot, targetFile) {
  let body;
  try { body = readFileSync(targetFile, 'utf8'); } catch { return { exitCode: 3, misses: ['目标文件不可读：' + targetFile], checked: 0 }; }
  const lineCache = new Map();
  const misses = [];
  let checked = 0;
  for (const m of body.matchAll(CITATION_RE)) {
    const rel = m[1].replace(/\\/g, '/');
    const startLine = Number(m[2]), endLine = m[3] ? Number(m[3]) : startLine;
    if (rel.startsWith('http') || rel.includes('...')) continue;
    checked++;
    const abs = resolve(projectRoot, rel);
    if (!existsSync(abs)) { misses.push(`${rel}:${startLine}（文件不存在）`); continue; }
    if (!lineCache.has(abs)) {
      try { lineCache.set(abs, readFileSync(abs, 'utf8').split(/\r?\n/).length); }
      catch { misses.push(`${rel}:${startLine}（文件不可读）`); continue; }
    }
    const maxLine = lineCache.get(abs);
    if (startLine < 1 || endLine < startLine || endLine > maxLine) {
      misses.push(`${rel}:${startLine}${m[3] ? '-' + endLine : ''}（行号越界，共 ${maxLine} 行）`);
    }
  }
  return { exitCode: misses.length > 0 ? 1 : 0, misses, checked };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  const files = argv.filter((a, i) => !a.startsWith('--') && !(rIdx >= 0 && i === rIdx + 1));
  if (files.length === 0) {
    const tmp = mkdtempSync(join(tmpdir(), 'cit-'));
    try {
      writeFileSync(join(tmp, 'a.mjs'), 'const x = 1;\nconst y = 2;\n');
      writeFileSync(join(tmp, 'ok.md'), '参见 `a.mjs:1` 与 a.mjs:1-2。\n');
      writeFileSync(join(tmp, 'ghost.md'), '参见 `missing.mjs:1` 与 a.mjs:99。\n');
      const r1 = verifyFileCitations(tmp, join(tmp, 'ok.md'));
      const r2 = verifyFileCitations(tmp, join(tmp, 'ghost.md'));
      const lineCount = readFileSync(fileURLToPath(import.meta.url), 'utf8').trimEnd().split(/\r?\n/).length;
      const pass = lineCount <= 80 && r1.exitCode === 0 && r1.checked === 2 && r2.exitCode === 1 && r2.misses.length === 2;
      console.log(pass ? `RESULT: PASS 引用行验真自检全过 (${lineCount} 行 ≤80)` : 'RESULT: FAIL 引用行验真自检失败');
      process.exit(pass ? 0 : 1);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  let hasFail = 0, hasErr = 0;
  for (const f of files) {
    const r = verifyFileCitations(root, resolve(root, f));
    if (r.exitCode === 3) { console.error(r.misses[0]); hasErr = 1; }
    else if (r.exitCode === 1) { console.error(`幻觉引用 (${f}): ` + r.misses.join('；')); hasFail = 1; }
    else console.log(`✓ ${f}: ${r.checked} 处引用行全部存在`);
  }
  process.exit(hasErr ? 3 : hasFail ? 1 : 0);
}
