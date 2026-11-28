// 四级去空白保缩进容错替换器与裸省略占位写前阻断原语（伴生子模块，继承 shared-primitives 归属，<= 210 行）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { executeFlexiblePatchBatch } from './flexible-patch-batch.mjs';

const MAX_WRAPPER_STRIP_PASSES = 2, MAX_UNESCAPE_PASSES = 2;
const TOKEN_DELIMITERS = [...'():[]{}><=;,'], OMITTED_EXACT_SET = new Set(['rest of', 'omitted', 'omitted for brevity']);
const OMITTED_EN_RE = /^(?:(?:rest of(?: the)?|unchanged|existing|remaining|previous|other)\s+(?:code|implementations?|methods?|functions?|logic|body|lines|files?|components?|handlers|imports|exports|fields|items|members|statements|parts?|sections?)|(?:code|implementations?|methods?|functions?|logic)\s+(?:unchanged|omitted))$/;
const OMITTED_ZH_RE = /^(?:其余|剩余|原有|上述|中间)(?:的)?(?:代码|逻辑|实现|方法|函数|内容|部分|组件)(?:\s*(?:保持不变|不变|省略|同上|略))?$/;
const UNESCAPE_CHAR_MAP = { n: '\n', r: '\r', t: '\t', '"': '"', "'": "'", '`': '`', '\\': '\\' };
const COMMENT_WRAPPERS = [['{/*', '*/}'], ['<!--', '-->'], ['/*', '*/']], BRACKET_PAIRS = [['(', ')'], ['[', ']'], ['{', '}']];
const fpLeadingWs = (line) => (line.match(/^([ \t]*)/) || ['', ''])[1], fpPhysLines = (text) => String(text || '').replace(/\r?\n$/, '').split(/\r?\n/).length;
const fpLineNumberAt = (normSrc, idx) => normSrc.slice(0, Math.max(0, idx)).split('\n').length;

