// DSH 原生 Quote 引用胶囊协议与零废话验真微卡编解码器（对齐 QuoteSummary 与完结门 INV-01，<= 200 行）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildNodeInterfaceStub } from '../core/contract.mjs';
import { normalizeLf, normalizeSlashes } from './win-paths.mjs';

const KIND_LABELS = {
  node: '节点',
  group: '组合框',
  link: '连线',
  text: '文本',
  control: '按钮',
  module: '模块'
};

export function normalizeTargetKind(kind) {
  const k = String(kind || 'node').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, k) ? k : 'node';
}

export function buildElementQuotePayload(elem = {}) {
  const kind = normalizeTargetKind(elem.kind);
  const id = String(elem.id || 'unknown').trim().replace(/[\r\n|]/g, '_');
  const name = String(elem.label || elem.title || id).trim().slice(0, 48);
  const board = elem.board === 'flow' ? '工作流' : '项目看板';
  const packOrRepo = String(elem.contextName || board).trim().slice(0, 40);
  const scopes = Array.isArray(elem.scopePaths)
    ? elem.scopePaths.map((p) => normalizeSlashes(p)).filter(Boolean).slice(0, 4)
    : [];
  const contracts = Array.isArray(elem.contractIds)
    ? elem.contractIds.map((c) => String(c).trim()).filter(Boolean).slice(0, 4)
    : [];
  const extraMeta = String(elem.extra || '').trim().slice(0, 80);

  const dgUri = `dg://${kind}/${id}`;
  const metaParts = [
    `uri=${dgUri}`,
    `kind=${kind}`,
    `board=${elem.board === 'flow' ? 'flow' : 'kanban'}`,
    `name=${JSON.stringify(name)}`
  ];
  if (contracts.length > 0) metaParts.push(`contracts=${contracts.join(',')}`);
  if (scopes.length > 0) metaParts.push(`scopes=${scopes.join(',')}`);
  if (extraMeta) metaParts.push(`note=${JSON.stringify(extraMeta)}`);

  const hiddenModelText = `[DG-TARGET ${metaParts.join(' | ')}]`;
  const kindBadge = `[${KIND_LABELS[kind]}]`;
  const detailLines = [`坐标：${dgUri}`];
  if (contracts.length > 0) detailLines.push(`契约：${contracts.join('、')}`);
  if (scopes.length > 0) detailLines.push(`目录：${scopes.join(', ')}`);

  return {
    uri: dgUri,
    kind,
    id,
    text: hiddenModelText,
    summary: {
      label: kindBadge,
      title: `完结门 · ${packOrRepo}`,
      detail: detailLines.join(' · '),
      body: name
    }
  };
}

export function parseQuotedTargetsFromMessage(rawMessage) {
  const clean = normalizeLf(rawMessage);
  const targets = [];
  const seen = new Set();
  const re = /\[DG-TARGET\s+([^\]]+)\]/g;
  for (const m of clean.matchAll(re)) {
    const segs = m[1].split('|').map((s) => s.trim());
    const item = { uri: null, kind: 'node', id: null, board: 'kanban', name: '', contracts: [], scopes: [] };
    for (const seg of segs) {
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (k === 'uri') item.uri = v;
      else if (k === 'kind') item.kind = normalizeTargetKind(v);
      else if (k === 'board') item.board = v === 'flow' ? 'flow' : 'kanban';
      else if (k === 'name') {
        try { item.name = JSON.parse(v); } catch (err) { void err; item.name = v.replace(/^"|"$/g, ''); }
      } else if (k === 'contracts') item.contracts = v.split(',').map((x) => x.trim()).filter(Boolean);
      else if (k === 'scopes') item.scopes = v.split(',').map((x) => x.trim()).filter(Boolean);
    }
    if (item.uri && item.uri.startsWith('dg://')) {
      const parts = item.uri.slice(5).split('/');
      item.id = parts.slice(1).join('/') || item.id;
      if (!seen.has(item.uri)) {
        seen.add(item.uri);
        targets.push(item);
      }
    }
  }
  return targets;
}

