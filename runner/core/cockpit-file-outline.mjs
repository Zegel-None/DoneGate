// Zoom-2 括号平衡单文件结构大纲提取器（穿透门面、顶层箭头函数、代码生成模板、Cmd 变量语法与真实路径，<= 350 行）
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { maskCommentsAndStrings, stripCommentsKeepStrings } from './js-mask-lexer.mjs';
import { SHARED_GOVERNANCE_GLOBS } from './context-router.mjs';

function cfoFindBalanced(text, startIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

export function extractFullHeaderComment(raw) {
  const comments = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('#!')) continue;
    if (t.startsWith('//')) comments.push(t.replace(/^\/\/+\s*/, '').trim());
    else if (comments.length > 0 || t !== '') break;
  }
  return comments.join(' ').trim();
}

function cfoCheckSharedGovernance(relFile) {
  return SHARED_GOVERNANCE_GLOBS.some((g) => (g.endsWith('/') ? relFile.startsWith(g) : relFile === g));
}

function cfoExciseBalancedBlockFrom(src, matchIndex) {
  const openB = src.indexOf('{', matchIndex);
  if (openB < 0) return src;
  const closeB = cfoFindBalanced(src, openB, '{', '}');
  return closeB > openB ? src.slice(0, matchIndex) + src.slice(closeB + 1) : src;
}

