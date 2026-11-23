// 工作台活体数据注水层：将全仓扫描的模块/入口/契约 scope[] 与适配器注册表映射为「项目看板 + 工作流」交互模型
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../../skill/io.mjs';

const DG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

function defaultSavedState() {
  return {
    schemaVersion: '1.0', hostLayoutVer: 2, customPacks: {}, importedSandboxes: {}, componentWorkflows: {}, hostNodeLayouts: {}, hostGroups: [], hostSubgraphs: [],
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
  if (r.value.hostLayoutVer !== 2 && merged.hostNodeLayouts && typeof merged.hostNodeLayouts === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(merged.hostNodeLayouts)) {
      if (v && typeof v === 'object') { const { x: _x, y: _y, ...rest } = v; void _x; void _y; cleaned[k] = rest; }
    }
    merged.hostNodeLayouts = cleaned;
    merged.hostLayoutVer = 2;
  }
  return merged;
}

function laneOrderRank(lane) {
  return lane === 'ui' ? 0 : (lane === 'api' ? 1 : (lane === 'tool' ? 2 : 3));
}

function mapModRoleLabel(mod) {
  if (mod.lane === 'ui') return '界面';
  if (mod.lane === 'api') return '接口';
  if (mod.lane === 'tool') return '工具';
  return '底座';
}

function mapModState(mod) {
  if ((mod.touchedByBranches || []).length > 1 || mod.tone === 'bad') return 'err';
  if (mod.isWild || mod.tone === 'warn') return 'warn';
  return 'ok';
}

function buildAcyclicDomainTopology(rawDomains, modules, edges) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const weightMap = new Map(), countMap = new Map(), reverseNotes = new Map();
  for (const e of edges) {
    const srcMod = modById.get(e.from), dstMod = modById.get(e.to);
    if (!srcMod || !dstMod || srcMod.domainId === dstMod.domainId) continue;
    if (dstMod.domainKey === 'root') { reverseNotes.set(srcMod.domainId, (reverseNotes.get(srcMod.domainId) || 0) + 1); continue; }
    const isAuxCheck = /(?:^|\/)(?:tests?|__tests__|e2e|check-|self-test|fixtures?|progress-note)[^/]*\.|\.(?:test|spec)\./i.test(srcMod.path);
    const w = srcMod.domainKey === 'root' ? 8 : (isAuxCheck ? 1 : (e.kind === 'script-ref' ? 2 : 4));
    const pairKey = `${srcMod.domainId}->${dstMod.domainId}`;
    weightMap.set(pairKey, (weightMap.get(pairKey) || 0) + w);
    countMap.set(pairKey, (countMap.get(pairKey) || 0) + 1);
  }

  const nextDomMap = new Map(rawDomains.map((d) => [d.id, new Set()]));
  const domIds = rawDomains.map((d) => d.id);
  for (let i = 0; i < domIds.length; i++) {
    for (let j = i + 1; j < domIds.length; j++) {
      const a = domIds[i], b = domIds[j];
      const wab = weightMap.get(`${a}->${b}`) || 0;
      const wba = weightMap.get(`${b}->${a}`) || 0;
      if (wab === 0 && wba === 0) continue;
      if (wab >= wba) {
        nextDomMap.get(a).add(b);
        if (wba > 0) reverseNotes.set(b, (reverseNotes.get(b) || 0) + (countMap.get(`${b}->${a}`) || 1));
      } else {
        nextDomMap.get(b).add(a);
        if (wab > 0) reverseNotes.set(a, (reverseNotes.get(a) || 0) + (countMap.get(`${a}->${b}`) || 1));
      }
    }
  }

  const orderedForDfs = [...rawDomains].sort((a, b) => (a.key === 'root' ? -1 : (b.key === 'root' ? 1 : laneOrderRank(a.primaryLane) - laneOrderRank(b.primaryLane))));
  const color = new Map();
  const dfsBreak = (u) => {
    color.set(u, 1);
    for (const v of [...(nextDomMap.get(u) || [])]) {
      if (v === 'dom:root' || color.get(v) === 1) nextDomMap.get(u).delete(v);
      else if (!color.get(v)) dfsBreak(v);
    }
    color.set(u, 2);
  };
  for (const d of orderedForDfs) if (!color.get(d.id)) dfsBreak(d.id);

  const hasRoot = rawDomains.some((d) => d.key === 'root');
  const depthByDom = new Map(rawDomains.map((d) => [d.id, d.key === 'root' ? 0 : (hasRoot ? 1 : 0)]));
  for (let pass = 0; pass < rawDomains.length; pass++) {
    for (const [u, targets] of nextDomMap.entries()) {
      const du = depthByDom.get(u) || 0;
      for (const v of targets) {
        if (v !== 'dom:root' && (depthByDom.get(v) || 0) < du + 1) depthByDom.set(v, du + 1);
      }
    }
  }
  const sortedDomains = [...rawDomains].sort((a, b) => {
    if (a.key === 'root' && b.key !== 'root') return -1;
    if (b.key === 'root' && a.key !== 'root') return 1;
    const da = depthByDom.get(a.id) || 0;
    const db = depthByDom.get(b.id) || 0;
    if (da !== db) return da - db;
    const lr = laneOrderRank(a.primaryLane) - laneOrderRank(b.primaryLane);
    return lr !== 0 ? lr : a.key.localeCompare(b.key);
  });
  return { sortedDomains, nextDomMap, depthByDom, reverseNotes };
}

