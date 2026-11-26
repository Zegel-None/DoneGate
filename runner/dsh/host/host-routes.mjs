// DSH Web 同源路由与 SSE 脉冲流处理器（含挂机沙箱、依赖补齐、门5复核包、UI看板、JIT选配、GitHub Star 与项目导入）
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardPayload, exportDashboardHtml } from '../../atlas/dashboard.mjs';
import { cmdCheckNode, cmdSlice, cmdVerifyApply, cmdVerifyPack } from '../../core/index.mjs';
import { readSavedWorkbenchState } from '../../shared/workbench-state.mjs';
import { buildMicroVerdictCard, parseQuotedTargetsFromMessage, verifySubagentNodeReceipt } from '../autopilot/index.mjs';
import { buildDshFileResourceAddress, normalizeSlashes, openInWindowsOrHostExplorer, resolveSafeWorkspaceFolders } from '../deps/index.mjs';
import { executeDeterministicWorkflowRun, getRunEventHub } from '../autopilot/index.mjs';
import {
  inspectAllKnownWorkflowPacks, inspectWorkflowDeps, provisionWorkflowDeps,
  readSharedRefreshStamp, readWorkflowDepsStatus, reconcileSharedPoolOnRefresh, writeStandaloneDepsCli
} from '../deps/workflow-deps.mjs';
export { writeStandaloneDepsCli };
import { loadAutopilotCheckpoint } from '../autopilot/index.mjs';
import { loadCampaignCheckpoint } from '../autopilot/index.mjs';
import { handleAutopilotSubRoute } from './autopilot-routes.mjs';
import { handleGovernanceSubRoute } from './governance-routes.mjs';
import { readUiToolchainStatus } from '../uiboard/index.mjs';
import { handleUiBoardSubRoute } from './ui-board-routes.mjs';
import { handleWorkflowJitSubRoute } from './workflow-jit-routes.mjs';
import { buildJitBootstrapSummary } from '../autopilot/index.mjs';
import { starGitHubRepo } from './github-star.mjs';
import { importExternalProject, initWorkspaceProject } from './project-ops.mjs';
import { SUBAGENT_HUMAN_ISOLATION_MSG, installSubagentHumanIsolationGuard } from './subagent-isolation.mjs';
import { sendJson } from './http-utils.mjs';
import {
  hagCreateControlPlaneGuard,
  hagInjectSessionTokenHtml,
  hagIsSafeId,
  hagSanitizeHttpWorkflowPack,
  hagSanitizeId,
  hagSanitizeSubagentEnv,
  hagValidateControlPlaneRequest
} from './host-auth-guard.mjs';
export { SUBAGENT_HUMAN_ISOLATION_MSG, installSubagentHumanIsolationGuard, hagSanitizeSubagentEnv };

const DONEGATE_INSTALL_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const HR_OBS_TOOL_ALIASES = {
  'stryker-js': 'stryker',
  'dependency-cruiser': 'depcruise',
  'gitleaks-secrets': 'gitleaks',
  'gitleaks-scan': 'gitleaks',
  'biome-knip': 'biome',
  'osv-vuln': 'osv-scanner'
};

