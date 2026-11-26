// L0 五状态六栏、契约显式生命周期状态机与通过四分现算引擎（INV-01..INV-18，<= 420 有效行）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { frozenHashOf } from '../../skill/hash.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { classifyBySpecTable, propagateImpact } from '../engine.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { ensureRunnerConfig } from './isolation.mjs';
import { STATE_PRIORITY, isDeliveryContract, loadContracts, loadFunctions, loadThresholds, readEvidenceRuns } from './project-loader.mjs';
import {
  scCheckFreshnessAndExpiry, scCheckPreRunGuards, scCheckRunValidity,
  scCheckUnstableStreak, scEvaluateRunOutcome, scMakeObResult
} from './criterion-eval.mjs';

export const CONTRACT_LIFECYCLE = {
  RETIRED: 'RETIRED', EXPLORING: 'EXPLORING', EXPLORE_EXPIRED: 'EXPLORE_EXPIRED',
  DRAFT: 'DRAFT', FROZEN: 'FROZEN', IMPLEMENTED: 'IMPLEMENTED', TEETH_VERIFIED: 'TEETH_VERIFIED', SIGNED_OFF: 'SIGNED_OFF'
};

export function isExploreContractExpired(contract) {
  const ts = contract?.exploreMeta?.expiresAt ? Date.parse(contract.exploreMeta.expiresAt) : NaN;
  return Number.isFinite(ts) && Date.now() > ts;
}

export function deriveContractLifecycle(contract, obs, obResults, reqCmds, allTrusted, signedOff, worstState) {
  if (contract.retired) return { lifecycleState: CONTRACT_LIFECYCLE.RETIRED, lifecycleLabel: '已退役', nextCommand: null };
  if (contract.track === 'explore') {
    const expired = isExploreContractExpired(contract);
    return {
      lifecycleState: expired ? CONTRACT_LIFECYCLE.EXPLORE_EXPIRED : CONTRACT_LIFECYCLE.EXPLORING,
      lifecycleLabel: expired ? '探索已过期·需晋升或退役' : '探索沙箱·不计交付算数',
      nextCommand: `node runner/donegate.mjs contract promote ${contract.id} --by <裁方姓名>`
    };
  }
  const reqObs = obs.filter((o) => o.required !== false);
  const allFrozen = reqObs.length > 0 && reqObs.every((o) => typeof o.signedBy === 'string' && o.signedBy.trim() && typeof o.frozenHash === 'string' && o.frozenHash.trim());
  if (obs.length === 0 || !allFrozen) return { lifecycleState: CONTRACT_LIFECYCLE.DRAFT, lifecycleLabel: '草稿待冻结', nextCommand: `node runner/donegate.mjs contract freeze ${contract.id} --by <裁方姓名>` };
  if (obResults.length > 0 && obResults.every((x) => x.state === '未验证')) return { lifecycleState: CONTRACT_LIFECYCLE.FROZEN, lifecycleLabel: '已锁待实现', nextCommand: `node runner/donegate.mjs check ${contract.id}` };
  if (allTrusted && worstState === '通过' && signedOff) return { lifecycleState: CONTRACT_LIFECYCLE.SIGNED_OFF, lifecycleLabel: '人签通关', nextCommand: null };
  if (allTrusted && worstState === '通过') return { lifecycleState: CONTRACT_LIFECYCLE.TEETH_VERIFIED, lifecycleLabel: '有牙待盲审', nextCommand: `node runner/donegate.mjs verify pack ${contract.id}` };
  const untrustedOb = reqCmds.find((x) => x.state === '通过' && x.subclass !== 'A1');
  const nextCmd = (worstState === '通过' && untrustedOb) ? `node runner/donegate.mjs teeth ${contract.id} ${untrustedOb.id}` : `node runner/donegate.mjs check ${contract.id}`;
  return { lifecycleState: CONTRACT_LIFECYCLE.IMPLEMENTED, lifecycleLabel: worstState === '通过' ? '已过待验牙' : '实现修复中', nextCommand: nextCmd };
}

