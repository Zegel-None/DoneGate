// 零第三方依赖工作台本地实时同步服务（绑定 127.0.0.1，支持实时重扫、共享池对账、外部陈旧项目导入与基于契约 scope 的目录定位）
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLivePort } from '../../atlas/live-port.mjs';
export { computeLivePort };
import { openInSystemBrowser } from '../../shared/browser-open.mjs';
import { exportDashboardHtml } from '../../atlas/dashboard.mjs';
import { readSavedWorkbenchState } from '../../shared/workbench-state.mjs';
import { buildProjectAtlas } from '../../atlas/contract.mjs';
import {
  createDoneGateWebRouteHandler,
  hagCreateControlPlaneGuard,
  hagInjectSessionTokenHtml,
  hagIsLoopbackHost,
  hagValidateControlPlaneRequest,
  reconcileSharedPoolOnRefresh,
  resolveSafeWorkspaceFolders
} from '../index.mjs';
export { resolveSafeWorkspaceFolders };

const THIS_FILE = fileURLToPath(import.meta.url);


function setCors(req, res) {
  const origin = String(req?.headers?.origin || '').trim();
  if (origin && origin !== 'null') {
    try {
      const u = new URL(origin);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && hagIsLoopbackHost(u.host)) {
        res.setHeader('Access-Control-Allow-Origin', u.origin);
        res.setHeader('Vary', 'Origin');
      }
    } catch (err) {
      void err;
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DSH-Session-Id, X-DoneGate-Root, X-DoneGate-Session-Token, X-DoneGate-Role');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function srvAtlasCloseQuietly(srv) {
  try { srv.close(); } catch (err) { void err; }
}

function readReqJson(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectBody(new Error('请求体超过 2MB 上限'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolveBody({});
        return;
      }
      try { resolveBody(JSON.parse(raw)); } catch (e) { rejectBody(e); }
    });
    req.on('error', rejectBody);
  });
}

