#!/usr/bin/env node
// 全量界面与工程名词归一化硬门禁（拦截「开发流 / 工作流语境的宏 / 未归一化开发包与方案包 / 导航栏资产」四类口语漂移词）
//
// 为什么要有它：
//   业主与 AI 对话时常使用打比方或早期过渡词（如把工作流比作「宏」、早期的「开发流 / 开发包 / 护栏包」、把项目导航叫「资产」）。
//   若不设全量机械门禁，不同子代理会在 UI、契约、工作流 JSON 与技能文档中各自混用多套叫法，造成产品概念分裂。
//
// 用法：
//   node skill/check-terminology.mjs                          # 扫描本仓默认活跃研发与产品范围
//   node skill/check-terminology.mjs --root <dir>             # 指定扫描仓库根目录（兼容 --project <dir>）
//   node skill/check-terminology.mjs --scope a,b,c            # 仅扫描逗号分隔的相对路径子集
//   node skill/check-terminology.mjs --red-self-test          # 必红负样本 + 修正后正样本双向自检
//
// 退出码（§八 四值）：0 零违规或自检全过 / 1 检出未归一化漂移词或自检失败 / 3 根目录不存在
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChecks } from './assert.mjs';
import { walk } from './fs-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

export const DEFAULT_TERM_TARGETS = [
  'runner', 'skill', 'workflows', 'bricks', 'contracts',
  'donegate', 'donegate-forge', 'donegate-judge', '.dsh/skills',
  'functions', 'AGENTS.md', 'README.md',
  'docs/public-README.md', 'docs/public-AGENTS.md', 'docs/功能总览.md',
  'ledger.json', 'tests'
];

const SKIP_DIR_NAMES = [
  '.git', 'node_modules', '.donegate', '.deps', '.stryker-tmp', 'reports', 'coverage',
  'dist', '_dist', '参考', '设计', 'decisions', '证据', '归档'
];
const SKIP_REL_PREFIXES = ['docs/archive/', 'workflows/.deps/'];
const SKIP_REL_FILES = new Set([
  'skill/check-terminology.mjs', 'docs/变更登记-接手后.md', 'docs/dist-README.md',
  'CHANGELOG.md', 'escapes.jsonl', 'HANDOFF.md'
]);
const TEXT_EXT_RE = /\.(?:mjs|cjs|js|ts|tsx|jsx|json|md|html|css|yml|yaml|cmd|sh|txt)$/i;

export const TERMINOLOGY_RULES = [
  {
    id: 'no-kaifaliu',
    pattern: /开发流/g,
    replacement: '工作流',
    message: '禁止使用未归一化旧词「开发流」→ 请统一改为「工作流」'
  },
  {
    id: 'no-workflow-macro',
    pattern: /(?:预置|套用此|套用|全局|沉淀为|另存为|保存为|项目沉淀|派生|打底|基准|私有|存)宏|宏(?:打底|包|模板|列表|选配)/g,
    replacement: '工作流',
    message: '禁止用口语比喻词「宏」指代工作流 → 请统一改为「工作流」'
  },
  {
    id: 'no-workflow-pack',
    pattern: /(?:新)?开发包(?!含|括)|护栏包|守护包|联防包|润色包|预设包|(?:工作流)?方案包|工作流包(?!含|括)|持久化包/g,
    replacement: '工作流',
    message: '禁止用「开发包 / 护栏包 / 守护包 / 联防包 / 润色包 / 预设包 / 工作流包 / 方案包」指代工作流 → 请统一改为「工作流」'
  },
  {
    id: 'no-asset-nav-label',
    pattern: /(?:rail-label[^>]*>\s*资产|tb:资产|['"]资产：查看|快捷图标栏（资产)/g,
    replacement: '项目',
    message: '禁止用「资产」指代项目导航栏或项目看板入口 → 请统一改为「项目」'
  }
];

function parseTermCliArgs(argv) {
  const getTermOpt = (flag, fallback = null) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--') ? argv[idx + 1] : fallback;
  };
  const scopeRaw = getTermOpt('--scope', '');
  const scopes = scopeRaw
    ? scopeRaw.split(',').map((s) => s.trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean)
    : null;
  const rootArg = getTermOpt('--root', getTermOpt('--project', REPO));
  return { root: resolve(rootArg), scopes, redSelfTest: argv.includes('--red-self-test') };
}

function collectTermTargetFiles(root, scopes = null) {
  const targets = scopes && scopes.length > 0 ? scopes : DEFAULT_TERM_TARGETS;
  const seen = new Set();
  const out = [];
  const acceptTermFile = (absPath) => {
    const rel = relative(root, absPath).split(sep).join('/');
    if (!rel || rel.startsWith('..') || seen.has(rel)) return;
    if (!TEXT_EXT_RE.test(rel) || SKIP_REL_FILES.has(rel)) return;
    if (SKIP_REL_PREFIXES.some((p) => rel.startsWith(p))) return;
    seen.add(rel);
    out.push({ absPath, rel });
  };
  for (const item of targets) {
    const abs = resolve(root, item);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) acceptTermFile(abs);
    else if (st.isDirectory()) {
      for (const f of walk(abs, { skipDirs: SKIP_DIR_NAMES }).files) acceptTermFile(f);
    }
  }
  return out;
}

