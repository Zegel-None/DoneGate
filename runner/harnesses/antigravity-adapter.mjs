// Antigravity 原生插件宿主适配器（支持全局安装、默认随身质检钩子、agnix 规范自检与一键卸载，<= 220 行）
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { walk } from '../../skill/fs-walk.mjs';
import { validateHarnessAdapter } from './protocol.mjs';
import {
  ANTIGRAVITY_DONEGATE_LOGO_SVG,
  buildAntigravityGuardScript,
  buildAntigravityHooksJson,
  buildAntigravityMcpConfig,
  buildAntigravityPluginManifest,
  buildAntigravityRulesMd,
  degradeBrokenSkillLinks,
  stripDshOnlySkillFrontmatter
} from './antigravity-assets.mjs';

export const ANTIGRAVITY_DONEGATE_PLUGIN_NAME = 'donegate';
const SKILL_DIRS = ['donegate', 'donegate-judge', 'donegate-forge'];

export function resolveAntigravityDoneGateDir(opts = {}) {
  if (typeof opts.dir === 'string' && opts.dir.trim()) return resolve(opts.dir);
  if (typeof opts.pluginDir === 'string' && opts.pluginDir.trim()) return resolve(opts.pluginDir);
  const cfgRoot = (typeof opts.configRoot === 'string' && opts.configRoot.trim())
    ? resolve(opts.configRoot)
    : join(homedir(), '.gemini', 'config');
  return join(cfgRoot, 'plugins', ANTIGRAVITY_DONEGATE_PLUGIN_NAME);
}

function readDoneGateVersion(donegateRoot) {
  const vPath = join(donegateRoot, 'VERSION');
  if (existsSync(vPath)) {
    const v = readFileSync(vPath, 'utf8').trim();
    if (v) return v;
  }
  return '1.0.0';
}

function copySanitizedSkills(donegateRoot, pluginDir) {
  const installedSkills = [];
  for (const name of SKILL_DIRS) {
    const srcDir = join(donegateRoot, name);
    if (!existsSync(join(srcDir, 'SKILL.md'))) continue;
    const destDir = join(pluginDir, 'skills', name);
    rmSync(destDir, { recursive: true, force: true });
    const files = walk(srcDir, { skipDirs: [] }).files;
    for (const absFile of files) {
      const rel = relative(srcDir, absFile);
      const outPath = join(destDir, rel);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, readFileSync(absFile));
    }
    for (const absFile of files) {
      const rel = relative(srcDir, absFile);
      if (!rel.endsWith('.md')) continue;
      const outPath = join(destDir, rel);
      const raw = readFileSync(outPath, 'utf8');
      const noDsh = rel === 'SKILL.md' ? stripDshOnlySkillFrontmatter(raw) : raw;
      writeFileSync(outPath, degradeBrokenSkillLinks(noDsh, outPath, pluginDir), 'utf8');
    }
    installedSkills.push(name);
  }
  return installedSkills;
}

