#!/usr/bin/env node
// DoneGate 声明式治理工作流 CLI 引擎（donegate flow list|inspect|dump|diff|run|reset，<= 180 行）
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wfcCompileWorkflow,
  wfcListDefaultWorkflows,
  wfcResetProjectOverlay
} from './workflow-compiler.mjs';
import { executeBrickGateNode } from './brick-exec.mjs';
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
  let icon = '✗';
  if (r.exitCode === 0) icon = r.skipped ? '↷' : '✓';
  const note = r.skipped && r.reason ? ` [${r.reason}]` : '';
  return `  ${icon} ${r.title} (${r.nodeId}) -> exit ${r.exitCode}${note}`;
}

function gfcHandleRun(root, flowId, flags) {
  const comp = wfcCompileWorkflow(root, flowId);
  if (!comp.ok) return { exitCode: comp.exitCode, stderr: comp.reason };
  const cleanEnv = hagSanitizeSubagentEnv(process.env);
  const results = [];
  let worstExit = 0;

  for (const node of comp.effectivePack.nodes) {
    if (node.bypassed || node.envSkipped || node.isHumanGate || !node.exec) {
      results.push({
        nodeId: node.id,
        title: node.title,
        skipped: true,
        reason: node.bypassed ? '用户已关闭' : (node.envSkipped ? '按环境跳过' : '非自动脚本节点'),
        exitCode: 0
      });
      continue;
    }
    const execNode = (flags.staged && node.id === 'pc-commit-hygiene')
      ? { ...node, exec: { ...node.exec, args: ['--staged'] } }
      : node;
    const r = executeBrickGateNode(root, root, execNode, cleanEnv);
    results.push({ nodeId: node.id, title: node.title, skipped: Boolean(r.skipped), exitCode: r.exitCode, durationMs: r.durationMs, diagSummary: r.diagSummary.slice(0, 240) });
    if (r.exitCode !== 0 && (worstExit === 0 || r.exitCode === 2)) {
      worstExit = r.exitCode;
      if (r.exitCode === 2) break;
    }
  }

  const payload = {
    ok: worstExit === 0,
    exitCode: worstExit,
    flowId: comp.flowId,
    workflowHash: comp.workflowHash,
    disclosureBanner: comp.disclosureBanner,
    results
  };
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
  return { exitCode: 3, stderr: `未知 flow 子命令：${sub}（支持 list | inspect | dump | diff | run | reset）` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = cmdGovernanceFlow(process.cwd(), process.argv.slice(2));
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exit(r.exitCode);
}
