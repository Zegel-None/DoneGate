// L0 五状态六栏、契约显式生命周期状态机与通过四分现算引擎（INV-01..INV-18，<= 420 有效行）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { frozenHashOf } from '../../skill/hash.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { classifyBySpecTable, propagateImpact } from '../engine.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { ensureRunnerConfig } from './isolation.mjs';
import { STATE_PRIORITY, VALID_TEETH, checkHumanOutcome, checkMaterialsFresh, isSelfWriterIdentity, loadContracts, loadFunctions, loadThresholds, readEvidenceRuns } from './project-loader.mjs';

export const CONTRACT_LIFECYCLE = {
  RETIRED: 'RETIRED',
  DRAFT: 'DRAFT',
  FROZEN: 'FROZEN',
  IMPLEMENTED: 'IMPLEMENTED',
  TEETH_VERIFIED: 'TEETH_VERIFIED',
  SIGNED_OFF: 'SIGNED_OFF'
};

export function deriveContractLifecycle(contract, obs, obResults, reqCmds, allTrusted, signedOff, worstState) {
  if (contract.retired) {
    return { lifecycleState: CONTRACT_LIFECYCLE.RETIRED, lifecycleLabel: '已退役', nextCommand: null };
  }
  const reqObs = obs.filter((o) => o.required !== false);
  const allFrozen = reqObs.length > 0 && reqObs.every((o) => typeof o.signedBy === 'string' && o.signedBy.trim() && typeof o.frozenHash === 'string' && o.frozenHash.trim());
  if (obs.length === 0 || !allFrozen) {
    return {
      lifecycleState: CONTRACT_LIFECYCLE.DRAFT,
      lifecycleLabel: '草稿待冻结',
      nextCommand: `node runner/donegate.mjs contract freeze ${contract.id} --by <裁方姓名>`
    };
  }
  if (obResults.length > 0 && obResults.every((x) => x.state === '未验证')) {
    return {
      lifecycleState: CONTRACT_LIFECYCLE.FROZEN,
      lifecycleLabel: '已锁待实现',
      nextCommand: `node runner/donegate.mjs check ${contract.id}`
    };
  }
  if (allTrusted && worstState === '通过' && signedOff) {
    return { lifecycleState: CONTRACT_LIFECYCLE.SIGNED_OFF, lifecycleLabel: '人签通关', nextCommand: null };
  }
  if (allTrusted && worstState === '通过' && !signedOff) {
    return {
      lifecycleState: CONTRACT_LIFECYCLE.TEETH_VERIFIED,
      lifecycleLabel: '有牙待盲审',
      nextCommand: `node runner/donegate.mjs verify pack ${contract.id}`
    };
  }
  const untrustedOb = reqCmds.find((x) => x.state === '通过' && x.subclass !== 'A1');
  const nextCmd = (worstState === '通过' && untrustedOb)
    ? `node runner/donegate.mjs teeth ${contract.id} ${untrustedOb.id}`
    : `node runner/donegate.mjs check ${contract.id}`;
  return {
    lifecycleState: CONTRACT_LIFECYCLE.IMPLEMENTED,
    lifecycleLabel: worstState === '通过' ? '已过待验牙' : '实现修复中',
    nextCommand: nextCmd
  };
}

