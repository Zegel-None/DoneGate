// 真实 GitHub Star 同源接口执行器（优先 gh CLI，回退 GITHUB_TOKEN / .git-credentials REST API，支持本地单测基址注入）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readSavedWorkbenchState } from '../atlas/contract.mjs';

const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const UNAUTH_REASON = '未检测到有效 GitHub 登录凭据或 Star 权限（可执行 gh auth login 或配置 GITHUB_TOKEN）';

function isValidRepoSlug(repoSlug) {
  if (!REPO_SLUG_RE.test(repoSlug)) return false;
  const [owner, repo] = repoSlug.split('/');
  return owner !== '.' && owner !== '..' && repo !== '.' && repo !== '..' && !repoSlug.includes('..');
}

function syncStarredRepoInState(projectRoot, repoSlug, star) {
  const root = resolve(projectRoot);
  const st = readSavedWorkbenchState(root);
  const cur = Array.isArray(st.starredRepos) ? st.starredRepos : [];
  st.starredRepos = star
    ? (cur.includes(repoSlug) ? cur : [...cur, repoSlug])
    : cur.filter((item) => item !== repoSlug);
  st.updatedAt = new Date().toISOString();
  mkdirSync(join(root, '.donegate'), { recursive: true });
  writeFileSync(join(root, '.donegate', 'workbench-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');
  return st.starredRepos;
}

function readGitCredentialsToken(customHomeDir) {
  const credPath = join(customHomeDir || homedir(), '.git-credentials');
  if (!existsSync(credPath)) return '';
  try {
    const raw = readFileSync(credPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.trim().match(/https:\/\/[^:@\s]+:([^@\s]+)@github\.com/i);
      if (m && m[1]) {
        try { return decodeURIComponent(m[1]); } catch (err) { void err; return m[1]; }
      }
    }
  } catch (err) {
    void err;
  }
  return '';
}

export async function starGitHubRepo(projectRoot, payload = {}, opts = {}) {
  const repoSlug = String(payload.repoSlug || '').trim();
  const star = payload.star !== false;
  if (!isValidRepoSlug(repoSlug)) {
    return { status: 400, body: { ok: false, error: '非法的 GitHub 仓库标识 repoSlug' } };
  }

  const env = opts.env || process.env;
  const customApiBase = String(opts.githubApiBase || env.DG_GITHUB_API_BASE || '').trim();

  if (!customApiBase && opts.skipGhCli !== true) {
    const ghRes = spawnSync('gh', ['api', '-X', star ? 'PUT' : 'DELETE', `/user/starred/${repoSlug}`], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true
    });
    if (ghRes.status === 0) {
      const starredRepos = syncStarredRepoInState(projectRoot, repoSlug, star);
      return { status: 200, body: { ok: true, starred: star, repoSlug, via: 'gh-cli', starredRepos } };
    }
  }

  const envToken = opts.githubToken !== undefined
    ? String(opts.githubToken || '').trim()
    : String(env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  const token = envToken || readGitCredentialsToken(opts.homeDir || env.DG_TEST_HOME || homedir());
  if (!token) {
    return { status: 200, body: { ok: false, unauthenticated: true, reason: UNAUTH_REASON } };
  }

  const apiBase = (customApiBase || 'https://api.github.com').replace(/\/+$/, '');
  try {
    const resp = await fetch(`${apiBase}/user/starred/${repoSlug}`, {
      method: star ? 'PUT' : 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DoneGate-Workbench',
        'Content-Length': '0'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (resp.status === 204 || resp.status === 200) {
      const starredRepos = syncStarredRepoInState(projectRoot, repoSlug, star);
      return { status: 200, body: { ok: true, starred: star, repoSlug, via: 'github-rest', starredRepos } };
    }
  } catch (err) {
    void err;
  }

  return { status: 200, body: { ok: false, unauthenticated: true, reason: UNAUTH_REASON } };
}
