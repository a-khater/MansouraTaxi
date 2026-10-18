import * as THREE from '../vendor/three.module.js';
import { batchStaticMeshes } from './geometry-batching.js';

/**
 * Original mesh of Mansoura University's Faculty of Law entrance (gate 3).
 * Photo identification: the university's 2016 gate-opening article and its
 * campus gallery, images 35–39. Geometry is drawn here, not photo-textured.
 * Visible architectural features are referenced; dimensions are estimates.
 */
export const LAW_GATE_ENVELOPE = Object.freeze({ width: 26.4, height: 9.2, depth: 4.2 });

const REFERENCES = [
  'https://agrfac.mans.edu.eg/index.php/news-archive/5763-president-of-mansoura-university-opens-a-new-gate',
  'https://www.mans.edu.eg/photo-album/campus',
  'https://www.mans.edu.eg/images/speasyimagegallery/albums/1/images/35.jpg',
  'https://www.mans.edu.eg/images/speasyimagegallery/albums/1/images/37.jpg',
  'https://www.mans.edu.eg/images/speasyimagegallery/albums/1/images/39.jpg',
];

function rectangle(shape, x, y, w, h) {
  shape.moveTo(x, y); shape.lineTo(x + w, y); shape.lineTo(x + w, y + h);
  shape.lineTo(x, y + h); shape.closePath(); return shape;
}

function archedPath(x, bottom, width, spring) {
  const r = width / 2, p = new THREE.Path();
  p.moveTo(x - r, bottom); p.lineTo(x + r, bottom); p.lineTo(x + r, spring);
  p.absarc(x, spring, r, 0, Math.PI, false); p.closePath(); return p;
}

function extruded(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: false, curveSegments: 22,
  });
  g.translate(0, 0, -depth / 2); return g;
}

/** Return an unplaced group. Local front is +z; origin is the ground center.
 * Optional entry.width / height / depth scale the estimated default envelope.
 * entry.position and entry.rotation are deliberately left to the world owner.
 */
