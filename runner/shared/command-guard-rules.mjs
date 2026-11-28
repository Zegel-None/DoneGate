// L0 宿主工具层 Shell 命令安全审计原语（CaMeL 污点汇点阻断、FORK 双模拒绝回执与控制信道守卫，<= 280 行）
import { isUntrustedTainted } from './untrusted-envelope.mjs';

export const FORBIDDEN_AGENT_MCP_MUTATIONS = Object.freeze(['freeze', 'promote', 'verify-apply', 'retire', 'overlay-confirm']);
export const OPAQUE_GUARD_REFUSAL = '[GUARD_BLOCKED: Policy violation]';

const MAX_SHELL_WRAPPER_DEPTH = 2;
const MIN_WRAPPER_TOKENS = 3;
const CGR_GIT_VALUE_FLAGS = new Set(['-m', '--message', '-F', '--file', '--author', '--date', '-c', '-C', '--cleanup', '--pathspec-from-file']);
const CGR_HOOK_SUBCMDS = new Set(['commit', 'merge', 'cherry-pick', 'rebase', 'am', 'push']);
const CGR_SHELL_BINS = new Set(['sh', 'bash', 'zsh', 'pwsh', 'powershell', 'powershell.exe', 'pwsh.exe', 'cmd', 'cmd.exe']);
const CGR_DELETE_BINS = new Set(['rm', 'del', 'erase', 'rmdir', 'mv', 'move', 'remove-item', 'move-item']);
const CGR_CTRL_BINS = new Set(['rm', 'del', 'erase', 'rmdir', 'unlink', 'mv', 'move', 'ren', 'rename', 'cp', 'copy', 'touch', 'truncate', 'tee', 'dd', 'shred', 'remove-item', 'move-item', 'rename-item', 'copy-item', 'set-content', 'add-content', 'out-file', 'clear-content', 'new-item']);
const CGR_RUNTIMES = new Set(['node', 'node.exe', 'nodejs', 'python', 'python3', 'py', 'ruby', 'perl', 'deno', 'bun']);
const CGR_TAINT_EXFIL_BINS = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm']);
const CGR_TAINT_MUTATION_BINS = new Set(['rm', 'del', 'erase', 'rmdir', 'shred', 'unlink', 'remove-item', 'chmod', 'chown', 'icacls']);
const CGR_TAINT_EXEC_BINS = new Set(['eval', 'exec', 'source']);
const CGR_GIT_TAINT_SUBCMDS = new Set(['push', 'remote', 'send-email']);
const CGR_INLINE_EVAL_FLAGS = new Set(['-e', '--eval', '-c', '/c', '-command']);
const CGR_LEDGER_SENSITIVE_RE = /\.donegate[\\/](?:chain\.jsonl|evidence\b|stubs[\\/][^"'\s]*\.frozen\.json)/i;
const CGR_CTRL_RE = /(?:^|[\\/"'\s=])\.donegate[\\/](?:STOP|STEER\.md|guard-events\.jsonl)(?:$|["'\s\\/])/i;
const CGR_CTRL_TOK_RE = /(?:^|[\\/])\.donegate[\\/](?:STOP|STEER\.md|guard-events\.jsonl)$/i;
const CGR_WRITE_OPS_RE = /(?:>>?|<<|\b(?:tee|cp|copy|mv|move|rm|del|remove-item|set-content|add-content|out-file|clear-content)\b)/i;
const CGR_FS_API_RE = /\b(?:rmSync|unlinkSync|unlink|writeFileSync|writeFile|appendFileSync|appendFile|truncateSync|truncate|renameSync|rename|copyFileSync|createWriteStream|remove|rmtree|write_text|write_bytes)\b/i;

const CGR_SAFE_RECIPE_BY_CODE = Object.freeze({
  HOOK_BYPASS_DENIED: '移除 --no-verify / -n 标志，先运行 node runner/donegate.mjs lint-edit 修复报错再正常提交',
  HUMAN_AUTHORITY_DENIED: '改用只读诊断命令 node runner/donegate.mjs status，将签字确认命令交由业主在终端执行',
  CONTROL_CHANNEL_TAMPER_DENIED: '保持 .donegate 控制信道文件只读，通过标准 CLI 命令查看运行状态',
  TAINTED_COMMAND_SINK_DENIED: '剥离外源不可信参数后改用受控本地只读文件解析，严禁将外源输入拼入网络或执行命令',
  UNTRUSTED_GOAL_DRIFT_DETECTED: '停止执行偏离契约范围的敏感操作，严格回到初始契约声明的文件范围内修补'
});
const DEFAULT_SAFE_RECIPE = '请改用契约白名单内的本地确定性只读校验命令';

export function isForbiddenAgentMcpMutation(subcmd) {
  const n = String(subcmd || '').trim().toLowerCase().replace(/^(?:mcp__donegate__|donegate[_-]|dg[_-])/, '').replace(/[_\s]+/g, '-');
  return Boolean(n && (FORBIDDEN_AGENT_MCP_MUTATIONS.includes(n) || n === 'contract-freeze' || n === 'contract-promote' || n === 'flow-overlay-confirm' || n === 'workflow-overlay-confirm'));
}

export function splitShellSegments(cmdLine) {
  const quotes = [];
  const masked = String(cmdLine || '').replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, (m) => {
    quotes.push(m);
    return `__DGQ_${quotes.length - 1}__`;
  });
  return masked
    .split(/&&|\|\||[;|\r\n]/)
    .map((part) => part.replace(/__DGQ_(\d+)__/g, (_, idx) => quotes[Number(idx)] || '').trim())
    .filter(Boolean);
}

function cgrTokenizeSegment(seg) {
  const rawTokens = seg.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+)+/g) || [];
  return rawTokens.map((raw) => ({
    raw,
    unquoted: raw.replace(/^["']|["']$/g, '')
  }));
}

function cgrStripQuotedText(seg) {
  return String(seg || '').replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
}

function cgrNormalizeBinName(rawTok) {
  return String(rawTok || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function cgrSkipLeadingEnvVars(tokens) {
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx].unquoted)) idx++;
  return idx;
}

function cgrExtractGitCommandHead(tokens) {
  const start = cgrSkipLeadingEnvVars(tokens);
  const bin = cgrNormalizeBinName(tokens[start]?.unquoted);
  if (bin !== 'git' && bin !== 'git.exe') return null;

  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i].unquoted;
    if (t === '-c' || t === '-C') {
      const val = tokens[i + 1]?.unquoted || '';
      if (t === '-c' && /^core\.hooksPath=/i.test(val) && !/^core\.hooksPath=\.?\/?\.githooks$/i.test(val)) {
        return { error: { allowed: false, code: 'HOOK_BYPASS_DENIED', reason: '严禁通过 git -c core.hooksPath=... 绕过 DoneGate Git 守门钩子' } };
      }
      i++;
      continue;
    }
    if (!t.startsWith('-')) return { sub: t.toLowerCase(), argTokens: tokens.slice(i + 1) };
  }
  return null;
}

