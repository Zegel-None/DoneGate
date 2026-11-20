// arch-grower 图的核对：绑定 + 指纹 + 探针（状态由退出码现算）。
// 用法：
//   node skill/check-arch-graph.mjs              # 全跑：绑定 → 指纹 → 探针
//   node skill/check-arch-graph.mjs --no-probe   # 只跑绑定与指纹（改图时用，快）
//   node skill/check-arch-graph.mjs --sync       # 人确认后重记指纹（探针不过就拒绝）
//   node skill/check-arch-graph.mjs --graph <path>
// 退出码：0 全过或没有图（SKIP）；1 有不合格；2 图/探针表读不出来
//
// 三层含义（从「我说」到「跑出来的」）：
//   1. 绑定：solid 必须绑仓库内真实文件；hole/fog 不许绑；连线不许空或 TBD。
//   2. 指纹：记下确认时那份文件的 sha256；文件一变就是过期（INV-07 的落点）。
//   3. 探针：solid 还必须挂一条能跑的探针（.arch/probes.json），退出码 0 才算数。
//      没有探针的节点不许是 solid——要么挂探针，要么降级成 hole。
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256 } from './hash.mjs';
import { relTo } from './io.mjs';
const sha = sha256;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const gi = argv.indexOf('--graph');
const SYNC = argv.includes('--sync');
const NO_PROBE = argv.includes('--no-probe');
const graphPath = gi >= 0 && argv[gi + 1] ? resolve(argv[gi + 1]) : join(ROOT, '.arch', 'graph.json');
const bindPath = join(dirname(graphPath), 'bindings.json');
const probePath = join(dirname(graphPath), 'probes.json');

if (!existsSync(graphPath)) {
  console.log('SKIP 没有 ' + relTo(ROOT, graphPath) + '（本仓库未启用 arch-grower 图）');
  process.exit(0);
}

let g;
try { g = JSON.parse(readFileSync(graphPath, 'utf8')); }
catch (e) { console.log('RESULT: FAIL 图读不出来：' + e.message); process.exit(2); }
const nodes = Array.isArray(g.nodes) ? g.nodes : [];
const edges = Array.isArray(g.edges) ? g.edges : [];

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

// ── 1. 绑定 ──
const 状态 = { solid: 0, hole: 0, fog: 0 };
const 待记 = new Map();
for (const n of nodes) {
  const id = n.id || '(无 id)';
  const st = n.status || '(无 status)';
  状态[st] = (状态[st] || 0) + 1;
  const fp = typeof n.file_path === 'string' ? n.file_path.trim() : '';
  if (st === 'solid') {
    if (!fp) { bad(id + ' 标了 solid，但没绑实现文件（file_path 为空）'); continue; }
    const abs = isAbsolute(fp) ? fp : join(ROOT, fp);
    if (!existsSync(abs)) { bad(id + ' 绑的文件不存在：' + fp); continue; }
    if (statSync(abs).isDirectory()) { bad(id + ' 绑的是目录不是文件：' + fp); continue; }
    if (relative(ROOT, abs).startsWith('..')) { bad(id + ' 绑的文件在仓库之外：' + fp); continue; }
    待记.set(id, { file_path: fp, sha256: sha(readFileSync(abs)) });
  } else if (st === 'hole' || st === 'fog') {
    // 降级后 arch-grower 不会清 file_path（它没有「解绑」命令，也不许手改 graph.json），
    // 所以这里只提示、不判红：状态已经是待定了，留着绑定是「降级前的记录」，不构成假装。
    if (fp) console.log('  · 提示：' + id + ' 是 ' + st + '，但仍留着降级前的绑定：' + fp);
  } else {
    bad(id + ' 的状态「' + st + '」不是 solid / hole / fog 之一');
  }
}
for (const e of edges) {
  const c = typeof e.contract === 'string' ? e.contract.trim() : '';
  if (!c || c === 'TBD') bad('连线 ' + e.from + ' → ' + e.to + ' 没有契约（空或 TBD）');
}

// ── 2. 指纹 ──
let rec = { version: 1, updated: '', bindings: {} };
if (existsSync(bindPath)) {
  try { rec = JSON.parse(readFileSync(bindPath, 'utf8')); } catch { bad('bindings.json 读不出来，删掉重跑 --sync'); }
}
const old = rec.bindings || {};

