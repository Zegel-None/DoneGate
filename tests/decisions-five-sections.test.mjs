import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { auditDecisions, validateDecisionFiveSections } from '../skill/check-decisions.mjs';
import { lintEditedFiles } from '../skill/lint-edit.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const FULL_FIVE_SEC_MD = [
  '# 示例架构决策',
  '',
  '## 一、当时的问题',
  '旧实现用魔法数字切分节点。',
  '',
  '## 二、可选方案',
  '方案 A：固定切分；方案 B：模块度自适应聚类。',
  '',
  '## 三、选了哪个',
  '选方案 B。',
  '',
  '## 四、为什么',
  '消除人工阈值并顺应真实耦合密度。',
  '',
  '## 五、什么条件下翻案',
  '超大规模单体仓耗时超阈值时升级为 Leiden。',
  ''
].join('\n');

describe('运行期 ADR (decisions/) INV-13 只增不改与 §2.5 五段齐全门禁', () => {
  it('validateDecisionFiveSections 放行标准五段记录，精准拦截漏写「可选方案」或空壳章节的新记录', () => {
    const okRes = validateDecisionFiveSections(FULL_FIVE_SEC_MD, '2026-11-24-02-good.md');
    expect(okRes.ok).toBe(true);
    expect(okRes.missing).toEqual([]);
    expect(okRes.empty).toEqual([]);

    const missingOpt = FULL_FIVE_SEC_MD.replace('## 二、可选方案\n方案 A：固定切分；方案 B：模块度自适应聚类。\n\n', '');
    const badMissing = validateDecisionFiveSections(missingOpt, '2026-11-24-09-bad.md');
    expect(badMissing.ok).toBe(false);
    expect(badMissing.missing).toEqual(['可选方案']);

    const emptyWhy = FULL_FIVE_SEC_MD.replace('消除人工阈值并顺应真实耦合密度。', '   ');
    const badEmpty = validateDecisionFiveSections(emptyWhy, '2026-11-24-10-empty.md');
    expect(badEmpty.ok).toBe(false);
    expect(badEmpty.empty).toEqual(['为什么']);
  });

  it('lint-edit 与 auditDecisions 对新増缺章节 ADR 当场判红，且母仓新增图论架构 ADR 完整通过核查', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-adr-five-'));
    try {
      mkdirSync(join(tmp, 'decisions'), { recursive: true });
      spawnSync('git', ['-C', tmp, 'init', '-q']);
      spawnSync('git', ['-C', tmp, 'config', 'user.email', 'adr@local']);
      spawnSync('git', ['-C', tmp, 'config', 'user.name', 'ADR']);
      writeFileSync(join(tmp, 'decisions/2026-11-24-01-valid.md'), FULL_FIVE_SEC_MD, 'utf8');
      spawnSync('git', ['-C', tmp, 'add', '.']);
      spawnSync('git', ['-C', tmp, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);

      expect(auditDecisions(tmp).rows['③五段标题与正文齐全']).toBe(true);

      const incomplete = '# 缺段记录\n\n## 当时的问题\nA\n## 选了哪个\nB\n## 为什么\nC\n## 什么条件下翻案\nD\n';
      writeFileSync(join(tmp, 'decisions/2026-11-24-02-incomplete.md'), incomplete, 'utf8');
      expect(auditDecisions(tmp).rows['③五段标题与正文齐全']).toBe(false);

      const lintRes = lintEditedFiles(tmp, ['decisions/2026-11-24-02-incomplete.md']);
      expect(lintRes.exitCode).toBe(1);
      expect(lintRes.fails.some((f) => f.includes('可选方案'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    const motherAdr = join(REPO_ROOT, 'decisions', '2026-11-24-02-零魔法数字模块度聚合与复合图超节点排版架构.md');
    if (existsSync(motherAdr)) {
      const v = validateDecisionFiveSections(readFileSync(motherAdr, 'utf8'), motherAdr, { ignoreLegacy: true });
      expect(v.ok).toBe(true);
    }
  });
});
