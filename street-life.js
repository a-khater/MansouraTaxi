import * as THREE from './vendor/three.module.js';

const GATES = [
  { id: 'law-gate-3', x: -1790.75, z: -156.78 },
  { id: 'university-administration', x: -2047, z: -94 },
  { id: 'university-main-gate', x: -1680, z: -174 },
];
const MAX_PEOPLE = 180, CULL_RADIUS = 450, WALK_RADIUS = .48;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function projection(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, ll = dx * dx + dz * dz;
  const t = ll ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / ll, 0, 1) : 0;
  return { t, x: a.x + t * dx, z: a.z + t * dz, distance: Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz) };
}

/** Original ambient people and interpreted sidewalk market props.
 * Routes are generated beside mapped roads and checked against world collision.
 * Their placement and merchandise are gameplay interpretations, not surveyed
 * stalls, real vendors, or a claim about who visits the university.
 */
export function createStreetLife(scene, world, data) {
  if (!scene?.add || typeof world?.isBlocked !== 'function') throw new Error('Street life requires a scene and world.isBlocked.');
  const root = new THREE.Group(); root.name = 'Mansoura interpreted street life'; scene.add(root);
  root.userData = { interpretation: 'original animated people and unsurveyed sidewalk shoe/scarf stands', gateAreas: GATES.map(g => ({ ...g })) };
  const bounds = data?.bounds || world.bounds;
  let seed = 904117, density = 1, time = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const edges = [];
  for (const road of data?.roads?.segments || world.roads?.segments || []) {
    if (['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(road.highway)) continue;
    const points = road.points || [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < .1 || !GATES.some(g => projection(g, a, b).distance < 270)) continue;
      edges.push({ a, b, length, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length, width: Math.max(3, Number(road.width) || 7), sourceId: road.id });
    }
  }
  // Local road buckets avoid checking the full city graph for every walk sample.
  const cell = 30, roadBuckets = new Map();
  for (const edge of edges) {
    const padding = edge.width / 2 + 1;
    for (let x = Math.floor((Math.min(edge.a.x, edge.b.x) - padding) / cell); x <= Math.floor((Math.max(edge.a.x, edge.b.x) + padding) / cell); x++) {
      for (let z = Math.floor((Math.min(edge.a.z, edge.b.z) - padding) / cell); z <= Math.floor((Math.max(edge.a.z, edge.b.z) + padding) / cell); z++) {
        const key = `${x}:${z}`; if (!roadBuckets.has(key)) roadBuckets.set(key, []); roadBuckets.get(key).push(edge);
      }
    }
  }
  const inBounds = p => !bounds || p.x > bounds.minX + .7 && p.x < bounds.maxX - .7 && p.z > bounds.minZ + .7 && p.z < bounds.maxZ - .7;
  const offRoad = p => (roadBuckets.get(`${Math.floor(p.x / cell)}:${Math.floor(p.z / cell)}`) || [])
    .every(e => projection(p, e.a, e.b).distance > e.width / 2 + .34);
  const clear = (p, radius = WALK_RADIUS) => inBounds(p) && offRoad(p) && !world.isBlocked(p.x, p.z, radius);

  const paths = [], candidates = [];
  for (const gate of GATES) {
    const nearby = edges.map(e => ({ e, q: projection(gate, e.a, e.b) })).filter(a => a.q.distance < 135)
      .sort((a, b) => a.q.distance - b.q.distance).slice(0, 44);
    for (const { e, q } of nearby) {
      if (e.length < 8) continue;
      const center = q.t * e.length, start = Math.max(.8, center - 32), end = Math.min(e.length - .8, center + 32);
      if (end - start < 8) continue;
      for (const side of [-1, 1]) for (const extra of [1.12, 2.22]) {
        const nx = -e.dz * side, nz = e.dx * side, offset = e.width / 2 + extra;
        let run = [];
        const keep = () => {
          if (run.length > 1) {
            const a = run[0], b = run.at(-1), length = Math.hypot(b.x - a.x, b.z - a.z);
            if (length >= 7.4) candidates.push({ a, b, length, dx: e.dx, dz: e.dz, nx, nz, anchorId: gate.id, sourceRoad: e.sourceId,
              score: length / (22 + Math.hypot((a.x + b.x) / 2 - gate.x, (a.z + b.z) / 2 - gate.z)) });
          }
          run = [];
        };
        const steps = Math.ceil((end - start) / .55);
        for (let i = 0; i <= steps; i++) {
          const along = start + (end - start) * i / steps;
          const p = { x: e.a.x + e.dx * along + nx * offset, z: e.a.z + e.dz * along + nz * offset };
          if (clear(p)) run.push(p); else keep();
        }
        keep();
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (paths.length >= 38 || paths.filter(p => p.anchorId === c.anchorId).length >= 14) continue;
    const middle = { x: (c.a.x + c.b.x) / 2, z: (c.a.z + c.b.z) / 2 };
    if (paths.some(p => Math.abs(p.dx * c.dx + p.dz * c.dz) > .96 && projection(middle, p.a, p.b).distance < .85)) continue;
    paths.push({ ...c, id: 'university-sidewalk-' + paths.length, radius: WALK_RADIUS, interpreted: true });
  }

  const stalls = [];
  function validStand(p, path) {
    // Include the merchandise and small shade rail in the full tested envelope.
    for (const u of [-1.08, -.54, 0, .54, 1.08]) for (const v of [-.67, 0, .67]) {
      const q = { x: p.x + path.dx * u + path.nx * v, z: p.z + path.dz * u + path.nz * v };
      if (!clear(q, .18)) return false;
    }
    return paths.every(route => projection(p, route.a, route.b).distance > 1.38) && stalls.every(s => Math.hypot(s.x - p.x, s.z - p.z) > 8);
  }
  for (const gate of GATES) {
    for (const path of paths.filter(p => p.anchorId === gate.id)) {
      if (stalls.filter(s => s.anchorId === gate.id).length >= 2) break;
      let placed = false;
      for (const fraction of [.22, .72, .47]) {
        for (const offset of [1.90, 2.75, 3.50]) {
          const p = { x: path.a.x + (path.b.x - path.a.x) * fraction + path.nx * offset, z: path.a.z + (path.b.z - path.a.z) * fraction + path.nz * offset };
          if (!validStand(p, path)) continue;
          stalls.push({ ...p, heading: Math.atan2(path.dx, path.dz), dx: path.dx, dz: path.dz, nx: path.nx, nz: path.nz,
            width: 2.16, depth: 1.34, kind: stalls.length % 2 ? 'scarves' : 'shoes', anchorId: gate.id, interpreted: true });
          placed = true; break;
        }
        if (placed) break;
      }
    }
  }

  const shirtColors = ['#c8b991', '#e0d7bc', '#71888b', '#635c77', '#6d765b', '#9b6659', '#455c75', '#b68e56'];
  const trouserColors = ['#383d42', '#4c5362', '#635b50', '#56606b'];
  const robeColors = ['#b6ada0', '#c9c3ad', '#92a3aa', '#d6cbb0'];
  const skinColors = ['#b88866', '#c89c75', '#956b4f', '#d0ac87', '#ad7959'];
  const merchandiseColors = ['#ae675a', '#9a8a57', '#6e8e96', '#aa718b', '#bca88b', '#685d86'];
  const pick = list => list[Math.floor(random() * list.length)];
  const people = [];
  const capacity = Math.min(MAX_PEOPLE, Math.floor(paths.reduce((sum, p) => sum + p.length, 0) / 1.05));
  for (let i = 0; i < capacity; i++) {
    const path = paths[i % paths.length], longRobe = i % 6 === 0;
    people.push({ pathIndex: i % paths.length, distance: random() * path.length, direction: i % 2 ? -1 : 1, speed: .66 + random() * .67,
      walkPhase: random() * Math.PI * 2, pause: random() * 2.3, height: .92 + random() * .14, longRobe,
      top: new THREE.Color(pick(longRobe ? robeColors : shirtColors)), trousers: new THREE.Color(pick(trouserColors)), skin: new THREE.Color(pick(skinColors)),
      hair: new THREE.Color(i % 9 === 0 ? '#77736a' : '#302e2b'), bag: i % 3 === 0, bagColor: new THREE.Color(pick(['#795b43', '#9a8b6b', '#696e65', '#c6b48a'])), x: 0, z: 0, heading: 0 });
  }

  const standard = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .90, flatShading: true });
  const batches = {}, unitBox = new THREE.BoxGeometry(1, 1, 1), unitRod = new THREE.CylinderGeometry(1, 1, 1, 6);
  function batch(name, geometry, count, material = standard) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count)); mesh.name = 'street-life-' + name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = name !== 'hair'; mesh.receiveShadow = true;
    mesh.frustumCulled = false; mesh.count = 0; root.add(mesh); batches[name] = { mesh, used: 0 }; return batches[name];
  }
  batch('torsos', unitBox, MAX_PEOPLE);
  batch('robes', new THREE.CylinderGeometry(.65, 1, 1, 8), MAX_PEOPLE);
  batch('heads', new THREE.SphereGeometry(1, 8, 6), MAX_PEOPLE);
  batch('hair', new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), MAX_PEOPLE, dark);
  batch('clothed-limbs', unitRod, MAX_PEOPLE * 6);
  batch('forearms', unitRod, MAX_PEOPLE * 2);
  batch('shoes-and-bags', unitBox, MAX_PEOPLE * 3, dark);
  batch('bag-straps', unitRod, MAX_PEOPLE, dark);
  batch('stand-boxes', unitBox, 600);
  batch('stand-shoes', new THREE.SphereGeometry(1, 7, 4), 180, dark);
  batch('stand-rails', unitRod, 100);

  const temp = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const shoeColor = new THREE.Color('#333330'), steelColor = new THREE.Color('#615d51'), woodColor = new THREE.Color('#947b58');
  function stamp(name, x, y, z, sx, sy, sz, heading, color, tilt = 0) {
    const b = batches[name], index = b.used++;
    temp.position.set(x, y, z); temp.scale.set(sx, sy, sz); temp.rotation.set(tilt, heading, 0); temp.updateMatrix();
    b.mesh.setMatrixAt(index, temp.matrix); b.mesh.setColorAt(index, color);
  }
  function bone(name, a, b, radius, color) {
    const batch = batches[name], index = batch.used++, length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    temp.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); temp.scale.set(radius, Math.max(.001, length), radius);
    direction.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize(); temp.quaternion.setFromUnitVectors(up, direction); temp.updateMatrix();
    batch.mesh.setMatrixAt(index, temp.matrix); batch.mesh.setColorAt(index, color);
  }
  const ground = (x, z) => (world.heightAt?.(x, z) ?? world.groundHeight ?? .14) + .025;
  function drawPerson(p, moving) {
    const h = p.height, c = Math.cos(p.heading), s = Math.sin(p.heading), floor = ground(p.x, p.z);
    const bob = moving ? Math.sin(p.walkPhase * 2) * .018 : 0;
    const local = (x, y, z) => ({ x: p.x + (c * x + s * z) * h, y: floor + (y + bob) * h, z: p.z + (-s * x + c * z) * h });
    const part = (name, x, y, z, sx, sy, sz, color) => { const q = local(x, y, z); stamp(name, q.x, q.y, q.z, sx * h, sy * h, sz * h, p.heading, color); };
    if (p.longRobe) part('robes', 0, .92, 0, .31, 1.13, .29, p.top);
    else part('torsos', 0, 1.18, 0, .46, .59, .28, p.top);
    part('heads', 0, 1.64, .01, .155, .19, .15, p.skin);
    part('hair', 0, 1.66, .005, .159, .19, .155, p.hair);
    for (const side of [-1, 1]) {
      const phase = p.walkPhase + (side > 0 ? Math.PI : 0), swing = moving ? Math.sin(phase) * .37 : 0;
      const hip = local(side * .12, .91, 0), knee = local(side * .12, .91 - Math.cos(swing) * .39, Math.sin(swing) * .39);
      const ankle = local(side * .12, .10 + (moving ? Math.max(0, Math.sin(phase)) * .07 : 0), Math.sin(swing) * .51);
      bone('clothed-limbs', hip, knee, .076 * h, p.trousers); bone('clothed-limbs', knee, ankle, .063 * h, p.trousers);
      const foot = { x: ankle.x + s * .055, y: floor + .070 * h + (moving ? Math.max(0, Math.sin(phase)) * .05 : 0), z: ankle.z + c * .055 };
      stamp('shoes-and-bags', foot.x, foot.y, foot.z, .14 * h, .11 * h, .27 * h, p.heading, shoeColor);
      const arm = -swing * .45, shoulder = local(side * .25, 1.40, 0), elbow = local(side * .30, 1.08, arm), hand = local(side * .30, .80, arm * 1.8);
      bone('clothed-limbs', shoulder, elbow, .067 * h, p.top); bone('forearms', elbow, hand, .049 * h, p.skin);
      if (side === 1 && p.bag) {
        const bag = local(.34, .83, .01); stamp('shoes-and-bags', bag.x, bag.y, bag.z, .26 * h, .32 * h, .12 * h, p.heading, p.bagColor);
        bone('bag-straps', local(.22, 1.41, .035), local(.37, .99, .035), .015, p.bagColor);
      }
    }
  }
  function drawStand(stand, index) {
    const y = ground(stand.x, stand.z), c = stand.dx, s = stand.dz;
    const local = (u, v) => ({ x: stand.x + c * u + stand.nx * v, z: stand.z + s * u + stand.nz * v });
    const part = (u, yy, v, w, h, d, color) => { const p = local(u, v); stamp('stand-boxes', p.x, y + yy, p.z, w, h, d, Math.atan2(-s, c), color); };
    for (const u of [-.75, .75]) for (const v of [-.32, .32]) part(u, .42, v, .055, .84, .055, woodColor);
    part(0, .84, 0, 1.73, .09, .79, woodColor); part(0, .28, 0, 1.63, .05, .65, woodColor);
    const cloth = new THREE.Color(merchandiseColors[index % merchandiseColors.length]);
    part(0, .895, 0, 1.77, .025, .83, cloth);
    if (stand.kind === 'shoes') {
      for (let pair = 0; pair < 6; pair++) for (const side of [-1, 1]) {
        const p = local(-.65 + pair % 3 * .65 + side * .095, -.21 + Math.floor(pair / 3) * .42);
        stamp('stand-shoes', p.x, y + .97, p.z, .085, .065, .19, Math.atan2(-s, c), pair % 2 ? shoeColor : woodColor);
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const color = new THREE.Color(merchandiseColors[(i + index) % merchandiseColors.length]);
        part(-.66 + i * .22, .93, -.04, .18, .055 + i % 2 * .035, .46, color);
        part(-.66 + i * .22, 1.44, .41, .17, .71, .022, color);
      }
      for (const u of [-.92, .92]) {
        const a = local(u, .45), b = local(u, .45); bone('stand-rails', { ...a, y: y + .15 }, { ...b, y: y + 1.97 }, .024, steelColor);
      }
      const a = local(-.95, .45), b = local(.95, .45); bone('stand-rails', { ...a, y: y + 1.95 }, { ...b, y: y + 1.95 }, .025, steelColor);
    }
  }

  const stats = { density, maxPedestrians: MAX_PEOPLE, pedestrians: capacity, visiblePedestrians: 0, walkPaths: paths.length,
    stalls: stalls.length, visibleStalls: 0, cullRadius: CULL_RADIUS, placement: 'collision-checked interpreted sidewalks; stalls are not surveyed' };
  function setDensity(value) {
    density = clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
    stats.density = density; stats.pedestrians = Math.round(capacity * density);
    return stats.pedestrians;
  }
  function update(dt, player, elapsed) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .10); time = Number.isFinite(elapsed) ? elapsed : time + dt;
    const p = player?.state || player || world.start || GATES[0];
    const px = Number.isFinite(p.x) ? p.x : p.position?.x ?? GATES[0].x, pz = Number.isFinite(p.z) ? p.z : p.position?.z ?? GATES[0].z;
    for (const batch of Object.values(batches)) batch.used = 0;
    let visible = 0, visibleStalls = 0;
    for (let i = 0; i < stats.pedestrians; i++) {
      const person = people[i], path = paths[person.pathIndex];
      const last = person.distance;
      person.pause = Math.max(0, person.pause - dt);
      let moving = person.pause <= 0 && Math.hypot(person.x - px, person.z - pz) > 1.55;
      if (moving) person.distance += person.direction * person.speed * dt;
      if (person.distance < 0 || person.distance > path.length) {
        person.distance = clamp(person.distance, 0, path.length); person.direction *= -1; person.pause = .6 + i % 4 * .35; moving = false;
      }
      const sample = d => ({ x: path.a.x + path.dx * d, z: path.a.z + path.dz * d });
      let q = sample(person.distance);
      // Recheck the actual animated center as a final guard against a narrow
      // mapped corner falling between route-validation samples.
      if (!clear(q, .38)) { person.distance = last; person.direction *= -1; person.pause = .5; moving = false; q = sample(last); }
      person.x = q.x; person.z = q.z; person.heading = Math.atan2(path.dx * person.direction, path.dz * person.direction);
      if (moving) person.walkPhase += person.speed * dt * 5.4;
      if (Math.hypot(person.x - px, person.z - pz) > CULL_RADIUS) continue;
      drawPerson(person, moving); visible++;
    }
    if (density > 0) for (let i = 0; i < stalls.length; i++) {
      const stand = stalls[i]; if (Math.hypot(stand.x - px, stand.z - pz) > CULL_RADIUS) continue;
      drawStand(stand, i); visibleStalls++;
    }
    for (const { mesh, used } of Object.values(batches)) {
      mesh.count = used; mesh.visible = used > 0; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    stats.visiblePedestrians = visible; stats.visibleStalls = visibleStalls; stats.elapsed = time;
  }
  update(0, world.start || GATES[0], 0);
  return { root, paths, stalls, people, stats, update, setDensity };
}
