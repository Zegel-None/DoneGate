// 主控三级按需变焦命令实现（donegate brief 根视口 + donegate zoom 闭世界多目标批量与三级寻址，<= 350 行）
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildSingleFileOutline } from './cockpit-file-outline.mjs';
import { buildCockpitGraphIndex } from './cockpit-index.mjs';
import { renderDecisionsZoom, renderDomainOrContract, renderSingleFileZoom } from './cockpit-render.mjs';
import { fileBelongsToScopes, SHARED_GOVERNANCE_GLOBS } from './context-router.mjs';
import { cmdImpact } from './impact-radar.mjs';

function ckcCollectDomainPaths(node, out) {
  for (const m of node.modules || []) {
    if (m.path) out.push(m.path);
  }
  for (const sub of node.subgraph?.nodes || []) ckcCollectDomainPaths(sub, out);
}

function ckcSummarizePhysicalDirs(sn) {
  const paths = [];
  ckcCollectDomainPaths(sn, paths);
  const dirs = new Set();
  for (const p of paths) {
    if (p === 'INTENT.md') continue;
    const parts = p.split('/');
    if (parts.length >= 3 && parts[0] === 'runner') dirs.add(`${parts[0]}/${parts[1]}/`);
    else if (parts.length >= 2) dirs.add(`${parts[0]}/`);
    else dirs.add('根目录配置');
  }
  return [...dirs].slice(0, 4).join(', ') || '根目录';
}

function ckcCountDomainRoutes(sn, idx) {
  const paths = [];
  ckcCollectDomainPaths(sn, paths);
  const seen = new Set();
  for (const p of paths) {
    for (const r of idx.fileOutlines[p]?.httpRoutes || []) {
      if (!r.startsWith('FETCH')) seen.add(r);
    }
  }
  return seen.size;
}

function ckcFormatDomainBlock(sn, stepById, idx, hasContracts) {
  const nextSteps = (sn.nextIds || []).map((id) => `→${stepById.get(id) || id}`).join(' ') || '→[终态门禁]';
  const defaultOwner = hasContracts ? '根级共享治理（无单一契约）' : '零契约公开分发模式';
  const cids = (sn.contractIds || []).length ? sn.contractIds.map((c) => `\`${c}\``).join(', ') : defaultOwner;
  const innerTitles = (sn.subgraph?.nodes || []).map((x) => `${sn.step}.${x.step} ${x.title}(${x.codeCapsule?.moduleCount || 0}项)`).join(' → ');
  const domAdrCount = idx.adrs.filter((a) => a.domains.includes(sn.step)).length;
  const domGaps = idx.gaps.filter((g) => (sn.contractIds || []).includes(g.contractId)).length;
  const domRoutes = ckcCountDomainRoutes(sn, idx);
  const adrLabel = idx.hasDecisionsDir ? `挂靠 ADR：${domAdrCount} 篇` : 'ADR：未启用 decisions/';
  const physDirs = ckcSummarizePhysicalDirs(sn);
  return [
    `- **[${sn.step}] ${sn.title}**（物理目录：\`${physDirs}\` | 含 ${sn.codeCapsule?.moduleCount || 0} 项 | 归属：${cids} | 流向：${nextSteps}）`,
    `  - 内部结构：${innerTitles || '直接模块'} | HTTP 路由：${domRoutes} 条 | 待跑证据：${domGaps} 项 | ${adrLabel}`,
    `  - 下钻句柄：\`node runner/donegate.mjs zoom ${sn.step}\`${idx.hasDecisionsDir ? ` | \`node runner/donegate.mjs zoom ${sn.step} --decisions\`` : ''}`
  ];
}

function ckcFormatHubItems(h, fallbackCmd) {
  if (!h) return '—';
  const items = [
    ...h.selectedCross.map((s) => `\`${s.signature}\`[跨${s.crossContracts.length}域/${s.extFiles}文件]`),
    ...h.selectedIntra.map((s) => `\`${s.signature}\`[域内${s.extFiles}文件]`)
  ];
  if (items.length > 0) return items.join(' · ');
  return h.uniformCross ? `（${h.crossTotal} 个等权构建模块各被引 1 次，无单一瓶颈；查明细：\`${fallbackCmd}\`）` : '（末端独立单元，无跨界被调函数）';
}

