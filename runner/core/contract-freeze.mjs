// 契约冻结与人签通关校验子模块（供 cmd-lifecycle.mjs 委托，<= 350 行）
import { writeFileSync } from 'node:fs';
import { frozenHashOf, materialFingerprintOf } from '../../skill/hash.mjs';
import { appendChainEntry, readAndVerifyChain } from './chain.mjs';
import { computeProjectStatus, isSelfWriterIdentity, loadThresholds } from './gates.mjs';
import { renderProgressBlock } from './progress.mjs';

function lcVerifySignoffPrerequisites(projectRoot, id, opts) {
  if (!opts.attest || !opts.attest.trim()) {
    return { ok: false, res: { exitCode: 1, stderr: '签收 (--signoff) 必须附 --attest 口头复述内容' } };
  }
  const status = computeProjectStatus(projectRoot);
  if (!status.chainRes.ok) {
    return { ok: false, res: { exitCode: status.chainRes.exitCode || 2, stderr: status.chainRes.reason } };
  }
  const cSum = status.contractSummaries.find((x) => x.id === id);
  if (!cSum || cSum.state !== '通过') {
    return { ok: false, res: { exitCode: 1, stderr: `契约 ${id} 当前状态为 ${cSum ? cSum.state : '未知'}，非「通过」不可签收` } };
  }
  const notA1 = cSum.obligations.filter((o) => o.required && o.kind === 'command' && o.subclass !== 'A1');
  if (notA1.length > 0) {
    return { ok: false, res: { exitCode: 1, stderr: `契约 ${id} 仍有非「算数(A1)」判据：${notA1.map((x) => x.id + '=' + x.subclassLabel).join('、')}` } };
  }
  const entries = status.chainRes.entries;
  const latestFreeze = entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop();
  const minSeq = latestFreeze?.seq || 0;
  const verifyOk = entries.filter((e) => e.kind === 'verify-result' && e.contractId === id && (e.seq || 0) > minSeq).pop();
  if (!verifyOk || verifyOk.result !== 'pass') {
    return { ok: false, res: { exitCode: 1, stderr: `契约 ${id} 尚未通过当前冻结版本的门 5 verify apply 复核` } };
  }
  const implEntry = entries.filter((e) => e.kind === 'implement' && e.contractId === id).pop();
  return { ok: true, status, verifyOk, implEntry };
}

function lcComputeSignoffSpeedNotice(opts, obsCount, thresholds) {
  if (!opts.openedAt) return { signoffDurationSec: null, speedWarn: '' };
  const signoffDurationSec = Math.max(0, Math.round((Date.now() - Date.parse(opts.openedAt)) / 1000));
  const minSec = (thresholds.minSignoffSecPerCriterion || 20) * obsCount;
  const speedWarn = (Number.isFinite(signoffDurationSec) && signoffDurationSec < minSec)
    ? `\n⚠ 签字可能在走过场（总耗时 ${signoffDurationSec}s < ${minSec}s）`
    : '';
  return { signoffDurationSec, speedWarn };
}

export function lcExecuteContractSignoff(projectRoot, id, by, contract, obs, opts, collectMaterialsFn) {
  const pre = lcVerifySignoffPrerequisites(projectRoot, id, opts);
  if (!pre.ok) return pre.res;
  const materials = collectMaterialsFn(projectRoot, contract);
  const { signoffDurationSec, speedWarn } = lcComputeSignoffSpeedNotice(opts, obs.length, pre.status.thresholds);
  const app = appendChainEntry(projectRoot, {
    kind: 'signoff',
    contractId: id,
    signedBy: by.trim(),
    attestation: opts.attest.trim(),
    signoffDurationSec,
    implementSeq: pre.implEntry ? pre.implEntry.seq : null,
    packageHash: pre.verifyOk.packageHash || null,
    materialFingerprint: materialFingerprintOf(materials)
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return {
    exitCode: 0,
    stdout: `契约 ${id}：通关（已签收，链序号 seq=${app.entry.seq}）${speedWarn}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: id, headline: `🏆 「${contract.title || id}」已签收通关 · 总进度 {{PCT}}` })
  };
}

export function lcCheckFreezeBatchQuota(projectRoot, id, obs, opts) {
  // 失效链 A：单轮新增判据上限（默认 3 条，超限须 --force-batch）
  if (opts.forceBatch) return null;
  const thresholds = loadThresholds(projectRoot);
  const chainNow = readAndVerifyChain(projectRoot);
  const prevFreeze = chainNow.ok ? chainNow.entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop() : null;
  if (!prevFreeze || !prevFreeze.criteriaHashes) return null;
  const prevIds = new Set(Object.keys(prevFreeze.criteriaHashes));
  const addedCount = obs.filter((o) => o && !prevIds.has(o.id)).length;
  const limit = thresholds.maxNewCriteriaPerRound || 3;
  if (addedCount > limit) {
    return { exitCode: 1, stderr: `链 A 单轮新增判据 ${addedCount} 条超过上限 ${limit}（请分轮或加 --force-batch）` };
  }
  return null;
}

export function lcValidateObligationsForFreeze(obs) {
  for (const o of obs) {
    if (!o || !o.id || !o.kind || !o.expect) {
      return { exitCode: 1, stderr: `判据 ${o && o.id ? o.id : '?'} 缺少 kind 或 expect，禁止冻结` };
    }
    if (o.kind === 'command' && (!o.command || typeof o.command !== 'string')) {
      return { exitCode: 1, stderr: `command 判据 ${o.id} 缺少 command` };
    }
    if (o.scopeAck && isSelfWriterIdentity(o.scopeAck.by)) {
      return { exitCode: 1, stderr: `G-10 判据 ${o.id} 的 scopeAck.by="${o.scopeAck.by}" 不许是本轮写方自己或 AI 代签` };
    }
  }
  return null;
}

export function lcSealObligationsAndWrite(cPath, contract, obs, by) {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const criteriaHashes = {};
  contract.provisional = false;
  for (const o of obs) {
    if (!o.scopeAck || !o.scopeAck.by || !o.scopeAck.at) {
      o.scopeAck = { by: by.trim(), at: today };
    }
    o.frozenAt = nowIso;
    const h = frozenHashOf(o);
    o.frozenHash = h;
    o.signedBy = by.trim();
    criteriaHashes[o.id] = h;
  }
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  return criteriaHashes;
}
