// 十二条命令 · 后六条与健康自检（status / graph / gaps / handover / verify pack / verify apply + H1–H3）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import { materialFingerprintOf, sha256 } from '../../skill/hash.mjs';
import { walk } from '../../skill/fs-walk.mjs';
import { appendChainEntry, readAndVerifyChain } from './chain.mjs';
import { computeProjectStatus, loadContracts, loadThresholds } from './gates.mjs';
import { renderProgressBlock, renderWorryBlock } from './progress.mjs';

const CMDB_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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

function collectGapsList(projectRoot, st) {
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

  if (opts.html) {
    const outHtml = resolve(projectRoot, opts.html);
    mkdirSync(dirname(outHtml), { recursive: true });
    const html = `<!doctype html><meta charset="utf-8"><title>DoneGate V4 Status</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;background:#0f172a;color:#e2e8f0}
pre{background:#1e293b;padding:1rem;border-radius:8px;overflow:auto}</style>
<h1>DoneGate V4 状态总账</h1><pre>${lines.join('\n').replace(/</g, '&lt;')}</pre>`;
    writeFileSync(outHtml, html, 'utf8');
    lines.push(`HTML 面板已写出：${relative(projectRoot, outHtml)}`);
  }

  return { exitCode: 0, stdout: lines.join('\n'), status: st, health };
}

function collectCodeFilesForCoverage(projectRoot) {
  const { files } = walk(projectRoot, { skipDirs: ['node_modules', '.git', '.donegate', '.codegraph', '.stryker-tmp', 'vendor', 'dist', '_dist', 'coverage', 'reports'] });
  const codeExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go']);
  const codeFiles = [];
  const testFiles = [];
  const oversizedFiles = [];
  for (const f of files) {
    const rel = relative(projectRoot, f).replace(/\\/g, '/');
    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    if (!codeExts.has(ext)) continue;
    if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$/i.test(rel)) {
      testFiles.push(rel);
      continue;
    }
    let len = 0;
    try { len = readFileSync(f, 'utf8').length; } catch { continue; }
    if (Math.ceil(len / 4) > 5000) {
      oversizedFiles.push(rel);
      continue;
    }
    codeFiles.push(rel);
  }
  return { codeFiles, testFiles, oversizedFiles };
}

