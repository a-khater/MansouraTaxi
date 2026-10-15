import * as THREE from './vendor/three.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (value, target, amount) => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const damp = (value, target, rate, dt) => THREE.MathUtils.lerp(value, target, 1 - Math.exp(-rate * dt));

function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}

function box(parent, material, width, height, depth, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(width, height, depth), material, parent, x, y, z);
}

function quad(parent, material, vertices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return mesh(geometry, material, parent);
}

function canvasTexture(width, height, draw) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function label(parent, texture, w, h, x, y, z, rotation = 0) {
  const material = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
  const item = mesh(new THREE.PlaneGeometry(w, h), material, parent, x, y, z);
  item.rotation.y = rotation;
  return item;
}

/** Classic Egyptian sedan. Its forward direction is local -Z. */
export function createTaxi(scene) {
  const group = new THREE.Group();
  group.name = 'Mansoura Taxi';
  const chassis = new THREE.Group();
  group.add(chassis);
  scene.add(group);

  const paint = new THREE.MeshStandardMaterial({ color: 0x853f42, roughness: 0.32, metalness: 0.34 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe8dcc3, roughness: 0.38, metalness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161c23, roughness: 0.43, metalness: 0.25 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101419, roughness: 0.93 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c5c8, roughness: 0.23, metalness: 0.83 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x193d4b, roughness: 0.14, metalness: 0.44, side: THREE.DoubleSide });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xf5ecd0, emissive: 0xffedbd, emissiveIntensity: 0.28, roughness: 0.2 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xab2223, emissive: 0xe52a1f, emissiveIntensity: 0.5 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf49b22, emissive: 0xeb7d13, emissiveIntensity: 0.15 });

  // Mansoura's burgundy-and-cream livery on squared Peugeot-era proportions.
  box(chassis, dark, 1.83, 0.25, 4.35, 0, 0.40, 0);
  box(chassis, paint, 2.04, 0.43, 4.44, 0, 0.74, 0);
  box(chassis, cream, 2.055, 0.15, 4.32, 0, 0.91, 0);
  box(chassis, cream, 2.04, 0.12, 1.05, 0, 1.005, -1.65);
  box(chassis, cream, 2.04, 0.12, 0.79, 0, 1.005, 1.78);
  box(chassis, cream, 1.92, 0.045, 1.04, 0, 1.073, -1.65);

  // Sloping windscreen, rear window, and separate side window panes.
  quad(chassis, glass, [[-.88, 1.01, -1.12], [.88, 1.01, -1.12], [.76, 1.65, -.57], [-.76, 1.65, -.57]]);
  quad(chassis, glass, [[.88, 1.01, 1.39], [-.88, 1.01, 1.39], [-.76, 1.65, .78], [.76, 1.65, .78]]);
  for (const side of [-1, 1]) {
    const xx = side * .895;
    quad(chassis, glass, [[xx, 1.04, -1.02], [xx, 1.04, -.04], [side * .78, 1.61, -.04], [side * .78, 1.61, -.55]]);
    quad(chassis, glass, [[xx, 1.04, .035], [xx, 1.04, 1.30], [side * .78, 1.61, .76], [side * .78, 1.61, .035]]);
    box(chassis, cream, .075, .64, .09, side * .84, 1.33, -.005);
    box(chassis, chrome, .035, .04, 2.43, side * 1.033, .98, .11);
    box(chassis, chrome, .035, .055, .25, side * 1.043, .87, .53);
    box(chassis, chrome, .035, .055, .25, side * 1.043, .87, -.45);
    const mirror = box(chassis, dark, .24, .14, .31, side * 1.12, 1.09, -.88);
    mirror.rotation.y = side * .15;
    box(chassis, chrome, .035, .10, .22, side * 1.245, 1.095, -.88);
    // Small sill and door seam details read clearly in the chase camera.
    box(chassis, chrome, .035, .055, 3.35, side * 1.035, .48, .04);
    box(chassis, dark, .018, .34, .018, side * 1.03, .69, .09);
  }
  box(chassis, cream, 1.64, .105, 1.53, 0, 1.685, .10);
  for (const side of [-1, 1]) {
    const aPillar = box(chassis, cream, .085, .88, .085, side * .827, 1.33, -.84);
    aPillar.rotation.x = -.71;
    const cPillar = box(chassis, cream, .12, .88, .10, side * .827, 1.33, 1.08);
    cPillar.rotation.x = .76;
  }

  box(chassis, chrome, 2.13, .12, .19, 0, .58, -2.25);
  box(chassis, chrome, 2.13, .12, .19, 0, .58, 2.25);
  box(chassis, dark, .83, .24, .035, 0, .83, -2.231);
  for (let i = -3; i <= 3; i++) box(chassis, chrome, .025, .18, .04, i * .11, .83, -2.255);
  for (const side of [-1, 1]) {
    for (const offset of [-.11, .11]) mesh(new THREE.CylinderGeometry(.115, .115, .04, 18), headlight, chassis, side * .70 + offset, .84, -2.245).rotation.x = Math.PI / 2;
    box(chassis, orange, .19, .10, .035, side * .92, .66, -2.248);
    box(chassis, taillight, .43, .20, .045, side * .72, .84, 2.239);
    box(chassis, orange, .10, .20, .05, side * .94, .84, 2.24);
  }
  box(chassis, chrome, .12, .075, .30, -.64, .34, 2.25);

  const wheels = [];
  for (const side of [-1, 1]) {
    for (const z of [-1.43, 1.43]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.015, .43, z);
      chassis.add(pivot);
      const wheel = new THREE.Group();
      pivot.add(wheel);
      mesh(new THREE.CylinderGeometry(.43, .43, .29, 20), rubber, wheel).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.275, .275, .303, 16), chrome, wheel).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.17, .17, .31, 16), dark, wheel).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.085, .085, .325, 12), chrome, wheel).rotation.z = Math.PI / 2;
      wheels.push({ pivot, wheel, front: z < 0 });
      // Squared black wheel arches frame the tire without hiding its motion.
      box(chassis, dark, .075, .07, 1.0, side * 1.045, .91, z);
    }
  }

  const taxiTexture = canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#ffe5a2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#121b23'; ctx.font = '900 66px Arial'; ctx.textAlign = 'center'; ctx.fillText('TAXI', w / 2, 70);
  });
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xffd571, emissive: 0xffc85a, emissiveIntensity: .3 });
  box(chassis, dark, .68, .045, .28, 0, 1.765, -.04);
  box(chassis, signMaterial, .67, .28, .24, 0, 1.91, -.04);
  label(chassis, taxiTexture, .61, .22, 0, 1.91, -.166, Math.PI);
  label(chassis, taxiTexture, .61, .22, 0, 1.91, .086);

  const plateTexture = canvasTexture(384, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f1f1e9'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3487c6'; ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText('EGYPT    مصر', w / 2, 26);
    ctx.fillStyle = '#172330'; ctx.font = 'bold 59px Arial'; ctx.fillText('د ق هـ  ٢٧٤١', w / 2, 100);
    ctx.strokeStyle = '#a6aaa4'; ctx.lineWidth = 6; ctx.strokeRect(2, 2, w - 4, h - 4);
  });
  label(chassis, plateTexture, .64, .22, 0, .57, -2.355, Math.PI);
  label(chassis, plateTexture, .64, .22, 0, .68, 2.354);
  const emblem = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e8dcc3'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#853f42'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(w / 2, h / 2, 112, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#853f42'; ctx.textAlign = 'center'; ctx.font = 'bold 48px Arial'; ctx.fillText('المنصورة', w / 2, 107); ctx.font = '900 45px Arial'; ctx.fillText('TAXI', w / 2, 166);
  });
  label(chassis, emblem, .43, .43, -1.044, .70, -.54, -Math.PI / 2);
  label(chassis, emblem, .43, .43, 1.044, .70, -.54, Math.PI / 2);

  const lights = [];
  for (const side of [-1, 1]) {
    const light = new THREE.SpotLight(0xffedc2, 0, 57, Math.PI / 7, .65, 1.4);
    light.position.set(side * .73, .9, -2.1);
    light.target.position.set(side * 2, .15, -30);
    group.add(light, light.target);
    lights.push(light);
  }
  let wheelAngle = 0;
  return {
    group,
    wheels,
    setColor(color) { paint.color.set(color); },
    setNight(night) {
      headlight.emissiveIntensity = night ? 2.6 : .28;
      signMaterial.emissiveIntensity = night ? .9 : .3;
      for (const light of lights) light.intensity = night ? 20 : 0;
    },
    updateVisual(dt, speed, steer) {
      wheelAngle -= speed * dt / .43;
      for (const item of wheels) {
        item.wheel.rotation.x = wheelAngle;
        if (item.front) item.pivot.rotation.y = damp(item.pivot.rotation.y, steer * .44, 12, dt);
      }
      chassis.rotation.z = damp(chassis.rotation.z, -steer * clamp(speed / 40, -.8, .8) * .045, 6, dt);
    },
  };
}

