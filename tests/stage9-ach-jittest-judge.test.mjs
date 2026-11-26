// Stage 9：ACH 语义变异（teeth --tier ACH）、JiT 捕获测试与 RubFake 过滤（catch）、门 5 多模型共识投票与半形式化推理单测
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { cmdCatch, tachFilterCatchingTest } from '../runner/core/teeth-ach.mjs';
import { vcAggregateVoteFiles, vcBuildEscapesRegressionBundle, vcValidateSemiFormalProof } from '../runner/core/verify-consensus.mjs';
import { cmdVerifyApply, cmdVerifyPack } from '../runner/core/cmd-handover-verify.mjs';
import { sha256 } from '../skill/hash.mjs';

function gitIn(dir, args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
}

function setupContractGitRepo(tmp) {
  gitIn(tmp, ['init', '-q']);
  gitIn(tmp, ['config', 'user.email', 'test@local']);
  gitIn(tmp, ['config', 'user.name', 'Test']);
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(join(tmp, 'src', 'calc.mjs'), 'export function add(a, b) { return a + b; }\n', 'utf8');
  writeFileSync(join(tmp, 'src', 'calc.check.mjs'), [
    "import { add } from './calc.mjs';",
    'if (add(2, 3) !== 5) process.exit(1);',
    'if (add(0, 0) !== 0) process.exit(1);',
    'console.log("CALC_OK");'
  ].join('\n') + '\n', 'utf8');
  expect(dispatchCommand(['init'], tmp).exitCode).toBe(0);
  gitIn(tmp, ['config', 'core.hooksPath', '.git/hooks']);
  writeFileSync(join(tmp, '.gitignore'), '.donegate/\n', 'utf8');
  expect(dispatchCommand(['contract', 'new', 'calc', '--title', '计算器', '--why', '确保加法正确', '--scope', 'src/calc.mjs'], tmp).exitCode).toBe(0);

  const cPath = join(tmp, 'contracts', 'calc', 'contract.json');
  const doc = JSON.parse(readFileSync(cPath, 'utf8'));
  doc.obligations = [
    {
      id: 'calc-c01',
      kind: 'command',
      command: 'node src/calc.check.mjs',
      expect: { exitCode: 0, stdoutMatches: 'CALC_OK' },
      required: true,
      claim: 'add(2,3) 返回 5',
      observable: 'stdout 含 CALC_OK 且退出 0',
      scope: 'src/calc.mjs'
    }
  ];
  writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  expect(dispatchCommand(['contract', 'freeze', 'calc', '--by', '业主'], tmp).exitCode).toBe(0);
  gitIn(tmp, ['add', '.']);
  gitIn(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'freeze baseline']);
  return cPath;
}

