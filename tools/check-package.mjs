#!/usr/bin/env node
// 设计档案自检：文件齐、链接可达、图是 mermaid 且没有别的代码块、各文件必备章节齐、ADR 五段齐。
// 用法：node "tools/check-package.mjs"
// 自检红：node "tools/check-package.mjs" --red-self-test

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const D = join(ROOT, '设计');

const RED = process.argv.includes('--red-self-test');
let failures = 0;
const fail = (m) => { failures++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

// L1 档案齐
console.log('L1 档案齐');
const MAIN = ['README.md', '01-图.md', '02-规格.md', '03-走查.md', '04-RFC.md', '06-验证方案.md', '07-结论.md', '08-失效链.md', '09-形态选型.md'];
for (const f of MAIN) {
  const p = join(D, f);
  if (!existsSync(p)) fail('缺文件 设计/' + f); else ok('设计/' + f);
}
const ADR_DIR = join(D, 'adr');
const adrs = existsSync(ADR_DIR) ? readdirSync(ADR_DIR).filter((f) => f.endsWith('.md')).sort() : [];
if (adrs.length < 5) fail(`ADR 只有 ${adrs.length} 份，至少 5 份`); else ok(`ADR ${adrs.length} 份`);

// L1c README 开头必须有证据支持的收敛句，且不许有陈旧的「六个文件」
console.log('L1c 开头的收敛句');
const readmeHead = readFileSync(join(D, 'README.md'), 'utf8');
const hasNarrow = readFileSync(join(D, '07-结论.md'), 'utf8').includes('不能让你更快');
const staleSix = readmeHead.includes('六个文件');
if (!hasNarrow) fail('README 开头缺证据支持的收敛句');
if (staleSix) fail('README 仍有陈旧的「六个文件」');
if (hasNarrow && !staleSix) ok('开头写明只压得住一半，且无陈旧文件数');

// L1b 每份主文件都必须出现在 README 的路由表或档案清单里
console.log('L1b 路由表覆盖');
const readmeText = readFileSync(join(D, 'README.md'), 'utf8');
const unlisted = MAIN.filter((f) => f !== "README.md" && !readmeText.includes(f));
if (unlisted.length) fail('主文件未出现在 README：' + unlisted.join(',')); else ok('全部主文件都在 README 里被路由');



// L2 链接可达（设计目录内 + 两份查表文档）
console.log('L2 链接可达');
const linkRe = /\]\(([^)]+)\)/g;
const docs = [...MAIN.map((f) => join(D, f)), ...adrs.map((f) => join(ADR_DIR, f)),
  join(ROOT, '参考', '22-67问题防御矩阵.md'), join(ROOT, '参考', '23-工具覆盖审计与补选.md')];
for (const doc of docs) {
  if (!existsSync(doc)) { fail('缺文件 ' + relative(ROOT, doc)); continue; }
  const text = readFileSync(doc, 'utf8');
  let m, n = 0, bad = 0;
  while ((m = linkRe.exec(text)) !== null) {
    let href = m[1].trim();
    if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
    href = href.split('#')[0];
    if (!href || /^https?:/.test(href)) continue;
    n++;
    if (RED && bad === 0 && n === 1) { fail('自检模式：假装第一条链接死掉 ' + href); bad++; continue; }
    if (!existsSync(resolve(dirname(doc), href))) { fail(`${relative(ROOT, doc)}: 死链 ${href}`); bad++; }
  }
  ok(`${relative(ROOT, doc)}: ${n} 条链接，死链 ${bad} 条`);
}

