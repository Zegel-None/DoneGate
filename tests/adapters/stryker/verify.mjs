// Stryker 适配器四组必红夹具（Adapter Protocol v1.1 §七 / adapter-stryker.md §五）
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { IS_OFFLINE, finishAdapterSuite } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/stryker-teeth.mjs');
const REAL_PKG = join(REPO, 'node_modules/@stryker-mutator/core/package.json');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'stryker-adp-'));
let missingLive = false;

function initCleanRepo(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'reports/mutation'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'reports/\n.donegate/\n');
  writeFileSync(join(dir, 'src/a.mjs'), 'export const add = (x, y) => x + y;\n');
  writeFileSync(join(dir, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'fix@local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Fix']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  return Number(spawnSync('git', ['-C', dir, 'log', '-1', '--format=%ct'], { encoding: 'utf8' }).stdout.trim());
}

function kernelJudgeStrykerObs(obs) {
  if (obs.totalMutants === 0 || obs.countsByStatus.Survived > 0 || obs.countsByStatus.NoCoverage > 0) return 1;
  if (obs.countsByStatus.Ignored > 0 || obs.countsByStatus.Pending > 0) return 3;
  return obs.countsByStatus.Killed === obs.totalMutants ? 0 : 1;
}

try {
  const stubPkg = join(tmp, 'fake-stryker-pkg.json');
  writeFileSync(stubPkg, JSON.stringify({ version: '10.1.1' }));
  const pkgToUse = existsSync(REAL_PKG) ? REAL_PKG : stubPkg;
  if (!existsSync(REAL_PKG) && !IS_OFFLINE) missingLive = true;

  // 1. flip-killed-to-survived
  const d1 = join(tmp, 'flip');
  const headSec1 = initCleanRepo(d1);
  const rep1 = join(d1, 'reports/mutation/mutation.json');
  writeFileSync(rep1, JSON.stringify({ schemaVersion: '1', files: { 'src/a.mjs': { mutants: [{ id: '1', mutatorName: 'ArithmeticOperator', status: 'Survived', location: { start: { line: 1 } } }] } } }));
  utimesSync(rep1, new Date((headSec1 + 10) * 1000), new Date((headSec1 + 10) * 1000));
  const r1 = spawnSync(process.execPath, [ADAPTER, '--root', d1, '--registry-id', 'stryker@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  const obs1 = r1.status === 0 ? JSON.parse(readFileSync(join(d1, '.donegate/adapters/stryker/observation.json'), 'utf8')) : null;
  const claim1 = r1.status === 0 ? JSON.parse(readFileSync(join(d1, '.donegate/adapters/stryker/claim.json'), 'utf8')) : null;
  c.check('flip-killed-to-survived：适配器退 0 且核判退 1（九字段齐）',
    r1.status === 0 && claim1 && Object.keys(claim1).length === 9 && obs1.countsByStatus.Survived === 1 && kernelJudgeStrykerObs(obs1) === 1,
    `exit=${r1.status} err=${r1.stderr}`);

  // 2. missing-pkg：缺失包版本必退 3 且点名无法读取版本
  const rNoPkg = spawnSync(process.execPath, [ADAPTER, '--root', d1, '--registry-id', 'stryker@stage4', '--stryker-pkg', join(tmp, 'no-pkg.json')], { encoding: 'utf8' });
  c.check('missing-pkg：缺 @stryker-mutator/core 版本必退 3 且点名版本', rNoPkg.status === 3 && /无法读取.*版本/.test(rNoPkg.stderr), `exit=${rNoPkg.status} err=${rNoPkg.stderr}`);

  // 3. missing-or-stale-upstream：缺失或 mtime <= HEAD → 必退 3 且点名真实原因
  const d2 = join(tmp, 'stale');
  const headSec2 = initCleanRepo(d2);
  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d2, '--registry-id', 'stryker@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  c.check('missing-upstream：报告缺失必退 3 且点名不存在', rMiss.status === 3 && /报告不存在/.test(rMiss.stderr), `exit=${rMiss.status} err=${rMiss.stderr}`);
  const rep2 = join(d2, 'reports/mutation/mutation.json');
  writeFileSync(rep2, JSON.stringify({ schemaVersion: '1', files: { 'src/a.mjs': { mutants: [{ id: '1', status: 'Killed' }] } } }));
  utimesSync(rep2, new Date((headSec2 - 60) * 1000), new Date((headSec2 - 60) * 1000));
  const rStale = spawnSync(process.execPath, [ADAPTER, '--root', d2, '--registry-id', 'stryker@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  c.check('stale-upstream：报告 mtime ≤ HEAD 必退 3 且点名陈旧报告', rStale.status === 3 && /陈旧报告/.test(rStale.stderr), `exit=${rStale.status} err=${rStale.stderr}`);

  // 4. truncated-json：截断 JSON 与缺 files 字段 → 必退 3 且点名原因
  const d3 = join(tmp, 'trunc');
  const headSec3 = initCleanRepo(d3);
  const rep3 = join(d3, 'reports/mutation/mutation.json');
  writeFileSync(rep3, '{"schemaVersion":"1","files":{"src/a.mjs":{"mutants":[{"id":"1"');
  utimesSync(rep3, new Date((headSec3 + 10) * 1000), new Date((headSec3 + 10) * 1000));
  const rTrunc = spawnSync(process.execPath, [ADAPTER, '--root', d3, '--registry-id', 'stryker@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  c.check('truncated-json：截断 JSON 必退 3 且点名截断或损坏', rTrunc.status === 3 && /截断或损坏/.test(rTrunc.stderr), `exit=${rTrunc.status} err=${rTrunc.stderr}`);
  writeFileSync(rep3, JSON.stringify({ schemaVersion: '1' }));
  utimesSync(rep3, new Date((headSec3 + 10) * 1000), new Date((headSec3 + 10) * 1000));
  const rNoFiles = spawnSync(process.execPath, [ADAPTER, '--root', d3, '--registry-id', 'stryker@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  c.check('missing-files：缺 files 字段必退 3 且点名 files', rNoFiles.status === 3 && rNoFiles.stderr.includes('files'), `exit=${rNoFiles.status} err=${rNoFiles.stderr}`);

  // 5. invalid-registry-id：未登记 id → 必退 2 且点名 registry-id
  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d1, '--registry-id', 'unknown@stage4', '--stryker-pkg', pkgToUse], { encoding: 'utf8' });
  c.check('invalid-registry-id：未登记 id 必退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `exit=${rBadId.status} err=${rBadId.stderr}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'Stryker 适配器夹具', missingLive);
