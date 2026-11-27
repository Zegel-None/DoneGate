// 第四阶段工业级验证加固对抗单测：冻结测试基线重放、PreToolUse 防绕过/防代签、回合增量快照 3 次熔断与观察期采纳率
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  cmdCheck,
  cmdCheckNode,
  cmdContractFreeze,
  cmdContractNew,
  cmdInit,
  verifyProjectNotes
} from '../runner/core/index.mjs';
import { readAndVerifyChain } from '../runner/core/chain.mjs';
import { auditAgentShellCommand } from '../runner/shared/command-guard-rules.mjs';
import { antigravityHarnessAdapter } from '../runner/harnesses/antigravity-adapter.mjs';
import {
  cmdGovernanceFlow,
  tlComputeRestrainedSuggestions,
  tlRecordRuleOutcomes,
  wfcCompileWorkflow,
  wfcProbeEnvCoeffects,
  wfcSaveProjectOverlay
} from '../runner/dsh/autopilot/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const tmpDirs = [];

function makeTempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function runGit(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
}

function initGitRepo(cwd) {
  runGit(cwd, ['init', '-q']);
  runGit(cwd, ['config', 'user.email', 'test@donegate.local']);
  runGit(cwd, ['config', 'user.name', 'Tester']);
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }); } catch (err) { void err; }
  }
});

