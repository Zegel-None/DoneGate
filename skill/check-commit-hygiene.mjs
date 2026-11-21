#!/usr/bin/env node
// 提交前小模型防翻车硬门禁（融合 red-green-mode 逐 diff 反作弊 + vibeguard v2 行数上限 + AI-Slop/懒惰省略拦截 + C5 新文件认领与隔离箱）
//
// 为什么专为小模型设这一层：
//   小模型一旦单轮改动过大或注意力衰减，高频出现五类翻车：
//   ① 单轮狂改十几个文件或把单个文件堆过 700 行导致括号错位（C1 量级预算）；
//   ② 删断言、加 .skip / .only、写 expect(true).toBe(true) 或加 linter 豁免凑绿（C2 测试反作弊）；
//   ③ 留下 TODO / Not implemented 空壳、空 catch {}、冲突标记，或最致命的「// ... existing code ...」静默删空真实逻辑（C3 反空壳与防省略截断）；
//   ④ 乱丢 .bak / _v2 平行草稿，或同日新增无序号决策记录搞乱门 0.2 字典序（C4 命名卫生）；
//   ⑤ 在根目录私建 _gh-docs/ 等野文件夹，或新建未挂入任何契约 scope[] 的野生源码文件遗留成垃圾（C5 契约认领与 quarantine 隔离箱）。
//
// 用法：
//   node skill/check-commit-hygiene.mjs --staged [--root <dir>]         # pre-commit 默认：检查暂存区与根级野目录
//   node skill/check-commit-hygiene.mjs --range <A..B> [--root <dir>]   # 检查指定提交区间
//   node skill/check-commit-hygiene.mjs --quarantine [--root <dir>]     # 将未跟踪野文件安全移入 .donegate/quarantine/<ts>/（附还原清单，绝不直删）
//   node skill/check-commit-hygiene.mjs --clean-scratch [--root <dir>]  # 清空法定一次性草稿箱 .donegate/scratch/
//   node skill/check-commit-hygiene.mjs --red-self-test                 # 构造 11 组小模型翻车/合规样本验证有牙
//
// 退出码（§八 四值）：0 通过 / 1 检出超量、作弊、省略删码、冲突或未认领野文件 / 2 逃生口滥用 / 3 环境或 git 读取错误
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';

export const DEFAULT_HYGIENE_BUDGETS = {
  maxCommitCodeLines: 300,
  maxCommitFiles: 8,
  maxFileLines: 700
};

