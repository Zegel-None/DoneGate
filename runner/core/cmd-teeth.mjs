// 防假绿有牙变异实验命令（teeth Tier A breakPatch / Tier B Stryker，<= 350 行聚焦子模块）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { buildSanitizedEnv } from './isolation.mjs';
import { execRunPreFlightPlug } from './cmd-execute.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { cmdCatch, runAchSemanticMutants } from './teeth-ach.mjs';
export { cmdCatch };

function teethIsFileInContractScope(projectRoot, contract, targetFile) {
  const rawRel = relative(projectRoot, targetFile);
  const normRel = rawRel.replace(/\\/g, '/');
  if (!normRel || isAbsolute(rawRel) || normRel.startsWith('..') || /^[A-Za-z]:/.test(normRel)) return false;
  const scopes = Array.isArray(contract?.scope) ? contract.scope.map((s) => String(s || '').replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean) : [];
  if (scopes.length === 0) return true;
  return scopes.some((s) => (s.endsWith('/') ? normRel.startsWith(s) : (normRel === s || normRel.startsWith(s + '/'))));
}

function teethEvalCommandOutcome(r, ob) {
  if (r.signal === 'SIGTERM' || r.error?.code === 'ETIMEDOUT') return 'timeout';
  if (r.error || typeof r.status !== 'number') return 'runtime-error';
  if (r.status !== ob.expect?.exitCode) return 'killed';
  if (ob.expect?.stdoutMatches !== undefined) {
    const outTrim = String(r.stdout || '').replace(/[\r\n\s]+$/, '');
    if (outTrim !== ob.expect.stdoutMatches) return 'killed';
  }
  return 'survived';
}

const STRYKER_STATUS_PRIORITY = [
  ['Pending', 'pending'],
  ['Ignored', 'ignored'],
  ['Survived', 'survived'],
  ['NoCoverage', 'no-coverage'],
  ['Timeout', 'timeout'],
  ['CompileError', 'compile-error'],
  ['RuntimeError', 'runtime-error']
];

function teethClassifyStrykerCounts(obs) {
  const cnt = obs.countsByStatus || {};
  for (const [key, mapped] of STRYKER_STATUS_PRIORITY) {
    if (cnt[key] > 0) return mapped;
  }
  if (obs.totalMutants === 0 || cnt.Killed !== obs.totalMutants) return 'survived';
  return 'killed';
}

function teethRunAchTier(projectRoot, contract, ob, opts, cPath) {
  const { id, criterionId } = opts;
  const ach = runAchSemanticMutants(projectRoot, contract, ob, { mutants: opts.mutants, contractPath: cPath });
  if (ach.exitCode !== 0 && ach.stderr) return ach;
  const label = ob.claim || criterionId;
  const hl = ach.exitCode === 0
    ? `✅ [3-1] 「${label}」ACH 语义变异验证通过 · 总进度 {{PCT}}`
    : `❌ [3-1] 「${label}」ACH 语义变异未全杀（${ach.result}）`;
  return {
    ...ach,
    stdout: `${ach.stdout}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
  };
}

function teethRunTierB(projectRoot, contract, ob, opts, cPath) {
  const { id, criterionId } = opts;
  const claimPath = resolve(projectRoot, opts.claim || '.donegate/adapters/stryker/claim.json');
  const decl = verifyClaimInMemory(claimPath, projectRoot, { skipContractLookup: true });
  if (decl.exitCode !== 0) return { exitCode: decl.exitCode, stderr: 'Stryker 声明核验失败：' + decl.reason };
  const obsArt = decl.claim.artifacts.find((a) => a.kind === 'stryker-observation');
  if (!obsArt) return { exitCode: 3, stderr: 'claim.json 缺少 stryker-observation 产物' };
  const obs = JSON.parse(decl.memFiles.get(obsArt.path).toString('utf8'));
  const result = teethClassifyStrykerCounts(obs);
  ob.teeth = { at: new Date().toISOString().slice(0, 10), tier: 'B', result };
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  const exitCode = result === 'killed' ? 0 : (result === 'pending' ? 3 : 1);
  const label = ob.claim || criterionId;
  const hl = exitCode === 0
    ? `✅ [3-1] 「${label}」变异验证通过（非假绿） · 总进度 {{PCT}}`
    : `❌ [3-1] 「${label}」变异验证未通过（${result}）`;
  return { exitCode, stdout: `teeth (tier B): ${id}/${criterionId} -> ${result}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl }) };
}