function ckcFormatContractBlock(cid, idx) {
  const n = idx.graph.nodes.find((x) => x.id === cid);
  const h = idx.hubs.hubsByContract[cid];
  const up = n.dependsOnIds.length ? `上游依赖:[${n.dependsOnIds.join(', ')}]` : '上游依赖:无';
  const down = n.dependedByIds.length ? `下游消费方:[${n.dependedByIds.join(', ')}]` : '下游消费方:无';
  const cidAdr = idx.hasDecisionsDir ? ` | 关联 ADR：${idx.adrs.filter((a) => a.contracts.includes(cid)).length} 篇` : '';
  return [
    `- **\`${cid}\`**（${n.title} | 源码 \`${n.stub.sourceTokens} tok\` / 存根 \`${n.stub.stubTokens} tok\` | ${up} · ${down}${cidAdr}）`,
    `  - 核心承重接口：${ckcFormatHubItems(h, `donegate zoom ${cid} --stubs`)}`
  ];
}

function ckcBuildZoomZeroGovernanceSection(idx, hasContracts) {
  const th = idx.thresholds;
  const thSrc = idx.hasThresholdsFile ? 'thresholds.json' : '默认内置预算';
  const archStr = idx.liveMeta.archetypes.join('|') || 'scanner';
  const subpackStr = Object.keys(idx.liveMeta.annotatedSubpacks).map((k) => `\`${k}\``).join(', ');
  const activeGovGlobs = hasContracts
    ? SHARED_GOVERNANCE_GLOBS
    : SHARED_GOVERNANCE_GLOBS.filter((g) => existsSync(join(idx.root, g.replace(/\/$/, ''))));
  const nonMain = (idx.atlas.branches || []).filter((b) => !b.isDefault);
  const brWarn = nonMain.length ? `当前检出 ${nonMain.length} 条非主线分支（${nonMain.map((b) => `\`${b.name}\``).join('、')}），派工必显式基于 \`main\`` : '当前仅 `main` 主线活跃';

  const L = ['', '## 3. 核心工程红线、实时阈值真源与派工规约（完整字典查 `donegate zoom rules`）'];
  L.push('- **永久铁律**：① 判定核运行时零第三方 npm 依赖（`tests/*.test.mjs` 使用可选开发依赖 `vitest`，裸克隆跑单测前先 `npm install`）、主力适配 Windows (`win32`)、子进程直读退出码禁吞错；② `decisions/`（若启用）严守 `INV-13` 只增不改且新档必齐五段；③ 启用契约时新增源码须归入 `scope[]`（显式文件 `path/foo.mjs` 自动认领同名伴生目录 `path/foo/*.mjs` 且保持 `stubHash` 零漂移）。');
  if (th.maxCommitCodeLines) {
    L.push(`- **四维门禁实时阈值（${thSrc}）**：① 生产净增 \`<= ${th.warnCommitCodeLines}\` 直通、\`251–${th.maxCommitCodeLines}\` 软预警、\`> ${th.maxCommitCodeLines}\` 硬拦（原始硬顶 \`${th.maxRawCommitCodeLines}\`，\`tests/**\` 与 \`.json/.md\` 豁免，净增 \`>= 80\` 行无单测触发 \`C1t\` 提示）；② 生产文件 \`<= ${th.maxProdCommitFiles}\`、含测试总文件 \`<= ${th.maxCommitFiles}\`；③ 单文件有效行 \`${th.warnEffectiveFileLines}/${th.maxEffectiveFileLines}\`（物理硬顶 \`${th.maxFileLines}\`，单函数 \`${th.warnFunctionLines}\` 行预警，核心子模块 \`<= 350\` 行，具体适配器 \`<= 90\` 行）；④ 单函数认知复杂度 \`<= ${th.warnCognitiveComplexity}\` 绿灯 / \`> ${th.maxCognitiveComplexity}\` 硬拦，禁 \`C4g\` 压行。`);
  }
  L.push(`- **公共路径、跨界验收与子包**：已存在公共治理白名单 \`SHARED_GOVERNANCE_GLOBS\` = ${activeGovGlobs.map((g) => `\`${g}\``).join(', ')}；有契约项目可用 \`check-node <契约ID> --allow-cross-scope --receipt\` 放行公共治理文件与根台账；画布子包：${subpackStr}。`);
  L.push(`- **外部工具扩展与共享池**：\`node skill/new-adapter.mjs <tool> --archetype <${archStr}> --card-json\` 生成薄适配器（委托 \`_shared.mjs\` \`runAdapter\`）与 \`bricks/<tool>/capabilities.json\`；共享池位于 \`workflows/.deps/_shared/\`（含 \`.bin/\`、\`dists/\`、\`npm-cells/<id>/\`）。`);
  if (hasContracts) {
    L.push(`- **派工与合入闭环（${brWarn}）**：\`git worktree add <wtDir> -b <branch> main\` → \`preflight --stamp-lease\` → \`impact <目标>\` → \`slice <契约ID> [--focus <路径|@subpack>]\` → 逐文件 \`lint-edit <file>\` → \`check-node <契约ID> [--allow-cross-scope] --receipt\`。`);
  } else {
    L.push(`- **零契约公开/轻量模式开发闭环（${brWarn}）**：\`git worktree add <wtDir> -b <branch> main\` → \`impact <目标>\` → \`zoom <文件路径>\` → 逐文件 \`lint-edit <file>\` → 全套自检 \`node skill/check-escapes.mjs --self-check\` + \`npm test\`（若对目标项目运行 \`donegate init\` 并建立 \`contracts/\`，即可进一步开启 \`slice <契约ID>\` 与 \`check-node <契约ID> --receipt\` 密封切片围挡）。`);
  }
  return L;
}

