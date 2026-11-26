#!/usr/bin/env node
// 零依赖跨文件模块与配置完整性硬门禁（专治小模型在纯 Node 环境下高频出现的 5 类静态断链与幻觉）
//
// 守什么：
//   M1 · JS/ESM 语法完整性（单进程 vm.SourceTextModule / vm.Script 批量预检）：防括号未闭合、重复 const、截断代码块；
//   M2 · 相对导入存在性与磁盘真实大小写匹配（readdirSync 逐级核对）：防 Windows NTFS 大小写不敏感掩盖 Linux 崩溃；
//   M3 · 跨文件 ESM 具名导出绑定对齐：防小模型改了被调方函数名却漏改 import { fn } 调用方；
//   M4 · 幻觉 npm 包与非法 node: 内置子路径拦截：未在 package.json 声明且不在 node:module builtinModules 即判红；
//   M5 · 全仓受控 JSON / JSONL 配置与台账语法校验：防小模型手改 JSON 留尾逗号、塞 // 注释或截断大括号；
//   M6 · 公共原语防手搓与核心子模块体积棘轮：具体适配器必须委托 _shared.mjs（<=90 行、禁直引 crypto/child_process），非底座禁手搓 createHash("sha256")，runner/core 拆分子模块 <=350 行。
//
// 用法：
//   node skill/check-module-integrity.mjs [--root <项目根>]     核验指定项目源码与配置树
//   node skill/check-module-integrity.mjs --red-self-test       真实仓库核验 + 7 组小模型断链与手搓必红夹具
//
// 退出码（§八 四值）：0 全部通过 / 1 检出语法、路径大小写、导出断链、幻觉依赖或坏 JSON / 3 目录不可读
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const BUILTINS = new Set(
  builtinModules.flatMap((m) => (m.startsWith('node:') ? [m, m.slice(5)] : [m, 'node:' + m]))
);
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.donegate', '.deps', 'dist', 'build', '_dist', 'coverage',
  'reports', '.stryker-tmp', '参考', '归档', '证据', '设计', 'vendor'
]);
const JS_EXTS = new Set(['.mjs', '.cjs', '.js']);
const JSONC_ALLOW_RE = /(?:^|\/)(?:tsconfig(?:\.[a-z0-9_-]+)?|\.oxlintrc|jsconfig)\.json$/i;
const CMI_DECL_STOP_RE = /^(?:export|import|function|class|const|let|var|if|for|while|return|try)$/;

const cmiIsIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
const cmiIsIdentPart = (ch) => /[A-Za-z0-9_$]/.test(ch);

function cmiSkipComment(source, start, next) {
  let i = start + 2;
  if (next === '/') {
    while (i < source.length && source[i] !== '\n') i++;
    return i;
  }
  while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
  return i + 2;
}

function cmiReadStringToken(source, start, tokens) {
  const q = source[start];
  let val = '';
  let i = start + 1;
  while (i < source.length && source[i] !== q) {
    if (source[i] === '\\') {
      val += source.slice(i + 1, i + 2);
      i += 2;
      continue;
    }
    val += source[i++];
  }
  tokens.push({ type: 'string', value: val });
  return i + 1;
}

function cmiSkipSimpleQuoted(source, start) {
  const sq = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== sq) {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

function cmiSkipInlineRegex(source, start) {
  let i = start + 1;
  let inCls = false;
  while (i < source.length && source[i] !== '\n') {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '[') inCls = true;
    else if (source[i] === ']') inCls = false;
    else if (source[i] === '/' && !inCls) return i + 1;
    i++;
  }
  return i;
}