function computeThreeColorEdges(projectRoot, activeContracts, codeFiles) {
  const ownersOf = (relFile) => activeContracts.filter((c) => (c.scope || []).some((s) => {
    const ns = s.replace(/\\/g, '/').replace(/^\.\//, '');
    return ns.endsWith('/') ? relFile.startsWith(ns) : (relFile === ns || relFile.startsWith(ns + '/'));
  })).map((c) => c.id);

  const codeSet = new Set(codeFiles);
  const actualPairs = new Set();
  let invisible = 0;

  for (const cf of codeFiles) {
    const srcOwners = ownersOf(cf);
    if (srcOwners.length === 0) continue;
    let body = '';
    try { body = readFileSync(join(projectRoot, cf), 'utf8'); } catch { continue; }
    for (const m of body.matchAll(/(?:import\s+(?:[^\n;]*?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1].split(/[?#]/)[0];
      if (!spec.startsWith('.')) continue;
      const baseDir = dirname(cf);
      const rawTarget = normalize(join(baseDir, spec)).replace(/\\/g, '/');
      const candidates = [rawTarget, rawTarget + '.mjs', rawTarget + '.js', rawTarget + '.ts', rawTarget + '/index.mjs', rawTarget + '/index.js'];
      const hit = candidates.find((cand) => codeSet.has(cand));
      if (!hit) continue;
      for (const dstOwner of ownersOf(hit)) {
        for (const srcOwner of srcOwners) {
          if (srcOwner !== dstOwner) actualPairs.add(`${srcOwner}->${dstOwner}`);
        }
      }
    }
    for (const dm of body.matchAll(/\b(?:import|require)\s*\(\s*[^'")\s]/g)) {
      if (dm) invisible++;
    }
  }

  const declaredPairs = new Set();
  for (const c of activeContracts) {
    for (const dep of (c.dependsOn || [])) declaredPairs.add(`${c.id}->${dep}`);
  }
  const solid = [], dashed = [], red = [];
  for (const pair of declaredPairs) {
    const [from, to] = pair.split('->');
    if (actualPairs.has(pair)) solid.push({ from, to });
    else dashed.push({ from, to });
  }
  for (const pair of actualPairs) {
    if (!declaredPairs.has(pair)) {
      const [from, to] = pair.split('->');
      red.push({ from, to });
    }
  }
  return { solid, dashed, red, invisible };
}

export function cmdGraph(projectRoot) {
  const thresholds = loadThresholds(projectRoot);
  const { contracts, errors } = loadContracts(projectRoot);
  if (errors.length > 0) return { exitCode: 3, stderr: '契约读取错误，无法出图' };
  const active = contracts.filter((c) => !c.retired);
  const { codeFiles, testFiles, oversizedFiles } = collectCodeFilesForCoverage(projectRoot);

  const claimed = [];
  const orphans = [];
  for (const cf of codeFiles) {
    const matched = active.some((c) => (c.scope || []).some((s) => {
      const ns = s.replace(/\\/g, '/').replace(/^\.\//, '');
      return ns.endsWith('/') ? cf.startsWith(ns) : (cf === ns || cf.startsWith(ns + '/'));
    }));
    if (matched) claimed.push(cf);
    else orphans.push(cf);
  }
  const pct = codeFiles.length === 0 ? 100 : Math.round((claimed.length / codeFiles.length) * 100);
  const emptyContracts = active.filter((c) => !Array.isArray(c.obligations) || c.obligations.length === 0).map((c) => c.id);
  const edges = computeThreeColorEdges(projectRoot, active, codeFiles);
  const edgeSummary = `实线 ${edges.solid.length} 条 | 虚线 ${edges.dashed.length} 条 | 红线 ${edges.red.length} 条 | 不可见 ${edges.invisible} 处`;

  // 三档出图（08-失效链 链 C / INV-09）
  if (pct < thresholds.coverageMinPct) {
    const needCount = Math.max(1, Math.ceil(orphans.length * 0.8));
    const lines = [
      `覆盖率 ${pct}%（${claimed.length}/${codeFiles.length}，低于 ${thresholds.coverageMinPct}% 拒绝出图，INV-09 退 1）`,
      `孤儿代码 ${orphans.length} 个 | 空契约 ${emptyContracts.length} 个 | 测试文件 ${testFiles.length} 个（不计入分母） | 过大文件 ${oversizedFiles.length} 个`,
      edgeSummary,
      '孤儿清单（覆盖 80% 孤儿所需最少 scope 增补建议）：',
      ...orphans.slice(0, needCount).map((o) => `  - ${o}`)
    ];
    return { exitCode: 1, stdout: lines.join('\n'), coveragePct: pct, tier: 3, orphans, edges };
  }

  const lines = [
    `覆盖率 ${pct}%（${claimed.length}/${codeFiles.length}） | 孤儿 ${orphans.length} 个 | 空契约 ${emptyContracts.length} 个 | ${edgeSummary}`
  ];
  const renderEdges = (out) => {
    for (const e of edges.solid) out.push(`  ${e.from} -->|实线| ${e.to}`);
    for (const e of edges.dashed) out.push(`  ${e.from} -.->|虚线:未接通| ${e.to}`);
    for (const e of edges.red) out.push(`  ${e.from} --x|红线:未声明| ${e.to}`);
  };
  if (pct < thresholds.coverageFullPct) {
    lines.push(`二档图（30%–60%：只画已认领部分 + 显式灰区）`);
    lines.push('```mermaid\nflowchart TD');
    for (const c of active) lines.push(`  ${c.id}["${c.id}"]`);
    renderEdges(lines);
    lines.push(`  GREY_ZONE["░ 未覆盖灰区：${orphans.length} 个文件（点开孤儿清单查看）"]`);
    lines.push('  style GREY_ZONE fill:#475569,stroke:#94a3b8,stroke-width:3px,color:#f8fafc');
    lines.push('```');
    return { exitCode: 0, stdout: lines.join('\n'), coveragePct: pct, tier: 2, orphans, edges };
  }

  lines.push('一档图（≥60%：完整图 + 三色依赖连线）');
  lines.push('```mermaid\nflowchart TD');
  for (const c of active) lines.push(`  ${c.id}["${c.id}"]`);
  renderEdges(lines);
  lines.push('```');
  return { exitCode: 0, stdout: lines.join('\n'), coveragePct: pct, tier: 1, orphans, edges };
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

export function cmdHandover(projectRoot, opts = {}) {
  const st = computeProjectStatus(projectRoot);
  if (st.contractErrors.length > 0) return { exitCode: 3, stderr: '状态算不出来，无法生成交接包' };
  const gaps = collectGapsList(projectRoot, st);
  const decDir = join(projectRoot, 'decisions');
  const decs = existsSync(decDir) ? readdirSync(decDir).filter((f) => f.endsWith('.md')).sort().slice(-3).reverse() : [];
  const intent = readMaybe(join(projectRoot, 'INTENT.md')) || '';
  const smokeMatch = intent.match(/^冒烟命令：\s*(.+)$/m);
  const smokeCmd = smokeMatch ? smokeMatch[1].trim() : 'node -e "process.exit(0)"';
  const nextContract = gaps.find((g) => g.contractId)?.contractId || st.contractSummaries[0]?.id || '<contractId>';
  const unverifiedOrPending = gaps.filter((g) => ['unverified', 'pending-recheck', 'expired', 'unknown'].includes(g.kind));

  const dgBin = existsSync(join(projectRoot, 'runner', 'donegate.mjs'))
    ? 'runner/donegate.mjs'
    : `"${resolve(dirname(fileURLToPath(import.meta.url)), '..', 'donegate.mjs')}"`;
  const md = [
    '# HANDOVER · 项目交接包',
    '',
    '## 一、当前状态',
    st.ledgerLines[0],
    st.ledgerLines[1],
    `人工判据：${st.humanStats.N === 0 ? '0 项（无）' : `${st.humanStats.pass}/${st.humanStats.N}`}（独立列，不混入自动比例）`,
    st.funcLine,
    st.j3Line,
    '',
    '## 二、下一个该做的',
    gaps.length ? `优先处理：${gaps[0].detail}` : '当前无阻塞缺口，可进入交付或维护。',
    '',
    '## 三、未定事项',
    unverifiedOrPending.length ? unverifiedOrPending.map((g) => `- ${g.detail}`).join('\n') : '- 无未定事项',
    '',
    '## 四、最近三条决策',
    decs.length ? decs.map((d) => `- ${d}`).join('\n') : '- 暂无 decisions/ 记录',
    '',
    '## 五、已知缺口与不覆盖范围',
    gaps.length ? gaps.map((g) => `- [${g.kind}] ${g.detail}`).join('\n') : '- 缺口 0 条',
    '- **本交接包不覆盖**：契约 `scope` 之外的未认领底座代码、以及未写出可观察判据的主观视觉/手感体验。',
    '',
    '## 六、怎么跑起来',
    '```powershell',
    smokeCmd,
    `node ${dgBin} check ${nextContract}`,
    `node ${dgBin} status`,
    '```',
    '',
    '### 接收方验收记录',
    `- 谁跑的：${opts.receiver || '（待接收方填写）'}`,
    `- 跑的命令原文：${opts.ranCommand || smokeCmd}`,
    `- 看到的输出：${opts.observedOutput || '（待接收方填写实测输出）'}`,
    `- 卡住的格：${opts.stuckAt || '无'}`,
    ''
  ].join('\n');

  const outPath = resolve(projectRoot, opts.out || 'HANDOVER.md');
  writeFileSync(outPath, md, 'utf8');
  return {
    exitCode: 0,
    stdout: `已生成交接包：${relative(projectRoot, outPath) || 'HANDOVER.md'}（六节齐）\n\n` +
      renderProgressBlock(projectRoot, { headline: '✅ [4-2] 交接包 HANDOVER.md 已生成 · 总进度 {{PCT}}' }),
    path: outPath
  };
}

export function cmdVerifyPack(projectRoot, opts = {}) {
  const id = opts.id;
  if (!id) return { exitCode: 3, stderr: '用法：verify pack <契约id>' };
  const cPath = join(projectRoot, 'contracts', id, 'contract.json');
  const cRes = readJsonStrict(cPath);
  if (!cRes.ok) return { exitCode: 3, stderr: '契约读不出来：' + cPath };
  const contract = cRes.value;
  const obs = Array.isArray(contract.obligations) ? contract.obligations : [];
  if (obs.length === 0) return { exitCode: 3, stderr: '契约无判据，材料不全' };

  const evBase = join(projectRoot, '.donegate', 'evidence', id);
  if (!existsSync(evBase)) return { exitCode: 3, stderr: '缺少运行证据目录（§八 退 3）：' + evBase };

  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const packDir = resolve(projectRoot, opts.out || join('.donegate', 'verify', `${id}-${ts}`, id));
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  const filesWritten = [];
  const emit = (rel, content) => {
    const abs = join(packDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    filesWritten.push(rel.replace(/\\/g, '/'));
  };

  // 1. 判据原文（仅限本契约，符合 INV-14）
  emit(`criterion/${id}.json`, JSON.stringify({ id: contract.id, obligations: obs }, null, 2) + '\n');
  // 2. scope 与 why
  emit('contract-scope-why.md', `# 契约 ${id} 的 scope 与 why\n\n## scope\n${JSON.stringify(contract.scope)}\n\n## why\n${contract.why}\n`);
  // 3. 完成声称原文
  emit('完成声称.md', `# 完成声称（原文）\n\n本轮完成：契约 ${id} 全部 ${obs.length} 条判据已运行并留存三件套证据。\n`);
  // 4. base..head diff 与版本号（支持 --base/--head、锚定链上 freezeCommit、剥离无关 contracts/* 噪音、拒绝空 diff）
  const evPairs = [];
  for (const o of obs) {
    const oDir = join(evBase, o.id);
    if (!existsSync(oDir)) return { exitCode: 3, stderr: `缺少判据 ${o.id} 证据目录（退 3）` };
    const runs = readdirSync(oDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (runs.length === 0) return { exitCode: 3, stderr: `判据 ${o.id} 无运行证据目录（退 3）` };
    const runName = runs[runs.length - 1];
    const latestRunDir = join(oDir, runName);
    for (const part of ['start.json', 'report.json', 'end.json']) {
      if (!existsSync(join(latestRunDir, part))) return { exitCode: 3, stderr: `判据 ${o.id} 缺少 ${part}（退 3）` };
    }
    const startCheck = readJsonStrict(join(latestRunDir, 'start.json'));
    const reportCheck = readJsonStrict(join(latestRunDir, 'report.json'));
    if (startCheck.ok && (startCheck.value?.debugDirtyRun === true || startCheck.value?.isDirty === true || reportCheck.value?.debugDirtyRun === true)) {
      return {
        exitCode: 3,
        stderr: `判据 ${o.id} 最新证据为脏树调试运行（--allow-dirty），禁打入复核包，请提交干净树后重跑 check\n\n` +
          renderWorryBlock(projectRoot, {
            exitCode: 3, stage: 4, stageTitle: `「${contract.title || id}」独立复核打包`,
            title: '最新运行证据来自脏工作区，不能送审',
            reason: `判据 ${o.id} 使用了 --allow-dirty 调试证据`,
            action: '提交干净树后重新执行 donegate check，再跑 verify pack'
          })
      };
    }
    evPairs.push({ oid: o.id, runName, latestRunDir });
  }

  let diffText = '', versText = '';
  const gitHead = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.head || 'HEAD'], { encoding: 'utf8' });
  if (gitHead.status === 0) {
    const headRev = gitHead.stdout.trim();
    let baseRev = '';
    if (opts.base) {
      const bRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', opts.base], { encoding: 'utf8' });
      if (bRes.status !== 0) return { exitCode: 3, stderr: '无法解析 --base 提交：' + opts.base };
      baseRev = bRes.stdout.trim();
    } else {
      const chainRes = readAndVerifyChain(projectRoot);
      const freezeEntry = chainRes.ok ? chainRes.entries.filter((e) => e.kind === 'freeze' && e.contractId === id).pop() : null;
      if (freezeEntry && freezeEntry.freezeCommit && freezeEntry.freezeCommit !== headRev) {
        baseRev = freezeEntry.freezeCommit;
      } else {
        const prevRes = spawnSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' });
        baseRev = prevRes.status === 0 ? prevRes.stdout.trim() : '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      }
    }
    versText = `base ${baseRev}\nhead ${headRev}\n`;
    const d1 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', '.', ':(exclude)contracts'], { encoding: 'utf8' }).stdout || '';
    const d2 = spawnSync('git', ['-C', projectRoot, 'diff', `${baseRev}..${headRev}`, '--', `contracts/${id}`], { encoding: 'utf8' }).stdout || '';
    diffText = [d1.trimEnd(), d2.trimEnd()].filter(Boolean).join('\n') + '\n';
  } else {
    return { exitCode: 3, stderr: '当前目录不是有效 git 仓库或无提交历史，无法生成 base..head（退 3）' };
  }
  if (!diffText.trim()) {
    return { exitCode: 3, stderr: 'base..head 无任何实际改动 diff（可能是空提交或冻结后未改动），拒绝生成空复核包，请指定 --base <commit>' };
  }
  emit(`diff/${id}.diff`, diffText);
  emit('diff/versions.txt', versText);

  // 5. 运行输出与三件套证据
  for (const ev of evPairs) {
    for (const part of ['start.json', 'report.json', 'end.json']) {
      emit(`evidence/${ev.oid}/${ev.runName}/${part}`, readFileSync(join(ev.latestRunDir, part), 'utf8'));
    }
  }

  const manifestBody = filesWritten.map((r) => sha256(readFileSync(join(packDir, r))) + '  ' + r).join('\n') + '\n';
  writeFileSync(join(packDir, 'MANIFEST.txt'), manifestBody, 'utf8');

  const chk = spawnSync(process.execPath, [join(CMDB_REPO, 'skill', 'check-reviewpack.mjs'), '--pack', packDir], { encoding: 'utf8' });
  if (chk.status !== 0) {
    return { exitCode: chk.status === 3 ? 3 : 2, stderr: `自建复核包未通过 check-reviewpack：\n${chk.stdout}\n${chk.stderr}` };
  }
  return {
    exitCode: 0,
    stdout: `复核包已生成并通过 INV-14 自检：${packDir}\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: id, headline: `📦 [4-1] 「${contract.title || id}」独立复核材料包已就绪（待 /donegate-judge 盲审） · 总进度 {{PCT}}` }),
    packDir,
    packageHash: sha256(manifestBody)
  };
}

export function cmdVerifyApply(projectRoot, opts = {}) {
  const packDir = opts.packDir ? resolve(projectRoot, opts.packDir) : null;
  const verdictPath = opts.verdict ? resolve(projectRoot, opts.verdict) : null;
  if (!packDir || !existsSync(packDir)) return { exitCode: 3, stderr: '复核包目录不存在' };
  if (!verdictPath || !existsSync(verdictPath)) return { exitCode: 3, stderr: '判定书文件不存在' };

  // 先由 check-reviewpack.mjs 核验复核包是否被篡改（清单闭合 / 哈希）
  const packChk = spawnSync(process.execPath, [join(CMDB_REPO, 'skill', 'check-reviewpack.mjs'), '--pack', packDir], { encoding: 'utf8' });
  if (packChk.status === 3) return { exitCode: 3, stderr: '复核包有文件不可读：' + packChk.stdout };
  if (packChk.status !== 0) {
    return {
      exitCode: 2,
      stderr: '复核包已被篡改或结构不闭合（退 2）：\n' + packChk.stdout + '\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 2, stage: 4, stageTitle: '独立复核校验',
          title: '复核材料包哈希异常或包含越界内容',
          reason: '清单文件与实际字节不一致或混入了非白名单文件',
          action: '停止裁决，删除旧复核包并重新执行 verify pack'
        })
    };
  }

  const vRes = readJsonStrict(verdictPath);
  if (!vRes.ok) return { exitCode: vRes.error === 'parse' ? 2 : 3, stderr: '判定书读不出或 JSON 损坏' };
  const v = vRes.value;
  const items = ['V1', 'V2', 'V3', 'V4', 'V5'];
  const allowed = new Set(['pass', 'fail', 'unknown']);
  let hasFail = false, hasUnknown = false, isContradiction = false;

  for (const k of items) {
    const entry = v[k];
    const val = typeof entry === 'string' ? entry : entry?.verdict;
    const reason = typeof entry === 'object' ? (entry?.reason || entry?.rationale || '') : (v.reasons?.[k] || '');
    if (!allowed.has(val)) {
      return { exitCode: 3, stderr: `非法作答词 ${k}=${val}（只允许 pass/fail/unknown，退 3）` };
    }
    if (val === 'fail') hasFail = true;
    if (val === 'unknown') {
      hasUnknown = true;
      if (!String(reason).trim() || !/(缺失|缺|矛盾|不一致|对不上|不可读|材料)/.test(String(reason))) {
        return { exitCode: 3, stderr: `invalid-abstain：${k}=unknown 未指明缺失或矛盾材料（退 3）` };
      }
      if (/(矛盾|不一致|对不上)/.test(String(reason))) isContradiction = true;
    }
  }

  // G-02：材料自相矛盾导致的 unknown，总结论按 §八 退 2（不降级为 3）
  if (isContradiction) {
    return {
      exitCode: 2,
      stderr: '门 5 发现材料自相矛盾（G-02 按 §八 退 2）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 2, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '提交送审的材料自相矛盾',
          reason: '独立复核指出不同文件或声称之间互相冲突',
          action: '核对代码 diff、运行输出与完成声称后重新打包送审'
        })
    };
  }
  if (hasFail) {
    return {
      exitCode: 1,
      stdout: '门 5 判定：未通过（存在 fail 项，退 1）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 1, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '独立 AI 复核驳回（存在未通过项）',
          reason: '独立盲审在标准核对中发现 fail 项',
          action: '按判定书指出的 fail 项修复后，重跑 check 与 verify pack'
        })
    };
  }
  if (hasUnknown) {
    return {
      exitCode: 3,
      stdout: '门 5 判定：无法判断（材料不足，退 3）\n\n' +
        renderWorryBlock(projectRoot, {
          exitCode: 3, stage: 4, stageTitle: '独立 AI 盲审裁决',
          title: '复核材料不足，无法裁决',
          reason: '判定书中存在因缺失材料而给出的 unknown',
          action: '补齐缺失证据或说明后重新运行 verify pack'
        })
    };
  }

  const contractId = v.contractId || packDir.split(/[\\/]/).pop();
  const maniPath = join(packDir, 'MANIFEST.txt');
  const packageHash = existsSync(maniPath) ? sha256(readFileSync(maniPath)) : null;
  const app = appendChainEntry(projectRoot, {
    kind: 'verify-result',
    contractId,
    result: 'pass',
    packageHash,
    signedBy: v.judge || 'independent-judge'
  });
  if (!app.ok) return { exitCode: app.exitCode || 2, stderr: app.reason };
  return {
    exitCode: 0,
    stdout: `门 5 记录：通过（${contractId}，seq=${app.entry.seq}）\n\n` +
      renderProgressBlock(projectRoot, { focusContractId: contractId, headline: `✅ [4-1] 独立 AI 盲审通过（${contractId}） · 总进度 {{PCT}}` })
  };
}
