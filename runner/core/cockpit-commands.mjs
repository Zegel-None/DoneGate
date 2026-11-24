// 主控三级按需变焦命令实现（donegate brief 根视口 + donegate zoom 三级确定性寻址，<= 350 行）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCockpitGraphIndex } from './cockpit-index.mjs';
import { SHARED_GOVERNANCE_GLOBS } from './context-router.mjs';
import { cmdImpact } from './impact-radar.mjs';

function ckcCollectDomainPaths(node, out) {
  for (const m of node.modules || []) {
    if (m.path) out.push(m.path);
  }
  for (const sub of node.subgraph?.nodes || []) ckcCollectDomainPaths(sub, out);
}

function ckcCountDomainRoutes(sn, idx) {
  const fromContracts = (sn.contractIds || []).reduce(
    (acc, cid) => acc + ((idx.graph.nodes.find((x) => x.id === cid)?.stub?.httpRoutes || []).length),
    0
  );
  if (fromContracts > 0) return fromContracts;
  const paths = [];
  ckcCollectDomainPaths(sn, paths);
  const seen = new Set();
  for (const p of paths) {
    for (const r of idx.fileOutlines[p]?.httpRoutes || []) {
      if (!r.startsWith('FETCH/ROUTE ')) seen.add(r);
    }
  }
  return seen.size;
}

