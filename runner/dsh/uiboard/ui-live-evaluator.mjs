// 前端运行态真实浏览器评估器（UI Live Evaluator）：捕获 console/page/HTTP 错误、死按钮与失败截图（<= 240 行）
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateUiAestheticsRubric } from './ui-aesthetics.mjs';

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

async function uleProbeDeadButtons(page, maxButtons, getReqCount) {
  const deadButtons = [];
  const total = await page.locator('button:visible, [role="button"]:visible').count();
  const limit = Math.min(total, maxButtons);
  for (let i = 0; i < limit; i++) {
    const loc = page.locator('button:visible, [role="button"]:visible').nth(i);
    const meta = await loc.evaluate((el) => ({
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      noop: el.getAttribute('data-noop') === 'true',
      text: String(el.textContent || '').trim().slice(0, 48),
      id: el.id || '',
      uiOwner: el.getAttribute('data-ui-owner') || el.closest('[data-ui-owner]')?.getAttribute('data-ui-owner') || null
    }));
    if (meta.disabled || meta.noop) continue;
    const beforeHtml = await page.evaluate(() => document.body.innerHTML);
    const beforeUrl = page.url();
    const beforeReqs = getReqCount();
    try {
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(120);
    } catch (err) {
      deadButtons.push({ ...meta, reason: `点击异常：${err.message.slice(0, 80)}` });
      continue;
    }
    const afterHtml = await page.evaluate(() => document.body.innerHTML);
    const afterUrl = page.url();
    const afterReqs = getReqCount();
    if (beforeHtml === afterHtml && beforeUrl === afterUrl && beforeReqs === afterReqs) {
      deadButtons.push({ ...meta, reason: '点击后无 DOM、URL 或网络请求变化（疑似空壳死按钮）' });
    }
  }
  return deadButtons;
}

async function uleExecutePlaywrightSession(pwMod, targetUrl, root, opts) {
  const chromium = pwMod.chromium || pwMod.default?.chromium;
  if (!chromium || typeof chromium.launch !== 'function') {
    return { unavailable: true, reason: 'Playwright 模块缺少 chromium.launch 接口' };
  }
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  let reqCount = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
    page.on('pageerror', (e) => { pageErrors.push(String(e?.message || e).slice(0, 240)); });
    page.on('request', () => { reqCount++; });
    page.on('response', (res) => {
      if (res.status() >= 400) httpErrors.push({ status: res.status(), url: res.url().slice(0, 180) });
    });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Number(opts.timeoutMs || 15000) });
    await page.waitForTimeout(180);
    const htmlSnapshot = await page.content();
    const deadButtons = opts.skipDeadButtonProbe === true
      ? []
      : await uleProbeDeadButtons(page, Number(opts.maxButtons || 8), () => reqCount);
    const hasIssues = consoleErrors.length > 0 || pageErrors.length > 0 || httpErrors.length > 0 || deadButtons.length > 0;
    let screenshotPath = null;
    if (hasIssues || opts.alwaysScreenshot === true) {
      const outDir = join(root, '.donegate', 'ui-live-eval');
      mkdirSync(outDir, { recursive: true });
      const shotAbs = opts.screenshotOut ? resolve(root, opts.screenshotOut) : join(outDir, `live-eval-${Date.now()}.png`);
      await page.screenshot({ path: shotAbs, fullPage: true });
      screenshotPath = shotAbs;
    }
    return { unavailable: false, consoleErrors, pageErrors, httpErrors, deadButtons, htmlSnapshot, screenshotPath };
  } finally {
    await browser.close();
  }
}

export async function runUiLiveEvaluation(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  let targetUrl = opts.url ? String(opts.url).trim() : '';
  let localSrv = null;

  if (targetUrl) {
    const v = uleValidateLocalTargetUrl(targetUrl);
    if (!v.ok) return { ok: false, exitCode: 2, code: 'NON_LOOPBACK_TARGET', reason: v.reason };
    targetUrl = v.url;
  } else if (opts.htmlPath || typeof opts.htmlContent === 'string') {
    let html = '';
    if (typeof opts.htmlContent === 'string') {
      html = opts.htmlContent;
    } else {
      const absHtml = resolve(root, String(opts.htmlPath));
      const relHtml = relative(root, absHtml).replace(/\\/g, '/');
      if (!relHtml || isAbsolute(relative(root, absHtml)) || relHtml.startsWith('..') || /^[A-Za-z]:/.test(relHtml)) {
        return { ok: false, exitCode: 2, code: 'HTML_PATH_OUT_OF_ROOT', reason: `安全限制：htmlPath 越出项目根目录 (${opts.htmlPath})` };
      }
      html = readFileSync(absHtml, 'utf8');
    }
    localSrv = await uleStartStaticHtmlServer(html);
    targetUrl = localSrv.url;
  } else {
    return { ok: false, exitCode: 3, code: 'MISSING_TARGET', reason: '缺少评估目标：请提供本机 url、htmlPath 或 htmlContent' };
  }

  try {
    const probe = opts.simulateMissingPlaywright === true
      ? { available: false, entryPath: null }
      : uleResolvePlaywrightModule(root);
    if (!probe.available) {
      return {
        ok: false,
        exitCode: 3,
        code: 'PLAYWRIGHT_UNAVAILABLE',
        degraded: true,
        reason: '未检测到可用 Playwright/Chromium，已安全降级为无法判断（退 3），请先补齐 04/pack-web 依赖池'
      };
    }
    const pwMod = await import(pathToFileURL(probe.entryPath).href);
    const run = await uleExecutePlaywrightSession(pwMod, targetUrl, root, opts);
    if (run.unavailable) {
      return { ok: false, exitCode: 3, code: 'PLAYWRIGHT_UNAVAILABLE', degraded: true, reason: run.reason };
    }
    const rubric = evaluateUiAestheticsRubric(run.htmlSnapshot, {
      consoleErrorCount: run.consoleErrors.length,
      pageErrorCount: run.pageErrors.length,
      httpErrorCount: run.httpErrors.length,
      deadButtonCount: run.deadButtons.length
    });
    const runtimeOk = run.consoleErrors.length === 0 && run.pageErrors.length === 0 &&
      run.httpErrors.length === 0 && run.deadButtons.length === 0;
    const ok = runtimeOk && rubric.pass;
    return {
      ok,
      exitCode: ok ? 0 : 1,
      targetUrl,
      playwrightSource: probe.relPath,
      consoleErrors: run.consoleErrors,
      pageErrors: run.pageErrors,
      httpErrors: run.httpErrors,
      deadButtons: run.deadButtons,
      screenshotPath: run.screenshotPath,
      rubric,
      summary: ok
        ? `✅ UI 运行态验收通过（总分 ${rubric.totalScore}/100，0 报错，0 死按钮）`
        : `❌ UI 运行态拦截（console=${run.consoleErrors.length}, page=${run.pageErrors.length}, http=${run.httpErrors.length}, deadBtn=${run.deadButtons.length}, score=${rubric.totalScore}/100）`
    };
  } catch (err) {
    return { ok: false, exitCode: 3, code: 'LIVE_EVAL_LAUNCH_ERROR', degraded: true, reason: `无头浏览器运行异常：${err.message}` };
  } finally {
    if (localSrv) await localSrv.close();
  }
}
