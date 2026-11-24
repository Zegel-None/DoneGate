// 跨文件语义与 UI 锚点影响面雷达（STORM/NP-Bench 边界契约感知，<= 350 行）
// 在修改源码文件、DOM ID、data-* 属性、HTTP 路由或导出符号前，静态反查全仓受影响的跨卡生产模块与关联单测
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { extractFileInterfaceStub } from './ast-stub.mjs';
import { discoverHermeticGraph, fileBelongsToScopes } from './context-router.mjs';

const IR_SCAN_DIRS = ['runner', 'skill', 'tests', 'workflows'];
const IR_SKIP_DIRS = ['node_modules', '.git', '.donegate', '.dsh', 'dist', '_dist', 'coverage', 'reports', 'workflows/.deps'];
const IR_TEXT_EXTS = new Set(['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.json']);
const IR_TEST_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$|-fixtures\.mjs$/i;
const IR_GENERIC_ANCHORS = new Set(['app', 'root', 'main', 'title', 'name', 'id', 'list', 'body', 'header', 'footer', 'icon', 'btn', 'card', 'modal', 'light', 'dark', 'true', 'false']);

function irIsSpecificAnchor(token) {
  if (!token || token.length < 4) return false;
  return !IR_GENERIC_ANCHORS.has(token.toLowerCase());
}

function irExtractAnchorsFromFile(raw, relPath) {
  const anchors = new Map();
  const addAnchor = (token, kind) => {
    if (irIsSpecificAnchor(token) && !anchors.has(token)) anchors.set(token, kind);
  };
  if (/\.(mjs|cjs|js|ts|tsx|jsx)$/i.test(relPath)) {
    const stub = extractFileInterfaceStub(raw, relPath);
    for (const ex of stub.exports) {
      if (ex.symbol && !ex.symbol.startsWith('reexport:')) addAnchor(ex.symbol, 'export');
    }
  }
  for (const m of raw.matchAll(/\bid=(?:\\)?["']([A-Za-z][A-Za-z0-9_-]{3,})(?:\\)?["']/g)) {
    if (!m[1].includes('${')) addAnchor(m[1], 'dom-id');
  }
  for (const m of raw.matchAll(/\b(data-[a-z][a-z0-9-]*)=(?:\\)?["']([A-Za-z0-9_-]{2,})(?:\\)?["']/g)) {
    const attrName = m[1], attrVal = m[2];
    if (attrName === 'data-tip' || attrVal.includes('${')) continue;
    addAnchor(`${attrName}="${attrVal}"`, 'data-attr');
    if (attrVal.length >= 5) addAnchor(attrVal, attrName);
  }
  for (const m of raw.matchAll(/(\/(?:donegate\/)?api\/[A-Za-z0-9_/-]{3,})/g)) {
    addAnchor(m[1].replace(/\/+$/, ''), 'api-route');
  }
  const stem = relPath.replace(/\.[a-z0-9]+$/i, '').split('/').pop();
  if (stem && stem.length >= 5 && !IR_GENERIC_ANCHORS.has(stem)) addAnchor(stem, 'module-stem');
  return anchors;
}

function irResolveSearchAnchors(root, rawTargets) {
  const selfFiles = new Set();
  const anchorMap = new Map();
  for (const rawTarget of rawTargets) {
    const candAbs = resolve(root, rawTarget);
    if (existsSync(candAbs)) {
      const rel = relative(root, candAbs).split(sep).join('/');
      selfFiles.add(rel);
      const raw = readFileSync(candAbs, 'utf8');
      for (const [tok, kind] of irExtractAnchorsFromFile(raw, rel).entries()) {
        anchorMap.set(tok, { token: tok, kind, source: rel });
      }
    } else if (irIsSpecificAnchor(rawTarget)) {
      anchorMap.set(rawTarget, { token: rawTarget, kind: 'literal', source: 'cli' });
    }
  }
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
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function irFindAnchorHitsInText(raw, anchors) {
  const matched = [];
  for (const a of anchors) {
    const idx = raw.indexOf(a.token);
    if (idx < 0) continue;
    const lineNo = raw.slice(0, idx).split('\n').length;
    matched.push({ token: a.token, kind: a.kind, line: lineNo });
  }
  return matched;
}

function irResolveOwners(rel, nodes) {
  return nodes.filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
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

  const affectedTests = [];
  const affectedProdFiles = [];
  const crossContractSet = new Set();

  for (const { abs, rel } of irCollectRepoCandidateFiles(root, selfFiles)) {
    const raw = readFileSync(abs, 'utf8');
    const hits = irFindAnchorHitsInText(raw, anchors);
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

  const vitestTargets = affectedTests.filter((t) => /\.test\.[a-z0-9]+$/i.test(t.file)).map((t) => t.file);
  const fixtureTargets = affectedTests.filter((t) => /-fixtures\.mjs$/i.test(t.file)).map((t) => t.file);
  return {
    exitCode: 0,
    durationMs: Date.now() - t0,
    targets: [...rawTargets],
    extractedAnchorCount: anchors.length,
    selfContracts: [...selfContracts].sort(),
    crossContractIds: [...crossContractSet].sort(),
    affectedTests,
    affectedProdFiles,
    suggestedVitestCommand: vitestTargets.length > 0 ? `npx vitest run ${vitestTargets.join(' ')}` : null,
    suggestedFixtureCommands: fixtureTargets.map((f) => `node ${f}`)
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
  lines.push(`\n1. 波及单测与夹具（${res.affectedTests.length} 个）：`);
  if (res.affectedTests.length === 0) lines.push('   （未检出直接引用上述锚点的单测文件）');
  for (const t of res.affectedTests) {
    const summary = t.hits.slice(0, 4).map((h) => `${h.token}@L${h.line}`).join(', ');
    lines.push(`   · ${t.file} [${summary}]`);
  }
  lines.push(`\n2. 波及生产与配置模块（${res.affectedProdFiles.length} 个）：`);
  if (res.affectedProdFiles.length === 0) lines.push('   （未检出跨文件生产引用）');
  for (const p of res.affectedProdFiles.slice(0, 15)) {
    const summary = p.hits.slice(0, 3).map((h) => `${h.token}@L${h.line}`).join(', ');
    lines.push(`   · ${p.file} (${p.owners.join(',') || '共享'}) [${summary}]`);
  }
  if (res.suggestedVitestCommand) lines.push(`\n建议提交前联跑单测：${res.suggestedVitestCommand}`);
  for (const fc of res.suggestedFixtureCommands) lines.push(`建议提交前联跑夹具：${fc}`);
  return { exitCode: 0, impact: res, stdout: lines.join('\n') };
}
