import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from '../vendor/three.module.js';
import { createTaxi } from '../driving.js';
import { createLawGate } from '../assets/law-gate.js';
import { createWorld } from '../world.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourcePaths = [
  'assets/verna-model.js', 'assets/reference-buildings.js', 'assets/metro-frontage.js',
  'assets/law-gate.js', 'assets/geometry-batching.js', 'world.js',
  'assets/mansoura-map.json', 'assets/building-references.json',
];
const number = value => {
  if (!Number.isFinite(value)) throw new Error(`Non-finite OBJ value: ${value}`);
  return (Math.abs(value) < .0000005 ? 0 : value).toFixed(6).replace(/\.?0+$/, '') || '0';
};
const safeName = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');

/** Source east/up/south metres -> Unreal forward/right/up centimetres. */
export function toUnrealPosition(position, origin = { x: 0, y: 0, z: 0 }) {
  return new THREE.Vector3(-(position.z - origin.z) * 100, (position.x - origin.x) * 100, (position.y - origin.y) * 100);
}

export function toUnrealNormal(normal) {
  return new THREE.Vector3(-normal.z, normal.x, normal.y).normalize();
}

export function collectReferenceMeshes(world, buildingId) {
  const referenceGroup = world.root.getObjectByName(buildingId), meshes = [];
  const belongsToReferenceGroup = object => {
    for (let parent = object; parent; parent = parent.parent) if (parent === referenceGroup) return true;
    return false;
  };
  world.root.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material?.userData.preserveReferenceMaterial) || belongsToReferenceGroup(object)) meshes.push(object);
  });
  return meshes;
}

function visible(object) {
  for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
}

/** Serialize actual meshes and instances, retaining all material groups and UVs.
 * MTL is a portable approximation; manifest material fields retain PBR/alpha
 * intent for the UE editor importer. No image fetches are performed here.
 */
