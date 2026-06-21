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

// 3Dmol's internal Coloring enum is not exported on window.$3Dmol.
const VERTEX_COLORS = 2;
const DEFAULT_LINE_WIDTH = 2;
const MODEL_UNITS_PER_POINT_RADIUS = 0.045;
const MIN_SCREEN_LINE_WIDTH = 2.0;
const MAX_SCREEN_LINE_WIDTH = 8.0;
const LINE_WIDTH_FAR_PX_PER_WORLD = 12.0;
const LINE_WIDTH_NEAR_PX_PER_WORLD = 90.0;
const MIN_SCREEN_POINT_RADIUS = 0.10;
const MAX_SCREEN_POINT_RADIUS = 2.12;
const LINE_CAP_OVERLAP = 0.55;

const WIDE_LINE_VERTEX_SHADER = `
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float vWidth;
uniform float vHeight;

attribute vec3 position;
attribute vec3 normal;
attribute vec3 color;
attribute float radius;

varying vec3 vColor;
varying vec4 mvPosition;

const float MIN_LINE_FULL_PX = ${Number(MIN_SCREEN_LINE_WIDTH).toFixed(4)};
const float MAX_LINE_FULL_PX = ${Number(MAX_SCREEN_LINE_WIDTH).toFixed(4)};
const float LINE_WIDTH_FAR_PX_PER_WORLD = ${Number(LINE_WIDTH_FAR_PX_PER_WORLD).toFixed(4)};
const float LINE_WIDTH_NEAR_PX_PER_WORLD = ${Number(LINE_WIDTH_NEAR_PX_PER_WORLD).toFixed(4)};
const float MIN_POINT_RADIUS_PX = ${Number(MIN_SCREEN_POINT_RADIUS).toFixed(4)};
const float MAX_POINT_RADIUS_PX = ${Number(MAX_SCREEN_POINT_RADIUS).toFixed(4)};
const float LINE_CAP_OVERLAP_PX = ${Number(LINE_CAP_OVERLAP).toFixed(4)};

float worldToPixels(float worldSize, float depth) {
  float safeDepth = max(0.0001, abs(depth));
  return abs(worldSize) * projectionMatrix[1][1] * vHeight / (2.0 * safeDepth);
}

float pixelsPerWorldUnit(float depth) {
  float safeDepth = max(0.0001, abs(depth));
  return projectionMatrix[1][1] * vHeight / (2.0 * safeDepth);
}

void main() {
  vColor = color;
  vec2 pixelToNdc = vec2(2.0 / max(vWidth, 1.0), 2.0 / max(vHeight, 1.0));
  mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mvPosition;

  if(abs(radius) < 0.0000001) {
    float pointPx = clamp(worldToPixels(normal.z, mvPosition.z), MIN_POINT_RADIUS_PX, MAX_POINT_RADIUS_PX);
    clip.xy += normal.xy * pointPx * pixelToNdc * clip.w;
    gl_Position = clip;
    return;
  }

  vec4 otherMv = modelViewMatrix * vec4(normal, 1.0);
  vec4 otherClip = projectionMatrix * otherMv;
  vec2 here = clip.xy / clip.w;
  vec2 there = otherClip.xy / otherClip.w;
  vec2 alongPx = (here - there) * vec2(vWidth * 0.5, vHeight * 0.5);
  float screenLen = length(alongPx);
  if(screenLen < 0.000001) alongPx = vec2(1.0, 0.0);
  else alongPx /= screenLen;
  vec2 sidePx = vec2(-alongPx.y, alongPx.x) * sign(radius);
  float zoomT = smoothstep(LINE_WIDTH_FAR_PX_PER_WORLD, LINE_WIDTH_NEAR_PX_PER_WORLD, pixelsPerWorldUnit(mvPosition.z));
  float requestedFullPx = max(1.0, abs(radius) * 2.0);
  float fullPx = clamp(requestedFullPx * mix(1.0, 4.0, zoomT), MIN_LINE_FULL_PX, MAX_LINE_FULL_PX);
  float halfPx = fullPx * 0.5;
  vec2 offsetPx = sidePx * halfPx + alongPx * (halfPx * LINE_CAP_OVERLAP_PX);
  clip.xy += offsetPx * pixelToNdc * clip.w;
  gl_Position = clip;
}
`.trim();

