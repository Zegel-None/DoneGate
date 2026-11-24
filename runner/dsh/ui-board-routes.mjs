// UI 看板同源 HTTP 路由模块（/donegate/api/uiboard/*：真实项目/自举套娃渲染、同源注入代理、美学锁、需求记录与传达到 grill me）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportDashboardHtml } from '../core/index.mjs';
import { lockDesignSystemMaster } from './ui-aesthetics.mjs';
import { buildInjectedUiBridgeScript } from './ui-board-bridge.mjs';
import {
  addUiBoardRequirement, buildBackendWiringPlan, conveyUiBoardRequirementsToKanban,
  detectProjectUiEntry, isSelfDoneGateProject, loadUiBoardRequirements,
  mutateUiLayoutBlocks, provisionUiBoardDeps, readUiToolchainStatus,
  renderPrototypeHtml, runUiAgentSelfPlayCheck
} from './ui-board-engine.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function injectBridgeIntoHtml(rawHtml) {
  const tag = '<script src="/donegate/api/uiboard/bridge.js"></script>';
  if (rawHtml.includes('/donegate/api/uiboard/bridge.js')) return rawHtml;
  if (/<\/body>/i.test(rawHtml)) return rawHtml.replace(/<\/body>/i, `${tag}\n</body>`);
  return rawHtml + `\n${tag}\n`;
}

function uibrBuildSelfWorkbenchHtml(root, editorMode) {
  if (editorMode === 'puck' || !isSelfDoneGateProject(root)) return null;
  const protoDir = join(root, '.donegate', 'ui-prototype');
  mkdirSync(protoDir, { recursive: true });
  const rawPath = join(protoDir, 'donegate-self-raw.html');
  exportDashboardHtml(root, rawPath);
  return existsSync(rawPath) ? readFileSync(rawPath, 'utf8') : null;
}

