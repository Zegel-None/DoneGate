// 过夜挂机 Git Worktree 零污染隔离沙箱引擎（全绿自动快进合回主分支，熔断停机时主工作区 100% 干净零污染）
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizeSlashes } from '../deps/index.mjs';

export function snapshotHeldOutContractsForWorktree(projectRoot, runId) {
  const root = resolve(projectRoot);
  const contractsDir = join(root, 'contracts');
  const safeId = sanitizeId(runId);
  const snapDir = join(root, '.donegate', 'heldout', safeId);
  if (!existsSync(contractsDir)) {
    return { ok: false, count: 0, snapshotDir: null, relSnapshotDir: null };
  }
  mkdirSync(snapDir, { recursive: true });
  let count = 0;
  for (const e of readdirSync(contractsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const src = join(contractsDir, e.name, 'contract.json');
    if (!existsSync(src)) continue;
    const dstDir = join(snapDir, e.name);
    mkdirSync(dstDir, { recursive: true });
    cpSync(src, join(dstDir, 'contract.json'), { force: true });
    count++;
  }
  return {
    ok: count > 0,
    count,
    snapshotDir: snapDir,
    relSnapshotDir: normalizeSlashes(`.donegate/heldout/${safeId}`)
  };
}

function sanitizeId(raw) {
  return String(raw || 'run').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || 'run';
}

export function cleanGitEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[k];
  return env;
}