function getBox(item) {
  if (!item || item.disabled) return null;
  if (item.min && item.max) return { minX: item.min.x, maxX: item.max.x, minZ: item.min.z, maxZ: item.max.z };
  if (Number.isFinite(item.minX)) return item;
  if (Number.isFinite(item.x) && Number.isFinite(item.z)) {
    const width = item.w ?? item.width ?? 2;
    const depth = item.d ?? item.depth ?? item.length ?? 2;
    return { minX: item.x - width / 2, maxX: item.x + width / 2, minZ: item.z - depth / 2, maxZ: item.z + depth / 2 };
  }
  return null;
}

/** Deterministic driving with substepped collision handling and signed reverse speed. */
export function createDriving(taxi, colliders = [], bounds = {}) {
  const group = taxi.group || taxi;
  const state = { x: group.position.x, z: group.position.z, heading: group.rotation.y, speed: 0, steer: 0, health: 100, distance: 0, collisionTimer: 0, lastImpact: 0, boosting: false };
  const limit = {
    minX: bounds.minX ?? bounds.min?.x ?? -580,
    maxX: bounds.maxX ?? bounds.max?.x ?? 620,
    minZ: bounds.minZ ?? bounds.min?.z ?? -650,
    maxZ: bounds.maxZ ?? bounds.max?.z ?? 650,
  };
  let impactCooldown = 0;

  function hit(impact) {
    if (impactCooldown <= 0 && impact > 2.2) {
      state.health = Math.max(0, state.health - Math.max(1, impact * .54));
      state.collisionTimer = .4;
      state.lastImpact = impact;
      impactCooldown = .4;
    }
  }

  function sync() {
    group.position.x = state.x;
    group.position.z = state.z;
    group.rotation.y = state.heading;
  }

  return {
    state,
    update(dt, input = {}) {
      dt = clamp(dt, 0, .1);
      if (dt === 0) return state;
      const throttle = clamp(input.throttle || 0, -1, 1);
      const steering = clamp(input.steer || 0, -1, 1);
      const braking = !!input.brake;
      state.boosting = !!input.boost && throttle > 0 && state.speed > 4 && !braking;
      state.steer = damp(state.steer, steering, 9, dt);
      state.collisionTimer = Math.max(0, state.collisionTimer - dt);
      impactCooldown = Math.max(0, impactCooldown - dt);
      const steps = Math.ceil(dt / (1 / 90));
      const step = dt / steps;
      for (let n = 0; n < steps; n++) {
        const oldX = state.x;
        const oldZ = state.z;
        const oldSpeed = state.speed;
        const topSpeed = state.boosting ? 51 : 40;
        const acceleration = state.boosting ? 17.2 : 10.4;
        if (braking) {
          state.speed = approach(state.speed, 0, 25 * step);
        } else if (throttle > 0) {
          if (state.speed < -.25) state.speed = approach(state.speed, 0, 19 * step);
          else state.speed = Math.min(topSpeed, state.speed + acceleration * throttle * (1 - Math.pow(Math.max(0, state.speed) / (topSpeed + 3), 2)) * step);
        } else if (throttle < 0) {
          if (state.speed > .25) state.speed = approach(state.speed, 0, 19 * Math.abs(throttle) * step);
          else state.speed = Math.max(-12, state.speed + 7.8 * throttle * step);
        } else {
          state.speed = approach(state.speed, 0, (1.15 + Math.abs(state.speed) * .035) * step);
        }
        if (!state.boosting && state.speed > 40) state.speed = approach(state.speed, 40, 6 * step);
        const grip = braking ? 1.7 : 1;
        const turn = state.steer * (state.speed / 2.82) * Math.tan(.43) / (1 + Math.abs(state.speed) * .078) * grip;
        state.heading += turn * step;
        state.heading = Math.atan2(Math.sin(state.heading), Math.cos(state.heading));
        state.x -= Math.sin(state.heading) * state.speed * step;
        state.z -= Math.cos(state.heading) * state.speed * step;

        // Oriented footprint reduced to world extents; sliding along facades feels natural.
        const extentX = Math.abs(Math.cos(state.heading)) * .96 + Math.abs(Math.sin(state.heading)) * 1.98;
        const extentZ = Math.abs(Math.sin(state.heading)) * .96 + Math.abs(Math.cos(state.heading)) * 1.98;
        let collided = false;
        for (const item of colliders) {
          const b = getBox(item);
          if (!b || state.x + extentX <= b.minX || state.x - extentX >= b.maxX || state.z + extentZ <= b.minZ || state.z - extentZ >= b.maxZ) continue;
          const depths = [state.x + extentX - b.minX, b.maxX - state.x + extentX, state.z + extentZ - b.minZ, b.maxZ - state.z + extentZ];
          const smallest = Math.min(...depths);
          const edge = depths.indexOf(smallest);
          if (edge === 0) state.x = b.minX - extentX - .02;
          else if (edge === 1) state.x = b.maxX + extentX + .02;
          else if (edge === 2) state.z = b.minZ - extentZ - .02;
          else state.z = b.maxZ + extentZ + .02;
          collided = true;
        }
        const clampedX = clamp(state.x, limit.minX + extentX, limit.maxX - extentX);
        const clampedZ = clamp(state.z, limit.minZ + extentZ, limit.maxZ - extentZ);
        if (clampedX !== state.x || clampedZ !== state.z) collided = true;
        state.x = clampedX;
        state.z = clampedZ;
        if (collided) {
          hit(Math.abs(oldSpeed));
          state.speed *= -.18;
          if (Math.abs(state.speed) < .8) state.speed = 0;
        }
        state.distance += Math.hypot(state.x - oldX, state.z - oldZ);
      }
      sync();
      taxi.updateVisual?.(dt, state.speed, state.steer);
      return state;
    },
    reset({ x = 0, z = 0, heading = 0 } = {}) {
      Object.assign(state, { x, z, heading, speed: 0, steer: 0, health: 100, distance: 0, collisionTimer: 0, lastImpact: 0, boosting: false });
      impactCooldown = 0;
      sync();
      return state;
    },
  };
}

