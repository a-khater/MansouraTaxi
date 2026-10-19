import * as THREE from './vendor/three.module.js';
import { buildVernaTaxi } from './assets/verna-model.js';
import { batchStaticMeshes } from './assets/geometry-batching.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (value, target, amount) => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const damp = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));

function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function box(parent, material, width, height, depth, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(width, height, depth), material, parent, x, y, z);
}

/** Egyptian Hyundai Verna LC sedan; its forward direction is local -Z. */
export const createTaxi = buildVernaTaxi;

/** Oriented body footprints: neighboring narrow lanes can pass without false hits. */
export function vehiclesOverlap(first, second, padding = .06) {
  const footprint = vehicle => {
    const state = vehicle?.state || vehicle;
    const x = state?.x ?? vehicle?.group?.position?.x ?? vehicle?.position?.x;
    const z = state?.z ?? vehicle?.group?.position?.z ?? vehicle?.position?.z;
    const heading = state?.heading ?? vehicle?.group?.rotation?.y ?? vehicle?.rotation?.y ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) return null;
    return { x, z, width: (vehicle.width ?? vehicle.dimensions?.width ?? state.width ?? 1.68) / 2,
      length: (vehicle.length ?? vehicle.dimensions?.length ?? state.length ?? 4.26) / 2,
      right: { x: Math.cos(heading), z: -Math.sin(heading) }, forward: { x: -Math.sin(heading), z: -Math.cos(heading) } };
  };
  const a = footprint(first), b = footprint(second);
  if (!a || !b) return false;
  const dot = (u, v) => u.x * v.x + u.z * v.z, delta = { x: b.x - a.x, z: b.z - a.z };
  for (const axis of [a.right, a.forward, b.right, b.forward]) {
    const extentA = a.width * Math.abs(dot(axis, a.right)) + a.length * Math.abs(dot(axis, a.forward));
    const extentB = b.width * Math.abs(dot(axis, b.right)) + b.length * Math.abs(dot(axis, b.forward));
    if (Math.abs(dot(delta, axis)) >= extentA + extentB + padding) return false;
  }
  return true;
}

function getBox(item) {
  if (!item || item.disabled) return null;
  if (item.min && item.max) return { minX: item.min.x, maxX: item.max.x, minZ: item.min.z, maxZ: item.max.z };
  if (Number.isFinite(item.minX)) return item;
  if (item.polygon?.length) {
    return { minX: Math.min(...item.polygon.map(p => p.x)), maxX: Math.max(...item.polygon.map(p => p.x)), minZ: Math.min(...item.polygon.map(p => p.z)), maxZ: Math.max(...item.polygon.map(p => p.z)) };
  }
  if (Number.isFinite(item.x) && Number.isFinite(item.z)) {
    const width = item.w ?? item.width ?? 2;
    const depth = item.d ?? item.depth ?? item.length ?? 2;
    return { minX: item.x - width / 2, maxX: item.x + width / 2, minZ: item.z - depth / 2, maxZ: item.z + depth / 2 };
  }
  return null;
}

function circlePolygonContact(x, z, radius, polygon, holes = []) {
  let inside = false, bestDistance = Infinity, nearX = 0, nearZ = 0;
  let nearRing = polygon, nearRingIndex = 0, nearDx = 1, nearDz = 0;
  for (const [ringIndex, ring] of [polygon, ...holes].entries()) {
    let ringInside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i], dx = b.x - a.x, dz = b.z - a.z;
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) ringInside = !ringInside;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t, distance = Math.hypot(x - px, z - pz);
      if (distance < bestDistance) { bestDistance = distance; nearX = px; nearZ = pz; nearRing = ring; nearRingIndex = ringIndex; nearDx = dx; nearDz = dz; }
    }
    if (ringIndex === 0) inside = ringInside;
    else if (ringInside) inside = false;
  }
  if (!inside && bestDistance >= radius) return null;
  let nx = x - nearX, nz = z - nearZ;
  if (inside) { nx *= -1; nz *= -1; }
  const length = Math.hypot(nx, nz);
  if (length > .00001) { nx /= length; nz /= length; }
  else {
    // Edge-center contacts still need the real outward normal, including hole walls.
    const area = nearRing.reduce((sum, a, i) => { const b = nearRing[(i + 1) % nearRing.length]; return sum + a.x * b.z - b.x * a.z; }, 0);
    const direction = (area >= 0 ? 1 : -1) * (nearRingIndex ? -1 : 1), edgeLength = Math.hypot(nearDx, nearDz) || 1;
    nx = nearDz / edgeLength * direction; nz = -nearDx / edgeLength * direction;
  }
  return { x: nx, z: nz, depth: inside ? radius + bestDistance : radius - bestDistance };
}

