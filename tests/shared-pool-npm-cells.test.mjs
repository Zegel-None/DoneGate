import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildProvisionAgentPrompt,
  ensureSharedPoolSkeleton,
  inspectWorkflowDeps,
  verifyInstalledNpmPackage
} from '../runner/dsh/workflow-deps.mjs';

function createFakeNpmExecutable(dir) {
  const fakeNpm = join(dir, 'fake-npm.mjs');
  const script = `#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--no-save')) {
  console.error('FORBIDDEN_NO_SAVE_FLAG');
  process.exit(2);
}
if (!argv.includes('--save-exact')) {
  console.error('MISSING_SAVE_EXACT_FLAG');
  process.exit(2);
}
const pIdx = argv.indexOf('--prefix');
const prefix = argv[pIdx + 1];
const pkgSpec = argv[argv.length - 1];
const atPos = pkgSpec.lastIndexOf('@');
const pkgName = atPos > 0 ? pkgSpec.slice(0, atPos) : pkgSpec;
const ver = atPos > 0 ? pkgSpec.slice(atPos + 1) : '1.0.0';

const pjPath = join(prefix, 'package.json');
const pj = existsSync(pjPath) ? JSON.parse(readFileSync(pjPath, 'utf8')) : { private: true };
pj.dependencies = { ...(pj.dependencies || {}), [pkgName]: ver };
writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\\n', 'utf8');

// 模拟 npm 真实行为：只保留 package.json dependencies 中声明的包（若没写进 dependencies 就会被清空！）
for (const [depPkg, depVer] of Object.entries(pj.dependencies)) {
  const pkgDir = join(prefix, 'node_modules', ...depPkg.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'index.js'), 'export const version = ' + JSON.stringify(depVer) + ';\\n', 'utf8');
  const binTail = depPkg === '@lhci/cli' ? 'lhci' : depPkg.split('/').pop();
  const isCli = depPkg === 'storybook' || depPkg === '@lhci/cli';
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: depPkg,
    version: depVer,
    main: 'index.js',
    ...(isCli ? { bin: { [binTail]: './bin.js' } } : {})
  }, null, 2) + '\\n', 'utf8');
  if (isCli) {
    // 模拟不同 CLI 工具各自携带不同大版本 vite (storybook -> vite 6.4.6, lhci -> vite 8.3.8)
    const viteVer = depPkg === 'storybook' ? '6.4.6' : '8.3.8';
    const viteDir = join(prefix, 'node_modules', 'vite');
    mkdirSync(viteDir, { recursive: true });
    writeFileSync(join(viteDir, 'package.json'), JSON.stringify({ name: 'vite', version: viteVer, main: 'index.js' }) + '\\n', 'utf8');
    writeFileSync(join(viteDir, 'index.js'), 'module.exports = { viteVersion: ' + JSON.stringify(viteVer) + ' };\\n', 'utf8');

    const binDir = join(prefix, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const shBin = join(binDir, binTail);
    writeFileSync(shBin, '#!/usr/bin/env node\\nconst v = require("vite");\\nconsole.log(' + JSON.stringify(binTail + ' ' + depVer + ' vite=') + ' + v.viteVersion);\\n', 'utf8');
    chmodSync(shBin, 0o755);
    writeFileSync(join(binDir, binTail + '.cmd'), '@echo off\\r\\nnode "%~dp0\\\\' + binTail + '" %*\\r\\n', 'ascii');
  }
}

// 模拟 esbuild postinstall 未跑的场景：写出 install.js 供自愈逻辑调用
if (pkgName === 'storybook') {
  const esbDir = join(prefix, 'node_modules', 'esbuild');
  mkdirSync(esbDir, { recursive: true });
  writeFileSync(join(esbDir, 'install.js'), 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./repaired.txt", import.meta.url), "ok");\\n', 'utf8');
}
`;
  writeFileSync(fakeNpm, script, 'utf8');
  chmodSync(fakeNpm, 0o755);
  return fakeNpm;
}

