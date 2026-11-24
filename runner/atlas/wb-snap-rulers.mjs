// Visual Studio / Visio 风格卡片缩放与移动智能标尺（连接点拉直、六向边缘/中心对齐与水平/垂直等间距标尺）

function wbSnapReadPortPairAxis(pair, isY) {
  const off = Number(isY ? pair.portOffsetY : pair.portOffsetX);
  const peer = Number(isY ? pair.peerPortY : pair.peerPortX);
  return Number.isFinite(off) && Number.isFinite(peer) ? { off, peer } : null;
}

function wbSnapCollectPortMatches(portPairs, axis, isY, snappedPos) {
  const matches = [];
  for (const pair of portPairs) {
    const coords = wbSnapReadPortPairAxis(pair, isY);
    if (coords && Math.abs((snappedPos + coords.off) - coords.peer) <= 0.5) {
      matches.push({
        axis, linePos: coords.peer,
        portOffsetX: Number(pair.portOffsetX) || 0, portOffsetY: Number(pair.portOffsetY) || 0,
        peerPortX: Number(pair.peerPortX) || 0, peerPortY: Number(pair.peerPortY) || 0,
        peerNodeId: pair.peerNodeId || ''
      });
    }
  }
  return matches;
}

export function solveVisioPortAxisSnap(rawPos, portPairs, axis, portTol = 8) {
  if (!Array.isArray(portPairs) || portPairs.length === 0) return null;
  const isY = axis === 'y';
  let best = null;
  for (const pair of portPairs) {
    const coords = wbSnapReadPortPairAxis(pair, isY);
    if (!coords) continue;
    const targetPos = coords.peer - coords.off;
    const absDelta = Math.abs(targetPos - rawPos);
    if (absDelta > portTol) continue;
    const rankScore = absDelta + (pair.muted ? 0.08 : 0);
    if (!best || rankScore < best.rankScore) best = { targetPos, absDelta, rankScore };
  }
  if (!best) return null;
  return { targetPos: best.targetPos, absDelta: best.absDelta, matches: wbSnapCollectPortMatches(portPairs, axis, isY, best.targetPos) };
}

function wbSnapEvalAnchorPair(rawPos, da, sa, tol, best) {
  if (da.center !== sa.center) return best;
  const targetPos = sa.val - da.off;
  const absDelta = Math.abs(targetPos - rawPos);
  if (absDelta > tol) return best;
  const rankScore = absDelta + (da.center ? 0.15 : 0);
  return (!best || rankScore < best.rankScore) ? { targetPos, absDelta, rankScore, anchor: da.key, linePos: sa.val } : best;
}

export function solveVisioCardEdgeSnap(rawPos, size, siblings, axis, tol = 7) {
  if (!Array.isArray(siblings) || siblings.length === 0) return null;
  const isX = axis === 'x';
  const dragAnchors = isX
    ? [{ key: 'left', off: 0, center: false }, { key: 'centerX', off: size / 2, center: true }, { key: 'right', off: size, center: false }]
    : [{ key: 'top', off: 0, center: false }, { key: 'centerY', off: size / 2, center: true }, { key: 'bottom', off: size, center: false }];
  let best = null;
  for (const sib of siblings) {
    const base = isX ? sib.x : sib.y, len = isX ? sib.w : sib.h;
    const sibAnchors = [{ val: base, center: false }, { val: base + len / 2, center: true }, { val: base + len, center: false }];
    for (const da of dragAnchors) {
      for (const sa of sibAnchors) best = wbSnapEvalAnchorPair(rawPos, da, sa, tol, best);
    }
  }
  return best ? { targetPos: best.targetPos, absDelta: best.absDelta, anchor: best.anchor, linePos: best.linePos } : null;
}

function wbSnapMatchAxisGuides(anchors, sibBase, sibLen, axis, spanStart, spanEnd, mergeGuide) {
  const sibPts = [[sibBase, false], [sibBase + sibLen / 2, true], [sibBase + sibLen, false]];
  for (const [key, val, isC] of anchors) {
    for (const [sp, sC] of sibPts) {
      if (isC === sC && Math.abs(val - sp) <= 0.5) mergeGuide(axis, sp, spanStart, spanEnd, key, isC);
    }
  }
}

