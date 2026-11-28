// 契约生命周期命令（init / contract new / contract freeze / retire）及共享材料锚点原语（<= 350 行聚焦子模块）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';
import { validateContractSchema } from '../../skill/schema-lite.mjs';
import { installGitHooks } from '../../skill/install-hooks.mjs';
import { materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { appendChainEntry, readAndVerifyChain } from './chain.mjs';
import { DEFAULT_THRESHOLDS, computeProjectStatus, isSelfWriterIdentity } from './gates.mjs';
import { renderProgressBlock } from './progress.mjs';
import {
  lcCheckFreezeBatchQuota, lcExecuteContractSignoff,
  lcSealObligationsAndWrite, lcValidateObligationsForFreeze
} from './contract-freeze.mjs';
import { snapshotFrozenTests } from './heldout-test-guard.mjs';
import { detectRepoStackAndSmoke, discoverExistingRepoStarterContracts } from './init-discover.mjs';

export function gitAnchorInfo(projectRoot) {
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

export function collectMaterialList(projectRoot, contract) {
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

export function buildGate0ActionHint(fails) {
  const actions = [];
  if (fails.some((f) => f.startsWith('0.1') || f.startsWith('链 F'))) actions.push('补齐 INTENT.md 四节与 CONSTRAINTS.md 合规约束');
  if (fails.some((f) => f.startsWith('0.2'))) actions.push('在 decisions/ 最新决策记录中记入当前 INTENT.md 或 CONSTRAINTS.md 的 12 位哈希');
  if (fails.some((f) => f.startsWith('0.3'))) actions.push('优先做 gaps 前 3 位的契约，或在本契约顶层填写 skipReason');
  if (fails.some((f) => f.startsWith('0.4'))) actions.push('补齐 HANDOVER.md 六节及「### 接收方验收记录」四要素');
  return actions.join('；') || '按门 0 失败项逐条补齐前置条件后再试';
}

export function buildGate2ActionHint(fails, contractId) {
  const actions = [];
  if (fails.some((f) => f.startsWith('2.2'))) actions.push(`由人类裁方执行 contract freeze ${contractId} --by <裁方> 重新签字锁定判据`);
  if (fails.some((f) => f.startsWith('2.4'))) actions.push('在契约 obligations 中补齐「正常 / 边界 / 异常」三类 inputClasses');
  if (fails.some((f) => f.startsWith('2.5'))) actions.push(`先执行 teeth ${contractId} <判据id> 完成有牙实验并提交干净树`);
  if (fails.some((f) => f.startsWith('2.6'))) actions.push('至少在一条跨模块判据上声明 spansContracts（≥2 个有效契约）');
  if (fails.some((f) => f.startsWith('2.7'))) actions.push('核对每条判据 servesSuccessCriterion 与 INTENT.md 原文一致');
  if (fails.some((f) => f.startsWith('2.8'))) actions.push('拆分本次变更使单轮代码加行数不超过 maxDiffLines');
  if (fails.some((f) => f.startsWith('2.9'))) actions.push('人工勾选 alignment.json 全部条目');
  if (fails.some((f) => f.startsWith('链 G'))) actions.push('人工复核 INTENT.md 并更新 <!-- reviewed: YYYY-MM-DD --> 标记');
  return actions.join('；') || '按门 2 报错逐项修复后再执行 check';
}

export function collectOrderedIncompleteContractGaps(projectRoot) {
  const st = computeProjectStatus(projectRoot);
  const gaps = [];
  for (const c of st.contractSummaries) {
    if (c.retired || c.track === 'explore') continue;
    if (c.obligations.length === 0) gaps.push({ contractId: c.id });
    for (const o of c.obligations) {
      if (o.state !== '通过' || o.pendingRecheck || o.subclass === 'A2' || o.subclass === 'A3') {
        gaps.push({ contractId: c.id });
      }
    }
    if (!c.signedOff && c.state === '通过') gaps.push({ contractId: c.id });
  }
  for (const oc of st.orphanContracts) gaps.push({ contractId: oc });
  return gaps;
}

const REPO_RECIPE_FILE_SEGMENTS = ['.donegate', 'repo-recipe.json'];
const NO_PACKAGE_JSON_SENTINEL = 'no-package-json';

function lcComputePackageJsonHash(projectRoot) {
  const pkgPath = join(resolve(projectRoot), 'package.json');
  if (!existsSync(pkgPath)) return NO_PACKAGE_JSON_SENTINEL;
  return sha256(readFileSync(pkgPath));
}

export function saveVerifiedRepoRecipe(projectRoot, recipe = {}) {
  const rootAbs = resolve(projectRoot);
  const recipePath = join(rootAbs, ...REPO_RECIPE_FILE_SEGMENTS);
  mkdirSync(join(rootAbs, '.donegate'), { recursive: true });
  const payload = {
    installCmd: String(recipe.installCmd ?? ''),
    buildCmd: String(recipe.buildCmd ?? ''),
    devServerCmd: String(recipe.devServerCmd ?? ''),
    testCmd: String(recipe.testCmd ?? ''),
    verifiedAt: String(recipe.verifiedAt || new Date().toISOString()),
    packageJsonHash: String(recipe.packageJsonHash || lcComputePackageJsonHash(rootAbs))
  };
  writeFileSync(recipePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

export function loadCachedRepoRecipe(projectRoot) {
  const rootAbs = resolve(projectRoot);
  const recipePath = join(rootAbs, ...REPO_RECIPE_FILE_SEGMENTS);
  if (!existsSync(recipePath)) return null;
  const parsed = readJsonStrict(recipePath);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return null;
  if (parsed.value.packageJsonHash !== lcComputePackageJsonHash(rootAbs)) return null;
  return parsed.value;
}

function lcInferInstallCmd(rootAbs, hasPkg) {
  if (!hasPkg) return '';
  if (existsSync(join(rootAbs, 'pnpm-lock.yaml'))) return 'pnpm install';
  if (existsSync(join(rootAbs, 'yarn.lock'))) return 'yarn install';
  return 'npm install';
}

function lcSaveInitialRepoRecipe(projectRoot, defaultSmokeCmd) {
  const rootAbs = resolve(projectRoot);
  const pkgPath = join(rootAbs, 'package.json');
  const pkgRes = existsSync(pkgPath) ? readJsonStrict(pkgPath) : { ok: false };
  const scripts = (pkgRes.ok && pkgRes.value?.scripts && typeof pkgRes.value.scripts === 'object') ? pkgRes.value.scripts : {};
  return saveVerifiedRepoRecipe(rootAbs, {
    installCmd: lcInferInstallCmd(rootAbs, pkgRes.ok),
    buildCmd: scripts.build ? 'npm run build' : '',
    devServerCmd: scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : ''),
    testCmd: defaultSmokeCmd
  });
}

export function cmdInit(projectRoot, opts = {}) {
  if (existsSync(join(projectRoot, 'INTENT.md')) || existsSync(join(projectRoot, 'contracts'))) {
    return { exitCode: 3, stdout: '拒绝初始化：INTENT.md 或 contracts/ 已存在（§八 退 3，不覆盖）' };
  }
  mkdirSync(join(projectRoot, 'contracts'), { recursive: true });
  mkdirSync(join(projectRoot, 'functions'), { recursive: true });
  mkdirSync(join(projectRoot, 'decisions'), { recursive: true });
  mkdirSync(join(projectRoot, '.donegate', 'scratch'), { recursive: true });

  const cachedRecipe = loadCachedRepoRecipe(projectRoot);
  const discovered = opts.discover ? discoverExistingRepoStarterContracts(projectRoot) : null;
  const defaultSmokeCmd = discovered
    ? discovered.smokeCmd
    : (cachedRecipe?.testCmd || detectRepoStackAndSmoke(projectRoot).smokeCmd);
  const repoRecipe = cachedRecipe || lcSaveInitialRepoRecipe(projectRoot, defaultSmokeCmd);

  writeFileSync(join(projectRoot, 'INTENT.md'), [
    '# 项目意图', '',
    '## 为什么做', '（请填写一句话说明为什么做）', '',
    '## 服务谁', '（请填写具体的人或角色，不写「用户」）', '',
    '## 什么算成功', '- （请填写至少一条可外部观察的成功判据）', '',
    '## 明确不做什么', '- （请填写至少一条明确不做的边界）', '',
    `冒烟命令：${defaultSmokeCmd}`, ''
  ].join('\n'));
  writeFileSync(join(projectRoot, 'CONSTRAINTS.md'), [
    '# 约束', '',
    '必须 子进程直读退出码，不经包管理器包装。',
    '不许 改判据或测试文件来凑绿。', ''
  ].join('\n'));
  writeFileSync(join(projectRoot, 'thresholds.json'), JSON.stringify(DEFAULT_THRESHOLDS, null, 2) + '\n');
  writeFileSync(join(projectRoot, '.donegate', 'chain.jsonl'), '');
  writeFileSync(join(projectRoot, '.donegate', 'escapes.jsonl'), '');
  installGitHooks(projectRoot);

  const discoverLines = discovered
    ? [
      '',
      `🔍 存量逆向建图（--discover · 技术栈=${discovered.stack} · 源码=${discovered.totalCodeFiles} / 测试=${discovered.totalTestFiles}）：`,
      ...(discovered.contracts.length > 0
        ? discovered.contracts.map((c) => `  - contracts/${c.id}/contract.json [track=explore] (${c.fileCount} 文件 | ${c.obligationCount} 条起步单测${c.dependsOn.length ? ` | 依赖: ${c.dependsOn.join(', ')}` : ''})`)
        : ['  - （未探测到存量源码目录，可按需执行 contract new 建卡）']),
      '  下一步：运行 donegate status / donegate graph --router / donegate brief 查看全局骨架，确认边界后用 contract promote <id> --by <姓名> 晋升冻结。'
    ].join('\n')
    : '';

  return {
    exitCode: 0,
    repoRecipe,
    ...(discovered ? { discovered } : {}),
    stdout: '已初始化：\n  INTENT.md\n  CONSTRAINTS.md\n  thresholds.json\n  contracts/\n  functions/\n  decisions/\n  .donegate/chain.jsonl\n  .donegate/escapes.jsonl\n  .githooks/pre-commit' +
      discoverLines + '\n\n' +
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
  const isExplore = Boolean(opts.explore);
  const ttlDays = Math.max(1, Number(opts.ttlDays) || 7);
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const goldenSnapshots = opts.golden ? String(opts.golden).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const contractObj = {
    id,
    title: opts.title || id,
    why: opts.why || (isExplore ? '探索期试错契约（使用 Golden Master / 快照验证，收敛后 promote 冻结）。' : '待补充：三行以内说明为什么需要本契约。'),
    scope: opts.scope ? opts.scope.split(',').map((s) => s.trim()).filter(Boolean) : [],
    owner: opts.owner || '业主',
    dependsOn: opts.dependsOn ? opts.dependsOn.split(',').map((s) => s.trim()).filter(Boolean) : [],
    provisional: true,
    ...(isExplore ? { track: 'explore', exploreMeta: { ttlDays, createdAt: new Date().toISOString(), expiresAt, goldenSnapshots } } : {}),
    obligations: []
  };
  writeFileSync(cPath, JSON.stringify(contractObj, null, 2) + '\n');
  const prog = existsSync(join(projectRoot, 'INTENT.md'))
    ? '\n\n' + renderProgressBlock(projectRoot, { focusContractId: id, headline: `✅ [1-2] 已建模块「${contractObj.title}」 · 总进度 {{PCT}}` })
    : '';
  const modeTag = isExplore ? `track=explore, TTL=${ttlDays}天，不计交付算数` : 'provisional=true';
  return { exitCode: 0, stdout: `契约已创建：contracts/${id}/contract.json（${modeTag}）${prog}`, path: cPath };
}

export function cmdContractPromote(projectRoot, opts) {
  const id = opts.id;
  if (!id) return { exitCode: 1, stderr: '缺少契约标识' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const origRaw = readFileSync(cPath, 'utf8');
  const contract = res.value;
  if (contract.track !== 'explore') {
    return { exitCode: 1, stderr: `契约 ${id} 不是探索态（track=${contract.track || 'delivery'}），无需 promote` };
  }
  if (!opts.by || !opts.by.trim() || isSelfWriterIdentity(opts.by)) {
    return { exitCode: 1, stderr: 'G-10 晋升冻结必须由人类裁方签字（--by <裁方姓名>，禁 AI 代签）' };
  }
  const chainChk = readAndVerifyChain(projectRoot);
  if (!chainChk.ok) return { exitCode: chainChk.exitCode || 2, stderr: chainChk.reason };
  const candidate = {
    ...contract,
    track: 'delivery',
    provisional: false,
    exploreMeta: { ...(contract.exploreMeta || {}), promotedAt: new Date().toISOString(), promotedBy: opts.by.trim() }
  };
  const schemaErrs = validateContractSchema(candidate, { full: true }).filter((e) => !/\/obligations\/\d+\/(?:frozenHash|signedBy):/.test(e));
  if (schemaErrs.length > 0) {
    return { exitCode: 1, stderr: `探索契约 ${id} 尚不满足正式交付 11 字段要求，拒绝晋升：\n  - ${schemaErrs.join('\n  - ')}` };
  }
  writeFileSync(cPath, JSON.stringify(candidate, null, 2) + '\n');
  const frz = cmdContractFreeze(projectRoot, { ...opts, forceBatch: true });
  if (frz.exitCode !== 0) {
    writeFileSync(cPath, origRaw, 'utf8');
    return frz;
  }
  return { ...frz, stdout: `🚀 探索契约 ${id} 已晋升为正式交付契约（track=delivery）\n${frz.stdout}` };
}

export function cmdContractFreeze(projectRoot, opts) {
  const { id, by } = opts;
  if (!id) return { exitCode: 1, stderr: '缺少契约标识' };
  if (!by || !by.trim()) return { exitCode: 1, stderr: '缺少签字人 --by' };
  if (isSelfWriterIdentity(by)) {
    return { exitCode: 1, stderr: `G-10 禁止本轮写方自己或 AI 代签（--by="${by.trim()}" 无效，必须由人类裁方签字）` };
  }
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const res = readJsonStrict(cPath);
  if (!res.ok) return { exitCode: res.error === 'parse' ? 2 : 3, stderr: '读取契约失败：' + cPath };
  const contract = res.value;
  const obs = Array.isArray(contract.obligations) ? contract.obligations : [];
  if (obs.length === 0) return { exitCode: 1, stderr: '契约没有 obligations，无法冻结' };
  if (opts.signoff) return lcExecuteContractSignoff(projectRoot, id, by, contract, obs, opts, collectMaterialList);

  const quotaErr = lcCheckFreezeBatchQuota(projectRoot, id, obs, opts);
  if (quotaErr) return quotaErr;
  const obErr = lcValidateObligationsForFreeze(obs);
  if (obErr) return obErr;

  const criteriaHashes = lcSealObligationsAndWrite(cPath, contract, obs, by);
  const anchor = gitAnchorInfo(projectRoot);
  const { frozenTestHashes, frozenScriptHashes } = snapshotFrozenTests(projectRoot, id, obs);
  const materials = collectMaterialList(projectRoot, contract);
  const preExistingCode = materials.map((m) => m.path).filter((p) => /\.(mjs|cjs|js|ts|tsx|jsx|py|go)$/i.test(p));
  const legacyNotice = preExistingCode.length > 0 && !opts.legacy
    ? `\n⚠ 注意：冻结前作用域已存在 ${preExistingCode.length} 个源码文件（${preExistingCode.slice(0, 3).join(', ')}）；若非存量迁移请加 --legacy 留痕`
    : '';
  const app = appendChainEntry(projectRoot, {
    kind: 'freeze', contractId: id, signedBy: by.trim(), freezeCommit: anchor.head,
    legacyMigration: Boolean(opts.legacy), preExistingCodeCount: preExistingCode.length,
    criteriaHashes,
    ...(Object.keys(frozenTestHashes).length > 0 ? { frozenTestHashes } : {}),
    ...(frozenScriptHashes ? { frozenScriptHashes } : {}),
    materialFingerprint: materialFingerprintOf(materials)
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  const frozenList = obs.map((o) => `  ${o.id}  frozenHash=${o.frozenHash.slice(0, 12)}`).join('\n');
  const progress = renderProgressBlock(projectRoot, { focusContractId: id, headline: `🔒 「${contract.title || id}」${obs.length} 项验收标准已锁定 · 总进度 {{PCT}}` });
  return { exitCode: 0, stdout: `冻结 ${obs.length} 条（seq=${app.entry.seq}）：\n${frozenList}${legacyNotice}\n\n${progress}` };
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
