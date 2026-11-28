// DoneGate 宿主治理 MCP 扩展工具集（dg_status / dg_slice / dg_lint_edit / dg_check_node，L5 adapters/，<= 200 行）
import { FORBIDDEN_AGENT_MCP_MUTATIONS, isForbiddenAgentMcpMutation } from '../../shared/command-guard-rules.mjs';

export { FORBIDDEN_AGENT_MCP_MUTATIONS };

const posIntProp = (description) => ({ type: 'integer', minimum: 1, description });
const optRootProp = { type: 'string', minLength: 1, description: '可选目标代码仓库根目录（默认启动目录）' };
const reqRootProp = { type: 'string', minLength: 1, description: '目标代码仓库根目录绝对路径（必填，多工作区安全模式）' };

export function buildDoneGateGovernanceMcpTools({ requireRoot = false } = {}) {
  const rootField = requireRoot ? reqRootProp : optRootProp;
  return [
    {
      name: 'dg_status',
      description: '现算 DoneGate 项目五状态六栏总账与契约验收进度（只读治理体检）。',
      inputSchema: {
        type: 'object',
        properties: {
          tree: { type: 'boolean', description: '附带按状态排序的树状契约明细' },
          flow: { type: 'boolean', description: '附带契约依赖流视图' },
          root: rootField
        },
        ...(requireRoot ? { required: ['root'] } : {}),
        additionalProperties: false
      }
    },
    {
      name: 'dg_slice',
      description: '按契约节点生成带令牌预算的密封施工胶囊或全局路由摘要（用于精准投喂子代理上下文）。',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', minLength: 1, description: '目标契约节点 ID（routerOnly=true 时可省略）' },
          focus: { type: 'array', items: { type: 'string', minLength: 1 }, description: '焦点文件路径或 @subpack 列表' },
          lexical: { type: 'array', items: { type: 'string', minLength: 1 }, description: '附加词法搜索关键词列表' },
          routerOnly: { type: 'boolean', description: '仅生成/返回全局路由 .donegate/ROUTER.md' },
          maxTokens: posIntProp('可选胶囊 token 预算上限（正整数）'),
          root: rootField
        },
        ...(requireRoot ? { required: ['root'] } : {}),
        additionalProperties: false
      }
    },
    {
      name: 'dg_lint_edit',
      description: '对改动文件运行毫秒级即时护栏（语法、认知复杂度、反压行、术语与契约归属校验）。',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: '待校验文件路径列表' },
          json: { type: 'boolean', description: '以 JSON 格式返回结构化诊断与修复配方' },
          root: rootField
        },
        required: requireRoot ? ['files', 'root'] : ['files'],
        additionalProperties: false
      }
    },
    {
      name: 'dg_check_node',
      description: '对指定契约节点运行单卡四重微门禁（越界范围、存根变更、判据实跑与可选结构化回执）。',
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', minLength: 1, description: '契约节点 ID' },
          criterion: { type: 'string', minLength: 1, description: '可选单个判据 ID' },
          base: { type: 'string', minLength: 1, description: '可选 git 基准引用（默认自动解析 merge-base）' },
          allowDirty: { type: 'boolean', description: '允许在脏工作树下运行微门禁' },
          allowCrossScope: { type: 'boolean', description: '放行共享治理文件跨界改动' },
          receipt: { type: 'boolean', description: '落盘结构化 500-Token 验收回执' },
          json: { type: 'boolean', description: '以 JSON 格式返回检查结果' },
          root: rootField
        },
        required: requireRoot ? ['nodeId', 'root'] : ['nodeId'],
        additionalProperties: false
      }
    }
  ];
}

export const DONEGATE_GOVERNANCE_MCP_TOOLS = buildDoneGateGovernanceMcpTools();

function findUnknownKey(args, allowed) {
  return Object.keys(args).find((k) => !allowed.includes(k)) || null;
}

function checkBoolFlags(args, keys) {
  for (const k of keys) {
    if (args[k] !== undefined && typeof args[k] !== 'boolean') return { rpcError: `${k} must be boolean` };
  }
  return { ok: true };
}

function checkStrArray(val, name, required = false) {
  if (val === undefined) return required ? { rpcError: `${name} must be an array of strings` } : { ok: true };
  if (!Array.isArray(val) || val.some((x) => typeof x !== 'string')) return { rpcError: `${name} must be an array of strings` };
  if ((required && val.length === 0) || val.some((x) => x.trim() === '')) return { toolError: `参数错误：${name} 不能为空数组或空白项。` };
  return { ok: true };
}

function buildStatusArgv(args) {
  const bad = findUnknownKey(args, ['tree', 'flow', 'root']);
  if (bad) return { rpcError: `Unknown argument for dg_status: ${bad}` };
  const b = checkBoolFlags(args, ['tree', 'flow']);
  if (!b.ok) return b;
  const argv = ['status'];
  if (args.tree) argv.push('--tree');
  if (args.flow) argv.push('--flow');
  return { ok: true, argv };
}

