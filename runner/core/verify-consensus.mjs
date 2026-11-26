// 门 5 多模型共识投票（3 轮上限）、半形式化推理校验与 escapes.jsonl 回归集构造器（<= 140 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export const VC_ITEMS = ['V1', 'V2', 'V3', 'V4', 'V5'];
export const VC_ALLOWED = new Set(['pass', 'fail', 'unknown']);
export const VC_MAX_ROUNDS = 3;

export function vcValidateSemiFormalProof(itemKey, entry) {
  if (!entry || typeof entry !== 'object' || entry.proof === undefined) {
    return { ok: true };
  }
  const p = entry.proof;
  if (!p || typeof p !== 'object') {
    return { ok: false, reason: `${itemKey}.proof 必须是包含 premise / executionTrace / conclusion 的对象` };
  }
  const hasPremise = typeof p.premise === 'string' && p.premise.trim().length > 0;
  const hasTrace = (typeof p.executionTrace === 'string' && p.executionTrace.trim().length > 0) ||
    (Array.isArray(p.executionTrace) && p.executionTrace.length > 0);
  const hasConclusion = typeof p.conclusion === 'string' && p.conclusion.trim().length > 0;
  if (!hasPremise || !hasTrace || !hasConclusion) {
    return { ok: false, reason: `${itemKey}.proof 缺少必填半形式化字段（premise / executionTrace / conclusion）` };
  }
  return { ok: true };
}

function vcInspectSingleVerdict(v, idx) {
  const label = `vote#${idx + 1}`;
  const vals = {};
  let isContradiction = false;
  for (const k of VC_ITEMS) {
    const entry = v[k];
    const val = typeof entry === 'string' ? entry : entry?.verdict;
    const reason = typeof entry === 'object' ? (entry?.reason || entry?.rationale || '') : (v.reasons?.[k] || '');
    if (!VC_ALLOWED.has(val)) {
      return { ok: false, exitCode: 3, stderr: `${label} 非法作答词 ${k}=${val}（只允许 pass/fail/unknown，退 3）` };
    }
    const proofChk = vcValidateSemiFormalProof(k, entry);
    if (!proofChk.ok) return { ok: false, exitCode: 3, stderr: `${label} ${proofChk.reason}（退 3）` };
    if (val === 'unknown') {
      if (!String(reason).trim() || !/(缺失|缺|矛盾|不一致|对不上|不可读|材料)/.test(String(reason))) {
        return { ok: false, exitCode: 3, stderr: `${label} invalid-abstain：${k}=unknown 未指明缺失或矛盾材料（退 3）` };
      }
      if (/(矛盾|不一致|对不上)/.test(String(reason))) isContradiction = true;
    }
    vals[k] = { val, reason: String(reason || '') };
  }
  return { ok: true, judge: String(v.judge || `judge-${idx + 1}`), contractId: v.contractId || '', vals, isContradiction };
}

