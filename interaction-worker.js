(function(){
'use strict';

const WATER_NAMES = new Set(['HOH','WAT','DOD','H2O']);
const ION_NAMES = new Set(['NA','CL','K','MG','CA','ZN','MN','FE','CU','CO','NI','CD','HG','SR','BA','CS','RB','LI','AL','IOD','BR']);
const BACKBONE_ATOMS = new Set(['N','CA','C','O','OXT']);
const AROMATIC_DEFS = {
  PHE:['CG','CD1','CD2','CE1','CE2','CZ'],
  TYR:['CG','CD1','CD2','CE1','CE2','CZ'],
  TRP:['CD2','CE2','CE3','CZ2','CZ3','CH2'],
  HIS:['CG','ND1','CD2','CE1','NE2'],
  HIE:['CG','ND1','CD2','CE1','NE2'],
  HID:['CG','ND1','CD2','CE1','NE2'],
  HIP:['CG','ND1','CD2','CE1','NE2']
};
const VDW = {H:1.20,C:1.70,N:1.55,O:1.52,S:1.80,P:1.80,F:1.47,CL:1.75,BR:1.85,I:1.98,ZN:1.39,FE:1.56,MG:1.73,CA:2.31,NA:2.27,K:2.75,MN:1.61,CU:1.40,CO:1.50,NI:1.49,SE:1.90};

const DEFAULT_CRITERIA = {
  hbond:{indexMaxDistance:4.0,maxDistance:2.8,minDonorAngle:120,minAcceptorAngle:90,maxAcceptorAngle:360},
  halogen:{maxDistance:3.5,minDonorAngle:140,minAcceptorAngle:90,maxAcceptorAngle:360},
  salt:{indexCutoff:5.5,cutoff:5.0,excludeCovalentDepth:3},
  pication:{maxDistance:6.6,maxAngle:30},
  pipi:{faceMaxDistance:4.4,faceMaxAngle:30,edgeMaxDistance:5.5,edgeMinAngle:60},
  contact:{maxDistance:4.8,minDistance:2.0,goodCutoffRatio:1.3,badCutoffRatio:0.89,uglyCutoffRatio:0.75,maxInteractions:12000}
};

function mergePlain(base,extra){
  if(!extra||typeof extra!=='object'||Array.isArray(extra))return base;
  Object.keys(extra).forEach(k=>{
    const v=extra[k];
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      if(!base[k]||typeof base[k]!=='object'||Array.isArray(base[k]))base[k]={};
      mergePlain(base[k],v);
    }else if(v!==undefined)base[k]=v;
  });
  return base;
}
function clonePlain(v){ return JSON.parse(JSON.stringify(v)); }
function criteriaWith(input){ return mergePlain(clonePlain(DEFAULT_CRITERIA),input||{}); }
function normText(v){ return String(v==null?'':v).trim(); }
function normUpper(v){ return normText(v).toUpperCase(); }
function elemOf(a){ return normUpper(a.elem||a.element||a.atom||'').replace(/[^A-Z]/g,''); }
function atomName(a){ return normUpper(a.atom||''); }
function resName(a){ return normUpper(a.resn||''); }
function residueKey(a){ return (a.chain||'')+':'+(a.resi==null?'':a.resi)+':'+resName(a); }
function isWater(a){ return WATER_NAMES.has(resName(a)); }
function isProtein(a){ return !a.hetflag&&!isWater(a); }
function isLigand(a){ return !!a.hetflag&&!isWater(a)&&!ION_NAMES.has(resName(a)); }
function category(a){ if(isWater(a))return 'solvents'; if(isLigand(a))return 'ligands'; if(a.hetflag)return 'other'; return 'protein'; }
function point(a){ return {x:a.x,y:a.y,z:a.z}; }
function sub(a,b){ return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}; }
function dot(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function cross(a,b){ return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}; }
function len(v){ return Math.hypot(v.x,v.y,v.z); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z); }
function angleDeg(a,b,c){
  const v1=sub(a,b),v2=sub(c,b),d=len(v1)*len(v2);
  if(!d)return 0;
  const t=Math.max(-1,Math.min(1,dot(v1,v2)/d));
  return Math.acos(t)*180/Math.PI;
}
function normalOf(a,b,c){
  const n=cross(sub(b,a),sub(c,a)),d=len(n)||1;
  return {x:n.x/d,y:n.y/d,z:n.z/d};
}
function centroid(list){
  const p={x:0,y:0,z:0};
  list.forEach(a=>{ p.x+=a.x; p.y+=a.y; p.z+=a.z; });
  const n=list.length||1;
  return {x:p.x/n,y:p.y/n,z:p.z/n};
}
function serialKey(a,b){ const x=Number(a.serial)||0,y=Number(b.serial)||0; return x<y?x+':'+y:y+':'+x; }
function vdwOf(a){ return VDW[elemOf(a)]||1.7; }

