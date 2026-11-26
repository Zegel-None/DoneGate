// 工作台活体数据注水层：将全仓扫描的模块/入口/契约 scope[] 与适配器注册表映射为「项目看板 + 工作流」交互模型
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';
import { buildGovernanceSummaryPayload, inspectAllKnownWorkflowPacks, readUiToolchainStatus } from '../dsh/contract.mjs';
import { WB_PRESET_TEMPLATE_TRAITS } from './wb-catalog.mjs';
import { buildAdaptiveBusinessHierarchy } from './modularity-hierarchy.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SMALL_PROJECT_MODULE_LIMIT = 18;

const UPSTREAM_GITHUB_MAP = {
  stryker: ['stryker-mutator/stryker-js', 'v8.7.1', 'v8.8.0'], gitleaks: ['gitleaks/gitleaks', 'v8.18.4', 'v8.21.2'],
  'osv-scanner': ['google/osv-scanner', 'v1.9.1', 'v1.9.2'], depcruise: ['sverweij/dependency-cruiser', 'v16.8.0', 'v16.9.0'],
  knip: ['webpro-nl/knip', 'v5.39.0', 'v5.41.0'], biome: ['biomejs/biome', 'v1.9.4', 'v1.9.4'],
  playwright: ['microsoft/playwright', 'v1.48.0', 'v1.49.1'], semgrep: ['semgrep/semgrep', 'v1.99.0', 'v1.101.0'],
  ruff: ['astral-sh/ruff', 'v0.8.2', 'v0.8.4'], pyright: ['microsoft/pyright', 'v1.1.389', 'v1.1.390'],
  vitest: ['vitest-dev/vitest', 'v2.1.6', 'v2.1.8'], shellcheck: ['koalaman/shellcheck', 'v0.10.0', 'v0.10.0'],
  hadolint: ['hadolint/hadolint', 'v2.12.0', 'v2.12.0'], actionlint: ['rhysd/actionlint', 'v1.7.4', 'v1.7.4'],
  sqlfluff: ['sqlfluff/sqlfluff', 'v3.2.5', 'v3.3.0'], maestro: ['mobile-dev-inc/Maestro', 'v1.38.1', 'v1.39.0'],
  openspec: ['Fission-AI/OpenSpec', 'v0.2.4', 'v0.3.0'], syft: ['anchore/syft', 'v1.18.0', 'v1.18.0'],
  trivy: ['aquasecurity/trivy', 'v0.58.0', 'v0.58.0'], schemathesis: ['schemathesis/schemathesis', 'v4.0.0', 'v4.0.0'],
  jscpd: ['kucherenko/jscpd', 'v4.0.5', 'v4.0.5'], typos: ['crate-ci/typos', 'v1.28.0', 'v1.28.0'],
  'dotenv-linter': ['dotenv-linter/dotenv-linter', 'v4.0.0', 'v4.0.0'], 'ast-grep': ['ast-grep/ast-grep', 'v0.32.0', 'v0.32.0'],
  beads: ['steveyegge/beads', 'v0.1.0', 'v0.1.0'], srclight: ['srclight/srclight', 'v0.25.0', 'v0.25.0'],
  codegraph: ['codegraph/codegraph', 'v1.6.0', 'v1.6.0']
};

