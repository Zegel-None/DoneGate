// 跨文件语义、CBM 开源图谱调用边与 UI 锚点影响面雷达（无截断 1-Hop 单测推导与 ADR 预警，<= 350 行）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { extractFileInterfaceStub } from './ast-stub.mjs';
import { discoverRepoScanDirs } from './cockpit-cache.mjs';
import { queryCbmImpactGraph } from './cockpit-cbm.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from './context-router.mjs';
import { finalizeCliTextView, parseBudgetOption } from './view-budget.mjs';
import { formatMultiHopSectionLines, irInferMultiHopTests } from './impact-multihop.mjs';

const IR_DG_SCAN_DIRS = ['runner', 'skill', 'tests', 'workflows', 'bricks'];
const IR_SKIP_DIRS = [
  'node_modules', '.git', '.donegate', '.cockpit', '.dsh', '.deps', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'target', 'build', 'dist', '_dist', '.next', 'vendor', 'coverage', 'reports'
];
const IR_TEXT_EXTS = new Set([
  '.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.c', '.cpp', '.h',
  '.json', '.toml', '.yml', '.yaml', '.cmd', '.sh'
]);
const IR_ANY_TEST_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$|^runner\/self-test\.mjs$|(^|\/)test_[^/]+\.py$|_test\.(?:py|go|rs)$/i;
const IR_GENERIC_ANCHORS = new Set([
  'app', 'root', 'main', 'title', 'name', 'id', 'list', 'body', 'header', 'footer',
  'icon', 'btn', 'card', 'modal', 'light', 'dark', 'true', 'false', 'index', 'contract', 'shared'
]);

function irIsSpecificAnchor(token) {
  const clean = String(token || '').trim();
  return Boolean(clean) && !IR_GENERIC_ANCHORS.has(clean.toLowerCase());
}

function irRegisterApiRouteVariants(addFn, rawRoute) {
  const clean = rawRoute.replace(/\/+$/, '');
  addFn(clean, 'api-route');
  if (clean.startsWith('/donegate/api/')) addFn(clean.slice('/donegate/api'.length), 'sub-route');
}