function buildMaps(atoms){
  const bySerial=new Map(),bondMap=new Map(),byIndex=new Map();
  atoms.forEach(a=>{
    bySerial.set(a.serial,a);
    if(a.index!=null)byIndex.set(a.index,a);
  });
  atoms.forEach(a=>{
    const set=new Set();
    (a.bonds||[]).forEach(s=>{ if(s!=null)set.add(s); });
    bondMap.set(a.serial,set);
  });
  return {bySerial,bondMap,byIndex};
}
function bondedAtoms(a,maps){
  const set=maps.bondMap.get(a.serial);
  if(!set)return [];
  const out=[];
  set.forEach(s=>{ const b=maps.bySerial.get(s); if(b)out.push(b); });
  return out;
}
function covalentWithin(a,b,maps,maxDepth){
  if(!maxDepth||a.serial==null||b.serial==null)return false;
  let frontier=[a.serial],seen=new Set(frontier);
  for(let depth=0;depth<maxDepth;depth++){
    const next=[];
    for(const s of frontier){
      const bonds=maps.bondMap.get(s);
      if(!bonds)continue;
      if(bonds.has(b.serial))return true;
      bonds.forEach(t=>{ if(!seen.has(t)){ seen.add(t); next.push(t); } });
    }
    frontier=next;
    if(!frontier.length)break;
  }
  return false;
}
function gridPairs(listA,listB,maxDist,minDist,pred,limit){
  const cell=maxDist||1,grid=new Map(),same=listA===listB,out=[],seen=new Set();
  listB.forEach(b=>{
    const ix=Math.floor(b.x/cell),iy=Math.floor(b.y/cell),iz=Math.floor(b.z/cell);
    const k=ix+','+iy+','+iz;
    if(!grid.has(k))grid.set(k,[]);
    grid.get(k).push(b);
  });
  const max2=maxDist*maxDist,min2=(minDist||0)*(minDist||0);
  for(const a of listA){
    const ix=Math.floor(a.x/cell),iy=Math.floor(a.y/cell),iz=Math.floor(a.z/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
      const bucket=grid.get((ix+dx)+','+(iy+dy)+','+(iz+dz));
      if(!bucket)continue;
      for(const b of bucket){
        if(a===b||a.serial===b.serial)continue;
        const key=serialKey(a,b);
        if(same&&seen.has(key))continue;
        if(pred&&!pred(a,b))continue;
        const d2=(a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z);
        if(d2<min2||d2>max2)continue;
        seen.add(key);
        out.push([a,b,Math.sqrt(d2)]);
        if(limit&&out.length>=limit)return out;
      }
    }
  }
  return out;
}

