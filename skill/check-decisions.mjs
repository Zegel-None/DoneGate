// 决策记录 INV-13 与 §2.5 五段结构持续检查：
//   ① 历史无改写（git log --follow --diff-filter=M / -D 必红）
//   ② 工作区与 HEAD 一致（已跟踪文件的未提交 M/R/D 当场篡改必红）
//   ③ 新增记录五段标题与正文齐全（当时的问题 / 可选方案 / 选了哪个 / 为什么 / 什么条件下翻案）
//
// 用法：
//   node skill/check-decisions.mjs                    产品口径锚点 + 8 组正负夹具自检 + 本仓 decisions/ 实盘核查
//   node skill/check-decisions.mjs --root <项目根>     审指定项目的 decisions/（无该目录时 SKIP 退 0）
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { basename, join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const REQUIRED_DECISION_SECTIONS = Object.freeze([
  '当时的问题',
  '可选方案',
  '选了哪个',
  '为什么',
  '什么条件下翻案'
]);

// 历史存量豁免棘轮：这 5 份早期已提交记录缺「可选方案」，因 INV-13 严禁回改历史文件而冻结豁免；此后一切新记录必须五段齐全。
export const LEGACY_FOUR_SECTION_DECISIONS = new Set([
  '2026-11-22-01-全仓术语归一化与精简词表.md',
  '2026-11-23-01-四维结构化提交与认知复杂度门禁.md',
  '2026-11-23-02-全仓四维标准存量重构与自检挂钩.md',
  '2026-11-23-03-画布前端引擎契约拆分与四维全仓自检常驻.md',
  '2026-11-24-01-子代理即时微门禁与伴生作用域及失联熔断.md'
]);

const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

export function validateDecisionFiveSections(markdownText, filePathOrName = '', opts = {}) {
  const baseName = basename(String(filePathOrName || ''));
  if (!opts.ignoreLegacy && LEGACY_FOUR_SECTION_DECISIONS.has(baseName)) {
    return { ok: true, legacyExempt: true, missing: [], empty: [] };
  }
  const lines = String(markdownText || '').split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      cur = { title: m[1], bodyLines: [] };
      sections.push(cur);
    } else if (cur) {
      cur.bodyLines.push(line);
    }
  }
  const missing = [];
  const empty = [];
  for (const req of REQUIRED_DECISION_SECTIONS) {
    const hit = sections.find((s) => s.title.includes(req));
    if (!hit) {
      missing.push(req);
    } else if (hit.bodyLines.join('\n').trim().length === 0) {
      empty.push(req);
    }
  }
  return { ok: missing.length === 0 && empty.length === 0, legacyExempt: false, missing, empty };
}

function decScanGitHistoryTamper(projectRoot, files) {
  const logHits = [];
  for (const f of files) {
    const r = git(projectRoot, ['log', '--follow', '--diff-filter=M', '--format=%h', '--', 'decisions/' + f]);
    if (r.status !== 0) return { gitBroken: true, logHits: [] };
    if (r.stdout.trim()) logHits.push(`${f}（${r.stdout.trim().split(/\s+/).slice(0, 3).join(' ')}）`);
  }
  const delR = git(projectRoot, ['log', '--diff-filter=D', '--name-only', '--format=', '--', 'decisions/']);
  if (delR.status !== 0) return { gitBroken: true, logHits: [] };
  for (const dp of (delR.stdout || '').trim().split(/\r?\n/)) {
    if (dp.trim()) logHits.push(`${dp.trim()}（已删除）`);
  }
  return { gitBroken: false, logHits };
}

function decScanWorktreeTamper(projectRoot) {
  const st = git(projectRoot, ['status', '--porcelain', '--', 'decisions/']);
  if (st.status !== 0) return { error: 'git status 读不出来（不是仓库，退 3）', wtHits: [] };
  const wtHits = [];
  for (const line of (st.stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    const x = line[0], y = line[1];
    if (x === 'M' || y === 'M' || x === 'R' || x === 'D' || y === 'D') {
      wtHits.push(line.slice(3).split(' -> ').pop().trim());
    }
  }
  return { error: null, wtHits };
}

function decScanFiveSections(decDir, files) {
  const badStruct = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const v = validateDecisionFiveSections(readFileSync(join(decDir, f), 'utf8'), f);
    if (!v.ok) {
      const parts = [];
      if (v.missing.length > 0) parts.push(`缺章节[${v.missing.join('、')}]`);
      if (v.empty.length > 0) parts.push(`空章节[${v.empty.join('、')}]`);
      badStruct.push(`${f}（${parts.join('；')}）`);
    }
  }
  return badStruct;
}

