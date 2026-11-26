// 判据执行与门 0/1/2/4 串联命令（check，<= 350 行聚焦子模块）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { frozenHashOf, materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { readAndVerifyChain, verifyFreezeImplementRun } from './chain.mjs';
import { evaluateGate0, evaluateGate1, evaluateGate2, loadThresholds } from './gates.mjs';
import { buildSanitizedEnv, checkCommandBans, runIsolationProbes } from './isolation.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { buildGate0ActionHint, buildGate2ActionHint, collectMaterialList, collectOrderedIncompleteContractGaps, gitAnchorInfo } from './cmd-lifecycle.mjs';

export function execRunPreFlightPlug(projectRoot, contract, sanitizedEnv) {
  const plugCmd = typeof contract?.execution?.preFlightPlug === 'string' ? contract.execution.preFlightPlug.trim() : '';
  if (!plugCmd) return { ok: true, ran: false };
  const bans = checkCommandBans(plugCmd);
  if (bans.length > 0) return { ok: false, exitCode: 2, code: 'PREFLIGHT_PLUG_BANNED', stderr: `preFlightPlug 触发禁令：${bans.join('；')}` };
  const r = spawnSync(plugCmd, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.error || r.status !== 0) {
    const detail = ((r.stderr || '') + '\n' + (r.stdout || '')).trim().slice(0, 600) || (r.error && r.error.message) || `exit=${r.status}`;
    return { ok: false, exitCode: 3, code: 'PREFLIGHT_PLUG_FAILED', stderr: `前置护栏 preFlightPlug 未通过（退 3）：${plugCmd}\n${detail}` };
  }
  return { ok: true, ran: true, command: plugCmd };
}

function execCollectTouchedFiles(projectRoot, baseRef) {
  if (!baseRef) return undefined;
  const r = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--name-only', `${baseRef}..HEAD`], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return undefined;
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
}

function execUniqueEvidenceDir(projectRoot, id, obId) {
  const base = join(projectRoot, '.donegate', 'evidence', id, obId);
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 18) + 'Z';
  let ts = stamp;
  let seq = 1;
  while (existsSync(join(base, ts))) {
    ts = `${stamp}-${seq++}`;
  }
  const evDir = join(base, ts);
  mkdirSync(evDir, { recursive: true });
  return { ts, evDir };
}

function execCheckEnvAndIsolation(projectRoot, id, contract, isExploreTrack, opts) {
  if (opts.explore && !isExploreTrack) {
    return { ok: false, res: { exitCode: 2, stderr: `拒绝降级：契约 ${id} 为正式交付契约（track=delivery），禁止用 --explore 跳过正式门禁` } };
  }
  const anchor = gitAnchorInfo(projectRoot);
  const isDirtyRun = Boolean(anchor.isGit && (anchor.isDirty || !anchor.head));
  if (!isExploreTrack && !opts.allowDirty && isDirtyRun) {
    return {
      ok: false,
      res: {
        exitCode: 3,
        stderr: '拒绝执行：工作区存在未提交改动或尚无提交（§8.2.2 脏树退 3，开发期调试可传 --allow-dirty）\n\n' +
          renderWorryBlock(projectRoot, {
            exitCode: 3, stage: 2, stageTitle: `「${contract.title || id}」检查前环境校验`,
            title: '工作区存在未提交改动，暂不计入正式验收',
            reason: '有未提交文件时跑出的结果无法锚定版本号',
            action: '先 git add/commit 提交干净树再重跑；调试可临时加 --allow-dirty'
          })
      }
    };
  }
  const isoRes = runIsolationProbes(projectRoot);
  if (!isoRes.ok) {
    return {
      ok: false,
      res: {
        exitCode: isoRes.exitCode,
        stderr: isoRes.reason + '\n\n' + renderWorryBlock(projectRoot, {
          exitCode: isoRes.exitCode, stage: 2, stageTitle: `「${contract.title || id}」隔离校验`,
          title: '执行隔离声明与环境不符（严重事故）',
          reason: isoRes.reason,
          action: '核对 .donegate/runner.json 中的隔离模式并恢复安全运行环境'
        })
      }
    };
  }
  return { ok: true, anchor, isDirtyRun, debugDirtyRun: Boolean((opts.allowDirty || isExploreTrack) && isDirtyRun), isoRes };
}

