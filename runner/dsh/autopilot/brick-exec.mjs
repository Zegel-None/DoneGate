// 完结门原子节点真实执行桥：连接 JIT/预置工作流节点与 adapters.registry.json 全部注册适配器及 check-brick-observations 断言器
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../../skill/io.mjs';
import { cleanGitEnv } from './autopilot-worktree.mjs';
import { normalizeLf } from '../deps/index.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TEMPLATE_TO_TOOL = {
  'tpl-openspec': 'openspec',
  'tpl-biome-knip': 'biome',
  'tpl-playwright': 'playwright',
  'tpl-maestro': 'maestro',
  'tpl-gitleaks': 'gitleaks'
};

const HARD_TOOL_OBLIGATION = {
  stryker: 'stryker-no-survivors',
  codegraph: 'codegraph-no-cycles',
  gitleaks: 'gitleaks-no-secrets',
  'osv-scanner': 'osv-no-high-severity',
  depcruise: 'depcruise-no-violations',
  knip: 'knip-no-unlisted-deps',
  biome: 'biome-no-errors',
  ruff: 'ruff-no-violations',
  complexipy: 'complexipy-under-cap',
  pyright: 'pyright-no-errors',
  ty: 'ty-no-errors',
  pytest: 'pytest-all-pass',
  'import-linter': 'import-linter-no-broken-contracts',
  'fuck-u-code': 'fuck-u-code-no-hot-files'
};

let cachedRegistry = null;
function loadAdapterRegistryMap(projectRoot) {
  const localReg = projectRoot ? join(resolve(projectRoot), 'adapters.registry.json') : '';
  if (localReg && existsSync(localReg)) {
    const r = readJsonStrict(localReg);
    if (r.ok && Array.isArray(r.value?.adapters)) {
      return new Map(r.value.adapters.map((a) => [a.tool, a]));
    }
  }
  if (!cachedRegistry) {
    const r = readJsonStrict(join(DG_ROOT, 'adapters.registry.json'));
    cachedRegistry = new Map((r.ok && Array.isArray(r.value?.adapters) ? r.value.adapters : []).map((a) => [a.tool, a]));
  }
  return cachedRegistry;
}

export function ensureGitLocalIgnoreRuntimeDirs(workCwd) {
  const gitRes = spawnSync('git', ['-C', workCwd, 'rev-parse', '--git-path', 'info/exclude'], {
    encoding: 'utf8',
    env: cleanGitEnv(),
    windowsHide: true
  });
  if (gitRes.status !== 0 || !(gitRes.stdout || '').trim()) return;
  const excludeAbs = resolve(workCwd, gitRes.stdout.trim());
  try {
    mkdirSync(dirname(excludeAbs), { recursive: true });
    const existing = existsSync(excludeAbs) ? readFileSync(excludeAbs, 'utf8') : '';
    const additions = ['.donegate/', 'workflows/.deps/'].filter((pat) => !existing.split(/\r?\n/).includes(pat));
    if (additions.length > 0) {
      appendFileSync(excludeAbs, (existing.endsWith('\n') || !existing ? '' : '\n') + additions.join('\n') + '\n', 'utf8');
    }
  } catch (err) { void err; }
}

export function buildBrickNodeExecSpec(tplId, tpl = {}, projectRoot = null) {
  if (tplId === 'tpl-router-rule') return { kind: 'rule_router' };
  if (tplId === 'tpl-router-ai' || tplId === 'tpl-deai-polish' || tplId === 'tpl-prompt-gen') return { kind: 'agent_step' };
  if (tplId === 'tpl-human-gate' || tpl.isHumanGate) return { kind: 'human_gate' };
  if (tplId === 'tpl-anti-slop') {
    return {
      kind: 'guard_suite',
      scriptRel: 'skill/check-module-integrity.mjs'
    };
  }
  const adpMatch = typeof tplId === 'string' ? tplId.match(/^tpl-adp-(.+)$/) : null;
  const tool = tpl.tool || TEMPLATE_TO_TOOL[tplId] || (adpMatch ? adpMatch[1] : '');
  if (tool) {
    const regMap = loadAdapterRegistryMap(projectRoot);
    const entry = regMap.get(tool);
    if (entry && entry.entry) {
      return {
        kind: 'adapter_node',
        tool,
        registryId: entry.id,
        entryRel: entry.entry,
        obligationId: HARD_TOOL_OBLIGATION[tool] || null
      };
    }
  }
  if (tplId === 'tpl-gradle') {
    return { kind: 'external_bin', bin: 'gradle', binArgs: ['assembleRelease'] };
  }
  return { kind: 'guard_suite', scriptRel: 'skill/check-module-integrity.mjs' };
}

