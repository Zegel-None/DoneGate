// 适配器 · osv-scanner 依赖漏洞观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'osv-scanner',
  defaultRole: 'hard',
  degradedTo: '人工按同一格式核查 package-lock.json 新增依赖与安全公告',
  collect(ctx) {
    const lockRel = ctx.arg('--lockfile', 'package-lock.json');
    const lockAbs = resolve(ctx.rootDir, lockRel);
    const inputs = existsSync(lockAbs) ? ctx.hashInputFiles(ctx.rootDir, [lockRel], 'lockfile ') : [];
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      if (!existsSync(lockAbs)) ctx.fail(3, '缺少 lockfile：' + lockRel);
      const r = ctx.runBin(['scan', 'source', '-L', lockAbs, '--format', 'json']);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'osv-scanner 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'osv-scanner');
    if (!parsed || !Array.isArray(parsed.results)) ctx.fail(3, 'osv-scanner 报告缺少 results 数组');
    const vulnerabilities = [], severityCounts = {};
    for (const res of parsed.results) {
      for (const pkg of (res.packages || [])) {
        for (const v of (pkg.vulnerabilities || [])) {
          const sev = String((v && v.database_specific && v.database_specific.severity) || 'UNKNOWN').toUpperCase();
          vulnerabilities.push({ package: pkg.package?.name || 'unknown', version: pkg.package?.version || '', id: v.id || 'unknown', severity: sev, summary: String(v.summary || '').slice(0, 120) });
          severityCounts[sev] = (severityCounts[sev] || 0) + 1;
        }
      }
    }
    const observation = { lockfile: lockRel, vulnCount: vulnerabilities.length, severityCounts, vulnerabilities };
    return {
      rawFileName: 'raw-osv.json',
      obsKind: 'osv-observation',
      inputs,
      rawJson: parsed,
      observation,
      claimText: `osv-scanner 扫描 ${lockRel} 检出 ${vulnerabilities.length} 条已知漏洞（HIGH=${severityCounts.HIGH || 0}、CRITICAL=${severityCounts.CRITICAL || 0}、UNKNOWN=${severityCounts.UNKNOWN || 0}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `vulns=${vulnerabilities.length}`
    };
  }
});
