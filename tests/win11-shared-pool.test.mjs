import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../skill/hash.mjs';
import {
  DEFAULT_RANGE_CHUNK_BYTES, assertPureAsciiBatch, buildWinHardenedGitArgs,
  buildWorkflowDepEnv, createDoneGateWebRouteHandler, downloadWithRangeResume,
  installSharedPoolBinaryDep, inspectWorkflowDeps, provisionCleanRepoSnapshot,
  readSharedRefreshStamp, readWorkflowDepsStatus, repairGitRepoCleanIndex, writeSharedPoolLaunchers
} from '../runner/dsh/index.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WF_DEPS_CLI = join(REPO_ROOT, 'runner', 'dsh', 'workflow-deps.mjs');

function startLocalTestServer(handler) {
  return new Promise((resolveServer) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

describe('Windows 11 共享底座池 (_shared) 全链路加固回归测试', () => {
  it('1 MiB HTTP Range 分块断点续传：支持 307 重定向、503/截断重试、.part 续传、SHA-256 校验与 200 回退', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-win11-range-'));
    const totalLen = DEFAULT_RANGE_CHUNK_BYTES * 2 + 419422;
    const payload = Buffer.alloc(totalLen);
    for (let i = 0; i < totalLen; i++) payload[i] = (i * 31 + 17) & 0xff;
    const expectedHash = sha256(payload);
    const seenRanges = [];
    let chunkOneAttempts = 0;

    const srv = await startLocalTestServer((req, res) => {
      if (req.url === '/distributions/gradle-8.10.2-bin.zip') {
        res.writeHead(307, { Location: '/cdn/gradle-8.10.2-bin.zip' }); res.end(); return;
      }
      if (req.url === '/cdn/gradle-8.10.2-bin.zip') {
        const rangeHdr = String(req.headers.range || '');
        seenRanges.push(rangeHdr);
        const m = rangeHdr.match(/^bytes=(\d+)-(\d+)$/);
        const start = Number(m[1]), end = Math.min(Number(m[2]), totalLen - 1);
        if (start === DEFAULT_RANGE_CHUNK_BYTES) {
          chunkOneAttempts++;
          if (chunkOneAttempts === 1) { res.writeHead(503); res.end('proxy reset'); return; }
          if (chunkOneAttempts === 2) {
            res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${totalLen}`, 'Content-Length': String(end - start + 1) });
            res.write(payload.subarray(start, start + 2048));
            res.socket.destroy();
            return;
          }
        }
        const slice = payload.subarray(start, end + 1);
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${totalLen}`, 'Content-Length': String(slice.byteLength) });
        res.end(slice);
        return;
      }
      if (req.url === '/legacy/plain.bin') {
        const sub = payload.subarray(0, 65536);
        res.writeHead(200, { 'Content-Length': String(sub.byteLength) }); res.end(sub);
      }
    });

    try {
      const dest1 = join(tmp, 'gradle-8.10.2-bin.zip');
      const r1 = await downloadWithRangeResume(`${srv.baseUrl}/distributions/gradle-8.10.2-bin.zip`, dest1, { expectedSha256: expectedHash, baseDelayMs: 5 });
      expect(r1.ok).toBe(true);
      expect(r1.mode).toBe('range-206');
      expect(r1.bytes).toBe(totalLen);
      expect(r1.sha256).toBe(expectedHash);
      expect(r1.redirectsFollowed).toBeGreaterThanOrEqual(1);
      expect(r1.retriesUsed).toBe(2);
      expect(seenRanges[0]).toBe(`bytes=0-${DEFAULT_RANGE_CHUNK_BYTES - 1}`);
      expect(existsSync(`${dest1}.part`)).toBe(false);
      expect(sha256(readFileSync(dest1))).toBe(expectedHash);

      const destResume = join(tmp, 'resumed.zip');
      writeFileSync(`${destResume}.part`, payload.subarray(0, DEFAULT_RANGE_CHUNK_BYTES));
      const rResume = await downloadWithRangeResume(`${srv.baseUrl}/cdn/gradle-8.10.2-bin.zip`, destResume, { expectedSha256: expectedHash, baseDelayMs: 5 });
      expect(rResume.resumedFromBytes).toBe(DEFAULT_RANGE_CHUNK_BYTES);
      expect(rResume.chunksDownloaded).toBe(2);
      expect(sha256(readFileSync(destResume))).toBe(expectedHash);

      const dest200 = join(tmp, 'plain.bin');
      const r200 = await downloadWithRangeResume(`${srv.baseUrl}/legacy/plain.bin`, dest200, { expectedSha256: sha256(payload.subarray(0, 65536)), baseDelayMs: 5 });
      expect(r200.mode).toBe('stream-200');
      await expect(downloadWithRangeResume(`${srv.baseUrl}/legacy/plain.bin`, join(tmp, 'bad.bin'), { expectedSha256: '0'.repeat(64), baseDelayMs: 5 })).rejects.toThrow(/SHA-256/);
    } finally {
      await srv.close(); rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Windows Git OpenSSL/代理参数构建、陈旧 index.lock 清理与脏 D 记录自动修复归零', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-win11-git-'));
    const srv = await startLocalTestServer((req, res) => {
      if (req.url === '/src.tar.gz') {
        const tgz = readFileSync(join(tmp, 'fixture.tar.gz'));
        res.writeHead(200, { 'Content-Length': String(tgz.byteLength) }); res.end(tgz);
      }
    });
    try {
      const gitArgs = buildWinHardenedGitArgs(['ls-remote'], { HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897' });
      expect(gitArgs).toEqual(expect.arrayContaining(['core.longpaths=true', 'http.sslBackend=openssl', 'http.proxy=http://127.0.0.1:7897', 'https.proxy=http://127.0.0.1:7897']));

      const repoDir = join(tmp, 'gradle-repo');
      mkdirSync(join(repoDir, 'subprojects', 'core'), { recursive: true });
      writeFileSync(join(repoDir, '.editorconfig'), 'root = true\n', 'utf8');
      writeFileSync(join(repoDir, '.gitattributes'), '* text=auto\n', 'utf8');
      writeFileSync(join(repoDir, 'subprojects', 'core', 'Build.java'), 'class Build {}\n', 'utf8');
      spawnSync('git', ['-C', repoDir, 'init', '-q', '-b', 'main']);
      spawnSync('git', ['-C', repoDir, 'config', 'user.email', 'test@donegate.local']);
      spawnSync('git', ['-C', repoDir, 'config', 'user.name', 'DoneGate']);
      spawnSync('git', ['-C', repoDir, 'add', '.']);
      spawnSync('git', ['-C', repoDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'v8.10.2']);

      const packParent = join(tmp, 'tar-src', 'gradle-8.10.2');
      mkdirSync(join(packParent, 'subprojects', 'core'), { recursive: true });
      writeFileSync(join(packParent, '.editorconfig'), 'root = true\n', 'utf8');
      writeFileSync(join(packParent, '.gitattributes'), '* text=auto\n', 'utf8');
      writeFileSync(join(packParent, 'subprojects', 'core', 'Build.java'), 'class Build {}\n', 'utf8');
      spawnSync('tar', ['-czf', join(tmp, 'fixture.tar.gz'), '-C', join(tmp, 'tar-src'), 'gradle-8.10.2']);

      spawnSync('git', ['-C', repoDir, 'rm', '-q', '--cached', '-r', '.']);
      const lockFile = join(repoDir, '.git', 'index.lock');
      writeFileSync(lockFile, 'stale-lock', 'utf8');
      expect(spawnSync('git', ['-C', repoDir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout).toContain('D  .editorconfig');

      const repaired = repairGitRepoCleanIndex(repoDir);
      expect(repaired).toMatchObject({ ok: true, lockRemoved: true, dirtyDeletionsBefore: 3, dirtyDeletionsAfter: 0, porcelain: '' });
      expect(existsSync(lockFile)).toBe(false);

      const snapDir = join(tmp, 'snap-repo');
      const snapRes = await provisionCleanRepoSnapshot({ id: 'gradle', tarballUrl: `${srv.baseUrl}/src.tar.gz`, repoDir: snapDir, baseDelayMs: 5 });
      expect(snapRes.ok).toBe(true);
      expect(existsSync(join(snapDir, 'subprojects', 'core', 'Build.java'))).toBe(true);
    } finally {
      await srv.close(); rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('强制 .bat/.cmd 100% 纯 ASCII + CRLF 守卫、%~dp0 任意 cwd 解析与池内 .gradle-home 自动注入', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-win11-bat-'));
    try {
      const ws = join(tmp, 'empty-workspace');
      mkdirSync(ws, { recursive: true });
      expect(() => assertPureAsciiBatch('@echo off\r\nrem 中文注释触发乱码\r\n')).toThrow(/NON_ASCII_BATCH_CONTENT/);
      expect(() => assertPureAsciiBatch('@echo off\nrem lf only\n')).toThrow(/NON_CRLF_BATCH_CONTENT/);

      const distBinDir = join(ws, 'workflows', '.deps', '_shared', 'dists', 'gradle-8.10.2', 'bin');
      mkdirSync(distBinDir, { recursive: true });
      const posixBin = join(distBinDir, 'gradle');
      writeFileSync(posixBin, '#!/bin/sh\necho "Gradle 8.10.2 HOME=$GRADLE_USER_HOME"\n', 'utf8');
      chmodSync(posixBin, 0o755);
      writeFileSync(join(distBinDir, 'gradle.bat'), '@echo off\r\necho Gradle 8.10.2 HOME=%GRADLE_USER_HOME%\r\n', 'ascii');

      const out = writeSharedPoolLaunchers(ws, { binName: 'gradle', distSubdir: 'gradle-8.10.2', comment: '安卓构建工作流启动器（中文自动剥离）' });
      expect(existsSync(join(ws, 'workflows', '.deps', '_shared', '.gradle-home'))).toBe(true);
      for (const p of [out.batPath, out.cmdPath]) {
        const raw = readFileSync(p, 'utf8');
        expect(Buffer.from(raw, 'utf8').every((b) => b <= 0x7f)).toBe(true);
        expect(/(^|[^\r])\n/.test(raw)).toBe(false);
        for (const token of ['%~dp0', '..\\dists\\gradle-8.10.2', '..\\.gradle-home', 'GRADLE_USER_HOME']) expect(raw).toContain(token);
      }

      const outsideCwd = join(tmp, 'arbitrary-cwd'), readOnlyHome = join(tmp, 'readonly-gradle-home');
      mkdirSync(outsideCwd, { recursive: true });
      if (process.platform === 'win32') {
        // Windows NTFS 上 chmodSync(0o555) 不拦截目录写入，用同名普通文件真实阻塞 nested 子目录创建
        writeFileSync(readOnlyHome, 'not-a-directory', 'utf8');
      } else {
        mkdirSync(readOnlyHome, { recursive: true });
        chmodSync(readOnlyHome, 0o555);
      }
      try {
        if (process.platform !== 'win32') {
          const run = spawnSync(out.posixPath, ['--version'], { cwd: outsideCwd, encoding: 'utf8', env: { ...process.env, GRADLE_USER_HOME: join(readOnlyHome, 'nested') } });
          expect(run.status).toBe(0);
          expect(run.stdout).toContain('Gradle 8.10.2');
          expect(run.stdout).toContain(join(ws, 'workflows', '.deps', '_shared', '.gradle-home'));
        }
        const wfEnv = buildWorkflowDepEnv(ws, 'pack-android', { PATH: '', GRADLE_USER_HOME: join(readOnlyHome, 'nested') });
        expect(wfEnv.GRADLE_USER_HOME).toBe(join(ws, 'workflows', '.deps', '_shared', '.gradle-home'));
      } finally {
        if (process.platform !== 'win32') chmodSync(readOnlyHome, 0o755);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('空工作区一键落盘双层 manifest.json、免 401 本地 CLI 刷新通路、路由实时读取与子代理防坑提示词校验', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dg-win11-e2e-'));
    const zipBytes = Buffer.from('PK-mock-gradle-dist-payload');
    const srv = await startLocalTestServer((req, res) => {
      if (req.url === '/gradle.zip') {
        res.writeHead(206, { 'Content-Range': `bytes 0-${zipBytes.length - 1}/${zipBytes.length}`, 'Content-Length': String(zipBytes.length) });
        res.end(zipBytes);
      }
    });

    try {
      const ws = join(tmp, 'fresh-ws');
      mkdirSync(ws, { recursive: true });
      const androidPack = { id: 'pack-android', name: '安卓构建工作流', nodes: [{ id: 'n-gradle', tplId: 'tpl-gradle', pinnedVersion: 'v8.10.2' }] };
      const preInspect = inspectWorkflowDeps(ws, androidPack, { env: { PATH: '' } });
      expect(preInspect.ready).toBe(false);
      for (const kw of ['http.sslBackend=openssl', 'core.longpaths=true', 'downloadWithRangeResume', '1048576', 'GRADLE_USER_HOME', '.gradle-home', 'write-launchers', 'mark-ready', '401']) {
        expect(preInspect.agentPrompt).toContain(kw);
      }

      const inst = await installSharedPoolBinaryDep(ws, {
        id: 'gradle', binName: 'gradle', version: '8.10.2', tag: 'v8.10.2',
        commit: '415adb9e06a516c44b391edff552fd42139443f7', workflowId: 'pack-android',
        distSubdir: 'gradle-8.10.2', archiveUrl: `${srv.baseUrl}/gradle.zip`,
        downloadOpts: { expectedSha256: sha256(zipBytes), baseDelayMs: 5 },
        extractFn: (_arc, targetDir) => {
          const bDir = join(targetDir, 'gradle-8.10.2', 'bin');
          mkdirSync(bDir, { recursive: true });
          const sh = join(bDir, 'gradle');
          writeFileSync(sh, '#!/bin/sh\necho "Gradle 8.10.2 Revision 415adb9e06a516c44b391edff552fd42139443f7"\n', 'utf8');
          chmodSync(sh, 0o755);
          writeFileSync(join(bDir, 'gradle.bat'), '@echo off\r\necho Gradle 8.10.2\r\n', 'ascii');
        }
      });
      expect(inst.ok).toBe(true);
      const sharedManifest = JSON.parse(readFileSync(join(ws, 'workflows/.deps/_shared/manifest.json'), 'utf8'));
      const wfManifest = JSON.parse(readFileSync(join(ws, 'workflows/.deps/pack-android/manifest.json'), 'utf8'));
      expect(sharedManifest.installed.gradle.ready).toBe(true);
      expect(sharedManifest.installed.gradle.verified.status).toBe('pass');
      expect(wfManifest.installed.gradle).toMatchObject({ ready: true, sharedPool: true, sharedManifest: '../_shared/manifest.json' });

      expect(readWorkflowDepsStatus(ws, 'pack-android').ready).toBe(true);
      expect(inspectWorkflowDeps(ws, androidPack, { platform: 'win32', env: { PATH: '' } }).items[0].resolvedVia).toBe('workflow-shared-manifest');
      expect(inspectWorkflowDeps(ws, { id: 'jit-android-2', nodes: androidPack.nodes }, { platform: 'win32', env: { PATH: '' } }).items[0].resolvedVia).toBe('shared-manifest');

      const seqBefore = readSharedRefreshStamp(ws).seq;
      const cliRes = spawnSync(process.execPath, [WF_DEPS_CLI, 'refresh', '--project', ws, '--workflow', 'pack-android'], { encoding: 'utf8' });
      expect(cliRes.status).toBe(0);
      expect(JSON.parse(cliRes.stdout).refreshStamp.seq).toBe(seqBefore + 1);

      const handleRoute = createDoneGateWebRouteHandler(ws);
      let respObj = null;
      await handleRoute(
        { method: 'GET', url: '/donegate/api/workflow-deps/inspect?workflow=pack-android', on() {} },
        { writeHead() {}, end(txt) { respObj = JSON.parse(txt); } },
        '/workflow-deps/inspect'
      );
      expect(respObj).toMatchObject({ ok: true, refreshStamp: { seq: seqBefore + 1 }, report: { ready: true } });
    } finally {
      await srv.close(); rmSync(tmp, { recursive: true, force: true });
    }
  });
});
