// 规格核验：针对第二轮修订后的规则，验证三处修正是否成立。
// 这是设计包的验收工具，不是产品实现。
//
// 用法：node tools/verify-spec.mjs
// 退出码：0 全部通过；1 有检查失败；2 环境不满足
//
// 三条设计原则（都是复审逼出来的）：
//   1. 正负样本必须走**同一个判定函数**。
//   2. 分类必须**从 tools/classification.json 派生**，不在脚本里另写谓词。
//   3. 判定函数必须**消费运行证据对象**（run.head / run.criteriaHash），
//      不许拿「工作区当前 HEAD」冒充「那次运行的 HEAD」。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SPEC_PATH = join(ROOT, '设计', '02-规格.md');
const DIAGRAM_PATH = join(ROOT, '设计', '01-图.md');
const RULES_PATH = join(HERE, 'classification.json');

for (const p of [SPEC_PATH, DIAGRAM_PATH, RULES_PATH]) {
  if (!existsSync(p)) { console.log('  ✗ 读不到 ' + p); process.exit(2); }
}
const spec = readFileSync(SPEC_PATH, 'utf8');
const diagram = readFileSync(DIAGRAM_PATH, 'utf8');
const rules = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failures++; console.log('  ✗ ' + m); };

// ─────────────────────────────────────────────
// 检查 1：分类器由 classification.json 驱动
// ─────────────────────────────────────────────
console.log('检查 1 · 四个子数（权威：tools/classification.json）');

function matchRow(o, row) {
  const w = row.when;
  if (Array.isArray(w.run) ? !w.run.includes(o.run) : w.run !== o.run) return false;
  if (typeof w.pendingRecheck === 'boolean' && w.pendingRecheck !== o.pendingRecheck) return false;
  if (w.teeth !== undefined) {
    if (w.teeth === null) { if (o.teeth !== undefined && o.teeth !== null) return false; }
    else if (!w.teeth.includes(o.teeth)) return false;
  }
  return true;
}

// 唯一判定函数：按行序，第一条命中即止。正负样本都用它。
function classify(o) {
  for (const row of rules.rows) {
    if (matchRow(o, row)) return { matched: true, subclass: row.subclass, label: row.label, counts: row.counts };
  }
  return { matched: false, subclass: null };
}

// 1a 规格表格是否是 classification.json 的忠实渲染
//    （逐行核对：行序、分类名、条件关键字都要对上）
const specTableRows = [...spec.matchAll(/^\| \*\*(\d)\*\* \|(.+?)\| \*\*`(A\d)`/gm)].map((m) => ({
  order: Number(m[1]), cond: m[2].trim(), subclass: m[3]
}));
if (specTableRows.length !== rules.rows.length) {
  bad('规格表格行数 ' + specTableRows.length + ' ≠ 规则文件 ' + rules.rows.length);
} else {
  ok('规格表格行数 = 规则文件行数（' + rules.rows.length + ' 行）');
}
let orderOk = true;
for (let i = 0; i < rules.rows.length; i++) {
  const s = specTableRows[i];
  const r = rules.rows[i];
  if (!s || s.order !== r.order || s.subclass !== r.subclass) { orderOk = false; break; }
}
if (orderOk) ok('行序与分类名逐行一致：' + rules.rows.map((r) => r.subclass).join(' → '));
else bad('行序或分类名与规则文件不一致');

// 1b 条件关键字是否出现在规格对应行里（防止「只改名称不改条件」的漂移）
let condMismatch = 0;
for (let i = 0; i < rules.rows.length; i++) {
  const s = specTableRows[i];
  const r = rules.rows[i];
  if (!s) { condMismatch++; continue; }
  const teethList = Array.isArray(r.when.teeth) ? r.when.teeth : [];
  for (const t of teethList) {
    if (!s.cond.includes(t) && !s.cond.includes('`' + t + '`')) { condMismatch++; console.log('    · ' + r.subclass + ' 的条件里 ' + t + ' 未出现在规格行中'); }
  }
  if (r.when.teeth === null && !/undefined/.test(s.cond)) { condMismatch++; console.log('    · ' + r.subclass + ' 要求 teeth = undefined，规格行未写'); }
}
// 布尔条件也要核对：A4 行必须写 true，A1/A2/A3 行必须写 false 或不写
for (let i = 0; i < rules.rows.length; i++) {
  const s = specTableRows[i]; const r = rules.rows[i];
  if (!s) continue;
  if (r.when.pendingRecheck === true && !/pendingRecheck = true/.test(s.cond)) { condMismatch++; console.log('    · ' + r.subclass + ' 要求 pendingRecheck = true，规格行未写'); }
  if (r.when.pendingRecheck === false && !/pendingRecheck = false/.test(s.cond)) { condMismatch++; console.log('    · ' + r.subclass + ' 要求 pendingRecheck = false，规格行未写'); }
}
if (condMismatch === 0) ok('行序、分类名、布尔条件、状态枚举都与规格一致');
else bad('规格与规则文件条件不一致 ' + condMismatch + ' 处');

