// UI 美学设计智能与多套方案令牌引擎（融合 UI/UX Pro Max 行业匹配 + Anthropic 反 AI 模板脸准则 + tweakcn CSS 变量体系）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export const AESTHETIC_PROPOSALS = [
  {
    id: 'swiss-minimal',
    code: 'A',
    name: '方案 A · 瑞士极简留白 (Swiss Editorial)',
    badge: '极简高留白',
    bestFor: ['saas', 'docs', 'productivity', 'knowledge', 'b2b', 'ai', '管理', '知识', '办公', '工具'],
    summary: '高呼吸感纸白底色 + 1px 建筑感细线 + 宝蓝单点聚焦，杜绝花哨渐变，突出排版秩序与可读性。',
    typography: 'Plus Jakarta Sans / Inter + JetBrains Mono',
    layoutDensity: 'spacious',
    swatches: ['#FAFAFA', '#111827', '#1D4ED8', '#E5E7EB'],
    tokens: {
      '--ui-bg': '#FAFAFA',
      '--ui-surface': '#FFFFFF',
      '--ui-surface-muted': '#F3F4F6',
      '--ui-text': '#111827',
      '--ui-muted': '#6B7280',
      '--ui-primary': '#1D4ED8',
      '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#0F172A',
      '--ui-border': '#E5E7EB',
      '--ui-radius': '8px',
      '--ui-shadow': '0 1px 2px rgba(15, 23, 42, 0.05)',
      '--ui-font-sans': '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif'
    }
  },
  {
    id: 'bento-craft',
    code: 'B',
    name: '方案 B · 现代便当盒卡片 (Tactile Bento)',
    badge: '模块卡片感',
    bestFor: ['portal', 'commerce', 'consumer', 'education', 'ehs', 'course', '电商', '门户', '培训', '课程', '工作台'],
    summary: '暖白亚麻底色配高对比纯白圆角模块格，森绿主色搭配琥珀强调色，层次分明且亲和力强。',
    typography: 'DM Sans / Noto Sans SC + Space Mono',
    layoutDensity: 'balanced',
    swatches: ['#F5F5F0', '#FFFFFF', '#0F766E', '#D97706'],
    tokens: {
      '--ui-bg': '#F5F5F0',
      '--ui-surface': '#FFFFFF',
      '--ui-surface-muted': '#EBEAE2',
      '--ui-text': '#1C1917',
      '--ui-muted': '#57534E',
      '--ui-primary': '#0F766E',
      '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#D97706',
      '--ui-border': '#E2E0D8',
      '--ui-radius': '16px',
      '--ui-shadow': '0 6px 18px -4px rgba(28, 25, 23, 0.07)',
      '--ui-font-sans': '"DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    }
  },
  {
    id: 'industrial-dark',
    code: 'C',
    name: '方案 C · 深空精密控制台 (Linear Industrial)',
    badge: '专业深色台',
    bestFor: ['devtools', 'fintech', 'ops', 'security', 'monitor', 'data', '监控', '安全', '数据', '金融', '研发', '控制台'],
    summary: '深岩黑底与微光描边，青色信号焦点与等宽数字对齐，适合高密度状态监控与专业研发软件。',
    typography: 'Geist / Inter + JetBrains Mono (tabular-nums)',
    layoutDensity: 'compact',
    swatches: ['#0B0F17', '#131A26', '#0891B2', '#10B981'],
    tokens: {
      '--ui-bg': '#0B0F17',
      '--ui-surface': '#131A26',
      '--ui-surface-muted': '#1C2536',
      '--ui-text': '#F1F5F9',
      '--ui-muted': '#94A3B8',
      '--ui-primary': '#06B6D4',
      '--ui-primary-fg': '#082F49',
      '--ui-accent': '#10B981',
      '--ui-border': '#263248',
      '--ui-radius': '10px',
      '--ui-shadow': '0 8px 24px rgba(0, 0, 0, 0.38)',
      '--ui-font-sans': '"Geist", "Inter", system-ui, sans-serif'
    }
  },
  {
    id: 'neo-brutal',
    code: 'D',
    name: '方案 D · 新粗野高反差工坊 (Neo-Brutalist)',
    badge: '鲜明个性风',
    bestFor: ['creative', 'studio', 'campaign', 'game', 'social', '创意', '活动', '社区', '设计'],
    summary: '暖米纸底 + 2px 纯黑实线边框与硬朗偏移投影，记忆点极强，彻底告别温吞模板感。',
    typography: 'Space Grotesk + IBM Plex Mono',
    layoutDensity: 'balanced',
    swatches: ['#FFFDF5', '#09090B', '#E11D48', '#FACC15'],
    tokens: {
      '--ui-bg': '#FFFDF5',
      '--ui-surface': '#FFFFFF',
      '--ui-surface-muted': '#FEF3C7',
      '--ui-text': '#09090B',
      '--ui-muted': '#3F3F46',
      '--ui-primary': '#E11D48',
      '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#FACC15',
      '--ui-border': '#09090B',
      '--ui-radius': '6px',
      '--ui-shadow': '3px 3px 0px #09090B',
      '--ui-font-sans': '"Space Grotesk", system-ui, sans-serif'
    }
  },
  {
    id: 'enterprise-dense',
    code: 'E',
    name: '方案 E · 高密度政企合规台 (Polaris Enterprise)',
    badge: '严谨业务流',
    bestFor: ['erp', 'crm', 'audit', 'ehs', 'gov', 'hospital', '台账', '审批', '合规', '企业', '后台'],
    summary: '冷灰分层背景 + 高对比深蓝主操作 + 紧凑表格间距，保障长表单、审批流与安全台账零视觉疲劳。',
    typography: 'Inter / Source Han Sans + Roboto Mono',
    layoutDensity: 'compact',
    swatches: ['#F1F5F9', '#FFFFFF', '#0F172A', '#2563EB'],
    tokens: {
      '--ui-bg': '#F1F5F9',
      '--ui-surface': '#FFFFFF',
      '--ui-surface-muted': '#E2E8F0',
      '--ui-text': '#0F172A',
      '--ui-muted': '#475569',
      '--ui-primary': '#2563EB',
      '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#0284C7',
      '--ui-border': '#CBD5E1',
      '--ui-radius': '6px',
      '--ui-shadow': '0 1px 3px rgba(15, 23, 42, 0.08)',
      '--ui-font-sans': '"Inter", "Microsoft YaHei", system-ui, sans-serif'
    }
  }
];

