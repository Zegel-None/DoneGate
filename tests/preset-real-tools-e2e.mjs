#!/usr/bin/env node
// GitHub Actions + Cache 真实工具链与 PostgreSQL 16 端到端验收运行器（零 Mock / 零 --raw-report）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyClaimInMemory } from '../skill/check-declarations.mjs';
import { executeDeterministicWorkflowRun } from '../runner/dsh/workflow-runner.mjs';
import { approveAutopilotHumanGate, AUTOPILOT_STATES } from '../runner/dsh/autopilot-state.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failures = 0;

function record(step, ok, detail = '') {
  results.push({ step, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function runCmd(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    cwd: opts.cwd || REPO_ROOT,
    env: opts.env || process.env
  });
}

function seedRealSampleWorkspace(dir) {
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  mkdirSync(join(dir, 'rules'), { recursive: true });
  mkdirSync(join(dir, 'contracts', 'c01'), { recursive: true });

  writeFileSync(join(dir, '.gitignore'), '.donegate/\nworkflows/.deps/\n', 'utf8');
  writeFileSync(join(dir, 'contracts', 'c01', 'contract.json'), JSON.stringify({
    id: 'c01',
    obligations: [
      { id: 'crit-no-typos' },
      { id: 'crit-python-lint' },
      { id: 'crit-python-types' },
      { id: 'crit-iac-security' },
      { id: 'crit-sbom-generated' },
      { id: 'crit-sast-no-errors' },
      { id: 'crit-vuln-merged-p0' },
      { id: 'crit-ui-interaction-matrix' },
      { id: 'crit-workflow-valid' }
    ]
  }, null, 2) + '\n', 'utf8');

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'donegate-real-ci-sample',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: { picocolors: '1.1.1' }
  }, null, 2) + '\n', 'utf8');

  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
    name: 'donegate-real-ci-sample',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'donegate-real-ci-sample', version: '1.0.0', dependencies: { picocolors: '1.1.1' } },
      'node_modules/picocolors': { version: '1.1.1', resolved: 'https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz' }
    }
  }, null, 2) + '\n', 'utf8');

  writeFileSync(join(dir, 'src', 'ledger.js'), [
    'export function computeNetCents(grossCents, feeCents) {',
    '  return Number(grossCents) - Number(feeCents);',
    '}',
    ''
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'app', 'pricing.py'), [
    'def apply_basis_points(amount_cents: int, bps: int) -> int:',
    '    return (amount_cents * bps) // 10000',
    ''
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, '.sqlfluff'), [
    '[sqlfluff]',
    'dialect = postgres',
    'rules = ST06,AM04,CV06',
    ''
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'migrations', 'V1__create_ledger_tables.sql'), [
    'CREATE TABLE accounts (',
    '    id BIGINT PRIMARY KEY,',
    '    code VARCHAR(64) NOT NULL UNIQUE,',
    '    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    '',
    'CREATE TABLE ledger_entries (',
    '    id BIGINT PRIMARY KEY,',
    '    account_id BIGINT NOT NULL REFERENCES accounts (id),',
    '    amount_cents BIGINT NOT NULL',
    ');',
    ''
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'rules', 'no-eval.yml'), [
    'rules:',
    '  - id: forbid-dynamic-eval',
    '    pattern: eval(...)',
    '    message: Dynamic eval is prohibited',
    '    languages: [javascript]',
    '    severity: ERROR',
    ''
  ].join('\n'), 'utf8');

  writeFileSync(join(dir, 'features.json'), JSON.stringify({
    features: [
      { featureId: 'auto-save-switch', decisionRuleId: 'UI-R03', chosenControl: 'switch' },
      { featureId: 'env-mode', decisionRuleId: 'UI-R02', chosenControl: 'segmented' }
    ]
  }, null, 2) + '\n', 'utf8');

  runCmd('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  runCmd('git', ['-C', dir, 'config', 'user.email', 'ci@donegate.local']);
  runCmd('git', ['-C', dir, 'config', 'user.name', 'DoneGate CI']);
  runCmd('git', ['-C', dir, 'add', '.']);
  runCmd('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed clean sample workspace']);
}

