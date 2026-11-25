// Zoom-2 非 JS 配置文件与脚本（JSON / Windows .cmd / POSIX Shell 钩子 / 文档）结构大纲提取器（<= 350 行）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_GOVERNANCE_GLOBS } from './context-router.mjs';

export const checkSharedGovernance = (relFile) =>
  SHARED_GOVERNANCE_GLOBS.some((g) => (g.endsWith('/') ? relFile.startsWith(g) : relFile === g));

function makeOutlineRecord(relFile, outlineKind, ownerIds, header, exports, referencedPaths = []) {
  return {
    file: relFile, outlineKind, owners: ownerIds, isSharedGov: checkSharedGovernance(relFile),
    header, exports, internalFunctions: [], browserInlineFunctions: [],
    constantsPreview: [], cliFlags: [], httpRoutes: [], domAnchors: [], imports: [], referencedPaths
  };
}

function extractJsonOutline(raw, relFile, ownerIds) {
  let topKeys = [], preview = [];
  try {
    const parsed = JSON.parse(raw);
    topKeys = Array.isArray(parsed) ? [`Array(${parsed.length})`] : Object.keys(parsed);
    if (relFile === 'thresholds.json' || relFile.endsWith('.workflow.json') || relFile.endsWith('capabilities.json')) {
      preview = [JSON.stringify(parsed, null, 2)];
    }
  } catch (err) { void err; }
  const header = relFile.endsWith('.workflow.json') ? '声明式工作流定义 JSON' : 'JSON 声明式配置/台账文件';
  return { ...makeOutlineRecord(relFile, 'json', ownerIds, header, topKeys), constantsPreview: preview };
}

function parseCmdExecLine(t, projectRoot, steps, refs) {
  if (/\b(?:winget|node|npm|git|powershell|where|set)\b/i.test(t)) steps.push(t);
  const expanded = t.replace(/%~[fdpnxsatz]*(?:\$[A-Za-z0-9_]+:)?[0-9A-Za-z]/gi, '').replace(/%[A-Za-z0-9_]+%/g, '');
  for (const m of expanded.matchAll(/([A-Za-z0-9_./\\-]+\.(?:mjs|js|json|cmd))/g)) {
    const norm = m[1].replace(/\\/g, '/').replace(/^\/+/, '');
    if (existsSync(join(projectRoot, norm))) refs.add(norm);
  }
}

function extractCmdOutline(raw, relFile, ownerIds, projectRoot) {
  const remLines = [], steps = [], refs = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^(?:@?echo\b|@?setlocal\b|@?endlocal\b|@?chcp\b)/i.test(t)) continue;
    if (/^(?:REM\b|::)/i.test(t)) remLines.push(t.replace(/^(?:REM\b|::)\s*/i, '').trim());
    else parseCmdExecLine(t, projectRoot, steps, refs);
  }
  const header = remLines.filter(Boolean).slice(0, 3).join(' ') || 'Windows 批处理自动化引导脚本';
  return makeOutlineRecord(relFile, 'cmd', ownerIds, header, steps, [...refs]);
}

function collectShellLineRefs(t, projectRoot, refs) {
  for (const m of t.matchAll(/((?:runner|skill|tools)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cmd))/g)) {
    if (existsSync(join(projectRoot, m[1]))) refs.add(m[1]);
  }
}

function extractShellOutline(raw, relFile, ownerIds, projectRoot) {
  const comments = [], steps = [], refs = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#!')) continue;
    if (t.startsWith('#')) comments.push(t.replace(/^#+\s*/, '').trim());
    else if (/\b(?:node|npm|npx|git)\b/.test(t)) steps.push(t);
    collectShellLineRefs(t, projectRoot, refs);
  }
  const header = comments.filter(Boolean).slice(0, 3).join(' ') || 'POSIX Shell / Git 钩子脚本';
  return makeOutlineRecord(relFile, 'sh', ownerIds, header, steps, [...refs]);
}

export function tryBuildNonJsFileOutline(raw, relFile, ownerIds, projectRoot) {
  if (relFile.endsWith('.json')) return extractJsonOutline(raw, relFile, ownerIds);
  if (relFile.endsWith('.cmd')) return extractCmdOutline(raw, relFile, ownerIds, projectRoot);
  if (relFile.endsWith('.sh') || relFile.startsWith('.githooks/') || /^#!.*\b(?:sh|bash|zsh)\b/m.test(raw)) {
    return extractShellOutline(raw, relFile, ownerIds, projectRoot);
  }
  if (!/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(relFile)) {
    const topLines = raw.split(/\r?\n/).filter((l) => l.trim());
    return makeOutlineRecord(relFile, 'doc', ownerIds, (topLines[0] || '').trim(), topLines.slice(0, 6));
  }
  return null;
}
