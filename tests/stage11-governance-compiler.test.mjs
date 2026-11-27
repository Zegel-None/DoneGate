// Stage 11：声明式治理工作流编译器（Base+Overlay 继承 / 升级保定制 / 客户主权关闭防伪底线红字披露 / AI 提案确认）单测
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { cmdGovernanceFlow } from '../runner/dsh/autopilot/governance-flow-cli.mjs';
import {
  gdCollectDisabledIntegrityRules,
  gdFormatIntegrityBannerMarkdown,
  gdFormatIntegrityBannerText
} from '../runner/core/governance-disclosure.mjs';
import {
  wfcCompileWorkflow,
  wfcConfirmProposal,
  wfcCreateProposal,
  wfcListDefaultWorkflows,
  wfcListPendingProposals,
  wfcProbeEnvCoeffects,
  wfcResetProjectOverlay,
  wfcSaveProjectOverlay
} from '../runner/dsh/autopilot/workflow-compiler.mjs';
import { executeBrickGateNode } from '../runner/dsh/autopilot/brick-exec.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function makeSampleDefaultFlow(extraNodes = []) {
  return {
    id: 'dg-sample',
    name: '示例治理流',
    presetVersion: '1.0.0',
    nodes: [
      {
        id: 'n-heldout',
        title: 'Held-Out 防改考题校核',
        tier: 'integrity',
        slot: 'gate:heldout',
        config: { strict: true }
      },
      {
        id: 'n-doc-budget',
        title: '文档体积预算检查',
        tier: 'recommended',
        slot: 'gate:doc-budget',
        config: { rootAgentsMaxBytes: 8192 }
      },
      {
        id: 'n-private-only',
        title: '私有符号基线检查',
        tier: 'optional',
        requires: ['hasSymbolsBaseline'],
        onMissing: 'skip'
      },
      ...extraNodes
    ],
    links: [{ id: 'lk1', fromNode: 'n-heldout', toNode: 'n-doc-budget' }]
  };
}

