// L0 判定核 · pendingRecheck 传播与影响面引擎（D01 · 零第三方依赖）。
// 用法：
//   node runner/engine.mjs --root <项目根> --changed <file1,file2> [--observation <observation.json>] [--json]
//   node runner/engine.mjs                   （无参数时提示用法并退 3，夹具见 runner/donegate-fixtures.mjs）
// 退出码（四值规范）：0 成功算出影响面；2 契约/观测 JSON 损坏或结构非法；3 根目录/观测文件读不出或参数缺失。
//
// 诚实边界（静态声明采信边界）：
//   1. 只依据静态声明的 contract.scope、contract.dependsOn、functions/*.contracts 与可选 codegraph observation.json 计算；
//      不执行代码，不捕获动态 require/反射或跨进程隐式耦合。
//   2. 严禁修改契约既有的「通过」主状态，也不得覆盖或删除历史运行证据；
//      只计算并输出 pendingRecheck / expired / 受影响业务场景，由展示层与总账现算消费。
//   3. 不负责清除 pendingRecheck（清标记须由重验下游输入/产物一致性完成）。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../skill/io.mjs';
import { materialFingerprintOf } from '../skill/hash.mjs';

const ENGINE_HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_REPO = resolve(ENGINE_HERE, '..');

function normRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function scopeMatchesFile(scopes, file) {
  const f = normRelPath(file);
  if (!f || !Array.isArray(scopes)) return false;
  return scopes.some((raw) => {
    const s = normRelPath(raw);
    if (!s) return false;
    if (s.endsWith('/')) return f.startsWith(s);
    return f === s || f.startsWith(s + '/');
  });
}

const DEFAULT_CLASSIFICATION_ROWS = [
  { order: 1, subclass: 'A4', label: '待重验', counts: false, when: { run: 'pass', pendingRecheck: true } },
  { order: 2, subclass: 'A1', label: '算数', counts: true, when: { run: 'pass', pendingRecheck: false, teeth: ['killed'] } },
  {
    order: 3,
    subclass: 'A2',
    label: '无牙',
    counts: false,
    when: {
      run: 'pass',
      pendingRecheck: false,
      teeth: ['survived', 'no-coverage', 'compile-error', 'runtime-error', 'timeout', 'red-wrong-assertion', 'hollow-assertion']
    }
  },
  { order: 4, subclass: 'A3', label: '未做实验', counts: false, when: { run: 'pass', pendingRecheck: false, teeth: null } }
];

function engMatchClassificationRow(row, obsState) {
  const w = row.when || {};
  if (w.run !== obsState.run) return false;
  if (w.pendingRecheck !== Boolean(obsState.pendingRecheck)) return false;
  if (w.teeth === undefined) return true;
  if (w.teeth === null) return obsState.teeth === null || obsState.teeth === undefined;
  return Array.isArray(w.teeth) && w.teeth.includes(obsState.teeth);
}

export function classifyBySpecTable(obsState, tablePath) {
  const defaultPath = join(ENGINE_REPO, 'tools', 'classification.json');
  const targetPath = tablePath !== undefined ? tablePath : defaultPath;
  let rows = DEFAULT_CLASSIFICATION_ROWS;
  if (tablePath !== undefined || existsSync(targetPath)) {
    const res = readJsonStrict(targetPath);
    if (!res.ok || !res.value || !Array.isArray(res.value.rows)) {
      return { error: 'classification.json 不可读或损坏' };
    }
    rows = res.value.rows;
  }
  if (obsState.teeth === 'ignored') return { subclass: null, label: '已忽略', counts: false };
  if (obsState.run !== 'pass') return { subclass: null, label: obsState.run === 'fail' ? '未通过' : '无法判断', counts: false };
  const hit = rows.find((row) => engMatchClassificationRow(row, obsState));
  if (hit) return { subclass: hit.subclass, label: hit.label, counts: hit.counts };
  return { error: '出现规格 §3.4.1 未定义的状态组合：' + JSON.stringify(obsState) };
}