const HR_OBS_HUMAN_META = {
  gitleaks: ['密钥密码防泄漏', '扫描代码与提交历史，拦截误写进仓库的 API 密钥、私钥与数据库口令。'],
  stryker: ['防假绿破坏性抽检', '故意制造细微代码变异，检验现有测试能否真正抓出错误而非空跑假绿。'],
  codegraph: ['循环引用与波及范围', '分析模块静态引用关系，拦截死循环依赖并列出改动波及的下游模块。'],
  'osv-scanner': ['第三方依赖漏洞排查', '扫描依赖锁文件清单，排查高危与严重已知开源安全漏洞。'],
  depcruise: ['模块跨层乱引拦截', '核验项目目录分层边界，拦截违规跨目录反向引用。'],
  beads: ['任务先后顺序排期', '检查待办任务前置依赖是否无死锁，生成可直接施工的任务顺序。'],
  'fuck-u-code': ['代码臃肿复杂度体检', '统计源码函数嵌套深度与复杂度得分，定位臃肿难维护文件。'],
  jscpd: ['重复粘贴代码排查', '检测大段复制粘贴重复代码块，提示可提取公共函数的位置。'],
  openspec: ['需求规格完整度审校', '在动工前检查需求方案草稿是否存在遗漏或前后冲突。'],
  srclight: ['已有代码索引盘点', '核对项目公共函数索引是否同步最新，避免重复造轮子。'],
  knip: ['废文件与幽灵依赖清理', '排查未声明的幽灵依赖以及无人引用的闲置文件与导出。'],
  'dotenv-linter': ['环境变量配置检查', '检查环境变量配置文件格式、拼写重复键及示例配置一致性。'],
  playwright: ['网页真机点击联调', '启动真实无头浏览器执行关键页面点击流程并捕获控制台报错。'],
  maestro: ['安卓界面交互验收', '驱动移动端模拟器执行核心界面交互流程并捕获闪退步骤。'],
  schemathesis: ['接口异常输入压测', '根据接口文档自动构造边界与异常参数，检验服务端是否零内部崩溃。'],
  trivy: ['容器与部署配置体检', '排查容器镜像漏洞、权限过大与部署配置错漏。'],
  biome: ['代码语法快速检查', '快速扫描前端与脚本源码语法错误及可疑坏味道写法。'],
  'ast-grep': ['危险代码写法扫描', '按语法结构精准匹配并拦截项目禁用的危险代码模式。'],
  ruff: ['后端语法快速检查', '快速检查 Python 源码语法错误、未定义变量与代码规范问题。'],
  pyright: ['跨文件类型核对', '执行跨文件静态类型推导与参数返回类型一致性核验。'],
  typos: ['英文拼写防手滑检查', '扫描代码标识符与文档中的常见英文拼写手误。'],
  actionlint: ['流水线配置语法检查', '静态校验自动化部署流水线配置语法与上下文变量合法性。']
};

