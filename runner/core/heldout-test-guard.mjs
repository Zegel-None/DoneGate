// 已冻结契约测试基线快照、断言不减棘轮、防私有符号耦合与防删改重放守卫（<= 350 行聚焦子模块）
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256, sha256Short } from '../../skill/hash.mjs';
import { readJsonStrict } from '../../skill/io.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { fileBelongsToScopes } from './context-router.mjs';
import { buildSanitizedEnv } from './isolation.mjs';
import { maskCommentsAndStrings } from './js-mask-lexer.mjs';
import { loadContracts, loadThresholds } from './project-loader.mjs';

const HTG_MAX_INLINE_BYTES = 262144;
const HTG_TEST_FILE_RE = /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.(?:test|spec)|[-_]fixtures?|-self-test)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|rs)$/i;
const HTG_TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i;
const HTG_SKIP_TOKENS = new Set(['node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'vitest', 'run', 'pytest', 'python', 'python3', 'go', 'test', 'cargo']);

function htgAppendMappedObligation(fileMap, rel, obId) {
  const prev = fileMap.get(rel) || [];
  if (!prev.includes(obId)) prev.push(obId);
  fileMap.set(rel, prev);
}

function htgCollectDirTestFiles(rootAbs, dirAbs, obId, fileMap) {
  let added = 0;
  for (const ent of readdirSync(dirAbs, { withFileTypes: true, recursive: true })) {
    if (!ent.isFile() || added >= 32) continue;
    const rel = relative(rootAbs, join(ent.parentPath || dirAbs, ent.name)).replace(/\\/g, '/');
    if (!HTG_TEST_FILE_RE.test(rel)) continue;
    htgAppendMappedObligation(fileMap, rel, obId);
    added++;
  }
}

function htgResolveCandidatePath(rootAbs, rawTok) {
  const unquoted = rawTok.replace(/^["']|["']$/g, '').trim();
  if (!unquoted || unquoted.startsWith('-') || HTG_SKIP_TOKENS.has(unquoted)) return null;
  const clean = unquoted.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('..')) return null;
  const abs = resolve(rootAbs, clean);
  const rel = relative(rootAbs, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || !existsSync(abs)) return null;
  try { return { abs, rel, st: statSync(abs) }; } catch { return null; }
}

function htgInspectCommandToken(rootAbs, rawTok, obId, fileMap) {
  const cand = htgResolveCandidatePath(rootAbs, rawTok);
  if (!cand) return;
  if (cand.st.isFile() && HTG_TEST_FILE_RE.test(cand.rel)) {
    htgAppendMappedObligation(fileMap, cand.rel, obId);
  } else if (cand.st.isDirectory() && HTG_TEST_DIR_RE.test(cand.rel)) {
    htgCollectDirTestFiles(rootAbs, cand.abs, obId, fileMap);
  }
}

export function extractReferencedTestFiles(projectRoot, obligations = []) {
  const rootAbs = resolve(projectRoot);
  const fileMap = new Map();
  for (const o of Array.isArray(obligations) ? obligations : []) {
    if (!o || o.kind !== 'command' || typeof o.command !== 'string') continue;
    const tokens = o.command.match(/(?:"[^"]*"|'[^']*'|[^\s"';&|]+)/g) || [];
    for (const tok of tokens) htgInspectCommandToken(rootAbs, tok, o.id, fileMap);
  }
  return fileMap;
}

function htgReadPackageScriptHashes(rootAbs) {
  const pkgPath = join(rootAbs, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const r = readJsonStrict(pkgPath);
  const scripts = r.ok && r.value && typeof r.value.scripts === 'object' ? r.value.scripts : null;
  if (!scripts) return null;
  const out = {};
  for (const [k, v] of Object.entries(scripts)) {
    if (typeof v === 'string') out[k] = sha256Short(v.trim(), 16);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function snapshotFrozenTests(projectRoot, contractId, obligations = []) {
  const rootAbs = resolve(projectRoot);
  const fileMap = extractReferencedTestFiles(rootAbs, obligations);
  const frozenTestHashes = {};
  const snapshotFiles = {};
  for (const [rel, obligationIds] of fileMap.entries()) {
    const buf = readFileSync(join(rootAbs, rel));
    const digest = sha256(buf);
    frozenTestHashes[rel] = digest;
    snapshotFiles[rel] = {
      sha256: digest,
      obligationIds,
      ...(buf.length <= HTG_MAX_INLINE_BYTES ? { contentBase64: buf.toString('base64') } : {})
    };
  }
  const frozenScriptHashes = htgReadPackageScriptHashes(rootAbs);
  if (Object.keys(frozenTestHashes).length > 0 || frozenScriptHashes) {
    const stubsDir = join(rootAbs, '.donegate', 'stubs');
    mkdirSync(stubsDir, { recursive: true });
    writeFileSync(join(stubsDir, `${contractId}.tests.frozen.json`), JSON.stringify({
      schema: 'donegate-frozen-tests/v1',
      contractId,
      frozenAt: new Date().toISOString(),
      frozenScriptHashes,
      files: snapshotFiles
    }, null, 2) + '\n', 'utf8');
  }
  return { frozenTestHashes, frozenScriptHashes };
}

function htgVerifyScriptHashes(rootAbs, latestFreeze) {
  const locked = latestFreeze?.frozenScriptHashes;
  if (!locked || typeof locked !== 'object') return [];
  const cur = htgReadPackageScriptHashes(rootAbs) || {};
  const fails = [];
  for (const [name, expected] of Object.entries(locked)) {
    if (cur[name] !== expected) {
      fails.push(`HELDOUT_SCRIPT_TAMPERED: package.json#scripts["${name}"] 与冻结基线不一致，严禁通过篡改脚本绕过测试`);
    }
  }
  return fails;
}

function htgRecoverBaselineBuffer(rootAbs, contractId, latestFreeze, relPath, expectedSha) {
  const snapPath = join(rootAbs, '.donegate', 'stubs', `${contractId}.tests.frozen.json`);
  if (existsSync(snapPath)) {
    const r = readJsonStrict(snapPath);
    const b64 = r.ok ? r.value?.files?.[relPath]?.contentBase64 : null;
    if (typeof b64 === 'string') {
      const buf = Buffer.from(b64, 'base64');
      if (sha256(buf) === expectedSha) return buf;
    }
  }
  if (!latestFreeze?.freezeCommit) return null;
  const gitShow = spawnSync('git', ['-C', rootAbs, 'show', `${latestFreeze.freezeCommit}:${relPath}`], { windowsHide: true, timeout: 15000 });
  if (gitShow.status === 0 && Buffer.isBuffer(gitShow.stdout) && sha256(gitShow.stdout) === expectedSha) {
    return gitShow.stdout;
  }
  return null;
}

function htgReplayObligationsOnBaseline(rootAbs, contract, obsToRun, modifiedRels) {
  const thresholds = loadThresholds(rootAbs);
  const env = buildSanitizedEnv(process.env, { DONEGATE_HELDOUT_REPLAY: '1' }, {
    cwd: rootAbs, envPassthrough: contract?.execution?.envPassthrough
  });
  const fails = [];
  for (const o of obsToRun) {
    const r = spawnSync(o.command, {
      cwd: rootAbs, shell: true, env, encoding: 'utf8',
      timeout: (o.timeoutSec || thresholds.timeoutSec || 120) * 1000, windowsHide: true
    });
    const stdoutTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    const expectedCode = o.expect?.exitCode ?? 0;
    const outMismatch = o.expect?.stdoutMatches !== undefined && stdoutTrim !== o.expect.stdoutMatches;
    if (r.error || r.status !== expectedCode || outMismatch) {
      fails.push(`HELDOUT_TEST_WEAKENED: 测试文件 (${modifiedRels.join(', ')}) 被修改后，冻结基线原版测试在当前代码上重放失败（判据 ${o.id} exit=${r.status}），禁止改弱断言凑绿`);
    }
  }
  return fails;
}

function htgDiffLockedTests(rootAbs, cid, lockedTests) {
  const deleted = [];
  const modified = [];
  for (const [rel, expectedSha] of Object.entries(lockedTests)) {
    const abs = join(rootAbs, rel);
    if (!existsSync(abs)) deleted.push(`HELDOUT_TEST_DELETED: 已冻结契约 ${cid} 锁定的测试文件被删除：${rel}`);
    else if (sha256(readFileSync(abs)) !== expectedSha) modified.push({ rel, abs, expectedSha });
  }
  return { deleted, modified };
}

const HTG_MASKED_ASSERT_RE = /\b(?:expect(?:\.(?:soft|poll))?\s*\(|assert(?:\.[A-Za-z_$][\w$]*)?\s*\()|(?:^|[;\n])\s*assert(?!\s*[.(])\b/g;
const HTG_ESM_NAMED_IMP_RE = /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const HTG_CJS_NAMED_REQ_RE = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function verifyTestAssertionNonDecrease(beforeSrc, afterSrc, opts = {}) {
  const ext = opts.ext || '.mjs';
  const beforeMasked = maskCommentsAndStrings(String(beforeSrc || ''), ext);
  const afterMasked = maskCommentsAndStrings(String(afterSrc || ''), ext);
  const beforeCount = (beforeMasked.match(HTG_MASKED_ASSERT_RE) || []).length;
  const afterCount = (afterMasked.match(HTG_MASKED_ASSERT_RE) || []).length;
  const ok = afterCount >= beforeCount;
  return {
    ok,
    beforeCount,
    afterCount,
    delta: afterCount - beforeCount,
    code: ok ? 'ASSERTION_COUNT_PRESERVED' : 'TEST_ASSERTION_DECREASED',
    ...(ok ? {} : {
      reason: `HELDOUT_TEST_WEAKENED: 既有测试断言计数下降 (${beforeCount} -> ${afterCount})，严禁删减或注释断言凑绿`
    })
  };
}

function htgNormalizePublicSymbolSet(facadeExports) {
  const set = new Set();
  const raw = facadeExports instanceof Set ? [...facadeExports] : (Array.isArray(facadeExports) ? facadeExports : []);
  for (const item of raw) {
    const sym = typeof item === 'string' ? item.trim() : String(item?.symbol || '').trim();
    if (!sym) continue;
    set.add(sym.includes('::') ? sym.split('::').pop() : sym);
  }
  return set;
}

function htgCollectCoupledSpecifiers(rawClause, spec, publicSet, couplings) {
  for (const part of rawClause.split(',')) {
    const cleaned = part.trim().split(/\s+(?:as|:)\s+/)[0].trim();
    if (!cleaned || cleaned === 'type') continue;
    if (!publicSet.has(cleaned) || (cleaned.startsWith('_') && !publicSet.has(cleaned))) {
      couplings.push({
        specifier: spec,
        symbol: cleaned,
        kind: 'private_symbol_coupled',
        reason: `PRIVATE_SYMBOL_COUPLED: 验收测试从 "${spec}" 导入了契约门面未导出的内部私有符号 "${cleaned}"`
      });
    }
  }
}

export function detectPrivateSymbolTestCoupling(testSrc, facadeExports = [], opts = {}) {
  const src = String(testSrc || '');
  const masked = maskCommentsAndStrings(src, opts.ext || '.mjs');
  const publicSet = htgNormalizePublicSymbolSet(facadeExports);
  const couplings = [];
  for (const re of [HTG_ESM_NAMED_IMP_RE, HTG_CJS_NAMED_REQ_RE]) {
    for (const m of src.matchAll(re)) {
      if (masked[m.index] === ' ') continue;
      const spec = m[2].trim();
      const checkSpec = opts.includeSpecRegex ? opts.includeSpecRegex.test(spec) : spec.startsWith('.');
      if (checkSpec) htgCollectCoupledSpecifiers(m[1], spec, publicSet, couplings);
    }
  }
  return { ok: couplings.length === 0, coupled: couplings.length > 0, couplings, warnings: couplings.map((c) => c.reason) };
}

function htgSwapAndReplayModifiedTests(rootAbs, contract, latestFreeze, modified) {
  const cid = contract.id;
  const backups = new Map();
  const baselines = new Map();
  for (const item of modified) {
    const baseBuf = htgRecoverBaselineBuffer(rootAbs, cid, latestFreeze, item.rel, item.expectedSha);
    if (!baseBuf) {
      return {
        ok: false, checked: true, exitCode: 2, code: 'HELDOUT_TEST_WEAKENED',
        fails: [`HELDOUT_TEST_WEAKENED: 已冻结测试文件 ${item.rel} 被修改且无法提取冻结基线重放，请先恢复或由人类重新执行 contract freeze`]
      };
    }
    const curBuf = readFileSync(item.abs);
    const ratchet = verifyTestAssertionNonDecrease(baseBuf.toString('utf8'), curBuf.toString('utf8'));
    if (!ratchet.ok) {
      return {
        ok: false, checked: true, exitCode: 2, code: 'HELDOUT_TEST_WEAKENED',
        fails: [`HELDOUT_TEST_WEAKENED: 测试文件 (${item.rel}) 断言计数下降 (${ratchet.beforeCount} -> ${ratchet.afterCount})，禁止删减断言凑绿`]
      };
    }
    backups.set(item.abs, curBuf);
    baselines.set(item.abs, baseBuf);
  }
  const cmdObs = (Array.isArray(contract.obligations) ? contract.obligations : []).filter((o) => o && o.kind === 'command');
  const modifiedRels = modified.map((m) => m.rel);
  let replayFails = [];
  try {
    for (const [abs, baseBuf] of baselines.entries()) writeFileSync(abs, baseBuf);
    replayFails = htgReplayObligationsOnBaseline(rootAbs, contract, cmdObs, modifiedRels);
  } finally {
    for (const [abs, curBuf] of backups.entries()) writeFileSync(abs, curBuf);
  }
  if (replayFails.length > 0) return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_TEST_WEAKENED', fails: replayFails };
  return { ok: true, checked: true, replayedFiles: modifiedRels, fails: [] };
}

export function verifyFrozenTestIntegrity(projectRoot, contract) {
  const rootAbs = resolve(projectRoot);
  const cid = contract?.id || '';
  if (!cid || contract?.track === 'explore') return { ok: true, checked: false, fails: [] };
  const chainChk = readAndVerifyChain(rootAbs);
  const latestFreeze = chainChk.ok ? chainChk.entries.filter((e) => e.kind === 'freeze' && e.contractId === cid).pop() : null;
  if (!latestFreeze) return { ok: true, checked: false, fails: [] };

  const scriptFails = htgVerifyScriptHashes(rootAbs, latestFreeze);
  if (scriptFails.length > 0) return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_SCRIPT_TAMPERED', fails: scriptFails };

  const lockedTests = latestFreeze.frozenTestHashes;
  if (!lockedTests || typeof lockedTests !== 'object') return { ok: true, checked: false, fails: [] };
  const { deleted, modified } = htgDiffLockedTests(rootAbs, cid, lockedTests);
  if (deleted.length > 0) return { ok: false, checked: true, exitCode: 2, code: 'HELDOUT_TEST_DELETED', fails: deleted };
  if (modified.length === 0) return { ok: true, checked: true, fails: [] };
  return htgSwapAndReplayModifiedTests(rootAbs, contract, latestFreeze, modified);
}

function htgCollectLatestOtherFreezes(entries, curId, retiredIds) {
  const latest = new Map();
  for (const e of entries) {
    if (e.kind !== 'freeze' || !e.contractId) continue;
    if (e.contractId === curId || retiredIds.has(e.contractId)) continue;
    latest.set(e.contractId, e);
  }
  return latest;
}

export function collectOtherContractsFrozenTests(projectRoot, currentContract) {
  const rootAbs = resolve(projectRoot);
  const chainChk = readAndVerifyChain(rootAbs);
  if (!chainChk.ok) return new Map();
  const ownRefs = extractReferencedTestFiles(rootAbs, currentContract?.obligations || []);
  const ownScopes = Array.isArray(currentContract?.scope) ? currentContract.scope : [];
  const retiredIds = new Set(loadContracts(rootAbs).contracts.filter((c) => c.retired).map((c) => c.id));
  const latestOthers = htgCollectLatestOtherFreezes(chainChk.entries, currentContract?.id || '', retiredIds);
  const foreign = new Map();
  for (const [otherId, frz] of latestOthers.entries()) {
    for (const rel of Object.keys(frz.frozenTestHashes || {})) {
      if (!ownRefs.has(rel) && !fileBelongsToScopes(rel, ownScopes)) foreign.set(rel, otherId);
    }
  }
  return foreign;
}