function ckcFormatDomainBlock(sn, stepById, idx) {
  const nextSteps = (sn.nextIds || []).map((id) => `→${stepById.get(id) || id}`).join(' ') || '→[终态门禁]';
  const cids = (sn.contractIds || []).length ? sn.contractIds.map((c) => `\`${c}\``).join(', ') : '根级共享治理（无单一契约）';
  const innerTitles = (sn.subgraph?.nodes || []).map((x) => `${sn.step}.${x.step} ${x.title}(${x.codeCapsule?.moduleCount || 0}项)`).join(' → ');
  const domAdrCount = idx.adrs.filter((a) => a.domains.includes(sn.step)).length;
  const domGaps = idx.gaps.filter((g) => (sn.contractIds || []).includes(g.contractId)).length;
  const domRoutes = ckcCountDomainRoutes(sn, idx);
  const adrLabel = idx.hasDecisionsDir ? `挂靠 ADR：${domAdrCount} 篇` : 'ADR：未启用 decisions/';
  return [
    `- **[${sn.step}] ${sn.title}**（含 ${sn.codeCapsule?.moduleCount || 0} 项 | 归属契约：${cids} | 流向：${nextSteps}）`,
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

function ckcBuildZoomZeroMarkdown(idx) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  const totalRaw = hasContracts ? idx.graph.nodes.reduce((a, n) => a + (n.stub?.sourceTokens || 0), 0) : idx.fallbackSourceTokens;
  const totalStub = hasContracts ? idx.graph.nodes.reduce((a, n) => a + (n.stub?.stubTokens || 0), 0) : Math.ceil(Object.values(idx.fileOutlines).reduce((a, o) => a + o.exports.join(' ').length, 0) / 4);
  const stepById = new Map(idx.domains.map((n) => [n.id, n.step]));
  const nonMain = (idx.atlas.branches || []).filter((b) => !b.isDefault);
  const th = idx.thresholds;
  const archStr = idx.liveMeta.archetypes.join('|') || 'scanner';
  const subpackStr = Object.keys(idx.liveMeta.annotatedSubpacks).map((k) => `\`${k}\``).join(', ');
  const canvasSum = idx.domains.reduce((a, d) => a + (d.codeCapsule?.moduleCount || 0), 0);

  const z0 = [
    `# ${idx.atlas.project.name} · 主控全局根视口（Zoom-0 · 三级零漂移按需变焦页表）`,
    `> HEAD：\`${idx.gitHead}\` | 指纹：\`INTENT=${idx.intentHash}\` · \`CONSTRAINTS=${idx.constraintsHash}\``,
    `> 规模对账：源码模块 \`${idx.atlas.project.moduleCount}\` 个（画布含根锚点合计 \`${canvasSum}\` 项；声明式工作流 \`${idx.liveMeta.workflows.length}\` 个）| 唯一导出符号 \`${idx.hubs.uniqueSymbolCount}\` 个 | 架构决策 \`${idx.adrs.length}\` 篇 | 全仓源码约 \`${totalRaw.toLocaleString()} tok\` → 全仓接口存根 \`${totalStub.toLocaleString()} tok\``,
    '> **三级确定性下钻命令字典**（所有未展开细节均从代码/配置真源实时抽取，支持 O(1) 寻址）：',
    '> 1. **Zoom-1 展开业务域模块树（带单文件契约标签）**：`node runner/donegate.mjs zoom <域编号 01..05>`',
    '> 2. **Zoom-1 查看契约详情、冻结判据命令与导出存根**：`node runner/donegate.mjs zoom <契约ID> [--stubs]`',
    '> 3. **Zoom-1 查看五段式架构决策精要表（加 `--full` 看原文）**：`node runner/donegate.mjs zoom <域编号|契约ID|all> --decisions [--full [编号关键词]]`',
    '> 4. **Zoom-1 查看实时阈值、脚手架/九字段/十禁词协议、共享池子目录与工作流清单**：`node runner/donegate.mjs zoom rules` | 单测目录：`zoom tests [词]` | 分支与缺口：`zoom gaps [契约ID]`',
    '> 5. **Zoom-2 穿透单文件完整导出、内部函数、浏览器内联函数、常量键值、路由与多行导入**：`node runner/donegate.mjs zoom <相对文件路径>`',
    '> 6. **跨文件波及面与 1-Hop 单测反查**：`node runner/donegate.mjs impact <符号|路由|DOM-ID|配置文件名>`',
    '',
    '## 1. 业务域总览与隐藏信息索引（与「完结门」画布 1:1 同构）'
  ];
  for (const sn of idx.domains) z0.push(...ckcFormatDomainBlock(sn, stepById, idx));

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

  z0.push('', '## 3. 核心工程红线、实时阈值真源与派工规约（完整字典查 `donegate zoom rules`）');
  z0.push('- **永久铁律**：① 零第三方 npm 运行时依赖、主力适配 Windows (`win32`)、子进程直读退出码禁吞错；② `decisions/`（若启用）严守 `INV-13` 只增不改且新档必齐五段；③ 新增源码须归入契约 `scope[]`（显式文件 `path/foo.mjs` 自动认领同名伴生目录 `path/foo/*.mjs` 且保持 `stubHash` 零漂移）。');
  if (th.maxCommitCodeLines) {
    z0.push(`- **四维门禁实时阈值（\`thresholds.json\`）**：① 生产净增 \`<= ${th.warnCommitCodeLines}\` 直通、\`251–${th.maxCommitCodeLines}\` 软预警、\`> ${th.maxCommitCodeLines}\` 硬拦（原始硬顶 \`${th.maxRawCommitCodeLines}\`，\`tests/**\` 与 \`.json/.md\` 豁免，净增 \`>= 80\` 行无单测触发 \`C1t\` 提示）；② 生产文件 \`<= ${th.maxProdCommitFiles}\`、含测试总文件 \`<= ${th.maxCommitFiles}\`；③ 单文件有效行 \`${th.warnEffectiveFileLines}/${th.maxEffectiveFileLines}\`（物理硬顶 \`${th.maxFileLines}\`，单函数 \`${th.warnFunctionLines}\` 行预警，核心子模块 \`<= 350\` 行，具体适配器 \`<= 90\` 行）；④ 单函数认知复杂度 \`<= ${th.warnCognitiveComplexity}\` 绿灯 / \`> ${th.maxCognitiveComplexity}\` 硬拦，禁 \`C4g\` 压行。`);
  }
  z0.push(`- **公共路径、跨界验收与子包**：\`SHARED_GOVERNANCE_GLOBS\` = ${SHARED_GOVERNANCE_GLOBS.map((g) => `\`${g}\``).join(', ')}；\`check-node <契约ID> --allow-cross-scope --receipt\` 放行契约外公共治理文件与根台账并记录 \`crossScopeFiles[]\`；画布子包：${subpackStr}。`);
  z0.push(`- **外部工具扩展与共享池**：\`node skill/new-adapter.mjs <tool> --archetype <${archStr}> --card-json\` 生成薄适配器（委托 \`_shared.mjs\` \`runAdapter\`）与 \`bricks/<tool>/capabilities.json\`；共享池位于 \`workflows/.deps/_shared/\`（含 \`.bin/\`、\`dists/\`、\`npm-cells/<id>/\`）。`);
  const brWarn = nonMain.length ? `当前检出 ${nonMain.length} 条非主线分支（${nonMain.map((b) => `\`${b.name}\``).join('、')}），派工必显式基于 \`main\`` : '当前仅 `main` 主线活跃';
  z0.push(`- **派工与合入闭环（${brWarn}）**：\`git worktree add <wtDir> -b <branch> main\` → \`preflight --stamp-lease\` → \`impact <目标>\` → \`slice <契约ID> [--focus <路径|@subpack>]\` → 逐文件 \`lint-edit <file>\` → \`check-node <契约ID> [--allow-cross-scope] --receipt\`。`);
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

