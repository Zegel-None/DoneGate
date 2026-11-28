// 多文件原子容错替换批处理器（供 flexible-patch.mjs 委托，任一补丁失配时零落盘原子回退）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const fpbPhysLines = (text) => String(text || '').replace(/\r?\n$/, '').split(/\r?\n/).length;

function fpbResolveSafeRel(rootAbs, rawFile) {
  if (!rawFile || typeof rawFile !== 'string') return null;
  const abs = resolve(rootAbs, rawFile);
  const rel = relative(rootAbs, abs).split(sep).join('/');
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !existsSync(abs)) return null;
  return { abs, rel };
}

function fpbNormalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const oldText = item.oldText ?? item.oldString ?? item.old;
  const newText = item.newText ?? item.newString ?? item.new;
  if (typeof item.file !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
    return null;
  }
  return { file: item.file, oldText, newText, allowMultiple: Boolean(item.allowMultiple) };
}

function fpbFormatBatchFailure(errPayload, asJson) {
  if (asJson) {
    return { exitCode: errPayload.exitCode, report: errPayload, stdout: JSON.stringify(errPayload, null, 2) };
  }
  return { exitCode: errPayload.exitCode, report: errPayload, stderr: errPayload.message };
}

function fpbApplySingleItemToBuffer(idx, rawItem, rootAbs, state, applySingleFn) {
  const norm = fpbNormalizeItem(rawItem);
  if (!norm) {
    return { ok: false, exitCode: 3, patchIndex: idx, message: `patch-edit 批处理第 ${idx + 1} 项缺少合法 file/oldText/newText` };
  }
  const loc = fpbResolveSafeRel(rootAbs, norm.file);
  if (!loc) {
    return { ok: false, exitCode: 3, patchIndex: idx, file: norm.file, message: `patch-edit 目标文件不存在或越出仓库根目录：${norm.file}` };
  }
  if (!state.buffers.has(loc.rel)) {
    const initTxt = readFileSync(loc.abs, 'utf8');
    state.buffers.set(loc.rel, initTxt);
    state.absByRel.set(loc.rel, loc.abs);
    state.beforeLinesByRel.set(loc.rel, fpbPhysLines(initTxt));
  }
  const res = applySingleFn(state.buffers.get(loc.rel), norm.oldText, norm.newText, { allowMultiple: norm.allowMultiple });
  if (!res.ok) {
    return {
      ok: false,
      exitCode: 1,
      patchIndex: idx,
      file: loc.rel,
      reasonCode: res.reasonCode,
      occurrences: res.occurrences || 0,
      message: `✗ patch-edit 原子批处理中止于第 ${idx + 1} 项 (${loc.rel}) [${res.reasonCode}]（磁盘文件零改动）`
    };
  }
  state.buffers.set(loc.rel, res.content);
  state.applied.push({ patchIndex: idx, file: loc.rel, strategy: res.strategy, matchLine: res.matchLine });
  return null;
}

function fpbFormatBatchOutcome(state, dryRun, lint, asJson) {
  const touchedFiles = [...state.buffers.keys()];
  const exitCode = lint && lint.exitCode !== 0 ? lint.exitCode : 0;
  const fileDeltas = touchedFiles.map((rel) => {
    const beforeLines = state.beforeLinesByRel.get(rel);
    const afterLines = fpbPhysLines(state.buffers.get(rel));
    return { file: rel, beforeLines, afterLines, lineDelta: afterLines - beforeLines };
  });
  const payload = { ok: exitCode === 0, exitCode, dryRun, batchCount: state.applied.length, touchedFiles, applied: state.applied, fileDeltas, ...(lint ? { lint } : {}) };
  if (asJson) return { exitCode, report: payload, stdout: JSON.stringify(payload, null, 2) };
  const tag = dryRun ? ' (dry-run)' : '';
  const summary = `${exitCode === 0 ? '✓' : '✗'} patch-edit 原子批处理完成：${state.applied.length} 处补丁覆盖 ${touchedFiles.length} 个文件${tag}`;
  const deltaLines = fileDeltas.map((d) => `  · ${d.file}: ${d.beforeLines}→${d.afterLines} (${d.lineDelta >= 0 ? '+' + d.lineDelta : d.lineDelta})`);
  const failLines = (lint?.fails || []).map((fl) => `  ✗ ${fl}`);
  const out = { exitCode, report: payload, stdout: [summary, ...deltaLines, ...failLines].join('\n') };
  if (exitCode !== 0) out.stderr = `patch-edit 批处理后置 lint-edit 检出 ${lint.fails.length} 项问题`;
  return out;
}

export function executeFlexiblePatchBatch(projectRoot, rawPatches, opts, applySingleFn) {
  const rootAbs = resolve(projectRoot);
  const dryRun = Boolean(opts.dryRun);
  const asJson = Boolean(opts.json);
  if (!Array.isArray(rawPatches) || rawPatches.length === 0) {
    return fpbFormatBatchFailure({ ok: false, exitCode: 3, message: 'patch-edit --spec patches[] 不能为空数组' }, asJson);
  }
  const state = { buffers: new Map(), absByRel: new Map(), beforeLinesByRel: new Map(), applied: [] };
  for (let idx = 0; idx < rawPatches.length; idx++) {
    const err = fpbApplySingleItemToBuffer(idx, rawPatches[idx], rootAbs, state, applySingleFn);
    if (err) return fpbFormatBatchFailure(err, asJson);
  }
  if (!dryRun) {
    for (const [rel, nextContent] of state.buffers.entries()) {
      writeFileSync(state.absByRel.get(rel), nextContent, 'utf8');
    }
  }
  const touchedFiles = [...state.buffers.keys()];
  const lint = (!dryRun && typeof opts.runLint === 'function') ? opts.runLint(rootAbs, touchedFiles) : null;
  return fpbFormatBatchOutcome(state, dryRun, lint, asJson);
}
