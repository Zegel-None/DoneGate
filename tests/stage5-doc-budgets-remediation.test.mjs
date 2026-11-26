// Stage 5 单测：文档词数预算、Slop Checklist、thresholds 扩展配置与 lint-edit 可执行修复配方
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDocBudgets } from '../skill/check-doc-budgets.mjs';
import { cmdLintEdit, lintEditedFiles } from '../skill/lint-edit.mjs';
import { resolveLintFixHint } from '../skill/lint-edit/remediation.mjs';
import { readJsonStrict } from '../skill/io.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Stage 5 · 文档预算闸门、Slop Checklist 与 lint-edit 修复配方', () => {
  it('当前仓库 AGENTS.md 严格落入 8 KB / 130 行预算，且 thresholds.json 含 docBudgets/harnessProfiles/autopilotLimits', () => {
    const rep = auditDocBudgets(REPO_ROOT);
    expect(rep.exitCode).toBe(0);
    expect(rep.files.some((f) => f.file === 'AGENTS.md' && f.byteSize <= 8192 && f.lineCount <= 130)).toBe(true);

    const thPath = join(REPO_ROOT, 'thresholds.json');
    if (existsSync(thPath)) {
      const th = readJsonStrict(thPath);
      expect(th.ok).toBe(true);
      if (th.value.docBudgets) {
        expect(th.value.docBudgets.rootAgentsMaxBytes).toBe(8192);
        expect(th.value.autopilotLimits.maxSelfHealRounds).toBe(2);
        expect(th.value.autopilotLimits.maxSubagentTools).toBe(10);
        expect(th.value.harnessProfiles['frontier-1m'].contextWindowTokens).toBe(1000000);
      }
    }
  });

  it('check-doc-budgets 精准拦截超字节根文档、超行子树文档、重复章节与超长段落墙', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s5-doc-'));
    try {
      mkdirSync(join(tmp, 'pkg'), { recursive: true });
      const wall = Array.from({ length: 16 }, (_, i) => `这是连续未分段说明第 ${i + 1} 行内容。`).join('\n');
      writeFileSync(join(tmp, 'AGENTS.md'), `# AGENTS\n\n## 铁律\n\n${wall}\n\n## 铁律\n\n临时占位 待补充\n`, 'utf8');
      const res = auditDocBudgets(tmp);
      expect(res.exitCode).toBe(1);
      expect(res.fails.some((f) => f.includes('DB3'))).toBe(true);
      expect(res.fails.some((f) => f.includes('DB4'))).toBe(true);
      expect(res.fails.some((f) => f.includes('DB5'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lint-edit 对 C4g、M6、术语漂移与漏挂 WB_*_FNS 输出结构化 fixHint 与终端修复配方', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s5-remed-'));
    try {
      mkdirSync(join(tmp, 'runner/core'), { recursive: true });
      writeFileSync(join(tmp, 'runner/core/bad.mjs'), 'export function bad(a, b) { let x = a + 1; let y = b + 2; let z = x + y; return z; }\n', 'utf8');
      const rawRes = lintEditedFiles(tmp, ['runner/core/bad.mjs']);
      expect(rawRes.exitCode).toBe(1);
      expect(rawRes.failDetails.some((d) => d.message.includes('C4g') && d.fixHint.includes('标准多行'))).toBe(true);

      const cliRes = cmdLintEdit(tmp, { files: ['runner/core/bad.mjs'] });
      expect(cliRes.exitCode).toBe(1);
      expect(cliRes.stdout).toContain('↳ 修复配方：');
      expect(resolveLintFixHint('M6 核心子模块超行数硬顶 (runner/core/x.mjs)')).toContain('伴生子模块');
      expect(resolveLintFixHint('术语漂移 [T1]')).toContain('归一化术语');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
