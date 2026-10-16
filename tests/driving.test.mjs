import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createDriving, createTaxi, makeTraffic, vehiclesOverlap } from '../driving.js';

const dt = 1 / 60;
function setup(colliders = [], bounds = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 }) {
  const scene = new THREE.Scene();
  const taxi = createTaxi(scene);
  return { scene, taxi, driving: createDriving(taxi, colliders, bounds) };
}
function advance(driving, seconds, input) {
  for (let i = 0; i < Math.round(seconds / dt); i++) driving.update(dt, input);
}

test('forward acceleration, left steering and synchronized vehicle transform', () => {
  const { driving, taxi } = setup();
  advance(driving, 10, { throttle: 1 });
  assert.ok(driving.state.speed > 35 && driving.state.speed <= 40);
  assert.ok(driving.state.z < -250);
  assert.ok(Math.abs(driving.state.x) < .001);
  assert.equal(taxi.group.position.z, driving.state.z);
  driving.reset();
  advance(driving, 2, { throttle: 1, steer: 1 });
  assert.ok(driving.state.heading > 0);
  assert.ok(driving.state.x < -1);
  assert.equal(taxi.group.rotation.y, driving.state.heading);
});

test('reverse and brakes use signed speed without unintended forward motion', () => {
  const { driving } = setup();
  advance(driving, 2, { throttle: -1 });
  assert.equal(driving.state.speed, -12);
  assert.ok(driving.state.z > 10);
  advance(driving, 1, { brake: true });
  assert.equal(driving.state.speed, 0);
  driving.reset();
  advance(driving, 3, { throttle: 1 });
  const forwardSpeed = driving.state.speed;
  advance(driving, .5, { throttle: -1 });
  assert.ok(driving.state.speed < forwardSpeed && driving.state.speed > 0);
});

test('substeps prevent tunneling through building walls and record damage', () => {
  const { driving } = setup([{ minX: -20, maxX: 20, minZ: -45, maxZ: -40 }]);
  advance(driving, 5, { throttle: 1 });
  assert.ok(driving.state.z >= -38.02, 'front bumper stays outside wall');
  assert.ok(driving.state.health < 100);
  assert.ok(driving.state.lastImpact > 2.2);
});

test('world bounds constrain the car footprint and reset clears damage', () => {
  const { driving } = setup([], { minX: -50, maxX: 50, minZ: -50, maxZ: 50 });
  advance(driving, 5, { throttle: 1 });
  assert.ok(driving.state.z >= -48.02);
  assert.ok(driving.state.health < 100);
  driving.reset({ x: 12, z: 14, heading: Math.PI / 2 });
  assert.equal(driving.state.health, 100);
  assert.equal(driving.state.speed, 0);
  assert.equal(driving.state.x, 12);
  assert.equal(driving.state.z, 14);
});

test('traffic density hides inactive vehicles without mutating the player', () => {
  const { scene } = setup();
  const traffic = makeTraffic(scene);
  traffic.setDensity(.5);
  assert.equal(traffic.cars.filter(car => car.active).length, 18);
  assert.equal(traffic.cars.filter(car => car.group.visible).length, 18);
  const player = { x: 0, z: 0, speed: 20, health: 100 };
  const original = { ...player };
  for (let i = 0; i < 120; i++) traffic.update(dt, player);
  assert.deepEqual(player, original);
  assert.ok(traffic.cars.some(car => car.active && car.speed > 0));
});

test('Verna provides real sedan dimensions, independent headlights and four passengers', () => {
  const { taxi } = setup();
  assert.equal(taxi.dimensions.length, 4.26);
  assert.equal(taxi.dimensions.width, 1.68);
  assert.equal(taxi.dimensions.wheelbase, 2.44);
  assert.equal(taxi.wheels.length, 4);
  taxi.setPassengers(4);
  const people = taxi.body.children.filter(c => c.isGroup && c.children.some(m => m.geometry?.type === 'CapsuleGeometry'));
  assert.equal(people.filter(p => p.visible).length, 5, 'driver and four fare passengers');
  taxi.setPassengers(0);
  assert.equal(people.filter(p => p.visible).length, 1, 'driver remains in the cabin');
  taxi.setNight(true); taxi.body.visible = false;
  assert.equal(taxi.group.children.filter(c => c.isSpotLight && c.intensity > 0).length, 2);
  taxi.setColor('#3e7079');
});