function engReadContractsDir(cDir) {
  const contracts = [];
  if (!existsSync(cDir)) return { contracts };
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(cDir, e.name, 'contract.json');
    if (!existsSync(p)) continue;
    const r = readJsonStrict(p);
    if (!r.ok) return { error: r.error === 'parse' ? 'parse' : 'unreadable', path: p };
    contracts.push(r.value);
  }
  return { contracts };
}

function engReadFunctionsDir(fDir) {
  const functions = [];
  if (!existsSync(fDir)) return { functions };
  for (const e of readdirSync(fDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const p = join(fDir, e.name);
    const r = readJsonStrict(p);
    if (!r.ok) return { error: r.error === 'parse' ? 'parse' : 'unreadable', path: p };
    functions.push(r.value);
  }
  return { functions };
}

export function loadProjectGraph(projectRoot) {
  const cRes = engReadContractsDir(join(projectRoot, 'contracts'));
  if (cRes.error) return cRes;
  const fRes = engReadFunctionsDir(join(projectRoot, 'functions'));
  if (fRes.error) return fRes;
  return { contracts: cRes.contracts, functions: fRes.functions };
}

function engBuildReverseDeps(activeContracts) {
  const byId = new Map(activeContracts.map((c) => [c.id, c]));
  const revDeps = new Map();
  for (const c of activeContracts) {
    const deps = Array.isArray(c.dependsOn) ? c.dependsOn : [];
    for (const dep of deps) {
      if (!byId.has(dep)) continue;
      if (!revDeps.has(dep)) revDeps.set(dep, []);
      revDeps.get(dep).push(c.id);
    }
  }
  return revDeps;
}

function engMakeExpiredEffect(contractId, reason, existingStates) {
  const prev = existingStates[contractId] || {};
  return {
    contractId,
    effect: 'expired',
    reason,
    pendingRecheck: false,
    status: '过期',
    preservedStatus: prev.status || null,
    countsInPassCount: false,
    historicalEvidencePreserved: true
  };
}

function engMakePendingEffect(contractId, reason, existingStates) {
  const prev = existingStates[contractId] || { status: '通过', run: 'pass', teeth: 'killed' };
  const cls = classifyBySpecTable({ run: prev.run || 'pass', pendingRecheck: true, teeth: prev.teeth ?? 'killed' });
  return {
    contractId,
    effect: 'pending-recheck',
    reason,
    pendingRecheck: true,
    status: prev.status || '通过',
    subclass: cls.subclass || 'A4',
    countsInPassCount: Boolean(cls.counts),
    historicalEvidencePreserved: true
  };
}

function engMarkOwnAndDirectExpired(activeContracts, changed, revDeps, existingStates, effects) {
  const ownIds = [];
  for (const c of activeContracts) {
    if (!changed.some((f) => scopeMatchesFile(c.scope, f))) continue;
    ownIds.push(c.id);
    effects.set(c.id, engMakeExpiredEffect(c.id, 'own-code', existingStates));
  }
  const directDependIds = [];
  for (const id of ownIds) {
    for (const childId of (revDeps.get(id) || [])) {
      if (effects.has(childId)) continue;
      directDependIds.push(childId);
      effects.set(childId, engMakeExpiredEffect(childId, 'direct-depend', existingStates));
    }
  }
  return { ownIds, directDependIds };
}

function engMarkTransitivePending(ownIds, directDependIds, revDeps, existingStates, effects) {
  const queue = [...directDependIds];
  const visited = new Set([...ownIds, ...directDependIds]);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nextId of (revDeps.get(cur) || [])) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      queue.push(nextId);
      if (!effects.has(nextId)) {
        effects.set(nextId, engMakePendingEffect(nextId, 'transitive-depend', existingStates));
      }
    }
  }
}

function engMarkCodegraphPending(activeContracts, impacted, existingStates, effects) {
  for (const c of activeContracts) {
    if (effects.has(c.id)) continue;
    if (impacted.some((f) => scopeMatchesFile(c.scope, f))) {
      effects.set(c.id, engMakePendingEffect(c.id, 'codegraph-impact', existingStates));
    }
  }
}