const WIDE_LINE_FRAGMENT_SHADER = `
uniform float opacity;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

varying vec3 vColor;
varying vec4 mvPosition;

//DEFINEFRAGCOLOR
void main() {
  gl_FragColor = vec4(vColor, opacity);
  if(fogNear != fogFar) {
    float depth = -mvPosition.z;
    float fogFactor = smoothstep(fogNear, fogFar, depth);
    gl_FragColor = mix(gl_FragColor, vec4(fogColor, gl_FragColor.w), fogFactor);
  }
}
`.trim();

function cloneWideLineUniforms(){
  return {
    opacity:{type:'f',value:1},
    fogColor:{type:'c',value:{r:1,g:1,b:1}},
    fogNear:{type:'f',value:1},
    fogFar:{type:'f',value:2000}
  };
}

class MolWideLineLayer{
  constructor(host,getViewer){
    this.host=host;
    this.getViewer=getViewer;
    this.collections=new Map();
    this.mesh=null;
    this.geometry=null;
    this.material=null;
    this.itemsCache=[];
    this.itemsDirty=true;
    this.meshDirty=true;
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
    const hookNames=(typeof viewer.show==='function')?['show']:['render'];
    hookNames.forEach(function(name){
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
    this.markDirty();
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
    this.markDirty();
  }

  clearCollection(id){
    this.collections.delete(String(id));
    this.markDirty();
  }

  clearCollections(prefix){
    const p=String(prefix);
    Array.from(this.collections.keys()).forEach(id=>{ if(id.indexOf(p)===0)this.collections.delete(id); });
    this.markDirty();
  }

  clear(){
    this.collections.clear();
    this.itemsCache=[];
    this.markDirty();
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

  markDirty(){
    this.itemsDirty=true;
    this.meshDirty=true;
  }

  flattenedItems(){
    if(this.itemsDirty){
      this.itemsCache=this.allItems();
      this.itemsDirty=false;
    }
    return this.itemsCache;
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
    this.geometry=new this.Geometry(true,true);
    this.material=this.createWideLineMaterial();
    this.material.depthTest=true;
    this.material.depthWrite=true;
    this.material.transparent=false;
    this.material.needsUpdate=true;
    this.mesh=new this.Mesh(this.geometry,this.material);
    this.mesh.name='MolWideLineMesh';
    this.mesh.__molWideLineMesh=true;
    this.mesh.visible=true;
    items.forEach(item=>{
      const group=this.geometry.updateGeoGroup(4);
      const base=group.vertices;
      const color=colorValue(item.data.color||item.options.color);
      if(item.type==='line')this.fillLineQuad(group,base,item,color);
      else this.fillPointQuad(group,base,item,color);
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

  createWideLineMaterial(){
    const material=new this.Material({color:'#ffffff'});
    material.shaderID='';
    material.vertexShader=WIDE_LINE_VERTEX_SHADER;
    material.fragmentShader=WIDE_LINE_FRAGMENT_SHADER;
    material.uniforms=cloneWideLineUniforms();
    material.vertexColors=VERTEX_COLORS;
    material.depthTest=true;
    material.depthWrite=true;
    material.transparent=false;
    material.opacity=1;
    material.needsUpdate=true;
    const Material=this.Material;
    material.clone=function(){
      const clone=new Material({color:'#ffffff'});
      clone.shaderID='';
      clone.vertexShader=WIDE_LINE_VERTEX_SHADER;
      clone.fragmentShader=WIDE_LINE_FRAGMENT_SHADER;
      clone.uniforms=cloneWideLineUniforms();
      clone.vertexColors=VERTEX_COLORS;
      clone.depthTest=material.depthTest;
      clone.depthWrite=material.depthWrite;
      clone.transparent=material.transparent;
      clone.opacity=material.opacity;
      clone.visible=material.visible;
      clone.side=material.side;
      clone.wireframe=material.wireframe;
      clone.needsUpdate=true;
      return clone;
    };
    return material;
  }

  fillQuadIndices(group,base){
    const fi=group.faceidx;
    group.faceArray[fi]=base;
    group.faceArray[fi+1]=base+2;
    group.faceArray[fi+2]=base+1;
    group.faceArray[fi+3]=base+2;
    group.faceArray[fi+4]=base+3;
    group.faceArray[fi+5]=base+1;
  }

  fillColor(group,base,color){
    const ci=base*3;
    for(let i=0;i<4;i++){
      const p=ci+i*3;
      group.colorArray[p]=color.r;
      group.colorArray[p+1]=color.g;
      group.colorArray[p+2]=color.b;
    }
  }

  writePoint(group,idx,p){
    const vi=idx*3;
    group.vertexArray[vi]=p.x;
    group.vertexArray[vi+1]=p.y;
    group.vertexArray[vi+2]=p.z;
  }

  writeOther(group,idx,p){
    const vi=idx*3;
    group.normalArray[vi]=p.x;
    group.normalArray[vi+1]=p.y;
    group.normalArray[vi+2]=p.z;
  }

  linePixelHalf(line,options){
    const width=finiteNumber(line.width||options&&options.linewidth,DEFAULT_LINE_WIDTH);
    return Math.max(0.5,width/2);
  }

  pointWorldRadius(point,options){
    const explicit=finiteNumber(point.modelRadius||point.worldRadius||options&&options.modelRadius||options&&options.worldRadius,NaN);
    const radius=Number.isFinite(explicit)?explicit:finiteNumber(point.radius||options&&options.pointRadius||options&&options.linewidth,DEFAULT_LINE_WIDTH)*MODEL_UNITS_PER_POINT_RADIUS;
    return Math.max(0.001,radius);
  }

  fillLineQuad(group,base,item,color){
    this.fillQuadIndices(group,base);
    this.fillColor(group,base,color);
    const line=item.data, a=line.start, b=line.end, half=this.linePixelHalf(line,item.options);
    this.writePoint(group,base,a);
    this.writePoint(group,base+1,a);
    this.writePoint(group,base+2,b);
    this.writePoint(group,base+3,b);
    this.writeOther(group,base,b);
    this.writeOther(group,base+1,b);
    this.writeOther(group,base+2,a);
    this.writeOther(group,base+3,a);
    group.radiusArray[base]=half;
    group.radiusArray[base+1]=-half;
    group.radiusArray[base+2]=-half;
    group.radiusArray[base+3]=half;
  }

  fillPointQuad(group,base,item,color){
    this.fillQuadIndices(group,base);
    this.fillColor(group,base,color);
    const point=item.data, radius=this.pointWorldRadius(point,item.options);
    for(let i=0;i<4;i++)this.writePoint(group,base+i,point);
    const corners=[[-1,-1],[1,-1],[-1,1],[1,1]];
    for(let i=0;i<4;i++){
      const vi=(base+i)*3;
      group.normalArray[vi]=corners[i][0];
      group.normalArray[vi+1]=corners[i][1];
      group.normalArray[vi+2]=radius;
      group.radiusArray[base+i]=0;
    }
  }

  syncToScene(){
    const viewer=this.getViewer&&this.getViewer();
    if(!viewer||!viewer.modelGroup)return;
    const items=this.flattenedItems();
    if(!items.length){
      if(this.mesh)this.mesh.visible=false;
      return;
    }
    if(this.meshDirty||!this.mesh){
      if(!this.ensureMesh(viewer,items))return;
      this.meshDirty=false;
    }
    if(!this.mesh)return;
    this.mesh.visible=true;
  }
}

window.MolWideLineLayer=MolWideLineLayer;
})();