const ADAPTER_HUMAN_META = {
  stryker: { title: '防假绿破坏性抽检', inName: '受测代码与单测', outSig: '测试能否抓出真错', outObs: '漏抓错误位置清单', slots: ['故意改坏代码看测试能否抓出', '汇总未测到与超时行号'] },
  codegraph: { title: '循环引用与波及范围', inName: '项目代码快照', outSig: '是否无死循环引用', outObs: '受波及模块清单', slots: ['模块间零死循环引用检查', '列出受本次改动影响的模块'] },
  gitleaks: { title: '密钥密码防泄漏', inName: '代码与提交历史', outSig: '是否零密码泄漏', outObs: '疑似泄漏打码位置', slots: ['拦截误写进代码的密码私钥', '导出打码后的疑似泄漏行号'] },
  'osv-scanner': { title: '第三方依赖漏洞排查', inName: '依赖锁文件清单', outSig: '是否无高危漏洞', outObs: '依赖漏洞详情表', slots: ['高危与严重依赖漏洞清零', '汇总中低风险待升级依赖'] },
  depcruise: { title: '模块跨层乱引拦截', inName: '模块引用关系', outSig: '分层边界是否合规', outObs: '违规跨层引用清单', slots: ['严禁跨目录违规互相调用', '导出违规引用调用路径'] },
  beads: { title: '任务先后顺序排期', inName: '待办任务清单', outSig: '排期是否无死锁', outObs: '推荐施工顺序表', slots: ['检查任务前置依赖无卡死', '生成可直接开工的任务队列'] },
  'fuck-u-code': { title: '代码臃肿复杂度体检', inName: '业务源码目录', outSig: '复杂度是否可控', outObs: '难懂臃肿文件清单', slots: ['揪出嵌套过深的绕脑函数', '统计扫描文件与复杂度得分'] },
  jscpd: { title: '重复粘贴代码排查', inName: '项目源码目录', outSig: '重复率是否达标', outObs: '大段重复代码位置', slots: ['拦截大段复制粘贴重复代码', '列出可提取公共函数的位置'] },
  openspec: { title: '需求规格完整度审校', inName: '需求方案草稿', outSig: '规格是否齐全', outObs: '遗漏与冲突清单', slots: ['检查需求方案有无缺项冲突'] },
  srclight: { title: '已有代码索引盘点', inName: '项目代码快照', outSig: '索引是否最新', outObs: '公共模块索引表', slots: ['核对代码索引是否同步最新', '导出可复用公共函数目录'] },
  knip: { title: '废文件与幽灵依赖清理', inName: '工程配置与源码', outSig: '是否无幽灵依赖', outObs: '废文件与闲置包表', slots: ['拦截漏写进配置的幽灵依赖', '列出无人引用的废文件与导出'] },
  'dotenv-linter': { title: '环境变量配置检查', inName: '环境配置文件', outSig: '配置格式是否合规', outObs: '漏配与重复项清单', slots: ['排查环境变量拼写与重复键', '核对示例配置与正式配置一致'] },
  playwright: { title: '网页真机点击联调', inName: '待测网页入口', outSig: '页面流程是否走通', outObs: '页面报错与闪烁项', slots: ['核心页面点击流程零报错', '排查偶发失灵的不稳定操作'] },
  maestro: { title: '安卓界面交互验收', inName: '待测安卓安装包', outSig: '点击验收是否通过', outObs: '失败步骤与闪退表', slots: ['核心界面点击流程走通检查', '记录失败与跳过的交互步骤'] },
  schemathesis: { title: '接口异常输入压测', inName: '接口文档与服务', outSig: '接口是否扛住异常', outObs: '崩溃报错复现样本', slots: ['异常参数压测零内部崩溃', '提取触发报错的请求样本'] },
  trivy: { title: '容器与部署配置体检', inName: '容器与部署文件', outSig: '部署配置是否安全', outObs: '配置风险与漏洞表', slots: ['排查容器权限过大与配置错漏', '汇总镜像漏洞与敏感信息风险'] },
  biome: { title: '代码语法快速检查', inName: '前端与脚本源码', outSig: '语法是否零报错', outObs: '语法与格式问题单', slots: ['代码语法错误数清零检查', '汇总格式警告与问题分类'] },
  'ast-grep': { title: '危险代码写法扫描', inName: '项目业务源码', outSig: '是否无禁用写法', outObs: '命中位置与代码段', slots: ['按结构精准拦截禁用写法', '导出命中行号与代码片段'] },
  ruff: { title: '后端语法快速检查', inName: '后端脚本源码', outSig: '语法是否零报错', outObs: '未定义变量与问题单', slots: ['语法错误与未定义变量清零', '汇总代码坏味道违规位置'] },
  pyright: { title: '跨文件类型核对', inName: '后端业务源码', outSig: '类型是否全部对齐', outObs: '类型不匹配行号表', slots: ['跨文件调用类型错误清零', '汇总类型警告与已查文件数'] },
  typos: { title: '英文拼写防手滑检查', inName: '代码与文档目录', outSig: '是否无拼写错词', outObs: '疑似拼错词文件表', slots: ['代码与文档英文拼写零错词', '列出含错别字的文件清单'] },
  actionlint: { title: '流水线配置语法检查', inName: '自动化流水线配置', outSig: '配置语法是否合规', outObs: '配置报错行号清单', slots: ['自动化部署脚本零语法错误', '按错误类别汇总修复提示'] }
};

