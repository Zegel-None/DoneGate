#!/usr/bin/env node
// Git 提交前钩子安装器（B 层进程级硬拦截）：把小模型容易忘跑的检查直接焊进 .githooks/pre-commit
//
// 为什么必须落成 Git 钩子：
//   提示词（A 层）只能劝小模型「提交前记得跑自检」，小模型长对话一旦上下文拥挤就会忘跑或偷懒跳过。
//   挂入 .githooks/pre-commit 并设置 git config core.hooksPath .githooks 后，
//   每次执行 git commit 都会由 git 进程自动调起：
//     1. check-commit-hygiene.mjs --staged（秒级检查单轮代码量级、禁 .skip/删断言、禁 TODO/空 catch）
//     2. 项目冒烟命令与 check-escapes.mjs 核查（DoneGate 本仓直接跑 --self-check）
//   任一不过，git commit 直接非零中止，错误不会累积到下一轮。
//
// 用法：
//   node skill/install-hooks.mjs [--root <项目根>]     为目标项目生成 .githooks/pre-commit 并激活 core.hooksPath
//   node skill/install-hooks.mjs --red-self-test       在临时 git 仓实测：脏/作弊 commit 被 git 真拦截，干净 commit 放行
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname, join, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DG_ROOT = resolve(HERE, '..');

export function resolveSkillPrefix(projectRoot, dgRoot = DG_ROOT, pathApi = path) {
  const normProject = pathApi.resolve(projectRoot);
  const normDg = pathApi.resolve(dgRoot);
  const dgSkill = pathApi.join(normDg, 'skill');
  const isWin = pathApi.sep === '\\';
  const sameRoot = isWin
    ? normProject.toLowerCase() === normDg.toLowerCase()
    : normProject === normDg;
  if (sameRoot) return 'skill';
  return dgSkill.replace(/\\/g, '/');
}