function ckcRenderFileZoom(fileHit) {
  const govTag = fileHit.isSharedGov ? 'SHARED_GOVERNANCE_GLOBS 公共治理白名单' : '契约外根级台账（check-node 需加 --allow-cross-scope）';
  const L = [
    `=== [Zoom-2 单文件结构大纲] ${fileHit.file} ===`,
    `归属契约: ${fileHit.owners.filter(Boolean).join(', ') || govTag}`,
    `模块完整说明: ${fileHit.header}`,
    `对外导出签名与常量键值 (exports, 共 ${fileHit.exports.length} 项):`
  ];
  if (fileHit.exports.length === 0) L.push('  (无对外导出，脚本入口模块)');
  for (const e of fileHit.exports) L.push(`  · export ${e}`);
  if (fileHit.constantsPreview.length > 0) {
    L.push('关键协议常量 / 注册表 / JSON 内容真源:');
    for (const cp of fileHit.constantsPreview) L.push(`  · ${cp}`);
  }
  if (fileHit.internalFunctions.length > 0) {
    L.push(`模块级内部函数签名 (共 ${fileHit.internalFunctions.length} 项，完整无截断):`);
    for (const fn of fileHit.internalFunctions) L.push(`  · function ${fn}`);
  }
  if (fileHit.browserInlineFunctions.length > 0) {
    L.push(`内联浏览器端脚本函数签名 (共 ${fileHit.browserInlineFunctions.length} 项，完整无截断):`);
    for (const fn of fileHit.browserInlineFunctions) L.push(`  · [browser] function ${fn}`);
  }
  if (fileHit.httpRoutes.length > 0) L.push(`涉及 HTTP 路由/接口 (共 ${fileHit.httpRoutes.length} 条): ${fileHit.httpRoutes.join(', ')}`);
  if (fileHit.domAnchors.length > 0) L.push(`涉及 DOM ID / data-* 锚点 (共 ${fileHit.domAnchors.length} 个): ${fileHit.domAnchors.join(', ')}`);
  if (fileHit.referencedPaths.length > 0) L.push(`引用的配置/磁盘路径常量: ${fileHit.referencedPaths.join(', ')}`);
  if (fileHit.imports.length > 0) {
    L.push(`依赖导入 (imports, 共 ${fileHit.imports.length} 条):`);
    for (const imp of fileHit.imports) L.push(`  · ${imp}`);
  }
  return L.join('\n');
}

function ckcRenderDecisionsZoom(idx, target, fullFlag, filterKw) {
  if (!idx.hasDecisionsDir) {
    return '当前仓库不含内部 decisions/ 目录（公开脱敏分发包默认剥离内部研发决策记录；如需新建运行期决策，可在 decisions/ 下按 §2.5 五段式规范创建）。';
  }
  const dom = idx.domains.find((d) => d.step === target || d.id === target);
  const con = (idx.graph.nodes || []).find((c) => c.id === target);
  let matched = target === 'all' ? idx.adrs : [];
  if (target !== 'all') {
    if (dom) matched = idx.adrs.filter((a) => a.domains.includes(dom.step));
    else if (con) matched = idx.adrs.filter((a) => a.contracts.includes(con.id));
    else matched = idx.adrs.filter((a) => a.file.includes(target));
  }
  if (fullFlag) {
    const sub = filterKw ? matched.filter((a) => a.file.includes(filterKw)) : matched;
    const L = [`=== 架构决策原文展开 ("${target}"${filterKw ? ` 筛选 ${filterKw}` : ''} · 共 ${sub.length} 篇) ===`];
    for (const a of sub) L.push(`\n--- FILE: decisions/${a.file} (域:${a.domains.join(',')} | 契约:${a.contracts.join(',') || '全局'}) ---`, a.content.trim());
    return L.join('\n');
  }
  const L = [`=== 归属 "${target}" 的五段式 ADR 精要索引（共 ${matched.length} 篇；看全文加: --decisions --full <编号>） ===`];
  for (const a of matched) {
    L.push(`- [${a.file}] (域:${a.domains.join(',')} | 契约:${a.contracts.join(',') || '全局'})`);
    L.push(`    选了哪个: ${a.chosenDigest}`, `    为什么/代价: ${a.whyDigest}`, `    翻案条件: ${a.reopenDigest}`);
  }
  return L.join('\n');
}

