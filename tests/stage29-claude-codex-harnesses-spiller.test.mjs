// Stage 29：Claude Code & OpenAI Codex 原生宿主适配器、HookOutputSpiller 与 STOP/STEER/guard-events 实跑单测
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { codexHarnessAdapter, validateCodexNetworkAllowlist, validateCodexNetworkRuleHost } from '../runner/harnesses/codex-adapter.mjs';
import {
  FORBIDDEN_AGENT_MCP_MUTATIONS,
  auditAgentShellCommand,
  isForbiddenAgentMcpMutation
} from '../runner/shared/command-guard-rules.mjs';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  DEFAULT_HOOK_OUTPUT_CHAR_BUDGET,
  DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET,
  maybeSpillHookOutput
} from '../runner/shared/hook-output-spiller.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempDirs = [];

function makeTempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function invokeGuardHook(scriptPath, payload, extraEnv = {}) {
  const r = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    windowsHide: true
  });
  let parsed = {};
  try {
    parsed = JSON.parse(r.stdout || '{}');
  } catch (err) {
    void err;
  }
  return { exitCode: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json: parsed };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
    } catch (err) {
      void err;
    }
  }
});

describe('stage29: Claude Code & Codex native harnesses, HookOutputSpiller, and STOP/STEER/guard-events', () => {
  it('① donegate harness list 确认 dsh / antigravity / claude-code / codex 四宿主全部已实现可用', () => {
    const res = dispatchCommand(['harness', 'list', '--json'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    const body = JSON.parse(res.stdout);
    const expectedIds = ['dsh', 'antigravity', 'claude-code', 'codex'];
    for (const id of expectedIds) {
      const entry = body.harnesses.find((h) => h.id === id);
      expect(entry, `missing harness ${id}`).toBeTruthy();
      expect(entry.implemented).toBe(true);
    }

    const txtRes = dispatchCommand(['harness', 'list'], REPO_ROOT);
    expect(txtRes.exitCode).toBe(0);
    for (const id of expectedIds) {
      const line = txtRes.stdout.split(/\r?\n/).find((l) => l.includes(`- ${id}`));
      expect(line).toBeTruthy();
      expect(line).not.toContain('预留占位');
    }
  });

  it('② Claude Code 适配器 install / status / uninstall 完整闭环（保留原有非 DoneGate 配置、支持 --no-hooks 与 --full-mcp）', () => {
    const cfgRoot = makeTempDir('dg-s29-claude-cfg-');
    mkdirSync(join(cfgRoot, '.claude', 'skills', 'user-own-skill'), { recursive: true });
    writeFileSync(join(cfgRoot, '.claude', 'skills', 'user-own-skill', 'SKILL.md'), '---\nname: user-own-skill\ndescription: keep\n---\nuser body\n');
    writeFileSync(join(cfgRoot, '.mcp.json'), JSON.stringify({
      customTopField: 'keep-me',
      mcpServers: {
        existingServer: { command: 'node', args: ['/workspace/repo/custom-mcp.mjs'] }
      }
    }, null, 2));
    writeFileSync(join(cfgRoot, '.claude', 'settings.json'), JSON.stringify({
      model: 'claude-sonnet-4-5',
      hooks: {
        PostToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo custom-post-hook' }] }
        ]
      }
    }, null, 2));

    const inst = dispatchCommand(['harness', 'install', 'claude-code', '--config-root', cfgRoot, '--json'], REPO_ROOT);
    expect(inst.exitCode).toBe(0);
    const instJson = JSON.parse(inst.stdout);
    expect(instJson.ok).toBe(true);
    expect(instJson.hooksEnabled).toBe(true);
    expect(instJson.skills).toEqual(['donegate', 'donegate-judge', 'donegate-forge']);

    const mcpMerged = JSON.parse(readFileSync(join(cfgRoot, '.mcp.json'), 'utf8'));
    expect(mcpMerged.customTopField).toBe('keep-me');
    expect(mcpMerged.mcpServers.existingServer.args).toEqual(['/workspace/repo/custom-mcp.mjs']);
    expect(mcpMerged.mcpServers.donegate.args).toEqual(expect.arrayContaining(['mcp', '--require-root', '--governance-only']));

    const settingsMerged = JSON.parse(readFileSync(join(cfgRoot, '.claude', 'settings.json'), 'utf8'));
    expect(settingsMerged.model).toBe('claude-sonnet-4-5');
    expect(settingsMerged.hooks.PreToolUse.length).toBe(1);
    expect(settingsMerged.hooks.UserPromptSubmit.length).toBe(1);
    expect(settingsMerged.hooks.Stop.length).toBe(1);
    expect(settingsMerged.hooks.PostToolUse.length).toBe(2);

    const st = dispatchCommand(['harness', 'status', 'claude-code', '--config-root', cfgRoot, '--json'], REPO_ROOT);
    expect(st.exitCode).toBe(0);
    const stJson = JSON.parse(st.stdout);
    expect(stJson.installed).toBe(true);
    expect(stJson.hooksEnabled).toBe(true);

    // 切换 --full-mcp 与 --no-hooks：治理限制移除且跳过守护钩子，同时不破坏用户自有钩子
    const instNoHooks = dispatchCommand(['harness', 'install', 'claude-code', '--config-root', cfgRoot, '--full-mcp', '--no-hooks', '--json'], REPO_ROOT);
    expect(instNoHooks.exitCode).toBe(0);
    const fullMcpCfg = JSON.parse(readFileSync(join(cfgRoot, '.mcp.json'), 'utf8'));
    expect(fullMcpCfg.mcpServers.donegate.args).toContain('--require-root');
    expect(fullMcpCfg.mcpServers.donegate.args).not.toContain('--governance-only');
    expect(existsSync(join(cfgRoot, '.claude', 'hooks', 'donegate-guard.mjs'))).toBe(false);
    const settingsNoDgHooks = JSON.parse(readFileSync(join(cfgRoot, '.claude', 'settings.json'), 'utf8'));
    expect(settingsNoDgHooks.hooks.PostToolUse).toHaveLength(1);
    expect(settingsNoDgHooks.hooks.PostToolUse[0].hooks[0].command).toBe('echo custom-post-hook');

    // 无损卸载：精准清理 DoneGate 托管项，100% 保留用户原有配置与技能
    const uninst = dispatchCommand(['harness', 'uninstall', 'claude-code', '--config-root', cfgRoot, '--json'], REPO_ROOT);
    expect(uninst.exitCode).toBe(0);
    const mcpAfter = JSON.parse(readFileSync(join(cfgRoot, '.mcp.json'), 'utf8'));
    expect(mcpAfter.mcpServers.donegate).toBeUndefined();
    expect(mcpAfter.mcpServers.existingServer).toBeTruthy();
    expect(existsSync(join(cfgRoot, '.claude', 'skills', 'donegate'))).toBe(false);
    expect(existsSync(join(cfgRoot, '.claude', 'skills', 'user-own-skill', 'SKILL.md'))).toBe(true);
  });

  it('③ Codex CLI 适配器 install / status / uninstall 完整闭环与 REF-07 拒绝 * 全通配网络规则', () => {
    expect(validateCodexNetworkRuleHost('*').ok).toBe(false);
    expect(validateCodexNetworkRuleHost('*').code).toBe('WILDCARD_NETWORK_HOST_DENIED');
    expect(validateCodexNetworkRuleHost('*:*').ok).toBe(false);
    expect(validateCodexNetworkRuleHost('*.example.com').ok).toBe(false);
    expect(validateCodexNetworkRuleHost('*.com', { allowSubdomainWildcard: true }).ok).toBe(false);
    expect(validateCodexNetworkRuleHost('*.openai.com', { allowSubdomainWildcard: true }).ok).toBe(true);
    expect(validateCodexNetworkRuleHost('0.0.0.0').ok).toBe(false);
    expect(validateCodexNetworkRuleHost('https://api.openai.com/v1').ok).toBe(false);
    expect(validateCodexNetworkRuleHost('api.openai.com:443').ok).toBe(true);
    expect(validateCodexNetworkAllowlist(['api.openai.com', 'api.deepseek.com:443']).ok).toBe(true);

    const codexRoot = makeTempDir('dg-s29-codex-cfg-');
    const badNetInstall = codexHarnessAdapter.install({
      donegateRoot: REPO_ROOT,
      configRoot: codexRoot,
      allowedNetworkHosts: ['api.openai.com', '*']
    });
    expect(badNetInstall.ok).toBe(false);
    expect(badNetInstall.exitCode).toBe(2);
    expect(badNetInstall.code).toBe('WILDCARD_NETWORK_HOST_DENIED');

    writeFileSync(join(codexRoot, 'config.toml'), [
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.other_tool]',
      'command = "node"',
      'args = ["/workspace/repo/other-mcp.mjs"]',
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(codexRoot, 'hooks.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop-hook', timeout: 5 }] }]
      }
    }, null, 2));

    const inst = dispatchCommand(['harness', 'install', 'codex', '--config-root', codexRoot, '--json'], REPO_ROOT);
    expect(inst.exitCode).toBe(0);
    const tomlText = readFileSync(join(codexRoot, 'config.toml'), 'utf8');
    expect(tomlText).toContain('model = "gpt-5-codex"');
    expect(tomlText).toContain('[mcp_servers.other_tool]');
    expect(tomlText).toContain('[mcp_servers.donegate]');
    expect(tomlText).toContain('"--governance-only"');

    const hooksJson = JSON.parse(readFileSync(join(codexRoot, 'hooks.json'), 'utf8'));
    expect(hooksJson.hooks.PreToolUse).toHaveLength(1);
    expect(hooksJson.hooks.PostToolUse).toHaveLength(1);
    expect(hooksJson.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooksJson.hooks.Stop).toHaveLength(2);

    const st = dispatchCommand(['harness', 'status', 'codex', '--config-root', codexRoot, '--json'], REPO_ROOT);
    expect(st.exitCode).toBe(0);
    expect(JSON.parse(st.stdout).installed).toBe(true);

    // 测试 --no-hooks 与 --full-mcp
    expect(dispatchCommand(['harness', 'install', 'codex', '--config-root', codexRoot, '--no-hooks', '--full-mcp'], REPO_ROOT).exitCode).toBe(0);
    expect(readFileSync(join(codexRoot, 'config.toml'), 'utf8')).not.toContain('"--governance-only"');
    expect(existsSync(join(codexRoot, 'hooks', 'donegate-guard.mjs'))).toBe(false);

    // 卸载保留用户原有 TOML 与自定义钩子
    expect(dispatchCommand(['harness', 'uninstall', 'codex', '--config-root', codexRoot], REPO_ROOT).exitCode).toBe(0);
    const tomlAfter = readFileSync(join(codexRoot, 'config.toml'), 'utf8');
    expect(tomlAfter).toContain('model = "gpt-5-codex"');
    expect(tomlAfter).toContain('[mcp_servers.other_tool]');
    expect(tomlAfter).not.toContain('[mcp_servers.donegate]');
    const hooksAfter = JSON.parse(readFileSync(join(codexRoot, 'hooks.json'), 'utf8'));
    expect(hooksAfter.hooks.Stop).toHaveLength(1);
    expect(hooksAfter.hooks.Stop[0].hooks[0].command).toBe('echo user-stop-hook');
  });

  it('④ 守护钩子实跑验证：.donegate/STOP fail-closed 急停退 2、违规写入 guard-events.jsonl、STEER.md 纠偏归档与超预算截断', () => {
    const codexRoot = makeTempDir('dg-s29-guard-codex-');
    const dgProj = makeTempDir('dg-s29-proj-');
    expect(dispatchCommand(['init', '--root', dgProj], REPO_ROOT).exitCode).toBe(0);
    expect(dispatchCommand(['harness', 'install', 'codex', '--config-root', codexRoot], REPO_ROOT).exitCode).toBe(0);
    const guardScript = join(codexRoot, 'hooks', 'donegate-guard.mjs');

    // 1) PreToolUse 命中违规命令 -> 拦截并记录结构化事件至 .donegate/guard-events.jsonl
    const denyRes = invokeGuardHook(guardScript, {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-s29',
      cwd: dgProj,
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "cheat" --no-verify' }
    });
    expect(denyRes.exitCode).toBe(0);
    expect(denyRes.json.decision).toBe('block');
    expect(denyRes.json.hookSpecificOutput?.permissionDecision).toBe('deny');

    // 2) PreToolUse 顶部检测 .donegate/STOP -> fail-closed 退出码 2，并追加急停事件记录
    mkdirSync(join(dgProj, '.donegate'), { recursive: true });
    writeFileSync(join(dgProj, '.donegate', 'STOP'), '发现方向偏离，人类紧急叫停过夜任务\n', 'utf8');
    const stopRes = invokeGuardHook(guardScript, {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-s29',
      cwd: dgProj,
      tool_name: 'Bash',
      tool_input: { command: 'node runner/donegate.mjs status' }
    });
    expect(stopRes.exitCode).toBe(2);
    expect(stopRes.stderr).toContain('人类紧急叫停过夜任务');
    rmSync(join(dgProj, '.donegate', 'STOP'), { force: true });

    const guardEvents = readFileSync(join(dgProj, '.donegate', 'guard-events.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l));
    expect(guardEvents).toHaveLength(2);
    expect(guardEvents[0]).toMatchObject({ code: 'HOOK_BYPASS_DENIED', commandPreview: 'git commit -m "cheat" --no-verify' });
    expect(typeof guardEvents[0].at).toBe('string');
    expect(guardEvents[1]).toMatchObject({ code: 'KILL_SWITCH_STOP', commandPreview: 'node runner/donegate.mjs status' });

    // 3) UserPromptSubmit 读取 .donegate/STEER.md 注入纠偏上下文、归档至 steer-history.jsonl 并清理已消费文件（同时验证超预算截断）
    const longDirective = '【首部纠偏目标】改用纯函数重构接口。\n' + '中间背景补充细节。'.repeat(60) + '\n【尾部修复配方】务必保留原导出名。';
    writeFileSync(join(dgProj, '.donegate', 'STEER.md'), longDirective, 'utf8');
    const steerRes = invokeGuardHook(guardScript, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-s29',
      cwd: dgProj
    }, { DG_HOOK_CHAR_BUDGET: '260' });
    expect(steerRes.exitCode).toBe(0);
    const injected = steerRes.json.hookSpecificOutput?.additionalContext || '';
    expect(injected).toContain('【首部纠偏目标】');
    expect(injected).toContain('【尾部修复配方】');
    expect(injected).toContain('.donegate/tmp/hook-outputs/');
    expect(existsSync(join(dgProj, '.donegate', 'STEER.md'))).toBe(false);

    const steerHist = readFileSync(join(dgProj, '.donegate', 'steer-history.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l));
    expect(steerHist).toHaveLength(1);
    expect(steerHist[0].directive).toContain('【首部纠偏目标】');
  });

  it('⑤ command-guard-rules 严拦删改 STOP / STEER.md / guard-events.jsonl 与 FORBIDDEN_AGENT_MCP_MUTATIONS 断言', () => {
    expect(Object.isFrozen(FORBIDDEN_AGENT_MCP_MUTATIONS)).toBe(true);
    expect(FORBIDDEN_AGENT_MCP_MUTATIONS).toEqual(['freeze', 'promote', 'verify-apply', 'retire', 'overlay-confirm']);
    for (const m of ['freeze', 'promote', 'verify-apply', 'retire', 'overlay-confirm', 'dg_verify_apply', 'mcp__donegate__freeze']) {
      expect(isForbiddenAgentMcpMutation(m)).toBe(true);
    }
    for (const okTool of ['status', 'dg_status', 'dg_slice', 'dg_lint_edit', 'dg_check_node', '']) {
      expect(isForbiddenAgentMcpMutation(okTool)).toBe(false);
    }

    const blockedCmds = [
      'rm .donegate/STOP',
      'del .donegate\\STOP',
      'mv .donegate/STEER.md .donegate/STEER.bak',
      'echo "forged" > .donegate/STEER.md',
      ': > .donegate/guard-events.jsonl',
      'truncate -s 0 .donegate/guard-events.jsonl',
      'sed -i "s/.*/ok/" .donegate/STEER.md',
      'node -e "require(\'fs\').unlinkSync(\'.donegate/STOP\')"',
      'bash -c "rm .donegate/guard-events.jsonl"',
      'donegate flow overlay-confirm'
    ];
    for (const cmd of blockedCmds) {
      const res = auditAgentShellCommand(cmd);
      expect(res.allowed, `expected blocked: ${cmd}`).toBe(false);
    }

    // 正常提交说明提及文件名与只读查看不得误伤
    expect(auditAgentShellCommand('git commit -m "feat: protect .donegate/STOP and .donegate/STEER.md"').allowed).toBe(true);
    expect(auditAgentShellCommand('cat .donegate/guard-events.jsonl').allowed).toBe(true);
  });

  it('⑥ HookOutputSpiller 超预算预扣页脚保留首尾修复配方，并严格落盘工作区内 .donegate/tmp/hook-outputs/', () => {
    expect(DEFAULT_HOOK_OUTPUT_TOKEN_BUDGET).toBe(2500);
    expect(CHARS_PER_TOKEN_ESTIMATE).toBe(3.2);
    expect(DEFAULT_HOOK_OUTPUT_CHAR_BUDGET).toBe(8000);

    const wsRoot = makeTempDir('dg-s29-spiller-');
    const shortRes = maybeSpillHookOutput(wsRoot, '✓ lint-edit passed cleanly');
    expect(shortRes).toEqual({
      spilled: false,
      output: '✓ lint-edit passed cleanly',
      logRelPath: null,
      logAbsPath: null,
      originalLength: 26
    });
    expect(existsSync(join(wsRoot, '.donegate', 'tmp', 'hook-outputs'))).toBe(false);

    const rawLong = [
      '✗ HEAD_SUMMARY: 检出认知复杂度超限 (src/engine.mjs:L42)',
      '  stack detail line 0123456789abcdef'.repeat(40),
      '↳ 修复配方 (TAIL_RECIPE)：请提取子函数并使用早返回降低嵌套层级'
    ].join('\n');
    const spilled = maybeSpillHookOutput(wsRoot, rawLong, { charBudget: 320, runId: 'unit-spill-01' });
    expect(spilled.spilled).toBe(true);
    expect(spilled.originalLength).toBe(rawLong.length);
    expect(spilled.logRelPath).toBe('.donegate/tmp/hook-outputs/unit-spill-01.log');
    expect(spilled.output.length).toBeLessThanOrEqual(320);
    expect(spilled.output).toContain('HEAD_SUMMARY');
    expect(spilled.output).toContain('修复配方 (TAIL_RECIPE)');
    expect(spilled.output).toContain('.donegate/tmp/hook-outputs/unit-spill-01.log');
    expect(readFileSync(spilled.logAbsPath, 'utf8')).toBe(rawLong);
  });
});
