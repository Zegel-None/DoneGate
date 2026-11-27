// osv-scanner 适配器必红夹具（离线版本桩直测解析 + 退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/osv-vuln.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-fix-'));
const hasBin = hasRealBinary("osv-scanner", ["--version"]);

try {
  const stubBin = createVersionStub(tmp, "osv-scanner", "2.7.1");
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
  writeFileSync(join(d, "raw-sev.json"), "{\"results\":[{\"packages\":[{\"package\":{\"name\":\"qs\",\"version\":\"1.0.0\"},\"vulnerabilities\":[{\"id\":\"GHSA-HIGH\",\"summary\":\"high one\",\"database_specific\":{\"severity\":\"HIGH\"}},{\"id\":\"GHSA-NOSEV\",\"summary\":\"no severity\"}]}]}]}");
  
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "osv-scanner@stage4", '--bin', stubBin, "--raw-report", "raw-sev.json"], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/osv-scanner/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/osv-scanner/observation.json'), 'utf8')) : null;
  c.check('osv-scanner 解析落盘严格九字段且观测映射准确',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && (obs && obs.severityCounts.HIGH === 1 && obs.severityCounts.UNKNOWN === 1),
    rOk.stderr);

  // 2. 缺失上游二进制退 3 且点名不可用
  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "osv-scanner@stage4", '--bin', '__no_osvscanner_bin__'], { encoding: 'utf8' });
  c.check('missing-bin 退 3 且点名原因', rMiss.status === 3 && /osv-scanner 不在 PATH/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  // 3. 损坏/截断/空产物退 3 且点名解析失败原因（绝不因缺二进制假绿）
  writeFileSync(join(d, "raw-bad.json"), "{\"results\":[");
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', "osv-scanner@stage4", '--bin', stubBin, '--dry-run', "--raw-report", "raw-bad.json"], { encoding: 'utf8' });
  c.check('bad-raw 退 3 且点名损坏或为空原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  // 4. 未登记 registry-id 退 2 且点名 registry-id
  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'bad@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id 退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `status=${rBadId.status} err=${rBadId.stderr}`);

} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'osv-scanner 适配器夹具', !hasBin);
