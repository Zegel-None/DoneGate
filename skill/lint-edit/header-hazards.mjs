// 子代理高频失误单文件即时检测原语（机械切片命名、文件头自述防腐化、布尔 sort 比较器陷阱，<= 120 行）

const MECHANICAL_SHARD_RE = /(?:[-_](?:part|chunk|slice|shard)\d*|[-_][a-z])\.(?:mjs|cjs|js|ts|tsx|jsx|py)$/i;
const HEADER_LINE_CAP_RE = /(?:<=|≤)\s*(\d+)\s*(?:物理)?行(?!\s*有效)/;
const HEADER_OWNER_RE = /(?:继承\s*([a-z][a-z0-9-]+)\s*归属|归属契约\s*[：:]\s*([a-z][a-z0-9-]+)|\[\s*契约\s*[：:]\s*([a-z][a-z0-9-]+)\s*\])/;
const SORT_ARROW_RE = /\.sort\s*\(\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*=>\s*([^?{;\n)]+)\)/;
const PURE_CMP_EXPR_RE = /^[A-Za-z0-9_$.[\]]+\s*(?:===|!==|==|!=|<=|>=|<|(?<!=)>)\s*[A-Za-z0-9_$.[\]]+$/;
const ALLOW_TAG_RE = /(?:\/\/|#)\s*dg-allow\s*:\s*(.+)$/;

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
