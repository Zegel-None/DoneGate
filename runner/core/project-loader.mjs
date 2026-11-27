// L1 项目配置、契约/功能清单与运行证据加载原语（<= 350 行聚焦子模块）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { materialFingerprintOf, sha256 } from '../../skill/hash.mjs';

export const DEFAULT_SUBAGENT_BUDGET = {
  contextWindowTokens: 1000000,
  targetUtilization: 0.4,
  totalSessionBudgetTokens: 400000,
  routerBudgetTokens: 8000,
  zeroHopSourceBudgetTokens: 160000,
  oneHopContractBudgetTokens: 48000,
  onDemandExpandBudgetTokens: 64000,
  multiTurnReserveTokens: 120000,
  receiptBudgetTokens: 500
};

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
  maxContracts: 16,
  maxResliceCount: 3,
  maxCriteriaPerFileRatio: 2,
  maxNewCriteriaPerRound: 3,
  minSignoffSecPerCriterion: 20,
  unstableStreak: 3,
  maxDiffLines: 450,
  warnCommitCodeLines: 250,
  maxCommitCodeLines: 450,
  maxRawCommitCodeLines: 900,
  maxProdCommitFiles: 6,
  maxCommitFiles: 10,
  warnEffectiveFileLines: 600,
  maxEffectiveFileLines: 850,
  maxFileLines: 1200,
  warnFunctionLines: 160,
  warnCognitiveComplexity: 15,
  maxCognitiveComplexity: 25,
  subagentContextBudget: { ...DEFAULT_SUBAGENT_BUDGET },
  bannedPatterns: []
};

export const SELF_WRITER_RE = /^(?:自己|本人|本轮写方|写方|写方自己|写手|agent|ai|llm|model|assistant|bot|copilot|devin|aider|cline|roo|codex|cursor|windsurf|antigravity|(?:claude|gpt|gemini|deepseek|qwen|llama|mistral|sonnet|opus|haiku|o[134])(?:[-._\s][A-Za-z0-9._-]+)*)$/i;

export function isSelfWriterIdentity(val) {
  if (typeof val !== 'string') return false;
  const t = val.trim();
  if (!t) return false;
  return SELF_WRITER_RE.test(t) || /写方自己|本轮写方/.test(t);
}

export function isDeliveryContract(c) {
  return Boolean(c && !c.retired && c.track !== 'explore');
}

export const STATE_PRIORITY = { '无法判断': 6, '未通过': 5, '不稳定': 4, '过期': 3, '未验证': 2, '通过': 1 };
export const VALID_TEETH = new Set([
  'killed', 'survived', 'no-coverage', 'compile-error', 'runtime-error',
  'timeout', 'red-wrong-assertion', 'restore-failed', 'pending', 'ignored', 'hollow-assertion'
]);

export function loadThresholds(projectRoot) {
  const p = join(projectRoot, 'thresholds.json');
  if (!existsSync(p)) return { ...DEFAULT_THRESHOLDS, subagentContextBudget: { ...DEFAULT_SUBAGENT_BUDGET } };
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') {
    return { ...DEFAULT_THRESHOLDS, subagentContextBudget: { ...DEFAULT_SUBAGENT_BUDGET } };
  }
  return {
    ...DEFAULT_THRESHOLDS,
    ...r.value,
    subagentContextBudget: {
      ...DEFAULT_SUBAGENT_BUDGET,
      ...(r.value.subagentContextBudget && typeof r.value.subagentContextBudget === 'object' ? r.value.subagentContextBudget : {})
    }
  };
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

export function readEvidenceRuns(projectRoot, contractId, obligationId) {
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

function plCollectCurrentScopeFiles(projectRoot, contract) {
  if (!contract || !Array.isArray(contract.scope)) return null;
  const set = new Set();
  for (const s of contract.scope) {
    if (typeof s !== 'string' || !s.trim()) continue;
    const abs = resolve(projectRoot, s);
    if (!existsSync(abs)) continue;
    try {
      const st = statSync(abs);
      if (st.isFile()) {
        set.add(s.replace(/\\/g, '/').replace(/^\.\//, ''));
      } else if (st.isDirectory()) {
        for (const e of readdirSync(abs, { withFileTypes: true, recursive: true })) {
          if (!e.isFile()) continue;
          const full = join(e.parentPath || abs, e.name);
          set.add(relative(projectRoot, full).replace(/\\/g, '/'));
        }
      }
    } catch (err) { void err; }
  }
  return set;
}

export function checkMaterialsFresh(projectRoot, startObj, contract = null) {
  if (!startObj || !Array.isArray(startObj.materials)) return true;
  if (startObj.materials.length === 0) {
    const scopeFiles = plCollectCurrentScopeFiles(projectRoot, contract);
    return !scopeFiles || scopeFiles.size === 0;
  }
  const current = [];
  const recordedSet = new Set();
  for (const m of startObj.materials) {
    if (!m || !m.path) return false;
    recordedSet.add(String(m.path).replace(/\\/g, '/').replace(/^\.\//, ''));
    const abs = resolve(projectRoot, m.path);
    if (!existsSync(abs)) return false;
    try { current.push({ path: m.path, sha256: sha256(readFileSync(abs)) }); }
    catch { return false; }
  }
  const scopeFiles = plCollectCurrentScopeFiles(projectRoot, contract);
  if (scopeFiles) {
    for (const f of scopeFiles) {
      if (!recordedSet.has(f)) return false;
    }
  }
  return materialFingerprintOf(startObj.materials) === materialFingerprintOf(current);
}

export function checkHumanOutcome(run) {
  if (run.end && (run.end.result === 'pass' || run.end.result === 'success')) return '通过';
  if (run.end && (run.end.result === 'fail' || run.end.result === 'failure')) return '未通过';
  return '无法判断';
}
