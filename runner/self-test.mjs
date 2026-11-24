// runner 的红测：自己造夹具、自己断言退出码。**判据跑不绿不算过，跑不红更不算过。**
// 用法：node runner/self-test.mjs
// 退出码：0 全部符合预期；1 有案例不符合（并打印实际退出码）
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../skill/hash.mjs';
const dir = mkdtempSync(join(tmpdir(), 'runner-selftest-'));
// 用 fileURLToPath：仓库路径带空格，new URL().pathname 会把空格变成 %20，spawn 时找不到文件
const runner = fileURLToPath(new URL('./run-criterion.mjs', import.meta.url));
const node = process.execPath;
const Q = (s) => '"' + s + '"';
const nodeRun = (script) => Q(node) + ' ' + Q(join(dir, script));

const w = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

w('pass.mjs', 'console.log("ok"); process.exit(0);\n');
w('fail.mjs', 'console.log("bad"); process.exit(1);\n');

const contract = (obls) => JSON.stringify({ id: 'self-test', obligations: obls }, null, 2);
const cmd = (id, command, exitCode) => ({ id, kind: 'command', command, expect: { exitCode } });

const cPass = w('c-pass.json', contract([cmd('a', nodeRun('pass.mjs'), 0)]));
const cFail = w('c-fail.json', contract([cmd('b', nodeRun('fail.mjs'), 0)]));
const cMissing = w('c-missing.json', contract([cmd('c', '__no_such_binary_xyz__ --version', 0)]));
const cMixed = w('c-mixed.json', contract([
  cmd('d1', nodeRun('pass.mjs'), 0),
  cmd('d2', nodeRun('fail.mjs'), 0)
]));

// 模型自述：一份照实说（1），一份把 1 说成 0（这就是假称完成的最小形态）
const claimedHonest = w('claimed-honest.json', JSON.stringify([{ id: 'b', exitCode: 1 }]));
const claimedLying = w('claimed-lying.json', JSON.stringify([{ id: 'b', exitCode: 0 }]));

const run = (args) => spawnSync(node, [runner, ...args], { encoding: 'utf8', timeout: 120000 });

const cBadType = w('c-bad-type.json', contract([{ id: 'e1', kind: 'command', command: nodeRun('pass.mjs'), expect: { exitCode: '0' } }]));
const cNoId = w('c-no-id.json', JSON.stringify({ obligations: [cmd('e2', nodeRun('pass.mjs'), 0)] }));

const CASES = [
  { name: '判据真绿 → 0', args: [cPass], want: 0 },
  { name: '判据真红 → 1（读的是子进程退出码，不是自述）', args: [cFail], want: 1 },
  { name: '命令根本跑不起来 → 3（无法判断，不是失败）', args: [cMissing], want: 3 },
  { name: '混合：一条绿一条红 → 1', args: [cMixed], want: 1 },
  { name: '自述照实（说 1）→ 1，不误报事故', args: [cFail, '--compare', claimedHonest], want: 1 },
  { name: '自述把 1 说成 0 → 2（事故；这就是它必须能红的那一格）', args: [cFail, '--compare', claimedLying], want: 2 },
  { name: 'D08 坏类型 expect.exitCode:"0" → 2', args: [cBadType], want: 2 },
  { name: 'D10 缺必填 id → 2', args: [cNoId], want: 2 }
];

let bad = 0;
console.log('夹具目录：' + dir + '\n');
for (const c of CASES) {
  const r = run(c.args);
  const ok = r.status === c.want;
  if (!ok) bad++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + c.name + ' → want ' + c.want + ' got ' + r.status);
  if (!ok) console.log('       stdout: ' + (r.stdout || '').trim().split('\n').slice(-3).join(' | '));
  if (!ok) console.log('       stderr: ' + (r.stderr || '').trim().split('\n').slice(0, 3).join(' | '));
}

// D11 夹具：干净仓 + 脏仓 worktreeHash / isDirty / 证据三件套 / --gate4 脏树退 3
let extraCases = 0;
const gitDir = join(dir, 'git-proj');
mkdirSync(gitDir, { recursive: true });
spawnSync('git', ['-C', gitDir, 'init', '-q']);
spawnSync('git', ['-C', gitDir, 'config', 'user.email', 'test@local']);
spawnSync('git', ['-C', gitDir, 'config', 'user.name', 'Test']);
writeFileSync(join(gitDir, 'app.txt'), 'v1\n');
const gContract = join(gitDir, 'c.json');
writeFileSync(gContract, contract([cmd('g1', nodeRun('pass.mjs'), 0)]));
spawnSync('git', ['-C', gitDir, 'add', '.']);
spawnSync('git', ['-C', gitDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

const cleanEvDir = join(dir, 'ev-clean');
const cleanRep = join(dir, 'rep-clean.json');
const rClean = spawnSync(node, [runner, gContract, '--gate4', '--report', cleanRep, '--evidence-dir', cleanEvDir], { cwd: gitDir, encoding: 'utf8' });
const repClean = JSON.parse(readFileSync(cleanRep, 'utf8'));
const sRaw = readFileSync(join(cleanEvDir, 'start.json'), 'utf8');
const rRaw = readFileSync(join(cleanEvDir, 'report.json'), 'utf8');
const eObj = JSON.parse(readFileSync(join(cleanEvDir, 'end.json'), 'utf8'));
const cleanOk = rClean.status === 0 && repClean.isDirty === false && typeof repClean.worktreeHash === 'string' && repClean.worktreeHash.length === 40 && JSON.parse(rRaw).hashStart === sha256(sRaw) && eObj.hashReport === sha256(rRaw);
extraCases++; if (!cleanOk) bad++;
console.log((cleanOk ? 'PASS  ' : 'FAIL  ') + 'D11 干净仓 --gate4 + 三件套互哈希链成立 → 0');

writeFileSync(join(gitDir, 'app.txt'), 'v2-dirty\n');
const dirtyRep = join(dir, 'rep-dirty.json');
const rDirty = spawnSync(node, [runner, gContract, '--report', dirtyRep], { cwd: gitDir, encoding: 'utf8' });
const repDirty = JSON.parse(readFileSync(dirtyRep, 'utf8'));
const dirtyMarkOk = rDirty.status === 0 && repDirty.isDirty === true && typeof repDirty.worktreeHash === 'string' && repDirty.gate4Eligible === false;
extraCases++; if (!dirtyMarkOk) bad++;
console.log((dirtyMarkOk ? 'PASS  ' : 'FAIL  ') + 'D11 脏工作区 report 采到 worktreeHash & isDirty=true');

const rDirtyGate4 = spawnSync(node, [runner, gContract, '--gate4'], { cwd: gitDir, encoding: 'utf8' });
const dirtyGate4Ok = rDirtyGate4.status === 3;
extraCases++; if (!dirtyGate4Ok) bad++;
console.log((dirtyGate4Ok ? 'PASS  ' : 'FAIL  ') + 'D11 脏工作区 --gate4 禁进门 4 → want 3 got ' + rDirtyGate4.status);

rmSync(dir, { recursive: true, force: true });
console.log('\n结果：' + (CASES.length + extraCases - bad) + '/' + (CASES.length + extraCases) + ' 符合预期');
process.exit(bad ? 1 : 0);
