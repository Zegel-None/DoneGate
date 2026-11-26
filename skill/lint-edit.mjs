#!/usr/bin/env node
// 毫秒级单文件编辑微门禁（SWE-agent ACI 即时反馈护栏）：每次写完单个文件立即定位语法、复杂度、压行、内联脚本漏挂与契约越界
// 用法：
//   node skill/lint-edit.mjs <file1> [file2...] [--root <dir>] [--json]
//   node runner/donegate.mjs lint-edit <file1> [file2...] [--json]
//   node skill/lint-edit.mjs --red-self-test
// 退出码（§八 四值）：0 通过 / 1 检出违规需当场修正 / 3 参数或路径读取错误
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';
import { analyzeCodeComplexityAndGolfing } from './cognitive-complexity.mjs';
import { countEffectiveCodeLines, loadHygieneBudgets } from './commit-hygiene-metrics.mjs';
import { scanTerminologyViolations } from './check-terminology.mjs';
import { validateDecisionFiveSections } from './check-decisions.mjs';
import { attachFixHints, resolveLintFixHint } from './lint-edit/remediation.mjs';

const JS_LIKE_RE = /\.(mjs|cjs|js|ts|tsx|jsx)$/i;
const TEST_OR_FIXTURE_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$/i;
const SELF_META_EXEMPT_RE = /(^|\/)(skill\/lint-edit\.mjs|skill\/check-commit-hygiene\.mjs|skill\/check-ai-habits\.mjs|skill\/check-escapes\.mjs|skill\/check-module-integrity\.mjs)$/i;
const ALLOW_TAG_RE = /(?:\/\/|#)\s*dg-allow\s*:\s*(.+)$/;
const RAW_SHA_CALL_RE = new RegExp('\\bcreateHash\\s*\\(\\s*[\'"]sha256[\'"]\\s*\\)');

const SLOP_RULES = [
  { id: 'C3:todo', label: '未完成占位符 (TODO/FIXME/XXX/HACK)', re: /(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|XXX|HACK)\b/ },
  { id: 'C3:empty-catch', label: '空 catch 静默吞异常', re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/ },
  { id: 'C3:elide', label: 'AI 省略删码注释', re: /(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:(?:existing|unchanged|remaining|rest\s+of(?:\s+the)?)\s+(?:code|implementation|logic|functions?)|(?:其余|剩余|原有)(?:代码|逻辑|实现)\s*(?:保持不变|不变|省略|略))/i }
];

const TEST_CHEAT_RULES = [
  { id: 'C2:skip-only', label: '测试跳过或独占 (.skip / .only / .todo)', re: /\b(?:it|test|describe)\.(?:skip|only|todo)\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/ },
  { id: 'C2:tautology', label: '恒真假断言', re: /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|\bassert(?:\.ok)?\(\s*true\s*\)/ }
];

function leNormalizeRel(projectRoot, rawFile) {
  const abs = resolve(projectRoot, rawFile);
  const rel = relative(projectRoot, abs).split(sep).join('/');
  return { abs, rel };
}

function leLoadContractScopeOwners(projectRoot) {
  const cDir = join(projectRoot, 'contracts');
  if (!existsSync(cDir)) return [];
  const entries = [];
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = readJsonStrict(join(cDir, e.name, 'contract.json'));
    if (!r.ok || !r.value || r.value.retired) continue;
    const scopes = (Array.isArray(r.value.scope) ? r.value.scope : [])
      .map((s) => String(s || '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter(Boolean);
    entries.push({ id: r.value.id, scopes });
  }
  return entries;
}

function leMatchesSingleScope(relPath, s) {
  if (s.endsWith('/')) return relPath.startsWith(s);
  if (relPath === s || relPath.startsWith(s + '/')) return true;
  const companionPrefix = s.replace(/\.(?:mjs|cjs|js|ts|tsx|jsx)$/, '') + '/';
  return companionPrefix !== s + '/' && relPath.startsWith(companionPrefix);
}

function leMatchScopeOwner(relPath, scopeEntries) {
  return scopeEntries
    .filter((entry) => entry.scopes.some((s) => leMatchesSingleScope(relPath, s)))
    .map((entry) => entry.id);
}

function leCheckSyntax(abs, rel, raw, fails) {
  const ext = extname(rel).toLowerCase();
  if (ext === '.json') {
    try { JSON.parse(raw); } catch (e) { fails.push(`M5 JSON 语法损坏 (${rel})：${e.message}`); }
    return;
  }
  if (ext === '.jsonl') {
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { JSON.parse(lines[i]); } catch (e) { fails.push(`M5 JSONL 第 ${i + 1} 行损坏 (${rel})：${e.message}`); break; }
    }
    return;
  }
  if (/\.(mjs|cjs|js)$/i.test(rel)) {
    const chk = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    if (chk.status !== 0) {
      const stderrLines = (chk.stderr || '').trim().split(/\r?\n/);
      const msg = (stderrLines.find((l) => /SyntaxError/.test(l)) || stderrLines[0] || '语法错误').trim();
      fails.push(`M1 JS/ESM 语法错误 (${rel})：${msg}`);
    }
  }
}

function leCheckScaleAndComplexity(rel, raw, isTestOrFixture, budgets, warnings, fails) {
  const lineMetrics = countEffectiveCodeLines(raw);
  const rawLineCount = raw.split(/\r?\n/).length;
  if (/^runner\/core\/[^/]+\.mjs$/.test(rel) && rawLineCount > 350) {
    fails.push(`M6 核心子模块超行数硬顶 (${rel})：物理行数 ${rawLineCount} > 350 行上限（请拆分子模块）`);
  }
  if (!isTestOrFixture && (lineMetrics.effectiveLines > budgets.maxEffectiveFileLines || lineMetrics.rawLines > budgets.maxFileLines)) {
    fails.push(`C1 单文件规模超限 (${rel})：有效代码 ${lineMetrics.effectiveLines} 行（总 ${lineMetrics.rawLines} 行）> 上限 ${budgets.maxEffectiveFileLines} / ${budgets.maxFileLines}`);
  }
  if (isTestOrFixture || !JS_LIKE_RE.test(rel)) return lineMetrics;
  const cx = analyzeCodeComplexityAndGolfing(raw);
  for (const g of cx.golfingIssues) {
    const desc = g.kind === 'dense-statements' ? `单行挤压 ${g.count} 条语句` : `单行嵌套 ${g.count} 重三元`;
    fails.push(`C4g 反压行拦截 (${rel}:L${g.line})：${desc} → ${g.preview}`);
  }
  for (const fn of cx.functions) {
    if (fn.cognitiveComplexity > budgets.maxCognitiveComplexity) {
      fails.push(`C1d 认知复杂度超限 (${rel} · ${fn.name} L${fn.startLine}-L${fn.endLine})：${fn.cognitiveComplexity} > ${budgets.maxCognitiveComplexity}`);
    } else if (fn.cognitiveComplexity > budgets.warnCognitiveComplexity) {
      warnings.push(`C1d 认知复杂度接近上限 (${rel} · ${fn.name} L${fn.startLine})：${fn.cognitiveComplexity}（建议 <= ${budgets.warnCognitiveComplexity}）`);
    }
  }
  return lineMetrics;
}

function leAuditSingleProdLine(rel, line, lineNo, isConcreteAdapter, fails) {
  for (const r of SLOP_RULES) {
    if (r.re.test(line)) fails.push(`${r.id} ${r.label} (${rel}:L${lineNo})：${line.trim().slice(0, 90)}`);
  }
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
  if (isConcreteAdapter && /from\s+['"](?:node:)?(?:crypto|child_process)['"]/.test(line)) {
    fails.push(`C6 具体适配器禁止直引 crypto/child_process (${rel}:L${lineNo})`);
  }
  const isHashOwner = rel === 'skill/hash.mjs' || rel === 'skill/adapters/_shared.mjs';
  if (/^(?:runner|skill)\/.*\.mjs$/.test(rel) && !isHashOwner && RAW_SHA_CALL_RE.test(line)) {
    fails.push(`C6 禁止重复手搓 SHA-256 哈希 (${rel}:L${lineNo})：请复用 skill/hash.mjs 的 sha256()`);
  }
}

function leCheckLineRules(rel, raw, isTestOrFixture, fails) {
  if (SELF_META_EXEMPT_RE.test(rel)) return;
  const lines = raw.split(/\r?\n/);
  const isConcreteAdapter = /^skill\/adapters\/(?!_)[^/]+\.mjs$/.test(rel);
  if (isConcreteAdapter && lines.length > 90) {
    fails.push(`C6 具体适配器超 90 行上限 (${rel})：当前 ${lines.length} 行`);
  }
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const allowMatch = line.match(ALLOW_TAG_RE);
    if (allowMatch && allowMatch[1].trim().length >= 6) continue;
    if (isTestOrFixture) {
      if (!/^\s*(?:\/\/|\*|\/\*)/.test(line)) {
        for (const r of TEST_CHEAT_RULES) {
          if (r.re.test(line)) fails.push(`${r.id} ${r.label} (${rel}:L${idx + 1})：${line.trim().slice(0, 90)}`);
        }
      }
    } else {
      leAuditSingleProdLine(rel, line, idx + 1, isConcreteAdapter, fails);
    }
  }
}

function leReadBalancedFnChunk(lines, startIdx) {
  let depth = 0;
  let started = false;
  const chunk = [];
  for (let j = startIdx; j < Math.min(lines.length, startIdx + 300); j++) {
    chunk.push(lines[j]);
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) break;
  }
  return chunk.join('\n');
}

