// srclight 适配器必红夹具（离线版本桩直测解析 + 退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/srclight-fresh.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-fix-'));
const hasBin = hasRealBinary("srclight", ["--version"]);

try {
  const stubBin = createVersionStub(tmp, "srclight", "0.25.3");
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nraw-*\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ name: 't', lockfileVersion: 3, packages: {} }));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  // 1. 正样本与字段映射校验（离线真实解析并落盘九字段）
  writeFileSync(join(d, "raw-ok.txt"), "Indexed 42 files, 0 stale\\n");
  
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "srclight@stage4", '--bin', stubBin, "--raw-report", "raw-ok.txt"], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/srclight/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/srclight/observation.json'), 'utf8')) : null;
  c.check('srclight 解析落盘严格九字段且观测映射准确',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && (claim.role === "soft" && obs && obs.indexedFiles === 42),
    rOk.stderr);

  // 2. 缺失上游二进制退 3 且点名不可用
  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "srclight@stage4", '--bin', '__no_srclight_bin__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3 且点名原因', rMiss.status === 3 && /srclight 不在 PATH/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  // 3. 损坏/截断/空产物退 3 且点名解析失败原因（绝不因缺二进制假绿）
  writeFileSync(join(d, "raw-empty.txt"), "   \n");
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "srclight@stage4", '--bin', stubBin, '--dry-run', "--raw-report", "raw-empty.txt"], { encoding: 'utf8' });
  c.check('bad-raw 退 3 且点名损坏或为空原因', rBadRaw.status === 3 && /输出为空/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  // 4. 未登记 registry-id 退 2 且点名 registry-id
  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'bad@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id 退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `status=${rBadId.status} err=${rBadId.stderr}`);

} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'srclight 适配器夹具', !hasBin);