async function handleImportLegacyProject(req, res, root) {
  try {
    const body = await readReqJson(req);
    const rawDir = String((body && (body.dir || body.projectDir || body.path)) || '').trim();
    if (!rawDir) {
      sendJson(res, 400, { ok: false, reason: '请填写要导入的外部项目文件夹路径' });
      return;
    }
    const absDir = resolve(root, rawDir);
    if (parse(absDir).root === absDir) {
      sendJson(res, 400, { ok: false, reason: '安全限制：禁止直接导入系统根目录或整盘' });
      return;
    }
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
      sendJson(res, 400, { ok: false, reason: '目标路径不存在或不是文件夹：' + rawDir });
      return;
    }
    const extAtlas = buildProjectAtlas(absDir);
    const projName = extAtlas.project?.name || basename(absDir);
    const impId = 'imp-' + sha256(absDir).slice(0, 8);
    const sandbox = {
      ...(extAtlas.workbench?.hostSandbox || {}),
      id: impId, name: `导入：${projName}`, repoSlug: `imported/${projName}`,
      isHost: false, readonly: true, importedPath: absDir,
      tip: `外部陈旧项目导入（${absDir}）· 共 ${(extAtlas.modules || []).length} 个模块`
    };
    const cur = readSavedWorkbenchState(root);
    const prevMap = Array.isArray(cur.importedSandboxes)
      ? Object.fromEntries(cur.importedSandboxes.filter((x) => x && x.id).map((x) => [x.id, x]))
      : (cur.importedSandboxes && typeof cur.importedSandboxes === 'object' ? { ...cur.importedSandboxes } : {});
    prevMap[impId] = sandbox;
    const next = { ...cur, importedSandboxes: prevMap, updatedAt: new Date().toISOString() };
    const dgDir = join(root, '.donegate');
    mkdirSync(dgDir, { recursive: true });
    writeFileSync(join(dgDir, 'workbench-state.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
    exportDashboardHtml(root, join(dgDir, 'dashboard.html'));
    sendJson(res, 200, { ok: true, sandbox, project: extAtlas.project });
  } catch (e) {
    sendJson(res, 400, { ok: false, reason: e.message });
  }
}

async function srvAtlasSaveWorkbenchState(req, res, root) {
  try {
    const body = await readReqJson(req);
    const cur = readSavedWorkbenchState(root);
    const next = { ...cur, ...(body && typeof body === 'object' ? body : {}), updatedAt: new Date().toISOString() };
    const dgDir = join(root, '.donegate');
    mkdirSync(dgDir, { recursive: true });
    writeFileSync(join(dgDir, 'workbench-state.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
    exportDashboardHtml(root, join(dgDir, 'dashboard.html'));
    sendJson(res, 200, { ok: true, savedAt: next.updatedAt });
  } catch (e) {
    sendJson(res, 400, { ok: false, reason: e.message });
  }
}

async function srvAtlasOpenWorkspaceFolder(req, res, root) {
  try {
    const body = await readReqJson(req);
    const resolved = resolveSafeWorkspaceFolders(root, body.paths);
    let openedCount = 0;
    if (body.openOs === true) {
      for (const item of resolved) {
        if (item.exists && item.absPath && openInSystemBrowser(item.absPath)) openedCount++;
      }
    }
    sendJson(res, 200, { ok: true, root, openedCount, resolved });
  } catch (e) {
    sendJson(res, 400, { ok: false, reason: e.message });
  }
}

function srvAtlasRefreshJson(res, root, isRefresh) {
  if (isRefresh) reconcileSharedPoolOnRefresh(root, null, { trigger: 'atlas-refresh' });
  const r = exportDashboardHtml(root, join(root, '.donegate', 'dashboard.html'));
  if (!r.ok) {
    sendJson(res, 500, { ok: false, reason: r.reason });
    return;
  }
  sendJson(res, 200, {
    ok: true, refreshedAt: new Date().toISOString(),
    sharedPool: r.atlas?.workbench?.sharedPool,
    packDepReports: r.atlas?.workbench?.packDepReports,
    uiboardToolchain: r.atlas?.workbench?.uiboardToolchain,
    atlas: r.atlas
  });
}

function srvAtlasServeDashboardHtml(res, root, guardState) {
  const r = exportDashboardHtml(root, join(root, '.donegate', 'dashboard.html'));
  if (!r.ok) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('生成工作台失败：' + r.reason);
    return;
  }
  const html = guardState?.requireAuth ? hagInjectSessionTokenHtml(r.html, guardState.sessionToken) : r.html;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function srvAtlasDispatchWorkbenchApi(req, res, root, url) {
  if ((url === '/api/workbench/import-project' || url === '/api/atlas/import-project') && req.method === 'POST') {
    await handleImportLegacyProject(req, res, root);
    return true;
  }
  if (url === '/api/workbench/state' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, state: readSavedWorkbenchState(root) });
    return true;
  }
  if (url === '/api/workbench/state' && req.method === 'POST') {
    await srvAtlasSaveWorkbenchState(req, res, root);
    return true;
  }
  if (url === '/api/workbench/open-folder' && req.method === 'POST') {
    await srvAtlasOpenWorkspaceFolder(req, res, root);
    return true;
  }
  if (url === '/api/atlas' || url === '/api/atlas/refresh') {
    srvAtlasRefreshJson(res, root, url === '/api/atlas/refresh');
    return true;
  }
  return false;
}

async function srvAtlasDispatchRequest(req, res, ctx) {
  const { root, server, handleDshRoute, guardState } = ctx;
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/donegate/api/')) {
    const subPath = '/' + url.slice('/donegate/api/'.length);
    if (!(await handleDshRoute(req, res, subPath))) sendJson(res, 404, { ok: false, reason: '未知完结门接口: ' + subPath });
    return;
  }
  if (!hagValidateControlPlaneRequest(req, res, guardState)) return;
  if (url === '/api/ping') {
    sendJson(res, 200, { ok: true, pid: process.pid, root });
    return;
  }
  if (url === '/api/shutdown' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => srvAtlasCloseQuietly(server), 30);
    return;
  }
  if (await srvAtlasDispatchWorkbenchApi(req, res, root, url)) return;
  srvAtlasServeDashboardHtml(res, root, guardState);
}