function cmiSkipTemplateExpr(source, start) {
  let i = start;
  let depth = 1;
  let prevSig = '{';
  while (i < source.length && depth > 0) {
    const tc = source[i];
    if (tc === "'" || tc === '"' || tc === '`') {
      i = cmiSkipSimpleQuoted(source, i);
      prevSig = tc;
      continue;
    }
    if (tc === '/' && /[=([,:!&|?;{]/.test(prevSig) && source[i + 1] !== '/' && source[i + 1] !== '*') {
      i = cmiSkipInlineRegex(source, i);
      prevSig = '/';
      continue;
    }
    if (tc === '{') depth++;
    else if (tc === '}') depth--;
    if (!/\s/.test(tc)) prevSig = tc;
    i++;
  }
  return i;
}

function cmiReadTemplateToken(source, start, tokens) {
  let i = start + 1;
  while (i < source.length && source[i] !== '`') {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '$' && source[i + 1] === '{') {
      i = cmiSkipTemplateExpr(source, i + 2);
      continue;
    }
    i++;
  }
  tokens.push({ type: 'template', value: '' });
  return i + 1;
}

function cmiCanStartRegex(prev) {
  if (!prev) return true;
  if (prev.type === 'punct' && /[=([,:!&|?;{}]/.test(prev.value)) return true;
  return prev.type === 'ident' && /^(?:return|throw|case|typeof|void|delete|in|of)$/.test(prev.value);
}

function cmiReadRegexToken(source, start, tokens) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length && source[i] !== '\n') {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '[') inClass = true;
    else if (source[i] === ']') inClass = false;
    else if (source[i] === '/' && !inClass) {
      i++;
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      break;
    }
    i++;
  }
  tokens.push({ type: 'regex', value: '' });
  return i;
}

function cmiReadIdentToken(source, start, tokens) {
  let i = start;
  let id = '';
  while (i < source.length && cmiIsIdentPart(source[i])) id += source[i++];
  tokens.push({ type: 'ident', value: id });
  return i;
}

export function scanJsModuleTokens(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && (next === '/' || next === '*')) {
      i = cmiSkipComment(source, i, next);
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = cmiReadStringToken(source, i, tokens);
      continue;
    }
    if (ch === '`') {
      i = cmiReadTemplateToken(source, i, tokens);
      continue;
    }
    if (ch === '/' && cmiCanStartRegex(tokens[tokens.length - 1])) {
      i = cmiReadRegexToken(source, i, tokens);
      continue;
    }
    if (cmiIsIdentStart(ch)) {
      i = cmiReadIdentToken(source, i, tokens);
      continue;
    }
    tokens.push({ type: 'punct', value: ch });
    i++;
  }
  return tokens;
}

function cmiReadBraceSpecifiers(toks, openBraceIdx) {
  let j = openBraceIdx + 1;
  const pairs = [];
  while (j < toks.length && toks[j].value !== '}') {
    if (toks[j].type !== 'ident') {
      j++;
      continue;
    }
    const orig = toks[j].value;
    const hasAs = toks[j + 1]?.type === 'ident' && toks[j + 1].value === 'as' && toks[j + 2]?.type === 'ident';
    pairs.push({ orig, exported: hasAs ? toks[j + 2].value : orig });
    j += hasAs ? 3 : 1;
  }
  if (toks[j]?.value === '}') j++;
  return { pairs, nextIdx: j };
}

function cmiConsumeImportBindings(toks, startIdx) {
  let j = startIdx;
  let hasDefault = false;
  let named = [];
  if (toks[j]?.type === 'ident' && toks[j].value !== 'from') {
    hasDefault = true;
    j++;
    if (toks[j]?.value === ',') j++;
  }
  if (toks[j]?.value === '*') {
    j += 2;
    if (toks[j]?.type === 'ident') j++;
  } else if (toks[j]?.value === '{') {
    const br = cmiReadBraceSpecifiers(toks, j);
    named = br.pairs.map((p) => p.orig);
    j = br.nextIdx;
  }
  return { named: hasDefault ? ['default', ...named] : named, nextIdx: j };
}

function cmiParseImportAt(toks, i, imports) {
  const n1 = toks[i + 1];
  if (!n1 || n1.value === '.') return i;
  if (n1.value === '(') {
    if (toks[i + 2]?.type === 'string') imports.push({ spec: toks[i + 2].value, named: [], isDynamic: true });
    return i;
  }
  if (n1.type === 'string') {
    imports.push({ spec: n1.value, named: [], isDynamic: false });
    return i;
  }
  const b = cmiConsumeImportBindings(toks, i + 1);
  if (toks[b.nextIdx]?.type === 'ident' && toks[b.nextIdx].value === 'from' && toks[b.nextIdx + 1]?.type === 'string') {
    imports.push({ spec: toks[b.nextIdx + 1].value, named: b.named, isDynamic: false });
    return b.nextIdx + 1;
  }
  return i;
}

