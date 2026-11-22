// 预置宏打底 + 节点级即时变招（JIT 配招器）：总控/Worker 权限硬隔离、底座护栏只增不减锁、.deps 就绪度优先与一键沉淀宏
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';
import { readSavedWorkbenchState } from '../atlas/hydrate-workbench.mjs';
import { inspectWorkflowDeps } from './workflow-deps.mjs';
import { buildBrickNodeExecSpec } from './brick-exec.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CORE_ATOMIC_BRICKS = {
  'tpl-anti-slop': {
    tplId: 'tpl-anti-slop', category: '代码护栏', title: '防 AI 手搓护栏套件', mandatoryFloor: true, zeroDep: true,
    tip: '内置底线护栏：合并禁止空 catch、禁私引底层子进程与体积膨胀硬拦截',
    inputs: [{ id: 'in_src', name: '代码工作区', type: 'ARTIFACT' }],
    outputs: [{ id: 'out_art', name: '合规代码快照', type: 'ARTIFACT' }, { id: 'out_txt', name: '违规行号报告', type: 'TEXT' }],
    slots: [{ id: 'as_1', label: '合规代码快照放行通道', wired: true, boundOut: 'out_art' }]
  },
  'tpl-openspec': {
    tplId: 'tpl-openspec', category: '筹备与润色', title: 'OpenSpec 规格审校积木',
    repoSlug: 'Fission-AI/OpenSpec', repoUrl: 'https://github.com/Fission-AI/OpenSpec', pinnedVersion: 'v0.2.4',
    tip: '写码前扫描需求变更与公式/边界规格是否有冲突遗漏',
    inputs: [{ id: 'in_spec', name: '需求草案', type: 'SPEC' }],
    outputs: [{ id: 'out_rep', name: '评估原文报告', type: 'TEXT' }, { id: 'out_sig', name: '0-3 完整度信号', type: 'SIGNAL' }],
    slots: [{ id: 'os_1', label: '需求冲突与边界报告', wired: true, boundOut: 'out_rep' }]
  },
  'tpl-deai-polish': {
    tplId: 'tpl-deai-polish', category: '筹备与润色', title: '去 AI 味文案润色套件', zeroDep: true,
    tip: '清理套话与机械腔，支持未达标自循环重润色',
    inputs: [{ id: 'in_draft', name: '待润色文本', type: 'TEXT' }],
    outputs: [{ id: 'out_clean', name: '自然定稿放行', type: 'TEXT' }, { id: 'out_retry', name: '仍有AI味回流口', type: 'TEXT' }],
    slots: [{ id: 'dp_1', label: '自然定稿放行', wired: true, boundOut: 'out_clean' }]
  },
  'tpl-prompt-gen': {
    tplId: 'tpl-prompt-gen', category: '筹备与润色', title: '上下文提示词拼装器', zeroDep: true,
    tip: '将上游报告、公共原语索引与修改边界组装成结构化提示词',
    inputs: [{ id: 'in_txt', name: '报告或规格', type: 'TEXT' }],
    outputs: [{ id: 'out_prm', name: '结构化提示词', type: 'PROMPT' }],
    slots: [{ id: 'pg_1', label: '注入原语防手搓提示词', wired: true, boundOut: 'out_prm' }]
  },
  'tpl-biome-knip': {
    tplId: 'tpl-biome-knip', category: '代码护栏', title: 'Biome 语法与死代码积木',
    repoSlug: 'biomejs/biome', repoUrl: 'https://github.com/biomejs/biome', pinnedVersion: 'v1.9.4',
    tip: '静态语法错误检查与无用死代码清理',
    inputs: [{ id: 'in_art', name: 'JS/TS 源码', type: 'ARTIFACT' }],
    outputs: [{ id: 'out_sig', name: '0-3 状态码', type: 'SIGNAL' }, { id: 'out_dead', name: '死代码清单原文', type: 'TEXT' }],
    slots: [{ id: 'bk_1', label: '语法错误 0-3 判定口', wired: true, boundOut: 'out_sig' }]
  },
  'tpl-router-rule': {
    tplId: 'tpl-router-rule', category: '基础与分支', title: '规则条件分支接口', zeroDep: true,
    tip: '按 0/1/2/3 返回码分流，自动承接外部断网或环境缺失离线桩降级',
    inputs: [{ id: 'in_sig', name: '状态或指标', type: 'SIGNAL' }],
    outputs: [
      { id: 'out_0', name: '0 过关放行', type: 'SIGNAL' },
      { id: 'out_1', name: '1 触发拦截', type: 'TEXT' },
      { id: 'out_3', name: '2/3 缺环境降级', type: 'TEXT' }
    ],
    slots: [{ id: 's_0', label: '0 号口放行下游测试', wired: true, boundOut: 'out_0' }, { id: 's_3', label: '2/3 号口切离线桩降级', wired: true, boundOut: 'out_3' }]
  },
  'tpl-router-ai': {
    tplId: 'tpl-router-ai', category: '基础与分支', title: 'AI 语义条件分支接口', zeroDep: true,
    tip: '阅读长文报告或设计草案，按业务成熟度走不同分支',
    inputs: [{ id: 'in_txt', name: '原文或方案', type: 'TEXT' }],
    outputs: [{ id: 'out_ok', name: '齐全可放行', type: 'SPEC' }, { id: 'out_trim', name: '未达标回流', type: 'TEXT' }],
    slots: [{ id: 'ai_ok', label: '达标放行出口', wired: true, boundOut: 'out_ok' }]
  },
  'tpl-playwright': {
    tplId: 'tpl-playwright', category: '端侧与构建', title: 'Playwright 网页联调积木',
    repoSlug: 'microsoft/playwright', repoUrl: 'https://github.com/microsoft/playwright', pinnedVersion: 'v1.48.0',
    tip: '真实无头浏览器端到端页面点击流与控制台红字捕获',
    inputs: [{ id: 'in_gate', name: '前置放行信号', type: 'SIGNAL' }],
    outputs: [{ id: 'out_sig', name: '0-3 联调码', type: 'SIGNAL' }, { id: 'out_err', name: '页面报错摘要', type: 'TEXT' }],
    slots: [{ id: 'pw_1', label: '关键页面无白屏 0-3 判定口', wired: true, boundOut: 'out_sig' }]
  },
  'tpl-gradle': {
    tplId: 'tpl-gradle', category: '端侧与构建', title: 'Gradle 安卓构建器',
    repoSlug: 'gradle/gradle', repoUrl: 'https://github.com/gradle/gradle', pinnedVersion: 'v8.10.2',
    tip: '执行 assembleRelease 产出 APK 安装包供下游真机测试',
    inputs: [{ id: 'in_src', name: '源码快照', type: 'ARTIFACT' }],
    outputs: [{ id: 'out_apk', name: 'APK 安装包', type: 'ARTIFACT' }],
    slots: [{ id: 'gr_1', label: '输出 APK 文件与哈希指纹', wired: true, boundOut: 'out_apk' }]
  },
  'tpl-maestro': {
    tplId: 'tpl-maestro', category: '端侧与构建', title: 'Maestro 安卓交互积木',
    repoSlug: 'mobile-dev-inc/Maestro', repoUrl: 'https://github.com/mobile-dev-inc/Maestro', pinnedVersion: 'v1.38.1',
    tip: '驱动安卓模拟器执行核心用户点击流并捕获闪退',
    inputs: [{ id: 'in_apk', name: '待测 APK', type: 'ARTIFACT' }],
    outputs: [{ id: 'out_sig', name: '0-3 验收码', type: 'SIGNAL' }],
    slots: [{ id: 'ms_1', label: '核心页面可点通 0-3 裁决口', wired: true, boundOut: 'out_sig' }]
  },
  'tpl-gitleaks': {
    tplId: 'tpl-gitleaks', category: '安全与运维', title: 'Gitleaks 密钥防泄漏积木',
    repoSlug: 'gitleaks/gitleaks', repoUrl: 'https://github.com/gitleaks/gitleaks', pinnedVersion: 'v8.18.4',
    tip: '拦截误提交的 API 密钥、私钥与数据库口令',
    inputs: [{ id: 'in_repo', name: '代码变更', type: 'ANY' }],
    outputs: [{ id: 'out_sig', name: '0-3 安全码', type: 'SIGNAL' }, { id: 'out_leak', name: '脱敏命中位置', type: 'TEXT' }],
    slots: [{ id: 'gl_1', label: '硬编码私钥清零状态口', wired: true, boundOut: 'out_sig' }]
  },
  'tpl-human-gate': {
    tplId: 'tpl-human-gate', category: '基础与分支', title: '人工审批闸门', isHumanGate: true, zeroDep: true,
    tip: '运行到本节点自动挂起待审，人工批准后从断点续跑',
    inputs: [{ id: 'in_gate', name: '前置验证信号', type: 'SIGNAL' }],
    outputs: [{ id: 'out_go', name: '人工批准放行', type: 'FLOW' }],
    slots: [{ id: 'hg_1', label: '过夜挂机遇此自动挂起待审', wired: true, boundOut: 'out_go' }]
  }
};

