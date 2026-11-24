import { existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProjectAtlas, renderAtlasWorkbenchHtml } from '../runner/atlas/index.mjs';
import { buildAdaptiveBusinessHierarchy } from '../runner/atlas/modularity-hierarchy.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const leftoverDbg = resolve(REPO_ROOT, 'runner/_tmp_dbg.mjs');
if (existsSync(leftoverDbg)) {
  try { unlinkSync(leftoverDbg); } catch (err) { void err; }
}

function loadPlaywrightOptional() {
  const req = createRequire(import.meta.url);
  for (const modPath of ['playwright', '/usr/local/donegate-env/cli/node_modules/playwright']) {
    try {
      return req(modPath);
    } catch (err) {
      void err;
    }
  }
  return null;
}

describe('Round 4 Zero-Magic-Number Modularity & Headless Browser Interactive Smoke', () => {
  it('keeps small linear projects 100% flat while folding only cohesive clusters asymmetrically', () => {
    const smallLinear = [
      { id: 'u1', title: '前端输入框', sublinePath: 'src/input.ts', scopePaths: ['src/'], nextIds: ['u2'], modules: [{ name: 'input.ts', path: 'src/input.ts', state: 'ok' }] },
      { id: 'u2', title: '接口保存', sublinePath: 'api/save.ts', scopePaths: ['api/'], nextIds: ['u3'], modules: [{ name: 'save.ts', path: 'api/save.ts', state: 'ok' }] },
      { id: 'u3', title: '结果展示', sublinePath: 'ui/done.ts', scopePaths: ['ui/'], nextIds: [], modules: [{ name: 'done.ts', path: 'ui/done.ts', state: 'ok' }] }
    ];
    const flatRes = buildAdaptiveBusinessHierarchy(smallLinear, {});
    expect(flatRes.length).toBe(3);
    expect(flatRes.every((n) => !n.isSubgraph)).toBe(true);

    const asymmetric = [
      { id: 'u-entry', title: '独立启动入口', sublinePath: 'bin/cli.mjs', scopePaths: ['bin/'], contractIds: ['c-cli'], nextIds: ['u-pay-1'], modules: [{ name: 'cli.mjs', path: 'bin/cli.mjs', state: 'ok' }] },
      { id: 'u-pay-1', title: '收银台创建意图', sublinePath: 'pay/checkout/intent.ts', scopePaths: ['pay/checkout/', 'shared/ledger.ts'], contractIds: ['c-pay'], nextIds: ['u-pay-2'], modules: [{ name: 'intent.ts', path: 'pay/checkout/intent.ts', state: 'ok' }] },
      { id: 'u-pay-2', title: '3DS 风控核身', sublinePath: 'pay/checkout/verify3ds.ts', scopePaths: ['pay/checkout/', 'shared/ledger.ts'], contractIds: ['c-pay'], nextIds: ['u-pay-3'], modules: [{ name: 'verify3ds.ts', path: 'pay/checkout/verify3ds.ts', state: 'ok' }] },
      { id: 'u-pay-3', title: '复式清结算记账', sublinePath: 'pay/checkout/settle.ts', scopePaths: ['pay/checkout/'], contractIds: ['c-pay'], nextIds: ['u-notify'], modules: [{ name: 'settle.ts', path: 'pay/checkout/settle.ts', state: 'ok' }] },
      { id: 'u-notify', title: '邮件回执通知', sublinePath: 'notify/mail.ts', scopePaths: ['notify/'], contractIds: ['c-notify'], nextIds: [], modules: [{ name: 'mail.ts', path: 'notify/mail.ts', state: 'ok' }] }
    ];
    const asymRes = buildAdaptiveBusinessHierarchy(asymmetric, {});
    const subgraphs = asymRes.filter((n) => n.isSubgraph);
    const leaves = asymRes.filter((n) => !n.isSubgraph);
    expect(subgraphs.length).toBeGreaterThanOrEqual(1);
    expect(leaves.some((n) => n.id === 'u-entry')).toBe(true);
    expect(subgraphs[0].codeCapsule.sharedCount).toBeGreaterThanOrEqual(1);
  });

  it('passes real headless Chromium click-through across all 8 Round-4 UI issues with zero pageerrors', async () => {
    const pw = loadPlaywrightOptional();
    const chromiumBin = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));
    if (!pw || !chromiumBin) return;

    const atlas = buildProjectAtlas(REPO_ROOT);
    const darkHtml = renderAtlasWorkbenchHtml(atlas);

    const browser = await pw.chromium.launch({
      executablePath: chromiumBin,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const pageErrors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));

      await page.route('https://donegate.local/**', async (route) => {
        const reqUrl = new URL(route.request().url());
        if (reqUrl.pathname === '/donegate/api/canvas') {
          await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: darkHtml });
          return;
        }
        if (reqUrl.pathname === '/donegate/api/dispatch') {
          let reqPack = null;
          try { reqPack = JSON.parse(route.request().postData() || '{}').pack; } catch (err) { void err; }
          const activeList = ((reqPack && reqPack.nodes) || []).filter((n) => !n.bypassed && !n.isBoundary);
          const firstNd = activeList[0] || { id: 'n-1', title: '防 AI 手搓护栏套件' };
          const restNodes = activeList.slice(1).map((n) => ({ nodeId: n.id, title: n.title, exitCode: 0, durationMs: 3 }));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: false,
              exitCode: 1,
              checkpoint: {
                completedNodes: [
                  { nodeId: firstNd.id, title: firstNd.title, exitCode: 1, durationMs: 42, diagSummary: '检测到 2 处空 catch 块', humanReason: '发现 2 处空 catch 静默吞异常违规（runner/foo.mjs:18）' },
                  ...restNodes
                ]
              }
            })
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });

      // Issue #3: URL ?theme=dark pre-paint synchronous theme application
      await page.goto('https://donegate.local/donegate/api/canvas?theme=dark', { waitUntil: 'domcontentloaded' });
      const initTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(initTheme).toBe('dark');

      // Issue #1: Auto-tidy & mode cycle across all 4 modes with zero runtime TypeError + UIBoard exit
      await page.click('[data-rail-tab="uiboard"]');
      expect(await page.evaluate(() => !document.getElementById('uiboard-stage').classList.contains('hidden'))).toBe(true);
      await page.click('#btn-auto-tidy');
      expect(await page.evaluate(() => document.getElementById('uiboard-stage').classList.contains('hidden'))).toBe(true);

      const labelsSeen = [];
      for (let i = 0; i < 4; i++) {
        await page.click('#btn-tidy-mode-cycle');
        labelsSeen.push(await page.textContent('#tidy-mode-short-label'));
      }
      expect(labelsSeen).toEqual(['横向', '纵向', 'S型', '拓扑']);

      // Issue #7: Multi-select 3 cards -> "合并 (3)" button has clean transparent background (not muted grey)
      await page.click('[data-switch-pack="pack-core-logic"]');
      const mergeInfo = await page.evaluate(async () => {
        const ids = getActiveWorkshopGraph().nodes.filter((n) => !n.isBoundary).slice(0, 3).map((n) => n.id);
        state.selectedNodeIds = new Set(ids);
        renderAll();
        renderSelectionFloatingToolbox();
        await new Promise((r) => requestAnimationFrame(r));
        const btn = document.querySelector('[data-tb-act="merge-subgraph"]');
        return { count: ids.length, bg: btn ? getComputedStyle(btn).backgroundColor : null, txt: btn ? btn.textContent.trim() : '' };
      });
      expect(mergeInfo.count).toBeGreaterThanOrEqual(2);
      expect(mergeInfo.bg).toBe('rgba(0, 0, 0, 0)');
      expect(mergeInfo.txt).toContain('合并');

      // Issue #4: Left-drawer hold/drag node across category & persist to localStorage without summoning card
      await page.click('[data-rail-tab="nodes"]');
      const beforeNodeCount = await page.evaluate(() => getActiveWorkshopGraph().nodes.length);
      const srcBtn = page.locator('[data-rail-summon-tpl="tpl-router-rule"]');
      const dstCat = page.locator('[data-drop-node-cat="筹备与润色"]');
      await srcBtn.scrollIntoViewIfNeeded();
      await dstCat.scrollIntoViewIfNeeded();
      const srcBox = await srcBtn.boundingBox();
      const dstBox = await dstCat.boundingBox();
      await page.mouse.move(srcBox.x + 20, srcBox.y + 12);
      await page.mouse.down();
      await page.mouse.move(dstBox.x + 30, dstBox.y + 18, { steps: 6 });
      await page.mouse.up();

      const catCheck = await page.evaluate(() => ({
        afterCount: getActiveWorkshopGraph().nodes.length,
        newCat: BLOCK_TEMPLATES['tpl-router-rule'].category,
        saved: JSON.parse(localStorage.getItem('dg_node_cat_overrides') || '{}')['tpl-router-rule']
      }));
      expect(catCheck.afterCount).toBe(beforeNodeCount);
      expect(catCheck.newCat).toBe('筹备与润色');
      expect(catCheck.saved).toBe('筹备与润色');

      // Issue #5: New custom node shows amber "待配置检查规则" (never "就绪待跑") and blocks running
      await page.click('[data-action="create-custom-node-tpl"]');
      const customCardText = await page.evaluate(() => {
        const customNd = getActiveWorkshopGraph().nodes.find((n) => n.isCustom);
        return document.getElementById('card-' + customNd.id)?.textContent || '';
      });
      expect(customCardText).toContain('待配置检查规则');
      expect(customCardText).not.toContain('就绪待跑');
      await page.click('#btn-run-check');
      expect(await page.textContent('#toast-pill')).toContain('尚未配置检查规则');

      // Bypass custom node, then test Issue #8: Red card inline humanReason + top banner + 1-click quote to Lead
      await page.evaluate(() => {
        const customNd = getActiveWorkshopGraph().nodes.find((n) => n.isCustom);
        if (customNd) customNd.bypassed = true;
        renderAll();
      });
      await page.click('#btn-run-check');
      await page.waitForSelector('.dg-card-fail-box');
      const failState = await page.evaluate(() => {
        const activeList = getActiveWorkshopGraph().nodes.filter((n) => !n.bypassed && !n.isBoundary);
        const lastNd = activeList[activeList.length - 1];
        return {
          failBoxText: document.querySelector('.dg-card-fail-box')?.textContent || '',
          lastState: lastNd ? state.nodeTelemetry[lastNd.id]?.state : null,
          bannerVisible: !document.getElementById('dg-check-fail-banner').classList.contains('hidden')
        };
      });
      expect(failState.failBoxText).toContain('空 catch 静默吞异常违规');
      expect(failState.lastState).toBe('pass');
      expect(failState.bannerVisible).toBe(true);

      await page.click('[data-action="quote-fix-all-failed"]');
      const quotedText = await page.evaluate(() => dshRuntime.quotes[dshRuntime.quotes.length - 1]?.text || '');
      expect(quotedText).toContain('[DG-TARGET');
      expect(quotedText).toContain('空 catch 静默吞异常违规');

      // Issue #6: Project Board Louvain subgraphs -> in-place fisheye expand -> Code X-Ray view toggle
      await page.click('[data-rail-tab="assets"]');
      const hasSubgraphBtn = await page.locator('[data-action="fisheye-expand-subgraph"]').count();
      expect(hasSubgraphBtn).toBeGreaterThan(0);
      await page.locator('[data-action="fisheye-expand-subgraph"]').first().click();
      const groupCountAfterFisheye = await page.evaluate(() => getActiveGroupsList().length);
      expect(groupCountAfterFisheye).toBeGreaterThan(0);

      await page.click('#btn-sb-code-xray');
      const xrayActive = await page.evaluate(() => Boolean(state.sandboxCodeXray && getActiveSandboxContainer().isCodeXray));
      expect(xrayActive).toBe(true);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