export function createLawGate(entry = {}) {
  const group = new THREE.Group(); group.name = 'Mansoura University — Faculty of Law gate 3';
  const doorsOpen = Boolean(entry.openDoors ?? entry.vehicleDoorsOpen);
  const stone = new THREE.MeshStandardMaterial({ color: '#c69b59', roughness: .89 });
  const lightStone = new THREE.MeshStandardMaterial({ color: '#d8af6c', roughness: .84 });
  const insetStone = new THREE.MeshStandardMaterial({ color: '#a98350', roughness: .95 });
  const slate = new THREE.MeshStandardMaterial({ color: '#756f5b', roughness: .96 });
  const mortar = new THREE.MeshStandardMaterial({ color: '#a57e45', roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: '#151b19', metalness: .61, roughness: .51 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c9ad65', metalness: .64, roughness: .40 });
  const glazing = new THREE.MeshStandardMaterial({ color: '#596562', metalness: .24, roughness: .43 });
  const ivory = new THREE.MeshStandardMaterial({ color: '#e2dcc1', roughness: .83 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#e0dfc7', emissive: '#e9d5a8', emissiveIntensity: .12, roughness: .52 });
  const foliage = new THREE.MeshStandardMaterial({ color: '#476548', roughness: 1 });

  function mesh(geometry, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  }
  function box(mat, x, y, z, w, h, d) {
    return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }
  function cylinder(mat, x, y, z, r, h, top = r) {
    return mesh(new THREE.CylinderGeometry(top, r, h, 16), mat, x, y, z);
  }
  function line(mat, points, radius = .025, segments = 10) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(new THREE.TubeGeometry(curve, segments, radius, 5, false), mat);
  }
  function ring(mat, x, y, z, r, tube = .04, start = 0, length = Math.PI * 2) {
    const m = mesh(new THREE.TorusGeometry(r, tube, 6, 42, length), mat, x, y, z);
    m.rotation.z = start; return m;
  }
  function frame(mat, x, y, z, w, h, thickness = .075, depth = .075) {
    box(mat, x, y - h / 2, z, w, thickness, depth);
    box(mat, x, y + h / 2, z, w, thickness, depth);
    box(mat, x - w / 2, y, z, thickness, h, depth);
    box(mat, x + w / 2, y, z, thickness, h, depth);
  }
  function archBand(cx, spring, radius, thickness, z, depth, mat) {
    const s = new THREE.Shape();
    s.absarc(cx, spring, radius + thickness, 0, Math.PI, false);
    s.lineTo(cx - radius, spring); s.absarc(cx, spring, radius, Math.PI, 0, true); s.closePath();
    mesh(extruded(s, depth), mat, 0, 0, z);
    for (const side of [-1, 1]) box(mat, cx + side * (radius + thickness / 2), spring / 2, z, thickness, spring, depth);
  }
  function leafLettering(text, x, arabic = false) {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#e0d6b3'; ctx.textAlign = 'center'; ctx.direction = arabic ? 'rtl' : 'ltr';
    ctx.font = arabic ? 'bold 65px "Noto Sans Arabic", sans-serif' : 'bold 58px serif';
    ctx.fillText(text, 256, 87);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: .83, depthWrite: false, side: THREE.DoubleSide });
    mesh(new THREE.PlaneGeometry(2.44, .58), material, x, .40, .285);
    mesh(new THREE.PlaneGeometry(2.44, .58), material, x, .40, .175).rotation.y = Math.PI;
  }

  // The two vehicle arches, central pedestrian passage and upper opening are
  // genuine holes. Side passages remain open behind their metal doors too.
  const silhouette = new THREE.Shape();
  silhouette.moveTo(-13.1, 0); silhouette.lineTo(13.1, 0); silhouette.lineTo(13.1, 4.7);
  silhouette.bezierCurveTo(11.0, 4.9, 10.6, 6.5, 10.6, 8.65);
  silhouette.lineTo(6.7, 8.65); silhouette.lineTo(6.7, 8.20);
  silhouette.lineTo(-6.7, 8.20); silhouette.lineTo(-6.7, 8.65);
  silhouette.lineTo(-10.6, 8.65); silhouette.bezierCurveTo(-10.6, 6.5, -11.0, 4.9, -13.1, 4.7); silhouette.closePath();
  for (const x of [-4.0, 4.0]) silhouette.holes.push(archedPath(x, .025, 5.65, 4.20));
  for (const x of [-11.85, 11.85]) silhouette.holes.push(archedPath(x, .025, 1.38, 2.70));
  silhouette.holes.push(rectangle(new THREE.Path(), -.925, .025, 1.85, 4.10));
  silhouette.holes.push(rectangle(new THREE.Path(), -1.025, 5.0, 2.05, 2.58));
  mesh(extruded(silhouette, 2.9), stone);

  // Front and reverse arch mouldings, scored stone courses and raised panels.
  for (const z of [-1.48, 1.48]) {
    for (const x of [-4.0, 4.0]) {
      archBand(x, 4.20, 2.825, .12, z, .12, lightStone);
      archBand(x, 4.20, 2.99, .045, z, .09, insetStone);
      box(lightStone, x, 7.08, z + Math.sign(z) * .035, .20, .33, .16);
      // Two recessed triangular spandrel fields per large arch.
      for (const side of [-1, 1]) {
        const x0 = x + side * 2.84, x1 = x + side * .60;
        line(insetStone, [[x0, 7.61, z], [x1, 7.61, z], [x0, 5.91, z]], .035, 2);
        line(lightStone, [[x0, 7.71, z], [x1 - side * .12, 7.71, z]], .03, 1);
      }
    }
    for (const x of [-11.85, 11.85]) archBand(x, 2.70, .69, .10, z, .12, lightStone);
    frame(lightStone, 0, 2.18, z, 2.06, 4.25, .10, .14);
    frame(lightStone, 0, 6.28, z, 2.27, 2.78, .085, .13);
    for (const x of [-8.55, 8.55]) {
      box(insetStone, x, 5.0, z - Math.sign(z) * .018, 2.8, 5.9, .045);
      frame(lightStone, x, 4.98, z + Math.sign(z) * .018, 2.95, 6.05, .10, .10);
      for (let y = .40; y < 8.20; y += .55) box(mortar, x, y, z + Math.sign(z) * .013, 3.57, .018, .016);
      box(slate, x, 8.48, z + Math.sign(z) * .02, 3.30, .69, .07);
      frame(lightStone, x, 8.48, z + Math.sign(z) * .065, 3.48, .85, .10, .08);
      // Small individual slate blocks in the dark upper inset.
      for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
        const xx = x - 1.40 + col * .40 + (row % 2) * .11;
        box((row + col) % 3 === 0 ? insetStone : slate, xx, 8.24 + row * .23, z + Math.sign(z) * .072, .34, .17, .025);
      }
    }
    // Fine masonry joints on the entablature, with a dentil row below it.
    for (const y of [7.98, 8.13]) box(mortar, 0, y, z + Math.sign(z) * .02, 13.3, .018, .02);
    for (let x = -6.55; x <= 6.55; x += .24) box(lightStone, x, 7.82, z + Math.sign(z) * .09, .11, .12, .13);
  }

  // Layered cornice, central rectangular pediment and taller outer piers.
  for (const [w, y, h, d] of [[13.9, 8.16, .14, 3.13], [14.1, 8.30, .10, 3.30], [13.7, 8.41, .08, 3.13]]) box(lightStone, 0, y, 0, w, h, d);
  for (const x of [-8.55, 8.55]) {
    for (const [w, y, h, d] of [[4.2, .16, .32, 3.27], [4.0, .42, .17, 3.16], [4.0, 8.90, .16, 3.18], [4.24, 9.04, .10, 3.30], [4.05, 9.16, .08, 3.14]]) box(lightStone, x, y, 0, w, h, d);
    box(insetStone, x, .68, 1.51, 3.33, .28, .10);
    box(slate, x, .72, 1.57, 2.90, .16, .05);
    for (let i = -7; i <= 7; i++) box(lightStone, x + i * .23, 8.78, 1.60, .11, .13, .18);
    // Paired cylindrical pilasters and compact foliate/volute capitals.
    for (const dx of [-.68, .68]) {
      const xx = x + dx;
      box(lightStone, xx, 1.01, 1.69, .58, .19, .53);
      cylinder(lightStone, xx, 1.16, 1.70, .25, .13, .28);
      cylinder(lightStone, xx, 4.02, 1.70, .22, 5.54, .19);
      cylinder(lightStone, xx, 6.83, 1.70, .24, .12, .24);
      cylinder(lightStone, xx, 7.03, 1.70, .24, .25, .34);
      box(lightStone, xx, 7.20, 1.70, .72, .15, .64);
      for (const side of [-1, 1]) {
        ring(lightStone, xx + side * .23, 7.09, 1.99, .10, .036);
        for (let leaf = 0; leaf < 3; leaf++) {
          const l = mesh(new THREE.SphereGeometry(.13, 6, 4), lightStone, xx + side * (.10 + leaf * .045), 6.91 + leaf * .075, 1.94);
          l.scale.set(.48, 1.25, .40); l.rotation.z = side * -.45;
        }
      }
    }
    // Circular guard-room windows occur on the rear face in photo 39.
    const disc = mesh(new THREE.CircleGeometry(.63, 32), glazing, x, 1.72, -1.505); disc.rotation.y = Math.PI;
    ring(lightStone, x, 1.72, -1.56, .71, .09);
    ring(insetStone, x, 1.72, -1.57, .60, .035);
    for (const dx of [-.17, .17]) box(ivory, x + dx, 1.72, -1.59, .05, .95, .06);
    box(ivory, x, 1.72, -1.60, .82, .05, .07);
    box(ivory, x, 1.28, -1.60, .85, .055, .07);
  }

  // Recessed side doors, their fanlight bars and curved outer wing mouldings.
  for (const x of [-11.85, 11.85]) {
    box(iron, x, 1.14, .52, 1.28, 2.20, .09);
    frame(gold, x, 1.68, .59, 1.04, .78, .035, .026);
    for (const dx of [-.30, 0, .30]) box(iron, x + dx, 2.73, .53, .035, 1.17, .035);
    for (const y of [2.38, 2.68, 2.98]) box(iron, x, y, .53, 1.17 - Math.max(0, y - 2.70) * 1.1, .03, .04);
    for (const dx of [-.25, .25]) {
      ring(gold, x + dx, 1.68, .62, .12, .018);
      line(gold, [[x + dx, 1.43, .62], [x + dx - .08, 1.68, .62], [x + dx, 1.94, .62]], .014, 6);
    }
    box(gold, x + .39, 1.02, .60, .045, .18, .03);
    const side = Math.sign(x);
    for (const z of [-1.53, 1.53]) {
      line(lightStone, [[side * 10.67, 8.65, z], [side * 10.81, 6.91, z], [side * 11.45, 5.30, z], [side * 13.08, 4.86, z]], .085, 20);
      frame(lightStone, x, 3.92, z, 1.65, .40, .05, .08);
    }
  }

  // Black-and-gold wrought-iron vehicle leaves: open fretwork, lattice upper
  // panels, scroll motifs and small gold medallions, without opaque photo cards.
  function scroll(x, y, z, scale = 1, mirror = 1) {
    const p = [];
    for (let i = 0; i <= 26; i++) {
      const a = i / 26 * Math.PI * 3.0, r = scale * (.03 + .23 * i / 26);
      p.push([x + Math.cos(a) * r * mirror, y + Math.sin(a) * r, z]);
    }
    line(iron, p, .026 * scale, 26);
  }
  for (const cx of [-4.0, 4.0]) {
    for (const side of [-1, 1]) {
      const leafStart = group.children.length;
      const x = cx + side * 1.39, w = 2.67;
      for (const edge of [-1, 1]) box(iron, x + edge * w / 2, 2.11, .23, .085, 4.22, .12);
      for (const y of [.12, .85, 1.63, 2.91, 3.50]) box(iron, x, y, .23, w, .075, .10);
      box(iron, x, .44, .23, w - .09, .62, .07);
      // Curved crest above each gate leaf.
      line(iron, [[x - w / 2, 3.58, .23], [x - .70, 4.05, .23], [x, 4.18, .23], [x + .70, 4.05, .23], [x + w / 2, 3.58, .23]], .045, 20);
      for (let dx = -1.15; dx < 1.20; dx += .20) {
        const top = 3.58 + .58 * Math.sqrt(Math.max(0, 1 - (dx / 1.34) ** 2));
        box(iron, x + dx, (top + 3.02) / 2, .23, .026, top - 3.02, .03);
        const spear = mesh(new THREE.ConeGeometry(.055, .14, 5), gold, x + dx, top + .07, .23); spear.castShadow = false;
      }
      // Bright geometric bands and asymmetric paired S-scrolls.
      for (const y of [1.22, 3.18]) for (let dx = -.98; dx <= 1.00; dx += .49) {
        frame(gold, x + dx, y, .27, .33, .43, .025, .03);
        ring(gold, x + dx, y, .30, .095, .018);
      }
      for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
        const xx = x - 1.0 + col * .66, yy = 1.94 + row * .57;
        scroll(xx, yy, .26, 1, row % 2 ? -1 : 1);
        const l = mesh(new THREE.SphereGeometry(.10, 5, 4), gold, xx + .14, yy + .12, .29); l.scale.set(.43, 1.2, .24); l.rotation.z = -.55;
      }
      // Exposed mesh/lattice between the decorative bands.
      for (let dx = -1.12; dx < 1.18; dx += .24) box(iron, x + dx, 2.28, .20, .018, 1.20, .018);
      if (doorsOpen) {
        leafLettering(cx < 0 ? (side < 0 ? 'MANSOURA' : 'UNIVERSITY') : (side < 0 ? 'المنصورة' : 'جامعة'), x, cx > 0);
        // A static operational pose: each leaf turns inward about its outer
        // upright. The source photographs show the leaves closed.
        const hingeX = x + side * w / 2;
        const hinge = new THREE.Matrix4().makeTranslation(hingeX, 0, .23)
          .multiply(new THREE.Matrix4().makeRotationY(-side * Math.PI / 2))
          .multiply(new THREE.Matrix4().makeTranslation(-hingeX, 0, -.23));
        for (const part of group.children.slice(leafStart)) part.applyMatrix4(hinge);
      }
    }
  }
  // Central pedestrian door repeats the narrower ironwork vocabulary.
  box(iron, 0, 2.03, .25, 1.77, 4.02, .08);
  for (const y of [.72, 1.48, 2.42, 3.18, 3.80]) frame(gold, 0, y, .31, 1.56, .41, .025, .03);
  for (let y = 1.72; y < 2.29; y += .48) for (const x of [-.26, .26]) scroll(x, y, .32, .75, Math.sign(x));
  box(gold, .765, 1.07, .33, .045, .19, .03);

  // Narrow roof floodlights on projecting arms, as visible in both gate views.
  for (const x of [-11.40, -7.05, 0, 7.05, 11.40]) {
    const y = Math.abs(x) > 10 ? 5.65 : Math.abs(x) > 6 ? 8.93 : 8.42;
    line(iron, [[x, y, 1.45], [x, y + .06, 1.87]], .032, 1);
    const m = box(iron, x, y + .06, 1.91, .38, .10, .28); m.rotation.x = -.13;
    box(lamp, x, y + .012, 1.94, .31, .012, .21);
  }

  // Paired low planters on the rear and the white urns seen at the front.
  for (const x of [-8.55, 8.55]) {
    box(lightStone, x, .16, -1.77, 3.4, .25, .43);
    box(insetStone, x, .30, -1.77, 3.25, .05, .38);
    for (let i = -3; i <= 3; i++) {
      const l = mesh(new THREE.IcosahedronGeometry(.20, 0), foliage, x + i * .40, .49, -1.77); l.scale.set(1, .8, 1);
    }
  }
  for (const x of [-1.13, 1.13]) {
    cylinder(ivory, x, .22, 1.77, .19, .29, .13);
    cylinder(ivory, x, .40, 1.77, .13, .09, .23);
    cylinder(ivory, x, .08, 1.77, .15, .09, .19);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const l = mesh(new THREE.IcosahedronGeometry(.16, 0), foliage, x + Math.cos(a) * .12, .58 + (i % 2) * .10, 1.77 + Math.sin(a) * .12); l.scale.set(.7, 1.3, .7);
    }
  }

  // Lettering is drawn from text, never cropped from source photographs.
  if (!doorsOpen && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 1024, 128); ctx.fillStyle = '#e0d6b3'; ctx.textAlign = 'center';
      ctx.font = 'bold 58px serif'; ctx.fillText('MANSOURA UNIVERSITY', 512, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const textMat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: .83, depthWrite: false, side: THREE.DoubleSide });
      mesh(new THREE.PlaneGeometry(5.1, .64), textMat, -4.0, .39, .285);
      mesh(new THREE.PlaneGeometry(5.1, .64), textMat, -4.0, .39, .175).rotation.y = Math.PI;
      const ar = document.createElement('canvas'); ar.width = 512; ar.height = 128;
      const a = ar.getContext('2d'); a.clearRect(0, 0, 512, 128); a.fillStyle = '#e0d6b3'; a.textAlign = 'center'; a.direction = 'rtl';
      a.font = 'bold 65px "Noto Sans Arabic", sans-serif'; a.fillText('جامعة المنصورة', 256, 87);
      const at = new THREE.CanvasTexture(ar); at.colorSpace = THREE.SRGBColorSpace;
      const arMat = new THREE.MeshStandardMaterial({ map: at, transparent: true, roughness: .83, depthWrite: false, side: THREE.DoubleSide });
      mesh(new THREE.PlaneGeometry(5.0, .62), arMat, 4.0, .39, .285);
      mesh(new THREE.PlaneGeometry(5.0, .62), arMat, 4.0, .39, .175).rotation.y = Math.PI;
    }
  }

  batchStaticMeshes(group);
  group.scale.set(
    (entry.width ?? LAW_GATE_ENVELOPE.width) / LAW_GATE_ENVELOPE.width,
    (entry.height ?? LAW_GATE_ENVELOPE.height) / LAW_GATE_ENVELOPE.height,
    (entry.depth ?? LAW_GATE_ENVELOPE.depth) / LAW_GATE_ENVELOPE.depth,
  );
  group.userData = {
    landmark: 'Mansoura University Faculty of Law gate 3',
    modelKind: 'original photo-reference architectural approximation',
    localFront: '+z', localBase: 'y=0',
    envelope: { ...LAW_GATE_ENVELOPE, ...Object.fromEntries(['width', 'height', 'depth'].filter(k => entry[k] != null).map(k => [k, entry[k]])) },
    dimensionsSource: 'estimated from photographs; no measured survey or construction drawings',
    observed: [
      'two large semicircular vehicle arches', 'central rectangular pedestrian doorway and upper opening',
      'two small arched side entrances', 'golden stone facade and layered cornices',
      'paired column pilasters on ornamental front', 'dark stone upper inset panels',
      'black and gold wrought-iron gates', 'circular guard-room windows on reverse',
      'projecting roof floodlights',
    ],
    approximated: ['all measurements', 'ironwork scroll pattern', 'capital ornament', 'unseen roof and internal details', 'plant details'],
    sourceUrls: [...REFERENCES],
    sourceImageReuse: 'reference-only; source photographs are not bundled or applied as textures',
    dateNote: '2016 opening report; campus gallery photos are undated and are not a current condition survey',
    vehicleDoorsOpen: doorsOpen,
    operationalState: doorsOpen ? 'vehicle leaves held open for driving; interpreted operational pose, not photographed current condition' : 'vehicle leaves closed as in the reference photographs',
    vehicleLeaves: [-4.0, 4.0].flatMap(cx => [-1, 1].map(side => ({
      hinge: { x: cx + side * 2.725, z: .23 }, width: 2.67, height: 4.32,
      rotationY: doorsOpen ? -side * Math.PI / 2 : 0,
      collider: doorsOpen
        ? { x: cx + side * 2.725, z: -1.105, width: .16, depth: 2.67 }
        : { x: cx + side * 1.39, z: .23, width: 2.67, depth: .16 },
    }))),
  };
  return group;
}