const LEDGER_NON_PASS_KEY = { '未通过': 'C', '未验证': 'D', '过期': 'E', '无法判断': 'F', '不稳定': 'G' };

export function evaluateObligationState(projectRoot, contract, ob, thresholds, pendingContracts = new Set(), chainFreezeHashes = null) {
  const runs = readEvidenceRuns(projectRoot, contract.id, ob.id);
  const latest = runs.length ? runs[runs.length - 1] : null;
  const teethVal = ob.teeth && (ob.teeth.result || ob.teeth.status) ? (ob.teeth.result || ob.teeth.status) : null;
  const currentCriteriaHash = frozenHashOf(ob);

  const preErr = scCheckPreRunGuards(projectRoot, contract, ob, latest, teethVal, currentCriteriaHash, chainFreezeHashes);
  if (preErr) return preErr;
  const runErr = scCheckRunValidity(latest, teethVal, ob.id);
  if (runErr) return runErr;
  const streakErr = scCheckUnstableStreak(runs, latest, ob, thresholds, teethVal);
  if (streakErr) return streakErr;
  const freshErr = scCheckFreshnessAndExpiry(projectRoot, contract, ob, latest, currentCriteriaHash, thresholds, teethVal);
  if (freshErr) return freshErr;

  const outcome = scEvaluateRunOutcome(ob, latest);
  if (outcome !== '通过') {
    const isFail = outcome === '未通过';
    return scMakeObResult(ob.id, outcome, isFail ? '实测未达期望' : '输出缺少有效退出码', teethVal, { run: isFail ? 'fail' : 'unknown' });
  }

  const isPending = pendingContracts.has(contract.id) || Boolean(ob.pendingRecheck);
  const cls = classifyBySpecTable({ run: 'pass', pendingRecheck: isPending, teeth: teethVal });
  if (cls.error) {
    return scMakeObResult(ob.id, '无法判断', cls.error, teethVal, { pendingRecheck: isPending });
  }
  return {
    id: ob.id, state: '通过', subclass: cls.subclass, subclassLabel: cls.label,
    counts: cls.counts, teeth: teethVal, run: 'pass', pendingRecheck: isPending
  };
}

function scCollectAutoImpactPending(projectRoot, contracts, functions, effectivePending) {
  const cgClaimPath = join(projectRoot, '.donegate', 'adapters', 'codegraph', 'claim.json');
  if (!existsSync(cgClaimPath)) return null;
  const cgDecl = verifyClaimInMemory(cgClaimPath, projectRoot, { skipContractLookup: true });
  if (cgDecl.exitCode !== 0) return null;
  const obsArt = cgDecl.claim.artifacts.find((a) => a.kind === 'codegraph-observation');
  if (!obsArt || !cgDecl.memFiles.has(obsArt.path)) return null;
  try {
    const obs = JSON.parse(cgDecl.memFiles.get(obsArt.path).toString('utf8'));
    const autoImpact = propagateImpact({
      contracts, functions,
      changedFiles: obs.changedFiles || [],
      impactedFiles: obs.impactedFiles || []
    });
    for (const pid of autoImpact.pendingRecheckIds) effectivePending.add(pid);
    return autoImpact;
  } catch (err) {
    void err;
    return null;
  }
}

function scPickWorseState(worstState, nextState) {
  return (STATE_PRIORITY[nextState] || 0) > (STATE_PRIORITY[worstState] || 0) ? nextState : worstState;
}

function scRecordObligationStats(contractId, o, st, ledger, humanStats, ignoredList, worstState) {
  if (st.teeth === 'ignored') {
    ignoredList.push({ contractId, id: o.id });
    return worstState;
  }
  if (o.required === false) return worstState;
  if (o.kind === 'human') {
    humanStats.N++;
    if (st.state === '通过') humanStats.pass++;
    else if (st.state === '未通过') humanStats.fail++;
    else humanStats.pending++;
    return scPickWorseState(worstState, st.state);
  }
  ledger.N++;
  if (st.state === '通过') {
    ledger.A++;
    if (st.subclass) ledger[st.subclass]++;
  } else if (LEDGER_NON_PASS_KEY[st.state]) {
    ledger[LEDGER_NON_PASS_KEY[st.state]]++;
  }
  return scPickWorseState(worstState, st.state);
}