function makeCityCar(scene, color, microbus = false) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: .43, metalness: .25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x203c48, roughness: .18, metalness: .35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x131a20, roughness: .8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8e9c9e, roughness: .3, metalness: .7 });
  const head = new THREE.MeshStandardMaterial({ color: 0xfbe7aa, emissive: 0xfbe7aa, emissiveIntensity: .7 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xc72b24, emissive: 0xc72b24, emissiveIntensity: .4 });
  const length = microbus ? 5.9 : 4.3;
  const width = microbus ? 2.25 : 1.95;
  box(group, paint, width, microbus ? 1.05 : .62, length, 0, microbus ? .97 : .75, 0);
  if (microbus) {
    box(group, paint, 2.15, .25, 5.65, 0, 2.05, .05);
    box(group, glass, 2.17, .67, 5.38, 0, 1.62, -.02);
    for (const x of [-1.11, 1.11]) {
      for (const z of [-2.55, -1.3, .05, 1.4, 2.55]) box(group, paint, .065, .75, .09, x, 1.65, z);
      box(group, paint, .05, .08, 5.45, x, 1.3, 0);
      box(group, black, .05, .11, 5.55, x, .85, 0);
    }
  } else {
    box(group, glass, 1.68, .62, 2.30, 0, 1.33, .12);
    box(group, paint, 1.75, .10, 2.38, 0, 1.68, .12);
    for (const side of [-1, 1]) box(group, paint, .055, .63, .10, side * .86, 1.35, .13);
  }
  for (const side of [-1, 1]) {
    for (const z of [-length * .32, length * .32]) {
      mesh(new THREE.CylinderGeometry(.41, .41, .26, 12), black, group, side * width / 2, .43, z).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(.235, .235, .28, 10), metal, group, side * width / 2, .43, z).rotation.z = Math.PI / 2;
    }
    box(group, head, .42, .16, .035, side * width * .32, .82, -length / 2 - .02);
    box(group, tail, .33, .18, .035, side * width * .34, .82, length / 2 + .02);
  }
  box(group, black, width + .08, .13, .14, 0, .51, -length / 2);
  box(group, black, width + .08, .13, .14, 0, .51, length / 2);
  scene.add(group);
  return { group, width, length };
}

