// L0 宿主钩子输出防爆窗落盘截断器（复刻 Codex HookOutputSpiller，落盘工作区内 .donegate/tmp/hook-outputs/，<= 60 行）
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET = 2500;
export const CHARS_PER_TOKEN_ESTIMATE = 3.2;
export const DEFAULT_HOOK_OUTPUT_CHAR_BUDGET = Math.round(DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET * CHARS_PER_TOKEN_ESTIMATE);
export const HOOK_OUTPUT_SPILL_REL_DIR = '.donegate/tmp/hook-outputs';
const HEAD_RATIO = 0.45;
const MIN_SLICE_CHARS = 32;

function resolveSpillBudget(opts = {}) {
  if (Number(opts.charBudget) > 0) return Math.floor(Number(opts.charBudget));
  if (Number(opts.tokenBudget) > 0) return Math.max(MIN_SLICE_CHARS * 2, Math.round(Number(opts.tokenBudget) * CHARS_PER_TOKEN_ESTIMATE));
  return DEFAULT_HOOK_OUTPUT_CHAR_BUDGET;
}

export function maybeSpillHookOutput(projectRoot, rawText, opts = {}) {
  const text = String(rawText ?? '');
  const originalLength = text.length;
  const charBudget = resolveSpillBudget(opts);
  if (!projectRoot || originalLength <= charBudget) {
    return { spilled: false, output: text, logRelPath: null, logAbsPath: null, originalLength };
  }
  const cleanId = String(opts.runId || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const runId = cleanId || `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const logRelPath = `${HOOK_OUTPUT_SPILL_REL_DIR}/${runId}.log`;
  const logAbsPath = join(resolve(projectRoot), '.donegate', 'tmp', 'hook-outputs', `${runId}.log`);
  try {
    mkdirSync(join(resolve(projectRoot), '.donegate', 'tmp', 'hook-outputs'), { recursive: true });
    writeFileSync(logAbsPath, text, 'utf8');
  } catch (err) {
    void err;
  }
  const sep = '\n...[已截断中间输出，保留首尾摘要与修复配方]...\n';
  const footer = `\n[HookOutputSpiller] 完整输出（共 ${originalLength} 字符）已写入工作区：${logRelPath}`;
  const avail = Math.max(MIN_SLICE_CHARS, charBudget - sep.length - footer.length);
  const headLen = Math.max(16, Math.floor(avail * HEAD_RATIO));
  const tailLen = Math.max(16, avail - headLen);
  const output = `${text.slice(0, headLen)}${sep}${text.slice(originalLength - tailLen)}${footer}`;
  return { spilled: true, output, logRelPath, logAbsPath, originalLength };
}
