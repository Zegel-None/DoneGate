// Antigravity / Claude / Codex 共享插件清单、MCP 配置、随身守护钩子脚本与多宿主公共原语（<= 435 行）
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { walk } from '../../skill/fs-walk.mjs';
import { maybeSpillHookOutput } from '../shared/hook-output-spiller.mjs';

const toPosix = (p) => String(p || '').replace(/\\/g, '/');
export const HARNESS_SKILL_DIRS = Object.freeze(['donegate', 'donegate-judge', 'donegate-forge']);
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'];

export const ANTIGRAVITY_DONEGATE_LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">',
  '  <rect x="12" y="12" width="104" height="104" rx="24" fill="#0F172A"/>',
  '  <path d="M64 26 L98 40 V66 C98 88 83 102 64 108 C45 102 30 88 30 66 V40 Z" fill="#1E293B" stroke="#38BDF8" stroke-width="5"/>',
  '  <path d="M48 66 L59 77 L82 52" fill="none" stroke="#34D399" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
  '</svg>',
  ''
].join('\n');

export function buildAntigravityPluginManifest({ version = '1.0.0' } = {}) {
  return {
    name: 'donegate',
    displayName: 'DoneGate',
    version,
    description: 'Contract-driven completion gate, anti-laziness edit guardrails, hermetic contract slicing, and tamper-evident evidence ledger for long-running AI coding projects.',
    logo: 'assets/logo.svg',
    author: {
      name: 'Zegel-None',
      url: 'https://github.com/Zegel-None'
    },
    homepage: 'https://github.com/Zegel-None/DoneGate',
    repository: 'https://github.com/Zegel-None/DoneGate',
    suggestedPrompts: [
      'Check DoneGate governance status and open gaps for this workspace',
      'Initialize DoneGate explore contracts for this existing repository with init --discover',
      'Run DoneGate single-card micro-gate and lint-edit check on my current changes'
    ]
  };
}

export function buildAntigravityMcpConfig({ donegateRoot, fullMcp = false } = {}) {
  const entry = toPosix(resolve(donegateRoot, 'runner', 'donegate.mjs'));
  const args = [entry, 'mcp', '--require-root'];
  if (!fullMcp) args.push('--governance-only');
  return {
    mcpServers: {
      governance: {
        command: 'node',
        args
      }
    }
  };
}