function cfoStripSelfTestBlock(cleanCode) {
  let out = cleanCode;
  const fnM = out.match(/\b(?:async\s+)?function\s+runRedSelfTest\s*\(/);
  if (fnM) out = cfoExciseBalancedBlockFrom(out, fnM.index);
  const ifM = out.match(/\bif\s*\(\s*(?:argv|args)\.includes\(\s*['"]--(?:red-)?self-test['"]\s*\)\s*\)\s*\{/);
  if (ifM) out = cfoExciseBalancedBlockFrom(out, ifM.index);
  return out;
}

function cfoExtractJsonOutline(raw, relFile, ownerIds) {
  let topKeys = [], preview = [];
  try {
    const parsed = JSON.parse(raw);
    topKeys = Array.isArray(parsed) ? [`Array(${parsed.length})`] : Object.keys(parsed);
    if (relFile === 'thresholds.json' || relFile.endsWith('.workflow.json') || relFile.endsWith('capabilities.json')) {
      preview = [JSON.stringify(parsed, null, 2)];
    }
  } catch (err) { void err; }
  return {
    file: relFile, outlineKind: 'json', owners: ownerIds, isSharedGov: cfoCheckSharedGovernance(relFile),
    header: relFile.endsWith('.workflow.json') ? '声明式工作流定义 JSON' : 'JSON 声明式配置/台账文件',
    exports: topKeys, internalFunctions: [], browserInlineFunctions: [],
    constantsPreview: preview, cliFlags: [], httpRoutes: [], domAnchors: [], imports: [], referencedPaths: []
  };
}

function cfoParseCmdExecLine(t, projectRoot, steps, flags, refs) {
  if (/\b(?:winget|node|npm|git|powershell|where|set)\b/i.test(t)) steps.push(t);
  const expanded = t.replace(/%~[fdpnxsatz]*(?:\$[A-Za-z0-9_]+:)?[0-9A-Za-z]/gi, '').replace(/%[A-Za-z0-9_]+%/g, '');
  for (const m of expanded.matchAll(/([A-Za-z0-9_./\\-]+\.(?:mjs|js|json|cmd))/g)) {
    const norm = m[1].replace(/\\/g, '/').replace(/^\/+/, '');
    if (existsSync(join(projectRoot, norm))) refs.add(norm);
  }
}

function cfoExtractCmdOutline(raw, relFile, ownerIds, projectRoot) {
  const remLines = [], steps = [], refs = new Set(), flags = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^(?:@?echo\b|@?setlocal\b|@?endlocal\b|@?chcp\b)/i.test(t)) continue;
    if (/^(?:REM\b|::)/i.test(t)) remLines.push(t.replace(/^(?:REM\b|::)\s*/i, '').trim());
    else cfoParseCmdExecLine(t, projectRoot, steps, flags, refs);
  }
  return {
    file: relFile, outlineKind: 'cmd', owners: ownerIds, isSharedGov: cfoCheckSharedGovernance(relFile),
    header: remLines.filter(Boolean).slice(0, 3).join(' ') || 'Windows 批处理自动化引导脚本',
    exports: steps, internalFunctions: [], browserInlineFunctions: [],
    constantsPreview: [], cliFlags: [...flags].sort(), httpRoutes: [], domAnchors: [], imports: [], referencedPaths: [...refs]
  };
}

function cfoScanExportedFunctions(raw, masked, exportsOut) {
  for (const m of masked.matchAll(/export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
    exportsOut.push(`${m[1] ? 'async ' : ''}function ${m[2]}(${params})`);
  }
  for (const m of masked.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/g)) {
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
    exportsOut.push(`const ${m[1]} = (${params}) => …`);
  }
}

function cfoSummarizeConstRhs(raw, masked, rhsStart) {
  let p = rhsStart;
  while (p < masked.length && /\s/.test(masked[p])) p++;
  const freezeM = raw.slice(p, p + 24).match(/^Object\.freeze\s*\(\s*/);
  if (freezeM) p += freezeM[0].length;
  if (raw[p] === '[') {
    const closeB = cfoFindBalanced(masked, p, '[', ']');
    const seg = closeB > p ? raw.slice(p + 1, closeB) : raw.slice(p + 1, p + 240);
    const items = [...seg.matchAll(/['"]([^'"]+)['"]/g)].map((x) => `'${x[1]}'`);
    return `[${items.slice(0, 24).join(', ')}${items.length > 24 ? ', …' : ''}]`;
  }
  if (raw[p] === '{') {
    const closeB = cfoFindBalanced(masked, p, '{', '}');
    const seg = closeB > p ? raw.slice(p + 1, closeB) : raw.slice(p + 1, p + 320);
    const kv = [];
    for (const kl of seg.split(/\r?\n/)) {
      const km = kl.match(/^\s{2}(['"]?[A-Za-z0-9_@-]+['"]?)\s*:\s*([^,\n]+)/);
      if (km) kv.push(`${km[1]}: ${km[2].trim().replace(/\{.*$/, '{…}').replace(/\[.*$/, '[…]').slice(0, 48)}`);
    }
    return `{ ${kv.join(', ')} }`;
  }
  const lineEnd = raw.indexOf('\n', p);
  return raw.slice(p, lineEnd > p ? lineEnd : p + 80).replace(/;\s*$/, '').trim().slice(0, 80);
}

function cfoScanExportedConstsAndReexports(raw, masked, exportsOut) {
  for (const m of masked.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*/g)) {
    if (!exportsOut.some((e) => e.includes(`const ${m[1]} =`))) {
      exportsOut.push(`const ${m[1]} = ${cfoSummarizeConstRhs(raw, masked, m.index + m[0].length)}`);
    }
  }
  for (const m of masked.matchAll(/export\s+\*\s+(?:as\s+[A-Za-z0-9_$]+\s+)?from\s+['"]\s*['"]/g)) {
    exportsOut.push(`re-export ${raw.slice(m.index, m.index + m[0].length).replace(/\s+/g, ' ').trim().replace(/^export\s+/, '')}`);
  }
  for (const m of masked.matchAll(/export\s*\{/g)) {
    const openB = m.index + m[0].length - 1, closeB = cfoFindBalanced(masked, openB, '{', '}');
    if (closeB <= openB) continue;
    const tail = raw.slice(closeB + 1, closeB + 120).match(/^\s*from\s*['"]([^'"]+)['"]/);
    const names = raw.slice(openB + 1, closeB).replace(/\s+/g, ' ').trim();
    exportsOut.push(tail ? `re-export { ${names} } from '${tail[1]}'` : `{ ${names} }`);
  }
}

function cfoIsInlineScriptHost(relFile) {
  return relFile.startsWith('runner/atlas/')
    || relFile.startsWith('runner/dsh/ui-')
    || relFile.endsWith('-gen.mjs')
    || relFile.endsWith('-templates.mjs');
}

function cfoBuildBraceDepthPrefix(masked) {
  const depths = new Int16Array(masked.length);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    depths[i] = d;
    if (masked[i] === '{') d++;
    else if (masked[i] === '}' && d > 0) d--;
  }
  return depths;
}

function cfoScanTopLevelArrowFunctions(raw, masked, depths, exportedNames, seenInternal, internalOut) {
  const arrowParenRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?(?:function\s*)?\(/g;
  for (const m of masked.matchAll(arrowParenRe)) {
    const name = m[1], kwPos = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (depths[kwPos] !== 0 || exportedNames.has(name) || seenInternal.has(name)) continue;
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    if (closeP <= openP) continue;
    const after = masked.slice(closeP + 1, closeP + 40).trimStart();
    if (!after.startsWith('=>') && !m[0].includes('function')) continue;
    seenInternal.add(name);
    internalOut.push(`${m[2] ? 'async ' : ''}${name}(${raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim()})`);
  }
  const arrowIdentRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?([A-Za-z_$][\w$]*)\s*=>/g;
  for (const m of masked.matchAll(arrowIdentRe)) {
    const name = m[1], kwPos = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (depths[kwPos] !== 0 || exportedNames.has(name) || seenInternal.has(name)) continue;
    seenInternal.add(name);
    internalOut.push(`${m[2] ? 'async ' : ''}${name}(${m[3]})`);
  }
}

function cfoScanFunctionsAndBrowserStrings(raw, masked, relFile, exportedNames) {
  const internalFunctions = [], browserInlineFunctions = [], seenInternal = new Set(), seenInline = new Set();
  const allowInline = cfoIsInlineScriptHost(relFile);
  const depths = cfoBuildBraceDepthPrefix(masked);
  const fnScanRe = /(?:^|\n|['"`])\s*(?:export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;

  for (const m of raw.matchAll(fnScanRe)) {
    const fnName = m[2];
    if (exportedNames.has(fnName)) continue;
    const fnIdx = m.index + m[0].indexOf('function'), openP = m.index + m[0].length - 1;
    if (masked[fnIdx] !== ' ') {
      if (seenInternal.has(fnName)) continue;
      const closeP = cfoFindBalanced(masked, openP, '(', ')');
      const params = closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
      seenInternal.add(fnName);
      internalFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${params})`);
    } else if (allowInline && !seenInline.has(fnName)) {
      const closeP = cfoFindBalanced(raw, openP, '(', ')');
      const params = (closeP > openP && closeP - openP < 120) ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : '';
      seenInline.add(fnName);
      browserInlineFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${params})`);
    }
  }
  cfoScanTopLevelArrowFunctions(raw, masked, depths, exportedNames, seenInternal, internalFunctions);
  return { internalFunctions, browserInlineFunctions };
}

function cfoFilterExistingRepoLiterals(vals, projectRoot) {
  return vals.filter((lit) => {
    const inner = lit.slice(1, -1);
    if (/^(?:runner|skill|tools)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cmd)$/.test(inner)) {
      return existsSync(join(projectRoot, inner));
    }
    return true;
  });
}

function cfoScanUpperConstantsAndImports(raw, masked, projectRoot) {
  const constantsPreview = [];
  for (const m of masked.matchAll(/(?:const|export\s+const)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g)) {
    const name = m[1];
    if (name.endsWith('_LINES')) continue;
    const openB = m.index + m[0].length - 1, closeB = cfoFindBalanced(masked, openB, '[', ']');
    if (closeB <= openB) continue;
    const inner = raw.slice(openB + 1, closeB);
    const idents = name.endsWith('_FNS') ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const rawVals = idents.length === 0 ? [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((x) => `'${x[1]}'`) : [];
    const vals = cfoFilterExistingRepoLiterals(rawVals, projectRoot);
    if (idents.length > 0) constantsPreview.push(`${name} = [${idents.join(', ')}]`);
    else if (vals.length > 0 && vals.length <= 30) constantsPreview.push(`${name} = [${vals.join(', ')}]`);
  }
  const imports = [];
  for (const m of masked.matchAll(/import\s*\{/g)) {
    const openB = m.index + m[0].length - 1, closeB = cfoFindBalanced(masked, openB, '{', '}');
    if (closeB <= openB) continue;
    const fromM = raw.slice(closeB + 1, closeB + 140).match(/^\s*from\s*['"]([^'"]+)['"]/);
    if (fromM) imports.push(`{ ${raw.slice(openB + 1, closeB).replace(/\s+/g, ' ').trim()} } <- '${fromM[1]}'`);
  }
  for (const m of masked.matchAll(/import\s+([A-Za-z0-9_$*]+(?:\s+as\s+[A-Za-z0-9_$]+)?)\s+from\s+['"]\s*['"]/g)) {
    const seg = raw.slice(m.index, m.index + m[0].length).match(/^import\s+([^\n;]+?)\s+from\s+['"]([^'"]+)['"]/);
    if (seg) imports.push(`${seg[1].trim()} <- '${seg[2]}'`);
  }
  return { constantsPreview, imports };
}

function cfoScanCliFlags(noCommentCode) {
  if (!/\b(?:process\.argv|argv|parseCliArgs|BOOLEAN_FLAGS)\b/.test(noCommentCode)) return [];
  const flags = new Set();
  for (const sm of noCommentCode.matchAll(/\b(?:argv|args)\.includes\(\s*['"](--(?:red-)?self-test)['"]\s*\)/g)) flags.add(sm[1]);
  const mainBody = cfoStripSelfTestBlock(noCommentCode);
  const consumeRe = /\b(?:argv|args|cliArgv)\.(?:includes|indexOf)\(\s*['"](--[a-z][a-z0-9-]*)['"]\s*\)|\b[A-Za-z_$][\w$]*\(\s*['"](--[a-z][a-z0-9-]*)['"](?:\s*,|\s*\))|\b(?:arg|a|k|flag|opt)\s*[!=]==?\s*['"](--[a-z][a-z0-9-]*)['"]/g;
  for (const m of mainBody.matchAll(consumeRe)) flags.add(m[1] || m[2] || m[3]);
  const boolSet = mainBody.match(/BOOLEAN_FLAGS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (boolSet) {
    for (const bm of boolSet[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) {
      if (bm[1].length > 1) flags.add(`--${bm[1]}`);
    }
  }
  for (const fm of mainBody.matchAll(/\bflags\[\s*['"]([a-z][a-z0-9-]*)['"]\s*\]|\bflags\.([a-z][a-zA-Z0-9]*)\b/g)) {
    const rawFlag = fm[1] || fm[2];
    if (rawFlag && /^[a-z][a-z0-9-]*$/.test(rawFlag) && rawFlag.length > 1) flags.add(`--${rawFlag}`);
  }
  return [...flags].sort();
}

function cfoCollectReferencedPaths(mainBody, projectRoot) {
  const refs = new Set();
  for (const m of mainBody.matchAll(/['"`]((?:\.donegate\/|\.dsh\/|\.donegate-home\/|workflows\/\.deps\/)[A-Za-z0-9_./*-]*)['"`]/g)) {
    refs.add(m[1]);
  }
  for (const m of mainBody.matchAll(/['"`]((?:workflows|bricks|contracts|decisions)\/[A-Za-z0-9_./-]+)['"`]/g)) {
    if (existsSync(join(projectRoot, m[1]))) refs.add(m[1]);
  }
  for (const m of mainBody.matchAll(/['"`](?:\.\/)?((?:runner|skill|tools|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cmd|json|md))['"`]/g)) {
    if (existsSync(join(projectRoot, m[1]))) refs.add(m[1]);
  }
  for (const m of mainBody.matchAll(/['"`]([A-Za-z0-9_.-]+\.(?:json|jsonl|cmd|yml)|@local\/[A-Za-z0-9_-]+)['"`]/g)) {
    const cand = m[1];
    if (cand.startsWith('@local/') || cand.endsWith('.json') || cand.endsWith('.jsonl') || cand.endsWith('.yml') || existsSync(join(projectRoot, cand))) {
      if (!cand.startsWith('broken')) refs.add(cand);
    }
  }
  return [...refs];
}

function cfoInferFetchMethodLabel(mainBody, idx, routePath) {
  const win = mainBody.slice(Math.max(0, idx - 48), Math.min(mainBody.length, idx + 180));
  const mm = win.match(/\bmethod\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/i);
  return mm ? `FETCH ${mm[1].toUpperCase()} ${routePath}` : `FETCH/ROUTE ${routePath}`;
}

function cfoCollectClientRoutesAndDom(mainBody, httpRoutes, domAnchors) {
  for (const m of mainBody.matchAll(/['"`](\/(?:donegate\/)?api\/[A-Za-z0-9_./-]{2,})['"`]/g)) {
    const rp = m[1].replace(/\/+$/, '');
    if (rp && ![...httpRoutes].some((r) => r.endsWith(' ' + rp))) {
      httpRoutes.add(cfoInferFetchMethodLabel(mainBody, m.index, rp));
    }
  }
  for (const m of mainBody.matchAll(/\bid=(?:\\)?["']([A-Za-z][A-Za-z0-9_-]{3,})(?:\\)?["']/g)) {
    if (!m[1].includes('${')) domAnchors.add(`#${m[1]}`);
  }
  for (const m of mainBody.matchAll(/\b(data-[a-z][a-z0-9-]*)=(?:\\)?["']([A-Za-z0-9_-]{2,})(?:\\)?["']/g)) {
    if (m[1] !== 'data-tip' && !m[2].includes('${')) domAnchors.add(`[${m[1]}="${m[2]}"]`);
  }
}

function cfoScanRoutesAnchorsAndPaths(noCommentCode, relFile, attributedRoutes, projectRoot) {
  const mainBody = cfoStripSelfTestBlock(noCommentCode);
  const isRedSelfTestHost = relFile.startsWith('skill/check-') || relFile === 'skill/lint-edit.mjs';
  const httpRoutes = new Set(attributedRoutes || []);
  const domAnchors = new Set();
  if (!isRedSelfTestHost) cfoCollectClientRoutesAndDom(mainBody, httpRoutes, domAnchors);
  return { httpRoutes: [...httpRoutes], domAnchors: [...domAnchors], referencedPaths: cfoCollectReferencedPaths(mainBody, projectRoot) };
}

export function buildSingleFileOutline(projectRoot, relFile, ownerIds = [], attributedRoutes = []) {
  const abs = join(projectRoot, relFile);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  if (relFile.endsWith('.json')) return cfoExtractJsonOutline(raw, relFile, ownerIds);
  if (relFile.endsWith('.cmd')) return cfoExtractCmdOutline(raw, relFile, ownerIds, projectRoot);
  if (!/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(relFile)) {
    const topLines = raw.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
    return {
      file: relFile, outlineKind: 'doc', owners: ownerIds, isSharedGov: cfoCheckSharedGovernance(relFile),
      header: (topLines[0] || '').slice(0, 160), exports: topLines, internalFunctions: [], browserInlineFunctions: [],
      constantsPreview: [], cliFlags: [], httpRoutes: [], domAnchors: [], imports: [], referencedPaths: []
    };
  }
  const ext = extname(relFile).toLowerCase();
  const masked = maskCommentsAndStrings(raw, ext);
  const noCommentCode = stripCommentsKeepStrings(raw, ext);
  const exports = [];
  cfoScanExportedFunctions(raw, masked, exports);
  cfoScanExportedConstsAndReexports(raw, masked, exports);
  const exportedNames = new Set(exports.map((e) => (e.match(/(?:function|const)\s+([A-Za-z0-9_$]+)/) || [])[1]).filter(Boolean));
  const { internalFunctions, browserInlineFunctions } = cfoScanFunctionsAndBrowserStrings(raw, masked, relFile, exportedNames);
  const { constantsPreview, imports } = cfoScanUpperConstantsAndImports(raw, masked, projectRoot);
  const { httpRoutes, domAnchors, referencedPaths } = cfoScanRoutesAnchorsAndPaths(noCommentCode, relFile, attributedRoutes, projectRoot);
  return {
    file: relFile, outlineKind: 'code', owners: ownerIds, isSharedGov: cfoCheckSharedGovernance(relFile),
    header: extractFullHeaderComment(raw) || '源码模块', exports, internalFunctions, browserInlineFunctions,
    constantsPreview, cliFlags: cfoScanCliFlags(noCommentCode), httpRoutes, domAnchors, imports, referencedPaths
  };
}
