// DSH 原生 Quote 引用胶囊协议与零废话验真微卡编解码器（对齐 QuoteSummary 与完结门 INV-01，<= 200 行）
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
  const board = elem.board === 'flow' ? '开发流' : '项目看板';
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
  let m;
  while ((m = re.exec(clean)) !== null) {
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
        try { item.name = JSON.parse(v); } catch { item.name = v.replace(/^"|"$/g, ''); }
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