function fpStripCommentWrapper(s) {
  for (const [open, close] of COMMENT_WRAPPERS) if (s.startsWith(open) && s.endsWith(close)) return s.slice(open.length, -close.length).trim();
  return s.startsWith('//') ? s.slice(2).trim() : (s.startsWith('#') ? s.slice(1).trim() : s);
}
function fpNormalizeOmissionLine(rawLine) {
  let cur = fpStripCommentWrapper(String(rawLine || '').trim().replace(/;$/, '').trim());
  for (let p = 0; p < MAX_WRAPPER_STRIP_PASSES && BRACKET_PAIRS.some(([o, c]) => cur.startsWith(o) && cur.endsWith(c)); p++) cur = fpStripCommentWrapper(cur.slice(1, -1).trim());
  if (!/^(?:\.\.+|…)/.test(cur) && !/(?:\.\.+|…)$/.test(cur)) return null;
  const core = cur.replace(/^(?:\.\.+|…)+\s*/, '').replace(/\s*(?:\.\.+|…)+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (core && (OMITTED_EXACT_SET.has(core) || OMITTED_EN_RE.test(core) || OMITTED_ZH_RE.test(core))) ? `${core} ...` : null;
}
export function detectBareOmissionPlaceholders(codeText) {
  return String(codeText || '').replace(/\r\n/g, '\n').split('\n').map(fpNormalizeOmissionLine).filter(Boolean);
}
const fpUnescapeSingleLayer = (s) => s.replace(/\\([nrt"'`\\])/g, (_, c) => UNESCAPE_CHAR_MAP[c] ?? c);
function fpResolveUnescapePasses(str, targetSource) {
  if (typeof str !== 'string' || !str || typeof targetSource !== 'string' || !targetSource) return { value: str, passes: 0 };
  const normTarget = targetSource.replace(/\r\n/g, '\n'), hitsTarget = (s) => targetSource.includes(s) || normTarget.includes(s.replace(/\r\n/g, '\n'));
  if (hitsTarget(str)) return { value: str, passes: 0 };
  let cur = str;
  for (let pass = 1; pass <= MAX_UNESCAPE_PASSES; pass++) {
    const next = fpUnescapeSingleLayer(cur);
    if (next === cur) break;
    if (hitsTarget(next)) return { value: next, passes: pass };
    cur = next;
  }
  return { value: str, passes: 0 };
}
export function unescapeOverEscapedSnippet(str, targetSource) { return fpResolveUnescapePasses(str, targetSource).value; }
function fpCollectAddedPlaceholders(oldText, newText) {
  const oldCounts = new Map(), added = [];
  for (const p of detectBareOmissionPlaceholders(oldText)) oldCounts.set(p, (oldCounts.get(p) || 0) + 1);
  for (const p of detectBareOmissionPlaceholders(newText)) {
    const prev = oldCounts.get(p) || 0;
    if (prev > 0) oldCounts.set(p, prev - 1); else added.push(p);
  }
  return added;
}
function fpAmbiguousOrNull(strategy, matchLines, allowMultiple) {
  return (!allowMultiple && matchLines.length > 1) ? { ok: false, reasonCode: 'AMBIGUOUS_MATCH', strategy, occurrences: matchLines.length, matchLines } : null;
}
function fpIsMidIndentHit(src, idx, normOld, normNew) {
  const ls = src.lastIndexOf('\n', Math.max(0, idx - 1)) + 1;
  return idx > ls && /^[ \t]+$/.test(src.slice(ls, idx)) && (/^[ \t]/.test(normOld) || normNew.includes('\n'));
}
function fpTryExactStage(normSource, normOld, normNew, allowMultiple) {
  const indices = [];
  for (let idx = normSource.indexOf(normOld, 0); idx >= 0; idx = normSource.indexOf(normOld, idx + normOld.length)) {
    if (fpIsMidIndentHit(normSource, idx, normOld, normNew)) return null;
    indices.push(idx);
  }
  if (indices.length === 0) return null;
  const matchLines = indices.map((idx) => fpLineNumberAt(normSource, idx));
  return fpAmbiguousOrNull('exact', matchLines, allowMultiple) || { ok: true, strategy: 'exact', occurrences: indices.length, matchLine: matchLines[0], normContent: normSource.split(normOld).join(normNew) };
}
function fpReindentSingleLine(line, targetIndent, refIndent, spaceOnly) {
  if (line.trim() === '') return '';
  const lineIndent = fpLeadingWs(line), body = line.slice(lineIndent.length);
  if (lineIndent.startsWith(refIndent)) return targetIndent + lineIndent.slice(refIndent.length) + body;
  return (spaceOnly && !lineIndent.includes('\t')) ? ' '.repeat(Math.max(0, targetIndent.length + lineIndent.length - refIndent.length)) + body : targetIndent + body;
}
function fpReindentLines(replaceLines, targetIndent, fallbackRefIndent = '') {
  const firstNonEmpty = replaceLines.find((l) => l.trim() !== '');
  const refIndent = firstNonEmpty !== undefined ? fpLeadingWs(firstNonEmpty) : fallbackRefIndent;
  return replaceLines.map((line) => fpReindentSingleLine(line, targetIndent, refIndent, !targetIndent.includes('\t') && !refIndent.includes('\t')));
}
function fpTryFlexibleLineStage(normSource, normOld, normNew, allowMultiple) {
  const hadNl = normOld.endsWith('\n'), searchLines = (hadNl ? normOld.slice(0, -1) : normOld).split('\n'), strippedNeedle = searchLines.map((l) => l.trim());
  if (strippedNeedle.every((l) => l === '')) return null;
  const srcLines = normSource.split('\n'), hits = [];
  for (let i = 0; i <= srcLines.length - strippedNeedle.length; i++) {
    if (strippedNeedle.every((nl, k) => srcLines[i + k].trim() === nl)) { hits.push(i); i += strippedNeedle.length - 1; }
  }
  if (hits.length === 0) return null;
  const matchLines = hits.map((idx) => idx + 1), amb = fpAmbiguousOrNull('flexible', matchLines, allowMultiple);
  if (amb) return amb;
  const replaceLines = normNew === '' ? [] : ((hadNl && normNew.endsWith('\n')) ? normNew.slice(0, -1) : normNew).split('\n');
  const codeOff = Math.max(0, strippedNeedle.findIndex((l) => l !== '')), oldRefIndent = fpLeadingWs(searchLines[codeOff] || ''), nextLines = [...srcLines];
  for (let h = hits.length - 1; h >= 0; h--) {
    const startIdx = hits[h], targetIndent = fpLeadingWs(nextLines[startIdx + codeOff] || nextLines[startIdx] || '');
    nextLines.splice(startIdx, strippedNeedle.length, ...fpReindentLines(replaceLines, targetIndent, oldRefIndent));
  }
  return { ok: true, strategy: 'flexible', occurrences: hits.length, matchLine: matchLines[0], normContent: nextLines.join('\n') };
}
function fpBuildTokenPattern(normOld) {
  let spaced = normOld.trim();
  for (const d of TOKEN_DELIMITERS) spaced = spaced.split(d).join(` ${d} `);
  const tokens = spaced.split(/\s+/).filter(Boolean);
  return tokens.length === 0 ? null : tokens.map((tok, i) => {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return i === 0 ? esc : (/\w$/.test(tokens[i - 1]) && /^\w/.test(tok) ? '\\s+' : '\\s*') + esc;
  }).join('');
}
function fpTryTokenRegexStage(normSource, normOld, normNew, allowMultiple) {
  const tokenPattern = fpBuildTokenPattern(normOld);
  if (!tokenPattern) return null;
  const anchoredHits = [...normSource.matchAll(new RegExp(`^([ \\t]*)(?:${tokenPattern})`, 'gm'))], useAnchored = anchoredHits.length > 0;
  const hits = useAnchored ? anchoredHits : [...normSource.matchAll(new RegExp(tokenPattern, 'g'))];
  if (hits.length === 0) return null;
  const matchLines = hits.map((m) => fpLineNumberAt(normSource, m.index)), amb = fpAmbiguousOrNull('token-regex', matchLines, allowMultiple);
  if (amb) return amb;
  const replaceLines = ((normOld.endsWith('\n') && normNew.endsWith('\n')) ? normNew.slice(0, -1) : normNew).split('\n');
  let out = normSource;
  for (let h = hits.length - 1; h >= 0; h--) {
    const m = hits[h], lineStart = out.lastIndexOf('\n', Math.max(0, m.index - 1)) + 1;
    const aligned = fpReindentLines(replaceLines, useAnchored ? (m[1] || '') : fpLeadingWs(out.slice(lineStart)));
    const rep = useAnchored ? aligned.join('\n') : [replaceLines[0].trimStart(), ...aligned.slice(1)].join('\n');
    out = out.slice(0, m.index) + rep + out.slice(m.index + m[0].length);
  }
  return { ok: true, strategy: 'token-regex', occurrences: hits.length, matchLine: matchLines[0], normContent: out };
}
function fpPrepareUnescapedInputs(src, rawOld, rawNew) {
  const unesc = fpResolveUnescapePasses(rawOld, src);
  let effNew = rawNew;
  if (unesc.passes > 0 && !rawNew.includes('\n') && /\\[ntr"'`\\]/.test(rawNew)) {
    for (let p = 0; p < unesc.passes; p++) effNew = fpUnescapeSingleLayer(effNew);
  }
  return { effOld: unesc.value, effNew, unescaped: unesc.passes > 0 };
}
export function applyFlexibleReplacement(sourceText, oldStr, newStr, opts = {}) {
  const src = String(sourceText ?? ''), rawOld = String(oldStr ?? ''), rawNew = String(newStr ?? '');
  if (!rawOld) return { ok: false, reasonCode: 'EMPTY_OLD_STRING', occurrences: 0 };
  const { effOld, effNew, unescaped } = fpPrepareUnescapedInputs(src, rawOld, rawNew);
  if (!opts.allowOmissionPlaceholders) {
    const placeholders = fpCollectAddedPlaceholders(effOld, effNew);
    if (placeholders.length > 0) return { ok: false, reasonCode: 'OMISSION_PLACEHOLDER_BLOCKED', occurrences: 0, placeholders };
  }
  const eol = src.includes('\r\n') ? '\r\n' : '\n', allowMultiple = Boolean(opts.allowMultiple);
  const normSource = src.replace(/\r\n/g, '\n'), normOld = effOld.replace(/\r\n/g, '\n'), normNew = effNew.replace(/\r\n/g, '\n');
  const stageRes = fpTryExactStage(normSource, normOld, normNew, allowMultiple)
    || fpTryFlexibleLineStage(normSource, normOld, normNew, allowMultiple)
    || fpTryTokenRegexStage(normSource, normOld, normNew, allowMultiple);
  if (!stageRes) return { ok: false, reasonCode: 'NOT_FOUND', occurrences: 0 };
  if (!stageRes.ok) return stageRes;
  const content = eol === '\r\n' ? stageRes.normContent.replace(/\n/g, '\r\n') : stageRes.normContent;
  return { ok: true, strategy: stageRes.strategy, occurrences: stageRes.occurrences, unescaped, eol, matchLine: stageRes.matchLine, content };
}
function fpDescribeFail(r) {
  if (r.reasonCode === 'AMBIGUOUS_MATCH') return `命中 ${r.occurrences} 处歧义候选（行 ${r.matchLines.join(', ')}）`;
  return r.reasonCode === 'OMISSION_PLACEHOLDER_BLOCKED' ? `阻断省略删码占位符 [${r.placeholders.join(', ')}]` : '未找到匹配的 old 片段';
}
function fpFormatFailure(rel, patchRes, asJson) {
  const payload = { ok: false, exitCode: 1, file: rel, reasonCode: patchRes.reasonCode, occurrences: patchRes.occurrences || 0, matchLines: patchRes.matchLines, placeholders: patchRes.placeholders };
  return asJson ? { exitCode: 1, report: payload, stdout: JSON.stringify(payload, null, 2) } : { exitCode: 1, report: payload, stderr: `✗ patch-edit 失败 (${rel}) [${patchRes.reasonCode}]：${fpDescribeFail(patchRes)}` };
}
function fpFormatSuccess(rel, payload, asJson) {
  if (asJson) return { exitCode: payload.exitCode, report: payload, stdout: JSON.stringify(payload, null, 2) };
  const sign = payload.lineDelta >= 0 ? `+${payload.lineDelta}` : `${payload.lineDelta}`, fStat = payload.lint?.files?.[0];
  const lintTag = fStat ? ` | 有效 ${fStat.effectiveLines} 行 · 物理余量 ${fStat.physicalHeadroomLines} 行` : '';
  const head = `${payload.exitCode === 0 ? '✓' : '✗'} patch-edit ${rel} [${payload.strategy} @ L${payload.matchLine} | 行数 ${payload.beforeLines}→${payload.afterLines} (${sign})${payload.dryRun ? ' | dry-run' : ''}${lintTag}]`;
  return { exitCode: payload.exitCode, report: payload, stdout: [head, ...(payload.lint?.fails || []).map((fl) => `  ✗ ${fl}`)].join('\n'), ...(payload.exitCode !== 0 ? { stderr: `patch-edit 后置 lint-edit 检出 ${payload.lint.fails.length} 项问题` } : {}) };
}
function fpResolvePatchSpec(projectRoot, opts) {
  if (typeof opts.specFile !== 'string' || !opts.specFile.trim()) return opts;
  const raw = opts.specFile === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(projectRoot, opts.specFile), 'utf8');
  const spec = JSON.parse(raw);
  if (Array.isArray(spec.patches)) return { ...opts, patches: spec.patches };
  return { ...opts, file: opts.file || spec.file, oldText: spec.oldText ?? spec.oldString ?? spec.old, newText: spec.newText ?? spec.newString ?? spec.new, allowMultiple: Boolean(opts.allowMultiple ?? spec.allowMultiple) };
}
export function executeFlexibleFilePatch(projectRoot, opts = {}) {
  let resolved;
  try {
    resolved = fpResolvePatchSpec(projectRoot, opts);
  } catch (e) {
    return { exitCode: 3, stderr: `patch-edit 读取 --spec 失败：${e.message}` };
  }
  if (Array.isArray(resolved.patches)) {
    return executeFlexiblePatchBatch(projectRoot, resolved.patches, resolved, applyFlexibleReplacement);
  }
  const { file, oldText, newText, allowMultiple = false, dryRun = false, json = false, runLint = null } = resolved;
  if (!file || typeof oldText !== 'string' || typeof newText !== 'string') return { exitCode: 3, stderr: '用法：donegate patch-edit <file> --old <oldText> --new <newText> | --spec <patch.json|-> [--dry-run] [--json]' };
  const rootAbs = resolve(projectRoot), abs = resolve(rootAbs, file), rel = relative(rootAbs, abs).split(sep).join('/');
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !existsSync(abs)) return { exitCode: 3, stderr: `patch-edit 目标文件不存在或越出仓库根目录：${file}` };
  const beforeText = readFileSync(abs, 'utf8'), patchRes = applyFlexibleReplacement(beforeText, oldText, newText, { allowMultiple });
  if (!patchRes.ok) return fpFormatFailure(rel, patchRes, json);
  if (!dryRun) writeFileSync(abs, patchRes.content, 'utf8');
  const beforeLines = fpPhysLines(beforeText), afterLines = fpPhysLines(patchRes.content);
  const lint = (!dryRun && typeof runLint === 'function') ? runLint(rootAbs, [rel]) : null, exitCode = lint && lint.exitCode !== 0 ? lint.exitCode : 0;
  return fpFormatSuccess(rel, { ok: exitCode === 0, exitCode, dryRun, file: rel, strategy: patchRes.strategy, unescaped: patchRes.unescaped, matchLine: patchRes.matchLine, beforeLines, afterLines, lineDelta: afterLines - beforeLines, ...(lint ? { lint } : {}) }, json);
}
