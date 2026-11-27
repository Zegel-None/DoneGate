// L1 全流程机械进度卡片渲染与开放便签门面出口（零第三方依赖，<= 350 行）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { invokeDashboardExporter } from './dashboard-hook.mjs';
import { gdCollectDisabledIntegrityRules, gdFormatIntegrityBannerText } from './governance-disclosure.mjs';
import { computeProgressSnapshot, loadCustomNotes } from './progress-notes.mjs';

export {
  appendProgressNote, checkNoteTextAntiLie, clearCustomNotes,
  computeProgressSnapshot, loadCustomNotes, verifyProjectNotes, verifySingleNoteOnDisk
} from './progress-notes.mjs';

const NOTE_ICONS = { good: '✅', worry: '⚠️', alert: '🚨' };
const PRG_NOTE_TAGS = { good: '补充·已验真', alert: '告警', worry: '报忧' };
const PRG_OB_ICONS = { 通过: '✅', 未通过: '❌', 过期: '⚠️', 无法判断: '⚠️' };
const prgStepIcon = (done, partial) => (done ? '✅' : (partial ? '🔄' : '⏳'));
const prgBoolIcon = (ok) => (ok ? '✅' : '⏳');

function summarizeObligationLabel(o) {
  const raw = (o.claim || o.id || '').trim().replace(/\s+/g, ' ');
  return raw.length > 36 ? raw.slice(0, 35) + '…' : raw;
}

function prgFormatGoodHint(n) {
  if (n.kind !== 'good' || n._verified === false) return '';
  return n.evidencePath ? ` [证据:${n.evidencePath}]` : (n.verifyCmd ? ' [实跑exit 0]' : '');
}

function appendStageNotes(lines, stageNo, allNotes) {
  for (const n of allNotes.filter((x) => Number(x.stage) === stageNo)) {
    const icon = NOTE_ICONS[n.kind] || '💬', tag = n._verified === false ? '拦截·未验真' : (PRG_NOTE_TAGS[n.kind] || '报忧');
    lines.push(`  ${stageNo}-💬 ${icon} [${tag}] ${n.title}${n.detail ? `（${n.detail}）` : ''}${prgFormatGoodHint(n)}`);
  }
}

const prgIsContractDone = (c) => c.totalObs > 0 && c.passedClean === c.totalObs && c.frozen;

function prgContractIcon(c) {
  if (prgIsContractDone(c)) return '✅';
  if (c.obligations.some((o) => o.state === '未通过' || o.state === '无法判断')) return '⚠️';
  return c.frozen || c.passedClean > 0 ? '🔄' : '⏳';
}

function prgSelectStage2Display(contractProgress, focusContractId) {
  const full = contractProgress.map((c, idx) => ({ c, idx }));
  if (contractProgress.length <= 6) return full;
  if (focusContractId) return full.filter((x) => x.c.id === focusContractId);
  const unfinished = full.filter((x) => !prgIsContractDone(x.c));
  return (unfinished.length > 0 ? unfinished : full).slice(0, 3);
}

function prgAppendStage2Lines(lines, snap, cTotal, cDoneCount, customNotes, hasStageNotes, opts) {
  if (cTotal === 0) {
    lines.push('阶段 2：功能开发与验收（⏳ 待建首个契约模块）');
    appendStageNotes(lines, 2, customNotes);
    return;
  }
  if (cDoneCount === cTotal && !opts.focusContractId && !hasStageNotes(2) && opts.activeStage !== 2) {
    return void lines.push(`阶段 2：功能开发与验收（✅ ${cDoneCount}/${cTotal} 模块检查全绿）`);
  }
  lines.push(`阶段 2：功能开发与验收（${cDoneCount === cTotal ? '✅' : '🔄'} ${cDoneCount}/${cTotal} 模块全绿）`);
  const displayList = prgSelectStage2Display(snap.contractProgress, opts.focusContractId);
  for (const { c, idx } of displayList) {
    const detail = c.totalObs === 0 ? '待补验收项' : (c.frozen ? `${c.passedClean}/${c.totalObs} 项通过` : `待锁定（${c.totalObs} 项）`);
    lines.push(`  2-${idx + 1} ${prgContractIcon(c)} ${c.title}（${detail}）`);
    if (opts.focusContractId === c.id && c.obligations.length > 0) {
      for (let j = 0; j < c.obligations.length; j++) {
        const o = c.obligations[j];
        lines.push(`    2-${idx + 1}.${j + 1} ${PRG_OB_ICONS[o.state] || '⏳'} ${summarizeObligationLabel(o)}`);
      }
    }
  }
  if (cTotal > 6 && displayList.length < cTotal) {
    lines.push(`  … 其余 ${cTotal - displayList.length} 个模块已自动折叠，完整列表与依赖图见下方全景看板`);
  }
  appendStageNotes(lines, 2, customNotes);
}

function prgAppendTwoItemStage(lines, cfg, customNotes, hasStageNotes, activeStage) {
  const quiet = !hasStageNotes(cfg.no) && activeStage !== cfg.no;
  if (cfg.done === 2 && cfg.canCollapse !== false && quiet) return void lines.push(`阶段 ${cfg.no}：${cfg.title}（✅ 2/2 完成）`);
  if (cfg.idle && quiet) return void lines.push(`阶段 ${cfg.no}：${cfg.title}（⏳ 待开始 0/2）`);
  lines.push(`阶段 ${cfg.no}：${cfg.title}（${cfg.headIcon} ${cfg.done}/2）`, cfg.line1, cfg.line2);
  appendStageNotes(lines, cfg.no, customNotes);
}

