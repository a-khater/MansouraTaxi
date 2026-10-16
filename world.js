import * as THREE from './vendor/three.module.js';
import { nearestRoad } from './navigation.js';

/** Literal OSM street/footprint geometry with explicitly interpreted facades.
 * Load assets/mansoura-map.json before calling this synchronous scene builder.
 */
export function createWorld(scene, data) {
  if (!data?.roads?.segments?.length) throw new Error('A normalized Mansoura OpenStreetMap extract is required.');
  const root = new THREE.Group(); root.name = 'Mansoura · mapped Nile district'; scene.add(root);
  const roads = data.roads, bounds = data.bounds, colliders = [], chunks = new Map();
  const geometries = new Map(), instances = new Map(), signs = new Map(), materials = {};
  const box = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7), sphere = new THREE.SphereGeometry(1, 9, 6);
  const temp = new THREE.Object3D(), boats = [];
  const mat = (name, color, extra = {}) => materials[name] ||= new THREE.MeshStandardMaterial({ color, roughness: .88, ...extra });
  const asphalt = mat('asphalt', '#4d5050'), pavement = mat('pavement', '#b4ab96');
  const cream = mat('cream', '#d6c5a4'), trim = mat('trim', '#bda789'), rail = mat('rail', '#465953');
  const glass = mat('glass', '#40595d', { roughness: .3, metalness: .2 });
  const litGlass = mat('litGlass', '#9d9980', { emissive: '#e7bf7b', emissiveIntensity: .12 });
  const black = mat('black', '#343c36'), brick = mat('brick', '#a47e64');
  const green = mat('foliage', '#60734d'), leafLight = mat('leafLight', '#7c8a56');
  const white = mat('white', '#d8d3ba'), red = mat('red', '#ad5141'), blue = mat('blue', '#567a7a');
  const grass = mat('grass', '#828b62'), soil = mat('soil', '#a69c80');
  const lampGlow = mat('lampGlow', '#e3d2a3', { emissive: '#ffcf7f', emissiveIntensity: .35 });
  const trunk = mat('trunk', '#88775b');
  const palette = ['#c3b497', '#bc9b7d', '#d0c0a5', '#a87d63', '#b4ada0', '#c9af8c'].map((c, i) => mat('facade' + i, c));
  let rnd = 4815;
  const random = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };

  // Shared local plaster/brick texture gives surfaces grain without imagery
  // downloads or falsely presenting procedural decoration as captured facades.
  function surfaceTexture(bricks = false) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#e9e4db'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3500; i++) { const shade = 150 + Math.floor(random() * 100); ctx.fillStyle = `rgba(${shade},${shade},${shade},.19)`; ctx.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 5); }
    if (bricks) { ctx.strokeStyle = 'rgba(75,65,52,.25)'; ctx.lineWidth = 1; for (let y = 0; y < 256; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); for (let x = (y / 16 % 2) * 16; x < 256; x += 32) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke(); } } }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const plasterTexture = surfaceTexture(), brickTexture = surfaceTexture(true);
  palette.forEach((m, i) => { m.map = i === 3 ? brickTexture : plasterTexture; });
  const citySurface = mat('citySurface', '#ffffff', { vertexColors:true, map:plasterTexture });
  const propSurface = mat('propSurface', '#ffffff');
  const leafSurface = mat('leafSurface', '#ffffff', { side:THREE.DoubleSide });

  function chunk(x, z) {
    const gx = Math.floor(x / 200), gz = Math.floor(z / 200), key = `${gx}:${gz}`;
    if (!chunks.has(key)) { const group = new THREE.Group(); group.userData.center = { x: gx * 200 + 100, z: gz * 200 + 100 }; root.add(group); chunks.set(key, group); }
    return [key, chunks.get(key)];
  }
  function instance(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, rotation = 0, detail = true, rz = 0) {
    const displayMaterial = [glass,litGlass,lampGlow].includes(material) ? material : material.side===THREE.DoubleSide ? leafSurface : propSurface;
    const [key, group] = chunk(x, z), batchKey = `${key}:${geometry.uuid}:${displayMaterial.uuid}:${detail}`;
    if (!instances.has(batchKey)) instances.set(batchKey, { geometry, material:displayMaterial, group, matrices: [], colors:[], detail });
    temp.position.set(x, y, z); temp.rotation.set(0, rotation, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    instances.get(batchKey).matrices.push(temp.matrix.clone());
    instances.get(batchKey).colors.push(displayMaterial===material?new THREE.Color('#ffffff'):material.color.clone());
  }
  const cube = (m, x, y, z, w, h, d, angle = 0, detail = true) => instance(box, m, x, y, z, w, h, d, angle, detail);
  const cyl = (m, x, y, z, r, h, detail = true) => instance(cylinder, m, x, y, z, r, h, r, 0, detail);
  const orb = (m, x, y, z, r, sy = r) => instance(sphere, m, x, y, z, r, sy, r);
  function addGeometry(material, x, z, positions, uvs = [], detail = false) {
    const [key, group] = chunk(x, z), batchKey = `${key}:${detail}`;
    if (!geometries.has(batchKey)) geometries.set(batchKey, { material:citySurface, group, positions: [], colors:[], uvs: [], detail });
    const batch = geometries.get(batchKey); batch.positions.push(...positions); batch.uvs.push(...(uvs.length ? uvs : new Array(positions.length / 3 * 2).fill(0)));
    for(let i=0;i<positions.length/3;i++)batch.colors.push(material.color.r,material.color.g,material.color.b);
  }
  function clean(points) {
    const p = points.map(a => ({ x: a.x, z: a.z }));
    if (p.length > 2 && Math.hypot(p[0].x - p.at(-1).x, p[0].z - p.at(-1).z) < .01) p.pop();
    return p;
  }
  function triangulate(points, holes = []) {
    const outline = clean(points).map(p => new THREE.Vector2(p.x, p.z));
    const hh = holes.map(h => clean(h).map(p => new THREE.Vector2(p.x, p.z)));
    return { vertices: [...outline, ...hh.flat()], triangles: THREE.ShapeUtils.triangulateShape(outline, hh) };
  }
  function flatPolygon(points, holes, material, y = .02) {
    const { vertices, triangles } = triangulate(points, holes), positions = [], uvs = [];
    for (const face of triangles) for (const i of [face[2], face[1], face[0]]) { const p = vertices[i]; positions.push(p.x, y, p.y); uvs.push(p.x / 8, p.y / 8); }
    if (vertices.length) addGeometry(material, vertices[0].x, vertices[0].y, positions, uvs);
  }
  function polygonBox(points, extra = {}) {
    return { polygon: clean(points), minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)), ...extra };
  }
  function inside(p, polygon) {
    let yes = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) yes = !yes;
    }
    return yes;
  }
  const isWater = p => data.water.some(w => inside(p, w.points) && !(w.holes || []).some(h => inside(p, h)));
  const allBuildings = [...data.buildings, ...(data.inferredBuildings || [])];
  const buildingBounds = allBuildings.map(b => polygonBox(b.points, { source: b }));
  const inBuilding = p => buildingBounds.some(b => p.x > b.minX - 1 && p.x < b.maxX + 1 && p.z > b.minZ - 1 && p.z < b.maxZ + 1 && inside(p, b.polygon));
  const blockedProp = p => isWater(p) || inBuilding(p);
  function ribbon(points, width, material, y) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < .05) continue;
      const nx = -dz / length * width / 2, nz = dx / length * width / 2;
      addGeometry(material, (a.x + b.x) / 2, (a.z + b.z) / 2, [a.x + nx,y,a.z + nz,b.x + nx,y,b.z + nz,b.x - nx,y,b.z - nz,a.x + nx,y,a.z + nz,b.x - nx,y,b.z - nz,a.x - nx,y,a.z - nz]);
    }
  }

  // The mapped river is a real opening in the land surface. A full ground
  // plane above the lower water surface would turn the Nile into beige land.
  const groundOuter=[{x:-7000,z:-7000},{x:7000,z:-7000},{x:7000,z:7000},{x:-7000,z:7000}];
  const groundTriangles=triangulate(groundOuter,data.water.map(w=>w.points)),groundPositions=[];
  const appendGround=({vertices,triangles})=>{for(const face of triangles)for(const i of [face[2],face[1],face[0]])groundPositions.push(vertices[i].x,-.08,vertices[i].y);};
  appendGround(groundTriangles);
  // Holes inside the water multipolygon are mapped islands, so put land back.
  for(const water of data.water)for(const island of water.holes||[])appendGround(triangulate(island));
  const groundGeometry=new THREE.BufferGeometry();groundGeometry.setAttribute('position',new THREE.Float32BufferAttribute(groundPositions,3));groundGeometry.computeVertexNormals();
  const terrain=new THREE.Mesh(groundGeometry,mat('ground','#b6aa8e'));terrain.name='Mapped land · river cutout';terrain.userData.waterCutouts=true;terrain.receiveShadow=true;root.add(terrain);
  for (const area of data.areas) {
    const kind = area.tags.landuse || area.tags.leisure;
    const areaMat = ['grass','garden','park','village_green','pitch','farmland','plant_nursery'].includes(kind) ? grass : kind === 'swimming_pool' ? blue : soil;
    flatPolygon(area.points, area.holes || [], areaMat, .015);
  }
  for (const path of data.paths || []) ribbon(path.points, Math.min(4, path.width), pavement, .04);
  const jointGeometry = new THREE.CircleGeometry(1, 8); jointGeometry.rotateX(-Math.PI / 2);
  const joints = new Set();
  const major = roads.segments.filter(s => ['primary','secondary','tertiary','trunk'].includes(s.highway));
  for (const segment of roads.segments) {
    ribbon(segment.points, segment.width + 2.1, pavement, .055);
    ribbon(segment.points, segment.width, asphalt, .12);
    for (const p of segment.points) {
      const k = `${p.nodeId}:${segment.width}`; if (joints.has(k)) continue; joints.add(k);
      instance(jointGeometry, asphalt, p.x, .121, p.z, segment.width / 2, 1, segment.width / 2, 0, false);
    }
    if (segment.width >= 7) {
      let offset = 0;
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i - 1], b = segment.points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < .1) continue;
        for (let d = offset; d < length; d += 13) { const t = (d + 2) / length; if (t < 1) cube(white, a.x + dx*t, .138, a.z + dz*t, .13, .013, Math.min(4,length-d), Math.atan2(dx,dz)); }
        offset = (offset - length % 13 + 13) % 13;
      }
    }
    if (segment.bridge) {
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i-1], b = segment.points[i], dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz); if(l<.1)continue;
        const angle=Math.atan2(dx,dz),nx=dz/l,nz=-dx/l;
        cube(cream,(a.x+b.x)/2,-.45,(a.z+b.z)/2,segment.width+3,1,l,angle,false);
        for(const side of [-1,1]){
          const x=(a.x+b.x)/2+nx*side*(segment.width/2+.65),z=(a.z+b.z)/2+nz*side*(segment.width/2+.65);
          cube(rail,x,1.25,z,.15,.15,l,angle,false);cube(cream,x,.35,z,.6,.6,l,angle,false);
          for(let d=0;d<l;d+=4)cyl(rail,a.x+dx*d/l+nx*side*(segment.width/2+.65),.8,a.z+dz*d/l+nz*side*(segment.width/2+.65),.07,1.5);
        }
      }
    }
  }

  const waterUniforms = { time:{value:0}, deep:{value:new THREE.Color('#397b7c')}, haze:{value:new THREE.Color('#c3bd9f')} };
  const waterMat = new THREE.ShaderMaterial({ side:THREE.DoubleSide, uniforms:waterUniforms,
    vertexShader:'varying vec3 p;void main(){vec4 w=modelMatrix*vec4(position,1.);p=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader:`uniform float time;uniform vec3 deep;uniform vec3 haze;varying vec3 p;void main(){float wave=sin(p.x*.22+sin(p.z*.05+time*.25)*1.5+time*.6)*sin(p.z*.48-time*.5);float spark=pow(max(0.,wave),14.);vec3 c=deep*(.91+wave*.055)+vec3(.7,.53,.28)*spark*.13;c=mix(c,haze,smoothstep(200.,1600.,distance(cameraPosition,p))*.75);gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  for (const water of data.water) {
    const {vertices,triangles}=triangulate(water.points,water.holes||[]), positions=[];
    for(const tri of triangles)for(const i of tri)positions.push(vertices[i].x,-.3,vertices[i].y);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();root.add(new THREE.Mesh(geo,waterMat));
  }
  for (const water of data.waterColliders || data.water) {
    const {vertices,triangles}=triangulate(water.points,water.holes||[]);
    for(const tri of triangles)colliders.push(polygonBox(tri.map(i=>({x:vertices[i].x,z:vertices[i].y})),{type:'water',height:0,sourceId:water.id}));
  }

  function sign(arabic, english, x, y, z, width, angle, color='#365d58') {
    const text=arabic+'|'+english+'|'+color;
    if(!signs.has(text)){
      const c=document.createElement('canvas');c.width=768;c.height=192;const ctx=c.getContext('2d');
      ctx.fillStyle=color;ctx.fillRect(0,0,768,192);ctx.strokeStyle='#dac596';ctx.lineWidth=4;ctx.strokeRect(7,7,754,178);
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.direction='rtl';ctx.fillStyle='#f0e5c8';ctx.font='bold 66px Arial';ctx.fillText(arabic,384,70,720);
      ctx.direction='ltr';ctx.font='28px Arial';ctx.fillStyle='#d8be8a';ctx.fillText(english.toUpperCase(),384,148,720);
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;signs.set(text,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    }
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),signs.get(text));mesh.position.set(x,y,z);mesh.rotation.y=angle;mesh.userData.detail=true;chunk(x,z)[1].add(mesh);
  }
  const shops=[['قهوة المنصورة','Mansoura Coffee'],['عصائر النيل','Fresh Nile Juice'],['مخبز البلد','Baladi Bakery'],['صيدلية النور','Al Nour Pharmacy'],['فول وطعمية','Foul & Falafel'],['حلواني السعادة','Al Saada Sweets'],['سوبر ماركت','Neighborhood Market'],['مكتبة الجامعة','University Bookshop']];
  const corridorRoads={segments:roads.segments.filter(s=>[263225726,167439775,584524658,278480505].includes(s.osmId))};
  let balconyCount=0;
  for(let bi=0;bi<allBuildings.length;bi++){
    const building=allBuildings[bi], polygon=clean(building.points), h=building.height;
    if(polygon.length<3)continue;
    // Boolean clipping may return clockwise exteriors. Normalize wall winding
    // so exterior surfaces face outward instead of disappearing by backface culling.
    const signedArea=polygon.reduce((sum,p,i)=>{const b=polygon[(i+1)%polygon.length];return sum+p.x*b.z-b.x*p.z;},0);
    if(signedArea<0)polygon.reverse();
    const cx=polygon.reduce((s,p)=>s+p.x,0)/polygon.length,cz=polygon.reduce((s,p)=>s+p.z,0)/polygon.length;
    const near=nearestRoad({x:cx,z:cz},corridorRoads).distance<110;
    const nearest=near?nearestRoad({x:cx,z:cz},roads):null;
    const mass=palette[Math.abs(building.osmId||bi)%palette.length];
    flatPolygon(polygon,building.holes||[],cream,h+.08);
    let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a.x*b.z-b.x*a.z;}
    let shopEdge=-1,shopDistance=Infinity;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.2)continue;
      const nx=(area>0?1:-1)*dz/l,nz=(area>0?-1:1)*dx/l,angle=Math.atan2(nx,nz),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
      const wall=[a.x,0,a.z,b.x,h,b.z,b.x,0,b.z,a.x,0,a.z,a.x,h,a.z,b.x,h,b.z];
      addGeometry(mass,cx,cz,wall,[0,0,l/5,h/5,l/5,0,0,0,0,h/5,l/5,h/5]);
      cube(trim,mx,h+.4,mz,.32,.8,l,Math.atan2(dx,dz),false);
      const floorCount=Math.min(13,Math.max(1,Math.floor((h-3)/3.4))),cols=Math.min(16,Math.max(1,Math.floor(l/3.8)));
      if(l>2.5)for(let f=0;f<floorCount;f++)for(let c=0;c<cols;c++){
        const t=(c+.5)/cols,wx=a.x+dx*t+nx*.025,wz=a.z+dz*t+nz*.025,y=4.4+f*3.4;if(y+1>h)continue;
        instance((bi+c+f)%17===0?plane:plane,(bi+c+f)%17===0?litGlass:glass,wx,y,wz,Math.min(1.5,l/cols*.52),1.8,1,angle);
        if(near&&l>5&&(c+bi)%3!==0&&f%2===bi%2&&balconyCount<8500){
          const bx=wx+nx*.6,bz=wz+nz*.6;balconyCount++;
          cube(cream,bx,y-1.05,bz,2.5,.16,1.25,angle);cube(rail,wx+nx*1.2,y-.55,wz+nz*1.2,2.4,.12,.07,angle);cube(rail,wx+nx*1.2,y-.82,wz+nz*1.2,2.4,.42,.06,angle);
          if((c+f+bi)%9===0)cube([red,blue,cream][bi%3],wx+nx*1.25,y-.65,wz+nz*1.25,1.5,.65,.05,angle);
        }
        if(near&&(c+f+bi)%11===0)cube(cream,wx+nx*.36,y+.2,wz+nz*.36,.8,.6,.6,angle);
      }
      if(near&&nearest&&l>5){const d=Math.hypot(mx-nearest.x,mz-nearest.z);if(d<shopDistance){shopDistance=d;shopEdge=i;}}
    }
    colliders.push(polygonBox(polygon,{height:h,type:'building',sourceId:building.id,holes:building.holes||[],inferred:building.id.startsWith('inferred')}));
    if(h>8&&bi%2===0){cyl(black,cx,h+1.1,cz,.85,2.1);cyl(black,cx,h+2.2,cz,.91,.16);cube(mass,cx+2,h+1.4,cz+2,3,2.8,3);}
    if(h>12&&bi%4===0){cyl(rail,cx-2,h+1.5,cz-2,.05,3);instance(sphere,cream,cx-2,h+2.6,cz-2,.7,.2,.7,0,true,.4);}
    if(near&&shopEdge>=0&&bi%2===0){
      const a=polygon[shopEdge],b=polygon[(shopEdge+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),nx=(area>0?1:-1)*dz/l,nz=(area>0?-1:1)*dx/l,angle=Math.atan2(nx,nz);
      const x=(a.x+b.x)/2,z=(a.z+b.z)/2,shop=shops[bi%shops.length];
      cube([red,blue,green][bi%3],x+nx*.8,3.1,z+nz*.8,Math.min(l-.5,13),.22,1.6,angle);
      sign(shop[0],shop[1],x+nx*.2,3.5,z+nz*.2,Math.min(11,l-.6),angle,['#385e55','#844d38','#3f6268'][bi%3]);
      instance(plane,glass,x+nx*.05,1.55,z+nz*.05,Math.min(l-1,10),2.6,1,angle);
    }
    if(building.tags.amenity==='place_of_worship'&&building.tags.religion!=='christian'){
      const size=Math.min(7,(buildingBounds[bi].maxX-buildingBounds[bi].minX)*.25,(buildingBounds[bi].maxZ-buildingBounds[bi].minZ)*.25);
      if(size>2)instance(sphere,mat('dome','#81a699'),cx,h,cz,size,size*.85,size,0,false);
    }
  }

  // Original palm fronds have leaflets and curved silhouettes, shared citywide.
  const leafVertices=[];
  for(let i=0;i<14;i++){const t=i/14,n=(i+1)/14,x=t*6,nx=n*6,y=Math.sin(t*Math.PI)*1.4-t,ny=Math.sin(n*Math.PI)*1.4-n,span=Math.sin(t*Math.PI)*1.05;for(const s of [-1,1])leafVertices.push(x,y,0,x+.8,y-.2,s*span,nx+.1,ny,0);}
  const leaves=new THREE.BufferGeometry();leaves.setAttribute('position',new THREE.Float32BufferAttribute(leafVertices,3));leaves.computeVertexNormals();green.side=leafLight.side=THREE.DoubleSide;
  function palm(x,z,h=9){cyl(trunk,x,h/2,z,.3,h);for(let y=1;y<h;y+=.8)cyl(trim,x,y,z,.32,.055);orb(green,x,h,z,.6);for(let a=0;a<8;a++)instance(leaves,a%2?green:leafLight,x,h+.2,z,.9,.9,.9,a*Math.PI/4);}
  function tree(x,z,r=3.8){cyl(trunk,x,2,z,.25,4);orb(green,x,5,z,r,r*.86);orb(leafLight,x+1,6,z,r*.72,r*.7);}
  function lamp(x,z,angle){cyl(rail,x,4.5,z,.1,9);cube(rail,x,9,z,.12,.12,2.8,angle);cube(lampGlow,x+Math.sin(angle)*1.25,8.9,z+Math.cos(angle)*1.25,.6,.2,.9,angle);}
  function bench(x,z,angle){cube(brick,x,.65,z,2.6,.16,.65,angle);cube(brick,x-Math.sin(angle)*.3,1.05,z-Math.cos(angle)*.3,2.6,.65,.1,angle);for(const s of [-1,1])cube(rail,x+Math.cos(angle)*s, .3,z-Math.sin(angle)*s,.12,.6,.5,angle);}
  const corniche=roads.segments.filter(s=>s.osmId===263225726),peopleMat=[cream,blue,brick,green];
  for(const segment of corniche){let carry=0;for(let i=1;i<segment.points.length;i++){
    const a=segment.points[i-1],b=segment.points[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.1)continue;
    const nx=-dz/l,nz=dx/l,angle=Math.atan2(dx,dz);
    for(let d=carry;d<l;d+=23){const t=d/l,x=a.x+dx*t,z=a.z+dz*t;
      for(const side of [-1,1]){const px=x+nx*side*(segment.width/2+2.5),pz=z+nz*side*(segment.width/2+2.5);if(blockedProp({x:px,z:pz}))continue;
        palm(px,pz,8.8+random()*2);if(side===1)lamp(x+nx*side*(segment.width/2+1),z+nz*side*(segment.width/2+1),angle+Math.PI/2);
        const bx=x+nx*side*(segment.width/2+3.5)+dx/l*6,bz=z+nz*side*(segment.width/2+3.5)+dz/l*6;if(!blockedProp({x:bx,z:bz}))bench(bx,bz,angle+Math.PI/2);
        const hx=x+nx*side*(segment.width/2+1.7)+dx/l*9,hz=z+nz*side*(segment.width/2+1.7)+dz/l*9;
        if(!blockedProp({x:hx,z:hz})){cyl(peopleMat[Math.floor(random()*4)],hx,.8,hz,.22,1.1);orb(mat('skin','#b18b69'),hx,1.58,hz,.2);}
      }
    }carry=(carry-l%23+23)%23;
  }}
  // Trees stay within mapped green areas and off all road corridors.
  for(const area of data.areas){if(!['park','garden','grass','village_green'].includes(area.tags.leisure||area.tags.landuse))continue;
    const bb=polygonBox(area.points),areaSize=(bb.maxX-bb.minX)*(bb.maxZ-bb.minZ),count=Math.min(24,Math.floor(areaSize/300));
    for(let i=0;i<count;i++){const p={x:bb.minX+random()*(bb.maxX-bb.minX),z:bb.minZ+random()*(bb.maxZ-bb.minZ)};if(inside(p,area.points)&&!blockedProp(p)&&nearestRoad(p,roads).distance>6)tree(p.x,p.z,2.7+random()*1.4);}
  }
  // Road names come from the data. Signs are placed beside the local tangent.
  for(const landmark of data.landmarks){const p=nearestRoad(landmark,roads),s=roads.segments[p.segmentIndex],a=s.points[p.edgeIndex],b=s.points[p.edgeIndex+1],l=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/l,nz=(b.x-a.x)/l;
    const x=p.x+nx*(s.width/2+1.3),z=p.z+nz*(s.width/2+1.3);if(blockedProp({x,z}))continue;
    cyl(rail,x,2.4,z,.08,4.8);sign(landmark.arabic,landmark.name,x,4.4,z,7,Math.atan2(-nx,-nz));
  }

  // Feluccas are original models on actual water, not generic blue land tiles.
  for(const p of [{x:-550,z:-430},{x:-1350,z:-420},{x:500,z:-560},{x:1300,z:-1000}]){
    if(!isWater(p))continue;const g=new THREE.Group();g.position.set(p.x,-.1,p.z);root.add(g);
    const hull=new THREE.Mesh(new THREE.BoxGeometry(3.2,1.2,16),blue);hull.position.y=.6;g.add(hull);
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,13,6),brick);mast.position.y=7;g.add(mast);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([0,13,0,0,2,7,0,2,-6],3));geo.computeVertexNormals();g.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:'#e6dcc4',side:THREE.DoubleSide,roughness:.9})));boats.push({group:g,z:p.z,phase:random()*6});
  }

  // A few grouped draws per visible block instead of one draw per source way
  // or footprint. The full collidable source city remains available at all times.
  for(const batch of geometries.values()){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(batch.colors,3));g.computeVertexNormals();g.computeBoundingSphere();
    const m=new THREE.Mesh(g,batch.material);m.castShadow=true;m.receiveShadow=true;m.userData.detail=batch.detail;batch.group.add(m);
  }
  for(const batch of instances.values()){
    const m=new THREE.InstancedMesh(batch.geometry,batch.material,batch.matrices.length);batch.matrices.forEach((matrix,i)=>{m.setMatrixAt(i,matrix);m.setColorAt(i,batch.colors[i]);});m.computeBoundingSphere();m.instanceMatrix.needsUpdate=true;
    m.castShadow=batch.geometry===sphere||batch.material===leafSurface;m.receiveShadow=true;m.userData.detail=batch.detail;batch.group.add(m);
  }
  let lastFocus={x:Infinity,z:Infinity};
  function setFocus(x,z){if(typeof x==='object'){z=x.z;x=x.x;}if(!Number.isFinite(x)||Math.hypot(x-lastFocus.x,z-lastFocus.z)<35)return;lastFocus={x,z};
    for(const group of chunks.values()){const c=group.userData.center,d=Math.hypot(x-c.x,z-c.z);group.visible=d<1050;for(const child of group.children)if(child.userData.detail)child.visible=d<720;}
  }
  setFocus(data.start.x,data.start.z);
  return {root,roads,bounds,colliders,landmarks:data.landmarks,start:data.start,groundHeight:.14,stats:{...data.stats,chunks:chunks.size},mapData:data,setFocus,heightAt:()=>.14,
    getDistrict(x,z){const p=nearestRoad({x,z},roads),s=roads.segments[p.segmentIndex];return {name:s?.nameEn||s?.name||'Mansoura',arabic:s?.name||'المنصورة'};},
    setNight(night){litGlass.emissiveIntensity=night?1.65:.12;glass.emissive.set(night?'#d3b987':'#000000');glass.emissiveIntensity=night?.035:0;lampGlow.emissiveIntensity=night?3:.35;waterUniforms.deep.value.set(night?'#183f4c':'#397b7c');waterUniforms.haze.value.set(night?'#172e39':'#c3bd9f');},
    update(dt,time=0,focus){waterUniforms.time.value=time;if(focus)setFocus(focus);for(const b of boats){b.group.position.y=-.13+Math.sin(time*.6+b.phase)*.07;b.group.rotation.z=Math.sin(time*.45+b.phase)*.009;}}
  };
}
