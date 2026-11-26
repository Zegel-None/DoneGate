// 确定性节点输入材料指纹免跑缓存（#06：输入 scope 与命令参数未变且上次 exitCode===0 时毫秒级免跑跳过）
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { materialFingerprintOf, sha256 } from '../../../skill/hash.mjs';
import { readJsonStrict } from '../../../skill/io.mjs';
import { walkByExt } from '../../../skill/fs-walk.mjs';
import { normalizeSlashes } from './win-paths.mjs';

const CACHE_REL = '.donegate/cache/node-fingerprints.json';
const DEFAULT_EXTS = ['.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.json', '.py', '.go', '.rs', '.md', '.yml', '.yaml'];

function collectScopeFiles(workCwd, watchPaths) {
  const cwd = resolve(workCwd);
  const rawScopes = Array.isArray(watchPaths) && watchPaths.length > 0
    ? watchPaths
    : ['src/', 'runner/', 'skill/', 'contracts/', 'tests/', 'package.json', 'thresholds.json'];
  const relFiles = new Set();

  for (const raw of rawScopes) {
    const clean = normalizeSlashes(String(raw || '').trim()).replace(/^\.\//, '');
    if (!clean) continue;
    const target = resolve(cwd, clean);
    if (!existsSync(target)) continue;
    if (clean.endsWith('/') || !/\.[a-z0-9]+$/i.test(clean)) {
      for (const abs of walkByExt(target, DEFAULT_EXTS)) {
        const rel = normalizeSlashes(abs.slice(cwd.length)).replace(/^\/+/, '');
        if (!rel.startsWith('.donegate/') && !rel.startsWith('node_modules/') && !rel.startsWith('.git/')) {
          relFiles.add(rel);
        }
      }
    } else {
      relFiles.add(clean);
    }
  }
  return [...relFiles].sort();
}

export function computeNodeRunFingerprint(workCwd, node, args) {
  const cwd = resolve(workCwd);
  const strInputs = Array.isArray(node?.inputs) ? node.inputs.filter((x) => typeof x === 'string' && x.trim()) : [];
  const watchPaths = strInputs.length > 0
    ? strInputs
    : (Array.isArray(node?.exec?.watchPaths) ? node.exec.watchPaths.filter((x) => typeof x === 'string' && x.trim()) : []);
  const files = collectScopeFiles(cwd, watchPaths);
  const matEntries = files.map((rel) => ({
    path: rel,
    sha256: sha256(readFileSync(join(cwd, rel)))
  }));
  const matFp = materialFingerprintOf(matEntries);
  const cmdSig = sha256(JSON.stringify({
    nodeId: node?.id || '',
    tplId: node?.tplId || '',
    args: (args || []).map((a) => normalizeSlashes(String(a)))
  }));
  return {
    key: `${node?.id || 'node'}::${cmdSig.slice(0, 16)}`,
    fingerprint: sha256(`${cmdSig}::${matFp}`),
    watchedCount: files.length
  };
}

export function lookupFingerprintCache(projectRoot, workCwd, node, args) {
  const fp = computeNodeRunFingerprint(workCwd, node, args);
  if (fp.watchedCount === 0) return { hit: false, entry: null, fp };
  const cachePath = join(resolve(projectRoot), CACHE_REL);
  if (!existsSync(cachePath)) return { hit: false, entry: null, fp };
  const parsed = readJsonStrict(cachePath);
  const entries = (parsed.ok && parsed.value && parsed.value.entries) || {};
  const prev = entries[fp.key];
  if (prev && prev.fingerprint === fp.fingerprint && prev.exitCode === 0 && Number(prev.watchedCount || 0) > 0) {
    return { hit: true, entry: prev, fp };
  }
  return { hit: false, entry: null, fp };
}

export function recordFingerprintCache(projectRoot, fp, meta = {}) {
  if (!fp || !fp.key || !fp.fingerprint || Number(fp.watchedCount || 0) === 0) return;
  const cachePath = join(resolve(projectRoot), CACHE_REL);
  mkdirSync(dirname(cachePath), { recursive: true });
  const parsed = existsSync(cachePath) ? readJsonStrict(cachePath) : { ok: false };
  const doc = (parsed.ok && parsed.value && typeof parsed.value === 'object') ? parsed.value : { version: '1.0', entries: {} };
  if (!doc.entries || typeof doc.entries !== 'object') doc.entries = {};
  doc.entries[fp.key] = {
    fingerprint: fp.fingerprint,
    watchedCount: fp.watchedCount,
    exitCode: 0,
    durationMs: Number(meta.durationMs || 0),
    diagSummary: String(meta.diagSummary || '').slice(0, 240),
    cachedAt: new Date().toISOString()
  };
  const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, cachePath);
}