function syncHubDepsRefreshStamp(root, hub) {
  const stamp = readSharedRefreshStamp(root);
  if (stamp.exists && stamp.seq > Number(hub.lastDepsRefreshSeq || 0)) {
    hub.lastDepsRefreshSeq = stamp.seq;
    const allDeps = inspectAllKnownWorkflowPacks(root);
    const uiboardToolchain = readUiToolchainStatus(root);
    hub.emit({
      type: 'workflow_deps_updated',
      packId: stamp.workflowId || '_shared',
      refreshStamp: stamp,
      sharedPool: allDeps.sharedPool,
      reports: allDeps.reports,
      uiboardToolchain
    });
  }
  return stamp;
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error('请求体超出 2MB 限制');
        err.statusCode = 413;
        rejectBody(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const txt = Buffer.concat(chunks).toString('utf8').trim();
      if (!txt) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(txt));
      } catch (e) {
        const err = new Error(`请求体 JSON 格式无效：${e.message}`);
        err.statusCode = 400;
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

async function handleSystemAndProjectRoutes(req, res, cleanPath, root, hub, opts) {
  if (cleanPath === '/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, mode: 'dsh-web', root });
    return true;
  }
  if ((cleanPath === '/atlas/refresh' && req.method === 'POST') || (cleanPath === '/rescan' && (req.method === 'POST' || req.method === 'GET'))) {
    const refreshedAt = new Date().toISOString();
    const rec = reconcileSharedPoolOnRefresh(root, null, { trigger: 'atlas-refresh' });
    hub.lastDepsRefreshSeq = rec.refreshStamp.seq;
    const allDeps = inspectAllKnownWorkflowPacks(root);
    const uiboardToolchain = readUiToolchainStatus(root);
    hub.emit({
      type: 'workflow_deps_updated',
      packId: '_shared',
      refreshStamp: rec.refreshStamp,
      sharedPool: allDeps.sharedPool,
      reports: allDeps.reports,
      uiboardToolchain
    });
    mkdirSync(join(root, '.donegate'), { recursive: true });
    exportDashboardHtml(root, join(root, '.donegate', 'dashboard.html'));
    sendJson(res, 200, {
      ok: true, refreshedAt, depsRefreshStamp: rec.refreshStamp,
      sharedPool: allDeps.sharedPool, packDepReports: allDeps.reports, uiboardToolchain,
      atlas: buildDashboardPayload(root)
    });
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

async function hrHandleCoreSliceRoutes(req, res, cleanPath, root) {
  if (cleanPath === '/router' && req.method === 'GET') {
    const r = cmdSlice(root, { routerOnly: true, json: true });
    sendJson(res, r.exitCode === 0 ? 200 : 400, {
      ok: r.exitCode === 0, exitCode: r.exitCode, router: r.router || null, stderr: r.stderr || ''
    });
    return true;
  }
  if (cleanPath === '/slice' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const r = cmdSlice(root, {
      id: body.nodeId || body.id,
      focus: body.focus,
      routerOnly: Boolean(body.routerOnly),
      freezeStub: Boolean(body.freezeStub),
      contextWindow: body.contextWindow,
      utilization: body.utilization,
      maxTokens: body.maxTokens,
      json: true
    });
    sendJson(res, r.exitCode === 0 ? 200 : 400, {
      ok: r.exitCode === 0, exitCode: r.exitCode, capsule: r.capsule || null, router: r.router || null, stderr: r.stderr || ''
    });
    return true;
  }
  return false;
}

async function hrHandleCheckNodeRoute(req, res, cleanPath, root) {
  if (cleanPath !== '/check-node' || req.method !== 'POST') return false;
  const body = await readJsonBody(req);
  const r = cmdCheckNode(root, {
    id: body.nodeId || body.id,
    criterion: body.criterion,
    allowDirty: body.allowDirty !== false,
    allowStubChange: Boolean(body.allowStubChange),
    receipt: true
  });
  sendJson(res, 200, { ok: r.exitCode === 0, exitCode: r.exitCode, receipt: r.receipt || null, stderr: r.stderr || '' });
  return true;
}

function hrHandleEventAndBootstrapRoutes(req, res, cleanPath, root, hub) {
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
    const cleanup = () => { hub.listeners.delete(onEvt); };
    const onEvt = (evt) => {
      try {
        if (res.writableEnded || res.destroyed) {
          cleanup();
          return;
        }
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch (err) {
        void err;
        cleanup();
      }
    };
    hub.listeners.add(onEvt);
    if (typeof res.on === 'function') {
      res.on('close', cleanup);
      res.on('error', cleanup);
    } else if (typeof req.on === 'function') {
      req.on('close', cleanup);
    }
    return true;
  }
  if (cleanPath === '/bootstrap' && req.method === 'GET') {
    const depsRefreshStamp = syncHubDepsRefreshStamp(root, hub);
    const allDeps = inspectAllKnownWorkflowPacks(root);
    sendJson(res, 200, {
      ok: true, platform: process.platform, depsRefreshStamp,
      sharedPool: allDeps.sharedPool, packDepReports: allDeps.reports, uiboardToolchain: readUiToolchainStatus(root),
      atlas: buildDashboardPayload(root), state: readSavedWorkbenchState(root),
      jit: buildJitBootstrapSummary(root), autopilot: loadAutopilotCheckpoint(root),
      campaign: loadCampaignCheckpoint(root), nodeTelemetry: Object.fromEntries(hub.nodeTelemetry),
      dockItems: hub.dockItems, cards: [...hub.activeCards.values()]
    });
    return true;
  }
  return false;
}

function hrResolveSafeVerifyOut(root, rawOut) {
  if (rawOut === undefined || rawOut === null || String(rawOut).trim() === '') {
    return { ok: true, safeOut: undefined };
  }
  const verifyBase = resolve(root, '.donegate', 'verify');
  const candOut = resolve(root, String(rawOut).trim());
  const rawRel = relative(verifyBase, candOut);
  const relOut = normalizeSlashes(rawRel);
  if (!relOut || isAbsolute(rawRel) || relOut.startsWith('..') || /^[A-Za-z]:/.test(relOut)) {
    return { ok: false, safeOut: undefined };
  }
  return { ok: true, safeOut: candOut };
}

async function hrHandleJudgePackRoute(req, res, root, hub) {
  const body = await readJsonBody(req);
  const cid = String(body.contractId || '').trim();
  if (!hagIsSafeId(cid)) {
    sendJson(res, 400, { ok: false, error: '非法的 contractId 参数' });
    return true;
  }
  const outCheck = hrResolveSafeVerifyOut(root, body.out);
  if (!outCheck.ok) {
    sendJson(res, 400, { ok: false, error: '安全限制：judge/pack 输出目录仅允许位于 .donegate/verify/ 子目录内' });
    return true;
  }
  const resPack = cmdVerifyPack(root, { id: cid, base: body.base, head: body.head, out: outCheck.safeOut });
  const relPackDir = resPack.packDir ? normalizeSlashes(relative(root, resPack.packDir)) : null;
  const judgePrompt = relPackDir ? `/donegate-judge 请对复核包 ${relPackDir} 执行 V1–V5 独立盲审并给出 pass/fail/unknown 裁决` : '';
  const packOk = resPack.exitCode === 0;
  const packTitle = packOk
    ? `⚖️ 契约「${cid}」门 5 复核包已生成：${relPackDir}`
    : `⚖️ 契约「${cid}」盲审打包未就绪（exit ${resPack.exitCode}）：${String(resPack.stderr || '').split('\n')[0]}`;
  hub.emit({
    type: 'dock_item',
    item: { id: `judge-${Date.now()}`, kind: packOk ? 'summary' : 'question', tone: packOk ? 'ok' : 'warn', title: packTitle }
  });
  sendJson(res, 200, {
    ok: packOk, exitCode: resPack.exitCode, contractId: cid,
    packDir: resPack.packDir || null, relPackDir, packageHash: resPack.packageHash || null,
    judgePrompt, stdout: resPack.stdout || '', stderr: resPack.stderr || ''
  });
  return true;
}

async function hrHandleJudgeApplyRoute(req, res, root, hub) {
  const body = await readJsonBody(req);
  let vPath = body.verdictPath || null;
  if (!vPath && body.verdict && typeof body.verdict === 'object') {
    const vDir = join(root, '.donegate', 'verify');
    mkdirSync(vDir, { recursive: true });
    vPath = join(vDir, `verdict-${Date.now()}.json`);
    writeFileSync(vPath, JSON.stringify(body.verdict, null, 2) + '\n', 'utf8');
  }
  const resApply = cmdVerifyApply(root, { packDir: body.packDir, verdict: vPath });
  const applyOk = resApply.exitCode === 0;
  hub.emit({
    type: 'dock_item',
    item: {
      id: `japply-${Date.now()}`,
      kind: applyOk ? 'summary' : 'blocked',
      tone: applyOk ? 'ok' : 'bad',
      title: applyOk ? '⚖️ 门 5 盲审裁决已验真并写入哈希链' : `⚖️ 门 5 盲审裁决未通过（exit ${resApply.exitCode}）`
    }
  });
  sendJson(res, 200, { ok: applyOk, exitCode: resApply.exitCode, stdout: resApply.stdout || '', stderr: resApply.stderr || '' });
  return true;
}

async function hrHandleJudgeRoutes(req, res, cleanPath, root, hub) {
  if (cleanPath === '/judge/pack' && req.method === 'POST') {
    return hrHandleJudgePackRoute(req, res, root, hub);
  }
  if (cleanPath === '/judge/apply' && req.method === 'POST') {
    return hrHandleJudgeApplyRoute(req, res, root, hub);
  }
  return false;
}

async function hrHandleWorkflowPackSaveRoute(req, res, cleanPath, root, hub) {
  if (cleanPath !== '/workflow-pack/save' || req.method !== 'POST') return false;
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
  if (cleanPath.startsWith('/governance/')) {
    return handleGovernanceSubRoute(req, res, cleanPath, root, hub, readJsonBody);
  }
  if (await handleSystemAndProjectRoutes(req, res, cleanPath, root, hub, opts)) return true;
  if (await hrHandleCoreSliceRoutes(req, res, cleanPath, root)) return true;
  if (await hrHandleCheckNodeRoute(req, res, cleanPath, root)) return true;
  if (hrHandleEventAndBootstrapRoutes(req, res, cleanPath, root, hub)) return true;
  if (await hrHandleJudgeRoutes(req, res, cleanPath, root, hub)) return true;
  return hrHandleWorkflowPackSaveRoute(req, res, cleanPath, root, hub);
}

function hrObsReadFileMaybe(absPath) {
  if (!existsSync(absPath)) return '';
  try {
    return readFileSync(absPath, 'utf8');
  } catch (err) {
    void err;
    return '';
  }
}

function hrObsParseJsonMaybe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    void err;
    return null;
  }
}

function hrObsEntryMatchesQuery(adp, capDoc, q, canon) {
  const toolLower = String(adp.tool || '').toLowerCase();
  const idBase = String(adp.id || '').split('@')[0].toLowerCase();
  const entryStem = basename(String(adp.entry || ''), '.mjs').toLowerCase();
  if (toolLower === canon || idBase === canon || entryStem === canon) return true;
  if (q && (toolLower.startsWith(`${q}-`) || q.startsWith(`${toolLower}-`))) return true;
  const repoTail = String(capDoc?.upstream?.repo || '').split('/').pop().toLowerCase();
  const binName = String(capDoc?.cli?.bin || capDoc?.install?.bin || '').toLowerCase();
  return Boolean(q && (repoTail === q || binName === q));
}

function hrObsMatchInstallAdapter(rawTool) {
  const q = String(rawTool || '').trim().toLowerCase().replace(/^tpl-(?:adp-)?/, '');
  const canon = HR_OBS_TOOL_ALIASES[q] || q;
  if (canon === 'anti-slop') {
    const entryRelPath = 'skill/check-commit-hygiene.mjs';
    return {
      toolKey: 'anti-slop', entryStem: 'check-commit-hygiene',
      title: '防 AI 手搓护栏套件',
      summary: '内置四维提交卫生与代码质量护栏：自动拦截空 catch、越界私引、超限复杂度与压行写法。',
      blindSpots: [], capRelPath: '', capText: '',
      entryRelPath, entryText: hrObsReadFileMaybe(join(DONEGATE_INSTALL_ROOT, entryRelPath)).slice(0, 24000)
    };
  }
  const regDoc = hrObsParseJsonMaybe(hrObsReadFileMaybe(join(DONEGATE_INSTALL_ROOT, 'adapters.registry.json')));
  for (const adp of (regDoc?.adapters || [])) {
    const capRelPath = `bricks/${adp.tool}/capabilities.json`;
    const capText = hrObsReadFileMaybe(join(DONEGATE_INSTALL_ROOT, capRelPath));
    const capDoc = hrObsParseJsonMaybe(capText);
    if (!hrObsEntryMatchesQuery(adp, capDoc, q, canon)) continue;
    const entryRelPath = adp.entry || `skill/adapters/${adp.tool}.mjs`;
    const entryText = hrObsReadFileMaybe(join(DONEGATE_INSTALL_ROOT, entryRelPath));
    const hm = HR_OBS_HUMAN_META[adp.tool] || null;
    return {
      toolKey: adp.tool,
      entryStem: basename(entryRelPath, '.mjs'),
      title: capDoc?.card?.title || hm?.[0] || `${adp.tool} 检查节点`,
      summary: capDoc?.card?.summary || hm?.[1] || '按注册表规范执行客观工具检查并生成结构化报告。',
      blindSpots: Array.isArray(adp.blindSpots) ? adp.blindSpots : [],
      capRelPath: capText ? capRelPath : '',
      capText,
      entryRelPath: entryText ? entryRelPath : '',
      entryText: entryText.slice(0, 24000)
    };
  }
  const fallbackHm = HR_OBS_HUMAN_META[canon] || null;
  return {
    toolKey: canon || 'node', entryStem: canon || 'node',
    title: fallbackHm?.[0] || (canon ? `${canon} 检查节点` : '工作流检查节点'),
    summary: fallbackHm?.[1] || '执行该工作流节点的规则校验并记录结构化检查结果。',
    blindSpots: [], capRelPath: '', capText: '', entryRelPath: '', entryText: ''
  };
}

function hrObsFindExistingWorkspaceReport(root, rawTool, spec) {
  const keys = [...new Set([rawTool, spec.toolKey, spec.entryStem]
    .map((x) => String(x || '').replace(/[^a-zA-Z0-9._-]/g, ''))
    .filter((k) => Boolean(k) && k !== '.' && k !== '..' && !k.includes('..')))];
  for (const k of keys) {
    for (const file of ['observation.json', 'claim.json']) {
      const rel = `.donegate/adapters/${k}/${file}`;
      const abs = join(root, rel);
      if (existsSync(abs)) return { sourcePath: rel, content: readFileSync(abs, 'utf8').slice(0, 65536) };
    }
  }
  return null;
}

function hrObsBuildFallbackRecordMd(root, rawTool, nodeId, tel, spec) {
  const rawKey = spec.toolKey || rawTool || nodeId || 'node';
  const safeKey = String(rawKey).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.\.+/g, '-').replace(/^-+|-+$/g, '') || 'node';
  const relPreview = `.donegate/previews/${safeKey}-record.md`;

  const lines = [
    `# ${spec.title} · 检查记录`,
    '',
    '## 这个节点是做什么的',
    spec.summary,
    ...spec.blindSpots.map((b) => `- 检查边界说明：${b}`),
    '',
    '## 当前项目的检查状态',
    `- 当前尚未在本项目中运行过「${spec.title}」，因此暂未生成 \`.donegate/adapters/${spec.toolKey}/observation.json\` 正式检查报告。`,
    '- 点击工作台顶栏「▶ 运行检查」或开启「🌙 挂机」执行后，系统会自动在此处展示最近一次真实检查报告。'
  ];
  if (tel) lines.push('', '### 最近一次运行遥测摘要', '```json', JSON.stringify(tel, null, 2), '```');
  if (spec.capText) lines.push('', `## 检查规则配置（${spec.capRelPath}）`, '```json', spec.capText.trim(), '```');
  if (spec.entryText) lines.push('', `## 适配器执行源码（${spec.entryRelPath}）`, '```js', spec.entryText.trim(), '```');

  const content = lines.join('\n') + '\n';
  const previewsBase = resolve(root, '.donegate', 'previews');
  const absPreview = resolve(root, relPreview);
  const relToBase = normalizeSlashes(relative(previewsBase, absPreview));
  if (relToBase && !relToBase.startsWith('..') && !isAbsolute(relative(previewsBase, absPreview))) {
    try {
      mkdirSync(previewsBase, { recursive: true });
      writeFileSync(absPreview, content, 'utf8');
    } catch (err) { void err; }
  }
  return { sourcePath: relPreview, content: content.slice(0, 65536) };
}

