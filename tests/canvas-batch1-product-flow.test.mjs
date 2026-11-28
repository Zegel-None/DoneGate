import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchCommand } from '../runner/donegate.mjs';
import { MAX_PRODUCT_FLOW_DEPTH, isInfraContract, validateProductFlowGraph } from '../runner/shared/product-flow-schema.mjs';
import { validateContractSchema } from '../skill/schema-lite.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Canvas-Batch 1: 3-level product flow schema & infra contract separation', () => {
  it('enforces MAX_PRODUCT_FLOW_DEPTH = 3, mandatory L2 initialStepId, guard leaf rule, anti-duplicate ancestor titles, and L1 DAG acyclicity', () => {
    expect(MAX_PRODUCT_FLOW_DEPTH).toBe(3);

    const badFns = [
      {
        id: 'f-a',
        title: '订单结算主流程',
        after: ['f-b', 'ghost-stage'],
        subflows: [
          {
            id: 'sub-dup',
            title: '订单结算主流程',
            steps: [
              {
                id: 'st-1',
                title: '风控守卫门',
                kind: 'guard',
                steps: [{ id: 'grandchild-4', title: '违规第四层曾孙图' }],
                next: ['missing-step']
              }
            ]
          }
        ]
      },
      {
        id: 'f-b',
        title: '履约发货',
        after: ['f-a']
      }
    ];

    const issues = validateProductFlowGraph(badFns);
    const codes = issues.map((x) => x.code);
    expect(codes).toContain('DUPLICATE_ANCESTOR_TITLE');
    expect(codes).toContain('MISSING_INITIAL_STEP');
    expect(codes).toContain('GUARD_CHILDREN_FORBIDDEN');
    expect(codes).toContain('DANGLING_EDGE_TARGET');
    expect(codes).toContain('L1_FLOW_CYCLE');
  });

  it('validates role="infra" in contract schema and exempts infra contracts from orphanContracts while blocking status --flow on schema violations', () => {
    expect(isInfraContract({ id: 'base', role: 'infra' })).toBe(true);
    expect(isInfraContract({ id: 'base', role: 'infra', retired: { at: '2026-11-28' } })).toBe(false);
    expect(validateContractSchema({ id: 'c-infra', role: 'infra', obligations: [] }, { full: false })).toEqual([]);
    expect(validateContractSchema({ id: 'c-bad', role: 'invalid', obligations: [] }, { full: false }).some((e) => e.includes('/role'))).toBe(true);

    const tmp = mkdtempSync(join(tmpdir(), 'dg-cb1-proj-'));
    try {
      dispatchCommand(['init', '.'], tmp);
      mkdirSync(join(tmp, 'src'), { recursive: true });
      writeFileSync(join(tmp, 'src/app.mjs'), 'export const run = () => 1;\n', 'utf8');
      dispatchCommand(['contract', 'new', 'prod-checkout', '--title', '结账业务', '--scope', 'src/'], tmp);
      dispatchCommand(['contract', 'new', 'infra-logger', '--title', '日志底座', '--scope', 'src/'], tmp);

      const infraPath = join(tmp, 'contracts/infra-logger/contract.json');
      writeFileSync(
        infraPath,
        JSON.stringify({ id: 'infra-logger', title: '日志底座', role: 'infra', why: '公共日志', scope: ['src/'], owner: '业主', provisional: true, obligations: [] }, null, 2),
        'utf8'
      );

      mkdirSync(join(tmp, 'functions'), { recursive: true });
      writeFileSync(
        join(tmp, 'functions/f01-checkout.json'),
        JSON.stringify({
          id: 'f01-checkout',
          title: '客户下单结账',
          order: 1,
          source: '业主原话：客户点一下就能付完款看到回执。',
          contracts: ['prod-checkout'],
          subflows: [
            {
              id: 's1-pay',
              title: '创建支付单与回执校验',
              initialStepId: 'k1',
              steps: [
                { id: 'k1', title: '提交订单金额', kind: 'step', next: ['k2'] },
                { id: 'k2', title: '核验支付回执签名', kind: 'guard', next: [] }
              ]
            }
          ]
        }, null, 2),
        'utf8'
      );

      const stOk = dispatchCommand(['status', '--tree', '--flow'], tmp);
      expect(stOk.exitCode).toBe(0);
      expect(stOk.status.orphanContracts).toEqual([]);
      expect(stOk.status.infraContracts).toEqual(['infra-logger']);
      expect(stOk.stdout).toContain('底座支撑仓（role=infra，共 1 个：infra-logger）');
      expect(stOk.stdout).toContain('[L2子流×1]');

      writeFileSync(
        join(tmp, 'functions/f01-checkout.json'),
        JSON.stringify({
          id: 'f01-checkout',
          title: '客户下单结账',
          source: '业主原话：客户点一下就能付完款看到回执。',
          contracts: ['prod-checkout'],
          subflows: [
            {
              id: 's1-pay',
              title: '创建支付单与回执校验',
              initialStepId: 'k1',
              steps: [
                { id: 'k1', title: '越界节点', kind: 'step', subflows: [{ id: 'lvl4', title: '曾孙流程图' }] }
              ]
            }
          ]
        }, null, 2),
        'utf8'
      );
      const stBad = dispatchCommand(['status', '--flow'], tmp);
      expect(stBad.exitCode).toBe(1);
      expect(stBad.stderr).toContain('产品流三层契约违规拒绝渲染流程图');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('verifies DoneGate mother repo 6-stage product map has zero orphan contracts, zero schema issues, and valid L1->L2->L3 DAG', () => {
    if (!existsSync(join(REPO_ROOT, 'contracts')) || !existsSync(join(REPO_ROOT, 'functions'))) {
      return;
    }
    const res = dispatchCommand(['status', '--tree', '--flow'], REPO_ROOT);
    expect(res.exitCode).toBe(0);
    expect(res.status.functions.length).toBe(6);
    expect(res.status.orphanContracts).toEqual([]);
    expect(res.status.orphanFunctions).toEqual([]);
    expect(res.status.badSourceFunctions).toEqual([]);
    expect(res.status.flowSchemaIssues).toEqual([]);
    expect(res.status.infraContracts).toEqual(['shared-deps-pool', 'shared-primitives']);
    expect(res.stdout).toContain('f01-product-blueprint -->|after| f02-brick-forge-and-adapters');
    expect(res.stdout).toContain('f05-human-product-canvas -->|after| f06-sealed-release-delivery');
  });
});
