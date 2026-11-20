// 全流程机械进度计算、报喜/报忧卡片渲染与防撒谎开放扩展入口（零第三方依赖）
// 原则：
//   1. 机械总进度百分比完全由真实文件状态与退出码派生，自定义条目绝不改动百分比（INV-01）。
//   2. 开放入口（.donegate/notes.jsonl）允许用户项目自己的 Agent 补充阶段性报喜或报忧，
//      但必须过防撒谎门禁：禁空口报喜（good 必带可验证文件哈希或实跑 exit 0 命令）、禁冒充百分比/通关词、带 noteHash 防手改。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { computeProjectStatus } from './gates.mjs';
import { checkCommandBans } from './isolation.mjs';
import { sha256 } from '../../skill/hash.mjs';
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
const NOTE_PLACEHOLDERS = new Set(['todo', 'tbd', 'ok', 'done', 'pass', 'none', 'na', 'n/a', '无', '暂无', '没问题', '待补充']);

export function checkNoteTextAntiLie(title, detail = '') {
  const t = String(title || '').trim();
  const d = String(detail || '').trim();
  const combined = `${t}\n${d}`;
  if (!t || t.length < 4) return { ok: false, exitCode: 1, reason: 'title 至少 4 个字符，不许写空话' };
  if (NOTE_PLACEHOLDERS.has(t.toLowerCase())) return { ok: false, exitCode: 1, reason: `title 不许填占位词「${t}」` };
  if (/[█░■□]{3,}|\b\d{1,3}\s*%|总进度/.test(combined)) {
    return { ok: false, exitCode: 2, reason: '防撒谎门禁：自定义条目禁止伪造进度条、百分比或冒充「总进度」' };
  }
  if (/全部通关|项目完工|全部通过|全部完成|盲审已过|verify\s*pass|\bcleared\b/i.test(combined)) {
    return { ok: false, exitCode: 2, reason: '防撒谎门禁：自定义条目禁止越权声明「全部通关/全部完成/盲审已过」' };
  }
  if (/\|\|\s*true\b|continue-on-error|--no-fail\b/i.test(combined)) {
    return { ok: false, exitCode: 2, reason: '防撒谎门禁：禁止出现吞错写法（|| true / continue-on-error）' };
  }
  return { ok: true };
}

function computeNoteSeal(entry) {
  return sha256(JSON.stringify({
    at: entry.at || '',
    kind: entry.kind || '',
    stage: entry.stage || 0,
    title: entry.title || '',
    detail: entry.detail || '',
    verifyCmd: entry.verifyCmd || '',
    exitCode: entry.exitCode ?? null,
    stdoutSha256: entry.stdoutSha256 || '',
    evidencePath: entry.evidencePath || '',
    evidenceSha256: entry.evidenceSha256 || ''
  }));
}