function evaluateAdvisoryObservation(obs) {
  if (!obs || typeof obs !== 'object') return { exitCode: 0, detail: '观测已落盘' };
  const badChecks = [
    ['invalidCount', '规格不合法项'],
    ['failedCount', '失败用例'],
    ['errorCount', '错误项'],
    ['findingCount', '风险发现项'],
    ['typoCount', '拼写滑移项'],
    ['violationCount', '静态规则违规项'],
    ['syntaxErrorCount', '语法错误项'],
    ['undefinedNameCount', '未定义符号项'],
    ['overThresholdCount', '超认知复杂度上限函数'],
    ['brokenContractCount', '违反架构边界契约项']
  ];
  for (const [key, label] of badChecks) {
    if (typeof obs[key] === 'number' && obs[key] > 0) {
      return { exitCode: 1, detail: `检出 ${obs[key]} 处${label}` };
    }
  }
  if (Array.isArray(obs.hotFiles) && obs.hotFiles.length > 0) {
    return { exitCode: 1, detail: `检出 ${obs.hotFiles.length} 个高复杂度热点文件` };
  }
  return { exitCode: 0, detail: '观测采集与基线核对通过' };
}

function beRunBuiltinOrDonegateCmd(root, workCwd, spec, node, env, t0) {
  const nodeEnv = node.config && typeof node.config === 'object'
    ? { ...env, DG_NODE_CONFIG: JSON.stringify(node.config), DG_NODE_ID: String(node.id || '') }
    : env;
  if (spec.requireFile && !existsSync(join(workCwd, spec.requireFile))) {
    return {
      exitCode: 0,
      durationMs: Date.now() - t0,
      skipped: true,
      diagSummary: `按环境跳过（缺少 ${spec.requireFile}）`,
      watchArgs: [spec.scriptRel || spec.cmd || node.id]
    };
  }
  const relEntry = spec.kind === 'donegate_cmd' ? 'runner/donegate.mjs' : String(spec.scriptRel || 'skill/check-module-integrity.mjs');
  const absEntry = existsSync(join(root, relEntry)) ? join(root, relEntry) : join(DG_ROOT, relEntry);
  if (!existsSync(absEntry)) {
    return { exitCode: 3, durationMs: Date.now() - t0, diagSummary: `找不到执行入口：${relEntry}`, watchArgs: [relEntry] };
  }
  const args = [absEntry, ...(Array.isArray(spec.args) ? spec.args : [])];
  if (spec.passRoot !== false && !args.includes('--root')) args.push('--root', workCwd);
  const r = spawnSync(process.execPath, args, { cwd: workCwd, env: nodeEnv, encoding: 'utf8', timeout: 120000, windowsHide: true });
  return {
    exitCode: typeof r.status === 'number' ? r.status : 2,
    durationMs: Date.now() - t0,
    diagSummary: normalizeLf((r.stdout || '') + '\n' + (r.stderr || '')).trim(),
    watchArgs: args
  };
}

const BE_OBLIGATION_COUNTERS = {
  'gitleaks-no-secrets': (o) => Number(o.findingCount || 0),
  'stryker-no-survivors': (o) => Number(o.countsByStatus?.Survived || 0) + Number(o.countsByStatus?.NoCoverage || 0),
  'codegraph-no-cycles': (o) => Number(o.cycleCount || 0),
  'osv-no-high-severity': (o) => Number(o.severityCounts?.HIGH || 0) + Number(o.severityCounts?.CRITICAL || 0) + Number(o.severityCounts?.UNKNOWN || 0),
  'depcruise-no-violations': (o) => Number(o.violationCount || 0),
  'knip-no-unlisted-deps': (o) => Number(o.unlistedDepsCount || 0),
  'biome-no-errors': (o) => Number(o.errors || 0),
  'ruff-no-violations': (o) => Number(o.violationCount || 0) + Number(o.syntaxErrorCount || 0) + Number(o.undefinedNameCount || 0),
  'complexipy-under-cap': (o) => Number(o.overThresholdCount || 0),
  'pyright-no-errors': (o) => Number(o.errorCount || 0),
  'ty-no-errors': (o) => Number(o.errorCount || 0),
  'pytest-all-pass': (o) => Number(o.failedCount || 0) + Number(o.errorCount || 0),
  'import-linter-no-broken-contracts': (o) => Number(o.brokenContractCount || 0),
  'fuck-u-code-no-hot-files': (o) => (Array.isArray(o.hotFiles) ? o.hotFiles.length : Number(o.hotFileCount || 0))
};

