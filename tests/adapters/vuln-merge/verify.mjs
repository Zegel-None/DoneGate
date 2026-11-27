// vuln-merge 多源漏洞归并适配器必红夹具（退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { finishAdapterSuite } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/vuln-merge.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-vulnmerge-'));

try {
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nrpt-*.json\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'rpt-osv.json'), JSON.stringify({
    results: [{ packages: [{ package: { name: 'lodash', version: '4.17.20' }, vulnerabilities: [{ id: 'GHSA-1', aliases: ['CVE-2021-23337'], database_specific: { severity: 'MEDIUM' } }] }] }]
  }));
  writeFileSync(join(d, 'rpt-pip.json'), JSON.stringify({
    dependencies: [{ name: 'lodash', version: '4.17.20', vulns: [{ id: 'CVE-2021-23337', severity: 'CRITICAL' }] }]
  }));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'vuln-merge@stage4', '--reports', 'rpt-osv.json,rpt-pip.json'], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/vuln-merge/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/vuln-merge/observation.json'), 'utf8')) : null;
  c.check('vuln-merge 跨源去重升级最高严重度并定级 P0',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && obs && obs.rawFindingCount === 2 && obs.dedupedCount === 1 && obs.priorityCounts.P0 === 1,
    rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'vuln-merge@stage4'], { encoding: 'utf8' });
  c.check('missing-reports 退 3 且点名未发现上游产物', rMiss.status === 3 && /未发现上游扫描产物/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  writeFileSync(join(d, 'rpt-bad.json'), '{"results": [');
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'vuln-merge@stage4', '--dry-run', '--reports', 'rpt-bad.json'], { encoding: 'utf8' });
  c.check('bad-report 退 3 且点名损坏原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  writeFileSync(join(d, 'rpt-clean.json'), JSON.stringify({ results: [] }));
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'vuln-merge@stage4', '--dry-run', '--reports', 'rpt-clean.json'], { encoding: 'utf8' });
  const cleanObs = rClean.status === 0 ? JSON.parse(rClean.stdout).observation : null;
  c.check('映射反转对偶：空漏洞报告 P0/P1 全为 0', rClean.status === 0 && cleanObs && cleanObs.findingCount === 0, rClean.stderr);

  const rStage = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'vuln-merge@stage4', '--stage', '4'], { encoding: 'utf8' });
  c.check('越权传 --stage 退 2 且点名禁止传入', rStage.status === 2 && /禁止传入/.test(rStage.stderr), rStage.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'vuln-merge 适配器夹具', false);
