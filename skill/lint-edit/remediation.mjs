// lint-edit 可执行修复配方表与 Web DOM XSS 注入毫秒快筛器（伴生子模块，自动继承 shared-primitives 归属）
import { extname } from 'node:path';

const WEB_DOM_SCAN_EXT_RE = /\.(?:m?js|cjs|tsx?|jsx|html?)$/i;
const ALLOW_DIRECTIVE_RE = /(?:\/\/|#|<!--)\s*dg-allow\s*:\s*(.+)$/;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|<!--|-->)/;
const SANITIZER_CALL_RE = /\b(?:DOMPurify\.sanitize|sanitizeHtml)\s*\(/;
const EMPTY_STRING_LITERAL_RE = /^(?:''|""|``)\s*;?\s*$/;
const PURE_STATIC_QUOTED_RE = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*;?\s*$/;
const PURE_STATIC_TEMPLATE_RE = /^`(?:\\.|[^`$\\])*`\s*;?\s*$/;
const INLINE_EXEC_ATTR_RE = /<\s*script\b|\bon[a-z]+\s*=|javascript\s*:/i;

const XSS_FIX_RECIPES = Object.freeze({
  innerHTML: '改用 `el.textContent = value` 写入纯文本，或使用 `document.createElement()` + `appendChild()` 组装受控 DOM 节点',
  outerHTML: '避免直接拼接 `outerHTML`，改用 `document.createElement()` 构建替换节点并通过 `el.replaceWith(node)` 挂载，`textContent` 写入文本',
  'document.write': '移除阻塞且高危的 `document.write()`，改用 `document.createElement()` 创建元素并调用容器 `appendChild()` / `textContent`',
  dangerouslySetInnerHTML: '移除未净化的 `dangerouslySetInnerHTML`，改用 JSX 文本表达式 `{value}` 自动转义或 `createElement` 渲染结构'
});

const LER_REMEDIATION_RULES = [
  { match: /C4g/, hint: '将单行多语句或多重嵌套三元拆回标准多行 if/else，严禁靠压行规避行数统计' },
  { match: /C1d|认知复杂度/, hint: '使用卫语句提前 return 降低嵌套层级，或将循环/分支体拆成带模块前缀的短辅助函数（复杂度 ≤ 15）' },
  { match: /M6 核心子模块超行数硬顶/, hint: '将独立职责拆入同名伴生子模块目录 `<file-stem>/*.mjs`（自动继承契约归属），主文件保留门面重导出且 ≤ 350 行' },
  { match: /M6.*(?:超|上限)|适配器.*90/, hint: '按职责拆分为同名伴生子模块目录；外部工具适配器须委托 `skill/adapters/_shared.mjs` 的 `runAdapter` 保持 ≤ 90 行' },
  { match: /WB_[A-Z0-9_]+_FNS|内联浏览器脚本漏挂载/, hint: '将报错提示的本地辅助函数名加入同文件 `WB_*_FNS` 导出数组，确保浏览器运行时不报 ReferenceError' },
  { match: /术语漂移/, hint: '按报错右侧推荐的归一化术语替换；若属门禁或词表自引，可在行尾加 `// dg-term-allow: 理由`' },
  { match: /C3:todo|未完成占位符/, hint: '补齐真实实现并删除 TODO/FIXME/XXX/HACK 占位注释，禁止提交半成品空壳' },
  { match: /C3:empty-catch|静默吞异常/, hint: '在 catch 块中显式记录错误、返回失败状态，或预期可忽略时写 `catch (err) { void err; }` 并说明原因' },
  { match: /C3:elide|省略删码/, hint: '写全完整代码逻辑，严禁使用「其余代码保持不变」等省略占位注释' },
  { match: /C2:skip-only|C2:tautology/, hint: '移除 `.skip/.only/.todo` 或恒真断言，改写为检验真实业务行为的可失败断言' },
  { match: /C4 禁止机械按字母/, hint: '禁止使用 `-a.mjs` / `-b.mjs` / `-part1.mjs` 机械切片后缀，请按业务职责重命名模块并更新引用' },
  { match: /M7 文件头/, hint: '按模块职责拆分减负使其重新低于头注声明上限，或将文件头注释中的行数/契约归属校准为当前真实值' },
  { match: /C3:boolean-sort|比较器返回布尔值/, hint: '将 `.sort((a, b) => a > b)` 改为返回数值差 `(a, b) => a - b`、`a.localeCompare(b)` 或三元 `(a < b ? -1 : a > b ? 1 : 0)`' },
  { match: /dangerouslySetInnerHTML/, hint: XSS_FIX_RECIPES.dangerouslySetInnerHTML },
  { match: /document\.write(?:ln)?\b/, hint: XSS_FIX_RECIPES['document.write'] },
  { match: /outerHTML/, hint: XSS_FIX_RECIPES.outerHTML },
  { match: /C3:xss|CWE-79|DOM\s*注入|innerHTML/i, hint: XSS_FIX_RECIPES.innerHTML },
  { match: /C4d|决策记录/, hint: '补齐 `decisions/*.md` 五段式必需章节（当时的问题 / 可选方案 / 选了哪个 / 为什么 / 什么条件下翻案）并填写真实内容' },
  { match: /契约归属提示/, hint: '将新增生产文件加入对应活跃契约 `scope[]`，或置于已有显式文件的同名伴生子模块目录中' },
  { match: /M1|M5|语法/, hint: '根据报错行号修复 JS/ESM 或 JSON/JSONL 语法错误后立即重跑 `donegate lint-edit`' }
];

function lerIsSafeStaticHtmlAssignment(op, rhsRaw) {
  if (op === '+=') return false;
  const rhs = String(rhsRaw || '').replace(/\/\/.*$/, '').trim();
  if (!rhs || EMPTY_STRING_LITERAL_RE.test(rhs) || SANITIZER_CALL_RE.test(rhs)) return true;
  const isPureLiteral = PURE_STATIC_QUOTED_RE.test(rhs) || PURE_STATIC_TEMPLATE_RE.test(rhs);
  return isPureLiteral && !INLINE_EXEC_ATTR_RE.test(rhs);
}

function lerDetectLineDomSink(codePart) {
  const htmlAssign = codePart.match(/(?:\.|\[['"])(innerHTML|outerHTML)(?:['"]\])?\s*(\+?=)\s*([^\n]+)/);
  if (htmlAssign && !lerIsSafeStaticHtmlAssignment(htmlAssign[2], htmlAssign[3])) return htmlAssign[1];

  const docWrite = codePart.match(/\bdocument\.write(?:ln)?\s*\(\s*([^\n)]*)/);
  if (docWrite && !EMPTY_STRING_LITERAL_RE.test(docWrite[1].trim())) return 'document.write';

  const reactRaw = codePart.match(/\bdangerouslySetInnerHTML\s*=\s*(\{\s*\{[\s\S]*?\}|\{[^\n}]+|\S+)/);
  if (!reactRaw || SANITIZER_CALL_RE.test(reactRaw[1])) return null;
  const htmlProp = reactRaw[1].match(/__html\s*:\s*([^,}]+)/);
  return (!htmlProp || !lerIsSafeStaticHtmlAssignment('=', htmlProp[1])) ? 'dangerouslySetInnerHTML' : null;
}

function lerHasAllowDirective(rawLine) {
  const allow = rawLine.match(ALLOW_DIRECTIVE_RE);
  return Boolean(allow && allow[1].trim().length > 0);
}

function lerBuildHazardRecord(sink, targetPath, lineNo, trimmed) {
  const fixHint = XSS_FIX_RECIPES[sink] || XSS_FIX_RECIPES.innerHTML;
  return {
    ruleId: 'C3:xss',
    cweId: 'CWE-79',
    sink,
    file: targetPath,
    line: lineNo,
    snippet: trimmed,
    message: `C3:xss 未转义动态 DOM 注入 (${targetPath}:L${lineNo})：检测到高危 \`${sink}\` 写入（CWE-79）`,
    fixHint
  };
}

function lerStepLineCommentState(rawLine, inBlockComment) {
  if (inBlockComment) return { skip: true, nextBlock: !rawLine.includes('*/') };
  const trimmed = rawLine.trim();
  if (!trimmed || COMMENT_LINE_RE.test(trimmed)) {
    const opensBlock = trimmed.startsWith('/*') && !trimmed.includes('*/');
    return { skip: true, nextBlock: opensBlock };
  }
  return { skip: lerHasAllowDirective(rawLine), nextBlock: false, trimmed };
}

