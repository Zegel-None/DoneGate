// 决策记录 INV-13 持续检查（判方线第二件）：decisions/ 只许新增、不许改写。
// 用法：
//   node skill/check-decisions.mjs                    默认：产品口径锚点 + 夹具自检（常跑，约 2–4 秒）
//   node skill/check-decisions.mjs --root <项目根>     审一个真实项目的 decisions/（无该目录时 SKIP 退 0）
// 退出码（§八 四值）：0 通过或 SKIP；1 判定为否；3 无法判断（参数、目录读不出、不是 git 仓库）。
//
// 守什么：
//   INV-13（02-规格 §一）：decisions/ 下已存在的文件，在 git 历史里不许出现修改，只许新增。
//   规格给的判法就是对每个已存在文件查 git log --follow --diff-filter=M，有结果即红。
//   另加一行（比规格严）：git status 里 decisions/ 下已跟踪文件的未提交改动（M）也算改写——
//   只查历史会漏掉「改了还没提交」的当场篡改。未跟踪 / 暂存新增（?? / A）算新增，不红。
//
// 诚实边界（按 adr/007 降一档采信）：
//   1. 夹具是本脚本自己造的临时 git 仓库——仪器自测只证明判据形状没坏；真实项目用 --root 审。
//   2. 「把整份旧记录另存成新文件名、内容重写」在历史判据上长得像新增——机器分不出来；
//      门 0.2 要求最近一条决策记录里出现当前意图哈希，是它的人工兜底。
//   3. §2.5 的「不可改写，只能被新记录取代」正文在设计包里（02-规格 §2.5），本检查只守
//      产品文本里的操作锚点，不动设计包。

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

// 审一个项目根的 decisions/：两行布尔 + 缺口说明
function auditDecisions(projectRoot) {
  const decDir = join(projectRoot, 'decisions');
  if (!existsSync(decDir)) return { skip: true };
  if (!statSync(decDir).isDirectory()) return { error: 'decisions/ 不是目录（退 3）' };
  const files = readdirSync(decDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

  // ① 历史无改写：对每个已存在文件查 git log --follow --diff-filter=M，并查 decisions/ 已提交删除 (D)
  const logHits = [];
  let gitBroken = false;
  for (const f of files) {
    const r = git(projectRoot, ['log', '--follow', '--diff-filter=M', '--format=%h', '--', 'decisions/' + f]);
    if (r.status !== 0) { gitBroken = true; continue; }
    if (r.stdout.trim()) logHits.push(f + '（' + r.stdout.trim().split(/\s+/).slice(0, 3).join(' ') + '）');
  }
  const delR = git(projectRoot, ['log', '--diff-filter=D', '--name-only', '--format=', '--', 'decisions/']);
  if (delR.status !== 0) gitBroken = true;
  else if (delR.stdout.trim()) for (const dp of delR.stdout.trim().split(/\r?\n/)) if (dp.trim()) logHits.push(dp.trim() + '（已删除）');
  if (gitBroken) return { error: 'git 历史读不出来（不是仓库或 git 坏了，退 3）' };

  // ② 工作区与 HEAD 一致：已跟踪文件的未提交改动（M/R/D）也是改写；?? 与 A 算新增不红
  const st = git(projectRoot, ['status', '--porcelain', '--', 'decisions/']);
  if (st.status !== 0) return { error: 'git status 读不出来（不是仓库，退 3）' };
  const wtHits = [];
  for (const line of st.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const x = line[0], y = line[1];
    if (x === 'M' || y === 'M' || x === 'R' || x === 'D' || y === 'D') wtHits.push(line.slice(3).split(' -> ').pop().trim());
  }

  return {
    skip: false,
    rows: { '①历史无改写': logHits.length === 0, '②工作区与HEAD一致': wtHits.length === 0 },
    why: {
      '①历史无改写': 'git log --diff-filter=DM 命中：' + logHits.slice(0, 3).join('、'),
      '②工作区与HEAD一致': '未提交的改写：' + wtHits.slice(0, 3).join('、')
    },
    count: files.length
  };
}

// —— 夹具构造：临时 git 仓库，覆盖「新增合法 ×2」与「改写/删除必红 ×4」——
function decisionBody(title, takeaway) {
  return ['# ' + title, '', '## 当时的问题', 'c01 的判据按旧意图写。', '## 可选方案', '甲：改判据。乙：保留旧判据。', '## 选了哪个', '选甲。', '## 为什么', '乙会让判据与意图长期背离。', '## 什么条件下翻案', takeaway, ''].join('\n');
}

function buildRepo(parent, variant) {
  const d = join(parent, 'proj');
  mkdirSync(join(d, 'decisions'), { recursive: true });
  git(d, ['init', '-q']);
  git(d, ['config', 'user.email', 'fixture@local']);
  git(d, ['config', 'user.name', 'fixture']);
  const commit = (m) => { git(d, ['add', '-A']); git(d, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m]); };
  writeFileSync(join(d, 'decisions', '2026-11-18-立项.md'), decisionBody('立项与首条判据', '若意图回退到旧版本，本记录作废。'));
  writeFileSync(join(d, 'decisions', '2026-11-19-冻结c01.md'), decisionBody('冻结 c01', '若业主裁定 c01 不再必需，本记录作废。'));
  commit('two decisions');
  if (variant === 'good-add') {
    writeFileSync(join(d, 'decisions', '2026-11-19-改边界.md'), decisionBody('改边界', '若边界再动，本记录作废。'));
    commit('new decision');
  }
  if (variant === 'good-untracked') {
    writeFileSync(join(d, 'decisions', '2026-11-19-改边界.md'), decisionBody('改边界', '若边界再动，本记录作废。')); // 未提交：?? 算新增
  }
  if (variant === 'bad-commit') {
    const p = join(d, 'decisions', '2026-11-18-立项.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n（偷偷补一句，没写新记录。）\n');
    commit('tamper');
  }
if (variant === 'bad-worktree') {
    const p = join(d, 'decisions', '2026-11-18-立项.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n（偷偷补一句，还没提交。）\n');
  }
  if (variant === 'bad-delete') { git(d, ['rm', '-q', 'decisions/2026-11-19-冻结c01.md']); commit('delete decision'); }
  if (variant === 'bad-worktree-delete') { rmSync(join(d, 'decisions', '2026-11-19-冻结c01.md')); }
  return d;
}

