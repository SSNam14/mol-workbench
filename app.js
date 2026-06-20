(function(){
'use strict';
function boot(){
  const $ = id => document.getElementById(id);
  const viewerEl = $('viewer');
  const dragSelectBoxEl = $('dragSelectBox');
  const statusEl = $('status');

  let viewer = null, model = null, atoms = [], atomByIndex = new Map(), currentName = '', savedView = null, idSeq = 1, hoverClearTimer = null;
  const entries = [];
  let displayedCount = 0;

  const waterNames = new Set(['HOH','WAT','DOD','H2O']);
  const ionNames = new Set(['NA','CL','K','MG','CA','ZN','MN','FE','CU','CO','NI','CD','HG','SR','BA','CS','RB','LI','AL','IOD','BR']);
  const backboneAtoms = new Set(['N','CA','C','O','OXT']);
  const aa3to1 = {ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',HIE:'H',HID:'H',HIP:'H',ILE:'I',LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V',MSE:'M',SEC:'U',PYL:'O'};
  const aromaticDefs = {PHE:['CG','CD1','CD2','CE1','CE2','CZ'],TYR:['CG','CD1','CD2','CE1','CE2','CZ'],TRP:['CD2','CE2','CE3','CZ2','CZ3','CH2'],HIS:['CG','ND1','CD2','CE1','NE2'],HIE:['CG','ND1','CD2','CE1','NE2'],HID:['CG','ND1','CD2','CE1','NE2'],HIP:['CG','ND1','CD2','CE1','NE2']};
  const chainPalette = ['#4FC3F7','#FFB74D','#81C784','#BA68C8','#E57373','#4DB6AC','#FFD54F','#7986CB','#F06292','#A1887F','#90A4AE','#AED581','#9575CD','#4DD0E1','#FF8A65','#64B5F6','#DCE775','#F48FB1','#80CBC4','#B0BEC5','#CE93D8','#FFF176','#A5D6A7','#EF9A9A','#9FA8DA','#FFCC80'];
  const chainColors = {};
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch,i) => { chainColors[ch] = chainPalette[i % chainPalette.length]; });
  const elemColors = {H:'#FFFFFF',C:'#B0BEC5',N:'#64B5F6',O:'#EF5350',S:'#FDD835',P:'#FFB74D',F:'#81C784',CL:'#81C784',BR:'#A1887F',I:'#9575CD',FE:'#FF8A65',ZN:'#90A4AE',MG:'#A5D6A7',CA:'#B0BEC5',NA:'#90CAF9',K:'#CE93D8',MN:'#CE93D8',CU:'#4DD0E1',CO:'#F48FB1',NI:'#80CBC4'};
  const lineWidths = {fallback:2,selection:2,protein:2,ligand:2,tube:2,interaction:2,interactionSolid:2};

  const tabs = ['Ligand Interaction','Protein Preparation','LigPrep','Receptor Grid Generation','Surface (Binding Site)','Minimize Selected','Quick Align','Measure','Molecular Dynamics','System Builder','Ligand Docking','MM-GBSA','Ligand Alignment','Minimization','Protein Structure Analysis'];

  const mousePresets = {'select-left':{buttons:{left:'select',right:'rotate',middle:'pan'},wheel:'zoom'},'default':{passThrough:true}};
  function defaultSelectionOptions(){ return {color:'#fdd835',opacity:1,linewidth:lineWidths.selection}; }
  const LARGE_SELECTOR_ARRAY_LIMIT = 32;
  const LARGE_SELECTION_STYLE_ATOM_LIMIT = 1500;
  const SELECTION_DRAW_BUDGET_MS = 10;
  const state = {
    baseProtein:'cartoon', proteinAtoms:'off', ligand:'stick',
    styleRules:[], hiddenRules:[], interactionRules:[],
    selectionSel:null, selectionRepresentation:'line', selectionOptions:defaultSelectionOptions(), selectionMode:'residue', rangeAnchor:null,
    focusTarget:null, mousePreset:'select-left',
    visibility:{protein:true,ligands:true,solvents:true,other:true}, chainVisible:{},
    bgColor:'#000000', carbonByChain:true, hbondCutoff:3.6, saltCutoff:4.2,
    locked:false
  };
  const defaultChainColors = Object.assign({}, chainColors);
  const settings = {mouse:{buttons:Object.assign({},mousePresets['select-left'].buttons), wheel:mousePresets['select-left'].wheel}};
  let findMatches = [], findIndex = -1;
  let seqResidues = [], seqResidueByKey = new Map(), activeSeqKeys = new Set();
  let selectionAtoms = [];
  let selectionStyleActive = false;
  let selectionShapes = [];
  let selectionHighlightJob = 0;
  let wideLineLayer = null;
  let interactionShapes = [];
  let interactionWideLines = [];
  let resetMouseDrag = function(){};

  function setStatus(t){ if(statusEl)statusEl.textContent = t || ''; }
  function nextId(p){ return p + '-' + (idSeq++); }
  function normText(v){ return String(v==null?'':v).trim(); }
  function normUpper(v){ return normText(v).toUpperCase(); }
  function atomElem(a){ return normUpper(a.elem||a.element||a.atom||'').replace(/[^A-Z]/g,''); }
  function chainColor(ch){ const c=normText(ch||'?'),u=c.toUpperCase(); if(chainColors[u])return chainColors[u]; let h=0; for(let i=0;i<c.length;i++)h=((h*31)+c.charCodeAt(i))>>>0; return 'hsl('+(h%360)+',72%,64%)'; }
  function elementColor(a){ return elemColors[atomElem(a)]||'#D1D5DB'; }
  function isProtein(a){ return !a.hetflag && !waterNames.has(normUpper(a.resn)); }
  function isLigand(a){ return !!a.hetflag && !waterNames.has(normUpper(a.resn)) && !ionNames.has(normUpper(a.resn)); }
  function isPolar(a){ return ['N','O','S'].includes(atomElem(a)); }
  function isPositive(a){ return atomElem(a)==='N' && /^(NZ|NH1|NH2|NE|NE2|ND1)$/i.test(a.atom||''); }
  function isNegative(a){ return atomElem(a)==='O' && /^(OD1|OD2|OE1|OE2|OXT|O1|O2|O3|O4)$/i.test(a.atom||''); }
  function point(a){ return {x:a.x,y:a.y,z:a.z}; }
  function dist2(a,b){ const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z; return dx*dx+dy*dy+dz*dz; }
  function distance(a,b){ return Math.sqrt(dist2(a,b)); }
  function atomCategory(a){ const r=normUpper(a.resn); if(waterNames.has(r))return 'solvents'; if(isLigand(a))return 'ligands'; if(a.hetflag)return 'other'; if(ionNames.has(r))return 'other'; return 'protein'; }
  function chainAwareAtomColor(a){ if(!a)return '#D1D5DB'; const e=atomElem(a); if(isProtein(a)&&(!e||e==='C'))return state.carbonByChain?chainColor(a.chain):elementColor(a); return elementColor(a); }
  function chainRibbonColor(a){ return chainColor(a&&a.chain); }
  function colorFnFromOptions(o,r){ const f=o&&o.color; if(f)return function(){return f;}; return r?chainRibbonColor:chainAwareAtomColor; }
  function styleSpec(rep,o){
    rep = normText(rep||'cartoon').toLowerCase(); o=o||{};
    const ac=colorFnFromOptions(o,false), rc=colorFnFromOptions(o,true), op=o.opacity==null?1:Number(o.opacity);
    if(rep==='hide'||rep==='off')return {};
    if(rep==='line')return {};
    if(rep==='stick')return {stick:{radius:o.radius||0.17,colorfunc:ac,opacity:op}};
    if(rep==='sphere')return {sphere:{scale:o.scale||0.3,colorfunc:ac,opacity:op}};
    if(rep==='cpk')return {stick:{radius:o.radius||0.12,colorfunc:ac,opacity:op},sphere:{scale:o.scale||0.25,colorfunc:ac,opacity:op}};
    if(rep==='tube')return {cartoon:{style:'trace',ribbon:true,thickness:o.thickness||0.45,colorfunc:rc,opacity:op}};
    return {cartoon:{colorfunc:rc,opacity:op}};
  }
  const selectorArrayCache = new WeakMap();
  function isResiRangeValue(value){ return typeof value==='string'&&/^-?\d+\s*-\s*-?\d+$/.test(value.trim()); }
  function canUseSelectorArraySet(want,key){
    return want.length>LARGE_SELECTOR_ARRAY_LIMIT&&want.every(x=>typeof x==='string'||typeof x==='number')&&!want.some(x=>key==='resi'&&isResiRangeValue(x));
  }
  function selectorArraySet(want,key,mode){
    let byKey=selectorArrayCache.get(want);
    if(!byKey){ byKey=new Map(); selectorArrayCache.set(want,byKey); }
    const cacheKey=key+':'+mode;
    if(!byKey.has(cacheKey)){
      const set=new Set();
      want.forEach(x=>{
        if(mode==='number'){
          const n=Number(x);
          if(!Number.isNaN(n))set.add(n);
        }else set.add(normUpper(x));
      });
      byKey.set(cacheKey,set);
    }
    return byKey.get(cacheKey);
  }
  function matchArray(av,want,key){
    if(canUseSelectorArraySet(want,key)){
      const mode=(key==='serial'||key==='index'||key==='resi'||typeof av==='number')?'number':'text';
      if(mode==='number'){
        const n=Number(av);
        return !Number.isNaN(n)&&selectorArraySet(want,key,mode).has(n);
      }
      return selectorArraySet(want,key,mode).has(normUpper(av));
    }
    return want.some(x=>matchScalar(av,x,key));
  }
  function proteinBackboneStyleSpec(){
    const r=state.baseProtein;
    if(r==='off'||r==='hide')return {};
    if(r==='tube')return {cartoon:{style:'trace',ribbon:true,thickness:0.45,colorfunc:chainRibbonColor}};
    return {cartoon:{colorfunc:chainRibbonColor,thickness:0.15}};
  }
  function proteinAtomStyleSpec(){
    const r=state.proteinAtoms;
    if(r==='line')return {};
    if(r==='stick')return {stick:{radius:0.14,colorfunc:chainAwareAtomColor}};
    if(r==='sphere')return {sphere:{scale:0.28,colorfunc:chainAwareAtomColor}};
    if(r==='cpk')return {stick:{radius:0.1,colorfunc:chainAwareAtomColor},sphere:{scale:0.23,colorfunc:chainAwareAtomColor}};
    return {};
  }
  function ligandStyleSpec(){ const r=state.ligand; if(r==='line')return {}; if(r==='sphere')return {sphere:{scale:0.36,colorfunc:elementColor}}; if(r==='cpk')return {stick:{radius:0.13,colorfunc:elementColor},sphere:{scale:0.3,colorfunc:elementColor}}; return {stick:{radius:0.2,colorfunc:elementColor}}; }

  function matchScalar(av,want,key){
    if(want==null)return true;
    if(Array.isArray(want))return matchArray(av,want,key);
    if(key==='resi'&&isResiRangeValue(want)){ const p=want.split('-').map(x=>Number(x.trim())),lo=Math.min(p[0],p[1]),hi=Math.max(p[0],p[1]),v=Number(av); return Number.isFinite(v)&&v>=lo&&v<=hi; }
    if(typeof want==='boolean')return Boolean(av)===want;
    if(typeof av==='number'||typeof want==='number')return Number(av)===Number(want);
    return normUpper(av)===normUpper(want);
  }
  function resolveSelector(sel){
    if(sel==null||typeof sel!=='object'||Array.isArray(sel))return {};
    const out={};
    Object.keys(sel).forEach(k=>{ const v=sel[k]; if(v===undefined||v===null)return; if(k==='not')out.not=resolveSelector(v); else if(k==='or')out.or=(Array.isArray(v)?v:[v]).map(resolveSelector); else if(k==='and')out.and=(Array.isArray(v)?v:[v]).map(resolveSelector); else out[k]=v; });
    return out;
  }
  function matchesResolvedSelector(a,sel){
    sel=sel||{};
    if(sel.not&&matchesResolvedSelector(a,sel.not))return false;
    if(sel.or&&!sel.or.some(p=>matchesResolvedSelector(a,p)))return false;
    if(sel.and&&!sel.and.every(p=>matchesResolvedSelector(a,p)))return false;
    const special=new Set(['not','or','and']);
    for(const k of Object.keys(sel)){ if(special.has(k))continue; let av=a[k]; if(k==='elem')av=atomElem(a); if(!matchScalar(av,sel[k],k))return false; }
    return true;
  }
  function serialsForSelector(sel,opts){
    const resolved=resolveSelector(sel), sc=opts&&opts.sidechainOnly, out=[];
    for(const a of atoms){ if(!matchesResolvedSelector(a,resolved))continue; if(sc&&(!isProtein(a)||backboneAtoms.has(a.atom)))continue; if(a.serial!=null)out.push(a.serial); }
    return out;
  }
  function isComplexSelector(s){ return !!(s&&typeof s==='object'&&(s.not||s.or||s.and)); }
  function styleSelection(sel,opts){ const r=resolveSelector(sel); if((opts&&opts.sidechainOnly)||isComplexSelector(r))return {serial:serialsForSelector(sel,opts)}; return r; }
  function uniqueSerials(list){
    const seen=new Set(),out=[];
    (list||[]).forEach(s=>{ if(s==null||seen.has(s))return; seen.add(s); out.push(s); });
    return out;
  }
  function serialsFromSelector(sel,opts){
    const r=resolveSelector(sel);
    if(!(opts&&opts.sidechainOnly)&&r.serial!=null&&Object.keys(r).length===1)return uniqueSerials(Array.isArray(r.serial)?r.serial:[r.serial]);
    return uniqueSerials(serialsForSelector(sel,opts));
  }
  function addSelectorSerials(set,sel,opts){ serialsFromSelector(sel,opts).forEach(s=>set.add(s)); }
  function isPureSerialSelector(sel){ return !!(sel&&typeof sel==='object'&&!Array.isArray(sel)&&sel.serial!=null&&Object.keys(sel).length===1); }
  function filterAtomsBySerial(want){
    if(Array.isArray(want)&&canUseSelectorArraySet(want,'serial')){
      const set=selectorArraySet(want,'serial','number');
      return atoms.filter(a=>{ const n=Number(a.serial); return !Number.isNaN(n)&&set.has(n); });
    }
    return atoms.filter(a=>matchScalar(a.serial,want,'serial'));
  }
  function filterAtoms(sel){
    const r=resolveSelector(sel||{});
    if(isPureSerialSelector(r))return filterAtomsBySerial(r.serial);
    return atoms.filter(a=>matchesResolvedSelector(a,r));
  }
  function residueUiKey(a){ return (a.chain||'')+':'+a.resi; }
  function selectedAtomsForSelector(sel){ return sel?filterAtoms(sel):[]; }
  function selectionInfo(sel,selected){
    const info={atomCount:0,residueCount:0,residueKeys:new Set()};
    if(!sel)return info;
    try{
      const source=selected||(sel===state.selectionSel?selectionAtoms:null);
      if(source){
        info.atomCount=source.length;
        source.forEach(a=>info.residueKeys.add(residueUiKey(a)));
      }else{
        const r=resolveSelector(sel);
        for(const a of atoms){ if(!matchesResolvedSelector(a,r))continue; info.atomCount++; info.residueKeys.add(residueUiKey(a)); }
      }
      info.residueCount=info.residueKeys.size;
    }catch(e){}
    return info;
  }
  function countAtoms(sel){ return selectionInfo(sel).atomCount; }
  function residueCount(sel){ return selectionInfo(sel).residueCount; }
  function combineSelectors(a,b){ const seen=new Set(); [a,b].forEach(s=>addSelectorSerials(seen,s,{})); return {serial:Array.from(seen)}; }
  function normalizeSelectorInput(s){ if(s==null)return {}; if(typeof s!=='object')return s; return s; }

  function applyVisibility(){
    const off=[];
    for(const a of atoms){ const c=atomCategory(a); if(!state.visibility[c]){off.push(a.serial);continue;} if(c==='protein'&&state.chainVisible[a.chain]===false)off.push(a.serial); }
    if(off.length)viewer.setStyle({serial:off},{});
    displayedCount = atoms.length - off.length;
  }
  function clearSelectionHighlight(){
    selectionHighlightJob++;
    if(wideLineLayer)wideLineLayer.clearCollection('selection');
    if(selectionStyleActive){
      selectionStyleActive=false;
      if(viewer&&model)applyStylesFull(false,{skipSelection:true,skipStatus:true,skipInteractions:true});
    }
    if(!viewer||!selectionShapes.length){ selectionShapes=[]; return; }
    selectionShapes.forEach(s=>{ try{ viewer.removeShape(s); }catch(e){} });
    selectionShapes=[];
  }
  function pushSelectionShape(shape){ if(shape)selectionShapes.push(shape); }
  function selectionShapeStyle(o){
    return {color:o.color||'#fdd835',opacity:o.opacity==null?1:Number(o.opacity),linewidth:o.linewidth||lineWidths.fallback};
  }
  function drawSelectionAtom(shape,a,o){
    const radius=Number(o.scale||Math.max((o.radius||0.06)*2.2,0.12));
    shape.addSphere({center:point(a),radius,color:o.color||'#fdd835',opacity:o.opacity==null?1:Number(o.opacity)});
  }
  function drawSelectionBond(shape,a,b,rep,o){
    const color=o.color||'#fdd835',opacity=o.opacity==null?1:Number(o.opacity);
    if(rep==='line')shape.addLine({start:point(a),end:point(b),color,opacity,linewidth:o.linewidth||lineWidths.fallback});
    else shape.addCylinder({start:point(a),end:point(b),radius:rep==='tube'?(o.thickness||0.12):(o.radius||0.06),color,opacity,fromCap:1,toCap:1});
  }
  function selectionStyleSpec(rep,o){
    const color=o.color||'#fdd835',opacity=o.opacity==null?1:Number(o.opacity),colorfunc=function(){return color;};
    if(rep==='sphere')return {sphere:{scale:o.scale||0.18,colorfunc,opacity}};
    if(rep==='line')return {};
    if(rep==='cpk')return {stick:{radius:o.radius||0.06,colorfunc,opacity},sphere:{scale:o.scale||0.18,colorfunc,opacity}};
    return {stick:{radius:rep==='tube'?(o.thickness||0.12):(o.radius||0.06),colorfunc,opacity}};
  }
  function applyLargeSelectionStyle(selected,rep,opts){
    const sel=serialSelectorForAtoms(selected);
    if(!sel)return false;
    viewer.addStyle(sel,selectionStyleSpec(rep,opts));
    selectionStyleActive=true;
    return true;
  }
  function selectionColorStyleSpec(rep,o){
    const color=o.color||'#fdd835',opacity=o.opacity==null?1:Number(o.opacity),colorfunc=function(){return color;};
    if(rep==='sphere')return {sphere:{scale:o.scale||0.32,colorfunc,opacity}};
    if(rep==='stick')return {stick:{radius:o.radius||0.16,colorfunc,opacity}};
    if(rep==='cpk')return {stick:{radius:o.radius||0.16,colorfunc,opacity},sphere:{scale:o.scale||0.32,colorfunc,opacity}};
    return selectionStyleSpec(rep,o);
  }
  function applySelectionStyleOverlay(selected,rep,opts){
    const sel=serialSelectorForAtoms(selected);
    if(!sel)return false;
    viewer.addStyle(sel,selectionColorStyleSpec(rep,opts));
    selectionStyleActive=true;
    return true;
  }
  function selectionBondData(selected){
    const selectedIndexes=new Set(),bondKeys=new Set(),bondedSerials=new Set(),bonds=[];
    selected.forEach(a=>{ if(a.index!=null)selectedIndexes.add(a.index); });
    selected.forEach(a=>{
      (a.bonds||[]).forEach(idx=>{
        const b=atomByIndex.get(idx);
        if(!b||!selectedIndexes.has(b.index))return;
        const ka=a.index<b.index?a.index+':'+b.index:b.index+':'+a.index;
        if(bondKeys.has(ka))return;
        bondKeys.add(ka);
        if(a.serial!=null)bondedSerials.add(a.serial);
        if(b.serial!=null)bondedSerials.add(b.serial);
        bonds.push([a,b]);
      });
    });
    return {bonds,looseAtoms:selected.filter(a=>a.serial==null||!bondedSerials.has(a.serial))};
  }
  function midpoint(a,b){ return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2}; }
  function lineColorForAtom(a,o,defaultColorFn){
    if(o.color)return o.color;
    if(o.colorfunc){ try{ return o.colorfunc(a); }catch(e){} }
    if(defaultColorFn)return defaultColorFn(a);
    return chainAwareAtomColor(a);
  }
  function appendWideBond(lines,a,b,o,defaultColorFn,widthDefault,dashed){
    const opacity=o.opacity==null?1:Number(o.opacity),width=Math.max(1,Number(o.linewidth||widthDefault||lineWidths.fallback));
    const ca=lineColorForAtom(a,o,defaultColorFn),cb=lineColorForAtom(b,o,defaultColorFn);
    if(ca===cb){
      lines.push({start:point(a),end:point(b),color:ca,width,opacity,dashed:!!dashed});
      return;
    }
    const mid=midpoint(a,b);
    lines.push({start:point(a),end:mid,color:ca,width,opacity,dashed:!!dashed});
    lines.push({start:mid,end:point(b),color:cb,width,opacity,dashed:!!dashed});
  }
  function appendWideAtomLines(lines,points,selected,o,defaultColorFn,widthDefault,dashed){
    const data=selectionBondData(selected);
    data.bonds.forEach(p=>appendWideBond(lines,p[0],p[1],o,defaultColorFn,widthDefault,dashed));
    const opacity=o.opacity==null?1:Number(o.opacity),width=Math.max(1,Number(o.linewidth||widthDefault||lineWidths.fallback));
    data.looseAtoms.forEach(a=>{
      const p=point(a);
      p.color=lineColorForAtom(a,o,defaultColorFn);
      p.opacity=opacity;
      p.radius=Math.max(2,width*0.6);
      points.push(p);
    });
  }
  function atomDisplayRepresentation(a){
    if(!isAtomVisibleNow(a))return 'none';
    let rep=null;
    for(const r of state.styleRules){
      if(r.disabled)continue;
      try{
        if(!matchesResolvedSelector(a,resolveSelector(r.selector)))continue;
        const next=normText(r.representation).toLowerCase();
        if(next==='hide'||next==='off')return 'none';
        if(ATOM_REPS.has(next))rep=next;
        else if(next==='tube')rep='line';
      }catch(e){}
    }
    if(rep)return rep;
    const base=a.hetflag?state.ligand:state.proteinAtoms;
    return ATOM_REPS.has(base)?base:'none';
  }
  function partitionSelectionByDisplay(selected){
    const groups={none:[],line:[],stick:[],sphere:[],cpk:[]};
    selected.forEach(a=>{
      const rep=atomDisplayRepresentation(a);
      if(groups[rep])groups[rep].push(a);
      else groups.none.push(a);
    });
    return groups;
  }
  function drawSelectionRepGroup(selected,rep,opts,job){
    if(!selected.length)return;
    if((rep==='stick'||rep==='sphere'||rep==='cpk')&&applySelectionStyleOverlay(selected,rep,opts))return;
    if(selected.length>LARGE_SELECTION_STYLE_ATOM_LIMIT&&applyLargeSelectionStyle(selected,rep,opts))return;
    const shape=viewer.addShape(selectionShapeStyle(opts));
    pushSelectionShape(shape);
    if(rep==='sphere')drawSelectionChunks(shape,[],selected,'sphere',opts,job);
    else{
      const data=selectionBondData(selected);
      drawSelectionChunks(shape,data.bonds,data.looseAtoms,rep,opts,job);
    }
  }
  function drawAdaptiveLineSelection(selected,o,job){
    if(!wideLineLayer)return false;
    const groups=partitionSelectionByDisplay(selected),lines=[],points=[],width=Math.max(1,Number(o.linewidth||lineWidths.selection));
    appendWideAtomLines(lines,points,groups.none,o,function(){ return o.color||'#fdd835'; },width,false);
    appendWideAtomLines(lines,points,groups.line,o,function(){ return o.color||'#fdd835'; },width,false);
    if(lines.length||points.length)wideLineLayer.setCollection('selection',lines,points,{color:o.color||'#fdd835',opacity:o.opacity==null?1:Number(o.opacity),linewidth:width,pointRadius:Math.max(2,width*0.6)});
    drawSelectionRepGroup(groups.stick,'stick',o,job);
    drawSelectionRepGroup(groups.sphere,'sphere',o,job);
    drawSelectionRepGroup(groups.cpk,'cpk',o,job);
    return !!(lines.length||points.length||groups.stick.length||groups.sphere.length||groups.cpk.length);
  }
  function addWideStyleAtoms(lines,points,sel,o,defaultColorFn,widthDefault,dashed){
    const selected=filterAtoms(sel).filter(isAtomVisibleNow);
    if(selected.length)appendWideAtomLines(lines,points,selected,o||{},defaultColorFn,widthDefault,dashed);
  }
  function redrawWideLineStyles(){
    if(!wideLineLayer)return;
    if(!model||!atoms.length){ wideLineLayer.clearCollection('styles'); return; }
    const lines=[],points=[];
    if(state.proteinAtoms==='line')addWideStyleAtoms(lines,points,{hetflag:false},{linewidth:lineWidths.protein},chainAwareAtomColor,lineWidths.protein,false);
    if(state.ligand==='line')addWideStyleAtoms(lines,points,{hetflag:true},{linewidth:lineWidths.ligand},elementColor,lineWidths.ligand,false);
    for(const r of state.styleRules){
      if(r.disabled)continue;
      const rep=normText(r.representation).toLowerCase(),opts=r.options||{};
      if(rep==='line')addWideStyleAtoms(lines,points,styleSelection(r.selector,opts),opts,chainAwareAtomColor,opts.linewidth||lineWidths.protein,false);
      else if(rep==='tube')addWideStyleAtoms(lines,points,styleSelection(r.selector,opts),opts,chainAwareAtomColor,opts.linewidth||lineWidths.tube,false);
    }
    wideLineLayer.setCollection('styles',lines,points,{linewidth:lineWidths.protein,opacity:1,pointRadius:lineWidths.fallback});
  }
  function drawSelectionChunks(shape,bonds,looseAtoms,rep,opts,job){
    let bi=0,ai=0;
    function consume(){
      const start=performance.now();
      while(bi<bonds.length&&(performance.now()-start)<SELECTION_DRAW_BUDGET_MS){
        const p=bonds[bi++]; drawSelectionBond(shape,p[0],p[1],rep,opts);
      }
      while(bi>=bonds.length&&ai<looseAtoms.length&&(performance.now()-start)<SELECTION_DRAW_BUDGET_MS){
        drawSelectionAtom(shape,looseAtoms[ai++],opts);
      }
      return bi<bonds.length||ai<looseAtoms.length;
    }
    const more=consume();
    if(more&&typeof requestAnimationFrame==='function'){
      requestAnimationFrame(function step(){
        if(job!==selectionHighlightJob)return;
        const hasMore=consume();
        viewer.render();
        if(hasMore)requestAnimationFrame(step);
      });
    }
  }
  function applySelectionHighlight(selectedAtomsOverride){
    clearSelectionHighlight();
    if(!viewer||!state.selectionSel||state.selectionRepresentation==='off')return;
    const rep=normText(state.selectionRepresentation||'line').toLowerCase(),opts=state.selectionOptions||{},selected=selectedAtomsOverride||selectedAtomsForSelector(state.selectionSel);
    if(!selected.length)return;
    const job=selectionHighlightJob;
    if(rep==='line'&&drawAdaptiveLineSelection(selected,opts,job))return;
    if(rep==='cpk'&&applySelectionStyleOverlay(selected,rep,opts))return;
    if(selected.length>LARGE_SELECTION_STYLE_ATOM_LIMIT&&applyLargeSelectionStyle(selected,rep,opts))return;
    const shape=viewer.addShape(selectionShapeStyle(opts));
    pushSelectionShape(shape);
    if(rep==='sphere'){
      drawSelectionChunks(shape,[],selected,'sphere',opts,job);
      return;
    }
    const data=selectionBondData(selected);
    drawSelectionChunks(shape,data.bonds,data.looseAtoms,rep,opts,job);
  }
  function renderSelectionHighlight(render,selectedAtomsOverride){
    if(!viewer||!model)return;
    applySelectionHighlight(selectedAtomsOverride);
    if(render!==false)viewer.render();
  }
  function applyStylesFull(render,opts){
    if(!viewer||!model)return;
    opts=opts||{};
    selectionStyleActive=false;
    viewer.setStyle({},{});
    viewer.setStyle({hetflag:false}, proteinBackboneStyleSpec());
    if(state.proteinAtoms!=='off')viewer.addStyle({hetflag:false}, proteinAtomStyleSpec());
    viewer.setStyle({hetflag:true}, ligandStyleSpec());
    viewer.setStyle({resn:Array.from(waterNames)},{});
    for(const r of state.styleRules){ if(r.disabled)continue; try{ viewer.addStyle(styleSelection(r.selector,r.options), styleSpec(r.representation,r.options)); }catch(e){} }
    for(const r of state.hiddenRules){ if(r.disabled)continue; try{ viewer.setStyle(styleSelection(r.selector,r.options),{}); }catch(e){} }
    applyVisibility();
    redrawWideLineStyles();
    if(!opts.skipInteractions)redrawInteractions(false);
    if(!opts.skipSelection){
      selectionAtoms=selectedAtomsForSelector(state.selectionSel);
      applySelectionHighlight(selectionAtoms);
    }
    if(!opts.skipStatus)updateStatusBar();
    if(render!==false)viewer.render();
  }

  function setupAtomEvents(){
    if(!viewer)return;
    viewer.setClickable({},true,function(a,v,e){ handleAtomClick(a,e); });
    viewer.setHoverable({},true,function(a){ if(hoverClearTimer){clearTimeout(hoverClearTimer);hoverClearTimer=null;} showHover(a); }, function(){ if(hoverClearTimer)clearTimeout(hoverClearTimer); hoverClearTimer=setTimeout(function(){ showHover(null); hoverClearTimer=null; },60); });
  }
  function showHover(a){
    const bar=$('hoverBar'); if(!bar)return;
    bar.textContent='';
    if(!a){
      const empty=document.createElement('span');
      empty.className='hover-empty';
      empty.textContent='Hover an atom to inspect'+(currentName?' \u2014 '+currentName:'');
      bar.appendChild(empty);
      return;
    }
    const kind=isLigand(a)?'ligand':(a.hetflag?'hetero':'protein');
    function seg(label,value){
      const wrap=document.createElement('span');
      wrap.className='hover-segment';
      const labelEl=document.createElement('span');
      labelEl.className='hover-label';
      labelEl.textContent=label;
      const valueEl=document.createElement('span');
      valueEl.className='hover-value';
      valueEl.textContent=value;
      wrap.appendChild(labelEl); wrap.appendChild(valueEl);
      bar.appendChild(wrap);
    }
    seg('Kind',kind);
    seg('Chain',a.chain||'-');
    seg('Residue',(a.resn||'-')+' '+(a.resi==null?'-':a.resi));
    seg('Atom',(a.atom||'-')+' ('+(atomElem(a)||'-')+')');
    seg('Serial',a.serial==null?'-':a.serial);
    seg('XYZ',Number(a.x).toFixed(2)+', '+Number(a.y).toFixed(2)+', '+Number(a.z).toFixed(2));
  }
  function handleAtomClick(a,e){
    if(!a||state.selectionMode==='off')return;
    if(state.selectionMode==='range'){ handleRangeSelection(a,e); return; }
    setSelection(selectionFromAtom(a,state.selectionMode), {source:'click',additive:e&&e.shiftKey});
  }
  function selectionFromAtom(a,m){ if(m==='atom')return {serial:a.serial}; if(m==='chain')return {chain:a.chain}; if(m==='model')return {}; return {chain:a.chain,resi:a.resi,resn:a.resn}; }
  function handleRangeSelection(a,e){
    const resi=Number(a.resi),chain=a.chain||'';
    if(!Number.isFinite(resi)){ setSelection({chain:a.chain,resi:a.resi,resn:a.resn},{additive:e&&e.shiftKey}); return; }
    if(!state.rangeAnchor||state.rangeAnchor.chain!==chain){ state.rangeAnchor={chain,resi}; setStatus('Range start: '+(chain||'-')+' '+resi+' \u2014 click end residue'); return; }
    const lo=Math.min(state.rangeAnchor.resi,resi),hi=Math.max(state.rangeAnchor.resi,resi); state.rangeAnchor=null;
    setSelection({chain,resi:lo+'-'+hi},{additive:e&&e.shiftKey});
  }
  function applySelectionOptionOverrides(opts){
    if(opts.representation)state.selectionRepresentation=normText(opts.representation).toLowerCase();
    const nextOpts=opts.options&&typeof opts.options==='object'?opts.options:opts;
    ['color','opacity','radius','scale','thickness','linewidth'].forEach(k=>{
      if(nextOpts[k]!=null)state.selectionOptions[k]=nextOpts[k];
    });
  }
  function setSelection(sel,opts){
    opts=opts||{};
    const next=normalizeSelectorInput(sel), add=!!(opts.additive||opts.add);
    state.selectionSel = add&&state.selectionSel ? combineSelectors(state.selectionSel,next) : next;
    selectionAtoms=selectedAtomsForSelector(state.selectionSel);
    state.rangeAnchor=null; state.focusTarget=null;
    applySelectionOptionOverrides(opts);
    renderSelectionHighlight(true,selectionAtoms);
    if(opts.focus)focus(state.selectionSel);
    const info=selectionInfo(state.selectionSel,selectionAtoms);
    updateSelectionStatus(info);
    syncSeqHighlight(info.residueKeys);
    setStatus((add?'Added: ':'Selected: ')+info.atomCount.toLocaleString()+' atoms');
    return state.selectionSel;
  }
  function setSelectionHighlight(options){
    applySelectionOptionOverrides(options||{});
    renderSelectionHighlight(true);
    return {representation:state.selectionRepresentation,options:cloneSelector(state.selectionOptions)};
  }
  function clearSelection(){
    state.selectionSel=null; selectionAtoms=[]; state.rangeAnchor=null; state.focusTarget=null;
    renderSelectionHighlight(true,selectionAtoms);
    updateSelectionStatus({atomCount:0,residueCount:0,residueKeys:new Set()});
    syncSeqHighlight(new Set());
    setStatus('Selection cleared.');
  }
  function focusOverview(){ if(!viewer||!model)return false; viewer.zoomTo({},450); state.focusTarget={mode:'overview'}; return true; }
  function focus(sel){ if(!viewer||!model)return false; const t=sel||state.selectionSel; if(!t){ focusOverview(); return false; } let s=styleSelection(t,{}); if(s.serial&&Array.isArray(s.serial)&&s.serial.length>=atoms.length)s={}; viewer.zoomTo(s,450); state.focusTarget={mode:'selection'}; return true; }
  function toggleFocus(){ if(!state.selectionSel)return focusOverview(); if(state.focusTarget&&state.focusTarget.mode==='selection')return focusOverview(); return focus(state.selectionSel); }

  function gridKey(a,c){ return Math.floor(a.x/c)+','+Math.floor(a.y/c)+','+Math.floor(a.z/c); }
  function nearbyPairs(la,lb,minD,maxD,limit,pred){
    const cell=maxD,grid=new Map();
    for(const b of lb){ const k=gridKey(b,cell); if(!grid.has(k))grid.set(k,[]); grid.get(k).push(b); }
    const out=[],seen=new Set(),min2=minD*minD,max2=maxD*maxD;
    for(const a of la){ const ix=Math.floor(a.x/cell),iy=Math.floor(a.y/cell),iz=Math.floor(a.z/cell);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){ const bk=grid.get((ix+dx)+','+(iy+dy)+','+(iz+dz)); if(!bk)continue;
        for(const b of bk){ if(a===b||a.serial===b.serial)continue; const s1=Number(a.serial)||0,s2=Number(b.serial)||0,pk=s1<s2?s1+':'+s2:s2+':'+s1; if(seen.has(pk))continue; if(pred&&!pred(a,b))continue; const d2=dist2(a,b); if(d2<min2||d2>max2)continue; seen.add(pk); out.push([a,b,Math.sqrt(d2)]); if(out.length>=limit)return out; } } }
    return out;
  }
  const vdwR={H:1.20,C:1.70,N:1.55,O:1.52,S:1.80,P:1.80,F:1.47,CL:1.75,BR:1.85,I:1.98,ZN:1.39,FE:1.56,MG:1.73,CA:2.31,NA:2.27,K:2.75,MN:1.61,CU:1.40,CO:1.50,NI:1.49,SE:1.90};
  function vdwOf(a){ return vdwR[atomElem(a)]||1.7; }
  function isWaterAtom(a){ return waterNames.has(normUpper(a.resn)); }
  function residueKey(a){ return (a.chain||'')+':'+a.resi+':'+normUpper(a.resn||''); }
  function diffRes(a,b){ return residueKey(a)!==residueKey(b); }
  const ATOM_REPS=new Set(['line','stick','sphere','cpk']);
  let _lvlCache=null;
  function hiddenByRules(a){ for(const r of state.hiddenRules){ if(r.disabled)continue; try{ if(matchesResolvedSelector(a,resolveSelector(r.selector)))return true; }catch(e){} } return false; }
  function isAtomVisibleNow(a){ const c=atomCategory(a); if(state.visibility[c]===false)return false; if(c==='protein'&&state.chainVisible[a.chain]===false)return false; if(isWaterAtom(a))return false; if(hiddenByRules(a))return false; return true; }
  // "Visualized atoms" = atoms currently shown at the ATOM level by the display
  // settings. This is independent of the (yellow) selection, so the Interactions button behaves the
  // same way regardless of what is selected.
  function isAtomLevelShown(a){
    if(!isAtomVisibleNow(a))return false;
    for(const r of state.styleRules){ if(r.disabled)continue; try{ if(matchesResolvedSelector(a,resolveSelector(r.selector))&&ATOM_REPS.has(normText(r.representation).toLowerCase()))return true; }catch(e){} }
    if(a.hetflag)return ATOM_REPS.has(state.ligand);
    return ATOM_REPS.has(state.proteinAtoms);
  }
  function atomLevelAtoms(){ return _lvlCache||atoms.filter(isAtomLevelShown); }
  const interState={ scope:{noncov:'all', pi:'pl', contact:'pl'}, types:{
    hbond:{label:'Hydrogen bonds',color:'#ffd400',on:true},
    halogen:{label:'Halogen bonds',color:'#9b30ff',on:true},
    salt:{label:'Salt bridges',color:'#ff45c0',on:true},
    aromhb:{label:'Aromatic H-Bond',color:'#26c6da',on:false},
    pipi:{label:'Pi-pi stacking',color:'#4fc3f7',on:true},
    pication:{label:'Pi-cation',color:'#66bb6a',on:true},
    good:{label:'Good',color:'#26a69a',on:false},
    bad:{label:'Bad',color:'#ffa726',on:true},
    ugly:{label:'Ugly',color:'#ef5350',on:true}
  }};
  // Scope: 'all' = any pair of visualized atoms; 'pl' = protein<->ligand only; 'pp' = protein<->protein only.
  function pairsSym(scope,C,mn,mx,lim){
    if(scope==='pl')return nearbyPairs(C.filter(isLigand),C.filter(isProtein),mn,mx,lim,null);
    if(scope==='pp'){ const P=C.filter(isProtein); return nearbyPairs(P,P,mn,mx,lim,diffRes); }
    return nearbyPairs(C,C,mn,mx,lim,diffRes);
  }
  function pairsAsym(scope,D,A,mn,mx,lim){
    if(scope==='pl')return nearbyPairs(D.filter(isLigand),A.filter(isProtein),mn,mx,lim,null).concat(nearbyPairs(D.filter(isProtein),A.filter(isLigand),mn,mx,lim,null));
    if(scope==='pp')return nearbyPairs(D.filter(isProtein),A.filter(isProtein),mn,mx,lim,diffRes);
    return nearbyPairs(D,A,mn,mx,lim,diffRes);
  }
  function detectHBonds(scope){ const C=atomLevelAtoms().filter(a=>isPolar(a)&&!isWaterAtom(a)); return pairsSym(scope,C,2.4,state.hbondCutoff,1500); }
  function detectHalogen(scope){ const hal=a=>['CL','BR','I'].includes(atomElem(a)),acc=a=>['O','N','S'].includes(atomElem(a))&&!isWaterAtom(a); return pairsAsym(scope,atomLevelAtoms().filter(hal),atomLevelAtoms().filter(acc),2.6,3.9,400); }
  function detectSalt(scope){ return pairsAsym(scope,atomLevelAtoms().filter(isPositive),atomLevelAtoms().filter(isNegative),1.6,state.saltCutoff,800); }
  function aromaticRings(){ const by=new Map(); for(const a of atoms){ const r=normUpper(a.resn); if(!aromaticDefs[r])continue; const k=(a.chain||'')+':'+a.resi+':'+r; if(!by.has(k))by.set(k,[]); by.get(k).push(a); } const rings=[]; for(const list of by.values()){ const r=normUpper(list[0].resn),ra=list.filter(a=>aromaticDefs[r].includes(a.atom)); if(ra.length<5)continue; const c=ra.reduce((p,a)=>({x:p.x+a.x,y:p.y+a.y,z:p.z+a.z}),{x:0,y:0,z:0}); c.x/=ra.length;c.y/=ra.length;c.z/=ra.length; rings.push({atom:ra[0],center:c}); } return rings; }
  function ringsLvl(){ return aromaticRings().filter(r=>isAtomLevelShown(r.atom)); }
  function ringPairs(scope,rings){
    const out=[];
    if(scope==='pl'){ const L=rings.filter(r=>isLigand(r.atom)),P=rings.filter(r=>isProtein(r.atom)); for(const a of L)for(const b of P)out.push([a,b]); return out; }
    const set=scope==='pp'?rings.filter(r=>isProtein(r.atom)):rings;
    for(let i=0;i<set.length;i++)for(let j=i+1;j<set.length;j++){ if(diffRes(set[i].atom,set[j].atom))out.push([set[i],set[j]]); }
    return out;
  }
  function detectPiPi(scope){
    const out=[],seen=new Set();
    for(const pr of ringPairs(scope,ringsLvl())){ const a=pr[0],b=pr[1],k=[a.atom.serial,b.atom.serial].sort((x,y)=>x-y).join(':'); if(seen.has(k))continue; const d=distance(a.center,b.center); if(d>=3.4&&d<=6.0){ seen.add(k); out.push([a,b,d]); } }
    return out;
  }
  function detectPiCation(scope){
    const rings=ringsLvl(),cats=atomLevelAtoms().filter(isPositive),out=[];
    function add(rs,cs,chk){ for(const r of rs)for(const c of cs){ if(chk&&residueKey(r.atom)===residueKey(c))continue; const d=distance(r.center,point(c)); if(d>=2.8&&d<=6.5)out.push({center:r.center,cat:c,d:d}); } }
    if(scope==='pl'){ add(rings.filter(r=>isProtein(r.atom)),cats.filter(isLigand),false); add(rings.filter(r=>isLigand(r.atom)),cats.filter(isProtein),false); }
    else if(scope==='pp')add(rings.filter(r=>isProtein(r.atom)),cats.filter(isProtein),true);
    else add(rings,cats,true);
    return out;
  }
  function detectAromHB(scope){
    const rings=ringsLvl(),don=atomLevelAtoms().filter(a=>['N','O'].includes(atomElem(a))&&!isWaterAtom(a)),out=[];
    function add(rs,ds,chk){ for(const r of rs)for(const d of ds){ if(chk&&residueKey(r.atom)===residueKey(d))continue; const dist=distance(r.center,point(d)); if(dist>=2.8&&dist<=4.3)out.push({center:r.center,don:d,d:dist}); } }
    if(scope==='pl'){ add(rings.filter(r=>isProtein(r.atom)),don.filter(isLigand),false); add(rings.filter(r=>isLigand(r.atom)),don.filter(isProtein),false); }
    else if(scope==='pp')add(rings.filter(r=>isProtein(r.atom)),don.filter(isProtein),true);
    else add(rings,don,true);
    return out;
  }
  function detectContacts(scope){
    const heavy=atomLevelAtoms().filter(a=>atomElem(a)!=='H'&&!isWaterAtom(a));
    const pairs=pairsSym(scope,heavy,2.0,4.8,6000),out={good:[],bad:[],ugly:[]};
    for(const pr of pairs){ const ratio=pr[2]/(vdwOf(pr[0])+vdwOf(pr[1])); if(ratio<0.75)out.ugly.push(pr); else if(ratio<0.89)out.bad.push(pr); else if(ratio<=1.30)out.good.push(pr); }
    return out;
  }
  function clearInteractionShapes(){
    interactionShapes.forEach(s=>{ try{ viewer.removeShape(s); }catch(e){} });
    interactionShapes=[];
    interactionWideLines=[];
    if(wideLineLayer)wideLineLayer.clearCollection('interactions');
  }
  function addInteractionWideLine(start,end,color,width,dashed){
    if(wideLineLayer){
      interactionWideLines.push({start,end,color,width:width||lineWidths.interaction,opacity:1,dashed:!!dashed});
      return;
    }
    const shape=dashed&&viewer.addLine?viewer.addLine({start,end,color,dashed:true,linewidth:width||lineWidths.interaction}):viewer.addCylinder({start,end,radius:0.05,color,fromCap:1,toCap:1});
    if(shape)interactionShapes.push(shape);
  }
  function drawLine(a,b,color,radius,dashed){ addInteractionWideLine(point(a),point(b),color,dashed?lineWidths.interaction:Math.max(lineWidths.interaction,Number(radius||0.05)*120),dashed); }
  function drawDash(a,b,c){ addInteractionWideLine(point(a),point(b),c,lineWidths.interaction,true); }
  function drawSolid(a,b,c){ addInteractionWideLine(point(a),point(b),c,lineWidths.interactionSolid,false); }
  function drawDashAP(a,p,c){ addInteractionWideLine(point(a),p,c,lineWidths.interaction,true); }
  function drawDashPP(p,q,c){ addInteractionWideLine(p,q,c,lineWidths.interaction,true); }
  function redrawInteractions(render){
    if(!viewer)return;
    clearInteractionShapes();
    if(!model||!atoms.length){ if(render!==false)viewer.render(); return; }
    _lvlCache=atoms.filter(isAtomLevelShown);
    const T=interState.types,S=interState.scope;
    try{
      if(T.hbond.on)detectHBonds(S.noncov).forEach(p=>drawDash(p[0],p[1],T.hbond.color));
      if(T.halogen.on)detectHalogen(S.noncov).forEach(p=>drawDash(p[0],p[1],T.halogen.color));
      if(T.salt.on)detectSalt(S.noncov).forEach(p=>drawSolid(p[0],p[1],T.salt.color));
      if(T.aromhb.on)detectAromHB(S.noncov).forEach(p=>drawDashAP(p.don,p.center,T.aromhb.color));
      if(T.pipi.on)detectPiPi(S.pi).forEach(p=>drawDashPP(p[0].center,p[1].center,T.pipi.color));
      if(T.pication.on)detectPiCation(S.pi).forEach(p=>drawDashAP(p.cat,p.center,T.pication.color));
      if(T.good.on||T.bad.on||T.ugly.on){ const c=detectContacts(S.contact);
        if(T.good.on)c.good.forEach(p=>drawDash(p[0],p[1],T.good.color));
        if(T.bad.on)c.bad.forEach(p=>drawDash(p[0],p[1],T.bad.color));
        if(T.ugly.on)c.ugly.forEach(p=>drawDash(p[0],p[1],T.ugly.color));
      }
    }catch(e){}
    _lvlCache=null;
    if(wideLineLayer)wideLineLayer.setCollection('interactions',interactionWideLines,[],{linewidth:lineWidths.interaction,opacity:1});
    if(render!==false)viewer.render();
  }
  function interIcon(kind){ const s=document.createElement('span'); s.style.cssText='display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;flex:none;background:#159aad;color:#fff;font-size:13px;font-weight:700'; s.textContent=kind==='noncov'?'H':(kind==='pi'?'\u03c0':'\u2731'); return s; }
  function makeInterToggle(key){
    const t=interState.types[key];
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:'+(t.on?'#e6e6e6':'#9a9a9a');
    const box=document.createElement('span'); box.textContent='\u2713';
    box.style.cssText='display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;flex:none;font-size:11px;line-height:1;'+(t.on?'background:#2f86d6;color:#fff;border:1px solid #2f86d6':'background:transparent;color:#7a7a7a;border:2px solid #6b6b6b');
    const lab=document.createElement('span'); lab.textContent=t.label; lab.style.flex='1';
    const sw=document.createElement('span'); sw.style.cssText='width:13px;height:13px;border-radius:3px;flex:none;background:'+t.color+(t.on?'':';opacity:.25');
    wrap.appendChild(box); wrap.appendChild(lab); wrap.appendChild(sw);
    wrap.onclick=function(){ t.on=!t.on; buildInterPanel(); redrawInteractions(true); };
    return wrap;
  }
  function buildInterPanel(){
    const body=$('interPanelBody'); if(!body)return; body.innerHTML='';
    const SCOPE_OPTS=[['All','all'],['Protein-Ligand','pl'],['Protein-Protein','pp']];
    const groups=[
      {key:'noncov',name:'Non-covalent bonds',rows:[['hbond','halogen'],['salt','aromhb']],gear:false},
      {key:'pi',name:'Pi interactions',rows:[['pipi','pication']],gear:true},
      {key:'contact',name:'Contacts/Clashes',rows:[['good','bad','ugly']],gear:true}
    ];
    groups.forEach((g,gi)=>{
      const sec=document.createElement('div'); sec.style.cssText='display:grid;gap:9px;padding:11px 0'+(gi>0?';border-top:1px solid #1c1c1c':'');
      const head=document.createElement('div'); head.style.cssText='display:flex;align-items:center;gap:8px';
      head.appendChild(interIcon(g.key));
      const nm=document.createElement('span'); nm.textContent=g.name; nm.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#e6e6e6;font-weight:600'; head.appendChild(nm);
      const sel=document.createElement('select'); sel.style.cssText='flex:none;width:124px;height:22px;background:#1f1f1f;color:#d4d4d4;border:1px solid #555;border-radius:4px;font-size:11px;font-family:inherit';
      SCOPE_OPTS.forEach(o=>{ const op=document.createElement('option'); op.value=o[1]; op.textContent=o[0]; sel.appendChild(op); });
      sel.value=interState.scope[g.key];
      sel.onchange=function(){ interState.scope[g.key]=sel.value; redrawInteractions(true); };
      head.appendChild(sel);
      const gr=document.createElement('span'); gr.textContent=g.gear?'\u2699':''; gr.style.cssText='flex:none;width:14px;text-align:center;color:#8f8f8f;font-size:13px'; head.appendChild(gr);
      sec.appendChild(head);
      g.rows.forEach(row=>{ const r=document.createElement('div'); r.style.cssText='display:grid;grid-template-columns:repeat('+row.length+',1fr);gap:8px;padding-left:30px'; row.forEach(k=>r.appendChild(makeInterToggle(k))); sec.appendChild(r); });
      body.appendChild(sec);
    });
  }
  function openInterPanel(){ $('interPanel').hidden=false; setBtnActive($('interBtn'),true); }
  function closeInterPanel(){ $('interPanel').hidden=true; setBtnActive($('interBtn'),false); }
  function toggleInterPanel(){ if($('interPanel').hidden)openInterPanel(); else closeInterPanel(); }
  function setBtnActive(btn,on){ if(!btn)return; btn.style.background=on?'#1a4f7a':'#2d2d2d'; btn.style.borderColor=on?'#3a7bd5':'#555'; btn.style.color=on?'#fff':'#d4d4d4'; }

  function chargeOf(resn){ const r=normUpper(resn); if(r==='ARG'||r==='LYS')return 1; if(r==='ASP'||r==='GLU')return -1; return 0; }
  function updateStatusBar(){
    const residues=new Set(),chains=new Set(),ligs=new Set(); let charge=0; const seenRes=new Set();
    atoms.forEach(a=>{ const rk=(a.chain||'')+':'+a.resi+':'+(a.resn||''); residues.add(rk); chains.add(a.chain||'?'); if(isLigand(a))ligs.add((a.chain||'')+':'+(a.resn||'')+':'+a.resi); if(!seenRes.has(rk)){ seenRes.add(rk); charge+=chargeOf(a.resn); } });
    const protChains=new Set(); atoms.forEach(a=>{ if(isProtein(a))protChains.add(a.chain||'?'); });
    const mols = protChains.size + ligs.size;
    $('stAtoms').textContent=atoms.length.toLocaleString();
    $('stChains').textContent=chains.size;
    $('stResidues').textContent=residues.size.toLocaleString();
    $('stEntries').textContent=entries.length;
    $('stMols').textContent=mols;
    $('stCharge').textContent=(charge>0?'+':'')+charge;
    $('stDisplayed').textContent=displayedCount.toLocaleString()+' of '+atoms.length.toLocaleString();
    updateSelectionStatus();
  }
  function updateSelectionStatus(info){
    info=info||selectionInfo(state.selectionSel);
    const hasSelection=!!state.selectionSel;
    $('stSel').textContent=info.atomCount.toLocaleString()+' atoms, '+info.residueCount.toLocaleString()+' residues';
    const label=$('curSelLabel');
    if(label)label.textContent=hasSelection?(info.atomCount.toLocaleString()+' atoms selected'):'Current Selection';
    const chk=$('curSelChk');
    if(chk)chk.checked=hasSelection;
  }

  // ---------- Hierarchy & Entries ----------
  function buildEntriesList(){
    const el=$('entriesList'); el.innerHTML='';
    entries.forEach((e,i)=>{
      const row=document.createElement('div');
      const active=e.name===currentName;
      row.setAttribute('data-row','');
      row.style.cssText='display:grid;grid-template-columns:34px 26px 1fr;align-items:center;height:22px;padding:0 8px;cursor:pointer;font-size:11.5px;border-left:3px solid '+(active?'#3a7bd5':'transparent')+';background:'+(active?'#16456e':'transparent');
      const rn=document.createElement('span'); rn.textContent=String(i+1); rn.style.color='#8f8f8f';
      const chk=document.createElement('input'); chk.type='radio'; chk.checked=active; chk.style.cssText='width:12px;height:12px;accent-color:#3a7bd5;pointer-events:none';
      const ttl=document.createElement('span'); ttl.textContent=e.title; ttl.style.cssText='color:'+(active?'#fff':'#d4d4d4')+';overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; ttl.title=e.title;
      row.appendChild(rn); row.appendChild(chk); row.appendChild(ttl);
      row.onclick=function(){ if(e.name!==currentName)loadEntry(e); };
      el.appendChild(row);
    });
  }
  function catRow(label,key,color,count){
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:7px;height:21px;padding:0 8px 0 22px;font-size:11.5px';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=state.visibility[key]!==false; chk.style.cssText='width:13px;height:13px;accent-color:#3a7bd5;cursor:pointer';
    chk.onchange=function(){ state.visibility[key]=chk.checked; applyStylesFull(true); };
    const dot=document.createElement('span'); dot.style.cssText='width:8px;height:8px;border-radius:2px;background:'+color;
    const lab=document.createElement('span'); lab.textContent=label; lab.style.color='#d4d4d4';
    const cnt=document.createElement('span'); cnt.textContent=count?'('+count+')':''; cnt.style.cssText='color:#777;font-size:10px';
    row.appendChild(chk); row.appendChild(dot); row.appendChild(lab); row.appendChild(cnt);
    return row;
  }
  function buildHierarchy(){
    const tree=$('hierarchyTree'); tree.innerHTML='';
    updateSelectionStatus();
    const head=document.createElement('div');
    head.style.cssText='display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;font-size:11.5px;color:#cfcfcf;font-weight:600';
    const arrow=document.createElement('span');
    arrow.className='tree-arrow';
    arrow.textContent='\u25be';
    head.appendChild(arrow);
    head.appendChild(document.createTextNode(currentName||'\u2014'));
    tree.appendChild(head);
    const counts={protein:0,ligands:0,solvents:0,other:0};
    atoms.forEach(a=>{ counts[atomCategory(a)]++; });
    tree.appendChild(catRow('Ligands','ligands','#FF8A65',counts.ligands));
    tree.appendChild(catRow('Protein','protein','#64B5F6',counts.protein));
    tree.appendChild(catRow('Solvents','solvents','#4DD0E1',counts.solvents));
    tree.appendChild(catRow('Other','other','#CE93D8',counts.other));
    // chains
    const chains=Array.from(new Set(atoms.filter(isProtein).map(a=>a.chain||'?'))).sort();
    if(chains.length){
      const ch=document.createElement('div'); ch.style.cssText='height:21px;padding:0 8px;font-size:11px;color:#8f8f8f;display:flex;align-items:center'; ch.textContent='Chains'; tree.appendChild(ch);
      chains.forEach(c=>{
        const row=document.createElement('div'); row.setAttribute('data-row',''); row.style.cssText='display:flex;align-items:center;gap:7px;height:20px;padding:0 8px 0 34px;font-size:11.5px;cursor:pointer';
        const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=state.chainVisible[c]!==false; chk.style.cssText='width:12px;height:12px;accent-color:#3a7bd5;cursor:pointer';
        chk.onchange=function(){ state.chainVisible[c]=chk.checked; applyStylesFull(true); };
        const dot=document.createElement('span'); dot.style.cssText='width:8px;height:8px;border-radius:2px;background:'+chainColor(c);
        const lab=document.createElement('span'); lab.textContent='Chain '+c; lab.style.color='#d4d4d4';
        row.appendChild(chk); row.appendChild(dot); row.appendChild(lab);
        row.onclick=function(e){ if(e.target===chk)return; setSelection({chain:c},{}); focus({chain:c}); };
        tree.appendChild(row);
      });
    }
  }

  // ---------- Sequence viewer ----------
  function buildSequence(){
    const body=$('seqBody'); if(!body){ seqResidues=[]; seqResidueByKey=new Map(); activeSeqKeys=new Set(); return; } body.innerHTML=''; seqResidues=[]; seqResidueByKey=new Map(); activeSeqKeys=new Set();
    const byChain=new Map();
    atoms.forEach(a=>{ if(!isProtein(a))return; const c=a.chain||'?'; if(!byChain.has(c))byChain.set(c,new Map()); const m=byChain.get(c); if(!m.has(a.resi))m.set(a.resi,{resi:a.resi,resn:a.resn,chain:c}); });
    const chains=Array.from(byChain.keys()).sort();
    chains.forEach(c=>{
      const residues=Array.from(byChain.get(c).values()).sort((x,y)=>Number(x.resi)-Number(y.resi));
      const rowWrap=document.createElement('div'); rowWrap.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:2px;white-space:nowrap';
      const tag=document.createElement('span'); tag.textContent=c; tag.style.cssText='position:sticky;left:0;flex:none;width:16px;text-align:center;font-size:11px;font-weight:700;color:'+chainColor(c)+';background:#121212;z-index:1';
      rowWrap.appendChild(tag);
      const strip=document.createElement('span'); strip.style.cssText='font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px';
      residues.forEach(r=>{
        const code=aa3to1[normUpper(r.resn)]||'X';
        const sp=document.createElement('span'); sp.setAttribute('data-seq',''); sp.textContent=code;
        sp.dataset.chain=c; sp.dataset.resi=r.resi;
        sp.style.cssText='display:inline-block;width:9px;text-align:center;color:#c8c8c8;cursor:pointer;border-radius:2px';
        sp.onclick=function(e){ setSelection({chain:c,resi:Number(r.resi),resn:r.resn},{additive:e.shiftKey}); focus({chain:c,resi:Number(r.resi)}); };
        sp.title=c+' '+r.resn+' '+r.resi;
        strip.appendChild(sp);
        const key=c+':'+Number(r.resi);
        seqResidues.push({el:sp,chain:c,resi:Number(r.resi),key});
        if(!seqResidueByKey.has(key))seqResidueByKey.set(key,[]);
        seqResidueByKey.get(key).push(sp);
      });
      rowWrap.appendChild(strip);
      body.appendChild(rowWrap);
    });
  }
  function paintSeqKey(key,on){
    const els=seqResidueByKey.get(key); if(!els)return;
    els.forEach(el=>{ el.style.background=on?'#fdd835':'transparent'; el.style.color=on?'#1a1a1a':'#c8c8c8'; });
  }
  function syncSeqHighlight(residueKeys){
    if(!seqResidueByKey.size)return;
    const next=residueKeys||selectionInfo(state.selectionSel).residueKeys, dirty=new Set();
    activeSeqKeys.forEach(k=>dirty.add(k));
    next.forEach(k=>dirty.add(k));
    dirty.forEach(k=>{ const on=next.has(k); if(activeSeqKeys.has(k)!==on)paintSeqKey(k,on); });
    activeSeqKeys=new Set(next);
  }

  // ---------- Find ----------
  function runFind(){
    const type=$('findType').value, q=normText($('findInput').value);
    findMatches=[]; findIndex=-1;
    if(!q){ $('findCount').textContent='0 matches'; $('findSel').textContent=''; return; }
    const keymap={resi:'resi',resn:'resn',atom:'atom',chain:'chain',elem:'elem'};
    const key=keymap[type];
    const seen=new Set();
    atoms.forEach(a=>{ let v = key==='elem'?atomElem(a):a[key]; if(v==null)return; if(matchScalar(v,(type==='resi'?(/^-?\d+(\s*-\s*-?\d+)?$/.test(q)?q:q):q),key)){ const rk=(a.chain||'')+':'+a.resi+':'+(a.atom||''); if(type==='atom'){ if(!seen.has(a.serial)){seen.add(a.serial); findMatches.push({sel:{serial:a.serial},label:(a.chain||'')+' '+(a.resn||'')+a.resi+' '+a.atom}); } } else { const gk=(a.chain||'')+':'+a.resi; if(!seen.has(gk)){ seen.add(gk); findMatches.push({sel:{chain:a.chain,resi:a.resi,resn:a.resn},label:(a.chain||'')+' '+(a.resn||'')+' '+a.resi}); } } } });
    $('findCount').textContent=findMatches.length+' match'+(findMatches.length===1?'':'es');
    if(findMatches.length){ findIndex=0; gotoFindMatch(); } else { $('findSel').textContent=''; clearSelection(); }
  }
  function gotoFindMatch(){
    if(findIndex<0||findIndex>=findMatches.length)return;
    const m=findMatches[findIndex];
    setSelection(m.sel,{}); focus(m.sel);
    $('findSel').textContent=(findIndex+1)+'/'+findMatches.length+'  '+m.label;
  }
  function stepFind(d){ if(!findMatches.length)return; findIndex=(findIndex+d+findMatches.length)%findMatches.length; gotoFindMatch(); }

  // ---------- Load ----------
  async function loadUrl(url,fmt,name,title,pdbId){
    setStatus('Loading: '+(name||url));
    const res=await fetch(url); if(!res.ok)throw new Error(res.status+' '+res.statusText);
    const data=await res.text();
    const e={name,title:title||name,pdbId:pdbId||'',data,fmt:fmt||'pdb'};
    if(!entries.some(x=>x.name===name))entries.push(e);
    loadEntry(e);
  }
  function loadEntry(e){
    if(!viewer)initViewer();
    viewer.clear();
    if(wideLineLayer)wideLineLayer.clear();
    interactionShapes=[]; interactionWideLines=[];
    model=viewer.addModel(e.data,e.fmt||'pdb');
    atoms=model.selectedAtoms({});
    atomByIndex=new Map();
    atoms.forEach(a=>{ if(a.index!=null)atomByIndex.set(a.index,a); });
    currentName=e.name;
    state.styleRules=[];state.hiddenRules=[];state.interactionRules=[];state.selectionSel=null;selectionAtoms=[];state.rangeAnchor=null;state.focusTarget=null;state.selectionOptions=defaultSelectionOptions();
    state.visibility={protein:true,ligands:true,solvents:true,other:true}; state.chainVisible={};
    setupAtomEvents();
    applyStylesFull(false);
    viewer.zoomTo(); viewer.render();
    buildEntriesList(); buildHierarchy(); buildSequence(); updateStatusBar(); syncSeqHighlight();
    showHover(null);
    setStatus(currentName+' \u00b7 '+atoms.length.toLocaleString()+' atoms');
  }
  function inferFormat(n){ n=normText(n).toLowerCase(); if(n.endsWith('.sdf')||n.endsWith('.mol'))return 'sdf'; if(n.endsWith('.mol2'))return 'mol2'; if(n.endsWith('.xyz'))return 'xyz'; if(n.endsWith('.cif')||n.endsWith('.mmcif'))return 'cif'; return 'pdb'; }

  function applyClip(){
    if(!viewer)return; const near=Number($('clipNear').value),far=Number($('clipFar').value);
    $('nearVal').textContent=String(near); $('farVal').textContent=String(far);
    try{ if(viewer.setSlab)viewer.setSlab(near,far); else { if(viewer.setSlabNear)viewer.setSlabNear(near); if(viewer.setSlabFar)viewer.setSlabFar(far); } viewer.render(); }catch(e){}
  }

  // ---------- Navigator thumbnail ----------
  function drawNavigator(){
    const cv=$('navCanvas'); if(!cv||!atoms.length)return; const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height);
    let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
    atoms.forEach(a=>{ if(a.x<minx)minx=a.x; if(a.y<miny)miny=a.y; if(a.x>maxx)maxx=a.x; if(a.y>maxy)maxy=a.y; });
    const w=cv.width,h=cv.height,pad=14,sx=(w-pad*2)/(maxx-minx||1),sy=(h-pad*2)/(maxy-miny||1),s=Math.min(sx,sy);
    const cx=w/2-((minx+maxx)/2)*s, cy=h/2+((miny+maxy)/2)*s;
    const step=Math.max(1,Math.floor(atoms.length/1400));
    for(let i=0;i<atoms.length;i+=step){ const a=atoms[i]; ctx.fillStyle=isProtein(a)?chainColor(a.chain):elementColor(a); ctx.globalAlpha=0.85; ctx.fillRect(a.x*s+cx, -a.y*s+cy, 1.4, 1.4); }
    ctx.globalAlpha=1;
  }

  // ---------- Mouse (ported) ----------
  function stopMouseEvent(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  function eventPagePoint(e){ if(e.pageX!=null&&e.pageY!=null)return {x:e.pageX,y:e.pageY}; if(e.clientX!=null)return {x:e.clientX+window.pageXOffset,y:e.clientY+window.pageYOffset}; return null; }
  function pointInsideViewer(p){ const r=viewerEl.getBoundingClientRect(),x=p.x-window.pageXOffset,y=p.y-window.pageYOffset; return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom; }
  function viewerPageBounds(){ const r=viewerEl.getBoundingClientRect(); return {left:r.left+window.pageXOffset,right:r.right+window.pageXOffset,top:r.top+window.pageYOffset,bottom:r.bottom+window.pageYOffset}; }
  function normalizedPageRect(a,b){ const bd=viewerPageBounds(); return {left:Math.max(bd.left,Math.min(a.x,b.x)),right:Math.min(bd.right,Math.max(a.x,b.x)),top:Math.max(bd.top,Math.min(a.y,b.y)),bottom:Math.min(bd.bottom,Math.max(a.y,b.y))}; }
  function updateDragSelectBox(a,b){ const r=normalizedPageRect(a,b),bd=viewerPageBounds(); dragSelectBoxEl.style.left=(r.left-bd.left)+'px'; dragSelectBoxEl.style.top=(r.top-bd.top)+'px'; dragSelectBoxEl.style.width=Math.max(0,r.right-r.left)+'px'; dragSelectBoxEl.style.height=Math.max(0,r.bottom-r.top)+'px'; dragSelectBoxEl.style.display='block'; }
  function hideDragSelectBox(){ dragSelectBoxEl.style.display='none'; }
  function atomResidueKey(a){ return (a.chain||'')+'\u0001'+(a.resi==null?'':a.resi)+'\u0001'+(a.resn||''); }
  function serialSelectorForAtoms(list){ const ser=[],seen=new Set(); for(const a of list){ if(a.serial==null||seen.has(a.serial))continue; seen.add(a.serial); ser.push(a.serial); } return ser.length?{serial:ser}:null; }
  function atomsInPageRect(rect){ if(!viewer||!model||!atoms.length||!viewer.modelToScreen)return []; let pts=[]; try{ pts=viewer.modelToScreen(atoms); }catch(e){ return []; } const out=[]; for(let i=0;i<atoms.length;i++){ const p=pts[i]; if(!p||!Number.isFinite(p.x))continue; if(p.x>=rect.left&&p.x<=rect.right&&p.y>=rect.top&&p.y<=rect.bottom)out.push(atoms[i]); } return out; }
  function atomAtPagePoint(pt,maxDist){
    if(!viewer||!model||!atoms.length||!viewer.modelToScreen)return null;
    let pts=[]; try{ pts=viewer.modelToScreen(atoms); }catch(e){ return null; }
    const max2=(maxDist||14)*(maxDist||14); let best=null,bestD=max2;
    for(let i=0;i<atoms.length;i++){
      const p=pts[i],a=atoms[i]; if(!p||!a||!Number.isFinite(p.x)||!isAtomVisibleNow(a))continue;
      const dx=p.x-pt.x,dy=p.y-pt.y,d=dx*dx+dy*dy;
      if(d<bestD){ bestD=d; best=a; }
    }
    return best;
  }
  function selectorFromDragHits(hits){ if(!hits.length||state.selectionMode==='off')return null; if(state.selectionMode==='model')return {}; if(state.selectionMode==='atom')return serialSelectorForAtoms(hits); if(state.selectionMode==='chain'){ const ch=new Set(hits.map(a=>a.chain||'')); return serialSelectorForAtoms(atoms.filter(a=>ch.has(a.chain||''))); } const res=new Set(hits.map(atomResidueKey)); return serialSelectorForAtoms(atoms.filter(a=>res.has(atomResidueKey(a)))); }
  function selectDragRange(start,end,e){ if(state.selectionMode==='off')return; const rect=normalizedPageRect(start,end),hits=atomsInPageRect(rect),sel=selectorFromDragHits(hits); if(!sel){ clearSelection(); return; } setSelection(sel,{additive:e&&e.shiftKey}); }
  function isCustomMousePreset(){ return !(mousePresets[state.mousePreset]&&mousePresets[state.mousePreset].passThrough); }
  function showViewer(){ if(!viewer)return; if(viewer.show)viewer.show(); else viewer.render(); }
function tweenVector(from, to, amount){
  return to.clone().sub(from).multiplyScalar(amount).add(from);
}
function slerpQuaternion(from, to, amount){
  const out = from.clone();
  let tx = to.x, ty = to.y, tz = to.z, tw = to.w;
  let cosHalfTheta = from.x * tx + from.y * ty + from.z * tz + from.w * tw;
  if(cosHalfTheta < 0){
    tx = -tx; ty = -ty; tz = -tz; tw = -tw;
    cosHalfTheta = -cosHalfTheta;
  }
  if(cosHalfTheta >= 1){
    return out.copy(from);
  }
  if(cosHalfTheta > 0.9995){
    out.set(
      from.x + amount * (tx - from.x),
      from.y + amount * (ty - from.y),
      from.z + amount * (tz - from.z),
      from.w + amount * (tw - from.w)
    );
    return out.normalize();
  }
  const halfTheta = Math.acos(Math.max(-1, Math.min(1, cosHalfTheta)));
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
  const ratioA = Math.sin((1 - amount) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(amount * halfTheta) / sinHalfTheta;
  out.set(
    from.x * ratioA + tx * ratioB,
    from.y * ratioA + ty * ratioB,
    from.z * ratioA + tz * ratioB,
    from.w * ratioA + tw * ratioB
  );
  return out;
}
function installFrameSyncedMotion(targetViewer){
  if(!targetViewer || targetViewer._frameSyncedMotionInstalled || !targetViewer.animateMotion) return;
  const nativeAnimateMotion = targetViewer.animateMotion.bind(targetViewer);
  targetViewer.animateMotion = function(duration, fixedPath, targetPosition, targetZoom, targetRotation, targetCamera){
    const totalMs = Number(duration) || 0;
    if(totalMs <= 0 || typeof requestAnimationFrame !== 'function' || document.hidden){
      return nativeAnimateMotion(duration, fixedPath, targetPosition, targetZoom, targetRotation, targetCamera);
    }
    const activeViewer = this;
    activeViewer.incAnim();
    const startTime = performance.now();
    const startPosition = activeViewer.modelGroup.position.clone();
    const startZoom = activeViewer.rotationGroup.position.z;
    const startRotation = activeViewer.rotationGroup.quaternion.clone();
    const startCamera = activeViewer.lookingAt.clone();
    function step(now){
      const amount = Math.min(1, Math.max(0, (now - startTime) / totalMs));
      if(targetPosition) activeViewer.modelGroup.position.copy(tweenVector(startPosition, targetPosition, amount));
      if(targetZoom !== undefined && targetZoom !== null) activeViewer.rotationGroup.position.z = startZoom + amount * (targetZoom - startZoom);
      if(targetRotation) activeViewer.rotationGroup.quaternion.copy(slerpQuaternion(startRotation, targetRotation, amount));
      if(targetCamera){
        const cameraTarget = tweenVector(startCamera, targetCamera, amount);
        if(!fixedPath) activeViewer.lookingAt.copy(cameraTarget);
        activeViewer.camera.lookAt(cameraTarget);
      }
      activeViewer.show();
      if(amount < 1) requestAnimationFrame(step);
      else activeViewer.decAnim();
    }
    requestAnimationFrame(step);
    return activeViewer;
  };
  targetViewer._frameSyncedMotionInstalled = true;
}
  function mouseButtonKey(e){ if(e.button===0)return 'left'; if(e.button===1)return 'middle'; if(e.button===2)return 'right'; return null; }
  function dragRatios(p,d){ const xr=viewer&&viewer.renderer&&viewer.renderer.getXRatio?viewer.renderer.getXRatio():1,yr=viewer&&viewer.renderer&&viewer.renderer.getYRatio?viewer.renderer.getYRatio():1; return {x:(p.x-d.startX)/viewer.WIDTH*xr,y:(p.y-d.startY)/viewer.HEIGHT*yr,xRatio:xr,yRatio:yr}; }
  function selectAtPoint(p,e){
    if(viewer&&model&&viewer.modelToScreen){
      const atom=atomAtPagePoint(p,14);
      if(atom){ handleAtomClick(atom,e); return; }
      clearSelection();
      return;
    }
    if(!viewer||!model||!viewer.mouseXY||!viewer.handleClickSelection){ clearSelection(); return; }
    const xy=viewer.mouseXY(p.x,p.y); viewer.mouseButton=1; viewer.handleClickSelection(xy.x,xy.y,e);
  }
  function bindCustomMouseActions(){
    const drag={mode:null,button:null,startX:0,startY:0,moved:false,startQuaternion:null,startModelPos:null,startZoom:0}; const tol=3;
    function resetDrag(){ drag.mode=null;drag.button=null;drag.moved=false;drag.startQuaternion=null;drag.startModelPos=null;drag.startZoom=0; hideDragSelectBox(); }
    resetMouseDrag=resetDrag;
    function beginDrag(e){ if(overUiPanel(e))return; const b=mouseButtonKey(e); if(!b)return; if(!isCustomMousePreset())return; const action=settings.mouse.buttons[b]||'none'; stopMouseEvent(e); if(state.locked||!viewer)return; const p=eventPagePoint(e); if(!p)return; drag.mode=action;drag.button=b;drag.startX=p.x;drag.startY=p.y;drag.moved=false; drag.startQuaternion=viewer.rotationGroup&&viewer.rotationGroup.quaternion?viewer.rotationGroup.quaternion.clone():null; drag.startModelPos=viewer.modelGroup&&viewer.modelGroup.position?viewer.modelGroup.position.clone():null; drag.startZoom=viewer.rotationGroup&&viewer.rotationGroup.position?viewer.rotationGroup.position.z:0; hideDragSelectBox(); }
    function rotateFromDrag(p){ if(!viewer||!drag.startQuaternion||!viewer.rotationGroup||!viewer.dq)return; const d=dragRatios(p,drag),dist=Math.hypot(d.x,d.y); if(!dist)return; const f=Math.sin(dist*Math.PI)/dist; viewer.dq.x=Math.cos(dist*Math.PI);viewer.dq.y=0;viewer.dq.z=f*d.x;viewer.dq.w=-f*d.y; viewer.rotationGroup.quaternion.set(1,0,0,0); viewer.rotationGroup.quaternion.multiply(viewer.dq); viewer.rotationGroup.quaternion.multiply(drag.startQuaternion); showViewer(); }
    function panFromDrag(p){ if(!viewer||!drag.startModelPos||!viewer.modelGroup||!viewer.screenOffsetToModel)return; const d=dragRatios(p,drag),off=viewer.screenOffsetToModel(d.xRatio*(p.x-drag.startX),d.yRatio*(p.y-drag.startY)); viewer.modelGroup.position.addVectors(drag.startModelPos,off); showViewer(); }
    function zoomFromDrag(p){ if(!viewer||!viewer.rotationGroup)return; const d=dragRatios(p,drag); let scale=0.85*(viewer.CAMERA_Z-viewer.rotationGroup.position.z); if(scale<80)scale=80; viewer.rotationGroup.position.z=drag.startZoom+d.y*scale; if(viewer.adjustZoomToLimits)viewer.rotationGroup.position.z=viewer.adjustZoomToLimits(viewer.rotationGroup.position.z); showViewer(); }
    function continueDrag(e){ if(!drag.mode)return; if(!isCustomMousePreset()){resetDrag();return;} stopMouseEvent(e); if(state.locked)return; const p=eventPagePoint(e); if(!p)return; const moved=Math.hypot(p.x-drag.startX,p.y-drag.startY)>tol; drag.moved=drag.moved||moved; if(drag.mode==='none')return; if(drag.mode==='select'&&drag.moved){ updateDragSelectBox({x:drag.startX,y:drag.startY},p); return; } if(drag.mode==='rotate')rotateFromDrag(p); else if(drag.mode==='pan')panFromDrag(p); else if(drag.mode==='zoom')zoomFromDrag(p); }
    function endDrag(e){ if(!drag.mode)return; if(!isCustomMousePreset()){resetDrag();return;} const mode=drag.mode,moved=drag.moved,start={x:drag.startX,y:drag.startY}; stopMouseEvent(e); const p=eventPagePoint(e); resetDrag(); if(state.locked||mode!=='select'||!p)return; if(moved){ selectDragRange(start,p,e); return; } if(!pointInsideViewer(p))return; selectAtPoint(p,e); }
    viewerEl.addEventListener('mousedown',beginDrag,{capture:true,passive:false});
    window.addEventListener('mousemove',continueDrag,{capture:true,passive:false});
    window.addEventListener('mouseup',endDrag,{capture:true,passive:false});
    viewerEl.addEventListener('contextmenu',function(e){ if(isCustomMousePreset())stopMouseEvent(e); },{capture:true,passive:false});
    window.addEventListener('blur',resetDrag);
  }
  function overUiPanel(e){ const t=e&&e.target; return !!(t&&t.closest&&t.closest('#interPanel,#stylePopover')); }
  function bindWheelZoom(){ viewerEl.addEventListener('wheel',function(e){ if(overUiPanel(e))return; if(!viewer||state.locked)return; if(!isCustomMousePreset())return; if(settings.mouse.wheel!=='zoom')return; stopMouseEvent(e); const delta=e.deltaY||-e.wheelDelta||1,amount=Math.max(1,Math.min(4,Math.abs(delta)/100)),step=Math.pow(1.12,amount); viewer.zoom(delta<0?step:1/step); },{capture:true,passive:false}); }

  function startFpsOverlay(){ const fpsEl=$('fpsOverlay'); let frames=0,last=performance.now(); function tick(){ frames++; requestAnimationFrame(tick); } function update(){ if(document.hidden){ fpsEl.textContent='FPS --'; frames=0; last=performance.now(); return; } const now=performance.now(),el=now-last; fpsEl.textContent='FPS '+Math.round(frames*1000/el); frames=0; last=now; } setInterval(update,500); requestAnimationFrame(tick); }

  function initViewer(){
    viewer=$3Dmol.createViewer(viewerEl,{backgroundColor:'#000000',hoverDuration:0});
    if(viewer.setBackgroundColor)viewer.setBackgroundColor('#000000');
    installFrameSyncedMotion(viewer);
    if(window.MolWideLineLayer){
      wideLineLayer=new window.MolWideLineLayer(viewerEl,function(){ return viewer; });
      wideLineLayer.bindViewer(viewer);
    }
    bindCustomMouseActions(); bindWheelZoom();
    window.addEventListener('resize',function(){ if(viewer)viewer.resize(); });
  }

  // ---------- Build tabs ----------
  function buildTabs(){
    const row=$('tabRow'); if(!row)return; row.innerHTML='';
    tabs.forEach((t,i)=>{ const tab=document.createElement('span'); tab.setAttribute('data-tab',''); tab.textContent=t; tab.style.cssText='flex:none;padding:0 12px;height:29px;line-height:29px;font-size:11.5px;color:'+(i===0?'#cfe6ff':'#6cb0e0')+';border-bottom:2px solid '+(i===0?'#3a7bd5':'transparent')+';cursor:pointer'; tab.onclick=function(){ row.querySelectorAll('[data-tab]').forEach(x=>{ x.style.color='#6cb0e0'; x.style.borderBottomColor='transparent'; }); tab.style.color='#cfe6ff'; tab.style.borderBottomColor='#3a7bd5'; setStatus('Task: '+t); }; row.appendChild(tab); });
  }

  // ---------- Settings ----------
  function toHex(col){ if(/^#[0-9a-f]{6}$/i.test(col))return col; try{ const cx=document.createElement('canvas').getContext('2d'); cx.fillStyle=col; if(/^#[0-9a-f]{6}$/i.test(cx.fillStyle))return cx.fillStyle; }catch(e){} return '#888888'; }
  function setBackground(c){ state.bgColor=c; if(viewer&&viewer.setBackgroundColor){ viewer.setBackgroundColor(c); viewer.render(); } if($('bgCustom'))$('bgCustom').value=toHex(c); document.querySelectorAll('#bgSwatches [data-bg]').forEach(b=>{ b.style.borderColor=(b.getAttribute('data-bg').toLowerCase()===String(c).toLowerCase())?'#3a7bd5':'#777'; }); }
  function buildChainColorList(){
    const wrap=$('chainColorList'); if(!wrap)return; wrap.innerHTML='';
    const chains=Array.from(new Set(atoms.map(a=>a.chain||'?'))).sort();
    if(!chains.length){
      const empty=document.createElement('span');
      empty.className='settings-empty';
      empty.textContent='No structure loaded';
      wrap.appendChild(empty);
      return;
    }
    chains.forEach(c=>{ const lab=document.createElement('label'); lab.style.cssText='display:flex;align-items:center;gap:7px;font-size:12px;color:#d4d4d4'; const inp=document.createElement('input'); inp.type='color'; inp.value=toHex(chainColor(c)); inp.style.cssText='height:24px;width:34px;border:1px solid #555;border-radius:4px;background:#1f1f1f;padding:1px;cursor:pointer'; inp.oninput=function(){ chainColors[(c||'?').toUpperCase()]=inp.value; applyStylesFull(true); buildHierarchy(); drawNavigator(); }; const sp=document.createElement('span'); sp.textContent='Chain '+c; lab.appendChild(inp); lab.appendChild(sp); wrap.appendChild(lab); });
  }
  // The 3 buttons (left/right/middle) must hold distinct actions: an action already used by
  // another button is disabled in this button's dropdown so duplicates can't be chosen. Wheel is fixed.
  // Each of the 3 buttons holds exactly one action; checking a cell that is taken by another
  // button swaps them, so no action is ever assigned to two buttons. (Wheel is fixed to zoom.)
  const MOUSE_ACTIONS=[['rotate','Rotate'],['pan','Pan'],['zoom','Zoom'],['select','Select']];
  const MOUSE_BTNS=[['left','Left'],['right','Right'],['middle','Middle']];
  function setMouseAction(btn,action){
    const cur=settings.mouse.buttons; if(cur[btn]===action){ buildMouseMatrix(); return; }
    const prev=cur[btn];
    ['left','right','middle'].forEach(b=>{ if(b!==btn&&cur[b]===action)cur[b]=prev; });
    cur[btn]=action; state.mousePreset='custom'; resetMouseDrag(); buildMouseMatrix();
    setStatus('Mouse: L '+cur.left+' / R '+cur.right+' / M '+cur.middle);
  }
  function buildMouseMatrix(){
    const wrap=$('mouseMatrix'); if(!wrap)return; wrap.innerHTML='';
    const grid=document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:84px repeat(4,1fr);gap:9px 8px;align-items:center';
    grid.appendChild(document.createElement('span'));
    MOUSE_ACTIONS.forEach(a=>{ const h=document.createElement('span'); h.textContent=a[1]; h.style.cssText='font-size:11px;color:#8f8f8f;text-align:center'; grid.appendChild(h); });
    MOUSE_BTNS.forEach(b=>{
      const lab=document.createElement('span'); lab.textContent=b[1]+' button'; lab.style.cssText='font-size:12px;color:#aaa'; grid.appendChild(lab);
      MOUSE_ACTIONS.forEach(a=>{
        const cell=document.createElement('div'); cell.style.cssText='display:flex;align-items:center;justify-content:center;cursor:pointer';
        const on=settings.mouse.buttons[b[0]]===a[0];
        const box=document.createElement('span'); box.textContent=on?'\u2713':'';
        box.style.cssText='display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;font-size:12px;line-height:1;'+(on?'background:#2f86d6;color:#fff;border:1px solid #2f86d6':'background:#1f1f1f;border:1px solid #555;color:transparent');
        cell.appendChild(box); cell.onclick=function(){ setMouseAction(b[0],a[0]); };
        grid.appendChild(cell);
      });
    });
    wrap.appendChild(grid);
  }
  function openSettings(){
    buildMouseMatrix();
    $('setCarbonByChain').checked=state.carbonByChain;
    $('setHbond').value=state.hbondCutoff; $('hbondVal').textContent=Number(state.hbondCutoff).toFixed(2);
    $('setSalt').value=state.saltCutoff; $('saltVal').textContent=Number(state.saltCutoff).toFixed(1);
    setBackground(state.bgColor); buildChainColorList();
    $('settingsOverlay').style.display='flex'; setBtnActive($('settingsBtn'),true);
  }
  function closeSettings(){ $('settingsOverlay').style.display='none'; setBtnActive($('settingsBtn'),false); }

  function cloneSelector(sel){
    if(sel==null)return {};
    if(typeof sel!=='object')return sel;
    if(Array.isArray(sel))return sel.map(cloneSelector);
    const out={};
    Object.keys(sel).forEach(k=>{ out[k]=typeof sel[k]==='function'?sel[k]:cloneSelector(sel[k]); });
    return out;
  }
  function cloneMouseSettings(){ return {buttons:Object.assign({},settings.mouse.buttons),wheel:settings.mouse.wheel}; }
  function setMousePreset(preset){
    const next=preset==='default'?'default':(preset==='custom'?'custom':'select-left');
    state.mousePreset=next;
    if(next==='select-left'){ settings.mouse.buttons=Object.assign({},mousePresets['select-left'].buttons); settings.mouse.wheel=mousePresets['select-left'].wheel; }
    resetMouseDrag();
    buildMouseMatrix();
    setStatus('Mouse preset: '+next);
    return next;
  }
  function setMouseActions(actions){
    const next=actions||{}, buttons=next.buttons||next;
    ['left','right','middle'].forEach(btn=>{ if(buttons[btn]!=null)settings.mouse.buttons[btn]=normText(buttons[btn]).toLowerCase(); });
    if(next.wheel!=null||next.wheelAction!=null)settings.mouse.wheel=normText(next.wheel!=null?next.wheel:next.wheelAction).toLowerCase();
    state.mousePreset='custom';
    resetMouseDrag();
    buildMouseMatrix();
    setStatus('Mouse: L '+settings.mouse.buttons.left+' / R '+settings.mouse.buttons.right+' / M '+settings.mouse.buttons.middle+' / W '+settings.mouse.wheel);
    return cloneMouseSettings();
  }
  function clearStyles(){ state.styleRules=[]; state.hiddenRules=[]; applyStylesFull(true); }
  function setProteinBackboneStyle(representation){
    let rep=normText(representation||'cartoon').toLowerCase();
    if(rep==='hide')rep='off';
    state.baseProtein=(rep==='tube'||rep==='off')?rep:'cartoon';
    if($('proteinStyle'))$('proteinStyle').value=state.baseProtein;
    applyStylesFull(true);
    return state.baseProtein;
  }
  function setProteinAtomStyle(representation){
    let rep=normText(representation||'off').toLowerCase();
    if(rep==='hide')rep='off';
    state.proteinAtoms=ATOM_REPS.has(rep)?rep:'off';
    if($('proteinAtomStyle'))$('proteinAtomStyle').value=state.proteinAtoms;
    applyStylesFull(true);
    return state.proteinAtoms;
  }
  function setBaseStyle(representation){
    const rep=normText(representation||'cartoon').toLowerCase();
    if(ATOM_REPS.has(rep))return setProteinAtomStyle(rep);
    return setProteinBackboneStyle(rep);
  }
  function setLigandStyle(representation){ state.ligand=normText(representation||'stick').toLowerCase(); if($('ligandStyle'))$('ligandStyle').value=state.ligand; applyStylesFull(true); }
  function runCompat(command){
    if(!command||typeof command!=='object'||Array.isArray(command))throw new Error('String commands are disabled. Use structured molAgent API calls.');
    const type=normText(command.type||command.action).toLowerCase();
    if(type==='selection'||type==='setselection')return setSelection(command.selector||command.target||{},command.options||command);
    if(type==='clearselection')return clearSelection();
    if(type==='focus')return focus(command.selector||command.target||state.selectionSel);
    if(type==='style'){ state.styleRules.push({selector:command.selector||command.target||{},representation:command.representation||command.style||'cartoon',options:command.options||command}); applyStylesFull(true); return state.styleRules[state.styleRules.length-1]; }
    if(type==='hide'){ state.hiddenRules.push({selector:command.selector||command.target||{},representation:'hide',options:command.options||command}); applyStylesFull(true); return state.hiddenRules[state.hiddenRules.length-1]; }
    throw new Error('Unsupported run() command type: '+(type||'-'));
  }
  window.molAgent={
    setSelection, setSelectionHighlight, clearSelection, focus,
    style:function(selector,representation,options){ const rule={selector:selector||{},representation:representation||'cartoon',options:options||{}}; state.styleRules.push(rule); applyStylesFull(true); return rule; },
    clearStyle:clearStyles, clearStyles, setBaseStyle, setProteinBackboneStyle, setProteinAtomStyle, setLigandStyle,
    setMousePreset, getMousePreset:function(){ return state.mousePreset; }, setMouseActions, getMouseActions:cloneMouseSettings,
    selectAtoms:function(selector){ return filterAtoms(selector).map(a=>Object.assign({},a)); },
    getState:function(){ return {file:currentName,atoms:atoms.length,proteinBackbone:state.baseProtein,proteinAtoms:state.proteinAtoms,ligand:state.ligand,mousePreset:state.mousePreset,mouseActions:cloneMouseSettings(),selection:cloneSelector(state.selectionSel),selectionHighlight:{representation:state.selectionRepresentation,options:cloneSelector(state.selectionOptions)},styleRules:cloneSelector(state.styleRules),hiddenRules:cloneSelector(state.hiddenRules)}; },
    loadUrl, run:runCompat, viewer:function(){ return viewer; }, model:function(){ return model; }
  };

  // ---------- Wire UI ----------
  $('selLevel').onchange=function(){ state.selectionMode=$('selLevel').value; state.rangeAnchor=null; setStatus('Selection level: '+state.selectionMode); };
  $('qsP').onclick=function(){ setSelection({predicateName:'protein',not:{hetflag:true}},{}); setSelection({hetflag:false},{}); focus({hetflag:false}); };
  $('qsL').onclick=function(){ const lig=atoms.filter(isLigand); const sel=serialSelectorForAtoms(lig); if(sel){ setSelection(sel,{}); focus(sel); } else setStatus('No ligand'); };
  $('qsS').onclick=function(){ setSelection({resn:Array.from(waterNames)},{}); };
  $('qsAll').onclick=function(){ setSelection({},{}); focus({}); };
  $('interBtn').onclick=toggleInterPanel;
  $('interClose').onclick=closeInterPanel;
  $('btnFit').onclick=function(){ if(viewer){ viewer.zoomTo(); viewer.render(); } };
  $('btnFocus').onclick=function(){ focus(state.selectionSel); };
  $('btnClear').onclick=clearSelection;
  $('styleBtn').onclick=function(){ const p=$('stylePopover'); p.hidden=!p.hidden; };
  $('styleClose').onclick=function(){ $('stylePopover').hidden=true; };
  $('proteinStyle').onchange=function(){ state.baseProtein=$('proteinStyle').value; applyStylesFull(true); };
  $('proteinAtomStyle').onchange=function(){ state.proteinAtoms=$('proteinAtomStyle').value; applyStylesFull(true); };
  $('ligandStyle').onchange=function(){ state.ligand=$('ligandStyle').value; applyStylesFull(true); };
  $('clipNear').oninput=applyClip; $('clipFar').oninput=applyClip;
  $('resetClip').onclick=function(){ $('clipNear').value=-100; $('clipFar').value=100; applyClip(); };
  $('settingsBtn').onclick=function(){ if($('settingsOverlay').style.display==='flex')closeSettings(); else openSettings(); };
  $('settingsClose').onclick=closeSettings;
  $('settingsDone').onclick=closeSettings;
  $('settingsOverlay').addEventListener('mousedown',function(e){ if(e.target===$('settingsOverlay'))closeSettings(); });
  $('setCarbonByChain').onchange=function(){ state.carbonByChain=$('setCarbonByChain').checked; applyStylesFull(true); };
  $('setHbond').oninput=function(){ state.hbondCutoff=Number($('setHbond').value); $('hbondVal').textContent=state.hbondCutoff.toFixed(2); redrawInteractions(true); };
  $('setSalt').oninput=function(){ state.saltCutoff=Number($('setSalt').value); $('saltVal').textContent=state.saltCutoff.toFixed(1); redrawInteractions(true); };
  document.querySelectorAll('#bgSwatches [data-bg]').forEach(b=>{ b.onclick=function(){ setBackground(b.getAttribute('data-bg')); }; });
  $('bgCustom').oninput=function(){ setBackground($('bgCustom').value); };
  $('resetChainColors').onclick=function(){ Object.keys(chainColors).forEach(k=>delete chainColors[k]); Object.assign(chainColors,defaultChainColors); applyStylesFull(true); buildHierarchy(); drawNavigator(); buildChainColorList(); };
  $('settingsReset').onclick=function(){ Object.keys(chainColors).forEach(k=>delete chainColors[k]); Object.assign(chainColors,defaultChainColors); state.baseProtein='cartoon'; state.proteinAtoms='off'; state.ligand='stick'; if($('proteinStyle'))$('proteinStyle').value=state.baseProtein; if($('proteinAtomStyle'))$('proteinAtomStyle').value=state.proteinAtoms; if($('ligandStyle'))$('ligandStyle').value=state.ligand; state.carbonByChain=true; state.hbondCutoff=3.6; state.saltCutoff=4.2; state.selectionRepresentation='line'; state.selectionOptions=defaultSelectionOptions(); settings.mouse.buttons=Object.assign({},mousePresets['select-left'].buttons); settings.mouse.wheel='zoom'; state.mousePreset='select-left'; resetMouseDrag(); setBackground('#000000'); applyStylesFull(true); buildHierarchy(); drawNavigator(); openSettings(); };
  $('saveView').onclick=function(){ if(viewer){ savedView=viewer.getView(); setStatus('View saved'); } };
  $('restoreView').onclick=function(){ if(viewer&&savedView){ viewer.setView(savedView); viewer.render(); setStatus('View restored'); } };
  $('lockView').onclick=function(){ state.locked=!state.locked; setBtnActive($('lockView'),state.locked); setStatus(state.locked?'View locked':'View unlocked'); };
  $('curSelChk').onchange=function(){ if(!$('curSelChk').checked)clearSelection(); };
  $('findGo').onclick=runFind;
  $('findInput').addEventListener('keydown',function(e){ if(e.key==='Enter'){ runFind(); e.preventDefault(); } });
  $('findClear').onclick=function(){ $('findInput').value=''; findMatches=[]; findIndex=-1; $('findCount').textContent='0 matches'; $('findSel').textContent=''; clearSelection(); };
  $('findPrev').onclick=function(){ stepFind(-1); };
  $('findNext').onclick=function(){ stepFind(1); };
  $('addRef').onclick=function(){ loadUrl('data/8UCD.pdb','pdb','8UCD','8UCD - prepared','8UCD').catch(err=>setStatus('Load failed: '+err.message)); };
  $('add6bgt').onclick=function(){ loadUrl('data/steap1_complex_seed2.pdb','pdb','steap1_complex_seed2','Prediction','').catch(err=>setStatus('Load failed: '+err.message)); };
  $('fileInput').onchange=async function(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; const data=await f.text(); const e2={name:f.name,title:f.name,pdbId:'',data,fmt:inferFormat(f.name)}; if(!entries.some(x=>x.name===f.name))entries.push(e2); loadEntry(e2); };

  window.addEventListener('keydown',function(e){
    const tag=document.activeElement&&document.activeElement.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'){ return; }
    if(e.key==='z'||e.key==='Z'){ if(!e.repeat)toggleFocus(); }
    if(e.key==='Escape'){ if($('settingsOverlay').style.display==='flex'){ closeSettings(); } else if(!$('stylePopover').hidden){ $('stylePopover').hidden=true; } else if(!$('interPanel').hidden){ closeInterPanel(); } else clearSelection(); }
  });

  $('stylePopover').hidden=true;
  $('interPanel').hidden=true;
  buildInterPanel();
  initViewer();
  startFpsOverlay();
  $('selLevel').value=state.selectionMode;
  loadUrl('data/8UCD.pdb','pdb','8UCD','8UCD - prepared','8UCD').catch(err=>setStatus('Load failed: '+err.message+'  (use Open file)'));
}
function waitFor3Dmol(){
  if(window.$3Dmol){ boot(); return; }
  setTimeout(waitFor3Dmol, 40);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitFor3Dmol);
else waitFor3Dmol();
})();
