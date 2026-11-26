// 主控驾驶舱 Zoom-1 / Zoom-2 视图格式化渲染器（单一真源 CBM 开源图谱 + 极薄契约/ADR 挂载 + 末步直读源码，<= 350 行）

function ckrAppendCbmFileGraph(L, fileInfo, cbmGraph) {
  if (!cbmGraph) {
    L.push('开源图谱状态: 未检测到 codebase-memory-mcp 索引（可直接通过末步直读句柄查看真实源码）');
    L.push(`末步直读源码句柄: node runner/donegate.mjs zoom ${fileInfo.file}:1-${fileInfo.totalLines} --source`);
    return;
  }
  const fns = (cbmGraph.symbols || []).filter((s) => s.label === 'Function');
  const vars = (cbmGraph.symbols || []).filter((s) => s.label !== 'Function');
  if (fns.length > 0) {
    L.push(`CBM 图谱函数符号锚点 (共 ${fns.length} 项):`);
    for (const s of fns) {
      L.push(`  · ${s.isExported ? 'export ' : ''}${s.name}${s.signature || '()'} [L${s.startLine}-L${s.endLine}]`);
    }
  }
  if (vars.length > 0) {
    const vList = vars.map((v) => `${v.name}[L${v.startLine}${v.endLine > v.startLine ? `-L${v.endLine}` : ''}]`);
    L.push(`CBM 顶层变量/常量锚点 (共 ${vars.length} 项): ${vList.join(', ')}`);
  }
  if (cbmGraph.imports?.length > 0) {
    L.push(`CBM 依赖导入 IMPORTS (共 ${cbmGraph.imports.length} 条): ${cbmGraph.imports.join(', ')}`);
  }
  if (cbmGraph.inboundCallers?.length > 0) {
    const ins = cbmGraph.inboundCallers.map((c) => `${c.file}#${c.symbol}${c.line ? `@L${c.line}` : ''}`);
    L.push(`CBM 跨文件上游调用方 Callers (← 共 ${ins.length} 处): ${ins.join(', ')}`);
  }
  if (cbmGraph.outboundCallees?.length > 0) {
    const outs = cbmGraph.outboundCallees.map((c) => `${c.file}#${c.symbol}${c.targetLine ? `[L${c.targetLine}]` : ''}`);
    L.push(`CBM 跨文件下游被调方 Callees (→ 共 ${outs.length} 处): ${outs.join(', ')}`);
  }
  if (cbmGraph.spawns?.length > 0) {
    L.push(`CBM 子进程调用 SPAWNS: ${cbmGraph.spawns.map((s) => `${s.program}${s.line ? `@L${s.line}` : ''}`).join(', ')}`);
  }
  if (cbmGraph.httpRoutes?.length > 0) {
    L.push(`CBM HTTP 路由调用: ${cbmGraph.httpRoutes.join(', ')}`);
  }
  if (cbmGraph.docMentions?.length > 0) {
    const docs = [...new Set(cbmGraph.docMentions.map((d) => d.docFile))];
    L.push(`CBM 文档与历史记录反链: ${docs.join(', ')}`);
  }
  L.push(`末步直读源码句柄: node runner/donegate.mjs zoom ${fileInfo.file}:1-${fileInfo.totalLines} --source`);
}

export function renderSingleFileZoom(fileInfo, hasContracts, extra = {}) {
  const fallbackOwner = !hasContracts
    ? `零契约公开/轻量模式（改完单文件直接跑 node runner/donegate.mjs lint-edit ${fileInfo.file}）`
    : (fileInfo.isSharedGov ? 'SHARED_GOVERNANCE_GLOBS 公共治理白名单' : '契约外根级/单测文件（tests/** 免计生产配额；根配置加 --allow-cross-scope）');
  const L = [
    `=== [Zoom-2 单文件图谱视图] ${fileInfo.file} (共 ${fileInfo.totalLines} 行) ===`,
    `归属契约: ${fileInfo.owners.filter(Boolean).join(', ') || fallbackOwner}`,
    ...(extra?.adrLines || []),
    `模块说明: ${fileInfo.header}`
  ];
  ckrAppendCbmFileGraph(L, fileInfo, extra?.cbmGraph);
  return L.join('\n');
}

