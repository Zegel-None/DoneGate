// 全栈前后端 API 路由字面量（fetch / EventSource / axios ↔ Express / Next / Svelte 路由）与 HTML/JSX ↔ CSS 类选择器双向耦合边提取器
import { existsSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { walk } from '../../../skill/fs-walk.mjs';

const MIN_CLASS_TOKEN_LEN = 2;
const WEB_ASSET_EXTS = new Set(['.css', '.scss', '.less', '.html', '.htm', '.svelte', '.vue']);
const STYLE_FILE_EXTS = new Set(['.css', '.scss', '.less']);
const MARKUP_STYLE_EXTS = new Set(['.html', '.htm', '.svelte', '.vue']);
const SKIP_ASSET_DIRS = ['node_modules', '.git', '.donegate', '.dsh', '.deps', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports'];
const STATIC_ASSET_TAIL_RE = /\.(?:m?js|cjs|tsx?|jsx|css|scss|less|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map)$/i;
const TEST_PATH_RE = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i;
const GENERIC_UTILITY_CLASSES = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'hidden', 'contents', 'relative', 'absolute', 'fixed', 'sticky',
  'static', 'truncate', 'italic', 'underline', 'uppercase', 'lowercase', 'capitalize', 'container', 'wrapper', 'row', 'col', 'btn',
  'card', 'modal', 'badge', 'icon', 'active', 'disabled', 'selected', 'open', 'closed', 'show', 'hide', 'fade', 'light', 'dark', 'sr-only', 'prose', 'clearfix'
]);
const TAILWIND_PREFIX_RE = /^(?:hover:|focus:|active:|disabled:|dark:|sm:|md:|lg:|xl:|2xl:)+/;
const TAILWIND_SPACING_OR_SIZE_RE = /^-?(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|min-w|max-w|min-h|max-h|gap|space-[xy]|inset|top|right|bottom|left|z|col-span|row-span|opacity|duration|scale|rotate|translate)-(?:\d+(?:\.\d+)?(?:\/\d+)?|px|auto|full|screen|min|max|fit|none|xs|sm|md|lg|xl|\dxl|\[[^\]]+\])$/;
const TAILWIND_LAYOUT_OR_TYPO_RE = /^(?:(?:flex|grid)-(?:row|col|wrap|nowrap|1|auto|initial|none)|order-(?:\d+|first|last|none)|(?:items|justify|self|place)-(?:start|end|center|between|around|evenly|stretch|baseline)|(?:text|font|leading|tracking|rounded|shadow)-(?:xs|sm|base|md|lg|xl|\dxl|none|full|normal|medium|semibold|bold|left|center|right)|(?:text|bg|border|ring)-(?:black|white|transparent|current|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?)|border(?:-[trblxy])?(?:-\d+)?|overflow-(?:auto|hidden|visible|scroll))$/;
const CLIENT_API_CALL_PATTERNS = [
  /\bfetch\s*\(\s*(['"`])([^'"`\n]+)\1/g, /\bEventSource\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\baxios\s*\.\s*(?:get|post|put|patch|delete|head|options|request)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  /\baxios\s*\(\s*(['"`])([^'"`\n]+)\1/g, /\baxios\s*\(\s*\{[^{}]*?\burl\s*:\s*(['"`])([^'"`\n]+)\1/g,
  /\b(?:fetchJson|apiFetch|useSWR|sendBeacon)\s*\(\s*(['"`])([^'"`\n]+)\1/g
];
const SERVER_ROUTE_CALL_PATTERNS = [
  /\b(?:app|router|server|hono|api|fastify|route|bp)\s*\.\s*(?:get|post|put|patch|delete|all|use|route|sse)\s*\(\s*(['"`])(\/[^'"`\s]*)\1/g,
  /(?:req\.url|url\.pathname|pathname|routePath|subPath|apiPath)\s*(?:===?|!==?|\.startsWith\s*\()\s*(['"`])(\/[^'"`\s)]+)\1/g,
  /(['"`])(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^'"`\s]+)\1/g,
  /@[A-Za-z0-9_.]+\.(?:get|post|put|patch|delete|route|websocket)\s*\(\s*(['"])(\/[^'"]+)\1/g
];
const NEXT_APP_ROUTE_RE = /(?:^|\/)app\/(.+\/)?route\.(?:[cm]?[jt]sx?)$/i;
const NEXT_PAGES_API_RE = /(?:^|\/)pages\/(api\/.+?)(?:\/index)?\.(?:[cm]?[jt]sx?)$/i;
const SVELTE_SERVER_ROUTE_RE = /(?:^|\/)routes\/(.+?)\/\+server\.(?:[cm]?[jt]s)$/i;
const AT_RULE_CONTAINER_RE = /^@(?:media|supports|layer|container|scope)\b/i;

function fseNormalizeRouteSegment(seg) {
  if (!seg) return '';
  return /^\[\[?\.\.\.[^\]]+\]?\]$|^\[[^\]]+\]$|^\{[^}]+\}$|^<[^>]+>$|^:[A-Za-z_$][\w$-]*$/.test(seg) ? ':param' : seg;
}

export function normalizeFullstackRoutePath(rawUrl) {
  let raw = String(rawUrl || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^(?:https?|wss?):\/\/[^/]+/i, '').replace(/\$\{[^}]+\}/g, ':param').split(/[?#]/)[0].trim();
  if (!raw.startsWith('/')) return null;
  const parts = raw.replace(/\/+/g, '/').split('/').filter((seg, idx) => idx === 0 || Boolean(seg)).map(fseNormalizeRouteSegment);
  const route = parts.join('/').startsWith('/') ? parts.join('/') : `/${parts.join('/')}`;
  return (route === '/' || STATIC_ASSET_TAIL_RE.test(route)) ? null : route;
}

function fseNormalizeConventionSegments(rawSegments) {
  const parts = String(rawSegments || '').split('/').filter((seg) => seg && !(seg.startsWith('(') && seg.endsWith(')'))).map(fseNormalizeRouteSegment);
  return parts.length > 0 ? normalizeFullstackRoutePath(`/${parts.join('/')}`) : null;
}

export function extractConventionApiRoute(relPath) {
  const clean = String(relPath || '').replace(/\\/g, '/');
  const nextApp = clean.match(NEXT_APP_ROUTE_RE);
  if (nextApp) return fseNormalizeConventionSegments(nextApp[1] || '');
  const nextPages = clean.match(NEXT_PAGES_API_RE);
  if (nextPages) return fseNormalizeConventionSegments(nextPages[1]);
  const svelteSrv = clean.match(SVELTE_SERVER_ROUTE_RE);
  return svelteSrv ? fseNormalizeConventionSegments(svelteSrv[1]) : null;
}

function fseCollectRegexRoutes(source, patterns, targetSet) {
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const route = normalizeFullstackRoutePath(m[2]);
      if (route) targetSet.add(route);
    }
  }
}

function fseIsCustomCssClass(rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < MIN_CLASS_TOKEN_LEN) return false;
  const stripped = token.replace(TAILWIND_PREFIX_RE, '');
  if (!/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(stripped) || GENERIC_UTILITY_CLASSES.has(stripped.toLowerCase())) return false;
  return !TAILWIND_SPACING_OR_SIZE_RE.test(stripped) && !TAILWIND_LAYOUT_OR_TYPO_RE.test(stripped);
}

function fseAddWhitespaceClasses(rawChunk, targetSet) {
  for (const tok of String(rawChunk || '').replace(/\$\{[\s\S]*?\}/g, ' ').split(/\s+/)) {
    if (fseIsCustomCssClass(tok)) targetSet.add(tok);
  }
}

function fseAddSelectorHeaderClasses(header, cssDefs) {
  if (!header || header.startsWith('@')) return;
  for (const m of header.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) {
    if (fseIsCustomCssClass(m[1])) cssDefs.add(m[1]);
  }
}

function fseExtractCssSelectorClasses(cssText, cssDefs) {
  const clean = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  const stack = [];
  let headerStart = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i], inRules = stack.length === 0 || stack[stack.length - 1] === 'at';
    if (ch === '{') {
      const header = clean.slice(headerStart, i).trim();
      if (inRules) fseAddSelectorHeaderClasses(header, cssDefs);
      stack.push(inRules && AT_RULE_CONTAINER_RE.test(header) ? 'at' : 'decl');
      headerStart = i + 1;
    } else if (ch === '}') {
      stack.pop();
      headerStart = i + 1;
    } else if (ch === ';' && inRules) headerStart = i + 1;
  }
}

function fseFindMatchingBrace(text, openIdx) {
  for (let i = openIdx, depth = 0; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function fseExtractJsxClassExprs(source, cssRefs) {
  for (const m of source.matchAll(/\b(?:className|class)\s*=\s*\{/g)) {
    const openBrace = m.index + m[0].length - 1, closeBrace = fseFindMatchingBrace(source, openBrace);
    if (closeBrace <= openBrace) continue;
    const expr = source.slice(openBrace + 1, closeBrace);
    for (const tpl of expr.matchAll(/`([\s\S]*?)`/g)) fseAddWhitespaceClasses(tpl[1], cssRefs);
    for (const q of expr.replace(/`[\s\S]*?`/g, ' ').matchAll(/(['"])([^'"]+)\1/g)) fseAddWhitespaceClasses(q[2], cssRefs);
  }
}

function fseExtractMarkupClassRefs(source, cssRefs) {
  for (const m of source.matchAll(/\b(?:class|className)\s*=\s*\\?(['"])([\s\S]*?)\1/g)) fseAddWhitespaceClasses(m[2], cssRefs);
  fseExtractJsxClassExprs(source, cssRefs);
  for (const m of source.matchAll(/\.classList\s*\.\s*(?:add|remove|toggle|contains)\s*\(([^)]+)\)/g)) {
    for (const lit of m[1].matchAll(/(['"`])([^'"`]+)\1/g)) fseAddWhitespaceClasses(lit[2], cssRefs);
  }
  for (const m of source.matchAll(/\bstyles\.([A-Za-z_$][\w$]*)|\bstyles\[\s*(['"])([^'"]+)\2\s*\]/g)) {
    if (fseIsCustomCssClass(m[1] || m[3])) cssRefs.add(m[1] || m[3]);
  }
  for (const m of source.matchAll(/\b(?:querySelector|querySelectorAll|closest|matches)\s*\(\s*['"`][^'"`\n]*?\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) {
    if (fseIsCustomCssClass(m[1])) cssRefs.add(m[1]);
  }
}

export function extractFileFullstackWiring(source, relPath = '') {
  if (!source) return { apiDefs: [], apiRefs: [], apiRoutes: [], cssDefs: [], cssRefs: [], cssClasses: [] };
  const ext = extname(relPath).toLowerCase(), apiDefs = new Set(), apiRefs = new Set(), cssDefs = new Set(), cssRefs = new Set();
  if (!STYLE_FILE_EXTS.has(ext)) {
    const convRoute = extractConventionApiRoute(relPath);
    if (convRoute) apiDefs.add(convRoute);
    fseCollectRegexRoutes(source, SERVER_ROUTE_CALL_PATTERNS, apiDefs);
    fseCollectRegexRoutes(source, CLIENT_API_CALL_PATTERNS, apiRefs);
    fseExtractMarkupClassRefs(source, cssRefs);
  }
  if (STYLE_FILE_EXTS.has(ext)) fseExtractCssSelectorClasses(source, cssDefs);
  else if (MARKUP_STYLE_EXTS.has(ext)) {
    for (const sm of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) fseExtractCssSelectorClasses(sm[1], cssDefs);
  }
  return {
    apiDefs: [...apiDefs].sort(), apiRefs: [...apiRefs].sort(), apiRoutes: [...new Set([...apiDefs, ...apiRefs])].sort(),
    cssDefs: [...cssDefs].sort(), cssRefs: [...cssRefs].sort(), cssClasses: [...new Set([...cssDefs, ...cssRefs])].sort()
  };
}

export function indexFullstackEdges(byFile, edges, hubCap, indexPairFn) {
  const cssTouchCount = new Map();
  for (const w of byFile.values()) {
    for (const cls of new Set([...(w.cssDefs || []), ...(w.cssRefs || [])])) cssTouchCount.set(cls, (cssTouchCount.get(cls) || 0) + 1);
  }
  indexPairFn(byFile, edges, (w) => w.apiDefs || [], (w) => w.apiRefs || []);
  indexPairFn(byFile, edges, (w) => w.cssDefs || [], (w) => w.cssRefs || [], (cls) => (cssTouchCount.get(cls) || 0) <= hubCap);
}

function fseIsEligibleWebAsset(relPath) {
  return WEB_ASSET_EXTS.has(extname(relPath).toLowerCase()) && !TEST_PATH_RE.test(relPath);
}

function fseAddSingleScopeAssets(projectRoot, rawScope, merged) {
  const clean = String(rawScope || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const abs = clean ? resolve(projectRoot, clean) : '';
  if (!abs || !existsSync(abs)) return;
  let st = null;
  try { st = statSync(abs); } catch (err) { void err; return; }
  if (st.isFile()) {
    if (fseIsEligibleWebAsset(clean)) merged.add(clean);
    return;
  }
  if (!st.isDirectory()) return;
  for (const f of walk(abs, { skipDirs: SKIP_ASSET_DIRS }).files) {
    const rel = relative(projectRoot, f).replace(/\\/g, '/');
    if (fseIsEligibleWebAsset(rel)) merged.add(rel);
  }
}

export function expandScopeWithWebAssets(projectRoot, scopes = [], baseScopeFiles = []) {
  const merged = new Set(baseScopeFiles || []);
  for (const rawScope of Array.isArray(scopes) ? scopes : []) fseAddSingleScopeAssets(projectRoot, rawScope, merged);
  return [...merged].sort();
}
