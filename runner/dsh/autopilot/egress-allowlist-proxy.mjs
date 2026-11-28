// L3 跨平台出口白名单、net.BlockList 防 DNS 重绑定与流式凭据哨兵替换代理（归属契约：governance-autopilot，<= 465 行）
import dns from 'node:dns';
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { Transform } from 'node:stream';

export const DEFAULT_EGRESS_IDLE_TIMEOUT_MS = 900_000;

const DEFAULT_HTTPS_PORT = 443, DEFAULT_HTTP_PORT = 80, MIN_PORT = 1, MAX_PORT = 65_535;
const WATCHDOG_MIN_STEP_MS = 15, WATCHDOG_MAX_STEP_MS = 1000, WATCHDOG_DIVISOR = 4;
const IPV4_BITS = 32, IPV6_BITS = 128, IPV6_GROUPS = 8, HEX_RADIX = 16, BYTE_SHIFT = 8, BYTE_MASK = 255;
const IPV6_TRANSLATED_IDX = 4, IPV6_MAPPED_IDX = 5, IPV6_HI_QUAD = 6, IPV6_LO_QUAD = 7;
const IPV6_MAPPED_MARK = 0xffff, IPV6_NAT64_G0 = 0x64, IPV6_NAT64_G1 = 0xff9b, IPV6_6TO4_G0 = 0x2002;
const HTTP_FORBIDDEN = 403, HTTP_BAD_GATEWAY = 502;

export const PRIVATE_NETWORK_CIDRS = Object.freeze([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.168.0.0/16', '::/128', '::1/128', 'fc00::/7', 'fe80::/10',
  '::ffff:10.0.0.0/104', '::ffff:127.0.0.0/104', '::ffff:169.254.0.0/112',
  '::ffff:172.16.0.0/108', '::ffff:192.168.0.0/112'
]);

function eapStripZoneAndBrackets(address) {
  const unbracketed = String(address || '').trim().replace(/^\[|\]$/g, '');
  const pct = unbracketed.indexOf('%');
  return (pct === -1 ? unbracketed : unbracketed.slice(0, pct)).toLowerCase();
}

function eapParseIpv6Groups(addr) {
  let normalized;
  try {
    normalized = new URL(`http://[${addr}]/`).hostname.slice(1, -1);
  } catch (err) {
    void err;
    return null;
  }
  const [head = '', tail] = normalized.split('::');
  const lead = head ? head.split(':') : [];
  const rest = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : IPV6_GROUPS - lead.length - rest.length;
  if (fill < 0 || lead.length + fill + rest.length !== IPV6_GROUPS) return null;
  return [...lead, ...Array(fill).fill('0'), ...rest].map((g) => Number.parseInt(g, HEX_RADIX));
}

const eapDottedQuad = (hi, lo) => `${hi >> BYTE_SHIFT}.${hi & BYTE_MASK}.${lo >> BYTE_SHIFT}.${lo & BYTE_MASK}`;

function eapExtractEmbeddedIpv4(addr) {
  if (net.isIP(addr) !== 6) return null;
  const g = eapParseIpv6Groups(addr);
  if (!g) return null;
  if (g[0] === IPV6_6TO4_G0) return eapDottedQuad(g[1], g[2]);
  const lowQuad = eapDottedQuad(g[IPV6_HI_QUAD], g[IPV6_LO_QUAD]);
  const zeroRange = (from, to) => g.slice(from, to).every((x) => x === 0);
  const isNat64 = g[0] === IPV6_NAT64_G0 && g[1] === IPV6_NAT64_G1 && zeroRange(2, IPV6_HI_QUAD);
  const isMapped = zeroRange(0, IPV6_MAPPED_IDX) && (g[IPV6_MAPPED_IDX] === 0 || g[IPV6_MAPPED_IDX] === IPV6_MAPPED_MARK);
  const isTranslated = zeroRange(0, IPV6_TRANSLATED_IDX) && g[IPV6_TRANSLATED_IDX] === IPV6_MAPPED_MARK && g[IPV6_MAPPED_IDX] === 0;
  return (isNat64 || isMapped || isTranslated) ? lowQuad : null;
}

