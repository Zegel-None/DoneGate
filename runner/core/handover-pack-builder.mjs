// 交接包文档渲染与门 5 复核包 diff/打包构建子模块（供 cmd-handover-verify.mjs 委托，<= 350 行）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMaybe } from '../../skill/io.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { readAndVerifyChain } from './chain.mjs';
import { hvResolveHeldOutBaselineRef, verifyHeldOutContract } from './heldout-verifier.mjs';
import { sanitizeReviewEvidence, stripCrossSessionReasoning } from './review-evidence-sanitizer.mjs';

const HPB_SECURITY_PATH_RE = /(?:^|\/)(?:\.githooks\/|hooks?\/|auth|security|sandbox|isolation|egress|proxy|guard|crypto|token|secret|permission|acl)|(?:auth|guard|sandbox|isolation|egress|proxy|verify-consensus|heldout)[^/]*\.[a-z0-9]+$/i;
const HPB_UI_PATH_RE = /(?:^|\/)(?:uiboard|atlas|frontend|web|ui|components|views|pages|public|assets|styles)\/|\.(?:html|css|scss|less|tsx|jsx|vue|svelte)$/i;
const HPB_MAX_ANCESTOR_HOPS = 6;

function hvReadLastEscapePitfall(projectRoot) {
  const fallback = '不要跳过冻结判据或用 || true 吞掉失败退出码，因为核侧会直接拒收。';
  const escPath = join(projectRoot, '.donegate', 'escapes.jsonl');
  if (!existsSync(escPath)) return fallback;
  const escLines = readFileSync(escPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (escLines.length === 0) return fallback;
  try {
    const lastEsc = JSON.parse(escLines[escLines.length - 1]);
    if (lastEsc?.symptom && lastEsc?.rootCause) {
      return `注意避免「${lastEsc.symptom}」，因为根因是「${lastEsc.rootCause}」。`;
    }
  } catch (err) {
    void err;
  }
  return fallback;
}

export function hvRenderHandoverMarkdown(st, gaps, decs, smokeCmd, nextContract, dgBin, govCautionMd, opts) {
  const unverifiedOrPending = gaps.filter((g) => ['unverified', 'pending-recheck', 'expired', 'unknown'].includes(g.kind));
  const humanLabel = st.humanStats.N === 0 ? '0 项（无）' : `${st.humanStats.pass}/${st.humanStats.N}`;
  return [
    '# HANDOVER · 项目交接包', '',
    ...(govCautionMd ? [govCautionMd, ''] : []),
    '## 一、当前状态',
    st.ledgerLines[0],
    st.ledgerLines[1],
    `人工判据：${humanLabel}（独立列，不混入自动比例）`,
    st.funcLine,
    st.j3Line, '',
    '## 二、下一个该做的',
    gaps.length ? `优先处理：${gaps[0].detail}` : '当前无阻塞缺口，可进入交付或维护。', '',
    '## 三、未定事项',
    unverifiedOrPending.length ? unverifiedOrPending.map((g) => `- ${g.detail}`).join('\n') : '- 无未定事项', '',
    '## 四、最近三条决策',
    decs.length ? decs.map((d) => `- ${d}`).join('\n') : '- 暂无 decisions/ 记录', '',
    '## 五、已知缺口与不覆盖范围',
    gaps.length ? gaps.map((g) => `- [${g.kind}] ${g.detail}`).join('\n') : '- 缺口 0 条',
    '- **本交接包不覆盖**：契约 `scope` 之外的未认领底座代码、以及未写出可观察判据的主观视觉/手感体验。', '',
    '## 六、怎么跑起来',
    '```powershell',
    smokeCmd,
    `node ${dgBin} check ${nextContract}`,
    `node ${dgBin} status`,
    '```', '',
    '### 接收方验收记录',
    `- 谁跑的：${opts.receiver || '（待接收方填写）'}`,
    `- 跑的命令原文：${opts.ranCommand || smokeCmd}`,
    `- 看到的输出：${opts.observedOutput || '（待接收方填写实测输出）'}`,
    `- 卡住的格：${opts.stuckAt || '无'}`, ''
  ].join('\n');
}

export function hvBuildNextTurnInjectBlock(projectRoot, st, gaps, intent, smokeCmd, nextContract, dgBin) {
  const intentLines = stripCrossSessionReasoning(intent).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('（'));
  const intentBrief = intentLines[0] || '按当前契约与判据推进开发';
  const consText = readMaybe(join(projectRoot, 'CONSTRAINTS.md')) || '';
  const consRules = consText.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(不许|必须)/.test(l)).slice(0, 2);
  const lastPitfall = stripCrossSessionReasoning(hvReadLastEscapePitfall(projectRoot));
  const completed = st.contractSummaries.filter((c) => !c.retired && c.state === '通过');
  const doneText = completed.length ? completed.map((c) => `${c.id}（${c.title}）`).join('、') : '尚无已通关模块，刚完成项目基线初始化';
  const focusGap = stripCrossSessionReasoning(gaps[0]?.detail || `推进契约 ${nextContract} 并补齐全部验收项`);
  const ruleText = consRules.length ? consRules.join('；') : '子进程直读退出码、不许改判据凑绿';
  return [
    '### 📋 下一棒直接注入上下文块（高熵完整句 · 防缺主谓宾瞎猜）',
    '```text',
    `1. 项目与红线：本项目核心目标是「${intentBrief}」；你必须严守红线：${ruleText}。`,
    `2. 上一轮进展：已完成 ${doneText}；本轮总账为「${st.ledgerLines[0]}」，交互看板已刷新在 .donegate/dashboard.html。`,
    `3. 本轮唯一目标：请接手契约「${nextContract}」，当前首要阻塞是「${focusGap}」；修改代码必须限制在该契约 scope 内。`,
    `4. 防踩坑约束：${lastPitfall}`,
    `5. 起手第一条命令：先执行 ${smokeCmd} && node ${dgBin} status 核对最新实况，再开始动手。`,
    '```'
  ].join('\n');
}

