import * as THREE from './vendor/three.module.js';
import { createWorld } from './world.js';
import { createTaxi, createDriving, makeTraffic, vehiclesOverlap } from './driving.js';
import { nearestRoad, routeTo } from './navigation.js';
import { createFareSystem } from './fares.js';
import { createRenderPipeline } from './rendering.js';

const $ = id => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const keys = new Set(), touch = new Set();
let renderer, world, taxi, driving, traffic, scene, camera, sun, hemisphere, ambient, pipeline, mapData, fareSystem;
let playing = false, paused = false, mode = 'roam', night = false, cameraMode = 0;
let elapsed = 0, uiTimer = 0, routeTimer = 0, lastFrame = 0, toastTimer, panelType;
let route = { points: [], length: 0 }, waypoint = null;
let appliedCash = 0, appliedTrips = 0, lastDialogue = '', lastTargetKey = '';
let engineAudio = null, soundEnabled = false, trafficDensity = 1, quality = 'high';
let progress = { cash: 0, trips: 0, paint: '#853f42' };
try { const saved = JSON.parse(localStorage.getItem('mansoura-taxi-v1')); if (saved) progress = { ...progress, ...saved }; } catch {}
const save = () => { try { localStorage.setItem('mansoura-taxi-v1', JSON.stringify(progress)); } catch {} };
const routeGroup = new THREE.Group(), marker = new THREE.Group();
const cameraTarget = new THREE.Vector3(), cameraDesired = new THREE.Vector3(), lookDesired = new THREE.Vector3();
let markerRing, markerPin, passenger;
const pointerMap = new WeakMap();
let mapCache;

function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}

async function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('gameCanvas'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 800 ? 1.5 : 1.75));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    scene = new THREE.Scene(); scene.background = new THREE.Color('#bfc3b1'); scene.fog = new THREE.Fog('#c3bd9f', 240, 1900);
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .15, 6500);
    hemisphere = new THREE.HemisphereLight('#d5e6ec', '#86725b', 2.2); scene.add(hemisphere);
    ambient = new THREE.AmbientLight('#e7cda8', .45); scene.add(ambient);
    sun = new THREE.DirectionalLight('#ffce91', 3.4); sun.position.set(-150, 180, -230); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 600 });
    sun.shadow.bias = -.0006; sun.shadow.normalBias = .08; scene.add(sun, sun.target);
    makeSky();
    const mapResponse = await fetch('assets/mansoura-map.json');
    if (!mapResponse.ok) throw new Error('The real Mansoura map could not be loaded.');
    mapData = await mapResponse.json();
    world = createWorld(scene, mapData); taxi = createTaxi(scene); taxi.setColor(progress.paint);
    driving = createDriving(taxi, world.colliders, world.bounds); driving.reset(world.start || { x: 205, z: 150, heading: 0 });
    traffic = makeTraffic(scene, world.roads); scene.add(routeGroup, marker); makeMarker(); liftVehicles();
    fareSystem = createFareSystem({ landmarks: world.landmarks, roads: world.roads, start: world.start });
    pipeline = createRenderPipeline(renderer, scene, camera);
    const initial = world.start, f = new THREE.Vector3(-Math.sin(initial.heading), 0, -Math.cos(initial.heading));
    camera.position.set(initial.x - f.x * 19 + f.z * -8, 6.2, initial.z - f.z * 19 + f.x * 8);
    cameraTarget.set(initial.x + f.x * 8, 1.4, initial.z + f.z * 8); camera.lookAt(cameraTarget);
    for (let i = 0; i < 20; i++) $('speedBars').append(document.createElement('i'));
    bindEvents(); updateHUD(); applyNight(false);
    $('loading').classList.add('out'); setTimeout(() => $('loading').remove(), 600);
    requestAnimationFrame(frame);
    // Small, read-only state makes simulation checks possible without coupling to rendering.
    window.mansouraTaxi = { get state() { return { playing, paused, mode, night, cameraMode, driving: { ...driving.state }, fares: fareSystem.state, target: currentTarget(), waypoint: waypoint && { ...waypoint }, progress: { ...progress }, routeLength: route.length, map: { source: mapData.provenance.source, roads: world.roads.segments.length, buildings: mapData.buildings?.length, bounds: world.bounds }, render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } }; } };
  } catch (error) {
    console.error('Mansoura Taxi could not start:', error); $('renderError').classList.remove('hidden'); $('loading').classList.add('hidden');
  }
}

function makeSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 16), new THREE.ShaderMaterial({
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
  taxi?.setNight(night); world?.setNight?.(night); pipeline?.setNight(night); renderer.toneMappingExposure = night ? 1.3 : 1.12;
  $('weatherIcon').textContent = night ? '☾' : '☀'; $('weatherText').textContent = night ? 'AFTER HOURS' : 'GOLDEN HOUR';
  $('clockLabel').textContent = night ? '21:18' : '17:42';
}

function startGame() {
  playing = true; paused = false; waypoint = null; fareSystem.stopShift();
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
  $('fareChoices').classList.add('hidden'); $('shiftStatus').classList.add('hidden'); $('streetDialogue').classList.add('hidden');
  rebuildRoute();
}

function newFare() {
  mode = 'shift'; waypoint = null; $('modeLabel').textContent = 'TAXI SHIFT';
  fareSystem.startShift(driving.state); processFareEvents(); rebuildRoute(); updateFareHUD();
}

function currentTarget() { return fareSystem?.state.active ? fareSystem.getTarget() : waypoint; }

function interact() {
  if (!playing || paused || !fareSystem.state.active) return;
  fareSystem.interact(driving.state); processFareEvents(); rebuildRoute(); updateHUD();
}

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function chooseFare(action) {
  if (!playing || paused || !fareSystem.state.active) return;
  const methods = { ask: 'askDestination', accept: 'accept', haggle: 'haggle', reject: 'reject', share: 'shareRoute' };
  fareSystem[methods[action]]?.(); processFareEvents(); rebuildRoute(); updateHUD();
}

function processFareEvents() {
  const state = fareSystem.state;
  if (state.cashDelta !== appliedCash || state.tripsDelta !== appliedTrips) {
    progress.cash = Math.max(0, progress.cash + state.cashDelta - appliedCash);
    progress.trips += state.tripsDelta - appliedTrips; appliedCash = state.cashDelta; appliedTrips = state.tripsDelta; save();
  }
  for (const event of fareSystem.drainEvents()) {
    if (event.text) { lastDialogue = event.text; $('dialogueText').textContent = event.text; $('dialogueSpeaker').textContent = event.speaker === 'driver' ? 'الكابتن' : event.speaker === 'passenger' ? 'من الكنبة اللي ورا' : 'حكايات الوردية'; $('streetDialogue').classList.remove('hidden'); }
    if (['payment', 'pickup', 'abandoned', 'walked', 'consequence'].includes(event.type)) toast(event.text);
  }
  taxi.setPassengers?.(state.passengers.length);
}

function updateFareHUD() {
  const state = fareSystem.state, offer = state.offer, target = currentTarget();
  $('shiftStatus').classList.toggle('hidden', !state.active); $('fareChoices').classList.toggle('hidden', !state.active || !offer || offer.accepted);
  $('passengerCount').textContent = state.passengers.length;
  $('reputationValue').textContent = Math.round(state.reputation);
  $('seatSlots').innerHTML = Array.from({ length: 4 }, (_, i) => `<span class="${state.passengers[i] ? 'occupied' : ''}">${state.passengers[i] ? '●' : '○'}</span>`).join('');
  $('passengerList').innerHTML = state.passengers.map(p => `<div class="passenger-row"><span>●</span><div><strong>${escapeHTML(p.name || p.label)}</strong><small>${escapeHTML(p.destination?.name || p.destination?.arabic)}</small></div><span>${Math.round(p.patience ?? 100)}%</span></div>`).join('');
  if (!state.active) return;
  const mood = state.driverMood > 70 ? 'الكابتن رايق' : state.driverMood > 40 ? 'وردية طويلة' : 'على آخره';
  $('dispatchLabel').textContent = offer && !offer.accepted ? 'A HAND GOES UP · إشارة من الرصيف' : `${state.passengers.length} ON BOARD · ${mood}`;
  $('objectiveTitle').textContent = offer && !offer.accepted ? offer.name || offer.label || 'يا أسطى، فاضي؟' : target?.name || 'نلف لفة كمان؟';
  $('objectiveDetail').textContent = offer && !offer.accepted ? `${offer.scene?.label || offer.appearance || ''} · ${offer.askedDestination ? offer.destination?.name || offer.destination?.arabic : 'اسأل الأول: رايح فين؟'} · ${offer.fare} EGP` : target?.kind === 'pickup' ? 'Stop by the passenger and press E. الاتفاق قبل الركوب.' : state.passengers.length ? 'Every rider has a destination. Stop in the marker, then press E.' : 'The next passenger has an opinion. And a destination.';
  $('fareTimer').textContent = offer ? `${Math.ceil(offer.secondsLeft)}s` : '';
  $('fareProgress').classList.toggle('hidden', !offer);
  if (offer) $('fareProgress').firstElementChild.style.width = `${clamp(offer.secondsLeft / 75 * 100, 0, 100)}%`;
  $('dispatchButton').innerHTML = 'END THE SHIFT <span>×</span>';
  const key = target ? `${target.kind}:${target.passengerId}:${target.x}:${target.z}` : '';
  if (key !== lastTargetKey) { lastTargetKey = key; rebuildRoute(); }
}

function clearRouteMeshes() {
  while (routeGroup.children.length) { const child = routeGroup.children[0]; routeGroup.remove(child); child.geometry.dispose(); child.material.dispose(); }
}

function rebuildRoute() {
  const target = currentTarget(); clearRouteMeshes();
  if (!target) { route = { points: [], length: 0 }; marker.visible = false; $('navInstruction').classList.add('hidden'); return; }
  route = routeTo(driving.state, target, world.roads); marker.position.set(target.x, 0, target.z); marker.visible = true; passenger.visible = target.kind === 'pickup';
  const vertices = [];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i], length = Math.hypot(b.x - a.x, b.z - a.z); if (length < 2) continue;
    const px = -(b.z - a.z) / length * .48, pz = (b.x - a.x) / length * .48;
    const quad = [[a.x-px,.34,a.z-pz],[a.x+px,.34,a.z+pz],[b.x+px,.34,b.z+pz],[b.x-px,.34,b.z-pz]];
    for (const index of [0,1,2,0,2,3]) vertices.push(...quad[index]);
  }
  if (vertices.length) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); const line = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#f7b94b', transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide })); routeGroup.add(line); }
  $('navInstruction').classList.remove('hidden');
}

