import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three.module.js';
import { createLawGate } from '../assets/law-gate.js';
import { createSpatialQueries } from '../world.js';
import { collectReferenceMeshes, serializeObj, toUnrealNormal, toUnrealPosition } from '../scripts/export-native-assets.mjs';

const root = new URL('../', import.meta.url), native = new URL('../native/MansouraTaxi/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('Content/Data/reference-assets.json', native), 'utf8'));
const map = JSON.parse(readFileSync(new URL('assets/mansoura-map.json', root), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('assets/building-references.json', root), 'utf8'));
const approximately = (actual, expected, tolerance = .0001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function parseObj(text) {
  const vertices = [], normals = [], uv = [], faces = [], materials = new Set();
  for (const line of text.split('\n')) {
    const [kind, ...fields] = line.trim().split(/\s+/);
    if (['v', 'vn', 'vt'].includes(kind)) {
      const values = fields.map(Number); assert.ok(values.every(Number.isFinite), `non-finite ${kind}`);
      if (kind === 'v') vertices.push(values);
      else if (kind === 'vn') normals.push(values);
      else uv.push(values);
    } else if (kind === 'f') {
      assert.equal(fields.length, 3, 'all exported faces are triangles');
      const face = fields.map(field => field.split('/').map(Number));
      for (const indices of face) {
        assert.equal(indices.length, 3);
        indices.forEach((index, i) => assert.ok(Number.isInteger(index) && index > 0 && index <= [vertices.length, uv.length, normals.length][i]));
      }
      faces.push(face);
    } else if (kind === 'usemtl') materials.add(fields[0]);
  }
  const bounds = new THREE.Box3(); for (const vertex of vertices) bounds.expandByPoint(new THREE.Vector3(...vertex));
  return { vertices, normals, uv, faces, materials, bounds };
}

function assertWindingMatchesNormals(parsed) {
  for (const face of parsed.faces) {
    const points = face.map(indices => new THREE.Vector3(...parsed.vertices[indices[0] - 1]));
    const normal = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize();
    const supplied = new THREE.Vector3(...parsed.normals[face[0][2] - 1]);
    assert.ok(normal.dot(supplied) > .999, 'handedness conversion preserves the outward face normal');
  }
}

test('native conversion uses centimetres, preserves UVs and corrects reflected triangle winding without modifying source geometry', () => {
  assert.deepEqual(toUnrealPosition(new THREE.Vector3(2, 3, 4)).toArray(), [-400, 200, 300]);
  toUnrealNormal(new THREE.Vector3(0, 1, 0)).toArray().forEach((value, i) => approximately(value, [0, 0, 1][i]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const before = geometry.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); mesh.position.set(2, 3, 4);
  const baked = serializeObj({ name: 'Triangle', meshes: [mesh], origin: { x: 2, y: 3, z: 4 } });
  const parsed = parseObj(baked.obj);
  assert.deepEqual(parsed.vertices, [[0, 0, 0], [0, 100, 0], [0, 0, 100]]);
  assert.deepEqual(parsed.uv, [[0, 0], [1, 0], [0, 1]]);
  assertWindingMatchesNormals(parsed);
  assert.deepEqual(geometry.attributes.position.array, before);
  assert.equal(geometry.attributes.normal, undefined, 'normal generation uses a copy');
});

test('OBJ baking expands transformed and mirrored instances and keeps each material group', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const mesh = new THREE.InstancedMesh(geometry, [new THREE.MeshStandardMaterial({ color: 'red' }), new THREE.MeshStandardMaterial({ color: 'blue' })], 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(5, 0, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(7, 0, 0), new THREE.Quaternion(), new THREE.Vector3(-1, 1, 1)));
  const baked = serializeObj({ name: 'Instances', meshes: [mesh] }), parsed = parseObj(baked.obj);
  assert.equal(baked.stats.instanceCount, 2); assert.equal(parsed.faces.length, 4);
  assert.equal(parsed.materials.size, 2); assert.equal(baked.materials.length, 2);
  assertWindingMatchesNormals(parsed);
  assert.deepEqual(parsed.bounds.min.toArray(), [0, 500, 0]);
  assert.deepEqual(parsed.bounds.max.toArray(), [0, 700, 100]);
});

test('reference selection includes authored chunk siblings and lettering while omitting generic city geometry', () => {
  const root = new THREE.Group(), reference = new THREE.Group(); reference.name = 'building/test'; root.add(reference);
  const lettering = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); reference.add(lettering);
  const authored = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); authored.material.userData.preserveReferenceMaterial = true; root.add(authored);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  assert.deepEqual(new Set(collectReferenceMeshes({ root }, reference.name)), new Set([lettering, authored]));
});

