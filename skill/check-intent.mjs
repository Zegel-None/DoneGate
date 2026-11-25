// 意图四节持续检查（判方线收尾一）：门 0.1 的 INTENT 四节 + CONSTRAINTS 条目行 + 冒烟行。
// 用法：
//   node skill/check-intent.mjs                  默认：卡口径守卫 + 夹具自检（常跑，约 1 秒）
//   node skill/check-intent.mjs --root <项目根>   审真实项目的 INTENT.md / CONSTRAINTS.md
// 退出码（四值规范）：0 通过；1 判定为否；3 参数或目录读不出。
//
// 守什么：
//   门 0.1：INTENT 二级标题与四节标准模板逐字相同、无空节、只四节；
//   CONSTRAINTS 条目行必须直接以「不许/必须」开头——**列表序号不算行首**（如 `1. 必须` 按字面判未通过，
//   本判据按字面口径严格固化）；
//   INTENT 末尾固定一行 冒烟命令：<单条命令>（G-08）。
// 诚实边界：四节「内容质量」（比较对象、可观察性）判不了——那是模板-INTENT 出口 3/5 的人检；
//   本判据只守结构与字面，与门 0.1 的机器可判部分一致。

import { writeFileSync, statSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readMaybe } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const 四节 = ['## 为什么做', '## 服务谁', '## 什么算成功', '## 明确不做什么'];

function cinSectionHasBody(lines, startIdx) {
  for (let j = startIdx; j < lines.length && !/^##\s/.test(lines[j]); j++) {
    if (lines[j].trim() !== '') return true;
  }
  return false;
}

function cinFindEmptySection(intent) {
  const lines = intent.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].trim();
    if (!四节.includes(title)) continue;
    if (!cinSectionHasBody(lines, i + 1)) return title;
  }
  return '';
}

