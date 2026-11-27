// Stage 21 · Agentless 式文件骨架视图 (buildFileSkeleton + donegate zoom --skeleton) 单测
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { buildFileSkeleton, estimateTokens, resolveCbmBinary } from '../runner/core/index.mjs';
import { readExportTruth } from '../runner/core/cbm-export-truth.mjs';
import { cmdLocate } from '../runner/cockpit/cockpit-locate.mjs';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function collectProdMjsFiles(rootDir) {
  const dirs = ['runner', 'skill'];
  if (existsSync(join(rootDir, 'tools'))) dirs.push('tools');
  const files = [];
  const walk = (absDir) => {
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.deps') continue;
        walk(abs);
      } else if (ent.isFile() && ent.name.endsWith('.mjs')) {
        const rel = relative(rootDir, abs).split(sep).join('/');
        if (!rel.endsWith('-fixtures.mjs')) files.push(rel);
      }
    }
  };
  for (const d of dirs) {
    const abs = join(rootDir, d);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs);
  }
  return files.sort();
}

describe('Stage 21 · Agentless 式文件骨架视图 (zoom --skeleton)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-skeleton-test-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('① cockpit-cbm.mjs 骨架含全部真导出签名（含 kneedleElbowCount 重导出），不含函数体内部语句', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const skel = buildFileSkeleton(REPO_ROOT, 'runner/core/cockpit-cbm.mjs');
    expect(skel).not.toBeNull();
    expect(skel.text).toContain('imports: node:child_process, node:fs');
    expect(skel.text).toContain("export { kneedleElbowCount } from './cbm-export-truth.mjs'");

    const truth = readExportTruth(REPO_ROOT, 'runner/core/cockpit-cbm.mjs');
    expect(truth.size).toBeGreaterThanOrEqual(7);
    for (const name of truth) {
      expect(skel.text).toContain(name);
    }

    expect(skel.text).not.toContain('CBM_MEM_CACHE.set');
    expect(skel.text).not.toContain('new DatabaseSync(');
    expect(skel.text).not.toContain('createRequire(import.meta.url)');
    expect(skel.text).not.toContain('process.emitWarning');
    expect(skel.text).not.toContain('parseJsonProps(r.properties)');
    expect(skel.skeletonTokens).toBe(estimateTokens(skel.text));
    expect(skel.skeletonTokens).toBeLessThan(skel.rawTokens);
  });

  it('② 全仓生产 .mjs 文件骨架平均压缩率 >= 80%', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const files = collectProdMjsFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(50);

    let sumRatio = 0;
    let count = 0;
    for (const rel of files) {
      const skel = buildFileSkeleton(REPO_ROOT, rel);
      expect(skel).not.toBeNull();
      if (skel.rawTokens > 0) {
        sumRatio += (1 - skel.skeletonTokens / skel.rawTokens);
        count++;
      }
    }
    const avgCompression = sumRatio / count;
    expect(avgCompression).toBeGreaterThanOrEqual(0.8);
  });

  it('③ 嵌套函数不出现于顶层、常量单行 120 字截断、支持 Python/TS 语法及 maxTokens 截断', () => {
    if (resolveCbmBinary(REPO_ROOT)) {
      const cmdSkel = buildFileSkeleton(REPO_ROOT, 'runner/cockpit/cockpit-commands.mjs');
      expect(cmdSkel).not.toBeNull();
      expect(cmdSkel.text).toContain('ckcComputeContractLayers(nodes)');
      expect(cmdSkel.text).not.toContain('depthOf');
      expect(cmdSkel.text).toContain('CKC_CAPSULE_BUDGET_TOK = 160000');
    }

    expect(buildFileSkeleton(REPO_ROOT, '../outside.mjs')).toBeNull();
    expect(buildFileSkeleton(REPO_ROOT, 'runner/core/nonexistent-skeleton.mjs')).toBeNull();

    const longVal = 'x'.repeat(160);
    writeFileSync(join(tmp, 'sample.ts'), [
      '/**',
      ' * TypeScript sample header',
      ' */',
      "import { alpha } from './alpha';",
      "import type { Beta } from './beta';",
      `export const LONG_CONST = '${longVal}';`,
      'export class Service {',
      '  run(): void {',
      '    const inner = 1;',
      '    return;',
      '  }',
      '}',
      'export function topFn(a: number): number {',
      '  function nestedFn() { return 0; }',
      '  return a + nestedFn();',
      '}'
    ].join('\n'), 'utf8');

    const tsSkel = buildFileSkeleton(tmp, 'sample.ts', {
      symbols: [
        { name: 'LONG_CONST', label: 'Variable', startLine: 6, endLine: 6 },
        { name: 'Service', label: 'Class', startLine: 7, endLine: 12 },
        { name: 'run', label: 'Method', startLine: 8, endLine: 11 },
        { name: 'inner', label: 'Variable', startLine: 9, endLine: 9 },
        { name: 'topFn', label: 'Function', startLine: 13, endLine: 16 },
        { name: 'nestedFn', label: 'Function', startLine: 14, endLine: 14 }
      ]
    });
    expect(tsSkel).not.toBeNull();
    expect(tsSkel.text).toContain('// TypeScript sample header');
    expect(tsSkel.text).toContain('imports: ./alpha, ./beta');
    expect(tsSkel.text).toContain('L6: export const LONG_CONST =');
    expect(tsSkel.text).toContain('…');
    expect(tsSkel.text).toContain('L7: export class Service {  … { 6 行 }');
    expect(tsSkel.text).toContain('L13: export function topFn(a: number): number {  … { 4 行 }');
    expect(tsSkel.text).not.toContain('run(): void');
    expect(tsSkel.text).not.toContain('inner = 1');
    expect(tsSkel.text).not.toContain('nestedFn');

    const capped = buildFileSkeleton(tmp, 'sample.ts', {
      maxTokens: 25,
      symbols: [
        { name: 'LONG_CONST', label: 'Variable', startLine: 6, endLine: 6 },
        { name: 'Service', label: 'Class', startLine: 7, endLine: 12 },
        { name: 'topFn', label: 'Function', startLine: 13, endLine: 16 }
      ]
    });
    expect(capped.skeletonTokens).toBeLessThanOrEqual(25);
    expect(capped.text).toContain('已省略');

    const tinyCapped = buildFileSkeleton(tmp, 'sample.ts', {
      maxTokens: 5,
      symbols: [{ name: 'LONG_CONST', label: 'Variable', startLine: 6, endLine: 6 }]
    });
    expect(tinyCapped.skeletonTokens).toBeLessThanOrEqual(5);

    writeFileSync(join(tmp, 'worker.py'), [
      '#!/usr/bin/env python3',
      '# Python module summary',
      'import os, sys as system_mod',
      'from pathlib import (',
      '    Path,',
      ')',
      '',
      '# Build widget helper',
      'def build_widget(name):',
      '    def inner_helper():',
      '        return name',
      '    return inner_helper()',
      '',
      'class Engine:',
      '    def step(self):',
      '        pass'
    ].join('\n'), 'utf8');

    const pySkel = buildFileSkeleton(tmp, 'worker.py', {
      symbols: [
        { name: 'build_widget', label: 'Function', startLine: 9, endLine: 12 },
        { name: 'inner_helper', label: 'Function', startLine: 10, endLine: 11 },
        { name: 'Engine', label: 'Class', startLine: 14, endLine: 16 },
        { name: 'step', label: 'Method', startLine: 15, endLine: 16 }
      ]
    });
    expect(pySkel).not.toBeNull();
    expect(pySkel.text).toContain('# Python module summary');
    expect(pySkel.text).toContain('imports: os, sys, pathlib');
    expect(pySkel.text).toContain('# Build widget helper');
    expect(pySkel.text).toContain('L9: def build_widget(name):  … { 4 行 }');
    expect(pySkel.text).toContain('L14: class Engine:  … { 3 行 }');
    expect(pySkel.text).not.toContain('inner_helper');
    expect(pySkel.text).not.toContain('def step');
  });

  it('④ CLI donegate zoom --skeleton 在任意参数位、符号高亮、--source 覆盖与缺目标退 1 均正确', () => {
    const f1 = dispatchCommand(['zoom', '--skeleton', 'runner/core/cockpit-cbm.mjs'], REPO_ROOT);
    const f2 = dispatchCommand(['zoom', 'runner/core/cockpit-cbm.mjs', '--skeleton'], REPO_ROOT);
    expect(f1.exitCode).toBe(0);
    expect(f2.exitCode).toBe(0);
    expect(f1.stdout).toBe(f2.stdout);
    expect(f1.stdout).toContain('=== [Zoom-2 文件骨架视图] runner/core/cockpit-cbm.mjs');
    expect(f1.stdout).toContain('末步直读源码: node runner/donegate.mjs zoom runner/core/cockpit-cbm.mjs:1-');

    const srcOverride = dispatchCommand(['zoom', 'runner/core/cockpit-cbm.mjs:1-5', '--skeleton', '--source'], REPO_ROOT);
    expect(srcOverride.exitCode).toBe(0);
    expect(srcOverride.stdout).toContain('=== [末步源码真源直读]');
    expect(srcOverride.stdout).not.toContain('=== [Zoom-2 文件骨架视图]');

    const missing = dispatchCommand(['zoom', 'runner/core/no_such_skeleton_file.mjs', '--skeleton'], REPO_ROOT);
    expect(missing.exitCode).toBe(1);

    if (!resolveCbmBinary(REPO_ROOT)) return;

    expect(f1.stdout).toMatch(/骨架约 \d+ tok \/ 原文约 \d+ tok（压缩 \d+%）/);

    const symZoom = dispatchCommand(['zoom', 'kneedleElbowCount', '--skeleton'], REPO_ROOT);
    expect(symZoom.exitCode).toBe(0);
    expect(symZoom.stdout).toContain('▶ L15: export function kneedleElbowCount');
    expect(symZoom.stdout).toMatch(/骨架约 \d+ tok \/ 原文约 \d+ tok（压缩 \d+%）/);

    const nestedSymZoom = dispatchCommand(['zoom', 'depthOf', '--skeleton'], REPO_ROOT);
    expect(nestedSymZoom.exitCode).toBe(0);
    expect(nestedSymZoom.stdout).toContain('↳ 命中嵌套符号 depthOf');
    expect(nestedSymZoom.stdout).toMatch(/▶ L\d+: function ckcComputeContractLayers/);
  });

  it('⑤ 回归防护：越界 startLine 不崩溃、无分号 export * 不吞行、行尾块注释与多行 import 注释不误提取', () => {
    writeFileSync(join(tmp, 'oob.mjs'), 'export function alive() { return 1; }\n', 'utf8');
    const oobSkel = buildFileSkeleton(tmp, 'oob.mjs', {
      symbols: [
        { name: 'alive', label: 'Function', startLine: 1, endLine: 1 },
        { name: 'ghost', label: 'Function', startLine: 99, endLine: 105 },
        { name: 'badRange', label: 'Function', startLine: 5, endLine: 2 }
      ]
    });
    expect(oobSkel).not.toBeNull();
    expect(oobSkel.text).toContain('L1: export function alive()');
    expect(oobSkel.text).not.toContain('L99:');
    expect(oobSkel.text).not.toContain('L5:');

    writeFileSync(join(tmp, 'swallow.mjs'), [
      "export * from './a.mjs'",
      "export * as ns from './ns.mjs'",
      "import { realDep } from './b.mjs';",
      'export function fn() { return realDep(); }'
    ].join('\n'), 'utf8');
    const swallowSkel = buildFileSkeleton(tmp, 'swallow.mjs', {
      symbols: [{ name: 'fn', label: 'Function', startLine: 4, endLine: 4 }]
    });
    expect(swallowSkel).not.toBeNull();
    expect(swallowSkel.text).toContain('imports: ./b.mjs');
    expect(swallowSkel.text).toContain("L1: export * from './a.mjs'");
    expect(swallowSkel.text).toContain("L2: export * as ns from './ns.mjs'");
    expect(swallowSkel.text).toContain('L4: export function fn()');

    writeFileSync(join(tmp, 'inline-comment.mjs'), [
      'const x = 1; /* inline end */',
      'export function afterInline() { return x; }',
      'const y = 2; /* multi start',
      '   multi end */',
      'export function afterMultiInline() { return y; }'
    ].join('\n'), 'utf8');
    const inlineSkel = buildFileSkeleton(tmp, 'inline-comment.mjs', {
      symbols: [
        { name: 'x', label: 'Variable', startLine: 1, endLine: 1 },
        { name: 'afterInline', label: 'Function', startLine: 2, endLine: 2 },
        { name: 'y', label: 'Variable', startLine: 3, endLine: 3 },
        { name: 'afterMultiInline', label: 'Function', startLine: 5, endLine: 5 }
      ]
    });
    expect(inlineSkel).not.toBeNull();
    expect(inlineSkel.text).not.toContain('// const x = 1');
    expect(inlineSkel.text).not.toContain('// const y = 2');
    expect(inlineSkel.text).not.toContain('// multi end');
    expect(inlineSkel.text).toContain('L2: export function afterInline()');
    expect(inlineSkel.text).toContain('L5: export function afterMultiInline()');

    writeFileSync(join(tmp, 'hijack-import.mjs'), [
      "import { // from 'evil_comment'",
      '  realExport',
      "} from './real-mod.mjs';",
      'export function run() { return realExport; }'
    ].join('\n'), 'utf8');
    const hijackSkel = buildFileSkeleton(tmp, 'hijack-import.mjs', {
      symbols: [{ name: 'run', label: 'Function', startLine: 4, endLine: 4 }]
    });
    expect(hijackSkel).not.toBeNull();
    expect(hijackSkel.text).toContain('imports: ./real-mod.mjs');
    expect(hijackSkel.text).not.toContain('evil_comment');
  });

  it('⑥ donegate locate 候选摘要集成真实 buildFileSkeleton（含 imports/行号声明，无旧摘要/导出占位）', () => {
    if (!resolveCbmBinary(REPO_ROOT)) return;

    const res = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: 800 });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/^\s+imports:\s+/m);
    expect(res.stdout).toMatch(/^\s+L\d+:\s+/m);
    expect(res.stdout).toMatch(/^\s+依据:\s+/m);
    expect(res.stdout).not.toContain('   摘要: ');
    expect(res.stdout).not.toContain('   导出: ');

    const res200 = cmdLocate(REPO_ROOT, { query: '承重接口 Kneedle', budget: 200 });
    expect(res200.exitCode).toBe(0);
    expect(estimateTokens(res200.stdout)).toBeLessThanOrEqual(200);
    expect(res200.stdout).toMatch(/^\s+imports:\s+/m);
  });
});