export function buildPreCommitScript(projectRoot, dgRoot = DG_ROOT, pathApi = path) {
  const skillPrefix = resolveSkillPrefix(projectRoot, dgRoot, pathApi);
  const runnerPrefix = skillPrefix === 'skill' ? 'runner/donegate.mjs' : `${skillPrefix.replace(/\/skill$/, '')}/runner/donegate.mjs`;
  const shDq = (s) => String(s).replace(/([\\"$`])/g, '\\$1');

  return [
    '#!/bin/sh',
    '# DoneGate 自动提交前守门钩子（防小模型超量提交、改测试凑绿、留空壳代码或漏跑自检）',
    'set -e',
    `DG_SKILL="${shDq(skillPrefix)}"`,
    `DG_RUNNER="${shDq(runnerPrefix)}"`,
    'DG_VERIFIED_TREE=$(git write-tree 2>/dev/null || true)',
    'unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_PREFIX',
    'dg_stamp_verified_tree() {',
    '  if [ -n "$DG_VERIFIED_TREE" ]; then',
    '    mkdir -p .donegate',
    '    printf \'{"tree":"%s","at":"%s"}\\n\' "$DG_VERIFIED_TREE" "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo now)" >> .donegate/verified-trees.jsonl',
    '  fi',
    '}',
    'if [ -f ".donegate/workflows/overrides/dg-pre-commit.overlay.json" ] && [ -f "$DG_RUNNER" ]; then',
    '  node "$DG_RUNNER" flow run dg-pre-commit --staged --root .',
    '  unset GIT_INDEX_FILE',
    '  dg_stamp_verified_tree',
    '  exit 0',
    'fi',
    'node "$DG_SKILL/check-commit-hygiene.mjs" --staged --root .',
    'unset GIT_INDEX_FILE',
    'if [ -f "skill/check-escapes.mjs" ] && [ -f "escapes.jsonl" ]; then',
    '  node "skill/check-escapes.mjs" --self-check --project .',
    'elif [ -f "INTENT.md" ]; then',
    '  node "$DG_SKILL/check-escapes.mjs" --project .',
    'fi',
    'dg_stamp_verified_tree',
    ''
  ].join('\n');
}

export function buildPrePushScript(projectRoot, dgRoot = DG_ROOT, pathApi = path) {
  const skillPrefix = resolveSkillPrefix(projectRoot, dgRoot, pathApi);
  const shDq = (s) => String(s).replace(/([\\"$`])/g, '\\$1');

  return [
    '#!/bin/sh',
    '# DoneGate 推送前漏网补扫钩子（push-sweep：核对 verified-trees.jsonl 逐笔拦截 --no-verify 绕过的脏提交）',
    'set -e',
    `DG_SKILL="${shDq(skillPrefix)}"`,
    'ZERO_SHA="0000000000000000000000000000000000000000"',
    'UNVERIFIED_COMMITS=""',
    'while read local_ref local_sha remote_ref remote_sha; do',
    '  [ -z "$local_sha" ] || [ "$local_sha" = "$ZERO_SHA" ] && continue',
    '  if [ "$remote_sha" = "$ZERO_SHA" ]; then',
    '    COMMITS=$(git rev-list -n 1 "$local_sha" 2>/dev/null || true)',
    '  else',
    '    COMMITS=$(git rev-list "${remote_sha}..${local_sha}" 2>/dev/null || true)',
    '  fi',
    '  for c in $COMMITS; do',
    '    t=$(git rev-parse "${c}^{tree}" 2>/dev/null || true)',
    '    if [ -z "$t" ] || [ ! -f ".donegate/verified-trees.jsonl" ] || ! grep -q "\\"$t\\"" ".donegate/verified-trees.jsonl" 2>/dev/null; then',
    '      UNVERIFIED_COMMITS="$UNVERIFIED_COMMITS $c"',
    '    fi',
    '  done',
    'done',
    '[ -z "$UNVERIFIED_COMMITS" ] && exit 0',
    'unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_PREFIX GIT_INDEX_FILE',
    'echo "[DoneGate push-sweep] 检测到未经 pre-commit 验真的提交，正在逐笔执行推送前补扫..."',
    'for c in $UNVERIFIED_COMMITS; do',
    '  if git rev-parse --verify "${c}~1" >/dev/null 2>&1; then',
    '    node "$DG_SKILL/check-commit-hygiene.mjs" --range "${c}~1..${c}" --root .',
    '  else',
    '    node "$DG_SKILL/check-commit-hygiene.mjs" --audit-repo --root .',
    '  fi',
    '  t=$(git rev-parse "${c}^{tree}" 2>/dev/null || true)',
    '  if [ -n "$t" ]; then',
    '    mkdir -p .donegate',
    '    printf \'{"tree":"%s","at":"%s"}\\n\' "$t" "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo now)" >> .donegate/verified-trees.jsonl',
    '  fi',
    'done',
    'if [ -f "skill/check-escapes.mjs" ] && [ -f "escapes.jsonl" ]; then',
    '  node "skill/check-escapes.mjs" --self-check --project .',
    'elif [ -f "INTENT.md" ]; then',
    '  node "$DG_SKILL/check-escapes.mjs" --project .',
    'fi',
    ''
  ].join('\n');
}

export function isNoexecMount(targetPath, mountsText = null) {
  if (process.platform === 'win32' && mountsText === null) return false;
  let rawMounts = mountsText;
  if (rawMounts === null) {
    if (!existsSync('/proc/mounts')) return false;
    try { rawMounts = readFileSync('/proc/mounts', 'utf8'); } catch { return false; }
  }
  const rawTarget = String(targetPath || '/');
  const abs = rawTarget.startsWith('/')
    ? path.posix.resolve(rawTarget)
    : resolve(rawTarget).replace(/\\/g, '/');
  let bestLen = -1;
  let bestNoexec = false;
  for (const line of String(rawMounts || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const mp = parts[1].replace(/\\040/g, ' ');
    const opts = parts[3].split(',');
    const matched = mp === '/' || abs === mp || abs.startsWith(mp + '/');
    if (matched && mp.length >= bestLen) {
      bestLen = mp.length;
      bestNoexec = opts.includes('noexec');
    }
  }
  return bestNoexec;
}

export function resolveHookTestTmpBase(projectRoot = DG_ROOT, env = process.env, mountsText = null, ensureDir = true) {
  const envTmp = env && typeof env.TMPDIR === 'string' ? env.TMPDIR.trim() : '';
  if (envTmp && !isNoexecMount(envTmp, mountsText)) {
    const resolvedEnv = resolve(envTmp);
    if (ensureDir) mkdirSync(resolvedEnv, { recursive: true });
    return resolvedEnv;
  }
  const localDotTmp = join(resolve(projectRoot), '.donegate', 'tmp');
  if (!isNoexecMount(localDotTmp, mountsText)) {
    if (ensureDir) mkdirSync(localDotTmp, { recursive: true });
    return localDotTmp;
  }
  if (mountsText === null) {
    const commonGit = spawnSync('git', ['-C', resolve(projectRoot), 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
    const commonRaw = (commonGit.stdout || '').trim();
    if (commonGit.status === 0 && commonRaw) {
      const commonRepoTmp = join(dirname(resolve(projectRoot, commonRaw)), '.donegate', 'tmp');
      if (!isNoexecMount(commonRepoTmp, mountsText)) {
        if (ensureDir) mkdirSync(commonRepoTmp, { recursive: true });
        return commonRepoTmp;
      }
    }
    if (existsSync('/var/tmp') && !isNoexecMount('/var/tmp', mountsText)) {
      return '/var/tmp';
    }
  }
  const fallback = tmpdir();
  if (ensureDir) mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function installGitHooks(projectRoot) {
  const hooksDir = join(projectRoot, '.githooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, 'pre-commit');
  const prePushPath = join(hooksDir, 'pre-push');
  writeFileSync(hookPath, buildPreCommitScript(projectRoot), 'utf8');
  writeFileSync(prePushPath, buildPrePushScript(projectRoot), 'utf8');
  try { chmodSync(hookPath, 0o755); chmodSync(prePushPath, 0o755); } catch { /* win32 noop */ }

  let activated = false;
  const inside = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status === 0 && (inside.stdout || '').trim() === 'true') {
    const cfg = spawnSync('git', ['-C', projectRoot, 'config', 'core.hooksPath', '.githooks'], { encoding: 'utf8' });
    activated = cfg.status === 0;
  }
  return { hookPath, prePushPath, activated };
}

function ihRunGit(cwd, args, env) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env });
}

function ihTestNoexecAndCrossDrive(check) {
  const mockMounts = 'tmpfs /tmp tmpfs rw,nosuid,nodev,noexec 0 0\n/dev/vdb /work xfs rw,relatime 0 0\n';
  const expectedRepoTmp = resolve('/work/repo/.donegate/tmp');
  const noexecOk = isNoexecMount('/tmp/dg-any', mockMounts) === true &&
    isNoexecMount('/work/repo', mockMounts) === false &&
    resolveHookTestTmpBase('/work/repo', {}, mockMounts, false) === expectedRepoTmp &&
    resolveHookTestTmpBase('/work/repo', { TMPDIR: '/tmp/sub' }, mockMounts, false) === expectedRepoTmp &&
    resolveHookTestTmpBase('/work/repo', { TMPDIR: '/work/exec-tmp' }, mockMounts, false) === resolve('/work/exec-tmp');
  check('noexec 挂载识别与 .donegate/tmp 可执行回退：TMPDIR 缺失或处于 noexec /tmp 时自动回退项目 .donegate/tmp', noexecOk);

  const mockWinDg = win32.join('D:', 'skills', 'DoneGate');
  const expectedWinSkill = win32.join(mockWinDg, 'skill').replace(/\\/g, '/');
  const crossDriveHook = buildPreCommitScript(win32.join('C:', 'Temp', 'dg-hook-x'), mockWinDg, win32);
  const parentDrivePrefix = resolveSkillPrefix(win32.join('D:'), mockWinDg, win32);
  const winCaseDiffSelf = resolveSkillPrefix(win32.join('d:', 'skills', 'donegate'), mockWinDg, win32);
  const winPathOk = crossDriveHook.includes(`DG_SKILL="${expectedWinSkill}"`) &&
    parentDrivePrefix === expectedWinSkill &&
    winCaseDiffSelf === 'skill' &&
    crossDriveHook.includes('[ -f "escapes.jsonl" ]');
  check('Windows 跨盘符/父目录写绝对正斜杠路径且本仓盘符大小写差异仍用相对 skill', winPathOk);
}

function ihInitTempHookRepo(tmp, gitEnv) {
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(join(tmp, '.gitignore'), '.donegate/\n');
  writeFileSync(join(tmp, 'src/a.mjs'), 'export const a = 1;\n');
  ihRunGit(tmp, ['init', '-q'], gitEnv);
  ihRunGit(tmp, ['config', 'user.email', 'h@local'], gitEnv);
  ihRunGit(tmp, ['config', 'user.name', 'H'], gitEnv);
  ihRunGit(tmp, ['add', '.'], gitEnv);
  ihRunGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], gitEnv);
}

function ihTestSlopAndCleanCommits(tmp, gitEnv, check) {
  const inst = installGitHooks(tmp);
  check('安装 .githooks/pre-commit 并激活 git core.hooksPath', inst.activated && existsSync(inst.hookPath));

  writeFileSync(join(tmp, 'src/a.mjs'), 'export function a() { // TO' + 'DO: 以后再写\n  return 1;\n}\n');
  ihRunGit(tmp, ['add', 'src/a.mjs'], gitEnv);
  const rBlocked = ihRunGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'bad slop commit'], gitEnv);
  const blockedOut = (rBlocked.stderr || '') + (rBlocked.stdout || '');
  check('必红样本：含 TODO 空壳代码的 git commit 被 pre-commit 钩子当场拦截', rBlocked.status !== 0 && /未完成占位符/.test(blockedOut));

  writeFileSync(join(tmp, 'src/a.mjs'), 'export function a() {\n  return 2;\n}\n');
  ihRunGit(tmp, ['add', 'src/a.mjs'], gitEnv);
  const rPass = ihRunGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'clean small commit'], gitEnv);
  check('正样本：修掉空壳后的小步干净 git commit 顺畅放行并记录 verified-trees.jsonl', rPass.status === 0 && existsSync(join(tmp, '.donegate/verified-trees.jsonl')), rPass.stderr);

  const bareRemote = join(tmp, '.donegate', 'bare-remote.git');
  ihRunGit(tmp, ['init', '--bare', '-q', bareRemote], gitEnv);
  ihRunGit(tmp, ['remote', 'add', 'origin', bareRemote], gitEnv);
  const branchName = (ihRunGit(tmp, ['rev-parse', '--abbrev-ref', 'HEAD'], gitEnv).stdout || 'main').trim();
  const rCleanPush = ihRunGit(tmp, ['push', '-q', 'origin', branchName], gitEnv);
  check('正样本：已通过 pre-commit 验真的提交在 pre-push 秒级放行', rCleanPush.status === 0, rCleanPush.stderr);

  writeFileSync(join(tmp, 'src/a.mjs'), 'export function a() { // TO' + 'DO: 绕过提交\n  return 9;\n}\n');
  ihRunGit(tmp, ['add', 'src/a.mjs'], gitEnv);
  ihRunGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'sneaky bypass', '--no-verify'], gitEnv);
  const rPushBlocked = ihRunGit(tmp, ['push', 'origin', branchName], gitEnv);
  const pushErr = (rPushBlocked.stderr || '') + (rPushBlocked.stdout || '');
  check('必红样本：用 --no-verify 绕过 pre-commit 的脏提交在 git push 时被 pre-push 补扫拦截', rPushBlocked.status !== 0 && /push-sweep/.test(pushErr), pushErr);
  ihRunGit(tmp, ['reset', '--hard', 'HEAD~1'], gitEnv);
}

