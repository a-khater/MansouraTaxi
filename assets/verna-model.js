import * as THREE from '../vendor/three.module.js';
import { batchStaticMeshes } from './geometry-batching.js';

// Original mesh modeled from the Egyptian Verna / Accent LC sedan silhouette.
// Body envelope: 4.26 × 1.68 × 1.395 m; wheelbase: 2.44 m.
// References are documented in RESEARCH.md; no third-party meshes/textures used.
const clamp = THREE.MathUtils.clamp;
const damp = (a, b, rate, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-rate * dt));

function part(parent, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function roundedBox(w, h, d, radius = .035, segments = 3) {
  const r = Math.min(radius, w / 2, h / 2, d / 2), shape = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
  shape.moveTo(x, y); shape.lineTo(x + ww, y); shape.lineTo(x + ww, y + hh); shape.lineTo(x, y + hh); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * r, bevelEnabled: true, bevelSegments: segments, steps: 1, bevelSize: r, bevelThickness: r, curveSegments: segments });
  g.translate(0, 0, -d / 2 + r); g.computeVertexNormals(); return g;
}
function block(parent, mat, w, h, d, x, y, z, r = .025) { return part(parent, roundedBox(w, h, d, r), mat, x, y, z); }
function tube(parent, mat, points, radius = .008, closed = false, segments = 32) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  return part(parent, new THREE.TubeGeometry(curve, segments, radius, 5, closed), mat);
}
function surface(parent, mat, fn, rows = 14, columns = 12) {
  const pos = [], uv = [], indices = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    pos.push(...fn(col / columns, row / rows)); uv.push(col / columns, 1 - row / rows);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col, b = a + columns + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals();
  return part(parent, g, mat);
}
function texture(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  draw(ctx, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function decal(parent, t, w, h, x, y, z, rotation = 0, emissive = false) {
  const mat = new THREE.MeshStandardMaterial({ map: t, color: '#ffffff', roughness: .5, metalness: .1, side: THREE.DoubleSide,
    ...(emissive ? { emissiveMap: t, emissive: '#ffffff', emissiveIntensity: .45 } : {}) });
  const m = part(parent, new THREE.PlaneGeometry(w, h), mat, x, y, z); m.rotation.y = rotation; return m;
}
function badge(parent, mat, x, y, z, rotation = 0, scale = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotation; g.scale.setScalar(scale); parent.add(g);
  const oval = part(g, new THREE.TorusGeometry(.055, .006, 5, 32), mat); oval.scale.set(1.7, .85, 1);
  tube(g, mat, [[-.044, -.025, 0], [-.025, .029, 0]], .006, false, 4);
  tube(g, mat, [[.022, -.027, 0], [.041, .026, 0]], .006, false, 4);
  tube(g, mat, [[-.031, -.002, 0], [.030, .007, 0]], .006, false, 4);
  return g;
}
function lampShape(parent, mat, pts, side, z, depth = .035) {
  const shape = new THREE.Shape(); pts.forEach(([x, y], i) => i ? shape.lineTo(side * x, y) : shape.moveTo(side * x, y)); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, bevelSize: .017, bevelThickness: .012, curveSegments: 8 });
  const m = part(parent, g, mat, 0, 0, z); return m;
}