function scSummarizeInactiveContract(c) {
  if (c.retired) {
    const lc = deriveContractLifecycle(c, [], [], [], false, false, '已退役');
    return { id: c.id, title: c.title, retired: c.retired, state: '已退役', ...lc, obligations: [] };
  }
  if (c.track === 'explore') {
    const expState = isExploreContractExpired(c) ? '探索已过期' : '探索中';
    const lc = deriveContractLifecycle(c, [], [], [], false, false, expState);
    return {
      id: c.id, title: c.title || c.id, track: 'explore', exploreMeta: c.exploreMeta || null,
      state: expState, ...lc, cleared: false, signedOff: false, passTrusted: 0, passTotal: 0, obligations: []
    };
  }
  return null;
}

function scSummarizeSingleContract(projectRoot, c, ctx) {
  const inactive = scSummarizeInactiveContract(c);
  if (inactive) return inactive;
  const obs = Array.isArray(c.obligations) ? c.obligations : [];
  const entries = ctx.chainRes.ok ? ctx.chainRes.entries : [];
  const latestFreeze = entries.filter((e) => e.kind === 'freeze' && e.contractId === c.id).pop();
  const freezeHashes = latestFreeze?.criteriaHashes || null;
  const obResults = [];
  let worstState = obs.length === 0 ? '无法判断' : '通过';
  for (const o of obs) {
    const st = evaluateObligationState(projectRoot, c, o, ctx.thresholds, ctx.effectivePending, freezeHashes);
    obResults.push({ ...st, kind: o.kind, required: o.required !== false });
    worstState = scRecordObligationStats(c.id, o, st, ctx.ledger, ctx.humanStats, ctx.ignoredList, worstState);
  }
  const reqCmds = obResults.filter((x) => x.required && x.kind === 'command' && x.teeth !== 'ignored');
  const allTrusted = reqCmds.length > 0 && reqCmds.every((x) => x.state === '通过' && x.subclass === 'A1');
  const latestFreezeSeq = latestFreeze?.seq || 0;
  const signedOff = entries.some((e) => e.kind === 'signoff' && e.contractId === c.id && (e.seq || 0) > latestFreezeSeq);
  const lc = deriveContractLifecycle(c, obs, obResults, reqCmds, allTrusted, signedOff, worstState);
  return {
    id: c.id, title: c.title || c.id, state: obs.length === 0 ? '未定验收' : worstState, ...lc,
    cleared: Boolean(allTrusted && signedOff && worstState === '通过'), signedOff,
    passTrusted: reqCmds.filter((x) => x.subclass === 'A1').length, passTotal: reqCmds.length, obligations: obResults
  };
}

function scAuditFunctionCoverage(contracts, functions) {
  const activeContractIds = new Set(contracts.filter(isDeliveryContract).map((c) => c.id));
  const knownAllContractIds = new Set(contracts.map((c) => c.id));
  const referencedIds = new Set(functions.flatMap((f) => (Array.isArray(f.contracts) ? f.contracts : [])));
  const orphanContracts = [...activeContractIds].filter((id) => !referencedIds.has(id));
  const orphanFunctions = functions.filter((f) => !Array.isArray(f.contracts) || f.contracts.length === 0 || f.contracts.some((cid) => !knownAllContractIds.has(cid)));
  const badSourceFunctions = functions.filter((f) => typeof f.source !== 'string' || f.source.trim() === '' || /(基于分析|根据规范|从代码推断|总结|概括)/.test(f.source));
  const badNameFunctions = functions.filter((f) => f.id && f._fileId !== f.id);
  return { orphanContracts, orphanFunctions, badSourceFunctions, badNameFunctions };
}

