import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {createWorld,createSpatialQueries} from '../world.js';
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

test('a canal bridge remains accessible through its connected shore approaches',()=>{
  const bridge=data.roads.segments.find(s=>s.osmId===765698815);
  assert.ok(bridge,'expanded map retains the mapped canal crossing');
  let samples=0;
  for(const endpoint of [bridge.points[0],bridge.points.at(-1)]){
    for(const road of data.roads.segments.filter(s=>!s.bridge)){
      const index=road.points.findIndex(p=>p.nodeId===endpoint.nodeId);
      if(index<0)continue;
      for(const neighbour of [road.points[index-1],road.points[index+1]].filter(Boolean)){
        const length=Math.hypot(neighbour.x-endpoint.x,neighbour.z-endpoint.z);
        for(const distance of [1,3,5,8,10]){
          if(distance>length)continue;
          const t=distance/length,p={x:endpoint.x+(neighbour.x-endpoint.x)*t,z:endpoint.z+(neighbour.z-endpoint.z)*t};
          assert.equal(blocked(p,'water'),false,'mapped approach is drivable before and after the bridge tag');
          if(data.water.some(w=>inside(p,w.points)))samples++;
        }
      }
    }
  }
  assert.ok(samples>=4,'the regression covers actual source water/road overlaps, preserving raw bank geometry');
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

test('camera collision resolves reproduced legal-road poses without changing geographic geometry',()=>{
  const cases=[
    {taxi:{x:-384.078,y:1.7,z:-193.519},camera:{x:-393.4049159,y:6.1,z:-202.5748622}},
    {taxi:{x:-324.249,y:1.7,z:-236.254},camera:{x:-333.0936714,y:6.1,z:-245.7814229}},
    {taxi:{x:383.239,y:1.7,z:-293.907},camera:{x:370.4572775,y:6.1,z:-296.2792498}},
    {taxi:{x:255.865,y:1.7,z:-219.256},camera:{x:255.9991993,y:6.1,z:-206.2566927}},
  ];
  const before=JSON.stringify(data.buildings);
  for(const {taxi,camera}of cases){
    const result=world.constrainCamera(taxi,camera,.35);
    assert.equal(result.blocked,true);assert.equal(world.isBlocked(result.x,result.z,.35),false);
    assert.ok(Math.hypot(result.x-taxi.x,result.z-taxi.z)<Math.hypot(camera.x-taxi.x,camera.z-taxi.z));
  }
  assert.equal(JSON.stringify(data.buildings),before);
  assert.equal(world.isBlocked(world.start.x,world.start.z,1),false);
  assert.equal(world.isBlocked(-1678.013,-152.853,1),true,'known source-road/footprint conflict is detectable before recovery');
});

test('spatial camera queries respect building heights, roofs, concave recesses and courtyards',()=>{
  const rectangle=(minX,maxX,minZ,maxZ,height)=>({minX,maxX,minZ,maxZ,height,type:'building',polygon:[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}]});
  const low=createSpatialQueries([rectangle(4,6,-2,2,.6)]);
  assert.equal(low.constrainCamera({x:0,y:1.7,z:0},{x:10,y:6.1,z:0}).blocked,false,'camera sees over a low wall');
  const roof=createSpatialQueries([rectangle(4,6,-2,2,4)]);
  assert.equal(roof.constrainCamera({x:0,y:7,z:0},{x:10,y:7,z:0}).blocked,false);
  const top=roof.constrainCamera({x:5,y:7,z:0},{x:5,y:3,z:0});
  assert.equal(top.blocked,true);assert.ok(top.y>4.35,'descending camera stops above the padded roof');
  const courtyard=rectangle(0,20,0,20,10);courtyard.holes=[[{x:5,z:5},{x:15,z:5},{x:15,z:15},{x:5,z:15}]];
  const court=createSpatialQueries([courtyard]);
  assert.equal(court.isBlocked(10,10,1),false);assert.equal(court.isBlocked(4.8,10,.3),true);
  assert.equal(court.constrainCamera({x:10,y:2,z:10},{x:13,y:6,z:10}).blocked,false);
  const wall=court.constrainCamera({x:10,y:2,z:10},{x:18,y:6,z:10});assert.equal(wall.blocked,true);assert.ok(wall.x<14.65);
  const concave=rectangle(0,8,0,8,10);concave.polygon=[{x:0,z:0},{x:8,z:0},{x:8,z:3},{x:3,z:3},{x:3,z:8},{x:0,z:8}];
  const recess=createSpatialQueries([concave]);assert.equal(recess.isBlocked(5,5,.35),false);
  assert.equal(recess.constrainCamera({x:5,y:2,z:5},{x:10,y:3,z:5}).blocked,false);
  assert.equal(recess.constrainCamera({x:5,y:2,z:5},{x:1,y:3,z:5}).blocked,true);
  const water=rectangle(0,8,0,8,0);water.type='water';const river=createSpatialQueries([water]);
  assert.equal(river.isBlocked(4,4,1),true);assert.equal(river.constrainCamera({x:-2,y:2,z:4},{x:10,y:4,z:4}).blocked,false);
});

test('safe recovery avoids actual source overlaps and keeps the full Verna clear near the Nile',()=>{
  const assertSafe=p=>{
    const fx=-Math.sin(p.heading),fz=-Math.cos(p.heading);
    for(const offset of [-1.2,0,1.2])assert.equal(world.isBlocked(p.x+fx*offset,p.z+fz*offset,.9),false);
    assert.ok(nearestRoad(p,world.roads).distance<.001);
    return p;
  };
  const conflict={x:-1678.013,z:-152.853,heading:0};
  assert.equal(world.isBlocked(conflict.x,conflict.z,.9),true);
  const recovered=assertSafe(world.findSafeRoadPoint(conflict));
  assert.ok(Math.hypot(recovered.x-conflict.x,recovered.z-conflict.z)<120);
  assert.ok(Math.hypot(recovered.x-conflict.x,recovered.z-conflict.z)>1);
  const shore={x:0,z:-450};assert.equal(world.isBlocked(shore.x,shore.z),true);
  const bank=assertSafe(world.findSafeRoadPoint(shore));assert.ok(Math.hypot(bank.x-shore.x,bank.z-shore.z)<120);
  const ordinary=assertSafe(world.findSafeRoadPoint(world.start));
  assert.ok(Math.hypot(ordinary.x-world.start.x,ordinary.z-world.start.z)<.01);
  const edge=nearestRoad(ordinary,world.roads),segment=world.roads.segments[edge.segmentIndex];
  assert.equal(segment.oneway,1);assert.ok(Math.abs(Math.atan2(Math.sin(ordinary.heading-edge.heading),Math.cos(ordinary.heading-edge.heading)))<.00001);
  const fallback=world.findSafeRoadPoint({x:100000,z:100000});
  assert.deepEqual(fallback,{x:world.start.x,z:world.start.z,heading:world.start.heading});assertSafe(fallback);
});