/** Ambient traffic follows the street grid and slows for the player's taxi. */
export function makeTraffic(scene, roads = {}) {
  const vertical = Array.isArray(roads.vertical) ? roads.vertical.map(r => typeof r === 'number' ? r : r.x) : [-400, -200, 0, 200];
  const horizontal = Array.isArray(roads.horizontal) ? roads.horizontal.map(r => typeof r === 'number' ? r : r.z) : [-500, -250, 0, 250, 500];
  const cars = [];
  const palette = [0xd5c7a9, 0xe5e7e2, 0x234b64, 0xa73f34, 0x477c79, 0x5a686c, 0xa8916c, 0x738ea6];
  const lane = 5;
  const total = 36;
  let density = 1;
  let elapsed = 0;
  // Fixed seed keeps traffic evenly distributed and gives reproducible route starts.
  let seed = 8274;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < total; i++) {
    const axis = i % 2 ? 'x' : 'z';
    const dir = i % 4 < 2 ? 1 : -1;
    const line = axis === 'z' ? vertical[Math.floor(random() * vertical.length)] : horizontal[Math.floor(random() * horizontal.length)];
    const car = makeCityCar(scene, palette[i % palette.length], i % 8 === 0);
    const coordinate = axis === 'z' ? -575 + random() * 1150 : -470 + random() * 660;
    Object.assign(car, {
      axis, dir, line,
      x: axis === 'x' ? coordinate : line - dir * lane,
      z: axis === 'z' ? coordinate : line + dir * lane,
      heading: axis === 'z' ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2),
      speed: 0, cruise: 9.5 + random() * 9, active: true, index: i,
    });
    car.group.position.set(car.x, 0, car.z);
    car.group.rotation.y = car.heading;
    cars.push(car);
  }
  return {
    cars,
    setDensity(value) {
      density = clamp(Number(value) || 0, 0, 1.5);
      for (const car of cars) {
        car.active = car.index < Math.round(total * Math.min(density, 1));
        car.group.visible = car.active;
      }
    },
    update(dt, player) {
      dt = Math.min(.1, dt);
      elapsed += dt;
      const p = player?.state || player;
      const px = p?.x ?? p?.position?.x ?? 1e6;
      const pz = p?.z ?? p?.position?.z ?? 1e6;
      for (const car of cars) {
        if (!car.active) continue;
        const own = car.axis === 'x' ? car.x : car.z;
        let target = car.cruise;
        const along = ((car.axis === 'x' ? px : pz) - own) * car.dir;
        const across = Math.abs((car.axis === 'x' ? pz - car.z : px - car.x));
        if (along > -3 && along < 29 && across < 3.8) target *= clamp((along - 5.8) / 20, 0, 1);
        // Lane following prevents cars from clipping through slower vehicles.
        for (const other of cars) {
          if (other === car || !other.active || other.axis !== car.axis || other.dir !== car.dir || other.line !== car.line) continue;
          const gap = ((car.axis === 'x' ? other.x : other.z) - own) * car.dir;
          if (gap > 0 && gap < 23) target = Math.min(target, Math.max(0, (gap - 7) * .9));
        }
        // Alternating intersection priority gives the grid a gentle traffic rhythm.
        const crossings = car.axis === 'z' ? horizontal : vertical;
        for (const cross of crossings) {
          const gap = (cross - own) * car.dir;
          if (gap > 13 && gap < 32 && ((Math.floor(elapsed / 9) + (car.axis === 'z' ? 0 : 1)) % 2 === 0)) {
            target = Math.min(target, Math.max(0, (gap - 14) * .85));
          }
        }
        car.speed = approach(car.speed, target, (target < car.speed ? 15 : 3.5) * dt);
        if (car.axis === 'x') {
          car.x += car.speed * car.dir * dt;
          if (car.x > 216) car.x = -492;
          if (car.x < -492) car.x = 216;
        } else {
          car.z += car.speed * car.dir * dt;
          if (car.z > 605) car.z = -605;
          if (car.z < -605) car.z = 605;
        }
        car.group.position.set(car.x, 0, car.z);
      }
    },
  };
}
