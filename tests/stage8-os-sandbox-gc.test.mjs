// Stage 8：可选 OS 级沙箱策略与 Windows Alpha 软降级、Worktree Held-Out 只读快照、可逆分级与 Autopilot GC 巡检单测
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aosBuildSandboxPolicy, wrapCommandWithOsSandbox } from '../runner/dsh/autopilot/autopilot-os-sandbox.mjs';
import { runAutopilotGcAudit } from '../runner/dsh/autopilot/autopilot-gc.mjs';
import { cleanGitEnv, finalizeAutopilotWorktree, prepareAutopilotWorktree } from '../runner/dsh/autopilot/autopilot-worktree.mjs';
import {
  AUTOPILOT_REVERSIBILITY_TIERS,
  buildMorningBriefMarkdown,
  classifyHumanGateReversibility
} from '../runner/dsh/autopilot/autopilot-state.mjs';
import { verifyHeldOutContract } from '../runner/core/heldout-verifier.mjs';
import { frozenHashOf } from '../skill/hash.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('stage8: optional OS sandbox, Held-Out worktree snapshot, reversibility tiers & GC audit', () => {
  it('builds scope-locked sandbox policy, soft-degrades on win32/missing srt, and hard-blocks under --strict-sandbox', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage8-srt-'));
    try {
      const policy = aosBuildSandboxPolicy(tmp, { allowedWriteScopes: ['src/billing/'], allowNetwork: false });
      expect(policy.network.enabled).toBe(false);
      expect(policy.filesystem.deniedWritePaths).toContain('contracts/');
      expect(policy.filesystem.deniedWritePaths).toContain('skill/');
      expect(policy.filesystem.writablePaths[0]).toContain('src/billing');

      const soft = wrapCommandWithOsSandbox(tmp, 'node -e "process.exit(0)"', {
        simulateMissing: true,
        platform: 'win32',
        env: { PATH: '/usr/bin', DONEGATE_SESSION_TOKEN: 'secret-token' }
      });
      expect(soft.ok).toBe(true);
      expect(soft.mode).toBe('worktree-soft-degrade');
      expect(soft.degraded).toBe(true);
      expect(soft.warning).toContain('Alpha');
      expect(soft.env.DONEGATE_SESSION_TOKEN).toBeUndefined();

      const strictBlocked = wrapCommandWithOsSandbox(tmp, 'node -e "process.exit(0)"', {
        simulateMissing: true,
        strict: true
      });
      expect(strictBlocked.ok).toBe(false);
      expect(strictBlocked.exitCode).toBe(3);
      expect(strictBlocked.code).toBe('OS_SANDBOX_REQUIRED');

      const activeSrt = wrapCommandWithOsSandbox(tmp, 'node app.mjs', {
        mockBinPath: '/usr/local/bin/srt',
        platform: 'linux',
        runId: 'run-srt-1'
      });
      expect(activeSrt.ok).toBe(true);
      expect(activeSrt.mode).toBe('os-sandbox-srt');
      expect(existsSync(activeSrt.policyPath)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('snapshots read-only Held-Out contracts on prepareAutopilotWorktree and catches worktree tampering', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage8-wt-'));
    try {
      mkdirSync(join(tmp, 'contracts', 'pay'), { recursive: true });
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const ob = {
        id: 'pay-c01', kind: 'command', command: 'node -e "process.exit(0)"',
        expect: { exitCode: 0 }, required: true, signedBy: 'owner',
        claim: '支付校验', observable: 'exit 0', scope: 'src/pay.mjs'
      };
      ob.frozenHash = frozenHashOf(ob);
      const contract = { id: 'pay', title: '支付', why: '防错扣', scope: ['src/pay.mjs'], obligations: [ob] };
      writeFileSync(join(tmp, 'contracts', 'pay', 'contract.json'), JSON.stringify(contract, null, 2));
      writeFileSync(join(tmp, 'src', 'pay.mjs'), 'export const pay = () => true;\n');
      writeFileSync(join(tmp, '.gitignore'), '.donegate/\n');

      const g = (args) => spawnSync('git', ['-C', tmp, ...args], { env: cleanGitEnv(), encoding: 'utf8', windowsHide: true });
      g(['init', '-q']);
      g(['config', 'user.email', 't@local']);
      g(['config', 'user.name', 'T']);
      g(['add', '.']);
      g(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

      const wt = prepareAutopilotWorktree(tmp, 'run-ho-1');
      expect(wt.ok).toBe(true);
      expect(wt.heldOutSnapshotDir).toBeTruthy();
      expect(existsSync(join(wt.heldOutSnapshotDir, 'pay', 'contract.json'))).toBe(true);

      const tampered = { ...contract, obligations: [{ ...ob, command: 'node -e "console.log(1)"' }] };
      const checkTamper = verifyHeldOutContract(tmp, tampered, { heldOutDir: wt.heldOutSnapshotDir });
      expect(checkTamper.ok).toBe(false);
      expect(checkTamper.exitCode).toBe(2);
      expect(checkTamper.code).toBe('HELDOUT_CONTRACT_TAMPERED');

      finalizeAutopilotWorktree(tmp, wt, 'COMPLETED', 'run-ho-1');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('classifies human gate reversibility tiers in morning brief and generates GC-REPORT.md', () => {
    expect(classifyHumanGateReversibility({ title: '不可逆数据库迁移上线闸门' })).toBe(AUTOPILOT_REVERSIBILITY_TIERS.IRREVERSIBLE);
    expect(classifyHumanGateReversibility({ title: '本地文档排版抽查' })).toBe(AUTOPILOT_REVERSIBILITY_TIERS.REVERSIBLE);

    const brief = buildMorningBriefMarkdown({
      runId: 'r-brief',
      packName: '发布流',
      state: 'SUSPENDED_HUMAN_GATE',
      passedGates: 2,
      totalGates: 3,
      completedNodes: [],
      updatedAt: '2026-11-26T00:00:00Z',
      pendingHumanGate: { nodeId: 'hg-1', title: '生产环境上线闸门', prompt: '确认灰度指标' }
    });
    expect(brief).toContain('不可逆操作');
    expect(brief).toContain('irreversible');

    const tmpOut = mkdtempSync(join(tmpdir(), 'dg-stage8-gc-'));
    try {
      const reportFile = join(tmpOut, 'GC-REPORT.md');
      const gc = runAutopilotGcAudit(REPO_ROOT, { outPath: reportFile });
      expect(gc.ok).toBe(true);
      expect(gc.exitCode).toBe(0);
      expect(existsSync(reportFile)).toBe(true);
      expect(readFileSync(reportFile, 'utf8')).toContain('Autopilot GC');
    } finally {
      rmSync(tmpOut, { recursive: true, force: true });
    }
  });
});