function district() {
  if (world.getDistrict) return world.getDistrict(driving.state.x, driving.state.z);
  const road = nearestRoad(driving.state, world.roads);
  return { name: road.nameEn || road.name || road.road || 'Mansoura', arabic: road.name || road.road || 'المنصورة' };
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
    const near = fareSystem.state.active && dist < 18; $('interaction').classList.toggle('hidden', !near);
    $('interactTitle').textContent = target.kind === 'dropoff' ? 'وصلنا يا أسطى · Drop off' : 'اركب يا أستاذ · Pick up';
    if (!fareSystem.state.active && dist < 12) { waypoint = null; setFreeObjective(); toast('وصلنا. You’ve arrived.'); }
  } else $('interaction').classList.add('hidden');
  updateFareHUD();
  drawMap($('minimap'), true);
}

function makeMapCache() {
  const b = world.bounds, scale = 2400 / (b.maxX - b.minX), canvas = document.createElement('canvas');
  canvas.width = 2400; canvas.height = Math.ceil((b.maxZ - b.minZ) * scale);
  const ctx = canvas.getContext('2d'), px = x => (x - b.minX) * scale, pz = z => (z - b.minZ) * scale;
  ctx.fillStyle = '#34423c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const polygon = points => { points.forEach((p, i) => i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))); ctx.closePath(); };
  for (const area of mapData.areas || []) { ctx.fillStyle = ['grass', 'meadow', 'recreation_ground', 'forest'].includes(area.tags?.landuse) || area.tags?.leisure ? '#415b46' : '#3b493d'; ctx.beginPath(); polygon(area.points); ctx.fill(); }
  for (const water of mapData.water || []) { ctx.fillStyle = '#305b67'; ctx.beginPath(); polygon(water.points); for (const hole of water.holes || []) polygon(hole); ctx.fill('evenodd'); }
  ctx.fillStyle = '#5a6252'; for (const building of mapData.buildings || []) { ctx.beginPath(); polygon(building.points); ctx.fill(); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const road of world.roads.segments) { ctx.strokeStyle = ['primary', 'secondary', 'tertiary'].some(v => road.highway?.startsWith(v)) ? '#b8b39a' : '#858e7a'; ctx.lineWidth = Math.max(1.4, road.width * scale); ctx.beginPath(); road.points.forEach((p, i) => i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))); ctx.stroke(); }
  return { canvas, scale, bounds: b };
}

