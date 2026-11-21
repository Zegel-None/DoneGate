// 工坊技能门禁：donegate-forge 的 SKILL.md 与五张卡是否可加载、可点击、顺序自洽、可照做。
// 为什么单独一个脚本、不塞进 check-cards.mjs：check-cards 守的是 donegate 那十六份产物，
// 它的应存在清单与定论落地锚点都是给写方卡写的；把工坊卡混进去会让两边互相绑死，
// 改一边的清单就动到另一边的门禁。所以另起一个，只守工坊。
//
// 用法：
//   node skill/check-forge-cards.mjs            默认：卡口径 + 自带 1 个好样本与 7 个必红样本
//   node skill/check-forge-cards.mjs --dir <目录>  审另一份工坊目录（默认 donegate-forge/）
// 退出码（§八 四值）：0 全过 / 1 有卡不合格 / 3 目录读不出。

import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SKILL_NAME = 'donegate-forge';
const CARDS = [
  { file: '卡-选型调研.md', full: true },
  { file: '卡-适配器实现.md', full: true },
  { file: '卡-三组必红夹具.md', full: true },
  { file: '卡-准入与登记.md', full: true },
  { file: '卡-首批示范.md', full: false }
];
const STEP_ANCHORS = [
  '1. **栈盘点与缺口框定**',
  '2. **候选调研**',
  '3. **选型判定**',
  '4. **造适配器**',
  '5. **三组必红夹具**',
  '6. **登记与准入**'
];
const 四段 = ['## 入口条件', '## 步骤', '## 出口判据', '## 延伸阅读'];
const 示范段 = ['## 出口判据', '## 延伸阅读'];
const 禁用措辞 = ['六种模式', '不许是空心断言', '五道门', '门 6', '门6', '通过三分'];
const MIN_CJK = 300;
const MAX_CJK = 2600;

const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
const prose = (t) => t.replace(/^---[\s\S]*?\r?\n---\r?\n/, '').replace(/```[\s\S]*?```/g, '');
const links = (t) => {
  const out = [];
  for (const m of t.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const u = m[1];
    if (/^(https?:|#|mailto:)/.test(u)) continue;
    out.push(u.replace(/#.*$/, ''));
  }
  return out;
};
const parseFrontmatter = (text) => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!m) return { error: '首行不是 --- 或找不到结束分隔' };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (km) fm[km[1]] = km[2];
  }
  return { fm, body: text.slice(m[0].length) };
};

export function auditForge(dir) {
  const fails = [];
  const dirName = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) return { fails: ['缺 SKILL.md'], links: 0, cards: 0 };

  // ① SKILL.md：frontmatter 可加载 + name 等于目录名 + description 是块标量
  const skillText = readFileSync(skillPath, 'utf8');
  const parsed = parseFrontmatter(skillText);
  if (parsed.error) fails.push('SKILL.md ' + parsed.error);
  else {
    const { fm, body } = parsed;
    if (!fm.name) fails.push('SKILL.md frontmatter 缺 name');
    else if (fm.name.trim() !== dirName) fails.push(`SKILL.md name「${fm.name.trim()}」与目录名「${dirName}」不一致`);
    if (!fm.description) fails.push('SKILL.md frontmatter 缺 description');
    const descLine = (skillText.match(/^description:.*$/m) || [''])[0];
    if (descLine && !/^description:\s*(>-?|\|-?)/.test(descLine)) {
      fails.push('SKILL.md description 不是块标量（plain scalar 含冒号会让整条技能静默消失）');
    }
    if (!body.trim()) fails.push('SKILL.md 正文为空');
  }

  // ② 五张卡必须存在、链接顺序递增，且六步闭环顺序不被打乱
  let cardCount = 0;
  let linkCount = 0;
  let prevCardIdx = -1;
  for (const c of CARDS) {
    const p = join(dir, 'references', c.file);
    if (!existsSync(p)) { fails.push('缺卡：references/' + c.file); continue; }
    cardCount++;
    const t = readFileSync(p, 'utf8');

    for (const s of (c.full ? 四段 : 示范段)) {
      if (!t.includes(s)) fails.push(`${c.file} 缺「${s}」`);
    }
    for (const w of 禁用措辞) {
      if (t.includes(w)) fails.push(`${c.file} 出现禁用措辞「${w}」`);
    }
    for (const u of links(t)) {
      linkCount++;
      if (!existsSync(resolve(dirname(p), u))) fails.push(`${c.file} → 死链 ${u}`);
    }
    const n = cjk(prose(t));
    if (n < MIN_CJK) fails.push(`${c.file} 正文只有 ${n} 汉字，少于 ${MIN_CJK}（卡太薄，照做不了）`);
    if (n > MAX_CJK) fails.push(`${c.file} 正文 ${n} 汉字，超过 ${MAX_CJK}（在抄规格，应该只引节号）`);

    const idxInSkill = skillText.indexOf(c.file);
    if (idxInSkill < 0) fails.push(`SKILL.md 没有指向 ${c.file} 的链接`);
    else {
      if (idxInSkill < prevCardIdx) fails.push(`SKILL.md 路由卡顺序被打乱：${c.file} 出现在前序卡之前`);
      prevCardIdx = idxInSkill;
    }
  }

  let prevStepIdx = -1;
  for (const step of STEP_ANCHORS) {
    const si = skillText.indexOf(step);
    if (si < 0) fails.push(`SKILL.md 缺少六步固定动作锚点「${step}」`);
    else {
      if (si < prevStepIdx) fails.push(`SKILL.md 六步顺序被打乱：「${step}」位置倒置`);
      prevStepIdx = si;
    }
  }

  for (const u of links(skillText)) {
    linkCount++;
    if (!existsSync(resolve(dirname(skillPath), u))) fails.push(`SKILL.md → 死链 ${u}`);
  }

  return { fails, links: linkCount, cards: cardCount };
}

