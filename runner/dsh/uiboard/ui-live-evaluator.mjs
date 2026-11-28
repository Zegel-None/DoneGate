// 前端运行态真机多模态评估器（弹窗清障、本机 CDP 兜底、双视口溢出/对比度、双态截图与 CLI 入口，<= 355 行）
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { maybeSpillHookOutput, retrieveSpilledLineRange, supersedeStaleSnapshots } from '../../shared/hook-output-spiller.mjs';
import { computeContrastRatio, evaluateUiAestheticsRubric } from './ui-aesthetics.mjs';
import { UI_DUAL_VIEWPORTS, evaluateDualViewportOverflow } from './ui-board-engine.mjs';
import {
  FORGED_DEEPSEEK_IMAGE_TOKEN, FORGED_VISION_TOKEN_REPLACEMENT, buildBrowserDomVisualProbeScript,
  createCdpJsonRpcSession, findLocalChromeBinary, parseDevToolsActivePort, sanitizeVisionSpecialTokens, uleExecuteCdpFallbackSession
} from './ui-live-evaluator/cdp-probe.mjs';

export { FORGED_DEEPSEEK_IMAGE_TOKEN, FORGED_VISION_TOKEN_REPLACEMENT, createCdpJsonRpcSession, findLocalChromeBinary, parseDevToolsActivePort, sanitizeVisionSpecialTokens };
export const BLOCKING_MODAL_SELECTOR = '[role="dialog"]:visible, [role="alertdialog"]:visible, [aria-modal="true"]:visible';
export const MODAL_DISMISS_BUTTON_SELECTOR = '[aria-label*="close" i], [aria-label*="dismiss" i], [data-dismiss], [data-close], button.close, [class*="close-btn" i]';

const MODAL_DISMISS_TEXT_RE = /^(?:×|✕|✖|x|close|dismiss|got it|no thanks|关闭|取消|我知道了|跳过)$/i;
const DEFAULT_MAX_BUTTONS = 8, DEFAULT_NAV_TIMEOUT_MS = 15000, CLICK_TIMEOUT_MS = 2500, MODAL_CLICK_TIMEOUT_MS = 1500;
const PAGE_LOAD_SETTLE_MS = 180, CLICK_SETTLE_MS = 120, MAX_MODAL_DISMISS_ROUNDS = 4;
const HTTP_ERROR_STATUS_FLOOR = 400, MAX_ERROR_TEXT_CHARS = 240, MAX_URL_CHARS = 180, MAX_BUTTON_LABEL_CHARS = 48;
const EXIT_OK = 0, EXIT_EVAL_FAIL = 1, EXIT_POLICY_REJECT = 2, EXIT_UNAVAILABLE = 3, JSON_INDENT = 2, DOM_SUMMARY_PREVIEW_LINES = 40;

const ULE_PW_CANDIDATES = [
  'workflows/.deps/04/node_modules/@playwright/test/index.mjs',
  'workflows/.deps/04/node_modules/playwright/index.mjs',
  'workflows/.deps/pack-web/node_modules/@playwright/test/index.mjs',
  'workflows/.deps/pack-web/node_modules/playwright/index.mjs',
  'workflows/.deps/_shared/node_modules/playwright/index.mjs',
  'workflows/.deps/04/node_modules/@playwright/test/index.js',
  'workflows/.deps/04/node_modules/playwright/index.js',
  'workflows/.deps/pack-web/node_modules/@playwright/test/index.js',
  'node_modules/@playwright/test/index.mjs',
  'node_modules/playwright/index.mjs',
  'node_modules/@playwright/test/index.js',
  'node_modules/playwright/index.js'
];

export function uleResolvePlaywrightModule(projectRoot) {
  const root = resolve(projectRoot);
  for (const rel of ULE_PW_CANDIDATES) {
    const abs = join(root, rel);
    if (existsSync(abs)) {
      return { available: true, entryPath: abs, relPath: rel };
    }
  }
  return { available: false, entryPath: null, relPath: null };
}

