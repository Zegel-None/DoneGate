// DoneGate 宿主治理专属 Zoom-0 根视口与 rules 字典渲染器（仅被 donegate-adapter 引用，零循环依赖，L5）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_GOVERNANCE_GLOBS } from '../../core/index.mjs';

const DGB_CAPSULE_BUDGET_TOK = 160000;

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

function ckcFormatDomainBlock(sn, stepById, idx, hasContracts) {
  const nextSteps = (sn.nextIds || []).map((id) => `→${stepById.get(id) || id}`).join(' ') || '→[终态门禁]';
  const defaultOwner = hasContracts ? '根级共享治理（无单一契约）' : '零契约公开分发模式';
  const cids = (sn.contractIds || []).length ? sn.contractIds.map((c) => `\`${c}\``).join(', ') : defaultOwner;
  const innerTitles = (sn.subgraph?.nodes || []).map((x) => `${sn.step}.${x.step} ${x.title}(${x.codeCapsule?.moduleCount || 0}项)`).join(' → ');
  const domAdrCount = idx.adrs.filter((a) => a.domains.includes(sn.step)).length;
  const domGaps = idx.gaps.filter((g) => (sn.contractIds || []).includes(g.contractId)).length;
  const adrLabel = idx.hasDecisionsDir ? `挂靠 ADR：${domAdrCount} 篇` : 'ADR：未启用 decisions/';
  const physDirs = ckcSummarizePhysicalDirs(sn);
  return [
    `- **[${sn.step}] ${sn.title}**（物理目录：\`${physDirs}\` | 含 ${sn.codeCapsule?.moduleCount || 0} 项 | 归属：${cids} | 流向：${nextSteps}）`,
    `  - 内部结构：${innerTitles || '直接模块'} | 待跑证据：${domGaps} 项 | ${adrLabel}`,
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

function ckcFormatCapacityGauge(tokens) {
  const pct = Math.min(100, Math.round(((tokens || 0) / DGB_CAPSULE_BUDGET_TOK) * 100));
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `[${bar}] ${pct}%`;
}

function ckcFormatContractBlock(cid, idx, layerMap) {
  const n = idx.graph.nodes.find((x) => x.id === cid);
  const h = idx.hubs.hubsByContract[cid];
  const layer = layerMap.get(cid) ?? 0;
  const srcTok = n.stub?.sourceTokens || 0;
  const gauge = ckcFormatCapacityGauge(srcTok);
  const up = n.dependsOnIds.length ? `上游:[${n.dependsOnIds.join(', ')}]` : '上游:无(L0叶)';
  const noDownLabel = n.dependsOnIds.length ? '下游:无(顶层)' : '下游:无(孤立卡·无静态引用方)';
  const down = n.dependedByIds.length ? `下游:[${n.dependedByIds.join(', ')}]` : noDownLabel;
  const cidAdr = idx.hasDecisionsDir ? ` | ADR:${idx.adrs.filter((a) => a.contracts.includes(cid)).length}` : '';
  return [
    `- **[L${layer}] \`${cid}\`** · ${gauge}（${n.title} | \`${srcTok.toLocaleString()} tok\` / 存根 \`${n.stub?.stubTokens || 0} tok\` | ${up} · ${down}${cidAdr}）`,
    `  - 核心承重接口：${ckcFormatHubItems(h, `donegate zoom ${cid} --stubs`)}`
  ];
}

function ckcBuildZoomZeroGovernanceSection(idx, hasContracts) {
  const th = idx.thresholds, thSrc = idx.hasThresholdsFile ? 'thresholds.json' : '默认内置预算';
  const archStr = idx.liveMeta.archetypes.join('|') || 'scanner';
  const subpackStr = Object.keys(idx.liveMeta.annotatedSubpacks).map((k) => `\`${k}\``).join(', ');
  const activeGovGlobs = hasContracts ? SHARED_GOVERNANCE_GLOBS : SHARED_GOVERNANCE_GLOBS.filter((g) => existsSync(join(idx.root, g.replace(/\/$/, ''))));
  const nonMain = (idx.atlas.branches || []).filter((b) => !b.isDefault);
  const brWarn = nonMain.length ? `当前检出 ${nonMain.length} 条非主线分支（${nonMain.map((b) => `\`${b.name}\``).join('、')}），派工必显式基于 \`main\`` : '当前仅 `main` 主线活跃';

  const L = ['', '## 3. 核心工程红线、实时阈值真源与派工规约（完整字典查 `donegate zoom rules`）'];
  L.push('- **永久铁律**：① 判定核运行时零第三方 npm 依赖（`tests/*.test.mjs` 使用可选开发依赖 `vitest`，裸克隆跑单测前先 `npm install`）、主力适配 Windows (`win32`)、子进程直读退出码禁吞错；② `decisions/`（若启用）严守 `INV-13` 只增不改且新档必齐五段；③ 启用契约时新增源码须归入 `scope[]`（显式文件 `path/foo.mjs` 自动认领同名伴生目录 `path/foo/*.mjs` 且保持 `stubHash` 零漂移）。');
  if (th.maxCommitCodeLines) {
    L.push(`- **四维门禁实时阈值（${thSrc}）**：① 生产净增 \`<= ${th.warnCommitCodeLines}\` 直通、\`251–${th.maxCommitCodeLines}\` 软预警、\`> ${th.maxCommitCodeLines}\` 硬拦（原始硬顶 \`${th.maxRawCommitCodeLines}\`，\`tests/**\` 与 \`.json/.md\` 豁免，净增 \`>= 80\` 行无单测触发 \`C1t\` 提示）；② 生产文件 \`<= ${th.maxProdCommitFiles}\`、含测试总文件 \`<= ${th.maxCommitFiles}\`；③ 单文件有效行 \`${th.warnEffectiveFileLines}/${th.maxEffectiveFileLines}\`（物理硬顶 \`${th.maxFileLines}\`，单函数 \`${th.warnFunctionLines}\` 行预警，核心子模块 \`<= 350\` 行，具体适配器 \`<= 90\` 行）；④ 单函数认知复杂度 \`<= ${th.warnCognitiveComplexity}\` 绿灯 / \`> ${th.maxCognitiveComplexity}\` 硬拦，禁 \`C4g\` 压行。`);
  }
  L.push(`- **公共路径、跨界验收与子包**：已存在公共治理白名单 \`SHARED_GOVERNANCE_GLOBS\` = ${activeGovGlobs.map((g) => `\`${g}\``).join(', ')}；有契约项目可用 \`check-node <契约ID> --allow-cross-scope --receipt\` 放行公共治理文件与根台账；画布子包：${subpackStr}。`);
  L.push(`- **外部工具扩展与共享池**：\`node skill/new-adapter.mjs <tool> --archetype <${archStr}> --card-json\` 生成薄适配器（委托 \`_shared.mjs\` \`runAdapter\`）与 \`bricks/<tool>/capabilities.json\`；共享池位于 \`workflows/.deps/_shared/\`（含 \`.bin/\`、\`dists/\`、\`npm-cells/<id>/\`）。`);
  L.push(hasContracts
    ? `- **派工与合入闭环（${brWarn}）**：\`git worktree add <wtDir> -b <branch> main\` → \`preflight --stamp-lease\` → \`impact <目标>\` → \`slice <契约ID> [--focus <路径|@subpack>]\` → 末步 \`zoom <文件:起-止> --source\` 精读源码 → 逐文件 \`lint-edit <file>\` → \`check-node <契约ID> [--allow-cross-scope] --receipt\`。`
    : `- **零契约公开/轻量模式开发闭环（${brWarn}）**：\`git worktree add <wtDir> -b <branch> main\` → \`impact <目标>\` → \`zoom <路径|符号>\` → 末步 \`zoom <文件:起-止> --source\` 精读源码 → 逐文件 \`lint-edit <file>\` → 全套自检 \`node skill/check-escapes.mjs --self-check\` + \`npm test\`。`);
  return L;
}

