import * as THREE from './vendor/three.module.js';
import { createWorld } from './world.js';
import { createTaxi, createDriving, makeTraffic } from './driving.js';
import { nearestRoad, routeTo, fareFor } from './navigation.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const keys = new Set(), touch = new Set();
let renderer, world, taxi, driving, traffic, scene, camera, sun, hemisphere, ambient;
let playing = false, paused = false, mode = 'roam', night = false, cameraMode = 0;
let elapsed = 0, uiTimer = 0, routeTimer = 0, lastFrame = 0, toastTimer, panelType;
let route = { points: [], length: 0 }, waypoint = null, mission = null, fareIndex = 0;
let engineAudio = null, soundEnabled = false, trafficDensity = 1, quality = 'high';
let progress = { cash: 0, trips: 0, paint: '#853f42' };
try { const saved = JSON.parse(localStorage.getItem('mansoura-taxi-v1')); if (saved) progress = { ...progress, ...saved }; } catch {}
const save = () => { try { localStorage.setItem('mansoura-taxi-v1', JSON.stringify(progress)); } catch {} };
const routeGroup = new THREE.Group(), marker = new THREE.Group();
const cameraTarget = new THREE.Vector3(), cameraDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
let markerRing, markerPin, passenger;
const pointerMap = new WeakMap();

function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 800 ? 1.5 : 1.75));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    scene = new THREE.Scene(); scene.background = new THREE.Color('#bfc3b1'); scene.fog = new THREE.Fog('#c3bd9f', 180, 900);
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .2, 1600);
    hemisphere = new THREE.HemisphereLight('#d5e6ec', '#86725b', 2.2); scene.add(hemisphere);
    ambient = new THREE.AmbientLight('#e7cda8', .45); scene.add(ambient);
    sun = new THREE.DirectionalLight('#ffce91', 3.4); sun.position.set(-150, 180, -230); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 600 });
    sun.shadow.bias = -.0006; sun.shadow.normalBias = .08; scene.add(sun, sun.target);
    makeSky();
    world = createWorld(scene); taxi = createTaxi(scene); taxi.setColor(progress.paint);
    driving = createDriving(taxi, world.colliders, world.bounds); driving.reset(world.start || { x: 205, z: 150, heading: 0 });
    traffic = makeTraffic(scene, world.roads); scene.add(routeGroup, marker); makeMarker(); liftVehicles();
    camera.position.set(218, 7.8, 172); cameraTarget.set(193, 2.2, 137); camera.lookAt(cameraTarget);
    for (let i = 0; i < 20; i++) $('speedBars').append(document.createElement('i'));
    bindEvents(); updateHUD(); applyNight(false);
    $('loading').classList.add('out'); setTimeout(() => $('loading').remove(), 600);
    requestAnimationFrame(frame);
    // Small, read-only state makes simulation checks possible without coupling to rendering.
    window.mansouraTaxi = { get state() { return { playing, paused, mode, night, cameraMode, driving: { ...driving.state }, mission: mission && { ...mission }, waypoint: waypoint && { ...waypoint }, progress: { ...progress }, routeLength: route.length, render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } }; } };
  } catch (error) {
    console.error('Mansoura Taxi could not start:', error); $('renderError').classList.remove('hidden'); $('loading').classList.add('hidden');
  }
}

function makeSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#8baeb7') }, bottom: { value: new THREE.Color('#ead0a5') } },
    vertexShader: 'varying vec3 vWorld; void main(){vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 top;uniform vec3 bottom;varying vec3 vWorld;
      void main(){
        float h=clamp(normalize(vWorld).y*1.5,0.0,1.0);
        gl_FragColor=vec4(mix(bottom,top,h),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.name = 'Atmosphere'; scene.add(sky);
  const disk = new THREE.Mesh(new THREE.SphereGeometry(29, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffe2a2', fog: false }));
  disk.position.set(-650, 210, -1000); disk.name = 'Sun disk'; scene.add(disk);
}

function makeMarker() {
  const mat = new THREE.MeshBasicMaterial({ color: '#f6b649', transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false });
  markerRing = new THREE.Mesh(new THREE.RingGeometry(7, 8.2, 48), mat); markerRing.rotation.x = -Math.PI / 2; markerRing.position.y = .35; marker.add(markerRing);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 20, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#f6b649', transparent: true, opacity: .045, side: THREE.DoubleSide, depthWrite: false }));
  column.position.y = 10; marker.add(column);
  markerPin = new THREE.Mesh(new THREE.OctahedronGeometry(1.5), new THREE.MeshStandardMaterial({ color: '#ffce6e', emissive: '#e9a532', emissiveIntensity: .6, roughness: .3 })); markerPin.position.y = 8; marker.add(markerPin);
  passenger = new THREE.Group(); const skin = new THREE.MeshStandardMaterial({ color: '#b68964' });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(.23, .31, .75, 8), new THREE.MeshStandardMaterial({ color: '#dde2c8' })); torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.21, 12, 8), skin); head.position.y = 1.7; passenger.add(torso, head);
  for (const side of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .7, 6), new THREE.MeshStandardMaterial({ color: '#3c4c57' })); leg.position.set(side * .13, .39, 0); passenger.add(leg); }
  passenger.position.set(5, 0, 0); marker.add(passenger); marker.visible = false;
}