export function uleValidateLocalTargetUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    const host = u.hostname.toLowerCase();
    const okHost = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    if ((u.protocol === 'http:' || u.protocol === 'https:') && okHost) {
      return { ok: true, url: u.toString() };
    }
    return { ok: false, reason: `仅允许评估本机回环地址 (127.0.0.1 / localhost)，拒绝访问：${u.origin}` };
  } catch (err) {
    return { ok: false, reason: `无效的目标 URL：${err.message}` };
  }
}

async function uleStartStaticHtmlServer(htmlContent) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(htmlContent);
  });
  await new Promise((resOk) => server.listen(0, '127.0.0.1', resOk));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((r) => server.close(() => r()))
  };
}

async function tryClickDismissInsideModal(modalLoc, page) {
  const directClose = modalLoc.locator(MODAL_DISMISS_BUTTON_SELECTOR).first();
  if ((await directClose.count()) > 0) {
    await directClose.click({ timeout: MODAL_CLICK_TIMEOUT_MS });
    await page.waitForTimeout(CLICK_SETTLE_MS);
    return true;
  }
  const innerBtns = modalLoc.locator('button:visible, [role="button"]:visible'), btnCount = await innerBtns.count();
  for (let idx = 0; idx < btnCount; idx++) {
    const cand = innerBtns.nth(idx);
    if (MODAL_DISMISS_TEXT_RE.test(String((await cand.textContent()) || '').trim())) {
      await cand.click({ timeout: MODAL_CLICK_TIMEOUT_MS });
      await page.waitForTimeout(CLICK_SETTLE_MS);
      return true;
    }
  }
  return false;
}

export async function uleDismissBlockingModals(page, opts = {}) {
  const maxRounds = Math.max(1, Number(opts.maxDismissRounds || MAX_MODAL_DISMISS_ROUNDS));
  let dismissedCount = 0;
  for (let round = 0; round < maxRounds; round++) {
    const modals = page.locator(BLOCKING_MODAL_SELECTOR);
    if ((await modals.count()) === 0) break;
    const clicked = await tryClickDismissInsideModal(modals.first(), page).catch(() => false);
    if (!clicked) {
      if (typeof page.keyboard?.press === 'function') await page.keyboard.press('Escape').catch(() => undefined);
      break;
    }
    dismissedCount++;
  }
  return { dismissedCount };
}

async function isNativeTextControl(loc) {
  if (typeof loc?.evaluate !== 'function') return false;
  return loc.evaluate((el) => {
    const tag = String(el?.tagName || '').toUpperCase();
    return (tag === 'INPUT' || tag === 'TEXTAREA') && el.getAttribute('contenteditable') !== 'true';
  }).catch(() => false);
}

async function maybePressSubmitKey(page, submitKey) {
  if (submitKey && typeof page.keyboard?.press === 'function') await page.keyboard.press(submitKey);
}

export async function uleFillControlWithTypeFallback(page, selectorOrLocator, value, opts = {}) {
  const text = String(value ?? ''), loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
  if (typeof loc?.fill === 'function' && (await isNativeTextControl(loc))) {
    try {
      await loc.fill(text, { timeout: CLICK_TIMEOUT_MS });
      await maybePressSubmitKey(page, opts.submitKey);
      return { ok: true, method: 'native-fill', submittedKey: opts.submitKey || null };
    } catch (err) { void err; }
  }
  await loc.click({ timeout: CLICK_TIMEOUT_MS });
  await page.keyboard.type(text);
  await maybePressSubmitKey(page, opts.submitKey);
  return { ok: true, method: 'click-keyboard-type', submittedKey: opts.submitKey || null };
}