function runGit(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', env: cleanGitEnv(), windowsHide: true });
  return { ok: r.status === 0, status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function ensureWorktreeRuntimeExcludes(wtDir) {
  const ex = runGit(wtDir, ['rev-parse', '--git-path', 'info/exclude']);
  if (!ex.ok || !ex.stdout) return;
  const exAbs = resolve(wtDir, ex.stdout);
  try {
    mkdirSync(dirname(exAbs), { recursive: true });
    const cur = existsSync(exAbs) ? readFileSync(exAbs, 'utf8') : '';
    const need = ['.donegate/', 'workflows/.deps/'].filter((p) => !cur.split(/\r?\n/).includes(p));
    if (need.length > 0) appendFileSync(exAbs, (cur.endsWith('\n') || !cur ? '' : '\n') + need.join('\n') + '\n', 'utf8');
  } catch (err) { void err; }
}

export function canUseGitWorktree(projectRoot) {
  const root = resolve(projectRoot);
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  return head.ok && Boolean(head.stdout);
}

/**
 * 为过夜挂机准备或复用隔离 Git Worktree：.donegate/worktrees/<runId>
 */
export function prepareAutopilotWorktree(projectRoot, runId) {
  const root = resolve(projectRoot);
  if (!canUseGitWorktree(root)) {
    return { ok: false, reason: '当前目录尚无 Git HEAD 提交，跳过 Worktree 隔离' };
  }
  const safeId = sanitizeId(runId);
  const wtDir = join(root, '.donegate', 'worktrees', safeId);
  const branchName = `dg-autopilot/${safeId}`;
  const baseHead = runGit(root, ['rev-parse', 'HEAD']).stdout;
  const mainBranchRes = runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const mainBranch = mainBranchRes.ok ? mainBranchRes.stdout : null;

  const heldOut = snapshotHeldOutContractsForWorktree(root, safeId);
  if (existsSync(join(wtDir, '.git'))) {
    ensureWorktreeRuntimeExcludes(wtDir);
    return {
      ok: true,
      reused: true,
      worktreePath: wtDir,
      relWorktreePath: normalizeSlashes(`.donegate/worktrees/${safeId}`),
      heldOutSnapshotDir: heldOut.snapshotDir,
      relHeldOutSnapshotDir: heldOut.relSnapshotDir,
      branchName,
      baseHead,
      mainBranch
    };
  }

  mkdirSync(join(root, '.donegate', 'worktrees'), { recursive: true });
  runGit(root, ['worktree', 'prune']);
  const addRes = runGit(root, ['worktree', 'add', '-B', branchName, wtDir, 'HEAD']);
  if (!addRes.ok) {
    return { ok: false, reason: `创建隔离 Worktree 失败：${addRes.stderr || addRes.stdout}` };
  }

  const email = runGit(wtDir, ['config', 'user.email']);
  if (!email.ok || !email.stdout) {
    runGit(wtDir, ['config', 'user.email', 'autopilot@donegate.local']);
    runGit(wtDir, ['config', 'user.name', 'DoneGate Autopilot']);
  }
  ensureWorktreeRuntimeExcludes(wtDir);

  return {
    ok: true,
    reused: false,
    worktreePath: wtDir,
    relWorktreePath: normalizeSlashes(`.donegate/worktrees/${safeId}`),
    heldOutSnapshotDir: heldOut.snapshotDir,
    relHeldOutSnapshotDir: heldOut.relSnapshotDir,
    branchName,
    baseHead,
    mainBranch
  };
}

/**
 * 收尾过夜挂机沙箱：
 * - COMPLETED: 若沙箱内有改动，在沙箱分支提交并仅当主工作区干净时无损 fast-forward 合回主分支，随后清理临时 worktree
 * - SUSPENDED: 保留沙箱原貌供早间人工批准后无缝续跑
 * - ABORTED: 绝不触碰主分支工作区（保证主仓 100% 零污染），保留沙箱现场供早间排查
 */
export function finalizeAutopilotWorktree(projectRoot, wtInfo, outcome, runId) {
  const root = resolve(projectRoot);
  if (!wtInfo || !wtInfo.ok || !wtInfo.worktreePath) {
    return { active: false, status: 'not_used' };
  }
  const { worktreePath, relWorktreePath, branchName } = wtInfo;

  if (outcome === 'SUSPENDED') {
    return {
      active: true,
      status: 'suspended_preserved',
      worktreePath: relWorktreePath,
      branchName,
      note: '人工闸门挂起中，隔离 Worktree 已完整保留供早间续跑'
    };
  }

  if (outcome !== 'COMPLETED') {
    return {
      active: true,
      status: 'quarantined_clean_main',
      worktreePath: relWorktreePath,
      branchName,
      note: `熔断已隔离在 ${relWorktreePath}（分支 ${branchName}），主工作区保持 100% 零污染`
    };
  }

  ensureWorktreeRuntimeExcludes(root);
  ensureWorktreeRuntimeExcludes(worktreePath);
  const wtStatus = runGit(worktreePath, ['status', '--porcelain']);
  let committedInSandbox = false;
  if (wtStatus.ok && wtStatus.stdout !== '') {
    runGit(worktreePath, ['add', '-A']);
    const cRes = runGit(worktreePath, ['-c', 'commit.gpgsign=false', 'commit', '-m', `chore(autopilot): verified pass [${sanitizeId(runId)}]`]);
    committedInSandbox = cRes.ok;
  }
  const wtHead = runGit(worktreePath, ['rev-parse', 'HEAD']).stdout;
  const mainHead = runGit(root, ['rev-parse', 'HEAD']).stdout;
  let mergedToMain = false;

  if (wtHead && mainHead && wtHead !== mainHead) {
    const mainDirty = runGit(root, ['status', '--porcelain']);
    if (mainDirty.ok && mainDirty.stdout === '') {
      const mRes = runGit(root, ['merge', '--ff-only', branchName]);
      mergedToMain = mRes.ok;
    }
  } else {
    mergedToMain = true;
  }

  if (mergedToMain) {
    runGit(root, ['worktree', 'remove', '--force', worktreePath]);
    if (existsSync(worktreePath)) {
      try { rmSync(worktreePath, { recursive: true, force: true }); } catch (err) { void err; }
    }
    runGit(root, ['worktree', 'prune']);
    runGit(root, ['branch', '-D', branchName]);
    return {
      active: true,
      status: committedInSandbox ? 'merged_and_cleaned' : 'noop_and_cleaned',
      mergedToMain: true,
      branchName
    };
  }

  return {
    active: true,
    status: 'completed_branch_ready',
    mergedToMain: false,
    worktreePath: relWorktreePath,
    branchName,
    note: `沙箱全绿提交已就绪于分支 ${branchName}（主工作区有本地改动，未强行覆盖）`
  };
}
