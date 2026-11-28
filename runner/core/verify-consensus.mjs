// 门 5 多模型共识投票（3 轮上限）、半形式化推理校验与 escapes.jsonl 回归集构造器（<= 350 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export const VC_ITEMS = ['V1', 'V2', 'V3', 'V4', 'V5'];
export const VC_ALLOWED = new Set(['pass', 'fail', 'unknown']);
export const VC_MAX_ROUNDS = 3;

const vcNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const vcPlainObj = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v));

export function vcValidateSemiFormalProof(itemKey, entry, verdictVal) {
  const resolvedVal = verdictVal ?? (typeof entry === 'string' ? entry : entry?.verdict);
  if (!vcPlainObj(entry) || entry.proof === undefined) {
    return resolvedVal === 'fail'
      ? { ok: false, exitCode: 3, code: 'MISSING_FAIL_EXECUTION_TRACE', reason: `${itemKey}=fail 必须附带包含非空 premise / executionTrace / conclusion 的 proof 反例追踪` }
      : { ok: true };
  }
  const p = entry.proof;
  if (!vcPlainObj(p)) {
    return { ok: false, exitCode: 3, reason: `${itemKey}.proof 必须是包含 premise / executionTrace / conclusion 的对象` };
  }
  const hasTrace = vcNonEmpty(p.executionTrace) || (Array.isArray(p.executionTrace) && p.executionTrace.some(vcNonEmpty));
  if (!vcNonEmpty(p.premise) || !hasTrace || !vcNonEmpty(p.conclusion)) {
    return { ok: false, exitCode: 3, reason: `${itemKey}.proof 缺少必填半形式化字段（premise / executionTrace / conclusion）` };
  }
  return { ok: true };
}

function vcCheckEnvelopeBody(env, opts) {
  if (env.independent !== true) return { ok: false, exitCode: 2, code: 'NON_INDEPENDENT_JUDGE', stderr: '门 5 执行信封 independent 必须为 true，拒绝非独立自审（退 2）' };
  const validPid = Number.isInteger(env.runnerPid) && env.runnerPid > 0;
  if (![env.harness, env.modelId, env.packManifestSha256].every(vcNonEmpty) || !validPid) {
    return { ok: false, exitCode: 2, code: 'INCOMPLETE_EXECUTION_ENVELOPE', stderr: 'executionEnvelope 缺少必填字段（harness / modelId / runnerPid / packManifestSha256，退 2）' };
  }
  if (vcNonEmpty(opts.expectedPackManifestSha256) && env.packManifestSha256.trim() !== opts.expectedPackManifestSha256.trim()) {
    return { ok: false, exitCode: 2, code: 'PACK_MANIFEST_HASH_MISMATCH', stderr: 'executionEnvelope.packManifestSha256 与当前复核包不一致（退 2）' };
  }
  return { ok: true, present: true, envelope: env };
}

export function vcValidateExecutionEnvelope(verdictDoc, opts = {}) {
  if (!vcPlainObj(verdictDoc)) return { ok: false, exitCode: 2, code: 'INVALID_VERDICT_DOC', stderr: '判定书顶层必须是 JSON 对象（退 2）' };
  const env = verdictDoc.executionEnvelope;
  const writerSid = String(opts.writerSessionId || env?.writerSessionId || verdictDoc.writerSessionId || '').trim();
  const judgeSid = String(env?.sessionId || env?.judgeSessionId || verdictDoc.sessionId || '').trim();
  if (writerSid && judgeSid && writerSid === judgeSid) {
    return { ok: false, exitCode: 2, code: 'SAME_SESSION_SELF_REVIEW', stderr: `门 5 独立性事故：裁判会话 (${judgeSid}) 与写方会话相同，拒绝同源自我盲审（退 2）` };
  }
  if (env === undefined) {
    return (opts.requireEnvelope || opts.requiresHeterogeneousJudge)
      ? { ok: false, exitCode: 2, code: 'MISSING_EXECUTION_ENVELOPE', stderr: '必判档门 5 裁决缺少 executionEnvelope 独立运行信封（退 2）' }
      : { ok: true, present: false };
  }
  return vcPlainObj(env) ? vcCheckEnvelopeBody(env, opts) : { ok: false, exitCode: 2, code: 'INVALID_EXECUTION_ENVELOPE', stderr: 'executionEnvelope 必须是 JSON 对象（退 2）' };
}

function vcInspectVoteItem(k, v, requireFailProof) {
  const entry = v[k];
  const val = typeof entry === 'string' ? entry : entry?.verdict;
  const reason = String(vcPlainObj(entry) ? (entry.reason || entry.rationale || '') : (v.reasons?.[k] || ''));
  if (!VC_ALLOWED.has(val)) return { ok: false, exitCode: 3, stderr: `非法作答词 ${k}=${val}（只允许 pass/fail/unknown，退 3）` };
  const hasProof = vcPlainObj(entry) && entry.proof !== undefined;
  const pChk = vcValidateSemiFormalProof(k, entry, val);
  if ((hasProof || requireFailProof) && !pChk.ok) return { ok: false, exitCode: 3, code: pChk.code, stderr: `${pChk.reason}（退 3）` };
  if (val === 'unknown' && !/(缺失|缺|矛盾|不一致|对不上|不可读|材料)/.test(reason.trim())) {
    return { ok: false, exitCode: 3, stderr: `invalid-abstain：${k}=unknown 未指明缺失或矛盾材料（退 3）` };
  }
  return { ok: true, val, reason, proof: (pChk.ok && hasProof) ? entry.proof : undefined };
}

