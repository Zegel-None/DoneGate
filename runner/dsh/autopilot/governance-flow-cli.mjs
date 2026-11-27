#!/usr/bin/env node
// DoneGate 声明式治理工作流 CLI 引擎（donegate flow list|plan|inspect|dump|diff|run|reset，<= 215 行）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wfcCompileWorkflow,
  wfcListDefaultWorkflows,
  wfcResetProjectOverlay
} from './workflow-compiler.mjs';
import { tlRecordRuleOutcomes } from './trust-ladder.mjs';
import { executeBrickGateNode } from './brick-exec.mjs';
import { buildWorkflowDepEnv } from '../deps/index.mjs';
import { hagSanitizeSubagentEnv } from '../../shared/subagent-env.mjs';

function gfcParseFlags(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (!nxt || nxt.startsWith('--') || ['json', 'staged', 'confirm-human'].includes(k)) {
        flags[k] = true;
      } else {
        flags[k] = nxt;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function gfcHandleList(root, flags) {
  const flows = wfcListDefaultWorkflows(root)
    .sort((a, b) => Number(a.stageOrder || 99) - Number(b.stageOrder || 99));
  const summary = flows.map((f) => {
    const c = wfcCompileWorkflow(root, f);
    return {
      id: f.id,
      timing: f.timing || '',
      name: f.name,
      presetVersion: c.presetVersion,
      nodeCount: c.effectivePack.nodes.length,
      customized: c.customized,
      disabledIntegrityCount: c.disabledIntegrityRules.length,
      newOfficialCount: c.newOfficialNodes.length,
      workflowHash: c.workflowHash.slice(0, 12)
    };
  });
  if (flags.json) return { exitCode: 0, stdout: JSON.stringify({ ok: true, flows: summary }, null, 2), flows: summary };
  const lines = [
    `DoneGate 官方默认治理流（共 ${summary.length} 条）：`,
    ...summary.map((s) =>
      `  - ${s.id} [${s.timing}] ${s.name} (${s.nodeCount} 节点 | hash=${s.workflowHash}${s.customized ? ' | 已微调' : ''}${s.disabledIntegrityCount ? ` | 🚨已关底线×${s.disabledIntegrityCount}` : ''})`
    )
  ];
  return { exitCode: 0, stdout: lines.join('\n'), flows: summary };
}

function gfcFormatResultLine(r) {
  if (r.observedWarn) {
    return `  👁 [观察期告警] ${r.title} (${r.nodeId}) -> raw exit ${r.rawExitCode} (仅统计采纳率，不阻断)`;
  }
  let icon = '✗';
  if (r.exitCode === 0) icon = r.skipped ? '↷' : '✓';
  const note = r.skipped && r.reason ? ` [${r.reason}]` : '';
  return `  ${icon} ${r.title} (${r.nodeId}) -> exit ${r.exitCode}${note}`;
}

function gfcClassifyNodePlanStatus(node) {
  if (node.bypassed) return 'bypassed';
  if (node.envSkipped) return 'env-skipped';
  if (node.isHumanGate) return 'human-gate';
  return node.exec ? 'active' : 'non-exec';
}

function gfcHandlePlan(root, flowId, flags) {
  const comp = wfcCompileWorkflow(root, flowId);
  if (!comp.ok) return { exitCode: comp.exitCode, stderr: comp.reason };
  const plan = comp.effectivePack.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    tier: node.tier || 'recommended',
    mode: node.mode || 'enforce',
    status: gfcClassifyNodePlanStatus(node),
    kind: node.exec?.kind || 'none'
  }));
  const payload = { ok: true, flowId: comp.flowId, name: comp.effectivePack.name, workflowHash: comp.workflowHash, disclosureBanner: comp.disclosureBanner, plan };
  if (flags.json) return { exitCode: 0, stdout: JSON.stringify(payload, null, 2), ...payload };
  const badge = { active: '▶', 'env-skipped': '↷', bypassed: '⏸', 'human-gate': '👤', 'non-exec': '·' };
  const lines = [
    `=== DoneGate 治理流预演：${comp.effectivePack.name} (${comp.flowId} · hash=${comp.workflowHash.slice(0, 12)}) ===`,
    ...(comp.disclosureBanner ? [comp.disclosureBanner] : []),
    ...plan.map((n) => `  ${badge[n.status] || '·'} [${n.tier}${n.mode === 'observe' ? '·observe' : ''}] ${n.title} (${n.id}) · ${n.status}`),
    `汇总：共 ${plan.length} 节点（激活 ${plan.filter((n) => n.status === 'active').length} / 环境跳过 ${plan.filter((n) => n.status === 'env-skipped').length} / 关闭 ${plan.filter((n) => n.status === 'bypassed').length}）`
  ];
  return { exitCode: 0, stdout: lines.join('\n'), ...payload };
}

function gfcSkippedReasonLabel(node) {
  if (node.bypassed) return '用户已关闭';
  return node.envSkipped ? '按环境跳过' : '非自动脚本节点';
}

