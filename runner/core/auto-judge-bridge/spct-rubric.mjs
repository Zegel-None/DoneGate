// 门 5 零后果中性审词清洗、SPCT 契约动态核查准则与首错行号覆盖率守卫（归属契约：verdict-core，<= 230 行）
import { stripCrossSessionReasoning } from '../review-evidence-sanitizer.mjs';

export const MIN_VALID_LINE_NUMBER = 1;
export const LINE_RANGE_TUPLE_LENGTH = 2;
export const NEUTRAL_FACT_AUDIT_DIRECTIVE = '【零后果客观核查声明】本次门 5 独立盲审仅执行客观技术事实、契约不变量与代码证据核对，评审结论与任何外部考核或模型处置完全解耦；请严格依据可验证证据如实判定 pass / fail / unknown。';

const PAREN_CONSEQUENCE_RE = /[（(][^（）()\n]*(?:判错扣分|漏判扣分|误判扣分|打回扣分|扣\s*\d*\s*分|严惩|重罚|惩罚|处分|重训|回炉|淘汰|奖励|加分|奖惩|追责|问责|penaliz(?:e|ed|ing)|penalt(?:y|ies)|punish(?:ed|ment|ing)?|retrain(?:ed|ing)?|decommission(?:ed|ing)?|deduct\s+points|lose\s+points|bonus\s+points|reward(?:ed|s)?)[^（）()\n]*[）)]/gi;
const CLAUSE_CONSEQUENCE_RE = /[^，,；;。！？!?\n]*(?:判错扣分|漏判扣分|误判扣分|打回扣分|扣\s*\d*\s*分|严惩|重罚|惩罚|处分|重训|回炉|淘汰|给予奖励|奖励|加分|奖惩|追责|问责|penaliz(?:e|ed|ing)|penalt(?:y|ies)|punish(?:ed|ment|ing)?|retrain(?:ed|ing)?|decommission(?:ed|ing)?|deduct\s+points|lose\s+points|bonus\s+points|reward(?:ed|s)?)[^，,；;。！？!?\n]*[，,；;。！？!?]?/gi;
const RESIDUAL_CONSEQUENCE_RE = /(?:判错扣分|漏判扣分|误判扣分|打回扣分|扣分|严惩|重罚|惩罚|处分|重训|回炉|淘汰|奖励|加分|奖惩)/g;
const INVALID_FILE_TOKENS = new Set(['', 'unknown', 'n/a', 'na', 'none', '*', '/dev/null']);
const DEFAULT_EXCLUSIONS = Object.freeze([
  '排除契约 scope 之外未认领文件的非关联改动',
  '排除无真实可达反例的纯代码风格、命名偏好或微优化建议',
  '排除写方内部推理链、上下文压缩摘要与主观完成自辩'
]);

function spctNormPath(rawPath) {
  return String(rawPath || '').trim().replace(/\\/g, '/').replace(/^(?:\.\/|[ab]\/)/, '').replace(/^\/+/, '');
}

