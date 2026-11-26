// 极薄契约与决策路径关联器及末步按行源码直读切片器（对接开源图谱坐标与本仓治理边界，<= 350 行）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { queryCbmSymbolTrace } from './cockpit-cbm.mjs';
import { fileBelongsToScopes, isSharedGovernanceFile } from './context-router.mjs';

export function resolveFileContractOwners(graphNodes, relFile) {
  return (graphNodes || []).filter((n) => fileBelongsToScopes(relFile, n.scope || [])).map((n) => n.id);
}

export function matchPathBoundAdrs(adrs, relFile, ownerIds = []) {
  const norm = String(relFile || '').replace(/\\/g, '/');
  const direct = [];
  const byContract = [];
  for (const a of adrs || []) {
    if (norm && a.content && a.content.includes(norm)) {
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

export function formatPathGovernanceLines(idx, relFile, hasContracts, compactContractAdrs = false, seenAdrFiles = null) {
  const owners = resolveFileContractOwners(idx.graph?.nodes || [], relFile);
  const lines = [];
  if (!hasContracts) {
    lines.push(`契约归属: 零契约公开/轻量模式（改完执行 node runner/donegate.mjs lint-edit ${relFile}）`);
  } else if (owners.length > 0) {
    lines.push(`契约归属: ${formatContractOwnerSummary(idx.graph?.nodes || [], owners)}`);
  } else if (isSharedGovernanceFile(relFile)) {
    lines.push('契约归属: SHARED_GOVERNANCE_GLOBS 公共治理白名单（提交单卡验收加 --allow-cross-scope）');
  } else {
    lines.push('契约归属: 契约外根级配置或单测文件（tests/** 免计生产行数配额）');
  }

  if (!idx.hasDecisionsDir) return lines;
  const boundAdrs = matchPathBoundAdrs(idx.adrs, relFile, owners);
  const directAdrs = boundAdrs.filter((a) => a.matchKind === '路径直连');
  if (directAdrs.length > 0) {
    const fresh = seenAdrFiles ? directAdrs.filter((a) => !seenAdrFiles.has(a.file)) : directAdrs;
    const dupCount = directAdrs.length - fresh.length;
    if (fresh.length === 0) {
      lines.push(`路径直连 ADR (${directAdrs.length} 篇已于同批前文展示): ${directAdrs.map((a) => a.file).join(', ')}`);
      return lines;
    }
    const suffix = dupCount > 0 ? `，另 ${dupCount} 篇已见前文` : '';
    lines.push(`路径直连 ADR (${fresh.length} 篇${suffix} · 原文查 --decisions --full <编号>):`);
    for (const a of fresh) {
      if (seenAdrFiles) seenAdrFiles.add(a.file);
      lines.push(`  · [${a.file}] 选定: ${a.chosenDigest} | 翻案条件: ${a.reopenDigest}`);
    }
    return lines;
  }
  if (boundAdrs.length > 0) {
    const fresh = seenAdrFiles ? boundAdrs.filter((a) => !seenAdrFiles.has(a.file)) : boundAdrs;
    if (compactContractAdrs || fresh.length === 0) {
      lines.push(`同卡关联 ADR (${boundAdrs.length} 篇 · 查原文 --decisions): ${boundAdrs.map((a) => a.file).join(', ')}`);
    } else {
      lines.push(`同卡关联 ADR (${fresh.length} 篇 · 原文查 --decisions --full <编号>):`);
      for (const a of fresh) {
        if (seenAdrFiles) seenAdrFiles.add(a.file);
        lines.push(`  · [${a.file}] 选定: ${a.chosenDigest} | 翻案条件: ${a.reopenDigest}`);
      }
    }
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

export function renderCbmSymbolZoom(idx, rawTarget, hasContracts) {
  const trace = queryCbmSymbolTrace(idx.root, rawTarget);
  if (!trace) return null;
  const nodes = idx.graph?.nodes || [];
  const tagOwners = (rel) => {
    const ow = rel ? resolveFileContractOwners(nodes, rel) : [];
    return ow.length > 0 ? ` [契约:${ow.join(',')}]` : '';
  };
  const out = [`=== [CBM 开源图谱符号定位与双向 2-Hop 调用链] "${rawTarget}" ===`, `定义位置 (共 ${trace.definitions.length} 处):`];
  const seenGovFiles = new Set();
  for (const d of trace.definitions) {
    const loc = d.file ? `${d.file}:L${d.startLine}-L${d.endLine}` : d.name;
    out.push(`  · [${d.label}] ${d.name}${d.signature || ''} @ ${loc}${tagOwners(d.file)}`);
    if (d.file && d.startLine > 0) {
      out.push(`    末步直读源码: node runner/donegate.mjs zoom ${d.file}:${d.startLine}-${Math.max(d.startLine, d.endLine)} --source`);
    }
    if (d.file && !seenGovFiles.has(d.file)) {
      seenGovFiles.add(d.file);
      for (const gl of formatPathGovernanceLines(idx, d.file, hasContracts, true)) out.push(`    ${gl}`);
    }
  }
  if (trace.callers.length > 0) {
    out.push(`上游调用方 Callers (1~2 Hop, 共 ${trace.callers.length} 处):`);
    for (const c of trace.callers) out.push(`  · [${c.hop}-Hop ←] ${c.name} @ ${c.file}:L${c.startLine}-L${c.endLine}${tagOwners(c.file)}`);
  }
  if (trace.callees.length > 0) {
    out.push(`下游被调方 Callees (1~2 Hop, 共 ${trace.callees.length} 处):`);
    for (const c of trace.callees) out.push(`  · [${c.hop}-Hop →] ${c.name} @ ${c.file}:L${c.startLine}-L${c.endLine}${tagOwners(c.file)}`);
  }
  return out.join('\n');
}