function firstResiduesByChain(atoms){
  const out=new Map();
  atoms.filter(isProtein).forEach(a=>{
    const c=a.chain||'';
    const cur=out.get(c);
    const r=Number(a.resi);
    if(!cur||Number.isFinite(r)&&r<cur)out.set(c,r);
  });
  return out;
}
function isCation(a,firstResi){
  const r=resName(a),n=atomName(a),e=elemOf(a);
  if(e==='N'&&r==='LYS'&&n==='NZ')return true;
  if(e==='N'&&r==='ARG'&&n==='NH2')return true;
  if(e==='N'&&['HIP','HSP'].includes(r)&&['ND1','NE2'].includes(n))return true;
  if(e==='N'&&BACKBONE_ATOMS.has(n)&&Number(a.resi)===firstResi.get(a.chain||''))return true;
  if(e==='N'&&r==='LBN'&&n==='N1')return true;
  return false;
}
function isAnion(a){
  const r=resName(a),n=atomName(a),e=elemOf(a);
  if(e!=='O')return false;
  if(r==='ASP'&&n==='OD2')return true;
  if(r==='GLU'&&n==='OE2')return true;
  if(n==='OXT')return true;
  if(a.hetflag&&r==='HEM'&&['O2A','O2D'].includes(n))return true;
  if(a.hetflag&&r==='LBN'&&n==='O3')return true;
  return false;
}
function isHbondAcceptor(a){
  const e=elemOf(a),r=resName(a),n=atomName(a);
  if(isWater(a)||!['N','O','S'].includes(e))return false;
  if(r==='LYS'&&n==='NZ')return false;
  if(r==='ARG'&&['NE','NH1','NH2'].includes(n))return false;
  return true;
}
function hDonorHeavy(h,maps){
  if(elemOf(h)!=='H')return null;
  return bondedAtoms(h,maps).find(a=>['N','O','S'].includes(elemOf(a)))||null;
}
function acceptorAngleOk(donorPoint,acceptor,maps,minAngle,maxAngle){
  const neighbors=bondedAtoms(acceptor,maps).filter(a=>elemOf(a)!=='H');
  if(!neighbors.length)return true;
  return neighbors.some(n=>{
    const ang=angleDeg(donorPoint,acceptor,n);
    return ang>=minAngle&&ang<=maxAngle;
  });
}
function detectHBonds(atoms,maps,criteria){
  const c=criteria.hbond,hAtoms=atoms.filter(a=>hDonorHeavy(a,maps)),acceptors=atoms.filter(isHbondAcceptor),out=[];
  const hBySerial=new Map();
  hAtoms.forEach(h=>hBySerial.set(h.serial,hDonorHeavy(h,maps)));
  gridPairs(hAtoms,acceptors,c.indexMaxDistance||c.maxDistance,0,function(h,a){
    const donor=hBySerial.get(h.serial);
    if(!donor||donor.serial===a.serial||residueKey(donor)===residueKey(a))return false;
    if(covalentWithin(donor,a,maps,3))return false;
    if(angleDeg(donor,h,a)<c.minDonorAngle)return false;
    if(!acceptorAngleOk(h,a,maps,c.minAcceptorAngle,c.maxAcceptorAngle))return false;
    return true;
  }).forEach(p=>{
    const h=p[0],a=p[1],donor=hBySerial.get(h.serial);
    out.push({a:donor.serial,b:a.serial,h:h.serial,distance:p[2],ca:category(donor),cb:category(a),ra:residueKey(donor),rb:residueKey(a)});
  });
  return out;
}
function detectHalogen(atoms,maps,criteria){
  const c=criteria.halogen,halogens=atoms.filter(a=>['CL','BR','I'].includes(elemOf(a))),acceptors=atoms.filter(isHbondAcceptor),out=[];
  const alpha=new Map();
  halogens.forEach(x=>alpha.set(x.serial,bondedAtoms(x,maps).find(a=>elemOf(a)!=='H')||null));
  gridPairs(halogens,acceptors,c.maxDistance,0,function(x,a){
    const base=alpha.get(x.serial);
    if(!base||residueKey(x)===residueKey(a))return false;
    if(covalentWithin(x,a,maps,3))return false;
    if(angleDeg(base,x,a)<c.minDonorAngle)return false;
    if(!acceptorAngleOk(x,a,maps,c.minAcceptorAngle,c.maxAcceptorAngle))return false;
    return true;
  }).forEach(p=>out.push({a:p[0].serial,b:p[1].serial,distance:p[2],ca:category(p[0]),cb:category(p[1]),ra:residueKey(p[0]),rb:residueKey(p[1])}));
  return out;
}
function detectSalt(atoms,maps,criteria,firstResi){
  const c=criteria.salt,cats=atoms.filter(a=>isCation(a,firstResi)),anis=atoms.filter(isAnion),out=[];
  gridPairs(anis,cats,c.indexCutoff||c.cutoff,0,function(a,b){
    const sameResidue=residueKey(a)===residueKey(b);
    const sameLigandSalt=sameResidue&&a.hetflag&&b.hetflag&&resName(a)==='LBN'&&resName(b)==='LBN';
    if(sameLigandSalt)return true;
    if(sameResidue)return false;
    return !covalentWithin(a,b,maps,c.excludeCovalentDepth||0);
  }).forEach(p=>out.push({a:p[0].serial,b:p[1].serial,distance:p[2],ca:category(p[0]),cb:category(p[1]),ra:residueKey(p[0]),rb:residueKey(p[1])}));
  return out;
}
function aromaticRings(atoms){
  const by=new Map();
  atoms.forEach(a=>{
    const r=resName(a),def=AROMATIC_DEFS[r];
    if(!def||!def.includes(atomName(a)))return;
    const k=(a.chain||'')+':'+a.resi+':'+r;
    if(!by.has(k))by.set(k,[]);
    by.get(k).push(a);
  });
  const rings=[];
  by.forEach(list=>{
    const def=AROMATIC_DEFS[resName(list[0])];
    const ordered=def.map(name=>list.find(a=>atomName(a)===name)).filter(Boolean);
    if(ordered.length<5)return;
    const c=centroid(ordered),n=normalOf(ordered[0],ordered[1],ordered[ordered.length-1]);
    rings.push({atom:ordered[0],atoms:ordered.map(a=>a.serial),center:c,normal:n,category:category(ordered[0]),residue:residueKey(ordered[0])});
  });
  return rings;
}
function faceAngle(ring,atom){
  const v=sub(point(atom),ring.center),d=len(v)||1;
  const cos=Math.max(-1,Math.min(1,Math.abs(dot(v,ring.normal)/d)));
  return Math.acos(cos)*180/Math.PI;
}
function ringPlaneAngle(a,b){
  const cos=Math.max(-1,Math.min(1,Math.abs(dot(a.normal,b.normal))));
  return Math.acos(cos)*180/Math.PI;
}
function detectPiCation(rings,atoms,criteria,firstResi){
  const c=criteria.pication,cats=atoms.filter(a=>isCation(a,firstResi)),out=[];
  rings.forEach(r=>{
    cats.forEach(cat=>{
      if(r.residue===residueKey(cat))return;
      const d=dist(r.center,cat);
      if(d>c.maxDistance)return;
      const ang=faceAngle(r,cat);
      if(ang>c.maxAngle)return;
      out.push({ringAtom:r.atom.serial,cat:cat.serial,center:r.center,distance:d,angle:ang,ca:r.category,cb:category(cat),ra:r.residue,rb:residueKey(cat)});
    });
  });
  return out;
}
function detectPiPi(rings,criteria){
  const c=criteria.pipi,out=[];
  for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++){
    const a=rings[i],b=rings[j];
    if(a.residue===b.residue)continue;
    const d=dist(a.center,b.center),ang=ringPlaneAngle(a,b);
    const face=d<=c.faceMaxDistance&&ang<=c.faceMaxAngle;
    const edge=d<=c.edgeMaxDistance&&ang>=c.edgeMinAngle;
    if(!face&&!edge)continue;
    out.push({ringAtomA:a.atom.serial,ringAtomB:b.atom.serial,centerA:a.center,centerB:b.center,distance:d,angle:ang,kind:face?'face':'edge',ca:a.category,cb:b.category,ra:a.residue,rb:b.residue});
  }
  return out;
}
function detectContacts(atoms,maps,criteria){
  const c=criteria.contact,heavy=atoms.filter(a=>elemOf(a)!=='H'&&!isWater(a)),out={good:[],bad:[],ugly:[]};
  gridPairs(heavy,heavy,c.maxDistance,c.minDistance,function(a,b){
    return residueKey(a)!==residueKey(b)&&!covalentWithin(a,b,maps,3);
  },c.maxInteractions).forEach(p=>{
    const ratio=p[2]/(vdwOf(p[0])+vdwOf(p[1]));
    const item={a:p[0].serial,b:p[1].serial,distance:p[2],ratio,ca:category(p[0]),cb:category(p[1]),ra:residueKey(p[0]),rb:residueKey(p[1])};
    if(ratio<c.uglyCutoffRatio)out.ugly.push(item);
    else if(ratio<c.badCutoffRatio)out.bad.push(item);
    else if(ratio<=c.goodCutoffRatio)out.good.push(item);
  });
  return out;
}

function buildIndex(payload){
  const started=Date.now(),atoms=(payload.atoms||[]).filter(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.z)&&a.serial!=null);
  const criteria=criteriaWith(payload.criteria),maps=buildMaps(atoms),firstResi=firstResiduesByChain(atoms),rings=aromaticRings(atoms);
  const interactions={
    hbond:detectHBonds(atoms,maps,criteria),
    halogen:detectHalogen(atoms,maps,criteria),
    salt:detectSalt(atoms,maps,criteria,firstResi),
    pipi:detectPiPi(rings,criteria),
    pication:detectPiCation(rings,atoms,criteria,firstResi),
    contacts:detectContacts(atoms,maps,criteria)
  };
  return {jobId:payload.jobId,criteria,elapsedMs:Date.now()-started,atoms:atoms.length,rings:rings.length,interactions};
}

self.onmessage=function(e){
  try{
    self.postMessage(buildIndex(e.data||{}));
  }catch(err){
    self.postMessage({jobId:e.data&&e.data.jobId,error:err&&err.message?err.message:String(err)});
  }
};
})();
