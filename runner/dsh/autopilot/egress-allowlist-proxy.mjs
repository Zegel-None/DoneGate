// L3 跨平台出口域名白名单本地回环代理（归属契约：governance-autopilot，<= 165 行）
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_EGRESS_IDLE_TIMEOUT_MS = 900_000;

function eapStripSchemeAndPath(raw) {
  const trimmed = String(raw || '').trim();
  const noScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  return noScheme.split('/')[0].trim();
}

function eapSplitHostPort(raw, defaultPort = null) {
  const authority = eapStripSchemeAndPath(raw);
  if (!authority) return { host: '', port: null, invalidPort: false };
  const idx = authority.lastIndexOf(':');
  const hasColon = idx > 0 && !authority.endsWith(']');
  if (!hasColon) return { host: authority.replace(/^\[|\]$/g, '').toLowerCase(), port: defaultPort, invalidPort: false };
  const hostPart = authority.slice(0, idx).replace(/^\[|\]$/g, '').toLowerCase();
  const portPart = authority.slice(idx + 1);
  if (!/^\d+$/.test(portPart)) return { host: hostPart, port: null, invalidPort: true };
  const portNum = Number(portPart);
  const validRange = portNum >= 1 && portNum <= 65535;
  return { host: hostPart, port: validRange ? portNum : null, invalidPort: !validRange };
}

function eapParseAllowRule(rawRule) {
  const raw = String(rawRule ?? '').trim().toLowerCase();
  if (!raw || raw === '*' || raw === '*:*') return { ok: false, raw: String(rawRule) };
  const isSubdomain = raw.startsWith('*.');
  const body = isSubdomain ? raw.slice(2) : raw;
  if (!body || body.includes('*')) return { ok: false, raw: String(rawRule) };
  const parsed = eapSplitHostPort(body, null);
  if (!parsed.host || parsed.invalidPort) return { ok: false, raw: String(rawRule) };
  if (isSubdomain && !parsed.host.includes('.')) return { ok: false, raw: String(rawRule) };
  return { ok: true, isSubdomain, domain: parsed.host, port: parsed.port };
}

export function validateEgressAllowlist(allowedHosts) {
  if (!Array.isArray(allowedHosts)) {
    return { ok: false, reasonCode: 'EGRESS_INVALID_ALLOWLIST', invalid: ['<non-array>'], rules: [] };
  }
  const invalid = [], rules = [];
  for (const item of allowedHosts) {
    const parsed = eapParseAllowRule(item);
    if (!parsed.ok) invalid.push(parsed.raw);
    else rules.push(parsed);
  }
  const reasonCode = invalid.length > 0 ? 'EGRESS_WILDCARD_FORBIDDEN' : null;
  return { ok: invalid.length === 0, reasonCode, invalid, rules };
}

function eapRuleMatches(rule, target) {
  if (rule.port !== null && rule.port !== target.port) return false;
  return rule.isSubdomain ? target.host.endsWith(`.${rule.domain}`) : target.host === rule.domain;
}

export function isEgressTargetAllowed(hostPort, allowedHosts) {
  const check = validateEgressAllowlist(allowedHosts);
  if (!check.ok || check.rules.length === 0) return false;
  const target = eapSplitHostPort(hostPort, 443);
  if (!target.host || target.invalidPort) return false;
  return check.rules.some((rule) => eapRuleMatches(rule, target));
}

function eapBindSharedIdleWatchdog(sockA, sockB, idleTimeoutMs) {
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  const stepMs = Math.max(15, Math.min(1000, Math.floor(idleTimeoutMs / 4)));
  const timer = setInterval(() => {
    if (Date.now() - lastActivity >= idleTimeoutMs) {
      clearInterval(timer);
      sockA.destroy();
      sockB.destroy();
    }
  }, stepMs);
  timer.unref?.();
  const clear = () => clearInterval(timer);
  sockA.on('data', touch);
  sockB.on('data', touch);
  sockA.once('close', clear);
  sockB.once('close', clear);
  return { touch, clear };
}