test('baked original assets have finite indexed geometry, portable unique materials, real generated PNGs and plausible centimetre bounds', () => {
  assert.equal(manifest.coordinateSystem.units, 'centimetres');
  assert.deepEqual(manifest.importer, { convertScene: false, convertSceneUnit: false, uniformScale: 1, importNormals: true });
  assert.equal(manifest.entries.length, 4);
  const materialIds = new Set();
  for (const entry of manifest.entries) {
    const parsed = parseObj(readFileSync(new URL(entry.obj, native), 'utf8'));
    assert.equal(parsed.vertices.length, entry.vertexCount); assert.equal(parsed.faces.length, entry.triangleCount);
    assert.equal(parsed.normals.length, parsed.vertices.length); assert.equal(parsed.uv.length, parsed.vertices.length);
    assert.equal(parsed.materials.size, entry.materialCount);
    const dimensions = parsed.bounds.getSize(new THREE.Vector3());
    for (const [axis, i] of [['x', 0], ['y', 1], ['z', 2]]) {
      approximately(dimensions[axis], entry.dimensionsCm[axis]);
      approximately(parsed.bounds.min.getComponent(i), entry.boundsCm.min[i]);
      approximately(parsed.bounds.max.getComponent(i), entry.boundsCm.max[i]);
    }
    assert.ok([...parsed.bounds.min, ...parsed.bounds.max].every(value => Math.abs(value) < 12000), 'geometry is local, not accidentally left at city coordinates');
    const mtl = readFileSync(new URL(entry.mtl, native), 'utf8');
    for (const material of entry.materials) {
      assert.ok(!materialIds.has(material.id), 'different assets cannot accidentally reuse an unrelated imported material');
      materialIds.add(material.id); assert.ok(parsed.materials.has(material.id));
      assert.ok(mtl.includes(`newmtl ${material.id}\n`));
      for (const key of ['baseColorTexture', 'emissiveTexture', 'alphaTexture']) if (material[key]) {
        assert.match(material[key], /^SM_[A-Za-z0-9_]+\.png$/);
        assert.ok(entry.textures.some(texture => texture.file === `SourceAssets/${material[key]}`));
      }
    }
    assert.ok(entry.textures.length > 0, 'generated inscriptions and plates are retained');
    for (const texture of entry.textures) {
      assert.equal(texture.origin, 'original CanvasTexture');
      const png = readFileSync(new URL(texture.file, native));
      assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(png.readUInt32BE(16), texture.width); assert.equal(png.readUInt32BE(20), texture.height);
      assert.ok(png.length > 150, 'a real encoded canvas is present');
    }
    assert.equal(entry.mesh, entry.assetPath); assert.ok(entry.meshPath.startsWith(`${entry.assetPath}.`));
  }
  const vehicle = manifest.entries.find(entry => entry.model === 'verna-lc');
  assert.equal(vehicle.geometryOrigin, 'vehicle-ground'); approximately(vehicle.boundsCm.min[2], 0);
  assert.ok(vehicle.dimensionsCm.x > 420 && vehicle.dimensionsCm.x < 450);
  assert.ok(vehicle.dimensionsCm.y > 168 && vehicle.dimensionsCm.y < 220, 'width includes mirrors');
  assert.ok(vehicle.dimensionsCm.z > 139 && vehicle.dimensionsCm.z < 175, 'height includes taxi sign');
});

