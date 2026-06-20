(function(){
'use strict';

function finitePoint(p){
  return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
}

function clonePoint(p){
  return {x:Number(p.x)||0,y:Number(p.y)||0,z:Number(p.z)||0};
}

function colorValue(color){
  try{
    if(window.$3Dmol&&$3Dmol.CC&&$3Dmol.CC.color)return $3Dmol.CC.color(color||'#fdd835');
  }catch(e){}
  const c=document.createElement('canvas').getContext('2d');
  c.fillStyle=color||'#fdd835';
  const hex=c.fillStyle;
  const n=parseInt(hex.slice(1),16);
  return {r:((n>>16)&255)/255,g:((n>>8)&255)/255,b:(n&255)/255};
}

function sub(a,b){
  return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};
}

function cross(a,b){
  return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
}

function normalize(v){
  const d=Math.hypot(v.x,v.y,v.z)||1;
  return {x:v.x/d,y:v.y/d,z:v.z/d};
}

function viewKey(viewer){
  const q=viewer&&viewer.rotationGroup&&viewer.rotationGroup.quaternion;
  const mp=viewer&&viewer.modelGroup&&viewer.modelGroup.position;
  const zp=viewer&&viewer.rotationGroup&&viewer.rotationGroup.position;
  if(!q||!mp||!zp)return '';
  return [
    q.x,q.y,q.z,q.w,mp.x,mp.y,mp.z,zp.z,viewer.WIDTH,viewer.HEIGHT
  ].map(v=>Number(v||0).toFixed(4)).join(':');
}

// 3Dmol's internal Coloring enum is not exported on window.$3Dmol.
const VERTEX_COLORS = 2;

class MolWideLineLayer{
  constructor(host,getViewer){
    this.host=host;
    this.getViewer=getViewer;
    this.collections=new Map();
    this.mesh=null;
    this.geometry=null;
    this.material=null;
    this.plan=[];
    this.coords=[];
    this.meshDirty=true;
    this.lastViewKey='';
    this.nextPrimitiveId=1;
    this.Geometry=null;
    this.Mesh=null;
    this.Material=null;
    host._wideLineLayer=this;
  }

  bindViewer(viewer){
    if(!viewer||viewer._wideLineLayerBound)return;
    viewer._wideLineLayerBound=true;
    const layer=this;
    ['render','show'].forEach(function(name){
      if(typeof viewer[name]!=='function')return;
      const native=viewer[name].bind(viewer);
      viewer[name]=function(){
        layer.syncToScene();
        return native.apply(null,arguments);
      };
    });
    if(typeof viewer.resize==='function'){
      const nativeResize=viewer.resize.bind(viewer);
      viewer.resize=function(){
        const ret=nativeResize.apply(null,arguments);
        layer.lastViewKey='';
        layer.syncToScene();
        return ret;
      };
    }
    this.patchLinePrimitives(viewer);
  }

  patchLinePrimitives(viewer){
    if(!viewer||viewer._wideLinePrimitivePatch)return;
    const layer=this;
    const nativeAddLine=typeof viewer.addLine==='function'?viewer.addLine.bind(viewer):null;
    const nativeAddShape=typeof viewer.addShape==='function'?viewer.addShape.bind(viewer):null;
    const nativeRemoveShape=typeof viewer.removeShape==='function'?viewer.removeShape.bind(viewer):null;
    const nativeRemoveAllShapes=typeof viewer.removeAllShapes==='function'?viewer.removeAllShapes.bind(viewer):null;
    if(nativeAddLine){
      viewer.addLine=function(spec){
        return layer.addPrimitiveLine(spec)||nativeAddLine(spec);
      };
    }
    if(nativeAddShape){
      viewer.addShape=function(){
        const shape=nativeAddShape.apply(null,arguments);
        if(!shape||typeof shape.addLine!=='function'||shape._wideLineShapePatch)return shape;
        const nativeShapeAddLine=shape.addLine.bind(shape);
        const collectionId='shape:'+layer.nextPrimitiveId++;
        shape.__wideLineCollections=shape.__wideLineCollections||[];
        shape.__wideLineCollections.push(collectionId);
        shape.addLine=function(spec){
          if(!spec||!finitePoint(spec.start)||!finitePoint(spec.end))return nativeShapeAddLine.apply(null,arguments);
          layer.appendLineToCollection(collectionId,{
            start:spec.start,end:spec.end,color:spec.color,width:spec.linewidth||spec.width,opacity:spec.opacity,dashed:!!spec.dashed
          });
          return shape;
        };
        shape._wideLineShapePatch=true;
        return shape;
      };
    }
    if(nativeRemoveShape){
      viewer.removeShape=function(shape){
        if(shape&&shape.__wideLineOnly&&shape.__wideLineCollection){
          layer.clearCollection(shape.__wideLineCollection);
          return;
        }
        if(shape&&shape.__wideLineCollections)shape.__wideLineCollections.forEach(id=>layer.clearCollection(id));
        return nativeRemoveShape.apply(null,arguments);
      };
    }
    if(nativeRemoveAllShapes){
      viewer.removeAllShapes=function(){
        layer.clearCollections('primitive:');
        layer.clearCollections('shape:');
        return nativeRemoveAllShapes.apply(null,arguments);
      };
    }
    viewer._wideLinePrimitivePatch=true;
  }

  normalizeCollection(lines,points,options){
    return {
      lines:(lines||[]).filter(line=>finitePoint(line.start)&&finitePoint(line.end)).map(line=>({
        start:clonePoint(line.start),end:clonePoint(line.end),color:line.color||options&&options.color,
        width:Math.max(1,Number(line.width||line.linewidth||(options&&options.linewidth)||2)),
        opacity:line.opacity==null?(options&&options.opacity):line.opacity,dashed:!!line.dashed
      })),
      points:(points||[]).filter(finitePoint).map(point=>({
        x:Number(point.x)||0,y:Number(point.y)||0,z:Number(point.z)||0,color:point.color||options&&options.color,
        radius:Math.max(1,Number(point.radius||(options&&options.pointRadius)||(options&&options.linewidth)||2)),
        opacity:point.opacity==null?(options&&options.opacity):point.opacity
      })),
      options:Object.assign({color:'#fdd835',linewidth:2,opacity:1,pointRadius:2},options||{})
    };
  }

  set(lines,points,options){
    this.setCollection('default',lines,points,options);
  }

  setCollection(id,lines,points,options){
    this.collections.set(String(id),this.normalizeCollection(lines,points,options));
    this.meshDirty=true;
    this.lastViewKey='';
  }

  appendLineToCollection(id,line){
    if(!line||!finitePoint(line.start)||!finitePoint(line.end))return;
    const key=String(id);
    const group=this.collections.get(key)||this.normalizeCollection([],[],{});
    group.lines.push({
      start:clonePoint(line.start),end:clonePoint(line.end),color:line.color,
      width:Math.max(1,Number(line.width||line.linewidth||2)),opacity:line.opacity,dashed:!!line.dashed
    });
    this.collections.set(key,group);
    this.meshDirty=true;
    this.lastViewKey='';
  }

  clearCollection(id){
    this.collections.delete(String(id));
    this.meshDirty=true;
    this.lastViewKey='';
  }

  clearCollections(prefix){
    const p=String(prefix);
    Array.from(this.collections.keys()).forEach(id=>{ if(id.indexOf(p)===0)this.collections.delete(id); });
    this.meshDirty=true;
    this.lastViewKey='';
  }

  clear(){
    this.collections.clear();
    this.meshDirty=true;
    this.lastViewKey='';
    if(this.mesh)this.mesh.visible=false;
  }

  addPrimitiveLine(spec){
    if(!spec||!finitePoint(spec.start)||!finitePoint(spec.end))return null;
    const id='primitive:'+this.nextPrimitiveId++;
    this.setCollection(id,[{start:spec.start,end:spec.end,color:spec.color,width:spec.linewidth||spec.width,opacity:spec.opacity,dashed:!!spec.dashed}],[],spec);
    return {__wideLineOnly:true,__wideLineCollection:id,remove:()=>this.clearCollection(id)};
  }

  resolveRuntime(viewer){
    if(this.Geometry&&this.Mesh&&this.Material)return true;
    let sample=null;
    function walk(o){
      if(sample||!o)return;
      if(o.geometry&&o.material){ sample=o; return; }
      (o.children||[]).forEach(walk);
    }
    walk(viewer&&viewer.scene);
    if(!sample)return false;
    this.Geometry=sample.geometry.constructor;
    this.Mesh=sample.constructor;
    this.Material=sample.material.constructor;
    return true;
  }

  allItems(){
    const out=[];
    this.collections.forEach(group=>{
      group.lines.forEach(line=>out.push({type:'line',data:line,options:group.options}));
      group.points.forEach(point=>out.push({type:'point',data:point,options:group.options}));
    });
    return out;
  }

  ensureMesh(viewer,items){
    if(!items.length){
      if(this.mesh)this.mesh.visible=false;
      return false;
    }
    if(!this.resolveRuntime(viewer))return false;
    if(this.mesh&&this.mesh.parent)viewer.modelGroup.remove(this.mesh);
    this.geometry=new this.Geometry(true);
    this.material=new this.Material({color:'#ffffff'});
    this.material.shaderID='basic';
    this.material.vertexColors=VERTEX_COLORS;
    this.material.depthTest=true;
    this.material.depthWrite=true;
    this.material.transparent=false;
    this.material.needsUpdate=true;
    this.mesh=new this.Mesh(this.geometry,this.material);
    this.mesh.name='MolWideLineMesh';
    this.mesh.__molWideLineMesh=true;
    this.mesh.visible=true;
    this.plan=[];
    this.coords=[];
    items.forEach(item=>{
      const group=this.geometry.updateGeoGroup(4);
      const base=group.vertices;
      const color=colorValue(item.data.color||item.options.color);
      this.fillStaticQuad(group,base,color);
      this.plan.push({group,base,item,coordOffset:this.coords.length});
      if(item.type==='line')this.coords.push(item.data.start,item.data.end);
      else this.coords.push(item.data);
      group.vertices+=4;
      group.faceidx+=6;
    });
    this.geometry.initTypedArrays();
    this.geometry.verticesNeedUpdate=true;
    this.geometry.elementsNeedUpdate=true;
    this.geometry.normalsNeedUpdate=true;
    this.geometry.colorsNeedUpdate=true;
    viewer.modelGroup.add(this.mesh);
    return true;
  }

  fillStaticQuad(group,base,color){
    const fi=group.faceidx,ci=base*3;
    group.faceArray[fi]=base;
    group.faceArray[fi+1]=base+2;
    group.faceArray[fi+2]=base+1;
    group.faceArray[fi+3]=base+2;
    group.faceArray[fi+4]=base+3;
    group.faceArray[fi+5]=base+1;
    for(let i=0;i<4;i++){
      const p=ci+i*3;
      group.colorArray[p]=color.r;
      group.colorArray[p+1]=color.g;
      group.colorArray[p+2]=color.b;
    }
  }

  writeVertex(group,idx,p,n){
    const vi=idx*3;
    group.vertexArray[vi]=p.x;
    group.vertexArray[vi+1]=p.y;
    group.vertexArray[vi+2]=p.z;
    group.normalArray[vi]=n.x;
    group.normalArray[vi+1]=n.y;
    group.normalArray[vi+2]=n.z;
  }

  writeLineQuad(viewer,entry,projected){
    const line=entry.item.data, a=line.start, b=line.end, pa=projected[entry.coordOffset], pb=projected[entry.coordOffset+1];
    if(!pa||!pb||!Number.isFinite(pa.x)||!Number.isFinite(pb.x))return;
    let dx=pb.x-pa.x, dy=pb.y-pa.y, len=Math.hypot(dx,dy);
    if(len<1e-4){ dx=1; dy=0; len=1; }
    const half=Math.max(0.5,Number(line.width||entry.item.options.linewidth||2)/2);
    const off=viewer.screenOffsetToModel(-dy/len*half,dx/len*half);
    const v0={x:a.x+off.x,y:a.y+off.y,z:a.z+off.z};
    const v1={x:a.x-off.x,y:a.y-off.y,z:a.z-off.z};
    const v2={x:b.x+off.x,y:b.y+off.y,z:b.z+off.z};
    const v3={x:b.x-off.x,y:b.y-off.y,z:b.z-off.z};
    const n=normalize(cross(sub(b,a),off));
    this.writeVertex(entry.group,entry.base,v0,n);
    this.writeVertex(entry.group,entry.base+1,v1,n);
    this.writeVertex(entry.group,entry.base+2,v2,n);
    this.writeVertex(entry.group,entry.base+3,v3,n);
  }

  writePointQuad(viewer,entry){
    const p=entry.item.data, radius=Math.max(1,Number(p.radius||entry.item.options.pointRadius||entry.item.options.linewidth||2));
    const ox=viewer.screenOffsetToModel(radius,0), oy=viewer.screenOffsetToModel(0,radius);
    const n=normalize(cross(ox,oy));
    this.writeVertex(entry.group,entry.base,{x:p.x-ox.x-oy.x,y:p.y-ox.y-oy.y,z:p.z-ox.z-oy.z},n);
    this.writeVertex(entry.group,entry.base+1,{x:p.x+ox.x-oy.x,y:p.y+ox.y-oy.y,z:p.z+ox.z-oy.z},n);
    this.writeVertex(entry.group,entry.base+2,{x:p.x-ox.x+oy.x,y:p.y-ox.y+oy.y,z:p.z-ox.z+oy.z},n);
    this.writeVertex(entry.group,entry.base+3,{x:p.x+ox.x+oy.x,y:p.y+ox.y+oy.y,z:p.z+ox.z+oy.z},n);
  }

  updateVertices(viewer){
    let projected=[];
    try{ projected=viewer.modelToScreen(this.coords); }catch(e){ return false; }
    this.plan.forEach(entry=>{
      if(entry.item.type==='line')this.writeLineQuad(viewer,entry,projected);
      else this.writePointQuad(viewer,entry);
    });
    if(this.geometry){
      this.geometry.verticesNeedUpdate=true;
      this.geometry.normalsNeedUpdate=true;
    }
    return true;
  }

  syncToScene(){
    const viewer=this.getViewer&&this.getViewer();
    if(!viewer||!viewer.modelGroup)return;
    const items=this.allItems();
    if(!items.length){
      if(this.mesh)this.mesh.visible=false;
      return;
    }
    const key=viewKey(viewer);
    if(this.meshDirty||!this.mesh){
      if(!this.ensureMesh(viewer,items))return;
      this.meshDirty=false;
      this.lastViewKey='';
    }
    if(!this.mesh)return;
    this.mesh.visible=true;
    if(key!==this.lastViewKey){
      this.updateVertices(viewer);
      this.lastViewKey=key;
    }
  }
}

window.MolWideLineLayer=MolWideLineLayer;
})();