function ckcBuildCommandDictLines(idx, hasContracts) {
  const items = [
    '**Zoom-1 展开业务域模块树**：`node runner/donegate.mjs zoom <域编号 01..05|all> [更多域...]`',
    hasContracts ? '**Zoom-1 查看契约详情、冻结判据命令与导出存根**：`node runner/donegate.mjs zoom <契约ID> [--stubs]`' : null,
    idx.hasDecisionsDir ? '**Zoom-1 查看五段式架构决策精要表（加 `--full` 看原文）**：`node runner/donegate.mjs zoom <域编号|契约ID|all> --decisions [--full [编号关键词]]`' : null,
    `**Zoom-1 查看规则阈值、工作流与共享池字典**：\`node runner/donegate.mjs zoom rules\` | 单测目录：\`zoom tests [词]\` | 分支与缺口：\`zoom gaps${hasContracts ? ' [契约ID]' : ''}\``,
    '**Zoom-2 穿透单文件完整导出、内部函数、内联生成脚本函数、CLI 标志、路由与跨脚本路径**：`node runner/donegate.mjs zoom <相对文件路径> [更多文件...]`',
    '**跨文件波及面与 1-Hop 单测反查**：`node runner/donegate.mjs impact <符号|路由|DOM-ID|配置文件名>`'
  ].filter(Boolean);
  return items.map((txt, idxNum) => `> ${idxNum + 1}. ${txt}`);
}

