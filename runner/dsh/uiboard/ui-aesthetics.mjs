// UI 美学设计智能与 4 分组 12 套方案令牌引擎（融合行业匹配 + 反 AI 模板脸准则 + CSS 变量体系）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';

export const AESTHETIC_GROUPS = [
  '极简与现代办公',
  '深色与研发控制台',
  '政企合规与高密度台账',
  '品牌创意与消费门户'
];

export const AESTHETIC_PROPOSALS = [
  {
    id: 'swiss-minimal', code: 'A', archetype: 'editorial-asymmetric', layoutBadge: '非对称双栏 · 3区细线留白', cardCount: 3, group: '极简与现代办公',
    name: '方案 A · 瑞士极简留白 (Swiss Editorial)', badge: '极简高留白',
    bestFor: ['saas', 'docs', 'productivity', 'knowledge', 'b2b', 'ai', '管理', '知识', '办公', '工具'],
    summary: '高呼吸感纸白底色 + 1px 建筑感细线 + 宝蓝单点聚焦，杜绝花哨渐变，突出排版秩序与可读性。',
    typography: 'Plus Jakarta Sans / Inter + JetBrains Mono', layoutDensity: 'spacious',
    swatches: ['#FAFAFA', '#111827', '#1D4ED8', '#E5E7EB'],
    tokens: {
      '--ui-bg': '#FAFAFA', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#F3F4F6',
      '--ui-text': '#111827', '--ui-muted': '#6B7280', '--ui-primary': '#1D4ED8', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#0F172A', '--ui-border': '#E5E7EB', '--ui-radius': '8px',
      '--ui-shadow': '0 1px 2px rgba(15, 23, 42, 0.05)',
      '--ui-font-sans': '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif', '--ui-font-display': 'Georgia, "Source Serif 4", "Noto Serif SC", serif', '--ui-font-mono': '"JetBrains Mono", ui-monospace, monospace'
    }
  },
  {
    id: 'bento-craft', code: 'B', archetype: 'tactile-bento', layoutBadge: '浮岛胶囊导航 · 6卡便当盒网格', cardCount: 6, group: '品牌创意与消费门户',
    name: '方案 B · 现代便当盒卡片 (Tactile Bento)', badge: '模块卡片感',
    bestFor: ['portal', 'commerce', 'consumer', 'education', 'course', '电商', '门户', '培训', '课程', '工作台'],
    summary: '暖白亚麻底色配高对比纯白圆角模块格，森绿主色搭配琥珀强调色，层次分明且亲和力强。',
    typography: 'DM Sans / Noto Sans SC + Space Mono', layoutDensity: 'balanced',
    swatches: ['#F5F5F0', '#FFFFFF', '#0F766E', '#D97706'],
    tokens: {
      '--ui-bg': '#F5F5F0', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#EBEAE2',
      '--ui-text': '#1C1917', '--ui-muted': '#57534E', '--ui-primary': '#0F766E', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#D97706', '--ui-border': '#E2E0D8', '--ui-radius': '16px',
      '--ui-shadow': '0 6px 18px -4px rgba(28, 25, 23, 0.07)',
      '--ui-font-sans': '"DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif', '--ui-font-display': '"DM Sans", "PingFang SC", sans-serif', '--ui-font-mono': '"Space Mono", ui-monospace, monospace'
    }
  },
  {
    id: 'industrial-dark', code: 'C', archetype: 'cockpit-split', layoutBadge: '侧轨遥测条 · 8面板分栏驾驶舱', cardCount: 8, group: '深色与研发控制台',
    name: '方案 C · 深空精密控制台 (Linear Industrial)', badge: '专业深色台',
    bestFor: ['devtools', 'fintech', 'ops', 'security', 'monitor', 'data', '监控', '安全', '数据', '研发', '控制台'],
    summary: '深岩黑底与微光描边，青色信号焦点与等宽数字对齐，适合高密度状态监控与专业研发软件。',
    typography: 'Geist / Inter + JetBrains Mono (tabular-nums)', layoutDensity: 'compact',
    swatches: ['#0B0F17', '#131A26', '#06B6D4', '#10B981'],
    tokens: {
      '--ui-bg': '#0B0F17', '--ui-surface': '#131A26', '--ui-surface-muted': '#1C2536',
      '--ui-text': '#F1F5F9', '--ui-muted': '#94A3B8', '--ui-primary': '#06B6D4', '--ui-primary-fg': '#082F49',
      '--ui-accent': '#10B981', '--ui-border': '#263248', '--ui-radius': '10px',
      '--ui-shadow': '0 8px 24px rgba(0, 0, 0, 0.38)',
      '--ui-font-sans': '"Geist", "Inter", system-ui, sans-serif', '--ui-font-display': '"Geist", "Inter", sans-serif', '--ui-font-mono': '"JetBrains Mono", ui-monospace, monospace'
    }
  },
  {
    id: 'neo-brutal', code: 'D', archetype: 'brutal-poster', layoutBadge: '粗黑横幅 · 5卡错位硬阴影海报', cardCount: 5, group: '品牌创意与消费门户',
    name: '方案 D · 新粗野高反差工坊 (Neo-Brutalist)', badge: '鲜明个性风',
    bestFor: ['creative', 'studio', 'campaign', 'game', 'social', '创意', '活动', '社区', '设计'],
    summary: '暖米纸底 + 2px 纯黑实线边框与硬朗偏移投影，记忆点极强，彻底告别温吞模板感。',
    typography: 'Space Grotesk + IBM Plex Mono', layoutDensity: 'balanced',
    swatches: ['#FFFDF5', '#09090B', '#E11D48', '#FACC15'],
    tokens: {
      '--ui-bg': '#FFFDF5', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#FEF3C7',
      '--ui-text': '#09090B', '--ui-muted': '#3F3F46', '--ui-primary': '#E11D48', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#FACC15', '--ui-border': '#09090B', '--ui-radius': '6px',
      '--ui-shadow': '3px 3px 0px #09090B',
      '--ui-font-sans': '"Space Grotesk", system-ui, sans-serif'
    }
  },
  {
    id: 'enterprise-dense', code: 'E', archetype: 'ledger-workbench', layoutBadge: '双层顶栏+左树 · 7区合规台账台', cardCount: 7, group: '政企合规与高密度台账',
    name: '方案 E · 高密度政企合规台 (Polaris Enterprise)', badge: '严谨业务流',
    bestFor: ['erp', 'crm', 'audit', 'gov', 'hospital', '台账', '审批', '合规', '企业', '后台'],
    summary: '冷灰分层背景 + 高对比深蓝主操作 + 紧凑表格间距，保障长表单、审批流与安全台账零视觉疲劳。',
    typography: 'Inter / Source Han Sans + Roboto Mono', layoutDensity: 'compact',
    swatches: ['#F1F5F9', '#FFFFFF', '#0F172A', '#2563EB'],
    tokens: {
      '--ui-bg': '#F1F5F9', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#E2E8F0',
      '--ui-text': '#0F172A', '--ui-muted': '#475569', '--ui-primary': '#2563EB', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#0284C7', '--ui-border': '#CBD5E1', '--ui-radius': '6px',
      '--ui-shadow': '0 1px 3px rgba(15, 23, 42, 0.08)',
      '--ui-font-sans': '"Inter", "Microsoft YaHei", system-ui, sans-serif'
    }
  },
  {
    id: 'nordic-slate', code: 'F', archetype: 'editorial-asymmetric', layoutBadge: '非对称双栏 · 3区细线留白', cardCount: 3, group: '极简与现代办公',
    name: '方案 F · 北欧岩灰轻办公 (Nordic Slate)', badge: '清透低噪点',
    bestFor: ['workspace', 'calendar', 'notes', 'collab', '协同', '日程', '项目', '排期'],
    summary: '冰川雾白底色配青岩灰边框与海湾深蓝主钮，低饱和度长久阅读不刺眼。',
    typography: 'Inter / Noto Sans SC + Fira Code', layoutDensity: 'spacious',
    swatches: ['#F8FAFC', '#FFFFFF', '#1E3A8A', '#CBD5E1'],
    tokens: {
      '--ui-bg': '#F8FAFC', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#EFF6FF',
      '--ui-text': '#0F172A', '--ui-muted': '#64748B', '--ui-primary': '#1E3A8A', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#0369A1', '--ui-border': '#E2E8F0', '--ui-radius': '10px',
      '--ui-shadow': '0 2px 6px rgba(15, 23, 42, 0.04)',
      '--ui-font-sans': '"Inter", "PingFang SC", system-ui, sans-serif'
    }
  },
  {
    id: 'warm-paper', code: 'G', archetype: 'chronicle-cascade', layoutBadge: '双线居中刊头 · 5卡时间轴长卷', cardCount: 5, group: '极简与现代办公',
    name: '方案 G · 暖调纸感知识库 (Warm Parchment)', badge: '人文阅读感',
    bestFor: ['wiki', 'research', 'writing', 'library', '写作', '研报', '文档', '笔记'],
    summary: '温润原浆纸底色配炭黑墨字与赭石重点色，弱化机械框线，适合重度阅读与知识编纂。',
    typography: 'Source Serif 4 / Noto Serif SC + JetBrains Mono', layoutDensity: 'spacious',
    swatches: ['#FAF8F5', '#FFFFFF', '#9A3412', '#E7E5E4'],
    tokens: {
      '--ui-bg': '#FAF8F5', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#F5F2EB',
      '--ui-text': '#292524', '--ui-muted': '#78716C', '--ui-primary': '#9A3412', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#15803D', '--ui-border': '#E7E5E4', '--ui-radius': '8px',
      '--ui-shadow': '0 1px 3px rgba(41, 37, 36, 0.06)',
      '--ui-font-sans': '"Plus Jakarta Sans", "PingFang SC", sans-serif'
    }
  },
  {
    id: 'obsidian-terminal', code: 'H', archetype: 'cockpit-split', layoutBadge: '侧轨遥测条 · 8面板分栏驾驶舱', cardCount: 8, group: '深色与研发控制台',
    name: '方案 H · 黑曜石研发终端 (Obsidian Terminal)', badge: '极客终端风',
    bestFor: ['cli', 'ide', 'infra', 'cloud', 'pipeline', '部署', '流水线', '容器', '日志'],
    summary: '纯正黑曜石基底搭配翠绿运行信号灯与锐利直角分割，契合基础设施与流水线编排。',
    typography: 'JetBrains Mono / Inter', layoutDensity: 'compact',
    swatches: ['#090D16', '#111827', '#10B981', '#1F2937'],
    tokens: {
      '--ui-bg': '#090D16', '--ui-surface': '#111827', '--ui-surface-muted': '#1F2937',
      '--ui-text': '#ECFDF5', '--ui-muted': '#9CA3AF', '--ui-primary': '#10B981', '--ui-primary-fg': '#022C22',
      '--ui-accent': '#38BDF8', '--ui-border': '#374151', '--ui-radius': '6px',
      '--ui-shadow': '0 10px 28px rgba(0, 0, 0, 0.45)',
      '--ui-font-sans': '"Inter", "JetBrains Mono", monospace, sans-serif'
    }
  },
  {
    id: 'graphite-ops', code: 'I', archetype: 'cockpit-split', layoutBadge: '侧轨遥测条 · 8面板分栏驾驶舱', cardCount: 8, group: '深色与研发控制台',
    name: '方案 I · 石墨可观测指挥台 (Graphite Telemetry)', badge: '暗色态势图',
    bestFor: ['apm', 'noc', 'iot', 'dispatch', '告警', '调度', '遥测', '指挥'],
    summary: '中性暖石墨暗色层级配琥珀金主操作色，夜间大屏与长时值守不眩光。',
    typography: 'IBM Plex Sans + IBM Plex Mono', layoutDensity: 'compact',
    swatches: ['#121316', '#1B1D22', '#F59E0B', '#2E323B'],
    tokens: {
      '--ui-bg': '#121316', '--ui-surface': '#1B1D22', '--ui-surface-muted': '#252830',
      '--ui-text': '#F4F4F5', '--ui-muted': '#A1A1AA', '--ui-primary': '#F59E0B', '--ui-primary-fg': '#18181B',
      '--ui-accent': '#0EA5E9', '--ui-border': '#2E323B', '--ui-radius': '8px',
      '--ui-shadow': '0 8px 20px rgba(0, 0, 0, 0.4)',
      '--ui-font-sans': '"IBM Plex Sans", "Microsoft YaHei", sans-serif'
    }
  },
  {
    id: 'fin-ledger', code: 'J', archetype: 'ledger-workbench', layoutBadge: '双层顶栏+左树 · 7区合规台账台', cardCount: 7, group: '政企合规与高密度台账',
    name: '方案 J · 金融级风控核算台 (Financial Ledger)', badge: '高信噪比表',
    bestFor: ['finance', 'accounting', 'tax', 'billing', '财务', '对账', '结算', '风控', '报表'],
    summary: '银灰底板与高稳重深海蓝主色，强化数字等宽对齐与复核状态对比度。',
    typography: 'Inter + Roboto Mono (tabular-nums)', layoutDensity: 'compact',
    swatches: ['#F4F6F8', '#FFFFFF', '#0B4F6C', '#CBD5E1'],
    tokens: {
      '--ui-bg': '#F4F6F8', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#E6ECF2',
      '--ui-text': '#102A43', '--ui-muted': '#486581', '--ui-primary': '#0B4F6C', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#059669', '--ui-border': '#BCCCDC', '--ui-radius': '6px',
      '--ui-shadow': '0 1px 3px rgba(16, 42, 67, 0.08)',
      '--ui-font-sans': '"Inter", "Microsoft YaHei", sans-serif'
    }
  },
  {
    id: 'ehs-command', code: 'K', archetype: 'ledger-workbench', layoutBadge: '双层顶栏+左树 · 7区合规台账台', cardCount: 7, group: '政企合规与高密度台账',
    name: '方案 K · 工业安全巡检中枢 (EHS Safety Grid)', badge: '安全规范感',
    bestFor: ['ehs', 'manufacturing', 'inspection', 'quality', '安全', '巡检', '工厂', '特种设备', '隐患'],
    summary: '清爽雾绿灰背景配国标安全绿主色与警示橙辅助色，现场巡检与合规闭环一目了然。',
    typography: 'Source Han Sans / Inter + JetBrains Mono', layoutDensity: 'compact',
    swatches: ['#F2F6F4', '#FFFFFF', '#047857', '#D97706'],
    tokens: {
      '--ui-bg': '#F2F6F4', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#E3ECE7',
      '--ui-text': '#064E3B', '--ui-muted': '#3F6259', '--ui-primary': '#047857', '--ui-primary-fg': '#FFFFFF',
      '--ui-accent': '#D97706', '--ui-border': '#C6D8CE', '--ui-radius': '8px',
      '--ui-shadow': '0 2px 5px rgba(6, 78, 59, 0.07)',
      '--ui-font-sans': '"Inter", "Microsoft YaHei", sans-serif'
    }
  },
  {
    id: 'editorial-serif', code: 'L', archetype: 'chronicle-cascade', layoutBadge: '双线居中刊头 · 5卡时间轴长卷', cardCount: 5, group: '品牌创意与消费门户',
    name: '方案 L · 先锋买手消费门户 (Editorial Commerce)', badge: '质感品牌风',
    bestFor: ['brand', 'retail', 'booking', 'lifestyle', '品牌', '商城', '预约', '消费', '展示'],
    summary: '象牙暖底与深炭黑主视觉形成经典杂志感反差，陶土红点睛，凸显商品与内容质感。',
    typography: 'Playfair Display / DM Sans + Noto Sans SC', layoutDensity: 'spacious',
    swatches: ['#FBF9F6', '#FFFFFF', '#18181B', '#C2410C'],
    tokens: {
      '--ui-bg': '#FBF9F6', '--ui-surface': '#FFFFFF', '--ui-surface-muted': '#F3EFEA',
      '--ui-text': '#18181B', '--ui-muted': '#52525B', '--ui-primary': '#18181B', '--ui-primary-fg': '#FAFAFA',
      '--ui-accent': '#C2410C', '--ui-border': '#E4E0DA', '--ui-radius': '12px',
      '--ui-shadow': '0 6px 20px -6px rgba(24, 24, 27, 0.09)',
      '--ui-font-sans': '"DM Sans", "PingFang SC", sans-serif'
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
    `- **所属分组**：${chosen.group}`,
    `- **核心气质**：${chosen.summary}`,
    `- **字体配对**：${chosen.typography}`,
    `- **空间密度**：\`${chosen.layoutDensity}\``,
    `- **页面骨架**：\`${chosen.archetype || 'editorial-asymmetric'}\`（${chosen.layoutBadge || ''}）`,
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
    proposalGroup: chosen.group,
    proposalName: chosen.name,
    masterFile: 'design-system/MASTER.md',
    tokens: chosen.tokens
  };
  writeFileSync(join(root, '.donegate', 'ui-design-lock.json'), JSON.stringify(lockPayload, null, 2) + '\n', 'utf8');
  return lockPayload;
}

export const WCAG_MIN_READABLE_CONTRAST_RATIO = 3.0;
export const WCAG_AA_NORMAL_CONTRAST_RATIO = 4.5;

const SRGB_CHANNEL_MAX = 255, SRGB_LINEAR_THRESHOLD = 0.04045, SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055, SRGB_GAMMA_DIVISOR = 1.055, SRGB_GAMMA_EXPONENT = 2.4;
const REL_LUM_RED = 0.2126, REL_LUM_GREEN = 0.7152, REL_LUM_BLUE = 0.0722, CONTRAST_LUM_OFFSET = 0.05, CONTRAST_PRECISION_FACTOR = 100;
const HEX_SHORT_LEN = 3, HEX_SHORT_ALPHA_LEN = 4, HEX_FULL_LEN = 6, HEX_FULL_ALPHA_LEN = 8, HEX_RADIX = 16, HEX_PAIR_STEP = 2;
const DEFAULT_CANVAS_RGB = Object.freeze({ r: 255, g: 255, b: 255 });
const NAMED_CSS_COLORS = Object.freeze({
  white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0],
  red: [255, 0, 0, 1], green: [0, 128, 0, 1], blue: [0, 0, 255, 1],
  gray: [128, 128, 128, 1], grey: [128, 128, 128, 1], yellow: [255, 255, 0, 1]
});

