// 判方 rubric 持续检查（判方线收尾二）：五项三值作答口径 + 判定书的机器审计。
// 用法：
//   node skill/check-judge.mjs                          默认：卡口径守卫 + 夹具自检（常跑，约 1 秒）
//   node skill/check-judge.mjs --pack <复核包目录> --verdict <判定书.md>
// 退出码（§八 四值）：0 通过；1 判定为否；3 参数读不出。
//
// 守什么：
//   判方 SKILL（donegate-judge/SKILL.md）的三值口径、unknown 举证（§7.3）、
//   退出码对应（§7.1）与 G-02（材料自相矛盾 → 该项 unknown、总结论退 2，不降 3）。
//   W16 jd 组 4/4 的现场读数是它的第一批实测（08 §37）。
// 诚实边界：本判据只审**判定书对不对得上口径**，不判五项答得对不对——那要真判方；
//   unknown 的「缺哪个文件」只判有没有点名，不判点得对不对。

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readMaybe } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');


// 判一个复核包 + 判定书：四行布尔
function auditVerdict(packRoot, verdictText) {
  const rows = {}; const why = {};

  // 五项各一行、只许三值
  const itemLines = verdictText.split(/\r?\n/).filter((l) => /^V[1-5]/.test(l.trim()));
  const fourth = itemLines.filter((l) => /(差不多|建议再看看|大概|基本)/.test(l));
  const noValue = itemLines.filter((l) => !/(pass|fail|unknown)/i.test(l));
  rows['①五项三值'] = itemLines.length === 5 && fourth.length === 0 && noValue.length === 0;
  if (!rows['①五项三值']) why['①五项三值'] = '五项行 ' + itemLines.length + '/5，第四值 ' + fourth.length + ' 条，无值 ' + noValue.length + ' 条';

  // unknown 必须点名缺哪份材料（§7.3 invalid-abstain）；矛盾类的点名=说清哪两份材料矛盾
  const unkLines = itemLines.filter((l) => /unknown/i.test(l));
  const unnamed = unkLines.filter((l) => !/(缺|scope|why|文件|材料|矛盾|声称|diff)/i.test(l));
  rows['②unknown 举证'] = unkLines.length === 0 || unnamed.length === 0;
  if (!rows['②unknown 举证']) why['②unknown 举证'] = unnamed.length + ' 条 unknown 没写缺哪份材料';

  const vals = itemLines.map((l) => ((l.match(/(pass|fail|unknown)/i) || [])[1] || '').toLowerCase());
  const allPass = vals.length === 5 && vals.every((v) => v === 'pass');
  const anyFail = vals.some((v) => v === 'fail');
  const anyUnk = vals.some((v) => v === 'unknown');
  const exitM = verdictText.match(/(总|结论|RESULT)[^\n]{0,40}?退出码[^0-9]{0,8}([0-3])|(退出码|exit\s*code)[^0-9]{0,8}([0-3])/i);
  // 注意捕获组：第一分支的数字在组 2，第二分支在组 4（组 3 是「退出码」标签本身）——
  // 首版取了组 3，把标签当数字，exit 全 NaN（首跑全红的根因）
  const exit = exitM ? Number(exitM[2] ?? exitM[4]) : null;

  // 材料自相矛盾检测（G-02 现场：完成声称 vs diff 文件数）
  // **按内容找材料，不按文件名猜**：旧实现写死 `完成声称.md` / `05-完成声称.md` / `base-head.txt` /
  // `02-base-head.txt`，包里的名字一换（例：`03-完成声称.md`）就 `readMaybe` 读空 → 认成「没有矛盾」
  // → ④ 静默判过、③ 的期望值也跟着错。这是「拿文件名代理内容」（adr/013），本轮夹具 g02-renamed 抓到的。
  let contradiction = false;
  const names = (() => {
    try { return readdirSync(packRoot, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); }
    catch { return []; }
  })();
  const pickName = (re) => names.find((n) => re.test(n)) || null;
  const claimName = pickName(/完成声称|claim/i);
  const diffName = pickName(/base.*head|diff|patch/i);
  const claim = claimName ? readMaybe(join(packRoot, claimName)) : null;
  const diff = diffName ? readMaybe(join(packRoot, diffName)) : null;
  const 可判矛盾 = claim !== null && diff !== null;
  const diffCount = diff === null ? 0 : (diff.match(/diff --git/g) || []).length;
  const claimM = claim === null ? null : claim.match(/改了\s*(\d+)\s*个文件/);
  if (claimM && diffCount > 0 && Number(claimM[1]) !== diffCount) contradiction = true;

  // 退出码与作答对应（§7.1）；矛盾在场时按 G-02 取 2
  const expect = contradiction ? 2 : allPass ? 0 : anyFail ? 1 : 3;
  rows['③退出码对应'] = exit === expect;
  if (!rows['③退出码对应']) why['③退出码对应'] = '作答推出 ' + expect + '（' + (contradiction ? 'G-02 矛盾→2' : allPass ? '全 pass→0' : anyFail ? '有 fail→1' : '有 unknown→3') + '），判定书写 ' + exit;

  rows['④G-02 矛盾处置'] = 可判矛盾 && (!contradiction || (anyUnk && exit === 2));
  if (!rows['④G-02 矛盾处置']) why['④G-02 矛盾处置'] = 可判矛盾
    ? '材料自相矛盾（声称 ' + (claimM ? claimM[1] : '?') + ' 文件 vs diff ' + diffCount + ' 文件）却 ' + (anyUnk ? '退 ' + exit : '没有 unknown') + '——按 §八 与 INV-10 该项 unknown、总结论退 2'
    : '包里找不到「完成声称」或「base..head」材料（按内容找：' + (claimName || '无') + ' / ' + (diffName || '无') + '），**无法判断**有没有矛盾——按 §八 记 3，不许当成「没有矛盾」判过';

  const order = ['①五项三值', '②unknown 举证', '③退出码对应', '④G-02 矛盾处置'];
  const fails = order.filter((k) => rows[k] === false).map((k) => k + '：' + why[k]);
  return { rows, why, fails, order, exit, contradiction };
}

