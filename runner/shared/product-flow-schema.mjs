// L0 三层产品价值流（L1 价值阶段 -> L2 特性交互子流 -> L3 状态与决策门）与底座契约分流校验原语（<= 350 行）

export const MAX_PRODUCT_FLOW_DEPTH = 3;
export const CONTRACT_ROLES = Object.freeze(['product', 'infra']);
export const L3_STEP_KINDS = Object.freeze(['step', 'store', 'guard']);

const VALID_STEP_KIND_SET = new Set(L3_STEP_KINDS);

export function isInfraContract(contract) {
  return Boolean(contract && !contract.retired && contract.role === 'infra');
}

function pfsNormTitle(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function pfsPushIssue(issues, code, id, level, message) {
  issues.push({ code, id: String(id || 'unknown'), level, message });
}

function pfsHasIllegalNestedChildren(step) {
  if (Array.isArray(step.subflows) && step.subflows.length > 0) return true;
  if (Array.isArray(step.steps) && step.steps.length > 0) return true;
  return Number.isInteger(step.level) && step.level > MAX_PRODUCT_FLOW_DEPTH;
}

function pfsCheckStepTitleAndKind(step, stepId, ancestorTitles, seenStepTitles, issues) {
  const title = pfsNormTitle(step.title);
  if (!title) {
    pfsPushIssue(issues, 'MISSING_STEP_TITLE', stepId, 3, `L3 节点 ${stepId} 缺少产品白话 title`);
  } else if (ancestorTitles.has(title) || seenStepTitles.has(title)) {
    pfsPushIssue(issues, 'DUPLICATE_ANCESTOR_TITLE', stepId, 3, `L3 节点 ${stepId} 标题「${title}」与父祖先或同层节点重名（禁套娃重名）`);
  } else {
    seenStepTitles.add(title);
  }
  const kind = step.kind || 'step';
  if (!VALID_STEP_KIND_SET.has(kind)) {
    pfsPushIssue(issues, 'INVALID_STEP_KIND', stepId, 3, `L3 节点 ${stepId} kind="${kind}" 非法（仅限 step | store | guard）`);
  }
  return kind;
}

function pfsValidateL3Step(step, idx, subId, ancestorTitles, stepIds, seenStepTitles, issues) {
  const rawId = typeof step?.id === 'string' ? step.id.trim() : '';
  const stepId = rawId || `${subId}#step-${idx}`;
  if (!step || typeof step !== 'object' || !rawId) {
    pfsPushIssue(issues, 'INVALID_STEP_ID', stepId, 3, `L3 节点 (${subId}) 缺少非空 id`);
    return;
  }
  const kind = pfsCheckStepTitleAndKind(step, stepId, ancestorTitles, seenStepTitles, issues);
  if (pfsHasIllegalNestedChildren(step)) {
    const errCode = kind === 'guard' ? 'GUARD_CHILDREN_FORBIDDEN' : 'DEPTH_CAP_EXCEEDED';
    pfsPushIssue(issues, errCode, stepId, 4, `节点 ${stepId} 试图下钻第 4 层子图（视觉图硬封顶 ${MAX_PRODUCT_FLOW_DEPTH} 级，第 4 层须转入 L4 透视抽屉）`);
  }
  const nextIds = Array.isArray(step.next) ? step.next : [];
  for (const targetId of nextIds) {
    if (!stepIds.has(targetId)) {
      pfsPushIssue(issues, 'DANGLING_EDGE_TARGET', stepId, 3, `L3 节点 ${stepId} 的流向目标 "${targetId}" 在当前子流中不存在`);
    }
  }
}

function pfsCheckSubflowHeader(sub, subId, fnId, l1Title, seenSubIds, seenSubTitles, issues) {
  if (seenSubIds.has(subId)) {
    pfsPushIssue(issues, 'DUPLICATE_SUBFLOW_ID', subId, 2, `功能 ${fnId} 存在重复 L2 子流 id：${subId}`);
  }
  seenSubIds.add(subId);
  const subTitle = pfsNormTitle(sub.title);
  if (!subTitle) {
    pfsPushIssue(issues, 'MISSING_SUBFLOW_TITLE', subId, 2, `L2 子流 ${subId} 缺少白话 title`);
  } else if (subTitle === l1Title || seenSubTitles.has(subTitle)) {
    pfsPushIssue(issues, 'DUPLICATE_ANCESTOR_TITLE', subId, 2, `L2 子流 ${subId} 标题「${subTitle}」与父阶段或同层子流重名`);
  } else {
    seenSubTitles.add(subTitle);
  }
  if (sub.kind === 'guard') {
    pfsPushIssue(issues, 'GUARD_CHILDREN_FORBIDDEN', subId, 2, `L2 容器 ${subId} 禁止声明为条件菱形 guard`);
  }
  return subTitle;
}

function pfsValidateL2Subflow(sub, idx, fnId, l1Title, seenSubIds, seenSubTitles, issues) {
  const rawId = typeof sub?.id === 'string' ? sub.id.trim() : '';
  const subId = rawId || `${fnId}#sub-${idx}`;
  if (!sub || typeof sub !== 'object' || !rawId) {
    pfsPushIssue(issues, 'INVALID_SUBFLOW_ID', subId, 2, `功能 ${fnId} 的 L2 子流缺少非空 id`);
    return;
  }
  const subTitle = pfsCheckSubflowHeader(sub, subId, fnId, l1Title, seenSubIds, seenSubTitles, issues);
  const steps = Array.isArray(sub.steps) ? sub.steps : [];
  if (steps.length === 0) return;
  const stepIds = new Set(steps.map((s) => (typeof s?.id === 'string' ? s.id.trim() : '')).filter(Boolean));
  const initId = typeof sub.initialStepId === 'string' ? sub.initialStepId.trim() : '';
  if (!initId) {
    pfsPushIssue(issues, 'MISSING_INITIAL_STEP', subId, 2, `L2 复合子流 ${subId} 含 L3 步骤时必须显式指定 initialStepId 唯一入口`);
  } else if (!stepIds.has(initId)) {
    pfsPushIssue(issues, 'DANGLING_INITIAL_STEP', subId, 2, `L2 复合子流 ${subId} 的 initialStepId="${sub.initialStepId}" 未命中任何 L3 步骤`);
  }
  const ancestorTitles = new Set([l1Title, subTitle].filter(Boolean));
  const seenStepTitles = new Set();
  steps.forEach((st, sIdx) => pfsValidateL3Step(st, sIdx, subId, ancestorTitles, stepIds, seenStepTitles, issues));
}

function pfsBuildL1Graph(functions, fnIds) {
  const indeg = new Map([...fnIds].map((id) => [id, 0]));
  const adj = new Map([...fnIds].map((id) => [id, []]));
  for (const fn of functions) {
    if (!fn?.id || !fnIds.has(fn.id)) continue;
    const afterList = Array.isArray(fn.after) ? fn.after : [];
    for (const dst of afterList) {
      if (!fnIds.has(dst)) continue;
      adj.get(fn.id).push(dst);
      indeg.set(dst, (indeg.get(dst) || 0) + 1);
    }
  }
  return { indeg, adj };
}

function pfsDetectL1Cycle(functions, fnIds, issues) {
  const { indeg, adj } = pfsBuildL1Graph(functions, fnIds);
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const cur = queue.shift();
    visited++;
    for (const nxt of (adj.get(cur) || [])) {
      const nd = (indeg.get(nxt) || 0) - 1;
      indeg.set(nxt, nd);
      if (nd === 0) queue.push(nxt);
    }
  }
  if (visited < fnIds.size) {
    const cycIds = [...indeg.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    pfsPushIssue(issues, 'L1_FLOW_CYCLE', cycIds[0], 1, `L1 产品主流程存在环路（涉及节点：${cycIds.join('、')}）`);
  }
}

function pfsAuditSingleL1Function(fn, fnIds, seenL1Titles, seenSubIds, issues) {
  const fnId = fn?.id || fn?._fileId || 'unknown';
  if (Number.isInteger(fn?.level) && fn.level > MAX_PRODUCT_FLOW_DEPTH) {
    pfsPushIssue(issues, 'DEPTH_CAP_EXCEEDED', fnId, fn.level, `顶层功能 ${fnId} level=${fn.level} 超出 ${MAX_PRODUCT_FLOW_DEPTH} 级视觉硬上限`);
  }
  const l1Title = pfsNormTitle(fn?.title);
  if (l1Title && seenL1Titles.has(l1Title)) {
    pfsPushIssue(issues, 'DUPLICATE_ANCESTOR_TITLE', fnId, 1, `L1 阶段 ${fnId} 标题「${l1Title}」与其他 L1 阶段重复`);
  }
  if (l1Title) seenL1Titles.add(l1Title);
  for (const dst of (Array.isArray(fn?.after) ? fn.after : [])) {
    if (!fnIds.has(dst)) {
      pfsPushIssue(issues, 'DANGLING_EDGE_TARGET', fnId, 1, `L1 阶段 ${fnId} 的 after 目标 "${dst}" 不存在`);
    }
  }
  const seenSubTitles = new Set();
  const subflows = Array.isArray(fn?.subflows) ? fn.subflows : [];
  subflows.forEach((sub, idx) => pfsValidateL2Subflow(sub, idx, fnId, l1Title, seenSubIds, seenSubTitles, issues));
}

export function validateProductFlowGraph(functions = []) {
  const issues = [];
  if (!Array.isArray(functions) || functions.length === 0) return issues;
  const fnIds = new Set(functions.map((f) => (typeof f?.id === 'string' ? f.id.trim() : '')).filter(Boolean));
  const seenL1Titles = new Set();
  const seenSubIds = new Set();
  for (const fn of functions) {
    pfsAuditSingleL1Function(fn, fnIds, seenL1Titles, seenSubIds, issues);
  }
  pfsDetectL1Cycle(functions, fnIds, issues);
  return issues;
}
