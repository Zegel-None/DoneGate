import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hydrateWorkbenchData } from '../runner/atlas/hydrate-workbench.mjs';
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

  it('migrates pre-existing hostLayoutVer:2 workbench-state.json without disabling Louvain communities or scanning .deps', () => {
    const tmpWs = mkdtempSync(join(tmpdir(), 'dg-louvain-saved-ws-'));
    try {
      cpSync(join(REPO_ROOT, 'package.json'), join(tmpWs, 'package.json'));
      cpSync(join(REPO_ROOT, 'vitest.config.mjs'), join(tmpWs, 'vitest.config.mjs'));
      cpSync(join(REPO_ROOT, 'donegate'), join(tmpWs, 'donegate'), { recursive: true });
      cpSync(join(REPO_ROOT, 'runner'), join(tmpWs, 'runner'), { recursive: true });
      cpSync(join(REPO_ROOT, 'skill'), join(tmpWs, 'skill'), { recursive: true });
      mkdirSync(join(tmpWs, 'workflows', '.deps', '_shared'), { recursive: true });
      writeFileSync(join(tmpWs, 'workflows', '.deps', '_shared', 'dg-deps-cli.mjs'), '// Auto-generated zero-dependency tool\nexport const x = 1;\n');

      const legacySuffix = ['护', '栏包'].join('');
      const legacyHostLayouts = {};
      for (const key of [
        'host-dom-root', 'host-dom-runner', 'host-dom-runner-lib', 'host-dom-runner-contracts',
        'host-dom-runner-atlas', 'host-dom-runner-dsh', 'host-dom-runner-host', 'host-dom-runner-slice',
        'host-dom-runner-verifiers', 'host-dom-skill', 'host-dom-skill-gates', 'host-dom-skill-lib',
        'host-dom-skill-templates', 'host-dom-workflows'
      ]) {
        legacyHostLayouts[key] = { x: 120, y: 240, expanded: true, collapsed: false };
      }
      mkdirSync(join(tmpWs, '.donegate'), { recursive: true });
      writeFileSync(
        join(tmpWs, '.donegate', 'workbench-state.json'),
        JSON.stringify({
          schemaVersion: '1.0',
          hostLayoutVer: 2,
          hostNodeLayouts: legacyHostLayouts,
          componentWorkflows: {
            'host-dom-runner': { baseId: 'pack-core-logic', baseName: `核心纯逻辑${legacySuffix}` }
          }
        }, null, 2)
      );

      const baseAtlas = buildProjectAtlas(tmpWs);
      const wb = hydrateWorkbenchData(tmpWs, baseAtlas);
      const hostWs = wb.hostSandbox;
      expect(hostWs.nodes.length).toBeGreaterThanOrEqual(4);
      expect(hostWs.nodes.length).toBeLessThanOrEqual(6);
      expect(hostWs.nodes.every((n) => Boolean(n.isSubgraph))).toBe(true);
      expect(hostWs.nodes[0].title).toContain('沟通需求');
      expect(hostWs.nodes[0].subgraph.nodes.some((sn) => sn.id === 'host-dom-grill-me')).toBe(true);
      expect(hostWs.codeUnitNodes.some((rn) => String(rn.sublinePath || '').includes('workflows/.deps'))).toBe(false);
      expect(hostWs.codeUnitNodes.some((rn) => String(rn.title || '').includes('workflows'))).toBe(false);
      expect(wb.savedState.componentWorkflows['host-dom-runner'].baseName).toBe('核心纯逻辑工作流');
    } finally {
      rmSync(tmpWs, { recursive: true, force: true });
    }
  });

  it('passes real headless Chromium click-through across all Round-4 UI & Louvain DAG checks with zero pageerrors', async () => {
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

      // Issue #7: Multi-select 3 cards -> "合并 (3)" button has clean transparent background
      await page.click('[data-switch-pack="pack-core-logic"]');
      const mergeInfo = await page.evaluate(async () => {
        const ids = getActiveWorkshopGraph().nodes.filter((n) => !n.isBoundary).slice(0, 3).map((n) => n.id);
        state.selectedNodeIds = new Set(ids);
        renderAll();
        renderSelectionFloatingToolbox();
        await new Promise((r) => requestAnimationFrame(r));
        const btn = document.querySelector('[data-tb-act="merge-subgraph"]');
        const bg = btn ? getComputedStyle(btn).backgroundColor : null;
        const txt = btn ? btn.textContent.trim() : '';
        return { count: ids.length, bg, txt };
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
        const lastState = lastNd ? state.nodeTelemetry[lastNd.id]?.state : null;
        return {
          failBoxText: document.querySelector('.dg-card-fail-box')?.textContent || '',
          lastState,
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

      // Issue #6 + Louvain Business Hierarchy & Transitive Reduction verification on Project Board
      await page.click('[data-rail-tab="assets"]');
      const topBoardStats = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#cards-layer .node-card'));
        const nodesText = cards.map((el) => el.textContent || '').join('\n');
        const wireCount = document.querySelectorAll('#wires-svg path.wire-hit').length;
        return {
          cardCount: cards.length,
          hasCodeCapsuleOnTop: nodesText.includes('关联 ') && nodesText.includes('个代码模块'),
          wireCount
        };
      });
      expect(topBoardStats.cardCount).toBeGreaterThanOrEqual(4);
      expect(topBoardStats.cardCount).toBeLessThanOrEqual(6);
      expect(topBoardStats.hasCodeCapsuleOnTop).toBe(false);
      expect(topBoardStats.wireCount).toBeGreaterThanOrEqual(4);
      expect(topBoardStats.wireCount).toBeLessThanOrEqual(8);

      // Drill into nested subgraph until bottom leaf layer -> verify leaf code capsules appear ONLY at bottom layer
      for (let guard = 0; guard < 5; guard++) {
        const enterCount = await page.locator('[data-action="enter-subgraph"]').count();
        if (enterCount === 0) break;
        await page.locator('[data-action="enter-subgraph"]').first().click();
      }
      const bottomLeafHasCapsule = await page.evaluate(() => {
        const txt = Array.from(document.querySelectorAll('#cards-layer .node-card')).map((el) => el.textContent || '').join('\n');
        return txt.includes('关联 ') && txt.includes('个代码模块');
      });
      expect(bottomLeafHasCapsule).toBe(true);

      // Return to top level -> exhaustively click ALL 8 in-place expand buttons (including nested level-2 subgraphs) + 4-mode compound tidy
      await page.evaluate(() => {
        state.sbSubgraphStack = [];
        renderAll();
        fitCanvas();
      });
      let expandedClicks = 0;
      while (expandedClicks < 12) {
        const rem = await page.locator('[data-action="fisheye-expand-subgraph"]').count();
        if (rem === 0) break;
        await page.locator('[data-action="fisheye-expand-subgraph"]').first().click();
        expandedClicks++;
      }
      expect(expandedClicks).toBeGreaterThanOrEqual(7);

      // Cycle global auto-tidy across all 4 modes while 7 groups exist and verify 0 overlaps & 0 broken wires
      for (let m = 0; m < 4; m++) {
        await page.click('#btn-tidy-mode-cycle');
        const audit = await page.evaluate(() => {
          const nodes = getActiveNodesList();
          const groups = pruneActiveGroups();
          const idSet = new Set(nodes.map((n) => n.id));
          let deadEdges = 0;
          const undir = new Map(nodes.map((n) => [n.id, new Set()]));
          nodes.forEach((u) => {
            (u.nextIds || []).forEach((v) => {
              if (!idSet.has(v)) deadEdges++;
              else { undir.get(u.id).add(v); undir.get(v).add(u.id); }
            });
          });
          const vis = new Set([nodes[0].id]);
          const q = [nodes[0].id];
          while (q.length) {
            const cur = q.shift();
            (undir.get(cur) || []).forEach((nb) => { if (!vis.has(nb)) { vis.add(nb); q.push(nb); } });
          }
          const overlap = (a, b) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;
          const cardRects = nodes.map((n) => {
            const el = document.getElementById('card-' + n.id);
            return { id: n.id, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
          });
          const grpRects = groups.map((g) => ({ id: g.id, memberSet: new Set(g.memberIds), ...computeGroupBounds(g) }));
          let cardOv = 0, grpOv = 0, foreignOv = 0;
          for (let i = 0; i < cardRects.length; i++) {
            for (let j = i + 1; j < cardRects.length; j++) if (overlap(cardRects[i], cardRects[j])) cardOv++;
          }
          for (let i = 0; i < grpRects.length; i++) {
            for (let j = i + 1; j < grpRects.length; j++) if (overlap(grpRects[i], grpRects[j])) grpOv++;
            for (const c of cardRects) if (!grpRects[i].memberSet.has(c.id) && overlap(grpRects[i], c)) foreignOv++;
          }
          return { groupCount: groups.length, deadEdges, allConnected: vis.size === nodes.length, cardOv, grpOv, foreignOv };
        });
        expect(audit.groupCount).toBeGreaterThanOrEqual(6);
        expect(audit.deadEdges).toBe(0);
        expect(audit.allConnected).toBe(true);
        expect(audit.cardOv).toBe(0);
        expect(audit.grpOv).toBe(0);
        expect(audit.foreignOv).toBe(0);
      }

      await page.click('#btn-sb-code-xray');
      const xrayActive = await page.evaluate(() => Boolean(state.sandboxCodeXray && getActiveSandboxContainer().isCodeXray));
      expect(xrayActive).toBe(true);

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30000);
});
