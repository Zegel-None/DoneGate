// 工作台设计令牌、离线原子工具类与顶栏/抽屉基础样式模块
const WB_STYLE_BASE_CSS = `
  *, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: var(--border-subtle); }
  button, input, optgroup, select, textarea { font-family: inherit; font-feature-settings: inherit; font-variation-settings: inherit; font-size: 100%; font-weight: inherit; line-height: inherit; color: inherit; margin: 0; padding: 0; background-color: transparent; }
  button, select { text-transform: none; } button, [type='button'] { cursor: pointer; } h1, h2, h3, h4, p { margin: 0; }
  svg { display: block; vertical-align: middle; flex-shrink: 0; } .hidden { display: none !important; } .block { display: block; } .flex { display: flex; }
  .inline-flex { display: inline-flex; } .grid { display: grid; } .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .flex-col { flex-direction: column; }
  .flex-wrap { flex-wrap: wrap; } .flex-1 { flex: 1 1 0%; } .shrink-0 { flex-shrink: 0; } .min-w-0 { min-width: 0px; } .min-h-0 { min-height: 0px; } .min-h-full { min-height: 100%; }
  .items-center { align-items: center; } .items-stretch { align-items: stretch; } .justify-between { justify-content: space-between; } .justify-center { justify-content: center; }
  .justify-end { justify-content: flex-end; } .self-start { align-self: flex-start; } .self-end { align-self: flex-end; } .relative { position: relative; }
  .absolute { position: absolute; } .fixed { position: fixed; } .inset-0 { inset: 0px; }
  .top-0 { top: 0px; } .top-1\\.5 { top: 0.375rem; } .top-3 { top: 0.75rem; } .top-7 { top: 1.75rem; } .top-14 { top: 3.5rem; } .top-\\[26px\\] { top: 26px; }
  .bottom-3 { bottom: 0.75rem; } .left-0 { left: 0px; } .left-3 { left: 0.75rem; } .left-1\\/2 { left: 50%; }
  .right-0 { right: 0px; } .right-1\\.5 { right: 0.375rem; } .right-3 { right: 0.75rem; } .-left-\\[6\\.5px\\] { left: -6.5px; } .-right-\\[6\\.5px\\] { right: -6.5px; }
  .-translate-x-1\\/2 { transform: translateX(-50%); } .origin-top-left { transform-origin: top left; } .z-20 { z-index: 20; } .z-30 { z-index: 30; } .z-50 { z-index: 50; }
  .gap-0\\.5 { gap: 0.125rem; } .gap-1 { gap: 0.25rem; } .gap-1\\.5 { gap: 0.375rem; } .gap-2 { gap: 0.5rem; } .gap-2\\.5 { gap: 0.625rem; } .gap-3 { gap: 0.75rem; }
  .p-1 { padding: 0.25rem; } .p-2 { padding: 0.5rem; } .p-2\\.5 { padding: 0.625rem; } .p-3 { padding: 0.75rem; } .p-3\\.5 { padding: 0.875rem; } .p-4 { padding: 1rem; }
  .px-1 { padding-left: 0.25rem; padding-right: 0.25rem; } .px-1\\.5 { padding-left: 0.375rem; padding-right: 0.375rem; } .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
  .px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; } .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; } .px-3\\.5 { padding-left: 0.875rem; padding-right: 0.875rem; }
  .py-0\\.2 { padding-top: 0.05rem; padding-bottom: 0.05rem; } .py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; } .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; } .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .pt-1 { padding-top: 0.25rem; } .pt-1\\.5 { padding-top: 0.375rem; } .pt-2 { padding-top: 0.5rem; } .pt-2\\.5 { padding-top: 0.625rem; }
  .pb-0\\.5 { padding-bottom: 0.125rem; } .pb-1\\.5 { padding-bottom: 0.375rem; } .pb-2 { padding-bottom: 0.5rem; } .pr-0\\.5 { padding-right: 0.125rem; } .m-0 { margin: 0px; }
  .mt-0\\.5 { margin-top: 0.125rem; } .mt-1 { margin-top: 0.25rem; } .mt-2 { margin-top: 0.5rem; } .-mt-1 { margin-top: -0.25rem; }
  .mb-0\\.5 { margin-bottom: 0.125rem; } .mb-1 { margin-bottom: 0.25rem; }
  .mx-0\\.5 { margin-left: 0.125rem; margin-right: 0.125rem; } .mx-1 { margin-left: 0.25rem; margin-right: 0.25rem; } .mx-1\\.5 { margin-left: 0.375rem; margin-right: 0.375rem; }
  .my-0\\.5 { margin-top: 0.125rem; margin-bottom: 0.125rem; } .my-1 { margin-top: 0.25rem; margin-bottom: 0.25rem; }
  .-ml-\\[18px\\] { margin-left: -18px; } .-mr-\\[18px\\] { margin-right: -18px; } .w-px { width: 1px; } .w-1 { width: 0.25rem; } .w-1\\.5 { width: 0.375rem; } .w-2 { width: 0.5rem; }
  .w-3 { width: 0.75rem; } .w-3\\.5 { width: 0.875rem; } .w-4 { width: 1rem; } .w-5 { width: 1.25rem; }
  .w-6 { width: 1.5rem; } .w-8 { width: 2rem; } .w-\\[52px\\] { width: 52px; } .w-52 { width: 13rem; } .w-60 { width: 15rem; } .w-full { width: 100%; }
  .h-px { height: 1px; } .h-1\\.5 { height: 0.375rem; } .h-2 { height: 0.5rem; } .h-3\\.5 { height: 0.875rem; } .h-4 { height: 1rem; }
  .h-6 { height: 1.5rem; } .h-8 { height: 2rem; } .h-11 { height: 2.75rem; } .h-full { height: 100%; } .max-w-\\[175px\\] { max-width: 175px; } .max-w-\\[90\\%\\] { max-width: 90%; }
  .max-w-sm { max-width: 24rem; } .max-w-lg { max-width: 32rem; } .max-w-4xl { max-width: 56rem; } .max-h-72 { max-height: 18rem; } .max-h-\\[82vh\\] { max-height: 82vh; }
  .border-0 { border-width: 0px; } .border { border-width: 1px; } .border-b { border-bottom-width: 1px; } .border-t { border-top-width: 1px; } .border-r { border-right-width: 1px; }
  .border-dashed { border-style: dashed; } .rounded { border-radius: 0.25rem; } .rounded-md { border-radius: 0.375rem; } .rounded-lg { border-radius: 0.5rem; }
  .rounded-xl { border-radius: 0.75rem; } .rounded-2xl { border-radius: 1rem; } .rounded-full { border-radius: 9999px; }
  .text-xs { font-size: 0.75rem; line-height: 1rem; } .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .text-\\[10px\\] { font-size: 10px; line-height: 1.35; } .text-\\[10\\.5px\\] { font-size: 10.5px; line-height: 1.35; }
  .text-\\[11px\\] { font-size: 11px; line-height: 1.4; } .text-\\[13px\\] { font-size: 13px; line-height: 1.45; }
  .font-medium { font-weight: 500; } .font-semibold { font-weight: 600; } .font-bold { font-weight: 700; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; } .leading-snug { line-height: 1.375; } .leading-relaxed { line-height: 1.625; }
  .text-left { text-align: left; } .text-center { text-align: center; } .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .underline { text-decoration-line: underline; } .hover\\:underline:hover { text-decoration-line: underline; }
  .opacity-0 { opacity: 0; } .opacity-40 { opacity: 0.4; } .opacity-45 { opacity: 0.45; } .opacity-55 { opacity: 0.55; } .opacity-60 { opacity: 0.6; } .opacity-65 { opacity: 0.65; }
  .opacity-70 { opacity: 0.7; } .opacity-75 { opacity: 0.75; } .opacity-80 { opacity: 0.8; }
  .hover\\:opacity-75:hover { opacity: 0.75; } .hover\\:opacity-80:hover { opacity: 0.8; } .hover\\:opacity-85:hover { opacity: 0.85; }
  .hover\\:scale-110:hover { transform: scale(1.1); } .group:hover .group-hover\\:opacity-100 { opacity: 1; }
  .overflow-auto { overflow: auto; } .overflow-hidden { overflow: hidden; } .overflow-y-auto { overflow-y: auto; }
  .pointer-events-none { pointer-events: none; } .select-none { user-select: none; }
  .cursor-pointer { cursor: pointer; } .outline-none { outline: 2px solid transparent; outline-offset: 2px; }
  .transition-all { transition: all 0.15s ease; } .transition-colors { transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease; }
  .transition-opacity { transition: opacity 0.15s ease; } .duration-150 { transition-duration: 150ms; }
  .atlas-tab-btn { padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--text-secondary); border: 1px solid transparent; }
  .atlas-tab-btn.is-active { background: var(--primary-soft); color: var(--primary-text); font-weight: 600; border-color: var(--primary); }
  .tech-fold { border: 1px solid var(--border-subtle); border-radius: 10px; padding: 8px 12px; background: var(--surface-soft); margin-top: 8px; }
  .tech-fold summary { cursor: pointer; font-weight: 600; color: var(--text-secondary); font-size: 11.5px; } @keyframes dgspin { to { transform: rotate(360deg); } }
  .dg-spin { display: inline-block; animation: dgspin 0.65s linear infinite; }
  :root, [data-theme="light"] { --bg-app: #ffffff; --bg-canvas: #f7f8f9; --bg-dot: rgba(15, 17, 21, 0.095); --surface: #ffffff; --surface-soft: #f5f6f7; --surface-hover: #eceef1; --border-subtle: rgba(0, 0, 0, 0.08); --border-strong: rgba(0, 0, 0, 0.15); --text-main: #0f1115; --text-secondary: #545557; --text-muted: #81858c; --primary: #151517; --primary-soft: #eceef1; --primary-text: #0f1115; --btn-primary-bg: #151517; --btn-primary-fg: #ffffff; --subgraph-accent: #52525b; --subgraph-soft: #e4e4e7; --ok: #15803d; --ok-bg: #dcfce7; --warn: #b45309; --warn-bg: #fef3c7; --err: #b91c1c; --err-bg: #fee2e2; --muted-wire: #b8bcc2; --flow-wire: #52525b; --shadow-sm: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03); --shadow-md: 0 0 0 0.5px rgba(0, 0, 0, 0.10), 0 6px 20px rgba(0, 0, 0, 0.06); --shadow-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 12px 32px rgba(0, 0, 0, 0.12); --glass: rgba(252, 253, 254, 0.86); }
  [data-theme="dark"], body.dark-mode { --bg-app: #151517; --bg-canvas: #151517; --bg-dot: rgba(255, 255, 255, 0.085); --surface: #232324; --surface-soft: #2c2c2e; --surface-hover: #353638; --border-subtle: rgba(255, 255, 255, 0.09); --border-strong: rgba(255, 255, 255, 0.16); --text-main: #f9fafb; --text-secondary: #cfd3d6; --text-muted: #81858c; --primary: #f5f6f7; --primary-soft: #353638; --primary-text: #f9fafb; --btn-primary-bg: #f5f6f7; --btn-primary-fg: #151517; --subgraph-accent: #a1a1aa; --subgraph-soft: #2c2c2e; --ok: #86efac; --ok-bg: rgba(34, 197, 94, 0.14); --warn: #fcd34d; --warn-bg: rgba(245, 158, 11, 0.15); --err: #fca5a5; --err-bg: rgba(239, 68, 68, 0.15); --muted-wire: #45474c; --flow-wire: #9ca3af; --shadow-sm: 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 3px 10px rgba(0, 0, 0, 0.24); --shadow-md: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 8px 24px rgba(0, 0, 0, 0.36); --shadow-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 16px 38px rgba(0, 0, 0, 0.52); --glass: rgba(44, 44, 46, 0.86); }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; overflow: hidden; background: var(--bg-app); color: var(--text-main); font-family: "Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif; user-select: none; }
  .dot-canvas { background-color: var(--bg-canvas); background-image: radial-gradient(var(--bg-dot) 1.15px, transparent 1.15px); background-size: 22px 22px; }
  .seg-bar { display: inline-flex; background: var(--surface-soft); padding: 2px; border-radius: 12px; padding: 3px; border: 1px solid var(--border-subtle); gap: 2px; }
  .seg-btn { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; padding: 4px 11px; border-radius: 8px; cursor: pointer; transition: all 0.14s ease; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
  .seg-btn:hover { color: var(--text-main); } .seg-btn.is-active { background: var(--surface); color: var(--primary); font-weight: 600; box-shadow: var(--shadow-sm); }
  .ghost-btn { border: 1px solid var(--border-subtle); background: var(--surface); color: var(--text-secondary); font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 8px; cursor: pointer; transition: all 0.14s ease; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .ghost-btn:hover { background: var(--surface-hover); color: var(--text-main); }
  .ghost-btn.is-primary { background: var(--btn-primary-bg); color: var(--btn-primary-fg); border-color: transparent; font-weight: 600; }
  .col-splitter { width: 5px; cursor: col-resize; background: transparent; position: relative; z-index: 25; flex-shrink: 0; transition: background 0.14s ease; }
  .col-splitter::after { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 1px; background: var(--border-subtle); }
  .col-splitter:hover, .col-splitter.is-dragging { background: var(--primary-soft); }
  .col-splitter:hover::after, .col-splitter.is-dragging::after { background: var(--primary); width: 2px; left: 1.5px; }
  .node-card { position: absolute; width: 252px; box-sizing: border-box; pointer-events: auto; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border-subtle); border-radius: 16px; box-shadow: var(--shadow-sm); transition: border-color 0.14s ease, box-shadow 0.14s ease, opacity 0.16s ease; }
  .card-header-zone, .card-subline-zone, .card-progress-zone { flex-shrink: 0; min-width: 0; overflow: hidden; } .card-ports-zone { flex-shrink: 0; min-width: 0; }
  .card-adaptive-body { flex: 0 0 auto; min-width: 0; overflow: hidden; display: flex; flex-direction: column; border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; }
  .card-body-full { flex: 0 0 auto; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
  .card-scroll-window { flex: 0 0 auto; min-width: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
  .node-card.has-explicit-h .card-adaptive-body, .node-card.has-explicit-h .card-body-full, .node-card.has-explicit-h .card-scroll-window { flex: 1 1 0%; min-height: 0; }
  .card-scroll-window::-webkit-scrollbar { width: 4px; } .card-scroll-window::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
  .card-body-folded { display: none; flex: 1 1 0%; min-height: 0; min-width: 0; overflow: hidden; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 12px; border-top: 1px solid var(--border-subtle); font-size: 10.5px; color: var(--text-muted); background: var(--surface-soft); cursor: pointer; user-select: none; border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; }
  .card-body-folded:hover { color: var(--primary); } .node-card.is-narrow-card .card-ports-zone { gap: 4px !important; } .node-card.is-narrow-card .slot-state-txt { display: none; }
  .node-card.is-at-min-floor .card-resize-grip { color: var(--warn); opacity: 0.95; } .node-card:hover { border-color: var(--border-strong); }
  .node-card.is-selected { border-color: var(--primary); box-shadow: 0 0 0 2px var(--border-strong), var(--shadow-md); }
  .node-card.is-blank { border-style: dashed; border-color: var(--primary); } .node-card.is-subrepo { border-width: 2px; border-color: var(--primary); }
  .node-card.is-subgraph { border-width: 2px; border-color: var(--subgraph-accent); box-shadow: 0 3px 0 0 var(--subgraph-soft), var(--shadow-sm); }
  .node-card.is-boundary { border-style: dashed; border-color: var(--subgraph-accent); background: var(--surface-soft); }
  .node-card.is-bypassed { opacity: 0.48; background: repeating-linear-gradient( -45deg, var(--surface), var(--surface) 9px, var(--surface-soft) 9px, var(--surface-soft) 18px ); }
  .card-drag-bar { cursor: grab; } .card-drag-bar:active { cursor: grabbing; }
  .card-resize-grip { position: absolute; right: 1px; bottom: 1px; width: 16px; height: 16px; cursor: nwse-resize; display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px; color: var(--text-muted); opacity: 0.45; transition: opacity 0.12s ease, color 0.12s ease; z-index: 12; }
  .node-card:hover .card-resize-grip { opacity: 0.9; color: var(--primary); }
  .selection-toolbox { position: absolute; transform: translate(-50%, -100%); margin-top: -10px; z-index: 30; display: inline-flex; align-items: center; gap: 2px; padding: 3px 5px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-md); pointer-events: auto; white-space: nowrap; }
  .tb-action { border: none; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 500; padding: 3px 7px; border-radius: 6px; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }
  .tb-action:hover { background: var(--surface-hover); color: var(--text-main); }
  .tb-action.is-highlight { background: var(--subgraph-soft); color: var(--subgraph-accent); font-weight: 600; }
  .tb-action.is-active { background: var(--warn-bg); color: var(--warn); font-weight: 600; } .tb-action.is-danger:hover { background: var(--err-bg); color: var(--err); }
  .tb-sep { width: 1px; height: 14px; background: var(--border-subtle); margin: 0 2px; flex-shrink: 0; }
`;
export function buildWbStyleBase() {
  return WB_STYLE_BASE_CSS;
}
