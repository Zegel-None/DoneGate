import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { fileBelongsToScopes } from '../runner/core/index.mjs';
import { auditCommitDiff } from '../skill/check-commit-hygiene.mjs';

describe('Stage 2 · 契约显式文件伴生子模块自动认领与 Louvain 胶囊容量分片建议', () => {
  it('显式文件 scope 拆分为同名伴生子模块目录后：自动继承归属、不触发 C5 未认领报错、且冻结 stubHash 零漂移', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s2-comp-'));
    try {
      dispatchCommand(['init', '.'], tmp);
      writeFileSync(join(tmp, '.gitignore'), '.donegate/\nHANDOVER.md\n');
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src/order-engine.mjs'), [
        'export function computeOrderTotal(items) {',
        '  let sum = 0;',
        '  for (const item of items) sum += item.price * item.qty;',
        '  return sum;',
        '}'
      ].join('\n') + '\n');

      dispatchCommand(['contract', 'new', 'order-core', '--title', '订单计算核', '--scope', 'src/order-engine.mjs'], tmp);
      spawnSync('git', ['-C', tmp, 'init', '-q']);
      spawnSync('git', ['-C', tmp, 'config', 'user.email', 's2@local']);
      spawnSync('git', ['-C', tmp, 'config', 'user.name', 'S2']);
      spawnSync('git', ['-C', tmp, 'add', '.']);
      spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);

      const sliceBefore = dispatchCommand(['slice', 'order-core', '--freeze-stub', '--json'], tmp);
      expect(sliceBefore.exitCode).toBe(0);
      const frozenHash = sliceBefore.capsule.stubHash;

      mkdirSync(join(tmp, 'src/order-engine'), { recursive: true });
      writeFileSync(join(tmp, 'src/order-engine/line-math.mjs'), 'export function calcLineAmount(item) {\n  return item.price * item.qty;\n}\n');
      writeFileSync(join(tmp, 'src/order-engine.mjs'), [
        'import { calcLineAmount } from "./order-engine/line-math.mjs";',
        'export function computeOrderTotal(items) {',
        '  let sum = 0;',
        '  for (const item of items) sum += calcLineAmount(item);',
        '  return sum;',
        '}'
      ].join('\n') + '\n');

      expect(fileBelongsToScopes('src/order-engine/line-math.mjs', ['src/order-engine.mjs'])).toBe(true);
      expect(fileBelongsToScopes('src/other-engine/line-math.mjs', ['src/order-engine.mjs'])).toBe(false);

      spawnSync('git', ['-C', tmp, 'add', 'src/order-engine.mjs', 'src/order-engine/line-math.mjs']);
      const hygieneRes = auditCommitDiff(tmp, { budgetBypassReason: '' });
      expect(hygieneRes.exitCode).toBe(0);

      const checkNodeRes = dispatchCommand(['check-node', 'order-core', '--allow-dirty', '--json'], tmp);
      expect(checkNodeRes.exitCode).toBe(0);
      expect(checkNodeRes.receipt.stubHash).toBe(frozenHash);
      expect(checkNodeRes.receipt.stubChanged).toBe(false);

      const sliceAfter = dispatchCommand(['slice', 'order-core', '--json'], tmp);
      expect(sliceAfter.exitCode).toBe(0);
      const zeroHopPaths = sliceAfter.capsule.zeroHopFiles.map((f) => f.path);
      expect(zeroHopPaths).toContain('src/order-engine.mjs');
      expect(zeroHopPaths).toContain('src/order-engine/line-math.mjs');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('胶囊 0-Hop 源码达高水位 (>=80%) 时基于 Louvain 模块度自动给出高内聚低耦合子契约切分建议', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s2-shard-'));
    try {
      dispatchCommand(['init', '.'], tmp);
      mkdirSync(join(tmp, 'src/big'), { recursive: true });
      const pad = '// 业务实现负载填充注释用于模拟接近容量水位的代码体积\n'.repeat(30);

      writeFileSync(join(tmp, 'src/big/auth-token.mjs'), `${pad}export const signTok = (u) => u;\n`);
      writeFileSync(join(tmp, 'src/big/auth-session.mjs'), `import { signTok } from "./auth-token.mjs";\n${pad}export const openSes = (u) => signTok(u);\n`);
      writeFileSync(join(tmp, 'src/big/bill-tax.mjs'), `${pad}export const calcTax = (v) => v * 0.1;\n`);
      writeFileSync(join(tmp, 'src/big/bill-invoice.mjs'), `import { calcTax } from "./bill-tax.mjs";\n${pad}export const makeInv = (v) => v + calcTax(v);\n`);

      dispatchCommand(['contract', 'new', 'monolith-card', '--title', '高负载大卡', '--scope', 'src/big/'], tmp);
      const res = dispatchCommand(['slice', 'monolith-card', '--max-tokens', '950', '--json'], tmp);
      expect(res.exitCode).toBe(0);
      const advice = res.capsule.shardAdvice;
      expect(advice).not.toBeNull();
      expect(advice.utilizationRatio).toBeGreaterThanOrEqual(0.8);
      expect(advice.recommendedShardCount).toBeGreaterThanOrEqual(2);
      expect(advice.modularityQ).toBeGreaterThan(0);
      const authCluster = advice.shards.find((s) => s.files.includes('src/big/auth-token.mjs'));
      expect(authCluster.files).toContain('src/big/auth-session.mjs');
      expect(authCluster.files).not.toContain('src/big/bill-tax.mjs');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
