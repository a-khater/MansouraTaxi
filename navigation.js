/** Shared OSM node IDs define junctions; bridge crossings are not invented. */
const cache = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const keyFor = p => p.nodeId != null ? String(p.nodeId) : `${p.x.toFixed(3)},${p.z.toFixed(3)}`;

export function roadGraph(roads) {
  if (cache.has(roads)) return cache.get(roads);
  const nodes = new Map(), edges = [];
  for (let si = 0; si < roads.segments.length; si++) {
    const segment = roads.segments[si];
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1], b = segment.points[i];
      const from = keyFor(a), to = keyFor(b), length = distance(a, b);
      if (length < .05) continue;
      if (!nodes.has(from)) nodes.set(from, { ...a, id: from, adjacent: [] });
      if (!nodes.has(to)) nodes.set(to, { ...b, id: to, adjacent: [] });
      const edge = { from, to, length, segmentIndex: si, edgeIndex: i - 1, segmentId: segment.id, oneway: segment.oneway || 0 };
      edges.push(edge);
      if (edge.oneway !== -1) nodes.get(from).adjacent.push({ to, length, edge });
      if (edge.oneway !== 1) nodes.get(to).adjacent.push({ to: from, length, edge });
    }
  }
  const graph = { nodes, edges }; cache.set(roads, graph); return graph;
}

export function nearestRoad(point, roads) {
  let best = null, bestD = Infinity;
  for (let si = 0; si < roads.segments.length; si++) {
    const segment = roads.segments[si];
    for (let ei = 0; ei < segment.points.length - 1; ei++) {
      const a = segment.points[ei], b = segment.points[ei + 1];
      const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      if (length2 < .0025) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2));
      const x = a.x + dx * t, z = a.z + dz * t, d = Math.hypot(point.x - x, point.z - z);
      if (d >= bestD) continue;
      bestD = d;
      best = { x, z, t, segmentId: segment.id, segmentIndex: si, edgeIndex: ei, distance: d, heading: Math.atan2(-dx, -dz), road: segment.name || segment.highway || 'Mansoura street', axis: 'polyline' };
    }
  }
  return best || { x: point.x, z: point.z, distance: Infinity, segmentIndex: -1, edgeIndex: -1 };
}

class Heap {
  items = [];
  push(item) {
    const list = this.items; list.push(item); let i = list.length - 1;
    while (i) { const parent = (i - 1) >> 1; if (list[parent].cost <= item.cost) break; list[i] = list[parent]; i = parent; }
    list[i] = item;
  }
  pop() {
    const list = this.items, first = list[0], tail = list.pop();
    if (!list.length) return first;
    let i = 0;
    while (i * 2 + 1 < list.length) {
      let child = i * 2 + 1;
      if (child + 1 < list.length && list[child + 1].cost < list[child].cost) child++;
      if (list[child].cost >= tail.cost) break;
      list[i] = list[child]; i = child;
    }
    list[i] = tail; return first;
  }
}

export function routeTo(start, end, roads) {
  const a = nearestRoad(start, roads), b = nearestRoad(end, roads);
  if (a.segmentIndex < 0 || b.segmentIndex < 0) return { points: [], length: 0, reachable: false };
  const graph = roadGraph(roads), as = roads.segments[a.segmentIndex], bs = roads.segments[b.segmentIndex];
  const a0 = as.points[a.edgeIndex], a1 = as.points[a.edgeIndex + 1], b0 = bs.points[b.edgeIndex], b1 = bs.points[b.edgeIndex + 1];
  const sameEdge = a.segmentIndex === b.segmentIndex && a.edgeIndex === b.edgeIndex;
  const sameDirection = !as.oneway || (as.oneway === 1 ? b.t >= a.t : b.t <= a.t);
  if (sameEdge && sameDirection) return pack([start, a, b, end], true);
  const costs = new Map(), previous = new Map(), heap = new Heap();
  const addSource = p => {
    const id = keyFor(p), cost = distance(a, p);
    if ((costs.get(id) ?? Infinity) <= cost) return;
    costs.set(id, cost); previous.set(id, null); heap.push({ id, cost });
  };
  if (as.oneway !== 1) addSource(a0);
  if (as.oneway !== -1) addSource(a1);
  if (a.t < .00001) addSource(a0);
  if (a.t > .99999) addSource(a1);
  const ends = new Map();
  if (bs.oneway !== -1 || b.t < .00001) ends.set(keyFor(b0), distance(b0, b));
  if (bs.oneway !== 1 || b.t > .99999) ends.set(keyFor(b1), distance(b1, b));
  let bestEnd = null, bestCost = Infinity;
  while (heap.items.length) {
    const current = heap.pop();
    if (current.cost !== costs.get(current.id)) continue;
    if (current.cost > bestCost) break;
    if (ends.has(current.id) && current.cost + ends.get(current.id) < bestCost) { bestCost = current.cost + ends.get(current.id); bestEnd = current.id; }
    for (const next of graph.nodes.get(current.id)?.adjacent || []) {
      const cost = current.cost + next.length;
      if (cost >= (costs.get(next.to) ?? Infinity)) continue;
      costs.set(next.to, cost); previous.set(next.to, current.id); heap.push({ id: next.to, cost });
    }
  }
  if (bestEnd == null) return { points: [], length: 0, reachable: false, start: a, end: b };
  const path = [];
  for (let id = bestEnd; id != null; id = previous.get(id)) path.unshift(graph.nodes.get(id));
  return pack([start, a, ...path, b, end], true);
}

function pack(raw, reachable) {
  const points = raw.filter((p, i) => !i || distance(p, raw[i - 1]) > .04).map(p => ({ x: p.x, z: p.z }));
  return { points, length: points.reduce((sum, p, i) => sum + (i ? distance(p, points[i - 1]) : 0), 0), reachable };
}

export function fareFor(distance, secondsRemaining, healthLost = 0) {
  return Math.max(30, Math.round(25 + distance * .09 + Math.max(0, secondsRemaining) * .12 - healthLost * .35));
}
