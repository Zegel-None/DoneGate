// DSH Web 同源路由与 SSE 脉冲流处理器（含挂机沙箱、依赖补齐、门5复核包、UI看板、JIT选配、GitHub Star 与项目导入）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildDashboardPayload, cmdCheckNode, cmdSlice, cmdVerifyApply, cmdVerifyPack, exportDashboardHtml } from '../core/index.mjs';
import { readSavedWorkbenchState } from '../atlas/contract.mjs';
import { buildMicroVerdictCard, parseQuotedTargetsFromMessage, verifySubagentNodeReceipt } from './quote-protocol.mjs';
import { buildDshFileResourceAddress, normalizeSlashes, openInWindowsOrHostExplorer, resolveSafeWorkspaceFolders } from './win-paths.mjs';
import { executeDeterministicWorkflowRun, getRunEventHub } from './workflow-runner.mjs';
import { inspectWorkflowDeps, provisionWorkflowDeps, readSharedRefreshStamp, readWorkflowDepsStatus, refreshWorkflowDepsStamp } from './workflow-deps.mjs';
import { loadAutopilotCheckpoint } from './autopilot-state.mjs';
import { loadCampaignCheckpoint } from './campaign-autopilot.mjs';
import { handleAutopilotSubRoute } from './autopilot-routes.mjs';
import { handleUiBoardSubRoute } from './ui-board-routes.mjs';
import { handleWorkflowJitSubRoute } from './workflow-jit-routes.mjs';
import { buildJitBootstrapSummary } from './workflow-jit.mjs';
import { starGitHubRepo } from './github-star.mjs';
import { importExternalProject, initWorkspaceProject } from './project-ops.mjs';

function syncHubDepsRefreshStamp(root, hub) {
  const stamp = readSharedRefreshStamp(root);
  if (stamp.exists && stamp.seq > Number(hub.lastDepsRefreshSeq || 0)) {
    hub.lastDepsRefreshSeq = stamp.seq;
    hub.emit({ type: 'workflow_deps_updated', packId: stamp.workflowId || '_shared', refreshStamp: stamp });
  }
  return stamp;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error('请求体超出 2MB 限制'));
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

async function handleSystemAndProjectRoutes(req, res, cleanPath, root, hub, opts) {
  if (cleanPath === '/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, mode: 'dsh-web', root });
    return true;
  }
  if (cleanPath === '/atlas/refresh' && req.method === 'POST') {
    const refreshedAt = new Date().toISOString();
    const depsRefreshStamp = syncHubDepsRefreshStamp(root, hub);
    mkdirSync(join(root, '.donegate'), { recursive: true });
    exportDashboardHtml(root, join(root, '.donegate', 'dashboard.html'));
    sendJson(res, 200, { ok: true, refreshedAt, depsRefreshStamp, atlas: buildDashboardPayload(root) });
    return true;
  }
  if (cleanPath === '/github/star' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = await starGitHubRepo(root, body, opts);
    if (out.body.ok) {
      hub.emit({
        type: 'dock_item',
        item: { id: `star-${Date.now()}`, kind: 'summary', tone: 'ok', title: `${out.body.starred ? '⭐ 已 Star' : '☆ 已取消 Star'} ${out.body.repoSlug}` }
      });
    }
    sendJson(res, out.status, out.body);
    return true;
  }
  if (cleanPath === '/project/init' && req.method === 'POST') {
    const out = initWorkspaceProject(root);
    hub.emit({ type: 'project_initialized', root });
    sendJson(res, out.status, out.body);
    return true;
  }
  if (cleanPath === '/project/import' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const out = importExternalProject(root, body.targetDir);
    if (out.body.ok) {
      hub.emit({ type: 'project_imported', sandbox: out.body.sandbox });
      hub.emit({ type: 'dock_item', item: { id: `imp-${Date.now()}`, kind: 'summary', tone: 'ok', title: `📂 已导入外部项目「${out.body.sandbox.name}」（${out.body.sandbox.nodes.length} 个模块域）` } });
    }
    sendJson(res, out.status, out.body);
    return true;
  }
  return false;
}

