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

function scale(v,s){
  return {x:v.x*s,y:v.y*s,z:v.z*s};
}

function cross(a,b){
  return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
}

function length(v){
  return Math.hypot(v.x,v.y,v.z);
}

function normalize(v){
  const d=length(v)||1;
  return {x:v.x/d,y:v.y/d,z:v.z/d};
}

function finiteNumber(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function lerpPoint(a,b,t){
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
}

function pointDistance(a,b){
  return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
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
const DEFAULT_LINE_WIDTH = 2;
const MODEL_UNITS_PER_LINE_WIDTH = 0.084;
const MIN_SCREEN_LINE_WIDTH = 0.26;
const MAX_SCREEN_LINE_WIDTH = 1.84;
const MIN_SCREEN_POINT_RADIUS = 0.24;
const MAX_SCREEN_POINT_RADIUS = 2.12;
const LINE_CAP_OVERLAP = 0.55;

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
        width:Math.max(1,Number(line.width||line.linewidth||(options&&options.linewidth)||DEFAULT_LINE_WIDTH)),
        opacity:line.opacity==null?(options&&options.opacity):line.opacity,dashed:!!line.dashed,
        dashLength:line.dashLength||options&&options.dashLength,
        gapLength:line.gapLength||options&&options.gapLength,
        modelWidth:line.modelWidth||line.worldWidth||options&&options.modelWidth||options&&options.worldWidth,
        minPixelWidth:line.minPixelWidth||options&&options.minPixelWidth,
        maxPixelWidth:line.maxPixelWidth||options&&options.maxPixelWidth
      })),
      points:(points||[]).filter(finitePoint).map(point=>({
        x:Number(point.x)||0,y:Number(point.y)||0,z:Number(point.z)||0,color:point.color||options&&options.color,
        radius:Math.max(1,Number(point.radius||(options&&options.pointRadius)||(options&&options.linewidth)||DEFAULT_LINE_WIDTH)),
        opacity:point.opacity==null?(options&&options.opacity):point.opacity,
        modelRadius:point.modelRadius||point.worldRadius||options&&options.modelRadius||options&&options.worldRadius,
        minPixelRadius:point.minPixelRadius||options&&options.minPixelRadius,
        maxPixelRadius:point.maxPixelRadius||options&&options.maxPixelRadius
      })),
      options:Object.assign({color:'#fdd835',linewidth:DEFAULT_LINE_WIDTH,opacity:1,pointRadius:DEFAULT_LINE_WIDTH},options||{})
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
      width:Math.max(1,Number(line.width||line.linewidth||DEFAULT_LINE_WIDTH)),opacity:line.opacity,dashed:!!line.dashed,
      dashLength:line.dashLength,
      gapLength:line.gapLength,
      modelWidth:line.modelWidth||line.worldWidth,
      minPixelWidth:line.minPixelWidth,
      maxPixelWidth:line.maxPixelWidth
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

  disposeMesh(viewer){
    if(this.mesh&&this.mesh.parent){
      try{ this.mesh.parent.remove(this.mesh); }catch(e){
        if(viewer&&viewer.modelGroup)try{ viewer.modelGroup.remove(this.mesh); }catch(_){}
      }
    }
    if(this.geometry&&typeof this.geometry.dispose==='function')try{ this.geometry.dispose(); }catch(e){}
    if(this.material&&typeof this.material.dispose==='function')try{ this.material.dispose(); }catch(e){}
    this.mesh=null;
    this.geometry=null;
    this.material=null;
    this.plan=[];
    this.coords=[];
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
      group.lines.forEach(line=>{
        if(line.dashed)this.expandDashedLine(line,group.options).forEach(segment=>out.push({type:'line',data:segment,options:group.options}));
        else out.push({type:'line',data:line,options:group.options});
      });
      group.points.forEach(point=>out.push({type:'point',data:point,options:group.options}));
    });
    return out;
  }

  expandDashedLine(line,options){
    const length=pointDistance(line.start,line.end);
    if(!Number.isFinite(length)||length<=0)return [];
    const width=finiteNumber(line.width||options.linewidth,DEFAULT_LINE_WIDTH);
    const dashLength=Math.max(0.12,finiteNumber(line.dashLength||options.dashLength,width*0.1));
    const gapLength=Math.max(0.08,finiteNumber(line.gapLength||options.gapLength,dashLength*0.75));
    const period=dashLength+gapLength;
    if(length<=dashLength||period<=0)return [Object.assign({},line,{dashed:false})];
    const segments=[];
    for(let pos=0;pos<length&&segments.length<512;pos+=period){
      const end=Math.min(length,pos+dashLength);
      if(end<=pos)break;
      segments.push(Object.assign({},line,{
        start:lerpPoint(line.start,line.end,pos/length),
        end:lerpPoint(line.start,line.end,end/length),
        dashed:false
      }));
    }
    return segments;
  }

  ensureMesh(viewer,items){
    if(!items.length){
      if(this.mesh)this.mesh.visible=false;
      return false;
    }
    if(!this.resolveRuntime(viewer))return false;
    this.disposeMesh(viewer);
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

  modelUnitsPerPixel(viewer){
    if(!viewer||typeof viewer.screenOffsetToModel!=='function')return 1;
    const off=viewer.screenOffsetToModel(1,0), d=off&&length(off);
    return Number.isFinite(d)&&d>1e-9?d:1;
  }

  clampModelSize(viewer,size,minPx,maxPx){
    let out=Math.max(0.001,Number(size)||0);
    const modelPerPixel=this.modelUnitsPerPixel(viewer);
    if(Number.isFinite(minPx)&&minPx>0)out=Math.max(out,modelPerPixel*minPx);
    if(Number.isFinite(maxPx)&&maxPx>0)out=Math.min(out,modelPerPixel*maxPx);
    return out;
  }

  screenDirection(viewer,x,y,fallback){
    if(viewer&&typeof viewer.screenOffsetToModel==='function'){
      const off=viewer.screenOffsetToModel(x,y);
      if(off&&length(off)>1e-9)return normalize(off);
    }
    return normalize(fallback||{x:1,y:0,z:0});
  }

  lineHalfWidthModel(viewer,line,options){
    const explicit=finiteNumber(line.modelWidth||line.worldWidth||options&&options.modelWidth||options&&options.worldWidth,NaN);
    const width=Number.isFinite(explicit)?explicit:finiteNumber(line.width||options&&options.linewidth,DEFAULT_LINE_WIDTH)*MODEL_UNITS_PER_LINE_WIDTH;
    const minPx=finiteNumber(line.minPixelWidth||options&&options.minPixelWidth,MIN_SCREEN_LINE_WIDTH);
    const maxPx=finiteNumber(line.maxPixelWidth||options&&options.maxPixelWidth,MAX_SCREEN_LINE_WIDTH);
    return this.clampModelSize(viewer,width/2,minPx/2,maxPx/2);
  }

  pointRadiusModel(viewer,point,options){
    const explicit=finiteNumber(point.modelRadius||point.worldRadius||options&&options.modelRadius||options&&options.worldRadius,NaN);
    const radius=Number.isFinite(explicit)?explicit:finiteNumber(point.radius||options&&options.pointRadius||options&&options.linewidth,DEFAULT_LINE_WIDTH)*MODEL_UNITS_PER_LINE_WIDTH;
    const minPx=finiteNumber(point.minPixelRadius||options&&options.minPixelRadius,MIN_SCREEN_POINT_RADIUS);
    const maxPx=finiteNumber(point.maxPixelRadius||options&&options.maxPixelRadius,MAX_SCREEN_POINT_RADIUS);
    return this.clampModelSize(viewer,radius,minPx,maxPx);
  }

  writeLineQuad(viewer,entry,projected){
    const line=entry.item.data, a=line.start, b=line.end, pa=projected[entry.coordOffset], pb=projected[entry.coordOffset+1];
    if(!pa||!pb||!Number.isFinite(pa.x)||!Number.isFinite(pb.x))return;
    let dx=pb.x-pa.x, dy=pb.y-pa.y, len=Math.hypot(dx,dy);
    if(len<1e-4){ dx=1; dy=0; len=1; }
    const dir=this.screenDirection(viewer,-dy/len,dx/len,{x:0,y:1,z:0});
    const half=this.lineHalfWidthModel(viewer,line,entry.item.options);
    const off=scale(dir,half), bond=sub(b,a), bondLen=length(bond), bondDir=normalize(bond);
    const cap=Math.min(half*LINE_CAP_OVERLAP,bondLen*0.08);
    const a0={x:a.x-bondDir.x*cap,y:a.y-bondDir.y*cap,z:a.z-bondDir.z*cap};
    const b0={x:b.x+bondDir.x*cap,y:b.y+bondDir.y*cap,z:b.z+bondDir.z*cap};
    const v0={x:a0.x+off.x,y:a0.y+off.y,z:a0.z+off.z};
    const v1={x:a0.x-off.x,y:a0.y-off.y,z:a0.z-off.z};
    const v2={x:b0.x+off.x,y:b0.y+off.y,z:b0.z+off.z};
    const v3={x:b0.x-off.x,y:b0.y-off.y,z:b0.z-off.z};
    const n=normalize(cross(sub(b,a),off));
    this.writeVertex(entry.group,entry.base,v0,n);
    this.writeVertex(entry.group,entry.base+1,v1,n);
    this.writeVertex(entry.group,entry.base+2,v2,n);
    this.writeVertex(entry.group,entry.base+3,v3,n);
  }

  writePointQuad(viewer,entry){
    const p=entry.item.data, radius=this.pointRadiusModel(viewer,p,entry.item.options);
    const ox=scale(this.screenDirection(viewer,1,0,{x:1,y:0,z:0}),radius), oy=scale(this.screenDirection(viewer,0,1,{x:0,y:1,z:0}),radius);
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