/** Deterministic driving with substepped collision handling and signed reverse speed. */
export function createDriving(taxi, colliders = [], bounds = {}) {
  const group = taxi.group || taxi;
  const state = { x: group.position.x, z: group.position.z, heading: group.rotation.y, speed: 0, steer: 0, health: 100, distance: 0, collisionTimer: 0, lastImpact: 0, boosting: false };
  const limit = {
    minX: bounds.minX ?? bounds.min?.x ?? -580,
    maxX: bounds.maxX ?? bounds.max?.x ?? 620,
    minZ: bounds.minZ ?? bounds.min?.z ?? -650,
    maxZ: bounds.maxZ ?? bounds.max?.z ?? 650,
  };
  let impactCooldown = 0;
  const collisionBounds = new WeakMap();
  const halfWidth = taxi.dimensions ? taxi.dimensions.width / 2 - .025 : .96;
  const halfLength = taxi.dimensions ? taxi.dimensions.length / 2 - .035 : 1.98;

  function hit(impact) {
    if (impactCooldown <= 0 && impact > 2.2) {
      state.health = Math.max(0, state.health - Math.max(1, impact * .54));
      state.collisionTimer = .4;
      state.lastImpact = impact;
      impactCooldown = .4;
    }
  }

  function sync() {
    group.position.x = state.x;
    group.position.z = state.z;
    group.rotation.y = state.heading;
  }

  return {
    state,
    update(dt, input = {}) {
      dt = clamp(dt, 0, .1);
      if (dt === 0) return state;
      const throttle = clamp(input.throttle || 0, -1, 1);
      const steering = clamp(input.steer || 0, -1, 1);
      const braking = !!input.brake;
      state.boosting = !!input.boost && throttle > 0 && state.speed > 4 && !braking;
      state.steer = damp(state.steer, steering, 9, dt);
      state.collisionTimer = Math.max(0, state.collisionTimer - dt);
      impactCooldown = Math.max(0, impactCooldown - dt);
      const steps = Math.ceil(dt / (1 / 90));
      const step = dt / steps;
      for (let n = 0; n < steps; n++) {
        const oldX = state.x;
        const oldZ = state.z;
        const oldSpeed = state.speed;
        const topSpeed = state.boosting ? 51 : 40;
        const acceleration = state.boosting ? 17.2 : 10.4;
        if (braking) {
          state.speed = approach(state.speed, 0, 25 * step);
        } else if (throttle > 0) {
          if (state.speed < -.25) state.speed = approach(state.speed, 0, 19 * step);
          else if (state.speed <= topSpeed) state.speed = Math.min(topSpeed, state.speed + acceleration * throttle * (1 - Math.pow(Math.max(0, state.speed) / (topSpeed + 3), 2)) * step);
        } else if (throttle < 0) {
          if (state.speed > .25) state.speed = approach(state.speed, 0, 19 * Math.abs(throttle) * step);
          else state.speed = Math.max(-12, state.speed + 7.8 * throttle * step);
        } else {
          state.speed = approach(state.speed, 0, (1.15 + Math.abs(state.speed) * .035) * step);
        }
        if (!state.boosting && state.speed > 40) state.speed = approach(state.speed, 40, 6 * step);
        const grip = braking ? 1.7 : 1;
        const turn = state.steer * (state.speed / (taxi.dimensions?.wheelbase || 2.82)) * Math.tan(.43) / (1 + Math.abs(state.speed) * .078) * grip;
        state.heading += turn * step;
        state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
        state.x -= Math.sin(state.heading) * state.speed * step;
        state.z -= Math.cos(state.heading) * state.speed * step;

        // Oriented footprint reduced to world extents; sliding along facades feels natural.
        const extentX = Math.abs(Math.cos(state.heading)) * halfWidth + Math.abs(Math.sin(state.heading)) * halfLength;
        const extentZ = Math.abs(Math.sin(state.heading)) * halfWidth + Math.abs(Math.cos(state.heading)) * halfLength;
        let collided = false;
        for (const item of colliders) {
          if (!item || item.disabled) continue;
          let b = collisionBounds.get(item);
          if (!b) { b = getBox(item); if (b) collisionBounds.set(item, b); }
          if (!b || state.x + extentX <= b.minX || state.x - extentX >= b.maxX || state.z + extentZ <= b.minZ || state.z - extentZ >= b.maxZ) continue;
          if (item.polygon?.length >= 3) {
            let contact = null;
            for (const offset of [-halfLength + halfWidth, 0, halfLength - halfWidth]) {
              const cx = state.x - Math.sin(state.heading) * offset, cz = state.z - Math.cos(state.heading) * offset;
              const test = circlePolygonContact(cx, cz, halfWidth, item.polygon, item.holes);
              if (test && (!contact || test.depth > contact.depth)) contact = test;
            }
            if (contact) {
              state.x += contact.x * (contact.depth + .025); state.z += contact.z * (contact.depth + .025); collided = true;
            }
            continue;
          }
          const depths = [state.x + extentX - b.minX, b.maxX - state.x + extentX, state.z + extentZ - b.minZ, b.maxZ - state.z + extentZ];
          const smallest = Math.min(...depths);
          const edge = depths.indexOf(smallest);
          if (edge === 0) state.x = b.minX - extentX - .02;
          else if (edge === 1) state.x = b.maxX + extentX + .02;
          else if (edge === 2) state.z = b.minZ - extentZ - .02;
          else state.z = b.maxZ + extentZ + .02;
          collided = true;
        }
        const clampedX = clamp(state.x, limit.minX + extentX, limit.maxX - extentX);
        const clampedZ = clamp(state.z, limit.minZ + extentZ, limit.maxZ - extentZ);
        if (clampedX !== state.x || clampedZ !== state.z) collided = true;
        state.x = clampedX;
        state.z = clampedZ;
        if (collided) {
          hit(Math.abs(oldSpeed));
          state.speed *= -.18;
          if (Math.abs(state.speed) < .8) state.speed = 0;
        }
        state.distance += Math.hypot(state.x - oldX, state.z - oldZ);
      }
      sync();
      taxi.updateVisual?.(dt, state.speed, state.steer);
      return state;
    },
    reset({ x = 0, z = 0, heading = 0 } = {}) {
      Object.assign(state, { x, z, heading, speed: 0, steer: 0, health: 100, distance: 0, collisionTimer: 0, lastImpact: 0, boosting: false });
      impactCooldown = 0;
      sync();
      return state;
    },
  };
}

