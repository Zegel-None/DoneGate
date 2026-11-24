import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { EXIT_WORKTREE_EXPIRED } from '../skill/preflight-subagent.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Stage 4 · 子代理工作树失联 1 秒熔断守卫 (preflight) 与 V4.2 协议对齐', () => {
  it('donegate preflight 支持租约签发、健康通过及休眠清空/断链/串分支时精准返回 78 熔断退出码', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s4-pf-'));
    try {
      const wtGood = join(tmp, 'wt-good');
      mkdirSync(join(wtGood, 'src'), { recursive: true });
      writeFileSync(join(wtGood, '.gitignore'), '.donegate/\n');
      writeFileSync(join(wtGood, 'src/a.mjs'), 'export const x = 1;\n');
      spawnSync('git', ['-C', wtGood, 'init', '-q', '-b', 'feat/card-a']);
      spawnSync('git', ['-C', wtGood, 'config', 'user.email', 'pf@local']);
      spawnSync('git', ['-C', wtGood, 'config', 'user.name', 'PF']);
      spawnSync('git', ['-C', wtGood, 'add', '.']);
      spawnSync('git', ['-C', wtGood, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);

      const rStamp = dispatchCommand(['preflight', '--stamp-lease', '--expect-branch', 'feat/card-a'], wtGood);
      expect(rStamp.exitCode).toBe(0);

      mkdirSync(join(wtGood, 'contracts/c1'), { recursive: true });
      writeFileSync(join(wtGood, 'contracts/c1/contract.json'), JSON.stringify({ id: 'c1', scope: ['src/'], obligations: [] }));
      const rNodeAlias1 = dispatchCommand(['preflight', '--node', 'c1', '--json'], wtGood);
      const rNodeAlias2 = dispatchCommand(['preflight', '--target-node', 'c1', '--json'], wtGood);
      expect(rNodeAlias1.exitCode).toBe(0);
      expect(rNodeAlias2.exitCode).toBe(0);
      expect(JSON.parse(rNodeAlias1.stdout).nodeId).toBe('c1');
      expect(JSON.parse(rNodeAlias2.stdout).nodeId).toBe('c1');
      const rOk = dispatchCommand(['preflight', '--json'], wtGood);
      expect(rOk.exitCode).toBe(0);
      const parsedOk = JSON.parse(rOk.stdout);
      expect(parsedOk.code).toBe('PREFLIGHT_OK');
      expect(parsedOk.hasLease).toBe(true);

      const rWrongBranch = dispatchCommand(['preflight', '--expect-branch', 'feat/card-b'], wtGood);
      expect(rWrongBranch.exitCode).toBe(EXIT_WORKTREE_EXPIRED);
      expect(rWrongBranch.stdout).toContain('BRANCH_MISMATCH');

      const rMissing = dispatchCommand(['preflight'], join(tmp, 'vanished-worktree'));
      expect(rMissing.exitCode).toBe(EXIT_WORKTREE_EXPIRED);
      expect(rMissing.stdout).toContain('WORKTREE_EXPIRED');
      expect(rMissing.stdout).toContain('严禁自行扫描系统目录');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('AGENTS.md 已完整记载 preflight、lint-edit、impact 与伴生子模块零摩擦规范', () => {
    const agentsMd = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('preflight');
    expect(agentsMd).toContain('lint-edit');
    expect(agentsMd).toContain('impact');
    expect(agentsMd).toContain('WORKTREE_EXPIRED');
    if (existsSync(join(REPO_ROOT, 'skill/03-子代理派工模板.md'))) {
      const tpl = readFileSync(join(REPO_ROOT, 'skill/03-子代理派工模板.md'), 'utf8');
      expect(tpl).toContain('V4.2');
      expect(tpl).toContain('lint-edit');
      expect(tpl).toContain('preflight');
    }
  });
});