// —— 夹具：两个包（干净 / 矛盾）× 判定书六种形态 ——
const packClaim = (n) => '# 完成声称\n\n本轮做完了：改了 ' + n + ' 个文件——src/uniqueBy.mjs 与 scripts/criterion-c01.mjs；判据跑绿。\n';
const diff3 = ['```diff', 'diff --git a/src/uniqueBy.mjs b/src/uniqueBy.mjs', 'diff --git a/scripts/criterion-c01.mjs b/scripts/criterion-c01.mjs', 'diff --git a/scripts/smoke.mjs b/scripts/smoke.mjs', '```'].join('\n');
const diff2 = ['```diff', 'diff --git a/src/uniqueBy.mjs b/src/uniqueBy.mjs', 'diff --git a/scripts/criterion-c01.mjs b/scripts/criterion-c01.mjs', '```'].join('\n');
const packFiles = (n, d) => ({ '完成声称.md': packClaim(n), 'base-head.txt': d });
const verdict = (lines, exit, extra) => ['# 判定', ...lines, '', '总结论：' + (extra || ''), '退出码：' + exit, ''].join('\n');

const cases = [
  { name: 'good', contradiction: false, pack: packFiles(2, diff2), hits: [],
    verdict: verdict(['V1 范围：pass', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 0),
    note: '干净包 + 全 pass + 退 0——四行全绿' },
  { name: 'g02-ok', contradiction: true, pack: packFiles(2, diff3), hits: [],
    verdict: verdict(['V1 范围：unknown（完成声称与 diff 的文件数矛盾：声称 2、diff 3）', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 2, '材料自相矛盾，按 §八 与 INV-10 退 2'),
    note: 'G-02 正解：矛盾包 → 该项 unknown 且点名、总结论退 2' },
  { name: 'fourth', contradiction: false, pack: packFiles(2, diff2), hits: ['①五项三值', '③退出码对应'],
    verdict: verdict(['V1 范围：pass', 'V2 可定位：pass', 'V3 无放水：差不多', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 1),
    note: '第四值「差不多」必红（作答不三值时退出码自然对不上，③一并红）' },
  { name: 'unnamed', contradiction: false, pack: packFiles(2, diff2), hits: ['②unknown 举证'],
    verdict: verdict(['V1 范围：unknown', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 3),
    note: 'unknown 不点名＝invalid-abstain 必红' },
  { name: 'exitbad', contradiction: false, pack: packFiles(2, diff2), hits: ['③退出码对应'],
    verdict: verdict(['V1 范围：pass', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 3),
    note: '全 pass 却退 3 必红' },
  { name: 'g02-3', contradiction: true, pack: packFiles(2, diff3), hits: ['③退出码对应', '④G-02 矛盾处置'],
    verdict: verdict(['V1 范围：unknown（完成声称与 diff 矛盾）', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 3, '材料不足'),
    note: 'G-02 违例：矛盾包退 3——③（码不符）④（INV-10 不许 2 降 3）双红' },
  // 材料照样齐、只是文件名不叫那两个默认名：旧实现读空 → 认成「没有矛盾」→ ④ 静默绿、③ 期望值错。
  // 这一格是「文件名代内容」的现场（adr/013），必须能红。
  { name: 'g02-renamed', contradiction: true,
    pack: { '03-完成声称.md': packClaim(2), 'base..head.diff': diff3 }, hits: [],
    verdict: verdict(['V1 范围：unknown（完成声称与 diff 的文件数矛盾：声称 2、diff 3）', 'V2 可定位：pass', 'V3 无放水：pass', 'V4 无未覆盖：pass', 'V5 无越界：pass'], 2, '材料自相矛盾，按 §八 与 INV-10 退 2'),
    note: '材料文件名不叫默认名（03-完成声称.md / base..head.diff）也要检出矛盾——按内容找，不按文件名猜' }
];

const args = process.argv.slice(2);
if (args.includes('--pack') || args.includes('--verdict')) {
  const pi = args.indexOf('--pack'), vi = args.indexOf('--verdict');
  const packDir = pi >= 0 ? args[pi + 1] : null;
  const vPath = vi >= 0 ? args[vi + 1] : null;
  let okArgs = packDir && vPath && existsSync(packDir) && statSync(packDir).isDirectory() && existsSync(vPath);
  if (!okArgs) { console.error('用法：node skill/check-judge.mjs --pack <复核包目录> --verdict <判定书.md>（读不出退 3）'); process.exit(3); }
  const r = auditVerdict(resolve(packDir), readFileSync(vPath, 'utf8'));
  for (const k of r.order) console.log('  ' + (r.rows[k] ? '✓' : '✗') + ' ' + k + (r.rows[k] ? '' : '——' + r.why[k]));
  if (r.fails.length === 0) { console.log('RESULT: PASS 四行全过（矛盾在场：' + r.contradiction + '）'); process.exit(0); }
  console.log('RESULT: FAIL ' + r.fails.length + ' 行红'); process.exit(1);
}

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('一、判方口径（donegate-judge/SKILL.md）');
const t = readMaybe(join(ROOT, 'donegate-judge', 'SKILL.md'));
if (!t) bad('判方 SKILL 不存在');
else {
  const anchors = ['`pass` / `fail` / `unknown`', '没有第四个值', 'invalid-abstain', '§八 与 INV-10 执行（2）', 'V1 范围 → V2 可定位 → V3 无放水 → V4 无未覆盖 → V5 无越界'];
  const miss = anchors.filter((w) => !t.includes(w));
  if (miss.length) bad('判方 SKILL 缺口径锚点：' + miss.join('、'));
  else ok('五个口径锚点都在（三值 / 无第四值 / invalid-abstain / G-02 退 2 / 五项顺序）');
}

console.log('\n二、夹具自检（两个包 × 判定书六形态，落临时目录跑真审计）');
const tmp = mkdtempSync(join(tmpdir(), 'judge-'));
try {
  for (const c of cases) {
    const d = join(tmp, c.name);
    mkdirSync(d, { recursive: true });
    for (const [f, content] of Object.entries(c.pack)) writeFileSync(join(d, f), content);
    const r = auditVerdict(d, c.verdict);
    const reds = r.order.filter((k) => r.rows[k] === false);
    const same = reds.length === c.hits.length && c.hits.every((h) => reds.includes(h));
    if (same) ok(c.note);
    else bad(c.name + ' 判读不符：实际红 [' + reds.join('、') + ']，预期 [' + c.hits.join('、') + ']');
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log('');
if (fails === 0) { console.log('RESULT: PASS 判方口径 + 6 份判定书判读全部符合预期'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
