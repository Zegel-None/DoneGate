// 门 5 多模型共识投票（3 轮上限）、差量半形式化推理校验、硬门禁一票否决融合与回归集构造器（<= 348 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export const VC_ITEMS = ['V1', 'V2', 'V3', 'V4', 'V5'];
export const VC_ALLOWED = new Set(['pass', 'fail', 'unknown']);
export const VC_MAX_ROUNDS = 3;
export const VC_DELTA_INHERIT_TOKEN = '..';

const VC_TRACE_META_KEYS = new Set(['step', 'line', 'op', 'note', 'label']);
const VC_STRING_KV_DELTA_RE = /\b([A-Za-z_$][\w$]*)\s*=\s*('[^']*'|"[^"]*"|\.\.(?![.\w])|[^\s,;|\]]+)/g;

const vcNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const vcPlainObj = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v));

function vcResolveNestedDeltaObj(rawNested, prevNested, stepIdx, parentKey) {
  const nextObj = {};
  for (const [subKey, subVal] of Object.entries(rawNested)) {
    if (subVal !== VC_DELTA_INHERIT_TOKEN) {
      nextObj[subKey] = structuredClone(subVal);
      continue;
    }
    if (stepIdx === 0 || !vcPlainObj(prevNested) || !(subKey in prevNested)) {
      return { ok: false, exitCode: 3, code: 'DANGLING_DELTA_TRACE_REF', reason: `状态追踪 step#${stepIdx + 1} 槽位 ${parentKey}.${subKey}=".." 无前序状态可继承（退 3）` };
    }
    nextObj[subKey] = structuredClone(prevNested[subKey]);
  }
  return { ok: true, value: nextObj };
}

function vcExtractStepStateFrame(stepObj) {
  if (vcPlainObj(stepObj.state)) return stepObj.state;
  const frame = {};
  for (const [k, v] of Object.entries(stepObj)) {
    if (!VC_TRACE_META_KEYS.has(k)) frame[k] = v;
  }
  return frame;
}

function vcStepSingleSlot(k, val, prevState, idx) {
  if (val === VC_DELTA_INHERIT_TOKEN) {
    if (idx === 0 || !(k in prevState)) {
      return { ok: false, exitCode: 3, code: 'DANGLING_DELTA_TRACE_REF', reason: `状态追踪 step#${idx + 1} 槽位 ${k}=".." 缺少可继承的上一步值（退 3）` };
    }
    return { ok: true, value: structuredClone(prevState[k]) };
  }
  if (vcPlainObj(val)) return vcResolveNestedDeltaObj(val, prevState[k], idx, k);
  return { ok: true, value: structuredClone(val) };
}

function vcStepStateFrame(rawStep, prevState, idx) {
  if (!vcPlainObj(rawStep)) {
    return { ok: false, exitCode: 3, code: 'INVALID_TRACE_STEP', reason: `状态追踪 step#${idx + 1} 必须是对象（退 3）` };
  }
  const rawFrame = vcExtractStepStateFrame(rawStep);
  const keys = Object.keys(rawFrame);
  if (keys.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_TRACE_STEP', reason: `状态追踪 step#${idx + 1} 未包含任何变量槽位（退 3）` };
  }
  const nextState = {};
  for (const k of keys) {
    const slotRes = vcStepSingleSlot(k, rawFrame[k], prevState, idx);
    if (!slotRes.ok) return slotRes;
    nextState[k] = slotRes.value;
  }
  const stepEntry = { step: rawStep.step ?? idx + 1, ...(rawStep.line !== undefined ? { line: rawStep.line } : {}), state: structuredClone(nextState) };
  return { ok: true, nextState, stepEntry };
}

export function vcExpandDeltaStateTrace(traceSteps) {
  if (!Array.isArray(traceSteps) || traceSteps.length === 0) {
    return { ok: false, exitCode: 3, code: 'EMPTY_TRACE_STEPS', reason: '差量状态追踪表不能为空（退 3）' };
  }
  let prevState = {};
  const steps = [];
  for (let idx = 0; idx < traceSteps.length; idx++) {
    const stepped = vcStepStateFrame(traceSteps[idx], prevState, idx);
    if (!stepped.ok) return stepped;
    prevState = stepped.nextState;
    steps.push(stepped.stepEntry);
  }
  return { ok: true, steps, finalState: structuredClone(prevState) };
}