function applyNight(value) {
  night = value; if (!scene) return;
  scene.background.set(night ? '#102735' : '#bfc3b1'); scene.fog.color.set(night ? '#172e39' : '#c3bd9f');
  hemisphere.intensity = night ? .65 : 2.2; hemisphere.color.set(night ? '#7d9ebc' : '#d5e6ec');
  ambient.intensity = night ? .2 : .45; sun.intensity = night ? .38 : 3.4; sun.color.set(night ? '#8badcf' : '#ffce91');
  const sky = scene.getObjectByName('Atmosphere'); sky.material.uniforms.top.value.set(night ? '#071624' : '#8baeb7'); sky.material.uniforms.bottom.value.set(night ? '#294454' : '#ead0a5');
  scene.getObjectByName('Sun disk').visible = !night;
  taxi?.setNight(night); world?.setNight?.(night); renderer.toneMappingExposure = night ? 1.3 : 1.12;
  $('weatherIcon').textContent = night ? '☾' : '☀'; $('weatherText').textContent = night ? 'AFTER HOURS' : 'GOLDEN HOUR';
  $('clockLabel').textContent = night ? '21:18' : '17:42';
}

function startGame() {
  playing = true; paused = false; waypoint = null; mission = null;
  document.body.classList.add('playing'); $('menu').classList.add('hidden'); $('topbar').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('mobileControls').classList.toggle('hidden', !matchMedia('(pointer:coarse)').matches && innerWidth > 800);
  applyNight(mode === 'night' || night); if (mode === 'shift') newFare(); else setFreeObjective();
  if (soundEnabled) startAudio(); $('playButton').blur(); updateHUD(); toast('Welcome to Mansoura. WASD to drive · M for the map.');
}

function setFreeObjective() {
  $('modeLabel').textContent = mode === 'night' ? 'AFTER HOURS' : 'FREE ROAM';
  $('dispatchLabel').textContent = waypoint ? 'YOUR NEXT STOP' : 'TAKE IT ALL IN';
  $('objectiveTitle').textContent = waypoint ? waypoint.name || 'Custom destination' : 'Welcome to Al Mashaya.';
  $('objectiveDetail').textContent = waypoint ? 'Follow the amber route to your destination.' : 'Follow the river. Find your own way.';
  $('dispatchButton').innerHTML = waypoint ? 'CLEAR DESTINATION <span>×</span>' : 'START A TAXI SHIFT <span>↗</span>';
  $('fareTimer').textContent = ''; $('fareProgress').classList.add('hidden');
  rebuildRoute();
}

function newFare() {
  mode = 'shift'; waypoint = null; $('modeLabel').textContent = 'TAXI SHIFT';
  const destinations = world.landmarks.filter(l => Math.hypot(l.x - driving.state.x, l.z - driving.state.z) > 100);
  const destination = destinations[fareIndex % destinations.length] || world.landmarks[0];
  const nearest = nearestRoad(driving.state, world.roads);
  // A short first pickup lets a new driver discover the fare loop quickly.
  const pickup = fareIndex === 0 ? { x: 200, z: 90, name: 'Al Mashaya Corniche' } : { x: nearest.x, z: nearest.z, name: district().name };
  mission = { phase: 'pickup', pickup, destination, seconds: 180, maxSeconds: 180, startHealth: driving.state.health };
  $('dispatchLabel').textContent = 'A PASSENGER IS WAITING'; $('objectiveTitle').textContent = pickup.name;
  $('objectiveDetail').textContent = `A ride to ${destination.name}. Stop in the amber marker and press E.`;
  $('dispatchButton').innerHTML = 'CANCEL FARE <span>×</span>'; $('fareProgress').classList.remove('hidden'); passenger.visible = true; rebuildRoute();
}

