// 零依赖 contract.json Schema 校验器（D10 · 禁 ajv/zod，≤160 行；规格 §2.3/§2.4 + G-01/03/06/10/11）。
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

const isBool = (v) => typeof v === 'boolean';
const isPosNum = (v) => typeof v === 'number' && v > 0;
const isInputClasses = (v) => isStrArr(v, true) && v.every((c) => INPUT_CLASSES.has(c));
const isScopeAck = (v) => isObj(v) && isStr(v.by, true) && isStr(v.at, true);

function checkRequiredKeys(obj, keys, prefix, pushErr) {
  for (const k of keys) {
    if (obj[k] === undefined) pushErr(`${prefix}/${k}`, 'missing required field');
  }
}

function checkOptionalRules(obj, rules, prefix, pushErr) {
  for (const [k, ok, msg] of rules) {
    if (obj[k] !== undefined && !ok(obj[k])) pushErr(`${prefix}/${k}`, msg);
  }
}

function validateExecutionBlock(exec, pushErr) {
  if (!isObj(exec)) {
    pushErr('/execution', 'expected object');
    return;
  }
  checkOptionalRules(exec, [
    ['sandbox', (v) => SANDBOX_MODES.has(v), 'expected worktree | host-local'],
    ['resourceLocks', isStrArr, 'expected string[]'],
    ['envPassthrough', isStrArr, 'expected string[]'],
    ['preFlightPlug', (v) => isStr(v, true), 'expected non-empty string'],
    ['operatorVisualCheck', isBool, 'expected boolean']
  ], '/execution', pushErr);
}

function validateExpectBlock(o, p, pushErr) {
  if (o.expect === undefined) return;
  if (!isObj(o.expect)) {
    pushErr(`${p}/expect`, 'expected object');
    return;
  }
  if (o.kind === 'command') {
    if (!Number.isInteger(o.expect.exitCode)) pushErr(`${p}/expect/exitCode`, 'expected integer');
    checkOptionalRules(o.expect, [
      ['stdoutMatches', (v) => typeof v === 'string', 'expected string'],
      ['standard', () => false, 'forbidden on command obligation (G-06)']
    ], `${p}/expect`, pushErr);
  } else if (o.kind === 'human') {
    if (!isStr(o.expect.standard, true)) pushErr(`${p}/expect/standard`, 'expected non-empty string');
    if (o.expect.exitCode !== undefined) pushErr(`${p}/expect/exitCode`, 'forbidden on human obligation (G-06)');
  }
}

function validateSingleObligation(o, p, full, obReq, seenObIds, pushErr) {
  if (!isObj(o)) {
    pushErr(p, 'expected object');
    return;
  }
  checkRequiredKeys(o, obReq, p, pushErr);
  if (o.id !== undefined) {
    if (!isStr(o.id, true)) pushErr(`${p}/id`, 'expected non-empty string');
    else if (seenObIds.has(o.id)) pushErr(`${p}/id`, `duplicate obligation id: ${o.id}`);
    else seenObIds.add(o.id);
  }
  if (o.kind === 'command' && !isStr(o.command, true)) pushErr(`${p}/command`, 'expected non-empty command string');
  const obStrRules = ['frozenHash', 'signedBy', 'claim', 'observable', 'scope', 'servesSuccessCriterion']
    .map((k) => [k, (v) => isStr(v, k !== 'signedBy' || full), 'expected string']);
  checkOptionalRules(o, [
    ['kind', (v) => v === 'command' || v === 'human', 'expected command | human'],
    ['required', isBool, 'expected boolean'],
    ['timeoutSec', isPosNum, 'expected positive number'],
    ...obStrRules,
    ['inputClasses', isInputClasses, 'expected 正常|边界|异常 array'],
    ['spansContracts', isStrArr, 'expected string[]'],
    ['scopeAck', isScopeAck, 'expected { by, at }']
  ], p, pushErr);
  validateExpectBlock(o, p, pushErr);
}

function validateTopFields(doc, full, pushErr) {
  const topReq = full ? ['id', 'title', 'why', 'scope', 'obligations', 'owner', 'provisional'] : ['id', 'obligations'];
  checkRequiredKeys(doc, topReq, '', pushErr);
  const topStrRules = ['title', 'why', 'owner', 'skipReason']
    .map((k) => [k, (v) => isStr(v, k !== 'skipReason'), 'expected string']);
  const topArrRules = ['scope', 'dependsOn', 'overlapsWith']
    .map((k) => [k, (v) => isStrArr(v, k === 'scope' && full), 'expected string[]']);
  const checkObs = (v) => Array.isArray(v) && (!full || v.length > 0);
  checkOptionalRules(doc, [
    ['id', (v) => isStr(v, true), 'expected non-empty string'],
    ...topStrRules,
    ['track', (v) => TRACK_VALUES.has(v), 'expected delivery | explore'],
    ['exploreMeta', isObj, 'expected object'],
    ['provisional', isBool, 'expected boolean'],
    ...topArrRules,
    ['retired', isObj, 'expected object'],
    ['obligations', checkObs, full ? 'expected non-empty array' : 'expected array']
  ], '', pushErr);
  if (doc.execution !== undefined) validateExecutionBlock(doc.execution, pushErr);
}

export function validateContractSchema(doc, opts = {}) {
  if (!isObj(doc)) return ['/ : expected contract JSON object'];
  const full = opts.full !== false && doc.track !== 'explore';
  const errs = [];
  const pushErr = (ptr, msg) => errs.push(`${ptr}: ${msg}`);
  validateTopFields(doc, full, pushErr);
  const obReq = full
    ? ['id', 'kind', 'expect', 'frozenHash', 'signedBy', 'required', 'claim', 'observable', 'scope', 'inputClasses', 'servesSuccessCriterion']
    : ['id', 'kind', 'expect'];
  const seenObIds = new Set();
  if (Array.isArray(doc.obligations)) {
    doc.obligations.forEach((o, i) => validateSingleObligation(o, `/obligations/${i}`, full, obReq, seenObIds, pushErr));
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