export function vcAggregateVoteFiles(projectRoot, votePaths, maxRounds = VC_MAX_ROUNDS) {
  const list = Array.isArray(votePaths)
    ? votePaths.map((s) => String(s || '').trim()).filter(Boolean)
    : String(votePaths || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, exitCode: 3, stderr: '多模型共识 --votes 不能为空' };
  if (list.length > maxRounds) {
    return { ok: false, exitCode: 3, stderr: `多模型盲审轮次/票数 (${list.length}) 超出上限 (${maxRounds})，请收敛后重评（退 3）` };
  }

  const parsed = [];
  for (let i = 0; i < list.length; i++) {
    const abs = resolve(projectRoot, list[i]);
    if (!existsSync(abs)) return { ok: false, exitCode: 3, stderr: `投票判定书不存在：${list[i]}` };
    const r = readJsonStrict(abs);
    if (!r.ok || !r.value) return { ok: false, exitCode: r.error === 'parse' ? 2 : 3, stderr: `投票判定书解析失败：${list[i]}` };
    const checked = vcInspectSingleVerdict(r.value, i);
    if (!checked.ok) return checked;
    parsed.push(checked);
  }

  const merged = {
    contractId: parsed.find((p) => p.contractId)?.contractId || '',
    judge: parsed.map((p) => p.judge).join(' + '),
    consensus: { totalVotes: parsed.length, judges: parsed.map((p) => p.judge), roundsCap: maxRounds }
  };
  const anyContradiction = parsed.some((p) => p.isContradiction);
  for (const k of VC_ITEMS) {
    const counts = { pass: 0, fail: 0, unknown: 0 };
    const reasons = [];
    for (const p of parsed) {
      counts[p.vals[k].val]++;
      if (p.vals[k].reason) reasons.push(p.vals[k].reason);
    }
    if (anyContradiction && counts.unknown > 0) {
      merged[k] = { verdict: 'unknown', reason: reasons.find((r) => /(矛盾|不一致|对不上)/.test(r)) || '多模型发现材料自相矛盾' };
    } else if (counts.pass > parsed.length / 2) {
      merged[k] = { verdict: 'pass', reason: `多数共识通过 (${counts.pass}/${parsed.length})` };
    } else if (counts.fail > 0 && counts.fail >= counts.unknown) {
      merged[k] = { verdict: 'fail', reason: reasons[0] || `多模型驳回 (${counts.fail}/${parsed.length})` };
    } else {
      merged[k] = { verdict: 'unknown', reason: reasons[0] || '多模型未能对缺失材料达成多数共识' };
    }
  }
  return { ok: true, merged, judges: parsed.map((p) => p.judge) };
}

export function vcEvaluateVerdictMatrix(v) {
  let hasFail = false;
  let hasUnknown = false;
  let isContradiction = false;
  for (const k of VC_ITEMS) {
    const entry = v[k];
    const val = typeof entry === 'string' ? entry : entry?.verdict;
    const reason = typeof entry === 'object' ? (entry?.reason || entry?.rationale || '') : (v.reasons?.[k] || '');
    if (!VC_ALLOWED.has(val)) {
      return { ok: false, exitCode: 3, stderr: `非法作答词 ${k}=${val}（只允许 pass/fail/unknown，退 3）` };
    }
    const pChk = vcValidateSemiFormalProof(k, entry);
    if (!pChk.ok) return { ok: false, exitCode: 3, stderr: `${pChk.reason}（退 3）` };
    if (val === 'fail') hasFail = true;
    if (val === 'unknown') {
      hasUnknown = true;
      if (!String(reason).trim() || !/(缺失|缺|矛盾|不一致|对不上|不可读|材料)/.test(String(reason))) {
        return { ok: false, exitCode: 3, stderr: `invalid-abstain：${k}=unknown 未指明缺失或矛盾材料（退 3）` };
      }
      if (/(矛盾|不一致|对不上)/.test(String(reason))) isContradiction = true;
    }
  }
  return { ok: true, hasFail, hasUnknown, isContradiction };
}

export function vcBuildEscapesRegressionBundle(projectRoot, contractId) {
  const root = resolve(projectRoot);
  const cands = [join(root, 'escapes.jsonl'), join(root, '.donegate', 'escapes.jsonl')];
  const cases = [];
  for (const p of cands) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj !== 'object') continue;
        cases.push({
          id: obj.id || `esc-${cases.length + 1}`,
          symptom: String(obj.symptom || obj.summary || ''),
          rootCause: String(obj.rootCause || ''),
          independentGate: String(obj.independentGate || obj.gate || '')
        });
      } catch (err) {
        void err;
      }
    }
  }
  const outDir = join(root, '.donegate', 'verify');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `escapes-regression-${contractId}.json`);
  const bundle = { schema: 'donegate-judge-escapes-regression/v1', contractId, count: cases.length, cases };
  writeFileSync(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  return { path: outPath, count: cases.length, cases };
}