function ckcBuildCommandDictLines(idx, hasContracts) {
  const items = [
    '**第一步 · 任务语义直达定位（FTS5 种子 + 入度阻尼 PPR + 预算打包）**：`node runner/donegate.mjs locate "<任务描述>" [--budget 4000]`（MCP 宿主优先调 `dg_locate`）',
    '**图谱域/契约缩圈（Zoom-1）**：`node runner/donegate.mjs zoom <域编号 01..05|all> [更多域...]`' + (hasContracts ? ' | 契约详情与存根：`zoom <契约ID> [--stubs]`' : ''),
    idx.hasDecisionsDir ? '**极薄契约/ADR 历史决策挂载**：`node runner/donegate.mjs zoom <域编号|契约ID|文件路径|all> --decisions [--full [编号关键词]]`' : null,
    '**真源规则、单测与缺口并列查询**：`node runner/donegate.mjs zoom rules tests gaps`（亦支持 `zoom tests <词>` 过滤）',
    '**第二步 · 骨架压缩与双向 2-Hop 调用链（Zoom-2 · 置信度标注）**：`node runner/donegate.mjs zoom <相对文件路径 | 符号名> [--skeleton]`',
    '**跨文件波及面与无截断多跳（≤3 跳）单测反查**：`node runner/donegate.mjs impact <文件|符号|路由|DOM-ID|配置文件名>`',
    '**第三步 · 最后一步按行直读真实源码（锁准 2~5 个目标后必看真源）**：`node runner/donegate.mjs zoom <文件路径[:起-止] | 函数符号名> --source`'
  ].filter(Boolean);
  return items.map((txt, idxNum) => `> ${idxNum + 1}. ${txt}`);
}

