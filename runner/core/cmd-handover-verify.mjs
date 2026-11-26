// 交接包生成与门 5 独立盲审打包/裁决命令（handover / verify pack / verify apply，<= 350 行聚焦子模块）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { appendChainEntry, readAndVerifyChain } from './chain.mjs';
import { computeProjectStatus } from './gates.mjs';
import { checkMaterialsFresh, readEvidenceRuns } from './project-loader.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { CMDB_REPO, collectGapsList } from './cmd-inspect.mjs';
import { gdCollectDisabledIntegrityRules, gdFormatIntegrityBannerMarkdown } from './governance-disclosure.mjs';
import { vcAggregateVoteFiles, vcBuildEscapesRegressionBundle, vcEvaluateVerdictMatrix } from './verify-consensus.mjs';
import {
  hvBuildNextTurnInjectBlock, hvBuildPackGitDiff,
  hvRenderHandoverMarkdown, hvWriteVerifyPackFiles
} from './handover-pack-builder.mjs';

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
  const dgBin = existsSync(join(projectRoot, 'runner', 'donegate.mjs'))
    ? 'runner/donegate.mjs'
    : `"${resolve(dirname(fileURLToPath(import.meta.url)), '..', 'donegate.mjs')}"`;
  const govCautionMd = gdFormatIntegrityBannerMarkdown(gdCollectDisabledIntegrityRules(projectRoot));

  const md = hvRenderHandoverMarkdown(st, gaps, decs, smokeCmd, nextContract, dgBin, govCautionMd, opts);
  const outPath = resolve(projectRoot, opts.out || 'HANDOVER.md');
  writeFileSync(outPath, md, 'utf8');
  const injectBlock = hvBuildNextTurnInjectBlock(projectRoot, st, gaps, intent, smokeCmd, nextContract, dgBin);
  const focusId = nextContract !== '<contractId>' ? nextContract : undefined;
  return {
    exitCode: 0,
    stdout: `已生成交接包：${relative(projectRoot, outPath) || 'HANDOVER.md'}（六节齐）\n\n${injectBlock}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: focusId, headline: '✅ [4-2] 交接包 HANDOVER.md 已生成 · 总进度 {{PCT}}' }),
    path: outPath,
    injectBlock
  };
}

function hvValidateSinglePackRun(projectRoot, contract, o, latest) {
  if (!latest.valid) return { ok: false, exitCode: 2, stderr: `判据 ${o.id} 最新运行证据损坏或互哈希链断裂（退 2）：${latest.reason}` };
  const s = latest.start || {}, rep = latest.report || {};
  if (s.debugDirtyRun === true || s.isDirty === true || rep.debugDirtyRun === true) {
    return {
      ok: false, exitCode: 3,
      stderr: `判据 ${o.id} 最新证据为脏树调试运行（--allow-dirty），禁打入复核包，请提交干净树后重跑 check\n\n` +
        renderWorryBlock(projectRoot, {
          exitCode: 3, stage: 4, stageTitle: `「${contract.title || contract.id}」独立复核打包`,
          title: '最新运行证据来自脏工作区，不能送审', reason: `判据 ${o.id} 使用了 --allow-dirty 调试证据`,
          action: '提交干净树后重新执行 donegate check，再跑 verify pack'
        })
    };
  }
  if (s.gate4Eligible === false || rep.gate4Eligible === false || s.track === 'explore' || s.skipGates === true || rep.skipGates === true) {
    return { ok: false, exitCode: 3, stderr: `判据 ${o.id} 最新证据来自探索态或 --skip-gates 试跑，禁打入正式复核包（退 3）` };
  }
  if (latest.end?.result !== 'pass' || rep.outputOverflow === true || rep.timedOut === true) {
    return { ok: false, exitCode: 3, stderr: `判据 ${o.id} 最新运行结果非 pass（result=${latest.end?.result || 'missing'}），不可打包送审（退 3）` };
  }
  if (!checkMaterialsFresh(projectRoot, s, contract)) {
    return { ok: false, exitCode: 3, stderr: `判据 ${o.id} 最新运行证据已过期（材料指纹变化），请重跑 check 后再打包（退 3）` };
  }
  return { ok: true };
}

function hvCollectPackEvidencePairs(projectRoot, contract, obs) {
  const id = contract.id, evBase = join(projectRoot, '.donegate', 'evidence', id), evPairs = [];
  for (const o of obs) {
    const runs = readEvidenceRuns(projectRoot, id, o.id);
    if (runs.length === 0) return { ok: false, exitCode: 3, stderr: `判据 ${o.id} 无运行证据目录（退 3）` };
    const latest = runs[runs.length - 1];
    const v = hvValidateSinglePackRun(projectRoot, contract, o, latest);
    if (!v.ok) return v;
    evPairs.push({ oid: o.id, runName: latest.ts, latestRunDir: join(evBase, o.id, latest.ts) });
  }
  return { ok: true, evPairs };
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

  const evCheck = hvCollectPackEvidencePairs(projectRoot, contract, obs);
  if (!evCheck.ok) return { exitCode: evCheck.exitCode, stderr: evCheck.stderr };
  const diffRes = hvBuildPackGitDiff(projectRoot, id, contract, opts);
  if (!diffRes.ok) return { exitCode: diffRes.exitCode, ...(diffRes.code ? { code: diffRes.code } : {}), stderr: diffRes.stderr };

  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const packDir = resolve(projectRoot, opts.out || join('.donegate', 'verify', `${id}-${ts}`, id));
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  const manifestBody = hvWriteVerifyPackFiles(packDir, id, contract, obs, diffRes.diffText, diffRes.versText, evCheck.evPairs);

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
  const worry = (exitCode, title, reason, action) => renderWorryBlock(projectRoot, { exitCode, stage: 4, stageTitle: '独立 AI 盲审裁决', title, reason, action });
  if (evalRes.isContradiction) {
    return { exitCode: 2, stderr: '门 5 发现材料自相矛盾（G-02 按 §八 退 2）\n\n' + worry(2, '提交送审的材料自相矛盾', '独立复核指出不同文件或声称之间互相冲突', '核对代码 diff、运行输出与完成声称后重新打包送审') };
  }
  if (evalRes.hasFail) {
    return { exitCode: 1, stdout: '门 5 判定：未通过（存在 fail 项，退 1）\n\n' + worry(1, '独立 AI 复核驳回（存在未通过项）', '独立盲审在标准核对中发现 fail 项', '按判定书指出的 fail 项修复后，重跑 check 与 verify pack') };
  }
  if (evalRes.hasUnknown) {
    return { exitCode: 3, stdout: '门 5 判定：无法判断（材料不足，退 3）\n\n' + worry(3, '复核材料不足，无法裁决', '判定书中存在因缺失材料而给出的 unknown', '补齐缺失证据或说明后重新运行 verify pack') };
  }
  return null;
}

function hvLoadApplyVerdict(projectRoot, verdictPath, opts) {
  if (opts.votes) {
    const agg = vcAggregateVoteFiles(projectRoot, opts.votes);
    return agg.ok ? { ok: true, v: agg.merged } : { ok: false, exitCode: agg.exitCode, stderr: agg.stderr };
  }
  const vRes = readJsonStrict(verdictPath);
  if (!vRes.ok) return { ok: false, exitCode: vRes.error === 'parse' ? 2 : 3, stderr: '判定书读不出或 JSON 损坏' };
  return { ok: true, v: vRes.value };
}

function hvReadPackContractId(packDir) {
  const critDir = join(packDir, 'criterion');
  let id = packDir.split(/[\\/]/).pop();
  if (!existsSync(critDir)) return id;
  const critFile = readdirSync(critDir).find((f) => f.endsWith('.json'));
  if (!critFile) return id;
  const cr = readJsonStrict(join(critDir, critFile));
  return (cr.ok && cr.value?.id) ? String(cr.value.id) : critFile.replace(/\.json$/, '');
}

export function cmdVerifyApply(projectRoot, opts = {}) {
  const packDir = opts.packDir ? resolve(projectRoot, opts.packDir) : null;
  const verdictPath = opts.verdict ? resolve(projectRoot, opts.verdict) : null;
  if (!packDir || !existsSync(packDir)) return { exitCode: 3, stderr: '复核包目录不存在' };
  if (!opts.votes && (!verdictPath || !existsSync(verdictPath))) return { exitCode: 3, stderr: '判定书文件不存在' };
  const packChk = spawnSync(process.execPath, [join(CMDB_REPO, 'skill', 'check-reviewpack.mjs'), '--pack', packDir], { encoding: 'utf8' });
  if (packChk.status === 3) return { exitCode: 3, stderr: '复核包有文件不可读：' + packChk.stdout };
  if (packChk.status !== 0) {
    return {
      exitCode: 2,
      stderr: '复核包已被篡改或结构不闭合（退 2）：\n' + packChk.stdout + '\n\n' + renderWorryBlock(projectRoot, {
        exitCode: 2, stage: 4, stageTitle: '独立复核校验', title: '复核材料包哈希异常或包含越界内容',
        reason: '清单文件与实际字节不一致或混入了非白名单文件', action: '停止裁决，删除旧复核包并重新执行 verify pack'
      })
    };
  }
  const loaded = hvLoadApplyVerdict(projectRoot, verdictPath, opts);
  if (!loaded.ok) return { exitCode: loaded.exitCode, stderr: loaded.stderr };
  const v = loaded.v;
  const evalRes = vcEvaluateVerdictMatrix(v);
  if (!evalRes.ok) return { exitCode: evalRes.exitCode, stderr: evalRes.stderr };
  const nonPass = hvRenderApplyNonPass(projectRoot, evalRes);
  if (nonPass) return nonPass;
  const contractId = hvReadPackContractId(packDir);
  if (v.contractId && String(v.contractId).trim() !== contractId) {
    return { exitCode: 2, stderr: `跨契约判词冒充拦截（退 2）：判词声明 contractId=${v.contractId} 与复核包实际契约 ${contractId} 不一致` };
  }
  const maniPath = join(packDir, 'MANIFEST.txt');
  const packageHash = existsSync(maniPath) ? sha256(readFileSync(maniPath)) : null;
  const chainNow = readAndVerifyChain(projectRoot);
  const latestFreeze = chainNow.ok ? chainNow.entries.filter((e) => e.kind === 'freeze' && e.contractId === contractId).pop() : null;
  const app = appendChainEntry(projectRoot, {
    kind: 'verify-result', contractId, result: 'pass', freezeSeq: latestFreeze?.seq ?? null,
    packageHash, signedBy: v.judge || 'independent-judge'
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return {
    exitCode: 0,
    stdout: `门 5 记录：通过（${contractId}，seq=${app.entry.seq}）\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: contractId, headline: `✅ [4-1] 独立 AI 盲审通过（${contractId}） · 总进度 {{PCT}}` })
  };
}