function irScanDomAndRouteAnchors(raw, addAnchor) {
  for (const m of raw.matchAll(/\bid=(?:\\)?["']([A-Za-z][A-Za-z0-9_-]+)(?:\\)?["']/g)) {
    if (!m[1].includes('${')) addAnchor(m[1], 'dom-id');
  }
  for (const m of raw.matchAll(/\b(data-[a-z][a-z0-9-]*)=(?:\\)?["']([A-Za-z0-9_-]+)(?:\\)?["']/g)) {
    if (m[1] !== 'data-tip' && !m[2].includes('${')) addAnchor(`${m[1]}="${m[2]}"`, 'data-attr');
  }
  for (const m of raw.matchAll(/(\/(?:donegate\/)?api\/[A-Za-z0-9_./-]+)/g)) {
    irRegisterApiRouteVariants(addAnchor, m[1]);
  }
}

function irExtractPolyglotExports(raw, relPath, addAnchor) {
  if (/\.(mjs|cjs|js|ts|tsx|jsx)$/i.test(relPath)) {
    for (const ex of extractFileInterfaceStub(raw, relPath).exports) {
      if (ex.symbol && !ex.symbol.startsWith('reexport:')) addAnchor(ex.symbol, 'export');
    }
    return;
  }
  if (/\.py$/i.test(relPath)) {
    for (const m of raw.matchAll(/^(?:async\s+def|def|class)\s+([A-Za-z][A-Za-z0-9_]*)\b/gm)) addAnchor(m[1], 'export');
    return;
  }
  if (/\.(?:go|rs)$/i.test(relPath)) {
    for (const m of raw.matchAll(/^(?:pub\s+(?:async\s+)?fn|func)\s+([A-Za-z][A-Za-z0-9_]*)\b/gm)) addAnchor(m[1], 'export');
  }
}

function irExtractAnchorsFromFile(raw, relPath) {
  const anchors = new Map();
  const addAnchor = (token, kind) => {
    if (irIsSpecificAnchor(token) && !anchors.has(token)) anchors.set(token, kind);
  };
  const baseName = basename(relPath);
  if (/\.(json|jsonl|toml|yml|yaml|cmd|sh)$/i.test(baseName)) addAnchor(baseName, 'config-file');
  irExtractPolyglotExports(raw, relPath, addAnchor);
  irScanDomAndRouteAnchors(raw, addAnchor);
  const stem = baseName.replace(/\.[a-z0-9]+$/i, '');
  if (stem && !IR_GENERIC_ANCHORS.has(stem.toLowerCase())) addAnchor(stem, 'module-stem');
  return anchors;
}

function irAddSingleFileAnchors(root, absFile, selfFiles, put) {
  const rel = relative(root, absFile).split(sep).join('/');
  selfFiles.add(rel);
  for (const [tok, kind] of irExtractAnchorsFromFile(readFileSync(absFile, 'utf8'), rel).entries()) put(tok, kind, rel);
}

function irAddSingleRawTarget(root, rawTarget, selfFiles, put) {
  const candAbs = resolve(root, rawTarget);
  if (existsSync(candAbs)) {
    const st = statSync(candAbs);
    if (st.isDirectory()) {
      for (const f of walk(candAbs, { skipDirs: IR_SKIP_DIRS }).files) {
        if (IR_TEXT_EXTS.has(extname(f).toLowerCase())) irAddSingleFileAnchors(root, f, selfFiles, put);
      }
      return;
    }
    if (st.isFile()) irAddSingleFileAnchors(root, candAbs, selfFiles, put);
    return;
  }
  if (rawTarget.startsWith('/donegate/api/') || rawTarget.startsWith('/api/')) {
    irRegisterApiRouteVariants((tok, kind) => put(tok, kind, 'cli'), rawTarget);
    return;
  }
  const isDomHash = rawTarget.startsWith('#');
  put(isDomHash ? rawTarget.slice(1) : rawTarget, isDomHash ? 'dom-id' : 'literal', 'cli');
}

function irResolveSearchAnchors(root, rawTargets) {
  const selfFiles = new Set(), anchorMap = new Map();
  const put = (tok, kind, source) => {
    if (irIsSpecificAnchor(tok) && !anchorMap.has(tok)) anchorMap.set(tok, { token: tok, kind, source });
  };
  for (const rawTarget of rawTargets) irAddSingleRawTarget(root, rawTarget, selfFiles, put);
  return { selfFiles, anchors: [...anchorMap.values()] };
}

function irResolveScanDirs(root, opts) {
  if (Array.isArray(opts?.scanDirs) && opts.scanDirs.length > 0) return opts.scanDirs;
  if (opts?.adapterId !== 'generic' && existsSync(join(root, 'runner/donegate.mjs'))) return IR_DG_SCAN_DIRS;
  return discoverRepoScanDirs(root);
}

function irCollectRepoCandidateFiles(root, selfFiles, opts) {
  const out = [];
  for (const d of irResolveScanDirs(root, opts)) {
    const absDir = join(root, d);
    if (!existsSync(absDir)) continue;
    for (const f of walk(absDir, { skipDirs: IR_SKIP_DIRS }).files) {
      const rel = relative(root, f).split(sep).join('/');
      if (!selfFiles.has(rel) && IR_TEXT_EXTS.has(extname(rel).toLowerCase())) out.push({ abs: f, rel });
    }
  }
  const rootExtras = opts?.adapterId === 'generic'
    ? readdirSync(root).filter((n) => !n.startsWith('.') && IR_TEXT_EXTS.has(extname(n).toLowerCase()))
    : ['install-dsh-web.cmd'];
  for (const rc of rootExtras) {
    const p = join(root, rc);
    if (!selfFiles.has(rc) && existsSync(p) && statSync(p).isFile()) out.push({ abs: p, rel: rc });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function irCheckKindBoundary(raw, idx, endIdx, kind) {
  const prev = idx > 0 ? raw[idx - 1] : '', next = endIdx < raw.length ? raw[endIdx] : '';
  if (kind === 'sub-route') return /['"`]/.test(prev) && /['"`?#]/.test(next);
  if (kind === 'api-route') return !/[A-Za-z0-9_./-]/.test(next);
  if (kind === 'module-stem' || kind === '1hop-module') return /['"`/\\]/.test(prev) && (next === '.' || /['"`/]/.test(next));
  if (kind === 'dom-id') return /[#='"`]/.test(prev) && !/[A-Za-z0-9_-]/.test(next);
  if (kind === 'config-file') return !/[A-Za-z0-9_.-]/.test(prev) && !/[A-Za-z0-9_.-]/.test(next);
  return !/[A-Za-z0-9_$-]/.test(prev) && !/[A-Za-z0-9_$-]/.test(next);
}

function irFindFirstBoundedHit(raw, anchor) {
  const { token, kind } = anchor;
  if (kind === 'data-attr') {
    const eqIdx = token.indexOf('='), attr = token.slice(0, eqIdx), val = token.slice(eqIdx + 2, -1);
    for (const pat of [`${attr}="${val}"`, `${attr}='${val}'`, `${attr}=\\"${val}\\"`]) {
      const pIdx = raw.indexOf(pat);
      if (pIdx >= 0) return pIdx;
    }
    return -1;
  }
  let pos = raw.indexOf(token);
  while (pos >= 0) {
    if (irCheckKindBoundary(raw, pos, pos + token.length, kind)) return pos;
    pos = raw.indexOf(token, pos + 1);
  }
  return -1;
}

function irFindAnchorHitsInText(raw, anchors) {
  const matched = [];
  for (const a of anchors) {
    const idx = irFindFirstBoundedHit(raw, a);
    if (idx >= 0) matched.push({ token: a.token, kind: a.kind, line: raw.slice(0, idx).split('\n').length });
  }
  return matched;
}

function irResolveOwners(rel, nodes) {
  return nodes.filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
}

function irMergeCbmHitsByFile(cbmEdges) {
  const map = new Map();
  for (const e of cbmEdges || []) {
    if (!map.has(e.file)) map.set(e.file, []);
    const arr = map.get(e.file);
    if (!arr.some((x) => x.token === e.token && x.kind === e.kind)) {
      arr.push({ token: e.token, kind: e.kind, line: e.line || 1 });
    }
  }
  return map;
}

function irInferTransitiveTests(candidates, affectedProdFiles, directTestSet) {
  const prodStems = [...new Set(
    affectedProdFiles.map((p) => basename(p.file).replace(/\.[a-z0-9]+$/i, '')).filter((s) => s && !IR_GENERIC_ANCHORS.has(s.toLowerCase()))
  )];
  if (prodStems.length === 0) return [];
  const stemAnchors = prodStems.map((s) => ({ token: s, kind: '1hop-module' }));
  const inferred = [];
  for (const { abs, rel } of candidates) {
    if (!IR_ANY_TEST_RE.test(rel) || directTestSet.has(rel)) continue;
    const hits = irFindAnchorHitsInText(readFileSync(abs, 'utf8'), stemAnchors);
    if (hits.length > 0) inferred.push({ file: rel, hitCount: hits.length, hits });
  }
  return inferred;
}

function irScanAffectedAdrs(root, selfFiles, affectedProdFiles, allContracts, isGeneric) {
  const adrDir = join(root, 'decisions');
  if (isGeneric || !existsSync(adrDir)) return [];
  const pathTerms = [...selfFiles, ...affectedProdFiles.map((p) => p.file)];
  const matched = [];
  for (const f of readdirSync(adrDir).filter((x) => x.endsWith('.md')).sort()) {
    const raw = readFileSync(join(adrDir, f), 'utf8');
    const directHit = pathTerms.find((p) => p && raw.includes(p));
    const contractHit = !directHit ? [...allContracts].find((c) => raw.includes(c)) : null;
    if (directHit || contractHit) matched.push({ file: `decisions/${f}`, matchedBy: directHit || contractHit });
  }
  return matched;
}

function irCollectTestCommands(affectedTests, transitiveTests, multiHopTests) {
  const allRecFiles = [...new Set([...affectedTests, ...transitiveTests, ...multiHopTests].map((t) => t.file))];
  const vitestTargets = allRecFiles.filter((f) => /\.(?:test|spec)\.(?:mjs|cjs|js|ts|tsx|jsx)$/i.test(f));
  const pytestTargets = allRecFiles.filter((f) => /\.py$/i.test(f));
  const goTargets = [...new Set(allRecFiles.filter((f) => /_test\.go$/i.test(f)).map((f) => `./${f.split('/').slice(0, -1).join('/')}`))];
  const fixtureTargets = allRecFiles.filter((f) => /-fixtures\.mjs$|^runner\/self-test\.mjs$/i.test(f));
  return {
    suggestedVitestCommand: vitestTargets.length > 0 ? `npx vitest run ${vitestTargets.join(' ')}` : null,
    suggestedPytestCommand: pytestTargets.length > 0 ? `pytest ${pytestTargets.join(' ')}` : null,
    suggestedGoTestCommand: goTargets.length > 0 ? `go test ${goTargets.join(' ')}` : null,
    suggestedFixtureCommands: fixtureTargets.map((f) => `node ${f}`)
  };
}

export function analyzeImpactRadar(projectRoot, rawTargets = [], opts = {}) {
  const t0 = Date.now(), root = resolve(projectRoot), isGeneric = opts?.adapterId === 'generic';
  const cliPrefix = opts?.cliPrefix || (isGeneric ? 'zoom-cockpit' : 'donegate');
  if (!existsSync(root) || rawTargets.length === 0) {
    return { exitCode: 3, error: `用法：${cliPrefix} impact <file-or-anchor...> [--json]` };
  }
  const { selfFiles, anchors } = irResolveSearchAnchors(root, rawTargets);
  const graph = isGeneric ? { ok: false, nodes: [] } : discoverHermeticGraph(root);
  const nodes = graph.ok ? graph.nodes : [];
  const selfContracts = new Set([...selfFiles].flatMap((sf) => irResolveOwners(sf, nodes)));
  const candidates = irCollectRepoCandidateFiles(root, selfFiles, opts);
  const cbmByFile = irMergeCbmHitsByFile(queryCbmImpactGraph(root, selfFiles, rawTargets));

  const affectedTests = [], affectedProdFiles = [], crossContractSet = new Set();
  for (const { abs, rel } of candidates) {
    const textHits = irFindAnchorHitsInText(readFileSync(abs, 'utf8'), anchors);
    const cbmHits = (cbmByFile.get(rel) || []).filter((ch) => !textHits.some((th) => th.token === ch.token));
    const hits = [...textHits, ...cbmHits];
    if (hits.length === 0) continue;
    if (IR_ANY_TEST_RE.test(rel)) {
      affectedTests.push({ file: rel, hitCount: hits.length, hits });
      continue;
    }
    const owners = irResolveOwners(rel, nodes);
    for (const ow of owners) if (!selfContracts.has(ow)) crossContractSet.add(ow);
    affectedProdFiles.push({ file: rel, owners, hitCount: hits.length, hits });
  }

  const directTestSet = new Set(affectedTests.map((t) => t.file));
  const transitiveTests = irInferTransitiveTests(candidates, affectedProdFiles, directTestSet);
  const rawMultiHop = irInferMultiHopTests(root, selfFiles, { maxHops: 3 });
  const multiHopTests = rawMultiHop.filter((t) => !(t.hops === 1 && directTestSet.has(t.file)));
  const affectedAdrs = irScanAffectedAdrs(root, selfFiles, affectedProdFiles, new Set([...selfContracts, ...crossContractSet]), isGeneric);

  return {
    exitCode: 0, durationMs: Date.now() - t0, targets: [...rawTargets], extractedAnchorCount: anchors.length,
    selfContracts: [...selfContracts].sort(), crossContractIds: [...crossContractSet].sort(),
    affectedTests, transitiveTests, multiHopTests, affectedProdFiles, affectedAdrs,
    ...irCollectTestCommands(affectedTests, transitiveTests, multiHopTests)
  };
}

function irFormatHitList(hits) {
  return hits.map((h) => `${h.token}@L${h.line}`).join(', ');
}

function irAppendImpactProdAndAdrs(lines, res, startSec, isGeneric) {
  let sec = startSec;
  lines.push(`\n${++sec}. 波及生产与配置模块（${res.affectedProdFiles.length} 个，完整无截断）：`);
  if (res.affectedProdFiles.length === 0) lines.push('   （未检出跨文件生产引用）');
  for (const p of res.affectedProdFiles) {
    const ownerTag = isGeneric ? '' : ` (${p.owners.join(',') || '共享'})`;
    lines.push(`   · ${p.file}${ownerTag} [${irFormatHitList(p.hits)}]`);
  }
  if (res.affectedAdrs?.length > 0) {
    lines.push(`\n${++sec}. 关联历史架构决策 ADR 预警（${res.affectedAdrs.length} 篇）：`);
    for (const a of res.affectedAdrs) lines.push(`   · ${a.file} (命中依据: ${a.matchedBy})`);
  }
  for (const cmd of [res.suggestedVitestCommand, res.suggestedPytestCommand, res.suggestedGoTestCommand].filter(Boolean)) {
    lines.push(`\n建议提交前联跑单测：${cmd}`);
  }
  for (const fc of res.suggestedFixtureCommands) lines.push(`建议提交前联跑夹具：${fc}`);
}

function irFormatImpactReportText(res, opts = {}) {
  const isGeneric = opts?.adapterId === 'generic';
  const title = opts?.reportTitle || (isGeneric ? '跨文件符号、CBM 图谱与路由影响面雷达' : 'DoneGate 跨文件契约、CBM 图谱与 UI 锚点影响面雷达');
  const lines = [`=== ${title}（提取锚点 ${res.extractedAnchorCount} 个，耗时 ${res.durationMs}ms） ===`];
  if (!isGeneric) {
    lines.push(`本卡归属契约：${res.selfContracts.join(', ') || '（字面量锚点查询）'} | 跨卡波及契约：${res.crossContractIds.join(', ') || '无'}`);
  }
  let sec = 0;
  lines.push(`\n${++sec}. 直连引用单测与夹具（${res.affectedTests.length} 个，完整无截断）：`);
  if (res.affectedTests.length === 0) lines.push('   （未检出字面量直连单测）');
  for (const t of res.affectedTests) lines.push(`   · ${t.file} [${irFormatHitList(t.hits)}]`);
  if (res.transitiveTests.length > 0) {
    lines.push(`\n${++sec}. 1-Hop 生产模块覆盖单测（自动推导推荐回归 ${res.transitiveTests.length} 个，完整无截断）：`);
    for (const t of res.transitiveTests) lines.push(`   · ${t.file} [${irFormatHitList(t.hits)}]`);
  }
  if (res.multiHopTests?.length > 0) lines.push('', ...formatMultiHopSectionLines(res.multiHopTests, ++sec));
  irAppendImpactProdAndAdrs(lines, res, sec, isGeneric);
  return lines.join('\n');
}

export function cmdImpact(projectRoot, opts = {}) {
  const budgetOpt = parseBudgetOption(opts.budget);
  if (!budgetOpt.ok) return { exitCode: 3, stderr: budgetOpt.stderr };
  const res = analyzeImpactRadar(projectRoot, Array.isArray(opts.targets) ? opts.targets : [], opts);
  if (res.exitCode !== 0) return { exitCode: res.exitCode, stderr: res.error };
  if (opts.json) return { exitCode: 0, impact: res, stdout: JSON.stringify(res, null, 2) };
  const cliPrefix = opts?.cliPrefix || 'node runner/donegate.mjs';
  const expandHint = `${cliPrefix} impact ${(opts.targets || []).join(' ')}`.trim();
  const view = finalizeCliTextView(irFormatImpactReportText(res, opts), budgetOpt.value, expandHint);
  if (!view.ok) return { exitCode: view.exitCode, stderr: view.stderr };
  return { exitCode: 0, impact: res, stdout: view.stdout };
}