function ckcRenderDomainOrContract(idx, dom, con, stubsFlag) {
  if (con && (stubsFlag || !dom)) {
    const L = [
      `=== 契约详情: ${con.id} (${con.title}) ===`,
      `职责说明: ${con.why}`,
      `管辖路径 scope[]: ${JSON.stringify(con.scope)}`,
      `显式声明 dependsOn: ${(con.declaredDependsOn || []).join(', ') || '无'}`,
      `静态导入上游: ${con.dependsOnIds.join(', ') || '无'} | 下游消费方: ${con.dependedByIds.join(', ') || '无'}`,
      `HTTP 路由: ${(con.stub?.httpRoutes || []).map((r) => `${r.method || 'API'} ${r.path || r}`).join(', ') || '无'}`,
      '冻结判据条目 (obligations):'
    ];
    for (const o of con.obligations || []) {
      L.push(`  - [${o.id}] (${o.kind || 'command'}): ${o.claim || ''}`);
      if (o.command) L.push(`      验收命令: ${o.command}`);
      if (o.spansContracts?.length) L.push(`      跨卡联保: ${o.spansContracts.join(', ')}`);
      if (o.breakPatch?.file) L.push(`      有牙靶点: ${o.breakPatch.file}`);
    }
    if (stubsFlag) L.push('\n--- 契约导出接口存根 (.stub.d.ts) ---', con.stub?.stubText || '');
    return L.join('\n');
  }
  const L = [`=== 业务域 Zoom-1 展开: [${dom.step}] ${dom.title} (共 ${dom.codeCapsule?.moduleCount || 0} 项 | 契约: ${(dom.contractIds || []).join(', ') || '根级共享'}) ===`];
  const walkDom = (nodes, prefix) => {
    for (const nd of nodes || []) {
      const tag = `${prefix}.${nd.step}`;
      L.push(`\n[${tag}] ${nd.title} (覆盖契约: ${(nd.contractIds || []).join(', ') || '根级共享'} | 项数: ${nd.codeCapsule?.moduleCount || nd.modules?.length || 0})`);
      if (nd.subgraph?.nodes?.length) walkDom(nd.subgraph.nodes, tag);
      else for (const m of nd.modules || []) L.push(`  · ${m.path} [${m.ownerContracts?.length ? `契约:${m.ownerContracts.join(',')}` : '根级共享'}] — ${m.fullHeader || m.name}`);
    }
  };
  if (dom.subgraph?.nodes?.length) walkDom(dom.subgraph.nodes, dom.step);
  else for (const m of dom.modules || []) L.push(`  · ${m.path} — ${m.fullHeader || m.name}`);
  return L.join('\n');
}

function ckcHandleBuiltinZoomTopic(idx, topic, arg1) {
  if (topic === 'rules') {
    return JSON.stringify({
      thresholds: idx.thresholds,
      sharedGovernanceGlobs: SHARED_GOVERNANCE_GLOBS,
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

export function cmdZoom(projectRoot, opts = {}) {
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  if (targets.length === 0) {
    return { exitCode: 3, stderr: '用法：donegate zoom <域编号|契约ID|文件路径|rules|tests|gaps|all> [--stubs] [--decisions] [--full [关键词]]' };
  }
  if (targets[0] === 'impact') return cmdImpact(projectRoot, { targets: targets.slice(1), json: opts.json });
  const idx = buildCockpitGraphIndex(projectRoot);
  const target = targets[0].replace(/^\.\//, '');
  const builtinOut = !opts.decisions && !opts.stubs ? ckcHandleBuiltinZoomTopic(idx, target, targets[1]) : null;
  if (builtinOut !== null) return { exitCode: 0, stdout: builtinOut };

  const fileHit = idx.fileOutlines[target] || Object.values(idx.fileOutlines).find((o) => o.file.endsWith('/' + target));
  if (fileHit && !opts.decisions && !opts.stubs) return { exitCode: 0, stdout: ckcRenderFileZoom(fileHit) };
  if (opts.decisions) return { exitCode: 0, stdout: ckcRenderDecisionsZoom(idx, target, Boolean(opts.full), targets[1] || '') };

  const dom = idx.domains.find((d) => d.step === target || d.id === target);
  const con = (idx.graph.nodes || []).find((c) => c.id === target);
  if (dom || con) return { exitCode: 0, stdout: ckcRenderDomainOrContract(idx, dom, con, Boolean(opts.stubs)) };
  return { exitCode: 1, stderr: `未找到匹配域编号、契约 ID 或文件路径：${target}` };
}