function hrHandleObservationPreviewRoute(req, res, root, hub) {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const rawToolParam = String(u.searchParams.get('tool') || '').trim();
  if (rawToolParam && (/[/\\]/.test(rawToolParam) || rawToolParam.includes('..'))) {
    sendJson(res, 400, { ok: false, error: '非法的 tool 参数（禁止路径穿越）' });
    return true;
  }
  const rawTool = rawToolParam.replace(/[^a-zA-Z0-9._-]/g, '');
  const tool = (rawTool === '.' || rawTool === '..' || rawTool.includes('..')) ? '' : rawTool;
  const nodeId = String(u.searchParams.get('nodeId') || '');
  const tel = nodeId ? (hub.nodeTelemetry.get(nodeId) || null) : null;
  const spec = hrObsMatchInstallAdapter(tool);
  const existing = hrObsFindExistingWorkspaceReport(root, tool, spec);
  if (existing) {
    sendJson(res, 200, { ok: true, sourcePath: existing.sourcePath, content: existing.content, telemetry: tel });
    return true;
  }
  const fallback = hrObsBuildFallbackRecordMd(root, tool, nodeId, tel, spec);
  sendJson(res, 200, { ok: true, sourcePath: fallback.sourcePath, content: fallback.content, telemetry: tel });
  return true;
}

