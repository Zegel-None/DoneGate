// 代码层符号自检（2026-11-19 新增）：**把 CodeGraph 那两个查询吸收成零依赖判据**。
//
// 为什么自己做、不把 CodeGraph 接进流程：
//   · 十二条判据全是 `node skill/xxx.mjs`、零外部依赖——别的机器上装了 Node 就能跑；
//     把第三方二进制接进必跑清单，判据立刻变成「只有这台机器能验的东西」。
//   · CodeGraph 只认**同名**：`walkFiles` 与 `walk` 同义不同名，它报不出来（08 §56 实测）。
//     按「函数体归一化指纹」分组就抓得到。
//
// 三条断言（对应三种腐化形状）：
//   ① 零引用函数（死代码候选）
//   ② 同名定义 ≥2 份且函数体不同（同名不同义——读代码的人会按错的那个理解）
//   ③ 函数体归一化后完全相同、但名字不同（换名复制——改一处忘一处）
//
// 用法：
//   node skill/check-symbols.mjs                 只看报告，不判红（开发时用）
//   node skill/check-symbols.mjs --gate          超过基线即红（退出码 1）——「棘轮」用法
//   node skill/check-symbols.mjs --update-baseline  把当前结果写成新基线（要人确认后跑）
//
// 基线的意义：存量欠账不挡路，**新增一处就红**。这是 repo-uniformity 那套「只降不升」的最小版。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootIdx = process.argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : resolve(scriptDir, '..');
const BASELINE = join(ROOT, 'skill', 'symbols-baseline.json');
const argv = process.argv.slice(2);
const GATE = argv.includes('--gate');
const UPDATE = argv.includes('--update-baseline');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// 扫哪些目录：项目自己的自动化层（发布物与资料区不扫——前者另有门禁，后者冻结）
const DIRS = ['skill', 'runner', 'tools'];
const files = [];
for (const d of DIRS) {
  const dir = join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir)) if (e.endsWith('.mjs')) files.push(join(dir, e));
}

// **计数一律用原文**：一开始想先剥掉注释和字符串，结果那条正则太脆，把真正的调用点也一起吞了
// （实测 `scoreRecipient`、`isExample`、`inFence` 三个真调用的函数被误判成死代码）。
// 代价如实记：名字只出现在注释/字符串里时会被算成「有人用」→ **假阴性**。
// 这个方向是刻意的：漏报一个死函数只是少省几行，误报一个活函数会让人删掉在用的代码。

const DEFS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm
];

const sources = new Map();
// 一次读：旧写法 `readFileSync(...) === null ? '' : readFileSync(...)` 既读了两遍，
// 又用一个永远为假的判断（readFileSync 只会返回字符串或抛）——删掉判断，只留一次读。
for (const f of files) sources.set(f, readFileSync(f, 'utf8'));


// 抽取定义：名字 + 文件 + 行号 + 函数体（从定义行到配平的 } 或行尾）
const allText = [...sources.values()].join('\n');
const defs = [];
for (const [f, raw] of sources) {
  const s = raw;
  const rawLines = raw.split('\n');
  const defLines = new Set();
  for (const re of DEFS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const line = s.slice(0, m.index).split('\n').length;
      if (defLines.has(line)) continue;
      defLines.add(line);
      defs.push({ name: m[1], file: rel(f), line, body: bodyAt(rawLines, line - 1) });
    }
  }
  // 记录本文件里的定义名，供引用计数排除（同名定义在多处时，按「出现次数 − 定义次数」算引用）
}

function bodyAt(lines, start) {
  // 取从定义行起、花括号配平的那一段；配不平就取一行。
  // **不许按固定行数截断**：旧实现截在定义行后 80 行，两个前缀相同、只在 80 行之后不同的函数
  // 会被判成「同体不同名」（假阳性，symbols-fixtures 的 ⑤ 抓到的）。400 只是防「花括号永不配平」
  // 的死循环余量——仓库里实测最长的函数是 99 行（check-reviewpack 的 buildPack）。
  let depth = 0, out = [], started = false;
  for (let i = start; i < Math.min(lines.length, start + 400); i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) break;
    if (!started && /;\s*$/.test(l.replace(/\/\/.*$/, ''))) break;   // 行尾注释不算代码：判「这行以分号结束」前先剥掉   // 单行定义（无花括号）只取这一行；原来固定取 4 行，会把后文算进函数体，制造假的「同名不同体」
  }
  return out.join('\n');
}
const normBody = (b) => b.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').trim();

