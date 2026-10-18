import * as THREE from '../vendor/three.module.js';

/** Individually authored architecture from cited views. These are photo-based
 * interpretations, with estimated dimensions, not survey-grade reproductions.
 */
export function buildReferenceBuilding({building,entry,helpers}) {
  if(entry.model!=='university-administration'||building.osmId!==1187267273)return false;
  const {mat,cube,cyl,instance,plane,box,addGeometry,flatPolygon,chunk}=helpers;
  const polygon=building.points.map(p=>({...p})),height=entry.height;
  let area=polygon.reduce((sum,p,i)=>{const b=polygon[(i+1)%polygon.length];return sum+p.x*b.z-b.x*p.z;},0);
  if(area<0)polygon.reverse();
  const cx=polygon.reduce((s,p)=>s+p.x,0)/polygon.length,cz=polygon.reduce((s,p)=>s+p.z,0)/polygon.length;
  const group=new THREE.Group();group.name=entry.buildingId;
  group.userData={referenceStatus:entry.status,model:entry.model,buildingId:building.id,osmId:building.osmId,height,heightSource:entry.heightSource,observationDate:entry.observationDate,remainingUnknowns:entry.remainingUnknowns,proceduralFallback:false};
  chunk(cx,cz)[1].add(group);
  const material=(key,color,options={})=>{const m=mat('admin-'+key,color,options);m.userData.preserveReferenceMaterial=true;return m;};
  const plaster=material('plaster','#e3d8b4',{roughness:.91}),stone=material('base','#aaa28c',{roughness:.9});
  const band=material('bands','#e9dfbd',{roughness:.9}),frame=material('frames','#77745f',{roughness:.7});
  const glass=material('glass','#477d7a',{roughness:.25,metalness:.23}),dark=material('interior','#293f3d',{roughness:.6});
  const grille=material('grilles','#746048',{roughness:.72,metalness:.25}),marble=material('columns','#b99b87',{roughness:.55});
  const gold=material('letter-gold','#b69b50',{roughness:.5,metalness:.45});
  const frontPoints=polygon.filter(p=>p.z<-90&&p.x<-2045);
  const mainMinX=Math.min(...frontPoints.map(p=>p.x)),mainMaxX=Math.max(...frontPoints.map(p=>p.x)),mainWidth=mainMaxX-mainMinX,mainX=(mainMinX+mainMaxX)/2;
  const northZ=x=>{
    const zz=[];
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((a.x<=x&&b.x>=x||b.x<=x&&a.x>=x)&&Math.abs(b.x-a.x)>.0001){const t=(x-a.x)/(b.x-a.x);zz.push(a.z+(b.z-a.z)*t);}}
    return zz.length?Math.min(...zz):-93;
  };
  const frontZ=northZ(mainX),porticoTop=height*.52;
  function wall(a,b,bottom,top,material,offset=0){
    const dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz),nx=dz/l,nz=-dx/l;
    const ax=a.x+nx*offset,az=a.z+nz*offset,bx=b.x+nx*offset,bz=b.z+nz*offset;
    addGeometry(material,cx,cz,[ax,bottom,az,bx,top,bz,bx,bottom,bz,ax,bottom,az,ax,top,az,bx,top,bz],[0,0,l/5,top/5,l/5,0,0,0,0,top/5,l/5,top/5]);
  }
  function window(x,y,z,width=1.65,h=1.7,angle=Math.PI,withGrille=false){
    const nx=Math.sin(angle),nz=Math.cos(angle),tx=Math.cos(angle),tz=-Math.sin(angle);
    instance(plane,glass,x,y,z,width,h,1,angle);
    for(const side of [-1,1])cube(frame,x+tx*side*width/2,y,z+tz*side*width/2,.075,h+.1,.08,angle);
    for(const side of [-1,1])cube(frame,x,y+side*h/2,z,width+.08,.075,.08,angle);
    cube(frame,x,y,z,.055,h,.09,angle);
    if(withGrille){
      // Diamond security grilles are visible on the official front/rear views.
      for(const slope of [-1,1])for(const offset of [-.5,0,.5]){
        const xa=(-h/2-offset)/slope,xb=(h/2-offset)/slope;
        const lower=Math.max(-width/2,Math.min(xa,xb)),upper=Math.min(width/2,Math.max(xa,xb));if(upper-lower<.2)continue;
        const yy0=slope*lower+offset,yy1=slope*upper+offset;if(Math.abs(yy0)>h/2+.01||Math.abs(yy1)>h/2+.01)continue;
        const mx=(lower+upper)/2,my=(yy0+yy1)/2,len=Math.hypot(upper-lower,yy1-yy0);
        instance(box,grille,x+tx*mx+nx*.07,y+my,z+tz*mx+nz*.07,.035,len,.04,angle,true,-Math.atan2(upper-lower,yy1-yy0));
      }
    }
  }
  function glazing(x,y,z,width,h,angle=Math.PI,cols=6,rows=2){
    instance(plane,glass,x,y,z,width,h,1,angle);
    const tx=Math.cos(angle),tz=-Math.sin(angle);
    for(let i=0;i<=cols;i++){const u=(i/cols-.5)*width;cube(band,x+tx*u,y,z+tz*u,.07,h+.12,.09,angle);}
    for(let i=0;i<=rows;i++)cube(band,x,y+(i/rows-.5)*h,z,width+.1,.07,.09,angle);
  }

  flatPolygon(polygon,building.holes||[],band,height);
  // Literal OSM roof outline; the north central facade's lower levels are
  // recessed behind the four observed columns instead of a solid street wall.
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.08)continue;
    const nx=dz/l,nz=-dx/l,mx=(a.x+b.x)/2,mz=(a.z+b.z)/2,angle=Math.atan2(nx,nz);
    const isPortico=nz<-.6&&mx<mainMaxX+.2&&mz<-90;
    if(isPortico){wall(a,b,porticoTop,height,plaster);wall(a,b,0,porticoTop,plaster,-3.35);}
    else wall(a,b,0,height,plaster);
    cube(stone,mx,.4,mz,.16,.8,l,Math.atan2(dx,dz));
    cube(band,mx+nx*.16,height-.55,mz+nz*.16,.45,1.1,l+.05,Math.atan2(dx,dz));
    // Fine horizontal plaster joints are observed on the official elevations.
    for(let y=1.35;y<height-1;y+=.78){if(isPortico&&y<porticoTop)continue;cube(band,mx+nx*.025,y,mz+nz*.025,.045,.025,l,Math.atan2(dx,dz));}
    const wingNorth=nz<-.85&&mx>mainMaxX&&l>6, rear=nz>.75&&l>6;
    if(wingNorth||rear){
      const count=Math.max(1,Math.floor(l/5.8));
      for(let f=0;f<5;f++)for(let c=0;c<count;c++){
        const t=(c+.5)/count,x=a.x+dx*t+nx*.035,z=a.z+dz*t+nz*.035,y=1.8+f*3.35;
        window(x,y,z,1.6,1.65,angle,true);
        if(rear&&[0,2,3].includes(f)&&c%2===0){cube(band,x+nx*.38,y-.95,z+nz*.38,.85,.58,.6,angle);cyl(frame,x+nx*.7,y-.95,z+nz*.7,.21,.05);}
      }
    }
  }
  // Main pavilion: two upper rows and a tall glazed hall behind pink columns.
  for(let c=0;c<4;c++){
    const x=mainMinX+mainWidth*(c+.5)/4,z=northZ(x)-.035;
    window(x,height*.69,z,1.8,1.65);window(x,height*.88,z,1.8,1.65);
  }
  const hallZ=frontZ+2.9;
  glazing(mainX,7.95,hallZ,mainWidth-2,2.85,Math.PI,12,3);
  glazing(mainX,1.8,frontZ+3.27,mainWidth*.5,3.1,Math.PI,8,2);
  for(const y of [3.45,6.2,9.5])cube(band,mainX,y,frontZ+2.55,mainWidth-1,.45,1.15);
  for(let c=0;c<4;c++){
    const x=mainMinX+mainWidth*(c+.12)/3.24,z=northZ(x)+.3;
    cyl(marble,x,porticoTop/2,z,.67,porticoTop);cyl(stone,x,.3,z,.77,.6);cyl(band,x,porticoTop-.12,z,.77,.24);
    // Slender vertical tonal lines echo the columns' observed veining.
    for(const angle of [-2.45,-1.9,-1.3,-.65])cyl(material('marble-vein','#a98d7b',{roughness:.6}),x+Math.sin(angle)*.673,porticoTop/2,z+Math.cos(angle)*.673,.014,porticoTop-.5);
  }
  // A shallow curved cornice follows the mapped northern pavilion outline.
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.2)continue;
    const nx=dz/l,nz=-dx/l,mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
    if(nz<-.6&&mx<mainMaxX+.2&&mz<-90)cube(band,mx+nx*.5,height-.65,mz+nz*.5,.95,1.25,l+.08,Math.atan2(dx,dz));
  }
  function lettering(text,x,y,z,width,h){
    const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=192;const ctx=canvas.getContext('2d');
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.direction='rtl';ctx.font='bold 123px Arial';ctx.fillStyle='#a58d49';ctx.fillText(text,768,99,1480);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    // Lettering follows the curved northern wall rather than sinking into it.
    const positions=[],uvs=[];
    for(let i=0;i<28;i++){
      const u0=i/28,u1=(i+1)/28,xa=x+width*(.5-u0),xb=x+width*(.5-u1),za=northZ(xa)-.17,zb=northZ(xb)-.17;
      positions.push(xa,y-h/2,za,xb,y-h/2,zb,xb,y+h/2,zb,xa,y-h/2,za,xb,y+h/2,zb,xa,y+h/2,za);
      uvs.push(u0,0,u1,0,u1,1,u0,0,u1,1,u0,1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.15,side:THREE.DoubleSide}));mesh.name='Observed facade inscription';group.add(mesh);
  }
  lettering('جامعة المنصورة',mainX,height*.78,frontZ-.13,15,1.25);
  lettering('الإدارة العامة',mainX,height*.565,frontZ-.14,12,1.15);
  // The circular emblem is visible but its fine glyphs are not reconstructed.
  const emblem=new THREE.Mesh(new THREE.TorusGeometry(.6,.1,6,24),gold);emblem.position.set(mainX,height*.9,frontZ-.14);group.add(emblem);
  const pole=material('pole','#b1b5a9',{metalness:.55,roughness:.4});
  for(const x of [mainX-.9,mainX+.9])cyl(pole,x,height+1.75,frontZ+1,.035,3.5);
  const flagRed=material('flag-red','#aa3430'),flagWhite=material('flag-white','#eee9dc'),flagBlack=material('flag-black','#293431');
  for(const [i,m]of [flagRed,flagWhite,flagBlack].entries())cube(m,mainX+1.65,height+3-i*.28,frontZ+1,1.5,.28,.035);
  cube(flagWhite,mainX-.15,height+2.7,frontZ+1,1.5,.82,.035);
  return true;
}
