// L0 跨平台系统默认浏览器安全拉起原语（零工作台依赖，支持 Windows/macOS/Linux）
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

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