function parseHexColorString(hexBody) {
  let full = hexBody;
  if (hexBody.length === HEX_SHORT_LEN || hexBody.length === HEX_SHORT_ALPHA_LEN) {
    full = [...hexBody].map((c) => c + c).join('');
  }
  if (full.length !== HEX_FULL_LEN && full.length !== HEX_FULL_ALPHA_LEN) return null;
  if (!/^[0-9a-f]+$/i.test(full)) return null;
  const r = parseInt(full.slice(0, HEX_PAIR_STEP), HEX_RADIX);
  const g = parseInt(full.slice(HEX_PAIR_STEP, HEX_PAIR_STEP * HEX_PAIR_STEP), HEX_RADIX);
  const b = parseInt(full.slice(HEX_PAIR_STEP * HEX_PAIR_STEP, HEX_FULL_LEN), HEX_RADIX);
  const a = full.length === HEX_FULL_ALPHA_LEN ? parseInt(full.slice(HEX_FULL_LEN, HEX_FULL_ALPHA_LEN), HEX_RADIX) / SRGB_CHANNEL_MAX : 1;
  return { r, g, b, a };
}

function parseRgbFuncString(raw) {
  const m = raw.match(/^rgba?\(\s*([0-9.]+)\s*(?:,|\s)\s*([0-9.]+)\s*(?:,|\s)\s*([0-9.]+)(?:\s*(?:,|\/)\s*([0-9.]+))?\s*\)$/i);
  if (!m) return null;
  const clampCh = (v) => Math.max(0, Math.min(SRGB_CHANNEL_MAX, Number(v)));
  const alpha = m[HEX_SHORT_ALPHA_LEN] !== undefined ? Math.max(0, Math.min(1, Number(m[HEX_SHORT_ALPHA_LEN]))) : 1;
  return { r: clampCh(m[1]), g: clampCh(m[HEX_PAIR_STEP]), b: clampCh(m[HEX_SHORT_LEN]), a: alpha };
}