export function assertPlannerAuthority(actorRole = 'super-agent') {
  const norm = String(actorRole || 'super-agent').trim().toLowerCase();
  if (norm === 'worker' || norm === 'executor' || norm === 'coder') {
    return {
      ok: false,
      exitCode: 2,
      code: 'WORKER_CANNOT_MUTATE_WORKFLOW',
      reason: '权限隔离拦截：执行端 Worker 仅可按锁定连招过关，无权选配、篡改或删减验收连招（仅限总控 Super Agent 或人工操作）'
    };
  }
  return { ok: true, role: norm === 'human' || norm === 'owner' ? 'human' : 'super-agent' };
}

export function listAtomicBrickCatalog(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const map = new Map();
  for (const [tplId, item] of Object.entries(CORE_ATOMIC_BRICKS)) {
    const depProbe = item.zeroDep ? { ready: true, missingCount: 0 } : inspectWorkflowDeps(root, { id: `probe-${tplId}`, nodes: [{ id: 'n1', ...item }] });
    map.set(tplId, { ...item, ready: depProbe.ready, missingCount: depProbe.missingCount });
  }
  const localReg = join(root, 'adapters.registry.json');
  const regPath = existsSync(localReg) ? localReg : join(DG_ROOT, 'adapters.registry.json');
  const regRes = readJsonStrict(regPath);
  for (const adp of (regRes.ok && Array.isArray(regRes.value?.adapters) ? regRes.value.adapters : [])) {
    const tool = String(adp.tool || '').trim();
    if (!tool) continue;
    const tplId = `tpl-adp-${tool}`;
    if (map.has(tplId)) continue;
    const capPath = existsSync(join(root, 'bricks', tool, 'capabilities.json'))
      ? join(root, 'bricks', tool, 'capabilities.json')
      : join(DG_ROOT, 'bricks', tool, 'capabilities.json');
    const cap = readJsonStrict(capPath).value || {};
    const card = cap.card || {};
    const up = cap.upstream || {};
    const nodeStub = {
      tplId, tool, category: card.category || '代码护栏',
      title: card.title || `${tool} 砂浆转接积木`,
      repoSlug: up.repo || '', repoUrl: up.homepage || (up.repo ? `https://github.com/${up.repo}` : ''),
      pinnedVersion: adp.testedToolRange || 'v1.0.0',
      tip: card.summary || `砂浆协议确定性转接积木（${tool}）`,
      inputs: Array.isArray(card.inputs) && card.inputs.length ? card.inputs : [{ id: 'in_src', name: '代码快照', type: 'ARTIFACT' }],
      outputs: Array.isArray(card.outputs) && card.outputs.length ? card.outputs : [{ id: 'out_sig', name: '0-3 判定码', type: 'SIGNAL' }],
      slots: [{ id: 'ob_0', label: `${tool} 核心门禁`, wired: true, boundOut: 'out_sig' }]
    };
    const depProbe = inspectWorkflowDeps(root, { id: `probe-${tool}`, nodes: [{ id: 'n1', ...nodeStub }] });
    map.set(tplId, { ...nodeStub, ready: depProbe.ready, missingCount: depProbe.missingCount });
  }
  return map;
}

