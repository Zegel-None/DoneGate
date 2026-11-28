#!/usr/bin/env node
// DoneGate V4 · 十二条主命令统一零依赖 CLI 入口与参数分发器（四值退出码规范）
// 用法：node runner/donegate.mjs <command> [subcommand/args] [--root <dir>]
// 主命令：init / contract / check / teeth / catch / status / graph / gaps / handover / verify / retire
// 子命令入口：donegate flow CLI (official default governance workflows) / harness / patch-edit / lint-edit / preflight / check-node
import Module from 'node:module';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try { Module.enableCompileCache?.(); } catch (err) { void err; }

import './atlas/dashboard.mjs';
import {
  cmdCatch, cmdCheck, cmdCheckNode, cmdContractFreeze, cmdContractNew, cmdContractPromote,
  cmdGaps, cmdGraph, cmdHandover, cmdImpact, cmdInit, cmdRetire, cmdSlice, cmdStatus,
  cmdTeeth, cmdVerifyApply, cmdVerifyAutoJudge, cmdVerifyPack
} from './core/index.mjs';
import { cmdBrief, cmdZoom } from './cockpit/cockpit-commands.mjs';
import { cmdLocate } from './cockpit/cockpit-locate.mjs';
import { startCockpitMcp } from './cockpit/cockpit-mcp.mjs';
import { buildDoneGateGovernanceArgv, buildDoneGateGovernanceMcpTools } from './cockpit/adapters/donegate-mcp-tools.mjs';
import { cmdHarness } from './harnesses/index.mjs';
import { cmdLintEdit, lintEditedFiles } from '../skill/lint-edit.mjs';
import { executeFlexibleFilePatch } from '../skill/lint-edit/flexible-patch.mjs';
import { cmdPreflight } from '../skill/preflight-subagent.mjs';

const BOOLEAN_FLAGS = new Set([
  'tree', 'flow', 'signoff', 'allow-dirty', 'human-pass', 'explore', 'discover',
  'open', 'serve', 'skip-gates', 'force-batch', 'legacy', 'json', 'help', 'h',
  'router', 'router-only', 'freeze-stub', 'allow-stub-change', 'allow-cross-scope', 'skip-scope-check', 'receipt', 'node', 'stamp-lease',
  'stubs', 'decisions', 'full', 'skeleton', 'source', 'trace', 'compact', 'fast-sample', 'escapes-regression', 'staged', 'confirm-human',
  'require-root', 'governance-only', 'no-hooks', 'full-mcp', 'focus-hint', 'dry-run'
]);

