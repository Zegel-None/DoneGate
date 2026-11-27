// 极薄契约与决策路径关联器及末步按行源码直读切片器（对接开源图谱坐标与本仓治理边界，<= 350 行）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { buildFileSkeleton, fileBelongsToScopes, isSharedGovernanceFile, queryCbmFileGraph, queryCbmSymbolTrace } from '../core/index.mjs';

export function resolveFileContractOwners(graphNodes, relFile) {
  return (graphNodes || []).filter((n) => fileBelongsToScopes(relFile, n.scope || [])).map((n) => n.id);
}

const CS_GENERIC_BASENAMES = new Set([
  'index.mjs', 'index.js', 'index.ts', 'contract.mjs', 'contract.json',
  'verify.mjs', 'README.md', 'README.en.md', 'SKILL.md', 'AGENTS.md', 'package.json'
]);

function csBuildRelocatedBasenameRegex(normPath) {
  const base = normPath.split('/').pop() || '';
  if (!base || !base.includes('.') || CS_GENERIC_BASENAMES.has(base) || base.length < 7) return null;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_.-])`);
}

export function matchPathBoundAdrs(adrs, relFile, ownerIds = []) {
  const norm = String(relFile || '').replace(/\\/g, '/');
  const baseRe = norm ? csBuildRelocatedBasenameRegex(norm) : null;
  const direct = [];
  const byContract = [];
  for (const a of adrs || []) {
    const text = a.content || '';
    if (norm && text && (text.includes(norm) || (baseRe && baseRe.test(text)))) {
      direct.push({ ...a, matchKind: '路径直连' });
    } else if (ownerIds.some((cid) => (a.contracts || []).includes(cid))) {
      byContract.push({ ...a, matchKind: '同卡约束' });
    }
  }
  return [...direct, ...byContract];
}

function formatContractOwnerSummary(graphNodes, owners) {
  return owners.map((cid) => {
    const con = (graphNodes || []).find((n) => n.id === cid);
    if (!con) return cid;
    const bi = (con.dependsOnIds || []).filter((x) => (con.dependedByIds || []).includes(x));
    const biHint = bi.length > 0 ? ` | 双向互引:[${bi.join(',')}] 底座门面先行` : '';
    return `${cid}（上游:[${con.dependsOnIds.join(',') || '无'}] · 下游:[${con.dependedByIds.join(',') || '无'}]${biHint}）`;
  }).join('；');
}

function csFormatOwnershipLine(graphNodes, relFile, owners, hasContracts, sharedGovLabel) {
  if (!hasContracts) {
    return `契约归属: 零契约公开/轻量模式（改完执行 node runner/donegate.mjs lint-edit ${relFile}）`;
  }
  if (owners.length > 0) {
    return `契约归属: ${formatContractOwnerSummary(graphNodes, owners)}`;
  }
  if (isSharedGovernanceFile(relFile)) {
    return `契约归属: ${sharedGovLabel || '公共治理白名单'}（提交单卡验收加 --allow-cross-scope）`;
  }
  return '契约归属: 契约外根级配置或单测文件（tests/** 免计生产行数配额）';
}

function csFilterFreshAdrs(adrs, seenAdrFiles) {
  return seenAdrFiles ? adrs.filter((a) => !seenAdrFiles.has(a.file)) : adrs;
}

function csPushAdrDigests(lines, adrs, seenAdrFiles) {
  for (const a of adrs) {
    if (seenAdrFiles) seenAdrFiles.add(a.file);
    lines.push(`  · [${a.file}] 选定: ${a.chosenDigest} | 翻案条件: ${a.reopenDigest}`);
  }
}

function csAppendDirectAdrLines(lines, directAdrs, seenAdrFiles) {
  const fresh = csFilterFreshAdrs(directAdrs, seenAdrFiles);
  if (fresh.length === 0) {
    lines.push(`路径直连 ADR (${directAdrs.length} 篇已于同批前文展示): ${directAdrs.map((a) => a.file).join(', ')}`);
    return;
  }
  const dupCount = directAdrs.length - fresh.length;
  const suffix = dupCount > 0 ? `，另 ${dupCount} 篇已见前文` : '';
  lines.push(`路径直连 ADR (${fresh.length} 篇${suffix} · 原文查 --decisions --full <编号>):`);
  csPushAdrDigests(lines, fresh, seenAdrFiles);
}

const CS_COMPACT_ADR_LIMIT = 5;

function csFormatCompactAdrNames(boundAdrs, owners) {
  const names = boundAdrs.map((a) => a.file);
  if (names.length <= CS_COMPACT_ADR_LIMIT) return names.join(', ');
  const latest = [...names].sort().reverse().slice(0, CS_COMPACT_ADR_LIMIT);
  return `${latest.join(', ')} …等共 ${names.length} 篇（全量：zoom ${owners[0] || '<契约>'} --decisions）`;
}

function csAppendContractAdrLines(lines, boundAdrs, compactContractAdrs, seenAdrFiles, owners = []) {
  const fresh = csFilterFreshAdrs(boundAdrs, seenAdrFiles);
  if (compactContractAdrs || fresh.length === 0) {
    lines.push(`同卡关联 ADR (${boundAdrs.length} 篇 · 查原文 --decisions): ${csFormatCompactAdrNames(boundAdrs, owners)}`);
    return;
  }
  lines.push(`同卡关联 ADR (${fresh.length} 篇 · 原文查 --decisions --full <编号>):`);
  csPushAdrDigests(lines, fresh, seenAdrFiles);
}

export function formatPathGovernanceLines(idx, relFile, hasContracts, compactContractAdrs = false, seenAdrFiles = null) {
  if (idx?.adapterId === 'generic') {
    const dir = relFile.includes('/') ? `${relFile.slice(0, relFile.indexOf('/'))}/` : '根目录';
    return [`模块目录: ${dir}（通用代码仓库模式）`];
  }
  const graphNodes = idx.graph?.nodes || [];
  const owners = resolveFileContractOwners(graphNodes, relFile);
  const lines = [csFormatOwnershipLine(graphNodes, relFile, owners, hasContracts, idx?.sharedGovLabel)];

  if (!idx.hasDecisionsDir) return lines;
  const boundAdrs = matchPathBoundAdrs(idx.adrs, relFile, owners);
  const directAdrs = boundAdrs.filter((a) => a.matchKind === '路径直连');
  if (directAdrs.length > 0) {
    csAppendDirectAdrLines(lines, directAdrs, seenAdrFiles);
    return lines;
  }
  if (boundAdrs.length > 0) {
    csAppendContractAdrLines(lines, boundAdrs, compactContractAdrs, seenAdrFiles, owners);
  }
  return lines;
}

function parseFileRangeSpec(projectRoot, rawTarget) {
  const cleaned = String(rawTarget || '').trim().replace(/^\.\//, '');
  const m = cleaned.match(/^(.+?)(?::|#L?)(\d+)(?:-\s*L?(\d+))?$/);
  const pathPart = m ? m[1] : cleaned;
  const abs = resolve(projectRoot, pathPart);
  const rel = relative(projectRoot, abs).split(sep).join('/');
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !existsSync(abs)) return null;
  try {
    if (!statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  const startLine = m ? Math.max(1, Number(m[2])) : 1;
  const endLine = m ? Math.max(startLine, Number(m[3] || m[2])) : null;
  return { abs, rel, startLine, endLine };
}

function formatNumberedSliceBlock(idx, abs, rel, startLine, endLine, hasContracts, symbolTitle = '', seenAdrFiles = null) {
  const allLines = readFileSync(abs, 'utf8').split(/\r?\n/);
  const s = Math.max(1, Math.min(startLine, allLines.length));
  const e = endLine ? Math.max(s, Math.min(endLine, allLines.length)) : allLines.length;
  const headTitle = symbolTitle ? `${rel}:L${s}-L${e} (${symbolTitle})` : `${rel}:L${s}-L${e}`;
  const out = [
    `=== [末步源码真源直读] ${headTitle} ===`,
    ...formatPathGovernanceLines(idx, rel, hasContracts, true, seenAdrFiles),
    `--- 源码行区间 L${s}..L${e}（文件总计 ${allLines.length} 行） ---`
  ];
  for (let ln = s; ln <= e; ln++) out.push(`L${ln}: ${allLines[ln - 1]}`);
  return out.join('\n');
}

export function renderBoundedSourceSlice(idx, rawTarget, hasContracts, seenAdrFiles = null) {
  const fileSpec = parseFileRangeSpec(idx.root, rawTarget);
  if (fileSpec) {
    return formatNumberedSliceBlock(idx, fileSpec.abs, fileSpec.rel, fileSpec.startLine, fileSpec.endLine, hasContracts, '', seenAdrFiles);
  }
  const trace = queryCbmSymbolTrace(idx.root, rawTarget);
  const codeDefs = (trace?.definitions || []).filter((d) => d.file && d.startLine > 0);
  if (codeDefs.length === 0) return null;
  return codeDefs.map((d) => {
    const abs = resolve(idx.root, d.file);
    if (!existsSync(abs)) return null;
    return formatNumberedSliceBlock(idx, abs, d.file, d.startLine, Math.max(d.startLine, d.endLine), hasContracts, `${d.label} ${d.name}${d.signature}`, seenAdrFiles);
  }).filter(Boolean).join('\n\n') || null;
}

function csAppendSymbolDefinitions(out, idx, definitions, hasContracts, tagOwners) {
  const cli = idx?.cliPrefix || 'node runner/donegate.mjs';
  const seenGovFiles = new Set();
  for (const d of definitions) {
    const loc = d.file ? `${d.file}:L${d.startLine}-L${d.endLine}` : d.name;
    out.push(`  · [${d.label}] ${d.name}${d.signature || ''} @ ${loc}${tagOwners(d.file)}`);
    if (!d.file) continue;
    if (d.startLine > 0) {
      out.push(`    末步直读源码: ${cli} zoom ${d.file}:${d.startLine}-${Math.max(d.startLine, d.endLine)} --source`);
    }
    if (seenGovFiles.has(d.file)) continue;
    seenGovFiles.add(d.file);
    for (const gl of formatPathGovernanceLines(idx, d.file, hasContracts, true)) out.push(`    ${gl}`);
  }
}

function csAppendHopList(out, title, arrow, list, tagOwners) {
  if (list.length === 0) return;
  out.push(`${title} (1~2 Hop, 共 ${list.length} 处):`);
  for (const c of list) out.push(`  · [${c.hop}-Hop ${arrow}] ${c.trust === 'inferred' ? '≈' : ''}${c.name} @ ${c.file}:L${c.startLine}-L${c.endLine}${tagOwners(c.file)}`);
}

function csComputeCompressionPct(rawTokens, skelTokens) {
  return rawTokens > 0 ? Math.round((1 - skelTokens / rawTokens) * 100) : 0;
}

function csBuildFileSkeletonBlock(idx, fileInfo, hasContracts, highlightLines, headerTitle, notes) {
  const cli = idx?.cliPrefix || 'node runner/donegate.mjs';
  const skel = buildFileSkeleton(idx.root, fileInfo.file, { highlightLines });
  const title = headerTitle || fileInfo.file;
  const header = `=== [Zoom-2 文件骨架视图] ${title} (共 ${fileInfo.totalLines} 行) ===`;
  const gov = formatPathGovernanceLines(idx, fileInfo.file, hasContracts, true);
  const srcHint = `末步直读源码: ${cli} zoom ${fileInfo.file}:1-${fileInfo.totalLines} --source`;
  if (!skel) {
    return {
      text: [header, ...gov, ...(notes || []), '--- 骨架摘要 ---', '（当前未检测到 CBM 图谱，无法提取符号骨架）', srcHint].join('\n'),
      rawTokens: 0,
      skeletonTokens: 0,
      hasSkeleton: false
    };
  }
  const lines = [header, ...gov, ...(notes || []), '--- 骨架摘要 ---', skel.text, srcHint];
  return { text: lines.join('\n'), rawTokens: skel.rawTokens, skeletonTokens: skel.skeletonTokens, hasSkeleton: true };
}

export function renderFileSkeletonZoom(idx, fileInfo, hasContracts, highlightLines = null, headerTitle = null, notes = []) {
  const block = csBuildFileSkeletonBlock(idx, fileInfo, hasContracts, highlightLines, headerTitle, notes);
  if (!block.hasSkeleton) return block.text;
  const pct = csComputeCompressionPct(block.rawTokens, block.skeletonTokens);
  return `${block.text}\n骨架约 ${block.skeletonTokens} tok / 原文约 ${block.rawTokens} tok（压缩 ${pct}%）`;
}

function csFindEnclosingTopSymbol(symbols, defItem) {
  const containers = (symbols || []).filter((s) => (
    !s.nested && (s.label === 'Function' || s.label === 'Method' || s.label === 'Class')
    && s.startLine > 0 && s.endLine >= defItem.endLine
    && (s.startLine < defItem.startLine || (s.startLine === defItem.startLine && defItem.endLine < s.endLine))
  ));
  return containers.sort((a, b) => a.startLine - b.startLine)[0] || null;
}

function csBuildOneSymbolFileBlock(idx, file, defs, hasContracts) {
  const abs = resolve(idx.root, file);
  if (!existsSync(abs)) return null;
  const totalLines = readFileSync(abs, 'utf8').split(/\r?\n/).length;
  const syms = queryCbmFileGraph(idx.root, file)?.symbols || [];
  const highlightLines = new Set();
  const notes = [];
  for (const d of defs) {
    if (d.startLine <= 0) continue;
    const enc = csFindEnclosingTopSymbol(syms, d);
    highlightLines.add(enc ? enc.startLine : d.startLine);
    if (enc) notes.push(`↳ 命中嵌套符号 ${d.name} @ L${d.startLine}-L${d.endLine}`);
  }
  return csBuildFileSkeletonBlock(idx, { file, totalLines }, hasContracts, highlightLines, null, notes);
}

function csRenderSymbolSkeletonZoom(idx, hasContracts, trace) {
  const byFile = new Map();
  for (const d of trace.definitions || []) {
    if (!d.file) continue;
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file).push(d);
  }
  if (byFile.size === 0) return null;
  const blocks = [...byFile.entries()].slice(0, 3)
    .map(([file, defs]) => csBuildOneSymbolFileBlock(idx, file, defs, hasContracts))
    .filter(Boolean);
  if (blocks.length === 0) return null;
  const out = [];
  if (trace.matchTier && trace.matchTier !== 'exact') out.push('（未精确命中符号名，以下为模糊候选）');
  out.push(blocks.map((b) => b.text).join('\n\n'));
  if (byFile.size > 3) out.push(`（另有 ${byFile.size - 3} 个候选文件未展开）`);
  const totalRaw = blocks.reduce((s, b) => s + b.rawTokens, 0);
  const totalSkel = blocks.reduce((s, b) => s + b.skeletonTokens, 0);
  if (blocks.some((b) => b.hasSkeleton)) {
    out.push(`骨架约 ${totalSkel} tok / 原文约 ${totalRaw} tok（压缩 ${csComputeCompressionPct(totalRaw, totalSkel)}%）`);
  }
  return out.join('\n');
}

export function renderCbmSymbolZoom(idx, rawTarget, hasContracts, opts = {}) {
  const trace = queryCbmSymbolTrace(idx.root, rawTarget);
  if (!trace) return null;
  if (opts?.skeleton) {
    const skelOut = csRenderSymbolSkeletonZoom(idx, hasContracts, trace);
    if (skelOut !== null) return skelOut;
  }
  const nodes = idx.graph?.nodes || [];
  const tagOwners = (rel) => {
    const ow = rel ? resolveFileContractOwners(nodes, rel) : [];
    return ow.length > 0 ? ` [契约:${ow.join(',')}]` : '';
  };
  const out = [`=== [CBM 开源图谱符号定位与双向 2-Hop 调用链] "${rawTarget}" ===`];
  if (trace.matchTier && trace.matchTier !== 'exact') out.push('（未精确命中符号名，以下为模糊候选）');
  out.push(`定义位置 (共 ${trace.definitions.length} 处):`);
  csAppendSymbolDefinitions(out, idx, trace.definitions, hasContracts, tagOwners);
  csAppendHopList(out, '上游调用方 Callers', '←', trace.callers, tagOwners);
  csAppendHopList(out, '下游被调方 Callees', '→', trace.callees, tagOwners);
  return out.join('\n');
}
