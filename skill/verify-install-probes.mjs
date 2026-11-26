// 裸机环境探针（默认假设用户是一台什么开发软件都没装过的全新 Windows 电脑）
// 覆盖：Node/npm/Git 与 git worktree 实测、Windows PowerShell 脚本策略排雷、260 字符长路径排雷、
// 中文/空格用户名路径核验、浏览器内核探测、按需工具矩阵盘点及在线 DSH 宿主热探测。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function defaultRunCmd(bin, args = [], opts = {}) {
  const isWinCmd = (opts.platform || process.platform) === 'win32' && /\.(?:cmd|bat)$/i.test(bin);
  const res = spawnSync(bin, args, {
    cwd: opts.cwd || process.cwd(),
    env: opts.env || process.env,
    encoding: 'utf8',
    timeout: opts.timeout || 25000,
    windowsHide: true,
    shell: isWinCmd
  });
  return {
    status: typeof res.status === 'number' ? res.status : 1,
    stdout: String(res.stdout || '').trim(),
    stderr: String(res.stderr || '').trim(),
    error: res.error ? String(res.error.message || res.error) : null
  };
}

export function parseSemverTuple(verText) {
  const m = String(verText || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isNodeVersionSupported(verText) {
  const t = parseSemverTuple(verText);
  if (!t) return { ok: false, recommended: false, tuple: null };
  const [maj, min] = t;
  const ok = maj > 18 || (maj === 18 && min >= 20);
  const recommended = maj > 22 || (maj === 22 && min >= 12);
  return { ok, recommended, tuple: t };
}

export function probeGitAndWorktree(runCmd = defaultRunCmd, platform = process.platform) {
  const ver = runCmd('git', ['--version'], { platform });
  if (ver.status !== 0) {
    const installHint = platform === 'win32'
      ? 'winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements'
      : 'brew install git（macOS）或系统包管理器安装 git';
    return { ok: false, version: null, worktreeOk: false, fixHint: installHint, detail: ver.error || ver.stderr || '未检测到 git' };
  }
  const sb = mkdtempSync(join(tmpdir(), 'dg-doc-wt-'));
  const mainDir = join(sb, 'repo');
  const wtDir = join(sb, 'wt');
  try {
    mkdirSync(mainDir, { recursive: true });
    const s1 = runCmd('git', ['init'], { cwd: mainDir, platform });
    runCmd('git', ['config', 'user.email', 'doctor@donegate.local'], { cwd: mainDir, platform });
    runCmd('git', ['config', 'user.name', 'DoneGate Doctor'], { cwd: mainDir, platform });
    writeFileSync(join(mainDir, 'probe.txt'), 'ok\n', 'utf8');
    runCmd('git', ['add', 'probe.txt'], { cwd: mainDir, platform });
    const s2 = runCmd('git', ['commit', '-m', 'probe'], { cwd: mainDir, platform });
    const s3 = runCmd('git', ['worktree', 'add', '-b', 'dg-probe', wtDir], { cwd: mainDir, platform });
    const wtOk = s1.status === 0 && s2.status === 0 && s3.status === 0 && existsSync(join(wtDir, 'probe.txt'));
    return {
      ok: wtOk,
      version: ver.stdout.replace(/^git version\s+/i, '').trim(),
      worktreeOk: wtOk,
      fixHint: wtOk ? '' : '当前 git 不支持 worktree 或磁盘权限受限，请重装官方最新 Git for Windows',
      detail: wtOk ? 'git 与 git worktree 沙箱实测通过' : (s3.stderr || s2.stderr || 'git worktree 创建失败')
    };
  } finally {
    try { rmSync(sb, { recursive: true, force: true }); } catch (err) { void err; }
  }
}

function fixWindowsExecutionPolicy(runCmd, applyFix, notes, warnings) {
  const pol = runCmd('powershell.exe', ['-NoProfile', '-Command', 'Get-ExecutionPolicy -Scope CurrentUser'], { platform: 'win32' });
  const val = pol.stdout.split(/\r?\n/).pop()?.trim() || '';
  if (pol.status !== 0 || !/^(?:Restricted|Undefined)$/i.test(val)) {
    notes.push(`PowerShell 脚本策略正常 (${val || 'Unrestricted'})`);
    return;
  }
  if (!applyFix) {
    warnings.push('当前 Windows PowerShell 策略为 Restricted，后续运行 npm/npx 可能报「禁止运行脚本」；可加 --install 自动修复');
    return;
  }
  const fix = runCmd('powershell.exe', [
    '-NoProfile', '-Command', 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force'
  ], { platform: 'win32' });
  if (fix.status === 0) notes.push('已自动将当前用户 PowerShell 执行策略设为 RemoteSigned（防止 npm.ps1 报错）');
  else warnings.push('未能自动放开 PowerShell Restricted 策略，建议 Agent 使用 npm.cmd 调用');
}

function fixWindowsGitLongPaths(runCmd, applyFix, notes, warnings) {
  const lp = runCmd('git', ['config', '--get', 'core.longpaths'], { platform: 'win32' });
  if (lp.stdout.trim().toLowerCase() === 'true') {
    notes.push('Windows Git 长路径 (core.longpaths=true) 已开启');
    return;
  }
  if (!applyFix) {
    warnings.push('Windows Git 尚未开启 core.longpaths=true，深层依赖路径可能超 260 字符；可加 --install 自动开启');
    return;
  }
  const fix = runCmd('git', ['config', '--global', 'core.longpaths', 'true'], { platform: 'win32' });
  if (fix.status === 0) notes.push('已自动开启 git core.longpaths=true（消除 Windows 260 字符路径报错）');
  else warnings.push('未能写入全局 git core.longpaths，克隆深层依赖时请留意路径长度');
}

export function probeAndFixBareWindowsTraps(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const runCmd = opts.runCmd || defaultRunCmd;
  const applyFix = Boolean(opts.applyFix);
  const home = env.USERPROFILE || env.HOME || homedir();
  const hasNonAsciiOrSpace = [...String(home || '')].some((ch) => ch.charCodeAt(0) > 0x7f || /\s/.test(ch));
  const notes = [];
  const warnings = [];

  if (hasNonAsciiOrSpace) {
    notes.push(`检测到用户目录含中文或空格 (${home})，已启用双引号安全路径保护`);
  }
  if (platform === 'win32') {
    fixWindowsExecutionPolicy(runCmd, applyFix, notes, warnings);
    fixWindowsGitLongPaths(runCmd, applyFix, notes, warnings);
  }
  return { platform, hasNonAsciiOrSpace, notes, warnings };
}

function findLocalBrowserBinary(platform, env, fileExists = existsSync) {
  if (platform === 'win32') {
    const winRoots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    const winCandidates = [];
    for (const r of winRoots) {
      winCandidates.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      winCandidates.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    return winCandidates.find((p) => fileExists(p)) || null;
  }
  const unixCandidates = platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return unixCandidates.find((p) => fileExists(p)) || null;
}

export function probeOnDemandEcosystem(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const runCmd = opts.runCmd || defaultRunCmd;
  const npmBin = platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmRes = runCmd(npmBin, ['--version'], { platform, env });
  const pkgMgr = platform === 'win32'
    ? runCmd('winget', ['--version'], { platform, env })
    : (platform === 'darwin' ? runCmd('brew', ['--version'], { platform, env }) : { status: 0, stdout: 'system-pkg' });
  const uvRes = runCmd('uv', ['--version'], { platform, env });
  const goRes = runCmd('go', ['version'], { platform, env });
  const browserBin = findLocalBrowserBinary(platform, env, opts.fileExists || existsSync);

  return {
    npmReady: npmRes.status === 0,
    npmVersion: npmRes.status === 0 ? npmRes.stdout : null,
    osPkgMgrReady: pkgMgr.status === 0,
    browserReady: Boolean(browserBin),
    browserBin,
    uvReady: uvRes.status === 0,
    goReady: goRes.status === 0
  };
}

function httpGetQuick(port, pathStr, timeoutMs = 350) {
  return new Promise((resolvePromise) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathStr, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 2048) body += chunk; });
      res.on('end', () => resolvePromise({ reachable: true, statusCode: res.statusCode || 0, body }));
    });
    req.on('timeout', () => { req.destroy(); resolvePromise({ reachable: false, statusCode: 0, body: '' }); });
    req.on('error', () => resolvePromise({ reachable: false, statusCode: 0, body: '' }));
  });
}