function arePortsCompatible(outType, inType) {
  if (!outType || !inType || outType === 'ANY' || inType === 'ANY' || outType === inType) return true;
  if ((outType === 'TEXT' && (inType === 'SPEC' || inType === 'PROMPT')) || (outType === 'SPEC' && inType === 'TEXT')) return true;
  if (outType === 'SIGNAL' && inType === 'FLOW') return true;
  return false;
}

export function composeBrickChainToPack(brickMap, tplIds, meta = {}) {
  const unknown = tplIds.filter((id) => !brickMap.has(id));
  if (unknown.length > 0) {
    return { ok: false, exitCode: 2, code: 'UNKNOWN_BRICK_REJECTED', unknownTplIds: unknown, reason: `禁止手搓散装脚本：未注册的非标积木 ${unknown.join(', ')}` };
  }
  const nodes = tplIds.map((tplId, idx) => {
    const tpl = brickMap.get(tplId);
    const origin = (meta.originByTpl && meta.originByTpl[tplId]) || (tpl.mandatoryFloor ? 'floor' : 'macro');
    return {
      id: `jit-${idx + 1}-${tplId.replace(/^tpl-/, '')}`,
      tplId: tpl.tplId,
      title: tpl.title,
      tip: tpl.tip,
      repoSlug: tpl.repoSlug || '',
      repoUrl: tpl.repoUrl || '',
      pinnedVersion: tpl.pinnedVersion || '',
      isHumanGate: Boolean(tpl.isHumanGate),
      tool: tpl.tool || '',
      exec: buildBrickNodeExecSpec(tpl.tplId, tpl),
      jitOrigin: origin,
      lockedFloor: Boolean(meta.floorSet && meta.floorSet.has(tplId)),
      x: 42 + idx * 304,
      y: 96,
      w: 252,
      h: null,
      inputs: JSON.parse(JSON.stringify(tpl.inputs || [{ id: 'in_any', name: '输入', type: 'ANY' }])),
      outputs: JSON.parse(JSON.stringify(tpl.outputs || [{ id: 'out_any', name: '输出', type: 'ANY' }])),
      slots: JSON.parse(JSON.stringify(tpl.slots || []))
    };
  });
  const links = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    let pickedOut = a.outputs[0];
    let pickedIn = b.inputs[0];
    for (const o of a.outputs) {
      const hit = b.inputs.find((inp) => arePortsCompatible(o.type, inp.type));
      if (hit) { pickedOut = o; pickedIn = hit; break; }
    }
    if (pickedOut && pickedIn) {
      links.push({
        id: `jit-lk-${i + 1}`,
        fromNode: a.id,
        fromSlot: pickedOut.id,
        toNode: b.id,
        toSlot: pickedIn.id,
        type: pickedOut.type || 'ANY'
      });
    }
  }
  return {
    ok: true,
    pack: {
      schemaVersion: '1.0',
      id: meta.id || 'jit-ephemeral',
      name: meta.name || '节点即时连招',
      group: meta.group || '节点派生连招',
      tip: meta.tip || '由总控 Super Agent 从确定性原子积木池自动装配',
      mandatoryTplIds: meta.floorSet ? [...meta.floorSet] : ['tpl-anti-slop'],
      matchProfile: meta.matchProfile || {},
      nodes,
      links,
      groups: []
    }
  };
}

