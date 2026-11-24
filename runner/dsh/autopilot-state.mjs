#!/usr/bin/env node
// 过夜挂机确定性持久状态机（checkpoint 断点续跑 + 三重防烧钱熔断 + human-gate 挂起早间拍板简报，<= 235 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';

export const AUTOPILOT_STATES = Object.freeze({
  IDLE: 'IDLE',
  PREFLIGHT: 'PREFLIGHT',
  RUNNING: 'RUNNING',
  SUSPENDED_HUMAN_GATE: 'SUSPENDED_HUMAN_GATE',
  TRIPPED_CIRCUIT_BREAKER: 'TRIPPED_CIRCUIT_BREAKER',
  COMPLETED: 'COMPLETED'
});

export function isHumanGateNode(node) {
  if (!node || typeof node !== 'object') return false;
  return Boolean(
    node.isHumanGate === true ||
    node.tplId === 'tpl-human-gate' ||
    node.archetype === 'human-gate' ||
    (node.exec && node.exec.kind === 'human_gate')
  );
}

export function getAutopilotPaths(projectRoot, runId) {
  const root = resolve(projectRoot);
  const runsRoot = join(root, '.donegate', 'runs');
  const activePtrPath = join(runsRoot, 'active-autopilot.json');
  const safeId = String(runId || 'latest').replace(/[^a-zA-Z0-9._-]/g, '_');
  const runDir = join(runsRoot, safeId);
  return {
    root,
    runsRoot,
    activePtrPath,
    runId: safeId,
    runDir,
    checkpointPath: join(runDir, 'checkpoint.json'),
    briefPath: join(runDir, 'MORNING-BRIEF.md')
  };
}

export function createInitialCheckpoint(projectRoot, runId, pack, ticket = {}) {
  const now = new Date().toISOString();
  const cp = {
    runId,
    packId: (pack && pack.id) || 'default',
    packName: (pack && pack.name) || (pack && pack.id) || '未命名工作流',
    state: AUTOPILOT_STATES.PREFLIGHT,
    startedAt: now,
    updatedAt: now,
    cursorNodeId: null,
    lastExitCode: 0,
    passedGates: 0,
    totalGates: 0,
    completedNodes: [],
    loopCounts: {},
    consecEnvFaults: 0,
    approvedGates: {},
    pendingHumanGate: null,
    breaker: null,
    ticket: {
      ticketId: ticket.ticketId || runId,
      targetUri: ticket.targetUri || null,
      headline: ticket.headline || '',
      allowedWriteScopes: ticket.mandate?.allowedWriteScopes || []
    }
  };
  return saveAutopilotCheckpoint(projectRoot, cp);
}

export function buildMorningBriefMarkdown(cp) {
  const stateLabel = {
    COMPLETED: '✅ 已自动跑通收工',
    SUSPENDED_HUMAN_GATE: '⏸ 停在人工闸门等你拍板',
    TRIPPED_CIRCUIT_BREAKER: '🛑 触发防烧钱熔断护栏已安全停机',
    RUNNING: '⚡ 正在后台持续推进',
    PREFLIGHT: '🔍 预检阶段'
  }[cp.state] || cp.state;

  const lines = [
    `# 早间挂机简报 · ${cp.packName}`,
    '',
    `- **运行单号**：\`${cp.runId}\``,
    `- **当前状态**：${stateLabel}（\`${cp.state}\`）`,
    `- **门禁进度**：已过 ${cp.passedGates}/${cp.totalGates} 道门禁 · 已完成 ${cp.completedNodes.length} 个节点`,
    `- **更新时间**：${cp.updatedAt}`
  ];
  if (cp.pendingHumanGate) {
    lines.push(
      '',
      '## 待你拍板的人工闸门',
      `- **卡点节点**：「${cp.pendingHumanGate.title}」（\`${cp.pendingHumanGate.nodeId}\`）`,
      `- **说明**：${cp.pendingHumanGate.prompt}`,
      `- **一键放行续跑**：在工作台回执条点「批准闸门并续跑」，或运行 \`node runner/dsh/autopilot-state.mjs --approve ${cp.pendingHumanGate.nodeId} --run-id ${cp.runId}\``
    );
  }
  if (cp.breaker) {
    lines.push(
      '',
      '## 触发的防烧钱熔断详情',
      `- **熔断类型**：\`${cp.breaker.code}\`（节点 \`${cp.breaker.nodeId || '-'}\`）`,
      `- **拦截原因**：${cp.breaker.reason}`,
      `- **恢复方式**：修掉对应阻塞项后运行 \`node runner/dsh/autopilot-state.mjs --resume --run-id ${cp.runId}\` 从断点继续`
    );
  }
  if (cp.completedNodes.length > 0) {
    lines.push('', '## 夜间已完成节点流水');
    for (const n of cp.completedNodes.slice(-10)) {
      lines.push(`- \`${n.nodeId}\` ${n.title} → exit \`${n.exitCode}\` (${n.at})`);
    }
  }
  return lines.join('\n') + '\n';
}

