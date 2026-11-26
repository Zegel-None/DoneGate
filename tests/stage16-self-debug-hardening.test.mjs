// Stage 16: 全仓自检 36 项缺陷（安全边界 / 复杂度门禁 / 探索双轨与判定核 / Python 生态与适配器 / 治理引擎与挂机锁）对抗回归套件
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeCodeComplexityAndGolfing } from '../skill/cognitive-complexity.mjs';
import { countEffectiveCodeLines } from '../skill/commit-hygiene-metrics.mjs';
import { RULES as OBS_RULES } from '../skill/check-brick-observations.mjs';
import {
  CONTROL_PLANE_TOKEN_HEADER,
  hagInjectSessionTokenHtml,
  hagIsLoopbackOrigin,
  hagSanitizeHttpWorkflowPack
} from '../runner/dsh/host/host-auth-guard.mjs';
import { createDoneGateWebRouteHandler } from '../runner/dsh/host/host-routes.mjs';
import { resolveSafeWorkspaceFolders, toSafeFileUrl } from '../runner/dsh/deps/win-paths.mjs';
import { startAtlasHttpServer } from '../runner/dsh/host/serve-atlas.mjs';
import { buildWbGovernancePanelScript } from '../runner/atlas/wb-governance-panel.mjs';
import { WFC_BRICK_EXEC_MAP, wfcCompileWorkflow, wfcProbeEnvCoeffects } from '../runner/dsh/autopilot/workflow-compiler.mjs';
import { lookupFingerprintCache, recordFingerprintCache } from '../runner/dsh/deps/fingerprint-cache.mjs';
import { executeDeterministicWorkflowRun } from '../runner/dsh/autopilot/workflow-runner.mjs';
import { executeProjectCampaignAutopilot } from '../runner/dsh/autopilot/campaign-autopilot.mjs';
import { checkCommandBans } from '../runner/core/isolation.mjs';
import { STATE_PRIORITY, isSelfWriterIdentity } from '../runner/core/project-loader.mjs';
import { verifyHeldOutContract } from '../runner/core/heldout-verifier.mjs';
import { vcAggregateVoteFiles, vcEvaluateVerdictMatrix } from '../runner/core/verify-consensus.mjs';
import { buildNodeInterfaceStub, extractFileInterfaceStub } from '../runner/core/ast-stub.mjs';
import { extractPythonImportTargets } from '../runner/core/python-imports.mjs';
import { dispatchCommand } from '../runner/donegate.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function invokeMockRoute(handler, { method = 'GET', subPath, headers = {}, rawBody = null, body = null }) {
  let status = 200;
  let respHeaders = {};
  let raw = '';
  const payload = rawBody !== null ? rawBody : (body !== null ? JSON.stringify(body) : null);
  const req = {
    method,
    url: `/donegate/api${subPath}`,
    headers: { host: '127.0.0.1:3000', ...headers },
    on(ev, cb) {
      if (ev === 'data' && payload !== null) cb(Buffer.from(payload));
      if (ev === 'end') cb();
    },
    destroy() {}
  };
  const res = {
    headersSent: false,
    writeHead(code, hdrs = {}) { status = code; respHeaders = hdrs; this.headersSent = true; },
    end(chunk = '') { raw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''); }
  };
  await handler(req, res, subPath);
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (err) { void err; }
  return { status, headers: respHeaders, raw, json };
}

