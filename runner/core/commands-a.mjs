// 十二条命令 · 前六条（init / contract new / contract freeze / check / teeth / retire）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { frozenHashOf, materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { appendChainEntry, readAndVerifyChain, verifyFreezeImplementRun } from './chain.mjs';
import { DEFAULT_THRESHOLDS, computeProjectStatus, evaluateGate0, evaluateGate1, evaluateGate2, loadThresholds } from './gates.mjs';
import { buildSanitizedEnv, checkCommandBans, runIsolationProbes } from './isolation.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';

function gitAnchorInfo(projectRoot) {
  const inside = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') {
    return { isGit: false, head: null, worktreeHash: null, isDirty: null };
  }
  const h = spawnSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const wt = spawnSync('git', ['-C', projectRoot, 'write-tree'], { encoding: 'utf8' });
  const st = spawnSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  return {
    isGit: true,
    head: h.status === 0 ? h.stdout.trim() : null,
    worktreeHash: wt.status === 0 ? wt.stdout.trim() : null,
    isDirty: st.status === 0 ? st.stdout.trim().length > 0 : null
  };
}

function collectMaterialList(projectRoot, contract) {
  const list = [];
  const scopes = Array.isArray(contract.scope) ? contract.scope : [];
  for (const s of scopes) {
    const abs = resolve(projectRoot, s);
    if (!existsSync(abs)) continue;
    try {
      const buf = readFileSync(abs);
      list.push({ path: s.replace(/\\/g, '/'), sha256: sha256(buf) });
    } catch {
      // directory scope: walk files inside
      try {
        for (const e of readdirSync(abs, { withFileTypes: true, recursive: true })) {
          if (!e.isFile()) continue;
          const full = join(e.parentPath || abs, e.name);
          const rel = relative(projectRoot, full).replace(/\\/g, '/');
          list.push({ path: rel, sha256: sha256(readFileSync(full)) });
        }
      } catch { /* skip unreadable */ }
    }
  }
  return list;
}

export function cmdInit(projectRoot) {
  if (existsSync(join(projectRoot, 'INTENT.md')) || existsSync(join(projectRoot, 'contracts'))) {
    return { exitCode: 3, stdout: '拒绝初始化：INTENT.md 或 contracts/ 已存在（§八 退 3，不覆盖）' };
  }
  mkdirSync(join(projectRoot, 'contracts'), { recursive: true });
  mkdirSync(join(projectRoot, 'functions'), { recursive: true });
  mkdirSync(join(projectRoot, 'decisions'), { recursive: true });
  mkdirSync(join(projectRoot, '.donegate'), { recursive: true });

  writeFileSync(join(projectRoot, 'INTENT.md'), [
    '# 项目意图', '',
    '## 为什么做', '（请填写一句话说明为什么做）', '',
    '## 服务谁', '（请填写具体的人或角色，不写「用户」）', '',
    '## 什么算成功', '- （请填写至少一条可外部观察的成功判据）', '',
    '## 明确不做什么', '- （请填写至少一条明确不做的边界）', '',
    '冒烟命令：node -e "process.exit(0)"', ''
  ].join('\n'));
  writeFileSync(join(projectRoot, 'CONSTRAINTS.md'), [
    '# 约束', '',
    '必须 子进程直读退出码，不经包管理器包装。',
    '不许 改判据或测试文件来凑绿。', ''
  ].join('\n'));
  writeFileSync(join(projectRoot, 'thresholds.json'), JSON.stringify(DEFAULT_THRESHOLDS, null, 2) + '\n');
  writeFileSync(join(projectRoot, '.donegate', 'chain.jsonl'), '');
  writeFileSync(join(projectRoot, '.donegate', 'escapes.jsonl'), '');

  return {
    exitCode: 0,
    stdout: '已初始化：\n  INTENT.md\n  CONSTRAINTS.md\n  thresholds.json\n  contracts/\n  functions/\n  decisions/\n  .donegate/chain.jsonl\n  .donegate/escapes.jsonl\n\n' +
      renderProgressBlock(projectRoot, { headline: '✅ [1-1] 项目基线已初始化 · 总进度 {{PCT}}' })
  };
}