function eapAddCidrRule(list, entry) {
  const slash = entry.indexOf('/');
  const addr = eapStripZoneAndBrackets(slash === -1 ? entry : entry.slice(0, slash));
  const ipVer = net.isIP(addr);
  if (ipVer !== 4 && ipVer !== 6) return;
  const family = ipVer === 4 ? 'ipv4' : 'ipv6';
  const maxBits = ipVer === 4 ? IPV4_BITS : IPV6_BITS;
  const prefix = slash === -1 ? maxBits : Number(entry.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return;
  try {
    if (prefix === maxBits) list.addAddress(addr, family);
    else list.addSubnet(addr, prefix, family);
  } catch (err) {
    void err;
  }
}

export function buildPrivateNetworkBlockList(extraCidrs = []) {
  const list = new net.BlockList();
  for (const cidr of [...PRIVATE_NETWORK_CIDRS, ...(Array.isArray(extraCidrs) ? extraCidrs : [])]) {
    eapAddCidrRule(list, String(cidr));
  }
  return list;
}

const DEFAULT_PRIVATE_BLOCKLIST = buildPrivateNetworkBlockList();

export function isPrivateNetworkAddress(address, blockList = DEFAULT_PRIVATE_BLOCKLIST) {
  const addr = eapStripZoneAndBrackets(address);
  const ipVer = net.isIP(addr);
  if (ipVer === 4) return blockList.check(addr, 'ipv4');
  if (ipVer !== 6) return false;
  if (blockList.check(addr, 'ipv6')) return true;
  const embeddedV4 = eapExtractEmbeddedIpv4(addr);
  return Boolean(embeddedV4 && blockList.check(embeddedV4, 'ipv4'));
}

function eapStripSchemeAndPath(raw) {
  return String(raw || '').trim().replace(/^[a-z]+:\/\//i, '').split('/')[0].trim();
}

function eapValidatePortPart(hostPart, portPart) {
  if (!/^\d+$/.test(portPart)) return { host: hostPart, port: null, invalidPort: true };
  const portNum = Number(portPart);
  const validRange = portNum >= MIN_PORT && portNum <= MAX_PORT;
  return { host: hostPart, port: validRange ? portNum : null, invalidPort: !validRange };
}

function eapSplitHostPort(raw, defaultPort = null) {
  const authority = eapStripSchemeAndPath(raw);
  if (!authority) return { host: '', port: null, invalidPort: false };
  if (authority.startsWith('[')) {
    const closeIdx = authority.indexOf(']');
    if (closeIdx < 0) return { host: '', port: null, invalidPort: true };
    const hostPart = eapStripZoneAndBrackets(authority.slice(1, closeIdx));
    const rest = authority.slice(closeIdx + 1);
    if (!rest) return { host: hostPart, port: defaultPort, invalidPort: false };
    return rest.startsWith(':') ? eapValidatePortPart(hostPart, rest.slice(1)) : { host: hostPart, port: null, invalidPort: true };
  }
  const cleanBare = eapStripZoneAndBrackets(authority);
  if (net.isIP(cleanBare) === 6) return { host: cleanBare, port: defaultPort, invalidPort: false };
  const idx = authority.lastIndexOf(':');
  if (idx <= 0) return { host: cleanBare, port: defaultPort, invalidPort: false };
  return eapValidatePortPart(eapStripZoneAndBrackets(authority.slice(0, idx)), authority.slice(idx + 1));
}

function eapParseAllowRule(rawRule) {
  const raw = String(rawRule ?? '').trim().toLowerCase();
  if (!raw || raw === '*' || raw === '*:*') return { ok: false, raw: String(rawRule) };
  const isSubdomain = raw.startsWith('*.');
  const body = isSubdomain ? raw.slice(2) : raw;
  if (!body || body.includes('*')) return { ok: false, raw: String(rawRule) };
  const parsed = eapSplitHostPort(body, null);
  const isLiteralIp = net.isIP(parsed.host) !== 0;
  if (!parsed.host || parsed.invalidPort) return { ok: false, raw: String(rawRule) };
  if (isSubdomain && (!parsed.host.includes('.') || isLiteralIp)) return { ok: false, raw: String(rawRule) };
  return { ok: true, isSubdomain, domain: parsed.host, port: parsed.port, isLiteralIp };
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
  return { ok: invalid.length === 0, reasonCode: invalid.length > 0 ? 'EGRESS_WILDCARD_FORBIDDEN' : null, invalid, rules };
}

function eapRuleMatches(rule, target) {
  if (rule.port !== null && rule.port !== target.port) return false;
  return rule.isSubdomain ? target.host.endsWith(`.${rule.domain}`) : rule.domain === target.host;
}

export function isEgressTargetAllowed(hostPort, allowedHosts) {
  const check = validateEgressAllowlist(allowedHosts);
  if (!check.ok || check.rules.length === 0) return false;
  const target = eapSplitHostPort(hostPort, DEFAULT_HTTPS_PORT);
  if (!target.host || target.invalidPort) return false;
  return check.rules.some((rule) => eapRuleMatches(rule, target));
}

function eapParseSingleSecretEntry(placeholder, spec) {
  const key = String(placeholder || '');
  if (!key) return null;
  const isObj = Boolean(spec && typeof spec === 'object' && !Buffer.isBuffer(spec));
  const valStr = String(isObj ? (spec.value ?? spec.secret ?? spec.realValue ?? '') : (spec ?? ''));
  if (!valStr) return null;
  return {
    placeholder: key,
    realSecret: valStr,
    sentinel: Buffer.from(key, 'utf8'),
    realValue: Buffer.from(valStr, 'utf8'),
    allowedHosts: isObj && Array.isArray(spec.allowedHosts) ? spec.allowedHosts : null
  };
}

function eapNormalizeSecretEntries(secretMap) {
  if (!secretMap || typeof secretMap !== 'object') return [];
  const rawPairs = secretMap instanceof Map ? [...secretMap.entries()] : Object.entries(secretMap);
  return rawPairs.map(([k, v]) => eapParseSingleSecretEntry(k, v)).filter(Boolean);
}

function eapSelectEntriesForTarget(entries, targetHostPort) {
  if (!targetHostPort) return { injectable: entries, forbiddenSecrets: [] };
  const injectable = [], forbiddenSecrets = [];
  for (const entry of entries) {
    const ok = !entry.allowedHosts || isEgressTargetAllowed(targetHostPort, entry.allowedHosts);
    (ok ? injectable : forbiddenSecrets).push(entry);
  }
  return { injectable, forbiddenSecrets };
}

function eapFindNextSentinel(work, pos, pairs) {
  let matchIdx = -1, matchPair = null;
  for (const p of pairs) {
    const idx = work.indexOf(p.sentinel, pos);
    if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) {
      matchIdx = idx;
      matchPair = p;
    }
  }
  return { matchIdx, matchPair };
}

function eapScanAndSubstitute(work, pairs, holdbackLen) {
  const parts = [];
  let pos = 0;
  while (pos < work.length) {
    const { matchIdx, matchPair } = eapFindNextSentinel(work, pos, pairs);
    if (!matchPair) break;
    parts.push(work.subarray(pos, matchIdx), matchPair.realValue);
    pos = matchIdx + matchPair.sentinel.length;
  }
  const tailStart = Math.max(pos, work.length - holdbackLen);
  parts.push(work.subarray(pos, tailStart));
  return { out: Buffer.concat(parts), tail: Buffer.from(work.subarray(tailStart)) };
}

export function createStreamingCredentialSubstitutor(secretMap, opts = {}) {
  const allEntries = Array.isArray(secretMap) ? secretMap : eapNormalizeSecretEntries(secretMap);
  const { injectable } = eapSelectEntriesForTarget(allEntries, opts.targetHost || '');
  const maxPlaceholderLen = injectable.reduce((mx, p) => Math.max(mx, p.sentinel.length), 0);
  const holdbackLen = Math.max(0, maxPlaceholderLen - 1);
  let carry = Buffer.alloc(0);

  const stream = new Transform({
    transform(chunk, encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      if (injectable.length === 0) { callback(null, buf); return; }
      const work = carry.length > 0 ? Buffer.concat([carry, buf]) : buf;
      const { out, tail } = eapScanAndSubstitute(work, injectable, holdbackLen);
      carry = tail;
      callback(null, out);
    },
    flush(callback) {
      callback(null, carry.length > 0 ? carry : undefined);
    }
  });
  stream.maxPlaceholderLen = maxPlaceholderLen;
  stream.holdbackBytes = holdbackLen;
  return stream;
}

function eapReplaceTextPairs(text, pairs) {
  let out = String(text);
  for (const p of pairs) out = out.replaceAll(p.placeholder, p.realSecret);
  return out;
}

function eapApplyHeaderCredentials(rawHeaders, injectable, forbiddenSecrets, rawUrl) {
  const serialized = `${rawUrl}\n${JSON.stringify(rawHeaders || {})}`;
  if (forbiddenSecrets.some((e) => serialized.includes(e.realSecret) || serialized.includes(e.placeholder))) {
    return { leaked: true, headers: null };
  }
  const headers = { ...rawHeaders };
  if (injectable.length === 0) return { leaked: false, headers };
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') headers[k] = eapReplaceTextPairs(v, injectable);
    else if (Array.isArray(v)) headers[k] = v.map((item) => eapReplaceTextPairs(item, injectable));
  }
  if (injectable.some((p) => p.sentinel.length !== p.realValue.length) && headers['content-encoding'] === undefined) {
    delete headers['content-length'];
  }
  return { leaked: false, headers };
}

