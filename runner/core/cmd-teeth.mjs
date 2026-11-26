// 防假绿有牙变异实验命令（teeth Tier A breakPatch / Tier B Stryker，<= 350 行聚焦子模块）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { verifyClaimInMemory } from '../../skill/check-declarations.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';
import { cmdCatch, runAchSemanticMutants } from './teeth-ach.mjs';
export { cmdCatch };

export function cmdTeeth(projectRoot, opts) {
  const { id, criterionId, tier = 'A' } = opts;
  if (!id || !criterionId) return { exitCode: 3, stderr: '用法：teeth <契约id> <判据id> [--tier A|B|ACH] [--mutants <json>]' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  const ob = (contract.obligations || []).find((o) => o.id === criterionId);
  if (!ob) return { exitCode: 3, stderr: `契约 ${id} 中找不到判据 ${criterionId}` };

  if (String(tier).toUpperCase() === 'ACH') {
    const ach = runAchSemanticMutants(projectRoot, contract, ob, { mutants: opts.mutants, contractPath: cPath });
    if (ach.exitCode !== 0 && ach.stderr) return ach;
    const hl = ach.exitCode === 0
      ? `✅ [3-1] 「${ob.claim || criterionId}」ACH 语义变异验证通过 · 总进度 {{PCT}}`
      : `❌ [3-1] 「${ob.claim || criterionId}」ACH 语义变异未全杀（${ach.result}）`;
    return {
      ...ach,
      stdout: `${ach.stdout}\n\n` + renderProgressBlock(projectRoot, { focusContractId: id, headline: hl })
    };
  }

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