export function scanTerminologyViolations(root, opts = {}) {
  if (!existsSync(root)) {
    return { exitCode: 3, scannedFiles: 0, violations: [], error: `根目录不存在：${root}` };
  }
  const files = collectTermTargetFiles(root, opts.scopes || null);
  const violations = [];
  for (const { absPath, rel } of files) {
    const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.includes('dg-term-allow')) continue;
      for (const rule of TERMINOLOGY_RULES) {
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        const matches = [...line.matchAll(re)].map((m) => m[0]);
        if (matches.length > 0) {
          violations.push({
            ruleId: rule.id, file: rel, line: i + 1, matches,
            replacement: rule.replacement, message: rule.message,
            excerpt: line.trim().slice(0, 120)
          });
        }
      }
    }
  }
  return { exitCode: violations.length > 0 ? 1 : 0, scannedFiles: files.length, violations };
}

function runTerminologyRedSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'dg-term-red-'));
  const c = createChecks();
  try {
    mkdirSync(join(tmp, 'runner'), { recursive: true });
    mkdirSync(join(tmp, 'workflows'), { recursive: true });
    mkdirSync(join(tmp, 'decisions'), { recursive: true });
    writeFileSync(join(tmp, 'decisions/2026-11-20-hist.md'), '历史决策含开发流、新开发包与预置宏不扫\n', 'utf8');
    writeFileSync(join(tmp, 'workflows/demo.workflow.json'), JSON.stringify({
      group: '预置全周期开发流', action: '套用此宏', packLabel: '另存当前为新开发包'
    }, null, 2) + '\n', 'utf8');
    writeFileSync(join(tmp, 'runner/nav.mjs'), [
      'export const nav = \'<span class="rail-label">资产</span>\';',
      'export const safeWords = "宏观架构、纯规则资产、APK 安装包、发行包、源码包、复核包、交接包、压缩包、工作流包含、开发包含均不误伤";',
      'export const compat = "开发流"; // dg-term-allow: 历史字段读取兼容断言'
    ].join('\n') + '\n', 'utf8');

    const redRes = scanTerminologyViolations(tmp);
    const hitIds = new Set(redRes.violations.map((v) => v.ruleId));
    c.check('必红样本：精准检出 no-kaifaliu / no-workflow-macro / no-workflow-pack / no-asset-nav-label 四类违规且退 1',
      redRes.exitCode === 1 && redRes.violations.length === 4 &&
      hitIds.has('no-kaifaliu') && hitIds.has('no-workflow-macro') &&
      hitIds.has('no-workflow-pack') && hitIds.has('no-asset-nav-label'),
      JSON.stringify(redRes.violations));

    writeFileSync(join(tmp, 'workflows/demo.workflow.json'), JSON.stringify({
      group: '预置全周期工作流', action: '套用此工作流', packLabel: '另存当前为新工作流'
    }, null, 2) + '\n', 'utf8');
    writeFileSync(join(tmp, 'runner/nav.mjs'), [
      'export const nav = \'<span class="rail-label">项目</span>\';',
      'export const safeWords = "宏观架构、纯规则资产、APK 安装包、发行包、源码包、复核包、交接包、压缩包、工作流包含、开发包含均不误伤";',
      'export const compat = "开发流"; // dg-term-allow: 历史字段读取兼容断言'
    ].join('\n') + '\n', 'utf8');

    const greenRes = scanTerminologyViolations(tmp);
    c.check('正样本回归：归一化为「工作流」与「项目」后退 0（且安装包/发行包/复核包/包含短语零误报）',
      greenRes.exitCode === 0 && greenRes.violations.length === 0,
      JSON.stringify(greenRes.violations));
  } finally {
    try { if (process.platform !== 'win32') rmSync(tmp, { recursive: true, force: true }); } catch (err) { void err; }
  }
  if (c.bad > 0) {
    console.error(`RESULT: FAIL 名词归一化必红自检 ${c.bad} 项未过`);
    return 1;
  }
  console.log('RESULT: PASS 名词归一化门禁与必红自检全过');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cli = parseTermCliArgs(process.argv.slice(2));
  if (!existsSync(cli.root)) {
    console.error(`根目录不存在：${cli.root}`);
    process.exit(3);
  }
  if (cli.redSelfTest) process.exit(runTerminologyRedSelfTest());
  const res = scanTerminologyViolations(cli.root, { scopes: cli.scopes });
  if (res.exitCode !== 0) {
    console.log(`=== 名词归一化门禁拦截（扫描 ${res.scannedFiles} 个文件，检出 ${res.violations.length} 处漂移） ===`);
    for (const v of res.violations) {
      console.log(`  ✗ [${v.ruleId}] ${v.file}:${v.line} 命中「${v.matches.join('、')}」(${v.message})`);
      console.log(`      ${v.excerpt}`);
    }
    console.log(`RESULT: FAIL 检出 ${res.violations.length} 处未归一化名词，请统一修正后再提交`);
    process.exit(res.exitCode);
  }
  console.log(`RESULT: PASS 名词归一化检查通过（已扫描 ${res.scannedFiles} 个文件，0 处漂移）`);
  process.exit(0);
}
