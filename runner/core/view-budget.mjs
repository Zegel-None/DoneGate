// 全视图统一 token 预算截断与成本自报助手（L1 无头内核，<= 160 行）
import { estimateTokens } from './cbm-rank-terms.mjs';

export function parseBudgetOption(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (raw === true || raw === false || String(raw).trim() === '') {
    return { ok: false, stderr: `参数错误：--budget 必须为正整数（收到 ${String(raw)}）。` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, stderr: `参数错误：--budget 必须为正整数（收到 ${String(raw)}）。` };
  }
  return { ok: true, value: n };
}

function splitBudgetSections(raw) {
  let sections = raw.split(/(?=\n(?:## |=== ))/);
  if (sections.length === 1) sections = raw.split(/(?=\n\d+\. )/);
  return sections;
}

function formatSectionTag(sec, idx) {
  const firstLine = String(sec || '').trim().split('\n')[0] || '';
  if (idx === 0 && !/^(?:#|===|\d+\.)/.test(firstLine)) return '§导言';
  const clean = firstLine.replace(/^[#=\s]+/, '').replace(/[=\s]+$/, '').replace(/\s+/g, ' ').trim();
  if (!clean) return `§${idx}`;
  const capped = clean.length > 24 ? `${clean.slice(0, 23)}…` : clean;
  return `§${capped}`;
}

function buildOmitLine(labels, hint, count, useShort = false) {
  if (useShort || labels.length === 0) return `已省略：共 ${count} 段 | 展开命令：${hint}`;
  return `已省略：${labels.join('、')} | 展开命令：${hint}`;
}

function packOverflowSection(prefix, overSec, overIdx, laterSecs, budget, hint) {
  const overLines = String(overSec || '').replace(/^\n+/, '').trimEnd().split('\n');
  const laterTags = laterSecs.map((s, j) => formatSectionTag(s, overIdx + 1 + j));
  const baseTag = formatSectionTag(overSec, overIdx);
  const packed = [];
  for (let i = 0; i < overLines.length; i++) {
    const rem = overLines.length - (i + 1);
    const overTag = rem > 0 ? `${baseTag}(余${rem}行)` : baseTag;
    const tags = rem > 0 ? [overTag, ...laterTags] : laterTags;
    const omitLine = buildOmitLine(tags, hint, tags.length);
    const cand = `${(prefix + [...packed, overLines[i]].join('\n')).trimEnd()}\n\n${omitLine}`;
    if (estimateTokens(cand) <= budget) packed.push(overLines[i]);
    else break;
  }
  if (packed.length === 0) return null;
  const rem = overLines.length - packed.length;
  const tags = [...(rem > 0 ? [`${baseTag}(余${rem}行)`] : []), ...laterTags];
  const body = (prefix + packed.join('\n')).trimEnd();
  return `${body}\n\n${buildOmitLine(tags, hint, tags.length)}`;
}

function selectBudgetPrefixSections(sections, budget, hint) {
  const kept = [];
  for (let i = 0; i < sections.length; i++) {
    const rem = sections.slice(i + 1);
    const tags = rem.map((s, j) => formatSectionTag(s, i + 1 + j));
    const body = [...kept, sections[i]].join('').trimEnd();
    const cand = rem.length > 0 ? `${body}\n\n${buildOmitLine(tags, hint, rem.length)}` : body;
    if (estimateTokens(cand) <= budget) kept.push(sections[i]);
    else break;
  }
  return kept;
}

function renderOmissionFallback(kept, sections, budget, hint) {
  const rem = sections.slice(kept.length);
  const tags = rem.map((s, j) => formatSectionTag(s, kept.length + j));
  const body = kept.join('').trimEnd();
  const fullNotice = buildOmitLine(tags, hint, rem.length);
  const out = body ? `${body}\n\n${fullNotice}` : fullNotice;
  if (estimateTokens(out) <= budget) return out;
  const shortNotice = buildOmitLine(tags, hint, rem.length, true);
  return body ? `${body}\n\n${shortNotice}` : shortNotice;
}

export function applyBudget(text, budget, expandHint = '去掉 --budget 查看完整视图') {
  const raw = String(text || '').replace(/\r\n/g, '\n').trimEnd();
  if (!(typeof budget === 'number' && Number.isFinite(budget) && budget > 0) || estimateTokens(raw) <= budget) {
    return raw;
  }
  const hint = String(expandHint || '').trim() || '去掉 --budget 查看完整视图';
  const sections = splitBudgetSections(raw);
  const kept = selectBudgetPrefixSections(sections, budget, hint);
  const needLinePack = kept.length === 0
    || (kept.length === 1 && sections.length > 1 && estimateTokens(sections[0]) <= Math.floor(budget * 0.35));
  if (needLinePack) {
    const prefix = kept.length > 0 ? `${kept.join('').trimEnd()}\n\n` : '';
    const packedOut = packOverflowSection(prefix, sections[kept.length], kept.length, sections.slice(kept.length + 1), budget, hint);
    if (packedOut !== null) return packedOut;
  }
  return renderOmissionFallback(kept, sections, budget, hint);
}

export function appendViewCostFooter(text) {
  const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
  let n = estimateTokens(body);
  for (let i = 0; i < 3; i++) {
    const out = `${body}\n— 本视图约 ${n} tok —`;
    const next = estimateTokens(out);
    if (next === n) return out;
    n = next;
  }
  return `${body}\n— 本视图约 ${n} tok —`;
}

export function formatViewWithBudget(text, { budget = null, expandHint = '' } = {}) {
  const body = String(text || '').replace(/\r\n/g, '\n').trimEnd();
  if (!(typeof budget === 'number' && Number.isFinite(budget) && budget > 0)) {
    return appendViewCostFooter(body);
  }
  const full = appendViewCostFooter(body);
  if (estimateTokens(full) <= budget) return full;
  const reserve = budget > 25 ? 10 : 0;
  let clipped = applyBudget(body, Math.max(1, budget - reserve), expandHint);
  let out = appendViewCostFooter(clipped);
  if (estimateTokens(out) > budget && budget > reserve) {
    const over = estimateTokens(out) - budget;
    clipped = applyBudget(body, Math.max(1, budget - reserve - over - 2), expandHint);
    out = appendViewCostFooter(clipped);
  }
  return out;
}

export function finalizeCliTextView(rawText, budgetValue, expandHint = '') {
  const stdout = formatViewWithBudget(rawText, { budget: budgetValue, expandHint });
  if (typeof budgetValue === 'number' && Number.isFinite(budgetValue) && budgetValue > 0) {
    const actualTok = estimateTokens(stdout);
    if (actualTok > budgetValue) {
      return {
        ok: false,
        exitCode: 3,
        stderr: `参数错误：--budget ${budgetValue} 过小，无法容纳最小省略提示与成本尾行（至少约 ${actualTok} tok）。`
      };
    }
  }
  return { ok: true, stdout };
}
