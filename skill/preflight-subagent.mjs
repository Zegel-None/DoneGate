#!/usr/bin/env node
// 子代理隔离工作树启动探针与 1 秒失联熔断守卫（preflight-subagent.mjs）
// 根治容器休眠/分支清理导致临时工作树丢失后，子代理盲目翻查系统受限目录而触发权限弹窗卡死（BLOCKED）的问题。
//
// 用法：
//   node skill/preflight-subagent.mjs [--root <dir>] [--expect-branch <branch>] [--node <nodeId>] [--json]
//   node skill/preflight-subagent.mjs --stamp-lease [--root <dir>] [--expect-branch <branch>] [--node <nodeId>]
//   node runner/donegate.mjs preflight [--stamp-lease] [--expect-branch <branch>] [--node <nodeId> | --target-node <nodeId>] [--json]
//   node skill/preflight-subagent.mjs --red-self-test
//
// 退出码：
//   0  工作树与可写临时区健康就绪，可安全施工
//   78 工作树已失效、Git 元数据断链或分支不匹配（EX_CONFIG / WORKTREE_EXPIRED）——子代理必须第 1 秒立即停机回报总控，严禁自救探测
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';

export const EXIT_WORKTREE_EXPIRED = 78;

function pfLeaseFilePath(rootDir) {
  return join(rootDir, '.donegate', 'worktree-lease.json');
}

function pfReadCurrentBranch(rootDir) {
  const inside = spawnSync('git', ['-C', rootDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') {
    return { gitValid: false, branch: null, head: null, reason: (inside.stderr || 'git 工作树元数据不可达').trim() };
  }
  const br = spawnSync('git', ['-C', rootDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  const hd = spawnSync('git', ['-C', rootDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return {
    gitValid: br.status === 0,
    branch: br.status === 0 ? (br.stdout || '').trim() : null,
    head: hd.status === 0 ? (hd.stdout || '').trim() : null,
    reason: br.status === 0 ? '' : (br.stderr || '无法读取当前分支').trim()
  };
}

function pfEnsureWritableTmp(rootDir) {
  const localTmp = join(rootDir, '.donegate', 'tmp');
  try {
    mkdirSync(localTmp, { recursive: true });
    const probe = join(localTmp, `.pf-${process.pid}`);
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    return { ok: true, safeTmpDir: localTmp };
  } catch (e) {
    return { ok: false, safeTmpDir: null, reason: `工作树内部临时目录不可写：${e.message}` };
  }
}

export function stampWorktreeLease(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  if (!existsSync(root)) {
    return { exitCode: EXIT_WORKTREE_EXPIRED, ok: false, code: 'WORKTREE_MISSING', reason: `目标工作树目录不存在：${root}` };
  }
  const gitInfo = pfReadCurrentBranch(root);
  if (!gitInfo.gitValid) {
    return { exitCode: EXIT_WORKTREE_EXPIRED, ok: false, code: 'GIT_BROKEN', reason: `无法在损坏的 Git 工作树签发租约：${gitInfo.reason}` };
  }
  const expectedBranch = opts.expectBranch || gitInfo.branch;
  const lease = {
    schema: 'donegate-worktree-lease/v1',
    stampedAt: new Date().toISOString(),
    expectedBranch,
    baseHead: gitInfo.head,
    nodeId: opts.nodeId || null
  };
  const leasePath = pfLeaseFilePath(root);
  mkdirSync(join(root, '.donegate'), { recursive: true });
  writeFileSync(leasePath, JSON.stringify(lease, null, 2) + '\n', 'utf8');
  return { exitCode: 0, ok: true, code: 'LEASE_STAMPED', leasePath, lease };
}

export function verifySubagentPreflight(projectRoot, opts = {}) {
  const t0 = Date.now();
  const root = resolve(projectRoot);
  let st = null;
  try { st = existsSync(root) ? statSync(root) : null; } catch { st = null; }
  if (!st || !st.isDirectory()) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'WORKTREE_EXPIRED',
      durationMs: Date.now() - t0,
      reason: `工作树目录不存在或已被宿主回收：${root}`
    };
  }
  if (!existsSync(join(root, '.git'))) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'WORKTREE_EXPIRED',
      durationMs: Date.now() - t0,
      reason: `目录缺少 .git 仓库或工作树指针：${root}`
    };
  }
  const gitInfo = pfReadCurrentBranch(root);
  if (!gitInfo.gitValid) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'WORKTREE_EXPIRED',
      durationMs: Date.now() - t0,
      reason: `Git 工作树指针已断链或父仓已 prune：${gitInfo.reason}`
    };
  }
  const leasePath = pfLeaseFilePath(root);
  const leaseRes = existsSync(leasePath) ? readJsonStrict(leasePath) : { ok: false, value: null };
  const expectedBranch = opts.expectBranch || leaseRes.value?.expectedBranch || null;
  if (expectedBranch && gitInfo.branch !== expectedBranch) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'BRANCH_MISMATCH',
      durationMs: Date.now() - t0,
      branch: gitInfo.branch,
      expectedBranch,
      reason: `当前分支「${gitInfo.branch}」与派工租约期望分支「${expectedBranch}」不符`
    };
  }
  const expectedNode = opts.nodeId || leaseRes.value?.nodeId || null;
  if (expectedNode && existsSync(join(root, 'contracts')) && !existsSync(join(root, 'contracts', expectedNode, 'contract.json'))) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'CONTRACT_MISSING',
      durationMs: Date.now() - t0,
      reason: `工作树内找不到目标契约节点「${expectedNode}」`
    };
  }
  const tmpRes = pfEnsureWritableTmp(root);
  if (!tmpRes.ok) {
    return {
      exitCode: EXIT_WORKTREE_EXPIRED,
      ok: false,
      code: 'TMP_NOT_WRITABLE',
      durationMs: Date.now() - t0,
      reason: tmpRes.reason
    };
  }
  return {
    exitCode: 0,
    ok: true,
    code: 'PREFLIGHT_OK',
    durationMs: Date.now() - t0,
    branch: gitInfo.branch,
    head: gitInfo.head,
    nodeId: expectedNode,
    hasLease: Boolean(leaseRes.ok && leaseRes.value),
    safeTmpDir: tmpRes.safeTmpDir
  };
}

