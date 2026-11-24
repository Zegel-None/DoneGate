// 零魔法数字符号依赖图与 Satopää Kneedle 曲率拐点承重接口提取器（兼容有契约与零契约模式，<= 350 行）
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { readMaybe } from '../../skill/io.mjs';
import { maskCommentsAndStrings } from './ast-stub.mjs';

// Satopää et al. (2011) Kneedle 无参最大曲率拐点（均匀分布时返回 0，绝不硬凑假中心）
export function kneedleElbowCount(sortedDescWeights) {
  const pos = (sortedDescWeights || []).filter((w) => w > 0);
  const n = pos.length;
  if (n <= 1) return n;
  const sum = pos.reduce((a, b) => a + b, 0);
  let cum = 0;
  let maxDiff = 0;
  let knee = 0;
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

function chFindBalParens(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function chSplitTopLevelParams(rawParams, maskedParams) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < maskedParams.length; i++) {
    const ch = maskedParams[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(rawParams.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(rawParams.slice(start));
  return parts
    .map((p) => p.trim().replace(/\s*=[\s\S]*$/, '').trim())
    .filter(Boolean);
}

function chExtractFnSignature(raw, symbol) {
  const masked = maskCommentsAndStrings(raw, '.mjs');
  const fnM = masked.match(new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\s*\\(`));
  if (!fnM) return null;
  const openP = fnM.index + fnM[0].length - 1;
  const closeP = chFindBalParens(masked, openP);
  if (closeP <= openP) return null;
  const params = chSplitTopLevelParams(raw.slice(openP + 1, closeP), masked.slice(openP + 1, closeP)).join(', ');
  return `${symbol}(${params})`;
}

export function resolveExportSymbolSignature(root, relFile, symbol, depth = 0) {
  if (depth > 2) return symbol;
  const raw = readMaybe(join(root, relFile));
  if (!raw) return symbol;
  const direct = chExtractFnSignature(raw, symbol);
  if (direct) return direct;
  const reM = raw.match(new RegExp(`export\\s*\\{[\\s\\S]*?\\b${symbol}\\b[\\s\\S]*?\\}\\s*from\\s*['"]([^'"]+)['"]`));
  if (!reM || !reM[1].startsWith('.')) return symbol;
  const base = normalize(join(dirname(relFile), reM[1])).replace(/\\/g, '/');
  const hit = [base, `${base}.mjs`, `${base}/index.mjs`].find((cand) => existsSync(join(root, cand)));
  return hit ? resolveExportSymbolSignature(root, hit, symbol, depth + 1) : symbol;
}

function chUpsertSymbolEntry(seen, symbolDefs, symByName, symName, file, sig, ownerId) {
  const prev = seen.get(symName);
  if (prev) {
    if (!prev.files.includes(file)) prev.files.push(file);
    return;
  }
  const entry = { files: [file], primaryFile: file, symbol: symName, signature: sig, ownerId, crossContracts: [], extFiles: 0 };
  symbolDefs.push(entry);
  seen.set(symName, entry);
  if (!symByName.has(symName)) symByName.set(symName, []);
  symByName.get(symName).push(entry);
}

function chRegisterContractExports(root, node, symbolDefs, symByName) {
  const seen = new Map();
  for (const ex of node.stub?.exportedSymbols || []) {
    if (!ex.symbol || ex.symbol.startsWith('reexport:')) continue;
    const sig = resolveExportSymbolSignature(root, ex.file, ex.symbol);
    chUpsertSymbolEntry(seen, symbolDefs, symByName, ex.symbol, ex.file, sig, node.id);
  }
}

function chCollectLeafPaths(node, out) {
  for (const m of node.modules || []) {
    if (m.path) out.push(m.path);
  }
  for (const sub of node.subgraph?.nodes || []) chCollectLeafPaths(sub, out);
}

function chRegisterFileOutlineExports(root, p, step, outline, seen, symbolDefs, symByName) {
  for (const expStr of outline?.exports || []) {
    const m = expStr.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^const\s+([A-Za-z0-9_$]+)/);
    const sym = m ? (m[1] || m[2]) : '';
    if (!sym) continue;
    const sig = resolveExportSymbolSignature(root, p, sym);
    chUpsertSymbolEntry(seen, symbolDefs, symByName, sym, p, sig, step);
  }
}

function chBuildDomainFallbackGroups(root, hsNodes, fileOutlines, symbolDefs, symByName) {
  const ownerMap = new Map();
  const groupIds = [];
  for (const sn of hsNodes || []) {
    const paths = [];
    chCollectLeafPaths(sn, paths);
    groupIds.push(sn.step);
    const seen = new Map();
    for (const p of paths) {
      ownerMap.set(p, [sn.step]);
      chRegisterFileOutlineExports(root, p, sn.step, fileOutlines[p], seen, symbolDefs, symByName);
    }
  }
  return { groupIds, ownerMap };
}

function chRecordSymbolCaller(dst, cf, srcOwners) {
  if (dst.files.includes(cf)) return;
  dst.extFiles += 1;
  for (const so of srcOwners) {
    if (so && so !== dst.ownerId && !dst.crossContracts.includes(so)) dst.crossContracts.push(so);
  }
}

function chScanFileReferences(root, cf, symByName, srcOwners) {
  const raw = readMaybe(join(root, cf));
  if (!raw) return;
  const masked = maskCommentsAndStrings(raw, extname(cf).toLowerCase());
  const hits = new Set();
  for (const m of masked.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    if (symByName.has(m[0])) hits.add(m[0]);
  }
  for (const symName of hits) {
    for (const dst of symByName.get(symName) || []) chRecordSymbolCaller(dst, cf, srcOwners);
  }
}

function chSelectGroupKneedle(symbolDefs, gid) {
  const mine = symbolDefs.filter((s) => s.ownerId === gid);
  const crossList = mine
    .filter((s) => s.crossContracts.length > 0)
    .sort((a, b) => (b.crossContracts.length * b.extFiles) - (a.crossContracts.length * a.extFiles) || b.extFiles - a.extFiles);
  const crossKnee = kneedleElbowCount(crossList.map((s) => s.crossContracts.length * s.extFiles));
  const selectedCross = crossList.slice(0, crossKnee);
  const intraList = mine.filter((s) => s.crossContracts.length === 0 && s.extFiles > 0).sort((a, b) => b.extFiles - a.extFiles);
  const intraKnee = selectedCross.length <= 1 ? kneedleElbowCount(intraList.map((s) => s.extFiles)) : 0;
  return {
    totalExported: mine.length,
    crossTotal: crossList.length,
    uniformCross: crossList.length > 1 && crossKnee === 0,
    selectedCross,
    selectedIntra: intraList.slice(0, intraKnee)
  };
}

export function computeContractKneedleHubs(root, graphNodes, allFiles, fileOwners, hsNodes = [], fileOutlines = {}) {
  const symbolDefs = [];
  const symByName = new Map();
  let effectiveOwners = fileOwners;
  let targetGroups = (graphNodes || []).map((n) => n.id);
  const isZeroContract = targetGroups.length === 0;

  if (!isZeroContract) {
    for (const n of graphNodes) chRegisterContractExports(root, n, symbolDefs, symByName);
  } else {
    const fb = chBuildDomainFallbackGroups(root, hsNodes, fileOutlines, symbolDefs, symByName);
    targetGroups = fb.groupIds;
    effectiveOwners = fb.ownerMap;
  }
  for (const cf of allFiles) {
    if (/\.(?:mjs|cjs|js|ts)$/.test(cf)) chScanFileReferences(root, cf, symByName, effectiveOwners.get(cf) || []);
  }
  const hubsMap = {};
  for (const gid of targetGroups) hubsMap[gid] = chSelectGroupKneedle(symbolDefs, gid);
  return {
    uniqueSymbolCount: new Set(symbolDefs.map((s) => s.symbol)).size,
    hubsByContract: isZeroContract ? {} : hubsMap,
    hubsByDomain: isZeroContract ? hubsMap : {}
  };
}
