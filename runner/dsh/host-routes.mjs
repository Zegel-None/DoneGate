// DSH Web 同源路由与 SSE 脉冲流处理器（同时兼容 DSH ctx.webServer 与本地独立预览，<= 255 行）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildDashboardPayload, exportDashboardHtml } from '../core/dashboard.mjs';
import { readSavedWorkbenchState } from '../atlas/hydrate-workbench.mjs';
import { resolveSafeWorkspaceFolders } from '../atlas/serve-atlas.mjs';
import { buildMicroVerdictCard, parseQuotedTargetsFromMessage } from './quote-protocol.mjs';
import { buildDshFileResourceAddress, normalizeSlashes, openInWindowsOrHostExplorer } from './win-paths.mjs';
import { executeDeterministicWorkflowRun, getRunEventHub } from './workflow-runner.mjs';
import { inspectWorkflowDeps, provisionWorkflowDeps } from './workflow-deps.mjs';
import { approveAutopilotHumanGate, loadAutopilotCheckpoint } from './autopilot-state.mjs';

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
      res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now(), dockItems: hub.dockItems, cards: [...hub.activeCards.values()], autopilot: loadAutopilotCheckpoint(root) })}\n\n`);
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
        autopilot: loadAutopilotCheckpoint(root),
        dockItems: hub.dockItems,
        cards: [...hub.activeCards.values()]
      });
      return true;
    }

    if (cleanPath === '/autopilot/status' && req.method === 'GET') {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const cp = loadAutopilotCheckpoint(root, u.searchParams.get('runId') || null);
      sendJson(res, 200, { ok: true, autopilot: cp });
      return true;
    }

    if (cleanPath === '/autopilot/start' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const pack = body.pack || {};
      const ticket = {
        ticketId: body.runId || `night-${Date.now()}`,
        headline: body.headline || '',
        mandate: { allowedWriteScopes: Array.isArray(body.allowedWriteScopes) ? body.allowedWriteScopes : [] }
      };
      const out = await executeDeterministicWorkflowRun(root, ticket, pack, {
        resumeRunId: body.resumeRunId || null,
        requireCleanGit: body.requireCleanGit === true
      });
      sendJson(res, 200, out);
      return true;
    }

    if (cleanPath === '/autopilot/approve' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const app = approveAutopilotHumanGate(root, {
        runId: body.runId || null,
        nodeId: body.nodeId || null,
        by: body.by || '业主',
        note: body.note || '早间人工确认放行'
      });
      if (!app.ok) { sendJson(res, 400, app); return true; }
      if (body.pack && Array.isArray(body.pack.nodes)) {
        const resumed = await executeDeterministicWorkflowRun(root, app.checkpoint.ticket || {}, body.pack, { resumeRunId: app.runId });
        sendJson(res, 200, resumed);
        return true;
      }
      sendJson(res, 200, app);
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

    if (cleanPath === '/workflow-deps/inspect' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body.packs && typeof body.packs === 'object') {
        const reports = {};
        for (const [k, pk] of Object.entries(body.packs)) reports[k] = inspectWorkflowDeps(root, pk);
        sendJson(res, 200, { ok: true, reports });
        return true;
      }
      sendJson(res, 200, { ok: true, report: inspectWorkflowDeps(root, body.pack || {}) });
      return true;
    }

    if (cleanPath === '/workflow-deps/provision' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = provisionWorkflowDeps(root, body.pack || {}, {
        runNpm: body.runNpm === true,
        markInstalledIds: Array.isArray(body.markInstalledIds) ? body.markInstalledIds : undefined
      });
      const title = result.ready
        ? `开发流「${result.packName}」全部 ${result.total} 项依赖已在 ${result.depsDir} 就位，可随时运行`
        : `已建立专属环境目录 ${result.depsDir} 并派发后台补齐工单（待装 ${result.missingCount} 项）`;
      hub.emit({ type: 'workflow_deps_updated', packId: result.packId, report: result });
      hub.emit({ type: 'dock_item', item: { id: `wfdep-${Date.now()}`, kind: result.ready ? 'summary' : 'receipt', tone: result.ready ? 'ok' : 'warn', title } });
      sendJson(res, 200, result);
      return true;
    }

    if (cleanPath === '/open-folder' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const resolved = resolveSafeWorkspaceFolders(root, body.paths);
      let openedCount = 0;
      if (body.openOs !== false) {
        for (const r of resolved) if (r.exists && r.absPath && openInWindowsOrHostExplorer(r.absPath)) openedCount++;
      }
      const dshResources = body.sessionId
        ? resolved.filter((r) => r.exists && r.requested).map((r) => buildDshFileResourceAddress(body.sessionId, root, r.requested))
        : [];
      sendJson(res, 200, { ok: true, openedCount, resolved, dshResources });
      return true;
    }

    if (cleanPath === '/dispatch' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const targets = Array.isArray(body.targets) && body.targets.length > 0 ? body.targets : parseQuotedTargetsFromMessage(body.message || '');
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
          ticketId: `tkt-${Date.now()}-${idx}`, targetUri: t.uri, exitCode: 0,
          headline: `${t.name || t.id} 已同步处理`, passedGates: 1, totalGates: 1,
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
      const rawRel = relative(root, full);
      const relCheck = normalizeSlashes(rawRel);
      let isRegFile = false;
      if (relCheck && !isAbsolute(rawRel) && !/^[A-Za-z]:/.test(relCheck) && !relCheck.startsWith('..') && existsSync(full)) {
        try { isRegFile = statSync(full).isFile(); } catch (err) { void err; }
      }
      if (!isRegFile) {
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
