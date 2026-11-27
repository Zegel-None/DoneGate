// L1 全流程机械进度快照计算与防撒谎自定义便签核验原语（零第三方依赖，<= 350 行）
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { computeProjectStatus } from './gates.mjs';
import { checkCommandBans } from './isolation.mjs';
import { sha256 } from '../../skill/hash.mjs';
import { readMaybe } from '../../skill/io.mjs';

const NOTE_PLACEHOLDERS = new Set(['todo', 'tbd', 'ok', 'done', 'pass', 'none', 'na', 'n/a', '无', '暂无', '没问题', '待补充']);

function makeBar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function checkNoteTextAntiLie(title, detail = '') {
  const t = String(title || '').trim(), d = String(detail || '').trim(), combined = `${t}\n${d}`;
  if (!t || t.length < 4) return { ok: false, exitCode: 1, reason: 'title 至少 4 个字符，不许写空话' };
  if (NOTE_PLACEHOLDERS.has(t.toLowerCase())) return { ok: false, exitCode: 1, reason: `title 不许填占位词「${t}」` };
  if (/[█░■□]{3,}|\b\d{1,3}\s*%|总进度/.test(combined)) return { ok: false, exitCode: 2, reason: '防撒谎门禁：自定义条目禁止伪造进度条、百分比或冒充「总进度」' };
  if (/全部通关|项目完工|全部通过|全部完成|盲审已过|verify\s*pass|\bcleared\b/i.test(combined)) return { ok: false, exitCode: 2, reason: '防撒谎门禁：自定义条目禁止越权声明「全部通关/全部完成/盲审已过」' };
  if (/\|\|\s*true\b|continue-on-error|--no-fail\b/i.test(combined)) return { ok: false, exitCode: 2, reason: '防撒谎门禁：禁止出现吞错写法（|| true / continue-on-error）' };
  return { ok: true };
}

function computeNoteSeal(entry) {
  return sha256(JSON.stringify({
    at: entry.at || '', kind: entry.kind || '', stage: entry.stage || 0, title: entry.title || '', detail: entry.detail || '',
    verifyCmd: entry.verifyCmd || '', exitCode: entry.exitCode ?? null, stdoutSha256: entry.stdoutSha256 || '',
    evidencePath: entry.evidencePath || '', evidenceSha256: entry.evidenceSha256 || ''
  }));
}

function prgReadProjectEvidence(projectRoot, rawEvPath, outMsg) {
  const abs = resolve(projectRoot, rawEvPath), rel = relative(projectRoot, abs).replace(/\\/g, '/');
  if (rel.startsWith('..') || !existsSync(abs)) return { ok: false, exitCode: 1, reason: `${outMsg}：${rawEvPath}` };
  const buf = readFileSync(abs);
  if (buf.length === 0) return { ok: false, exitCode: 1, reason: `证据文件为空：${rawEvPath}` };
  return { ok: true, rel, hash: sha256(buf) };
}

function prgVerifyDiskGoodCmd(projectRoot, entry, rerunCmds) {
  const bans = checkCommandBans(entry.verifyCmd);
  if (bans.length > 0) return { ok: false, exitCode: 2, reason: 'verifyCmd 触发禁令：' + bans.join('；') };
  if (entry.exitCode !== 0) return { ok: false, exitCode: 1, reason: `verifyCmd 记录退出码为 ${entry.exitCode}，非 0 不许报喜` };
  if (!rerunCmds) return { ok: true };
  const rr = spawnSync(entry.verifyCmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 60000 });
  if (rr.error || rr.status !== 0) return { ok: false, exitCode: 1, reason: `复跑 verifyCmd 失败（exit=${rr.status}）：${entry.verifyCmd}` };
  return { ok: true };
}

function prgVerifyDiskGoodEvidence(projectRoot, entry) {
  const ev = prgReadProjectEvidence(projectRoot, entry.evidencePath, '证据文件不存在或越界');
  if (!ev.ok) return ev;
  if (!entry.evidenceSha256 || ev.hash !== entry.evidenceSha256) return { ok: false, exitCode: 2, reason: `证据文件指纹已变化或篡改：${entry.evidencePath}` };
  return { ok: true };
}

export function verifySingleNoteOnDisk(projectRoot, entry, opts = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, exitCode: 2, reason: '条目不是 JSON 对象' };
  if (!['good', 'worry', 'alert'].includes(entry.kind)) return { ok: false, exitCode: 2, reason: `非法 kind: ${entry.kind}` };
  const stage = Number(entry.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) return { ok: false, exitCode: 2, reason: `非法 stage: ${entry.stage}` };
  const textChk = checkNoteTextAntiLie(entry.title, entry.detail);
  if (!textChk.ok) return textChk;
  if (!entry.noteHash || entry.noteHash !== computeNoteSeal(entry)) return { ok: false, exitCode: 2, reason: 'noteHash 缺失或与内容不符（疑似绕过脚本手改或篡改）' };
  if (entry.kind !== 'good') return { ok: true };
  const hasCmd = typeof entry.verifyCmd === 'string' && entry.verifyCmd.trim().length > 0;
  const hasEv = typeof entry.evidencePath === 'string' && entry.evidencePath.trim().length > 0;
  if (!hasCmd && !hasEv) return { ok: false, exitCode: 1, reason: '空口报喜拒收：kind=good 必须附 verifyCmd 或 evidencePath 真凭据' };
  if (hasCmd) {
    const cmdChk = prgVerifyDiskGoodCmd(projectRoot, entry, Boolean(opts.rerunCmds));
    if (!cmdChk.ok) return cmdChk;
  }
  return hasEv ? prgVerifyDiskGoodEvidence(projectRoot, entry) : { ok: true };
}

