// Stage 14 测试：OpenSpec 双轨探索态（track=explore）、TTL 过期、交付拒收与 contract promote 一键晋升冻结
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeProjectStatus } from '../runner/core/contract.mjs';
import { cmdCheck, cmdContractNew, cmdContractPromote, cmdInit } from '../runner/core/commands-a.mjs';
import { cmdVerifyPack } from '../runner/core/commands-b.mjs';
import { validateContractSchema } from '../skill/schema-lite.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function makeTempGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-s14-explore-'));
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'dev@local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Dev']);
  cmdInit(dir);
  spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', '.git/hooks']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  return dir;
}

describe('Stage 14: OpenSpec 双轨探索态与 Golden Master 晋升闭环', () => {
  it('支持 contract new --explore 免重签高频试跑，但 status/verify pack 严禁计入交付通过', () => {
    const dir = makeTempGitRepo();
    try {
      const created = cmdContractNew(dir, {
        id: 'com-spike',
        title: 'SolidWorks COM 早期探索',
        scope: 'src/sw/',
        explore: true,
        ttlDays: 7,
        golden: 'tests/snapshots/ir_v1.json'
      });
      expect(created.exitCode).toBe(0);
      expect(created.stdout).toContain('track=explore');

      const cPath = join(dir, 'contracts', 'com-spike', 'contract.json');
      const doc = JSON.parse(readFileSync(cPath, 'utf8'));
      expect(doc.track).toBe('explore');
      expect(doc.exploreMeta.goldenSnapshots).toEqual(['tests/snapshots/ir_v1.json']);

      // 探索态允许极简判据高频修改，免 11 字段与免重签
      doc.obligations = [{ id: 'ob-golden', kind: 'command', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 } }];
      writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      expect(validateContractSchema(doc, { full: true })).toEqual([]);

      // 脏工作区也可直接跑探索实验，但收据标记 gate4Eligible=false
      const chk = cmdCheck(dir, { id: 'com-spike', explore: true });
      expect(chk.exitCode).toBe(0);
      expect(chk.stdout).toContain('探索态试跑');

      // 总账永不计入交付通过（ledger.A === 0, cleared === false）
      const st = computeProjectStatus(dir);
      const sum = st.contractSummaries.find((x) => x.id === 'com-spike');
      expect(sum.lifecycleState).toBe('EXPLORING');
      expect(sum.state).toBe('探索中');
      expect(sum.cleared).toBe(false);
      expect(st.ledger.A).toBe(0);

      // verify pack 强制拒收探索态契约（退 2）
      const pack = cmdVerifyPack(dir, { id: 'com-spike' });
      expect(pack.exitCode).toBe(2);
      expect(pack.code).toBe('EXPLORE_CONTRACT_NOT_DELIVERABLE');

      // 超过 TTL 立即切换为 EXPLORE_EXPIRED
      doc.exploreMeta.expiresAt = '2020-01-01T00:00:00.000Z';
      writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      const stExp = computeProjectStatus(dir);
      expect(stExp.contractSummaries.find((x) => x.id === 'com-spike').lifecycleState).toBe('EXPLORE_EXPIRED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('contract promote --by <人类> 将探索态一键晋升冻结为交付契约，并拦截 AI 代签', () => {
    const dir = makeTempGitRepo();
    try {
      cmdContractNew(dir, { id: 'ir-spike', title: 'IR Schema 探索', scope: 'src/ir/', explore: true });
      const cPath = join(dir, 'contracts', 'ir-spike', 'contract.json');
      const doc = JSON.parse(readFileSync(cPath, 'utf8'));
      doc.obligations = [{
        id: 'ob-ir-1',
        kind: 'command',
        command: 'node -e "process.exit(0)"',
        expect: { exitCode: 0 },
        required: true,
        claim: 'IR 导出结构通过校验',
        observable: '退出码为 0',
        scope: '仅覆蓋静态 IR Schema',
        inputClasses: ['正常'],
        servesSuccessCriterion: '（请填写至少一条可外部观察的成功判据）'
      }];
      writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');

      // AI 代签必须拦截
      const badPromo = cmdContractPromote(dir, { id: 'ir-spike', by: 'claude' });
      expect(badPromo.exitCode).toBe(1);

      // 人类签字一键晋升冻结
      const okPromo = spawnSync(process.execPath, [
        join(REPO_ROOT, 'runner/donegate.mjs'), 'contract', 'promote', 'ir-spike', '--by', '张工', '--root', dir
      ], { encoding: 'utf8' });
      expect(okPromo.status).toBe(0);
      expect(okPromo.stdout).toContain('晋升为正式交付契约');

      const promoted = JSON.parse(readFileSync(cPath, 'utf8'));
      expect(promoted.track).toBe('delivery');
      expect(promoted.provisional).toBe(false);
      expect(promoted.obligations[0].signedBy).toBe('张工');
      expect(promoted.obligations[0].frozenHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