const HYD_WB_SUBUNIT_RULES = [
  { match: (p) => !p.includes('/'), key: 'root', title: '项目基础设置与测试开关', scope: './', tier: 0 },
  { match: (p) => /^runner\/[^/]+$/.test(p), key: 'runner', title: '接收指令并启动各项检查', scope: 'runner/', tier: 1 },
  { match: (p) => p.startsWith('runner/core/') && /\/(?:cmd-|commands-|progress\.|dashboard\.)/.test(p), key: 'core-cmds', title: '记录每项功能的完成进度', scope: 'runner/core/', tier: 2 },
  { match: (p) => p.startsWith('runner/core/') && /\/(?:ast-stub|barrel-stub|context-router|hermetic-capsule|dom-wiring|graph-edges|node-micro-gate)/.test(p), key: 'core-slice', title: '只挑相关文件发给 AI', scope: 'runner/core/', tier: 3 },
  { match: (p) => p.startsWith('runner/core/'), key: 'core-verdict', title: '真跑测试打分并留存记录', scope: 'runner/core/', tier: 4 },
  { match: (p) => p.startsWith('runner/atlas/') && /\/(?:scan-|assemble-atlas|hydrate-workbench|humanize|contract\.|index\.)/.test(p), key: 'atlas-scanner', title: '自动盘点项目功能与改乱风险', scope: 'runner/atlas/', tier: 3 },
  { match: (p) => p.startsWith('runner/atlas/') && /\/(?:serve-atlas|ui-|wb-catalog|wb-jit-|wb-subagent|wb-uiboard|wb-dsh-)/.test(p), key: 'atlas-shell', title: '实时状态同步与过夜挂机', scope: 'runner/atlas/', tier: 2 },
  { match: (p) => p.startsWith('runner/atlas/'), key: 'atlas-canvas', title: '流程图拖拽、连线与展开收起', scope: 'runner/atlas/', tier: 3 },
  { match: (p) => p.startsWith('runner/dsh/') && /\/(?:shared-pool-|workflow-deps|dg-deps-|workflow-jit)/.test(p), key: 'dsh-deps', title: '自动安装检查工具（免配环境）', scope: 'runner/dsh/', tier: 3 },
  { match: (p) => p.startsWith('runner/dsh/') && /\/ui-/.test(p), key: 'dsh-uiboard', title: '边看网页效果、边点选修改处', scope: 'runner/dsh/', tier: 3 },
  { match: (p) => p.startsWith('runner/dsh/'), key: 'dsh-host', title: '安排后台小助手分头改代码', scope: 'runner/dsh/', tier: 2 },
  { match: (p) => p.startsWith('skill/adapters/'), key: 'skill-adapters', title: '调用开源工具查漏洞与坏味道', scope: 'skill/adapters/', tier: 5 },
  { match: (p) => p.startsWith('skill/') && /\/(?:check-|cognitive-complexity|commit-hygiene|schema-lite)/.test(p), key: 'skill-gates', title: '拦截 AI 偷懒删功能与绕脑代码', scope: 'skill/', tier: 5 },
  { match: (p) => p.startsWith('skill/'), key: 'skill-kit', title: '基础文件读写与公开发布打包', scope: 'skill/', tier: 5 },
  { match: (p) => p.startsWith('tools/'), key: 'tools', title: '核对说明文档与实际功能一致', scope: 'tools/', tier: 6 }
];

const LANE_RANK = { ui: 0, api: 1, tool: 2 };
const LANE_ROLE_LABEL = { ui: '界面', api: '接口', tool: '工具' };
const SEC_ADAPTER_TOOLS = new Set(['gitleaks', 'osv-scanner', 'semgrep', 'syft', 'trivy', 'vuln-merge']);
const E2E_ADAPTER_TOOLS = new Set(['playwright', 'maestro', 'vitest']);

function defaultSavedState() {
  return {
    schemaVersion: '1.0', hostLayoutVer: 3, customPacks: {}, importedSandboxes: {}, componentWorkflows: {}, hostNodeLayouts: {}, hostGroups: [], hostSubgraphs: [],
    collapsedWfGroups: [], collapsedNodeCats: [], workshopOverrides: {}, textOverrides: {}, textStyles: {}, controlStyles: {},
    starredRepos: ['mobile-dev-inc/Maestro', 'biomejs/biome'], updatedAt: null
  };
}

export function readSavedWorkbenchState(projectRoot) {
  const p = join(resolve(projectRoot), '.donegate', 'workbench-state.json');
  if (!existsSync(p)) return defaultSavedState();
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') return defaultSavedState();
  const merged = { ...defaultSavedState(), ...r.value };
  if (r.value.hostLayoutVer !== 3 && merged.hostNodeLayouts && typeof merged.hostNodeLayouts === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(merged.hostNodeLayouts)) {
      if (v && typeof v === 'object') {
        const { x: _x, y: _y, expanded: _exp, ...rest } = v;
        void _x;
        void _y;
        void _exp;
        cleaned[k] = rest;
      }
    }
    merged.hostNodeLayouts = cleaned;
    merged.hostLayoutVer = 3;
  }
  if (merged.componentWorkflows && typeof merged.componentWorkflows === 'object') {
    for (const b of Object.values(merged.componentWorkflows)) {
      if (b && typeof b.baseName === 'string') {
        b.baseName = b.baseName.replace(/护栏包|开发包|开发流/g, '工作流'); // dg-term-allow: 清洗历史落盘旧名
      }
    }
  }
  return merged;
}

function laneOrderRank(lane) {
  return LANE_RANK[lane] ?? 3;
}

function mapModRoleLabel(mod) {
  return LANE_ROLE_LABEL[mod.lane] || '底座';
}

function mapModState(mod) {
  if ((mod.touchedByBranches || []).length > 1 || mod.tone === 'bad') return 'err';
  if (mod.isWild || mod.tone === 'warn') return 'warn';
  return 'ok';
}

function hydWbPickPrimaryLane(lanes) {
  for (const lane of ['ui', 'api', 'tool']) {
    if (lanes.has(lane)) return lane;
  }
  return 'core';
}