function drawMap(canvas, mini = false) {
  if (!mapCache) mapCache = makeMapCache();
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, s = driving.state, b = world.bounds;
  const scale = mini ? .43 : Math.min((w - 42) / (b.maxX - b.minX), (h - 42) / (b.maxZ - b.minZ));
  const cx = mini ? s.x : (b.minX + b.maxX) / 2, cz = mini ? s.z : (b.minZ + b.maxZ) / 2;
  const px = x => w / 2 + (x - cx) * scale, pz = z => h / 2 + (z - cz) * scale;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#2b3e38'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(mapCache.canvas, px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
  if (route.points.length > 1) { ctx.strokeStyle = '#f6bc53'; ctx.lineWidth = mini ? 3 : 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); route.points.forEach((p, i) => i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))); ctx.stroke(); }
  ctx.font = `${mini ? 8 : 10}px Barlow, Arial, sans-serif`;
  world.landmarks.forEach(l => { ctx.fillStyle = '#b7d6aa'; ctx.beginPath(); ctx.arc(px(l.x), pz(l.z), mini ? 3 : 4, 0, Math.PI * 2); ctx.fill(); if (!mini) { ctx.fillStyle = '#eff0d8'; ctx.fillText(l.name, px(l.x) + 8, pz(l.z) + 4); } });
  for (const rider of fareSystem.state.passengers) { ctx.strokeStyle = '#c2e2b4'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px(rider.destination.x), pz(rider.destination.z), 5, 0, Math.PI * 2); ctx.stroke(); }
  const target = currentTarget();
  if (target) { ctx.fillStyle = '#f6bc53'; ctx.beginPath(); ctx.arc(px(target.x), pz(target.z), mini ? 5 : 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ffe8a4'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.save(); ctx.translate(px(s.x), pz(s.z)); ctx.rotate(-s.heading); ctx.fillStyle = '#fff5d1'; ctx.strokeStyle = '#1b3632'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  if (!mini) { ctx.font = '9px Barlow, Arial'; ctx.fillStyle = '#d9deca'; ctx.fillText('GEOGRAPHIC STREET GEOMETRY · NORTH ↑', 14, h - 16); pointerMap.set(canvas, { scale, cx, cz, w, h }); }
}

function frame(timestamp) {
  requestAnimationFrame(frame); const dt = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .045); lastFrame = timestamp;
  const active = !paused; if (active) elapsed += dt;
  if (playing && active) {
    const input = { throttle: (keys.has('KeyW') || keys.has('ArrowUp') || touch.has('throttle') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || touch.has('reverse') ? 1 : 0), steer: (keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right') ? 1 : 0), brake: keys.has('Space') || touch.has('brake'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight') };
    driving.update(dt, input); traffic.update(dt, driving.state); world.update?.(dt, elapsed);
    for (const car of traffic.cars) {
      if (!car.group.visible || !vehiclesOverlap(driving.state, car) || driving.state.collisionTimer > 0 || Math.abs(driving.state.speed) < 2) continue;
      driving.state.health = Math.max(0, driving.state.health - Math.min(8, Math.abs(driving.state.speed) * .3)); driving.state.speed *= -.15; driving.state.collisionTimer = .9; toast('A little too close. Easy on the traffic.'); break;
    }
    if (fareSystem.state.active) { fareSystem.update(dt, driving.state); processFareEvents(); }
    if (driving.state.health <= 0) { resetTaxi(); toast('Taxi repaired and returned to the road. Take it easy out there.'); }
    routeTimer += dt; if (routeTimer > 1) { routeTimer = 0; if (currentTarget()) rebuildRoute(); }
  } else if (!playing && active) { traffic.update(dt, driving.state); world.update?.(dt, elapsed); }
  world.setFocus?.(driving.state.x, driving.state.z); liftVehicles(); updateAudio();
  markerRing.rotation.z = elapsed * .15; markerPin.rotation.y = elapsed; markerPin.position.y = 7.8 + Math.sin(elapsed * 2) * .45;
  updateCamera(dt); uiTimer += dt; if (uiTimer > .08) { uiTimer = 0; if (playing) updateHUD(); }
  pipeline.render(dt);
}

