import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {createWorld} from '../world.js';
import {routeTo,nearestRoad} from '../navigation.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const map=read('../assets/mansoura-map.json'),catalog=read('../assets/destinations.json'),sources=read('../data/destination-sources.json');
globalThis.document={createElement(){return{getContext(){return{fillRect(){},strokeRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};}};}};

test('requested places retain individually sourced coordinates and distinguish hospital identities',()=>{
  assert.deepEqual(read('../native/MansouraTaxi/Content/Data/destinations.json'),catalog);
  assert.equal(new Set(catalog.entries.map(e=>e.id)).size,catalog.entries.length);
  for(const source of sources.entries){
    const entry=catalog.entries.find(e=>e.id===source.id);assert.ok(entry);
    assert.equal(entry.lat,source.lat);assert.equal(entry.lon,source.lon);
    assert.ok(entry.references.length>=2);assert.match(entry.locationStatus,/location-verified/);
    assert.match(entry.facadeStatus,/not individually reconstructed/,'place identity does not certify its building appearance');
    const lat=map.projection.origin.lat-entry.z/map.projection.metersPerLatitudeDegree;
    const lon=map.projection.origin.lon+entry.x/map.projection.metersPerLongitudeDegree;
    assert.ok(Math.abs(lat-source.lat)<1e-10&&Math.abs(lon-source.lon)<1e-10);
  }
  const old=catalog.entries.find(e=>e.id==='mansoura-specialized-old-general'),internal=catalog.entries.find(e=>e.id==='university-specialized-medical');
  assert.ok(old.aliases.includes('المستشفى العام القديم'));assert.ok(Math.hypot(old.x-internal.x,old.z-internal.z)>500);
  assert.equal(catalog.entries.find(e=>e.id==='touril-street').kind,'district-street');
});

test('expanded destination road stops are clear and reachable both ways on source roads',()=>{
  const world=createWorld(new THREE.Scene(),map);
  for(const source of sources.entries){
    const entry=catalog.entries.find(e=>e.id===source.id),stop=entry.roadAccess;
    assert.equal(world.isBlocked(stop.x,stop.z,.95),false,entry.id+' stop is clear of buildings and water');
    assert.ok(nearestRoad(stop,map.roads).distance<.02);
    assert.equal(routeTo(map.start,stop,map.roads).reachable,true,entry.id+' outward route');
    assert.equal(routeTo(stop,map.start,map.roads).reachable,true,entry.id+' legal return route');
    assert.ok(stop.distanceFromPlaceMetres<150,'a remote location is not silently substituted');
    assert.ok(map.landmarks.some(l=>l.id===entry.id));
  }
  assert.ok(map.bounds.maxX>catalog.entries.find(e=>e.id==='touril-street').x);
  assert.ok(map.bounds.maxZ>catalog.entries.find(e=>e.id==='mansoura-new-general-international').z);
});