function prgAppendDashboardHint(lines, projectRoot, statusData, totalPct, focusContractId, desc) {
  if (!existsSync(join(projectRoot, '.donegate'))) return;
  const dr = invokeDashboardExporter(projectRoot, join(projectRoot, '.donegate', 'dashboard.html'), { statusData, totalPct });
  if (dr.ok) lines.push(`全景看板：.donegate/dashboard.html${focusContractId ? `#focus=${focusContractId}` : ''}（${desc}）`);
}

export function renderProgressBlock(projectRoot, opts = {}) {
  const snap = computeProgressSnapshot(projectRoot, opts.statusData || null);
  const customNotes = [...loadCustomNotes(projectRoot), ...(Array.isArray(opts.extraItems) ? opts.extraItems : [])];
  const hasStageNotes = (s) => customNotes.some((n) => Number(n.stage) === s);
  const lines = [`#### 📊 DoneGate · 验收进度   ${snap.bar} ${snap.totalPct}%`];
  const govBanner = gdFormatIntegrityBannerText(gdCollectDisabledIntegrityRules(projectRoot));
  if (govBanner) lines.push(govBanner);
  if (opts.headline) lines.push(opts.headline.replaceAll('{{PCT}}', `${snap.totalPct}% ${snap.bar}`));
  const s1Done = Number(snap.s1Item1) + Number(snap.s1Item2);
  const cTotal = snap.contractProgress.length;
  prgAppendTwoItemStage(lines, {
    no: 1, title: '立项与规划', headIcon: prgStepIcon(s1Done === 2, true), done: s1Done, canCollapse: cTotal > 0, idle: false,
    line1: `  1-1 ${prgBoolIcon(snap.s1Item1)} 目标与禁区文件已初始化（INTENT / CONSTRAINTS / escapes）`,
    line2: `  1-2 ${prgBoolIcon(snap.s1Item2)} 拆出验收模块（当前 ${cTotal} 个）`
  }, customNotes, hasStageNotes, opts.activeStage);
  const cDoneCount = snap.contractProgress.filter(prgIsContractDone).length;
  prgAppendStage2Lines(lines, snap, cTotal, cDoneCount, customNotes, hasStageNotes, opts);
  const teethDone = snap.totalCmds > 0 && snap.totalTeeth === snap.totalCmds;
  const s3Done = Number(teethDone) + Number(snap.adapterCount > 0);
  prgAppendTwoItemStage(lines, {
    no: 3, title: '防假绿与体检', headIcon: '🔄', done: s3Done,
    idle: cTotal === 0 || (cDoneCount === 0 && snap.totalTeeth === 0 && snap.adapterCount === 0),
    line1: `  3-1 ${prgStepIcon(teethDone, snap.totalTeeth > 0)} 变异验证防假绿（${snap.totalTeeth}/${snap.totalCmds} 项已检出改坏代码）`,
    line2: `  3-2 ${prgBoolIcon(snap.adapterCount > 0)} 影响面与外部工具体检（已入账 ${snap.adapterCount} 项）`
  }, customNotes, hasStageNotes, opts.activeStage);
  const allVerified = cTotal > 0 && snap.verifiedCount === cTotal;
  const s4Done = Number(allVerified) + Number(snap.hasHandover);
  prgAppendTwoItemStage(lines, {
    no: 4, title: '独立复核与收尾', headIcon: prgStepIcon(s4Done === 2, true), done: s4Done, idle: s4Done === 0 && cDoneCount === 0,
    line1: `  4-1 ${prgStepIcon(allVerified, snap.verifiedCount > 0)} 独立 AI 盲审通过（${snap.verifiedCount}/${cTotal} 模块）`,
    line2: `  4-2 ${prgBoolIcon(snap.hasHandover)} 交接包生成与收尾归档`
  }, customNotes, hasStageNotes, opts.activeStage);
  prgAppendDashboardHint(lines, projectRoot, snap.statusData, snap.totalPct, opts.focusContractId, '双击用浏览器打开：大白话查看全部功能、前后配合与支线进度');
  return lines.join('\n');
}

export function renderWorryBlock(projectRoot, opts = {}) {
  const exitCode = opts.exitCode ?? 1, stage = opts.stage || 2;
  const icon = exitCode === 2 ? '🚨' : (exitCode === 3 ? '⚠️' : '❌');
  const levelLabel = exitCode === 2 ? '严重事故（立即停下核查）' : (exitCode === 3 ? '阻断提醒（前置未备齐，进度已暂停）' : '检查未通过（需修复后重跑）');
  let pctLine = '░░░░░░░░░░ 0%', snap = null;
  try {
    snap = computeProgressSnapshot(projectRoot);
    pctLine = `${snap.bar} ${snap.totalPct}%`;
  } catch (err) {
    void err;
  }
  const out = [`#### ${icon} DoneGate · 进度受阻（${levelLabel}）   ${pctLine}`, `阶段 ${stage}：${opts.stageTitle || '当前环节受阻'}`, `  ${stage}-! ${icon} ${opts.title || '执行未通过'}`];
  if (opts.reason) out.push(`  原因：${opts.reason}`);
  if (opts.action) out.push(`  下一步：${opts.action}`);
  prgAppendDashboardHint(out, projectRoot, snap?.statusData || null, snap?.totalPct, opts.focusContractId, '可打开定位受阻模块');
  return out.join('\n');
}