export function verifySingleNoteOnDisk(projectRoot, entry, opts = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, exitCode: 2, reason: '条目不是 JSON 对象' };
  }
  if (!['good', 'worry', 'alert'].includes(entry.kind)) {
    return { ok: false, exitCode: 2, reason: `非法 kind: ${entry.kind}` };
  }
  const stage = Number(entry.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) {
    return { ok: false, exitCode: 2, reason: `非法 stage: ${entry.stage}` };
  }
  const textChk = checkNoteTextAntiLie(entry.title, entry.detail);
  if (!textChk.ok) return textChk;

  // 防手改封印校验（绕过 progress-note.mjs 手写 notes.jsonl 会在这里直接被抓）
  if (!entry.noteHash || entry.noteHash !== computeNoteSeal(entry)) {
    return { ok: false, exitCode: 2, reason: 'noteHash 缺失或与内容不符（疑似绕过脚本手改或篡改）' };
  }

  if (entry.kind === 'good') {
    const hasCmd = typeof entry.verifyCmd === 'string' && entry.verifyCmd.trim().length > 0;
    const hasEv = typeof entry.evidencePath === 'string' && entry.evidencePath.trim().length > 0;
    if (!hasCmd && !hasEv) {
      return { ok: false, exitCode: 1, reason: '空口报喜拒收：kind=good 必须附 verifyCmd 或 evidencePath 真凭据' };
    }
    if (hasCmd) {
      const bans = checkCommandBans(entry.verifyCmd);
      if (bans.length > 0) return { ok: false, exitCode: 2, reason: 'verifyCmd 触发禁令：' + bans.join('；') };
      if (entry.exitCode !== 0) return { ok: false, exitCode: 1, reason: `verifyCmd 记录退出码为 ${entry.exitCode}，非 0 不许报喜` };
      if (opts.rerunCmds) {
        const rr = spawnSync(entry.verifyCmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 60000 });
        if (rr.error || rr.status !== 0) {
          return { ok: false, exitCode: 1, reason: `复跑 verifyCmd 失败（exit=${rr.status}）：${entry.verifyCmd}` };
        }
      }
    }
    if (hasEv) {
      const abs = resolve(projectRoot, entry.evidencePath);
      const rel = relative(projectRoot, abs);
      if (rel.startsWith('..') || !existsSync(abs)) {
        return { ok: false, exitCode: 1, reason: `证据文件不存在或越界：${entry.evidencePath}` };
      }
      const buf = readFileSync(abs);
      if (buf.length === 0) return { ok: false, exitCode: 1, reason: `证据文件为空：${entry.evidencePath}` };
      if (!entry.evidenceSha256 || sha256(buf) !== entry.evidenceSha256) {
        return { ok: false, exitCode: 2, reason: `证据文件指纹已变化或篡改：${entry.evidencePath}` };
      }
    }
  }
  return { ok: true };
}