async function hrHandleDepsInspectRoute(req, res, root, hub) {
  const refreshStamp = syncHubDepsRefreshStamp(root, hub);
  const uiboardToolchain = readUiToolchainStatus(root);
  if (req.method === 'GET') {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const wfId = u.searchParams.get('workflow') || u.searchParams.get('packId') || null;
    const allDeps = inspectAllKnownWorkflowPacks(root);
    sendJson(res, 200, {
      ok: true, refreshStamp, sharedPool: allDeps.sharedPool,
      reports: allDeps.reports, uiboardToolchain,
      report: readWorkflowDepsStatus(root, wfId)
    });
    return true;
  }
  const body = await readJsonBody(req);
  if (body.packs && typeof body.packs === 'object') {
    const allDeps = inspectAllKnownWorkflowPacks(root, body.packs);
    sendJson(res, 200, { ok: true, refreshStamp, sharedPool: allDeps.sharedPool, reports: allDeps.reports, uiboardToolchain });
    return true;
  }
  const allDeps = inspectAllKnownWorkflowPacks(root);
  const report = body.pack ? inspectWorkflowDeps(root, body.pack) : readWorkflowDepsStatus(root, body.workflowId || body.packId || null);
  sendJson(res, 200, { ok: true, refreshStamp, sharedPool: allDeps.sharedPool, reports: allDeps.reports, uiboardToolchain, report });
  return true;
}