function engCollectAffectedScenarios(functions, affectedSet) {
  const out = [];
  for (const fn of functions) {
    if (!fn || !Array.isArray(fn.contracts)) continue;
    const matched = fn.contracts.filter((cid) => affectedSet.has(cid));
    if (matched.length > 0) out.push({ id: fn.id, title: fn.title || fn.id, contracts: matched });
  }
  return out;
}

export function propagateImpact({ contracts = [], functions = [], changedFiles = [], impactedFiles = [], existingStates = {}, materialRecords = null }) {
  const changed = changedFiles.map(normRelPath).filter(Boolean);
  const impacted = impactedFiles.map(normRelPath).filter(Boolean);
  const activeContracts = contracts.filter((c) => c && c.id && !c.retired);
  const revDeps = engBuildReverseDeps(activeContracts);
  const effects = new Map();

  const { ownIds, directDependIds } = engMarkOwnAndDirectExpired(activeContracts, changed, revDeps, existingStates, effects);
  engMarkTransitivePending(ownIds, directDependIds, revDeps, existingStates, effects);
  engMarkCodegraphPending(activeContracts, impacted, existingStates, effects);

  const affectedContracts = [...effects.values()];
  const affectedSet = new Set(affectedContracts.map((x) => x.contractId));
  const pendingRecheckIds = affectedContracts.filter((x) => x.pendingRecheck).map((x) => x.contractId);
  const expiredIds = affectedContracts.filter((x) => x.effect === 'expired').map((x) => x.contractId);
  const affectedScenarios = engCollectAffectedScenarios(functions, affectedSet);
  const smokeRequired = affectedContracts.length >= 2;
  const materialFingerprint = materialRecords ? materialFingerprintOf(materialRecords) : null;

  return {
    changedFiles: changed,
    impactedFiles: impacted,
    expiredIds,
    pendingRecheckIds,
    affectedContracts,
    affectedScenarios,
    smokeRequired,
    materialFingerprint
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) opts[argv[i]] = argv[++i];
  }
  const rootArg = opts['--root'];
  if (!rootArg) {
    console.error('用法：node runner/engine.mjs --root <项目根> [--changed a.mjs,b.mjs] [--observation observation.json] [--json]');
    process.exit(3);
  }
  const projectRoot = resolve(rootArg);
  let dirOk = false;
  try { dirOk = statSync(projectRoot).isDirectory(); } catch (err) { void err; dirOk = false; }
  if (!dirOk) {
    console.error('RESULT: 无法判断 项目根目录不存在：' + projectRoot);
    process.exit(3);
  }

  const loaded = loadProjectGraph(projectRoot);
  if (loaded.error) {
    console.error('读契约/功能失败：' + loaded.path);
    process.exit(loaded.error === 'parse' ? 2 : 3);
  }

  let changedFiles = (opts['--changed'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  let impactedFiles = [];
  const obsPath = opts['--observation'];
  if (obsPath) {
    const obsRes = readJsonStrict(resolve(obsPath));
    if (!obsRes.ok) {
      console.error('observation.json 读不出或损坏：' + obsPath);
      process.exit(obsRes.error === 'parse' ? 2 : 3);
    }
    if (Array.isArray(obsRes.value.changedFiles) && changedFiles.length === 0) changedFiles = obsRes.value.changedFiles;
    if (Array.isArray(obsRes.value.impactedFiles)) impactedFiles = obsRes.value.impactedFiles;
  }

  const result = propagateImpact({ contracts: loaded.contracts, functions: loaded.functions, changedFiles, impactedFiles });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`expired=${result.expiredIds.length} (${result.expiredIds.join(',') || '-'}) | pendingRecheck=${result.pendingRecheckIds.length} (${result.pendingRecheckIds.join(',') || '-'}) | scenarios=${result.affectedScenarios.length} | smokeRequired=${result.smokeRequired}`);
    console.log(`RESULT: PASS 影响面计算完成（待重验 ${result.pendingRecheckIds.length} 个契约）`);
  }
  process.exit(0);
}
