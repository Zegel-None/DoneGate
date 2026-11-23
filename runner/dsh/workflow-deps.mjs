#!/usr/bin/env node
// 工作流类 ComfyUI 依赖探针、跨工作流共享底座池 (workflows/.deps/_shared/)、免 401 CLI 刷新与补齐工单生成器
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';
import {
  DEFAULT_RANGE_CHUNK_BYTES, buildWinHardenedGitArgs, cleanStaleGitIndexLock,
  downloadWithRangeResume, provisionCleanRepoSnapshot, repairGitRepoCleanIndex
} from './shared-pool-net.mjs';
import {
  assertPureAsciiBatch, buildSharedPoolLauncherScripts, ensureSharedPoolSkeleton,
  installSharedPoolBinaryDep, isWritableDir, readSharedRefreshStamp, recordSharedPoolDepReady,
  refreshWorkflowDepsStamp, resolvePoolGradleUserHome, verifySharedPoolLauncher,
  writeJsonAtomic, writeSharedPoolLaunchers
} from './shared-pool-installer.mjs';

export {
  DEFAULT_RANGE_CHUNK_BYTES, assertPureAsciiBatch, buildSharedPoolLauncherScripts,
  buildWinHardenedGitArgs, cleanStaleGitIndexLock, downloadWithRangeResume,
  ensureSharedPoolSkeleton, installSharedPoolBinaryDep, isWritableDir,
  provisionCleanRepoSnapshot, readSharedRefreshStamp, recordSharedPoolDepReady,
  refreshWorkflowDepsStamp, repairGitRepoCleanIndex, resolvePoolGradleUserHome,
  verifySharedPoolLauncher, writeJsonAtomic, writeSharedPoolLaunchers
};

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILTIN_ZERO_DEP_TPLS = new Set([
  'tpl-blank', 'tpl-router-rule', 'tpl-router-ai', 'tpl-deai-polish', 'tpl-prompt-gen', 'tpl-anti-slop', 'tpl-human-gate'
]);
const KNOWN_TEMPLATE_BINS = {
  'tpl-openspec': { id: 'openspec', bin: 'openspec', repo: 'Fission-AI/OpenSpec', kind: 'npm', pkg: '@fission-ai/openspec' },
  'tpl-biome-knip': { id: 'biome', bin: 'biome', repo: 'biomejs/biome', kind: 'npm', pkg: '@biomejs/biome' },
  'tpl-gradle': { id: 'gradle', bin: 'gradle', repo: 'gradle/gradle', kind: 'binary' },
  'tpl-maestro': { id: 'maestro', bin: 'maestro', repo: 'mobile-dev-inc/Maestro', kind: 'binary' },
  'tpl-playwright': { id: 'playwright', bin: 'playwright', repo: 'microsoft/playwright', kind: 'npm', pkg: '@playwright/test' },
  'tpl-gitleaks': { id: 'gitleaks', bin: 'gitleaks', repo: 'gitleaks/gitleaks', kind: 'binary' }
};

const sanitizeId = (s) => String(s || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'default';
const normalizeDepVer = (v) => String(v || '').trim().replace(/^v/i, '');
const versionsMatch = (want, have) => {
  const w = normalizeDepVer(want), h = normalizeDepVer(have);
  return !w || !h || w === h;
};

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
  } catch {
    return false;
  }
}

function findInstalledNpmPkg(absDepsDir, pkgName) {
  if (!absDepsDir || !pkgName) return null;
  const segs = String(pkgName).split('/').filter(Boolean);
  for (const base of [join(absDepsDir, 'npm', 'node_modules'), join(absDepsDir, 'node_modules')]) {
    const pkgJson = join(base, ...segs, 'package.json');
    if (existsSync(pkgJson)) return pkgJson;
  }
  return null;
}

function readBrickMeta(projectRoot, toolName) {
  if (!toolName) return null;
  const localCap = join(resolve(projectRoot), 'bricks', toolName, 'capabilities.json');
  const capPath = existsSync(localCap) ? localCap : join(DG_ROOT, 'bricks', toolName, 'capabilities.json');
  if (!existsSync(capPath)) return null;
  const r = readJsonStrict(capPath);
  return r.ok && r.value ? r.value : null;
}