function eapIsLoopbackHostname(host) {
  const clean = String(host || '').toLowerCase().replace(/\.$/, '');
  return clean === 'localhost' || clean.endsWith('.localhost');
}

function eapIsExplicitLiteralIpAllowed(target, rules) {
  if (net.isIP(target.host) === 0 || eapExtractEmbeddedIpv4(target.host)) return false;
  return rules.some((r) => r.isLiteralIp && !r.isSubdomain && r.domain === target.host && (r.port === null || r.port === target.port));
}

async function eapResolveDomainTarget(target, st) {
  if (!st.rules.some((rule) => eapRuleMatches(rule, target))) {
    const reason = eapIsLoopbackHostname(target.host) ? 'private-ip-rebinding' : 'host-not-allowed';
    return { ok: false, status: HTTP_FORBIDDEN, reason };
  }
  if (eapIsLoopbackHostname(target.host)) {
    return { ok: false, status: HTTP_FORBIDDEN, reason: 'private-ip-rebinding' };
  }
  const records = await st.resolveHostIps(target.host).catch(() => null);
  if (!records || records.length === 0) return { ok: false, status: HTTP_BAD_GATEWAY, reason: null };
  const badRecord = records.find((r) => isPrivateNetworkAddress(r.address, st.blockList));
  if (badRecord) return { ok: false, status: HTTP_FORBIDDEN, reason: 'private-ip-rebinding', resolvedIp: badRecord.address };
  return { ok: true, connectHost: records[0].address, family: records[0].family || net.isIP(records[0].address) };
}

