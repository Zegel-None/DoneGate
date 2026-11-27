// 驾驶舱零依赖 stdio MCP 服务（双帧缓冲传输 + JSON-RPC 2.0 生命周期，L5 donegate-cli）
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const posIntProp = (description) => ({ type: 'integer', minimum: 1, description });

export function buildMcpTools(toolPrefix = 'dg_', brandName = 'DoneGate') {
  const p = String(toolPrefix ?? '');
  const locateName = `${p}locate`;
  return [
    {
      name: `${p}brief`,
      description: `生成 ${brandName} Zoom-0 全局根视口（模块组、承重接口与图谱统计）。`,
      inputSchema: { type: 'object', properties: { budget: posIntProp('可选 token 预算上限（正整数）') }, additionalProperties: false }
    },
    {
      name: locateName,
      description: `按任务语义从 CBM 图谱排序定位相关文件与骨架摘要。定位代码时先用 ${locateName}，而不是 grep。`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '任务描述或关键词' },
          budget: posIntProp('可选 token 预算上限（正整数）'),
          k: posIntProp('可选返回候选数量上限（正整数）')
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: `${p}zoom`,
      description: '图谱下钻查看目录组、文件骨架、双向调用链或源码切片（若 source 与 skeleton 同为 true，source 优先）。',
      inputSchema: {
        type: 'object',
        properties: {
          targets: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: '组编号、文件[:起-止]或符号列表' },
          skeleton: { type: 'boolean', description: '仅输出文件骨架摘要' },
          source: { type: 'boolean', description: '直读源码切片（优先级高于 skeleton）' },
          budget: posIntProp('可选 token 预算上限（正整数）')
        },
        required: ['targets'],
        additionalProperties: false
      }
    },
    {
      name: `${p}impact`,
      description: '分析文件或符号改动的多跳影响面、调用方及关联测试命令。',
      inputSchema: {
        type: 'object',
        properties: {
          targets: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: '改动文件路径或锚点列表' },
          budget: posIntProp('可选 token 预算上限（正整数）')
        },
        required: ['targets'],
        additionalProperties: false
      }
    }
  ];
}

export const MCP_TOOLS = buildMcpTools('dg_', 'DoneGate');

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

export function encodeMcpMessage(msg, mode = 'ndjson') {
  const json = JSON.stringify(msg);
  if (mode === 'content-length') {
    const body = Buffer.from(json, 'utf8');
    return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
  }
  return Buffer.from(`${json}\n`, 'utf8');
}

function trimLeadingWs(buf) {
  let i = 0;
  while (i < buf.length && (buf[i] === 0x0d || buf[i] === 0x0a || buf[i] === 0x20 || buf[i] === 0x09)) i++;
  return i > 0 ? buf.subarray(i) : buf;
}

function findHeaderSeparator(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lflf = buf.indexOf('\n\n');
  if (crlf !== -1 && (lflf === -1 || crlf < lflf)) return { idx: crlf, sepLen: 4 };
  return lflf !== -1 ? { idx: lflf, sepLen: 2 } : null;
}

function parseHeaderFrame(buf, isEof) {
  const sep = findHeaderSeparator(buf);
  if (!sep) return isEof ? { status: 'error', mode: 'content-length', rest: Buffer.alloc(0) } : { status: 'need-more', rest: buf };
  const hdrText = buf.subarray(0, sep.idx).toString('ascii');
  const m = hdrText.match(/^content-length:\s*(\d+)\s*$/im);
  const bodyStart = sep.idx + sep.sepLen;
  const len = m ? Number(m[1]) : -1;
  if (!Number.isSafeInteger(len) || len < 0) return { status: 'error', mode: 'content-length', rest: buf.subarray(bodyStart) };
  if (buf.length < bodyStart + len) {
    return isEof ? { status: 'error', mode: 'content-length', rest: Buffer.alloc(0) } : { status: 'need-more', rest: buf };
  }
  return {
    status: 'frame',
    mode: 'content-length',
    rawText: buf.subarray(bodyStart, bodyStart + len).toString('utf8'),
    rest: buf.subarray(bodyStart + len)
  };
}

function consumeNdjsonFrame(buf, isEof, mode = 'ndjson') {
  const nl = buf.indexOf(0x0a);
  if (nl === -1) {
    return isEof ? { status: 'frame', mode, rawText: buf.toString('utf8'), rest: Buffer.alloc(0) } : { status: 'need-more', rest: buf };
  }
  const end = (nl > 0 && buf[nl - 1] === 0x0d) ? nl - 1 : nl;
  return { status: 'frame', mode, rawText: buf.subarray(0, end).toString('utf8'), rest: buf.subarray(nl + 1) };
}

