// 旁路检查层（按场景跑，不进十二条）：砖头 3 批硬淘汰制与 J3 过程信号旁注。
// 用法：
//   node skill/check-brick-liveness.mjs                    默认：自带夹具自检
//   node skill/check-brick-liveness.mjs --root <项目根>    核验 ledger.json 与 batches.jsonl
// 退出码（§八 四值）：0 全部砖头在 3 批内有动作变化（或尚无砖头）/ 1 存在连续 3 批 actionsChanged===0 应拔除砖头 / 2 账本结构损坏 / 3 缺失或不可读。
//
// 诚实边界：只按 ledger.json 的 wiredAtBatch 与 batches.jsonl 批次数判定是否应强制拔除；不独立核验 actionsChanged 是否虚报。

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJsonStrict, readText } from './io.mjs';

const LIVE_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function evaluateBrickLiveness(projectRoot) {
  const ledgerPath = join(projectRoot, 'ledger.json');
  const batchesPath = join(projectRoot, 'batches.jsonl');
  const lRes = readJsonStrict(ledgerPath);
  if (!lRes.ok) return { exitCode: lRes.error === 'parse' ? 2 : 3, reason: 'ledger.json 读不出或损坏' };
  const bricks = lRes.value && lRes.value.bricks;
  if (!Array.isArray(bricks)) return { exitCode: 2, reason: 'ledger.json 缺少 bricks 数组' };

  const bRes = readText(batchesPath);
  if (!bRes.ok) return { exitCode: 3, reason: 'batches.jsonl 读不出' };
  const batchLines = bRes.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const currentBatch = batchLines.length;

  // J3 过程信号统计：汇总 .donegate/adapters/*/claim.json 中的 unresolved 计数
  let unresolvedTotal = 0;
  const adpRoot = join(projectRoot, '.donegate', 'adapters');
  if (existsSync(adpRoot)) {
    for (const e of readdirSync(adpRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const cRes = readJsonStrict(join(adpRoot, e.name, 'claim.json'));
      if (cRes.ok && cRes.value && Array.isArray(cRes.value.unresolved)) {
        unresolvedTotal += cRes.value.unresolved.length;
      }
    }
  }

  const deadBricks = [];
  for (const b of bricks) {
    if (!b || typeof b.brick !== 'string' || !Number.isInteger(b.wiredAtBatch) || !Number.isInteger(b.actionsChanged)) {
      return { exitCode: 2, reason: 'ledger.json 条目缺少合法 brick / wiredAtBatch / actionsChanged' };
    }
    const elapsed = currentBatch - b.wiredAtBatch;
    if (elapsed >= 3 && b.actionsChanged === 0) {
      deadBricks.push({ brick: b.brick, elapsed, wiredAtBatch: b.wiredAtBatch });
    }
  }

  return {
    exitCode: deadBricks.length > 0 ? 1 : 0,
    currentBatch,
    brickCount: bricks.length,
    deadBricks,
    j3Note: `J3 旁注：不稳定栏计数=0 + unresolved 计数=${unresolvedTotal}`
  };
}

function runLivenessSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'liveness-'));
  let failsCount = 0;
  const assertLiveness = (name, cond) => { console.log('  ' + (cond ? '✓' : '✗') + ' ' + name); if (!cond) failsCount++; };
  try {
    const d1 = join(tmp, 'empty');
    mkdirSync(d1);
    writeFileSync(join(d1, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks: [] }));
    writeFileSync(join(d1, 'batches.jsonl'), '');
    assertLiveness('空台账 → 退 0', evaluateBrickLiveness(d1).exitCode === 0);

    const d2 = join(tmp, 'alive');
    mkdirSync(d2);
    writeFileSync(join(d2, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks: [{ brick: 'stryker', wiredAtBatch: 1, actionsChanged: 1 }] }));
    writeFileSync(join(d2, 'batches.jsonl'), '{"batch":1}\n{"batch":2}\n{"batch":3}\n{"batch":4}\n');
    assertLiveness('3 批内 actionsChanged>0 → 退 0', evaluateBrickLiveness(d2).exitCode === 0);

    const d3 = join(tmp, 'dead');
    mkdirSync(d3);
    writeFileSync(join(d3, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks: [{ brick: 'dead-brick', wiredAtBatch: 1, actionsChanged: 0 }] }));
    writeFileSync(join(d3, 'batches.jsonl'), '{"batch":1}\n{"batch":2}\n{"batch":3}\n{"batch":4}\n');
    const rDead = evaluateBrickLiveness(d3);
    assertLiveness('满 3 批且 actionsChanged===0 强制拔除 → 退 1', rDead.exitCode === 1 && rDead.deadBricks[0].brick === 'dead-brick');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failsCount === 0 ? '\nRESULT: PASS 3 批硬淘汰自检全过' : `\nRESULT: FAIL ${failsCount} 项未过`);
  return failsCount === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rIdx = argv.indexOf('--root');
  if (rIdx >= 0) {
    const root = resolve(argv[rIdx + 1] || LIVE_REPO);
    const out = evaluateBrickLiveness(root);
    if (out.exitCode === 0) {
      console.log(`bricks=${out.brickCount}, batches=${out.currentBatch} | ${out.j3Note}`);
      console.log('RESULT: PASS 砖头活跃度符合 3 批淘汰制');
    } else if (out.exitCode === 1) {
      console.log(`需强制拔除的无效砖头：${out.deadBricks.map((d) => `${d.brick}(已跑${d.elapsed}批/0改动)`).join('、')} | ${out.j3Note}`);
      console.log('RESULT: FAIL 存在连续 3 批未改变动作的砖头');
    } else {
      console.error(out.reason);
      console.log(`RESULT: ${out.exitCode === 3 ? '无法判断' : 'FAIL'} ${out.reason}`);
    }
    process.exit(out.exitCode);
  }
  process.exit(runLivenessSelfTest());
}
