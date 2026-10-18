import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { createWorld } from '../world.js';

globalThis.document = { createElement() { return { getContext() { return {
  fillRect() {}, clearRect() {}, strokeRect() {}, fillText() {}, beginPath() {},
  moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
}; } }; } };

const map = JSON.parse(readFileSync(new URL('../assets/mansoura-map.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../assets/building-references.json', import.meta.url), 'utf8'));
const buildingId = 'building/1154800777/0';
const source = map.buildings.find(b => b.id === buildingId);
const entry = catalog.entries.find(e => e.buildingId === buildingId);
const front = { a: { x: -2125.431, z: -163.629 }, b: { x: -2098.840, z: -164.475 } };
const dx = front.b.x - front.a.x, dz = front.b.z - front.a.z, width = Math.hypot(dx, dz);
const outward = { x: dz / width, z: -dx / width };
const at = (t, distance = 0, y = 0) => ({
  x: front.a.x + dx * t + outward.x * distance,
  z: front.a.z + dz * t + outward.z * distance, y,
});

function fixture() {
  assert.ok(entry, 'the live catalog must register the observed Metro facade');
  assert.equal(entry.model, 'metro-yamama');
  const target = structuredClone(source);
  const decoy = { ...structuredClone(source), id: 'building/metro-decoy/0', osmId: 999999999,
    points: source.points.map(p => ({ x: p.x + 80, z: p.z })) };
  const start = at(.5, 10);
  const data = {
    roads: { segments: [{ id: 'frontage-road', osmId: 167439775, width: 8, highway: 'primary',
      points: [{ x: -2190, z: -177, nodeId: 1 }, { x: -1950, z: -177, nodeId: 2 }] }] },
    bounds: { minX: -2400, maxX: -1700, minZ: -400, maxZ: 200 },
    start: { x: start.x, z: start.z, heading: Math.PI / 2 },
    buildings: [target, decoy], inferredBuildings: [], water: [], waterColliders: [],
    areas: [], paths: [], landmarks: [], stats: {},
  };
  // A copied catalog entry must not attach the observed facade to another way.
  const references = { entries: [structuredClone(entry), { ...structuredClone(entry), buildingId: decoy.id }], landmarks: [] };
  const original = JSON.stringify(data.buildings);
  const scene = new THREE.Scene(), world = createWorld(scene, data, references);
  scene.updateMatrixWorld(true);
  const customMeshes = [];
  world.root.traverse(o => {
    if (o.isMesh && !Array.isArray(o.material) && o.material.userData.preserveReferenceMaterial) customMeshes.push(o);
  });
  return { scene, world, data, original, customMeshes, decoy };
}

function canonicalRing(ring) {
  const points = ring.map(p => `${p.x},${p.z}`);
  if (points[0] === points.at(-1)) points.pop();
  return [points, [...points].reverse()].flatMap(p => p.map((_, i) => [...p.slice(i), ...p.slice(0, i)].join('|'))).sort()[0];
}

function visibleInWorld(object) {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return true;
}

test('Metro replaces the correct mapped mass with visible custom geometry and rejects a wrong OSM way', () => {
  const { world, customMeshes, decoy } = fixture();
  assert.deepEqual(world.referenceBuildings.map(b => b.buildingId), [buildingId]);
  assert.equal(world.colliders.filter(c => c.sourceId === buildingId).length, 1);
  assert.equal(world.colliders.filter(c => c.sourceId === decoy.id).length, 1);
  assert.ok(customMeshes.length > 0, 'authored facade geometry survives the city material batching');

  const bounds = new THREE.Box3();
  for (const mesh of customMeshes) bounds.union(new THREE.Box3().setFromObject(mesh));
  assert.ok(bounds.max.y > 20 && bounds.max.z - bounds.min.z > 20,
    'the reference includes the mapped building volume, not only a labeled flat card');
  assert.ok(bounds.max.x < Math.min(...decoy.points.map(p => p.x)), 'no custom facade is emitted at the decoy');

  const ray = new THREE.Raycaster();
  const observedHeights = new Set();
  for (const y of [1.5, 8, 18, 24]) for (const t of [.2, .5, .8]) {
    const p = at(t, 8, y);
    ray.set(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(-outward.x, 0, -outward.z));
    ray.near = 0; ray.far = 12;
    const hits = ray.intersectObjects(customMeshes);
    if (hits.length) observedHeights.add(y);
  }
  assert.ok(observedHeights.size >= 3, 'street-side rays hit the authored surface across multiple storeys');
  let hasFacadeRelief = false;
  const local = new THREE.Matrix4(), matrix = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const mesh of customMeshes) for (let instance = 0; instance < (mesh.isInstancedMesh ? mesh.count : 1); instance++) {
    if (mesh.isInstancedMesh) { mesh.getMatrixAt(instance, local); matrix.multiplyMatrices(mesh.matrixWorld, local); }
    else matrix.copy(mesh.matrixWorld);
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      const t = ((v.x - front.a.x) * dx + (v.z - front.a.z) * dz) / width ** 2;
      const relief = (v.x - front.a.x) * outward.x + (v.z - front.a.z) * outward.z;
      if (t > .05 && t < .95 && v.y > 4 && v.y < 25 && relief > .2) hasFacadeRelief = true;
    }
  }
  assert.ok(hasFacadeRelief, 'observed projecting balconies have real relief beyond the mapped wall plane');

  // Generic walls are baked into citySurface siblings, so testing the named
  // reference group alone would miss a duplicate old mass behind the facade.
  let genericWallVertices = 0;
  world.root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.material.vertexColors) return;
    const p = mesh.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      if (v.y > 4 && v.x >= -2125.432 && v.x <= -2096.903 && v.z >= -164.476 && v.z <= -136.310) genericWallVertices++;
    }
  });
  assert.equal(genericWallVertices, 0, 'the previous generic target walls are omitted, not overlaid');
});

