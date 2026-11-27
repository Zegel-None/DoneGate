// Stage 22 · 驾驶舱零依赖 stdio MCP 服务 (donegate mcp) 子进程与协议单测
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeMcpMessage, startCockpitMcp } from '../runner/cockpit/cockpit-mcp.mjs';
import { resolveCbmBinary } from '../runner/core/index.mjs';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CLI_PATH = join(REPO_ROOT, 'runner', 'donegate.mjs');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 80 }); } catch (err) { void err; }
  }
});

function spawnMcpProc(root = REPO_ROOT) {
  const child = spawn(process.execPath, [CLI_PATH, 'mcp', '--root', root], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let rawOut = Buffer.alloc(0);
  let rawErr = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    rawOut = Buffer.concat([rawOut, chunk]);
    while (waiters.length > 0) waiters.shift()();
  });
  child.stderr.on('data', (chunk) => { rawErr += chunk.toString('utf8'); });
  const exitPromise = new Promise((res) => child.once('exit', (code) => res(code)));

  function pullNdjsonLine() {
    const nl = rawOut.indexOf(0x0a);
    if (nl === -1) return null;
    const line = rawOut.subarray(0, nl).toString('utf8').trim();
    rawOut = rawOut.subarray(nl + 1);
    return line ? JSON.parse(line) : pullNdjsonLine();
  }

  function pullContentLengthFrame() {
    const crlf = rawOut.indexOf('\r\n\r\n');
    if (crlf === -1) return null;
    const hdr = rawOut.subarray(0, crlf).toString('ascii');
    const m = hdr.match(/^Content-Length:\s*(\d+)$/im);
    if (!m) throw new Error(`Invalid Content-Length header: ${hdr}`);
    const byteLen = Number(m[1]);
    const bodyStart = crlf + 4;
    if (rawOut.length < bodyStart + byteLen) return null;
    const bodyBuf = rawOut.subarray(bodyStart, bodyStart + byteLen);
    rawOut = rawOut.subarray(bodyStart + byteLen);
    const bodyText = bodyBuf.toString('utf8');
    return { byteLen, bodyText, msg: JSON.parse(bodyText) };
  }

  async function nextMessage(mode = 'ndjson', timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const hit = mode === 'content-length' ? pullContentLengthFrame() : pullNdjsonLine();
      if (hit !== null) return hit;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`MCP response timeout (${mode}). stderr=${rawErr}`);
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`MCP wait timeout. stderr=${rawErr}`)), left);
        waiters.push(() => { clearTimeout(timer); res(); });
      });
    }
  }

  return {
    child,
    nextMessage,
    getStderr: () => rawErr,
    getRemainingBytes: () => rawOut.length,
    closeAndWait: () => {
      child.stdin.end();
      return exitPromise;
    }
  };
}

