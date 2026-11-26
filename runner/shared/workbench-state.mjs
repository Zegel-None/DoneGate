// L0 共享工作台持久化状态读取原语（零 UI/Atlas/DSH 反向依赖，供工作台与宿主编排层单向复用）
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../skill/io.mjs';

export function defaultSavedState() {
  return {
    schemaVersion: '1.0',
    hostLayoutVer: 3,
    customPacks: {},
    importedSandboxes: {},
    componentWorkflows: {},
    hostNodeLayouts: {},
    hostGroups: [],
    hostSubgraphs: [],
    collapsedWfGroups: [],
    collapsedNodeCats: [],
    workshopOverrides: {},
    textOverrides: {},
    textStyles: {},
    controlStyles: {},
    starredRepos: ['mobile-dev-inc/Maestro', 'biomejs/biome'],
    updatedAt: null
  };
}

function wbNormalizeImportedSandboxes(rawVal) {
  if (Array.isArray(rawVal)) {
    return Object.fromEntries(rawVal.filter((x) => x && x.id).map((x) => [x.id, x]));
  }
  return rawVal && typeof rawVal === 'object' ? rawVal : {};
}

function wbStripLegacyHostLayoutCoords(rawLayouts) {
  const cleaned = {};
  for (const [k, v] of Object.entries(rawLayouts || {})) {
    if (!v || typeof v !== 'object') continue;
    const { x: _x, y: _y, expanded: _exp, ...rest } = v;
    void _x;
    void _y;
    void _exp;
    cleaned[k] = rest;
  }
  return cleaned;
}

function wbNormalizeLegacyWorkflowNames(componentWorkflows) {
  if (!componentWorkflows || typeof componentWorkflows !== 'object') return;
  for (const b of Object.values(componentWorkflows)) {
    if (b && typeof b.baseName === 'string') {
      b.baseName = b.baseName.replace(/护栏包|开发包|开发流/g, '工作流'); // dg-term-allow: 清洗历史落盘旧名
    }
  }
}

export function readSavedWorkbenchState(projectRoot) {
  const p = join(resolve(projectRoot), '.donegate', 'workbench-state.json');
  if (!existsSync(p)) return defaultSavedState();
  const r = readJsonStrict(p);
  if (!r.ok || !r.value || typeof r.value !== 'object') return defaultSavedState();
  const merged = { ...defaultSavedState(), ...r.value };
  merged.importedSandboxes = wbNormalizeImportedSandboxes(merged.importedSandboxes);
  if (r.value.hostLayoutVer !== 3 && merged.hostNodeLayouts && typeof merged.hostNodeLayouts === 'object') {
    merged.hostNodeLayouts = wbStripLegacyHostLayoutCoords(merged.hostNodeLayouts);
    merged.hostLayoutVer = 3;
  }
  wbNormalizeLegacyWorkflowNames(merged.componentWorkflows);
  return merged;
}
