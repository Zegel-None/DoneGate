import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProjectAtlas } from '../runner/atlas/assemble-atlas.mjs';
import { inspectWorkflowDeps, provisionWorkflowDeps } from '../runner/dsh/workflow-deps.mjs';
import { executeBrickGateNode } from '../runner/dsh/brick-exec.mjs';
import { executeDeterministicWorkflowRun, preflightWorkflowPack } from '../runner/dsh/workflow-runner.mjs';
import { approveAutopilotHumanGate, AUTOPILOT_STATES } from '../runner/dsh/autopilot-state.mjs';
import { verifyClaimInMemory } from '../skill/check-declarations.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_PACK_IDS = [
  '00-zero-dep-guardrail',
  '01-spec-and-architecture',
  '02-db-migration-rehearsal',
  '03-api-contract-and-fuzz',
  '04-ui-interaction-and-a11y',
  '05-red-green-teeth-gate',
  '06-security-coverage-family',
  '07-perf-docs-and-canary-release'
];

function initCleanGitWorkspace(dir, contracts = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.donegate/\nworkflows/.deps/\n', 'utf8');
  writeFileSync(join(dir, 'index.mjs'), 'export const ready = true;\n', 'utf8');
  for (const [cid, obIds] of Object.entries(contracts)) {
    mkdirSync(join(dir, 'contracts', cid), { recursive: true });
    writeFileSync(
      join(dir, 'contracts', cid, 'contract.json'),
      JSON.stringify({ id: cid, obligations: obIds.map((id) => ({ id })) }, null, 2) + '\n',
      'utf8'
    );
  }
  spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@donegate.local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'DoneGate Test']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
}

