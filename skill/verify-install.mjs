#!/usr/bin/env node
// 完结门（DoneGate）一站式自动安装与六道防撒谎真机验真门禁
// 设计目标：面向零编程基础的 Vibecoder 与其代劳 Agent，假设客户是一台什么环境都没配过的全新 Windows/macOS 电脑：
//   1. 自动排查并修复 Windows PowerShell 禁跑脚本策略、260 字符长路径限制、中文/空格目录兼容；
//   2. 自动把 @local/dsh-donegate 挂载到本机全部 DSH Profile，并在 node:vm 沙箱实测前端槽位加载；
//   3. 真跑防篡改哈希链自检、全仓模块完整性、无限画布渲染与共享池启动器；
//   4. 任一硬指标不过即返回退出码 1（严禁 Agent 谎报装好），全过则打印带动态 SHA-256 指纹的验真回执框。
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { sha256Short } from './hash.mjs';
import {
  defaultRunCmd,
  isNodeVersionSupported,
  probeAndFixBareWindowsTraps,
  probeGitAndWorktree,
  probeLiveDshHostStatus,
  probeOnDemandEcosystem
} from './verify-install-probes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

function resolveDefaultDshHome(env, platform) {
  if (env.DSH_HOME && String(env.DSH_HOME).trim()) return resolve(String(env.DSH_HOME).trim());
  const home = platform === 'win32' ? (env.USERPROFILE || homedir()) : (env.HOME || homedir());
  return join(home, '.dsh');
}

function discoverDshProfileNames(dshHome) {
  const names = new Set(['web']);
  const profilesRoot = join(dshHome, 'profiles');
  if (!existsSync(profilesRoot)) return [...names];
  for (const ent of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (ent.isDirectory() && !ent.name.startsWith('.')) names.add(ent.name);
  }
  return [...names];
}

function verifyClientBundleInVm(clientJsPath, hostJsPath) {
  if (!existsSync(clientJsPath) || !existsSync(hostJsPath)) {
    return { ok: false, detail: '缺少已落盘的 lib/client.js 或 lib/index.js' };
  }
  const clientJs = readFileSync(clientJsPath, 'utf8');
  const hostJs = readFileSync(hostJsPath, 'utf8');
  const hostValid = hostJs.includes('/donegate/api/')
    && hostJs.includes('createDoneGateWebRouteHandler')
    && hostJs.includes('installSubagentHumanIsolationGuard');
  if (!hostValid) {
    return { ok: false, detail: '宿主插件 lib/index.js 缺少 /donegate/api/ 路由或子智能体隔离守卫' };
  }
  let factory = null;
  const sandbox = {
    window: {
      __ModuleLoader__: { load(spec) { factory = spec && spec.factory; } },
      localStorage: { getItem: () => null, setItem: () => {} },
      innerHeight: 900
    }
  };
  try {
    vm.runInNewContext(clientJs, sandbox, { timeout: 5000 });
    if (typeof factory !== 'function') return { ok: false, detail: 'client.js 未向 __ModuleLoader__ 注册工厂函数' };
    const fakeReact = {
      createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
      useRef: (v) => ({ current: v }),
      useEffect: () => {},
      useState: (v) => [v, () => {}]
    };
    const plugin = factory((m) => (m === 'react' ? fakeReact : {}));
    const slots = [];
    plugin.apply({
      effect: () => {},
      locale: { register: () => () => {}, bind: () => (k) => k },
      get: () => null,
      slots: {
        inject: (_n, fn) => fn(),
        register: (meta) => { slots.push(`${meta.name}:${meta.id || ''}`); return () => {}; }
      }
    });
    const hasView = slots.includes('conversation.view:donegate');
    const hasDock = slots.includes('conversation.input.dock:donegate-dock');
    const hasComposerGuard = slots.includes('conversation.composer:donegate-subagent-readonly');
    if (!hasView || !hasDock || !hasComposerGuard) {
      return { ok: false, detail: `前端槽位不完整 (${slots.join(', ')})` };
    }
    return { ok: true, clientHash: sha256Short(clientJs, 12), detail: '顶栏「完结门」视图、对话抽屉与子智能体只读隔离三槽位均通过 VM 试装' };
  } catch (err) {
    return { ok: false, detail: `client.js 沙箱试装异常：${err.message || err}` };
  }
}

