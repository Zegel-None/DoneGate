// import-linter 适配器必红夹具（离线版本桩直测架构契约违规解析）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/import-linter.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-il-'));
const hasBin = hasRealBinary('lint-imports', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'lint-imports', 'import-linter 2.1.0');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'raw-broken.txt'), 'Contracts: 2 kept, 1 broken.\n');
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'import-linter@stage4', '--bin', stubBin, '--raw-report', 'raw-broken.txt'], { encoding: 'utf8' });
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/import-linter/observation.json'), 'utf8')) : null;
  c.check('import-linter 准确解析 kept/broken 契约数', rOk.status === 0 && obs?.keptContractCount === 2 && obs?.brokenContractCount === 1, rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'import-linter@stage4', '--bin', '__no_il__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3', rMiss.status === 3 && /lint-imports 不可用/.test(rMiss.stderr), rMiss.stderr);

  writeFileSync(join(d, 'raw-bad.json'), '{broken');
  const rBad = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'import-linter@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.json'], { encoding: 'utf8' });
  c.check('bad-raw JSON 退 3', rBad.status === 3 && /截断或损坏/.test(rBad.stderr), rBad.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'import-linter 适配器夹具', !hasBin);
