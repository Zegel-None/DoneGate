// 旁路检查层（按场景跑，不进十二条）：工具 3 批硬淘汰制、注册表/台账一致性、声明挂靠、J3 过程信号旁注。
// 用法：
//   node skill/check-brick-liveness.mjs                                            默认：自带夹具自检
//   node skill/check-brick-liveness.mjs --root <项目根> [--skip-contract-lookup]   核验 ledger.json、batches.jsonl、adapters.registry.json（加 --skip-contract-lookup 适配无 contracts/ 的公开仓）
// 退出码（四值规范）：0 通过 / 1 有应拔除工具、注册表台账不一致或有孤儿声明 / 2 结构损坏或 checkedBy 语法非法 / 3 材料缺失（未加 --skip-contract-lookup 且本仓无 contracts/）。
//
// 为什么要加「注册表 ↔ 台账」这一条：历史审计曾发现外部工具文档状态列与 adapters.registry.json
// 出现口径脱节（文档写冻结而注册表已入网）。这条检查把「注册表登记」与「入网记账」双向锁死：
// 只在注册表里有、或只在台账里有，一律判红（退 1），杜绝人工漏记。
//
// 诚实边界：
//   1. 只按 ledger.json 的 wiredAtBatch 与 batches.jsonl 批次数判定是否应强制拔除；不独立核验 actionsChanged 是否虚报。
//   2. 一致性只查「有没有对上」（按 registryId 与 tool 双路匹配），不判断该不该接这个工具、也不核验 stage/checkedBy 抄得对不对（那是 check-declarations 的活）。

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

function blReportDuplicates(values, prefix, issues) {
  const seen = new Set();
  const reported = new Set();
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v) && !reported.has(v)) {
      reported.add(v);
      issues.push(`${prefix}${v}`);
    }
    seen.add(v);
  }
}

function blCheckBidirectionalCoverage(adapters, bricks, issues) {
  // 双向覆盖：注册表里每一条都要在台账里有对应（按 registryId 优先，退到 tool）
  for (const a of adapters) {
    if (!a || !a.id) {
      issues.push('注册表存在缺 id 的条目');
      continue;
    }
    const hit = bricks.some((b) => b && (b.registryId === a.id || (b.registryId === undefined && b.brick === a.tool)));
    if (!hit) issues.push(`注册表有、台账无：${a.id}（tool=${a.tool || '?'}）`);
  }
  // 反向：台账里每一条都要在注册表里有对应
  for (const b of bricks) {
    if (!b || !b.brick) {
      issues.push('台账存在缺 brick 的条目');
      continue;
    }
    const hit = adapters.some((a) => a && (a.id === b.registryId || (b.registryId === undefined && a.tool === b.brick)));
    if (!hit) issues.push(`台账有、注册表无：${b.brick}（registryId=${b.registryId || '未填'}）`);
  }
}

// 注册表 ↔ 入网台账 双向一致（防「文档说冻结、注册表已入网」这类漂移）
export function evaluateRegistryLedgerConsistency(projectRoot) {
  const regRes = readJsonStrict(join(projectRoot, 'adapters.registry.json'));
  if (!regRes.ok) return { exitCode: regRes.error === 'parse' ? 2 : 3, issues: [], reason: 'adapters.registry.json 读不出或损坏' };
  const adapters = regRes.value && regRes.value.adapters;
  if (!Array.isArray(adapters)) return { exitCode: 2, issues: ['adapters.registry.json 缺少 adapters 数组'], reason: '结构损坏' };

  const lRes = readJsonStrict(join(projectRoot, 'ledger.json'));
  if (!lRes.ok) return { exitCode: lRes.error === 'parse' ? 2 : 3, issues: [], reason: 'ledger.json 读不出或损坏' };
  const bricks = lRes.value && lRes.value.bricks;
  if (!Array.isArray(bricks)) return { exitCode: 2, issues: ['ledger.json 缺少 bricks 数组'], reason: '结构损坏' };

  const issues = [];
  // 结构：注册表 id / tool 不许重复（重复会让「按 id 匹配」失去意义）
  blReportDuplicates(adapters.map((a) => a && a.id), '注册表 adapter id 重复：', issues);
  blReportDuplicates(adapters.map((a) => a && a.tool), '注册表 tool 重复：', issues);
  blReportDuplicates(bricks.map((b) => b && b.brick), '台账 brick 重复：', issues);
  blCheckBidirectionalCoverage(adapters, bricks, issues);

  return {
    exitCode: issues.length > 0 ? 1 : 0,
    issues,
    regCount: adapters.length,
    ledgerCount: bricks.length,
    reason: issues.length > 0 ? `${issues.length} 处不一致` : '双向一致'
  };
}

