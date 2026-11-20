// 执行隔离声明、门 4 双探针、白名单环境、输出上限与三条禁令（02-规格.md §四）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict } from '../../skill/io.mjs';

export const DEFAULT_RUNNER_CONFIG = {
  isolation: 'none',
  dimensions: { file: false, network: false, process: false, env: true },
  maxOutputChars: 262144
};

const ENV_WHITELIST = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'LANG', 'LC_ALL', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec'];

export function ensureRunnerConfig(projectRoot) {
  const p = join(projectRoot, '.donegate', 'runner.json');
  if (!existsSync(p)) {
    mkdirSync(join(projectRoot, '.donegate'), { recursive: true });
    writeFileSync(p, JSON.stringify(DEFAULT_RUNNER_CONFIG, null, 2) + '\n', 'utf8');
    return { ...DEFAULT_RUNNER_CONFIG, path: p };
  }
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') return { ...DEFAULT_RUNNER_CONFIG, corrupt: true, path: p };
  return { ...DEFAULT_RUNNER_CONFIG, ...r.value, path: p };
}

export function buildSanitizedEnv() {
  const env = {};
  for (const k of ENV_WHITELIST) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

export function checkCommandBans(command) {
  const cmd = String(command || '').trim();
  const hits = [];
  if (/\|\|\s*true\b|;\s*exit\s+0\b|--no-fail\b/i.test(cmd)) {
    hits.push('禁令 1：命令包含吞失败写法（|| true / ; exit 0 / --no-fail）');
  }
  if (/^(?:pnpm|npm|npx|yarn|bun)(?:\.cmd|\.ps1)?\s+(?:run|exec|test)\b/i.test(cmd)) {
    hits.push('禁令 2：命令经包管理器包装执行（会替换退出码）');
  }
  if (/(?:>|>>)\s*[^\s]*(?:contracts\/|CONSTRAINTS\.md|INTENT\.md)/i.test(cmd)) {
    hits.push('禁令 3：命令试图改写契约、意图或约束文件');
  }
  return hits;
}

export function runIsolationProbes(projectRoot) {
  const cfg = ensureRunnerConfig(projectRoot);
  if (cfg.corrupt) {
    return { ok: false, exitCode: 2, reason: 'runner.json JSON 损坏', cfg };
  }

  // 探针 1：越界读（读项目根之外的系统文件）
  const outRootFile = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hostname';
  let readSucceeded = false;
  try {
    if (existsSync(outRootFile)) { readFileSync(outRootFile, 'utf8'); readSucceeded = true; }
  } catch { readSucceeded = false; }

  // 探针 2：越界连（连外网探测：用极短超时的本地无害检测或不可路由地址避免卡死；只有声明 network 隔离才阻断）
  let netSucceeded = false;
  if (cfg.dimensions && cfg.dimensions.network === true) {
    const netProbe = spawnSync(process.execPath, [
      '-e',
      'const net=require("node:net");const s=net.connect({host:"1.1.1.1",port:53,timeout:500});s.on("connect",()=>{s.destroy();process.exit(0);});s.on("error",()=>process.exit(1));s.on("timeout",()=>{s.destroy();process.exit(1);});'
    ], { cwd: projectRoot, encoding: 'utf8', timeout: 2000 });
    netSucceeded = netProbe.status === 0;
  }

  // 若声称开启了 file/network 隔离而探针却成功 → 虚假隔离声明（事故退 2）
  if (cfg.isolation !== 'none') {
    if (cfg.dimensions?.file === true && readSucceeded) {
      return { ok: false, exitCode: 2, reason: `隔离校验失败：runner.json 声明 file 隔离 (${cfg.isolation})，但越界读探针成功读取 ${outRootFile}`, cfg };
    }
    if (cfg.dimensions?.network === true && netSucceeded) {
      return { ok: false, exitCode: 2, reason: `隔离校验失败：runner.json 声明 network 隔离 (${cfg.isolation})，但越界连探针连接成功`, cfg };
    }
  }

  return {
    ok: true,
    exitCode: 0,
    cfg,
    isolationNotice: cfg.isolation === 'none' ? '本次运行无隔离' : `隔离=${cfg.isolation}`,
    probes: {
      outOfRootReadBlocked: !readSucceeded,
      outboundNetBlocked: !netSucceeded
    }
  };
}