export function cmdPreflight(projectRoot, opts = {}) {
  if (opts.stampLease) {
    const stamped = stampWorktreeLease(projectRoot, { expectBranch: opts.expectBranch, nodeId: opts.nodeId });
    if (!stamped.ok) {
      const msg = `ABORT [${stamped.code} exit=${stamped.exitCode}]：${stamped.reason}`;
      return { exitCode: stamped.exitCode, preflight: stamped, stdout: opts.json ? JSON.stringify(stamped) : '', stderr: msg };
    }
    const text = `✓ 已签发子代理工作树租约：branch=${stamped.lease.expectedBranch} head=${stamped.lease.baseHead}${stamped.lease.nodeId ? ` node=${stamped.lease.nodeId}` : ''}`;
    return { exitCode: 0, preflight: stamped, stdout: opts.json ? JSON.stringify(stamped, null, 2) : text };
  }
  const res = verifySubagentPreflight(projectRoot, { expectBranch: opts.expectBranch, nodeId: opts.nodeId });
  if (opts.json) {
    return { exitCode: res.exitCode, preflight: res, stdout: JSON.stringify(res, null, 2), ...(res.ok ? {} : { stderr: res.reason }) };
  }
  if (!res.ok) {
    const abortLine = `ABORT [${res.code} exit=${res.exitCode}]：${res.reason}。严禁自行扫描系统目录或尝试重建工作树，请立即停止所有工具调用并向总控回报 ${res.code} 请求重派！`;
    return { exitCode: res.exitCode, preflight: res, stdout: abortLine, stderr: abortLine };
  }
  const okLine = `✓ PREFLIGHT_OK [branch=${res.branch} head=${res.head}${res.nodeId ? ` node=${res.nodeId}` : ''} ${res.durationMs}ms] 工作树完整就绪，可安全局部施工`;
  return { exitCode: 0, preflight: res, stdout: okLine };
}

function runRedSelfTest() {
  const base = mkdtempSync(join(tmpdir(), 'dg-pf-red-'));
  let bad = 0;
  const t = (label, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };
  try {
    const goodRepo = join(base, 'good');
    mkdirSync(join(goodRepo, 'contracts/c1'), { recursive: true });
    writeFileSync(join(goodRepo, '.gitignore'), '.donegate/\n');
    writeFileSync(join(goodRepo, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['src/'], obligations: [] }));
    spawnSync('git', ['-C', goodRepo, 'init', '-q', '-b', 'feat/unit-a']);
    spawnSync('git', ['-C', goodRepo, 'config', 'user.email', 'pf@local']);
    spawnSync('git', ['-C', goodRepo, 'config', 'user.name', 'PF']);
    spawnSync('git', ['-C', goodRepo, 'add', '.']);
    spawnSync('git', ['-C', goodRepo, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

    const stampRes = cmdPreflight(goodRepo, { stampLease: true, expectBranch: 'feat/unit-a', nodeId: 'c1' });
    const okRes = cmdPreflight(goodRepo, {});
    t('正样本：健康工作树签发租约并毫秒级通过 preflight（exit 0）', stampRes.exitCode === 0 && okRes.exitCode === 0 && okRes.preflight.code === 'PREFLIGHT_OK');

    const missingRes = cmdPreflight(join(base, 'wiped-after-hibernation'), {});
    t('必红样本 1：休眠清空工作树目录立即触发 78 熔断停机令（WORKTREE_EXPIRED）', missingRes.exitCode === 78 && missingRes.stdout.includes('WORKTREE_EXPIRED') && missingRes.stdout.includes('严禁自行扫描系统目录'));

    const brokenWt = join(base, 'broken-wt');
    mkdirSync(brokenWt, { recursive: true });
    writeFileSync(join(brokenWt, '.git'), 'gitdir: /nonexistent-parent-repo/.git/worktrees/dead\n', 'utf8');
    const brokenRes = cmdPreflight(brokenWt, {});
    t('必红样本 2：工作树 .git 指针断链立即触发 78 熔断停机令', brokenRes.exitCode === 78 && brokenRes.preflight.code === 'WORKTREE_EXPIRED');

    const mismatchRes = cmdPreflight(goodRepo, { expectBranch: 'feat/other-lane' });
    t('必红样本 3：分支串线不匹配租约立即触发 78 熔断（BRANCH_MISMATCH）', mismatchRes.exitCode === 78 && mismatchRes.preflight.code === 'BRANCH_MISMATCH');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log(bad === 0 ? '\nRESULT: PASS preflight 子代理工作树失联 1 秒熔断守卫 4 组红绿样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test')) process.exit(runRedSelfTest());
  const getOpt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const root = resolve(getOpt('--root') || process.cwd());
  const res = cmdPreflight(root, {
    stampLease: argv.includes('--stamp-lease'),
    expectBranch: getOpt('--expect-branch'),
    nodeId: getOpt('--node') || getOpt('--target-node'),
    json: argv.includes('--json')
  });
  if (res.stdout) console.log(res.stdout);
  else if (res.stderr) console.error(res.stderr);
  process.exit(res.exitCode);
}