export function resolveWorkflowDepItems(projectRoot, pack) {
  if (!pack || typeof pack !== 'object') return [];
  const root = resolve(projectRoot || process.cwd());
  const byId = new Map();
  const addDep = (raw, nodeId = null) => {
    if (!raw || typeof raw !== 'object') return;
    const id = String(raw.id || raw.tool || raw.bin || '').trim();
    if (!id) return;
    if (byId.has(id)) {
      if (nodeId && !byId.get(id).nodeIds.includes(nodeId)) byId.get(id).nodeIds.push(nodeId);
      return;
    }
    const repo = String(raw.repo || raw.repoSlug || '').trim();
    byId.set(id, {
      id, title: String(raw.title || id), nodeIds: nodeId ? [nodeId] : [],
      repo, repoUrl: String(raw.repoUrl || (repo ? `https://github.com/${repo}` : '')),
      version: String(raw.version || raw.pinnedVersion || '').trim(),
      kind: String(raw.kind || 'git'), bin: String(raw.bin || '').trim(),
      pkg: String(raw.pkg || raw.package || '').trim(),
      installCmd: String(raw.installCmd || '').trim(),
      allowHostEnv: raw.allowHostEnv !== false
    });
  };
  if (Array.isArray(pack.deps)) for (const d of pack.deps) addDep(d, null);
  for (const nd of (Array.isArray(pack.nodes) ? pack.nodes : [])) {
    if (!nd || nd.bypassed || nd.isBlank || nd.isBoundary) continue;
    if (nd.isSubgraph && nd.subgraph && Array.isArray(nd.subgraph.nodes)) {
      for (const sub of resolveWorkflowDepItems(root, nd.subgraph)) addDep(sub, nd.id);
      continue;
    }
    if (BUILTIN_ZERO_DEP_TPLS.has(nd.tplId) && !nd.installSpec && !Array.isArray(nd.deps)) continue;
    if (Array.isArray(nd.deps)) { for (const d of nd.deps) addDep(d, nd.id); continue; }
    if (nd.installSpec && typeof nd.installSpec === 'object') {
      addDep({ id: nd.installSpec.id || nd.id, title: nd.title, repoSlug: nd.repoSlug, pinnedVersion: nd.pinnedVersion, ...nd.installSpec }, nd.id);
      continue;
    }
    const known = KNOWN_TEMPLATE_BINS[nd.tplId];
    if (known) { addDep({ ...known, title: nd.title || known.id, version: nd.pinnedVersion || '' }, nd.id); continue; }
    const adpMatch = typeof nd.tplId === 'string' ? nd.tplId.match(/^tpl-adp-(.+)$/) : null;
    const toolName = nd.tool || (adpMatch ? adpMatch[1] : '');
    if (toolName) {
      const cap = readBrickMeta(root, toolName);
      if (cap && (cap.archetype === 'knowledge-skill' || cap.archetype === 'aggregator') && !cap.install) continue;
      const inst = (cap && cap.install && typeof cap.install === 'object') ? cap.install : {};
      const up = (cap && cap.upstream && typeof cap.upstream === 'object') ? cap.upstream : {};
      addDep({
        id: toolName, title: nd.title || (cap && cap.card && cap.card.title) || toolName,
        repo: inst.repo || up.repo || nd.repoSlug || '', version: inst.version || nd.pinnedVersion || '',
        kind: inst.kind || 'binary', bin: inst.bin !== undefined ? inst.bin : toolName,
        pkg: inst.pkg || inst.package || '', installCmd: inst.installCmd || '',
        allowHostEnv: inst.allowHostEnv !== false
      }, nd.id);
      continue;
    }
    if (nd.requiresDep === true || (nd.repoSlug && nd.requiresDep !== false)) {
      const slugId = (nd.repoSlug ? nd.repoSlug.split('/').pop() : nd.id).toLowerCase();
      addDep({ id: slugId, title: nd.title || slugId, repo: nd.repoSlug || '', repoUrl: nd.repoUrl || '', version: nd.pinnedVersion || '', kind: 'git', bin: nd.bin || '' }, nd.id);
    }
  }
  return [...byId.values()];
}