const trafficTemplates = new Map();
function makeCityCar(scene, color, microbus = false) {
  const group = new THREE.Group();
  const templateKey = `${microbus ? 'bus' : 'sedan'}:${color}`;
  if (trafficTemplates.has(templateKey)) {
    const template = trafficTemplates.get(templateKey);
    for (const item of template.meshes) { const m = new THREE.Mesh(item.geometry, item.material); m.castShadow = true; m.receiveShadow = true; group.add(m); }
    scene.add(group); return { group, width: template.width, length: template.length };
  }
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .43, metalness: .25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x203c48, roughness: .18, metalness: .35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x131a20, roughness: .8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8e9c9e, roughness: .3, metalness: .7 });
  const head = new THREE.MeshStandardMaterial({ color: 0xfbe7aa, emissive: 0xfbe7aa, emissiveIntensity: .7 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xc72b24, emissive: 0xc72b24, emissiveIntensity: .4 });
  const length = microbus ? 5.9 : 4.26;
  const width = microbus ? 2.05 : 1.70;
  box(group, paint, width, microbus ? 1.05 : .62, length, 0, microbus ? .97 : .75, 0);
  if (microbus) {
    box(group, paint, 2.15, .25, 5.65, 0, 2.05, .05);
    box(group, glass, 2.17, .67, 5.38, 0, 1.62, -.02);
    for (const x of [-1.11, 1.11]) {
      for (const z of [-2.55, -1.3, .05, 1.4, 2.55]) box(group, paint, .065, .75, .09, x, 1.65, z);
      box(group, paint, .05, .08, 5.45, x, 1.3, 0);
      box(group, black, .05, .11, 5.55, x, .85, 0);
    }
  } else {
    box(group, glass, 1.68, .62, 2.30, 0, 1.33, .12);
    box(group, paint, 1.75, .10, 2.38, 0, 1.68, .12);
    for (const side of [-1, 1]) box(group, paint, .055, .63, .10, side * .86, 1.35, .13);
  }
  for (const side of [-1, 1]) {
    for (const z of [-length * .32, length * .32]) {
      mesh(new THREE.CylinderGeometry(.41, .41, .26, 12), black, group, side * width / 2, .43, z).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.235, .235, .28, 10), metal, group, side * width / 2, .43, z).rotation.z = Math.PI / 2;
    }
    box(group, head, .42, .16, .035, side * width * .32, .82, -length / 2 - .02);
    box(group, tail, .33, .18, .035, side * width * .34, .82, length / 2 + .02);
  }
  box(group, black, width + .08, .13, .14, 0, .51, -length / 2);
  box(group, black, width + .08, .13, .14, 0, .51, length / 2);
  batchStaticMeshes(group);
  trafficTemplates.set(templateKey, { width, length, meshes: group.children.map(m => ({ geometry: m.geometry, material: m.material })) });
  scene.add(group);
  return { group, width, length };
}

