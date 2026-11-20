// 文档腐化自查：核对「文档里声称的当前状态」与「实际值」
// 用法：node tools/check-rot.mjs
// 退出码：0 全部一致；1 有不一致；2 检查器自身不合格（豁免被滥用）
//
// 四条排除规则（都不是腐化）：
//   1. 归档/ 与 证据/ 下的文件记录的是**当时的事实**，不用当前值核对
//   2. adr/ 下的 ADR 正文记录的是**做决定时的事实**，同上
//   3. 规则里的举例（「不要写『13 条 ADR』」）不是声称
//   4. 登记腐化的文件必须引用错误值 —— 见下面的「引用 vs 声称」
//
// ── 引用 vs 声称（ER-0）──────────────────────────────────────────────────
// 一份专门登记缺陷的文件必然引用错误值，而检查器分不清「引用」和「声称」。
// 所以给两种显式声明，**只有显式声明才豁免，不做语义猜测**：
//   a. 文件级：文件头 20 行内出现 <!-- rot-check: 登记表 -->
//      约束：只允许 1 个文件、只允许在 skill/ 下。多一个就退出码 2。
//   b. 行级：匹配处所在行含「（原文如此）」。单文件超过 20 行豁免也算滥用。
// 豁免数量每次都必须打印 —— 静默豁免等于没有检查。
// 设计包（设计/ 与 参考/）不许使用这两种标记：它声称的是当前状态。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.dsh') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) files.push(p);
  }
})(ROOT);

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ── 排除：历史记录 ──
function isHistorical(path) {
  const r = rel(path);
  // 归档说明.md 描述的是**现状**（目录怎么分），不是历史记录，所以不豁免
  if (r === '归档/归档说明.md') return false;
  return r.startsWith('归档/') || r.startsWith('证据/') || r.startsWith('设计/adr/');
}

// ── 排除：规则里的举例 ──
function isExample(text, index, matched) {
  const before = text.slice(Math.max(0, index - 40), index);
  return /不写|不要写|例如|比如|像是/.test(before);
}

let failures = 0;
let misuse = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failures++; console.log('  ✗ ' + m); };
const abuse = (m) => { misuse++; console.log('  ✗ ' + m); };

const specPath = join(ROOT, '设计', '02-规格.md');
const spec = read(specPath);
const diagram = read(join(ROOT, '设计', '01-图.md'));
const classPath = join(ROOT, 'tools', 'classification.json');
const classification = JSON.parse(read(classPath));