export function buildProvisionAgentPrompt(pack, relDepsDir, sharedRelDir, missing) {
  const packId = sanitizeId((pack && pack.id) || 'default');
  const name = (pack && pack.name) || packId || '当前工作流';
  if (!missing.length) {
    return `工作流「${name}」所需的外部项目与环境依赖已全部就位（共享池：${sharedRelDir}，工作流目录：${relDepsDir}）。`;
  }
  const lines = [
    `请为工作流「${name}」在后台补齐以下 ${missing.length} 项开源项目与运行环境依赖，统一装入跨工作流共享底座池 \`${sharedRelDir}/\`（自动递归创建 \`${sharedRelDir}/{.bin,dists,repos}\` 骨架，一次安装供所有工作流与节点级 JIT 派生工作流复用）：`
  ];
  for (const m of missing) {
    const ver = m.version ? ` (${m.version})` : '';
    const src = m.repoUrl ? ` · ${m.repoUrl}` : '';
    const hint = m.installCmd ? `执行 \`${m.installCmd}\``
      : (m.kind === 'npm' && m.pkg ? `执行 \`npm install --prefix ${sharedRelDir}/npm ${m.pkg}${m.version ? '@' + normalizeDepVer(m.version) : ''}\``
        : (m.repoUrl ? `落盘至 \`${sharedRelDir}/repos/${m.id}\` 并生成 \`${sharedRelDir}/.bin\` 启动器` : `补齐可执行工具 \`${m.bin || m.id}\``));
    lines.push(`- **${m.title}** (\`${m.id}\`${ver})${src} → ${hint}`);
  }
  const sample = missing[0];
  const sampleBin = sample.bin || sample.id;
  const sampleVer = normalizeDepVer(sample.version) || 'latest';
  lines.push(
    '',
    '### Windows 11 共享池防坑硬规约（必读）',
    '1. **禁用原生 curl/Invoke-WebRequest，规避 Schannel 与脏 Git 索引**：Windows Schannel 易报 `SEC_E_NO_CREDENTIALS` 且大仓完整 clone 易断连残留 24000+ 条 `D ` 脏记录与 `.git/index.lock`。Git 命令统一加 `-c core.longpaths=true -c http.sslBackend=openssl`（有代理时显式加 `-c http.proxy=... -c https.proxy=...`）；优先用 Node `fetch` 下载 GitHub/codeload tag tarball 解压，随后执行 `node runner/dsh/workflow-deps.mjs repair-git --repo ' + `${sharedRelDir}/repos/${sample.id}` + '` 清理陈旧 `index.lock` 并执行 `read-tree --reset HEAD` / `add -A` 确保零 `D ` 脏记录。',
    '2. **大体积压缩包 1 MiB HTTP Range 分块断点续传**：下载大体积发行包（如 Gradle zip）须使用 `runner/dsh/workflow-deps.mjs` 导出的 `downloadWithRangeResume`（默认 `1 MiB = 1048576` 字节 `Range` 分块、支持 302/307 跳转、`.part` 断点续传、单块最多 8 次指数退避重试、字节长度与 SHA-256 校验通过后原子重命名）。',
    '3. **纯 ASCII 启动器与池内可写沙盒目录**：执行 `node runner/dsh/workflow-deps.mjs write-launchers --project . --bin ' + sampleBin + ' --dist <dist-dir>` 生成三入口启动器；`.bat`/`.cmd` 强制 100% 纯 ASCII（`/^[\x00-\x7F]*$/`）+ CRLF 换行，严禁在 `rem` 注释混入中文（防 `cmd.exe` GBK 解码报 `-pool` 错误），统一用 `%~dp0` 相对解析 `..\\dists\\<dist-dir>`；Gradle 类工具自动将 `GRADLE_USER_HOME` 指向池内可写 `' + `${sharedRelDir}/.gradle-home` + '`（避开不可写的 `~/.gradle` 与 `native-platform.dll` 初始化失败）。',
    '4. **双层 `manifest.json` 落盘与免 401 本地 CLI 刷新**：严禁直接请求 `http://127.0.0.1:3200/`（会撞 `401 Unauthorized`）。完成 `--version` 自检后，直接运行免鉴权本地命令：`node runner/dsh/workflow-deps.mjs mark-ready --project . --workflow ' + packId + ' --id ' + sample.id + ' --version ' + sampleVer + ' --bin ' + `${sharedRelDir}/.bin/${sampleBin}` + '`（或 `node runner/dsh/workflow-deps.mjs refresh --project . --workflow ' + packId + '`），自动原子写入 `' + `${sharedRelDir}/manifest.json` + '` 与 `' + `${relDepsDir}/manifest.json` + '`（`ready: true`）并更新 `.refresh-stamp.json` 触发工作台状态同步。'
  );
  return lines.join('\n');
}