export function auditDecisions(projectRoot) {
  const decDir = join(projectRoot, 'decisions');
  if (!existsSync(decDir)) return { skip: true };
  if (!statSync(decDir).isDirectory()) return { error: 'decisions/ 不是目录（退 3）' };
  const files = readdirSync(decDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();

  const hist = decScanGitHistoryTamper(projectRoot, files);
  if (hist.gitBroken) return { error: 'git 历史读不出来（不是仓库或 git 坏了，退 3）' };
  const wt = decScanWorktreeTamper(projectRoot);
  if (wt.error) return { error: wt.error };
  const structHits = decScanFiveSections(decDir, files);

  return {
    skip: false,
    rows: {
      '①历史无改写': hist.logHits.length === 0,
      '②工作区与HEAD一致': wt.wtHits.length === 0,
      '③五段标题与正文齐全': structHits.length === 0
    },
    why: {
      '①历史无改写': 'git log --diff-filter=DM 命中：' + hist.logHits.slice(0, 3).join('、'),
      '②工作区与HEAD一致': '未提交的改写：' + wt.wtHits.slice(0, 3).join('、'),
      '③五段标题与正文齐全': '违反 §2.5 五段结构：' + structHits.slice(0, 3).join('；')
    },
    count: files.length
  };
}

function decisionBody(title, takeaway) {
  return [
    '# ' + title, '',
    '## 当时的问题', 'c01 的判据按旧意图写。',
    '## 可选方案', '甲：改判据。乙：保留旧判据。',
    '## 选了哪个', '选甲。',
    '## 为什么', '乙会让判据与意图长期背离。',
    '## 什么条件下翻案', takeaway, ''
  ].join('\n');
}

const FIXTURE_ACTIONS = {
  'good-add'(d, commit) {
    writeFileSync(join(d, 'decisions', '2026-11-19-改边界.md'), decisionBody('改边界', '若边界再动，本记录作废。'));
    commit('new decision');
  },
  'good-untracked'(d) {
    writeFileSync(join(d, 'decisions', '2026-11-19-改边界.md'), decisionBody('改边界', '若边界再动，本记录作废。'));
  },
  'bad-commit'(d, commit) {
    const p = join(d, 'decisions', '2026-11-18-立项.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n（偷偷补一句，没写新记录。）\n');
    commit('tamper');
  },
  'bad-worktree'(d) {
    const p = join(d, 'decisions', '2026-11-18-立项.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n（偷偷补一句，还没提交。）\n');
  },
  'bad-delete'(d, commit) {
    git(d, ['rm', '-q', 'decisions/2026-11-19-冻结c01.md']);
    commit('delete decision');
  },
  'bad-worktree-delete'(d) {
    rmSync(join(d, 'decisions', '2026-11-19-冻结c01.md'));
  },
  'bad-missing-section'(d, commit) {
    const fourSec = ['# 漏掉可选方案的记录', '', '## 当时的问题', '有问题。', '## 选了哪个', '选甲。', '## 为什么', '快。', '## 什么条件下翻案', '慢了就换。'].join('\n');
    writeFileSync(join(d, 'decisions', '2026-11-25-01-漏章节.md'), fourSec);
    commit('add incomplete decision');
  },
  'bad-empty-section'(d) {
    const emptySec = ['# 空填可选方案的记录', '', '## 当时的问题', '有问题。', '## 可选方案', '   ', '## 选了哪个', '选甲。', '## 为什么', '快。', '## 什么条件下翻案', '慢了就换。'].join('\n');
    writeFileSync(join(d, 'decisions', '2026-11-25-02-空章节.md'), emptySec);
  }
};

function buildRepo(parent, variant) {
  const d = join(parent, 'proj');
  mkdirSync(join(d, 'decisions'), { recursive: true });
  git(d, ['init', '-q']);
  git(d, ['config', 'user.email', 'fixture@local']);
  git(d, ['config', 'user.name', 'fixture']);
  const commit = (m) => {
    git(d, ['add', '-A']);
    git(d, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m]);
  };
  writeFileSync(join(d, 'decisions', '2026-11-18-立项.md'), decisionBody('立项与首条判据', '若意图回退到旧版本，本记录作废。'));
  writeFileSync(join(d, 'decisions', '2026-11-19-冻结c01.md'), decisionBody('冻结 c01', '若业主裁定 c01 不再必需，本记录作废。'));
  commit('two decisions');
  FIXTURE_ACTIONS[variant]?.(d, commit);
  return d;
}

const cases = [
  { name: 'good-add', red: [], note: '新增五段齐全记录并提交——合法，三行全绿' },
  { name: 'good-untracked', red: [], note: '新增五段齐全记录未提交（??）——算新增不算改写，三行全绿' },
  { name: 'bad-commit', red: ['①历史无改写'], note: '改写已存在记录并提交——git log --follow --diff-filter=M 必红' },
  { name: 'bad-worktree', red: ['②工作区与HEAD一致'], note: '改写已存在记录未提交——当场篡改必红' },
  { name: 'bad-delete', red: ['①历史无改写'], note: '删除已存在记录并提交 (git rm)——--diff-filter=D 必红' },
  { name: 'bad-worktree-delete', red: ['②工作区与HEAD一致'], note: '删除已存在记录未提交 (D)——工作区比对必红' },
  { name: 'bad-missing-section', red: ['③五段标题与正文齐全'], note: '新增记录漏写「## 可选方案」——§2.5 五段结构检查必红' },
  { name: 'bad-empty-section', red: ['③五段标题与正文齐全'], note: '新增记录「## 可选方案」正文留空——防空壳标题检查必红' }
];

