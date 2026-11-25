// Zoom-2 括号平衡单文件结构大纲提取器（零前缀启发式穿透内联脚本、配对引号、顶层对象键与双参 CLI，<= 350 行）
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { maskCommentsAndStrings, stripCommentsKeepStrings } from './js-mask-lexer.mjs';
import { checkSharedGovernance, tryBuildNonJsFileOutline } from './cockpit-outline-nonjs.mjs';

const PAIRED_STR_RE = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

function cfoFindBalanced(text, startIdx, openCh, closeCh) {
  for (let i = startIdx, depth = 0; i < text.length; i++) {
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

function cfoExciseBalancedBlockFrom(src, matchIndex) {
  const openB = src.indexOf('{', matchIndex);
  if (openB < 0) return src;
  const closeB = cfoFindBalanced(src, openB, '{', '}');
  return closeB > openB ? src.slice(0, matchIndex) + src.slice(closeB + 1) : src;
}

function cfoStripSelfTestBlock(cleanCode) {
  let out = cleanCode;
  const fnM = out.match(/\b(?:async\s+)?function\s+run(?:Red|Liveness|Decl)?SelfTest\s*\(/);
  if (fnM) out = cfoExciseBalancedBlockFrom(out, fnM.index);
  const ifM = out.match(/\bif\s*\(\s*(?:argv|args)\.includes\(\s*['"]--(?:red-)?self-test['"]\s*\)\s*\)\s*\{/);
  return ifM ? cfoExciseBalancedBlockFrom(out, ifM.index) : out;
}

function cfoParseSingleTopKey(slice, seen, keys) {
  const m = slice.match(/^(?:(['"])([^'"\\]+)\1|([A-Za-z_$][\w$-]*))\s*:\s*([^,\n}]+)/);
  if (!m) return;
  const keyLabel = m[1] ? `'${m[2]}'` : m[3];
  if (seen.has(keyLabel)) return;
  seen.add(keyLabel);
  const valPreview = m[4].trim().replace(/^\{.*$/, '{…}').replace(/^\[.*$/, '[…]').replace(/\{.*$/, '{…}');
  keys.push(`${keyLabel}: ${valPreview}`);
}

function cfoExtractTopLevelObjectKeys(rawBody, maskedBody) {
  const keys = [], seen = new Set();
  let depth = 0, atStart = true;
  for (let i = 0; i < maskedBody.length; i++) {
    const ch = maskedBody[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth++; atStart = false; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { if (depth > 0) depth--; atStart = false; continue; }
    if (depth !== 0) continue;
    if (ch === ',') { atStart = true; continue; }
    if (!atStart || /\s/.test(ch)) continue;
    atStart = false;
    cfoParseSingleTopKey(rawBody.slice(i), seen, keys);
  }
  return keys;
}

function cfoSummarizeConstRhs(raw, masked, rhsStart) {
  let p = rhsStart;
  while (p < masked.length && /\s/.test(masked[p])) p++;
  let frozenClose = -1;
  const freezeM = raw.slice(p).match(/^Object\.freeze\s*\(/);
  if (freezeM) {
    const openF = p + freezeM[0].length - 1;
    frozenClose = cfoFindBalanced(masked, openF, '(', ')');
    p = openF + 1;
    while (p < masked.length && /\s/.test(masked[p])) p++;
  }
  if (raw[p] === '[') {
    const closeB = cfoFindBalanced(masked, p, '[', ']');
    if (closeB > p) return `[${[...raw.slice(p + 1, closeB).matchAll(PAIRED_STR_RE)].map((x) => `'${x[2]}'`).join(', ')}]`;
  }
  if (raw[p] === '{') {
    const closeB = cfoFindBalanced(masked, p, '{', '}');
    if (closeB > p) return `{ ${cfoExtractTopLevelObjectKeys(raw.slice(p + 1, closeB), masked.slice(p + 1, closeB)).join(', ')} }`;
  }
  if (frozenClose > p) return `Object.freeze(${raw.slice(p, frozenClose).replace(/\s+/g, ' ').trim()})`;
  const semi = masked.indexOf(';', p), nl = raw.indexOf('\n', p);
  const end = semi > p && (nl < 0 || semi <= nl) ? semi : (nl > p ? nl : raw.length);
  return raw.slice(p, end).replace(/;\s*$/, '').trim();
}

function cfoScanExportedSymbols(raw, masked) {
  const exportsOut = [];
  for (const m of masked.matchAll(/export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    exportsOut.push(`${m[1] ? 'async ' : ''}function ${m[2]}(${closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : ''})`);
  }
  for (const m of masked.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/g)) {
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    exportsOut.push(`const ${m[1]} = (${closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : ''}) => …`);
  }
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
    const tail = raw.slice(closeB + 1).match(/^\s*from\s*['"]([^'"]+)['"]/);
    const names = raw.slice(openB + 1, closeB).replace(/\s+/g, ' ').trim();
    exportsOut.push(tail ? `re-export { ${names} } from '${tail[1]}'` : `{ ${names} }`);
  }
  return exportsOut;
}

function cfoBuildBraceDepthPrefix(masked) {
  const depths = new Int16Array(masked.length);
  for (let i = 0, d = 0; i < masked.length; i++) {
    depths[i] = d;
    if (masked[i] === '{') d++;
    else if (masked[i] === '}' && d > 0) d--;
  }
  return depths;
}

function cfoScanTopLevelArrowFunctions(raw, masked, depths, exportedNames, seenInternal, internalOut) {
  for (const m of masked.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?(?:function\s*)?\(/g)) {
    const name = m[1], kwPos = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (depths[kwPos] !== 0 || exportedNames.has(name) || seenInternal.has(name)) continue;
    const openP = m.index + m[0].length - 1, closeP = cfoFindBalanced(masked, openP, '(', ')');
    if (closeP <= openP || (!masked.slice(closeP + 1).trimStart().startsWith('=>') && !m[0].includes('function'))) continue;
    seenInternal.add(name);
    internalOut.push(`${m[2] ? 'async ' : ''}${name}(${raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim()})`);
  }
  for (const m of masked.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?([A-Za-z_$][\w$]*)\s*=>/g)) {
    const name = m[1], kwPos = m.index + m[0].search(/\b(?:const|let|var)\b/);
    if (depths[kwPos] !== 0 || exportedNames.has(name) || seenInternal.has(name)) continue;
    seenInternal.add(name);
    internalOut.push(`${m[2] ? 'async ' : ''}${name}(${m[3]})`);
  }
}

function cfoScanFunctionsAndBrowserStrings(raw, masked, relFile, exportedNames) {
  const internalFunctions = [], browserInlineFunctions = [], seenInternal = new Set(), seenInline = new Set();
  const allowInline = relFile.startsWith('runner/') && !relFile.endsWith('-fixtures.mjs') && relFile !== 'runner/self-test.mjs';
  const depths = cfoBuildBraceDepthPrefix(masked);
  const fnScanRe = /(?:^|\n|['"`])\s*(?:export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;

  for (const m of raw.matchAll(fnScanRe)) {
    const fnName = m[2];
    if (exportedNames.has(fnName)) continue;
    const fnIdx = m.index + m[0].indexOf('function'), openP = m.index + m[0].length - 1;
    if (masked[fnIdx] !== ' ') {
      if (seenInternal.has(fnName)) continue;
      const closeP = cfoFindBalanced(masked, openP, '(', ')');
      seenInternal.add(fnName);
      internalFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${closeP > openP ? raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim() : ''})`);
    } else if (allowInline && !seenInline.has(fnName)) {
      const closeP = cfoFindBalanced(raw, openP, '(', ')');
      if (closeP <= openP || raw.slice(openP + 1, closeP).includes('\n\n')) continue;
      seenInline.add(fnName);
      browserInlineFunctions.push(`${m[1] ? 'async ' : ''}${fnName}(${raw.slice(openP + 1, closeP).replace(/\s+/g, ' ').trim()})`);
    }
  }
  cfoScanTopLevelArrowFunctions(raw, masked, depths, exportedNames, seenInternal, internalFunctions);
  return { internalFunctions, browserInlineFunctions };
}

function cfoFilterExistingRepoLiterals(vals, projectRoot) {
  return vals.filter((lit) => {
    const inner = lit.slice(1, -1);
    return /^(?:runner|skill|tools)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cmd)$/.test(inner) ? existsSync(join(projectRoot, inner)) : true;
  });
}

function cfoScanUpperConstantsAndImports(raw, masked, projectRoot) {
  const constantsPreview = [], imports = [];
  for (const m of masked.matchAll(/(?:const|export\s+const)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(?:new\s+Set\s*\(\s*)?\[/g)) {
    const name = m[1];
    if (name.endsWith('_LINES')) continue;
    const openB = m.index + m[0].length - 1, closeB = cfoFindBalanced(masked, openB, '[', ']');
    if (closeB <= openB) continue;
    const inner = raw.slice(openB + 1, closeB);
    const idents = name.endsWith('_FNS') ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const rawVals = idents.length === 0 ? [...inner.matchAll(PAIRED_STR_RE)].map((x) => `'${x[2]}'`) : [];
    const vals = cfoFilterExistingRepoLiterals(rawVals, projectRoot);
    if (idents.length > 0) constantsPreview.push(`${name} = [${idents.join(', ')}]`);
    else if (vals.length > 0) constantsPreview.push(`${name} = [${vals.join(', ')}]`);
  }
  for (const m of masked.matchAll(/import\s*\{/g)) {
    const openB = m.index + m[0].length - 1, closeB = cfoFindBalanced(masked, openB, '{', '}');
    if (closeB <= openB) continue;
    const fromM = raw.slice(closeB + 1).match(/^\s*from\s*['"]([^'"]+)['"]/);
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
  const consumeRe = /\b(?:argv|args|cliArgv)\.(?:includes|indexOf)\(\s*['"](--[a-z][a-z0-9-]*)['"]\s*\)|\b[A-Za-z_$][\w$]*\(\s*(?:(?:argv|args|cliArgv)\s*,\s*)?['"](--[a-z][a-z0-9-]*)['"](?:\s*,|\s*\))|\b(?:arg|a|k|flag|opt)\s*[!=]==?\s*['"](--[a-z][a-z0-9-]*)['"]/g;
  for (const m of mainBody.matchAll(consumeRe)) flags.add(m[1] || m[2] || m[3]);
  const boolSet = mainBody.match(/BOOLEAN_FLAGS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (boolSet) {
    for (const bm of boolSet[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) if (bm[1].length > 1) flags.add(`--${bm[1]}`);
  }
  for (const fm of mainBody.matchAll(/\bflags\[\s*['"]([a-z][a-z0-9-]*)['"]\s*\]|\bflags\.([a-z][a-zA-Z0-9]*)\b/g)) {
    const rawFlag = fm[1] || fm[2];
    if (rawFlag && /^[a-z][a-z0-9-]*$/.test(rawFlag) && rawFlag.length > 1) flags.add(`--${rawFlag}`);
  }
  return [...flags].sort();
}

function cfoCollectReferencedPaths(mainBody, projectRoot) {
  const refs = new Set();
  for (const m of mainBody.matchAll(/['"`]((?:\.donegate\/|\.dsh\/|\.donegate-home\/|workflows\/\.deps\/)[A-Za-z0-9_./*-]*)['"`]/g)) refs.add(m[1]);
  for (const m of mainBody.matchAll(/['"`]((?:workflows|bricks|contracts|decisions)\/[A-Za-z0-9_./-]+)['"`]/g)) {
    if (existsSync(join(projectRoot, m[1]))) refs.add(m[1]);
  }
  for (const m of mainBody.matchAll(/['"`](?:\.\/)?((?:runner|skill|tools|tests)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cmd|json|md))['"`]/g)) {
    if (existsSync(join(projectRoot, m[1]))) refs.add(m[1]);
  }
  for (const m of mainBody.matchAll(/['"`]([A-Za-z0-9_.-]+\.(?:json|jsonl|cmd|yml)|@local\/[A-Za-z0-9_-]+)['"`]/g)) {
    const cand = m[1];
    if (!cand.startsWith('broken') && (cand.startsWith('@local/') || cand.endsWith('.json') || cand.endsWith('.jsonl') || cand.endsWith('.yml') || existsSync(join(projectRoot, cand)))) {
      refs.add(cand);
    }
  }
  return [...refs];
}

function cfoCollectClientRoutesAndDom(mainBody, httpRoutes, domAnchors) {
  for (const m of mainBody.matchAll(/['"`](\/(?:donegate\/)?api\/[A-Za-z0-9_./-]{2,})['"`]/g)) {
    const rp = m[1].replace(/\/+$/, '');
    if (!rp || [...httpRoutes].some((r) => r.endsWith(' ' + rp))) continue;
    const stmtStart = Math.max(0, mainBody.lastIndexOf('(', m.index));
    const closeP = cfoFindBalanced(mainBody, stmtStart, '(', ')');
    const callSlice = mainBody.slice(stmtStart, closeP > m.index ? closeP : m.index);
    const mm = callSlice.match(/\bmethod\s*:\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/i);
    httpRoutes.add(mm ? `FETCH ${mm[1].toUpperCase()} ${rp}` : `FETCH/ROUTE ${rp}`);
  }
  for (const m of mainBody.matchAll(/\bid=(?:\\)?["']([A-Za-z][A-Za-z0-9_-]{3,})(?:\\)?["']/g)) {
    if (!m[1].includes('${')) domAnchors.add(`#${m[1]}`);
  }
  for (const m of mainBody.matchAll(/\b(data-[a-z][a-z0-9-]*)=(?:\\)?["']([A-Za-z0-9_-]{2,})(?:\\)?["']/g)) {
    if (m[1] !== 'data-tip' && !m[2].includes('${')) domAnchors.add(`[${m[1]}="${m[2]}"]`);
  }
}

export function buildSingleFileOutline(projectRoot, relFile, ownerIds = [], attributedRoutes = []) {
  const abs = join(projectRoot, relFile);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const nonJs = tryBuildNonJsFileOutline(raw, relFile, ownerIds, projectRoot);
  if (nonJs) return nonJs;

  const ext = extname(relFile).toLowerCase(), mainRaw = cfoStripSelfTestBlock(raw);
  const masked = maskCommentsAndStrings(raw, ext), mainMasked = maskCommentsAndStrings(mainRaw, ext);
  const noCommentCode = stripCommentsKeepStrings(raw, ext), mainNoComment = cfoStripSelfTestBlock(noCommentCode);
  const exports = cfoScanExportedSymbols(raw, masked);
  const exportedNames = new Set(exports.map((e) => (e.match(/(?:function|const)\s+([A-Za-z0-9_$]+)/) || [])[1]).filter(Boolean));
  const { internalFunctions, browserInlineFunctions } = cfoScanFunctionsAndBrowserStrings(mainRaw, mainMasked, relFile, exportedNames);
  const { constantsPreview, imports } = cfoScanUpperConstantsAndImports(raw, masked, projectRoot);
  const httpRoutes = new Set(attributedRoutes || []), domAnchors = new Set();
  if (!relFile.startsWith('skill/check-') && relFile !== 'skill/lint-edit.mjs') {
    cfoCollectClientRoutesAndDom(mainNoComment, httpRoutes, domAnchors);
  }
  return {
    file: relFile, outlineKind: 'code', owners: ownerIds, isSharedGov: checkSharedGovernance(relFile),
    header: extractFullHeaderComment(raw) || '源码模块', exports, internalFunctions, browserInlineFunctions,
    constantsPreview, cliFlags: cfoScanCliFlags(noCommentCode),
    httpRoutes: [...httpRoutes], domAnchors: [...domAnchors], imports, referencedPaths: cfoCollectReferencedPaths(mainNoComment, projectRoot)
  };
}
