// L0 子代理安全标识符校验与敏感环境变量清洗原语（零 HTTP/宿主依赖，供沙箱、挂机与鉴权层单向复用）

const HAG_SENSITIVE_ENV_RE = /^(?:DONEGATE_SESSION_TOKEN|DONEGATE_CONTROL_PLANE_TOKEN|DSH_SESSION_TOKEN|X_DONEGATE_SESSION_TOKEN)$/i;

export function hagIsSafeId(raw) {
  const s = String(raw || '').trim();
  return Boolean(s) && /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..' && !s.includes('..');
}

export function hagSanitizeId(raw, fallback = 'item') {
  const cleaned = String(raw || '').trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.\.+/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned.slice(0, 96);
}

export function hagSanitizeSubagentEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (HAG_SENSITIVE_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}
