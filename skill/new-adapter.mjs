#!/usr/bin/env node
// 砂浆适配器填空式脚手架生成器（源头防手搓：一键产出调用 ./_shared.mjs 的 ≤45 行标准薄适配器骨架）
//
// 用法：
//   node skill/new-adapter.mjs <tool-name> [--bin <bin>] [--role soft|hard] [--print] [--out <file>]
//   node skill/new-adapter.mjs --self-test
// 退出码（§八 四值）：0 生成成功 / 1 参数非法或目标已存在 / 3 写入失败
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

export function renderAdapterScaffold({ tool, bin = tool, role = 'soft' }) {
  return `// 砂浆适配器 · ${tool} 观测（Mortar Protocol v1.1 · 委托 ./_shared.mjs 统一运行器，禁止直引底层子进程或哈希原语）
import { runMortarAdapter } from './_shared.mjs';

runMortarAdapter({
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
    const observation = { itemCount: items.length };
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
    const sample = renderAdapterScaffold({ tool: 'demo-tool', bin: 'demo', role: 'soft' });
    const lines = sample.trimEnd().split(/\r?\n/).length;
    const ok = sample.includes("from './_shared.mjs'") && !sample.includes('node:crypto') && !sample.includes('node:child_process') && lines <= 45;
    console.log(ok ? `RESULT: PASS 适配器脚手架自检通过（生成 ${lines} 行 ≤ 45 行，零底层原语直引）` : 'RESULT: FAIL 脚手架自检失败');
    process.exit(ok ? 0 : 1);
  }
  const arg = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const tool = argv.find((a) => !a.startsWith('--'));
  if (!tool || !/^[a-z0-9-]+$/.test(tool)) {
    console.error('用法：node skill/new-adapter.mjs <tool-name> [--bin <bin>] [--role soft|hard] [--print] [--out <file>]');
    process.exit(1);
  }
  const role = arg('--role', 'soft');
  if (role !== 'soft' && role !== 'hard') { console.error('--role 只能为 soft 或 hard'); process.exit(1); }
  const code = renderAdapterScaffold({ tool, bin: arg('--bin', tool), role });
  if (argv.includes('--print')) {
    process.stdout.write(code);
    process.exit(0);
  }
  const out = resolve(arg('--out', join(REPO, 'skill', 'adapters', `${tool}-scan.mjs`)));
  if (existsSync(out)) {
    console.error('拒绝覆盖已存在的适配器文件：' + out);
    process.exit(1);
  }
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code, 'utf8');
    console.log('已生成薄适配器骨架：' + out);
    process.exit(0);
  } catch (e) {
    console.error('写入失败：' + e.message);
    process.exit(3);
  }
}
