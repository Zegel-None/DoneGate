// 单卡阅后即焚四重微门禁与 500-Token 富结构回执执行器（donegate check-node）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildNodeInterfaceStub } from './ast-stub.mjs';
import { discoverHermeticGraph, fileBelongsToScopes, resolveSubagentBudgetProfile } from './context-router.mjs';
import { diffAgainstFrozenStub, freezeNodeStubBaseline } from './hermetic-capsule.mjs';
import { loadThresholds } from './gates.mjs';
import { collectOtherContractsFrozenTests } from './heldout-test-guard.mjs';
import { hvBuildConfessionReport, verifyHeldOutContract } from './heldout-verifier.mjs';
import { buildSanitizedEnv, checkCommandBans } from './isolation.mjs';

const isNonMetaFile = (f) => Boolean(f && !f.startsWith('.donegate/') && f !== 'node_modules' && !f.startsWith('node_modules/'));

function normalizeGitRelPath(raw) {
  let rel = String(raw || '').trim();
  if (rel.includes(' -> ')) rel = rel.split(' -> ').pop().trim();
  return rel.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
}

function resolveBranchMergeBase(projectRoot, headSha, explicitBase) {
  if (explicitBase) {
    const mb = spawnSync('git', ['-C', projectRoot, 'merge-base', 'HEAD', explicitBase], { encoding: 'utf8' });
    if (mb.status === 0 && mb.stdout.trim()) return mb.stdout.trim();
    const rv = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--verify', `${explicitBase}^{commit}`], { encoding: 'utf8' });
    return (rv.status === 0 && rv.stdout.trim()) ? rv.stdout.trim() : null;
  }
  const candidates = ['main', 'origin/main', 'master', 'origin/master'];
  let fallbackSha = null;
  for (const cand of candidates) {
    const verify = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--verify', `${cand}^{commit}`], { encoding: 'utf8' });
    if (verify.status !== 0) continue;
    const mb = spawnSync('git', ['-C', projectRoot, 'merge-base', 'HEAD', cand], { encoding: 'utf8' });
    if (mb.status !== 0 || !mb.stdout.trim()) continue;
    const sha = mb.stdout.trim();
    if (!fallbackSha) fallbackSha = sha;
    if (sha !== headSha) return sha;
  }
  return fallbackSha;
}

function nmgReadDirtyFiles(projectRoot) {
  const st = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], { encoding: 'utf8' });
  if (st.status !== 0) return [];
  const rawDirtyFiles = [];
  for (const rawLine of (st.stdout || '').split(/\r?\n/)) {
    if (rawLine.length < 4) continue;
    const rel = normalizeGitRelPath(rawLine.slice(3));
    if (rel) rawDirtyFiles.push(rel);
  }
  return rawDirtyFiles;
}

function nmgReadCommittedSinceBase(projectRoot, explicitBase) {
  const headRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  const headSha = headRes.status === 0 ? headRes.stdout.trim() : '';
  if (!headSha) return { baseRef: null, committedFiles: [] };
  const baseRef = resolveBranchMergeBase(projectRoot, headSha, explicitBase);
  if (!baseRef || baseRef === headSha) return { baseRef, committedFiles: [] };
  const df = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--name-only', `${baseRef}..HEAD`], { encoding: 'utf8' });
  if (df.status !== 0) return { baseRef, committedFiles: [] };
  const committedSet = new Set();
  for (const line of (df.stdout || '').split(/\r?\n/)) {
    const rel = normalizeGitRelPath(line);
    if (isNonMetaFile(rel)) committedSet.add(rel);
  }
  return { baseRef, committedFiles: [...committedSet].sort() };
}

export function collectGitNodeChanges(projectRoot, explicitBase) {
  const inside = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') {
    return { isGit: false, baseRef: null, rawDirtyFiles: [], uncommittedFiles: [], committedFiles: [], touchedFiles: [] };
  }
  const rawDirtyFiles = nmgReadDirtyFiles(projectRoot);
  const uncommittedFiles = [...new Set(rawDirtyFiles.filter(isNonMetaFile))].sort();
  const { baseRef, committedFiles } = nmgReadCommittedSinceBase(projectRoot, explicitBase);
  const touchedFiles = [...new Set([...committedFiles, ...uncommittedFiles])].sort();
  return { isGit: true, baseRef, rawDirtyFiles, uncommittedFiles, committedFiles, touchedFiles };
}

