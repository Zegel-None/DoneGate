// 目标函数空心性反测探针、临时抓虫脚本归档与改动邻域聚焦提示（<= 160 行）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../../skill/io.mjs';
import { sha256 } from '../../../skill/hash.mjs';
import { buildSanitizedEnv } from '../isolation.mjs';
import { maskCommentsAndStrings } from '../js-mask-lexer.mjs';

export const EPHEMERAL_CATCH_REL_DIR = '.donegate/ephemeral-catch';
const DEFAULT_VACUITY_TIMEOUT_SEC = 60, MAX_FOCUS_FILES = 6, MAX_FOCUS_HUNK_SYMS = 8, MAX_SYM_CHARS = 64, AFTER_PAREN_WINDOW = 160;
const vacNormalizeRel = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

export function stageEphemeralCatchTest(projectRoot, spec = {}) {
  const root = resolve(projectRoot), dirAbs = join(root, EPHEMERAL_CATCH_REL_DIR);
  mkdirSync(dirAbs, { recursive: true });
  const ext = spec.ext === '.py' ? '.py' : '.mjs';
  const rawName = String(spec.name || spec.id || 'ephemeral').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = rawName.endsWith(ext) ? rawName : `${rawName}.catch${ext}`;
  const absPath = join(dirAbs, fileName);
  writeFileSync(absPath, String(spec.code || ''), 'utf8');
  return { absPath, relPath: `${EPHEMERAL_CATCH_REL_DIR}/${fileName}` };
}

export function findStagedEphemeralCatchFile(projectRoot) {
  const ephDir = join(resolve(projectRoot), EPHEMERAL_CATCH_REL_DIR);
  if (!existsSync(ephDir)) return null;
  const hit = readdirSync(ephDir).sort().find((n) => n.endsWith('.catch.mjs') || n.endsWith('.catch.py'));
  return hit ? { absPath: join(ephDir, hit), relPath: `${EPHEMERAL_CATCH_REL_DIR}/${hit}` } : null;
}

export function buildCatchFocusHint(projectRoot, diffFiles = [], opts = {}) {
  const root = resolve(projectRoot);
  const files = (Array.isArray(diffFiles) ? diffFiles : []).map(vacNormalizeRel).filter(Boolean).slice(0, MAX_FOCUS_FILES);
  if (files.length === 0) return '【聚焦提示】当前无未归档改动文件，无需展开邻域重攻击探针。';
  const rangeArg = opts.base ? `${opts.base}..${opts.head || 'HEAD'}` : 'HEAD';
  const diffR = spawnSync('git', ['-C', root, 'diff', '--unified=0', rangeArg, '--', ...files], { encoding: 'utf8', windowsHide: true });
  const syms = new Set();
  for (const line of String(diffR.stdout || '').split(/\r?\n/)) {
    const m = line.match(/^@@[^@]+@@\s*(.+)$/) || line.match(/^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|def)\s+([A-Za-z_$][\w$]*)/);
    if (m && m[1] && syms.size < MAX_FOCUS_HUNK_SYMS) syms.add(m[1].trim().slice(0, MAX_SYM_CHARS));
  }
  const symNote = syms.size > 0 ? `；变更邻域符号：[${[...syms].join(', ')}]` : '';
  return `【聚焦提示】请将候选补丁视为不可信输入，重点围绕 [${files.join(', ')}]${symNote} 的未覆盖旁路分支与边界入参编写临时抓虫测试（归入 ${EPHEMERAL_CATCH_REL_DIR}/）。`;
}

function vacFindBalanced(masked, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === openCh) depth++;
    else if (masked[i] === closeCh && --depth === 0) return i;
  }
  return -1;
}

function vacInjectPyThrowStub(origText, esc, fnName) {
  const pyRe = new RegExp(`((?:^|\\n)([ \\t]*)(?:async\\s+)?def\\s+${esc}\\s*\\([^\\n]*:\\s*\\n)((?:\\2[ \\t]+[^\\n]*\\n|\\s*\\n)+)`);
  return pyRe.test(origText) ? origText.replace(pyRe, (_, head, ind) => `${head}${ind}    raise RuntimeError("DONEGATE_VACUITY_PROBE_TRAP:${fnName}")\n`) : null;
}

