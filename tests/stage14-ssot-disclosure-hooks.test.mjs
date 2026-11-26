// Stage 14：全端 SSOT 合一（进度卡/交接包/早间简报防伪底线关闭红字披露 + pre-commit 钩子联动 + 挂机信任回写）单测
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { renderProgressBlock } from '../runner/core/progress.mjs';
import { cmdHandover } from '../runner/core/cmd-handover-verify.mjs';
import { createInitialCheckpoint } from '../runner/dsh/autopilot/autopilot-state.mjs';
import { wfcSaveProjectOverlay } from '../runner/dsh/autopilot/workflow-compiler.mjs';
import { buildPreCommitScript } from '../skill/install-hooks.mjs';
import { executeDeterministicWorkflowRun } from '../runner/dsh/autopilot/workflow-runner.mjs';
import { tlLoadTrustLedger } from '../runner/dsh/autopilot/trust-ladder.mjs';

describe('stage14: full-stack SSOT disclosure banners, pre-commit hook sync & trust feedback', () => {
  it('propagates prominent red integrity disclosure across progress card, HANDOVER.md, and MORNING-BRIEF.md', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s14-disc-'));
    try {
      expect(dispatchCommand(['init'], tmp).exitCode).toBe(0);
      wfcSaveProjectOverlay(tmp, 'dg-pre-commit', {
        toggleNodes: { 'pc-commit-hygiene': { bypassed: true, reason: '演示关闭防伪底线红字提醒' } }
      }, { actorRole: 'human', confirmedByHuman: true });

      const progressTxt = renderProgressBlock(tmp);
      expect(progressTxt).toContain('已关闭防伪底线');
      expect(progressTxt).toContain('四维提交预算与防作弊拦截');

      const hoRes = cmdHandover(tmp);
      expect(hoRes.exitCode).toBe(0);
      const hoMd = readFileSync(join(tmp, 'HANDOVER.md'), 'utf8');
      expect(hoMd).toContain('[!CAUTION]');
      expect(hoMd).toContain('已关闭防伪底线');

      const cp = createInitialCheckpoint(tmp, 'run-disc-1', { id: 'dg-pre-commit', name: '提交前把关' });
      const briefMd = readFileSync(join(tmp, '.donegate', 'runs', cp.runId, 'MORNING-BRIEF.md'), 'utf8');
      expect(briefMd).toContain('[!CAUTION]');
      expect(briefMd).toContain('四维提交预算与防作弊拦截');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wires pre-commit hook to governance overlay SSOT with safe fallback and records autopilot trust outcomes', async () => {
    const hookScript = buildPreCommitScript('/tmp/demo-proj', '/opt/donegate');
    expect(hookScript).toContain('.donegate/workflows/overrides/dg-pre-commit.overlay.json');
    expect(hookScript).toContain('flow run dg-pre-commit --staged');
    expect(hookScript).toContain('check-commit-hygiene.mjs');

    const tmp = mkdtempSync(join(tmpdir(), 'dg-s14-trust-run-'));
    try {
      const pack = {
        id: 'dg-on-edit',
        name: '编辑秒查',
        nodes: [{ id: 'edit-term-check', title: '术语检查', exec: { kind: 'adapter_gate', nodeArgs: ['-e', 'process.exit(0)'] } }],
        links: []
      };
      const out = await executeDeterministicWorkflowRun(tmp, { ticketId: 'tr-1' }, pack, { modelId: 'model-alpha' });
      expect(out.ok).toBe(true);
      const ledger = tlLoadTrustLedger(tmp);
      expect(ledger.lastModelId).toBe('model-alpha');
      expect(ledger.records['model-alpha::dg-on-edit::edit-term-check'].cleanStreak).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
