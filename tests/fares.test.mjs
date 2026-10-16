import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFareSystem } from '../fares.js';
import { nearestRoad, routeTo } from '../navigation.js';

const roads = { segments: [
  { id: 'corniche', name: 'Al Mashaya', points: [{ x: 200, z: 500 }, { x: 200, z: 0 }, { x: 200, z: -500 }] },
  { id: 'gomhouria', points: [{ x: -500, z: 0 }, { x: 0, z: 0 }, { x: 200, z: 0 }] },
  { id: 'university', points: [{ x: 0, z: -500 }, { x: 0, z: 0 }, { x: 0, z: 500 }] },
] };
const landmarks = [
  { name: 'Nile cafe', arabic: 'قهوة ع النيل', x: 200, z: -440 },
  { name: 'University', arabic: 'جامعة المنصورة', x: -440, z: 0 },
  { name: 'Gomhouria', arabic: 'شارع الجمهورية', x: 0, z: 440 },
  { name: 'Market', arabic: 'السوق', x: 0, z: -440 },
];
const start = { x: 200, z: 150, heading: 0, health: 100, speed: 0 };
const make = () => createFareSystem({ roads, landmarks, start, seed: 3407 });

function board(system, disclose = true) {
  const offer = system.state.offer;
  assert.ok(offer, 'a real pending request is present');
  system.askDestination();
  if (disclose) system.shareRoute();
  assert.equal(system.accept().ok, true);
  const player = { ...offer.pickup, speed: 0, health: 100 };
  system.update(0, player);
  const result = system.interact(player);
  assert.equal(result.reason, 'boarded');
  return result.boarded;
}

test('first request is reachable on the actual nearby road and requires an informed explicit decision', () => {
  const f = make(); f.startShift();
  const o = f.state.offer;
  assert.ok(Math.hypot(o.pickup.x - start.x, o.pickup.z - start.z) <= 53);
  assert.ok(nearestRoad(o.pickup, roads).distance < .001);
  assert.equal(routeTo(start, o.pickup, roads).reachable, true);
  assert.equal(o.askedDestination, false);
  assert.equal(f.interact({ ...o.pickup, speed: 0 }).reason, 'decide-first');
  f.askDestination(); assert.equal(o.askedDestination, true);
  f.accept();
  assert.equal(f.interact({ ...o.pickup, speed: 8 }).reason, 'moving');
  assert.equal(f.state.passengers.length, 0);
  assert.equal(f.interact({ ...o.pickup, speed: 0 }).reason, 'boarded');
});