const HELP_TEXT = [
  'DoneGate V4 CLI（十二条命令 + 十一个驾驶舱、治理流、宿主插件与微门禁快捷入口，四值退出码：0=通过 1=判否 2=事故 3=无法判断）',
  '',
  '用法：node runner/donegate.mjs <命令> [参数] [--root <项目根>]',
  '  init [dir] [--discover]                         初始化项目骨架（--discover 自动扫描存量仓建探索态起步契约；已存在退 3）',
  '  contract new <id> [--title --why --scope --owner --depends-on --explore --ttl-days --golden]   新建契约（--explore 建探索态）',
  '  contract promote <id> --by <签字人> [--legacy]   将探索态契约晋升为正式交付契约并一次签字冻结',
  '  contract freeze <id> --by <签字人> [--legacy] [--force-batch]   冻结判据并签字（有判据缺 expect 或 kind 退 1）',
  '  contract freeze <id> --by <签字人> --signoff --attest <口头复述>   实现后裁方签收（记录复核包哈希与链上位置）',
  '  check <id> [--criterion <oid>] [--allow-dirty] [--human-pass] [--skip-gates] [--node]   跑判据并落证据（有未通过退 1，跑不起来退 3）',
  '  teeth <id> <criterionId> [--tier A|B|ACH] [--claim <path>]   有牙实验：改坏实现看判据红不红（无牙退 1，还原失败退 2，未知退 3）',
  '  catch <id> [--focus-hint]                       针对改动跑捕获测试并执行 RubFake 假警报过滤（捕获回归退 1，假测试退 3）',
  '  status [--tree] [--flow] [--html <path>] [--open] [--pending <c1,c2>]   现算五状态六栏总账（契约读不出退 3）',
  '  graph [--router]                                输出覆盖率与三色依赖图（--router 生成 .donegate/ROUTER.md 与接口存根）',
  '  gaps [--json]                                   输出实时缺口清单',
  '  handover [--out <path>] [--receiver <name>]     生成六节交接包',
  '  verify pack <id> [--base <rev>] [--head <rev>] [--out <dir>]   生成判方复核包（证据不全退 3）',
  '  verify apply <packDir> --verdict <verdict.json>   记录门 5 裁决（不过退 1，材料被篡改退 2，材料不全退 3）',
  '  verify auto-judge <packDir> [--contract <id>] [--judges <cli1,cli2>]   跨进程只读异构自动盲审与负评二次元验证消噪（不过退 1，异常退 2/3）',
  '  retire <id> --reason <理由>                      退役契约（理由为空退 1）',
  '',
  '主控三级变焦驾驶舱、开源图谱追踪、密封契约切片与子代理微门禁快捷入口（默认 1M 窗口 × 40% = 400k Tokens 五段配额）：',
  '· brief [--budget <n>] [--json] [--out <path>]   生成主控 Zoom-0 全局根视口（画布双生域 + Kneedle 承重接口 + CBM 图谱统计）',
  '· locate "<任务描述>" [--budget <n>] [--k <n>] [--json]   按任务语义从 CBM 图谱排序定位相关文件与骨架摘要',
  '· zoom <域|契约|文件[:起-止]|符号名|rules|tests|gaps|all> [--stubs] [--decisions] [--full [词]] [--skeleton] [--source] [--budget <n>]   图谱下钻、骨架摘要、双向调用链与末步源码直读',
  '· slice [nodeId] [--focus <f1,f2|@subpack>] [--lexical <t1,t2>] [--router-only] [--freeze-stub] [--context-window <n>] [--utilization <r>] [--max-tokens <n>] [--json] [--out <path>]',
  '· check-node <nodeId> [--criterion <oid>] [--base <ref>] [--allow-dirty] [--allow-stub-change] [--allow-cross-scope] [--receipt] [--json]',
  '· lint-edit <file1> [file2...] [--json]         单文件编辑即时护栏（100ms 级校验语法、复杂度、C4g、术语与内联脚本漏挂）',
  '· patch-edit <file> --old <oldText> --new <newText> [--dry-run] [--json]   四级去空白保缩进容错替换并联动 lint-edit 校验',
  '· impact <file-or-anchor...> [--budget <n>] [--json]   跨文件 UI 锚点/路由/CBM 调用边波及面雷达（无截断多跳单测与 ADR 预警）',
  '· mcp [--root <项目根>] [--require-root] [--governance-only]   启动零依赖 stdio MCP 服务（含 dg_status / dg_slice / dg_lint_edit / dg_check_node）',
  '· flow <list|plan|inspect|diff|run|reset> [flowId] [--staged] [--json]   声明式治理流查看、预演与一键运行（支持 workflow 别名）',
  '· harness <list|status|install|uninstall> [dsh|antigravity|claude-code|codex] [--no-hooks] [--full-mcp] [--json]   可插拔 AI Harness 宿主适配器管理',
  '· preflight [--stamp-lease] [--expect-branch <b>] [--node <id> | --target-node <id>] [--json]   子代理工作树健康探针（失联即刻退 78 熔断）'
].join('\n');

function dgConsumeLongFlag(flags, argv, idx) {
  const k = argv[idx].slice(2);
  const nextTok = argv[idx + 1];
  if ((k === 'old' || k === 'new') && nextTok !== undefined) {
    flags[k] = nextTok;
    return idx + 1;
  }
  const isValuedPreflightNode = k === 'node' && argv[0] === 'preflight' && nextTok !== undefined && !nextTok.startsWith('--');
  if (BOOLEAN_FLAGS.has(k) && !isValuedPreflightNode) {
    flags[k] = true;
    return idx;
  }
  if (nextTok === undefined || nextTok.startsWith('--')) {
    flags[k] = true;
    return idx;
  }
  const isListFlag = k === 'focus' || k === 'lexical';
  flags[k] = (isListFlag && flags[k]) ? `${flags[k]},${nextTok}` : nextTok;
  return idx + 1;
}

function parseCliArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      i = dgConsumeLongFlag(flags, argv, i);
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function dgCmdContract(root, sub, pos, flags) {
  if (sub === 'new') {
    return cmdContractNew(root, {
      id: pos[2], title: flags.title, why: flags.why, scope: flags.scope,
      owner: flags.owner, dependsOn: flags['depends-on'],
      explore: Boolean(flags.explore), ttlDays: flags['ttl-days'], golden: flags.golden
    });
  }
  if (sub === 'promote') {
    return cmdContractPromote(root, {
      id: pos[2], by: flags.by, legacy: Boolean(flags.legacy)
    });
  }
  if (sub === 'freeze') {
    return cmdContractFreeze(root, {
      id: pos[2], by: flags.by, signoff: Boolean(flags.signoff),
      attest: flags.attest, openedAt: flags['opened-at'],
      forceBatch: Boolean(flags['force-batch']), legacy: Boolean(flags['legacy'])
    });
  }
  return null;
}

function dgCmdSubagentTools(cmd, root, pos, flags) {
  if (cmd === 'brief') return cmdBrief(root, { json: Boolean(flags.json), out: flags.out, budget: flags.budget });
  if (cmd === 'locate') {
    return cmdLocate(root, {
      query: pos.slice(1).join(' '),
      budget: flags.budget,
      k: flags.k,
      json: Boolean(flags.json)
    });
  }
  if (cmd === 'zoom') {
    return cmdZoom(root, {
      targets: pos.slice(1), stubs: Boolean(flags.stubs),
      decisions: Boolean(flags.decisions), full: Boolean(flags.full),
      skeleton: Boolean(flags.skeleton), source: Boolean(flags.source),
      trace: Boolean(flags.trace), json: Boolean(flags.json), budget: flags.budget
    });
  }
  if (cmd === 'lint-edit') return cmdLintEdit(root, { files: pos.slice(1), json: Boolean(flags.json) });
  if (cmd === 'patch-edit') {
    return executeFlexibleFilePatch(root, {
      file: pos[1], oldText: flags.old, newText: flags.new, specFile: flags.spec,
      dryRun: Boolean(flags['dry-run']), json: Boolean(flags.json), runLint: lintEditedFiles
    });
  }
  if (cmd === 'impact') return cmdImpact(root, { targets: pos.slice(1), json: Boolean(flags.json), budget: flags.budget });
  if (cmd === 'preflight') {
    return cmdPreflight(root, {
      stampLease: Boolean(flags['stamp-lease']),
      expectBranch: typeof flags['expect-branch'] === 'string' ? flags['expect-branch'] : undefined,
      nodeId: typeof flags['target-node'] === 'string' ? flags['target-node'] : (typeof flags.node === 'string' ? flags.node : pos[1]),
      json: Boolean(flags.json)
    });
  }
  return null;
}

function dgCmdSliceOrGraph(cmd, root, pos, flags) {
  if (cmd === 'slice') {
    return cmdSlice(root, {
      id: pos[1],
      focus: flags.focus,
      lexical: flags.lexical,
      routerOnly: Boolean(flags['router-only']),
      freezeStub: Boolean(flags['freeze-stub']),
      contextWindow: flags['context-window'],
      utilization: flags.utilization,
      maxTokens: flags['max-tokens'],
      json: Boolean(flags.json),
      out: flags.out
    });
  }
  if (cmd === 'graph') {
    if (flags.router) {
      return cmdSlice(root, {
        routerOnly: true,
        contextWindow: flags['context-window'],
        utilization: flags.utilization,
        json: Boolean(flags.json),
        out: flags.out
      });
    }
    return cmdGraph(root);
  }
  return dgCmdSubagentTools(cmd, root, pos, flags);
}