const CODE_EXT_RE = /\.(mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TEST_FILE_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|(^|\/)check-[a-z0-9-]+\.mjs$/i;
const FIXTURE_OR_PILOT_RE = /(^|\/)(tests\/|skill\/pilot-|.*-fixtures\.mjs$|skill\/check-commit-hygiene\.mjs$|skill\/check-ai-habits\.mjs$|skill\/check-escapes\.mjs$|skill\/check-module-integrity\.mjs$|skill\/install-hooks\.mjs$)/i;
const ROGUE_ROOT_DIR_RE = /^(?:_[A-Za-z0-9_-]+|tmp|temp|scratch|bak|backup|old|drafts?|playground)$/i;
const ROOT_CONFIG_FILE_RE = /^[^/]+\.(?:config|rc)\.[a-z0-9]+$/i;

// C2：测试与门禁 diff 新增行禁止出现的作弊模式
const TEST_CHEAT_PATTERNS = [
  { name: '跳过用例 (.skip / xit / xdescribe)', re: /\b(?:it|test|describe)\.skip\s*\(|\b(?:xit|xtest|xdescribe)\s*\(/ },
  { name: '独占用例 (.only 漏删导致其余测试全被跳过)', re: /\b(?:it|test|describe)\.only\s*\(/ },
  { name: '空壳待办用例 (test.todo / it.todo)', re: /\b(?:it|test)\.todo\s*\(/ },
  { name: '恒真假断言 (expect(true).toBe(true) / assert(true))', re: /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|expect\(\s*1\s*\)\.toBe\(\s*1\s*\)|\bassert(?:\.ok)?\(\s*true\s*\)/ },
  { name: '静态检查强行豁免 (eslint-disable / biome-ignore / @ts-ignore / # type: ignore)', re: /eslint-disable|biome-ignore|@ts-ignore|@ts-nocheck|#\s*type:\s*ignore|#\s*noqa\b/ }
];

// C3：业务/核心代码 diff 新增行禁止出现的空壳 Slop 与懒惰省略截断模式
const CODE_SLOP_PATTERNS = [
  { name: '未完成占位符 (TODO / FIXME / XXX / HACK)', re: /(?:\/\/|#|\/\*)\s*(?:TODO|FIXME|XXX|HACK)\b/ },
  { name: '空壳未实现异常 (Not implemented)', re: /throw\s+new\s+Error\(\s*['"`](?:not implemented|todo|unimplemented)/i },
  { name: '残留调试断点 (debugger)', re: /^\s*debugger\s*;?\s*$/ },
  { name: '空 catch 静默吞异常', re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/ },
  {
    name: 'AI 懒惰省略注释疑似静默删代码 (existing code / rest unchanged / 其余代码不变)',
    re: /(?:\/\/|#|\/\*)\s*(?:\.\.\.|…)?\s*(?:(?:existing|unchanged|remaining|previous|rest\s+of(?:\s+the)?)\s+(?:code|implementation|logic|methods?|functions?|file|body|lines?)|omitted\s+for\s+brevity|(?:其余|剩余|原有|上述|中间)(?:代码|逻辑|实现|内容|部分)\s*(?:保持不变|不变|省略|同上|略))/i
  }
];

const CONFLICT_MARKER_RE = /^(?:<{7}\s|={7}\s*$|>{7}\s)/;
const ASSERT_TOKEN_RE = /\b(?:expect\s*\(|assert(?:\.[a-zA-Z]+)?\s*\(|c\.check\s*\()/;
const ALLOW_MARKER_RE = /(?:\/\/|#)\s*dg-allow\s*:(.*)$/;

function loadBudgets(projectRoot) {
  const p = join(projectRoot, 'thresholds.json');
  if (!existsSync(p)) return { ...DEFAULT_HYGIENE_BUDGETS, allowedRootDirs: [], bannedPatterns: [] };
  const r = readJsonStrict(p);
  if (!r.ok || !r.value) return { ...DEFAULT_HYGIENE_BUDGETS, allowedRootDirs: [], bannedPatterns: [] };
  return {
    maxCommitCodeLines: Number(r.value.maxCommitCodeLines) || DEFAULT_HYGIENE_BUDGETS.maxCommitCodeLines,
    maxCommitFiles: Number(r.value.maxCommitFiles) || DEFAULT_HYGIENE_BUDGETS.maxCommitFiles,
    maxFileLines: Number(r.value.maxFileLines) || DEFAULT_HYGIENE_BUDGETS.maxFileLines,
    allowedRootDirs: Array.isArray(r.value.allowedRootDirs) ? r.value.allowedRootDirs.map(String) : [],
    bannedPatterns: Array.isArray(r.value.bannedPatterns) ? r.value.bannedPatterns : []
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
      if (typeof s === 'string' && s.trim()) {
        scopes.push(s.trim().replace(/\\/g, '/').replace(/^\.\//, ''));
      }
    }
  }
  return scopes;
}

function isClaimedByScopes(relPath, scopes) {
  return scopes.some((s) => (s.endsWith('/') ? relPath.startsWith(s) : (relPath === s || relPath.startsWith(s + '/'))));
}

function listUntrackedFiles(projectRoot) {
  const r = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return (r.stdout || '').split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean);
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
  const budgets = loadBudgets(projectRoot);
  const allowedSet = new Set(budgets.allowedRootDirs);
  const scopes = loadActiveContractScopes(projectRoot);
  const untracked = listUntrackedFiles(projectRoot);
  const targets = untracked.filter((p) => {
    const seg0 = p.includes('/') ? p.split('/')[0] : null;
    if (seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedSet.has(seg0)) return true;
    if (/.(bak|orig|tmp|swp)$/i.test(p) || /(?:_copy|-copy|_backup)./i.test(p)) return true;
    if (scopes.length > 0 && CODE_EXT_RE.test(p) && !TEST_FILE_RE.test(p) && !ROOT_CONFIG_FILE_RE.test(p) && !isClaimedByScopes(p, scopes)) {
      return true;
    }
    return false;
  });

  if (targets.length === 0) return { moved: [], batchDir: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const qRoot = join(projectRoot, '.donegate', 'quarantine');
  const batchDir = join(qRoot, stamp);
  mkdirSync(batchDir, { recursive: true });
  const moved = [];
  const nowIso = new Date().toISOString();
  for (const rel of targets) {
    const src = join(projectRoot, rel);
    if (!existsSync(src)) continue;
    const dst = join(batchDir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved.push(rel);
    appendFileSync(join(qRoot, 'manifest.jsonl'), JSON.stringify({
      at: nowIso,
      from: rel,
      quarantinePath: `.donegate/quarantine/${stamp}/${rel}`
    }) + '\n', 'utf8');
  }
  return { moved, batchDir: `.donegate/quarantine/${stamp}` };
}

function parseUnifiedDiff(diffText) {
  const files = [];
  let cur = null;
  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      cur = { path: null, isNew: false, isDeleted: false, isRename: false, added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (rawLine.startsWith('new file mode ')) { cur.isNew = true; continue; }
    if (rawLine.startsWith('deleted file mode ')) { cur.isDeleted = true; continue; }
    if (rawLine.startsWith('rename to ')) { cur.isRename = true; cur.path = rawLine.slice(10).trim(); continue; }
    if (rawLine.startsWith('+++ b/')) { cur.path = rawLine.slice(6).trim(); continue; }
    if (rawLine.startsWith('+++ /dev/null')) { cur.isDeleted = true; continue; }
    if (rawLine.startsWith('--- ') || rawLine.startsWith('@@ ')) continue;
    if (rawLine.startsWith('+')) cur.added.push(rawLine.slice(1));
    else if (rawLine.startsWith('-')) cur.removed.push(rawLine.slice(1));
  }
  return files.filter((f) => f.path && !f.isDeleted);
}

function checkAllowComment(line) {
  const m = line.match(ALLOW_MARKER_RE);
  if (!m) return { allowed: false, abuse: false, reason: '' };
  const reason = m[1].trim();
  if (reason.length < 6 || /^(ok|pass|temp|skip|ignore|todo|允许|跳过|豁免)$/i.test(reason)) {
    return { allowed: false, abuse: true, reason };
  }
  return { allowed: true, abuse: false, reason };
}

export function auditCommitDiff(projectRoot, opts = {}) {
  const mode = opts.range ? 'range' : 'staged';
  const gitArgs = mode === 'range'
    ? ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--unified=0', opts.range]
    : ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--cached', '--unified=0'];
  const diffR = spawnSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (diffR.status !== 0) {
    return { exitCode: 3, fails: [`无法读取 git diff (${mode})：${diffR.stderr || ''}`], bypasses: [] };
  }

  const budgets = { ...loadBudgets(projectRoot), ...(opts.budgets || {}) };
  const allowedRootSet = new Set(budgets.allowedRootDirs || []);
  const activeScopes = loadActiveContractScopes(projectRoot);
  const files = parseUnifiedDiff(diffR.stdout || '');

  const fails = [];
  const abuses = [];
  const bypasses = [];

  const compiledBanned = [];
  for (const rule of (budgets.bannedPatterns || [])) {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern) continue;
    try {
      compiledBanned.push({
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


  // C5a（工作区未跟踪根级野目录巡检，仅在 staged 模式且未显式关闭时执行）
  if (mode === 'staged' && opts.checkUntracked !== false) {
    for (const u of listUntrackedFiles(projectRoot)) {
      const seg0 = u.includes('/') ? u.split('/')[0] : null;
      if (seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
        fails.push(`C5 仓库根下存在未跟踪野目录文件：${u}（一次性草稿请放入 .donegate/scratch/，或跑 node skill/check-commit-hygiene.mjs --quarantine 移入隔离箱）`);
      }
    }
  }

  if (files.length === 0 && fails.length === 0) {
    return { exitCode: 0, fails: [], bypasses: [], stats: { codeFiles: 0, codeAdded: 0 } };
  }

  let codeFilesCount = 0;
  let codeAddedLines = 0;

  const envBudgetBypass = typeof opts.budgetBypassReason === 'string'
    ? opts.budgetBypassReason
    : (process.env.DG_ALLOW_COMMIT_BUDGET || '');
  let budgetBypassed = false;
  if (envBudgetBypass !== '') {
    const cleanReason = envBudgetBypass.trim();
    if (cleanReason.length < 6) {
      abuses.push(`DG_ALLOW_COMMIT_BUDGET 逃生口理由过短（「${cleanReason}」< 6 字），拒绝放行（退 2）`);
    } else {
      budgetBypassed = true;
      bypasses.push({ rule: 'C1-budget', file: '*', reason: cleanReason });
    }
  }

  for (const f of files) {
    const p = f.path.replace(/\\/g, '/');
    const isFixture = FIXTURE_OR_PILOT_RE.test(p);

    // C3c：全类型暂存文件合并冲突残留拦截
    if (!isFixture) {
      for (const line of f.added) {
        if (CONFLICT_MARKER_RE.test(line)) {
          fails.push(`C3 发现未解决的 Git 合并冲突标记 (${p})：${line.trim().slice(0, 60)}`);
          break;
        }
      }
    }

    // C4a：拦截临时备份与多版本后缀平行草稿
    if (/\.(bak|orig|tmp|swp)$/i.test(p) || /(?:_copy|-copy|_backup)\./i.test(p)) {
      fails.push(`C4 禁止提交临时或备份文件：${p}`);
    }
    if (!p.startsWith('归档/') && !p.startsWith('证据/') && /(?:[-_]v\d+|[-_]final|[-_]new)\.(?:md|mjs|js|ts|json)$/i.test(p) && f.isNew) {
      fails.push(`C4 禁止新建带版本号后缀的平行草稿文件（请直接迭代主文件或用 git mv 归档旧版）：${p}`);
    }

    // C4b：同日决策记录序号检查
    if (f.isNew && /^decisions\/[^/]+\.md$/.test(p)) {
      const base = p.split('/')[1];
      const dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
      if (!dateMatch) {
        fails.push(`C4 决策记录命名必须以 YYYY-MM-DD-NN- 开头：${p}`);
      } else {
        const [, datePrefix, rest] = dateMatch;
        const hasSeq = /^\d{2,3}-/.test(rest);
        const decDir = join(projectRoot, 'decisions');
        const sameDayPeers = existsSync(decDir)
          ? readdirSync(decDir).filter((x) => x.startsWith(datePrefix + '-') && x !== base)
          : [];
        if (sameDayPeers.length > 0 && !hasSeq) {
          fails.push(`C4 同日（${datePrefix}）已存在决策记录，新记录必须加序号前缀 YYYY-MM-DD-NN-<标题>.md 以保证门 0.2 顺序唯一：${p}`);
        }
      }
    }

    // C5a：禁止暂存根级野目录文件（_gh-docs / _patches / tmp / scratch 等）
    const seg0 = p.includes('/') ? p.split('/')[0] : null;
    if ((f.isNew || f.isRename) && seg0 && ROGUE_ROOT_DIR_RE.test(seg0) && !allowedRootSet.has(seg0)) {
      fails.push(`C5 禁止向仓库根级非标临时目录提交文件：${p}（正式文档请归入 docs/，一次性草稿请放入 .donegate/scratch/）`);
    }

    if (!CODE_EXT_RE.test(p)) continue;
    codeFilesCount++;
    codeAddedLines += f.added.length;

    const isTestFile = TEST_FILE_RE.test(p);

    // C5b：有活跃契约 scope 的项目，新建业务代码文件必须被至少一个契约认领
    if (f.isNew && activeScopes.length > 0 && !isTestFile && !ROOT_CONFIG_FILE_RE.test(p) && !budgetBypassed) {
      // 同时检查本次暂存区是否刚更新了某份 contract.json 把它认领进去（loadActiveContractScopes 已读盘上最新值）
      if (!isClaimedByScopes(p, activeScopes)) {
        fails.push(`C5 新增代码文件未被任何活跃契约 scope[] 认领：${p}（正式模块请先写入 contracts/<id>/contract.json 的 scope；临时脚本请放 .donegate/scratch/ 或跑 --quarantine）`);
      }
    }

    // C1c：单文件总行数上限
    const absFile = resolve(projectRoot, p);
    if (existsSync(absFile) && !budgetBypassed) {
      const curLines = readFileSync(absFile, 'utf8').split(/\r?\n/).length;
      if (curLines > budgets.maxFileLines && (f.isNew || f.added.length > f.removed.length)) {
        fails.push(`C1 单文件行数超限：${p} 当前 ${curLines} 行 > 上限 ${budgets.maxFileLines} 行（请先拆分子模块，勿继续往大文件塞代码）`);
      }
    }

    // C2：测试与门禁文件反作弊检查
    if (isTestFile) {
      for (const line of f.added) {
        if (isFixture && /^\s*(?:check|t|writeFileSync|\{ name:)/.test(line)) continue;
        const isCommentLine = /^\s*(?:\/\/|\*|\/\*|#)/.test(line);
        for (const pat of TEST_CHEAT_PATTERNS) {
          if (isCommentLine && !pat.name.includes('静态检查强行豁免')) continue;
          if (pat.re.test(line)) {
            const al = checkAllowComment(line);
            if (al.abuse) abuses.push(`C2 ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
            else if (al.allowed) bypasses.push({ rule: `C2:${pat.name}`, file: p, reason: al.reason });
            else fails.push(`C2 测试反作弊拦截 [${pat.name}] (${p})：${line.trim().slice(0, 100)}`);
          }
        }
      }
      if (!f.isNew) {
        const addedAsserts = f.added.filter((l) => ASSERT_TOKEN_RE.test(l)).length;
        const removedAsserts = f.removed.filter((l) => ASSERT_TOKEN_RE.test(l)).length;
        if (removedAsserts > addedAsserts) {
          const hasDec = files.some((x) => x.isNew && x.path.startsWith('decisions/'));
          if (!hasDec && !budgetBypassed) {
            fails.push(`C2 疑似删断言凑绿 (${p})：删除了 ${removedAsserts} 处断言但仅新增 ${addedAsserts} 处（确需废弃无效断言请同步新增 decisions/ 记录说明）`);
          }
        }
      }
    }


    // C6：防绕过公共库手搓硬门禁（内置适配器/哈希防线 + 用户项目 thresholds.json bannedPatterns）
    if (!isFixture) {
      const isConcreteAdapter = /^skill\/adapters\/(?!_)[^/]+\.mjs$/.test(p);
      if (isConcreteAdapter && existsSync(absFile)) {
        const adpLines = readFileSync(absFile, 'utf8').split(/\r?\n/).length;
        if (adpLines > 90) {
          fails.push(`C6 具体适配器行数超限 (${p})：当前 ${adpLines} 行 > 上限 90 行（请复用 ./_shared.mjs 的 runMortarAdapter）`);
        }
      }
      for (const line of f.added) {
        if (/^\s*(?:\/\/|\*|\/\*|#)/.test(line)) continue;
        if (isConcreteAdapter && /from\s+['"](?:node:)?(?:crypto|child_process)['"]/.test(line)) {
          const al = checkAllowComment(line);
          if (al.abuse) abuses.push(`C6 ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
          else if (al.allowed) bypasses.push({ rule: 'C6:adapter-primitive', file: p, reason: al.reason });
          else fails.push(`C6 反手搓拦截 (${p})：具体适配器禁止直引 node:crypto 或 node:child_process，请调 ./_shared.mjs → ${line.trim().slice(0, 90)}`);
        }
        if (/^(?:runner|skill)\/.*\.mjs$/.test(p) && p !== 'skill/hash.mjs' && p !== 'skill/adapters/_shared.mjs' &&
            /\bcreateHash\s*\(\s*['"]sha256['"]\s*\)/.test(line)) {
          const al = checkAllowComment(line);
          if (al.abuse) abuses.push(`C6 ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
          else if (al.allowed) bypasses.push({ rule: 'C6:dup-sha256', file: p, reason: al.reason });
          else fails.push(`C6 反手搓拦截 (${p})：禁止重复手搓 createHash('sha256')，请复用 skill/hash.mjs 的 sha256() → ${line.trim().slice(0, 90)}`);
        }
        for (const bp of compiledBanned) {
          if (bp.pathRe && !bp.pathRe.test(p)) continue;
          if (bp.excludeRe && bp.excludeRe.test(p)) continue;
          if (bp.re.test(line)) {
            const al = checkAllowComment(line);
            if (al.abuse) abuses.push(`C6 ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
            else if (al.allowed) bypasses.push({ rule: `C6:${bp.id}`, file: p, reason: al.reason });
            else fails.push(`C6 公共库防手搓拦截 [${bp.id}] (${p})：${bp.message} → ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }

    // C3：生产源码反空壳与反懒惰省略删码检查
    if (!isTestFile && !isFixture) {
      for (const line of f.added) {
        for (const pat of CODE_SLOP_PATTERNS) {
          if (pat.re.test(line)) {
            const al = checkAllowComment(line);
            if (al.abuse) abuses.push(`C3 ${p} 逃生口 dg-allow 缺少具体理由（退 2）：${line.trim()}`);
            else if (al.allowed) bypasses.push({ rule: `C3:${pat.name}`, file: p, reason: al.reason });
            else fails.push(`C3 源码反空壳拦截 [${pat.name}] (${p})：${line.trim().slice(0, 100)}`);
          }
        }
      }
    }
  }

  if (!budgetBypassed) {
    if (codeAddedLines > budgets.maxCommitCodeLines) {
      fails.push(`C1 单次提交代码加行数超预算：本次新增 ${codeAddedLines} 行代码 > 上限 ${budgets.maxCommitCodeLines} 行（请按小步快跑拆分为多次可验证提交）`);
    }
    if (codeFilesCount > budgets.maxCommitFiles) {
      fails.push(`C1 单次提交涉及源码文件数超预算：本次改动 ${codeFilesCount} 个代码文件 > 上限 ${budgets.maxCommitFiles} 个（禁止顺手跨模块大面积改代码）`);
    }
  }

  if (abuses.length > 0) {
    return { exitCode: 2, fails: [...abuses, ...fails], bypasses, stats: { codeFiles: codeFilesCount, codeAdded: codeAddedLines } };
  }

  if (fails.length === 0 && bypasses.length > 0 && opts.recordBypasses !== false) {
    const dgDir = join(projectRoot, '.donegate');
    mkdirSync(dgDir, { recursive: true });
    const now = new Date().toISOString();
    for (const bp of bypasses) {
      appendFileSync(join(dgDir, 'hygiene-bypasses.jsonl'), JSON.stringify({ at: now, ...bp }) + '\n', 'utf8');
    }
  }

  return {
    exitCode: fails.length > 0 ? 1 : 0,
    fails,
    bypasses,
    stats: { codeFiles: codeFilesCount, codeAdded: codeAddedLines }
  };
}

function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-hygiene-red-'));
  let bad = 0;
  const t = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
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
    spawnSync('git', ['-C', d, 'add', '.']);
    spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base']);
    return d;
  };

  try {
    const dGood = makeRepo('good', true);
    writeFileSync(join(dGood, 'src/app.mjs'), 'export const run = (x) => x + 1;\nexport const twice = (x) => x * 2;\n');
    spawnSync('git', ['-C', dGood, 'add', '.']);
    const rGood = auditCommitDiff(dGood, { recordBypasses: false, budgetBypassReason: '' });
    t('好样本：小步干净提交（契约 scope 内 +1 行代码）→ 退 0', rGood.exitCode === 0, rGood.fails.join('；'));

    const dBig = makeRepo('big');
    writeFileSync(join(dBig, 'src/huge.mjs'), Array.from({ length: 320 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
    spawnSync('git', ['-C', dBig, 'add', '.']);
    const rBig = auditCommitDiff(dBig, { budgetBypassReason: '' });
    t('必红样本 1 (C1)：单次提交超 300 行代码 → 必红退 1', rBig.exitCode === 1 && rBig.fails.some((f) => f.includes('加行数超预算')));

    const dMany = makeRepo('many');
    for (let i = 0; i < 9; i++) writeFileSync(join(dMany, `src/f${i}.mjs`), `export const a = ${i};\n`);
    spawnSync('git', ['-C', dMany, 'add', '.']);
    const rMany = auditCommitDiff(dMany, { budgetBypassReason: '' });
    t('必红样本 2 (C1)：单次提交跨 9 个代码文件 → 必红退 1', rMany.exitCode === 1 && rMany.fails.some((f) => f.includes('涉及源码文件数超预算')));

    const dSkip = makeRepo('skip');
    writeFileSync(join(dSkip, 'tests/app.test.mjs'), 'it.skip("broken", () => { expect(true).toBe(true); });\n');
    spawnSync('git', ['-C', dSkip, 'add', '.']);
    const rSkip = auditCommitDiff(dSkip, { budgetBypassReason: '' });
    t('必红样本 3 (C2)：测试加 it.skip / 恒真断言 / 净删断言 → 必红退 1',
      rSkip.exitCode === 1 && rSkip.fails.some((f) => f.includes('跳过用例')) && rSkip.fails.some((f) => f.includes('疑似删断言')));

    const dSlop = makeRepo('slop');
    writeFileSync(join(dSlop, 'src/app.mjs'), 'export function f() {\n  // TODO: finish later\n  try { work(); } catch (e) {}\n}\n');
    spawnSync('git', ['-C', dSlop, 'add', '.']);
    const rSlop = auditCommitDiff(dSlop, { budgetBypassReason: '' });
    t('必红样本 4 (C3)：源码留 TODO 占位与空 catch {} 吞错 → 必红退 1',
      rSlop.exitCode === 1 && rSlop.fails.some((f) => f.includes('未完成占位符')) && rSlop.fails.some((f) => f.includes('空 catch')));

    const dElide = makeRepo('elide');
    writeFileSync(join(dElide, 'src/app.mjs'), 'export function f() {\n  // ... existing code ...\n}\n<<<<<<< HEAD\n');
    spawnSync('git', ['-C', dElide, 'add', '.']);
    const rElide = auditCommitDiff(dElide, { budgetBypassReason: '' });
    t('必红样本 5 (C3b/C3c)：小模型写 // ... existing code ... 省略删码与冲突标记残留 → 必红退 1',
      rElide.exitCode === 1 && rElide.fails.some((f) => f.includes('懒惰省略')) && rElide.fails.some((f) => f.includes('合并冲突标记')));

    const dMess = makeRepo('mess');
    writeFileSync(join(dMess, 'decisions/2026-11-21-无序号补记.md'), '# bad order\n');
    writeFileSync(join(dMess, 'src/plan_v2.md'), '# draft\n');
    spawnSync('git', ['-C', dMess, 'add', '.']);
    const rMess = auditCommitDiff(dMess, { budgetBypassReason: '' });
    t('必红样本 6 (C4)：同日无序号决策记录与 _v2 平行草稿 → 必红退 1',
      rMess.exitCode === 1 && rMess.fails.some((f) => f.includes('必须加序号前缀')) && rMess.fails.some((f) => f.includes('版本号后缀')));

    const dUnclaimed = makeRepo('unclaimed', true);
    mkdirSync(join(dUnclaimed, '_gh-docs'), { recursive: true });
    writeFileSync(join(dUnclaimed, '_gh-docs/draft.md'), '# rogue\n');
    mkdirSync(join(dUnclaimed, 'extra'), { recursive: true });
    writeFileSync(join(dUnclaimed, 'extra/rogue.mjs'), 'export const z = 1;\n');
    spawnSync('git', ['-C', dUnclaimed, 'add', 'extra/rogue.mjs']);
    const rUnclaimed = auditCommitDiff(dUnclaimed, { budgetBypassReason: '' });
    t('必红样本 7 (C5)：根级野目录 _gh-docs 与未被契约 scope 认领的新源码 → 必红退 1',
      rUnclaimed.exitCode === 1 && rUnclaimed.fails.some((f) => f.includes('野目录')) && rUnclaimed.fails.some((f) => f.includes('未被任何活跃契约')));

    // 验证 --quarantine 隔离箱（移走 _gh-docs/draft.md 并留 manifest.jsonl，绝不丢文件）与 --clean-scratch
    const qRes = quarantineUnclaimedFiles(dUnclaimed);
    mkdirSync(join(dUnclaimed, '.donegate/scratch'), { recursive: true });
    writeFileSync(join(dUnclaimed, '.donegate/scratch/probe.mjs'), 'console.log(1);\n');
    const scRes = cleanScratchDir(dUnclaimed);
    t('正样本 (隔离箱与草稿箱)：--quarantine 安全归入隔离箱附还原账本，scratch 自动清扫',
      qRes.moved.includes('_gh-docs/draft.md') &&
      existsSync(join(dUnclaimed, '.donegate/quarantine/manifest.jsonl')) &&
      scRes.cleaned === 1 && !existsSync(join(dUnclaimed, '.donegate/scratch/probe.mjs')));

    const dAbuse = makeRepo('abuse');
    writeFileSync(join(dAbuse, 'src/app.mjs'), 'export function f() {\n  try { work(); } catch (e) {} // dg-allow: ok\n}\n');
    spawnSync('git', ['-C', dAbuse, 'add', '.']);
    const rAbuse = auditCommitDiff(dAbuse, { budgetBypassReason: '' });
    t('必红样本 8 (逃生口防滥用)：写 dg-allow: ok 敷衍理由 → 必退 2（事故）', rAbuse.exitCode === 2);

    const dAllow = makeRepo('allow');
    writeFileSync(join(dAllow, 'src/app.mjs'), 'export function f() {\n  try { cleanupTmp(); } catch (e) {} // dg-allow: 临时目录清理失败不影响主退出码\n}\n');
    spawnSync('git', ['-C', dAllow, 'add', '.']);
    const rAllow = auditCommitDiff(dAllow, { budgetBypassReason: '' });
    t('正样本 (合规逃生口)：带具体理由放行退 0 且写入 hygiene-bypasses.jsonl 留痕',
      rAllow.exitCode === 0 && existsSync(join(dAllow, '.donegate/hygiene-bypasses.jsonl')));

    const dHandroll = makeRepo('handroll', true);
    const c1Hr = JSON.parse(readFileSync(join(dHandroll, 'contracts/c1/contract.json'), 'utf8'));
    c1Hr.scope.push('skill/adapters/');
    writeFileSync(join(dHandroll, 'contracts/c1/contract.json'), JSON.stringify(c1Hr));
    writeFileSync(join(dHandroll, 'thresholds.json'), JSON.stringify({
      bannedPatterns: [{
        id: 'use-shared-http',
        pattern: String.raw`\bfetch\s*\(`,
        pathRegex: '^src/',
        excludePathRegex: '^src/shared/',
        message: '请调用 src/shared/http.mjs 的 request()，禁止业务层裸调 fetch'
      }]
    }));
    mkdirSync(join(dHandroll, 'src/shared'), { recursive: true });
    mkdirSync(join(dHandroll, 'skill/adapters'), { recursive: true });
    writeFileSync(join(dHandroll, 'src/shared/http.mjs'), 'export const request = (u) => fetch(u);\n');
    writeFileSync(join(dHandroll, 'src/page.mjs'), 'export const load = () => fetch("/api/items");\n');
    writeFileSync(join(dHandroll, 'skill/adapters/custom.mjs'), 'import { spawnSync } from "node:child_process";\nexport const a = spawnSync;\n');
    spawnSync('git', ['-C', dHandroll, 'add', '.']);
    const rHandroll = auditCommitDiff(dHandroll, { budgetBypassReason: '' });
    t('必红样本 9 (C6)：适配器直引 child_process 或业务代码绕过项目公共库命中 bannedPatterns（且白名单目录放行）→ 必红退 1',
      rHandroll.exitCode === 1 &&
      rHandroll.fails.some((f) => f.includes('具体适配器禁止直引')) &&
      rHandroll.fails.some((f) => f.includes('use-shared-http') && f.includes('src/page.mjs')) &&
      !rHandroll.fails.some((f) => f.includes('(src/shared/http.mjs)')), rHandroll.fails.join('；'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(bad === 0 ? '\nRESULT: PASS 提交前小模型防翻车门禁与 11 组红绿样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  if (!existsSync(root)) { console.error('目录不存在：' + root); process.exit(3); }

  if (argv.includes('--quarantine')) {
    const q = quarantineUnclaimedFiles(root);
    if (q.moved.length === 0) console.log('工作区没有需要隔离的未认领野文件。');
    else console.log(`已将 ${q.moved.length} 个未认领文件安全移入 ${q.batchDir}（原路径记录见 .donegate/quarantine/manifest.jsonl）：\n  - ` + q.moved.join('\n  - '));
    process.exit(0);
  }

  if (argv.includes('--clean-scratch')) {
    const sc = cleanScratchDir(root);
    console.log(`已清扫 .donegate/scratch/ 临时草稿 ${sc.cleaned} 项。`);
    process.exit(0);
  }

  const rangeIdx = argv.indexOf('--range');
  const range = rangeIdx >= 0 && argv[rangeIdx + 1] ? argv[rangeIdx + 1] : null;
  if (argv.includes('--staged') || range) {
    const res = auditCommitDiff(root, { range });
    if (res.exitCode === 0) {
      const bpNote = res.bypasses.length > 0 ? `（含 ${res.bypasses.length} 处已留痕 dg-allow 豁免）` : '';
      console.log(`✓ 提交前门禁通过：改动代码文件 ${res.stats.codeFiles} 个，新增代码 ${res.stats.codeAdded} 行${bpNote}`);
      process.exit(0);
    }
    console.error('✗ 提交已被 DoneGate 提交前门禁拦截（防止超量改动、懒惰省略删码、改测试凑绿或乱丢未认领文件）：');
    for (const f of res.fails) console.error('  - ' + f);
    console.error('修复建议：拆小单次提交（≤300 行代码 / ≤8 个文件），补齐真实实现与契约 scope 登记，或用 --quarantine 隔离野文件后再 git commit。');
    process.exit(res.exitCode);
  }

  process.exit(runRedSelfTest());
}
