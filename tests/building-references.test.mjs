import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { createWorld } from '../world.js';
import { createLawGate } from '../assets/law-gate.js';

globalThis.document = { createElement() { return { getContext() { return {
  fillRect() {}, clearRect() {}, strokeRect() {}, fillText() {}, beginPath() {},
  moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {},
}; } }; } };
const data = JSON.parse(readFileSync(new URL('../assets/mansoura-map.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../assets/building-references.json', import.meta.url)));

test('catalog distinguishes photo references from measured replica claims', () => {
  assert.equal(catalog.visualSimilarityPercent, null);
  assert.ok(catalog.entries.length > 0);
  const ids = new Set();
  for (const entry of [...catalog.entries, ...(catalog.landmarks || [])]) {
    const id = entry.buildingId || entry.id;
    assert.ok(id && !ids.has(id)); ids.add(id);
    assert.equal(entry.status, 'photo-referenced');
    assert.equal(entry.observationDate, null, 'undated photographs are not labeled current');
    assert.ok(entry.references.length >= 2);
    for (const ref of entry.references) assert.match(ref.url, /^https:\/\//);
    assert.ok(entry.remainingUnknowns.length > 0);
    if (entry.buildingId) assert.ok(data.buildings.some(b => b.id === entry.buildingId));
  }
});

test('reference override preserves mapped collision outline and records its estimated height', () => {
  const original = JSON.stringify(data.buildings);
  const world = createWorld(new THREE.Scene(), data, catalog);
  assert.equal(world.referenceBuildings.length, catalog.entries.length);
  assert.equal(world.stats.surveyVerifiedBuildings, 0);
  for (const entry of catalog.entries) {
    const source = data.buildings.find(b => b.id === entry.buildingId);
    const collider = world.colliders.find(c => c.sourceId === entry.buildingId);
    assert.equal(collider.height, entry.height);
    assert.equal(collider.referenceStatus, 'photo-referenced');
    assert.match(collider.heightSource, /estimated|inferred/i);
    const points = p => p.map(v => `${v.x},${v.z}`).sort();
    assert.deepEqual(points(collider.polygon), points(source.points));
    const group = world.root.getObjectByName(entry.buildingId);
    assert.ok(group);
    assert.equal(group.userData.proceduralFallback, false, 'reconstruction replaces generic facade decoration');
  }
  assert.equal(JSON.stringify(data.buildings), original, 'reference interpretation does not rewrite source geometry');
  for (const entry of catalog.landmarks || []) {
    for (const id of entry.replacesBuildingIds || []) {
      assert.ok(data.buildings.some(b => b.id === id));
      assert.equal(world.colliders.some(c => c.sourceId === id), false, 'the old solid canopy mass is replaced');
    }
    const at = (x, z = 0) => ({ x: entry.position.x + Math.cos(entry.rotationY) * x + Math.sin(entry.rotationY) * z,
      z: entry.position.z - Math.sin(entry.rotationY) * x + Math.cos(entry.rotationY) * z });
    for (const x of [-3.8, 3.8]) {
      const p = at(x); assert.equal(world.isBlocked(p.x, p.z, .8), false, 'vehicle arches remain physically open');
    }
    for (const x of [-8.55, 8.55]) {
      const p = at(x); assert.equal(world.isBlocked(p.x, p.z, .4), true, 'solid masonry piers remain collidable');
    }
  }
});

test('law gate has genuine open arches and solid piers rather than a flat facade card', () => {
  const gate = createLawGate(); gate.updateMatrixWorld(true);
  const ray = (x, y) => new THREE.Raycaster(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1), 0, 20).intersectObject(gate, true);
  assert.equal(ray(-3.8, 5.5).length, 0);
  assert.equal(ray(3.8, 5.5).length, 0);
  assert.equal(ray(0, 6).length, 0);
  assert.ok(ray(-8.55, 5.5).length > 0);
  assert.ok(ray(8.55, 5.5).length > 0);
  gate.traverse(o => { if (o.geometry) assert.ok(o.geometry.attributes.position.array.every(Number.isFinite)); });
  const bounds = new THREE.Box3().setFromObject(gate);
  assert.ok(bounds.min.y >= -.001 && bounds.max.y > 9);
  assert.equal(gate.userData.sourceImageReuse, 'reference-only; source photographs are not bundled or applied as textures');
});