function ihTestWorktreeIsolation(tmp, gitEnv, check) {
  writeFileSync(join(tmp, 'escapes.jsonl'), '');
  mkdirSync(join(tmp, 'skill'), { recursive: true });
  writeFileSync(join(tmp, 'skill/check-escapes.mjs'), `import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process'; const d = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dg-sub-')); writeFileSync(join(d, 'x.txt'), '1'); spawnSync('git', ['-C', d, 'init', '-q']); spawnSync('git', ['-C', d, 'config', 'user.email', 'leak@bad']); spawnSync('git', ['-C', d, 'config', 'user.name', 'Leak']); spawnSync('git', ['-C', d, 'add', '.']); spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'sub-init']); rmSync(d, { recursive: true, force: true });\n`);
  ihRunGit(tmp, ['add', '.'], gitEnv);
  ihRunGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add self-check stub', '--no-verify'], gitEnv);
  const wtDir = join(tmp, '.donegate', 'wt-hook-check');
  ihRunGit(tmp, ['worktree', 'add', '-q', '-b', 'wt/hook-check', wtDir, 'HEAD'], gitEnv);
  writeFileSync(join(wtDir, 'src/a.mjs'), 'export function a() {\n  return 3;\n}\n');
  ihRunGit(wtDir, ['add', 'src/a.mjs'], gitEnv);
  const rWt = ihRunGit(wtDir, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'worktree clean commit'], gitEnv);
  const wtMsg = (ihRunGit(wtDir, ['log', '-1', '--format=%s'], gitEnv).stdout || '').trim();
  const bareVal = (ihRunGit(tmp, ['config', '--get', 'core.bare'], gitEnv).stdout || '').trim();
  const userVal = (ihRunGit(tmp, ['config', '--get', 'user.email'], gitEnv).stdout || '').trim();
  const wtOk = rWt.status === 0 && wtMsg === 'worktree clean commit' && bareVal !== 'true' && userVal === 'h@local';
  check('Git Worktree 提交隔离：钩子剥离 GIT_DIR 后子自检不污染分支 HEAD、core.bare 与 user.email', wtOk, rWt.stderr);
}

