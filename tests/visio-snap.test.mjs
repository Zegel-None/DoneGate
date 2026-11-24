import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import {
  solveVisioMoveSnap,
  renderVisioSnapSvgMarkup,
  buildWbSnapRulers
} from '../runner/atlas/wb-snap-rulers.mjs';
import { buildWbEventsPointer } from '../runner/atlas/wb-events-pointer.mjs';
import { buildWbStyleCanvas } from '../runner/atlas/wb-style-canvas.mjs';

describe('问题 #7 · Visio 级画布智能吸附对齐线与水平/垂直等间距参考线', () => {
  it('① 连线端口水平/垂直拉直吸附：自动对齐已连线端口消除连线弯曲，且微差内优先于普通远端边缘对齐', () => {
    // 复刻截图 1：Gradle (out-apk @ y=174) -> [拖拽: 空白待定节点 (in-apk offsetY=56, out-pass offsetY=68)] -> Maestro (in-apk @ y=186)
    const siblings = [
      { id: 'n-gradle', x: 120, y: 100, w: 252, h: 196 },
      { id: 'n-maestro', x: 760, y: 98, w: 252, h: 190 },
      { id: 'n-distant', x: 1180, y: 120, w: 200, h: 140 }
    ];
    const portPairs = [
      { portOffsetX: 0, portOffsetY: 56, peerPortX: 372, peerPortY: 174, peerNodeId: 'n-gradle', muted: false },
      { portOffsetX: 252, portOffsetY: 68, peerPortX: 760, peerPortY: 186, peerNodeId: 'n-maestro', muted: false }
    ];

    // rawY=122 时：距远端无关卡片顶边 y=120 差 2px，距端口拉直 y=174-56=118 差 4px -> 优先命中连线端口拉直！
    const horizSnap = solveVisioMoveSnap({
      rawX: 440, rawY: 122, w: 252, h: 144, siblings, portPairs
    });
    expect(horizSnap.snappedY).toBe(true);
    expect(horizSnap.winnerY).toBe('port');
    expect(horizSnap.y).toBe(118);
    expect(horizSnap.y + 56).toBe(174);
    expect(horizSnap.y + 68).toBe(186);
    expect(horizSnap.portSnaps).toHaveLength(2);

    const horizSvg = renderVisioSnapSvgMarkup(horizSnap);
    expect(horizSvg).toContain('vs-port-snap-line');
    expect(horizSvg).toContain('vs-port-snap-ring');
    expect(horizSvg).toContain('连线拉直');

    // 纵向连线端口 X 对齐拉直吸附
    const vertPortSnap = solveVisioMoveSnap({
      rawX: 385, rawY: 340, w: 252, h: 140,
      siblings: [{ id: 'n-top', x: 380, y: 80, w: 252, h: 160 }],
      portPairs: [{ portOffsetX: 126, portOffsetY: 0, peerPortX: 506, peerPortY: 240, peerNodeId: 'n-top', muted: false }]
    });
    expect(vertPortSnap.snappedX).toBe(true);
    expect(vertPortSnap.winnerX).toBe('port');
    expect(vertPortSnap.x).toBe(380);
    expect(vertPortSnap.x + 126).toBe(506);
    expect(renderVisioSnapSvgMarkup(vertPortSnap)).toContain('data-snap-axis="x"');
  });

  it('② 卡片六向边缘与中心智能对齐线：完整支持 Left/CenterX/Right 与 Top/CenterY/Bottom 吸附及共线合并', () => {
    const ref = { id: 'ref-card', x: 200, y: 300, w: 240, h: 160 }; // center=(320, 380), right=440, bottom=460

    // Left 对齐 (rawX=205 -> 200) + Top 对齐 (rawY=296 -> 300)
    const lt = solveVisioMoveSnap({ rawX: 205, rawY: 296, w: 180, h: 120, siblings: [ref] });
    expect(lt.x).toBe(200);
    expect(lt.y).toBe(300);
    expect(lt.alignGuides.some((g) => g.axis === 'x' && g.pos === 200 && g.anchor === 'left')).toBe(true);
    expect(lt.alignGuides.some((g) => g.axis === 'y' && g.pos === 300 && g.anchor === 'top')).toBe(true);

    // CenterX 对齐 (drag w=200, centerX=rawX+100 -> 320 => x=220) + CenterY 对齐 (drag h=100, centerY=rawY+50 -> 380 => y=330)
    const cc = solveVisioMoveSnap({ rawX: 224, rawY: 326, w: 200, h: 100, siblings: [ref] });
    expect(cc.x).toBe(220);
    expect(cc.y).toBe(330);
    const ccSvg = renderVisioSnapSvgMarkup(cc);
    expect(ccSvg).toContain('vs-align-line is-center');
    expect(ccSvg).toContain('data-snap-anchor="centerX"');
    expect(ccSvg).toContain('data-snap-anchor="centerY"');

    // Right 对齐 (drag w=180, right=rawX+180 -> 440 => x=260) + Bottom 对齐 (drag h=110, bottom=rawY+110 -> 460 => y=350)
    const rb = solveVisioMoveSnap({ rawX: 255, rawY: 355, w: 180, h: 110, siblings: [ref] });
    expect(rb.x).toBe(260);
    expect(rb.y).toBe(350);
    expect(rb.alignGuides.some((g) => g.axis === 'x' && g.pos === 440 && g.anchor === 'right')).toBe(true);
    expect(rb.alignGuides.some((g) => g.axis === 'y' && g.pos === 460 && g.anchor === 'bottom')).toBe(true);
  });

  it('③ 纵向等间距自动检测与双端帽标尺：覆盖中间插入 A-[Drag]-B、首尾顺延及 4 卡连续等距（截图 2）', () => {
    // 场景 3a：拖在上下两卡中间 A - [Drag] - B
    const midVert = solveVisioMoveSnap({
      rawX: 103, rawY: 175, w: 252, h: 100,
      siblings: [
        { id: 'c-upper', x: 100, y: 20, w: 252, h: 100 },
        { id: 'c-lower', x: 100, y: 320, w: 252, h: 100 }
      ]
    });
    expect(midVert.x).toBe(100);
    expect(midVert.y).toBe(170);
    expect(midVert.winnerY).toBe('spacing');
    expect(midVert.equalGapsY).toHaveLength(2);
    expect(midVert.equalGapsY.map((s) => s.gap)).toEqual([50, 50]);

    // 场景 3b：上方首卡顺延 [Drag] - A - B
    const leadVert = solveVisioMoveSnap({
      rawX: 100, rawY: 46, w: 252, h: 100,
      siblings: [
        { id: 'c-a', x: 100, y: 190, w: 252, h: 100 },
        { id: 'c-b', x: 100, y: 330, w: 252, h: 100 }
      ]
    });
    expect(leadVert.y).toBe(50);
    expect(leadVert.equalGapsY).toHaveLength(2);

    // 场景 3c：复刻截图 2 四卡纵向连续等距（C1 -> C2 -> C3 -> [Drag C4]，三段 48px 间隙同时点亮双端帽标尺 + 左边缘对齐线）
    const chain4Vert = solveVisioMoveSnap({
      rawX: 104, rawY: 589, w: 252, h: 140,
      siblings: [
        { id: 'c1', x: 100, y: 40, w: 252, h: 140 },
        { id: 'c2', x: 100, y: 228, w: 252, h: 140 },
        { id: 'c3', x: 100, y: 416, w: 252, h: 130 }
      ]
    });
    expect(chain4Vert.x).toBe(100);
    expect(chain4Vert.y).toBe(594);
    expect(chain4Vert.equalGapsY).toHaveLength(3);
    expect(chain4Vert.equalGapsY.every((s) => s.gap === 48)).toBe(true);
    const svg4 = renderVisioSnapSvgMarkup(chain4Vert);
    expect((svg4.match(/class="vs-gap-ruler-group"/g) || []).length).toBe(3);
    expect(svg4).toContain('vs-gap-cap');
    expect(svg4).toContain('48px');
    expect(svg4).toContain('data-snap-anchor="left"');
  });

  it('④ 横向等间距自动检测与双端帽标尺：覆盖中间插入 L-[Drag]-R 与左右顺延（截图 3）', () => {
    // 场景 4a：横向中间插入 L - [Drag] - R（同时顶边对齐 y=120）
    const midHoriz = solveVisioMoveSnap({
      rawX: 376, rawY: 121, w: 220, h: 150,
      siblings: [
        { id: 'l-card', x: 80, y: 120, w: 240, h: 160 },
        { id: 'r-card', x: 660, y: 120, w: 240, h: 160 }
      ]
    });
    expect(midHoriz.x).toBe(380);
    expect(midHoriz.y).toBe(120);
    expect(midHoriz.winnerX).toBe('spacing');
    expect(midHoriz.equalGapsX).toHaveLength(2);
    expect(midHoriz.equalGapsX.map((s) => s.gap)).toEqual([60, 60]);

    // 场景 4b：右侧顺延 A - B - [Drag] 与左侧顺延 [Drag] - A - B
    const rightExt = solveVisioMoveSnap({
      rawX: 729, rawY: 121, w: 220, h: 150,
      siblings: [
        { id: 'a-card', x: 60, y: 120, w: 240, h: 160 },
        { id: 'b-card', x: 390, y: 120, w: 250, h: 160 }
      ]
    });
    expect(rightExt.x).toBe(730);
    expect(rightExt.y).toBe(120);
    expect(rightExt.equalGapsX).toHaveLength(2);
    const hSvg = renderVisioSnapSvgMarkup(rightExt);
    expect(hSvg).toContain('data-snap-axis="x"');
    expect(hSvg).toContain('90px');
    expect(hSvg).toContain('data-snap-anchor="top"');

    const leftExt = solveVisioMoveSnap({
      rawX: 16, rawY: 120, w: 200, h: 150,
      siblings: [
        { id: 'a2', x: 300, y: 120, w: 220, h: 160 },
        { id: 'b2', x: 600, y: 120, w: 220, h: 160 }
      ]
    });
    expect(leftExt.x).toBe(20);
    expect(leftExt.equalGapsX).toHaveLength(2);
  });

  it('⑤ 真实指针交互联调：Alt 键实时切换跳过吸附，pointerup 与 pointercancel 彻底清理参考线 DOM', () => {
    const css = buildWbStyleCanvas();
    for (const cls of ['.vs-port-snap-line', '.vs-port-snap-ring', '.vs-gap-ruler', '.vs-gap-cap', '.vs-align-line.is-center']) {
      expect(css).toContain(cls);
    }

    const winHandlers = {}, docHandlers = {}, stageHandlers = {};
    const makeEl = (id, x = 0, y = 0, w = 252, h = 150, attrs = {}) => ({
      id, offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h,
      innerHTML: '', textContent: '', style: { left: `${x}px`, top: `${y}px` },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      getAttribute: (k) => attrs[k] ?? null,
      getBoundingClientRect: () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }),
      addEventListener(ev, fn) { if (id === 'canvas-stage') (stageHandlers[ev] = stageHandlers[ev] || []).push(fn); },
      querySelectorAll: () => [],
      closest(sel) {
        if (sel === '[data-card-id]' && attrs['data-card-id']) return this;
        if (sel === '[data-drag-card]' && attrs['data-drag-card']) return this;
        return null;
      }
    });

    const nodes = [
      { id: 'n-up', title: '上游节点', x: 80, y: 100, w: 252, h: 160 },
      { id: 'n-drag', title: '被拖节点', x: 420, y: 140, w: 252, h: 140 }
    ];
    const links = [{ id: 'lk-1', fromNode: 'n-up', fromSlot: 'out-1', toNode: 'n-drag', toSlot: 'in-1', type: 'ARTIFACT' }];
    const cardUp = makeEl('card-n-up', 80, 100, 252, 160, { 'data-card-id': 'n-up', 'data-drag-card': 'n-up' });
    const cardDragEl = makeEl('card-n-drag', 420, 140, 252, 140, { 'data-card-id': 'n-drag', 'data-drag-card': 'n-drag' });
    cardDragEl.getBoundingClientRect = () => ({
      left: cardDragEl.offsetLeft, top: cardDragEl.offsetTop,
      right: cardDragEl.offsetLeft + 252, bottom: cardDragEl.offsetTop + 140, width: 252, height: 140
    });
    const snapSvg = makeEl('snaplines-svg', 0, 0, 2000, 1500);
    const worldEl = makeEl('canvas-world', 0, 0, 2000, 1500);
    const stageEl = makeEl('canvas-stage', 0, 0, 1400, 900);
    const idMap = {
      'canvas-stage': stageEl, 'canvas-world': worldEl, 'snaplines-svg': snapSvg,
      'card-n-up': cardUp, 'card-n-drag': cardDragEl,
      'left-splitter': makeEl('left-splitter'), 'right-splitter': makeEl('right-splitter'),
      'ctx-root-menu': makeEl('ctx-root-menu'), 'ctx-sub-menu': makeEl('ctx-sub-menu'),
      'menu-drag-ghost': makeEl('menu-drag-ghost'), 'hover-tooltip': makeEl('hover-tooltip'), 'marquee-box': makeEl('marquee-box')
    };

    const ctx = vm.createContext({
      window: { innerWidth: 1400, innerHeight: 900, addEventListener(ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); } },
      document: {
        getElementById: (id) => idMap[id] || null,
        querySelectorAll: () => [],
        addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); }
      },
      Set, Map, Math, Number, String, Boolean, Array, Object,
      requestAnimationFrame: () => 1, setTimeout: () => 1, clearTimeout() {},
      esc: (s) => String(s ?? ''),
      state: { page: 'workshop', zoom: 1, panX: 0, panY: 0, selectedNodeIds: new Set(['n-drag']), colorPickerOpen: false },
      getActiveNodesList: () => nodes,
      getActiveWorkshopGraph: () => ({ nodes, links }),
      isWorkshopLinkMuted: () => false,
      isSandboxReadOnly: () => false,
      getPinWorldPos: (nid) => (nid === 'n-up' ? { x: 332, y: 176 } : { x: cardDragEl.offsetLeft, y: cardDragEl.offsetTop + 60 }),
      syncGroupFramesGeometry() {},
      renderWires() { cardDragEl.offsetLeft = nodes[1].x; cardDragEl.offsetTop = nodes[1].y; },
      renderSelectionFloatingToolbox() {}, renderAll() {}, renderRightSidebar() {}, renderLeftDrawer() {},
      closeCascadingMenus() {}, applyViewportTransform() {}, applyAllTextOverridesAndSelection() {},
      setupCanvasWheelDblclickAndDrawerDrop() {}, setupActionAndKeyEvents() {}
    });
    ctx.window.document = ctx.document;

    vm.runInContext(`${buildWbSnapRulers()}\n${buildWbEventsPointer()}\nsetupAllEvents();`, ctx);

    // 1. 按下卡片标题栏并拖拽至 rawY = 121 (距端口拉直位 176 - 60 = 116 差 5px) -> 自动吸附至 y = 116 并渲染拉直参考线
    stageHandlers.pointerdown[0]({ button: 0, clientX: 450, clientY: 150, altKey: false, target: cardDragEl, preventDefault() {}, stopPropagation() {} });
    winHandlers.pointermove[0]({ clientX: 450, clientY: 131, altKey: false, target: cardDragEl });
    expect(nodes[1].y).toBe(116);
    expect(snapSvg.innerHTML).toContain('vs-port-snap-line');

    // 2. 拖拽途中按住 Alt 键 -> 立即跳过吸附恢复自由坐标 rawY = 121，且清空参考线
    winHandlers.keydown[0]({ key: 'Alt' });
    expect(nodes[1].y).toBe(121);
    expect(snapSvg.innerHTML).toBe('');

    // 3. 松开 Alt 键 -> 重新吸附回 y = 116 并恢复参考线；随后 pointerup 释放 -> 干净清空参考线
    winHandlers.keyup[0]({ key: 'Alt' });
    expect(nodes[1].y).toBe(116);
    expect(snapSvg.innerHTML).toContain('vs-port-snap-line');
    winHandlers.pointerup[0]({ clientX: 450, clientY: 131, target: cardDragEl });
    expect(snapSvg.innerHTML).toBe('');

    // 4. 再次拖拽触发对齐线后遭遇 pointercancel -> 干净中止拖拽并清空参考线
    stageHandlers.pointerdown[0]({ button: 0, clientX: 450, clientY: 130, altKey: false, target: cardDragEl, preventDefault() {}, stopPropagation() {} });
    winHandlers.pointermove[0]({ clientX: 450, clientY: 132, altKey: false, target: cardDragEl });
    expect(snapSvg.innerHTML).toContain('vs-port-snap-line');
    winHandlers.pointercancel[0]();
    expect(snapSvg.innerHTML).toBe('');
    expect(ctx.window.__isWorkbenchDragging()).toBe(false);
  });
});
