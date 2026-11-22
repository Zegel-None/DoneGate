import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { buildNodeInterfaceStub, extractFileInterfaceStub } from '../runner/core/ast-stub.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function initGitRepo(dir) {
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'slice@donegate.local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'SliceTest']);
  spawnSync('git', ['-C', dir, 'add', '.']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
}

describe('DoneGate 密封契约切片与 1M×40%（400k）五段式子代理预算', () => {
  it('提取多语言导出签名与前置 JSDoc 契约文档，剥离函数体且内部重构不触发 64 位 stubHash 漂移', () => {
    const jsV1 = [
      '// export function commentedFake(x) { return x; }',
      '/* export const blockFake = 1; */',
      'const SECRET_SQL = "export function stringFake() {}";',
      '/** 创建订单并返回聚合总额 */',
      'export async function createOrder(userId, items = [{ sku: "A", qty: 1 }]) {',
      '  const total = items.reduce((s, x) => s + x.qty, 0);',
      '  return { userId, total, sql: SECRET_SQL };',
      '}',
      'export const formatPrice = (cents) => `$${(cents / 100).toFixed(2)}`;',
      'export class OrderStore {',
      '  constructor(pool) { this.pool = pool; }',
      '  async save(order) { return this.pool.insert(order); }',
      '}'
    ].join('\n');

    const jsV2InternalRefactor = [
      '/** 创建订单并返回聚合总额（已改为循环累加） */',
      'export async function createOrder(userId, items = [{ sku: "A", qty: 1 }]) {',
      '  let sum = 0;',
      '  for (const item of items) sum += Number(item.qty || 0);',
      '  return Object.freeze({ userId, total: sum });',
      '}',
      'export const formatPrice = (cents) => String(cents);',
      'export class OrderStore {',
      '  constructor(pool) { this._db = pool; }',
      '  async save(order) { return Boolean(order); }',
      '}'
    ].join('\n');

    const parsed = extractFileInterfaceStub(jsV1, 'src/order.mjs');
    const symbols = parsed.exports.map((e) => e.symbol);
    expect(symbols).toEqual(['createOrder', 'OrderStore', 'formatPrice']);
    expect(parsed.exports[0].doc).toContain('创建订单并返回聚合总额');
    expect(parsed.exports[0].signature).toContain('export async function createOrder(userId, items = [{ sku: "A", qty: 1 }]);');
    expect(parsed.exports[0].signature).not.toContain('SECRET_SQL');

    const dir = mkdtempSync(join(tmpdir(), 'dg-stub-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/order.mjs'), jsV1);
      const stub1 = buildNodeInterfaceStub(dir, { id: 'order', scope: ['src/order.mjs'] });
      writeFileSync(join(dir, 'src/order.mjs'), jsV2InternalRefactor);
      const stub2 = buildNodeInterfaceStub(dir, { id: 'order', scope: ['src/order.mjs'] });
      expect(stub1.stubHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stub1.stubHash).toBe(stub2.stubHash);
      expect(stub1.stubText).toContain('创建订单并返回聚合总额');
      expect(stub1.stubText).not.toContain('SECRET_SQL');

      const pyStub = extractFileInterfaceStub(
        '# def fake_comment(): pass\ndef _private_helper(x):\n    return x\nasync def fetch_invoice(order_id: str) -> dict:\n    return {"id": order_id}\n',
        'billing.py'
      );
      expect(pyStub.exports.map((e) => e.symbol)).toEqual(['fetch_invoice']);

      const goStub = extractFileInterfaceStub(
        'package pay\nfunc helper(x int) int { return x }\nfunc ChargeCard(amount int64, currency string) error {\n\treturn nil\n}\n',
        'pay.go'
      );
      expect(goStub.exports.map((e) => e.symbol)).toEqual(['ChargeCard']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('默认 1M×40%=400k 五段预算静态前缀置顶排布，修改 0-Hop 内部实现与单测不改变 ## 4. 0-Hop 前缀', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-slice-'));
    try {
      dispatchCommand(['init', '.'], dir);
      mkdirSync(join(dir, 'src/db'), { recursive: true });
      mkdirSync(join(dir, 'src/order'), { recursive: true });
      mkdirSync(join(dir, 'src/api'), { recursive: true });
      mkdirSync(join(dir, 'src/audit'), { recursive: true });
      mkdirSync(join(dir, 'tests'), { recursive: true });

      writeFileSync(join(dir, 'src/db/internal-pool.mjs'), 'export const INTERNAL_DB_DSN = "postgres://secret-dsn-body";\nexport function rawQuery(sql) { return sql + INTERNAL_DB_DSN; }\n');
      writeFileSync(join(dir, 'src/db/index.mjs'), 'import { rawQuery } from "./internal-pool.mjs";\n/** 按主键查询订单行 */\nexport function queryOrderById(id) { return rawQuery("SELECT * FROM orders WHERE id=" + id); }\n');
      writeFileSync(join(dir, 'src/order/service.mjs'), 'import { queryOrderById } from "../db/index.mjs";\nexport function getOrderSummary(id) { return { id, row: queryOrderById(id) }; }\n');
      writeFileSync(join(dir, 'tests/order.test.mjs'), 'import { getOrderSummary } from "../src/order/service.mjs";\nexport const ORDER_UNIT_TEST_MARKER = Boolean(getOrderSummary);\n');
      writeFileSync(join(dir, 'src/api/handler.mjs'), 'import { getOrderSummary } from "../order/service.mjs";\nexport function handleGetOrder(req) { return getOrderSummary(req.id); }\n');
      writeFileSync(join(dir, 'src/audit/worker.mjs'), 'export const TWO_HOP_SECRET = "MUST_NEVER_APPEAR_IN_ORDER_CAPSULE";\nexport function flushAudit() { return TWO_HOP_SECRET; }\n');

      dispatchCommand(['contract', 'new', 'db-layer', '--title', '数据存储层', '--scope', 'src/db/'], dir);
      dispatchCommand(['contract', 'new', 'order-svc', '--title', '订单领域层', '--scope', 'src/order/', '--depends-on', 'db-layer'], dir);
      dispatchCommand(['contract', 'new', 'api-gw', '--title', '网关接入层', '--scope', 'src/api/', '--depends-on', 'order-svc'], dir);
      dispatchCommand(['contract', 'new', 'audit-job', '--title', '异步审计器', '--scope', 'src/audit/'], dir);

      const rRouter = dispatchCommand(['graph', '--router'], dir);
      expect(rRouter.exitCode).toBe(0);
      expect(existsSync(join(dir, '.donegate/ROUTER.md'))).toBe(true);
      expect(rRouter.router.budgetProfile.contextWindowTokens).toBe(1000000);
      expect(rRouter.router.budgetProfile.totalSessionBudgetTokens).toBe(400000);
      expect(rRouter.router.budgetProfile.zeroHopSourceBudgetTokens).toBe(160000);
      expect(rRouter.router.budgetProfile.oneHopContractBudgetTokens).toBe(48000);
      expect(rRouter.router.budgetProfile.multiTurnReserveTokens).toBe(120000);

      const rCap = dispatchCommand(['slice', 'order-svc', '--freeze-stub'], dir);
      expect(rCap.exitCode).toBe(0);
      expect(rCap.capsule.stubHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rCap.stdout).toContain('getOrderSummary(id)');
      expect(rCap.stdout).toContain('ORDER_UNIT_TEST_MARKER');
      expect(rCap.stdout).toContain('按主键查询订单行');
      expect(rCap.stdout).toContain('export function queryOrderById(id);');
      expect(rCap.stdout).toContain('export function handleGetOrder(req);');
      expect(rCap.stdout).not.toContain('postgres://secret-dsn-body');
      expect(rCap.stdout).not.toContain('SELECT * FROM orders');
      expect(rCap.capsule.omittedTwoHopNodes).toContain('audit-job');
      expect(rCap.stdout).not.toContain('TWO_HOP_SECRET');

      const md1 = readFileSync(join(dir, '.donegate/capsules/order-svc.capsule.md'), 'utf8');
      const idxSec1 = md1.indexOf('## 1. 静态路由规则与阅后即焚收口指令');
      const idxSec2 = md1.indexOf('## 2. 本卡契约声明（0-Hop Mandate）');
      const idxSec3 = md1.indexOf('## 3. 1-Hop 邻域冻结接口存根');
      const idxStubDts = md1.indexOf('.donegate/stubs/api-gw.stub.d.ts');
      const idxDbDts = md1.indexOf('.donegate/stubs/db-layer.stub.d.ts');
      const idxSec4 = md1.indexOf('## 4. 0-Hop');
      expect(idxSec1).toBeGreaterThan(0);
      expect(idxSec1).toBeLessThan(idxSec2);
      expect(idxSec2).toBeLessThan(idxSec3);
      expect(idxSec3).toBeLessThan(idxStubDts);
      expect(idxStubDts).toBeLessThan(idxDbDts);
      expect(idxDbDts).toBeLessThan(idxSec4);

      writeFileSync(join(dir, 'src/order/service.mjs'), 'import { queryOrderById } from "../db/index.mjs";\nfunction normId(v) { return String(v).trim(); }\nexport function getOrderSummary(id) {\n  const clean = normId(id);\n  return { id: clean, row: queryOrderById(clean), ok: true };\n}\n');
      writeFileSync(join(dir, 'tests/order.test.mjs'), 'import { getOrderSummary } from "../src/order/service.mjs";\nexport const ORDER_UNIT_TEST_MARKER = Boolean(getOrderSummary);\nexport const EXTRA_CASE = 2;\n');
      writeFileSync(join(dir, 'tests/order-extra.test.mjs'), 'import { getOrderSummary } from "../src/order/service.mjs";\nexport const SECOND_TEST_FILE = typeof getOrderSummary;\n');

      const rCap2 = dispatchCommand(['slice', 'order-svc'], dir);
      expect(rCap2.exitCode).toBe(0);
      const md2 = readFileSync(join(dir, '.donegate/capsules/order-svc.capsule.md'), 'utf8');
      expect(md2.slice(0, md2.indexOf('## 4. 0-Hop'))).toBe(md1.slice(0, idxSec4));
      expect(md2).toContain('SECOND_TEST_FILE');

      const scaled = dispatchCommand(['slice', 'order-svc', '--context-window', '128000', '--utilization', '0.4', '--json'], dir);
      expect(scaled.exitCode).toBe(0);
      expect(scaled.capsule.budgetProfile.totalSessionBudgetTokens).toBe(51200);
      expect(scaled.capsule.budgetProfile.zeroHopSourceBudgetTokens).toBe(20480);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('check-node 四重微门禁精准拦截违规，且 --receipt 正向通过 <=12行/<=512字符落盘、反向失败带完整原因与退出码尾标', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-checknode-'));
    try {
      dispatchCommand(['init', '.'], dir);
      writeFileSync(join(dir, '.gitignore'), '.donegate/\nHANDOVER.md\n');
      mkdirSync(join(dir, 'src/db'), { recursive: true });
      mkdirSync(join(dir, 'src/order'), { recursive: true });
      mkdirSync(join(dir, 'src/other'), { recursive: true });

      writeFileSync(join(dir, 'src/db/private.mjs'), 'export const raw = () => "raw";\n');
      writeFileSync(join(dir, 'src/db/index.mjs'), 'import { raw } from "./private.mjs";\nexport function findItem(id) { return `${raw()}:${id}`; }\n');
      writeFileSync(join(dir, 'src/order/index.mjs'), 'import { findItem } from "../db/index.mjs";\nexport function loadOrder(id) { return findItem(id); }\n');
      writeFileSync(join(dir, 'src/other/side.mjs'), 'export const side = () => 42;\n');

      dispatchCommand(['contract', 'new', 'db-node', '--title', 'DB', '--scope', 'src/db/'], dir);
      dispatchCommand(['contract', 'new', 'order-node', '--title', 'Order', '--scope', 'src/order/', '--depends-on', 'db-node'], dir);
      dispatchCommand(['contract', 'new', 'other-node', '--title', 'Other', '--scope', 'src/other/'], dir);

      const orderContractPath = join(dir, 'contracts/order-node/contract.json');
      const oc = JSON.parse(readFileSync(orderContractPath, 'utf8'));
      oc.why = '订单查询';
      oc.obligations = [{
        id: 'order-unit',
        kind: 'command',
        command: 'node --input-type=module -e "import { loadOrder } from \'./src/order/index.mjs\'; if (loadOrder(7) !== \'raw:7\') process.exit(1);"',
        expect: { exitCode: 0 },
        required: true,
        claim: '返回拼接结果',
        observable: 'exit 0',
        scope: 'src/order/',
        inputClasses: ['正常'],
        servesSuccessCriterion: 'ok'
      }];
      writeFileSync(orderContractPath, JSON.stringify(oc, null, 2));
      initGitRepo(dir);

      dispatchCommand(['slice', 'order-node', '--freeze-stub'], dir);
      const okRun = dispatchCommand(['check-node', 'order-node', '--receipt'], dir);
      expect(okRun.exitCode).toBe(0);
      expect(okRun.stdout.split('\n').length).toBeLessThanOrEqual(12);
      expect(okRun.stdout.length).toBeLessThanOrEqual(512);
      const okReceipt = JSON.parse(okRun.stdout);
      expect(okReceipt.verdict).toBe('PASS');
      expect(okReceipt.stubHash).toMatch(/^[0-9a-f]{64}$/);
      expect(okReceipt.sessionBudgetTokens).toBe(400000);
      expect(okReceipt.passedObligations).toEqual(['order-unit']);
      expect(Math.ceil(okRun.stdout.length / 4)).toBeLessThan(okReceipt.receiptBudgetTokens);
      const diskReceipt = JSON.parse(readFileSync(join(dir, '.donegate/capsules/order-node.receipt.json'), 'utf8'));
      expect(diskReceipt.stubHash).toBe(okReceipt.stubHash);
      expect(diskReceipt.passedObligations).toEqual(['order-unit']);

      writeFileSync(join(dir, 'src/other/side.mjs'), 'export const side = () => 99;\n');
      const dirtyReceiptRun = dispatchCommand(['check-node', 'order-node', '--receipt'], dir);
      expect(dirtyReceiptRun.exitCode).toBe(3);
      expect(dirtyReceiptRun.stderr).toBe('');
      expect(dirtyReceiptRun.stdout).toContain('"exitCode":3');
      expect(dirtyReceiptRun.stdout).toContain('工作区存在未提交改动');
      expect(dirtyReceiptRun.stdout.endsWith('\n[exit code: 3]')).toBe(true);

      const outScopeRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty'], dir);
      expect(outScopeRun.exitCode).toBe(1);
      expect(outScopeRun.stderr).toContain('越界修改非本卡 scope 文件');
      const outScopeReceiptRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty', '--receipt'], dir);
      expect(outScopeReceiptRun.exitCode).toBe(1);
      expect(outScopeReceiptRun.stderr).toBe('');
      expect(outScopeReceiptRun.stdout).toContain('"exitCode":1');
      expect(outScopeReceiptRun.stdout).toContain('越界修改非本卡 scope 文件：src/other/side.mjs');
      expect(outScopeReceiptRun.stdout.endsWith('\n[exit code: 1]')).toBe(true);
      writeFileSync(join(dir, 'src/other/side.mjs'), 'export const side = () => 42;\n');

      writeFileSync(join(dir, 'src/order/index.mjs'), 'import { findItem } from "../db/index.mjs";\nexport function loadOrder(id, extraRequiredFlag) { return findItem(id) || extraRequiredFlag; }\n');
      const brokenSigRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty'], dir);
      expect(brokenSigRun.exitCode).toBe(1);
      expect(brokenSigRun.stderr).toContain('篡改已冻结导出签名');
      const allowedSigRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty', '--allow-stub-change'], dir);
      expect(allowedSigRun.exitCode).toBe(0);

      writeFileSync(join(dir, 'src/order/index.mjs'), 'import { raw } from "../db/private.mjs";\nexport function loadOrder(id, extraRequiredFlag) { return `${raw()}:${id}` || extraRequiredFlag; }\n');
      const facadeBreakRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty'], dir);
      expect(facadeBreakRun.exitCode).toBe(1);
      expect(facadeBreakRun.stderr).toContain('越过门面私引邻居内部实现');

      writeFileSync(join(dir, 'src/order/index.mjs'), 'import { findItem } from "../db/index.mjs";\nimport { side } from "../other/side.mjs";\nexport function loadOrder(id, extraRequiredFlag) { void side; return findItem(id) || extraRequiredFlag; }\n');
      const redEdgeRun = dispatchCommand(['check-node', 'order-node', '--allow-dirty'], dir);
      expect(redEdgeRun.exitCode).toBe(1);
      expect(redEdgeRun.stderr).toContain('未声明跨卡红线依赖');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('100% 自举验证：母仓全部 7 张契约卡均零截断装入 160k 胶囊且零红线/零越界门面私引，公开精简仓支持画布零契约切片', () => {
    if (existsSync(join(REPO_ROOT, 'contracts/gate-tooling/contract.json'))) {
      const res = dispatchCommand(['slice', '--router-only', '--json'], REPO_ROOT);
      expect(res.exitCode).toBe(0);
      expect(res.router.nodes.length).toBe(7);
      expect(res.router.budgetProfile.totalSessionBudgetTokens).toBe(400000);
      expect(res.router.topoOrder).toContain('atlas-workbench');
      expect(res.router.topoOrder).toContain('dsh-orchestrator');
      expect(res.router.redImports).toEqual([]);
      expect(res.router.facadeViolations).toEqual([]);
      expect(res.router.savingsPct).toBeGreaterThan(95);

      for (const n of res.router.nodes) {
        const cap = dispatchCommand(['slice', n.id, '--json'], REPO_ROOT);
        expect(cap.exitCode).toBe(0);
        expect(cap.capsule.truncatedFiles).toEqual([]);
        expect(cap.capsule.capsuleTokens).toBeLessThanOrEqual(cap.capsule.budgetProfile.capsuleInitialMaxTokens);
        expect(Array.isArray(cap.capsule.toc)).toBe(true);
        const capLines = readFileSync(join(REPO_ROOT, '.donegate/capsules', `${n.id}.capsule.md`), 'utf8').split('\n');
        for (const entry of cap.capsule.toc.filter((e) => e.startLine !== null)) {
          expect(capLines[entry.startLine - 1]).toContain('### ');
          expect(capLines[entry.endLine - 1]).toBe('```');
        }
      }

      const fullDsh = dispatchCommand(['slice', 'dsh-orchestrator', '--json'], REPO_ROOT);
      const focusCap = dispatchCommand(['slice', 'dsh-orchestrator', '--focus', 'quote-protocol.mjs', '--json'], REPO_ROOT);
      expect(focusCap.exitCode).toBe(0);
      expect(focusCap.capsule.focusMode).toBe(true);
      const expandedPaths = focusCap.capsule.zeroHopFiles.map((f) => f.path);
      // 准确率第一：目标文件 + 同卡被调方(win-paths) + 同卡调用方(host-routes/campaign-autopilot) + 桶门面(contract/index) 必须完整纳入全量闭包
      expect(expandedPaths).toEqual(expect.arrayContaining([
        'runner/dsh/quote-protocol.mjs',
        'runner/dsh/win-paths.mjs',
        'runner/dsh/host-routes.mjs',
        'runner/dsh/campaign-autopilot.mjs',
        'runner/dsh/contract.mjs',
        'runner/dsh/index.mjs'
      ]));
      // 必跑测试夹具不得被盲目隐藏，正交零耦合兄弟文件（如 ui-board-engine / workflow-jit）自动折叠为 AST 存根
      expect(focusCap.capsule.zeroHopTests.map((t) => t.path)).toContain('runner/dsh-fixtures.mjs');
      expect(focusCap.capsule.siblingStubFiles.map((s) => s.path)).toContain('runner/dsh/ui-board-engine.mjs');
      expect(focusCap.capsule.siblingStubFiles.length).toBeGreaterThan(15);
      expect(focusCap.capsule.capsuleTokens).toBeLessThan(Math.round(fullDsh.capsule.capsuleTokens * 0.55));
      const focusMd = readFileSync(join(REPO_ROOT, '.donegate/capsules/dsh-orchestrator.capsule.md'), 'utf8');
      expect(focusMd).toContain('0-Hop 同卡正交兄弟文件 AST 存根与行数余量');
      expect(focusMd).toContain('双层桶防环');

      const badFocus = dispatchCommand(['slice', 'dsh-orchestrator', '--focus', 'nonexistent-ghost-file.mjs'], REPO_ROOT);
      expect(badFocus.exitCode).toBe(3);
    } else {
      const emptyRes = dispatchCommand(['slice', '--router-only'], REPO_ROOT);
      expect(emptyRes.exitCode).toBe(3);

      mkdirSync(join(REPO_ROOT, '.donegate'), { recursive: true });
      writeFileSync(join(REPO_ROOT, '.donegate/workbench-state.json'), JSON.stringify({
        nodes: [
          { id: 'core-mod', name: '判定核核心', scopes: ['runner/core/'] },
          { id: 'adapter-pool', name: '适配器池', scopes: ['skill/adapters/'] }
        ],
        links: []
      }, null, 2));
      try {
        const wbRes = dispatchCommand(['slice', 'core-mod', '--json'], REPO_ROOT);
        expect(wbRes.exitCode).toBe(0);
        expect(wbRes.capsule.truncatedFiles).toEqual([]);
        expect(wbRes.capsule.omittedTwoHopNodes).toContain('adapter-pool');
      } finally {
        rmSync(join(REPO_ROOT, '.donegate'), { recursive: true, force: true });
      }
    }
  });
});
