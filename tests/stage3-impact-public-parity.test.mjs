import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  collectMultiHopTestsFromReverseAdj,
  irInferMultiHopTests,
  resolveCbmBinary
} from '../runner/core/index.mjs';
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
    expect(statusImpact.affectedProdFiles.some((p) => p.file === 'runner/dsh/host/autopilot-routes.mjs')).toBe(true);
    expect(statusImpact.affectedProdFiles.some((p) => p.file === 'runner/atlas/ui-shell.mjs')).toBe(true);
  });

  it('S6 多跳反向导入闭包：collectMultiHopTestsFromReverseAdj 在 3 跳截断、防环、叶子单测止传与降级返回上保持确定性', () => {
    expect(irInferMultiHopTests(join(tmpdir(), 'dg-nonexistent-cbm-root-s6'), ['runner/core/impact-radar.mjs'])).toEqual([]);
    expect(irInferMultiHopTests(REPO_ROOT, [])).toEqual([]);

    const revAdj = new Map([
      ['a.mjs', ['b.mjs', 'tests/one.test.mjs', 'a.mjs']],
      ['b.mjs', ['a.mjs', 'c.mjs', 'tests/two.test.mjs']],
      ['c.mjs', ['d.mjs', 'tests/three.test.mjs']],
      ['d.mjs', ['tests/four.test.mjs']],
      ['tests/one.test.mjs', ['tests/nested-from-test.test.mjs']]
    ]);
    const hits = collectMultiHopTestsFromReverseAdj(revAdj, ['./a.mjs', 'a.mjs'], 3);
    expect(hits).toEqual([
      { file: 'tests/one.test.mjs', hops: 1, path: ['a.mjs', 'tests/one.test.mjs'] },
      { file: 'tests/two.test.mjs', hops: 2, path: ['a.mjs', 'b.mjs', 'tests/two.test.mjs'] },
      { file: 'tests/three.test.mjs', hops: 3, path: ['a.mjs', 'b.mjs', 'c.mjs', 'tests/three.test.mjs'] }
    ]);
    expect(hits.some((h) => h.file === 'tests/four.test.mjs')).toBe(false);
    expect(hits.some((h) => h.file === 'tests/nested-from-test.test.mjs')).toBe(false);
  });

  it('S6 真仓验收：impact cockpit-render.mjs 经 3 跳反向导入闭包检出 blindfold 与 stage3 单测且建议命令去重', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const rText = dispatchCommand(['impact', 'runner/cockpit/cockpit-render.mjs'], REPO_ROOT);
    expect(rText.exitCode).toBe(0);
    expect(rText.stdout).toContain('多跳覆盖单测（≤3 跳');
    expect(rText.stdout).toContain('tests/cockpit-zoom-blindfold.test.mjs');
    expect(rText.stdout).toContain('runner/cockpit/cockpit-commands.mjs ← runner/donegate.mjs ← tests/cockpit-zoom-blindfold.test.mjs');
    expect(rText.stdout).toMatch(/\n— 本视图约 \d+ tok —$/);

    const rJson = dispatchCommand(['impact', 'runner/cockpit/cockpit-render.mjs', '--json'], REPO_ROOT);
    expect(rJson.exitCode).toBe(0);
    const parsed = JSON.parse(rJson.stdout);
    const blindfoldHit = parsed.multiHopTests.find((t) => t.file === 'tests/cockpit-zoom-blindfold.test.mjs');
    expect(blindfoldHit).toBeDefined();
    expect(blindfoldHit.hops).toBe(3);
    expect(blindfoldHit.path).toHaveLength(4);
    expect(parsed.multiHopTests.some((t) => t.file === 'tests/stage3-impact-public-parity.test.mjs')).toBe(true);

    const cmdTokens = parsed.suggestedVitestCommand.replace(/^npx vitest run\s+/, '').split(/\s+/).filter(Boolean);
    expect(new Set(cmdTokens).size).toBe(cmdTokens.length);
  });

  it('S6 边界鲁棒性：坏句柄/空表/已关闭 SQLite 降级返回 []，且兼容 Windows 反斜杠与原型键名', () => {
    expect(irInferMultiHopTests(REPO_ROOT, ['a.mjs'], { handle: { db: {}, project: 'p' } })).toEqual([]);
    const emptyDb = new DatabaseSync(':memory:');
    expect(irInferMultiHopTests(REPO_ROOT, ['a.mjs'], { handle: { db: emptyDb, project: 'p' } })).toEqual([]);
    emptyDb.close();
    expect(irInferMultiHopTests(REPO_ROOT, ['a.mjs'], { handle: { db: emptyDb, project: 'p' } })).toEqual([]);

    const winMap = new Map([
      ['a\\b.mjs', ['tests\\t.test.mjs']],
      ['././x\\y.mjs', ['tests\\u.test.mjs']]
    ]);
    expect(collectMultiHopTestsFromReverseAdj(winMap, ['a/b.mjs'], 3)).toEqual([
      { file: 'tests/t.test.mjs', hops: 1, path: ['a/b.mjs', 'tests/t.test.mjs'] }
    ]);
    expect(collectMultiHopTestsFromReverseAdj(winMap, ['././x/y.mjs'], 3)).toEqual([
      { file: 'tests/u.test.mjs', hops: 1, path: ['x/y.mjs', 'tests/u.test.mjs'] }
    ]);
    expect(collectMultiHopTestsFromReverseAdj({ toString: ['tests/t.test.mjs'] }, ['constructor'], 3)).toEqual([]);
  });

  it('S6 合成 SQLite 图谱：隔离 project、支持 File->Module IMPORTS 且排除嵌套 node_modules 与归档目录', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, project TEXT, label TEXT, file_path TEXT);
      CREATE TABLE edges (id INTEGER PRIMARY KEY, project TEXT, source_id INTEGER, target_id INTEGER, type TEXT);
      INSERT INTO nodes VALUES
        (1, 'projA', 'Module', 'src/core.mjs'),
        (2, 'projA', 'File', 'src/mid.mjs'),
        (3, 'projA', 'File', 'tests/alpha.test.mjs'),
        (4, 'projA', 'File', 'packages/foo/node_modules/bar/sub.test.mjs'),
        (5, 'projA', 'File', '归档/pilots/pilot-score-fixtures.mjs'),
        (6, 'projB', 'File', 'tests/other-proj.test.mjs'),
        (7, 'projB', 'Module', 'src/core.mjs');
      INSERT INTO edges VALUES
        (1, 'projA', 2, 1, 'IMPORTS'),
        (2, 'projA', 3, 2, 'IMPORTS'),
        (3, 'projA', 4, 1, 'IMPORTS'),
        (4, 'projA', 5, 1, 'IMPORTS'),
        (5, 'projB', 6, 7, 'IMPORTS');
    `);
    try {
      const hits = irInferMultiHopTests(REPO_ROOT, ['src/core.mjs'], { handle: { db, project: 'projA' } });
      expect(hits).toEqual([
        { file: 'tests/alpha.test.mjs', hops: 2, path: ['src/core.mjs', 'src/mid.mjs', 'tests/alpha.test.mjs'] }
      ]);
    } finally {
      db.close();
    }
  });
});