function runRealAdapter(tmpDir, entryRel, regId, outSub, extraArgs = []) {
  const claimRel = `.donegate/adapters/${outSub}/claim.json`;
  const r = runCmd(process.execPath, [
    join(REPO_ROOT, entryRel),
    '--root', tmpDir,
    '--registry-id', regId,
    '--out', claimRel,
    ...extraArgs
  ]);
  if (r.status !== 0) {
    record(`Adapter ${regId}`, false, `exit=${r.status} ${(r.stderr || r.stdout || '').trim().slice(0, 180)}`);
    return null;
  }
  const claimAbs = join(tmpDir, claimRel);
  const verified = verifyClaimInMemory(claimAbs, tmpDir, { skipContractLookup: true });
  const obsAbs = join(tmpDir, '.donegate', 'adapters', outSub, 'observation.json');
  const obs = existsSync(obsAbs) ? JSON.parse(readFileSync(obsAbs, 'utf8')) : null;
  record(
    `Adapter ${regId} (真实 CLI + SHA-256 九字段验真)`,
    verified.exitCode === 0 && Boolean(obs),
    verified.exitCode === 0 ? `ver=${JSON.parse(readFileSync(claimAbs, 'utf8')).version}` : String(verified.reason || 'claim 校验未过')
  );
  return obs;
}