export function scanWebDomInjectionHazards(sourceText, filePath = '') {
  const targetPath = String(filePath || 'inline.js').replace(/\\/g, '/');
  const ext = extname(targetPath);
  if (ext && !WEB_DOM_SCAN_EXT_RE.test(targetPath)) return [];
  const lines = String(sourceText || '').split(/\r?\n/);
  const hazards = [];
  let inBlockComment = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const step = lerStepLineCommentState(lines[idx], inBlockComment);
    inBlockComment = step.nextBlock;
    if (step.skip) continue;
    const sink = lerDetectLineDomSink(lines[idx]);
    if (sink) hazards.push(lerBuildHazardRecord(sink, targetPath, idx + 1, step.trimmed));
  }
  return hazards;
}

export function resolveLintFixHint(message, opts = {}) {
  const txt = String(message || '');
  for (const rule of LER_REMEDIATION_RULES) {
    if (rule.match.test(txt)) return rule.hint;
  }
  const inlineHazards = scanWebDomInjectionHazards(txt, opts.filePath || 'inline.jsx');
  return inlineHazards.length > 0 ? inlineHazards[0].fixHint : '';
}

export function attachFixHints(messages = [], opts = {}) {
  const mapped = (messages || []).map((msg) => ({
    message: msg,
    fixHint: resolveLintFixHint(msg, opts)
  }));
  if (!opts || typeof opts.sourceText !== 'string') return mapped;
  const existingSet = new Set(mapped.map((m) => m.message));
  for (const h of scanWebDomInjectionHazards(opts.sourceText, opts.filePath)) {
    if (!existingSet.has(h.message)) {
      mapped.push({ message: h.message, fixHint: h.fixHint, sink: h.sink, line: h.line, cweId: h.cweId });
    }
  }
  return mapped;
}
