// 适配器 · semgrep（Adapter Protocol v1.1 · 形态：scanner，多语言快速 SAST 静态安全观测，委托 ./_shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'semgrep',
  defaultBin: 'semgrep',
  defaultRole: 'hard',
  versionArgs: ['--version'],
  degradedTo: '人工按安全审计清单逐文件排查注入、SSRF、不安全子进程调用与反序列化风险',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    const configSpec = ctx.arg('--config', 'auto');
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['scan', '--config', configSpec, '--json', '--quiet', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) {
        ctx.fail(3, 'semgrep 执行失败：' + (r.stderr || r.error?.message || ''));
      }
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'semgrep');
    if (!parsed || !Array.isArray(parsed.results)) ctx.fail(3, 'semgrep 报告缺少 results 数组');

    let errorSeverityCount = 0;
    let warningSeverityCount = 0;
    const ruleHits = parsed.results.slice(0, 50).map((it) => {
      const sev = String(it?.extra?.severity || 'INFO').toUpperCase();
      if (sev === 'ERROR') errorSeverityCount++;
      else if (sev === 'WARNING') warningSeverityCount++;
      return {
        checkId: String(it?.check_id || 'unknown'),
        path: String(it?.path || ''),
        line: Number(it?.start?.line || 0),
        severity: sev
      };
    });
    for (let i = 50; i < parsed.results.length; i++) {
      const sev = String(parsed.results[i]?.extra?.severity || 'INFO').toUpperCase();
      if (sev === 'ERROR') errorSeverityCount++;
      else if (sev === 'WARNING') warningSeverityCount++;
    }

    const observation = {
      archetype: 'scanner',
      target: targetDir,
      findingCount: parsed.results.length,
      errorSeverityCount,
      warningSeverityCount,
      ruleHits
    };
    return {
      rawJson: parsed,
      observation,
      claimText: `semgrep ${ctx.toolVer} 对 ${targetDir} 检出 ${parsed.results.length} 条静态安全命中（ERROR=${errorSeverityCount}、WARNING=${warningSeverityCount}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `findings=${parsed.results.length}, errors=${errorSeverityCount}`
    };
  }
});
