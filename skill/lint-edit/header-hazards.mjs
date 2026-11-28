// 子代理高频失误单文件即时检测原语（机械切片命名、文件头自述防腐化、布尔 sort 与未闭合括号平衡预检，<= 140 行）

const MECHANICAL_SHARD_RE = /(?:[-_](?:part|chunk|slice|shard)\d*|[-_][a-z])\.(?:mjs|cjs|js|ts|tsx|jsx|py)$/i;
const HEADER_LINE_CAP_RE = /(?:<=|≤)\s*(\d+)\s*(?:物理)?行(?!\s*有效)/;
const HEADER_OWNER_RE = /(?:继承\s*([a-z][a-z0-9-]+)\s*归属|归属契约\s*[：:]\s*([a-z][a-z0-9-]+)|\[\s*契约\s*[：:]\s*([a-z][a-z0-9-]+)\s*\])/;
const SORT_ARROW_RE = /\.sort\s*\(\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*=>\s*([^?{;\n)]+)\)/;
const PURE_CMP_EXPR_RE = /^[A-Za-z0-9_$.[\]]+\s*(?:===|!==|==|!=|<=|>=|<|(?<!=)>)\s*[A-Za-z0-9_$.[\]]+$/;
const ALLOW_TAG_RE = /(?:\/\/|#)\s*dg-allow\s*:\s*(.+)$/;
const REGEX_PREV_KW = new Set(['return', 'case', 'throw', 'typeof', 'void', 'delete', 'in', 'of', 'await', 'yield']);
const MATCHING_OPEN = { '}': '{', ')': '(', ']': '[' }, EXPECTED_CLOSE = { '{': '}', '(': ')', '[': ']' };

function stripStringLiterals(line) {
  return line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
}

function checkHeaderTruth(rel, lines, physLines, owners, hasScopes, fails) {
  const limit = Math.min(5, lines.length);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (!/^\s*(?:\/\/|\/\*|\*|#)/.test(line)) continue;
    const capMatch = line.match(HEADER_LINE_CAP_RE);
    if (capMatch && !/有效行/.test(line)) {
      const claimedMax = Number(capMatch[1]);
      if (Number.isFinite(claimedMax) && claimedMax > 0 && physLines > claimedMax) {
        fails.push(`M7 文件头行数自述腐化 (${rel}:L${i + 1})：注释声称 <= ${claimedMax} 行，实际物理行数已达 ${physLines} 行`);
      }
    }
    if (!hasScopes || owners.length === 0) continue;
    const ownMatch = line.match(HEADER_OWNER_RE);
    const claimedOwner = ownMatch ? (ownMatch[1] || ownMatch[2] || ownMatch[3]) : '';
    if (claimedOwner && !owners.includes(claimedOwner)) {
      fails.push(`M7 文件头契约归属自述失真 (${rel}:L${i + 1})：注释声称归属 ${claimedOwner}，实际 scope[] 归属为 ${owners.join(',')}`);
    }
  }
}

function checkBooleanSortTrap(rel, lines, fails) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    const allow = line.match(ALLOW_TAG_RE);
    if (allow && allow[1].trim().length >= 6) continue;
    const m = stripStringLiterals(line).match(SORT_ARROW_RE);
    if (m && PURE_CMP_EXPR_RE.test(m[1].trim())) {
      fails.push(`C3:boolean-sort 比较器返回布尔值陷阱 (${rel}:L${i + 1})：Array.prototype.sort 比较器须返回负数/0/正数，返回布尔值会破坏严格弱序 → ${line.trim().slice(0, 90)}`);
    }
  }
}