function buildHostSandboxFromAtlas(baseAtlas, savedState) {
  const { sortedDomains: domains, nextDomMap, depthByDom, reverseNotes } = buildAcyclicDomainTopology(
    baseAtlas.domains || [],
    baseAtlas.modules || [],
    baseAtlas.edges || []
  );
  const rawById = new Map((baseAtlas.rawContracts || []).map((c) => [c.id, c]));
  const summaryById = new Map(((baseAtlas.status && baseAtlas.status.contractSummaries) || []).map((s) => [s.id, s]));
  const modsByDom = new Map();
  for (const m of (baseAtlas.modules || [])) {
    if (!modsByDom.has(m.domainId)) modsByDom.set(m.domainId, []);
    modsByDom.get(m.domainId).push(m);
  }

  const colCounts = new Map();
  const nodes = domains.map((dom, idx) => {
    const domMods = modsByDom.get(dom.id) || [];
    const hasEdges = (baseAtlas.edges || []).length > 0;
    const hasRoot = domains.some((d) => d.key === 'root');
    const col = dom.key === 'root' ? 0 : (hasEdges ? (depthByDom.get(dom.id) || (hasRoot ? 1 : 0)) : laneOrderRank(dom.primaryLane) + (hasRoot ? 1 : 0));
    const rowIdx = colCounts.get(col) || 0;
    colCounts.set(col, rowIdx + 1);

    const contractIds = [...new Set(domMods.map((m) => m.contractId).filter(Boolean))];
    const scopeSet = new Set([dom.key === 'root' ? './' : `${dom.key}/`]);
    for (const cid of contractIds) {
      const rc = rawById.get(cid);
      for (const sp of (rc?.scope || [])) {
        if (typeof sp === 'string' && sp.trim()) scopeSet.add(sp.trim().replace(/\\/g, '/'));
      }
    }

    const nodeId = `host-dom-${dom.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const saved = (savedState.hostNodeLayouts || {})[nodeId] || {};
    const nextDomIds = [...(nextDomMap.get(dom.id) || [])];
    const nextNodeIds = nextDomIds.map((did) => {
      const target = domains.find((d) => d.id === did);
      return target ? `host-dom-${target.key.replace(/[^A-Za-z0-9_-]/g, '-')}` : null;
    }).filter(Boolean);

    const collisionBranches = dom.activeBranches || [];
    const tipParts = [`共 ${domMods.length} 个源码模块`];
    if (dom.wildCount > 0) tipParts.push(`${dom.wildCount} 个尚未挂入契约保护`);
    if (contractIds.length > 0) tipParts.push(`关联契约：${contractIds.join('、')}`);
    if (reverseNotes.get(dom.id)) tipParts.push(`含 ${reverseNotes.get(dom.id)} 处门禁脚本反向自检调用`);
    if (collisionBranches.length > 1) tipParts.push(`活跃支线：${collisionBranches.join(' / ')}`);

    return {
      id: nodeId,
      step: String(idx + 1).padStart(2, '0'),
      title: dom.humanTitle || dom.key,
      tip: tipParts.join(' · '),
      contractIds,
      primaryContractId: contractIds[0] || null,
      lifecycleLabel: (contractIds[0] && summaryById.get(contractIds[0])?.lifecycleLabel) || (contractIds.length ? '草稿待冻结' : '未挂契约'),
      scopePaths: [...scopeSet],
      workflowBinding: (savedState.componentWorkflows || {})[nodeId] || null,
      bypassed: Boolean(saved.bypassed || false),
      collapsed: Boolean(saved.collapsed || false),
      expanded: saved.expanded !== undefined ? Boolean(saved.expanded) : domMods.length <= 4,
      color: saved.color || 'none',
      x: typeof saved.x === 'number' ? saved.x : 56 + col * 316,
      y: typeof saved.y === 'number' ? saved.y : 68 + rowIdx * 238,
      w: typeof saved.w === 'number' ? saved.w : 256,
      h: typeof saved.h === 'number' ? saved.h : null,
      nextIds: nextNodeIds,
      modules: domMods.slice(0, 14).map((m) => {
        const epNames = (m.entrypoints || []).map((ep) => ep.humanTitle).filter(Boolean);
        const label = epNames.length > 0 ? `${m.humanTitle}（${epNames.join(' / ')}）` : m.humanTitle;
        return {
          name: label,
          role: mapModRoleLabel(m),
          state: mapModState(m),
          path: m.path,
          vibeLabel: m.vibeLabel,
          aiPrompt: m.aiPrompt,
          techSummary: m.techSummary
        };
      })
    };
  });

  return {
    id: 'host-workspace',
    name: `${baseAtlas.project.name}（当前本仓）`,
    repoSlug: `local/${baseAtlas.project.name}`,
    isHost: true,
    readonly: false,
    tip: `${baseAtlas.project.summary} · 支持基于契约 scope[] 右键定位真实目录`,
    nodes,
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
          id: `sib-n-${ent.name.slice(0, 8)}`,
          step: '外仓',
          title: `${ent.name} 核心入口`,
          tip: `位于 ../${ent.name}/ 的相邻工程目录`,
          scopePaths: [`../${ent.name}/`],
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

function loadRegisteredAdapterTemplates(projectRoot) {
  const localReg = join(resolve(projectRoot), 'adapters.registry.json');
  const regPath = existsSync(localReg) ? localReg : join(DG_ROOT, 'adapters.registry.json');
  const regRes = readJsonStrict(regPath);
  if (!regRes.ok || !Array.isArray(regRes.value?.adapters)) return [];

  const seenTools = new Set();
  const templates = [];
  for (const adp of regRes.value.adapters) {
    const tool = String(adp.tool || '').trim();
    if (!tool || seenTools.has(tool)) continue;
    seenTools.add(tool);

    const localCap = join(resolve(projectRoot), 'bricks', tool, 'capabilities.json');
    const capPath = existsSync(localCap) ? localCap : join(DG_ROOT, 'bricks', tool, 'capabilities.json');
    const capRes = readJsonStrict(capPath);
    const capDoc = capRes.value || {};
    const cardCfg = (capDoc.card && typeof capDoc.card === 'object') ? capDoc.card : {};
    const upCfg = (capDoc.upstream && typeof capDoc.upstream === 'object') ? capDoc.upstream : {};
    const hm = ADAPTER_HUMAN_META[tool] || null;
    const isZeroBin = (capDoc.archetype === 'knowledge-skill' || capDoc.archetype === 'aggregator') && !upCfg.repo;
    const up = UPSTREAM_GITHUB_MAP[tool] || [isZeroBin ? '' : (upCfg.repo || `opensource/${tool}`), isZeroBin ? '' : (adp.testedToolRange || 'v1.0.0'), isZeroBin ? '' : (adp.testedToolRange || 'v1.0.0')];
    const repoSlug = isZeroBin ? '' : (upCfg.repo || up[0]);
    const cat = cardCfg.category || (['gitleaks', 'osv-scanner', 'semgrep', 'syft', 'trivy', 'vuln-merge'].includes(tool)
      ? '安全与运维'
      : (['playwright', 'maestro', 'vitest'].includes(tool) ? '端侧与构建' : '代码护栏'));
    const inputs = Array.isArray(cardCfg.inputs) && cardCfg.inputs.length > 0
      ? cardCfg.inputs
      : [{ id: 'in_src', name: (hm && hm.inName) || '待查代码或产物', type: 'ARTIFACT' }];
    const outputs = Array.isArray(cardCfg.outputs) && cardCfg.outputs.length > 0
      ? cardCfg.outputs
      : [
          { id: 'out_sig', name: (hm && hm.outSig) || '是否通过检查', type: 'SIGNAL' },
          { id: 'out_obs', name: (hm && hm.outObs) || '问题详情报告', type: 'TEXT' }
        ];
    const slots = Array.isArray(cardCfg.slots) && cardCfg.slots.length > 0
      ? cardCfg.slots
      : (hm && Array.isArray(hm.slots)
          ? hm.slots.map((lbl, i) => ({ id: `ob_${i}`, label: lbl, wired: true, boundOut: outputs[Math.min(i, outputs.length - 1)].id }))
          : [{ id: 'ob_0', label: '自动执行规则检查', wired: true, boundOut: outputs[0].id }]);

    templates.push({
      tplId: `tpl-adp-${tool}`,
      category: cat,
      title: cardCfg.title || (hm && hm.title) || '外部工具规则检查',
      archetype: capDoc.archetype || 'scanner',
      uiExternalUrl: upCfg.uiExternalUrl || null,
      repoSlug,
      repoUrl: repoSlug ? (upCfg.homepage || `https://github.com/${repoSlug}`) : (upCfg.homepage || ''),
      pinnedVersion: up[1],
      latestUpstream: up[2],
      entryPath: adp.entry || `skill/adapters/${tool}.mjs`,
      brickDir: `bricks/${tool}/`,
      tip: cardCfg.summary || ((adp.blindSpots && adp.blindSpots[0]) ? `自动检查边界说明：${adp.blindSpots[0]}` : '外部开源规则检查节点'),
      inputs,
      outputs,
      slots
    });
  }
  return templates;
}