function hydWbBuildSingleModuleUnits(modules) {
  const titleCounts = new Map();
  const rawTitles = modules.map((m) => m.entrypoints?.[0]?.humanTitle || m.humanTitle || basename(m.path));
  for (const t of rawTitles) titleCounts.set(t, (titleCounts.get(t) || 0) + 1);

  return modules.map((m, i) => {
    const baseTitle = rawTitles[i];
    const humanTitle = (titleCounts.get(baseTitle) || 0) > 1 ? `${baseTitle} (${basename(m.path)})` : baseTitle;
    const isRoot = m.domainKey === 'root';
    const dirScope = isRoot ? './' : `${m.domainKey}/`;
    return {
      id: m.id,
      nodeId: `host-mod-${m.path.replace(/[^A-Za-z0-9_-]/g, '-')}`,
      key: m.path,
      isRoot,
      archTier: isRoot ? 0 : laneOrderRank(m.lane) + 1,
      primaryLane: m.lane || 'core',
      humanTitle,
      sublinePath: m.path,
      baseScopes: [m.path, dirScope],
      mods: [m],
      wildCount: m.isWild ? 1 : 0,
      activeBranches: m.touchedByBranches || []
    };
  });
}

function hydWbInferGenericSubunit(mod, domTitleByKey) {
  const matched = HYD_WB_SUBUNIT_RULES.find((r) => r.match(mod.path));
  if (matched) return matched;
  const parts = mod.path.split('/').filter(Boolean);
  let subKey = parts[0] || 'root';
  if (['apps', 'packages', 'services', 'modules'].includes(parts[0]) && parts.length >= 4) {
    subKey = `${parts[0]}/${parts[1]}/${parts[2]}`;
  } else if (parts.length >= 3) {
    subKey = `${parts[0]}/${parts[1]}`;
  }
  return {
    key: subKey,
    title: domTitleByKey.get(subKey) || domTitleByKey.get(mod.domainKey) || subKey,
    scope: `${subKey}/`,
    tier: laneOrderRank(mod.lane) + 1
  };
}

function hydWbBuildLargeProjectUnits(modules, rawDomains) {
  const domTitleByKey = new Map((rawDomains || []).map((d) => [d.key, d.humanTitle]));
  const bucketMap = new Map();
  for (const m of modules) {
    const spec = hydWbInferGenericSubunit(m, domTitleByKey);
    if (!bucketMap.has(spec.key)) {
      bucketMap.set(spec.key, {
        id: `unit:${spec.key}`,
        nodeId: `host-dom-${spec.key.replace(/[^A-Za-z0-9_-]/g, '-')}`,
        key: spec.key,
        isRoot: spec.key === 'root',
        archTier: spec.tier,
        humanTitle: spec.title,
        sublinePath: spec.scope,
        baseScopes: [spec.scope],
        mods: [],
        lanes: new Set(),
        branches: new Set(),
        wildCount: 0
      });
    }
    const u = bucketMap.get(spec.key);
    u.mods.push(m);
    u.lanes.add(m.lane || 'core');
    if (m.isWild) u.wildCount++;
    for (const b of (m.touchedByBranches || [])) u.branches.add(b);
  }
  return [...bucketMap.values()].map((u) => ({
    ...u,
    primaryLane: hydWbPickPrimaryLane(u.lanes),
    activeBranches: [...u.branches]
  }));
}

function hydWbResolveUnitsFromAtlas(baseAtlas) {
  const modules = baseAtlas.modules || [];
  if (modules.length > 0 && modules.length <= SMALL_PROJECT_MODULE_LIMIT) {
    return hydWbBuildSingleModuleUnits(modules);
  }
  if (modules.length > SMALL_PROJECT_MODULE_LIMIT) {
    return hydWbBuildLargeProjectUnits(modules, baseAtlas.domains || []);
  }
  return (baseAtlas.domains || []).map((d) => ({
    id: d.id,
    nodeId: `host-dom-${d.key.replace(/[^A-Za-z0-9_-]/g, '-')}`,
    key: d.key,
    isRoot: d.key === 'root',
    archTier: d.key === 'root' ? 0 : laneOrderRank(d.primaryLane) + 1,
    primaryLane: d.primaryLane || 'core',
    humanTitle: d.humanTitle || d.key,
    sublinePath: d.key === 'root' ? './' : `${d.key}/`,
    baseScopes: [d.key === 'root' ? './' : `${d.key}/`],
    mods: [],
    wildCount: d.wildCount || 0,
    activeBranches: d.activeBranches || []
  }));
}

function hydWbComputeEdgeWeight(srcMod, isRootSrc, edgeKind) {
  if (isRootSrc) return 8;
  const isAuxCheck = /(?:^|\/)(?:tests?|__tests__|e2e|check-|self-test|fixtures?|progress-note)[^/]*\.|\.(?:test|spec)\./i.test(srcMod.path);
  if (isAuxCheck) return 1;
  return edgeKind === 'script-ref' ? 2 : 4;
}