function collectVisioMatchedAlignGuides(finalX, finalY, w, h, siblings) {
  if (!Array.isArray(siblings) || siblings.length === 0) return [];
  const guidesMap = new Map();
  const mergeGuide = (axis, pos, start, end, anchor, isCenter) => {
    const k = `${axis}:${Math.round(pos * 2) / 2}`;
    const prev = guidesMap.get(k);
    if (!prev) {
      guidesMap.set(k, { axis, pos, start, end, anchor, isCenter });
      return;
    }
    prev.start = Math.min(prev.start, start);
    prev.end = Math.max(prev.end, end);
    if (!isCenter) {
      prev.isCenter = false;
      prev.anchor = anchor;
    }
  };
  const xAs = [['left', finalX, false], ['centerX', finalX + w / 2, true], ['right', finalX + w, false]];
  const yAs = [['top', finalY, false], ['centerY', finalY + h / 2, true], ['bottom', finalY + h, false]];
  for (const sib of siblings) {
    wbSnapMatchAxisGuides(xAs, sib.x, sib.w, 'x', Math.min(finalY, sib.y) - 14, Math.max(finalY + h, sib.y + sib.h) + 14, mergeGuide);
    wbSnapMatchAxisGuides(yAs, sib.y, sib.h, 'y', Math.min(finalX, sib.x) - 14, Math.max(finalX + w, sib.x + sib.w) + 14, mergeGuide);
  }
  return [...guidesMap.values()];
}

function wbSnapProjectCrossSiblings(rawC, cSize, siblings, isY) {
  const items = [];
  for (const sib of siblings) {
    const sc = isY ? sib.x : sib.y, scSize = isY ? sib.w : sib.h;
    const overlap = Math.min(rawC + cSize, sc + scSize) - Math.max(rawC, sc);
    const centerDist = Math.abs((rawC + cSize / 2) - (sc + scSize / 2));
    if (overlap <= 0 && centerDist > Math.max(cSize, scSize) * 1.15) continue;
    const sp = isY ? sib.y : sib.x, spSize = isY ? sib.h : sib.w;
    items.push({ id: sib.id, p: sp, pe: sp + spSize, c: sc, ce: sc + scSize });
  }
  return items;
}

function wbSnapCandBetween(items, prev1, next1, rawP, pSize, tol) {
  if (!prev1 || !next1 || (next1.p - prev1.pe) < pSize) return null;
  const blocked = items.some((m) => m.id !== prev1.id && m.id !== next1.id && m.p >= prev1.pe - 0.5 && m.pe <= next1.p + 0.5);
  if (blocked) return null;
  const gap = (next1.p - prev1.pe - pSize) / 2, targetP = prev1.pe + gap, absDelta = Math.abs(rawP - targetP);
  return absDelta <= tol ? { targetP, gap, absDelta, mode: 'between' } : null;
}

function wbSnapCandStep(items, anchor, isAfter, rawP, pSize, tol) {
  if (!anchor) return null;
  const peer = isAfter
    ? items.filter((it) => it.id !== anchor.id && it.pe <= anchor.p + 0.5).sort((a, b) => b.pe - a.pe)[0]
    : items.filter((it) => it.id !== anchor.id && it.p >= anchor.pe - 0.5).sort((a, b) => a.p - b.p)[0];
  if (!peer) return null;
  const rawGap = isAfter ? anchor.p - peer.pe : peer.p - anchor.pe;
  if (rawGap < -0.5) return null;
  const gap = Math.max(0, rawGap);
  const targetP = isAfter ? anchor.pe + gap : anchor.p - gap - pSize;
  const absDelta = Math.abs(rawP - targetP), mode = isAfter ? 'after' : 'before';
  return absDelta <= tol ? { targetP, gap, absDelta, mode } : null;
}

function wbSnapPickBestSpacingCand(items, rawP, pSize, tol) {
  const prev1 = items.filter((it) => it.pe <= rawP + tol).sort((a, b) => b.pe - a.pe)[0] || null;
  const next1 = items.filter((it) => it.p >= rawP + pSize - tol).sort((a, b) => a.p - b.p)[0] || null;
  const cands = [
    wbSnapCandBetween(items, prev1, next1, rawP, pSize, tol),
    wbSnapCandStep(items, prev1, true, rawP, pSize, tol),
    wbSnapCandStep(items, next1, false, rawP, pSize, tol)
  ].filter(Boolean);
  if (cands.length === 0) return null;
  cands.sort((a, b) => (a.absDelta - b.absDelta) || (a.mode === 'between' ? -1 : 1));
  return cands[0];
}

