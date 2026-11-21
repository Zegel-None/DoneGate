// Git 全分支、Worktree、多分支撞车预警、休眠半成品雷达与 OpenSpec/Beads 关联器（<= 300 行聚焦子模块）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';

function runGit(projectRoot, args) {
  const r = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', timeout: 8000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

export function scanSpecsAndBeads(projectRoot) {
  const settled = [];
  const activeChanges = [];
  const beadsOpen = [];

  const specsDir = join(projectRoot, 'openspec', 'specs');
  if (existsSync(specsDir)) {
    for (const e of readdirSync(specsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sp = join(specsDir, e.name, 'spec.md');
      if (!existsSync(sp)) continue;
      const txt = readMaybe(sp) || '';
      const h1 = txt.match(/^#\s+(.+)$/m);
      settled.push({ id: e.name, title: h1 ? h1[1].trim() : e.name, path: `openspec/specs/${e.name}/spec.md` });
    }
  }

  const changesDir = join(projectRoot, 'openspec', 'changes');
  if (existsSync(changesDir)) {
    for (const e of readdirSync(changesDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'archive') continue;
      const prop = readMaybe(join(changesDir, e.name, 'proposal.md')) || readMaybe(join(changesDir, e.name, 'README.md')) || '';
      const h1 = prop.match(/^#\s+(.+)$/m);
      activeChanges.push({ id: e.name, title: h1 ? h1[1].trim() : e.name, path: `openspec/changes/${e.name}` });
    }
  }

  const beadsJsonl = join(projectRoot, '.beads', 'issues.jsonl');
  if (existsSync(beadsJsonl)) {
    const raw = readMaybe(beadsJsonl) || '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item && item.status !== 'closed' && item.status !== 'done') {
          beadsOpen.push({ id: String(item.id || ''), title: String(item.title || item.id || '') });
        }
      } catch { /* ignore */ }
    }
  } else {
    const bdObs = readJsonStrict(join(projectRoot, '.donegate', 'adapters', 'beads', 'observation.json'));
    if (bdObs.ok && Array.isArray(bdObs.value?.openItems)) {
      for (const it of bdObs.value.openItems) beadsOpen.push({ id: String(it.id || ''), title: String(it.title || '') });
    }
  }

  return { settled, activeChanges, beadsOpen };
}

export function scanGitBranchRadar(projectRoot, { domainOfFile, staleDays = 14 } = {}) {
  const inside = runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { isGit: false, defaultBranch: null, currentBranch: null, branches: [] };
  }

  // 1. Parse git worktree list --porcelain
  const wtByBranch = new Map();
  const wtRaw = runGit(projectRoot, ['worktree', 'list', '--porcelain']) || '';
  let curWtPath = null;
  for (const line of wtRaw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) curWtPath = line.slice(9).trim();
    else if (line.startsWith('branch refs/heads/') && curWtPath) {
      wtByBranch.set(line.slice(18).trim(), curWtPath);
    } else if (!line.trim()) curWtPath = null;
  }

  // 2. Enumerate local branches
  const curBranch = runGit(projectRoot, ['branch', '--show-current']) || 'HEAD';
  const refsRaw = runGit(projectRoot, [
    'for-each-ref',
    '--format=%(refname:short)\t%(committerdate:iso-strict)\t%(subject)',
    'refs/heads'
  ]) || '';

  const rawList = refsRaw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, isoDate, subject] = line.split('\t');
    return { name, isoDate: isoDate || '', subject: subject || '' };
  });

  const branchNames = new Set(rawList.map((b) => b.name));
  const defaultBranch = branchNames.has('main') ? 'main' : (branchNames.has('master') ? 'master' : (rawList[0]?.name || curBranch));

  const branches = [];
  for (const b of rawList) {
    const isDefault = b.name === defaultBranch;
    let ahead = 0, behind = 0;
    let changedFiles = [];

    if (!isDefault && defaultBranch) {
      const lr = runGit(projectRoot, ['rev-list', '--left-right', '--count', `${defaultBranch}...${b.name}`]);
      if (lr) {
        const parts = lr.split(/\s+/).map(Number);
        behind = parts[0] || 0;
        ahead = parts[1] || 0;
      }
      if (ahead > 0) {
        const diffOut = runGit(projectRoot, ['diff', '--name-only', `${defaultBranch}...${b.name}`]) || '';
        changedFiles = diffOut.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      }
    }

    // Include uncommitted working-tree edits on current branch
    if (b.name === curBranch) {
      const stOut = runGit(projectRoot, ['status', '--porcelain']) || '';
      for (const sl of stOut.split(/\r?\n/)) {
        if (sl.length > 3) {
          const fp = sl.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '');
          if (fp && !changedFiles.includes(fp)) changedFiles.push(fp);
        }
      }
    }

    const tsMs = Date.parse(b.isoDate);
    const idleDays = Number.isFinite(tsMs) ? Math.max(0, Math.floor((Date.now() - tsMs) / 86400000)) : 0;
    const touchedDomainSet = new Set();
    for (const cf of changedFiles) {
      const dom = domainOfFile ? domainOfFile(cf) : cf.split('/')[0];
      if (dom) touchedDomainSet.add(dom);
    }

    let status = 'active';
    if (isDefault) status = 'trunk';
    else if (ahead === 0 && changedFiles.length === 0) status = 'merged';
    else if (idleDays >= staleDays) status = 'dormant';

    branches.push({
      name: b.name,
      baseBranch: defaultBranch,
      isCurrent: b.name === curBranch,
      isDefault,
      worktreePath: wtByBranch.get(b.name) || null,
      ahead,
      behind,
      lastCommitAt: b.isoDate,
      lastSubject: b.subject,
      idleDays,
      status,
      changedFiles,
      touchedDomains: [...touchedDomainSet],
      collidesWith: []
    });
  }

  // 3. Pairwise collision check across unmerged feature branches on code/config files
  const candidates = branches.filter((b) => !b.isDefault && b.changedFiles.length > 0);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const setA = new Set(candidates[i].changedFiles);
      const overlap = candidates[j].changedFiles.filter((f) => setA.has(f));
      if (overlap.length > 0) {
        candidates[i].collidesWith.push({ branch: candidates[j].name, files: overlap });
        candidates[j].collidesWith.push({ branch: candidates[i].name, files: overlap });
        if (candidates[i].status === 'active') candidates[i].status = 'collision-warn';
        if (candidates[j].status === 'active') candidates[j].status = 'collision-warn';
      }
    }
  }

  // Sort: collisions first, then dormant, then active current, then trunk, then merged
  const ORDER = { 'collision-warn': 0, dormant: 1, active: 2, trunk: 3, merged: 4 };
  branches.sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || b.ahead - a.ahead);

  return { isGit: true, defaultBranch, currentBranch: curBranch, branches };
}
