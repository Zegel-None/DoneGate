#!/usr/bin/env node
// Windows 优先的 DeepSeek Harness Web 插件包装配与安装器（遵循 dsh-doc 规范，支持 UI 添加本地目录与一键直装，<= 220 行）
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderDshDetailMd, renderDshIconSvg, renderDshLocaleEnJson,
  renderDshLocaleZhJson, renderDshPreviewSvg
} from './bundle-assets.mjs';
import {
  DSH_BUNDLE_NAME, renderDshBundleCordisPatch,
  renderDshBundlePackageJson, renderDshHostIndexJs
} from './bundle-templates.mjs';
import { renderDshClientBundleJs } from './client-bundle-gen.mjs';
import { normalizeLf, normalizeSlashes, resolveDshHome, resolveDshProfileDir } from '../deps/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SKILLS = ['donegate', 'donegate-judge', 'donegate-forge'];
const PATCH_BEGIN = '# --- BEGIN DONEGATE-V4 BUNDLE ---';
const PATCH_END = '# --- END DONEGATE-V4 BUNDLE ---';

export function buildDshBundleDirectory(projectRoot = REPO_ROOT, outDir = null) {
  const root = resolve(projectRoot);
  const bundleDir = outDir ? resolve(outDir) : join(root, '.donegate', 'dsh-bundle', 'dsh-donegate');
  mkdirSync(join(bundleDir, 'lib'), { recursive: true });
  mkdirSync(join(bundleDir, 'locale'), { recursive: true });
  mkdirSync(join(bundleDir, 'docs'), { recursive: true });
  mkdirSync(join(bundleDir, 'skills'), { recursive: true });

  writeFileSync(join(bundleDir, 'package.json'), renderDshBundlePackageJson(), 'utf8');
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), renderDshBundleCordisPatch(root), 'utf8');
  writeFileSync(join(bundleDir, 'icon.svg'), renderDshIconSvg(), 'utf8');
  writeFileSync(join(bundleDir, 'locale', 'zh.json'), renderDshLocaleZhJson(), 'utf8');
  writeFileSync(join(bundleDir, 'locale', 'en.json'), renderDshLocaleEnJson(), 'utf8');
  writeFileSync(join(bundleDir, 'docs', 'DETAIL.md'), renderDshDetailMd('en'), 'utf8');
  writeFileSync(join(bundleDir, 'docs', 'DETAIL.zh.md'), renderDshDetailMd('zh'), 'utf8');
  writeFileSync(join(bundleDir, 'docs', 'preview.svg'), renderDshPreviewSvg(), 'utf8');
  writeFileSync(join(bundleDir, 'lib', 'index.js'), renderDshHostIndexJs(root), 'utf8');
  writeFileSync(join(bundleDir, 'lib', 'client.js'), renderDshClientBundleJs(), 'utf8');

  for (const sk of SKILLS) {
    const src = join(root, sk);
    if (existsSync(join(src, 'SKILL.md'))) {
      const dst = join(bundleDir, 'skills', sk);
      rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
    }
  }
  return { bundleDir, name: DSH_BUNDLE_NAME };
}

export function mergeCordisPatchText(existingText, projectRoot) {
  const clean = normalizeLf(existingText || '');
  const strippedRaw = stripCordisPatchText(clean).trim();
  const stripped = (strippedRaw === '[]' || !strippedRaw) ? '' : strippedRaw;
  const block = [PATCH_BEGIN, renderDshBundleCordisPatch(projectRoot).trim(), PATCH_END].join('\n');
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
}

export function stripCordisPatchText(existingText) {
  const clean = normalizeLf(existingText || '');
  const start = clean.indexOf(PATCH_BEGIN);
  const end = clean.indexOf(PATCH_END);
  if (start < 0 || end < start) return clean.trim() ? clean : '[]\n';
  const before = clean.slice(0, start).trimEnd();
  const after = clean.slice(end + PATCH_END.length).trimStart();
  if (!before) return after ? `${after}\n` : '[]\n';
  return after ? `${before}\n${after}` : `${before}\n`;
}