function dgCmdCheckOrTeeth(cmd, root, pos, flags) {
  if (cmd === 'check-node' || (cmd === 'check' && flags.node)) {
    return cmdCheckNode(root, {
      id: pos[1],
      criterion: flags.criterion,
      base: typeof flags.base === 'string' ? flags.base : undefined,
      allowDirty: Boolean(flags['allow-dirty']),
      allowStubChange: Boolean(flags['allow-stub-change']),
      allowCrossScope: Boolean(flags['allow-cross-scope']),
      skipScopeCheck: Boolean(flags['skip-scope-check']),
      contextWindow: flags['context-window'],
      utilization: flags.utilization,
      receipt: Boolean(flags.receipt),
      heldOutDir: typeof flags['heldout-dir'] === 'string' ? flags['heldout-dir'] : undefined,
      confession: typeof flags.confession === 'string' ? flags.confession : undefined,
      json: Boolean(flags.json)
    });
  }
  if (cmd === 'check') {
    return cmdCheck(root, {
      id: pos[1], criterion: flags.criterion,
      base: typeof flags.base === 'string' ? flags.base : undefined,
      heldOutDir: typeof flags['heldout-dir'] === 'string' ? flags['heldout-dir'] : undefined,
      compact: Boolean(flags.compact), fastSample: Boolean(flags['fast-sample']),
      allowDirty: Boolean(flags['allow-dirty']), humanPass: Boolean(flags['human-pass']),
      humanEvidence: typeof flags['human-evidence'] === 'string' ? flags['human-evidence'] : undefined,
      explore: Boolean(flags.explore),
      skipGates: Boolean(flags['skip-gates'])
    });
  }
  if (cmd === 'teeth') {
    return cmdTeeth(root, { id: pos[1], criterionId: pos[2], tier: flags.tier || 'A', claim: flags.claim, mutants: flags.mutants });
  }
  if (cmd === 'catch') {
    return cmdCatch(root, {
      id: pos[1],
      testFile: flags.test || pos[1],
      command: flags.command,
      base: typeof flags.base === 'string' ? flags.base : undefined,
      head: typeof flags.head === 'string' ? flags.head : undefined,
      behavior: flags.behavior,
      focusHint: Boolean(flags['focus-hint']),
      json: Boolean(flags.json)
    });
  }
  return null;
}

async function dgRunVerifyAutoJudge(root, pos, flags) {
  const firstJudge = typeof flags.judges === 'string' ? flags.judges.split(',').map((s) => s.trim()).find(Boolean) : undefined;
  const res = await cmdVerifyAutoJudge(root, pos, {
    ...flags,
    pack: pos[2] || flags.pack,
    judgeBin: flags['judge-bin'] || flags.judgeBin || firstJudge,
    judgeArgs: flags['judge-args'] || flags.judgeArgs
  });
  const stdout = res.stdout || (res.verdict ? JSON.stringify({ ok: res.ok, exitCode: res.exitCode, contractId: res.contractId, verdict: res.verdict }) : '');
  const stderr = res.stderr || (!res.ok && res.reasonCode ? `自动盲审未通过：${res.reasonCode}` : '');
  return { ...res, exitCode: res.exitCode ?? 3, stdout, stderr };
}

function dgCmdStatusAndGovernance(cmd, sub, root, pos, flags) {
  if (cmd === 'status') {
    const pendingSet = typeof flags.pending === 'string' ? new Set(flags.pending.split(',').filter(Boolean)) : new Set();
    return cmdStatus(root, {
      tree: Boolean(flags.tree), flow: Boolean(flags.flow), html: flags.html,
      open: Boolean(flags.open), serve: Boolean(flags.serve), pendingContracts: pendingSet
    });
  }
  if (cmd === 'gaps') return cmdGaps(root, { json: Boolean(flags.json) });
  if (cmd === 'handover') {
    return cmdHandover(root, {
      out: flags.out, receiver: flags.receiver, ranCommand: flags['ran-command'],
      observedOutput: flags['observed-output'], stuckAt: flags['stuck-at']
    });
  }
  if (cmd === 'verify' && sub === 'pack') {
    return cmdVerifyPack(root, {
      id: pos[2], base: flags.base, head: flags.head, out: flags.out,
      heldOutDir: typeof flags['heldout-dir'] === 'string' ? flags['heldout-dir'] : undefined,
      escapesRegression: Boolean(flags['escapes-regression'])
    });
  }
  if (cmd === 'verify' && sub === 'apply') {
    return cmdVerifyApply(root, { packDir: pos[2], verdict: flags.verdict, votes: flags.votes });
  }
  if (cmd === 'verify' && sub === 'auto-judge') return dgRunVerifyAutoJudge(root, pos, flags);
  if (cmd === 'retire') return cmdRetire(root, { id: pos[1], reason: flags.reason });
  return null;
}

