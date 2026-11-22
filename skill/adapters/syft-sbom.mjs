// 适配器 · syft（Adapter Protocol v1.1 · 形态：generator，CycloneDX SBOM 生成与产物验真，委托 ./_shared.mjs）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'syft',
  defaultBin: 'syft',
  defaultRole: 'soft',
  versionArgs: ['version'],
  degradedTo: '人工导出项目依赖锁文件清单并按 CycloneDX components 字段归档',
  collect(ctx) {
    const targetDir = ctx.arg('--target', '.');
    const sbomRel = ctx.arg('--sbom-out', '.donegate/adapters/syft/sbom.cdx.json');
    const sbomAbs = resolve(ctx.rootDir, sbomRel);
    mkdirSync(dirname(sbomAbs), { recursive: true });

    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const r = ctx.runBin(['scan', `dir:${resolve(ctx.rootDir, targetDir)}`, '-o', 'cyclonedx-json']);
      if (r.error || r.status !== 0) ctx.fail(3, 'syft 生成 SBOM 失败：' + (r.stderr || r.error?.message || ''));
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, 'syft');
    if (!parsed || typeof parsed !== 'object') ctx.fail(3, 'syft CycloneDX JSON 结构非法');
    if (!ctx.dryRun) writeFileSync(sbomAbs, JSON.stringify(parsed, null, 2) + '\n', 'utf8');

    const components = Array.isArray(parsed.components) ? parsed.components : [];
    const typeCounts = {};
    for (const c of components) {
      const tp = String(c?.type || 'library');
      typeCounts[tp] = (typeCounts[tp] || 0) + 1;
    }
    const observation = { archetype: 'generator', target: targetDir, sbomFormat: parsed.bomFormat || 'CycloneDX', componentCount: components.length, typeCounts };
    return {
      extraArtifacts: ctx.dryRun ? [] : [{ path: sbomRel, kind: 'syft-cyclonedx-sbom' }],
      rawJson: parsed,
      observation,
      claimText: `syft ${ctx.toolVer} 对 ${targetDir} 产出 CycloneDX SBOM（含组件 ${components.length} 项），明细见 ${ctx.obsRelPath}`,
      summaryLog: `components=${components.length}`
    };
  }
});
