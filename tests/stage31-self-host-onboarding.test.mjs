import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Stage 31: Zero-guess self-hosting onboarding closure', () => {
  it('supports atomic multi-file patches[] via donegate patch-edit --spec and rolls back cleanly on failure', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-batch-patch-'));
    try {
      writeFileSync(join(tmp, 'a.mjs'), 'export function alpha() {\n  return 1;\n}\n', 'utf8');
      writeFileSync(join(tmp, 'b.mjs'), 'export function beta() {\n  return 2;\n}\n', 'utf8');

      writeFileSync(
        join(tmp, 'bad-spec.json'),
        JSON.stringify({
          patches: [
            { file: 'a.mjs', oldText: 'return 1;', newText: 'return 10;' },
            { file: 'b.mjs', oldText: 'return 999;', newText: 'return 20;' }
          ]
        }),
        'utf8'
      );
      const badRes = dispatchCommand(['patch-edit', '--spec', 'bad-spec.json', '--json'], tmp);
      expect(badRes.exitCode).toBe(1);
      expect(readFileSync(join(tmp, 'a.mjs'), 'utf8')).toContain('return 1;');

      writeFileSync(
        join(tmp, 'ok-spec.json'),
        JSON.stringify({
          patches: [
            { file: 'a.mjs', oldText: 'return 1;', newText: 'return 10;' },
            { file: 'b.mjs', oldText: 'return 2;', newText: 'return 20;' }
          ]
        }),
        'utf8'
      );
      const okRes = dispatchCommand(['patch-edit', '--spec', 'ok-spec.json', '--json'], tmp);
      expect(okRes.exitCode).toBe(0);
      const parsed = JSON.parse(okRes.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.batchCount).toBe(2);
      expect(readFileSync(join(tmp, 'a.mjs'), 'utf8')).toContain('return 10;');
      expect(readFileSync(join(tmp, 'b.mjs'), 'utf8')).toContain('return 20;');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exposes selfHostArsenal, crossFileSyncInvariants, and --spec help without hunting source files', () => {
    const helpRes = dispatchCommand(['--help'], REPO_ROOT);
    expect(helpRes.exitCode).toBe(0);
    expect(helpRes.stdout).toContain('--spec <json|->');
    expect(helpRes.stdout).toContain('patches[]');

    const rulesRes = dispatchCommand(['zoom', 'rules'], REPO_ROOT);
    expect(rulesRes.exitCode).toBe(0);
    const rulesJson = JSON.parse(rulesRes.stdout);
    expect(rulesJson.selfHostArsenal?.atomicPatchEdit).toContain('patch-edit --spec');
    expect(Array.isArray(rulesJson.crossFileSyncInvariants)).toBe(true);
    expect(rulesJson.crossFileSyncInvariants.length).toBeGreaterThanOrEqual(6);
  });
});