const cases = [
  { name: 'good-add', red: [], note: '新增一条并提交——合法，两行全绿' },
  { name: 'good-untracked', red: [], note: '新增一条未提交（??）——算新增不算改写，两行全绿' },
  { name: 'bad-commit', red: ['①历史无改写'], note: '改写已存在记录并提交——git log --follow --diff-filter=M 必红，②不红' },
  { name: 'bad-worktree', red: ['②工作区与HEAD一致'], note: '改写已存在记录未提交——当场篡改必红（只查历史会漏），①不红' },
  { name: 'bad-delete', red: ['①历史无改写'], note: '删除已存在记录并提交 (git rm)——--diff-filter=D 必红，②不红' },
  { name: 'bad-worktree-delete', red: ['②工作区与HEAD一致'], note: '删除已存在记录未提交 (D)——工作区比对必红，①不红' }
];

const args = process.argv.slice(2);

if (args[0] === '--root') {
  const dir = args[1];
  let okDir = false;
  try { okDir = !!dir && statSync(dir).isDirectory(); } catch { okDir = false; }
  if (!okDir) { console.error('用法：node skill/check-decisions.mjs --root <项目根>（目录读不出来退 3）'); process.exit(3); }
  const r = auditDecisions(resolve(dir));
  if (r.error) { console.error(r.error); process.exit(3); }
  if (r.skip) { console.log('SKIP ' + dir + ' 没有 decisions/ 目录（INV-13 无对象）'); process.exit(0); }
  console.log('decisions/ 共 ' + r.count + ' 份');
  for (const k of Object.keys(r.rows)) console.log('  ' + (r.rows[k] ? '✓' : '✗') + ' ' + k + (r.rows[k] ? '' : '——' + r.why[k]));
  if (Object.values(r.rows).every(Boolean)) { console.log('RESULT: PASS 两行全过'); process.exit(0); }
  console.log('RESULT: FAIL 有改写');
  process.exit(1);
}


let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('一、产品口径锚点（决策记录那条线：何时写 / 补记录不改哈希 / 判方例外附上）');
const 锚点 = [
  { file: 'donegate/SKILL.md', need: ['7. **写决策记录**', '只在这一轮改了判据、边界或意图时写'] },
  { file: 'donegate/references/门0-起手.md', need: ['打开最近一条决策记录', '补记录，不要改哈希去凑'] },
  { file: 'donegate/references/判方材料包.md', need: ['把决策记录附进来', '§7.2'] }
];
for (const a of 锚点) {
  const p = join(ROOT, ...a.file.split('/'));
  if (!existsSync(p)) { bad('要守的文件不存在：' + a.file); continue; }
  const t = readFileSync(p, 'utf8');
  const miss = a.need.filter((w) => !t.includes(w));
  if (miss.length) bad(a.file + ' 缺口径锚点：' + miss.join('、'));
  else ok(a.file + '：' + a.need.length + ' 个锚点都在');
}

console.log('\n二、夹具自检（临时 git 仓库 ×6，两行真判）');
const tmp = mkdtempSync(join(tmpdir(), 'dec-'));
try {
  for (const c of cases) {
    const r = auditDecisions(buildRepo(join(tmp, c.name), c.name));
    if (r.error || r.skip) { bad(c.name + ' 夹具没建成：' + (r.error || 'skip')); continue; }
    const actual = Object.keys(r.rows).filter((k) => !r.rows[k]);
    const missRed = c.red.filter((x) => !actual.includes(x));
    const extraRed = actual.filter((x) => !c.red.includes(x));
    if (missRed.length === 0 && extraRed.length === 0) ok(c.note);
    if (missRed.length) bad(c.name + ' 该红不红（判据没牙了）：' + missRed.join('、'));
    if (extraRed.length) bad(c.name + ' 不该红却红（误拦）：' + extraRed.join('、'));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (fails === 0) { console.log('RESULT: PASS 决策记录口径 + 6 份夹具判读全部符合预期'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