export function verifyProjectNotes(projectRoot, opts = {}) {
  const p = join(projectRoot, '.donegate', 'notes.jsonl');
  if (!existsSync(p)) return { exists: false, ok: true, entries: [], valid: [], invalid: [] };
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [], valid = [], invalid = [];
  lines.forEach((line, i) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
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
  const out = res.valid.map((e) => ({ ...e, _verified: true }));
  for (const bad of res.invalid) {
    const stg = Number(bad.entry?.stage);
    out.push({ kind: 'alert', stage: Number.isInteger(stg) && stg >= 1 && stg <= 4 ? stg : 2, title: bad.title, detail: `拦截·未验真：${bad.reason}`, _verified: false });
  }
  return out;
}

function prgCollectGoodProof(projectRoot, verifyCmd, rawEvidence) {
  if (!verifyCmd && !rawEvidence) {
    return { ok: false, exitCode: 1, reason: '拒绝空口报喜：--kind good 必须提供 --verify-cmd "<实跑命令>" 或 --evidence "<项目内证据文件>"；若只是主观判断或风险提醒，请改用 --kind worry' };
  }
  let exitCode = null, stdoutSha256 = '', evidencePath = rawEvidence, evidenceSha256 = '';
  if (verifyCmd) {
    const bans = checkCommandBans(verifyCmd);
    if (bans.length > 0) return { ok: false, exitCode: 2, reason: '拒绝违禁命令：' + bans.join('；') };
    const r = spawnSync(verifyCmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 60000 });
    if (r.error || r.status !== 0) {
      return { ok: false, exitCode: 1, reason: `验证命令未通过（exit=${r.status}），严禁以 good 报喜；请修好重跑或改用 --kind worry 报忧：\n${(r.stderr || r.stdout || '').trim()}` };
    }
    exitCode = 0;
    stdoutSha256 = sha256((r.stdout || '') + (r.stderr || ''));
  }
  if (evidencePath) {
    const ev = prgReadProjectEvidence(projectRoot, evidencePath, '证据文件不存在或越出项目目录');
    if (!ev.ok) return ev;
    evidencePath = ev.rel;
    evidenceSha256 = ev.hash;
  }
  return { ok: true, exitCode, stdoutSha256, evidencePath, evidenceSha256 };
}

function prgBuildSealedEntry(kind, stage, title, detail, rawSource, verifyCmd, proof) {
  const source = typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim() : 'agent';
  const entry = {
    at: new Date().toISOString(), kind, stage, title, detail, source,
    ...(verifyCmd ? { verifyCmd, exitCode: proof.exitCode, stdoutSha256: proof.stdoutSha256 } : {}),
    ...(proof.evidencePath ? { evidencePath: proof.evidencePath, evidenceSha256: proof.evidenceSha256 } : {})
  };
  entry.noteHash = computeNoteSeal(entry);
  return entry;
}

export function appendProgressNote(projectRoot, note) {
  const kind = ['good', 'worry', 'alert'].includes(note?.kind) ? note.kind : null, stage = Number(note?.stage);
  const title = typeof note?.title === 'string' ? note.title.trim() : '';
  const detail = typeof note?.detail === 'string' ? note.detail.trim() : '';
  if (!kind) return { ok: false, exitCode: 1, reason: 'kind 必须是 good | worry | alert' };
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) return { ok: false, exitCode: 1, reason: 'stage 必须是 1 | 2 | 3 | 4' };
  const textChk = checkNoteTextAntiLie(title, detail);
  if (!textChk.ok) return { ok: false, exitCode: textChk.exitCode, reason: textChk.reason };
  const verifyCmd = typeof note?.verifyCmd === 'string' ? note.verifyCmd.trim() : '';
  const rawEv = typeof note?.evidence === 'string' ? note.evidence.trim() : '';
  let proof = { exitCode: null, stdoutSha256: '', evidencePath: rawEv, evidenceSha256: '' };
  if (kind === 'good') {
    const pRes = prgCollectGoodProof(projectRoot, verifyCmd, rawEv);
    if (!pRes.ok) return { ok: false, exitCode: pRes.exitCode, reason: pRes.reason };
    proof = pRes;
  }
  const dir = join(projectRoot, '.donegate');
  mkdirSync(dir, { recursive: true });
  const entry = prgBuildSealedEntry(kind, stage, title, detail, note?.source, verifyCmd, proof);
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
  const serialized = kept.map(({ _verified, ...clean }) => (void _verified, JSON.stringify(clean)));
  writeFileSync(p, serialized.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  return kept.length;
}

