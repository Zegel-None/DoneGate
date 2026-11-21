// L0 门 0（起手段）、门 1（基线冒烟）、门 2（判据段）校验器（<= 350 行聚焦子模块）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { frozenHashOf, sha256 } from '../../skill/hash.mjs';
import { validateContractSchema } from '../../skill/schema-lite.mjs';
import { evalStageGate } from '../../skill/check-stage.mjs';
import { isSelfWriterIdentity, loadContracts, loadThresholds } from './project-loader.mjs';

export function evaluateGate0(projectRoot, targetContractId, gapsList = []) {
  const fails = [];
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  const cons = readMaybe(join(projectRoot, 'CONSTRAINTS.md'));
  const headings = intent ? intent.split(/\r?\n/).filter((l) => /^##\s/.test(l)).map((l) => l.trim()) : [];
  const reqHeadings = ['## 为什么做', '## 服务谁', '## 什么算成功', '## 明确不做什么'];
  if (!intent || headings.length !== 4 || !reqHeadings.every((h, i) => headings[i] === h)) {
    fails.push('0.1 INTENT.md 缺失或四节不齐');
  }
  if (!cons || !cons.split(/\r?\n/).some((l) => /^(不许|必须)/.test(l.trim()))) {
    fails.push('0.1 CONSTRAINTS.md 缺失或无有效「不许/必须」条目');
  } else {
    // 失效链 F：常驻（上限 6）与临时（上限 12）配额核对
    const thresholds = loadThresholds(projectRoot);
    let inPerm = false, permCount = 0, tempCount = 0;
    for (const line of cons.split(/\r?\n/)) {
      const t = line.trim();
      if (/^##\s*常驻/.test(t)) { inPerm = true; continue; }
      if (/^##\s/.test(t)) { inPerm = false; continue; }
      if (/^(不许|必须)/.test(t)) {
        if (inPerm) permCount++;
        else tempCount++;
      }
    }
    if (permCount > (thresholds.maxPermanentConstraints || 6)) {
      fails.push(`链 F 常驻约束条数 ${permCount} 超过上限 ${thresholds.maxPermanentConstraints || 6}`);
    }
    if (tempCount > (thresholds.maxConstraints || 12)) {
      fails.push(`链 F 临时约束条数 ${tempCount} 超过上限 ${thresholds.maxConstraints || 12}`);
    }
  }
  // 0.2 INTENT / CONSTRAINTS 哈希必须在最近一条决策记录中出现（若存在 decisions/）
  const decDir = join(projectRoot, 'decisions');
  if (existsSync(decDir) && intent && cons) {
    const decFiles = readdirSync(decDir).filter((f) => f.endsWith('.md')).sort((a, b) => {
      const pa = a.match(/^(\d{4}-\d{2}-\d{2})-(?:(\d{2,4})-)?(.*)$/);
      const pb = b.match(/^(\d{4}-\d{2}-\d{2})-(?:(\d{2,4})-)?(.*)$/);
      if (pa && pb && pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
      if (pa && pb) {
        const sa = pa[2] !== undefined ? Number(pa[2]) : -1;
        const sb = pb[2] !== undefined ? Number(pb[2]) : -1;
        if (sa !== sb) return sa - sb;
      }
      return a.localeCompare(b);
    });
    if (decFiles.length > 0) {
      const latestDec = readMaybe(join(decDir, decFiles[decFiles.length - 1])) || '';
      const hInt = sha256(readFileSync(join(projectRoot, 'INTENT.md')));
      const hCon = sha256(readFileSync(join(projectRoot, 'CONSTRAINTS.md')));
      if (!latestDec.includes(hInt.slice(0, 12)) && !latestDec.includes(hCon.slice(0, 12))) {
        fails.push(`0.2 最近一条决策记录（${decFiles[decFiles.length - 1]}）未含当前 INTENT(${hInt.slice(0, 12)}) 或 CONSTRAINTS(${hCon.slice(0, 12)}) 哈希`);
      }
    }
  }
  // 0.3 前 3 位不重复缺口契约或 skipReason
  if (targetContractId && gapsList.length > 0) {
    const distinctTop3 = [...new Set(gapsList.map((g) => g.contractId).filter(Boolean))].slice(0, 3);
    if (distinctTop3.length > 0 && !distinctTop3.includes(targetContractId)) {
      const cRes = readJsonStrict(join(projectRoot, 'contracts', targetContractId, 'contract.json'));
      const skipReason = cRes.ok && typeof cRes.value.skipReason === 'string' && cRes.value.skipReason.trim();
      if (!skipReason) fails.push(`0.3 契约 ${targetContractId} 不在缺口前 3 位（${distinctTop3.join('、')}）且未填 skipReason`);
    }
  }
  // 0.4 若已存在 HANDOVER.md（进入阶段 6），要求六节齐且含接收方验收记录四要素
  const hoPath = join(projectRoot, 'HANDOVER.md');
  if (existsSync(hoPath)) {
    const ho = readMaybe(hoPath) || '';
    const hasSix = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、'].every((h) => ho.includes(h));
    const hasRecv = ho.includes('### 接收方验收记录') && /谁跑的/.test(ho) && /命令/.test(ho) && /输出/.test(ho) && /卡住/.test(ho);
    if (!hasSix || !hasRecv) fails.push('0.4 HANDOVER.md 缺六节或接收方验收记录四要素');
  }
  return { ok: fails.length === 0, fails };
}

export function evaluateGate1(projectRoot) {
  const intent = readMaybe(join(projectRoot, 'INTENT.md'));
  if (!intent) return { ok: false, exitCode: 3, reason: '缺少 INTENT.md，无法取得冒烟命令' };
  const m = intent.match(/^冒烟命令：\s*(.+)$/m);
  if (!m || !m[1].trim()) return { ok: false, exitCode: 1, reason: 'INTENT.md 缺少「冒烟命令：」固定行（G-08）' };
  const cmd = m[1].trim();
  const res = spawnSync(cmd, { cwd: projectRoot, shell: true, encoding: 'utf8', timeout: 600000 });
  if (res.error) return { ok: false, exitCode: 3, reason: '冒烟命令跑不起来：' + res.error.message };
  if (res.status !== 0) return { ok: false, exitCode: 1, reason: `冒烟命令退出码 ${res.status} ≠ 0` };
  return { ok: true, exitCode: 0, command: cmd };
}

export function evaluateGate2(projectRoot, contract) {
  const errs = validateContractSchema(contract, { full: true });
  if (errs.length > 0) return { ok: false, exitCode: 2, fails: errs };
  const st = evalStageGate(projectRoot);
  if (st.exitCode === 1) return { ok: false, exitCode: 1, fails: [st.line] };
  const stage = st.exitCode === 0 ? st.stage : 'T1a';

  const obs = contract.obligations || [];
  const fails = [];
  if (obs.length === 0) fails.push('2.1 至少有 1 条判据');
  for (const o of obs) {
    if (!o.signedBy || !o.signedBy.trim() || o.frozenHash !== frozenHashOf(o)) {
      const bpHint = o.breakPatch ? '（提示：若在冻结后才补加或修改了 breakPatch，也会导致 frozenHash 变化，请重新执行 contract freeze）' : '';
      fails.push(`2.2 判据 ${o.id} 未冻结或 frozenHash 不一致${bpHint}`);
    } else if (isSelfWriterIdentity(o.signedBy)) {
      fails.push(`2.2 / G-10 判据 ${o.id} 的 signedBy 不许填写方自己或 AI 代签`);
    }
    if (o.scopeAck && isSelfWriterIdentity(o.scopeAck.by)) {
      fails.push(`2.2 / G-10 判据 ${o.id} 的 scopeAck.by 不许是本轮写方自己或 AI 代签`);
    }
  }
  if (!obs.some((o) => o.kind === 'command')) fails.push('2.3 至少有 1 条 kind: command 判据');

  if (['T1b', 'T1c', 'T1完整'].includes(stage)) {
    const classes = new Set(obs.flatMap((o) => Array.isArray(o.inputClasses) ? o.inputClasses : []));
    for (const reqCls of ['正常', '边界', '异常']) {
      if (!classes.has(reqCls)) fails.push(`2.4 契约层面缺少「${reqCls}」输入类别判据`);
    }
    const alPath = join(projectRoot, 'alignment.json');
    if (existsSync(alPath)) {
      const al = readJsonStrict(alPath);
      if (!al.ok || !Array.isArray(al.value?.items) || al.value.items.some((x) => !x.judgment)) {
        fails.push('2.9 alignment.json 存在未勾选项 (judgment=null)');
      }
    }
  }
  if (['T1c', 'T1完整'].includes(stage)) {
    const thresholds = loadThresholds(projectRoot);
    for (const o of obs) {
      if (o.kind !== 'command') continue;
      const tVal = o.teeth && (o.teeth.result || o.teeth.status);
      if (tVal === 'ignored') continue;
      if (!o.teeth || !o.teeth.at) fails.push(`2.5 判据 ${o.id} 缺少 teeth 实验记录`);
      else {
        const age = (Date.now() - Date.parse(o.teeth.at)) / 86400000;
        if (age > thresholds.criterionValidDays) fails.push(`2.5 判据 ${o.id} teeth 已过期`);
      }
    }
    const { contracts } = loadContracts(projectRoot);
    const activeContracts = contracts.filter((c) => !c.retired);
    const knownIds = new Set(contracts.map((c) => c.id));
    if (activeContracts.length >= 2) {
      const hasProjectCross = activeContracts.some((c) =>
        (c.obligations || []).some((o) =>
          Array.isArray(o.spansContracts) && o.spansContracts.length >= 2 &&
          new Set(o.spansContracts).size >= 2 && o.spansContracts.every((cid) => knownIds.has(cid))
        )
      );
      if (!hasProjectCross) {
        fails.push('2.6 项目已有 ≥2 契约但缺少指向有效契约的 spansContracts 跨契约判据');
      }
    }
    // 2.8 本契约的代码加行数不超过 maxDiffLines（默认 400，只数 .ts/.tsx/.js/.mjs/.cjs/.jsx）
    const numstat = spawnSync('git', ['-C', projectRoot, 'diff', '--numstat', 'HEAD~1..HEAD'], { encoding: 'utf8' });
    if (numstat.status === 0 && numstat.stdout.trim()) {
      let codeAdded = 0;
      for (const line of numstat.stdout.split(/\r?\n/)) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const added = Number(parts[0]);
        const filePath = parts[2].trim();
        if (Number.isFinite(added) && /\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(filePath)) {
          codeAdded += added;
        }
      }
      if (codeAdded > (thresholds.maxDiffLines || 400)) {
        fails.push(`2.8 代码加行数 ${codeAdded} 超过上限 ${thresholds.maxDiffLines || 400}（文档不计）`);
      }
    }
  }
  if (stage === 'T1完整') {
    const intent = readMaybe(join(projectRoot, 'INTENT.md')) || '';
    for (const o of obs) {
      if (!o.servesSuccessCriterion || !intent.includes(o.servesSuccessCriterion)) {
        fails.push(`2.7 判据 ${o.id} 的 servesSuccessCriterion 未在 INTENT.md 原文命中`);
      }
    }
  }
  // 失效链 G：意图复核期限（60 天）
  const thresholdsAll = loadThresholds(projectRoot);
  const intentBody = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const revMatch = intentBody.match(/<!--\s*reviewed:\s*(\d{4}-\d{2}-\d{2})/i);
  if (revMatch) {
    const ageDays = (Date.now() - Date.parse(revMatch[1])) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > (thresholdsAll.intentReviewDays || 60)) {
      fails.push(`链 G 意图已超过 ${thresholdsAll.intentReviewDays || 60} 天未复核（上次 ${revMatch[1]}）`);
    }
  } else {
    const gitInt = spawnSync('git', ['-C', projectRoot, 'log', '-1', '--format=%ct', '--', 'INTENT.md'], { encoding: 'utf8' });
    if (gitInt.status === 0 && gitInt.stdout.trim()) {
      const ageDays = (Date.now() - Number(gitInt.stdout.trim()) * 1000) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > (thresholdsAll.intentReviewDays || 60)) {
        fails.push(`链 G INTENT.md 已超过 ${thresholdsAll.intentReviewDays || 60} 天未复核`);
      }
    }
  }
  return { ok: fails.length === 0, exitCode: fails.length ? 1 : 0, stage, fails };
}