async function hrHandleDepsRefreshRoute(req, res, root, hub) {
  const body = await readJsonBody(req);
  const wfId = body.workflowId || body.packId || (body.pack && body.pack.id) || null;
  const rec = reconcileSharedPoolOnRefresh(root, wfId, { trigger: 'http-refresh' });
  hub.lastDepsRefreshSeq = rec.refreshStamp.seq;
  const extraPacks = (body.packs && typeof body.packs === 'object') ? body.packs : {};
  const allDeps = inspectAllKnownWorkflowPacks(root, extraPacks);
  const uiboardToolchain = readUiToolchainStatus(root);
  let report = null;
  if (body.pack) report = inspectWorkflowDeps(root, body.pack);
  else if (wfId && allDeps.reports[wfId]) report = allDeps.reports[wfId];
  else report = readWorkflowDepsStatus(root, wfId);

  hub.emit({
    type: 'workflow_deps_updated', packId: report.packId, refreshStamp: rec.refreshStamp,
    sharedPool: allDeps.sharedPool, reports: allDeps.reports, report, uiboardToolchain
  });
  sendJson(res, 200, {
    ok: true, refreshStamp: rec.refreshStamp, sharedPool: allDeps.sharedPool,
    reports: allDeps.reports, report, uiboardToolchain
  });
  return true;
}