function scCountUnresolvedAdapterClaims(projectRoot) {
  const adpDir = join(projectRoot, '.donegate', 'adapters');
  if (!existsSync(adpDir)) return 0;
  let unresolvedTotal = 0;
  for (const e of readdirSync(adpDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const cRes = readJsonStrict(join(adpDir, e.name, 'claim.json'));
    if (cRes.ok && Array.isArray(cRes.value?.unresolved)) unresolvedTotal += cRes.value.unresolved.length;
  }
  return unresolvedTotal;
}

function scSummarizeBrickEcosystems(projectRoot) {
  // #10 汇总工具技术栈分组统计（core vs 扩展生态旁注砖）
  const brickEcosystems = {};
  const lRes = readJsonStrict(join(projectRoot, 'ledger.json'));
  if (!lRes.ok || !Array.isArray(lRes.value?.bricks)) return brickEcosystems;
  for (const b of lRes.value.bricks) {
    const eco = b.ecosystem || (b.actionsChanged > 0 ? 'core' : 'extension');
    if (!brickEcosystems[eco]) brickEcosystems[eco] = { total: 0, wired: 0, advisory: 0, bricks: [] };
    brickEcosystems[eco].total++;
    if (b.actionsChanged > 0) brickEcosystems[eco].wired++;
    else brickEcosystems[eco].advisory++;
    brickEcosystems[eco].bricks.push(b.brick);
  }
  return brickEcosystems;
}

export function computeProjectStatus(projectRoot, pendingContracts = new Set()) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors: contractErrors } = loadContracts(projectRoot);
  const { functions, errors: functionErrors } = loadFunctions(projectRoot);
  const chainRes = readAndVerifyChain(projectRoot);
  const runnerCfg = ensureRunnerConfig(projectRoot);
  const isolationNotice = runnerCfg.isolation === 'none' ? '本次运行无隔离' : `隔离=${runnerCfg.isolation}`;

  const effectivePending = new Set(pendingContracts);
  const autoImpact = scCollectAutoImpactPending(projectRoot, contracts, functions, effectivePending);
  const ledger = { N: 0, A: 0, C: 0, D: 0, E: 0, F: 0, G: 0, A1: 0, A2: 0, A3: 0, A4: 0 };
  const humanStats = { N: 0, pass: 0, fail: 0, pending: 0 };
  const ignoredList = [];
  const ctx = { thresholds, chainRes, effectivePending, ledger, humanStats, ignoredList };
  const contractSummaries = contracts.map((c) => scSummarizeSingleContract(projectRoot, c, ctx));
  const { orphanContracts, orphanFunctions, badSourceFunctions, badNameFunctions } = scAuditFunctionCoverage(contracts, functions);
  const unresolvedTotal = scCountUnresolvedAdapterClaims(projectRoot);
  const brickEcosystems = scSummarizeBrickEcosystems(projectRoot);

  const ledgerLines = [
    `本轮 ${ledger.N} 项：通过 ${ledger.A}、未通过 ${ledger.C}、未验证 ${ledger.D}、过期 ${ledger.E}、无法判断 ${ledger.F}、不稳定 ${ledger.G}`,
    `其中通过里：算数 ${ledger.A1}、无牙 ${ledger.A2}、未做实验 ${ledger.A3}、待重验 ${ledger.A4}`
  ];
  const implementedCount = functions.length - orphanFunctions.length;
  const funcLine = `功能 ${functions.length} 项：有实现 ${implementedCount}、孤儿功能 ${orphanFunctions.length}、孤儿契约 ${orphanContracts.length}`;
  const j3Line = `过程信号：不稳定栏计数=${ledger.G} + unresolved 计数=${unresolvedTotal}`;

  return {
    thresholds, contracts, contractErrors, functions, functionErrors, chainRes,
    ledger, humanStats, ignoredList, contractSummaries, brickEcosystems,
    orphanContracts, orphanFunctions, badSourceFunctions, badNameFunctions,
    unresolvedTotal, ledgerLines, funcLine, j3Line, isolationNotice, autoImpact
  };
}