function hydWbAccumulateUnitEdgeWeights(units, edges) {
  const unitByModId = new Map();
  const modById = new Map();
  for (const u of units) {
    for (const m of u.mods) {
      unitByModId.set(m.id, u);
      modById.set(m.id, m);
    }
  }
  const weightMap = new Map();
  const countMap = new Map();
  const reverseNotes = new Map();
  for (const e of edges) {
    const srcU = unitByModId.get(e.from);
    const dstU = unitByModId.get(e.to);
    const srcMod = modById.get(e.from);
    if (!srcU || !dstU || !srcMod || srcU.id === dstU.id) continue;
    if (dstU.isRoot) {
      reverseNotes.set(srcU.id, (reverseNotes.get(srcU.id) || 0) + 1);
      continue;
    }
    const pairKey = `${srcU.id}->${dstU.id}`;
    weightMap.set(pairKey, (weightMap.get(pairKey) || 0) + hydWbComputeEdgeWeight(srcMod, srcU.isRoot, e.kind));
    countMap.set(pairKey, (countMap.get(pairKey) || 0) + 1);
  }
  return { weightMap, countMap, reverseNotes };
}

function hydWbOrientUnitPairs(units, weightMap, countMap, reverseNotes) {
  const nextUnitMap = new Map(units.map((u) => [u.id, new Set()]));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const ua = units[i], ub = units[j];
      const wab = weightMap.get(`${ua.id}->${ub.id}`) || 0;
      const wba = weightMap.get(`${ub.id}->${ua.id}`) || 0;
      if (wab === 0 && wba === 0) continue;
      const preferAB = wab > wba || (wab === wba && ua.archTier <= ub.archTier);
      const [win, lose, loseW, loseKey] = preferAB
        ? [ua.id, ub.id, wba, `${ub.id}->${ua.id}`]
        : [ub.id, ua.id, wab, `${ua.id}->${ub.id}`];
      nextUnitMap.get(win).add(lose);
      if (loseW > 0) reverseNotes.set(lose, (reverseNotes.get(lose) || 0) + (countMap.get(loseKey) || 1));
    }
  }
  return nextUnitMap;
}

function hydWbCompareDfsOrder(a, b) {
  if (a.isRoot && !b.isRoot) return -1;
  if (b.isRoot && !a.isRoot) return 1;
  if (a.archTier !== b.archTier) return a.archTier - b.archTier;
  return laneOrderRank(a.primaryLane) - laneOrderRank(b.primaryLane);
}

function hydWbDfsPruneCycle(u, nextUnitMap, rootIds, color) {
  color.set(u, 1);
  for (const v of [...(nextUnitMap.get(u) || [])]) {
    if (rootIds.has(v) || color.get(v) === 1) nextUnitMap.get(u).delete(v);
    else if (!color.get(v)) hydWbDfsPruneCycle(v, nextUnitMap, rootIds, color);
  }
  color.set(u, 2);
}

function hydWbRelaxUnitEdges(nextUnitMap, rootIds, depthByUnit) {
  for (const [u, targets] of nextUnitMap.entries()) {
    const nextDepth = (depthByUnit.get(u) || 0) + 1;
    for (const v of targets) {
      if (!rootIds.has(v) && (depthByUnit.get(v) || 0) < nextDepth) depthByUnit.set(v, nextDepth);
    }
  }
}

function hydWbCompareUnitTopology(a, b, depthByUnit) {
  if (a.isRoot && !b.isRoot) return -1;
  if (b.isRoot && !a.isRoot) return 1;
  const diff = (depthByUnit.get(a.id) || 0) - (depthByUnit.get(b.id) || 0);
  if (diff !== 0) return diff;
  if (a.archTier !== b.archTier) return a.archTier - b.archTier;
  const lr = laneOrderRank(a.primaryLane) - laneOrderRank(b.primaryLane);
  return lr !== 0 ? lr : a.key.localeCompare(b.key);
}

function buildAcyclicUnitTopology(units, edges) {
  const { weightMap, countMap, reverseNotes } = hydWbAccumulateUnitEdgeWeights(units, edges);
  const nextUnitMap = hydWbOrientUnitPairs(units, weightMap, countMap, reverseNotes);
  const rootIds = new Set(units.filter((u) => u.isRoot).map((u) => u.id));
  const color = new Map();
  for (const u of [...units].sort(hydWbCompareDfsOrder)) {
    if (!color.get(u.id)) hydWbDfsPruneCycle(u.id, nextUnitMap, rootIds, color);
  }
  const initDepth = rootIds.size > 0 ? 1 : 0;
  const depthByUnit = new Map(units.map((u) => [u.id, u.isRoot ? 0 : initDepth]));
  for (let pass = 0; pass < units.length; pass++) {
    hydWbRelaxUnitEdges(nextUnitMap, rootIds, depthByUnit);
  }
  const sortedUnits = [...units].sort((a, b) => hydWbCompareUnitTopology(a, b, depthByUnit));
  return { sortedUnits, nextUnitMap, depthByUnit, reverseNotes };
}

function hydWbComputeUnitColumn(unit, hasEdges, hasRoot, depthByUnit) {
  if (unit.isRoot) return 0;
  const rootOffset = hasRoot ? 1 : 0;
  if (hasEdges) return depthByUnit.get(unit.id) || rootOffset;
  return laneOrderRank(unit.primaryLane) + rootOffset;
}

