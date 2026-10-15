import * as THREE from './vendor/three.module.js';

// An original, condensed interpretation of Mansoura's Nile-side cityscape.
// All geometry and sign textures are made locally; there are no remote assets.
export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'Mansoura · city on the Nile';
  scene.add(root);
  const colliders = [];
  const vertical = [-400, -200, 0, 200];
  const horizontal = [-500, -250, 0, 250, 500];
  const bounds = { minX: -580, maxX: 620, minZ: -650, maxZ: 650 };
  const mats = {};
  const batches = new Map();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const cone = new THREE.ConeGeometry(1, 1, 8);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const temp = new THREE.Object3D();
  let seed = 20261015;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = list => list[Math.floor(random() * list.length)];
  const material = (key, color, extra = {}) => mats[key] ||= new THREE.MeshStandardMaterial({ color, roughness: .86, ...extra });
  const roadMat = material('road', '#424747');
  const pavementMat = material('pavement', '#bfad8b');
  const concreteMat = material('concrete', '#d3c5a5');
  const creamMat = material('cream', '#e4d5b1');
  const stoneMat = material('stone', '#b9a98b');
  const darkMat = material('dark', '#263f41');
  const railMat = material('rail', '#344b46');
  const whiteMat = material('white', '#eee4c9');
  const ochreMat = material('ochre', '#c6a05f');
  const brickMat = material('brick', '#a76b50');
  const grassMat = material('grass', '#7b8952');
  const warmMat = material('lit-window', '#e7be73', { emissive: '#c99142', emissiveIntensity: .25 });
  const glassMat = material('windows', '#486266', { roughness: .32, metalness: .12 });
  const trimMat = material('trim', '#d3c09a');
  const redMat = material('red', '#b54e36');
  const greenMat = material('green', '#536b45');
  const blackMat = material('black', '#27322f');
  const blueMat = material('blue', '#4a7778');

  function add(geometry, mat, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rz = 0, rx = 0) {
    const key = `${geometry.uuid}:${mat.uuid}`;
    if (!batches.has(key)) batches.set(key, { geometry, mat, transforms: [] });
    temp.position.set(x, y, z);
    temp.rotation.set(rx, ry, rz);
    temp.scale.set(sx, sy, sz);
    temp.updateMatrix();
    batches.get(key).transforms.push(temp.matrix.clone());
  }
  const cube = (mat, x, y, z, w, h, d, ry = 0) => add(box, mat, x, y, z, w, h, d, ry);
  const cyl = (mat, x, y, z, radius, h, ry = 0) => add(cylinder, mat, x, y, z, radius, h, radius, ry);
  const orb = (mat, x, y, z, sx, sy = sx, sz = sx) => add(sphere, mat, x, y, z, sx, sy, sz);
  function collider(x, z, w, d, padding = .7) {
    colliders.push({ minX: x - w / 2 - padding, maxX: x + w / 2 + padding, minZ: z - d / 2 - padding, maxZ: z + d / 2 + padding });
  }
  function beam(mat, start, end, radius = .2) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const mid = a.clone().add(b).multiplyScalar(.5);
    const delta = b.clone().sub(a);
    temp.position.copy(mid);
    temp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    temp.scale.set(radius, delta.length(), radius);
    temp.updateMatrix();
    const key = `${cylinder.uuid}:${mat.uuid}`;
    if (!batches.has(key)) batches.set(key, { geometry: cylinder, mat, transforms: [] });
    batches.get(key).transforms.push(temp.matrix.clone());
  }
  function mesh(geometry, mat, x, y, z, ry = 0) {
    const result = new THREE.Mesh(geometry, mat);
    result.position.set(x, y, z);
    result.rotation.y = ry;
    result.castShadow = true;
    result.receiveShadow = true;
    root.add(result);
    return result;
  }

  // The corniche is the organizing spine. The Nile and opposite bank carry
  // beyond the driving area so the city has a horizon instead of a game board edge.
  cube(material('ground', '#b4a182'), 0, -.55, 0, 1800, 1, 1550);
  cube(grassMat, 690, -.01, 0, 190, .18, 1450);
  cube(pavementMat, 239, .05, 0, 29, .3, 1400);
  cube(material('river-wall', '#7d826d'), 254, -.9, 0, 3, 2, 1400);
  for (const x of vertical) {
    cube(pavementMat, x, -.02, 0, 36, .13, 1400);
    cube(roadMat, x, .065, 0, 24, .09, 1400);
  }
  for (const z of horizontal) {
    cube(pavementMat, -190, -.015, z, 820, .15, 36);
    cube(roadMat, -190, .08, z, 820, .09, 24);
  }
  cube(roadMat, 610, .05, -500, 46, .15, 116);
  const lineMat = material('lane-marking', '#d9d0a4');
  for (const x of vertical) for (let z = -685; z < 700; z += 18) {
    if (horizontal.some(h => Math.abs(z - h) < 22)) continue;
    cube(lineMat, x, .135, z, .2, .025, 7);
  }
  for (const z of horizontal) for (let x = -585; x < 210; x += 18) {
    if (vertical.some(v => Math.abs(x - v) < 23)) continue;
    cube(lineMat, x, .145, z, 7, .025, .2);
  }
  for (const x of vertical) for (const z of horizontal) {
    for (let i = -4; i <= 4; i++) {
      cube(whiteMat, x + i * 1.9, .15, z + 16, .95, .025, 3.6);
      cube(whiteMat, x + 16, .15, z + i * 1.9, 3.6, .025, .95);
    }
  }
  // Short painted curb sections make the edge of the streets readable at speed.
  for (const x of vertical) for (let z = -690; z < 700; z += 10) {
    if (horizontal.some(h => Math.abs(z - h) < 23)) continue;
    for (const s of [-1, 1]) cube(Math.floor(z / 10) % 2 ? whiteMat : blackMat, x + s * 12.5, .22, z, .65, .4, 4.5);
  }
  for (let z = -695; z < 700; z += 7) {
    cube(stoneMat, 240, .23, z, 25, .08, .06);
    if (Math.abs(z + 500) > 20) cube(railMat, 252, 1, z, .12, 1.8, .12);
  }
  for (const [z, length] of [[-610, 180], [110, 1180]]) {
    cube(railMat, 252, 1.65, z, .13, .13, length);
    cube(railMat, 252, .75, z, .12, .1, length);
  }

  const waterUniforms = {
    time: { value: 0 }, colorA: { value: new THREE.Color('#397b7c') },
    colorB: { value: new THREE.Color('#72a397') }, fogColor: { value: new THREE.Color('#c3bd9f') },
  };
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `varying vec3 worldP; void main(){vec4 p=modelMatrix*vec4(position,1.);worldP=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader: `uniform float time;uniform vec3 colorA;uniform vec3 colorB;uniform vec3 fogColor;varying vec3 worldP;
      void main(){
        float w=sin(worldP.x*.42+sin(worldP.z*.08+time*.3)*2.+time*.65)*sin(worldP.z*.7-time*.7);
        float fine=sin(worldP.x*2.+worldP.z*.24+time)*.5+.5;
        float shimmer=pow(max(0.,w),12.)*.16;
        vec3 c=mix(colorA,colorB,.37+w*.08+fine*.04);
        c+=vec3(1.,.76,.39)*shimmer;
        float haze=smoothstep(250.,1200.,distance(cameraPosition,worldP));
        c=mix(c,fogColor,haze*.7);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(340, 1550), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(422.5, -.36, 0);
  root.add(water);
  colliders.push({ minX: 254, maxX: 592, minZ: -720, maxZ: -517 });
  colliders.push({ minX: 254, maxX: 592, minZ: -483, maxZ: 720 });

  // Palm fronds use one reusable mesh with individual leaflets, rather than cones.
  const frondPositions = [];
  const triangle = (a, b, c) => frondPositions.push(...a, ...b, ...c);
  for (let i = 0; i < 16; i++) {
    const t = i / 16, next = (i + 1) / 16;
    const x = t * 7, nx = next * 7;
    const y = Math.sin(t * Math.PI) * 1.7 - t * 1.4;
    const ny = Math.sin(next * Math.PI) * 1.7 - next * 1.4;
    const span = Math.sin(t * Math.PI) * 1.25;
    triangle([x, y, -.055], [nx, ny, .055], [nx, ny, -.055]);
    for (const side of [-1, 1]) {
      triangle([x, y, 0], [x + .85, y - .28, side * span], [nx + .12, ny, 0]);
    }
  }
  const frondGeometry = new THREE.BufferGeometry();
  frondGeometry.setAttribute('position', new THREE.Float32BufferAttribute(frondPositions, 3));
  frondGeometry.computeVertexNormals();
  const leafMats = ['#516846', '#64784a', '#7b884d'].map((color, i) => material(`palm-leaf-${i}`, color, { side: THREE.DoubleSide }));
  const trunkMat = material('palm-trunk', '#867556');
  function palm(x, z, height = 10, scale = 1) {
    add(cylinder, trunkMat, x, height / 2, z, .35 * scale, height, .35 * scale, 0, .035);
    for (let h = 1; h < height; h += .65) cyl(stoneMat, x + h * .035, h, z, .37 * scale, .06);
    const crownX = x + height * .035;
    orb(leafMats[0], crownX, height, z, .8 * scale, .8, .8 * scale);
    for (let i = 0; i < 9; i++) add(frondGeometry, leafMats[i % 3], crownX, height + .35, z, scale, scale, scale, i * Math.PI * 2 / 9 + random() * .2, (i % 3 - 1) * .09);
  }
  for (let z = -675; z < 700; z += 31) if (Math.abs(z + 500) > 21) palm(239, z, 9.2 + random() * 2, .8 + random() * .25);
  function tree(x, z, scale = 1) {
    cyl(trunkMat, x, 2.4 * scale, z, .32 * scale, 4.8 * scale);
    orb(greenMat, x, 5.7 * scale, z, 3.5 * scale, 3.1 * scale, 3.4 * scale);
    orb(material('tree-light', '#7b8853'), x + 1.5 * scale, 6 * scale, z, 2.4 * scale, 2.9 * scale, 2.9 * scale);
  }
  function lamp(x, z, ry = 0) {
    cyl(railMat, x, 4.9, z, .11, 9.8);
    cube(railMat, x, .3, z, .6, .6, .6);
    cube(railMat, x + Math.sin(ry) * 1.15, 9.75, z + Math.cos(ry) * 1.15, .14, .14, 2.6, ry);
    cube(warmMat, x + Math.sin(ry) * 2.25, 9.55, z + Math.cos(ry) * 2.25, .65, .25, 1.2, ry);
  }
  for (let z = -670; z < 700; z += 48) lamp(224, z, -Math.PI / 2);
  for (const x of [-400, -200, 0]) for (let z = -640; z <= 650; z += 86) {
    if (!horizontal.some(h => Math.abs(z - h) < 20)) lamp(x - 15, z, Math.PI / 2);
  }
  function bench(x, z, ry = 0) {
    const cos = Math.cos(ry), sin = Math.sin(ry);
    cube(ochreMat, x, .85, z, 3.2, .18, .8, ry);
    cube(ochreMat, x - sin * .4, 1.4, z - cos * .4, 3.2, .85, .15, ry);
    for (const s of [-1, 1]) cube(railMat, x + cos * s * 1.15, .45, z - sin * s * 1.15, .15, .8, .6, ry);
  }
  for (let z = -650; z < 700; z += 52) bench(246, z, -Math.PI / 2);

  // A small local sign atelier: Arabic shopfronts and neighborhood names are
  // canvas textures, with no fonts or image downloads needed at runtime.
  const signCache = new Map();
  function sign(text, english, x, y, z, width, height, ry = 0, color = '#245b56') {
    const key = text + english + color;
    if (!signCache.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = '#dbbf7f'; ctx.lineWidth = 7; ctx.strokeRect(10, 10, 1004, 236);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
      ctx.fillStyle = '#fff1ce'; ctx.font = 'bold 94px Arial'; ctx.fillText(text, 512, 96, 950);
      ctx.direction = 'ltr'; ctx.font = '500 35px Arial'; ctx.fillStyle = '#e3c898';
      ctx.fillText(english.toUpperCase(), 512, 199, 940);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      signCache.set(key, mat);
    }
    const item = new THREE.Mesh(new THREE.PlaneGeometry(width, height), signCache.get(key));
    item.position.set(x, y, z); item.rotation.y = ry;
    root.add(item);
    return item;
  }
  const shopNames = [
    ['قهوة المنصورة', 'Mansoura Coffee'], ['عصائر النيل', 'Fresh Nile Juice'],
    ['مخبز البلد', 'Baladi Bakery'], ['صيدلية النور', 'Al Nour Pharmacy'],
    ['كشري التحرير', 'Koshary · Since 1982'], ['مطعم أولاد الحاج', 'Awlad El Hag'],
    ['فول وطعمية', 'Breakfast & Falafel'], ['حلواني السعادة', 'Al Saada Sweets'],
    ['سوبر ماركت الأمانة', 'Al Amana Market'], ['مكتبة الجامعة', 'University Bookshop'],
    ['أقمشة الشرق', 'Al Sharq Textiles'], ['مشويات الدلتا', 'Delta Grill'],
  ];
  const buildingMats = ['#c5a584', '#d1b38e', '#baa38b', '#c3b99e', '#ae856b', '#d5c4a4', '#aeac96', '#c39575'].map((color, i) => material(`facade-${i}`, color));
  const awningMats = [redMat, greenMat, blueMat, ochreMat];
  let buildingIndex = 0;
  function building(x, z, w, d, height, options = {}) {
    const index = buildingIndex++;
    const mat = options.material || pick(buildingMats);
    cube(mat, x, height / 2, z, w, height, d);
    cube(trimMat, x, 1.1, z, w + .1, 2.2, d + .1);
    cube(trimMat, x, height + .25, z, w + .65, .65, d + .65);
    collider(x, z, w, d);
    const floors = Math.floor((height - 4) / 3.7);
    for (let side = 0; side < 4; side++) {
      const alongX = side < 2;
      const faceSize = alongX ? w : d;
      const columns = Math.max(2, Math.floor(faceSize / 4.1));
      const normalX = side === 2 ? 1 : side === 3 ? -1 : 0;
      const normalZ = side === 0 ? 1 : side === 1 ? -1 : 0;
      const faceX = x + normalX * (w / 2 + .1);
      const faceZ = z + normalZ * (d / 2 + .1);
      for (let f = 0; f < floors; f++) {
        const y = 5.1 + f * 3.7;
        for (let c = 0; c < columns; c++) {
          const p = (c + .5) / columns * faceSize - faceSize / 2;
          const wx = faceX + (alongX ? p : 0), wz = faceZ + (alongX ? 0 : p);
          cube((index + f + c) % 13 === 0 ? warmMat : glassMat, wx, y, wz, alongX ? 1.45 : .17, 1.95, alongX ? .17 : 1.45);
          cube(trimMat, wx, y + 1.04, wz, alongX ? 1.72 : .24, .15, alongX ? .24 : 1.72);
          // Alternating deep, shaded balconies make the Egyptian street wall.
          if ((c + index) % 3 !== 0 && f % 2 === index % 2) {
            const bx = wx + normalX * .65, bz = wz + normalZ * .65;
            cube(trimMat, bx, y - 1.12, bz, alongX ? 2.75 : 1.45, .2, alongX ? 1.45 : 2.75);
            cube(railMat, wx + normalX * 1.34, y - .56, wz + normalZ * 1.34, alongX ? 2.65 : .09, .1, alongX ? .09 : 2.65);
            cube(railMat, wx + normalX * 1.34, y - .85, wz + normalZ * 1.34, alongX ? 2.65 : .07, .45, alongX ? .07 : 2.65);
            if ((f + c + index) % 11 === 0) cube(pick(awningMats), bx, y - .65, bz, alongX ? 1.4 : .12, .7, alongX ? .12 : 1.4);
          }
          if ((c + f + index) % 5 === 0) cube(creamMat, wx + normalX * .33, y + .15, wz + normalZ * .33, alongX ? .85 : .55, .65, alongX ? .55 : .85);
        }
      }
      const awningColor = awningMats[index % awningMats.length];
      cube(awningColor, faceX + normalX * .7, 3.25, faceZ + normalZ * .7, alongX ? faceSize - .6 : 1.7, .22, alongX ? 1.7 : faceSize - .6);
      for (let c = 0; c < Math.floor(faceSize / 5); c++) {
        const p = (c + .5) / Math.floor(faceSize / 5) * faceSize - faceSize / 2;
        cube(darkMat, faceX + (alongX ? p : 0), 1.65, faceZ + (alongX ? 0 : p), alongX ? 3.1 : .2, 2.7, alongX ? .2 : 3.1);
      }
    }
    if (index % 2 === 0 && !options.noSign) {
      const shop = shopNames[index % shopNames.length];
      // Road-facing signs are deliberately at human height.
      const dir = options.signSide || ((x > 10 && x < 180) ? 'east' : 'south');
      if (dir === 'east') sign(...shop, x + w / 2 + .2, 3.35, z, Math.min(d - 1, 13), 2.1, Math.PI / 2, ['#275b54', '#8c4430', '#3e6266'][index % 3]);
      else sign(...shop, x, 3.35, z + d / 2 + .2, Math.min(w - 1, 13), 2.1, 0, ['#275b54', '#8c4430', '#3e6266'][index % 3]);
    }
    // Flat roofs, stairwells, satellite dishes, and the black water tanks seen
    // above the Delta's apartment blocks give a recognizable skyline.
    if (index % 2 === 0) {
      cube(mat, x - w * .22, height + 2, z - d * .21, w * .28, 4, d * .32);
      cyl(blackMat, x + w * .22, height + 1.3, z + d * .18, 1.05, 2.4);
      cyl(blackMat, x + w * .22, height + 2.55, z + d * .18, 1.14, .18);
    }
    if (index % 3 === 0) {
      cyl(railMat, x, height + 1, z, .07, 2);
      const dish = new THREE.SphereGeometry(.9, 8, 5, 0, Math.PI * 2, 0, Math.PI * .4);
      const sat = mesh(dish, concreteMat, x, height + 1.7, z);
      sat.rotation.z = .45;
    }
    if (index % 7 === 0) {
      const mastX = x + w * .25;
      cyl(railMat, mastX, height + 4, z, .04, 8);
      for (let h = 0; h < 3; h++) cube(railMat, mastX, height + 5 + h, z, 2.2 - h * .4, .04, .04);
    }
  }

  // Lots are constructed inside street setbacks, with reserved public sites.
  const xBlocks = [[-578, -422], [-378, -222], [-178, -22], [22, 178]];
  const zBlocks = [[-685, -522], [-478, -272], [-228, -22], [22, 228], [272, 478], [522, 685]];
  for (let xi = 0; xi < xBlocks.length; xi++) for (let zi = 0; zi < zBlocks.length; zi++) {
    if ((xi === 0 && (zi === 1 || zi === 4)) || (xi === 2 && zi === 1) || (xi === 2 && zi === 3) || (xi === 3 && zi === 4)) continue;
    const [left, right] = xBlocks[xi], [top, bottom] = zBlocks[zi];
    const positions = [];
    for (let x = left + 19; x < right - 8; x += 31 + random() * 4) {
      positions.push([x, top + 18, 25 + random() * 5, 28]);
      positions.push([x, bottom - 18, 25 + random() * 5, 28]);
    }
    for (let z = top + 59; z < bottom - 42; z += 37) {
      positions.push([left + 17, z, 27, 29]);
      positions.push([right - 17, z, 27, 29]);
    }
    for (const [x, z, w, d] of positions) building(x, z, w, d, 13 + Math.floor(random() * 8) * 3.7, { signSide: xi === 3 ? 'east' : 'south' });
    // The block interior is a cooler court: date trees and smaller workshops.
    for (let k = 0; k < 4; k++) tree(left + 47 + random() * 60, top + 60 + random() * Math.max(10, bottom - top - 115), .7 + random() * .3);
    if (zi % 2 === 0) building((left + right) / 2, (top + bottom) / 2, 29, 35, 16, { noSign: true });
  }

  // Visible far bank: Talha's roofs, a slim mosque, palms, and a bank road.
  cube(roadMat, 620, .03, 0, 25, .12, 1400);
  for (let z = -680; z < 700; z += 33) {
    building(658 + random() * 20, z, 30, 26, 14 + random() * 25, { noSign: true });
    if (Math.floor(z) % 3 !== 0) tree(602, z, .8);
  }

  // Talha bridge. The original steel-inspired lattice is distinct from the
  // imported road geometry, while its deck stays level for the driving model.
  const bridgeMat = material('bridge-steel', '#6e8c85', { metalness: .25, roughness: .65 });
  cube(bridgeMat, 408, -.27, -500, 425, .8, 31);
  cube(roadMat, 408, .19, -500, 425, .2, 24);
  for (let x = 215; x < 619; x += 18) cube(lineMat, x, .31, -500, 7, .025, .2);
  for (const z of [-515, -485]) {
    cube(bridgeMat, 421, .8, z, 397, .4, .5);
    cube(bridgeMat, 421, 7.2, z, 355, .45, .45);
    for (let x = 250; x <= 598; x += 29) {
      cube(bridgeMat, x, 3.8, z, .5, 7.2, .5);
      if (x < 590) beam(bridgeMat, [x, 1.1, z], [x + 29, 7.2, z], .2);
      if (x < 590) beam(bridgeMat, [x, 7.2, z], [x + 29, 1.1, z], .16);
    }
    colliders.push({ minX: 247, maxX: 603, minZ: z - .6, maxZ: z + .6 });
  }
  for (const x of [310, 430, 550]) {
    cube(stoneMat, x, -3.5, -500, 6, 7, 37);
    cube(bridgeMat, x, 7.4, -500, .5, .4, 30);
  }
  sign('كوبري طلخا', 'Talha Bridge · Nile Crossing', 218, 7.5, -481, 18, 3.1, 0);

  // University campus occupies its own calm, tree-lined block.
  cube(pavementMat, -500, .12, 375, 154, .3, 206);
  cube(grassMat, -500, .32, 375, 140, .15, 190);
  cube(creamMat, -502, 10, 431, 118, 20, 38);
  cube(concreteMat, -502, 21, 431, 122, 2, 42);
  cube(creamMat, -551, 7, 355, 24, 14, 112);
  cube(creamMat, -454, 7, 355, 24, 14, 112);
  collider(-502, 431, 118, 38); collider(-551, 355, 24, 112); collider(-454, 355, 24, 112);
  for (let x = -549; x < -449; x += 9) for (const y of [5, 11, 17]) cube(glassMat, x, y, 411.7, 4.8, 3, .2);
  for (const x of [-551, -454]) for (let z = 310; z < 403; z += 10) for (const y of [4, 10]) cube(glassMat, x + (x < -500 ? 12.1 : -12.1), y, z, .2, 3, 4);
  cube(pavementMat, -497, .45, 365, 30, .1, 125);
  for (let z = 299; z < 405; z += 25) { palm(-524, z, 8.5, .8); palm(-475, z, 8.5, .8); }
  // Side gate opens onto the north-south road, with a wide entrance apron.
  cube(pavementMat, -432, .35, 333, 58, .15, 22);
  for (const z of [318, 348]) cube(creamMat, -419, 3.4, z, 3, 6.8, 3);
  cube(blueMat, -419, 7.2, 333, 2, 1.4, 34);
  sign('جامعة المنصورة', 'Mansoura University · 1972', -417.8, 7.3, 333, 28, 3, Math.PI / 2);
  sign('جامعة المنصورة', 'Mansoura University', -502, 18.2, 411.4, 48, 4.7, Math.PI);
  cyl(stoneMat, -500, 1.2, 367, 9, 1.6); cyl(blueMat, -500, 2, 367, 7.5, .2);

  // Stadium: painted pitch, striped turf, low curved corners and stepped stands.
  cube(pavementMat, -500, .14, -375, 154, .25, 202);
  cube(grassMat, -500, .35, -375, 119, .18, 170);
  const trackMat = material('track', '#a66a50');
  cube(trackMat, -500, .43, -375, 112, .12, 159);
  const pitchMat = material('pitch', '#52764e');
  cube(pitchMat, -500, .52, -375, 82, .1, 128);
  for (let z = -432; z < -312; z += 16) cube(material('pitch-stripe', '#64865b'), -500, .58, z, 80, .025, 8);
  for (const x of [-540, -460]) cube(whiteMat, x, .61, -375, .25, .025, 126);
  for (const z of [-438, -375, -312]) cube(whiteMat, -500, .61, z, 80, .025, .25);
  const circle = new THREE.Mesh(new THREE.RingGeometry(10.6, 10.9, 48), whiteMat);
  circle.rotation.x = -Math.PI / 2; circle.position.set(-500, .63, -375); root.add(circle);
  for (const z of [-438, -312]) {
    for (const x of [-511, -489]) cube(whiteMat, x, 2.4, z, .15, 4.6, .15);
    cube(whiteMat, -500, 4.7, z, 22, .15, .15);
  }
  for (let level = 0; level < 6; level++) {
    for (const side of [-1, 1]) cube(level % 2 ? blueMat : concreteMat, -500 + side * (60 + level * 1.8), .9 + level * .85, -375, 3, .8 + level * 1.7, 174);
  }
  collider(-570, -375, 12, 180); collider(-430, -375, 12, 180);
  for (const x of [-562, -438]) for (const z of [-465, -285]) {
    cyl(railMat, x, 14, z, .22, 28);
    cube(railMat, x, 28, z, 6, 2.5, .6);
    for (let i = -2; i <= 2; i++) cube(whiteMat, x + i * 1.1, 28, z + .4, .75, 1.4, .3);
  }
  sign('استاد المنصورة', 'Mansoura Stadium', -422.3, 5.2, -375, 29, 4, Math.PI / 2, '#366568');
  cube(pavementMat, -417, .2, -375, 14, .2, 31);

  // Downtown mosque: limestone walls, turquoise detailing, dome and slender
  // minarets. The architecture is an interpretation, not a survey of a monument.
  cube(pavementMat, -100, .16, -375, 150, .25, 197);
  cube(creamMat, -95, 7.3, -379, 73, 14.5, 77);
  collider(-95, -379, 73, 77);
  cube(trimMat, -95, 15, -379, 77, 1, 81);
  const domeGeometry = new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  add(domeGeometry, material('dome', '#8baf9d', { metalness: .18 }), -95, 16, -379, 24, 20, 24);
  cyl(ochreMat, -95, 38.5, -379, .12, 5);
  const crescent = new THREE.Mesh(new THREE.TorusGeometry(.8, .14, 6, 20, Math.PI * 1.6), ochreMat);
  crescent.position.set(-95, 41, -379); crescent.rotation.z = -.8; root.add(crescent);
  for (const x of [-151, -39]) {
    cyl(creamMat, x, 19, -412, 3.5, 38);
    cyl(trimMat, x, 34.5, -412, 5, 1.2);
    cyl(creamMat, x, 41, -412, 2.2, 13);
    cyl(trimMat, x, 46, -412, 3.4, .8);
    add(cone, blueMat, x, 51.5, -412, 2.7, 9, 2.7);
    cyl(ochreMat, x, 57, -412, .08, 3);
    for (let a = 0; a < 8; a++) cube(railMat, x + Math.cos(a * Math.PI / 4) * 4.7, 35.7, -412 + Math.sin(a * Math.PI / 4) * 4.7, .1, 1.4, .1);
    collider(x, -412, 8, 8);
  }
  for (let z = -402; z <= -349; z += 12) {
    cube(darkMat, -131.7, 5.5, z, .2, 8, 5);
    add(domeGeometry, trimMat, -131.9, 9.5, z, .35, 2.6, 2.9);
  }
  cube(blueMat, -132, 4, -379, .3, 7, 8);
  sign('مسجد الموافي', 'Al Mowafi · Old Mansoura', -133, 12, -379, 32, 3.2, -Math.PI / 2);
  for (let z = -448; z < -290; z += 32) palm(-171, z, 8, .72);
  for (const x of [-150, -40]) for (const z of [-456, -290]) tree(x, z, .85);

  // Umm Kulthum square: a pocket plaza off the junction, bronze silhouette,
  // date palms, fountain and patterned pavers.
  cube(pavementMat, -100, .18, 120, 155, .35, 202);
  for (let x = -170; x <= -30; x += 12) for (let z = 30; z <= 215; z += 12) cube((Math.round(x + z) % 24) ? creamMat : stoneMat, x, .38, z, 5.5, .035, 5.5);
  cyl(stoneMat, -99, .8, 115, 29, 1.1);
  cyl(blueMat, -99, 1.4, 115, 26.5, .15);
  cyl(creamMat, -99, 2, 115, 8, 2);
  cube(blackMat, -99, 4, 115, 6, 4, 6);
  const bronzeMat = material('bronze', '#544d3d', { metalness: .65, roughness: .55 });
  add(cone, bronzeMat, -99, 8.2, 115, 1.9, 5.1, 1.5);
  orb(bronzeMat, -99, 11.4, 115, .75, .9, .75);
  beam(bronzeMat, [-100, 9.8, 115], [-101.8, 10.2, 114.5], .3);
  beam(bronzeMat, [-98, 9.8, 115], [-96.5, 8.8, 114.2], .3);
  beam(bronzeMat, [-97, 6.4, 113.9], [-97, 10.3, 113.9], .07);
  cube(creamMat, -99, 4.3, 111.9, 4.5, 1.4, .08);
  sign('أم كلثوم', 'Umm Kulthum Square', -99, 4.3, 111.8, 4.2, 1.2, 0, '#364e49');
  collider(-99, 115, 16, 16);
  for (const x of [-158, -40]) for (const z of [45, 105, 180]) palm(x, z, 9, .86);
  for (const z of [45, 185]) for (const x of [-125, -75]) bench(x, z, z < 100 ? 0 : Math.PI);
  sign('ميدان أم كلثوم', 'The voice of the Nile', -27, 4.2, 105, 18, 3, Math.PI / 2);
  cyl(railMat, -27, 2, 97, .1, 4); cyl(railMat, -27, 2, 113, .1, 4);

  // Shenawy-inspired Italianate palace: warm red brick and ivory colonnades.
  cube(grassMat, 100, .14, 375, 154, .3, 202);
  cube(pavementMat, 100, .35, 364, 36, .2, 160);
  cube(brickMat, 100, 7.5, 410, 88, 15, 45);
  cube(creamMat, 100, 15.4, 410, 94, 1, 49);
  collider(100, 410, 88, 45);
  cube(creamMat, 100, 6.6, 381.5, 55, .65, 14);
  cube(creamMat, 100, 13.7, 381.5, 55, .65, 14);
  for (let x = 77; x <= 124; x += 9.4) {
    cyl(creamMat, x, 3.7, 377.5, .6, 5.8);
    cyl(creamMat, x, 10.1, 377.5, .52, 6.1);
    cube(creamMat, x, 6.6, 377.5, 1.8, .5, 1.8);
    cube(creamMat, x, 13.3, 377.5, 1.5, .5, 1.5);
  }
  for (let x = 65; x <= 135; x += 14) for (const y of [4, 11]) {
    cube(creamMat, x, y, 387.3, 5.1, 5.4, .5);
    cube(glassMat, x, y, 386.9, 3.5, 4.5, .3);
  }
  for (let i = 0; i < 8; i++) cube(creamMat, 100, .4 + i * .25, 369 - i * 1.1, 25, .6, 10 - i * .7);
  for (let x = 58; x < 145; x += 3.5) cube(creamMat, x, 16.5, 386, .7, 1.8, .7);
  cube(creamMat, 100, 17.5, 386, 90, .3, .8);
  for (const x of [46, 154]) for (let z = 295; z < 460; z += 33) tree(x, z, 1.1);
  sign('قصر الشناوي', 'El Shenawy Palace · 1928', 180.4, 4.4, 353, 24, 3, Math.PI / 2, '#733d2e');
  cyl(railMat, 180, 2.4, 343, .1, 4.8); cyl(railMat, 180, 2.4, 363, .1, 4.8);

  // A well-used little corniche cafe, tucked onto the promenade near the river.
  cube(creamMat, 236, 2.1, -220, 12, 4.2, 23);
  cube(blueMat, 236, 4.5, -220, 15, .55, 26);
  cube(darkMat, 229.8, 2.1, -220, .2, 2.9, 17);
  collider(236, -220, 12, 23);
  sign('قهوة ع النيل', 'Coffee on the Nile', 229.5, 4.3, -220, 19, 2.3, -Math.PI / 2);
  for (const z of [-242, -198, -184]) {
    cyl(ochreMat, 240, 1.1, z, 1.25, .2); cyl(railMat, 240, .55, z, .1, 1.1);
    for (const side of [-1, 1]) {
      cube(railMat, 240 + side * 2.1, .6, z, .8, .15, .8);
      cube(railMat, 240 + side * 2.4, 1, z, .12, .9, .8);
    }
    cyl(railMat, 240, 2.6, z, .065, 5.2);
    add(cone, z === -198 ? redMat : ochreMat, 240, 5.2, z, 3.7, .8, 3.7);
  }

  // An everyday market adds layers at street level: fruit boxes, awnings,
  // handcarts and small umbrellas around the downtown cross streets.
  for (let z = -212; z < -35; z += 23) {
    const x = -18.8;
    cube(ochreMat, x, .9, z, 3.2, 1.7, 5.5);
    cube(pick(awningMats), x, 3.8, z, 5, .2, 7);
    for (let i = -1; i <= 1; i++) {
      cube(brickMat, x, 1.85, z + i * 1.55, 2.7, .35, 1.4);
      for (let j = 0; j < 5; j++) orb(i % 2 ? redMat : ochreMat, x + (random() - .5) * 2, 2.13, z + i * 1.55 + (random() - .5), .23);
    }
    for (const dz of [-3, 3]) cyl(railMat, x, 2, z + dz, .06, 3.8);
  }

  // Decorative national flags on public sites and the bridge approach.
  function flag(x, z, height = 12, ry = 0) {
    cyl(railMat, x, height / 2, z, .065, height);
    for (const [i, mat] of [redMat, whiteMat, blackMat].entries()) cube(mat, x + Math.cos(ry) * 1.5, height - .5 - i * .5, z - Math.sin(ry) * 1.5, 3, .5, .04, ry);
  }
  flag(-420, 310, 13, Math.PI / 2); flag(178, -478, 13, 0); flag(-420, -397, 12, Math.PI / 2); flag(100, 330, 12);

  // Boats are a handful of individual groups so they can drift independently.
  const boats = [];
  function felucca(x, z, scale = 1, rotation = 0) {
    const group = new THREE.Group(); root.add(group); group.position.set(x, -.1, z); group.scale.setScalar(scale); group.rotation.y = rotation;
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-10, -1.8); hullShape.lineTo(7, -2.1); hullShape.lineTo(11, 0); hullShape.lineTo(7, 2.1); hullShape.lineTo(-10, 1.8); hullShape.lineTo(-12, 0); hullShape.closePath();
    const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 1.1, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .35, bevelThickness: .35 }), brickMat);
    hull.rotation.x = -Math.PI / 2; group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(16, .25, 3), ochreMat); deck.position.y = 1.2; group.add(deck);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.1, .15, 15, 6), ochreMat); mast.position.set(0, 8, 0); group.add(mast);
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 15, 0, -9, 2, .1, 0, 3, .45, 0, 15, 0, 0, 3, .45, 7, 1.9, 0], 3)); sailGeo.computeVertexNormals();
    const sail = new THREE.Mesh(sailGeo, material('sail', '#e9ddbd', { side: THREE.DoubleSide })); group.add(sail);
    boats.push({ group, x, z, phase: random() * 6, speed: .4 + random() * .45 });
  }
  felucca(345, -90, 1.15, -.3); felucca(490, 190, 1, .35); felucca(385, 470, .8, -.6); felucca(525, -335, .8, 2.6);
  function ferry(x, z) {
    const g = new THREE.Group(); root.add(g); g.position.set(x, -.15, z);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 27), blueMat); hull.position.y = .65; g.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 18), creamMat); cabin.position.y = 3; g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8, .4, 23), whiteMat); roof.position.y = 4.7; g.add(roof);
    for (const side of [-1, 1]) for (let zz = -7; zz < 8; zz += 3) { const win = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.6, 2), glassMat); win.position.set(side * 3.55, 3.15, zz); g.add(win); }
    boats.push({ group: g, x, z, phase: random() * 6, speed: .2 });
  }
  ferry(555, 30);

  // Sparse pedestrian silhouettes stay on sidewalks; they provide street scale
  // without competing with the taxi/traffic system's moving vehicles.
  const peopleColors = ['#e0ccb0', '#476b72', '#765a53', '#a48b61', '#516c58'].map((c, i) => material(`person-${i}`, c));
  const skinMat = material('skin', '#b58965');
  for (let i = 0; i < 115; i++) {
    const street = pick(vertical);
    const x = street + (random() < .5 ? -1 : 1) * (15 + random() * 2);
    const z = -630 + random() * 1260;
    if (horizontal.some(h => Math.abs(z - h) < 24) || (x > 220 && Math.abs(z + 220) < 20)) continue;
    const height = 1.55 + random() * .3;
    cyl(pick(peopleColors), x, height * .43, z, .24, height * .7);
    orb(skinMat, x, height * .9, z, .22);
    for (const s of [-1, 1]) cube(blackMat, x + s * .11, .2, z, .12, .4, .15);
  }

  // Flush geometry only after the city has been composed: several thousand
  // facade details are drawn in a small, fixed set of instanced batches.
  for (const { geometry, mat, transforms } of batches.values()) {
    const instances = new THREE.InstancedMesh(geometry, mat, transforms.length);
    transforms.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
    instances.instanceMatrix.needsUpdate = true;
    // Windows and balcony rails are numerous and tiny; the facade masses,
    // roofs, tree crowns and trunks provide the useful sun shadows.
    instances.castShadow = buildingMats.includes(mat) || [creamMat, brickMat, trunkMat, greenMat, blackMat].includes(mat);
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    root.add(instances);
  }

  const landmarks = [
    { id: 'corniche', name: 'Nile Corniche', arabic: 'المشاية', x: 200, z: 145, description: 'The river breeze, a glass of tea, and a city in motion.' },
    { id: 'cafe', name: 'Coffee on the Nile', arabic: 'قهوة ع النيل', x: 200, z: -220, description: 'A familiar table on Al-Mashaya, beside the Damietta branch.' },
    { id: 'bridge', name: 'Talha Bridge', arabic: 'كوبري طلخا', x: 200, z: -474, description: 'Cross the Nile to the rooftops of Talha.' },
    { id: 'university', name: 'Mansoura University', arabic: 'جامعة المنصورة', x: -400, z: 333, description: 'Palm-lined campus gates on Al-Gomhouria Street.' },
    { id: 'stadium', name: 'Mansoura Stadium', arabic: 'استاد المنصورة', x: -400, z: -375, description: 'Meet the supporters outside the blue-and-white stands.' },
    { id: 'mosque', name: 'Al Mowafi Mosque', arabic: 'مسجد الموافي', x: -200, z: -375, description: 'A downtown mosque inspired by the architecture of the old city.' },
    { id: 'kulthum', name: 'Umm Kulthum Square', arabic: 'ميدان أم كلثوم', x: 0, z: 105, description: 'The voice of Egypt, remembered in a little palm-shaded square.' },
    { id: 'palace', name: 'El Shenawy Palace', arabic: 'قصر الشناوي', x: 200, z: 353, description: 'Red brick, ivory columns, and a quieter corner of Mansoura.' },
    { id: 'market', name: 'Downtown Market', arabic: 'سوق البلد', x: 0, z: -145, description: 'Shop signs, fruit stalls, and the everyday life of the Delta.' },
    { id: 'gomhouria', name: 'Al-Gomhouria Street', arabic: 'شارع الجمهورية', x: -400, z: 105, description: 'A lively cross-city run past balconies, bookshops, and cafes.' },
  ];
  return {
    colliders, landmarks, roads: { vertical, horizontal, width: 24 }, bounds,
    start: { x: 200, z: 150, heading: 0 },
    setNight(night) {
      warmMat.emissiveIntensity = night ? 1.6 : .25;
      glassMat.emissive.set(night ? '#e0bd81' : '#000000');
      glassMat.emissiveIntensity = night ? .42 : 0;
      waterUniforms.colorA.value.set(night ? '#1a3c4c' : '#397b7c');
      waterUniforms.colorB.value.set(night ? '#345a66' : '#72a397');
      waterUniforms.fogColor.value.set(night ? '#172e39' : '#c3bd9f');
    },
    update(dt, time = 0) {
      waterUniforms.time.value = time;
      for (const boat of boats) {
        boat.group.position.y = -.13 + Math.sin(time * .65 + boat.phase) * .08;
        boat.group.rotation.z = Math.sin(time * .5 + boat.phase) * .012;
        boat.group.position.z = boat.z + Math.sin(time * .008 * boat.speed + boat.phase) * 21;
      }
    },
  };
}
