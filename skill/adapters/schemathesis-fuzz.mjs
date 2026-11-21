// 砂浆适配器 · Schemathesis OpenAPI/GraphQL 接口边界模糊测试观测（Mortar Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'schemathesis',
  defaultRole: 'hard',
  env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  degradedTo: '人工对照 OpenAPI 文档逐接口发送异常参数并核验 HTTP 状态码与返回体',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const schemaArg = ctx.arg('--schema', ['openapi.json', 'openapi.yaml', 'openapi.yml'].find((f) => existsSync(join(ctx.rootDir, f))));
      const baseUrl = ctx.arg('--url');
      if (!schemaArg || !baseUrl) ctx.fail(3, '缺少 --schema (openapi.json/yaml) 或 --url http://...');
      rawText = ctx.withTempDir('sch-out-', (tmpOut) => {
        const outJson = join(tmpOut, 'schemathesis-report.json');
        const r = ctx.runBin(['run', resolve(ctx.rootDir, schemaArg), '--url', baseUrl, '--max-examples', ctx.arg('--max-examples', '10'), '--report', 'json', '--report-json-path', outJson]);
        if (r.error || !existsSync(outJson)) ctx.fail(3, 'schemathesis run 未产出 JSON 报告：' + (r.stderr || r.stdout));
        return readFileSync(outJson, 'utf8');
      });
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'Schemathesis');
    if (!parsed || typeof parsed !== 'object' || !parsed.operations || !parsed.test_cases) {
      ctx.fail(3, 'Schemathesis 报告缺少 operations 或 test_cases 字段');
    }
    const operationsTotal = Number(parsed.operations.total || 0), operationsTested = Number(parsed.operations.tested || 0);
    const casesGenerated = Number(parsed.test_cases.generated || 0), uniqueFailuresCount = Number(parsed.test_cases.unique_failures || 0);
    if (operationsTotal === 0) ctx.fail(3, 'Schemathesis 未覆盖任何 API 接口（防空跑退 3）');
    const failures = Array.isArray(parsed.failures) ? parsed.failures : [], errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const failureSummaries = failures.slice(0, 50).map((f) => ({ code: String(f.code || f.type || ''), title: String(f.title || ''), count: Number(f.count || 1), operations: Array.isArray(f.operations) ? f.operations : [] }));
    const observation = { operationsTotal, operationsTested, casesGenerated, uniqueFailuresCount, failureGroupsCount: failures.length, errorCount: errors.length, failureSummaries };
    return {
      rawJson: parsed,
      observation,
      unresolved: errors.length > 0 ? [`存在 ${errors.length} 条接口调用错误`] : [],
      claimText: `API 模糊测试覆盖 ${operationsTested}/${operationsTotal} 接口，生成 ${casesGenerated} 用例，检出 ${uniqueFailuresCount} 类异常响应与 ${errors.length} 处错误，明细见 ${ctx.obsRelPath}`,
      summaryLog: `tested=${operationsTested}/${operationsTotal}, uniqueFailures=${uniqueFailuresCount}`
    };
  }
});