function prgSummarizeContractProgress(c, rawMap, chainEntries) {
  const raw = rawMap.get(c.id) || {}, obs = c.obligations || [], totalObs = obs.length;
  const frozen = totalObs > 0 && (raw.obligations || []).every((o) => Boolean(o.frozenHash && o.signedBy));
  const passedClean = obs.filter((o) => o.state === '通过').length;
  const cmdObs = obs.filter((o) => o.kind === 'command' && o.teeth !== 'ignored');
  const teethDone = cmdObs.filter((o) => o.teeth === 'killed').length;
  const latestFreeze = chainEntries.filter((e) => e.kind === 'freeze' && e.contractId === c.id).pop();
  const minSeq = latestFreeze?.seq || 0;
  const verifiedPass = chainEntries.some((e) => e.kind === 'verify-result' && e.contractId === c.id && e.result === 'pass' && (e.seq || 0) > minSeq);
  const ratio = totalObs === 0 ? 0 : (frozen ? 0.2 : 0) + 0.8 * (passedClean / totalObs);
  return { id: c.id, title: c.title || c.id, state: c.state, frozen, passedClean, totalObs, cmdCount: cmdObs.length, teethDone, verifiedPass, cleared: c.cleared, obligations: obs, ratio };
}

function prgCountClaimedAdapters(projectRoot) {
  const adpDir = join(projectRoot, '.donegate', 'adapters');
  if (!existsSync(adpDir)) return 0;
  let count = 0;
  for (const e of readdirSync(adpDir, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(adpDir, e.name, 'claim.json'))) count++;
  }
  return count;
}

function prgComputeTotalPct(m) {
  const s1Pct = (m.s1Item1 ? 5 : 0) + (m.s1Item2 ? 5 : 0);
  const avgRatio = m.contractProgress.length > 0 ? m.contractProgress.reduce((s, c) => s + c.ratio, 0) / m.contractProgress.length : 0;
  const s2Pct = m.contractProgress.length > 0 ? Math.round(60 * avgRatio) : 0;
  const s3Item1Pct = m.totalCmds > 0 ? Math.round(10 * (m.totalTeeth / m.totalCmds)) : 0;
  const hasImpactOrAdapter = m.adapterCount > 0 || Boolean(m.st?.autoImpact?.impacted?.length > 0);
  const s3Item2Pct = hasImpactOrAdapter ? 10 : (m.totalTeeth > 0 ? 5 : 0);
  const s4Item1Pct = m.contractProgress.length > 0 ? Math.round(5 * (m.verifiedCount / m.contractProgress.length)) : 0;
  const s4Pct = s4Item1Pct + (m.hasHandover ? 5 : 0);
  return Math.max(0, Math.min(100, s1Pct + s2Pct + s3Item1Pct + s3Item2Pct + s4Pct));
}

export function computeProgressSnapshot(projectRoot, precomputedSt = null) {
  const hasInit = existsSync(join(projectRoot, 'INTENT.md')) && existsSync(join(projectRoot, 'CONSTRAINTS.md')) && existsSync(join(projectRoot, '.donegate', 'chain.jsonl'));
  const intentText = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const st = precomputedSt || (hasInit ? computeProjectStatus(projectRoot) : null);
  const activeContracts = st ? st.contractSummaries.filter((c) => !c.retired && c.track !== 'explore') : [];
  const rawMap = new Map((st ? st.contracts.filter((c) => !c.retired && c.track !== 'explore') : []).map((c) => [c.id, c]));
  const chainEntries = st && st.chainRes?.ok ? st.chainRes.entries : [];
  const s1Item1 = hasInit, s1Item2 = activeContracts.length > 0 || (hasInit && !intentText.includes('（请填写一句话说明为什么做）'));
  const contractProgress = activeContracts.map((c) => prgSummarizeContractProgress(c, rawMap, chainEntries));
  const totalCmds = contractProgress.reduce((s, c) => s + c.cmdCount, 0), totalTeeth = contractProgress.reduce((s, c) => s + c.teethDone, 0);
  const adapterCount = prgCountClaimedAdapters(projectRoot), verifiedCount = contractProgress.filter((c) => c.verifiedPass).length;
  const hasHandover = (readMaybe(join(projectRoot, 'HANDOVER.md')) || '').trim().length > 0;
  const totalPct = prgComputeTotalPct({ s1Item1, s1Item2, contractProgress, totalCmds, totalTeeth, adapterCount, st, verifiedCount, hasHandover });
  return { totalPct, bar: makeBar(totalPct), statusData: st, hasInit, s1Item1, s1Item2, contractProgress, totalCmds, totalTeeth, adapterCount, verifiedCount, hasHandover };
}