describe('DoneGate 预置十阶段开发流、懒加载依赖门禁与适配器协议 v1.1 新增节点', () => {
  it('自动加载全部 8 条声明式预置开发流，无空白节点、端口连线严密且回跳均有 maxLoops 上限', () => {
    const atlas = buildProjectAtlas(REPO_ROOT);
    const customPacks = atlas.workbench?.savedState?.customPacks || {};
    const regTplIds = new Set((atlas.workbench?.registeredTemplates || []).map((t) => t.tplId));
    expect(regTplIds.has('tpl-adp-ui-interaction-matrix')).toBe(true);
    expect(regTplIds.has('tpl-adp-vuln-merge')).toBe(true);
    expect(regTplIds.has('tpl-adp-syft')).toBe(true);
    expect(regTplIds.has('tpl-adp-semgrep')).toBe(true);

    const uiTpl = (atlas.workbench?.registeredTemplates || []).find((t) => t.tplId === 'tpl-adp-ui-interaction-matrix');
    const vmTpl = (atlas.workbench?.registeredTemplates || []).find((t) => t.tplId === 'tpl-adp-vuln-merge');
    expect(uiTpl?.repoSlug).toBe('');
    expect(vmTpl?.repoSlug).toBe('');
    expect(uiTpl?.category).toBe('规划与设计');

    for (const id of EXPECTED_PACK_IDS) {
      const pack = customPacks[id];
      expect(pack, `missing workflow pack ${id}`).toBeDefined();
      expect(pack.nodes.length).toBeGreaterThanOrEqual(5);
      expect(pack.nodes.length).toBeLessThan(12);
      expect(pack.nodes.some((n) => n.isBlank || n.tplId === 'tpl-blank')).toBe(false);

      const nodeMap = new Map(pack.nodes.map((n) => [n.id, n]));
      for (const lk of pack.links) {
        const fromNode = nodeMap.get(lk.fromNode);
        const toNode = nodeMap.get(lk.toNode);
        expect(fromNode, `${id}: missing fromNode ${lk.fromNode}`).toBeDefined();
        expect(toNode, `${id}: missing toNode ${lk.toNode}`).toBeDefined();
        expect(fromNode.outputs.some((o) => o.id === lk.fromSlot), `${id}: invalid fromSlot ${lk.fromSlot}`).toBe(true);
        expect(toNode.inputs.some((i) => i.id === lk.toSlot), `${id}: invalid toSlot ${lk.toSlot}`).toBe(true);
        if (fromNode.tplId === 'tpl-router-rule' && lk.fromSlot === 'out_1') {
          expect(lk.maxLoops).toBeGreaterThanOrEqual(2);
          expect(lk.maxLoops).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('00-zero-dep-guardrail 零外部依赖通过预检，真实桥接 ui-interaction-matrix 节点，遇人工闸门自动挂起并在批准后续跑完结', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-zero-wf-'));
    try {
      initCleanGitWorkspace(tmp);
      const zeroPack = JSON.parse(readFileSync(join(REPO_ROOT, 'workflows/00-zero-dep-guardrail.workflow.json'), 'utf8'));
      const depReport = inspectWorkflowDeps(tmp, zeroPack);
      expect(depReport.total).toBe(0);
      expect(depReport.ready).toBe(true);
      expect(preflightWorkflowPack(zeroPack, { projectRoot: tmp, enforceDeps: true }).ok).toBe(true);

      const uiNodeRes = executeBrickGateNode(REPO_ROOT, tmp, { id: 'zg-ui-matrix', tplId: 'tpl-adp-ui-interaction-matrix' }, process.env);
      expect(uiNodeRes.exitCode).toBe(0);

      const firstRun = await executeDeterministicWorkflowRun(REPO_ROOT, {
        ticketId: 'run-zero-01',
        worktreePath: tmp,
        headline: '零依赖预置流自检'
      }, zeroPack, { enforceDeps: true });
      expect(firstRun.ok).toBe(true);
      expect(firstRun.suspended).toBe(true);
      expect(firstRun.state).toBe(AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE);
      expect(firstRun.pendingHumanGate?.nodeId).toBe('zg-human-gate');

      const approved = approveAutopilotHumanGate(REPO_ROOT, { runId: 'run-zero-01', nodeId: 'zg-human-gate', by: '测试业主' });
      expect(approved.ok).toBe(true);

      let agentCalled = false;
      const resumed = await executeDeterministicWorkflowRun(REPO_ROOT, {
        ticketId: 'run-zero-01',
        worktreePath: tmp
      }, zeroPack, {
        resumeRunId: 'run-zero-01',
        enforceDeps: true,
        runAgentStep: async ({ node }) => {
          agentCalled = node.id === 'zg-prompt-out';
          return { summary: '已拼装高熵提示词' };
        }
      });
      expect(resumed.ok).toBe(true);
      expect(resumed.state).toBe(AUTOPILOT_STATES.COMPLETED);
      expect(agentCalled).toBe(true);
      rmSync(join(REPO_ROOT, '.donegate', 'runs', 'run-zero-01'), { recursive: true, force: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('含外部开源工具的开发流未装依赖时触发 MISSING_WORKFLOW_DEPS (exit 3)，并支持按需生成隔离补齐工单与共享池复用', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-lazy-deps-'));
    try {
      initCleanGitWorkspace(tmp);
      const secPack = JSON.parse(readFileSync(join(REPO_ROOT, 'workflows/06-security-coverage-family.workflow.json'), 'utf8'));
      const pre = preflightWorkflowPack(secPack, { projectRoot: tmp, enforceDeps: true });
      expect(pre.ok).toBe(false);
      expect(pre.exitCode).toBe(3);
      expect(pre.code).toBe('MISSING_WORKFLOW_DEPS');
      expect(pre.depsDir).toBe('workflows/.deps/06-security-coverage-family');
      expect(pre.missingDeps.some((d) => d.id === 'vuln-merge')).toBe(false);

      const prov = provisionWorkflowDeps(tmp, secPack, { markInstalledIds: pre.missingDeps.map((d) => d.id) });
      expect(prov.ok).toBe(true);
      expect(prov.ready).toBe(true);
      expect(existsSync(join(tmp, prov.planFile))).toBe(true);
      expect(existsSync(join(tmp, prov.sharedManifestFile))).toBe(true);
      expect(preflightWorkflowPack(secPack, { projectRoot: tmp, enforceDeps: true }).ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('四个新增 v1.1 适配器通过九字段哈希复算、反模式/跨源去重校验及越权拦截（退 2）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-adp-new-'));
    try {
      initCleanGitWorkspace(tmp, {
        c01: ['crit-ui-interaction-matrix', 'crit-vuln-merged-p0', 'crit-sbom-generated', 'crit-sast-no-errors']
      });
      writeFileSync(join(tmp, 'features.json'), JSON.stringify({
        features: [
          { featureId: 'theme-toggle', decisionRuleId: 'UI-R03', chosenControl: 'checkbox' },
          { featureId: 'status-filter', decisionRuleId: 'UI-R02', chosenControl: 'segmented-or-radio' }
        ]
      }, null, 2) + '\n', 'utf8');
      writeFileSync(join(tmp, 'osv.json'), JSON.stringify({
        results: [{ packages: [{ package: { name: 'lodash', version: '4.17.20' }, vulnerabilities: [{ id: 'GHSA-1', aliases: ['CVE-2021-23337'], database_specific: { severity: 'HIGH' } }] }] }]
      }) + '\n', 'utf8');
      writeFileSync(join(tmp, 'pip-audit.json'), JSON.stringify({
        dependencies: [{ name: 'lodash', version: '4.17.20', vulns: [{ id: 'PYSEC-1', aliases: ['CVE-2021-23337'], severity: 'CRITICAL' }] }]
      }) + '\n', 'utf8');
      writeFileSync(join(tmp, 'syft-raw.json'), JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'react', version: '19.0.0', type: 'library' }]
      }) + '\n', 'utf8');
      writeFileSync(join(tmp, 'semgrep-raw.json'), JSON.stringify({
        results: [{ check_id: 'js.sql-injection', path: 'index.mjs', start: { line: 1 }, extra: { severity: 'ERROR' } }]
      }) + '\n', 'utf8');
      spawnSync('git', ['-C', tmp, 'add', '.']);
      spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add fixtures']);

      const runAdp = (entry, regId, outSub, extra = []) => spawnSync(process.execPath, [
        join(REPO_ROOT, entry), '--root', tmp, '--registry-id', regId,
        '--out', `.donegate/adapters/${outSub}/claim.json`, ...extra
      ], { encoding: 'utf8' });

      const rUi = runAdp('skill/adapters/ui-interaction-matrix.mjs', 'ui-interaction-matrix@stage4', 'ui-interaction-matrix', ['--features-file', 'features.json']);
      expect(rUi.status).toBe(0);
      expect(verifyClaimInMemory(join(tmp, '.donegate/adapters/ui-interaction-matrix/claim.json'), tmp).exitCode).toBe(0);
      const uiObs = JSON.parse(readFileSync(join(tmp, '.donegate/adapters/ui-interaction-matrix/observation.json'), 'utf8'));
      expect(uiObs.ruleCount).toBe(16);
      expect(uiObs.antiPatternHitCount).toBe(1);
      expect(uiObs.findingCount).toBe(1);

      const rVm = runAdp('skill/adapters/vuln-merge.mjs', 'vuln-merge@stage4', 'vuln-merge', ['--reports', 'osv.json,pip-audit.json']);
      expect(rVm.status).toBe(0);
      expect(verifyClaimInMemory(join(tmp, '.donegate/adapters/vuln-merge/claim.json'), tmp).exitCode).toBe(0);
      const vmObs = JSON.parse(readFileSync(join(tmp, '.donegate/adapters/vuln-merge/observation.json'), 'utf8'));
      expect(vmObs.rawFindingCount).toBe(2);
      expect(vmObs.dedupedCount).toBe(1);
      expect(vmObs.priorityCounts.P0).toBe(1);
      expect(vmObs.findingCount).toBe(1);
      expect(vmObs.remediationItems[0].severity).toBe('CRITICAL');

      const stubDir = mkdtempSync(join(tmpdir(), 'dg-bin-stubs-'));
      try {
        const makeStub = (name, verOut) => {
          if (process.platform === 'win32') {
            const p = join(stubDir, `${name}.cmd`);
            writeFileSync(p, `@echo off\r\necho ${verOut}\r\n`, 'utf8');
            return p;
          }
          const p = join(stubDir, name);
          writeFileSync(p, `#!/bin/sh\necho "${verOut}"\n`, { encoding: 'utf8', mode: 0o755 });
          return p;
        };
        const syftStub = makeStub('syft', 'syft 1.18.0');
        const semgrepStub = makeStub('semgrep', '1.101.0');

        const rSyftMissing = runAdp('skill/adapters/syft-sbom.mjs', 'syft@stage4', 'syft', ['--bin', join(stubDir, 'nonexistent-syft')]);
        expect(rSyftMissing.status).toBe(3);

        const rSyft = runAdp('skill/adapters/syft-sbom.mjs', 'syft@stage4', 'syft', ['--bin', syftStub, '--raw-report', 'syft-raw.json']);
        expect(rSyft.status).toBe(0);
        expect(verifyClaimInMemory(join(tmp, '.donegate/adapters/syft/claim.json'), tmp).exitCode).toBe(0);

        const rSem = runAdp('skill/adapters/semgrep-sast.mjs', 'semgrep@stage4', 'semgrep', ['--bin', semgrepStub, '--raw-report', 'semgrep-raw.json']);
        expect(rSem.status).toBe(0);
        expect(verifyClaimInMemory(join(tmp, '.donegate/adapters/semgrep/claim.json'), tmp).exitCode).toBe(0);

        const rPrivEsc = runAdp('skill/adapters/vuln-merge.mjs', 'vuln-merge@stage4', 'vuln-merge', ['--reports', 'osv.json', '--stage', '2']);
        expect(rPrivEsc.status).toBe(2);
      } finally {
        rmSync(stubDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