function parseCssColorToRgba(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  if (NAMED_CSS_COLORS[raw]) {
    const [r, g, b, a] = NAMED_CSS_COLORS[raw];
    return { r, g, b, a };
  }
  if (raw.startsWith('#')) return parseHexColorString(raw.slice(1));
  if (raw.startsWith('rgb')) return parseRgbFuncString(raw);
  return null;
}

function compositeOverBackdrop(fg, bg) {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  const inv = 1 - fg.a;
  return { r: fg.r * fg.a + bg.r * inv, g: fg.g * fg.a + bg.g * inv, b: fg.b * fg.a + bg.b * inv };
}

function srgbToLinear(channel) {
  const norm = channel / SRGB_CHANNEL_MAX;
  if (norm <= SRGB_LINEAR_THRESHOLD) return norm / SRGB_LINEAR_DIVISOR;
  return ((norm + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR) ** SRGB_GAMMA_EXPONENT;
}

function computeRelativeLuminance(rgb) {
  return REL_LUM_RED * srgbToLinear(rgb.r) + REL_LUM_GREEN * srgbToLinear(rgb.g) + REL_LUM_BLUE * srgbToLinear(rgb.b);
}

export function computeContrastRatio(fgHexOrRgb, bgHexOrRgb, opts = {}) {
  const minReadableRatio = Number(opts.minReadableRatio || WCAG_MIN_READABLE_CONTRAST_RATIO), aaRatio = Number(opts.aaRatio || WCAG_AA_NORMAL_CONTRAST_RATIO);
  const fgParsed = parseCssColorToRgba(fgHexOrRgb), bgParsed = parseCssColorToRgba(bgHexOrRgb);
  if (!fgParsed || !bgParsed) return { valid: false, ratio: null, readable: false, severeUnreadable: false, passesAa: false, minReadableRatio, aaRatio };
  const effectiveBg = compositeOverBackdrop(bgParsed, DEFAULT_CANVAS_RGB), effectiveFg = compositeOverBackdrop(fgParsed, effectiveBg);
  const fgLum = computeRelativeLuminance(effectiveFg), bgLum = computeRelativeLuminance(effectiveBg);
  const rawRatio = (Math.max(fgLum, bgLum) + CONTRAST_LUM_OFFSET) / (Math.min(fgLum, bgLum) + CONTRAST_LUM_OFFSET);
  const ratio = Math.round(rawRatio * CONTRAST_PRECISION_FACTOR) / CONTRAST_PRECISION_FACTOR;
  return { valid: true, ratio, readable: ratio >= minReadableRatio, severeUnreadable: ratio < minReadableRatio, passesAa: ratio >= aaRatio, minReadableRatio, aaRatio };
}

function auditInlineLowContrastStyles(src, warnings) {
  for (const m of src.matchAll(/(?:style\s*=\s*["']([^"']+)["']|\{([^{}]{8,320})\})/gi)) {
    const decl = m[1] || m[HEX_PAIR_STEP] || '';
    const fgM = decl.match(/(?:^|;)\s*color\s*:\s*([^;!]+)/i);
    const bgM = decl.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/i);
    if (!fgM || !bgM) continue;
    const bgVal = bgM[1].trim().split(/\s+/)[0];
    const c = computeContrastRatio(fgM[1].trim(), bgVal);
    if (c.valid && c.severeUnreadable) {
      warnings.push(`检出严重低对比度不可读文本 (${c.ratio}:1 < ${WCAG_MIN_READABLE_CONTRAST_RATIO}:1)，疑似白底白字或黑底黑字`);
      break;
    }
  }
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
  auditInlineLowContrastStyles(src, warnings);
  return { pass: warnings.length === 0, warnings };
}

