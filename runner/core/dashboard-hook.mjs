// 判定核无头看板导出控制反转钩子（L1 零 UI 依赖：由上层 atlas/dashboard 或 CLI 组合根注册实际渲染器）

let registeredDashboardExporter = null;

export function registerDashboardExporter(exporterFn) {
  registeredDashboardExporter = typeof exporterFn === 'function' ? exporterFn : null;
}

export function invokeDashboardExporter(projectRoot, outPath, opts = {}) {
  if (typeof registeredDashboardExporter !== 'function') {
    return { ok: false, skipped: true, reason: 'headless-mode: 未注册看板 HTML 导出器' };
  }
  return registeredDashboardExporter(projectRoot, outPath, opts);
}