async function eapAuthorizeAndResolveTarget(target, st) {
  if (!target.host || target.invalidPort) return { ok: false, status: HTTP_FORBIDDEN, reason: 'host-not-allowed' };
  if (net.isIP(target.host) === 0) return eapResolveDomainTarget(target, st);
  if (eapIsExplicitLiteralIpAllowed(target, st.rules)) {
    return { ok: true, connectHost: target.host, family: net.isIP(target.host) };
  }
  const reason = isPrivateNetworkAddress(target.host, st.blockList) ? 'private-ip-rebinding' : 'host-not-allowed';
  return { ok: false, status: HTTP_FORBIDDEN, reason };
}

function eapBindSharedIdleWatchdog(sockA, sockB, idleTimeoutMs) {
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  const stepMs = Math.max(WATCHDOG_MIN_STEP_MS, Math.min(WATCHDOG_MAX_STEP_MS, Math.floor(idleTimeoutMs / WATCHDOG_DIVISOR)));
  const timer = setInterval(() => {
    if (Date.now() - lastActivity >= idleTimeoutMs) { clearInterval(timer); sockA.destroy(); sockB.destroy(); }
  }, stepMs);
  timer.unref?.();
  const clear = () => clearInterval(timer);
  sockA.on('data', touch);
  sockB.on('data', touch);
  sockA.once('close', clear);
  sockB.once('close', clear);
  return { touch, clear };
}