function wbSnapWalkGapSide(items, startNode, gap, isForward) {
  const pairs = [];
  let cur = startNode;
  const seen = new Set([startNode.id]);
  const gapDist = (a, b) => Math.abs((b.p - a.pe) - gap);
  while (cur) {
    const step = items
      .filter((it) => !seen.has(it.id) && (isForward ? gapDist(cur, it) : gapDist(it, cur)) <= 1)
      .sort((a, b) => (isForward ? gapDist(cur, a) - gapDist(cur, b) : gapDist(a, cur) - gapDist(b, cur)))[0];
    if (!step) break;
    seen.add(step.id);
    pairs.push(isForward ? { from: cur, to: step } : { from: step, to: cur });
    cur = step;
  }
  return pairs;
}

function wbSnapFormatGapSegment({ from, to }, axis) {
  const ovS = Math.max(from.c, to.c), ovE = Math.min(from.ce, to.ce);
  const crossMid = ovE > ovS ? (ovS + ovE) / 2 : ((from.c + from.ce) / 2 + (to.c + to.ce) / 2) / 2;
  return { axis, p1: from.pe, p2: to.p, crossPos: Math.round(crossMid), gap: Math.round((to.p - from.pe) * 10) / 10, fromId: from.id, toId: to.id };
}

export function solveVisioEqualSpacingSnap(rawX, rawY, w, h, siblings, axis, tol = 8) {
  if (!Array.isArray(siblings) || siblings.length < 2) return null;
  const isY = axis === 'y';
  const rawP = isY ? rawY : rawX, pSize = isY ? h : w;
  const rawC = isY ? rawX : rawY, cSize = isY ? w : h;
  const items = wbSnapProjectCrossSiblings(rawC, cSize, siblings, isY);
  if (items.length < 2) return null;
  const best = wbSnapPickBestSpacingCand(items, rawP, pSize, tol);
  if (!best) return null;
  const dragNode = { id: '__drag__', p: best.targetP, pe: best.targetP + pSize, c: rawC, ce: rawC + cSize };
  const rawPairs = [...wbSnapWalkGapSide(items, dragNode, best.gap, false), ...wbSnapWalkGapSide(items, dragNode, best.gap, true)];
  rawPairs.sort((a, b) => a.from.pe - b.from.pe);
  const segments = rawPairs.map((pair) => wbSnapFormatGapSegment(pair, axis));
  return { targetPos: best.targetP, gap: best.gap, absDelta: best.absDelta, mode: best.mode, segments };
}

function pickWinningAxisSnap(portCand, spaceCand, alignCand) {
  const pool = [];
  if (portCand) pool.push({ kind: 'port', score: portCand.absDelta - 4.5, targetPos: portCand.targetPos });
  if (spaceCand) pool.push({ kind: 'spacing', score: spaceCand.absDelta - 0.5, targetPos: spaceCand.targetPos });
  if (alignCand) pool.push({ kind: 'align', score: alignCand.absDelta, targetPos: alignCand.targetPos });
  if (pool.length === 0) return null;
  const order = { port: 0, spacing: 1, align: 2 };
  pool.sort((a, b) => (a.score - b.score) || (order[a.kind] - order[b.kind]));
  return pool[0];
}

function wbSnapBuildAxisPortSnaps(finalPort, axis, crossBase) {
  if (!finalPort) return [];
  const isX = axis === 'x';
  return finalPort.matches.map((m) => ({
    axis, linePos: m.linePos,
    dragPortX: isX ? m.linePos : crossBase + m.portOffsetX,
    dragPortY: isX ? crossBase + m.portOffsetY : m.linePos,
    peerPortX: m.peerPortX, peerPortY: m.peerPortY, peerNodeId: m.peerNodeId
  }));
}

