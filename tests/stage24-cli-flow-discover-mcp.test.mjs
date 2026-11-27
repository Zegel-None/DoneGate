// Stage 24：CLI 声明式治理流入口 (flow/workflow)、存量仓 init --discover 逆向建图与 DoneGate MCP 治理工具单测
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchCommand } from '../runner/donegate.mjs';
import { createMcpDispatcher } from '../runner/cockpit/cockpit-mcp.mjs';
import { dispatchCockpitCommand } from '../runner/cockpit/cli.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI_PATH = join(REPO_ROOT, 'runner', 'donegate.mjs');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function spawnNdjsonMcp(root) {
  const child = spawn(process.execPath, [CLI_PATH, 'mcp', '--root', root], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let buf = '';
  const queue = [];
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (waiters.length > 0) waiters.shift()(msg);
      else queue.push(msg);
    }
  });
  return {
    send: (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`),
    next: () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
    close: () => new Promise((r) => { child.once('close', (code) => r(code)); child.stdin.end(); })
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('stage24: CLI flow shortcut, init --discover, and DoneGate MCP governance tools', () => {
  it('① CLI flow / workflow / workflow-run 入口支持 list 与 plan 预演且写入帮助文档', () => {
    const help = dispatchCommand(['--help'], REPO_ROOT);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('init [dir] [--discover]');
    expect(help.stdout).toContain('· flow <list|plan|inspect|diff|run|reset>');
    expect(help.stdout).toContain('dg_status');
    expect(help.stdout).toContain('dg_check_node');

    const listed = dispatchCommand(['workflow', 'list', '--json'], REPO_ROOT);
    expect(listed.exitCode).toBe(0);
    const listData = JSON.parse(listed.stdout);
    expect(listData.ok).toBe(true);
    expect(listData.flows.map((f) => f.id)).toContain('dg-pre-commit');

    const planned = dispatchCommand(['flow', 'plan', 'dg-pre-commit', '--json'], REPO_ROOT);
    expect(planned.exitCode).toBe(0);
    const planData = JSON.parse(planned.stdout);
    expect(planData.ok).toBe(true);
    expect(planData.plan.some((n) => n.id === 'pc-commit-hygiene' && n.status === 'active')).toBe(true);
  });

  it('② donegate init --discover 自动扫描存量 JS/TS 仓生成探索态起步契约、依赖图与单测映射', () => {
    const dir = makeTempDir('dg-discover-js-');
    mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
    mkdirSync(join(dir, 'src', 'api'), { recursive: true });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-app', devDependencies: { vitest: '^2.0.0' } }, null, 2));
    writeFileSync(join(dir, 'src', 'auth', 'token.mjs'), 'export function signToken(u) { return `tok:${u}`; }\n');
    writeFileSync(join(dir, 'src', 'api', 'server.mjs'), "import { signToken } from '../auth/token.mjs';\nexport const login = (u) => signToken(u);\n");
    writeFileSync(join(dir, 'tests', 'auth.test.mjs'), "import { signToken } from '../src/auth/token.mjs';\nconsole.log(signToken('ok'));\n");

    const initRes = dispatchCommand(['init', '--discover', '--root', dir], REPO_ROOT);
    expect(initRes.exitCode).toBe(0);
    expect(initRes.stdout).toContain('存量逆向建图');
    expect(readFileSync(join(dir, 'INTENT.md'), 'utf8')).toContain('冒烟命令：npx vitest run');

    const authContract = JSON.parse(readFileSync(join(dir, 'contracts', 'auth', 'contract.json'), 'utf8'));
    const apiContract = JSON.parse(readFileSync(join(dir, 'contracts', 'api', 'contract.json'), 'utf8'));
    expect(authContract.track).toBe('explore');
    expect(authContract.provisional).toBe(true);
    expect(authContract.obligations.length).toBe(1);
    expect(authContract.obligations[0].command).toContain('tests/auth.test.mjs');
    expect(apiContract.dependsOn).toContain('auth');

    const st = dispatchCommand(['status', '--root', dir], REPO_ROOT);
    expect(st.exitCode).toBe(0);
    expect(st.stdout).toContain('探索中');
    const gr = dispatchCommand(['graph', '--router', '--root', dir], REPO_ROOT);
    expect(gr.exitCode).toBe(0);
    expect(existsSync(join(dir, '.donegate', 'ROUTER.md'))).toBe(true);

    // 二次运行仍严格退 3 不覆盖
    const again = dispatchCommand(['init', '--discover', '--root', dir], REPO_ROOT);
    expect(again.exitCode).toBe(3);
  });

  it('③ donegate init --discover 兼容 Python 与 Go 存量仓库并自动匹配 pytest / go test', () => {
    const pyDir = makeTempDir('dg-discover-py-');
    mkdirSync(join(pyDir, 'billing'), { recursive: true });
    mkdirSync(join(pyDir, 'tests'), { recursive: true });
    writeFileSync(join(pyDir, 'pyproject.toml'), '[project]\nname = "demo-py"\n');
    writeFileSync(join(pyDir, 'billing', 'calc.py'), 'def total(a, b):\n    return a + b\n');
    writeFileSync(join(pyDir, 'tests', 'test_billing.py'), 'from billing.calc import total\nassert total(1, 2) == 3\n');

    const pyInit = dispatchCommand(['init', '--discover', '--root', pyDir], REPO_ROOT);
    expect(pyInit.exitCode).toBe(0);
    expect(readFileSync(join(pyDir, 'INTENT.md'), 'utf8')).toContain('冒烟命令：pytest -q');
    const pyC = JSON.parse(readFileSync(join(pyDir, 'contracts', 'billing', 'contract.json'), 'utf8'));
    expect(pyC.obligations[0].command).toBe('pytest -q tests/test_billing.py');

    const goDir = makeTempDir('dg-discover-go-');
    mkdirSync(join(goDir, 'ledger'), { recursive: true });
    writeFileSync(join(goDir, 'go.mod'), 'module example.com/demo\ngo 1.22\n');
    writeFileSync(join(goDir, 'ledger', 'sum.go'), 'package ledger\nfunc Sum(a, b int) int { return a + b }\n');
    writeFileSync(join(goDir, 'ledger', 'sum_test.go'), 'package ledger\nimport "testing"\nfunc TestSum(t *testing.T) {}\n');

    const goInit = dispatchCommand(['init', '--discover', '--root', goDir], REPO_ROOT);
    expect(goInit.exitCode).toBe(0);
    expect(readFileSync(join(goDir, 'INTENT.md'), 'utf8')).toContain('冒烟命令：go test ./...');
    expect(existsSync(join(goDir, 'contracts', 'ledger', 'contract.json'))).toBe(true);
  });

  it('④ DoneGate MCP 暴露 dg_status / dg_slice / dg_lint_edit / dg_check_node 且独立驾驶舱仍保持纯 4 工具', async () => {
    // 验证独立驾驶舱保持纯 4 工具（零宿主治理泄漏）
    const standaloneRpc = createMcpDispatcher({
      root: REPO_ROOT,
      serverName: 'zoom-cockpit',
      toolPrefix: '',
      brandName: 'Zoom Cockpit',
      dispatchCommand: (argv, r) => dispatchCockpitCommand(argv, r)
    });
    const standaloneList = standaloneRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(standaloneList.result.tools.map((t) => t.name)).toEqual(['brief', 'locate', 'zoom', 'impact']);

    // 在临时存量仓中端到端调用 DoneGate MCP 4 个治理工具
    const dir = makeTempDir('dg-mcp-gov-');
    mkdirSync(join(dir, 'src', 'core'), { recursive: true });
    writeFileSync(join(dir, 'src', 'core', 'math.mjs'), 'export function add(a, b) { return a + b; }\n');
    expect(dispatchCommand(['init', '--discover', '--root', dir], REPO_ROOT).exitCode).toBe(0);

    const mcp = spawnNdjsonMcp(dir);
    mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    await mcp.next();

    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dg_status', arguments: { tree: true } } });
    const statusRes = await mcp.next();
    expect(statusRes.result.isError).toBeUndefined();
    expect(statusRes.result.content[0].text).toContain('健康自检');
    expect(statusRes.result.content[0].text).toContain('探索中');

    mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dg_slice', arguments: { routerOnly: true } } });
    const sliceRes = await mcp.next();
    expect(sliceRes.result.isError).toBeUndefined();
    expect(sliceRes.result.content[0].text).toContain('ROUTER.md');

    mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dg_lint_edit', arguments: { files: ['src/core/math.mjs'], json: true } } });
    const lintRes = await mcp.next();
    expect(lintRes.result.isError).toBeUndefined();
    expect(lintRes.result.content[0].text).toContain('math.mjs');

    mcp.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'dg_check_node', arguments: { nodeId: ' ' } } });
    const badNodeRes = await mcp.next();
    expect(badNodeRes.result.isError).toBe(true);
    expect(badNodeRes.result.content[0].text).toContain('nodeId');

    mcp.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'dg_status', arguments: { bogus: 1 } } });
    const badArgRes = await mcp.next();
    expect(badArgRes.error.code).toBe(-32602);

    expect(await mcp.close()).toBe(0);
  }, 20000);
});