export function renderDecisionsZoom(idx, target, fullFlag, filterKw) {
  if (!idx.hasDecisionsDir) {
    return '当前仓库不含内部 decisions/ 目录（公开脱敏分发包默认剥离内部研发决策记录；如需新建运行期决策，可在 decisions/ 下按 §2.5 五段式规范创建）。';
  }
  const dom = idx.domains.find((d) => d.step === target || d.id === target);
  const con = (idx.graph.nodes || []).find((c) => c.id === target);
  let matched = target === 'all' ? idx.adrs : [];
  if (target !== 'all') {
    if (dom) matched = idx.adrs.filter((a) => a.domains.includes(dom.step));
    else if (con) matched = idx.adrs.filter((a) => a.contracts.includes(con.id));
    else matched = idx.adrs.filter((a) => a.file.includes(target) || a.content.includes(target));
  }
  if (fullFlag) {
    const sub = filterKw ? matched.filter((a) => a.file.includes(filterKw) || a.content.includes(filterKw)) : matched;
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

function ckrRenderContractDetail(con, stubsFlag) {
  const biPeers = (con.dependsOnIds || []).filter((x) => (con.dependedByIds || []).includes(x));
  const scopeFiles = con.stub?.scopeFiles || [];
  const L = [
    `=== 契约详情: ${con.id} (${con.title}) ===`,
    `职责说明: ${con.why}`,
    `管辖路径 scope[]: ${JSON.stringify(con.scope)}（实辖源码 ${scopeFiles.length} 个：${scopeFiles.join(', ') || '无'}）`,
    `显式声明 dependsOn: ${(con.declaredDependsOn || []).join(', ') || '无'}`,
    `静态导入上游: ${con.dependsOnIds.join(', ') || '无'} | 下游消费方: ${con.dependedByIds.join(', ') || '无'}`,
    ...(biPeers.length > 0 ? [`双向互引契约拆单提示: 与 [${biPeers.join(', ')}] 存在双向依赖——改动跨卡协议时须先锁定底座/后端门面卡合入 main，再派前端/外围消费卡`] : []),
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

function ckrCompactDesc(raw, compact) {
  const txt = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!compact || txt.length <= 60) return txt;
  return `${txt.slice(0, 59)}…`;
}

export function renderDomainOrContract(dom, con, stubsFlag, hasContracts, compact = false) {
  if (con && (stubsFlag || !dom)) return ckrRenderContractDetail(con, stubsFlag);
  const ownerFallback = hasContracts ? '根级共享' : '零契约公开模式';
  const L = [`=== 业务域 Zoom-1 展开: [${dom.step}] ${dom.title} (共 ${dom.codeCapsule?.moduleCount || 0} 项 | 归属: ${(dom.contractIds || []).join(', ') || ownerFallback}) ===`];
  const walkDom = (nodes, prefix) => {
    for (const nd of nodes || []) {
      const tag = `${prefix}.${nd.step}`;
      L.push(`\n[${tag}] ${nd.title} (归属: ${(nd.contractIds || []).join(', ') || ownerFallback} | 项数: ${nd.codeCapsule?.moduleCount || nd.modules?.length || 0})`);
      if (nd.subgraph?.nodes?.length) walkDom(nd.subgraph.nodes, tag);
      else for (const m of nd.modules || []) L.push(`  · ${m.path} [${m.ownerContracts?.length ? `契约:${m.ownerContracts.join(',')}` : ownerFallback}] — ${ckrCompactDesc(m.fullHeader || m.name, compact)}`);
    }
  };
  if (dom.subgraph?.nodes?.length) walkDom(dom.subgraph.nodes, dom.step);
  else for (const m of dom.modules || []) L.push(`  · ${m.path} — ${ckrCompactDesc(m.fullHeader || m.name, compact)}`);
  return L.join('\n');
}