function runAgnixCheck(pluginDir) {
  const r = spawnSync('agnix', ['--target', 'antigravity', pluginDir], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (r.error) return { checked: false, ok: true, output: '未检测到 agnix，跳过规范校验' };
  const output = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  return { checked: true, ok: r.status === 0, exitCode: r.status, output };
}

function inspectPluginFiles(dir) {
  const required = ['plugin.json', 'mcp_config.json', join('rules', 'AGENTS.md'), join('assets', 'logo.svg')];
  const missing = required.filter((f) => !existsSync(join(dir, f)));
  const hooksEnabled = existsSync(join(dir, 'hooks.json')) && existsSync(join(dir, 'hooks', 'donegate-guard.mjs'));
  const skills = SKILL_DIRS.filter((s) => existsSync(join(dir, 'skills', s, 'SKILL.md')));
  return { missing, hooksEnabled, skills };
}

export const antigravityHarnessAdapter = validateHarnessAdapter({
  id: 'antigravity',
  displayName: 'Antigravity',
  description: 'Antigravity 原生插件适配器：多工作区治理 MCP (--require-root)、默认随身质检钩子、3 套技能与按需规则。',
  implemented: true,
  capabilities: ['native-plugin', 'mcp-require-root', 'lifecycle-hooks', 'skills', 'rules'],

  detect(opts = {}) {
    const dir = resolveAntigravityDoneGateDir(opts);
    const parentPlugins = dirname(dir);
    const configExists = existsSync(dirname(parentPlugins));
    const installed = existsSync(join(dir, 'plugin.json'));
    return {
      available: configExists,
      installed,
      state: installed ? 'installed' : (configExists ? 'available' : 'not-detected'),
      detail: installed ? `已安装至 ${dir}` : (configExists ? `检测到 Antigravity 配置目录 (${dirname(parentPlugins)})` : '未检测到 ~/.gemini/config')
    };
  },

  status(ctx = {}) {
    const dir = resolveAntigravityDoneGateDir(ctx);
    if (!existsSync(dir)) {
      return {
        ok: true,
        id: 'antigravity',
        displayName: 'Antigravity',
        implemented: true,
        installed: false,
        pluginDir: dir,
        summary: `尚未安装（目标目录：${dir}）`
      };
    }
    const { missing, hooksEnabled, skills } = inspectPluginFiles(dir);
    const agnix = runAgnixCheck(dir);
    const healthy = missing.length === 0 && (!agnix.checked || agnix.ok);
    const hookLabel = hooksEnabled ? '开启' : '关闭';
    const agnixLabel = agnix.checked ? (agnix.ok ? '0 error' : 'FAIL') : '跳过';
    const summary = healthy
      ? `已安装且健康（${dir} | 随身质检=${hookLabel} | 技能=${skills.length} | agnix=${agnixLabel}）`
      : `插件目录存在异常：缺文件=${missing.join(',') || '无'} | agnix=${agnixLabel}`;
    return {
      ok: healthy,
      id: 'antigravity',
      displayName: 'Antigravity',
      implemented: true,
      installed: missing.length === 0,
      pluginDir: dir,
      missing,
      hooksEnabled,
      skills,
      agnix,
      summary
    };
  },

  install(ctx = {}) {
    const donegateRoot = resolve(ctx.donegateRoot);
    const dir = resolveAntigravityDoneGateDir(ctx);
    const withHooks = ctx.noHooks ? false : true;
    const fullMcp = Boolean(ctx.fullMcp);
    const version = readDoneGateVersion(donegateRoot);

    mkdirSync(join(dir, 'assets'), { recursive: true });
    mkdirSync(join(dir, 'rules'), { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(buildAntigravityPluginManifest({ version }), null, 2) + '\n', 'utf8');
    writeFileSync(join(dir, 'mcp_config.json'), JSON.stringify(buildAntigravityMcpConfig({ donegateRoot, fullMcp }), null, 2) + '\n', 'utf8');
    writeFileSync(join(dir, 'rules', 'AGENTS.md'), buildAntigravityRulesMd({ fullMcp }), 'utf8');
    writeFileSync(join(dir, 'assets', 'logo.svg'), ANTIGRAVITY_DONEGATE_LOGO_SVG, 'utf8');

    if (withHooks) {
      mkdirSync(join(dir, 'hooks'), { recursive: true });
      writeFileSync(join(dir, 'hooks.json'), JSON.stringify(buildAntigravityHooksJson(), null, 2) + '\n', 'utf8');
      writeFileSync(join(dir, 'hooks', 'donegate-guard.mjs'), buildAntigravityGuardScript({ donegateRoot }), 'utf8');
    } else {
      rmSync(join(dir, 'hooks.json'), { force: true });
      rmSync(join(dir, 'hooks'), { recursive: true, force: true });
    }

    const skills = copySanitizedSkills(donegateRoot, dir);
    const agnix = runAgnixCheck(dir);
    return {
      ok: !agnix.checked || agnix.ok,
      exitCode: (!agnix.checked || agnix.ok) ? 0 : 1,
      id: 'antigravity',
      pluginDir: dir,
      hooksEnabled: withHooks,
      fullMcp,
      skills,
      agnix,
      summary: `已安装 DoneGate Antigravity 原生插件 → ${dir}（MCP=${fullMcp ? '全量8工具' : '治理4工具+互补zoom-cockpit'} | 随身质检=${withHooks ? '默认开启' : '关闭'} | 技能=${skills.join(', ')}）`
    };
  },

  uninstall(ctx = {}) {
    const dir = resolveAntigravityDoneGateDir(ctx);
    if (!existsSync(dir)) {
      return { ok: true, exitCode: 0, id: 'antigravity', pluginDir: dir, summary: `插件目录不存在，无需卸载（${dir}）` };
    }
    rmSync(dir, { recursive: true, force: true });
    return { ok: true, exitCode: 0, id: 'antigravity', pluginDir: dir, summary: `已卸载 DoneGate Antigravity 插件：${dir}` };
  }
});