function makeNetworkTraffic(scene, roads) {
  const edges = [], outgoing = new Map();
  const excluded = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'construction', 'proposed', 'platform']);
  const nodeKey = p => p.nodeId != null ? String(p.nodeId) : `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  let seed = 21274;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const add = (a, b, segment, reverse = false) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < .05) return;
    const edge = { a, b, from: nodeKey(a), to: nodeKey(b), length, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length, segment, reverse, id: edges.length };
    const width = segment.width || 6;
    edge.lane = segment.oneway && width < 5.5 ? 0 : clamp(width * .21, .68, 2.7);
    edges.push(edge);
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  };
  for (const segment of roads.segments) {
    if (excluded.has(segment.highway) || !segment.points || segment.points.length < 2) continue;
    const direction = segment.oneway === '-1' || segment.oneway === -1 ? -1 : [true, 'yes', '1', 1].includes(segment.oneway) || segment.junction === 'roundabout' ? 1 : 0;
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1], b = segment.points[i];
      if (direction >= 0) add(a, b, segment);
      if (direction <= 0) add(b, a, segment, true);
    }
  }
  if (!edges.length) return null;
  const cars = [], palette = [0xc7b8a0, 0xe2e4dd, 0x304d62, 0x993f36, 0x426862, 0x6d7779, 0x9a8061, 0x758b95];
  const count = Math.min(120, Math.max(24, Math.round(edges.reduce((sum, e) => sum + e.length, 0) / 1000)));
  let elapsed = 0;
  function pose(edge, distance) {
    const t = clamp(distance / edge.length, 0, 1);
    return { x: THREE.MathUtils.lerp(edge.a.x, edge.b.x, t) - edge.dz * edge.lane, z: THREE.MathUtils.lerp(edge.a.z, edge.b.z, t) + edge.dx * edge.lane };
  }
  function chooseEdge(previous) {
    const all = outgoing.get(previous.to) || [];
    let choices = all.filter(e => e.to !== previous.from);
    if (!choices.length) choices = all;
    if (!choices.length) return null;
    // A straight continuation has more weight, while every legal turn remains possible.
    const weights = choices.map(e => 1.5 + (previous.dx * e.dx + previous.dz * e.dz) * 1.1);
    let pick = random() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < choices.length; i++) { pick -= weights[i]; if (pick <= 0) return choices[i]; }
    return choices.at(-1);
  }
  function place(car, edge, distance) {
    car.edge = edge; car.routeDistance = distance; const p = pose(edge, distance);
    car.x = p.x; car.z = p.z; car.heading = Math.atan2(-edge.dx, -edge.dz); car.speed = 0; car.exitPending = false; car.stoppedFor = 0;
    car.group.position.set(car.x, 0, car.z); car.group.rotation.y = car.heading;
  }
  const totalLength = edges.reduce((sum, e) => sum + e.length, 0);
  function randomEdge() {
    let pick = random() * totalLength;
    for (const edge of edges) { pick -= edge.length; if (pick <= 0) return edge; }
    return edges.at(-1);
  }
  function respawn(car, px, pz, hasPlayer) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const edge = edges[Math.floor(random() * edges.length)], distance = random() * edge.length;
      const point = pose(edge, distance), heading = Math.atan2(-edge.dx, -edge.dz);
      const playerDistance = hasPlayer ? Math.hypot(point.x - px, point.z - pz) : Infinity;
      if (hasPlayer && (playerDistance < 210 || playerDistance > 550)) continue;
      const candidate = { ...point, heading, width: car.width, length: car.length };
      if (cars.some(other => other !== car && other.active && Math.abs(other.x - point.x) < 10 && Math.abs(other.z - point.z) < 10 && vehiclesOverlap(candidate, other, 1.8))) continue;
      place(car, edge, distance); return true;
    }
    return false;
  }
  for (let i = 0; i < count; i++) {
    const car = makeCityCar(scene, palette[i % palette.length], i % 4 === 0);
    Object.assign(car, { index: i, active: true, cruise: 7 + random() * 7, wait: 0 });
    const edge = randomEdge(); place(car, edge, random() * edge.length); cars.push(car);
  }
  return {
    cars,
    setDensity(value) {
      const activeCount = Math.round(count * clamp(Number(value) || 0, 0, 1));
      for (const car of cars) { car.active = car.index < activeCount; car.group.visible = car.active; }
    },
    update(dt, player) {
      dt = clamp(dt, 0, .1); elapsed += dt;
      const p = player?.state || player, px = p?.x ?? p?.position?.x, pz = p?.z ?? p?.position?.z;
      const hasPlayer = Number.isFinite(px) && Number.isFinite(pz);
      let recycled = 0;
      for (const car of cars) {
        if (!car.active) continue;
        // Keep the useful traffic population around the driver without spawning in view.
        const playerDistance = hasPlayer ? Math.hypot(car.x - px, car.z - pz) : Infinity;
        const canLeaveView = !hasPlayer || playerDistance > 160;
        if (recycled < 2 && ((hasPlayer && playerDistance > 700) || ((car.exitPending || car.stoppedFor > 22) && canLeaveView)) && respawn(car, px, pz, hasPlayer)) recycled++;
        if (car.exitPending) { car.speed = 0; continue; }
        const edge = car.edge, forwardX = -Math.sin(car.heading), forwardZ = -Math.cos(car.heading);
        let target = Math.min(car.cruise, ['service', 'living_street'].includes(edge.segment.highway) ? 7 : 14);
        if (hasPlayer) {
          const dx = px - car.x, dz = pz - car.z, along = dx * forwardX + dz * forwardZ, across = Math.abs(dx * -forwardZ + dz * forwardX);
          if (along > -2 && along < 33 && across < 2.4) target = Math.min(target, Math.max(0, (along - 6) * .7));
        }
        for (const other of cars) {
          if (other === car || !other.active) continue;
          const dx = other.x - car.x, dz = other.z - car.z;
          if (Math.abs(dx) > 28 || Math.abs(dz) > 28) continue;
          const along = dx * forwardX + dz * forwardZ, across = Math.abs(dx * -forwardZ + dz * forwardX);
          const sameFlow = Math.cos(other.heading - car.heading) > .7;
          // Crossing drivers have one stable priority; reciprocal yielding freezes junctions.
          if ((sameFlow || other.index < car.index) && along > .1 && along < 25 && across < (car.width + other.width) * .45) target = Math.min(target, Math.max(0, (along - (car.length + other.length) / 2 - 1.6) * .8));
        }
        const nextOptions = outgoing.get(edge.to) || [];
        if (nextOptions.length > 2 && edge.length - car.routeDistance < 18) target = Math.min(target, 7.5);
        car.speed = approach(car.speed, target, (target < car.speed ? 13 : 2.8) * dt);
        car.stoppedFor = car.speed < .15 ? car.stoppedFor + dt : 0;
        car.routeDistance += car.speed * dt;
        let transitions = 0;
        while (car.routeDistance > car.edge.length && transitions++ < 12) {
          car.routeDistance -= car.edge.length;
          const next = chooseEdge(car.edge);
          if (!next) { car.routeDistance = car.edge.length; car.speed = 0; car.exitPending = true; break; }
          car.edge = next;
        }
        const targetPose = pose(car.edge, car.routeDistance), previousX = car.x, previousZ = car.z;
        car.x = damp(car.x, targetPose.x, 12, dt); car.z = damp(car.z, targetPose.z, 12, dt);
        const deltaX = car.x - previousX, deltaZ = car.z - previousZ;
        if (Math.hypot(deltaX, deltaZ) > .003) {
          const desired = Math.atan2(-deltaX, -deltaZ), delta = Math.atan2(Math.sin(desired - car.heading), Math.cos(desired - car.heading));
          car.heading += delta * (1 - Math.exp(-8 * dt));
        }
        car.group.position.set(car.x, 0, car.z); car.group.rotation.y = car.heading;
      }
    },
  };
}

/** Ambient traffic follows the street grid and slows for the player's taxi. */
export function makeTraffic(scene, roads = {}) {
  if (roads.segments?.length) { const networkTraffic = makeNetworkTraffic(scene, roads); if (networkTraffic) return networkTraffic; }
  const vertical = Array.isArray(roads.vertical) ? roads.vertical.map(r => typeof r === 'number' ? r : r.x) : [-400, -200, 0, 200];
  const horizontal = Array.isArray(roads.horizontal) ? roads.horizontal.map(r => typeof r === 'number' ? r : r.z) : [-500, -250, 0, 250, 500];
  const cars = [];
  const palette = [0xd5c7a9, 0xe5e7e2, 0x234b64, 0xa73f34, 0x477c79, 0x5a686c, 0xa8916c, 0x738ea6];
  const lane = 5;
  const total = 36;
  let density = 1;
  let elapsed = 0;
  // Fixed seed keeps traffic evenly distributed and gives reproducible route starts.
  let seed = 8274;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < total; i++) {
    const axis = i % 2 ? 'x' : 'z';
    const dir = i % 4 < 2 ? 1 : -1;
    const line = axis === 'z' ? vertical[Math.floor(random() * vertical.length)] : horizontal[Math.floor(random() * horizontal.length)];
    const car = makeCityCar(scene, palette[i % palette.length], i % 8 === 0);
    const coordinate = axis === 'z' ? -575 + random() * 1150 : -470 + random() * 660;
    Object.assign(car, {
      axis, dir, line,
      x: axis === 'x' ? coordinate : line - dir * lane,
      z: axis === 'z' ? coordinate : line + dir * lane,
      heading: axis === 'z' ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2),
      speed: 0, cruise: 9.5 + random() * 9, active: true, index: i,
    });
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.heading;
    cars.push(car);
  }
  return {
    cars,
    setDensity(value) {
      density = clamp(Number(value) || 0, 0, 1.5);
      for (const car of cars) {
        car.active = car.index < Math.round(total * Math.min(density, 1));
        car.group.visible = car.active;
      }
    },
    update(dt, player) {
      dt = Math.min(.1, dt);
      elapsed += dt;
      const p = player?.state || player;
      const px = p?.x ?? p?.position?.x ?? 1e6;
      const pz = p?.z ?? p?.position?.z ?? 1e6;
      for (const car of cars) {
        if (!car.active) continue;
        const own = car.axis === 'x' ? car.x : car.z;
        let target = car.cruise;
        const along = ((car.axis === 'x' ? px : pz) - own) * car.dir;
        const across = Math.abs((car.axis === 'x' ? pz - car.z : px - car.x));
        if (along > -3 && along < 29 && across < 3.8) target *= clamp((along - 5.8) / 20, 0, 1);
        // Lane following prevents cars from clipping through slower vehicles.
        for (const other of cars) {
          if (other === car || !other.active || other.axis !== car.axis || other.dir !== car.dir || other.line !== car.line) continue;
          const gap = ((car.axis === 'x' ? other.x : other.z) - own) * car.dir;
          if (gap > 0 && gap < 23) target = Math.min(target, Math.max(0, (gap - 7) * .9));
        }
        // Alternating intersection priority gives the grid a gentle traffic rhythm.
        const crossings = car.axis === 'z' ? horizontal : vertical;
        for (const cross of crossings) {
          const gap = (cross - own) * car.dir;
          if (gap > 13 && gap < 32 && ((Math.floor(elapsed / 9) + (car.axis === 'z' ? 0 : 1)) % 2 === 0)) {
            target = Math.min(target, Math.max(0, (gap - 14) * .85));
          }
        }
        car.speed = approach(car.speed, target, (target < car.speed ? 15 : 3.5) * dt);
        if (car.axis === 'x') {
          car.x += car.speed * car.dir * dt;
          if (car.x > 216) car.x = -492;
          if (car.x < -492) car.x = 216;
        } else {
          car.z += car.speed * car.dir * dt;
          if (car.z > 605) car.z = -605;
          if (car.z < -605) car.z = 605;
        }
        car.group.position.set(car.x, 0, car.z);
      }
    },
  };
}