function buildSliceArgv(args) {
  const bad = findUnknownKey(args, ['nodeId', 'focus', 'lexical', 'routerOnly', 'maxTokens', 'root']);
  if (bad) return { rpcError: `Unknown argument for dg_slice: ${bad}` };
  const b = checkBoolFlags(args, ['routerOnly']);
  if (!b.ok) return b;
  if (args.nodeId !== undefined && typeof args.nodeId !== 'string') return { rpcError: 'nodeId must be a string' };
  if (args.maxTokens !== undefined) {
    if (typeof args.maxTokens !== 'number') return { rpcError: 'maxTokens must be an integer' };
    if (!Number.isInteger(args.maxTokens) || args.maxTokens < 1) return { toolError: '参数错误：maxTokens 必须为正整数。' };
  }
  const fChk = checkStrArray(args.focus, 'focus', false);
  if (!fChk.ok) return fChk;
  const lChk = checkStrArray(args.lexical, 'lexical', false);
  if (!lChk.ok) return lChk;
  if (!args.routerOnly && (!args.nodeId || args.nodeId.trim() === '')) {
    return { toolError: '参数错误：未启用 routerOnly 时必须提供非空 nodeId。' };
  }
  const argv = ['slice'];
  if (args.routerOnly) argv.push('--router-only');
  if (args.focus?.length) argv.push('--focus', args.focus.join(','));
  if (args.lexical?.length) argv.push('--lexical', args.lexical.join(','));
  if (args.maxTokens) argv.push('--max-tokens', String(args.maxTokens));
  if (args.nodeId && args.nodeId.trim()) argv.push('--', args.nodeId.trim());
  return { ok: true, argv };
}

function buildLintEditArgv(args) {
  const bad = findUnknownKey(args, ['files', 'json', 'root']);
  if (bad) return { rpcError: `Unknown argument for dg_lint_edit: ${bad}` };
  const b = checkBoolFlags(args, ['json']);
  if (!b.ok) return b;
  const fChk = checkStrArray(args.files, 'files', true);
  if (!fChk.ok) return fChk;
  const argv = ['lint-edit'];
  if (args.json) argv.push('--json');
  argv.push('--', ...args.files);
  return { ok: true, argv };
}

function buildCheckNodeArgv(args) {
  const bad = findUnknownKey(args, ['nodeId', 'criterion', 'base', 'allowDirty', 'allowCrossScope', 'receipt', 'json', 'root']);
  if (bad) return { rpcError: `Unknown argument for dg_check_node: ${bad}` };
  if (typeof args.nodeId !== 'string') return { rpcError: 'nodeId must be a string' };
  if (args.criterion !== undefined && typeof args.criterion !== 'string') return { rpcError: 'criterion must be a string' };
  if (args.base !== undefined && typeof args.base !== 'string') return { rpcError: 'base must be a string' };
  const b = checkBoolFlags(args, ['allowDirty', 'allowCrossScope', 'receipt', 'json']);
  if (!b.ok) return b;
  if (args.nodeId.trim() === '') return { toolError: '参数错误：nodeId 不能为空。' };
  const argv = ['check-node'];
  if (args.criterion?.trim()) argv.push('--criterion', args.criterion.trim());
  if (args.base?.trim()) argv.push('--base', args.base.trim());
  if (args.allowDirty) argv.push('--allow-dirty');
  if (args.allowCrossScope) argv.push('--allow-cross-scope');
  if (args.receipt) argv.push('--receipt');
  if (args.json) argv.push('--json');
  argv.push('--', args.nodeId.trim());
  return { ok: true, argv };
}

export function buildDoneGateGovernanceArgv(name, args = {}) {
  const sub = typeof args?.subcommand === 'string' ? args.subcommand : (typeof args?.action === 'string' ? args.action : '');
  if (isForbiddenAgentMcpMutation(name) || (sub && isForbiddenAgentMcpMutation(sub))) {
    const err = new Error(`G-10 主权硬锁拒绝 (HUMAN_AUTHORITY_DENIED)：禁止 Agent MCP 触发人类专属签字命令「${name}」（禁令清单：${FORBIDDEN_AGENT_MCP_MUTATIONS.join(', ')}）`);
    err.code = 'HUMAN_AUTHORITY_DENIED';
    throw err;
  }
  if (name === 'dg_status') return buildStatusArgv(args);
  if (name === 'dg_slice') return buildSliceArgv(args);
  if (name === 'dg_lint_edit') return buildLintEditArgv(args);
  if (name === 'dg_check_node') return buildCheckNodeArgv(args);
  return null;
}
