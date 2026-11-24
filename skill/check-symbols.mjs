// 代码层符号自检：零依赖静态检测死代码、同名不同体与换名复制（仅索引模块顶层定义，棘轮键对行号位移免疫）
//
// 三条断言：
//   ① 零引用函数（死代码候选）
//   ② 同名定义 ≥2 份且函数体不同（同名不同义；豁免未导出的脚本局部 CLI 惯用短名）
//   ③ 函数体归一化后完全相同、但名字不同（换名复制）
//
// 用法：
//   node skill/check-symbols.mjs                   只看报告，不判红
//   node skill/check-symbols.mjs --gate            超过基线即红（退出码 1）
//   node skill/check-symbols.mjs --update-baseline 固化当前基线
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(scriptDir, '..');
const BASELINE = join(ROOT, 'skill', 'symbols-baseline.json');
const argv = process.argv.slice(2);
const GATE = argv.includes('--gate');
const UPDATE = argv.includes('--update-baseline');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

const DIRS = ['skill', 'runner', 'tools'];
const CLI_PRIVATE_HARNESS_NAMES = new Set([
  'arg', 'has', 'ok', 'bad', 't', 'check', 'git', 'runRedSelfTest', 'parseCliArgs', 'main'
]);

const TOP_FN_RE = /^\s*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const TOP_ARROW_RE = /^\s*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

function collectTargetMjsFiles(rootDir) {
  const out = [];
  for (const d of DIRS) {
    const dir = join(rootDir, d);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir)) {
      if (e.endsWith('.mjs')) out.push(join(dir, e));
    }
  }
  return out;
}

function consumeQuotedSegment(line, startIdx, state) {
  let i = startIdx;
  while (i < line.length) {
    if (line[i] === '\\') { i += 2; continue; }
    if (line[i] === state.quote) { state.quote = null; return i + 1; }
    i++;
  }
  return line.length;
}

function stripLineStringsAndComments(line, state) {
  let clean = '';
  let i = 0;
  while (i < line.length) {
    if (state.inBlockComment) {
      const end = line.indexOf('*/', i);
      if (end < 0) return clean;
      state.inBlockComment = false;
      i = end + 2;
      continue;
    }
    if (state.quote) {
      i = consumeQuotedSegment(line, i, state);
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '//') break;
    if (two === '/*') { state.inBlockComment = true; i += 2; continue; }
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') { state.quote = line[i]; i++; continue; }
    clean += line[i++];
  }
  return clean;
}

function collectNamedExportSet(raw) {
  const exported = new Set();
  for (const m of raw.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim().split(/\s+as\s+/)[0].trim();
      if (seg) exported.add(seg);
    }
  }
  return exported;
}

function stepBraceDepth(clean, currentDepth) {
  let depth = currentDepth;
  let opened = false;
  for (const ch of clean) {
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return { depth, opened };
}

function bodyAt(lines, start) {
  let depth = 0;
  let started = false;
  const out = [];
  const state = { inBlockComment: false, quote: null };
  for (let i = start; i < Math.min(lines.length, start + 400); i++) {
    const l = lines[i];
    out.push(l);
    const clean = stripLineStringsAndComments(l, state);
    const step = stepBraceDepth(clean, depth);
    depth = step.depth;
    if (step.opened) started = true;
    if (started && depth <= 0) break;
    if (!started && /;\s*$/.test(clean)) break;
  }
  return out.join('\n');
}

function extractTopLevelDefs(fileAbs, raw) {
  const lines = raw.split('\n');
  const namedExports = collectNamedExportSet(raw);
  const state = { inBlockComment: false, quote: null };
  const fileDefs = [];
  let braceDepth = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (braceDepth === 0 && !state.inBlockComment && !state.quote) {
      const m = line.match(TOP_FN_RE) || line.match(TOP_ARROW_RE);
      if (m) {
        const name = m[2];
        const exported = Boolean(m[1]) || namedExports.has(name);
        fileDefs.push({ name, exported, file: rel(fileAbs), line: idx + 1, body: bodyAt(lines, idx) });
      }
    }
    const clean = stripLineStringsAndComments(line, state);
    braceDepth = stepBraceDepth(clean, braceDepth).depth;
  }
  return fileDefs;
}

const normBody = (b) => b.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').trim();

function fp(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
}

function normalizeRatchetKey(rawKey) {
  const parts = String(rawKey || '').split(' · ');
  if (parts.length < 3) return String(rawKey || '');
  const cleanFiles = [...new Set(
    parts[2].split('|').map((s) => s.trim().replace(/:\d+$/, '')).filter(Boolean)
  )].sort().join(' | ');
  parts[2] = cleanFiles;
  return parts.join(' · ');
}