test('three simultaneous unrelated passengers retain individual destinations, patience and payments', () => {
  const f = make(); f.startShift();
  const riders = [];
  for (let i = 0; i < 3; i++) {
    if (i) f.update(7.1);
    riders.push(board(f));
    assert.equal(f.state.passengers.length, i + 1);
  }
  assert.equal(new Set(riders.map(p => p.destination.name)).size, 3);
  assert.ok(riders[0].secondsOnboard > riders[2].secondsOnboard);
  assert.ok(riders[0].patience < riders[2].patience);
  assert.equal(f.state.tripsDelta, 0, 'accepting/boarding never pays');
  const paidIds = [];
  for (const rider of riders) {
    const result = f.interact({ ...rider.destination, speed: 0, health: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.dropped.length, 1);
    paidIds.push(result.dropped[0].passengerId);
  }
  assert.equal(f.state.passengers.length, 0);
  assert.deepEqual(paidIds.sort(), riders.map(r => r.id).sort());
  const payments = f.drainEvents().filter(e => e.type === 'payment');
  assert.equal(payments.length, 3);
  assert.equal(f.state.tripsDelta, 3);
  assert.equal(f.state.cashDelta, payments.reduce((sum, e) => sum + e.amount, 0));
  assert.ok(payments.every(e => e.amount > 0));
  const cash = f.state.cashDelta;
  f.interact({ ...riders[0].destination, speed: 0 });
  assert.equal(f.state.cashDelta, cash, 'one rider cannot be paid twice');
});

test('four passenger limit is enforced and requests resume after a seat opens', () => {
  const f = make(); f.startShift();
  for (let i = 0; i < 4; i++) { if (i) f.update(7.1); board(f); }
  assert.equal(f.state.passengers.length, 4);
  f.update(15);
  assert.equal(f.state.offer, null);
  const first = f.state.passengers[0];
  f.interact({ ...first.destination, speed: 0 });
  assert.equal(f.state.passengers.length, 3);
  f.update(7.1);
  assert.ok(f.state.offer);
});

test('unannounced taxi-as-microbus boarding costs reputation and upsets existing riders', () => {
  const f = make(); f.startShift(); const first = board(f);
  f.update(7.1); const patience = first.patience, reputation = f.state.reputation;
  board(f, false);
  assert.ok(first.patience <= patience - 18);
  assert.equal(first.undisclosedPickups, 1);
  assert.equal(f.state.reputation, reputation - 7);
  assert.ok(f.drainEvents().some(e => e.type === 'complaint'));
});

test('sharing route is idempotent, advertises a lower quote and avoids surprise-pooling penalty', () => {
  const f = make(); f.startShift(); board(f); f.update(7.1);
  const o = f.state.offer, original = o.fare, reputation = f.state.reputation;
  f.shareRoute(); const shared = o.fare; f.shareRoute();
  assert.ok(shared < original);
  assert.equal(o.fare, shared, 'repeated disclosure cannot stack discounts');
  assert.equal(o.askedDestination, true);
  f.accept(); f.interact({ ...o.pickup, speed: 0, health: 100 });
  assert.equal(f.state.reputation, reputation + 1);
  assert.equal(f.state.passengers[0].undisclosedPickups, 0);
});

test('repeated greedy haggling can lose the fare, earns nothing, and costs reputation', () => {
  const f = make(); f.startShift(); const reputation = f.state.reputation;
  f.haggle(); const result = f.haggle();
  assert.equal(result.reason, 'walked-away');
  assert.equal(f.state.offer, null);
  assert.equal(f.state.cashDelta, 0);
  assert.equal(f.state.tripsDelta, 0);
  assert.equal(f.state.reputation, reputation - 6);
});

test('patience expiry requests a stopped early exit and never pays for an abandoned trip', () => {
  const f = make(); f.startShift(); const rider = board(f);
  f.update(rider.maxRideSeconds + 3);
  assert.equal(rider.wantsOut, true);
  assert.equal(f.getTarget().earlyExit, true);
  assert.equal(f.interact({ ...f.getTarget(), speed: 4 }).reason, 'moving');
  const result = f.interact({ ...f.getTarget(), speed: 0 });
  assert.equal(result.dropped[0].early, true);
  assert.equal(result.dropped[0].amount, 0);
  assert.equal(f.state.cashDelta, 0);
  assert.equal(f.state.tripsDelta, 0);
  assert.equal(f.state.abandoned, 1);
});

test('finite time, pause behavior, unpaid cancellation, and drained event queues are stable', () => {
  const f = make(); f.startShift(); board(f);
  const before = f.state.passengers[0].patience;
  f.update(0);
  assert.equal(f.state.passengers[0].patience, before);
  assert.throws(() => f.update(Infinity), TypeError);
  f.stopShift();
  assert.equal(f.state.passengers.length, 0);
  assert.equal(f.state.cashDelta, 0);
  const elapsed = f.state.elapsed; f.update(30);
  assert.equal(f.state.elapsed, elapsed);
  assert.ok(f.drainEvents().length > 0);
  assert.deepEqual(f.drainEvents(), []);
});

test('repairing after a collision does not erase that passenger\'s collision penalty', () => {
  const f = make(); f.startShift(); const rider = board(f);
  f.update(1, { ...rider.pickup, health: 75, speed: 0 });
  assert.equal(rider.healthLost, 25);
  f.update(1, { ...rider.pickup, health: 100, speed: 0 });
  assert.equal(rider.healthLost, 25);
});

test('rejection satire targets a neutral prop or route decision, not a protected trait score', () => {
  const f = make(); f.startShift();
  const keys = Object.keys(f.state.offer.scene).sort();
  assert.deepEqual(keys, ['detail', 'key', 'label', 'line']);
  const rep = f.state.reputation; f.reject('appearance');
  assert.equal(f.state.reputation, rep - 6);
  assert.equal(f.state.cashDelta, 0);
});

test('the labelled five-point haggle preserves the disclosed shared quote', () => {
  const f = make(); f.startShift(); board(f); f.update(7.1); f.shareRoute();
  const o = f.state.offer, sharedQuote = o.fare;
  const result = f.haggle();
  assert.equal(result.reason, 'higher-fare');
  assert.equal(o.proposedFare, sharedQuote + 5);
  assert.equal(o.fare, sharedQuote + 5, 'sharing is not replaced with a 30% premium over the original solo price');
});

test('a due onboard dropoff stays visible even after accepting another pickup', () => {
  const f = make(); f.startShift(); const first = board(f);
  f.update(7.1); f.accept(); const pickupId = f.state.offer.id;
  f.update(0, { ...first.destination, speed: 0 });
  assert.equal(f.getTarget().kind, 'dropoff');
  assert.equal(f.getTarget().passengerId, first.id);
  const result = f.interact();
  assert.equal(result.dropped[0].passengerId, first.id);
  assert.equal(f.getTarget().kind, 'pickup');
  assert.equal(f.getTarget().passengerId, pickupId);
});

test('real Mansoura road costs avoid an unnecessary 2.6 km university detour across the Nile', () => {
  const map = JSON.parse(readFileSync(new URL('../assets/mansoura-map.json', import.meta.url), 'utf8'));
  const stops = ['university', 'talkha'].map(id => map.landmarks.find(p => p.id === id));
  assert.ok(stops.every(Boolean));
  const f = createFareSystem({ landmarks: stops, roads: map.roads, start: map.start });
  f.startShift(); board(f); f.update(7.1); board(f);
  assert.equal(f.state.passengers.length, 2);
  // A mapped point on the opposite bank. The university is visually closer,
  // but one-way access and the Nile make Talkha Bridge the shorter road stop.
  const player = { x: -922.16, z: -1392.802, speed: 0, health: 100 };
  const [university, talkha] = stops;
  assert.ok(Math.hypot(player.x - university.x, player.z - university.z) < Math.hypot(player.x - talkha.x, player.z - talkha.z));
  const universityRoute = routeTo(player, university, map.roads);
  const talkhaRoute = routeTo(player, talkha, map.roads);
  assert.ok(universityRoute.length > talkhaRoute.length + 2000);
  f.update(0, player);
  const target = f.getTarget();
  assert.equal(target.name, talkha.name);
  assert.equal(target.reachable, true);
  assert.ok(Math.abs(target.routeDistance - talkhaRoute.length) < .01);
  for (let i = 0; i < 20; i++) assert.equal(f.getTarget().passengerId, target.passengerId);
});

test('an impatient passenger can leave at the next stopped road position without backtracking', () => {
  const f = make(); f.startShift(); const rider = board(f);
  f.update(rider.maxRideSeconds + 1);
  const oldExit = { ...f.getTarget() };
  const laterStop = { x: 200, z: oldExit.z + 80, speed: 0, health: 100 };
  assert.ok(Math.hypot(laterStop.x - rider.destination.x, laterStop.z - rider.destination.z) > 13);
  const result = f.interact(laterStop);
  assert.equal(result.reason, 'dropped-off');
  assert.equal(result.dropped[0].early, true);
  assert.equal(result.dropped[0].amount, 0);
  assert.equal(f.state.passengers.length, 0);
});

test('a late arrival at the actual agreed destination completes that trip rather than an early abandonment', () => {
  const f = make(); f.startShift(); const rider = board(f);
  f.update(rider.maxRideSeconds + 1);
  assert.equal(rider.wantsOut, true);
  const result = f.interact({ ...rider.destination, speed: 0, health: 100 });
  assert.equal(result.dropped[0].early, false);
  assert.ok(result.dropped[0].amount > 0);
  assert.equal(result.dropped[0].tip, 0);
  assert.equal(f.state.tripsDelta, 1);
  assert.equal(f.state.abandoned, 0);
});

test('offer clocks expose the actual deadline and expire accepted/unaccepted requests once', () => {
  const f = make(); f.startShift(); const o = f.state.offer, reputation = f.state.reputation;
  assert.equal(o.secondsLeft, o.maxSeconds);
  f.update(o.maxSeconds - .1);
  assert.equal(f.state.offer.id, o.id);
  f.update(.2);
  assert.equal(f.state.offer, null);
  assert.equal(f.state.reputation, reputation);
  assert.equal(f.drainEvents().filter(e => e.type === 'expired' && e.passengerId === o.id).length, 1);

  const accepted = make(); accepted.startShift(); accepted.accept();
  const a = accepted.state.offer;
  assert.equal(a.maxSeconds, 100);
  assert.equal(a.secondsLeft, a.maxSeconds);
  accepted.update(a.maxSeconds - .1);
  assert.equal(accepted.state.offer.id, a.id);
  accepted.update(.2);
  assert.equal(accepted.state.offer, null);
  assert.equal(accepted.state.reputation, 57);
  assert.equal(accepted.drainEvents().filter(e => e.type === 'expired' && e.passengerId === a.id).length, 1);
});

test('detour loss accounts for actual one-way road distance rather than visual proximity', () => {
  const loop = { segments: [
    { id: 'east', oneway: 1, points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] },
    { id: 'south', oneway: 1, points: [{ x: 100, z: 0 }, { x: 100, z: 100 }] },
    { id: 'west', oneway: 1, points: [{ x: 100, z: 100 }, { x: 0, z: 100 }] },
    { id: 'north', oneway: 1, points: [{ x: 0, z: 100 }, { x: 0, z: 0 }] },
  ] };
  const f = createFareSystem({ roads: loop, landmarks: [{ name: 'Stop A', x: 80, z: 0 }, { name: 'Stop B', x: 90, z: 0 }], start: { x: 0, z: 0, heading: -Math.PI / 2 } });
  f.startShift(); const rider = board(f);
  assert.equal(rider.destination.x, 80);
  const before = rider.patience;
  f.update(2, { x: 99, z: 0, speed: 0, health: 100 });
  assert.ok(rider.remainingDistance > 350, 'returning to the stop requires the one-way loop');
  assert.ok(rider.excessDistance > 200);
  assert.ok(rider.patience < before - 8, 'the missed stop has a real detour consequence');
});

test('switching from odometer input to documented position-only updates still records distance', () => {
  const f = make(); f.startShift(); const rider = board(f);
  f.update(1, { ...rider.pickup, speed: 0, distance: 10 });
  const before = rider.riddenDistance;
  f.update(1, { x: rider.pickup.x, z: rider.pickup.z + 80, speed: 0 });
  assert.ok(rider.riddenDistance >= before + 79.9);
});

test('a stopped player outside the dropoff radius receives no payment until reaching it', () => {
  const f = make(); f.startShift(); const rider = board(f);
  assert.equal(f.interact({ ...rider.destination, x: rider.destination.x + 14, speed: 0 }).reason, 'too-far');
  assert.equal(f.state.cashDelta, 0);
  assert.equal(f.state.tripsDelta, 0);
  assert.equal(f.interact({ ...rider.destination, x: rider.destination.x + 12, speed: 0 }).ok, true);
  assert.equal(f.state.tripsDelta, 1);
});
