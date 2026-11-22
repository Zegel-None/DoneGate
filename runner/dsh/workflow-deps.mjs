// 开发流类 ComfyUI 依赖探针、跨开发流共享底座池 (workflows/.deps/_shared/) 与按需补齐工单生成器
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';
import { normalizeSlashes } from './win-paths.mjs';

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

export function getWorkflowDepsPaths(projectRoot, packId, platform = process.platform) {
  const root = resolve(projectRoot);
  const safeId = sanitizeId(packId);
  const relDir = `workflows/.deps/${safeId}`;
  const absDir = join(root, 'workflows', '.deps', safeId);
  return {
    safeId, relDir, absDir,
    manifestPath: join(absDir, 'manifest.json'),
    planPath: join(absDir, 'PROVISION-PLAN.json'),
    binDir: join(absDir, '.bin'),
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

function buildProvisionAgentPrompt(pack, relDepsDir, sharedRelDir, missing) {
  const name = (pack && pack.name) || (pack && pack.id) || '当前开发流';
  if (!missing.length) return `开发流「${name}」所需的外部项目与环境依赖已全部就位（共享池：${sharedRelDir}，当前包：${relDepsDir}）。`;
  const lines = [`请为开发流「${name}」在后台补齐以下 ${missing.length} 项开源项目与运行环境依赖，优先装入跨开发流共享底座池 \`${sharedRelDir}/\`（一次安装供所有预置宏与节点级 JIT 派生开发流复用）：`];
  for (const m of missing) {
    const ver = m.version ? ` (${m.version})` : '';
    const src = m.repoUrl ? ` · ${m.repoUrl}` : '';
    const hint = m.installCmd ? `执行 \`${m.installCmd}\``
      : (m.kind === 'npm' && m.pkg ? `执行 \`npm install --prefix ${sharedRelDir}/npm ${m.pkg}${m.version ? '@' + m.version.replace(/^v/, '') : ''}\``
        : (m.repoUrl ? `克隆至 \`${sharedRelDir}/repos/${m.id}\` 并配置 \`${sharedRelDir}/.bin\` 入口` : `补齐可执行工具 \`${m.bin || m.id}\``));
    lines.push(`- **${m.title}** (\`${m.id}\`${ver})${src} → ${hint}`);
  }
  lines.push(`安装验证通过后，将 \`${sharedRelDir}/manifest.json\`（或 \`${relDepsDir}/manifest.json\`）对应条目标为 \`ready: true\` 并刷新工作台。`);
  return lines.join('\n');
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

  const localBins = [paths.binDir, paths.npmBinDir, paths.venvBinDir];
  const sharedBins = [shared.binDir, shared.npmBinDir, shared.venvBinDir];
  const pathSep = platform === 'win32' ? ';' : delimiter;
  const rawPath = String(env.PATH ?? env.Path ?? env.path ?? '');
  const hostBins = [join(root, 'node_modules', '.bin'), join(DG_ROOT, 'node_modules', '.bin'), ...rawPath.split(pathSep).filter(Boolean)];

  const isManifestRecReady = (rec) => Boolean(
    rec && rec.ready === true && (!rec.verifyPath || existsSync(resolve(root, rec.verifyPath)))
  );

  const items = resolveWorkflowDepItems(root, pack).map((it) => {
    const rec = installedMap[it.id];
    const sharedRec = sharedInstalledMap[it.id];
    const repoCloneDir = join(paths.reposDir, sanitizeId(it.id));
    const sharedRepoDir = join(shared.reposDir, sanitizeId(it.id));
    let resolvedVia = null;
    let resolvedPath = null;
    if (isManifestRecReady(rec)) {
      resolvedVia = 'workflow-manifest'; resolvedPath = rec.verifyPath || paths.relDir;
    } else if (opts.ignoreSharedPool !== true && isManifestRecReady(sharedRec) && (!it.version || !sharedRec.version || sharedRec.version === it.version)) {
      resolvedVia = 'shared-manifest'; resolvedPath = sharedRec.verifyPath || shared.relDir;
    } else if (it.bin) {
      const inWf = findExecutableInDirs(it.bin, localBins, platform);
      const inShared = opts.ignoreSharedPool === true ? null : findExecutableInDirs(it.bin, sharedBins, platform);
      if (inWf) { resolvedVia = 'workflow-deps'; resolvedPath = normalizeSlashes(inWf); }
      else if (inShared) { resolvedVia = 'shared-deps'; resolvedPath = normalizeSlashes(inShared); }
      else if (it.allowHostEnv) {
        const inHost = findExecutableInDirs(it.bin, hostBins, platform);
        if (inHost) { resolvedVia = 'host-env'; resolvedPath = normalizeSlashes(inHost); }
      }
    } else if (existsSync(repoCloneDir)) {
      resolvedVia = 'workflow-repo'; resolvedPath = normalizeSlashes(repoCloneDir);
    } else if (opts.ignoreSharedPool !== true && existsSync(sharedRepoDir)) {
      resolvedVia = 'shared-repo'; resolvedPath = normalizeSlashes(sharedRepoDir);
    }
    return { ...it, ready: Boolean(resolvedVia), resolvedVia, resolvedPath };
  });

  const missing = items.filter((x) => !x.ready);
  return {
    packId, packName: (pack && pack.name) || packId, depsDir: paths.relDir, sharedDepsDir: shared.relDir,
    ready: missing.length === 0, total: items.length, readyCount: items.length - missing.length,
    missingCount: missing.length, items, missing,
    agentPrompt: buildProvisionAgentPrompt(pack, paths.relDir, shared.relDir, missing)
  };
}

export function buildWorkflowDepEnv(projectRoot, packId, baseEnv = process.env, platform = process.platform) {
  const paths = getWorkflowDepsPaths(projectRoot, packId, platform);
  const shared = getSharedWorkflowDepsPaths(projectRoot, platform);
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

  for (const d of [paths.binDir, join(paths.absDir, 'npm'), paths.reposDir]) mkdirSync(d, { recursive: true });
  if (useShared) {
    for (const d of [shared.binDir, join(shared.absDir, 'npm'), shared.reposDir]) mkdirSync(d, { recursive: true });
  }

  const before = inspectWorkflowDeps(root, pack, opts.env ? { env: opts.env } : {});
  const curManifest = existsSync(paths.manifestPath) ? (readJsonStrict(paths.manifestPath).value || {}) : {};
  const installed = { ...(curManifest.installed || {}) };
  const curShared = (useShared && existsSync(shared.manifestPath)) ? (readJsonStrict(shared.manifestPath).value || {}) : {};
  const sharedInstalled = { ...(curShared.installed || {}) };
  const itemById = new Map(before.items.map((x) => [x.id, x]));

  if (Array.isArray(opts.markInstalledIds)) {
    for (const rawId of opts.markInstalledIds) {
      const id = String(rawId);
      const metaVer = itemById.get(id)?.version || '';
      const rec = { ready: true, version: metaVer, updatedAt: new Date().toISOString(), source: 'agent-verified' };
      installed[id] = rec;
      if (useShared) sharedInstalled[id] = rec;
    }
  }
  if (opts.runNpm === true) {
    const targetNpmPrefix = useShared ? join(shared.absDir, 'npm') : join(paths.absDir, 'npm');
    for (const m of before.missing) {
      if (m.kind === 'npm' && m.pkg) {
        const spec = m.version ? `${m.pkg}@${m.version.replace(/^v/, '')}` : m.pkg;
        const r = runNpmPrefixInstall(targetNpmPrefix, spec, root);
        if (r.status === 0) {
          const rec = { ready: true, version: m.version || '', updatedAt: new Date().toISOString(), source: useShared ? 'shared-npm-prefix' : 'npm-prefix' };
          installed[m.id] = rec;
          if (useShared) sharedInstalled[m.id] = rec;
        }
      }
    }
  }

  writeFileSync(paths.planPath, JSON.stringify({ packId, packName: (pack && pack.name) || packId, depsDir: paths.relDir, sharedDepsDir: shared.relDir, generatedAt: new Date().toISOString(), items: before.items, agentPrompt: before.agentPrompt }, null, 2) + '\n', 'utf8');
  writeFileSync(paths.manifestPath, JSON.stringify({ packId, updatedAt: new Date().toISOString(), installed }, null, 2) + '\n', 'utf8');
  if (useShared) {
    writeFileSync(shared.manifestPath, JSON.stringify({ packId: '_shared', updatedAt: new Date().toISOString(), installed: sharedInstalled }, null, 2) + '\n', 'utf8');
  }
  const after = inspectWorkflowDeps(root, pack);
  return { ok: true, ...after, planFile: `${paths.relDir}/PROVISION-PLAN.json`, manifestFile: `${paths.relDir}/manifest.json`, sharedManifestFile: `${shared.relDir}/manifest.json` };
}