function isManifestRecValid(rec, sharedRec, root, ignoreSharedPool) {
  if (!rec || rec.ready !== true) return false;
  if (rec.verifyPath && !existsSync(resolve(root, rec.verifyPath))) return false;
  if (rec.sharedPool === true) {
    if (ignoreSharedPool) return false;
    if (sharedRec && sharedRec.ready === false) return false;
    if (sharedRec && sharedRec.verifyPath && !existsSync(resolve(root, sharedRec.verifyPath))) return false;
  }
  return true;
}

export function inspectWorkflowDeps(projectRoot, pack, opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const root = resolve(projectRoot || process.cwd());
  const packId = (pack && pack.id) || 'default';
  const paths = getWorkflowDepsPaths(root, packId, platform);
  const shared = getSharedWorkflowDepsPaths(root, platform);

  const manifestRes = existsSync(paths.manifestPath) ? readJsonStrict(paths.manifestPath) : { ok: false };
  const installedMap = (manifestRes.ok && manifestRes.value && manifestRes.value.installed) || {};
  const sharedManifestRes = existsSync(shared.manifestPath) ? readJsonStrict(shared.manifestPath) : { ok: false };
  const sharedInstalledMap = (sharedManifestRes.ok && sharedManifestRes.value && sharedManifestRes.value.installed) || {};
  const refreshStamp = readSharedRefreshStamp(root);

  const localBins = [paths.binDir, paths.npmBinDir, paths.venvBinDir];
  const sharedBins = [shared.binDir, shared.npmBinDir, shared.venvBinDir];
  const pathSep = platform === 'win32' ? ';' : delimiter;
  const rawPath = String(env.PATH ?? env.Path ?? env.path ?? '');
  const hostBins = [join(root, 'node_modules', '.bin'), join(DG_ROOT, 'node_modules', '.bin'), ...rawPath.split(pathSep).filter(Boolean)];

  const items = resolveWorkflowDepItems(root, pack).map((it) => {
    const rec = installedMap[it.id];
    const sharedRec = sharedInstalledMap[it.id];
    const repoCloneDir = join(paths.reposDir, sanitizeId(it.id));
    const sharedRepoDir = join(shared.reposDir, sanitizeId(it.id));
    let resolvedVia = null;
    let resolvedPath = null;
    if (isManifestRecValid(rec, sharedRec, root, opts.ignoreSharedPool === true) && versionsMatch(it.version, rec.version || sharedRec?.version)) {
      resolvedVia = rec.sharedPool ? 'workflow-shared-manifest' : 'workflow-manifest';
      resolvedPath = rec.verifyPath || rec.bin || sharedRec?.bin || (rec.sharedPool ? shared.relDir : paths.relDir);
    } else if (opts.ignoreSharedPool !== true && isManifestRecValid(sharedRec, null, root, false) && versionsMatch(it.version, sharedRec.version)) {
      resolvedVia = 'shared-manifest';
      resolvedPath = sharedRec.verifyPath || sharedRec.bin || shared.relDir;
    } else if (it.bin) {
      const inWf = findExecutableInDirs(it.bin, localBins, platform);
      const inShared = opts.ignoreSharedPool === true ? null : findExecutableInDirs(it.bin, sharedBins, platform);
      if (inWf) { resolvedVia = 'workflow-deps'; resolvedPath = normalizeSlashes(inWf); }
      else if (inShared) { resolvedVia = 'shared-deps'; resolvedPath = normalizeSlashes(inShared); }
      else if (it.allowHostEnv) {
        const inHost = findExecutableInDirs(it.bin, hostBins, platform);
        if (inHost) { resolvedVia = 'host-env'; resolvedPath = normalizeSlashes(inHost); }
      }
    }
    if (!resolvedVia && !it.bin && it.kind === 'npm' && it.pkg) {
      const inWfNpm = findInstalledNpmPkg(paths.absDir, it.pkg);
      const inSharedNpm = opts.ignoreSharedPool === true ? null : findInstalledNpmPkg(shared.absDir, it.pkg);
      if (inWfNpm) { resolvedVia = 'workflow-npm'; resolvedPath = normalizeSlashes(inWfNpm); }
      else if (inSharedNpm) { resolvedVia = 'shared-npm'; resolvedPath = normalizeSlashes(inSharedNpm); }
    }
    if (!resolvedVia && !it.bin) {
      if (isNonEmptyRepoDir(repoCloneDir)) { resolvedVia = 'workflow-repo'; resolvedPath = normalizeSlashes(repoCloneDir); }
      else if (opts.ignoreSharedPool !== true && isNonEmptyRepoDir(sharedRepoDir)) { resolvedVia = 'shared-repo'; resolvedPath = normalizeSlashes(sharedRepoDir); }
    }
    return { ...it, ready: Boolean(resolvedVia), resolvedVia, resolvedPath };
  });

  const missing = items.filter((x) => !x.ready);
  return {
    packId, packName: (pack && pack.name) || packId, depsDir: paths.relDir, sharedDepsDir: shared.relDir,
    ready: missing.length === 0, total: items.length, readyCount: items.length - missing.length,
    missingCount: missing.length, items, missing, refreshStamp,
    agentPrompt: buildProvisionAgentPrompt(pack, paths.relDir, shared.relDir, missing)
  };
}

