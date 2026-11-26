// Git 全分支、Worktree、多分支撞车预警、休眠半成品雷达与 OpenSpec/Beads 关联器（<= 300 行聚焦子模块）
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';

function runGit(projectRoot, args) {
  const r = spawnSync('git', ['-C', projectRoot, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', timeout: 8000 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

function sbScanSettledSpecs(projectRoot) {
  const settled = [];
  const specsDir = join(projectRoot, 'openspec', 'specs');
  if (!existsSync(specsDir)) return settled;
  for (const e of readdirSync(specsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sp = join(specsDir, e.name, 'spec.md');
    if (!existsSync(sp)) continue;
    const txt = readMaybe(sp) || '';
    const h1 = txt.match(/^#\s+(.+)$/m);
    settled.push({ id: e.name, title: h1 ? h1[1].trim() : e.name, path: `openspec/specs/${e.name}/spec.md` });
  }
  return settled;
}

function sbScanActiveChanges(projectRoot) {
  const activeChanges = [];
  const changesDir = join(projectRoot, 'openspec', 'changes');
  if (!existsSync(changesDir)) return activeChanges;
  for (const e of readdirSync(changesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'archive') continue;
    const prop = readMaybe(join(changesDir, e.name, 'proposal.md')) || readMaybe(join(changesDir, e.name, 'README.md')) || '';
    const h1 = prop.match(/^#\s+(.+)$/m);
    activeChanges.push({ id: e.name, title: h1 ? h1[1].trim() : e.name, path: `openspec/changes/${e.name}` });
  }
  return activeChanges;
}

function sbParseBeadsJsonl(beadsJsonl) {
  const beadsOpen = [];
  const raw = readMaybe(beadsJsonl) || '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item && item.status !== 'closed' && item.status !== 'done') {
        beadsOpen.push({ id: String(item.id || ''), title: String(item.title || item.id || '') });
      }
    } catch (err) {
      void err;
    }
  }
  return beadsOpen;
}

function sbScanBeadsOpen(projectRoot) {
  const beadsJsonl = join(projectRoot, '.beads', 'issues.jsonl');
  if (existsSync(beadsJsonl)) return sbParseBeadsJsonl(beadsJsonl);
  const beadsOpen = [];
  const bdObs = readJsonStrict(join(projectRoot, '.donegate', 'adapters', 'beads', 'observation.json'));
  if (bdObs.ok && Array.isArray(bdObs.value?.openItems)) {
    for (const it of bdObs.value.openItems) {
      beadsOpen.push({ id: String(it.id || ''), title: String(it.title || '') });
    }
  }
  return beadsOpen;
}

export function scanSpecsAndBeads(projectRoot) {
  return {
    settled: sbScanSettledSpecs(projectRoot),
    activeChanges: sbScanActiveChanges(projectRoot),
    beadsOpen: sbScanBeadsOpen(projectRoot)
  };
}

function sbLoadWorktreeBranchMap(projectRoot) {
  const wtByBranch = new Map();
  const wtRaw = runGit(projectRoot, ['worktree', 'list', '--porcelain']) || '';
  let curWtPath = null;
  for (const line of wtRaw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) curWtPath = line.slice(9).trim();
    else if (line.startsWith('branch refs/heads/') && curWtPath) wtByBranch.set(line.slice(18).trim(), curWtPath);
    else if (!line.trim()) curWtPath = null;
  }
  return wtByBranch;
}

function sbReadLocalBranchRefs(projectRoot) {
  const refsRaw = runGit(projectRoot, [
    'for-each-ref',
    '--format=%(refname:short)\t%(committerdate:iso-strict)\t%(subject)',
    'refs/heads'
  ]) || '';
  return refsRaw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, isoDate, subject] = line.split('\t');
    return { name, isoDate: isoDate || '', subject: subject || '' };
  });
}

function sbPickDefaultBranch(rawList, curBranch) {
  const branchNames = new Set(rawList.map((b) => b.name));
  if (branchNames.has('main')) return 'main';
  if (branchNames.has('master')) return 'master';
  return rawList[0]?.name || curBranch;
}

