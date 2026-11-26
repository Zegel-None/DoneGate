// 工具观测断言器：把适配器层挖出来的 observation.json 判成红或绿。
//
// 为什么需要它：适配器按「只产声明、不产结论」协议运行；于是「这份观测到底合不合格」必须由另一处判。
// 在它出现之前，18 个工具的声明全部没人认领（checkedBy 指向不存在的 c01），三项门禁全绿而 0 条判据，
// 直到手动跑 --claim 才暴露。这个脚本就是「认领」的落点：一条义务 = 一条带 id 的断言。
//
// 用法：
//   node skill/check-brick-observations.mjs --obligation <id> [--root <项目根>]
//   node skill/check-brick-observations.mjs --list            列出全部义务与各自的处置
// 退出码（§八 四值）：0 断言成立 / 1 断言不成立（红）/ 2 观测存在但结构不对（事故）/ 3 没有观测或读不出（无法判断）
//
// 诚实边界：
//   1. 只断言「观测内部的自洽与这条业务底线」，不判断上游工具的算法对不对——那是门 5 与变异实验的活。
//   2. 没有观测时一律退 3，不假装通过；「没跑」与「跑绿了」是两件事。
//   3. 这里是唯一的断言表；改判定标准就改这张表，不要到适配器里改（适配器不许产状态）。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// 有牙棘轮基线：Stryker 存活变异体基线已清零为 0 个（2026-11-22 实测 60/60 = 100% Killed）。
// 本常量由 check-ai-habits.mjs H5 棘轮守卫锁死 === 0：**严禁回调大于 0**。
export const SURVIVED_MAX = 0;

// Biome error 基线：**2026-11-20 已清零到 0**。从今往后 error 必须为 0；由 H5 棘轮守卫锁死 === 0。
export const BIOME_ERRORS_MAX = 0;