function cinAuditIntentDoc(intent, rows, why) {
  if (!intent) {
    rows['①INTENT 在场'] = false;
    why['①INTENT 在场'] = '没有 INTENT.md';
    return;
  }
  rows['①INTENT 在场'] = true;
  const headings = intent.split(/\r?\n/).filter((l) => /^##\s/.test(l)).map((l) => l.trim());
  const sameOrder = headings.length === 4 && 四节.every((h, i) => headings[i] === h);
  if (!sameOrder) {
    rows['②四节逐字'] = false;
    why['②四节逐字'] = '二级标题为 ' + JSON.stringify(headings) + '，不是骨架那四个（少/多/改名/换序均算）';
  } else {
    rows['②四节逐字'] = true;
    // 空节：某节标题与下一标题之间除空行外无实字
    const emptyHit = cinFindEmptySection(intent);
    if (emptyHit) {
      rows['③无空节'] = false;
      why['③无空节'] = '「' + emptyHit + '」整节无实字';
    } else {
      rows['③无空节'] = true;
    }
  }
  // 冒烟行（G-08）：非标题、存在且非空
  if (/^冒烟命令：\s*\S/m.test(intent)) {
    rows['④冒烟行'] = true;
  } else {
    rows['④冒烟行'] = false;
    why['④冒烟行'] = '没有「冒烟命令：<单条命令>」固定行（或在标题里，不算）';
  }
}

function cinAuditConstraintsDoc(cons, rows, why) {
  if (!cons) {
    rows['⑤约束条目'] = false;
    why['⑤约束条目'] = '没有 CONSTRAINTS.md';
    return;
  }
  // 条目行 = 非标题、非空、非说明行；严格字面：行首必须是不许/必须
  const lines = cons.split(/\r?\n/).filter((l) => l.trim() !== '' && !/^#/.test(l));
  const entries = lines.filter((l) => !/^(说明|注)[:：]/.test(l.trim()));
  const invalid = entries.filter((l) => !/^(不许|必须)/.test(l.trim()));
  if (entries.length === 0) {
    rows['⑤约束条目'] = false;
    why['⑤约束条目'] = '一条有效条目都没有（全为标题/空行/说明行）';
  } else if (invalid.length > 0) {
    rows['⑤约束条目'] = false;
    why['⑤约束条目'] = '行首不是「不许/必须」的条目 ' + invalid.length + ' 条，如「' + invalid[0].trim().slice(0, 24) + '」——列表序号不算行首';
  } else {
    rows['⑤约束条目'] = true;
  }
}

// 审一个项目根的 INTENT / CONSTRAINTS（门 0.1 的机器可判部分）
function auditIntent(projectRoot) {
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  const cons = readMaybe(join(projectRoot, 'CONSTRAINTS.md'));
  const rows = {};
  const why = {};
  cinAuditIntentDoc(intent, rows, why);
  cinAuditConstraintsDoc(cons, rows, why);
  const order = ['①INTENT 在场', '②四节逐字', '③无空节', '④冒烟行', '⑤约束条目'];
  const fails = order.filter((k) => rows[k] === false).map((k) => k + '：' + why[k]);
  return { rows, why, fails, order };
}

// —— 夹具：五个变体覆盖「好样本 + W16 每一种翻车形态」——
const bodyGood = [
  '# 意图', '', '## 为什么做', '工具集要能机器判完成，不靠回忆。', '',
  '## 服务谁', '只服务作者本人。', '',
  '## 什么算成功', '- 去重：同键只留第一个。', '',
  '## 明确不做什么', '不做数据库分页。', '',
  '冒烟命令：node scripts/smoke.mjs', ''
].join('\n');
const consGood = '# 约束\n\n必须用 node 子进程直读退出码。\n不许把流程说成验收。\n';
const consNumbered = '# 约束\n\n1. 必须用 node 子进程直读退出码。\n2. 不许把流程说成验收。\n';
const bodyEmptySec = bodyGood.replace('## 什么算成功\n- 去重：同键只留第一个。', '## 什么算成功\n');
const bodyFive = bodyGood.replace('## 明确不做什么', '## 附加说明\n多余的一节\n\n## 明确不做什么');
const consOnlyNotes = '# 约束\n\n说明：本文件放约束。\n';

const cases = [
  { name: 'good', ok: true, intent: bodyGood, cons: consGood, note: '好样本：四节齐、裸行约束、冒烟行——全绿' },
  { name: 'numbered', ok: false, hit: '⑤约束条目', intent: bodyGood, cons: consNumbered, note: 'W16 形态：`1. 必须` 按字面判未通过（序号不算行首）' },
  { name: 'emptysec', ok: false, hit: '③无空节', intent: bodyEmptySec, cons: consGood, note: '空节必红' },
  { name: 'fivesec', ok: false, hit: '②四节逐字', intent: bodyFive, cons: consGood, note: '多出第五节必红' },
  { name: 'notesonly', ok: false, hit: '⑤约束条目', intent: bodyGood, cons: consOnlyNotes, note: '只有说明行＝一条有效条目都没有' }
];

const args = process.argv.slice(2);
if (args[0] === '--root') {
  const dir = args[1];
  let okDir = false;
  try { okDir = !!dir && statSync(dir).isDirectory(); } catch { okDir = false; }
  if (!okDir) { console.error('用法：node skill/check-intent.mjs --root <项目根>（读不出来退 3）'); process.exit(3); }
  const r = auditIntent(resolve(dir));
  for (const k of r.order) {
    if (r.rows[k] === true) console.log('  ✓ ' + k);
    else if (r.rows[k] === false) console.log('  ✗ ' + k + '——' + r.why[k]);
    else console.log('  · ' + k + ' 未判（前序未过，按停止语义）');
  }
  if (r.fails.length === 0) { console.log('RESULT: PASS 五行全过'); process.exit(0); }
  console.log('RESULT: FAIL ' + r.fails.length + ' 行红'); process.exit(1);
}

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('一、卡口径（模板-INTENT × 门0 的 0.1）');
const anchors = [
  { file: 'donegate/references/模板-INTENT.md', need: ['## 为什么做', '## 服务谁', '## 什么算成功', '## 明确不做什么', '冒烟命令：', '正好四个且与骨架逐字相同'] },
  { file: 'donegate/references/门0-起手.md', need: ['不以「不许」「必须」开头的行，记「未通过」', '一条有效条目都没有也记「未通过」'] }
];
for (const a of anchors) {
  const t = readMaybe(join(ROOT, ...a.file.split('/')));
  if (!t) { bad('要守的卡不存在：' + a.file); continue; }
  const miss = a.need.filter((w) => !t.includes(w));
  if (miss.length) bad(a.file + ' 缺口径锚点：' + miss.join('、'));
  else ok(a.file + '：' + a.need.length + ' 个锚点都在');
}

console.log('\n二、夹具自检（内存构造 5 份项目，落临时目录跑真审计）');
const tmp = mkdtempSync(join(tmpdir(), 'intent-'));
try {
  for (const c of cases) {
    const d = join(tmp, c.name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'INTENT.md'), c.intent);
    writeFileSync(join(d, 'CONSTRAINTS.md'), c.cons);
    const r = auditIntent(d);
    // 只有显式 false 算红；undefined 是「前序未过、本条未判」，不算（停止语义）
    const reds = r.order.filter((k) => r.rows[k] === false);
    if (c.ok) {
      if (reds.length === 0) ok(c.note);
      else bad(c.name + ' 不该红却红：' + reds.map((k) => k + '——' + r.why[k]).join('；'));
    } else {
      if (reds.includes(c.hit) && reds.length === 1) ok(c.note);
      else if (!reds.includes(c.hit)) bad(c.name + ' 该红不红：' + c.hit + '（实际红：' + reds.join('、') + '）');
      else bad(c.name + ' 红得不止一处：' + reds.map((k) => k + '——' + r.why[k]).join('；'));
    }
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log('');
if (fails === 0) { console.log('RESULT: PASS 意图口径 + 5 份夹具判读全部符合预期'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
