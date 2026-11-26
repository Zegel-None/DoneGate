// DSH 原生 Quote 引用胶囊协议（含 uiOwner / sliceCmd 全链路直达路由）与零废话验真微卡编解码器
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { buildNodeInterfaceStub } from '../../core/contract.mjs';
import { normalizeLf, normalizeSlashes } from '../deps/index.mjs';

const KIND_LABELS = {
  node: '节点',
  card: '卡片',
  multi: '多选',
  group: '组合框',
  link: '连线',
  wire: '连线',
  text: '文本',
  control: '按钮',
  button: '按钮',
  ui: 'UI元素',
  workflow: '工作流',
  project: '项目',
  module: '模块'
};

function unquoteCapsuleVal(rawVal) {
  const trimmed = String(rawVal ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return String(JSON.parse(trimmed)); } catch (err) { void err; }
  }
  return trimmed.replace(/^"|"$/g, '');
}

function normalizeListField(rawList, normalizeItem = (x) => x) {
  const arr = Array.isArray(rawList)
    ? rawList
    : (typeof rawList === 'string' ? rawList.split(',') : []);
  return arr
    .map((item) => normalizeItem(String(item || '').trim()))
    .filter((item) => Boolean(item) && item !== '-')
    .slice(0, 4);
}

export function normalizeTargetKind(kind) {
  const k = String(kind || 'node').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, k) ? k : 'node';
}

export function normalizeUiOwner(rawUiOwner) {
  const clean = normalizeSlashes(String(rawUiOwner ?? '').trim())
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');
  if (!clean || clean === '-' || clean.includes('..') || /[\r\n|[\]]/.test(clean)) {
    return null;
  }
  return clean;
}

export function deriveSliceCmdFromUiOwner(rawUiOwner) {
  const uiOwner = normalizeUiOwner(rawUiOwner);
  if (!uiOwner) return null;
  if (uiOwner === 'runner/atlas' || uiOwner.startsWith('runner/atlas/')) {
    return `node runner/donegate.mjs slice atlas-workbench --focus ${uiOwner}`;
  }
  if (uiOwner.startsWith('runner/dsh/deps/')) {
    return `node runner/donegate.mjs slice shared-deps-pool --focus ${uiOwner}`;
  }
  if (uiOwner.startsWith('runner/dsh/uiboard/')) {
    return `node runner/donegate.mjs slice uiboard-studio --focus ${uiOwner}`;
  }
  if (uiOwner.startsWith('runner/dsh/autopilot/')) {
    return `node runner/donegate.mjs slice governance-autopilot --focus ${uiOwner}`;
  }
  if (uiOwner === 'runner/dsh' || uiOwner.startsWith('runner/dsh/')) {
    return `node runner/donegate.mjs slice dsh-host-plugin --focus ${uiOwner}`;
  }
  return null;
}

export function formatQuoteCapsule(elem = {}) {
  const kind = normalizeTargetKind(elem.kind);
  const id = String(elem.id || 'unknown').trim().replace(/[\r\n|[\]]/g, '_');
  const name = String(elem.name ?? elem.label ?? elem.title ?? id).trim().slice(0, 48);
  const board = elem.board === 'flow' ? 'flow' : 'kanban';
  const contracts = normalizeListField(elem.contracts ?? elem.contractIds);
  const scopes = normalizeListField(elem.scopes ?? elem.scopePaths, (p) => normalizeSlashes(p));
  const uiOwner = normalizeUiOwner(elem.uiOwner);
  const explicitSliceCmd = String(elem.sliceCmd ?? '').trim().replace(/[\r\n|[\]]/g, ' ');
  const sliceCmd = (explicitSliceCmd && explicitSliceCmd !== '-')
    ? explicitSliceCmd
    : deriveSliceCmdFromUiOwner(uiOwner);
  const extraMeta = String(elem.note ?? elem.extra ?? '').trim().slice(0, 80);
  const dgUri = String(elem.uri || `dg://${kind}/${id}`).trim();

  const metaParts = [
    `uri=${dgUri}`,
    `kind=${kind}`,
    `board=${board}`,
    `name=${JSON.stringify(name)}`
  ];
  if (contracts.length > 0) metaParts.push(`contracts=${contracts.join(',')}`);
  if (scopes.length > 0) metaParts.push(`scopes=${scopes.join(',')}`);
  if (uiOwner) metaParts.push(`uiOwner=${uiOwner}`);
  if (sliceCmd) metaParts.push(`sliceCmd=${JSON.stringify(sliceCmd)}`);
  if (extraMeta) metaParts.push(`note=${JSON.stringify(extraMeta)}`);

  return `[DG-TARGET ${metaParts.join(' | ')}]`;
}