function vcInspectSingleVerdict(v, idx, opts = {}) {
  const label = `vote#${idx + 1}`;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, exitCode: 2, stderr: `${label} 判定书顶层必须是 JSON 对象（退 2）` };
  }
  const envChk = vcValidateExecutionEnvelope(v, opts);
  if (!envChk.ok) return { ok: false, exitCode: envChk.exitCode, code: envChk.code, stderr: `${label} ${envChk.stderr}` };
  const vals = {};
  const contradictionItems = new Set();
  for (const k of VC_ITEMS) {
    const it = vcInspectVoteItem(k, v, Boolean(opts.strictAllVotes));
    if (!it.ok) return { ok: false, exitCode: it.exitCode, stderr: `${label} ${it.stderr}` };
    if (it.val === 'unknown' && /(矛盾|不一致|对不上)/.test(it.reason)) contradictionItems.add(k);
    vals[k] = { val: it.val, reason: it.reason, proof: it.proof };
  }
  return { ok: true, judge: String(v.judge || `judge-${idx + 1}`), contractId: String(v.contractId || '').trim(), vals, contradictionItems };
}

function vcAggregateSingleItem(k, parsed) {
  const counts = { pass: 0, fail: 0, unknown: 0 };
  const reasonsByVal = { pass: [], fail: [], unknown: [] };
  let firstFailProof, itemContradiction = false;
  for (const p of parsed) {
    const val = p.vals[k].val;
    counts[val]++;
    if (p.vals[k].reason) reasonsByVal[val].push(p.vals[k].reason);
    if (val === 'fail' && p.vals[k].proof && !firstFailProof) firstFailProof = p.vals[k].proof;
    if (p.contradictionItems.has(k)) itemContradiction = true;
  }
  if (itemContradiction && counts.unknown > 0) {
    return { verdict: 'unknown', reason: reasonsByVal.unknown.find((r) => /(矛盾|不一致|对不上)/.test(r)) || '多模型发现材料自相矛盾' };
  }
  if (counts.pass > parsed.length / 2) {
    return { verdict: 'pass', reason: `多数共识通过 (${counts.pass}/${parsed.length})` };
  }
  if (counts.fail > 0 && counts.fail >= counts.unknown) {
    return { verdict: 'fail', reason: reasonsByVal.fail[0] || `多模型驳回 (${counts.fail}/${parsed.length})`, ...(firstFailProof ? { proof: firstFailProof } : {}) };
  }
  return { verdict: 'unknown', reason: reasonsByVal.unknown[0] || '多模型未能对缺失材料达成多数共识' };
}

export function vcAggregateVoteFiles(projectRoot, votePaths, maxRounds = VC_MAX_ROUNDS, opts = {}) {
  const list = Array.isArray(votePaths)
    ? votePaths.map((s) => String(s || '').trim()).filter(Boolean)
    : String(votePaths || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, exitCode: 3, stderr: '多模型共识 --votes 不能为空' };
  if (list.length > maxRounds) {
    return { ok: false, exitCode: 3, stderr: `多模型盲审轮次/票数 (${list.length}) 超出上限 (${maxRounds})，请收敛后重评（退 3）` };
  }

  const parsed = [];
  const seenFiles = new Set();
  for (let i = 0; i < list.length; i++) {
    const abs = resolve(projectRoot, list[i]);
    const normAbs = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seenFiles.has(normAbs)) {
      return { ok: false, exitCode: 2, stderr: `禁止重复提交同一份投票文件（退 2）：${list[i]}` };
    }
    seenFiles.add(normAbs);
    if (!existsSync(abs)) return { ok: false, exitCode: 3, stderr: `投票判定书不存在：${list[i]}` };
    const r = readJsonStrict(abs);
    if (!r.ok || !r.value) return { ok: false, exitCode: r.error === 'parse' ? 2 : 3, stderr: `投票判定书解析失败：${list[i]}` };
    const checked = vcInspectSingleVerdict(r.value, i, opts);
    if (!checked.ok) return checked;
    parsed.push(checked);
  }
  const distinctContractIds = [...new Set(parsed.map((p) => p.contractId).filter(Boolean))];
  if (distinctContractIds.length > 1) {
    return { ok: false, exitCode: 2, stderr: `投票判定书 contractId 不一致（${distinctContractIds.join(' vs ')}），禁止跨契约混投（退 2）` };
  }

  const merged = {
    contractId: distinctContractIds[0] || '',
    judge: parsed.map((p) => p.judge).join(' + '),
    consensus: { totalVotes: parsed.length, judges: parsed.map((p) => p.judge), roundsCap: maxRounds }
  };
  for (const k of VC_ITEMS) {
    merged[k] = vcAggregateSingleItem(k, parsed);
  }
  const finalChk = vcEvaluateVerdictMatrix(merged);
  return finalChk.ok ? { ok: true, merged, judges: parsed.map((p) => p.judge) } : finalChk;
}

export function vcEvaluateVerdictMatrix(v, opts = {}) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, exitCode: 2, stderr: '判定书顶层必须是 JSON 对象（退 2）' };
  }
  const envChk = vcValidateExecutionEnvelope(v, opts);
  if (!envChk.ok) return envChk;
  let hasFail = false;
  let hasUnknown = false;
  let isContradiction = false;
  for (const k of VC_ITEMS) {
    const it = vcInspectVoteItem(k, v, true);
    if (!it.ok) return it;
    if (it.val === 'fail') hasFail = true;
    if (it.val === 'unknown') hasUnknown = true;
    if (it.val === 'unknown' && /(矛盾|不一致|对不上)/.test(it.reason)) isContradiction = true;
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