// 多检查汇总取最坏退出码：2（事故）> 1（判定为否）> 3（无法判断）> 0（通过）
function worstExitCode(codes) {
  for (const c of [2, 1, 3]) if (codes.includes(c)) return c;
  return 0;
}

// ── 声明挂靠（wiring）：每条 registry.checkedBy 必须解析到本仓真实契约里真实存在的判据 ──
// 为什么需要它：2026-11-20 发现 18 个工具的 checkedBy 全指向不存在的 c01/*——因为接砖时本仓还没有
// contracts/，只能照抄协议样例的占位；而核侧所有自动路径都 skipContractLookup，于是「声明没人认领」
// 在流水线里完全隐形，造成声明未挂靠判据却静默全绿。
// 这条门禁把「挂靠」变成机器可判：解析不到即红，不让新孤儿再溜进来。
//
// 三档语义（缺一档就会误伤「还没自举的用户项目」）：
//   本仓有 contracts/ 且解析不到      → 1（孤儿声明，必须接线或登记进基线）
//   本仓根本没有 contracts/           → 3（无法判断，引导期允许；不是失败）
//   checkedBy 语法非法               → 2（协议事故）
// 棘轮：`skill/wiring-baseline.json` 登记「已知欠账」，只许变少——基线里的条目一旦接线或消失，必须
// 同轮从基线删掉，否则退 1（防止基线变成永久洗白名单）。每次运行都打印欠账条数，静默豁免=没检查。
function readContractsIndex(projectRoot) {
  const cDir = join(projectRoot, 'contracts');
  if (!existsSync(cDir)) return { exists: false, map: new Map() };
  const map = new Map();
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = readJsonStrict(join(cDir, e.name, 'contract.json'));
    if (!r.ok || !r.value) continue;
    const ids = new Set((Array.isArray(r.value.obligations) ? r.value.obligations : []).map((o) => o && o.id).filter(Boolean));
    map.set(e.name, ids);
  }
  return { exists: true, map };
}

function blParseCheckedByRef(ref) {
  if (typeof ref !== 'string') return null;
  const parts = ref.split('/');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) return null;
  return parts;
}

function blCollectMalformedCheckedBy(adapters) {
  const malformed = [];
  for (const a of adapters) {
    if (!a || !a.id) continue;
    const refs = Array.isArray(a.checkedBy) ? a.checkedBy : [a.checkedBy];
    for (const ref of refs) {
      if (!blParseCheckedByRef(ref)) {
        malformed.push(`${a.id}: checkedBy 语法非法（必须 <契约id>/<判据id>）：${JSON.stringify(ref)}`);
      }
    }
  }
  return malformed;
}

function blLoadWiringBaseline(projectRoot) {
  const basePath = join(projectRoot, 'skill', 'wiring-baseline.json');
  if (!existsSync(basePath)) return { baseSet: new Set(), advMap: new Map() };
  const b = readJsonStrict(basePath);
  if (!b.ok || !b.value) {
    return { error: { exitCode: 2, issues: ['skill/wiring-baseline.json 读不出或损坏'], wired: [], pending: [], reason: '基线损坏' } };
  }
  const baseSet = new Set(Array.isArray(b.value.pending) ? b.value.pending : []);
  const advMap = new Map();
  for (const a of (Array.isArray(b.value.advisory) ? b.value.advisory : [])) {
    if (a && typeof a.id === 'string') advMap.set(a.id, typeof a.reason === 'string' ? a.reason : '');
  }
  for (const [id, reason] of advMap) {
    if (!reason.trim()) {
      return { error: { exitCode: 2, issues: [`wiring-baseline 的 advisory 条目 ${id} 没写理由（不许留空）`], wired: [], pending: [], reason: '基线不合规' } };
    }
  }
  return { baseSet, advMap };
}