export function buildVernaTaxi(scene) {
  const group = new THREE.Group(); group.name = 'Hyundai Verna — Mansoura taxi'; scene.add(group);
  const body = new THREE.Group(); body.name = 'Verna exterior and cabin'; group.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color: '#853f42', metalness: .54, roughness: .27, clearcoat: .85, clearcoatRoughness: .17, side: THREE.DoubleSide });
  const cream = new THREE.MeshPhysicalMaterial({ color: '#e5ddc9', metalness: .32, roughness: .30, clearcoat: .8, clearcoatRoughness: .2, side: THREE.DoubleSide });
  const black = new THREE.MeshStandardMaterial({ color: '#15191c', roughness: .62, side: THREE.DoubleSide });
  const seal = new THREE.MeshStandardMaterial({ color: '#202322', roughness: .92 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#131516', roughness: .94 });
  const steel = new THREE.MeshStandardMaterial({ color: '#788184', roughness: .40, metalness: .82 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d7dfe1', roughness: .19, metalness: .94 });
  const interior = new THREE.MeshStandardMaterial({ color: '#4a4540', roughness: .95 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#7b7569', roughness: .98 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#87a9ab', transparent: true, opacity: .40, roughness: .10, metalness: .10, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const lamp = new THREE.MeshPhysicalMaterial({ color: '#d8e2d9', metalness: .42, roughness: .16, clearcoat: 1, emissive: '#ffe8ba', emissiveIntensity: .07 });
  const red = new THREE.MeshPhysicalMaterial({ color: '#9c161f', metalness: .15, roughness: .22, clearcoat: 1, emissive: '#e82320', emissiveIntensity: .24 });
  const amber = new THREE.MeshStandardMaterial({ color: '#c37925', emissive: '#e08b26', emissiveIntensity: .08, roughness: .3 });
  const reverse = new THREE.MeshStandardMaterial({ color: '#c9d7cf', roughness: .3 });

  // Rounded body shell, with actual wheel openings in the lower silhouette.
  const stations = [
    [-2.13, .61, .73], [-2.08, .71, .84], [-1.92, .78, .90], [-1.65, .815, .925],
    [-1.25, .835, .935], [-.95, .84, .935], [-.55, .84, .90], [.05, .837, .895],
    [.65, .832, .90], [1.15, .82, .915], [1.55, .80, .90], [1.9, .76, .88], [2.08, .68, .84], [2.13, .58, .79],
  ];
  function section(z) {
    let i = 1; while (i < stations.length - 1 && stations[i][0] < z) i++;
    const a = stations[i - 1], b = stations[i], t = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return [THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t)];
  }
  function arch(z) {
    const dz = Math.min(Math.abs(z + 1.22), Math.abs(z - 1.22));
    return dz < .352 ? .295 + Math.sqrt(.352 ** 2 - dz ** 2) : .265;
  }
  surface(body, paint, (u, v) => {
    const z = -2.13 + v * 4.26, [w, h] = section(z), bottom = arch(z);
    const points = [[-w * .89, bottom], [-w, bottom + .022], [-w, Math.max(bottom + .028, h - .14)], [-w * .96, h - .035], [-w * .76, h], [0, h + .018], [w * .76, h], [w * .96, h - .035], [w, Math.max(bottom + .028, h - .14)], [w, bottom + .022], [w * .89, bottom]];
    const i = Math.min(9, Math.floor(u * 10)), f = u * 10 - i;
    return [THREE.MathUtils.lerp(points[i][0], points[i + 1][0], f), THREE.MathUtils.lerp(points[i][1], points[i + 1][1], f), z];
  }, 110, 40);
  block(body, black, 1.24, .14, 3.75, 0, .25, 0, .05);
  block(body, paint, 1.31, .38, .12, 0, .54, -2.078, .07);
  block(body, paint, 1.31, .48, .12, 0, .55, 2.078, .07);
  // Low rounded cream bonnet and boot sit over the burgundy fenders.
  surface(body, cream, (u, v) => {
    const z = -2.035 + v * 1.09, [w, h] = section(z), x = (u * 2 - 1) * w * .91;
    return [x, h + .023 - Math.pow(Math.abs(u * 2 - 1), 3) * .031, z];
  }, 20, 20);
  surface(body, cream, (u, v) => {
    const z = 1.20 + v * .82, [w, h] = section(z); return [(u * 2 - 1) * w * .91, h + .025 - Math.abs(u * 2 - 1) ** 3 * .025, z];
  }, 16, 20);
  for (const side of [-1, 1]) {
    // Pressed fender lips follow the wheel opening rather than sitting on a box.
    for (const center of [-1.22, 1.22]) {
      const lip = [];
      for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI; const z = center - Math.cos(a) * .355; lip.push([side * (section(z)[0] + .003), .295 + Math.sin(a) * .355, z]); }
      tube(body, paint, lip, .018, false, 40);
    }
    tube(body, black, [[side * .827, .66, -.86], [side * .846, .65, -.3], [side * .84, .65, .5], [side * .817, .65, 1.02]], .015, false, 20);
    for (const seamZ of [-.94, .08, 1.03]) tube(body, seal, [[side * .82, .88, seamZ], [side * .844, .70, seamZ], [side * .84, .36, seamZ]], .0035, false, 8);
    for (const z of [-.17, .79]) {
      block(body, black, .024, .046, .15, side * .848, .835, z, .013);
      block(body, chrome, .029, .017, .105, side * .863, .843, z, .006);
    }
    tube(body, cream, [[side * .81, .91, -.96], [side * .84, .905, -.25], [side * .832, .91, .7], [side * .8, .92, 1.2]], .024, false, 25);
  }

  // Compound-curved glazing, shaped A/C pillars, and a softly crowned roof.
  const wind = (u, v) => {
    const span = THREE.MathUtils.lerp(.735, .615, v), x = (u * 2 - 1) * span;
    return [x, .935 + v * .415 + .022 * Math.sin(u * Math.PI), -.94 + v * .50 - .03 * Math.sin(u * Math.PI)];
  };
  surface(body, glass, wind, 14, 22);
  const rear = (u, v) => [(u * 2 - 1) * THREE.MathUtils.lerp(.71, .61, v), .94 + v * .415 + .014 * Math.sin(u * Math.PI), 1.205 - v * .47 + .018 * Math.sin(u * Math.PI)];
  surface(body, glass, rear, 14, 22);
  surface(body, cream, (u, v) => {
    const z = -.47 + v * 1.24, x = (u * 2 - 1) * (.635 + .012 * Math.sin(v * Math.PI));
    return [x, 1.356 + .039 * Math.sin(u * Math.PI) + .006 * Math.sin(v * Math.PI), z];
  }, 20, 22);
  for (const side of [-1, 1]) {
    surface(body, glass, (u, v) => {
      const lowerZ = THREE.MathUtils.lerp(-.91, .035, u), upperZ = THREE.MathUtils.lerp(-.43, .035, u);
      return [side * THREE.MathUtils.lerp(.762, .632, v), .94 + v * .398, THREE.MathUtils.lerp(lowerZ, upperZ, v)];
    }, 12, 16);
    surface(body, glass, (u, v) => {
      const lowerZ = THREE.MathUtils.lerp(.10, 1.17, u), upperZ = THREE.MathUtils.lerp(.10, .73, u);
      return [side * THREE.MathUtils.lerp(.755, .632, v), .94 + v * .398, THREE.MathUtils.lerp(lowerZ, upperZ, v)];
    }, 12, 16);
    tube(body, seal, [[side * .763, .935, -.96], [side * .68, 1.17, -.70], [side * .62, 1.35, -.45], [side * .62, 1.35, .74], [side * .685, 1.15, .99], [side * .76, .935, 1.20], [side * .763, .935, -.96]], .016, false, 50);
    tube(body, cream, [[side * .78, .925, -.96], [side * .694, 1.18, -.70], [side * .63, 1.355, -.44]], .029, false, 18);
    tube(body, cream, [[side * .63, 1.355, .75], [side * .69, 1.19, .98], [side * .78, .925, 1.23]], .049, false, 18);
    tube(body, black, [[side * .767, .935, .065], [side * .635, 1.345, .065]], .024, false, 8);
    // Electric mirror housing and reflective rear surface.
    block(body, black, .10, .05, .16, side * .79, .99, -.83, .02);
    const mirror = block(body, cream, .19, .12, .25, side * .90, 1.027, -.82, .05); mirror.rotation.y = -side * .15;
    const mirrorGlass = block(body, chrome, .155, .08, .012, side * .90, 1.028, -.69, .015); mirrorGlass.rotation.y = -side * .15;
  }
  for (const x of [-.34, .30]) tube(body, black, [[x - .15, .96, -.957], [x + .19, .965, -.96]], .008, false, 4);

  // LC2 face: narrow trapezoid grille and rounded, swept-back triangular lamps.
  block(body, paint, 1.48, .23, .20, 0, .47, -2.06, .065);
  const grilleShape = new THREE.Shape(); grilleShape.moveTo(-.43, .765); grilleShape.lineTo(.43, .765); grilleShape.lineTo(.34, .535); grilleShape.quadraticCurveTo(0, .49, -.34, .535); grilleShape.closePath();
  const grille = part(body, new THREE.ShapeGeometry(grilleShape, 16), black, 0, 0, -2.135); grille.rotation.y = Math.PI;
  tube(body, chrome, [[-.43, .765, -2.142], [-.34, .535, -2.142], [0, .505, -2.145], [.34, .535, -2.142], [.43, .765, -2.142]], .012, false, 28);
  for (let y = .56; y < .76; y += .05) block(body, black, .69 + (y - .56) * .45, .014, .026, 0, y, -2.15, .003);
  badge(body, chrome, 0, .645, -2.176, Math.PI, .87);
  const headPoints = [[.452, .747], [.49, .87], [.61, .965], [.735, .94], [.79, .85], [.797, .695], [.72, .663], [.525, .678]].map(([x,y]) => [x, y * .84 + .07]);
  const tailPoints = [[.50, .865], [.68, .92], [.77, .86], [.79, .61], [.71, .54], [.51, .58]];
  for (const side of [-1, 1]) {
    const housing = lampShape(body, chrome, headPoints, side, -2.09, .03);
    housing.rotation.y = side * -.10;
    const lens = lampShape(body, lamp, headPoints.map(([x,y]) => [x * .984, (y - .80) * .92 + .80]), side, -2.118, .018);
    lens.rotation.y = side * -.10;
    for (const x of [.56, .70]) {
      const reflector = part(body, new THREE.SphereGeometry(.085, 16, 10), chrome, side * x, .785, -2.15); reflector.scale.set(1, 1, .18);
    }
    block(body, amber, .045, .11, .024, side * .761, .80, -2.123, .014);
    const fog = part(body, new THREE.CylinderGeometry(.066, .066, .025, 20), lamp, side * .65, .415, -2.145); fog.rotation.x = Math.PI / 2;
    lampShape(body, red, tailPoints, side, 2.065, .045);
    block(body, amber, .18, .055, .045, side * .65, .72, 2.117, .016);
    block(body, reverse, .17, .052, .046, side * .645, .65, 2.12, .013);
    block(body, black, .02, .025, .085, side * .831, .80, -1.01, .007);
  }
  block(body, black, 1.14, .065, .022, 0, .378, -2.164, .018);
  block(body, paint, 1.47, .19, .18, 0, .44, 2.06, .06);
  badge(body, chrome, 0, .85, 2.117, 0, .85);
  block(body, black, .49, .20, .025, 0, .645, 2.13, .028);
  const badges = texture(512, 96, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#dfe3df'; ctx.font = 'italic bold 65px Arial'; ctx.textAlign = 'center'; ctx.fillText('VERNA', w / 2, 70); });
  const rearBadge = decal(body, badges, .30, .057, -.42, .84, 2.123); rearBadge.material.transparent = true;
  const gls = texture(192, 64, (ctx, w) => { ctx.fillStyle = '#dde2de'; ctx.font = 'italic bold 46px Arial'; ctx.textAlign = 'center'; ctx.fillText('1.6 GLS', w / 2, 50); });
  const trim = decal(body, gls, .21, .045, .42, .83, 2.122); trim.material.transparent = true;
  const plateTexture = texture(448, 216, (ctx, w, h) => {
    ctx.fillStyle = '#e9e9de'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#d88b35'; ctx.fillRect(0, 0, w, 58);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 33px Arial'; ctx.textAlign = 'center'; ctx.fillText('EGYPT       مصر', w / 2, 34);
    ctx.fillStyle = '#17222b'; ctx.font = 'bold 68px Arial'; ctx.fillText('د ق هـ   ٢٧٤١', w / 2, 156);
    ctx.strokeStyle = '#586268'; ctx.lineWidth = 7; ctx.strokeRect(3, 3, w - 6, h - 6);
  });
  decal(body, plateTexture, .35, .17, 0, .49, -2.178, Math.PI);
  decal(body, plateTexture, .35, .17, 0, .645, 2.15);
  const taxiTexture = texture(384, 96, (ctx, w, h) => { ctx.fillStyle = '#eee6d0'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#713437'; ctx.textAlign = 'center'; ctx.font = 'bold 66px Arial'; ctx.fillText('TAXI  أجرة', w / 2, 70); });
  const sign = block(body, cream, .55, .125, .18, 0, 1.49, -.02, .025);
  decal(body, taxiTexture, .50, .105, 0, 1.49, -.114, Math.PI, true);
  decal(body, taxiTexture, .50, .105, 0, 1.49, .074, 0, true);
  const doorTexture = texture(256, 128, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#e9debd'; ctx.textAlign = 'center'; ctx.font = 'bold 43px Arial'; ctx.fillText('أجرة المنصورة', w / 2, 50); ctx.font = '24px Arial'; ctx.fillText('MANSOURA · 2741', w / 2, 95); });
  for (const side of [-1, 1]) { const d = decal(body, doorTexture, .40, .20, side * .851, .71, -.42, side * Math.PI / 2); d.material.transparent = true; }

  // Tires use a rounded section; stamped steel rims and four lug nuts.
  const wheels = [];
  const tireProfile = [[.145, -.086], [.235, -.092], [.280, -.078], [.294, -.055], [.297, 0], [.294, .055], [.280, .078], [.235, .092], [.145, .086]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const side of [-1, 1]) for (const z of [-1.22, 1.22]) {
    const pivot = new THREE.Group(); pivot.position.set(side * .735, .297, z); body.add(pivot);
    const wheel = new THREE.Group(); pivot.add(wheel);
    const tire = part(wheel, new THREE.LatheGeometry(tireProfile, 36), rubber); tire.rotation.z = Math.PI / 2;
    const rim = part(wheel, new THREE.CylinderGeometry(.172, .172, .185, 28), steel); rim.rotation.z = Math.PI / 2;
    const hub = part(wheel, new THREE.CylinderGeometry(.079, .079, .196, 20), black); hub.rotation.z = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, hole = part(wheel, new THREE.CylinderGeometry(.027, .027, .004, 10), black, side * .096, Math.sin(a) * .124, Math.cos(a) * .124); hole.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const lug = part(wheel, new THREE.CylinderGeometry(.011, .011, .012, 6), chrome, side * .103, Math.sin(a) * .053, Math.cos(a) * .053); lug.rotation.z = Math.PI / 2; }
    const outerRing = part(wheel, new THREE.TorusGeometry(.171, .009, 5, 32), chrome, side * .098, 0, 0); outerRing.rotation.y = Math.PI / 2;
    for (const edge of [-.052, .052]) { const band = part(wheel, new THREE.TorusGeometry(.294, .003, 4, 36), black, edge, 0, 0); band.rotation.y = Math.PI / 2; }
    batchStaticMeshes(wheel);
    wheels.push({ pivot, wheel, front: z < 0 });
  }

  // Visible five-seat cabin: dashboard, front buckets, rear bench and occupants.
  block(body, interior, 1.34, .16, 2.10, 0, .48, .14, .04);
  block(body, interior, 1.39, .18, .34, 0, .88, -.74, .055);
  block(body, black, .43, .07, .11, -.38, 1.00, -.69, .025);
  block(body, black, .20, .22, .08, 0, .83, -.55, .015);
  block(body, steel, .14, .025, .009, 0, .86, -.504, .004);
  for (const x of [-.49, .39]) for (const z of [-.22, .67]) {
    block(body, cloth, .46, .12, .48, x, .61, z, .055);
    const back = block(body, cloth, .46, .43, .12, x, .84, z + .19, .055); back.rotation.x = -.12;
    block(body, cloth, .25, .13, .10, x, 1.11, z + .20, .035);
  }
  block(body, cloth, 1.2, .12, .45, 0, .61, .72, .055);
  const steering = new THREE.Group(); steering.position.set(-.38, .91, -.47); steering.rotation.x = -.28; body.add(steering);
  part(steering, new THREE.TorusGeometry(.14, .015, 8, 28), black);
  block(steering, black, .09, .055, .035, 0, 0, 0, .015);
  for (const side of [-1, 1]) tube(steering, black, [[0, -.015, 0], [side * .12, .035, 0]], .012, false, 4);
  block(body, interior, .17, .10, .58, -.005, .61, -.16, .035);
  part(body, new THREE.SphereGeometry(.027, 10, 8), black, -.005, .77, -.25);
  tube(body, black, [[-.005, .64, -.25], [-.005, .75, -.25]], .009, false, 4);
  const occupants = [];
  function person(x, z, color, driver = false) {
    const human = new THREE.Group(); human.position.set(x, 0, z); body.add(human);
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: .94 });
    const skin = new THREE.MeshStandardMaterial({ color: driver ? '#ab7a55' : '#bb8e69', roughness: .9 });
    const torso = part(human, new THREE.CapsuleGeometry(.12, .22, 5, 10), shirt, 0, .88, 0); torso.scale.set(1.15, 1, .72);
    const head = part(human, new THREE.SphereGeometry(.101, 16, 12), skin, 0, 1.16, -.025); head.scale.set(.85, 1.12, .92);
    const hair = part(human, new THREE.SphereGeometry(.103, 14, 8, 0, Math.PI * 2, 0, Math.PI * .48), black, 0, 1.18, -.023); hair.scale.set(.85, .9, .95);
    for (const side of [-1, 1]) {
      tube(human, shirt, [[side * .12, .98, -.01], [side * .16, .87, -.10], [side * .105, .88, driver ? -.24 : -.14]], .038, false, 10);
      const leg = block(human, black, .105, .10, .30, side * .07, .65, -.13, .035); leg.rotation.x = .15;
    }
    tube(human, seal, [[-.12, 1.02, .015], [.11, .72, -.13]], .015, false, 6);
    return human;
  }
  person(-.38, -.16, '#9fa8a1', true).name = 'Driver';
  occupants.push(person(.38, -.16, '#647e82'), person(-.39, .69, '#ad8065'), person(.02, .69, '#63827b'), person(.39, .69, '#bdad87'));
  for (const p of occupants) p.visible = false;

  // Doors, body panels and trim share GPU batches; moving/visible cabin groups stay separate.
  batchStaticMeshes(body, { transparent: false });

  // Lighting remains outside `body` so bonnet view can hide geometry safely.
  const headlights = [];
  for (const side of [-1, 1]) {
    const light = new THREE.SpotLight('#ffe4b4', 0, 65, Math.PI / 7, .65, 1.2); light.position.set(side * .60, .73, -2.05); light.target.position.set(side * 1.9, .1, -35); group.add(light, light.target); headlights.push(light);
  }
  let wheelAngle = 0, previousSpeed = 0, isNight = false;
  return {
    group, body, wheels,
    dimensions: { length: 4.26, width: 1.68, height: 1.395, wheelbase: 2.44 },
    setColor(color) { paint.color.set(color); },
    setPassengers(count) { occupants.forEach((p, i) => p.visible = i < clamp(Math.floor(Number(count) || 0), 0, 4)); },
    setNight(night) { isNight = !!night; lamp.emissiveIntensity = night ? 2.1 : .07; red.emissiveIntensity = night ? .85 : .24; for (const l of headlights) l.intensity = night ? 32 : 0; },
    updateVisual(dt, speed, steer) {
      wheelAngle -= speed * dt / .297;
      for (const item of wheels) { item.wheel.rotation.x = wheelAngle; if (item.front) item.pivot.rotation.y = damp(item.pivot.rotation.y, steer * .44, 12, dt); }
      const acceleration = dt > 0 ? clamp((speed - previousSpeed) / dt, -20, 20) : 0;
      body.rotation.z = damp(body.rotation.z, -steer * clamp(speed / 35, -.8, .8) * .035, 6, dt);
      body.rotation.x = damp(body.rotation.x, -acceleration * .00065, 7, dt);
      steering.rotation.z = steer * 1.6;
      red.emissiveIntensity = acceleration < -3 && speed > 1 ? 2.5 : isNight ? .85 : .24;
      reverse.emissive = reverse.emissive || new THREE.Color(); reverse.emissive.set(speed < -.3 ? '#e2ddbd' : '#000000');
      previousSpeed = speed;
    },
  };
}