export function solveVisioMoveSnap(params = {}) {
  const rawX = Number(params.rawX) || 0, rawY = Number(params.rawY) || 0;
  const w = Number(params.w) || 252, h = Number(params.h) || 140;
  if (params.altKey) {
    return { x: rawX, y: rawY, dx: 0, dy: 0, snappedX: false, snappedY: false, winnerX: null, winnerY: null, portSnaps: [], alignGuides: [], equalGapsX: [], equalGapsY: [] };
  }
  const siblings = Array.isArray(params.siblings) ? params.siblings : [];
  const portPairs = Array.isArray(params.portPairs) ? params.portPairs : [];
  const alignTol = params.alignTol ?? 7, spaceTol = params.spaceTol ?? 8, portTol = params.portTol ?? 8;

  const winX = pickWinningAxisSnap(
    solveVisioPortAxisSnap(rawX, portPairs, 'x', portTol),
    solveVisioEqualSpacingSnap(rawX, rawY, w, h, siblings, 'x', spaceTol),
    solveVisioCardEdgeSnap(rawX, w, siblings, 'x', alignTol)
  );
  const finalX = winX ? winX.targetPos : rawX;

  const winY = pickWinningAxisSnap(
    solveVisioPortAxisSnap(rawY, portPairs, 'y', portTol),
    solveVisioEqualSpacingSnap(finalX, rawY, w, h, siblings, 'y', spaceTol),
    solveVisioCardEdgeSnap(rawY, h, siblings, 'y', alignTol)
  );
  const finalY = winY ? winY.targetPos : rawY;

  const finalSpaceX = solveVisioEqualSpacingSnap(finalX, finalY, w, h, siblings, 'x', 0.5);
  const finalSpaceY = solveVisioEqualSpacingSnap(finalX, finalY, w, h, siblings, 'y', 0.5);
  const portSnaps = [
    ...wbSnapBuildAxisPortSnaps(solveVisioPortAxisSnap(finalX, portPairs, 'x', 0.5), 'x', finalY),
    ...wbSnapBuildAxisPortSnaps(solveVisioPortAxisSnap(finalY, portPairs, 'y', 0.5), 'y', finalX)
  ];
  return {
    x: finalX, y: finalY, dx: finalX - rawX, dy: finalY - rawY,
    snappedX: Boolean(winX), snappedY: Boolean(winY),
    winnerX: winX ? winX.kind : null, winnerY: winY ? winY.kind : null,
    portSnaps,
    alignGuides: collectVisioMatchedAlignGuides(finalX, finalY, w, h, siblings),
    equalGapsX: (finalSpaceX && finalSpaceX.segments.length >= 2) ? finalSpaceX.segments : [],
    equalGapsY: (finalSpaceY && finalSpaceY.segments.length >= 2) ? finalSpaceY.segments : []
  };
}

function wbSnapRenderGapRulerSvg(seg, safeEsc) {
  const gapPx = Math.round(seg.gap), labelTxt = `${gapPx}px`, pillW = Math.max(32, labelTxt.length * 6.8 + 12);
  if (seg.axis === 'y') {
    const rx = seg.crossPos, y1 = seg.p1, y2 = seg.p2, midY = (y1 + y2) / 2;
    const arrows = (y2 - y1) >= 14 ? `<polyline class="vs-gap-arrow" points="${rx - 3.5},${y1 + 5} ${rx},${y1 + 0.8} ${rx + 3.5},${y1 + 5}"></polyline><polyline class="vs-gap-arrow" points="${rx - 3.5},${y2 - 5} ${rx},${y2 - 0.8} ${rx + 3.5},${y2 - 5}"></polyline>` : '';
    const pillX = (y2 - y1) >= 22 ? rx - pillW / 2 : rx + 12, txtX = (y2 - y1) >= 22 ? rx : rx + 12 + pillW / 2;
    return `<g class="vs-gap-ruler-group" data-snap-kind="equal-gap" data-snap-axis="y" data-gap="${gapPx}"><line class="vs-gap-ruler" x1="${rx}" y1="${y1}" x2="${rx}" y2="${y2}"></line><line class="vs-gap-cap" x1="${rx - 8}" y1="${y1}" x2="${rx + 8}" y2="${y1}"></line><line class="vs-gap-cap" x1="${rx - 8}" y1="${y2}" x2="${rx + 8}" y2="${y2}"></line>${arrows}<rect class="vs-gap-pill" x="${pillX}" y="${midY - 9}" width="${pillW}" height="18" rx="5"></rect><text class="vs-ruler-label" x="${txtX}" y="${midY + 3.5}" text-anchor="middle">${safeEsc(labelTxt)}</text></g>`;
  }
  const ry = seg.crossPos, x1 = seg.p1, x2 = seg.p2, midX = (x1 + x2) / 2;
  const arrows = (x2 - x1) >= 14 ? `<polyline class="vs-gap-arrow" points="${x1 + 5},${ry - 3.5} ${x1 + 0.8},${ry} ${x1 + 5},${ry + 3.5}"></polyline><polyline class="vs-gap-arrow" points="${x2 - 5},${ry - 3.5} ${x2 - 0.8},${ry} ${x2 - 5},${ry + 3.5}"></polyline>` : '';
  const pillY = (x2 - x1) >= 38 ? ry - 9 : ry - 23;
  return `<g class="vs-gap-ruler-group" data-snap-kind="equal-gap" data-snap-axis="x" data-gap="${gapPx}"><line class="vs-gap-ruler" x1="${x1}" y1="${ry}" x2="${x2}" y2="${ry}"></line><line class="vs-gap-cap" x1="${x1}" y1="${ry - 8}" x2="${x1}" y2="${ry + 8}"></line><line class="vs-gap-cap" x1="${x2}" y1="${ry - 8}" x2="${x2}" y2="${ry + 8}"></line>${arrows}<rect class="vs-gap-pill" x="${midX - pillW / 2}" y="${pillY}" width="${pillW}" height="18" rx="5"></rect><text class="vs-ruler-label" x="${midX}" y="${pillY + 12.5}" text-anchor="middle">${safeEsc(labelTxt)}</text></g>`;
}

