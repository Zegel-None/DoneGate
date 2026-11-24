import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { lintEditedFiles } from '../skill/lint-edit.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Stage 1 · 派生台账松绑与单文件毫秒级 ACI 微门禁 (lint-edit)', () => {
  it('donegate lint-edit 在真实仓库单文件上毫秒级返回结构化诊断', () => {
    const res = dispatchCommand(['lint-edit', 'runner/donegate.mjs', 'runner/atlas/wb-snap-rulers.mjs', '--json'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0].ok).toBe(true);
    if (existsSync(join(REPO_ROOT, 'contracts'))) {
      expect(parsed.files[0].owners).toContain('verdict-core');
    }
    expect(parsed.files[1].ok).toBe(true);
  });

  it('lint-edit 精准捕获内联浏览器脚本漏挂 WB_*_FNS、C4g 压行、M6 行数超限与语法错误', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s1-aci-'));
    try {
      mkdirSync(join(tmp, 'runner/atlas'), { recursive: true });
      mkdirSync(join(tmp, 'runner/core'), { recursive: true });
      const badWb = [
        'function wbTestHelper(a) {',
        '  return a * 2;',
        '}',
        'export function wbTestEntry(a) {',
        '  return wbTestHelper(a);',
        '}',
        'const WB_TEST_FNS = [wbTestEntry];',
        'export function buildWbTest() {',
        '  return WB_TEST_FNS.map((f) => f.toString()).join("\\n");',
        '}'
      ].join('\n');
      writeFileSync(join(tmp, 'runner/atlas/wb-test.mjs'), badWb, 'utf8');
      const r1 = lintEditedFiles(tmp, ['runner/atlas/wb-test.mjs']);
      expect(r1.exitCode).toBe(1);
      expect(r1.fails.some((f) => f.includes('wbTestHelper') && f.includes('WB_TEST_FNS'))).toBe(true);

      writeFileSync(join(tmp, 'runner/core/syntax-bad.mjs'), 'export function broken( {\n  return 1;\n}\n', 'utf8');
      const r2 = lintEditedFiles(tmp, ['runner/core/syntax-bad.mjs']);
      expect(r2.exitCode).toBe(1);
      expect(r2.fails.some((f) => f.includes('M1 JS/ESM 语法错误'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('母仓功能总览生成器不再包含脆弱的单文件物理行数指标，纯内部重构零漂移', async () => {
    const genPath = join(REPO_ROOT, 'skill', 'gen-feature-overview.mjs');
    if (!existsSync(genPath)) {
      expect(existsSync(join(REPO_ROOT, 'runner/donegate.mjs'))).toBe(true);
      return;
    }
    const { buildFeatureOverviewMarkdown } = await import(genPath);
    const { markdown } = buildFeatureOverviewMarkdown(REPO_ROOT);
    expect(markdown).not.toContain('| SKILL.md 行数 |');
    expect(markdown).toContain('| 配套参考卡 |');
    expect(markdown).toContain('| 导出规模 |');
  });
});