function hydWbModMatchesScope(modPath, rawScope) {
  const ns = rawScope.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!ns) return true;
  return ns.endsWith('/') ? modPath.startsWith(ns) : (modPath === ns || modPath.startsWith(ns + '/'));
}

function hydWbCollectUnitScopes(unit, contractIds, rawById) {
  const scopeSet = new Set(unit.baseScopes || []);
  for (const cid of contractIds) {
    const rc = rawById.get(cid);
    for (const sp of (rc?.scope || [])) {
      const clean = typeof sp === 'string' ? sp.trim().replace(/\\/g, '/') : '';
      if (clean && (unit.mods.length === 0 || unit.mods.some((m) => hydWbModMatchesScope(m.path, clean)))) {
        scopeSet.add(clean);
      }
    }
  }
  return [...scopeSet];
}

function hydWbBuildUnitTip(unit, contractIds, reverseCount) {
  const modCount = unit.mods.length;
  const tipParts = [modCount === 1 ? `源码模块：${unit.mods[0].path}` : `共 ${modCount} 个源码模块`];
  if (unit.wildCount > 0) tipParts.push(`${unit.wildCount} 个尚未挂入契约保护`);
  if (contractIds.length > 0) tipParts.push(`关联契约：${contractIds.join('、')}`);
  if (reverseCount) tipParts.push(`含 ${reverseCount} 处反向自检调用`);
  if ((unit.activeBranches || []).length > 1) tipParts.push(`活跃支线：${unit.activeBranches.join(' / ')}`);
  return tipParts.join(' · ');
}

function hydWbResolveLifecycleLabel(contractIds, summaryById) {
  if (contractIds.length === 0) return '未挂契约';
  return summaryById.get(contractIds[0])?.lifecycleLabel || '草稿待冻结';
}

function hydWbMapHostModuleCard(m) {
  const epNames = (m.entrypoints || []).map((ep) => ep.humanTitle).filter(Boolean);
  const name = epNames.length > 0 ? `${m.humanTitle}（${epNames.join(' / ')}）` : m.humanTitle;
  return {
    name, role: mapModRoleLabel(m), state: mapModState(m),
    path: m.path, vibeLabel: m.vibeLabel, aiPrompt: m.aiPrompt, techSummary: m.techSummary
  };
}

function hydWbBuildHostUnitNode(unit, idx, ctx) {
  const { unitById, rawById, summaryById, nextUnitMap, depthByUnit, reverseNotes, colCounts, savedState, hasEdges, hasRoot } = ctx;
  const col = hydWbComputeUnitColumn(unit, hasEdges, hasRoot, depthByUnit);
  const rowIdx = colCounts.get(col) || 0;
  colCounts.set(col, rowIdx + 1);

  const contractIds = [...new Set(unit.mods.map((m) => m.contractId).filter(Boolean))];
  const nodeId = unit.nodeId;
  const saved = (savedState.hostNodeLayouts || {})[nodeId] || {};
  const nextIds = [...(nextUnitMap.get(unit.id) || [])]
    .map((uid) => unitById.get(uid)?.nodeId || null)
    .filter(Boolean);

  return {
    id: nodeId,
    step: String(idx + 1).padStart(2, '0'),
    title: unit.humanTitle,
    sublinePath: unit.sublinePath || '',
    tip: hydWbBuildUnitTip(unit, contractIds, reverseNotes.get(unit.id)),
    contractIds,
    primaryContractId: contractIds[0] || null,
    lifecycleLabel: hydWbResolveLifecycleLabel(contractIds, summaryById),
    scopePaths: hydWbCollectUnitScopes(unit, contractIds, rawById),
    workflowBinding: (savedState.componentWorkflows || {})[nodeId] || null,
    bypassed: Boolean(saved.bypassed),
    collapsed: Boolean(saved.collapsed),
    expanded: saved.expanded !== undefined ? Boolean(saved.expanded) : false,
    color: saved.color || 'none',
    x: typeof saved.x === 'number' ? saved.x : 56 + col * 316,
    y: typeof saved.y === 'number' ? saved.y : 68 + rowIdx * 238,
    w: typeof saved.w === 'number' ? saved.w : 256,
    h: typeof saved.h === 'number' ? saved.h : null,
    nextIds,
    modules: unit.mods.map(hydWbMapHostModuleCard)
  };
}