const QP_CAPSULE_FIELD_HANDLERS = {
  uri: (item, val) => { item.uri = val; },
  kind: (item, val) => { item.kind = normalizeTargetKind(val); },
  id: (item, val, st) => {
    if (val) {
      item.id = val;
      st.hasExplicitId = true;
    }
  },
  board: (item, val) => { item.board = val === 'flow' ? 'flow' : 'kanban'; },
  name: (item, val) => {
    item.name = val;
    if (!item.label) item.label = val;
  },
  label: (item, val) => {
    item.label = val;
    if (!item.name) item.name = val;
  },
  contracts: (item, val) => { item.contracts = normalizeListField(val); },
  scopes: (item, val) => { item.scopes = normalizeListField(val, (p) => normalizeSlashes(p)); },
  uiOwner: (item, val) => { item.uiOwner = normalizeUiOwner(val); },
  sliceCmd: (item, val) => { item.sliceCmd = (val && val !== '-') ? val : null; },
  note: (item, val) => { item.note = val; }
};

function qpApplyCapsuleSegments(segs, item) {
  const st = { hasExplicitId: false };
  for (const seg of segs) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const k = seg.slice(0, eq).trim();
    const handler = Object.prototype.hasOwnProperty.call(QP_CAPSULE_FIELD_HANDLERS, k)
      ? QP_CAPSULE_FIELD_HANDLERS[k]
      : null;
    if (handler) handler(item, unquoteCapsuleVal(seg.slice(eq + 1).trim()), st);
  }
  return st.hasExplicitId;
}

function qpFinalizeCapsuleItem(item, hasExplicitId) {
  if (!item.uri && item.id) item.uri = `dg://${item.kind}/${item.id}`;
  if (!item.uri || !item.uri.startsWith('dg://')) return null;
  if (!hasExplicitId) {
    const parts = item.uri.slice(5).split('/');
    item.id = decodeURIComponent(parts.slice(1).join('/')) || item.id;
  }
  if (!item.sliceCmd && item.uiOwner) {
    item.sliceCmd = deriveSliceCmdFromUiOwner(item.uiOwner);
  }
  return item;
}

export function parseQuoteCapsule(rawCapsule) {
  const clean = normalizeLf(String(rawCapsule ?? ''));
  const m = clean.match(/\[DG-TARGET\s+([^\]]+)\]/);
  if (!m) return null;

  const segs = m[1].split('|').map((s) => s.trim());
  const item = {
    uri: null,
    kind: 'node',
    id: null,
    board: 'kanban',
    name: '',
    label: '',
    contracts: [],
    scopes: [],
    uiOwner: null,
    sliceCmd: null,
    note: ''
  };
  const hasExplicitId = qpApplyCapsuleSegments(segs, item);
  return qpFinalizeCapsuleItem(item, hasExplicitId);
}

export function buildElementQuotePayload(elem = {}) {
  const kind = normalizeTargetKind(elem.kind);
  const id = String(elem.id || 'unknown').trim().replace(/[\r\n|[\]]/g, '_');
  const name = String(elem.label || elem.title || elem.name || id).trim().slice(0, 48);
  const board = elem.board === 'flow' ? '工作流' : '项目看板';
  const packOrRepo = String(elem.contextName || board).trim().slice(0, 40);
  const scopes = normalizeListField(elem.scopePaths ?? elem.scopes, (p) => normalizeSlashes(p));
  const contracts = normalizeListField(elem.contractIds ?? elem.contracts);
  const uiOwner = normalizeUiOwner(elem.uiOwner);
  const sliceCmd = (elem.sliceCmd && String(elem.sliceCmd).trim() !== '-')
    ? String(elem.sliceCmd).trim()
    : deriveSliceCmdFromUiOwner(uiOwner);
  const dgUri = `dg://${kind}/${id}`;
  const hiddenModelText = formatQuoteCapsule({
    uri: dgUri,
    kind,
    id,
    board: elem.board === 'flow' ? 'flow' : 'kanban',
    name,
    contracts,
    scopes,
    uiOwner,
    sliceCmd,
    note: elem.extra ?? elem.note
  });

  const kindBadge = `[${KIND_LABELS[kind]}]`;
  const detailLines = [`坐标：${dgUri}`];
  if (contracts.length > 0) detailLines.push(`契约：${contracts.join('、')}`);
  if (scopes.length > 0) detailLines.push(`目录：${scopes.join(', ')}`);
  if (uiOwner) detailLines.push(`UI归属：${uiOwner}`);

  return {
    uri: dgUri,
    kind,
    id,
    uiOwner,
    sliceCmd,
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
  const re = /\[DG-TARGET\s+[^\]]+\]/g;
  for (const m of clean.matchAll(re)) {
    const item = parseQuoteCapsule(m[0]);
    if (item && item.uri && !seen.has(item.uri)) {
      seen.add(item.uri);
      targets.push(item);
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
