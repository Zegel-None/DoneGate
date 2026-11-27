// oxlint 适配器必红夹具（离线版本桩直测解析 + 退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/oxlint-check.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-oxlint-'));
const hasBin = hasRealBinary('oxlint', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'oxlint', '1.95.0');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  writeFileSync(join(d, 'app.mjs'), 'export const x = 1;\n');
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  // 1. 正样本与字段映射校验（离线真实解析并落盘九字段）
  writeFileSync(join(d, 'raw-dirty.json'), JSON.stringify({
    number_of_files: 4,
    diagnostics: [
      { severity: 'error', code: 'eslint(for-direction)', filename: 'a.mjs', message: 'bad loop' },
      { severity: 'error', code: 'eslint(for-direction)', filename: 'b.mjs', message: 'bad loop 2' },
      { severity: 'warning', code: 'eslint(no-unused-vars)', filename: 'a.mjs', message: 'unused' }
    ]
  }));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'oxlint@stage4', '--bin', stubBin, '--raw-report', 'raw-dirty.json'], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/oxlint/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/oxlint/observation.json'), 'utf8')) : null;
  c.check('oxlint 解析落盘严格九字段且观测映射准确',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && obs && obs.errorCount === 2 && obs.warningCount === 1 && obs.byRule['eslint(for-direction)'] === 2,
    rOk.stderr);

  // 2. 缺失上游二进制退 3 且点名不可用
  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'oxlint@stage4', '--bin', '__no_oxlint_bin__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3 且点名原因', rMiss.status === 3 && /oxlint 不可用/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  // 3. 损坏/截断产物退 3 且点名解析失败原因
  writeFileSync(join(d, 'raw-bad.json'), '{"diagnostics":[');
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'oxlint@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw 退 3 且点名损坏或为空原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  // 4. 未登记 registry-id 退 2 且点名 registry-id
  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'bad@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id 退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `status=${rBadId.status} err=${rBadId.stderr}`);

  // 5. 映射反转对偶：干净报告 errorCount===0
  writeFileSync(join(d, 'raw-clean.json'), JSON.stringify({ number_of_files: 2, diagnostics: [] }));
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'oxlint@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-clean.json'], { encoding: 'utf8' });
  const cleanObs = rClean.status === 0 ? JSON.parse(rClean.stdout).observation : null;
  c.check('映射反转对偶：干净报告 errorCount===0', rClean.status === 0 && cleanObs && cleanObs.errorCount === 0, rClean.stderr);

  // 6. 越权传 --stage 退 2 且点名禁止传入
  const rStage = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'oxlint@stage4', '--stage', '4'], { encoding: 'utf8' });
  c.check('越权传 --stage 退 2 且点名禁止传入', rStage.status === 2 && /禁止传入/.test(rStage.stderr), rStage.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'oxlint 适配器夹具', !hasBin);
