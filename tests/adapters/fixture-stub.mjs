// 跨平台适配器夹具辅助库：提供离线版本桩生成与本机真实外部二进制探测（零第三方依赖）
// 目的：
//   1. 让 --raw-report / 截断 JSON / 陈旧报告 / 0 模块空跑 等离线必红分支在任何机器上都能越过 --version 检查、直达解析逻辑；
//   2. 区分「离线解析逻辑断言失败（退 1）」与「真机未装外部 CLI（退 3）」，彻底消灭因缺二进制提前退 3 造成的假绿。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const IS_OFFLINE = process.argv.includes('--offline') || process.env.DONEGATE_OFFLINE_FIXTURES === '1';

export function createVersionStub(tmpDir, name, versionStr) {
  const stubDir = join(tmpDir, '__stubs__');
  mkdirSync(stubDir, { recursive: true });
  if (process.platform === 'win32') {
    const p = join(stubDir, `${name}.cmd`);
    writeFileSync(p, `@echo off\r\necho ${name} ${versionStr}\r\nexit /b 0\r\n`, 'utf8');
    return p;
  }
  const p = join(stubDir, name);
  writeFileSync(p, `#!/bin/sh\necho "${name} ${versionStr}"\nexit 0\n`, 'utf8');
  chmodSync(p, 0o755);
  return p;
}

export function hasRealBinary(binName, verArgs = ['--version']) {
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [binName], { encoding: 'utf8' });
  let cand = w.status === 0 && w.stdout.trim() ? w.stdout.trim().split(/\r?\n/)[0].trim() : null;
  if (!cand) {
    const fallbacks = process.platform === 'win32'
      ? [
          join(process.env.USERPROFILE || homedir(), 'bin', binName + '.exe'),
          join(process.env.USERPROFILE || homedir(), '.local', 'bin', binName + '.exe'),
          join(process.env.USERPROFILE || homedir(), 'maestro', 'bin', 'maestro.bat')
        ]
      : [
          join(homedir(), '.local', 'bin', binName),
          join(homedir(), 'bin', binName),
          join(homedir(), '.maestro', 'bin', 'maestro')
        ];
    cand = fallbacks.find((f) => existsSync(f)) || null;
  }
  if (!cand) return false;
  const r = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cand)
    ? spawnSync('cmd.exe', ['/d', '/c', cand, ...verArgs], { encoding: 'utf8', timeout: 10000 })
    : spawnSync(cand, verArgs, { encoding: 'utf8', timeout: 10000 });
  return !r.error && r.status === 0;
}

export function finishAdapterSuite(c, label, missingLiveBin = false) {
  c.summary(label);
  if (c.bad > 0) process.exit(1);
  if (missingLiveBin && !IS_OFFLINE) {
    console.error(`无法判断：本机未安装 ${label} 所需外部二进制，离线必红夹具已全过（按 §八 退 3）`);
    process.exit(3);
  }
  process.exit(0);
}
