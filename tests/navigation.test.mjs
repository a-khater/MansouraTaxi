import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestRoad, routeTo, fareFor } from '../navigation.js';

const roads = { vertical: [-400, -200, 0, 200], horizontal: [-500, -250, 0, 250, 500], width: 24 };

function assertBridgeCrossingsOnly(route) {
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    if (Math.min(a.x, b.x) < 592 && Math.max(a.x, b.x) > 254) {
      assert.equal(a.z, -500, 'a route entering the Nile uses the bridge');
      assert.equal(b.z, -500, 'a route leaving the Nile uses the bridge');
    }
  }
}

test('nearest road projects onto the closest street', () => {
  assert.deepEqual(nearestRoad({ x: 205, z: 140 }, roads), { x: 200, z: 140, axis: 'z', road: 200 });
  assert.deepEqual(nearestRoad({ x: 90, z: -247 }, roads), { x: 90, z: -250, axis: 'x', road: -250 });
});

test('same street route preserves endpoints and direct distance', () => {
  const start = { x: 200, z: 150 }, end = { x: 200, z: 90 };
  const route = routeTo(start, end, roads);
  assert.equal(route.length, 60);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), end);
});

test('shared offset coordinates do not create streets through city blocks', () => {
  const route = routeTo({ x: 77, z: 0 }, { x: 77, z: 250 }, roads);
  assert.equal(route.length, 404, 'use x=0 as the connecting north-south street');
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    const verticalStreet = a.x === b.x && roads.vertical.includes(a.x);
    const horizontalStreet = a.z === b.z && roads.horizontal.includes(a.z);
    assert.ok(verticalStreet || horizontalStreet, `route segment ${JSON.stringify(a)} → ${JSON.stringify(b)} follows an actual street`);
  }
});

test('cross-city route reaches the university through the street grid', () => {
  const route = routeTo({ x: 200, z: 150 }, { x: -400, z: 333 }, roads);
  assert.equal(route.length, 783);
  assert.ok(route.points.length >= 4);
});

test('far-bank return to Mansoura follows the bank and crosses Talha Bridge', () => {
  const start = { x: 610, z: 0 }, end = { x: 200, z: 145 };
  const route = routeTo(start, end, roads);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), end);
  assert.ok(route.points.some(p => p.x === 610 && p.z === -500));
  assert.ok(route.points.some(p => p.x === 200 && p.z === -500));
  assert.equal(route.length, 1555);
  assertBridgeCrossingsOnly(route);
});

test('two far-bank destinations stay on the far-bank street', () => {
  const start = { x: 610, z: 100 }, end = { x: 610, z: -250 };
  const route = routeTo(start, end, roads);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), end);
  assert.equal(route.length, 350);
  assert.ok(route.points.every(p => p.x === 610));
  assertBridgeCrossingsOnly(route);
});

test('west-bank trip to the far bank crosses the bridge before heading south', () => {
  const start = { x: -200, z: 250 }, end = { x: 610, z: 100 };
  const route = routeTo(start, end, roads);
  assert.deepEqual(route.points[0], start);
  assert.deepEqual(route.points.at(-1), end);
  assert.ok(route.points.some(p => p.x === 610 && p.z === -500));
  assert.ok(route.points.some(p => p.x === 200 && p.z === -500));
  assert.equal(route.length, 2160);
  assertBridgeCrossingsOnly(route);
});

test('fare rewards distance and remaining time, deducts damage, and has a floor', () => {
  assert.equal(fareFor(800, 50, 0), 103);
  assert.equal(fareFor(200, 100, 20), 48);
  assert.equal(fareFor(0, 0, 100), 30);
  assert.equal(fareFor(200, -50, 0), fareFor(200, 0, 0));
  assert.ok(fareFor(500, 20, 0) > fareFor(200, 20, 0));
  assert.ok(fareFor(500, 20, 0) > fareFor(500, 20, 20));
});
