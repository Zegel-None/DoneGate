// 全景沙盘导出适配入口（保持旧版 buildDashboardPayload / renderDashboardHtml / exportDashboardHtml 完整兼容，委托 runner/atlas/）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { computeProjectStatus } from './gates.mjs';
import { buildProjectAtlas, writeAtlasSidecars } from '../atlas/assemble-atlas.mjs';
import { renderAtlasWorkbenchHtml } from '../atlas/render-html.mjs';

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

export function openInSystemBrowser(filePath) {
  try {
    const abs = resolve(filePath);
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${abs}"`], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [abs], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [abs], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}