function currentTarget() { return mission ? mission.phase === 'pickup' ? mission.pickup : mission.destination : waypoint; }

function interact() {
  if (!playing || paused || !mission) return;
  const target = currentTarget(), distance = Math.hypot(target.x - driving.state.x, target.z - driving.state.z);
  if (distance > 13) { toast('Drive into the amber marker to meet your passenger.'); return; }
  if (Math.abs(driving.state.speed) > 3) { toast('Come to a stop first. Your passenger will thank you.'); return; }
  if (mission.phase === 'pickup') {
    mission.phase = 'dropoff'; passenger.visible = false;
    mission.seconds = Math.max(100, routeTo(driving.state, mission.destination, world.roads).length / 5 + 50); mission.maxSeconds = mission.seconds;
    $('dispatchLabel').textContent = 'PASSENGER ON BOARD'; $('objectiveTitle').textContent = mission.destination.name;
    $('objectiveDetail').textContent = 'Easy on the corners. Follow the route, stop at the marker, then press E.';
    toast('Passenger aboard. يلا على ' + (mission.destination.arabic || mission.destination.name)); rebuildRoute();
  } else {
    const length = routeTo(mission.pickup, mission.destination, world.roads).length;
    const fare = fareFor(length, mission.seconds, Math.max(0, mission.startHealth - driving.state.health));
    progress.cash += fare; progress.trips++; fareIndex++; save(); mission = null; route = { points: [], length: 0 }; marker.visible = false; clearRouteMeshes();
    $('dispatchLabel').textContent = 'ANOTHER HAPPY PASSENGER'; $('objectiveTitle').textContent = `A good drive. +${fare} EGP`;
    $('objectiveDetail').textContent = 'Earnings saved on this device. Ready for the next story?'; $('dispatchButton').innerHTML = 'FIND NEXT PASSENGER <span>↗</span>';
    $('fareTimer').textContent = ''; $('fareProgress').classList.add('hidden'); toast(`وصلنا بالسلامة! Fare complete · +${fare} EGP`); updateHUD();
  }
}

function clearRouteMeshes() {
  while (routeGroup.children.length) { const child = routeGroup.children[0]; routeGroup.remove(child); child.geometry.dispose(); child.material.dispose(); }
}

function rebuildRoute() {
  const target = currentTarget(); clearRouteMeshes();
  if (!target) { route = { points: [], length: 0 }; marker.visible = false; $('navInstruction').classList.add('hidden'); return; }
  route = routeTo(driving.state, target, world.roads); marker.position.set(target.x, 0, target.z); marker.visible = true; passenger.visible = !!mission && mission.phase === 'pickup';
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], length = Math.hypot(b.x - a.x, b.z - a.z); if (length < 2) continue;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, length), new THREE.MeshBasicMaterial({ color: '#f7b94b', transparent: true, opacity: .58, depthWrite: false }));
    line.rotation.set(-Math.PI / 2, 0, -Math.atan2(b.x - a.x, b.z - a.z)); line.position.set((a.x + b.x) / 2, .34, (a.z + b.z) / 2); routeGroup.add(line);
  }
  $('navInstruction').classList.remove('hidden');
}

function district() {
  const { x, z } = driving.state;
  if (x > 255) return { name: 'Talkha Bridge', arabic: 'كوبري طلخا' };
  if (x > 120) return { name: 'Al Mashaya Corniche', arabic: 'المشاية' };
  if (z > 190 && x < -100) return { name: 'University District', arabic: 'حي الجامعة' };
  if (z < -200 && x < -220) return { name: 'Stadium District', arabic: 'منطقة الاستاد' };
  return { name: 'Downtown Mansoura', arabic: 'وسط المنصورة' };
}