function cmiCollectDestructuredExports(toks, startIdx, exports) {
  let j = startIdx;
  while (j < toks.length && toks[j].value !== '}') {
    if (toks[j].type !== 'ident') {
      j++;
      continue;
    }
    if (toks[j + 1]?.value === ':' && toks[j + 2]?.type === 'ident') {
      exports.add(toks[j + 2].value);
      j += 3;
    } else {
      exports.add(toks[j].value);
      j++;
    }
  }
}

function cmiStepDeclDepth(val, d) {
  if (val === '{') d.brace++;
  else if (val === '}') d.brace = Math.max(0, d.brace - 1);
  else if (val === '(') d.paren++;
  else if (val === ')') d.paren = Math.max(0, d.paren - 1);
  else if (val === '[') d.bracket++;
  else if (val === ']') d.bracket = Math.max(0, d.bracket - 1);
}

function cmiParseExportVarDecl(toks, startIdx, exports) {
  if (toks[startIdx]?.value === '{') {
    cmiCollectDestructuredExports(toks, startIdx + 1, exports);
    return;
  }
  const d = { brace: 0, paren: 0, bracket: 0 };
  let expectBinding = true;
  for (let j = startIdx; j < toks.length; j++) {
    const t = toks[j];
    const atTop = d.brace === 0 && d.paren === 0 && d.bracket === 0;
    if (!atTop) {
      cmiStepDeclDepth(t.value, d);
      continue;
    }
    if (t.value === ';') break;
    if (expectBinding && t.type === 'ident') {
      exports.add(t.value);
      expectBinding = false;
      continue;
    }
    if (t.value === ',') {
      expectBinding = true;
      continue;
    }
    if (!expectBinding && t.type === 'ident' && CMI_DECL_STOP_RE.test(t.value)) break;
    cmiStepDeclDepth(t.value, d);
  }
}

function cmiParseExportStarOrBraces(toks, i, exports, imports, reExportsAll) {
  if (toks[i + 1].value === '*') {
    if (toks[i + 2]?.type === 'ident' && toks[i + 2].value === 'as' && toks[i + 3]?.type === 'ident' && toks[i + 4]?.value === 'from' && toks[i + 5]?.type === 'string') {
      exports.add(toks[i + 3].value);
      imports.push({ spec: toks[i + 5].value, named: [], isDynamic: false });
    } else if (toks[i + 2]?.type === 'ident' && toks[i + 2].value === 'from' && toks[i + 3]?.type === 'string') {
      reExportsAll.push(toks[i + 3].value);
      imports.push({ spec: toks[i + 3].value, named: [], isDynamic: false });
    }
    return;
  }
  const br = cmiReadBraceSpecifiers(toks, i + 1);
  for (const p of br.pairs) exports.add(p.exported);
  if (toks[br.nextIdx]?.type === 'ident' && toks[br.nextIdx].value === 'from' && toks[br.nextIdx + 1]?.type === 'string') {
    imports.push({ spec: toks[br.nextIdx + 1].value, named: br.pairs.map((p) => p.orig), isDynamic: false });
  }
}

function cmiParseExportAt(toks, i, exports, imports, reExportsAll) {
  const n1 = toks[i + 1];
  if (!n1) return;
  if (n1.type === 'ident' && n1.value === 'default') {
    exports.add('default');
    return;
  }
  if (n1.type === 'ident' && (n1.value === 'function' || n1.value === 'class')) {
    const fnIdx = toks[i + 2]?.value === '*' ? i + 3 : i + 2;
    if (toks[fnIdx]?.type === 'ident') exports.add(toks[fnIdx].value);
    return;
  }
  if (n1.type === 'ident' && n1.value === 'async' && toks[i + 2]?.value === 'function') {
    const fnIdx = toks[i + 3]?.value === '*' ? i + 4 : i + 3;
    if (toks[fnIdx]?.type === 'ident') exports.add(toks[fnIdx].value);
    return;
  }
  if (n1.type === 'ident' && (n1.value === 'const' || n1.value === 'let' || n1.value === 'var')) {
    cmiParseExportVarDecl(toks, i + 2, exports);
    return;
  }
  if (n1.value === '*' || n1.value === '{') {
    cmiParseExportStarOrBraces(toks, i, exports, imports, reExportsAll);
  }
}

