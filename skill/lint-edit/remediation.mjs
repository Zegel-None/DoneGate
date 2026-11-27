// lint-edit 可执行修复配方表（伴生子模块，自动继承 shared-primitives 归属）
const LER_REMEDIATION_RULES = [
  {
    match: /C4g/,
    hint: '将单行多语句或多重嵌套三元拆回标准多行 if/else，严禁靠压行规避行数统计'
  },
  {
    match: /C1d|认知复杂度/,
    hint: '使用卫语句提前 return 降低嵌套层级，或将循环/分支体拆成带模块前缀的短辅助函数（复杂度 ≤ 15）'
  },
  {
    match: /M6 核心子模块超行数硬顶/,
    hint: '将独立职责拆入同名伴生子模块目录 `<file-stem>/*.mjs`（自动继承契约归属），主文件保留门面重导出且 ≤ 350 行'
  },
  {
    match: /M6.*(?:超|上限)|适配器.*90/,
    hint: '按职责拆分为同名伴生子模块目录；外部工具适配器须委托 `skill/adapters/_shared.mjs` 的 `runAdapter` 保持 ≤ 90 行'
  },
  {
    match: /WB_[A-Z0-9_]+_FNS|内联浏览器脚本漏挂载/,
    hint: '将报错提示的本地辅助函数名加入同文件 `WB_*_FNS` 导出数组，确保浏览器运行时不报 ReferenceError'
  },
  {
    match: /术语漂移/,
    hint: '按报错右侧推荐的归一化术语替换；若属门禁或词表自引，可在行尾加 `// dg-term-allow: 理由`'
  },
  {
    match: /C3:todo|未完成占位符/,
    hint: '补齐真实实现并删除 TODO/FIXME/XXX/HACK 占位注释，禁止提交半成品空壳'
  },
  {
    match: /C3:empty-catch|静默吞异常/,
    hint: '在 catch 块中显式记录错误、返回失败状态，或预期可忽略时写 `catch (err) { void err; }` 并说明原因'
  },
  {
    match: /C3:elide|省略删码/,
    hint: '写全完整代码逻辑，严禁使用「其余代码保持不变」等省略占位注释'
  },
  {
    match: /C2:skip-only|C2:tautology/,
    hint: '移除 `.skip/.only/.todo` 或恒真断言，改写为检验真实业务行为的可失败断言'
  },
  {
    match: /C4 禁止机械按字母/,
    hint: '禁止使用 `-a.mjs` / `-b.mjs` / `-part1.mjs` 机械切片后缀，请按业务职责重命名模块并更新引用'
  },
  {
    match: /M7 文件头/,
    hint: '按模块职责拆分减负使其重新低于头注声明上限，或将文件头注释中的行数/契约归属校准为当前真实值'
  },
  {
    match: /C3:boolean-sort|比较器返回布尔值/,
    hint: '将 `.sort((a, b) => a > b)` 改为返回数值差 `(a, b) => a - b`、`a.localeCompare(b)` 或三元 `(a < b ? -1 : a > b ? 1 : 0)`'
  },
  {
    match: /C4d|决策记录/,
    hint: '补齐 `decisions/*.md` 五段式必需章节（当时的问题 / 可选方案 / 选了哪个 / 为什么 / 什么条件下翻案）并填写真实内容'
  },
  {
    match: /契约归属提示/,
    hint: '将新增生产文件加入对应活跃契约 `scope[]`，或置于已有显式文件的同名伴生子模块目录中'
  },
  {
    match: /M1|M5|语法/,
    hint: '根据报错行号修复 JS/ESM 或 JSON/JSONL 语法错误后立即重跑 `donegate lint-edit`'
  }
];

export function resolveLintFixHint(message) {
  const txt = String(message || '');
  for (const rule of LER_REMEDIATION_RULES) {
    if (rule.match.test(txt)) return rule.hint;
  }
  return '';
}

export function attachFixHints(messages = []) {
  return (messages || []).map((msg) => ({
    message: msg,
    fixHint: resolveLintFixHint(msg)
  }));
}