function wbSnapRenderPortSnapSvg(ps) {
  if (ps.axis === 'y') {
    const x1 = Math.min(ps.dragPortX, ps.peerPortX) - 18, x2 = Math.max(ps.dragPortX, ps.peerPortX) + 18;
    const midX = (ps.dragPortX + ps.peerPortX) / 2;
    const badge = Math.abs(ps.dragPortX - ps.peerPortX) >= 48 ? `<rect class="vs-port-snap-pill" x="${midX - 28}" y="${ps.linePos - 21}" width="56" height="16" rx="4"></rect><text class="vs-ruler-label" x="${midX}" y="${ps.linePos - 9.5}" text-anchor="middle">连线拉直</text>` : '';
    return `<g class="vs-port-snap-group" data-snap-kind="port" data-snap-axis="y"><line class="vs-port-snap-halo" x1="${x1}" y1="${ps.linePos}" x2="${x2}" y2="${ps.linePos}"></line><line class="vs-port-snap-line" x1="${x1}" y1="${ps.linePos}" x2="${x2}" y2="${ps.linePos}"></line><circle class="vs-port-snap-ring" cx="${ps.dragPortX}" cy="${ps.linePos}" r="5.5"></circle><circle class="vs-port-snap-ring" cx="${ps.peerPortX}" cy="${ps.linePos}" r="5.5"></circle>${badge}</g>`;
  }
  const y1 = Math.min(ps.dragPortY, ps.peerPortY) - 18, y2 = Math.max(ps.dragPortY, ps.peerPortY) + 18;
  const midY = (ps.dragPortY + ps.peerPortY) / 2;
  const badge = Math.abs(ps.dragPortY - ps.peerPortY) >= 48 ? `<rect class="vs-port-snap-pill" x="${ps.linePos + 9}" y="${midY - 8}" width="56" height="16" rx="4"></rect><text class="vs-ruler-label" x="${ps.linePos + 37}" y="${midY + 3.5}" text-anchor="middle">连线拉直</text>` : '';
  return `<g class="vs-port-snap-group" data-snap-kind="port" data-snap-axis="x"><line class="vs-port-snap-halo" x1="${ps.linePos}" y1="${y1}" x2="${ps.linePos}" y2="${y2}"></line><line class="vs-port-snap-line" x1="${ps.linePos}" y1="${y1}" x2="${ps.linePos}" y2="${y2}"></line><circle class="vs-port-snap-ring" cx="${ps.linePos}" cy="${ps.dragPortY}" r="5.5"></circle><circle class="vs-port-snap-ring" cx="${ps.linePos}" cy="${ps.peerPortY}" r="5.5"></circle>${badge}</g>`;
}

export function renderVisioSnapSvgMarkup(snap, escFn) {
  if (!snap) return '';
  const safeEsc = typeof escFn === 'function' ? escFn : (s) => String(s ?? '');
  const parts = [];
  for (const g of (snap.alignGuides || [])) {
    const cls = g.isCenter ? 'vs-align-line is-center' : 'vs-align-line';
    parts.push(g.axis === 'x'
      ? `<line class="${cls}" data-snap-kind="align" data-snap-anchor="${safeEsc(g.anchor)}" x1="${g.pos}" y1="${g.start}" x2="${g.pos}" y2="${g.end}"></line>`
      : `<line class="${cls}" data-snap-kind="align" data-snap-anchor="${safeEsc(g.anchor)}" x1="${g.start}" y1="${g.pos}" x2="${g.end}" y2="${g.pos}"></line>`);
  }
  for (const seg of [...(snap.equalGapsY || []), ...(snap.equalGapsX || [])]) parts.push(wbSnapRenderGapRulerSvg(seg, safeEsc));
  for (const ps of (snap.portSnaps || [])) parts.push(wbSnapRenderPortSnapSvg(ps));
  return parts.join('');
}

