// DeepSeek Harness (DSH) 宿主适配器薄包装（遵守 runner/harnesses/protocol.mjs，零侵入现有 runner/dsh/，<= 100 行）
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateHarnessAdapter } from './protocol.mjs';

function dshResolveHome(opts = {}) {
  if (typeof opts.dshHome === 'string' && opts.dshHome.trim()) return resolve(opts.dshHome);
  return resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
}

function dshPluginBundleDir(dshHome) {
  return join(dshHome, 'profiles', 'web', 'node_modules', '@local', 'dsh-donegate');
}

export const dshHarnessAdapter = validateHarnessAdapter({
  id: 'dsh',
  displayName: 'DeepSeek Harness (DSH)',
  description: 'DeepSeek Harness Web 原生插件包、工作台视图与 .dsh/skills 技能部署适配器。',
  implemented: true,
  capabilities: ['web-plugin', 'skills', 'presets', 'workbench-ui'],

  detect(opts = {}) {
    const dshHome = dshResolveHome(opts);
    const hasHome = existsSync(dshHome);
    const installed = existsSync(dshPluginBundleDir(dshHome));
    return {
      available: hasHome,
      installed,
      state: installed ? 'installed' : (hasHome ? 'available' : 'not-detected'),
      detail: installed ? `已挂载 @local/dsh-donegate (${dshHome})` : (hasHome ? `检测到 DSH 目录 (${dshHome})` : '未检测到 ~/.dsh')
    };
  },

  status(ctx = {}) {
    const dshHome = dshResolveHome(ctx);
    const bundleExists = existsSync(dshPluginBundleDir(dshHome));
    const localSkillsDir = join(ctx.projectRoot || process.cwd(), '.dsh', 'skills', 'donegate', 'SKILL.md');
    const localSkillsInstalled = existsSync(localSkillsDir);
    return {
      ok: true,
      id: 'dsh',
      displayName: 'DeepSeek Harness (DSH)',
      implemented: true,
      installed: bundleExists || localSkillsInstalled,
      dshHome,
      bundleExists,
      localSkillsInstalled,
      summary: bundleExists
        ? `DSH Web 插件已挂载（${dshHome}）`
        : (localSkillsInstalled ? '项目级 .dsh/skills 已部署（Web 插件包未挂载）' : 'DSH 尚未安装 DoneGate 插件或技能')
    };
  },

  install(ctx = {}) {
    const script = join(ctx.donegateRoot, 'skill', 'install-skills.mjs');
    if (!existsSync(script)) {
      return { ok: false, exitCode: 3, id: 'dsh', reason: `缺少技能部署脚本：${script}` };
    }
    const r = spawnSync(process.execPath, [script], {
      cwd: ctx.projectRoot || ctx.donegateRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
    if (r.status !== 0) {
      return { ok: false, exitCode: r.status || 1, id: 'dsh', reason: out || 'DSH 技能部署失败' };
    }
    return {
      ok: true,
      exitCode: 0,
      id: 'dsh',
      summary: '已完成项目级 .dsh/skills 部署；如需挂载 DSH Web 插件包，请在 Windows 运行 install-dsh-web.cmd 或经 DSH 插件管理器安装。',
      detail: out
    };
  },

  uninstall() {
    return {
      ok: false,
      exitCode: 3,
      id: 'dsh',
      reason: '为保护 ~/.dsh/profiles/web 下的本地配置与依赖锁，请通过 DSH 插件管理器界面卸载 @local/dsh-donegate。'
    };
  }
});
