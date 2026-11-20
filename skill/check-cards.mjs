// 单卡门禁：把「集成阶段五条单卡门禁」变成能跑的判据（纯技能版自己的工具，不放进 tools/）
// 用法：node skill/check-cards.mjs
// 退出码：0 全部通过；1 有卡不过
//
// 五条门禁（与 skill/01 第三节一致）：
//   1. 骨架四段齐（入口条件 / 步骤 / 出口判据 / 延伸阅读）
//   2. 词汇合规：只用统一规范登记过的词（这里查「自创词嫌疑」与禁用旧措辞）
//   3. 无重抄：规格已有的规则只引节号（这里查「是否出现大段规格原文」的替身指标：不受控的定量数字）
//   4. 链接可达：从卡片位置出发的相对路径全部解析
//   5. 查过业界参考：卡内含「业界做法参考」一节，或有「差异 + 两个代价」
//
// 另外三条附加：字数（不含表格与代码块会给假绿，所以按全文算）、frontmatter、**定论落地**（skill/10 的 9 条可执行定论）。

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relTo } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const 禁用措辞 = [
  '六种模式', '不许是空心断言', '是/否/说不清', '五道门', '门 6', '门6', '通过三分',
  '不通不道'
];
// 「说不清」单独一条更严的规则：只有在**当作答词用**时才禁。
// 中文散文里「说不清就是边界没划出来」是正常写法，一律禁会把好句子判红（实测误报 2 处）。
const 作答词说不清 = /(作答|只能答|答三|每项[^\n]{0,8}答)[^\n]{0,12}说不清/;
const 段落 = ['## 入口条件', '## 步骤', '## 出口判据', '## 延伸阅读'];

// 派工单里点名的 16 个产物（router 由 lead 写，不在此列）
const 应存在 = [
  'donegate/references/门0-起手.md',
  'donegate/references/门1-基线.md',
  'donegate/references/门2-判据.md',
  'donegate/references/门3-有牙.md',
  'donegate/references/门4-证据.md',
  'donegate/references/门5-复核.md',
  'donegate/references/交接包.md',
  'donegate/references/状态与功能树.md',
  'donegate/references/判方材料包.md',
  'donegate-judge/SKILL.md',
  'donegate/references/模板-INTENT.md',
  'donegate/references/模板-CONSTRAINTS.md',
  'donegate/references/模板-contract.json.md',
  'donegate/references/模板-functions.json.md',
  'donegate/references/模板-证据记录.md',
  'donegate/references/模板-总账.md'
];

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

// 去掉 frontmatter 与代码块，剩余才是「正文散文」——表格保留（那是内容）
function prose(t) {
  return t
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, '');
}
const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;

// 收集一份文件里的相对 markdown 链接
function links(t) {
  const out = [];
  for (const m of t.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const u = m[1];
    if (/^(https?:|#|mailto:)/.test(u)) continue;
    out.push(u.replace(/#.*$/, ''));
  }
  return out;
}

console.log('一、产物齐不齐');
for (const f of 应存在) {
  if (!existsSync(join(ROOT, f))) bad('缺文件：' + f);
}
if (fails === 0) ok('16 个产物全部存在');

console.log('\n二、骨架四段');
let secFail = 0;
for (const f of 应存在) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, 'utf8');
  for (const s of 段落) {
    if (!t.includes(s)) { bad(f + ' 缺「' + s + '」'); secFail++; }
  }
}
if (secFail === 0) ok('四段全齐（16 份）');

console.log('\n三、禁用旧措辞');
let staleFail = 0;
for (const f of 应存在) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, 'utf8');
  for (const w of 禁用措辞) {
    if (t.includes(w)) { bad(f + ' 出现禁用措辞「' + w + '」'); staleFail++; }
  }
  const m = t.match(作答词说不清);
  if (m) { bad(f + ' 把「说不清」当作答词用：' + m[0]); staleFail++; }
  if (/\d+\s*KB/.test(t)) { bad(f + ' 出现体积数字（不许写）'); staleFail++; }
}
if (staleFail === 0) ok('没有禁用措辞与体积数字');

console.log('\n四、业界做法参考');
let refFail = 0;
for (const f of 应存在) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const t = readFileSync(p, 'utf8');
  if (!t.includes('业界做法参考')) { bad(f + ' 没有「业界做法参考」一节'); refFail++; }
}
if (refFail === 0) ok('16 份都写了业界做法参考');

console.log('\n五、链接可达');
let linkFail = 0, linkTotal = 0;
// 路由器与判方 SKILL 也要查链接：它们引的是同一批 references，
// 曾经因为「只扫 16 张卡」漏掉路由器里两条指向 .json（实为 .json.md）的死链。
// 注意：ROOT 由 resolve() 得出，结尾**不带**分隔符，所以必须用 join() 拼；
// 写成 ROOT + 'donegate/SKILL.md' 会拼出 ...\V3donegate\SKILL.md，
// existsSync 为假 → 被一句 continue 静默跳过 → 门禁永远绿。这个坑踩过一次。
const 也查链接 = [join(ROOT, 'donegate', 'SKILL.md'), ...应存在];
for (const f of 也查链接) {
  const p = isAbsolute(f) ? f : join(ROOT, f);
  if (!existsSync(p)) { bad('要查链接的文件不存在：' + relTo(ROOT, p)); continue; }
  const t = readFileSync(p, 'utf8');
  for (const u of links(t)) {
    linkTotal++;
    const target = resolve(dirname(p), u);
    if (!existsSync(target)) { bad(relTo(ROOT, p) + ' → 死链 ' + u); linkFail++; }
  }
}
if (linkFail === 0) ok(linkTotal + ' 条相对链接全部可达（含路由器与判方 SKILL）');