async function eapHandleConnect(req, clientSocket, head, st) {
  const targetRaw = String(req.url || '');
  const target = eapSplitHostPort(targetRaw, DEFAULT_HTTPS_PORT);
  const auth = await eapAuthorizeAndResolveTarget(target, st);
  if (!auth.ok) {
    if (auth.reason) st.recordDenial('CONNECT', targetRaw, auth.reason, auth.resolvedIp);
    const statusLine = auth.status === HTTP_FORBIDDEN ? '403 Forbidden' : '502 Bad Gateway';
    clientSocket.end(`HTTP/1.1 ${statusLine}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${statusLine}\n`);
    return;
  }
  const upstream = net.connect({ host: auth.connectHost, family: auth.family, port: target.port, allowHalfOpen: true });
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

function eapReplyHttpError(res, status) {
  const body = status === HTTP_FORBIDDEN ? '403 Forbidden\n' : '502 Bad Gateway\n';
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
  res.end(body);
}

async function eapCollectCheckedBody(req, forbiddenSecrets) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const full = Buffer.concat(chunks);
  const leaked = forbiddenSecrets.some((e) => full.includes(e.realValue) || full.includes(e.sentinel));
  return { leaked, full };
}

function eapPipeOutboundBody(req, upReq, injectable, bufferedBody) {
  if (injectable.length > 0 && req.headers['content-encoding'] === undefined) {
    const sub = createStreamingCredentialSubstitutor(injectable);
    if (bufferedBody !== null) { sub.pipe(upReq); sub.end(bufferedBody); return; }
    req.pipe(sub).pipe(upReq);
    return;
  }
  if (bufferedBody !== null) upReq.end(bufferedBody);
  else req.pipe(upReq);
}

function eapExtractHttpTarget(req) {
  const rawUrl = String(req.url || '/');
  const isAbs = /^https?:\/\//i.test(rawUrl);
  const authority = isAbs ? eapStripSchemeAndPath(rawUrl) : String(req.headers.host || '');
  const target = eapSplitHostPort(authority, DEFAULT_HTTP_PORT);
  const normTarget = target.host ? `${target.host}:${target.port}` : authority;
  const reqPath = isAbs ? (new URL(rawUrl).pathname + new URL(rawUrl).search) : rawUrl;
  return { rawUrl, target, normTarget, reqPath };
}

