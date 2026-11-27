// 变焦驾驶舱通用宿主适配协议与零治理默认仓库索引器（零 DoneGate 专属概念，适配任意多语言代码仓库，L5）
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { walk } from '../../skill/fs-walk.mjs';
import { readJsonStrict, readMaybe } from '../../skill/io.mjs';
import {
  CK_SKIP_DIRS, discoverRepoScanDirs, kneedleElbowCount,
  listRootRegularFiles, queryCbmContractHubs, runWithSingleflightCache
} from '../core/index.mjs';

export { kneedleElbowCount };

const POLYGLOT_CODE_EXTS = new Set([
  '.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.c', '.cpp', '.h', '.cs', '.swift'
]);
const GENERIC_TEST_RE = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|_test\.(?:py|go|rs)$/i;

function apStripDocCommentBlock(lines, startIdx) {
  const first = lines[startIdx].trim();
  const isPyDoc = first.startsWith('"""') || first.startsWith("'''");
  const delim = isPyDoc ? first.slice(0, 3) : '*/';
  const body0 = (isPyDoc ? first.slice(3) : first.replace(/^\/\*+\s*/, '')).replace(/\*+\/$/, '').trim();
  if (isPyDoc && first.length > 3 && first.endsWith(delim)) {
    return first.slice(3, -3).trim();
  }
  if (!isPyDoc && first.includes('*/')) return body0;
  const parts = body0 ? [body0] : [];
  for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 12); i++) {
    const t = lines[i].trim();
    if (t.includes(delim)) {
      const pre = t.slice(0, t.indexOf(delim)).replace(/^\*\s?/, '').trim();
      if (pre) parts.push(pre);
      break;
    }
    const clean = t.replace(/^\*\s?/, '').trim();
    if (clean) parts.push(clean);
  }
  return parts.join(' ').trim();
}

export function extractFullHeaderComment(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const comments = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (i === 0 && t.startsWith('#!')) continue;
    if (comments.length === 0 && (t.startsWith('# -*-') || t.startsWith('# coding'))) continue;
    if (t.startsWith('//')) {
      comments.push(t.replace(/^\/\/+\s*/, '').trim());
    } else if (t.startsWith('#')) {
      comments.push(t.replace(/^#+\s*/, '').trim());
    } else if (comments.length === 0 && (t.startsWith('/**') || t.startsWith('"""') || t.startsWith("'''"))) {
      return apStripDocCommentBlock(lines, i);
    } else if (comments.length > 0 || t !== '') {
      break;
    }
  }
  return comments.join(' ').trim();
}

function apDetectProjectName(root) {
  const pkg = readJsonStrict(join(root, 'package.json'));
  if (pkg.ok && typeof pkg.value?.name === 'string' && pkg.value.name.trim()) return pkg.value.name.trim();
  for (const manifest of ['pyproject.toml', 'Cargo.toml']) {
    const raw = readMaybe(join(root, manifest));
    const m = raw && raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1].trim();
  }
  const goMod = readMaybe(join(root, 'go.mod'));
  const gm = goMod && goMod.match(/^\s*module\s+(\S+)/m);
  if (gm) return gm[1].trim();
  return basename(root) || 'repository';
}

function apReadGitBranches(root) {
  const cur = (spawnSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).stdout || '').trim();
  const r = spawnSync('git', ['-C', root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { encoding: 'utf8' });
  const names = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return cur ? [{ name: cur, isDefault: true, ahead: 0, behind: 0, idleDays: 0 }] : [];
  return names.map((name) => ({
    name,
    isDefault: name === 'main' || name === 'master' || (names.length === 1 && name === cur),
    ahead: 0,
    behind: 0,
    idleDays: 0
  }));
}

function apDescribeFallbackByExt(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.json' || ext === '.toml' || ext === '.yaml' || ext === '.yml') return '声明式配置清单';
  if (ext === '.py') return 'Python 源码模块';
  if (ext === '.go') return 'Go 源码模块';
  if (ext === '.rs') return 'Rust 源码模块';
  if (ext === '.ts' || ext === '.tsx') return 'TypeScript 源码模块';
  if (ext === '.cmd' || ext === '.sh') return '命令行脚本';
  return '源码模块';
}

