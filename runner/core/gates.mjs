// L0 门禁与状态现算引擎（INV-01..INV-18、五状态六栏总账、门 0–门 2 校验）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { frozenHashOf, materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { validateContractSchema } from '../../skill/schema-lite.mjs';
import { evalStageGate } from '../../skill/check-stage.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { classifyBySpecTable, propagateImpact } from '../engine.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { ensureRunnerConfig } from './isolation.mjs';

export const DEFAULT_THRESHOLDS = {
  maxConstraints: 12,
  maxPermanentConstraints: 6,
  maxTempConstraintDays: 90,
  intentReviewDays: 60,
  timeoutSec: 600,
  maxOutputChars: 262144,
  coverageFullPct: 60,
  coverageMinPct: 30,
  criterionValidDays: 90,
  maxContracts: 8,
  maxResliceCount: 3,
  maxCriteriaPerFileRatio: 2,
  maxNewCriteriaPerRound: 3,
  minSignoffSecPerCriterion: 20,
  unstableStreak: 3,
  maxDiffLines: 400
};

const STATE_PRIORITY = { '无法判断': 5, '未通过': 4, '过期': 3, '未验证': 2, '通过': 1 };
const VALID_TEETH = new Set([
  'killed', 'survived', 'no-coverage', 'compile-error', 'runtime-error',
  'timeout', 'red-wrong-assertion', 'restore-failed', 'pending', 'ignored', 'hollow-assertion'
]);

export function loadThresholds(projectRoot) {
  const p = join(projectRoot, 'thresholds.json');
  if (!existsSync(p)) return { ...DEFAULT_THRESHOLDS };
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') return { ...DEFAULT_THRESHOLDS };
  return { ...DEFAULT_THRESHOLDS, ...r.value };
}

export function loadContracts(projectRoot) {
  const cDir = join(projectRoot, 'contracts');
  const contracts = [];
  const errors = [];
  if (!existsSync(cDir)) return { contracts, errors };
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(cDir, e.name, 'contract.json');
    if (!existsSync(p)) continue;
    const r = readJsonStrict(p);
    if (!r.ok) { errors.push({ id: e.name, error: r.error, path: p }); continue; }
    if (r.value.id !== e.name) { errors.push({ id: e.name, error: 'id-dir-mismatch', path: p }); continue; }
    contracts.push(r.value);
  }
  return { contracts, errors };
}

