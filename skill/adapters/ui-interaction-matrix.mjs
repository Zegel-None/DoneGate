// 适配器 · ui-interaction-matrix（Adapter Protocol v1.1 · 形态：knowledge-skill，免外部二进制，委托 ./_shared.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runAdapter, shaBytes } from './_shared.mjs';

runAdapter({
  tool: 'ui-interaction-matrix',
  mode: 'knowledge',
  defaultRole: 'soft',
  degradedTo: '人工对照 bricks/ui-interaction-matrix/interaction-matrix.json 逐项填写控件映射表与五态清单',
  collect(ctx) {
    const defaultMatrixAbs = join(ctx.repoDir, 'bricks', 'ui-interaction-matrix', 'interaction-matrix.json');
    const customRulesRel = ctx.arg('--rules-file');
    const matrixAbs = customRulesRel ? resolve(ctx.rootDir, customRulesRel) : defaultMatrixAbs;
    if (!existsSync(matrixAbs)) ctx.fail(3, '交互决策矩阵文件不存在：' + matrixAbs);

    const matrixBuf = readFileSync(matrixAbs);
    const matrixDoc = ctx.parseJsonOrFail(matrixBuf.toString('utf8'), 'ui-interaction-matrix');
    const rules = Array.isArray(matrixDoc?.rules) ? matrixDoc.rules : [];
    if (rules.length === 0) ctx.fail(3, 'interaction-matrix.json 缺少有效 rules 数组');
    const rulesById = new Map(rules.map((r) => [r.id, r]));

    const inputs = [];
    const relToRoot = relative(ctx.rootDir, matrixAbs).replace(/\\/g, '/');
    if (!relToRoot.startsWith('..')) {
      inputs.push({ path: relToRoot, sha256: shaBytes(matrixBuf) });
    }

    const featuresRel = ctx.arg('--features-file');
    let evaluated = [];
    let unmappedCount = 0;
    let antiPatternHitCount = 0;
    if (featuresRel) {
      const fInputs = ctx.hashInputFiles(ctx.rootDir, [featuresRel], '功能盘点文件 ');
      inputs.push(...fInputs);
      const featDoc = ctx.parseJsonOrFail(fInputs[0].buffer.toString('utf8'), 'features-file');
      const list = Array.isArray(featDoc) ? featDoc : (Array.isArray(featDoc?.features) ? featDoc.features : null);
      if (!list) ctx.fail(3, 'features-file 须为数组或含 features 数组');
      evaluated = list.map((item) => {
        const rule = rulesById.get(String(item?.decisionRuleId || ''));
        const chosen = String(item?.chosenControl || '').trim();
        const hitAvoid = Boolean(rule && Array.isArray(rule.avoidControls) && rule.avoidControls.includes(chosen));
        if (!rule) unmappedCount++;
        if (hitAvoid) antiPatternHitCount++;
        return {
          featureId: String(item?.featureId || item?.name || 'unnamed'),
          decisionRuleId: rule ? rule.id : null,
          chosenControl: chosen || (rule ? rule.useControl : 'unspecified'),
          antiPatternHit: hitAvoid
        };
      });
    }

    const observation = {
      archetype: 'knowledge-skill',
      matrixSha256: shaBytes(matrixBuf),
      ruleCount: rules.length,
      requiredPageStates: matrixDoc.requiredPageStates || [],
      evaluatedFeatureCount: evaluated.length,
      unmappedCount,
      antiPatternHitCount,
      findingCount: unmappedCount + antiPatternHitCount,
      evaluatedFeatures: evaluated,
      promptDirectives: rules.map((r) => `[${r.id}] ${r.condition} -> 选用 ${r.label}（禁选 ${(r.avoidControls || []).join('/')}）`)
    };

    return {
      inputs,
      rawJson: matrixDoc,
      observation,
      claimText: `ui-interaction-matrix (${ctx.toolVer}) 已锁定 ${rules.length} 条交互决策规则（核对功能 ${evaluated.length} 项，未映射 ${unmappedCount} 项，反模式命中 ${antiPatternHitCount} 项），明细见 ${ctx.obsRelPath}`,
      summaryLog: `rules=${rules.length}, features=${evaluated.length}, antiPatterns=${antiPatternHitCount}`
    };
  }
});
