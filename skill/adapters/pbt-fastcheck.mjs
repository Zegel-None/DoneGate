// 适配器 · pbt-fastcheck 属性基测试（固定种子 + 原型链毒丸键 + 有效前置样本计数，<= 90 行）
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapter } from './_shared.mjs';

export const DEFAULT_PBT_SEED = 20261017;
export const PBT_PROTO_POISON_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const DEFAULT_PBT_RUNS = 100, MAX_COUNTEREXAMPLES = 20;

export function buildPbtCheckOptions(overrides = {}) {
  const seed = Number.isInteger(overrides.seed) ? overrides.seed : DEFAULT_PBT_SEED;
  const numRuns = Number(overrides.numRuns) > 0 ? Number(overrides.numRuns) : DEFAULT_PBT_RUNS;
  const minValidSamples = Number(overrides.minValidSamples) > 0 ? Number(overrides.minValidSamples) : 1;
  return { seed, numRuns, poisonKeys: [...PBT_PROTO_POISON_KEYS], minValidSamples };
}

function pbtCountPoisonHit(p) {
  if (Number.isFinite(Number(p.poisonRuns))) return Number(p.poisonRuns);
  const text = JSON.stringify(p.counterexample ?? p.samples ?? '');
  return PBT_PROTO_POISON_KEYS.some((k) => text.includes(k)) ? 1 : 0;
}

export function pbtParseReport(rawText, fail, seedUsed = DEFAULT_PBT_SEED) {
  let doc;
  try { doc = JSON.parse(rawText); } catch (e) { fail(3, `pbt-fastcheck 报告 JSON 截断或损坏：${e.message}`); }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.properties)) fail(3, 'pbt-fastcheck 报告缺少 properties 数组');
  let passCnt = 0, failCnt = 0, totalRuns = 0, validSampleCount = 0, vacuousPreconditionCount = 0, poisonRuns = 0;
  const counterexamples = [];
  for (const [idx, p] of doc.properties.entries()) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.failed !== 'boolean') {
      fail(3, `pbt-fastcheck 第 ${idx + 1} 条属性缺少合法 name/failed 字段`);
    }
    const runs = Number(p.numRuns || 0), skipped = Number(p.numSkipped ?? p.skippedRuns ?? 0);
    const valid = p.validSampleCount !== undefined ? Number(p.validSampleCount) : Math.max(0, runs - skipped);
    totalRuns += runs;
    validSampleCount += valid;
    poisonRuns += pbtCountPoisonHit(p);
    if (valid <= 0 || p.preconditionExhausted === true) vacuousPreconditionCount++;
    if (p.failed) {
      failCnt++;
      counterexamples.push({ name: p.name, seed: p.seed ?? seedUsed, numRuns: runs, counterexample: p.counterexample ?? null });
    } else {
      passCnt++;
    }
  }
  return {
    seed: Number.isInteger(doc.seed) ? doc.seed : seedUsed,
    poisonKeys: [...PBT_PROTO_POISON_KEYS],
    poisonRuns,
    propertiesTotal: doc.properties.length,
    propertiesPassed: passCnt,
    propertiesFailed: failCnt,
    totalRuns,
    validSampleCount,
    vacuousPreconditionCount,
    violationCount: failCnt + vacuousPreconditionCount,
    counterexamples: counterexamples.slice(0, MAX_COUNTEREXAMPLES)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAdapter({
    tool: 'pbt-fastcheck',
    defaultRole: 'soft',
    degradedTo: '人工补充边界值、空值、极值与逆运算不变量测试用例',
    collect(ctx) {
      const target = ctx.arg('--target', '.');
      const seed = Number(ctx.arg('--seed', String(DEFAULT_PBT_SEED))) || DEFAULT_PBT_SEED;
      let rawText = ctx.readRawOverride('--raw-report');
      if (rawText === null) {
        const r = ctx.runBin(['--json', '--seed', String(seed), '--poison-keys', PBT_PROTO_POISON_KEYS.join(','), target]);
        if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'pbt-fastcheck 执行失败：' + (r.stderr || r.error?.message));
        rawText = r.stdout || '';
      }
      const observation = pbtParseReport(rawText, ctx.fail, seed);
      return {
        rawFileName: 'raw-pbt-fastcheck.json',
        rawContent: rawText.endsWith('\n') ? rawText : rawText + '\n',
        observation,
        claimText: `pbt-fastcheck ${ctx.toolVer} 对 ${target} 检验 ${observation.propertiesTotal} 条属性（有效样本 ${observation.validSampleCount}/${observation.totalRuns}）：反例 ${observation.propertiesFailed}、空前置违例 ${observation.vacuousPreconditionCount}，见 ${ctx.obsRelPath}`,
        summaryLog: `props=${observation.propertiesTotal}, violations=${observation.violationCount}, validSamples=${observation.validSampleCount}`
      };
    }
  });
}