// 内容指纹：棘轮的键里要带它，否则「同名不同体」的实现改了也发现不了
const fp = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(16).slice(0, 8);
};


const countWord = (word) => {
  const re = new RegExp('(^|[^\\w$.])' + word.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
  return (allText.match(re) || []).length;
};

// ① 零引用：总出现次数 == 定义次数 → 只有定义，没人用
const byName = new Map();
for (const d of defs) {
  if (!byName.has(d.name)) byName.set(d.name, []);
  byName.get(d.name).push(d);
}
const dead = [];
for (const [name, ds] of byName) {
  if (countWord(name) - ds.length <= 0) dead.push(...ds.map((d) => ({ kind: 'dead', name, at: d.file + ':' + d.line })));
}

// ② 同名不同体
const sameNameDiff = [];
for (const [name, ds] of byName) {
  if (ds.length < 2) continue;
  const bodies = new Set(ds.map((d) => normBody(d.body)));
  if (bodies.size > 1) sameNameDiff.push({ kind: 'sameName', name, at: ds.map((d) => d.file + ':' + d.line).join(' | '), variants: bodies.size, print: fp([...bodies].sort().join('\u0001')) });
}

// ③ 同体不同名（换名复制）
const byBody = new Map();
for (const d of defs) {
  // 归一化时**把函数自己的名字抹成 NAME**：否则同体不同名的两份，函数体里各自带着不同的名字，永远分不到一组
  const k = normBody(d.body).split(d.name).join('NAME');
  if (k.length < 40) continue; // 一行小工具不比，噪声太大
  if (!byBody.has(k)) byBody.set(k, []);
  byBody.get(k).push(d);
}
const renamed = [];
for (const [bodyKey, ds] of byBody) {
  const names = new Set(ds.map((d) => d.name));
  if (names.size < 2) continue;
  if (new Set(ds.map((d) => d.file)).size < 2) continue; // 同一文件里两处同体不算
  renamed.push({ kind: 'renamed', name: [...names].join(' / '), at: ds.map((d) => d.file + ':' + d.line).join(' | '), print: fp(bodyKey) });
}

const findings = [...dead, ...sameNameDiff, ...renamed];
// 键里带指纹：同名不同体的「变体内容」一改，键就变 → 棘轮会报新增。
// 不带指纹时实测过：把 helper 的实现从 x*2 改成 x-3，键不变 → 静默放过（夹具第 2 例抓到的就是这个）。
const findingKey = (f) => f.kind + ' · ' + f.name + ' · ' + f.at + (f.print ? ' · ' + f.print : '');

console.log('扫描：' + files.length + ' 个 .mjs，' + defs.length + ' 个函数定义');
console.log('\n① 零引用（死代码候选）：' + dead.length);
for (const d of dead) console.log('   ' + d.at + '  ' + d.name);
console.log('\n② 同名不同体：' + sameNameDiff.length);
for (const d of sameNameDiff) console.log('   ' + d.name + '（' + d.variants + ' 种）' + d.at);
console.log('\n③ 同体不同名（换名复制）：' + renamed.length);
for (const d of renamed) console.log('   ' + d.name + '  ' + d.at);

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'check-symbols 的棘轮基线：存量不挡路，新增即红', count: findings.length, keys: findings.map(findingKey).sort() }, null, 2) + '\n', 'utf8');
  console.log('\n已写基线 → ' + rel(BASELINE) + '（' + findings.length + ' 条）');
  process.exit(0);
}

if (GATE) {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).keys : [];
  const now = findings.map(findingKey).sort();
  const added = now.filter((k) => !base.includes(k));
  const fixed = base.filter((k) => !now.includes(k));
  if (fixed.length) console.log('\n比基线少了 ' + fixed.length + ' 条（好事，记得 --update-baseline 把它固化）：\n   ' + fixed.join('\n   '));
  if (added.length) {
    console.log('\nRESULT: 新增 ' + added.length + ' 条（棘轮只降不升）——\n   ' + added.join('\n   '));
    process.exit(1);
  }
  console.log('\nRESULT: 无新增（当前 ' + now.length + ' 条，基线 ' + base.length + '）');
  process.exit(0);
}
console.log('\n（只看报告。加 --gate 判红，加 --update-baseline 固化基线）');
process.exit(0);
