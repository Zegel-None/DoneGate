// 健康自检 H1–H3、项目总账与缺口盘点命令（status / gaps，<= 350 行聚焦子模块）
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';
import { materialFingerprintOf } from '../../skill/hash.mjs';
import { computeProjectStatus } from './gates.mjs';
import { exportDashboardHtml, openInSystemBrowser } from './dashboard.mjs';
import { renderProgressBlock } from './progress.mjs';
import { collectCodeFilesForCoverage, computeThreeColorEdges } from './graph-edges.mjs';

export const CMDB_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TREE_ORDER = { '未通过': 1, '无牙': 2, '未验证': 3, '通过': 4, '过期': 5, '无法判断': 6, '不稳定': 0, '未定验收': 3 };
const STATE_SYMBOLS = { '通过': '⬤', '无牙': '◐', '未验证': '○', '未通过': '✗', '过期': '∅', '无法判断': '∅', '不稳定': '✗', '未定验收': '○' };

export function runHealthChecks(projectRoot) {
  // H1: 证据目录可写且剩余空间 > 100 MB
  let h1Ok = false, h1Msg = '';
  const evBase = join(projectRoot, '.donegate', 'evidence');
  try {
    mkdirSync(evBase, { recursive: true });
    const probe = join(evBase, '.h1-write-probe.tmp');
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    const sf = statfsSync(evBase);
    const freeMb = Math.floor((Number(sf.bavail) * Number(sf.bsize)) / (1024 * 1024));
    h1Ok = freeMb > 100;
    h1Msg = h1Ok ? `可写（剩余 ${freeMb} MB）` : `剩余空间不足 100 MB（${freeMb} MB）`;
  } catch (e) {
    h1Ok = false;
    h1Msg = '证据写不进去：' + e.message;
  }

  // H2: 已注册适配器可用比
  let h2Total = 0, h2Ok = 0;
  const regPath = existsSync(join(projectRoot, 'adapters.registry.json'))
    ? join(projectRoot, 'adapters.registry.json')
    : join(CMDB_REPO, 'adapters.registry.json');
  const regRes = readJsonStrict(regPath);
  if (regRes.ok && Array.isArray(regRes.value?.adapters)) {
    for (const a of regRes.value.adapters) {
      h2Total++;
      const entryPath = a.entry ? resolve(CMDB_REPO, a.entry) : '';
      if (entryPath && existsSync(entryPath)) h2Ok++;
    }
  }
  const h2Ratio = h2Total === 0 ? 1 : h2Ok / h2Total;

  // H3: 固定样例计算两次指纹是否一致
  const fixedSample = [
    { path: 'fixed/a.mjs', sha256: 'a'.repeat(64) },
    { path: 'fixed/b.mjs', sha256: 'b'.repeat(64) }
  ];
  const fp1 = materialFingerprintOf(fixedSample);
  const fp2 = materialFingerprintOf(fixedSample);
  const h3Ok = /^[0-9a-f]{64}$/.test(fp1) && fp1 === fp2;

  return {
    H1: { ok: h1Ok, detail: h1Msg },
    H2: { ok: h2Ratio >= 0.5, available: h2Ok, total: h2Total, ratio: h2Ratio },
    H3: { ok: h3Ok, detail: h3Ok ? '指纹算法可重算' : '指纹算法损坏' },
    healthy: h1Ok && h3Ok
  };
}

