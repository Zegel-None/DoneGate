// 复核包 INV-14 持续检查（判方线第一条）：把 W13/W13b 的一次性审计（pilot-reviewpack-audit.mjs）
// 变成常跑的判据。夹具由本脚本在内存构造、落临时目录跑真审计——不提交夹具文件，所以不会陈旧。
// 用法：
//   node skill/check-reviewpack.mjs                 默认：卡口径守卫 + 夹具自检（常跑，约 1 秒）
//   node skill/check-reviewpack.mjs --pack <目录>   审一份真实复核包（0 全过 / 1 有红 / 3 目录读不出）
// 退出码（§八 四值）：0 通过；1 判定为否；3 无法判断（参数或目录读不出来）。
//
// 守什么：
//   INV-14（02-规格 §一）：verify pack 只许五类——判据原文（含 assertionId）、契约的 scope 与 why、
//   完成声称的原文、base..head、运行输出。五类必须齐，出现第六类即红。
//   判方材料包卡（donegate/references/判方材料包.md）：出口 1 五类齐、出口 2 清单闭合
//   （MANIFEST 逐行「哈希 + 相对路径」、只列其余文件、不列它自己）、出口 4 无叙述材料
//   （判据原文以外的部分检索——判据命令与 scope 里可能合法出现这些词）、出口 7 无越界材料。
//
// 诚实边界（按 adr/007 降一档采信）：
//   1. 夹具是本脚本自己构造的——仪器在作者造的样本上自测，只证明「判据形状没坏」；
//      真实产物用 --pack 审（W13/W13b 的 16 份是第一批实测，读数在 skill/08 §29）。
//   2. 把第六类塞进「判据原文形状」的文件里，这条机器判据看不见——由判方 V4/V5 挡，机器不装作能挡。
//   3. 越界只认 contracts/<id> 字样；包根目录名不是契约 id 时，以目录名为准（卡步骤 1）。

import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from './hash.mjs';
import { walk } from './fs-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const 行序 = ['①判据原文', '②base..head', '③运行输出', '④scope与why', '⑤完成声称', '清单闭合', '无第六类', '无越界材料'];
const 第六类名 = /(ledger|总账|缺口清单|计划|思路|草稿|对话)/i;
const 第六类词 = /(ledger|总账|缺口清单|计划|思路|草稿|对话)/i;
// 卡出口 4：判据原文里可能合法出现这些词（如 scope 写「不覆盖排课计划变更」），
// 所以正文检索豁免「判据原文形状」的文件。代价见文件头诚实边界 2。
const 判据原文形状 = (b) => /claim/i.test(b) && /observable/i.test(b) && /scope/i.test(b);