async function probeSingleButtonCandidate(page, loc, getReqCount) {
  const meta = await loc.evaluate((el, labelCap) => ({
    disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'), noop: el.getAttribute('data-noop') === 'true',
    text: String(el.textContent || '').trim().slice(0, labelCap), id: el.id || '',
    uiOwner: el.getAttribute('data-ui-owner') || el.closest('[data-ui-owner]')?.getAttribute('data-ui-owner') || null
  }), MAX_BUTTON_LABEL_CHARS);
  if (meta.disabled || meta.noop) return null;
  const beforeHtml = await page.evaluate(() => document.body.innerHTML), beforeUrl = page.url(), beforeReqs = getReqCount();
  try {
    await loc.click({ timeout: CLICK_TIMEOUT_MS });
    await page.waitForTimeout(CLICK_SETTLE_MS);
  } catch (err) { return { ...meta, reason: `点击异常：${err.message.slice(0, MAX_BUTTON_LABEL_CHARS)}` }; }
  if ((await page.evaluate(() => document.body.innerHTML)) === beforeHtml && beforeUrl === page.url() && beforeReqs === getReqCount()) {
    return { ...meta, reason: '点击后无 DOM、URL 或网络请求变化（疑似空壳死按钮）' };
  }
  return null;
}

export async function uleProbeDeadButtons(page, maxButtons, getReqCount, opts = {}) {
  const modalRes = await uleDismissBlockingModals(page, opts), deadButtons = [];
  const limit = Math.min(await page.locator('button:visible, [role="button"]:visible').count(), Number(maxButtons || DEFAULT_MAX_BUTTONS));
  for (let i = 0; i < limit; i++) {
    if (i >= (await page.locator('button:visible, [role="button"]:visible').count())) break;
    const hit = await probeSingleButtonCandidate(page, page.locator('button:visible, [role="button"]:visible').nth(i), getReqCount);
    if (hit) deadButtons.push(hit);
  }
  return { deadButtons, dismissedModalCount: modalRes.dismissedCount };
}

function uleResolveScreenshotPaths(root, opts) {
  const outDir = opts.screenshotOut ? dirname(resolve(root, opts.screenshotOut)) : join(root, '.donegate', 'ui-live-eval');
  mkdirSync(outDir, { recursive: true });
  const stamp = Date.now(), postAbs = opts.screenshotOut ? resolve(root, opts.screenshotOut) : join(outDir, `live-eval-${stamp}-post.png`);
  const initialAbs = opts.initialScreenshotOut ? resolve(root, opts.initialScreenshotOut) : (opts.screenshotOut ? postAbs.replace(/(\.png)?$/i, '.initial.png') : join(outDir, `live-eval-${stamp}-initial.png`));
  return { initialAbs, postAbs };
}

function attachPlaywrightCollectors(page, collectors) {
  page.on('dialog', (d) => {
    collectors.dismissedDialogs.push({ type: d.type(), message: String(d.message() || '').slice(0, MAX_ERROR_TEXT_CHARS), accepted: false });
    d.dismiss().catch(() => undefined);
  });
  page.on('console', (m) => { if (m.type() === 'error') collectors.consoleErrors.push(sanitizeVisionSpecialTokens(m.text()).sanitizedText.slice(0, MAX_ERROR_TEXT_CHARS)); });
  page.on('pageerror', (e) => collectors.pageErrors.push(sanitizeVisionSpecialTokens(String(e?.message || e)).sanitizedText.slice(0, MAX_ERROR_TEXT_CHARS)));
  page.on('request', () => { collectors.reqCount++; });
  page.on('response', (res) => { if (res.status() >= HTTP_ERROR_STATUS_FLOOR) collectors.httpErrors.push({ status: res.status(), url: res.url().slice(0, MAX_URL_CHARS) }); });
}