// ── 3. 探针 ──
let probes = {};
if (existsSync(probePath)) {
  try { probes = JSON.parse(readFileSync(probePath, 'utf8')).probes || {}; }
  catch { bad('probes.json 读不出来'); }
}
const solidIds = [...待记.keys()];
const 缺探针 = solidIds.filter((id) => !Array.isArray(probes[id]) || probes[id].length === 0);
if (!NO_PROBE) {
  for (const id of 缺探针) bad(id + ' 没有探针——没跑过的节点不能算 solid，挂探针或降级成 hole');
} else if (缺探针.length) {
  console.log('  · 跳过探针检查：' + 缺探针.length + ' 个 solid 没挂探针');
}

// 去重后逐个跑，一条命令只跑一次
const results = new Map();
if (!NO_PROBE) {
  const cmds = new Map(); // key → {cmd, nodes:[]}
  for (const id of solidIds) {
    for (const c of probes[id] || []) {
      const key = JSON.stringify(c);
      if (!cmds.has(key)) cmds.set(key, { c, nodes: [] });
      cmds.get(key).nodes.push(id);
    }
  }
  for (const [key, { c, nodes: list }] of cmds) {
    if (JSON.stringify(c).includes('check-arch-graph')) {
      bad('探针引用了 check-arch-graph 自己（会递归）：' + key);
      continue;
    }
    const [bin, ...args] = c;
    const t0 = Date.now();
    const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const ms = Date.now() - t0;
    const code = r.status === null ? -1 : r.status;
    results.set(key, { code, ms, nodes: list, out: (r.stdout || '') + (r.stderr || '') });
    if (code !== 0) {
      bad('探针失败：' + c.join(' ') + '（exit=' + code + '；影响节点：' + list.join('、') + '）');
      const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' / ');
      if (tail) console.log('      ↳ ' + tail.slice(0, 200));
    }
  }
}

// ── --sync：只在「探针全绿」时记账 ──
if (SYNC) {
  if (fails > 0) {
    console.log('RESULT: FAIL 有 ' + fails + ' 处不合格，拒绝记账（先修好再 --sync）');
    process.exit(1);
  }
  const out = { version: 1, updated: new Date().toISOString(), bindings: {} };
  for (const [id, v] of [...待记.entries()].sort()) out.bindings[id] = { ...v, at: new Date().toISOString() };
  mkdirSync(dirname(bindPath), { recursive: true });
  writeFileSync(bindPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('已记录 ' + 待记.size + ' 条指纹 → ' + relTo(ROOT, bindPath));
  console.log('RESULT: PASS 指纹已同步（此后文件一改、或探针一红，默认核对就会红）');
  process.exit(0);
}

// ── 指纹核对 ──
let 已核 = 0;
for (const [id, v] of 待记) {
  const o = old[id];
  if (!o) { bad(id + ' 没有指纹记录——先跑一次 --sync（人确认过再跑）'); continue; }
  if (o.file_path !== v.file_path) { bad(id + ' 改绑了文件（' + o.file_path + '→' + v.file_path + '），旧指纹作废'); continue; }
  if (o.sha256 !== v.sha256) { bad(id + ' 绑的文件已经变了（' + v.file_path + '），节点该算过期：确认后 --sync'); continue; }
  已核++;
}
// 陈旧记录只在核对时报；--sync 本来就要重建，不该因此拒绝记账
if (!SYNC) for (const id of Object.keys(old)) if (!待记.has(id)) bad('指纹记录里有 ' + id + '，但图上没有这个 solid 节点了——重跑 --sync 清掉');

// ── 汇总 ──
console.log('');
console.log('图：' + nodes.length + ' 节点（solid ' + 状态.solid + ' / hole ' + 状态.hole + ' / fog ' + 状态.fog + '）· ' + edges.length + ' 条边');
console.log('已核指纹：' + 已核 + ' / ' + 状态.solid);
if (!NO_PROBE) {
  const ran = [...results.values()];
  console.log('探针：' + ran.length + ' 条命令，全绿 ' + ran.filter((r) => r.code === 0).length
    + '；按 solid 算有探针覆盖 ' + solidIds.filter((id) => (probes[id] || []).length).length + ' / ' + 状态.solid
    + '；最慢 ' + Math.max(0, ...ran.map((r) => r.ms)) + ' ms');
}
if (fails === 0) {
  ok('solid 都有真实文件 + 未变指纹 + 探针全绿；未决/暂缓没有乱绑；连线都有契约');
  console.log('RESULT: PASS 绑定 / 指纹 / 探针 三层全过');
  process.exit(0);
}
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