export function parseModuleInterface(source) {
  const toks = scanJsModuleTokens(source);
  const imports = [];
  const exports = new Set();
  const reExportsAll = [];
  let hasCjsExport = false;

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.type !== 'ident') continue;
    if (tk.value === 'module' && toks[i + 1]?.value === '.' && toks[i + 2]?.value === 'exports') {
      hasCjsExport = true;
      continue;
    }
    if (tk.value === 'require' && toks[i + 1]?.value === '(' && toks[i + 2]?.type === 'string' && toks[i + 3]?.value === ')') {
      imports.push({ spec: toks[i + 2].value, named: [], isDynamic: true });
      continue;
    }
    if (tk.value === 'import') {
      i = cmiParseImportAt(toks, i, imports);
      continue;
    }
    if (tk.value === 'export') {
      cmiParseExportAt(toks, i, exports, imports, reExportsAll);
    }
  }
  return { imports, exports, reExportsAll, hasCjsExport };
}

function collectProjectFiles(rootDir) {
  const jsFiles = [];
  const jsonFiles = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const ext = extname(e.name).toLowerCase();
        if (JS_EXTS.has(ext)) jsFiles.push(p);
        else if (ext === '.json' || ext === '.jsonl') jsonFiles.push(p);
      }
    }
  };
  walk(rootDir);
  return { jsFiles: jsFiles.sort(), jsonFiles: jsonFiles.sort() };
}

// 单子进程批量语法检查（比逐文件 spawn node --check 快约 60 倍）
function batchCheckJsSyntax(files) {
  if (files.length === 0) return new Map();
  const checkerCode = `
    import vm from 'node:vm';
    import fs from 'node:fs';
    const list = JSON.parse(fs.readFileSync(0, 'utf8'));
    const errs = {};
    for (const f of list) {
      let src = fs.readFileSync(f, 'utf8');
      if (src.startsWith('#!')) src = '//' + src.slice(2);
      try {
        if (f.endsWith('.cjs')) new vm.Script(src, { filename: f });
        else if (typeof vm.SourceTextModule === 'function') new vm.SourceTextModule(src, { identifier: f });
        else new vm.Script(src, { filename: f });
      } catch (e) {
        if (f.endsWith('.js')) {
          try { new vm.Script(src, { filename: f }); continue; } catch {}
        }
        errs[f] = (e && e.message) ? String(e.message).split('\\n')[0] : '语法错误';
      }
    }
    process.stdout.write(JSON.stringify(errs));
  `;
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', checkerCode], {
    input: JSON.stringify(files),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (r.status === 0 && r.stdout) {
    try { return new Map(Object.entries(JSON.parse(r.stdout))); } catch { /* fallback below */ }
  }
  const map = new Map();
  for (const f of files) {
    const rs = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (rs.status !== 0) map.set(f, ((rs.stderr || '').split(/\r?\n/).find((l) => /SyntaxError/.test(l)) || '语法错误').trim());
  }
  return map;
}

function loadDeclaredDeps(rootDir) {
  const pkgPath = join(rootDir, 'package.json');
  if (!existsSync(pkgPath)) return { hasPkgJson: false, deps: new Set() };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {})
    ]);
    if (pkg.name) deps.add(pkg.name);
    return { hasPkgJson: true, deps };
  } catch {
    return { hasPkgJson: false, deps: new Set() };
  }
}

const CMI_CORE_SPLIT_RE = /^runner\/core\/(?:cmd-[a-z-]+|commands-[ab]|gates|project-loader|state-calc|gate-checks|graph-edges)\.mjs$/;
const CMI_SHA_EXEMPT_RE = /(?:-fixtures\.mjs$|^skill\/pilot-|^skill\/check-module-integrity\.mjs$|^skill\/check-commit-hygiene\.mjs$)/;

