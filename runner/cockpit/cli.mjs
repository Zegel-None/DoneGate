#!/usr/bin/env node
// 独立通用变焦驾驶舱 CLI 与 stdio MCP 入口（默认启用零治理 generic 适配器，通吃任意代码仓库，L5）
// 用法：node runner/cockpit/cli.mjs <brief|locate|zoom|impact|mcp> [args...] [--root <dir>] [--adapter generic|donegate]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdImpact } from '../core/index.mjs';
import { createGenericCockpitAdapter } from './adapter-protocol.mjs';
import { cmdBrief, cmdZoom } from './cockpit-commands.mjs';
import { resolveCockpitAdapter } from './cockpit-index.mjs';
import { cmdLocate } from './cockpit-locate.mjs';
import { startCockpitMcp } from './cockpit-mcp.mjs';

const BOOL_FLAGS = new Set(['json', 'help', 'h', 'skeleton', 'source', 'stubs', 'decisions', 'full', 'trace']);

const STANDALONE_HELP = [
  'Zoom Cockpit · 零依赖代码图谱变焦驾驶舱（通吃任意多语言仓库 + stdio MCP 服务）',
  '',
  '用法：node runner/cockpit/cli.mjs <命令> [参数] [--root <仓库路径>] [--adapter generic|donegate]',
  '  brief [--budget <tok>] [--json] [--out <file>]          生成仓库 Zoom-0 顶层模块组与承重枢纽地图',
  '  locate "<任务描述>" [--budget <tok>] [--k <n>] [--json]  按任务语义执行 CBM 入度阻尼 PPR 文件排序',
  '  zoom <组编号|文件[:起-止]|符号|rules|tests|gaps|all> [--skeleton] [--source] [--budget <tok>]',
  '  impact <文件|符号|路由|配置文件...> [--budget <tok>] [--json]  分析多跳调用链与关联单测命令',
  '  mcp [--root <仓库路径>]                                  启动零依赖 stdio MCP 服务（暴露 brief/locate/zoom/impact）'
].join('\n');

function parseStandaloneArgs(argv) {
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
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
        flags[k] = true;
      } else {
        flags[k] = argv[++i];
      }
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function buildStandaloneAdapter(adapterFlag) {
  if (adapterFlag === 'donegate') return resolveCockpitAdapter('donegate');
  if (typeof adapterFlag === 'object' && adapterFlag !== null) return adapterFlag;
  const cliPrefix = process.env.COCKPIT_CLI_PREFIX || 'zoom-cockpit';
  return createGenericCockpitAdapter({ cliPrefix });
}

export function dispatchCockpitCommand(argv, defaultRoot = process.cwd(), extraOpts = {}) {
  const { flags, pos } = parseStandaloneArgs(argv);
  if (flags.help && pos[0] !== 'mcp') return { exitCode: 0, stdout: STANDALONE_HELP };
  if (pos.length === 0) return { exitCode: 3, stderr: STANDALONE_HELP };
  const root = resolve(typeof flags.root === 'string' ? flags.root : defaultRoot);
  const adapter = extraOpts.adapter || buildStandaloneAdapter(flags.adapter);
  const cmd = pos[0];
  if (cmd === 'brief') return cmdBrief(root, { adapter, json: Boolean(flags.json), out: flags.out, budget: flags.budget });
  if (cmd === 'locate') return cmdLocate(root, { adapter, query: pos.slice(1).join(' '), budget: flags.budget, k: flags.k, json: Boolean(flags.json) });
  if (cmd === 'zoom') {
    return cmdZoom(root, {
      adapter, targets: pos.slice(1), stubs: Boolean(flags.stubs), decisions: Boolean(flags.decisions),
      full: Boolean(flags.full), skeleton: Boolean(flags.skeleton), source: Boolean(flags.source),
      trace: Boolean(flags.trace), json: Boolean(flags.json), budget: flags.budget
    });
  }
  if (cmd === 'impact') {
    return cmdImpact(root, {
      targets: pos.slice(1), json: Boolean(flags.json), budget: flags.budget,
      adapterId: adapter.id, cliPrefix: adapter.cliPrefix
    });
  }
  if (cmd === 'mcp') {
    if (flags.help) return { exitCode: 0, stdout: `用法：${adapter.cliPrefix} mcp [--root <仓库路径>]` };
    return { exitCode: 3, stderr: 'mcp 需以独立子进程驻留运行：node runner/cockpit/cli.mjs mcp [--root <dir>]' };
  }
  return { exitCode: 3, stderr: `未知命令：${cmd}\n\n${STANDALONE_HELP}` };
}

async function runCliMain() {
  const argv = process.argv.slice(2);
  const { flags, pos } = parseStandaloneArgs(argv);
  if (pos[0] === 'mcp' && !flags.help) {
    const root = resolve(typeof flags.root === 'string' ? flags.root : process.cwd());
    const adapter = buildStandaloneAdapter(flags.adapter);
    const code = await startCockpitMcp({
      root,
      serverName: adapter.mcpServerName,
      toolPrefix: adapter.mcpToolPrefix,
      brandName: adapter.brandName,
      dispatchCommand: (subArgv, r) => dispatchCockpitCommand(subArgv, r, { adapter })
    });
    process.exit(code);
  }
  const res = dispatchCockpitCommand(argv, process.cwd());
  if (res.stdout) process.stdout.write(`${res.stdout}\n`);
  if (res.stderr) process.stderr.write(`${res.stderr}\n`);
  process.exit(res.exitCode ?? 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCliMain().catch((err) => {
    process.stderr.write(`${err?.message || String(err)}\n`);
    process.exit(2);
  });
}