export async function probeLiveDshHostStatus(env = process.env) {
  const rawPorts = [Number(env.DSH_PORT || 0), 3000, 4199, 5173].filter((p) => p > 0);
  const ports = [...new Set(rawPorts)];
  for (const port of ports) {
    const ping = await httpGetQuick(port, '/donegate/api/ping');
    if (ping.reachable && ping.statusCode === 200 && ping.body.includes('"ok":true')) {
      return { mode: 'hot_ready', port, humanSummary: `检测到运行中的 DSH Web (端口 ${port}) 已热加载完结门，直接刷新浏览器页面即可看到顶部「完结门」按钮` };
    }
    const root = await httpGetQuick(port, '/');
    if (root.reachable && root.statusCode > 0 && (root.body.includes('dsh') || root.body.includes('DeepSeek') || root.body.includes('__ModuleLoader__'))) {
      return { mode: 'needs_restart', port, humanSummary: `插件已写入本机，但端口 ${port} 上正在运行的 DSH Web 尚未加载新插件——请重启一次 dsh web 后再打开页面` };
    }
  }
  return { mode: 'offline_ready', port: null, humanSummary: '插件与三套技能已全部落盘；启动 dsh web 后顶部即会出现「完结门」标签页（其他 Agent 可直接读 AGENTS.md 开工）' };
}
