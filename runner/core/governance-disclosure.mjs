// 防伪底线关闭诚实披露原语（零跨层依赖，供 progress / handover / autopilot / compiler 共享，<= 90 行）
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export const GOVERNANCE_OVERRIDES_REL = '.donegate/workflows/overrides';

function gdExtractFromOverlay(overlay, flowIdFallback) {
  if (!overlay || typeof overlay !== 'object') return [];
  const flowId = String(overlay.flowId || flowIdFallback || 'unknown');
  const out = [];
  const toggleNodes = (overlay.toggleNodes && typeof overlay.toggleNodes === 'object') ? overlay.toggleNodes : {};
  for (const [nodeId, cfg] of Object.entries(toggleNodes)) {
    if (!cfg || cfg.bypassed !== true) continue;
    if (cfg.tier !== 'integrity') continue;
    out.push({
      flowId,
      nodeId,
      title: String(cfg.title || nodeId),
      reason: String(cfg.reason || '业主主动关闭').slice(0, 120),
      confirmedAt: String(cfg.confirmedAt || overlay.updatedAt || '')
    });
  }
  return out;
}

export function gdCollectDisabledIntegrityRules(projectRoot, extraDisabled = []) {
  const root = resolve(projectRoot);
  const ovDir = join(root, GOVERNANCE_OVERRIDES_REL);
  const items = [];
  const seen = new Set();

  const pushUnique = (rec) => {
    const key = `${rec.flowId}:${rec.nodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(rec);
  };

  if (existsSync(ovDir)) {
    for (const name of readdirSync(ovDir).sort()) {
      if (!name.endsWith('.overlay.json')) continue;
      const r = readJsonStrict(join(ovDir, name));
      if (!r.ok || !r.value) continue;
      const fid = name.replace(/\.overlay\.json$/, '');
      for (const rec of gdExtractFromOverlay(r.value, fid)) pushUnique(rec);
    }
  }
  for (const rec of Array.isArray(extraDisabled) ? extraDisabled : []) {
    if (rec && rec.nodeId) pushUnique(rec);
  }
  return {
    hasDisabledIntegrity: items.length > 0,
    count: items.length,
    items
  };
}

export function gdFormatIntegrityBannerText(disclosure) {
  if (!disclosure || !disclosure.hasDisabledIntegrity || disclosure.count === 0) return '';
  const labels = disclosure.items.map((x) => `「${x.title}」(${x.flowId}/${x.nodeId})`).join('、');
  return `🚨 [诚实披露 · 已关闭防伪底线] 业主已主动关闭 ${disclosure.count} 项防伪底线规则：${labels}；本次结果不含上述防伪保护`;
}

export function gdFormatIntegrityBannerMarkdown(disclosure) {
  if (!disclosure || !disclosure.hasDisabledIntegrity || disclosure.count === 0) return '';
  const lines = [
    '> [!CAUTION]',
    `> **🚨 已关闭防伪底线（业主主动确认，共 ${disclosure.count} 项）**：本次验收结果不含以下防伪保护，复核或交接时请重点知悉：`,
    ...disclosure.items.map((x) => `> - **${x.title}**（\`${x.flowId}/${x.nodeId}\`）— 原因：${x.reason}`)
  ];
  return lines.join('\n');
}