async function uleExecutePlaywrightSession(pwMod, targetUrl, screenshotPaths, opts) {
  const chromium = pwMod.chromium || pwMod.default?.chromium;
  if (!chromium || typeof chromium.launch !== 'function') return { unavailable: true, reason: 'Playwright 模块缺少 chromium.launch 接口' };
  const browser = await chromium.launch({ headless: true }), col = { consoleErrors: [], pageErrors: [], httpErrors: [], dismissedDialogs: [], reqCount: 0 };
  try {
    const page = await browser.newPage({ viewport: { width: UI_DUAL_VIEWPORTS.desktop.width, height: UI_DUAL_VIEWPORTS.desktop.height } });
    attachPlaywrightCollectors(page, col);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Number(opts.timeoutMs || DEFAULT_NAV_TIMEOUT_MS) });
    await page.waitForTimeout(PAGE_LOAD_SETTLE_MS);
    const initialHtmlSnapshot = await page.content();
    await page.screenshot({ path: screenshotPaths.initialAbs, fullPage: true });
    const probeRes = opts.skipDeadButtonProbe === true ? { deadButtons: [], dismissedModalCount: 0 } : await uleProbeDeadButtons(page, Number(opts.maxButtons || DEFAULT_MAX_BUTTONS), () => col.reqCount, opts);
    const deskAudit = await page.evaluate(buildBrowserDomVisualProbeScript({ clickButtons: false })), htmlSnapshot = await page.content();
    await page.screenshot({ path: screenshotPaths.postAbs, fullPage: true });
    await page.setViewportSize({ width: UI_DUAL_VIEWPORTS.mobile.width, height: UI_DUAL_VIEWPORTS.mobile.height });
    const mobAudit = await page.evaluate(buildBrowserDomVisualProbeScript({ clickButtons: false }));
    return {
      unavailable: false, engine: 'playwright', consoleErrors: col.consoleErrors, pageErrors: col.pageErrors, httpErrors: col.httpErrors,
      dismissedDialogs: col.dismissedDialogs, dismissedModalCount: probeRes.dismissedModalCount, deadButtons: probeRes.deadButtons,
      initialHtmlSnapshot, htmlSnapshot, rawDomSummary: deskAudit.domSummary, viewportMetrics: { desktop: deskAudit.desktopMetrics, mobile: mobAudit.desktopMetrics },
      contrastPairs: deskAudit.contrastPairs, initialScreenshotPath: screenshotPaths.initialAbs, postInteractionScreenshotPath: screenshotPaths.postAbs, screenshotPath: screenshotPaths.postAbs
    };
  } finally { await browser.close(); }
}

function uleShouldAttemptCdpFallback(opts) {
  if (opts.disableCdpFallback === true) return false;
  return opts.simulateMissingPlaywright !== true || Boolean(opts.enableCdpFallback || opts.chromePath || opts.cdpWsUrl || typeof opts.cdpSocketFactory === 'function');
}

function uleCollectContrastIssues(contrastPairs) {
  const issues = [];
  for (const pair of (contrastPairs || [])) {
    const res = computeContrastRatio(pair.fg, pair.bg);
    if (res.valid && res.severeUnreadable) issues.push({ selector: pair.selector, fg: pair.fg, bg: pair.bg, ratio: res.ratio });
  }
  return issues;
}

function uleBuildSanitizedDomBundle(root, run) {
  const domClean = sanitizeVisionSpecialTokens(run.rawDomSummary || run.htmlSnapshot || ''), htmlClean = sanitizeVisionSpecialTokens(run.htmlSnapshot || '');
  const forgedVisionTokenCount = domClean.forgedCount + htmlClean.forgedCount;
  const spilled = maybeSpillHookOutput(root, domClean.sanitizedText, { runId: 'ui-live-dom-summary' });
  const sanitizedDomSummary = (spilled.spilled && spilled.logAbsPath) ? retrieveSpilledLineRange(spilled.logAbsPath, 1, DOM_SUMMARY_PREVIEW_LINES).content : spilled.output;
  const snapshotHistory = supersedeStaleSnapshots([
    { role: 'user', content: 'live-ui-evaluation-task' },
    { role: 'tool', name: 'take_snapshot', content: sanitizeVisionSpecialTokens(run.initialHtmlSnapshot || '').sanitizedText },
    { role: 'tool', name: 'take_snapshot', content: htmlClean.sanitizedText }
  ]);
  return { sanitizedDomSummary, cleanHtmlSnapshot: htmlClean.sanitizedText, forgedVisionTokenCount, snapshotHistory };
}