export function loadFunctions(projectRoot) {
  const fDir = join(projectRoot, 'functions');
  const functions = [];
  const errors = [];
  if (!existsSync(fDir)) return { functions, errors };
  for (const e of readdirSync(fDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const fileId = e.name.replace(/\.json$/, '');
    const p = join(fDir, e.name);
    const r = readJsonStrict(p);
    if (!r.ok) { errors.push({ id: fileId, error: r.error, path: p }); continue; }
    functions.push({ ...r.value, _fileId: fileId });
  }
  return { functions, errors };
}

function readEvidenceRuns(projectRoot, contractId, obligationId) {
  const baseDir = join(projectRoot, '.donegate', 'evidence', contractId, obligationId);
  if (!existsSync(baseDir)) return [];
  let dirs;
  try {
    dirs = readdirSync(baseDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { return []; }
  const runs = [];
  for (const d of dirs) {
    const runDir = join(baseDir, d);
    const sPath = join(runDir, 'start.json');
    const rPath = join(runDir, 'report.json');
    const ePath = join(runDir, 'end.json');
    if (!existsSync(sPath) || !existsSync(rPath) || !existsSync(ePath)) {
      runs.push({ ts: d, valid: false, reason: '证据三件套不齐' });
      continue;
    }
    let sRaw, rRaw, eRaw, sObj, rObj, eObj;
    try {
      sRaw = readFileSync(sPath, 'utf8');
      rRaw = readFileSync(rPath, 'utf8');
      eRaw = readFileSync(ePath, 'utf8');
      sObj = JSON.parse(sRaw);
      rObj = JSON.parse(rRaw);
      eObj = JSON.parse(eRaw);
    } catch {
      runs.push({ ts: d, valid: false, reason: '证据 JSON 不可读或损坏' });
      continue;
    }
    const hS = sha256(sRaw), hR = sha256(rRaw);
    const link1 = rObj.hashStart === hS || rObj.startSha256 === hS;
    const link2 = eObj.hashReport === hR || eObj.reportSha256 === hR;
    if (!link1 || !link2) {
      runs.push({ ts: d, valid: false, reason: '证据互哈希链断裂' });
      continue;
    }
    runs.push({ ts: d, valid: true, start: sObj, report: rObj, end: eObj });
  }
  return runs;
}

function checkMaterialsFresh(projectRoot, startObj) {
  if (!startObj || !Array.isArray(startObj.materials) || startObj.materials.length === 0) return true;
  const current = [];
  for (const m of startObj.materials) {
    if (!m || !m.path) return false;
    const abs = resolve(projectRoot, m.path);
    if (!existsSync(abs)) return false;
    try { current.push({ path: m.path, sha256: sha256(readFileSync(abs)) }); }
    catch { return false; }
  }
  return materialFingerprintOf(startObj.materials) === materialFingerprintOf(current);
}

function checkHumanOutcome(run) {
  if (run.end && (run.end.result === 'pass' || run.end.result === 'success')) return '通过';
  if (run.end && (run.end.result === 'fail' || run.end.result === 'failure')) return '未通过';
  return '无法判断';
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
  const hashMatches = hasSigned && typeof ob.frozenHash === 'string' && ob.frozenHash === frozenHashOf(ob);
  const wasExpired = latest && latest.valid && !checkMaterialsFresh(projectRoot, latest.start);
  if (hasSigned && ob.frozenHash && !hashMatches) {
    // INV-15: 在「过期」状态下改写判据且未重签 → 未验证；否则 INV-06 → 无法判断
    return {
      id: ob.id,
      state: wasExpired ? '未验证' : '无法判断',
      reason: wasExpired ? '过期状态下改写判据且未重签（INV-15）' : '判据内容变更但未重签（INV-06）',
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

  // 自动消费 codegraph 声明（经核侧复算校验后驱动 engine.mjs 算出 pendingRecheck）
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
      contractSummaries.push({ id: c.id, title: c.title, retired: c.retired, state: '已退役', obligations: [] });
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
    contractSummaries.push({
      id: c.id,
      title: c.title || c.id,
      state: obs.length === 0 ? '未定验收' : worstState,
      cleared: Boolean(allTrusted && signedOff && worstState === '通过'),
      signedOff,
      passTrusted: reqCmds.filter((x) => x.subclass === 'A1').length,
      passTotal: reqCmds.length,
      obligations: obResults
    });
  }

  // 功能层计数（§3.3.1 & INV-17 & INV-18）
  const activeContractIds = new Set(contracts.filter((c) => !c.retired).map((c) => c.id));
  const knownAllContractIds = new Set(contracts.map((c) => c.id));
  const referencedIds = new Set(functions.flatMap((f) => Array.isArray(f.contracts) ? f.contracts : []));
  const orphanContracts = [...activeContractIds].filter((id) => !referencedIds.has(id));
  const orphanFunctions = functions.filter((f) => !Array.isArray(f.contracts) || f.contracts.length === 0 || f.contracts.some((cid) => !knownAllContractIds.has(cid)));
  const badSourceFunctions = functions.filter((f) => typeof f.source !== 'string' || f.source.trim() === '' || /(基于分析|根据规范|从代码推断|总结|概括)/.test(f.source));
  const badNameFunctions = functions.filter((f) => f.id && f._fileId !== f.id);

  // J3 过程信号：统计 .donegate/adapters/*/claim.json 中 unresolved 总数
  let unresolvedTotal = 0;
  const adpDir = join(projectRoot, '.donegate', 'adapters');
  if (existsSync(adpDir)) {
    for (const e of readdirSync(adpDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const cRes = readJsonStrict(join(adpDir, e.name, 'claim.json'));
      if (cRes.ok && cRes.value && Array.isArray(cRes.value.unresolved)) unresolvedTotal += cRes.value.unresolved.length;
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
    ledger, humanStats, ignoredList, contractSummaries,
    orphanContracts, orphanFunctions, badSourceFunctions, badNameFunctions,
    unresolvedTotal, ledgerLines, funcLine, j3Line, isolationNotice, autoImpact
  };
}

export function evaluateGate0(projectRoot, targetContractId, gapsList = []) {
  const fails = [];
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  const cons = readMaybe(join(projectRoot, 'CONSTRAINTS.md'));
  const headings = intent ? intent.split(/\r?\n/).filter((l) => /^##\s/.test(l)).map((l) => l.trim()) : [];
  const reqHeadings = ['## 为什么做', '## 服务谁', '## 什么算成功', '## 明确不做什么'];
  if (!intent || headings.length !== 4 || !reqHeadings.every((h, i) => headings[i] === h)) {
    fails.push('0.1 INTENT.md 缺失或四节不齐');
  }
  if (!cons || !cons.split(/\r?\n/).some((l) => /^(不许|必须)/.test(l.trim()))) {
    fails.push('0.1 CONSTRAINTS.md 缺失或无有效「不许/必须」条目');
  } else {
    // 失效链 F：常驻（上限 6）与临时（上限 12）配额核对
    const thresholds = loadThresholds(projectRoot);
    let inPerm = false, permCount = 0, tempCount = 0;
    for (const line of cons.split(/\r?\n/)) {
      const t = line.trim();
      if (/^##\s*常驻/.test(t)) { inPerm = true; continue; }
      if (/^##\s/.test(t)) { inPerm = false; continue; }
      if (/^(不许|必须)/.test(t)) {
        if (inPerm) permCount++;
        else tempCount++;
      }
    }
    if (permCount > (thresholds.maxPermanentConstraints || 6)) {
      fails.push(`链 F 常驻约束条数 ${permCount} 超过上限 ${thresholds.maxPermanentConstraints || 6}`);
    }
    if (tempCount > (thresholds.maxConstraints || 12)) {
      fails.push(`链 F 临时约束条数 ${tempCount} 超过上限 ${thresholds.maxConstraints || 12}`);
    }
  }
  // 0.2 INTENT / CONSTRAINTS 哈希必须在最近一条决策记录中出现（若存在 decisions/）
  const decDir = join(projectRoot, 'decisions');
  if (existsSync(decDir) && intent && cons) {
    const decFiles = readdirSync(decDir).filter((f) => f.endsWith('.md')).sort();
    if (decFiles.length > 0) {
      const latestDec = readMaybe(join(decDir, decFiles[decFiles.length - 1])) || '';
      const hInt = sha256(readFileSync(join(projectRoot, 'INTENT.md')));
      const hCon = sha256(readFileSync(join(projectRoot, 'CONSTRAINTS.md')));
      if (!latestDec.includes(hInt.slice(0, 12)) && !latestDec.includes(hCon.slice(0, 12))) {
        fails.push('0.2 最近一条决策记录未含当前 INTENT 或 CONSTRAINTS 哈希');
      }
    }
  }
  // 0.3 前 3 位缺口或 skipReason
  if (targetContractId && gapsList.length > 0) {
    const top3 = gapsList.slice(0, 3).map((g) => g.contractId).filter(Boolean);
    if (top3.length > 0 && !top3.includes(targetContractId)) {
      const cRes = readJsonStrict(join(projectRoot, 'contracts', targetContractId, 'contract.json'));
      const skipReason = cRes.ok && typeof cRes.value.skipReason === 'string' && cRes.value.skipReason.trim();
      if (!skipReason) fails.push(`0.3 契约 ${targetContractId} 不在缺口前 3 位且未填 skipReason`);
    }
  }
  // 0.4 若已存在 HANDOVER.md（进入阶段 6），要求六节齐且含接收方验收记录四要素
  const hoPath = join(projectRoot, 'HANDOVER.md');
  if (existsSync(hoPath)) {
    const ho = readMaybe(hoPath) || '';
    const hasSix = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、'].every((h) => ho.includes(h));
    const hasRecv = ho.includes('### 接收方验收记录') && /谁跑的/.test(ho) && /命令/.test(ho) && /输出/.test(ho) && /卡住/.test(ho);
    if (!hasSix || !hasRecv) fails.push('0.4 HANDOVER.md 缺六节或接收方验收记录四要素');
  }
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

export function evaluateGate2(projectRoot, contract) {
  const errs = validateContractSchema(contract, { full: true });
  if (errs.length > 0) return { ok: false, exitCode: 2, fails: errs };
  const st = evalStageGate(projectRoot);
  if (st.exitCode === 1) return { ok: false, exitCode: 1, fails: [st.line] };
  const stage = st.exitCode === 0 ? st.stage : 'T1a';

  const obs = contract.obligations || [];
  const fails = [];
  if (obs.length === 0) fails.push('2.1 至少有 1 条判据');
  for (const o of obs) {
    if (!o.signedBy || !o.signedBy.trim() || o.frozenHash !== frozenHashOf(o)) {
      fails.push(`2.2 判据 ${o.id} 未冻结或 frozenHash 不一致`);
    }
  }
  if (!obs.some((o) => o.kind === 'command')) fails.push('2.3 至少有 1 条 kind: command 判据');

  if (['T1b', 'T1c', 'T1完整'].includes(stage)) {
    const classes = new Set(obs.flatMap((o) => Array.isArray(o.inputClasses) ? o.inputClasses : []));
    for (const reqCls of ['正常', '边界', '异常']) {
      if (!classes.has(reqCls)) fails.push(`2.4 契约层面缺少「${reqCls}」输入类别判据`);
    }
    const alPath = join(projectRoot, 'alignment.json');
    if (existsSync(alPath)) {
      const al = readJsonStrict(alPath);
      if (!al.ok || !Array.isArray(al.value?.items) || al.value.items.some((x) => !x.judgment)) {
        fails.push('2.9 alignment.json 存在未勾选项 (judgment=null)');
      }
    }
  }
  if (['T1c', 'T1完整'].includes(stage)) {
    const thresholds = loadThresholds(projectRoot);
    for (const o of obs) {
      if (!o.teeth || !o.teeth.at) fails.push(`2.5 判据 ${o.id} 缺少 teeth 实验记录`);
      else {
        const age = (Date.now() - Date.parse(o.teeth.at)) / 86400000;
        if (age > thresholds.criterionValidDays) fails.push(`2.5 判据 ${o.id} teeth 已过期`);
      }
    }
    const { contracts } = loadContracts(projectRoot);
    if (contracts.filter((c) => !c.retired).length >= 2) {
      if (!obs.some((o) => Array.isArray(o.spansContracts) && o.spansContracts.length >= 2)) {
        fails.push('2.6 项目已有 ≥2 契约但缺少 spansContracts 跨契约判据');
      }
    }
    // 2.8 本契约的代码加行数不超过 maxDiffLines（默认 400，只数 .ts/.tsx/.js/.mjs/.cjs/.jsx）
    const numstat = spawnSync('git', ['-C', projectRoot, 'diff', '--numstat', 'HEAD~1..HEAD'], { encoding: 'utf8' });
    if (numstat.status === 0 && numstat.stdout.trim()) {
      let codeAdded = 0;
      for (const line of numstat.stdout.split(/\r?\n/)) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const added = Number(parts[0]);
        const filePath = parts[2].trim();
        if (Number.isFinite(added) && /\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(filePath)) {
          codeAdded += added;
        }
      }
      if (codeAdded > (thresholds.maxDiffLines || 400)) {
        fails.push(`2.8 代码加行数 ${codeAdded} 超过上限 ${thresholds.maxDiffLines || 400}（文档不计）`);
      }
    }
  }
  if (stage === 'T1完整') {
    const intent = readMaybe(join(projectRoot, 'INTENT.md')) || '';
    for (const o of obs) {
      if (!o.servesSuccessCriterion || !intent.includes(o.servesSuccessCriterion)) {
        fails.push(`2.7 判据 ${o.id} 的 servesSuccessCriterion 未在 INTENT.md 原文命中`);
      }
    }
  }
  // 失效链 G：意图复核期限（60 天）
  const thresholdsAll = loadThresholds(projectRoot);
  const intentBody = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const revMatch = intentBody.match(/<!--\s*reviewed:\s*(\d{4}-\d{2}-\d{2})/i);
  if (revMatch) {
    const ageDays = (Date.now() - Date.parse(revMatch[1])) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > (thresholdsAll.intentReviewDays || 60)) {
      fails.push(`链 G 意图已超过 ${thresholdsAll.intentReviewDays || 60} 天未复核（上次 ${revMatch[1]}）`);
    }
  } else {
    const gitInt = spawnSync('git', ['-C', projectRoot, 'log', '-1', '--format=%ct', '--', 'INTENT.md'], { encoding: 'utf8' });
    if (gitInt.status === 0 && gitInt.stdout.trim()) {
      const ageDays = (Date.now() - Number(gitInt.stdout.trim()) * 1000) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > (thresholdsAll.intentReviewDays || 60)) {
        fails.push(`链 G INTENT.md 已超过 ${thresholdsAll.intentReviewDays || 60} 天未复核`);
      }
    }
  }
  return { ok: fails.length === 0, exitCode: fails.length === 0 ? 0 : 1, stage, fails };
}
