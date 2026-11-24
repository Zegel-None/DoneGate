// 跨文件语义与 UI 锚点影响面雷达（基于语法类别词法边界消歧与 1-Hop 生产模块关联单测自动推导，<= 350 行）
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { extractFileInterfaceStub } from './ast-stub.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from './context-router.mjs';

const IR_SCAN_DIRS = ['runner', 'skill', 'tests', 'workflows', 'bricks'];
const IR_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const IR_TEXT_EXTS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.json', '.cmd']);
const IR_TEST_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$|^runner\/self-test\.mjs$/i;
const IR_GENERIC_ANCHORS = new Set([
  'app', 'root', 'main', 'title', 'name', 'id', 'list', 'body', 'header', 'footer',
  'icon', 'btn', 'card', 'modal', 'light', 'dark', 'true', 'false', 'index', 'contract', 'shared'
]);

function irIsSpecificAnchor(token) {
  const clean = String(token || '').trim();
  if (!clean) return false;
  return !IR_GENERIC_ANCHORS.has(clean.toLowerCase());
}

function irRegisterApiRouteVariants(addFn, rawRoute) {
  const clean = rawRoute.replace(/\/+$/, '');
  addFn(clean, 'api-route');
  if (clean.startsWith('/donegate/api/')) {
    addFn(clean.slice('/donegate/api'.length), 'sub-route');
  }
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

function irExtractAnchorsFromFile(raw, relPath) {
  const anchors = new Map();
  const addAnchor = (token, kind) => {
    if (irIsSpecificAnchor(token) && !anchors.has(token)) anchors.set(token, kind);
  };
  const baseName = basename(relPath);
  if (/\.(json|jsonl|cmd)$/i.test(baseName)) addAnchor(baseName, 'config-file');
  if (/\.(mjs|cjs|js|ts|tsx|jsx)$/i.test(relPath)) {
    for (const ex of extractFileInterfaceStub(raw, relPath).exports) {
      if (ex.symbol && !ex.symbol.startsWith('reexport:')) addAnchor(ex.symbol, 'export');
    }
  }
  irScanDomAndRouteAnchors(raw, addAnchor);
  const stem = baseName.replace(/\.[a-z0-9]+$/i, '');
  if (stem && !IR_GENERIC_ANCHORS.has(stem.toLowerCase())) addAnchor(stem, 'module-stem');
  return anchors;
}

function irAddSingleRawTarget(root, rawTarget, selfFiles, put) {
  const candAbs = resolve(root, rawTarget);
  if (existsSync(candAbs)) {
    const rel = relative(root, candAbs).split(sep).join('/');
    selfFiles.add(rel);
    for (const [tok, kind] of irExtractAnchorsFromFile(readFileSync(candAbs, 'utf8'), rel).entries()) {
      put(tok, kind, rel);
    }
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
  const selfFiles = new Set();
  const anchorMap = new Map();
  const put = (tok, kind, source) => {
    if (irIsSpecificAnchor(tok) && !anchorMap.has(tok)) anchorMap.set(tok, { token: tok, kind, source });
  };
  for (const rawTarget of rawTargets) irAddSingleRawTarget(root, rawTarget, selfFiles, put);
  return { selfFiles, anchors: [...anchorMap.values()] };
}

function irCollectRepoCandidateFiles(root, selfFiles) {
  const out = [];
  for (const d of IR_SCAN_DIRS) {
    const absDir = join(root, d);
    if (!existsSync(absDir)) continue;
    for (const f of walk(absDir, { skipDirs: IR_SKIP_DIRS }).files) {
      const rel = relative(root, f).split(sep).join('/');
      if (!selfFiles.has(rel) && IR_TEXT_EXTS.has(extname(rel).toLowerCase())) out.push({ abs: f, rel });
    }
  }
  for (const rc of ['install-dsh-web.cmd']) {
    const p = join(root, rc);
    if (!selfFiles.has(rc) && existsSync(p)) out.push({ abs: p, rel: rc });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function irCheckKindBoundary(raw, idx, endIdx, kind) {
  const prev = idx > 0 ? raw[idx - 1] : '';
  const next = endIdx < raw.length ? raw[endIdx] : '';
  if (kind === 'sub-route') return /['"`]/.test(prev) && /['"`?#]/.test(next);
  if (kind === 'api-route') return !/[A-Za-z0-9_./-]/.test(next);
  if (kind === 'module-stem' || kind === '1hop-module') {
    return /['"`/\\]/.test(prev) && (next === '.' || /['"`/]/.test(next));
  }
  if (kind === 'dom-id') return /[#='"`]/.test(prev) && !/[A-Za-z0-9_-]/.test(next);
  if (kind === 'config-file') return !/[A-Za-z0-9_.-]/.test(prev) && !/[A-Za-z0-9_.-]/.test(next);
  return !/[A-Za-z0-9_$-]/.test(prev) && !/[A-Za-z0-9_$-]/.test(next);
}

function irFindFirstBoundedHit(raw, anchor) {
  const { token, kind } = anchor;
  if (kind === 'data-attr') {
    const eqIdx = token.indexOf('=');
    const attr = token.slice(0, eqIdx), val = token.slice(eqIdx + 2, -1);
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
    if (idx < 0) continue;
    matched.push({ token: a.token, kind: a.kind, line: raw.slice(0, idx).split('\n').length });
  }
  return matched;
}

function irResolveOwners(rel, nodes) {
  return nodes.filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
}

function irInferTransitiveTests(candidates, affectedProdFiles, directTestSet) {
  const prodStems = [...new Set(
    affectedProdFiles
      .map((p) => basename(p.file).replace(/\.[a-z0-9]+$/i, ''))
      .filter((s) => s && !IR_GENERIC_ANCHORS.has(s.toLowerCase()))
  )];
  if (prodStems.length === 0) return [];
  const stemAnchors = prodStems.map((s) => ({ token: s, kind: '1hop-module' }));
  const inferred = [];
  for (const { abs, rel } of candidates) {
    if (!IR_TEST_RE.test(rel) || directTestSet.has(rel)) continue;
    const hits = irFindAnchorHitsInText(readFileSync(abs, 'utf8'), stemAnchors);
    if (hits.length > 0) inferred.push({ file: rel, hitCount: hits.length, hits: hits.slice(0, 6) });
  }
  return inferred;
}

export function analyzeImpactRadar(projectRoot, rawTargets = []) {
  const t0 = Date.now();
  const root = resolve(projectRoot);
  if (!existsSync(root) || rawTargets.length === 0) {
    return { exitCode: 3, error: '用法：donegate impact <file-or-anchor...> [--json]' };
  }
  const { selfFiles, anchors } = irResolveSearchAnchors(root, rawTargets);
  const graph = discoverHermeticGraph(root);
  const nodes = graph.ok ? graph.nodes : [];
  const selfContracts = new Set([...selfFiles].flatMap((sf) => irResolveOwners(sf, nodes)));
  const candidates = irCollectRepoCandidateFiles(root, selfFiles);

  const affectedTests = [], affectedProdFiles = [], crossContractSet = new Set();
  for (const { abs, rel } of candidates) {
    const hits = irFindAnchorHitsInText(readFileSync(abs, 'utf8'), anchors);
    if (hits.length === 0) continue;
    if (IR_TEST_RE.test(rel)) {
      affectedTests.push({ file: rel, hitCount: hits.length, hits: hits.slice(0, 8) });
      continue;
    }
    const owners = irResolveOwners(rel, nodes);
    for (const ow of owners) {
      if (!selfContracts.has(ow)) crossContractSet.add(ow);
    }
    affectedProdFiles.push({ file: rel, owners, hitCount: hits.length, hits: hits.slice(0, 8) });
  }

  const directSet = new Set(affectedTests.map((t) => t.file));
  const transitiveTests = irInferTransitiveTests(candidates, affectedProdFiles, directSet);
  const allRecTests = [...affectedTests, ...transitiveTests];
  const vitestTargets = allRecTests.filter((t) => /\.test\.[a-z0-9]+$/i.test(t.file)).map((t) => t.file);
  const fixtureTargets = allRecTests.filter((t) => /-fixtures\.mjs$|^runner\/self-test\.mjs$/i.test(t.file)).map((t) => t.file);

  return {
    exitCode: 0,
    durationMs: Date.now() - t0,
    targets: [...rawTargets],
    extractedAnchorCount: anchors.length,
    selfContracts: [...selfContracts].sort(),
    crossContractIds: [...crossContractSet].sort(),
    affectedTests,
    transitiveTests,
    affectedProdFiles,
    suggestedVitestCommand: vitestTargets.length > 0 ? `npx vitest run ${vitestTargets.slice(0, 8).join(' ')}` : null,
    suggestedFixtureCommands: fixtureTargets.slice(0, 6).map((f) => `node ${f}`)
  };
}

export function cmdImpact(projectRoot, opts = {}) {
  const res = analyzeImpactRadar(projectRoot, Array.isArray(opts.targets) ? opts.targets : []);
  if (res.exitCode !== 0) return { exitCode: res.exitCode, stderr: res.error };
  if (opts.json) return { exitCode: 0, impact: res, stdout: JSON.stringify(res, null, 2) };

  const lines = [
    `=== DoneGate 跨文件契约与 UI 锚点影响面雷达（提取锚点 ${res.extractedAnchorCount} 个，耗时 ${res.durationMs}ms） ===`,
    `本卡归属契约：${res.selfContracts.join(', ') || '（字面量锚点查询）'} | 跨卡波及契约：${res.crossContractIds.join(', ') || '无'}`
  ];
  lines.push(`\n1. 直连引用单测与夹具（${res.affectedTests.length} 个）：`);
  if (res.affectedTests.length === 0) lines.push('   （未检出字面量直连单测）');
  for (const t of res.affectedTests) {
    lines.push(`   · ${t.file} [${t.hits.slice(0, 4).map((h) => `${h.token}@L${h.line}`).join(', ')}]`);
  }
  if (res.transitiveTests.length > 0) {
    lines.push(`\n2. 1-Hop 生产模块覆盖单测（自动推导推荐回归 ${res.transitiveTests.length} 个）：`);
    for (const t of res.transitiveTests.slice(0, 12)) {
      lines.push(`   · ${t.file} [${t.hits.slice(0, 3).map((h) => `${h.token}@L${h.line}`).join(', ')}]`);
    }
  }
  lines.push(`\n3. 波及生产与配置模块（${res.affectedProdFiles.length} 个）：`);
  if (res.affectedProdFiles.length === 0) lines.push('   （未检出跨文件生产引用）');
  for (const p of res.affectedProdFiles.slice(0, 20)) {
    lines.push(`   · ${p.file} (${p.owners.join(',') || '共享'}) [${p.hits.slice(0, 8).map((h) => `${h.token}@L${h.line}`).join(', ')}]`);
  }
  if (res.suggestedVitestCommand) lines.push(`\n建议提交前联跑单测：${res.suggestedVitestCommand}`);
  for (const fc of res.suggestedFixtureCommands) lines.push(`建议提交前联跑夹具：${fc}`);
  return { exitCode: 0, impact: res, stdout: lines.join('\n') };
}