function updateHUD() {
  if (!driving) return; const s = driving.state, speed = Math.round(Math.abs(s.speed) * 3.6);
  $('cash').textContent = progress.cash.toLocaleString('en'); $('tripCount').textContent = `${progress.trips} ride${progress.trips === 1 ? '' : 's'} completed`;
  $('speed').textContent = String(speed).padStart(3, '0'); $('gear').textContent = s.speed < -.5 ? 'R' : speed < 2 ? 'N' : Math.min(5, 1 + Math.floor(speed / 25));
  $('distanceTravelled').textContent = `${(s.distance / 1000).toFixed(1)} KM`; $('healthBar').style.width = `${s.health}%`; $('healthText').textContent = `${Math.round(s.health)}% CONDITION`;
  $('speedBars').querySelectorAll('i').forEach((bar, i) => bar.classList.toggle('on', i < speed / 7));
  const d = district(); $('districtName').textContent = d.name; $('districtArabic').textContent = d.arabic;
  $('cameraLabel').textContent = ['CHASE CAM', 'HIGH CHASE', 'BONNET CAM'][cameraMode];
  const target = currentTarget();
  if (target) {
    const dist = Math.hypot(target.x - s.x, target.z - s.z);
    $('navDistance').textContent = route.length > 1000 ? `${(route.length / 1000).toFixed(1)} km` : `${Math.round(route.length / 10) * 10} m`;
    const next = route.points.find(p => Math.hypot(p.x - s.x, p.z - s.z) > 12) || target;
    let relative = Math.atan2(-(next.x - s.x), -(next.z - s.z)) - s.heading; relative = Math.atan2(Math.sin(relative), Math.cos(relative));
    $('navArrow').textContent = Math.abs(relative) > 2.5 ? '↶' : relative > .45 ? '↰' : relative < -.45 ? '↱' : '↑';
    $('navStreet').textContent = target.name || 'Your destination';
    const near = mission && dist < 18; $('interaction').classList.toggle('hidden', !near);
    $('interactTitle').textContent = mission?.phase === 'dropoff' ? 'Drop off passenger' : 'Pick up passenger';
    if (!mission && dist < 12) { waypoint = null; setFreeObjective(); toast('You’ve arrived. Take a moment. Enjoy the view.'); }
  } else $('interaction').classList.add('hidden');
  if (mission) {
    $('fareTimer').textContent = `${Math.floor(mission.seconds / 60)}:${String(Math.ceil(mission.seconds % 60)).padStart(2, '0')}`;
    $('fareProgress').firstElementChild.style.width = `${Math.max(0, mission.seconds / mission.maxSeconds * 100)}%`;
  }
  drawMap($('minimap'), true);
}