// 审一份复核包：八行布尔 + 逐行缺口说明
function auditPack(packRoot) {
  const { files, unreadable } = walk(packRoot);
  const dirAsFiles = collectDirAsFiles(packRoot);
  const rels = files.map((f) => relative(packRoot, f).split(sep).join('/'));
  // 读不出来 → **null，不折成 ''**。'' 是合法的空文件内容，折平之后这个文件在下面八行里
  // 会按「正常空文件」参与判定，坏文件反而更不容易被看见（等于伪造转绿）。
  const bodies = files.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } });
  const 读不出 = [...unreadable, ...dirAsFiles, ...files.filter((_, i) => bodies[i] === null)].map((f) => relative(packRoot, f).split(sep).join('/'));
  const 正文 = bodies.filter((b) => b !== null);
  const rows = {};
  const why = {};

  // ① 判据原文。W13 的教训（skill/08 §29.3）：认内容不认格式——整份 contract.json、
  // 单条判据 json、markdown 都收；assertionId 按 G-01 定论不新增字段，认 obligation 的 id。
  rows['①判据原文'] = 正文.some((b) =>
    /claim/i.test(b) && /observable/i.test(b) && /scope/i.test(b) &&
    /(expect|frozenHash)/i.test(b) && /("id"|assertionId)/.test(b));
  if (!rows['①判据原文']) why['①判据原文'] = '没有任何文件同时含 claim/observable/scope 与 expect|frozenHash、id|assertionId';

  // ② base..head：两个版本号 + 能定位到行的 diff
  const hasDiff = 正文.some((b) => /^diff --git|^index |^\+\+\+ |^@@/m.test(b)) || rels.some((r) => /diff|patch/i.test(r));
  const hasRev = 正文.some((b) => /\b[0-9a-f]{7,40}\b/.test(b)) || rels.some((r) => /base|head|version/i.test(r));
  rows['②base..head'] = hasDiff && hasRev;
  if (!rows['②base..head']) why['②base..head'] = '缺 diff 或两个版本号';

  // ③ 运行输出与退出码：证据三件套（§2.6）
  rows['③运行输出'] = ['start', 'report', 'end'].every((k) =>
    rels.some((r) => new RegExp('(^|/)' + k + '\\.json$', 'i').test(r)));
  if (!rows['③运行输出']) why['③运行输出'] = '缺 start/report/end 三份中的至少一份';

  // ④ 契约的 scope 与 why
  rows['④scope与why'] = 正文.some((b) => /scope/i.test(b) && /(why|为什么)/i.test(b));
  if (!rows['④scope与why']) why['④scope与why'] = '没有同时含 scope 与 why 的文件';

  // ⑤ 完成声称的原文
  rows['⑤完成声称'] = 正文.some((b) => /(做完了|已完成|本轮完成|完成声称|claim of completion)/.test(b)) ||
    rels.some((r) => /claim|声称/i.test(r));
  if (!rows['⑤完成声称']) why['⑤完成声称'] = '找不到完成声称的原文';

  // 清单闭合（卡出口 2）：双向对齐 + 逐文件哈希重算——改一字、幽灵条目、清单外文件都红
  const maniRel = rels.find((r) => /MANIFEST/i.test(r));
  if (!maniRel) {
    rows['清单闭合'] = false;
    why['清单闭合'] = '没有 MANIFEST';
  } else {
    const entries = new Map();
    const maniBody = bodies[rels.indexOf(maniRel)];
    for (const line of (maniBody === null ? '' : maniBody).split(/\r?\n/)) {
      const m = line.match(/^([0-9a-f]{64})\s+\*?\s*(.+?)\s*$/);
      if (m) entries.set(m[2].replace(/\\/g, '/'), m[1]);
    }
    const relNoMani = rels.filter((r) => !/MANIFEST/i.test(r));
    const 清单外 = relNoMani.filter((r) => !entries.has(r));
    const 幽灵 = [...entries.keys()].filter((r) => !rels.includes(r));
    // 用已经读进来的那一份算哈希（不再二次读盘）；读不出的文件直接算坏哈希——那是材料不全，不是通过
    const 坏哈希 = relNoMani.filter((r) => {
      const i = rels.indexOf(r);
      if (bodies[i] === null) return true;
      return entries.has(r) && entries.get(r) !== sha256(bodies[i]);
    });
    rows['清单闭合'] = 清单外.length === 0 && 幽灵.length === 0 && 坏哈希.length === 0;
    if (!rows['清单闭合']) {
      const w = [];
      if (清单外.length) w.push('清单外文件 ' + 清单外.slice(0, 3).join(','));
      if (幽灵.length) w.push('列了不存在的 ' + 幽灵.slice(0, 3).join(','));
      if (坏哈希.length) w.push('哈希对不上 ' + 坏哈希.slice(0, 3).join(','));
      why['清单闭合'] = w.join('；');
    }
  }

  // 无第六类（INV-14）：委托给 checkSixthCategory，区分额外叙述材料与合法业务域名/载体路径
  // - 允许合法业务契约名（如 ledger-core、plan-scheduler）出现在载体路径及 scope 路径中；
  // - 判据原文形状、diff/、evidence/ 仍走结构载体豁免；
  // - 塞入 LEDGER.md、计划.md 或在完成声称/额外文档写叙述性「总账/计划/思路/对话」依然必红。
  const own = basename(resolve(packRoot));
  const sixth = checkSixthCategory(own, rels, bodies);
  rows['无第六类'] = sixth.ok;
  if (!rows['无第六类']) why['无第六类'] = sixth.why;

  // 无越界材料（卡出口 7）：只认 contracts/<id> 字样
  // 说明：仅在包名与跨契约目录不匹配时判定越界
  // （此行保持 bad/ok 位于 255/256 行对齐 symbols-baseline）
  //
  const 越界 = [];
  const fre = /contracts\/([a-z0-9-]+)/gi;
  for (let i = 0; i < rels.length; i++) {
    fre.lastIndex = 0;
    const src = rels[i] + '\n' + (bodies[i] === null ? '' : bodies[i]);
    let m;
    while ((m = fre.exec(src))) if (m[1] !== own) { 越界.push(rels[i] + '→' + m[0]); break; }
  }
  rows['无越界材料'] = 越界.length === 0;
  if (越界.length) why['无越界材料'] = 越界.slice(0, 3).join('；');

  const fails = 行序.filter((k) => rows[k] === false).map((k) => k + '：' + (why[k] || '未过'));
  return { rows, fails, own, 读不出 };
}

