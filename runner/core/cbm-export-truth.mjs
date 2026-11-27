// CBM 图谱结果源码真值校正器（按源码重判导出名单、嵌套函数判定与 Kneedle 无参拐点纯函数，<= 350 行）
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const EXPORT_TRUTH_CACHE = new Map();
const JS_FAMILY_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.mts']);
const JS_DECL_EXPORT_RE = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?\s*|(?:abstract\s+)?class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/gm;
const JS_LIST_EXPORT_RE = /^export\s*\{([^}]*)\}/gm;
const JS_DEFAULT_IDENT_RE = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
const CJS_HINT_RE = /\bmodule\.exports\b|\bexports\.[A-Za-z_$]/;
const PY_TOP_DEF_RE = /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/gm;
const NESTING_LABELS = new Set(['Function', 'Method', 'Class']);

// Satopää et al. (2011) Kneedle 无参最大曲率拐点（均匀分布返回 0，绝不硬凑假中心）
export function kneedleElbowCount(sortedDescWeights) {
  const pos = (sortedDescWeights || []).filter((w) => w > 0);
  const n = pos.length;
  if (n <= 1) return n;
  const sum = pos.reduce((a, b) => a + b, 0);
  let cum = 0, maxDiff = 0, knee = 0;
  for (let i = 0; i < n; i++) {
    cum += pos[i];
    const diff = (cum / sum) - ((i + 1) / n);
    if (diff > maxDiff + 1e-9) {
      maxDiff = diff;
      knee = i + 1;
    }
  }
  return knee;
}

function collectJsExportNames(text) {
  const names = new Set();
  for (const m of text.matchAll(JS_DECL_EXPORT_RE)) names.add(m[1]);
  for (const m of text.matchAll(JS_DEFAULT_IDENT_RE)) names.add(m[1]);
  for (const m of text.matchAll(JS_LIST_EXPORT_RE)) {
    for (const part of m[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
    }
  }
  if (names.size === 0 && CJS_HINT_RE.test(text)) return null;
  return names;
}

function collectPythonExportNames(text) {
  const names = new Set();
  for (const m of text.matchAll(PY_TOP_DEF_RE)) {
    if (!m[1].startsWith('_')) names.add(m[1]);
  }
  return names;
}

function computeExportTruth(text, ext) {
  if (JS_FAMILY_EXTS.has(ext)) return collectJsExportNames(text);
  if (ext === '.py') return collectPythonExportNames(text);
  return null;
}

// 按源码行首导出语法重判真实导出名单（返回 Set；非 JS/TS/Python 或读失败返回 null 表示未知，沿用 CBM 原值）
export function readExportTruth(projectRoot, relFile) {
  const norm = String(relFile || '').replace(/\\/g, '/');
  const ext = extname(norm).toLowerCase();
  if (!projectRoot || !norm || (!JS_FAMILY_EXTS.has(ext) && ext !== '.py')) return null;
  const abs = resolve(projectRoot, norm);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(abs).mtimeMs;
  } catch {
    return null;
  }
  const hit = EXPORT_TRUTH_CACHE.get(abs);
  if (hit && hit.mtimeMs === mtimeMs) return hit.truth;
  let truth = null;
  try {
    truth = computeExportTruth(readFileSync(abs, 'utf8'), ext);
  } catch {
    truth = null;
  }
  EXPORT_TRUTH_CACHE.set(abs, { mtimeMs, truth });
  return truth;
}

// 跨文件 CALLS 被调目标若非其源文件真实导出名（局部/模板字符串内同名函数被按名误连），判为幻影承重接口（类方法不判）
export function isPhantomHubTarget(projectRoot, row) {
  if (!row || row.label === 'Method') return false;
  const truth = readExportTruth(projectRoot, row.file);
  return Boolean(truth) && !truth.has(row.symbol);
}

function isStrictlyEnclosed(inner, outer) {
  if (inner === outer || !NESTING_LABELS.has(outer.label)) return false;
  if (outer.startLine > inner.startLine || inner.endLine > outer.endLine) return false;
  return outer.startLine < inner.startLine || inner.endLine < outer.endLine;
}

// 为被其他函数/方法/类行区间严格包含的函数打 nested 标记，并以源码真值覆盖 isExported（嵌套一律非导出）
export function applyExportTruthToSymbols(symbols, truth) {
  return (symbols || []).map((s) => {
    const nested = s.label === 'Function' && symbols.some((o) => isStrictlyEnclosed(s, o));
    const baseExported = truth ? truth.has(s.name) : s.isExported;
    return { ...s, nested, isExported: !nested && Boolean(baseExported) };
  });
}