function buildCompactPassReceiptJson(receipt) {
  const obs = [...(receipt.passedObligations || [])];
  const makeCompact = (list, omitted) => ({
    schema: receipt.schema,
    nodeId: receipt.nodeId,
    verdict: receipt.verdict,
    exitCode: receipt.exitCode,
    passed: receipt.passed,
    total: receipt.total,
    passedObligations: list,
    ...(omitted > 0 ? { omittedObligations: omitted } : {}),
    stubHash: receipt.stubHash,
    stubChanged: receipt.stubChanged,
    touchedCount: (receipt.touchedFiles || []).length,
    ...(receipt.crossScopeAllowed ? { crossScopeAllowed: true } : {}),
    sessionBudgetTokens: receipt.sessionBudgetTokens,
    receiptBudgetTokens: receipt.receiptBudgetTokens,
    durationMs: receipt.durationMs
  });
  let out = JSON.stringify(makeCompact(obs, 0));
  while (out.length > 512 && obs.length > 0) {
    obs.pop();
    out = JSON.stringify(makeCompact(obs, receipt.passedObligations.length - obs.length));
  }
  return out;
}

function nmgCollectCrossScopeFiles(projectRoot, id, contract, gitState, opts) {
  if (!gitState.isGit || opts.skipScopeCheck) return [];
  const foreignTests = collectOtherContractsFrozenTests(projectRoot, contract);
  return gitState.touchedFiles.filter((f) => {
    if (f.startsWith(`contracts/${id}/`)) return false;
    if (foreignTests.has(f)) return true;
    if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i.test(f)) return false;
    return !fileBelongsToScopes(f, contract.scope || []);
  });
}

function evaluateMicroGateFences(projectRoot, id, contract, currentStub, thresholds, gitState, opts) {
  const fails = [];
  const crossScopeAllowed = Boolean(opts.allowCrossScope);
  const crossScopeFiles = nmgCollectCrossScopeFiles(projectRoot, id, contract, gitState, opts);
  if (crossScopeFiles.length > 0 && !crossScopeAllowed) {
    fails.push(`越界修改非本卡 scope 文件：${crossScopeFiles.join(', ')}`);
  }
  let stubDiff = diffAgainstFrozenStub(projectRoot, id, currentStub);
  if (opts.allowStubChange && (!stubDiff.hasFrozenBaseline || stubDiff.stubChanged || stubDiff.breakingChanges.length > 0)) {
    freezeNodeStubBaseline(projectRoot, id, currentStub);
    stubDiff = diffAgainstFrozenStub(projectRoot, id, currentStub);
  } else if (stubDiff.breakingChanges.length > 0) {
    fails.push(...stubDiff.breakingChanges);
  }
  const graph = discoverHermeticGraph(projectRoot);
  if (graph.ok) {
    for (const r of graph.redImports.filter((x) => x.fromNode === id)) {
      fails.push(`未声明跨卡红线依赖：${r.fromFile} -> ${r.toNode} (${r.toFile})`);
    }
    for (const v of graph.facadeViolations.filter((x) => x.fromNode === id)) {
      fails.push(`越过门面私引邻居内部实现：${v.fromFile} -> ${v.toFile}（只准引 ${v.expectedFacades.join('/')}）`);
    }
  }
  if (currentStub.maxFileEffectiveLines > thresholds.maxEffectiveFileLines) {
    fails.push(`单文件有效代码超硬顶：${currentStub.maxFile} (${currentStub.maxFileEffectiveLines} > ${thresholds.maxEffectiveFileLines})`);
  }
  return { fails, stubDiff, crossScopeAllowed, crossScopeFiles };
}