// ── 1 个好样本 + 7 个必红负样本（逐项破坏，每次必红） ──
function runRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-cards-'));
  let bad = 0;
  const t = (name, cond, extra = '') => { if (cond) console.log('  ✓ ' + name); else { bad++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
  const body = (secs) => secs.join('\n\n') + '\n\n' + '这是一段足够长的正文，用来满足工坊卡的三百汉字下限。'.repeat(16) + '\n';
  const build = (mutate = () => {}) => {
    const d = join(tmp, 'case-' + Math.random().toString(36).slice(2, 8), SKILL_NAME);
    mkdirSync(join(d, 'references'), { recursive: true });
    const cardBody = body(['## 入口条件\n占位', '## 步骤\n占位', '## 出口判据\n占位', '## 延伸阅读\n占位']);
    const linkLines = CARDS.map((c) => '- [references/' + c.file + '](references/' + c.file + ')').join('\n');
    const stepLines = STEP_ANCHORS.map((s) => s + ' 说明。').join('\n');
    const made = {
      'SKILL.md': '---\nname: ' + SKILL_NAME + '\ndescription: >-\n  工坊。\n---\n\n# 工坊\n\n' + linkLines + '\n\n' + stepLines + '\n',
      'references/卡-选型调研.md': cardBody,
      'references/卡-适配器实现.md': cardBody,
      'references/卡-三组必红夹具.md': cardBody,
      'references/卡-准入与登记.md': cardBody,
      'references/卡-首批示范.md': body(['## 出口判据\n占位', '## 延伸阅读\n占位'])
    };
    mutate(made, d);
    for (const [rel, content] of Object.entries(made)) {
      if (content === null) continue;
      writeFileSync(join(d, rel), content);
    }
    return d;
  };

  try {
    const good = build();
    t('好样本：五卡齐、章节齐、六步顺序正确、链接可达 → 0', auditForge(good).fails.length === 0, JSON.stringify(auditForge(good).fails));

    const noCard = build((m) => { delete m['references/卡-准入与登记.md']; });
    t('必红样本 1：缺一张卡 → 必红', auditForge(noCard).fails.some((f) => f.includes('缺卡')));

    const noSection = build((m) => { m['references/卡-适配器实现.md'] = body(['## 入口条件\n占位', '## 步骤\n占位', '## 出口判据\n占位']); });
    t('必红样本 2：卡缺「延伸阅读」→ 必红', auditForge(noSection).fails.some((f) => f.includes('缺「## 延伸阅读」')));

    const deadLink = build((m) => { m['SKILL.md'] += '\n[坏链](./不存在的卡.md)\n'; });
    t('必红样本 3：SKILL.md 有死链 → 必红', auditForge(deadLink).fails.some((f) => f.includes('死链')));

    const plainDesc = build((m) => { m['SKILL.md'] = m['SKILL.md'].replace(/description: >-\n  工坊。/, 'description: 工坊。NOT for: 别的。'); });
    t('必红样本 4：description 不是块标量 → 必红', auditForge(plainDesc).fails.some((f) => f.includes('块标量')));

    const stale = build((m) => { m['references/卡-三组必红夹具.md'] = body(['## 入口条件\n占位', '## 步骤\n占位', '## 出口判据\n占位', '## 延伸阅读\n占位']).replace('这是一段', '五道门 这是一段'); });
    t('必红样本 5：出现禁用措辞「五道门」→ 必红', auditForge(stale).fails.some((f) => f.includes('禁用措辞')));

    const thin = build((m) => { m['references/卡-准入与登记.md'] = '## 入口条件\n## 步骤\n## 出口判据\n## 延伸阅读\n太短。\n'; });
    t('必红样本 6：卡太薄（<300 汉字）→ 必红', auditForge(thin).fails.some((f) => f.includes('少于')));

    const scrambled = build((m) => {
      m['SKILL.md'] = m['SKILL.md']
        .replace('2. **候选调研** 说明。', '__TMP__')
        .replace('5. **三组必红夹具** 说明。', '2. **候选调研** 说明。')
        .replace('__TMP__', '5. **三组必红夹具** 说明。');
    });
    t('必红样本 7：六步闭环顺序被打乱 → 必红', auditForge(scrambled).fails.some((f) => f.includes('顺序被打乱')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const realAudit = auditForge(join(ROOT, SKILL_NAME));
  t('真实工坊目录 donegate-forge/ 校验通过 → 0', realAudit.fails.length === 0, JSON.stringify(realAudit.fails));
  console.log(bad === 0 ? '\nRESULT: PASS 工坊卡自检 + 7 个必红样本全过' : `\nRESULT: FAIL ${bad} 项未过`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--red-self-test') || argv.length === 0) process.exit(runRedSelfTest());
  const i = argv.indexOf('--dir');
  const target = resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : join(ROOT, SKILL_NAME));
  if (!existsSync(target)) { console.error('工坊目录读不出：' + target); process.exit(3); }
  const r = auditForge(target);
  console.log(`审工坊：${target}（卡 ${r.cards}/${CARDS.length}，链接 ${r.links}）`);
  if (r.fails.length === 0) { console.log('RESULT: PASS 工坊技能结构与链接全过'); process.exit(0); }
  for (const f of r.fails) console.log('  ✗ ' + f);
  console.log(`RESULT: FAIL ${r.fails.length} 处不过`);
  process.exit(1);
}
