// 本机 Chromium CDP 零依赖轻量兜底与视觉特殊标记防伪清洗器（自动处理原生弹窗防死锁，<= 305 行）
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const FORGED_DEEPSEEK_IMAGE_TOKEN = '<｜deepseek_image｜>', FORGED_VISION_TOKEN_REPLACEMENT = '[REDACTED_FORGED_VISION_TOKEN]';
export const CDP_DEFAULT_TIMEOUT_MS = 15000, CDP_PORT_POLL_INTERVAL_MS = 50, CDP_INTERACTION_SETTLE_MS = 120, CDP_KILL_GRACE_MS = 3000;

const FORGED_IMAGE_SP_RE = /(?:<[｜|]\s*deepseek_image\s*[｜|]>|&lt;[｜|]\s*deepseek_image\s*[｜|]&gt;)/gi;
const CHROME_BIN_NAMES = Object.freeze(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']);
const HTTP_ERROR_STATUS_FLOOR = 400, MAX_ERROR_SNIPPET_CHARS = 240, MAX_URL_SNIPPET_CHARS = 180;
const MAX_PROFILE_CLEANUP_RETRIES = 15, PROFILE_CLEANUP_RETRY_MS = 80;
const DEFAULT_DESKTOP_WIDTH = 1280, DEFAULT_DESKTOP_HEIGHT = 800, DEFAULT_MOBILE_WIDTH = 390, DEFAULT_MOBILE_HEIGHT = 844, DEFAULT_MAX_BUTTONS = 8;

export function sanitizeVisionSpecialTokens(rawText, opts = {}) {
  const source = String(rawText ?? ''), hits = source.match(FORGED_IMAGE_SP_RE);
  const forgedCount = hits ? hits.length : 0, replacement = String(opts.replacement || FORGED_VISION_TOKEN_REPLACEMENT);
  const sanitizedText = forgedCount > 0 ? source.replace(FORGED_IMAGE_SP_RE, replacement) : source;
  const blocked = Boolean(opts.rejectOnForged && forgedCount > 0);
  return { ok: !blocked, sanitizedText, forgedCount, blocked };
}
function findChromeInSingleDir(dir, suffix) {
  for (const baseName of CHROME_BIN_NAMES) {
    const candidate = join(dir, `${baseName}${suffix}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function findLocalChromeBinary(explicitPath = '') {
  const configured = String(explicitPath || process.env.CHROME_PATH || '').trim();
  if (configured) return existsSync(configured) ? configured : null;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    const hit = dir ? findChromeInSingleDir(dir, suffix) : null;
    if (hit) return hit;
  }
  return null;
}

export function parseDevToolsActivePort(rawContent) {
  const [rawPort = '', rawPath = ''] = String(rawContent || '').split(/\r?\n/);
  const port = rawPort.trim(), wsPath = rawPath.trim();
  return (/^\d+$/.test(port) && wsPath.startsWith('/')) ? `ws://127.0.0.1:${port}${wsPath}` : null;
}
function normalizeDomSocketEvent(eventName, ev) {
  if (eventName === 'message') return typeof ev?.data === 'string' ? ev.data : String(ev?.data ?? '');
  if (eventName === 'error') return ev?.error || new Error(ev?.message || 'WebSocket error');
  return ev;
}
function attachSocketEvent(socket, eventName, handler) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(eventName, (ev) => handler(normalizeDomSocketEvent(eventName, ev)));
    return;
  }
  if (typeof socket.on === 'function') socket.on(eventName, (arg) => handler(eventName === 'message' ? String(arg ?? '') : arg));
}
function formatCdpExceptionText(params) {
  const d = params?.exceptionDetails, raw = d?.exception?.description || d?.exception?.value || d?.text || 'Uncaught runtime exception';
  return sanitizeVisionSpecialTokens(String(raw)).sanitizedText.slice(0, MAX_ERROR_SNIPPET_CHARS);
}
function formatCdpConsoleArgs(params) {
  const args = Array.isArray(params?.args) ? params.args : [];
  const joined = args.map((a) => String(a?.value ?? a?.description ?? '')).filter(Boolean).join(' ');
  return sanitizeVisionSpecialTokens(joined || 'console.error').sanitizedText.slice(0, MAX_ERROR_SNIPPET_CHARS);
}
function handleIncomingCdpEvent(state, msg, sendRaw) {
  if (msg.method === 'Page.javascriptDialogOpening') {
    const dialogMsg = sanitizeVisionSpecialTokens(String(msg.params?.message || '')).sanitizedText.slice(0, MAX_ERROR_SNIPPET_CHARS);
    state.dismissedDialogs.push({ type: String(msg.params?.type || 'alert'), message: dialogMsg, accepted: false });
    sendRaw('Page.handleJavaScriptDialog', { accept: false }, msg.sessionId || state.sessionId).catch(() => undefined);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const errText = formatCdpExceptionText(msg.params);
    state.consoleErrors.push(errText);
    state.pageErrors.push(errText);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    state.consoleErrors.push(formatCdpConsoleArgs(msg.params));
    return;
  }
  if (msg.method === 'Network.responseReceived' && Number(msg.params?.response?.status) >= HTTP_ERROR_STATUS_FLOOR) {
    state.httpErrors.push({ status: Number(msg.params.response.status), url: String(msg.params.response.url || '').slice(0, MAX_URL_SNIPPET_CHARS) });
    return;
  }
  if (msg.method === 'Page.lifecycleEvent' && msg.params?.name === 'DOMContentLoaded') state.lifecycleEvents.push(msg.params);
}
function failAllPendingCdp(pending, reason) {
  for (const [id, entry] of pending.entries()) {
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(new Error(`${entry.method} failed: ${reason}`));
  }
}
function sendCdpRpcPayload(socket, state, pending, commandTimeoutMs, method, params, explicitSessionId) {
  if (state.closed) return Promise.reject(new Error(`${method} failed: CDP socket closed`));
  const id = state.nextId++, payload = { id, method, params };
  const sid = explicitSessionId !== undefined ? explicitSessionId : state.sessionId;
  if (sid && !/^(?:Target|Browser)\./.test(method)) payload.sessionId = sid;
  return new Promise((resolveCmd, rejectCmd) => {
    const timer = setTimeout(() => { pending.delete(id); rejectCmd(new Error(`${method} timed out`)); }, commandTimeoutMs);
    pending.set(id, { method, resolve: resolveCmd, reject: rejectCmd, timer });
    socket.send(JSON.stringify(payload));
  });
}
function dispatchCdpIncomingRaw(rawText, state, pending, send) {
  let msg;
  try { msg = JSON.parse(rawText); } catch { return; }
  if (msg.method) handleIncomingCdpEvent(state, msg, send);
  if (msg.id === undefined || !pending.has(msg.id)) return;
  const cmd = pending.get(msg.id);
  pending.delete(msg.id);
  clearTimeout(cmd.timer);
  if (msg.error) cmd.reject(new Error(`${cmd.method} failed: ${msg.error.message || 'CDP error'}`));
  else cmd.resolve(msg.result || {});
}

export function createCdpJsonRpcSession(socket, opts = {}) {
  const commandTimeoutMs = Number(opts.timeoutMs || CDP_DEFAULT_TIMEOUT_MS), pending = new Map();
  const state = { sessionId: '', nextId: 1, closed: false, consoleErrors: [], pageErrors: [], httpErrors: [], dismissedDialogs: [], lifecycleEvents: [] };
  const send = (method, params = {}, explicitSid = undefined) => sendCdpRpcPayload(socket, state, pending, commandTimeoutMs, method, params, explicitSid);
  attachSocketEvent(socket, 'message', (rawText) => dispatchCdpIncomingRaw(rawText, state, pending, send));
  attachSocketEvent(socket, 'error', (err) => failAllPendingCdp(pending, err?.message || 'socket error'));
  attachSocketEvent(socket, 'close', () => { state.closed = true; failAllPendingCdp(pending, 'connection closed'); });
  return {
    state, send, setSessionId(sid) { state.sessionId = String(sid || ''); },
    async close() {
      if (state.closed) return;
      await send('Browser.close').catch(() => undefined);
      state.closed = true;
      if (typeof socket.close === 'function') socket.close();
    }
  };
}

export function buildBrowserDomVisualProbeScript(opts = {}) {
  const runClicks = opts.clickButtons === true, maxButtons = Number(opts.maxButtons || DEFAULT_MAX_BUTTONS);
  return `(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const bgOf = (s) => { for (let c = s; c && c.nodeType === 1; c = c.parentElement) { const b = getComputedStyle(c).backgroundColor; if (b && b !== 'transparent' && b !== 'rgba(0, 0, 0, 0)') return b; } return 'rgb(255, 255, 255)'; };
    let dismissedModalCount = 0; const deadButtons = [];
    if (${runClicks}) {
      for (const dlg of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
        if (!vis(dlg)) continue;
        const cb = dlg.querySelector('[aria-label*="close" i], [aria-label*="dismiss" i], [data-dismiss], [data-close], button.close') || [...dlg.querySelectorAll('button, [role="button"]')].find((b) => /^(?:×|✕|x|close|dismiss|got it|关闭|取消|跳过)$/i.test((b.textContent || '').trim()));
        if (cb && vis(cb)) { cb.click(); dismissedModalCount++; }
      }
      for (const btn of [...document.querySelectorAll('button, [role="button"]')].filter(vis).slice(0, ${maxButtons})) {
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('data-noop') === 'true') continue;
        const bHtml = document.body ? document.body.innerHTML : '', bHref = location.href;
        btn.click();
        if ((document.body ? document.body.innerHTML : '') === bHtml && location.href === bHref) deadButtons.push({ id: btn.id || '', text: (btn.textContent || '').trim().slice(0, 48), uiOwner: btn.getAttribute('data-ui-owner') || null, reason: '点击后无 DOM 或 URL 变化（疑似空壳死按钮）' });
      }
    }
    const lines = [], contrastPairs = [], overflowEls = [], vw = window.innerWidth || ${DEFAULT_DESKTOP_WIDTH};
    for (const el of document.querySelectorAll('h1, h2, h3, p, span, div, a[href], button, input, select, textarea, [role="button"]')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect(), tag = el.tagName.toLowerCase();
      if (r.right > vw + 1) overflowEls.push({ selector: el.id ? '#' + el.id : tag, right: Math.round(r.right), scrollWidth: Math.round(el.scrollWidth || r.width) });
      const txt = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
      if (/^(?:h1|h2|h3|a|button|input|select|textarea)$/.test(tag) || el.hasAttribute('role')) lines.push('- ' + (el.getAttribute('role') || tag) + ' "' + txt + '"');
      if (txt && el.children.length === 0) contrastPairs.push({ selector: el.id ? '#' + el.id : tag, fg: getComputedStyle(el).color, bg: bgOf(el) });
    }
    const scrollWidth = Math.max(document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
    return { dismissedModalCount, deadButtons, domSummary: lines.join('\\n'), contrastPairs, htmlSnapshot: document.documentElement.outerHTML, desktopMetrics: { viewportWidth: vw, viewportHeight: window.innerHeight || ${DEFAULT_DESKTOP_HEIGHT}, scrollWidth, elements: overflowEls } };
  })()`;
}
async function launchHeadlessChromeForCdp(binaryPath, timeoutMs) {
  const profileDir = mkdtempSync(join(tmpdir(), 'dg-cdp-prof-')), logFile = join(profileDir, 'chromium.log'), logFd = openSync(logFile, 'w');
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-sandbox', '--disable-gpu', `--window-size=${DEFAULT_DESKTOP_WIDTH},${DEFAULT_DESKTOP_HEIGHT}`, 'about:blank'];
  const child = spawn(binaryPath, args, { stdio: ['ignore', logFd, logFd], windowsHide: true });
  closeSync(logFd);
  let spawnErr = '';
  child.once('error', (e) => { spawnErr = e.message; });
  const portFile = join(profileDir, 'DevToolsActivePort'), deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const wsUrl = existsSync(portFile) ? parseDevToolsActivePort(readFileSync(portFile, 'utf8')) : null;
    if (wsUrl) return { wsUrl, child, profileDir };
    if (spawnErr || child.exitCode !== null || child.signalCode !== null) break;
    await sleep(CDP_PORT_POLL_INTERVAL_MS);
  }
  if (child.exitCode === null) child.kill();
  const tail = (spawnErr || (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')).trim().split(/\r?\n/).pop();
  throw new Error(`Chromium CDP 启动失败：${tail || '未生成 DevToolsActivePort'}`);
}
async function cleanupChromeProcess(launched) {
  if (!launched) return;
  const { child, profileDir } = launched;
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = new Promise((r) => child.once('exit', () => r()));
    child.kill();
    const forceTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { void e; } }, CDP_KILL_GRACE_MS);
    await done;
    clearTimeout(forceTimer);
  }
  for (let i = 0; profileDir && i < MAX_PROFILE_CLEANUP_RETRIES; i++) {
    try { rmSync(profileDir, { recursive: true, force: true }); break; } catch { await sleep(PROFILE_CLEANUP_RETRY_MS); }
  }
}
async function openConnectedWebSocket(wsUrl, opts) {
  if (typeof opts.cdpSocketFactory === 'function') return opts.cdpSocketFactory(wsUrl);
  const WsCtor = opts.WebSocketImpl || globalThis.WebSocket;
  if (typeof WsCtor !== 'function') throw new Error('当前运行时缺少原生 WebSocket');
  const sock = new WsCtor(wsUrl);
  if (sock.readyState === 1) return sock;
  await new Promise((resOpen, rejOpen) => {
    attachSocketEvent(sock, 'open', () => resOpen());
    attachSocketEvent(sock, 'error', (e) => rejOpen(e instanceof Error ? e : new Error('WebSocket 连接失败')));
  });
  return sock;
}
async function captureCdpPng(session, outPath) {
  const shot = outPath ? await session.send('Page.captureScreenshot', { format: 'png' }).catch(() => null) : null;
  if (!shot || typeof shot.data !== 'string' || !shot.data) return null;
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  return outPath;
}
async function runAttachedCdpPageProbe(session, targetUrl, screenshotPaths, opts) {
  const created = await session.send('Target.createTarget', { url: 'about:blank' });
  const attached = await session.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  session.setSessionId(attached.sessionId);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Network.enable').catch(() => undefined);
  await session.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => undefined);
  await session.send('Emulation.setDeviceMetricsOverride', { width: DEFAULT_DESKTOP_WIDTH, height: DEFAULT_DESKTOP_HEIGHT, deviceScaleFactor: 1, mobile: false }).catch(() => undefined);
  const nav = await session.send('Page.navigate', { url: targetUrl });
  if (nav.errorText) throw new Error(`CDP 页面导航失败：${nav.errorText}`);
  await sleep(CDP_INTERACTION_SETTLE_MS);
  const initialEval = await session.send('Runtime.evaluate', { expression: 'document.documentElement ? document.documentElement.outerHTML : ""', returnByValue: true }).catch(() => ({}));
  const initialScreenshotPath = await captureCdpPng(session, screenshotPaths.initialAbs);
  const auditEval = await session.send('Runtime.evaluate', { expression: buildBrowserDomVisualProbeScript({ clickButtons: opts.skipDeadButtonProbe !== true, maxButtons: opts.maxButtons || DEFAULT_MAX_BUTTONS }), returnByValue: true });
  await sleep(CDP_INTERACTION_SETTLE_MS);
  await session.send('Emulation.setDeviceMetricsOverride', { width: DEFAULT_MOBILE_WIDTH, height: DEFAULT_MOBILE_HEIGHT, deviceScaleFactor: 1, mobile: true }).catch(() => undefined);
  const mobEval = await session.send('Runtime.evaluate', { expression: `({ viewportWidth: ${DEFAULT_MOBILE_WIDTH}, viewportHeight: ${DEFAULT_MOBILE_HEIGHT}, scrollWidth: Math.max(document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0) })`, returnByValue: true }).catch(() => ({}));
  const postInteractionScreenshotPath = await captureCdpPng(session, screenshotPaths.postAbs);
  return { initialEval, auditEval, mobEval, initialScreenshotPath, postInteractionScreenshotPath };
}
function buildCdpSessionReport(sessionState, probe, skipDeadButtonProbe) {
  const val = probe.auditEval?.result?.value || {}, initHtml = probe.initialEval?.result?.value || val.htmlSnapshot || '';
  const postShot = probe.postInteractionScreenshotPath, initShot = probe.initialScreenshotPath;
  return {
    unavailable: false, engine: 'cdp-fallback', consoleErrors: sessionState.consoleErrors, pageErrors: sessionState.pageErrors,
    httpErrors: sessionState.httpErrors, dismissedDialogs: sessionState.dismissedDialogs, dismissedModalCount: Number(val.dismissedModalCount || 0),
    deadButtons: skipDeadButtonProbe === true ? [] : (val.deadButtons || []), initialHtmlSnapshot: String(initHtml),
    htmlSnapshot: String(val.htmlSnapshot || ''), rawDomSummary: String(val.domSummary || ''),
    viewportMetrics: { desktop: val.desktopMetrics || null, mobile: probe.mobEval?.result?.value || null },
    contrastPairs: Array.isArray(val.contrastPairs) ? val.contrastPairs : [],
    initialScreenshotPath: initShot, postInteractionScreenshotPath: postShot, screenshotPath: postShot || initShot
  };
}
async function resolveCdpEndpointOrLaunch(opts, timeoutMs) {
  if (opts.cdpWsUrl || typeof opts.cdpSocketFactory === 'function') return { ok: true, wsUrl: opts.cdpWsUrl || 'ws://127.0.0.1:0/devtools/browser/mock', launched: null };
  const bin = findLocalChromeBinary(opts.chromePath);
  if (!bin) return { ok: false, wsUrl: '', launched: null };
  const launched = await launchHeadlessChromeForCdp(bin, timeoutMs);
  return { ok: true, wsUrl: launched.wsUrl, launched };
}

export async function uleExecuteCdpFallbackSession(targetUrl, screenshotPaths, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || CDP_DEFAULT_TIMEOUT_MS);
  let launched = null, session = null;
  try {
    const endpoint = await resolveCdpEndpointOrLaunch(opts, timeoutMs);
    if (!endpoint.ok) return { unavailable: true, reason: '未检测到可用 Playwright 或本机 Chromium/Chrome 二进制' };
    launched = endpoint.launched;
    const sock = await openConnectedWebSocket(endpoint.wsUrl, opts);
    session = createCdpJsonRpcSession(sock, { timeoutMs });
    return buildCdpSessionReport(session.state, await runAttachedCdpPageProbe(session, targetUrl, screenshotPaths, opts), opts.skipDeadButtonProbe);
  } finally {
    if (session) await session.close().catch(() => undefined);
    await cleanupChromeProcess(launched);
  }
}
