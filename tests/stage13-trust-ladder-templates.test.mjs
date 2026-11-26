// Stage 13：模型信任阶梯（零开局选档、8 轮稳定克制建议最多 1 条、永不建议关底线、换弱模型/漏网回系）与个人模板跨项目复用单测
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRUST_LADDER_DEFAULT_STREAK,
  tlComputeRestrainedSuggestions,
  tlDismissSuggestion,
  tlRecordEscapeRelapse,
  tlRecordRuleOutcomes
} from '../runner/dsh/autopilot/trust-ladder.mjs';
import {
  gtApplyPersonalTemplate,
  gtListPersonalTemplates,
  gtSavePersonalTemplate
} from '../runner/dsh/autopilot/governance-templates.mjs';
import { wfcCompileWorkflow, wfcSaveProjectOverlay } from '../runner/dsh/autopilot/workflow-compiler.mjs';

describe('stage13: restrained model trust ladder & personal reusable governance templates', () => {
  it('stays silent before streak threshold, suggests at most 1 non-integrity rule after 8 clean runs, and alerts re-enable on relapse/new model', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s13-trust-'));
    try {
      for (let i = 0; i < TRUST_LADDER_DEFAULT_STREAK - 1; i++) {
        tlRecordRuleOutcomes(tmp, {
          modelId: 'frontier-x',
          flowId: 'dg-pre-commit',
          outcomes: [
            { nodeId: 'pc-commit-hygiene', title: '四维提交预算', tier: 'integrity', passed: true },
            { nodeId: 'pc-doc-budgets', title: '文档体积预算', tier: 'recommended', passed: true },
            { nodeId: 'pc-symbols-gate', title: '重复函数检查', tier: 'optional', passed: true }
          ]
        });
      }
      const tooEarly = tlComputeRestrainedSuggestions(tmp, { modelId: 'frontier-x' });
      expect(tooEarly.suggestions).toHaveLength(0);

      // 8th clean pass triggers at most 1 restrained suggestion, never an integrity rule
      tlRecordRuleOutcomes(tmp, {
        modelId: 'frontier-x',
        flowId: 'dg-pre-commit',
        outcomes: [
          { nodeId: 'pc-commit-hygiene', title: '四维提交预算', tier: 'integrity', passed: true },
          { nodeId: 'pc-doc-budgets', title: '文档体积预算', tier: 'recommended', passed: true },
          { nodeId: 'pc-symbols-gate', title: '重复函数检查', tier: 'optional', passed: true }
        ]
      });
      const ready = tlComputeRestrainedSuggestions(tmp, { modelId: 'frontier-x' });
      expect(ready.suggestions).toHaveLength(1);
      expect(ready.suggestions[0].tier).not.toBe('integrity');
      expect(ready.suggestions[0].kind).toBe('relax');

      // Dismissing suppresses repeat prompt for that node
      tlDismissSuggestion(tmp, { modelId: 'frontier-x', flowId: 'dg-pre-commit', nodeId: ready.suggestions[0].nodeId });
      const afterDismiss = tlComputeRestrainedSuggestions(tmp, { modelId: 'frontier-x' });
      expect(afterDismiss.suggestions.every((s) => s.nodeId !== ready.suggestions[0].nodeId)).toBe(true);

      // User decides to bypass pc-doc-budgets -> switching to an unobserved model triggers seatbelt re-enable alert
      wfcSaveProjectOverlay(tmp, 'dg-pre-commit', {
        toggleNodes: { 'pc-doc-budgets': { bypassed: true, reason: '模型已稳定' } }
      }, { actorRole: 'human', confirmedByHuman: true });
      const weakModel = tlComputeRestrainedSuggestions(tmp, { modelId: 'small-mini-v1' });
      expect(weakModel.reenableAlerts.some((a) => a.nodeId === 'pc-doc-budgets' && a.kind === 'reenable')).toBe(true);

      // Escape relapse on frontier-x also triggers seatbelt re-enable alert
      tlRecordEscapeRelapse(tmp, { modelId: 'frontier-x', flowId: 'dg-pre-commit', nodeId: 'pc-doc-budgets' });
      const relapsed = tlComputeRestrainedSuggestions(tmp, { modelId: 'frontier-x' });
      expect(relapsed.reenableAlerts.some((a) => a.nodeId === 'pc-doc-budgets' && a.reason.includes('漏网复发'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('saves project overlays into a personal template and applies it cleanly to a brand-new project', () => {
    const projA = mkdtempSync(join(tmpdir(), 'dg-s13-projA-'));
    const projB = mkdtempSync(join(tmpdir(), 'dg-s13-projB-'));
    const tplDir = mkdtempSync(join(tmpdir(), 'dg-s13-tpls-'));
    try {
      wfcSaveProjectOverlay(projA, 'dg-pre-commit', {
        patchConfig: { 'pc-doc-budgets': { rootAgentsMaxBytes: 12288 } }
      }, { actorRole: 'human', confirmedByHuman: true });

      const saved = gtSavePersonalTemplate(projA, '我的日常主力配置', { templatesDir: tplDir });
      expect(saved.ok).toBe(true);
      expect(saved.template.flowIds).toContain('dg-pre-commit');

      const listed = gtListPersonalTemplates({ templatesDir: tplDir });
      expect(listed).toHaveLength(1);
      expect(listed[0].name).toBe('我的日常主力配置');

      const workerDenied = gtApplyPersonalTemplate(projB, '我的日常主力配置', {
        templatesDir: tplDir, actorRole: 'worker', confirmedByHuman: true
      });
      expect(workerDenied.ok).toBe(false);
      expect(workerDenied.exitCode).toBe(2);

      const applied = gtApplyPersonalTemplate(projB, '我的日常主力配置', {
        templatesDir: tplDir, actorRole: 'human', confirmedByHuman: true
      });
      expect(applied.ok).toBe(true);
      expect(applied.appliedCount).toBe(1);

      const compiledB = wfcCompileWorkflow(projB, 'dg-pre-commit');
      expect(compiledB.effectivePack.nodes.find((n) => n.id === 'pc-doc-budgets')?.config.rootAgentsMaxBytes).toBe(12288);
    } finally {
      rmSync(projA, { recursive: true, force: true });
      rmSync(projB, { recursive: true, force: true });
      rmSync(tplDir, { recursive: true, force: true });
    }
  });
});