function wbSnapReadLeadWorldOrigin(leadEl) {
  const zoom = (typeof state !== 'undefined' && state.zoom) ? state.zoom : 1;
  const worldEl = document.getElementById('canvas-world');
  let x = leadEl.offsetLeft, y = leadEl.offsetTop;
  if (typeof leadEl.getBoundingClientRect === 'function' && worldEl && typeof worldEl.getBoundingClientRect === 'function') {
    const cr = leadEl.getBoundingClientRect(), wr = worldEl.getBoundingClientRect();
    if (cr && wr && (cr.width > 0 || cr.height > 0)) {
      x = (cr.left - wr.left) / zoom;
      y = (cr.top - wr.top) / zoom;
    }
  }
  return { x, y };
}

function wbSnapCollectWorkshopMoveEdges(movingIdsSet) {
  const graph = getActiveWorkshopGraph();
  const rawEdges = [];
  for (const lk of (graph && Array.isArray(graph.links) ? graph.links : [])) {
    if (!lk || lk.fromNode === lk.toNode || movingIdsSet.has(lk.fromNode) === movingIdsSet.has(lk.toNode)) continue;
    const muted = typeof isWorkshopLinkMuted === 'function' ? Boolean(isWorkshopLinkMuted(graph, lk)) : false;
    rawEdges.push(movingIdsSet.has(lk.fromNode)
      ? { selfNode: lk.fromNode, selfDir: 'out', selfSlot: lk.fromSlot, peerNode: lk.toNode, peerDir: 'in', peerSlot: lk.toSlot, muted }
      : { selfNode: lk.toNode, selfDir: 'in', selfSlot: lk.toSlot, peerNode: lk.fromNode, peerDir: 'out', peerSlot: lk.fromSlot, muted });
  }
  return rawEdges;
}

function wbSnapCollectSandboxFlowMoveEdges(movingIdsSet) {
  const container = getActiveSandboxContainer();
  const rawEdges = [];
  for (const src of (container && Array.isArray(container.nodes) ? container.nodes : [])) {
    const muted = Boolean(src.bypassed);
    for (const tid of (src.nextIds || [])) {
      if (src.id === tid || movingIdsSet.has(src.id) === movingIdsSet.has(tid)) continue;
      rawEdges.push(movingIdsSet.has(src.id)
        ? { selfNode: src.id, selfDir: 'out', selfSlot: 'out', peerNode: tid, peerDir: 'in', peerSlot: 'in', muted }
        : { selfNode: tid, selfDir: 'in', selfSlot: 'in', peerNode: src.id, peerDir: 'out', peerSlot: 'out', muted });
    }
  }
  return rawEdges;
}

function collectConnectedPortPairsForMove(movingIdsSet, leadEl) {
  if (typeof getPinWorldPos !== 'function' || !leadEl) return [];
  const leadOrigin = wbSnapReadLeadWorldOrigin(leadEl);
  let rawEdges = [];
  if (typeof state !== 'undefined' && state.page === 'workshop' && typeof getActiveWorkshopGraph === 'function') {
    rawEdges = wbSnapCollectWorkshopMoveEdges(movingIdsSet);
  } else if (typeof state !== 'undefined' && state.sandboxLayout === 'flow' && typeof getActiveSandboxContainer === 'function') {
    rawEdges = wbSnapCollectSandboxFlowMoveEdges(movingIdsSet);
  }
  const pairs = [];
  for (const edge of rawEdges) {
    const selfPt = getPinWorldPos(edge.selfNode, edge.selfDir, edge.selfSlot);
    const peerPt = getPinWorldPos(edge.peerNode, edge.peerDir, edge.peerSlot);
    if (selfPt && peerPt) {
      pairs.push({ portOffsetX: selfPt.x - leadOrigin.x, portOffsetY: selfPt.y - leadOrigin.y, peerPortX: peerPt.x, peerPortY: peerPt.y, peerNodeId: edge.peerNode, muted: edge.muted });
    }
  }
  return pairs;
}