export function readWorkflowDepsStatus(projectRoot, workflowOrPack = null, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  if (workflowOrPack && typeof workflowOrPack === 'object') {
    return inspectWorkflowDeps(root, workflowOrPack, opts);
  }
  const wfId = String(workflowOrPack || '_shared').trim() || '_shared';
  if (wfId !== '_shared') {
    const wfJson = join(root, 'workflows', `${sanitizeId(wfId)}.workflow.json`);
    if (existsSync(wfJson)) {
      const parsed = readJsonStrict(wfJson);
      if (parsed.ok && parsed.value) return inspectWorkflowDeps(root, parsed.value, opts);
    }
    const wbState = join(root, '.donegate', 'workbench-state.json');
    if (existsSync(wbState)) {
      const st = readJsonStrict(wbState);
      const customPack = st.ok && st.value?.customPacks?.[wfId];
      if (customPack) return inspectWorkflowDeps(root, customPack, opts);
    }
  }
  const paths = getWorkflowDepsPaths(root, wfId, opts.platform);
  const shared = getSharedWorkflowDepsPaths(root, opts.platform);
  const wfInstalled = (existsSync(paths.manifestPath) && readJsonStrict(paths.manifestPath).value?.installed) || {};
  const sharedInstalled = (existsSync(shared.manifestPath) && readJsonStrict(shared.manifestPath).value?.installed) || {};
  const allIds = [...new Set([...Object.keys(wfInstalled), ...(opts.ignoreSharedPool === true ? [] : Object.keys(sharedInstalled))])];
  const syntheticDeps = allIds.map((id) => {
    const rec = wfInstalled[id] || sharedInstalled[id] || {};
    return { id, title: id, version: rec.version || '', bin: rec.bin ? String(rec.bin).split('/').pop() : id, kind: 'binary', allowHostEnv: false };
  });
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
  const hasGradle = existsSync(shared.gradleHomeDir) || Boolean(findExecutableInDirs('gradle', [paths.binDir, shared.binDir], platform));
  if (hasGradle) nextEnv.GRADLE_USER_HOME = resolvePoolGradleUserHome(root, baseEnv);
  return nextEnv;
}