function execResolveAndAuditTargets(projectRoot, id, contract, opts) {
  const allObs = Array.isArray(contract.obligations) ? contract.obligations : [];
  let targets = opts.criterion ? allObs.filter((o) => o.id === opts.criterion) : allObs;
  const sampled = Boolean(opts.fastSample && !opts.criterion && targets.length > 3);
  if (sampled) targets = targets.slice(0, 3);
  if (targets.length === 0) return { ok: false, res: { exitCode: 3, stderr: '找不到可执行判据' } };
  for (const o of targets) {
    if (o.kind !== 'command') continue;
    const banHits = checkCommandBans(o.command);
    if (banHits.length > 0) {
      return {
        ok: false,
        res: {
          exitCode: 2,
          stderr: `判据 ${o.id} 触发 §四 禁令（退 2）：${banHits.join('；')}\n\n` +
            renderWorryBlock(projectRoot, {
              exitCode: 2, stage: 2, stageTitle: `「${contract.title || id}」命令安全核查`,
              title: `判据 ${o.id} 含禁用假绿写法（如 || true / 包装层吞码）`,
              reason: banHits.join('；'),
              action: '去掉吞错或包装层写法，改用直跑命令并重新锁定（contract freeze）'
            })
        }
      };
    }
  }
  return { ok: true, targets, sampled };
}

function execVerifyFreezeBinding(projectRoot, id, targets, anchor) {
  const chainChk = readAndVerifyChain(projectRoot);
  if (!chainChk.ok) return { exitCode: chainChk.exitCode || 2, stderr: chainChk.reason };
  if (!chainChk.entries.some((e) => e.kind === 'implement' && e.contractId === id)) return null;
  for (const tgt of targets) {
    const bindChk = verifyFreezeImplementRun(projectRoot, id, { head: anchor.head, criterionId: tgt?.id, criteriaHash: frozenHashOf(tgt) });
    if (!bindChk.ok) return { exitCode: bindChk.exitCode, stderr: `§8.2.2 冻结绑定未过 (${tgt?.id})：${bindChk.reason}` };
  }
  return null;
}

function execRunFormalGates(projectRoot, id, contract, targets, anchor, opts) {
  const g0 = evaluateGate0(projectRoot, id, collectOrderedIncompleteContractGaps(projectRoot));
  if (!g0.ok) {
    return {
      exitCode: 1,
      stderr: `门 0 起手段未过（退 1）：${g0.fails.join('；')}\n\n` + renderWorryBlock(projectRoot, {
        exitCode: 1, stage: 1, stageTitle: '立项与前置条件未齐', title: '门 0 起手校验未通过',
        reason: g0.fails.join('；'), action: buildGate0ActionHint(g0.fails)
      })
    };
  }
  const g1 = evaluateGate1(projectRoot);
  if (!g1.ok) {
    return {
      exitCode: g1.exitCode,
      stderr: `门 1 基线未过：${g1.reason}\n\n` + renderWorryBlock(projectRoot, {
        exitCode: g1.exitCode, stage: 2, stageTitle: '基线健康校验', title: '项目基线（冒烟命令）未通过',
        reason: g1.reason, action: '先修绿 INTENT.md 里的冒烟命令，再测新功能'
      })
    };
  }
  const g2 = evaluateGate2(projectRoot, contract, { baseRef: opts.base, heldOutDir: opts.heldOutDir, touchedFiles: execCollectTouchedFiles(projectRoot, opts.base) });
  if (!g2.ok) {
    return {
      exitCode: g2.exitCode,
      stderr: `门 2 判据段未过：${g2.fails.join('；')}\n\n` + renderWorryBlock(projectRoot, {
        exitCode: g2.exitCode, stage: 2, stageTitle: `「${contract.title || id}」验收标准校验`,
        title: '门 2 判据段校验未通过', reason: g2.fails.join('；'), action: buildGate2ActionHint(g2.fails, id)
      })
    };
  }
  return execVerifyFreezeBinding(projectRoot, id, targets, anchor);
}

function execRecordHumanCriterion(evDir, o, contract, startRaw, isolationNotice, opts) {
  const evidenceFiles = opts.humanEvidence ? String(opts.humanEvidence).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const reportObj = {
    exitCode: null, standard: o.expect?.standard || '',
    operatorVisualCheck: Boolean(contract.execution?.operatorVisualCheck),
    evidenceFiles, durationMs: 0, timedOut: false, isolationNotice, hashStart: sha256(startRaw)
  };
  const reportRaw = JSON.stringify(reportObj, null, 2);
  writeFileSync(join(evDir, 'report.json'), reportRaw);
  const endObj = { result: opts.humanPass ? 'pass' : 'unknown', hashReport: sha256(reportRaw), endedAt: new Date().toISOString() };
  writeFileSync(join(evDir, 'end.json'), JSON.stringify(endObj, null, 2));
  return { verdict: endObj.result, line: `${o.id} (human): ${endObj.result}`, compactError: null };
}