describe('stage26: industrial verification hardening (4 cuts)', () => {
  it('① 第一刀：拦截改弱测试断言凑绿 (HELDOUT_TEST_WEAKENED)、删测试、改 package.json 脚本与跨契约偷改测试，放行合法追加断言', () => {
    const tmp = makeTempDir('dg-s26-cut1-');
    initGitRepo(tmp);
    expect(cmdInit(tmp).exitCode).toBe(0);

    mkdirSync(join(tmp, 'src'), { recursive: true });
    mkdirSync(join(tmp, 'tests'), { recursive: true });
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'demo-cut1',
      version: '1.0.0',
      type: 'module',
      scripts: { test: 'node tests/calc.test.mjs' }
    }, null, 2) + '\n');
    writeFileSync(join(tmp, 'src/calc.mjs'), 'export function add(a, b) {\n  return a + b;\n}\n');
    const origTestCode = [
      "import assert from 'node:assert/strict';",
      "import { add } from '../src/calc.mjs';",
      'assert.equal(add(2, 3), 5);',
      'assert.equal(add(-2, 2), 0);',
      ''
    ].join('\n');
    writeFileSync(join(tmp, 'tests/calc.test.mjs'), origTestCode);

    writeFileSync(join(tmp, 'src/other.mjs'), 'export const flag = true;\n');
    writeFileSync(join(tmp, 'tests/other.test.mjs'), "import assert from 'node:assert/strict';\nimport { flag } from '../src/other.mjs';\nassert.equal(flag, true);\n");

    expect(cmdContractNew(tmp, { id: 'calc', title: '计算器', scope: 'src/calc.mjs' }).exitCode).toBe(0);
    expect(cmdContractNew(tmp, { id: 'other', title: '邻居模块', scope: 'src/other.mjs' }).exitCode).toBe(0);

    const calcContractPath = join(tmp, 'contracts/calc/contract.json');
    const calcContract = JSON.parse(readFileSync(calcContractPath, 'utf8'));
    calcContract.obligations = [{
      id: 'calc-unit',
      claim: '加法对正负数精确成立',
      kind: 'command',
      command: 'node tests/calc.test.mjs',
      expect: { exitCode: 0 },
      required: true,
      observable: 'node tests/calc.test.mjs 退出码为 0',
      scope: 'src/calc.mjs',
      inputClasses: ['正常', '边界', '异常'],
      servesSuccessCriterion: '（请填写至少一条可外部观察的成功判据）'
    }];
    writeFileSync(calcContractPath, JSON.stringify(calcContract, null, 2) + '\n');

    const otherContractPath = join(tmp, 'contracts/other/contract.json');
    const otherContract = JSON.parse(readFileSync(otherContractPath, 'utf8'));
    otherContract.obligations = [{
      id: 'other-unit',
      claim: '邻居标志位为真',
      kind: 'command',
      command: 'node tests/other.test.mjs',
      expect: { exitCode: 0 },
      required: true,
      observable: 'node tests/other.test.mjs 退出码为 0',
      scope: 'src/other.mjs',
      inputClasses: ['正常', '边界', '异常'],
      servesSuccessCriterion: '（请填写至少一条可外部观察的成功判据）'
    }];
    writeFileSync(otherContractPath, JSON.stringify(otherContract, null, 2) + '\n');

    runGit(tmp, ['add', '.']);
    runGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed code and tests', '--no-verify']);

    expect(cmdContractFreeze(tmp, { id: 'calc', by: 'Zegel', legacy: true }).exitCode).toBe(0);
    expect(cmdContractFreeze(tmp, { id: 'other', by: 'Zegel', legacy: true }).exitCode).toBe(0);
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'freeze contracts', '--no-verify']);

    const chain = readAndVerifyChain(tmp);
    const calcFreeze = chain.entries.filter((e) => e.kind === 'freeze' && e.contractId === 'calc').pop();
    expect(calcFreeze.frozenTestHashes['tests/calc.test.mjs']).toMatch(/^[a-f0-9]{64}$/);
    expect(calcFreeze.frozenScriptHashes.test).toBeTruthy();

    // 攻击 1a：写坏实现 + 改弱测试断言凑绿 -> check 与 check-node 均必须退 2 (HELDOUT_TEST_WEAKENED)，且不破坏工作区当前文本
    const weakenedTest = "import assert from 'node:assert/strict';\nimport { add } from '../src/calc.mjs';\nassert.equal(typeof add(2, 3), 'number');\n";
    writeFileSync(join(tmp, 'src/calc.mjs'), 'export function add(a) {\n  return a;\n}\n');
    writeFileSync(join(tmp, 'tests/calc.test.mjs'), weakenedTest);

    const chkWeak = cmdCheck(tmp, { id: 'calc', allowDirty: true });
    expect(chkWeak.exitCode).toBe(2);
    expect(chkWeak.stderr).toContain('HELDOUT_TEST_WEAKENED');
    expect(readFileSync(join(tmp, 'tests/calc.test.mjs'), 'utf8')).toBe(weakenedTest);

    const nodeWeak = cmdCheckNode(tmp, { id: 'calc', allowDirty: true });
    expect(nodeWeak.exitCode).toBe(2);
    expect(nodeWeak.stderr).toContain('HELDOUT_TEST_WEAKENED');

    // 正样本 1b：修复实现 + 在原测试基础上追加更严格的新断言 -> 原基线重放全绿，放行退 0
    writeFileSync(join(tmp, 'src/calc.mjs'), 'export function add(a, b) {\n  return a + b;\n}\n');
    writeFileSync(join(tmp, 'tests/calc.test.mjs'), origTestCode + 'assert.equal(add(100, 200), 300);\n');
    const nodeStronger = cmdCheckNode(tmp, { id: 'calc', allowDirty: true });
    expect(nodeStronger.exitCode).toBe(0);

    // 攻击 1c：直接删除已冻结测试文件 -> 退 2 (HELDOUT_TEST_DELETED)
    unlinkSync(join(tmp, 'tests/calc.test.mjs'));
    const nodeDeleted = cmdCheckNode(tmp, { id: 'calc', allowDirty: true });
    expect(nodeDeleted.exitCode).toBe(2);
    expect(nodeDeleted.stderr).toContain('HELDOUT_TEST_DELETED');
    writeFileSync(join(tmp, 'tests/calc.test.mjs'), origTestCode);

    // 攻击 1d：篡改 package.json#scripts -> 退 2 (HELDOUT_SCRIPT_TAMPERED)
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'demo-cut1', version: '1.0.0', type: 'module', scripts: { test: 'node -e "process.exit(0)"' }
    }, null, 2) + '\n');
    const nodeScriptTamper = cmdCheckNode(tmp, { id: 'calc', allowDirty: true });
    expect(nodeScriptTamper.exitCode).toBe(2);
    expect(nodeScriptTamper.stderr).toContain('HELDOUT_SCRIPT_TAMPERED');
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      name: 'demo-cut1', version: '1.0.0', type: 'module', scripts: { test: 'node tests/calc.test.mjs' }
    }, null, 2) + '\n');

    // 攻击 1e：在 calc 节点任务中跨契约偷改 other 锁定的测试文件 -> 退 2 (HELDOUT_FOREIGN_TEST_TOUCHED)
    writeFileSync(join(tmp, 'tests/other.test.mjs'), '// tampered foreign test\n');
    const nodeForeign = cmdCheckNode(tmp, { id: 'calc', allowDirty: true });
    expect(nodeForeign.exitCode).toBe(2);
    expect(nodeForeign.stderr).toContain('HELDOUT_FOREIGN_TEST_TOUCHED');
  });

  it('② 第二刀：PreToolUse 命令审计精准硬拦 --no-verify / 篡改钩子 / AI 代签人类命令，且不误伤提交说明与普通项目', () => {
    expect(auditAgentShellCommand('git commit -m "wip" --no-verify').allowed).toBe(false);
    expect(auditAgentShellCommand('git commit -am "quick" -n').allowed).toBe(false);
    expect(auditAgentShellCommand('git push origin main --no-verify').allowed).toBe(false);
    expect(auditAgentShellCommand('git -c core.hooksPath=/tmp commit -m "bypass"').allowed).toBe(false);
    expect(auditAgentShellCommand('rm -rf .githooks/pre-commit').allowed).toBe(false);
    expect(auditAgentShellCommand('pwsh -Command "git commit --no-verify -m nested"').allowed).toBe(false);

    const freezeHit = auditAgentShellCommand('node runner/donegate.mjs contract freeze my-card --by Zegel');
    expect(freezeHit.allowed).toBe(false);
    expect(freezeHit.code).toBe('HUMAN_AUTHORITY_DENIED');
    expect(auditAgentShellCommand('donegate contract promote card-a --by Zegel').allowed).toBe(false);
    expect(auditAgentShellCommand('node "/opt/repo/runner/donegate.mjs" verify apply pack --verdict v.json').allowed).toBe(false);
    expect(auditAgentShellCommand('echo "{}" > .donegate/chain.jsonl').allowed).toBe(false);

    // 零误报正样本：提交说明中提及敏感词、常规测试与只读命令均放行
    expect(auditAgentShellCommand('git commit -m "block --no-verify and donegate contract freeze in PreToolUse"').allowed).toBe(true);
    expect(auditAgentShellCommand('git config --get core.hooksPath').allowed).toBe(true);
    expect(auditAgentShellCommand('node runner/donegate.mjs status --tree').allowed).toBe(true);
    expect(auditAgentShellCommand('npx vitest run tests/donegate-core.test.mjs').allowed).toBe(true);
  });

  it('③ 第三刀：随身钩子通过回合增量快照抓获脚本改码与未跟踪脏文件，支持指纹去重与连续 3 次拦截防死锁熔断留痕', () => {
    const pluginDir = makeTempDir('dg-s26-plugin-');
    const dgProj = makeTempDir('dg-s26-proj-');
    const plainProj = makeTempDir('dg-s26-plain-');
    initGitRepo(dgProj);
    expect(cmdInit(dgProj).exitCode).toBe(0);
    mkdirSync(join(dgProj, 'src'), { recursive: true });
    runGit(dgProj, ['add', '.']);
    runGit(dgProj, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init dg proj', '--no-verify']);

    const inst = antigravityHarnessAdapter.install({ pluginDir, donegateRoot: REPO_ROOT });
    expect(inst.ok).toBe(true);
    const guardPath = join(pluginDir, 'hooks', 'donegate-guard.mjs');
    const runHook = (payload) => {
      const r = spawnSync(process.execPath, [guardPath], {
        cwd: pluginDir,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        windowsHide: true
      });
      expect(r.status).toBe(0);
      return JSON.parse(r.stdout);
    };

    // 普通非 DoneGate 项目即使传 --no-verify 也零打扰放行
    expect(runHook({
      hookEventName: 'PreToolUse',
      cwd: plainProj,
      toolCall: { name: 'run_command', args: { CommandLine: 'git commit --no-verify -m "plain"' } }
    })).toEqual({ decision: 'allow' });

    // DoneGate 项目内 PreToolUse 硬拦截 --no-verify
    const preDeny = runHook({
      hookEventName: 'PreToolUse',
      cwd: dgProj,
      toolCall: { name: 'run_command', args: { CommandLine: 'git commit --no-verify -m "cheat"' } }
    });
    expect(preDeny.decision).toBe('deny');
    expect(preDeny.reason).toContain('--no-verify');

    // 回合起点拍基线 -> 模拟 AI 用脚本生成未跟踪脏文件（未触发 edit_file PostToolUse）
    runHook({ hookEventName: 'PreInvocation', cwd: dgProj, conversationId: 'conv-breaker' });
    writeFileSync(join(dgProj, 'src/script-gen.mjs'), 'export function bad() {\n  // TO' + 'DO: unfinished\n  return 1;\n}\n');

    // 第 1、2、3 次 Stop 均精准抓获脚本生成的新文件并要求继续修复
    for (let i = 1; i <= 3; i++) {
      const st = runHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', cwd: dgProj, conversationId: 'conv-breaker' });
      expect(st.decision).toBe('continue');
      expect(st.reason).toContain(`(${i}/3)`);
      expect(st.reason).toContain('src/script-gen.mjs');
    }

    // 第 4 次触发防死锁上限熔断放行，并向 .donegate/notes.jsonl 写入带合法防伪印章的报忧条目
    const st4 = runHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', cwd: dgProj, conversationId: 'conv-breaker' });
    expect(st4.decision).toBe('allow');
    const notesRes = verifyProjectNotes(dgProj);
    expect(notesRes.ok).toBe(true);
    expect(notesRes.valid.length).toBe(1);
    expect(notesRes.valid[0].kind).toBe('worry');
    expect(notesRes.valid[0].detail).toContain('src/script-gen.mjs');

    // 修绿后新开一轮验证通过即放行且哈希去重生效
    writeFileSync(join(dgProj, 'src/script-gen.mjs'), 'export function cleanFn() {\n  return 42;\n}\n');
    runHook({ hookEventName: 'PreInvocation', cwd: dgProj, conversationId: 'conv-clean' });
    writeFileSync(join(dgProj, 'src/clean-extra.mjs'), 'export const extra = 7;\n');
    const stClean = runHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', cwd: dgProj, conversationId: 'conv-clean' });
    expect(stClean.decision).toBe('allow');
  });

  it('④ 第四刀：Diff 条件探针按改动范围激活，且 observe 模式告警不阻断、自动统计采纳率建议晋升或修剪高误报规则', () => {
    const tmp = makeTempDir('dg-s26-cut4-');
    initGitRepo(tmp);
    expect(cmdInit(tmp).exitCode).toBe(0);
    runGit(tmp, ['add', '.']);
    runGit(tmp, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base init', '--no-verify']);

    // 干净工作区所有 diff* 探针为 false
    const cleanCo = wfcProbeEnvCoeffects(tmp);
    expect(cleanCo.diffFileCount).toBe(0);
    expect(cleanCo.diffHasCode).toBe(false);
    expect(cleanCo.diffTouchesTests).toBe(false);

    // 修改测试与配置文件后 diff* 探针精确感知
    mkdirSync(join(tmp, 'tests'), { recursive: true });
    writeFileSync(join(tmp, 'tests/sample.test.mjs'), 'export const t = 1;\n');
    writeFileSync(join(tmp, 'package.json'), '{"name":"x"}\n');
    const dirtyCo = wfcProbeEnvCoeffects(tmp);
    expect(dirtyCo.diffHasCode).toBe(true);
    expect(dirtyCo.diffTouchesTests).toBe(true);
    expect(dirtyCo.diffTouchesDepsOrConfig).toBe(true);
    expect(dirtyCo.diffTouchesContracts).toBe(false);

    // 将 recommended 节点设为 observe，同时确认 integrity 底线节点拒绝降级为 observe
    const saved = wfcSaveProjectOverlay(tmp, 'dg-pre-commit', {
      patchMode: {
        'pc-doc-budgets': 'observe',
        'pc-commit-hygiene': 'observe'
      },
      toggleNodes: {
        'pc-commit-hygiene': { bypassed: true, reason: '本单测聚焦测试文档预算观察期' },
        'pc-module-integrity': { bypassed: true, reason: '跳过无关检查加速单测' },
        'pc-decisions-inv13': { bypassed: true, reason: '跳过无关检查加速单测' }
      }
    }, { actorRole: 'human', confirmedByHuman: true });
    expect(saved.ok).toBe(true);

    const compiled = wfcCompileWorkflow(tmp, 'dg-pre-commit');
    const docNode = compiled.effectivePack.nodes.find((n) => n.id === 'pc-doc-budgets');
    const hygieneNode = compiled.effectivePack.nodes.find((n) => n.id === 'pc-commit-hygiene');
    expect(docNode.mode).toBe('observe');
    expect(hygieneNode.mode).toBe('enforce');

    // 制造超长段落触发 AGENTS 文档预算违规，验证 observe 节点告警但不将整体退出码置为非 0
    const bloatedAgents = ['# AGENTS', '', ...Array.from({ length: 20 }, (_, i) => `连续长段落第 ${i + 1} 行内容无空行分隔。`)].join('\n');
    writeFileSync(join(tmp, 'AGENTS.md'), bloatedAgents);

    const runRes = cmdGovernanceFlow(tmp, ['run', 'dg-pre-commit', '--model', 'sonnet-test']);
    expect(runRes.exitCode).toBe(0);
    expect(runRes.stdout).toContain('👁 [观察期告警]');
    const docItem = runRes.results.find((r) => r.nodeId === 'pc-doc-budgets');
    expect(docItem.observedWarn).toBe(true);
    expect(docItem.rawExitCode).toBe(1);

    // 修复文档后再次运行，计入第 1 次真实采纳修复；再模拟 2 轮「告警 -> 修复」（共 3 次触发、3 次修复 = 100% 采纳率）
    writeFileSync(join(tmp, 'AGENTS.md'), '# AGENTS\n\n简明守则。\n');
    expect(cmdGovernanceFlow(tmp, ['run', 'dg-pre-commit', '--model', 'sonnet-test']).exitCode).toBe(0);
    tlRecordRuleOutcomes(tmp, { modelId: 'sonnet-test', flowId: 'dg-pre-commit', outcomes: [{ nodeId: 'pc-doc-budgets', mode: 'observe', passed: false }] });
    tlRecordRuleOutcomes(tmp, { modelId: 'sonnet-test', flowId: 'dg-pre-commit', outcomes: [{ nodeId: 'pc-doc-budgets', mode: 'observe', passed: true }] });
    tlRecordRuleOutcomes(tmp, { modelId: 'sonnet-test', flowId: 'dg-pre-commit', outcomes: [{ nodeId: 'pc-doc-budgets', mode: 'observe', passed: false }] });
    tlRecordRuleOutcomes(tmp, { modelId: 'sonnet-test', flowId: 'dg-pre-commit', outcomes: [{ nodeId: 'pc-doc-budgets', mode: 'observe', passed: true }] });

    const grad = tlComputeRestrainedSuggestions(tmp, { modelId: 'sonnet-test' });
    const promote = grad.observeDecisions.find((d) => d.nodeId === 'pc-doc-budgets');
    expect(promote).toBeDefined();
    expect(promote.kind).toBe('promote-enforce');
    expect(promote.warnFired).toBe(3);
    expect(promote.warnFixed).toBe(3);

    // 再为一条高误报观察期规则写入 5 次触发 0 次修复 -> 自动给出 prune-noisy 修剪建议
    wfcSaveProjectOverlay(tmp, 'dg-pre-commit', {
      insertNodes: [{ id: 'custom-noisy-rule', title: '高噪实验规则', tier: 'optional', mode: 'observe' }]
    }, { actorRole: 'human', confirmedByHuman: true });
    for (let i = 0; i < 5; i++) {
      tlRecordRuleOutcomes(tmp, { modelId: 'sonnet-test', flowId: 'dg-pre-commit', outcomes: [{ nodeId: 'custom-noisy-rule', mode: 'observe', passed: false }] });
    }
    const grad2 = tlComputeRestrainedSuggestions(tmp, { modelId: 'sonnet-test' });
    const prune = grad2.observeDecisions.find((d) => d.nodeId === 'custom-noisy-rule');
    expect(prune).toBeDefined();
    expect(prune.kind).toBe('prune-noisy');
    expect(prune.warnFired).toBe(5);
    expect(prune.warnFixed).toBe(0);
  });
});