function vcValidateStringDeltaLines(lines) {
  const knownVars = new Set();
  for (let idx = 0; idx < lines.length; idx++) {
    for (const m of String(lines[idx] || '').matchAll(VC_STRING_KV_DELTA_RE)) {
      const varName = m[1], rawVal = m[2].replace(/^['"]|['"]$/g, '');
      if (rawVal === VC_DELTA_INHERIT_TOKEN && (idx === 0 || !knownVars.has(varName))) {
        return { ok: false, exitCode: 3, code: 'DANGLING_DELTA_TRACE_REF', reason: `字符追踪 step#${idx + 1} 变量 ${varName}=.. 缺少前序初始定义（退 3）` };
      }
      knownVars.add(varName);
    }
  }
  return { ok: true };
}

function vcVerifyProofTracePayload(itemKey, p) {
  const trace = p.executionTrace;
  let expanded = null;
  if (Array.isArray(p.stateTrace)) {
    const stChk = vcExpandDeltaStateTrace(p.stateTrace);
    if (!stChk.ok) return stChk;
    expanded = stChk;
  }
  if (vcNonEmpty(trace)) return { ok: true, expanded };
  if (!Array.isArray(trace) || trace.length === 0) {
    return { ok: false, exitCode: 3, reason: `${itemKey}.proof 缺少必填半形式化字段（premise / executionTrace / conclusion）` };
  }
  if (trace.every(vcPlainObj)) {
    const objChk = vcExpandDeltaStateTrace(trace);
    return objChk.ok ? { ok: true, expanded: objChk } : objChk;
  }
  if (!trace.some(vcNonEmpty)) {
    return { ok: false, exitCode: 3, reason: `${itemKey}.proof 缺少必填半形式化字段（premise / executionTrace / conclusion）` };
  }
  const strDeltaChk = vcValidateStringDeltaLines(trace.filter((x) => typeof x === 'string'));
  return strDeltaChk.ok ? { ok: true, expanded } : strDeltaChk;
}

export function vcValidateSemiFormalProof(itemKey, entry, verdictVal) {
  const resolvedVal = verdictVal ?? (typeof entry === 'string' ? entry : entry?.verdict);
  if (!vcPlainObj(entry) || entry.proof === undefined) {
    return resolvedVal === 'fail'
      ? { ok: false, exitCode: 3, code: 'MISSING_FAIL_EXECUTION_TRACE', reason: `${itemKey}=fail 必须附带包含非空 premise / executionTrace / conclusion 的 proof 反例追踪` }
      : { ok: true };
  }
  const p = entry.proof;
  if (!vcPlainObj(p) || !vcNonEmpty(p.premise) || !vcNonEmpty(p.conclusion)) {
    return { ok: false, exitCode: 3, reason: `${itemKey}.proof 缺少必填半形式化字段（premise / executionTrace / conclusion）` };
  }
  const traceChk = vcVerifyProofTracePayload(itemKey, p);
  if (!traceChk.ok) return traceChk;
  return traceChk.expanded ? { ok: true, expandedTrace: traceChk.expanded.steps, finalState: traceChk.expanded.finalState } : { ok: true };
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
  const entry = v[k], val = typeof entry === 'string' ? entry : entry?.verdict;
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
  if (!vcPlainObj(v)) return { ok: false, exitCode: 2, stderr: `${label} 判定书顶层必须是 JSON 对象（退 2）` };
  const envChk = vcValidateExecutionEnvelope(v, opts);
  if (!envChk.ok) return { ok: false, exitCode: envChk.exitCode, code: envChk.code, stderr: `${label} ${envChk.stderr}` };
  const vals = {}, contradictionItems = new Set();
  for (const k of VC_ITEMS) {
    const it = vcInspectVoteItem(k, v, Boolean(opts.strictAllVotes));
    if (!it.ok) return { ok: false, exitCode: it.exitCode, stderr: `${label} ${it.stderr}` };
    if (it.val === 'unknown' && /(矛盾|不一致|对不上)/.test(it.reason)) contradictionItems.add(k);
    vals[k] = { val: it.val, reason: it.reason, proof: it.proof };
  }
  return { ok: true, judge: String(v.judge || `judge-${idx + 1}`), contractId: String(v.contractId || '').trim(), vals, contradictionItems };
}

function vcTallyItemVotes(k, parsed) {
  const counts = { pass: 0, fail: 0, unknown: 0 }, reasons = { pass: [], fail: [], unknown: [] };
  let firstFailProof, contradiction = false;
  for (const p of parsed) {
    const it = p.vals[k];
    counts[it.val]++;
    if (it.reason) reasons[it.val].push(it.reason);
    if (it.val === 'fail' && !firstFailProof) firstFailProof = it.proof;
    contradiction = contradiction || p.contradictionItems.has(k);
  }
  return { counts, reasons, firstFailProof, contradiction };
}

function vcAggregateSingleItem(k, parsed) {
  const { counts, reasons, firstFailProof, contradiction } = vcTallyItemVotes(k, parsed);
  if (contradiction && counts.unknown > 0) {
    return { verdict: 'unknown', reason: reasons.unknown.find((r) => /(矛盾|不一致|对不上)/.test(r)) || '多模型发现材料自相矛盾' };
  }
  if (counts.pass > parsed.length / 2) return { verdict: 'pass', reason: `多数共识通过 (${counts.pass}/${parsed.length})` };
  if (counts.fail > 0 && counts.fail >= counts.unknown) {
    return { verdict: 'fail', reason: reasons.fail[0] || `多模型驳回 (${counts.fail}/${parsed.length})`, ...(firstFailProof ? { proof: firstFailProof } : {}) };
  }
  return { verdict: 'unknown', reason: reasons.unknown[0] || '多模型未能对缺失材料达成多数共识' };
}

function vcLoadAndValidateVoteList(projectRoot, list, opts) {
  const parsed = [], seenFiles = new Set();
  for (let i = 0; i < list.length; i++) {
    const abs = resolve(projectRoot, list[i]), normAbs = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seenFiles.has(normAbs)) return { ok: false, exitCode: 2, stderr: `禁止重复提交同一份投票文件（退 2）：${list[i]}` };
    seenFiles.add(normAbs);
    if (!existsSync(abs)) return { ok: false, exitCode: 3, stderr: `投票判定书不存在：${list[i]}` };
    const r = readJsonStrict(abs);
    if (!r.ok || !r.value) return { ok: false, exitCode: r.error === 'parse' ? 2 : 3, stderr: `投票判定书解析失败：${list[i]}` };
    const checked = vcInspectSingleVerdict(r.value, i, opts);
    if (!checked.ok) return checked;
    parsed.push(checked);
  }
  return { ok: true, parsed };
}

export function vcAggregateVoteFiles(projectRoot, votePaths, maxRounds = VC_MAX_ROUNDS, opts = {}) {
  const rawList = Array.isArray(votePaths) ? votePaths : String(votePaths || '').split(',');
  const list = rawList.map((s) => String(s || '').trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, exitCode: 3, stderr: '多模型共识 --votes 不能为空' };
  if (list.length > maxRounds) return { ok: false, exitCode: 3, stderr: `多模型盲审轮次/票数 (${list.length}) 超出上限 (${maxRounds})，请收敛后重评（退 3）` };
  const loaded = vcLoadAndValidateVoteList(projectRoot, list, opts);
  if (!loaded.ok) return loaded;
  const { parsed } = loaded;
  const distinctContractIds = [...new Set(parsed.map((p) => p.contractId).filter(Boolean))];
  if (distinctContractIds.length > 1) return { ok: false, exitCode: 2, stderr: `投票判定书 contractId 不一致（${distinctContractIds.join(' vs ')}），禁止跨契约混投（退 2）` };
  const judges = parsed.map((p) => p.judge);
  const merged = { contractId: distinctContractIds[0] || '', judge: judges.join(' + '), consensus: { totalVotes: parsed.length, judges, roundsCap: maxRounds } };
  for (const k of VC_ITEMS) merged[k] = vcAggregateSingleItem(k, parsed);
  const finalChk = vcEvaluateVerdictMatrix(merged);
  return finalChk.ok ? { ok: true, merged, judges } : finalChk;
}

export function vcEvaluateVerdictMatrix(v, opts = {}) {
  if (!vcPlainObj(v)) return { ok: false, exitCode: 2, stderr: '判定书顶层必须是 JSON 对象（退 2）' };
  const envChk = vcValidateExecutionEnvelope(v, opts);
  if (!envChk.ok) return envChk;
  let hasFail = false, hasUnknown = false, isContradiction = false;
  for (const k of VC_ITEMS) {
    const it = vcInspectVoteItem(k, v, true);
    if (!it.ok) return it;
    if (it.val === 'fail') hasFail = true;
    if (it.val === 'unknown') hasUnknown = true;
    if (it.val === 'unknown' && /(矛盾|不一致|对不上)/.test(it.reason)) isContradiction = true;
  }
  return { ok: true, hasFail, hasUnknown, isContradiction };
}

function vcReadGateExitCode(item) {
  if (Number.isInteger(item?.exitCode)) return item.exitCode;
  if (Number.isInteger(item?.status)) return item.status;
  return item?.ok === false ? 1 : 0;
}

function vcNormalizeHardGateOutcome(hardGateResult) {
  if (!hardGateResult || typeof hardGateResult !== 'object') {
    return { exitCode: 3, gateLabel: 'missing-hard-gate', detail: '缺少确定性硬门禁结果' };
  }
  let list = [hardGateResult];
  if (Array.isArray(hardGateResult)) list = hardGateResult;
  else if (Array.isArray(hardGateResult.checks)) list = hardGateResult.checks;
  for (const item of list) {
    const code = vcReadGateExitCode(item);
    if (code !== 0) {
      return { exitCode: code, gateLabel: String(item?.gateId || item?.id || item?.code || 'deterministic-hard-gate'), detail: String(item?.reason || item?.stderr || `退出码 ${code}`) };
    }
  }
  return { exitCode: vcReadGateExitCode(hardGateResult), gateLabel: String(hardGateResult.gateId || hardGateResult.id || 'deterministic-hard-gate'), detail: String(hardGateResult.reason || hardGateResult.stderr || '') };
}

function vcMapMatrixSummary(m) {
  if (!m.ok) return { ok: false, exitCode: m.exitCode, verdict: 'unknown' };
  if (m.isContradiction) return { ok: false, exitCode: 2, verdict: 'unknown' };
  if (m.hasFail) return { ok: false, exitCode: 1, verdict: 'fail' };
  return m.hasUnknown ? { ok: false, exitCode: 3, verdict: 'unknown' } : { ok: true, exitCode: 0, verdict: 'pass' };
}

function vcSummarizeJudgeConsensus(consensusResult) {
  if (!vcPlainObj(consensusResult)) return { ok: false, exitCode: 3, verdict: 'unknown' };
  const doc = consensusResult.merged || consensusResult.verdict || consensusResult;
  if (vcPlainObj(doc) && VC_ITEMS.every((k) => k in doc)) return vcMapMatrixSummary(vcEvaluateVerdictMatrix(doc));
  if (consensusResult.hasFail || consensusResult.exitCode === 1 || consensusResult.verdict === 'fail') return { ok: false, exitCode: 1, verdict: 'fail' };
  const isPass = consensusResult.ok === true && (consensusResult.exitCode === 0 || consensusResult.exitCode === undefined);
  return isPass ? { ok: true, exitCode: 0, verdict: 'pass' } : { ok: false, exitCode: consensusResult.exitCode || 3, verdict: 'unknown' };
}

export function vcFuseHardGateWithJudgeVotes(hardGateResult, consensusResult) {
  const hg = vcNormalizeHardGateOutcome(hardGateResult);
  const judgeSummary = vcSummarizeJudgeConsensus(consensusResult);
  if (hg.exitCode !== 0) {
    const reason = `确定性硬门禁 [${hg.gateLabel}] 为红（exitCode=${hg.exitCode}：${hg.detail}），一票否决多模型盲审结论 (${judgeSummary.verdict} -> fail)`;
    return { ok: false, exitCode: hg.exitCode === 2 ? 2 : 1, verdict: 'fail', finalVerdict: 'fail', vetoedByHardGate: true, hardGateExitCode: hg.exitCode, vetoGate: hg.gateLabel, judgeConsensusBeforeVeto: judgeSummary.verdict, reason };
  }
  return { ok: judgeSummary.ok, exitCode: judgeSummary.exitCode, verdict: judgeSummary.verdict, finalVerdict: judgeSummary.verdict, vetoedByHardGate: false, hardGateExitCode: 0, judgeConsensusBeforeVeto: judgeSummary.verdict };
}

function vcParseEscapeCaseLine(line, nextSeq) {
  try {
    const obj = JSON.parse(line);
    if (!vcPlainObj(obj)) return null;
    return { id: obj.id || `esc-${nextSeq}`, symptom: String(obj.symptom || obj.summary || ''), rootCause: String(obj.rootCause || ''), independentGate: String(obj.independentGate || obj.gate || '') };
  } catch (err) {
    void err;
    return null;
  }
}

export function vcBuildEscapesRegressionBundle(projectRoot, contractId) {
  const root = resolve(projectRoot), cases = [];
  for (const p of [join(root, 'escapes.jsonl'), join(root, '.donegate', 'escapes.jsonl')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      const item = vcParseEscapeCaseLine(line, cases.length + 1);
      if (item) cases.push(item);
    }
  }
  const outDir = join(root, '.donegate', 'verify');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `escapes-regression-${contractId}.json`);
  writeFileSync(outPath, JSON.stringify({ schema: 'donegate-judge-escapes-regression/v1', contractId, count: cases.length, cases }, null, 2) + '\n', 'utf8');
  return { path: outPath, count: cases.length, cases };
}
