// L0 宿主钩子输出防爆窗落盘截断器与浏览器旧快照单行覆写器（落盘工作区内 .donegate/tmp/hook-outputs/，<= 200 行）
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET = 2500, CHARS_PER_TOKEN_ESTIMATE = 3.2;
export const DEFAULT_HOOK_OUTPUT_CHAR_BUDGET = Math.round(DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET * CHARS_PER_TOKEN_ESTIMATE), HOOK_OUTPUT_SPILL_REL_DIR = '.donegate/tmp/hook-outputs';
export const SNAPSHOT_SUPERSEDED_PLACEHOLDER = '[Snapshot superseded — a newer snapshot exists later in this conversation]';
export const DEFAULT_SNAPSHOT_TOOL_NAMES = Object.freeze(['take_snapshot', 'browser_snapshot', 'snapshot', 'read_page', 'a11y_snapshot', 'dom_snapshot', 'ui_snapshot']);
export const DEFAULT_JSON_SUMMARY_MAX_KEYS = 8, DEFAULT_RETRIEVE_LINE_SPAN = 80, MAX_RETRIEVE_LINE_SPAN = 400;

const HEAD_RATIO = 0.45, MIN_SLICE_CHARS = 32, MIN_HALF_SLICE_CHARS = 16, MIN_SNAPSHOT_PAIR_COUNT = 2, RANDOM_ID_BYTES = 4, MIN_DOM_SNAPSHOT_CHARS = 64;
const SNAPSHOT_TEXT_MARKER_RE = /\[page_snapshot\]|<snapshot\b|\buid=\d+_\d+\b|\[ref_\d+\]|^\s*-\s+(?:document|heading|button|link|textbox|dialog)\s+"/m;
const HTML_SNAPSHOT_TAG_RE = /<(?:!doctype\s+html|html|body|main)\b/i;

function resolveSpillBudget(opts = {}) {
  if (Number(opts.charBudget) > 0) return Math.floor(Number(opts.charBudget));
  if (Number(opts.tokenBudget) > 0) return Math.max(MIN_SLICE_CHARS * MIN_SNAPSHOT_PAIR_COUNT, Math.round(Number(opts.tokenBudget) * CHARS_PER_TOKEN_ESTIMATE));
  return DEFAULT_HOOK_OUTPUT_CHAR_BUDGET;
}
function formatJsonKeySlice(keys, maxKeys) {
  if (keys.length === 0) return '(empty)';
  return keys.length <= maxKeys ? keys.join(', ') : `${keys.slice(0, maxKeys).join(', ')}, ...+${keys.length - maxKeys}`;
}
function parseJsonCandidate(trimmed) {
  const isJsonShape = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!isJsonShape) return { ok: false, value: null };
  try { return { ok: true, value: JSON.parse(trimmed) }; } catch (err) { void err; return { ok: false, value: null }; }
}
function extractParsedKeysAndLabel(parsed, maxKeys) {
  if (!Array.isArray(parsed)) {
    const keys = Object.keys(parsed || {});
    return { allKeys: keys, keysLabel: formatJsonKeySlice(keys, maxKeys) };
  }
  const head = parsed[0], allKeys = (head && typeof head === 'object' && !Array.isArray(head)) ? Object.keys(head) : [];
  const suffix = allKeys.length > 0 ? ` [${formatJsonKeySlice(allKeys, maxKeys)}]` : '';
  return { allKeys, keysLabel: `array(${parsed.length})${suffix}` };
}

export function summarizeOversizedJsonPayload(rawInput, opts = {}) {
  const text = (rawInput !== null && typeof rawInput === 'object') ? JSON.stringify(rawInput) : String(rawInput ?? '');
  const originalLength = text.length, parsedRes = parseJsonCandidate(text.trim());
  if (!parsedRes.ok) return { summarized: false, isJson: false, summary: text, originalLength, keys: [], totalKeys: 0 };
  const maxKeys = Math.max(1, Math.floor(Number(opts.maxKeys) || DEFAULT_JSON_SUMMARY_MAX_KEYS));
  const { allKeys, keysLabel } = extractParsedKeysAndLabel(parsedRes.value, maxKeys);
  if (originalLength <= resolveSpillBudget(opts)) {
    return { summarized: false, isJson: true, summary: text, originalLength, keys: allKeys.slice(0, maxKeys), totalKeys: allKeys.length };
  }
  const spilledTag = opts.spilledRelPath ? `, spilled: ${opts.spilledRelPath}` : '';
  const summary = `[json: ${originalLength} chars, keys: ${keysLabel}${spilledTag}]`;
  return { summarized: true, isJson: true, summary, originalLength, keys: allKeys.slice(0, maxKeys), totalKeys: allKeys.length };
}

