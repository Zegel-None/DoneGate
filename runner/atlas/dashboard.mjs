// 全景沙盘导出适配入口（归属 L4 atlas-workbench，加载时自动向 L1 判定核注册 HTML 导出钩子）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { computeProjectStatus } from '../core/index.mjs';
import { registerDashboardExporter } from '../core/index.mjs';
import { buildBrowserOpenCommand, openInSystemBrowser } from '../shared/browser-open.mjs';
import { buildProjectAtlas, renderAtlasWorkbenchHtml, writeAtlasSidecars } from './contract.mjs';

export { buildBrowserOpenCommand, openInSystemBrowser };

function computeDefaultPct(st) {
  const active = (st?.contractSummaries || []).filter((c) => !c.retired);
  if (active.length === 0) return st ? 5 : 0;
  let sum = 0;
  for (const c of active) {
    const obs = c.obligations || [];
    if (obs.length === 0) continue;
    const passed = obs.filter((o) => o.state === '通过').length;
    sum += 0.2 + 0.8 * (passed / obs.length);
  }
  return Math.min(100, Math.round(10 + 80 * (sum / active.length)));
}

export function buildDashboardPayload(projectRoot, opts = {}) {
  const st = opts.statusData || computeProjectStatus(projectRoot);
  const totalPct = opts.totalPct ?? computeDefaultPct(st);
  const atlas = buildProjectAtlas(projectRoot, { statusData: st, totalPct });
  return {
    ...atlas,
    totalPct,
    projectSummary: atlas.project.summary
  };
}

export function renderDashboardHtml(payload) {
  return renderAtlasWorkbenchHtml(payload);
}

export function exportDashboardHtml(projectRoot, outPath = join(projectRoot, '.donegate', 'dashboard.html'), opts = {}) {
  try {
    const payload = buildDashboardPayload(projectRoot, opts);
    if (existsSync(join(projectRoot, '.donegate'))) {
      writeAtlasSidecars(projectRoot, payload);
    }
    const absOut = resolve(projectRoot, outPath);
    mkdirSync(dirname(absOut), { recursive: true });
    const html = renderAtlasWorkbenchHtml(payload);
    writeFileSync(absOut, html, 'utf8');
    return { ok: true, outPath: absOut, atlas: payload, html };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

registerDashboardExporter(exportDashboardHtml);