describe('Stage 22 · 驾驶舱零依赖 stdio MCP 服务 (donegate mcp)', () => {
  it('① DI 约束与同步 CLI 入口行为正确（mcp 帮助与非驻留防呆）', () => {
    expect(() => startCockpitMcp({ root: REPO_ROOT })).toThrow(TypeError);

    const syncMcp = dispatchCommand(['mcp'], REPO_ROOT);
    expect(syncMcp.exitCode).toBe(3);
    expect(syncMcp.stderr).toContain('mcp');

    const helpMcp = dispatchCommand(['mcp', '--help'], REPO_ROOT);
    expect(helpMcp.exitCode).toBe(0);
    expect(helpMcp.stdout).toContain('十二条命令');
    expect(helpMcp.stdout).toContain('mcp');

    const badRoot = spawnSync(process.execPath, [CLI_PATH, 'mcp', '--root', join(REPO_ROOT, 'missing-mcp-root')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(badRoot.status).toBe(3);
    expect(badRoot.stderr).toContain('不存在');
  });

  it('② NDJSON 子进程完整生命周期：initialize / notification 静默 / tools/list / tools/call / 错误码 / EOF 退 0', async () => {
    const mcp = spawnMcpProc(REPO_ROOT);
    const send = (obj) => mcp.child.stdin.write(`${JSON.stringify(obj)}\n`);

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test' } } });
    const initRes = await mcp.nextMessage('ndjson');
    expect(initRes.id).toBe(1);
    expect(initRes.result.protocolVersion).toBe('2025-03-26');
    expect(initRes.result.capabilities).toEqual({ tools: {} });
    expect(initRes.result.serverInfo.name).toBe('donegate-cockpit');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    const pingRes = await mcp.nextMessage('ndjson');
    expect(pingRes.id).toBe(2);
    expect(pingRes.result).toEqual({});

    send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const listRes = await mcp.nextMessage('ndjson');
    const names = listRes.result.tools.map((t) => t.name);
    expect(names).toEqual([
      'dg_brief', 'dg_locate', 'dg_zoom', 'dg_impact',
      'dg_status', 'dg_slice', 'dg_lint_edit', 'dg_check_node'
    ]);
    const locateTool = listRes.result.tools.find((t) => t.name === 'dg_locate');
    expect(locateTool.description).toContain('定位代码时先用 dg_locate，而不是 grep');

    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dg_brief', arguments: { budget: 1200 } } });
    const briefRes = await mcp.nextMessage('ndjson');
    expect(briefRes.result.isError).toBeUndefined();
    expect(briefRes.result.content[0].text).toContain('主控全局根视口');

    const hasCbm = Boolean(resolveCbmBinary(REPO_ROOT));
    const expectedSkelSnippet = hasCbm ? 'startCockpitMcp' : '=== [Zoom-2 文件骨架视图] runner/cockpit/cockpit-mcp.mjs';

    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'dg_zoom', arguments: { targets: ['runner/cockpit/cockpit-mcp.mjs'], skeleton: true } } });
    const zoomSkel = await mcp.nextMessage('ndjson');
    expect(zoomSkel.result.isError).toBeUndefined();
    expect(zoomSkel.result.content[0].text).toContain(expectedSkelSnippet);

    send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'dg_zoom', arguments: { targets: ['runner/cockpit/cockpit-mcp.mjs', 'no_such_target_xyz'], skeleton: true } }
    });
    const zoomPartial = await mcp.nextMessage('ndjson');
    expect(zoomPartial.result.isError).toBe(true);
    expect(zoomPartial.result.content[0].text).toContain(expectedSkelSnippet);
    expect(zoomPartial.result.content[0].text).toContain('部分目标未命中告警');

    send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'dg_zoom', arguments: { targets: ['runner/cockpit/cockpit-mcp.mjs:1-5'], skeleton: true, source: true } }
    });
    const zoomSource = await mcp.nextMessage('ndjson');
    expect(zoomSource.result.isError).toBeUndefined();
    expect(zoomSource.result.content[0].text).toContain('末步源码真源直读');

    send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'dg_impact', arguments: { targets: ['runner/cockpit/cockpit-mcp.mjs'] } } });
    const impactRes = await mcp.nextMessage('ndjson');
    expect(impactRes.result.isError).toBeUndefined();
    expect(impactRes.result.content[0].text).toContain('stage22-cockpit-mcp.test.mjs');

    if (resolveCbmBinary(REPO_ROOT)) {
      send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: '承重接口 Kneedle', k: 5 } } });
      const locateRes = await mcp.nextMessage('ndjson');
      expect(locateRes.result.isError).toBeUndefined();
      expect(locateRes.result.content[0].text).toContain('cockpit-cbm.mjs');

      send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: '--help' } } });
      const injectRes = await mcp.nextMessage('ndjson');
      expect(injectRes.result.content[0].text).toContain('locate "--help"');
      expect(injectRes.result.content[0].text).not.toContain('DoneGate V4 CLI（十二条命令');
    }

    mcp.child.stdin.write('{bad json\n');
    const parseErr = await mcp.nextMessage('ndjson');
    expect(parseErr.error.code).toBe(-32700);

    mcp.child.stdin.write('123\n');
    const scalarInvalid = await mcp.nextMessage('ndjson');
    expect(scalarInvalid.error.code).toBe(-32600);

    send({ jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: 'kneedle', extraBogus: true } } });
    const unknownArgErr = await mcp.nextMessage('ndjson');
    expect(unknownArgErr.error.code).toBe(-32602);
    expect(unknownArgErr.error.message).toContain('extraBogus');

    send({ jsonrpc: '1.0', id: 11, method: 'ping' });
    const badVer = await mcp.nextMessage('ndjson');
    expect(badVer.error.code).toBe(-32600);

    send({ jsonrpc: '2.0', id: 12, method: 'unknown/method' });
    const noMethod = await mcp.nextMessage('ndjson');
    expect(noMethod.error.code).toBe(-32601);

    send({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'dg_unknown', arguments: {} } });
    const badTool = await mcp.nextMessage('ndjson');
    expect(badTool.error.code).toBe(-32602);

    send({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: 123 } } });
    const badType = await mcp.nextMessage('ndjson');
    expect(badType.error.code).toBe(-32602);

    send({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'dg_brief', arguments: { budget: 0 } } });
    const badVal = await mcp.nextMessage('ndjson');
    expect(badVal.result.isError).toBe(true);
    expect(badVal.result.content[0].text).toContain('正整数');

    const exitCode = await mcp.closeAndWait();
    expect(exitCode).toBe(0);
    expect(mcp.getRemainingBytes()).toBe(0);
    expect(mcp.getStderr()).toBe('');
  }, 20000);

  it('③ Content-Length 帧传输：分段半包、多字节 UTF-8 中文拆包与精确字节计数', async () => {
    const mcp = spawnMcpProc(REPO_ROOT);

    const frame1 = encodeMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01', clientInfo: { name: '中文客户端测试' } } },
      'content-length'
    );
    const splitHeader = 8;
    const splitMidUtf8 = frame1.indexOf(Buffer.from('中', 'utf8')) + 1;
    mcp.child.stdin.write(frame1.subarray(0, splitHeader));
    await new Promise((r) => setTimeout(r, 20));
    mcp.child.stdin.write(frame1.subarray(splitHeader, splitMidUtf8));
    await new Promise((r) => setTimeout(r, 20));
    mcp.child.stdin.write(frame1.subarray(splitMidUtf8));

    const initReply = await mcp.nextMessage('content-length');
    expect(initReply.msg.id).toBe(1);
    expect(initReply.msg.result.protocolVersion).toBe('2024-11-05');
    expect(initReply.byteLen).toBe(Buffer.byteLength(initReply.bodyText, 'utf8'));

    const notif = encodeMcpMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } }, 'content-length');
    const zoomFrame = encodeMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dg_zoom', arguments: { targets: ['不存在中文目标_x'] } } },
      'content-length'
    );
    mcp.child.stdin.write(Buffer.concat([notif, zoomFrame]));

    const zoomReply = await mcp.nextMessage('content-length');
    expect(zoomReply.msg.id).toBe(2);
    expect(zoomReply.msg.result.isError).toBe(true);
    expect(zoomReply.byteLen).toBe(Buffer.byteLength(zoomReply.bodyText, 'utf8'));
    expect(zoomReply.byteLen).toBeGreaterThan(zoomReply.bodyText.length);

    if (resolveCbmBinary(REPO_ROOT)) {
      const locFrame = encodeMcpMessage(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: '承重接口 Kneedle', k: 5 } } },
        'content-length'
      );
      mcp.child.stdin.write(locFrame);
      const locReply = await mcp.nextMessage('content-length');
      expect(locReply.msg.id).toBe(3);
      expect(locReply.msg.result.isError).toBeUndefined();
      expect(locReply.msg.result.content[0].text).toContain('cockpit-cbm.mjs');
      expect(locReply.byteLen).toBe(Buffer.byteLength(locReply.bodyText, 'utf8'));
      expect(locReply.byteLen).toBeGreaterThan(locReply.bodyText.length);
    }

    mcp.child.stdin.write('trailing-garbage');
    const eofPromise = mcp.closeAndWait();
    const errReply = await mcp.nextMessage('content-length');
    expect(errReply.msg.error.code).toBe(-32700);
    expect(await eofPromise).toBe(0);
  }, 20000);

  it('④ 无 CBM 索引的空临时目录调用 dg_locate 优雅返回 isError: true 且服务继续存活', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'dg-mcp-nocbm-'));
    tempDirs.push(emptyDir);
    const mcp = spawnMcpProc(emptyDir);
    const send = (obj) => mcp.child.stdin.write(`${JSON.stringify(obj)}\n`);
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dg_locate', arguments: { query: 'kneedle' } } });
      const locRes = await mcp.nextMessage('ndjson');
      expect(locRes.result.isError).toBe(true);
      expect(locRes.result.content[0].text).toMatch(/CBM|未命中任何种子词/);

      send({ jsonrpc: '2.0', id: 2, method: 'ping' });
      const pingRes = await mcp.nextMessage('ndjson');
      expect(pingRes.id).toBe(2);
      expect(pingRes.result).toEqual({});
    } finally {
      expect(await mcp.closeAndWait()).toBe(0);
    }
  }, 15000);
});
