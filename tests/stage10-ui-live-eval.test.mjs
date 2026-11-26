// Stage 10：UI 四维美学 Rubric 评分、无头浏览器运行态评估（console/page/HTTP 错误 + 死按钮）与 /uiboard/live-eval 路由单测
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateUiAestheticsRubric, UI_AESTHETICS_RUBRIC_DIMENSIONS } from '../runner/dsh/uiboard/ui-aesthetics.mjs';
import { runUiLiveEvaluation, uleResolvePlaywrightModule, uleValidateLocalTargetUrl } from '../runner/dsh/uiboard/ui-live-evaluator.mjs';
import { handleUiBoardSubRoute } from '../runner/dsh/host/ui-board-routes.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('stage10: UI 4-dim aesthetics rubric & live browser evaluator', () => {
  it('scores clean token-driven HTML high and penalizes AI slop + runtime faults', () => {
    expect(UI_AESTHETICS_RUBRIC_DIMENSIONS.map((d) => d.id)).toEqual([
      'designQuality', 'originality', 'craft', 'functionality'
    ]);

    const cleanHtml = `<!doctype html><html><head><style>:root{--ui-bg:#fafafa;}button:focus-visible{outline:2px solid #1d4ed8;}</style></head>
      <body><main data-ui-owner="runner/atlas/ui-shell.mjs"><button id="go">提交</button></main></body></html>`;
    const good = evaluateUiAestheticsRubric(cleanHtml, { consoleErrorCount: 0, pageErrorCount: 0, httpErrorCount: 0, deadButtonCount: 0 });
    expect(good.pass).toBe(true);
    expect(good.totalScore).toBe(100);

    const slopHtml = `<div style="background:linear-gradient(90deg, #8b5cf6, #ec4899)"><button>🚀</button></div>`;
    const bad = evaluateUiAestheticsRubric(slopHtml, { consoleErrorCount: 1, pageErrorCount: 1, deadButtonCount: 1 });
    expect(bad.pass).toBe(false);
    expect(bad.dimensions.originality).toBeLessThan(50);
    expect(bad.dimensions.functionality).toBeLessThan(50);
    expect(bad.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects non-loopback targets with exit 2 and degrades cleanly to exit 3 when Playwright is absent', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-stage10-ui-'));
    try {
      expect(uleValidateLocalTargetUrl('http://127.0.0.1:4173/app').ok).toBe(true);
      expect(uleValidateLocalTargetUrl('https://evil.example.com/').ok).toBe(false);

      const nonLoop = await runUiLiveEvaluation(tmp, { url: 'https://example.com/' });
      expect(nonLoop.ok).toBe(false);
      expect(nonLoop.exitCode).toBe(2);
      expect(nonLoop.code).toBe('NON_LOOPBACK_TARGET');

      const degraded = await runUiLiveEvaluation(tmp, {
        htmlContent: '<html><body><button>ok</button></body></html>',
        simulateMissingPlaywright: true
      });
      expect(degraded.ok).toBe(false);
      expect(degraded.exitCode).toBe(3);
      expect(degraded.code).toBe('PLAYWRIGHT_UNAVAILABLE');
      expect(degraded.degraded).toBe(true);

      let status = 0;
      let raw = '';
      const handled = await handleUiBoardSubRoute(
        { method: 'POST', url: '/donegate/api/uiboard/live-eval', headers: {} },
        { writeHead(s) { status = s; }, end(c) { raw = String(c || ''); } },
        '/uiboard/live-eval',
        tmp,
        { emit() {} },
        async () => ({ htmlContent: '<html><body></body></html>', simulateMissingPlaywright: true })
      );
      expect(handled).toBe(true);
      expect(status).toBe(200);
      expect(JSON.parse(raw).code).toBe('PLAYWRIGHT_UNAVAILABLE');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runs real headless Chromium live evaluation when Playwright is provisioned in the workspace', async () => {
    const probe = uleResolvePlaywrightModule(REPO_ROOT);
    if (!probe.available) return;

    const brokenHtml = `<!doctype html><html><head><style>:root{--ui-bg:#fff;}button:focus{outline:1px solid #000;}</style></head>
      <body><main data-ui-owner="runner/atlas/wb-toolbar.mjs">
        <button id="alive-btn" onclick="document.getElementById('out').textContent='clicked'">正常按钮</button>
        <button id="dead-btn" data-ui-owner="runner/atlas/wb-toolbar.mjs">死按钮</button>
        <div id="out"></div>
      </main><script>console.error('LIVE_EVAL_TEST_ERR');</script></body></html>`;

    const tmpOut = mkdtempSync(join(tmpdir(), 'dg-stage10-shot-'));
    try {
      const shotPath = join(tmpOut, 'fail.png');
      const rep = await runUiLiveEvaluation(REPO_ROOT, { htmlContent: brokenHtml, screenshotOut: shotPath });
      if (rep.code === 'LIVE_EVAL_LAUNCH_ERROR') return;
      expect(rep.ok).toBe(false);
      expect(rep.exitCode).toBe(1);
      expect(rep.consoleErrors.some((e) => e.includes('LIVE_EVAL_TEST_ERR'))).toBe(true);
      expect(rep.deadButtons.some((b) => b.id === 'dead-btn' && b.uiOwner === 'runner/atlas/wb-toolbar.mjs')).toBe(true);
      expect(existsSync(shotPath)).toBe(true);

      const cleanHtml = `<!doctype html><html><head><style>:root{--ui-bg:#fff;}button:focus-visible{outline:2px solid #1d4ed8;}</style></head>
        <body><main data-ui-owner="runner/atlas/ui-shell.mjs">
          <button id="ok-btn" onclick="document.getElementById('msg').textContent='done'">提交</button>
          <span id="msg"></span>
        </main></body></html>`;
      const okRep = await runUiLiveEvaluation(REPO_ROOT, { htmlContent: cleanHtml });
      expect(okRep.ok).toBe(true);
      expect(okRep.exitCode).toBe(0);
      expect(okRep.deadButtons).toEqual([]);
      expect(okRep.consoleErrors).toEqual([]);
    } finally {
      rmSync(tmpOut, { recursive: true, force: true });
    }
  }, 30000);
});
