#!/usr/bin/env node
// 适配器普适填空式脚手架生成器（支持六大普适开源项目形态：诊断探针 / 工件生成 / 带UI去壳提取 / 运行时服务与状态 / 知识规则包 / 多源归并）
//
// 用法：
//   node skill/new-adapter.mjs <tool-name> [--archetype scanner|generator|ui-extract|runtime-service|knowledge-skill|aggregator] [--bin <bin>] [--role soft|hard] [--print] [--card-json] [--out <file>]
//   node skill/new-adapter.mjs --self-test
// 退出码（§八 四值）：0 生成成功 / 1 参数非法或目标已存在 / 3 写入失败
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

export const ARCHETYPES = ['scanner', 'generator', 'ui-extract', 'runtime-service', 'knowledge-skill', 'aggregator'];

export function renderCardTemplate({ tool, archetype = 'scanner', repo = `owner/${tool}` }) {
  const portPresets = {
    scanner: {
      cat: '代码护栏', extract: 'cli',
      in: [{ id: 'in_src', name: '源码或构建快照', type: 'ARTIFACT' }],
      out: [{ id: 'out_sig', name: '0-3 判定码', type: 'SIGNAL' }, { id: 'out_obs', name: '结构化观测报告', type: 'TEXT' }]
    },
    generator: {
      cat: '端侧与构建', extract: 'cli',
      in: [{ id: 'in_spec', name: '规格或模型定义', type: 'SPEC' }],
      out: [{ id: 'out_art', name: '生成产物清单', type: 'ARTIFACT' }, { id: 'out_sig', name: '落盘校验码', type: 'SIGNAL' }]
    },
    'ui-extract': {
      cat: '端侧与构建', extract: 'headless-export',
      in: [{ id: 'in_spec', name: '组件或令牌输入', type: 'SPEC' }],
      out: [{ id: 'out_art', name: '无头提取产物', type: 'ARTIFACT' }, { id: 'out_obs', name: '快照摘要', type: 'TEXT' }]
    },
    'runtime-service': {
      cat: '安全与运维', extract: 'http-or-probe',
      in: [{ id: 'in_flow', name: '流程或迁移输入', type: 'FLOW' }],
      out: [{ id: 'out_sig', name: '探针状态码', type: 'SIGNAL' }, { id: 'out_obs', name: '状态机/轨迹快照', type: 'TEXT' }]
    },
    'knowledge-skill': {
      cat: '规划与设计', extract: 'skill-prompt',
      in: [{ id: 'in_req', name: '待决策功能清单', type: 'SPEC' }],
      out: [{ id: 'out_prm', name: '子代理规则约束', type: 'PROMPT' }, { id: 'out_spec', name: '决策映射表', type: 'SPEC' }]
    },
    aggregator: {
      cat: '安全与运维', extract: 'artifact-merge',
      in: [{ id: 'in_multi', name: '多源扫描报告集', type: 'ARTIFACT' }],
      out: [{ id: 'out_art', name: '去重归并清单', type: 'ARTIFACT' }, { id: 'out_sig', name: '聚合判定码', type: 'SIGNAL' }]
    }
  };
  const p = portPresets[archetype] || portPresets.scanner;
  return JSON.stringify({
    tool,
    registryId: `${tool}@stage4`,
    archetype,
    upstream: { repo, extractMode: p.extract },
    card: {
      title: `${tool} 模块卡`,
      category: p.cat,
      inputs: p.in,
      outputs: p.out,
      slots: [{ id: 'slot_main', label: `${tool} 核心能力`, wired: true, boundOut: p.out[0].id }]
    },
    observables: [{ id: 'primary', from: 'primary', kind: archetype === 'generator' ? 'artifact' : 'count', assertableAs: ['non-empty'], wired: false, reason: '默认先以建议模式接入，确认稳定后绑定契约判据' }],
    requiresProject: [],
    blindSpots: [`请按 P4 原则填写 ${tool} 明确不覆盖的边界`],
    disposition: { state: 'advisory', reason: '新接入待业务契约认领' }
  }, null, 2) + '\n';
}