test('concave building footprint leaves its courtyard driveable', () => {
  const polygon = [{ x: 0, z: -20 }, { x: 10, z: -20 }, { x: 10, z: -40 }, { x: -10, z: -40 }, { x: -10, z: -30 }, { x: 0, z: -30 }];
  const { driving } = setup([{ polygon, minX: -10, maxX: 10, minZ: -40, maxZ: -20 }]);
  driving.reset({ x: -6, z: 0 });
  advance(driving, 2.2, { throttle: 1 });
  assert.ok(driving.state.z < -20, 'car enters the empty courtyard inside the footprint AABB');
  assert.equal(driving.state.health, 100, 'empty courtyard does not behave as a solid rectangle');
  advance(driving, 2, { throttle: 1 });
  assert.ok(driving.state.z > -28.2, 'rear courtyard wall blocks the car');
  assert.ok(driving.state.health < 100);
});

test('mapped courtyard holes remain empty while their surrounding walls collide', () => {
  const polygon = [{ x: -20, z: -50 }, { x: 20, z: -50 }, { x: 20, z: -10 }, { x: -20, z: -10 }];
  const holes = [[{ x: -10, z: -40 }, { x: 10, z: -40 }, { x: 10, z: -20 }, { x: -10, z: -20 }]];
  const { driving } = setup([{ polygon, holes }]);
  driving.reset({ x: 0, z: -30 });
  driving.update(dt, {});
  assert.equal(driving.state.z, -30, 'stationary taxi remains in the empty inner court');
  advance(driving, 2, { throttle: 1 });
  assert.ok(driving.state.z > -38.1);
  assert.ok(driving.state.health < 100);
});

test('mapped traffic obeys directed OSM polylines and shares intersection nodes', () => {
  const { scene } = setup();
  const points = [{ x: 0, z: 0, nodeId: 1 }, { x: 0, z: -100, nodeId: 2 }, { x: 100, z: -100, nodeId: 3 }, { x: 100, z: 0, nodeId: 4 }, { x: 0, z: 0, nodeId: 1 }];
  const traffic = makeTraffic(scene, { segments: [{ id: 'loop', points, width: 6, oneway: 1, highway: 'residential' }] });
  assert.equal(traffic.cars.length, 24);
  assert.ok(traffic.cars.every(car => car.edge.segment.id === 'loop' && !car.edge.reverse));
  const startEdges = traffic.cars.map(car => car.edge.id);
  for (let i = 0; i < 1200; i++) traffic.update(dt, { x: 1000, z: 1000 });
  assert.ok(traffic.cars.some((car, i) => car.edge.id !== startEdges[i]), 'cars continue onto connected edges');
  assert.ok(traffic.cars.every(car => Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.heading)));
  assert.ok(traffic.cars.every(car => car.x >= -3 && car.x <= 103 && car.z >= -103 && car.z <= 3));
});

test('reverse-only OSM ways spawn traffic in their legal direction', () => {
  const { scene } = setup();
  const traffic = makeTraffic(scene, { segments: [{ id: 'reverse', points: [{ x: 0, z: 0, nodeId: 1 }, { x: 0, z: -100, nodeId: 2 }], width: 4, oneway: -1, highway: 'residential' }] });
  assert.ok(traffic.cars.every(car => car.edge.reverse && car.edge.dz > 0));
});

test('adjacent lanes on a six-meter street pass without a false traffic impact', () => {
  const taxi = { x: -1.25, z: 0, heading: 0, width: 1.68, length: 4.26 };
  const oncoming = { x: 1.25, z: 0, heading: Math.PI, width: 1.70, length: 4.26 };
  assert.equal(vehiclesOverlap(taxi, oncoming), false, 'two clear lanes fit inside the street');
  oncoming.x = -.3;
  assert.equal(vehiclesOverlap(taxi, oncoming), true, 'crossing into the taxi body is an impact');
  oncoming.x = taxi.x; oncoming.z = -5;
  assert.equal(vehiclesOverlap(taxi, oncoming), false, 'longitudinal gap is clear');
  oncoming.z = -4;
  assert.equal(vehiclesOverlap(taxi, oncoming), true, 'front bumpers intersect');
  oncoming.heading = Math.PI / 2; oncoming.x = 3; oncoming.z = 0;
  assert.equal(vehiclesOverlap(taxi, oncoming), false, 'perpendicular car outside the junction is clear');
  oncoming.x = 0;
  assert.equal(vehiclesOverlap(taxi, oncoming), true, 'perpendicular crossing through the taxi collides');
});
