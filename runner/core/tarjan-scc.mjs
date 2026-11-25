// Tarjan (1972) O(V+E) 强连通分量缩点 DAG 拓扑序与分量内净流出度排序器（<= 350 行）

function tsccBuildDependentsGraph(ids, idSet, providerMap) {
  const dependents = new Map(ids.map((id) => [id, new Set()]));
  for (const id of ids) {
    for (const dep of providerMap.get(id) || []) {
      if (idSet.has(dep) && dep !== id) dependents.get(dep).add(id);
    }
  }
  return dependents;
}

function tsccPopComponent(u, stack, onStack) {
  const comp = [];
  while (stack.length > 0) {
    const w = stack.pop();
    onStack.delete(w);
    comp.push(w);
    if (w === u) break;
  }
  return comp;
}

export function findTarjanSccs(ids, dependents) {
  let timer = 0;
  const disc = new Map(), low = new Map(), onStack = new Set(), stack = [], sccs = [];
  const visit = (u) => {
    disc.set(u, timer);
    low.set(u, timer);
    timer += 1;
    stack.push(u);
    onStack.add(u);
    for (const v of [...(dependents.get(u) || [])].sort()) {
      if (!disc.has(v)) {
        visit(v);
        low.set(u, Math.min(low.get(u), low.get(v)));
      } else if (onStack.has(v)) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
    if (low.get(u) === disc.get(u)) sccs.push(tsccPopComponent(u, stack, onStack));
  };
  for (const id of ids) {
    if (!disc.has(id)) visit(id);
  }
  return sccs;
}

function tsccOrderSingleScc(comp, dependents, providerMap) {
  return [...comp].sort((a, b) => {
    const outA = dependents.get(a)?.size || 0, inA = providerMap.get(a)?.size || 0;
    const outB = dependents.get(b)?.size || 0, inB = providerMap.get(b)?.size || 0;
    const netDiff = (outB - inB) - (outA - inA);
    if (netDiff !== 0) return netDiff;
    return inA !== inB ? inA - inB : a.localeCompare(b);
  });
}

function tsccBuildCondensationDag(sccs, sccOf, dependents) {
  const cAdj = new Map(sccs.map((_, i) => [i, new Set()]));
  const cIndeg = new Map(sccs.map((_, i) => [i, 0]));
  for (const [u, outs] of dependents.entries()) {
    const cu = sccOf.get(u);
    for (const v of outs) {
      const cv = sccOf.get(v);
      if (cu !== cv && !cAdj.get(cu).has(cv)) {
        cAdj.get(cu).add(cv);
        cIndeg.set(cv, cIndeg.get(cv) + 1);
      }
    }
  }
  return { cAdj, cIndeg };
}

export function sortNodesByTarjanCondensation(nodes, providerMap) {
  const ids = nodes.map((n) => n.id).sort();
  const dependents = tsccBuildDependentsGraph(ids, new Set(ids), providerMap);
  const sccOf = new Map();
  const sccs = findTarjanSccs(ids, dependents).map((comp, idx) => {
    const sorted = tsccOrderSingleScc(comp, dependents, providerMap);
    for (const m of sorted) sccOf.set(m, idx);
    return sorted;
  });
  const { cAdj, cIndeg } = tsccBuildCondensationDag(sccs, sccOf, dependents);
  const cmpScc = (a, b) => sccs[a][0].localeCompare(sccs[b][0]);
  const q = [...cIndeg.entries()].filter(([, d]) => d === 0).map(([i]) => i).sort(cmpScc);
  const ordered = [];
  while (q.length > 0) {
    const ci = q.shift();
    ordered.push(...sccs[ci]);
    for (const nxt of [...cAdj.get(ci)].sort(cmpScc)) {
      const nextDeg = cIndeg.get(nxt) - 1;
      cIndeg.set(nxt, nextDeg);
      if (nextDeg === 0) {
        q.push(nxt);
        q.sort(cmpScc);
      }
    }
  }
  return { topoOrder: ordered, sccCycles: sccs.filter((c) => c.length > 1) };
}