function vacReplaceJsAfterParen(origText, masked, closeParen, fnName) {
  const afterParen = masked.slice(closeParen + 1, closeParen + 1 + AFTER_PAREN_WINDOW);
  const blockHead = afterParen.match(/^\s*(?::[^={;\n]+)?(?:=>\s*)?\{/);
  if (blockHead) {
    const openBrace = closeParen + 1 + blockHead[0].length - 1, closeBrace = vacFindBalanced(masked, openBrace, '{', '}');
    if (closeBrace > openBrace) return `${origText.slice(0, openBrace)}{ throw new Error('DONEGATE_VACUITY_PROBE_TRAP:${fnName}'); }${origText.slice(closeBrace + 1)}`;
  }
  const arrowMatch = afterParen.match(/^\s*(?::[^=;\n]+)?=>\s*(?!\{)/);
  if (!arrowMatch) return null;
  const exprStart = closeParen + 1 + arrowMatch[0].length, semiIdx = masked.indexOf(';', exprStart), nlIdx = masked.indexOf('\n', exprStart);
  const exprEnd = (semiIdx >= 0 && (nlIdx < 0 || semiIdx < nlIdx)) ? semiIdx : (nlIdx >= 0 ? nlIdx : masked.length);
  return `${origText.slice(0, exprStart)}(() => { throw new Error('DONEGATE_VACUITY_PROBE_TRAP:${fnName}'); })()${origText.slice(exprEnd)}`;
}

function vacInjectThrowStub(origText, fnName, ext) {
  const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (ext === '.py') return vacInjectPyThrowStub(origText, esc, fnName);
  const masked = maskCommentsAndStrings(origText, ext || '.mjs');
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function(?:\\s*\\*)?\\s+${esc}\\s*\\(`),
    new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const|let|var)\\s+${esc}\\s*(?::[^=\\n]+)?=\\s*(?:async\\s*)?(?:function\\s*)?\\(`),
    new RegExp(`(?:^|\\n)\\s*(?:(?:async|static)\\s+)*${esc}\\s*\\(`)
  ];
  for (const re of patterns) {
    const m = masked.match(re);
    const closeParen = m ? vacFindBalanced(masked, m.index + m[0].length - 1, '(', ')') : -1;
    const replaced = closeParen >= 0 ? vacReplaceJsAfterParen(origText, masked, closeParen, fnName) : null;
    if (replaced) return replaced;
  }
  return null;
}

export function probeTargetFunctionVacuity(projectRoot, spec = {}) {
  const root = resolve(projectRoot), rawFile = spec.file || spec.targetFile || '';
  const fnName = String(spec.functionName || spec.symbol || spec.targetSymbol || '').trim();
  const command = String(spec.command || spec.obligation?.command || '').trim();
  if (!rawFile || !fnName || !command) return { ok: false, exitCode: 3, vacuous: false, code: 'VACUITY_INVALID_ARGS', reason: '缺少 file / functionName / command' };
  const targetAbs = resolve(root, rawFile), rawRel = relative(root, targetAbs), relFile = vacNormalizeRel(rawRel);
  if (!relFile || isAbsolute(rawRel) || relFile.startsWith('..') || !existsSync(targetAbs)) {
    return { ok: false, exitCode: 3, vacuous: false, code: 'VACUITY_TARGET_MISSING', reason: `目标文件不存在或越界：${rawFile}` };
  }
  const origBuf = readFileSync(targetAbs), origHash = sha256(origBuf);
  const stubbed = vacInjectThrowStub(origBuf.toString('utf8'), fnName, extname(targetAbs).toLowerCase());
  if (!stubbed) return { ok: false, exitCode: 3, vacuous: false, code: 'TARGET_SYMBOL_NOT_FOUND', reason: `未在 ${relFile} 中定位到目标函数 ${fnName}` };
  const sanitizedEnv = buildSanitizedEnv(process.env, {}, { cwd: root });
  let probeRun;
  try {
    writeFileSync(targetAbs, stubbed, 'utf8');
    probeRun = spawnSync(command, { cwd: root, shell: true, env: sanitizedEnv, encoding: 'utf8', timeout: Number(spec.timeoutSec || DEFAULT_VACUITY_TIMEOUT_SEC) * 1000, windowsHide: true });
  } finally {
    writeFileSync(targetAbs, origBuf);
  }
  const restoredHash = sha256(readFileSync(targetAbs));
  if (restoredHash !== origHash) return { ok: false, exitCode: 2, vacuous: false, code: 'VACUITY_RESTORE_FAILED', reason: `目标文件 ${relFile} 还原哈希不一致` };
  if (probeRun.status === 0) {
    return { ok: false, exitCode: 1, vacuous: true, reachedTarget: false, probeExitCode: 0, restoredSha256: restoredHash, code: 'VACUOUS_TEST_UNREACHED_TARGET', reason: `空心假测试拦截：将 ${relFile}::${fnName} 替换为抛错桩后判据仍退出 0，测试未触达目标代码` };
  }
  return { ok: true, exitCode: 0, vacuous: false, reachedTarget: true, probeExitCode: probeRun.status, restoredSha256: restoredHash, code: 'TARGET_REACHED_KILLED' };
}

export function resolveWorkflowAchTarget(projectRoot, opts = {}) {
  const root = resolve(projectRoot), targetJson = join(root, EPHEMERAL_CATCH_REL_DIR, 'ach-target.json');
  if (!opts.mutants && !existsSync(targetJson)) return null;
  const tRes = existsSync(targetJson) ? readJsonStrict(targetJson) : { ok: false };
  const cid = opts.id || tRes.value?.contractId, oid = opts.criterionId || tRes.value?.criterionId;
  const cRes = cid ? readJsonStrict(join(root, 'contracts', cid, 'contract.json')) : { ok: false };
  const ob = cRes.ok ? (cRes.value?.obligations || []).find((o) => o.id === oid) : null;
  return cRes.ok && ob ? { contract: cRes.value, ob, mutants: opts.mutants || tRes.value?.mutants } : null;
}
