// Controller integration without a browser: real Three.js scene/physics,
// tiny DOM fixture, and a renderer substitute. This does not test WebGL output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/vendor/three.module.js')) return {
    format: 'module', shortCircuit: true,
    source: `export * from ${JSON.stringify(url + '?actual')};
      export class WebGLRenderer {
        constructor(){this.shadowMap={};this.info={render:{calls:0,triangles:0}};}
        setPixelRatio(){} setSize(){} render(){}
      }`
  };
  return nextLoad(url, context);
} });

const elements = new Map(), all = [], events = new Map();
const context = new Proxy({}, { get(target, property) {
  if (property === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (property === 'measureText') return () => ({ width: 50 });
  return target[property] ?? (() => {});
}, set(target, key, value) { target[key] = value; return true; } });
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag; this.id = id; this.children = []; this.dataset = {}; this.style = {}; this.handlers = new Map(); this.open = false;
    this.width = 256; this.height = 210; this.textContent = ''; this.classes = new Set();
    this.classList = { add: (...c) => c.forEach(v => this.classes.add(v)), remove: (...c) => c.forEach(v => this.classes.delete(v)), toggle: (c, force) => { const on = force ?? !this.classes.has(c); on ? this.classes.add(c) : this.classes.delete(c); return on; }, contains: c => this.classes.has(c) };
  }
  set innerHTML(html) { this._html = html; this.children = []; parse(html); if (html.includes('<span')) this.children.push(new Element('span')); }
  get innerHTML() { return this._html || ''; }
  get firstElementChild() { if (!this.children.length) this.children.push(new Element()); return this.children[0]; }
  append(child) { this.children.push(child); }
  appendChild(child) { this.append(child); }
  getContext() { return context; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  emit(type, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, ...extra }; for (const fn of this.handlers.get(type) || []) fn(event); }
  click() { this.emit('click'); }
  querySelectorAll(selector) { return selector === 'i' ? this.children : []; }
  blur() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height }; }
}
function parse(html) {
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/gi)) {
    const attrs = match[2], id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const element = id && elements.get(id) || new Element(match[1], id || '');
    if (id) elements.set(id, element);
    for (const data of attrs.matchAll(/data-([a-z]+)="([^"]+)"/g)) element.dataset[data[1]] = data[2];
    if (attrs.includes('class=')) attrs.match(/class="([^"]*)"/)?.[1].split(' ').forEach(c => element.classes.add(c));
    if (!all.includes(element)) all.push(element);
  }
}
parse(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
let frameCallback;
const savedValues = new Map();
Object.assign(globalThis, {
  window: globalThis, innerWidth: 1366, innerHeight: 768, devicePixelRatio: 1,
  document: { body: new Element('body'), getElementById: id => elements.get(id), createElement: tag => new Element(tag), querySelectorAll: selector => { const key = selector.match(/\[data-([a-z]+)\]/)?.[1]; return all.filter(e => key && key in e.dataset); }, addEventListener() {} },
  localStorage: { getItem: key => savedValues.get(key) ?? null, setItem: (key, value) => savedValues.set(key, value) },
  matchMedia: () => ({ matches: false }), requestAnimationFrame: fn => { frameCallback = fn; },
  addEventListener: (type, fn) => events.set(type, [...events.get(type) || [], fn])
});
const key = (type, code) => { for (const fn of events.get(type) || []) fn({ code, repeat: false, preventDefault() {} }); };
let time = 0;
const tick = (count = 1) => { for (let i = 0; i < count; i++) frameCallback(time += 16.667); };

test('game boots with actual world and vehicles, drives, pauses, resets and changes camera', async () => {
  await import('../game.js');
  assert.ok(globalThis.mansouraTaxi, 'controller must finish initialization');
  assert.equal(elements.get('renderError').classList.contains('hidden'), true);
  elements.get('playButton').click(); tick();
  assert.equal(mansouraTaxi.state.playing, true);
  const start = mansouraTaxi.state.driving.z;
  key('keydown', 'KeyW'); tick(80); key('keyup', 'KeyW');
  assert.ok(mansouraTaxi.state.driving.z < start - 5);
  elements.get('pauseButton').click();
  const atPause = mansouraTaxi.state.driving.z; tick(30);
  assert.equal(mansouraTaxi.state.paused, true); assert.equal(mansouraTaxi.state.driving.z, atPause);
  elements.get('closePanel').click(); key('keydown', 'KeyR');
  assert.equal(mansouraTaxi.state.driving.health, 100); assert.equal(mansouraTaxi.state.driving.speed, 0);
  key('keydown', 'KeyC'); tick(); assert.equal(mansouraTaxi.state.cameraMode, 1);
  elements.get('dispatchButton').click();
  assert.equal(mansouraTaxi.state.mission.phase, 'pickup'); assert.ok(mansouraTaxi.state.routeLength > 0);
  key('keydown', 'KeyM'); assert.equal(mansouraTaxi.state.paused, true); assert.ok(elements.get('cityMap'));
  elements.get('closePanel').click();
  // Drive to the nearby first pickup, stop, then verify the actual E handler.
  key('keydown', 'KeyW');
  for (let i = 0; i < 400 && mansouraTaxi.state.driving.z > 111; i++) tick();
  key('keyup', 'KeyW'); key('keydown', 'Space'); tick(50); key('keyup', 'Space');
  key('keydown', 'KeyE'); key('keyup', 'KeyE');
  assert.equal(mansouraTaxi.state.mission.phase, 'dropoff', 'stopped passenger interaction should board passenger');
  assert.ok(mansouraTaxi.state.mission.seconds >= 100);
  const destination = mansouraTaxi.state.mission.destination;
  assert.equal(destination.x, 200, 'the introductory ride stays along the Corniche');
  key('keydown', 'KeyW');
  for (let i = 0; i < 1200; i++) {
    const car = mansouraTaxi.state.driving;
    if (car.z - destination.z < car.speed ** 2 / 50 + 5) break;
    tick();
  }
  key('keyup', 'KeyW'); key('keydown', 'Space'); tick(120); key('keyup', 'Space');
  key('keydown', 'KeyE'); key('keyup', 'KeyE');
  assert.equal(mansouraTaxi.state.mission, null, `destination interaction completes the ride: ${JSON.stringify(mansouraTaxi.state.driving)}`);
  assert.equal(mansouraTaxi.state.progress.trips, 1); assert.ok(mansouraTaxi.state.progress.cash > 0);
  assert.equal(JSON.parse(savedValues.get('mansoura-taxi-v1')).trips, 1);
  // A new fare can be cancelled without losing earnings.
  elements.get('dispatchButton').click(); assert.ok(mansouraTaxi.state.mission);
  elements.get('dispatchButton').click();
  assert.equal(mansouraTaxi.state.mission, null); assert.equal(mansouraTaxi.state.routeLength, 0);
  assert.equal(mansouraTaxi.state.progress.trips, 1);
});