test('reference manifest targets the mapped buildings once and bakes gate orientation with open compound collision', () => {
  const ids = manifest.entries.filter(entry => entry.buildingId).map(entry => entry.buildingId).sort();
  assert.deepEqual(ids, ['building/1154800777/0', 'building/1187267273/0', 'building/1234849113/0']);
  for (const entry of manifest.entries.filter(entry => entry.buildingId)) {
    assert.equal(entry.geometryOrigin, 'building-local'); assert.equal(entry.yawDegrees, 0);
    const source = map.buildings.find(building => building.id === entry.buildingId); assert.ok(source);
    if (entry.model !== 'law-gate') {
      approximately(entry.x, source.points.reduce((sum, p) => sum + p.x, 0) / source.points.length);
      approximately(entry.z, source.points.reduce((sum, p) => sum + p.z, 0) / source.points.length);
    }
  }
  const entry = manifest.entries.find(entry => entry.model === 'law-gate'), gateEntry = catalog.landmarks.find(entry => entry.model === 'law-gate');
  assert.deepEqual(entry.replacesBuildingIds, gateEntry.replacesBuildingIds);
  approximately(entry.x, gateEntry.position.x); approximately(entry.z, gateEntry.position.z);
  const gate = createLawGate(gateEntry); gate.rotation.y = gateEntry.rotationY; gate.updateMatrixWorld(true);
  const originalBounds = new THREE.Box3().setFromObject(gate, true), expectedBounds = new THREE.Box3();
  for (const x of [originalBounds.min.x, originalBounds.max.x]) for (const y of [originalBounds.min.y, originalBounds.max.y]) for (const z of [originalBounds.min.z, originalBounds.max.z])
    expectedBounds.expandByPoint(toUnrealPosition(new THREE.Vector3(x, y, z)));
  expectedBounds.min.toArray().forEach((value, i) => approximately(entry.boundsCm.min[i], value, .01));
  expectedBounds.max.toArray().forEach((value, i) => approximately(entry.boundsCm.max[i], value, .01));
  const colliders = entry.colliders.map(collider => ({ ...collider, type: 'building',
    minX: Math.min(...collider.polygon.map(p => p.x)), maxX: Math.max(...collider.polygon.map(p => p.x)),
    minZ: Math.min(...collider.polygon.map(p => p.z)), maxZ: Math.max(...collider.polygon.map(p => p.z)) }));
  assert.equal(entry.colliderCoordinateSystem, 'source-metres-east-x-south-z');
  const queries = createSpatialQueries(colliders);
  const at = x => ({ x: entry.x + Math.cos(gateEntry.rotationY) * x, z: entry.z - Math.sin(gateEntry.rotationY) * x });
  for (const x of [-3.8, 3.8]) { const p = at(x); assert.equal(queries.isBlocked(p.x, p.z, .8), false, 'exported vehicle arches remain open'); }
  for (const x of [-8.55, 8.55]) { const p = at(x); assert.equal(queries.isBlocked(p.x, p.z, .4), true, 'exported masonry piers remain solid'); }
});

test('export provenance matches unchanged original model/map files and bundles generated artwork only', () => {
  assert.equal(manifest.sourceFilesPreserved, true);
  for (const [path, expectedHash] of Object.entries(manifest.sourceSha256)) {
    const actualHash = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
    assert.equal(actualHash, expectedHash, `${path} changed; rerun the exporter against current originals`);
  }
  for (const entry of manifest.entries) {
    assert.match(entry.source, /original authored geometry/);
    assert.match(entry.source, /reference photographs are not bundled/);
    for (const texture of entry.textures) assert.ok(fileURLToPath(new URL(texture.file, native)).endsWith('.png'));
  }
});