// L3 代码块只允许 mermaid（只检查开启围栏，忽略闭合围栏）
console.log('L3 只允许 mermaid 图与 text 记录');
for (const doc of docs) {
  if (!existsSync(doc)) continue;
  const lines = readFileSync(doc, 'utf8').split('\n');
  const langs = [];
  let inside = false;
  for (const line of lines) {
    const m = line.match(/^```(\w*)\s*$/);
    if (!m) continue;
    if (!inside) { langs.push(m[1] || '(无语言)'); inside = true; }
    else { inside = false; }
  }
  const ALLOWED = new Set(['mermaid', 'text']);
  const bad = langs.filter((l) => !ALLOWED.has(l));
  if (bad.length) fail(`${relative(ROOT, doc)}: 出现非 mermaid 代码块 ${JSON.stringify(bad)}`);
}
if (failures === 0) ok('代码块只有 mermaid 图与 text 记录，没有可执行代码');

// L4 必备章节
console.log('L4 必备章节');
const need = {
  'README.md': ['## 它想做什么', '## 一张图看完', '## 五个词', '## 三条底线', '## 按你的身份选入口', '## 档案清单'],
  '01-图.md': ['## 图一', '## 图二', '## 图三', '## 图四', '## 图五', '## 图六', '## 图七', '## 图八'],
  '02-规格.md': ['## 一、不变量', '## 二、对象字段', '## 三、计数规则', '## 四、判据执行规格', '## 五、总线记录格式', '## 六、有牙实验三档', '## 七、判方 rubric', '## 八、命令', '## 九、七阶段', '## 十、阈值', '## 十一、过期传播', '## 十二、覆盖率口径', '## 十三、健康自检', '## 十四、第三方许可', '## 十五、各道门的条件', '### 15.8 门 4.4', '## 十七、功能视图', '### 17.1 两个视图，同一批节点', '### 17.5 流程图为什么不会烂', '## 目录'],
  '03-走查.md': ['## 第 0 天', '## 第 3 天', '## 第 12 天', '## 第 21 天', '## 这一次走查里', '## 另一个场景：存量项目怎么迁进来'],
  '07-结论.md': ['## 一、一句话', '## 二、它做什么', '## 三、实测过什么', '## 四、适用 / 不适用', '## 五、最小起步', '## 六、测不了的', '## 七、要继续验证'],
  '08-失效链.md': ['## 失效链', '### 16.2 剩下十七个「部分」为什么只到部分'],
  '09-形态选型.md': ['## 一、先拆成两个正交问题', '## 二、六个壳方案', '## 三、内核方案', '## 四、七个方案对比', '## 五、作者倾向与不确定', '## 六、请评审回答的三个问题'],
  '06-验证方案.md': ['## 一、命题拆三层', '## 二、能测与不能测', '## 三、五条验证', '## 四、判定规则', '## 五、测不了的那一层', '## 六、因此产品文档该怎么写', '## 七、最快能做的三条', '## 八、这份方案自己怎么被验'],
  '04-RFC.md': ['## 摘要', '## 动机', '## 使用者视角', '## 实现视角', '## 缺点', '## 备选方案', '## 先前工作', '## 未决问题', '## 未来可能'],
};
for (const [f, hs] of Object.entries(need)) {
  const t = readFileSync(join(D, f), 'utf8');
  const miss = hs.filter((h) => !t.includes(h));
  if (miss.length) fail(`${f} 缺章节：${miss.join('、')}`); else ok(`${f}: ${hs.length} 节齐`);
}

// L5 ADR 五段齐
console.log('L5 ADR 五段');
let adrBad = 0;
for (const f of adrs) {
  const t = readFileSync(join(ADR_DIR, f), 'utf8');
  for (const h of ['**状态**', '## 背景', '## 决定', '## 理由', '## 后果']) {
    if (!t.includes(h)) { fail(`adr/${f} 缺 ${h}`); adrBad++; }
  }
}
if (adrBad === 0) ok(`${adrs.length} 份 ADR 都含状态/背景/决定/理由/后果`);

// L6 不变量与命令数
console.log('L6 关键计数');
const spec = readFileSync(join(D, '02-规格.md'), 'utf8');
const inv = (spec.match(/\*\*INV-\d\d\*\*/g) || []).length;
if (inv !== 18) fail(`不变量应为 18 条，实为 ${inv}`); else ok('不变量 18 条');
const cmds = ['init', 'contract new', 'contract freeze', 'check', 'teeth', 'status', 'graph', 'gaps', 'handover', 'verify pack', 'verify apply', 'retire'];
const missCmd = cmds.filter((c) => !spec.includes('`' + c + '`'));
if (missCmd.length) fail('命令表缺：' + missCmd.join(',')); else ok('命令 12 条齐');

// L7 67 条覆盖（在 22 号里）
console.log('L7 67 条覆盖');
const m22 = readFileSync(join(ROOT, '参考', '22-67问题防御矩阵.md'), 'utf8');
const counts = { A: 6, B: 6, C: 5, D: 5, E: 5, F: 6, G: 4, H: 5, I: 6, J: 4, K: 4, L: 4, M: 3, N: 4 };
const absent = [];
for (const [k, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) if (!m22.includes(`| ${k}${i} |`)) absent.push(`${k}${i}`);
if (absent.length) fail('22 号缺条目：' + absent.join(',')); else ok('67 条全部出现');

console.log('');
if (failures === 0) { console.log('RESULT: PASS'); process.exit(0); }
console.log(`RESULT: FAIL (${failures} 项)`); process.exit(1);