function leCollectLocalTopFunctions(raw) {
  const localFns = new Map();
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m && !m[1].startsWith('buildWb')) {
      localFns.set(m[1], { line: i + 1, body: leReadBalancedFnChunk(lines, i) });
    }
  }
  return localFns;
}

function leCheckInlineScriptRegistry(rel, raw, fails) {
  const regMatch = raw.match(/const\s+(WB_[A-Z0-9_]+_FNS)\s*=\s*\[([\s\S]*?)\];/);
  if (!regMatch) return;
  const regName = regMatch[1];
  const registered = new Set(
    regMatch[2].split(',').map((s) => s.replace(/\/\/[^\n]*/g, '').trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
  );
  if (registered.size === 0) return;
  const localFns = leCollectLocalTopFunctions(raw);
  const unmounted = [...localFns.entries()].filter(([name]) => !registered.has(name));
  for (const fnName of registered) {
    const fnMeta = localFns.get(fnName);
    if (!fnMeta) continue;
    for (const [candName, candMeta] of unmounted) {
      if (new RegExp(`\\b${candName}\\s*\\(`).test(fnMeta.body)) {
        fails.push(`ACI 内联浏览器脚本漏挂载 (${rel}:L${candMeta.line})：已注册函数 \`${fnName}\` 调用了本地辅助函数 \`${candName}\`，但 \`${candName}\` 未加入 \`${regName}\` 数组（浏览器运行将报 ReferenceError）`);
      }
    }
  }
}

export function lintEditedFiles(projectRoot, targetFiles = []) {
  const t0 = Date.now();
  const root = resolve(projectRoot);
  if (!existsSync(root) || targetFiles.length === 0) {
    return { exitCode: 3, durationMs: 0, files: [], fails: ['用法：donegate lint-edit <file1> [file2...]'], warnings: [] };
  }
  const budgets = loadHygieneBudgets(root);
  const scopeEntries = leLoadContractScopeOwners(root);
  const fails = [], warnings = [], fileReports = [];

  for (const rawTarget of targetFiles) {
    const { abs, rel } = leNormalizeRel(root, rawTarget);
    if (!existsSync(abs)) {
      fails.push(`目标文件不存在：${rel}`);
      continue;
    }
    const raw = readFileSync(abs, 'utf8');
    const fileFailsBefore = fails.length;
    const isTestOrFixture = TEST_OR_FIXTURE_RE.test(rel);
    leCheckSyntax(abs, rel, raw, fails);
    if (/^decisions\/[^/]+\.md$/.test(rel)) {
      const dv = validateDecisionFiveSections(raw, rel);
      if (dv.missing.length > 0) fails.push(`C4d 决策记录缺少 §2.5 必填章节 (${rel})：缺 [${dv.missing.join('、')}]`);
      if (dv.empty.length > 0) fails.push(`C4d 决策记录存在空壳章节 (${rel})：空 [${dv.empty.join('、')}]`);
    }
    const lm = leCheckScaleAndComplexity(rel, raw, isTestOrFixture, budgets, warnings, fails);
    if (JS_LIKE_RE.test(rel)) {
      leCheckLineRules(rel, raw, isTestOrFixture, fails);
      leCheckInlineScriptRegistry(rel, raw, fails);
    }
    const termRes = scanTerminologyViolations(root, { scopes: [rel] });
    for (const v of termRes.violations || []) {
      fails.push(`术语漂移 [${v.ruleId}] (${v.file}:L${v.line})：命中「${v.matched}」→ 应改为「${v.replacement}」`);
    }
    const owners = leMatchScopeOwner(rel, scopeEntries);
    if (scopeEntries.length > 0 && JS_LIKE_RE.test(rel) && !isTestOrFixture && !/^[^/]+\.(?:config|rc)\.[a-z0-9]+$/i.test(rel) && owners.length === 0) {
      warnings.push(`契约归属提示 (${rel})：当前未被任何活跃契约 scope[] 认领（提交前需归入对应契约或伴生子模块目录）`);
    }
    fileReports.push({
      file: rel,
      ok: fails.length === fileFailsBefore,
      owners,
      effectiveLines: lm.effectiveLines,
      rawLines: lm.rawLines,
      headroomLines: Math.max(0, budgets.maxEffectiveFileLines - lm.effectiveLines)
    });
  }

  return {
    exitCode: fails.length > 0 ? 1 : 0,
    durationMs: Date.now() - t0,
    files: fileReports,
    fails,
    warnings,
    failDetails: attachFixHints(fails),
    warningDetails: attachFixHints(warnings)
  };
}

export function cmdLintEdit(projectRoot, opts = {}) {
  const targets = Array.isArray(opts.files) ? opts.files : [];
  const res = lintEditedFiles(projectRoot, targets);
  if (res.exitCode === 3) return { exitCode: 3, stderr: res.fails.join('\n') };
  if (opts.json) return { exitCode: res.exitCode, report: res, stdout: JSON.stringify(res, null, 2) };
  const lines = res.files.map(
    (f) => `${f.ok ? '✓' : '✗'} ${f.file} [有效 ${f.effectiveLines} 行 | 余量 ${f.headroomLines} 行 | 归属 ${f.owners.join(',') || '共享/测试'}]`
  );
  for (const w of res.warnings) lines.push(`  ⚠ ${w}`);
  for (const fl of res.fails) {
    lines.push(`  ✗ ${fl}`);
    const hint = resolveLintFixHint(fl);
    if (hint) lines.push(`    ↳ 修复配方：${hint}`);
  }
  lines.push(`RESULT: ${res.exitCode === 0 ? 'PASS' : 'FAIL'} lint-edit (${res.files.length} 个文件, ${res.durationMs}ms)`);
  return {
    exitCode: res.exitCode,
    report: res,
    stdout: lines.join('\n'),
    ...(res.fails.length > 0 ? { stderr: `lint-edit 检出 ${res.fails.length} 项问题` } : {})
  };
}

function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-lint-edit-'));
  let bad = 0;
  const t = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };
  try {
    mkdirSync(join(tmp, 'contracts/c1'), { recursive: true });
    mkdirSync(join(tmp, 'runner/core'), { recursive: true });
    mkdirSync(join(tmp, 'runner/atlas'), { recursive: true });
    writeFileSync(join(tmp, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['runner/core/', 'runner/atlas/wb-demo.mjs'], obligations: [] }));

    writeFileSync(join(tmp, 'runner/core/clean.mjs'), 'export function add(a, b) {\n  return a + b;\n}\n');
    const rClean = lintEditedFiles(tmp, ['runner/core/clean.mjs']);
    t('正样本：干净低复杂度单文件毫秒级放行（exit 0）', rClean.exitCode === 0 && rClean.files[0].owners.includes('c1'));

    writeFileSync(join(tmp, 'runner/core/golf.mjs'), 'export function g(a, b, c) { let x = a + 1; let y = b + 2; let z = c + 3; return x + y + z; }\n');
    const rGolf = lintEditedFiles(tmp, ['runner/core/golf.mjs']);
    t('必红样本 1：单行挤压多语句 C4g 即时拦截并定位行号', rGolf.exitCode === 1 && rGolf.fails.some((x) => x.includes('C4g') && x.includes(':L1')));

    const overLines = Array.from({ length: 355 }, (_, i) => `export const k${i} = ${i};`).join('\n') + '\n';
    writeFileSync(join(tmp, 'runner/core/over.mjs'), overLines);
    const rOver = lintEditedFiles(tmp, ['runner/core/over.mjs']);
    t('必红样本 2：runner/core 子模块超 350 行硬顶当场拦截', rOver.exitCode === 1 && rOver.fails.some((x) => x.includes('M6 核心子模块超行数硬顶')));

    const wbMissing = [
      'function wbDemoUnmountedHelper(v) {',
      '  return v + 1;',
      '}',
      'export function wbDemoRegistered(v) {',
      '  return wbDemoUnmountedHelper(v);',
      '}',
      'const WB_DEMO_SOLVER_FNS = [wbDemoRegistered];',
      'export function buildWbDemo() {',
      '  return WB_DEMO_SOLVER_FNS.map((f) => f.toString()).join("\\n");',
      '}'
    ].join('\n') + '\n';
    writeFileSync(join(tmp, 'runner/atlas/wb-demo.mjs'), wbMissing);
    const rWb = lintEditedFiles(tmp, ['runner/atlas/wb-demo.mjs']);
    t('必红样本 3：内联浏览器脚本提取子函数漏注册进 WB_*_FNS 当场抓获', rWb.exitCode === 1 && rWb.fails.some((x) => x.includes('wbDemoUnmountedHelper') && x.includes('WB_DEMO_SOLVER_FNS')));

    writeFileSync(join(tmp, 'runner/core/term.mjs'), 'export const label = "核心护栏" + "包";\n'.replace('" + "', ''));
    const rTerm = lintEditedFiles(tmp, ['runner/core/term.mjs']);
    t('必红样本 4：单文件未归一化违禁词即时拦截', rTerm.exitCode === 1 && rTerm.fails.some((x) => x.includes('术语漂移')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(bad === 0 ? '\nRESULT: PASS lint-edit 单文件毫秒级微门禁 5 组红绿样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  const asJson = argv.includes('--json');
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') { i++; continue; }
    if (argv[i].startsWith('--')) continue;
    files.push(argv[i]);
  }
  const res = cmdLintEdit(root, { files, json: asJson });
  if (res.stdout) console.log(res.stdout);
  if (res.stderr && !res.stdout) console.error(res.stderr);
  process.exit(res.exitCode);
}
