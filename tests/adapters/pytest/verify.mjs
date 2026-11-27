// pytest 适配器必红夹具（离线版本桩直测摘要与 JSON 报告解析）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/pytest-run.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-pytest-'));
const hasBin = hasRealBinary('pytest', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'pytest', 'pytest 8.3.4');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'raw-fail.txt'), '3 passed, 1 failed, 1 skipped in 0.42s\n');
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'pytest@stage4', '--bin', stubBin, '--raw-report', 'raw-fail.txt'], { encoding: 'utf8' });
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/pytest/observation.json'), 'utf8')) : null;
  c.check('pytest 文本摘要准确解析失败与跳过计数', rOk.status === 0 && obs?.failedCount === 1 && obs?.passedCount === 3 && obs?.skippedCount === 1, rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'pytest@stage4', '--bin', '__no_pytest__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3', rMiss.status === 3 && /pytest 不可用/.test(rMiss.stderr), rMiss.stderr);

  writeFileSync(join(d, 'raw-bad.json'), '{bad json');
  const rBad = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'pytest@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw JSON 退 3', rBad.status === 3 && /截断或损坏/.test(rBad.stderr), rBad.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'pytest 适配器夹具', !hasBin);
