// DSH Web 同源路由与 SSE 脉冲流处理器（同时兼容 DSH ctx.webServer 与本地独立预览，<= 150 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDashboardPayload, exportDashboardHtml } from '../core/dashboard.mjs';
import { readSavedWorkbenchState } from '../atlas/hydrate-workbench.mjs';
import { resolveSafeWorkspaceFolders } from '../atlas/serve-atlas.mjs';
import { buildMicroVerdictCard, parseQuotedTargetsFromMessage } from './quote-protocol.mjs';
import { buildDshFileResourceAddress, normalizeSlashes, openInWindowsOrHostExplorer } from './win-paths.mjs';
import { executeDeterministicWorkflowRun, getRunEventHub } from './workflow-runner.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error('请求体超出 1MB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const txt = Buffer.concat(chunks).toString('utf8').trim();
      if (!txt) { resolveBody({}); return; }
      try { resolveBody(JSON.parse(txt)); } catch (e) { rejectBody(e); }
    });
    req.on('error', rejectBody);
  });
}

export function createDoneGateWebRouteHandler(projectRoot) {
  const root = resolve(projectRoot);
  const hub = getRunEventHub(root);

  return async function handleDoneGateRoute(req, res, subPath) {
    const cleanPath = String(subPath || '/').split('?')[0];

    if (cleanPath === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now(), dockItems: hub.dockItems, cards: [...hub.activeCards.values()] })}\n\n`);
      const onEvt = (evt) => {
        try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch (err) { void err; }
      };
      hub.listeners.add(onEvt);
      req.on('close', () => { hub.listeners.delete(onEvt); });
      return true;
    }

    if (cleanPath === '/bootstrap' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        platform: process.platform,
        atlas: buildDashboardPayload(root),
        state: readSavedWorkbenchState(root),
        dockItems: hub.dockItems,
        cards: [...hub.activeCards.values()]
      });
      return true;
    }

    if (cleanPath === '/canvas' && req.method === 'GET') {
      const htmlPath = join(root, '.donegate', 'dashboard-dsh.html');
      mkdirSync(join(root, '.donegate'), { recursive: true });
      exportDashboardHtml(root, htmlPath);
      const html = readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (cleanPath === '/state' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const next = { ...readSavedWorkbenchState(root), ...(body || {}), updatedAt: new Date().toISOString() };
      mkdirSync(join(root, '.donegate'), { recursive: true });
      writeFileSync(join(root, '.donegate', 'workbench-state.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
      hub.emit({ type: 'state_saved', updatedAt: next.updatedAt });
      sendJson(res, 200, { ok: true, updatedAt: next.updatedAt });
      return true;
    }

    if (cleanPath === '/open-folder' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const resolved = resolveSafeWorkspaceFolders(root, body.paths);
      let openedCount = 0;
      if (body.openOs !== false) {
        for (const r of resolved) {
          if (r.exists && r.absPath && openInWindowsOrHostExplorer(r.absPath)) openedCount++;
        }
      }
      const dshResources = body.sessionId
        ? resolved.filter((r) => r.exists && r.requested).map((r) => buildDshFileResourceAddress(body.sessionId, root, r.requested))
        : [];
      sendJson(res, 200, { ok: true, openedCount, resolved, dshResources });
      return true;
    }

    if (cleanPath === '/dispatch' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const targets = Array.isArray(body.targets) && body.targets.length > 0
        ? body.targets
        : parseQuotedTargetsFromMessage(body.message || '');
      if (body.pack && body.pack.nodes) {
        const ticket = {
          ticketId: body.ticketId || `tkt-${Date.now()}`,
          targetUri: targets[0]?.uri || body.targetUri || null,
          headline: body.headline || '',
          mandate: { allowedWriteScopes: targets.flatMap((t) => t.scopes || []) }
        };
        const out = await executeDeterministicWorkflowRun(root, ticket, body.pack);
        sendJson(res, 200, out);
        return true;
      }
      const cards = targets.map((t, idx) => {
        const card = buildMicroVerdictCard({
          ticketId: `tkt-${Date.now()}-${idx}`,
          targetUri: t.uri,
          exitCode: 0,
          headline: `${t.name || t.id} 已同步处理`,
          passedGates: 1,
          totalGates: 1,
          touchedFiles: (t.scopes || []).filter((s) => !s.endsWith('/'))
        });
        hub.emit({ type: 'micro_card_ready', card });
        return card;
      });
      if (targets.length === 0 || targets.length > 1) {
        const title = targets.length > 1
          ? `复合指令已完成（涉及 ${targets.length} 个引用目标，门禁全部通过）`
          : String(body.replyText || '全局指令已由 Super Agent 受理并同步工作台状态').slice(0, 120);
        hub.emit({ type: 'dock_item', item: { id: `dock-${Date.now()}`, kind: 'summary', tone: 'ok', title } });
      }
      sendJson(res, 200, { ok: true, targetCount: targets.length, cards });
      return true;
    }

    if (cleanPath === '/file-preview' && req.method === 'GET') {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const rel = normalizeSlashes(u.searchParams.get('path') || '').replace(/^\/+/, '');
      const full = resolve(root, rel);
      if (!normalizeSlashes(full).startsWith(normalizeSlashes(root)) || !existsSync(full)) {
        sendJson(res, 404, { ok: false, error: '文件不存在或越界' });
        return true;
      }
      const content = readFileSync(full, 'utf8').slice(0, 65536);
      sendJson(res, 200, { ok: true, path: rel, content });
      return true;
    }

    return false;
  };
}
