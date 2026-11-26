// 零依赖 contract.json Schema 校验器（D10 · 禁 ajv/zod，≤80 行；规格 §2.3/§2.4 + G-01/03/06/10/11）。
// 用法：node skill/schema-lite.mjs <contract.json> [--runner] ｜ 退出码：0 通过 / 2 结构或 JSON 损坏 / 3 参数或文件读不出。
// 诚实边界：只校验字段存在、类型与枚举，不核 frozenHash 真伪、目录名匹配或语义对齐（门 2/门 5 管）。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, nonEmpty = false) => typeof v === 'string' && (!nonEmpty || v.trim().length > 0);
const isStrArr = (v, nonEmpty = false) => Array.isArray(v) && (!nonEmpty || v.length > 0) && v.every((x) => isStr(x, true));
const INPUT_CLASSES = new Set(['正常', '边界', '异常']);
const TRACK_VALUES = new Set(['delivery', 'explore']);
const SANDBOX_MODES = new Set(['worktree', 'host-local']);

function validateExecutionBlock(exec, pushErr) {
  if (!isObj(exec)) { pushErr('/execution', 'expected object'); return; }
  if (exec.sandbox !== undefined && !SANDBOX_MODES.has(exec.sandbox)) pushErr('/execution/sandbox', 'expected worktree | host-local');
  for (const k of ['resourceLocks', 'envPassthrough']) if (exec[k] !== undefined && !isStrArr(exec[k])) pushErr(`/execution/${k}`, 'expected string[]');
  if (exec.preFlightPlug !== undefined && !isStr(exec.preFlightPlug, true)) pushErr('/execution/preFlightPlug', 'expected non-empty string');
  if (exec.operatorVisualCheck !== undefined && typeof exec.operatorVisualCheck !== 'boolean') pushErr('/execution/operatorVisualCheck', 'expected boolean');
}

export function validateContractSchema(doc, opts = {}) {
  const isExplore = doc && typeof doc === 'object' && doc.track === 'explore';
  const full = opts.full !== false && !isExplore;
  const errs = [];
  const pushErr = (ptr, msg) => errs.push(`${ptr}: ${msg}`);
  if (!isObj(doc)) return ['/ : expected contract JSON object'];
  const topReq = full ? ['id', 'title', 'why', 'scope', 'obligations', 'owner', 'provisional'] : ['id', 'obligations'];
  for (const k of topReq) if (doc[k] === undefined) pushErr('/' + k, 'missing required field');
  if (doc.id !== undefined && !isStr(doc.id, true)) pushErr('/id', 'expected non-empty string');
  for (const k of ['title', 'why', 'owner', 'skipReason']) if (doc[k] !== undefined && !isStr(doc[k], k !== 'skipReason')) pushErr('/' + k, 'expected string');
  if (doc.track !== undefined && !TRACK_VALUES.has(doc.track)) pushErr('/track', 'expected delivery | explore');
  if (doc.exploreMeta !== undefined && !isObj(doc.exploreMeta)) pushErr('/exploreMeta', 'expected object');
  if (doc.execution !== undefined) validateExecutionBlock(doc.execution, pushErr);
  if (doc.provisional !== undefined && typeof doc.provisional !== 'boolean') pushErr('/provisional', 'expected boolean');
  for (const k of ['scope', 'dependsOn', 'overlapsWith']) if (doc[k] !== undefined && !isStrArr(doc[k], k === 'scope')) pushErr('/' + k, 'expected string[]');
  if (doc.retired !== undefined && !isObj(doc.retired)) pushErr('/retired', 'expected object');
  if (doc.obligations !== undefined && (!Array.isArray(doc.obligations) || doc.obligations.length === 0)) pushErr('/obligations', 'expected non-empty array');
  const obReq = full ? ['id', 'kind', 'expect', 'frozenHash', 'signedBy', 'required', 'claim', 'observable', 'scope', 'inputClasses', 'servesSuccessCriterion'] : ['id', 'kind', 'expect'];
  for (let i = 0; Array.isArray(doc.obligations) && i < doc.obligations.length; i++) {
    const o = doc.obligations[i], p = `/obligations/${i}`;
    if (!isObj(o)) { pushErr(p, 'expected object'); continue; }
    for (const k of obReq) if (o[k] === undefined) pushErr(`${p}/${k}`, 'missing required field');
    if (o.id !== undefined && !isStr(o.id, true)) pushErr(`${p}/id`, 'expected non-empty string');
    if (o.kind !== undefined && o.kind !== 'command' && o.kind !== 'human') pushErr(`${p}/kind`, 'expected command | human');
    if (o.kind === 'command' && !isStr(o.command, true)) pushErr(`${p}/command`, 'expected non-empty command string');
    if (o.required !== undefined && typeof o.required !== 'boolean') pushErr(`${p}/required`, 'expected boolean');
    if (o.timeoutSec !== undefined && (typeof o.timeoutSec !== 'number' || o.timeoutSec <= 0)) pushErr(`${p}/timeoutSec`, 'expected positive number');
    for (const k of ['frozenHash', 'signedBy', 'claim', 'observable', 'scope', 'servesSuccessCriterion']) if (o[k] !== undefined && !isStr(o[k], k !== 'signedBy' || full)) pushErr(`${p}/${k}`, 'expected string');
    if (o.inputClasses !== undefined && (!isStrArr(o.inputClasses, true) || o.inputClasses.some((c) => !INPUT_CLASSES.has(c)))) pushErr(`${p}/inputClasses`, 'expected 正常|边界|异常 array');
    if (o.spansContracts !== undefined && !isStrArr(o.spansContracts)) pushErr(`${p}/spansContracts`, 'expected string[]');
    if (o.scopeAck !== undefined && (!isObj(o.scopeAck) || !isStr(o.scopeAck.by, true) || !isStr(o.scopeAck.at, true))) pushErr(`${p}/scopeAck`, 'expected { by, at }');
    if (o.expect !== undefined) {
      if (!isObj(o.expect)) pushErr(`${p}/expect`, 'expected object');
      else if (o.kind === 'command') {
        if (typeof o.expect.exitCode !== 'number' || !Number.isInteger(o.expect.exitCode)) pushErr(`${p}/expect/exitCode`, 'expected integer');
        if (o.expect.stdoutMatches !== undefined && typeof o.expect.stdoutMatches !== 'string') pushErr(`${p}/expect/stdoutMatches`, 'expected string');
        if (o.expect.standard !== undefined) pushErr(`${p}/expect/standard`, 'forbidden on command obligation (G-06)');
      } else if (o.kind === 'human') {
        if (!isStr(o.expect.standard, true)) pushErr(`${p}/expect/standard`, 'expected non-empty string');
        if (o.expect.exitCode !== undefined) pushErr(`${p}/expect/exitCode`, 'forbidden on human obligation (G-06)');
      }
    }
  }
  return errs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) { console.error('用法：node skill/schema-lite.mjs <contract.json> [--runner]'); process.exit(3); }
  const res = readJsonStrict(resolve(target));
  if (!res.ok) {
    console.error(res.error === 'parse' ? 'RESULT: 事故 JSON 损坏：' + target : 'RESULT: 无法判断 契约读不出：' + target);
    process.exit(res.error === 'parse' ? 2 : 3);
  }
  const errs = validateContractSchema(res.value, { full: !argv.includes('--runner') });
  if (errs.length) {
    for (const e of errs) console.error('  ✗ ' + e);
    console.log('RESULT: FAIL schema 校验不通过（退 2）');
    process.exit(2);
  }
  console.log('RESULT: PASS schema 校验通过');
  process.exit(0);
}
