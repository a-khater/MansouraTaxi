import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { createStreetLife } from '../street-life.js';
import { createSpatialQueries } from '../world.js';
import { nearestRoad } from '../navigation.js';

const data = JSON.parse(readFileSync(new URL('../assets/mansoura-map.json', import.meta.url), 'utf8'));
const vehicleRoads = { segments: data.roads.segments.filter(s => !['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(s.highway)) };
function fixture(blocked = null) {
  const colliders = [...data.buildings, ...data.inferredBuildings, ...data.waterColliders].map(shape => {
    const polygon = shape.points;
    return { polygon, holes: shape.holes || [], minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
      minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)) };
  });
  const world = { ...createSpatialQueries(colliders), groundHeight: .14, start: data.start, bounds: data.bounds };
  if (blocked) world.isBlocked = blocked;
  const scene = new THREE.Scene(), street = createStreetLife(scene, world, data);
  return { street, world, scene };
}
function outsideVehicleRoad(p) {
  const road = nearestRoad(p, vehicleRoads), segment = vehicleRoads.segments[road.segmentIndex];
  return road.distance > Math.max(3, Number(segment.width) || 7) / 2 + .30;
}

test('real Mansoura routes and whole stall footprints stay clear of buildings, water and vehicle lanes', () => {
  const { street, world } = fixture();
  assert.ok(street.paths.length >= 3);
  assert.equal(new Set(street.paths.map(p => p.anchorId)).size, 3, 'all three requested gate areas have clear routes');
  assert.ok(street.stats.pedestrians >= 120 && street.stats.pedestrians <= 180, 'the high population is bounded and supported by real clear paths');
  assert.ok(street.stalls.some(s => s.kind === 'shoes') && street.stalls.some(s => s.kind === 'scarves'));
  for (const path of street.paths) {
    for (let d = 0; d <= path.length; d += .35) {
      const p = { x: path.a.x + path.dx * d, z: path.a.z + path.dz * d };
      assert.equal(world.isBlocked(p.x, p.z, .38), false, path.id);
      assert.ok(outsideVehicleRoad(p), 'walk routes use roadside space, not traffic lane centers');
    }
  }
  for (const stand of street.stalls) {
    assert.equal(stand.interpreted, true, 'vendor props are not presented as surveyed locations');
    for (const u of [-1.08, -.54, 0, .54, 1.08]) for (const v of [-.67, 0, .67]) {
      const p = { x: stand.x + stand.dx * u + stand.nx * v, z: stand.z + stand.dz * u + stand.nz * v };
      assert.equal(world.isBlocked(p.x, p.z, .18), false);
      assert.ok(outsideVehicleRoad(p), 'the full stand envelope remains out of the carriageway');
    }
  }
});

test('street-life density and distance culling are reversible and update actual rendered instances', () => {
  const { street } = fixture(), gate = { x: -1790.75, z: -180 };
  street.update(.016, gate, 1);
  const full = street.stats.visiblePedestrians;
  assert.ok(full > 100 && street.stats.visibleStalls > 0);
  street.setDensity(.5); street.update(0, gate, 1);
  assert.equal(street.stats.visiblePedestrians, Math.round(full / 2));
  street.setDensity(0); street.update(0, gate, 1);
  assert.equal(street.stats.visiblePedestrians, 0); assert.equal(street.stats.visibleStalls, 0);
  assert.ok(street.root.children.every(o => o.count === 0 && !o.visible));
  street.setDensity(1); street.update(0, { x: 10000, z: 10000 }, 1);
  assert.equal(street.stats.visiblePedestrians, 0); assert.equal(street.stats.visibleStalls, 0);
  street.update(0, gate, 1);
  assert.equal(street.stats.visiblePedestrians, full);
  assert.ok(street.root.children.some(o => o.isInstancedMesh && o.count > 0));
});

test('walk cycles move people along validated paths with finite instanced transforms', () => {
  const { street, world } = fixture(), gate = { x: -1790.75, z: -180 };
  street.update(0, gate, 0);
  const before = street.people.map(p => ({ x: p.x, z: p.z }));
  for (let step = 0; step < 100; step++) street.update(.08, gate, step * .08);
  assert.ok(street.people.filter((p, i) => Math.hypot(p.x - before[i].x, p.z - before[i].z) > .5).length > 90);
  for (const p of street.people) {
    assert.ok([p.x, p.z, p.heading, p.walkPhase].every(Number.isFinite));
    assert.equal(world.isBlocked(p.x, p.z, .38), false);
    assert.ok(outsideVehicleRoad(p));
  }
  for (const mesh of street.root.children) {
    assert.ok(mesh.isInstancedMesh);
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    if (mesh.instanceColor) assert.ok(mesh.instanceColor.array.every(Number.isFinite));
    assert.ok(mesh.count <= mesh.instanceMatrix.count);
  }
  const paused = street.people.map(p => [p.x, p.z, p.walkPhase]);
  street.update(0, gate, 200);
  assert.deepEqual(street.people.map(p => [p.x, p.z, p.walkPhase]), paused, 'zero simulation time freezes walking');
});

test('no safe sidewalks produces an empty scene instead of unsafe fallback people or stalls', () => {
  const { street } = fixture(() => true);
  assert.equal(street.paths.length, 0); assert.equal(street.stalls.length, 0);
  assert.equal(street.stats.pedestrians, 0);
  street.setDensity(Infinity); street.update(NaN, null, NaN);
  assert.equal(street.stats.visiblePedestrians, 0);
  assert.ok(Object.values(street.stats).filter(v => typeof v === 'number').every(Number.isFinite));
});