function cgrAuditGitConfigHooksPath(argTokens) {
  const vals = argTokens.map((x) => x.unquoted);
  const hpIdx = vals.findIndex((v) => /^core\.hooksPath$/i.test(v));
  if (hpIdx < 0) return null;
  if (vals.some((v) => v === '--get' || v === '--get-all' || v === '-l' || v === '--list')) return null;
  const nextVal = vals[hpIdx + 1] || '';
  const badTarget = Boolean(nextVal && nextVal !== '.githooks' && nextVal !== './.githooks');
  if (vals.includes('--unset') || vals.includes('--unset-all') || badTarget) {
    return { allowed: false, code: 'HOOK_BYPASS_DENIED', reason: '严禁篡改或清空 git config core.hooksPath（必须保持指向 .githooks）' };
  }
  return null;
}

function cgrAuditGitHookFlags(sub, argTokens) {
  for (let i = 0; i < argTokens.length; i++) {
    const t = argTokens[i].unquoted;
    if (CGR_GIT_VALUE_FLAGS.has(t)) {
      i++;
      continue;
    }
    if (t === '--') break;
    if (t === '--no-verify') {
      return { allowed: false, code: 'HOOK_BYPASS_DENIED', reason: `严禁在 git ${sub} 中使用 --no-verify 绕过 DoneGate 守门钩子；请修复报错后再提交或推送` };
    }
    if (sub === 'commit' && !t.startsWith('--') && /^-[a-zA-Z]*n[a-zA-Z]*$/.test(t)) {
      return { allowed: false, code: 'HOOK_BYPASS_DENIED', reason: '严禁在 git commit 中使用 -n (--no-verify) 绕过 pre-commit 守门钩子' };
    }
  }
  return null;
}