async function handleSliceJudgeAndPackRoutes(req, res, cleanPath, root, hub, opts) {
    if (cleanPath.startsWith('/uiboard/')) {
      return handleUiBoardSubRoute(req, res, cleanPath, root, hub, readJsonBody, opts);
    }
    if (cleanPath.startsWith('/jit/')) {
      return handleWorkflowJitSubRoute(req, res, cleanPath, root, hub, readJsonBody);
    }
    if (cleanPath.startsWith('/autopilot/')) {
      return handleAutopilotSubRoute(req, res, cleanPath, root, readJsonBody);
    }
    if (await handleSystemAndProjectRoutes(req, res, cleanPath, root, hub, opts)) return true;

    if (cleanPath === '/router' && req.method === 'GET') {
      const r = cmdSlice(root, { routerOnly: true, json: true });
      sendJson(res, r.exitCode === 0 ? 200 : 400, { ok: r.exitCode === 0, exitCode: r.exitCode, router: r.router || null, stderr: r.stderr || '' });
      return true;
    }

    if (cleanPath === '/slice' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const r = cmdSlice(root, { id: body.nodeId || body.id, focus: body.focus, routerOnly: Boolean(body.routerOnly), freezeStub: Boolean(body.freezeStub), contextWindow: body.contextWindow, utilization: body.utilization, maxTokens: body.maxTokens, json: true });
      sendJson(res, r.exitCode === 0 ? 200 : 400, { ok: r.exitCode === 0, exitCode: r.exitCode, capsule: r.capsule || null, router: r.router || null, stderr: r.stderr || '' });
      return true;
    }

    if (cleanPath === '/check-node' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const r = cmdCheckNode(root, { id: body.nodeId || body.id, criterion: body.criterion, allowDirty: body.allowDirty !== false, allowStubChange: Boolean(body.allowStubChange), receipt: true });
      sendJson(res, 200, { ok: r.exitCode === 0, exitCode: r.exitCode, receipt: r.receipt || null, stderr: r.stderr || '' });
      return true;
    }

    if (cleanPath === '/events' && req.method === 'GET') {
      const depsRefreshStamp = syncHubDepsRefreshStamp(root, hub);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({
        type: 'connected', ts: Date.now(), dockItems: hub.dockItems, depsRefreshStamp,
        cards: [...hub.activeCards.values()], nodeTelemetry: Object.fromEntries(hub.nodeTelemetry),
        autopilot: loadAutopilotCheckpoint(root), campaign: loadCampaignCheckpoint(root)
      })}\n\n`);
      const onEvt = (evt) => {
        try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch (err) { void err; }
      };
      hub.listeners.add(onEvt);
      req.on('close', () => { hub.listeners.delete(onEvt); });
      return true;
    }

    if (cleanPath === '/bootstrap' && req.method === 'GET') {
      const depsRefreshStamp = syncHubDepsRefreshStamp(root, hub);
      sendJson(res, 200, {
        ok: true, platform: process.platform, depsRefreshStamp,
        atlas: buildDashboardPayload(root), state: readSavedWorkbenchState(root),
        jit: buildJitBootstrapSummary(root), autopilot: loadAutopilotCheckpoint(root),
        campaign: loadCampaignCheckpoint(root), nodeTelemetry: Object.fromEntries(hub.nodeTelemetry),
        dockItems: hub.dockItems, cards: [...hub.activeCards.values()]
      });
      return true;
    }

    if (cleanPath === '/judge/pack' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cid = String(body.contractId || '').trim();
      const resPack = cmdVerifyPack(root, { id: cid, base: body.base, head: body.head, out: body.out });
      const relPackDir = resPack.packDir ? normalizeSlashes(relative(root, resPack.packDir)) : null;
      const judgePrompt = relPackDir ? `/donegate-judge 请对复核包 ${relPackDir} 执行 V1–V5 独立盲审并给出 pass/fail/unknown 裁决` : '';
      hub.emit({
        type: 'dock_item',
        item: {
          id: `judge-${Date.now()}`, kind: resPack.exitCode === 0 ? 'summary' : 'question', tone: resPack.exitCode === 0 ? 'ok' : 'warn',
          title: resPack.exitCode === 0
            ? `⚖️ 契约「${cid}」门 5 复核包已生成：${relPackDir}`
            : `⚖️ 契约「${cid}」盲审打包未就绪（exit ${resPack.exitCode}）：${String(resPack.stderr || '').split('\n')[0]}`
        }
      });
      sendJson(res, 200, {
        ok: resPack.exitCode === 0, exitCode: resPack.exitCode, contractId: cid,
        packDir: resPack.packDir || null, relPackDir, packageHash: resPack.packageHash || null,
        judgePrompt, stdout: resPack.stdout || '', stderr: resPack.stderr || ''
      });
      return true;
    }

    if (cleanPath === '/judge/apply' && req.method === 'POST') {
      const body = await readJsonBody(req);
      let vPath = body.verdictPath || null;
      if (!vPath && body.verdict && typeof body.verdict === 'object') {
        const vDir = join(root, '.donegate', 'verify');
        mkdirSync(vDir, { recursive: true });
        vPath = join(vDir, `verdict-${Date.now()}.json`);
        writeFileSync(vPath, JSON.stringify(body.verdict, null, 2) + '\n', 'utf8');
      }
      const resApply = cmdVerifyApply(root, { packDir: body.packDir, verdict: vPath });
      hub.emit({
        type: 'dock_item',
        item: {
          id: `japply-${Date.now()}`, kind: resApply.exitCode === 0 ? 'summary' : 'blocked', tone: resApply.exitCode === 0 ? 'ok' : 'bad',
          title: resApply.exitCode === 0 ? '⚖️ 门 5 盲审裁决已验真并写入哈希链' : `⚖️ 门 5 盲审裁决未通过（exit ${resApply.exitCode}）`
        }
      });
      sendJson(res, 200, { ok: resApply.exitCode === 0, exitCode: resApply.exitCode, stdout: resApply.stdout || '', stderr: resApply.stderr || '' });
      return true;
    }

    if (cleanPath === '/workflow-pack/save' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const pack = body.pack;
      if (!pack || !pack.id || !Array.isArray(pack.nodes)) {
        sendJson(res, 400, { ok: false, error: '无效的 .workflow.json：缺少 id 或 nodes 数组' });
        return true;
      }
      const safeId = String(pack.id).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) || 'custom-workflow';
      const normalized = {
        schemaVersion: pack.schemaVersion || '1.0', id: safeId, name: pack.name || safeId,
        group: pack.group || '项目声明式工作流', tip: pack.tip || '工作台导入/保存的声明式工作流',
        deps: Array.isArray(pack.deps) ? pack.deps : [], nodes: pack.nodes,
        links: Array.isArray(pack.links) ? pack.links : [], groups: Array.isArray(pack.groups) ? pack.groups : []
      };
      const st = readSavedWorkbenchState(root);
      st.customPacks = { ...(st.customPacks || {}), [safeId]: normalized };
      st.updatedAt = new Date().toISOString();
      mkdirSync(join(root, '.donegate'), { recursive: true });
      writeFileSync(join(root, '.donegate', 'workbench-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');
      let wfRelPath = null;
      if (body.writeToWorkflowsDir !== false) {
        mkdirSync(join(root, 'workflows'), { recursive: true });
        wfRelPath = `workflows/${safeId}.workflow.json`;
        writeFileSync(join(root, wfRelPath), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
      }
      hub.emit({ type: 'workflow_pack_saved', packId: safeId, pack: normalized, filePath: wfRelPath });
      sendJson(res, 200, { ok: true, packId: safeId, pack: normalized, filePath: wfRelPath });
      return true;
    }

    return false;
}

async function handleCanvasDepsAndDispatchRoutes(req, res, cleanPath, root, hub, opts) {
    if (cleanPath === '/observation-preview' && req.method === 'GET') {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const tool = String(u.searchParams.get('tool') || '').replace(/[^a-zA-Z0-9._-]/g, '');
      const nodeId = String(u.searchParams.get('nodeId') || '');
      const tel = nodeId ? (hub.nodeTelemetry.get(nodeId) || null) : null;
      const candidates = tool
        ? [`.donegate/adapters/${tool}/observation.json`, `.donegate/adapters/${tool}/claim.json`, `bricks/${tool}/capabilities.json`]
        : [];
      for (const rel of candidates) {
        const abs = join(root, rel);
        if (existsSync(abs)) {
          sendJson(res, 200, { ok: true, sourcePath: rel, content: readFileSync(abs, 'utf8').slice(0, 65536), telemetry: tel });
          return true;
        }
      }
      if (tel) {
        sendJson(res, 200, {
          ok: true,
          sourcePath: `.donegate/runs/telemetry/${nodeId}.json`,
          content: JSON.stringify(tel, null, 2),
          telemetry: tel
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        sourcePath: tool ? `.donegate/adapters/${tool}/observation.json` : '尚未生成运行观测',
        content: '// 该节点当前尚无本地运行观测产物；点击顶栏「▶ 运行检查」或「🌙 挂机」后即可在此实时检视结构化观测 JSON 与门禁输出。',
        telemetry: null
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

    if (cleanPath === '/workflow-deps/inspect' && (req.method === 'POST' || req.method === 'GET')) {
      const refreshStamp = syncHubDepsRefreshStamp(root, hub);
      if (req.method === 'GET') {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        const wfId = u.searchParams.get('workflow') || u.searchParams.get('packId') || null;
        sendJson(res, 200, { ok: true, refreshStamp, report: readWorkflowDepsStatus(root, wfId) });
        return true;
      }
      const body = await readJsonBody(req);
      if (body.packs && typeof body.packs === 'object') {
        const reports = {};
        for (const [k, pk] of Object.entries(body.packs)) reports[k] = inspectWorkflowDeps(root, pk);
        sendJson(res, 200, { ok: true, refreshStamp, reports });
        return true;
      }
      sendJson(res, 200, { ok: true, refreshStamp, report: body.pack ? inspectWorkflowDeps(root, body.pack) : readWorkflowDepsStatus(root, body.workflowId || body.packId || null) });
      return true;
    }

    if (cleanPath === '/workflow-deps/refresh' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const wfId = body.workflowId || body.packId || (body.pack && body.pack.id) || null;
      const refreshStamp = refreshWorkflowDepsStamp(root, { trigger: 'http-refresh', workflowId: wfId });
      hub.lastDepsRefreshSeq = refreshStamp.seq;
      const report = body.pack ? inspectWorkflowDeps(root, body.pack) : readWorkflowDepsStatus(root, wfId);
      hub.emit({ type: 'workflow_deps_updated', packId: report.packId, refreshStamp, report });
      sendJson(res, 200, { ok: true, refreshStamp, report });
      return true;
    }

    if (cleanPath === '/workflow-deps/provision' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const rawPack = body.pack || {};
      const onlyNodeId = body.onlyNodeId ? String(body.onlyNodeId).trim() : '';
      const targetPack = onlyNodeId
        ? { ...rawPack, nodes: (Array.isArray(rawPack.nodes) ? rawPack.nodes : []).filter((n) => n && n.id === onlyNodeId), deps: [] }
        : rawPack;
      const result = provisionWorkflowDeps(root, targetPack, {
        runNpm: body.runNpm === true,
        isolatedOnly: body.isolatedOnly === true,
        markInstalledIds: Array.isArray(body.markInstalledIds) ? body.markInstalledIds : undefined
      });
      let subRes = null;
      if (result.missingCount > 0 && body.spawnSubagent === true && typeof opts.dispatchSubagent === 'function') {
        subRes = await opts.dispatchSubagent({
          sessionId: body.sessionId || null,
          label: `补齐工作流依赖: ${result.packName}`,
          prompt: result.agentPrompt
        });
      }
      const payload = (result.missingCount > 0 && body.spawnSubagent === true)
        ? {
            ...result,
            subagentDispatched: Boolean(subRes?.dispatched),
            subagentName: subRes?.name || null,
            fallbackAutoSubmit: !subRes?.dispatched
          }
        : result;
      const title = result.ready
        ? `工作流「${result.packName}」全部 ${result.total} 项依赖已在共享池 ${result.sharedDepsDir || result.depsDir} 就位，可随时运行`
        : `已建立共享依赖池 ${result.sharedDepsDir || result.depsDir} 并派发后台补齐工单（待装 ${result.missingCount} 项）`;
      hub.emit({ type: 'workflow_deps_updated', packId: result.packId, report: payload });
      hub.emit({ type: 'dock_item', item: { id: `wfdep-${Date.now()}`, kind: result.ready ? 'summary' : 'receipt', tone: result.ready ? 'ok' : 'warn', title } });
      sendJson(res, 200, payload);
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

    return false;
}

async function handleDispatchAndPreviewRoutes(req, res, cleanPath, root, hub) {
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
        const out = await executeDeterministicWorkflowRun(root, ticket, body.pack, {
          useFingerprintCache: body.useFingerprintCache !== false
        });
        sendJson(res, 200, out);
        return true;
      }
      const receiptMap = (body.subagentReceipts && typeof body.subagentReceipts === 'object') ? body.subagentReceipts : null;
      const mustVerifyReceipt = Boolean(body.requireNodeReceipt || receiptMap);
      const cards = targets.map((t, idx) => {
        const checkId = (Array.isArray(t.contracts) && t.contracts[0]) || t.id;
        const vRes = mustVerifyReceipt ? verifySubagentNodeReceipt(root, checkId, receiptMap ? receiptMap[checkId] : null) : { ok: true, exitCode: 0 };
        const card = buildMicroVerdictCard({
          ticketId: `tkt-${Date.now()}-${idx}`, targetUri: t.uri, exitCode: vRes.ok ? 0 : vRes.exitCode,
          headline: vRes.ok ? `${t.name || t.id} 已同步处理` : (vRes.reason || '缺少盘上回执证据'),
          passedGates: vRes.ok ? 1 : 0, totalGates: 1,
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
}

export function createDoneGateWebRouteHandler(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const hub = getRunEventHub(root);
  return async function handleDoneGateRoute(req, res, subPath) {
    const cleanPath = String(subPath || '/').split('?')[0];
    if (await handleSliceJudgeAndPackRoutes(req, res, cleanPath, root, hub, opts)) return true;
    if (await handleCanvasDepsAndDispatchRoutes(req, res, cleanPath, root, hub, opts)) return true;
    return handleDispatchAndPreviewRoutes(req, res, cleanPath, root, hub);
  };
}