function nmgRunPreFlightPlug(projectRoot, contract, sanitizedEnv, fails) {
  const plugCmd = typeof contract?.execution?.preFlightPlug === 'string' ? contract.execution.preFlightPlug.trim() : '';
  if (!plugCmd) return { ok: true };
  const pBans = checkCommandBans(plugCmd);
  if (pBans.length > 0) {
    fails.push(`preFlightPlug 触发禁令：${pBans.join('；')}`);
    return { ok: false, unknown: 0 };
  }
  const pr = spawnSync(plugCmd, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (pr.error || pr.status !== 0) {
    fails.push(`前置护栏 preFlightPlug 未通过：${plugCmd}`);
    return { ok: false, unknown: 1 };
  }
  return { ok: true };
}

function executeNodeObligations(projectRoot, id, contract, cmdObs, thresholds, fails) {
  const sanitizedEnv = buildSanitizedEnv(process.env, {
    DONEGATE_MICRO_GATE: '1',
    DONEGATE_MICRO_NODE: id
  }, { cwd: projectRoot, envPassthrough: contract?.execution?.envPassthrough });
  const plugRes = nmgRunPreFlightPlug(projectRoot, contract, sanitizedEnv, fails);
  if (!plugRes.ok) return { passed: 0, unknown: plugRes.unknown, passedObligations: [] };
  let passed = 0, unknown = 0;
  const passedObligations = [];
  for (const o of cmdObs) {
    const r = spawnSync(o.command, {
      cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8',
      timeout: (o.timeoutSec || thresholds.timeoutSec || 120) * 1000
    });
    const timedOut = Boolean(r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'));
    const spawnFailed = Boolean(r.error && !timedOut) || typeof r.status !== 'number';
    const stdoutTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    const errDetail = String(r.stderr || stdoutTrim || '').trim();
    if (timedOut || spawnFailed) {
      unknown++;
      fails.push(`判据 ${o.id} 无法执行或超时${errDetail ? `：${errDetail}` : ''}`);
    } else if (r.status !== o.expect?.exitCode) {
      fails.push(`判据 ${o.id} 退出码 ${r.status} !== 期望 ${o.expect?.exitCode}${errDetail ? `：${errDetail}` : ''}`);
    } else if (o.expect?.stdoutMatches !== undefined && stdoutTrim !== o.expect.stdoutMatches) {
      fails.push(`判据 ${o.id} 输出不匹配期望值（实际：${stdoutTrim}）`);
    } else {
      passed++;
      passedObligations.push(o.id);
    }
  }
  return { passed, unknown, passedObligations };
}

function persistMicroGateReceipt(projectRoot, id, currentStub, receipt) {
  const stubsDir = join(projectRoot, '.donegate', 'stubs');
  mkdirSync(stubsDir, { recursive: true });
  writeFileSync(join(stubsDir, `${id}.stub.d.ts`), currentStub.stubText, 'utf8');

  const capDir = join(projectRoot, '.donegate', 'capsules');
  mkdirSync(capDir, { recursive: true });
  const rcptPath = join(capDir, `${id}.receipt.json`);
  const prevRes = existsSync(rcptPath) ? readJsonStrict(rcptPath) : { ok: false };
  const prevStreak = (prevRes.ok && prevRes.value && prevRes.value.exitCode !== 0) ? Number(prevRes.value.retryStreak || 1) : 0;
  receipt.retryStreak = receipt.exitCode === 0 ? 0 : prevStreak + 1;
  writeFileSync(rcptPath, JSON.stringify(receipt, null, 2), 'utf8');

  const rsiDir = join(projectRoot, '.donegate', 'rsi-candidates');
  const rsiFile = join(rsiDir, `${id}.friction.json`);
  if (receipt.retryStreak >= 2) {
    mkdirSync(rsiDir, { recursive: true });
    writeFileSync(rsiFile, JSON.stringify({
      schema: 'donegate-rsi-friction/v1', nodeId: id, retryStreak: receipt.retryStreak,
      exitCode: receipt.exitCode, fails: receipt.fails || [], touchedFiles: receipt.touchedFiles, recordedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } else if (receipt.exitCode === 0 && prevStreak >= 2 && existsSync(rsiFile)) {
    const oldRsi = readJsonStrict(rsiFile);
    if (oldRsi.ok && oldRsi.value) {
      writeFileSync(rsiFile, JSON.stringify({ ...oldRsi.value, resolvedAfterRetries: prevStreak, resolvedAt: new Date().toISOString() }, null, 2), 'utf8');
    }
  }
}

function nmgBuildAbortResult(projectRoot, id, opts, t0, exitCode, reason) {
  if (!opts.receipt) return { exitCode, stderr: reason };
  const receipt = {
    schema: 'donegate-node-receipt/v1',
    nodeId: id || null,
    verdict: exitCode === 2 ? 'ERROR' : 'UNKNOWN',
    exitCode,
    fails: [reason],
    durationMs: Date.now() - t0
  };
  if (id && (existsSync(join(projectRoot, '.donegate')) || existsSync(join(projectRoot, 'contracts')))) {
    const capDir = join(projectRoot, '.donegate', 'capsules');
    mkdirSync(capDir, { recursive: true });
    writeFileSync(join(capDir, `${id}.receipt.json`), JSON.stringify(receipt, null, 2), 'utf8');
  }
  return { exitCode, receipt, stdout: `${JSON.stringify(receipt)}\n[exit code: ${exitCode}]`, stderr: '' };
}

function nmgPreflightNodeCheck(projectRoot, opts, t0) {
  const id = opts.id;
  const abort = (code, reason) => ({ ok: false, res: nmgBuildAbortResult(projectRoot, id, opts, t0, code, reason) });
  if (!id) return abort(3, '缺少目标节点标识（用法：donegate check-node <nodeId>）');
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const cRes = readJsonStrict(cPath);
  if (!cRes.ok) return abort(cRes.error === 'parse' ? 2 : 3, `读取节点契约失败：${cPath}`);
  const contract = cRes.value;
  const allObs = Array.isArray(contract.obligations) ? contract.obligations : [];
  const filtered = opts.criterion ? allObs.filter((o) => o.id === opts.criterion) : allObs;
  const cmdObs = filtered.filter((o) => o.kind === 'command');
  for (const o of cmdObs) {
    const banHits = checkCommandBans(o.command);
    if (banHits.length > 0) return abort(2, `判据 ${o.id} 触发 §四 禁令（退 2）：${banHits.join('；')}`);
  }
  const gitState = collectGitNodeChanges(projectRoot, opts.base);
  if (gitState.isGit && !opts.allowDirty && gitState.rawDirtyFiles.length > 0) {
    return abort(3, '工作区存在未提交改动（局部调试请加 --allow-dirty，正式签收请先提交干净树）');
  }
  const heldOut = verifyHeldOutContract(projectRoot, contract, {
    baseRef: opts.base || gitState.baseRef,
    heldOutDir: opts.heldOutDir,
    touchedFiles: gitState.touchedFiles
  });
  if (!heldOut.ok) return abort(2, heldOut.fails.join('；'));
  return { ok: true, id, contract, cmdObs, gitState };
}

function nmgFormatCheckNodeOutput(id, receipt, deltaFields, cmdTotal, fails, opts) {
  if (opts.receipt) {
    const outText = receipt.exitCode === 0 ? buildCompactPassReceiptJson(receipt) : `${JSON.stringify(receipt)}\n[exit code: ${receipt.exitCode}]`;
    return { ...deltaFields, stdout: outText, stderr: '' };
  }
  const errField = fails.length > 0 ? { stderr: fails.join('；') } : {};
  if (opts.json) return { ...deltaFields, stdout: JSON.stringify(receipt), ...errField };
  const summaryLines = [
    `[check-node:${id}] verdict=${receipt.verdict} passed=${receipt.passed}/${cmdTotal} exports=${receipt.exportedSymbolCount} stubHash=${receipt.stubHash} lines=${receipt.effectiveLines} (${receipt.durationMs}ms)`,
    ...(fails.map((f) => `  ✗ ${f}`)),
    `RECEIPT: ${JSON.stringify(receipt)}`
  ];
  return { ...deltaFields, stdout: summaryLines.join('\n'), ...errField };
}

export function cmdCheckNode(projectRoot, opts = {}) {
  const t0 = Date.now();
  const pre = nmgPreflightNodeCheck(projectRoot, opts, t0);
  if (!pre.ok) return pre.res;
  const { id, contract, cmdObs, gitState } = pre;

  const thresholds = loadThresholds(projectRoot);
  const budget = resolveSubagentBudgetProfile(thresholds, opts);
  const currentStub = buildNodeInterfaceStub(projectRoot, contract);
  const { fails, stubDiff, crossScopeAllowed, crossScopeFiles } = evaluateMicroGateFences(projectRoot, id, contract, currentStub, thresholds, gitState, opts);
  const { passed, unknown, passedObligations } = executeNodeObligations(projectRoot, id, contract, cmdObs, thresholds, fails);
  const exitCode = fails.length === 0 ? 0 : (unknown > 0 && fails.length === unknown ? 3 : 1);
  const verdict = exitCode === 0 ? 'PASS' : (exitCode === 1 ? 'FAIL' : 'UNKNOWN');
  const confession = hvBuildConfessionReport(opts.confession, `${id}|${currentStub.stubHash}|${exitCode}`);

  const receipt = {
    schema: 'donegate-node-receipt/v1', nodeId: id, title: contract.title || id, verdict,
    exitCode, passed, total: cmdObs.length, passedObligations,
    facadeMode: currentStub.facadeMode, exportedSymbolCount: currentStub.exportedSymbols.length,
    stubHash: currentStub.stubHash, stubChanged: Boolean(stubDiff.stubChanged), addedExports: stubDiff.addedExports || [],
    effectiveLines: currentStub.effectiveLines, baseRef: gitState.baseRef,
    touchedFiles: gitState.touchedFiles, committedFiles: gitState.committedFiles, uncommittedFiles: gitState.uncommittedFiles,
    crossScopeAllowed, crossScopeFiles,
    ...(confession ? { confession } : {}),
    sessionBudgetTokens: budget.totalSessionBudgetTokens, receiptBudgetTokens: budget.receiptBudgetTokens,
    durationMs: Date.now() - t0, ...(fails.length > 0 ? { fails } : {})
  };
  persistMicroGateReceipt(projectRoot, id, currentStub, receipt);

  const deltaFields = {
    exitCode, receipt, baseRef: gitState.baseRef,
    touchedFiles: gitState.touchedFiles, committedFiles: gitState.committedFiles, uncommittedFiles: gitState.uncommittedFiles
  };
  return nmgFormatCheckNodeOutput(id, receipt, deltaFields, cmdObs.length, fails, opts);
}