export function buildMicroVerdictCard(input = {}) {
  const exitCode = typeof input.exitCode === 'number' ? input.exitCode : 3;
  const rawSummary = String(input.headline || (exitCode === 0 ? '已完成修改并通过门禁' : '门禁拦截待处理')).trim();
  const headline = rawSummary.length > 22 ? `${rawSummary.slice(0, 21)}…` : rawSummary;
  const passedGates = Number(input.passedGates ?? (exitCode === 0 ? 1 : 0));
  const totalGates = Math.max(Number(input.totalGates ?? 1), passedGates, 1);
  const files = Array.isArray(input.touchedFiles)
    ? input.touchedFiles.map((f) => normalizeSlashes(f)).filter(Boolean)
    : [];
  const added = Math.max(0, Number(input.addedLines || 0));
  const removed = Math.max(0, Number(input.removedLines || 0));

  const tone = exitCode === 0 ? 'ok' : (exitCode === 1 ? 'bad' : 'warn');
  const gateBadge = exitCode === 0
    ? `门禁 ${passedGates}/${totalGates} 通过`
    : (exitCode === 1 ? `门禁拦截 (exit 1)` : `环境待备齐 (exit ${exitCode})`);
  const diffBadge = files.length > 0 ? `${files.length} 文件 (+${added}/-${removed})` : '无文件改动';

  return {
    ticketId: String(input.ticketId || `tkt-${Date.now()}`),
    targetUri: input.targetUri || null,
    tone,
    exitCode,
    headline,
    gateBadge,
    diffBadge,
    touchedFiles: files,
    canRollback: Boolean(input.canRollback && files.length > 0),
    createdAt: input.createdAt || new Date().toISOString()
  };
}

export function verifySubagentNodeReceipt(projectRoot, nodeId, claimedReceipt = null) {
  const root = resolve(projectRoot);
  const safeNodeId = String(nodeId || '').trim();
  if (!safeNodeId || !/^[a-zA-Z0-9._-]+$/.test(safeNodeId)) {
    return { ok: false, exitCode: 3, nodeId: safeNodeId, reason: '无效的节点标识，无法核验落盘回执' };
  }
  const receiptPath = join(root, '.donegate', 'capsules', `${safeNodeId}.receipt.json`);
  const res = readJsonStrict(receiptPath);
  if (!res.ok || !res.value || typeof res.value !== 'object') {
    return { ok: false, exitCode: 3, nodeId: safeNodeId, reason: `缺少盘上微门禁回执 .donegate/capsules/${safeNodeId}.receipt.json，拒绝采信口头完成声称` };
  }
  const disk = res.value;
  if (disk.nodeId !== safeNodeId || disk.exitCode !== 0 || disk.verdict !== 'PASS') {
    return { ok: false, exitCode: typeof disk.exitCode === 'number' && disk.exitCode !== 0 ? disk.exitCode : 1, nodeId: safeNodeId, reason: `盘上微门禁回执未通过（exitCode=${disk.exitCode}, verdict=${disk.verdict}）` };
  }
  if (typeof disk.stubHash !== 'string' || !/^[0-9a-f]{64}$/.test(disk.stubHash)) {
    return { ok: false, exitCode: 2, nodeId: safeNodeId, reason: '盘上微门禁回执缺少合法的 64 位 SHA-256 stubHash 指纹' };
  }
  const contractFile = join(root, 'contracts', safeNodeId, 'contract.json');
  if (existsSync(contractFile)) {
    const cRes = readJsonStrict(contractFile);
    if (!cRes.ok || !cRes.value) {
      return { ok: false, exitCode: 2, nodeId: safeNodeId, reason: '节点契约文件损坏，无法比对 64 位 stubHash' };
    }
    const liveStub = buildNodeInterfaceStub(root, cRes.value);
    if (disk.stubHash !== liveStub.stubHash) {
      return { ok: false, exitCode: 2, nodeId: safeNodeId, reason: `盘上回执 stubHash 与当前源码接口存根不一致（expected=${liveStub.stubHash}）` };
    }
  }
  if (claimedReceipt && typeof claimedReceipt === 'object') {
    if (claimedReceipt.exitCode !== 0 || claimedReceipt.stubHash !== disk.stubHash) {
      return { ok: false, exitCode: 2, nodeId: safeNodeId, reason: '子代理自报回执与盘上 .receipt.json 证据不一致' };
    }
  }
  return { ok: true, exitCode: 0, nodeId: safeNodeId, stubHash: disk.stubHash, receipt: disk };
}