function ihCleanupHookTmp(tmp, baseTmp) {
  rmSync(tmp, { recursive: true, force: true });
  if (!/[\\/]\.donegate[\\/]tmp$/.test(baseTmp)) return;
  try {
    if (existsSync(baseTmp) && readdirSync(baseTmp).length === 0) rmdirSync(baseTmp);
  } catch (err) {
    void err;
  }
}

function runRedSelfTest() {
  const baseTmp = resolveHookTestTmpBase(DG_ROOT);
  const tmp = mkdtempSync(join(baseTmp, 'dg-hook-test-'));
  const gitEnv = { ...process.env, TMPDIR: baseTmp };
  let bad = 0;
  const check = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };
  try {
    ihTestNoexecAndCrossDrive(check);
    ihInitTempHookRepo(tmp, gitEnv);
    ihTestSlopAndCleanCommits(tmp, gitEnv, check);
    ihTestWorktreeIsolation(tmp, gitEnv, check);
  } finally {
    ihCleanupHookTmp(tmp, baseTmp);
  }
  console.log(bad === 0 ? '\nRESULT: PASS Git pre-commit 钩子真拦截与放行自检全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : process.cwd());
  if (!existsSync(root)) { console.error('目录不存在：' + root); process.exit(3); }
  const res = installGitHooks(root);
  console.log(`已写入钩子：${res.hookPath}（git core.hooksPath=${res.activated ? '已激活 .githooks' : '待 git init 后执行 git config core.hooksPath .githooks'}）`);
  process.exit(0);
}
