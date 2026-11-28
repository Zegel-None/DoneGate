// 孤儿计数持续检查（判方线收尾三）：INV-17 两向计数 + INV-18 source + functions 文件名=id。
// 用法：
//   node skill/check-orphans.mjs                 默认：卡口径守卫 + 夹具自检（常跑，约 1 秒）
//   node skill/check-orphans.mjs --root <项目根>  审真实项目的 contracts/ × functions/
// 退出码（§八 四值）：0 通过（孤儿＝0 或全部如实列出才算过——见下）；1 有红；3 读不出。
//
// 守什么：
//   INV-17：每个契约挂至少一个功能、每个功能挂至少一个契约；
//   **退役契约（retired 非空）不进任何计数**（与状态与功能树卡规则一致）；
//   INV-18：source 空或含「基于分析/根据规范/从代码推断」脑补词即红；
//   functions 命名一致性：functions/<id>.json 文件名去后缀必须严格等于条目内 id 字段。
// 诚实边界：本判据数得出孤儿并点名，**不替人决定孤儿该挂到哪**（该挂哪个功能是人的业务判断，
//   状态与功能树卡步骤 3 的原话）；--root 模式下有孤儿即红并全部列出。

import { writeFileSync, existsSync, statSync, readdirSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMaybe, readJson } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function corLoadContracts(projectRoot) {
  const cDir = join(projectRoot, 'contracts');
  if (!existsSync(cDir)) return [];
  const contracts = [];
  for (const e of readdirSync(cDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const j = readJson(join(cDir, e.name, 'contract.json'));
    if (j && j.id) {
      contracts.push({
        id: j.id,
        role: j.role === 'infra' ? 'infra' : 'product',
        retired: (typeof j.retired === 'string' && j.retired.trim() !== '') || Boolean(j.retired && typeof j.retired === 'object')
      });
    }
  }
  return contracts;
}

function corLoadFunctions(projectRoot) {
  const fDir = join(projectRoot, 'functions');
  if (!existsSync(fDir)) return [];
  const functions = [];
  for (const e of readdirSync(fDir)) {
    if (!e.endsWith('.json')) continue;
    const j = readJson(join(fDir, e));
    if (j) {
      functions.push({
        file: e.replace(/\.json$/, ''),
        id: j.id,
        contracts: Array.isArray(j.contracts) ? j.contracts : null,
        source: typeof j.source === 'string' ? j.source : ''
      });
    }
  }
  return functions;
}

function corIsOrphanFunction(fnItem, knownContractIds) {
  if (!fnItem.contracts || fnItem.contracts.length === 0) return true;
  return fnItem.contracts.some((c) => !knownContractIds.has(c));
}

function corCheckSourceCompliance(functions, rows, why) {
  const badSrc = functions.filter(
    (f) => f.source.trim() === '' || /(基于分析|根据规范|从代码推断|总结|概括)/.test(f.source)
  );
  rows['④source 合规'] = badSrc.length === 0;
  if (badSrc.length) {
    const prefix = badSrc[0].source.trim() === '' ? 'source 为空：' : '转述顶替原话：';
    why['④source 合规'] = prefix + badSrc.map((f) => f.id || f.file).join('、');
  }
}

// 审一个项目根的 contracts/ × functions/：四行布尔 + 孤儿点名
function auditOrphans(projectRoot) {
  const rows = {};
  const why = {};
  const contracts = corLoadContracts(projectRoot);
  const functions = corLoadFunctions(projectRoot);

  // ① 孤儿契约（未登记功能）：没被任何 functions[].contracts 引用、且未退役
  const referenced = new Set(functions.flatMap((f) => f.contracts || []));
  const orphanC = contracts.filter((c) => !referenced.has(c.id) && !c.retired && c.role !== 'infra');
  rows['①契约无孤儿'] = orphanC.length === 0;
  if (orphanC.length) why['①契约无孤儿'] = '未登记功能：' + orphanC.map((c) => c.id).join('、');

  // ② 孤儿功能（声明了没做）：contracts 为空、或引用不存在的契约
  const known = new Set(contracts.map((c) => c.id));
  const orphanF = functions.filter((f) => corIsOrphanFunction(f, known));
  rows['②功能无孤儿'] = orphanF.length === 0;
  if (orphanF.length) why['②功能无孤儿'] = '声明了没做：' + orphanF.map((f) => f.id || f.file).join('、');

  // ③ 文件名 = id
  const badName = functions.filter((f) => f.id && f.file !== f.id);
  rows['③文件名=id'] = badName.length === 0;
  if (badName.length) why['③文件名=id'] = badName.map((f) => f.file + '≠' + f.id).join('、');

  // ④ source 合规（INV-18）
  corCheckSourceCompliance(functions, rows, why);

  const order = ['①契约无孤儿', '②功能无孤儿', '③文件名=id', '④source 合规'];
  const fails = order.filter((k) => rows[k] === false).map((k) => k + '：' + why[k]);
  return { rows, why, fails, order, orphanC, orphanF };
}

// —— 夹具：五个变体（含「退役不计」这条 §2.3 细节）——
function buildCase(dir, variant) {
  const src = '业主原话：同一时段不出现两条同键记录。';
  const c = (id, extra) => {
    mkdirSync(join(dir, 'contracts', id), { recursive: true });
    writeFileSync(
      join(dir, 'contracts', id, 'contract.json'),
      JSON.stringify({ id, ...(extra || {}) }, null, 2)
    );
  };
  const f = (name, obj) => {
    mkdirSync(join(dir, 'functions'), { recursive: true });
    writeFileSync(
      join(dir, 'functions', name + '.json'),
      JSON.stringify({ id: name, source: src, ...(obj || {}) }, null, 2)
    );
  };
  if (variant === 'good') {
    c('quchong');
    c('yuebao');
    f('fenye', { contracts: ['quchong'] });
    f('yuebao-kuang', { contracts: ['yuebao'], source: src });
  }
  if (variant === 'orphan-c') {
    c('quchong');
    c('yuebao');
    c('gudan');
    f('fenye', { contracts: ['quchong'] });
    f('yuebao-kuang', { contracts: ['yuebao'], source: src });
  }
  if (variant === 'orphan-f') {
    c('quchong');
    f('fenye', { contracts: ['quchong'] });
    f('xuan-kong', { contracts: [] });
  }
  if (variant === 'retired') {
    c('quchong');
    c('yuebao');
    c('tuoyi', { retired: '2026-11-19 被月报新流程替代' });
    c('dizuo', { role: 'infra' });
    f('fenye', { contracts: ['quchong'] });
    f('yuebao-kuang', { contracts: ['yuebao'], source: src });
  }
  if (variant === 'badname') {
    c('quchong');
    f('fenye', { id: 'fenye-2026', contracts: ['quchong'] });
  }
  if (variant === 'badsource') {
    c('quchong');
    f('fenye', { contracts: ['quchong'], source: '基于分析得出该功能存在。' });
  }
}

const cases = [
  { name: 'good', hits: [], note: '好样本：两契约两功能全挂上——四行全绿' },
  { name: 'orphan-c', hits: ['①契约无孤儿'], note: '孤儿契约（gudan 未挂任何功能）必红且点名' },
  { name: 'orphan-f', hits: ['②功能无孤儿'], note: '孤儿功能（contracts 空数组＝声明了没做）必红' },
  { name: 'retired', hits: [], note: '退役契约（retired 非空）不进计数——§2.3 细节：tuoyi 无人挂也绿' },
  { name: 'badname', hits: ['③文件名=id'], note: '文件名≠id（fenye.json 里 id 是 fenye-2026）必红' },
  { name: 'badsource', hits: ['④source 合规'], note: '「基于分析」顶替原话必红（INV-18）' }
];

const args = process.argv.slice(2);
if (args[0] === '--root') {
  const dir = args[1];
  let okDir = false;
  try { okDir = !!dir && statSync(dir).isDirectory(); } catch { okDir = false; }
  if (!okDir) { console.error('用法：node skill/check-orphans.mjs --root <项目根>（读不出退 3）'); process.exit(3); }
  const r = auditOrphans(resolve(dir));
  for (const k of r.order) console.log('  ' + (r.rows[k] ? '✓' : '✗') + ' ' + k + (r.rows[k] ? '' : '——' + r.why[k]));
  if (r.fails.length === 0) { console.log('RESULT: PASS 四行全过（孤儿 ' + r.orphanC.length + '/' + r.orphanF.length + '）'); process.exit(0); }
  console.log('RESULT: FAIL ' + r.fails.length + ' 行红（孤儿 ' + r.orphanC.length + '/' + r.orphanF.length + '）——孤儿该挂到哪由人判，本判据只点名'); process.exit(1);
}

let fails = 0;
const bad = (m) => { fails++; console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

console.log('一、卡口径（状态与功能树 × 模板-functions）');
const anchors = [
  { file: 'donegate/references/状态与功能树.md', need: ['未登记功能', '孤儿契约逐条列清单', '`retired` 为空', '§17.3 最差的在上'] },
  { file: 'donegate/references/模板-functions.json.md', need: ['与文件名一致', '空即红', '声明了没做'] }
];
for (const a of anchors) {
  const t = readMaybe(join(ROOT, ...a.file.split('/')));
  if (!t) { bad('要守的卡不存在：' + a.file); continue; }
  const miss = a.need.filter((w) => !t.includes(w));
  if (miss.length) bad(a.file + ' 缺口径锚点：' + miss.join('、'));
  else ok(a.file + '：' + a.need.length + ' 个锚点都在');
}

console.log('\n二、夹具自检（内存构造 6 份项目，落临时目录跑真审计）');
const tmp = mkdtempSync(join(tmpdir(), 'orph-'));
try {
  for (const c of cases) {
    const d = join(tmp, c.name);
    mkdirSync(d, { recursive: true });
    buildCase(d, c.name);
    const r = auditOrphans(d);
    const reds = r.order.filter((k) => r.rows[k] === false);
    const same = reds.length === c.hits.length && c.hits.every((h) => reds.includes(h));
    if (same) ok(c.note);
    else bad(c.name + ' 判读不符：实际红 [' + reds.join('、') + ']，预期 [' + c.hits.join('、') + ']');
  }
  const rootFailDir = join(tmp, 'orphan-c');
  const rootRes = spawnSync(process.execPath, [join(HERE, 'check-orphans.mjs'), '--root', rootFailDir], { encoding: 'utf8' });
  if (rootRes.status === 1 && (rootRes.stdout || '').includes('孤儿 1/0')) ok('--root 实跑孤儿动态计数（1/0）且退 1');
  else bad('--root 动态计数或退码不符：status=' + rootRes.status + ' out=' + (rootRes.stdout || '').trim());
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log('');
if (fails === 0) { console.log('RESULT: PASS 孤儿口径 + 6 份夹具判读全部符合预期'); process.exit(0); }
console.log('RESULT: FAIL ' + fails + ' 处不过');
process.exit(1);