function drawMap(canvas, mini = false) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, s = driving.state;
  const scale = mini ? .37 : Math.min(w / 1200, h / 1420), cx = mini ? s.x : 0, cz = mini ? s.z - 30 : 0;
  const px = x => w / 2 + (x - cx) * scale, pz = z => h / 2 + (z - cz) * scale;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#2a403a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#305c65'; ctx.fillRect(px(255), 0, w, h);
  ctx.fillStyle = '#38534a';
  for (const x of world.roads.vertical) for (const z of world.roads.horizontal.slice(0, -1)) ctx.fillRect(px(x - 168), pz(z + 30), 136 * scale, 180 * scale);
  ctx.lineCap = 'square'; ctx.strokeStyle = '#819180'; ctx.lineWidth = (mini ? 17 : 16) * scale;
  const path = (x1, z1, x2, z2) => { ctx.beginPath(); ctx.moveTo(px(x1), pz(z1)); ctx.lineTo(px(x2), pz(z2)); ctx.stroke(); };
  world.roads.vertical.forEach(x => path(x, -620, x, 620)); world.roads.horizontal.forEach(z => path(-520, z, z === -500 ? 620 : 225, z));
  ctx.strokeStyle = '#c8d0b650'; ctx.lineWidth = .7; world.roads.vertical.forEach(x => path(x, -620, x, 620));
  if (route.points.length > 1) { ctx.strokeStyle = '#f6bc53'; ctx.lineWidth = mini ? 3 : 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); route.points.forEach((p, i) => i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))); ctx.stroke(); }
  ctx.font = `${mini ? 8 : 12}px Barlow, sans-serif`;
  world.landmarks.forEach(l => { ctx.fillStyle = '#b7d6aa'; ctx.beginPath(); ctx.arc(px(l.x), pz(l.z), mini ? 2.5 : 4.5, 0, Math.PI * 2); ctx.fill(); if (!mini) { ctx.fillStyle = '#dbe2c8'; ctx.fillText(l.name, px(l.x) + 9, pz(l.z) + 4); } });
  if (!mini) { ctx.save(); ctx.translate(px(430), pz(-100)); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#9dbeb77a'; ctx.font = '15px Barlow'; ctx.fillText('D A M I E T T A   N I L E', 0, 0); ctx.restore(); ctx.fillStyle = '#c4d0b266'; ctx.font = '10px Barlow'; ctx.fillText('STYLIZED CITY · NOT TO SCALE', 14, h - 15); }
  const target = currentTarget();
  if (target) { ctx.fillStyle = '#f6bc53'; ctx.beginPath(); ctx.arc(px(target.x), pz(target.z), mini ? 5 : 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ffe8a4'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.save(); ctx.translate(px(s.x), pz(s.z)); ctx.rotate(-s.heading); ctx.fillStyle = '#fff5d1'; ctx.strokeStyle = '#1b3632'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  if (!mini) pointerMap.set(canvas, { scale, cx, cz, w, h });
}

function frame(timestamp) {
  requestAnimationFrame(frame); const dt = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .045); lastFrame = timestamp;
  const active = !paused; if (active) elapsed += dt;
  if (playing && active) {
    const input = { throttle: (keys.has('KeyW') || keys.has('ArrowUp') || touch.has('throttle') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || touch.has('reverse') ? 1 : 0), steer: (keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right') ? 1 : 0), brake: keys.has('Space') || touch.has('brake'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    driving.update(dt, input); traffic.update(dt, driving.state); world.update?.(dt, elapsed);
    for (const car of traffic.cars) {
      if (!car.group.visible || Math.hypot(car.x - driving.state.x, car.z - driving.state.z) > 3.4 || driving.state.collisionTimer > 0 || Math.abs(driving.state.speed) < 2) continue;
      driving.state.health = Math.max(0, driving.state.health - Math.min(8, Math.abs(driving.state.speed) * .3)); driving.state.speed *= -.15; driving.state.collisionTimer = .9; toast('A little too close. Easy on the traffic.'); break;
    }
    if (mission) { mission.seconds -= dt; if (mission.seconds <= 0) { mission = null; mode = night ? 'night' : 'roam'; setFreeObjective(); toast('This passenger found another ride. Start a new shift to try again.'); } }
    if (driving.state.health <= 0) { resetTaxi(); toast('Taxi repaired and returned to the road. Take it easy out there.'); }
    routeTimer += dt; if (routeTimer > 1) { routeTimer = 0; if (currentTarget()) rebuildRoute(); }
  } else if (!playing && active) { traffic.update(dt, driving.state); world.update?.(dt, elapsed); }
  liftVehicles(); updateAudio();
  markerRing.rotation.z = elapsed * .15; markerPin.rotation.y = elapsed; markerPin.position.y = 7.8 + Math.sin(elapsed * 2) * .45;
  updateCamera(dt); uiTimer += dt; if (uiTimer > .08) { uiTimer = 0; if (playing) updateHUD(); }
  renderer.render(scene, camera);
}

function updateCamera(dt) {
  const s = driving.state, forward = new THREE.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading));
  if (!playing) {
    cameraDesired.set(s.x + 13 + Math.sin(elapsed * .09) * 2, 7.8, s.z + 22); lookDesired.set(s.x - 12, 2.1, s.z - 13);
  } else {
    const distance = cameraMode === 1 ? 24 : cameraMode === 2 ? -.65 : 12.8 + Math.abs(s.speed) * .065;
    cameraDesired.set(s.x - forward.x * distance, cameraMode === 1 ? 20 : cameraMode === 2 ? 1.65 : 6.1, s.z - forward.z * distance);
    lookDesired.set(s.x + forward.x * (cameraMode === 2 ? 20 : 9), cameraMode === 2 ? 1.45 : 1.6, s.z + forward.z * (cameraMode === 2 ? 20 : 9));
  }
  const smoothing = 1 - Math.exp(-(cameraMode === 2 && playing ? 16 : 5) * dt);
  camera.position.lerp(cameraDesired, smoothing); cameraTarget.lerp(lookDesired, smoothing); camera.lookAt(cameraTarget);
  const fov = playing && keys.has('ShiftLeft') ? 65 : 58; camera.fov += (fov - camera.fov) * smoothing; camera.updateProjectionMatrix();
  sun.position.set(s.x - 150, 180, s.z - 230); sun.target.position.set(s.x, 0, s.z); sun.target.updateMatrixWorld();
  // Keep the headlight nodes active when hiding the body for the bonnet view.
  taxi.group.children[0].visible = !(playing && cameraMode === 2);
}

function liftVehicles() {
  const height = (x, z) => x > 216 && x < 610 && Math.abs(z + 500) < 17 ? .30 : .14;
  taxi.group.position.y = height(driving.state.x, driving.state.z);
  for (const car of traffic.cars) car.group.position.y = height(car.x, car.z);
}

function resetTaxi() {
  const point = nearestRoad(driving.state, world.roads); point.x = clamp(point.x, -480, 205); point.z = clamp(point.z, -580, 580);
  const onVertical = world.roads.vertical.includes(point.x);
  driving.reset({ x: point.x + (onVertical ? 5 : 0), z: point.z + (onVertical ? 0 : 5), heading: onVertical ? 0 : Math.PI / 2 });
  keys.clear(); touch.clear(); rebuildRoute();
}

function showPanel(type) {
  panelType = type; paused = true; keys.clear(); touch.clear(); const p = $('panelContent');
  if (type === 'pause') {
    p.innerHTML = `<p class="panel-kicker">TAKE A BREATHER</p><h2>The city can wait.</h2><p>${progress.trips} rides completed · ${progress.cash.toLocaleString()} EGP earned.<br>Your earnings and taxi paint are saved on this device.</p><div class="panel-actions"><button class="panel-button" data-action="resume">BACK TO THE STREETS ↗</button><button class="panel-button secondary" data-action="settings">SETTINGS</button><button class="panel-button secondary" data-action="reset">RESET TAXI</button><button class="panel-button secondary" data-action="menu">MAIN MENU</button></div>`;
  } else if (type === 'controls') {
    p.innerHTML = `<p class="panel-kicker">A QUICK DRIVING LESSON</p><h2>Make yourself at home.</h2><p>Explore at your own pace or start a taxi shift. Follow the amber route to your passenger, stop inside the marker, then press E. Do the same at the destination to collect your fare.</p><div class="control-grid">${[['W A S D','Drive · arrow keys work too'],['SPACE','Brake / handbrake'],['E','Pick up / drop off'],['SHIFT','A little extra acceleration'],['C','Change camera'],['H','Sound the horn'],['M','Map & custom destinations'],['R','Recover / repair taxi'],['ESC','Pause / resume']].map(([key, label]) => `<div><kbd>${key}</kbd><span>${label}</span></div>`).join('')}</div><p>On a phone, use the on-screen steering and pedal controls. Brake or reverse with ▼. No account needed.</p><div class="panel-actions"><button class="panel-button" data-action="resume">GOT IT ↗</button></div>`;
  } else if (type === 'garage') {
    p.innerHTML = `<p class="panel-kicker">02 — THE GARAGE</p><h2>A Mansoura classic.</h2><p>A familiar shape. A little character in every panel. The burgundy and cream livery takes its cue from real Mansoura taxis.</p><div class="garage-options">${[['#853f42','MANSOURA ORIGINAL'],['#dbad46','GOLDEN HOUR'],['#3e7079','NILE BLUE']].map(([color, name]) => `<button class="paint-option ${progress.paint === color ? 'active' : ''}" data-paint="${color}"><i style="--paint:${color}"></i>${name}</button>`).join('')}</div><div class="garage-stat"><div><strong>CLASSIC</strong><small>EGYPTIAN SEDAN</small></div><div><strong>REAR</strong><small>WHEEL DRIVE</small></div><div><strong>ALL YOURS</strong><small>ALL LIVERIES UNLOCKED</small></div></div><div class="panel-actions"><button class="panel-button" data-action="resume">LOOKING GOOD ↗</button></div>`;
  } else if (type === 'settings') {
    p.innerHTML = `<p class="panel-kicker">MAKE IT YOUR DRIVE</p><h2>Your kind of city.</h2><div class="setting-row"><span>Time of day</span><div>${[['day','GOLDEN HOUR'],['night','AFTER HOURS']].map(([v,l])=>`<button class="setting-choice ${night === (v==='night') ? 'active' : ''}" data-time="${v}">${l}</button>`).join('')}</div></div><div class="setting-row"><span>Street traffic</span><div>${[['0','QUIET'],['0.5','REGULAR'],['1','BUSY']].map(([v,l])=>`<button class="setting-choice ${trafficDensity === +v ? 'active' : ''}" data-density="${v}">${l}</button>`).join('')}</div></div><div class="setting-row"><span>Engine & horn</span><button class="setting-choice active" data-action="sound">${soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</button></div><div class="setting-row"><span>Graphics</span><div><button class="setting-choice ${quality === 'high' ? 'active' : ''}" data-quality="high">DETAILED</button><button class="setting-choice ${quality === 'low' ? 'active' : ''}" data-quality="low">LIGHTWEIGHT</button></div></div><div class="panel-actions"><button class="panel-button" data-action="resume">BACK TO THE CITY ↗</button><button class="panel-button secondary" data-action="controls">CONTROLS</button></div>`;
  } else if (type === 'city') {
    p.innerHTML = `<p class="panel-kicker">03 — GET TO KNOW YOUR CITY</p><h2>Every road, a story.</h2><canvas id="cityMap" class="city-map" width="720" height="650" aria-label="City map. Click a street to set a destination."></canvas><div class="city-key"><span><i></i> YOUR DESTINATION</span><span><i></i> CITY LANDMARK</span><span>▲ YOU ARE HERE</span></div><p class="map-note">${mission ? 'Your passenger route is active. Finish or cancel the fare to set a custom destination.' : 'Click any street to set a destination. The nearest road will guide you there.'} This is an original, compressed interpretation of Mansoura.</p><button class="sources-link" data-action="about">REFERENCE NOTES & CREDITS ↗</button>`;
    drawMap($('cityMap')); $('cityMap').addEventListener('click', event => {
      if (mission) { toast('Finish your current fare before setting a destination.'); return; }
      const canvas = event.currentTarget, box = canvas.getBoundingClientRect(), map = pointerMap.get(canvas);
      const point = nearestRoad({ x: ((event.clientX - box.left) * canvas.width / box.width - map.w / 2) / map.scale + map.cx, z: ((event.clientY - box.top) * canvas.height / box.height - map.h / 2) / map.scale + map.cz }, world.roads);
      point.x = clamp(point.x, -480, 205); point.z = clamp(point.z, -590, 590); waypoint = { ...point, name: 'Your next stop' };
      closePanel(); if (!playing) { mode = night ? 'night' : 'roam'; const selected = waypoint; startGame(); waypoint = selected; } setFreeObjective(); toast('Destination set. Follow the amber route.');
    });
  } else if (type === 'about') {
    p.innerHTML = `<p class="panel-kicker">MADE FOR THE LOVE OF THE STREETS</p><h2>A city, reimagined.</h2><p>Mansoura Taxi is an early playable 3D prototype. The Nile promenade, university, local taxi colors, Arabic shop signs, and simplified landmarks draw from Mansoura photographs and official university references.</p><p>The street grid, distances, traffic and buildings are original gameplay approximations. This is not a surveyed replica. Online footage links are documented for future work; the footage has not all been analyzed or used as game assets.</p><p>Inspired by the instantly playable Egyptian driving of <a href="https://dayeri.com/" target="_blank" rel="noopener">Dayeri</a> and <a href="https://alextaxigame.com/" target="_blank" rel="noopener">Alexandria Taxi</a>, with a cinematic open-world driving interface. Models, scene geometry and synthesized sounds are original. Rendering: Three.js (MIT). Type: Barlow & Noto Sans Arabic (OFL).</p><p>Visual references: <a href="https://commons.wikimedia.org/wiki/File:Taxi_car.jpg" target="_blank" rel="noopener">Mansoura taxi photograph</a> · <a href="https://commons.wikimedia.org/wiki/Category:Nile_in_El_Mansoura" target="_blank" rel="noopener">Nile photographs</a> · <a href="https://www.mans.edu.eg/en/" target="_blank" rel="noopener">Mansoura University</a>.</p><div class="panel-actions"><button class="panel-button" data-action="city">BACK TO THE MAP ↗</button></div>`;
  }
  if (!$('panelDialog').open) $('panelDialog').showModal();
}

function closePanel() { $('panelDialog').close(); paused = false; panelType = null; keys.clear(); touch.clear(); }

function toggleSound() {
  soundEnabled = !soundEnabled; if (soundEnabled) startAudio(); else if (engineAudio) engineAudio.master.gain.value = 0;
  $('soundButton').textContent = soundEnabled ? '♫' : '♪'; $('soundButton').setAttribute('aria-label', soundEnabled ? 'Mute engine sound' : 'Enable engine sound');
  if (panelType === 'settings') showPanel('settings');
}

function startAudio() {
  try {
    if (!engineAudio) {
      const context = new (window.AudioContext || window.webkitAudioContext)(), master = context.createGain(), oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain();
      master.gain.value = .28; master.connect(context.destination); oscillator.type = 'sawtooth'; oscillator.frequency.value = 42; filter.type = 'lowpass'; filter.frequency.value = 160; gain.gain.value = .08; oscillator.connect(filter).connect(gain).connect(master); oscillator.start(); engineAudio = { context, master, oscillator, filter, gain };
    }
    engineAudio.context.resume(); engineAudio.master.gain.value = .28;
  } catch { soundEnabled = false; }
}

function updateAudio() {
  if (!soundEnabled || !engineAudio) return;
  const speed = Math.abs(driving.state.speed), t = engineAudio.context.currentTime;
  engineAudio.oscillator.frequency.setTargetAtTime(35 + speed * 2.4, t, .08); engineAudio.filter.frequency.setTargetAtTime(130 + speed * 13, t, .1); engineAudio.gain.gain.setTargetAtTime(playing && !paused ? .065 + speed * .002 : 0, t, .1);
}

function horn() {
  if (!soundEnabled) { toast('Turn on engine & horn sound in settings to hear the city.'); return; } startAudio();
  const { context, master } = engineAudio;
  [349, 440].forEach(freq => { const o = context.createOscillator(), g = context.createGain(); o.type = 'sawtooth'; o.frequency.value = freq; g.gain.setValueAtTime(.0001, context.currentTime); g.gain.exponentialRampToValueAtTime(.12, context.currentTime + .025); g.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .45); o.connect(g).connect(master); o.start(); o.stop(context.currentTime + .5); });
}

