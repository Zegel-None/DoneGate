#!/usr/bin/env node
// 四维结构化提交与认知复杂度硬门禁（融合 Google Small CLs 测试豁免、Cisco 250/450 双水位、6/10 散度锁、Campbell 2018 认知复杂度与反压行钻空子 + C2/C3/C4/C5/C6）
// 退出码（§八 四值）：0 通过 / 1 检出超量、高认知复杂度、压行天书、作弊、省略删码或未认领野文件 / 2 逃生口滥用 / 3 环境或 git 读取错误
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';
import { analyzeCodeComplexityAndGolfing, auditRepository4D } from './cognitive-complexity.mjs';
import { DEFAULT_HYGIENE_BUDGETS, computeRelocatedCodeLines, countEffectiveCodeLines, loadHygieneBudgets } from './commit-hygiene-metrics.mjs';

export { DEFAULT_HYGIENE_BUDGETS, computeRelocatedCodeLines, countEffectiveCodeLines };

const CODE_EXT_RE = /\.(mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TEST_FILE_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|(^|\/)check-[a-z0-9-]+\.mjs$/i;
const TEST_BUDGET_EXEMPT_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$/i;
const FIXTURE_OR_PILOT_RE = /(^|\/)(tests\/|skill\/pilot-|.*-fixtures\.mjs$|skill\/check-commit-hygiene\.mjs$|skill\/check-ai-habits\.mjs$|skill\/check-escapes\.mjs$|skill\/check-module-integrity\.mjs$|skill\/install-hooks\.mjs$)/i;
const ROGUE_ROOT_DIR_RE = /^(?:_[A-Za-z0-9_-]+|tmp|temp|scratch|bak|backup|old|drafts?|playground)$/i;
const ROOT_CONFIG_FILE_RE = /^[^/]+\.(?:config|rc)\.[a-z0-9]+$/i;
const MECHANICAL_SHARD_RE = /(?:[-_](?:part|chunk|slice|shard)\d*|[-_][a-z])\.(?:mjs|cjs|js|ts|tsx|jsx|py)$/i;

const TEST_CHEAT_PATTERNS = [
  { name: '跳过用例 (.skip / xit / xdescribe)', re: /\b(?:it|test|describe)\.skip\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/ },
  { name: '独占用例 (.only 漏删导致其余测试全被跳过)', re: /\b(?:it|test|describe)\.only\s*\(/ },
  { name: '空壳待办用例 (test.todo / it.todo)', re: /\b(?:it|test)\.todo\s*\(/ },
  { name: '恒真假断言 (expect(true).toBe(true) / assert(true))', re: /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|expect\(\s*1\s*\)\.toBe\(\s*1\s*\)|\bassert(?:\.ok)?\(\s*true\s*\)/ },
  { name: '静态检查强行豁免 (eslint-disable / biome-ignore / @ts-ignore / # type: ignore)', re: /eslint-disable|biome-ignore|@ts-ignore|@ts-nocheck|#\s*type:\s*ignore|#\s*noqa\b/ }
];

const CODE_SLOP_PATTERNS = [
  { name: '未完成占位符 (TODO / FIXME / XXX / HACK)', re: /(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|XXX|HACK)\b/ },
  { name: '空壳未实现异常 (Not implemented)', re: /throw\s+new\s+Error\(\s*['"`](?:not implemented|todo|unimplemented)/i },
  { name: '残留调试断点 (debugger)', re: /^\s*debugger\s*;?\s*$/ },
  { name: '空 catch 静默吞异常', re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/ },
  { name: 'AI 懒惰省略注释疑似静默删代码 (existing code / rest unchanged / 其余代码不变)', re: /(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:(?:existing|unchanged|remaining|previous|rest\s+of(?:\s+the)?)\s+(?:code|implementation|logic|methods?|functions?|file|body|lines?)|omitted\s+for\s+brevity|(?:其余|剩余|原有|上述|中间)(?:代码|逻辑|实现|内容|部分)\s*(?:保持不变|不变|省略|同上|略))/i }
];

const CONFLICT_MARKER_RE = /^(?:<{7}\s|={7}\s*$|>{7}\s)/;
const ASSERT_TOKEN_RE = /\b(?:expect\s*\(|assert(?:\.[a-zA-Z]+)?\s*\(|c\.check\s*\()/;
const ALLOW_MARKER_RE = /(?:\/\/|#)\s*dg-allow\s*:(.*)$/;

function loadActiveContractScopes(projectRoot) {
  const cDir = join(projectRoot, 'contracts');
  if (!existsSync(cDir)) return [];
  const scopes = [];
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = readJsonStrict(join(cDir, e.name, 'contract.json'));
    if (!r.ok || !r.value || r.value.retired) continue;
    for (const s of (Array.isArray(r.value.scope) ? r.value.scope : [])) {
      if (typeof s === 'string' && s.trim()) scopes.push(s.trim().replace(/\\/g, '/').replace(/^\.\//, ''));
    }
  }
  return scopes;
}

const isClaimedByScopes = (relPath, scopes) => scopes.some((s) => (s.endsWith('/') ? relPath.startsWith(s) : (relPath === s || relPath.startsWith(s + '/'))));

function listUntrackedFiles(projectRoot) {
  const r = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean) : [];
}

export function cleanScratchDir(projectRoot) {
  const scratchDir = join(projectRoot, '.donegate', 'scratch');
  if (!existsSync(scratchDir)) return { cleaned: 0 };
  let cleaned = 0;
  for (const entry of readdirSync(scratchDir)) {
    if (entry === '.gitkeep') continue;
    rmSync(join(scratchDir, entry), { recursive: true, force: true });
    cleaned++;
  }
  return { cleaned };
}

export function quarantineUnclaimedFiles(projectRoot) {
  const budgets = loadHygieneBudgets(projectRoot), allowedSet = new Set(budgets.allowedRootDirs), scopes = loadActiveContractScopes(projectRoot);
  const targets = listUntrackedFiles(projectRoot).filter((p) => {
    const seg0 = p.includes('/') ? p.split('/')[0] : null;
    if (seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedSet.has(seg0)) return true;
    if (/\.(bak|orig|tmp|swp)$/i.test(p) || /(?:_copy|-copy|_backup)\./i.test(p)) return true;
    return scopes.length > 0 && CODE_EXT_RE.test(p) && !TEST_FILE_RE.test(p) && !ROOT_CONFIG_FILE_RE.test(p) && !isClaimedByScopes(p, scopes);
  });
  if (targets.length === 0) return { moved: [], batchDir: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), qRoot = join(projectRoot, '.donegate', 'quarantine'), batchDir = join(qRoot, stamp);
  mkdirSync(batchDir, { recursive: true });
  const moved = [], nowIso = new Date().toISOString();
  for (const rel of targets) {
    const src = join(projectRoot, rel), dst = join(batchDir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved.push(rel);
    appendFileSync(join(qRoot, 'manifest.jsonl'), JSON.stringify({ at: nowIso, from: rel, quarantinePath: `.donegate/quarantine/${stamp}/${rel}` }) + '\n', 'utf8');
  }
  return { moved, batchDir: `.donegate/quarantine/${stamp}` };
}

function hyApplyDiffLine(cur, rawLine) {
  if (rawLine.startsWith('--- ')) return;
  if (rawLine.startsWith('@@ ')) {
    const hm = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hm) return;
    const start = Number(hm[1]), cnt = hm[2] === undefined ? 1 : Number(hm[2]);
    if (cnt > 0) cur.hunkRanges.push([start, start + cnt - 1]);
    return;
  }
  if (rawLine.startsWith('new file mode ')) { cur.isNew = true; return; }
  if (rawLine.startsWith('deleted file mode ') || rawLine.startsWith('+++ /dev/null')) { cur.isDeleted = true; return; }
  if (rawLine.startsWith('rename to ')) { cur.isRename = true; cur.path = rawLine.slice(10).trim(); return; }
  if (rawLine.startsWith('+++ b/')) { cur.path = rawLine.slice(6).trim(); return; }
  if (rawLine.startsWith('+')) cur.added.push(rawLine.slice(1));
  else if (rawLine.startsWith('-')) cur.removed.push(rawLine.slice(1));
}

function parseUnifiedDiff(diffText) {
  const all = [], activeFiles = [], deletedFiles = [];
  let cur = null;
  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      const m = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { path: m ? m[2].trim() : null, isNew: false, isDeleted: false, isRename: false, added: [], removed: [], hunkRanges: [] };
      all.push(cur);
    } else if (cur) {
      hyApplyDiffLine(cur, rawLine);
    }
  }
  for (const f of all) {
    if (!f.path) continue;
    if (f.isDeleted) deletedFiles.push(f);
    else activeFiles.push(f);
  }
  return { activeFiles, deletedFiles };
}

function applyAllowOrFail(line, p, rulePrefix, ruleKey, failMsg, ctx) {
  const m = line.match(ALLOW_MARKER_RE);
  if (!m) { ctx.fails.push(failMsg); return; }
  const reason = m[1].trim();
  if (reason.length < 6 || /^(ok|pass|temp|skip|ignore|todo|允许|跳过|豁免)$/i.test(reason)) {
    ctx.abuses.push(`${rulePrefix} ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
  } else {
    ctx.bypasses.push({ rule: ruleKey, file: p, reason });
  }
}

function hyAuditTestCheats(f, p, isFixture, ctx) {
  for (const line of f.added) {
    if (isFixture && /^\s*(?:check|t|writeFileSync|\{ name:)/.test(line)) continue;
    const isCommentLine = /^\s*(?:\/\/|\*|\/\*|#)/.test(line);
    for (const pat of TEST_CHEAT_PATTERNS) {
      if ((!isCommentLine || pat.name.includes('静态检查强行豁免')) && pat.re.test(line)) {
        applyAllowOrFail(line, p, 'C2', `C2:${pat.name}`, `C2 测试反作弊拦截 [${pat.name}] (${p})：${line.trim().slice(0, 100)}`, ctx);
      }
    }
  }
  if (!f.isNew) {
    const addedAsserts = f.added.filter((l) => ASSERT_TOKEN_RE.test(l)).length;
    const removedAsserts = f.removed.filter((l) => ASSERT_TOKEN_RE.test(l)).length;
    if (removedAsserts > addedAsserts && !ctx.files.some((x) => x.isNew && x.path.startsWith('decisions/')) && !ctx.budgetBypassed) {
      ctx.fails.push(`C2 疑似删断言凑绿 (${p})：删除了 ${removedAsserts} 处断言但仅新增 ${addedAsserts} 处（确需废弃无效断言请同步新增 decisions/ 记录说明）`);
    }
  }
}

function hyAuditAntiHandroll(f, p, absFile, ctx) {
  const isConcreteAdapter = /^skill\/adapters\/(?!_)[^/]+\.mjs$/.test(p);
  if (isConcreteAdapter && existsSync(absFile)) {
    const adpLines = readFileSync(absFile, 'utf8').split(/\r?\n/).length;
    if (adpLines > 90) ctx.fails.push(`C6 具体适配器行数超限 (${p})：当前 ${adpLines} 行 > 上限 90 行（请复用 ./_shared.mjs 的 runAdapter）`);
  }
  for (const line of f.added) {
    if (/^\s*(?:\/\/|\*|\/\*|#)/.test(line)) continue;
    if (isConcreteAdapter && /from\s+['"](?:node:)?(?:crypto|child_process)['"]/.test(line)) {
      applyAllowOrFail(line, p, 'C6', 'C6:adapter-primitive', `C6 反手搓拦截 (${p})：具体适配器禁止直引 node:crypto 或 node:child_process，请调 ./_shared.mjs → ${line.trim().slice(0, 90)}`, ctx);
    }
    if (/^(?:runner|skill)\/.*\.mjs$/.test(p) && p !== 'skill/hash.mjs' && p !== 'skill/adapters/_shared.mjs' && /\bcreateHash\s*\(\s*['"]sha256['"]\s*\)/.test(line)) {
      applyAllowOrFail(line, p, 'C6', 'C6:dup-sha256', `C6 反手搓拦截 (${p})：禁止重复手搓 createHash('sha256')，请复用 skill/hash.mjs 的 sha256() → ${line.trim().slice(0, 90)}`, ctx);
    }
    for (const bp of ctx.compiledBanned) {
      if ((!bp.pathRe || bp.pathRe.test(p)) && (!bp.excludeRe || !bp.excludeRe.test(p)) && bp.re.test(line)) {
        applyAllowOrFail(line, p, 'C6', `C6:${bp.id}`, `C6 公共库防手搓拦截 [${bp.id}] (${p})：${bp.message} → ${line.trim().slice(0, 90)}`, ctx);
      }
    }
  }
}

function auditCodeFileRules(f, p, absFile, isFixture, isTestFile, ctx) {
  if (isTestFile) hyAuditTestCheats(f, p, isFixture, ctx);
  if (!isFixture) hyAuditAntiHandroll(f, p, absFile, ctx);
  if (!isTestFile && !isFixture) {
    for (const line of f.added) {
      for (const pat of CODE_SLOP_PATTERNS) {
        if (pat.re.test(line)) applyAllowOrFail(line, p, 'C3', `C3:${pat.name}`, `C3 源码反空壳拦截 [${pat.name}] (${p})：${line.trim().slice(0, 100)}`, ctx);
      }
    }
  }
}

function hyRangeOverlaps(startA, endA, ranges) {
  return ranges.some(([s, e]) => startA <= e && endA >= s);
}

function hyAuditFileScaleAndComplexity(f, p, absFile, isFixture, isExemptTest, budgets, budgetBypassed, warnings, fails) {
  if (!existsSync(absFile) || budgetBypassed) return;
  const src = readFileSync(absFile, 'utf8');
  if (f.isNew || f.added.length > f.removed.length) {
    const m = countEffectiveCodeLines(src);
    if (m.effectiveLines > budgets.maxEffectiveFileLines || m.rawLines > budgets.maxFileLines) {
      fails.push(`C1 单文件规模超限：${p} 当前有效代码 ${m.effectiveLines} 行（总 ${m.rawLines} 行）> 上限 ${budgets.maxEffectiveFileLines} 有效行 / ${budgets.maxFileLines} 总行（请按职责语义拆分子模块）`);
    } else if (m.effectiveLines > budgets.warnEffectiveFileLines) {
      warnings.push(`C1 软预警：${p} 有效代码 ${m.effectiveLines} 行（已超 ${budgets.warnEffectiveFileLines} 舒适区）`);
    }
    if (budgets.maxFunctionLines > 0 && m.maxFnLines > budgets.maxFunctionLines) {
      fails.push(`C1 单函数过程逻辑超限：${p} 存在 ${m.maxFnLines} 行的超长过程函数 > 上限 ${budgets.maxFunctionLines} 行`);
    } else if (m.maxFnLines > budgets.warnFunctionLines) {
      warnings.push(`V8 内联预警：${p} 存在 ${m.maxFnLines} 行的超长单函数（> ${budgets.warnFunctionLines} 行建议提取语义子函数）`);
    }
  }
  if (isFixture || isExemptTest || !/\.(mjs|cjs|js|ts|tsx|jsx)$/i.test(p)) return;
  const cx = analyzeCodeComplexityAndGolfing(src);
  for (const g of cx.golfingIssues) {
    if (f.isNew || hyRangeOverlaps(g.line, g.line, f.hunkRanges)) {
      const label = g.kind === 'dense-statements' ? `单行挤压 ${g.count} 条语句` : `单行嵌套 ${g.count} 重三元表达式`;
      fails.push(`C4g 反压行钻空子拦截 (${p}:L${g.line})：检测到${label}（严禁为省行数压缩可读性）→ ${g.preview}`);
    }
  }
  for (const fn of cx.functions) {
    if (!f.isNew && !hyRangeOverlaps(fn.startLine, fn.endLine, f.hunkRanges)) continue;
    if (fn.cognitiveComplexity > budgets.maxCognitiveComplexity) {
      fails.push(`C1d 函数认知复杂度超限 (${p} · ${fn.name} L${fn.startLine}-L${fn.endLine})：认知复杂度 ${fn.cognitiveComplexity} > 硬上限 ${budgets.maxCognitiveComplexity}（请用早返回守卫或拆分子函数降复杂度）`);
    } else if (fn.cognitiveComplexity > budgets.warnCognitiveComplexity) {
      warnings.push(`C1d 认知复杂度软提示 (${p} · ${fn.name} L${fn.startLine}-L${fn.endLine})：认知复杂度 ${fn.cognitiveComplexity} > 建议值 ${budgets.warnCognitiveComplexity}`);
    }
  }
}

function hyAuditFilePathHygiene(f, p, isFixture, projectRoot, allowedRootSet, fails) {
  if (!isFixture) {
    const conflictLine = f.added.find((line) => CONFLICT_MARKER_RE.test(line));
    if (conflictLine) fails.push(`C3 发现未解决的 Git 合并冲突标记 (${p})：${conflictLine.trim().slice(0, 60)}`);
  }
  if (/\.(bak|orig|tmp|swp)$/i.test(p) || /(?:_copy|-copy|_backup)\./i.test(p)) {
    fails.push(`C4 禁止提交临时或备份文件：${p}`);
  }
  if (!p.startsWith('归档/') && !p.startsWith('证据/') && /(?:[-_]v\d+|[-_]final|[-_]new)\.(?:md|mjs|js|ts|json)$/i.test(p) && f.isNew) {
    fails.push(`C4 禁止新建带版本号后缀的平行草稿文件（请直接迭代主文件或用 git mv 归档旧版）：${p}`);
  }
  if (f.isNew && !isFixture && MECHANICAL_SHARD_RE.test(p)) {
    fails.push(`C4 禁止机械按字母/序号切碎代码文件 (${p})：请按职责语义命名模块`);
  }
  if (f.isNew && /^decisions\/[^/]+\.md$/.test(p)) {
    const base = p.split('/')[1], dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!dateMatch) fails.push(`C4 决策记录命名必须以 YYYY-MM-DD-NN- 开头：${p}`);
    else {
      const decDir = join(projectRoot, 'decisions');
      const sameDayPeers = existsSync(decDir) ? readdirSync(decDir).filter((x) => x.startsWith(dateMatch[1] + '-') && x !== base) : [];
      if (sameDayPeers.length > 0 && !/^\d{2,3}-/.test(dateMatch[2])) {
        fails.push(`C4 同日（${dateMatch[1]}）已存在决策记录，新记录必须加序号前缀 YYYY-MM-DD-NN-<标题>.md：${p}`);
      }
    }
  }
  const seg0 = p.includes('/') ? p.split('/')[0] : null;
  if ((f.isNew || f.isRename) && seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
    fails.push(`C5 禁止向仓库根级非标临时目录提交文件：${p}`);
  }
}

function hyCompileBannedRules(bannedPatterns, abuses) {
  const compiled = [];
  for (const rule of (bannedPatterns || [])) {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) continue;
    try {
      compiled.push({
        id: rule.id || rule.pattern,
        re: new RegExp(rule.pattern, rule.flags || ''),
        pathRe: rule.pathRegex ? new RegExp(rule.pathRegex) : null,
        excludeRe: rule.excludePathRegex ? new RegExp(rule.excludePathRegex) : null,
        message: rule.message || '命中项目公共库防手搓禁令'
      });
    } catch (e) {
      abuses.push(`thresholds.json bannedPatterns 正则配置损坏 [${rule.id || rule.pattern}]（退 2）：${e.message}`);
    }
  }
  return compiled;
}

function hyEvaluateFourDimBudgets(stats, budgets, explicitProdFileCap, isPureConsolidation, warnings, fails) {
  if (stats.prodAdded > budgets.maxRawCommitCodeLines) {
    fails.push(`C1 单次提交生产代码加行数超预算（触发原始硬顶）：原始新增 ${stats.prodAdded} 行 > 硬上限 ${budgets.maxRawCommitCodeLines} 行`);
  } else if (!isPureConsolidation && stats.netNewCodeLines > budgets.maxCommitCodeLines) {
    fails.push(`C1 单次提交生产代码加行数超预算：净新增生产代码 ${stats.netNewCodeLines} 行（原始 +${stats.prodAdded}，重定位复用 ${stats.relocatedCodeLines}，已豁免测试 ${stats.testAdded} 行）> 硬上限 ${budgets.maxCommitCodeLines} 行`);
  } else if (!isPureConsolidation && stats.netNewCodeLines > budgets.warnCommitCodeLines) {
    warnings.push(`C1 生产代码规模软提示：净新增生产代码 ${stats.netNewCodeLines} 行处于 ${budgets.warnCommitCodeLines + 1}–${budgets.maxCommitCodeLines} 弹性放行区间（已豁免测试 ${stats.testAdded} 行）`);
  }
  if (!isPureConsolidation && stats.prodFiles > explicitProdFileCap) {
    fails.push(`C1 单次提交涉及生产源码文件数超预算：本次改动 ${stats.prodFiles} 个生产代码文件 > 上限 ${explicitProdFileCap} 个（测试文件已豁免）`);
  }
  if (!isPureConsolidation && stats.codeFiles > budgets.maxCommitFiles) {
    fails.push(`C1 单次提交涉及源码文件数超预算：源码+测试共改动 ${stats.codeFiles} 个文件 > 总上限 ${budgets.maxCommitFiles} 个`);
  }
  if (stats.netNewCodeLines >= 80 && stats.testFiles === 0 && stats.relocatedCodeLines < stats.prodAdded * 0.5) {
    warnings.push(`C1t 同批测试提示：本次净增生产代码 ${stats.netNewCodeLines} 行但未包含测试文件变更（按 Google Small CLs 建议同批附带关联测试）`);
  }
}

export function auditCommitDiff(projectRoot, opts = {}) {
  const mode = opts.range ? 'range' : 'staged';
  const gitArgs = mode === 'range'
    ? ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--unified=0', opts.range]
    : ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--cached', '--unified=0'];
  const diffR = spawnSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (diffR.status !== 0) return { exitCode: 3, fails: [`无法读取 git diff (${mode})：${diffR.stderr || ''}`], warnings: [], bypasses: [] };

  const loaded = loadHygieneBudgets(projectRoot), budgets = { ...loaded, ...(opts.budgets || {}) };
  const explicitProdFileCap = opts.budgets?.maxCommitFiles && !opts.budgets?.maxProdCommitFiles
    ? Number(opts.budgets.maxCommitFiles)
    : budgets.maxProdCommitFiles;
  const allowedRootSet = new Set(budgets.allowedRootDirs || []), activeScopes = loadActiveContractScopes(projectRoot);
  const { activeFiles: files, deletedFiles } = parseUnifiedDiff(diffR.stdout || '');
  const fails = [], warnings = [], abuses = [], bypasses = [];
  const compiledBanned = hyCompileBannedRules(budgets.bannedPatterns, abuses);

  if (mode === 'staged' && opts.checkUntracked !== false) {
    for (const u of listUntrackedFiles(projectRoot)) {
      const seg0 = u.includes('/') ? u.split('/')[0] : null;
      if (seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
        fails.push(`C5 仓库根下存在未跟踪野目录文件：${u}（一次性草稿请放入 .donegate/scratch/，或跑 node skill/check-commit-hygiene.mjs --quarantine 移入隔离箱）`);
      }
    }
  }
  if (files.length === 0 && fails.length === 0) {
    return { exitCode: 0, fails: [], warnings: [], bypasses: [], stats: { codeFiles: 0, prodFiles: 0, testFiles: 0, codeAdded: 0, prodAdded: 0, testAdded: 0, relocatedCodeLines: 0, netNewCodeLines: 0 } };
  }

  let budgetBypassed = false;
  const envBudgetBypass = typeof opts.budgetBypassReason === 'string' ? opts.budgetBypassReason : (process.env.DG_ALLOW_COMMIT_BUDGET || '');
  if (envBudgetBypass !== '') {
    const cleanReason = envBudgetBypass.trim();
    if (cleanReason.length < 6) abuses.push(`DG_ALLOW_COMMIT_BUDGET 逃生口理由过短（「${cleanReason}」< 6 字），拒绝放行（退 2）`);
    else { budgetBypassed = true; bypasses.push({ rule: 'C1-budget', file: '*', reason: cleanReason }); }
  }

  let codeFilesCount = 0, prodFilesCount = 0, testFilesCount = 0, prodAddedLines = 0, testAddedLines = 0;
  const prodAddedArr = [], deletedProdFiles = deletedFiles.filter((f) => {
    const dp = f.path.replace(/\\/g, '/');
    return CODE_EXT_RE.test(dp) && !TEST_BUDGET_EXEMPT_RE.test(dp);
  });
  const deletedProdLines = deletedProdFiles.reduce((s, f) => s + f.removed.length, 0);
  const prodRemovedArr = deletedProdFiles.flatMap((f) => f.removed);
  const ruleCtx = { files, compiledBanned, budgetBypassed, fails, abuses, bypasses };

  for (const f of files) {
    const p = f.path.replace(/\\/g, '/'), isFixture = FIXTURE_OR_PILOT_RE.test(p);
    hyAuditFilePathHygiene(f, p, isFixture, projectRoot, allowedRootSet, fails);
    if (!CODE_EXT_RE.test(p)) continue;
    codeFilesCount++;
    const isTestFile = TEST_FILE_RE.test(p), isExemptTest = TEST_BUDGET_EXEMPT_RE.test(p);
    if (isExemptTest) {
      testFilesCount++;
      testAddedLines += f.added.length;
    } else {
      prodFilesCount++;
      prodAddedLines += f.added.length;
      prodAddedArr.push(...f.added);
      prodRemovedArr.push(...f.removed);
    }
    if (f.isNew && activeScopes.length > 0 && !isTestFile && !ROOT_CONFIG_FILE_RE.test(p) && !budgetBypassed && !isClaimedByScopes(p, activeScopes)) {
      fails.push(`C5 新增代码文件未被任何活跃契约 scope[] 认领：${p}`);
    }
    const absFile = resolve(projectRoot, p);
    hyAuditFileScaleAndComplexity(f, p, absFile, isFixture, isExemptTest, budgets, budgetBypassed, warnings, fails);
    auditCodeFileRules(f, p, absFile, isFixture, isTestFile, ruleCtx);
  }

  const relocatedCodeLines = computeRelocatedCodeLines(prodRemovedArr, prodAddedArr);
  const netNewCodeLines = Math.max(0, prodAddedLines - relocatedCodeLines);
  const isPureConsolidation = deletedProdFiles.length >= 2 && (prodAddedLines - deletedProdLines) <= budgets.maxCommitCodeLines;
  const stats = {
    codeFiles: codeFilesCount,
    prodFiles: prodFilesCount,
    testFiles: testFilesCount,
    codeAdded: prodAddedLines + testAddedLines,
    prodAdded: prodAddedLines,
    testAdded: testAddedLines,
    relocatedCodeLines,
    netNewCodeLines
  };

  if (!budgetBypassed) {
    hyEvaluateFourDimBudgets(stats, budgets, explicitProdFileCap, isPureConsolidation, warnings, fails);
  }
  if (abuses.length > 0) return { exitCode: 2, fails: [...abuses, ...fails], warnings, bypasses, stats };
  if (fails.length === 0 && bypasses.length > 0 && opts.recordBypasses !== false) {
    const dgDir = join(projectRoot, '.donegate'), now = new Date().toISOString();
    mkdirSync(dgDir, { recursive: true });
    for (const bp of bypasses) appendFileSync(join(dgDir, 'hygiene-bypasses.jsonl'), JSON.stringify({ at: now, ...bp }) + '\n', 'utf8');
  }
  return { exitCode: fails.length > 0 ? 1 : 0, fails, warnings, bypasses, stats };
}

function runExtendedFourDimCases(makeRepo, stage, commit, t) {
  const dSplit = makeRepo('relocated-split', true);
  const origLines = Array.from({ length: 330 }, (_, i) => `  const stepValue${i} = input + ${i * 3 + 100};`).join('\n');
  writeFileSync(join(dSplit, 'src/monolith.mjs'), `export function runPipeline(input) {\n${origLines}\n  return stepValue329;\n}\n`);
  commit(dSplit, 'seed-monolith');
  const partA = Array.from({ length: 170 }, (_, i) => `  const stepValue${i} = input + ${i * 3 + 100};`).join('\n');
  const partB = Array.from({ length: 160 }, (_, i) => `  const stepValue${i + 170} = input + ${(i + 170) * 3 + 100};`).join('\n');
  writeFileSync(join(dSplit, 'src/monolith.mjs'), `import { runFirst } from './stage-first.mjs';\nimport { runSecond } from './stage-second.mjs';\nexport const runPipeline = (input) => runSecond(runFirst(input));\n`);
  writeFileSync(join(dSplit, 'src/stage-first.mjs'), `export function runFirst(input) {\n${partA}\n  return stepValue169;\n}\n`);
  writeFileSync(join(dSplit, 'src/stage-second.mjs'), `export function runSecond(input) {\n${partB}\n  return stepValue329;\n}\n`);
  stage(dSplit);
  const rSplit = auditCommitDiff(dSplit, { budgetBypassReason: '' });
  t('正样本 (维度2 重定位拆分净增豁免)：+339/-333 拆分子模块（净增仅数行）→ 平滑放行退 0',
    rSplit.exitCode === 0 && rSplit.stats.prodAdded > 300 && rSplit.stats.relocatedCodeLines >= 320 && rSplit.stats.netNewCodeLines <= 20, rSplit.fails.join('；'));

  const dTwoTier = makeRepo('two-tier-with-tests');
  writeFileSync(join(dTwoTier, 'src/feature.mjs'), Array.from({ length: 320 }, (_, i) => `export const cfgItem${i} = ${i * 2 + 1};`).join('\n') + '\n');
  writeFileSync(join(dTwoTier, 'tests/feature.test.mjs'), Array.from({ length: 520 }, (_, i) => `expect(cfgItem${i % 320}).toBe(${(i % 320) * 2 + 1});`).join('\n') + '\n');
  stage(dTwoTier);
  const rTwoTier = auditCommitDiff(dTwoTier, { budgetBypassReason: '' });
  t('正样本 (维度1+2 测试代码豁免与 251–450 软预警放行)：320 行生产代码 + 520 行同批单测 → 退 0 且给出软提示',
    rTwoTier.exitCode === 0 && rTwoTier.stats.testAdded >= 520 && rTwoTier.stats.netNewCodeLines === 320 &&
    rTwoTier.warnings.some((w) => w.includes('弹性放行区间')), rTwoTier.fails.join('；'));

  const dCap = makeRepo('raw-cap');
  const capBody = Array.from({ length: 920 }, (_, i) => `  const movedStmt${i} = base + ${i + 10000};`).join('\n');
  writeFileSync(join(dCap, 'src/giant.mjs'), `export function giant(base) {\n${capBody}\n}\n`);
  commit(dCap, 'seed-giant');
  writeFileSync(join(dCap, 'src/giant.mjs'), 'export const giant = () => 0;\n');
  writeFileSync(join(dCap, 'src/relocated.mjs'), `export function relocated(base) {\n${capBody}\n}\n`);
  stage(dCap);
  const rCap = auditCommitDiff(dCap, { budgetBypassReason: '' });
  t('必红样本 10 (维度2 900 原始硬顶守卫)：单笔 +923/-922 巨量重写被拦截 → 必红退 1',
    rCap.exitCode === 1 && rCap.fails.some((f) => f.includes('触发原始硬顶')), rCap.fails.join('；'));

  const dDecl = makeRepo('decl-fn');
  const htmlTpl = Array.from({ length: 190 }, (_, i) => `  <div class="row-${i}"><span>\${title}</span></div>`).join('\n');
  const joinArr = Array.from({ length: 175 }, (_, i) => `    '.item-${i} { display: flex; }',`).join('\n');
  const switchCases = Array.from({ length: 18 }, (_, i) => `    case ${i}: return 'label-${i}';`).join('\n');
  const declSrc = [
    'export function renderWorkbenchView(title, code) {',
    '  const safe = String(title || "");',
    '  switch (code) {',
    switchCases,
    '    default: break;',
    '  }',
    '  const tpl = String.raw`',
    htmlTpl,
    '  `;',
    '  const styles = [',
    joinArr,
    "  ].join('\\n');",
    '  return safe + tpl + styles;',
    '}'
  ].join('\n') + '\n';
  const mDecl = countEffectiveCodeLines(declSrc);
  writeFileSync(join(dDecl, 'src/view.mjs'), declSrc);
  stage(dDecl);
  const rDecl = auditCommitDiff(dDecl, { budgetBypassReason: '', budgets: { maxCommitCodeLines: 600 } });
  t('正样本 (维度4 声明式模板与扁平 switch 低认知复杂度)：18 分支 switch 仅计 +1 认知复杂度且长模板折算零误报',
    mDecl.maxFnLines <= 42 && rDecl.exitCode === 0 && !rDecl.warnings.some((w) => w.includes('认知复杂度')), rDecl.fails.join('；'));

  const dCog = makeRepo('cog-pyramid');
  const pyramidSrc = [
    'export function tangledPyramid(items, flags) {',
    '  let total = 0;',
    '  for (const item of items) {',
    '    if (item.active) {',
    '      for (const sub of item.children) {',
    '        if (sub.valid && !sub.skip || flags.force) {',
    '          while (sub.retries > 0) {',
    '            if (sub.mode === 1) {',
    '              total += sub.weight > 5 ? (flags.boost ? 10 : 5) : 1;',
    '            }',
    '            sub.retries--;',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  return total;',
    '}'
  ].join('\n') + '\n';
  writeFileSync(join(dCog, 'src/pyramid.mjs'), pyramidSrc);
  stage(dCog);
  const rCog = auditCommitDiff(dCog, { budgetBypassReason: '' });
  t('必红样本 11 (维度4 认知复杂度超 25 硬拦截)：仅 18 行但 6 层深嵌套金字塔函数（认知复杂度 >25）被精准拦截 → 必红退 1',
    rCog.exitCode === 1 && rCog.fails.some((f) => f.includes('函数认知复杂度超限') && f.includes('tangledPyramid')), rCog.fails.join('；'));

  const dGolf = makeRepo('code-golf');
  const golfLine = 'export function g(a, b, c) { let x = a + 1; let y = b + 2; let z = c + 3; return x + y + z; }\n';
  const ternLine = 'export const pick = (x) => x === 1 ? "a" : x === 2 ? "b" : x === 3 ? "c" : x === 4 ? "d" : "e";\n';
  writeFileSync(join(dGolf, 'src/golf.mjs'), golfLine + ternLine);
  stage(dGolf);
  const rGolf = auditCommitDiff(dGolf, { budgetBypassReason: '' });
  t('必红样本 12 (维度4 C4g 反压行钻空子拦截)：单行硬塞 4 条语句或单行 4 重三元天书均被当场拦截 → 必红退 1',
    rGolf.exitCode === 1 && rGolf.fails.filter((f) => f.includes('C4g 反压行钻空子拦截')).length === 2, rGolf.fails.join('；'));
}

function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-hygiene-red-'));
  let bad = 0;
  const t = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };
  const stage = (d) => spawnSync('git', ['-C', d, 'add', '.']);
  const commit = (d, m) => {
    stage(d);
    spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m]);
  };
  const makeRepo = (name, withContract = false) => {
    const d = join(tmp, name);
    mkdirSync(join(d, 'src'), { recursive: true });
    mkdirSync(join(d, 'tests'), { recursive: true });
    mkdirSync(join(d, 'decisions'), { recursive: true });
    if (withContract) {
      mkdirSync(join(d, 'contracts/c1'), { recursive: true });
      writeFileSync(join(d, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['src/'], obligations: [] }));
    }
    writeFileSync(join(d, '.gitignore'), '.donegate/\n');
    writeFileSync(join(d, 'src/app.mjs'), 'export const run = (x) => x + 1;\n');
    writeFileSync(join(d, 'tests/app.test.mjs'), 'import { expect, it } from "vitest";\nit("ok", () => {\n  expect(1 + 1).toBe(2);\n  expect(2 + 2).toBe(4);\n});\n');
    writeFileSync(join(d, 'decisions/2026-11-21-01-init.md'), '# init\n');
    spawnSync('git', ['-C', d, 'init', '-q']);
    spawnSync('git', ['-C', d, 'config', 'user.email', 't@local']);
    spawnSync('git', ['-C', d, 'config', 'user.name', 'T']);
    commit(d, 'base');
    return d;
  };

  try {
    const dGood = makeRepo('good', true);
    const richComments = Array.from({ length: 520 }, (_, i) => `// 详尽设计注释第 ${i} 行（不计入有效代码行上限）`).join('\n');
    writeFileSync(join(dGood, 'src/documented.mjs'), richComments + '\nexport const documentedApi = (x) => x * 2;\n');
    commit(dGood, 'seed-doc');
    writeFileSync(join(dGood, 'src/documented.mjs'), richComments + '\nexport const documentedApi = (x) => x * 2;\nexport const nextApi = (x) => x + 3;\n');
    stage(dGood);
    const rGood = auditCommitDiff(dGood, { recordBypasses: false, budgetBypassReason: '' });
    t('好样本：有效代码行智能剥离 520 行注释（总 523 行但仅 2 有效行）→ 退 0 不误伤', rGood.exitCode === 0, rGood.fails.join('；'));

    const dBig = makeRepo('big');
    writeFileSync(join(dBig, 'src/huge.mjs'), Array.from({ length: 465 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    stage(dBig);
    const rBig = auditCommitDiff(dBig, { budgetBypassReason: '' });
    t('必红样本 1 (维度2)：单次提交超 450 行净增生产代码 → 必红退 1', rBig.exitCode === 1 && rBig.fails.some((f) => f.includes('生产代码加行数超预算')));

    const dMany = makeRepo('many');
    for (let i = 0; i < 7; i++) writeFileSync(join(dMany, `src/f${i}.mjs`), `export const a = ${i};\n`);
    stage(dMany);
    const rMany = auditCommitDiff(dMany, { budgetBypassReason: '' });
    t('必红样本 2 (维度3)：单次提交跨 7 个生产源码文件（>6 上限）→ 必红退 1', rMany.exitCode === 1 && rMany.fails.some((f) => f.includes('生产源码文件数超预算')));

    const dSkip = makeRepo('skip');
    writeFileSync(join(dSkip, 'tests/app.test.mjs'), 'it.skip("broken", () => {\n  expect(true).toBe(true);\n});\n');
    stage(dSkip);
    const rSkip = auditCommitDiff(dSkip, { budgetBypassReason: '' });
    t('必红样本 3 (C2)：测试加 it.skip / 恒真断言 / 净删断言 → 必红退 1', rSkip.exitCode === 1 && rSkip.fails.some((f) => f.includes('跳过用例')) && rSkip.fails.some((f) => f.includes('疑似删断言')));

    const dSlop = makeRepo('slop');
    writeFileSync(join(dSlop, 'src/app.mjs'), 'export function f() {\n  // TODO: finish later\n  try { work(); } catch (e) {}\n}\n');
    stage(dSlop);
    const rSlop = auditCommitDiff(dSlop, { budgetBypassReason: '' });
    t('必红样本 4 (C3)：源码留 TODO 占位与空 catch {} 吞错 → 必红退 1', rSlop.exitCode === 1 && rSlop.fails.some((f) => f.includes('未完成占位符')) && rSlop.fails.some((f) => f.includes('空 catch')));

    const dElide = makeRepo('elide');
    writeFileSync(join(dElide, 'src/app.mjs'), 'export function f() {\n  // ... existing code ...\n}\n<<<<<<< HEAD\n');
    stage(dElide);
    const rElide = auditCommitDiff(dElide, { budgetBypassReason: '' });
    t('必红样本 5 (C3b/C3c)：写 // ... existing code ... 省略删码与冲突标记残留 → 必红退 1', rElide.exitCode === 1 && rElide.fails.some((f) => f.includes('懒惰省略')) && rElide.fails.some((f) => f.includes('合并冲突标记')));

    const dMess = makeRepo('mess');
    writeFileSync(join(dMess, 'decisions/2026-11-21-无序号补记.md'), '# bad order\n');
    writeFileSync(join(dMess, 'src/plan_v2.md'), '# draft\n');
    writeFileSync(join(dMess, 'src/logic-a.mjs'), 'export const sliceA = 1;\n');
    stage(dMess);
    const rMess = auditCommitDiff(dMess, { budgetBypassReason: '' });
    t('必红样本 6 (C4)：同日无序号决策记录、_v2 平行草稿与 logic-a.mjs 机械字母切片 → 必红退 1', rMess.exitCode === 1 && rMess.fails.some((f) => f.includes('必须加序号前缀')) && rMess.fails.some((f) => f.includes('版本号后缀')) && rMess.fails.some((f) => f.includes('禁止机械按字母')));

    const dUnclaimed = makeRepo('unclaimed', true);
    mkdirSync(join(dUnclaimed, '_gh-docs'), { recursive: true });
    writeFileSync(join(dUnclaimed, '_gh-docs/draft.md'), '# rogue\n');
    mkdirSync(join(dUnclaimed, 'extra'), { recursive: true });
    writeFileSync(join(dUnclaimed, 'extra/rogue.mjs'), 'export const z = 1;\n');
    spawnSync('git', ['-C', dUnclaimed, 'add', 'extra/rogue.mjs']);
    const rUnclaimed = auditCommitDiff(dUnclaimed, { budgetBypassReason: '' });
    t('必红样本 7 (C5)：根级野目录 _gh-docs 与未被契约 scope 认领的新源码 → 必红退 1', rUnclaimed.exitCode === 1 && rUnclaimed.fails.some((f) => f.includes('野目录')) && rUnclaimed.fails.some((f) => f.includes('未被任何活跃契约')));

    const qRes = quarantineUnclaimedFiles(dUnclaimed);
    mkdirSync(join(dUnclaimed, '.donegate/scratch'), { recursive: true });
    writeFileSync(join(dUnclaimed, '.donegate/scratch/probe.mjs'), 'console.log(1);\n');
    const scRes = cleanScratchDir(dUnclaimed);
    t('正样本 (隔离箱与草稿箱)：--quarantine 安全归入隔离箱附还原账本，scratch 自动清扫', qRes.moved.includes('_gh-docs/draft.md') && existsSync(join(dUnclaimed, '.donegate/quarantine/manifest.jsonl')) && scRes.cleaned === 1);

    const dAbuse = makeRepo('abuse');
    writeFileSync(join(dAbuse, 'src/app.mjs'), 'export function f() {\n  try { work(); } catch (e) {} // dg-allow: ok\n}\n');
    stage(dAbuse);
    t('必红样本 8 (逃生口防滥用)：写 dg-allow: ok 敷衍理由 → 必退 2（事故）', auditCommitDiff(dAbuse, { budgetBypassReason: '' }).exitCode === 2);

    const dAllow = makeRepo('allow');
    writeFileSync(join(dAllow, 'src/app.mjs'), 'export function f() {\n  try { cleanupTmp(); } catch (e) {} // dg-allow: 临时目录清理失败不影响主退出码\n}\n');
    stage(dAllow);
    t('正样本 (合规逃生口)：带具体理由放行退 0 且写入 hygiene-bypasses.jsonl 留痕', auditCommitDiff(dAllow, { budgetBypassReason: '' }).exitCode === 0 && existsSync(join(dAllow, '.donegate/hygiene-bypasses.jsonl')));

    const dHandroll = makeRepo('handroll', true);
    const c1Hr = JSON.parse(readFileSync(join(dHandroll, 'contracts/c1/contract.json'), 'utf8'));
    c1Hr.scope.push('skill/adapters/');
    writeFileSync(join(dHandroll, 'contracts/c1/contract.json'), JSON.stringify(c1Hr));
    writeFileSync(join(dHandroll, 'thresholds.json'), JSON.stringify({ bannedPatterns: [{ id: 'use-shared-http', pattern: String.raw`\bfetch\s*\(`, pathRegex: '^src/', excludePathRegex: '^src/shared/', message: '请调用 src/shared/http.mjs 的 request()，禁止业务层裸调 fetch' }] }));
    mkdirSync(join(dHandroll, 'src/shared'), { recursive: true });
    mkdirSync(join(dHandroll, 'skill/adapters'), { recursive: true });
    writeFileSync(join(dHandroll, 'src/shared/http.mjs'), 'export const request = (u) => fetch(u);\n');
    writeFileSync(join(dHandroll, 'src/page.mjs'), 'export const load = () => fetch("/api/items");\n');
    writeFileSync(join(dHandroll, 'skill/adapters/custom.mjs'), 'import { spawnSync } from "node:child_process";\nexport const a = spawnSync;\n');
    stage(dHandroll);
    const rHandroll = auditCommitDiff(dHandroll, { budgetBypassReason: '' });
    t('必红样本 9 (C6)：适配器直引 child_process 或业务代码绕过公共库命中 bannedPatterns → 必红退 1',
      rHandroll.exitCode === 1 && rHandroll.fails.some((f) => f.includes('具体适配器禁止直引')) && rHandroll.fails.some((f) => f.includes('use-shared-http') && f.includes('src/page.mjs')) && !rHandroll.fails.some((f) => f.includes('(src/shared/http.mjs)')), rHandroll.fails.join('；'));

    runExtendedFourDimCases(makeRepo, stage, commit, t);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(bad === 0 ? '\nRESULT: PASS 四维结构化提交与认知复杂度门禁 14 组红绿样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

function runRepoFourDimAuditCli(root, argv) {
  const budgets = loadHygieneBudgets(root);
  const report = auditRepository4D(root, budgets);
  const hardFiles = report.filter((r) => r.overMaxFns.length > 0 || r.golfingIssues.length > 0);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ budgets: { warnCog: budgets.warnCognitiveComplexity, maxCog: budgets.maxCognitiveComplexity }, hardViolationFiles: hardFiles.length, items: report }, null, 2));
    return hardFiles.length > 0 ? 1 : 0;
  }
  console.log(`=== DoneGate 四维标准全仓扫描（认知复杂度预警 >${budgets.warnCognitiveComplexity} / 硬顶 >${budgets.maxCognitiveComplexity} + 反压行 C4g） ===`);
  for (const r of report) {
    for (const f of r.overMaxFns) console.log(`  ✗ [超硬顶] ${r.file} · ${f.name} (L${f.startLine}-L${f.endLine}) 认知复杂度=${f.cognitiveComplexity} (嵌套=${f.maxNesting})`);
    for (const g of r.golfingIssues) console.log(`  ✗ [C4g压行] ${r.file}:L${g.line} (${g.kind} count=${g.count}) → ${g.preview}`);
    if (argv.includes('--verbose')) {
      for (const f of r.warnFns) console.log(`  ⚠ [软预警] ${r.file} · ${f.name} (L${f.startLine}-L${f.endLine}) 认知复杂度=${f.cognitiveComplexity}`);
    }
  }
  console.log(hardFiles.length === 0
    ? `RESULT: PASS 全仓源码 100% 符合四维认知复杂度（≤${budgets.maxCognitiveComplexity}）与反压行标准（软预警文件 ${report.length} 个）`
    : `RESULT: FAIL 共 ${hardFiles.length} 个源码文件存在超硬顶高复杂度函数或压行违规`);
  return hardFiles.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const rIdx = argv.indexOf('--root'), root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  if (!existsSync(root)) { console.error('目录不存在：' + root); process.exit(3); }
  if (argv.includes('--audit-repo')) process.exit(runRepoFourDimAuditCli(root, argv));
  if (argv.includes('--quarantine')) {
    const q = quarantineUnclaimedFiles(root);
    console.log(q.moved.length === 0 ? '工作区没有需要隔离的未认领野文件。' : `已将 ${q.moved.length} 个未认领文件安全移入 ${q.batchDir}：\n  - ` + q.moved.join('\n  - '));
    process.exit(0);
  }
  if (argv.includes('--clean-scratch')) {
    console.log(`已清扫 .donegate/scratch/ 临时草稿 ${cleanScratchDir(root).cleaned} 项。`);
    process.exit(0);
  }
  const rangeIdx = argv.indexOf('--range'), range = rangeIdx >= 0 && argv[rangeIdx + 1] ? argv[rangeIdx + 1] : null;
  if (argv.includes('--staged') || range) {
    const res = auditCommitDiff(root, { range });
    for (const w of (res.warnings || [])) console.warn('  ⚠ ' + w);
    if (res.exitCode === 0) {
      const bpNote = res.bypasses.length > 0 ? `（含 ${res.bypasses.length} 处已留痕 dg-allow 豁免）` : '';
      const testNote = res.stats.testFiles > 0 ? `，同批豁免测试 ${res.stats.testFiles} 个文件 (+${res.stats.testAdded} 行)` : '';
      console.log(`✓ 四维提交门禁通过：生产文件 ${res.stats.prodFiles} 个，净增生产代码 ${res.stats.netNewCodeLines} 行${testNote}${bpNote}`);
      process.exit(0);
    }
    console.error('✗ 提交已被 DoneGate 四维结构化门禁拦截：');
    for (const f of res.fails) console.error('  - ' + f);
    console.error('修复建议：保持单次生产源码 ≤6 个文件、净新增 ≤450 行（测试代码已豁免，鼓励同批提交测试），单函数认知复杂度 ≤25 且勿单行压码。');
    process.exit(res.exitCode);
  }
  process.exit(runRedSelfTest());
}