function consumeNextFrame(rawBuf, isEof, fallbackMode) {
  const buf = trimLeadingWs(rawBuf);
  if (buf.length === 0) return { status: 'need-more', rest: buf };
  if (buf[0] === 0x7b || buf[0] === 0x5b) return consumeNdjsonFrame(buf, isEof, 'ndjson');

  const prefix = buf.subarray(0, Math.min(16, buf.length)).toString('ascii').toLowerCase();
  if (prefix.startsWith('content-length:') || prefix.startsWith('content-type:')) return parseHeaderFrame(buf, isEof);
  const nl = buf.indexOf(0x0a);
  if (nl === -1) {
    return isEof ? consumeNdjsonFrame(buf, true, fallbackMode) : { status: 'need-more', rest: buf };
  }
  return consumeNdjsonFrame(buf, isEof, fallbackMode);
}

function findUnknownArgKey(args, allowed) {
  return Object.keys(args).find((k) => !allowed.includes(k)) || null;
}

function validatePosInt(val, name) {
  if (val === undefined) return { ok: true, value: undefined };
  if (typeof val !== 'number') return { rpcError: `${name} must be an integer` };
  if (!Number.isInteger(val) || val < 1) return { toolError: `参数错误：${name} 必须为正整数。` };
  return { ok: true, value: val };
}

function buildLocateOrBriefArgv(baseCmd, rawName, args) {
  const allowed = baseCmd === 'brief' ? ['budget'] : ['query', 'budget', 'k'];
  const badKey = findUnknownArgKey(args, allowed);
  if (badKey) return { rpcError: `Unknown argument for ${rawName}: ${badKey}` };
  const bCheck = validatePosInt(args.budget, 'budget');
  if (!bCheck.ok) return bCheck;
  if (baseCmd === 'brief') return { ok: true, argv: ['brief', ...(bCheck.value ? ['--budget', String(bCheck.value)] : [])] };
  if (typeof args.query !== 'string') return { rpcError: 'query must be a string' };
  const kCheck = validatePosInt(args.k, 'k');
  if (!kCheck.ok) return kCheck;
  if (args.query.trim() === '') return { toolError: '参数错误：query 不能为空。' };
  const argv = ['locate'];
  if (bCheck.value) argv.push('--budget', String(bCheck.value));
  if (kCheck.value) argv.push('--k', String(kCheck.value));
  argv.push('--', args.query);
  return { ok: true, argv };
}

function validateZoomAndTargets(baseCmd, args) {
  if (!Array.isArray(args.targets) || args.targets.some((t) => typeof t !== 'string')) {
    return { rpcError: 'targets must be an array of strings' };
  }
  if (baseCmd === 'zoom') {
    if (args.skeleton !== undefined && typeof args.skeleton !== 'boolean') return { rpcError: 'skeleton must be boolean' };
    if (args.source !== undefined && typeof args.source !== 'boolean') return { rpcError: 'source must be boolean' };
  }
  if (args.targets.length === 0 || args.targets.some((t) => t.trim() === '')) {
    return { toolError: '参数错误：targets 不能为空数组或空白项。' };
  }
  return { ok: true };
}

function buildZoomOrImpactArgv(baseCmd, rawName, args) {
  const allowed = baseCmd === 'zoom' ? ['targets', 'skeleton', 'source', 'budget'] : ['targets', 'budget'];
  const badKey = findUnknownArgKey(args, allowed);
  if (badKey) return { rpcError: `Unknown argument for ${rawName}: ${badKey}` };
  const tCheck = validateZoomAndTargets(baseCmd, args);
  if (!tCheck.ok) return tCheck;
  const bCheck = validatePosInt(args.budget, 'budget');
  if (!bCheck.ok) return bCheck;
  const argv = [baseCmd];
  if (baseCmd === 'zoom') {
    if (args.source) argv.push('--source');
    else if (args.skeleton) argv.push('--skeleton');
  }
  if (bCheck.value) argv.push('--budget', String(bCheck.value));
  argv.push('--', ...args.targets);
  return { ok: true, argv };
}

function formatDispatchResult(res) {
  const firstErr = res.stderr ? res.stderr.split('\n')[0] : '';
  const appendErr = res.stderr && firstErr && !res.stdout?.includes(firstErr);
  const text = res.stdout ? (appendErr ? `${res.stdout}\n${res.stderr}` : res.stdout) : (res.stderr || '命令执行失败');
  return { content: [{ type: 'text', text }], ...(res.exitCode !== 0 ? { isError: true } : {}) };
}

function resolveBaseToolCmd(rawName, toolPrefix) {
  if (toolPrefix && !rawName.startsWith(toolPrefix)) return null;
  const stripped = toolPrefix ? rawName.slice(toolPrefix.length) : rawName;
  return ['brief', 'locate', 'zoom', 'impact'].includes(stripped) ? stripped : null;
}

