// Atlas 无限画布工作台数据组装、水合、五大功能子包清单与单文件渲染契约门面（零 HTTP 服务层循环依赖）
export { buildProjectAtlas, writeAtlasSidecars } from './assemble-atlas.mjs';
export { renderAtlasWorkbenchHtml, WB_CONCAT_MANIFEST } from './render-html.mjs';
export { hydrateWorkbenchData, readSavedWorkbenchState } from './hydrate-workbench.mjs';
export { buildAdaptiveBusinessHierarchy } from './modularity-hierarchy.mjs';

export const ATLAS_SUBPACKS = Object.freeze({
  '@scanner': Object.freeze([
    'runner/atlas/contract.mjs',
    'runner/atlas/index.mjs',
    'runner/atlas/assemble-atlas.mjs',
    'runner/atlas/scan-entries.mjs',
    'runner/atlas/scan-graph.mjs',
    'runner/atlas/scan-branches.mjs',
    'runner/atlas/hydrate-workbench.mjs',
    'runner/atlas/modularity-hierarchy.mjs',
    'runner/atlas/humanize.mjs',
    'runner/atlas/serve-atlas.mjs',
    'runner/atlas/ui-views.mjs'
  ]),
  '@canvas': Object.freeze([
    'runner/atlas/render-html.mjs',
    'runner/atlas/wb-style-base.mjs',
    'runner/atlas/wb-style-canvas.mjs',
    'runner/atlas/wb-dom.mjs',
    'runner/atlas/wb-graph-engine.mjs',
    'runner/atlas/wb-layout-tidy.mjs',
    'runner/atlas/wb-render-cards.mjs',
    'runner/atlas/wb-render-wires.mjs',
    'runner/atlas/wb-snap-rulers.mjs',
    'runner/atlas/wb-menus-viewport.mjs',
    'runner/atlas/wb-viewport-ops.mjs',
    'runner/atlas/wb-events-wheel-drop.mjs',
    'runner/atlas/wb-events-pointer.mjs',
    'runner/atlas/wb-inline-rename.mjs',
    'runner/atlas/wb-events-actions.mjs',
    'runner/atlas/wb-history.mjs'
  ]),
  '@uiboard': Object.freeze([
    'runner/atlas/wb-uiboard.mjs'
  ]),
  '@workflow': Object.freeze([
    'runner/atlas/wb-catalog.mjs',
    'runner/atlas/wb-jit-workflow.mjs',
    'runner/atlas/wb-governance-panel.mjs',
    'runner/atlas/ui-shell.mjs',
    'runner/atlas/wb-subagent.mjs'
  ]),
  '@dsh-dock': Object.freeze([
    'runner/atlas/wb-dsh-style.mjs',
    'runner/atlas/wb-dsh-bridge.mjs',
    'runner/atlas/wb-dsh-shell.mjs'
  ])
});
