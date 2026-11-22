// 单卡阅后即焚四重微门禁与 500-Token 富结构回执执行器（donegate check-node）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildNodeInterfaceStub } from './ast-stub.mjs';
import { discoverHermeticGraph, fileBelongsToScopes, resolveSubagentBudgetProfile } from './context-router.mjs';
import { diffAgainstFrozenStub, freezeNodeStubBaseline } from './hermetic-capsule.mjs';
import { loadThresholds } from './gates.mjs';
import { buildSanitizedEnv, checkCommandBans } from './isolation.mjs';

function listGitTouchedFiles(projectRoot) {
  const inside = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || (inside.stdout || '').trim() !== 'true') return { isGit: false, files: [] };
  const st = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], { encoding: 'utf8' });
  if (st.status !== 0) return { isGit: true, files: [] };
  const files = [];
  for (const rawLine of (st.stdout || '').split(/\r?\n/)) {
    if (rawLine.length < 4) continue;
    let rel = rawLine.slice(3).trim();
    if (rel.includes(' -> ')) rel = rel.split(' -> ').pop().trim();
    rel = rel.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
    if (rel) files.push(rel);
  }
  return { isGit: true, files };
}

export function cmdCheckNode(projectRoot, opts = {}) {
  const t0 = Date.now();
  const id = opts.id;
  if (!id) return { exitCode: 3, stderr: '缺少目标节点标识（用法：donegate check-node <nodeId>）' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const cRes = readJsonStrict(cPath);
  if (!cRes.ok) return { exitCode: cRes.error === 'parse' ? 2 : 3, stderr: `读取节点契约失败：${cPath}` };
  const contract = cRes.value;

  const allObs = Array.isArray(contract.obligations) ? contract.obligations : [];
  const cmdObs = (opts.criterion ? allObs.filter((o) => o.id === opts.criterion) : allObs).filter((o) => o.kind === 'command');
  for (const o of cmdObs) {
    const banHits = checkCommandBans(o.command);
    if (banHits.length > 0) return { exitCode: 2, stderr: `判据 ${o.id} 触发 §四 禁令（退 2）：${banHits.join('；')}` };
  }

  const thresholds = loadThresholds(projectRoot);
  const budget = resolveSubagentBudgetProfile(thresholds, opts);
  const currentStub = buildNodeInterfaceStub(projectRoot, contract);
  const fails = [];

  // 微门禁 1：写入范围围栏（防越权修改其他节点源码）
  const gitState = listGitTouchedFiles(projectRoot);
  if (gitState.isGit && !opts.allowDirty && gitState.files.length > 0) {
    return { exitCode: 3, stderr: '工作区存在未提交改动（局部调试请加 --allow-dirty，正式签收请先提交干净树）' };
  }
  const touchedNonMeta = gitState.files.filter((f) => !f.startsWith('.donegate/'));
  if (gitState.isGit && !opts.skipScopeCheck) {
    const outOfScope = touchedNonMeta.filter((f) => {
      if (f.startsWith(`contracts/${id}/`)) return false;
      if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i.test(f)) return false;
      return !fileBelongsToScopes(f, contract.scope || []);
    });
    if (outOfScope.length > 0) fails.push(`越界修改非本卡 scope 文件：${outOfScope.join(', ')}`);
  }

  // 微门禁 2：冻结接口存根兼容性（防私改对外签名破坏上下游）
  const stubDiff = diffAgainstFrozenStub(projectRoot, id, currentStub);
  if (stubDiff.breakingChanges.length > 0) {
    if (opts.allowStubChange) freezeNodeStubBaseline(projectRoot, id, currentStub);
    else fails.push(...stubDiff.breakingChanges);
  }

  // 微门禁 3：跨节点红线未声明依赖与门面出口私引拦截
  const graph = discoverHermeticGraph(projectRoot);
  if (graph.ok) {
    for (const r of graph.redImports.filter((x) => x.fromNode === id)) {
      fails.push(`未声明跨卡红线依赖：${r.fromFile} -> ${r.toNode} (${r.toFile})`);
    }
    for (const v of graph.facadeViolations.filter((x) => x.fromNode === id)) {
      fails.push(`越过门面私引邻居内部实现：${v.fromFile} -> ${v.toFile}（只准引 ${v.expectedFacades.join('/')}）`);
    }
  }

  // 微门禁 4：单文件有效代码硬顶检查
  if (currentStub.maxFileEffectiveLines > thresholds.maxEffectiveFileLines) {
    fails.push(`单文件有效代码超硬顶：${currentStub.maxFile} (${currentStub.maxFileEffectiveLines} > ${thresholds.maxEffectiveFileLines})`);
  }

  const sanitizedEnv = buildSanitizedEnv();
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
    if (timedOut || spawnFailed) {
      unknown++;
      fails.push(`判据 ${o.id} 无法执行或超时`);
    } else if (r.status !== o.expect?.exitCode) {
      fails.push(`判据 ${o.id} 退出码 ${r.status} !== 期望 ${o.expect?.exitCode}`);
    } else if (o.expect?.stdoutMatches !== undefined && stdoutTrim !== o.expect.stdoutMatches) {
      fails.push(`判据 ${o.id} 输出不匹配期望值`);
    } else {
      passed++;
      passedObligations.push(o.id);
    }
  }

  const exitCode = fails.length > 0 ? (unknown > 0 && fails.length === unknown ? 3 : 1) : 0;
  const stubsDir = join(projectRoot, '.donegate', 'stubs');
  mkdirSync(stubsDir, { recursive: true });
  writeFileSync(join(stubsDir, `${id}.stub.d.ts`), currentStub.stubText, 'utf8');

  const receipt = {
    schema: 'donegate-node-receipt/v1',
    nodeId: id,
    title: contract.title || id,
    verdict: exitCode === 0 ? 'PASS' : (exitCode === 1 ? 'FAIL' : 'UNKNOWN'),
    exitCode,
    passed,
    total: cmdObs.length,
    passedObligations,
    facadeMode: currentStub.facadeMode,
    exportedSymbolCount: currentStub.exportedSymbols.length,
    stubHash: currentStub.stubHash,
    stubChanged: Boolean(stubDiff.stubChanged),
    addedExports: stubDiff.addedExports || [],
    effectiveLines: currentStub.effectiveLines,
    touchedFiles: touchedNonMeta.slice(0, 16),
    sessionBudgetTokens: budget.totalSessionBudgetTokens,
    receiptBudgetTokens: budget.receiptBudgetTokens,
    durationMs: Date.now() - t0,
    ...(fails.length > 0 ? { fails: fails.slice(0, 8) } : {})
  };

  const capDir = join(projectRoot, '.donegate', 'capsules');
  mkdirSync(capDir, { recursive: true });
  writeFileSync(join(capDir, `${id}.receipt.json`), JSON.stringify(receipt, null, 2), 'utf8');

  if (opts.json || opts.receipt) {
    return { exitCode, receipt, stdout: JSON.stringify(receipt), ...(fails.length > 0 ? { stderr: fails.join('；') } : {}) };
  }
  const summaryLines = [
    `[check-node:${id}] verdict=${receipt.verdict} passed=${passed}/${cmdObs.length} exports=${receipt.exportedSymbolCount} stubHash=${receipt.stubHash} lines=${receipt.effectiveLines} (${receipt.durationMs}ms)`,
    ...(fails.map((f) => `  ✗ ${f}`)),
    `RECEIPT: ${JSON.stringify(receipt)}`
  ];
  return { exitCode, receipt, stdout: summaryLines.join('\n'), ...(fails.length > 0 ? { stderr: fails.join('；') } : {}) };
}
