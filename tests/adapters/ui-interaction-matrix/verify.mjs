// ui-interaction-matrix 免二进制规则适配器必红夹具（退出码与 stderr 原因双重断言）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { finishAdapterSuite } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/ui-interaction-matrix.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'adp-uimatrix-'));

try {
  const d = join(tmp, 'proj');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '.gitignore'), '.donegate/\nfeat-*.json\n');
  writeFileSync(join(d, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  spawnSync('git', ['-C', d, 'config', 'user.email', 'a@local']);
  spawnSync('git', ['-C', d, 'config', 'user.name', 'A']);
  spawnSync('git', ['-C', d, 'add', '.']);
  spawnSync('git', ['-C', d, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  writeFileSync(join(d, 'feat-dirty.json'), JSON.stringify({
    features: [
      { featureId: 'dark-toggle', decisionRuleId: 'UI-R03', chosenControl: 'checkbox' },
      { featureId: 'unknown-rule', decisionRuleId: 'NO-SUCH', chosenControl: 'button' }
    ]
  }));
  const rOk = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ui-interaction-matrix@stage4', '--features-file', 'feat-dirty.json'], { encoding: 'utf8' });
  const claim = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/ui-interaction-matrix/claim.json'), 'utf8')) : null;
  const obs = rOk.status === 0 ? JSON.parse(readFileSync(join(d, '.donegate/adapters/ui-interaction-matrix/observation.json'), 'utf8')) : null;
  c.check('ui-interaction-matrix 检出反模式控件与未映射功能并落盘九字段',
    rOk.status === 0 && claim && Object.keys(claim).length === 9 && obs && obs.antiPatternHitCount === 1 && obs.unmappedCount === 1,
    rOk.stderr);

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ui-interaction-matrix@stage4', '--rules-file', 'no-matrix.json'], { encoding: 'utf8' });
  c.check('missing-rules 退 3 且点名不存在', rMiss.status === 3 && /不存在/.test(rMiss.stderr), `status=${rMiss.status} err=${rMiss.stderr}`);

  writeFileSync(join(d, 'feat-bad.json'), '{"features": [');
  const rBadRaw = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ui-interaction-matrix@stage4', '--dry-run', '--features-file', 'feat-bad.json'], { encoding: 'utf8' });
  c.check('bad-features 退 3 且点名损坏原因', rBadRaw.status === 3 && /截断或损坏/.test(rBadRaw.stderr), `status=${rBadRaw.status} err=${rBadRaw.stderr}`);

  writeFileSync(join(d, 'feat-clean.json'), JSON.stringify({
    features: [{ featureId: 'dark-toggle', decisionRuleId: 'UI-R03', chosenControl: 'switch' }]
  }));
  const rClean = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ui-interaction-matrix@stage4', '--dry-run', '--features-file', 'feat-clean.json'], { encoding: 'utf8' });
  const cleanObs = rClean.status === 0 ? JSON.parse(rClean.stdout).observation : null;
  c.check('映射反转对偶：合规控件选择零违例', rClean.status === 0 && cleanObs && cleanObs.findingCount === 0, rClean.stderr);

  const rStage = spawnSync(process.execPath, [ADAPTER, '--root', d, '--registry-id', 'ui-interaction-matrix@stage4', '--stage', '4'], { encoding: 'utf8' });
  c.check('越权传 --stage 退 2 且点名禁止传入', rStage.status === 2 && /禁止传入/.test(rStage.stderr), rStage.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'ui-interaction-matrix 适配器夹具', false);