async function hrHandleDepsProvisionRoute(req, res, root, hub, opts) {
  const body = await readJsonBody(req);
  const rawPack = body.pack || {};
  const onlyNodeId = body.onlyNodeId ? String(body.onlyNodeId).trim() : '';
  const filteredNodes = Array.isArray(rawPack.nodes) ? rawPack.nodes.filter((n) => n && n.id === onlyNodeId) : [];
  const targetPack = onlyNodeId ? { ...rawPack, nodes: filteredNodes, deps: [] } : rawPack;
  const result = provisionWorkflowDeps(root, targetPack, {
    runNpm: body.runNpm === true,
    isolatedOnly: body.isolatedOnly === true,
    markInstalledIds: Array.isArray(body.markInstalledIds) ? body.markInstalledIds : undefined
  });
  const wantSpawn = result.missingCount > 0 && body.spawnSubagent === true;
  let subRes = null;
  if (wantSpawn && typeof opts.dispatchSubagent === 'function') {
    subRes = await opts.dispatchSubagent({
      sessionId: body.sessionId || null,
      label: `补齐工作流依赖: ${result.packName}`,
      prompt: result.agentPrompt
    });
  }
  const payload = wantSpawn
    ? { ...result, subagentDispatched: Boolean(subRes?.dispatched), subagentName: subRes?.name || null, fallbackAutoSubmit: !subRes?.dispatched }
    : result;
  const poolPath = result.sharedDepsDir || result.depsDir;
  const title = result.ready
    ? `工作流「${result.packName}」全部 ${result.total} 项依赖已在共享池 ${poolPath} 就位，可随时运行`
    : `已建立共享依赖池 ${poolPath} 并派发后台补齐工单（待装 ${result.missingCount} 项）`;
  hub.emit({ type: 'workflow_deps_updated', packId: result.packId, report: payload });
  hub.emit({ type: 'dock_item', item: { id: `wfdep-${Date.now()}`, kind: result.ready ? 'summary' : 'receipt', tone: result.ready ? 'ok' : 'warn', title } });
  sendJson(res, 200, payload);
  return true;
}

