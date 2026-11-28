// 密封施工胶囊 Markdown/TOC 渲染、单页按钮动作与全局属性挂钩自动闭包存根展示、静态前缀校验与动态尾部追加（供 hermetic-capsule.mjs 委托，<= 350 行）
import { extname } from 'node:path';
import { formatShardAdviceLines } from './capsule-shard-advisor.mjs';

const SHELL_ROUTE_META_RE = /[()[\]\s]/;
const hcapFmtInt = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hcapNormStr = (x) => (Array.isArray(x) ? x.join('\n') : String(x ?? ''));
const hcapQuoteShellPath = (p) => `'${String(p || '').replace(/'/g, "'\\''")}'`;

export function verifyCapsulePrefixContinuation(prevPrefixText, nextPrefixText) {
  const prev = hcapNormStr(prevPrefixText), next = hcapNormStr(nextPrefixText);
  const isContinuation = prev.length > 0 ? next.startsWith(prev) : next.length === 0;
  const prefixBytes = Buffer.byteLength(prev, 'utf8');
  if (isContinuation) return { ok: true, isContinuation: true, exactMatch: prev === next, prefixBytes, firstDiffOffset: -1, firstDiffLine: null };
  const minLen = Math.min(prev.length, next.length);
  let diffIdx = minLen;
  for (let i = 0; i < minLen; i++) {
    if (prev.charCodeAt(i) !== next.charCodeAt(i)) { diffIdx = i; break; }
  }
  return { ok: false, isContinuation: false, exactMatch: false, prefixBytes, firstDiffOffset: diffIdx, firstDiffLine: prev.slice(0, diffIdx).split('\n').length };
}

function hcapFormatSubdirConstraintLine(entry) {
  if (typeof entry === 'string') return entry.trim() ? `- ${entry.trim()}` : '';
  if (!entry || typeof entry !== 'object') return '';
  const dir = String(entry.dir || entry.path || '').trim(), text = String(entry.constraint || entry.rules || entry.content || '').trim();
  if (!text) return '';
  return dir ? `- \`${dir}\`：${text}` : `- ${text}`;
}

export function buildCapsuleDynamicTailLines(opts = {}) {
  const rawPaths = [...(opts.scopePaths || []), ...(opts.focusPaths || []), ...(opts.zeroHopPaths || [])];
  const specialPaths = [...new Set(rawPaths.map((p) => String(p || '').trim().replace(/\\/g, '/')).filter((p) => p && SHELL_ROUTE_META_RE.test(p)))].sort();
  const constraintLines = (Array.isArray(opts.subdirConstraints) ? opts.subdirConstraints : []).map(hcapFormatSubdirConstraintLine).filter(Boolean);
  if (specialPaths.length === 0 && constraintLines.length === 0) return [];
  const tail = ['', '## 胶囊动态尾部附注（路径防拆词与子目录局部约束）'];
  if (specialPaths.length > 0) {
    tail.push(`- **Shell 路由元字符单引号防拆词提示**：检测到路径含括号、方括号或空格，终端执行命令时必须使用单引号包裹完整路径（如 ${specialPaths.map((p) => `\`${hcapQuoteShellPath(p)}\``).join(', ')}），严禁裸传导致 Shell 通配或子进程拆词报错。`);
  }
  if (constraintLines.length > 0) tail.push('- **命中子目录局部约束（Append-Only 动态挂载）**：', ...constraintLines.map((ln) => `  ${ln}`));
  return tail;
}

export function appendCapsuleDynamicTail(capsuleText, tailOpts = {}) {
  const base = hcapNormStr(capsuleText), tailLines = buildCapsuleDynamicTailLines(tailOpts);
  if (tailLines.length === 0) return base;
  return `${base.endsWith('\n') ? base.slice(0, -1) : base}\n${tailLines.join('\n')}\n`;
}

function hcapFenceLang(filePath) {
  const ext = extname(String(filePath || '')).toLowerCase();
  return ({ '.py': 'python', '.go': 'go', '.rs': 'rust', '.ts': 'ts', '.tsx': 'ts' })[ext] || 'js';
}

function renderSiblingStubLines(siblingStubs, maxEff) {
  const out = [];
  for (const sb of siblingStubs) {
    out.push(`// [sibling: ${sb.path}] effectiveLines=${sb.effectiveLines}/${maxEff} physicalLines=${sb.physicalLines} maxProceduralFnLines=${sb.maxProceduralFnLines} headroom=${sb.headroom}`);
    if (sb.wiringComment) out.push(sb.wiringComment);
    if (sb.exports.length === 0) {
      out.push('// (内部实现或脚本入口，无具名导出)');
      continue;
    }
    for (const ex of sb.exports) {
      if (ex.doc) out.push(...ex.doc.split(/\r?\n/));
      out.push(ex.signature);
    }
  }
  return out;
}