export function serializeObj({ name, meshes, origin = { x: 0, y: 0, z: 0 }, isOriginalCanvas = () => false }) {
  const lines = [`# Original authored Mansoura asset; UE centimetres, X forward Y right Z up`, `mtllib ${name}.mtl`, `o ${name}`];
  const materialRecords = [], materials = new Map(), textures = [], textureFiles = new Map();
  const box = new THREE.Box3(), position = new THREE.Vector3(), normal = new THREE.Vector3(), instanceMatrix = new THREE.Matrix4();
  let offset = 0, triangleCount = 0, meshCount = 0, instanceCount = 0;

  function textureFile(texture) {
    if (!texture) return null;
    if (textureFiles.has(texture)) return textureFiles.get(texture);
    if (!texture.isCanvasTexture || !isOriginalCanvas(texture.image) || typeof texture.image?.toBuffer !== 'function')
      throw new Error('Only original CanvasTexture images created during this export may be bundled.');
    const file = `${name}_texture_${String(textures.length).padStart(3, '0')}.png`;
    textures.push({ file, buffer: texture.image.toBuffer('image/png'), width: texture.image.width, height: texture.image.height });
    textureFiles.set(texture, file);
    return file;
  }

  function materialRecord(material) {
    if (!material) throw new Error(`Missing material in ${name}`);
    if (materials.has(material)) return materials.get(material);
    const id = `${safeName(name)}_material_${String(materialRecords.length).padStart(3, '0')}`;
    const baseColor = material.color || new THREE.Color(1, 1, 1);
    const emissive = material.emissive || new THREE.Color(0, 0, 0);
    const intensity = material.emissiveIntensity ?? 1;
    const record = {
      id, name: material.name || id, baseColorLinear: [baseColor.r, baseColor.g, baseColor.b],
      emissiveLinear: material.isMeshBasicMaterial ? [baseColor.r, baseColor.g, baseColor.b] : [emissive.r * intensity, emissive.g * intensity, emissive.b * intensity],
      roughness: material.roughness ?? .8, metalness: material.metalness ?? 0,
      clearcoat: material.clearcoat ?? 0, clearcoatRoughness: material.clearcoatRoughness ?? 0,
      opacity: material.opacity ?? 1, alphaTest: material.alphaTest ?? 0,
      transparent: !!material.transparent, doubleSided: material.side === THREE.DoubleSide,
      unlit: !!material.isMeshBasicMaterial,
      baseColorTexture: textureFile(material.map),
      emissiveTexture: textureFile(material.emissiveMap || (material.isMeshBasicMaterial ? material.map : null)),
    };
    record.alphaTexture = (record.transparent || record.alphaTest > 0) ? record.baseColorTexture : null;
    for (const value of [...record.baseColorLinear, ...record.emissiveLinear, record.roughness, record.metalness, record.opacity])
      if (!Number.isFinite(value)) throw new Error(`Non-finite material in ${name}`);
    materialRecords.push(record); materials.set(material, record); return record;
  }

  for (const mesh of meshes) {
    if (!mesh.isMesh || !visible(mesh)) continue;
    mesh.updateWorldMatrix(true, false);
    let geometry = mesh.geometry, copied = false;
    if (!geometry.attributes.position) continue;
    if (!geometry.attributes.normal) { geometry = geometry.clone(); geometry.computeVertexNormals(); copied = true; }
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uvs = geometry.attributes.uv;
    const indices = geometry.index, count = indices?.count ?? positions.count;
    const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geometry.groups;
    const countInstances = mesh.isInstancedMesh ? mesh.count : 1;
    meshCount++;
    for (let instance = 0; instance < countInstances; instance++) {
      const matrix = mesh.matrixWorld.clone();
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(instance, instanceMatrix); matrix.multiply(instanceMatrix); }
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      // The Three->UE axis conversion has determinant -1. Account for mirrored
      // source instances too, so every exported face agrees with its normal.
      const reverseWinding = matrix.determinant() >= 0;
      lines.push(`g part_${meshCount}_${instance}`);
      for (let i = 0; i < positions.count; i++) {
        position.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        const converted = toUnrealPosition(position, origin); box.expandByPoint(converted);
        lines.push(`v ${number(converted.x)} ${number(converted.y)} ${number(converted.z)}`);
      }
      for (let i = 0; i < positions.count; i++) lines.push(`vt ${number(uvs?.getX(i) ?? 0)} ${number(uvs?.getY(i) ?? 0)}`);
      for (let i = 0; i < positions.count; i++) {
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
        const converted = toUnrealNormal(normal);
        lines.push(`vn ${number(converted.x)} ${number(converted.y)} ${number(converted.z)}`);
      }
      let currentMaterial = null;
      for (let i = start; i + 2 < end; i += 3) {
        const group = Array.isArray(mesh.material) ? groups.find(group => i >= group.start && i + 2 < group.start + group.count) : null;
        const material = meshMaterials[group?.materialIndex ?? 0], record = materialRecord(material);
        if (record.id !== currentMaterial) { lines.push(`usemtl ${record.id}`); currentMaterial = record.id; }
        const face = [0, 1, 2].map(j => offset + (indices ? indices.getX(i + j) : i + j) + 1);
        if (reverseWinding) [face[1], face[2]] = [face[2], face[1]];
        lines.push(`f ${face.map(index => `${index}/${index}/${index}`).join(' ')}`); triangleCount++;
      }
      offset += positions.count; instanceCount++;
    }
    if (copied) geometry.dispose();
  }
  if (!offset || !triangleCount || box.isEmpty()) throw new Error(`No exportable geometry in ${name}`);
  const mtl = ['# Original generated materials; PBR properties also recorded in reference-assets.json'];
  for (const material of materialRecords) {
    mtl.push(`newmtl ${material.id}`, `Kd ${material.baseColorLinear.map(number).join(' ')}`,
      `Ke ${material.emissiveLinear.map(number).join(' ')}`, `d ${number(material.opacity)}`,
      `Ns ${number(Math.min(1000, Math.max(0, 2 / Math.max(.001, material.roughness ** 2) - 2)))}`,
      `Pr ${number(material.roughness)}`, `Pm ${number(material.metalness)}`, `illum ${material.unlit ? 0 : 2}`);
    if (material.baseColorTexture) mtl.push(`map_Kd ${material.baseColorTexture}`);
    if (material.emissiveTexture) mtl.push(`map_Ke ${material.emissiveTexture}`);
    if (material.alphaTexture) mtl.push(`map_d ${material.alphaTexture}`);
    mtl.push('');
  }
  const dimensions = box.getSize(new THREE.Vector3());
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', textures, materials: materialRecords,
    stats: { vertexCount: offset, triangleCount, meshCount, instanceCount, materialCount: materialRecords.length,
      boundsCm: { min: box.min.toArray(), max: box.max.toArray() }, dimensionsCm: { x: dimensions.x, y: dimensions.y, z: dimensions.z } } };
}

function centre(building) {
  return { x: building.points.reduce((sum, p) => sum + p.x, 0) / building.points.length,
    y: 0, z: building.points.reduce((sum, p) => sum + p.z, 0) / building.points.length };
}