test('dg-deps-cli install-npm 将 CLI 工具隔离进 npm-cells 消除 vite 6/8 冲突，且连续安装绝不互相误删', () => {
  const ws = mkdtempSync(join(tmpdir(), 'dg-npm-cells-'));
  try {
    const skel = ensureSharedPoolSkeleton(ws);
    const fakeNpm = createFakeNpmExecutable(ws);

    // 1. 安装 storybook@8.4.7（携带 vite@6.4.6）并验证 esbuild 自愈
    const r1 = spawnSync(process.execPath, [
      skel.cliPath, 'install-npm', '--project', ws, '--workflow', '04-ui-interaction-and-a11y',
      '--id', 'storybook', '--kind', 'npm-cli', '--pkg', 'storybook', '--version', '8.4.7',
      '--bin', 'storybook', '--npm-cmd', fakeNpm
    ], { encoding: 'utf8' });
    assert.equal(r1.status, 0, r1.stderr || r1.stdout);
    const p1 = JSON.parse(r1.stdout);
    assert.equal(p1.ok, true);
    assert.equal(p1.isolatedCell, 'storybook');
    assert.equal(p1.esbuildRepaired, true);
    assert.ok(existsSync(join(ws, 'workflows/.deps/_shared/npm-cells/storybook/node_modules/esbuild/repaired.txt')));

    // 2. 再安装 @lhci/cli@0.14.0（携带 vite@8.3.8），验证 storybook 绝不被清空且各自持有自己的 vite 版本！
    const r2 = spawnSync(process.execPath, [
      skel.cliPath, 'install-npm', '--project', ws, '--workflow', '04-ui-interaction-and-a11y',
      '--id', 'lhci', '--kind', 'npm-cli', '--pkg', '@lhci/cli', '--version', '0.14.0',
      '--bin', 'lhci', '--npm-cmd', fakeNpm
    ], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr || r2.stdout);

    // 3. 在外部临时目录（无本地 node_modules）直接调用 .bin/storybook 与 .bin/lhci，验证 NODE_PATH 生效且各自解析正确的 vite 版本
    const extDir = mkdtempSync(join(tmpdir(), 'dg-ext-run-'));
    const runPoolBin = (name) => process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${join(ws, `workflows/.deps/_shared/.bin/${name}.bat`)}" --version"`], { cwd: extDir, encoding: 'utf8', windowsVerbatimArguments: true })
      : spawnSync(join(ws, `workflows/.deps/_shared/.bin/${name}`), ['--version'], { cwd: extDir, encoding: 'utf8' });
    try {
      const sbRun = runPoolBin('storybook');
      assert.equal(sbRun.status, 0, sbRun.stderr || sbRun.stdout);
      assert.match(sbRun.stdout, /storybook 8\.4\.7 vite=6\.4\.6/);

      const lhRun = runPoolBin('lhci');
      assert.equal(lhRun.status, 0, lhRun.stderr || lhRun.stdout);
      assert.match(lhRun.stdout, /lhci 0\.14\.0 vite=8\.3\.8/);
    } finally {
      rmSync(extDir, { recursive: true, force: true });
    }

    // 4. 连续安装两个 npm-lib 纯库到 _shared/npm，验证 --save-exact 累加不删前包
    const rLib1 = spawnSync(process.execPath, [
      skel.cliPath, 'install-npm', '--project', ws, '--workflow', 'uiboard',
      '--id', 'lovinsp', '--kind', 'npm-lib', '--pkg', 'lovinsp', '--version', '1.8.0', '--npm-cmd', fakeNpm
    ], { encoding: 'utf8' });
    assert.equal(rLib1.status, 0);
    const rLib2 = spawnSync(process.execPath, [
      skel.cliPath, 'install-npm', '--project', ws, '--workflow', 'uiboard',
      '--id', 'puck', '--kind', 'npm-lib', '--pkg', '@puckeditor/core', '--version', '0.24.1', '--npm-cmd', fakeNpm
    ], { encoding: 'utf8' });
    assert.equal(rLib2.status, 0);

    assert.equal(verifyInstalledNpmPackage(ws, 'lovinsp', 'uiboard').version, '1.8.0');
    assert.equal(verifyInstalledNpmPackage(ws, '@puckeditor/core', 'uiboard').version, '0.24.1');
    assert.equal(verifyInstalledNpmPackage(ws, 'storybook', '04-ui-interaction-and-a11y').version, '8.4.7');

    // 5. inspectWorkflowDeps 确认 04-ui-interaction-and-a11y 全部就绪，且提示词不再包含危险的 --no-save
    const stage4Pack = {
      id: '04-ui-interaction-and-a11y',
      name: '阶段 4 UI 与无障碍工作流',
      deps: [
        { id: 'storybook', title: 'Storybook', version: 'v8.4.7', kind: 'npm-cli', pkg: 'storybook', bin: 'storybook', allowHostEnv: false },
        { id: 'lhci', title: 'Lighthouse CI', version: 'v0.14.0', kind: 'npm-cli', pkg: '@lhci/cli', bin: 'lhci', allowHostEnv: false }
      ],
      nodes: []
    };
    const rep = inspectWorkflowDeps(ws, stage4Pack);
    assert.equal(rep.ready, true);
    assert.equal(rep.missingCount, 0);

    const promptSample = buildProvisionAgentPrompt(stage4Pack, 'workflows/.deps/04-ui', 'workflows/.deps/_shared', stage4Pack.deps);
    assert.match(promptSample, /install-npm/);
    assert.doesNotMatch(promptSample, /npm install --prefix [^\n]*--no-save/);

    // 6. 验证生成的 Windows .bat 启动器 100% 纯 ASCII + CRLF 且含 NODE_PATH
    const batTxt = readFileSync(join(ws, 'workflows/.deps/_shared/.bin/storybook.bat'), 'utf8');
    assert.ok(batTxt.length > 0 && Buffer.from(batTxt, 'utf8').every((b) => b <= 0x7f));
    assert.match(batTxt, /NODE_PATH/);
    assert.match(batTxt, /npm-cells\\storybook/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
