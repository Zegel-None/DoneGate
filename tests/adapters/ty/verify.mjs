// Astral ty 适配器必红夹具（离线版本桩直测 JSON 诊断解析）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/ty-check.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-ty-'));
const hasBin = hasRealBinary('ty', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'ty', 'ty 0.0.12');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'raw-err.json'), JSON.stringify([
    { severity: 'major', location: { path: 'src/ir.py' }, description: 'unresolved-attribute' },
    { severity: 'info', location: { path: 'src/ir.py' }, description: 'hint' }
  ]));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ty@stage4', '--bin', stubBin, '--raw-report', 'raw-err.json'], { encoding: 'utf8' });
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/ty/observation.json'), 'utf8')) : null;
  c.check('ty 报告解析错误/警告数准确', rOk.status === 0 && obs?.errorCount === 1 && obs?.warningCount === 1, rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ty@stage4', '--bin', '__no_ty__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3', rMiss.status === 3 && /ty 不可用/.test(rMiss.stderr), rMiss.stderr);

  writeFileSync(join(d, 'raw-bad.json'), '[broken');
  const rBad = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ty@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw 退 3', rBad.status === 3 && /截断或损坏/.test(rBad.stderr), rBad.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'ty 适配器夹具', !hasBin);
