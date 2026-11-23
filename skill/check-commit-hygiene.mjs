#!/usr/bin/env node
// 提交前小模型防翻车硬门禁（融合 red-green-mode 逐 diff 反作弊 + 智能有效代码行与 V8 函数粒度双层预算 + 反机械字母切片 + C5 认领与隔离箱）
//   ① 单轮狂改十几个文件或把单个文件堆出超长有效代码行导致括号错位（C1 智能有效代码行预算：600 软预警 / 850 硬顶；重定位净增 <=300 / 原始硬顶 <=650）；
//   ② 删断言、加 .skip / .only、写 expect(true).toBe(true) 或加 linter 豁免凑绿（C2 测试反作弊）；
//   ③ 留下 TODO / Not implemented 空壳、空 catch {}、冲突标记，或「// ... existing code ...」静默删空真实逻辑（C3 反空壳与防省略截断）；
//   ④ 乱丢 .bak / _v2 平行草稿、机械按字母切碎 foo-a..z.mjs，或同日新增无序号决策记录（C4 命名与语义内聚卫生）；
//   ⑤ 在根目录私建野文件夹，或新建未挂入任何契约 scope[] 的野生源码文件（C5 契约认领与 quarantine 隔离箱）。
// 退出码（§八 四值）：0 通过 / 1 检出超量、作弊、省略删码、冲突或未认领野文件 / 2 逃生口滥用 / 3 环境或 git 读取错误
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';

export const DEFAULT_HYGIENE_BUDGETS = {
  maxCommitCodeLines: 300, maxCommitFiles: 8, warnEffectiveFileLines: 600,
  maxEffectiveFileLines: 850, maxFileLines: 1200, warnFunctionLines: 160
};

const DEFAULT_MAX_RAW_COMMIT_LINES = 650, MIN_DECLARATIVE_BLOCK_LINES = 12, FOLDED_DECLARATIVE_LINES = 6;
const CODE_EXT_RE = /\.(mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TEST_FILE_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|(^|\/)check-[a-z0-9-]+\.mjs$/i;
const FIXTURE_OR_PILOT_RE = /(^|\/)(tests\/|skill\/pilot-|.*-fixtures\.mjs$|skill\/check-commit-hygiene\.mjs$|skill\/check-ai-habits\.mjs$|skill\/check-escapes\.mjs$|skill\/check-module-integrity\.mjs$|skill\/install-hooks\.mjs$)/i;
const ROGUE_ROOT_DIR_RE = /^(?:_[A-Za-z0-9_-]+|tmp|temp|scratch|bak|backup|old|drafts?|playground)$/i;
const ROOT_CONFIG_FILE_RE = /^[^/]+\.(?:config|rc)\.[a-z0-9]+$/i;
const MECHANICAL_SHARD_RE = /(?:[-_](?:part|chunk|slice|shard)\d*|[-_][a-z])\.(?:mjs|cjs|js|ts|tsx|jsx|py)$/i;
const FN_DECL_START_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s*\*)?(?:\s+[A-Za-z0-9_$]+)?\s*\(|^(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z0-9_$]+\s*=>)/;
const PURE_STR_ELEM_RE = /^(?:(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)\s*,?\s*)+(?:\s*\/\/.*)?$/;

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

