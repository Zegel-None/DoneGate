// ACH 语义变异验证（teeth --tier ACH）与 JiT Diff 捕获测试 + RubFake 假阳性过滤（donegate catch，<= 350 行）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { buildSanitizedEnv, checkCommandBans } from './isolation.mjs';
import { execRunPreFlightPlug } from './cmd-execute.mjs';
import {
  EPHEMERAL_CATCH_REL_DIR, buildCatchFocusHint, findStagedEphemeralCatchFile,
  probeTargetFunctionVacuity, resolveWorkflowAchTarget, stageEphemeralCatchTest
} from './teeth-ach/vacuity-and-focus.mjs';
export { EPHEMERAL_CATCH_REL_DIR, buildCatchFocusHint, probeTargetFunctionVacuity, stageEphemeralCatchTest };

const DEFAULT_CATCH_TIMEOUT_SEC = 120;
const BEHAVIOR_SUMMARY_MAX_LEN = 140;
const TACH_ASSERT_RE = /\b(?:expect\s*\(|assert(?:\.[a-zA-Z]+)?\s*\(|process\.exit\s*\(\s*[1-9]|throw\s+new\s+Error)/;
const TACH_MOCK_ONLY_RE = /\b(?:vi\.mock|jest\.mock|mock\.module)\s*\(/;
const TACH_IMPORT_RE = /(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

function tachNormalizeRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function tachLoadMutantList(projectRoot, rawMutants) {
  if (Array.isArray(rawMutants)) return { ok: true, list: rawMutants };
  if (typeof rawMutants === 'string' && rawMutants.trim()) {
    const abs = resolve(projectRoot, rawMutants.trim());
    const r = readJsonStrict(abs);
    if (!r.ok) return { ok: false, exitCode: r.error === 'parse' ? 2 : 3, reason: '读取语义变异清单失败：' + abs };
    const list = Array.isArray(r.value) ? r.value : r.value?.mutants;
    if (!Array.isArray(list) || list.length === 0) {
      return { ok: false, exitCode: 3, reason: '语义变异清单缺少非空 mutants 数组' };
    }
    return { ok: true, list };
  }
  return { ok: false, exitCode: 3, reason: 'ACH 语义变异模式需要提供 --mutants <mutants.json>' };
}

function tachIsInScope(projectRoot, contract, targetFile) {
  const rawRel = relative(projectRoot, targetFile);
  const normRel = rawRel.replace(/\\/g, '/');
  if (!normRel || isAbsolute(rawRel) || normRel.startsWith('..') || /^[A-Za-z]:/.test(normRel)) return false;
  const scopes = Array.isArray(contract?.scope) ? contract.scope.map((s) => tachNormalizeRel(s)).filter(Boolean) : [];
  if (scopes.length === 0) return true;
  return scopes.some((s) => (s.endsWith('/') ? normRel.startsWith(s) : (normRel === s || normRel.startsWith(s + '/'))));
}

function tachEvalMutantRun(r, ob) {
  if (r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT') return 'timeout';
  if (r.error || typeof r.status !== 'number') return 'runtime-error';
  if (r.status !== ob.expect?.exitCode) return 'killed';
  if (ob.expect?.stdoutMatches !== undefined) {
    const outTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    if (outTrim !== ob.expect.stdoutMatches) return 'killed';
  }
  return 'survived';
}

function tachRunSingleMutant(projectRoot, contract, ob, m, idx, sanitizedEnv) {
  const id = String(m?.id || `ach-m${idx + 1}`);
  if (!m || !m.file || m.from === undefined || m.to === undefined || m.from === m.to) {
    return { id, status: 'invalid', reason: '变异条目缺少合法的 file/from/to 且 from!=to' };
  }
  const targetFile = resolve(projectRoot, m.file);
  if (!tachIsInScope(projectRoot, contract, targetFile)) {
    return { id, status: 'invalid', reason: `变异目标文件越出契约 scope 或项目根目录：${m.file}` };
  }
  if (!existsSync(targetFile)) return { id, status: 'invalid', reason: `目标文件不存在：${m.file}` };
  const origBuf = readFileSync(targetFile);
  const origHash = sha256(origBuf);
  const origText = origBuf.toString('utf8');
  if (!origText.includes(m.from)) return { id, status: 'invalid', reason: `from 片段未命中：${m.file}` };

  let outcome = 'survived';
  try {
    writeFileSync(targetFile, origText.replace(m.from, () => String(m.to)), 'utf8');
    const r = spawnSync(ob.command, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: (ob.timeoutSec || 600) * 1000 });
    outcome = tachEvalMutantRun(r, ob);
  } finally {
    writeFileSync(targetFile, origBuf);
  }
  const restoredHash = sha256(readFileSync(targetFile));
  if (restoredHash !== origHash) {
    return { id, status: 'restore-failed', reason: `文件 ${m.file} 还原哈希不一致 (${restoredHash} != ${origHash})` };
  }
  return { id, file: tachNormalizeRel(m.file), description: String(m.description || ''), status: outcome };
}

export function runAchSemanticMutants(projectRoot, contract, ob, opts = {}) {
  const loaded = tachLoadMutantList(projectRoot, opts.mutants || ob.achMutants);
  if (!loaded.ok) return { exitCode: loaded.exitCode, stderr: loaded.reason, results: [] };
  const sanitizedEnv = buildSanitizedEnv(process.env, {}, { cwd: projectRoot, envPassthrough: contract.execution?.envPassthrough });
  const plugRes = execRunPreFlightPlug(projectRoot, contract, sanitizedEnv);
  if (!plugRes.ok) return { exitCode: plugRes.exitCode, code: plugRes.code, stderr: plugRes.stderr, results: [] };

  const results = [];
  for (let i = 0; i < loaded.list.length; i++) {
    const rec = tachRunSingleMutant(projectRoot, contract, ob, loaded.list[i], i, sanitizedEnv);
    results.push(rec);
    if (rec.status === 'restore-failed') {
      return { exitCode: 2, result: 'restore-failed', stderr: `事故：${rec.reason}`, results };
    }
  }
  const invalid = results.filter((r) => r.status === 'invalid');
  if (invalid.length > 0 && !opts.allowPartialInvalid) {
    return { exitCode: 3, result: 'invalid', stderr: `存在 ${invalid.length}/${results.length} 个无效语义变异体（拒绝凑数过关）：${invalid[0].reason}`, results };
  }

  const rAfter = spawnSync(ob.command, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: (ob.timeoutSec || 600) * 1000 });
  if (tachEvalMutantRun(rAfter, ob) !== 'survived') {
    return { exitCode: 1, result: 'unstable', stderr: '全部语义变异体还原后判据未跑绿，属不稳定', results };
  }

  const valid = results.filter((r) => r.status !== 'invalid');
  const killed = valid.filter((r) => r.status === 'killed').length;
  const survived = valid.filter((r) => r.status === 'survived').length;
  const result = survived === 0 && killed === valid.length ? 'killed' : 'survived';
  const teethRecord = {
    at: new Date().toISOString().slice(0, 10),
    tier: 'ACH',
    result,
    totalMutants: valid.length,
    killed,
    survived
  };
  ob.teeth = teethRecord;
  if (opts.contractPath && existsSync(opts.contractPath)) {
    writeFileSync(opts.contractPath, JSON.stringify(contract, null, 2) + '\n');
  }
  const exitCode = result === 'killed' ? 0 : 1;
  return {
    exitCode,
    result,
    teeth: teethRecord,
    results,
    stdout: `teeth (tier ACH): ${contract.id}/${ob.id} -> ${result} (killed ${killed}/${valid.length}, survived ${survived})`
  };
}

function tachCheckDiffCoverage(code, imports, normDiffs, reasons) {
  const hasMatch = (df) => {
    const stem = df.split('/').pop().replace(/\.[^.]+$/, '');
    return imports.some((imp) => imp.includes(stem)) || code.includes(df) || (stem.length >= 3 && code.includes(stem));
  };
  if (!normDiffs.some(hasMatch)) {
    reasons.push('RubFake 过滤：捕获测试未引用或触及本次 diff 中的任何目标文件');
  }
  const hasRealTargetImport = imports.some((imp) =>
    !imp.startsWith('node:') && normDiffs.some((df) => imp.includes(df.split('/').pop().replace(/\.[^.]+$/, '')))
  );
  if (TACH_MOCK_ONLY_RE.test(code) && !hasRealTargetImport) {
    reasons.push('RubFake 过滤：仅包含 mock 桩且未导入真实被测模块');
  }
}

function tachCheckCommandOnlyCatch(command, diffFiles, reasons) {
  const normDiffs = (Array.isArray(diffFiles) ? diffFiles : []).map(tachNormalizeRel).filter(Boolean);
  const mentionsDiff = normDiffs.length === 0 || normDiffs.some((df) => {
    const stem = df.split('/').pop().replace(/\.[^.]+$/, '');
    return command.includes(df) || (stem.length >= 3 && command.includes(stem));
  });
  if (!/\b(?:pytest|vitest|node|python3?|assert|expect)\b/i.test(command)) {
    reasons.push('RubFake 过滤：纯 --command 必须包含真实测试运行器或断言命令');
  }
  if (!mentionsDiff && !/\b(?:pytest|vitest)\b/i.test(command)) {
    reasons.push('RubFake 过滤：纯 --command 未引用本次 diff 中的任何目标文件');
  }
}

export function tachFilterCatchingTest(spec = {}, diffFiles = []) {
  const reasons = [];
  const code = String(spec.code || '');
  const command = String(spec.command || '');
  if (!code.trim() && !command.trim()) {
    return { ok: false, code: 'RUBFAKE_EMPTY', reasons: ['缺少可执行测试代码或命令'] };
  }
  if (code.trim()) {
    if (!TACH_ASSERT_RE.test(code)) {
      reasons.push('RubFake 过滤：测试脚本缺少有效断言（无 expect/assert/exit/throw 检查）');
    }
    const imports = [];
    for (const m of code.matchAll(TACH_IMPORT_RE)) imports.push(tachNormalizeRel(m[1] || m[2] || ''));
    const normDiffs = (Array.isArray(diffFiles) ? diffFiles : []).map(tachNormalizeRel).filter(Boolean);
    if (normDiffs.length > 0) tachCheckDiffCoverage(code, imports, normDiffs, reasons);
  }
  if (command.trim()) {
    const bans = checkCommandBans(command);
    if (bans.length > 0) reasons.push(`RubFake 过滤：捕获命令触发禁令（${bans.join('；')}）`);
  }
  if (!code.trim() && command.trim()) tachCheckCommandOnlyCatch(command, diffFiles, reasons);
  return { ok: reasons.length === 0, code: reasons.length === 0 ? 'VALID' : 'RUBFAKE_REJECTED', reasons };
}

function tachBuildTestFileCommand(testFile) {
  if (/\.py$/i.test(testFile)) {
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    return `${pyBin} ${JSON.stringify(testFile)}`;
  }
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(testFile)}`;
}

function tachCollectDiffFiles(projectRoot, baseRef, headRef) {
  const args = baseRef
    ? ['-C', projectRoot, 'diff', '--name-only', `${baseRef}..${headRef || 'HEAD'}`]
    : ['-C', projectRoot, 'diff', '--name-only', 'HEAD'];
  const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/).map(tachNormalizeRel).filter(Boolean);
}

export function runWorkflowAchMutationProbe(projectRoot, opts = {}) {
  const resolved = resolveWorkflowAchTarget(projectRoot, opts);
  if (!resolved) {
    return { ok: true, skipped: true, exitCode: 0, results: [], stdout: 'teeth (tier ACH): 未配置活动单卡语义变异目标，安全早退 (exit 0)' };
  }
  return runAchSemanticMutants(resolve(projectRoot), resolved.contract, resolved.ob, { mutants: resolved.mutants });
}

function tachResolveCatchTarget(root, opts) {
  if (opts.testFile) return { testFile: resolve(root, opts.testFile), ephemeralPath: null };
  if (typeof opts.code === 'string' && opts.code.trim() && !opts.command) {
    const staged = stageEphemeralCatchTest(root, { id: opts.id, code: opts.code });
    return { testFile: staged.absPath, ephemeralPath: staged.relPath };
  }
  if (opts.focusHint || process.env.DG_NODE_ID) {
    const found = findStagedEphemeralCatchFile(root);
    if (found) return { testFile: found.absPath, ephemeralPath: found.relPath };
  }
  return { testFile: null, ephemeralPath: null };
}

function tachHandleMissingCatchCommand(opts, diffFiles, focusHint) {
  if (opts.focusHint || process.env.DG_NODE_ID) {
    const skipOut = { ok: true, skipped: true, exitCode: 0, caught: false, diffFiles, ephemeralDir: EPHEMERAL_CATCH_REL_DIR, ...(focusHint ? { focusHint } : {}) };
    return { ...skipOut, stdout: opts.json ? JSON.stringify(skipOut, null, 2) : (focusHint || 'catch: 无待执行临时抓虫脚本，安全早退 (exit 0)') };
  }
  return { exitCode: 3, stderr: '用法：donegate catch --test <file> | --command <cmd> [--focus-hint] [--base <ref>] [--json]' };
}

function tachExecuteVerifiedCatch(root, command, opts, diffFiles, rubFake, ephemeralPath, focusHint) {
  const run = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: Number(opts.timeoutSec || DEFAULT_CATCH_TIMEOUT_SEC) * 1000 });
  const caught = run.status !== 0;
  const diagLine = String(run.stderr || run.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || `exit=${run.status}`;
  const behaviorSummary = String(opts.behavior || diagLine).slice(0, BEHAVIOR_SUMMARY_MAX_LEN);
  const behaviorCard = caught
    ? `【行为确认卡】本次改动触发的新行为/回归：「${behaviorSummary}」。请确认这是否是你的预期？[是 / 否]`
    : '【捕获测试通过】未在本次 diff 中捕获到非预期行为回归。';
  const payload = {
    ok: !caught, exitCode: caught ? 1 : 0, caught, diffFiles, rubFake, behaviorCard, diagnostic: diagLine,
    ...(ephemeralPath ? { ephemeralPath } : {}), ...(focusHint ? { focusHint } : {})
  };
  return { ...payload, stdout: opts.json ? JSON.stringify(payload, null, 2) : behaviorCard };
}

export function cmdCatch(projectRoot, opts = {}) {
  const root = resolve(projectRoot);
  const diffFiles = Array.isArray(opts.diffFiles) ? opts.diffFiles : tachCollectDiffFiles(root, opts.base, opts.head);
  const focusHint = opts.focusHint ? buildCatchFocusHint(root, diffFiles, opts) : undefined;
  const { testFile, ephemeralPath } = tachResolveCatchTarget(root, opts);
  if (testFile && !existsSync(testFile)) return { exitCode: 3, stderr: '捕获测试文件不存在：' + opts.testFile };
  const code = typeof opts.code === 'string' && opts.code ? opts.code : (testFile ? readFileSync(testFile, 'utf8') : '');
  const command = opts.command || (testFile ? tachBuildTestFileCommand(testFile) : '');
  if (!command) return tachHandleMissingCatchCommand(opts, diffFiles, focusHint);
  const rubFake = tachFilterCatchingTest({ code, command }, diffFiles);
  if (!rubFake.ok) {
    const out = { ok: false, exitCode: 3, code: rubFake.code, reasons: rubFake.reasons, diffFiles, ...(focusHint ? { focusHint } : {}) };
    return { exitCode: 3, ...out, stderr: opts.json ? JSON.stringify(out, null, 2) : rubFake.reasons.join('\n') };
  }
  return tachExecuteVerifiedCatch(root, command, opts, diffFiles, rubFake, ephemeralPath, focusHint);
}