export function runNpmPrefixInstall(prefixDir, spec, cwd, platform = process.platform) {
  if (!/^[a-zA-Z0-9@/._-]+$/.test(String(spec || ''))) return { status: 2, error: new Error('非法包名规格') };
  const npmArgs = ['install', '--no-audit', '--no-fund', '--prefix', prefixDir, spec];
  const cliCands = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  const npmCli = cliCands.find((p) => existsSync(p));
  if (npmCli) return spawnSync(process.execPath, [npmCli, ...npmArgs], { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
  if (platform === 'win32') {
    const cmdLine = `"npm.cmd install --no-audit --no-fund --prefix "${String(prefixDir).replace(/"/g, '')}" "${spec}""`;
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], { cwd, encoding: 'utf8', timeout: 180000, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawnSync('npm', npmArgs, { cwd, encoding: 'utf8', timeout: 180000 });
}

export function provisionWorkflowDeps(projectRoot, pack, opts = {}) {
  const root = resolve(projectRoot || process.cwd());
  const packId = (pack && pack.id) || 'default';
  const paths = getWorkflowDepsPaths(root, packId);
  const shared = getSharedWorkflowDepsPaths(root);
  const useShared = opts.isolatedOnly !== true;

  for (const d of [paths.binDir, paths.distsDir, join(paths.absDir, 'npm'), paths.reposDir]) mkdirSync(d, { recursive: true });
  const before = inspectWorkflowDeps(root, pack, opts.env ? { env: opts.env } : {});
  if (useShared) {
    ensureSharedPoolSkeleton(root, { includeGradleHome: before.items.some((x) => x.id === 'gradle' || x.bin === 'gradle') });
  }

  const curManifest = existsSync(paths.manifestPath) ? (readJsonStrict(paths.manifestPath).value || {}) : {};
  const installed = { ...(curManifest.installed || {}) };
  const curShared = (useShared && existsSync(shared.manifestPath)) ? (readJsonStrict(shared.manifestPath).value || {}) : {};
  const sharedInstalled = { ...(curShared.installed || {}) };
  const itemById = new Map(before.items.map((x) => [x.id, x]));
  const now = new Date().toISOString();

  if (Array.isArray(opts.markInstalledIds)) {
    for (const rawId of opts.markInstalledIds) {
      const id = String(rawId);
      const metaVer = normalizeDepVer(itemById.get(id)?.version || '');
      const sharedRec = { id, ready: true, version: metaVer, updatedAt: now, source: 'agent-verified' };
      installed[id] = useShared ? { ...sharedRec, sharedPool: true, sharedManifest: '../_shared/manifest.json' } : sharedRec;
      if (useShared) sharedInstalled[id] = sharedRec;
    }
  }
  if (opts.runNpm === true) {
    const targetNpmPrefix = useShared ? join(shared.absDir, 'npm') : join(paths.absDir, 'npm');
    for (const m of before.missing) {
      if (m.kind === 'npm' && m.pkg) {
        const spec = m.version ? `${m.pkg}@${normalizeDepVer(m.version)}` : m.pkg;
        const r = runNpmPrefixInstall(targetNpmPrefix, spec, root);
        if (r.status === 0) {
          const sharedRec = { id: m.id, ready: true, version: normalizeDepVer(m.version), updatedAt: now, source: useShared ? 'shared-npm-prefix' : 'npm-prefix' };
          installed[m.id] = useShared ? { ...sharedRec, sharedPool: true, sharedManifest: '../_shared/manifest.json' } : sharedRec;
          if (useShared) sharedInstalled[m.id] = sharedRec;
        }
      }
    }
  }

  writeJsonAtomic(paths.planPath, { packId, packName: (pack && pack.name) || packId, depsDir: paths.relDir, sharedDepsDir: shared.relDir, generatedAt: now, items: before.items, agentPrompt: before.agentPrompt });
  writeJsonAtomic(paths.manifestPath, { packId, updatedAt: now, installed });
  let refreshStamp = null;
  if (useShared) {
    writeJsonAtomic(shared.manifestPath, { packId: '_shared', updatedAt: now, installed: sharedInstalled });
    refreshStamp = refreshWorkflowDepsStamp(root, { trigger: 'provision', workflowId: packId });
  }
  const after = inspectWorkflowDeps(root, pack, opts.env ? { env: opts.env } : {});
  return { ok: true, ...after, refreshStamp: refreshStamp || after.refreshStamp, planFile: `${paths.relDir}/PROVISION-PLAN.json`, manifestFile: `${paths.relDir}/manifest.json`, sharedManifestFile: `${shared.relDir}/manifest.json` };
}

export function runWorkflowDepsCli(argv = process.argv.slice(2), defaultRoot = process.cwd()) {
  const cmd = String(argv[0] || 'status').trim();
  const pull = (flag, fb = null) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb;
  };
  const root = resolve(pull('--project', pull('--root', defaultRoot)));
  const workflowId = pull('--workflow', pull('--pack', null));

  if (cmd === 'mark-ready') {
    const id = pull('--id', null);
    if (!id) return { exitCode: 3, payload: { ok: false, error: 'mark-ready requires --id <depId>' } };
    const binName = pull('--bin-name', id);
    if (argv.includes('--run-verify')) {
      const ver = verifySharedPoolLauncher(root, { id, binName });
      if (!ver.ok) return { exitCode: 1, payload: { ok: false, stage: 'verify', verification: ver } };
      const out = recordSharedPoolDepReady(root, {
        id, binName, workflowId, version: pull('--version', ''), tag: pull('--tag', ''),
        commit: pull('--commit', ''), repo: pull('--repo', ''), bin: pull('--bin', ''),
        distSubdir: pull('--dist', ''), verified: { command: ver.command, output: ver.output, status: 'pass' }, trigger: 'cli-mark-ready'
      });
      return { exitCode: 0, payload: out };
    }
    const out = recordSharedPoolDepReady(root, {
      id, binName, workflowId, version: pull('--version', ''), tag: pull('--tag', ''),
      commit: pull('--commit', ''), repo: pull('--repo', ''), bin: pull('--bin', ''),
      distSubdir: pull('--dist', ''), verifyCommand: pull('--verify-cmd', ''), verifyOutput: pull('--verify-output', 'pass'), trigger: 'cli-mark-ready'
    });
    return { exitCode: 0, payload: out };
  }
  if (cmd === 'refresh') {
    const refreshStamp = refreshWorkflowDepsStamp(root, { trigger: 'cli-refresh', workflowId });
    const status = readWorkflowDepsStatus(root, workflowId);
    return { exitCode: 0, payload: { ok: true, refreshStamp, status } };
  }
  if (cmd === 'write-launchers') {
    const binName = pull('--bin', pull('--id', ''));
    const distSubdir = pull('--dist', '');
    const out = writeSharedPoolLaunchers(root, {
      binName, distSubdir, posixEntryRel: pull('--posix-entry', null),
      winEntryRel: pull('--win-entry', null), comment: pull('--comment', '')
    });
    return { exitCode: 0, payload: out };
  }
  if (cmd === 'repair-git') {
    const repoDir = resolve(root, pull('--repo', '.'));
    const out = repairGitRepoCleanIndex(repoDir);
    return { exitCode: out.ok ? 0 : 1, payload: out };
  }
  const status = readWorkflowDepsStatus(root, workflowId);
  return { exitCode: 0, payload: { ok: true, status, refreshStamp: status.refreshStamp } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { exitCode, payload } = runWorkflowDepsCli(process.argv.slice(2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(exitCode);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
    process.exit(1);
  }
}
