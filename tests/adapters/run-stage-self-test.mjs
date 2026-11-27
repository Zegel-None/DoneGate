// run-stage.mjs 固定反例自测（Adapter Protocol v1.1 §七.2 / Q8）
// 验证三例：① 假适配器退 3 绝不吞码原样退 3；② 假适配器输出禁词拦截退 2；③ 脏 git 临时仓拒收退 3。
// 用法：node tests/adapters/run-stage-self-test.mjs
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../../skill/assert.mjs';
import { sha256 } from '../../skill/hash.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_STAGE = join(REPO, 'runner/run-stage.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'runstage-test-'));

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.donegate/\nmock-*.mjs\n');
  writeFileSync(join(dir, 'adapters.registry.json'), readFileSync(join(REPO, 'adapters.registry.json'), 'utf8'));
  writeFileSync(join(dir, 'src.mjs'), 'export const v = 1;\n');
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'fix@local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Fix']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
}

try {
  const d = join(tmp, 'proj');
  initRepo(d);

  // ① 假适配器退 3 时绝不吞码、原样退 3
  const mockExit3 = join(d, 'mock-exit3.mjs');
  writeFileSync(mockExit3, 'console.error("mock upstream failure"); process.exit(3);\n');
  const r1 = spawnSync(process.execPath, [RUN_STAGE, '--root', d, '--registry-id', 'stryker@stage4', '--adapter', mockExit3], { encoding: 'utf8' });
  c.check('反例 1：假适配器退 3 → run-stage 原样退 3 不吞码', r1.status === 3, `exit=${r1.status}`);

  // ② 假适配器输出禁词 verdict 时，拦截退 2
  const mockForbidden = join(d, 'mock-forbidden.mjs');
  const srcHash = sha256(readFileSync(join(d, 'src.mjs')));
  writeFileSync(mockForbidden, `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    const out = join(${JSON.stringify(d)}, '.donegate/adapters/stryker/claim.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      stage: 4, tool: 'stryker', version: '10.1.1', role: 'hard',
      inputs: [{ path: 'src.mjs', sha256: ${JSON.stringify(srcHash)} }],
      artifacts: [], claims: [{ text: 'x', checkedBy: 'c01/o1' }],
      unresolved: [], degradedTo: '人工按同一格式手写', verdict: 'passed'
    }));
    process.exit(0);
  `);
  const r2 = spawnSync(process.execPath, [RUN_STAGE, '--root', d, '--registry-id', 'stryker@stage4', '--adapter', mockForbidden], { encoding: 'utf8' });
  c.check('反例 2：假适配器输出禁词 verdict → run-stage 拦截退 2', r2.status === 2, `exit=${r2.status} out=${r2.stdout} err=${r2.stderr}`);

  // ③ 脏 git 临时仓拒收退 3
  writeFileSync(join(d, 'src.mjs'), 'export const v = 2;\n');
  const r3 = spawnSync(process.execPath, [RUN_STAGE, '--root', d, '--registry-id', 'stryker@stage4', '--adapter', mockExit3], { encoding: 'utf8' });
  c.check('反例 3：脏 git 临时仓 → run-stage 拒收退 3', r3.status === 3, `exit=${r3.status}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

c.summary('run-stage 反例自测');
process.exit(c.bad ? 1 : 0);
