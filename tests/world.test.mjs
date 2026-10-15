import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createWorld } from '../world.js';
import { routeTo } from '../navigation.js';

// Signs only need the canvas drawing surface during scene construction.
// Geometry, materials, routing and collision data use the real vendored THREE.
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return { getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }) };
  },
};
const scene = new THREE.Scene();
const world = createWorld(scene);
const obstructed = (x, z, extentX = 2, extentZ = 2) => world.colliders.some(c =>
  x + extentX > c.minX && x - extentX < c.maxX &&
  z + extentZ > c.minZ && z - extentZ < c.maxZ);

test('city construction provides finite geometry, unique accessible landmarks and an open start', () => {
  assert.ok(world.landmarks.length >= 8);
  assert.equal(new Set(world.landmarks.map(l => l.id)).size, world.landmarks.length);
  assert.equal(obstructed(world.start.x, world.start.z), false);
  for (const landmark of world.landmarks) {
    assert.ok(landmark.name && landmark.arabic);
    assert.ok(landmark.x > world.bounds.minX && landmark.x < world.bounds.maxX);
    assert.ok(landmark.z > world.bounds.minZ && landmark.z < world.bounds.maxZ);
    assert.equal(obstructed(landmark.x, landmark.z), false, `${landmark.name} must fit a taxi`);
  }
  scene.traverse(object => {
    if (!object.isMesh) return;
    assert.ok(object.geometry.attributes.position.count > 0);
    const array = object.isInstancedMesh ? object.instanceMatrix.array : object.geometry.attributes.position.array;
    assert.ok(array.every(Number.isFinite), `${object.type} contains nonfinite geometry`);
  });
});

test('both driving lanes remain clear along every western-bank street', () => {
  for (const x of world.roads.vertical) for (let z = -640; z <= 640; z += 2) {
    for (const lane of [-5, 5]) assert.equal(obstructed(x + lane, z, 1, 2), false, `vertical road ${x}, lane ${lane}, z ${z}`);
  }
  for (const z of world.roads.horizontal) for (let x = -570; x <= 210; x += 2) {
    for (const lane of [-5, 5]) assert.equal(obstructed(x, z + lane, 2, 1), false, `horizontal road ${z}, lane ${lane}, x ${x}`);
  }
});

test('Nile blocks vehicles outside the accessible bridge corridor', () => {
  for (let x = 260; x <= 580; x += 4) {
    for (const z of [-600, -550, -450, -250, 0, 250, 500, 600]) assert.equal(obstructed(x, z), true);
    assert.equal(obstructed(x, -500), false, `bridge is blocked at x ${x}`);
  }
});

test('all landmark-to-landmark routes remain on streets with room for the taxi', () => {
  for (const from of world.landmarks) for (const to of world.landmarks) {
    if (from.id === to.id) continue;
    const route = routeTo(from, to, world.roads);
    assert.ok(route.length > 0 && Number.isFinite(route.length));
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
      for (let j = 0; j <= samples; j++) {
        const t = j / samples;
        assert.equal(obstructed(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), false, `${from.id} → ${to.id} route crosses an obstruction`);
      }
    }
  }
});

test('cinematic camera has an unobstructed corridor to the starting taxi', () => {
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    assert.equal(obstructed(213 + (world.start.x - 213) * t, 172 + (world.start.z - 172) * t, .25, .25), false);
  }
});

test('water animation stays finite and night coloring restores on return to day', () => {
  let water;
  scene.traverse(object => { if (object.material?.uniforms?.colorA) water = object; });
  assert.ok(water);
  const uniforms = water.material.uniforms;
  const day = uniforms.colorA.value.clone();
  const dayFog = uniforms.fogColor.value.clone();
  world.setNight(true);
  assert.ok(uniforms.colorA.value.r + uniforms.colorA.value.g + uniforms.colorA.value.b < day.r + day.g + day.b);
  world.update(1 / 60, 900);
  assert.equal(uniforms.time.value, 900);
  world.setNight(false);
  assert.ok(uniforms.colorA.value.equals(day));
  assert.ok(uniforms.fogColor.value.equals(dayFog));
  scene.updateMatrixWorld(true);
  scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
});