export function verifyProjectNotes(projectRoot, opts = {}) {
  const p = join(projectRoot, '.donegate', 'notes.jsonl');
  if (!existsSync(p)) return { exists: false, ok: true, entries: [], valid: [], invalid: [] };
  const raw = readFileSync(p, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [];
  const valid = [];
  const invalid = [];
  lines.forEach((line, i) => {
    let obj;
    try { obj = JSON.parse(line); } catch (e) {
      invalid.push({ lineNo: i + 1, title: '(JSON 损坏)', exitCode: 2, reason: e.message });
      return;
    }
    entries.push(obj);
    const v = verifySingleNoteOnDisk(projectRoot, obj, opts);
    if (v.ok) valid.push(obj);
    else invalid.push({ lineNo: i + 1, entry: obj, title: obj?.title || '?', exitCode: v.exitCode || 1, reason: v.reason });
  });
  return { exists: true, ok: invalid.length === 0, entries, valid, invalid };
}

export function loadCustomNotes(projectRoot) {
  const res = verifyProjectNotes(projectRoot, { rerunCmds: false });
  const out = [];
  for (const e of res.valid) out.push({ ...e, _verified: true });
  for (const bad of res.invalid) {
    out.push({
      kind: 'alert',
      stage: Number.isInteger(Number(bad.entry?.stage)) && Number(bad.entry.stage) >= 1 && Number(bad.entry.stage) <= 4
        ? Number(bad.entry.stage) : 2,
      title: bad.title,
      detail: `拦截·未验真：${bad.reason}`,
      _verified: false
    });
  }
  return out;
}

export function appendProgressNote(projectRoot, note) {
  const kind = ['good', 'worry', 'alert'].includes(note?.kind) ? note.kind : null;
  const stage = Number(note?.stage);
  const title = typeof note?.title === 'string' ? note.title.trim() : '';
  const detail = typeof note?.detail === 'string' ? note.detail.trim() : '';
  if (!kind) return { ok: false, exitCode: 1, reason: 'kind 必须是 good | worry | alert' };
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) return { ok: false, exitCode: 1, reason: 'stage 必须是 1 | 2 | 3 | 4' };

  const textChk = checkNoteTextAntiLie(title, detail);
  if (!textChk.ok) return { ok: false, exitCode: textChk.exitCode, reason: textChk.reason };

  let verifyCmd = typeof note?.verifyCmd === 'string' ? note.verifyCmd.trim() : '';
  let exitCode = null;
  let stdoutSha256 = '';
  let evidencePath = typeof note?.evidence === 'string' ? note.evidence.trim() : '';
  let evidenceSha256 = '';

  if (kind === 'good') {
    if (!verifyCmd && !evidencePath) {
      return {
        ok: false,
        exitCode: 1,
        reason: '拒绝空口报喜：--kind good 必须提供 --verify-cmd "<实跑命令>" 或 --evidence "<项目内证据文件>"；若只是主观判断或风险提醒，请改用 --kind worry'
      };
    }
    if (verifyCmd) {
      const bans = checkCommandBans(verifyCmd);
      if (bans.length > 0) {
        return { ok: false, exitCode: 2, reason: '拒绝违禁命令：' + bans.join('；') };
      }
      const r = spawnSync(verifyCmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 60000 });
      if (r.error || r.status !== 0) {
        return {
          ok: false,
          exitCode: 1,
          reason: `验证命令未通过（exit=${r.status}），严禁以 good 报喜；请修好重跑或改用 --kind worry 报忧：\n${(r.stderr || r.stdout || '').trim()}`
        };
      }
      exitCode = 0;
      stdoutSha256 = sha256((r.stdout || '') + (r.stderr || ''));
    }
    if (evidencePath) {
      const abs = resolve(projectRoot, evidencePath);
      const rel = relative(projectRoot, abs).replace(/\\/g, '/');
      if (rel.startsWith('..') || !existsSync(abs)) {
        return { ok: false, exitCode: 1, reason: `证据文件不存在或越出项目目录：${evidencePath}` };
      }
      const buf = readFileSync(abs);
      if (buf.length === 0) return { ok: false, exitCode: 1, reason: `证据文件为空：${evidencePath}` };
      evidencePath = rel;
      evidenceSha256 = sha256(buf);
    }
  }

  const dir = join(projectRoot, '.donegate');
  mkdirSync(dir, { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    kind,
    stage,
    title,
    detail,
    source: typeof note?.source === 'string' && note.source.trim() ? note.source.trim() : 'agent',
    ...(verifyCmd ? { verifyCmd, exitCode, stdoutSha256 } : {}),
    ...(evidencePath ? { evidencePath, evidenceSha256 } : {})
  };
  entry.noteHash = computeNoteSeal(entry);
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
  const kept = loadCustomNotes(projectRoot).filter((x) => Number(x.stage) !== Number(stage) && x._verified !== false);
  writeFileSync(p, kept.map((x) => {
    const clean = { ...x };
    delete clean._verified;
    return JSON.stringify(clean);
  }).join('\n') + (kept.length ? '\n' : ''), 'utf8');
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

  const s1Item1 = hasInit;
  const s1Item2 = activeContracts.length > 0 || intentFilled;
  const s1Pct = (s1Item1 ? 5 : 0) + (s1Item2 ? 5 : 0);

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
    const tag = n._verified === false
      ? '拦截·未验真'
      : (n.kind === 'good' ? '补充·已验真' : (n.kind === 'alert' ? '告警' : '报忧'));
    const evHint = n.kind === 'good' && n._verified !== false
      ? (n.evidencePath ? ` [证据:${n.evidencePath}]` : (n.verifyCmd ? ` [实跑exit 0]` : ''))
      : '';
    const detail = n.detail ? `（${n.detail}）` : '';
    lines.push(`  ${stageNo}-💬 ${icon} [${tag}] ${n.title}${detail}${evHint}`);
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

  // 阶段 2：各模块开发与验收
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
  } else if ((cTotal === 0 || (cDoneCount === 0 && snap.totalTeeth === 0 && snap.adapterCount === 0)) && !hasStageNotes(3) && opts.activeStage !== 3) {
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
