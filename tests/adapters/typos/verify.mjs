// typos 适配器必红夹具（离线版本桩直测解析 + 退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/typos-check.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-typos-'));
const hasBin = hasRealBinary('typos', ['--version']);

try {
  const stubBin = createVersionStub(tmp, 'typos', 'typos-cli 1.52.2');
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  // 1. 正样本与字段映射校验（离线真实解析并落盘严格九字段）
  writeFileSync(join(d, 'raw-dirty.txt'), "{\"type\":\"typo\",\"path\":\"src/config.mjs\",\"line_num\":12,\"byte_offset\":4,\"typo\":\"enviroment\",\"corrections\":[\"environment\"]}\n{\"type\":\"typo\",\"path\":\"src/fetcher.mjs\",\"line_num\":28,\"byte_offset\":10,\"typo\":\"retrive\",\"corrections\":[\"retrieve\"]}\n");
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'typos@stage4', '--bin', stubBin, '--raw-report', 'raw-dirty.txt'], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/typos/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/typos/observation.json'), 'utf8')) : null;
  c.check('typos 解析落盘严格九字段且观测映射准确',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && (obs && obs.typoCount === 2 && obs.filesWithTypos === 2 && obs.byTypo.retrive === 1),
    rOk.stderr);

  // 2. 缺失上游二进制退 3 且点名不可用
  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'typos@stage4', '--bin', '__no_typos_bin__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3 且点名原因', rMiss.status === 3 && /typos 不可用/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  // 3. 损坏/截断产物退 3 且点名解析失败原因
  writeFileSync(join(d, 'raw-bad.txt'), "{\"type\":\"typo\",\"typo\":\n");
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'typos@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-bad.txt'], { encoding: 'utf8' });
  c.check('bad-raw 退 3 且点名损坏原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  // 4. 未登记 registry-id 退 2 且点名 registry-id
  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'bad@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id 退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `status=${rBadId.status} err=${rBadId.stderr}`);

  // 5. 映射反转对偶：干净报告计数全为 0
  writeFileSync(join(d, 'raw-clean.txt'), "");
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'typos@stage4', '--bin', stubBin, '--dry-run', '--raw-report', 'raw-clean.txt'], { encoding: 'utf8' });
  const cleanObs = rClean.status === 0 ? JSON.parse(rClean.stdout).observation : null;
  c.check('映射反转对偶：干净报告零违规', rClean.status === 0 && cleanObs && (cleanObs.typoCount === 0 && cleanObs.filesWithTypos === 0), rClean.stderr);

  // 6. 越权传 --stage 退 2 且点名禁止传入
  const rStage = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'typos@stage4', '--stage', '4'], { encoding: 'utf8' });
  c.check('越权传 --stage 退 2 且点名禁止传入', rStage.status === 2 && /禁止传入/.test(rStage.stderr), rStage.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'typos 适配器夹具', !hasBin);