export function cmdContractNew(projectRoot, opts) {
  const id = opts.id;
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    return { exitCode: 1, stderr: '契约标识不合规（必须为稳定小写 ^[a-z0-9-]+$）：' + id };
  }
  const cDir = join(projectRoot, 'contracts', id);
  const cPath = join(cDir, 'contract.json');
  if (existsSync(cPath)) {
    return { exitCode: 1, stderr: '契约已存在，禁止重复创建：' + id };
  }
  mkdirSync(cDir, { recursive: true });
  const contractObj = {
    id,
    title: opts.title || id,
    why: opts.why || '待补充：三行以内说明为什么需要本契约。',
    scope: opts.scope ? opts.scope.split(',').map((s) => s.trim()).filter(Boolean) : [],
    owner: opts.owner || '业主',
    dependsOn: opts.dependsOn ? opts.dependsOn.split(',').map((s) => s.trim()).filter(Boolean) : [],
    provisional: true,
    obligations: []
  };
  writeFileSync(cPath, JSON.stringify(contractObj, null, 2) + '\n');
  const prog = existsSync(join(projectRoot, 'INTENT.md'))
    ? '\n\n' + renderProgressBlock(projectRoot, { focusContractId: id, headline: `✅ [1-2] 已建模块「${contractObj.title}」 · 总进度 {{PCT}}` })
    : '';
  return { exitCode: 0, stdout: `契约已创建：contracts/${id}/contract.json（provisional=true）${prog}`, path: cPath };
}

