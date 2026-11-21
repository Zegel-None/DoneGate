// 砂浆适配器 · gitleaks 密钥泄漏观测（Mortar Protocol v1.1 · 委托 _shared.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
  tool: 'gitleaks',
  defaultRole: 'hard',
  versionArgs: ['version'],
  degradedTo: '人工按同一格式逐文件核查密钥与凭据残留',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      rawText = ctx.withTempDir('gitleaks-out-', (tmpOut) => {
        const rpt = join(tmpOut, 'gitleaks.json');
        const r = ctx.runBin(['detect', '--source', ctx.rootDir, '--no-git', '--report-format', 'json', '--report-path', rpt, '--exit-code', '0']);
        if (r.error || r.status !== 0 || !existsSync(rpt)) ctx.fail(3, 'gitleaks 执行失败：' + (r.stderr || r.error?.message));
        return readFileSync(rpt, 'utf8');
      });
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'gitleaks');
    if (!Array.isArray(parsed)) ctx.fail(3, 'gitleaks 报告不是数组');
    const findings = parsed.map((x) => ({
      ruleId: String(x.RuleID || x.ruleId || 'unknown'),
      file: String(x.File || x.file || '').replace(/\\/g, '/'),
      line: Number(x.StartLine || x.line || 0)
    }));
    const observation = { findingCount: findings.length, findings };
    return {
      rawJson: parsed,
      observation,
      claimText: `gitleaks 扫描检出 ${findings.length} 条疑似密钥条目，明细见 ${ctx.obsRelPath}`,
      summaryLog: `findings=${findings.length}`
    };
  }
});