describe('stage11: governance workflow compiler, human sovereignty disclosure & brick-exec', () => {
  it('enforces human confirmation, blocks worker edits, and emits prominent red disclosure when human disables integrity rule', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s11-comp-'));
    try {
      mkdirSync(join(tmp, 'workflows', 'defaults'), { recursive: true });
      writeFileSync(join(tmp, 'workflows', 'defaults', 'dg-sample.workflow.json'), JSON.stringify(makeSampleDefaultFlow(), null, 2));

      const workerBlocked = wfcSaveProjectOverlay(tmp, 'dg-sample', { toggleNodes: { 'n-doc-budget': { bypassed: true } } }, { actorRole: 'worker', confirmedByHuman: true });
      expect(workerBlocked.ok).toBe(false);
      expect(workerBlocked.exitCode).toBe(2);
      expect(workerBlocked.code).toBe('WORKER_CANNOT_MUTATE_GOVERNANCE');

      const unconfirmedBlocked = wfcSaveProjectOverlay(tmp, 'dg-sample', { toggleNodes: { 'n-doc-budget': { bypassed: true } } }, { actorRole: 'human', confirmedByHuman: false });
      expect(unconfirmedBlocked.ok).toBe(false);
      expect(unconfirmedBlocked.code).toBe('HUMAN_CONFIRMATION_REQUIRED');

      const humanDisabledIntegrity = wfcSaveProjectOverlay(tmp, 'dg-sample', {
        toggleNodes: { 'n-heldout': { bypassed: true, reason: '紧急调试临时关闭' } },
        patchConfig: { 'n-doc-budget': { rootAgentsMaxBytes: 12288 } },
        swapBrick: { 'n-doc-budget': 'custom-doc-checker' }
      }, { actorRole: 'human', confirmedByHuman: true });

      expect(humanDisabledIntegrity.ok).toBe(true);
      expect(humanDisabledIntegrity.workflowHash).toHaveLength(64);
      expect(humanDisabledIntegrity.disabledIntegrityRules).toHaveLength(1);
      expect(humanDisabledIntegrity.disclosureBanner).toContain('已关闭防伪底线');
      expect(humanDisabledIntegrity.effectivePack.nodes.find((n) => n.id === 'n-private-only')?.envSkipped).toBe(true);

      const disc = gdCollectDisabledIntegrityRules(tmp);
      expect(disc.hasDisabledIntegrity).toBe(true);
      expect(disc.count).toBe(1);
      expect(gdFormatIntegrityBannerText(disc)).toContain('Held-Out 防改考题校核');
      expect(gdFormatIntegrityBannerMarkdown(disc)).toContain('[!CAUTION]');

      // Official upgrade adds a new node: user overlay stays intact AND newOfficialNodes notifies user
      const upgraded = makeSampleDefaultFlow([{ id: 'n-new-v2', title: '官方新版 AI 验收节点', tier: 'recommended' }]);
      upgraded.presetVersion = '1.1.0';
      writeFileSync(join(tmp, 'workflows', 'defaults', 'dg-sample.workflow.json'), JSON.stringify(upgraded, null, 2));
      const afterUpgrade = wfcCompileWorkflow(tmp, 'dg-sample');
      expect(afterUpgrade.effectivePack.nodes.find((n) => n.id === 'n-doc-budget')?.config.rootAgentsMaxBytes).toBe(12288);
      expect(afterUpgrade.newOfficialNodes.map((n) => n.id)).toEqual(['n-new-v2']);

      const reset = wfcResetProjectOverlay(tmp, 'dg-sample', { actorRole: 'human', confirmedByHuman: true });
      expect(reset.customized).toBe(false);
      expect(gdCollectDisabledIntegrityRules(tmp).hasDisabledIntegrity).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('supports AI proposal -> preview diff -> human confirmation flow and builtin_gate/donegate_cmd execution', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s11-prop-'));
    try {
      mkdirSync(join(tmp, 'workflows', 'defaults'), { recursive: true });
      writeFileSync(join(tmp, 'workflows', 'defaults', 'dg-sample.workflow.json'), JSON.stringify(makeSampleDefaultFlow(), null, 2));

      const prop = wfcCreateProposal(tmp, 'dg-sample', {
        patchConfig: { 'n-doc-budget': { rootAgentsMaxBytes: 16384 } }
      }, { proposedBy: 'super-agent', summary: '将 AGENTS 预算放宽至 16KB' });
      expect(prop.ok).toBe(true);
      expect(prop.proposal.diffPreview.length).toBeGreaterThan(0);
      expect(wfcListPendingProposals(tmp)).toHaveLength(1);
      // Before confirmation, active config is unchanged
      expect(wfcCompileWorkflow(tmp, 'dg-sample').effectivePack.nodes.find((n) => n.id === 'n-doc-budget')?.config.rootAgentsMaxBytes).toBe(8192);

      const confirmed = wfcConfirmProposal(tmp, prop.proposal.proposalId, { actorRole: 'human', confirmedByHuman: true });
      expect(confirmed.ok).toBe(true);
      expect(wfcListPendingProposals(tmp)).toHaveLength(0);
      expect(wfcCompileWorkflow(tmp, 'dg-sample').effectivePack.nodes.find((n) => n.id === 'n-doc-budget')?.config.rootAgentsMaxBytes).toBe(16384);

      const cmdRes = executeBrickGateNode(tmp, tmp, {
        id: 'n-help',
        config: { compact: true },
        exec: { kind: 'donegate_cmd', args: ['--help'], passRoot: false }
      }, process.env);
      expect(cmdRes.exitCode).toBe(0);
      expect(cmdRes.diagSummary).toContain('DoneGate');

      const skipRes = executeBrickGateNode(tmp, tmp, {
        id: 'n-opt',
        exec: { kind: 'builtin_gate', scriptRel: 'skill/check-symbols.mjs', requireFile: 'skill/symbols.baseline.json' }
      }, process.env);
      expect(skipRes.exitCode).toBe(0);
      expect(skipRes.skipped).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ships 5 official default governance workflows runnable via donegate flow list/inspect/run in both repo and bare workspaces', () => {
    const defaults = wfcListDefaultWorkflows(REPO_ROOT);
    expect(defaults.map((w) => w.id).sort()).toEqual([
      'dg-deep-verify',
      'dg-on-check',
      'dg-on-edit',
      'dg-overnight-ops',
      'dg-pre-commit'
    ]);

    const listRes = dispatchCommand(['flow', 'list', '--json'], REPO_ROOT);
    expect(listRes.exitCode).toBe(0);
    const parsedList = JSON.parse(listRes.stdout);
    expect(parsedList.flows).toHaveLength(5);

    const runEdit = cmdGovernanceFlow(REPO_ROOT, ['run', 'dg-on-edit', '--json']);
    expect(runEdit.exitCode).toBe(0);
    expect(runEdit.ok).toBe(true);
    const editFlowCompiled = wfcCompileWorkflow(REPO_ROOT, 'dg-on-edit');
    expect(editFlowCompiled.effectivePack.nodes.map((n) => n.id)).toContain('edit-js-oxlint');
    const preCommitCompiled = wfcCompileWorkflow(REPO_ROOT, 'dg-pre-commit');
    expect(preCommitCompiled.effectivePack.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['pc-arch-depcruise', 'pc-shellcheck'])
    );

    // Bare external user workspace (no contracts/decisions/symbols baseline) still compiles & runs cleanly
    const bare = mkdtempSync(join(tmpdir(), 'dg-s11-bare-'));
    try {
      const bareList = cmdGovernanceFlow(bare, ['list', '--json']);
      expect(bareList.exitCode).toBe(0);
      expect(JSON.parse(bareList.stdout).flows).toHaveLength(5);

      const bareCheck = cmdGovernanceFlow(bare, ['inspect', 'dg-pre-commit']);
      expect(bareCheck.exitCode).toBe(0);
      const comp = JSON.parse(bareCheck.stdout);
      expect(comp.effectivePack.nodes.find((n) => n.id === 'pc-symbols-gate')?.envSkipped).toBe(true);
      expect(comp.effectivePack.nodes.find((n) => n.id === 'pc-arch-depcruise')?.envSkipped).toBe(true);
      expect(comp.effectivePack.nodes.find((n) => n.id === 'pc-shellcheck')?.envSkipped).toBe(true);

      // Shared pool npm-cells/oxlint + .dependency-cruiser.cjs auto-discovery
      writeFileSync(join(bare, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(bare, '.dependency-cruiser.cjs'), 'module.exports = {};');
      const fakeOxlintBin = join(bare, 'workflows', '.deps', '_shared', 'npm-cells', 'oxlint', 'node_modules', '.bin');
      mkdirSync(fakeOxlintBin, { recursive: true });
      writeFileSync(join(fakeOxlintBin, process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint'), 'echo ok');
      const probed = wfcProbeEnvCoeffects(bare);
      expect(probed.hasJsOrTs).toBe(true);
      expect(probed.hasOxlint).toBe(true);
      expect(probed.hasDepcruiseConfig).toBe(true);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
