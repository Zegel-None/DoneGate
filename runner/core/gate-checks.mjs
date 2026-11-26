// L0 门 0（起手段）、门 1（基线冒烟）、门 2（判据段）校验器（<= 350 行聚焦子模块）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { frozenHashOf, sha256 } from '../../skill/hash.mjs';
import { validateContractSchema } from '../../skill/schema-lite.mjs';
import { evalStageGate } from '../../skill/check-stage.mjs';
import { verifyHeldOutContract } from './heldout-verifier.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { isDeliveryContract, isSelfWriterIdentity, loadContracts, loadThresholds } from './project-loader.mjs';

function gc0CheckIntentHeadings(intent, fails) {
  const headings = intent ? intent.split(/\r?\n/).filter((l) => /^##\s/.test(l)).map((l) => l.trim()) : [];
  const reqHeadings = ['## 为什么做', '## 服务谁', '## 什么算成功', '## 明确不做什么'];
  if (!intent || headings.length !== 4 || !reqHeadings.every((h, i) => headings[i] === h)) {
    fails.push('0.1 INTENT.md 缺失或四节不齐');
  }
}

function gc0CheckConstraintsAndQuotas(projectRoot, cons, fails) {
  if (!cons || !cons.split(/\r?\n/).some((l) => /^(不许|必须)/.test(l.trim()))) {
    fails.push('0.1 CONSTRAINTS.md 缺失或无有效「不许/必须」条目');
    return;
  }
  const thresholds = loadThresholds(projectRoot);
  let inPerm = false, permCount = 0, tempCount = 0;
  for (const line of cons.split(/\r?\n/)) {
    const t = line.trim();
    if (/^##\s*常驻/.test(t)) { inPerm = true; continue; }
    if (/^##\s/.test(t)) { inPerm = false; continue; }
    if (!/^(不许|必须)/.test(t)) continue;
    if (inPerm) permCount++;
    else tempCount++;
  }
  const maxPerm = thresholds.maxPermanentConstraints || 6;
  const maxTemp = thresholds.maxConstraints || 12;
  if (permCount > maxPerm) fails.push(`链 F 常驻约束条数 ${permCount} 超过上限 ${maxPerm}`);
  if (tempCount > maxTemp) fails.push(`链 F 临时约束条数 ${tempCount} 超过上限 ${maxTemp}`);
}

function gc0CompareDecisionNames(a, b) {
  const pa = a.match(/^(\d{4}-\d{2}-\d{2})-(?:(\d{2,4})-)?(.*)$/);
  const pb = b.match(/^(\d{4}-\d{2}-\d{2})-(?:(\d{2,4})-)?(.*)$/);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
  const sa = pa[2] !== undefined ? Number(pa[2]) : -1;
  const sb = pb[2] !== undefined ? Number(pb[2]) : -1;
  return sa !== sb ? sa - sb : a.localeCompare(b);
}

function gc0CheckDecisionHashSync(projectRoot, intent, cons, fails) {
  const decDir = join(projectRoot, 'decisions');
  if (!existsSync(decDir) || !intent || !cons) return;
  const decFiles = readdirSync(decDir).filter((f) => f.endsWith('.md')).sort(gc0CompareDecisionNames);
  if (decFiles.length === 0) return;
  const latestName = decFiles[decFiles.length - 1];
  const latestDec = readMaybe(join(decDir, latestName)) || '';
  const hInt = sha256(readFileSync(join(projectRoot, 'INTENT.md'))).slice(0, 12);
  const hCon = sha256(readFileSync(join(projectRoot, 'CONSTRAINTS.md'))).slice(0, 12);
  if (!latestDec.includes(hInt) && !latestDec.includes(hCon)) {
    fails.push(`0.2 最近一条决策记录（${latestName}）未含当前 INTENT(${hInt}) 或 CONSTRAINTS(${hCon}) 哈希`);
  }
}

function gc0CheckTargetInTopGaps(projectRoot, targetContractId, gapsList, fails) {
  if (!targetContractId || gapsList.length === 0) return;
  const distinctTop3 = [...new Set(gapsList.map((g) => g.contractId).filter(Boolean))].slice(0, 3);
  if (distinctTop3.length === 0 || distinctTop3.includes(targetContractId)) return;
  const cRes = readJsonStrict(join(projectRoot, 'contracts', targetContractId, 'contract.json'));
  const skipReason = cRes.ok && typeof cRes.value.skipReason === 'string' && cRes.value.skipReason.trim();
  if (!skipReason) {
    const topStr = distinctTop3.join('、');
    fails.push(`0.3 契约 ${targetContractId} 不在缺口前 3 位（${topStr}）且未填 skipReason`);
  }
}

function gc0CheckHandoverSectionIntegrity(projectRoot, fails) {
  const hoPath = join(projectRoot, 'HANDOVER.md');
  if (!existsSync(hoPath)) return;
  const ho = readMaybe(hoPath) || '';
  const hasSix = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、'].every((h) => ho.includes(h));
  const hasRecv = ho.includes('### 接收方验收记录') && ['谁跑的', '命令', '输出', '卡住'].every((k) => ho.includes(k));
  if (!hasSix || !hasRecv) fails.push('0.4 HANDOVER.md 缺六节或接收方验收记录四要素');
}

export function evaluateGate0(projectRoot, targetContractId, gapsList = []) {
  const fails = [];
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  const cons = readMaybe(join(projectRoot, 'CONSTRAINTS.md'));
  gc0CheckIntentHeadings(intent, fails);
  gc0CheckConstraintsAndQuotas(projectRoot, cons, fails);
  gc0CheckDecisionHashSync(projectRoot, intent, cons, fails);
  gc0CheckTargetInTopGaps(projectRoot, targetContractId, gapsList, fails);
  gc0CheckHandoverSectionIntegrity(projectRoot, fails);
  return { ok: fails.length === 0, fails };
}

export function evaluateGate1(projectRoot) {
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  if (!intent) return { ok: false, exitCode: 3, reason: '缺少 INTENT.md，无法取得冒烟命令' };
  const m = intent.match(/^冒烟命令：\s*(.+)$/m);
  if (!m || !m[1].trim()) return { ok: false, exitCode: 1, reason: 'INTENT.md 缺少「冒烟命令：」固定行（G-08）' };
  const cmd = m[1].trim();
  const res = spawnSync(cmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 600000 });
  if (res.error) return { ok: false, exitCode: 3, reason: '冒烟命令跑不起来：' + res.error.message };
  if (res.status !== 0) return { ok: false, exitCode: 1, reason: `冒烟命令退出码 ${res.status} ≠ 0` };
  return { ok: true, exitCode: 0, command: cmd };
}

function gc2CheckSingleObligationFreeze(o, latestFreeze, fails) {
  const computed = frozenHashOf(o);
  const chainHash = latestFreeze?.criteriaHashes?.[o.id];
  const chainMismatch = Boolean(latestFreeze && chainHash && o.frozenHash !== chainHash);
  const notFrozen = !o.signedBy || !o.signedBy.trim() || !o.frozenHash || o.frozenHash !== computed || chainMismatch;
  if (notFrozen) {
    const bpHint = o.breakPatch ? '（提示：若在冻结后才补加或修改了 breakPatch，也会导致 frozenHash 变化，请重新执行 contract freeze）' : '';
    const chainNote = chainMismatch ? '与链上冻结记录' : '';
    fails.push(`2.2 判据 ${o.id} 未冻结或 frozenHash ${chainNote}不一致${bpHint}`);
  } else if (isSelfWriterIdentity(o.signedBy)) {
    fails.push(`2.2 / G-10 判据 ${o.id} 的 signedBy 不许填写方自己或 AI 代签`);
  }
  if (o.scopeAck && isSelfWriterIdentity(o.scopeAck.by)) {
    fails.push(`2.2 / G-10 判据 ${o.id} 的 scopeAck.by 不许是本轮写方自己或 AI 代签`);
  }
}

function gc2CheckFrozenObligations(projectRoot, contract, obs, fails) {
  if (obs.length === 0) fails.push('2.1 至少有 1 条判据');
  const chainChk = readAndVerifyChain(projectRoot);
  const latestFreeze = chainChk.ok
    ? chainChk.entries.filter((e) => e.kind === 'freeze' && e.contractId === contract.id).pop()
    : null;
  for (const o of obs) gc2CheckSingleObligationFreeze(o, latestFreeze, fails);
  if (!obs.some((o) => o.kind === 'command')) fails.push('2.3 至少有 1 条 kind: command 判据');
}

function gc2CheckT1bRequirements(projectRoot, obs, fails) {
  const classes = new Set(obs.flatMap((o) => (Array.isArray(o.inputClasses) ? o.inputClasses : [])));
  for (const reqCls of ['正常', '边界', '异常']) {
    if (!classes.has(reqCls)) fails.push(`2.4 契约层面缺少「${reqCls}」输入类别判据`);
  }
  const alPath = join(projectRoot, 'alignment.json');
  if (!existsSync(alPath)) return;
  const al = readJsonStrict(alPath);
  if (!al.ok || !Array.isArray(al.value?.items) || al.value.items.some((x) => !x.judgment)) {
    fails.push('2.9 alignment.json 存在未勾选项 (judgment=null)');
  }
}

function gc2CheckTeethFreshness(obs, thresholds, fails) {
  for (const o of obs) {
    if (o.kind !== 'command') continue;
    const tVal = o.teeth && (o.teeth.result || o.teeth.status);
    if (tVal === 'ignored') continue;
    if (!o.teeth || !o.teeth.at) {
      fails.push(`2.5 判据 ${o.id} 缺少 teeth 实验记录`);
      continue;
    }
    const age = (Date.now() - Date.parse(o.teeth.at)) / 86400000;
    if (age > thresholds.criterionValidDays) fails.push(`2.5 判据 ${o.id} teeth 已过期`);
  }
}

function gc2HasValidCrossSpan(o, knownIds) {
  if (!Array.isArray(o.spansContracts) || o.spansContracts.length < 2) return false;
  return new Set(o.spansContracts).size >= 2 && o.spansContracts.every((cid) => knownIds.has(cid));
}

function gc2CheckCrossContractSpans(projectRoot, fails) {
  const { contracts } = loadContracts(projectRoot);
  const activeContracts = contracts.filter(isDeliveryContract);
  if (activeContracts.length < 2) return;
  const knownIds = new Set(contracts.map((c) => c.id));
  const hasProjectCross = activeContracts.some((c) => (c.obligations || []).some((o) => gc2HasValidCrossSpan(o, knownIds)));
  if (!hasProjectCross) {
    fails.push('2.6 项目已有 ≥2 契约但缺少指向有效契约的 spansContracts 跨契约判据');
  }
}

function gc2CheckDiffLinesBudget(projectRoot, thresholds, fails) {
  // 2.8 本契约的代码加行数不超过 maxDiffLines（默认 400，只数 .ts/.tsx/.js/.mjs/.cjs/.jsx）
  const numstat = spawnSync('git', ['-C', projectRoot, 'diff', '--numstat', 'HEAD~1..HEAD'], { encoding: 'utf8' });
  if (numstat.status !== 0 || !numstat.stdout.trim()) return;
  let codeAdded = 0;
  for (const line of numstat.stdout.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = Number(parts[0]);
    const filePath = parts[2].trim();
    if (Number.isFinite(added) && /\.(ts|tsx|js|mjs|cjs|jsx|py|go|rs)$/i.test(filePath)) {
      codeAdded += added;
    }
  }
  const limit = thresholds.maxDiffLines || 400;
  if (codeAdded > limit) {
    fails.push(`2.8 代码加行数 ${codeAdded} 超过上限 ${limit}（文档不计）`);
  }
}

function gc2CheckT1FullSuccessCriteria(projectRoot, obs, fails) {
  const intent = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  for (const o of obs) {
    if (!o.servesSuccessCriterion || !intent.includes(o.servesSuccessCriterion)) {
      fails.push(`2.7 判据 ${o.id} 的 servesSuccessCriterion 未在 INTENT.md 原文命中`);
    }
  }
}

function gc2CheckIntentReviewAge(projectRoot, fails) {
  // 失效链 G：意图复核期限（60 天）
  const maxDays = loadThresholds(projectRoot).intentReviewDays || 60;
  const intentBody = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const revMatch = intentBody.match(/<!--\s*reviewed:\s*(\d{4}-\d{2}-\d{2})/i);
  if (revMatch) {
    const ageDays = (Date.now() - Date.parse(revMatch[1])) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > maxDays) {
      fails.push(`链 G 意图已超过 ${maxDays} 天未复核（上次 ${revMatch[1]}）`);
    }
    return;
  }
  const gitInt = spawnSync('git', ['-C', projectRoot, 'log', '-1', '--format=%ct', '--', 'INTENT.md'], { encoding: 'utf8' });
  if (gitInt.status !== 0 || !gitInt.stdout.trim()) return;
  const ageDays = (Date.now() - Number(gitInt.stdout.trim()) * 1000) / 86400000;
  if (Number.isFinite(ageDays) && ageDays > maxDays) {
    fails.push(`链 G INTENT.md 已超过 ${maxDays} 天未复核`);
  }
}

export function evaluateGate2(projectRoot, contract, opts = {}) {
  const errs = validateContractSchema(contract, { full: true });
  if (errs.length > 0) return { ok: false, exitCode: 2, fails: errs };
  if (opts.baseRef || opts.heldOutDir || Array.isArray(opts.touchedFiles)) {
    const hv = verifyHeldOutContract(projectRoot, contract, opts);
    if (!hv.ok) return { ok: false, exitCode: hv.exitCode, code: hv.code, fails: hv.fails };
  }
  const st = evalStageGate(projectRoot);
  if (st.exitCode === 1) return { ok: false, exitCode: 1, fails: [st.line] };
  const stage = st.exitCode === 0 ? st.stage : 'T1a';

  const obs = contract.obligations || [];
  const fails = [];
  gc2CheckFrozenObligations(projectRoot, contract, obs, fails);
  if (['T1b', 'T1c', 'T1完整'].includes(stage)) {
    gc2CheckT1bRequirements(projectRoot, obs, fails);
  }
  if (['T1c', 'T1完整'].includes(stage)) {
    const thresholds = loadThresholds(projectRoot);
    gc2CheckTeethFreshness(obs, thresholds, fails);
    gc2CheckCrossContractSpans(projectRoot, fails);
    gc2CheckDiffLinesBudget(projectRoot, thresholds, fails);
  }
  if (stage === 'T1完整') {
    gc2CheckT1FullSuccessCriteria(projectRoot, obs, fails);
  }
  gc2CheckIntentReviewAge(projectRoot, fails);
  return { ok: fails.length === 0, exitCode: fails.length ? 1 : 0, stage, fails };
}
