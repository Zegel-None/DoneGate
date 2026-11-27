// complexipy 适配器必红夹具（离线版本桩直测 Campbell 2018 解析与三值退出码）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/complexipy-check.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-cpx-'));
const hasBin = hasRealBinary('complexipy', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'complexipy', 'complexipy 0.5.1');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'raw-over.json'), JSON.stringify([
    { path: 'src/importer.py', function_name: 'create_draft_from_markdown_or_csv', complexity: 30 },
    { path: 'src/utils.py', function_name: 'norm', complexity: 4 }
  ]));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'complexipy@stage4', '--bin', stubBin, '--raw-report', 'raw-over.json'], { encoding: 'utf8' });
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/complexipy/observation.json'), 'utf8')) : null;
  c.check('complexipy 检出认知复杂度 30 > 25 并准确统计', rOk.status === 0 && obs?.overThresholdCount === 1 && obs?.maxComplexity === 30, rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'complexipy@stage4', '--bin', '__no_cpx__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3', rMiss.status === 3 && /complexipy 不可用/.test(rMiss.stderr), rMiss.stderr);

  writeFileSync(join(d, 'raw-bad.json'), '[{broken');
  const rBad = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'complexipy@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw 退 3', rBad.status === 3 && /截断或损坏/.test(rBad.stderr), rBad.stderr);

  writeFileSync(join(d, 'raw-clean.json'), JSON.stringify([{ path: 'src/a.py', function_name: 'ok_fn', complexity: 8 }]));
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'complexipy@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-clean.json'], { encoding: 'utf8' });
  c.check('全达标样本 overThresholdCount=0', rClean.status === 0 && JSON.parse(rClean.stdout).observation.overThresholdCount === 0, rClean.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'complexipy 适配器夹具', !hasBin);