function spctNormalizeScopeList(rawScope) {
  const arr = Array.isArray(rawScope) ? rawScope : String(rawScope || '').split(',');
  const cleaned = arr.map((s) => String(s || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
  return [...new Set(cleaned)];
}

function spctFileMatchesScope(relFile, scopeEntry) {
  if (scopeEntry.endsWith('/')) return relFile.startsWith(scopeEntry);
  if (relFile === scopeEntry || relFile.startsWith(`${scopeEntry}/`)) return true;
  const stem = scopeEntry.replace(/\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i, '');
  return stem !== scopeEntry && relFile.startsWith(`${stem}/`);
}

export function sanitizeConsequenceFreeJudgePrompt(promptText) {
  let body = stripCrossSessionReasoning(String(promptText ?? '')).trim();
  if (body.startsWith(NEUTRAL_FACT_AUDIT_DIRECTIVE)) {
    body = body.slice(NEUTRAL_FACT_AUDIT_DIRECTIVE.length).trim();
  }
  const stripped = body
    .replace(PAREN_CONSEQUENCE_RE, '')
    .replace(CLAUSE_CONSEQUENCE_RE, '')
    .replace(RESIDUAL_CONSEQUENCE_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped ? `${NEUTRAL_FACT_AUDIT_DIRECTIVE}\n\n${stripped}` : NEUTRAL_FACT_AUDIT_DIRECTIVE;
}

function spctPickDiffHeaderPath(line, state) {
  const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (gitMatch) {
    state.pendingMinus = null;
    return spctNormPath(gitMatch[2] === '/dev/null' ? gitMatch[1] : gitMatch[2]);
  }
  if (line.startsWith('--- a/')) {
    state.pendingMinus = spctNormPath(line.slice(6));
    return '';
  }
  if (!line.startsWith('+++ ')) return '';
  const plusRaw = line.slice(4).trim();
  const chosen = plusRaw === '/dev/null' ? state.pendingMinus : spctNormPath(plusRaw);
  state.pendingMinus = null;
  return chosen || '';
}

export function extractDiffTouchedFiles(diffText) {
  const files = [];
  const state = { pendingMinus: null };
  for (const line of String(diffText || '').split(/\r?\n/)) {
    const picked = spctPickDiffHeaderPath(line, state);
    if (picked && !INVALID_FILE_TOKENS.has(picked.toLowerCase())) files.push(picked);
  }
  return [...new Set(files)];
}

function spctParseContractInput(contractInput) {
  if (contractInput && typeof contractInput === 'object' && !Array.isArray(contractInput)) return contractInput;
  const text = String(contractInput || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      void err;
    }
  }
  return { why: text };
}

function spctReadInvariantText(inv) {
  if (typeof inv === 'string') return inv.trim();
  if (!inv || typeof inv !== 'object') return '';
  return String(inv.claim || inv.rule || inv.description || inv.text || '').trim();
}

function spctCollectInvariants(invariants, checkpoints) {
  if (!Array.isArray(invariants)) return;
  for (let i = 0; i < invariants.length; i++) {
    const inv = invariants[i];
    const text = spctReadInvariantText(inv);
    if (!text) continue;
    const id = (typeof inv === 'object' && inv?.id) ? String(inv.id) : `INV-${i + 1}`;
    checkpoints.push({ id, source: 'invariant', targetScope: '*', criterion: text });
  }
}

function spctFormatSingleObligation(ob, index) {
  const id = String(ob.id || `OB-${index + 1}`);
  const claim = String(ob.claim || ob.servesSuccessCriterion || id).trim();
  const obs = String(ob.observable || '').trim();
  const obScope = typeof ob.scope === 'string' ? ob.scope.trim() : '';
  return {
    checkpoint: { id, source: 'obligation', targetScope: obScope || '*', criterion: obs ? `${claim}（可观察判据：${obs}）` : claim },
    exclusion: (obScope && /(?:不覆盖|不含|排除|不处理)/.test(obScope)) ? `${id} 边界排除：${obScope}` : ''
  };
}

function spctCollectObligations(obligations, checkpoints, exclusions) {
  if (!Array.isArray(obligations)) return;
  for (let i = 0; i < obligations.length; i++) {
    const ob = obligations[i];
    if (!ob || typeof ob !== 'object') continue;
    const formatted = spctFormatSingleObligation(ob, i);
    checkpoints.push(formatted.checkpoint);
    if (formatted.exclusion) exclusions.push(formatted.exclusion);
  }
}

export function deriveContractJudgeRubric(contractInput) {
  const doc = spctParseContractInput(contractInput);
  const contractId = String(doc.id || doc.contractId || 'unknown-contract').trim() || 'unknown-contract';
  const scopeEntries = spctNormalizeScopeList(doc.scope);
  const positiveCheckpoints = [];
  const rawExcl = Array.isArray(doc.exclusions) ? doc.exclusions : (Array.isArray(doc.outOfScope) ? doc.outOfScope : []);
  const exclusions = rawExcl.map((x) => String(x || '').trim()).filter(Boolean);
  spctCollectInvariants(doc.invariants, positiveCheckpoints);
  spctCollectObligations(doc.obligations, positiveCheckpoints, exclusions);
  const whyText = stripCrossSessionReasoning(String(doc.why || '')).trim();
  if (whyText) positiveCheckpoints.push({ id: `${contractId}-why`, source: 'why', targetScope: scopeEntries.join(',') || '*', criterion: whyText });
  if (positiveCheckpoints.length === 0 && scopeEntries.length > 0) {
    positiveCheckpoints.push({ id: `${contractId}-scope`, source: 'scope', targetScope: scopeEntries.join(','), criterion: `核查 ${scopeEntries.join(', ')} 内改动与契约边界一致且无越界破坏` });
  }
  return Object.freeze({
    schema: 'donegate-spct-rubric/v1',
    contractId,
    scopeEntries,
    positiveCheckpoints,
    exclusions: [...new Set([...exclusions, ...DEFAULT_EXCLUSIONS])],
    antiEarlyStopRule: '必须逐一核查完 scope 内全部受改动文件并输出完整 auditedFiles[]，严禁抓到首个缺陷即早停漏审其余文件。',
    firstErrorRule: '任何 verdict==="fail" 的缺陷项必须附带精确 targetFile 与正整数闭区间 lineRange: [startLine, endLine] (1 <= startLine <= endLine)。'
  });
}

function spctResolveCoverageInputs(contractOrScope, diffFilesOrText, verdictDoc) {
  if (verdictDoc !== undefined) return { scopeSpec: contractOrScope, diffSpec: diffFilesOrText, verdict: verdictDoc };
  const secondLooksLikeVerdict = Boolean(
    diffFilesOrText && typeof diffFilesOrText === 'object' && !Array.isArray(diffFilesOrText) &&
    ('auditedFiles' in diffFilesOrText || 'V1' in diffFilesOrText)
  );
  return secondLooksLikeVerdict
    ? { scopeSpec: contractOrScope, diffSpec: [], verdict: diffFilesOrText }
    : { scopeSpec: contractOrScope, diffSpec: diffFilesOrText, verdict: {} };
}

export function verifyFullScopeAuditCoverage(contractOrScope, diffFilesOrText, verdictDoc) {
  const { scopeSpec, diffSpec, verdict } = spctResolveCoverageInputs(contractOrScope, diffFilesOrText, verdictDoc);
  const rawScope = (scopeSpec && typeof scopeSpec === 'object' && !Array.isArray(scopeSpec)) ? scopeSpec.scope : scopeSpec;
  const scopeEntries = spctNormalizeScopeList(rawScope);
  const touched = Array.isArray(diffSpec)
    ? [...new Set(diffSpec.map(spctNormPath).filter(Boolean))]
    : extractDiffTouchedFiles(diffSpec);
  let expectedFiles = touched;
  if (touched.length > 0 && scopeEntries.length > 0) {
    expectedFiles = touched.filter((f) => scopeEntries.some((s) => spctFileMatchesScope(f, s)));
  } else if (touched.length === 0 && scopeEntries.length > 0) {
    expectedFiles = scopeEntries.filter((s) => !s.endsWith('/'));
  }
  const hasAuditedField = Array.isArray(verdict?.auditedFiles);
  const auditedFiles = hasAuditedField ? [...new Set(verdict.auditedFiles.map(spctNormPath).filter(Boolean))] : [];
  const auditedSet = new Set(auditedFiles);
  const missingFiles = expectedFiles.filter((f) => !auditedSet.has(f));
  if (expectedFiles.length > 0 && (!hasAuditedField || missingFiles.length > 0)) {
    return {
      ok: false,
      exitCode: 3,
      code: 'EARLY_STOP_INCOMPLETE_SCOPE_AUDIT',
      expectedFiles,
      auditedFiles,
      missingFiles,
      reason: `门 5 防首错早停拦截：scope 内受改动文件共 ${expectedFiles.length} 个，裁判漏审 [${missingFiles.join(', ')}]（退 3）`
    };
  }
  return { ok: true, expectedFiles, auditedFiles, missingFiles: [] };
}

export function validateFirstErrorLocation(itemKey, entry) {
  const val = typeof entry === 'string' ? entry : entry?.verdict;
  if (val !== 'fail') return { ok: true };
  const rawFile = entry?.targetFile ?? entry?.proof?.targetFile;
  const targetFile = spctNormPath(rawFile);
  if (!targetFile || INVALID_FILE_TOKENS.has(targetFile.toLowerCase()) || targetFile.includes('\0')) {
    return {
      ok: false,
      exitCode: 3,
      code: 'MISSING_FAIL_TARGET_FILE',
      reason: `${itemKey}=fail 缺少精确首错文件路径 targetFile，拒绝采信空泛打回意见（退 3）`
    };
  }
  const rawRange = entry?.lineRange ?? entry?.proof?.lineRange;
  const validTuple = Array.isArray(rawRange) && rawRange.length === LINE_RANGE_TUPLE_LENGTH;
  const startLine = validTuple ? rawRange[0] : NaN;
  const endLine = validTuple ? rawRange[1] : NaN;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < MIN_VALID_LINE_NUMBER || startLine > endLine) {
    return {
      ok: false,
      exitCode: 3,
      code: 'INVALID_FAIL_LINE_RANGE',
      reason: `${itemKey}=fail 缺少合法正整数闭区间 lineRange: [startLine, endLine]（须满足 1 <= startLine <= endLine，退 3）`
    };
  }
  return { ok: true, targetFile, lineRange: [startLine, endLine] };
}