function updateCamera(dt) {
  const s = driving.state, forward = new THREE.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading));
  if (!playing) {
    const rightX = Math.cos(s.heading), rightZ = -Math.sin(s.heading);
    cameraDesired.set(s.x - forward.x * 17 + rightX * (8 + Math.sin(elapsed * .09)), 5.9, s.z - forward.z * 17 + rightZ * 8);
    lookDesired.set(s.x + forward.x * 8 - rightX * 4, 1.25, s.z + forward.z * 8 - rightZ * 4);
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
  (taxi.body || taxi.group.children[0]).visible = !(playing && cameraMode === 2);
  scene.getObjectByName('Atmosphere').position.copy(camera.position);
  scene.getObjectByName('Sun disk').position.set(s.x - 650, 210, s.z - 1000);
}

function liftVehicles() {
  const height = (x, z) => world.heightAt?.(x, z) ?? world.groundHeight ?? .14;
  taxi.group.position.y = height(driving.state.x, driving.state.z);
  for (const car of traffic.cars) car.group.position.y = height(car.x, car.z);
}

function resetTaxi() {
  const point = nearestRoad(driving.state, world.roads);
  const segment = world.roads.segments[point.segmentIndex];
  driving.reset({ x: point.x, z: point.z, heading: (point.heading ?? world.start.heading) + (segment?.oneway === -1 ? Math.PI : 0) });
  keys.clear(); touch.clear(); rebuildRoute();
}