function sbReadBranchDiffStats(projectRoot, defaultBranch, branchName, isDefault) {
  if (isDefault || !defaultBranch) return { ahead: 0, behind: 0, changedFiles: [] };
  let ahead = 0;
  let behind = 0;
  const lr = runGit(projectRoot, ['rev-list', '--left-right', '--count', `${defaultBranch}...${branchName}`]);
  if (lr) {
    const parts = lr.split(/\s+/).map(Number);
    behind = parts[0] || 0;
    ahead = parts[1] || 0;
  }
  if (ahead <= 0) return { ahead, behind, changedFiles: [] };
  const diffOut = runGit(projectRoot, ['diff', '--name-only', `${defaultBranch}...${branchName}`]) || '';
  const changedFiles = diffOut.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { ahead, behind, changedFiles };
}

function sbAppendUncommittedFiles(projectRoot, changedFiles) {
  const stOut = runGit(projectRoot, ['status', '--porcelain']) || '';
  for (const sl of stOut.split(/\r?\n/)) {
    if (sl.length <= 3) continue;
    const fp = sl.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '');
    if (fp && !changedFiles.includes(fp)) changedFiles.push(fp);
  }
}

function sbResolveBranchStatus(isDefault, ahead, changedCount, idleDays, staleDays) {
  if (isDefault) return 'trunk';
  if (ahead === 0 && changedCount === 0) return 'merged';
  if (idleDays >= staleDays) return 'dormant';
  return 'active';
}

function sbInspectSingleBranch(projectRoot, b, ctx) {
  const isDefault = b.name === ctx.defaultBranch;
  const { ahead, behind, changedFiles } = sbReadBranchDiffStats(projectRoot, ctx.defaultBranch, b.name, isDefault);
  if (b.name === ctx.curBranch) {
    sbAppendUncommittedFiles(projectRoot, changedFiles);
  }
  const tsMs = Date.parse(b.isoDate);
  const idleDays = Number.isFinite(tsMs) ? Math.max(0, Math.floor((Date.now() - tsMs) / 86400000)) : 0;
  const touchedDomainSet = new Set();
  for (const cf of changedFiles) {
    const dom = ctx.domainOfFile ? ctx.domainOfFile(cf) : cf.split('/')[0];
    if (dom) touchedDomainSet.add(dom);
  }
  const status = sbResolveBranchStatus(isDefault, ahead, changedFiles.length, idleDays, ctx.staleDays);
  return {
    name: b.name,
    baseBranch: ctx.defaultBranch,
    isCurrent: b.name === ctx.curBranch,
    isDefault,
    worktreePath: ctx.wtByBranch.get(b.name) || null,
    ahead,
    behind,
    lastCommitAt: b.isoDate,
    lastSubject: b.subject,
    idleDays,
    status,
    changedFiles,
    touchedDomains: [...touchedDomainSet],
    collidesWith: []
  };
}

function sbDetectBranchCollisions(branches) {
  const candidates = branches.filter((b) => !b.isDefault && b.changedFiles.length > 0);
  for (let i = 0; i < candidates.length; i++) {
    const setA = new Set(candidates[i].changedFiles);
    for (let j = i + 1; j < candidates.length; j++) {
      const overlap = candidates[j].changedFiles.filter((f) => setA.has(f));
      if (overlap.length === 0) continue;
      candidates[i].collidesWith.push({ branch: candidates[j].name, files: overlap });
      candidates[j].collidesWith.push({ branch: candidates[i].name, files: overlap });
      if (candidates[i].status === 'active') candidates[i].status = 'collision-warn';
      if (candidates[j].status === 'active') candidates[j].status = 'collision-warn';
    }
  }
}

export function scanGitBranchRadar(projectRoot, { domainOfFile, staleDays = 14 } = {}) {
  const inside = runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { isGit: false, defaultBranch: null, currentBranch: null, branches: [] };
  }
  const wtByBranch = sbLoadWorktreeBranchMap(projectRoot);
  const curBranch = runGit(projectRoot, ['branch', '--show-current']) || 'HEAD';
  const rawList = sbReadLocalBranchRefs(projectRoot);
  const defaultBranch = sbPickDefaultBranch(rawList, curBranch);
  const ctx = { defaultBranch, curBranch, wtByBranch, domainOfFile, staleDays };
  const branches = rawList.map((b) => sbInspectSingleBranch(projectRoot, b, ctx));

  sbDetectBranchCollisions(branches);

  const ORDER = { 'collision-warn': 0, dormant: 1, active: 2, trunk: 3, merged: 4 };
  branches.sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || b.ahead - a.ahead);
  return { isGit: true, defaultBranch, currentBranch: curBranch, branches };
}