function cgrAuditGitSegment(tokens) {
  const parsed = cgrExtractGitCommandHead(tokens);
  if (!parsed) return null;
  if (parsed.error) return parsed.error;
  if (parsed.sub === 'config') return cgrAuditGitConfigHooksPath(parsed.argTokens);
  if (!CGR_HOOK_SUBCMDS.has(parsed.sub)) return null;
  return cgrAuditGitHookFlags(parsed.sub, parsed.argTokens);
}

function cgrResolveHumanOnlySubcmd(sub1, sub2) {
  if (sub1 === 'contract' && isForbiddenAgentMcpMutation(sub2)) return `contract ${sub2}`;
  if (sub1 === 'verify' && sub2 === 'apply' && isForbiddenAgentMcpMutation('verify-apply')) return 'verify apply';
  if ((sub1 === 'flow' || sub1 === 'workflow') && sub2 === 'overlay-confirm') return `${sub1} overlay-confirm`;
  return isForbiddenAgentMcpMutation(sub1) ? sub1 : null;
}

function cgrAuditDoneGateHumanCli(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const norm = tokens[i].unquoted.replace(/\\/g, '/');
    if (norm !== 'donegate' && !/(?:^|\/)donegate\.mjs$/i.test(norm)) continue;
    const cmdLabel = cgrResolveHumanOnlySubcmd(
      (tokens[i + 1]?.unquoted || '').toLowerCase(),
      (tokens[i + 2]?.unquoted || '').toLowerCase()
    );
    if (cmdLabel) {
      return {
        allowed: false,
        code: 'HUMAN_AUTHORITY_DENIED',
        reason: `G-10 权限红线：禁止 AI 在工具调用中代执行人类专属命令「donegate ${cmdLabel}」，请将准备好的命令展示给人类业主在终端亲自执行`
      };
    }
  }
  return null;
}

function cgrHitsControlChannel(seg, tokens, firstBin) {
  if (!CGR_CTRL_RE.test(seg)) return false;
  if ((firstBin === 'git' || firstBin === 'git.exe') && !tokens.some((t) => t.unquoted.toLowerCase() === 'clean')) return false;
  const hasTok = tokens.some((t) => CGR_CTRL_TOK_RE.test(t.unquoted));
  const inPlace = (firstBin === 'sed' || firstBin === 'perl') && tokens.some((t) => /^-[a-zA-Z]*i/.test(t.unquoted));
  const direct = hasTok && (CGR_CTRL_BINS.has(firstBin) || inPlace || firstBin === 'git');
  return direct || /(?:>>?|>\||<>)/.test(cgrStripQuotedText(seg)) || (CGR_RUNTIMES.has(firstBin) && CGR_FS_API_RE.test(seg));
}

function cgrAuditHooksAndLedgerTamper(seg, tokens) {
  const firstBin = cgrNormalizeBinName(tokens[0]?.unquoted);
  if (CGR_DELETE_BINS.has(firstBin) && tokens.some((t) => /(?:^|[\\/])\.githooks(?:[\\/]|$)/i.test(t.unquoted))) {
    return { allowed: false, code: 'HOOK_BYPASS_DENIED', reason: '严禁删除或移走 .githooks 守门钩子目录及脚本' };
  }
  if (cgrHitsControlChannel(seg, tokens, firstBin)) {
    return { allowed: false, code: 'CONTROL_CHANNEL_TAMPER_DENIED', reason: 'REF-05 控制信道红线：严禁 Agent 通过 Shell 命令删改、覆盖、重命名、清空或伪造 .donegate/STOP、.donegate/STEER.md 或 .donegate/guard-events.jsonl' };
  }
  if (CGR_LEDGER_SENSITIVE_RE.test(seg) && CGR_WRITE_OPS_RE.test(cgrStripQuotedText(seg))) {
    return { allowed: false, code: 'HUMAN_AUTHORITY_DENIED', reason: 'INV-13 账本红线：严禁通过 Shell 命令直接覆写或删除 .donegate 防篡改哈希链、证据包与冻结快照' };
  }
  return null;
}

function cgrAuditNestedShellWrapper(tokens, depth, opts) {
  if (depth >= MAX_SHELL_WRAPPER_DEPTH || tokens.length < MIN_WRAPPER_TOKENS) return null;
  const firstBin = cgrNormalizeBinName(tokens[0]?.unquoted);
  if (!CGR_SHELL_BINS.has(firstBin)) return null;
  for (let i = 1; i < tokens.length - 1; i++) {
    const flag = tokens[i].unquoted.toLowerCase();
    if (flag === '-c' || flag === '/c' || flag === '-command') {
      return auditAgentShellCommand(tokens[i + 1].unquoted, depth + 1, opts);
    }
  }
  return null;
}