async function hrHandleOpenFolderRoute(req, res, root) {
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

async function handleCanvasDepsAndDispatchRoutes(req, res, cleanPath, root, hub, opts) {
  if (cleanPath === '/observation-preview' && req.method === 'GET') {
    return hrHandleObservationPreviewRoute(req, res, root, hub);
  }
  if (cleanPath === '/canvas' && req.method === 'GET') {
    const htmlPath = join(root, '.donegate', 'dashboard-dsh.html');
    mkdirSync(join(root, '.donegate'), { recursive: true });
    exportDashboardHtml(root, htmlPath);
    const rawHtml = readFileSync(htmlPath, 'utf8');
    const finalHtml = opts && opts._guardState?.requireAuth
      ? hagInjectSessionTokenHtml(rawHtml, opts._guardState.sessionToken)
      : rawHtml;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(finalHtml);
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
  if ((cleanPath === '/workflow-deps/inspect' || cleanPath === '/deps/status') && (req.method === 'POST' || req.method === 'GET')) {
    return hrHandleDepsInspectRoute(req, res, root, hub);
  }
  if ((cleanPath === '/workflow-deps/refresh' || cleanPath === '/deps/refresh') && req.method === 'POST') {
    return hrHandleDepsRefreshRoute(req, res, root, hub);
  }
  if ((cleanPath === '/workflow-deps/provision' || cleanPath === '/deps/provision') && req.method === 'POST') {
    return hrHandleDepsProvisionRoute(req, res, root, hub, opts);
  }
  if (cleanPath === '/open-folder' && req.method === 'POST') {
    return hrHandleOpenFolderRoute(req, res, root);
  }
  return false;
}

function hrBuildTargetVerdictCard(root, hub, target, idx, mustVerifyReceipt, receiptMap) {
  const checkId = (Array.isArray(target.contracts) && target.contracts[0]) || target.id;
  const claimed = receiptMap ? receiptMap[checkId] : null;
  const vRes = mustVerifyReceipt
    ? verifySubagentNodeReceipt(root, checkId, claimed)
    : { ok: true, exitCode: 0 };
  const headline = vRes.ok
    ? `${target.name || target.id} 已同步处理`
    : (vRes.reason || '缺少盘上回执证据');
  const card = buildMicroVerdictCard({
    ticketId: `tkt-${Date.now()}-${idx}`,
    targetUri: target.uri,
    exitCode: vRes.ok ? 0 : vRes.exitCode,
    headline,
    passedGates: vRes.ok ? 1 : 0,
    totalGates: 1,
    touchedFiles: (target.scopes || []).filter((s) => !s.endsWith('/'))
  });
  hub.emit({ type: 'micro_card_ready', card });
  return card;
}

async function hrHandleDispatchRoute(req, res, root, hub) {
  const body = await readJsonBody(req);
  const targets = Array.isArray(body.targets) && body.targets.length > 0
    ? body.targets
    : parseQuotedTargetsFromMessage(body.message || '');
  if (body.pack && body.pack.nodes) {
    const safePack = hagSanitizeHttpWorkflowPack(body.pack);
    const ticket = {
      ticketId: hagSanitizeId(body.ticketId, `tkt-${Date.now()}`),
      targetUri: targets[0]?.uri || body.targetUri || null,
      headline: body.headline || '',
      mandate: { allowedWriteScopes: targets.flatMap((t) => t.scopes || []) }
    };
    const out = await executeDeterministicWorkflowRun(root, ticket, safePack, {
      useFingerprintCache: body.useFingerprintCache !== false
    });
    sendJson(res, 200, out);
    return true;
  }
  const receiptMap = (body.subagentReceipts && typeof body.subagentReceipts === 'object') ? body.subagentReceipts : null;
  const mustVerifyReceipt = Boolean(body.requireNodeReceipt || receiptMap);
  const cards = targets.map((t, idx) => hrBuildTargetVerdictCard(root, hub, t, idx, mustVerifyReceipt, receiptMap));
  if (targets.length === 0 || targets.length > 1) {
    const title = targets.length > 1
      ? `复合指令已完成（涉及 ${targets.length} 个引用目标，门禁全部通过）`
      : String(body.replyText || '全局指令已由 Super Agent 受理并同步工作台状态').slice(0, 120);
    hub.emit({ type: 'dock_item', item: { id: `dock-${Date.now()}`, kind: 'summary', tone: 'ok', title } });
  }
  sendJson(res, 200, { ok: true, targetCount: targets.length, cards });
  return true;
}

function hrResolveSafePreviewFile(root, rel) {
  const full = resolve(root, rel);
  const rawRel = relative(root, full);
  const relCheck = normalizeSlashes(rawRel);
  if (!relCheck || isAbsolute(rawRel) || /^[A-Za-z]:/.test(relCheck) || relCheck.startsWith('..')) {
    return null;
  }
  if (!existsSync(full)) return null;
  try {
    return statSync(full).isFile() ? full : null;
  } catch (err) {
    void err;
    return null;
  }
}

function hrHandleFilePreviewRoute(req, res, root) {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const rel = normalizeSlashes(u.searchParams.get('path') || '').replace(/^\/+/, '');
  const safeFile = hrResolveSafePreviewFile(root, rel);
  if (!safeFile) {
    sendJson(res, 404, { ok: false, error: '文件不存在或越界' });
    return true;
  }
  const content = readFileSync(safeFile, 'utf8').slice(0, 65536);
  sendJson(res, 200, { ok: true, path: rel, content });
  return true;
}

async function handleDispatchAndPreviewRoutes(req, res, cleanPath, root, hub) {
  if (cleanPath === '/dispatch' && req.method === 'POST') {
    return hrHandleDispatchRoute(req, res, root, hub);
  }
  if (cleanPath === '/file-preview' && req.method === 'GET') {
    return hrHandleFilePreviewRoute(req, res, root);
  }
  return false;
}

export function createDoneGateWebRouteHandler(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const hub = getRunEventHub(root);
  const guardState = hagCreateControlPlaneGuard(opts);
  const effectiveOpts = { ...opts, _guardState: guardState };
  async function handleDoneGateRoute(req, res, subPath) {
    if (!hagValidateControlPlaneRequest(req, res, guardState)) return true;
    const cleanPath = String(subPath || '/').split('?')[0];
    try {
      if (await handleSliceJudgeAndPackRoutes(req, res, cleanPath, root, hub, effectiveOpts)) return true;
      if (await handleCanvasDepsAndDispatchRoutes(req, res, cleanPath, root, hub, effectiveOpts)) return true;
      return await handleDispatchAndPreviewRoutes(req, res, cleanPath, root, hub);
    } catch (err) {
      if (!res.headersSent) {
        const status = Number(err?.statusCode) || (err instanceof SyntaxError ? 400 : 500);
        sendJson(res, status, { ok: false, error: String(err?.message || err) });
      }
      return true;
    }
  }
  handleDoneGateRoute.sessionToken = guardState.sessionToken;
  handleDoneGateRoute.requireAuth = guardState.requireAuth;
  return handleDoneGateRoute;
}