function hvResolvePackBaseRev(projectRoot, id, headRev, opts) {
  if (opts.base) {
    const bRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.base], { encoding: 'utf8' });
    if (bRes.status !== 0) return { ok: false, exitCode: 3, stderr: '无法解析 --base 提交：' + opts.base };
    return { ok: true, baseRev: bRes.stdout.trim() };
  }
  const chainRes = readAndVerifyChain(projectRoot);
  const freezeEntry = chainRes.ok ? chainRes.entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop() : null;
  if (freezeEntry && freezeEntry.freezeCommit && freezeEntry.freezeCommit !== headRev) {
    return { ok: true, baseRev: freezeEntry.freezeCommit };
  }
  const prevRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' });
  return { ok: true, baseRev: prevRes.status === 0 ? prevRes.stdout.trim() : '4b825dc642cb6eb9a060e54bf8d69288fbee4904' };
}

export function hvBuildPackGitDiff(projectRoot, id, contract, opts) {
  const gitHead = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.head || 'HEAD'], { encoding: 'utf8' });
  if (gitHead.status !== 0) {
    return { ok: false, exitCode: 3, stderr: '当前目录不是有效 git 仓库或无提交历史，无法生成 base..head（退 3）' };
  }
  const headRev = gitHead.stdout.trim();
  const baseRes = hvResolvePackBaseRev(projectRoot, id, headRev, opts);
  if (!baseRes.ok) return baseRes;
  const baseRev = baseRes.baseRev;
  const versText = `base ${baseRev}\nhead ${headRev}\n`;
  const heldOutBaseRef = hvResolveHeldOutBaselineRef(projectRoot, id, baseRev, headRev);
  const touchedR = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', 'diff', '--name-only', `${baseRev}..${headRev}`], { encoding: 'utf8', windowsHide: true });
  const touchedFiles = touchedR.status === 0 ? String(touchedR.stdout || '').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean) : [];
  const hoRes = verifyHeldOutContract(projectRoot, contract, { baseRef: heldOutBaseRef, heldOutDir: opts.heldOutDir, touchedFiles });
  if (!hoRes.ok) return { ok: false, exitCode: 2, code: hoRes.code, stderr: hoRes.fails.join('\n') };
  const d1 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', '.', ':(exclude)contracts'], { encoding: 'utf8' }).stdout || '';
  const d2 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', `contracts/${id}`], { encoding: 'utf8' }).stdout || '';
  const diffText = [d1.trimEnd(), d2.trimEnd()].filter(Boolean).join('\n') + '\n';
  if (!diffText.trim()) {
    return { ok: false, exitCode: 3, stderr: 'base..head 无任何实际改动 diff（可能是空提交或冻结后未改动），拒绝生成空复核包，请指定 --base <commit>' };
  }
  return { ok: true, diffText, versText, touchedFiles };
}

function hvReadJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const out = [];
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch (err) {
      void err;
    }
  }
  return out;
}

function hvCountGuardEvent(ev, counters) {
  const code = String(ev.code || ev.reasonCode || ev.ruleId || ev.kind || ev.event || '').toUpperCase();
  const detail = String(ev.reason || ev.detail || ev.command || '');
  if (/SELF_SIGN|HUMAN_CLI|SOVEREIGN/.test(code) || /(?:contract\s+(?:freeze|promote)|verify\s+apply|代签|自签)/i.test(detail)) counters.selfSignAttemptCount++;
  else if (/FROZEN_TEST|HELDOUT_TEST|REVERTED_FROZEN/.test(code) || ev.revertedFrozenTest === true || /冻结测试|frozen.?test/i.test(detail)) counters.revertedFrozenTestTouches++;
  else if (/STOP_CIRCUIT|CIRCUIT_BREAK|MAX_STOP_STRIKES/.test(code)) counters.stopCircuitTrips++;
  else if (/BYPASS|NO_VERIFY|SKIP_GATES|TAMPER|DENY|BLOCK/.test(code) || ev.decision === 'deny' || ev.blocked === true) counters.blockedBypassCount++;
}