function srvAtlasWriteServerMeta(root, actualPort) {
  const dgDir = join(root, '.donegate');
  if (!existsSync(dgDir)) return;
  try {
    const meta = { pid: process.pid, port: actualPort, url: `http://127.0.0.1:${actualPort}/`, startedAt: new Date().toISOString() };
    writeFileSync(join(dgDir, 'atlas-server.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch (err) {
    void err;
  }
}

export function startAtlasHttpServer(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const targetPort = opts.port ?? computeLivePort(root);
  const idleMs = (opts.idleExitSec ?? 7200) * 1000;
  let idleTimer = null;

  const requireAuth = opts.requireAuth !== false;
  const handleDshRoute = createDoneGateWebRouteHandler(root, { requireAuth, sessionToken: opts.sessionToken });
  const guardState = hagCreateControlPlaneGuard({ requireAuth: handleDshRoute.requireAuth, sessionToken: handleDshRoute.sessionToken });
  const touchIdle = (srv) => {
    if (idleMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => srvAtlasCloseQuietly(srv), idleMs);
    if (idleTimer.unref) idleTimer.unref();
  };

  const server = createServer(async (req, res) => {
    touchIdle(server);
    try {
      await srvAtlasDispatchRequest(req, res, { root, server, handleDshRoute, guardState });
    } catch (err) {
      if (!res.headersSent) {
        const status = Number(err?.statusCode) || (err instanceof SyntaxError ? 400 : 500);
        sendJson(res, status, { ok: false, reason: String(err?.message || err) });
      }
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(targetPort, '127.0.0.1', () => {
      touchIdle(server);
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
      srvAtlasWriteServerMeta(root, actualPort);
      resolvePromise({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}/`, sessionToken: handleDshRoute.sessionToken });
    });
  });
}

export async function ensureBackgroundAtlasServer(projectRoot) {
  const root = resolve(projectRoot);
  const port = computeLivePort(root);
  const pingUrl = `http://127.0.0.1:${port}/api/ping`;
  const isUp = async () => {
    try {
      const r = await fetch(pingUrl, { signal: AbortSignal.timeout(250) });
      if (!r.ok) return false;
      const j = await r.json();
      return Boolean(j && j.ok);
    } catch (err) {
      void err;
      return false;
    }
  };
  if (await isUp()) return { ok: true, port, url: `http://127.0.0.1:${port}/`, reused: true };
  try {
    mkdirSync(join(root, '.donegate'), { recursive: true });
    const child = spawn(process.execPath, [THIS_FILE, '--root', root, '--port', String(port)], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 75));
      if (await isUp()) return { ok: true, port, url: `http://127.0.0.1:${port}/`, reused: false };
    }
  } catch (err) {
    void err;
  }
  return { ok: false, port, url: null };
}

function srvAtlasReadCliArg(argv, key, fallback = null) {
  const idx = argv.indexOf(key);
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  const argv = process.argv.slice(2);
  const root = resolve(srvAtlasReadCliArg(argv, '--root', process.cwd()));
  const port = Number(srvAtlasReadCliArg(argv, '--port', computeLivePort(root)));
  if (argv.includes('--stop')) {
    fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) })
      .catch((err) => { void err; })
      .finally(() => process.exit(0));
  } else {
    startAtlasHttpServer(root, { port }).then(({ url }) => {
      console.log(`工作台实时同步服务已启动：${url}`);
    }).catch((e) => {
      console.error('启动实时服务失败：' + e.message);
      process.exit(1);
    });
  }
}