function buildHostSandboxFromAtlas(baseAtlas, savedState, projectRoot = null) {
  const rawUnits = hydWbResolveUnitsFromAtlas(baseAtlas);
  const { sortedUnits, nextUnitMap, depthByUnit, reverseNotes } = buildAcyclicUnitTopology(
    rawUnits,
    baseAtlas.edges || []
  );
  const ctx = {
    unitById: new Map(sortedUnits.map((u) => [u.id, u])),
    rawById: new Map((baseAtlas.rawContracts || []).map((c) => [c.id, c])),
    summaryById: new Map(((baseAtlas.status && baseAtlas.status.contractSummaries) || []).map((s) => [s.id, s])),
    nextUnitMap, depthByUnit, reverseNotes,
    colCounts: new Map(), savedState,
    hasEdges: (baseAtlas.edges || []).length > 0,
    hasRoot: sortedUnits.some((u) => u.isRoot)
  };
  const codeUnitNodes = sortedUnits.map((unit, idx) => hydWbBuildHostUnitNode(unit, idx, ctx));
  const absProj = projectRoot ? resolve(projectRoot) : null;
  const hasInitializedIntent = Boolean(absProj && (existsSync(join(absProj, 'INTENT.md')) || existsSync(join(absProj, 'contracts')) || existsSync(join(absProj, 'donegate', 'SKILL.md'))));
  const businessNodes = buildAdaptiveBusinessHierarchy(codeUnitNodes, savedState, hasInitializedIntent);
  return {
    id: 'host-workspace',
    name: `${baseAtlas.project.name}（当前本仓）`,
    repoSlug: `local/${baseAtlas.project.name}`,
    isHost: true,
    readonly: false,
    tip: `${baseAtlas.project.summary} · 按模块度内聚增益自适应折叠业务流，支持原地展开与代码架构透视`,
    nodes: businessNodes,
    codeUnitNodes,
    groups: Array.isArray(savedState.hostGroups) ? savedState.hostGroups : []
  };
}

function scanSiblingWorkspaces(projectRoot) {
  const absRoot = resolve(projectRoot);
  const parentDir = dirname(absRoot);
  const out = [];
  try {
    for (const ent of readdirSync(parentDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
      const full = join(parentDir, ent.name);
      if (resolve(full) === absRoot) continue;
      const hasMarker = existsSync(join(full, 'contracts')) || existsSync(join(full, '.donegate')) ||
        existsSync(join(full, 'package.json')) || existsSync(join(full, 'pyproject.toml'));
      if (!hasMarker) continue;
      out.push({
        id: `sib-${ent.name.replace(/[^A-Za-z0-9_-]/g, '-')}`,
        name: `相邻仓：${ent.name}`,
        repoSlug: `sibling/${ent.name}`,
        isHost: false,
        readonly: true,
        tip: `同级目录只读参考工作区（../${ent.name}）：可作为汇总节点引入或复制卡片结构`,
        nodes: [{
          id: `sib-n-${ent.name.slice(0, 8)}`, step: '外仓', title: `${ent.name} 核心入口`,
          tip: `位于 ../${ent.name}/ 的相邻工程目录`, scopePaths: [`../${ent.name}/`],
          bypassed: false, collapsed: false, expanded: true, x: 80, y: 120, w: 252, h: null, nextIds: [],
          modules: [{ name: `${ent.name} 工程根目录`, role: '外仓', state: 'ok', path: `../${ent.name}/package.json` }]
        }]
      });
      if (out.length >= 3) break;
    }
  } catch (err) {
    void err;
  }
  return out;
}

function hydWbResolveAdapterUpstream(tool, adp, capDoc, upCfg) {
  const isZeroBin = (capDoc.archetype === 'knowledge-skill' || capDoc.archetype === 'aggregator') && !upCfg.repo;
  let up = UPSTREAM_GITHUB_MAP[tool];
  if (!up) {
    const range = isZeroBin ? '' : (adp.testedToolRange || 'v1.0.0');
    const fallbackRepo = isZeroBin ? '' : (upCfg.repo || `opensource/${tool}`);
    up = [fallbackRepo, range, range];
  }
  const repoSlug = isZeroBin ? '' : (upCfg.repo || up[0]);
  const repoUrl = upCfg.homepage || (repoSlug ? `https://github.com/${repoSlug}` : '');
  return { repoSlug, repoUrl, pinnedVersion: up[1], latestUpstream: up[2] };
}

function hydWbResolveAdapterCategory(tool, cardCfg) {
  if (cardCfg.category) return cardCfg.category;
  if (SEC_ADAPTER_TOOLS.has(tool)) return '安全与运维';
  if (E2E_ADAPTER_TOOLS.has(tool)) return '端侧与构建';
  return '代码护栏';
}

function hydWbResolveAdapterIoAndSlots(cardCfg, hm) {
  const inputs = Array.isArray(cardCfg.inputs) && cardCfg.inputs.length > 0
    ? cardCfg.inputs
    : [{ id: 'in_src', name: hm?.inName || '待查代码或产物', type: 'ARTIFACT' }];
  const outputs = Array.isArray(cardCfg.outputs) && cardCfg.outputs.length > 0
    ? cardCfg.outputs
    : [
        { id: 'out_sig', name: hm?.outSig || '是否通过检查', type: 'SIGNAL' },
        { id: 'out_obs', name: hm?.outObs || '问题详情报告', type: 'TEXT' }
      ];
  let slots = cardCfg.slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    if (hm && Array.isArray(hm.slots)) {
      slots = hm.slots.map((lbl, i) => ({ id: `ob_${i}`, label: lbl, wired: true, boundOut: outputs[Math.min(i, outputs.length - 1)].id }));
    } else {
      slots = [{ id: 'ob_0', label: '自动执行规则检查', wired: true, boundOut: outputs[0].id }];
    }
  }
  return { inputs, outputs, slots };
}

