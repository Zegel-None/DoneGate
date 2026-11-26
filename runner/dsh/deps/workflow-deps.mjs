#!/usr/bin/env node
// 工作流类 ComfyUI 依赖探针、跨工作流共享底座池 (workflows/.deps/_shared/)、免 401 CLI 刷新与补齐工单生成器
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';
import {
  DEFAULT_RANGE_CHUNK_BYTES, buildWinHardenedGitArgs, cleanStaleGitIndexLock,
  downloadWithRangeResume, provisionCleanRepoSnapshot, repairGitRepoCleanIndex
} from './shared-pool-net.mjs';
import {
  assertPureAsciiBatch, buildSharedPoolLauncherScripts, ensureSharedPoolSkeleton,
  installSharedPoolBinaryDep, isWritableDir, parseFlexibleDepsManifest, readSharedRefreshStamp,
  reconcileSharedPoolOnRefresh, recordSharedPoolDepReady, refreshWorkflowDepsStamp,
  resolvePoolGradleUserHome, scanSharedPoolDiskInventory, verifyInstalledNpmPackage,
  verifySharedPoolLauncher, writeJsonAtomic, writeSharedPoolLaunchers, writeStandaloneDepsCli
} from './shared-pool-installer.mjs';

export {
  DEFAULT_RANGE_CHUNK_BYTES, assertPureAsciiBatch, buildSharedPoolLauncherScripts,
  buildWinHardenedGitArgs, cleanStaleGitIndexLock, downloadWithRangeResume,
  ensureSharedPoolSkeleton, installSharedPoolBinaryDep, isWritableDir,
  parseFlexibleDepsManifest, provisionCleanRepoSnapshot, readSharedRefreshStamp,
  reconcileSharedPoolOnRefresh, recordSharedPoolDepReady, refreshWorkflowDepsStamp,
  repairGitRepoCleanIndex, resolvePoolGradleUserHome, scanSharedPoolDiskInventory,
  verifyInstalledNpmPackage, verifySharedPoolLauncher, writeJsonAtomic,
  writeSharedPoolLaunchers, writeStandaloneDepsCli
};

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BUILTIN_ZERO_DEP_TPLS = new Set([
  'tpl-blank', 'tpl-router-rule', 'tpl-router-ai', 'tpl-deai-polish', 'tpl-prompt-gen', 'tpl-anti-slop', 'tpl-human-gate'
]);
const KNOWN_TEMPLATE_BINS = {
  'tpl-openspec': { id: 'openspec', bin: 'openspec', repo: 'Fission-AI/OpenSpec', kind: 'npm-cli', pkg: '@fission-ai/openspec' },
  'tpl-biome-knip': { id: 'biome', bin: 'biome', repo: 'biomejs/biome', kind: 'npm-cli', pkg: '@biomejs/biome' },
  'tpl-gradle': { id: 'gradle', bin: 'gradle', repo: 'gradle/gradle', kind: 'archive-bin' },
  'tpl-maestro': { id: 'maestro', bin: 'maestro', repo: 'mobile-dev-inc/Maestro', kind: 'archive-bin' },
  'tpl-playwright': { id: 'playwright', bin: 'playwright', repo: 'microsoft/playwright', kind: 'npm-cli', pkg: '@playwright/test' },
  'tpl-gitleaks': { id: 'gitleaks', bin: 'gitleaks', repo: 'gitleaks/gitleaks', kind: 'archive-bin' }
};
export const BUILTIN_CATALOG_PACK_SPECS = {
  'pack-core-logic': { id: 'pack-core-logic', name: '核心纯逻辑工作流', nodes: [{ id: 'cl-1', tplId: 'tpl-anti-slop' }, { id: 'cl-2', tplId: 'tpl-router-rule' }, { id: 'cl-3', tplId: 'tpl-prompt-gen' }] },
  'pack-api-guard': { id: 'pack-api-guard', name: '接口与密钥工作流', nodes: [{ id: 'ag-1', tplId: 'tpl-anti-slop' }, { id: 'ag-2', tplId: 'tpl-gitleaks', title: '密钥密码防泄漏', repoSlug: 'gitleaks/gitleaks', pinnedVersion: 'v8.18.4' }, { id: 'ag-3', tplId: 'tpl-router-rule' }] },
  'pack-android': { id: 'pack-android', name: '安卓应用工作流', nodes: [{ id: 'n-guard', tplId: 'tpl-anti-slop' }, { id: 'n-gradle', tplId: 'tpl-gradle', title: '安卓安装包构建', repoSlug: 'gradle/gradle', pinnedVersion: 'v8.10.2' }, { id: 'n-maestro', tplId: 'tpl-maestro', title: '安卓界面交互验收', repoSlug: 'mobile-dev-inc/Maestro', pinnedVersion: 'v1.38.1' }] },
  'pack-polish-loop': { id: 'pack-polish-loop', name: '去 AI 味润色工作流', nodes: [{ id: 'p-spec', tplId: 'tpl-openspec', title: '需求规格审校', repoSlug: 'Fission-AI/OpenSpec', pinnedVersion: 'v0.2.4' }, { id: 'p-loop', tplId: 'tpl-deai-polish' }, { id: 'p-final', tplId: 'tpl-prompt-gen' }] },
  'pack-web': { id: 'pack-web', name: '网页全栈工作流', nodes: [{ id: 'w-1', tplId: 'tpl-anti-slop' }, { id: 'w-2', tplId: 'tpl-biome-knip', title: '语法与死代码检查', repoSlug: 'biomejs/biome', pinnedVersion: 'v1.9.4' }, { id: 'w-3', tplId: 'tpl-router-rule' }, { id: 'w-4', tplId: 'tpl-playwright', title: '网页真机点击联调', repoSlug: 'microsoft/playwright', pinnedVersion: 'v1.48.0' }, { id: 'w-5', tplId: 'tpl-prompt-gen' }] },
  'pack-release': { id: 'pack-release', name: '上线安全工作流', nodes: [{ id: 'r-1', tplId: 'tpl-gitleaks', title: '密钥密码防泄漏', repoSlug: 'gitleaks/gitleaks', pinnedVersion: 'v8.18.4' }, { id: 'r-2', tplId: 'tpl-router-ai' }] },
  uiboard: {
    id: 'uiboard', name: 'UI 看板增强套件（跨框架点选 / 拖拽 / Agent 自测）',
    deps: [
      { id: 'lovinsp', title: 'Lovinsp 跨框架 DOM 源码定位器', repo: 'lovstudio/lovinsp', version: 'v1.8.0', kind: 'npm-lib', pkg: 'lovinsp', allowHostEnv: false },
      { id: 'react-grab', title: 'React Grab 组件栈拾取器', repo: 'aidenybai/react-grab', version: 'v0.1.0', kind: 'npm-lib', pkg: 'react-grab', allowHostEnv: false },
      { id: 'puck', title: 'Puck 模块化拖拽布局核', repo: 'measuredco/puck', version: 'v0.24.1', kind: 'npm-lib', pkg: '@puckeditor/core', allowHostEnv: false },
      { id: 'agent-browser', title: 'Vercel Agent Browser 自测 CLI', repo: 'vercel-labs/agent-browser', version: 'v0.43.0', kind: 'npm-cli', pkg: 'agent-browser', bin: 'agent-browser', allowHostEnv: false }
    ],
    nodes: []
  }
};

