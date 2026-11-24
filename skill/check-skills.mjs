// 分发包的第 4 条自检：**技能到底能不能被加载**。
// 为什么需要它：冷启动验收里三个接收方都指出「三条自检只查结构/规则/文档腐化，谁都没验证技能能被 DSH 认出来」，
// 其中两个还把整包解成了 `skills/<包名>/`（多一层），三条自检照样全绿——**装错了也绿，这就是假绿**。
//
// 零依赖、纯 Node：只查 DSH 加载器真正会读的那几件事（见 dsh-skill-authoring 的规则）：
//   ① `<根>/<名字>/SKILL.md` 存在（不许多一层嵌套：加载器只认一层，嵌套永远扫不到且不留日志）
//   ② frontmatter 首行恰好 `---`、有结束分隔、能解析成「键: 值」映射
//   ③ name 与 description 都是非空字符串，且 **name 必须等于目录名**（身份取自 frontmatter，不是目录名）
//   ④ description 若是 plain scalar，**不许含 `: `**（这会让整条技能静默消失）
//   ⑤ 正文非空
//
// 用法：
//   node skill/check-skills.mjs [--root <目录>] [--self-test]
// 退出码：0 全部可加载；1 有技能会被丢弃；3 用法错
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = resolve(rootIdx >= 0 ? argv[rootIdx + 1] : '.');
// 发布物里三个技能的名字是固定的：写在常量里，免得「目录改名了但这里没改」也悄悄放过
const EXPECTED = ['donegate', 'donegate-judge', 'donegate-forge'];

const parseFrontmatter = (text) => {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { error: '首行不是 `---`（可能是 BOM、空行或注释开头）' };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!m) return { error: '找不到结束分隔（必须恰好整行三个连字符）' };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const km = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!km) continue;
    fm[km[1]] = km[2];
  }
  return { fm, body: text.slice(m[0].length) };
};

const checkSkill = (dir) => {
  const name = basename(dir);
  const file = join(dir, 'SKILL.md');
  const problems = [];
  if (!existsSync(file)) return ['缺 SKILL.md'];
  const r = parseFrontmatter(readFileSync(file, 'utf8'));
  if (r.error) return [r.error];
  const { fm, body } = r;
  if (!fm.name) problems.push('frontmatter 缺 name');
  if (!fm.description) problems.push('frontmatter 缺 description');
  if (fm.name && fm.name.trim() !== name) problems.push('name「' + fm.name.trim() + '」与目录名「' + name + '」不一致（加载器的身份取自 frontmatter）');
  // plain scalar 的 description 含 `: ` 会让整条技能静默消失；块标量（>- / |）与引号包裹都安全
  const d = fm.description || '';
  const quoted = /^['"]/.test(d) || /^[>|]/.test(d);
  if (!quoted && /:\s/.test(d)) problems.push('description 是 plain scalar 且含「: 」（会让整条技能静默消失，改用 >- 块标量或加引号）');
  if (!body.trim()) problems.push('正文为空');
  return problems;
};

const runCheck = (root) => {
  const out = [];
  // ① 根下必须一层就是 skill 目录
  const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  for (const want of EXPECTED) {
    if (!entries.includes(want)) out.push({ name: want, problems: ['根目录下没有 `' + want + '/`（是不是把整包放进了 skills 下、多了一层？加载器只认一层）'] });
  }
  for (const want of EXPECTED) {
    const dir = join(root, want);
    if (!existsSync(dir)) continue;
    const problems = checkSkill(dir);
    out.push({ name: want, problems });
  }
  // ② 顺带报「根下还有别的目录带 SKILL.md」——那些会被当成别的技能，可能是嵌套错位
  for (const e of entries) {
    if (EXPECTED.includes(e)) continue;
    if (existsSync(join(root, e, 'SKILL.md'))) out.push({ name: e, problems: ['这个目录也有 SKILL.md——如果是整包的子目录被放平了，说明装错了一层'] });
  }
  return out;
};

if (argv.includes('--self-test')) {
  let bad = 0;
  const t = (name, cond, extra = '') => {
    if (cond) console.log('  ✓ ' + name);
    else {
      bad++;
      console.log('  ✗ ' + name + (extra ? ' → ' + extra : ''));
    }
  };
  const mk = (fn) => {
    const d = mkdtempSync(join(tmpdir(), 'check-skills-'));
    fn(d);
    return d;
  };
  // 好样本
  const good = mk((d) => {
    for (const n of EXPECTED) {
      mkdirSync(join(d, n), { recursive: true });
      writeFileSync(join(d, n, 'SKILL.md'), '---\nname: ' + n + '\ndescription: >-\n  干某事。\n  NOT for: 别的。\n---\n\n正文。\n');
    }
  });
  t('好样本：无问题', runCheck(good).every((x) => x.problems.length === 0), JSON.stringify(runCheck(good)));
  // 嵌套一层
  const nested = mk((d) => {
    const inner = join(d, 'pkg-0.1.0');
    for (const n of EXPECTED) {
      mkdirSync(join(inner, n), { recursive: true });
      writeFileSync(join(inner, n, 'SKILL.md'), '---\nname: ' + n + '\ndescription: x\n---\n\n正文。\n');
    }
  });
  t('多一层嵌套：必须报错', runCheck(nested).some((x) => x.problems.length > 0));
  // name 与目录不一致
  const mismatch = mk((d) => {
    mkdirSync(join(d, 'donegate'), { recursive: true });
    mkdirSync(join(d, 'donegate-judge'), { recursive: true });
    writeFileSync(join(d, 'donegate', 'SKILL.md'), '---\nname: other-name\ndescription: x\n---\n\n正文。\n');
    writeFileSync(join(d, 'donegate-judge', 'SKILL.md'), '---\nname: donegate-judge\ndescription: x\n---\n\n正文。\n');
  });
  t('name 与目录不一致：必须报错', runCheck(mismatch).some((x) => x.problems.some((p) => p.includes('不一致'))));
  // description 带冒号
  const colon = mk((d) => {
    for (const n of EXPECTED) {
      mkdirSync(join(d, n), { recursive: true });
      writeFileSync(join(d, n, 'SKILL.md'), '---\nname: ' + n + '\ndescription: 做 X。NOT for: 别的情况。\n---\n\n正文。\n');
    }
  });
  t('plain scalar 含「: 」：必须报错', runCheck(colon).some((x) => x.problems.some((p) => p.includes('静默消失'))));
  for (const d of [good, nested, mismatch, colon]) rmSync(d, { recursive: true, force: true });
  console.log('\n结果：' + (bad === 0 ? '全过' : bad + ' 条不成立'));
  process.exit(bad ? 1 : 0);
}

const results = runCheck(ROOT);
let fails = 0;
console.log('检查技能根：' + ROOT);
for (const r of results) {
  if (r.problems.length === 0) console.log('  ✓ ' + r.name + ' 可加载');
  else { fails++; console.log('  ✗ ' + r.name + '：' + r.problems.join('；')); }
}
if (results.length === 0) { console.error('3  根目录读不出来或没有任何技能目录：' + ROOT); process.exit(3); }
console.log(fails === 0 ? '\nRESULT: PASS ' + results.length + ' 个技能都能被加载' : '\nRESULT: FAIL ' + fails + ' 个技能会被丢弃');
process.exit(fails === 0 ? 0 : 1);
