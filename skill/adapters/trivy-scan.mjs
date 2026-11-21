// 砂浆适配器 · Trivy IaC/Dockerfile/文件系统安全配置与漏洞观测（Mortar Protocol v1.1 · 委托 _shared.mjs）
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'trivy',
  defaultRole: 'hard',
  degradedTo: '人工审查 Dockerfile、容器配置与 IaC 清单中的高危配置项',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['fs', '--scanners', ctx.arg('--scanners', 'misconfig'), '--format', 'json', '--quiet', ctx.arg('--target', '.')]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'trivy fs 执行失败：' + (r.stderr || r.error?.message));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'Trivy');
    if (!parsed || typeof parsed !== 'object' || (!Array.isArray(parsed.Results) && typeof parsed.SchemaVersion !== 'number')) {
      ctx.fail(3, 'Trivy 报告缺少 Results / SchemaVersion 字段');
    }
    const results = Array.isArray(parsed.Results) ? parsed.Results : [];
    let misconfigCount = 0, vulnCount = 0, secretCount = 0;
    const findings = [];
    for (const res of results) {
      const target = String(res.Target || '');
      for (const m of (res.Misconfigurations || [])) {
        if (m.Status && m.Status !== 'FAIL') continue;
        misconfigCount++;
        findings.push({ kind: 'misconfig', id: String(m.ID || ''), target, severity: String(m.Severity || ''), title: String(m.Title || '') });
      }
      for (const v of (res.Vulnerabilities || [])) {
        vulnCount++;
        findings.push({ kind: 'vuln', id: String(v.VulnerabilityID || ''), target, severity: String(v.Severity || ''), pkg: String(v.PkgName || '') });
      }
      for (const s of (res.Secrets || [])) {
        secretCount++;
        findings.push({ kind: 'secret', id: String(s.RuleID || ''), target, severity: String(s.Severity || ''), title: String(s.Title || '') });
      }
    }
    const observation = { targetCount: results.length, misconfigCount, vulnCount, secretCount, totalFindings: misconfigCount + vulnCount + secretCount, findings: findings.slice(0, 100) };
    return {
      rawJson: parsed,
      observation,
      claimText: `Trivy 检出配置缺陷 ${misconfigCount}、漏洞 ${vulnCount}、密钥 ${secretCount}，明细见 ${ctx.obsRelPath}`,
      summaryLog: `misconfig=${misconfigCount}, vuln=${vulnCount}`
    };
  }
});
