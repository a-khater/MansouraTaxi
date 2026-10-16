import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {createWorld} from '../world.js';
import {nearestRoad} from '../navigation.js';

globalThis.document={createElement(tag){assert.equal(tag,'canvas');return{getContext(){return{fillRect(){},strokeRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}};}};
const data=JSON.parse(readFileSync(new URL('../assets/mansoura-map.json',import.meta.url),'utf8'));
const scene=new THREE.Scene(),world=createWorld(scene,data);
function inside(p,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
const blocked=(p,type)=>world.colliders.some(c=>(!type||c.type===type)&&p.x>=c.minX&&p.x<=c.maxX&&p.z>=c.minZ&&p.z<=c.maxZ&&inside(p,c.polygon)&&!(c.holes||[]).some(h=>inside(p,h)));

test('world preserves source street/footprint geometry and distinguishes inferred detail',()=>{
  assert.equal(world.roads,data.roads);assert.equal(world.bounds,data.bounds);assert.equal(world.start,data.start);
  assert.ok(data.buildings.length>2000&&data.inferredBuildings.length>0);
  assert.equal(world.colliders.filter(c=>c.type==='building'&&!c.inferred).length,data.buildings.length);
  for(const building of data.buildings.slice(0,50)){
    const collider=world.colliders.find(c=>c.sourceId===building.id);
    assert.equal(collider.height,building.height);assert.ok(building.heightSource&&building.accuracy.footprint);
    const expected=building.points.map(p=>`${p.x},${p.z}`).sort();
    assert.deepEqual(collider.polygon.map(p=>`${p.x},${p.z}`).sort(),expected,'collider retains the actual footprint');
  }
  for(const b of data.inferredBuildings)assert.match(b.accuracy.footprint,/inferred/);
  assert.equal(world.stats.inferredFrontageBuildings,data.inferredBuildings.length);
});

test('all curated street pickups and Al Mashaya start are clear of buildings and water',()=>{
  for(const p of [world.start,...world.landmarks]){
    assert.equal(blocked(p),false,p.id||'start');assert.ok(nearestRoad(p,world.roads).distance<.02);
  }
  assert.equal(world.groundHeight,.14);assert.equal(world.heightAt(world.start.x,world.start.z),.14);
  assert.ok(world.getDistrict(world.start.x,world.start.z).name);
});

test('water collision follows the mapped river and leaves actual bridges open',()=>{
  let waterSamples=0,bridgeSamples=0;
  for(let x=data.bounds.minX+100;x<data.bounds.maxX;x+=180)for(let z=data.bounds.minZ+100;z<data.bounds.maxZ;z+=180){
    const p={x,z};if(!data.water.some(w=>inside(p,w.points)))continue;
    if(nearestRoad(p,{segments:data.roads.segments.filter(s=>s.bridge)}).distance<25)continue;
    assert.equal(blocked(p,'water'),true);waterSamples++;
  }
  for(const s of data.roads.segments.filter(s=>s.bridge))for(const p of s.points){assert.equal(blocked(p,'water'),false,`bridge ${s.id}`);bridgeSamples++;}
  assert.ok(waterSamples>10&&bridgeSamples>20);
});

test('land has a geometric river cutout and cannot occlude the lower Nile surface',()=>{
  const terrain=world.root.children.find(o=>o.userData.waterCutouts);assert.ok(terrain);
  scene.updateMatrixWorld(true);let samples=0;
  for(let x=data.bounds.minX+120;x<data.bounds.maxX;x+=250)for(let z=data.bounds.minZ+120;z<data.bounds.maxZ;z+=250){
    const p={x,z};if(!data.water.some(w=>inside(p,w.points)&&!(w.holes||[]).some(h=>inside(p,h))))continue;
    const ray=new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(terrain).length,0,'mapped Nile is not covered by ground');samples++;
  }
  assert.ok(samples>5);
  const land=new THREE.Raycaster(new THREE.Vector3(0,10,800),new THREE.Vector3(0,-1,0));
  assert.ok(land.intersectObject(terrain).length,'land stays at its original elevation outside the river');
});

test('all rendered static ground surfaces leave the river visible, including broad landuse polygons',()=>{
  const groundMeshes=[];scene.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&(o.userData.waterCutouts||o.material.vertexColors))groundMeshes.push(o);});
  scene.updateMatrixWorld(true);let checked=0;
  const bridgeRoads={segments:data.roads.segments.filter(s=>s.bridge)};
  for(let x=data.bounds.minX+120;x<data.bounds.maxX;x+=180)for(let z=data.bounds.minZ+120;z<data.bounds.maxZ;z+=180){
    const p={x,z};if(!data.water.some(w=>inside(p,w.points)&&!(w.holes||[]).some(h=>inside(p,h))))continue;
    if(nearestRoad(p,bridgeRoads).distance<25||nearestRoad(p,data.roads).distance<18)continue;
    const ray=new THREE.Raycaster(new THREE.Vector3(x,.5,z),new THREE.Vector3(0,-1,0),0,.79);
    assert.equal(ray.intersectObjects(groundMeshes).length,0,`ground/landuse covers Nile at ${x},${z}`);checked++;
  }
  assert.ok(checked>10);
});

test('moving chunk focus changes the rendered district while preserving collision geometry',()=>{
  const groups=world.root.children.filter(c=>c.userData.center),collisionCount=world.colliders.length;
  const visible=()=>new Set(groups.filter(g=>g.visible));const first=visible();
  world.setFocus(data.bounds.maxX-100,data.bounds.maxZ-100);const distant=visible();
  assert.ok(first.size&&distant.size);assert.ok([...first].some(g=>!distant.has(g)));
  assert.equal(world.colliders.length,collisionCount);
  world.setFocus(world.start.x,world.start.z);assert.deepEqual(visible(),first);
});

test('clockwise source polygons produce visible outward-facing building walls',()=>{
  const b={id:'building/test',osmId:2,points:[{x:20,z:20},{x:20,z:40},{x:40,z:40},{x:40,z:20}],holes:[],height:20,tags:{}};
  const fixture={roads:{segments:[{id:'road',osmId:263225726,width:8,highway:'primary',points:[{x:0,z:0,nodeId:1},{x:100,z:0,nodeId:2}]}]},bounds:{minX:-100,maxX:200,minZ:-100,maxZ:200},start:{x:0,z:0,heading:0},buildings:[b],water:[],waterColliders:[],inferredBuildings:[],areas:[],paths:[],landmarks:[],stats:{}};
  const s=new THREE.Scene();createWorld(s,fixture);s.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(5,6,30),new THREE.Vector3(1,0,0),0,30);
  const hit=ray.intersectObjects(s.children,true).find(h=>Math.abs(h.point.x-20)<.01);
  assert.ok(hit,'a ray from outside hits the exterior wall between windows');
  assert.ok(hit.face.normal.x<-.9,'exterior wall normal points outward');
});

test('scene transforms remain finite and water/night updates restore daylight colors',()=>{
  let water;scene.traverse(o=>{if(o.material?.uniforms?.deep)water=o;});assert.ok(water);
  const day=water.material.uniforms.deep.value.clone();world.setNight(true);assert.ok(!water.material.uniforms.deep.value.equals(day));
  world.update(.016,1000,world.start);assert.equal(water.material.uniforms.time.value,1000);world.setNight(false);assert.ok(water.material.uniforms.deep.value.equals(day));
  scene.updateMatrixWorld(true);scene.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite));if(o.isInstancedMesh)assert.ok(o.instanceMatrix.array.every(Number.isFinite));});
});