function execRunCommandCriterion(projectRoot, evDir, ts, id, o, startRaw, ctx) {
  const t0 = Date.now();
  const r = spawnSync(o.command, { cwd: projectRoot, shell: true, env: ctx.sanitizedEnv, encoding: 'utf8', timeout: (o.timeoutSec || ctx.thresholds.timeoutSec || 600) * 1000 });
  const durationMs = Date.now() - t0;
  const totalOutChars = String(r.stdout || '').length + String(r.stderr || '').length;
  const outputOverflow = totalOutChars > ctx.maxOutputChars;
  const timedOut = Boolean(r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT');
  const spawnFailed = Boolean(r.error && !timedOut) || typeof r.status !== 'number';
  const stdoutTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
  const stdoutMatched = o.expect?.stdoutMatches !== undefined ? stdoutTrim === o.expect.stdoutMatches : null;
  const reportObj = {
    exitCode: r.status, stdout: stdoutTrim.slice(0, 4096), ...(stdoutMatched !== null ? { stdoutMatched } : {}),
    stdoutSha256: sha256(r.stdout), stderrSha256: sha256(r.stderr), outputChars: totalOutChars, outputOverflow,
    durationMs, timedOut, isDirty: ctx.anchor.isDirty, debugDirtyRun: ctx.debugDirtyRun, skipGates: ctx.skipGatesRun,
    track: ctx.track, gate4Eligible: ctx.gate4Eligible, isolationNotice: ctx.isolationNotice, hashStart: sha256(startRaw)
  };
  const reportRaw = JSON.stringify(reportObj, null, 2);
  writeFileSync(join(evDir, 'report.json'), reportRaw);
  let verdict = 'pass';
  if (timedOut || spawnFailed || outputOverflow) verdict = 'unknown';
  else if (r.status !== o.expect?.exitCode || stdoutMatched === false) verdict = 'fail';
  writeFileSync(join(evDir, 'end.json'), JSON.stringify({ result: verdict, hashReport: sha256(reportRaw), endedAt: new Date().toISOString() }, null, 2));
  let compactError = null;
  if (ctx.opts.compact) {
    const logRel = `.donegate/evidence/${id}/${o.id}/${ts}/run.log`;
    writeFileSync(join(evDir, 'run.log'), `${r.stdout || ''}\n${r.stderr || ''}`.trim() + '\n', 'utf8');
    if (verdict !== 'pass') compactError = `ERROR: ${o.id} exit=${r.status} verdict=${verdict} log=${logRel}`;
  }
  return { verdict, line: `${o.id}: exit=${r.status} verdict=${verdict} (${durationMs}ms)`, compactError };
}

function execFormatCheckResponse(projectRoot, id, contract, opts, summary) {
  const { bad, unknown, total, sampled, lines, compactErrors } = summary;
  const exitCode = bad > 0 ? 1 : (unknown > 0 ? 3 : 0);
  const passCnt = total - bad - unknown;
  if (opts.compact) {
    const verdictMap = { 0: 'PASS', 1: 'FAIL', 2: 'ERROR', 3: 'UNKNOWN' };
    const resultMap = { 0: 'PASS', 1: 'FAIL', 2: '事故', 3: '无法判断' };
    const sampleNote = sampled ? ' (fast-sample)' : '';
    const compactOut = [
      `[check:${id}] ${verdictMap[exitCode] || 'UNKNOWN'} ${passCnt}/${total}${sampleNote}`,
      ...compactErrors.slice(0, 16),
      ...lines.slice(2, Math.max(2, 18 - compactErrors.length)),
      `RESULT: ${resultMap[exitCode] || '无法判断'}`
    ].slice(0, 20);
    return { exitCode, stdout: compactOut.join('\n') };
  }
  const title = contract.title || id;
  const hl = opts.allowDirty
    ? '⚠️ 脏工作区调试运行（不计入通过进度） · 总进度 {{PCT}}'
    : (exitCode === 0 ? `✅ 「${title}」${passCnt}/${total} 项检查通过 · 总进度 {{PCT}}` : `❌ 「${title}」检查未全过（通过 ${passCnt}/${total}，失败 ${bad}） · 总进度 {{PCT}}`);
  const resultTag = exitCode === 0 ? 'PASS' : (exitCode === 1 ? 'FAIL' : '无法判断');
  return {
    exitCode,
    stdout: lines.join('\n') + `\nRESULT: ${resultTag}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
  };
}

function execRunAllTargets(projectRoot, id, contract, targets, materials, isoRes, runCtx) {
  const materialFingerprint = materialFingerprintOf(materials);
  const isExplore = runCtx.track === 'explore';
  const lines = [
    `隔离声明：${isoRes.isolationNotice}`,
    ...(isExplore ? ['🔬 探索态试跑（track=explore · 允许高频演化 Schema/快照，永不计入交付通过；收敛后请执行 contract promote）'] : []),
    ...(runCtx.debugDirtyRun && !isExplore ? ['⚠ 调试运行（--allow-dirty）：工作区未干净提交，本次证据禁进门 4/复核包/通过数'] : [])
  ];
  let bad = 0, unknown = 0;
  const compactErrors = [];
  for (const o of targets) {
    const { ts, evDir } = execUniqueEvidenceDir(projectRoot, id, o.id);
    const startRaw = JSON.stringify({
      contract: id, criterion: o.id, command: o.command || null, materials, materialFingerprint,
      run: { head: runCtx.anchor.head, criteriaHash: frozenHashOf(o) }, worktreeHash: runCtx.anchor.worktreeHash,
      isDirty: runCtx.anchor.isDirty, debugDirtyRun: runCtx.debugDirtyRun, skipGates: runCtx.skipGatesRun,
      track: runCtx.track, gate4Eligible: runCtx.gate4Eligible, isolation: isoRes.cfg.isolation,
      isolationNotice: isoRes.isolationNotice, startedAt: new Date().toISOString(), runnerVersion: 'donegate/4.0'
    }, null, 2);
    writeFileSync(join(evDir, 'start.json'), startRaw);
    const outcome = o.kind === 'human'
      ? execRecordHumanCriterion(evDir, o, contract, startRaw, isoRes.isolationNotice, runCtx.opts)
      : execRunCommandCriterion(projectRoot, evDir, ts, id, o, startRaw, runCtx);
    if (outcome.verdict === 'fail') bad++;
    else if (outcome.verdict === 'unknown') unknown++;
    if (outcome.compactError) compactErrors.push(outcome.compactError);
    lines.push(outcome.line);
  }
  return { bad, unknown, lines, compactErrors };
}

export function cmdCheck(projectRoot, opts) {
  const id = opts.id;
  if (!id) return { exitCode: 3, stderr: '缺少契约标识' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value, isExploreTrack = contract.track === 'explore';
  const envChk = execCheckEnvAndIsolation(projectRoot, id, contract, isExploreTrack, opts);
  if (!envChk.ok) return envChk.res;
  const tgtChk = execResolveAndAuditTargets(projectRoot, id, contract, opts);
  if (!tgtChk.ok) return tgtChk.res;
  const { anchor, isDirtyRun, debugDirtyRun, isoRes } = envChk;
  const { targets, sampled } = tgtChk;
  if (!opts.skipGates && !isExploreTrack) {
    const gateErr = execRunFormalGates(projectRoot, id, contract, targets, anchor, opts);
    if (gateErr) return gateErr;
  }
  const thresholds = loadThresholds(projectRoot);
  const sanitizedEnv = buildSanitizedEnv(process.env, {}, { cwd: projectRoot, envPassthrough: contract.execution?.envPassthrough });
  const plugRes = execRunPreFlightPlug(projectRoot, contract, sanitizedEnv);
  if (!plugRes.ok) return { exitCode: plugRes.exitCode, code: plugRes.code, stderr: plugRes.stderr };
  const materials = collectMaterialList(projectRoot, contract);
  const skipGatesRun = Boolean(opts.skipGates);
  const runCtx = {
    sanitizedEnv, thresholds, maxOutputChars: thresholds.maxOutputChars || 262144, anchor,
    debugDirtyRun, skipGatesRun, track: isExploreTrack ? 'explore' : 'delivery',
    gate4Eligible: !isDirtyRun && !isExploreTrack && !skipGatesRun, isolationNotice: isoRes.isolationNotice, opts
  };
  const { bad, unknown, lines, compactErrors } = execRunAllTargets(projectRoot, id, contract, targets, materials, isoRes, runCtx);
  return execFormatCheckResponse(projectRoot, id, contract, opts, { bad, unknown, total: targets.length, sampled, lines, compactErrors });
}
