// 适配器 · pbt-fastcheck 属性基测试（Property-Based Testing · Adapter Protocol v1.1，委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

function pbtParseReport(rawText, fail) {
  let doc;
  try {
    doc = JSON.parse(rawText);
  } catch (e) {
    fail(3, `pbt-fastcheck 报告 JSON 截断或损坏：${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.properties)) {
    fail(3, 'pbt-fastcheck 报告缺少 properties 数组');
  }
  let passed = 0;
  let failed = 0;
  let totalRuns = 0;
  const counterexamples = [];
  for (const [idx, p] of doc.properties.entries()) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.failed !== 'boolean') {
      fail(3, `pbt-fastcheck 第 ${idx + 1} 条属性缺少合法 name/failed 字段`);
    }
    totalRuns += Number(p.numRuns || 0);
    if (p.failed) {
      failed++;
      counterexamples.push({
        name: p.name,
        seed: p.seed ?? null,
        numRuns: Number(p.numRuns || 0),
        counterexample: p.counterexample ?? null
      });
    } else {
      passed++;
    }
  }
  return {
    propertiesTotal: doc.properties.length,
    propertiesPassed: passed,
    propertiesFailed: failed,
    totalRuns,
    counterexamples: counterexamples.slice(0, 20)
  };
}

runAdapter({
  tool: 'pbt-fastcheck',
  defaultRole: 'soft',
  degradedTo: '人工补充边界值、空值、极值与逆运算不变量测试用例',
  collect(ctx) {
    const target = ctx.arg('--target', '.');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['--json', target]);
      if (r.error || (r.status !== 0 && r.status !== 1)) {
        ctx.fail(3, 'pbt-fastcheck 执行失败：' + (r.stderr || r.error?.message));
      }
      rawText = r.stdout || '';
    }
    const observation = pbtParseReport(rawText, ctx.fail);
    return {
      rawFileName: 'raw-pbt-fastcheck.json',
      rawContent: rawText.endsWith('\n') ? rawText : rawText + '\n',
      observation,
      claimText: `pbt-fastcheck ${ctx.toolVer} 对 ${target} 检验 ${observation.propertiesTotal} 条不变量属性（总随机样本 ${observation.totalRuns} 次）：通过 ${observation.propertiesPassed}、反例失败 ${observation.propertiesFailed}，明细见 ${ctx.obsRelPath}`,
      summaryLog: `props=${observation.propertiesTotal}, failed=${observation.propertiesFailed}, runs=${observation.totalRuns}`
    };
  }
});