const BUILTIN_MACRO_DEFS = [
  {
    id: 'pack-core-logic', name: '核心纯逻辑护栏包', group: '客户端与全栈',
    tplIds: ['tpl-anti-slop', 'tpl-router-rule', 'tpl-prompt-gen'],
    mandatoryTplIds: ['tpl-anti-slop'],
    matchProfile: { domains: ['core', 'tool', 'logic'], exts: ['.mjs', '.js', '.ts', '.py'], keywords: ['计算', '算法', '引擎', '内核', '逻辑', '门禁', '底座', '工具', '脚手架', '转接'] }
  },
  {
    id: 'pack-web', name: '网页全栈开发包', group: '客户端与全栈',
    tplIds: ['tpl-anti-slop', 'tpl-biome-knip', 'tpl-router-rule', 'tpl-playwright'],
    mandatoryTplIds: ['tpl-anti-slop'],
    matchProfile: { domains: ['ui', 'web'], exts: ['.tsx', '.jsx', '.vue', '.css', '.html'], keywords: ['界面', 'ui', '画布', '前端', '页面', '弹窗', '工作台', '按钮', '视图', '看板'] }
  },
  {
    id: 'pack-api-guard', name: '接口与密钥联防包', group: '安全与运维',
    tplIds: ['tpl-anti-slop', 'tpl-gitleaks', 'tpl-router-rule'],
    mandatoryTplIds: ['tpl-anti-slop', 'tpl-gitleaks'],
    matchProfile: { domains: ['api', 'security'], exts: ['.ts', '.py', '.mjs'], keywords: ['接口', '路由', '鉴权', '收银', '支付', '账本', '密钥', '网关', '订单', 'token', 'oauth', 'webhook'] }
  },
  {
    id: 'pack-android', name: '安卓开发包', group: '客户端与全栈',
    tplIds: ['tpl-anti-slop', 'tpl-gradle', 'tpl-maestro'],
    mandatoryTplIds: ['tpl-anti-slop'],
    matchProfile: { domains: ['mobile', 'android'], exts: ['.kt', '.java', '.gradle'], keywords: ['安卓', 'android', 'apk', '移动端'] }
  },
  {
    id: 'pack-polish-loop', name: '去 AI 味循环润色包', group: '内容润色与筹备',
    tplIds: ['tpl-openspec', 'tpl-deai-polish', 'tpl-prompt-gen'],
    mandatoryTplIds: ['tpl-deai-polish'],
    matchProfile: { domains: ['docs', 'spec'], exts: ['.md'], keywords: ['文档', '文案', '规格', '润色', '契约', '立约', '说明'] }
  },
  {
    id: 'pack-release', name: '上线安全守护包', group: '发版与线上维护',
    tplIds: ['tpl-anti-slop', 'tpl-gitleaks', 'tpl-router-ai', 'tpl-human-gate'],
    mandatoryTplIds: ['tpl-anti-slop', 'tpl-gitleaks'],
    matchProfile: { domains: ['release'], exts: ['.cmd', '.yml'], keywords: ['发版', '上线', '灰度', '总装', '分发', '发布'] }
  }
];