export function maybeSpillHookOutput(projectRoot, rawText, opts = {}) {
  const text = String(rawText ?? ''), originalLength = text.length, charBudget = resolveSpillBudget(opts);
  if (!projectRoot || originalLength <= charBudget) {
    return { spilled: false, output: text, logRelPath: null, logAbsPath: null, originalLength };
  }
  const cleanId = String(opts.runId || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const runId = cleanId || `${Date.now()}-${randomBytes(RANDOM_ID_BYTES).toString('hex')}`;
  const logRelPath = `${HOOK_OUTPUT_SPILL_REL_DIR}/${runId}.log`;
  const spillDir = join(resolve(projectRoot), '.donegate', 'tmp', 'hook-outputs'), logAbsPath = join(spillDir, `${runId}.log`);
  try { mkdirSync(spillDir, { recursive: true }); writeFileSync(logAbsPath, text, 'utf8'); } catch (err) { void err; }
  const footer = `\n[HookOutputSpiller] 完整输出（共 ${originalLength} 字符）已写入工作区：${logRelPath}`;
  if (opts.summarizeJson !== false) {
    const jsonRes = summarizeOversizedJsonPayload(text, { charBudget, maxKeys: opts.maxJsonKeys, spilledRelPath: logRelPath });
    if (jsonRes.summarized) {
      const combined = `${jsonRes.summary}${footer}`;
      return { spilled: true, output: combined.length <= charBudget ? combined : jsonRes.summary, logRelPath, logAbsPath, originalLength };
    }
  }
  const sep = '\n...[已截断中间输出，保留首尾摘要与修复配方]...\n';
  const avail = Math.max(MIN_SLICE_CHARS, charBudget - sep.length - footer.length);
  const headLen = Math.max(MIN_HALF_SLICE_CHARS, Math.floor(avail * HEAD_RATIO)), tailLen = Math.max(MIN_HALF_SLICE_CHARS, avail - headLen);
  return { spilled: true, output: `${text.slice(0, headLen)}${sep}${text.slice(originalLength - tailLen)}${footer}`, logRelPath, logAbsPath, originalLength };
}
function buildFailedRetrieveResult(reasonCode, startLine = 0, endLine = 0) {
  return { ok: false, reasonCode, content: '', numberedContent: '', lines: [], startLine, endLine, totalLines: 0, hasMore: false };
}
function resolveSafeSpillPath(rawPath, projectRoot) {
  if (!projectRoot) return { ok: true, absPath: resolve(rawPath) };
  const rootAbs = resolve(projectRoot), absPath = resolve(rootAbs, rawPath), rel = relative(rootAbs, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..') || isAbsolute(relative(rootAbs, absPath)) || /^[A-Za-z]:/.test(rel)) return { ok: false, absPath: '' };
  return { ok: true, absPath };
}

export function retrieveSpilledLineRange(filePath, startLine = 1, endLine = DEFAULT_RETRIEVE_LINE_SPAN, opts = {}) {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) return buildFailedRetrieveResult('EMPTY_FILE_PATH');
  const resolved = resolveSafeSpillPath(rawPath, opts.projectRoot);
  if (!resolved.ok) return buildFailedRetrieveResult('PATH_OUT_OF_ROOT');
  if (!existsSync(resolved.absPath)) return buildFailedRetrieveResult('FILE_NOT_FOUND');
  const reqStart = Math.max(1, Math.floor(Number(startLine) || 1));
  const reqEnd = (endLine === undefined || endLine === null) ? (reqStart + DEFAULT_RETRIEVE_LINE_SPAN - 1) : Math.floor(Number(endLine));
  if (!Number.isFinite(reqEnd) || reqEnd < reqStart) return buildFailedRetrieveResult('INVALID_LINE_RANGE', reqStart, reqEnd);
  const allLines = readFileSync(resolved.absPath, 'utf8').split(/\r?\n/), totalLines = allLines.length;
  if (reqStart > totalLines) return { ok: true, filePath: rawPath, content: '', numberedContent: '', lines: [], startLine: reqStart, endLine: totalLines, totalLines, hasMore: false };
  const maxSpan = Math.max(1, Math.floor(Number(opts.maxLines) || MAX_RETRIEVE_LINE_SPAN));
  const actualEnd = Math.min(totalLines, reqEnd, reqStart + maxSpan - 1), lines = allLines.slice(reqStart - 1, actualEnd);
  const numberedContent = lines.map((l, idx) => `${reqStart + idx}: ${l}`).join('\n');
  return { ok: true, filePath: rawPath, content: lines.join('\n'), numberedContent, lines, startLine: reqStart, endLine: actualEnd, totalLines, hasMore: actualEnd < totalLines };
}
function isSnapshotPayloadMatch(toolName, explicitFlag, text, toolNames, placeholder) {
  if (explicitFlag === true || toolNames.has(String(toolName || '').toLowerCase())) return true;
  const s = String(text ?? '');
  if (!s) return false;
  if (s.includes(SNAPSHOT_SUPERSEDED_PLACEHOLDER) || s.includes(placeholder) || SNAPSHOT_TEXT_MARKER_RE.test(s)) return true;
  return s.length >= MIN_DOM_SNAPSHOT_CHARS && HTML_SNAPSHOT_TAG_RE.test(s);
}
function collectBlockSnapshotSlots(msg, msgIdx, field, toolNames, placeholder, slots) {
  const arr = msg[field];
  if (!Array.isArray(arr)) return;
  for (let j = 0; j < arr.length; j++) {
    const b = arr[j];
    if (b?.type === 'tool_result' && typeof b.content === 'string' && isSnapshotPayloadMatch(b.name || b.tool_name, b.isSnapshot, b.content, toolNames, placeholder)) {
      slots.push({ kind: 'block', msgIdx, field, subIdx: j, text: b.content });
    }
  }
}
function collectGeminiPartSnapshotSlots(msg, msgIdx, toolNames, placeholder, slots) {
  const partsInContent = !Array.isArray(msg.parts) && Array.isArray(msg.content?.parts);
  const parts = partsInContent ? msg.content.parts : (Array.isArray(msg.parts) ? msg.parts : null);
  if (!parts) return;
  for (let j = 0; j < parts.length; j++) {
    const fr = parts[j]?.functionResponse, out = typeof fr?.response?.output === 'string' ? fr.response.output : '';
    if (fr && isSnapshotPayloadMatch(fr.name, false, out, toolNames, placeholder)) slots.push({ kind: 'gemini-part', msgIdx, partsInContent, subIdx: j, text: out });
  }
}
function collectMessageSnapshotSlots(msg, msgIdx, toolNames, placeholder) {
  const slots = [];
  if (!msg || typeof msg !== 'object') return slots;
  if ((msg.role === 'tool' || msg.type === 'tool_result') && typeof msg.content === 'string' && isSnapshotPayloadMatch(msg.name || msg.tool_name, msg.isSnapshot, msg.content, toolNames, placeholder)) {
    slots.push({ kind: 'tool-msg', msgIdx, text: msg.content });
  }
  collectBlockSnapshotSlots(msg, msgIdx, 'content', toolNames, placeholder, slots);
  collectBlockSnapshotSlots(msg, msgIdx, 'content_blocks', toolNames, placeholder, slots);
  collectGeminiPartSnapshotSlots(msg, msgIdx, toolNames, placeholder, slots);
  return slots;
}
function applySnapshotSlotReplacement(clonedMsg, slot, placeholder) {
  if (slot.kind === 'tool-msg') { clonedMsg.content = placeholder; return; }
  if (slot.kind === 'block') {
    clonedMsg[slot.field] = [...clonedMsg[slot.field]];
    clonedMsg[slot.field][slot.subIdx] = { ...clonedMsg[slot.field][slot.subIdx], content: placeholder };
    return;
  }
  const srcParts = slot.partsInContent ? [...clonedMsg.content.parts] : [...clonedMsg.parts], orig = srcParts[slot.subIdx];
  srcParts[slot.subIdx] = { ...orig, functionResponse: { ...orig.functionResponse, response: { ...(orig.functionResponse.response || {}), output: placeholder } } };
  if (slot.partsInContent) clonedMsg.content = { ...clonedMsg.content, parts: srcParts };
  else clonedMsg.parts = srcParts;
}
function cloneShallowMessageList(messages) {
  const out = [];
  for (const m of messages) out.push(m && typeof m === 'object' ? { ...m } : m);
  return out;
}
function replacePriorSnapshotSlots(cloned, priorSlots, placeholder) {
  let replacedCount = 0;
  for (const slot of priorSlots) {
    if (slot.text.includes(placeholder) || slot.text.includes(SNAPSHOT_SUPERSEDED_PLACEHOLDER)) continue;
    applySnapshotSlotReplacement(cloned[slot.msgIdx], slot, placeholder);
    replacedCount++;
  }
  return replacedCount;
}

export function supersedeStaleSnapshots(messages, opts = {}) {
  if (!Array.isArray(messages)) return { messages: [], replacedCount: 0, keptIndex: -1, pinFirstPreserved: false };
  const pinFirst = opts.pinFirst !== false, placeholder = String(opts.placeholder || SNAPSHOT_SUPERSEDED_PLACEHOLDER);
  const rawNames = Array.isArray(opts.snapshotToolNames) ? opts.snapshotToolNames : DEFAULT_SNAPSHOT_TOOL_NAMES;
  const toolNames = new Set(rawNames.map((n) => String(n).toLowerCase())), allSlots = [];
  for (let i = pinFirst ? 1 : 0; i < messages.length; i++) allSlots.push(...collectMessageSnapshotSlots(messages[i], i, toolNames, placeholder));
  const cloned = cloneShallowMessageList(messages), pinFirstPreserved = Boolean(pinFirst && messages.length > 0);
  if (allSlots.length < MIN_SNAPSHOT_PAIR_COUNT) {
    return { messages: cloned, replacedCount: 0, keptIndex: allSlots.length === 1 ? allSlots[0].msgIdx : -1, pinFirstPreserved };
  }
  const replacedCount = replacePriorSnapshotSlots(cloned, allSlots.slice(0, -1), placeholder);
  return { messages: cloned, replacedCount, keptIndex: allSlots[allSlots.length - 1].msgIdx, pinFirstPreserved };
}