export function saveAutopilotCheckpoint(projectRoot, cp) {
  const paths = getAutopilotPaths(projectRoot, cp.runId);
  mkdirSync(paths.runDir, { recursive: true });
  cp.updatedAt = new Date().toISOString();
  const briefMd = buildMorningBriefMarkdown(cp);
  cp.morningSummaryLine = cp.state === AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE
    ? `⏸ 挂机已停在人工闸门「${cp.pendingHumanGate?.title}」（已完成 ${cp.completedNodes.length} 步），批准后从断点续跑`
    : (cp.state === AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER
        ? `🛑 触发熔断 [${cp.breaker?.code}]：${cp.breaker?.reason}`
        : (cp.state === AUTOPILOT_STATES.COMPLETED
            ? `🌅 挂机圆满完成：${cp.packName}（过关门禁 ${cp.passedGates}/${Math.max(cp.totalGates, 1)}）`
            : `⚡ 挂机推进中：已完成 ${cp.completedNodes.length} 个节点`));
  writeFileSync(paths.checkpointPath, JSON.stringify(cp, null, 2) + '\n', 'utf8');
  writeFileSync(paths.briefPath, briefMd, 'utf8');
  writeFileSync(paths.activePtrPath, JSON.stringify({
    runId: cp.runId,
    packId: cp.packId,
    packName: cp.packName,
    state: cp.state,
    cursorNodeId: cp.cursorNodeId,
    morningSummaryLine: cp.morningSummaryLine,
    updatedAt: cp.updatedAt
  }, null, 2) + '\n', 'utf8');
  return cp;
}

export function loadAutopilotCheckpoint(projectRoot, runId = null) {
  const root = resolve(projectRoot);
  let targetId = runId;
  if (!targetId) {
    const ptr = readJsonStrict(join(root, '.donegate', 'runs', 'active-autopilot.json'));
    if (!ptr.ok || !ptr.value || !ptr.value.runId) return null;
    targetId = ptr.value.runId;
  }
  const paths = getAutopilotPaths(root, targetId);
  const res = readJsonStrict(paths.checkpointPath);
  if (!res.ok || !res.value) return null;
  const briefMd = existsSync(paths.briefPath) ? readFileSync(paths.briefPath, 'utf8') : buildMorningBriefMarkdown(res.value);
  return { ...res.value, briefMarkdown: briefMd, checkpointFile: `.donegate/runs/${paths.runId}/checkpoint.json` };
}

export function approveAutopilotHumanGate(projectRoot, { runId = null, nodeId = null, by = '业主', note = '人工批准放行' } = {}) {
  const cp = loadAutopilotCheckpoint(projectRoot, runId);
  if (!cp) return { ok: false, exitCode: 3, reason: '找不到待恢复的挂机检查点' };
  const targetGateId = nodeId || cp.pendingHumanGate?.nodeId || cp.cursorNodeId;
  if (!targetGateId) return { ok: false, exitCode: 2, reason: '当前检查点没有挂起的人工闸门节点' };
  cp.approvedGates = cp.approvedGates || {};
  cp.approvedGates[targetGateId] = { by, note, at: new Date().toISOString() };
  cp.pendingHumanGate = null;
  cp.state = AUTOPILOT_STATES.RUNNING;
  delete cp.briefMarkdown;
  delete cp.checkpointFile;
  saveAutopilotCheckpoint(projectRoot, cp);
  return { ok: true, exitCode: 0, runId: cp.runId, approvedNodeId: targetGateId, cursorNodeId: cp.cursorNodeId, checkpoint: cp };
}

export function tripAutopilotBreaker(projectRoot, cp, { code, nodeId = null, reason }) {
  cp.state = AUTOPILOT_STATES.TRIPPED_CIRCUIT_BREAKER;
  cp.breaker = { code, nodeId, reason, trippedAt: new Date().toISOString() };
  return saveAutopilotCheckpoint(projectRoot, cp);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const pull = (k, d = null) => {
    const i = argv.indexOf(k);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      return argv[i + 1];
    }
    return d;
  };
  const root = resolve(pull('--root', process.cwd()));
  const runId = pull('--run-id', null);
  if (argv.includes('--approve')) {
    const nodeId = pull('--approve', null);
    const r = approveAutopilotHumanGate(root, { runId, nodeId, by: pull('--by', '业主') });
    if (!r.ok) {
      console.error(r.reason);
      process.exit(r.exitCode);
    }
    console.log(`已批准人工闸门 ${r.approvedNodeId}（runId=${r.runId}），可继续从断点续跑。`);
    process.exit(0);
  }
  const cp = loadAutopilotCheckpoint(root, runId);
  if (!cp) {
    console.log('当前无挂机长跑记录。');
    process.exit(0);
  }
  console.log(cp.briefMarkdown);
  process.exit(0);
}