export const UI_AESTHETICS_RUBRIC_DIMENSIONS = Object.freeze([
  { id: 'designQuality', label: '设计质量 (Design Quality)', weight: 0.25, focus: '色彩层级、视觉令牌与对比度一致性' },
  { id: 'originality', label: '原创性 (Originality)', weight: 0.25, focus: '杜绝紫粉霓虹渐变与 Emoji 按钮等 AI 模板脸' },
  { id: 'craft', label: '工艺细节 (Craft)', weight: 0.25, focus: '语义化标签、focus 态与组件归属锚点 data-ui-owner' },
  { id: 'functionality', label: '功能完整度 (Functionality)', weight: 0.25, focus: '零控制台报错、零页面崩溃、零 4xx/5xx、零空壳死按钮' }
]);

export const UI_RUBRIC_FEW_SHOT_CALIBRATION = Object.freeze({
  goodExample: '使用 :root 语义 CSS 变量、单焦点主色、SVG 几何图标与真实响应状态变更的可交互控件',
  badExample: '紫粉霓虹线性渐变卡片 + 纯 Emoji 按钮 + 点击后零反应的空壳按钮 + 控制台未捕获异常'
});

const RUBRIC_MAX_SCORE = 100, RUBRIC_PASS_FLOOR = 75, RUBRIC_DIM_COUNT = 4;
const MISSING_CSS_VARS_PENALTY = 15, MISSING_SEMANTIC_PENALTY = 10, SLOP_WARNING_PENALTY = 35, MISSING_FOCUS_PENALTY = 10, MISSING_OWNER_PENALTY = 10;
const CONSOLE_ERR_PENALTY = 25, PAGE_ERR_PENALTY = 35, HTTP_ERR_PENALTY = 20, DEAD_BTN_PENALTY = 25, LOW_CONTRAST_PENALTY = 35, VIEWPORT_OVERFLOW_PENALTY = 25;