function ckcBuildZoomZeroMarkdown(idx) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  const totalRaw = hasContracts ? idx.graph.nodes.reduce((a, n) => a + (n.stub?.sourceTokens || 0), 0) : idx.fallbackSourceTokens;
  const totalStub = hasContracts ? idx.graph.nodes.reduce((a, n) => a + (n.stub?.stubTokens || 0), 0) : Math.ceil(Object.values(idx.fileOutlines).reduce((a, o) => a + o.exports.join(' ').length, 0) / 4);
  const stepById = new Map(idx.domains.map((n) => [n.id, n.step]));
  const canvasSum = idx.domains.reduce((a, d) => a + (d.codeCapsule?.moduleCount || 0), 0);

  const z0 = [
    `# ${idx.atlas.project.name} · 主控全局根视口（Zoom-0 · 三级零漂移按需变焦页表）`,
    `> HEAD：\`${idx.gitHead}\` | 指纹：\`INTENT=${idx.intentHash}\` · \`CONSTRAINTS=${idx.constraintsHash}\``,
    `> 规模对账：源码模块 \`${idx.atlas.project.moduleCount}\` 个（画布含虚拟立约起点合计 \`${canvasSum}\` 项；声明式工作流 \`${idx.liveMeta.workflows.length}\` 个）| 唯一导出符号 \`${idx.hubs.uniqueSymbolCount}\` 个 | 架构决策 \`${idx.adrs.length}\` 篇 | 全仓源码约 \`${totalRaw.toLocaleString()} tok\` → 全仓接口存根 \`${totalStub.toLocaleString()} tok\``,
    '> **三级确定性下钻命令字典**（自带跨进程单飞指纹缓存，支持单条命令传多个目标批量下钻，如 `donegate zoom 03 04`）：',
    ...ckcBuildCommandDictLines(idx, hasContracts),
    '',
    '## 1. 业务域总览与隐藏信息索引（与「完结门」画布 1:1 同构）'
  ];
  for (const sn of idx.domains) z0.push(...ckcFormatDomainBlock(sn, stepById, idx, hasContracts));

  if (hasContracts) {
    z0.push('', '## 2. 密封契约卡边界与跨卡承重接口');
    z0.push(`推荐拓扑合入序：${idx.graph.topoOrder.map((x) => `\`${x}\``).join(' → ')}（双向跨卡调用场景须先锁定后端路由/门面协议合入 \`main\`，再派前端消费卡）`);
    for (const cid of idx.graph.topoOrder) z0.push(...ckcFormatContractBlock(cid, idx));
  } else {
    z0.push('', '## 2. 业务域跨域承重接口（零契约模式 · Kneedle 曲率拐点提取）');
    for (const sn of idx.domains) {
      const h = idx.hubs.hubsByDomain[sn.step];
      if (h && h.totalExported > 0) z0.push(`- **[${sn.step}] ${sn.title}**（导出符号 \`${h.totalExported}\` 个）：${ckcFormatHubItems(h, `donegate zoom ${sn.step}`)}`);
    }
  }
  z0.push(...ckcBuildZoomZeroGovernanceSection(idx, hasContracts));
  return z0.join('\n') + '\n';
}

export function cmdBrief(projectRoot, opts = {}) {
  const idx = buildCockpitGraphIndex(projectRoot);
  if (opts.json) {
    const out = JSON.stringify({ head: idx.gitHead, moduleCount: idx.atlas.project.moduleCount, domains: idx.domains.length, contracts: idx.graph.topoOrder, adrs: idx.adrs.length, gaps: idx.gaps.length }, null, 2);
    return { exitCode: 0, stdout: out };
  }
  const md = ckcBuildZoomZeroMarkdown(idx);
  if (typeof opts.out === 'string' && opts.out.trim()) {
    const absOut = resolve(projectRoot, opts.out.trim());
    mkdirSync(dirname(absOut), { recursive: true });
    writeFileSync(absOut, md, 'utf8');
  }
  return { exitCode: 0, stdout: md.trimEnd() };
}

function ckcHandleBuiltinZoomTopic(idx, topic, arg1) {
  if (topic === 'rules') {
    const hasContracts = (idx.graph.nodes || []).length > 0;
    const activeGlobs = hasContracts ? SHARED_GOVERNANCE_GLOBS : SHARED_GOVERNANCE_GLOBS.filter((g) => existsSync(join(idx.root, g.replace(/\/$/, ''))));
    return JSON.stringify({
      mode: hasContracts ? 'contract-governed' : 'zero-contract-public',
      thresholds: idx.thresholds,
      sharedGovernanceGlobs: activeGlobs,
      annotatedSubpacks: idx.liveMeta.annotatedSubpacks,
      newAdapterArchetypes: idx.liveMeta.archetypes,
      newAdapterUsage: idx.liveMeta.newAdapterHeader,
      declarationProtocol: idx.liveMeta.declarationProtocolConsts,
      sharedPoolLayout: idx.liveMeta.sharedPoolLayout,
      declarativeWorkflows: idx.liveMeta.workflows,
      intent: idx.intentText.trim(),
      constraints: idx.constraintsText.trim()
    }, null, 2);
  }
  if (topic === 'tests') {
    const kw = (arg1 || '').toLowerCase();
    const list = kw ? idx.liveMeta.testSummaries.filter((t) => t.file.toLowerCase().includes(kw) || t.header.toLowerCase().includes(kw) || t.cases.some((c) => c.toLowerCase().includes(kw))) : idx.liveMeta.testSummaries;
    const L = [`=== 全仓单测与夹具目录（匹配 ${list.length} / 总计 ${idx.liveMeta.testSummaries.length} 个） ===`];
    for (const t of list) L.push(`- ${t.file} [执行: ${t.file.endsWith('.test.mjs') ? `npx vitest run ${t.file}` : `node ${t.file}`}] — ${t.header}`);
    return L.join('\n');
  }
  if (topic === 'gaps') {
    const list = arg1 ? idx.gaps.filter((g) => g.contractId === arg1) : idx.gaps;
    const L = ['=== 本地分支雷达 ===', ...(idx.atlas.branches || []).map((b) => `- ${b.name}: ${b.isDefault ? '主线基线' : `+${b.ahead}/-${b.behind} 闲置${b.idleDays}d`}`), `\n=== 待验缺口明细（共 ${list.length} 项） ===`, ...list.map((g) => `- [${g.kind}] ${g.contractId || 'global'}: ${g.detail}`)];
    return L.join('\n');
  }
  return null;
}

