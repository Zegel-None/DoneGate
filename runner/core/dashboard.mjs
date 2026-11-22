// 全景沙盘导出适配入口（保持旧版 buildDashboardPayload / renderDashboardHtml / exportDashboardHtml 完整兼容，委托 runner/atlas/）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { computeProjectStatus } from './gates.mjs';
import { buildProjectAtlas, renderAtlasWorkbenchHtml, writeAtlasSidecars } from '../atlas/contract.mjs';

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

export function buildBrowserOpenCommand(fileOrUrl, platform = process.platform, pathMod = { resolve }) {
  const raw = String(fileOrUrl || '').trim();
  if (!raw) return null;
  const isUrl = /^(?:https?|file):\/\//i.test(raw);
  const target = isUrl ? raw : pathMod.resolve(raw);
  if (platform === 'win32') {
    const safe = target.replace(/"/g, '%22').replace(/[\r\n]/g, '');
    return {
      cmd: 'cmd.exe',
      args: ['/d', '/s', '/c', `"start "" "${safe}""`],
      opts: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true }
    };
  }
  return {
    cmd: platform === 'darwin' ? 'open' : 'xdg-open',
    args: [target],
    opts: { detached: true, stdio: 'ignore' }
  };
}

export function openInSystemBrowser(filePath, platform = process.platform) {
  try {
    const spec = buildBrowserOpenCommand(filePath, platform);
    if (!spec) return false;
    const child = spawn(spec.cmd, spec.args, spec.opts);
    child.unref();
    return true;
  } catch (err) {
    void err;
    return false;
  }
}