function initGitRepo(dir) {
  const g = (args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(['init', '-q']);
  g(['config', 'user.email', 'test@donegate.local']);
  g(['config', 'user.name', 'Tester']);
  return g;
}

describe('stage16: self-debug hardening regression suite (P0/P1/P2)', () => {
  it('hardens control-plane auth, Origin:null, no-cors 415, malformed JSON 400, RCE pack stripping, path boundaries & proxy SSRF', async () => {
    expect(hagIsLoopbackOrigin('null')).toBe(false);
    expect(hagIsLoopbackOrigin('http://127.0.0.1:3000')).toBe(true);

    const injected = hagInjectSessionTokenHtml('<head></head>', 'tok</script><img src=x>');
    expect(injected).not.toContain('tok</script>');
    expect(injected).toContain('/donegate/api/');

    const sanitizedPack = hagSanitizeHttpWorkflowPack({
      id: 'evil',
      nodes: [
        { id: 'n1', exec: { nodeArgs: ['-e', 'process.exit(99)'], kind: 'external_bin', bin: 'calc.exe' }, execution: { preFlightPlug: 'echo pwned', sandbox: 'worktree' } }
      ]
    });
    expect(sanitizedPack.nodes[0].exec).toBeUndefined();
    expect(sanitizedPack.nodes[0].execution.preFlightPlug).toBeUndefined();

    const tmp = mkdtempSync(join(tmpdir(), 'dg-s16-sec-'));
    const sibling = `${tmp}-sibling`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'secret.html'), '<h1>secret</h1>', 'utf8');
    try {
      const handler = createDoneGateWebRouteHandler(tmp, { requireAuth: true });
      const auth = { [CONTROL_PLANE_TOKEN_HEADER]: handler.sessionToken };

      // 1. no-cors simple Content-Type blocked with 415
      const r415 = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/governance/overlay',
        headers: { ...auth, 'content-type': 'text/plain' },
        rawBody: '{"flowId":"dg-on-edit"}'
      });
      expect(r415.status).toBe(415);

      // 2. Malformed JSON returns 400 cleanly instead of crashing
      const r400 = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/governance/overlay',
        headers: { ...auth, 'content-type': 'application/json' },
        rawBody: '{bad-json'
      });
      expect(r400.status).toBe(400);

      // 3. /judge/pack rejects contractId traversal and out traversal
      const rJudgeBadId = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/judge/pack', headers: auth,
        body: { contractId: '../escape' }
      });
      expect(rJudgeBadId.status).toBe(400);
      const rJudgeBadOut = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/judge/pack', headers: auth,
        body: { contractId: 'c1', out: '../../../escape-dir' }
      });
      expect(rJudgeBadOut.status).toBe(400);

      // 4. GET /observation-preview rejects traversal & contains fallback strictly inside .donegate/previews/
      const rObsBad = await invokeMockRoute(handler, { method: 'GET', subPath: '/observation-preview?tool=../../etc' });
      expect(rObsBad.status).toBe(400);
      const rObsRead = await invokeMockRoute(handler, { method: 'GET', subPath: '/observation-preview?tool=biome' });
      expect(rObsRead.status).toBe(200);
      expect(rObsRead.json.sourcePath).toBe('.donegate/previews/biome-record.md');
      expect(existsSync(join(tmp, '.donegate', 'previews', 'biome-record.md'))).toBe(true);

      // 5. /uiboard/inline-edit blocks sibling prefix traversal and protected DoneGate files
      const sibBase = sibling.split(/[\\/]/).pop();
      const rSibEdit = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/uiboard/inline-edit', headers: auth,
        body: { sourceFile: `../${sibBase}/secret.html`, before: 'secret', after: 'pwned' }
      });
      expect(rSibEdit.status).toBe(403);
      writeFileSync(join(tmp, 'thresholds.json'), '{"a":1}', 'utf8');
      const rProtEdit = await invokeMockRoute(handler, {
        method: 'POST', subPath: '/uiboard/inline-edit', headers: auth,
        body: { sourceFile: 'thresholds.json', before: '1', after: '2' }
      });
      expect(rProtEdit.status).toBe(403);

      // 6. /uiboard/proxy blocks 3xx SSRF redirect & sandboxes SVG
      const redirSrv = createServer((req, res) => {
        if (req.url === '/redir') {
          res.writeHead(302, { Location: 'https://example.com/internal' });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
          res.end('<svg><script>alert(1)</script></svg>');
        }
      });
      await new Promise((r) => redirSrv.listen(0, '127.0.0.1', r));
      const pPort = redirSrv.address().port;
      try {
        const rRedir = await invokeMockRoute(handler, {
          method: 'GET', subPath: `/uiboard/proxy?url=${encodeURIComponent(`http://127.0.0.1:${pPort}/redir`)}`
        });
        expect(rRedir.status).toBe(400);
        const rSvg = await invokeMockRoute(handler, {
          method: 'GET', subPath: `/uiboard/proxy?url=${encodeURIComponent(`http://127.0.0.1:${pPort}/icon.svg`)}`
        });
        expect(rSvg.status).toBe(200);
        expect(String(rSvg.headers['Content-Security-Policy'] || '')).toContain('sandbox');
      } finally {
        redirSrv.close();
      }

      // 7. Workspace folder & file URL safety
      const safeRes = resolveSafeWorkspaceFolders(tmp, [`../${sibBase}/secret.html`]);
      expect(safeRes[0].blocked).toBe(true);
      expect(toSafeFileUrl(['C:', 'a', 'b', '..', 'c.txt'].join('\\'))).not.toContain('/../');

      // 8. Standalone Atlas HTTP server enforces auth by default and rejects wildcard CORS
      const srv = await startAtlasHttpServer(tmp, { port: 0, idleExitSec: 15 });
      try {
        expect(srv.sessionToken).toBeTruthy();
        const unauthPost = await fetch(`${srv.url}api/atlas/refresh`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
        expect(unauthPost.status).toBe(403);
        expect(unauthPost.headers.get('access-control-allow-origin')).not.toBe('*');
      } finally {
        srv.server.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }

    // 9. Zero postMessage(..., '*') wildcards left in bridge/shell sources
    for (const rel of ['runner/dsh/host/client-bundle-gen.mjs', 'runner/atlas/wb-dsh-shell.mjs', 'runner/atlas/wb-dsh-bridge.mjs', 'runner/atlas/ui-shell.mjs']) {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(src).not.toMatch(/postMessage\s*\([^)]*['"]\*['"]\s*\)/);
    }
  });

  it('fixes cognitive complexity parser (${...}, TS generics, class methods, do-while), Python // metrics, mixed audit-repo, TOCTOU & command bans', () => {
    const jsWithTpl = [
      'export function withTemplate(a, b, c) {',
      '  const msg = `hello ${a}`;',
      '  if (a) { if (b) { if (c) return msg; } }',
      '  return "";',
      '}',
      'export function genericFn<T extends Record<string, number>>(items: T[]): Map<string, T> {',
      '  const out = new Map();',
      '  for (const x of items) { if (x) out.set("k", x); }',
      '  return out;',
      '}',
      'export class Worker {',
      '  run(x) { let i = 0; do { if (x) i++; } while (i < 3); return i; }',
      '}'
    ].join('\n');
    const res = analyzeCodeComplexityAndGolfing(jsWithTpl);
    const fTpl = res.functions.find((f) => f.name === 'withTemplate');
    const fGen = res.functions.find((f) => f.name === 'genericFn');
    const fCls = res.functions.find((f) => f.name === 'Worker.run');
    expect(fTpl?.cognitiveComplexity).toBe(6); // 1 + 2 + 3 after ${a}!
    expect(fGen?.cognitiveComplexity).toBe(3); // for(1) + nested if(2)
    expect(fCls?.cognitiveComplexity).toBe(3); // do(1) + nested if(2), while NOT double-counted!

    const pyCode = 'q = a // b\n# comment\nx = 10 // 3\n';
    expect(countEffectiveCodeLines(pyCode, { filePath: 'calc.py' }).effectiveLines).toBe(2);

    expect(checkCommandBans('npm test || exit 0').length).toBeGreaterThan(0);
    expect(checkCommandBans('npm test || :').length).toBeGreaterThan(0);
    expect(checkCommandBans('cd sub && npm test').length).toBeGreaterThan(0);
    expect(checkCommandBans('echo ok > contracts\\c1\\contract.json').length).toBeGreaterThan(0);

    // Mixed JS+Python repo without complexipy must return exit 3 PARTIAL_PYTHON_UNSCANNED (never false PASS)
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s16-mix-'));
    try {
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'ok.mjs'), 'export const add = (a, b) => a + b;\n', 'utf8');
      writeFileSync(join(tmp, 'src', 'mod.py'), 'def f(x):\n    return x\n', 'utf8');
      const r = spawnSync(process.execPath, [join(REPO_ROOT, 'skill/check-commit-hygiene.mjs'), '--audit-repo', '--root', tmp, '--json'], {
        encoding: 'utf8', env: { ...process.env, PATH: '' }, windowsHide: true
      });
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).status).toBe('PARTIAL_PYTHON_UNSCANNED');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hardens explore-track isolation, skip-gates rejection, promote rollback, Held-Out metadata, verify-consensus & STATE_PRIORITY', () => {
    expect(STATE_PRIORITY['不稳定']).toBe(4);
    expect(isSelfWriterIdentity('claude-3.5-sonnet')).toBe(true);
    expect(isSelfWriterIdentity('gpt-4o')).toBe(true);
    expect(isSelfWriterIdentity('张三')).toBe(false);

    // Held-Out metadata & protected gate checks
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s16-core-'));
    try {
      const g = initGitRepo(tmp);
      dispatchCommand(['init', '.'], tmp);
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'a.mjs'), 'export const a = 1;\n', 'utf8');
      dispatchCommand(['contract', 'new', 'exp-spike', '--title', '探索原型', '--why', '验证思路', '--scope', 'src/a.mjs', '--explore'], tmp);
      g(['add', '-A']);
      g(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

      // Explore contract excluded from gaps, graph & orphanContracts
      const gaps = dispatchCommand(['gaps', '--json'], tmp);
      expect(gaps.exitCode).toBe(0);
      const gapsList = JSON.parse(gaps.stdout);
      expect(Array.isArray(gapsList)).toBe(true);
      expect(gapsList.some((x) => x.contractId === 'exp-spike')).toBe(false);

      // Promote with AI signer fails atomically and leaves contract.json intact in explore track
      const badProm = dispatchCommand(['contract', 'promote', 'exp-spike', '--by', 'claude-3.5'], tmp);
      expect(badProm.exitCode).not.toBe(0);
      const afterBadProm = JSON.parse(readFileSync(join(tmp, 'contracts/exp-spike/contract.json'), 'utf8'));
      expect(afterBadProm.track).toBe('explore');

      // Held-Out gate file tamper check
      const gateTamper = verifyHeldOutContract(tmp, { id: 'business-card' }, { touchedFiles: ['runner/core/state-calc.mjs'] });
      expect(gateTamper.ok).toBe(false);
      expect(gateTamper.code).toBe('HELDOUT_GATE_TAMPERED');

      // verify-consensus hardening: null JSON, empty executionTrace, duplicate votes, 1 pass + 1 unknown
      expect(vcEvaluateVerdictMatrix(null).ok).toBe(false);
      const pEntry = { verdict: 'pass', reason: 'all checks passed cleanly' };
      expect(vcEvaluateVerdictMatrix({
        judge: 'j1',
        V1: { verdict: 'pass', reason: 'ok', proof: { premise: 'p', executionTrace: ['   '], conclusion: 'c' } },
        V2: pEntry, V3: pEntry, V4: pEntry, V5: pEntry
      }).ok).toBe(false);

      const v1 = join(tmp, 'v1.json');
      const v2 = join(tmp, 'v2.json');
      const uEntry = { verdict: 'unknown', reason: '缺失运行日志材料' };
      writeFileSync(v1, JSON.stringify({ contractId: 'c1', judge: 'j1', V1: pEntry, V2: pEntry, V3: pEntry, V4: pEntry, V5: pEntry }), 'utf8');
      writeFileSync(v2, JSON.stringify({ contractId: 'c1', judge: 'j2', V1: pEntry, V2: uEntry, V3: pEntry, V4: pEntry, V5: pEntry }), 'utf8');
      expect(vcAggregateVoteFiles(tmp, [v1, v1]).ok).toBe(false); // duplicate vote blocked
      const agg = vcAggregateVoteFiles(tmp, [v1, v2]);
      expect(agg.ok).toBe(true);
      expect(agg.merged.V2.verdict).toBe('unknown');
      expect(agg.merged.V2.reason).toContain('缺失运行日志材料');
      expect(agg.merged.V2.reason).not.toContain('all checks passed');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fixes Python consecutive imports, docstring masking, 3.12 generic stubs, nested closure exclusion & empty __init__.py barrels', () => {
    const pySrc = [
      '"""',
      'from fake.docstring import should_not_match',
      '"""',
      'import pkg.alpha',
      'import pkg.beta',
      'from pkg.gamma import (',
      '    delta,',
      '    epsilon',
      ')',
      'def generic_fn[T: str](x: T) -> Annotated[int, {"k": "v"}]:',
      '    def inner_closure(y: int) -> int:',
      '        return y + 1',
      '    return inner_closure(1)',
      'class Service:',
      '    def handle(self, req: dict[str, int]) -> bool:',
      '        return True',
      ''
    ].join('\n');
    const files = new Set(['pkg/alpha.py', 'pkg/beta.py', 'pkg/gamma.py', 'fake/docstring.py', 'main.py']);
    const targets = extractPythonImportTargets('main.py', pySrc, files);
    expect(targets).toEqual(['pkg/alpha.py', 'pkg/beta.py', 'pkg/gamma.py']);

    const stub = extractFileInterfaceStub(pySrc, 'main.py');
    const syms = stub.exports.map((e) => e.symbol);
    expect(syms).toContain('generic_fn');
    expect(syms).toContain('Service');
    expect(syms).toContain('.handle');
    expect(syms).not.toContain('.inner_closure');
    expect(syms).not.toContain('inner_closure');
    expect(stub.exports.find((e) => e.symbol === 'generic_fn')?.signature).toContain('-> Annotated[int, {"k": "v"}]: ...');

    // Empty __init__.py should NOT trigger barrel mode; __init__.py with re-exports SHOULD resolve target signatures
    const tmp = mkdtempSync(join(tmpdir(), 'dg-s16-py-'));
    try {
      mkdirSync(join(tmp, 'pkg_empty'), { recursive: true });
      writeFileSync(join(tmp, 'pkg_empty', '__init__.py'), '# marker only\n', 'utf8');
      writeFileSync(join(tmp, 'pkg_empty', 'core.py'), 'def calc(x: int) -> int:\n    return x\n', 'utf8');
      const emptyStub = buildNodeInterfaceStub(tmp, { id: 'n-empty', scope: ['pkg_empty/'] });
      expect(emptyStub.facadeMode).toBe('module-exports');

      mkdirSync(join(tmp, 'pkg_barrel'), { recursive: true });
      writeFileSync(join(tmp, 'pkg_barrel', 'impl.py'), 'def compute(a: int, b: int) -> int:\n    return a + b\n', 'utf8');
      writeFileSync(join(tmp, 'pkg_barrel', '__init__.py'), 'from .impl import compute\n', 'utf8');
      const barrelStub = buildNodeInterfaceStub(tmp, { id: 'n-barrel', scope: ['pkg_barrel/'] });
      expect(barrelStub.facadeMode).toBe('barrel');
      expect(barrelStub.stubText).toContain('def compute(a: int, b: int) -> int: ...');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('wires 7 Python brick obligations, swapBrick exec switching, fingerprint-cache non-string inputs, workflow-runner self-heal/DAG & governance panel', async () => {
    for (const ob of [
      'ruff-no-violations', 'complexipy-under-cap', 'pyright-no-errors',
      'ty-no-errors', 'pytest-all-pass', 'import-linter-no-broken-contracts', 'fuck-u-code-no-hot-files'
    ]) {
      expect(OBS_RULES[ob]).toBeDefined();
    }

    // symbols-baseline.json typo fixed in DoneGate repo
    expect(wfcProbeEnvCoeffects(REPO_ROOT).hasSymbolsBaseline).toBe(true);

    // swapBrick updates node.exec and EVERY entry in WFC_BRICK_EXEC_MAP points to a real file
    for (const [k, spec] of Object.entries(WFC_BRICK_EXEC_MAP)) {
      const rel = spec.entryRel || spec.scriptRel;
      if (rel) expect(existsSync(join(REPO_ROOT, rel)), `${k} -> ${rel}`).toBe(true);
    }
    const compiledSwap = wfcCompileWorkflow(REPO_ROOT, 'dg-pre-commit', {
      overlay: { swapBrick: { 'pc-py-types': 'adp-pyright' } }
    });
    const swappedNode = compiledSwap.effectivePack.nodes.find((n) => n.id === 'pc-py-types');
    expect(swappedNode?.exec?.tool).toBe('pyright');
    expect(swappedNode?.exec?.entryRel).toBe('skill/adapters/pyright-types.mjs');

    // Governance panel script fixes
    const panelSrc = buildWbGovernancePanelScript();
    expect(panelSrc).toContain('tj.suggestions');
    expect(panelSrc).toContain('data-gov-trust-flow');
    expect(panelSrc).toContain('data-gov-trust-node');
    expect(panelSrc).toContain('type="text"');
    expect(panelSrc).toContain('dgGovUiState.lastError');

    const tmp = mkdtempSync(join(tmpdir(), 'dg-s16-wf-'));
    try {
      // Fingerprint cache ignores port-object inputs and refuses 0-file caching
      const emptyCache = lookupFingerprintCache(tmp, tmp, { id: 'n1', inputs: [{ id: 'in', name: '输入', type: 'SIGNAL' }] }, ['a']);
      expect(emptyCache.fp.watchedCount).toBe(0);
      recordFingerprintCache(tmp, emptyCache.fp, { durationMs: 1 });
      expect(lookupFingerprintCache(tmp, tmp, { id: 'n1', inputs: [{ id: 'in', name: '输入', type: 'SIGNAL' }] }, ['a']).hit).toBe(false);

      // Workflow-runner: self-heal clears failedNodes + skips envSkipped + traverses DAG fork
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'flag.txt'), 'fail', 'utf8');
      const gateScript = join(tmp, 'gate.mjs');
      writeFileSync(gateScript, [
        'import { readFileSync, writeFileSync } from "node:fs";',
        'const f = "src/flag.txt";',
        'if (readFileSync(f, "utf8").trim() !== "pass") { writeFileSync(f, "pass", "utf8"); process.exit(1); }',
        'process.exit(0);'
      ].join('\n'), 'utf8');
      const branchLog = join(tmp, 'branch.txt');
      const branchScript = join(tmp, 'branch.mjs');
      writeFileSync(branchScript, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(branchLog)}, "ran", "utf8");`, 'utf8');
      const pack = {
        id: 'dag-heal-test',
        name: '自愈与多分支测试',
        nodes: [
          { id: 'n-gate', title: '自愈门禁', exec: { nodeArgs: [gateScript] } },
          { id: 'n-skip', title: '按环境跳过', envSkipped: true, exec: { nodeArgs: ['-e', 'process.exit(2)'] } },
          { id: 'n-branch', title: '并行分支节点', exec: { nodeArgs: [branchScript] } }
        ],
        links: [
          { id: 'lk-self', fromNode: 'n-gate', toNode: 'n-gate', maxLoops: 2 },
          { id: 'lk-a', fromNode: 'n-gate', toNode: 'n-skip' },
          { id: 'lk-b', fromNode: 'n-gate', toNode: 'n-branch' }
        ]
      };
      const runOut = await executeDeterministicWorkflowRun(tmp, { ticketId: 't-heal' }, pack, {
        enforceDeps: false, useWorktreeSandbox: false, useFingerprintCache: false
      });
      expect(runOut.ok).toBe(true);
      expect(runOut.exitCode).toBe(0);
      expect(runOut.failedNodes).toEqual([]);
      expect(readFileSync(branchLog, 'utf8')).toBe('ran');

      // Campaign preFlightPlug failure preserves sandboxUsed
      const campFail = await executeProjectCampaignAutopilot(tmp, {
        campaignId: '../bad/camp',
        useWorktreeSandbox: false,
        enforceDeps: false,
        nodes: [{
          id: 'sw-card', title: '真机卡', scopePaths: ['src/'],
          execution: { sandbox: 'host-local', resourceLocks: ['solidworks-com'], preFlightPlug: 'node -e "process.exit(1)"' }
        }],
        links: []
      });
      expect(campFail.ok).toBe(false);
      expect(campFail.campaignId).not.toContain('..');
      expect(campFail.componentReports[0].sandboxUsed).toBe('host-local');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