function loadDeclarativeWorkflowPacks(projectRoot) {
  const packs = {};
  for (const base of [DG_ROOT, resolve(projectRoot)]) {
    const wfDir = join(base, 'workflows');
    if (!existsSync(wfDir)) continue;
    try {
      for (const f of readdirSync(wfDir).filter((x) => x.endsWith('.workflow.json'))) {
        const r = readJsonStrict(join(wfDir, f));
        if (r.ok && r.value && r.value.id && Array.isArray(r.value.nodes)) {
          packs[r.value.id] = { group: r.value.group || '项目声明式工作流', ...r.value, links: r.value.links || [], groups: r.value.groups || [] };
        }
      }
    } catch (err) { void err; }
  }
  return packs;
}

export function hydrateWorkbenchData(projectRoot, baseAtlas) {
  const savedState = readSavedWorkbenchState(projectRoot);
  savedState.customPacks = { ...loadDeclarativeWorkflowPacks(projectRoot), ...(savedState.customPacks || {}) };
  const hostSandbox = buildHostSandboxFromAtlas(baseAtlas, savedState);
  const siblingSandboxes = scanSiblingWorkspaces(projectRoot);
  const registeredTemplates = loadRegisteredAdapterTemplates(projectRoot);
  return {
    hostId: hostSandbox.id,
    hostSandbox,
    siblingSandboxes,
    registeredTemplates,
    savedState
  };
}