function ckcBuildArchHealthLine(idx, hasContracts, maxLayer) {
  if (!hasContracts) return null;
  const maxUtilPct = Math.max(0, ...idx.graph.nodes.map((n) => Math.round(((n.stub?.sourceTokens || 0) / DGB_CAPSULE_BUDGET_TOK) * 100)));
  const sccCount = (idx.graph.sccCycles || []).length;
  if (sccCount === 0) {
    return `> 架构健康：严格单向无环 DAG ✅（\`L0–L${maxLayer}\` · 0 强连通环 · \`${idx.graph.nodes.length}\` 张契约卡） | 单卡容量峰值 \`${maxUtilPct}%\`（160k 胶囊上限）`;
  }
  return `> 架构健康：检测到 ${sccCount} 个强连通环 ⚠️ | 单卡容量峰值 \`${maxUtilPct}%\`（160k 胶囊上限）`;
}

function ckcBuildContractSectionLines(idx, hasContracts, layerMap, maxLayer) {
  if (!hasContracts) {
    const out = ['', '## 2. 业务域跨域承重接口（零契约模式 · CBM 调用图 + Kneedle 拐点）'];
    for (const sn of idx.domains) {
      const h = idx.hubs.hubsByDomain[sn.step];
      if (h && h.totalExported > 0) out.push(`- **[${sn.step}] ${sn.title}**（被调函数 \`${h.totalExported}\` 个）：${ckcFormatHubItems(h, `donegate zoom ${sn.step}`)}`);
    }
    return out;
  }
  const sccNote = (idx.graph.sccCycles || []).length > 0
    ? `；含互引强连通簇 ${idx.graph.sccCycles.map((c) => `[${c.join(' ⇄ ')}]`).join('、')}，簇内按被依赖净流出度由底座/后端门面先行合入 \`main\`，前端消费卡后跟`
    : '；严格单向无环 DAG（L0 纯叶底座先行，逐层向上合入 `main`）';
  const topoIdx = new Map(idx.graph.topoOrder.map((cid, i) => [cid, i]));
  const layered = [...idx.graph.topoOrder].sort((a, b) => ((layerMap.get(a) ?? 0) - (layerMap.get(b) ?? 0)) || (topoIdx.get(a) - topoIdx.get(b)));
  const out = ['', '## 2. 密封契约卡分层边界、容量水位与 CBM 承重接口', `推荐拓扑合入序（Tarjan DAG · L0→L${maxLayer}）：${layered.map((x) => `\`${x}\``).join(' → ')}（纯下游叶节点置末${sccNote}）`];
  for (const cid of layered) out.push(...ckcFormatContractBlock(cid, idx, layerMap));
  return out;
}

export function renderDoneGateBriefMarkdown(idx, cbm, layerMap = new Map()) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  const totalRaw = hasContracts ? idx.graph.nodes.reduce((a, n) => a + (n.stub?.sourceTokens || 0), 0) : idx.fallbackSourceTokens;
  const stepById = new Map(idx.domains.map((n) => [n.id, n.step]));
  const canvasSum = idx.domains.reduce((a, d) => a + (d.codeCapsule?.moduleCount || 0), 0);
  const cbmLine = cbm.available
    ? `> 开源图谱引擎：\`${cbm.engine}\` 持久化 SQLite 已就绪（节点 \`${cbm.totalNodes.toLocaleString()}\` 个 · 关系边 \`${cbm.totalEdges.toLocaleString()}\` 条 · 函数 \`${cbm.byLabel.Function || 0}\` 个 · 路由 \`${cbm.byLabel.Route || 0}\` 条）`
    : '> 开源图谱引擎：未检测到 `codebase-memory-mcp` 二进制（请安装后启用全仓符号图谱与 2-Hop 调用链，当前可直接用 `--source` 按行直读源码）';

  const maxLayer = layerMap.size > 0 ? Math.max(...layerMap.values()) : 0;
  const archHealthLine = ckcBuildArchHealthLine(idx, hasContracts, maxLayer);

  const z0 = [
    `# ${idx.atlas.project.name} · 主控全局根视口（Zoom-0 · 三级零漂移按需变焦页表）`,
    `> HEAD：\`${idx.gitHead}\` | 指纹：\`INTENT=${idx.intentHash}\` · \`CONSTRAINTS=${idx.constraintsHash}\``,
    `> 规模对账：源码模块 \`${idx.atlas.project.moduleCount}\` 个（画布含虚拟立约起点合计 \`${canvasSum}\` 项；声明式工作流 \`${idx.liveMeta.workflows.length}\` 个）| 去重函数名 \`${idx.hubs.uniqueSymbolCount}\` 个 | 架构决策 \`${idx.adrs.length}\` 篇 | 全仓源码约 \`${totalRaw.toLocaleString()} tok\``,
    ...(archHealthLine ? [archHealthLine] : []),
    cbmLine,
    '> **三步聚焦寻路字典（① MIT 开源图谱缩圈 → ② 契约/ADR 路径挂载 → ③ 末步按行直读源码；支持单条命令并列传多目标）**：',
    ...ckcBuildCommandDictLines(idx, hasContracts),
    '',
    '## 1. 业务域总览与隐藏信息索引（与「完结门」画布 1:1 同构）'
  ];
  for (const sn of idx.domains) z0.push(...ckcFormatDomainBlock(sn, stepById, idx, hasContracts));
  z0.push(...ckcBuildContractSectionLines(idx, hasContracts, layerMap, maxLayer));
  z0.push(...ckcBuildZoomZeroGovernanceSection(idx, hasContracts));
  return z0.join('\n') + '\n';
}

function ckrSplitNonEmptyLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
}

export function renderDoneGateRulesTopic(idx) {
  const hasContracts = (idx.graph.nodes || []).length > 0;
  const activeGlobs = hasContracts ? SHARED_GOVERNANCE_GLOBS : SHARED_GOVERNANCE_GLOBS.filter((g) => existsSync(join(idx.root, g.replace(/\/$/, ''))));
  const subpacks = Object.fromEntries(Object.entries(idx.liveMeta.annotatedSubpacks || {}).map(([k, files]) => [
    k, files.map((f) => `${f.file} ← ${f.contractOwner}`)
  ]));
  return JSON.stringify({
    mode: hasContracts ? 'contract-governed' : 'zero-contract-public',
    thresholds: idx.thresholds, sharedGovernanceGlobs: activeGlobs,
    annotatedSubpacks: subpacks, newAdapterArchetypes: idx.liveMeta.archetypes,
    newAdapterUsage: idx.liveMeta.newAdapterHeader,
    sharedPoolLayout: idx.liveMeta.sharedPoolLayout, declarativeWorkflows: idx.liveMeta.workflows,
    intent: ckrSplitNonEmptyLines(idx.intentText), constraints: ckrSplitNonEmptyLines(idx.constraintsText)
  }, null, 2);
}
