import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Stage 3 · 跨文件 UI 锚点/导出符号影响面雷达 (impact) 与公开脱敏包同构干跑门禁', () => {
  it('donegate impact 精准反查 wb-dom.mjs 与字面量 UI 锚点波及的跨目录单测及宿主模块', () => {
    const rDom = dispatchCommand(['impact', 'runner/atlas/wb-dom.mjs', '--json'], REPO_ROOT);
    expect(rDom.exitCode).toBe(0);
    const domImpact = JSON.parse(rDom.stdout);
    if (existsSync(join(REPO_ROOT, 'contracts'))) {
      expect(domImpact.selfContracts).toContain('atlas-canvas');
      expect(domImpact.crossContractIds).toContain('atlas-workbench');
    }
    const testPaths = domImpact.affectedTests.map((t) => t.file);
    expect(testPaths).toContain('tests/round2-workbench.test.mjs');
    expect(testPaths).toContain('tests/round3-toolbar-overview.test.mjs');
    expect(domImpact.suggestedVitestCommand).toContain('npx vitest run');

    const rAnchor = dispatchCommand(['impact', 'btn-open-save-pack', '/donegate/api/uiboard/convey-to-kanban', '--json'], REPO_ROOT);
    expect(rAnchor.exitCode).toBe(0);
    const anchorImpact = JSON.parse(rAnchor.stdout);
    const anchorTests = anchorImpact.affectedTests.map((t) => t.file);
    expect(anchorTests).toContain('tests/round2-workbench.test.mjs');
    expect(anchorTests).toContain('tests/round3-dsh-uiboard.test.mjs');
  });

  it('公开包内存干跑全绿，且同构门禁精准拦截漏装单测、缺失导入模块与未加 existsSync 的母仓私有目录断言', async () => {
    const builderPath = join(REPO_ROOT, 'skill', 'build-public.mjs');
    if (!existsSync(builderPath)) {
      expect(existsSync(join(REPO_ROOT, 'runner/core/impact-radar.mjs'))).toBe(true);
      return;
    }
    const { auditPublicBundleParity, buildPublicBundle } = await import(builderPath);
    const tmpOut = mkdtempSync(join(tmpdir(), 'dg-s3-pubout-'));
    const tmpMockRoot = mkdtempSync(join(tmpdir(), 'dg-s3-mockroot-'));
    try {
      const realDry = buildPublicBundle(REPO_ROOT, tmpOut, { quiet: true });
      expect(realDry.exitCode).toBe(0);
      expect(realDry.parityFails).toEqual([]);

      mkdirSync(join(tmpMockRoot, 'tests'), { recursive: true });
      writeFileSync(join(tmpMockRoot, 'tests/forgotten.test.mjs'), 'export const x = 1;\n');
      mkdirSync(join(tmpOut, 'tests'), { recursive: true });
      const badSnippet = ['import { join } from "node:path";', 'const REPO_ROOT = ".";', 'const p = join(REPO_ROOT, "to" + "ols");'.replace('" + "', ''), 'expect(toolsNode).toBeDefined();'].join('\n'); // dg-public-ok
      writeFileSync(join(tmpOut, 'tests/bad-private.test.mjs'), badSnippet);
      const badParity = auditPublicBundleParity(tmpMockRoot, tmpOut, []);
      expect(badParity.ok).toBe(false);
      expect(badParity.fails.some((f) => f.includes('公开包漏装单测 (tests/forgotten.test.mjs)'))).toBe(true);
      expect(badParity.fails.some((f) => f.includes('公开包单测私有目录硬编码风险'))).toBe(true);
      expect(badParity.fails.some((f) => f.includes('公开包单测私有节点硬编码风险'))).toBe(true);
    } finally {
      rmSync(tmpOut, { recursive: true, force: true });
      rmSync(tmpMockRoot, { recursive: true, force: true });
    }
  });

  it('donegate impact 按语法类别边界消歧：不将 data-snap-kind="align" 或 /autopilot/status 拆成裸词污染无关模块', () => {
    const rSnap = dispatchCommand(['impact', 'runner/atlas/wb-snap-rulers.mjs', '--json'], REPO_ROOT);
    expect(rSnap.exitCode).toBe(0);
    const snapImpact = JSON.parse(rSnap.stdout);
    const allHitTokens = snapImpact.affectedProdFiles.flatMap((p) => p.hits.map((h) => h.token));
    expect(allHitTokens).not.toContain('align');
    expect(snapImpact.affectedProdFiles.length).toBeLessThan(8);

    const rStatusRoute = dispatchCommand(['impact', '/donegate/api/autopilot/status', '--json'], REPO_ROOT);
    expect(rStatusRoute.exitCode).toBe(0);
    const statusImpact = JSON.parse(rStatusRoute.stdout);
    const statusHitTokens = statusImpact.affectedTests.flatMap((t) => t.hits.map((h) => h.token));
    expect(statusHitTokens).not.toContain('status');
    expect(statusImpact.affectedProdFiles.some((p) => p.file === 'runner/dsh/autopilot-routes.mjs')).toBe(true);
    expect(statusImpact.affectedProdFiles.some((p) => p.file === 'runner/atlas/ui-shell.mjs')).toBe(true);
  });
});