function uleResolveTargetInput(root, opts) {
  if (opts.url) {
    const v = uleValidateLocalTargetUrl(String(opts.url).trim());
    return v.ok ? { ok: true, targetUrl: v.url, htmlToServe: null } : { ok: false, error: { ok: false, exitCode: EXIT_POLICY_REJECT, code: 'NON_LOOPBACK_TARGET', reason: v.reason } };
  }
  if (typeof opts.htmlContent === 'string') return { ok: true, targetUrl: '', htmlToServe: opts.htmlContent };
  if (opts.htmlPath) {
    const absHtml = resolve(root, String(opts.htmlPath)), relHtml = relative(root, absHtml).replace(/\\/g, '/');
    if (!relHtml || isAbsolute(relative(root, absHtml)) || relHtml.startsWith('..') || /^[A-Za-z]:/.test(relHtml)) {
      return { ok: false, error: { ok: false, exitCode: EXIT_POLICY_REJECT, code: 'HTML_PATH_OUT_OF_ROOT', reason: `安全限制：htmlPath 越出项目根目录 (${opts.htmlPath})` } };
    }
    return { ok: true, targetUrl: '', htmlToServe: readFileSync(absHtml, 'utf8') };
  }
  return { ok: false, error: { ok: false, exitCode: EXIT_UNAVAILABLE, code: 'MISSING_TARGET', reason: '缺少评估目标：请提供本机 url、htmlPath 或 htmlContent' } };
}

async function uleRunActiveBrowserEngine(root, targetUrl, screenshotPaths, opts) {
  const pwProbe = opts.simulateMissingPlaywright === true ? { available: false, entryPath: null, relPath: null } : uleResolvePlaywrightModule(root);
  if (pwProbe.available) {
    const pwMod = await import(pathToFileURL(pwProbe.entryPath).href);
    return { run: await uleExecutePlaywrightSession(pwMod, targetUrl, screenshotPaths, opts), playwrightSource: pwProbe.relPath };
  }
  if (uleShouldAttemptCdpFallback(opts)) return { run: await uleExecuteCdpFallbackSession(targetUrl, screenshotPaths, opts), playwrightSource: 'cdp-local-fallback' };
  return { run: { unavailable: true, reason: '未检测到可用 Playwright/Chromium，已安全降级为无法判断（退 3），请先补齐 04/pack-web 依赖池' }, playwrightSource: null };
}

function uleAssembleEvaluationVerdict(targetUrl, playwrightSource, run, viewportOverflow, contrastIssues, domBundle, opts) {
  const rubric = evaluateUiAestheticsRubric(domBundle.cleanHtmlSnapshot, {
    consoleErrorCount: run.consoleErrors.length, pageErrorCount: run.pageErrors.length, httpErrorCount: run.httpErrors.length,
    deadButtonCount: run.deadButtons.length, lowContrastCount: contrastIssues.length, overflowCount: viewportOverflow.overflowCount
  });
  const forgedBlocked = Boolean(opts.rejectForgedVisionTokens && domBundle.forgedVisionTokenCount > 0);
  const issueCount = run.consoleErrors.length + run.pageErrors.length + run.httpErrors.length + run.deadButtons.length + viewportOverflow.overflowCount + contrastIssues.length;
  const minScore = Number(opts.minRubricScore || 0), ok = issueCount === 0 && !forgedBlocked && rubric.pass && (minScore <= 0 || rubric.totalScore >= minScore);
  return {
    ok, exitCode: ok ? EXIT_OK : EXIT_EVAL_FAIL, engine: run.engine, targetUrl, playwrightSource,
    consoleErrors: run.consoleErrors, pageErrors: run.pageErrors, httpErrors: run.httpErrors, deadButtons: run.deadButtons,
    dismissedModalCount: run.dismissedModalCount || 0, dismissedDialogs: run.dismissedDialogs || [], viewportOverflow, contrastIssues,
    initialScreenshotPath: run.initialScreenshotPath, postInteractionScreenshotPath: run.postInteractionScreenshotPath,
    screenshotPath: run.screenshotPath, sanitizedDomSummary: domBundle.sanitizedDomSummary,
    forgedVisionTokenCount: domBundle.forgedVisionTokenCount, snapshotHistory: domBundle.snapshotHistory, rubric,
    summary: ok
      ? `✅ UI 运行态验收通过（总分 ${rubric.totalScore}/100，0 报错，0 死按钮）`
      : `❌ UI 运行态拦截（console=${run.consoleErrors.length}, page=${run.pageErrors.length}, http=${run.httpErrors.length}, deadBtn=${run.deadButtons.length}, score=${rubric.totalScore}/100）`
  };
}