function cmiAuditJsonFile(rootDir, jf, fails) {
  const rel = relative(rootDir, jf).split(sep).join('/');
  if (JSONC_ALLOW_RE.test(rel)) return;
  const raw = readFileSync(jf, 'utf8');
  if (!rel.endsWith('.jsonl')) {
    try { JSON.parse(raw); } catch (e) {
      fails.push(`M5 JSON 配置语法损坏 (${rel})：${e.message}`);
    }
    return;
  }
  const lines = raw.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    try { JSON.parse(line); } catch (e) {
      fails.push(`M5 JSONL 第 ${idx + 1} 行语法损坏 (${rel})：${e.message}`);
      break;
    }
  }
}

function cmiListDirExact(dirEntriesCache, d) {
  if (!dirEntriesCache.has(d)) {
    try { dirEntriesCache.set(d, new Set(readdirSync(d))); }
    catch { dirEntriesCache.set(d, null); }
  }
  return dirEntriesCache.get(d);
}

function cmiVerifyExactCaseFromRoot(rootDir, dirEntriesCache, targetAbs) {
  const rel = relative(rootDir, targetAbs);
  if (rel.startsWith('..')) return { ok: existsSync(targetAbs), mismatch: null };
  const parts = rel.split(sep).filter(Boolean);
  let cur = rootDir;
  for (const part of parts) {
    const set = cmiListDirExact(dirEntriesCache, cur);
    if (!set || !set.has(part)) {
      const ciHit = set ? [...set].find((x) => x.toLowerCase() === part.toLowerCase()) : null;
      return { ok: false, mismatch: ciHit ? `磁盘实际名为「${ciHit}」而非「${part}」（大小写不一致）` : null };
    }
    cur = join(cur, part);
  }
  return { ok: statSync(cur).isFile(), mismatch: null };
}