function blResolveAdapterRefs(a, contractsMap, malformed) {
  const refs = Array.isArray(a.checkedBy) ? a.checkedBy : [a.checkedBy];
  const reasons = [];
  for (const ref of refs) {
    const parts = blParseCheckedByRef(ref);
    if (!parts) {
      malformed.push(`${a.id}: checkedBy 语法非法（必须 <契约id>/<判据id>）：${JSON.stringify(ref)}`);
      continue;
    }
    const [cid, oid] = parts;
    const obs = contractsMap.get(cid);
    if (!obs) reasons.push(`契约 ${cid} 不存在`);
    else if (!obs.has(oid)) reasons.push(`契约 ${cid} 里没有判据 ${oid}`);
  }
  return reasons;
}

function blAuditBaselineRatchet(baseSet, advMap, wiredSet, regIds, issues) {
  for (const id of baseSet) {
    if (wiredSet.has(id)) issues.push(`wiring-baseline 的 pending 里 ${id} 已经接线，请从基线删除（棘轮只减）`);
    else if (!regIds.has(id)) issues.push(`wiring-baseline 的 pending 里 ${id} 已不在注册表，请从基线删除`);
  }
  for (const id of advMap.keys()) {
    if (wiredSet.has(id)) issues.push(`wiring-baseline 的 advisory 里 ${id} 已经接线，自相矛盾：请从 advisory 删除`);
    else if (!regIds.has(id)) issues.push(`wiring-baseline 的 advisory 里 ${id} 已不在注册表，请删除`);
  }
}

function blClassifyUnresolvedAdapters(unresolved, baseSet, advMap, issues) {
  const pending = [];
  const advisory = [];
  for (const [id, reasons] of unresolved) {
    if (baseSet.has(id)) pending.push({ id, reasons });
    else if (advMap.has(id)) advisory.push({ id, reasons: [advMap.get(id)] });
    else issues.push(`${id}: 孤儿声明——checkedBy 解析不到真实判据（${reasons.join('；')}），且未登记进 skill/wiring-baseline.json 的 pending 或 advisory`);
  }
  return { pending, advisory };
}

function blEvaluateAdaptersAgainstContracts(adapters, contractsMap, baseSet, advMap) {
  const issues = [];
  const malformed = [];
  const wired = [];
  const unresolved = new Map();
  for (const a of adapters) {
    if (!a || !a.id) {
      issues.push('注册表存在缺 id 的条目');
      continue;
    }
    const reasons = blResolveAdapterRefs(a, contractsMap, malformed);
    if (reasons.length === 0) wired.push(a.id);
    else unresolved.set(a.id, [...new Set(reasons)]);
  }
  const { pending, advisory } = blClassifyUnresolvedAdapters(unresolved, baseSet, advMap, issues);
  const regIds = new Set(adapters.map((a) => a && a.id).filter(Boolean));
  blAuditBaselineRatchet(baseSet, advMap, new Set(wired), regIds, issues);
  return { issues, malformed, wired, pending, advisory };
}