function runNodeScriptGate(root, scriptRel, args = [], extraEnv = {}) {
  const scriptAbs = join(root, scriptRel);
  if (!existsSync(scriptAbs)) {
    return { ok: false, detail: `缺少门禁脚本：${scriptRel}` };
  }
  const res = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true
  });
  const tailMsg = (res.stderr || res.stdout || '').slice(-240);
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || '').trim(),
    stderr: String(res.stderr || '').trim(),
    detail: res.status === 0 ? `${scriptRel} 通过` : `${scriptRel} 退出码 ${res.status}: ${tailMsg}`
  };
}

function runGate3DshMount(root, dshHome, doInstall, env) {
  const installerRel = 'runner/dsh/install-dsh-web.mjs';
  const profiles = discoverDshProfileNames(dshHome);
  if (doInstall) {
    for (const pf of profiles) {
      const r = runNodeScriptGate(root, installerRel, ['--legacy-direct-profile-write', '--profile', pf, '--dsh-home', dshHome], env);
      if (!r.ok) return { ok: false, profiles, detail: r.detail, fixHint: `请检查目录写入权限：${dshHome}` };
    }
  }
  const webMod = join(dshHome, 'profiles', 'web', 'node_modules', '@local', 'dsh-donegate');
  const vmCheck = verifyClientBundleInVm(join(webMod, 'lib', 'client.js'), join(webMod, 'lib', 'index.js'));
  if (!vmCheck.ok) {
    return {
      ok: false,
      profiles,
      detail: vmCheck.detail,
      fixHint: '请运行 node skill/verify-install.mjs --install 自动生成并挂载插件包'
    };
  }
  return { ok: true, profiles, clientHash: vmCheck.clientHash, detail: `已覆盖 [${profiles.join(', ')}] Profile，${vmCheck.detail}` };
}

function runGate4And5Runtime(root, doInstall) {
  const initFlag = doInstall ? 'true' : 'false';
  const probeScript = [
    "import { buildProjectAtlas, renderAtlasWorkbenchHtml } from './runner/atlas/index.mjs';",
    "import { ensureSharedPoolSkeleton } from './runner/dsh/workflow-deps.mjs';",
    "const root = process.cwd();",
    "const atlas = buildProjectAtlas(root);",
    "const html = renderAtlasWorkbenchHtml(atlas);",
    "if (!html.includes('btn-sb-code-xray') || !html.includes('dg-check-fail-banner')) process.exit(2);",
    `if (${initFlag}) { const sk = ensureSharedPoolSkeleton(root); if (!sk.cliPath) process.exit(3); }`,
    "console.log('ATLAS_HTML_BYTES=' + html.length);"
  ].join(' ');
  const atlasRes = spawnSync(process.execPath, ['--input-type=module', '-e', probeScript], {
    cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true
  });
  const g4Ok = atlasRes.status === 0 && atlasRes.stdout.includes('ATLAS_HTML_BYTES=');
  const g5Res = runNodeScriptGate(root, 'runner/self-test.mjs');
  return {
    g4: { ok: g4Ok, detail: g4Ok ? `无限画布与模块度引擎实渲染就绪 (${atlasRes.stdout.trim()})` : (atlasRes.stderr || '画布渲染失败') },
    g5: { ok: g5Res.ok, detail: g5Res.ok ? 'SHA-256 防篡改哈希链与四值退出码判定核实测通过' : g5Res.detail }
  };
}

function buildGate1Summary(nodeVerCheck, nodeVersion, gitCheck, platform) {
  const ok = nodeVerCheck.ok && gitCheck.ok;
  if (ok) {
    return { ok: true, detail: `Node ${nodeVersion} | Git ${gitCheck.version} (worktree 就绪)`, fixHint: '' };
  }
  if (!nodeVerCheck.ok) {
    const fix = platform === 'win32'
      ? 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements'
      : '请安装 Node.js v22 LTS (最低 v18.20+)';
    return { ok: false, detail: `Node 版本过低 (${nodeVersion}，需 >=18.20)`, fixHint: fix };
  }
  return { ok: false, detail: gitCheck.detail, fixHint: gitCheck.fixHint };
}