// 1c 各类的「是否计入」必须与独立期望值一致（期望值写在这里，不读 JSON，防止规则与展示一起改错）
const EXPECTED_COUNTS = { A4: false, A1: true, A2: false, A3: false };
let countsMismatch = 0;
for (const row of rules.rows) {
  const want = EXPECTED_COUNTS[row.subclass];
  if (row.counts !== want) { countsMismatch++; console.log("    · " + row.subclass + " 的 counts 应为 " + want + "，实为 " + row.counts); }
}
if (countsMismatch === 0) ok("各类「是否计入」与独立期望值一致（A1=true，其余 false）");
else bad("各类「是否计入」与期望不符 " + countsMismatch + " 处");

// 1d 业务样例：一条原本计入通过的义务转为待重验后，可签收的通过数应减一
//     这个期望值独立于 JSON，用来发现「规则和展示一起改错」
const sampleBefore = { run: "pass", teeth: "killed", pendingRecheck: false };
const sampleAfter = { run: "pass", teeth: "killed", pendingRecheck: true };
const cBefore = classify(sampleBefore);
const cAfter = classify(sampleAfter);
const signableBefore = cBefore.counts ? 1 : 0;
const signableAfter = cAfter.counts ? 1 : 0;
if (signableBefore === 1 && signableAfter === 0) ok("业务样例：同一义务转为待重验后，可签收通过数由 1 变 0");
else bad("业务样例不符：转待重验前可签收 " + signableBefore + "、之后 " + signableAfter + "（期望 1 → 0）");

// 1e 穷尽 + 互斥
const teeths = ['killed', 'survived', 'no-coverage', 'compile-error', 'runtime-error', 'timeout', 'red-wrong-assertion', 'hollow-assertion', undefined];
let total = 0, unclassified = 0, multi = 0;
const counts = {};
for (const t of rules.rows) counts[t.subclass] = 0;
for (const teeth of teeths) {
  for (const pendingRecheck of [true, false]) {
    total++;
    const o = { run: 'pass', teeth, pendingRecheck };
    const hits = rules.rows.filter((r) => matchRow(o, r));
    if (hits.length === 0) unclassified++;
    if (hits.length > 1) multi++;
    const c = classify(o);
    if (c.matched) counts[c.subclass]++;
  }
}
if (multi === 0) ok('互斥（' + total + ' 种「通过」组合）');
else bad(multi + ' 种组合命中多行');
if (unclassified === 0) ok('穷尽（每种「通过」组合都命中一行）');
else bad(unclassified + ' 种组合没命中任何一行');
console.log('    分布：' + Object.entries(counts).map(([k, v]) => k + '=' + v).join(' '));

// 1d 复审的三处差异（用同一 classify 验）
const reviewCases = [
  { label: 'survived + pending', o: { run: 'pass', teeth: 'survived', pendingRecheck: true }, expect: 'A4' },
  { label: '无实验 + pending', o: { run: 'pass', teeth: undefined, pendingRecheck: true }, expect: 'A4' },
  { label: 'compile-error + 不 pending', o: { run: 'pass', teeth: 'compile-error', pendingRecheck: false }, expect: 'A2' }
];
for (const c of reviewCases) {
  const got = classify(c.o);
  if (got.subclass === c.expect) ok(c.label + ' → ' + got.subclass);
  else bad(c.label + ' 应归 ' + c.expect + '，实得 ' + got.subclass);
}

// ─────────────────────────────────────────────
// 检查 2：待重验必须经过重跑
// ─────────────────────────────────────────────
console.log('');
console.log('检查 2 · 待重验的路由（图一）');