export function evaluateObligationState(projectRoot, contract, ob, thresholds, pendingContracts = new Set()) {
  const runs = readEvidenceRuns(projectRoot, contract.id, ob.id);
  const latest = runs.length ? runs[runs.length - 1] : null;
  const teethVal = ob.teeth && (ob.teeth.result || ob.teeth.status) ? (ob.teeth.result || ob.teeth.status) : null;

  if (teethVal !== null && !VALID_TEETH.has(teethVal)) {
    return { id: ob.id, state: '无法判断', reason: `未知 teeth 取值：${teethVal}`, teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }

  // INV-06 / INV-15：判据被改写且未重签
  const hasSigned = typeof ob.signedBy === 'string' && ob.signedBy.trim().length > 0;
  const currentCriteriaHash = frozenHashOf(ob);
  const hashMatches = hasSigned && typeof ob.frozenHash === 'string' && ob.frozenHash === currentCriteriaHash;
  const wasExpired = latest && latest.valid && !checkMaterialsFresh(projectRoot, latest.start);
  if (hasSigned && ob.frozenHash && !hashMatches) {
    return {
      id: ob.id,
      state: wasExpired ? '未验证' : '无法判断',
      reason: wasExpired ? '过期状态下改写判据且未重签（INV-15）' : '判据内容变更但未重签（INV-06）',
      teeth: teethVal, run: 'unknown', pendingRecheck: false
    };
  }

  // G-10：防写方或 AI 自行代签确认范围
  if ((hasSigned && isSelfWriterIdentity(ob.signedBy)) || (ob.scopeAck && isSelfWriterIdentity(ob.scopeAck.by))) {
    return {
      id: ob.id,
      state: '无法判断',
      reason: 'G-10 违规：signedBy 或 scopeAck.by 为写方自己或 AI 代签',
      teeth: teethVal, run: 'unknown', pendingRecheck: false
    };
  }

  if (!latest) {
    return { id: ob.id, state: '未验证', reason: '尚无运行证据', teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }
  if (!latest.valid) {
    return { id: ob.id, state: '无法判断', reason: latest.reason, teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }
  if (latest.start?.debugDirtyRun === true || latest.start?.isDirty === true || latest.report?.debugDirtyRun === true) {
    return { id: ob.id, state: '无法判断', reason: '脏树调试证据（--allow-dirty），禁进门 4，请提交干净树后重跑 check', teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }

  // 连续三次结果不同 → 不稳定（§3.2 / INV-16）
  const streak = thresholds.unstableStreak || 3;
  if (runs.length >= streak) {
    const tail = runs.slice(-streak).filter((r) => r.valid).map((r) => {
      if (ob.kind === 'human') return checkHumanOutcome(r);
      const rc = r.report.exitCode ?? r.report.rows?.[0]?.exitCode;
      return rc === ob.expect?.exitCode ? '通过' : '未通过';
    });
    if (tail.length === streak && new Set(tail).size >= 2) {
      return { id: ob.id, state: '不稳定', reason: `连续 ${streak} 次结果不一致 (${tail.join('→')})`, teeth: teethVal, run: 'unknown', pendingRecheck: false };
    }
  }

  // §8.2.2 / INV-07：运行证据绑定的判据哈希与当前判据不一致
  if (latest.start?.run?.criteriaHash && latest.start.run.criteriaHash !== currentCriteriaHash) {
    return { id: ob.id, state: '过期', reason: '运行证据绑定的判据哈希与当前判据不一致（判据已变更，须重跑 check）', teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }

  // INV-07：材料指纹变了 → 过期
  if (!checkMaterialsFresh(projectRoot, latest.start)) {
    return { id: ob.id, state: '过期', reason: '材料指纹变化（INV-07）', teeth: teethVal, run: 'unknown', pendingRecheck: false };
  }

  // 判据 90 天有效期（§十 / §15.1 2.5）
  if (ob.teeth && ob.teeth.at) {
    const ageDays = (Date.now() - Date.parse(ob.teeth.at)) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > (thresholds.criterionValidDays || 90)) {
      return { id: ob.id, state: '过期', reason: `有牙实验已超过 ${thresholds.criterionValidDays} 天有效期`, teeth: teethVal, run: 'unknown', pendingRecheck: false };
    }
  }

  let outcome;
  if (ob.kind === 'human') {
    outcome = checkHumanOutcome(latest);
  } else {
    const row = Array.isArray(latest.report.rows) ? latest.report.rows.find((x) => x.id === ob.id) || latest.report.rows[0] : null;
    const rc = row ? row.exitCode : latest.report.exitCode;
    if (typeof rc !== 'number') outcome = '无法判断';
    else if (rc !== ob.expect?.exitCode) outcome = '未通过';
    else if (ob.expect?.stdoutMatches !== undefined) {
      const actualOut = String((row && row.stdout) ?? latest.report.stdout ?? '').replace(/[\r\n\s]+$/, '');
      outcome = actualOut === ob.expect.stdoutMatches ? '通过' : '未通过';
    } else outcome = '通过';
  }

  if (outcome !== '通过') {
    return { id: ob.id, state: outcome, reason: outcome === '未通过' ? '实测未达期望' : '输出缺少有效退出码', teeth: teethVal, run: outcome === '未通过' ? 'fail' : 'unknown', pendingRecheck: false };
  }

  const isPending = pendingContracts.has(contract.id) || Boolean(ob.pendingRecheck);
  const cls = classifyBySpecTable({ run: 'pass', pendingRecheck: isPending, teeth: teethVal });
  if (cls.error) {
    return { id: ob.id, state: '无法判断', reason: cls.error, teeth: teethVal, run: 'unknown', pendingRecheck: isPending };
  }
  return {
    id: ob.id,
    state: '通过',
    subclass: cls.subclass,
    subclassLabel: cls.label,
    counts: cls.counts,
    teeth: teethVal,
    run: 'pass',
    pendingRecheck: isPending
  };
}

export function computeProjectStatus(projectRoot, pendingContracts = new Set()) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors: contractErrors } = loadContracts(projectRoot);
  const { functions, errors: functionErrors } = loadFunctions(projectRoot);
  const chainRes = readAndVerifyChain(projectRoot);
  const runnerCfg = ensureRunnerConfig(projectRoot);
  const isolationNotice = runnerCfg.isolation === 'none' ? '本次运行无隔离' : `隔离=${runnerCfg.isolation}`;

  const effectivePending = new Set(pendingContracts);
  let autoImpact = null;
  const cgClaimPath = join(projectRoot, '.donegate', 'adapters', 'codegraph', 'claim.json');
  if (existsSync(cgClaimPath)) {
    const cgDecl = verifyClaimInMemory(cgClaimPath, projectRoot, { skipContractLookup: true });
    if (cgDecl.exitCode === 0) {
      const obsArt = cgDecl.claim.artifacts.find((a) => a.kind === 'codegraph-observation');
      if (obsArt && cgDecl.memFiles.has(obsArt.path)) {
        try {
          const obs = JSON.parse(cgDecl.memFiles.get(obsArt.path).toString('utf8'));
          autoImpact = propagateImpact({
            contracts,
            functions,
            changedFiles: obs.changedFiles || [],
            impactedFiles: obs.impactedFiles || []
          });
          for (const pid of autoImpact.pendingRecheckIds) effectivePending.add(pid);
        } catch { /* ignore invalid observation json */ }
      }
    }
  }

  const ledger = { N: 0, A: 0, C: 0, D: 0, E: 0, F: 0, G: 0, A1: 0, A2: 0, A3: 0, A4: 0 };
  const humanStats = { N: 0, pass: 0, fail: 0, pending: 0 };
  const ignoredList = [];
  const contractSummaries = [];

  for (const c of contracts) {
    if (c.retired) {
      const lc = deriveContractLifecycle(c, [], [], [], false, false, '已退役');
      contractSummaries.push({ id: c.id, title: c.title, retired: c.retired, state: '已退役', ...lc, obligations: [] });
      continue;
    }
    const obs = Array.isArray(c.obligations) ? c.obligations : [];
    const obResults = [];
    let worstState = obs.length === 0 ? '无法判断' : '通过';
    for (const o of obs) {
      const st = evaluateObligationState(projectRoot, c, o, thresholds, effectivePending);
      obResults.push({ ...st, kind: o.kind, required: o.required !== false });
      if (st.teeth === 'ignored') {
        ignoredList.push({ contractId: c.id, id: o.id });
        continue;
      }
      if (o.required === false) continue;
      if (o.kind === 'human') {
        humanStats.N++;
        if (st.state === '通过') humanStats.pass++;
        else if (st.state === '未通过') humanStats.fail++;
        else humanStats.pending++;
        if (STATE_PRIORITY[st.state] > STATE_PRIORITY[worstState]) worstState = st.state;
        continue;
      }
      ledger.N++;
      if (st.state === '通过') {
        ledger.A++;
        if (st.subclass) ledger[st.subclass]++;
      } else if (st.state === '未通过') ledger.C++;
      else if (st.state === '未验证') ledger.D++;
      else if (st.state === '过期') ledger.E++;
      else if (st.state === '无法判断') ledger.F++;
      else if (st.state === '不稳定') ledger.G++;
      if (STATE_PRIORITY[st.state] > STATE_PRIORITY[worstState]) worstState = st.state;
    }
    const reqCmds = obResults.filter((x) => x.required && x.kind === 'command' && x.teeth !== 'ignored');
    const allTrusted = reqCmds.length > 0 && reqCmds.every((x) => x.state === '通过' && x.subclass === 'A1');
    const signedOff = chainRes.ok && chainRes.entries.some((e) => e.kind === 'signoff' && e.contractId === c.id);
    const lc = deriveContractLifecycle(c, obs, obResults, reqCmds, allTrusted, signedOff, worstState);
    contractSummaries.push({
      id: c.id,
      title: c.title || c.id,
      state: obs.length === 0 ? '未定验收' : worstState,
      ...lc,
      cleared: Boolean(allTrusted && signedOff && worstState === '通过'),
      signedOff,
      passTrusted: reqCmds.filter((x) => x.subclass === 'A1').length,
      passTotal: reqCmds.length,
      obligations: obResults
    });
  }

  const activeContractIds = new Set(contracts.filter((c) => !c.retired).map((c) => c.id));
  const knownAllContractIds = new Set(contracts.map((c) => c.id));
  const referencedIds = new Set(functions.flatMap((f) => Array.isArray(f.contracts) ? f.contracts : []));
  const orphanContracts = [...activeContractIds].filter((id) => !referencedIds.has(id));
  const orphanFunctions = functions.filter((f) => !Array.isArray(f.contracts) || f.contracts.length === 0 || f.contracts.some((cid) => !knownAllContractIds.has(cid)));
  const badSourceFunctions = functions.filter((f) => typeof f.source !== 'string' || f.source.trim() === '' || /(基于分析|根据规范|从代码推断|总结|概括)/.test(f.source));
  const badNameFunctions = functions.filter((f) => f.id && f._fileId !== f.id);

  let unresolvedTotal = 0;
  const adpDir = join(projectRoot, '.donegate', 'adapters');
  if (existsSync(adpDir)) {
    for (const e of readdirSync(adpDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const cRes = readJsonStrict(join(adpDir, e.name, 'claim.json'));
      if (cRes.ok && cRes.value && Array.isArray(cRes.value.unresolved)) unresolvedTotal += cRes.value.unresolved.length;
    }
  }

  // #10 汇总工具技术栈分组统计（core vs 扩展生态旁注砖）
  const brickEcosystems = {};
  const lRes = readJsonStrict(join(projectRoot, 'ledger.json'));
  if (lRes.ok && Array.isArray(lRes.value?.bricks)) {
    for (const b of lRes.value.bricks) {
      const eco = b.ecosystem || (b.actionsChanged > 0 ? 'core' : 'extension');
      if (!brickEcosystems[eco]) brickEcosystems[eco] = { total: 0, wired: 0, advisory: 0, bricks: [] };
      brickEcosystems[eco].total++;
      if (b.actionsChanged > 0) brickEcosystems[eco].wired++;
      else brickEcosystems[eco].advisory++;
      brickEcosystems[eco].bricks.push(b.brick);
    }
  }

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