export function loadCandidateWorkflowMacros(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const brickMap = listAtomicBrickCatalog(root);
  const macros = new Map();
  for (const def of BUILTIN_MACRO_DEFS) {
    const floorSet = new Set(['tpl-anti-slop', ...(def.mandatoryTplIds || [])].filter((id) => brickMap.has(id)));
    const built = composeBrickChainToPack(brickMap, def.tplIds, { id: def.id, name: def.name, group: def.group, floorSet, matchProfile: def.matchProfile });
    if (built.ok) {
      const dep = inspectWorkflowDeps(root, built.pack);
      macros.set(def.id, { ...built.pack, tplIds: def.tplIds, depsReady: dep.ready, missingDepsCount: dep.missingCount, missingDeps: dep.missing });
    }
  }
  const saved = readSavedWorkbenchState(root);
  const extraPacks = { ...(saved.customPacks || {}) };
  for (const base of [DG_ROOT, root]) {
    const wfDir = join(base, 'workflows');
    if (!existsSync(wfDir)) continue;
    try {
      for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.workflow.json'))) {
        const r = readJsonStrict(join(wfDir, f));
        if (r.ok && r.value?.id && Array.isArray(r.value.nodes)) extraPacks[r.value.id] = r.value;
      }
    } catch (err) { void err; }
  }
  for (const [id, pk] of Object.entries(extraPacks)) {
    if (!pk || !Array.isArray(pk.nodes) || pk.nodes.length === 0) continue;
    const tplIds = pk.nodes.map((n) => n.tplId).filter(Boolean);
    const dep = inspectWorkflowDeps(root, pk);
    macros.set(id, {
      ...pk,
      tplIds,
      mandatoryTplIds: Array.isArray(pk.mandatoryTplIds) && pk.mandatoryTplIds.length ? pk.mandatoryTplIds : ['tpl-anti-slop'],
      matchProfile: pk.matchProfile || {},
      depsReady: dep.ready,
      missingDepsCount: dep.missingCount,
      missingDeps: dep.missing
    });
  }
  return { macros, brickMap };
}

function extractComponentSignals(node) {
  const hay = [
    node.title || '', node.tip || '',
    ...(node.scopePaths || []),
    ...((node.modules || []).flatMap((m) => [m.name || '', m.role || '', m.path || '']))
  ].join(' ').toLowerCase();
  const paths = [...(node.scopePaths || []), ...((node.modules || []).map((m) => String(m.path || '').toLowerCase()))];
  const roles = new Set((node.modules || []).map((m) => m.role));
  return { hay, paths, roles };
}

function inferRequirementBrickAdditions(reqText, brickMap) {
  const q = String(reqText || '').toLowerCase();
  const prepend = [];
  const append = [];
  const reasons = [];
  if (/公式|解析|语法|规格|复杂规则|重构|边界|schema|spec|表达式/.test(q) && brickMap.has('tpl-openspec')) {
    prepend.push('tpl-openspec');
    reasons.push('前置追加 OpenSpec 规格审校（核验新公式/规则边界）');
  }
  if (/文案|润色|提示语|说明|报告|去ai味|话术/.test(q) && brickMap.has('tpl-deai-polish')) {
    prepend.push('tpl-deai-polish');
    reasons.push('追加去 AI 味文案润色套件');
  }
  if (/联网|汇率|api|密钥|token|支付|鉴权|口令|webhook|外部接口|请求/.test(q)) {
    if (brickMap.has('tpl-gitleaks')) { append.push('tpl-gitleaks'); reasons.push('追加 Gitleaks 密钥防泄漏扫描'); }
    if (brickMap.has('tpl-router-rule')) { append.push('tpl-router-rule'); reasons.push('追加 0/1/2/3 条件分支承接断网离线桩降级'); }
  }
  if (/界面|ui|按钮|弹窗|跳转|交互|点击|前端|样式|表单|键盘/.test(q) && brickMap.has('tpl-playwright')) {
    append.push('tpl-playwright');
    reasons.push('追加 Playwright 网页真实点击联调');
  }
  if (/精度|浮点|变异|金融|复式|账本|算价|科学计算|核心算法/.test(q)) {
    const stryker = brickMap.get('tpl-adp-stryker');
    const biome = brickMap.get('tpl-biome-knip');
    if (stryker && stryker.ready) {
      append.push('tpl-adp-stryker');
      reasons.push('追加本地已就绪 Stryker 变异测试积木');
    } else if (biome) {
      append.push('tpl-biome-knip');
      reasons.push('优先选用静态语法与死代码积木（避免未就绪重依赖卡顿）');
    }
  }
  if (/上线|迁移|删库|不可逆|生产发版|人工确认/.test(q) && brickMap.has('tpl-human-gate')) {
    append.push('tpl-human-gate');
    reasons.push('末尾追加人工审批闸门');
  }
  return { prepend, append, reasons };
}