const edges = new Map();
for (const line of diagram.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z][A-Z0-9]*)\s*-->\s*(?:\|[^|]*\|\s*)?([A-Z][A-Z0-9]*)/);
  if (m) edges.set(m[1], [...(edges.get(m[1]) ?? []), m[2]]);
}
function reachable(from, to, banned = new Set()) {
  const queue = [from];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (node === to) return true;
    if (seen.has(node) || banned.has(node)) continue;
    seen.add(node);
    for (const t of edges.get(node) ?? []) queue.push(t);
  }
  return false;
}
if (reachable('PENDING', 'DONE', new Set(['RECHECK']))) bad('摘掉 RECHECK 后仍可从 PENDING 到 DONE（存在绕过）');
else ok('摘掉 RECHECK 后 PENDING 到不了 DONE（无绕过）');
if ((edges.get('PENDING') ?? []).includes('G5')) bad('PENDING 有直连 G5 的边');
else ok('PENDING 没有直连 G5 的边');

// ─────────────────────────────────────────────
// 检查 3：冻结与实现 —— 判定函数必须消费运行证据
// ─────────────────────────────────────────────
console.log('');
console.log('检查 3 · 冻结与实现（规格 §8.2.2）');

let tmp;
try { tmp = mkdtempSync(join(tmpdir(), 'nc-verify-')); }
catch { console.log('  ✗ 建不了临时目录'); process.exit(2); }

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ⚠ 唯一的顺序判定函数。正负样本都调它。
// 关键：③ 比的是 **run.head**（运行证据自带的版本），不是工作区当前 HEAD。
// 规格 §8.2.2 的五条：
//   ① implement.base === freeze.freezeCommit
//   ② run.criteriaHash === freeze.criteriaHash
//   ③ run.head === implement.head
//   ④a 事件链 seq 单调连续（不跳号）
//   ④b freezeCommit 在仓库里真实存在
function judgeOrder({ repo, freezeCommit, implementBase, implementHead, run, frozenCriteria, ledgerSeqs }) {
  const checks = [];
  checks.push({ id: '①', name: 'implement.base === freeze.freezeCommit', pass: implementBase === freezeCommit });
  // ② 的基准来自**冻结记录**（frozenCriteria），不是 run 对象里那两个字段。
  checks.push({ id: '②', name: 'run.criteriaHash === frozenCriteria.hash', pass: run.criteriaHash === frozenCriteria.hash });
  // ③ 用运行证据里的 head，不用 repo 的当前 HEAD
  checks.push({ id: '③', name: 'run.head === implement.head', pass: run.head === implementHead });
  // ④a seq 单调连续
  // ④a 必须从 1 开始，且单调连续（规格 §8.2.2 ④a）
  const seqOk = Array.isArray(ledgerSeqs) && ledgerSeqs.length > 0 &&
    ledgerSeqs[0] === 1 &&
    ledgerSeqs.every((s, i) => i === 0 || s === ledgerSeqs[i - 1] + 1);
  checks.push({ id: '④a', name: 'ledger seq 从 1 起且单调连续', pass: seqOk });
  // ④b freezeCommit 存在
  let exists = false;
  try { git(['cat-file', '-e', freezeCommit + '^{commit}'], repo); exists = true; } catch { exists = false; }
  checks.push({ id: '④b', name: 'freezeCommit 存在', pass: exists });
  return { checks, accepted: checks.every((c) => c.pass) };
}

const CRIT_V1 = '{"claim":"price returns 42"}';
const CRIT_V1_HASH = sha(CRIT_V1);

function makeRepo(initialCriteria) {
  const d = mkdtempSync(join(tmp, 'repo-'));
  git(['init', '-q'], d);
  git(['config', 'user.email', 'v@example.com'], d);
  git(['config', 'user.name', 'verify'], d);
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 0;\n');
  writeFileSync(join(d, 'criteria.json'), initialCriteria);
  git(['add', '-A'], d);
  git(['commit', '-qm', 'base'], d);
  return d;
}

// 正样本：base = freezeCommit，运行证据来自该版本
{
  const d = makeRepo('{"claim":"TBD"}');
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 42;\n');
  git(['commit', '-qam', 'implement'], d);
  const head = git(['rev-parse', 'HEAD'], d);

  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: freezeCommit, implementHead: head,
    run: { head, criteriaHash: CRIT_V1_HASH },
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [1, 2, 3, 4]
  });
  if (r.accepted) ok('正样本：五条检查全过');
  else bad('正样本被拒：' + r.checks.filter((c) => !c.pass).map((c) => c.id + '(' + c.name + ')').join(', '));
}