function hcapBuildDynamicBlocks(assets, target, budget) {
  const { maxEff, zeroHopFiles, siblingStubs, zeroHopTests, truncatedFiles, shardAdvice } = assets;
  const blocks = [];
  for (const f of zeroHopFiles) {
    blocks.push({
      category: '0-Hop 源码', path: f.path, effText: `${f.effectiveLines} / ${maxEff}`,
      physText: `${f.physicalLines}`, procText: `${f.maxProceduralFnLines}`, headroomText: `${f.headroom} 行`,
      effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines,
      modeText: f.role, lines: [`### \`${f.path}\``, '```' + hcapFenceLang(f.path), ...f.content.trimEnd().split(/\r?\n/), '```']
    });
  }
  if (siblingStubs.length > 0) {
    blocks.push({
      category: '0-Hop 正交存根', path: `同卡零直连正交兄弟 (${siblingStubs.length} 个)`,
      effText: '见存根头', physText: '见存根头', procText: '见存根头', headroomText: '见存根头',
      effectiveLines: null, physicalLines: null, maxProceduralFnLines: null, modeText: 'AST 存根',
      lines: ['### 0-Hop 同卡正交兄弟文件 AST 存根与行数余量（与目标文件无直接调用耦合）', '```ts', ...renderSiblingStubLines(siblingStubs, maxEff), '```']
    });
  }
  blocks.push({ isDivider: true, lines: ['', '## 5. 0-Hop 关联单测与验收夹具（动态断言区）', ...(zeroHopTests.length === 0 ? ['（暂无关联单测或验收夹具）'] : [])] });
  for (const tf of zeroHopTests) {
    blocks.push({
      category: '0-Hop 单测', path: tf.path, effText: `${tf.effectiveLines} / ${maxEff}`,
      physText: `${tf.physicalLines}`, procText: `${tf.maxProceduralFnLines}`, headroomText: `${tf.headroom} 行`,
      effectiveLines: tf.effectiveLines, physicalLines: tf.physicalLines, maxProceduralFnLines: tf.maxProceduralFnLines,
      modeText: '全量展开', lines: [`### \`${tf.path}\``, '```' + hcapFenceLang(tf.path), ...tf.content.trimEnd().split(/\r?\n/), '```']
    });
  }
  if (truncatedFiles.length > 0) {
    blocks.push({
      isDivider: true,
      lines: ['', `> ⚠ 预算溢出提示：当前节点超出了 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t 源码上限（剩余 ${truncatedFiles.length} 个文件仅附存根）。`, '### 未全量展开文件的 AST 存根', '```ts', ...target.stub.stubText.trimEnd().split(/\r?\n/), '```']
    });
  }
  if (shardAdvice) blocks.push({ isDivider: true, lines: formatShardAdviceLines(shardAdvice) });
  return blocks;
}