const files = collectTargetMjsFiles(ROOT);
const sources = new Map();
for (const f of files) sources.set(f, readFileSync(f, 'utf8'));

const allText = [...sources.values()].join('\n');
const defs = [];
for (const [f, raw] of sources) {
  const extracted = extractTopLevelDefs(f, raw);
  defs.push(...extracted);
}

const countWord = (word) => {
  const escaped = word.replace(/\$/g, '\\$');
  const re = new RegExp(`(?:^|[^\\w$.]|\\.\\.\\.)${escaped}(?![\\w$])`, 'g');
  return (allText.match(re) || []).length;
};

const byName = new Map();
for (const d of defs) {
  if (!byName.has(d.name)) byName.set(d.name, []);
  byName.get(d.name).push(d);
}

const dead = [];
for (const [name, ds] of byName) {
  if (countWord(name) - ds.length <= 0) {
    for (const d of ds) dead.push({ kind: 'dead', name, at: `${d.file}:${d.line}`, filesKey: d.file });
  }
}

const sameNameDiff = [];
for (const [name, ds] of byName) {
  if (ds.length < 2) continue;
  const anyExported = ds.some((d) => d.exported);
  if (!anyExported && CLI_PRIVATE_HARNESS_NAMES.has(name)) continue;
  const bodies = new Set(ds.map((d) => normBody(d.body)));
  if (bodies.size > 1) {
    const uniqFiles = [...new Set(ds.map((d) => d.file))].sort().join(' | ');
    sameNameDiff.push({
      kind: 'sameName',
      name,
      at: ds.map((d) => `${d.file}:${d.line}`).join(' | '),
      filesKey: uniqFiles,
      variants: bodies.size,
      print: fp([...bodies].sort().join('\u0001'))
    });
  }
}

const byBody = new Map();
for (const d of defs) {
  const k = normBody(d.body).split(d.name).join('NAME');
  if (k.length < 40) continue;
  if (!byBody.has(k)) byBody.set(k, []);
  byBody.get(k).push(d);
}
const renamed = [];
for (const [bodyKey, ds] of byBody) {
  const names = new Set(ds.map((d) => d.name));
  const uniqFiles = [...new Set(ds.map((d) => d.file))].sort();
  if (names.size < 2 || uniqFiles.length < 2) continue;
  renamed.push({
    kind: 'renamed',
    name: [...names].sort().join(' / '),
    at: ds.map((d) => `${d.file}:${d.line}`).join(' | '),
    filesKey: uniqFiles.join(' | '),
    print: fp(bodyKey)
  });
}

const findings = [...dead, ...sameNameDiff, ...renamed];
const findingKey = (f) => `${f.kind} · ${f.name} · ${f.filesKey}${f.print ? ' · ' + f.print : ''}`;

console.log('扫描：' + files.length + ' 个 .mjs，' + defs.length + ' 个顶层函数定义');
console.log('\n① 零引用（死代码候选）：' + dead.length);
for (const d of dead) console.log('   ' + d.at + '  ' + d.name);
console.log('\n② 同名不同体：' + sameNameDiff.length);
for (const d of sameNameDiff) console.log('   ' + d.name + '（' + d.variants + ' 种）' + d.at);
console.log('\n③ 同体不同名（换名复制）：' + renamed.length);
for (const d of renamed) console.log('   ' + d.name + '  ' + d.at);

if (UPDATE) {
  const keys = [...new Set(findings.map(findingKey))].sort();
  writeFileSync(BASELINE, JSON.stringify({ note: 'check-symbols 的棘轮基线：存量不挡路，新增即红（文件级无行号键，免受行位移干扰）', count: keys.length, keys }, null, 2) + '\n', 'utf8');
  console.log('\n已写基线 → ' + rel(BASELINE) + '（' + keys.length + ' 条）');
  process.exit(0);
}

if (GATE) {
  const rawBase = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).keys : [];
  const base = new Set(rawBase.map(normalizeRatchetKey));
  const now = [...new Set(findings.map(findingKey))].sort();
  const nowSet = new Set(now);
  const added = now.filter((k) => !base.has(k));
  const fixed = [...base].filter((k) => !nowSet.has(k));
  if (fixed.length) console.log('\n比基线少了 ' + fixed.length + ' 条（好事，可按需 --update-baseline 固化）：\n   ' + fixed.join('\n   '));
  if (added.length) {
    console.log('\nRESULT: 新增 ' + added.length + ' 条（棘轮只降不升）——\n   ' + added.join('\n   '));
    process.exit(1);
  }
  console.log('\nRESULT: 无新增（当前 ' + now.length + ' 条，基线 ' + base.size + '）');
  process.exit(0);
}
console.log('\n（只看报告。加 --gate 判红，加 --update-baseline 固化基线）');
process.exit(0);