function bindEvents() {
  $('playButton').addEventListener('click', startGame); $('controlsButton').addEventListener('click', () => showPanel('controls'));
  $('settingsButton').addEventListener('click', () => showPanel('settings')); $('soundButton').addEventListener('click', toggleSound);
  $('timeButton').addEventListener('click', () => applyNight(!night)); $('pauseButton').addEventListener('click', () => showPanel('pause'));
  $('homeButton').addEventListener('click', () => { if ($('panelDialog').open) closePanel(); });
  $('fullscreenButton').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen is unavailable in this browser window.'); } });
  $('minimapButton').addEventListener('click', () => showPanel('city')); $('closePanel').addEventListener('click', closePanel);
  $('panelDialog').addEventListener('cancel', event => { event.preventDefault(); closePanel(); });
  $('panelDialog').addEventListener('click', event => { if (event.target === $('panelDialog')) { const box = $('panelDialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closePanel(); } });
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => { if (button.dataset.panel !== 'drive') showPanel(button.dataset.panel); }));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); }); applyNight(mode === 'night'); }));
  $('dispatchButton').addEventListener('click', () => { if (mission) { mission = null; mode = night ? 'night' : 'roam'; setFreeObjective(); toast('Fare cancelled. Take a drive or start again.'); } else if (waypoint) { waypoint = null; setFreeObjective(); } else newFare(); });
  $('panelContent').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return; const data = button.dataset;
    if (data.paint) { progress.paint = data.paint; taxi.setColor(data.paint); save(); showPanel('garage'); toast('Fresh paint. Same Mansoura soul.'); }
    if (data.time) { applyNight(data.time === 'night'); showPanel('settings'); }
    if (data.density) { trafficDensity = +data.density; traffic.setDensity(trafficDensity); showPanel('settings'); }
    if (data.quality) { quality = data.quality; renderer.shadowMap.enabled = quality === 'high'; renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 1.75) : 1); showPanel('settings'); }
    if (data.action === 'resume') closePanel();
    if (['settings','controls','city','about'].includes(data.action)) showPanel(data.action);
    if (data.action === 'reset') { resetTaxi(); closePanel(); toast('Back on the road. Taxi repaired.'); }
    if (data.action === 'sound') toggleSound();
    if (data.action === 'menu') { closePanel(); playing = false; mission = null; waypoint = null; clearRouteMeshes(); marker.visible = false; driving.reset(world.start); document.body.classList.remove('playing'); $('menu').classList.remove('hidden'); $('topbar').classList.remove('hidden'); $('hud').classList.add('hidden'); $('mobileControls').classList.add('hidden'); if (engineAudio) engineAudio.gain.gain.value = 0; }
  });
  window.addEventListener('keydown', event => {
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code) && playing) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape') { if ($('panelDialog').open) closePanel(); else if (playing) showPanel('pause'); return; }
    if (!playing || paused) return; keys.add(event.code);
    if (event.code === 'KeyE') interact(); if (event.code === 'KeyM') showPanel('city');
    if (event.code === 'KeyC') { cameraMode = (cameraMode + 1) % 3; updateHUD(); }
    if (event.code === 'KeyH') horn(); if (event.code === 'KeyR') { resetTaxi(); toast('Taxi reset and repaired.'); }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); touch.clear(); if (playing && !paused) showPanel('pause'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused) showPanel('pause'); });
  document.querySelectorAll('[data-touch]').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); if (button.dataset.touch === 'interact') interact(); else touch.add(button.dataset.touch); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, () => touch.delete(button.dataset.touch)));
  });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); if (playing) $('mobileControls').classList.toggle('hidden', !matchMedia('(pointer:coarse)').matches && innerWidth > 800); });
}

init();
