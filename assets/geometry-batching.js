import * as THREE from '../vendor/three.module.js';

/** Bake direct static mesh children into one mesh per material, preserving UVs. */
export function batchStaticMeshes(parent, { transparent = true } = {}) {
  const batches = new Map();
  for (const child of [...parent.children]) {
    if (!child.isMesh || Array.isArray(child.material) || (!transparent && child.material.transparent)) continue;
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(child);
  }
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(m => {
      m.updateMatrix(); let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) { const indexed = g; g = g.toNonIndexed(); indexed.dispose(); }
      return g;
    });
    const count = geometries.reduce((sum, g) => sum + g.attributes.position.count, 0);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let offset = 0;
    for (const g of geometries) {
      const n = g.attributes.position.count;
      positions.set(g.attributes.position.array, offset * 3);
      if (g.attributes.normal) normals.set(g.attributes.normal.array, offset * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
      offset += n; g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); merged.computeBoundingSphere();
    for (const mesh of meshes) { parent.remove(mesh); mesh.geometry.dispose(); }
    const result = new THREE.Mesh(merged, material);
    result.castShadow = meshes.some(m => m.castShadow); result.receiveShadow = meshes.some(m => m.receiveShadow); parent.add(result);
  }
  return parent;
}