function teethPrepareTierAPatch(projectRoot, contract, ob, criterionId) {
  const bp = ob.breakPatch;
  if (!bp || !bp.file || bp.from === undefined || bp.to === undefined) {
    return {
      ok: false,
      res: {
        exitCode: 3,
        stderr: `判据 ${criterionId} 缺少 breakPatch { file, from, to }（请先在 contract.json 补齐 breakPatch 并重新执行 contract freeze）\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 3, stage: 3, stageTitle: '防假绿验证（变异实验）',
            title: `缺少改坏补丁配置（${criterionId}）`,
            reason: '未配置 breakPatch，无法自动演示「改坏代码后测试能否抓住」',
            action: '在 contract.json 该判据下补齐 breakPatch 后重新 contract freeze'
          })
      }
    };
  }
  const targetFile = resolve(projectRoot, bp.file);
  if (!teethIsFileInContractScope(projectRoot, contract, targetFile)) {
    return { ok: false, res: { exitCode: 2, stderr: `breakPatch 目标文件越出契约 scope 或项目根目录（退 2）：${bp.file}` } };
  }
  if (!existsSync(targetFile)) {
    return { ok: false, res: { exitCode: 3, stderr: 'breakPatch 目标文件不存在：' + bp.file } };
  }
  const sanitizedEnv = buildSanitizedEnv(process.env, {}, { cwd: projectRoot, envPassthrough: contract.execution?.envPassthrough });
  const plugRes = execRunPreFlightPlug(projectRoot, contract, sanitizedEnv);
  if (!plugRes.ok) return { ok: false, res: { exitCode: plugRes.exitCode, code: plugRes.code, stderr: plugRes.stderr } };
  const origBuf = readFileSync(targetFile);
  const origText = origBuf.toString('utf8');
  if (!origText.includes(bp.from)) {
    return { ok: false, res: { exitCode: 3, stderr: 'breakPatch.from 在目标文件中未命中' } };
  }
  return { ok: true, targetFile, sanitizedEnv, origBuf, origHash: sha256(origBuf), origText };
}

function teethRunTierA(projectRoot, contract, ob, id, criterionId, cPath) {
  const prep = teethPrepareTierAPatch(projectRoot, contract, ob, criterionId);
  if (!prep.ok) return prep.res;
  const { targetFile, sanitizedEnv, origBuf, origHash, origText } = prep;
  const mutatedText = origText.replace(ob.breakPatch.from, () => String(ob.breakPatch.to));
  const timeoutMs = (ob.timeoutSec || 600) * 1000;
  let mutantOutcome;
  try {
    writeFileSync(targetFile, mutatedText, 'utf8');
    const rMut = spawnSync(ob.command, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: timeoutMs });
    mutantOutcome = teethEvalCommandOutcome(rMut, ob);
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
  const rAfter = spawnSync(ob.command, { cwd: projectRoot, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: timeoutMs });
  if (teethEvalCommandOutcome(rAfter, ob) !== 'survived') {
    return { exitCode: 1, stderr: '还原后判据未通过，属不稳定，不许标有牙' };
  }

  ob.teeth = { at: new Date().toISOString().slice(0, 10), tier: 'A', result: mutantOutcome };
  writeFileSync(cPath, JSON.stringify(contract, null, 2) + '\n');
  const tExit = mutantOutcome === 'killed' ? 0 : 1;
  const label = ob.claim || criterionId;
  const hl = tExit === 0
    ? `✅ [3-1] 「${label}」防假绿验证通过（改坏代码已检出并还原） · 总进度 {{PCT}}`
    : `❌ [3-1] 「${label}」防假绿验证未通过（改坏代码未检出）`;
  return {
    exitCode: tExit,
    stdout: `teeth (tier A): ${id}/${criterionId} -> ${mutantOutcome}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
  };
}

export function cmdTeeth(projectRoot, opts) {
  const { id, criterionId, tier = 'A' } = opts;
  if (!id || !criterionId) return { exitCode: 3, stderr: '用法：teeth <契约id> <判据id> [--tier A|B|ACH] [--mutants <json>]' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  const ob = (contract.obligations || []).find((o) => o.id === criterionId);
  if (!ob) return { exitCode: 3, stderr: `契约 ${id} 中找不到判据 ${criterionId}` };

  if (String(tier).toUpperCase() === 'ACH') return teethRunAchTier(projectRoot, contract, ob, opts, cPath);
  if (tier === 'B') return teethRunTierB(projectRoot, contract, ob, opts, cPath);
  return teethRunTierA(projectRoot, contract, ob, id, criterionId, cPath);
}