function showPanel(type) {
  panelType = type; paused = true; keys.clear(); touch.clear(); const p = $('panelContent');
  if (type === 'pause') {
    p.innerHTML = `<p class="panel-kicker">TAKE A BREATHER</p><h2>The city can wait.</h2><p>${progress.trips} rides completed · ${progress.cash.toLocaleString()} EGP earned.<br>Your earnings and taxi paint are saved on this device.</p><div class="panel-actions"><button class="panel-button" data-action="resume">BACK TO THE STREETS ↗</button><button class="panel-button secondary" data-action="settings">SETTINGS</button><button class="panel-button secondary" data-action="reset">RESET TAXI</button><button class="panel-button secondary" data-action="menu">MAIN MENU</button></div>`;
  } else if (type === 'controls') {
    p.innerHTML = `<p class="panel-kicker">THE MANSOURA SCHOOL OF DRIVING</p><h2>رايح فين يا أستاذ؟</h2><p>Ask where the passenger is going, agree a fare, then stop at the amber marker and press E. Up to four individual riders can share your Verna. Tell them before pooling: surprise detours cost patience and reputation. Each rider pays separately at their destination. All dialogue is fictional satire; amounts are game currency.</p><div class="control-grid">${[['W A S D','Drive · arrow keys work too'],['SPACE','Brake / handbrake'],['E','Board / drop off while stopped'],['F','Ask the destination'],['1 / 2 / 3','Accept / haggle / refuse'],['4','Disclose a shared route'],['SHIFT','Extra acceleration'],['C','Change camera'],['H','Horn (enable sound)'],['M','Map & destinations'],['R','Recover / repair'],['ESC','Pause / resume']].map(([key, label]) => `<div><kbd>${key}</kbd><span>${label}</span></div>`).join('')}</div><p>On a phone, use the steering and pedal controls and tap the fare choices.</p><div class="panel-actions"><button class="panel-button" data-action="resume">اتفضل يا أسطى ↗</button></div>`;
  } else if (type === 'garage') {
    p.innerHTML = `<p class="panel-kicker">02 — THE GARAGE</p><h2>Verna. حافظة البلد.</h2><p>The Egyptian Hyundai Verna LC2, modeled to its 4.26 m × 1.68 m proportions: curved bodywork, swept headlamps, steel wheels, cabin, dashboard and four passenger seats. Burgundy and cream is the local original.</p><div class="garage-options">${[['#853f42','MANSOURA ORIGINAL'],['#dbad46','GOLDEN HOUR'],['#3e7079','NILE BLUE']].map(([color, name]) => `<button class="paint-option ${progress.paint === color ? 'active' : ''}" data-paint="${color}"><i style="--paint:${color}"></i>${name}</button>`).join('')}</div><div class="garage-stat"><div><strong>VERNA LC2</strong><small>HYUNDAI · 1.6 GLS</small></div><div><strong>FRONT</strong><small>WHEEL DRIVE</small></div><div><strong>4 + YOU</strong><small>EVERY SEAT HAS A STORY</small></div></div><div class="panel-actions"><button class="panel-button" data-action="resume">تمام يا معلم ↗</button></div>`;
  } else if (type === 'settings') {
    p.innerHTML = `<p class="panel-kicker">MAKE IT YOUR DRIVE</p><h2>Your kind of city.</h2><div class="setting-row"><span>Time of day</span><div>${[['day','GOLDEN HOUR'],['night','AFTER HOURS']].map(([v,l])=>`<button class="setting-choice ${night === (v==='night') ? 'active' : ''}" data-time="${v}">${l}</button>`).join('')}</div></div><div class="setting-row"><span>Street traffic</span><div>${[['0','QUIET'],['0.5','REGULAR'],['1','BUSY']].map(([v,l])=>`<button class="setting-choice ${trafficDensity === +v ? 'active' : ''}" data-density="${v}">${l}</button>`).join('')}</div></div><div class="setting-row"><span>Engine & horn</span><button class="setting-choice active" data-action="sound">${soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</button></div><div class="setting-row"><span>Graphics</span><div><button class="setting-choice ${quality === 'high' ? 'active' : ''}" data-quality="high">DETAILED</button><button class="setting-choice ${quality === 'low' ? 'active' : ''}" data-quality="low">LIGHTWEIGHT</button></div></div><div class="panel-actions"><button class="panel-button" data-action="resume">BACK TO THE CITY ↗</button><button class="panel-button secondary" data-action="controls">CONTROLS</button></div>`;
  } else if (type === 'city') {
    p.innerHTML = `<p class="panel-kicker">03 — THE ACTUAL STREET NETWORK</p><h2>من المشاية للجامعة.</h2><canvas id="cityMap" class="city-map" width="900" height="630" aria-label="Geographic Mansoura map. Click a street to set a destination."></canvas><div class="city-key"><span><i></i> NEXT STOP</span><span><i></i> CITY LANDMARK</span><span>▲ YOU ARE HERE</span></div><p class="map-note">${fareSystem.state.active ? 'End the taxi shift to set a free-roam destination.' : 'Click a connected street to set a destination.'} Streets, river and mapped building footprints retain their geographic coordinates. Missing heights and frontage details are inferred.</p><p class="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a></p><button class="sources-link" data-action="about">ACCURACY, RESEARCH & CREDITS ↗</button>`;
    drawMap($('cityMap')); $('cityMap').addEventListener('click', event => {
      if (fareSystem.state.active) { toast('End your taxi shift before choosing a free-roam destination.'); return; }
      const canvas = event.currentTarget, box = canvas.getBoundingClientRect(), map = pointerMap.get(canvas);
      const point = nearestRoad({ x: ((event.clientX - box.left) * canvas.width / box.width - map.w / 2) / map.scale + map.cx, z: ((event.clientY - box.top) * canvas.height / box.height - map.h / 2) / map.scale + map.cz }, world.roads);
      const candidateRoute = routeTo(driving.state, point, world.roads);
      if (candidateRoute.reachable === false) { toast('That street is disconnected from this driving network. Choose a nearby street.'); return; }
      waypoint = { ...point, name: point.nameEn || point.name || 'Your next stop' };
      closePanel(); if (!playing) { mode = night ? 'night' : 'roam'; const selected = waypoint; startGame(); waypoint = selected; } setFreeObjective(); toast('Destination set. Follow the amber route.');
    });
  } else if (type === 'about') {
    p.innerHTML = `<p class="panel-kicker">THE PLACE IS REAL. THE ARGUMENTS ARE FICTIONAL.</p><h2>البلد مش مربعات.</h2><p>The Al Mashaya–Al Gomhouria–university district now uses an attributed OpenStreetMap extract: ${world.roads.segments.length.toLocaleString()} road segments, ${mapData.buildings.length.toLocaleString()} mapped building footprints, the Nile polygon and connected intersections. Horizontal coordinates are retained at meter scale. The map includes a bounded part of Mansoura and Talkha.</p><p>Footprint coverage is incomplete. Most heights, façade materials, windows, shop signs and unmapped frontage are inferred. The visuals have not been validated to 99% similarity. Reaching that target requires current street-level reference coverage, individually reconstructed façades and comparison against a documented survey.</p><p>The original Hyundai Verna model uses measured proportions and photo references. Passenger characters and Egyptian Arabic dialogue are fictional satire informed by local accounts of destination refusals, fare disputes and pooled rides. Individual accounts are anecdotes, not a claim about every driver. Prices are game currency.</p><p>Map: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors, ODbL</a>. Research: <a href="RESEARCH.md" target="_blank" rel="noopener">source notes and footage references</a>. Rendering: Three.js, physically based materials, environment reflections, ACES and postprocessing (MIT). Type: Barlow / Noto Sans Arabic (OFL). Models, decorative textures and synthesized sounds are original.</p><div class="panel-actions"><button class="panel-button" data-action="city">BACK TO THE MAP ↗</button></div>`;
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
  $('dispatchButton').addEventListener('click', () => { if (fareSystem.state.active) { fareSystem.stopShift(); processFareEvents(); mode = night ? 'night' : 'roam'; setFreeObjective(); toast('الوردية خلصت. Earnings saved.'); } else if (waypoint) { waypoint = null; setFreeObjective(); } else newFare(); });
  document.querySelectorAll('[data-fare-action]').forEach(button => button.addEventListener('click', () => chooseFare(button.dataset.fareAction)));
  $('panelContent').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return; const data = button.dataset;
    if (data.paint) { progress.paint = data.paint; taxi.setColor(data.paint); save(); showPanel('garage'); toast('Fresh paint. Same Mansoura soul.'); }
    if (data.time) { applyNight(data.time === 'night'); showPanel('settings'); }
    if (data.density) { trafficDensity = +data.density; traffic.setDensity(trafficDensity); showPanel('settings'); }
    if (data.quality) { quality = data.quality; renderer.shadowMap.enabled = quality === 'high'; renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 1.75) : 1); pipeline.setQuality(quality); pipeline.resize(innerWidth, innerHeight); showPanel('settings'); }
    if (data.action === 'resume') closePanel();
    if (['settings','controls','city','about'].includes(data.action)) showPanel(data.action);
    if (data.action === 'reset') { resetTaxi(); closePanel(); toast('Back on the road. Taxi repaired.'); }
    if (data.action === 'sound') toggleSound();
    if (data.action === 'menu') { closePanel(); playing = false; fareSystem.stopShift(); processFareEvents(); waypoint = null; clearRouteMeshes(); marker.visible = false; driving.reset(world.start); document.body.classList.remove('playing'); $('menu').classList.remove('hidden'); $('topbar').classList.remove('hidden'); $('hud').classList.add('hidden'); $('mobileControls').classList.add('hidden'); if (engineAudio) engineAudio.gain.gain.value = 0; }
  });
  window.addEventListener('keydown', event => {
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code) && playing) event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape') { event.preventDefault(); if ($('panelDialog').open) closePanel(); else if (playing) showPanel('pause'); return; }
    if (!playing || paused) return; keys.add(event.code);
    if (event.code === 'KeyE') interact(); if (event.code === 'KeyM') showPanel('city');
    if (event.code === 'KeyF') chooseFare('ask');
    const fareKey = { Digit1: 'accept', Digit2: 'haggle', Digit3: 'reject', Digit4: 'share' }[event.code];
    if (fareKey) chooseFare(fareKey);
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
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); pipeline.resize(innerWidth, innerHeight); if (playing) $('mobileControls').classList.toggle('hidden', !matchMedia('(pointer:coarse)').matches && innerWidth > 800); });
}

init();
