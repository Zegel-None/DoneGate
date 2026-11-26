// 工作区新建项目初始化与外部陈旧项目测绘导入模块（持久化至 .donegate/workbench-state.json 的 importedSandboxes）
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, parse, resolve } from 'node:path';
import { buildDashboardPayload, exportDashboardHtml } from '../../atlas/dashboard.mjs';
import { readSavedWorkbenchState } from '../../shared/workbench-state.mjs';

function buildInitialIntentMarkdown(projectName) {
  return [
    `# ${projectName} · 项目意图与验收边界 (INTENT.md)`,
    '',
    '## 1. 核心目标',
    `- 建立 ${projectName} 的模块化工程结构与确定性完结门验收闭环。`,
    '',
    '## 2. 成功判据',
    '- 核心模块均具备可机械复算的契约判据且退出码为 0。',
    '',
    '## 3. 长期约束',
    '- 严禁空壳占位符、静默吞异常与越界写入非授权目录。',
    ''
  ].join('\n');
}

export function initWorkspaceProject(projectRoot) {
  const root = resolve(projectRoot);
  const dgDir = join(root, '.donegate');
  mkdirSync(dgDir, { recursive: true });
  mkdirSync(join(root, 'contracts'), { recursive: true });

  const intentPath = join(root, 'INTENT.md');
  const createdIntent = !existsSync(intentPath);
  if (createdIntent) {
    const projectName = basename(root) || 'Project';
    writeFileSync(intentPath, buildInitialIntentMarkdown(projectName), 'utf8');
  }

  exportDashboardHtml(root, join(dgDir, 'dashboard.html'));
  const atlas = buildDashboardPayload(root);
  return {
    status: 200,
    body: {
      ok: true,
      createdIntent,
      atlas
    }
  };
}

export function importExternalProject(projectRoot, rawTargetDir) {
  const root = resolve(projectRoot);
  const targetStr = String(rawTargetDir || '').trim();
  if (!targetStr) {
    return { status: 400, body: { ok: false, error: '缺少外部项目目录参数 targetDir' } };
  }

  const absTarget = resolve(root, targetStr);
  if (parse(absTarget).root === absTarget) {
    return { status: 400, body: { ok: false, error: '安全限制：禁止直接导入系统根目录或整个盘符' } };
  }
  let isDir = false;
  if (existsSync(absTarget)) {
    try {
      isDir = statSync(absTarget).isDirectory();
    } catch (err) {
      void err;
    }
  }
  if (!isDir) {
    return { status: 400, body: { ok: false, error: `外部项目目录不存在或不是有效文件夹：${targetStr}` } };
  }

  const extAtlas = buildDashboardPayload(absTarget);
  const hostSb = extAtlas?.workbench?.hostSandbox || {};
  const rawName = extAtlas?.project?.name || basename(absTarget) || 'imported-project';
  const slug = String(rawName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'external';

  const sandbox = {
    id: `imp-${slug}`,
    name: rawName,
    repoSlug: hostSb.repoSlug || `local/${rawName}`,
    isHost: false,
    readonly: false,
    importedFrom: absTarget,
    tip: extAtlas?.project?.summary || `外部项目导入（${absTarget}）`,
    nodes: Array.isArray(hostSb.nodes) ? hostSb.nodes : [],
    groups: Array.isArray(hostSb.groups) ? hostSb.groups : []
  };

  const st = readSavedWorkbenchState(root);
  const prevMap = Array.isArray(st.importedSandboxes)
    ? Object.fromEntries(st.importedSandboxes.filter((item) => item && item.id).map((item) => [item.id, item]))
    : (st.importedSandboxes && typeof st.importedSandboxes === 'object' ? { ...st.importedSandboxes } : {});
  prevMap[sandbox.id] = sandbox;
  const importedSandboxes = Object.values(prevMap);
  st.importedSandboxes = prevMap;
  st.updatedAt = new Date().toISOString();

  mkdirSync(join(root, '.donegate'), { recursive: true });
  writeFileSync(join(root, '.donegate', 'workbench-state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');

  return {
    status: 200,
    body: {
      ok: true,
      sandbox,
      importedSandboxes
    }
  };
}