function appendRuntimeVisualWarnings(lowContrastCount, overflowCount, warnings) {
  if (lowContrastCount > 0) warnings.push(`运行态检出 ${lowContrastCount} 处严重低对比度不可读元素 (< ${WCAG_MIN_READABLE_CONTRAST_RATIO}:1)`);
  if (overflowCount > 0) warnings.push(`运行态检出 ${overflowCount} 处双视口横向布局溢出`);
}

export function evaluateUiAestheticsRubric(htmlText, runtime = {}) {
  const src = String(htmlText || '');
  const antiSlop = auditHtmlAntiAiSlop(src);
  const warnings = [...antiSlop.warnings];
  const lowContrastCount = Number(runtime.lowContrastCount || 0);
  const overflowCount = Number(runtime.overflowCount || 0);
  appendRuntimeVisualWarnings(lowContrastCount, overflowCount, warnings);

  const usesCssVars = /--[a-z0-9-]+\s*:/i.test(src) || /var\(--[a-z0-9-]+\)/i.test(src);
  const hasFocusStyle = /:focus(?:-visible)?\b/i.test(src);
  const hasUiOwner = /data-ui-owner=/i.test(src);
  const hasSemanticMain = /<(?:main|header|nav|section)\b/i.test(src);

  const cssPen = (usesCssVars ? 0 : MISSING_CSS_VARS_PENALTY) + (hasSemanticMain ? 0 : MISSING_SEMANTIC_PENALTY);
  const designQuality = Math.max(0, RUBRIC_MAX_SCORE - cssPen - lowContrastCount * LOW_CONTRAST_PENALTY - overflowCount * VIEWPORT_OVERFLOW_PENALTY);
  const originality = Math.max(0, RUBRIC_MAX_SCORE - antiSlop.warnings.length * SLOP_WARNING_PENALTY);
  const craft = Math.max(0, RUBRIC_MAX_SCORE - (hasFocusStyle ? 0 : MISSING_FOCUS_PENALTY) - (hasUiOwner ? 0 : MISSING_OWNER_PENALTY));

  const runtimePenalty = Number(runtime.consoleErrorCount || 0) * CONSOLE_ERR_PENALTY +
    Number(runtime.pageErrorCount || 0) * PAGE_ERR_PENALTY +
    Number(runtime.httpErrorCount || 0) * HTTP_ERR_PENALTY +
    Number(runtime.deadButtonCount || 0) * DEAD_BTN_PENALTY +
    overflowCount * VIEWPORT_OVERFLOW_PENALTY;
  const functionality = Math.max(0, RUBRIC_MAX_SCORE - runtimePenalty);

  const dimensions = { designQuality, originality, craft, functionality };
  const totalScore = Math.round((designQuality + originality + craft + functionality) / RUBRIC_DIM_COUNT);
  const pass = antiSlop.pass && lowContrastCount === 0 && overflowCount === 0 && functionality >= RUBRIC_PASS_FLOOR && totalScore >= RUBRIC_PASS_FLOOR;
  return { pass, totalScore, dimensions, warnings, antiSlopChecklist: ANTI_AI_SLOP_RULES, calibration: UI_RUBRIC_FEW_SHOT_CALIBRATION };
}