export function cmdContractFreeze(projectRoot, opts) {
  const id = opts.id;
  const by = opts.by;
  if (!id) return { exitCode: 1, stderr: '缺少契约标识' };
  if (!by || !by.trim()) return { exitCode: 1, stderr: '缺少签字人 --by' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  const obs = Array.isArray(contract.obligations) ? contract.obligations : [];
  if (obs.length === 0) return { exitCode: 1, stderr: '契约没有 obligations，无法冻结' };

  if (opts.signoff) {
    if (!opts.attest || !opts.attest.trim()) {
      return { exitCode: 1, stderr: '签收 (--signoff) 必须附 --attest 口头复述内容' };
    }
    const status = computeProjectStatus(projectRoot);
    if (!status.chainRes.ok) return { exitCode: status.chainRes.exitCode || 2, stderr: status.chainRes.reason };
    const cSum = status.contractSummaries.find((x) => x.id === id);
    if (!cSum || cSum.state !== '通过') {
      return { exitCode: 1, stderr: `契约 ${id} 当前状态为 ${cSum ? cSum.state : '未知'}，非「通过」不可签收` };
    }
    const notA1 = cSum.obligations.filter((o) => o.required && o.kind === 'command' && o.subclass !== 'A1');
    if (notA1.length > 0) {
      return { exitCode: 1, stderr: `契约 ${id} 仍有非「算数(A1)」判据：${notA1.map((x) => x.id + '=' + x.subclassLabel).join('、')}` };
    }
    const verifyOk = status.chainRes.entries.filter((e) => e.kind === 'verify-result' && e.contractId === id).pop();
    if (!verifyOk || verifyOk.result !== 'pass') {
      return { exitCode: 1, stderr: `契约 ${id} 尚未通过门 5 verify apply 复核` };
    }
    const implEntry = status.chainRes.entries.filter((e) => e.kind === 'implement' && e.contractId === id).pop();
    const materials = collectMaterialList(projectRoot, contract);
    let signoffDurationSec = null;
    let speedWarn = '';
    if (opts.openedAt) {
      signoffDurationSec = Math.max(0, Math.round((Date.now() - Date.parse(opts.openedAt)) / 1000));
      const minSec = (status.thresholds.minSignoffSecPerCriterion || 20) * obs.length;
      if (Number.isFinite(signoffDurationSec) && signoffDurationSec < minSec) {
        speedWarn = `\n⚠ 签字可能在走过场（总耗时 ${signoffDurationSec}s < ${minSec}s）`;
      }
    }
    const app = appendChainEntry(projectRoot, {
      kind: 'signoff',
      contractId: id,
      signedBy: by,
      attestation: opts.attest.trim(),
      signoffDurationSec,
      implementSeq: implEntry ? implEntry.seq : null,
      packageHash: verifyOk.packageHash || null,
      materialFingerprint: materialFingerprintOf(materials)
    });
    if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
    return {
      exitCode: 0,
      stdout: `契约 ${id}：通关（已签收，链序号 seq=${app.entry.seq}）${speedWarn}\n\n` +
        renderProgressBlock(projectRoot, { focusContractId: id, headline: `🏆 「${contract.title || id}」已签收通关 · 总进度 {{PCT}}` })
    };
  }

  // 失效链 A：单轮新增判据上限（默认 3 条，超限须 --force-batch）
  const thresholds = loadThresholds(projectRoot);
  const chainNow = readAndVerifyChain(projectRoot);
  const prevFreeze = chainNow.ok ? chainNow.entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop() : null;
  if (prevFreeze && prevFreeze.criteriaHashes && !opts.forceBatch) {
    const prevIds = new Set(Object.keys(prevFreeze.criteriaHashes));
    const addedCount = obs.filter((o) => o && !prevIds.has(o.id)).length;
    if (addedCount > (thresholds.maxNewCriteriaPerRound || 3)) {
      return { exitCode: 1, stderr: `链 A 单轮新增判据 ${addedCount} 条超过上限 ${thresholds.maxNewCriteriaPerRound || 3}（请分轮或加 --force-batch）` };
    }
  }

  for (const o of obs) {
    if (!o || !o.id || !o.kind || !o.expect) {
      return { exitCode: 1, stderr: `判据 ${o && o.id ? o.id : '?'} 缺少 kind 或 expect，禁止冻结` };
    }
    if (o.kind === 'command' && (!o.command || typeof o.command !== 'string')) {
      return { exitCode: 1, stderr: `command 判据 ${o.id} 缺少 command` };
    }
  }
  const nowIso = new Date().toISOString();
  const criteriaHashes = {};
  for (const o of obs) {
    o.frozenAt = nowIso;
    const h = frozenHashOf(o);
    o.frozenHash = h;
    o.signedBy = by.trim();
    criteriaHashes[o.id] = h;
  }
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  const anchor = gitAnchorInfo(projectRoot);
  const materials = collectMaterialList(projectRoot, contract);
  const preExistingCode = materials.map((m) => m.path).filter((p) => /\.(mjs|cjs|js|ts|tsx|jsx|py|go)$/i.test(p));
  const legacyNotice = preExistingCode.length > 0 && !opts.legacy
    ? `\n⚠ 注意：冻结前作用域已存在 ${preExistingCode.length} 个源码文件（${preExistingCode.slice(0, 3).join(', ')}）；若非存量迁移请加 --legacy 留痕`
    : '';
  const app = appendChainEntry(projectRoot, {
    kind: 'freeze',
    contractId: id,
    signedBy: by.trim(),
    freezeCommit: anchor.head,
    legacyMigration: Boolean(opts.legacy),
    preExistingCodeCount: preExistingCode.length,
    criteriaHashes,
    materialFingerprint: materialFingerprintOf(materials)
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return {
    exitCode: 0,
    stdout: `冻结 ${obs.length} 条（seq=${app.entry.seq}）：\n` + obs.map((o) => `  ${o.id}  frozenHash=${o.frozenHash.slice(0, 12)}`).join('\n') + legacyNotice + '\n\n' +
      renderProgressBlock(projectRoot, { focusContractId: id, headline: `🔒 「${contract.title || id}」${obs.length} 项验收标准已锁定 · 总进度 {{PCT}}` })
  };
}

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
  const targets = opts.criterion ? allObs.filter((o) => o.id === opts.criterion) : allObs;
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
    const g0 = evaluateGate0(projectRoot, id);
    if (!g0.ok) {
      return {
        exitCode: 1,
        stderr: `门 0 起手段未过（退 1）：${g0.fails.join('；')}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 1, stage: 1, stageTitle: '立项与前置条件未齐',
            title: '门 0 起手校验未通过',
            reason: g0.fails.join('；'),
            action: '补齐 INTENT.md 四节与 CONSTRAINTS.md 约束条文后再试'
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
    const g2 = evaluateGate2(projectRoot, contract);
    if (!g2.ok) {
      return {
        exitCode: g2.exitCode,
        stderr: `门 2 判据段未过：${g2.fails.join('；')}\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: g2.exitCode, stage: 2, stageTitle: `「${contract.title || id}」验收标准校验`,
            title: '验收标准未锁定或内容已被改动',
            reason: g2.fails.join('；'),
            action: '执行 contract freeze 重新签字锁定判据'
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
    lines.push(`${o.id}: exit=${r.status} verdict=${verdict} (${durationMs}ms)`);
  }

  const exitCode = bad > 0 ? 1 : unknown > 0 ? 3 : 0;
  const passCnt = targets.length - bad - unknown;
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

export function cmdTeeth(projectRoot, opts) {
  const { id, criterionId, tier = 'A' } = opts;
  if (!id || !criterionId) return { exitCode: 3, stderr: '用法：teeth <契约id> <判据id> [--tier A|B]' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  const ob = (contract.obligations || []).find((o) => o.id === criterionId);
  if (!ob) return { exitCode: 3, stderr: `契约 ${id} 中找不到判据 ${criterionId}` };

  if (tier === 'B') {
    const claimPath = resolve(projectRoot, opts.claim || '.donegate/adapters/stryker/claim.json');
    const decl = verifyClaimInMemory(claimPath, projectRoot, { skipContractLookup: true });
    if (decl.exitCode !== 0) return { exitCode: decl.exitCode, stderr: 'Stryker 声明核验失败：' + decl.reason };
    const obsArt = decl.claim.artifacts.find((a) => a.kind === 'stryker-observation');
    if (!obsArt) return { exitCode: 3, stderr: 'claim.json 缺少 stryker-observation 产物' };
    const obs = JSON.parse(decl.memFiles.get(obsArt.path).toString('utf8'));
    const cnt = obs.countsByStatus || {};
    let result = 'killed';
    if (cnt.Pending > 0 || cnt.Ignored > 0) result = cnt.Pending > 0 ? 'pending' : 'ignored';
    else if (cnt.Survived > 0) result = 'survived';
    else if (cnt.NoCoverage > 0) result = 'no-coverage';
    else if (cnt.Timeout > 0) result = 'timeout';
    else if (cnt.CompileError > 0) result = 'compile-error';
    else if (cnt.RuntimeError > 0) result = 'runtime-error';
    else if (obs.totalMutants === 0 || cnt.Killed !== obs.totalMutants) result = 'survived';

    ob.teeth = { at: new Date().toISOString().slice(0, 10), tier: 'B', result };
    writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
    const exitCode = result === 'killed' ? 0 : (result === 'pending' ? 3 : 1);
    const hl = exitCode === 0
      ? `✅ [3-1] 「${ob.claim || criterionId}」变异验证通过（非假绿） · 总进度 {{PCT}}`
      : `❌ [3-1] 「${ob.claim || criterionId}」变异验证未通过（${result}）`;
    return { exitCode, stdout: `teeth (tier B): ${id}/${criterionId} -> ${result}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl }) };
  }

  // Tier A: breakPatch + 还原哈希校验 + 恢复后绿灯验证
  if (!ob.breakPatch || !ob.breakPatch.file || ob.breakPatch.from === undefined || ob.breakPatch.to === undefined) {
    return {
      exitCode: 3,
      stderr: `判据 ${criterionId} 缺少 breakPatch { file, from, to }（请先在 contract.json 补齐 breakPatch 并重新执行 contract freeze）\n\n` +
        renderWorryBlock(projectRoot, {
          exitCode: 3, stage: 3, stageTitle: '防假绿验证（变异实验）',
          title: `缺少改坏补丁配置（${criterionId}）`,
          reason: '未配置 breakPatch，无法自动演示「改坏代码后测试能否抓住」',
          action: '在 contract.json 该判据下补齐 breakPatch 后重新 contract freeze'
        })
    };
  }
  const targetFile = resolve(projectRoot, ob.breakPatch.file);
  if (!existsSync(targetFile)) return { exitCode: 3, stderr: 'breakPatch 目标文件不存在：' + ob.breakPatch.file };
  const origBuf = readFileSync(targetFile);
  const origHash = sha256(origBuf);
  const origText = origBuf.toString('utf8');
  if (!origText.includes(ob.breakPatch.from)) {
    return { exitCode: 3, stderr: 'breakPatch.from 在目标文件中未命中' };
  }

  const mutatedText = origText.replace(ob.breakPatch.from, ob.breakPatch.to);
  let mutantOutcome;
  try {
    writeFileSync(targetFile, mutatedText, 'utf8');
    const rMut = spawnSync(ob.command, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: (ob.timeoutSec || 600) * 1000 });
    if (rMut.signal === 'SIGTERM') mutantOutcome = 'timeout';
    else if (rMut.status !== ob.expect?.exitCode) mutantOutcome = 'killed';
    else mutantOutcome = 'survived';
  } finally {
    writeFileSync(targetFile, origBuf);
  }

  // 第 4 步：还原后校验哈希（不一致必须退 2！§6.2.1）
  const restoredHash = sha256(readFileSync(targetFile));
  if (restoredHash !== origHash) {
    ob.teeth = { at: new Date().toISOString().slice(0, 10), tier: 'A', result: 'restore-failed' };
    writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
    return {
      exitCode: 2,
      stderr: `事故：还原后哈希不一致 (${restoredHash} ≠ ${origHash})，退 2\n\n` +
        renderWorryBlock(projectRoot, {
          exitCode: 2, stage: 3, stageTitle: '防假绿验证（代码还原事故）',
          title: '实验后代码未能原样还原，已立即中断',
          reason: `文件 ${ob.breakPatch.file} 还原前后哈希不一致`,
          action: '用 git status / git diff 核查并恢复目标文件'
        })
    };
  }

  // 第 5 步：还原后必须跑绿（§6.2.2）
  const rAfter = spawnSync(ob.command, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: (ob.timeoutSec || 600) * 1000 });
  if (rAfter.status !== ob.expect?.exitCode) {
    return { exitCode: 1, stderr: '还原后判据未通过，属不稳定，不许标有牙' };
  }

  ob.teeth = { at: new Date().toISOString().slice(0, 10), tier: 'A', result: mutantOutcome };
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  const tExit = mutantOutcome === 'killed' ? 0 : 1;
  const hl = tExit === 0
    ? `✅ [3-1] 「${ob.claim || criterionId}」防假绿验证通过（改坏代码已检出并还原） · 总进度 {{PCT}}`
    : `❌ [3-1] 「${ob.claim || criterionId}」防假绿验证未通过（改坏代码未检出）`;
  return {
    exitCode: tExit,
    stdout: `teeth (tier A): ${id}/${criterionId} -> ${mutantOutcome}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
  };
}

export function cmdRetire(projectRoot, opts) {
  const { id, reason } = opts;
  if (!id) return { exitCode: 1, stderr: '缺少契约标识' };
  if (!reason || !reason.trim()) return { exitCode: 1, stderr: '退役理由不能为空（§八 退 1）' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  contract.retired = { date: new Date().toISOString().slice(0, 10), reason: reason.trim() };
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  const app = appendChainEntry(projectRoot, { kind: 'retire', contractId: id, reason: reason.trim(), signedBy: contract.owner || '业主' });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return { exitCode: 0, stdout: `契约 ${id} 已退役（${contract.retired.date}）：${reason.trim()}` };
}