function computeMoveWithVsSnap(movingIdsSet, leadId, rawX, rawY, opts = {}) {
  const leadEl = document.getElementById(`card-${leadId}`);
  const svg = document.getElementById('snaplines-svg');
  if (!leadEl) return { x: rawX, y: rawY, snappedX: false, snappedY: false };
  if (opts && opts.altKey) {
    if (svg) svg.innerHTML = '';
    return { x: rawX, y: rawY, snappedX: false, snappedY: false };
  }
  const nodes = getActiveNodesList();
  const leadNode = nodes.find((n) => n.id === leadId);
  const w = leadEl.offsetWidth || (leadNode && leadNode.w) || 252;
  const h = leadEl.offsetHeight || (leadNode && leadNode.h) || 140;
  const zoom = (typeof state !== 'undefined' && state.zoom) ? state.zoom : 1;
  const adaptiveTol = Math.min(12, Math.max(6, Math.round(8 / Math.max(0.5, zoom))));
  const siblings = [];
  nodes.forEach((n) => {
    if (movingIdsSet.has(n.id)) return;
    const el = document.getElementById(`card-${n.id}`);
    if (!el || (el.style && el.style.display === 'none')) return;
    siblings.push({ id: n.id, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth || n.w || 252, h: el.offsetHeight || n.h || 140 });
  });
  const result = solveVisioMoveSnap({
    rawX, rawY, w, h, altKey: false, siblings,
    portPairs: collectConnectedPortPairsForMove(movingIdsSet, leadEl),
    alignTol: Math.max(6, adaptiveTol - 1), spaceTol: adaptiveTol, portTol: adaptiveTol
  });
  if (svg) svg.innerHTML = renderVisioSnapSvgMarkup(result, typeof esc === 'function' ? esc : undefined);
  return result;
}

const WB_SNAP_SOLVER_FNS = [
  wbSnapReadPortPairAxis, wbSnapCollectPortMatches, solveVisioPortAxisSnap,
  wbSnapEvalAnchorPair, solveVisioCardEdgeSnap,
  wbSnapMatchAxisGuides, collectVisioMatchedAlignGuides,
  wbSnapProjectCrossSiblings, wbSnapCandBetween, wbSnapCandStep, wbSnapPickBestSpacingCand,
  wbSnapWalkGapSide, wbSnapFormatGapSegment, solveVisioEqualSpacingSnap,
  pickWinningAxisSnap, wbSnapBuildAxisPortSnaps, solveVisioMoveSnap,
  wbSnapRenderGapRulerSvg, wbSnapRenderPortSnapSvg, renderVisioSnapSvgMarkup,
  wbSnapReadLeadWorldOrigin, wbSnapCollectWorkshopMoveEdges, wbSnapCollectSandboxFlowMoveEdges,
  collectConnectedPortPairsForMove, computeMoveWithVsSnap
];