async function eapHandleHttpRequest(req, res, st) {
  const { rawUrl, target, normTarget, reqPath } = eapExtractHttpTarget(req);
  const method = req.method || 'GET';
  const auth = await eapAuthorizeAndResolveTarget(target, st);
  if (!auth.ok) {
    req.resume();
    if (auth.reason) st.recordDenial(method, normTarget || rawUrl, auth.reason, auth.resolvedIp);
    eapReplyHttpError(res, auth.status);
    return;
  }
  const { injectable, forbiddenSecrets } = eapSelectEntriesForTarget(st.secretEntries, normTarget);
  const hdrCheck = eapApplyHeaderCredentials(req.headers, injectable, forbiddenSecrets, rawUrl);
  const bodyCheck = (!hdrCheck.leaked && forbiddenSecrets.length > 0) ? await eapCollectCheckedBody(req, forbiddenSecrets) : { leaked: false, full: null };
  if (hdrCheck.leaked || bodyCheck.leaked) {
    if (hdrCheck.leaked) req.resume();
    st.recordDenial(method, normTarget, 'credential-exfiltration-blocked');
    eapReplyHttpError(res, HTTP_FORBIDDEN);
    return;
  }
  const lookup = (_h, _o, cb) => cb(null, auth.connectHost, auth.family);
  const upReq = http.request({ host: target.host, port: target.port, method: req.method, path: reqPath, headers: hdrCheck.headers, lookup }, (upRes) => {
    res.writeHead(upRes.statusCode || HTTP_BAD_GATEWAY, upRes.headers);
    upRes.pipe(res);
  });
  upReq.on('error', () => eapReplyHttpError(res, HTTP_BAD_GATEWAY));
  eapPipeOutboundBody(req, upReq, injectable, bodyCheck.full);
}

async function eapDefaultResolveHostIps(host, customLookup) {
  if (typeof customLookup !== 'function') return dns.promises.lookup(host, { all: true, verbatim: true });
  const out = await customLookup(host);
  if (typeof out === 'string') return [{ address: out, family: net.isIP(out) }];
  if (Array.isArray(out)) return out;
  return out && out.address ? [out] : [];
}

export async function startEgressAllowlistProxy(opts = {}) {
  const allowedHosts = opts.allowedHosts || [];
  const check = validateEgressAllowlist(allowedHosts);
  if (!check.ok) throw new Error(`EGRESS_WILDCARD_FORBIDDEN: 非法出口白名单规则 ${check.invalid.join(', ')}`);
  const idleTimeoutMs = Number.isFinite(opts.idleTimeoutMs) && opts.idleTimeoutMs > 0 ? opts.idleTimeoutMs : DEFAULT_EGRESS_IDLE_TIMEOUT_MS;
  const auditLogPath = opts.auditLogPath ? resolve(opts.auditLogPath) : join(resolve(opts.projectRoot || process.cwd()), '.donegate', 'egress-denied.jsonl');
  const blockList = opts.blockList || buildPrivateNetworkBlockList(opts.extraBlockedCidrs);
  const secretEntries = eapNormalizeSecretEntries(opts.secretMap || opts.credentialSentinels);
  const sockets = new Set();
  let deniedTotal = 0;
  const st = {
    allowedHosts, rules: check.rules, idleTimeoutMs, blockList, secretEntries,
    resolveHostIps: (host) => eapDefaultResolveHostIps(host, opts.dnsLookup),
    track(sock) { sockets.add(sock); sock.once('close', () => sockets.delete(sock)); },
    recordDenial(method, target, reason = 'host-not-allowed', resolvedIp = undefined) {
      deniedTotal += 1;
      mkdirSync(dirname(auditLogPath), { recursive: true });
      const rec = { at: new Date().toISOString(), method, target, reason, ...(resolvedIp ? { resolvedIp } : {}) };
      appendFileSync(auditLogPath, JSON.stringify(rec) + '\n', 'utf8');
    }
  };
  const server = http.createServer((req, res) => { void eapHandleHttpRequest(req, res, st); });
  server.allowHalfOpen = true;
  server.on('connect', (req, sock, head) => { void eapHandleConnect(req, sock, head, st); });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  return {
    host: '127.0.0.1', port, proxyUrl: `http://127.0.0.1:${port}`, auditLogPath, idleTimeoutMs,
    deniedCount: () => deniedTotal,
    close: () => new Promise((res) => { for (const s of sockets) s.destroy(); server.close(() => res()); })
  };
}
