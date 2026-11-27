// Antigravity 原生插件清单、MCP 配置、随身质检钩子脚本与规则模板（零外部依赖，<= 250 行）
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const toPosix = (p) => String(p || '').replace(/\\/g, '/');

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

export function buildAntigravityGuardScript({ donegateRoot } = {}) {
  const lintScript = JSON.stringify(toPosix(resolve(donegateRoot, 'skill', 'lint-edit.mjs')));
  return [
    '// DoneGate Antigravity 随身质检钩子（仅对含 INTENT.md + contracts/ 的 DoneGate 项目生效，普通项目零开销静默放行）',
    "import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
    "import { dirname, join, relative, resolve } from 'node:path';",
    "import { spawnSync } from 'node:child_process';",
    '',
    `const LINT_SCRIPT = ${lintScript};`,
    'const CODE_RE = /\\.(?:mjs|cjs|js|ts|tsx|jsx|py|go|rs)$/i;',
    'const ALERT_REL = join(".donegate", "scratch", "agy-lint-alert.json");',
    '',
    'const isDoneGateRoot = (d) => Boolean(d && existsSync(join(d, "INTENT.md")) && existsSync(join(d, "contracts")));',
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
    '  const fileArg = payload?.toolCall?.args?.Path || payload?.toolCall?.args?.path;',
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
    'function readAlert(root) {',
    '  const p = join(root, ALERT_REL);',
    '  if (!existsSync(p)) return null;',
    '  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }',
    '}',
    '',
    'function clearAlert(root) {',
    '  try { rmSync(join(root, ALERT_REL), { force: true }); } catch (err) { void err; }',
    '}',
    '',
    'function handlePostToolUse(root, payload) {',
    '  const fileArg = payload?.toolCall?.args?.Path || payload?.toolCall?.args?.path;',
    '  if (!fileArg || !CODE_RE.test(fileArg) || !existsSync(fileArg)) return {};',
    '  const rel = relative(root, resolve(fileArg)).replace(/\\\\/g, "/");',
    '  if (!rel || rel.startsWith("..") || !existsSync(LINT_SCRIPT)) return {};',
    '  const r = spawnSync(process.execPath, [LINT_SCRIPT, rel, "--root", root], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });',
    '  if (r.status === 0) {',
    '    const cur = readAlert(root);',
    '    if (cur && cur.file === rel) clearAlert(root);',
    '    return {};',
    '  }',
    '  const summary = ((r.stdout || "") + "\\n" + (r.stderr || "")).trim().slice(0, 1200);',
    '  const alertPath = join(root, ALERT_REL);',
    '  mkdirSync(dirname(alertPath), { recursive: true });',
    '  writeFileSync(alertPath, JSON.stringify({ file: rel, summary, conversationId: payload?.conversationId || "", at: Date.now() }, null, 2));',
    '  return {};',
    '}',
    '',
    'function handlePreInvocation(root, payload) {',
    '  const alert = readAlert(root);',
    '  if (!alert || (Date.now() - Number(alert.at || 0)) > 300000) return {};',
    '  if (alert.conversationId && payload?.conversationId && alert.conversationId !== payload.conversationId) return {};',
    '  clearAlert(root);',
    '  return {',
    '    injectSteps: [{ systemMessage: { systemMessage: `[DoneGate 随身质检提醒] 文件 ${alert.file} 未通过 lint-edit，请立即修复：\\n${alert.summary}` } }]',
    '  };',
    '}',
    '',
    'function handleStop(root, payload) {',
    '  if (payload?.terminationReason !== "NO_TOOL_CALL" || payload?.continuationActive) return { decision: "allow" };',
    '  const alert = readAlert(root);',
    '  if (!alert || (Date.now() - Number(alert.at || 0)) > 300000) return { decision: "allow" };',
    '  clearAlert(root);',
    '  return { decision: "continue", reason: `[DoneGate 随身质检拦截] 文件 ${alert.file} 仍有未修复的 lint-edit 违规，请先修绿再结束本轮：\\n${alert.summary}` };',
    '}',
    '',
    'let payload = {};',
    'try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { payload = {}; }',
    'const ev = String(payload?.hookEventName || "");',
    'const root = findWorkspaceDoneGateRoot(payload);',
    'let out = ev === "Stop" ? { decision: "allow" } : {};',
    'if (root) {',
    '  if (ev === "PostToolUse") out = handlePostToolUse(root, payload);',
    '  else if (ev === "PreInvocation") out = handlePreInvocation(root, payload);',
    '  else if (ev === "Stop") out = handleStop(root, payload);',
    '}',
    'process.stdout.write(JSON.stringify(out));',
    ''
  ].join('\n');
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