function gfcExecuteActiveNode(root, node, flags, cleanEnv) {
  const execNode = (flags.staged && node.id === 'pc-commit-hygiene')
    ? { ...node, exec: { ...node.exec, args: ['--staged'] } }
    : node;
  const r = executeBrickGateNode(root, root, execNode, cleanEnv);
  const mode = node.mode || 'enforce';
  const observedWarn = mode === 'observe' && !r.skipped && r.exitCode !== 0;
  return {
    nodeId: node.id,
    title: node.title,
    tier: node.tier || 'recommended',
    mode,
    skipped: Boolean(r.skipped),
    observedWarn,
    rawExitCode: r.exitCode,
    exitCode: observedWarn ? 0 : r.exitCode,
    durationMs: r.durationMs,
    diagSummary: r.diagSummary.slice(0, 240)
  };
}

function gfcHandleRun(root, flowId, flags) {
  const comp = wfcCompileWorkflow(root, flowId);
  if (!comp.ok) return { exitCode: comp.exitCode, stderr: comp.reason };
  const cleanEnv = hagSanitizeSubagentEnv(buildWorkflowDepEnv(root, comp.flowId));
  const results = [];
  const outcomes = [];
  let worstExit = 0;

  for (const node of comp.effectivePack.nodes) {
    if (node.bypassed || node.envSkipped || node.isHumanGate || !node.exec) {
      results.push({ nodeId: node.id, title: node.title, mode: node.mode || 'enforce', skipped: true, reason: gfcSkippedReasonLabel(node), exitCode: 0 });
      continue;
    }
    const item = gfcExecuteActiveNode(root, node, flags, cleanEnv);
    results.push(item);
    if (!item.skipped) {
      outcomes.push({ nodeId: item.nodeId, title: item.title, tier: item.tier, mode: item.mode, passed: item.rawExitCode === 0 });
    }
    if (item.exitCode !== 0 && (worstExit === 0 || item.exitCode === 2)) {
      worstExit = item.exitCode;
      if (item.exitCode === 2) break;
    }
  }
  if (outcomes.length > 0 && (existsSync(join(root, '.donegate')) || existsSync(join(root, 'INTENT.md')))) {
    const modelId = typeof flags.model === 'string' ? flags.model : (process.env.DONEGATE_MODEL_ID || 'default');
    tlRecordRuleOutcomes(root, { modelId, flowId: comp.flowId, outcomes });
  }

  const payload = { ok: worstExit === 0, exitCode: worstExit, flowId: comp.flowId, workflowHash: comp.workflowHash, disclosureBanner: comp.disclosureBanner, results };
  if (flags.json) return { exitCode: worstExit, stdout: JSON.stringify(payload, null, 2), ...payload };

  const lines = [
    `=== DoneGate 治理工作流运行：${comp.effectivePack.name} (${comp.flowId} · hash=${comp.workflowHash.slice(0, 12)}) ===`,
    ...(comp.disclosureBanner ? [comp.disclosureBanner] : []),
    ...results.map(gfcFormatResultLine),
    `RESULT: ${worstExit === 0 ? 'PASS' : 'FAIL'} (exit ${worstExit})`
  ];
  return { exitCode: worstExit, stdout: lines.join('\n'), ...payload };
}

export function cmdGovernanceFlow(projectRoot, argv = []) {
  const { pos, flags } = gfcParseFlags(argv);
  const root = resolve(typeof flags.root === 'string' ? flags.root : projectRoot);
  const sub = pos[0] || 'list';
  const flowId = pos[1] || '';

  if (sub === 'list') return gfcHandleList(root, flags);
  if (sub === 'plan') return gfcHandlePlan(root, flowId, flags);
  if (sub === 'inspect' || sub === 'dump') {
    const c = wfcCompileWorkflow(root, flowId);
    if (!c.ok) return { exitCode: c.exitCode, stderr: c.reason };
    return { exitCode: 0, stdout: JSON.stringify(c, null, 2), compiled: c };
  }
  if (sub === 'diff') {
    const c = wfcCompileWorkflow(root, flowId);
    if (!c.ok) return { exitCode: c.exitCode, stderr: c.reason };
    const out = { flowId: c.flowId, customized: c.customized, overrideDiff: c.overrideDiff, disabledIntegrityRules: c.disabledIntegrityRules, newOfficialNodes: c.newOfficialNodes };
    return { exitCode: 0, stdout: JSON.stringify(out, null, 2), ...out };
  }
  if (sub === 'run') return gfcHandleRun(root, flowId, flags);
  if (sub === 'reset') {
    const res = wfcResetProjectOverlay(root, flowId, { actorRole: 'human', confirmedByHuman: Boolean(flags['confirm-human']) });
    if (!res.ok) return { exitCode: res.exitCode, stderr: res.reason };
    return { exitCode: 0, stdout: flags.json ? JSON.stringify(res, null, 2) : `已重置治理流 ${flowId} 为官方默认配置（hash=${res.workflowHash.slice(0, 12)}）` };
  }
  return { exitCode: 3, stderr: `未知 flow 子命令：${sub}（支持 list | plan | inspect | dump | diff | run | reset）` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = cmdGovernanceFlow(process.cwd(), process.argv.slice(2));
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exit(r.exitCode);
}