export const RULES = {
  'stryker-no-survivors': {
    tool: 'stryker',
    why: '变异体存活说明测试没牙：改坏了代码它抓不住',
    check: (o) => {
      const c = o.countsByStatus || {};
      const hardZero = ['Pending', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError'];
      const badZero = hardZero.filter((k) => Number(c[k] || 0) > 0);
      const survived = Number(c.Survived || 0);
      const killed = Number(c.Killed || 0);
      if (badZero.length > 0) return { ok: false, detail: `存在不允许的变异体状态：${badZero.map((k) => `${k}=${c[k]}`).join(', ')}` };
      if (Number(o.totalMutants || 0) === 0) return { ok: false, detail: '变异体总数为 0，等于没有做实验' };
      if (survived > SURVIVED_MAX) return { ok: false, detail: `存活变异体 ${survived} 超过基线 ${SURVIVED_MAX}（Killed=${killed}）——测试退化或覆盖变窄` };
      return { ok: true, detail: `Killed=${killed}, Survived=${survived}（≤ 基线 ${SURVIVED_MAX}）` };
    }
  },
  'codegraph-no-cycles': {
    tool: 'codegraph',
    why: '循环依赖让影响面计算不可信，也让改动互相拖死',
    check: (o) => {
      const n = Number(o.cycleCount || 0);
      const list = Array.isArray(o.cycles) ? o.cycles : null;
      if (list === null) return { ok: false, detail: 'observation 缺 cycles 数组（结构不对）' };
      if (n !== list.length) return { ok: false, detail: `cycleCount(${n}) 与 cycles 条目数(${list.length}) 不一致` };
      return n === 0 ? { ok: true, detail: '0 条循环依赖环路' } : { ok: false, detail: `检出 ${n} 条循环依赖环路：${JSON.stringify(list).slice(0, 300)}` };
    }
  },
  'codegraph-impact-exists': {
    tool: 'codegraph',
    why: '影响面清单若指向不存在的文件，engine 的 pendingRecheck 会算到空气上',
    check: (o, ctx) => {
      const impacted = Array.isArray(o.impactedFiles) ? o.impactedFiles : null;
      if (impacted === null) return { ok: false, detail: 'observation 缺 impactedFiles 数组（结构不对）' };
      const missing = impacted.filter((f) => !existsSync(join(ctx.root, String(f))));
      if (missing.length > 0) return { ok: false, detail: `impactedFiles 里 ${missing.length} 个文件在盘上不存在（索引可能过期）：${missing.slice(0, 5).join(', ')}` };
      if (!Array.isArray(o.changedFiles)) return { ok: false, detail: 'observation 缺 changedFiles 数组（结构不对）' };
      return { ok: true, detail: `${o.changedFiles.length} 个变更文件 → ${impacted.length} 个受影响文件全部存在` };
    }
  },
  'gitleaks-no-secrets': {
    tool: 'gitleaks',
    why: '密钥一旦进历史就收不回来，这条必须零容忍',
    check: (o) => {
      const n = Number(o.findingCount || 0);
      if (!Array.isArray(o.findings)) return { ok: false, detail: 'observation 缺 findings 数组（结构不对）' };
      if (n !== o.findings.length) return { ok: false, detail: `findingCount(${n}) 与 findings 条目数(${o.findings.length}) 不一致` };
      return n === 0 ? { ok: true, detail: '0 条疑似密钥' } : { ok: false, detail: `检出 ${n} 条疑似密钥：${JSON.stringify(o.findings).slice(0, 300)}` };
    }
  },
  'depcruise-no-violations': {
    tool: 'depcruise',
    why: '模块边界规则违例意味着架构纪律已经被破（适配器层越权读判定核、核反向依赖具体工具、循环依赖）',
    check: (o) => {
      const n = Number(o.violationCount || 0);
      if (!Array.isArray(o.violations)) return { ok: false, detail: 'observation 缺 violations 数组（结构不对）' };
      if (n !== o.violations.length) return { ok: false, detail: `violationCount(${n}) 与 violations 条目数(${o.violations.length}) 不一致` };
      if (Number(o.modulesCount || 0) === 0) return { ok: false, detail: '巡航到 0 个模块＝空跑，这个 0 不算数' };
      return n === 0 ? { ok: true, detail: `巡航 ${o.modulesCount} 个模块，0 条边界违例` } : { ok: false, detail: `检出 ${n} 条违例：${JSON.stringify(o.violations).slice(0, 300)}` };
    }
  },
  'osv-no-high-severity': {
    tool: 'osv-scanner',
    why: '高危/严重漏洞不得进主干；中低危属可接受风险，UNKNOWN 不许当低危蒙混',
    check: (o) => {
      const c = o.severityCounts;
      if (!c || typeof c !== 'object') return { ok: false, detail: 'observation 缺 severityCounts（适配器版本过旧，先重采证）' };
      if (typeof o.vulnCount !== 'number' || !Array.isArray(o.vulnerabilities)) return { ok: false, detail: 'observation 缺 vulnCount / vulnerabilities（结构不对）' };
      const high = Number(c.HIGH || 0), crit = Number(c.CRITICAL || 0), unk = Number(c.UNKNOWN || 0);
      if (high + crit > 0) {
        const ids = (o.vulnerabilities || []).filter((v) => v.severity === 'HIGH' || v.severity === 'CRITICAL').map((v) => `${v.package}@${v.version}:${v.id}`);
        return { ok: false, detail: `检出高危 ${high} 条、严重 ${crit} 条：${ids.slice(0, 5).join(', ')}` };
      }
      if (unk > 0) return { ok: false, detail: `${unk} 条漏洞缺 severity，无法判断是否高危——不许按低危放过，需人工定级或补数据源` };
      return { ok: true, detail: `共 ${o.vulnCount} 条已知漏洞：HIGH=0、CRITICAL=0、UNKNOWN=0（MODERATE/LOW 属可接受风险，不作判据）` };
    }
  },
  'knip-no-unlisted-deps': {
    tool: 'knip',
    why: '代码里 import 了但没在 package.json 声明的依赖＝换台机器就装不上，这是真 bug 不是风格问题',
    check: (o) => {
      const n = Number(o.unlistedDepsCount || 0);
      if (!Array.isArray(o.unlistedDeps)) return { ok: false, detail: 'observation 缺 unlistedDeps 数组（结构不对）' };
      if (n !== o.unlistedDeps.length) return { ok: false, detail: `unlistedDepsCount(${n}) 与条目数(${o.unlistedDeps.length}) 不一致` };
      return n === 0 ? { ok: true, detail: '0 个未声明依赖（未用导出/死文件属建议，不作判据）' } : { ok: false, detail: `${n} 个未声明依赖：${JSON.stringify(o.unlistedDeps).slice(0, 300)}` };
    }
  },
  'biome-no-errors': {
    tool: 'biome',
    why: 'error 级诊断是语法或高危写法，不能带进主干；但历史风格债冻结在基线里，只许降不许升',
    check: (o) => {
      if (typeof o.errors !== 'number') return { ok: false, detail: 'observation 缺 errors 数字（结构不对）' };
      if (o.errors > BIOME_ERRORS_MAX) return { ok: false, detail: `biome error 从基线 ${BIOME_ERRORS_MAX} 涨到 ${o.errors}（涉及 ${o.filesWithDiagnostics} 个文件）——不许调 linter 配置或加豁免来压它` };
      return { ok: true, detail: `errors=${o.errors}（≤ 基线 ${BIOME_ERRORS_MAX}；warnings=${o.warnings} 仅作建议）` };
    }
  },
  'ruff-no-violations': {
    tool: 'ruff',
    why: 'Python 语法错误、未定义符号 (F821) 与高危静态违规不得带进主干',
    check: (o) => {
      if (typeof o.violationCount !== 'number') return { ok: false, detail: 'observation 缺 violationCount 数字（结构不对）' };
      const syn = Number(o.syntaxErrorCount || 0);
      const undef = Number(o.undefinedNameCount || 0);
      if (o.violationCount > 0 || syn > 0 || undef > 0) {
        return { ok: false, detail: `ruff 检出违规 ${o.violationCount} 条（语法错误 ${syn}、未定义符号 ${undef}）` };
      }
      return { ok: true, detail: 'ruff 零违规通过' };
    }
  },
  'complexipy-under-cap': {
    tool: 'complexipy',
    why: 'Python 单函数认知复杂度不得超过上限，防止高耦合函数持续腐化',
    check: (o) => {
      if (typeof o.overThresholdCount !== 'number') return { ok: false, detail: 'observation 缺 overThresholdCount 数字（结构不对）' };
      let cap = Number(o.maxAllowed ?? 25);
      if (process.env.DG_NODE_CONFIG) {
        try {
          const cfg = JSON.parse(process.env.DG_NODE_CONFIG);
          if (Number.isFinite(Number(cfg?.maxComplexity)) && Number(cfg.maxComplexity) >= 0) cap = Number(cfg.maxComplexity);
        } catch (err) { void err; }
      }
      const maxCx = Number(o.maxComplexity || 0);
      if (o.overThresholdCount > 0 || maxCx > cap) {
        return { ok: false, detail: `complexipy 检出 ${o.overThresholdCount} 个函数超过上限 ${cap}（最高复杂度 ${maxCx}）` };
      }
      return { ok: true, detail: `analyzed=${o.functionsAnalyzed || 0}, max=${maxCx} ≤ ${cap}` };
    }
  },
  'pyright-no-errors': {
    tool: 'pyright',
    why: 'Python 跨文件参数失配与不存在属性调用属于真运行期崩溃风险',
    check: (o) => {
      if (typeof o.errorCount !== 'number') return { ok: false, detail: 'observation 缺 errorCount 数字（结构不对）' };
      return o.errorCount === 0
        ? { ok: true, detail: `pyright errorCount=0（warnings=${o.warningCount || 0}）` }
        : { ok: false, detail: `pyright 检出 ${o.errorCount} 条类型错误` };
    }
  },
  'ty-no-errors': {
    tool: 'ty',
    why: 'Astral ty 检出的类型错误属于静态契约失配，不得带进主干',
    check: (o) => {
      if (typeof o.errorCount !== 'number') return { ok: false, detail: 'observation 缺 errorCount 数字（结构不对）' };
      return o.errorCount === 0
        ? { ok: true, detail: `ty errorCount=0（warnings=${o.warningCount || 0}）` }
        : { ok: false, detail: `ty 检出 ${o.errorCount} 条类型错误` };
    }
  },
  'pytest-all-pass': {
    tool: 'pytest',
    why: 'Python 单元与集成测试必须全绿，任何失败或收集错误均阻断交付',
    check: (o) => {
      if (typeof o.failedCount !== 'number' || typeof o.errorCount !== 'number') {
        return { ok: false, detail: 'observation 缺 failedCount / errorCount 数字（结构不对）' };
      }
      if (o.failedCount > 0 || o.errorCount > 0) {
        return { ok: false, detail: `pytest 失败 ${o.failedCount} 项、错误 ${o.errorCount} 项（通过 ${o.passedCount || 0}）` };
      }
      return { ok: true, detail: `pytest 全绿（passed=${o.passedCount || 0}, skipped=${o.skippedCount || 0}）` };
    }
  },
  'import-linter-no-broken-contracts': {
    tool: 'import-linter',
    why: 'Python 架构分层契约违例表示模块边界已被跨层击穿',
    check: (o) => {
      if (typeof o.brokenContractCount !== 'number') return { ok: false, detail: 'observation 缺 brokenContractCount 数字（结构不对）' };
      return o.brokenContractCount === 0
        ? { ok: true, detail: `import-linter 遵守 ${o.keptContractCount || 0} 条契约，0 条违规` }
        : { ok: false, detail: `import-linter 检出 ${o.brokenContractCount} 条架构边界契约违规` };
    }
  },
  'fuck-u-code-no-hot-files': {
    tool: 'fuck-u-code',
    why: '高复杂度热点文件需先拆分再交付',
    check: (o) => {
      const hotCount = Array.isArray(o.hotFiles) ? o.hotFiles.length : Number(o.hotFileCount || 0);
      return hotCount === 0
        ? { ok: true, detail: 'fuck-u-code 零高复杂度热点文件' }
        : { ok: false, detail: `fuck-u-code 检出 ${hotCount} 个高复杂度热点文件` };
    }
  }
};

export const ADVISORY = {
  jscpd: '克隆对数属重构建议（当前 3 组微克隆），没有「必须为 0」的业务底线；作为旁注给人看。',
  'fuck-u-code': '复杂度是结构性建议，不代表业务正确性；作为热点清单供人选重构目标。',
  'dotenv-linter': '本仓没有 .env 主体，跑出来的清单对判定无意义；使用者项目里由它自己的契约接。',
  openspec: '本仓没有 openspec 规格目录，规格格式校验对本仓无判据价值。',
  srclight: '索引新鲜度是读代码的前置条件，不是验收结论；由使用者在需要时跑。',
  beads: '只读排序建议，禁止回写核状态；把它变成判据等于让外部工具推状态（撞 adr/002）。',
  'ast-grep': '模式由调用方指定，没有固定业务含义；要判「不许出现某形状」时，应由那条判据自己带模式。',
  playwright: '本仓没有 Web E2E 用例，判据只能恒为「无法判断」；有前端的用户项目里才有意义。',
  maestro: '本仓没有移动端 App 与模拟器，同上。',
  schemathesis: '本仓没有运行中的 HTTP 服务可供压测，判据无法产生证据。',
  trivy: '本仓没有 Dockerfile/IaC 清单，misconfig 扫描无对象。',
  ruff: '本仓无 Python 业务主体；供 Python 用户项目拦截小模型缩进截断、F821 未定义符号与裸 except。',
  pyright: '本仓无 Python 业务主体；供 Python 用户项目拦截小模型编造对象属性、传错参数个数与跨模块返回类型失配。',
  typos: '未配置项目专属 _typos.toml 缩写白名单前先作旁注观测，防领域缩写误报。',
  'ui-interaction-matrix': '内置 16 条前端交互控件决策规则与五态清单，供预置工作流阶段 4 前置约束。',
  'vuln-merge': '多源漏洞报告去重与可达性 P0-P3 定级归并器，供安全覆盖族收口使用。',
  syft: '生成 CycloneDX 标准 SBOM 物料清单供下游漏洞覆盖族消费，本身不作红绿判据。',
  semgrep: '多语言快速 SAST 静态安全扫描节点，规则由调用方或预置安全工作流指定。',
  actionlint: '本仓单文件 donegate-ci.yml 已由双系统 CI 自验；供含复杂多流水线的用户项目拦截小模型编造 Action 参数与表达式错误。'
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d = null) => {
    const i = process.argv.indexOf(k);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
  };
  const root = resolve(arg('--root', REPO));

  if (process.argv.includes('--list')) {
    console.log(`接线的义务（${Object.keys(RULES).length} 条）：`);
    for (const [id, r] of Object.entries(RULES)) console.log(`  · ${id}  [${r.tool}]  ${r.why}`);
    console.log(`\n不接线（advisory，${Object.keys(ADVISORY).length} 个工具）：`);
    for (const [tool, why] of Object.entries(ADVISORY)) console.log(`  · ${tool}: ${why}`);
    process.exit(0);
  }

  const obId = arg('--obligation');
  if (!obId) { console.error('用法：--obligation <id> 或 --list'); process.exit(3); }
  const rule = RULES[obId];
  if (!rule) {
    const adv = ADVISORY[obId];
    console.error(adv ? `${obId} 是 advisory（不构成判据）：${adv}` : `未知义务：${obId}`);
    console.log(`RESULT: 无法判断 ${obId} 不是一条已登记的判据`);
    process.exit(3);
  }

  const obsPath = join(root, '.donegate', 'adapters', rule.tool, 'observation.json');
  if (!existsSync(obsPath)) {
    console.log(`RESULT: 无法判断 还没有 ${rule.tool} 的观测（先跑 run-stage 采证）：${obsPath}`);
    process.exit(3);
  }
  let obs;
  try { obs = JSON.parse(readFileSync(obsPath, 'utf8')); } catch (e) {
    console.error(`观察文件 JSON 损坏：${obsPath}（${e.message}）`);
    console.log('RESULT: FAIL 观测损坏属事故（退 2）');
    process.exit(2);
  }
  if (!obs || typeof obs !== 'object' || Array.isArray(obs)) {
    console.error('observation.json 顶层必须是对象');
    console.log('RESULT: FAIL 观测结构非法（退 2）');
    process.exit(2);
  }

  let verdict;
  try { verdict = rule.check(obs, { root }); } catch (e) {
    console.error('断言执行异常：' + e.message);
    console.log('RESULT: FAIL 断言执行异常属事故（退 2）');
    process.exit(2);
  }
  if (verdict.ok) {
    console.log(`RESULT: PASS ${obId} — ${verdict.detail}`);
    process.exit(0);
  }
  console.error(`${obId}（${rule.why}）`);
  console.error('  ' + verdict.detail);
  console.log('RESULT: FAIL ' + obId + ' 不成立');
  process.exit(1);
}
