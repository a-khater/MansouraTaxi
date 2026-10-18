// Render the location-matched structures for side-by-side human review against
// the catalog links. A successful render is not a visual accuracy certificate.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.TAXI_QA_MODULE;
if (!modulePath) throw new Error('Set TAXI_QA_MODULE to Playwright/index.mjs.');
const { chromium } = await import(pathToFileURL(modulePath));
const artifacts = resolve(import.meta.dirname, '..', 'artifacts');
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, 'building-review.html'), `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Building reference review</title>
<style>body{margin:0;background:#e5e5e0;font:14px Arial;color:#192b27}canvas{display:block}aside{padding:16px;position:fixed;bottom:0;background:#fffffff0;max-width:650px}b{display:block;margin-bottom:7px}a{color:#16514b;margin-right:16px}</style>
<aside id="notes"></aside><script type="module">
import * as THREE from '/vendor/three.module.js';
import { createWorld } from '/world.js';
const [data,catalog]=await Promise.all(['/assets/mansoura-map.json','/assets/building-references.json'].map(p=>fetch(p).then(r=>r.json())));
const scene=new THREE.Scene();scene.background=new THREE.Color('#d3dedf');
const camera=new THREE.PerspectiveCamera(48,1280/900,.1,1800);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,900);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#e6f1f5','#a29580',2));
const sun=new THREE.DirectionalLight('#fff1d2',3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-90,right:90,top:90,bottom:-90,near:1,far:400});sun.shadow.normalBias=.08;scene.add(sun,sun.target);
const world=createWorld(scene,data,catalog);
window.reviewBuilding=async id=>{
 const entry=[...catalog.entries,...(catalog.landmarks||[])].find(e=>(e.buildingId||e.id)===id);if(!entry)throw Error('Missing catalog entry '+id);
 const building=data.buildings.find(b=>b.id===entry.buildingId);
 const points=building?.points||[{x:entry.x||entry.position?.x||0,z:entry.z||entry.position?.z||0}];
 const x=points.reduce((s,p)=>s+p.x,0)/points.length,z=points.reduce((s,p)=>s+p.z,0)/points.length;
 const size=Math.max(30,Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)));
 const v=entry.review||{};camera.fov=v.fov||48;camera.updateProjectionMatrix();camera.position.fromArray(v.position||[x+size*.15,14,z-size*1.4]);camera.lookAt(...(v.target||[x,8,z]));
 world.setFocus(x,z);sun.position.set(x-80,150,z-130);sun.target.position.set(x,0,z);scene.updateMatrixWorld(true);
 const notes=document.getElementById('notes');notes.replaceChildren();const title=document.createElement('b');title.textContent=(entry.name||entry.label||id)+' — '+entry.status;notes.append(title);
 for(const ref of entry.references||[]){const a=document.createElement('a');a.href=typeof ref==='string'?ref:ref.url;a.textContent=typeof ref==='string'?'Source':ref.label||ref.title||'Source';notes.append(a);}
 const note=document.createElement('p');note.textContent='Photo-referenced reconstruction. Measurements and unobserved details remain unverified.';notes.append(note);
 await document.fonts.ready;renderer.render(scene,camera);return {id,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,finite:scene.children.every(o=>o.matrixWorld.elements.every(Number.isFinite))};
};window.reviewCatalog=catalog;window.reviewReady=true;
</script>`);
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const errors = [], report = { checks: [], renders: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto((process.env.TAXI_QA_URL || 'http://127.0.0.1:8000') + '/artifacts/building-review.html');
  await page.waitForFunction(() => window.reviewReady, { timeout: 60000 });
  const entries = await page.evaluate(() => [...window.reviewCatalog.entries,...(window.reviewCatalog.landmarks||[])].map(e => ({id:e.buildingId||e.id,model:e.model,status:e.status})));
  assert.ok(entries.length, 'reference catalog is populated');
  for (const entry of entries) {
    assert.equal(entry.status, 'photo-referenced', 'photo-based work is not promoted to survey verification');
    const render = await page.evaluate(id => window.reviewBuilding(id), entry.id);
    assert.ok(render.drawCalls > 0 && render.triangles > 0 && render.finite, 'reference scene renders finite geometry');
    await page.screenshot({ path: resolve(artifacts, 'building-' + entry.model + '.png') });
    report.renders.push(render);
    console.log('PASS reference model renders: ' + entry.id);
  }
  assert.deepEqual(errors, [], 'no runtime or shader errors during building review');
  report.checks.push('all catalog entries render', 'photo reference status remains explicit', 'no runtime or shader errors');
} finally {
  report.errors = errors; report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'building-review-qa.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
