// 适配器 · vuln-merge（Adapter Protocol v1.1 · 形态：aggregator，多源漏洞去重与可达性定级归并，委托 ./_shared.mjs）
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
const normSev = (s) => { const u = String(s || 'UNKNOWN').toUpperCase(); return u in SEV_RANK ? u : 'UNKNOWN'; };

function extractFindings(doc, srcPath) {
  const out = [];
  const push = (pkg, ver, id, sev, source, reachable = false, runtime = true) => {
    if (!pkg && !id) return;
    out.push({ package: String(pkg || 'unknown'), version: String(ver || '*'), vulnId: String(id || 'UNKNOWN'), severity: normSev(sev), source, reachable: Boolean(reachable), runtime: runtime !== false });
  };
  if (Array.isArray(doc?.vulnerabilities)) {
    for (const v of doc.vulnerabilities) push(v.package || v.pkgName, v.version || v.installedVersion, v.id || v.vulnId || v.VulnerabilityID, v.severity, doc.tool || srcPath, v.reachable, v.runtime);
  }
  if (Array.isArray(doc?.results)) {
    for (const r of doc.results) for (const p of (r.packages || [])) for (const v of (p.vulnerabilities || [])) {
      const cve = (v.aliases || []).find((a) => /^CVE-/i.test(a)) || v.id;
      push(p.package?.name, p.package?.version, cve, v.database_specific?.severity, 'osv-scanner', false, true);
    }
  }
  if (Array.isArray(doc?.Results)) {
    for (const r of doc.Results) for (const v of (r.Vulnerabilities || [])) push(v.PkgName, v.InstalledVersion, v.VulnerabilityID, v.Severity, 'trivy', false, true);
  }
  if (Array.isArray(doc?.matches)) {
    for (const m of doc.matches) push(m.artifact?.name, m.artifact?.version, m.vulnerability?.id, m.vulnerability?.severity, 'grype', false, true);
  }
  if (Array.isArray(doc?.dependencies)) {
    for (const d of doc.dependencies) for (const v of (d.vulns || [])) push(d.name, d.version, (v.aliases || [])[0] || v.id, v.severity || 'HIGH', 'pip-audit', true, true);
  }
  return out;
}

runAdapter({
  tool: 'vuln-merge',
  mode: 'artifact',
  defaultRole: 'hard',
  degradedTo: '人工导出各扫描器 JSON 报告后按 (包名,版本,CVE) 手工合并最高严重度清单',
  collect(ctx) {
    const autoCands = ['.donegate/adapters/osv-scanner/observation.json', '.donegate/adapters/trivy/observation.json'];
    const rawArg = ctx.arg('--reports');
    const relList = rawArg
      ? rawArg.split(',').map((s) => s.trim()).filter(Boolean)
      : autoCands.filter((rel) => existsSync(resolve(ctx.rootDir, rel)));
    if (relList.length === 0) ctx.fail(3, '未提供 --reports 且未发现上游扫描产物（osv-scanner / trivy）');

    const files = ctx.hashInputFiles(ctx.rootDir, relList, '上游漏洞报告 ');
    const merged = new Map();
    let rawFindingCount = 0;
    for (const f of files) {
      const parsed = ctx.parseJsonOrFail(f.buffer.toString('utf8'), f.path);
      for (const item of extractFindings(parsed, f.path)) {
        rawFindingCount++;
        const key = `${item.package}@${item.version}#${item.vulnId}`;
        const prev = merged.get(key);
        if (!prev) {
          merged.set(key, { ...item, sources: [item.source] });
        } else {
          if (SEV_RANK[item.severity] > SEV_RANK[prev.severity]) prev.severity = item.severity;
          prev.reachable = prev.reachable || item.reachable;
          prev.runtime = prev.runtime || item.runtime;
          if (!prev.sources.includes(item.source)) prev.sources.push(item.source);
        }
      }
    }

    const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
    const priorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    const remediationItems = [...merged.values()].map((it) => {
      severityCounts[it.severity] = (severityCounts[it.severity] || 0) + 1;
      const highOrCrit = SEV_RANK[it.severity] >= 3;
      const priority = (highOrCrit && it.reachable && it.runtime) ? 'P0' : (highOrCrit ? 'P1' : (it.severity === 'MEDIUM' ? 'P2' : 'P3'));
      priorityCounts[priority]++;
      return { ...it, priority };
    }).sort((a, b) => a.priority.localeCompare(b.priority) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]));

    const findingCount = priorityCounts.P0 + priorityCounts.P1;
    const observation = { archetype: 'aggregator', reportCount: files.length, rawFindingCount, dedupedCount: remediationItems.length, findingCount, severityCounts, priorityCounts, remediationItems };
    return {
      inputs: files,
      rawJson: observation,
      observation,
      claimText: `vuln-merge (${ctx.toolVer}) 归并 ${files.length} 份报告：原始 ${rawFindingCount} 条去重为 ${remediationItems.length} 条（P0=${priorityCounts.P0}、P1=${priorityCounts.P1}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `raw=${rawFindingCount}, deduped=${remediationItems.length}, P0=${priorityCounts.P0}`
    };
  }
});