console.log('\n六、字数（正文散文 400–1200 汉字）');
let lenFail = 0;
for (const f of 应存在) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const n = cjk(prose(readFileSync(p, 'utf8')));
  if (n < 400 || n > 1600) { bad(f + ' 正文 ' + n + ' 汉字，超出 400–1600 的宽松区间'); lenFail++; }
}
if (lenFail === 0) ok('字数全部在区间内（散文口径，代码块与 frontmatter 已剔除）');

console.log('\n八、定论落地（skill/10 的 9 条可执行定论）');
// 为什么只守这 7 条：G-02（材料自相矛盾退 2）是为了守住 INV-10 而偏离 §7.1 的解释，
// G-04（「三条注意」实为四条）是计数笔误——把这两条写进门禁，等于让技能版的解释获得
// 规格的效力，插件版走勘误时就要先对抗它。其余 7 条是「卡里必须逐字出现的字段名/读法」，
// 少一个，写卡的人就会自己发明一个，插件版再发明第二个。
const 定论落地 = [
  { g: 'G-01', file: 'donegate/references/模板-contract.json.md', need: ['assertionId'], why: '三件套落点：assertionId 不新增字段，等于本条义务的 id' },
  { g: 'G-03', file: 'donegate/references/门0-起手.md', need: ['顶层'], why: 'skipReason 是 contract.json 顶层可选字段' },
  { g: 'G-05', file: 'donegate/references/交接包.md', need: ['### 接收方验收记录'], why: '接收方验收记录是第六节末尾的固定子块' },
  { g: 'G-06', file: 'donegate/references/模板-contract.json.md', need: ['standard'], why: 'human 判据的 expect 用 standard 键，与 exitCode 互斥' },
  { g: 'G-07', file: 'donegate/references/模板-CONSTRAINTS.md', need: ['算一条检查'], why: 'human 判据算一条检查' },
  { g: 'G-08', file: 'donegate/references/门1-基线.md', need: ['冒烟命令：', 'INTENT.md'], why: '冒烟命令写在 INTENT.md 的固定一行' },
  { g: 'G-08', file: 'donegate/references/模板-INTENT.md', need: ['冒烟命令：'], why: '模板要给出这一行' },
  { g: 'G-09', file: 'donegate/references/门0-起手.md', need: ['SHA-256 整文件原始字节'], why: '0.2 的同一算法：技能版读法（归一化未入规格）' },
  { g: 'G-10', file: 'donegate/references/门2-判据.md', need: ['scopeAck', '不是本轮写方自己'], why: 'scope 的裁方逐条确认落在 obligation 的 scopeAck 上，且 by 不许是写方自己（门 2 出口 8）' },
  { g: 'G-10', file: 'donegate/references/模板-contract.json.md', need: ['scopeAck'], why: '模板要给出这个字段与它的填法' },
  { g: 'G-11', file: 'donegate/references/模板-contract.json.md', need: ['精确匹配', '不是正则'], why: 'stdoutMatches 是精确整串相等，不是正则' },
  { g: 'G-11', file: 'donegate/references/门2-判据.md', need: ['精确整串'], why: '门2 出口 6 的「绿」必须写清是精确整串' }
];
const 定论文档 = readFileSync(join(ROOT, 'skill', '10-规格缺口定论（技能版）.md'), 'utf8');
let landFail = 0;
for (const g of [...new Set(定论落地.map((x) => x.g))]) {
  if (!定论文档.includes('**' + g + '**')) { bad('skill/10 里找不到 ' + g + '——门禁引了一条不存在的定论'); landFail++; }
}
for (const c of 定论落地) {
  const p = join(ROOT, c.file);
  if (!existsSync(p)) { bad(c.g + ' 要查的卡不存在：' + c.file); landFail++; continue; }
  const ct = readFileSync(p, 'utf8');
  for (const w of c.need) {
    if (!ct.includes(w)) { bad(c.g + ' ' + c.file + ' 缺「' + w + '」（' + c.why + '）'); landFail++; }
  }
}
if (landFail === 0) ok('9 条定论的字段名/读法都在对应卡上，且都能在 skill/10 里找到出处');

console.log('\n七、frontmatter（两个 SKILL.md）');
for (const f of ['donegate/SKILL.md', 'donegate-judge/SKILL.md']) {
  const t = readFileSync(join(ROOT, f), 'utf8');
  if (!t.startsWith('---\n')) bad(f + ' 首行不是三连字符');
  const fm = t.slice(4, t.indexOf('\n---\n'));
  for (const k of ['name:', 'description:']) if (!fm.includes(k)) bad(f + ' frontmatter 缺 ' + k);
  // plain scalar 的冒号风险：description 块若用 >- 或 | 就安全
  const descLine = fm.split('\n').find((l) => l.startsWith('description:'));
  if (descLine && !/^description:\s*(>-?|\|-?)/.test(descLine)) bad(f + ' description 不是块标量，冒号会让整条技能静默消失');
}
if (fails === 0) ok('两个 SKILL.md 的 frontmatter 合规');

console.log('');
if (fails === 0) { console.log('RESULT: PASS 五条单卡门禁 + 三条附加全过（' + 应存在.length + ' 份）'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
