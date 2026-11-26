// L0 单条判据状态与运行证据现算子模块（INV-06/INV-07/INV-15/INV-16/G-10，<= 350 行）
import { VALID_TEETH, checkHumanOutcome, checkMaterialsFresh, isSelfWriterIdentity } from './project-loader.mjs';

export function scIsFormalEvidenceRun(r) {
  if (!r || !r.valid) return false;
  if (r.start?.debugDirtyRun === true || r.start?.isDirty === true || r.report?.debugDirtyRun === true) return false;
  if (r.start?.gate4Eligible === false || r.report?.gate4Eligible === false) return false;
  if (r.start?.track === 'explore' || r.report?.track === 'explore') return false;
  if (r.start?.skipGates === true || r.report?.skipGates === true) return false;
  return true;
}

export function scMakeObResult(id, state, reason, teeth, extra = {}) {
  return { id, state, reason, teeth, run: 'unknown', pendingRecheck: false, ...extra };
}

export function scCheckPreRunGuards(projectRoot, contract, ob, latest, teethVal, currentCriteriaHash, chainFreezeHashes) {
  if (teethVal !== null && !VALID_TEETH.has(teethVal)) {
    return scMakeObResult(ob.id, '无法判断', `未知 teeth 取值：${teethVal}`, teethVal);
  }
  // INV-06 / INV-15：判据被改写、删掉 frozenHash 或偏离链上冻结记录且未重签
  const hasSigned = typeof ob.signedBy === 'string' && ob.signedBy.trim().length > 0;
  const chainExpected = chainFreezeHashes && typeof chainFreezeHashes[ob.id] === 'string' ? chainFreezeHashes[ob.id] : null;
  const hashMatches = hasSigned && typeof ob.frozenHash === 'string' && ob.frozenHash === currentCriteriaHash && (!chainExpected || ob.frozenHash === chainExpected);
  if (hasSigned && !hashMatches) {
    const wasExpired = latest && latest.valid && !checkMaterialsFresh(projectRoot, latest.start, contract);
    const state = wasExpired ? '未验证' : '无法判断';
    const reason = wasExpired ? '过期状态下改写判据且未重签（INV-15）' : '判据内容/frozenHash 变更或偏离链上冻结记录且未重签（INV-06）';
    return scMakeObResult(ob.id, state, reason, teethVal);
  }
  // G-10：防写方或 AI 自行代签确认范围
  if ((hasSigned && isSelfWriterIdentity(ob.signedBy)) || (ob.scopeAck && isSelfWriterIdentity(ob.scopeAck.by))) {
    return scMakeObResult(ob.id, '无法判断', 'G-10 违规：signedBy 或 scopeAck.by 为写方自己或 AI 代签', teethVal);
  }
  return null;
}

export function scCheckRunValidity(latest, teethVal, obId) {
  if (!latest) return scMakeObResult(obId, '未验证', '尚无运行证据', teethVal);
  if (!latest.valid) return scMakeObResult(obId, '无法判断', latest.reason, teethVal);
  if (!scIsFormalEvidenceRun(latest)) {
    const isDirtyFlag = Boolean(latest.start?.debugDirtyRun || latest.start?.isDirty || latest.report?.debugDirtyRun);
    const whyNotFormal = isDirtyFlag
      ? '脏树调试证据（--allow-dirty），禁进门 4，请提交干净树后重跑 check'
      : '探索态或跳过门禁（--skip-gates）的试跑证据，不计入正式门 4 通过';
    return scMakeObResult(obId, '无法判断', whyNotFormal, teethVal);
  }
  if (latest.report?.outputOverflow === true || latest.report?.timedOut === true || latest.end?.result === 'unknown') {
    return scMakeObResult(obId, '无法判断', '运行超时、输出溢出或结果为 unknown，不计入通过', teethVal);
  }
  return null;
}

function scClassifyStreakRun(ob, r) {
  if (ob.kind === 'human') return checkHumanOutcome(r);
  if (r.report?.outputOverflow || r.report?.timedOut || r.end?.result === 'unknown') return '无法判断';
  const rc = r.report.exitCode ?? r.report.rows?.[0]?.exitCode;
  return rc === ob.expect?.exitCode ? '通过' : '未通过';
}

export function scCheckUnstableStreak(runs, latest, ob, thresholds, teethVal) {
  // 连续三次同版本正式运行结果不同 → 不稳定（§3.2 / INV-16）
  const streak = thresholds.unstableStreak || 3;
  const latestHead = latest.start?.run?.head || null;
  const formalSameHead = runs.filter((r) => scIsFormalEvidenceRun(r) && (!latestHead || !r.start?.run?.head || r.start.run.head === latestHead));
  if (formalSameHead.length < streak) return null;
  const tail = formalSameHead.slice(-streak).map((r) => scClassifyStreakRun(ob, r));
  if (tail.length === streak && new Set(tail).size >= 2) {
    return scMakeObResult(ob.id, '不稳定', `同版本连续 ${streak} 次正式运行结果不一致 (${tail.join('→')})`, teethVal);
  }
  return null;
}

export function scCheckFreshnessAndExpiry(projectRoot, contract, ob, latest, currentCriteriaHash, thresholds, teethVal) {
  // §8.2.2 / INV-07：运行证据绑定的判据哈希与当前判据不一致
  if (latest.start?.run?.criteriaHash && latest.start.run.criteriaHash !== currentCriteriaHash) {
    return scMakeObResult(ob.id, '过期', '运行证据绑定的判据哈希与当前判据不一致（判据已变更，须重跑 check）', teethVal);
  }
  // INV-07：材料指纹变了（含目录内新增文件） → 过期
  if (!checkMaterialsFresh(projectRoot, latest.start, contract)) {
    return scMakeObResult(ob.id, '过期', '材料指纹变化（INV-07）', teethVal);
  }
  // 判据 90 天有效期（§十 / §15.1 2.5）
  if (ob.teeth && ob.teeth.at) {
    const parsedAt = Date.parse(ob.teeth.at);
    if (!Number.isFinite(parsedAt)) {
      return scMakeObResult(ob.id, '无法判断', `有牙实验日期 teeth.at 非法：${ob.teeth.at}`, teethVal);
    }
    const ageDays = (Date.now() - parsedAt) / 86400000;
    if (ageDays > (thresholds.criterionValidDays || 90)) {
      return scMakeObResult(ob.id, '过期', `有牙实验已超过 ${thresholds.criterionValidDays} 天有效期`, teethVal);
    }
  }
  return null;
}

export function scEvaluateRunOutcome(ob, latest) {
  if (ob.kind === 'human') return checkHumanOutcome(latest);
  const rows = Array.isArray(latest.report.rows) ? latest.report.rows : null;
  const row = rows ? (rows.find((x) => x.id === ob.id) || rows[0]) : null;
  const rc = row ? row.exitCode : latest.report.exitCode;
  if (typeof rc !== 'number') return '无法判断';
  if (rc !== ob.expect?.exitCode) return '未通过';
  if (ob.expect?.stdoutMatches === undefined) return '通过';
  if (typeof latest.report.stdoutMatched === 'boolean') {
    return latest.report.stdoutMatched ? '通过' : '未通过';
  }
  const actualOut = String((row && row.stdout) ?? latest.report.stdout ?? '').replace(/[\r\n\s]+$/, '');
  return actualOut === ob.expect.stdoutMatches ? '通过' : '未通过';
}
