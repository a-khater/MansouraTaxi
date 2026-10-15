import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createDriving, createTaxi, makeTraffic } from '../driving.js';

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