export function evaluateBrickWiring(projectRoot, opts = {}) {
  const regRes = readJsonStrict(join(projectRoot, 'adapters.registry.json'));
  if (!regRes.ok) return { exitCode: regRes.error === 'parse' ? 2 : 3, issues: [], wired: [], pending: [], reason: 'adapters.registry.json 读不出或损坏' };
  const adapters = regRes.value && regRes.value.adapters;
  if (!Array.isArray(adapters)) return { exitCode: 2, issues: ['adapters.registry.json 缺少 adapters 数组'], wired: [], pending: [], reason: '结构损坏' };

  const earlyMalformed = blCollectMalformedCheckedBy(adapters);
  if (earlyMalformed.length > 0) {
    return { exitCode: 2, issues: earlyMalformed, wired: [], pending: [], advisory: [], total: adapters.length, reason: `${earlyMalformed.length} 处 checkedBy 语法非法` };
  }
  if (opts.skipContractLookup) {
    return { exitCode: 0, skipped: true, issues: [], wired: [], pending: [], advisory: [], total: adapters.length, reason: '零契约模式已校验 checkedBy 语法并跳过契约判据挂靠查找' };
  }
  const cIdx = readContractsIndex(projectRoot);
  if (!cIdx.exists || cIdx.map.size === 0) {
    return {
      exitCode: 3, issues: [], wired: [], pending: [], advisory: [], total: adapters.length,
      reason: '本仓没有 contracts/（或为空），无法判断 checkedBy 是否被认领；引导期允许，退 3（零契约公开仓可加 --skip-contract-lookup）'
    };
  }

  const baseLoaded = blLoadWiringBaseline(projectRoot);
  if (baseLoaded.error) return baseLoaded.error;
  const { baseSet, advMap } = baseLoaded;
  const { issues, malformed, wired, pending, advisory } = blEvaluateAdaptersAgainstContracts(adapters, cIdx.map, baseSet, advMap);

  const exitCode = malformed.length ? 2 : (issues.length ? 1 : 0);
  return {
    exitCode,
    issues: [...malformed, ...issues],
    wired, pending, advisory,
    total: adapters.length,
    baselineCount: baseSet.size,
    reason: exitCode === 0
      ? `已接线 ${wired.length} 条、欠账 ${pending.length} 条、advisory ${advisory.length} 条（欠账只许减少）`
      : `${malformed.length + issues.length} 处不合格`
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

    // 注册表 ↔ 台账 一致性：好样本必须绿，缺一边必须红（这是加这条检查时要能红的证明）
    const mkPair = (name, adapters, bricks) => {
      const d = join(tmp, name);
      mkdirSync(d);
      writeFileSync(join(d, 'adapters.registry.json'), JSON.stringify({ protocolVersion: '1.1', adapters }));
      writeFileSync(join(d, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks }));
      writeFileSync(join(d, 'batches.jsonl'), '{"batch":1}\n');
      return d;
    };
    const okPair = mkPair('pair-ok',
      [{ id: 'a@stage4', tool: 'a' }, { id: 'b@stage4', tool: 'b' }],
      [
        { brick: 'a', registryId: 'a@stage4', wiredAtBatch: 1, actionsChanged: 1 },
        { brick: 'b', registryId: 'b@stage4', wiredAtBatch: 1, actionsChanged: 1 }
      ]);
    assertLiveness('注册表与台账双向一致 → 退 0', evaluateRegistryLedgerConsistency(okPair).exitCode === 0);

    const regOnly = mkPair('pair-reg-only',
      [{ id: 'a@stage4', tool: 'a' }, { id: 'b@stage4', tool: 'b' }],
      [{ brick: 'a', registryId: 'a@stage4', wiredAtBatch: 1, actionsChanged: 1 }]);
    const rRegOnly = evaluateRegistryLedgerConsistency(regOnly);
    assertLiveness('注册表有、台账无 → 退 1（漏记账）',
      rRegOnly.exitCode === 1 && rRegOnly.issues.some((i) => i.includes('注册表有、台账无')));

    const ledgerOnly = mkPair('pair-ledger-only',
      [{ id: 'a@stage4', tool: 'a' }],
      [
        { brick: 'a', registryId: 'a@stage4', wiredAtBatch: 1, actionsChanged: 1 },
        { brick: 'ghost', registryId: 'ghost@stage4', wiredAtBatch: 1, actionsChanged: 1 }
      ]);
    const rLedgerOnly = evaluateRegistryLedgerConsistency(ledgerOnly);
    assertLiveness('台账有、注册表无 → 退 1（编造入网）',
      rLedgerOnly.exitCode === 1 && rLedgerOnly.issues.some((i) => i.includes('台账有、注册表无')));

    const brokenReg = join(tmp, 'pair-broken');
    mkdirSync(brokenReg);
    writeFileSync(join(brokenReg, 'adapters.registry.json'), JSON.stringify({ protocolVersion: '1.1', adapters: {} }));
    writeFileSync(join(brokenReg, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks: [] }));
    assertLiveness('注册表结构损坏 → 退 2', evaluateRegistryLedgerConsistency(brokenReg).exitCode === 2);

    assertLiveness('最坏退出码汇总：2 > 1 > 3 > 0', worstExitCode([0, 3, 1]) === 1 && worstExitCode([0, 3]) === 3 && worstExitCode([2, 1]) === 2 && worstExitCode([0, 0]) === 0);

    // 声明挂靠（wiring）：契约存在时 checkedBy 必须解析到真实判据；基线只许变少
    const mkWire = (name, adapters, pending, contracts, advisory) => {
      const d = join(tmp, name);
      mkdirSync(d);
      writeFileSync(join(d, 'adapters.registry.json'), JSON.stringify({ protocolVersion: '1.1', adapters }));
      writeFileSync(join(d, 'ledger.json'), JSON.stringify({ protocolVersion: '1.1', bricks: [] }));
      writeFileSync(join(d, 'batches.jsonl'), '');
      if (pending || advisory) {
        mkdirSync(join(d, 'skill'), { recursive: true });
        writeFileSync(join(d, 'skill/wiring-baseline.json'), JSON.stringify({ pending: pending || [], advisory: advisory || [] }, null, 2));
      }
      for (const [cid, oid] of (contracts || [])) {
        mkdirSync(join(d, 'contracts', cid), { recursive: true });
        writeFileSync(join(d, 'contracts', cid, 'contract.json'), JSON.stringify({ id: cid, obligations: [{ id: oid }] }));
      }
      return d;
    };
    assertLiveness('wiring：checkedBy 解析到真实判据 → 退 0',
      evaluateBrickWiring(mkWire('wire-ok', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/o1' }], null, [['c1', 'o1']])).exitCode === 0);
    assertLiveness('wiring：契约不存在 → 退 1',
      evaluateBrickWiring(mkWire('wire-bad', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c9/o9' }], null, [['c1', 'o1']])).exitCode === 1);
    assertLiveness('wiring：契约在但判据不存在 → 退 1',
      evaluateBrickWiring(mkWire('wire-bad-ob', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/nope' }], null, [['c1', 'o1']])).exitCode === 1);
    const debtRes = evaluateBrickWiring(mkWire('wire-debt', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c9/o9' }], ['a@stage4'], [['c1', 'o1']]));
    assertLiveness('wiring：已登记进基线的欠账 → 退 0 且欠账计数为 1', debtRes.exitCode === 0 && debtRes.pending.length === 1);
    assertLiveness('wiring：基线条目已接线却未删 → 退 1（棘轮只减）',
      evaluateBrickWiring(mkWire('wire-stale', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/o1' }], ['a@stage4'], [['c1', 'o1']])).exitCode === 1);
    assertLiveness('wiring：本仓无契约 → 退 3（无法判断，不判失败）',
      evaluateBrickWiring(mkWire('wire-noc', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/o1' }], null, [])).exitCode === 3);
    assertLiveness('wiring：checkedBy 语法非法 → 退 2',
      evaluateBrickWiring(mkWire('wire-mal', [{ id: 'a@stage4', tool: 'a', checkedBy: 'noslash' }], null, [['c1', 'o1']])).exitCode === 2);
    assertLiveness('wiring：advisory 里的砖未接线 → 退 0（理由必填）',
      evaluateBrickWiring(mkWire('wire-adv', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c9/o9' }], [], [['c1', 'o1']], [{ id: 'a@stage4', reason: '观测不构成判据' }])).exitCode === 0);
    assertLiveness('wiring：advisory 里的砖却已接线 → 退 1（自相矛盾）',
      evaluateBrickWiring(mkWire('wire-adv-bad', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/o1' }], [], [['c1', 'o1']], [{ id: 'a@stage4', reason: '观测不构成判据' }])).exitCode === 1);
    assertLiveness('wiring：advisory 条目没写理由 → 退 2',
      evaluateBrickWiring(mkWire('wire-adv-noreason', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c9/o9' }], [], [['c1', 'o1']], [{ id: 'a@stage4', reason: '  ' }])).exitCode === 2);
    assertLiveness('wiring：零契约模式 --skip-contract-lookup 校验语法通过 → 退 0',
      evaluateBrickWiring(mkWire('wire-noc-skip', [{ id: 'a@stage4', tool: 'a', checkedBy: 'c1/o1' }], null, []), { skipContractLookup: true }).exitCode === 0);
    assertLiveness('wiring：零契约模式下 checkedBy 语法非法仍退 2',
      evaluateBrickWiring(mkWire('wire-noc-mal', [{ id: 'a@stage4', tool: 'a', checkedBy: 'noslash' }], null, []), { skipContractLookup: true }).exitCode === 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failsCount === 0 ? '\nRESULT: PASS 3 批硬淘汰 + 注册表台账一致性 + 声明挂靠自检全过' : `\nRESULT: FAIL ${failsCount} 项未过`);
  return failsCount === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rIdx = argv.indexOf('--root');
  const skipContractLookup = argv.includes('--skip-contract-lookup');
  if (rIdx >= 0) {
    const rawRootArg = argv[rIdx + 1];
    const root = resolve(rawRootArg && !rawRootArg.startsWith('--') ? rawRootArg : LIVE_REPO);
    const live = evaluateBrickLiveness(root);
    const cons = evaluateRegistryLedgerConsistency(root);
    const wire = evaluateBrickWiring(root, { skipContractLookup });

    if (live.exitCode === 0) console.log(`bricks=${live.brickCount}, batches=${live.currentBatch} | ${live.j3Note}`);
    else if (live.exitCode === 1) console.log(`需强制拔除的无效工具：${live.deadBricks.map((d) => `${d.brick}(已跑${d.elapsed}批/0改动)`).join('、')} | ${live.j3Note}`);
    else console.error(live.reason);

    if (cons.exitCode === 0) console.log(`注册表 ↔ 台账：双向一致（注册表 ${cons.regCount} 条 / 台账 ${cons.ledgerCount} 条）`);
    else if (cons.exitCode === 1) for (const i of cons.issues) console.log(`  ✗ ${i}`);
    else console.error(cons.reason || cons.issues.join('；'));

    if (wire.exitCode === 0) {
      console.log(`声明挂靠：${wire.reason}（注册表 ${wire.total} 条）`);
      for (const p of wire.pending.slice(0, 5)) console.log(`  · 欠账 ${p.id}：${p.reasons.join('；')}`);
      if (wire.pending.length > 5) console.log(`  · …其余 ${wire.pending.length - 5} 条见 skill/wiring-baseline.json`);
      for (const a of wire.advisory.slice(0, 5)) console.log(`  · 不接线 ${a.id}：${a.reasons.join('；')}`);
      if (wire.advisory.length > 5) console.log(`  · …其余 ${wire.advisory.length - 5} 条 advisory 见 skill/wiring-baseline.json`);
    } else if (wire.exitCode === 3) console.log(`声明挂靠：${wire.reason}`);
    else for (const i of wire.issues) console.log(`  ✗ ${i}`);

    const exitCode = worstExitCode([live.exitCode, cons.exitCode, wire.exitCode]);
    if (exitCode === 0) {
      console.log('RESULT: PASS 工具活跃度、注册表台账一致性、声明挂靠均通过');
    } else if (exitCode === 1) {
      const why = [];
      if (live.exitCode === 1) why.push('存在连续 3 批未改变动作的工具');
      if (cons.exitCode === 1) why.push(`注册表与台账 ${cons.issues.length} 处不一致`);
      if (wire.exitCode === 1) why.push(`声明挂靠 ${wire.issues.length} 处不合格`);
      console.log(`RESULT: FAIL ${why.join('；')}`);
    } else if (exitCode === 3) {
      console.log('RESULT: 无法判断 材料缺失或读不出');
    } else {
      console.log(`RESULT: FAIL 账本结构损坏：${live.reason || cons.reason || wire.reason || ''}`);
    }
    process.exit(exitCode);
  }
  process.exit(runLivenessSelfTest());
}