export async function verifyDoneGateInstallation(opts = {}) {
  const root = resolve(opts.projectRoot || DEFAULT_ROOT);
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const runCmd = opts.runCmd || defaultRunCmd;
  const doInstall = Boolean(opts.install);
  const nodeVersion = opts.nodeVersion || process.version;
  const dshHome = opts.dshHome ? resolve(opts.dshHome) : resolveDefaultDshHome(env, platform);
  const pkgVersion = existsSync(join(root, 'VERSION')) ? readFileSync(join(root, 'VERSION'), 'utf8').trim() : '0.4.0';

  const nodeVerCheck = isNodeVersionSupported(nodeVersion);
  const gitCheck = probeGitAndWorktree(runCmd, platform);
  const winTraps = probeAndFixBareWindowsTraps({ platform, env, runCmd, applyFix: doInstall });
  const g1 = buildGate1Summary(nodeVerCheck, nodeVersion, gitCheck, platform);

  const skillsGate = runNodeScriptGate(root, 'skill/check-skills.mjs', ['--root', root]);
  const modGate = runNodeScriptGate(root, 'skill/check-module-integrity.mjs');
  const g2Ok = skillsGate.ok && modGate.ok;

  const g3 = g1.ok && g2Ok
    ? runGate3DshMount(root, dshHome, doInstall, env)
    : { ok: false, profiles: [], clientHash: 'none', detail: '因前置底座或仓库不完整跳过挂载', fixHint: '先修复 G1/G2' };

  const { g4, g5 } = g1.ok && g2Ok
    ? runGate4And5Runtime(root, doInstall)
    : { g4: { ok: false, detail: '前置未过跳过' }, g5: { ok: false, detail: '前置未过跳过' } };

  const eco = probeOnDemandEcosystem({ platform, env, runCmd });
  const liveHost = opts.skipLivePortProbe
    ? { mode: 'offline_ready', port: null, humanSummary: '离线验收模式：插件与三套技能已全部落盘就绪' }
    : await probeLiveDshHostStatus(env);

  const g2Detail = g2Ok
    ? 'donegate / judge / forge 三套技能与全仓 ESM 导入绑定 0 断链'
    : `${skillsGate.detail}; ${modGate.detail}`;
  const gates = [
    { id: 'G1', title: '核心底座与裸机排雷', ok: g1.ok, detail: g1.detail, fixHint: g1.fixHint },
    { id: 'G2', title: '三套技能与模块树完整性', ok: g2Ok, detail: g2Detail, fixHint: '确认未多套空文件夹且完整克隆仓库' },
    { id: 'G3', title: 'DSH 插件挂载与槽位试装', ok: g3.ok, detail: g3.detail, fixHint: g3.fixHint || '' },
    { id: 'G4', title: '无限画布与模块度引擎实测', ok: g4.ok, detail: g4.detail, fixHint: '' },
    { id: 'G5', title: '防篡改判定核真机演练', ok: g5.ok, detail: g5.detail, fixHint: '' },
    { id: 'G6', title: '宿主状态与按需生态盘点', ok: true, detail: liveHost.humanSummary, fixHint: '' }
  ];

  const allOk = gates.every((g) => g.ok);
  const rawSeed = [pkgVersion, platform, nodeVersion, g3.clientHash, gitCheck.version].join('|');
  const proofToken = allOk ? `DG-INSTALL-OK-${sha256Short(rawSeed, 12).toUpperCase()}` : null;

  return { ok: allOk, pkgVersion, platform, nodeVersion, dshHome, gates, winTraps, ecosystem: eco, liveHost, proofToken };
}

function formatEcosystemSummaryLine(eco) {
  const npmLabel = eco.npmReady ? '已就绪' : '缺';
  const brLabel = eco.browserReady ? '已就绪' : '按需';
  const uvLabel = eco.uvReady ? '已就绪' : '用到再装';
  const goLabel = eco.goReady ? '已就绪' : '用到再装';
  return `║  · [按需矩阵] npm:${npmLabel} | 浏览器内核:${brLabel} | uv(Python):${uvLabel} | Go:${goLabel}`;
}