function hhCanStartRegex(src, slashIdx) {
  const pre = src.slice(Math.max(0, slashIdx - 32), slashIdx).trimEnd();
  if (!pre || '(,=:[!&|?{};~^%+-*'.includes(pre[pre.length - 1])) return true;
  const kw = pre.match(/([A-Za-z_$][\w$]*)$/);
  return Boolean(kw && REGEX_PREV_KW.has(kw[1]));
}
function hhScanInlineRegex(src, slashIdx) {
  let inCls = false;
  for (let k = slashIdx + 1; k < src.length && src[k] !== '\n' && src[k] !== '\r'; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (src[k] === '[') inCls = true; else if (src[k] === ']') inCls = false; else if (src[k] === '/' && !inCls) return k + 1;
  }
  return -1;
}
function hhTrySkipNonCode(src, i, st) {
  const c2 = src.slice(i, i + 2);
  if (c2 === '//') { const nl = src.indexOf('\n', i); return nl < 0 ? src.length : nl; }
  if (c2 === '/*') {
    const end = src.indexOf('*/', i + 2), stop = end < 0 ? src.length : end + 2;
    st.line += src.slice(i, stop).split('\n').length - 1;
    return stop;
  }
  if (src[i] === "'" || src[i] === '"') return hhScanQuote(src, i, src[i]);
  return (src[i] === '/' && hhCanStartRegex(src, i)) ? hhScanInlineRegex(src, i) : -1;
}
function hhScanQuote(src, startIdx, q) {
  let cur = startIdx + 1;
  while (cur < src.length && src[cur] !== q && src[cur] !== '\n') cur += src[cur] === '\\' ? 2 : 1;
  return cur < src.length && src[cur] === q ? cur + 1 : cur;
}
function hhStepTemplateChar(src, i, st) {
  if (src[i] === '\\') { if (src[i + 1] === '\n') st.line++; return i + 2; }
  if (src[i] === '`') { st.tplDepth--; return i + 1; }
  if (src[i] === '$' && src[i + 1] === '{') {
    st.brackets.push({ ch: '{', line: st.line, resumesTpl: true });
    st.tplDepth--;
    return i + 2;
  }
  if (src[i] === '\n') st.line++;
  return i + 1;
}
function hhHandleBracketToken(ch, rel, st, fails) {
  if (ch === '{' || ch === '(' || ch === '[') { st.brackets.push({ ch, line: st.line, resumesTpl: false }); return true; }
  if (ch !== '}' && ch !== ')' && ch !== ']') return true;
  const top = st.brackets.pop();
  if (!top || top.ch !== MATCHING_OPEN[ch]) {
    fails.push(`M1 括号/大括号未闭合失衡 (${rel}:L${st.line})：遇到多余或不匹配的闭合符 '${ch}'`);
    return false;
  }
  if (top.resumesTpl) st.tplDepth++;
  return true;
}
export function checkUnclosedBracketBalance(rel, raw, fails) {
  const src = String(raw || ''), st = { line: 1, tplDepth: 0, brackets: [] };
  for (let i = 0; i < src.length;) {
    if (st.tplDepth > 0) { i = hhStepTemplateChar(src, i, st); continue; }
    const jumped = hhTrySkipNonCode(src, i, st);
    if (jumped >= 0) { i = jumped; continue; }
    if (src[i] === '`') { st.tplDepth++; i++; continue; }
    if (src[i] === '\n') { st.line++; i++; continue; }
    if (!hhHandleBracketToken(src[i], rel, st, fails)) return;
    i++;
  }
  if (st.brackets.length > 0) {
    const u = st.brackets[st.brackets.length - 1];
    fails.push(`M1 括号/大括号未闭合失衡 (${rel}:L${u.line})：起始 '${u.ch}' 至文件末尾缺少闭合 '${EXPECTED_CLOSE[u.ch]}'`);
  }
}

export function auditSubagentEditHazards({ rel, raw, owners = [], hasScopes = false, isTestOrFixture = false, isSelfMeta = false, fails }) {
  if (!isTestOrFixture && MECHANICAL_SHARD_RE.test(rel)) {
    fails.push(`C4 禁止机械按字母/序号切碎代码文件 (${rel})：请按职责语义命名模块`);
  }
  if (isSelfMeta) return;
  const text = String(raw || '');
  const lines = text.split(/\r?\n/);
  const physLines = text.replace(/\r?\n$/, '').split(/\r?\n/).length;
  if (!isTestOrFixture) {
    checkHeaderTruth(rel, lines, physLines, owners, hasScopes, fails);
  }
  if (/\.(?:mjs|cjs|js|ts|tsx|jsx)$/i.test(rel)) {
    checkBooleanSortTrap(rel, lines, fails);
  }
}