async function main() {
  const startedAt = Date.now();
  console.log('=== DoneGate GitHub Actions + Cache 真实外部工具链与 Postgres 16 实测 ===');

  // 1. 使用真实 actionlint 校验 DoneGate 自身 .github/workflows/donegate-ci.yml
  const alSelf = runCmd(process.execPath, [
    join(REPO_ROOT, 'skill/adapters/actionlint-ci.mjs'),
    '--root', REPO_ROOT,
    '--registry-id', 'actionlint@stage4',
    '--dry-run'
  ]);
  if (alSelf.status === 0) {
    const parsed = JSON.parse(alSelf.stdout);
    const errDetail = parsed.observation.errorCount === 0
      ? 'errors=0'
      : `errors=${parsed.observation.errorCount} ${JSON.stringify(parsed.rawJson || []).slice(0, 220)}`;
    record('DoneGate 自身 .github/workflows/donegate-ci.yml (actionlint)', parsed.observation.errorCount === 0, errDetail);
  } else {
    record('DoneGate 自身 .github/workflows/donegate-ci.yml (actionlint)', false, (alSelf.stderr || '').trim().slice(0, 180));
  }

  const tmp = mkdtempSync(join(tmpdir(), 'dg-real-ci-e2e-'));
  try {
    seedRealSampleWorkspace(tmp);

    // 2. 真实 CLI 二进制驱动 11 个适配器（零 --raw-report 桩文件）
    runRealAdapter(tmp, 'skill/adapters/gitleaks-scan.mjs', 'gitleaks@stage4', 'gitleaks');
    runRealAdapter(tmp, 'skill/adapters/syft-sbom.mjs', 'syft@stage4', 'syft');
    runRealAdapter(tmp, 'skill/adapters/osv-vuln.mjs', 'osv-scanner@stage4', 'osv-scanner', ['--lockfile', 'package-lock.json']);
    runRealAdapter(tmp, 'skill/adapters/trivy-scan.mjs', 'trivy@stage4', 'trivy', ['--scanners', 'misconfig']);
    runRealAdapter(tmp, 'skill/adapters/semgrep-sast.mjs', 'semgrep@stage4', 'semgrep', ['--config', 'rules/no-eval.yml', '--target', 'src']);
    runRealAdapter(
      tmp,
      'skill/adapters/vuln-merge.mjs',
      'vuln-merge@stage4',
      'vuln-merge',
      ['--reports', '.donegate/adapters/osv-scanner/raw-osv.json,.donegate/adapters/trivy/raw-trivy.json']
    );
    runRealAdapter(tmp, 'skill/adapters/ui-interaction-matrix.mjs', 'ui-interaction-matrix@stage4', 'ui-interaction-matrix', ['--features-file', 'features.json']);
    runRealAdapter(tmp, 'skill/adapters/ruff-lint.mjs', 'ruff@stage4', 'ruff', ['--target', 'app']);
    runRealAdapter(tmp, 'skill/adapters/pyright-types.mjs', 'pyright@stage4', 'pyright', ['--target', 'app']);
    runRealAdapter(tmp, 'skill/adapters/typos-check.mjs', 'typos@stage4', 'typos', ['--target', 'src']);
    runRealAdapter(tmp, 'skill/adapters/biome-lint.mjs', 'biome@stage4', 'biome', ['--target', 'src']);

    // 3. 阶段 2 真实 PostgreSQL 16 单一迁移真值演练（sqlfluff -> flyway migrate -> atlas schema inspect）
    const pgUrl = process.env.DONEGATE_PG_URL || '';
    const pgJdbc = process.env.DONEGATE_PG_JDBC || '';
    if (pgUrl && pgJdbc) {
      const sqlLint = runCmd('sqlfluff', ['lint', 'migrations/V1__create_ledger_tables.sql', '--dialect', 'postgres'], { cwd: tmp });
      record('Stage 2 SQLFluff Postgres 方言静态审计', sqlLint.status === 0, (sqlLint.stdout || sqlLint.stderr || 'clean').trim().slice(0, 120));

      const fwMigrate = runCmd('flyway', [
        `-url=${pgJdbc}`,
        `-user=${process.env.DONEGATE_PG_USER || 'donegate'}`,
        `-password=${process.env.DONEGATE_PG_PASSWORD || 'donegate'}`,
        `-locations=filesystem:${join(tmp, 'migrations')}`,
        'migrate'
      ], { cwd: tmp });
      record('Stage 2 Flyway 真实 PostgreSQL 16 唯一真值迁移演练', fwMigrate.status === 0, fwMigrate.status === 0 ? 'V1 migrated' : (fwMigrate.stderr || fwMigrate.stdout || '').slice(0, 160));

      const atlasInspect = runCmd('atlas', ['schema', 'inspect', '-u', pgUrl], { cwd: tmp });
      const ddl = atlasInspect.stdout || '';
      const hasTables = ddl.includes('accounts') && ddl.includes('ledger_entries');
      record('Stage 2 Atlas 只读连接真实 PostgreSQL 16 对账零漂移', atlasInspect.status === 0 && hasTables, hasTables ? 'tables=accounts,ledger_entries' : (atlasInspect.stderr || ddl).slice(0, 160));
    }

    // 4. 预置工作流引擎完整挂起与续跑闭环
    const zeroPack = JSON.parse(readFileSync(join(REPO_ROOT, 'workflows/00-zero-dep-guardrail.workflow.json'), 'utf8'));
    const runId = 'ci-real-zero-01';
    const first = await executeDeterministicWorkflowRun(REPO_ROOT, { ticketId: runId, worktreePath: tmp, headline: 'CI 预置流闭环' }, zeroPack, { enforceDeps: true });
    approveAutopilotHumanGate(REPO_ROOT, { runId, nodeId: 'zg-human-gate', by: 'GitHub Actions CI' });
    const second = await executeDeterministicWorkflowRun(REPO_ROOT, { ticketId: runId, worktreePath: tmp }, zeroPack, {
      resumeRunId: runId,
      enforceDeps: true,
      runAgentStep: async () => ({ summary: 'CI prompt assembled' })
    });
    rmSync(join(REPO_ROOT, '.donegate', 'runs', runId), { recursive: true, force: true });
    record('预置流 00-zero-dep-guardrail 挂机暂停与批准续跑完结', first.suspended === true && second.state === AUTOPILOT_STATES.COMPLETED, `state=${second.state}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const outDir = join(REPO_ROOT, '.donegate', 'scratch');
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, 'real-toolchain-report.json');
  writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    totalChecks: results.length,
    passedChecks: results.filter((r) => r.ok).length,
    failedChecks: failures,
    results
  }, null, 2) + '\n', 'utf8');

  console.log(`\n=== 汇总：${results.length - failures}/${results.length} 项通过（耗时 ${Date.now() - startedAt} ms）===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
