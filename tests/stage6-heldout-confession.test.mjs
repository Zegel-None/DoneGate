// Stage 6 单测：Base-Branch Held-Out 判据防篡改、守门资产保护、ConfessionReport 自首单与 --compact 紧凑输出
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { frozenHashOf } from '../skill/hash.mjs';
import { hvBuildConfessionReport, verifyHeldOutContract } from '../runner/core/heldout-verifier.mjs';
import { evaluateGate2 } from '../runner/core/gate-checks.mjs';
import { cmdCheckNode } from '../runner/core/node-micro-gate.mjs';
import { cmdCheck } from '../runner/core/cmd-execute.mjs';

function runGitIn(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

function makeBaseContract(cmd = 'node -e "process.exit(0)"') {
  const ob = {
    id: 'crit-1',
    kind: 'command',
    command: cmd,
    expect: { exitCode: 0 },
    required: true,
    signedBy: 'owner-alice',
    claim: '返回 0',
    observable: 'exit 0',
    scope: 'src/app.mjs',
    inputClasses: ['正常', '边界', '异常']
  };
  ob.frozenHash = frozenHashOf(ob);
  return {
    id: 'demo-card',
    title: '演示卡',
    why: '测试 Held-Out 校核',
    scope: ['src/app.mjs'],
    owner: 'owner-alice',
    obligations: [ob]
  };
}

describe('Stage 6 · Base-Branch Held-Out 判据校核 + ConfessionReport + --compact', () => {
  it('拦截分支内未重签篡改判据命令或删除判据（退 2 HELDOUT_CONTRACT_TAMPERED）及只读镜像校验', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s6-heldout-'));
    try {
      mkdirSync(join(tmp, 'contracts/demo-card'), { recursive: true });
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const baseContract = makeBaseContract('node -e "process.exit(0)"');
      writeFileSync(join(tmp, 'contracts/demo-card/contract.json'), JSON.stringify(baseContract, null, 2));
      writeFileSync(join(tmp, 'src/app.mjs'), 'export const v = 1;\n');
      runGitIn(tmp, ['init', '-q', '-b', 'main']);
      runGitIn(tmp, ['config', 'user.email', 't@local']);
      runGitIn(tmp, ['config', 'user.name', 'T']);
      runGitIn(tmp, ['add', '.']);
      runGitIn(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base']);

      // 切分支弱化判据且伪造 AI 自签
      runGitIn(tmp, ['checkout', '-q', '-b', 'feat/tamper']);
      const tampered = makeBaseContract('node -e "console.log(1)"');
      tampered.obligations[0].signedBy = 'claude-writer';
      tampered.obligations[0].frozenHash = frozenHashOf(tampered.obligations[0]);
      writeFileSync(join(tmp, 'contracts/demo-card/contract.json'), JSON.stringify(tampered, null, 2));

      const hv = verifyHeldOutContract(tmp, tampered, { baseRef: 'main' });
      expect(hv.ok).toBe(false);
      expect(hv.exitCode).toBe(2);
      expect(hv.code).toBe('HELDOUT_CONTRACT_TAMPERED');

      const g2 = evaluateGate2(tmp, tampered, { baseRef: 'main' });
      expect(g2.ok).toBe(false);
      expect(g2.exitCode).toBe(2);

      const cn = cmdCheckNode(tmp, { id: 'demo-card', base: 'main', allowDirty: true, receipt: true });
      expect(cn.exitCode).toBe(2);
      expect(cn.stdout).toContain('HELDOUT_CONTRACT_TAMPERED');

      // 外部只读镜像目录同样拦截删除判据
      const mirror = join(tmp, '.heldout-mirror');
      mkdirSync(join(mirror, 'demo-card'), { recursive: true });
      writeFileSync(join(mirror, 'demo-card/contract.json'), JSON.stringify(baseContract, null, 2));
      const deletedOb = { ...baseContract, obligations: [] };
      const hvMirror = verifyHeldOutContract(tmp, deletedOb, { heldOutDir: mirror });
      expect(hvMirror.ok).toBe(false);
      expect(hvMirror.exitCode).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('非 gate-tooling 契约修改 .githooks 或 skill/check-*.mjs 直接退 2，且 ConfessionReport 正确写入回执', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s6-confess-'));
    try {
      mkdirSync(join(tmp, 'contracts/demo-card'), { recursive: true });
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const baseContract = makeBaseContract('node -e "process.exit(0)"');
      writeFileSync(join(tmp, 'contracts/demo-card/contract.json'), JSON.stringify(baseContract, null, 2));
      writeFileSync(join(tmp, 'src/app.mjs'), 'export const v = 1;\n');

      const gateBlock = verifyHeldOutContract(tmp, baseContract, { touchedFiles: ['.githooks/pre-commit'] });
      expect(gateBlock.ok).toBe(false);
      expect(gateBlock.exitCode).toBe(2);
      expect(gateBlock.code).toBe('HELDOUT_GATE_TAMPERED');

      const confession = hvBuildConfessionReport({
        untestedEdges: ['断网超时分支'],
        assumptions: ['本地磁盘可写'],
        shortcutRisk: 'low'
      }, 'seed');
      expect(confession.untestedEdges).toEqual(['断网超时分支']);
      expect(confession.evidenceHash).toHaveLength(16);

      const res = cmdCheckNode(tmp, {
        id: 'demo-card',
        allowDirty: true,
        confession: JSON.stringify({ untestedEdges: ['极端大文件'], assumptions: ['UTF-8'], shortcutRisk: 'low' })
      });
      expect(res.exitCode).toBe(0);
      expect(res.receipt.confession.untestedEdges).toEqual(['极端大文件']);
      expect(res.receipt.confession.shortcutRisk).toBe('low');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('cmdCheck --compact 输出 ≤ 20 行并在失败时落盘可 grep 的 ERROR: log= 路径', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s6-compact-'));
    try {
      mkdirSync(join(tmp, 'contracts/demo-card'), { recursive: true });
      mkdirSync(join(tmp, 'src'), { recursive: true });
      const badContract = makeBaseContract('node -e "console.error(\'BOOM_DETAIL\'); process.exit(1)"');
      writeFileSync(join(tmp, 'contracts/demo-card/contract.json'), JSON.stringify(badContract, null, 2));
      writeFileSync(join(tmp, 'src/app.mjs'), 'export const v = 1;\n');

      const res = cmdCheck(tmp, { id: 'demo-card', skipGates: true, allowDirty: true, compact: true });
      expect(res.exitCode).toBe(1);
      const outLines = res.stdout.split(/\r?\n/);
      expect(outLines.length).toBeLessThanOrEqual(20);
      const errLine = outLines.find((l) => l.startsWith('ERROR: crit-1'));
      expect(errLine).toBeTruthy();
      const logMatch = errLine.match(/log=(\S+)/);
      expect(logMatch).toBeTruthy();
      const logContent = readFileSync(join(tmp, logMatch[1]), 'utf8');
      expect(logContent).toContain('BOOM_DETAIL');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
