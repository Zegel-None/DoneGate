// L2 密封施工胶囊打包器（1M × 40% = 400k 五段预算 · donegate slice）与存根冻结基线原语
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { writeProjectRouter } from './context-router.mjs';

export function frozenStubPathOf(projectRoot, nodeId) {
  return join(projectRoot, '.donegate', 'stubs', `${nodeId}.frozen.json`);
}

export function freezeNodeStubBaseline(projectRoot, nodeId, stubInfo) {
  const p = frozenStubPathOf(projectRoot, nodeId);
  mkdirSync(dirname(p), { recursive: true });
  const payload = {
    nodeId,
    stubHash: stubInfo.stubHash,
    facadeMode: stubInfo.facadeMode,
    exportedSymbols: stubInfo.exportedSymbols,
    frozenAt: new Date().toISOString()
  };
  writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export function diffAgainstFrozenStub(projectRoot, nodeId, currentStub) {
  const p = frozenStubPathOf(projectRoot, nodeId);
  if (!existsSync(p)) return { hasFrozenBaseline: false, stubChanged: false, breakingChanges: [], addedExports: [] };
  const r = readJsonStrict(p);
  if (!r.ok || !r.value) return { hasFrozenBaseline: true, stubChanged: true, breakingChanges: ['冻结存根基线 JSON 损坏'], addedExports: [] };
  const prevMap = new Map((r.value.exportedSymbols || []).map((s) => [`${s.file}::${s.symbol}`, s.signature]));
  const currMap = new Map((currentStub.exportedSymbols || []).map((s) => [`${s.file}::${s.symbol}`, s.signature]));
  const breakingChanges = [], addedExports = [];
  for (const [key, prevSig] of prevMap.entries()) {
    if (!currMap.has(key)) breakingChanges.push(`移除已导出符号 ${key}（原签名：${prevSig}）`);
    else if (currMap.get(key) !== prevSig) breakingChanges.push(`篡改已冻结导出签名 ${key}：原为 \`${prevSig}\`，现为 \`${currMap.get(key)}\``);
  }
  for (const key of currMap.keys()) if (!prevMap.has(key)) addedExports.push(key);
  return { hasFrozenBaseline: true, previousHash: r.value.stubHash, stubChanged: r.value.stubHash !== currentStub.stubHash, breakingChanges, addedExports };
}

function resolveNeighborStubSnapshot(projectRoot, nb) {
  const frzPath = frozenStubPathOf(projectRoot, nb.id);
  if (existsSync(frzPath)) {
    const frz = readJsonStrict(frzPath);
    if (frz.ok && frz.value?.stubHash && frz.value.stubHash !== nb.stub.stubHash) {
      const facadeMode = frz.value.facadeMode || nb.stub.facadeMode;
      const lines = [`// @donegate-stub node=${nb.id} mode=${facadeMode} hash=${frz.value.stubHash}`];
      let lastFile = '';
      for (const s of frz.value.exportedSymbols || []) {
        if (s.file && s.file !== lastFile) { lines.push(`// [entry: ${s.file}]`); lastFile = s.file; }
        if (s.signature) lines.push(s.signature);
      }
      if (lines.length === 1) lines.push('// (no public code exports)');
      return { facadeMode, stubHash: frz.value.stubHash, stubText: `${lines.join('\n')}\n` };
    }
  }
  const dtsPath = join(projectRoot, '.donegate', 'stubs', `${nb.id}.stub.d.ts`);
  const stubText = existsSync(dtsPath) ? readFileSync(dtsPath, 'utf8') : nb.stub.stubText;
  return { facadeMode: nb.stub.facadeMode, stubHash: nb.stub.stubHash, stubText };
}

function collectMatchingNodeTests(projectRoot, target, repoTestFiles = []) {
  const matched = new Set(target.stub.relatedTestFiles || []);
  for (const o of target.obligations || []) {
    if (typeof o.command !== 'string') continue;
    for (const m of o.command.matchAll(/([A-Za-z0-9_./-]+\.(?:mjs|js|ts|py|go))/g)) {
      const cand = m[1].replace(/^\.\//, '');
      if (existsSync(join(projectRoot, cand)) && !target.stub.scopeFiles.includes(cand)) matched.add(cand);
    }
  }
  const scopePrefixes = (target.scope || []).map((s) => String(s || '').replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean);
  for (const tf of repoTestFiles) {
    let raw = '';
    try { raw = readFileSync(join(projectRoot, tf), 'utf8'); } catch (err) { void err; continue; }
    if (raw.includes(target.id) || scopePrefixes.some((sp) => sp && raw.includes(sp))) matched.add(tf);
  }
  return [...matched].sort();
}

export function cmdSlice(projectRoot, opts = {}) {
  const routerRes = writeProjectRouter(projectRoot, opts);
  if (!routerRes.ok) return { exitCode: 3, stderr: '契约读取错误，无法生成路由与局部胶囊' };
  const { graph, budget, payload: routerPayload, markdown: routerMd } = routerRes;

  if (opts.routerOnly || !opts.id) {
    if (graph.nodes.length === 0) return { exitCode: 3, stderr: '当前项目尚无活跃契约或画布组件节点，请先初始化契约后再执行 slice' };
    if (opts.out) {
      const outAbs = resolve(projectRoot, opts.out);
      mkdirSync(dirname(outAbs), { recursive: true });
      writeFileSync(outAbs, opts.json ? JSON.stringify(routerPayload, null, 2) : routerMd, 'utf8');
    }
    return { exitCode: 0, router: routerPayload, stdout: opts.json ? JSON.stringify(routerPayload, null, 2) : routerMd };
  }

  const target = graph.nodes.find((n) => n.id === opts.id);
  if (!target) return { exitCode: 3, stderr: `找不到目标节点「${opts.id}」（可选节点：${graph.nodes.map((n) => n.id).join(', ') || '无'}）` };

  if (opts.freezeStub || (target.isFrozenContract && !existsSync(frozenStubPathOf(projectRoot, target.id)))) {
    freezeNodeStubBaseline(projectRoot, target.id, target.stub);
  }

  const oneHopCharCap = budget.oneHopContractBudgetTokens * 4;
  let usedOneHopChars = 0;
  const neighborIds = [...new Set([...target.dependsOnIds, ...target.dependedByIds])].sort();
  const neighbors = [];
  for (const nid of neighborIds) {
    const nb = graph.nodes.find((x) => x.id === nid);
    if (!nb) continue;
    const relation = target.dependsOnIds.includes(nid) && target.dependedByIds.includes(nid)
      ? 'bidirectional'
      : (target.dependsOnIds.includes(nid) ? 'upstream-provider' : 'downstream-consumer');
    const sharedObs = (nb.obligations || [])
      .filter((o) => Array.isArray(o.spansContracts) && o.spansContracts.includes(target.id))
      .map((o) => `${o.id}: ${o.claim || ''}`);
    const snap = resolveNeighborStubSnapshot(projectRoot, nb);
    const stubSlice = usedOneHopChars + snap.stubText.length <= oneHopCharCap
      ? snap.stubText
      : snap.stubText.slice(0, Math.max(400, oneHopCharCap - usedOneHopChars));
    usedOneHopChars += stubSlice.length;
    neighbors.push({
      nodeId: nid, title: nb.title || nid, why: nb.why || '', relation, facadeMode: snap.facadeMode,
      stubHash: snap.stubHash, stubTokens: Math.ceil(stubSlice.length / 4), sharedBoundaryClaims: sharedObs, stubText: stubSlice
    });
  }

  const visibleSet = new Set([target.id, ...neighborIds]);
  const hiddenNodeIds = graph.nodes.filter((n) => !visibleSet.has(n.id)).map((n) => n.id).sort();

  const zeroHopCharCap = budget.zeroHopSourceBudgetTokens * 4;
  let usedZeroHopChars = 0;
  const zeroHopFiles = [], zeroHopTests = [], truncatedFiles = [];
  for (const rel of target.stub.scopeFiles) {
    let content = '';
    try { content = readFileSync(join(projectRoot, rel), 'utf8'); } catch (err) { void err; continue; }
    if (usedZeroHopChars + content.length <= zeroHopCharCap) {
      usedZeroHopChars += content.length;
      zeroHopFiles.push({ path: rel, kind: 'source', content });
    } else truncatedFiles.push(rel);
  }
  for (const tf of collectMatchingNodeTests(projectRoot, target, graph.testFiles || [])) {
    let content = '';
    try { content = readFileSync(join(projectRoot, tf), 'utf8'); } catch (err) { void err; continue; }
    if (usedZeroHopChars + content.length <= zeroHopCharCap) {
      usedZeroHopChars += content.length;
      zeroHopTests.push({ path: tf, kind: 'test', content });
    }
  }

  const utilPct = Math.round(budget.targetUtilization * 100);
  const microGateCommand = `node runner/donegate.mjs check-node ${target.id} --allow-dirty --receipt`;
  const md = [
    `# DoneGate 密封施工胶囊：${target.id}（${target.title}）`,
    '',
    '## 1. 静态路由规则与阅后即焚收口指令',
    `- **五段配额**：子代理总预算 **${budget.contextWindowTokens.toLocaleString()} × ${utilPct}% = ${budget.totalSessionBudgetTokens.toLocaleString()} Tokens**（L0 路由 ${budget.routerBudgetTokens.toLocaleString()}t | 0-Hop 上限 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t | 1-Hop 存根上限 ${budget.oneHopContractBudgetTokens.toLocaleString()}t | 按需展开预留 ${budget.onDemandExpandBudgetTokens.toLocaleString()}t | 多轮思考与微门禁迭代预留 ${budget.multiTurnReserveTokens.toLocaleString()}t）`,
    `- **门面与隔离约束**：只准修改本节点 \`scope\` 与关联单测；跨节点调用必须经由 1-Hop 门面存根（直连邻居 ${neighbors.length} 个节点），2-Hop+ 节点物理屏蔽（共屏蔽 ${hiddenNodeIds.length} 个节点）。`,
    `- **阅后即焚收口指令**：局部快检执行 \`${microGateCommand}\`；退出码为 0 后仅将结构化回执（上限 ${budget.receiptBudgetTokens} Tokens）交回总控，随即销毁当前子会话上下文。`,
    '',
    '## 2. 本卡契约声明（0-Hop Mandate）',
    `- **节点 ID**：\`${target.id}\``,
    `- **业务职责**：${target.why || target.title}`,
    `- **允许写入路径 (scope)**：${(target.scope || []).map((s) => `\`${s}\``).join(', ') || '（未声明）'}`,
    `- **门面模式**：\`${target.stub.facadeMode}\`（当前 \`stubHash=${target.stub.stubHash}\`）`,
    ...(target.obligations.length > 0
      ? ['- **本卡验收判据**：', ...target.obligations.map((o) => `  - \`${o.id}\` (${o.kind})：${o.claim || ''} → \`${o.command || o.expect?.standard || ''}\``)]
      : ['- **本卡验收判据**：（待补充）']),
    '',
    '## 3. 1-Hop 邻域冻结接口存根（只读契约签名 · 物理隐藏邻居内部实现）'
  ];
  if (neighbors.length === 0) md.push('（无 1-Hop 上下游直连节点，本卡为独立自治节点）');
  for (const nb of neighbors) {
    md.push(`### [${nb.relation}] \`${nb.nodeId}\` — ${nb.title}${nb.why ? `（${nb.why}）` : ''}（存根：\`.donegate/stubs/${nb.nodeId}.stub.d.ts\`）`);
    if (nb.sharedBoundaryClaims.length > 0) md.push(...nb.sharedBoundaryClaims.map((c) => `- 联调判据：${c}`));
    md.push('```ts', nb.stubText.trimEnd(), '```');
  }

  md.push(
    '',
    '## 4. 0-Hop 本卡全量源码（动态读写施工区）',
    `> 动态范围统计：0-Hop 源码 ${zeroHopFiles.length} 个文件（有效代码 ${target.stub.effectiveLines} 行） | 关联单测 ${zeroHopTests.length} 个文件`
  );
  for (const f of zeroHopFiles) md.push(`### \`${f.path}\``, '```js', f.content.trimEnd(), '```');

  md.push('', '## 5. 0-Hop 关联单测与验收夹具（动态断言区）');
  if (zeroHopTests.length === 0) md.push('（暂无关联单测或验收夹具）');
  for (const tf of zeroHopTests) md.push(`### \`${tf.path}\``, '```js', tf.content.trimEnd(), '```');
  if (truncatedFiles.length > 0) {
    md.push(
      '',
      `> ⚠ 预算溢出提示：当前节点超出了 ${budget.zeroHopSourceBudgetTokens.toLocaleString()}t 源码上限（剩余 ${truncatedFiles.length} 个文件仅附存根）。`,
      '### 未全量展开文件的 AST 存根',
      '```ts',
      target.stub.stubText.trimEnd(),
      '```'
    );
  }

  const capsuleMarkdown = md.join('\n') + '\n';
  const capsuleTokens = Math.ceil(capsuleMarkdown.length / 4);
  const capsulePayload = {
    schema: 'donegate-hermetic-capsule/v1',
    nodeId: target.id, title: target.title, scope: target.scope, facadeMode: target.stub.facadeMode,
    stubHash: target.stub.stubHash, effectiveLines: target.stub.effectiveLines, budgetProfile: budget,
    capsuleTokens, remainingSessionHeadroomTokens: Math.max(0, budget.totalSessionBudgetTokens - capsuleTokens),
    repoTotalSourceTokens: routerPayload.totalSourceTokens, omittedTwoHopNodes: hiddenNodeIds, oneHopStubs: neighbors,
    zeroHopFiles: zeroHopFiles.map((f) => ({ path: f.path, tokens: Math.ceil(f.content.length / 4) })),
    zeroHopTests: zeroHopTests.map((f) => ({ path: f.path, tokens: Math.ceil(f.content.length / 4) })),
    truncatedFiles, microGateCommand
  };

  const capDir = join(projectRoot, '.donegate', 'capsules');
  mkdirSync(capDir, { recursive: true });
  const defaultMdPath = join(capDir, `${target.id}.capsule.md`);
  writeFileSync(defaultMdPath, capsuleMarkdown, 'utf8');
  writeFileSync(join(capDir, `${target.id}.capsule.json`), JSON.stringify(capsulePayload, null, 2), 'utf8');
  if (opts.out) {
    const outAbs = resolve(projectRoot, opts.out);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, opts.json ? JSON.stringify(capsulePayload, null, 2) : capsuleMarkdown, 'utf8');
  }
  return { exitCode: 0, capsule: capsulePayload, capsulePath: defaultMdPath, stdout: opts.json ? JSON.stringify(capsulePayload, null, 2) : capsuleMarkdown };
}
