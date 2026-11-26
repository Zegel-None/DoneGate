// 交接包生成与门 5 独立盲审打包/裁决命令（handover / verify pack / verify apply，<= 350 行聚焦子模块）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { appendChainEntry, readAndVerifyChain } from './chain.mjs';
import { computeProjectStatus } from './gates.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { CMDB_REPO, collectGapsList } from './cmd-inspect.mjs';
import { verifyHeldOutContract } from './heldout-verifier.mjs';
import { gdCollectDisabledIntegrityRules, gdFormatIntegrityBannerMarkdown } from './governance-disclosure.mjs';
import { vcAggregateVoteFiles, vcBuildEscapesRegressionBundle, vcEvaluateVerdictMatrix } from './verify-consensus.mjs';

export function cmdHandover(projectRoot, opts = {}) {
  const st = computeProjectStatus(projectRoot);
  if (st.contractErrors.length > 0) return { exitCode: 3, stderr: '状态算不出来，无法生成交接包' };
  const gaps = collectGapsList(projectRoot, st);
  const decDir = join(projectRoot, 'decisions');
  const decs = existsSync(decDir) ? readdirSync(decDir).filter((f) => f.endsWith('.md')).sort().slice(-3).reverse() : [];
  const intent = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const smokeMatch = intent.match(/^冒烟命令：\s*(.+)$/m);
  const smokeCmd = smokeMatch ? smokeMatch[1].trim() : 'node -e "process.exit(0)"';
  const nextContract = gaps.find((g) => g.contractId)?.contractId || st.contractSummaries[0]?.id || '<contractId>';
  const unverifiedOrPending = gaps.filter((g) => ['unverified', 'pending-recheck', 'expired', 'unknown'].includes(g.kind));

  const dgBin = existsSync(join(projectRoot, 'runner', 'donegate.mjs'))
    ? 'runner/donegate.mjs'
    : `"${resolve(dirname(fileURLToPath(import.meta.url)), '..', 'donegate.mjs')}"`;
  const govCautionMd = gdFormatIntegrityBannerMarkdown(gdCollectDisabledIntegrityRules(projectRoot));
  const md = [
    '# HANDOVER · 项目交接包',
    '',
    ...(govCautionMd ? [govCautionMd, ''] : []),
    '## 一、当前状态',
    st.ledgerLines[0],
    st.ledgerLines[1],
    `人工判据：${st.humanStats.N === 0 ? '0 项（无）' : `${st.humanStats.pass}/${st.humanStats.N}`}（独立列，不混入自动比例）`,
    st.funcLine,
    st.j3Line,
    '',
    '## 二、下一个该做的',
    gaps.length ? `优先处理：${gaps[0].detail}` : '当前无阻塞缺口，可进入交付或维护。',
    '',
    '## 三、未定事项',
    unverifiedOrPending.length ? unverifiedOrPending.map((g) => `- ${g.detail}`).join('\n') : '- 无未定事项',
    '',
    '## 四、最近三条决策',
    decs.length ? decs.map((d) => `- ${d}`).join('\n') : '- 暂无 decisions/ 记录',
    '',
    '## 五、已知缺口与不覆盖范围',
    gaps.length ? gaps.map((g) => `- [${g.kind}] ${g.detail}`).join('\n') : '- 缺口 0 条',
    '- **本交接包不覆盖**：契约 `scope` 之外的未认领底座代码、以及未写出可观察判据的主观视觉/手感体验。',
    '',
    '## 六、怎么跑起来',
    '```powershell',
    smokeCmd,
    `node ${dgBin} check ${nextContract}`,
    `node ${dgBin} status`,
    '```',
    '',
    '### 接收方验收记录',
    `- 谁跑的：${opts.receiver || '（待接收方填写）'}`,
    `- 跑的命令原文：${opts.ranCommand || smokeCmd}`,
    `- 看到的输出：${opts.observedOutput || '（待接收方填写实测输出）'}`,
    `- 卡住的格：${opts.stuckAt || '无'}`,
    ''
  ].join('\n');

  const outPath = resolve(projectRoot, opts.out || 'HANDOVER.md');
  writeFileSync(outPath, md, 'utf8');

  const intentLines = intent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('（'));
  const intentBrief = intentLines[0] || '按当前契约与判据推进开发';
  const consText = readMaybe(join(projectRoot, 'CONSTRAINTS.md')) || '';
  const consRules = consText.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(不许|必须)/.test(l)).slice(0, 2);
  let lastPitfall = '不要跳过冻结判据或用 || true 吞掉失败退出码，因为核侧会直接拒收。';
  const escPath = join(projectRoot, '.donegate', 'escapes.jsonl');
  if (existsSync(escPath)) {
    const escLines = readFileSync(escPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (escLines.length > 0) {
      try {
        const lastEsc = JSON.parse(escLines[escLines.length - 1]);
        if (lastEsc?.symptom && lastEsc?.rootCause) {
          lastPitfall = `注意避免「${lastEsc.symptom}」，因为根因是「${lastEsc.rootCause}」。`;
        }
      } catch { /* ignore */ }
    }
  }
  const completed = st.contractSummaries.filter((c) => !c.retired && c.state === '通过');
  const doneText = completed.length ? completed.map((c) => `${c.id}（${c.title}）`).join('、') : '尚无已通关模块，刚完成项目基线初始化';
  const focusGap = gaps[0]?.detail || `推进契约 ${nextContract} 并补齐全部验收项`;
  const injectBlock = [
    '### 📋 下一棒直接注入上下文块（高熵完整句 · 防缺主谓宾瞎猜）',
    '```text',
    `1. 项目与红线：本项目核心目标是「${intentBrief}」；你必须严守红线：${consRules.length ? consRules.join('；') : '子进程直读退出码、不许改判据凑绿'}。`,
    `2. 上一轮进展：已完成 ${doneText}；本轮总账为「${st.ledgerLines[0]}」，交互看板已刷新在 .donegate/dashboard.html。`,
    `3. 本轮唯一目标：请接手契约「${nextContract}」，当前首要阻塞是「${focusGap}」；修改代码必须限制在该契约 scope 内。`,
    `4. 防踩坑约束：${lastPitfall}`,
    `5. 起手第一条命令：先执行 ${smokeCmd} && node ${dgBin} status 核对最新实况，再开始动手。`,
    '```'
  ].join('\n');

  return {
    exitCode: 0,
    stdout: `已生成交接包：${relative(projectRoot, outPath) || 'HANDOVER.md'}（六节齐）\n\n${injectBlock}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: nextContract !== '<contractId>' ? nextContract : undefined, headline: '✅ [4-2] 交接包 HANDOVER.md 已生成 · 总进度 {{PCT}}' }),
    path: outPath,
    injectBlock
  };
}

export function cmdVerifyPack(projectRoot, opts = {}) {
  const id = opts.id;
  if (!id) return { exitCode: 3, stderr: '用法：verify pack <契约id>' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const cRes = readJsonStrict(cPath);
  if (!cRes.ok) return { exitCode: 3, stderr: '契约读不出来：' + cPath };
  const contract = cRes.value;
  if (contract.track === 'explore') {
    return { exitCode: 2, code: 'EXPLORE_CONTRACT_NOT_DELIVERABLE', stderr: `拒绝打包：契约 ${id} 处于探索态（track=explore），严禁进入交付复核包；请收敛后执行 contract promote ${id} --by <裁方姓名>` };
  }
  const obs = Array.isArray(contract.obligations) ? contract.obligations : [];
  if (obs.length === 0) return { exitCode: 3, stderr: '契约无判据，材料不全' };

  const evBase = join(projectRoot, '.donegate', 'evidence', id);
  if (!existsSync(evBase)) return { exitCode: 3, stderr: '缺少运行证据目录（§八 退 3）：' + evBase };

  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const packDir = resolve(projectRoot, opts.out || join('.donegate', 'verify', `${id}-${ts}`, id));
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  const filesWritten = [];
  const emit = (rel, content) => {
    const abs = join(packDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    filesWritten.push(rel.replace(/\\/g, '/'));
  };

  // 1. 判据原文（仅限本契约，符合 INV-14）
  emit(`criterion/${id}.json`, JSON.stringify({ id: contract.id, obligations: obs }, null, 2) + '\n');
  // 2. scope 与 why
  emit('contract-scope-why.md', `# 契约 ${id} 的 scope 与 why\n\n## scope\n${JSON.stringify(contract.scope)}\n\n## why\n${contract.why}\n`);
  // 3. 完成声称原文
  emit('完成声称.md', `# 完成声称（原文）\n\n本轮完成：契约 ${id} 全部 ${obs.length} 条判据已运行并留存三件套证据。\n`);
  // 4. base..head diff 与版本号（支持 --base/--head、锚定链上 freezeCommit、剥离无关 contracts/* 噪音、拒绝空 diff）
  const evPairs = [];
  for (const o of obs) {
    const oDir = join(evBase, o.id);
    if (!existsSync(oDir)) return { exitCode: 3, stderr: `缺少判据 ${o.id} 证据目录（退 3）` };
    const runs = readdirSync(oDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (runs.length === 0) return { exitCode: 3, stderr: `判据 ${o.id} 无运行证据目录（退 3）` };
    const runName = runs[runs.length - 1];
    const latestRunDir = join(oDir, runName);
    for (const part of ['start.json', 'report.json', 'end.json']) {
      if (!existsSync(join(latestRunDir, part))) return { exitCode: 3, stderr: `判据 ${o.id} 缺少 ${part}（退 3）` };
    }
    const startCheck = readJsonStrict(join(latestRunDir, 'start.json'));
    const reportCheck = readJsonStrict(join(latestRunDir, 'report.json'));
    if (startCheck.ok && (startCheck.value?.debugDirtyRun === true || startCheck.value?.isDirty === true || reportCheck.value?.debugDirtyRun === true)) {
      return {
        exitCode: 3,
        stderr: `判据 ${o.id} 最新证据为脏树调试运行（--allow-dirty），禁打入复核包，请提交干净树后重跑 check\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 3, stage: 4, stageTitle: `「${contract.title || id}」独立复核打包`,
            title: '最新运行证据来自脏工作区，不能送审',
            reason: `判据 ${o.id} 使用了 --allow-dirty 调试证据`,
            action: '提交干净树后重新执行 donegate check，再跑 verify pack'
          })
      };
    }
    evPairs.push({ oid: o.id, runName, latestRunDir });
  }

  let diffText = '', versText = '';
  const gitHead = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.head || 'HEAD'], { encoding: 'utf8' });
  if (gitHead.status === 0) {
    const headRev = gitHead.stdout.trim();
    let baseRev = '';
    if (opts.base) {
      const bRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.base], { encoding: 'utf8' });
      if (bRes.status !== 0) return { exitCode: 3, stderr: '无法解析 --base 提交：' + opts.base };
      baseRev = bRes.stdout.trim();
    } else {
      const chainRes = readAndVerifyChain(projectRoot);
      const freezeEntry = chainRes.ok ? chainRes.entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop() : null;
      if (freezeEntry && freezeEntry.freezeCommit && freezeEntry.freezeCommit !== headRev) {
        baseRev = freezeEntry.freezeCommit;
      } else {
        const prevRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' });
        baseRev = prevRes.status === 0 ? prevRes.stdout.trim() : '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      }
    }
    versText = `base ${baseRev}\nhead ${headRev}\n`;
    const hoRes = verifyHeldOutContract(projectRoot, contract, { baseRef: baseRev, heldOutDir: opts.heldOutDir });
    if (!hoRes.ok) {
      return { exitCode: 2, code: hoRes.code, stderr: hoRes.fails.join('\n') };
    }
    const d1 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', '.', ':(exclude)contracts'], { encoding: 'utf8' }).stdout || '';
    const d2 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', `contracts/${id}`], { encoding: 'utf8' }).stdout || '';
    diffText = [d1.trimEnd(), d2.trimEnd()].filter(Boolean).join('\n') + '\n';
  } else {
    return { exitCode: 3, stderr: '当前目录不是有效 git 仓库或无提交历史，无法生成 base..head（退 3）' };
  }
  if (!diffText.trim()) {
    return { exitCode: 3, stderr: 'base..head 无任何实际改动 diff（可能是空提交或冻结后未改动），拒绝生成空复核包，请指定 --base <commit>' };
  }
  emit(`diff/${id}.diff`, diffText);
  emit('diff/versions.txt', versText);

  // 5. 运行输出与三件套证据
  for (const ev of evPairs) {
    for (const part of ['start.json', 'report.json', 'end.json']) {
      emit(`evidence/${ev.oid}/${ev.runName}/${part}`, readFileSync(join(ev.latestRunDir, part), 'utf8'));
    }
  }

  const manifestBody = filesWritten.map((r) => sha256(readFileSync(join(packDir, r))) + '  ' + r).join('\n') + '\n';
  writeFileSync(join(packDir, 'MANIFEST.txt'), manifestBody, 'utf8');

  const chk = spawnSync(process.execPath, [join(CMDB_REPO, 'skill', 'check-reviewpack.mjs'), '--pack', packDir], { encoding: 'utf8' });
  if (chk.status !== 0) {
    return { exitCode: chk.status === 3 ? 3 : 2, stderr: `自建复核包未通过 check-reviewpack：\n${chk.stdout}\n${chk.stderr}` };
  }
  const escapesRegression = opts.escapesRegression ? vcBuildEscapesRegressionBundle(projectRoot, id) : null;
  return {
    exitCode: 0,
    stdout: `复核包已生成并通过 INV-14 自检：${packDir}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: id, headline: `📦 [4-1] 「${contract.title || id}」独立复核材料包已就绪（待 /donegate-judge 盲审） · 总进度 {{PCT}}` }),
    packDir,
    escapesRegression,
    packageHash: sha256(manifestBody)
  };
}

function hvRenderApplyNonPass(projectRoot, evalRes) {
  if (evalRes.isContradiction) {
    return {
      exitCode: 2,
      stderr: '门 5 发现材料自相矛盾（G-02 按 §八 退 2）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 2, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '提交送审的材料自相矛盾',
          reason: '独立复核指出不同文件或声称之间互相冲突',
          action: '核对代码 diff、运行输出与完成声称后重新打包送审'
        })
    };
  }
  if (evalRes.hasFail) {
    return {
      exitCode: 1,
      stdout: '门 5 判定：未通过（存在 fail 项，退 1）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 1, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '独立 AI 复核驳回（存在未通过项）',
          reason: '独立盲审在标准核对中发现 fail 项',
          action: '按判定书指出的 fail 项修复后，重跑 check 与 verify pack'
        })
    };
  }
  if (evalRes.hasUnknown) {
    return {
      exitCode: 3,
      stdout: '门 5 判定：无法判断（材料不足，退 3）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 3, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '复核材料不足，无法裁决',
          reason: '判定书中存在因缺失材料而给出的 unknown',
          action: '补齐缺失证据或说明后重新运行 verify pack'
        })
    };
  }
  return null;
}

