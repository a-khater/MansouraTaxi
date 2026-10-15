/** Small road-network router for the game's original, compressed street grid. */
export function nearestRoad(point, roads) {
  const vx = roads.vertical.reduce((a, b) => Math.abs(point.x - a) < Math.abs(point.x - b) ? a : b);
  const hz = roads.horizontal.reduce((a, b) => Math.abs(point.z - a) < Math.abs(point.z - b) ? a : b);
  return Math.abs(point.x - vx) < Math.abs(point.z - hz)
    ? { x: vx, z: point.z, axis: 'z', road: vx }
    : { x: point.x, z: hz, axis: 'x', road: hz };
}

function gridRoute(start, end, roads) {
  const a = nearestRoad(start, roads), b = nearestRoad(end, roads);
  const nodes = roads.vertical.flatMap(x => roads.horizontal.map(z => ({ x, z })));
  nodes.push(a, b);
  const source = nodes.length - 2, target = nodes.length - 1;
  const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
  distance[source] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distance[i] < distance[current])) current = i;
    if (current < 0 || !Number.isFinite(distance[current]) || current === target) break;
    visited.add(current);
    for (let i = 0; i < nodes.length; i++) {
      if (i === current) continue;
      const u = nodes[current], v = nodes[i];
      const vertical = Math.abs(u.x - v.x) < .01 && roads.vertical.includes(u.x);
      const horizontal = Math.abs(u.z - v.z) < .01 && roads.horizontal.includes(u.z);
      if (!vertical && !horizontal) continue;
      const next = distance[current] + Math.hypot(u.x - v.x, u.z - v.z);
      if (next < distance[i]) { distance[i] = next; previous[i] = current; }
    }
  }
  const path = [];
  for (let i = target; i >= 0; i = previous[i]) { path.unshift({ x: nodes[i].x, z: nodes[i].z }); if (i === source) break; }
  if (path.length < 2) path.unshift(a);
  const points = [{ x: start.x, z: start.z }, ...path, { x: end.x, z: end.z }];
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > .5);
  return { points: clean, length: clean.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - clean[i - 1].x, p.z - clean[i - 1].z) : 0), 0) };
}

export function routeTo(start, end, roads) {
  // The opposite bank only joins this city's street grid at the bridge.
  // Treating every horizontal street as extending over the Nile would route
  // drivers through water after a bridge crossing.
  const bridgeZ = roads.bridgeZ ?? -500, farBankX = roads.farBankX ?? 610;
  const westernEntry = { x: Math.max(...roads.vertical), z: bridgeZ };
  const connector = point => point.x < 254 ? [point] : point.x >= 592
    ? [point, { x: farBankX, z: point.z }, { x: farBankX, z: bridgeZ }, westernEntry]
    : [point, { x: point.x, z: bridgeZ }, westernEntry];
  let points;
  if (start.x >= 592 && end.x >= 592) points = [start, { x: farBankX, z: start.z }, { x: farBankX, z: end.z }, end];
  else {
    const a = connector(start), b = connector(end);
    const grid = gridRoute(a.at(-1), b.at(-1), roads);
    points = [...a.slice(0, -1), ...grid.points, ...b.slice(0, -1).reverse()];
  }
  points = points.filter((p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > .5);
  return { points, length: points.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) : 0), 0) };
}

export function fareFor(distance, secondsRemaining, healthLost = 0) {
  return Math.max(30, Math.round(25 + distance * .09 + Math.max(0, secondsRemaining) * .12 - healthLost * .35));
}