function eapHandleConnect(req, clientSocket, head, st) {
  const targetRaw = String(req.url || '');
  if (!isEgressTargetAllowed(targetRaw, st.allowedHosts)) {
    st.recordDenial('CONNECT', targetRaw);
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n403 Forbidden\n');
    return;
  }
  const target = eapSplitHostPort(targetRaw, 443);
  const upstream = net.connect({ host: target.host, port: target.port, allowHalfOpen: true });
  st.track(clientSocket);
  st.track(upstream);
  const watchdog = eapBindSharedIdleWatchdog(clientSocket, upstream, st.idleTimeoutMs);
  let established = false;
  upstream.once('connect', () => {
    established = true;
    watchdog.touch();
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket, { end: true });
    clientSocket.pipe(upstream, { end: true });
  });
  upstream.on('error', () => {
    watchdog.clear();
    if (!established && !clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    else clientSocket.destroy();
  });
  clientSocket.on('error', () => { watchdog.clear(); upstream.destroy(); });
}

function eapHandleHttpRequest(req, res, st) {
  const rawUrl = String(req.url || '/');
  const hostHeader = String(req.headers.host || '');
  const authority = /^https?:\/\//i.test(rawUrl) ? eapStripSchemeAndPath(rawUrl) : hostHeader;
  const target = eapSplitHostPort(authority, 80);
  const normTarget = target.host ? `${target.host}:${target.port}` : authority;
  if (!target.host || !isEgressTargetAllowed(normTarget, st.allowedHosts)) {
    st.recordDenial(req.method || 'GET', normTarget || rawUrl);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end('403 Forbidden\n');
    return;
  }
  const reqPath = /^https?:\/\//i.test(rawUrl) ? (new URL(rawUrl).pathname + new URL(rawUrl).search) : rawUrl;
  const upReq = http.request({ host: target.host, port: target.port, method: req.method, path: reqPath, headers: req.headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  upReq.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('502 Bad Gateway\n'); });
  req.pipe(upReq);
}

export async function startEgressAllowlistProxy(opts = {}) {
  const allowedHosts = opts.allowedHosts || [];
  const check = validateEgressAllowlist(allowedHosts);
  if (!check.ok) throw new Error(`EGRESS_WILDCARD_FORBIDDEN: 非法出口白名单规则 ${check.invalid.join(', ')}`);
  const idleTimeoutMs = Number.isFinite(opts.idleTimeoutMs) && opts.idleTimeoutMs > 0 ? opts.idleTimeoutMs : DEFAULT_EGRESS_IDLE_TIMEOUT_MS;
  const auditLogPath = opts.auditLogPath ? resolve(opts.auditLogPath) : join(resolve(opts.projectRoot || process.cwd()), '.donegate', 'egress-denied.jsonl');
  const sockets = new Set();
  let deniedTotal = 0;
  const st = {
    allowedHosts, idleTimeoutMs,
    track(sock) { sockets.add(sock); sock.once('close', () => sockets.delete(sock)); },
    recordDenial(method, target) {
      deniedTotal += 1;
      mkdirSync(dirname(auditLogPath), { recursive: true });
      appendFileSync(auditLogPath, JSON.stringify({ at: new Date().toISOString(), method, target, reason: 'host-not-allowed' }) + '\n', 'utf8');
    }
  };
  const server = http.createServer((req, res) => eapHandleHttpRequest(req, res, st));
  server.allowHalfOpen = true;
  server.on('connect', (req, sock, head) => eapHandleConnect(req, sock, head, st));
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  return {
    host: '127.0.0.1', port, proxyUrl: `http://127.0.0.1:${port}`, auditLogPath, idleTimeoutMs,
    deniedCount: () => deniedTotal,
    close: () => new Promise((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); })
  };
}