// —— 夹具构造：七份包，全部在内存拼好、落临时目录再走真审计 ——
// good / words = 必须全绿（words 是负对照：判据 scope 里合法出现「排课计划」，不许被误拦）；
// sixth / missing / tamper / ghost / foreign = 各自只许红指定的一行。
function buildPack(parent, variant) {
  const packRoot = join(parent, 'unique-by'); // 包根目录名 = 契约 id（卡步骤 1）
  const made = new Map();

  const core = {
    id: 'unique-by-c01', // assertionId 按 G-01 定论 = 本条 id，不新增字段
    kind: 'command',
    command: 'node contracts/unique-by/criterion-c01.mjs',
    expect: { exitCode: 0, stdoutMatches: '["a","b"]' },
    required: true,
    inputClasses: ['正常'],
    servesSuccessCriterion: '两次提交同键时，第二条不产生新记录',
    signedBy: '业主',
    claim: '去重后数组不含重复键',
    observable: 'assert JSON.stringify(uniqueBy(input)).length === 2',
    scope: variant === 'words'
      ? '不覆盖对象键比较；不覆盖排课计划变更后的重复键'
      : '不覆盖对象键比较；不覆盖空数组'
  };
  const crit = { ...core, frozenHash: sha256(Buffer.from(JSON.stringify(core), 'utf8')), teeth: { at: '2026-11-19', tier: 'A', result: 'killed' } };
  made.set('criterion/unique-by.c01.json', JSON.stringify(crit, null, 2) + '\n');

  const start = {
    contract: 'unique-by', criterion: 'unique-by-c01', command: core.command,
    materialFingerprint: 'sha256:' + sha256(Buffer.from('fixture-materials-v1', 'utf8')),
    startedAt: '2026-11-19T07:40:00+08:00', runnerVersion: 'skill-fixture/1'
  };
  const startStr = JSON.stringify(start, null, 2);
  const report = { exitCode: 0, stdout: '["a","b"]', durationMs: 12, timedOut: false, startSha256: sha256(Buffer.from(startStr, 'utf8')) };
  const reportStr = JSON.stringify(report, null, 2);
  const end = { result: 'pass', reportSha256: sha256(Buffer.from(reportStr, 'utf8')) };
  made.set('evidence/unique-by-c01/20261119T0740+0800/start.json', startStr);
  made.set('evidence/unique-by-c01/20261119T0740+0800/report.json', reportStr);
  made.set('evidence/unique-by-c01/20261119T0740+0800/end.json', JSON.stringify(end, null, 2));

  made.set('diff/unique-by.diff', [
    'diff --git a/src/uniqueBy.mjs b/src/uniqueBy.mjs',
    'index 4b825dc..9daeafb 100644',
    '--- a/src/uniqueBy.mjs',
    '+++ b/src/uniqueBy.mjs',
    '@@ -1,4 +1,5 @@',
    ' function uniqueBy(arr, keyFn) {',
    '-  return arr.filter(() => true);',
    '+  const seen = new Set();',
    '+  return arr.filter((x) => !seen.has(keyFn(x)) && seen.add(keyFn(x)));',
    ' }',
    ''
  ].join('\n'));
  made.set('diff/versions.txt', 'base 4b825dc619e801bb06cffe3caf835d2f5d1e9cbb\nhead 9daeafb366e6f5b1a7a72e0d1a52baa6f38be482\n');

  if (variant !== 'missing') {
    made.set('contract-scope-why.md', [
      '# 契约 unique-by 的 scope 与 why',
      '',
      '## scope',
      '只管 uniqueBy(arr, keyFn) 的按键去重行为。',
      '',
      '## why',
      '两次提交同键时第二条不该入库；这条判据先于实现冻结、由业主签字。',
      ''
    ].join('\n'));
  }
  made.set('完成声称.md', [
    '# 完成声称（原文）',
    '',
    '本轮做完了：unique-by 的 c01 判据跑绿、改坏后红过（killed），证据三件套已齐。',
    ''
  ].join('\n'));
  if (variant === 'sixth') {
    made.set('LEDGER.md', [
      '本轮 3 项：通过 3、未通过 0、未验证 0、过期 0、无法判断 0、不稳定 0',
      '（写方自己算的总账，属第六类，不许进复核包）',
      ''
    ].join('\n'));
  }
  if (variant === 'foreign') {
    made.set('对照.md', '对照 contracts/metrics-rollup/contract.json 的边界看，本包只含 unique-by 一份契约。\n');
  }

  for (const [r, content] of made) {
    const p = join(packRoot, r);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  // MANIFEST：逐行「哈希 + 相对路径」，只列其余文件、不列它自己（卡出口 2）
  writeFileSync(join(packRoot, 'MANIFEST.txt'),
    [...made.keys()].map((r) => sha256(Buffer.from(made.get(r), 'utf8')) + '  ' + r).join('\n') + '\n');

  // 定向破坏（都在 MANIFEST 写完之后）
  if (variant === 'tamper') {
    const p = join(packRoot, '完成声称.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '。');
  }
  if (variant === 'ghost') {
    const p = join(packRoot, 'MANIFEST.txt');
    writeFileSync(p, readFileSync(p, 'utf8') + sha256(Buffer.from('ghost', 'utf8')) + '  evidence/unique-by-c01/extra.json\n');
  }
  return packRoot;
}

const cases = [
  { name: 'good', red: [], note: '好样本全绿（五类齐 + 清单闭合 + 无第六类 + 无越界）' },
  { name: 'words', red: [], note: '负对照全绿：判据 scope 里的「排课计划」被豁免，没误拦' },
  { name: 'sixth', red: ['无第六类'], note: '塞第六类必红：LEDGER.md 名字与「总账」正文双命中，其余行不红' },
  { name: 'missing', red: ['④scope与why'], note: '少一类必红：抽掉 scope 与 why，其余行不红' },
  { name: 'tamper', red: ['清单闭合'], note: '改一字必红：完成声称.md 加一字后哈希对不上，其余行不红' },
  { name: 'ghost', red: ['清单闭合'], note: '幽灵条目必红：MANIFEST 列了不存在的文件，其余行不红' },
  { name: 'foreign', red: ['无越界材料'], note: '越界必红：对照.md 提到 contracts/metrics-rollup，其余行不红' }
];

// `fails` / `bad` / `ok` 必须在 `--pack` 分支**之前**声明：`auditPack` 里会用 `bad`，
// 而 `--pack` 分支在本文件里先于它们执行。旧版把它们放在分支之后，`unreadable` 非空时
// 就是 const 的 TDZ 崩溃（抛 ReferenceError、退出码 1），不是判 3。
let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const args = process.argv.slice(2);

if (args[0] === '--pack') {
  const dir = args[1];
  let okDir = false;
  try { okDir = !!dir && statSync(dir).isDirectory(); } catch { okDir = false; }
  if (!okDir) { console.error('用法：node skill/check-reviewpack.mjs --pack <复核包目录>（目录读不出来退 3）'); process.exit(3); }
  const r = auditPack(resolve(dir));
  console.log('复核包：' + dir + '（契约 id 以目录名为准：' + r.own + '）');
  for (const k of 行序) console.log('  ' + (r.rows[k] ? '✓' : '✗') + ' ' + k + (r.rows[k] ? '' : '——' + r.fails.find((f) => f.startsWith(k))));
  if (r.读不出.length) {
    console.log('\n读不出来 ' + r.读不出.length + ' 个文件（无法判断，不是通过）：' + r.读不出.join('、'));
    console.log('RESULT: 无法判断 材料有文件读不出来——按 §八 记「无法判断」，不许当成通过');
    process.exit(3);
  }
  if (r.fails.length === 0) { console.log('RESULT: PASS 八行全过'); process.exit(0); }
  console.log('RESULT: FAIL ' + r.fails.length + ' 行红');
  process.exit(1);
}

console.log('一、卡口径（判方材料包.md × INV-14 五类白名单）');
const cardPath = join(ROOT, 'donegate', 'references', '判方材料包.md');
if (!existsSync(cardPath)) {
  bad('卡不存在：donegate/references/判方材料包.md');
} else {
  const ct = readFileSync(cardPath, 'utf8');
  // 五类名 + 白名单两条 + INV-14 出处；卡被改写口径时这里必须红，改口径的人来更新锚点
  const 锚点 = ['INV-14', '白名单不是黑名单', '少一类即红', '多出第六类也红', '判据原文', '运行输出与退出码', '契约的 `scope` 与 `why`', '完成声称的原文', 'MANIFEST'];
  const miss = 锚点.filter((t) => !ct.includes(t));
  if (miss.length) bad('卡缺口径锚点：' + miss.join('、'));
  else ok('九个口径锚点都在（五类名 + 白名单两条 + INV-14）');
}

console.log('\n二、夹具自检（内存构造 7 份包，落临时目录跑真审计）');
const tmp = mkdtempSync(join(tmpdir(), 'rp-'));
try {
  for (const c of cases) {
    const r = auditPack(buildPack(join(tmp, c.name), c.name));
    if (r.读不出.length) bad(c.name + ' 夹具里有文件读不出来（夹具自己是坏的时候，不许把读数当结论）：' + r.读不出.join('、'));
    const actual = 行序.filter((k) => !r.rows[k]);
    const missRed = c.red.filter((x) => !actual.includes(x));
    const extraRed = actual.filter((x) => !c.red.includes(x));
    if (missRed.length === 0 && extraRed.length === 0) ok(c.note);
    if (missRed.length) bad(c.name + ' 该红不红（判据没牙了）：' + missRed.join('、'));
    if (extraRed.length) bad(c.name + ' 不该红却红（误拦）：' + extraRed.join('、'));
  }
  const uDir = join(tmp, 'unreadable-pack', 'c01');
  mkdirSync(join(uDir, 'contract.json'), { recursive: true });
  const uRes = spawnSync(process.execPath, [join(HERE, 'check-reviewpack.mjs'), '--pack', uDir], { encoding: 'utf8' });
  if (uRes.status === 3) ok('不可读文件（目录冒充 contract.json）--pack 必退 3');
  else bad('不可读文件 --pack 期望退 3，实得 ' + uRes.status);

  // 业务域名含 ledger（ledger-core / src/ledger.js）不得被误报为第六类，而塞入 计划.md 必须红
  const legPack = buildPack(join(tmp, 'ledger-domain'), 'good');
  const legRoot = join(tmp, 'ledger-domain', 'ledger-core');
  rmSync(legRoot, { recursive: true, force: true });
  mkdirSync(join(legRoot, 'criterion'), { recursive: true });
  mkdirSync(join(legRoot, 'diff'), { recursive: true });
  mkdirSync(join(legRoot, 'evidence/o1/t1'), { recursive: true });
  const legFiles = new Map([
    ['criterion/ledger-core.json', readFileSync(join(legPack, 'criterion/unique-by.c01.json'), 'utf8').replace(/unique-by/g, 'ledger-core')],
    ['contract-scope-why.md', '# 契约 ledger-core 的 scope 与 why\n\n## scope\n["src/ledger.js"]\n\n## why\n双分录借贷必须平衡。\n'],
    ['完成声称.md', '# 完成声称（原文）\n\n本轮完成：契约 ledger-core 判据全过。\n'],
    ['diff/ledger-core.diff', 'diff --git a/src/ledger.js b/src/ledger.js\n--- a/src/ledger.js\n+++ b/src/ledger.js\n@@ -1 +1 @@\n+export const post = () => 0;\n'],
    ['diff/versions.txt', 'base ' + 'a'.repeat(40) + '\nhead ' + 'b'.repeat(40) + '\n'],
    ['evidence/o1/t1/start.json', '{"contract":"ledger-core","command":"node scripts/ledger-core.test.mjs"}'],
    ['evidence/o1/t1/report.json', '{"exitCode":0,"stdout":"LEDGER_OK"}'],
    ['evidence/o1/t1/end.json', '{"result":"pass"}']
  ]);
  for (const [k, v] of legFiles) writeFileSync(join(legRoot, k), v);
  writeFileSync(join(legRoot, 'MANIFEST.txt'), [...legFiles.keys()].map((k) => sha256(Buffer.from(legFiles.get(k), 'utf8')) + '  ' + k).join('\n') + '\n');
  const legRes = auditPack(legRoot);
  if (legRes.fails.length === 0) ok('业务域名 ledger-core / src/ledger.js 不再误报第六类');
  else bad('业务域名 ledger-core 仍被误报：' + legRes.fails.join('；'));
  writeFileSync(join(legRoot, 'notes.md'), '记录开发思路与后续计划。\n');
  writeFileSync(join(legRoot, 'MANIFEST.txt'), [...legFiles.keys(), 'notes.md'].map((k) => sha256(readFileSync(join(legRoot, k))) + '  ' + k).join('\n') + '\n');
  const legRogue = auditPack(legRoot);
  if (!legRogue.rows['无第六类']) ok('合法业务包中塞入叙述文档 notes.md（含思路/计划）依然必红');
  else bad('合法业务包中塞入叙述文档 notes.md 漏报第六类');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (fails === 0) { console.log('RESULT: PASS 判方材料包口径 + 7 份夹具判读全部符合预期'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);

function checkSixthCategory(own, rels, bodies) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownParts = [own, ...own.split('-').filter((t) => t.length >= 4)].map(esc);
  const domainRe = new RegExp(`(?:src|scripts|tests|contracts|lib|bin)/[\\w./-]+|\\b(?:${ownParts.join('|')})\\b`, 'gi');
  const isStructuralCarrier = (r) =>
    /^(criterion|diff)\//i.test(r) ||
    /^evidence\/.*\/(start|report|end)\.json$/i.test(r) ||
    /^(contract-scope-why\.md|完成声称\.md|MANIFEST\.txt)$/i.test(r);
  const hitNames = rels.filter((r) => {
    if (isStructuralCarrier(r)) {
      return !/^(criterion|diff|evidence)\//i.test(r) && 第六类名.test(r.replace(domainRe, ''));
    }
    return 第六类名.test(basename(r)) || 第六类名.test(r.replace(domainRe, ''));
  });
  const hitBodies = rels.filter((r, i) => {
    if (bodies[i] === null) return false;
    if (判据原文形状(bodies[i])) return false;
    if (/^(diff\/|evidence\/.*\/(start|report|end)\.json$|MANIFEST\.txt$)/i.test(r)) return false;
    const cleaned = /^(contract-scope-why\.md|完成声称\.md)$/i.test(r) ? bodies[i].replace(domainRe, '') : bodies[i];
    if (/^contract-scope-why\.md$/i.test(r) && /^#\s*契约\s+/.test(cleaned)) {
      return /(缺口清单|思路|草稿|对话|本轮\s*\d+\s*项|写方[^\n]*总账|总账\s*[：:]\s*\d+)/i.test(cleaned);
    }
    return 第六类词.test(cleaned);
  });
  if (hitNames.length === 0 && hitBodies.length === 0) return { ok: true, why: '' };
  const w = [];
  if (hitNames.length) w.push('名字：' + hitNames.join(','));
  if (hitBodies.length) w.push('正文：' + hitBodies.join(','));
  return { ok: false, why: w.join('；') };
}

function collectDirAsFiles(dir) {
  const out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (/\.(json|md|txt|diff|patch|log)$/i.test(e.name)) out.push(p);
        else out.push(...collectDirAsFiles(p));
      }
    }
  } catch { /* unreadable dir handled by walk */ }
  return out;
}
