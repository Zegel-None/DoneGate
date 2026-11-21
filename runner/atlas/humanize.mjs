// Vibe Coder 大白话翻译器与「一键复制发给 AI」自然语言提示词生成器（<= 300 行聚焦子模块）
import { basename, dirname } from 'node:path';

const WORD_MAP = {
  auth: '登录认证', login: '用户登录', signin: '用户登录', logout: '退出登录',
  signup: '账号注册', register: '账号注册', password: '密码管理', reset: '重置服务',
  user: '用户中心', users: '用户管理', profile: '个人资料', account: '账户设置',
  order: '订单处理', orders: '订单管理', checkout: '结账付款', cart: '购物车',
  pay: '支付服务', payment: '支付结算', billing: '账单与清算', ledger: '账本核心',
  refund: '退款处理', invoice: '发票管理', webhook: '外部回调通知',
  product: '商品详情', products: '商品目录', catalog: '目录展示', item: '条目管理',
  inventory: '库存管理', stock: '库存盘点', search: '搜索查询', filter: '筛选服务',
  chat: '对话消息', message: '消息通知', notify: '消息提醒', email: '邮件发送',
  upload: '文件上传', download: '文件下载', export: '数据导出', import: '数据导入',
  report: '统计报表', analytics: '数据分析', dashboard: '总览面板', atlas: '全景沙盘',
  admin: '管理后台', settings: '系统设置', config: '配置加载', health: '健康检查',
  sync: '数据同步', task: '后台任务', queue: '队列处理', cron: '定时任务',
  db: '数据库访问', schema: '数据结构校验', model: '数据模型', cache: '缓存加速',
  gate: '质量门禁', gates: '门禁校验', chain: '防篡改账本', contract: '验收契约',
  adapter: '外部工具适配', adapters: '工具适配器', check: '自动核查', cli: '命令行入口',
  home: '首页', index: '主入口', app: '应用主程序', main: '程序主入口', server: '后台服务'
};

const KIND_LABELS = {
  'web-page': '网页界面',
  'fastapi-route': '后台接口',
  'flask-route': '后台接口',
  'node-api': '后台接口',
  'node-cli': '命令行工具',
  'py-cli': '脚本小工具',
  'ai-skill': 'AI 技能包',
  'module': '内部功能模块'
};

export function humanKindLabel(kind) {
  return KIND_LABELS[kind] || '功能模块';
}

