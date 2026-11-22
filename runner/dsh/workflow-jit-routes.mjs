// 开发看板节点级即时选配/派生与沉淀宏同源 HTTP 子路由 (/donegate/api/jit/*)
import { buildDashboardPayload } from '../core/dashboard.mjs';
import { executeDeterministicWorkflowRun } from './workflow-runner.mjs';
import {
  assignComponentWorkflow,
  buildJitBootstrapSummary,
  mutateComponentWorkflowJit,
  promoteComponentJitToMacro
} from './workflow-jit.mjs';

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function resolveActorRole(req, body) {
  const hdr = req.headers && (req.headers['x-donegate-role'] || req.headers['X-DoneGate-Role']);
  return String(hdr || body?.actorRole || 'super-agent').trim();
}

function findHostComponentNode(root, nodeId, fallbackNode) {
  if (fallbackNode && fallbackNode.id) return fallbackNode;
  const atlas = buildDashboardPayload(root);
  const hostNodes = atlas?.workbench?.hostSandbox?.nodes || [];
  return hostNodes.find((n) => n.id === nodeId) || null;
}

export async function handleWorkflowJitSubRoute(req, res, cleanPath, root, hub, readJsonBody) {
  if (cleanPath === '/jit/status' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, ...buildJitBootstrapSummary(root) });
    return true;
  }

  if (cleanPath === '/jit/assign' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const actorRole = resolveActorRole(req, body);
    if (Array.isArray(body.nodes) && body.nodes.length > 0) {
      const results = {};
      for (const nd of body.nodes) {
        if (!nd || !nd.id || nd.isSubRepoRef) continue;
        const r = assignComponentWorkflow(root, nd, { actorRole, forceReassign: body.forceReassign === true });
        if (!r.ok) {
          sendJson(res, r.exitCode === 2 ? 403 : 400, r);
          return true;
        }
        results[nd.id] = r.binding;
      }
      const count = Object.keys(results).length;
      hub.emit({ type: 'jit_workflows_batch_assigned', bindings: results });
      hub.emit({
        type: 'dock_item',
        item: { id: `jit-all-${Date.now()}`, kind: 'summary', tone: 'ok', title: `🎯 总控已完成看板 ${count} 个组件的开发流自动选配（优先命中已就绪依赖宏）` }
      });
      sendJson(res, 200, { ok: true, assignedCount: count, bindings: results });
      return true;
    }

    const target = findHostComponentNode(root, body.nodeId, body.node);
    if (!target) {
      sendJson(res, 404, { ok: false, error: `未找到目标开发看板节点：${body.nodeId || ''}` });
      return true;
    }
    const out = assignComponentWorkflow(root, target, {
      actorRole,
      preferredMacroId: body.preferredMacroId || null,
      preferScratchJit: body.preferScratchJit === true,
      pinnedByHuman: actorRole.toLowerCase() === 'human',
      forceReassign: true
    });
    if (!out.ok) {
      sendJson(res, out.exitCode === 2 ? 403 : 400, out);
      return true;
    }
    hub.emit({ type: 'jit_workflow_updated', nodeId: target.id, binding: out.binding });
    hub.emit({
      type: 'dock_item',
      item: { id: `jit-${target.id}`, kind: 'receipt', tone: 'ok', title: `🎯 「${target.title}」已挂载开发流：${out.binding.baseMacroName}（共 ${out.binding.tplIds.length} 个节点）` }
    });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/jit/mutate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const actorRole = resolveActorRole(req, body);
    const target = findHostComponentNode(root, body.nodeId, body.node);
    if (!target) {
      sendJson(res, 404, { ok: false, error: `未找到目标开发看板节点：${body.nodeId || ''}` });
      return true;
    }
    const out = mutateComponentWorkflowJit(root, target, {
      actorRole,
      requirementText: body.requirementText || '',
      addTplIds: body.addTplIds,
      removeTplIds: body.removeTplIds,
      humanApprovedFloorRemoval: body.humanApprovedFloorRemoval === true
    });
    if (!out.ok) {
      hub.emit({
        type: 'dock_item',
        item: {
          id: `jit-lock-${target.id}`,
          kind: out.requiresHumanApproval ? 'question' : 'blocked',
          tone: out.requiresHumanApproval ? 'warn' : 'bad',
          title: out.reason
        }
      });
      sendJson(res, out.exitCode === 2 ? 403 : 409, out);
      return true;
    }
    hub.emit({ type: 'jit_workflow_updated', nodeId: target.id, binding: out.binding });
    hub.emit({
      type: 'dock_item',
      item: {
        id: `jit-mut-${target.id}`,
        kind: 'summary',
        tone: 'ok',
        title: `⚡ 「${target.title}」已按新需求节点派生（+${out.binding.deltaCount} 节点，底座护栏已锁定）`
      }
    });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/jit/approve-floor' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const target = findHostComponentNode(root, body.nodeId, body.node);
    if (!target) {
      sendJson(res, 404, { ok: false, error: `未找到节点：${body.nodeId || ''}` });
      return true;
    }
    const out = mutateComponentWorkflowJit(root, target, {
      actorRole: 'human',
      requirementText: body.requirementText || '人工批准调整底座护栏',
      removeTplIds: Array.isArray(body.removeTplIds) ? body.removeTplIds : [],
      humanApprovedFloorRemoval: true
    });
    if (!out.ok) {
      sendJson(res, 400, out);
      return true;
    }
    hub.emit({ type: 'jit_workflow_updated', nodeId: target.id, binding: out.binding });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/jit/promote-macro' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const actorRole = resolveActorRole(req, body);
    const out = promoteComponentJitToMacro(root, body.nodeId, {
      actorRole,
      macroId: body.macroId,
      name: body.name,
      group: body.group,
      tip: body.tip,
      keywords: body.keywords,
      writeToWorkflowsDir: body.writeToWorkflowsDir !== false
    });
    if (!out.ok) {
      sendJson(res, out.exitCode === 2 ? 403 : 400, out);
      return true;
    }
    hub.emit({ type: 'workflow_pack_saved', packId: out.macroId, filePath: out.filePath, pack: out.macro });
    hub.emit({ type: 'jit_workflow_updated', nodeId: body.nodeId, binding: out.binding });
    hub.emit({
      type: 'dock_item',
      item: { id: `jit-save-${out.macroId}`, kind: 'summary', tone: 'ok', title: `💾 已将节点派生开发流沉淀为全局宏「${out.macro.name}」（${out.filePath || out.macroId}）` }
    });
    sendJson(res, 200, out);
    return true;
  }

  if (cleanPath === '/jit/run-node' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const target = findHostComponentNode(root, body.nodeId, body.node);
    if (!target) {
      sendJson(res, 404, { ok: false, error: `未找到节点：${body.nodeId || ''}` });
      return true;
    }
    const ensured = assignComponentWorkflow(root, target, { actorRole: 'super-agent' });
    if (!ensured.ok) {
      sendJson(res, 400, ensured);
      return true;
    }
    const binding = body.binding?.pack ? body.binding : ensured.binding;
    const ticket = {
      ticketId: body.runId || `jit-run-${target.id}-${Date.now()}`,
      headline: `组件「${target.title}」开发流验收`,
      mandate: { allowedWriteScopes: Array.isArray(target.scopePaths) ? target.scopePaths : [] }
    };
    const runOut = await executeDeterministicWorkflowRun(root, ticket, binding.pack, {
      useFingerprintCache: body.useFingerprintCache !== false,
      enforceDeps: body.enforceDeps !== false
    });
    sendJson(res, 200, { ...runOut, binding });
    return true;
  }

  return false;
}
