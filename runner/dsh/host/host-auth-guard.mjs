// 本地控制面安全边界守卫（256-bit 会话令牌 + Loopback Host/Origin 校验 + 子代理环境变量清洗）
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sendJson } from './http-utils.mjs';
import { hagIsSafeId, hagSanitizeId, hagSanitizeSubagentEnv } from '../../shared/subagent-env.mjs';
export { hagIsSafeId, hagSanitizeId, hagSanitizeSubagentEnv };

export const CONTROL_PLANE_TOKEN_HEADER = 'x-donegate-session-token';
export const CONTROL_PLANE_AUTH_DENIED_CODE = 'CONTROL_PLANE_AUTH_DENIED';

const HAG_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HAG_SIMPLE_CORS_TYPES = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'];

export function hagSanitizeHttpWorkflowPack(rawPack) {
  if (!rawPack || typeof rawPack !== 'object') return rawPack;
  const nodes = Array.isArray(rawPack.nodes)
    ? rawPack.nodes.map((nd) => {
        if (!nd || typeof nd !== 'object') return nd;
        const copy = { ...nd };
        if (copy.execution && typeof copy.execution === 'object') {
          const { preFlightPlug: _dropPlug, ...safeExec } = copy.execution;
          void _dropPlug;
          copy.execution = safeExec;
        }
        if (copy.exec && typeof copy.exec === 'object') {
          const { nodeArgs: _dropArgs, ...rest } = copy.exec;
          void _dropArgs;
          if (rest.kind === 'external_bin' || (!rest.kind && Array.isArray(copy.exec.nodeArgs))) {
            delete copy.exec;
          } else {
            copy.exec = rest;
          }
        }
        return copy;
      })
    : [];
  return { ...rawPack, nodes };
}

export function hagCreateSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hagExtractHostname(rawHost) {
  const host = String(rawHost || '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    return closeIdx > 1 ? host.slice(1, closeIdx) : '';
  }
  const colonIdx = host.indexOf(':');
  return colonIdx >= 0 ? host.slice(0, colonIdx) : host;
}

export function hagIsLoopbackHost(rawHost) {
  const hostname = hagExtractHostname(rawHost);
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function hagReadHeader(headers, targetName) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = targetName.toLowerCase();
  if (headers[lower] !== undefined) return String(headers[lower] || '').trim();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return String(v || '').trim();
  }
  return '';
}

function hagTimingSafeMatch(expected, actual) {
  if (!expected || !actual) return false;
  const bufA = Buffer.from(String(expected), 'utf8');
  const bufB = Buffer.from(String(actual), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hagIsLoopbackOrigin(originHeader) {
  if (!originHeader) return true;
  if (originHeader === 'null') return false;
  try {
    const u = new URL(originHeader);
    return (u.protocol === 'http:' || u.protocol === 'https:') && hagIsLoopbackHost(u.host);
  } catch (err) {
    void err;
    return false;
  }
}

export function hagCreateControlPlaneGuard(opts = {}) {
  const explicitToken = typeof opts.sessionToken === 'string' && opts.sessionToken.trim()
    ? opts.sessionToken.trim()
    : '';
  const requireAuth = opts.requireAuth === true || Boolean(explicitToken);
  const sessionToken = explicitToken || hagCreateSessionToken();
  return {
    requireAuth,
    requireHostHeader: opts.requireHostHeader === true,
    sessionToken
  };
}

export function hagValidateControlPlaneRequest(req, res, guardState) {
  const headers = (req && req.headers) || {};
  const hostHeader = hagReadHeader(headers, 'host');
  if ((hostHeader || guardState.requireHostHeader) && !hagIsLoopbackHost(hostHeader)) {
    sendJson(res, 403, {
      ok: false,
      code: CONTROL_PLANE_AUTH_DENIED_CODE,
      reason: `拒绝非本机回环 Host 请求 (${hostHeader || 'empty'})，防止跨站与 DNS Rebinding 访问控制面`
    });
    return false;
  }
  const originHeader = hagReadHeader(headers, 'origin');
  if (originHeader && !hagIsLoopbackOrigin(originHeader)) {
    sendJson(res, 403, {
      ok: false,
      code: CONTROL_PLANE_AUTH_DENIED_CODE,
      reason: `拒绝非本机回环 Origin 请求 (${originHeader})`
    });
    return false;
  }
  const method = String(req?.method || 'GET').toUpperCase();
  if (HAG_MUTATING_METHODS.has(method)) {
    const ct = hagReadHeader(headers, 'content-type').toLowerCase().split(';')[0].trim();
    if (ct && HAG_SIMPLE_CORS_TYPES.includes(ct)) {
      sendJson(res, 415, {
        ok: false,
        code: CONTROL_PLANE_AUTH_DENIED_CODE,
        reason: `拒绝非 JSON 简单跨站请求 Content-Type (${ct})`
      });
      return false;
    }
  }
  if (guardState.requireAuth && HAG_MUTATING_METHODS.has(method)) {
    const provided = hagReadHeader(headers, CONTROL_PLANE_TOKEN_HEADER);
    if (!hagTimingSafeMatch(guardState.sessionToken, provided)) {
      sendJson(res, 403, {
        ok: false,
        code: CONTROL_PLANE_AUTH_DENIED_CODE,
        reason: '控制面写操作鉴权失败：缺少或无效的 X-DoneGate-Session-Token 会话令牌'
      });
      return false;
    }
  }
  return true;
}

export function hagInjectSessionTokenHtml(rawHtml, sessionToken) {
  const html = String(rawHtml || '');
  if (!sessionToken || html.includes('name="donegate-session-token"')) return html;
  const safeTok = JSON.stringify(String(sessionToken)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const snippet = [
    `<meta name="donegate-session-token" content="${String(sessionToken).replace(/"/g, '&quot;').replace(/</g, '&lt;')}">`,
    '<script>(function(){var t=' + safeTok + ';var f=window.fetch;if(!f||window.__dgTokenPatched)return;window.__dgTokenPatched=1;window.fetch=function(u,o){var init=Object.assign({},o||{});var m=String(init.method||"GET").toUpperCase();if(m!=="GET"&&m!=="HEAD"){var raw=typeof u==="string"?u:(u&&u.url?u.url:"");var sameApi=false;try{var parsed=new URL(raw,window.location.href);sameApi=parsed.origin===window.location.origin&&(parsed.pathname.indexOf("/donegate/api/")===0||parsed.pathname.indexOf("/api/")===0);}catch(e){sameApi=false;}if(sameApi){var h=new Headers(init.headers||{});if(!h.has("X-DoneGate-Session-Token"))h.set("X-DoneGate-Session-Token",t);init.headers=h;}}return f.call(this,u,init);};})();</script>'
  ].join('\n');
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${snippet}`);
  }
  return `${snippet}\n${html}`;
}
