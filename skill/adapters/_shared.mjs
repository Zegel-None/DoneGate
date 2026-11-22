// 适配器层唯一公共运行器（Adapter Protocol v1.1 · IoC 模板底座，仅依赖 Node 内置模块）
//
// 为什么存在本模块：
//   消除 22 个具体适配器里重复手搓的参数解析、--stage/--checked-by 越权拦截、注册表校验、
//   跨平台二进制查找与版本提取、semver 范围核对、git 脏树拒收、SHA-256 哈希与严格九字段落盘。
//   所有具体适配器禁止直接 import node:crypto 或 node:child_process，必须统一调用 runAdapter。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADAPTERS_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const shaBytes = (buf) => createHash('sha256').update(buf).digest('hex');

export function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

export function semverInRange(version, range) {
  const m = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  const rm = String(range || '').match(/^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)\.(\d+)\.(\d+)$/);
  if (!m || !rm) return false;
  const cmp = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2]);
  const cur = [+m[1], +m[2], +m[3]];
  return cmp(cur, [+rm[1], +rm[2], +rm[3]]) >= 0 && cmp(cur, [+rm[4], +rm[5], +rm[6]]) < 0;
}

export function parseJsonOrFail(rawText, label) {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    fail(3, `${label} 输出 JSON 截断或损坏：${e.message}`);
  }
}

export function withTempDir(prefix, fn) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

export function hashInputFiles(rootDir, relPaths, missingLabel = '输入文件') {
  const inputs = [];
  for (const fp of relPaths) {
    const norm = String(fp).replace(/\\/g, '/');
    const abs = resolve(rootDir, norm);
    if (!existsSync(abs)) fail(3, `${missingLabel}不存在：${norm}`);
    let buf;
    try { buf = readFileSync(abs); } catch { fail(3, `${missingLabel}不可读：${norm}`); }
    inputs.push({ path: norm, sha256: shaBytes(buf), bytes: buf.length, buffer: buf });
  }
  return inputs;
}

export function checkFreshFileOrFail(absPath, displayRel, dryRun, headCommitSec, stalePrefix = '陈旧报告退 3') {
  if (!existsSync(absPath)) fail(3, `报告不存在：${displayRel}`);
  let st, buf;
  try { st = statSync(absPath); buf = readFileSync(absPath); } catch (e) { fail(3, `报告不可读：${e.message}`); }
  if (!dryRun && headCommitSec > 0 && st.mtimeMs <= headCommitSec * 1000) {
    fail(3, `${stalePrefix}：${displayRel} 修改时间早于或等于 HEAD 提交时间`);
  }
  return buf;
}

export function buildWinBatchSpawn(batPath, args = []) {
  const quoteCmd = (raw) => {
    const s = String(raw ?? '');
    if (!s) return '""';
    return /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const inner = [quoteCmd(batPath), ...args.map(quoteCmd)].join(' ');
  return {
    cmd: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${inner}"`],
    extraOpts: { windowsVerbatimArguments: true, windowsHide: true }
  };
}

function resolveExecutable(spec, fallbackCandidates = []) {
  if (/[\\/]/.test(spec)) {
    if (!existsSync(spec)) return null;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(spec)) {
      return { cmd: spec, prefixArgs: [], isWinBatch: true };
    }
    return { cmd: spec, prefixArgs: [], isWinBatch: false };
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const w = spawnSync(finder, [spec], { encoding: 'utf8', windowsHide: true });
  if (w.status === 0 && (w.stdout || '').trim()) {
    const lines = w.stdout.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (process.platform === 'win32') {
      const winExec = lines.find((l) => /\.(exe|cmd|bat|com)$/i.test(l));
      if (winExec) return { cmd: winExec, prefixArgs: [], isWinBatch: /\.(cmd|bat)$/i.test(winExec) };
      const firstExt = lines.find((l) => /\.[A-Za-z0-9]+$/.test(l));
      if (firstExt) return { cmd: firstExt, prefixArgs: [], isWinBatch: false };
    } else {
      return { cmd: lines[0], prefixArgs: [], isWinBatch: false };
    }
  }
  const home = process.env.USERPROFILE || homedir();
  const appDataNpm = process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null;
  const cands = [
    ...fallbackCandidates,
    ...(appDataNpm ? [join(appDataNpm, spec + '.cmd'), join(appDataNpm, spec + '.exe')] : []),
    process.platform === 'win32' ? join(home, 'bin', spec + '.exe') : join(home, 'bin', spec),
    process.platform === 'win32' ? join(home, 'bin', spec + '.cmd') : null,
    process.platform === 'win32' ? join(home, '.local', 'bin', spec + '.exe') : join(home, '.local', 'bin', spec)
  ];
  for (const c of cands) {
    if (c && existsSync(c)) {
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(c)) {
        return { cmd: c, prefixArgs: [], isWinBatch: true };
      }
      return { cmd: c, prefixArgs: [], isWinBatch: false };
    }
  }
  return null;
}