function apCollectGenericFilesAndDomains(root) {
  const allFiles = [];
  const fileHeaders = {};
  const domains = [];
  const ownerMap = new Map();
  const topDirs = discoverRepoScanDirs(root);
  let idxNum = 0;

  const registerFile = (rel) => {
    allFiles.push(rel);
    const raw = readMaybe(join(root, rel));
    fileHeaders[rel] = (raw !== null ? extractFullHeaderComment(raw) : '') || apDescribeFallbackByExt(rel);
    return fileHeaders[rel];
  };

  for (const dir of topDirs) {
    const walked = walk(join(root, dir), { skipDirs: CK_SKIP_DIRS }).files.sort();
    const modules = [];
    for (const absF of walked) {
      const rel = absF.slice(root.length + 1).replace(/\\/g, '/');
      const fullHeader = registerFile(rel);
      modules.push({ path: rel, name: basename(rel), fullHeader, ownerContracts: [] });
    }
    if (modules.length === 0) continue;
    const step = String(++idxNum).padStart(2, '0');
    for (const m of modules) ownerMap.set(m.path, [step]);
    domains.push({
      id: dir, step, title: `${dir}/ 目录模块组`,
      contractIds: [], nextIds: [],
      codeCapsule: { moduleCount: modules.length },
      modules
    });
  }

  const rootFiles = listRootRegularFiles(root);
  if (rootFiles.length > 0) {
    const step = String(++idxNum).padStart(2, '0');
    const modules = rootFiles.map((rel) => {
      const fullHeader = registerFile(rel);
      ownerMap.set(rel, [step]);
      return { path: rel, name: rel, fullHeader, ownerContracts: [] };
    });
    domains.push({
      id: 'root', step, title: '根目录入口与配置',
      contractIds: [], nextIds: [],
      codeCapsule: { moduleCount: modules.length },
      modules
    });
  }

  return { allFiles, fileHeaders, domains, ownerMap };
}

