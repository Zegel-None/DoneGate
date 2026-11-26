// Stage 13 测试：Python 一等公民（假 PASS 止血、ast-stub 类型注解无截断、Python 跨卡红线、默认治理流自动激活与 init 探测）
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditRepository4DWithStats } from '../skill/cognitive-complexity.mjs';
import {
  buildNodeInterfaceStub,
  extractFileInterfaceStub,
  extractPythonImportTargets,
  probeTreeSitterWasmCell
} from '../runner/core/contract.mjs';
import { computeThreeColorEdges } from '../runner/core/graph-edges.mjs';
import { cmdInit } from '../runner/core/cmd-lifecycle.mjs';
import { wfcCompileWorkflow, wfcProbeEnvCoeffects } from '../runner/dsh/autopilot/workflow-compiler.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('Stage 13: Python 一等公民支持与假 PASS 止血', () => {
  it('Python 仓库跑 check-commit-hygiene --audit-repo 绝不出现 0 文件假 PASS', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s13-py-audit-'));
    try {
      mkdirSync(join(tmp, 'src', 'mech'), { recursive: true });
      writeFileSync(join(tmp, 'pyproject.toml'), '[project]\nname = "mech"\n', 'utf8');
      writeFileSync(join(tmp, 'src', 'mech', 'draft.py'), 'def create_draft_from_markdown_or_csv(path: str) -> dict:\n    return {}\n', 'utf8');

      const stats = auditRepository4DWithStats(tmp, { warnCognitiveComplexity: 15, maxCognitiveComplexity: 25 });
      expect(stats.scannedJsFiles).toBe(0);
      expect(stats.detectedPyFiles).toBe(1);

      const cli = spawnSync(process.execPath, [join(REPO_ROOT, 'skill/check-commit-hygiene.mjs'), '--audit-repo', '--root', tmp, '--json'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: '' }
      });
      expect(cli.status).toBe(3);
      const parsed = JSON.parse(cli.stdout);
      expect(parsed.status).toBe('SKIPPED_PYTHON_UNSCANNED');
      expect(parsed.detectedPyFiles).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ast-stub 完整保留 Python 类型注解与类方法（不再在第一个冒号截断）且识别 __init__.py 门面', () => {
    const pyCode = [
      'class Compiler:',
      '    def __init__(self, strict: bool = True) -> None:',
      '        self.strict = strict',
      '    def compile_ir(self, spec: dict[str, int], mode: str = "safe") -> list[str]:',
      '        return []',
      '',
      'def create_draft_from_markdown_or_csv(path: str, opts: dict[str, object] = {}) -> dict:',
      '    return {}',
      ''
    ].join('\n');
    const stub = extractFileInterfaceStub(pyCode, 'src/mech/compiler.py');
    const sigs = stub.exports.map((e) => e.signature);
    expect(sigs.some((s) => s.includes('def create_draft_from_markdown_or_csv(path: str') && s.includes('-> dict: ...'))).toBe(true);
    expect(sigs.some((s) => s.includes('def compile_ir(self, spec: dict[str, int]') && s.includes('-> list[str]: ...'))).toBe(true);

    const tmp = mkdtempSync(join(tmpdir(), 'dg-s13-py-barrel-'));
    try {
      mkdirSync(join(tmp, 'src', 'pkg'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'pkg', '__init__.py'), 'def public_entry(x: int) -> int:\n    return x\n', 'utf8');
      writeFileSync(join(tmp, 'src', 'pkg', 'internal.py'), 'def helper(y: str) -> str:\n    return y\n', 'utf8');
      const nodeStub = buildNodeInterfaceStub(tmp, { id: 'pkg-node', scope: ['src/pkg/'] });
      expect(nodeStub.facadeMode).toBe('barrel');
      expect(nodeStub.facadeFiles).toContain('src/pkg/__init__.py');
      expect(probeTreeSitterWasmCell(tmp).engine).toBe('zero-dep-balanced-scanner');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('共享 Python 导入解析器准确识别跨契约导入红线与相对包导入', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s13-py-graph-'));
    try {
      mkdirSync(join(tmp, 'src', 'kb'), { recursive: true });
      mkdirSync(join(tmp, 'src', 'sw'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'kb', '__init__.py'), 'def lookup() -> int:\n    return 1\n', 'utf8');
      writeFileSync(join(tmp, 'src', 'sw', 'builder.py'), 'from kb import lookup\ndef run() -> int:\n    return lookup()\n', 'utf8');

      const files = ['src/kb/__init__.py', 'src/sw/builder.py'];
      const targets = extractPythonImportTargets('src/sw/builder.py', readFileSync(join(tmp, 'src/sw/builder.py'), 'utf8'), new Set(files));
      expect(targets).toEqual(['src/kb/__init__.py']);

      const contracts = [
        { id: 'kb-core', scope: ['src/kb/'], dependsOn: [] },
        { id: 'sw-bridge', scope: ['src/sw/'], dependsOn: [] }
      ];
      const edges = computeThreeColorEdges(tmp, contracts, files);
      expect(edges.red).toEqual([{ from: 'sw-bridge', to: 'kb-core' }]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wfcProbeEnvCoeffects 自动探测 Python 仓库并在默认治理流激活 ruff/complexipy/pytest，donegate init 写入 pytest 冒烟命令', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s13-py-flow-'));
    try {
      writeFileSync(join(tmp, 'pyproject.toml'), '[project]\nname = "cad-ir"\n', 'utf8');
      const env = wfcProbeEnvCoeffects(tmp);
      expect(env.hasPython).toBe(true);

      const editFlow = wfcCompileWorkflow(tmp, 'dg-on-edit').effectivePack;
      const pcFlow = wfcCompileWorkflow(tmp, 'dg-pre-commit').effectivePack;
      const chkFlow = wfcCompileWorkflow(tmp, 'dg-on-check').effectivePack;
      expect(Boolean(editFlow.nodes.find((n) => n.id === 'edit-py-ruff')?.envSkipped)).toBe(false);
      expect(Boolean(pcFlow.nodes.find((n) => n.id === 'pc-py-complexipy')?.envSkipped)).toBe(false);
      expect(Boolean(chkFlow.nodes.find((n) => n.id === 'chk-py-pytest')?.envSkipped)).toBe(false);

      const jsEnv = wfcProbeEnvCoeffects(REPO_ROOT);
      expect(jsEnv.hasPython).toBe(false);
      const jsPcFlow = wfcCompileWorkflow(REPO_ROOT, 'dg-pre-commit').effectivePack;
      expect(jsPcFlow.nodes.find((n) => n.id === 'pc-py-complexipy')?.envSkipped).toBe(true);

      const initRes = cmdInit(tmp);
      expect(initRes.exitCode).toBe(0);
      expect(readFileSync(join(tmp, 'INTENT.md'), 'utf8')).toContain('冒烟命令：pytest --collect-only -q');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