function persistComponentBinding(projectRoot, nodeId, binding, extraPackToSave = null) {
  const root = resolve(projectRoot);
  const st = readSavedWorkbenchState(root);
  st.componentWorkflows = { ...(st.componentWorkflows || {}), [nodeId]: binding };
  if (extraPackToSave && extraPackToSave.id) {
    st.customPacks = { ...(st.customPacks || {}), [extraPackToSave.id]: extraPackToSave };
  }
  st.updatedAt = new Date().toISOString();
  mkdirSync(join(root, '.donegate'), { recursive: true });
  writeFileSync(join(root, '.donegate', 'workbench-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');
  return st;
}

export function assignComponentWorkflow(projectRoot, componentNode, opts = {}) {
  const auth = assertPlannerAuthority(opts.actorRole);
  if (!auth.ok) return auth;
  const root = resolve(projectRoot || process.cwd());
  const { macros, brickMap } = loadCandidateWorkflowMacros(root);
  const saved = readSavedWorkbenchState(root);
  const existing = (saved.componentWorkflows || {})[componentNode.id];
  if (existing && existing.pinnedByHuman && !opts.forceReassign && !opts.preferredMacroId) {
    return { ok: true, skippedPinned: true, binding: existing };
  }

  let bestMacro = null;
  let bestScore = -1;
  if (opts.preferredMacroId && macros.has(opts.preferredMacroId)) {
    bestMacro = macros.get(opts.preferredMacroId);
    bestScore = 999;
  } else if (!opts.preferScratchJit) {
    const sig = extractComponentSignals(componentNode);
    for (const m of macros.values()) {
      const mp = m.matchProfile || {};
      let score = 0;
      for (const kw of (mp.keywords || [])) if (sig.hay.includes(String(kw).toLowerCase())) score += 18;
      for (const ext of (mp.exts || [])) if (sig.paths.some((p) => p.endsWith(ext))) score += 14;
      if ((mp.domains || []).includes('ui') && sig.roles.has('界面')) score += 26;
      if ((mp.domains || []).includes('api') && (sig.roles.has('接口') || sig.roles.has('安全'))) score += 26;
      if ((mp.domains || []).includes('core') && (sig.roles.has('底座') || sig.roles.has('工具') || sig.roles.has('逻辑'))) score += 20;
      if (m.depsReady) score += 22;
      if (score > bestScore) { bestScore = score; bestMacro = m; }
    }
  }

  if (!bestMacro || bestScore < 15) {
    const readyTpls = ['tpl-anti-slop'];
    const sig = extractComponentSignals(componentNode);
    const inferred = inferRequirementBrickAdditions(sig.hay, brickMap);
    const chain = [...new Set([...inferred.prepend.filter((id) => brickMap.get(id)?.ready), ...readyTpls, ...inferred.append.filter((id) => brickMap.get(id)?.ready), 'tpl-router-rule'])].filter((id) => brickMap.has(id));
    const floorSet = new Set(['tpl-anti-slop']);
    const built = composeBrickChainToPack(brickMap, chain, {
      id: `jit-${componentNode.id}`,
      name: `「${componentNode.title}」现场直拼连招`,
      floorSet
    });
    const dep = inspectWorkflowDeps(root, built.pack);
    const binding = {
      nodeId: componentNode.id,
      nodeTitle: componentNode.title,
      mode: 'jit-synthesized',
      baseMacroId: null,
      baseMacroName: '现场直拼连招',
      pinnedByHuman: Boolean(opts.pinnedByHuman),
      mandatoryFloorTplIds: [...floorSet],
      tplIds: chain,
      addedTplIds: chain.filter((x) => x !== 'tpl-anti-slop'),
      deltaCount: Math.max(0, chain.length - 1),
      depsReady: dep.ready,
      missingDepsCount: dep.missingCount,
      missingDeps: dep.missing,
      revision: (existing?.revision || 0) + 1,
      reason: '未命中高分固定宏，总控已优先从本地就绪积木池现场直拼专属连招',
      pack: built.pack,
      updatedAt: new Date().toISOString()
    };
    if (opts.persist !== false) persistComponentBinding(root, componentNode.id, binding);
    return { ok: true, binding };
  }

  const tplIds = Array.isArray(bestMacro.tplIds) && bestMacro.tplIds.length ? bestMacro.tplIds : bestMacro.nodes.map((n) => n.tplId).filter(Boolean);
  const floorSet = new Set(['tpl-anti-slop', ...(bestMacro.mandatoryTplIds || [])].filter((id) => tplIds.includes(id) || id === 'tpl-anti-slop'));
  const chain = tplIds.includes('tpl-anti-slop') ? tplIds : ['tpl-anti-slop', ...tplIds];
  const built = composeBrickChainToPack(brickMap, chain, { id: bestMacro.id, name: bestMacro.name, group: bestMacro.group, floorSet, matchProfile: bestMacro.matchProfile });
  const packToUse = built.ok ? built.pack : bestMacro;
  const dep = inspectWorkflowDeps(root, packToUse);
  const binding = {
    nodeId: componentNode.id,
    nodeTitle: componentNode.title,
    mode: 'macro',
    baseMacroId: bestMacro.id,
    baseMacroName: bestMacro.name,
    score: bestScore,
    pinnedByHuman: Boolean(opts.pinnedByHuman),
    mandatoryFloorTplIds: [...floorSet],
    tplIds: chain,
    addedTplIds: [],
    deltaCount: 0,
    depsReady: dep.ready,
    missingDepsCount: dep.missingCount,
    missingDeps: dep.missing,
    revision: (existing?.revision || 0) + 1,
    reason: bestMacro.depsReady
      ? `匹配预置宏「${bestMacro.name}」（环境依赖已就绪，0 规划延迟复用）`
      : `匹配预置宏「${bestMacro.name}」（待补齐 ${dep.missingCount} 项依赖）`,
    pack: packToUse,
    updatedAt: new Date().toISOString()
  };
  if (opts.persist !== false) persistComponentBinding(root, componentNode.id, binding);
  return { ok: true, binding };
}

export function mutateComponentWorkflowJit(projectRoot, componentNode, opts = {}) {
  const auth = assertPlannerAuthority(opts.actorRole);
  if (!auth.ok) return auth;
  const root = resolve(projectRoot || process.cwd());
  const { brickMap } = loadCandidateWorkflowMacros(root);
  const saved = readSavedWorkbenchState(root);
  let base = (saved.componentWorkflows || {})[componentNode.id];
  if (!base) {
    const initRes = assignComponentWorkflow(root, componentNode, { actorRole: auth.role, persist: false });
    if (!initRes.ok) return initRes;
    base = initRes.binding;
  }

  const floorSet = new Set(['tpl-anti-slop', ...(base.mandatoryFloorTplIds || [])]);
  const reqRemove = Array.isArray(opts.removeTplIds) ? opts.removeTplIds : [];
  const blockedFloor = reqRemove.filter((id) => floorSet.has(id));
  const humanApproved = auth.role === 'human' && opts.humanApprovedFloorRemoval === true;

  if (blockedFloor.length > 0 && !humanApproved) {
    const blockedTitles = blockedFloor.map((id) => brickMap.get(id)?.title || id);
    const pending = {
      requestedRemoveTplIds: blockedFloor,
      blockedTitles,
      requirementText: String(opts.requirementText || ''),
      requestedBy: auth.role,
      requestedAt: new Date().toISOString()
    };
    const nextWithPending = { ...base, pendingFloorApproval: pending, updatedAt: pending.requestedAt };
    if (opts.persist !== false) persistComponentBinding(root, componentNode.id, nextWithPending);
    return {
      ok: false,
      exitCode: 3,
      code: 'MANDATORY_FLOOR_LOCKED',
      requiresHumanApproval: true,
      blockedTplIds: blockedFloor,
      blockedTitles,
      binding: nextWithPending,
      reason: `触发「底座只增不减」安全锁：禁止自动卸载底线护栏积木（${blockedTitles.join('、')}）。若因需求降级确需移除，请由人工点击批准放行`
    };
  }

  if (blockedFloor.length > 0 && humanApproved) {
    for (const fId of blockedFloor) if (fId !== 'tpl-anti-slop' || opts.allowStripCoreSlop === true) floorSet.delete(fId);
  }

  const explicitAdd = Array.isArray(opts.addTplIds) ? opts.addTplIds : [];
  for (const id of explicitAdd) {
    if (!brickMap.has(id)) {
      return { ok: false, exitCode: 2, code: 'UNKNOWN_BRICK_REJECTED', unknownTplIds: [id], reason: `禁止注入非标手搓脚本：未知积木 ${id}` };
    }
  }

  const inferred = inferRequirementBrickAdditions(opts.requirementText || '', brickMap);
  const removeSet = new Set(reqRemove.filter((id) => !floorSet.has(id)));
  const currentChain = (base.tplIds || ['tpl-anti-slop']).filter((id) => !removeSet.has(id));
  for (const fId of floorSet) if (!currentChain.includes(fId)) currentChain.unshift(fId);

  const preList = inferred.prepend.filter((id) => !currentChain.includes(id) && !removeSet.has(id));
  const postList = [...inferred.append, ...explicitAdd].filter((id) => !currentChain.includes(id) && !preList.includes(id) && !removeSet.has(id));
  const mergedChain = [...preList, ...currentChain, ...postList];

  const baseTplSet = new Set(base.baseMacroId ? (loadCandidateWorkflowMacros(root).macros.get(base.baseMacroId)?.tplIds || ['tpl-anti-slop']) : ['tpl-anti-slop']);
  const originByTpl = {};
  for (const id of mergedChain) {
    originByTpl[id] = floorSet.has(id) ? 'floor' : (baseTplSet.has(id) ? 'macro' : 'jit-added');
  }
  const built = composeBrickChainToPack(brickMap, mergedChain, {
    id: `jit-${componentNode.id}-r${(base.revision || 1) + 1}`,
    name: `${base.baseMacroName || componentNode.title} · 派生连招`,
    group: '节点派生连招',
    tip: opts.requirementText ? `按新需求微调：${String(opts.requirementText).slice(0, 80)}` : '节点私有派生连招',
    floorSet,
    originByTpl
  });
  if (!built.ok) return built;

  const addedTplIds = mergedChain.filter((id) => !baseTplSet.has(id));
  const dep = inspectWorkflowDeps(root, built.pack);
  const summaryReasons = [...inferred.reasons];
  if (explicitAdd.length) summaryReasons.push(`手动挂载 ${explicitAdd.map((x) => brickMap.get(x)?.title || x).join('、')}`);
  if (removeSet.size) summaryReasons.push(`移除非底座积木 ${[...removeSet].join('、')}`);
  if (!summaryReasons.length) summaryReasons.push('已完成节点私有连招微调校验（底座护栏保持锁定）');

  const updatedBinding = {
    nodeId: componentNode.id,
    nodeTitle: componentNode.title,
    mode: addedTplIds.length > 0 || removeSet.size > 0 ? 'jit-forked' : base.mode,
    baseMacroId: base.baseMacroId,
    baseMacroName: base.baseMacroName || '节点专属连招',
    pinnedByHuman: true,
    mandatoryFloorTplIds: [...floorSet],
    tplIds: mergedChain,
    addedTplIds,
    addedTitles: addedTplIds.map((id) => brickMap.get(id)?.title || id),
    deltaCount: addedTplIds.length,
    depsReady: dep.ready,
    missingDepsCount: dep.missingCount,
    missingDeps: dep.missing,
    lastRequirement: String(opts.requirementText || '').trim(),
    pendingFloorApproval: null,
    revision: (base.revision || 1) + 1,
    reason: summaryReasons.join('；'),
    pack: built.pack,
    updatedAt: new Date().toISOString()
  };
  if (opts.persist !== false) persistComponentBinding(root, componentNode.id, updatedBinding);
  return { ok: true, binding: updatedBinding };
}

export function promoteComponentJitToMacro(projectRoot, nodeId, macroMeta = {}) {
  const auth = assertPlannerAuthority(macroMeta.actorRole || 'human');
  if (!auth.ok) return auth;
  const root = resolve(projectRoot || process.cwd());
  const saved = readSavedWorkbenchState(root);
  const binding = (saved.componentWorkflows || {})[nodeId];
  if (!binding || !binding.pack || !Array.isArray(binding.pack.nodes)) {
    return { ok: false, exitCode: 3, code: 'NO_COMPONENT_WORKFLOW', reason: `节点 ${nodeId} 尚未挂载可沉淀的连招` };
  }
  const rawId = macroMeta.macroId || `macro-${nodeId}-${Date.now().toString(36).slice(-4)}`;
  const safeId = String(rawId).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 56) || 'custom-macro';
  const macroName = String(macroMeta.name || `${binding.nodeTitle || nodeId}沉淀连招`).trim();
  const keywords = String(macroMeta.keywords || binding.nodeTitle || '')
    .split(/[\s,，、/]+/).map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 8);

  const cleanNodes = binding.pack.nodes.map((n) => ({ ...n, jitOrigin: 'macro' }));
  const normalizedPack = {
    schemaVersion: '1.0',
    id: safeId,
    name: macroName,
    group: macroMeta.group || '项目沉淀连招宏',
    tip: macroMeta.tip || (binding.lastRequirement ? `由节点「${binding.nodeTitle}」实战变招沉淀：${binding.lastRequirement}` : `由节点「${binding.nodeTitle}」一键沉淀的确定性连招宏`),
    mandatoryTplIds: binding.mandatoryFloorTplIds || ['tpl-anti-slop'],
    matchProfile: { domains: macroMeta.domains || ['custom'], keywords },
    deps: Array.isArray(binding.pack.deps) ? binding.pack.deps : [],
    nodes: cleanNodes,
    links: binding.pack.links || [],
    groups: []
  };

  let wfRelPath = null;
  if (macroMeta.writeToWorkflowsDir !== false) {
    mkdirSync(join(root, 'workflows'), { recursive: true });
    wfRelPath = `workflows/${safeId}.workflow.json`;
    writeFileSync(join(root, wfRelPath), JSON.stringify(normalizedPack, null, 2) + '\n', 'utf8');
  }
  const solidifiedBinding = {
    ...binding,
    mode: 'macro',
    baseMacroId: safeId,
    baseMacroName: macroName,
    addedTplIds: [],
    addedTitles: [],
    deltaCount: 0,
    reason: `已沉淀为全局可复用工作流宏「${macroName}」`,
    pack: normalizedPack,
    updatedAt: new Date().toISOString()
  };
  persistComponentBinding(root, nodeId, solidifiedBinding, normalizedPack);
  return { ok: true, macroId: safeId, macro: normalizedPack, filePath: wfRelPath, binding: solidifiedBinding };
}

export function buildJitBootstrapSummary(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const saved = readSavedWorkbenchState(root);
  const { macros, brickMap } = loadCandidateWorkflowMacros(root);
  return {
    componentWorkflows: saved.componentWorkflows || {},
    macros: [...macros.values()].map((m) => ({
      id: m.id, name: m.name, group: m.group, tip: m.tip,
      tplIds: m.tplIds, mandatoryTplIds: m.mandatoryTplIds,
      depsReady: m.depsReady, missingDepsCount: m.missingDepsCount
    })),
    bricks: [...brickMap.values()].map((b) => ({
      tplId: b.tplId, category: b.category, title: b.title,
      mandatoryFloor: Boolean(b.mandatoryFloor), ready: Boolean(b.ready), repoSlug: b.repoSlug || ''
    }))
  };
}