// 负样本 1：实现先于冻结
{
  const d = makeRepo('{"claim":"TBD"}');
  const base = git(['rev-parse', 'HEAD'], d);
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 42;\n');
  git(['commit', '-qam', 'implement-first'], d);
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze-after'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);

  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: base, implementHead: freezeCommit,
    run: { head: freezeCommit, criteriaHash: CRIT_V1_HASH },
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [1, 2]
  });
  if (!r.accepted && r.checks.find((c) => c.id === '①').pass === false) ok('负样本1：实现先于冻结被 ① 拒绝');
  else bad('负样本1 没被拒绝');
}

// 负样本 2：运行证据绑的是改过的判据
{
  const d = makeRepo('{"claim":"TBD"}');
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);
  writeFileSync(join(d, 'criteria.json'), '{"claim":"price returns 42","relaxed":true}');
  git(['commit', '-qam', 'relax'], d);
  const head = git(['rev-parse', 'HEAD'], d);

  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: freezeCommit, implementHead: head,
    run: { head, criteriaHash: sha('{"claim":"price returns 42","relaxed":true}') },
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [1, 2, 3]
  });
  if (!r.accepted && r.checks.find((c) => c.id === '②').pass === false) ok('负样本2：运行绑了非冻结判据，被 ② 拒绝');
  else bad('负样本2 没被拒绝');
}

// 负样本 3（复审本轮指出的核心缺口）：仓库已在目标版本，但证据来自旧版本
{
  const d = makeRepo('{"claim":"TBD"}');
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);
  // F 版本：返回 42，跑通，记录 run.head = F
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 42;\n');
  git(['commit', '-qam', 'F'], d);
  const F = git(['rev-parse', 'HEAD'], d);
  const oldRun = { head: F, criteriaHash: CRIT_V1_HASH, };
  // H 版本：返回 43，判据不变，工作区 HEAD 变成 H
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 43;\n');
  git(['commit', '-qam', 'H'], d);
  const H = git(['rev-parse', 'HEAD'], d);

  // 把旧运行记录交给判定函数，目标实现设为 H
  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: freezeCommit, implementHead: H,
    run: oldRun,
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [1, 2, 3, 4]
  });
  if (!r.accepted && r.checks.find((c) => c.id === '③').pass === false) {
    ok('负样本3：旧证据冒充新版本，被 ③ 拒绝（run.head=' + F.slice(0, 7) + ' ≠ implement.head=' + H.slice(0, 7) + '）');
  } else bad('负样本3 没被拒绝 —— ③ 仍在查工作区 HEAD 而不是运行证据');
}

// 负样本 4：事件链 seq 跳号
{
  const d = makeRepo('{"claim":"TBD"}');
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 42;\n');
  git(['commit', '-qam', 'implement'], d);
  const head = git(['rev-parse', 'HEAD'], d);

  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: freezeCommit, implementHead: head,
    run: { head, criteriaHash: CRIT_V1_HASH },
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [1, 3]   // ← 跳号
  });
  if (!r.accepted && r.checks.find((c) => c.id === '④a').pass === false) ok('负样本4：seq 跳号被 ④a 拒绝');
  else bad('负样本4 没被拒绝 —— ④a 未按规格检查 seq 单调');
}

// 负样本 5（复审终稿指出）：账本从 2 开始。规格要求「从 1 开始」，只查单调会漏掉。
{
  const d = makeRepo('{"claim":"TBD"}');
  writeFileSync(join(d, 'criteria.json'), CRIT_V1);
  git(['commit', '-qam', 'freeze'], d);
  const freezeCommit = git(['rev-parse', 'HEAD'], d);
  writeFileSync(join(d, 'price.mjs'), 'export const price = () => 42;\n');
  git(['commit', '-qam', 'implement'], d);
  const head = git(['rev-parse', 'HEAD'], d);

  const r = judgeOrder({
    repo: d, freezeCommit,
    implementBase: freezeCommit, implementHead: head,
    run: { head, criteriaHash: CRIT_V1_HASH },
    frozenCriteria: { id: freezeCommit, hash: CRIT_V1_HASH },
    ledgerSeqs: [2, 3]   // ← 从 2 开始，规格要求从 1
  });
  if (!r.accepted && r.checks.find((c) => c.id === '④a').pass === false) ok('负样本5：账本从 2 开始被 ④a 拒绝（规格要求从 1）');
  else bad('负样本5 没被拒绝 —— ④a 未检查起点是否为 1');
}

rmSync(tmp, { recursive: true, force: true });

// ─────────────────────────────────────────────
console.log('');
if (failures === 0) { console.log('RESULT: PASS 三处规则核验通过（分类由规则文件驱动；判定函数消费运行证据）'); process.exit(0); }
console.log('RESULT: FAIL ' + failures + ' 项');
process.exit(1);
