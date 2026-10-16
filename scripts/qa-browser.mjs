// Run with TAXI_QA_MODULE pointing to an installed Playwright module and
// PLAYWRIGHT_BROWSERS_PATH pointing to its local browser cache.
// This is an actual Chromium/WebGL smoke test, separate from pure unit tests.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.TAXI_QA_MODULE;
if (!modulePath) throw new Error('Set TAXI_QA_MODULE to Playwright/index.mjs.');
const { chromium } = await import(pathToFileURL(modulePath));
const url = process.env.TAXI_QA_URL || 'http://127.0.0.1:8000';
const artifacts = resolve(import.meta.dirname, '..', 'artifacts'); await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const issues = [], report = { url, startedAt: new Date().toISOString(), checks: [] };
const check = (label, result) => { assert.ok(result, label); report.checks.push(label); console.log('PASS ' + label); };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => issues.push('PAGE: ' + error.message));
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('fonts.googleapis')) issues.push('CONSOLE: ' + msg.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.mansouraTaxi?.state?.render?.calls > 0, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
  report.initial = await page.evaluate(() => window.mansouraTaxi.state);
  check('real geographic map loaded', report.initial.map.roads > 3000 && report.initial.map.buildings > 1900);
  check('WebGL scene rendered', report.initial.render.triangles > 5000);
  await page.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-home-desktop.png') });
  await page.locator('[data-panel="garage"]').click();
  check('Verna garage opens', await page.locator('#panelContent').innerText().then(t => t.includes('Verna')));
  await page.locator('[data-paint="#3e7079"]').click();
  check('paint selection updates saved taxi', (await page.evaluate(() => window.mansouraTaxi.state.progress.paint)) === '#3e7079');
  await page.locator('[data-paint="#853f42"]').click(); await page.locator('#closePanel').click();
  await page.locator('[data-panel="city"]').click(); await page.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-geographic-map.png') }); await page.locator('#closePanel').click();
  await page.locator('[data-mode="shift"]').click(); await page.locator('#playButton').click();
  await page.waitForFunction(() => window.mansouraTaxi.state.fares.offer);
  await page.keyboard.press('KeyF');
  check('destination question works', await page.evaluate(() => window.mansouraTaxi.state.fares.offer.askedDestination));
  await page.keyboard.press('Digit4'); await page.keyboard.press('Digit1');
  check('shared fare can be explicitly accepted', await page.evaluate(() => window.mansouraTaxi.state.fares.offer.accepted));
  const before = await page.evaluate(() => window.mansouraTaxi.state.driving);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
  await page.keyboard.down('Space'); await page.waitForTimeout(1200); await page.keyboard.up('Space');
  const after = await page.evaluate(() => window.mansouraTaxi.state.driving);
  check('keyboard driving changes world position', Math.hypot(after.x-before.x, after.z-before.z) > 1);
  // Drive the short introductory pickup using actual keyboard input and
  // rendered simulation state, then exercise the stopped passenger action.
  for (let step = 0; step < 120; step++) {
    const s = await page.evaluate(() => window.mansouraTaxi.state), car = s.driving, target = s.target;
    const distance = Math.hypot(target.x-car.x, target.z-car.z);
    if (distance < 11 && Math.abs(car.speed) < 2.5) break;
    const desired = Math.atan2(-(target.x-car.x), -(target.z-car.z));
    const angle = Math.atan2(Math.sin(desired-car.heading), Math.cos(desired-car.heading));
    const stopping = distance < car.speed ** 2 / 50 + 8;
    for (const [key, held] of [['KeyW', !stopping && car.speed < 12], ['Space', stopping], ['KeyA', !stopping && angle > .06], ['KeyD', !stopping && angle < -.06]]) {
      await page.keyboard[held ? 'down' : 'up'](key);
    }
    await page.waitForTimeout(180);
  }
  for (const key of ['KeyW','Space','KeyA','KeyD']) await page.keyboard.up(key);
  await page.keyboard.press('KeyE');
  check('a stopped browser-driven pickup boards a visible rider', await page.evaluate(() => window.mansouraTaxi.state.fares.passengers.length === 1));
  await page.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-shift-desktop.png') });
  await page.keyboard.press('Escape'); check('Escape opens the pause dialog', await page.locator('#panelDialog').isVisible() && await page.evaluate(() => window.mansouraTaxi.state.paused)); const frozen = await page.evaluate(() => window.mansouraTaxi.state.driving);
  await page.waitForTimeout(400); const still = await page.evaluate(() => window.mansouraTaxi.state.driving);
  check('pause freezes driving', frozen.x === still.x && frozen.z === still.z);
  await page.locator('[data-action="settings"]').click(); await page.locator('[data-time="night"]').click();
  check('night lighting changes', await page.evaluate(() => window.mansouraTaxi.state.night));
  await page.locator('[data-quality="low"]').click(); await page.locator('#closePanel').click();
  await page.waitForTimeout(500); await page.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-night-drive.png') });
  await page.keyboard.press('KeyM');
  check('city map available while driving', await page.locator('#cityMap').isVisible());
  await page.locator('#closePanel').click();
  report.final = await page.evaluate(() => window.mansouraTaxi.state);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => issues.push('MOBILE: ' + error.message));
  await mobile.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await mobile.waitForFunction(() => window.mansouraTaxi?.state?.render?.calls > 0, { timeout: 60000 });
  await mobile.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-home-mobile.png') });
  check('mobile city and garage navigation visible', await mobile.locator('[data-panel="city"]').isVisible() && await mobile.locator('[data-panel="garage"]').isVisible());
  await mobile.locator('[data-mode="shift"]').tap(); await mobile.locator('#playButton').tap();
  check('mobile pedals visible', await mobile.locator('[data-touch="throttle"]').isVisible());
  check('mobile fare choices visible', await mobile.locator('[data-fare-action="ask"]').isVisible());
  await mobile.screenshot({ animations: 'disabled', path: resolve(artifacts, 'mansoura-shift-mobile.png') });
  report.issues = issues;
  check('no JavaScript or shader console errors', issues.length === 0);
  report.finishedAt = new Date().toISOString();
} finally {
  await writeFile(resolve(artifacts, 'browser-qa.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