describe('stage9: ACH semantic mutants, JiT catching tests & multi-model judge consensus', () => {
  it('runs teeth --tier ACH semantic mutants, verifies kill & SHA-256 restore, and catches survived mutants', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage9-ach-'));
    try {
      setupContractGitRepo(tmp);
      const origHash = sha256(readFileSync(join(tmp, 'src', 'calc.mjs')));
      const killedFile = join(tmp, 'mutants-killed.json');
      writeFileSync(killedFile, JSON.stringify({
        mutants: [
          { id: 'm1', file: 'src/calc.mjs', from: 'return a + b;', to: 'return a - b;', description: '加法错写为减法' },
          { id: 'm2', file: 'src/calc.mjs', from: 'return a + b;', to: 'return a + b + 1;', description: '差一偏移错误' }
        ]
      }, null, 2), 'utf8');

      const resOk = dispatchCommand(['teeth', 'calc', 'calc-c01', '--tier', 'ACH', '--mutants', killedFile], tmp);
      expect(resOk.exitCode).toBe(0);
      expect(resOk.stdout).toContain('teeth (tier ACH)');
      expect(sha256(readFileSync(join(tmp, 'src', 'calc.mjs')))).toBe(origHash);

      const survivedFile = join(tmp, 'mutants-survived.json');
      writeFileSync(survivedFile, JSON.stringify({
        mutants: [
          { id: 'm3', file: 'src/calc.mjs', from: 'return a + b;', to: 'return (a + b) + 0;', description: '等价变异存活' }
        ]
      }, null, 2), 'utf8');
      const resSurv = dispatchCommand(['teeth', 'calc', 'calc-c01', '--tier', 'ACH', '--mutants', survivedFile], tmp);
      expect(resSurv.exitCode).toBe(1);
      expect(sha256(readFileSync(join(tmp, 'src', 'calc.mjs')))).toBe(origHash);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('filters RubFake catching tests and emits a Human-on-the-Loop behavior confirmation card for real catches', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage9-catch-'));
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'discount.mjs'), 'export function price(x) { return x * 0.9; }\n', 'utf8');

      const emptyRub = tachFilterCatchingTest({ code: 'const x = 1;' }, ['src/discount.mjs']);
      expect(emptyRub.ok).toBe(false);
      expect(emptyRub.code).toBe('RUBFAKE_REJECTED');

      const unrelatedRub = tachFilterCatchingTest({ code: 'import assert from "node:assert"; assert.equal(1, 1);' }, ['src/discount.mjs']);
      expect(unrelatedRub.ok).toBe(false);

      const catchFile = join(tmp, 'catch-discount.mjs');
      writeFileSync(catchFile, [
        "import assert from 'node:assert/strict';",
        "import { price } from './src/discount.mjs';",
        'assert.equal(price(100), 100, "折后价从 100 变为 90");'
      ].join('\n') + '\n', 'utf8');
      const caught = cmdCatch(tmp, { testFile: catchFile, diffFiles: ['src/discount.mjs'], behavior: '100 元商品折后变为 90 元' });
      expect(caught.exitCode).toBe(1);
      expect(caught.caught).toBe(true);
      expect(caught.behaviorCard).toContain('【行为确认卡】');
      expect(caught.behaviorCard).toContain('100 元商品折后变为 90 元');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('verifies base-branch Held-Out integrity in verify pack, builds escapes regression, and aggregates --votes with semi-formal proofs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage9-judge-'));
    try {
      const cPath = setupContractGitRepo(tmp);
      const baseSha = gitIn(tmp, ['rev-parse', 'HEAD']).stdout.trim();
      writeFileSync(join(tmp, 'src', 'calc.mjs'), 'export function add(a, b) { return Number(a) + Number(b); }\n', 'utf8');
      writeFileSync(join(tmp, 'escapes.jsonl'), JSON.stringify({ id: 'esc-1', symptom: 'NaN 未拦截', rootCause: '缺少类型转换', independentGate: 'calc-c01' }) + '\n', 'utf8');
      gitIn(tmp, ['add', '.']);
      gitIn(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'impl update']);
      expect(gitIn(tmp, ['status', '--porcelain']).stdout.trim()).toBe('');

      const chkRes = dispatchCommand(['check', 'calc', '--skip-gates'], tmp);
      expect(chkRes.exitCode, chkRes.stderr || chkRes.stdout).toBe(0);
      const packRes = cmdVerifyPack(tmp, { id: 'calc', base: baseSha, escapesRegression: true });
      expect(packRes.exitCode).toBe(0);
      expect(packRes.escapesRegression.count).toBe(1);
      expect(existsSync(packRes.escapesRegression.path)).toBe(true);

      const goodProof = { premise: 'add 转换入参为 Number', executionTrace: 'add(2,3) -> Number(2)+Number(3) -> 5', conclusion: '满足 calc-c01' };
      expect(vcValidateSemiFormalProof('V1', { verdict: 'pass', proof: goodProof }).ok).toBe(true);
      expect(vcValidateSemiFormalProof('V1', { verdict: 'pass', proof: { premise: 'only premise' } }).ok).toBe(false);

      const v1 = join(tmp, 'v1.json');
      const v2 = join(tmp, 'v2.json');
      const v3 = join(tmp, 'v3.json');
      const v4 = join(tmp, 'v4.json');
      const makeVote = (judge, v2Res) => ({
        contractId: 'calc',
        judge,
        V1: { verdict: 'pass', proof: goodProof },
        V2: { verdict: v2Res, reason: v2Res === 'fail' ? '边界未覆盖' : '定位准确' },
        V3: 'pass',
        V4: 'pass',
        V5: 'pass'
      });
      writeFileSync(v1, JSON.stringify(makeVote('claude-judge', 'pass')), 'utf8');
      writeFileSync(v2, JSON.stringify(makeVote('gemini-judge', 'pass')), 'utf8');
      writeFileSync(v3, JSON.stringify(makeVote('deepseek-judge', 'fail')), 'utf8');
      writeFileSync(v4, JSON.stringify(makeVote('extra-judge', 'pass')), 'utf8');

      const overCap = vcAggregateVoteFiles(tmp, [v1, v2, v3, v4]);
      expect(overCap.ok).toBe(false);
      expect(overCap.exitCode).toBe(3);

      const applyPass = cmdVerifyApply(tmp, { packDir: packRes.packDir, votes: `${v1},${v2},${v3}` });
      expect(applyPass.exitCode).toBe(0);

      const reg = vcBuildEscapesRegressionBundle(tmp, 'calc');
      expect(reg.count).toBe(1);

      // Tamper frozen contract in working branch -> verify pack must exit 2
      const tampered = JSON.parse(readFileSync(cPath, 'utf8'));
      tampered.obligations[0].command = 'node -e "console.log(\'CALC_OK\')"';
      writeFileSync(cPath, JSON.stringify(tampered, null, 2) + '\n', 'utf8');
      const packTampered = cmdVerifyPack(tmp, { id: 'calc', base: baseSha });
      expect(packTampered.exitCode).toBe(2);
      expect(packTampered.code).toBe('HELDOUT_CONTRACT_TAMPERED');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