export function collectGapsList(projectRoot, st) {
  const gaps = [];
  for (const c of st.contractSummaries) {
    if (c.retired) continue;
    if (c.obligations.length === 0) {
      gaps.push({ kind: 'empty-contract', contractId: c.id, detail: `契约 ${c.id} 未定验收（无判据，INV-03）` });
    }
    for (const o of c.obligations) {
      if (o.state === '未通过') gaps.push({ kind: 'failing', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 未通过` });
      else if (o.state === '过期') gaps.push({ kind: 'expired', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 过期：${o.reason}` });
      else if (o.state === '无法判断') gaps.push({ kind: 'unknown', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 无法判断：${o.reason}` });
      else if (o.state === '不稳定') gaps.push({ kind: 'unstable', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 不稳定` });
      else if (o.state === '未验证') gaps.push({ kind: 'unverified', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 未验证` });
      else if (o.pendingRecheck) gaps.push({ kind: 'pending-recheck', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 待重验 (A4)` });
      else if (o.subclass === 'A2') gaps.push({ kind: 'toothless', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 无牙 (${o.teeth})` });
      else if (o.subclass === 'A3') gaps.push({ kind: 'no-teeth-exp', contractId: c.id, id: o.id, detail: `${c.id}/${o.id} 未做有牙实验` });
    }
    if (!c.signedOff && c.state === '通过') {
      gaps.push({ kind: 'unsigned-signoff', contractId: c.id, detail: `契约 ${c.id} 尚未人签通关` });
    }
  }
  for (const oc of st.orphanContracts) gaps.push({ kind: 'orphan-contract', contractId: oc, detail: `孤儿契约：${oc}（未挂功能）` });
  for (const ofn of st.orphanFunctions) gaps.push({ kind: 'orphan-function', id: ofn.id || ofn._fileId, detail: `孤儿功能：${ofn.id || ofn._fileId}（声明了没做）` });
  for (const bf of st.badSourceFunctions) gaps.push({ kind: 'bad-source', id: bf.id || bf._fileId, detail: `INV-18：功能 ${bf.id || bf._fileId} 缺原话 source 或含禁用转述` });
  const { codeFiles } = collectCodeFilesForCoverage(projectRoot);
  const edges = computeThreeColorEdges(projectRoot, st.contracts.filter((c) => !c.retired), codeFiles);
  for (const de of edges.dashed) gaps.push({ kind: 'dashed-dep', contractId: de.from, detail: `虚线依赖：${de.from} → ${de.to}（契约已声明，代码未接通）` });
  for (const re of edges.red) gaps.push({ kind: 'red-dep', contractId: re.from, detail: `红线越界：${re.from} → ${re.to}（代码已引用，契约未声明）` });
  return gaps;
}

export function cmdStatus(projectRoot, opts = {}) {
  const health = runHealthChecks(projectRoot);
  const st = computeProjectStatus(projectRoot, opts.pendingContracts || new Set());
  if (st.contractErrors.length > 0 || !st.chainRes.ok) {
    const errMsg = st.contractErrors[0]?.path || st.chainRes.reason;
    return { exitCode: st.chainRes.ok ? 3 : (st.chainRes.exitCode || 2), stderr: '状态算不出来：' + errMsg };
  }
  if (!health.H1.ok || !health.H3.ok) {
    return {
      exitCode: 3,
      stderr: `健康自检失败：${!health.H1.ok ? health.H1.detail : health.H3.detail}（全局判「无法判断」，拒绝出图）`
    };
  }

  // INV-18：--flow 遇空 source 或转述顶替原话必须拒绝渲染并报红
  if (opts.flow && st.badSourceFunctions.length > 0) {
    return {
      exitCode: 1,
      stderr: `INV-18 拒绝渲染流程图：${st.badSourceFunctions.map((f) => f.id || f._fileId).join('、')} 缺少人的原话 source 或含禁用转述`
    };
  }

  const lines = [
    `健康自检：H1=${health.H1.ok ? 'OK' : 'FAIL'} | 适配器可用比=${health.H2.available}/${health.H2.total} | H3=${health.H3.ok ? 'OK' : 'FAIL'} | ${st.isolationNotice}`,
    ...st.ledgerLines,
    `人工判据：${st.humanStats.N === 0 ? '0 项（无）' : `${st.humanStats.pass}/${st.humanStats.N}`}（独立列，不混入自动比例）`,
    st.funcLine,
    st.j3Line
  ];
  if (st.ignoredList.length > 0) {
    lines.push(`已忽略的判据（不计入分母）：${st.ignoredList.map((x) => `${x.contractId}/${x.id}`).join('、')}`);
  }
  for (const cs of st.contractSummaries) {
    if (cs.retired) continue;
    lines.push(cs.state === '未定验收'
      ? `契约 ${cs.id}：未定验收（INV-03）`
      : `契约 ${cs.id}：${cs.cleared ? '通关' : cs.state}（${cs.passTrusted}/${cs.passTotal} 算数）`);
  }

  if (!opts.flow && !opts.tree) {
    lines.push('', renderProgressBlock(projectRoot, { statusData: st }));
  }

  if (opts.tree) {
    lines.push('\n功能清单（最差的在最上面）');
    const sortedFuncs = [...st.functions].sort((a, b) => {
      const score = (fn) => {
        const linked = (fn.contracts || []).map((cid) => st.contractSummaries.find((x) => x.id === cid)).filter(Boolean);
        if (linked.length === 0) return 0;
        return Math.min(...linked.map((c) => TREE_ORDER[c.state] ?? 3));
      };
      return score(a) - score(b);
    });
    for (const fn of sortedFuncs) {
      const linked = (fn.contracts || []).map((cid) => st.contractSummaries.find((x) => x.id === cid)).filter(Boolean);
      const worst = linked.length === 0 ? '未定验收' : linked.sort((a, b) => (TREE_ORDER[a.state] ?? 3) - (TREE_ORDER[b.state] ?? 3))[0].state;
      const sym = STATE_SYMBOLS[worst] || '○';
      lines.push(`├─ ${fn.title || fn.id}  ${sym} (${worst})`);
      for (const lc of linked) {
        const cSym = lc.cleared ? '⬤ 通关' : `${STATE_SYMBOLS[lc.state] || '○'} ${lc.state}`;
        lines.push(`│   └─ ${lc.id}  ${cSym} (${lc.passTrusted}/${lc.passTotal} 算数)`);
      }
    }
    if (st.orphanContracts.length > 0) {
      lines.push(`└─ ⚠ 未登记功能 ${st.orphanContracts.length} 个`);
      for (const oc of st.orphanContracts) lines.push(`    └─ ${oc}（有契约，没挂功能）`);
    }
  }

  if (opts.flow) {
    lines.push('\n流程图（人说 Agent 画，机器算状态）');
    lines.push('```mermaid\nflowchart LR');
    for (const fn of st.functions) {
      const linked = (fn.contracts || []).map((cid) => st.contractSummaries.find((x) => x.id === cid)).filter(Boolean);
      const label = linked.length === 0 ? '声明了没做' : `${linked[0].passTrusted}/${linked[0].passTotal}`;
      lines.push(`  ${fn.id}["${fn.title || fn.id}<br/>${label}"]`);
      for (const nextId of (Array.isArray(fn.after) ? fn.after : [])) {
        lines.push(`  ${fn.id} -->|after| ${nextId}`);
      }
    }
    lines.push('```');
  }

  if (opts.html || opts.open || opts.serve) {
    const outHtml = resolve(projectRoot, typeof opts.html === 'string' ? opts.html : join('.donegate', 'dashboard.html'));
    const { codeFiles } = collectCodeFilesForCoverage(projectRoot);
    const edges = computeThreeColorEdges(projectRoot, st.contracts.filter((c) => !c.retired), codeFiles);
    exportDashboardHtml(projectRoot, outHtml, { statusData: st, edges });
    if (opts.html) lines.push(`HTML 面板已写出：${relative(projectRoot, outHtml)}`);
    if (opts.open || opts.serve) {
      const srvScript = join(CMDB_REPO, 'runner', 'atlas', 'serve-atlas.mjs');
      const drRes = exportDashboardHtml(projectRoot, outHtml, { statusData: st, edges });
      const livePort = drRes.atlas?.project?.livePort || 43180;
      try {
        const ch = spawn(process.execPath, [srvScript, '--root', projectRoot, '--port', String(livePort)], { detached: true, stdio: 'ignore', windowsHide: true });
        ch.unref();
      } catch { /* 非致命降级，不影响主状态 */ }
      if (opts.open) {
        openInSystemBrowser(`http://127.0.0.1:${livePort}/`);
        lines.push(`已在浏览器打开全景沙盘（支持点右上角实时刷新）：http://127.0.0.1:${livePort}/ （离线副本：${relative(projectRoot, outHtml)}）`);
      } else {
        lines.push(`全景沙盘实时刷新服务已就绪：http://127.0.0.1:${livePort}/`);
      }
    }
  }

  return { exitCode: 0, stdout: lines.join('\n'), status: st, health };
}

export function cmdGaps(projectRoot, opts = {}) {
  const st = computeProjectStatus(projectRoot);
  if (st.contractErrors.length > 0) return { exitCode: 3, stderr: '契约读不出，无法算缺口' };
  const gaps = collectGapsList(projectRoot, st);
  if (opts.json) return { exitCode: 0, stdout: JSON.stringify(gaps, null, 2), gaps };
  const out = gaps.length === 0
    ? '缺口清单：0 条'
    : `缺口清单（共 ${gaps.length} 条，只增不减，不与通过数抵消）：\n` + gaps.map((g, i) => `  ${i + 1}. [${g.kind}] ${g.detail}`).join('\n');
  return { exitCode: 0, stdout: out, gaps };
}