function cmiResolveRelative(rootDir, dirEntriesCache, fromFile, spec) {
  const cleanSpec = spec.split(/[?#]/)[0];
  const baseAbs = resolve(dirname(fromFile), cleanSpec);
  const cands = [
    baseAbs, baseAbs + '.mjs', baseAbs + '.js', baseAbs + '.cjs', baseAbs + '.json',
    join(baseAbs, 'index.mjs'), join(baseAbs, 'index.js'), join(baseAbs, 'index.cjs')
  ];
  let caseMismatchMsg = null;
  for (const cand of cands) {
    if (!existsSync(cand)) continue;
    try { if (!statSync(cand).isFile()) continue; } catch { continue; }
    const chk = cmiVerifyExactCaseFromRoot(rootDir, dirEntriesCache, cand);
    if (chk.ok) return { resolved: cand, error: null };
    if (chk.mismatch) caseMismatchMsg = chk.mismatch;
  }
  return { resolved: null, error: caseMismatchMsg || '目标文件不存在' };
}

function cmiGetResolvedExports(ctx, absFile, visiting = new Set()) {
  if (ctx.exportSetCache.has(absFile)) return ctx.exportSetCache.get(absFile);
  if (visiting.has(absFile)) return new Set();
  visiting.add(absFile);
  const info = ctx.parsedMap.get(absFile);
  if (!info || extname(absFile).toLowerCase() === '.cjs' || info.hasCjsExport) return null;
  const out = new Set(info.exports);
  for (const starSpec of info.reExportsAll) {
    if (!starSpec.startsWith('.')) continue;
    const r = cmiResolveRelative(ctx.rootDir, ctx.dirEntriesCache, absFile, starSpec);
    const sub = r.resolved ? cmiGetResolvedExports(ctx, r.resolved, visiting) : null;
    if (sub) {
      for (const s of sub) if (s !== 'default') out.add(s);
    }
  }
  ctx.exportSetCache.set(absFile, out);
  return out;
}

function cmiAuditRelativeImport(ctx, f, rel, imp, spec) {
  const r = cmiResolveRelative(ctx.rootDir, ctx.dirEntriesCache, f, spec);
  if (!r.resolved) {
    ctx.fails.push(`M2 相对导入断链或大小写失配 (${rel} -> "${spec}")：${r.error}`);
    return;
  }
  if (imp.named.length === 0 || extname(r.resolved).toLowerCase() === '.json') return;
  const targetExports = cmiGetResolvedExports(ctx, r.resolved);
  if (targetExports === null) return;
  const targetRel = relative(ctx.rootDir, r.resolved).split(sep).join('/');
  for (const sym of imp.named) {
    if (!targetExports.has(sym)) {
      ctx.fails.push(`M3 跨文件具名导出缺失 (${rel})：导入了 {${sym}}，但 ${targetRel} 未导出该符号`);
    }
  }
}

function cmiAuditExternalImport(ctx, rel, spec) {
  if (spec.startsWith('node:')) {
    if (!BUILTINS.has(spec)) ctx.fails.push(`M4 编造了不存在的 Node 内置模块 (${rel})："${spec}"`);
    return;
  }
  if (BUILTINS.has(spec)) return;
  const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  if (ctx.hasPkgJson && !ctx.deps.has(pkgName)) {
    ctx.fails.push(`M4 未声明或幻觉外部依赖包 (${rel})：导入了 "${spec}"，但 package.json 未声明 "${pkgName}"`);
  }
}

function cmiAuditModuleImports(ctx, f, info) {
  const rel = relative(ctx.rootDir, f).split(sep).join('/');
  const isPilot = rel.startsWith('skill/pilot-');
  for (const imp of info.imports) {
    const spec = imp.spec.trim();
    if (!spec) continue;
    if (spec.startsWith('.') || spec.startsWith('/')) {
      if (!isPilot) cmiAuditRelativeImport(ctx, f, rel, imp, spec);
    } else {
      cmiAuditExternalImport(ctx, rel, spec);
    }
  }
}

function cmiAuditConcreteAdapterM6(rel, info, rawSrc, lines, fails) {
  if (lines > 90) {
    fails.push(`M6 具体适配器超长疑似手搓样板 (${rel})：当前 ${lines} 行 > 上限 90 行（请委托 ./_shared.mjs 的 runAdapter）`);
  }
  if (!info.imports.some((imp) => imp.spec === './_shared.mjs')) {
    fails.push(`M6 具体适配器未调用公共底座 (${rel})：必须从 ./_shared.mjs 导入 runAdapter`);
  }
  for (const imp of info.imports) {
    if (/^(?:node:)?(?:crypto|child_process)$/.test(imp.spec)) {
      fails.push(`M6 具体适配器越权直引底层模块 (${rel} -> "${imp.spec}")：请统一通过 ./_shared.mjs 调用`);
    }
  }
  if (/status['"]\s*,\s*['"]--porcelain/.test(rawSrc)) {
    fails.push(`M6 具体适配器重复手写脏树检查 (${rel})：git status --porcelain 已由 ./_shared.mjs 统一接管`);
  }
}

function cmiCountNonCommentLines(rawSrc) {
  return rawSrc.split(/\r?\n/).filter((l) => {
    const s = l.trim();
    return s && !s.startsWith('//') && !s.startsWith('*') && !s.startsWith('/*');
  }).length;
}

function cmiAuditFileM6(rootDir, f, info, fails) {
  const rel = relative(rootDir, f).split(sep).join('/');
  const rawSrc = readFileSync(f, 'utf8');
  const lines = rawSrc.split(/\r?\n/).length;

  if (/^skill\/adapters\/(?!_)[^/]+\.mjs$/.test(rel)) {
    cmiAuditConcreteAdapterM6(rel, info, rawSrc, lines, fails);
  }
  const checkSha = /^(?:runner|skill)\/.*\.mjs$/.test(rel) &&
    rel !== 'skill/hash.mjs' &&
    rel !== 'skill/adapters/_shared.mjs' &&
    !CMI_SHA_EXEMPT_RE.test(rel);
  if (checkSha) {
    const stripped = rawSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\bcreateHash\s*\(\s*['"]sha256['"]\s*\)/.test(stripped)) {
      fails.push(`M6 禁止业务脚本重复手搓 SHA-256 (${rel})：请复用 skill/hash.mjs 的 sha256() 或 _shared.mjs 的 shaBytes()`);
    }
  }
  const effLines = cmiCountNonCommentLines(rawSrc);
  if (/^runner\/atlas\/wb-(?:logic|style|dom)-[a-z]\.mjs$/.test(rel)) {
    fails.push(`M6 禁止机械字母切片回潮 (${rel})：请归入 runner/atlas/ 职责语义模块（见 MODULE-INDEX.md）`);
  } else if (CMI_CORE_SPLIT_RE.test(rel) && effLines > 420) {
    fails.push(`M6 核心拆分子模块有效行数回潮 (${rel})：当前 ${effLines} 有效行 > 上限 420 有效行`);
  } else if (/^runner\/core\/[^/]+\.mjs$/.test(rel) && effLines > 600) {
    fails.push(`M6 核心目录模块超上限 (${rel})：当前 ${effLines} 有效行 > 上限 600 有效行`);
  } else if (/^runner\/(?:atlas|dsh)\/[^/]+\.mjs$/.test(rel) && effLines > 850) {
    fails.push(`M6 工作台/宿主语义模块超上限 (${rel})：当前 ${effLines} 有效行 > 上限 850 有效行（请按业务域拆分，禁止字母切片）`);
  }
}

export function auditModuleIntegrity(rootDir, opts = {}) {
  const fails = [];
  const { jsFiles, jsonFiles } = collectProjectFiles(rootDir);

  // M5：全仓受控 JSON / JSONL 配置语法核验
  for (const jf of jsonFiles) cmiAuditJsonFile(rootDir, jf, fails);

  const { hasPkgJson, deps } = loadDeclaredDeps(rootDir);
  const syntaxErrs = opts.checkSyntax !== false ? batchCheckJsSyntax(jsFiles) : new Map();
  const parsedMap = new Map();
  for (const f of jsFiles) {
    const rel = relative(rootDir, f).split(sep).join('/');
    if (syntaxErrs.has(f)) {
      fails.push(`M1 语法损坏 (${rel})：${syntaxErrs.get(f)}`);
      continue;
    }
    parsedMap.set(f, parseModuleInterface(readFileSync(f, 'utf8')));
  }

  const ctx = { rootDir, hasPkgJson, deps, parsedMap, dirEntriesCache: new Map(), exportSetCache: new Map(), fails };
  for (const [f, info] of parsedMap.entries()) cmiAuditModuleImports(ctx, f, info);

  // M6：公共原语反手搓门禁与核心子模块行数棘轮
  for (const [f, info] of parsedMap.entries()) cmiAuditFileM6(rootDir, f, info, fails);

  return { exitCode: fails.length > 0 ? 1 : 0, fails, scannedFiles: jsFiles.length, jsonFilesCount: jsonFiles.length };
}

function runRedSelfTest(rootDir) {
  let bad = 0;
  const t = (name, cond, detail = '') => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + name + (!cond && detail ? ' → ' + detail : ''));
    if (!cond) bad++;
  };

  const live = auditModuleIntegrity(rootDir);
  t(`真实仓库正样本：全仓 ${live.scannedFiles} 个 JS/ESM 与 ${live.jsonFilesCount} 个 JSON/JSONL 文件全绿`, live.exitCode === 0, live.fails.slice(0, 3).join('；'));

  const tmp = mkdtempSync(join(tmpdir(), 'dg-mod-red-'));
  const mkProj = (name, files) => {
    const d = join(tmp, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', dependencies: { 'allowed-pkg': '^1.0.0' } }));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(d, rel)), { recursive: true });
      writeFileSync(join(d, rel), body, 'utf8');
    }
    return d;
  };

  try {
    const p1 = mkProj('syntax', { 'src/broken.mjs': 'export function f(a, { return a;\n' });
    const r1 = auditModuleIntegrity(p1);
    t('必红样本 1 (M1)：括号未闭合语法损坏 → 必红退 1', r1.exitCode === 1 && r1.fails.some((x) => x.startsWith('M1')));

    const p2 = mkProj('case', {
      'src/util.mjs': 'export const add = (a, b) => a + b;\n',
      'src/main.mjs': 'import { add } from "./Util.mjs";\nexport const v = add(1, 2);\n'
    });
    const r2 = auditModuleIntegrity(p2);
    t('必红样本 2 (M2)：相对导入路径大小写不一致或缺失 (./Util.mjs vs util.mjs) → 必红退 1',
      r2.exitCode === 1 && r2.fails.some((x) => x.startsWith('M2')));

    const p3 = mkProj('named', {
      'src/util.mjs': 'export const realFn = () => 1;\n',
      'src/main.mjs': 'import { hallucinatedFn } from "./util.mjs";\nexport const v = hallucinatedFn();\n'
    });
    const r3 = auditModuleIntegrity(p3);
    t('必红样本 3 (M3)：导入目标模块未导出的具名符号 → 必红退 1',
      r3.exitCode === 1 && r3.fails.some((x) => x.startsWith('M3') && x.includes('hallucinatedFn')));

    const p4 = mkProj('ghost-pkg', {
      'src/main.mjs': 'import magic from "ai-slopsquat-helper";\nexport const v = magic();\n'
    });
    const r4 = auditModuleIntegrity(p4);
    t('必红样本 4 (M4)：导入未在 package.json 声明的幻觉外部包 → 必红退 1',
      r4.exitCode === 1 && r4.fails.some((x) => x.startsWith('M4') && x.includes('ai-slopsquat-helper')));

    const p5 = mkProj('ghost-node', {
      'src/main.mjs': 'import extra from "node:fs/extra-magic";\nexport const v = extra;\n'
    });
    const r5 = auditModuleIntegrity(p5);
    t('必红样本 5 (M4b)：编造不存在的 node: 内置子模块 → 必红退 1',
      r5.exitCode === 1 && r5.fails.some((x) => x.startsWith('M4') && x.includes('node:fs/extra-magic')));

    const p6 = mkProj('bad-json', {
      'contracts/c1/contract.json': '{\n  "id": "c1",\n  // invalid comment\n  "scope": ["src/",]\n}\n'
    });
    const r6 = auditModuleIntegrity(p6);
    t('必红样本 6 (M5)：JSON 配置含尾逗号或注释语法损坏 → 必红退 1',
      r6.exitCode === 1 && r6.fails.some((x) => x.startsWith('M5')));

    const p7 = mkProj('handroll', {
      'skill/adapters/_shared.mjs': 'export function runAdapter() {}\n',
      'skill/adapters/rogue.mjs': 'import { spawnSync } from "node:child_process";\nexport const x = spawnSync;\n',
      'runner/dup-hash.mjs': 'import { createHash } from "node:crypto";\nexport const h = (s) => createHash("sha256").update(s).digest("hex");\n'
    });
    const r7 = auditModuleIntegrity(p7);
    t('必红样本 7 (M6)：适配器绕过 _shared.mjs 直引 child_process 或业务层重复手搓 createHash("sha256") → 必红退 1',
      r7.exitCode === 1 &&
      r7.fails.some((x) => x.includes('未调用公共底座')) &&
      r7.fails.some((x) => x.includes('越权直引底层模块')) &&
      r7.fails.some((x) => x.includes('重复手搓 SHA-256')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(bad === 0 ? '\nRESULT: PASS 零依赖模块完整性门禁与 7 个必红样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rIdx = argv.indexOf('--root');
  const root = resolve(rIdx >= 0 && argv[rIdx + 1] ? argv[rIdx + 1] : REPO);
  if (!existsSync(root)) { console.error('目录不存在：' + root); process.exit(3); }
  if (argv.includes('--red-self-test') || argv.length === 0) process.exit(runRedSelfTest(root));
  const res = auditModuleIntegrity(root);
  if (res.exitCode === 0) {
    console.log(`RESULT: PASS 全仓 ${res.scannedFiles} 个模块与 ${res.jsonFilesCount} 个配置校验通过`);
    process.exit(0);
  }
  for (const f of res.fails) console.error('  ✗ ' + f);
  console.log(`RESULT: FAIL ${res.fails.length} 处模块或配置完整性错误`);
  process.exit(1);
}