function hvFindRepoRoot(startPath, id) {
  let cur = startPath ? resolve(startPath) : '';
  for (let i = 0; cur && i <= HPB_MAX_ANCESTOR_HOPS; i++) {
    if (basename(cur) === '.donegate') return dirname(cur);
    if ((id && existsSync(join(cur, 'contracts', id, 'contract.json'))) || (existsSync(join(cur, 'INTENT.md')) && existsSync(join(cur, 'contracts')))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function hvEmitCompanionPackMeta(rootAbs, contractId, manifestBody, diffText) {
  const paths = [...String(diffText || '').matchAll(/^(?:diff --git a\/.+? b\/|\+\+\+ b\/)(.+)$/gm)].map((m) => m[1].trim()).filter((p) => p && p !== '/dev/null');
  const requiredDimensions = ['core-rubric'];
  if (paths.some((f) => HPB_SECURITY_PATH_RE.test(f))) requiredDimensions.push('security');
  if (paths.some((f) => HPB_UI_PATH_RE.test(f))) requiredDimensions.push('ui-live');
  const incidentCounters = { blockedBypassCount: 0, selfSignAttemptCount: 0, stopCircuitTrips: 0, revertedFrozenTestTouches: 0 };
  for (const ev of hvReadJsonl(join(rootAbs, '.donegate', 'guard-events.jsonl'))) hvCountGuardEvent(ev, incidentCounters);
  for (const note of hvReadJsonl(join(rootAbs, '.donegate', 'notes.jsonl'))) {
    if (note.kind !== 'worry') continue;
    const text = `${note.title || ''} ${note.detail || ''}`;
    if (/(?:防死锁放行|自动熔断|熔断放行|stopStrikes|circuit)/i.test(text)) incidentCounters.stopCircuitTrips++;
    if (/(?:冻结测试|frozen.?test)/i.test(text)) incidentCounters.revertedFrozenTestTouches++;
  }
  const requiresHeterogeneousJudge = Object.values(incidentCounters).some((n) => n > 0) || requiredDimensions.includes('security');
  const outDir = join(rootAbs, '.donegate', 'verify');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `pack-meta-${contractId}.json`), JSON.stringify({ schema: 'donegate-pack-meta/v1', contractId, packManifestSha256: sha256(manifestBody), requiredDimensions, incidentCounters, requiresHeterogeneousJudge }, null, 2) + '\n', 'utf8');
}

export function hvWriteVerifyPackFiles(packDir, id, contract, obs, diffText, versText, evPairs, opts = {}) {
  const filesWritten = [];
  const emit = (rel, content) => {
    const abs = join(packDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    filesWritten.push(rel.replace(/\\/g, '/'));
  };
  const defClaim = `# 完成声称（原文）\n\n本轮完成：契约 ${id} 全部 ${obs.length} 条判据已运行并留存三件套证据。`;
  const [cleanWhy, cleanClaim] = sanitizeReviewEvidence([String(contract.why ?? ''), String(opts.completionClaim ?? defClaim)]);
  emit(`criterion/${id}.json`, JSON.stringify({ id: contract.id, obligations: obs }, null, 2) + '\n');
  emit('contract-scope-why.md', `# 契约 ${id} 的 scope 与 why\n\n## scope\n${JSON.stringify(contract.scope)}\n\n## why\n${cleanWhy}\n`);
  emit('完成声称.md', `${cleanClaim}\n`);
  emit(`diff/${id}.diff`, diffText);
  emit('diff/versions.txt', versText);
  for (const ev of evPairs) {
    for (const part of ['start.json', 'report.json', 'end.json']) {
      emit(`evidence/${ev.oid}/${ev.runName}/${part}`, readFileSync(join(ev.latestRunDir, part), 'utf8'));
    }
  }
  const manifestBody = filesWritten.map((r) => sha256(readFileSync(join(packDir, r))) + '  ' + r).join('\n') + '\n';
  writeFileSync(join(packDir, 'MANIFEST.txt'), manifestBody, 'utf8');
  const rootAbs = opts.projectRoot ? resolve(opts.projectRoot) : (hvFindRepoRoot(evPairs?.[0]?.latestRunDir, id) || hvFindRepoRoot(packDir, id));
  if (rootAbs && resolve(join(rootAbs, '.donegate', 'verify')) !== resolve(packDir)) hvEmitCompanionPackMeta(rootAbs, id, manifestBody, diffText);
  return manifestBody;
}
