// 可插拔 AI Harness 宿主适配器统一协议与占位模板（L5 donegate-cli，零外部依赖，<= 80 行）

export const HARNESS_ADAPTER_REQUIRED_METHODS = ['detect', 'status', 'install', 'uninstall'];

export function validateHarnessAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Harness adapter must be an object');
  if (typeof adapter.id !== 'string' || !/^[a-z0-9-]+$/.test(adapter.id)) {
    throw new TypeError(`Invalid harness adapter id: ${String(adapter.id)}`);
  }
  if (typeof adapter.displayName !== 'string' || !adapter.displayName.trim()) {
    throw new TypeError(`Harness adapter ${adapter.id} requires displayName`);
  }
  for (const fn of HARNESS_ADAPTER_REQUIRED_METHODS) {
    if (typeof adapter[fn] !== 'function') {
      throw new TypeError(`Harness adapter ${adapter.id} missing required method: ${fn}()`);
    }
  }
  return adapter;
}

export function createPlannedHarnessStub({ id, displayName, description, targetHint, capabilities = [] }) {
  return validateHarnessAdapter({
    id,
    displayName,
    description,
    implemented: false,
    capabilities,
    detect() {
      return { available: false, installed: false, state: 'planned', detail: `预留宿主适配器占位（目标路径：${targetHint}）` };
    },
    status() {
      return {
        ok: true,
        id,
        displayName,
        implemented: false,
        installed: false,
        state: 'planned',
        targetHint,
        summary: `${displayName} 适配器为预留扩展占位（尚未实现真机安装；按 runner/harnesses/protocol.mjs 接入即可独立启用）`
      };
    },
    install() {
      return {
        ok: false,
        exitCode: 3,
        id,
        reason: `${displayName} 宿主适配器尚未实现（当前为可插拔占位；目标格式：${targetHint}）`
      };
    },
    uninstall() {
      return {
        ok: false,
        exitCode: 3,
        id,
        reason: `${displayName} 宿主适配器尚未实现，无需卸载`
      };
    }
  });
}