function hydWbBuildAdapterTemplate(projectRoot, adp, tool) {
  const localCap = join(resolve(projectRoot), 'bricks', tool, 'capabilities.json');
  const capPath = existsSync(localCap) ? localCap : join(DG_ROOT, 'bricks', tool, 'capabilities.json');
  const capDoc = readJsonStrict(capPath).value || {};
  const cardCfg = (capDoc.card && typeof capDoc.card === 'object') ? capDoc.card : {};
  const upCfg = (capDoc.upstream && typeof capDoc.upstream === 'object') ? capDoc.upstream : {};
  const hm = ADAPTER_HUMAN_META[tool] || null;
  const upstream = hydWbResolveAdapterUpstream(tool, adp, capDoc, upCfg);
  const ioSlots = hydWbResolveAdapterIoAndSlots(cardCfg, hm);
  const blindTip = adp.blindSpots?.[0] ? `自动检查边界说明：${adp.blindSpots[0]}` : '外部开源规则检查节点';
  return {
    tplId: `tpl-adp-${tool}`,
    category: hydWbResolveAdapterCategory(tool, cardCfg),
    title: cardCfg.title || hm?.title || '外部工具规则检查',
    archetype: capDoc.archetype || 'scanner',
    uiExternalUrl: upCfg.uiExternalUrl || null,
    ...upstream,
    entryPath: adp.entry || `skill/adapters/${tool}.mjs`,
    brickDir: `bricks/${tool}/`,
    tip: cardCfg.summary || blindTip,
    ...ioSlots
  };
}

function hydWbSeedSeenCatalogTraits() {
  const slugs = new Set();
  const titles = new Set();
  for (const t of WB_PRESET_TEMPLATE_TRAITS) {
    if (t.repoSlug) slugs.add(t.repoSlug.toLowerCase());
    if (t.title) titles.add(t.title.trim());
  }
  return { slugs, titles };
}

function hydWbIsDuplicateTemplate(tpl, seenTraits) {
  const slug = String(tpl.repoSlug || '').trim().toLowerCase();
  const title = String(tpl.title || '').trim();
  if ((slug && seenTraits.slugs.has(slug)) || (title && seenTraits.titles.has(title))) return true;
  if (slug) seenTraits.slugs.add(slug);
  if (title) seenTraits.titles.add(title);
  return false;
}

function loadRegisteredAdapterTemplates(projectRoot) {
  const localReg = join(resolve(projectRoot), 'adapters.registry.json');
  const regPath = existsSync(localReg) ? localReg : join(DG_ROOT, 'adapters.registry.json');
  const regRes = readJsonStrict(regPath);
  if (!regRes.ok || !Array.isArray(regRes.value?.adapters)) return [];

  const seenTools = new Set();
  const seenTraits = hydWbSeedSeenCatalogTraits();
  const templates = [];
  for (const adp of regRes.value.adapters) {
    const tool = String(adp.tool || '').trim();
    if (!tool || seenTools.has(tool)) continue;
    seenTools.add(tool);
    const tpl = hydWbBuildAdapterTemplate(projectRoot, adp, tool);
    if (!hydWbIsDuplicateTemplate(tpl, seenTraits)) templates.push(tpl);
  }
  return templates;
}

function loadDeclarativeWorkflowPacks(projectRoot) {
  const packs = {};
  for (const base of [DG_ROOT, resolve(projectRoot)]) {
    for (const sub of ['workflows', join('workflows', 'defaults')]) {
      const wfDir = join(base, sub);
      if (!existsSync(wfDir)) continue;
      try {
        for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.workflow.json'))) {
          const r = readJsonStrict(join(wfDir, f));
          if (r.ok && r.value && r.value.id && Array.isArray(r.value.nodes)) {
            packs[r.value.id] = { group: r.value.group || '项目声明式工作流', ...r.value, links: r.value.links || [], groups: r.value.groups || [] };
          }
        }
      } catch (err) {
        void err;
      }
    }
  }
  return packs;
}

export function hydrateWorkbenchData(projectRoot, baseAtlas) {
  const savedState = readSavedWorkbenchState(projectRoot);
  savedState.customPacks = { ...loadDeclarativeWorkflowPacks(projectRoot), ...(savedState.customPacks || {}) };
  const hostSandbox = buildHostSandboxFromAtlas(baseAtlas, savedState, projectRoot);
  const siblingSandboxes = scanSiblingWorkspaces(projectRoot);
  const registeredTemplates = loadRegisteredAdapterTemplates(projectRoot);
  const depsBundle = inspectAllKnownWorkflowPacks(projectRoot, savedState.customPacks);
  const uiboardToolchain = readUiToolchainStatus(projectRoot);
  const governance = buildGovernanceSummaryPayload(projectRoot);
  return {
    hostId: hostSandbox.id,
    hostSandbox,
    siblingSandboxes,
    registeredTemplates,
    savedState,
    packDepReports: depsBundle.reports,
    sharedPool: depsBundle.sharedPool,
    depsRefreshStamp: depsBundle.refreshStamp,
    uiboardToolchain,
    governance
  };
}