export const ANTI_AI_SLOP_RULES = [
  '禁止默认使用廉价紫粉霓虹渐变 (purple-to-pink linear-gradient)',
  '禁止拿 Emoji 充当生产界面功能图标（统一使用干净几何 SVG 图标）',
  '每屏只保留 1 个主视觉焦点色，次要操作一律退回中性描边或浅底按钮',
  '正文与背景对比度不低于 4.5:1，所有可交互控件具备明确悬停与键盘 Focus 态'
];

export function recommendAestheticProposals(queryText = '', count = 3) {
  const q = String(queryText || '').toLowerCase();
  const scored = AESTHETIC_PROPOSALS.map((item, idx) => {
    let score = 0;
    for (const kw of item.bestFor) {
      if (q.includes(kw)) score += 10;
    }
    // 默认保证前三套涵盖「极简亮色 + 现代卡片 + 深色控制台」鲜明对比
    if (idx < 3) score += (3 - idx);
    return { item, score };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(1, count)).map((x, i) => ({
    ...x.item,
    slotLabel: `方案 ${String.fromCharCode(65 + i)}`
  }));
}

export function buildCssVariablesStyleText(proposalId) {
  const found = AESTHETIC_PROPOSALS.find((p) => p.id === proposalId) || AESTHETIC_PROPOSALS[0];
  const vars = Object.entries(found.tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {\n${vars}\n}\n`;
}

export function readDesignSystemLock(projectRoot) {
  const lockPath = join(resolve(projectRoot), '.donegate', 'ui-design-lock.json');
  if (!existsSync(lockPath)) return null;
  const r = readJsonStrict(lockPath);
  return r.ok ? r.value : null;
}

export function lockDesignSystemMaster(projectRoot, proposalId, projectName = 'Project') {
  const root = resolve(projectRoot);
  const chosen = AESTHETIC_PROPOSALS.find((p) => p.id === proposalId) || AESTHETIC_PROPOSALS[0];
  const masterDir = join(root, 'design-system');
  mkdirSync(masterDir, { recursive: true });
  mkdirSync(join(root, '.donegate'), { recursive: true });

  const tokenLines = Object.entries(chosen.tokens).map(([k, v]) => `- \`${k}\`: \`${v}\``).join('\n');
  const md = [
    `# ${projectName} · 全局 UI 设计系统真值源 (MASTER.md)`,
    '',
    `> 由 DoneGate UI 看板锁定于 ${new Date().toISOString()}。Agent 在编写或修改任何前端页面、弹窗与组件时，必须严格遵守本文件的视觉令牌与反套路准则。`,
    '',
    `## 一、选定美学方向：${chosen.name}`,
    `- **核心气质**：${chosen.summary}`,
    `- **字体配对**：${chosen.typography}`,
    `- **空间密度**：\`${chosen.layoutDensity}\``,
    '',
    '## 二、语义设计令牌 (CSS Custom Properties)',
    tokenLines,
    '',
    '## 三、反「AI 模板脸」硬约束 (Anti-AI-Slop Checklist)',
    ...ANTI_AI_SLOP_RULES.map((r) => `- [x] ${r}`),
    ''
  ].join('\n');

  const masterPath = join(masterDir, 'MASTER.md');
  writeFileSync(masterPath, md, 'utf8');
  const lockPayload = {
    lockedAt: new Date().toISOString(),
    proposalId: chosen.id,
    proposalName: chosen.name,
    masterFile: 'design-system/MASTER.md',
    tokens: chosen.tokens
  };
  writeFileSync(join(root, '.donegate', 'ui-design-lock.json'), JSON.stringify(lockPayload, null, 2) + '\n', 'utf8');
  return lockPayload;
}

export function auditHtmlAntiAiSlop(htmlText) {
  const src = String(htmlText || '');
  const warnings = [];
  if (/linear-gradient\([^)]*(?:#8b5cf6|#9333ea|purple)[^)]*(?:#ec4899|#db2777|pink)/i.test(src)) {
    warnings.push('检出典型 AI 紫粉霓虹渐变，建议改用语义令牌主色');
  }
  if (/<button[^>]*>[\s]*(?:🚀|✨|🔥|🎉|💡)[\s]*<\/button>/u.test(src)) {
    warnings.push('检出纯 Emoji 充当按钮图标，建议替换为 SVG 矢量图标');
  }
  return { pass: warnings.length === 0, warnings };
}
