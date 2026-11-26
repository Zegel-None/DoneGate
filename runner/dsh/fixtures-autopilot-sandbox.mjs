// DSH 过夜挂机长跑状态机、三重防烧钱熔断、Git Worktree 隔离沙箱与指纹免跑缓存断言夹具
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanGitEnv } from './autopilot/autopilot-worktree.mjs';
import {
  AUTOPILOT_STATES, approveAutopilotHumanGate, loadAutopilotCheckpoint
} from './autopilot/autopilot-state.mjs';
import { executeDeterministicWorkflowRun } from './autopilot/workflow-runner.mjs';

async function verifyAutopilotStateAndBreakers() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-autopilot-'));
  try {
    const counterFile = join(tmp, 'step1-count.txt');
    writeFileSync(counterFile, '0', 'utf8');
    const nightPack = {
      id: 'pack-overnight', name: '数据库迁移过夜流',
      nodes: [
        {
          id: 's1', title: '空库迁移演练',
          exec: { kind: 'adapter_gate', nodeArgs: ['-e', `const fs=require("fs");const n=Number(fs.readFileSync(${JSON.stringify(counterFile)},"utf8"))+1;fs.writeFileSync(${JSON.stringify(counterFile)},String(n));process.exit(0);`] }
        },
        { id: 's2-gate', tplId: 'tpl-human-gate', isHumanGate: true, title: '不可逆迁移上线闸门', tip: '确认备份无误后放行' },
        { id: 's3', title: '对账校验收尾', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(0)'] } }
      ],
      links: [
        { id: 'l1', fromNode: 's1', fromSlot: 'out', toNode: 's2-gate', toSlot: 'in' },
        { id: 'l2', fromNode: 's2-gate', fromSlot: 'out_go', toNode: 's3', toSlot: 'in' }
      ]
    };

    const pass1 = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-01' }, nightPack);
    assert.equal(pass1.suspended, true);
    assert.equal(pass1.state, AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE);
    assert.equal(readFileSync(counterFile, 'utf8'), '1');
    const cp1 = loadAutopilotCheckpoint(tmp, 'night-01');
    assert.ok(cp1.briefMarkdown.includes('不可逆迁移上线闸门'));

    const app = approveAutopilotHumanGate(tmp, { runId: 'night-01', by: '业主' });
    assert.equal(app.ok, true);
    const pass2 = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-01' }, nightPack, { resumeRunId: 'night-01' });
    assert.equal(pass2.ok, true);
    assert.equal(pass2.state, AUTOPILOT_STATES.COMPLETED);
    assert.equal(readFileSync(counterFile, 'utf8'), '1', '断点续跑严禁重复执行已完成的上游节点 s1');

    const loopPack = {
      id: 'pack-loop-burn', name: '死循环熔断测试流',
      nodes: [{ id: 'bad1', title: '恒败单测', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(1)'] } }],
      links: [{ id: 'self-lk', fromNode: 'bad1', fromSlot: 'out', toNode: 'bad1', toSlot: 'in', maxLoops: 2 }]
    };
    const trippedLoop = await executeDeterministicWorkflowRun(tmp, { ticketId: 'night-loop' }, loopPack);
    assert.equal(trippedLoop.ok, false);
    assert.equal(trippedLoop.code, 'MAX_LOOPS_EXCEEDED');
    assert.equal(trippedLoop.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);

    const gitDir = join(tmp, 'scoped-repo');
    mkdirSync(join(gitDir, 'src'), { recursive: true });
    mkdirSync(join(gitDir, 'secret'), { recursive: true });
    writeFileSync(join(gitDir, '.gitignore'), '.donegate/\n');
    writeFileSync(join(gitDir, 'src/ok.mjs'), 'export const x = 1;\n');
    writeFileSync(join(gitDir, 'secret/prod.env'), 'KEY=1\n');
    spawnSync('git', ['-C', gitDir, 'init', '-q'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', gitDir, 'config', 'user.email', 't@local'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', gitDir, 'config', 'user.name', 'T'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', gitDir, 'add', '.'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', gitDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { env: cleanGitEnv() });

    const scopePack = {
      id: 'pack-scope', name: '越界写拦截测试流',
      nodes: [{ id: 'rogue', title: '偷改禁区文件', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'require("fs").writeFileSync("secret/prod.env","KEY=2\\n");process.exit(0);'] } }],
      links: []
    };
    const trippedScope = await executeDeterministicWorkflowRun(gitDir, { ticketId: 'night-scope', mandate: { allowedWriteScopes: ['src/'] } }, scopePack);
    assert.equal(trippedScope.ok, false);
    assert.equal(trippedScope.exitCode, 2);
    assert.equal(trippedScope.code, 'WRITE_SCOPE_VIOLATION');
    assert.equal(trippedScope.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);

    const trippedDirty = await executeDeterministicWorkflowRun(gitDir, { ticketId: 'night-dirty' }, { id: 'p-clean', name: '净树检查流', nodes: [{ id: 'c1', title: '探针', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(0)'] } }], links: [] }, { requireCleanGit: true });
    assert.equal(trippedDirty.ok, false);
    assert.equal(trippedDirty.code, 'DIRTY_WORKTREE_FAULT');
    assert.equal(trippedDirty.state, AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function verifyWorktreeSandboxAndFingerprintCache() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-wt-cache-'));
  try {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(join(tmp, '.gitignore'), '.donegate/\n');
    writeFileSync(join(tmp, 'src/main.mjs'), 'export const val = 1;\n');
    spawnSync('git', ['-C', tmp, 'init', '-q'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', tmp, 'config', 'user.email', 't@local'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', tmp, 'config', 'user.name', 'T'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', tmp, 'add', '.'], { env: cleanGitEnv() });
    spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { env: cleanGitEnv() });

    // (A) Worktree 熔断测试：沙箱内污染 src/main.mjs 后触发自循环熔断 -> 主工作区必须 100% 干净零污染！
    const failWtPack = {
      id: 'pack-wt-fail', name: '沙箱脏改熔断流',
      nodes: [{
        id: 'dirty-fail', title: '改坏源码但测试不过',
        exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'require("fs").writeFileSync("src/main.mjs", "BROKEN_NIGHT_CODE\\n"); process.exit(1);'] }
      }],
      links: [{ id: 'lk-f', fromNode: 'dirty-fail', fromSlot: 'out', toNode: 'dirty-fail', toSlot: 'in', maxLoops: 1 }]
    };
    const rFail = await executeDeterministicWorkflowRun(tmp, { ticketId: 'wt-fail-01' }, failWtPack, { useWorktreeSandbox: true });
    assert.equal(rFail.ok, false);
    assert.equal(rFail.sandboxWorktree.status, 'quarantined_clean_main');
    assert.equal(readFileSync(join(tmp, 'src/main.mjs'), 'utf8'), 'export const val = 1;\n', '主工作区源码严禁被失败的过夜挂机污染');
    const mainSt = spawnSync('git', ['-C', tmp, 'status', '--porcelain'], { encoding: 'utf8', env: cleanGitEnv() });
    assert.equal(mainSt.stdout.trim(), '', '熔断后主工作区 git status 必须保持 100% 干净');

    // (B) Worktree 全绿测试：沙箱内演进源码并通过门禁 -> 自动提交并快进合回主分支且清理临时目录！
    const okWtPack = {
      id: 'pack-wt-ok', name: '沙箱全绿合入流',
      nodes: [{
        id: 'ok-edit', title: '修复并通过验收',
        exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'require("fs").writeFileSync("src/main.mjs", "export const val = 42;\\n"); process.exit(0);'] }
      }],
      links: []
    };
    const rOk = await executeDeterministicWorkflowRun(tmp, { ticketId: 'wt-ok-01' }, okWtPack, { useWorktreeSandbox: true });
    assert.equal(rOk.ok, true);
    assert.equal(rOk.sandboxWorktree.mergedToMain, true);
    assert.equal(readFileSync(join(tmp, 'src/main.mjs'), 'utf8'), 'export const val = 42;\n', '全绿挂机成果应自动快进合回主分支');

    // (C) 材料指纹免跑缓存测试：输入未变二次运行自动免跑跳过，改动输入后自动失效重跑！
    const markerPath = join(tmp, '.donegate', 'cache-runs.txt');
    const cachePack = {
      id: 'pack-fp-cache', name: '指纹免跑验证流',
      nodes: [{
        id: 'fp-node', title: '昂贵静态扫描', inputs: ['src/'],
        exec: { kind: 'adapter_gate', nodeArgs: ['-e', `const fs=require("fs"),p=${JSON.stringify(markerPath)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p,"utf8"):0)+1));process.exit(0);`] }
      }],
      links: []
    };
    const runA = await executeDeterministicWorkflowRun(tmp, { ticketId: 'fp-1' }, cachePack, { useFingerprintCache: true });
    assert.equal(runA.ok, true);
    assert.equal(runA.cacheHits, 0);
    assert.equal(readFileSync(markerPath, 'utf8'), '1');

    const runB = await executeDeterministicWorkflowRun(tmp, { ticketId: 'fp-2' }, cachePack, { useFingerprintCache: true });
    assert.equal(runB.ok, true);
    assert.equal(runB.cacheHits, 1, '源码未改动时第二次运行必须命中指纹缓存免跑');
    assert.equal(readFileSync(markerPath, 'utf8'), '1', '命中缓存时底层子进程严禁被重复拉起');

    writeFileSync(join(tmp, 'src/main.mjs'), 'export const val = 99;\n');
    const runC = await executeDeterministicWorkflowRun(tmp, { ticketId: 'fp-3' }, cachePack, { useFingerprintCache: true });
    assert.equal(runC.cacheHits, 0, '源码变更后材料指纹变化，必须自动失效并重跑真机节点');
    assert.equal(readFileSync(markerPath, 'utf8'), '2');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function runAutopilotSandboxChecks(check) {
  await check('7. 过夜挂机长跑状态机：断点续跑不重跑已完成节点、human-gate 早间简报挂起与三重防烧钱熔断', verifyAutopilotStateAndBreakers);
  await check('8. 过夜挂机 Git Worktree 零污染隔离沙箱与输入材料指纹免跑缓存', verifyWorktreeSandboxAndFingerprintCache);
}