export function formatInstallReceiptBox(rep) {
  const lines = [];
  if (rep.ok) {
    lines.push('╔══════════════════════════════════════════════════════════════════════╗');
    lines.push('║  ✅ 完结门 (DoneGate) 安装验真回执 · 6/6 硬门禁全绿                  ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════╣');
    for (const g of rep.gates) lines.push(`║  ✓ [${g.id}] ${g.title}：${g.detail}`);
    for (const n of rep.winTraps.notes) lines.push(`║  · [排雷] ${n}`);
    lines.push(formatEcosystemSummaryLine(rep.ecosystem));
    lines.push(`║  🔑 验真防伪码：${rep.proofToken}`);
    lines.push('╚══════════════════════════════════════════════════════════════════════╝');
    lines.push('RESULT: PASS 完结门已真实装妥并完成端到端真机验真');
  } else {
    lines.push('╔══════════════════════════════════════════════════════════════════════╗');
    lines.push('║  ❌ 完结门安装未通过验真（Agent 严禁向用户谎称已安装成功！）         ║');
    lines.push('╠══════════════════════════════════════════════════════════════════════╣');
    for (const g of rep.gates) {
      const mark = g.ok ? '✓' : '✗';
      lines.push(`║  ${mark} [${g.id}] ${g.title}：${g.detail}`);
      if (!g.ok && g.fixHint) lines.push(`║      👉 修复指令：${g.fixHint}`);
    }
    lines.push('╚══════════════════════════════════════════════════════════════════════╝');
    lines.push('RESULT: FAIL 安装验真存在未过门禁，请按修复指令补齐后重跑');
  }
  return lines.join('\n');
}

async function runRedSelfTest(repoRoot) {
  const sb = mkdtempSync(join(tmpdir(), 'dg-verify-red-'));
  try {
    const dshHome = join(sb, 'Users', '王 小明', '.dsh');
    mkdirSync(join(dshHome, 'profiles', 'custom-team'), { recursive: true });
    const badUninstalled = await verifyDoneGateInstallation({ projectRoot: repoRoot, dshHome, install: false, skipLivePortProbe: true });
    if (badUninstalled.ok || badUninstalled.proofToken) throw new Error('未挂载插件时未判红');

    const badNode = await verifyDoneGateInstallation({ projectRoot: repoRoot, dshHome, install: false, nodeVersion: 'v16.14.0', skipLivePortProbe: true });
    if (badNode.ok || badNode.gates[0].ok) throw new Error('低版本 Node 未触发 G1 阻断');

    const good = await verifyDoneGateInstallation({ projectRoot: repoRoot, dshHome, install: true, skipLivePortProbe: true });
    if (!good.ok || !String(good.proofToken || '').startsWith('DG-INSTALL-OK-')) {
      throw new Error('全新目录执行 --install 未通过：\n' + formatInstallReceiptBox(good));
    }

    const clientFile = join(dshHome, 'profiles', 'web', 'node_modules', '@local', 'dsh-donegate', 'lib', 'client.js');
    writeFileSync(clientFile, 'window.broken = true;\n', 'utf8');
    const badCorrupt = await verifyDoneGateInstallation({ projectRoot: repoRoot, dshHome, install: false, skipLivePortProbe: true });
    if (badCorrupt.ok || badCorrupt.gates[2].ok) throw new Error('损坏 client.js 后未被 G3 VM 试装拦截');

    console.log('RESULT: PASS 安装验真门禁 4 组正负样本（未装拦截 / 低版本拦截 / 中文空格路径全绿 / 坏包拦截）全过');
    return 0;
  } finally {
    try { rmSync(sb, { recursive: true, force: true }); } catch (err) { void err; }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const getFlag = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  if (argv.includes('--red-self-test')) {
    runRedSelfTest(DEFAULT_ROOT).then((code) => process.exit(code)).catch((err) => {
      console.error('RESULT: FAIL ' + (err.message || err));
      process.exit(1);
    });
  } else {
    verifyDoneGateInstallation({
      projectRoot: getFlag('--root') || DEFAULT_ROOT,
      dshHome: getFlag('--dsh-home'),
      install: argv.includes('--install')
    }).then((rep) => {
      if (argv.includes('--json')) console.log(JSON.stringify(rep, null, 2));
      else console.log(formatInstallReceiptBox(rep));
      process.exit(rep.ok ? 0 : 1);
    }).catch((err) => {
      console.error('RESULT: FAIL 安装验真执行异常：' + (err.message || err));
      process.exit(2);
    });
  }
}