function beRunNodeArgs(workCwd, nodeArgs, env, t0) {
  const r = spawnSync(process.execPath, nodeArgs, { cwd: workCwd, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  return {
    exitCode: typeof r.status === 'number' ? r.status : 2,
    durationMs: Date.now() - t0,
    diagSummary: normalizeLf((r.stdout || '') + '\n' + (r.stderr || '')).trim(),
    watchArgs: nodeArgs
  };
}

function beRunExternalBin(workCwd, spec, env, t0) {
  const binArgs = spec.binArgs || ['--version'];
  const r = spawnSync(spec.bin, binArgs, { cwd: workCwd, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
  const exitCode = r.error ? 3 : (typeof r.status === 'number' ? r.status : 2);
  const diagSummary = r.error
    ? `${spec.bin} 不可用：${r.error.message}`
    : normalizeLf((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  return { exitCode, durationMs: Date.now() - t0, diagSummary, watchArgs: [spec.bin, ...(spec.binArgs || [])] };
}

function bePersistDryRunObservation(workCwd, tool, stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !parsed.observation) return;
    const outDir = join(workCwd, '.donegate', 'adapters', tool);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'observation.json'), JSON.stringify(parsed.observation, null, 2) + '\n', 'utf8');
    if (parsed.claim) writeFileSync(join(outDir, 'claim.json'), JSON.stringify(parsed.claim, null, 2) + '\n', 'utf8');
  } catch (err) {
    void err;
  }
}

function beBuildAdapterArgs(root, workCwd, spec, node, isCleanGit) {
  const adapterAbs = existsSync(join(root, spec.entryRel)) ? join(root, spec.entryRel) : join(DG_ROOT, spec.entryRel);
  const adpArgs = [adapterAbs, '--root', workCwd, '--registry-id', spec.registryId || `${spec.tool}@stage4`];
  if (node.config?.target && !adpArgs.includes('--target')) adpArgs.push('--target', String(node.config.target));
  if (node.config?.maxComplexity !== undefined && !adpArgs.includes('--max-complexity')) {
    adpArgs.push('--max-complexity', String(node.config.maxComplexity));
  }
  if (!isCleanGit) adpArgs.push('--dry-run');
  return adpArgs;
}

function beEvaluateHardObligation(root, workCwd, spec, obligationId, nodeEnv, adpOut, adpArgs, t0) {
  const localChecker = join(root, 'skill', 'check-brick-observations.mjs');
  const obsChecker = existsSync(localChecker) ? localChecker : join(DG_ROOT, 'skill', 'check-brick-observations.mjs');
  if (existsSync(obsChecker)) {
    const rVer = spawnSync(process.execPath, [obsChecker, '--obligation', obligationId, '--root', workCwd], {
      cwd: workCwd, env: nodeEnv, encoding: 'utf8', timeout: 30000, windowsHide: true
    });
    const vExit = typeof rVer.status === 'number' ? rVer.status : 2;
    const vDiag = normalizeLf((rVer.stdout || '') + '\n' + (rVer.stderr || '')).trim();
    const firstLine = (vDiag || adpOut).split('\n').find((l) => l.trim()) || '发现未达标代码项';
    const obsHint = vExit !== 0 ? `${spec.tool} 门禁拦截 (${obligationId})：${firstLine}` : (vDiag || adpOut);
    return { exitCode: vExit, durationMs: Date.now() - t0, diagSummary: obsHint, watchArgs: adpArgs };
  }
  const obsFileHard = join(workCwd, '.donegate', 'adapters', spec.tool, 'observation.json');
  const obsResHard = existsSync(obsFileHard) ? readJsonStrict(obsFileHard) : { ok: false };
  if (!obsResHard.ok || !obsResHard.value) {
    return { exitCode: 3, durationMs: Date.now() - t0, diagSummary: `${spec.tool}: 缺少观测产物 observation.json`, watchArgs: adpArgs };
  }
  const counter = BE_OBLIGATION_COUNTERS[obligationId];
  const badCount = counter ? counter(obsResHard.value) : 0;
  return {
    exitCode: badCount > 0 ? 1 : 0,
    durationMs: Date.now() - t0,
    diagSummary: badCount > 0 ? `${obligationId}: 检出 ${badCount} 项阻断违例` : `${obligationId}: 零违例通过`,
    watchArgs: adpArgs
  };
}

function beRunAdapterNode(root, workCwd, spec, node, env, t0) {
  const nodeEnv = node.config && typeof node.config === 'object'
    ? { ...env, DG_NODE_CONFIG: JSON.stringify(node.config), DG_NODE_ID: String(node.id || '') }
    : env;
  const gitSt = spawnSync('git', ['-C', workCwd, 'status', '--porcelain'], { encoding: 'utf8', env: nodeEnv, windowsHide: true });
  const isCleanGit = gitSt.status === 0 && gitSt.stdout.trim() === '';
  const adpArgs = beBuildAdapterArgs(root, workCwd, spec, node, isCleanGit);

  const rAdp = spawnSync(process.execPath, adpArgs, { cwd: workCwd, env: nodeEnv, encoding: 'utf8', timeout: 120000, windowsHide: true });
  const adpExit = typeof rAdp.status === 'number' ? rAdp.status : 2;
  const adpOut = normalizeLf((rAdp.stdout || '') + '\n' + (rAdp.stderr || '')).trim();
  if (adpExit !== 0) {
    return { exitCode: adpExit, durationMs: Date.now() - t0, diagSummary: adpOut, watchArgs: adpArgs };
  }
  if (!isCleanGit && rAdp.stdout) bePersistDryRunObservation(workCwd, spec.tool, rAdp.stdout);

  const obligationId = spec.obligationId || HARD_TOOL_OBLIGATION[spec.tool] || null;
  if (obligationId) {
    return beEvaluateHardObligation(root, workCwd, spec, obligationId, nodeEnv, adpOut, adpArgs, t0);
  }
  const obsFile = join(workCwd, '.donegate', 'adapters', spec.tool, 'observation.json');
  const obsRes = existsSync(obsFile) ? readJsonStrict(obsFile) : { ok: false };
  const advVerdict = obsRes.ok ? evaluateAdvisoryObservation(obsRes.value) : { exitCode: 0, detail: adpOut };
  return { exitCode: advVerdict.exitCode, durationMs: Date.now() - t0, diagSummary: `${spec.tool}: ${advVerdict.detail}`, watchArgs: adpArgs };
}

function beRunDefaultGuardSuite(root, workCwd, env, t0) {
  const localGuard = join(root, 'skill', 'check-module-integrity.mjs');
  const guardAbs = existsSync(localGuard) ? localGuard : join(DG_ROOT, 'skill', 'check-module-integrity.mjs');
  return beRunNodeArgs(workCwd, [guardAbs, '--root', workCwd], env, t0);
}

export function executeBrickGateNode(projectRoot, workCwd, node, wfEnv) {
  const root = resolve(projectRoot);
  const env = cleanGitEnv(wfEnv);
  ensureGitLocalIgnoreRuntimeDirs(workCwd);
  const t0 = Date.now();

  if (Array.isArray(node.exec?.nodeArgs)) {
    return beRunNodeArgs(workCwd, node.exec.nodeArgs, env, t0);
  }
  const spec = (node.exec && node.exec.kind) ? node.exec : buildBrickNodeExecSpec(node.tplId, node, root);
  if (spec.kind === 'donegate_cmd' || spec.kind === 'builtin_gate') {
    return beRunBuiltinOrDonegateCmd(root, workCwd, spec, node, env, t0);
  }
  if (spec.kind === 'external_bin') {
    return beRunExternalBin(workCwd, spec, env, t0);
  }
  if (spec.kind === 'adapter_node' && spec.entryRel) {
    return beRunAdapterNode(root, workCwd, spec, node, env, t0);
  }
  return beRunDefaultGuardSuite(root, workCwd, env, t0);
}
