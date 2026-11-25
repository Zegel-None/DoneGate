#!/usr/bin/env node
// DoneGate V4 · 十二条命令统一零依赖入口（四值退出码规范）及主控三级变焦驾驶舱、密封契约切片与微门禁快捷入口
// 用法：node runner/donegate.mjs <command> [subcommand/args] [--root <dir>]
// 命令：init / contract new / contract freeze / check / teeth / status / graph / gaps / handover / verify pack / verify apply / retire
// 快捷入口转发映射：brief & zoom -> runner/core/cockpit-commands.mjs | impact -> runner/core/impact-radar.mjs | slice & check-node -> runner/core/commands-b.mjs | lint-edit -> skill/lint-edit.mjs | preflight -> skill/preflight-subagent.mjs
import Module from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try { Module.enableCompileCache?.(); } catch (err) { void err; }

import { cmdInit, cmdContractNew, cmdContractFreeze, cmdCheck, cmdTeeth, cmdRetire } from './core/commands-a.mjs';
import { cmdStatus, cmdGraph, cmdGaps, cmdHandover, cmdVerifyPack, cmdVerifyApply, cmdSlice, cmdCheckNode, cmdImpact, cmdBrief, cmdZoom } from './core/commands-b.mjs';
import { cmdLintEdit } from '../skill/lint-edit.mjs';
import { cmdPreflight } from '../skill/preflight-subagent.mjs';

const BOOLEAN_FLAGS = new Set([
  'tree', 'flow', 'signoff', 'allow-dirty', 'human-pass',
  'open', 'serve', 'skip-gates', 'force-batch', 'legacy', 'json', 'help', 'h',
  'router', 'router-only', 'freeze-stub', 'allow-stub-change', 'allow-cross-scope', 'skip-scope-check', 'receipt', 'node', 'stamp-lease',
  'stubs', 'decisions', 'full'
]);

const HELP_TEXT = [
  'DoneGate V4 CLI（十二条命令 + 七个驾驶舱与微门禁快捷入口，四值退出码：0=通过 1=判否 2=事故 3=无法判断）',
  '',
  '用法：node runner/donegate.mjs <命令> [参数] [--root <项目根>]',
  '  init [dir]                                      初始化项目骨架（已存在退 3）',
  '  contract new <id> [--title --why --scope --owner --depends-on]   新建契约骨架（标识重复或不合规退 1）',
  '  contract freeze <id> --by <签字人> [--legacy] [--force-batch]   冻结判据并签字（有判据缺 expect 或 kind 退 1）',
  '  contract freeze <id> --by <签字人> --signoff --attest <口头复述>   实现后裁方签收（记录复核包哈希与链上位置）',
  '  check <id> [--criterion <oid>] [--allow-dirty] [--human-pass] [--skip-gates] [--node]   跑判据并落证据（有未通过退 1，跑不起来退 3）',
  '  teeth <id> <criterionId> [--tier A|B] [--claim <path>]   有牙实验：改坏实现看判据红不红（无牙退 1，还原失败退 2，未知退 3）',
  '  status [--tree] [--flow] [--html <path>] [--open] [--pending <c1,c2>]   现算五状态六栏总账（契约读不出退 3）',
  '  graph [--router]                                输出覆盖率与三色依赖图（--router 生成 .donegate/ROUTER.md 与接口存根）',
  '  gaps [--json]                                   输出实时缺口清单',
  '  handover [--out <path>] [--receiver <name>]     生成六节交接包',
  '  verify pack <id> [--base <rev>] [--head <rev>] [--out <dir>]   生成判方复核包（证据不全退 3）',
  '  verify apply <packDir> --verdict <verdict.json>   记录门 5 裁决（不过退 1，材料被篡改退 2，材料不全退 3）',
  '  retire <id> --reason <理由>                      退役契约（理由为空退 1）',
  '',
  '主控三级变焦驾驶舱、密封契约切片与子代理微门禁快捷入口（默认 1M 窗口 × 40% = 400k Tokens 五段配额）：',
  '· brief [--json] [--out <path>]                 生成主控 Zoom-0 零魔法数字全局根视口（画布双生域 + Kneedle 承重接口 + 寻址句柄）',
  '· zoom <域|契约|文件|rules|tests|gaps|all> [--stubs] [--decisions] [--full [词]]   三级按需确定性下钻寻址（穿透门面与内联脚本）',
  '· slice [nodeId] [--focus <f1,f2|@subpack>] [--lexical <t1,t2>] [--router-only] [--freeze-stub] [--context-window <n>] [--utilization <r>] [--max-tokens <n>] [--json] [--out <path>]',
  '· check-node <nodeId> [--criterion <oid>] [--base <ref>] [--allow-dirty] [--allow-stub-change] [--allow-cross-scope] [--receipt] [--json]',
  '· lint-edit <file1> [file2...] [--json]         单文件编辑即时护栏（100ms 级校验语法、复杂度、C4g、术语与内联脚本漏挂）',
  '· impact <file-or-anchor...> [--json]           跨文件 UI 锚点/路由/导出符号影响面雷达（含 1-Hop 单测自动推导）',
  '· preflight [--stamp-lease] [--expect-branch <b>] [--node <id> | --target-node <id>] [--json]   子代理工作树健康探针（失联即刻退 78 熔断）'
].join('\n');