function cgrClassifyDangerousSink(tokens) {
  const start = cgrSkipLeadingEnvVars(tokens);
  if (start >= tokens.length) return null;
  const bin = cgrNormalizeBinName(tokens[start].unquoted).replace(/\.exe$/i, '');
  if (CGR_TAINT_EXFIL_BINS.has(bin) || CGR_TAINT_MUTATION_BINS.has(bin) || CGR_TAINT_EXEC_BINS.has(bin)) return bin;
  if (bin === 'git') {
    const gitHead = cgrExtractGitCommandHead(tokens);
    return gitHead?.sub && CGR_GIT_TAINT_SUBCMDS.has(gitHead.sub) ? `git ${gitHead.sub}` : null;
  }
  if (!CGR_RUNTIMES.has(bin) && !CGR_SHELL_BINS.has(bin)) return null;
  const tail = tokens.slice(start + 1).map((t) => t.unquoted.toLowerCase());
  if (bin === 'deno' && tail.includes('eval')) return 'deno eval';
  const hitFlag = tail.find((f) => CGR_INLINE_EVAL_FLAGS.has(f) || /^--eval=/.test(f));
  return hitFlag ? `${bin} ${hitFlag.startsWith('--eval=') ? '--eval' : hitFlag}` : null;
}

function cgrNormalizeTaintEntries(taintMeta) {
  const rawList = Array.isArray(taintMeta) ? taintMeta : [taintMeta];
  return rawList
    .filter((item) => isUntrustedTainted(item))
    .map((item) => (item.untrusted === true ? item : item.meta));
}

function cgrIsSinkExplicitlyAllowed(sink, taintEntries) {
  const normSink = sink.toLowerCase();
  const baseBin = normSink.split(' ')[0];
  return taintEntries.every((entry) => {
    const allowed = Array.isArray(entry.allowedSinks) ? entry.allowedSinks.map((x) => String(x).toLowerCase()) : [];
    return allowed.includes(normSink) || allowed.includes(baseBin);
  });
}

export function evaluateTaintedCommandSink(command, taintMeta) {
  const taintEntries = cgrNormalizeTaintEntries(taintMeta);
  const text = String(command || '').trim();
  if (!text || taintEntries.length === 0) return { allowed: true, sink: null, source: null };

  const primarySource = String(taintEntries[0].source || 'external');
  for (const seg of splitShellSegments(text)) {
    const tokens = cgrTokenizeSegment(seg);
    const sink = cgrClassifyDangerousSink(tokens);
    if (sink && !cgrIsSinkExplicitlyAllowed(sink, taintEntries)) {
      return {
        allowed: false,
        code: 'TAINTED_COMMAND_SINK_DENIED',
        sink,
        source: primarySource,
        reason: `CaMeL 污点汇点阻断：外源不可信污点 (${primarySource}) 严禁流入高危命令汇点「${sink}」`
      };
    }
  }
  return { allowed: true, sink: null, source: primarySource };
}

export function formatGuardRefusalReceipt(violation, opts = {}) {
  if (!violation || violation.allowed === true) return '';
  if (opts.hasUntrustedInput === true || isUntrustedTainted(opts.taintMeta)) {
    return OPAQUE_GUARD_REFUSAL;
  }
  const code = String(violation.code || violation.reasonCode || 'POLICY_VIOLATION');
  const reason = String(violation.reason || '触发宿主安全守卫拦截规则');
  const recipe = String(violation.remediation || CGR_SAFE_RECIPE_BY_CODE[code] || DEFAULT_SAFE_RECIPE);
  return `[GUARD_BLOCKED: ${code}] ${reason} | 安全替代配方：${recipe}`;
}

export function auditAgentShellCommand(cmdLine, depth = 0, opts = {}) {
  const text = String(cmdLine || '').trim();
  if (!text) return { allowed: true };
  if (opts?.taintMeta) {
    const taintRes = evaluateTaintedCommandSink(text, opts.taintMeta);
    if (!taintRes.allowed) return taintRes;
  }
  for (const seg of splitShellSegments(text)) {
    const tokens = cgrTokenizeSegment(seg);
    if (tokens.length === 0) continue;
    const hit = cgrAuditGitSegment(tokens)
      || cgrAuditDoneGateHumanCli(tokens)
      || cgrAuditHooksAndLedgerTamper(seg, tokens)
      || cgrAuditNestedShellWrapper(tokens, depth, opts);
    if (hit && !hit.allowed) return hit;
  }
  return { allowed: true };
}