function fixture(building) {
  const origin = centre(building);
  return {
    roads: { segments: [{ id: 'export-reference-road', osmId: 0, width: 8, highway: 'residential',
      points: [{ x: origin.x - 100, z: origin.z - 80, nodeId: 1 }, { x: origin.x + 100, z: origin.z - 80, nodeId: 2 }] }] },
    bounds: { minX: origin.x - 300, maxX: origin.x + 300, minZ: origin.z - 300, maxZ: origin.z + 300 },
    start: { x: origin.x, z: origin.z - 80, heading: 0 }, buildings: [building], inferredBuildings: [],
    areas: [], paths: [], landmarks: [], water: [], waterColliders: [], stats: {},
  };
}

export function createAssetSources(map, catalog) {
  const before = JSON.stringify({ buildings: map.buildings, catalog }), assets = [];
  const taxi = createTaxi(new THREE.Scene()); taxi.setPassengers(0); taxi.group.updateMatrixWorld(true);
  const vehicleBox = new THREE.Box3().setFromObject(taxi.group), vehicleMeshes = [];
  taxi.group.traverse(object => { if (object.isMesh) vehicleMeshes.push(object); });
  assets.push({ name: 'SM_Verna', label: 'Original Verna-inspired Mansoura taxi', model: 'verna-lc', status: 'original-model',
    folder: 'Vehicles', origin: { x: 0, y: vehicleBox.min.y, z: 0 }, geometryOrigin: 'vehicle-ground', meshes: vehicleMeshes,
    sourceFiles: ['assets/verna-model.js', 'assets/geometry-batching.js'],
    limitations: ['Original authored interpretation; not a manufacturer model.', 'Complete static mesh; wheel/occupant rigging is not retained by OBJ.'] });

  for (const [model, name] of [['university-administration', 'SM_Administration'], ['metro-yamama', 'SM_Metro']]) {
    const entry = catalog.entries.find(entry => entry.model === model);
    if (!entry) throw new Error(`Missing reference catalog entry: ${model}`);
    const building = map.buildings.find(building => building.id === entry.buildingId);
    if (!building) throw new Error(`Missing mapped reference footprint: ${entry.buildingId}`);
    const world = createWorld(new THREE.Scene(), fixture(building), { entries: [entry], landmarks: [] });
    world.root.updateMatrixWorld(true);
    assets.push({ name, label: entry.name, model, status: entry.status, folder: 'Reference', buildingId: entry.buildingId,
      origin: centre(building), geometryOrigin: 'building-local', meshes: collectReferenceMeshes(world, entry.buildingId), entry,
      sourceFiles: model === 'metro-yamama' ? ['assets/metro-frontage.js'] : ['assets/reference-buildings.js'] });
  }

  const gateEntry = catalog.landmarks.find(entry => entry.model === 'law-gate');
  if (!gateEntry) throw new Error('Missing law-gate catalog entry');
  const gate = createLawGate(gateEntry);
  gate.position.set(gateEntry.position.x, gateEntry.position.y || 0, gateEntry.position.z);
  gate.rotation.y = gateEntry.rotationY;
  gate.updateMatrixWorld(true);
  const gateMeshes = []; gate.traverse(object => { if (object.isMesh) gateMeshes.push(object); });
  const canopy = map.buildings.find(building => building.id === gateEntry.replacesBuildingIds?.[0]);
  if (!canopy) throw new Error('Law gate must identify its replaced mapped canopy');
  const gateWorld = createWorld(new THREE.Scene(), fixture(canopy), { entries: [], landmarks: [gateEntry] });
  const colliders = gateWorld.colliders.filter(collider => collider.sourceBuildingId === canopy.id).map(collider => ({
    polygon: collider.polygon.map(p => ({ x: p.x, z: p.z })), holes: structuredClone(collider.holes || []),
    height: collider.height, sourceId: collider.sourceId,
  }));
  if (!colliders.length) throw new Error('Law gate compound colliders were not generated');
  assets.push({ name: 'SM_LawGate', label: gateEntry.name, model: gateEntry.model, status: gateEntry.status, folder: 'Reference',
    buildingId: canopy.id, replacesBuildingIds: gateEntry.replacesBuildingIds, referenceId: gateEntry.id,
    origin: { x: gateEntry.position.x, y: gateEntry.position.y || 0, z: gateEntry.position.z },
    geometryOrigin: 'building-local', meshes: gateMeshes, entry: gateEntry, colliders,
    sourceFiles: ['assets/law-gate.js', 'assets/geometry-batching.js'] });
  if (JSON.stringify({ buildings: map.buildings, catalog }) !== before) throw new Error('Original map/catalog was mutated during mesh construction');
  return assets;
}