function updateProfileManifestBundles(profileDir, bundleName, enable) {
  const pkgPath = join(profileDir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const prev = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];
    const next = enable
      ? (prev.includes(bundleName) ? prev : [...prev, bundleName])
      : prev.filter((item) => item !== bundleName && item !== 'dsh-donegate');
    manifest.dsh = { ...(manifest.dsh || {}), profile: { ...(manifest?.dsh?.profile || {}), bundles: next } };
    if (enable) {
      manifest.dependencies = { ...(manifest.dependencies || {}), [bundleName]: '0.4.0' };
    } else if (manifest.dependencies) {
      delete manifest.dependencies[bundleName];
      delete manifest.dependencies['dsh-donegate'];
    }
    writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

export function installDshWebBundle(opts = {}) {
  const projectRoot = resolve(opts.projectRoot || REPO_ROOT);
  const profileName = String(opts.profile || 'web').trim() || 'web';
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;

  const dshHome = opts.dshHome ? resolve(opts.dshHome) : resolve(resolveDshHome(env, platform));
  const profileDir = opts.profileDir
    ? resolve(opts.profileDir)
    : resolve(resolveDshProfileDir(profileName, { ...env, DSH_HOME: dshHome }, platform));

  const { bundleDir } = buildDshBundleDirectory(projectRoot);
  const targetModDir = join(profileDir, 'node_modules', '@local', 'dsh-donegate');
  mkdirSync(dirname(targetModDir), { recursive: true });
  rmSync(targetModDir, { recursive: true, force: true });
  rmSync(join(profileDir, 'node_modules', 'dsh-donegate'), { recursive: true, force: true });
  cpSync(bundleDir, targetModDir, { recursive: true });

  const projSkillsRoot = join(projectRoot, '.dsh', 'skills');
  mkdirSync(projSkillsRoot, { recursive: true });
  for (const sk of SKILLS) {
    rmSync(join(dshHome, 'skills', sk), { recursive: true, force: true });
    const src = join(projectRoot, sk);
    if (existsSync(join(src, 'SKILL.md'))) {
      const dst = join(projSkillsRoot, sk);
      rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
    }
  }

  const registeredInManifest = updateProfileManifestBundles(profileDir, DSH_BUNDLE_NAME, true);
  const patchPath = join(profileDir, 'cordis.patch.yml');
  if (!registeredInManifest) {
    const prevPatch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
    if (prevPatch && !prevPatch.includes(PATCH_BEGIN)) {
      writeFileSync(join(profileDir, 'cordis.patch.donegate-prev.yml'), prevPatch, 'utf8');
    }
    writeFileSync(patchPath, mergeCordisPatchText(prevPatch, projectRoot), 'utf8');
  } else if (existsSync(patchPath)) {
    const curPatch = readFileSync(patchPath, 'utf8');
    if (curPatch.includes(PATCH_BEGIN) || !curPatch.trim()) writeFileSync(patchPath, stripCordisPatchText(curPatch), 'utf8');
  }

  return {
    ok: true,
    platform,
    bundleName: DSH_BUNDLE_NAME,
    bundleDir: normalizeSlashes(bundleDir),
    dshHome: normalizeSlashes(dshHome),
    profileDir: normalizeSlashes(profileDir),
    targetModDir: normalizeSlashes(targetModDir),
    registeredInManifest,
    patchPath: normalizeSlashes(patchPath)
  };
}

export function uninstallDshWebBundle(opts = {}) {
  const profileName = String(opts.profile || 'web').trim() || 'web';
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const dshHome = opts.dshHome ? resolve(opts.dshHome) : resolve(resolveDshHome(env, platform));
  const profileDir = opts.profileDir ? resolve(opts.profileDir) : resolve(resolveDshProfileDir(profileName, { ...env, DSH_HOME: dshHome }, platform));

  rmSync(join(profileDir, 'node_modules', '@local', 'dsh-donegate'), { recursive: true, force: true });
  rmSync(join(profileDir, 'node_modules', 'dsh-donegate'), { recursive: true, force: true });
  for (const sk of SKILLS) rmSync(join(dshHome, 'skills', sk), { recursive: true, force: true });
  updateProfileManifestBundles(profileDir, DSH_BUNDLE_NAME, false);
  const patchPath = join(profileDir, 'cordis.patch.yml');
  if (existsSync(patchPath)) {
    writeFileSync(patchPath, stripCordisPatchText(readFileSync(patchPath, 'utf8')), 'utf8');
  }
  return { ok: true, profileDir: normalizeSlashes(profileDir) };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const getOpt = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };
  if (args.includes('--dry-run')) {
    const outDir = resolve(getOpt('--out') || join(REPO_ROOT, '.donegate', 'dsh-bundle', 'dsh-donegate'));
    console.log(`[dry-run] 将在工作区生成标准 DSH Bundle（不改动 ~/.dsh/profiles/*）：${normalizeSlashes(outDir)}`);
    console.log('  推荐安装方式：DSH Web「插件 > 添加插件」或调用 plugin_manager install_bundle 指向该目录。');
    process.exit(0);
  }
  if (args.includes('--uninstall')) {
    const res = uninstallDshWebBundle({ profile: getOpt('--profile') || 'web', dshHome: getOpt('--dsh-home') });
    console.log(`✓ 已从 DSH Web 配置卸载 ${DSH_BUNDLE_NAME} (${res.profileDir})`);
    process.exit(0);
  }
  if (args.includes('--legacy-direct-profile-write')) {
    console.warn('⚠ 警告：--legacy-direct-profile-write 会直接改写 profile package.json，可能导致 profile 内 pnpm add 404；更推荐默认安全打包模式并走 plugin_manager install_bundle。');
    const res = installDshWebBundle({
      projectRoot: REPO_ROOT,
      profile: getOpt('--profile') || 'web',
      dshHome: getOpt('--dsh-home')
    });
    console.log(`✓ [legacy] 已写入 ${res.bundleName} → ${res.targetModDir}`);
    process.exit(0);
  }
  const out = buildDshBundleDirectory(REPO_ROOT, getOpt('--out'));
  console.log(`✓ 已按 DSH 创造模式 (dsh-doc) 规范安全生成工作区插件包（未触碰 ~/.dsh/profiles/*）→ ${normalizeSlashes(out.bundleDir)}`);
  console.log('  安装方式：在 DSH Web 左栏「插件 > 添加插件」直接选择该目录，或调用 plugin_manager install_bundle 传入该绝对路径。');
  process.exit(0);
}