export function runAdapter(spec) {
  const argv = process.argv.slice(2);
  if (argv.includes('--stage') || argv.includes('--checked-by')) {
    fail(2, '协议违规：禁止传入 --stage 或 --checked-by（仅从 registry 抄录）');
  }
  const arg = (k, d = null) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
  };
  const hasFlag = (k) => argv.includes(k);
  const rawArgAfter = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? (argv[i + 1] ?? '') : null;
  };

  const dryRun = hasFlag('--dry-run');
  const rootDir = resolve(arg('--root', process.cwd()));
  const registryId = spec.requireRegistryId ? arg('--registry-id') : arg('--registry-id', spec.defaultRegistryId || `${spec.tool}@stage4`);
  if (!registryId) fail(2, '缺少必填参数 --registry-id');

  const regPath = existsSync(join(rootDir, 'adapters.registry.json'))
    ? join(rootDir, 'adapters.registry.json')
    : join(ADAPTERS_REPO, 'adapters.registry.json');
  let reg;
  try { reg = JSON.parse(readFileSync(regPath, 'utf8')); } catch (e) { fail(2, 'adapters.registry.json 不可读或损坏：' + e.message); }
  const entry = Array.isArray(reg.adapters) ? reg.adapters.find((a) => a.id === registryId && a.tool === spec.tool) : null;
  if (!entry) fail(2, '未在 adapters.registry.json 登记的 --registry-id：' + registryId);

  const validCb = Array.isArray(entry.checkedBy)
    ? entry.checkedBy.length > 0 && entry.checkedBy.every((cb) => typeof cb === 'string' && /^[^/]+\/[^/]+$/.test(cb))
    : typeof entry.checkedBy === 'string' && /^[^/]+\/[^/]+$/.test(entry.checkedBy);
  if (entry.protocolVersion !== '1.1' || !Number.isInteger(entry.stage) || entry.stage < 1 || entry.stage > 20 || !validCb) {
    fail(2, 'registry 条目协议版本或字段非法：' + registryId);
  }

  if (typeof spec.validateArgs === 'function') {
    spec.validateArgs({ argv, arg, hasFlag, rawArgAfter, fail });
  }

  const defaultBin = spec.defaultBin || spec.tool;
  const binSpec = arg('--bin', defaultBin);
  const customEnv = spec.env ? { ...process.env, ...spec.env } : process.env;
  const timeoutMs = spec.timeoutMs || 120000;

  let runBin = null;
  let toolVer = '';
  if (typeof spec.resolveVersion === 'function') {
    toolVer = spec.resolveVersion({ arg, rootDir, repoDir: ADAPTERS_REPO, entry, fail });
  } else if (spec.mode === 'artifact' || spec.mode === 'knowledge' || spec.mode === 'custom') {
    const pkgPath = join(rootDir, 'package.json');
    let fallbackVer = '1.0.0';
    if (existsSync(pkgPath)) {
      try { fallbackVer = JSON.parse(readFileSync(pkgPath, 'utf8')).version || '1.0.0'; } catch (err) { void err; }
    }
    toolVer = arg('--tool-version', fallbackVer);
  } else {
    const resolved = resolveExecutable(binSpec, typeof spec.binFallbacks === 'function' ? spec.binFallbacks(homedir()) : []);
    if (!resolved) fail(3, `${defaultBin} 不可用 / ${defaultBin} 不在 PATH：${binSpec}`);
    runBin = (args, opts = {}) => {
      const baseOpts = {
        cwd: opts.cwd || rootDir,
        env: opts.env ? { ...customEnv, ...opts.env } : customEnv,
        encoding: 'utf8',
        timeout: opts.timeout || timeoutMs,
        windowsHide: true
      };
      if (resolved.isWinBatch) {
        const wb = buildWinBatchSpawn(resolved.cmd, args);
        return spawnSync(wb.cmd, wb.args, { ...baseOpts, ...wb.extraOpts });
      }
      return spawnSync(resolved.cmd, [...resolved.prefixArgs, ...args], baseOpts);
    };
    const verArgs = spec.versionArgs || ['--version'];
    const verR = runBin(verArgs, { timeout: 20000 });
    if (verR.error || verR.status !== 0) fail(3, `${defaultBin} 不可用 / ${defaultBin} 不在 PATH：${binSpec}`);
    const verMatch = ((verR.stdout || '') + (verR.stderr || '')).match(/(\d+\.\d+\.\d+)/);
    if (!verMatch) fail(3, `无法解析 ${defaultBin} 版本`);
    toolVer = verMatch[1];
  }

  if (spec.enforceTestedRange && !semverInRange(toolVer, entry.testedToolRange)) {
    fail(3, `${spec.tool} 版本 ${toolVer} 超出 testedToolRange (${entry.testedToolRange})`);
  }

  const git = (a) => spawnSync('git', ['-C', rootDir, ...a], { encoding: 'utf8' });
  let anchor = { head: null, worktreeHash: null, isDirty: false };
  let headCommitSec = 0;
  if (!dryRun) {
    const st = git(['status', '--porcelain']);
    if (st.status !== 0 || st.stdout.trim() !== '') fail(3, '脏树或非 git 仓库拒收退 3');
    const h = git(['rev-parse', 'HEAD']);
    const wt = git(['rev-parse', 'HEAD^{tree}']);
    const ct = git(['log', '-1', '--format=%ct']);
    if (h.status !== 0 || wt.status !== 0) fail(3, '读取 git HEAD/tree 失败');
    anchor = { head: h.stdout.trim(), worktreeHash: wt.stdout.trim(), isDirty: false };
    if (ct.status === 0) headCommitSec = Number(ct.stdout.trim()) || 0;
  }

  const outPath = resolve(rootDir, arg('--out', `.donegate/adapters/${spec.tool}/claim.json`));
  const outDir = dirname(outPath);
  const relPath = (p) => relative(rootDir, p).replace(/\\/g, '/');
  const obsPath = join(outDir, 'observation.json');
  const anchorPath = join(outDir, 'git-anchor.json');

  const ctx = {
    arg,
    hasFlag,
    rawArgAfter,
    dryRun,
    rootDir,
    repoDir: ADAPTERS_REPO,
    entry,
    toolVer,
    headCommitSec,
    outDir,
    obsRelPath: relPath(obsPath),
    relPath,
    runBin,
    fail,
    parseJsonOrFail,
    withTempDir,
    hashInputFiles,
    checkFreshFileOrFail,
    readRawOverride(flagName = '--raw-report') {
      const ov = arg(flagName);
      if (!ov) return null;
      const abs = resolve(rootDir, ov);
      if (!existsSync(abs)) fail(3, `${flagName.replace(/^--/, '')} 不存在：${ov}`);
      try { return readFileSync(abs, 'utf8'); } catch { fail(3, `${flagName.replace(/^--/, '')} 不可读`); }
    }
  };

  const res = spec.collect(ctx);
  const obsBuf = Buffer.from(JSON.stringify(res.observation, null, 2) + '\n', 'utf8');
  const anchorBuf = Buffer.from(JSON.stringify(anchor, null, 2) + '\n', 'utf8');

  let rawArtifact;
  let rawWriteTarget = null;
  let rawBuf = null;
  if (res.existingReportAbs) {
    const repBuf = res.existingReportBuf || readFileSync(res.existingReportAbs);
    rawArtifact = {
      path: relPath(res.existingReportAbs),
      sha256: shaBytes(repBuf),
      kind: res.rawKind || `${spec.tool}-raw`,
      bytes: repBuf.length
    };
  } else {
    const rawFileName = res.rawFileName || `raw-${spec.tool}.json`;
    rawWriteTarget = join(outDir, rawFileName);
    rawBuf = Buffer.isBuffer(res.rawContent)
      ? res.rawContent
      : Buffer.from(typeof res.rawContent === 'string' ? res.rawContent : JSON.stringify(res.rawJson ?? {}, null, 2) + '\n', 'utf8');
    rawArtifact = {
      path: relPath(rawWriteTarget),
      sha256: shaBytes(rawBuf),
      kind: res.rawKind || `${spec.tool}-raw`,
      bytes: rawBuf.length
    };
  }

  const inputs = (res.inputs || []).map((i) => ({ path: i.path, sha256: i.sha256 }));
  const claims = Array.isArray(res.claims)
    ? res.claims
    : [{ text: res.claimText, checkedBy: entry.checkedBy }];
  const unresolved = (res.unresolved || []).map((u) => (
    typeof u === 'string' ? { text: u, stage: entry.stage } : u
  ));

  const claimObj = {
    stage: entry.stage,
    tool: entry.tool,
    version: toolVer,
    role: entry.role || spec.defaultRole || 'soft',
    inputs,
    artifacts: [
      rawArtifact,
      ...((res.extraArtifacts || []).map((ea) => {
        const absEa = resolve(rootDir, ea.path);
        if (!existsSync(absEa)) fail(3, `生成产物不存在：${ea.path}`);
        const eaBuf = readFileSync(absEa);
        return { path: relPath(absEa), sha256: shaBytes(eaBuf), kind: ea.kind || `${spec.tool}-artifact`, bytes: eaBuf.length };
      })),
      { path: relPath(obsPath), sha256: shaBytes(obsBuf), kind: res.obsKind || `${spec.tool}-observation`, bytes: obsBuf.length },
      { path: relPath(anchorPath), sha256: shaBytes(anchorBuf), kind: 'git-anchor', bytes: anchorBuf.length }
    ],
    claims,
    unresolved,
    degradedTo: res.degradedTo || spec.degradedTo
  };

  if (dryRun) {
    console.log(JSON.stringify({ observation: res.observation, claim: claimObj }, null, 2));
    process.exit(0);
  }
  mkdirSync(outDir, { recursive: true });
  if (rawWriteTarget && rawBuf) writeFileSync(rawWriteTarget, rawBuf);
  writeFileSync(obsPath, obsBuf);
  writeFileSync(anchorPath, anchorBuf);
  writeFileSync(outPath, JSON.stringify(claimObj, null, 2) + '\n');
  console.log(`产出声明：${relPath(outPath)}${res.summaryLog ? `（${res.summaryLog}）` : ''}`);
  process.exit(0);
}