test('Metro preserves its source outline and provides bounded collision and camera responses', () => {
  const { world, data, original } = fixture();
  const collider = world.colliders.find(c => c.sourceId === buildingId);
  assert.equal(canonicalRing(collider.polygon), canonicalRing(source.points));
  assert.deepEqual(collider.holes, source.holes);
  assert.equal(collider.height, source.height, 'the facade reference does not turn inferred height into a measurement');

  for (const t of [.15, .5, .85]) {
    const outside = at(t, 3), interior = at(t, -3);
    assert.equal(world.isBlocked(outside.x, outside.z, .35), false);
    assert.equal(world.isBlocked(interior.x, interior.z, .35), true);
    const anchor = at(t, 10, 1.7), desired = at(t, -5, 6.1);
    const resolved = world.constrainCamera(anchor, desired, .35);
    assert.equal(resolved.blocked, true);
    assert.ok([resolved.x, resolved.y, resolved.z].every(Number.isFinite));
    assert.equal(world.isBlocked(resolved.x, resolved.z, .35), false);
    const length = Math.hypot(desired.x - anchor.x, desired.y - anchor.y, desired.z - anchor.z);
    assert.ok(Math.hypot(resolved.x - anchor.x, resolved.y - anchor.y, resolved.z - anchor.z) <= length);
    const above = world.constrainCamera({ ...anchor, y: source.height + 1 }, { ...desired, y: source.height + 1 });
    assert.equal(above.blocked, false, 'the camera can pass above the retained building height');
  }
  const top = at(.5, -8, source.height + 5), below = { ...top, y: 4 };
  const roof = world.constrainCamera(top, below, .35);
  assert.equal(roof.blocked, true);
  assert.ok(Number.isFinite(roof.y) && roof.y > source.height + .35 && roof.y <= top.y);
  assert.equal(JSON.stringify(data.buildings), original, 'rendering and collision queries leave all points and holes unchanged');
});

test('Metro custom batches stay finite and return when their geographic chunk is restored', () => {
  const { world, scene, customMeshes } = fixture();
  assert.ok(customMeshes.length > 0);
  const focus = at(.5, 10);
  world.setFocus(focus.x, focus.z);
  const near = customMeshes.filter(visibleInWorld);
  assert.ok(near.length > 0);
  for (const mesh of customMeshes) {
    assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
    for (const attr of Object.values(mesh.geometry.attributes)) assert.ok(attr.array.every(Number.isFinite));
    if (mesh.isInstancedMesh) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    assert.ok([...mesh.geometry.boundingBox.min, ...mesh.geometry.boundingBox.max, mesh.geometry.boundingSphere.radius].every(Number.isFinite));
  }
  world.setFocus(6000, 6000);
  assert.equal(customMeshes.some(visibleInWorld), false, 'actual rendered reference batches follow the district culling');
  world.setFocus(focus.x, focus.z); scene.updateMatrixWorld(true);
  assert.deepEqual(customMeshes.filter(visibleInWorld), near, 'all previously visible custom batches return');
});