function handleToolCall(params, root, dispatchCommand, cfg) {
  if (!isPlainObject(params) || typeof params.name !== 'string') return { rpcError: 'Invalid tools/call params' };
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isPlainObject(args)) return { rpcError: 'arguments must be an object' };
  const { name } = params;
  const baseCmd = resolveBaseToolCmd(name, cfg.toolPrefix);
  let built = null;
  if (baseCmd === 'brief' || baseCmd === 'locate') built = buildLocateOrBriefArgv(baseCmd, name, args);
  else if (baseCmd === 'zoom' || baseCmd === 'impact') built = buildZoomOrImpactArgv(baseCmd, name, args);
  else if (typeof cfg.buildExtraArgv === 'function') built = cfg.buildExtraArgv(name, args);
  if (!built) built = { rpcError: `Unknown tool: ${name}` };
  if (built.rpcError) return { rpcError: built.rpcError };
  if (built.toolError) return { result: { isError: true, content: [{ type: 'text', text: built.toolError }] } };
  try {
    return { result: formatDispatchResult(dispatchCommand(built.argv, root)) };
  } catch (err) {
    return { result: { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] } };
  }
}

function buildInitializeResult(params, serverName) {
  const reqVer = isPlainObject(params) ? params.protocolVersion : undefined;
  const protocolVersion = SUPPORTED_VERSIONS.includes(reqVer) ? reqVer : '2024-11-05';
  return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: serverName, version: '1.0.0' } };
}

function dispatchRpcMessage(msg, resolvedRoot, dispatchCommand, cfg) {
  if (!isPlainObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || msg.method === '') {
    return jsonRpcError(isPlainObject(msg) && Object.hasOwn(msg, 'id') ? msg.id : null, -32600, 'Invalid Request');
  }
  if (!Object.hasOwn(msg, 'id') || msg.id === undefined) return null;
  const { id, method, params } = msg;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: buildInitializeResult(params, cfg.serverName) };
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: cfg.tools } };
  if (method === 'tools/call') {
    const out = handleToolCall(params, resolvedRoot, dispatchCommand, cfg);
    return out.rpcError ? jsonRpcError(id, -32602, out.rpcError) : { jsonrpc: '2.0', id, result: out.result };
  }
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

export function createMcpDispatcher({
  root = process.cwd(),
  dispatchCommand,
  serverName = 'donegate-cockpit',
  toolPrefix = 'dg_',
  brandName = 'DoneGate',
  extraTools = [],
  buildExtraArgv = null
} = {}) {
  if (typeof dispatchCommand !== 'function') throw new TypeError('startCockpitMcp requires dispatchCommand function');
  const resolvedRoot = resolve(root);
  const baseTools = toolPrefix === 'dg_' && brandName === 'DoneGate' ? MCP_TOOLS : buildMcpTools(toolPrefix, brandName);
  const tools = Array.isArray(extraTools) && extraTools.length > 0 ? [...baseTools, ...extraTools] : baseTools;
  const cfg = { serverName, toolPrefix, tools, buildExtraArgv };
  return (msg) => dispatchRpcMessage(msg, resolvedRoot, dispatchCommand, cfg);
}

function writeMcpReply(state, payload, mode) {
  if (state.pipeClosed || state.stdout.destroyed || !state.stdout.writable) return;
  try {
    state.stdout.write(encodeMcpMessage(payload, mode));
  } catch (err) {
    if (err?.code === 'EPIPE') state.pipeClosed = true;
    else state.stderr?.write?.(`mcp write error: ${err?.message || String(err)}\n`);
  }
}

function drainMcpBuffer(state, isEof) {
  while (state.rxBuf.length > 0) {
    const step = consumeNextFrame(state.rxBuf, isEof, state.replyMode);
    state.rxBuf = step.rest;
    if (step.status === 'need-more') break;
    state.replyMode = step.mode;
    if (step.status === 'error') {
      writeMcpReply(state, jsonRpcError(null, -32700, 'Parse error'), step.mode);
      continue;
    }
    try {
      const reply = state.dispatchRpc(JSON.parse(step.rawText));
      if (reply !== null) writeMcpReply(state, reply, step.mode);
    } catch (err) {
      void err;
      writeMcpReply(state, jsonRpcError(null, -32700, 'Parse error'), step.mode);
    }
  }
}

export function startCockpitMcp({
  root = process.cwd(),
  dispatchCommand,
  serverName = 'donegate-cockpit',
  toolPrefix = 'dg_',
  brandName = 'DoneGate',
  extraTools = [],
  buildExtraArgv = null,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  const dispatchRpc = createMcpDispatcher({ root, dispatchCommand, serverName, toolPrefix, brandName, extraTools, buildExtraArgv });
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) throw new Error(`项目根目录不存在：${resolvedRoot}`);
  const state = { rxBuf: Buffer.alloc(0), replyMode: 'ndjson', pipeClosed: false, stdout, stderr, dispatchRpc };
  const onStdoutErr = (err) => {
    if (err?.code === 'EPIPE') state.pipeClosed = true;
    else stderr?.write?.(`mcp stdout error: ${err?.message || String(err)}\n`);
  };
  return new Promise((resolvePromise) => {
    stdout.on('error', onStdoutErr);
    stdin.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      state.rxBuf = state.rxBuf.length > 0 ? Buffer.concat([state.rxBuf, buf]) : buf;
      drainMcpBuffer(state, false);
    });
    stdin.on('end', () => {
      drainMcpBuffer(state, true);
      stdout.off('error', onStdoutErr);
      resolvePromise(0);
    });
    stdin.resume?.();
  });
}