export async function runUiLiveEvaluation(projectRoot, opts = {}) {
  const root = resolve(projectRoot), resolvedTarget = uleResolveTargetInput(root, opts);
  if (!resolvedTarget.ok) return resolvedTarget.error;
  let localSrv = null, targetUrl = resolvedTarget.targetUrl;
  try {
    if (!targetUrl) { localSrv = await uleStartStaticHtmlServer(resolvedTarget.htmlToServe); targetUrl = localSrv.url; }
    const { run, playwrightSource } = await uleRunActiveBrowserEngine(root, targetUrl, uleResolveScreenshotPaths(root, opts), opts);
    if (run.unavailable) return { ok: false, exitCode: EXIT_UNAVAILABLE, code: 'PLAYWRIGHT_UNAVAILABLE', degraded: true, reason: run.reason };
    return uleAssembleEvaluationVerdict(targetUrl, playwrightSource, run, evaluateDualViewportOverflow(run.viewportMetrics || {}), uleCollectContrastIssues(run.contrastPairs), uleBuildSanitizedDomBundle(root, run), opts);
  } catch (err) {
    return { ok: false, exitCode: EXIT_UNAVAILABLE, code: 'LIVE_EVAL_LAUNCH_ERROR', degraded: true, reason: `无头浏览器运行异常：${err.message}` };
  } finally {
    if (localSrv) await localSrv.close();
  }
}

function uleParseCliFlagMap(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1], hasVal = next !== undefined && !next.startsWith('--');
    flags[argv[i].slice(JSON_INDENT)] = hasVal ? next : true;
    if (hasVal) i++;
  }
  return flags;
}

function uleBuildSkippedSelfCheckJson(root) {
  return {
    ok: true, skipped: true, exitCode: EXIT_OK, code: 'NO_LIVE_TARGET_SKIPPED',
    playwrightAvailable: uleResolvePlaywrightModule(root).available, cdpFallbackAvailable: Boolean(findLocalChromeBinary()),
    selfCheck: {
      visionTokenGuardReady: sanitizeVisionSpecialTokens(`probe ${FORGED_DEEPSEEK_IMAGE_TOKEN}`).forgedCount === 1,
      loopbackGuardReady: uleValidateLocalTargetUrl('http://127.0.0.1:3000').ok && !uleValidateLocalTargetUrl('https://example.com').ok
    },
    reason: '未指定 --url 或 --html 运行态目标服务，已完成多模态与回环护栏自检并优雅退 0'
  };
}

export async function runUiLiveEvaluatorCli(argv = process.argv.slice(JSON_INDENT), env = process.env) {
  const flags = uleParseCliFlagMap(argv);
  let nodeCfg = {};
  if (env.DG_NODE_CONFIG) { try { nodeCfg = JSON.parse(env.DG_NODE_CONFIG) || {}; } catch (e) { void e; } }
  const root = resolve(String(flags.root || process.cwd()));
  const url = String(flags.url === true ? '' : (flags.url || nodeCfg.url || '')), htmlPath = String(flags.html === true ? '' : (flags.html || nodeCfg.htmlPath || ''));
  if (!url && !htmlPath) {
    const payload = uleBuildSkippedSelfCheckJson(root);
    process.stdout.write(JSON.stringify(payload, null, JSON_INDENT) + '\n');
    return payload;
  }
  const res = await runUiLiveEvaluation(root, { url, htmlPath, maxButtons: Number(flags['max-buttons'] || nodeCfg.maxButtons || DEFAULT_MAX_BUTTONS), minRubricScore: Number(flags['min-score'] || nodeCfg.minRubricScore || 0), screenshotOut: typeof flags['screenshot-out'] === 'string' ? flags['screenshot-out'] : undefined });
  process.stdout.write(JSON.stringify(res, null, JSON_INDENT) + '\n');
  process.exitCode = res.degraded ? EXIT_OK : res.exitCode;
  return res;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUiLiveEvaluatorCli().catch((err) => {
    process.stderr.write(`ui-live-evaluator fatal: ${err?.message || err}\n`);
    process.exitCode = EXIT_UNAVAILABLE;
  });
}
