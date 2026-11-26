import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProjectAtlas } from '../runner/atlas/assemble-atlas.mjs';
import { renderAtlasWorkbenchHtml } from '../runner/atlas/render-html.mjs';
import { WB_PRESET_BLOCK_TEMPLATES } from '../runner/atlas/wb-catalog.mjs';
import { createDoneGateWebRouteHandler } from '../runner/dsh/host/host-routes.mjs';
import { listAtomicBrickCatalog, loadCandidateWorkflowMacros } from '../runner/dsh/autopilot/workflow-jit.mjs';
import { mutateUiLayoutBlocks, renderPrototypeHtml } from '../runner/dsh/uiboard/ui-board-engine.mjs';
import { executeDeterministicWorkflowRun } from '../runner/dsh/autopilot/workflow-runner.mjs';
import { AUTOPILOT_STATES } from '../runner/dsh/autopilot/autopilot-state.mjs';
import { scanTerminologyViolations } from '../skill/check-terminology.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function makeTempGitDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, '.gitignore'), '.donegate/\nworkflows/.deps/\n', 'utf8');
  writeFileSync(join(dir, 'index.mjs'), 'export const ok = 1;\n', 'utf8');
  spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@donegate.local']);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'DoneGate Test']);
  spawnSync('git', ['-C', dir, 'add', 'index.mjs', '.gitignore']);
  spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  return dir;
}