async function hashes(root) {
  const result = {};
  for (const path of sourcePaths) result[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  return result;
}

export async function exportNativeAssets({ root = repositoryRoot, canvasModule = process.env.NATIVE_CANVAS_MODULE } = {}) {
  if (!canvasModule) throw new Error('Set NATIVE_CANVAS_MODULE to the installed @napi-rs/canvas index.js; real canvas rendering is required.');
  const canvas = await import(pathToFileURL(resolve(canvasModule)).href);
  const createCanvas = canvas.createCanvas || canvas.default?.createCanvas;
  if (typeof createCanvas !== 'function') throw new Error('NATIVE_CANVAS_MODULE does not export createCanvas');
  const oldDocument = globalThis.document, originalCanvases = new WeakSet();
  globalThis.document = { createElement(tag) {
    if (tag !== 'canvas') throw new Error(`Unsupported export element: ${tag}`);
    const image = createCanvas(1, 1); originalCanvases.add(image); return image;
  } };
  try {
    const initialHashes = await hashes(root);
    const map = JSON.parse(await readFile(join(root, 'assets/mansoura-map.json'), 'utf8'));
    const catalog = JSON.parse(await readFile(join(root, 'assets/building-references.json'), 'utf8'));
    const sources = createAssetSources(map, catalog);
    const native = join(root, 'native/MansouraTaxi'), output = join(native, 'SourceAssets');
    await mkdir(output, { recursive: true });
    const entries = [];
    for (const asset of sources) {
      const baked = serializeObj({ ...asset, isOriginalCanvas: image => originalCanvases.has(image) });
      await writeFile(join(output, `${asset.name}.obj`), baked.obj);
      await writeFile(join(output, `${asset.name}.mtl`), baked.mtl);
      for (const texture of baked.textures) await writeFile(join(output, texture.file), texture.buffer);
      const assetPath = `/Game/Mansoura/${asset.folder}/${asset.name}`;
      entries.push({ id: asset.referenceId || asset.buildingId || asset.name, name: asset.label,
        model: asset.model, status: asset.status, ...(asset.buildingId ? { buildingId: asset.buildingId } : {}),
        ...(asset.replacesBuildingIds ? { replacesBuildingIds: asset.replacesBuildingIds } : {}),
        source: 'original authored geometry and original generated canvas artwork; reference photographs are not bundled',
        sourceFiles: asset.sourceFiles, geometryOrigin: asset.geometryOrigin,
        x: asset.geometryOrigin === 'building-local' ? asset.origin.x : 0,
        z: asset.geometryOrigin === 'building-local' ? asset.origin.z : 0,
        y: asset.geometryOrigin === 'building-local' ? asset.origin.y : 0, yawDegrees: 0,
        sourceOrigin: asset.origin, obj: `SourceAssets/${asset.name}.obj`, mtl: `SourceAssets/${asset.name}.mtl`,
        assetPath, mesh: assetPath, meshPath: `${assetPath}.${asset.name}`,
        ...baked.stats, materials: baked.materials,
        textures: baked.textures.map(texture => ({ file: `SourceAssets/${texture.file}`, width: texture.width, height: texture.height, origin: 'original CanvasTexture' })),
        ...(asset.colliders ? { colliderCoordinateSystem: 'source-metres-east-x-south-z', colliders: asset.colliders } : {}),
        observationDate: asset.entry?.observationDate ?? null,
        heightSource: asset.entry?.heightSource || asset.entry?.dimensionsSource || null,
        limitations: asset.entry?.remainingUnknowns || asset.limitations,
      });
    }
    const finalHashes = await hashes(root);
    if (JSON.stringify(initialHashes) !== JSON.stringify(finalHashes)) throw new Error('Source files changed during asset export; rerun against a stable source snapshot');
    const manifest = { schemaVersion: 1, generatedAtUTC: new Date().toISOString(),
      coordinateSystem: { units: 'centimetres', axes: 'Unreal X forward, Y right, Z up',
        source: 'Three.js metres: x east, y up, z south', transform: 'UE=(-source.z*100,source.x*100,source.y*100)',
        winding: 'reversed for the axis reflection; mirrored source instances accounted for' },
      importer: { convertScene: false, convertSceneUnit: false, uniformScale: 1, importNormals: true },
      sourceFilesPreserved: true, sourceSha256: initialHashes, entries };
    const manifestFile = join(native, 'Content/Data/reference-assets.json');
    await mkdir(dirname(manifestFile), { recursive: true });
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    for (const entry of entries) console.log(`${entry.mesh}: ${entry.vertexCount} vertices, ${entry.triangleCount} triangles, ${entry.materialCount} materials, ${entry.textures.length} PNGs; ${Object.values(entry.dimensionsCm).map(v => v.toFixed(1)).join(' x ')} cm`);
    return manifest;
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await exportNativeAssets();
}
