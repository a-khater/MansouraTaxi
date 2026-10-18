import * as THREE from '../vendor/three.module.js';

/** Observed lower north elevation of the Metro / Coffee Wizard building.
 * Every bay below is individually selected from the cited street photograph.
 * The mapped footprint is literal; all vertical dimensions remain estimates.
 */
export function buildMetroFrontage({ building, entry, helpers }) {
  if (entry?.model !== 'metro-yamama' || building?.osmId !== 1154800777) return false;
  const { mat, cube, instance, plane, box, addGeometry, flatPolygon, chunk } = helpers;
  const polygon = building.points.map(p => ({ ...p }));
  const height = entry.height ?? 26.4;
  const west = { x: -2125.431, z: -163.629 }, east = { x: -2098.840, z: -164.475 };
  const width = Math.hypot(west.x - east.x, west.z - east.z);
  // Local +x follows photo-right, which is west when viewed from the street.
  const tx = (west.x - east.x) / width, tz = (west.z - east.z) / width;
  const nx = -tz, nz = tx, angle = Math.atan2(nx, nz);
  const cx = (west.x + east.x) / 2, cz = (west.z + east.z) / 2;
  const groundTop = 2.90, cafeTop = 5.90, floorHeight = 3.10;
  const group = new THREE.Group(); group.name = entry.buildingId;
  chunk(cx, cz)[1].add(group);

  function material(name, color, options = {}) {
    const m = mat('metro-' + name, color, { roughness: .92, ...options });
    m.name = 'metro-' + name; m.userData.preserveReferenceMaterial = true; return m;
  }
  const plaster = material('cream-plaster', '#dfd9be');
  const trim = material('ivory-frames', '#ece7d5');
  const peach = material('ochre-balcony-aprons', '#c99c6f');
  const peachLight = material('rounded-peach-piers', '#d4b18b');
  const shadow = material('recessed-balcony-interiors', '#3b3a32');
  const rail = material('black-metal-rails', '#313432', { roughness: .65, metalness: .25 });
  const frame = material('dark-window-frames', '#44413a', { roughness: .70, metalness: .20 });
  const aluminum = material('aluminium-frames', '#c2c5bb', { roughness: .55, metalness: .35 });
  const blueGlass = material('blue-grey-glazing', '#526a82', { roughness: .35, metalness: .24 });
  const greyGlass = material('dark-grey-glazing', '#555a59', { roughness: .40, metalness: .20 });
  const brown = material('brown-enclosed-oriel', '#645447');
  const awning = material('faded-green-awnings', '#536554');
  const brick = material('entry-brick', '#8c7565');
  const mosaic = material('arched-mosaic-infill', '#b6b4a4');
  const charcoal = material('coffee-wizard-charcoal', '#252a2c');
  const shutter = material('closed-retail-shutters', '#5a5a51', { roughness: .83, metalness: .13 });
  const signWhite = material('shop-sign-white', '#e3e7e1');
  const metroBlue = material('metro-sign-blue', '#273d78');
  const lime = material('lime-shop-panel', '#a3b244');
  const condenser = material('air-conditioner-casings', '#c2c3b6');
  const chipped = material('visible-worn-apron-patches', '#e2d8b7');

  const point = (x, d = 0) => ({ x: cx + tx * x + nx * d, z: cz + tz * x + nz * d });
  function block(m, x, y, d, w, h, depth) {
    const p = point(x, d); cube(m, p.x, y, p.z, w, h, depth, angle);
  }
  function place(g, m, x, y, d, sx = 1, sy = 1, sz = 1, rz = 0) {
    const p = point(x, d); instance(g, m, p.x, y, p.z, sx, sy, sz, angle, true, rz);
  }
  function facadePlane(m, x, y, d, w, h) { place(plane, m, x, y, d, w, h); }
  function frameRectangle(x, y, d, w, h, m = frame, thickness = .055) {
    for (const s of [-1, 1]) {
      block(m, x + s * w / 2, y, d, thickness, h + thickness, .08);
      block(m, x, y + s * h / 2, d, w, thickness, .08);
    }
  }
  function glazing(x, y, d, w, h, { cols = 2, rows = 1, color = blueGlass, metal = frame } = {}) {
    facadePlane(color, x, y, d, w, h);
    frameRectangle(x, y, d + .025, w, h, metal);
    for (let c = 1; c < cols; c++) block(metal, x + (c / cols - .5) * w, y, d + .035, .045, h, .06);
    for (let r = 1; r < rows; r++) block(metal, x, y + (r / rows - .5) * h, d + .035, w, .045, .06);
  }
  function rails(x, bottom, d, w, h = .58, vertical = false, m = rail) {
    block(m, x, bottom + h, d, w, .06, .07);
    block(m, x, bottom + .09, d, w, .045, .05);
    if (vertical) {
      const count = Math.max(4, Math.round(w / .17));
      for (let i = 0; i <= count; i++) block(m, x + (i / count - .5) * w, bottom + h / 2, d, .025, h, .035);
    } else {
      block(m, x, bottom + h * .54, d, w, .035, .045);
      for (const dx of [-w / 2, 0, w / 2]) block(m, x + dx, bottom + h / 2, d, .04, h, .045);
    }
  }
  function arcOpening(w, h, rise = .40) {
    const hole = new THREE.Path(); const r = w / 2, spring = h - rise;
    hole.moveTo(-r, .02); hole.lineTo(r, .02); hole.lineTo(r, spring);
    hole.absellipse(0, spring, r, rise, 0, Math.PI, false); hole.closePath(); return hole;
  }
  function archSurround(x, bottom, d, w, h, m = trim, rise = .38) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
    s.holes.push(arcOpening(w - .22, h - .12, rise));
    const g = new THREE.ExtrudeGeometry(s, { depth: .16, bevelEnabled: false, curveSegments: 18 });
    g.translate(0, 0, -.08); place(g, m, x, bottom, d);
  }
  function bowedDepth(x, w, d) {
    const half = w / 2, corner = Math.min(.46, w * .13);
    const shoulder = THREE.MathUtils.clamp((Math.abs(x) - (half - corner)) / corner, 0, 1);
    // A gentle bow along the middle blends into quarter-round return corners.
    return d + .16 * (1 - (x / half) ** 2) - corner * (1 - Math.sqrt(Math.max(0, 1 - shoulder ** 2)));
  }
  function profilePoints(w, d, count = 30) {
    return Array.from({ length: count + 1 }, (_, i) => {
      const x = (i / count - .5) * w; return { x, d: bowedDepth(x, w, d) };
    });
  }
  function emitLocalGeometry(g, m, x, y, d = 0) {
    // Bake the curved geometry into the existing geographic/material batches.
    const flat = g.index ? g.toNonIndexed() : g;
    const p = flat.attributes.position, uv = flat.attributes.uv, positions = [], uvs = [];
    for (let i = 0; i < p.count; i++) {
      const q = point(x + p.getX(i), d + p.getZ(i));
      positions.push(q.x, y + p.getY(i), q.z);
      uvs.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
    }
    addGeometry(m, cx, cz, positions, uvs, true);
    if (flat !== g) flat.dispose(); g.dispose();
  }
  function profiledSolid(m, x, bottom, w, h, d, { band = 0, back = -.53 } = {}) {
    const front = profilePoints(w, d);
    const plan = band
      ? [...front, ...front.map(p => ({ x: p.x, d: p.d - band })).reverse()]
      : [...front, { x: w / 2, d: back }, { x: -w / 2, d: back }];
    const shape = new THREE.Shape();
    plan.forEach((p, i) => i ? shape.lineTo(p.x, -p.d) : shape.moveTo(p.x, -p.d));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); emitLocalGeometry(g, m, x, bottom);
  }
  function bowedRail(m, x, y, w, d, radius = .026) {
    const points = profilePoints(w, d, 24).map(p => new THREE.Vector3(p.x, 0, p.d));
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, radius, 5, false);
    emitLocalGeometry(g, m, x, y);
  }
  function bowedRails(x, bottom, w, d, h) {
    for (const [dy, r] of [[.09, .021], [h * .54, .021], [h, .031]]) bowedRail(rail, x, bottom + dy, w, d, r);
    for (const dx of [-w / 2, 0, w / 2]) block(rail, x + dx, bottom + h / 2, bowedDepth(dx, w, d), .04, h, .045);
  }
  function bowedGlazing(x, y, w, h, d, color, cols = 3, rows = 2) {
    const profile = profilePoints(w, d, 30), positions = [], uvs = [];
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i + 1], pa = point(x + a.x, a.d), pb = point(x + b.x, b.d);
      positions.push(pa.x, y - h / 2, pa.z, pb.x, y - h / 2, pb.z, pb.x, y + h / 2, pb.z,
        pa.x, y - h / 2, pa.z, pb.x, y + h / 2, pb.z, pa.x, y + h / 2, pa.z);
      uvs.push(i / 30, 0, (i + 1) / 30, 0, (i + 1) / 30, 1, i / 30, 0, (i + 1) / 30, 1, i / 30, 1);
    }
    addGeometry(color, cx, cz, positions, uvs, true);
    for (let c = 0; c <= cols; c++) {
      const dx = (c / cols - .5) * w;
      block(frame, x + dx, y, bowedDepth(dx, w, d) + .025, .052, h + .07, .075);
    }
    for (let r = 0; r <= rows; r++) bowedRail(frame, x, y + (r / rows - .5) * h, w, d + .03, .028);
  }
  function balcony(x, bottom, w, {
    arch = false, apron = true, rounded = false, depth = .62,
    enclosed = false, glazingMaterial = greyGlass, canopy = false, split = false, enclosureColumns = 3,
  } = {}) {
    const openingHeight = floorHeight - .38;
    facadePlane(shadow, x, bottom + openingHeight / 2 + .12, -.40, w - .14, openingHeight);
    // A real recessed bay: return walls, ceiling, projecting slab and front rail.
    for (const s of [-1, 1]) block(plaster, x + s * (w / 2 - .06), bottom + floorHeight / 2, .10, .12, floorHeight, .98);
    if (rounded) {
      profiledSolid(trim, x, bottom, w + .09, .16, depth + .03);
      profiledSolid(trim, x, bottom + floorHeight - .18, w + .12, .16, depth + .04);
    } else {
      block(trim, x, bottom + .08, depth / 2 - .07, w + .09, .16, depth + .74);
      block(trim, x, bottom + floorHeight - .10, .08, w + .12, .16, .99);
    }
    if (apron) {
      if (rounded) {
        profiledSolid(peach, x, bottom + .075, w + .10, .65, depth + .03, { band: .15 });
        profiledSolid(peachLight, x, bottom + .70, w + .16, .10, depth + .08, { band: .23 });
      } else {
        block(peach, x, bottom + .40, depth, w + .10, .65, .15);
        block(peachLight, x, bottom + .75, depth + .025, w + .16, .10, .19);
      }
    }
    if (enclosed) {
      if (rounded) {
        bowedGlazing(x, bottom + 1.61, w - .16, 1.73, depth + .045, glazingMaterial, enclosureColumns);
      } else glazing(x, bottom + 1.61, depth + .025, w - .16, 1.73, { cols: enclosureColumns, rows: 2, color: glazingMaterial });
    } else {
      if (rounded) bowedRails(x, bottom + (apron ? .76 : .22), w - .18, depth + .075, apron ? .40 : .69);
      else rails(x, bottom + (apron ? .76 : .22), depth + .035, w - .18, apron ? .40 : .69);
      if (arch) archSurround(x, bottom + .10, .42, w, openingHeight, trim, .43);
      if (split) {
        // The photographed third-tier opening has a narrow left arch and a
        // stepped right lintel, rather than another repeated rectangle.
        archSurround(x - w * .35, bottom + .15, .45, w * .25, 2.43, trim, .32);
        block(trim, x + w * .03, bottom + 2.17, .43, w * .29, .55, .16);
        block(trim, x + w * .24, bottom + 2.40, .43, w * .22, .32, .16);
      }
    }
    if (canopy) {
      block(awning, x, bottom + 2.29, depth + .06, w + .15, .10, .87);
      block(awning, x, bottom + 2.20, depth + .49, w + .15, .18, .055);
      for (let dx = -w / 2; dx <= w / 2; dx += .30) block(rail, x + dx, bottom + 2.29, depth + .07, .018, .018, .84);
    }
  }
  function simpleWindow(x, bottom, w, { arched = false, barred = false, color = greyGlass, peachApron = true } = {}) {
    const h = 1.66, y = bottom + 1.61;
    if (peachApron) block(peach, x, bottom + .42, -.24, w + .19, .71, .11);
    glazing(x, y, -.24, w, h, { cols: barred ? 4 : 2, rows: barred ? 2 : 1, color });
    if (arched) archSurround(x, bottom + .75, -.15, w + .19, 1.91, plaster, .29);
    if (barred) rails(x, bottom + .81, -.13, w, 1.55, true, aluminum);
  }
  function airConditioner(x, y, d = .59, w = .76) {
    block(condenser, x, y, d, w, .49, .38);
    block(frame, x, y, d + .205, w - .10, .34, .035);
    for (let r = 0; r < 5; r++) block(condenser, x, y - .13 + r * .065, d + .23, w - .13, .025, .025);
    block(rail, x, y - .29, d - .03, w + .09, .045, .55);
  }

  // Literal footprint and undecorated unseen elevations. The top closure only
  // retains the existing inferred mass; it is not an observed roof design.
  let area = polygon.reduce((sum, p, i) => { const b = polygon[(i + 1) % polygon.length]; return sum + p.x * b.z - b.x * p.z; }, 0);
  if (area < 0) polygon.reverse();
  flatPolygon(polygon, building.holes || [], plaster, height);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < .02) continue;
    const isFront = Math.abs((a.z + b.z) / 2 - cz) < .6;
    const offset = isFront ? -.48 : 0;
    const ex = dz / l, ez = -dx / l;
    const ax = a.x + ex * offset, az = a.z + ez * offset, bx = b.x + ex * offset, bz = b.z + ez * offset;
    addGeometry(plaster, cx, cz, [ax, 0, az, bx, height, bz, bx, 0, bz, ax, 0, az, ax, height, az, bx, height, bz]);
  }

  // Six unequal vertical stacks, read from photo-left (east) to photo-right
  // (west). The two narrow window stacks are intentionally not balcony bays.
  const edges = [-width / 2, -10.12, -4.82, .12, 3.00, 7.96, width / 2];
  const bays = edges.slice(0, -1).map((e, i) => ({ x: (e + edges[i + 1]) / 2, w: edges[i + 1] - e }));
  const tierBottom = r => cafeTop + r * floorHeight;
  for (let b = 0; b < bays.length; b++) {
    const { x, w } = bays[b];
    for (let r = 0; r < 6; r++) {
      const bottom = tierBottom(r), usable = w - .42;
      if (b === 0) simpleWindow(x, bottom, usable * .67, { arched: r === 2 || r === 5, barred: r === 3 });
      if (b === 1) {
        if (r === 5) simpleWindow(x, bottom, usable * .78, { color: greyGlass, peachApron: false });
        else balcony(x, bottom, usable, { rounded: true, enclosed: r === 0 || r === 4, arch: r === 4, apron: r !== 3, glazingMaterial: r === 0 ? greyGlass : blueGlass });
      }
      if (b === 2) {
        if (r === 0) simpleWindow(x, bottom, usable * .93, { barred: true, peachApron: false });
        else if (r === 1 || r === 4) simpleWindow(x, bottom, usable * .91, { arched: r === 1, peachApron: false });
        else balcony(x, bottom, usable, { split: r === 2, arch: r === 5, apron: false, canopy: r === 3 });
      }
      if (b === 3) simpleWindow(x, bottom, usable * .86, { arched: r === 2 || r === 5, barred: r === 0 || r === 2, color: r === 1 || r === 3 || r === 5 ? blueGlass : greyGlass });
      if (b === 4) {
        if (r === 4 || r === 5) simpleWindow(x, bottom, usable * .86, { arched: r === 4, color: blueGlass, peachApron: false });
        else balcony(x, bottom, usable, { rounded: true, enclosed: r === 0 || r === 2, apron: r !== 3, canopy: r === 3, glazingMaterial: r === 2 ? brown : blueGlass, enclosureColumns: r === 2 ? 5 : 3 });
      }
      if (b === 5) balcony(x, bottom, usable, { arch: [1, 2, 4, 5].includes(r), apron: false, enclosed: r === 3, glazingMaterial: greyGlass, depth: .31 });
    }
    // Only a cropped portion of the seventh tier is visible in the source.
    const partial = Math.max(.3, height - tierBottom(6));
    if ([0, 3].includes(b)) glazing(x, tierBottom(6) + partial / 2, -.23, (w - .4) * .80, partial * .70, { color: greyGlass });
    else {
      facadePlane(shadow, x, tierBottom(6) + partial / 2, -.38, w - .38, partial);
      if ([1, 4].includes(b)) glazing(x, tierBottom(6) + partial / 2, .12, w - .55, partial * .86, { cols: 3, color: blueGlass });
      else rails(x, tierBottom(6) + .12, .38, w - .51, Math.min(.65, partial * .5));
    }
  }

  // Full-height rounded peach piers separate the photographed bay stacks.
  const pierGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, -Math.PI / 2, Math.PI);
  for (const x of [edges[1], edges[2], edges[3], edges[4], edges[5]]) {
    place(pierGeometry, peachLight, x, (cafeTop + height) / 2, .10, .22, height - cafeTop, .28);
    block(trim, x - .25, (cafeTop + height) / 2, .08, .075, height - cafeTop, .13);
  }
  // The rightmost loggia has strong pale vertical returns instead of ochre
  // front panels; its fourth tier was closed with aluminum glazing.
  for (const x of [edges[5] + .10, edges[6] - .11]) block(trim, x, (cafeTop + height) / 2, .47, .23, height - cafeTop, .73);

  // One brown timber-colored oriel has an overhanging dark lid and a denser
  // glazing grid, unlike the blue glazing in the tier below.
  const oriel = bays[4];
  profiledSolid(brown, oriel.x, tierBottom(2) + 2.51, oriel.w - .12, .17, .76);
  // A few photographed patches of worn paint on the broad left apron.
  for (const [dx, y, w, h] of [[-.95, .43, .38, .15], [-.31, .32, .64, .18], [.70, .50, .33, .20]]) block(chipped, bays[1].x + dx, tierBottom(2) + y, .708, w, h, .012);

  // Photo-matched condenser positions. These are not a repeating unit on
  // every apartment and do not imply unobserved equipment on other walls.
  const acs = [
    [0, 0, -.44, -.05], [0, 3, .05, .08], [0, 5, -.30, .04],
    [1, 0, -.50, -.12], [1, 3, -1.27, .70], [1, 4, -1.28, .76], [1, 5, -1.24, .76],
    [2, 1, .03, -.05], [2, 2, -1.46, .68], [2, 3, 1.55, .64], [2, 5, 1.40, .61],
    [3, 1, -.56, .25], [3, 3, -.55, .24], [3, 5, -.50, .25],
    [4, 0, 1.51, .45], [4, 1, -1.35, 1.71], [4, 2, 1.52, .65], [4, 3, -.60, .50], [4, 5, -1.58, 1.66],
  ];
  for (const [b, r, dx, relativeY] of acs) airConditioner(bays[b].x + dx, tierBottom(r) + relativeY + .65, .73);
  // Small laundry shapes only in the one upper-right open loggia that shows
  // washing; their arrangement is an interpretation, not copied imagery.
  const laundry = bays[5];
  for (const [dx, dy, w] of [[-.75, .22, .54], [-.11, .06, .39], [.43, .19, .62], [1.03, .10, .32]]) block(trim, laundry.x + dx, tierBottom(4) + 1.06 + dy, .40, w, .18, .04);

  // The east/photo-left commercial part: three shallow arches. Only the first
  // two carry mosaic-like infill; the third is brick above the double doorway.
  const splitX = .08, archLeft = -width / 2 + .10, archWidth = (splitX - archLeft) / 3;
  for (let i = 0; i < 3; i++) {
    const x = archLeft + archWidth * (i + .5), w = archWidth - .17;
    facadePlane(i === 2 ? brick : mosaic, x, (groundTop + cafeTop) / 2, -.10, w - .25, cafeTop - groundTop - .13);
    archSurround(x, groundTop + .10, .32, w, cafeTop - groundTop - .05, peachLight, .56);
    archSurround(x, groundTop + .12, .42, w - .16, cafeTop - groundTop - .20, trim, .50);
    if (i < 2) {
      for (let r = 0; r < 12; r++) for (let c = 0; c < 18; c++) {
        const yy = groundTop + .30 + r * .185;
        const xx = x + (c / 17 - .5) * (w - .55) + (r % 2 ? .025 : -.025);
        block((r + c) % 3 === 0 ? trim : frame, xx, yy, -.035, .08, .035, .014);
      }
    } else {
      for (let r = 0; r < 12; r++) block(peachLight, x, groundTop + .18 + r * .20, -.025, w - .31, .012, .016);
    }
  }
  const doorX = archLeft + archWidth * 2.5;
  facadePlane(shadow, doorX, groundTop / 2, -.10, archWidth - .27, groundTop);
  for (const side of [-1, 1]) {
    const x = doorX + side * .64;
    block(frame, x, 1.33, .10, 1.18, 2.56, .13);
    frameRectangle(x, 1.31, .19, .98, 2.25, aluminum, .045);
    archSurround(x, .21, .21, 1.03, 2.21, aluminum, .39);
    for (let j = -2; j <= 2; j++) block(rail, x + j * .16, 1.30, .25, .025, 1.85, .04);
    block(aluminum, x - side * .40, 1.17, .29, .035, .27, .04);
  }

  // Coffee Wizard occupies the west/photo-right half, with a deeply recessed
  // dark dining bay, a transparent pale balustrade and two square support piers.
  const cafeLeft = splitX + .06, cafeRight = width / 2 - .08;
  const cafeWidth = cafeRight - cafeLeft, cafeX = (cafeLeft + cafeRight) / 2;
  block(charcoal, cafeX, cafeTop - .32, .41, cafeWidth, .52, .51);
  facadePlane(charcoal, cafeX, groundTop + 1.35, -.19, cafeWidth, 2.61);
  for (const f of [1 / 3, 2 / 3]) block(peachLight, cafeLeft + cafeWidth * f, groundTop + 1.51, .13, .26, 2.55, .56);
  block(charcoal, cafeX, groundTop + .10, .46, cafeWidth + .12, .21, 1.37);
  const cafeGlass = material('cafe-glass-balustrade', '#9bafb9', { roughness: .31, metalness: .12 });
  facadePlane(cafeGlass, cafeX, groundTop + .68, 1.14, cafeWidth - .20, 1.02);
  for (let i = 0; i <= 15; i++) block(aluminum, cafeLeft + .11 + (cafeWidth - .22) * i / 15, groundTop + .68, 1.18, .028, 1.04, .045);
  block(aluminum, cafeX, groundTop + 1.22, 1.18, cafeWidth - .11, .055, .07);
  for (const side of [-1, 1]) {
    const x = cafeX + side * (cafeWidth / 2 - .24);
    for (let c = -1; c <= 1; c++) block(aluminum, x + c * .14, groundTop + 1.61, .36, .040, 2.04, .05);
    for (let r = 0; r < 11; r++) block(aluminum, x, groundTop + .67 + r * .18, .36, .47, .027, .05);
  }
  // The photo shows a few light chairs behind the balustrade, not a filled
  // generic restaurant. Simple seat backs remain secondary to the facade.
  for (const x of [cafeLeft + 1.45, cafeLeft + 3.28, cafeLeft + 6.60, cafeRight - 1.80]) {
    block(trim, x, groundTop + .72, .81, .43, .055, .39);
    frameRectangle(x, groundTop + 1.04, .65, .40, .46, trim, .028);
  }

  // Ground-floor shutters and signs are placed only where readable in the
  // source. The long white fascia continues without inventing the neighbor.
  const leftRetailWidth = archWidth * 2 - .16, leftRetailX = archLeft + leftRetailWidth / 2;
  block(signWhite, leftRetailX, 2.70, .49, leftRetailWidth, .75, .48);
  for (let i = 0; i < 3; i++) {
    const x = archLeft + (i + .5) * leftRetailWidth / 3;
    facadePlane(shutter, x, 1.24, .11, leftRetailWidth / 3 - .19, 2.25);
    for (let y = .20; y < 2.38; y += .11) block(rail, x, y, .145, leftRetailWidth / 3 - .19, .018, .024);
    block(trim, x - leftRetailWidth / 6, 1.15, .24, .15, 2.31, .37);
  }
  block(signWhite, cafeX, 2.72, .70, cafeWidth, .76, .58);
  const shopWidths = [1.72, 2.65, cafeWidth - 4.37], shopStarts = [cafeLeft, cafeLeft + 1.72, cafeLeft + 4.37];
  for (let i = 0; i < shopWidths.length; i++) {
    const w = shopWidths[i], x = shopStarts[i] + w / 2;
    facadePlane(i === 1 ? charcoal : shutter, x, 1.23, .25, w - .10, 2.30);
    if (i !== 1) for (let y = .21; y < 2.33; y += .10) block(rail, x, y, .29, w - .12, .019, .025);
  }
  block(lime, cafeLeft + .86, 2.72, 1.005, 1.66, .73, .028);
  facadePlane(lime, cafeLeft + .86, 1.31, .30, 1.62, 2.29);
  for (let y = .25; y < 2.31; y += .12) block(rail, cafeLeft + .86, y, .32, 1.59, .015, .02);
  block(charcoal, cafeLeft + 3.02, 2.72, 1.012, 2.57, .73, .03);

  function textLabel(text, x, y, d, w, h, { color = '#ecece3', background = null, font = 'bold 80px Arial', italic = false } = {}) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.height = 192;
    let ctx = canvas.getContext('2d'); if (!ctx) return;
    const renderedFont = (italic ? 'italic ' : '') + font.replace(/\b\d+(?:\.\d+)?px\b/g, '150px');
    ctx.font = renderedFont;
    const measured = typeof ctx.measureText === 'function' ? ctx.measureText(text).width : text.length * 150 * .66;
    canvas.width = Math.ceil(Math.max(64, measured + 36));
    // Canvas dimensions reset the drawing state, including its chosen font.
    ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.fillStyle = color; ctx.font = renderedFont;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, 103, canvas.width - 32);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .10, side: THREE.DoubleSide });
    m.name = 'metro-observed-lettering-' + text; m.userData.preserveReferenceMaterial = true;
    const p = point(x, d), label = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    label.position.set(p.x, y, p.z); label.rotation.y = angle; label.name = 'Observed shop lettering: ' + text; group.add(label);
  }
  textLabel('COFFEE WIZARD', cafeX, cafeTop - .30, .686, cafeWidth - .76, .52, { font: 'bold 100px Georgia' });
  const metroX = leftRetailX + .08;
  block(metroBlue, metroX, 2.70, .753, 3.63, .70, .032);
  textLabel('METRO', metroX, 2.70, .777, 3.37, .65, { font: 'italic bold 116px Georgia' });
  block(material('metro-red-stroke', '#a94346'), metroX - 1.32, 2.70, .80, .16, .49, .026);
  textLabel('COFFEE WIZARD', cafeLeft + 3.02, 2.72, 1.035, 2.47, .53, { font: 'bold 78px Georgia' });
  textLabel('FARMBOY', cafeLeft + 7.45, 1.68, .39, 3.26, .56, { font: 'bold 100px Arial' });

  // Thin utility wires follow the documented frontage, with their slight sag.
  function wire(points, radius = .015) {
    const positions = points.map(([x, y, d]) => { const p = point(x, d); return new THREE.Vector3(p.x, y, p.z); });
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(positions), 28, radius, 4, false);
    const mesh = new THREE.Mesh(geometry, rail); mesh.castShadow = false; group.add(mesh);
  }
  wire([[-width / 2, 7.14, 1.06], [-4, 6.90, 1.04], [3, 7.00, 1.08], [width / 2, 7.24, 1.08]]);
  wire([[-width / 2, 7.36, 1.05], [-4, 7.13, 1.03], [3, 7.20, 1.06], [width / 2, 7.43, 1.07]], .012);

  group.userData = {
    referenceStatus: entry.status, model: entry.model, buildingId: building.id, osmId: building.osmId,
    height, heightSource: entry.heightSource || building.heightSource, observationDate: entry.observationDate ?? null,
    photoReferenced: true, proceduralFallback: false,
    frontage: { west, east, width, outward: { x: nx, z: nz }, photoRight: 'west', rotationY: angle },
    observedFeatures: [
      'six unequal residential stacks', 'six complete residential tiers and a cropped seventh tier',
      'two narrow window stacks between broader mixed balcony bays', 'cream plaster and peach rounded vertical piers',
      'individually varied open, enclosed, arched and stepped balcony openings', 'single brown enclosed oriel and green awnings',
      'white framed recessed loggias on photo right', 'air-conditioners at selected visible positions',
      'three shallow commercial arches on photo left, first two with mosaic infill',
      'double inset metal entrance below the third arch', 'COFFEE WIZARD cafe on west half with pale glass balustrade',
      'METRO band below the eastern arches', 'lower lime shutter and FARMBOY lettering',
    ],
    remainingUnknowns: entry.remainingUnknowns || [
      'Photograph capture date is unknown; present-day shop names and condition are unverified.',
      'Height, floor heights, balcony depth and fine dimensions remain estimates.',
      'Upper extent is cropped; the retained mass top is not a photographed roof.',
      'Side and rear elevations are undocumented and deliberately plain.',
      'Fine mosaic, furniture, equipment and lettering proportions are interpreted from one perspective photograph.',
    ],
    sourceImageReuse: 'reference-only; original geometry and text, no photographic pixel textures',
  };
  return true;
}