async function uibrHandleProxyRoute(req, res) {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const target = u.searchParams.get('url') || '';
  let parsed = null;
  try {
    parsed = new URL(target);
  } catch (err) {
    void err;
  }
  if (!parsed || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    sendJson(res, 400, { ok: false, error: '安全限制：UI 看板代理仅允许连接本机 localhost / 127.0.0.1 开发服务' });
    return true;
  }
  try {
    const upstream = await fetch(parsed.toString(), { signal: AbortSignal.timeout(4000) });
    const ct = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    const txt = await upstream.text();
    const baseTag = `<base href="${parsed.origin}/">`;
    const withBase = /<head[^>]*>/i.test(txt) ? txt.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`) : (baseTag + txt);
    res.writeHead(upstream.status, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(ct.includes('html') ? injectBridgeIntoHtml(withBase) : txt);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: `本地开发服务暂未响应 (${parsed.origin})：${e.message}` });
  }
  return true;
}

async function uibrHandleGetRoutes(req, res, subPath, root) {
  if (subPath === '/uiboard/bridge.js' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buildInjectedUiBridgeScript());
    return true;
  }
  if (subPath === '/uiboard/status' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, uiboard: detectProjectUiEntry(root) });
    return true;
  }
  if (subPath === '/uiboard/requirements' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, requirements: loadUiBoardRequirements(root) });
    return true;
  }
  if (subPath === '/uiboard/prototype' && req.method === 'GET') {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const proposalId = u.searchParams.get('theme') || undefined;
    const editorMode = u.searchParams.get('editor') || undefined;
    const selfWorkbenchHtml = uibrBuildSelfWorkbenchHtml(root, editorMode);
    const proto = renderPrototypeHtml(root, { proposalId, editorMode, selfWorkbenchHtml });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(proto.html);
    return true;
  }
  if (subPath === '/uiboard/proxy' && req.method === 'GET') {
    return uibrHandleProxyRoute(req, res);
  }
  return false;
}

async function uibrHandleDesignAndSelfPlayRoutes(req, res, subPath, root, hub, readJsonBody) {
  if (subPath === '/uiboard/theme-lock' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const lock = lockDesignSystemMaster(root, body.proposalId, body.projectName);
    renderPrototypeHtml(root, { proposalId: lock.proposalId });
    hub.emit({ type: 'dock_item', item: { id: `uitheme-${Date.now()}`, kind: 'summary', tone: 'ok', title: `🎨 已锁定美学方案「${lock.proposalName}」并写入 ${lock.masterFile}` } });
    sendJson(res, 200, { ok: true, lock });
    return true;
  }
  if (subPath === '/uiboard/layout' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = mutateUiLayoutBlocks(root, body);
    sendJson(res, 200, { ok: true, layout: out.layout, wiring: out.wiring, toolchain: out.toolchain });
    return true;
  }
  if (subPath === '/uiboard/inline-edit' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const relFile = String(body.sourceFile || '.donegate/ui-prototype/index.html').replace(/^\/+/, '');
    const full = resolve(root, relFile);
    if (full.startsWith(root) && body.before && typeof body.after === 'string' && body.before !== body.after) {
      try {
        const cur = readFileSync(full, 'utf8');
        if (cur.includes(body.before)) {
          writeFileSync(full, cur.replace(body.before, body.after), 'utf8');
          sendJson(res, 200, { ok: true, updatedFile: relFile });
          return true;
        }
      } catch (err) {
        void err;
      }
    }
    sendJson(res, 200, { ok: false, fallbackQuoteOnly: true });
    return true;
  }
  if (subPath === '/uiboard/self-play' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const selfWorkbenchHtml = uibrBuildSelfWorkbenchHtml(root, undefined);
    const report = await runUiAgentSelfPlayCheck(root, { liveUrl: body.liveUrl || null, proposalId: body.proposalId, selfWorkbenchHtml });
    const kind = report.ok ? 'summary' : 'question';
    const tone = report.ok ? 'ok' : 'warn';
    hub.emit({ type: 'dock_item', item: { id: `uiself-${Date.now()}`, kind, tone, title: report.summary } });
    sendJson(res, 200, report);
    return true;
  }
  return false;
}

async function uibrHandleProvisionRoute(req, res, root, hub, readJsonBody, opts) {
  const body = await readJsonBody(req);
  const rep = provisionUiBoardDeps(root, {
    runNpm: body.runNpm === true,
    markInstalledIds: Array.isArray(body.markInstalledIds) ? body.markInstalledIds : undefined
  });
  const toolchain = readUiToolchainStatus(root);
  let subRes = null;
  if (rep.missingCount > 0 && body.spawnSubagent === true && typeof opts.dispatchSubagent === 'function') {
    subRes = await opts.dispatchSubagent({
      sessionId: body.sessionId || null,
      label: '补齐 UI 看板增强套件',
      prompt: rep.agentPrompt
    });
  }
  const basePayload = { ...rep, puckInstalled: toolchain.puckInstalled, toolchain };
  const payload = (rep.missingCount > 0 && body.spawnSubagent === true)
    ? {
        ...basePayload,
        subagentDispatched: Boolean(subRes?.dispatched),
        subagentName: subRes?.name || null,
        fallbackAutoSubmit: !subRes?.dispatched
      }
    : basePayload;
  hub.emit({ type: 'workflow_deps_updated', packId: 'uiboard', report: rep, uiboardToolchain: toolchain });
  hub.emit({ type: 'dock_item', item: { id: `uidep-${Date.now()}`, kind: 'receipt', tone: rep.ready ? 'ok' : 'warn', title: `📦 UI 看板增强套件目录 ${rep.depsDir} 已就绪（待补齐 ${rep.missingCount} 项）` } });
  sendJson(res, 200, payload);
  return true;
}

export async function handleUiBoardSubRoute(req, res, subPath, rootDir, hub, readJsonBody, opts = {}) {
  const root = resolve(rootDir);
  if (await uibrHandleGetRoutes(req, res, subPath, root)) return true;
  if (await uibrHandleDesignAndSelfPlayRoutes(req, res, subPath, root, hub, readJsonBody)) return true;

  if (subPath === '/uiboard/requirements' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = addUiBoardRequirement(root, body);
    sendJson(res, 200, { ...out, uiboard: detectProjectUiEntry(root) });
    return true;
  }

  if (subPath === '/uiboard/convey-to-kanban' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = conveyUiBoardRequirementsToKanban(root, body);
    hub.emit({
      type: 'dock_item',
      item: {
        id: `uigrill-${Date.now()}`,
        kind: 'receipt',
        tone: 'ok',
        targetNodeId: 'host-dom-grill-me',
        title: `📤 已将 ${out.conveyedCount} 条界面需求传达到项目看板「00 grill me · 需求澄清与立约」`
      }
    });
    sendJson(res, 200, { ...out, uiboard: detectProjectUiEntry(root) });
    return true;
  }

  if (subPath === '/uiboard/wire-backend' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const plan = buildBackendWiringPlan(root, { actionIds: body.actionIds, markWired: body.markWired === true });
    hub.emit({ type: 'dock_item', item: { id: `uiwire-${Date.now()}`, kind: 'receipt', tone: 'ok', title: `已更新 ${plan.targetCount} 项 UI 动作契约状态` } });
    sendJson(res, 200, { ...plan, uiboard: detectProjectUiEntry(root) });
    return true;
  }

  if (subPath === '/uiboard/provision' && req.method === 'POST') {
    return uibrHandleProvisionRoute(req, res, root, hub, readJsonBody, opts);
  }
  return false;
}