function apExtractTestCases(raw, ext) {
  if (ext === '.py') {
    return [...raw.matchAll(/^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]).slice(0, 10);
  }
  if (ext === '.go') {
    return [...raw.matchAll(/^\s*func\s+(Test[A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]).slice(0, 10);
  }
  return [...raw.matchAll(/\b(?:describe|test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]).slice(0, 10);
}

export function inferTestRunCommand(rel) {
  if (/\.py$/i.test(rel)) return `pytest ${rel}`;
  if (/_test\.go$/i.test(rel)) return `go test ./${rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'}`;
  if (/_test\.rs$/i.test(rel)) return 'cargo test';
  if (/\.(?:test|spec)\.[a-z0-9]+$/i.test(rel)) return `npx vitest run ${rel}`;
  return `node ${rel}`;
}

function apCollectGenericTestSummaries(root, allFiles) {
  const summaries = [];
  for (const rel of allFiles) {
    if (!GENERIC_TEST_RE.test(rel)) continue;
    const ext = extname(rel).toLowerCase();
    if (!POLYGLOT_CODE_EXTS.has(ext)) continue;
    const raw = readMaybe(join(root, rel));
    if (raw === null) continue;
    const cases = apExtractTestCases(raw, ext);
    const header = extractFullHeaderComment(raw) || cases[0] || '自动化测试套件';
    summaries.push({ file: rel, header, cases, runCmd: inferTestRunCommand(rel) });
  }
  return summaries;
}

function apEstimateSourceTokens(root, allFiles) {
  let bytes = 0;
  for (const f of allFiles) {
    if (!POLYGLOT_CODE_EXTS.has(extname(f).toLowerCase())) continue;
    try { bytes += statSync(join(root, f)).size; } catch { /* ignore */ }
  }
  return Math.ceil(bytes / 4);
}

function apDetectLanguages(allFiles) {
  const counts = new Map();
  for (const f of allFiles) {
    const ext = extname(f).toLowerCase();
    if (!POLYGLOT_CODE_EXTS.has(ext)) continue;
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function apComputeGenericIndex(root, cliPrefix) {
  const gitHead = (spawnSync('git', ['-C', root, 'log', '-1', '--format=%h (%cs) %s'], { encoding: 'utf8' }).stdout || '').trim() || 'uncommitted';
  const projectName = apDetectProjectName(root);
  const branches = apReadGitBranches(root);
  const { allFiles, fileHeaders, domains, ownerMap } = apCollectGenericFilesAndDomains(root);
  const groupIds = domains.map((d) => d.step);
  const codeModuleCount = allFiles.filter((f) => POLYGLOT_CODE_EXTS.has(extname(f).toLowerCase())).length;
  const testSummaries = apCollectGenericTestSummaries(root, allFiles);
  return {
    adapterId: 'generic',
    cliPrefix,
    root,
    gitHead,
    atlas: { project: { name: projectName, moduleCount: codeModuleCount || allFiles.length }, branches },
    graph: { topoOrder: [], sccCycles: [], nodes: [] },
    gaps: [],
    hasDecisionsDir: false,
    hasThresholdsFile: false,
    fallbackSourceTokens: apEstimateSourceTokens(root, allFiles),
    domains,
    adrs: [],
    hubs: queryCbmContractHubs(root, ownerMap, groupIds, true),
    liveMeta: {
      languages: apDetectLanguages(allFiles),
      totalFiles: allFiles.length,
      workflows: [],
      annotatedSubpacks: {},
      archetypes: [],
      testSummaries
    },
    fileHeaders
  };
}

function apFormatGenericHubItems(h, fallbackCmd) {
  if (!h) return '—';
  const items = [
    ...h.selectedCross.map((s) => `\`${s.signature}\`[跨${s.crossContracts.length}组/${s.extFiles}文件]`),
    ...h.selectedIntra.map((s) => `\`${s.signature}\`[组内${s.extFiles}文件]`)
  ];
  if (items.length > 0) return items.join(' · ');
  return h.uniformCross ? `（${h.crossTotal} 个等权导出各被引 1 次；查明细：\`${fallbackCmd}\`）` : '（独立叶子组，无跨组被调函数）';
}

function apRenderGenericBriefMarkdown(idx, cbm) {
  const cli = idx.cliPrefix;
  const cbmLine = cbm.available
    ? `> 代码图谱引擎：\`${cbm.engine}\` 持久化 SQLite 已就绪（节点 \`${cbm.totalNodes.toLocaleString()}\` 个 · 关系边 \`${cbm.totalEdges.toLocaleString()}\` 条 · 函数 \`${cbm.byLabel.Function || 0}\` 个 · 路由 \`${cbm.byLabel.Route || 0}\` 条）`
    : '> 代码图谱引擎：未检测到 `codebase-memory-mcp` 二进制（安装后可激活 PPR 任务定位与符号骨架，当前可直接用 `--source` 按行直读源码）';
  const langs = Object.entries(idx.liveMeta.languages || {}).map(([k, v]) => `${k}(${v})`).join(', ') || '通用文本';
  const z0 = [
    `# ${idx.atlas.project.name} · 代码仓库变焦驾驶舱（Zoom-0 · 全局拓扑根视口）`,
    `> HEAD：\`${idx.gitHead}\` | 语言分布：\`${langs}\``,
    `> 规模对账：源码模块 \`${idx.atlas.project.moduleCount}\` 个（受管文件合计 \`${idx.liveMeta.totalFiles}\` 项 · 测试套件 \`${idx.liveMeta.testSummaries.length}\` 个）| 去重函数名 \`${idx.hubs.uniqueSymbolCount}\` 个 | 全仓源码约 \`${idx.fallbackSourceTokens.toLocaleString()} tok\``,
    cbmLine,
    '> **三步按需变焦寻路（禁盲扫全仓或盲目 grep；支持单条命令并列传多目标）**：',
    `> 1. **第一步 · 任务语义直达定位（FTS5 种子 + 入度阻尼 PPR）**：\`${cli} locate "<任务描述>" [--budget 4000]\``,
    `> 2. **目录组缩圈与测试清单（Zoom-1）**：\`${cli} zoom <组编号 01..N|all|rules|tests>\``,
    `> 3. **第二步 · 骨架压缩与双向 2-Hop 调用链（Zoom-2）**：\`${cli} zoom <相对文件路径 | 符号名> [--skeleton]\``,
    `> 4. **跨文件波及面与多跳（≤3 跳）测试反查**：\`${cli} impact <文件|符号|路由|配置文件>\``,
    `> 5. **第三步 · 最后一步按行直读真实源码**：\`${cli} zoom <文件路径[:起-止] | 符号名> --source\``,
    '',
    '## 1. 顶层目录模块组总览'
  ];
  for (const sn of idx.domains) {
    const sampleMods = (sn.modules || []).slice(0, 4).map((m) => `\`${m.name}\``).join(', ');
    const more = (sn.modules || []).length > 4 ? ` 等 ${sn.modules.length} 项` : `（共 ${sn.modules?.length || 0} 项）`;
    z0.push(`- **[${sn.step}] ${sn.title}**：代表文件 ${sampleMods}${more} | 展开：\`${cli} zoom ${sn.step}\``);
  }
  const hubLines = [];
  for (const sn of idx.domains) {
    const h = idx.hubs.hubsByDomain[sn.step];
    if (h && h.totalExported > 0) {
      hubLines.push(`- **[${sn.step}] ${sn.title}**（导出符号 \`${h.totalExported}\` 个）：${apFormatGenericHubItems(h, `${cli} zoom ${sn.step}`)}`);
    }
  }
  if (hubLines.length > 0) {
    z0.push('', '## 2. 跨模块承重接口（CBM 调用图 + Kneedle 曲率拐点）', ...hubLines);
  }
  return z0.join('\n') + '\n';
}

export function createGenericCockpitAdapter(opts = {}) {
  const cliPrefix = opts.cliPrefix || 'node runner/cockpit/cli.mjs';
  return {
    id: 'generic',
    cliPrefix,
    mcpServerName: opts.mcpServerName || 'zoom-cockpit',
    mcpToolPrefix: opts.mcpToolPrefix ?? '',
    brandName: opts.brandName || 'Zoom Cockpit',
    buildIndex(projectRoot) {
      const root = resolve(projectRoot);
      return runWithSingleflightCache(root, '', () => apComputeGenericIndex(root, cliPrefix), 'generic');
    },
    renderBriefMarkdown: apRenderGenericBriefMarkdown,
    renderRulesTopic(idx) {
      return JSON.stringify({
        mode: 'generic-repository',
        project: idx.atlas.project.name,
        languages: idx.liveMeta.languages,
        moduleCount: idx.atlas.project.moduleCount,
        testCount: idx.liveMeta.testSummaries.length,
        domains: idx.domains.map((d) => ({ step: d.step, id: d.id, count: d.codeCapsule?.moduleCount || 0 }))
      }, null, 2);
    }
  };
}

export const GENERIC_COCKPIT_ADAPTER = createGenericCockpitAdapter();