export function cmdVerifyApply(projectRoot, opts = {}) {
  const packDir = opts.packDir ? resolve(projectRoot, opts.packDir) : null;
  const verdictPath = opts.verdict ? resolve(projectRoot, opts.verdict) : null;
  if (!packDir || !existsSync(packDir)) return { exitCode: 3, stderr: '复核包目录不存在' };
  if (!opts.votes && (!verdictPath || !existsSync(verdictPath))) return { exitCode: 3, stderr: '判定书文件不存在' };

  // 先由 check-reviewpack.mjs 核验复核包是否被篡改（清单闭合 / 哈希）
  const packChk = spawnSync(process.execPath, [join(CMDB_REPO, 'skill', 'check-reviewpack.mjs'), '--pack', packDir], { encoding: 'utf8' });
  if (packChk.status === 3) return { exitCode: 3, stderr: '复核包有文件不可读：' + packChk.stdout };
  if (packChk.status !== 0) {
    return {
      exitCode: 2,
      stderr: '复核包已被篡改或结构不闭合（退 2）：\n' + packChk.stdout + '\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 2, stage: 4, stageTitle: '独立复核校验',
          title: '复核材料包哈希异常或包含越界内容',
          reason: '清单文件与实际字节不一致或混入了非白名单文件',
          action: '停止裁决，删除旧复核包并重新执行 verify pack'
        })
    };
  }

  let v = null;
  if (opts.votes) {
    const agg = vcAggregateVoteFiles(projectRoot, opts.votes);
    if (!agg.ok) return { exitCode: agg.exitCode, stderr: agg.stderr };
    v = agg.merged;
  } else {
    const vRes = readJsonStrict(verdictPath);
    if (!vRes.ok) return { exitCode: vRes.error === 'parse' ? 2 : 3, stderr: '判定书读不出或 JSON 损坏' };
    v = vRes.value;
  }
  const evalRes = vcEvaluateVerdictMatrix(v);
  if (!evalRes.ok) return { exitCode: evalRes.exitCode, stderr: evalRes.stderr };
  const nonPass = hvRenderApplyNonPass(projectRoot, evalRes);
  if (nonPass) return nonPass;

  const contractId = v.contractId || packDir.split(/[\\/]/).pop();
  const maniPath = join(packDir, 'MANIFEST.txt');
  const packageHash = existsSync(maniPath) ? sha256(readFileSync(maniPath)) : null;
  const app = appendChainEntry(projectRoot, {
    kind: 'verify-result',
    contractId,
    result: 'pass',
    packageHash,
    signedBy: v.judge || 'independent-judge'
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return {
    exitCode: 0,
    stdout: `门 5 记录：通过（${contractId}，seq=${app.entry.seq}）\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: contractId, headline: `✅ [4-1] 独立 AI 盲审通过（${contractId}） · 总进度 {{PCT}}` })
  };
}