const WB_LEGACY_SNAP_SCRIPT = `
function clearSnaplines() { const svg = document.getElementById('snaplines-svg'); if (svg) svg.innerHTML = ''; }
function computeResizeWithVsSnap(resizingId, rawW, rawH, minW = 164, minH = 72) {
  const nodes = getActiveNodesList(), selfNode = nodes.find((n) => n.id === resizingId);
  if (!selfNode) return { w: Math.max(minW, rawW), h: Math.max(minH, rawH) };
  const siblings = [];
  nodes.forEach((n) => {
    if (n.id === resizingId) return;
    const el = document.getElementById(\`card-\${n.id}\`);
    if (el) siblings.push({ id: n.id, title: n.title, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight });
  });
  const SNAP_TOL = 8;
  let finalW = rawW, finalH = rawH, matchedWidthCards = [], matchedHeightCards = [], alignRightCard = null, alignBottomCard = null;
  let bestWDiff = SNAP_TOL + 1;
  siblings.forEach((sib) => { if (sib.w >= minW) { const d = Math.abs(rawW - sib.w); if (d <= SNAP_TOL && d < bestWDiff) { bestWDiff = d; finalW = sib.w; } } });
  if (bestWDiff <= SNAP_TOL) matchedWidthCards = siblings.filter((sib) => Math.abs(sib.w - finalW) <= 1);
  else siblings.forEach((sib) => { const candW = sib.right - selfNode.x; if (candW >= minW && Math.abs((selfNode.x + rawW) - sib.right) <= SNAP_TOL) { finalW = candW; alignRightCard = sib; } });
  let bestHDiff = SNAP_TOL + 1;
  siblings.forEach((sib) => { if (sib.h >= minH) { const d = Math.abs(rawH - sib.h); if (d <= SNAP_TOL && d < bestHDiff) { bestHDiff = d; finalH = sib.h; } } });
  if (bestHDiff <= SNAP_TOL) matchedHeightCards = siblings.filter((sib) => Math.abs(sib.h - finalH) <= 1);
  else siblings.forEach((sib) => { const candH = sib.bottom - selfNode.y; if (candH >= minH && Math.abs((selfNode.y + rawH) - sib.bottom) <= SNAP_TOL) { finalH = candH; alignBottomCard = sib; } });
  finalW = Math.max(minW, finalW); finalH = Math.max(minH, finalH);
  const svg = document.getElementById('snaplines-svg'), parts = [], sx = selfNode.x, sy = selfNode.y;
  if (alignRightCard) { const rx = sx + finalW; parts.push(\`<line class="vs-align-line" x1="\${rx}" y1="\${Math.min(sy, alignRightCard.y) - 14}" x2="\${rx}" y2="\${Math.max(sy + finalH, alignRightCard.bottom) + 14}"></line>\`); }
  if (alignBottomCard) { const by = sy + finalH; parts.push(\`<line class="vs-align-line" x1="\${Math.min(sx, alignBottomCard.x) - 14}" y1="\${by}" x2="\${Math.max(sx + finalW, alignBottomCard.right) + 14}" y2="\${by}"></line>\`); }
  if (matchedWidthCards.length > 0) {
    const ry = sy - 16, labelTxt = \`W: \${finalW}px · 与 \${matchedWidthCards.length} 张卡片等宽\`, pillW = labelTxt.length * 6.8 + 16, midX = sx + finalW / 2;
    parts.push(\`<line class="vs-size-ruler" x1="\${sx}" y1="\${ry}" x2="\${sx + finalW}" y2="\${ry}"></line><line class="vs-size-ruler" x1="\${sx}" y1="\${ry - 5}" x2="\${sx}" y2="\${ry + 5}"></line><line class="vs-size-ruler" x1="\${sx + finalW}" y1="\${ry - 5}" x2="\${sx + finalW}" y2="\${ry + 5}"></line><rect x="\${midX - pillW / 2}" y="\${ry - 10}" width="\${pillW}" height="19" rx="5" fill="#e11d48"></rect><text class="vs-ruler-label" x="\${midX}" y="\${ry + 3}" text-anchor="middle">\${esc(labelTxt)}</text>\`);
    matchedWidthCards.forEach((mc) => { const mry = mc.y - 10; parts.push(\`<line class="vs-size-match-ref" x1="\${mc.x}" y1="\${mry}" x2="\${mc.x + mc.w}" y2="\${mry}"></line><line class="vs-size-match-ref" x1="\${mc.x}" y1="\${mry - 4}" x2="\${mc.x}" y2="\${mry + 4}"></line><line class="vs-size-match-ref" x1="\${mc.x + mc.w}" y1="\${mry - 4}" x2="\${mc.x + mc.w}" y2="\${mry + 4}"></line>\`); });
  }
  if (matchedHeightCards.length > 0) {
    const rx = sx + finalW + 16, midY = sy + finalH / 2, labelTxt = \`H: \${finalH}px · 与 \${matchedHeightCards.length} 张等高\`, pillW = labelTxt.length * 6.8 + 16;
    parts.push(\`<line class="vs-size-ruler" x1="\${rx}" y1="\${sy}" x2="\${rx}" y2="\${sy + finalH}"></line><line class="vs-size-ruler" x1="\${rx - 5}" y1="\${sy}" x2="\${rx + 5}" y2="\${sy}"></line><line class="vs-size-ruler" x1="\${rx - 5}" y1="\${sy + finalH}" x2="\${rx + 5}" y2="\${sy + finalH}"></line><rect x="\${rx + 8}" y="\${midY - 10}" width="\${pillW}" height="19" rx="5" fill="#e11d48"></rect><text class="vs-ruler-label" x="\${rx + 8 + pillW / 2}" y="\${midY + 3}" text-anchor="middle">\${esc(labelTxt)}</text>\`);
    matchedHeightCards.forEach((mc) => { const mrx = mc.right + 9; parts.push(\`<line class="vs-size-match-ref" x1="\${mrx}" y1="\${mc.y}" x2="\${mrx}" y2="\${mc.bottom}"></line><line class="vs-size-match-ref" x1="\${mrx - 4}" y1="\${mc.y}" x2="\${mrx + 4}" y2="\${mc.y}"></line><line class="vs-size-match-ref" x1="\${mrx - 4}" y1="\${mc.bottom}" x2="\${mrx + 4}" y2="\${mc.bottom}"></line>\`); });
  }
  if (svg) svg.innerHTML = parts.join('');
  return { w: finalW, h: finalH };
}
`;
export function buildWbSnapRulers() {
  const fnsText = WB_SNAP_SOLVER_FNS.map((fn) => fn.toString().replace(/^export\s+/, '')).join('\n\n');
  return `${WB_LEGACY_SNAP_SCRIPT}\n${fnsText}`;
}