export function buildAntigravityHooksJson() {
  return {
    'donegate-edit-guard': {
      PreToolUse: [
        {
          matcher: 'run_command',
          hooks: [
            { type: 'command', command: 'node hooks/donegate-guard.mjs', timeout: 10 }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: 'edit_file|write_file',
          hooks: [
            { type: 'command', command: 'node hooks/donegate-guard.mjs', timeout: 15 }
          ]
        }
      ],
      PreInvocation: [
        { type: 'command', command: 'node hooks/donegate-guard.mjs', timeout: 10 }
      ],
      Stop: [
        { type: 'command', command: 'node hooks/donegate-guard.mjs', timeout: 15 }
      ]
    }
  };
}

export function buildAntigravityRulesMd({ fullMcp = false } = {}) {
  const toolsList = fullMcp
    ? '`dg_brief`, `dg_locate`, `dg_zoom`, `dg_impact`, `dg_status`, `dg_slice`, `dg_lint_edit`, `dg_check_node`'
    : '`dg_status`, `dg_slice`, `dg_lint_edit`, `dg_check_node`';
  return [
    '---',
    'trigger: always_on',
    '---',
    '',
    '# DoneGate Governance Plugin (Antigravity)',
    '',
    'This plugin activates **only** when the active workspace is a DoneGate-governed repository (contains `INTENT.md` and `contracts/`). On non-DoneGate repositories or casual non-coding questions, stand down silently and do not invoke DoneGate tools.',
    '',
    '## Multi-Workspace Governance MCP (`donegate_governance`)',
    '',
    `- The \`donegate_governance\` MCP server runs with \`--require-root\` and exposes ${toolsList}.`,
    '- Always pass `root` set to the active DoneGate project root absolute path on every tool call.',
    '- Use `dg_status` to compute real ledger status from disk, `dg_slice` to generate bounded contract capsules, `dg_lint_edit` for immediate edit guardrails, and `dg_check_node` for contract-scoped micro-gate checks.',
    '- Never claim a task is complete without fresh machine-verified command output; never self-sign human `contract freeze --by` approvals or fabricate human `functions/*.json` quotes (`INV-18` / `G-10`).',
    ''
  ].join('\n');
}

export function buildDoneGateGuardScript({ donegateRoot, host = 'antigravity' } = {}) {
  const lintScript = JSON.stringify(toPosix(resolve(donegateRoot, 'skill', 'lint-edit.mjs')));
  const cmdGuardUrl = JSON.stringify(pathToFileURL(resolve(donegateRoot, 'runner', 'shared', 'command-guard-rules.mjs')).href);
  const turnStateUrl = JSON.stringify(pathToFileURL(resolve(donegateRoot, 'runner', 'shared', 'turn-diff-state.mjs')).href);
  const spillerUrl = JSON.stringify(pathToFileURL(resolve(donegateRoot, 'runner', 'shared', 'hook-output-spiller.mjs')).href);
  return [
    '// DoneGate Antigravity 随身质检与防绕过钩子（仅对含 INTENT.md + contracts/ 的 DoneGate 项目生效，普通项目静默放行）',
    "import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
    "import { dirname, join, relative, resolve } from 'node:path';",
    "import { spawnSync } from 'node:child_process';",
    `import { auditAgentShellCommand, isForbiddenAgentMcpMutation } from ${cmdGuardUrl};`,
    `import { captureTurnBaseline, computeTurnDelta, consumeStopStrike, finishTurnCleanly, recordFileVerified } from ${turnStateUrl};`,
    `import { maybeSpillHookOutput } from ${spillerUrl};`,
    `const HOST_ID = ${JSON.stringify(String(host || 'antigravity'))};`,
    `const LINT_SCRIPT = ${lintScript};`,
    'const CODE_RE = /\\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;',
    'const ALERT_REL = join(".donegate", "scratch", "agy-lint-alert.json");',
    'const isDoneGateRoot = (d) => Boolean(d && existsSync(join(d, "INTENT.md")) && existsSync(join(d, "contracts")));',
    'const spill = (root, txt) => maybeSpillHookOutput(root, txt, { charBudget: Number(process.env.DG_HOOK_CHAR_BUDGET) || 0 }).output;',
    '',
    'function findRootUp(startPath) {',
    '  if (!startPath) return null;',
    '  let cur = resolve(startPath);',
    '  for (let i = 0; i < 8; i++) {',
    '    if (isDoneGateRoot(cur)) return cur;',
    '    const parent = dirname(cur);',
    '    if (parent === cur) break;',
    '    cur = parent;',
    '  }',
    '  return null;',
    '}',
    '',
    'function findWorkspaceDoneGateRoot(payload) {',
    '  const fileArg = payload?.toolCall?.args?.Path || payload?.toolCall?.args?.path || payload?.tool_input?.file_path || payload?.tool_input?.path || payload?.file_path;',
    '  const byFile = findRootUp(fileArg ? dirname(resolve(fileArg)) : null);',
    '  if (byFile) return byFile;',
    '  const cands = [...(Array.isArray(payload?.workspacePaths) ? payload.workspacePaths : []), payload?.cwd].filter(Boolean);',
    '  for (const c of cands) {',
    '    const direct = findRootUp(c);',
    '    if (direct) return direct;',
    '    try {',
    '      for (const e of readdirSync(c, { withFileTypes: true })) {',
    '        if (e.isDirectory() && isDoneGateRoot(join(c, e.name))) return join(c, e.name);',
    '      }',
    '    } catch (err) { void err; }',
    '  }',
    '  return null;',
    '}',
    '',
    'function appendJsonl(p, obj) { try { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify(obj) + "\\n", "utf8"); } catch (err) { void err; } }',
    'function denyPreTool(root, code, reason, preview) {',
    '  appendJsonl(join(root, ".donegate", "guard-events.jsonl"), { at: new Date().toISOString(), host: HOST_ID, code: String(code || "COMMAND_GUARD_DENIED"), reason, commandPreview: String(preview || "").slice(0, 240) });',
    '  return HOST_ID === "antigravity" ? { decision: "deny", reason } : { decision: "block", reason, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };',
    '}',
    'function readAlert(root) {',
    '  const p = join(root, ALERT_REL);',
    '  if (!existsSync(p)) return null;',
    '  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }',
    '}',
    'function clearAlert(root) {',
    '  try { rmSync(join(root, ALERT_REL), { force: true }); } catch (err) { void err; }',
    '}',
    '',
    'function handlePreToolUse(root, payload) {',
    '  const cmdLine = payload?.toolCall?.args?.CommandLine || payload?.toolCall?.args?.command || payload?.tool_input?.command || payload?.command || "";',
    '  const toolName = String(payload?.toolCall?.name || payload?.tool_name || "");',
    '  const stopPath = join(root, ".donegate", "STOP");',
    '  let stopHit = false;',
    '  try { stopHit = existsSync(stopPath); } catch (err) { void err; stopHit = true; }',
    '  if (stopHit) {',
    '    let rawStop = "";',
    '    try { rawStop = readFileSync(stopPath, "utf8").trim(); } catch (err) { rawStop = `读取异常 (${err?.code || "ERR"})，fail-closed 阻断`; }',
    '    const reason = spill(root, `[DoneGate 物理急停 (.donegate/STOP)] ${rawStop || "检测到急停信号，阻断工具执行"}`);',
    '    process.stderr.write(reason + "\\n");',
    '    process.stdout.write(JSON.stringify(denyPreTool(root, "KILL_SWITCH_STOP", reason, cmdLine || toolName)));',
    '    process.exit(2);',
    '  }',
    '  if (toolName && isForbiddenAgentMcpMutation(toolName)) return denyPreTool(root, "FORBIDDEN_MCP_MUTATION", spill(root, `[DoneGate 防绕过硬拦截] 禁止调用主权写工具 ${toolName}`), toolName);',
    '  const audit = auditAgentShellCommand(cmdLine);',
    '  return audit.allowed ? (HOST_ID === "antigravity" ? { decision: "allow" } : {}) : denyPreTool(root, audit.code, spill(root, `[DoneGate 防绕过硬拦截] ${audit.reason}`), cmdLine);',
    '}',
    '',
    'function handlePostToolUse(root, payload) {',
    '  const fileArg = payload?.toolCall?.args?.Path || payload?.toolCall?.args?.path || payload?.tool_input?.file_path || payload?.tool_input?.path || payload?.file_path;',
    '  if (!fileArg || !CODE_RE.test(fileArg) || !existsSync(fileArg)) return {};',
    '  const rel = relative(root, resolve(fileArg)).replace(/\\\\/g, "/");',
    '  if (!rel || rel.startsWith("..") || !existsSync(LINT_SCRIPT)) return {};',
    '  const convId = payload?.conversationId || payload?.session_id || "default";',
    '  const r = spawnSync(process.execPath, [LINT_SCRIPT, rel, "--root", root], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });',
    '  if (r.status === 0) {',
    '    recordFileVerified(root, convId, rel);',
    '    const cur = readAlert(root);',
    '    if (cur && cur.file === rel) clearAlert(root);',
    '    return {};',
    '  }',
    '  const summary = spill(root, ((r.stdout || "") + "\\n" + (r.stderr || "")).trim());',
    '  const alertPath = join(root, ALERT_REL);',
    '  mkdirSync(dirname(alertPath), { recursive: true });',
    '  writeFileSync(alertPath, JSON.stringify({ file: rel, summary, conversationId: convId, at: Date.now() }, null, 2));',
    '  return {};',
    '}',
    '',
    'function handlePreInvocation(root, payload) {',
    '  const convId = payload?.conversationId || payload?.session_id || "default";',
    '  captureTurnBaseline(root, convId);',
    '  const msgs = [];',
    '  const steerPath = join(root, ".donegate", "STEER.md");',
    '  if (existsSync(steerPath)) {',
    '    try {',
    '      const raw = readFileSync(steerPath, "utf8").trim();',
    '      rmSync(steerPath, { force: true });',
    '      if (raw) { appendJsonl(join(root, ".donegate", "steer-history.jsonl"), { at: new Date().toISOString(), host: HOST_ID, conversationId: convId, directive: raw }); msgs.push(`[DoneGate 人类半途纠偏 (.donegate/STEER.md)]\\n${spill(root, raw)}`); }',
    '    } catch (err) { void err; }',
    '  }',
    '  const alert = readAlert(root);',
    '  if (alert && (Date.now() - Number(alert.at || 0)) <= 300000 && (!alert.conversationId || alert.conversationId === convId)) {',
    '    clearAlert(root);',
    '    msgs.push(`[DoneGate 随身质检提醒] 文件 ${alert.file} 未通过 lint-edit，请立即修复：\\n${alert.summary}`);',
    '  }',
    '  if (msgs.length === 0) return {};',
    '  const text = msgs.join("\\n\\n");',
    '  return HOST_ID === "antigravity" ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } };',
    '}',
    '',
    'function handleStop(root, payload) {',
    '  const allowOut = HOST_ID === "antigravity" ? { decision: "allow" } : {};',
    '  if ((HOST_ID === "antigravity" && payload?.terminationReason !== "NO_TOOL_CALL") || payload?.stop_hook_active === true || !existsSync(LINT_SCRIPT)) return allowOut;',
    '  const convId = payload?.conversationId || payload?.session_id || "default";',
    '  const delta = computeTurnDelta(root, convId);',
    '  const alert = readAlert(root);',
    '  const pendingSet = new Set(delta.unverifiedFiles);',
    '  if (alert && alert.file && (Date.now() - Number(alert.at || 0)) <= 300000 && existsSync(join(root, alert.file))) pendingSet.add(alert.file);',
    '  const filesToLint = [...pendingSet];',
    '  if (filesToLint.length === 0) { finishTurnCleanly(root, convId, []); return allowOut; }',
    '  const r = spawnSync(process.execPath, [LINT_SCRIPT, ...filesToLint, "--root", root], { cwd: root, encoding: "utf8", timeout: 12000, windowsHide: true });',
    '  if (r.status === 0) {',
    '    clearAlert(root);',
    '    finishTurnCleanly(root, convId, filesToLint);',
    '    return allowOut;',
    '  }',
    '  const summary = spill(root, ((r.stdout || "") + "\\n" + (r.stderr || "")).trim());',
    '  const strike = consumeStopStrike(root, convId, filesToLint, 3);',
    '  if (!strike.shouldBlock) {',
    '    clearAlert(root);',
    '    return allowOut;',
    '  }',
    '  return { decision: HOST_ID === "antigravity" ? "continue" : "block", reason: `[DoneGate 随身质检拦截 (${strike.strike}/${strike.maxStrikes})] 本轮变更文件 (${filesToLint.join(", ")}) 仍有 lint-edit 违规，请先修绿再收尾：\\n${summary}` };',
    '}',
    '',
    'let payload = {};',
    'try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }',
    'const ev = String(payload?.hookEventName || payload?.hook_event_name || "");',
    'const root = findWorkspaceDoneGateRoot(payload);',
    'let out = (HOST_ID === "antigravity" && (ev === "Stop" || ev === "PreToolUse")) ? { decision: "allow" } : {};',
    'if (root) {',
    '  if (ev === "PreToolUse") out = handlePreToolUse(root, payload);',
    '  else if (ev === "PostToolUse") out = handlePostToolUse(root, payload);',
    '  else if (ev === "PreInvocation" || ev === "UserPromptSubmit") out = handlePreInvocation(root, payload);',
    '  else if (ev === "Stop") out = handleStop(root, payload);',
    '}',
    'process.stdout.write(JSON.stringify(out));',
    ''
  ].join('\n');
}

export function buildAntigravityGuardScript({ donegateRoot } = {}) {
  return buildDoneGateGuardScript({ donegateRoot, host: 'antigravity' });
}

export function degradeBrokenSkillLinks(rawMd, outFilePath, pluginDir) {
  const baseDir = dirname(resolve(outFilePath));
  const rootAbs = resolve(pluginDir);
  return String(rawMd || '').replace(/(!?\[[^\]]+\])\(([^)\s]+)\)/g, (full, label, rawTarget) => {
    if (label.startsWith('!') || /^(?:https?:|mailto:|file:|#)/i.test(rawTarget)) return full;
    const cleanTarget = rawTarget.split('#')[0].split('?')[0];
    if (!cleanTarget) return full;
    const resolved = resolve(baseDir, cleanTarget);
    if (resolved.startsWith(rootAbs) && existsSync(resolved)) return full;
    return label.slice(1, -1);
  });
}

export function stripDshOnlySkillFrontmatter(rawSkillMd) {
  const text = String(rawSkillMd || '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return text;
  const cleaned = m[1]
    .replace(/^whenToUse:\s*[>|]-?\n(?:[ \t]+.+(?:\n|$))*/m, '')
    .replace(/^whenToUse:.*\n?/m, '')
    .replace(/^user-invocable:.*\n?/m, '')
    .trimEnd();
  return `---\n${cleaned}\n---\n${m[2]}`;
}

export function pruneEmptyDir(dirPath) {
  try {
    if (existsSync(dirPath) && readdirSync(dirPath).length === 0) rmSync(dirPath, { recursive: true, force: true });
  } catch (err) { void err; }
}

export function readJsonObjectSafe(filePath) {
  if (!existsSync(filePath)) return { exists: false, value: {} };
  try {
    const v = JSON.parse(readFileSync(filePath, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { exists: true, value: v } : { exists: true, error: `JSON 非对象：${filePath}` };
  } catch (err) {
    return { exists: true, error: `解析失败 (${filePath})：${err.message}` };
  }
}

export const hasManagedHooksReady = (jsonObj, guardPath) => existsSync(guardPath) && HOOK_EVENTS.every((k) => Array.isArray(jsonObj?.hooks?.[k]) && jsonObj.hooks[k].length > 0);

export function formatHarnessDetection(installed, available, installedDir, missingHint) {
  if (installed) return { available: true, installed: true, state: 'installed', detail: `已安装至 ${installedDir}` };
  if (available) return { available: true, installed: false, state: 'available', detail: `检测到配置目录 (${installedDir})` };
  return { available: false, installed: false, state: 'not-detected', detail: missingHint };
}

function filterGuardHookEntry(item) {
  const isGuard = (h) => typeof h?.command === 'string' && h.command.includes('donegate-guard.mjs');
  if (isGuard(item)) return null;
  if (!Array.isArray(item?.hooks)) return item;
  const rest = item.hooks.filter((h) => !isGuard(h));
  return rest.length > 0 ? { ...item, hooks: rest } : null;
}

export function stripManagedHookEntries(rawHooksObj) {
  if (!rawHooksObj || typeof rawHooksObj !== 'object') return {};
  const cleaned = {};
  for (const [evName, entries] of Object.entries(rawHooksObj)) {
    const kept = Array.isArray(entries) ? entries.map(filterGuardHookEntry).filter(Boolean) : entries;
    if (!Array.isArray(kept) || kept.length > 0) cleaned[evName] = kept;
  }
  return cleaned;
}

export function syncManagedHooksConfig({ jsonFilePath, guardPath, donegateRoot, host, postMatcher, withHooks }) {
  const res = readJsonObjectSafe(jsonFilePath);
  if (res.error) return { ok: false, reason: res.error };
  const next = { ...res.value };
  if (withHooks) {
    mkdirSync(dirname(guardPath), { recursive: true });
    writeFileSync(guardPath, buildDoneGateGuardScript({ donegateRoot, host }), 'utf8');
    const cmd = `node "${toPosix(resolve(guardPath))}"`;
    const merged = stripManagedHookEntries(res.value.hooks);
    const addEv = (ev, item) => { merged[ev] = [...(Array.isArray(merged[ev]) ? merged[ev] : []), item]; };
    addEv('PreToolUse', { matcher: 'Bash', hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
    addEv('PostToolUse', { matcher: postMatcher, hooks: [{ type: 'command', command: cmd, timeout: 15 }] });
    addEv('UserPromptSubmit', { hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
    addEv('Stop', { hooks: [{ type: 'command', command: cmd, timeout: 15 }] });
    next.hooks = merged;
    mkdirSync(dirname(jsonFilePath), { recursive: true });
    writeFileSync(jsonFilePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return { ok: true };
  }
  rmSync(guardPath, { force: true });
  pruneEmptyDir(dirname(guardPath));
  const cleaned = stripManagedHookEntries(res.value.hooks);
  if (Object.keys(cleaned).length > 0) next.hooks = cleaned;
  else delete next.hooks;
  if (Object.keys(next).length > 0) writeFileSync(jsonFilePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  else rmSync(jsonFilePath, { force: true });
  return { ok: true };
}

export function installHarnessSkills(donegateRoot, skillsParentDir, linkBoundaryDir = skillsParentDir, previewRoot = null) {
  const installed = [];
  for (const name of HARNESS_SKILL_DIRS) {
    const srcDir = join(donegateRoot, name);
    if (!existsSync(join(srcDir, 'SKILL.md'))) continue;
    const destDir = join(skillsParentDir, name);
    rmSync(destDir, { recursive: true, force: true });
    for (const absFile of walk(srcDir, { skipDirs: [] }).files) {
      const rel = relative(srcDir, absFile);
      const outPath = join(destDir, rel);
      mkdirSync(dirname(outPath), { recursive: true });
      if (!rel.endsWith('.md')) { writeFileSync(outPath, readFileSync(absFile)); continue; }
      const noDsh = rel === 'SKILL.md' ? stripDshOnlySkillFrontmatter(readFileSync(absFile, 'utf8')) : readFileSync(absFile, 'utf8');
      writeFileSync(outPath, degradeBrokenSkillLinks(noDsh, outPath, linkBoundaryDir), 'utf8');
    }
    installed.push(name);
  }
  if (previewRoot) maybeSpillHookOutput(previewRoot, installed.join(','));
  return installed;
}

export function uninstallHarnessSkills(skillsParentDir) {
  for (const name of HARNESS_SKILL_DIRS) rmSync(join(skillsParentDir, name), { recursive: true, force: true });
}

function consumeLiveSteerFile(rootAbs, steerPath, rawDirective, host) {
  try {
    rmSync(steerPath, { force: true });
    const histPath = join(rootAbs, '.donegate', 'steer-history.jsonl');
    mkdirSync(dirname(histPath), { recursive: true });
    appendFileSync(histPath, JSON.stringify({ at: new Date().toISOString(), host: host || 'generic', directive: rawDirective }) + '\n', 'utf8');
  } catch (err) { void err; }
}

function concatPrefixAndSteerTail(baseText, tailBlock) {
  const baseStr = String(baseText ?? '');
  const sep = baseStr.length === 0 ? '' : (baseStr.endsWith('\n') ? '\n' : '\n\n');
  return `${baseStr}${sep}${tailBlock}\n`;
}

export function appendLiveSteerTail(projectRoot, baseInput = '', opts = {}) {
  if (!projectRoot) return baseInput;
  const rootAbs = resolve(projectRoot), steerPath = join(rootAbs, '.donegate', 'STEER.md');
  if (!existsSync(steerPath)) return baseInput;
  let rawDirective = '';
  try { rawDirective = readFileSync(steerPath, 'utf8').trim(); } catch (err) { void err; return baseInput; }
  if (!rawDirective) return baseInput;
  if (opts.consume === true) consumeLiveSteerFile(rootAbs, steerPath, rawDirective, opts.host);
  const spilled = maybeSpillHookOutput(rootAbs, rawDirective, { charBudget: Number(opts.charBudget) || 0 }).output;
  const hostTag = opts.host ? ` [${opts.host}]` : '';
  const tailBlock = `## [DoneGate 热纠偏指令 (.donegate/STEER.md)${hostTag}]\n${spilled}`;
  if (!Array.isArray(baseInput)) return concatPrefixAndSteerTail(baseInput, tailBlock);
  if (baseInput.length === 0) return [tailBlock];
  return [...baseInput.slice(0, -1), concatPrefixAndSteerTail(baseInput[baseInput.length - 1], tailBlock)];
}
