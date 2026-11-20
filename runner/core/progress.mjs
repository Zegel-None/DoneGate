// 全流程机械进度计算、报喜/报忧卡片渲染与开放扩展入口（零第三方依赖）
// 原则：进度百分比与机械状态完全由真实文件与退出码派生；开放入口（.donegate/notes.jsonl 与 extraItems）
// 供用户项目自己的 Agent 补充阶段性报喜或报忧，但绝不篡改机械计算的百分比与状态词（守住 INV-01）。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProjectStatus } from './gates.mjs';
import { readMaybe } from '../../skill/io.mjs';

function makeBar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function summarizeObligationLabel(o) {
  const raw = (o.claim || o.id || '').trim().replace(/\s+/g, ' ');
  return raw.length > 36 ? raw.slice(0, 35) + '…' : raw;
}

const NOTE_ICONS = { good: '✅', worry: '⚠️', alert: '🚨' };

export function loadCustomNotes(projectRoot) {
  const p = join(projectRoot, '.donegate', 'notes.jsonl');
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj.title === 'string' && obj.title.trim()) out.push(obj);
    } catch { /* ignore corrupted line */ }
  }
  return out;
}

export function appendProgressNote(projectRoot, note) {
  const kind = ['good', 'worry', 'alert'].includes(note?.kind) ? note.kind : null;
  const stage = Number(note?.stage);
  const title = typeof note?.title === 'string' ? note.title.trim() : '';
  if (!kind) return { ok: false, reason: 'kind 必须是 good | worry | alert' };
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) return { ok: false, reason: 'stage 必须是 1 | 2 | 3 | 4' };
  if (!title) return { ok: false, reason: 'title 不能为空' };
  const dir = join(projectRoot, '.donegate');
  mkdirSync(dir, { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    kind,
    stage,
    title,
    detail: typeof note?.detail === 'string' ? note.detail.trim() : '',
    source: typeof note?.source === 'string' && note.source.trim() ? note.source.trim() : 'agent'
  };
  appendFileSync(join(dir, 'notes.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  return { ok: true, entry };
}

export function clearCustomNotes(projectRoot, stage = null) {
  const p = join(projectRoot, '.donegate', 'notes.jsonl');
  if (!existsSync(p)) return 0;
  if (stage === null) {
    const n = loadCustomNotes(projectRoot).length;
    writeFileSync(p, '', 'utf8');
    return n;
  }
  const kept = loadCustomNotes(projectRoot).filter((x) => Number(x.stage) !== Number(stage));
  writeFileSync(p, kept.map((x) => JSON.stringify(x)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
  return kept.length;
}

export function computeProgressSnapshot(projectRoot, precomputedSt = null) {
  const hasInit = existsSync(join(projectRoot, 'INTENT.md')) &&
    existsSync(join(projectRoot, 'CONSTRAINTS.md')) &&
    existsSync(join(projectRoot, '.donegate', 'chain.jsonl'));

  const intentText = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const intentFilled = hasInit && !intentText.includes('（请填写一句话说明为什么做）');

  const st = precomputedSt || (hasInit ? computeProjectStatus(projectRoot) : null);
  const activeContracts = st ? st.contractSummaries.filter((c) => !c.retired) : [];
  const rawContracts = st ? st.contracts.filter((c) => !c.retired) : [];
  const rawMap = new Map(rawContracts.map((c) => [c.id, c]));
  const chainEntries = st && st.chainRes?.ok ? st.chainRes.entries : [];

  // 阶段 1（10%）：init 5% + 至少建了 1 个活跃契约（或意图已填写）5%
  const s1Item1 = hasInit;
  const s1Item2 = activeContracts.length > 0 || intentFilled;
  const s1Pct = (s1Item1 ? 5 : 0) + (s1Item2 ? 5 : 0);

  // 阶段 2（60%）：按全部活跃契约均分（frozen 占 20%，逐条真实通过占 80%）
  let s2Pct = 0;
  const contractProgress = activeContracts.map((c) => {
    const raw = rawMap.get(c.id) || {};
    const obs = c.obligations || [];
    const frozen = obs.length > 0 &&
      (raw.obligations || []).every((o) => Boolean(o.frozenHash && o.signedBy));
    const passedClean = obs.filter((o) => o.state === '通过').length;
    const totalObs = obs.length;
    const cmdObs = obs.filter((o) => o.kind === 'command' && o.teeth !== 'ignored');
    const teethDone = cmdObs.filter((o) => o.teeth === 'killed').length;
    const verifiedPass = chainEntries.some((e) => e.kind === 'verify-result' && e.contractId === c.id && e.result === 'pass');

    const ratio = totalObs === 0 ? 0 : (frozen ? 0.2 : 0) + 0.8 * (passedClean / totalObs);
    return {
      id: c.id,
      title: c.title || c.id,
      state: c.state,
      frozen,
      passedClean,
      totalObs,
      cmdCount: cmdObs.length,
      teethDone,
      verifiedPass,
      cleared: c.cleared,
      obligations: obs,
      ratio
    };
  });
  if (contractProgress.length > 0) {
    const avgRatio = contractProgress.reduce((s, c) => s + c.ratio, 0) / contractProgress.length;
    s2Pct = Math.round(60 * avgRatio);
  }

  // 阶段 3（20%）：防假绿（有牙实验）10% + 影响面/外部工具体检 10%
  const totalCmds = contractProgress.reduce((s, c) => s + c.cmdCount, 0);
  const totalTeeth = contractProgress.reduce((s, c) => s + c.teethDone, 0);
  const s3Item1Pct = totalCmds > 0 ? Math.round(10 * (totalTeeth / totalCmds)) : 0;

  const adpDir = join(projectRoot, '.donegate', 'adapters');
  let adapterCount = 0;
  if (existsSync(adpDir)) {
    for (const e of readdirSync(adpDir, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(adpDir, e.name, 'claim.json'))) adapterCount++;
    }
  }
  const hasImpactOrAdapter = adapterCount > 0 || (st && st.autoImpact?.impacted?.length > 0);
  const s3Item2Pct = hasImpactOrAdapter ? 10 : (totalTeeth > 0 ? 5 : 0);
  const s3Pct = s3Item1Pct + s3Item2Pct;

  // 阶段 4（10%）：独立复核（verify apply pass）5% + 交接包（HANDOVER.md）5%
  const verifiedCount = contractProgress.filter((c) => c.verifiedPass).length;
  const s4Item1Pct = contractProgress.length > 0 ? Math.round(5 * (verifiedCount / contractProgress.length)) : 0;
  const hasHandover = existsSync(join(projectRoot, 'HANDOVER.md')) && (readMaybe(join(projectRoot, 'HANDOVER.md')) || '').trim().length > 0;
  const s4Item2Pct = hasHandover ? 5 : 0;
  const s4Pct = s4Item1Pct + s4Item2Pct;

  const totalPct = Math.max(0, Math.min(100, s1Pct + s2Pct + s3Pct + s4Pct));

  return {
    totalPct,
    bar: makeBar(totalPct),
    hasInit,
    s1Item1,
    s1Item2,
    contractProgress,
    totalCmds,
    totalTeeth,
    adapterCount,
    verifiedCount,
    hasHandover
  };
}

function appendStageNotes(lines, stageNo, allNotes) {
  const mine = allNotes.filter((n) => Number(n.stage) === stageNo);
  for (const n of mine) {
    const icon = NOTE_ICONS[n.kind] || '💬';
    const tag = n.kind === 'good' ? '补充' : (n.kind === 'alert' ? '告警' : '报忧');
    const detail = n.detail ? `（${n.detail}）` : '';
    lines.push(`  ${stageNo}-💬 ${icon} [${tag}] ${n.title}${detail}`);
  }
}

export function renderProgressBlock(projectRoot, opts = {}) {
  const snap = computeProgressSnapshot(projectRoot, opts.statusData || null);
  const customNotes = [...loadCustomNotes(projectRoot), ...(Array.isArray(opts.extraItems) ? opts.extraItems : [])];
  const hasStageNotes = (s) => customNotes.some((n) => Number(n.stage) === s);

  const lines = [
    `#### 📊 DoneGate · 验收进度   ${snap.bar} ${snap.totalPct}%`
  ];
  if (opts.headline) {
    lines.push(opts.headline.replaceAll('{{PCT}}', `${snap.totalPct}% ${snap.bar}`));
  }

  // 阶段 1：立项与规划
  const s1Done = (snap.s1Item1 ? 1 : 0) + (snap.s1Item2 ? 1 : 0);
  if (s1Done === 2 && snap.contractProgress.length > 0 && !hasStageNotes(1) && opts.activeStage !== 1) {
    lines.push(`阶段 1：立项与规划（✅ 2/2 完成）`);
  } else {
    lines.push(`阶段 1：立项与规划（${s1Done === 2 ? '✅' : '🔄'} ${s1Done}/2）`);
    lines.push(`  1-1 ${snap.s1Item1 ? '✅' : '⏳'} 目标与禁区文件已初始化（INTENT / CONSTRAINTS / escapes）`);
    lines.push(`  1-2 ${snap.s1Item2 ? '✅' : '⏳'} 拆出验收模块（当前 ${snap.contractProgress.length} 个）`);
    appendStageNotes(lines, 1, customNotes);
  }

  // 阶段 2：各模块开发与验收（动态读取用户真实契约名与判据）
  const cDoneCount = snap.contractProgress.filter((c) => c.totalObs > 0 && c.passedClean === c.totalObs && c.frozen).length;
  const cTotal = snap.contractProgress.length;
  if (cTotal === 0) {
    lines.push(`阶段 2：功能开发与验收（⏳ 待建首个契约模块）`);
    appendStageNotes(lines, 2, customNotes);
  } else if (cDoneCount === cTotal && !opts.focusContractId && !hasStageNotes(2) && opts.activeStage !== 2) {
    lines.push(`阶段 2：功能开发与验收（✅ ${cDoneCount}/${cTotal} 模块检查全绿）`);
  } else {
    lines.push(`阶段 2：功能开发与验收（${cDoneCount === cTotal ? '✅' : '🔄'} ${cDoneCount}/${cTotal} 模块全绿）`);
    snap.contractProgress.forEach((c, idx) => {
      const icon = c.totalObs > 0 && c.passedClean === c.totalObs && c.frozen
        ? '✅'
        : (c.obligations.some((o) => o.state === '未通过' || o.state === '无法判断') ? '⚠️' : (c.frozen || c.passedClean > 0 ? '🔄' : '⏳'));
      const detail = c.totalObs === 0
        ? '待补验收项'
        : (c.frozen ? `${c.passedClean}/${c.totalObs} 项通过` : `待锁定（${c.totalObs} 项）`);
      lines.push(`  2-${idx + 1} ${icon} ${c.title}（${detail}）`);
      if (opts.focusContractId === c.id && c.obligations.length > 0) {
        c.obligations.forEach((o, j) => {
          const oIcon = o.state === '通过' ? '✅' : (o.state === '未通过' ? '❌' : (o.state === '过期' || o.state === '无法判断' ? '⚠️' : '⏳'));
          lines.push(`    2-${idx + 1}.${j + 1} ${oIcon} ${summarizeObligationLabel(o)}`);
        });
      }
    });
    appendStageNotes(lines, 2, customNotes);
  }

  // 阶段 3：防假绿与体检
  const teethDone = snap.totalCmds > 0 && snap.totalTeeth === snap.totalCmds;
  const s3Done = (teethDone ? 1 : 0) + (snap.adapterCount > 0 ? 1 : 0);
  if (s3Done === 2 && !hasStageNotes(3) && opts.activeStage !== 3) {
    lines.push(`阶段 3：防假绿与体检（✅ 2/2 完成）`);
  } else if (cTotal === 0 && !hasStageNotes(3) && opts.activeStage !== 3) {
    lines.push(`阶段 3：防假绿与体检（⏳ 待开始 0/2）`);
  } else if (cDoneCount === 0 && snap.totalTeeth === 0 && snap.adapterCount === 0 && !hasStageNotes(3) && opts.activeStage !== 3) {
    lines.push(`阶段 3：防假绿与体检（⏳ 待开始 0/2）`);
  } else {
    lines.push(`阶段 3：防假绿与体检（🔄 ${s3Done}/2）`);
    lines.push(`  3-1 ${teethDone ? '✅' : (snap.totalTeeth > 0 ? '🔄' : '⏳')} 变异验证防假绿（${snap.totalTeeth}/${snap.totalCmds} 项已检出改坏代码）`);
    lines.push(`  3-2 ${snap.adapterCount > 0 ? '✅' : '⏳'} 影响面与外部工具体检（已入账 ${snap.adapterCount} 项）`);
    appendStageNotes(lines, 3, customNotes);
  }

  // 阶段 4：独立复核与收尾
  const allVerified = cTotal > 0 && snap.verifiedCount === cTotal;
  const s4Done = (allVerified ? 1 : 0) + (snap.hasHandover ? 1 : 0);
  if (s4Done === 2 && !hasStageNotes(4) && opts.activeStage !== 4) {
    lines.push(`阶段 4：独立复核与收尾（✅ 2/2 完成）`);
  } else if (s4Done === 0 && cDoneCount === 0 && !hasStageNotes(4) && opts.activeStage !== 4) {
    lines.push(`阶段 4：独立复核与收尾（⏳ 待开始 0/2）`);
  } else {
    lines.push(`阶段 4：独立复核与收尾（${s4Done === 2 ? '✅' : '🔄'} ${s4Done}/2）`);
    lines.push(`  4-1 ${allVerified ? '✅' : (snap.verifiedCount > 0 ? '🔄' : '⏳')} 独立 AI 盲审通过（${snap.verifiedCount}/${cTotal} 模块）`);
    lines.push(`  4-2 ${snap.hasHandover ? '✅' : '⏳'} 交接包生成与收尾归档`);
    appendStageNotes(lines, 4, customNotes);
  }

  return lines.join('\n');
}

// ── 统一报忧卡片渲染（对应退出码 3 阻断提醒 / 1 检查未通过 / 2 严重事故） ──
export function renderWorryBlock(projectRoot, opts = {}) {
  const exitCode = opts.exitCode ?? 1;
  const stage = opts.stage || 2;
  const icon = exitCode === 2 ? '🚨' : (exitCode === 3 ? '⚠️' : '❌');
  const levelLabel = exitCode === 2 ? '严重事故（立即停下核查）' : (exitCode === 3 ? '阻断提醒（前置未备齐，进度已暂停）' : '检查未通过（需修复后重跑）');
  let pctLine = '░░░░░░░░░░ 0%';
  try {
    const snap = computeProgressSnapshot(projectRoot);
    pctLine = `${snap.bar} ${snap.totalPct}%`;
  } catch { /* ignore if project uninitialized or corrupt */ }

  const out = [
    `#### ${icon} DoneGate · 进度受阻（${levelLabel}）   ${pctLine}`,
    `阶段 ${stage}：${opts.stageTitle || '当前环节受阻'}`,
    `  ${stage}-! ${icon} ${opts.title || '执行未通过'}`
  ];
  if (opts.reason) out.push(`  原因：${opts.reason}`);
  if (opts.action) out.push(`  下一步：${opts.action}`);
  return out.join('\n');
}