const sanitizeId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
const normalizeDepVer = (v) => String(v || '').trim().replace(/^v/i, '');
const versionsMatch = (want, have) => {
  const w = normalizeDepVer(want), h = normalizeDepVer(have);
  return !w || !h || w === h;
};
const isNpmLibItem = (it) => Boolean(it && it.pkg && (it.kind === 'npm-lib' || (it.kind === 'npm' && !it.bin)));
const isNpmCliItem = (it) => Boolean(it && it.pkg && (it.kind === 'npm-cli' || (it.kind === 'npm' && it.bin)));

export function getWorkflowDepsPaths(projectRoot, packId, platform = process.platform) {
  const root = resolve(projectRoot);
  const safeId = sanitizeId(packId);
  const relDir = `workflows/.deps/${safeId}`;
  const absDir = join(root, 'workflows', '.deps', safeId);
  return {
    safeId, relDir, absDir,
    manifestPath: join(absDir, 'manifest.json'),
    planPath: join(absDir, 'PROVISION-PLAN.json'),
    refreshStampPath: join(absDir, '.refresh-stamp.json'),
    binDir: join(absDir, '.bin'),
    distsDir: join(absDir, 'dists'),
    gradleHomeDir: join(absDir, '.gradle-home'),
    npmBinDir: join(absDir, 'npm', 'node_modules', '.bin'),
    venvBinDir: platform === 'win32' ? join(absDir, 'venv', 'Scripts') : join(absDir, 'venv', 'bin'),
    reposDir: join(absDir, 'repos')
  };
}

export function getSharedWorkflowDepsPaths(projectRoot, platform = process.platform) {
  return getWorkflowDepsPaths(projectRoot, '_shared', platform);
}

