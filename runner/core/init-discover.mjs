// 存量仓库零 LLM 逆向扫描与探索态契约起步生成器（donegate init --discover，L1 无头内核，<= 230 行）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { readJsonStrict } from '../../skill/io.mjs';
import { CK_SKIP_DIRS, discoverRepoScanDirs } from './cockpit-cache.mjs';

const CODE_EXT_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;
const TEST_FILE_RE = /(?:^|\/)(?:tests?|__tests__|spec|specs)\/|(?:\.(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go|rs)$)/i;
const NON_SRC_DIRS = new Set([
  'contracts', 'functions', 'decisions', 'docs', 'doc', 'tests', 'test', '__tests__',
  'spec', 'specs', 'fixtures', 'examples', 'example', 'bench', 'benchmarks', 'scripts', 'public', 'static', 'assets'
]);
const REL_IMPORT_RE = /(?:import\s+(?:[^\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g;
const PY_FROM_RE = /^\s*(?:from|import)\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/gm;

function slugifyContractId(raw, usedIds) {
  const base = String(raw || 'module').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
  let id = base;
  let seq = 2;
  while (usedIds.has(id)) id = `${base}-${seq++}`;
  usedIds.add(id);
  return id;
}

function collectRepoFiles(projectRoot) {
  const topDirs = discoverRepoScanDirs(projectRoot);
  const codeFiles = [];
  const testFiles = [];
  for (const d of topDirs) {
    for (const abs of walk(join(projectRoot, d), { skipDirs: CK_SKIP_DIRS }).files) {
      const rel = relative(projectRoot, abs).replace(/\\/g, '/');
      if (!CODE_EXT_RE.test(rel)) continue;
      if (TEST_FILE_RE.test(rel)) testFiles.push(rel);
      else codeFiles.push(rel);
    }
  }
  for (const ent of readdirSync(projectRoot, { withFileTypes: true })) {
    if (!ent.isFile() || !CODE_EXT_RE.test(ent.name)) continue;
    if (TEST_FILE_RE.test(ent.name)) testFiles.push(ent.name);
    else codeFiles.push(ent.name);
  }
  return { topDirs, codeFiles: codeFiles.sort(), testFiles: testFiles.sort() };
}

export function detectRepoStackAndSmoke(projectRoot, testFiles = []) {
  const pkgRes = existsSync(join(projectRoot, 'package.json')) ? readJsonStrict(join(projectRoot, 'package.json')) : { ok: false };
  const pkg = pkgRes.ok ? pkgRes.value : null;
  const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const testScript = String(pkg?.scripts?.test || '');
  const hasPy = ['pyproject.toml', 'requirements.txt', 'setup.py'].some((f) => existsSync(join(projectRoot, f)))
    || testFiles.some((f) => f.endsWith('.py'));
  const hasGo = existsSync(join(projectRoot, 'go.mod')) || testFiles.some((f) => f.endsWith('.go'));
  const hasRust = existsSync(join(projectRoot, 'Cargo.toml')) || testFiles.some((f) => f.endsWith('.rs'));
  const hasVitest = Boolean(allDeps.vitest || /\bvitest\b/.test(testScript));
  const hasJsTest = testFiles.some((f) => /\.(?:mjs|cjs|js|ts|tsx|jsx)$/i.test(f));

  if (hasVitest) return { stack: 'js-vitest', smokeCmd: 'npx vitest run' };
  if (hasJsTest) return { stack: 'js-node-test', smokeCmd: 'node --test' };
  if (hasPy) return { stack: 'python', smokeCmd: testFiles.some((f) => f.endsWith('.py')) ? 'pytest -q' : 'pytest --collect-only -q' };
  if (hasGo) return { stack: 'go', smokeCmd: 'go test ./...' };
  if (hasRust) return { stack: 'rust', smokeCmd: 'cargo test' };
  return { stack: pkg ? 'js' : 'generic', smokeCmd: 'node -e "process.exit(0)"' };
}

function buildModuleGroups(projectRoot, topDirs, codeFiles) {
  const srcTop = topDirs.filter((d) => !NON_SRC_DIRS.has(d) && codeFiles.some((f) => f.startsWith(`${d}/`)));
  const candidates = [];
  if (srcTop.length === 1 && ['src', 'lib', 'app', 'packages', 'pkg', 'internal'].includes(srcTop[0])) {
    const parent = srcTop[0];
    const subs = discoverRepoScanDirs(join(projectRoot, parent)).filter((sd) => codeFiles.some((f) => f.startsWith(`${parent}/${sd}/`)));
    for (const sd of subs) candidates.push({ label: `${parent}/${sd}`, scope: `${parent}/${sd}/`, rawId: sd });
    const rootFiles = codeFiles.filter((f) => f.startsWith(`${parent}/`) && !subs.some((sd) => f.startsWith(`${parent}/${sd}/`)));
    if (rootFiles.length > 0 || candidates.length === 0) {
      candidates.push({ label: `${parent} (core)`, scope: candidates.length === 0 ? `${parent}/` : null, files: rootFiles, rawId: `${parent}-core` });
    }
  } else {
    for (const d of srcTop) candidates.push({ label: d, scope: `${d}/`, rawId: d });
  }
  if (candidates.length === 0 && codeFiles.length > 0) {
    candidates.push({ label: 'root-app', scope: null, files: codeFiles.slice(0, 20), rawId: 'root-app' });
  }
  const usedIds = new Set();
  return candidates.slice(0, 12).map((c) => {
    const id = slugifyContractId(c.rawId, usedIds);
    const files = c.files || codeFiles.filter((f) => f.startsWith(c.scope));
    const scope = c.scope ? [c.scope] : files;
    return { id, label: c.label, scope, files };
  });
}

function resolveImportOwner(relFile, rawText, fileOwnerMap, dirOwnerMap) {
  const deps = new Set();
  const baseDir = dirname(relFile);
  if (relFile.endsWith('.py')) {
    for (const m of rawText.matchAll(PY_FROM_RE)) {
      const seg = m[1].split('.')[0];
      const owner = dirOwnerMap.get(seg);
      if (owner) deps.add(owner);
    }
    return deps;
  }
  for (const m of rawText.matchAll(REL_IMPORT_RE)) {
    const joined = normalize(join(baseDir, m[1])).replace(/\\/g, '/');
    const cands = [joined, `${joined}.mjs`, `${joined}.js`, `${joined}.ts`, `${joined}/index.mjs`, `${joined}/index.js`, `${joined}/index.ts`];
    for (const cand of cands) {
      const owner = fileOwnerMap.get(cand);
      if (owner) { deps.add(owner); break; }
    }
  }
  return deps;
}

function buildTestCommand(stack, testFile) {
  if (testFile.endsWith('.py')) return `pytest -q ${testFile}`;
  if (testFile.endsWith('.go')) return `go test ./${dirname(testFile).replace(/^\.$/, '')}`;
  if (testFile.endsWith('.rs')) return 'cargo test';
  return stack === 'js-vitest' ? `npx vitest run ${testFile}` : `node --test ${testFile}`;
}

function matchTestsForGroups(projectRoot, groups, testFiles, fileOwnerMap, dirOwnerMap, stack) {
  const byGroup = new Map(groups.map((g) => [g.id, []]));
  for (const tf of testFiles) {
    let raw = '';
    try { raw = readFileSync(join(projectRoot, tf), 'utf8').slice(0, 16384); } catch { /* ignore */ }
    const hitOwners = resolveImportOwner(tf, raw, fileOwnerMap, dirOwnerMap);
    const stem = basename(tf, extname(tf)).toLowerCase();
    for (const g of groups) {
      const token = g.id.toLowerCase();
      if (hitOwners.has(g.id) || (token.length >= 3 && (stem.includes(token) || tf.toLowerCase().includes(`/${token}/`)))) {
        const list = byGroup.get(g.id);
        if (list.length < 3) list.push({ testFile: tf, command: buildTestCommand(stack, tf) });
      }
    }
  }
  return byGroup;
}

export function discoverExistingRepoStarterContracts(projectRoot) {
  const { topDirs, codeFiles, testFiles } = collectRepoFiles(projectRoot);
  const { stack, smokeCmd } = detectRepoStackAndSmoke(projectRoot, testFiles);
  const groups = buildModuleGroups(projectRoot, topDirs, codeFiles);
  const fileOwnerMap = new Map();
  const dirOwnerMap = new Map();
  for (const g of groups) {
    dirOwnerMap.set(basename(g.label), g.id);
    for (const f of g.files) fileOwnerMap.set(f, g.id);
  }
  const depsByGroup = new Map(groups.map((g) => [g.id, new Set()]));
  for (const g of groups) {
    for (const f of g.files.slice(0, 60)) {
      let raw = '';
      try { raw = readFileSync(join(projectRoot, f), 'utf8').slice(0, 16384); } catch { /* ignore */ }
      for (const dep of resolveImportOwner(f, raw, fileOwnerMap, dirOwnerMap)) {
        if (dep !== g.id) depsByGroup.get(g.id).add(dep);
      }
    }
  }
  const testsByGroup = matchTestsForGroups(projectRoot, groups, testFiles, fileOwnerMap, dirOwnerMap, stack);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  const created = [];

  for (const g of groups) {
    const matched = testsByGroup.get(g.id) || [];
    const obligations = matched.map((m, idx) => ({
      id: `${g.id}-test-${idx + 1}`,
      kind: 'command',
      command: m.command,
      expect: { exitCode: 0 },
      required: true,
      claim: `存量回归测试 ${m.testFile} 通过`,
      observable: `退出码为 0（${m.command}）`,
      scope: `自动发现的 ${g.label} 存量回归用例（探索态草稿，晋升正式交付前由人类裁方审定并补充边界/异常用例）`,
      inputClasses: ['正常']
    }));
    const contractObj = {
      id: g.id,
      title: `存量模块：${g.label}`,
      why: `由 donegate init --discover 自动逆向扫描生成的探索态起步契约（覆盖 ${g.files.length} 个源码文件）；请核对边界后使用 contract promote ${g.id} --by <签字人> 晋升冻结。`,
      scope: g.scope,
      owner: '业主',
      dependsOn: [...depsByGroup.get(g.id)].sort(),
      provisional: true,
      track: 'explore',
      exploreMeta: { ttlDays: 14, createdAt: nowIso, expiresAt, goldenSnapshots: [], discoveredBy: 'init --discover' },
      obligations
    };
    const cDir = join(projectRoot, 'contracts', g.id);
    mkdirSync(cDir, { recursive: true });
    writeFileSync(join(cDir, 'contract.json'), JSON.stringify(contractObj, null, 2) + '\n', 'utf8');
    created.push({
      id: g.id,
      fileCount: g.files.length,
      dependsOn: contractObj.dependsOn,
      obligationCount: obligations.length
    });
  }

  return { stack, smokeCmd, totalCodeFiles: codeFiles.length, totalTestFiles: testFiles.length, contracts: created };
}