export function translateSlugToChinese(rawSlug) {
  const tokens = String(rawSlug || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
  if (tokens.length === 0) return '主页面';
  const mapped = [];
  for (const tk of tokens) {
    if (/[\u4e00-\u9fa5]/.test(tk)) { mapped.push(tk); continue; }
    const low = tk.toLowerCase();
    if (['src', 'lib', 'pkg', 'core', 'cmd', 'page', 'route', 'routers', 'router', 'api', 'v1', 'v2', 'views', 'controllers'].includes(low)) continue;
    if (WORD_MAP[low] && !mapped.includes(WORD_MAP[low])) mapped.push(WORD_MAP[low]);
  }
  if (mapped.length > 0) return mapped.slice(0, 2).join(' · ');
  return tokens.slice(-2).join(' ');
}

export function extractHumanTitleFromSource(relPath, content = '') {
  const src = String(content || '').slice(0, 4096);
  // 1. HTML / JSX / TSX <title> or <h1>
  const titleTag = src.match(/<title[^>]*>([^<{]{2,36})<\/title>/i) || src.match(/<h1[^>]*>([^<{]{2,36})<\/h1>/i);
  if (titleTag && titleTag[1].trim()) return titleTag[1].trim();

  // 2. Python top module docstring """...""" or '''...'''
  const pyDoc = src.match(/^(?:#![^\n]*\n|\s*#[^\n]*\n|\s)*[rRuU]?(?:"""|''')\s*([^\r\n"']{3,44})/);
  if (pyDoc && pyDoc[1].trim()) return cleanCommentTitle(pyDoc[1]);

  // 3. Top-of-file single-line comment (JS // or Python #) within first 6 lines
  const headLines = src.split(/\r?\n/).slice(0, 6);
  for (const line of headLines) {
    const t = line.trim();
    if (!t || t.startsWith('#!') || /^\/\/\s*@(?:ts-|dg-)|eslint|prettier|copyright|license|spdx/i.test(t)) continue;
    const cm = t.match(/^(?:\/\/|#)\s*(.+)$/);
    if (cm) {
      const cleaned = cleanCommentTitle(cm[1]);
      if (cleaned.length >= 3) return cleaned;
    }
    if (!t.startsWith('//') && !t.startsWith('#') && !t.startsWith('/*')) break;
  }

  // 4. Fallback to directory + filename slug translation
  const base = basename(relPath);
  const parent = basename(dirname(relPath));
  const seed = /^(?:index|page|route|main|__init__)\./i.test(base) ? parent : `${parent}-${base}`;
  return translateSlugToChinese(seed);
}

function cleanCommentTitle(raw) {
  return String(raw || '')
    .replace(/^[·\-—*=:\s]+|[·\-—*=:\s]+$/g, '')
    .split(/[（(。；;]/)[0]
    .trim()
    .slice(0, 34);
}

export function humanizeDomainTitle(domainRel) {
  if (!domainRel || domainRel === '.' || domainRel === 'root') return '根目录入口';
  const translated = translateSlugToChinese(domainRel);
  const hasCn = /[\u4e00-\u9fa5]/.test(translated);
  return hasCn ? translated : `模块组：${domainRel}`;
}

export function humanizeVerdictStatus({ state, subclass, cleared, pendingRecheck, isWild }) {
  if (isWild) {
    return {
      vibeLabel: '还没加保护',
      tone: 'wild',
      vibeExplain: 'AI 已经写出了这块功能代码，但还没有给它设定自动验收标准；以后改别处不小心弄坏它时不会自动报警。',
      techSummary: '未挂入任何活跃 contract.json 的 scope[]'
    };
  }
  if (cleared || (state === '通过' && subclass === 'A1' && !pendingRecheck)) {
    return {
      vibeLabel: '已验真（放心用）',
      tone: 'ok',
      vibeExplain: '功能检查已通过，并且做过「故意改坏代码看能不能抓出来」的防假绿测试，结果可靠。',
      techSummary: `${cleared ? '已签收通关' : '通过'} · 算数(A1)`
    };
  }
  if (state === '通过' && !pendingRecheck) {
    return {
      vibeLabel: '初步跑通（待加固）',
      tone: 'ok',
      vibeExplain: '基础运行检查已经通过，但还没做防假绿抽检，建议重要功能补做一次防假绿验证。',
      techSummary: `通过 · 子类 ${subclass || 'A3'}`
    };
  }
  if (state === '过期' || pendingRecheck) {
    return {
      vibeLabel: '刚改过代码（需重测）',
      tone: 'warn',
      vibeExplain: '上次验收通过之后，这块或它依赖的代码又被改动过，旧绿灯已作废，需要让 AI 重新跑一遍检查。',
      techSummary: pendingRecheck ? '上游变更触发待重验(A4)' : '材料或判据指纹变更(过期)'
    };
  }
  if (state === '未通过' || state === '无法判断' || state === '不稳定') {
    return {
      vibeLabel: '检查未过（需修复）',
      tone: 'bad',
      vibeExplain: '最近一次检查报错、缺环境或结果忽好忽坏，建议先让 AI 修好再继续往下开发。',
      techSummary: `判定状态：${state}`
    };
  }
  return {
    vibeLabel: '已建档（待首测）',
    tone: 'todo',
    vibeExplain: '已经登记在验收清单里，等确认范围后跑第一次正式检查。',
    techSummary: `判定状态：${state || '未验证'}`
  };
}

export function buildAiPromptForModule(mod) {
  if (mod.isWild) {
    return `请帮我给「${mod.humanTitle}」（代码路径：${mod.path}）补上验收保护：先核对它目前的功能逻辑是否正常，再在 DoneGate 中将它纳入契约 scope 并补齐正常、边界、异常三类自动检查项。`;
  }
  if (mod.tone === 'bad' || mod.tone === 'warn') {
    return `「${mod.humanTitle}」（路径：${mod.path}，关联契约：${mod.contractId || '未绑定'}）当前处于「${mod.vibeLabel}」状态，请帮我排查原因、修复问题并重新跑通验收检查。`;
  }
  return `请帮我梳理「${mod.humanTitle}」（路径：${mod.path}）目前的功能逻辑与上下游配合关系，并确认如果想在这块继续加功能需要注意哪些边界。`;
}

export function buildAiPromptForBranch(br) {
  if (br.collidesWith && br.collidesWith.length > 0) {
    const peers = br.collidesWith.map((c) => `「${c.branch}」（重合文件：${c.files.slice(0, 3).join('、')}）`).join('；');
    return `注意：支线「${br.name}」与 ${peers} 同时修改了同一处功能代码，直接合并容易互相覆盖冲突。请帮我对比这两条支线的改动内容，给出安全的合并顺序建议。`;
  }
  if (br.status === 'dormant') {
    return `仓库里有一条已经停工 ${br.idleDays} 天未合并回主线的支线「${br.name}」（主要改动了：${br.humanDomains.join('、') || '部分文件'}）。请帮我检查这条支线当时做到了哪一步，评估是继续收尾合入主线，还是归档清理。`;
  }
  return `请帮我查看支线「${br.name}」目前的开发进度（已改动：${br.humanDomains.join('、') || '无'}），检查还差哪些收尾工作可以安全合入主线「${br.baseBranch}」。`;
}