export function findExecutableInDirs(binName, searchDirs, platform = process.platform) {
  if (!binName) return null;
  const exts = platform === 'win32'
    ? (/\.(exe|cmd|bat|com|ps1)$/i.test(binName) ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1'])
    : [''];
  for (const dir of searchDirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const ext of exts) {
      const p = join(dir, binName + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function isNonEmptyRepoDir(dir) {
  if (!dir || !existsSync(dir)) return false;
  try {
    if (!statSync(dir).isDirectory()) return false;
    return existsSync(join(dir, '.git')) || readdirSync(dir).length > 0;
  } catch (err) {
    void err;
    return false;
  }
}

function readBrickMeta(projectRoot, toolName) {
  if (!toolName) return null;
  const localCap = join(resolve(projectRoot), 'bricks', toolName, 'capabilities.json');
  const capPath = existsSync(localCap) ? localCap : join(DG_ROOT, 'bricks', toolName, 'capabilities.json');
  if (!existsSync(capPath)) return null;
  const r = readJsonStrict(capPath);
  return r.ok && r.value ? r.value : null;
}

function wfdInferDepKind(rawKind, pkg, bin) {
  if (rawKind) return String(rawKind);
  if (!pkg) return 'git';
  return bin ? 'npm-cli' : 'npm-lib';
}

function wfdBuildNormalizedDepEntry(id, raw, nodeId) {
  const repo = String(raw.repo || raw.repoSlug || '').trim();
  const pkg = String(raw.pkg || raw.package || '').trim();
  const bin = raw.kind === 'npm-lib' ? '' : String(raw.bin || '').trim();
  const defaultRepoUrl = repo ? `https://github.com/${repo}` : '';
  return {
    id,
    title: String(raw.title || id),
    nodeIds: nodeId ? [nodeId] : [],
    repo,
    repoUrl: String(raw.repoUrl || defaultRepoUrl),
    version: String(raw.version || raw.pinnedVersion || '').trim(),
    kind: wfdInferDepKind(raw.kind, pkg, bin),
    bin,
    pkg,
    installCmd: String(raw.installCmd || '').trim(),
    allowHostEnv: raw.allowHostEnv !== false
  };
}

function wfdAddDepRecord(byId, raw, nodeId = null) {
  if (!raw || typeof raw !== 'object') return;
  const id = String(raw.id || raw.tool || raw.bin || '').trim();
  if (!id) return;
  const existing = byId.get(id);
  if (existing) {
    if (nodeId && !existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
    return;
  }
  byId.set(id, wfdBuildNormalizedDepEntry(id, raw, nodeId));
}

function wfdResolveToolBrickDep(root, nd, toolName) {
  const cap = readBrickMeta(root, toolName);
  if (cap && (cap.archetype === 'knowledge-skill' || cap.archetype === 'aggregator') && !cap.install) {
    return null;
  }
  const inst = (cap && cap.install && typeof cap.install === 'object') ? cap.install : {};
  const up = (cap && cap.upstream && typeof cap.upstream === 'object') ? cap.upstream : {};
  return {
    id: toolName,
    title: nd.title || cap?.card?.title || toolName,
    repo: inst.repo || up.repo || nd.repoSlug || '',
    version: inst.version || nd.pinnedVersion || '',
    kind: inst.kind || 'archive-bin',
    bin: inst.bin !== undefined ? inst.bin : toolName,
    pkg: inst.pkg || inst.package || '',
    installCmd: inst.installCmd || '',
    allowHostEnv: inst.allowHostEnv !== false
  };
}

function wfdCollectFallbackNodeDep(root, nd, byId) {
  const known = KNOWN_TEMPLATE_BINS[nd.tplId];
  if (known) {
    wfdAddDepRecord(byId, { ...known, title: nd.title || known.id, version: nd.pinnedVersion || '' }, nd.id);
    return;
  }
  const adpMatch = typeof nd.tplId === 'string' ? nd.tplId.match(/^tpl-adp-(.+)$/) : null;
  const toolName = nd.tool || nd.exec?.tool || (adpMatch ? adpMatch[1] : '');
  if (toolName) {
    const brickDep = wfdResolveToolBrickDep(root, nd, toolName);
    if (brickDep) wfdAddDepRecord(byId, brickDep, nd.id);
    return;
  }
  if (nd.requiresDep !== true && (!nd.repoSlug || nd.requiresDep === false)) return;
  const slugId = (nd.repoSlug ? nd.repoSlug.split('/').pop() : nd.id).toLowerCase();
  wfdAddDepRecord(byId, {
    id: slugId, title: nd.title || slugId, repo: nd.repoSlug || '',
    repoUrl: nd.repoUrl || '', version: nd.pinnedVersion || '', kind: 'git', bin: nd.bin || ''
  }, nd.id);
}

function wfdCollectNodeDepItems(root, nd, byId) {
  if (!nd || nd.bypassed || nd.isBlank || nd.isBoundary) return;
  if (nd.isSubgraph && nd.subgraph && Array.isArray(nd.subgraph.nodes)) {
    for (const sub of resolveWorkflowDepItems(root, nd.subgraph)) wfdAddDepRecord(byId, sub, nd.id);
    return;
  }
  if (BUILTIN_ZERO_DEP_TPLS.has(nd.tplId) && !nd.installSpec && !Array.isArray(nd.deps)) return;
  if (Array.isArray(nd.deps)) {
    for (const d of nd.deps) wfdAddDepRecord(byId, d, nd.id);
    return;
  }
  if (nd.installSpec && typeof nd.installSpec === 'object') {
    wfdAddDepRecord(byId, {
      id: nd.installSpec.id || nd.id, title: nd.title,
      repoSlug: nd.repoSlug, pinnedVersion: nd.pinnedVersion, ...nd.installSpec
    }, nd.id);
    return;
  }
  wfdCollectFallbackNodeDep(root, nd, byId);
}

export function resolveWorkflowDepItems(projectRoot, pack) {
  if (!pack || typeof pack !== 'object') return [];
  const root = resolve(projectRoot || process.cwd());
  const byId = new Map();
  if (Array.isArray(pack.deps)) {
    for (const d of pack.deps) wfdAddDepRecord(byId, d, null);
  }
  const nodes = Array.isArray(pack.nodes) ? pack.nodes : [];
  for (const nd of nodes) wfdCollectNodeDepItems(root, nd, byId);
  return [...byId.values()];
}

function wfdFormatMissingDepHint(m, packId, sharedRelDir, cliRel, cleanVer) {
  if (m.installCmd) return `执行 \`${m.installCmd}\``;
  const verFlag = cleanVer ? ` --version ${cleanVer}` : '';
  if (isNpmLibItem(m)) {
    return `[npm-lib 纯库] 一键执行 \`node ${cliRel} install-npm --project . --workflow ${packId} --id ${m.id} --kind npm-lib --pkg ${m.pkg}${verFlag}\`（自动以 --save-exact 装入 ${sharedRelDir}/npm 并校验落盘，严禁手敲 --no-save 或生成 dists/*.bat）`;
  }
  if (isNpmCliItem(m)) {
    return `[npm-cli 独立工具舱] 一键执行 \`node ${cliRel} install-npm --project . --workflow ${packId} --id ${m.id} --kind npm-cli --pkg ${m.pkg}${verFlag} --bin ${m.bin || m.id}\`（自动装入独立隔离舱 ${sharedRelDir}/npm-cells/${sanitizeId(m.id)}/ 避免 vite 等 peer 冲突、自愈 esbuild、生成带 NODE_PATH 的 .bin 启动器并完成验真）`;
  }
  if (m.repoUrl) return `落盘至 \`${sharedRelDir}/repos/${m.id}\` 并生成 \`${sharedRelDir}/.bin\` 启动器`;
  return `补齐可执行工具 \`${m.bin || m.id}\``;
}

export function buildProvisionAgentPrompt(pack, relDepsDir, sharedRelDir, missing) {
  const packId = sanitizeId((pack && pack.id) || 'default');
  const name = (pack && pack.name) || packId || '当前工作流';
  const cliRel = `${sharedRelDir}/dg-deps-cli.mjs`;
  if (!missing.length) {
    return `工作流「${name}」所需的外部项目与环境依赖已全部就位（共享池：${sharedRelDir}，工作流目录：${relDepsDir}）。`;
  }
  const lines = [
    `请为工作流「${name}」在后台补齐以下 ${missing.length} 项开源项目与运行环境依赖，统一装入跨工作流共享底座池 \`${sharedRelDir}/\`（已预置零外部依赖自包含 CLI \`${cliRel}\`，自动维护 \`${sharedRelDir}/{.bin,dists,repos,npm}\` 四大目录，一次安装全局复用）：`
  ];
  for (const m of missing) {
    const ver = m.version ? ` (${m.version})` : '';
    const src = m.repoUrl ? ` · ${m.repoUrl}` : '';
    const hint = wfdFormatMissingDepHint(m, packId, sharedRelDir, cliRel, normalizeDepVer(m.version));
    lines.push(`- **${m.title}** (\`${m.id}\`${ver})${src} → ${hint}`);
  }
  const sample = missing.find((x) => !isNpmLibItem(x)) || missing[0];
  const sampleBin = sample.bin || sample.id;
  const sampleVer = normalizeDepVer(sample.version) || 'latest';
  lines.push(
    '',
    '### Windows 11 共享池防坑硬规约（必读 · 统一调用工作区自包含 CLI）',
    `1. **禁用原生 curl/Invoke-WebRequest，规避 Schannel 与脏 Git 索引**：Windows Schannel 易报 \`SEC_E_NO_CREDENTIALS\` 且大仓完整 clone 易断连残留 24000+ 条 \`D \` 脏记录与 \`.git/index.lock\`。Git 命令统一加 \`-c core.longpaths=true -c http.sslBackend=openssl\`（有代理时显式加 \`-c http.proxy=... -c https.proxy=...\`）；优先下载 tag tarball 解压，随后执行 \`node ${cliRel} repair-git --repo ${sharedRelDir}/repos/${sample.id}\` 清理陈旧 \`index.lock\` 并仅执行 \`read-tree --reset HEAD\`（严禁 \`git add -A\`）确保零 \`D \` 脏记录。`,
    `2. **大体积压缩包 1 MiB HTTP Range 分块断点续传**：下载大体积发行包（如 Gradle zip）须运行 \`node ${cliRel} download --url <url> --dest ${sharedRelDir}/dists/<file>\` 或导入 \`./${cliRel}\` 的 \`downloadWithRangeResume\`（默认 \`1 MiB = 1048576\` 字节 \`Range\` 分块、支持 302/307 跳转、\`.part\` 断点续传、单块最多 8 次指数退避重试、字节长度与 SHA-256 校验通过后原子重命名）。`,
    `3. **严禁 --no-save，按 npm-lib / npm-cli 独立工具舱 / archive-bin 分舱隔离**：严禁手敲 \`npm install --no-save\`（会导致共享目录已装包被卸载清空！）；\`npm-lib\` 与 \`npm-cli\` 统一调用 \`node ${cliRel} install-npm\`（\`npm-cli\` 自动装入 \`${sharedRelDir}/npm-cells/<id>/\` 独立隔离舱彻底杜绝 vite 6/8 等 peer 冲突并自动注入 \`NODE_PATH\`）；独立发行包执行 \`node ${cliRel} write-launchers --project . --bin ${sampleBin} --dist <dist-dir>\` 生成 100% 纯 ASCII + CRLF 三入口启动器（\`%~dp0\` 相对解析，Gradle 自动绑定可写 \`GRADLE_USER_HOME\` 至 \`${sharedRelDir}/.gradle-home\`）。`,
    `4. **双层 \`manifest.json\` 落盘与免 401 本地 CLI 刷新**：严禁直接请求 \`http://127.0.0.1:3200/\`（会撞 \`401 Unauthorized\`）。自检通过后运行免鉴权本地命令 \`node ${cliRel} mark-ready --project . --workflow ${packId} --id ${sample.id} --version ${sampleVer} --detected-version ${sampleVer}\`（单包名称用 \`--label\` 仅写条目自身，绝不覆盖工作流顶层 \`label\`；亦可执行 \`node ${cliRel} refresh --project . --workflow ${packId}\`），原子更新双层 \`manifest.json\` 与 \`.refresh-stamp.json\`。`
  );
  return lines.join('\n');
}

function checkVerifyPathExists(root, relPath) {
  if (!relPath) return true;
  const abs = resolve(root, relPath);
  return existsSync(abs) || existsSync(`${abs}.bat`) || existsSync(`${abs}.cmd`) || existsSync(`${abs}.exe`);
}

function isManifestRecValid(rec, sharedRec, root, ignoreSharedPool) {
  if (!rec || rec.ready !== true || rec.versionMismatch === true || rec.status === 'missing-on-disk') return false;
  if (rec.verifyPath && !checkVerifyPathExists(root, rec.verifyPath)) return false;
  if (rec.sharedPool === true) {
    if (ignoreSharedPool) return false;
    if (sharedRec && (sharedRec.ready === false || sharedRec.versionMismatch === true || sharedRec.status === 'missing-on-disk')) return false;
    if (sharedRec && sharedRec.verifyPath && !checkVerifyPathExists(root, sharedRec.verifyPath)) return false;
  }
  return true;
}

function wfdLoadParsedManifest(manifestPath) {
  if (!existsSync(manifestPath)) return { entriesById: {}, lookup: () => null };
  const res = readJsonStrict(manifestPath);
  return res.ok && res.value ? parseFlexibleDepsManifest(res.value) : { entriesById: {}, lookup: () => null };
}

function wfdHasRecordVersionMismatch(rec, wantVer) {
  if (!rec) return false;
  if (rec.versionMismatch) return true;
  return Boolean(rec.detectedVersion && !versionsMatch(wantVer, rec.detectedVersion));
}

function wfdResolveBinCandidate(it, diskRec, ctx) {
  const inWf = findExecutableInDirs(it.bin, ctx.localBins, ctx.platform);
  if (inWf) return { resolvedVia: 'workflow-deps', resolvedPath: normalizeSlashes(inWf), detectedOverride: null };
  const inShared = ctx.ignoreSharedPool ? null : findExecutableInDirs(it.bin, ctx.sharedBins, ctx.platform);
  if (inShared) return { resolvedVia: 'shared-deps', resolvedPath: normalizeSlashes(inShared), detectedOverride: null };
  if (diskRec && versionsMatch(it.version, diskRec.version)) {
    return {
      resolvedVia: 'shared-deps',
      resolvedPath: diskRec.relBin,
      detectedOverride: diskRec.version ? normalizeDepVer(diskRec.version) : null
    };
  }
  if (it.allowHostEnv) {
    const inHost = findExecutableInDirs(it.bin, ctx.hostBins, ctx.platform);
    if (inHost) return { resolvedVia: 'host-env', resolvedPath: normalizeSlashes(inHost), detectedOverride: null };
  }
  return null;
}

function wfdResolveRepoCandidate(it, repoShort, ctx) {
  const repoCloneDir = join(ctx.paths.reposDir, sanitizeId(it.id));
  if (isNonEmptyRepoDir(repoCloneDir)) {
    return { resolvedVia: 'workflow-repo', resolvedPath: normalizeSlashes(repoCloneDir) };
  }
  if (ctx.ignoreSharedPool) return null;
  const sharedRepoDir = join(ctx.shared.reposDir, sanitizeId(repoShort || it.id));
  if (isNonEmptyRepoDir(sharedRepoDir)) {
    return { resolvedVia: 'shared-repo', resolvedPath: normalizeSlashes(sharedRepoDir) };
  }
  const altSharedRepoDir = join(ctx.shared.reposDir, sanitizeId(it.id));
  if (isNonEmptyRepoDir(altSharedRepoDir)) {
    return { resolvedVia: 'shared-repo', resolvedPath: normalizeSlashes(altSharedRepoDir) };
  }
  return null;
}

function wfdResolvePrimaryDepMatch(it, rec, sharedRec, npmCheck, allowSharedNpm, diskRec, ctx) {
  if (isNpmLibItem(it) && npmCheck.ok && allowSharedNpm && versionsMatch(it.version, npmCheck.version)) {
    return {
      resolvedVia: npmCheck.scope === 'shared' ? 'shared-npm' : 'workflow-npm',
      resolvedPath: npmCheck.relPkgJson,
      detectedOverride: npmCheck.version
    };
  }
  const recVer = rec?.detectedVersion || rec?.version || sharedRec?.version;
  if (isManifestRecValid(rec, sharedRec, ctx.root, ctx.ignoreSharedPool) && versionsMatch(it.version, recVer)) {
    const fallbackDir = rec.sharedPool ? ctx.shared.relDir : ctx.paths.relDir;
    return {
      resolvedVia: rec.sharedPool ? 'workflow-shared-manifest' : 'workflow-manifest',
      resolvedPath: rec.verifyPath || rec.entry || rec.bin || sharedRec?.bin || fallbackDir,
      detectedOverride: null
    };
  }
  const sharedVer = sharedRec?.detectedVersion || sharedRec?.version;
  if (!ctx.ignoreSharedPool && isManifestRecValid(sharedRec, null, ctx.root, false) && versionsMatch(it.version, sharedVer)) {
    return {
      resolvedVia: 'shared-manifest',
      resolvedPath: sharedRec.verifyPath || sharedRec.entry || sharedRec.bin || ctx.shared.relDir,
      detectedOverride: null
    };
  }
  if (it.bin) return wfdResolveBinCandidate(it, diskRec, ctx);
  return null;
}

function wfdResolveUnmismatchedDep(it, repoShort, rec, sharedRec, npmCheck, allowSharedNpm, diskRec, ctx) {
  const primary = wfdResolvePrimaryDepMatch(it, rec, sharedRec, npmCheck, allowSharedNpm, diskRec, ctx);
  if (primary) return primary;
  if (it.pkg && npmCheck.ok && allowSharedNpm && versionsMatch(it.version, npmCheck.version)) {
    return {
      resolvedVia: npmCheck.scope === 'shared' ? 'shared-npm' : 'workflow-npm',
      resolvedPath: npmCheck.relPkgJson,
      detectedOverride: null
    };
  }
  if (!it.bin && !isNpmLibItem(it)) {
    const repoHit = wfdResolveRepoCandidate(it, repoShort, ctx);
    if (repoHit) return { ...repoHit, detectedOverride: null };
  }
  return null;
}

function wfdInspectSingleDepItem(it, ctx) {
  const repoShort = it.repo ? it.repo.split('/').pop() : '';
  const matchKeys = [it.id, it.pkg, it.bin, it.repo, repoShort].filter(Boolean);
  const rec = ctx.wfManifest.lookup(matchKeys);
  const sharedRec = ctx.sharedManifest.lookup(matchKeys);
  const npmCheck = it.pkg ? verifyInstalledNpmPackage(ctx.root, it.pkg, ctx.packId) : { ok: false };
  const allowSharedNpm = !(ctx.ignoreSharedPool && npmCheck.scope === 'shared');
  const diskRec = isNpmLibItem(it) ? null : ctx.sharedDisk.lookup(matchKeys);
  const explicitMismatch = wfdHasRecordVersionMismatch(rec, it.version) || wfdHasRecordVersionMismatch(sharedRec, it.version);

  const npmVerHint = npmCheck.ok && allowSharedNpm ? npmCheck.version : '';
  let detectedVersion = normalizeDepVer(
    npmVerHint || rec?.detectedVersion || sharedRec?.detectedVersion || rec?.version || sharedRec?.version || diskRec?.version || ''
  );
  let resolvedVia = null;
  let resolvedPath = null;

  if (!explicitMismatch) {
    const hit = wfdResolveUnmismatchedDep(it, repoShort, rec, sharedRec, npmCheck, allowSharedNpm, diskRec, ctx);
    if (hit) {
      resolvedVia = hit.resolvedVia;
      resolvedPath = hit.resolvedPath;
      if (hit.detectedOverride !== null) detectedVersion = hit.detectedOverride;
    }
  }

  const ready = Boolean(resolvedVia);
  let status = 'missing';
  if (ready) status = 'ready';
  else if (explicitMismatch) status = 'version-mismatch';
  return { ...it, ready, status, detectedVersion, resolvedVia, resolvedPath };
}

export function inspectWorkflowDeps(projectRoot, pack, opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const root = resolve(projectRoot || process.cwd());
  const packId = (pack && pack.id) || 'default';
  const paths = getWorkflowDepsPaths(root, packId, platform);
  const shared = getSharedWorkflowDepsPaths(root, platform);
  const ignoreSharedPool = opts.ignoreSharedPool === true;

  const wfManifest = wfdLoadParsedManifest(paths.manifestPath);
  const sharedManifest = wfdLoadParsedManifest(shared.manifestPath);
  const sharedDisk = ignoreSharedPool ? { exists: false, tools: [], lookup: () => null } : scanSharedPoolDiskInventory(root, platform);
  const refreshStamp = readSharedRefreshStamp(root);

  const pathSep = platform === 'win32' ? ';' : delimiter;
  const rawPath = String(env.PATH ?? env.Path ?? env.path ?? '');
  const ctx = {
    root, packId, platform, paths, shared, ignoreSharedPool, wfManifest, sharedManifest, sharedDisk,
    localBins: [paths.binDir, paths.npmBinDir, paths.venvBinDir],
    sharedBins: [shared.binDir, shared.npmBinDir, shared.venvBinDir],
    hostBins: [join(root, 'node_modules', '.bin'), join(DG_ROOT, 'node_modules', '.bin'), ...rawPath.split(pathSep).filter(Boolean)]
  };

  const items = resolveWorkflowDepItems(root, pack).map((it) => wfdInspectSingleDepItem(it, ctx));
  const missing = items.filter((x) => !x.ready);
  return {
    packId, packName: (pack && pack.name) || packId, depsDir: paths.relDir, sharedDepsDir: shared.relDir,
    ready: missing.length === 0, total: items.length, readyCount: items.length - missing.length,
    missingCount: missing.length, items, missing, refreshStamp,
    agentPrompt: buildProvisionAgentPrompt(pack, paths.relDir, shared.relDir, missing)
  };
}

function wfdMergeDiskReadyItems(diskTools, parsed, byId) {
  for (const t of diskTools) {
    const known = parsed.lookup([t.id]);
    if (known && (known.versionMismatch || known.status === 'pending')) continue;
    const k = t.id.toLowerCase();
    if (!byId.has(k)) byId.set(k, { id: t.id, version: t.version || '', bin: t.relBin, source: 'shared-disk' });
    else if (!byId.get(k).version && t.version) byId.get(k).version = t.version;
  }
}

function wfdMergeUiboardReadyItems(root, byId) {
  for (const d of BUILTIN_CATALOG_PACK_SPECS.uiboard.deps) {
    const k = d.id.toLowerCase();
    if (byId.has(k) || !d.pkg) continue;
    const chk = verifyInstalledNpmPackage(root, d.pkg, 'uiboard');
    if (chk.ok) byId.set(k, { id: d.id, version: chk.version, bin: chk.relPkgJson, source: 'shared-npm' });
  }
}

function wfdFormatSharedSummaryLabel(readyItems) {
  if (readyItems.length === 0) return '';
  const labels = readyItems.map((x) => {
    const cap = x.id.charAt(0).toUpperCase() + x.id.slice(1);
    return x.version ? `${cap} ${x.version}` : cap;
  });
  return labels.length <= 2 ? `${labels.join('、')} 已就绪` : `${labels.slice(0, 2).join('、')} 等 ${labels.length} 项已就绪`;
}

export function summarizeSharedPoolStatus(projectRoot, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  const platform = opts.platform || process.platform;
  const shared = getSharedWorkflowDepsPaths(root, platform);
  const parsed = wfdLoadParsedManifest(shared.manifestPath);
  const disk = scanSharedPoolDiskInventory(root, platform);
  const byId = new Map();
  for (const rec of Object.values(parsed.entriesById)) {
    if (!rec.ready || rec.versionMismatch) continue;
    byId.set(rec.id.toLowerCase(), {
      id: rec.id, version: rec.detectedVersion || rec.version || '',
      bin: rec.bin || rec.entry || `workflows/.deps/_shared/.bin/${rec.id}`, source: 'shared-manifest'
    });
  }
  wfdMergeDiskReadyItems(disk.tools, parsed, byId);
  wfdMergeUiboardReadyItems(root, byId);
  const readyItems = [...byId.values()];
  return {
    sharedDepsDir: shared.relDir,
    readyCount: readyItems.length,
    readyItems,
    summaryLabel: wfdFormatSharedSummaryLabel(readyItems)
  };
}

export function inspectAllKnownWorkflowPacks(projectRoot, extraPacks = {}, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  const mergedPacks = { ...BUILTIN_CATALOG_PACK_SPECS };
  for (const base of [DG_ROOT, root]) {
    const wfDir = join(base, 'workflows');
    if (!existsSync(wfDir)) continue;
    try {
      for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.workflow.json'))) {
        const r = readJsonStrict(join(wfDir, f));
        if (r.ok && r.value && r.value.id && Array.isArray(r.value.nodes)) mergedPacks[r.value.id] = r.value;
      }
    } catch (err) { void err; }
  }
  const wbState = join(root, '.donegate', 'workbench-state.json');
  if (existsSync(wbState)) {
    const st = readJsonStrict(wbState);
    if (st.ok && st.value?.customPacks && typeof st.value.customPacks === 'object') {
      Object.assign(mergedPacks, st.value.customPacks);
    }
  }
  if (extraPacks && typeof extraPacks === 'object') Object.assign(mergedPacks, extraPacks);
  const reports = {};
  for (const [id, pk] of Object.entries(mergedPacks)) {
    if (pk && typeof pk === 'object') reports[id] = inspectWorkflowDeps(root, pk, opts);
  }
  return {
    refreshStamp: readSharedRefreshStamp(root),
    sharedPool: summarizeSharedPoolStatus(root, opts),
    reports
  };
}

function wfdFindNamedWorkflowPack(root, wfId, opts) {
  const wfJson = join(root, 'workflows', `${sanitizeId(wfId)}.workflow.json`);
  if (existsSync(wfJson)) {
    const parsed = readJsonStrict(wfJson);
    if (parsed.ok && parsed.value) return parsed.value;
  }
  const wbState = join(root, '.donegate', 'workbench-state.json');
  if (existsSync(wbState)) {
    const st = readJsonStrict(wbState);
    const customPack = st.ok && st.value?.customPacks?.[wfId];
    if (customPack) return customPack;
  }
  if ((opts.useCatalogSpec === true || wfId === 'uiboard') && BUILTIN_CATALOG_PACK_SPECS[wfId]) {
    return BUILTIN_CATALOG_PACK_SPECS[wfId];
  }
  return null;
}

function wfdBuildSyntheticDepItem(id, wfInstalled, sharedInstalled, diskTools) {
  const rec = wfInstalled[id] || sharedInstalled[id] || diskTools.find((t) => t.id === id) || {};
  const isLib = rec.kind === 'npm-lib' || (rec.pkg && !rec.bin);
  const rawBin = rec.bin || rec.canonicalRelBin || '';
  let binName = '';
  if (!isLib) {
    const binTail = rawBin ? normalizeSlashes(rawBin).replace(/\.(?:exe|cmd|bat|com|ps1|sh)$/i, '').split('/').pop() : id;
    binName = binTail || id;
  }
  return {
    id, title: rec.label || id, version: rec.version || '',
    kind: rec.kind || (isLib ? 'npm-lib' : 'archive-bin'),
    pkg: rec.pkg || '', bin: binName, repo: rec.repo || '', allowHostEnv: false
  };
}

export function readWorkflowDepsStatus(projectRoot, workflowOrPack = null, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  if (workflowOrPack && typeof workflowOrPack === 'object') {
    return inspectWorkflowDeps(root, workflowOrPack, opts);
  }
  const wfId = String(workflowOrPack || '_shared').trim() || '_shared';
  if (wfId !== '_shared') {
    const namedPack = wfdFindNamedWorkflowPack(root, wfId, opts);
    if (namedPack) return inspectWorkflowDeps(root, namedPack, opts);
  }
  const paths = getWorkflowDepsPaths(root, wfId, opts.platform);
  const shared = getSharedWorkflowDepsPaths(root, opts.platform);
  const wfInstalled = wfdLoadParsedManifest(paths.manifestPath).entriesById;
  const sharedInstalled = wfdLoadParsedManifest(shared.manifestPath).entriesById;
  const ignoreShared = opts.ignoreSharedPool === true;
  const disk = ignoreShared ? { tools: [] } : scanSharedPoolDiskInventory(root, opts.platform);
  const sharedIds = ignoreShared ? [] : [...Object.keys(sharedInstalled), ...disk.tools.map((t) => t.id)];
  const allIds = [...new Set([...Object.keys(wfInstalled), ...sharedIds])];
  if (allIds.length === 0 && BUILTIN_CATALOG_PACK_SPECS[wfId]) {
    return inspectWorkflowDeps(root, BUILTIN_CATALOG_PACK_SPECS[wfId], opts);
  }
  const syntheticDeps = allIds.map((id) => wfdBuildSyntheticDepItem(id, wfInstalled, sharedInstalled, disk.tools));
  return inspectWorkflowDeps(root, { id: wfId, name: wfId, deps: syntheticDeps, nodes: [] }, opts);
}

export function buildWorkflowDepEnv(projectRoot, packId, baseEnv = process.env, platform = process.platform) {
  const root = resolve(projectRoot);
  const paths = getWorkflowDepsPaths(root, packId, platform);
  const shared = getSharedWorkflowDepsPaths(root, platform);
  const extraBins = [
    paths.binDir, paths.npmBinDir, paths.venvBinDir,
    shared.binDir, shared.npmBinDir, shared.venvBinDir
  ].filter((d, idx, arr) => existsSync(d) && arr.indexOf(d) === idx);
  const pathSep = platform === 'win32' ? ';' : delimiter;
  const curPath = String(baseEnv.PATH ?? baseEnv.Path ?? baseEnv.path ?? '');
  const nextEnv = { ...baseEnv };
  delete nextEnv.Path;
  delete nextEnv.path;
  nextEnv.PATH = extraBins.length ? [...extraBins, curPath].filter(Boolean).join(pathSep) : curPath;
  nextEnv.DG_WORKFLOW_DEPS_DIR = paths.absDir;
  nextEnv.DG_SHARED_DEPS_DIR = shared.absDir;
  const sharedNodeMods = join(shared.absDir, 'npm', 'node_modules');
  if (existsSync(sharedNodeMods)) {
    nextEnv.NODE_PATH = nextEnv.NODE_PATH ? `${sharedNodeMods}${pathSep}${nextEnv.NODE_PATH}` : sharedNodeMods;
  }
  const hasGradle = existsSync(shared.gradleHomeDir) || Boolean(findExecutableInDirs('gradle', [paths.binDir, shared.binDir], platform));
  if (hasGradle) nextEnv.GRADLE_USER_HOME = resolvePoolGradleUserHome(root, baseEnv);
  return nextEnv;
}

function wfdSpawnNpmOnce(prefixDir, spec, cwd, platform, extraFlags = []) {
  const npmArgs = ['install', '--no-audit', '--no-fund', '--save-exact', ...extraFlags, '--prefix', prefixDir, spec];
  const cliCands = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  const npmCli = cliCands.find((p) => existsSync(p));
  if (npmCli) return spawnSync(process.execPath, [npmCli, ...npmArgs], { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (platform === 'win32') {
    const cmdLine = `"npm.cmd ${npmArgs.map((a) => `"${String(a).replace(/"/g, '')}"`).join(' ')}"`;
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], { cwd, encoding: 'utf8', timeout: 180000, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawnSync('npm', npmArgs, { cwd, encoding: 'utf8', timeout: 180000 });
}

export function runNpmPrefixInstall(prefixDir, spec, cwd, platform = process.platform) {
  if (!/^[a-zA-Z0-9@/._-]+$/.test(String(spec || ''))) return { status: 2, error: new Error('非法包名规格') };
  mkdirSync(prefixDir, { recursive: true });
  const pjPath = join(prefixDir, 'package.json');
  if (!existsSync(pjPath)) writeJsonAtomic(pjPath, { name: 'donegate-pool-cell', private: true });
  const first = wfdSpawnNpmOnce(prefixDir, spec, cwd, platform, []);
  if (first.status !== 0 && /ERESOLVE|peer dep/i.test(`${first.stderr || ''}\n${first.stdout || ''}`)) {
    return wfdSpawnNpmOnce(prefixDir, spec, cwd, platform, ['--legacy-peer-deps']);
  }
  return first;
}

function wfdReadJsonDocOrEmpty(filePath) {
  return existsSync(filePath) ? (readJsonStrict(filePath).value || {}) : {};
}

function wfdApplyMarkedInstalledIds(markInstalledIds, itemById, useShared, now, installed, sharedInstalled) {
  if (!Array.isArray(markInstalledIds)) return;
  for (const rawId of markInstalledIds) {
    const id = String(rawId);
    const it = itemById.get(id);
    const metaVer = normalizeDepVer(it?.version || '');
    const sharedRec = { id };
    if (it?.kind) sharedRec.kind = it.kind;
    if (it?.pkg) sharedRec.pkg = it.pkg;
    Object.assign(sharedRec, {
      ready: true, status: 'ready', version: metaVer, detectedVersion: metaVer, updatedAt: now, source: 'agent-verified'
    });
    installed[id] = useShared ? { ...sharedRec, sharedPool: true, sharedManifest: '../_shared/manifest.json' } : sharedRec;
    if (useShared) sharedInstalled[id] = sharedRec;
  }
}

function wfdRunMissingNpmInstalls(root, missing, targetNpmPrefix, useShared, now, installed, sharedInstalled) {
  for (const m of missing) {
    if ((!isNpmLibItem(m) && !isNpmCliItem(m)) || !m.pkg) continue;
    const isCli = isNpmCliItem(m);
    const cellId = isCli ? sanitizeId(m.id) : '';
    const prefix = (useShared && isCli) ? join(dirname(targetNpmPrefix), 'npm-cells', cellId) : targetNpmPrefix;
    const spec = m.version ? `${m.pkg}@${normalizeDepVer(m.version)}` : m.pkg;
    const r = runNpmPrefixInstall(prefix, spec, root);
    if (r.status !== 0) continue;
    if (useShared && isCli && m.bin) {
      writeSharedPoolLaunchers(root, { id: m.id, binName: m.bin, npmBin: true, npmCellId: cellId });
    }
    const cleanVer = normalizeDepVer(m.version);
    const sharedRec = {
      id: m.id, kind: m.kind, pkg: m.pkg, ready: true, status: 'ready',
      version: cleanVer, detectedVersion: cleanVer, updatedAt: now,
      source: useShared ? 'shared-npm-prefix' : 'npm-prefix'
    };
    installed[m.id] = useShared ? { ...sharedRec, sharedPool: true, sharedManifest: '../_shared/manifest.json' } : sharedRec;
    if (useShared) sharedInstalled[m.id] = sharedRec;
  }
}

export function provisionWorkflowDeps(projectRoot, pack, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  const packId = (pack && pack.id) || 'default';
  const packName = (pack && pack.name) || packId;
  const paths = getWorkflowDepsPaths(root, packId);
  const shared = getSharedWorkflowDepsPaths(root);
  const useShared = opts.isolatedOnly !== true;
  const inspectOpts = opts.env ? { env: opts.env } : {};

  for (const d of [paths.binDir, paths.distsDir, join(paths.absDir, 'npm'), paths.reposDir]) {
    mkdirSync(d, { recursive: true });
  }
  const before = inspectWorkflowDeps(root, pack, inspectOpts);
  let cliRelPath = 'workflows/.deps/_shared/dg-deps-cli.mjs';
  if (useShared) {
    const needGradle = before.items.some((x) => x.id === 'gradle' || x.bin === 'gradle');
    cliRelPath = ensureSharedPoolSkeleton(root, { includeGradleHome: needGradle }).cliRelPath;
  }

  const curWfParsed = parseFlexibleDepsManifest(wfdReadJsonDocOrEmpty(paths.manifestPath));
  const installed = { ...curWfParsed.entriesById };
  const curSharedDoc = useShared ? wfdReadJsonDocOrEmpty(shared.manifestPath) : {};
  const curSharedParsed = parseFlexibleDepsManifest(curSharedDoc);
  const sharedInstalled = { ...curSharedParsed.entriesById };
  const itemById = new Map(before.items.map((x) => [x.id, x]));
  const now = new Date().toISOString();

  wfdApplyMarkedInstalledIds(opts.markInstalledIds, itemById, useShared, now, installed, sharedInstalled);
  if (opts.runNpm === true) {
    const targetNpmPrefix = useShared ? join(shared.absDir, 'npm') : join(paths.absDir, 'npm');
    wfdRunMissingNpmInstalls(root, before.missing, targetNpmPrefix, useShared, now, installed, sharedInstalled);
  }

  const wfLabel = curWfParsed.topLabel || packName;
  writeJsonAtomic(paths.planPath, {
    packId, packName, depsDir: paths.relDir, sharedDepsDir: shared.relDir, cliHelper: cliRelPath,
    generatedAt: now, items: before.items, agentPrompt: before.agentPrompt
  });
  writeJsonAtomic(paths.manifestPath, { packId, label: wfLabel, updatedAt: now, installed });
  let refreshStamp = null;
  if (useShared) {
    const sharedLabel = curSharedParsed.topLabel ? { label: curSharedParsed.topLabel } : {};
    writeJsonAtomic(shared.manifestPath, { packId: '_shared', ...sharedLabel, updatedAt: now, installed: sharedInstalled });
    refreshStamp = refreshWorkflowDepsStamp(root, { trigger: 'provision', workflowId: packId });
  }
  const after = inspectWorkflowDeps(root, pack, inspectOpts);
  return {
    ok: true, ...after, cliHelper: cliRelPath, refreshStamp: refreshStamp || after.refreshStamp,
    planFile: `${paths.relDir}/PROVISION-PLAN.json`,
    manifestFile: `${paths.relDir}/manifest.json`,
    sharedManifestFile: `${shared.relDir}/manifest.json`
  };
}

function wfdPullCliArg(argv, flag, fb = null) {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fb;
}

function wfdCliMarkReady(argv, root, workflowId) {
  const pull = (flag, fb = null) => wfdPullCliArg(argv, flag, fb);
  const id = pull('--id', null);
  if (!id) return { exitCode: 3, payload: { ok: false, error: 'mark-ready requires --id <depId>' } };
  const binName = pull('--bin-name', id);
  const kind = pull('--kind', '');
  const baseSpec = {
    id, label: pull('--label', ''), workflowLabel: pull('--workflow-label', ''), kind, pkg: pull('--pkg', ''),
    binName, workflowId, version: pull('--version', ''), detectedVersion: pull('--detected-version', undefined),
    pending: argv.includes('--pending'), tag: pull('--tag', ''), commit: pull('--commit', ''),
    repo: pull('--repo', ''), bin: pull('--bin', ''), distSubdir: pull('--dist', ''), trigger: 'cli-mark-ready'
  };
  if (argv.includes('--run-verify') && kind !== 'npm-lib') {
    const ver = verifySharedPoolLauncher(root, { id, binName });
    if (!ver.ok) return { exitCode: 1, payload: { ok: false, stage: 'verify', verification: ver } };
    const out = recordSharedPoolDepReady(root, {
      ...baseSpec,
      verified: { command: ver.command, output: ver.output, status: 'pass' }
    });
    return { exitCode: 0, payload: out };
  }
  const out = recordSharedPoolDepReady(root, {
    ...baseSpec,
    verifyCommand: pull('--verify-cmd', ''),
    verifyOutput: pull('--verify-output', 'pass')
  });
  return { exitCode: 0, payload: out };
}

function wfdCliWriteLaunchers(argv, root) {
  const pull = (flag, fb = null) => wfdPullCliArg(argv, flag, fb);
  const binName = pull('--bin', pull('--id', ''));
  const distSubdir = pull('--dist', '');
  const npmBin = argv.includes('--npm-bin') || pull('--kind', '') === 'npm-cli';
  if (!binName || (!distSubdir && !npmBin)) {
    return { exitCode: 3, payload: { ok: false, error: 'write-launchers requires --bin and (--dist or --npm-bin)' } };
  }
  const out = writeSharedPoolLaunchers(root, {
    binName, distSubdir, npmBin,
    posixEntryRel: pull('--posix-entry', null),
    winEntryRel: pull('--win-entry', null),
    comment: pull('--comment', '')
  });
  return { exitCode: 0, payload: out };
}

export function runWorkflowDepsCli(argv = process.argv.slice(2), defaultRoot = process.cwd()) {
  const cmd = String(argv[0] || 'status').trim();
  const pull = (flag, fb = null) => wfdPullCliArg(argv, flag, fb);
  const root = resolve(pull('--project', pull('--root', defaultRoot)));
  const workflowId = pull('--workflow', pull('--pack', null));

  if (cmd === 'mark-ready') return wfdCliMarkReady(argv, root, workflowId);
  if (cmd === 'verify-npm') {
    const pkg = pull('--pkg', pull('--id', ''));
    if (!pkg) return { exitCode: 3, payload: { ok: false, error: 'verify-npm requires --pkg' } };
    const res = verifyInstalledNpmPackage(root, pkg, workflowId);
    const want = normalizeDepVer(pull('--version', ''));
    const ok = res.ok && (!want || res.version === want);
    return { exitCode: ok ? 0 : 1, payload: { ...res, ok } };
  }
  if (cmd === 'refresh') {
    const rec = reconcileSharedPoolOnRefresh(root, workflowId, { trigger: 'cli-refresh' });
    const status = readWorkflowDepsStatus(root, workflowId);
    return { exitCode: 0, payload: { ok: true, refreshStamp: rec.refreshStamp, status } };
  }
  if (cmd === 'write-launchers') return wfdCliWriteLaunchers(argv, root);
  if (cmd === 'repair-git') {
    const repoArg = pull('--repo', '');
    if (!repoArg) return { exitCode: 3, payload: { ok: false, error: 'repair-git requires --repo' } };
    const out = repairGitRepoCleanIndex(resolve(root, repoArg));
    return { exitCode: out.ok ? 0 : 1, payload: out };
  }
  if (cmd === 'status') {
    const status = readWorkflowDepsStatus(root, workflowId);
    return { exitCode: 0, payload: { ok: true, status, refreshStamp: status.refreshStamp } };
  }
  return { exitCode: 3, payload: { ok: false, error: `Unknown subcommand: ${cmd}` } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv[0] === 'download') {
      const root = resolve(wfdPullCliArg(argv, '--project', wfdPullCliArg(argv, '--root', process.cwd())));
      const url = wfdPullCliArg(argv, '--url', '');
      const dest = wfdPullCliArg(argv, '--dest', wfdPullCliArg(argv, '--out', ''));
      if (!url || !dest) {
        console.error(JSON.stringify({ ok: false, error: 'download requires --url and --dest' }));
        process.exit(3);
      }
      downloadWithRangeResume(url, resolve(root, dest), { expectedSha256: wfdPullCliArg(argv, '--sha256', '') }).then((out) => {
        console.log(JSON.stringify(out, null, 2));
        process.exit(0);
      }).catch((err) => {
        console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
        process.exit(1);
      });
    } else {
      const { exitCode, payload } = runWorkflowDepsCli(argv);
      console.log(JSON.stringify(payload, null, 2));
      process.exit(exitCode);
    }
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
    process.exit(1);
  }
}
