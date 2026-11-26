// 适配器 · Import Linter (grimp) Python 架构边界与分层契约观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'import-linter',
  defaultBin: 'lint-imports',
  defaultRole: 'soft',
  degradedTo: '运行 donegate graph 检查 Python 跨契约导入红线并人工复核分层依赖',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    let parsed = null;
    if (rawText === null) {
      const r = ctx.runBin([]);
      if (r.error || (r.status !== 0 && r.status !== 1)) ctx.fail(3, 'lint-imports 执行失败：' + (r.stderr || r.error?.message));
      rawText = (r.stdout || '') + '\n' + (r.stderr || '');
    }
    const trimmed = rawText.trim();
    let keptContractCount = 0;
    let brokenContractCount = 0;
    if (trimmed.startsWith('{')) {
      parsed = ctx.parseJsonOrFail(trimmed, 'import-linter');
      keptContractCount = Number(parsed.keptContractCount ?? parsed.kept ?? 0);
      brokenContractCount = Number(parsed.brokenContractCount ?? parsed.broken ?? 0);
    } else {
      const m = trimmed.match(/(\d+)\s+kept,\s*(\d+)\s+broken/i);
      keptContractCount = m ? Number(m[1]) : 0;
      brokenContractCount = m ? Number(m[2]) : (/BROKEN/.test(trimmed) ? 1 : 0);
      parsed = { rawOutput: trimmed.slice(0, 4000), keptContractCount, brokenContractCount };
    }
    const totalContracts = keptContractCount + brokenContractCount;
    const observation = { totalContracts, keptContractCount, brokenContractCount };
    return {
      rawJson: parsed,
      observation,
      claimText: `Import Linter ${ctx.toolVer} 核查 ${totalContracts} 条 Python 架构边界契约（遵守 ${keptContractCount}、违规 ${brokenContractCount}），明细见 ${ctx.obsRelPath}`,
      summaryLog: `total=${totalContracts}, broken=${brokenContractCount}`
    };
  }
});
