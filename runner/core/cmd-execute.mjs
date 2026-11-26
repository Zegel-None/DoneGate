// 判据执行与门 0/1/2/4 串联命令（check，<= 350 行聚焦子模块）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { frozenHashOf, materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { readAndVerifyChain, verifyFreezeImplementRun } from './chain.mjs';
import { evaluateGate0, evaluateGate1, evaluateGate2, loadThresholds } from './gates.mjs';
import { buildSanitizedEnv, checkCommandBans, runIsolationProbes } from './isolation.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { buildGate0ActionHint, buildGate2ActionHint, collectMaterialList, collectOrderedIncompleteContractGaps, gitAnchorInfo } from './cmd-lifecycle.mjs';

export function cmdCheck(projectRoot, opts) {
  const id = opts.id;
  if (!id) return { exitCode: 3, stderr: '缺少契约标识' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;

  const anchor = gitAnchorInfo(projectRoot);
  const isDirtyRun = Boolean(anchor.isGit && (anchor.isDirty || !anchor.head));
  if (!opts.allowDirty && isDirtyRun) {
    return {
      exitCode: 3,
      stderr: '拒绝执行：工作区存在未提交改动或尚无提交（§8.2.2 脏树退 3，开发期调试可传 --allow-dirty）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 3, stage: 2, stageTitle: `「${contract.title || id}」检查前环境校验`,
          title: '工作区存在未提交改动，暂不计入正式验收',
          reason: '有未提交文件时跑出的结果无法锚定版本号',
          action: '先 git add/commit 提交干净树再重跑；调试可临时加 --allow-dirty'
        })
    };
  }
  const debugDirtyRun = Boolean(opts.allowDirty && isDirtyRun);

  // §四：执行隔离声明与门 4 双探针验证（虚假隔离声称退 2）
  const isoRes = runIsolationProbes(projectRoot);
  if (!isoRes.ok) {
    return {
      exitCode: isoRes.exitCode,
      stderr: isoRes.reason + '\n\n' + renderWorryBlock(projectRoot, {
        exitCode: isoRes.exitCode, stage: 2, stageTitle: `「${contract.title || id}」隔离校验`,
        title: '执行隔离声明与环境不符（严重事故）',
        reason: isoRes.reason,
        action: '核对 .donegate/runner.json 中的隔离模式并恢复安全运行环境'
      })
    };
  }

  const allObs = Array.isArray(contract.obligations) ? contract.obligations : [];
  let targets = opts.criterion ? allObs.filter((o) => o.id === opts.criterion) : allObs;
  const sampled = Boolean(opts.fastSample && !opts.criterion && targets.length > 3);
  if (sampled) targets = targets.slice(0, 3);
  if (targets.length === 0) return { exitCode: 3, stderr: '找不到可执行判据' };

  // §四 三条禁令检查（吞失败 / 包装层 / 改写契约）
  for (const o of targets) {
    if (o.kind !== 'command') continue;
    const banHits = checkCommandBans(o.command);
    if (banHits.length > 0) {
      return {
        exitCode: 2,
        stderr: `判据 ${o.id} 触发 §四 禁令（退 2）：${banHits.join('；')}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 2, stage: 2, stageTitle: `「${contract.title || id}」命令安全核查`,
            title: `判据 ${o.id} 含禁用假绿写法（如 || true / 包装层吞码）`,
            reason: banHits.join('；'),
            action: '去掉吞错或包装层写法，改用直跑命令并重新锁定（contract freeze）'
          })
      };
    }
  }

  // 门 0 → 门 1 → 门 2 → §8.2.2 冻结绑定串联校验（可通过 --skip-gates 显式跳过）
  if (!opts.skipGates) {
    const gapsList = collectOrderedIncompleteContractGaps(projectRoot);
    const g0 = evaluateGate0(projectRoot, id, gapsList);
    if (!g0.ok) {
      return {
        exitCode: 1,
        stderr: `门 0 起手段未过（退 1）：${g0.fails.join('；')}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 1, stage: 1, stageTitle: '立项与前置条件未齐',
            title: '门 0 起手校验未通过',
            reason: g0.fails.join('；'),
            action: buildGate0ActionHint(g0.fails)
          })
      };
    }
    const g1 = evaluateGate1(projectRoot);
    if (!g1.ok) {
      return {
        exitCode: g1.exitCode,
        stderr: `门 1 基线未过：${g1.reason}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: g1.exitCode, stage: 2, stageTitle: '基线健康校验',
            title: '项目基线（冒烟命令）未通过',
            reason: g1.reason,
            action: '先修绿 INTENT.md 里的冒烟命令，再测新功能'
          })
      };
    }
    const g2 = evaluateGate2(projectRoot, contract, { baseRef: opts.base, heldOutDir: opts.heldOutDir });
    if (!g2.ok) {
      return {
        exitCode: g2.exitCode,
        stderr: `门 2 判据段未过：${g2.fails.join('；')}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: g2.exitCode, stage: 2, stageTitle: `「${contract.title || id}」验收标准校验`,
            title: '门 2 判据段校验未通过',
            reason: g2.fails.join('；'),
            action: buildGate2ActionHint(g2.fails, id)
          })
      };
    }
    const chainChk = readAndVerifyChain(projectRoot);
    if (!chainChk.ok) return { exitCode: chainChk.exitCode || 2, stderr: chainChk.reason };
    if (chainChk.entries.some((e) => e.kind === 'implement' && e.contractId === id)) {
      const bindChk = verifyFreezeImplementRun(projectRoot, id, {
        head: anchor.head,
        criterionId: targets[0]?.id,
        criteriaHash: frozenHashOf(targets[0])
      });
      if (!bindChk.ok) return { exitCode: bindChk.exitCode, stderr: `§8.2.2 冻结绑定未过：${bindChk.reason}` };
    }
  }

  const thresholds = loadThresholds(projectRoot);
  const maxOutputChars = thresholds.maxOutputChars || 262144;
  const sanitizedEnv = buildSanitizedEnv();
  const materials = collectMaterialList(projectRoot, contract);
  const lines = [
    `隔离声明：${isoRes.isolationNotice}`,
    ...(debugDirtyRun ? ['⚠ 调试运行（--allow-dirty）：工作区未干净提交，本次证据禁进门 4/复核包/通过数'] : [])
  ];
  let bad = 0, unknown = 0;
  const compactErrors = [];

  for (const o of targets) {
    const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const evDir = join(projectRoot, '.donegate', 'evidence', id, o.id, ts);
    mkdirSync(evDir, { recursive: true });
    const startObj = {
      contract: id,
      criterion: o.id,
      command: o.command || null,
      materials,
      materialFingerprint: materialFingerprintOf(materials),
      run: { head: anchor.head, criteriaHash: frozenHashOf(o) },
      worktreeHash: anchor.worktreeHash,
      isDirty: anchor.isDirty,
      debugDirtyRun,
      gate4Eligible: !isDirtyRun,
      isolation: isoRes.cfg.isolation,
      isolationNotice: isoRes.isolationNotice,
      startedAt: new Date().toISOString(),
      runnerVersion: 'donegate/4.0'
    };
    const startRaw = JSON.stringify(startObj, null, 2);
    writeFileSync(join(evDir, 'start.json'), startRaw);

    if (o.kind === 'human') {
      const reportObj = {
        exitCode: null,
        standard: o.expect?.standard || '',
        durationMs: 0,
        timedOut: false,
        isolationNotice: isoRes.isolationNotice,
        hashStart: sha256(startRaw)
      };
      const reportRaw = JSON.stringify(reportObj, null, 2);
      writeFileSync(join(evDir, 'report.json'), reportRaw);
      const endObj = { result: opts.humanPass ? 'pass' : 'unknown', hashReport: sha256(reportRaw), endedAt: new Date().toISOString() };
      writeFileSync(join(evDir, 'end.json'), JSON.stringify(endObj, null, 2));
      if (!opts.humanPass) unknown++;
      lines.push(`${o.id} (human): ${endObj.result}`);
      continue;
    }

    const t0 = Date.now();
    const r = spawnSync(o.command, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: (o.timeoutSec || thresholds.timeoutSec || 600) * 1000 });
    const durationMs = Date.now() - t0;
    const totalOutChars = String(r.stdout || '').length + String(r.stderr || '').length;
    const outputOverflow = totalOutChars > maxOutputChars;
    const timedOut = Boolean(r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'));
    const spawnFailed = Boolean(r.error && !timedOut) || typeof r.status !== 'number';
    const stdoutTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    const reportObj = {
      exitCode: r.status,
      stdout: stdoutTrim.slice(0, 4096),
      stdoutSha256: sha256(r.stdout),
      stderrSha256: sha256(r.stderr),
      outputChars: totalOutChars,
      outputOverflow,
      durationMs,
      timedOut,
      isDirty: anchor.isDirty,
      debugDirtyRun,
      gate4Eligible: !isDirtyRun,
      isolationNotice: isoRes.isolationNotice,
      hashStart: sha256(startRaw)
    };
    const reportRaw = JSON.stringify(reportObj, null, 2);
    writeFileSync(join(evDir, 'report.json'), reportRaw);

    let verdict = 'pass';
    if (timedOut || spawnFailed || outputOverflow) { verdict = 'unknown'; unknown++; }
    else if (r.status !== o.expect?.exitCode) { verdict = 'fail'; bad++; }
    else if (o.expect?.stdoutMatches !== undefined && stdoutTrim !== o.expect.stdoutMatches) { verdict = 'fail'; bad++; }

    const endObj = { result: verdict, hashReport: sha256(reportRaw), endedAt: new Date().toISOString() };
    writeFileSync(join(evDir, 'end.json'), JSON.stringify(endObj, null, 2));
    if (opts.compact) {
      const logRel = `.donegate/evidence/${id}/${o.id}/${ts}/run.log`;
      writeFileSync(join(evDir, 'run.log'), `${r.stdout || ''}\n${r.stderr || ''}`.trim() + '\n', 'utf8');
      if (verdict !== 'pass') {
        compactErrors.push(`ERROR: ${o.id} exit=${r.status} verdict=${verdict} log=${logRel}`);
      }
    }
    lines.push(`${o.id}: exit=${r.status} verdict=${verdict} (${durationMs}ms)`);
  }

  const exitCode = bad > 0 ? 1 : unknown > 0 ? 3 : 0;
  const passCnt = targets.length - bad - unknown;
  if (opts.compact) {
    const verdictMap = { 0: 'PASS', 1: 'FAIL', 2: 'ERROR', 3: 'UNKNOWN' };
    const resultMap = { 0: 'PASS', 1: 'FAIL', 2: '事故', 3: '无法判断' };
    const sampleNote = sampled ? ' (fast-sample)' : '';
    const compactOut = [
      `[check:${id}] ${verdictMap[exitCode] || 'UNKNOWN'} ${passCnt}/${targets.length}${sampleNote}`,
      ...compactErrors.slice(0, 16),
      ...lines.slice(2, Math.max(2, 18 - compactErrors.length)),
      `RESULT: ${resultMap[exitCode] || '无法判断'}`
    ].slice(0, 20);
    return { exitCode, stdout: compactOut.join('\n') };
  }
  const hl = opts.allowDirty
    ? '⚠️ 脏工作区调试运行（不计入通过进度） · 总进度 {{PCT}}'
    : (exitCode === 0
      ? `✅ 「${contract.title || id}」${passCnt}/${targets.length} 项检查通过 · 总进度 {{PCT}}`
      : `❌ 「${contract.title || id}」检查未全过（通过 ${passCnt}/${targets.length}，失败 ${bad}） · 总进度 {{PCT}}`);
  return {
    exitCode,
    stdout: lines.join('\n') + `\nRESULT: ${exitCode === 0 ? 'PASS' : exitCode === 1 ? 'FAIL' : '无法判断'}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
  };
}
