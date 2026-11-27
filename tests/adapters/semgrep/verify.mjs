// semgrep 适配器必红夹具（离线版本桩直测解析 + 退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/semgrep-sast.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-semgrep-'));
const hasBin = hasRealBinary('semgrep', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'semgrep', '1.186.0');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'raw-hits.json'), JSON.stringify({
    results: [
      { check_id: 'no-eval', path: 'src/a.js', start: { line: 4 }, extra: { severity: 'ERROR' } },
      { check_id: 'weak-hash', path: 'src/b.js', start: { line: 9 }, extra: { severity: 'WARNING' } }
    ]
  }));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'semgrep@stage4', '--bin', stubBin, '--raw-report', 'raw-hits.json'], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/semgrep/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/semgrep/observation.json'), 'utf8')) : null;
  c.check('semgrep 解析落盘严格九字段且严重度统计准确',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && obs && obs.findingCount === 2 && obs.errorSeverityCount === 1 && obs.warningSeverityCount === 1,
    rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'semgrep@stage4', '--bin', '__no_semgrep_bin__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3 且点名不可用', rMiss.status === 3 && /semgrep 不可用/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  writeFileSync(join(d, 'raw-bad.json'), '{"results": [');
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'semgrep@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw 退 3 且点名损坏原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'bad@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id 退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), rBadId.stderr);

  writeFileSync(join(d, 'raw-clean.json'), JSON.stringify({ results: [] }));
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'semgrep@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-clean.json'], { encoding: 'utf8' });
  const cleanObs = rClean.status === 0 ? JSON.parse(rClean.stdout).observation : null;
  c.check('映射反转对偶：干净报告零违规', rClean.status === 0 && cleanObs && cleanObs.findingCount === 0 && cleanObs.errorSeverityCount === 0, rClean.stderr);

  const rStage = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'semgrep@stage4', '--stage', '4'], { encoding: 'utf8' });
  c.check('越权传 --stage 退 2 且点名禁止传入', rStage.status === 2 && /禁止传入/.test(rStage.stderr), rStage.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'semgrep 适配器夹具', !hasBin);
