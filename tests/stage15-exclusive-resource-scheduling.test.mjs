// Stage 15 测试：Bazel/CTest/OpenHTF 契约执行画像、envPassthrough、preFlightPlug 与混合 Worktree/宿主机串行挂机调度
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSanitizedEnv } from '../runner/core/contract.mjs';
import { cmdCheck, cmdContractFreeze, cmdContractNew, cmdInit } from '../runner/core/commands-a.mjs';
import { validateContractSchema } from '../skill/schema-lite.mjs';
import { planCampaignExecutionStrategy } from '../runner/dsh/campaign-routing.mjs';
import { approveAndResumeCampaignAutopilot, executeProjectCampaignAutopilot } from '../runner/dsh/campaign-autopilot.mjs';

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-s15-exec-'));
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'dev@local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Dev']);
  cmdInit(dir);
  spawnSync('git', ['-C', dir, 'config', 'core.hooksPath', '.git/hooks']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  return dir;
}

describe('Stage 15: Bazel/CTest/OpenHTF 独占资源与混合执行调度', () => {
  it('schema-lite 校验 execution 块，isolation.mjs 按 envPassthrough 精准放行 Python/CAD 环境变量', () => {
    const valid = {
      id: 'sw-com',
      obligations: [{ id: 'o1', kind: 'command', command: 'echo ok', expect: { exitCode: 0 } }],
      execution: {
        sandbox: 'host-local',
        resourceLocks: ['solidworks-com', 'windows-desktop-focus'],
        preFlightPlug: 'node -e "process.exit(0)"',
        envPassthrough: ['VIRTUAL_ENV', 'PYTHONPATH'],
        operatorVisualCheck: true
      }
    };
    expect(validateContractSchema(valid, { full: false })).toEqual([]);
    const invalid = { ...valid, execution: { sandbox: 'invalid-mode' } };
    expect(validateContractSchema(invalid, { full: false }).some((e) => e.includes('/execution/sandbox'))).toBe(true);

    const fakeVenv = join(tmpdir(), 'mock-proj', '.venv');
    const fakePyPath = join(tmpdir(), 'mock-proj', 'src');
    const mockBase = {
      PATH: process.env.PATH || '',
      VIRTUAL_ENV: fakeVenv,
      PYTHONPATH: fakePyPath,
      SECRET_TOKEN: 'should-be-stripped'
    };
    const sanitizedDefault = buildSanitizedEnv(mockBase, {}, { cwd: process.cwd() });
    expect(sanitizedDefault.VIRTUAL_ENV).toBeUndefined();
    expect(sanitizedDefault.SECRET_TOKEN).toBeUndefined();

    const sanitizedAllow = buildSanitizedEnv(mockBase, {}, { cwd: process.cwd(), envPassthrough: ['VIRTUAL_ENV', 'PYTHONPATH'] });
    expect(sanitizedAllow.VIRTUAL_ENV).toBe(fakeVenv);
    expect(sanitizedAllow.PYTHONPATH).toBe(fakePyPath);
    expect(sanitizedAllow.SECRET_TOKEN).toBeUndefined();
  });

  it('cmdCheck 支持 preFlightPlug 失败阻断（退 3）及 human 判据附带 evidenceFiles 落盘', () => {
    const dir = makeTempProject();
    try {
      cmdContractNew(dir, { id: 'sw-driver', title: 'SolidWorks COM 驱动', scope: 'src/sw/' });
      const cPath = join(dir, 'contracts', 'sw-driver', 'contract.json');
      const doc = JSON.parse(readFileSync(cPath, 'utf8'));
      doc.execution = {
        sandbox: 'host-local',
        resourceLocks: ['solidworks-com'],
        preFlightPlug: 'node -e "console.error(\'sw dialog open\'); process.exit(1)"',
        operatorVisualCheck: true
      };
      doc.obligations = [
        {
          id: 'ob-cmd', kind: 'command', command: 'node -e "process.exit(0)"', expect: { exitCode: 0 },
          required: true, claim: 'COM 建模命令返回 0', observable: 'exitCode=0', scope: '仅测试驱动',
          inputClasses: ['正常'], servesSuccessCriterion: '（请填写至少一条可外部观察的成功判据）'
        },
        {
          id: 'ob-visual', kind: 'human', expect: { standard: '人工目视确认实体无干涉' },
          required: true, claim: '实体几何外观正确', observable: '截图与人工确认', scope: '仅检查外观',
          inputClasses: ['正常'], servesSuccessCriterion: '（请填写至少一条可外部观察的成功判据）'
        }
      ];
      writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      cmdContractFreeze(dir, { id: 'sw-driver', by: '张工' });
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add sw contract']);

      // preFlightPlug 失败立即退 3 阻断
      const failPlug = cmdCheck(dir, { id: 'sw-driver', skipGates: true });
      expect(failPlug.exitCode).toBe(3);
      expect(failPlug.code).toBe('PREFLIGHT_PLUG_FAILED');

      // 修复 preFlightPlug 后执行并通过 --human-pass + --human-evidence 落盘结构化目视证据
      doc.execution.preFlightPlug = 'node -e "process.exit(0)"';
      writeFileSync(cPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      const okChk = cmdCheck(dir, {
        id: 'sw-driver',
        skipGates: true,
        allowDirty: true,
        humanPass: true,
        humanEvidence: 'artifacts/sw_preview.png'
      });
      expect(okChk.exitCode).toBe(0);
      expect(okChk.stdout).toContain('ob-visual (human): pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('混合 Campaign 分波调度：纯 Python 卡走 Worktree 过夜，SolidWorks 真机卡自动在宿主串行并触发人工目视挂起与续跑', async () => {
    const dir = makeTempProject();
    try {
      mkdirSync(join(dir, 'src', 'kb'), { recursive: true });
      mkdirSync(join(dir, 'src', 'sw'), { recursive: true });
      writeFileSync(join(dir, 'src', 'kb', 'rules.py'), 'def check(): return True\n', 'utf8');
      writeFileSync(join(dir, 'src', 'sw', 'com.py'), 'def run(): return True\n', 'utf8');
      spawnSync('git', ['-C', dir, 'add', '.']);
      spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add py sources']);

      const nodes = [
        { id: 'py-kb', title: '纯 Python 规则库', scopePaths: ['src/kb/'], nextIds: ['sw-real'] },
        { id: 'py-ir', title: '纯 Python IR 校验', scopePaths: ['src/ir/'], nextIds: ['sw-real'] },
        {
          id: 'sw-real',
          title: 'SolidWorks 真机建模',
          scopePaths: ['src/sw/'],
          execution: {
            sandbox: 'host-local',
            resourceLocks: ['solidworks-com', 'windows-desktop-focus'],
            preFlightPlug: 'node -e "process.exit(0)"',
            operatorVisualCheck: true
          }
        }
      ];

      const plan = planCampaignExecutionStrategy(nodes, [], { projectRoot: dir });
      expect(plan.mode).toBe('hybrid-worktree-and-host-serial');
      expect(plan.hasHostLocalNodes).toBe(true);
      expect(plan.exclusiveResourceLocks).toEqual(['solidworks-com', 'windows-desktop-focus']);
      expect(plan.waves[0].parallelizable).toBe(true);
      expect(plan.waves[1].sandboxMode).toBe('host-local');
      expect(plan.waves[1].parallelizable).toBe(false);

      const noopPack = {
        id: 'pack-noop',
        name: '空跑验证流',
        nodes: [{ id: 'n1', tplId: 'tpl-prompt-gen', title: '模拟步骤', x: 0, y: 0 }],
        links: []
      };
      const componentWorkflows = {
        'py-kb': { mode: 'macro', baseMacroName: '纯Python流', pack: noopPack },
        'py-ir': { mode: 'macro', baseMacroName: '纯Python流', pack: noopPack },
        'sw-real': { mode: 'macro', baseMacroName: '真机COM流', pack: noopPack }
      };
      const visited = [];
      const hooks = {
        runAgentStep: async ({ ticket }) => {
          visited.push(ticket.targetUri);
          return { exitCode: 0, detail: 'ok' };
        }
      };

      // 第一夜：纯 Python 卡全部跑完，到达 sw-real 自动挂起在人工目视闸门
      const nightRes = await executeProjectCampaignAutopilot(dir, {
        campaignId: 'camp-hybrid-1',
        nodes,
        links: [],
        componentWorkflows,
        useWorktreeSandbox: false
      }, hooks);
      expect(nightRes.ok).toBe(true);
      expect(nightRes.suspended).toBe(true);
      expect(nightRes.suspendedComponentId).toBe('sw-real');
      expect(nightRes.pendingHumanGate.kind).toBe('operator-visual-check');
      expect(nightRes.campaign.completedComponentIds).toEqual(['py-kb', 'py-ir']);

      // 次日人工目视放行：恢复执行 sw-real 并整单完工
      const morningRes = await approveAndResumeCampaignAutopilot(dir, {
        campaignId: 'camp-hybrid-1',
        by: '张工',
        note: 'SolidWorks 实机目视确认无干涉'
      }, hooks);
      expect(morningRes.ok).toBe(true);
      expect(morningRes.state).toBe('COMPLETED');
      expect(morningRes.completedCount).toBe(3);
      expect(morningRes.componentReports.find((r) => r.nodeId === 'sw-real')?.sandboxUsed).toBe('host-local');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
