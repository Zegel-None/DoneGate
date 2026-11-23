// 生成符合 DSH 创造模式 (dsh-doc) 官方规范的多语言元数据、36x36 矢量图标与 640x300 无文字详情预览图（<= 160 行）

export function renderDshLocaleZhJson() {
  return JSON.stringify({
    meta: {
      title: '完结门工作台',
      description: '在会话顶栏与输入框左侧新增「完结门」入口，仅接管消息记录区嵌入无限项目看板与确定性工作流画布，完整保留底部原生输入框、蓝色行内引用胶囊累加、悬停折叠回执条与右栏源码预览。',
      detail: 'docs/DETAIL.zh.md'
    }
  }, null, 2) + '\n';
}

export function renderDshLocaleEnJson() {
  return JSON.stringify({
    meta: {
      title: 'DoneGate workbench',
      description: 'Adds a DoneGate view tab and composer shortcut that replaces only the transcript area with an infinite project kanban and deterministic workflow canvas, keeping the native message composer, inline quote chips, hover-collapsible status dock, and right-sidebar file preview.',
      detail: 'docs/DETAIL.md'
    }
  }, null, 2) + '\n';
}

export function renderDshDetailMd(lang = 'en') {
  if (lang === 'zh') {
    return '![完结门工作台在会话视图中接管消息区并联动底部引用胶囊](preview.svg)\n';
  }
  return '![DoneGate workbench inside the conversation view with inline quote chips](preview.svg)\n';
}

export function renderDshIconSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">',
    '  <path d="M8 27V12.5C8 9.46 10.46 7 13.5 7h9C25.54 7 28 9.46 28 12.5V27" fill="none" stroke="#247bbf" stroke-width="2.6" stroke-linecap="round"/>',
    '  <path d="M6 27h24" fill="none" stroke="#247bbf" stroke-width="2.6" stroke-linecap="round"/>',
    '  <circle cx="18" cy="17.5" r="5.2" fill="#1ea672"/>',
    '  <path d="M15.6 17.6l1.7 1.7 3.3-3.4" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg>',
    ''
  ].join('\n');
}

export function renderDshPreviewSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300">',
    '  <rect x="32" y="24" width="576" height="252" rx="14" fill="#161922" stroke="#2d3343" stroke-width="1.5"/>',
    '  <rect x="32" y="24" width="96" height="252" rx="14" fill="#12151c"/>',
    '  <rect x="46" y="44" width="68" height="12" rx="6" fill="#252b3b"/>',
    '  <rect x="46" y="68" width="54" height="8" rx="4" fill="#2d3548"/>',
    '  <rect x="46" y="86" width="60" height="8" rx="4" fill="#2d3548"/>',
    '  <rect x="488" y="24" width="120" height="252" rx="14" fill="#12151c"/>',
    '  <rect x="502" y="46" width="92" height="10" rx="5" fill="#252b3b"/>',
    '  <rect x="502" y="68" width="84" height="58" rx="8" fill="#1b2434" stroke="#2b4c7e" stroke-width="1"/>',
    '  <rect x="502" y="136" width="84" height="44" rx="8" fill="#192924" stroke="#1ea672" stroke-width="1"/>',
    '  <rect x="142" y="38" width="42" height="14" rx="7" fill="#252b3b"/>',
    '  <rect x="190" y="38" width="52" height="14" rx="7" fill="#247bbf"/>',
    '  <rect x="248" y="38" width="42" height="14" rx="7" fill="#252b3b"/>',
    '  <rect x="142" y="62" width="332" height="134" rx="10" fill="#0f1218" stroke="#262c3a" stroke-width="1"/>',
    '  <rect x="162" y="92" width="82" height="54" rx="8" fill="#1b2230" stroke="#3b82f6" stroke-width="1.5"/>',
    '  <rect x="278" y="84" width="86" height="68" rx="8" fill="#1b2230" stroke="#1ea672" stroke-width="1.5"/>',
    '  <circle cx="352" cy="96" r="6" fill="#1ea672"/>',
    '  <path d="M244 119h34" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 3"/>',
    '  <path d="M364 119h28" fill="none" stroke="#1ea672" stroke-width="2"/>',
    '  <rect x="392" y="96" width="64" height="46" rx="8" fill="#1b2230" stroke="#64748b" stroke-width="1.2"/>',
    '  <rect x="142" y="204" width="332" height="16" rx="6" fill="#1b2434" stroke="#247bbf" stroke-width="1"/>',
    '  <rect x="142" y="226" width="332" height="38" rx="10" fill="#1c202b" stroke="#333b4f" stroke-width="1.2"/>',
    '  <rect x="152" y="235" width="66" height="18" rx="9" fill="#1d3557" stroke="#3b82f6" stroke-width="1"/>',
    '  <rect x="224" y="235" width="74" height="18" rx="9" fill="#1d3557" stroke="#3b82f6" stroke-width="1"/>',
    '  <circle cx="456" cy="245" r="10" fill="#247bbf"/>',
    '</svg>',
    ''
  ].join('\n');
}
