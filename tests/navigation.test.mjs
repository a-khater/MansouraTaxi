import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestRoad, routeTo, roadGraph, fareFor } from '../navigation.js';

const data = JSON.parse(readFileSync(new URL('../assets/mansoura-map.json', import.meta.url), 'utf8'));
const point = (x, z, nodeId) => ({ x, z, nodeId });
const way = (id, points, oneway = 0) => ({ id, points, oneway, width: 7, name: id });

test('projection follows a curved polyline and retains the closest source edge', () => {
  const roads = { segments: [way('curve', [point(0,0,1),point(30,40,2),point(70,40,3)])] };
  const p = nearestRoad({x:15,z:0},roads);
  assert.equal(p.segmentId,'curve'); assert.equal(p.edgeIndex,0);
  assert.ok(Math.abs(p.x-5.4)<1e-9 && Math.abs(p.z-7.2)<1e-9);
  const route=routeTo({x:0,z:0},{x:70,z:40},roads);
  assert.equal(route.reachable,true); assert.equal(route.length,90);
  assert.ok(route.points.some(p=>p.x===30&&p.z===40),'route keeps the mapped bend');
});

test('shared OSM node IDs create junctions and grade-separated crossings do not', () => {
  const roads={segments:[way('east-west',[point(-20,0,1),point(0,0,2),point(20,0,3)]),way('branch',[point(0,0,2),point(0,20,4)])]};
  const route=routeTo({x:-20,z:0},{x:0,z:20},roads);
  assert.equal(route.reachable,true);assert.equal(route.length,40);
  const crossing={segments:[way('bridge',[point(-20,0,1),point(0,0,2),point(20,0,3)]),way('below',[point(0,-20,4),point(0,0,5),point(0,20,6)])]};
  assert.equal(routeTo({x:-20,z:0},{x:0,z:20},crossing).reachable,false);
  assert.notEqual(roadGraph(crossing).nodes.get('2'),roadGraph(crossing).nodes.get('5'));
});

test('one-way streets require a connected legal return, including reverse-tagged ways', () => {
  const roads={segments:[way('oneway',[point(0,0,1),point(100,0,2)],1),way('return',[point(100,0,2),point(100,50,3),point(0,50,4),point(0,0,1)],1)]};
  assert.equal(routeTo({x:20,z:0},{x:80,z:0},roads).length,60);
  assert.equal(routeTo({x:80,z:0},{x:20,z:0},roads).length,240);
  const reverse={segments:[way('reverse',[point(0,0,1),point(100,0,2)],-1)]};
  assert.equal(routeTo({x:80,z:0},{x:20,z:0},reverse).length,60);
  assert.equal(routeTo({x:20,z:0},{x:80,z:0},reverse).reachable,false);
});

test('bounded Mansoura network retains actual OSM road positions and provenance', () => {
  assert.ok(data.roads.segments.length>3000);assert.ok(roadGraph(data.roads).nodes.size>10000);
  assert.equal(data.projection.axes.x,'east');assert.equal(data.projection.axes.z,'south');
  assert.equal(data.provenance.license,'ODbL-1.0');assert.ok(data.provenance.osmBaseTimestamp);
  const raw=JSON.parse(readFileSync(new URL('../data/source/mansoura-osm-source.json',import.meta.url),'utf8'));
  const source=raw.elements.find(e=>e.type==='way'&&e.id===263225726);
  const mapped=data.roads.segments.find(s=>s.osmId===source.id);
  assert.ok(mapped.name&&mapped.widthSource&&mapped.oneway===1);
  for(const p of mapped.points.filter(p=>typeof p.nodeId==='number').slice(0,20)){
    const i=source.nodes.indexOf(p.nodeId),g=source.geometry[i];assert.ok(g);
    const x=(g.lon-data.projection.origin.lon)*data.projection.metersPerLongitudeDegree;
    const z=(data.projection.origin.lat-g.lat)*data.projection.metersPerLatitudeDegree;
    assert.ok(Math.abs(p.x-x)<=.00051&&Math.abs(p.z-z)<=.00051,'source coordinates are retained to millimeter projection precision');
  }
});

test('every curated Mansoura destination is reachable through the real directed graph', () => {
  const mappedNodes=new Set([...roadGraph(data.roads).nodes.values()].map(p=>`${p.x.toFixed(3)},${p.z.toFixed(3)}`));
  for(const from of data.landmarks)for(const to of data.landmarks){
    const route=routeTo(from,to,data.roads);
    assert.equal(route.reachable,true,`${from.id} → ${to.id}`);
    assert.ok(Number.isFinite(route.length));
    assert.ok(Math.hypot(route.points[0].x-from.x,route.points[0].z-from.z)<.05);
    assert.ok(Math.hypot(route.points.at(-1).x-to.x,route.points.at(-1).z-to.z)<.05);
    route.points.forEach((p,i)=>{
      if(i<2||i>=route.points.length-2)assert.ok(nearestRoad(p,data.roads).distance<.02,'route endpoint remains on a mapped road');
      else assert.ok(mappedNodes.has(`${p.x.toFixed(3)},${p.z.toFixed(3)}`),'interior route vertices retain actual mapped junctions/bends');
    });
  }
});

test('fares reward distance/time and deduct damage with a minimum fare', () => {
  assert.equal(fareFor(800,50,0),103);assert.equal(fareFor(200,100,20),48);
  assert.equal(fareFor(0,0,100),30);assert.equal(fareFor(200,-50),fareFor(200,0));
});