function ckcLookupOrBuildFileOutline(idx, target) {
  const hit = idx.fileOutlines[target] || Object.values(idx.fileOutlines).find((o) => o.file.endsWith('/' + target));
  if (hit) return hit;
  const candAbs = resolve(idx.root, target);
  const rel = relative(idx.root, candAbs).split(sep).join('/');
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !existsSync(candAbs)) return null;
  try {
    if (!statSync(candAbs).isFile()) return null;
  } catch { return null; }
  const owners = (idx.graph.nodes || []).filter((n) => fileBelongsToScopes(rel, n.scope || [])).map((n) => n.id);
  return buildSingleFileOutline(idx.root, rel, owners, []);
}

function ckcResolveAllTarget(idx, stubsFlag, hasContracts) {
  if (stubsFlag) {
    return (idx.graph.nodes || []).map((c) => renderDomainOrContract(null, c, true, hasContracts)).join('\n\n') || ckcBuildZoomZeroMarkdown(idx);
  }
  return idx.domains.map((d) => renderDomainOrContract(d, null, false, hasContracts)).join('\n\n');
}

function ckcResolveZoomOutput(idx, target, arg1, opts) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  if (opts.decisions) return renderDecisionsZoom(idx, target, Boolean(opts.full), arg1 || '');
  if (target === 'all') return ckcResolveAllTarget(idx, Boolean(opts.stubs), hasContracts);
  if (!opts.stubs) {
    const builtinOut = ckcHandleBuiltinZoomTopic(idx, target, arg1);
    if (builtinOut !== null) return builtinOut;
    const fileHit = ckcLookupOrBuildFileOutline(idx, target);
    if (fileHit) return renderSingleFileZoom(fileHit, hasContracts);
  }
  const dom = idx.domains.find((d) => d.step === target || d.id === target);
  const con = (idx.graph.nodes || []).find((c) => c.id === target);
  return (dom || con) ? renderDomainOrContract(dom, con, Boolean(opts.stubs), hasContracts) : null;
}

export function cmdZoom(projectRoot, opts = {}) {
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  if (targets.length === 0) {
    return { exitCode: 3, stderr: '用法：donegate zoom <域编号|契约ID|文件路径|rules|tests|gaps|all> [更多目标...] [--stubs] [--decisions] [--full [关键词]]' };
  }
  if (targets[0] === 'impact') return cmdImpact(projectRoot, { targets: targets.slice(1), json: opts.json });
  const idx = buildCockpitGraphIndex(projectRoot);
  const first = targets[0].replace(/^\.\//, '');
  const isParameterizedTopic = opts.decisions || first === 'tests' || first === 'gaps' || first === 'rules';
  if (isParameterizedTopic || targets.length === 1) {
    const out = ckcResolveZoomOutput(idx, first, targets[1], opts);
    return out !== null ? { exitCode: 0, stdout: out } : { exitCode: 1, stderr: `未找到匹配域编号、契约 ID 或文件路径：${first}` };
  }
  const chunks = [];
  for (const rawT of targets) {
    const cleanT = rawT.replace(/^\.\//, '');
    const out = ckcResolveZoomOutput(idx, cleanT, '', opts);
    if (out === null) return { exitCode: 1, stderr: `未找到匹配域编号、契约 ID 或文件路径：${cleanT}` };
    chunks.push(out);
  }
  return { exitCode: 0, stdout: chunks.join('\n\n') };
}
