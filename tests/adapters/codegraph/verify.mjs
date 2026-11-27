// codegraph 适配器必红夹具 + 影响面联动引擎验证
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../../skill/assert.mjs';
import { propagateImpact } from '../../../runner/engine.mjs';
import { IS_OFFLINE, createVersionStub, finishAdapterSuite, hasRealBinary } from '../fixture-stub.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADAPTER = join(REPO, 'skill/adapters/codegraph-impact.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'cg-adp-'));
const hasCg = hasRealBinary('codegraph', ['--version']);

function initRepo(dir, files) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.codegraph/\n.donegate/\nraw-*.json\ntrunc-*.json\nmiss-*.json\n');
  writeFileSync(join(dir, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'fix@local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Fix']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
}

function kernelJudgeCycles(obs) {
  return obs && typeof obs.cycleCount === 'number' && obs.cycleCount === 0 ? 0 : 1;
}

try {
  const stubBin = createVersionStub(tmp, 'codegraph', '1.6.3');
  const dOff = join(tmp, 'offline');
  initRepo(dOff, {
    'src/x.mjs': 'export function fnX() { return 1; }\n',
    'src/y.mjs': 'import { fnX } from "./x.mjs";\nexport function fnY() { return fnX() + 1; }\n',
    'src/z.mjs': 'import { fnY } from "./y.mjs";\nexport function fnZ() { return fnY() + 1; }\n'
  });

  // 离线正样本 + 环路映射与影响面传播
  writeFileSync(join(dOff, 'raw-cyc.json'), JSON.stringify({ count: 1, cycles: [['src/x.mjs', 'src/y.mjs']] }));
  writeFileSync(join(dOff, 'raw-imp.json'), JSON.stringify({ affected: [{ filePath: 'src/y.mjs' }, { filePath: 'src/z.mjs' }] }));
  const rOff = spawnSync(process.execPath, [ADAPTER, '--root', dOff, '--registry-id', 'codegraph@stage4', '--bin', stubBin, '--changed', 'src/x.mjs', '--raw-cycles', 'raw-cyc.json', '--raw-impact', 'raw-imp.json'], { encoding: 'utf8' });
  const obsOff = rOff.status === 0 ? JSON.parse(readFileSync(join(dOff, '.donegate/adapters/codegraph/observation.json'), 'utf8')) : null;
  const claimOff = rOff.status === 0 ? JSON.parse(readFileSync(join(dOff, '.donegate/adapters/codegraph/claim.json'), 'utf8')) : null;
  const prop = obsOff ? propagateImpact({
    contracts: [{ id: 'c-x', scope: ['src/x.mjs'] }, { id: 'c-z', scope: ['src/z.mjs'] }],
    functions: [{ id: 'fn-end', title: '末端场景', contracts: ['c-z'] }],
    changedFiles: obsOff.changedFiles,
    impactedFiles: obsOff.impactedFiles
  }) : null;
  c.check('离线环路与影响面联动：九字段齐、cycleCount=1 核判退 1、c-z 标 pending-recheck',
    rOff.status === 0 && claimOff && Object.keys(claimOff).length === 9 && kernelJudgeCycles(obsOff) === 1 &&
    obsOff.impactedFiles.includes('src/z.mjs') && prop && prop.pendingRecheckIds.includes('c-z'),
    `exit=${rOff.status} err=${rOff.stderr}`);

  if (!IS_OFFLINE && hasCg) {
    const dLive = join(tmp, 'live');
    initRepo(dLive, {
      'src/a.mjs': 'import { b } from "./b.mjs";\nexport function a() { return b() + 1; }\n',
      'src/b.mjs': 'import { a } from "./a.mjs";\nexport function b() { return 2; }\nexport function c() { return a(); }\n'
    });
    const cgInit = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'codegraph', 'init', dLive]] : ['codegraph', ['init', dLive]];
    spawnSync(cgInit[0], cgInit[1], { encoding: 'utf8', timeout: 60000 });
    const cgSync = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'codegraph', 'sync', dLive]] : ['codegraph', ['sync', dLive]];
    spawnSync(cgSync[0], cgSync[1], { encoding: 'utf8', timeout: 60000 });
    const rLive = spawnSync(process.execPath, [ADAPTER, '--root', dLive, '--registry-id', 'codegraph@stage4', '--changed', 'src/a.mjs'], { encoding: 'utf8' });
    const obsLive = rLive.status === 0 ? JSON.parse(readFileSync(join(dLive, '.donegate/adapters/codegraph/observation.json'), 'utf8')) : null;
    c.check('live inject-cycle：真机检出环路并落九字段', rLive.status === 0 && obsLive && obsLive.cycleCount >= 1, rLive.stderr);
  }

  const rMiss = spawnSync(process.execPath, [ADAPTER, '--root', dOff, '--registry-id', 'codegraph@stage4', '--bin', '__no_such_codegraph_xyz__'], { encoding: 'utf8' });
  c.check('missing-codegraph：二进制缺失必退 3 且点名不可用', rMiss.status === 3 && /codegraph/.test(rMiss.stderr), `exit=${rMiss.status} err=${rMiss.stderr}`);

  writeFileSync(join(dOff, 'trunc-cycles.json'), '{"count": 1');
  const rTrunc = spawnSync(process.execPath, [ADAPTER, '--root', dOff, '--registry-id', 'codegraph@stage4', '--bin', stubBin, '--dry-run', '--raw-cycles', 'trunc-cycles.json'], { encoding: 'utf8' });
  c.check('truncated-output：截断 JSON 必退 3 并点名字段', rTrunc.status === 3 && /截断或损坏/.test(rTrunc.stderr), `exit=${rTrunc.status} err=${rTrunc.stderr}`);

  writeFileSync(join(dOff, 'miss-key.json'), JSON.stringify({ count: 0 }));
  const rMissKey = spawnSync(process.execPath, [ADAPTER, '--root', dOff, '--registry-id', 'codegraph@stage4', '--bin', stubBin, '--dry-run', '--raw-cycles', 'miss-key.json'], { encoding: 'utf8' });
  c.check('missing-cycles-field：缺 cycles 必退 3 并点名 cycles', rMissKey.status === 3 && rMissKey.stderr.includes('cycles'), `exit=${rMissKey.status} err=${rMissKey.stderr}`);

  const rBadId = spawnSync(process.execPath, [ADAPTER, '--root', dOff, '--registry-id', 'unknown@stage4'], { encoding: 'utf8' });
  c.check('invalid-registry-id：未登记 id 必退 2 且点名 registry-id', rBadId.status === 2 && /registry-id/.test(rBadId.stderr), `exit=${rBadId.status} err=${rBadId.stderr}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
finishAdapterSuite(c, 'codegraph 适配器夹具', !hasCg);