export function renderAdapterScaffold({ tool, bin = tool, role = 'soft', archetype = 'scanner' }) {
  if (archetype === 'knowledge-skill' || archetype === 'aggregator') {
    const mode = archetype === 'knowledge-skill' ? 'knowledge' : 'artifact';
    const targetFlag = archetype === 'knowledge-skill' ? '--rules-file' : '--reports';
    return `// 适配器 · ${tool}（形态：${archetype} · 免外部二进制，委托 ./_shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: '${tool}',
  mode: '${mode}',
  defaultRole: '${role}',
  degradedTo: '人工核对上游规则文件或分项扫描报告并按同一字段手工归档',
  collect(ctx) {
    const srcRel = ctx.arg('${targetFlag}', 'README.md');
    const files = ctx.hashInputFiles(ctx.rootDir, srcRel.split(',').map((s) => s.trim()).filter(Boolean), '输入源');
    const observation = { archetype: '${archetype}', sourceCount: files.length, sources: files.map((f) => f.path) };
    return {
      inputs: files,
      rawJson: observation,
      observation,
      claimText: \`${tool} (\${ctx.toolVer}) 已封存 \${files.length} 份输入源指纹，明细见 \${ctx.obsRelPath}\`,
      summaryLog: \`sources=\${files.length}\`
    };
  }
});
`;
  }
  if (archetype === 'generator' || archetype === 'ui-extract') {
    return `// 适配器 · ${tool}（形态：${archetype} · 去壳取核/产物落盘验真，委托 ./_shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: '${tool}',
  defaultBin: '${bin}',
  defaultRole: '${role}',
  versionArgs: ['--version'],
  degradedTo: '人工导出对应无头静态产物并核对文件非空与哈希',
  collect(ctx) {
    const outRel = ctx.arg('--artifact', 'dist/output.json');
    if (ctx.readRawOverride('--raw-report') === null && ctx.runBin) {
      const r = ctx.runBin(ctx.arg('--args', 'build').split(' ').filter(Boolean));
      if (r.error || r.status !== 0) ctx.fail(3, '${tool} 无头构建/导出失败：' + (r.stderr || r.error?.message || ''));
    }
    const produced = ctx.hashInputFiles(ctx.rootDir, [outRel], '导出产物');
    const observation = { archetype: '${archetype}', artifactCount: produced.length, totalBytes: produced[0].bytes };
    return {
      extraArtifacts: [{ path: outRel, kind: '${tool}-export' }],
      rawJson: observation,
      observation,
      claimText: \`${tool} \${ctx.toolVer} 已提取无头产物 \${outRel} (\${produced[0].bytes} B)，明细见 \${ctx.obsRelPath}\`,
      summaryLog: \`bytes=\${produced[0].bytes}\`
    };
  }
});
`;
  }
  return `// 适配器 · ${tool}（形态：${archetype} · 客观观测采集，委托 ./_shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: '${tool}',
  defaultBin: '${bin}',
  defaultRole: '${role}',
  versionArgs: ['--version'],
  degradedTo: '人工按同一字段口径核查上游输出并记录客观计数',
  collect(ctx) {
    let rawText = ctx.readRawOverride('--raw-report');
    if (rawText === null) {
      const targetDir = ctx.arg('--target', '.');
      const r = ctx.runBin(['--format', 'json', targetDir]);
      if (r.error || (r.status !== 0 && r.status !== 1)) {
        ctx.fail(3, '${tool} 执行失败：' + (r.stderr || r.error?.message || ''));
      }
      rawText = r.stdout || '';
    }
    const parsed = ctx.parseJsonOrFail(rawText, '${tool}');
    if (!parsed || typeof parsed !== 'object') ctx.fail(3, '${tool} 报告结构非法');
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
    const observation = { archetype: '${archetype}', itemCount: items.length };
    return {
      rawJson: parsed,
      observation,
      claimText: \`${tool} \${ctx.toolVer} 对 \${ctx.arg('--target', '.')} 检出条目 \${observation.itemCount} 项，明细见 \${ctx.obsRelPath}\`,
      summaryLog: \`items=\${observation.itemCount}\`
    };
  }
});
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    let ok = true;
    for (const arch of ARCHETYPES) {
      const sample = renderAdapterScaffold({ tool: 'demo-tool', bin: 'demo', role: 'soft', archetype: arch });
      const card = JSON.parse(renderCardTemplate({ tool: 'demo-tool', archetype: arch }));
      const lines = sample.trimEnd().split(/\r?\n/).length;
      if (!sample.includes("from './_shared.mjs'") || sample.includes('node:crypto') || sample.includes('node:child_process') || lines > 45 || !card.card.inputs.length) {
        ok = false;
      }
    }
    console.log(ok ? `RESULT: PASS 六大普适形态脚手架与模块化卡片模板自检全过（均 ≤ 45 行，零底层原语直引）` : 'RESULT: FAIL 脚手架自检失败');
    process.exit(ok ? 0 : 1);
  }
  const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const tool = argv.find((a) => !a.startsWith('--'));
  const archetype = arg('--archetype', 'scanner');
  if (!tool || !/^[a-z0-9-]+$/.test(tool) || !ARCHETYPES.includes(archetype)) {
    console.error(`用法：node skill/new-adapter.mjs <tool-name> [--archetype ${ARCHETYPES.join('|')}] [--bin <bin>] [--role soft|hard] [--print] [--card-json] [--out <file>]`);
    process.exit(1);
  }
  if (argv.includes('--card-json')) {
    process.stdout.write(renderCardTemplate({ tool, archetype, repo: arg('--repo', `owner/${tool}`) }));
    process.exit(0);
  }
  const role = arg('--role', 'soft');
  if (role !== 'soft' && role !== 'hard') { console.error('--role 只能为 soft 或 hard'); process.exit(1); }
  const code = renderAdapterScaffold({ tool, bin: arg('--bin', tool), role, archetype });
  if (argv.includes('--print')) { process.stdout.write(code); process.exit(0); }
  const out = resolve(arg('--out', join(REPO, 'skill', 'adapters', `${tool}-scan.mjs`)));
  if (existsSync(out)) { console.error('拒绝覆盖已存在的适配器文件：' + out); process.exit(1); }
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code, 'utf8');
    console.log(`已生成 [${archetype}] 形态薄适配器骨架：${out}`);
    process.exit(0);
  } catch (e) {
    console.error('写入失败：' + e.message);
    process.exit(3);
  }
}