// ── 实际值（每一项都必须有检查项消费，否则不许印出来）──
const specSec8 = spec.slice(spec.indexOf('## 八、命令'), spec.indexOf('## 九、七阶段'));
const ACTUAL = {
  不变量: (spec.match(/\*\*INV-\d\d\*\*/g) || []).length,
  ADR: readdirSync(join(ROOT, '设计', 'adr')).filter((f) => f.endsWith('.md')).length,
  主文件: readdirSync(join(ROOT, '设计')).filter((f) => f.endsWith('.md')).length,
  图: (diagram.match(/^## 图[一二三四五六七八九十]/gm) || []).length,
  命令: (specSec8.match(/^\| `(init|contract new|contract freeze|check|teeth|status|graph|gaps|handover|verify pack|verify apply|retire)` \|/gm) || []).length,
  通过子数: classification.rows.length,
  大门数: new Set([...diagram.matchAll(/门\s?([0-9])(?![0-9])/g)].map((m) => m[1])).size,
  规格节数: (spec.match(/^## [一二三四五六七八九十]+、/gm) || []).length,
  规格KB: Math.round(statSync(specPath).size / 1024)
};


// ── 门 2 条数：实际值从 §15.1 的表里数出来，不写死 ──
const specSec151 = spec.slice(spec.indexOf('### 15.1 '), spec.indexOf('### 15.2 '));
ACTUAL.门2条数 = [...specSec151.matchAll(/^\| \*\*(2\.\d+)\*\* \|/gm)].length;
const specSec155 = spec.slice(spec.indexOf('### 15.5 '), spec.indexOf('### 15.6 '));
const SEG_ROWS = [...specSec155.matchAll(/^\| \*\*(T1[abc]|T1 完整)\*\* \|.*$/gm)].map((m) => m[0]);

// 段表自洽：分子必须等于「该段累计生效条数」，分母必须等于 §15.1 的行数。
function segCheck(rows, total) {
  const bads = [];
  const cum = new Set();
  for (const row of rows) {
    const cells = row.split('|').map((s) => s.trim());
    const seg = cells[1], eff = cells[4] || '', tag = cells[5] || '';
    for (const id of eff.match(/2\.\d+/g) || []) cum.add(id);
    const m = tag.match(/·\s*(\d+)\s*\/\s*(\d+)/);
    if (!m) { bads.push(seg + ' 的段标读不出分子/分母：' + tag); continue; }
    if (Number(m[2]) !== total) bads.push(seg + ' 分母写 ' + m[2] + '，实际 ' + total + ' 条');
    if (Number(m[1]) !== cum.size) bads.push(seg + ' 分子写 ' + m[1] + '，该段累计生效 ' + cum.size + ' 条');
  }
  if (cum.size !== total) bads.push('四段并集覆盖 ' + cum.size + ' 条，§15.1 有 ' + total + ' 条');
  return { bads, cumSize: cum.size };
}

// 「门 2 有 N 条」的声称只认紧邻写法；叙述句（从三条补到…）与量词「一条」不算。
const DOOR2_RE = /门\s*2[^\n]{0,10}?([一二三四五六七八九十]+)\s*条|门\s*2\s*判([一二三四五六七八九十]+)件事|判据段（\**([一二三四五六七八九十]+)\s*条/g;
function door2Claims(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const m of text.matchAll(DOOR2_RE)) {
    const lineNo = text.slice(0, m.index).split('\n').length;
    const line = lines[lineNo - 1] || '';
    if (line.includes('从三条')) continue;
    const raw = m[1] || m[2] || m[3];
    const n = CN[raw];
    if (!n || n === 1) continue;
    out.push({ lineNo, n, matched: m[0] });
  }
  return out;
}

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17 };

// ── ER-0 · 引用豁免的登记与校验 ──
const EXEMPT_MARK = '<!-- rot-check: 登记表 -->';
const QMARK = '（原文如此）';
const exemptFiles = new Set();
const exemptLinesPerFile = new Map();
const tagged = [];
for (const f of files) {
  if (isHistorical(f)) continue;
  const r = rel(f);
  const t = read(f);
  const isPackage = r.startsWith('设计/') || r.startsWith('参考/') || r.startsWith('归档/');

  // a. 文件级登记表标记
  const head = t.split(/\r?\n/).slice(0, 20).join('\n');
  if (head.includes(EXEMPT_MARK)) {
    tagged.push(r);
    if (!r.startsWith('skill/')) abuse('登记表标记只能出现在 skill/ 下，' + r + ' 越界');
    else exemptFiles.add(r);
  }

  // b. 行级引用标记
  const n = t.split(/\r?\n/).filter((l) => l.includes(QMARK)).length;
  if (n > 0) {
    if (isPackage) abuse('「' + QMARK + '」只能用于 skill/（设计包声称的是当前状态），' + r + ' 里出现了');
    else exemptLinesPerFile.set(r, n);
  }
}
if (tagged.length > 1) abuse('登记表标记只允许 1 个文件，实际 ' + tagged.length + ' 个：' + tagged.join('、'));
for (const [r, n] of exemptLinesPerFile) {
  if (n > 20) abuse('行级豁免超过 20 行（' + r + ' 有 ' + n + ' 行），疑似用标记洗白真错值');
}

// 围栏代码块内的内容一律不算声称（那是示例、命令输出、或引用块）。
// 这条与 §15.8 的 4.4a「围栏代码块内的数字豁免」是同一条原则。
function inFence(text, index) {
  const before = text.slice(0, index);
  const fences = (before.match(/^```/gm) || []).length;
  return fences % 2 === 1;
}

function isExemptLine(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  if (text.slice(start, end).includes(QMARK)) return true;
  return inFence(text, index);
}

console.log('实际值：' + JSON.stringify(ACTUAL));
console.log('（以下核对只覆盖「描述当前状态」的文件，跳过 归档/ 证据/ 设计/adr/）');
if (exemptFiles.size > 0) console.log('豁免文件：' + [...exemptFiles].join('、'));
const lineExemptTotal = [...exemptLinesPerFile.values()].reduce((a, b) => a + b, 0);
if (lineExemptTotal > 0) console.log('行级豁免：' + lineExemptTotal + ' 处（按引用跳过）');
console.log('');

const live = files.filter((f) => !isHistorical(f) && !exemptFiles.has(rel(f)));
// 「声称本包状态」的文件：设计包本体 + 根 README + skill/。
// 参考/ 是对外部世界的调研（67 条问题、225 个解法），里面的「四节」「一条命令」「五道门」
// 多数是在讲别人的东西；用中文数词启发式扫它，假阳性会盖掉真信号。
// 代价如实记：参考/22 里「五道门里有三道」这类本包的声称，本检查器**覆盖不到**。
const claims = live.filter((f) => !rel(f).startsWith('参考/'));

// 通用：逐文件逐行扫一条声称，命中即与 ACTUAL 比
function checkClaims(label, re, actual, unit, list) {
  console.log('');
  console.log(label);
  let hits = 0, bads = 0;
  for (const f of list || live) {
    const t = read(f);
    for (const m of t.matchAll(re)) {
      if (isExample(t, m.index, m[0])) continue;
      if (isExemptLine(t, m.index)) continue;
      const val = CN[m[1]] ?? Number(m[1]);
      hits++;
      if (val !== actual) { bads++; bad(rel(f) + ' 说「' + m[0] + '」，实际 ' + actual + ' ' + unit); }
    }
  }
  if (bads === 0) ok(hits === 0 ? '文档里没写这个数字（0 处），不可能腐化' : hits + ' 处声称都与 ' + actual + ' ' + unit + ' 一致');
}

// ── 检查 1 · 不变量 ──
console.log('检查 1 · 不变量条数');
let hits = 0, bads = 0;
for (const f of live) {
  const t = read(f);
  for (const m of t.matchAll(/(\d+)\s*条不变量|不变量\s*(\d+)\s*条/g)) {
    if (isExample(t, m.index, m[0])) continue;
    if (isExemptLine(t, m.index)) continue;
    const val = Number(m[1] ?? m[2]);
    hits++;
    if (val !== ACTUAL.不变量) { bads++; bad(rel(f) + ' 说「' + m[0] + '」，实际 ' + ACTUAL.不变量 + ' 条'); }
  }
  // ER-1：目录行把它写成「N 条，任何实现不许违反」，名词缺了 —— 按锚点认
  for (const m of t.matchAll(/^.*#一不变量.*$/gm)) {
    for (const n of m[0].matchAll(/(\d+)\s*条/g)) {
      hits++;
      if (Number(n[1]) !== ACTUAL.不变量) { bads++; bad(rel(f) + ' 目录里说「' + n[0] + '」，实际 ' + ACTUAL.不变量 + ' 条'); }
    }
  }
}
if (bads === 0) ok(hits + ' 处声称都与 ' + ACTUAL.不变量 + ' 条一致（含目录锚点形式）');

// ── 检查 2 · ADR ──
checkClaims('检查 2 · ADR 条数', /(\d+)\s*条\s*ADR|ADR\s*(\d+)\s*条/g, ACTUAL.ADR, '条');

// ── 检查 3 · 主文件 ──
checkClaims('检查 3 · 主文件份数', /(\d+)\s*份主文件|主文件\s*(\d+)\s*份/g, ACTUAL.主文件, '份');

// ── 检查 4 · 图数（只认「N 张图」且 N ≥ 2，排除「一张图」量词） ──
console.log('');
console.log('检查 4 · 图数');
hits = 0; bads = 0;
for (const f of live) {
  const t = read(f);
  for (const m of t.matchAll(/([二三四五六七八九十]+)张图/g)) {
    if (isExample(t, m.index, m[0])) continue;
    if (isExemptLine(t, m.index)) continue;
    hits++;
    const n = CN[m[1]];
    if (n !== ACTUAL.图) { bads++; bad(rel(f) + ' 说 ' + m[1] + ' 张图，实际 ' + ACTUAL.图); }
  }
}
if (bads === 0) ok(hits + ' 处声称都与 ' + ACTUAL.图 + ' 张一致');

// ── 检查 5 · 过期术语 ──
console.log('');
console.log('检查 5 · 过期术语');
const STALE = [
  { re: /横向人画|人画横向连线|人只画横向连线/g, why: '已被 adr/017 改成「人说 Agent 画」' },
  { re: /过期传播改成 early cutoff|改成 early cutoff（?!，后撤回）/g, why: 'early cutoff 已撤回' },
  { re: /退出码只有三种/g, why: '已改成四值' },
  { re: /（其中 \d+ 项有牙）/g, why: '总账已改成六栏 + 通过四分' },
  { re: /五状态之和等于分母/g, why: '已统一为六栏' },
  // ER-5：已废规则的措辞
  { re: /六种\s*(?:空心断言|hollow-assertion)?\s*模式/g, why: '空心断言已改为按 claim/observable 对齐判断，语法扫描降级为提示（§6.1）' },
  { re: /不许是(?:个)?空心断言/g, why: '§6.2 第 4 条已作废（§6.1 把语法扫描降级为提示）' },
  // A-4：判方作答词
  { re: /每项只能答\s*`?是`?/g, why: '作答词已统一为 pass / fail / unknown（§7.1）' }
];
let stale = 0;
for (const f of live) {
  const t = read(f);
  for (const s of STALE) {
    for (const m of t.matchAll(s.re)) {
      if (isExemptLine(t, m.index)) continue;
      stale++;
      bad(rel(f) + ' 含过期术语「' + m[0] + '」（' + s.why + '）');
    }
  }
}
if (stale === 0) ok('没有过期术语');

// 节数只在「和体积写在一起」时才认。
// 踩过的坑：「INTENT.md 四节」「HANDOVER.md 六节」是本设计的核心概念，满篇都是；
// 用「上下文里有 02/规格」放宽，会把这些全判成腐化（实测误报 6 处）。
// 所以只认规格自己的那种写法：`约 96 KB、十六节`。
function 检查节数(t) {
  const bads = [];
  for (const m of t.matchAll(/(\d+)\s*KB[^\n。]{0,10}?([一二三四五六七八九十]+)\s*节/g)) {
    const n = CN[m[2]];
    if (!n) continue;
    if (n !== ACTUAL.规格节数) bads.push({ ms: m[0], n });
  }
  return bads;
}

// ── 检查 6 · 规格体积与节数 ──
console.log('');
console.log('检查 6 · 规格体积与节数');
hits = 0; bads = 0;
for (const f of claims) {
  const t = read(f);
  // 体积：认「约 N KB」与「N KB」，且上下文 30 字内提到 02 或规格（ER-2 去掉只能带「约」的限制）
  for (const m of t.matchAll(/(\d+)\s*KB/g)) {
    if (isExample(t, m.index, m[0])) continue;
    if (isExemptLine(t, m.index)) continue;
    const ctx = t.slice(Math.max(0, m.index - 30), m.index + 40);
    if (!/02|规格/.test(ctx)) continue;
    hits++;
    if (Math.abs(Number(m[1]) - ACTUAL.规格KB) > 2) { bads++; bad(rel(f) + ' 说 ' + m[1] + ' KB，实际 ' + ACTUAL.规格KB); }
  }
  // 节数：只认「和体积写在一起」的那种（见上面的函数注释）
  const start = t.lastIndexOf('\n', t.indexOf('KB')) + 1;
  for (const x of 检查节数(t)) {
    if (isExemptLine(t, t.indexOf(x.ms))) continue;
    hits++;
    bads++;
    bad(rel(f) + ' 说「' + x.ms + '」，实际 ' + ACTUAL.规格节数 + ' 节');
  }
  // 另一种写法「N 个节」，少见，但保留（带上下文闸）
  for (const m of t.matchAll(/(?<!第)(?<![一二三四五六七八九十])([一二三四五六七八九十]+)\s*个节(?!点)/g)) {
    if (isExample(t, m.index, m[0])) continue;
    if (isExemptLine(t, m.index)) continue;
    const ctx = t.slice(Math.max(0, m.index - 40), m.index + 20);
    if (!/02|规格|§/.test(ctx)) continue;
    const n = CN[m[1]];
    if (!n) continue;
    hits++;
    if (n !== ACTUAL.规格节数) { bads++; bad(rel(f) + ' 说「' + m[0] + '」，实际 ' + ACTUAL.规格节数 + ' 节'); }
  }
}
if (bads === 0) ok(hits + ' 处声称与 ' + ACTUAL.规格KB + ' KB / ' + ACTUAL.规格节数 + ' 节一致');

// ── 检查 7 · 节号引用越界 ──
console.log('');
console.log('检查 7 · 节号引用');
const maxSec = Math.max(...[...spec.matchAll(/^## ([一二三四五六七八九十]+)、/gm)].map((m) => CN[m[1]] || 0));
let secBad = 0;
for (const f of live) {
  const t = read(f);
  for (const m of t.matchAll(/第(十[一二三四五六七]|[一二三四五六七八九十])节/g)) {
    const n = CN[m[1]];
    if (!n || n > maxSec) { secBad++; bad(rel(f) + ' 引用「' + m[0] + '」，最大节号 ' + maxSec); }
  }
}
if (secBad === 0) ok('所有「第N节」引用都在 1–' + maxSec + ' 之间');

// ── 检查 8 · 命令条数（ER-7：ACTUAL 不再被 §2.4 的 teeth 行污染）──
// 只认十位以上的声称（「十二条命令」「十三条命令」）。「一条命令」是量词，不是总量。
console.log('');
console.log('检查 8 · 命令条数');
checkClaims('  条数声称', /(十[一二三四五六七八九]?|二十)条命令/g, ACTUAL.命令, '条', claims);

// ── 检查 9 · 通过子数（ER-3）──
console.log('');
console.log('检查 9 · 通过子数');
checkClaims('  子数声称', /通过\s*([二三四五六七八九十]+)\s*分/g, ACTUAL.通过子数, '个', claims);
checkClaims('  子数声称（另一写法）', /([二三四五六七八九十]+)\s*个子数/g, ACTUAL.通过子数, '个', claims);

// ── 检查 10 · 门数（ER-4）──
console.log('');
console.log('检查 10 · 门数');
let door = 0, doorBad = 0;
for (const f of claims) {
  const t = read(f);
  // 总门数表述：N 道门 + 紧跟「禁/只/里/中/流程/的」，才是在说总数
  for (const m of t.matchAll(/([三四五六七八九十]+)道门(?=禁|只|里|中|流程|的)/g)) {
    if (isExemptLine(t, m.index)) continue;
    door++;
    if (CN[m[1]] !== ACTUAL.大门数) { doorBad++; bad(rel(f) + ' 说「' + m[0] + '」，实际 ' + ACTUAL.大门数 + ' 道门'); }
  }
  // 「门 6」不存在，出现即红
  for (const m of t.matchAll(/门\s*6|门\s*六(?![道])/g)) {
    if (isExemptLine(t, m.index)) continue;
    door++;
    doorBad++;
    bad(rel(f) + ' 出现「' + m[0] + '」，门只到 门 ' + (ACTUAL.大门数 - 1));
  }
}
if (doorBad === 0) ok(door === 0 ? '文档里没有门数声称，也没有不存在的门号' : door + ' 处门数声称都与 ' + ACTUAL.大门数 + ' 道一致，且没有不存在的门号');

// ── 检查 11 · `teeth` 合法取值必须被唯一清单覆盖（ER-6）──
// 变动前的样子：§3.4.1 的 A2 枚举 7 个、§6.1 主表 8 个、补充表 2 个，三处各写各的，
// 实现者按哪一份都能自证正确。现在 §6.1 有一张「全部合法取值（唯一清单）」，
// 本检查断言：classification.json 的 A2 枚举 ⊆ 那张清单，且清单本身不少于 10 个值。
console.log('');
console.log('检查 11 · teeth 合法取值覆盖');
{
  const i0 = spec.indexOf('#### `teeth` 的全部合法取值');
  const i1 = spec.indexOf('#### 两条从业界直接搬来的硬规则');
  if (i0 < 0 || i1 < 0 || i1 < i0) { bad('找不到 §6.1 的「teeth 全部合法取值」清单或它的边界'); }
  else {
    const block = spec.slice(i0, i1);
    const listed = [...block.matchAll(/^\| `([a-z][a-z-]*)` \|/gm)].map((m) => m[1]);
    const set = new Set(listed);
    const a2 = classification.rows.find((r) => r.subclass === 'A2');
    const teeth = (a2 && a2.when && a2.when.teeth) || [];
    const missing = teeth.filter((v) => !set.has(v));
    let ok11 = true;
    if (missing.length) { ok11 = false; bad('classification.json 的 A2 枚举里有值不在唯一清单中：' + missing.join('、')); }
    if (set.size < 10) { ok11 = false; bad('唯一清单只有 ' + set.size + ' 个值，少于应有的 10 个以上'); }
    if (ok11) ok('A2 枚举 ' + teeth.length + ' 个值全部在唯一清单里（清单共 ' + set.size + ' 个值）');
  }
}


// ── 检查 12 · 门 2 段表自洽 ──
console.log('');
console.log('检查 12 · 门 2 段表自洽');
{
  if (SEG_ROWS.length !== 4) { bad('段表应有 4 段，实际解析到 ' + SEG_ROWS.length + ' 段'); }
  const { bads } = segCheck(SEG_ROWS, ACTUAL.门2条数);
  for (const b of bads) bad(b);
  if (bads.length === 0) ok('4 段分子/分母自洽，并集覆盖全部 ' + ACTUAL.门2条数 + ' 条');
}

// ── 检查 13 · 门 2 条数声称（只扫设计包与根 README）──
console.log('');
console.log('检查 13 · 门 2 条数声称');
{
  const targets = files.filter((f) => {
    const r = rel(f);
    return r === 'README.md' || (r.startsWith('设计/') && !r.startsWith('设计/adr/'));
  });
  let hits13 = 0, bad13 = 0;
  for (const f of targets) {
    for (const c of door2Claims(read(f))) {
      hits13++;
      if (c.n !== ACTUAL.门2条数) { bad13++; bad(rel(f) + ':' + c.lineNo + ' 说「' + c.matched + '」，实际 ' + ACTUAL.门2条数 + ' 条'); }
    }
  }
  if (bad13 === 0) ok(hits13 + ' 处声称都与 ' + ACTUAL.门2条数 + ' 条一致');
}

// 检查 12/13 的固定样例：证明谓词真的能红，且叙述句不会被误判
{
  const cases = [
    { text: '| **T1a** | a | b | 2.1 有判据、2.2 已冻结 | 「T1a · 2/2」 |', total: 2, wantBad: false },
    { text: '| **T1a** | a | b | 2.1 有判据、2.2 已冻结 | 「T1a · 3/2」 |', total: 2, wantBad: true }
  ];
  for (const c of cases) {
    const got = segCheck([c.text], c.total).bads.length > 0;
    if (got !== c.wantBad) bad('自测「段表分子」不符预期：' + c.text);
  }
  const d2 = [
    { text: '门 2 的十三条条件。', want: 13 },
    { text: '门 2 判十件事，全过才放行。', want: 10 },
    { text: '门 2 从三条变十三条。', want: 0 },
    { text: '门 2 的任何一条都不许配成警告。', want: 0 }
  ];
  for (const c of d2) {
    const claims = door2Claims(c.text);
    const got = claims.length === 0 ? 0 : claims[0].n;
    if (got !== c.want) bad('自测「门 2 条数」不符预期：' + c.text + '（读到 ' + got + '，应 ' + c.want + '）');
  }
  if (cases.length + d2.length > 0) console.log('  （检查 12/13 固定样例：' + (cases.length + d2.length) + ' 个）');
}

// ── 检查 0 · 判据自测（固定样例，与真实文档无关）──
// 目的：证明上面每条正则真的能抓到错误值，并且豁免规则真的生效。
// 不靠「文档里碰巧有可检查对象」——那等于让判据的牙取决于样本。
console.log('检查 0 · 判据自测（固定样例）');
// 设计意图：错误值写死（不随实际值变化），正确值从 ACTUAL 生成。
// 这样主文件增删时样例自己不会腐化——固定样例的「正确」不该是另一个要维护的数字。
const SELFTEST = [
  { name: '不变量·后置', text: '不变量 16 条。', ok: false, re: /(\d+)\s*条不变量|不变量\s*(\d+)\s*条/g, actual: ACTUAL.不变量 },
  { name: '不变量·前置', text: '16 条不变量。', ok: false, re: /(\d+)\s*条不变量|不变量\s*(\d+)\s*条/g, actual: ACTUAL.不变量 },
  { name: '不变量·正确', text: '不变量 ' + ACTUAL.不变量 + ' 条。', ok: true, re: /(\d+)\s*条不变量|不变量\s*(\d+)\s*条/g, actual: ACTUAL.不变量 },
  { name: '目录锚点·错', text: '| [一、不变量](#一不变量) | **16 条**，任何实现不许违反 |', ok: false, re: /^.*#一不变量.*$/gm, actual: ACTUAL.不变量, nth: /(\d+)\s*条/g },
  { name: 'ADR·前置', text: '13 条 ADR。', ok: false, re: /(\d+)\s*条\s*ADR|ADR\s*(\d+)\s*条/g, actual: ACTUAL.ADR },
  { name: 'ADR·正确', text: 'ADR ' + ACTUAL.ADR + ' 条。', ok: true, re: /(\d+)\s*条\s*ADR|ADR\s*(\d+)\s*条/g, actual: ACTUAL.ADR },
  { name: '主文件·前置', text: '7 份主文件。', ok: false, re: /(\d+)\s*份主文件|主文件\s*(\d+)\s*份/g, actual: ACTUAL.主文件 },
  { name: '主文件·正确', text: '主文件 ' + ACTUAL.主文件 + ' 份。', ok: true, re: /(\d+)\s*份主文件|主文件\s*(\d+)\s*份/g, actual: ACTUAL.主文件 },
  { name: '命令条数·错', text: '十三条命令。', ok: false, re: /([一二三四五六七八九十]+)\s*条命令/g, actual: ACTUAL.命令 },
  { name: '命令条数·正确', text: '十二条命令。', ok: true, re: /([一二三四五六七八九十]+)\s*条命令/g, actual: ACTUAL.命令 },
  { name: '通过子数·错', text: '六栏加通过三分。', ok: false, re: /通过\s*([二三四五六七八九十]+)\s*分/g, actual: ACTUAL.通过子数 },
  { name: '通过子数·正确', text: '六栏加通过四分。', ok: true, re: /通过\s*([二三四五六七八九十]+)\s*分/g, actual: ACTUAL.通过子数 },
  { name: '门数·错', text: '五道门禁。', ok: false, re: /([三四五六七八九十]+)道门(?=禁|只|里|中|流程|的)/g, actual: ACTUAL.大门数 },
  { name: '门数·正确', text: '六道门禁。', ok: true, re: /([三四五六七八九十]+)道门(?=禁|只|里|中|流程|的)/g, actual: ACTUAL.大门数 },
  { name: '门 6·错', text: '五道门只剩门 5 和门 6', ok: false, re: /门\s*6|门\s*六(?![道])/g, actual: 0, alwaysBad: true },
  { name: '门数·子集不算总数', text: '其余四道门不启用，三道门都过。', ok: true, re: /([三四五六七八九十]+)道门(?=禁|只|里|中|流程|的)/g, actual: null, expectNoMatch: true }
];
let stFail = 0;
for (const c of SELFTEST) {
  if (c.expectNoMatch) {
    const got = [...c.text.matchAll(c.re)].length;
    if (got !== 0) { stFail++; bad('自测「' + c.name + '」应当不命中，实际命中 ' + got + '：' + c.text); }
    continue;
  }
  if (c.alwaysBad) {
    const got = [...c.text.matchAll(c.re)].length;
    if (got === 0) { stFail++; bad('自测「' + c.name + '」应当命中，实际没命中：' + c.text); }
    continue;
  }
  const vals = [...c.text.matchAll(c.re)].map((x) => CN[x[1]] ?? Number(x[1] ?? x[2]));
  // ok=false 要求「至少一个不等于 actual」；ok=true 要求「全部等于 actual」
  const verdict = c.ok ? vals.every((v) => v === c.actual) : vals.some((v) => v !== c.actual);
  if (!verdict) { stFail++; bad('自测「' + c.name + '」不符预期：' + c.text); }
}
// ER-0 豁免自测：带标记的行不报，去掉标记就报
const EXEMPT_CASES = [
  { name: '豁免·有标记不报', text: '他说「六种模式」（原文如此）。', re: /六种\s*(?:空心断言|hollow-assertion)?\s*模式/g, wantHit: false },
  { name: '豁免·无标记要报', text: '他说「六种模式」。', re: /六种\s*(?:空心断言|hollow-assertion)?\s*模式/g, wantHit: true }
];
for (const c of EXEMPT_CASES) {
  const m = [...c.text.matchAll(c.re)][0];
  const gotHit = m ? !isExemptLine(c.text, m.index) : false;
  if (gotHit !== c.wantHit) { stFail++; bad('自测「' + c.name + '」不符预期：' + c.text); }
}
if (stFail === 0) ok(SELFTEST.length + EXEMPT_CASES.length + ' 个固定样例全部按预期分类（正则与豁免都真的有牙）');

console.log('');
if (misuse > 0) { console.log('RESULT: FAIL 豁免被滥用 ' + misuse + ' 处（这是检查器自身不合格，退出码 2）'); process.exit(2); }
if (failures === 0) { console.log('RESULT: PASS 未发现文档腐化'); process.exit(0); }
console.log('RESULT: FAIL ' + failures + ' 处腐化');
process.exit(1);