function dgConsumeLongFlag(flags, argv, idx) {
  const k = argv[idx].slice(2);
  const nextTok = argv[idx + 1];
  const isValuedPreflightNode = k === 'node' && argv[0] === 'preflight' && nextTok !== undefined && !nextTok.startsWith('--');
  if (BOOLEAN_FLAGS.has(k) && !isValuedPreflightNode) {
    flags[k] = true;
    return idx;
  }
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('--')) {
    flags[k] = true;
    return idx;
  }
  const isListFlag = k === 'focus' || k === 'lexical';
  flags[k] = (isListFlag && flags[k]) ? `${flags[k]},${next}` : next;
  return idx + 1;
}

function parseCliArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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
      owner: flags.owner, dependsOn: flags['depends-on']
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
  if (cmd === 'brief') return cmdBrief(root, { json: Boolean(flags.json), out: flags.out });
  if (cmd === 'zoom') {
    return cmdZoom(root, {
      targets: pos.slice(1), stubs: Boolean(flags.stubs),
      decisions: Boolean(flags.decisions), full: Boolean(flags.full), json: Boolean(flags.json)
    });
  }
  if (cmd === 'lint-edit') return cmdLintEdit(root, { files: pos.slice(1), json: Boolean(flags.json) });
  if (cmd === 'impact') return cmdImpact(root, { targets: pos.slice(1), json: Boolean(flags.json) });
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
      json: Boolean(flags.json)
    });
  }
  if (cmd === 'check') {
    return cmdCheck(root, {
      id: pos[1], criterion: flags.criterion,
      allowDirty: Boolean(flags['allow-dirty']), humanPass: Boolean(flags['human-pass']),
      skipGates: Boolean(flags['skip-gates'])
    });
  }
  if (cmd === 'teeth') {
    return cmdTeeth(root, { id: pos[1], criterionId: pos[2], tier: flags.tier || 'A', claim: flags.claim });
  }
  return null;
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
  if (cmd === 'verify' && sub === 'pack') return cmdVerifyPack(root, { id: pos[2], base: flags.base, head: flags.head, out: flags.out });
  if (cmd === 'verify' && sub === 'apply') return cmdVerifyApply(root, { packDir: pos[2], verdict: flags.verdict });
  if (cmd === 'retire') return cmdRetire(root, { id: pos[1], reason: flags.reason });
  return null;
}

export function dispatchCommand(argv, defaultRoot = process.cwd()) {
  const { flags, pos } = parseCliArgs(argv);
  if (flags.help || pos[0] === 'help' || pos.length === 0) {
    return { exitCode: pos.length === 0 && !flags.help ? 3 : 0, stdout: HELP_TEXT };
  }
  const root = resolve(typeof flags.root === 'string' ? flags.root : defaultRoot);
  const cmd = pos[0];
  if (cmd === 'init') {
    return cmdInit(pos[1] ? resolve(defaultRoot, pos[1]) : root);
  }
  const sub = pos[1];
  const routed = (cmd === 'contract' ? dgCmdContract(root, sub, pos, flags) : null)
    || dgCmdSliceOrGraph(cmd, root, pos, flags)
    || dgCmdCheckOrTeeth(cmd, root, pos, flags)
    || dgCmdStatusAndGovernance(cmd, sub, root, pos, flags);
  if (routed) return routed;

  return {
    exitCode: 3,
    stderr: '未知命令。十二条命令：init | contract new | contract freeze | check | teeth | status | graph | gaps | handover | verify pack | verify apply | retire（快捷入口：brief | zoom | slice | check-node | lint-edit | impact | preflight）'
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = dispatchCommand(process.argv.slice(2));
  if (res.stdout) console.log(res.stdout);
  if (res.stderr) console.error(res.stderr);
  process.exit(res.exitCode);
}