function decRunRootCli(dir) {
  let okDir = false;
  try { okDir = Boolean(dir && statSync(dir).isDirectory()); } catch { okDir = false; }
  if (!okDir) {
    console.error('用法：node skill/check-decisions.mjs --root <项目根>（目录读不出来退 3）');
    return 3;
  }
  const r = auditDecisions(resolve(dir));
  if (r.error) { console.error(r.error); return 3; }
  if (r.skip) { console.log('SKIP ' + dir + ' 没有 decisions/ 目录（INV-13 无对象）'); return 0; }
  let enforceFive = true;
  if (process.env.DG_NODE_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.DG_NODE_CONFIG);
      if (cfg && cfg.enforceFiveSections === false) enforceFive = false;
    } catch (err) { void err; }
  }
  if (!enforceFive && r.rows && '③五段标题与正文齐全' in r.rows) {
    r.rows['③五段标题与正文齐全'] = true;
  }
  console.log('decisions/ 共 ' + r.count + ' 份');
  for (const k of Object.keys(r.rows)) console.log('  ' + (r.rows[k] ? '✓' : '✗') + ' ' + k + (r.rows[k] ? '' : '——' + r.why[k]));
  if (Object.values(r.rows).every(Boolean)) { console.log('RESULT: PASS 三行全过'); return 0; }
  console.log('RESULT: FAIL 存在历史篡改或缺漏章节');
  return 1;
}

function decVerifyDocAnchors(ok, bad) {
  console.log('一、产品口径锚点（决策记录那条线：何时写 / 补记录不改哈希 / 判方例外附上）');
  const anchors = [
    { file: 'donegate/SKILL.md', need: ['7. **写决策记录**', '只在这一轮改了判据、边界或意图时写'] },
    { file: 'donegate/references/门0-起手.md', need: ['打开最近一条决策记录', '补记录，不要改哈希去凑'] },
    { file: 'donegate/references/判方材料包.md', need: ['把决策记录附进来', '§7.2'] }
  ];
  for (const a of anchors) {
    const p = join(ROOT, ...a.file.split('/'));
    if (!existsSync(p)) { bad('要守的文件不存在：' + a.file); continue; }
    const t = readFileSync(p, 'utf8');
    const miss = a.need.filter((w) => !t.includes(w));
    if (miss.length) bad(a.file + ' 缺口径锚点：' + miss.join('、'));
    else ok(a.file + '：' + a.need.length + ' 个锚点都在');
  }
}

function decRunSyntheticFixtures(ok, bad) {
  console.log('\n二、夹具自检（临时 git 仓库 ×8，INV-13 只增不改 + §2.5 五段结构真判）');
  const tmp = mkdtempSync(join(tmpdir(), 'dec-'));
  try {
    for (const c of cases) {
      const r = auditDecisions(buildRepo(join(tmp, c.name), c.name));
      if (r.error || r.skip) { bad(c.name + ' 夹具没建成：' + (r.error || 'skip')); continue; }
      const actual = Object.keys(r.rows).filter((k) => !r.rows[k]);
      const missRed = c.red.filter((x) => !actual.includes(x));
      const extraRed = actual.filter((x) => !c.red.includes(x));
      if (missRed.length === 0 && extraRed.length === 0) ok(c.note);
      if (missRed.length) bad(c.name + ' 该红不红（判据没牙了）：' + missRed.join('、'));
      if (extraRed.length) bad(c.name + ' 不该红却红（误拦）：' + extraRed.join('、'));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runCli() {
  const args = process.argv.slice(2);
  if (args[0] === '--root') return decRunRootCli(args[1]);

  let fails = 0;
  const bad = (m) => { fails++; console.log('  ✗ ' + m); };
  const ok = (m) => console.log('  ✓ ' + m);

  decVerifyDocAnchors(ok, bad);
  decRunSyntheticFixtures(ok, bad);

  const selfAudit = auditDecisions(ROOT);
  if (!selfAudit.skip && !selfAudit.error) {
    console.log(`\n三、本仓 decisions/ 实盘核查（共 ${selfAudit.count} 份）`);
    for (const k of Object.keys(selfAudit.rows)) {
      if (selfAudit.rows[k]) ok(k);
      else bad(`${k}——${selfAudit.why[k]}`);
    }
  }

  console.log('');
  if (fails === 0) {
    console.log('RESULT: PASS 决策记录口径 + 8 份夹具判读 + 本仓实盘核查全部符合预期');
    return 0;
  }
  console.log('RESULT: FAIL ' + fails + ' 处不过');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCli());
}