function dgCmdFlow(cmd, argv, root) {
  const cliAbs = join(dirname(fileURLToPath(import.meta.url)), 'dsh', 'autopilot', 'governance-flow-cli.mjs');
  const fwdArgs = cmd === 'workflow-run' ? ['run', ...argv.slice(1)] : argv.slice(1);
  const r = spawnSync(process.execPath, [cliAbs, ...fwdArgs, '--root', root], { encoding: 'utf8', windowsHide: true });
  return {
    exitCode: typeof r.status === 'number' ? r.status : 3,
    stdout: (r.stdout || '').trimEnd(),
    stderr: (r.stderr || '').trimEnd()
  };
}

export function dispatchCommand(argv, defaultRoot = process.cwd()) {
  const { flags, pos } = parseCliArgs(argv);
  if (flags.help || pos[0] === 'help' || pos.length === 0) {
    return { exitCode: pos.length === 0 && !flags.help ? 3 : 0, stdout: HELP_TEXT };
  }
  const root = resolve(typeof flags.root === 'string' ? flags.root : defaultRoot);
  const cmd = pos[0];
  if (cmd === 'mcp') return { exitCode: 3, stderr: 'mcp 为常驻 stdio 服务，请通过命令行 `node runner/donegate.mjs mcp` 启动。' };
  if (cmd === 'flow' || cmd === 'workflow' || cmd === 'workflow-run') return dgCmdFlow(cmd, argv, root);
  if (cmd === 'harness') {
    return cmdHarness(root, {
      sub: pos[1] || 'list',
      targetId: pos[2] || '',
      dir: flags.dir,
      configRoot: flags['config-root'],
      noHooks: Boolean(flags['no-hooks']),
      fullMcp: Boolean(flags['full-mcp']),
      json: Boolean(flags.json)
    });
  }
  if (cmd === 'init') return cmdInit(pos[1] ? resolve(defaultRoot, pos[1]) : root, { discover: Boolean(flags.discover) });
  const sub = pos[1];
  const routed = (cmd === 'contract' ? dgCmdContract(root, sub, pos, flags) : null)
    || dgCmdSliceOrGraph(cmd, root, pos, flags)
    || dgCmdCheckOrTeeth(cmd, root, pos, flags)
    || dgCmdStatusAndGovernance(cmd, sub, root, pos, flags);
  if (routed) return routed;

  return { exitCode: 3, stderr: `未知命令：${pos.slice(0, 2).join(' ')}\n运行 node runner/donegate.mjs --help 查看全部十二条命令。` };
}

async function runCliEntry(argv) {
  const { flags, pos } = parseCliArgs(argv);
  if (pos[0] === 'mcp' && !flags.help) {
    const root = resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    if (!existsSync(root)) {
      console.error(`项目根目录不存在：${root}`);
      return 3;
    }
    const requireRoot = Boolean(flags['require-root']);
    const governanceOnly = Boolean(flags['governance-only']);
    return startCockpitMcp({
      root,
      dispatchCommand,
      serverName: governanceOnly ? 'donegate-governance' : 'donegate-cockpit',
      requireRoot,
      includeBaseTools: !governanceOnly,
      extraTools: buildDoneGateGovernanceMcpTools({ requireRoot }),
      buildExtraArgv: buildDoneGateGovernanceArgv
    });
  }
  const res = await dispatchCommand(argv);
  if (res.stdout) console.log(res.stdout);
  if (res.stderr) console.error(res.stderr);
  return res.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runCliEntry(process.argv.slice(2));
  process.exit(code);
}