export function assembleDynamicBodyWithToc(staticPrefixLines, assets, target, budget, tailOpts = {}) {
  const { zeroHopFiles, siblingStubs, zeroHopTests } = assets;
  const blocks = hcapBuildDynamicBlocks(assets, target, budget);
  const siblingNote = siblingStubs.length > 0 ? `（含目标与同卡调用闭包）+ 正交兄弟存根 ${siblingStubs.length} 个` : '';
  const tocHeader = [
    '', '## 4. 0-Hop 本卡全量源码（动态读写施工区）',
    `> 动态范围统计：0-Hop 展开源码 ${zeroHopFiles.length} 个${siblingNote}（全卡有效代码 ${target.stub.effectiveLines} 行 / 非空物理行 ${target.stub.physicalLines} 行） | 关联单测 ${zeroHopTests.length} 个`,
    '', '### 0-Hop 胶囊精确行号导航目录与单文件行数余量（TOC）',
    '| 类别 | 路径 | 胶囊行号范围 | 有效代码 / 硬顶 | 非空物理行 | 最大过程函数行 | 剩余行数余量 | 形态 |',
    '|---|---|---|---|---|---|---|---|'
  ];
  let cursor = staticPrefixLines.length + tocHeader.length + Math.max(1, blocks.filter((b) => !b.isDivider).length) + 2;
  const tocEntries = [], tocRows = [], bodyLines = [''];
  for (const b of blocks) {
    if (b.isDivider) {
      bodyLines.push(...b.lines);
      cursor += b.lines.length;
      continue;
    }
    const startLine = cursor, endLine = cursor + b.lines.length - 1;
    cursor += b.lines.length;
    bodyLines.push(...b.lines);
    tocEntries.push({ category: b.category, path: b.path, startLine, endLine, effectiveLines: b.effectiveLines, physicalLines: b.physicalLines, maxProceduralFnLines: b.maxProceduralFnLines, mode: b.modeText });
    tocRows.push(`| ${b.category} | \`${b.path}\` | \`L${startLine}-L${endLine}\` | \`${b.effText}\` | \`${b.physText}\` | \`${b.procText}\` | \`${b.headroomText}\` | ${b.modeText} |`);
  }
  if (tocRows.length === 0) tocRows.push('| — | （无 0-Hop 文件） | — | — | — | — | — | — |');
  const tailLines = buildCapsuleDynamicTailLines({ scopePaths: target?.scope, focusPaths: tailOpts.focusPaths || assets?.focusPatterns, zeroHopPaths: zeroHopFiles.map((f) => f.path), subdirConstraints: tailOpts.subdirConstraints || assets?.subdirConstraints || target?.subdirConstraints });
  return { fullLines: [...staticPrefixLines, ...tocHeader, ...tocRows, ...bodyLines, ...tailLines], tocEntries };
}

function hcapFormatTargetObligations(obligations) {
  if (obligations.length === 0) return ['- **本卡验收判据**：（待补充）'];
  return [
    '- **本卡验收判据**：',
    ...obligations.map((o) => `  - \`${o.id}\` (${o.kind})：${o.claim || ''} → \`${o.command || o.expect?.standard || ''}\``)
  ];
}

function hcapAppendNeighborBlocks(rawPrefix, neighbors) {
  if (neighbors.length === 0) { rawPrefix.push('（无 1-Hop 上下游直连节点，本卡为独立自治节点）'); return; }
  for (const nb of neighbors) {
    rawPrefix.push(`### [${nb.relation}] \`${nb.nodeId}\` — ${nb.title}${nb.why ? `（${nb.why}）` : ''}（存根：\`.donegate/stubs/${nb.nodeId}.stub.d.ts\`）`);
    if (nb.sharedBoundaryClaims.length > 0) rawPrefix.push(...nb.sharedBoundaryClaims.map((c) => `- 联调判据：${c}`));
    rawPrefix.push('```ts', nb.stubText.trimEnd(), '```');
  }
}

