import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from '../vendor/three.module.js';
import { createWorld } from '../world.js';
import { routeTo, nearestRoad } from '../navigation.js';

const root=resolve(import.meta.dirname,'..'),nativeData=resolve(root,'native/MansouraTaxi/Content/Data');
const read=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const sources=await read('data/destination-sources.json');
// The native and browser previews use the same expanded connected OSM extract.
const map=await read('native/MansouraTaxi/Content/Data/mansoura-map.json');
globalThis.document={createElement(){return{getContext(){return{fillRect(){},strokeRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};}};}};
const world=createWorld(new THREE.Scene(),map),entries=[];
const universityStart=world.findSafeRoadPoint({x:-1790.749,z:-171});
if(!universityStart)throw Error('No safe public road start near the referenced Law Gate.');
map.start={...universityStart,name:'Mansoura University — Law Gate 3 street approach',locationSource:'Public road position projected near the individually referenced university entrance; not inside the gate.'};
for(const original of sources.entries){
  const x=(original.lon-map.projection.origin.lon)*map.projection.metersPerLongitudeDegree;
  const z=(map.projection.origin.lat-original.lat)*map.projection.metersPerLatitudeDegree;
  const safe=world.findSafeRoadPoint({x,z}),road=safe&&nearestRoad(safe,map.roads);
  const reachable=!!road&&Math.hypot(road.x-x,road.z-z)<350&&routeTo(map.start,road,map.roads).reachable&&routeTo(road,map.start,map.roads).reachable;
  if(!reachable)throw Error('No suitable connected road stop for '+original.id+'; do not silently substitute another district.');
  entries.push({...original,x,z,locationStatus:'location-verified; public road stop estimated',facadeStatus:'not individually reconstructed',
    roadAccess:{x:road.x,z:road.z,heading:safe.heading,segmentId:road.segmentId,reachable:true,distanceFromPlaceMetres:Math.hypot(road.x-x,road.z-z)},reviewedOn:sources.reviewedOn});
}
for(const e of entries){
  const landmark={id:e.id,name:e.name,arabic:e.arabic,...e.roadAccess,poi:{x:e.x,z:e.z},description:e.locationEvidence,locationSource:e.locationStatus,referenceUrls:e.references};
  const index=map.landmarks.findIndex(l=>l.id===e.id);
  if(index<0)map.landmarks.push(landmark);else map.landmarks[index]=landmark;
}
const requestedIds=new Set(entries.map(e=>e.id));
const legacyEntries=map.landmarks.filter(l=>!requestedIds.has(l.id)).map(l=>({
  id:l.id,name:l.name,arabic:l.arabic,kind:'mapped-landmark',x:l.poi?.x??l.x,z:l.poi?.z??l.z,
  lat:map.projection.origin.lat-(l.poi?.z??l.z)/map.projection.metersPerLatitudeDegree,
  lon:map.projection.origin.lon+(l.poi?.x??l.x)/map.projection.metersPerLongitudeDegree,
  locationStatus:'location-verified; existing curated mapped street stop',facadeStatus:'not individually reconstructed',
  references:['https://www.openstreetmap.org/copyright'],locationEvidence:l.locationSource,
  roadAccess:{x:l.x,z:l.z,heading:l.heading,segmentId:l.segmentId,reachable:true},reviewedOn:sources.reviewedOn
}));
const catalog={schemaVersion:1,reviewedOn:sources.reviewedOn,note:sources.note,entries:[...entries,...legacyEntries]};
await mkdir(nativeData,{recursive:true});
await writeFile(resolve(root,'assets/mansoura-map.json'),JSON.stringify(map));
await writeFile(resolve(nativeData,'mansoura-map.json'),JSON.stringify(map));
await writeFile(resolve(root,'assets/destinations.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile(resolve(nativeData,'destinations.json'),JSON.stringify(catalog,null,2)+'\n');
await copyFile(resolve(root,'assets/OSM-ATTRIBUTION.txt'),resolve(nativeData,'OSM-ATTRIBUTION.txt'));
console.log(JSON.stringify({destinations:entries.map(e=>({id:e.id,stopDistanceMetres:Math.round(e.roadAccess.distanceFromPlaceMetres)})),roads:map.roads.segments.length,buildings:map.buildings.length},null,2));