function r2TestHasDirectedCycle(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    const nd = byId.get(id);
    for (const nxt of (nd?.nextIds || [])) {
      if (state.get(nxt) === 1) return true;
      if (!state.get(nxt) && visit(nxt)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const n of nodes) {
    if (!state.get(n.id) && visit(n.id)) return true;
  }
  return false;
}

describe('DoneGate 第二轮与第三轮工作台问题单回归验证', () => {
  const atlas = buildProjectAtlas(REPO_ROOT);
  const html = renderAtlasWorkbenchHtml(atlas);

  it('问题 #1 & #5：所有预置与注册节点去除开头重复工具名、符合短用途标题预算，且端口/插槽零生硬黑话', () => {
    const toolPrefixRe = /^(?:Biome|Gradle|Maestro|Playwright|Gitleaks|OpenSpec|k6|Vale|Lychee|Git-Cliff|Flagger|Srclight|Beads|SQLFluff|Flyway|Atlas|Spectral|Pyright|Ruff|Schemathesis|Hurl|Storybook|Lighthouse|Typos|DepCruise|CodeGraph|Stryker|Actionlint|Syft|OSV|Trivy|Semgrep|Diffuse)\b/i;
    const jargonRe = /0-3|P95|P99|\bAST\b|SARIF|SBOM|CycloneDX|SAST|\bDOM\b|Console|stdout|JSONL|promisor|\bLCP\b|\bCLS\b|\bDDL\b|Schema|Fuzz|\bCVE\b|P0-P3|SHA-256|Breaking Changes|[0123]\s*号口|2\/3\s*号口/i;

    const bricks = [...listAtomicBrickCatalog(REPO_ROOT).values()];
    const regTpls = atlas.workbench.registeredTemplates;
    const wfNodes = readdirSync(join(REPO_ROOT, 'workflows'))
      .filter((f) => f.endsWith('.workflow.json'))
      .flatMap((f) => JSON.parse(readFileSync(join(REPO_ROOT, 'workflows', f), 'utf8')).nodes);

    for (const item of [...bricks, ...regTpls, ...wfNodes]) {
      expect(toolPrefixRe.test(item.title), `重复工具名前缀: ${item.title}`).toBe(false);
      expect(item.title.length).toBeGreaterThanOrEqual(4);
      expect(item.title.length).toBeLessThanOrEqual(12);
      for (const p of [...(item.inputs || []), ...(item.outputs || [])]) {
        expect(jargonRe.test(p.name), `端口含黑话: ${item.title} -> ${p.name}`).toBe(false);
      }
      for (const s of (item.slots || [])) {
        expect(jargonRe.test(s.label), `插槽含黑话: ${item.title} -> ${s.label}`).toBe(false);
      }
    }
  });

  it('问题 #2, #8, #9, #10：工作流派生简化为三档白话场景、清理右侧栏误导文案、硬化工作流术语门禁并移除UI看板常驻绿点', () => {
    expect(html).toContain('data-jit-preset="auto"');
    expect(html).toContain('data-jit-preset="fullstack"');
    expect(html).toContain('data-jit-preset="release"');
    expect(html).toContain('<details class="dg-jit-adv"');

    expect(html.includes('右侧栏')).toBe(false);
    expect(html.includes('右栏')).toBe(false);
    expect(html).toContain('点上方「❝ 引用」或按住 Alt+单击发到对话栏，让子代理接入组件');

    const uiboardBtnMatch = html.match(/<button[^>]*data-rail-tab="uiboard"[\s\S]*?<\/button>/);
    expect(uiboardBtnMatch).not.toBeNull();
    expect(uiboardBtnMatch[0]).not.toContain('#16a34a');

    const { macros } = loadCandidateWorkflowMacros(REPO_ROOT);
    expect(macros.get('pack-web')?.name).toBe('网页全栈工作流');
    expect(macros.get('pack-core-logic')?.name).toBe('核心纯逻辑工作流');
    expect(macros.get('pack-release')?.name).toBe('上线安全工作流');
    expect(macros.get('pack-api-guard')?.name).toBe('接口与密钥工作流');
    expect(macros.get('pack-android')?.name).toBe('安卓应用工作流');
    expect(html).toContain('id="btn-open-save-pack"');

    const repoTermRes = scanTerminologyViolations(REPO_ROOT);
    expect(repoTermRes.exitCode).toBe(0);

    const tmp = mkdtempSync(join(tmpdir(), 'dg-r2-term-'));
    try {
      mkdirSync(join(tmp, 'runner'), { recursive: true });
      const bannedWords = ['开发', '护栏', '守护', '联防', '新开发', '工作流', '预设'].map((w) => w + '包');
      writeFileSync(join(tmp, 'runner/bad.mjs'), `export const a = ${JSON.stringify(bannedWords)};\n`, 'utf8');
      writeFileSync(join(tmp, 'runner/good.mjs'), 'export const b = ["APK 安装包", "发行包", "源码包", "复核包", "交接包", "压缩包", "工作流包含"];\n', 'utf8');
      const checkRes = scanTerminologyViolations(tmp);
      expect(checkRes.exitCode).toBe(1);
      expect(checkRes.violations.every((v) => v.file === 'runner/bad.mjs')).toBe(true);
      expect(checkRes.violations[0].matches.length).toBe(7);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('第三轮问题 #1 & 第四轮问题 #6：零魔法数字模块度自适应非均衡聚合（简单分支直出叶卡零空壳，复杂簇递归折叠子图，代码透视层完整保留无环 DAG）', () => {
    const topBizNodes = atlas.workbench.hostSandbox.nodes;
    expect(topBizNodes.length).toBeGreaterThanOrEqual(2);
    expect(r2TestHasDirectedCycle(topBizNodes)).toBe(false);
    // 非均衡检验：既包含模块度 ΔQ > 0 自动收拢的复杂业务子流，也允许独立叶卡同台并列（严禁单节点空套壳！）
    const topSubgraphs = topBizNodes.filter((n) => n.isSubgraph === true);
    expect(topSubgraphs.length).toBeGreaterThan(0);
    const topById = new Map(topBizNodes.map((n) => [n.id, n]));
    for (const bnd of topBizNodes) {
      for (const tid of (bnd.nextIds || [])) {
        const bdst = topById.get(tid);
        expect(bdst, `业务层目标节点存在: ${tid}`).toBeDefined();
        expect(bnd.x).toBeLessThan(bdst.x);
      }
    }
    for (const sg of topSubgraphs) {
      expect(sg.subgraph.nodes.length).toBeGreaterThanOrEqual(2);
    }

    const hostNodes = atlas.workbench.hostSandbox.codeUnitNodes;
    const byId = new Map(hostNodes.map((n) => [n.id, n]));
    expect(hostNodes.length).toBeGreaterThanOrEqual(10);
    expect(hostNodes.length).toBeLessThanOrEqual(20);
    expect(r2TestHasDirectedCycle(hostNodes)).toBe(false);

    const rootNode = byId.get('host-dom-root');
    const runnerNode = byId.get('host-dom-runner');
    const toolsNode = byId.get('host-dom-tools');
    expect(rootNode).toBeDefined();
    expect(runnerNode).toBeDefined();
    if (existsSync(join(REPO_ROOT, 'tools'))) expect(toolsNode).toBeDefined();
    expect(rootNode.nextIds.length).toBeGreaterThan(0);

    for (const nd of hostNodes) {
      for (const tid of nd.nextIds) {
        const dst = byId.get(tid);
        expect(dst, `目标节点存在: ${tid}`).toBeDefined();
        expect(dst.nextIds).not.toContain(nd.id);
        expect(nd.x).toBeLessThan(dst.x);
      }
      if (nd.id.startsWith('host-dom-skill-')) {
        expect(nd.nextIds.some((id) => id.startsWith('host-dom-runner') || id.startsWith('host-dom-core-'))).toBe(false);
      }
    }

    const smallDir = mkdtempSync(join(tmpdir(), 'dg-r3-small-'));
    try {
      mkdirSync(join(smallDir, 'src/ui'), { recursive: true });
      mkdirSync(join(smallDir, 'src/api'), { recursive: true });
      mkdirSync(join(smallDir, 'src/core'), { recursive: true });
      writeFileSync(join(smallDir, 'src/core/ledger.mjs'), '// 账本核心\nexport function calc() { return 1; }\n', 'utf8');
      writeFileSync(join(smallDir, 'src/api/orders.mjs'), '// 订单接口\nimport { calc } from "../core/ledger.mjs";\nexport function postOrder() { return calc(); }\n', 'utf8');
      writeFileSync(join(smallDir, 'src/ui/checkout.mjs'), '// 结账界面\nimport { postOrder } from "../api/orders.mjs";\nexport function view() { return postOrder(); }\n', 'utf8');
      spawnSync('git', ['-C', smallDir, 'init', '-q', '-b', 'main']);
      const smallAtlas = buildProjectAtlas(smallDir);
      const smallNodes = smallAtlas.workbench.hostSandbox.nodes;
      expect(smallAtlas.modules.length).toBe(3);
      expect(smallNodes.length).toBe(3);
      expect(smallNodes.every((n) => n.modules.length === 1)).toBe(true);
      expect(r2TestHasDirectedCycle(smallNodes)).toBe(false);
      const uiCard = smallNodes.find((n) => n.sublinePath === 'src/ui/checkout.mjs');
      const apiCard = smallNodes.find((n) => n.sublinePath === 'src/api/orders.mjs');
      const coreCard = smallNodes.find((n) => n.sublinePath === 'src/core/ledger.mjs');
      expect(uiCard.nextIds).toContain(apiCard.id);
      expect(apiCard.nextIds).toContain(coreCard.id);
    } finally {
      rmSync(smallDir, { recursive: true, force: true });
    }

    expect(html).toContain('data-action="toggle-sb-expand" data-node="${esc(node.id)}" data-stop-drag="1"');
    expect(html).toContain('nd.expanded = !nd.expanded; if (nd.expanded) nd.h = null;');
  });

  it('第三轮问题 #2：节点库预置模板与注册适配器根因去重，gitleaks 等同源节点全局唯一零重影', () => {
    const presets = Object.values(WB_PRESET_BLOCK_TEMPLATES).filter((t) => !t.isBlank);
    const merged = [...presets, ...atlas.workbench.registeredTemplates];
    const seenIds = new Set();
    const seenSlugs = new Set();
    const seenTitles = new Set();

    for (const tpl of merged) {
      expect(seenIds.has(tpl.tplId), `重复 tplId: ${tpl.tplId}`).toBe(false);
      seenIds.add(tpl.tplId);
      const slug = String(tpl.repoSlug || '').trim().toLowerCase();
      if (slug) {
        expect(seenSlugs.has(slug), `重复开源仓库节点: ${slug}`).toBe(false);
        seenSlugs.add(slug);
      }
      const title = String(tpl.title || '').trim();
      expect(seenTitles.has(title), `重复节点标题: ${title}`).toBe(false);
      seenTitles.add(title);
    }

    const gitleaksItems = merged.filter((t) => String(t.repoSlug || '').toLowerCase() === 'gitleaks/gitleaks' || t.title === '密钥密码防泄漏');
    expect(gitleaksItems.length).toBe(1);
    expect(gitleaksItems[0].tplId).toBe('tpl-gitleaks');
  });

  it('第三轮问题 #13：「👁 观测」改为「📄 检查记录」，且空沙盒请求 /observation-preview 100% 落盘返回真实存在文件', async () => {
    expect(html).not.toContain('👁 观测');
    expect(html).toContain('📄 检查记录');
    expect(html).toContain('data-action="preview-node-obs"');
    expect(html).toContain('查看该节点的最近一次检查报告；尚未运行时可查看检查规则与适配器源码');

    const emptyRoot = makeTempGitDir('dg-r3-obsprev-');
    const handler = createDoneGateWebRouteHandler(emptyRoot);
    const srv = createServer(async (req, res) => {
      const ok = await handler(req, res, req.url || '/');
      if (!ok) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const r1 = await fetch(`http://127.0.0.1:${port}/observation-preview?tool=gitleaks-secrets&nodeId=ag-2`);
      const j1 = await r1.json();
      expect(r1.status).toBe(200);
      expect(j1.ok).toBe(true);
      expect(j1.sourcePath).toBe('.donegate/previews/gitleaks-record.md');
      const absFile = join(emptyRoot, j1.sourcePath);
      expect(existsSync(absFile)).toBe(true);
      const diskText = readFileSync(absFile, 'utf8');
      expect(diskText).toContain('密钥密码防泄漏');
      expect(diskText).toContain('当前尚未在本项目中运行过');
      expect(diskText).toContain('bricks/gitleaks/capabilities.json');
      expect(diskText).toContain('skill/adapters/gitleaks-scan.mjs');

      const rFile = await fetch(`http://127.0.0.1:${port}/file-preview?path=${encodeURIComponent(j1.sourcePath)}`);
      const jFile = await rFile.json();
      expect(rFile.status).toBe(200);
      expect(jFile.ok).toBe(true);
      expect(jFile.content).toContain('密钥密码防泄漏');
    } finally {
      srv.close();
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('问题 #4 & #6：07 发布流补齐 rel-perf-router 降级挂起与 rel-docs-audit 死链错词裁决回修真实闭环', async () => {
    const pack07 = JSON.parse(readFileSync(join(REPO_ROOT, 'workflows/07-perf-docs-and-canary-release.workflow.json'), 'utf8'));
    const nodeIds = new Set(pack07.nodes.map((n) => n.id));
    expect(nodeIds.has('rel-docs-router')).toBe(true);

    for (const nd of pack07.nodes) {
      if (nd.id === 'rel-canary-snapshot') continue;
      for (const out of nd.outputs) {
        const wired = pack07.links.some((l) => l.fromNode === nd.id && l.fromSlot === out.id);
        expect(wired, `07 节点 ${nd.id}.${out.id} 不得悬空`).toBe(true);
      }
    }

    const tmp = makeTempGitDir('dg-r2-wf07-');
    try {
      const envFaultPack = JSON.parse(JSON.stringify(pack07));
      envFaultPack.nodes.find((n) => n.id === 'rel-k6-probe').exec = { nodeArgs: ['-e', 'process.exit(3)'] };
      const rEnv = await executeDeterministicWorkflowRun(REPO_ROOT, {
        ticketId: 'r2-wf07-env',
        worktreePath: tmp
      }, envFaultPack, { enforceDeps: false, useFingerprintCache: false, maxConsecEnvFaults: 3 });
      expect(rEnv.suspended).toBe(true);
      expect(rEnv.state).toBe(AUTOPILOT_STATES.SUSPENDED_HUMAN_GATE);
      expect(rEnv.pendingHumanGate?.nodeId).toBe('rel-human-gate');

      const docFailPack = JSON.parse(JSON.stringify(pack07));
      docFailPack.nodes.find((n) => n.id === 'rel-k6-probe').exec = { nodeArgs: ['-e', 'process.exit(0)'] };
      docFailPack.nodes.find((n) => n.id === 'rel-docs-audit').exec = { nodeArgs: ['-e', 'console.error("检出 2 处死链"); process.exit(1)'] };
      const rDoc = await executeDeterministicWorkflowRun(REPO_ROOT, {
        ticketId: 'r2-wf07-doc',
        worktreePath: tmp
      }, docFailPack, { enforceDeps: false, useFingerprintCache: false });
      expect(rDoc.ok).toBe(false);
      expect(rDoc.code).toBe('MAX_LOOPS_EXCEEDED');
      rmSync(join(REPO_ROOT, '.donegate', 'runs', 'r2-wf07-env'), { recursive: true, force: true });
      rmSync(join(REPO_ROOT, '.donegate', 'runs', 'r2-wf07-doc'), { recursive: true, force: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('问题 #12：美学方案 A / B / C 产出真实异构的 DOM 骨架、导航形态、字体阶梯与卡片数量分布', () => {
    const tmp = makeTempGitDir('dg-r2-uib-');
    try {
      mutateUiLayoutBlocks(tmp, { op: 'noop' });
      const countCards = (s) => (s.match(/class="[^"]*\bui-surface-card\b/g) || []).length;
      const protoA = renderPrototypeHtml(tmp, { proposalId: 'swiss-minimal' });
      const protoB = renderPrototypeHtml(tmp, { proposalId: 'bento-craft' });
      const protoC = renderPrototypeHtml(tmp, { proposalId: 'industrial-dark' });

      expect(protoA.archetype).toBe('editorial-asymmetric');
      expect(protoB.archetype).toBe('tactile-bento');
      expect(protoC.archetype).toBe('cockpit-split');

      expect(protoA.html).toContain('class="ed-masthead"');
      expect(protoA.html).toContain('Georgia');
      expect(countCards(protoA.html)).toBe(3);

      expect(protoB.html).toContain('class="bt-pill-island"');
      expect(protoB.html).toContain('bt-grid');
      expect(countCards(protoB.html)).toBe(6);

      expect(protoC.html).toContain('class="ck-icon-rail"');
      expect(protoC.html).toContain('class="ck-telemetry-bar"');
      expect(protoC.html).toContain('<polyline');
      expect(countCards(protoC.html)).toBe(8);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