export function hcapBuildStaticPrefixLines(target, budget, neighbors, hiddenNodeIds, warnings, microGateCommand) {
  const utilPct = Math.round(budget.targetUtilization * 100);
  const files = target.stub.facadeFiles;
  const hasTwoTierBarrel = target.stub.facadeMode === 'barrel' && files.some((f) => f.endsWith('/contract.mjs')) && files.some((f) => f.endsWith('/index.mjs'));
  const barrelNote = hasTwoTierBarrel ? '（双层桶防环：`contract.mjs` 仅放零跨卡环路纯叶导出，跨卡编排导出放 `index.mjs`）' : '';
  const warnBanner = warnings.length > 0 ? ['> ⚠️ 跨卡焦点路由提示', ...warnings.map((w) => `> - ${w}`), ''] : [];
  const obLines = hcapFormatTargetObligations(target.obligations);
  const rawPrefix = [
    `# DoneGate 密封施工胶囊：${target.id}（${target.title}）`, '', ...warnBanner,
    '## 1. 静态路由规则与阅后即焚收口指令',
    `- **五段配额**：子代理总预算 **${hcapFmtInt(budget.contextWindowTokens)} × ${utilPct}% = ${hcapFmtInt(budget.totalSessionBudgetTokens)} Tokens**（L0 路由 ${hcapFmtInt(budget.routerBudgetTokens)}t | 0-Hop 上限 ${hcapFmtInt(budget.zeroHopSourceBudgetTokens)}t | 1-Hop 存根上限 ${hcapFmtInt(budget.oneHopContractBudgetTokens)}t | 按需展开预留 ${hcapFmtInt(budget.onDemandExpandBudgetTokens)}t | 多轮思考与微门禁迭代预留 ${hcapFmtInt(budget.multiTurnReserveTokens)}t）`,
    `- **门面与隔离约束**：只准修改本节点 \`scope\`（含显式文件同名伴生子模块目录）与关联单测；跨节点调用必须经由 1-Hop 门面存根（直连邻居 ${neighbors.length} 个节点），2-Hop+ 节点物理屏蔽（共屏蔽 ${hiddenNodeIds.length} 个节点）。`,
    `- **自举免转义编辑与总览同步**：局部改码优先调 \`node runner/donegate.mjs patch-edit --spec <json|->\`（支持单文件或 \`{patches:[...]}\` 多文件原子替换并自动跑 \`lint-edit\`）；改动公共导出或 CLI 帮助后跑 \`node skill/gen-feature-overview.mjs\`。`,
    `- **阅后即焚收口指令**：局部快检执行 \`${microGateCommand}\`；退出码为 0 后仅将结构化回执（上限 ${budget.receiptBudgetTokens} Tokens）交回总控，随即销毁当前子会话上下文。`, '',
    '## 2. 本卡契约声明（0-Hop Mandate）',
    `- **节点 ID**：\`${target.id}\``,
    `- **业务职责**：${target.why || target.title}`,
    `- **允许写入路径 (scope)**：${(target.scope || []).map((s) => `\`${s}\``).join(', ') || '（未声明）'}`,
    `- **门面模式**：\`${target.stub.facadeMode}\`（当前 \`stubHash=${target.stub.stubHash}\`）${barrelNote}`,
    ...obLines, '',
    '## 3. 1-Hop 邻域冻结接口存根（只读契约签名 · 物理隐藏邻居内部实现）'
  ];
  hcapAppendNeighborBlocks(rawPrefix, neighbors);
  return rawPrefix.join('\n').split(/\r?\n/);
}

export function hcapBuildCapsulePayload(ctx) {
  const { target, budget, routerPayload, hiddenNodeIds, neighbors, assets, tocEntries, focusPatterns, lexicalTerms, warnings, crossCardRoutes, microGateCommand, capsuleMarkdown, previousStaticPrefix } = ctx;
  const capsuleBytes = Buffer.byteLength(capsuleMarkdown, 'utf8');
  const capsuleTokens = Math.ceil(capsuleMarkdown.length / 4);
  const prefixContinuation = previousStaticPrefix ? verifyCapsulePrefixContinuation(previousStaticPrefix, capsuleMarkdown) : undefined;
  return {
    schema: 'donegate-hermetic-capsule/v1', nodeId: target.id, title: target.title, scope: target.scope,
    facadeMode: target.stub.facadeMode, stubHash: target.stub.stubHash,
    effectiveLines: target.stub.effectiveLines, physicalLines: target.stub.physicalLines,
    maxProceduralFnLines: assets.cardMaxProcFn, budgetProfile: budget,
    focusMode: assets.focusMode, focusPatterns, lexicalMode: assets.lexicalMode, lexicalTerms,
    lexicalMatches: assets.lexicalMatches, warnings, crossCardFocus: crossCardRoutes,
    capsuleBytes, capsuleTokens,
    remainingSessionHeadroomTokens: Math.max(0, budget.totalSessionBudgetTokens - capsuleTokens),
    repoTotalSourceTokens: routerPayload.totalSourceTokens, omittedTwoHopNodes: hiddenNodeIds,
    oneHopStubs: neighbors, toc: tocEntries, truncatedFiles: assets.truncatedFiles,
    shardAdvice: assets.shardAdvice || null, microGateCommand,
    ...(prefixContinuation ? { prefixContinuation } : {}),
    zeroHopFiles: assets.zeroHopFiles.map((f) => ({ path: f.path, role: f.role, tokens: Math.ceil(f.content.length / 4), effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines, headroom: f.headroom })),
    siblingStubFiles: assets.siblingStubs.map((s) => ({ path: s.path, effectiveLines: s.effectiveLines, physicalLines: s.physicalLines, maxProceduralFnLines: s.maxProceduralFnLines, headroom: s.headroom, exportCount: s.exports.length })),
    zeroHopTests: assets.zeroHopTests.map((f) => ({ path: f.path, tokens: Math.ceil(f.content.length / 4), effectiveLines: f.effectiveLines, physicalLines: f.physicalLines, maxProceduralFnLines: f.maxProceduralFnLines }))
  };
}