function foldPureStringJoinBlocks(rawLines, lineEffective, plainCodeLine, foldedLines) {
  for (let i = 0; i < rawLines.length; i++) {
    if (!plainCodeLine[i] || !/(?:=|\breturn|,|\()\s*\[\s*$/.test(rawLines[i].replace(/\/\/.*$/, '').trim())) continue;
    let closeIdx = -1;
    for (let j = i + 1; j < rawLines.length; j++) {
      if (!lineEffective[j]) continue;
      if (!plainCodeLine[j]) break;
      const tj = rawLines[j].trim();
      if (/^\]\s*\.join\s*\(/.test(tj)) { closeIdx = j; break; }
      if (!PURE_STR_ELEM_RE.test(tj)) break;
    }
    if (closeIdx > i) {
      const effIdx = [];
      for (let k = i; k <= closeIdx; k++) if (lineEffective[k] && !foldedLines.has(k)) effIdx.push(k);
      if (effIdx.length >= MIN_DECLARATIVE_BLOCK_LINES) {
        for (let m = FOLDED_DECLARATIVE_LINES; m < effIdx.length; m++) foldedLines.add(effIdx[m]);
      }
      i = closeIdx;
    }
  }
}

/**
 * 统计有效代码行数（剥离空行与注释）与最大顶层函数过程逻辑行数（对跨 >=12 行模板字面量及纯字符串 .join 数组折算为 <=6 行）
 */
export function countEffectiveCodeLines(text) {
  const rawLines = String(text || '').split(/\r?\n/), n = rawLines.length;
  const lineEffective = new Array(n).fill(false), plainCodeLine = new Array(n).fill(false), foldedLines = new Set();
  const fnSpans = [], modeStack = [];
  let effectiveLines = 0, inBlockComment = false, jsBraceDepth = 0, curFn = null;

  for (let li = 0; li < n; li++) {
    const raw = rawLines[li], trimmed = raw.trim(), topAtStart = modeStack[modeStack.length - 1];
    const startsInPlainCode = !inBlockComment && (!topAtStart || topAtStart.kind !== 'tpl');
    plainCodeLine[li] = startsInPlainCode;
    const braceBefore = jsBraceDepth;
    let hasEffective = false, prevNonSpace = '', i = 0;
    if (!trimmed || (startsInPlainCode && trimmed.startsWith('#') && !trimmed.startsWith('#!'))) continue;

    while (i < raw.length) {
      const top = modeStack[modeStack.length - 1];
      if (inBlockComment) {
        const endIdx = raw.indexOf('*/', i);
        if (endIdx < 0) break;
        inBlockComment = false; i = endIdx + 2; continue;
      }
      if (top && top.kind === 'tpl') {
        if (raw[i] === '\\') { hasEffective = true; i += 2; continue; }
        if (raw[i] === '$' && raw[i + 1] === '{') {
          hasEffective = true; modeStack.push({ kind: 'tpl-expr', depth: 1, startLine: li }); i += 2; prevNonSpace = '{'; continue;
        }
        if (raw[i] === '`') {
          hasEffective = true; modeStack.pop();
          if (!top.exprLines.has(li)) top.pureLines.push(li);
          if (top.pureLines.length >= MIN_DECLARATIVE_BLOCK_LINES) {
            for (let k = FOLDED_DECLARATIVE_LINES; k < top.pureLines.length; k++) foldedLines.add(top.pureLines[k]);
          }
          prevNonSpace = '`'; i++; continue;
        }
        if (!/\s/.test(raw[i])) hasEffective = true;
        i++; continue;
      }
      const ch = raw[i], next = raw[i + 1] || '';
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
      if (ch === "'" || ch === '"') {
        hasEffective = true; i++;
        while (i < raw.length && raw[i] !== ch) i += raw[i] === '\\' ? 2 : 1;
        i++; prevNonSpace = ch; continue;
      }
      if (ch === '`') { hasEffective = true; modeStack.push({ kind: 'tpl', pureLines: [], exprLines: new Set() }); i++; continue; }
      if (ch === '/' && (prevNonSpace === '' || '=([,:!&|?;{}~^+-*%<>'.includes(prevNonSpace))) {
        hasEffective = true; i++;
        let inCls = false;
        while (i < raw.length) {
          if (raw[i] === '\\') { i += 2; continue; }
          if (raw[i] === '[') inCls = true; else if (raw[i] === ']') inCls = false;
          else if (raw[i] === '/' && !inCls) { i++; while (i < raw.length && /[a-z]/i.test(raw[i])) i++; break; }
          i++;
        }
        prevNonSpace = '/'; continue;
      }
      hasEffective = true;
      if (ch === '{') { if (top && top.kind === 'tpl-expr') top.depth++; else jsBraceDepth++; }
      else if (ch === '}') {
        if (top && top.kind === 'tpl-expr') {
          if (--top.depth === 0) {
            const popped = modeStack.pop(), parentTpl = modeStack[modeStack.length - 1];
            if (parentTpl && popped.startLine < li) parentTpl.exprLines.add(li);
          }
        } else if (jsBraceDepth > 0) jsBraceDepth--;
      }
      prevNonSpace = ch; i++;
    }

    if (hasEffective) {
      lineEffective[li] = true; effectiveLines++;
      const topAfter = modeStack[modeStack.length - 1];
      if (topAfter && topAfter.kind === 'tpl' && !topAfter.exprLines.has(li)) topAfter.pureLines.push(li);
      else if (topAfter && topAfter.kind === 'tpl-expr' && modeStack[modeStack.length - 2]?.kind === 'tpl') modeStack[modeStack.length - 2].exprLines.add(li);
    }
    if (curFn === null && startsInPlainCode && braceBefore === 0 && hasEffective && FN_DECL_START_RE.test(trimmed)) curFn = { start: li, opened: jsBraceDepth > 0 };
    else if (curFn && !curFn.opened && jsBraceDepth > 0) curFn.opened = true;
    if (curFn && !inBlockComment && modeStack.length === 0 && ((curFn.opened && jsBraceDepth === 0) || (!curFn.opened && prevNonSpace === ';'))) {
      fnSpans.push([curFn.start, li]); curFn = null;
    }
  }

  foldPureStringJoinBlocks(rawLines, lineEffective, plainCodeLine, foldedLines);
  let maxFnLines = 0;
  for (const [fnStart, fnEnd] of fnSpans) {
    let fnLogical = 0;
    for (let k = fnStart; k <= fnEnd; k++) if (lineEffective[k] && !foldedLines.has(k)) fnLogical++;
    if (fnLogical > maxFnLines) maxFnLines = fnLogical;
  }
  return { rawLines: n, effectiveLines, maxFnLines };
}

function normalizeRelocatedLine(raw) {
  const t = String(raw || '').trim();
  if (t.length < 10 || /^[{}()[\];,\s]+$/.test(t) || /^(?:\/\/|\/\*|\*|\*\/|#(?!!))/.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

export function computeRelocatedCodeLines(removedLines, addedLines) {
  const bag = new Map();
  for (const line of removedLines) {
    const key = normalizeRelocatedLine(line);
    if (key) bag.set(key, (bag.get(key) || 0) + 1);
  }
  let relocated = 0;
  for (const line of addedLines) {
    const key = normalizeRelocatedLine(line), left = key ? (bag.get(key) || 0) : 0;
    if (left > 0) { relocated++; bag.set(key, left - 1); }
  }
  return relocated;
}

function loadBudgets(projectRoot) {
  const p = join(projectRoot, 'thresholds.json');
  const base = { ...DEFAULT_HYGIENE_BUDGETS, maxRawCommitCodeLines: DEFAULT_MAX_RAW_COMMIT_LINES, maxFunctionLines: 0, allowedRootDirs: [], bannedPatterns: [] };
  if (!existsSync(p)) return base;
  const r = readJsonStrict(p);
  if (!r.ok || !r.value) return base;
  const v = r.value;
  return {
    maxCommitCodeLines: Number(v.maxCommitCodeLines) || DEFAULT_HYGIENE_BUDGETS.maxCommitCodeLines,
    maxRawCommitCodeLines: Number(v.maxRawCommitCodeLines) || DEFAULT_MAX_RAW_COMMIT_LINES,
    maxCommitFiles: Number(v.maxCommitFiles) || DEFAULT_HYGIENE_BUDGETS.maxCommitFiles,
    warnEffectiveFileLines: Number(v.warnEffectiveFileLines) || DEFAULT_HYGIENE_BUDGETS.warnEffectiveFileLines,
    maxEffectiveFileLines: Number(v.maxEffectiveFileLines) || DEFAULT_HYGIENE_BUDGETS.maxEffectiveFileLines,
    maxFileLines: Number(v.maxFileLines) || DEFAULT_HYGIENE_BUDGETS.maxFileLines,
    warnFunctionLines: Number(v.warnFunctionLines) || DEFAULT_HYGIENE_BUDGETS.warnFunctionLines,
    maxFunctionLines: Number(v.maxFunctionLines) || 0,
    allowedRootDirs: Array.isArray(v.allowedRootDirs) ? v.allowedRootDirs.map(String) : [],
    bannedPatterns: Array.isArray(v.bannedPatterns) ? v.bannedPatterns : []
  };
}

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
  const budgets = loadBudgets(projectRoot), allowedSet = new Set(budgets.allowedRootDirs), scopes = loadActiveContractScopes(projectRoot);
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
    mkdirSync(dirname(dst), { recursive: true }); renameSync(src, dst); moved.push(rel);
    appendFileSync(join(qRoot, 'manifest.jsonl'), JSON.stringify({ at: nowIso, from: rel, quarantinePath: `.donegate/quarantine/${stamp}/${rel}` }) + '\n', 'utf8');
  }
  return { moved, batchDir: `.donegate/quarantine/${stamp}` };
}

function parseUnifiedDiff(diffText) {
  const all = [];
  let cur = null;
  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      const m = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { path: m ? m[2].trim() : null, isNew: false, isDeleted: false, isRename: false, added: [], removed: [] };
      all.push(cur); continue;
    }
    if (!cur || rawLine.startsWith('--- ') || rawLine.startsWith('@@ ')) continue;
    if (rawLine.startsWith('new file mode ')) cur.isNew = true;
    else if (rawLine.startsWith('deleted file mode ') || rawLine.startsWith('+++ /dev/null')) cur.isDeleted = true;
    else if (rawLine.startsWith('rename to ')) { cur.isRename = true; cur.path = rawLine.slice(10).trim(); }
    else if (rawLine.startsWith('+++ b/')) cur.path = rawLine.slice(6).trim();
    else if (rawLine.startsWith('+')) cur.added.push(rawLine.slice(1));
    else if (rawLine.startsWith('-')) cur.removed.push(rawLine.slice(1));
  }
  return { activeFiles: all.filter((f) => f.path && !f.isDeleted), deletedFiles: all.filter((f) => f.path && f.isDeleted) };
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

function auditCodeFileRules(f, p, absFile, isFixture, isTestFile, ctx) {
  if (isTestFile) {
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
  if (!isFixture) {
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
  if (!isTestFile && !isFixture) {
    for (const line of f.added) {
      for (const pat of CODE_SLOP_PATTERNS) {
        if (pat.re.test(line)) applyAllowOrFail(line, p, 'C3', `C3:${pat.name}`, `C3 源码反空壳拦截 [${pat.name}] (${p})：${line.trim().slice(0, 100)}`, ctx);
      }
    }
  }
}

export function auditCommitDiff(projectRoot, opts = {}) {
  const mode = opts.range ? 'range' : 'staged';
  const gitArgs = mode === 'range'
    ? ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--unified=0', opts.range]
    : ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--cached', '--unified=0'];
  const diffR = spawnSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (diffR.status !== 0) return { exitCode: 3, fails: [`无法读取 git diff (${mode})：${diffR.stderr || ''}`], warnings: [], bypasses: [] };

  const budgets = { ...loadBudgets(projectRoot), ...(opts.budgets || {}) };
  const maxRawCommitLines = Number(budgets.maxRawCommitCodeLines) || DEFAULT_MAX_RAW_COMMIT_LINES;
  const allowedRootSet = new Set(budgets.allowedRootDirs || []), activeScopes = loadActiveContractScopes(projectRoot);
  const { activeFiles: files, deletedFiles } = parseUnifiedDiff(diffR.stdout || '');
  const fails = [], warnings = [], abuses = [], bypasses = [], compiledBanned = [];

  for (const rule of (budgets.bannedPatterns || [])) {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) continue;
    try {
      compiledBanned.push({
        id: rule.id || rule.pattern, re: new RegExp(rule.pattern, rule.flags || ''),
        pathRe: rule.pathRegex ? new RegExp(rule.pathRegex) : null, excludeRe: rule.excludePathRegex ? new RegExp(rule.excludePathRegex) : null,
        message: rule.message || '命中项目公共库防手搓禁令'
      });
    } catch (e) { abuses.push(`thresholds.json bannedPatterns 正则配置损坏 [${rule.id || rule.pattern}]（退 2）：${e.message}`); }
  }

  if (mode === 'staged' && opts.checkUntracked !== false) {
    for (const u of listUntrackedFiles(projectRoot)) {
      const seg0 = u.includes('/') ? u.split('/')[0] : null;
      if (seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
        fails.push(`C5 仓库根下存在未跟踪野目录文件：${u}（一次性草稿请放入 .donegate/scratch/，或跑 node skill/check-commit-hygiene.mjs --quarantine 移入隔离箱）`);
      }
    }
  }
  if (files.length === 0 && fails.length === 0) {
    return { exitCode: 0, fails: [], warnings: [], bypasses: [], stats: { codeFiles: 0, codeAdded: 0, relocatedCodeLines: 0, netNewCodeLines: 0 } };
  }

  let codeFilesCount = 0, codeAddedLines = 0, budgetBypassed = false;
  const allCodeAdded = [], deletedCodeFiles = deletedFiles.filter((f) => CODE_EXT_RE.test(f.path.replace(/\\/g, '/')));
  const deletedCodeLines = deletedCodeFiles.reduce((s, f) => s + f.removed.length, 0), allCodeRemoved = deletedCodeFiles.flatMap((f) => f.removed);
  const envBudgetBypass = typeof opts.budgetBypassReason === 'string' ? opts.budgetBypassReason : (process.env.DG_ALLOW_COMMIT_BUDGET || '');
  if (envBudgetBypass !== '') {
    const cleanReason = envBudgetBypass.trim();
    if (cleanReason.length < 6) abuses.push(`DG_ALLOW_COMMIT_BUDGET 逃生口理由过短（「${cleanReason}」< 6 字），拒绝放行（退 2）`);
    else { budgetBypassed = true; bypasses.push({ rule: 'C1-budget', file: '*', reason: cleanReason }); }
  }

  const ruleCtx = { files, compiledBanned, budgetBypassed, fails, abuses, bypasses };
  for (const f of files) {
    const p = f.path.replace(/\\/g, '/'), isFixture = FIXTURE_OR_PILOT_RE.test(p);
    if (!isFixture) {
      const conflictLine = f.added.find((line) => CONFLICT_MARKER_RE.test(line));
      if (conflictLine) fails.push(`C3 发现未解决的 Git 合并冲突标记 (${p})：${conflictLine.trim().slice(0, 60)}`);
    }
    if (/\.(bak|orig|tmp|swp)$/i.test(p) || /(?:_copy|-copy|_backup)\./i.test(p)) fails.push(`C4 禁止提交临时或备份文件：${p}`);
    if (!p.startsWith('归档/') && !p.startsWith('证据/') && /(?:[-_]v\d+|[-_]final|[-_]new)\.(?:md|mjs|js|ts|json)$/i.test(p) && f.isNew) {
      fails.push(`C4 禁止新建带版本号后缀的平行草稿文件（请直接迭代主文件或用 git mv 归档旧版）：${p}`);
    }
    if (f.isNew && !isFixture && MECHANICAL_SHARD_RE.test(p)) {
      fails.push(`C4 禁止机械按字母/序号切碎代码文件 (${p})：为规避行数限制强拆 foo-a..z 会拖慢 ESM 模块解析并破坏可读性，请按职责语义命名模块`);
    }
    if (f.isNew && /^decisions\/[^/]+\.md$/.test(p)) {
      const base = p.split('/')[1], dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
      if (!dateMatch) fails.push(`C4 决策记录命名必须以 YYYY-MM-DD-NN- 开头：${p}`);
      else {
        const [, datePrefix, rest] = dateMatch, decDir = join(projectRoot, 'decisions');
        const sameDayPeers = existsSync(decDir) ? readdirSync(decDir).filter((x) => x.startsWith(datePrefix + '-') && x !== base) : [];
        if (sameDayPeers.length > 0 && !/^\d{2,3}-/.test(rest)) {
          fails.push(`C4 同日（${datePrefix}）已存在决策记录，新记录必须加序号前缀 YYYY-MM-DD-NN-<标题>.md 以保证门 0.2 顺序唯一：${p}`);
        }
      }
    }
    const seg0 = p.includes('/') ? p.split('/')[0] : null;
    if ((f.isNew || f.isRename) && seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
      fails.push(`C5 禁止向仓库根级非标临时目录提交文件：${p}（正式文档请归入 docs/，一次性草稿请放入 .donegate/scratch/）`);
    }
    if (!CODE_EXT_RE.test(p)) continue;

    codeFilesCount++; codeAddedLines += f.added.length;
    allCodeAdded.push(...f.added); allCodeRemoved.push(...f.removed);
    const isTestFile = TEST_FILE_RE.test(p);
    if (f.isNew && activeScopes.length > 0 && !isTestFile && !ROOT_CONFIG_FILE_RE.test(p) && !budgetBypassed && !isClaimedByScopes(p, activeScopes)) {
      fails.push(`C5 新增代码文件未被任何活跃契约 scope[] 认领：${p}（正式模块请先写入 contracts/<id>/contract.json 的 scope；临时脚本请放 .donegate/scratch/ 或跑 --quarantine）`);
    }

    const absFile = resolve(projectRoot, p);
    if (existsSync(absFile) && !budgetBypassed && (f.isNew || f.added.length > f.removed.length)) {
      const m = countEffectiveCodeLines(readFileSync(absFile, 'utf8'));
      if (m.effectiveLines > budgets.maxEffectiveFileLines || m.rawLines > budgets.maxFileLines) {
        fails.push(`C1 单文件规模超限：${p} 当前有效代码 ${m.effectiveLines} 行（总 ${m.rawLines} 行）> 上限 ${budgets.maxEffectiveFileLines} 有效行 / ${budgets.maxFileLines} 总行（请按职责语义拆分子模块，禁止机械按字母切片）`);
      } else if (m.effectiveLines > budgets.warnEffectiveFileLines) {
        warnings.push(`C1 软预警：${p} 有效代码 ${m.effectiveLines} 行（已超 ${budgets.warnEffectiveFileLines} 舒适区，后续新增职责建议按业务域分模块）`);
      }
      if (budgets.maxFunctionLines > 0 && m.maxFnLines > budgets.maxFunctionLines) {
        fails.push(`C1 单函数过程逻辑超限：${p} 存在 ${m.maxFnLines} 行的超长过程函数 > 上限 ${budgets.maxFunctionLines} 行（请提取语义子函数）`);
      } else if (m.maxFnLines > budgets.warnFunctionLines) {
        warnings.push(`V8 内联预警：${p} 存在 ${m.maxFnLines} 行的超长单函数（> ${budgets.warnFunctionLines} 行会阻碍 V8 TurboFan 函数内联优化，建议提取语义子函数）`);
      }
    }
    auditCodeFileRules(f, p, absFile, isFixture, isTestFile, ruleCtx);
  }

  const relocatedCodeLines = computeRelocatedCodeLines(allCodeRemoved, allCodeAdded);
  const netNewCodeLines = Math.max(0, codeAddedLines - relocatedCodeLines);
  const isPureConsolidation = deletedCodeFiles.length >= 2 && (codeAddedLines - deletedCodeLines) <= budgets.maxCommitCodeLines;

  if (!budgetBypassed) {
    if (codeAddedLines > maxRawCommitLines) {
      fails.push(`C1 单次提交代码加行数超预算（触发原始硬顶）：原始新增 ${codeAddedLines} 行代码 > 硬上限 ${maxRawCommitLines} 行（严禁单笔全仓重写刷屏，请分批渐进提交）`);
    } else if (!isPureConsolidation && netNewCodeLines > budgets.maxCommitCodeLines) {
      fails.push(`C1 单次提交代码加行数超预算：净新增 ${netNewCodeLines} 行代码（原始新增 ${codeAddedLines} 行，重定位复用 ${relocatedCodeLines} 行）> 上限 ${budgets.maxCommitCodeLines} 行（请按小步快跑拆分为多次可验证提交）`);
    }
    if (!isPureConsolidation && codeFilesCount > budgets.maxCommitFiles) {
      fails.push(`C1 单次提交涉及源码文件数超预算：本次改动 ${codeFilesCount} 个代码文件 > 上限 ${budgets.maxCommitFiles} 个（禁止顺手跨模块大面积改代码）`);
    }
  }

  const stats = { codeFiles: codeFilesCount, codeAdded: codeAddedLines, relocatedCodeLines, netNewCodeLines };
  if (abuses.length > 0) return { exitCode: 2, fails: [...abuses, ...fails], warnings, bypasses, stats };
  if (fails.length === 0 && bypasses.length > 0 && opts.recordBypasses !== false) {
    const dgDir = join(projectRoot, '.donegate'), now = new Date().toISOString();
    mkdirSync(dgDir, { recursive: true });
    for (const bp of bypasses) appendFileSync(join(dgDir, 'hygiene-bypasses.jsonl'), JSON.stringify({ at: now, ...bp }) + '\n', 'utf8');
  }
  return { exitCode: fails.length > 0 ? 1 : 0, fails, warnings, bypasses, stats };
}

function runExtendedV41Cases(makeRepo, stage, commit, t) {
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
  t('正样本 (C1 重定位拆分净增豁免)：+339/-333 拆分子函数与子模块（净增仅数行）→ 平滑放行退 0',
    rSplit.exitCode === 0 && rSplit.stats.codeAdded > 300 && rSplit.stats.relocatedCodeLines >= 320 && rSplit.stats.netNewCodeLines <= 20, rSplit.fails.join('；'));

  const dBloat = makeRepo('net-bloat');
  writeFileSync(join(dBloat, 'src/seed.mjs'), Array.from({ length: 10 }, (_, i) => `export const oldItem${i} = ${i + 1000};`).join('\n') + '\n');
  commit(dBloat, 'seed-10');
  writeFileSync(join(dBloat, 'src/seed.mjs'), Array.from({ length: 320 }, (_, i) => `export const brandNewFeatureLine${i} = ${i * 7 + 99};`).join('\n') + '\n');
  stage(dBloat);
  const rBloat = auditCommitDiff(dBloat, { budgetBypassReason: '' });

  const dCap = makeRepo('raw-cap');
  const capBody = Array.from({ length: 660 }, (_, i) => `  const movedStmt${i} = base + ${i + 10000};`).join('\n');
  writeFileSync(join(dCap, 'src/giant.mjs'), `export function giant(base) {\n${capBody}\n}\n`);
  commit(dCap, 'seed-giant');
  writeFileSync(join(dCap, 'src/giant.mjs'), 'export const giant = () => 0;\n');
  writeFileSync(join(dCap, 'src/relocated.mjs'), `export function relocated(base) {\n${capBody}\n}\n`);
  stage(dCap);
  const rCap = auditCommitDiff(dCap, { budgetBypassReason: '' });
  t('必红样本 10 (C1 净增与 650 硬顶双守卫)：+320/-10 新代码堆砌及 +663/-662 超 650 原始硬顶均被拦截 → 必红退 1',
    rBloat.exitCode === 1 && rBloat.fails.some((f) => f.includes('加行数超预算')) &&
    rCap.exitCode === 1 && rCap.fails.some((f) => f.includes('触发原始硬顶')), [...rBloat.fails, ...rCap.fails].join('；'));

  const dDecl = makeRepo('decl-fn');
  const htmlTpl = Array.from({ length: 190 }, (_, i) => `  <div class="row-${i}"><span>\${title}</span></div>`).join('\n');
  const joinArr = Array.from({ length: 175 }, (_, i) => `    '.item-${i} { display: flex; }',`).join('\n');
  const declSrc = ['export function renderWorkbenchView(title) {', '  const safe = String(title || "");', '  const tpl = String.raw`', htmlTpl, '  `;', '  const styles = [', joinArr, "  ].join('\\n');", '  return safe + tpl + styles;', '}'].join('\n') + '\n';
  const mDecl = countEffectiveCodeLines(declSrc);
  writeFileSync(join(dDecl, 'src/view.mjs'), declSrc); stage(dDecl);
  const rDecl = auditCommitDiff(dDecl, { budgetBypassReason: '', budgets: { maxCommitCodeLines: 500 } });
  t('正样本 (C1c 声明式多行模板折算)：含 190 行 String.raw 模板与 175 行 .join 数组函数折算 <=20 逻辑行零误报',
    mDecl.maxFnLines <= 20 && rDecl.exitCode === 0 && !rDecl.warnings.some((w) => w.includes('V8 内联预警')), `maxFnLines=${mDecl.maxFnLines}`);

  const dProc = makeRepo('proc-fn');
  const procStmts = Array.from({ length: 175 }, (_, i) => `  if (acc > ${i}) { acc += (${i} % 3) + 1; }`).join('\n');
  const procSrc = `export function heavyProceduralLoop(seed) {\n  let acc = seed;\n${procStmts}\n  return acc;\n}\n`;
  const mProc = countEffectiveCodeLines(procSrc);
  writeFileSync(join(dProc, 'src/proc.mjs'), procSrc); stage(dProc);
  const rProcWarn = auditCommitDiff(dProc, { budgetBypassReason: '' });
  const rProcBlock = auditCommitDiff(dProc, { budgetBypassReason: '', budgets: { maxFunctionLines: 160 } });
  t('必红样本 11 (C1c 过程式长函数预警与拦截)：>160 行真实语句分支长函数触发 V8 预警并在硬顶下退 1 → 必红',
    mProc.maxFnLines > 160 && rProcWarn.warnings.some((w) => w.includes('V8 内联预警')) &&
    rProcBlock.exitCode === 1 && rProcBlock.fails.some((f) => f.includes('单函数过程逻辑超限')));
}

function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-hygiene-red-'));
  let bad = 0;
  const t = (label, cond, detail = '') => { console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : '')); if (!cond) bad++; };
  const stage = (d) => spawnSync('git', ['-C', d, 'add', '.']);
  const commit = (d, m) => { stage(d); spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m]); };
  const makeRepo = (name, withContract = false) => {
    const d = join(tmp, name);
    mkdirSync(join(d, 'src'), { recursive: true }); mkdirSync(join(d, 'tests'), { recursive: true }); mkdirSync(join(d, 'decisions'), { recursive: true });
    if (withContract) { mkdirSync(join(d, 'contracts/c1'), { recursive: true }); writeFileSync(join(d, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['src/'], obligations: [] })); }
    writeFileSync(join(d, '.gitignore'), '.donegate/\n'); writeFileSync(join(d, 'src/app.mjs'), 'export const run = (x) => x + 1;\n');
    writeFileSync(join(d, 'tests/app.test.mjs'), 'import { expect, it } from "vitest";\nit("ok", () => {\n  expect(1 + 1).toBe(2);\n  expect(2 + 2).toBe(4);\n});\n');
    writeFileSync(join(d, 'decisions/2026-11-21-01-init.md'), '# init\n');
    spawnSync('git', ['-C', d, 'init', '-q']); spawnSync('git', ['-C', d, 'config', 'user.email', 't@local']); spawnSync('git', ['-C', d, 'config', 'user.name', 'T']);
    commit(d, 'base'); return d;
  };

  try {
    const dGood = makeRepo('good', true);
    const richComments = Array.from({ length: 520 }, (_, i) => `// 详尽设计注释第 ${i} 行（不计入有效代码行上限）`).join('\n');
    writeFileSync(join(dGood, 'src/documented.mjs'), richComments + '\nexport const documentedApi = (x) => x * 2;\n'); commit(dGood, 'seed-doc');
    writeFileSync(join(dGood, 'src/documented.mjs'), richComments + '\nexport const documentedApi = (x) => x * 2;\nexport const nextApi = (x) => x + 3;\n'); stage(dGood);
    const rGood = auditCommitDiff(dGood, { recordBypasses: false, budgetBypassReason: '' });
    t('好样本：有效代码行智能剥离 520 行注释（总 523 行但仅 2 有效行）→ 退 0 不误伤', rGood.exitCode === 0, rGood.fails.join('；'));

    const dBig = makeRepo('big');
    writeFileSync(join(dBig, 'src/huge.mjs'), Array.from({ length: 320 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n'); stage(dBig);
    const rBig = auditCommitDiff(dBig, { budgetBypassReason: '' });
    t('必红样本 1 (C1)：单次提交超 300 行代码 → 必红退 1', rBig.exitCode === 1 && rBig.fails.some((f) => f.includes('加行数超预算')));

    const dMany = makeRepo('many');
    for (let i = 0; i < 9; i++) writeFileSync(join(dMany, `src/f${i}.mjs`), `export const a = ${i};\n`);
    stage(dMany);
    const rMany = auditCommitDiff(dMany, { budgetBypassReason: '' });
    t('必红样本 2 (C1)：单次提交跨 9 个代码文件 → 必红退 1', rMany.exitCode === 1 && rMany.fails.some((f) => f.includes('涉及源码文件数超预算')));

    const dSkip = makeRepo('skip');
    writeFileSync(join(dSkip, 'tests/app.test.mjs'), 'it.skip("broken", () => { expect(true).toBe(true); });\n'); stage(dSkip);
    const rSkip = auditCommitDiff(dSkip, { budgetBypassReason: '' });
    t('必红样本 3 (C2)：测试加 it.skip / 恒真断言 / 净删断言 → 必红退 1', rSkip.exitCode === 1 && rSkip.fails.some((f) => f.includes('跳过用例')) && rSkip.fails.some((f) => f.includes('疑似删断言')));

    const dSlop = makeRepo('slop');
    writeFileSync(join(dSlop, 'src/app.mjs'), 'export function f() {\n  // TODO: finish later\n  try { work(); } catch (e) {}\n}\n'); stage(dSlop);
    const rSlop = auditCommitDiff(dSlop, { budgetBypassReason: '' });
    t('必红样本 4 (C3)：源码留 TODO 占位与空 catch {} 吞错 → 必红退 1', rSlop.exitCode === 1 && rSlop.fails.some((f) => f.includes('未完成占位符')) && rSlop.fails.some((f) => f.includes('空 catch')));

    const dElide = makeRepo('elide');
    writeFileSync(join(dElide, 'src/app.mjs'), 'export function f() {\n  // ... existing code ...\n}\n<<<<<<< HEAD\n'); stage(dElide);
    const rElide = auditCommitDiff(dElide, { budgetBypassReason: '' });
    t('必红样本 5 (C3b/C3c)：小模型写 // ... existing code ... 省略删码与冲突标记残留 → 必红退 1', rElide.exitCode === 1 && rElide.fails.some((f) => f.includes('懒惰省略')) && rElide.fails.some((f) => f.includes('合并冲突标记')));

    const dMess = makeRepo('mess');
    writeFileSync(join(dMess, 'decisions/2026-11-21-无序号补记.md'), '# bad order\n'); writeFileSync(join(dMess, 'src/plan_v2.md'), '# draft\n'); writeFileSync(join(dMess, 'src/logic-a.mjs'), 'export const sliceA = 1;\n'); stage(dMess);
    const rMess = auditCommitDiff(dMess, { budgetBypassReason: '' });
    t('必红样本 6 (C4)：同日无序号决策记录、_v2 平行草稿与 logic-a.mjs 机械字母切片 → 必红退 1', rMess.exitCode === 1 && rMess.fails.some((f) => f.includes('必须加序号前缀')) && rMess.fails.some((f) => f.includes('版本号后缀')) && rMess.fails.some((f) => f.includes('禁止机械按字母')));

    const dUnclaimed = makeRepo('unclaimed', true);
    mkdirSync(join(dUnclaimed, '_gh-docs'), { recursive: true }); writeFileSync(join(dUnclaimed, '_gh-docs/draft.md'), '# rogue\n');
    mkdirSync(join(dUnclaimed, 'extra'), { recursive: true }); writeFileSync(join(dUnclaimed, 'extra/rogue.mjs'), 'export const z = 1;\n');
    spawnSync('git', ['-C', dUnclaimed, 'add', 'extra/rogue.mjs']);
    const rUnclaimed = auditCommitDiff(dUnclaimed, { budgetBypassReason: '' });
    t('必红样本 7 (C5)：根级野目录 _gh-docs 与未被契约 scope 认领的新源码 → 必红退 1', rUnclaimed.exitCode === 1 && rUnclaimed.fails.some((f) => f.includes('野目录')) && rUnclaimed.fails.some((f) => f.includes('未被任何活跃契约')));

    const qRes = quarantineUnclaimedFiles(dUnclaimed);
    mkdirSync(join(dUnclaimed, '.donegate/scratch'), { recursive: true }); writeFileSync(join(dUnclaimed, '.donegate/scratch/probe.mjs'), 'console.log(1);\n');
    const scRes = cleanScratchDir(dUnclaimed);
    t('正样本 (隔离箱与草稿箱)：--quarantine 安全归入隔离箱附还原账本，scratch 自动清扫', qRes.moved.includes('_gh-docs/draft.md') && existsSync(join(dUnclaimed, '.donegate/quarantine/manifest.jsonl')) && scRes.cleaned === 1);

    const dAbuse = makeRepo('abuse');
    writeFileSync(join(dAbuse, 'src/app.mjs'), 'export function f() {\n  try { work(); } catch (e) {} // dg-allow: ok\n}\n'); stage(dAbuse);
    t('必红样本 8 (逃生口防滥用)：写 dg-allow: ok 敷衍理由 → 必退 2（事故）', auditCommitDiff(dAbuse, { budgetBypassReason: '' }).exitCode === 2);

    const dAllow = makeRepo('allow');
    writeFileSync(join(dAllow, 'src/app.mjs'), 'export function f() {\n  try { cleanupTmp(); } catch (e) {} // dg-allow: 临时目录清理失败不影响主退出码\n}\n'); stage(dAllow);
    t('正样本 (合规逃生口)：带具体理由放行退 0 且写入 hygiene-bypasses.jsonl 留痕', auditCommitDiff(dAllow, { budgetBypassReason: '' }).exitCode === 0 && existsSync(join(dAllow, '.donegate/hygiene-bypasses.jsonl')));

    const dHandroll = makeRepo('handroll', true);
    const c1Hr = JSON.parse(readFileSync(join(dHandroll, 'contracts/c1/contract.json'), 'utf8')); c1Hr.scope.push('skill/adapters/'); writeFileSync(join(dHandroll, 'contracts/c1/contract.json'), JSON.stringify(c1Hr));
    writeFileSync(join(dHandroll, 'thresholds.json'), JSON.stringify({ bannedPatterns: [{ id: 'use-shared-http', pattern: String.raw`\bfetch\s*\(`, pathRegex: '^src/', excludePathRegex: '^src/shared/', message: '请调用 src/shared/http.mjs 的 request()，禁止业务层裸调 fetch' }] }));
    mkdirSync(join(dHandroll, 'src/shared'), { recursive: true }); mkdirSync(join(dHandroll, 'skill/adapters'), { recursive: true });
    writeFileSync(join(dHandroll, 'src/shared/http.mjs'), 'export const request = (u) => fetch(u);\n'); writeFileSync(join(dHandroll, 'src/page.mjs'), 'export const load = () => fetch("/api/items");\n');
    writeFileSync(join(dHandroll, 'skill/adapters/custom.mjs'), 'import { spawnSync } from "node:child_process";\nexport const a = spawnSync;\n'); stage(dHandroll);
    const rHandroll = auditCommitDiff(dHandroll, { budgetBypassReason: '' });
    t('必红样本 9 (C6)：适配器直引 child_process 或业务代码绕过项目公共库命中 bannedPatterns（且白名单目录放行）→ 必红退 1',
      rHandroll.exitCode === 1 && rHandroll.fails.some((f) => f.includes('具体适配器禁止直引')) && rHandroll.fails.some((f) => f.includes('use-shared-http') && f.includes('src/page.mjs')) && !rHandroll.fails.some((f) => f.includes('(src/shared/http.mjs)')), rHandroll.fails.join('；'));

    runExtendedV41Cases(makeRepo, stage, commit, t);
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  console.log(bad === 0 ? '\nRESULT: PASS 提交前小模型防翻车门禁与 11 组红绿样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const rIdx = argv.indexOf('--root'), root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  if (!existsSync(root)) { console.error('目录不存在：' + root); process.exit(3); }
  if (argv.includes('--quarantine')) {
    const q = quarantineUnclaimedFiles(root);
    console.log(q.moved.length === 0 ? '工作区没有需要隔离的未认领野文件。' : `已将 ${q.moved.length} 个未认领文件安全移入 ${q.batchDir}（原路径记录见 .donegate/quarantine/manifest.jsonl）：\n  - ` + q.moved.join('\n  - '));
    process.exit(0);
  }
  if (argv.includes('--clean-scratch')) { console.log(`已清扫 .donegate/scratch/ 临时草稿 ${cleanScratchDir(root).cleaned} 项。`); process.exit(0); }

  const rangeIdx = argv.indexOf('--range'), range = rangeIdx >= 0 && argv[rangeIdx + 1] ? argv[rangeIdx + 1] : null;
  if (argv.includes('--staged') || range) {
    const res = auditCommitDiff(root, { range });
    for (const w of (res.warnings || [])) console.warn('  ⚠ ' + w);
    if (res.exitCode === 0) {
      const bpNote = res.bypasses.length > 0 ? `（含 ${res.bypasses.length} 处已留痕 dg-allow 豁免）` : '';
      const relocNote = res.stats.relocatedCodeLines > 0 ? `（原始 +${res.stats.codeAdded} / 重定位复用 ${res.stats.relocatedCodeLines}）` : '';
      console.log(`✓ 提交前门禁通过：改动代码文件 ${res.stats.codeFiles} 个，净增代码 ${res.stats.netNewCodeLines ?? res.stats.codeAdded} 行${relocNote}${bpNote}`);
      process.exit(0);
    }
    console.error('✗ 提交已被 DoneGate 提交前门禁拦截（防止超量改动、懒惰省略删码、改测试凑绿或乱丢未认领文件）：');
    for (const f of res.fails) console.error('  - ' + f);
    console.error('修复建议：拆小单次提交（≤300 行净新增代码 / ≤8 个文件），按语义职责建模块（勿按字母切碎），或用 --quarantine 隔离野文件后再 git commit。');
    process.exit(res.exitCode);
  }
  process.exit(runRedSelfTest());
}
