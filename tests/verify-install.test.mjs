import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import {
  isNodeVersionSupported,
  probeAndFixBareWindowsTraps,
  probeOnDemandEcosystem
} from '../skill/verify-install-probes.mjs';
import {
  formatInstallReceiptBox,
  verifyDoneGateInstallation
} from '../skill/verify-install.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

test('裸机 Windows 陷阱探针：自动捕获 PowerShell Restricted 与 core.longpaths 未开并执行自愈指令', () => {
  const executed = [];
  const fakeWinRunCmd = (bin, args) => {
    executed.push([bin, ...args].join(' '));
    const joined = args.join(' ');
    if (bin === 'powershell.exe' && joined.includes('Get-ExecutionPolicy')) {
      return { status: 0, stdout: 'Restricted', stderr: '' };
    }
    if (bin === 'powershell.exe' && joined.includes('Set-ExecutionPolicy')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (bin === 'git' && joined.includes('--get core.longpaths')) {
      return { status: 1, stdout: '', stderr: '' };
    }
    if (bin === 'git' && joined.includes('--global core.longpaths true')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    if (bin === 'npm.cmd') return { status: 0, stdout: '10.9.0', stderr: '' };
    if (bin === 'winget') return { status: 0, stdout: 'v1.9.25200', stderr: '' };
    return { status: 1, stdout: '', stderr: 'not installed' };
  };

  const winEnv = {
    USERPROFILE: win32.join('\\mock-win-vol', 'Users', '张 小白'),
    ProgramFiles: win32.join('\\mock-win-vol', 'Program Files'),
    'ProgramFiles(x86)': win32.join('\\mock-win-vol', 'Program Files (x86)')
  };
  const traps = probeAndFixBareWindowsTraps({
    platform: 'win32',
    env: winEnv,
    runCmd: fakeWinRunCmd,
    applyFix: true
  });
  assert.equal(traps.hasNonAsciiOrSpace, true);
  assert.ok(traps.notes.some((n) => n.includes('RemoteSigned')));
  assert.ok(traps.notes.some((n) => n.includes('core.longpaths=true')));
  assert.equal(traps.warnings.length, 0);

  const eco = probeOnDemandEcosystem({
    platform: 'win32',
    env: winEnv,
    runCmd: fakeWinRunCmd,
    fileExists: (p) => p.includes('msedge.exe')
  });
  assert.equal(eco.npmReady, true);
  assert.equal(eco.osPkgMgrReady, true);
  assert.equal(eco.browserReady, true);
  assert.equal(eco.uvReady, false);
  assert.equal(eco.goReady, false);

  assert.equal(isNodeVersionSupported('v16.20.2').ok, false);
  assert.equal(isNodeVersionSupported('v18.20.4').ok, true);
  assert.equal(isNodeVersionSupported('v22.19.0').recommended, true);
});

test('防撒谎安装验真：未装必红、损坏必红、多 Profile 中文空格目录一站式 --install 产出防伪回执码', async () => {
  const sb = mkdtempSync(join(tmpdir(), 'dg-vi-test-'));
  try {
    const dshHome = join(sb, 'Users_李四 Vibecoder', '.dsh');
    mkdirSync(join(dshHome, 'profiles', 'my-profile'), { recursive: true });

    const before = await verifyDoneGateInstallation({
      projectRoot: REPO_ROOT,
      dshHome,
      install: false,
      skipLivePortProbe: true
    });
    assert.equal(before.ok, false);
    assert.equal(before.proofToken, null);
    assert.match(formatInstallReceiptBox(before), /严禁向用户谎称已安装成功/);

    const installed = await verifyDoneGateInstallation({
      projectRoot: REPO_ROOT,
      dshHome,
      install: true,
      skipLivePortProbe: true
    });
    assert.equal(installed.ok, true, formatInstallReceiptBox(installed));
    assert.match(installed.proofToken || '', /^DG-INSTALL-OK-[0-9A-F]{12}$/);
    const box = formatInstallReceiptBox(installed);
    assert.match(box, /6\/6 硬门禁全绿/);
    assert.match(box, /RESULT: PASS/);

    writeFileSync(
      join(dshHome, 'profiles', 'web', 'node_modules', '@local', 'dsh-donegate', 'lib', 'client.js'),
      '// empty broken bundle\n',
      'utf8'
    );
    const broken = await verifyDoneGateInstallation({
      projectRoot: REPO_ROOT,
      dshHome,
      install: false,
      skipLivePortProbe: true
    });
    assert.equal(broken.ok, false);
    assert.equal(broken.gates.find((g) => g.id === 'G3')?.ok, false);
    assert.equal(broken.proofToken, null);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
}, 45000);
