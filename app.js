(function(){
'use strict';
function boot(){
  const $ = id => document.getElementById(id);
  const viewerEl = $('viewer');
  const dragSelectBoxEl = $('dragSelectBox');
  const statusEl = $('status');

  let viewer = null, model = null, models = [], atoms = [], atomByIndex = new Map(), atomByEntryIndex = new Map(), atomByEntrySourceSerial = new Map(), atomBySerial = new Map(), currentStructureKey = '', savedView = null, hoverClearTimer = null;
  let atomsByEntry = new Map(), atomsByChain = new Map(), atomsByEntryChain = new Map(), atomsByEntryChainResidue = new Map(), atomsByEntryChainResidueName = new Map();
  const entryModelCache = new Map();
  let nextAtomSerial = 1;
  let styleGeneration = 1;
  const entries = [];
  const entryChecked = Object.create(null);
  let displayedCount = 0;
  let lastSessionRevision = null, sessionSyncTimer = null, sessionSyncInFlight = false, suppressSessionPollUntil = 0;

  const waterNames = new Set(['HOH','WAT','DOD','H2O']);
  const ionNames = new Set(['NA','CL','K','MG','CA','ZN','MN','FE','CU','CO','NI','CD','HG','SR','BA','CS','RB','LI','AL','IOD','BR']);
  const backboneAtoms = new Set(['N','CA','C','O','OXT']);
  const aa3to1 = {ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',HIE:'H',HID:'H',HIP:'H',ILE:'I',LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V',MSE:'M',SEC:'U',PYL:'O'};
  const aromaticDefs = {PHE:['CG','CD1','CD2','CE1','CE2','CZ'],TYR:['CG','CD1','CD2','CE1','CE2','CZ'],TRP:['CD2','CE2','CE3','CZ2','CZ3','CH2'],HIS:['CG','ND1','CD2','CE1','NE2'],HIE:['CG','ND1','CD2','CE1','NE2'],HID:['CG','ND1','CD2','CE1','NE2'],HIP:['CG','ND1','CD2','CE1','NE2']};
  // Defaults copied from the user's Maestro chain/element color schemes.
  const chainColors = {A:'#00CC00',B:'#2E96FF',C:'#FFFF2E',D:'#FF2E2E',E:'#B5FF6B',F:'#2E2EFF',G:'#962EFF',H:'#FF962E',I:'#FE2EFF',J:'#FF2E96',K:'#6BFFFF',L:'#CB2EFF',M:'#00CCCC',N:'#FFDA6B',O:'#6BFF6B',P:'#6BB5FF',Q:'#6B6BFF',R:'#B56BFF',S:'#FFADAD',T:'#FF6BB5',U:'#DA6BFF',V:'#808080',W:'#90CC90',X:'#BFBFBF',Y:'#F39AF9',Z:'#E5E5E5'};
  const elemColors = {H:'#FFFFFF',B:'#2EFF2E',C:'#808080',N:'#2E2EFF',O:'#FF2E2E',F:'#6BFFB5',SI:'#FF962E',P:'#CC0066',S:'#FFFF6B',CL:'#008C00',BR:'#8C0000',I:'#FF2EFF',LI:'#FF6B6B',NA:'#FF6B6B',K:'#FF6B6B',RB:'#FF6B6B',CS:'#FF6B6B',FR:'#FF6B6B',BE:'#FF6BFF',MG:'#FF6BFF',CA:'#FF6BFF',SR:'#FF6BFF',BA:'#FF6BFF',RA:'#FF6BFF',HE:'#FF6BB5',NE:'#FF6BB5',AR:'#FF6BB5',KR:'#FF6BB5',XE:'#FF6BB5',RN:'#FF6BB5',AL:'#FFCB2E',GA:'#FFCB2E',GE:'#FFCB2E',IN:'#FFCB2E',SN:'#FFCB2E',SB:'#FFCB2E',TL:'#FFCB2E',PB:'#FFCB2E',BI:'#FFCB2E',PO:'#FFCB2E',AS:'#FF906B',SE:'#FF906B',TE:'#FF906B',AT:'#FF906B',SC:'#E6E6E6',TI:'#BFC2C7',V:'#A6A6AB',CR:'#8A99C7',MN:'#9C7AC7',FE:'#E54D00',CO:'#4D33CC',NI:'#00CC66',CU:'#CC4D1A',ZN:'#7D80B0',Y:'#94FFFF',ZR:'#94E0E0',NB:'#73C2C9',MO:'#54B5B5',TC:'#3B9E9E',RU:'#248F8F',RH:'#0A7D8C',PD:'#006985',AG:'#C0C0C0',CD:'#FFD98F',HF:'#4DC2FF',TA:'#4DA6FF',W:'#2194D6',RE:'#267DAB',OS:'#266696',IR:'#175487',PT:'#D0D0E0',AU:'#FFD123',HG:'#B8B8D0',LA:'#70D4FF',CE:'#FFFFC7',PR:'#D9FFC7',ND:'#C7FFC7',PM:'#A3FFC7',SM:'#8FFFC7',EU:'#61FFC7',GD:'#45FFC7',TB:'#30FFC7',DY:'#1FFFC7',HO:'#00FF9C',ER:'#00E675',TM:'#00D452',YB:'#00BF38',LU:'#00AB24',AC:'#70ABFA',TH:'#00BAFF',PA:'#00A1FF',U:'#008FFF',NP:'#0080FF',PU:'#006BFF',AM:'#545CF2',CM:'#785CE3',BK:'#8A4FE3',CF:'#A136D4',ES:'#B31FD4',FM:'#B31FBA',MD:'#B30DA6',NO:'#B30DA6',LR:'#C70066',RF:'#404040',DB:'#404040',SG:'#404040'};
  const elementColorKeys = Object.keys(elemColors);
  const lineWidths = {fallback:2,selection:2,protein:2,ligand:2,tube:2,interaction:2};
  const DEFAULT_VISUAL_CONFIG = {
    cpk:{stickRadius:{},sphereScale:{},vdwRadii:{}}
  };
  const INTERACTION_INDEX_SCHEMA = 'interaction-index-v6';
  const INTERACTION_INDEX_API = 'api/interaction-index/';
  const INTERACTION_CRITERIA = {
    hbond:{indexMaxDistance:4.0,maxDistance:2.8,minDonorAngle:120,minAcceptorAngle:90,maxAcceptorAngle:360},
    halogen:{maxDistance:3.5,minDonorAngle:140,minAcceptorAngle:90,maxAcceptorAngle:360},
    salt:{indexCutoff:5.5,cutoff:5.0,excludeCovalentDepth:3},
    pication:{maxDistance:6.6,maxAngle:30},
    pipi:{faceMaxDistance:4.4,faceMaxAngle:30,edgeMaxDistance:5.5,edgeMinAngle:60},
    contact:{maxDistance:4.8,minDistance:2.0,goodCutoffRatio:1.3,badCutoffRatio:0.89,uglyCutoffRatio:0.75,maxInteractions:12000}
  };
  const VIEWER_SESSION_API = 'api/session';
  const VIEWER_SESSION_ENTRY_API = 'api/session-entry';
  const VIEWER_SESSION_ENTRY_TITLE_API = 'api/session-entry-title';
  const VIEWER_SESSION_META_API = 'api/session-meta';
  const VIEWER_SESSION_STATE_API = 'api/session-state';
  const LAST_STRUCTURE_API = 'api/last-structure';
  const PREFERENCES_API = 'api/preferences';
  const STRUCTURE_CONVERT_API = 'api/convert-structure';

  const mousePresets = {'select-left':{buttons:{left:'select',right:'rotate',middle:'pan'},wheel:'zoom'},'default':{passThrough:true}};
  function defaultSelectionOptions(){ return {color:'#fdd835',opacity:1,linewidth:lineWidths.selection}; }
  const ATOM_REP_VALUES = ['line','stick','sphere','cpk'];
  const ATOM_REP_OPTIONS = new Set(ATOM_REP_VALUES);
  const BACKBONE_REP_OPTIONS = new Set(['cartoon','tube','off']);
  const LARGE_SELECTOR_ARRAY_LIMIT = 32;
  const LARGE_SELECTION_STYLE_ATOM_LIMIT = 1500;
  const LARGE_SELECTION_EXACT_HIGHLIGHT_LIMIT = 1500;
  const LARGE_SELECTION_REPRESENTATIVE_ATOM_LIMIT = 600;
  const HUGE_FIT_ATOM_LIMIT = 100000;
  const SELECTION_DRAW_BUDGET_MS = 10;
  const LARGE_INTERACTION_INDEX_ATOM_LIMIT = 100000;
  const SELECTOR_SPECIAL_KEYS = new Set(['not','or','and']);
  const state = {
    baseProtein:'cartoon', proteinAtoms:'off', ligand:'stick', solvent:'off', other:'stick',
    styleRules:[], hiddenRules:[],
    selectionSel:null, selectionRepresentation:'line', selectionOptions:defaultSelectionOptions(), selectionMode:'residue',
    focusTarget:null, mousePreset:'select-left',
    visibility:{protein:true,ligands:true,solvents:true,other:true}, chainVisible:{}, groupVisible:{}, hierarchyCollapsed:{},
    bgColor:'#000000', carbonByChain:true, hbondCutoff:2.8, saltCutoff:5.0,
    locked:false
  };
  const defaultChainColors = Object.assign({}, chainColors);
  const defaultElementColors = Object.assign({}, elemColors);
  const settings = {mouse:{buttons:Object.assign({},mousePresets['select-left'].buttons), wheel:mousePresets['select-left'].wheel}};
  let visualConfig = clonePlain(DEFAULT_VISUAL_CONFIG);
  let findMatches = [], findIndex = -1;
  let selectionAtoms = [];
  let selectionStyleActive = false;
  let selectionShapes = [];
  let selectionHighlightJob = 0;
  let entryLoadSeq = 0;
  let selectedLineBondKeys = new Set();
  let lineSelectionStyleMaskActive = false;
  let hierarchyRows = [];
  let hierarchySelectionAnchorKey = '';
  let wideLineLayer = null;
  let interactionShapes = [];
  let interactionWideLines = [];
  const interactionIndexByKey = new Map();
  const interactionWorkers = new Map();
  const interactionBuildQueue = [];
  const MAX_INTERACTION_WORKERS = 1;
  let interactionBuildSeq = 0;
  let interactionIndex = {status:'empty',jobId:0,interactions:null,counts:{}};
  let proteinResidueLikeCache = null;
  let resetMouseDrag = function(){};
  let preferencesSaveTimer = null;
  let panelRefreshTimer = null;
  let interactionStartTimer = null;
  let busyToken = 0;

  function setStatus(t){ if(statusEl)statusEl.textContent = t || ''; }
  function showBusy(label){
    const overlay=$('busyOverlay'), text=$('busyLabel');
    if(text)text.textContent=label||'Working...';
    if(overlay)overlay.hidden=false;
    setStatus(label||'Working...');
  }
  function hideBusy(token){
    if(token&&token!==busyToken)return;
    const overlay=$('busyOverlay');
    if(overlay)overlay.hidden=true;
  }
  function afterNextPaint(){
    return new Promise(resolve=>{
      if(typeof requestAnimationFrame!=='function'){ setTimeout(resolve,0); return; }
      requestAnimationFrame(()=>setTimeout(resolve,0));
    });
  }
  async function withBusy(label,work){
    const token=++busyToken;
    showBusy(label);
    await afterNextPaint();
    try{ return await work(); }
    finally{ setTimeout(()=>hideBusy(token),80); }
  }
  function normText(v){ return String(v==null?'':v).trim(); }
  function normUpper(v){ return normText(v).toUpperCase(); }
  function fnv1aHex(text){
    let h=0x811c9dc5;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0;
    }
    return ('00000000'+h.toString(16)).slice(-8);
  }
  function structureCacheKey(e){
    const data=String(e&&e.data||''),fmt=normText(e&&e.fmt||'pdb').toLowerCase();
    return fmt+'-'+data.length.toString(36)+'-'+fnv1aHex(data);
  }
  function clonePlain(v){ return JSON.parse(JSON.stringify(v)); }
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
  function positiveNumber(v,fallback){ const n=Number(v); return Number.isFinite(n)&&n>0?n:fallback; }
  function configuredNumber(group,context,fallback){
    const obj=visualConfig.cpk&&visualConfig.cpk[group]||{};
    return positiveNumber(obj[context],positiveNumber(obj.default,fallback));
  }
  function cpkStyleSpec(colorfunc,opacity,context,o){
    o=o||{};
    const stickRadius=positiveNumber(o.radius,configuredNumber('stickRadius',context||'default'));
    const sphereScale=positiveNumber(o.scale,configuredNumber('sphereScale',context||'default'));
    const stick={colorfunc,opacity},sphere={colorfunc,opacity};
    if(stickRadius!=null)stick.radius=stickRadius;
    if(sphereScale!=null)sphere.scale=sphereScale;
    return {stick,sphere};
  }
  function applyVdwRadiiConfig(){
    const target=window.$3Dmol&&window.$3Dmol.GLModel&&window.$3Dmol.GLModel.vdwRadii;
    const radii=visualConfig.cpk&&visualConfig.cpk.vdwRadii;
    if(!target||!radii)return;
    Object.keys(radii).forEach(k=>{ const n=Number(radii[k]); if(Number.isFinite(n)&&n>0)target[k]=n; });
  }
  async function loadVisualConfig(){
    visualConfig=clonePlain(DEFAULT_VISUAL_CONFIG);
    try{
      const res=await fetch('config/visualization.json',{cache:'no-store'});
      if(res.ok)mergePlain(visualConfig,await res.json());
    }catch(e){}
    applyVdwRadiiConfig();
    return clonePlain(visualConfig);
  }
  function preferencesPayload(){
    return {
      schema:'viewer-preferences-v1',
      mousePreset:state.mousePreset,
      mouse:cloneMouseSettings(),
      representations:{
        proteinBackbone:state.baseProtein,
        proteinAtoms:state.proteinAtoms,
        ligand:state.ligand,
        solvent:state.solvent,
        other:state.other
      },
      chainColors:Object.assign({},chainColors),
      atomColors:Object.assign({},elemColors),
      carbonByChain:state.carbonByChain,
      backgroundColor:toHex(state.bgColor)
    };
  }
  function savePreferencesNow(){
    if(preferencesSaveTimer){
      clearTimeout(preferencesSaveTimer);
      preferencesSaveTimer=null;
    }
    return fetchJsonResult(PREFERENCES_API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(preferencesPayload())}).then(result=>{
      if(!result.ok)return reportPersistenceFailure('Preferences',result);
      return result.data;
    });
  }
  function savePreferences(){
    if(preferencesSaveTimer)clearTimeout(preferencesSaveTimer);
    preferencesSaveTimer=setTimeout(function(){
      preferencesSaveTimer=null;
      savePreferencesNow();
    },150);
  }
  function normalizedBackboneRepresentation(value,fallback){
    let rep=normText(value||fallback).toLowerCase();
    if(rep==='hide')rep='off';
    return BACKBONE_REP_OPTIONS.has(rep)?rep:fallback;
  }
  function normalizedAtomRepresentation(value,fallback){
    let rep=normText(value||fallback).toLowerCase();
    if(rep==='hide')rep='off';
    return rep==='off'||ATOM_REP_OPTIONS.has(rep)?rep:fallback;
  }
  function syncRepresentationControls(){
    if($('repBackbone'))$('repBackbone').value=state.baseProtein;
    if($('repProtein'))$('repProtein').value=state.proteinAtoms;
    if($('repLigand'))$('repLigand').value=state.ligand;
    if($('repSolvent'))$('repSolvent').value=state.solvent;
    if($('repOther'))$('repOther').value=state.other;
  }
  function applyRepresentationPreferences(payload){
    const reps=payload&&payload.representations;
    if(!reps||typeof reps!=='object')return;
    state.baseProtein=normalizedBackboneRepresentation(reps.proteinBackbone||reps.baseProtein,state.baseProtein);
    state.proteinAtoms=normalizedAtomRepresentation(reps.proteinAtoms,state.proteinAtoms);
    state.ligand=normalizedAtomRepresentation(reps.ligand,state.ligand);
    state.solvent=normalizedAtomRepresentation(reps.solvent,state.solvent);
    state.other=normalizedAtomRepresentation(reps.other,state.other);
    syncRepresentationControls();
  }
  function applyPreferences(payload){
    if(!payload||typeof payload!=='object')return null;
    applyRepresentationPreferences(payload);
    if(payload.chainColors&&typeof payload.chainColors==='object'){
      Object.keys(chainColors).forEach(k=>delete chainColors[k]);
      Object.assign(chainColors,defaultChainColors);
      Object.keys(payload.chainColors).forEach(k=>{
        const chain=normText(k).toUpperCase(), color=toHex(payload.chainColors[k]);
        if(/^[A-Z]$/.test(chain))chainColors[chain]=color;
      });
    }
    if(payload.atomColors&&typeof payload.atomColors==='object'){
      Object.keys(elemColors).forEach(k=>delete elemColors[k]);
      Object.assign(elemColors,defaultElementColors);
      Object.keys(payload.atomColors).forEach(k=>{
        const elem=normText(k).toUpperCase(), color=toHex(payload.atomColors[k]);
        if(isEditableElementKey(elem))elemColors[elem]=color;
      });
    }
    if(typeof payload.carbonByChain==='boolean')state.carbonByChain=payload.carbonByChain;
    if(payload.backgroundColor)setBackground(payload.backgroundColor,{persist:false});
    if(payload.mousePreset==='default')setMousePreset('default',{persist:false,status:false});
    else if(payload.mouse)setMouseActions(payload.mouse,{persist:false,status:false,preset:payload.mousePreset||'custom'});
    else if(payload.mousePreset==='select-left')setMousePreset('select-left',{persist:false,status:false});
    return payload;
  }
  function loadPreferences(){
    return fetch(PREFERENCES_API,{cache:'no-store'}).then(res=>{
      if(!res.ok)return null;
      return res.json();
    }).then(payload=>applyPreferences(payload)).catch(()=>null);
  }
  async function fetchJsonResult(url,options){
    try{
      const res=await fetch(url,options||{});
      const text=await res.text();
      let data=null;
      if(text){
        try{ data=JSON.parse(text); }catch(err){ data=null; }
      }
      if(res.ok)return {ok:true,status:res.status,data};
      return {ok:false,status:res.status,statusText:res.statusText,data,error:(data&&(data.error||data.message))||text||res.statusText||('HTTP '+res.status)};
    }catch(err){
      return {ok:false,status:0,statusText:'Network error',error:(err&&err.message)||String(err)};
    }
  }
  function persistenceErrorText(result){
    if(!result)return 'unknown error';
    return result.error||result.statusText||('HTTP '+result.status);
  }
  function reportPersistenceFailure(label,result,opts){
    const message=label+' not saved: '+persistenceErrorText(result);
    console.warn(message,result||'');
    if(!opts||opts.status!==false)setStatus(message);
    return false;
  }
  function sameStringArray(a,b){
    if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(String(a[i])!==String(b[i]))return false;
    return true;
  }
  function afterNextFrame(){
    return new Promise(resolve=>{
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>resolve());
      else setTimeout(resolve,0);
    });
  }
  function normalizeStructureEntry(e){
    if(!e||typeof e.data!=='string'||!e.data.trim())return null;
    const name=normText(e.name||'structure');
    return {name,title:normText(e.title||name),pdbId:normText(e.pdbId||''),data:e.data,fmt:normText(e.fmt||inferFormat(name)||'pdb').toLowerCase()};
  }
  function uniqueEntryName(base){
    const root=normText(base||'structure')||'structure';
    const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,17);
    let candidate=root+'__'+stamp+'-'+(++entryLoadSeq);
    while(entries.some(entry=>entry.name===candidate)||entryModelCache.has(candidate)){
      candidate=root+'__'+stamp+'-'+(++entryLoadSeq);
    }
    return candidate;
  }
  function entryWithFreshIdentity(entry,title){
    entry=normalizeStructureEntry(entry);
    if(!entry)return null;
    const displayTitle=normText(title||entry.title||entry.name)||entry.name;
    return Object.assign({},entry,{name:uniqueEntryName(entry.name||displayTitle),title:displayTitle});
  }
  function normalizeViewerSession(payload){
    if(!payload||typeof payload!=='object'||!Array.isArray(payload.entries))return null;
    const out=[],seen=new Set();
    payload.entries.forEach(raw=>{
      const entry=normalizeStructureEntry(raw&&raw.entry?raw.entry:raw);
      if(!entry)return;
      const existing=out.findIndex(e=>e.name===entry.name);
      if(existing>=0)out[existing]=entry;
      else{ seen.add(entry.name); out.push(entry); }
    });
    if(!out.length)return null;
    const names=new Set(out.map(e=>e.name));
    const hasIncluded=Array.isArray(payload.includedEntries);
    let included=hasIncluded?payload.includedEntries.map(String).filter(name=>names.has(name)):out.map(e=>e.name);
    return {entries:out,includedEntries:included};
  }
  function rememberSessionMeta(meta){
    if(meta&&meta.revision!=null)lastSessionRevision=String(meta.revision);
  }
  function rememberSessionResponse(payload){
    if(!payload||typeof payload!=='object')return;
    if(payload.revision!=null)rememberSessionMeta(payload);
    else if(payload.session)rememberSessionMeta(payload.session);
  }
  function loadSessionMeta(){
    return fetch(VIEWER_SESSION_META_API,{cache:'no-store'}).then(res=>{
      if(!res.ok)return null;
      return res.json();
    }).catch(()=>null);
  }
  function viewerSessionPayload(){
    const clean=entries.map(normalizeStructureEntry).filter(Boolean);
    if(!clean.length)return null;
    let included=clean.filter(e=>entryChecked[e.name]!==false).map(e=>e.name);
    return {entries:clean,includedEntries:included};
  }
  function saveViewerSession(opts){
    opts=opts||{};
    const payload=viewerSessionPayload();
    suppressSessionPollUntil=Date.now()+1500;
    const request=payload?fetchJsonResult(VIEWER_SESSION_API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}):fetchJsonResult(VIEWER_SESSION_API,{method:'DELETE'});
    return request.then(result=>{
      if(!result.ok)return reportPersistenceFailure('Viewer session',result,opts);
      rememberSessionResponse(result.data);
      return true;
    });
  }
  function saveViewerSessionEntry(entry,opts){
    opts=opts||{};
    const clean=normalizeStructureEntry(entry);
    if(!clean)return Promise.resolve(false);
    suppressSessionPollUntil=Date.now()+1500;
    return fetchJsonResult(VIEWER_SESSION_ENTRY_API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry:clean})}).then(result=>{
      if(!result.ok)return reportPersistenceFailure('Viewer session entry',result,opts);
      rememberSessionResponse(result.data);
      return true;
    });
  }
  function deleteViewerSessionEntry(name,opts){
    opts=opts||{};
    if(!name)return Promise.resolve(false);
    suppressSessionPollUntil=Date.now()+1500;
    return fetchJsonResult(VIEWER_SESSION_ENTRY_API+'/'+encodeURIComponent(name),{method:'DELETE'}).then(result=>{
      if(!result.ok)return reportPersistenceFailure('Viewer session entry delete',result,opts);
      rememberSessionResponse(result.data);
      return true;
    });
  }
  function saveViewerSessionEntryTitle(name,title,opts){
    opts=opts||{};
    const cleanName=normText(name), cleanTitle=normText(title);
    if(!cleanName||!cleanTitle)return Promise.resolve(false);
    suppressSessionPollUntil=Date.now()+1500;
    return fetchJsonResult(VIEWER_SESSION_ENTRY_TITLE_API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:cleanName,title:cleanTitle})}).then(result=>{
      if(!result.ok)return reportPersistenceFailure('Viewer session entry title',result,opts);
      rememberSessionResponse(result.data);
      return true;
    });
  }
  function saveViewerSessionEntryDeferred(entry,opts){
    const size=String(entry&&entry.data||'').length;
    if(size>=5*1024*1024){
      return afterNextFrame().then(()=>saveViewerSessionEntry(entry,opts));
    }
    return saveViewerSessionEntry(entry,opts);
  }
  function viewerSessionStatePayload(){
    const included=entries.filter(e=>entryChecked[e.name]!==false).map(e=>e.name);
    return {includedEntries:included};
  }
  async function saveViewerSessionState(opts){
    opts=opts||{};
    if(!entries.length)return saveViewerSession(opts);
    const payload=viewerSessionStatePayload();
    suppressSessionPollUntil=Date.now()+1500;
    const result=await fetchJsonResult(VIEWER_SESSION_STATE_API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(result.ok){
      rememberSessionResponse(result.data);
      return true;
    }
    const full=viewerSessionPayload();
    if(full&&sameStringArray(full.includedEntries,payload.includedEntries)){
      console.warn('Session state endpoint failed; trying full-session fallback.',result);
      if(await saveViewerSession({status:false}))return true;
    }
    return reportPersistenceFailure('Session state',result,opts);
  }
  function loadViewerSession(opts){
    opts=opts||{};
    return fetch(VIEWER_SESSION_API,{cache:'no-store'}).then(res=>{
      if(!res.ok)return null;
      return res.json();
    }).then(payload=>{ if(opts.remember!==false)rememberSessionResponse(payload); return normalizeViewerSession(payload); }).catch(()=>null);
  }
  function loadLastStructure(){
    return fetch(LAST_STRUCTURE_API,{cache:'no-store'}).then(res=>{
      if(!res.ok)return null;
      return res.json();
    }).then(payload=>{
      const entry=normalizeStructureEntry(payload&&payload.entry?payload.entry:payload);
      return entry?{entries:[entry],includedEntries:[entry.name]}:null;
    }).catch(()=>null);
  }
  function restoreViewerSession(session,opts){
    session=normalizeViewerSession(session);
    if(!session)throw new Error('Invalid viewer session');
    opts=opts||{};
    if(!viewer)initViewer();
    disposeRecordsOutside(session.entries);
    entries.splice(0,entries.length);
    session.entries.forEach(e=>entries.push(e));
    Object.keys(entryChecked).forEach(k=>delete entryChecked[k]);
    session.entries.forEach(e=>{ entryChecked[e.name]=session.includedEntries.includes(e.name); });
    resetDisplayRulesForStructure();
    rebuildDisplayedEntries(opts.realtime?{preserveView:true,zoom:false}:{zoom:true});
    return session;
  }
  function restoreEmptyViewerSession(){
    disposeAllEntryRecords();
    entries.splice(0,entries.length);
    Object.keys(entryChecked).forEach(k=>delete entryChecked[k]);
    resetDisplayRulesForStructure();
    rebuildDisplayedEntries({preserveView:true,zoom:false});
  }
  async function pollViewerSession(){
    if(sessionSyncInFlight||Date.now()<suppressSessionPollUntil)return;
    sessionSyncInFlight=true;
    try{
      const meta=await loadSessionMeta();
      if(!meta||meta.revision==null)return;
      const revision=String(meta.revision);
      if(lastSessionRevision==null){ lastSessionRevision=revision; return; }
      if(revision===lastSessionRevision)return;
      if(!Array.isArray(meta.entries)||!meta.entries.length){
        restoreEmptyViewerSession();
        lastSessionRevision=revision;
        setStatus('Viewer session cleared on server');
        return;
      }
      const session=await loadViewerSession({remember:false});
      if(session){
        restoreViewerSession(session,{realtime:true});
        lastSessionRevision=revision;
        setStatus('Viewer session updated from server');
      }
    }catch(e){
      setStatus('Session sync failed; will retry.');
    }finally{
      sessionSyncInFlight=false;
    }
  }
  function startSessionSync(){
    if(sessionSyncTimer)return;
    sessionSyncTimer=setInterval(pollViewerSession,1500);
  }
  function atomElem(a){
    if(!a)return '';
    if(a._elemKey)return a._elemKey;
    const out=normUpper(a.elem||a.element||a.atom||'').replace(/[^A-Z]/g,'');
    a._elemKey=out;
    return out;
  }
  function atomName(a){ return normUpper(a&&a.atom); }
  function hslHex(h,s,l){
    s/=100; l/=100;
    const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l);
    const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
    const toHex=v=>('0'+Math.round(255*v).toString(16)).slice(-2);
    return '#'+toHex(f(0))+toHex(f(8))+toHex(f(4));
  }
  function chainColor(ch){
    const c=normText(ch||'?'),u=c.toUpperCase();
    if(chainColors[u])return chainColors[u];
    if(u.length>1&&chainColors[u[1]])return chainColors[u[1]];
    let h=0; for(let i=0;i<c.length;i++)h=((h*31)+c.charCodeAt(i))>>>0; return hslHex(h%360,72,64);
  }
  function elementColor(a){ return elemColors[atomElem(a)]||'#D1D5DB'; }
  function isStandardAminoResidueName(r){ return Object.prototype.hasOwnProperty.call(aa3to1,normUpper(r)); }
  function proteinResidueClassKey(a){ return (a._entryName||'')+'\u0001'+(a.chain||'')+'\u0001'+(a.resi==null?'':a.resi)+'\u0001'+normUpper(a.resn); }
  function proteinResidueLikeKeysForAtoms(sourceAtoms){
    const by=new Map();
    (sourceAtoms||[]).forEach(a=>{
      const r=normUpper(a.resn);
      if(!isStandardAminoResidueName(r))return;
      const key=proteinResidueClassKey(a);
      if(!by.has(key))by.set(key,new Set());
      by.get(key).add(atomName(a));
    });
    const out=new Set();
    by.forEach((names,key)=>{
      if(names.has('N')&&names.has('CA')&&names.has('C'))out.add(key);
    });
    return out;
  }
  function proteinResidueLikeKeys(){
    if(proteinResidueLikeCache)return proteinResidueLikeCache;
    proteinResidueLikeCache=proteinResidueLikeKeysForAtoms(atoms);
    return proteinResidueLikeCache;
  }
  function isProteinLikeResidue(a){
    if(!isStandardAminoResidueName(a&&a.resn))return false;
    return proteinResidueLikeKeys().has(proteinResidueClassKey(a));
  }
  function isProtein(a){
    const r=normUpper(a&&a.resn);
    if(waterNames.has(r)||ionNames.has(r))return false;
    return !a.hetflag||isProteinLikeResidue(a);
  }
  function isLigand(a){
    const r=normUpper(a&&a.resn);
    return !!a.hetflag&&!isProtein(a)&&!waterNames.has(r)&&!ionNames.has(r);
  }
  function isPolar(a){ return ['N','O','S'].includes(atomElem(a)); }
  function isHydrogenAtom(a){ return atomElem(a)==='H'; }
  function bondedAtoms(a){ return (a.bonds||[]).map(idx=>atomByEntryIndex.get(atomEntryIndexKey(a._entryName,idx))||atomByIndex.get(idx)).filter(Boolean); }
  function isPolarHydrogen(a){ return isHydrogenAtom(a)&&bondedAtoms(a).some(isPolar); }
  function point(a){ return {x:a.x,y:a.y,z:a.z}; }
  function dist2(a,b){ const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z; return dx*dx+dy*dy+dz*dz; }
  function distance(a,b){ return Math.sqrt(dist2(a,b)); }
  function vecSub(a,b){ return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}; }
  function vecScale(a,s){ return {x:a.x*s,y:a.y*s,z:a.z*s}; }
  function vecDot(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
  function vecCross(a,b){ return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}; }
  function vecLen(a){ return Math.sqrt(vecDot(a,a)); }
  function vecNormalize(a){ const l=vecLen(a); return l>1e-8?vecScale(a,1/l):null; }
  function dihedralDeg(a,b,c,d){
    const b0=vecSub(a,b),b1=vecSub(c,b),b2=vecSub(d,c),b1n=vecNormalize(b1);
    if(!b1n)return null;
    const v=vecSub(b0,vecScale(b1n,vecDot(b0,b1n)));
    const w=vecSub(b2,vecScale(b1n,vecDot(b2,b1n)));
    if(vecLen(v)<1e-8||vecLen(w)<1e-8)return null;
    const x=vecDot(v,w),y=vecDot(vecCross(b1n,v),w);
    return Math.atan2(y,x)*180/Math.PI;
  }
  function atomCategory(a){ const r=normUpper(a.resn); if(waterNames.has(r))return 'solvents'; if(isProtein(a))return 'protein'; if(ionNames.has(r))return 'other'; if(isLigand(a))return 'ligands'; if(a.hetflag)return 'other'; return 'protein'; }
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
    if(rep==='cpk')return cpkStyleSpec(ac,op,'default',o);
    if(rep==='tube')return {cartoon:{style:'trace',ribbon:true,thickness:o.thickness||0.45,colorfunc:rc,opacity:op}};
    return {cartoon:{colorfunc:rc,opacity:op}};
  }
  function mergeStyleSpecs(){
    const out={};
    Array.prototype.forEach.call(arguments,function(spec){
      if(!spec)return;
      Object.keys(spec).forEach(k=>{ out[k]=spec[k]; });
    });
    return out;
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
  function atomRepSpec(rep,colorfunc,ctx,sizes){
    rep=normText(rep||'off').toLowerCase(); sizes=sizes||{};
    if(rep==='off'||rep==='hide'||rep==='line')return {};
    if(rep==='sphere')return {sphere:{scale:sizes.sphere||0.36,colorfunc}};
    if(rep==='cpk')return cpkStyleSpec(colorfunc,1,ctx,{});
    return {stick:{radius:sizes.stick||0.2,colorfunc}};
  }
  function proteinAtomStyleSpec(){ return atomRepSpec(state.proteinAtoms, chainAwareAtomColor, 'protein', {stick:0.14,sphere:0.28}); }
  function ligandStyleSpec(){ return atomRepSpec(state.ligand, elementColor, 'ligand', {stick:0.2,sphere:0.36}); }
  function solventStyleSpec(){ return atomRepSpec(state.solvent, elementColor, 'ligand', {stick:0.16,sphere:0.3}); }
  function otherStyleSpec(){ return atomRepSpec(state.other, elementColor, 'ligand', {stick:0.2,sphere:0.36}); }

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
  function selectorTextKey(v){ return normUpper(v); }
  function selectorResiKey(v){ return normText(v); }
  function selectorEntryChainKey(entry,chain){ return selectorTextKey(entry)+'\u0001'+selectorTextKey(chain); }
  function selectorEntryChainResidueKey(entry,chain,resi){ return selectorEntryChainKey(entry,chain)+'\u0001'+selectorResiKey(resi); }
  function selectorEntryChainResidueNameKey(entry,chain,resi,resn){ return selectorEntryChainResidueKey(entry,chain,resi)+'\u0001'+selectorTextKey(resn); }
  function pushAtomIndex(map,key,a){
    let list=map.get(key);
    if(!list){ list=[]; map.set(key,list); }
    list.push(a);
  }
  function uniqueAtomsInOrder(lists){
    const seen=new Set(),out=[];
    (lists||[]).forEach(list=>{
      (list||[]).forEach(a=>{
        if(!a)return;
        const k=a.serial!=null?'s:'+a.serial:'i:'+(a._entryName||'')+'\u0001'+a.index;
        if(seen.has(k))return;
        seen.add(k);
        out.push(a);
      });
    });
    out.sort((a,b)=>(a.serial||0)-(b.serial||0));
    return out;
  }
  function matchesResolvedSelector(a,sel){
    sel=sel||{};
    if(sel.not&&matchesResolvedSelector(a,sel.not))return false;
    if(sel.or&&!sel.or.some(p=>matchesResolvedSelector(a,p)))return false;
    if(sel.and&&!sel.and.every(p=>matchesResolvedSelector(a,p)))return false;
    for(const k of Object.keys(sel)){ if(SELECTOR_SPECIAL_KEYS.has(k))continue; let av=a[k]; if(k==='elem')av=atomElem(a); if(!matchScalar(av,sel[k],k))return false; }
    return true;
  }
  function serialsForSelector(sel,opts){
    const selected=filterAtoms(sel), sc=opts&&opts.sidechainOnly, out=[];
    for(const a of selected){ if(sc&&(!isProtein(a)||backboneAtoms.has(a.atom)))continue; if(a.serial!=null)out.push(a.serial); }
    return out;
  }
  function styleSelection(sel,opts){ return {serial:serialsForSelector(sel,opts)}; }
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
  function filterAtomsBySerial(want){
    const raw=Array.isArray(want)?want:[want],out=[],seen=new Set();
    for(const s of raw){
      const n=Number(s);
      if(Number.isNaN(n)||seen.has(n))continue;
      seen.add(n);
      const a=atomBySerial.get(n);
      if(a)out.push(a);
    }
    if(out.length>1)out.sort((a,b)=>(Number(a.serial)||0)-(Number(b.serial)||0));
    return out;
  }
  function filterAtomsFastResolved(r){
    r=r||{};
    const keys=Object.keys(r).filter(k=>!SELECTOR_SPECIAL_KEYS.has(k));
    if(!keys.length&&!r.or&&!r.and&&!r.not)return atoms.slice();
    if(r.not||r.and)return null;
    if(r.or){
      const lists=[];
      for(const part of r.or){
        const list=filterAtomsFastResolved(part);
        if(list==null)return null;
        lists.push(list);
      }
      return uniqueAtomsInOrder(lists);
    }
    if(r.serial!=null&&keys.length===1)return filterAtomsBySerial(r.serial);
    const hasEntry=r._entryName!=null, hasChain=r.chain!=null, hasResi=r.resi!=null, hasResn=r.resn!=null;
    const directEntry=hasEntry&&!Array.isArray(r._entryName), directChain=hasChain&&!Array.isArray(r.chain);
    const directResi=hasResi&&!Array.isArray(r.resi)&&!isResiRangeValue(r.resi);
    const directResn=hasResn&&!Array.isArray(r.resn);
    let pool=null, usedIndex=false;
    if(directEntry&&directChain&&directResi&&directResn){
      usedIndex=true;
      pool=atomsByEntryChainResidueName.get(selectorEntryChainResidueNameKey(r._entryName,r.chain,r.resi,r.resn));
    }else if(directEntry&&directChain&&directResi){
      usedIndex=true;
      pool=atomsByEntryChainResidue.get(selectorEntryChainResidueKey(r._entryName,r.chain,r.resi));
    }else if(directEntry&&directChain){
      usedIndex=true;
      pool=atomsByEntryChain.get(selectorEntryChainKey(r._entryName,r.chain));
    }else if(directEntry){
      usedIndex=true;
      pool=atomsByEntry.get(selectorTextKey(r._entryName));
    }else if(directChain){
      usedIndex=true;
      pool=atomsByChain.get(selectorTextKey(r.chain));
    }
    if(usedIndex&&!pool)return [];
    if(!pool)return null;
    return pool.filter(a=>matchesResolvedSelector(a,r));
  }
  function filterAtoms(sel){
    const r=resolveSelector(sel||{});
    const fast=filterAtomsFastResolved(r);
    if(fast!=null)return fast;
    return atoms.filter(a=>matchesResolvedSelector(a,r));
  }
  function residueUiKey(a){ return (a._entryName||'')+':'+(a.chain||'')+':'+a.resi; }
  function atomEntryIndexKey(entry,index){ return (entry||'')+'\u0001'+index; }
  function atomLineKey(a){ return atomEntryIndexKey(a&&a._entryName,a&&a.index!=null?a.index:atomSourceSerial(a)); }
  function bondLineKey(a,b){
    const ak=atomLineKey(a),bk=atomLineKey(b);
    return ak<bk?ak+'|'+bk:bk+'|'+ak;
  }
  function atomSourceSerial(a){ return a&&a._sourceSerial!=null?a._sourceSerial:(a&&a.index!=null?a.index:(a&&a.serial)); }
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
  function combineSelectors(a,b){ const seen=new Set(); [a,b].forEach(s=>addSelectorSerials(seen,s,{})); return {serial:Array.from(seen)}; }
  function normalizeSelectorInput(s){
    if(s==null)return null;
    if(Array.isArray(s)){
      if(!s.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))throw new Error('Selection array entries must be selector objects.');
      return {or:s};
    }
    if(typeof s!=='object')throw new Error('Selection selector must be an object, an array of objects, or null.');
    return s;
  }

  function applyVisibility(){
    const off=[];
    for(const a of atoms){
      const c=atomCategory(a);
      if(!state.visibility[c]){off.push(a.serial);continue;}
      if(c==='protein'&&!isChainVisible(a)){off.push(a.serial);continue;}
      if(c!=='protein'&&!isGroupVisible(a)){off.push(a.serial);continue;}
      if(c==='solvents'&&state.solvent==='off'){off.push(a.serial);continue;}
      if(c==='other'&&state.other==='off')off.push(a.serial);
    }
    if(off.length)viewer.setStyle({serial:off},{});
    displayedCount = atoms.length - off.length;
  }
  function setLineSelectionStyleMask(keys){
    const next=keys&&keys.size?keys:new Set();
    const changed=lineSelectionStyleMaskActive||next.size>0;
    selectedLineBondKeys=next;
    lineSelectionStyleMaskActive=next.size>0;
    if(changed)redrawWideLineStyles();
  }
  function clearSelectionHighlight(opts){
    opts=opts||{};
    selectionHighlightJob++;
    if(wideLineLayer)wideLineLayer.clearCollection('selection');
    if(lineSelectionStyleMaskActive&&!opts.deferLineMask)setLineSelectionStyleMask(null);
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
    if(rep==='cpk')return cpkStyleSpec(colorfunc,opacity,'selection',o);
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
    if(rep==='cpk')return cpkStyleSpec(colorfunc,opacity,'selection',o);
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
    selected.forEach(a=>{ if(a.index!=null)selectedIndexes.add(atomEntryIndexKey(a._entryName,a.index)); });
    selected.forEach(a=>{
      (a.bonds||[]).forEach(idx=>{
        const b=atomByEntryIndex.get(atomEntryIndexKey(a._entryName,idx))||atomByIndex.get(idx);
        if(!b||!selectedIndexes.has(atomEntryIndexKey(b._entryName,b.index)))return;
        const ea=a._entryName||'',eb=b._entryName||'';
        const ka=ea+':'+a.index<eb+':'+b.index?ea+':'+a.index+'|'+eb+':'+b.index:eb+':'+b.index+'|'+ea+':'+a.index;
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
  function appendWideBond(lines,a,b,o,defaultColorFn,widthDefault,dashed,skipBondKeys){
    if(skipBondKeys&&skipBondKeys.has(bondLineKey(a,b)))return;
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
  function appendWideAtomLines(lines,points,selected,o,defaultColorFn,widthDefault,dashed,skipBondKeys){
    const data=selectionBondData(selected);
    data.bonds.forEach(p=>appendWideBond(lines,p[0],p[1],o,defaultColorFn,widthDefault,dashed,skipBondKeys));
    const opacity=o.opacity==null?1:Number(o.opacity),width=Math.max(1,Number(o.linewidth||widthDefault||lineWidths.fallback));
    data.looseAtoms.forEach(a=>{
      const p=point(a);
      p.color=lineColorForAtom(a,o,defaultColorFn);
      p.opacity=opacity;
      p.radius=Math.max(2,width*0.6);
      points.push(p);
    });
  }
  function appendSelectedLineOverlay(lines,points,selected,o,widthDefault,keysOut){
    const lineKeys=new Set(),covered=new Set();
    const opacity=o.opacity==null?1:Number(o.opacity),width=Math.max(1,Number(widthDefault||o.linewidth||lineWidths.selection)),color=o.color||'#fdd835';
    function addLine(a,b,key){
      if(lineKeys.has(key))return;
      lineKeys.add(key);
      if(keysOut)keysOut.add(key);
      lines.push({start:point(a),end:point(b),color,width,opacity,dashed:false});
      if(a.serial!=null)covered.add(a.serial);
      if(b&&b.serial!=null)covered.add(b.serial);
    }
    selected.forEach(a=>{
      if(a.index==null)return;
      (a.bonds||[]).forEach(idx=>{
        const b=atomByEntryIndex.get(atomEntryIndexKey(a._entryName,idx))||atomByIndex.get(idx);
        if(!b||!isAtomVisibleNow(b))return;
        if(atomDisplayRepresentation(b)!=='line')return;
        addLine(a,b,bondLineKey(a,b));
      });
    });
    selected.forEach(a=>{
      if(a.serial!=null&&covered.has(a.serial))return;
      const p=point(a);
      p.color=color;
      p.opacity=opacity;
      p.radius=Math.max(2,width*0.65);
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
    const c=atomCategory(a);
    const base=c==='ligands'?state.ligand:(c==='solvents'?state.solvent:(c==='other'?state.other:state.proteinAtoms));
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
  function representativeSelectionAtoms(selected){
    if(atoms.length<LARGE_INTERACTION_INDEX_ATOM_LIMIT||selected.length<=LARGE_SELECTION_EXACT_HIGHLIGHT_LIMIT)return selected;
    const maxAtoms=LARGE_SELECTION_REPRESENTATIVE_ATOM_LIMIT;
    const residues=new Map();
    selected.forEach(a=>{
      const key=residueUiKey(a), name=atomName(a);
      let rec=residues.get(key);
      if(!rec){ rec={backbone:[],atoms:[]}; residues.set(key,rec); }
      rec.atoms.push(a);
      if(isProtein(a)&&backboneAtoms.has(name))rec.backbone.push(a);
    });
    const keys=Array.from(residues.keys());
    const perResidue=4;
    const stride=Math.max(1,Math.ceil(keys.length/Math.max(1,Math.floor(maxAtoms/perResidue))));
    const out=[];
    for(let i=0;i<keys.length&&out.length<maxAtoms;i+=stride){
      const rec=residues.get(keys[i]);
      const source=rec.backbone.length?rec.backbone:rec.atoms;
      for(let j=0;j<source.length&&out.length<maxAtoms;j++)out.push(source[j]);
    }
    if(out.length)return out;
    const step=Math.max(1,Math.ceil(selected.length/maxAtoms));
    for(let i=0;i<selected.length&&out.length<maxAtoms;i+=step)out.push(selected[i]);
    return out;
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
    const groups=partitionSelectionByDisplay(selected),lines=[],points=[],lineKeys=new Set(),width=Math.max(1,Number(o.linewidth||lineWidths.selection));
    groups.none=representativeSelectionAtoms(groups.none);
    appendWideAtomLines(lines,points,groups.none,o,function(){ return o.color||'#fdd835'; },width,false);
    appendSelectedLineOverlay(lines,points,groups.line,o,Math.max(width+1,width*1.75),lineKeys);
    if(lines.length||points.length)wideLineLayer.setCollection('selection',lines,points,{color:o.color||'#fdd835',opacity:o.opacity==null?1:Number(o.opacity),linewidth:width,pointRadius:Math.max(2,width*0.6)});
    setLineSelectionStyleMask(lineKeys);
    drawSelectionRepGroup(groups.stick,'stick',o,job);
    drawSelectionRepGroup(groups.sphere,'sphere',o,job);
    drawSelectionRepGroup(groups.cpk,'cpk',o,job);
    return !!(lines.length||points.length||groups.stick.length||groups.sphere.length||groups.cpk.length);
  }
  function addWideStyleAtoms(lines,points,sel,o,defaultColorFn,widthDefault,dashed,skipBondKeys){
    const selected=filterAtoms(sel).filter(isAtomVisibleNow);
    if(selected.length)appendWideAtomLines(lines,points,selected,o||{},defaultColorFn,widthDefault,dashed,skipBondKeys);
  }
  function hasWideStyleLayer(){
    if(state.proteinAtoms==='line'||state.ligand==='line'||state.solvent==='line'||state.other==='line')return true;
    return state.styleRules.some(r=>{
      if(r.disabled)return false;
      const rep=normText(r.representation).toLowerCase();
      return rep==='line'||rep==='tube';
    });
  }
  function redrawWideLineStyles(){
    if(!wideLineLayer)return;
    if(!model||!atoms.length){ wideLineLayer.clearCollection('styles'); return; }
    if(!hasWideStyleLayer()){ wideLineLayer.clearCollection('styles'); return; }
    const lines=[],points=[];
    const cs=_catSer||categorySerials();
    const skip=lineSelectionStyleMaskActive?selectedLineBondKeys:null;
    if(state.proteinAtoms==='line'&&cs.protein.length)addWideStyleAtoms(lines,points,{serial:cs.protein},{linewidth:lineWidths.protein},chainAwareAtomColor,lineWidths.protein,false,skip);
    if(state.ligand==='line'&&cs.ligands.length)addWideStyleAtoms(lines,points,{serial:cs.ligands},{linewidth:lineWidths.ligand},elementColor,lineWidths.ligand,false,skip);
    if(state.solvent==='line'&&cs.solvents.length)addWideStyleAtoms(lines,points,{serial:cs.solvents},{linewidth:lineWidths.ligand},elementColor,lineWidths.ligand,false,skip);
    if(state.other==='line'&&cs.other.length)addWideStyleAtoms(lines,points,{serial:cs.other},{linewidth:lineWidths.ligand},elementColor,lineWidths.ligand,false,skip);
    for(const r of state.styleRules){
      if(r.disabled)continue;
      const rep=normText(r.representation).toLowerCase(),opts=r.options||{};
      if(rep==='line')addWideStyleAtoms(lines,points,styleSelection(r.selector,opts),opts,chainAwareAtomColor,opts.linewidth||lineWidths.protein,false,skip);
      else if(rep==='tube')addWideStyleAtoms(lines,points,styleSelection(r.selector,opts),opts,chainAwareAtomColor,opts.linewidth||lineWidths.tube,false,skip);
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
    const rep=normText(state.selectionRepresentation||'line').toLowerCase();
    clearSelectionHighlight({deferLineMask:rep==='line'});
    if(!viewer||!state.selectionSel||state.selectionRepresentation==='off'){ if(rep==='line')setLineSelectionStyleMask(null); return; }
    const opts=state.selectionOptions||{},rawSelected=selectedAtomsOverride||selectedAtomsForSelector(state.selectionSel),selected=rawSelected.filter(isAtomVisibleNow);
    if(!selected.length){ if(rep==='line')setLineSelectionStyleMask(null); return; }
    const job=selectionHighlightJob;
    if(rep==='line'&&drawAdaptiveLineSelection(selected,opts,job))return;
    if(rep==='line')setLineSelectionStyleMask(null);
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
    styleGeneration++;
    resetAtomLevelCache();
    selectionStyleActive=false;
    _catSer=categorySerials();
    viewer.setStyle({},{});
    if(_catSer.protein.length){
      viewer.setStyle({hetflag:false}, proteinBackboneStyleSpec());
      if(state.proteinAtoms!=='off')viewer.addStyle({hetflag:false}, proteinAtomStyleSpec());
    }
    if(_catSer.ligands.length)viewer.setStyle({serial:_catSer.ligands}, ligandStyleSpec());
    if(_catSer.solvents.length)viewer.setStyle({serial:_catSer.solvents}, solventStyleSpec());
    if(_catSer.other.length)viewer.setStyle({serial:_catSer.other}, otherStyleSpec());
    for(const r of state.styleRules){ if(r.disabled)continue; try{ if(r.options&&r.options.atomLevel)applyAtomLevelStyleRule(r); else viewer.addStyle(styleSelection(r.selector,r.options), styleSpec(r.representation,r.options)); }catch(e){ console.warn('Style rule failed',r,e); } }
    for(const r of state.hiddenRules){ if(r.disabled)continue; try{ if(r.options&&r.options.atomLevel)applyAtomLevelHideRule(r); else viewer.setStyle(styleSelection(r.selector,r.options),{}); }catch(e){ console.warn('Hide rule failed',r,e); } }
    applyVisibility();
    redrawWideLineStyles();
    if(!opts.skipInteractions)redrawInteractions(false);
    if(!opts.skipSelection){
      selectionAtoms=selectedAtomsForSelector(state.selectionSel);
      applySelectionHighlight(selectionAtoms);
    }
    if(!opts.skipStatus)updateStatusBar();
    models.forEach(item=>{
      const record=entryModelCache.get(item.entry&&item.entry.name);
      if(record){
        record.styleGeneration=styleGeneration;
        record.sceneBuilt=false;
      }
    });
    if(render!==false)presentViewer(visibleEntryRecords(),true);
  }

  function installAtomEventsForRecord(record){
    const m=record&&record.model;
    if(!m||m._molAgentEventsInstalled)return;
    if(record.atoms&&record.atoms.length>=HUGE_FIT_ATOM_LIMIT&&isCustomMousePreset()){
      m._molAgentEventsSkipped=true;
      return;
    }
    m.setClickable({},true,function(a,v,e){ handleAtomClick(a,e); });
    m.setHoverable({},true,function(a){ if(hoverClearTimer){clearTimeout(hoverClearTimer);hoverClearTimer=null;} showHover(a); }, function(){ if(hoverClearTimer)clearTimeout(hoverClearTimer); hoverClearTimer=setTimeout(function(){ showHover(null); hoverClearTimer=null; },60); });
    m._molAgentEventsInstalled=true;
    m._molAgentEventsSkipped=false;
    record.sceneBuilt=false;
  }
  function setupAtomEvents(){
    if(!viewer)return;
    models.forEach(item=>{
      const record=entryModelCache.get(item.entry&&item.entry.name);
      installAtomEventsForRecord(record||{model:item.model,atoms:[]});
    });
  }
  function showHover(a){
    const bar=$('hoverBar'); if(!bar)return;
    bar.textContent='';
    if(!a){
      const empty=document.createElement('span');
      empty.className='hover-empty';
      empty.textContent='Hover an atom to inspect';
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
    if(a._entryTitle||a._entryName)seg('Entry',a._entryTitle||a._entryName);
    seg('Chain',a.chain||'-');
    seg('Residue',(a.resn||'-')+' '+(a.resi==null?'-':a.resi));
    seg('Atom',(a.atom||'-')+' ('+(atomElem(a)||'-')+')');
    seg('Serial',a._sourceSerial==null?(a.serial==null?'-':a.serial):a._sourceSerial);
    seg('XYZ',Number(a.x).toFixed(2)+', '+Number(a.y).toFixed(2)+', '+Number(a.z).toFixed(2));
  }
  function handleAtomClick(a,e){
    if(!a)return;
    setSelection(selectionFromAtom(a,state.selectionMode), {source:'click',additive:e&&e.shiftKey});
  }
  function selectionFromAtom(a,m){ if(m==='atom')return {serial:a.serial}; if(m==='chain')return {_entryName:a._entryName,chain:a.chain}; if(m==='model')return {_entryName:a._entryName}; return {_entryName:a._entryName,chain:a.chain,resi:a.resi,resn:a.resn}; }
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
    if(next==null){ clearSelection(); return null; }
    state.selectionSel = add&&state.selectionSel ? combineSelectors(state.selectionSel,next) : next;
    selectionAtoms=selectedAtomsForSelector(state.selectionSel);
    state.focusTarget=null;
    applySelectionOptionOverrides(opts);
    renderSelectionHighlight(true,selectionAtoms);
    if(opts.focus)focus(state.selectionSel);
    const info=selectionInfo(state.selectionSel,selectionAtoms);
    updateSelectionStatus(info);
    syncHierarchySelectionHighlight();
    setStatus((add?'Added: ':'Selected: ')+info.atomCount.toLocaleString()+' atoms');
    return state.selectionSel;
  }
  function setSelectionHighlight(options){
    applySelectionOptionOverrides(options||{});
    renderSelectionHighlight(true);
    return {representation:state.selectionRepresentation,options:cloneSelector(state.selectionOptions)};
  }
  function clearSelection(){
    state.selectionSel=null; selectionAtoms=[]; state.focusTarget=null;
    hierarchySelectionAnchorKey='';
    renderSelectionHighlight(true,selectionAtoms);
    updateSelectionStatus({atomCount:0,residueCount:0,residueKeys:new Set()});
    syncHierarchySelectionHighlight();
    setStatus('Selection cleared.');
  }
  function focusViewerKeyboardTarget(){
    if(!viewerEl)return;
    if(!viewerEl.hasAttribute('tabindex'))viewerEl.setAttribute('tabindex','-1');
    try{ viewerEl.focus({preventScroll:true}); }
    catch(e){ try{ viewerEl.focus(); }catch(_){} }
  }
  function visibleAtomSelector(){ const serials=serialsForAtoms(atoms); return serials.length?{serial:serials}:{}; }
  function hiddenCachedAtomCount(){
    let n=0;
    entryModelCache.forEach((record,name)=>{ if(entryChecked[name]===false&&record&&record.atoms)n+=record.atoms.length; });
    return n;
  }
  function shouldUseFastFit(targetAtoms){
    const n=(targetAtoms&&targetAtoms.length)||0;
    return atoms.length>=HUGE_FIT_ATOM_LIMIT||n>=HUGE_FIT_ATOM_LIMIT||hiddenCachedAtomCount()>=HUGE_FIT_ATOM_LIMIT;
  }
  function atomExtent(list){
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity,count=0;
    (list||[]).forEach(a=>{
      const x=Number(a&&a.x),y=Number(a&&a.y),z=Number(a&&a.z);
      if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return;
      if(x<minX)minX=x; if(y<minY)minY=y; if(z<minZ)minZ=z;
      if(x>maxX)maxX=x; if(y>maxY)maxY=y; if(z>maxZ)maxZ=z;
      count++;
    });
    if(!count)return null;
    const center={x:(minX+maxX)/2,y:(minY+maxY)/2,z:(minZ+maxZ)/2};
    let maxDsq=25;
    (list||[]).forEach(a=>{
      const dx=Number(a&&a.x)-center.x,dy=Number(a&&a.y)-center.y,dz=Number(a&&a.z)-center.z,d=dx*dx+dy*dy+dz*dz;
      if(Number.isFinite(d)&&d>maxDsq)maxDsq=d;
    });
    return {minX,minY,minZ,maxX,maxY,maxZ,center,diag:Math.hypot(maxX-minX,maxY-minY,maxZ-minZ),diameter:Math.sqrt(maxDsq)*2};
  }
  function mergeExtents(list){
    const boxes=(list||[]).filter(Boolean);
    if(!boxes.length)return null;
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    boxes.forEach(b=>{
      if(b.minX<minX)minX=b.minX; if(b.minY<minY)minY=b.minY; if(b.minZ<minZ)minZ=b.minZ;
      if(b.maxX>maxX)maxX=b.maxX; if(b.maxY>maxY)maxY=b.maxY; if(b.maxZ>maxZ)maxZ=b.maxZ;
    });
    const center={x:(minX+maxX)/2,y:(minY+maxY)/2,z:(minZ+maxZ)/2};
    let maxDsq=25;
    boxes.forEach(b=>{
      [[b.minX,b.minY,b.minZ],[b.minX,b.minY,b.maxZ],[b.minX,b.maxY,b.minZ],[b.minX,b.maxY,b.maxZ],[b.maxX,b.minY,b.minZ],[b.maxX,b.minY,b.maxZ],[b.maxX,b.maxY,b.minZ],[b.maxX,b.maxY,b.maxZ]].forEach(p=>{
        const dx=p[0]-center.x,dy=p[1]-center.y,dz=p[2]-center.z,d=dx*dx+dy*dy+dz*dz;
        if(d>maxDsq)maxDsq=d;
      });
    });
    return {minX,minY,minZ,maxX,maxY,maxZ,center,diag:Math.hypot(maxX-minX,maxY-minY,maxZ-minZ),diameter:Math.sqrt(maxDsq)*2};
  }
  function visibleEntryRecords(){ return models.map(item=>entryModelCache.get(item.entry&&item.entry.name)).filter(Boolean); }
  function setViewNoRender(view){
    if(!viewer||!viewer.modelGroup||!viewer.rotationGroup||!Array.isArray(view)||view.length<8)return false;
    function num(v,fallback){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
    const p=viewer.modelGroup.position,rp=viewer.rotationGroup.position,q=viewer.rotationGroup.quaternion;
    p.x=num(view[0],p.x); p.y=num(view[1],p.y); p.z=num(view[2],p.z);
    rp.z=num(view[3],rp.z);
    q.x=num(view[4],q.x); q.y=num(view[5],q.y); q.z=num(view[6],q.z); q.w=num(view[7],q.w);
    if(view.length>9){ rp.x=num(view[8],rp.x); rp.y=num(view[9],rp.y); }
    return true;
  }
  function restoreViewNoRender(view){
    if(!view)return false;
    if(setViewNoRender(view))return true;
    if(viewer&&viewer.setView){ try{ viewer.setView(view); return true; }catch(e){} }
    return false;
  }
  function markSceneBuilt(records){ (records||visibleEntryRecords()).forEach(record=>{ if(record)record.sceneBuilt=true; }); }
  function recordsNeedSceneRender(records){ return (records||visibleEntryRecords()).some(record=>record&&!record.sceneBuilt); }
  function presentViewer(records,fullRender){
    if(!viewer)return;
    if(fullRender||typeof viewer.show!=='function'){
      viewer.render();
      markSceneBuilt(records||visibleEntryRecords());
    }else showViewer();
  }
  function visibleAtomExtent(){ return mergeExtents(visibleEntryRecords().map(record=>record.extent)); }
  function extentForAtoms(list){
    if(list===atoms)return visibleAtomExtent()||atomExtent(list);
    const record=visibleEntryRecords().find(r=>r.atoms===list);
    return record&&record.extent?record.extent:atomExtent(list);
  }
  function setViewerModelPosition(x,y,z){
    const p=viewer&&viewer.modelGroup&&viewer.modelGroup.position;
    if(!p)return;
    if(typeof p.set==='function')p.set(x,y,z);
    else{ p.x=x; p.y=y; p.z=z; }
  }
  function fastFitAtoms(targetAtoms,opts){
    opts=opts||{};
    if(!viewer||!targetAtoms||!targetAtoms.length)return false;
    const targetBox=opts.targetBox||extentForAtoms(targetAtoms);
    if(!targetBox)return false;
    const allBox=opts.allBox||visibleAtomExtent()||targetBox;
    const fov=Number(viewer.camera&&viewer.camera.fov)||20;
    const cameraZ=Number(viewer.CAMERA_Z)||0;
    const minZoom=Number(viewer.config&&viewer.config.minimumZoomToDistance)||5;
    const maxD=Math.max(targetBox.diameter,minZoom);
    let finalz=-(maxD*0.5/Math.tan(Math.PI/180*fov/2)-cameraZ);
    if(typeof viewer.adjustZoomToLimits==='function')finalz=viewer.adjustZoomToLimits(finalz);
    setViewerModelPosition(-targetBox.center.x,-targetBox.center.y,-targetBox.center.z);
    if(viewer.rotationGroup&&viewer.rotationGroup.position)viewer.rotationGroup.position.z=finalz;
    const allD=Math.max(allBox.diag,5);
    if(opts.overview){
      viewer.slabNear=Math.min(-allD*2,-50);
      viewer.slabFar=Math.max(allD*2,50);
    }else{
      viewer.slabNear=-allD/1.9;
      viewer.slabFar=allD/2;
    }
    if(opts.focusTarget)state.focusTarget=opts.focusTarget;
    if(opts.render!==false)presentViewer(null,false);
    return true;
  }
  function fitVisible(opts){
    opts=opts||{};
    if(!viewer||!model)return false;
    if(shouldUseFastFit(atoms)){
      const box=visibleAtomExtent();
      return fastFitAtoms(atoms,{overview:true,render:opts.render!==false,focusTarget:{mode:'overview'},targetBox:box,allBox:box});
    }
    viewer.zoomTo(visibleAtomSelector(),opts.duration==null?0:opts.duration);
    if(opts.render!==false)presentViewer(null,true);
    state.focusTarget={mode:'overview'};
    return true;
  }
  function focusOverview(){ return fitVisible({duration:450,render:true}); }
  function focus(sel){
    if(!viewer||!model)return false;
    const t=sel||state.selectionSel;
    if(!t){ focusOverview(); return false; }
    const target=filterAtoms(t).filter(isAtomVisibleNow);
    if(shouldUseFastFit(target))return fastFitAtoms(target.length?target:atoms,{overview:false,render:true,focusTarget:{mode:'selection'},allBox:visibleAtomExtent()});
    let s=styleSelection(t,{});
    if(s.serial&&Array.isArray(s.serial)&&s.serial.length>=atoms.length)s=visibleAtomSelector();
    viewer.zoomTo(s,450);
    state.focusTarget={mode:'selection'};
    return true;
  }
  function toggleFocus(){ if(!state.selectionSel)return focusOverview(); if(state.focusTarget&&state.focusTarget.mode==='selection')return focusOverview(); return focus(state.selectionSel); }
  function isFocusHotkey(e){ return !!(e&&(e.key==='z'||e.key==='Z'||e.code==='KeyZ')); }

  function isWaterAtom(a){ return waterNames.has(normUpper(a.resn)); }
  function residueKey(a){ return (a._entryName||'')+':'+(a.chain||'')+':'+a.resi+':'+normUpper(a.resn||''); }
  const ATOM_REPS=new Set(ATOM_REP_VALUES);
  let _lvlCache=null, _lvlSerialCache=null, _catSer=null;
  function resetAtomLevelCache(){ _lvlCache=null; _lvlSerialCache=null; _catSer=null; proteinResidueLikeCache=null; }
  function categorySerials(){
    const out={protein:[],ligands:[],solvents:[],other:[]};
    for(const a of atoms){
      const c=atomCategory(a);
      if(out[c]&&a.serial!=null)out[c].push(a.serial);
    }
    return out;
  }
  function hiddenByRules(a){ for(const r of state.hiddenRules){ if(r.disabled)continue; try{ if(matchesResolvedSelector(a,resolveSelector(r.selector)))return true; }catch(e){} } return false; }
  function isAtomVisibleNow(a){
    const c=atomCategory(a);
    if(state.visibility[c]===false)return false;
    if(c==='protein'&&!isChainVisible(a))return false;
    if(c!=='protein'&&!isGroupVisible(a))return false;
    if(c==='solvents'&&state.solvent==='off')return false;
    if(c==='other'&&state.other==='off')return false;
    if(hiddenByRules(a))return false;
    return true;
  }
  // "Visualized atoms" = atoms currently shown at the ATOM level by the display
  // settings. This is independent of the (yellow) selection, so the Interactions button behaves the
  // same way regardless of what is selected.
  function isAtomLevelShown(a){
    if(!isAtomVisibleNow(a))return false;
    for(const r of state.styleRules){ if(r.disabled)continue; try{ if(matchesResolvedSelector(a,resolveSelector(r.selector))&&ATOM_REPS.has(normText(r.representation).toLowerCase()))return true; }catch(e){} }
    const c=atomCategory(a);
    if(c==='ligands')return ATOM_REPS.has(state.ligand);
    if(c==='solvents')return ATOM_REPS.has(state.solvent);
    if(c==='other')return ATOM_REPS.has(state.other);
    return ATOM_REPS.has(state.proteinAtoms);
  }
  function atomLevelAtoms(){ if(!_lvlCache)_lvlCache=atoms.filter(isAtomLevelShown); return _lvlCache; }
  function atomLevelSerials(){
    if(!_lvlSerialCache){
      _lvlSerialCache=new Set();
      atomLevelAtoms().forEach(a=>{
        if(a.serial==null)return;
        _lvlSerialCache.add(String(a.serial));
        const n=Number(a.serial);
        if(!Number.isNaN(n))_lvlSerialCache.add(n);
      });
    }
    return _lvlSerialCache;
  }
  function isInteractionAtomShown(a){
    if(!a||a.serial==null)return false;
    const n=Number(a.serial);
    return atomLevelSerials().has(Number.isNaN(n)?String(a.serial):n);
  }
  const DEFAULT_INTER_SCOPE={noncov:'all', pi:'pl', contact:'pl'};
  const DEFAULT_INTER_TYPES={
    hbond:{label:'Hydrogen bonds',color:'#ffd400',on:true},
    halogen:{label:'Halogen bonds',color:'#9b30ff',on:true},
    salt:{label:'Salt bridges',color:'#ff45c0',on:true},
    aromhb:{label:'Aromatic H-Bond',color:'#26c6da',on:false},
    pipi:{label:'Pi-pi stacking',color:'#4fc3f7',on:true},
    pication:{label:'Pi-cation',color:'#66bb6a',on:true},
    good:{label:'Good',color:'#26a69a',on:false},
    bad:{label:'Bad',color:'#ffa726',on:true},
    ugly:{label:'Ugly',color:'#ef5350',on:true}
  };
  function cloneInteractionTypes(){ return clonePlain(DEFAULT_INTER_TYPES); }
  const interState={ enabled:true, scope:Object.assign({},DEFAULT_INTER_SCOPE), types:cloneInteractionTypes() };
  function resetInteractionSettings(){
    interState.enabled=true;
    interState.scope=Object.assign({},DEFAULT_INTER_SCOPE);
    interState.types=cloneInteractionTypes();
    state.hbondCutoff=2.8;
    state.saltCutoff=5.0;
    updateInterToggle();
    buildInterPanel();
  }
  function atomPayloadForInteractionIndex(sourceAtoms){
    return (sourceAtoms||atoms).map(a=>{
      const bonds=(a.bonds||[]).map(idx=>atomByEntryIndex.get(atomEntryIndexKey(a._entryName,idx))||atomByIndex.get(idx)).filter(Boolean).map(atomSourceSerial).filter(s=>s!=null);
      return {serial:atomSourceSerial(a),index:a.index,entry:a._entryName||'',chain:a.chain||'',resi:a.resi,resn:a.resn||'',atom:a.atom||'',elem:atomElem(a),x:a.x,y:a.y,z:a.z,hetflag:!!a.hetflag,bonds};
    });
  }
  function cancelScheduledInteractionIndexBuild(){
    if(interactionStartTimer!=null){
      clearTimeout(interactionStartTimer);
      interactionStartTimer=null;
    }
  }
  function countInteractionIndex(interactions){
    interactions=interactions||{};
    return {
      hbond:(interactions.hbond||[]).length,
      halogen:(interactions.halogen||[]).length,
      salt:(interactions.salt||[]).length,
      pipi:(interactions.pipi||[]).length,
      pication:(interactions.pication||[]).length,
      contactGood:(interactions.contacts&&interactions.contacts.good||[]).length,
      contactBad:(interactions.contacts&&interactions.contacts.bad||[]).length,
      contactUgly:(interactions.contacts&&interactions.contacts.ugly||[]).length
    };
  }
  function interactionIndexCacheUrl(key){ return INTERACTION_INDEX_API+encodeURIComponent(key); }
  function entryAtomsForInteractionIndex(entry){
    const record=entry&&entryModelCache.get(entry.name);
    return record&&record.atoms?record.atoms:atoms.filter(a=>(a._entryName||'')===(entry&&entry.name||''));
  }
  function interactionSourceSignature(sourceAtoms){
    return fnv1aHex((sourceAtoms||[]).map(a=>[
      atomSourceSerial(a)==null?'':atomSourceSerial(a),
      a.index==null?'':a.index,
      a.chain||'',
      a.resi==null?'':a.resi,
      a.resn||'',
      a.atom||'',
      atomElem(a)
    ].join('\u0002')).join('\u0001'));
  }
  function validCachedInteractionIndex(payload,key,sourceAtoms,signature){
    return payload&&payload.schema===INTERACTION_INDEX_SCHEMA&&payload.structureKey===key&&payload.serialMode==='sourceSerial'&&payload.sourceSerialSignature===(signature||interactionSourceSignature(sourceAtoms))&&Number(payload.atoms)===(sourceAtoms||[]).length&&payload.interactions&&typeof payload.interactions==='object';
  }
  function visibleInteractionSlots(visible){
    return (visible||includedEntries()).map(entry=>{
      const key=entryStructureKey(entry);
      return {entry,key,record:interactionIndexByKey.get(key)||null};
    });
  }
  function readyInteractionSlots(visible){
    return visibleInteractionSlots(visible).filter(slot=>slot.record&&slot.record.status==='ready'&&slot.record.interactions);
  }
  function aggregateInteractionCounts(slots){
    const out={hbond:0,halogen:0,salt:0,pipi:0,pication:0,contactGood:0,contactBad:0,contactUgly:0};
    (slots||[]).forEach(slot=>{
      const c=slot.record&&slot.record.counts||{};
      Object.keys(out).forEach(k=>{ out[k]+=Number(c[k]||0); });
    });
    return out;
  }
  function updateInteractionAggregate(visible){
    const slots=visibleInteractionSlots(visible);
    const ready=slots.filter(slot=>slot.record&&slot.record.status==='ready'&&slot.record.interactions);
    const loading=slots.some(slot=>slot.record&&/^(loading-cache|building)$/.test(slot.record.status));
    const errorCount=slots.filter(slot=>slot.record&&slot.record.status==='error').length;
    const unavailableCount=slots.filter(slot=>slot.record&&slot.record.status==='unavailable').length;
    const missing=slots.filter(slot=>!slot.record).length;
    interactionIndex={
      status:ready.length?'ready':(loading?'loading':(missing?'pending':(errorCount?'error':(unavailableCount?'unavailable':'empty')))),
      jobId:interactionBuildSeq,
      source:'entry-indexes',
      structureKey:currentStructureKey,
      counts:aggregateInteractionCounts(ready),
      readyEntries:ready.length,
      totalEntries:slots.length,
      unavailableEntries:unavailableCount,
      error:errorCount?errorCount+' interaction index job(s) failed':''
    };
  }
  function setInteractionRecord(key,record){
    if(!key)return;
    interactionIndexByKey.set(key,record);
    updateInteractionAggregate();
    updateInteractionSummary(interactionWideLines.length);
  }
  function useInteractionIndexPayload(payload,jobId,source,entry,sourceAtoms,signature){
    const key=payload.structureKey||(entry&&entryStructureKey(entry));
    const counts=countInteractionIndex(payload.interactions);
    const sourceEntry=entry||entryForStructureKey(key);
    setInteractionRecord(key,{status:'ready',jobId,structureKey:key,source:source||payload.source||'worker',entryName:sourceEntry&&sourceEntry.name||payload.entryName||'',entryTitle:sourceEntry&&sourceEntry.title||payload.entryTitle||'',serialMode:'sourceSerial',sourceSerialSignature:signature||payload.sourceSerialSignature||interactionSourceSignature(sourceAtoms),interactions:payload.interactions||{},counts,elapsedMs:payload.elapsedMs,atoms:payload.atoms,rings:payload.rings,cachedAt:payload.cachedAt});
    setStatus((sourceEntry&&sourceEntry.title||payload.entryTitle||'Entry')+' \u00b7 '+Number(payload.atoms||0).toLocaleString()+' atoms \u00b7 interactions indexed'+(source==='server'?' (server cache)':''));
    redrawInteractions(true);
  }
  function saveInteractionIndexPayload(payload,key){
    if(!payload||!key)return Promise.resolve(false);
    return fetchJsonResult(interactionIndexCacheUrl(key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(result=>{
      if(!result.ok)return reportPersistenceFailure('Interaction cache',result,{status:false});
      return true;
    });
  }
  function removeQueuedInteractionBuild(key){
    for(let i=interactionBuildQueue.length-1;i>=0;i--){
      if(interactionBuildQueue[i].key===key)interactionBuildQueue.splice(i,1);
    }
  }
  function queueInteractionWorker(jobId,key,entry,sourceAtoms,signature){
    removeQueuedInteractionBuild(key);
    interactionBuildQueue.push({jobId,key,entry,sourceAtoms,signature});
    pumpInteractionWorkerQueue();
  }
  function pumpInteractionWorkerQueue(){
    while(interactionWorkers.size<MAX_INTERACTION_WORKERS&&interactionBuildQueue.length){
      const job=interactionBuildQueue.shift();
      const current=interactionIndexByKey.get(job.key);
      if(!current||current.jobId!==job.jobId||current.status!=='building')continue;
      startInteractionWorkerNow(job.jobId,job.key,job.entry,job.sourceAtoms,job.signature);
    }
  }
  function startInteractionWorkerNow(jobId,key,entry,sourceAtoms,signature){
    if(!window.Worker){
      setInteractionRecord(key,{status:'unavailable',jobId,structureKey:key,entryName:entry&&entry.name||'',entryTitle:entry&&entry.title||'',counts:{},sourceSerialSignature:signature});
      updateInteractionSummary(0);
      return;
    }
    setStatus('Building interaction index: '+(entry&&entry.title||entry&&entry.name||'entry'));
    const worker=new Worker('interaction-worker.js');
    interactionWorkers.set(key,worker);
    worker.onmessage=function(e){
      const msg=e.data||{};
      const current=interactionIndexByKey.get(key);
      if(!current||current.jobId!==jobId)return;
      interactionWorkers.delete(key);
      pumpInteractionWorkerQueue();
      if(msg.error){
        setInteractionRecord(key,{status:'error',jobId,structureKey:key,entryName:entry&&entry.name||'',entryTitle:entry&&entry.title||'',interactions:null,counts:{},error:msg.error,sourceSerialSignature:signature});
        updateInteractionSummary(0);
        setStatus('Interaction index failed: '+msg.error);
        return;
      }
      const payload={schema:INTERACTION_INDEX_SCHEMA,structureKey:key,source:'worker',entryName:entry&&entry.name||'',entryTitle:entry&&entry.title||'',serialMode:'sourceSerial',sourceSerialSignature:signature,createdAt:new Date().toISOString(),criteria:msg.criteria||INTERACTION_CRITERIA,interactions:msg.interactions||{},elapsedMs:msg.elapsedMs,atoms:msg.atoms,rings:msg.rings};
      useInteractionIndexPayload(payload,jobId,'worker',entry,sourceAtoms,signature);
      saveInteractionIndexPayload(payload,key);
    };
    worker.onerror=function(e){
      const current=interactionIndexByKey.get(key);
      if(!current||current.jobId!==jobId)return;
      interactionWorkers.delete(key);
      pumpInteractionWorkerQueue();
      const error=e.message||'worker error';
      setInteractionRecord(key,{status:'error',jobId,structureKey:key,entryName:entry&&entry.name||'',entryTitle:entry&&entry.title||'',interactions:null,counts:{},error,sourceSerialSignature:signature});
      updateInteractionSummary(0);
      setStatus('Interaction index failed: '+error);
    };
    worker.postMessage({jobId,atoms:atomPayloadForInteractionIndex(sourceAtoms),criteria:INTERACTION_CRITERIA});
  }
  function ensureInteractionIndexForEntry(entry){
    if(!entry)return;
    const key=entryStructureKey(entry);
    if(!key)return;
    const sourceAtoms=entryAtomsForInteractionIndex(entry);
    if(sourceAtoms.length>LARGE_INTERACTION_INDEX_ATOM_LIMIT){
      const current=interactionIndexByKey.get(key);
      if(current&&current.status==='unavailable'&&current.reason==='too-large'&&current.atoms===sourceAtoms.length)return;
      removeQueuedInteractionBuild(key);
      const oldWorker=interactionWorkers.get(key);
      if(oldWorker){ try{ oldWorker.terminate(); }catch(e){} interactionWorkers.delete(key); }
      setInteractionRecord(key,{status:'unavailable',reason:'too-large',structureKey:key,entryName:entry.name,entryTitle:entry.title,counts:{},atoms:sourceAtoms.length,limit:LARGE_INTERACTION_INDEX_ATOM_LIMIT});
      return;
    }
    const signature=interactionSourceSignature(sourceAtoms);
    const current=interactionIndexByKey.get(key);
    if(current&&current.sourceSerialSignature===signature&&/^(ready|loading-cache|building)$/.test(current.status))return;
    const oldWorker=interactionWorkers.get(key);
    if(oldWorker){ try{ oldWorker.terminate(); }catch(e){} interactionWorkers.delete(key); }
    removeQueuedInteractionBuild(key);
    const jobId=++interactionBuildSeq;
    setInteractionRecord(key,{status:'loading-cache',jobId,structureKey:key,entryName:entry.name,entryTitle:entry.title,counts:{},sourceSerialSignature:signature});
    fetch(interactionIndexCacheUrl(key),{cache:'no-store'}).then(res=>{
      if(!res.ok)return null;
      return res.json();
    }).then(payload=>{
      const active=interactionIndexByKey.get(key);
      if(!active||active.jobId!==jobId)return;
      if(validCachedInteractionIndex(payload,key,sourceAtoms,signature)){
        useInteractionIndexPayload(payload,jobId,'server',entry,sourceAtoms,signature);
      }else{
        setInteractionRecord(key,{status:'building',jobId,structureKey:key,entryName:entry.name,entryTitle:entry.title,counts:{},sourceSerialSignature:signature});
        queueInteractionWorker(jobId,key,entry,sourceAtoms,signature);
      }
    }).catch(()=>{
      const active=interactionIndexByKey.get(key);
      if(!active||active.jobId!==jobId)return;
      setInteractionRecord(key,{status:'building',jobId,structureKey:key,entryName:entry.name,entryTitle:entry.title,counts:{},sourceSerialSignature:signature});
      queueInteractionWorker(jobId,key,entry,sourceAtoms,signature);
    });
  }
  function startInteractionIndexBuild(){
    const visible=includedEntries();
    if(!visible.length){
      updateInteractionAggregate(visible);
      clearInteractionShapes();
      updateInteractionSummary(0);
      return;
    }
    const hadInteractionGraphics=(interactionWideLines&&interactionWideLines.length)||(interactionShapes&&interactionShapes.length);
    visible.forEach(ensureInteractionIndexForEntry);
    updateInteractionAggregate(visible);
    if(hadInteractionGraphics||readyInteractionSlots(visible).length)redrawInteractions(true);
    else updateInteractionSummary(0);
  }
  function scheduleInteractionIndexBuild(delay){
    cancelScheduledInteractionIndexBuild();
    interactionStartTimer=setTimeout(function(){
      interactionStartTimer=null;
      startInteractionIndexBuild();
    }, delay==null?120:Math.max(0,Number(delay)||0));
  }
  function categoryIsProtein(c){ return c==='protein'; }
  function categoryIsLigand(c){ return c==='ligands'||c==='ligand'; }
  function interactionInScope(item,scope){
    if(!item)return false;
    if(scope==='pl')return (categoryIsProtein(item.ca)&&categoryIsLigand(item.cb))||(categoryIsLigand(item.ca)&&categoryIsProtein(item.cb));
    if(scope==='pp')return categoryIsProtein(item.ca)&&categoryIsProtein(item.cb);
    return true;
  }
  function atomForInteractionSerial(serial,record){
    if(record&&record.entryName){
      const direct=atomByEntrySourceSerial.get(atomEntryIndexKey(record.entryName,serial));
      if(direct)return direct;
      const n=Number(serial);
      if(!Number.isNaN(n)){
        const numeric=atomByEntrySourceSerial.get(atomEntryIndexKey(record.entryName,n));
        if(numeric)return numeric;
      }
    }
    return atomBySerial.get(Number(serial))||atomBySerial.get(serial)||null;
  }
  function drawIndexedPair(item,color,record){
    const a=atomForInteractionSerial(item.a,record),b=atomForInteractionSerial(item.b,record);
    if(!isInteractionAtomShown(a)||!isInteractionAtomShown(b))return;
    drawDash(a,b,color);
  }
  function drawIndexedHbond(item,color,record){
    const h=atomForInteractionSerial(item.h,record),a=atomForInteractionSerial(item.b,record);
    if(!isInteractionAtomShown(h)||!isInteractionAtomShown(a))return;
    drawDash(h,a,color);
  }
  function drawIndexedPiCation(item,color,record){
    const ring=atomForInteractionSerial(item.ringAtom,record),cat=atomForInteractionSerial(item.cat,record);
    if(!isInteractionAtomShown(ring)||!isInteractionAtomShown(cat))return;
    drawDashAP(cat,item.center,color);
  }
  function drawIndexedPiPi(item,color,record){
    const a=atomForInteractionSerial(item.ringAtomA,record),b=atomForInteractionSerial(item.ringAtomB,record);
    if(!item.centerA||!item.centerB||!isInteractionAtomShown(a)||!isInteractionAtomShown(b))return;
    drawDashPP(item.centerA,item.centerB,color);
  }
  function indexedInteractionsReady(){ return readyInteractionSlots().length>0; }
  function atomLevelAtomsForSource(sourceAtoms){ return sourceAtoms?sourceAtoms.filter(isAtomLevelShown):atomLevelAtoms(); }
  function aromaticRings(sourceAtoms){ const by=new Map(); for(const a of (sourceAtoms||atoms)){ const r=normUpper(a.resn); if(!aromaticDefs[r])continue; const k=(a._entryName||'')+':'+(a.chain||'')+':'+a.resi+':'+r; if(!by.has(k))by.set(k,[]); by.get(k).push(a); } const rings=[]; for(const list of by.values()){ const r=normUpper(list[0].resn),ra=list.filter(a=>aromaticDefs[r].includes(a.atom)); if(ra.length<5)continue; const c=ra.reduce((p,a)=>({x:p.x+a.x,y:p.y+a.y,z:p.z+a.z}),{x:0,y:0,z:0}); c.x/=ra.length;c.y/=ra.length;c.z/=ra.length; rings.push({atom:ra[0],center:c}); } return rings; }
  function ringsLvl(sourceAtoms){ return aromaticRings(sourceAtoms).filter(r=>isAtomLevelShown(r.atom)); }
  function detectAromHB(scope,sourceAtoms){
    const rings=ringsLvl(sourceAtoms),don=atomLevelAtomsForSource(sourceAtoms).filter(a=>['N','O'].includes(atomElem(a))&&!isWaterAtom(a)),out=[];
    function add(rs,ds,chk){ for(const r of rs)for(const d of ds){ if(chk&&residueKey(r.atom)===residueKey(d))continue; const dist=distance(r.center,point(d)); if(dist>=2.8&&dist<=4.3)out.push({center:r.center,don:d,d:dist}); } }
    if(scope==='pl'){ add(rings.filter(r=>isProtein(r.atom)),don.filter(isLigand),false); add(rings.filter(r=>isLigand(r.atom)),don.filter(isProtein),false); }
    else if(scope==='pp')add(rings.filter(r=>isProtein(r.atom)),don.filter(isProtein),true);
    else add(rings,don,true);
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
  function drawDash(a,b,c){ addInteractionWideLine(point(a),point(b),c,lineWidths.interaction,true); }
  function drawDashAP(a,p,c){ addInteractionWideLine(point(a),p,c,lineWidths.interaction,true); }
  function drawDashPP(p,q,c){ addInteractionWideLine(p,q,c,lineWidths.interaction,true); }
  function presentOverlayFrame(){ if(wideLineLayer)presentViewer(null,false); else presentViewer(null,true); }
  function redrawInteractions(render){
    if(!viewer)return;
    clearInteractionShapes();
    updateInteractionAggregate();
    if(!interState.enabled){ updateInteractionSummary(0); if(render!==false)presentOverlayFrame(); return; }
    if(!model||!atoms.length){ updateInteractionSummary(0); if(render!==false)presentOverlayFrame(); return; }
    const slots=readyInteractionSlots();
    if(!slots.length){
      updateInteractionSummary(0);
      if(render!==false)presentOverlayFrame();
      return;
    }
    const T=interState.types,S=interState.scope;
    try{
      slots.forEach(slot=>{
        const record=slot.record,data=record.interactions||{},sourceAtoms=entryAtomsForInteractionIndex(slot.entry);
        if(T.hbond.on)(data.hbond||[]).forEach(item=>{ if(item.distance<=state.hbondCutoff&&interactionInScope(item,S.noncov))drawIndexedHbond(item,T.hbond.color,record); });
        if(T.halogen.on)(data.halogen||[]).forEach(item=>{ if(interactionInScope(item,S.noncov))drawIndexedPair(item,T.halogen.color,record); });
        if(T.salt.on)(data.salt||[]).forEach(item=>{ if(item.distance<=state.saltCutoff&&interactionInScope(item,S.noncov))drawIndexedPair(item,T.salt.color,record); });
        if(T.aromhb.on)detectAromHB(S.noncov,sourceAtoms).forEach(p=>drawDashAP(p.don,p.center,T.aromhb.color));
        if(T.pipi.on)(data.pipi||[]).forEach(item=>{ if(interactionInScope(item,S.pi))drawIndexedPiPi(item,T.pipi.color,record); });
        if(T.pication.on)(data.pication||[]).forEach(item=>{ if(interactionInScope(item,S.pi))drawIndexedPiCation(item,T.pication.color,record); });
        if(T.good.on||T.bad.on||T.ugly.on){ const c=data.contacts||{};
          if(T.good.on)(c.good||[]).forEach(item=>{ if(interactionInScope(item,S.contact))drawIndexedPair(item,T.good.color,record); });
          if(T.bad.on)(c.bad||[]).forEach(item=>{ if(interactionInScope(item,S.contact))drawIndexedPair(item,T.bad.color,record); });
          if(T.ugly.on)(c.ugly||[]).forEach(item=>{ if(interactionInScope(item,S.contact))drawIndexedPair(item,T.ugly.color,record); });
        }
      });
    }catch(e){ console.warn('Interaction redraw failed',e); }
    if(wideLineLayer)wideLineLayer.setCollection('interactions',interactionWideLines,[],{linewidth:lineWidths.interaction,opacity:1});
    updateInteractionSummary(wideLineLayer?interactionWideLines.length:interactionShapes.length);
    if(render!==false)presentOverlayFrame();
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
      {key:'noncov',name:'Non-covalent bonds',rows:[['hbond','halogen'],['salt','aromhb']]},
      {key:'pi',name:'Pi interactions',rows:[['pipi','pication']]},
      {key:'contact',name:'Contacts/Clashes',rows:[['good','bad','ugly']]}
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
      sec.appendChild(head);
      g.rows.forEach(row=>{ const r=document.createElement('div'); r.style.cssText='display:grid;grid-template-columns:repeat('+row.length+',1fr);gap:8px;padding-left:30px'; row.forEach(k=>r.appendChild(makeInterToggle(k))); sec.appendChild(r); });
      body.appendChild(sec);
    });
  }
  function openInterPanel(){ $('interPanel').hidden=false; setBtnActive($('interBtn'),true); }
  function closeInterPanel(){ $('interPanel').hidden=true; setBtnActive($('interBtn'),false); }
  function toggleInterPanel(){ if($('interPanel').hidden)openInterPanel(); else closeInterPanel(); }
  function indexedInteractionTotal(){
    const c=aggregateInteractionCounts(readyInteractionSlots());
    return ['hbond','halogen','salt','pipi','pication','contactGood','contactBad','contactUgly'].reduce((sum,k)=>sum+Number(c[k]||0),0);
  }
  function updateInteractionSummary(visibleCount){
    const btn=$('interBtn'); if(!btn)return;
    updateInteractionAggregate();
    const visible=Number(visibleCount||0),indexed=indexedInteractionTotal();
    btn.textContent=indexedInteractionsReady()?'Interactions '+visible:'Interactions';
    const ready=interactionIndex&&interactionIndex.readyEntries||0,total=interactionIndex&&interactionIndex.totalEntries||0;
    if(!total){
      btn.title='No entries displayed';
    }else if(indexedInteractionsReady()){
      btn.title='Indexed '+indexed+' interactions for '+ready+'/'+total+' displayed entr'+(total===1?'y':'ies')+'; '+visible+' currently visible with atom-level display';
    }else if(interactionIndex&&/^(loading|pending)$/.test(interactionIndex.status)){
      btn.title='Interaction indexes are loading for displayed entries';
    }else if(interactionIndex&&interactionIndex.status==='unavailable'){
      btn.title='Interaction indexing skipped for large displayed entries';
    }else{
      btn.title='Interactions not indexed yet';
    }
  }
  function updateInterToggle(){
    const b=$('interToggle'); if(!b)return;
    const on=interState.enabled;
    b.style.background=on?'#1a4f7a':'#2d2d2d';
    b.style.borderColor=on?'#3a7bd5':'#555';
    b.style.color=on?'#fff':'#6f6f6f';
    b.title=on?'Interactions on - click to turn off':'Interactions off - click to turn on';
  }
  function setBtnActive(btn,on){ if(!btn)return; btn.style.background=on?'#1a4f7a':'#2d2d2d'; btn.style.borderColor=on?'#3a7bd5':'#555'; btn.style.color=on?'#fff':'#d4d4d4'; }

  function chargeOf(resn){ const r=normUpper(resn); if(r==='ARG'||r==='LYS')return 1; if(r==='ASP'||r==='GLU')return -1; return 0; }
  function updateStatusBar(){
    const chains=new Set(),protChains=new Set(); let residues=0,ligands=0,charge=0;
    visibleEntryRecords().forEach(record=>{
      const stats=record.stats||entryStatsForAtoms(record.atoms);
      residues+=stats.residues||0;
      ligands+=stats.ligands||0;
      charge+=stats.charge||0;
      (stats.chains||[]).forEach(c=>chains.add(c));
      (stats.proteinChains||[]).forEach(c=>protChains.add(c));
    });
    const mols = protChains.size + ligands;
    $('stAtoms').textContent=atoms.length.toLocaleString();
    $('stChains').textContent=chains.size;
    $('stResidues').textContent=residues.toLocaleString();
    const includedCount=includedEntries().length;
    $('stEntries').textContent=includedCount===entries.length?entries.length:(includedCount+'/'+entries.length);
    $('stMols').textContent=mols;
    $('stCharge').textContent=(charge>0?'+':'')+charge;
    $('stDisplayed').textContent=displayedCount.toLocaleString()+' of '+atoms.length.toLocaleString();
    updateSelectionStatus();
  }
  function updateSelectionStatus(info){
    info=info||selectionInfo(state.selectionSel);
    $('stSel').textContent=info.atomCount.toLocaleString()+' atoms, '+info.residueCount.toLocaleString()+' residues';
  }

  // ---------- Hierarchy & Entries ----------
  function beginEntryTitleEdit(entry,labelEl){
    if(!entry||!labelEl)return;
    const input=document.createElement('input');
    input.type='text';
    input.value=entry.title||entry.name||'';
    input.style.cssText='width:100%;min-width:0;height:18px;box-sizing:border-box;background:#101010;color:#fff;border:1px solid #3a7bd5;border-radius:3px;padding:0 4px;font:inherit;outline:none';
    labelEl.replaceWith(input);
    let done=false;
    function finish(save){
      if(done)return;
      done=true;
      const next=normText(input.value);
      if(save&&next&&next!==entry.title){
        renameEntry(entry.name,next).catch(err=>{ setStatus('Rename failed: '+(err&&err.message||err)); buildEntriesList(); });
      }else{
        buildEntriesList();
      }
    }
    input.onclick=function(ev){ ev.stopPropagation(); };
    input.ondblclick=function(ev){ ev.stopPropagation(); };
    input.onkeydown=function(ev){
      if(ev.key==='Enter'){ ev.preventDefault(); finish(true); }
      else if(ev.key==='Escape'){ ev.preventDefault(); finish(false); }
    };
    input.onblur=function(){ finish(true); };
    setTimeout(()=>{ input.focus(); input.select(); },0);
  }
  function buildEntriesList(){
    const el=$('entriesList'); el.innerHTML='';
    entries.forEach((e,i)=>{
      const row=document.createElement('div');
      row.setAttribute('data-row','');
      row.style.cssText='display:grid;grid-template-columns:34px 26px 1fr 20px;align-items:center;height:22px;padding:0 8px 0 5px;cursor:default;font-size:11.5px;border-left:3px solid transparent;background:transparent';
      const rn=document.createElement('span'); rn.textContent=String(i+1); rn.style.color='#8f8f8f';
      const chk=document.createElement('input'); chk.type='checkbox';
      chk.checked=entryChecked[e.name]!==false;
      const CHK_ON="border:1px solid #3a7bd5;background:#3a7bd5 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\") center/10px no-repeat";
      const CHK_OFF='border:1px solid #6b6b6b;background:#1f1f1f';
      function paintChk(){ chk.style.cssText='appearance:none;-webkit-appearance:none;width:13px;height:13px;border-radius:3px;justify-self:center;margin:0;cursor:pointer;'+(chk.checked?CHK_ON:CHK_OFF); }
      paintChk();
      chk.onclick=function(ev){ ev.stopPropagation(); };
      chk.onchange=function(){ setEntryIncludedWithBusy(e,chk.checked); };
      const ttl=document.createElement('span'); ttl.textContent=e.title; ttl.style.cssText='color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text'; ttl.title='Double-click to rename: '+e.title;
      ttl.onclick=function(ev){ ev.stopPropagation(); };
      ttl.ondblclick=function(ev){ ev.preventDefault(); ev.stopPropagation(); beginEntryTitleEdit(e,ttl); };
      const del=document.createElement('button');
      del.type='button';
      del.textContent='\u00d7';
      del.title='Delete entry';
      del.style.cssText='width:17px;height:17px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:3px;background:transparent;color:#9a9a9a;cursor:pointer;font-size:13px;line-height:1;padding:0';
      del.onmouseenter=function(){ del.style.color='#fff'; del.style.borderColor='#555'; del.style.background='#3a1f1f'; };
      del.onmouseleave=function(){ del.style.color='#9a9a9a'; del.style.borderColor='transparent'; del.style.background='transparent'; };
      del.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation(); deleteEntry(e); };
      row.appendChild(rn); row.appendChild(chk); row.appendChild(ttl); row.appendChild(del);
      el.appendChild(row);
    });
  }
  function chainVisibilityKey(entry,chain){ return (entry||'')+'\u0001'+(chain||'?'); }
  function chainVisibilityValue(entry,chain){
    const key=chainVisibilityKey(entry,chain);
    if(Object.prototype.hasOwnProperty.call(state.chainVisible,key))return state.chainVisible[key]!==false;
    if(Object.prototype.hasOwnProperty.call(state.chainVisible,chain))return state.chainVisible[chain]!==false;
    return true;
  }
  function isChainVisible(a){ return chainVisibilityValue(a&&a._entryName,a&&a.chain); }
  function setChainVisibility(entry,chain,on){
    state.chainVisible[chainVisibilityKey(entry,chain)]=!!on;
    delete state.chainVisible[chain];
  }
  function groupVisibilityKey(entry,chain,resn,resi){ return [entry||'',chain||'',resn||'',resi==null?'':resi].join('\u0001'); }
  function groupVisibilityKeyFromGroup(g){ return groupVisibilityKey(g.entry,g.chain,g.resn,g.resi); }
  function groupVisibilityKeyFromAtom(a){ return groupVisibilityKey(a&&a._entryName,a&&a.chain,a&&a.resn,a&&a.resi); }
  function groupVisibilityValue(g){ return state.groupVisible[groupVisibilityKeyFromGroup(g)]!==false; }
  function isGroupVisible(a){ return state.groupVisible[groupVisibilityKeyFromAtom(a)]!==false; }
  function setGroupVisibility(g,on){ state.groupVisible[groupVisibilityKeyFromGroup(g)]=!!on; }
  function serialsForAtoms(list){ const out=[]; (list||[]).forEach(a=>{ if(a&&a.serial!=null)out.push(a.serial); }); return out; }
  function setStyleForSerials(list,spec,add){
    const serials=serialsForAtoms(list);
    if(!serials.length)return;
    if(add)viewer.addStyle({serial:serials},spec);
    else viewer.setStyle({serial:serials},spec);
  }
  function setStyleForSelector(sel,spec,add){
    if(add)viewer.addStyle(sel,spec);
    else viewer.setStyle(sel,spec);
  }
  function applyBaseStylesForAtoms(list){
    const by={protein:[],ligands:[],solvents:[],other:[]};
    (list||[]).forEach(a=>{ const c=atomCategory(a); if(by[c])by[c].push(a); });
    if(by.protein.length){
      setStyleForSerials(by.protein,proteinBackboneStyleSpec(),false);
      if(state.proteinAtoms!=='off')setStyleForSerials(by.protein,proteinAtomStyleSpec(),true);
    }
    if(by.ligands.length)setStyleForSerials(by.ligands,ligandStyleSpec(),false);
    if(by.solvents.length)setStyleForSerials(by.solvents,solventStyleSpec(),false);
    if(by.other.length)setStyleForSerials(by.other,otherStyleSpec(),false);
  }
  function hasStyleSpec(spec){ return !!(spec&&Object.keys(spec).length); }
  function setModelStyle(model,selector,spec,add){
    if(!model||typeof model.setStyle!=='function'||!hasStyleSpec(spec))return;
    model.setStyle(selector||{},spec,!!add);
  }
  function setModelStyleForAtoms(model,list,spec,add){
    if(!model||typeof model.setStyle!=='function'||!hasStyleSpec(spec))return;
    const serials=serialsForAtoms(list);
    if(serials.length)model.setStyle({serial:serials},spec,!!add);
  }
  function applyBaseStylesForRecord(record){
    if(!record||!record.model||!record.atoms)return;
    const model=record.model, by={ligands:[],solvents:[],other:[]};
    let hasProtein=false;
    record.atoms.forEach(a=>{
      const c=atomCategory(a);
      if(c==='protein')hasProtein=true;
      else if(by[c])by[c].push(a);
    });
    model.setStyle({},{});
    if(hasProtein){
      setModelStyle(model,{hetflag:false},proteinBackboneStyleSpec(),false);
      setModelStyle(model,{hetflag:false},proteinAtomStyleSpec(),true);
    }
    if(by.ligands.length)setModelStyleForAtoms(model,by.ligands,ligandStyleSpec(),false);
    if(by.solvents.length&&state.solvent!=='off')setModelStyleForAtoms(model,by.solvents,solventStyleSpec(),false);
    if(by.other.length&&state.other!=='off')setModelStyleForAtoms(model,by.other,otherStyleSpec(),false);
  }
  function applyRuleOverlays(){
    for(const r of state.styleRules){ if(r.disabled)continue; try{ if(r.options&&r.options.atomLevel)applyAtomLevelStyleRule(r); else viewer.addStyle(styleSelection(r.selector,r.options), styleSpec(r.representation,r.options)); }catch(e){ console.warn('Style rule failed',r,e); } }
    for(const r of state.hiddenRules){ if(r.disabled)continue; try{ if(r.options&&r.options.atomLevel)applyAtomLevelHideRule(r); else viewer.setStyle(styleSelection(r.selector,r.options),{}); }catch(e){ console.warn('Hide rule failed',r,e); } }
  }
  let visibilityRefreshTimer=null, visibilityInteractionTimer=null;
  function scheduleVisibilityLayerRefresh(){
    resetAtomLevelCache();
    if(visibilityRefreshTimer!=null)clearTimeout(visibilityRefreshTimer);
    const run=function(){
      visibilityRefreshTimer=null;
      displayedCount=atoms.filter(isAtomVisibleNow).length;
      redrawWideLineStyles();
      if(state.selectionSel)renderSelectionHighlight(false,selectedAtomsForSelector(state.selectionSel));
      updateStatusBar();
      if(viewer)viewer.render();
    };
    visibilityRefreshTimer=setTimeout(run,16);
    if(visibilityInteractionTimer!=null)clearTimeout(visibilityInteractionTimer);
    visibilityInteractionTimer=setTimeout(function(){
      visibilityInteractionTimer=null;
      resetAtomLevelCache();
      redrawInteractions(false);
      if(viewer)viewer.render();
    },180);
  }
  function applyVisibilityForAtoms(list,selector){
    if(!viewer||!model)return;
    const visible=[],hidden=[];
    (list||[]).forEach(a=>{ (isAtomVisibleNow(a)?visible:hidden).push(a); });
    if(hidden.length){
      if(selector&&hidden.length===(list||[]).length)setStyleForSelector(selector,{},false);
      else setStyleForSerials(hidden,{},false);
    }
    if(visible.length){
      if(selector&&visible.length===(list||[]).length&&visible.every(isProtein)){
        setStyleForSelector(selector,proteinBackboneStyleSpec(),false);
        if(state.proteinAtoms!=='off')setStyleForSelector(selector,proteinAtomStyleSpec(),true);
      }else applyBaseStylesForAtoms(visible);
      applyRuleOverlays();
    }
    scheduleVisibilityLayerRefresh();
  }
  function hierarchyRowKey(row){
    const match=row&&row.__hierarchyMatch;
    return match?(match.type||'')+'\u0001'+(match.key||''):'';
  }
  function visibleSelectableHierarchyRows(){
    return hierarchyRows.filter(row=>{
      const serials=row&&row.__hierarchyMatch&&row.__hierarchyMatch.serials;
      return serials&&serials.length;
    });
  }
  function hierarchyRowsInRange(row){
    const rows=visibleSelectableHierarchyRows();
    const end=rows.indexOf(row);
    if(end<0)return row?[row]:[];
    let start=rows.findIndex(item=>hierarchyRowKey(item)===hierarchySelectionAnchorKey);
    if(start<0)start=end;
    const lo=Math.min(start,end),hi=Math.max(start,end);
    return rows.slice(lo,hi+1);
  }
  function uniqueHierarchySerials(rows){
    const out=[],seen=new Set();
    (rows||[]).forEach(row=>{
      const serials=row&&row.__hierarchyMatch&&row.__hierarchyMatch.serials;
      (serials||[]).forEach(serial=>{
        if(serial==null||seen.has(serial))return;
        seen.add(serial);
        out.push(serial);
      });
    });
    return out;
  }
  function setHierarchySerialSelection(serials){
    if(!serials||!serials.length){ clearSelection(); return; }
    setSelection({serial:serials},{});
  }
  function hierarchySelectRow(row,e){
    const match=row&&row.__hierarchyMatch, serials=match&&match.serials;
    if(!serials||!serials.length)return;
    const key=hierarchyRowKey(row);
    if(e&&e.shiftKey){
      const rangeSerials=uniqueHierarchySerials(hierarchyRowsInRange(row));
      if(e.ctrlKey||e.metaKey){
        const selected=new Set(serialsForAtoms(selectionAtoms));
        rangeSerials.forEach(serial=>selected.add(serial));
        setHierarchySerialSelection(Array.from(selected));
      }else{
        setHierarchySerialSelection(rangeSerials);
      }
      if(!hierarchySelectionAnchorKey)hierarchySelectionAnchorKey=key;
      return;
    }
    if(e&&(e.ctrlKey||e.metaKey)){
      const selected=new Set(serialsForAtoms(selectionAtoms));
      const allSelected=serials.every(serial=>selected.has(serial));
      if(allSelected)serials.forEach(serial=>selected.delete(serial));
      else serials.forEach(serial=>selected.add(serial));
      if(!hierarchySelectionAnchorKey)hierarchySelectionAnchorKey=key;
      setHierarchySerialSelection(Array.from(selected));
      return;
    }
    hierarchySelectionAnchorKey=key;
    setHierarchySerialSelection(serials.slice());
  }
  function hierarchySubhead(label,indent){
    const row=document.createElement('div');
    row.style.cssText='height:19px;padding:0 8px 0 '+(indent||34)+'px;font-size:10.5px;color:#8f8f8f;display:flex;align-items:center;text-transform:uppercase;letter-spacing:.04em';
    row.textContent=label;
    return row;
  }
  function hierarchyChildRow(opts){
    const row=document.createElement('div');
    row.setAttribute('data-row','');
    if(opts.match){
      row.__hierarchyMatch=hierarchyMatch(opts.match.type,opts.match.key,opts.atoms);
      hierarchyRows.push(row);
    }
    row.style.cssText='display:flex;align-items:center;gap:7px;min-height:20px;padding:0 8px 0 '+(opts.indent||34)+'px;font-size:11.5px;cursor:pointer';
    if(opts.checkbox){
      const chk=document.createElement('input');
      chk.type='checkbox';
      chk.checked=opts.checked!==false;
      chk.style.cssText='width:12px;height:12px;accent-color:#3a7bd5;cursor:pointer;flex:none';
      chk.onclick=function(e){ e.stopPropagation(); };
      chk.onchange=opts.oncheck;
      row.appendChild(chk);
    }
    const dot=document.createElement('span');
    dot.style.cssText='width:8px;height:8px;border-radius:2px;background:'+(opts.color||'#888')+';flex:none';
    const lab=document.createElement('span');
    lab.textContent=opts.label;
    lab.title=opts.title||opts.label;
    lab.style.cssText='color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const cnt=document.createElement('span');
    cnt.textContent=opts.count?'('+opts.count+')':'';
    cnt.style.cssText='color:#777;font-size:10px;flex:none';
    row.appendChild(dot); row.appendChild(lab); row.appendChild(cnt);
    row.onclick=function(e){ hierarchySelectRow(row,e); };
    return row;
  }
  function syncHierarchySelectionHighlight(){
    const tree=$('hierarchyTree');
    if(!tree)return;
    const selectedSerials=new Set(serialsForAtoms(selectionAtoms));
    const rows=hierarchyRows.length?hierarchyRows:Array.from(tree.querySelectorAll('[data-row]'));
    rows.forEach(row=>{
      const m=row.__hierarchyMatch;
      row.classList.toggle('is-selected',hierarchyMatchSelected(m,selectedSerials));
    });
  }
  function residueSortValue(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
  function compareHierarchyGroups(a,b){
    const ea=normText(a.entryTitle||a.entry),eb=normText(b.entryTitle||b.entry);
    if(ea!==eb)return ea<eb?-1:1;
    const ca=normText(a.chain),cb=normText(b.chain);
    if(ca!==cb)return ca<cb?-1:1;
    const an=residueSortValue(a.resi),bn=residueSortValue(b.resi);
    if(an!=null&&bn!=null&&an!==bn)return an-bn;
    const ra=normText(a.resi),rb=normText(b.resi);
    if(ra!==rb)return ra<rb?-1:1;
    return normText(a.resn)<normText(b.resn)?-1:(normText(a.resn)>normText(b.resn)?1:0);
  }
  function hierarchyPrefix(g,multi){ return multi?(normText(g.entryTitle||g.entry)+': '):''; }
  function moleculeLabel(g,multi){
    const parts=[hierarchyPrefix(g,multi)+normText(g.resn||'MOL')];
    if(g.resi!=null&&normText(g.resi)!=='')parts.push(String(g.resi));
    if(normText(g.chain))parts.push('Chain '+g.chain);
    return parts.join(' ');
  }
  function residueGroupKey(a){ return [a._entryName||'',a.chain||'',a.resn||'',a.resi==null?'':a.resi].join('\u0001'); }
  function hierarchySectionKey(entryName,section){ return (entryName||'')+'\u0001section\u0001'+(section||''); }
  function hierarchySerials(list){
    const out=[],seen=new Set();
    (list||[]).forEach(a=>{
      if(!a||a.serial==null||seen.has(a.serial))return;
      seen.add(a.serial);
      out.push(a.serial);
    });
    return out;
  }
  function hierarchyMatch(type,key,list){ return {type,key,serials:hierarchySerials(list)}; }
  function hierarchyMatchSelected(match,selectedSerials){
    const serials=match&&match.serials;
    if(!serials||!serials.length||!selectedSerials||!selectedSerials.size)return false;
    if(serials.length>selectedSerials.size)return false;
    return serials.every(s=>selectedSerials.has(s));
  }
  function hierarchyAtomsFromGroups(groups){
    const out=[];
    (groups||[]).forEach(g=>{ (g&&g.atoms||[]).forEach(a=>out.push(a)); });
    return out;
  }
  function toggleHierarchyCollapse(key,collapsed){
    if(collapsed)delete state.hierarchyCollapsed[key];
    else state.hierarchyCollapsed[key]=true;
    buildHierarchy();
  }
  function hierarchyCollapseArrow(collapsed,title){
    const arrow=document.createElement('span');
    arrow.className='tree-arrow';
    arrow.textContent=collapsed?'\u25b8':'\u25be';
    arrow.title=title;
    arrow.style.cssText='width:14px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;color:#8f8f8f;font-weight:400;line-height:1';
    return arrow;
  }
  function entryTitleForHierarchy(entry){ return entry.title||entry.name||'\u2014'; }
  function entryHeaderRow(entry,count,collapsed,entryAtoms){
    const row=document.createElement('div');
    row.setAttribute('data-row','');
    row.__hierarchyMatch=hierarchyMatch('entry',entry.name,entryAtoms);
    hierarchyRows.push(row);
    row.style.cssText='display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;font-size:11.5px;color:#cfcfcf;font-weight:700;border-top:1px solid #242424;background:#2d2d2d;cursor:pointer';
    row.title='Select entry';
    const arrow=hierarchyCollapseArrow(collapsed,collapsed?'Expand entry':'Collapse entry');
    const lab=document.createElement('span'); lab.textContent=entryTitleForHierarchy(entry); lab.title='Select entry: '+entryTitleForHierarchy(entry); lab.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const cnt=document.createElement('span'); cnt.textContent=count?'('+count+')':''; cnt.style.cssText='color:#777;font-size:10px;font-weight:400;flex:none';
    row.appendChild(arrow); row.appendChild(lab); row.appendChild(cnt);
    arrow.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchyCollapse(entry.name,collapsed);
    };
    row.onclick=function(e){ hierarchySelectRow(row,e); };
    return row;
  }
  function hierarchySectionHeaderRow(opts){
    const row=document.createElement('div');
    row.setAttribute('data-row','');
    row.__hierarchyMatch=hierarchyMatch('section',hierarchySectionKey(opts.entryName,opts.section),opts.atoms);
    hierarchyRows.push(row);
    row.style.cssText='display:flex;align-items:center;gap:6px;height:21px;padding:0 8px 0 '+(opts.indent||22)+'px;font-size:11.5px;cursor:pointer';
    row.title='Select '+opts.label;
    const arrow=hierarchyCollapseArrow(opts.collapsed,opts.collapsed?'Expand '+opts.label:'Collapse '+opts.label);
    const lab=document.createElement('span');
    lab.textContent=opts.label;
    lab.style.cssText='color:#d4d4d4;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const cnt=document.createElement('span');
    cnt.textContent=opts.count?'('+opts.count+')':'';
    cnt.style.cssText='color:#777;font-size:10px;flex:none';
    row.appendChild(arrow); row.appendChild(lab); row.appendChild(cnt);
    arrow.onclick=function(e){
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchyCollapse(opts.collapseKey,opts.collapsed);
    };
    row.onclick=function(e){ hierarchySelectRow(row,e); };
    return row;
  }
  function buildHierarchy(){
    const tree=$('hierarchyTree'); tree.innerHTML=''; hierarchyRows=[];
    updateSelectionStatus();
    const shown=includedEntries();
    shown.forEach(entry=>{
      const record=entryModelCache.get(entry.name);
      const entryAtoms=record&&record.atoms?record.atoms:atomsForEntry(entry);
      const hierarchy=record&&record.hierarchy?record.hierarchy:buildEntryHierarchyCache(entry,entryAtoms);
      const counts=hierarchy.counts||{protein:0,ligands:0,solvents:0,other:0};
      const collapsed=state.hierarchyCollapsed[entry.name]===true;
      tree.appendChild(entryHeaderRow(entry,entryAtoms.length,collapsed,entryAtoms));
      if(collapsed)return;

      if(counts.ligands){
        const key=hierarchySectionKey(entry.name,'ligands'), collapsedSection=state.hierarchyCollapsed[key]===true;
        tree.appendChild(hierarchySectionHeaderRow({entryName:entry.name,section:'ligands',label:'Ligands',count:counts.ligands,atoms:hierarchyAtomsFromGroups(hierarchy.ligands),collapseKey:key,collapsed:collapsedSection,indent:22}));
        if(!collapsedSection){
          hierarchy.ligands.forEach(g=>{
            tree.appendChild(hierarchyChildRow({label:moleculeLabel(g,false),title:moleculeLabel(g,true),count:g.atoms.length,color:'#FF8A65',indent:34,match:{type:'group',key:groupVisibilityKeyFromGroup(g)},atoms:g.atoms,checkbox:true,checked:groupVisibilityValue(g),oncheck:function(){ setGroupVisibility(g,this.checked); applyVisibilityForAtoms(g.atoms); }}));
          });
        }
      }

      if(counts.protein){
        const key=hierarchySectionKey(entry.name,'protein'), collapsedSection=state.hierarchyCollapsed[key]===true;
        tree.appendChild(hierarchySectionHeaderRow({entryName:entry.name,section:'protein',label:'Protein',count:counts.protein,atoms:hierarchyAtomsFromGroups(hierarchy.proteinChains),collapseKey:key,collapsed:collapsedSection,indent:22}));
        if(!collapsedSection){
          hierarchy.proteinChains.forEach(g=>{
            tree.appendChild(hierarchyChildRow({
              label:'Chain '+g.chain,
              title:hierarchyPrefix(g,shown.length>1)+'Chain '+g.chain,
              count:g.atoms.length,
              color:chainColor(g.chain),
              indent:34,
              match:{type:'chain',key:chainVisibilityKey(g.entry,g.chain)},
              atoms:g.atoms,
              checkbox:true,
              checked:chainVisibilityValue(g.entry,g.chain),
              oncheck:function(){ setChainVisibility(g.entry,g.chain,this.checked); applyVisibilityForAtoms(g.atoms,{_entryName:g.entry,chain:g.chain}); }
            }));
          });
        }
      }

      if(counts.solvents){
        const key=hierarchySectionKey(entry.name,'solvents'), collapsedSection=state.hierarchyCollapsed[key]===true;
        tree.appendChild(hierarchySectionHeaderRow({entryName:entry.name,section:'solvents',label:'Solvents',count:counts.solvents,atoms:hierarchyAtomsFromGroups(hierarchy.solvents),collapseKey:key,collapsed:collapsedSection,indent:22}));
        if(!collapsedSection){
          hierarchy.solvents.forEach(g=>{
            tree.appendChild(hierarchyChildRow({label:moleculeLabel(g,false),title:moleculeLabel(g,true),count:g.atoms.length,color:'#4DD0E1',indent:34,match:{type:'group',key:groupVisibilityKeyFromGroup(g)},atoms:g.atoms,checkbox:true,checked:groupVisibilityValue(g),oncheck:function(){ setGroupVisibility(g,this.checked); applyVisibilityForAtoms(g.atoms); }}));
          });
        }
      }

      if(counts.other){
        const key=hierarchySectionKey(entry.name,'other'), collapsedSection=state.hierarchyCollapsed[key]===true;
        tree.appendChild(hierarchySectionHeaderRow({entryName:entry.name,section:'other',label:'Other',count:counts.other,atoms:hierarchyAtomsFromGroups(hierarchy.other),collapseKey:key,collapsed:collapsedSection,indent:22}));
        if(!collapsedSection){
          hierarchy.other.forEach(g=>{
            tree.appendChild(hierarchyChildRow({label:moleculeLabel(g,false),title:moleculeLabel(g,true),count:g.atoms.length,color:'#CE93D8',indent:34,match:{type:'group',key:groupVisibilityKeyFromGroup(g)},atoms:g.atoms,checkbox:true,checked:groupVisibilityValue(g),oncheck:function(){ setGroupVisibility(g,this.checked); applyVisibilityForAtoms(g.atoms); }}));
          });
        }
      }
      if(!entryAtoms.length){
        tree.appendChild(hierarchySubhead('No atoms displayed',22));
      }
    });
    if(!shown.length){
      tree.appendChild(hierarchySubhead('No entries displayed',8));
    }
    syncHierarchySelectionHighlight();
  }

  function hasHugeDisplayedAtoms(){ return atoms.length>=HUGE_FIT_ATOM_LIMIT; }
  function cancelPanelRefresh(){
    if(panelRefreshTimer==null)return;
    if(panelRefreshTimer.kind==='idle'&&typeof cancelIdleCallback==='function')cancelIdleCallback(panelRefreshTimer.id);
    else clearTimeout(panelRefreshTimer.id);
    panelRefreshTimer=null;
  }
  function runPanelRefresh(){
    buildHierarchy();
    updateStatusBar();
    showHover(null);
  }
  function schedulePanelRefresh(delay){
    cancelPanelRefresh();
    const run=function(){ panelRefreshTimer=null; runPanelRefresh(); };
    if(hasHugeDisplayedAtoms()&&typeof requestIdleCallback==='function')panelRefreshTimer={kind:'idle',id:requestIdleCallback(run,{timeout:1500})};
    else panelRefreshTimer={kind:'timeout',id:setTimeout(run,delay==null?40:Math.max(0,Number(delay)||0))};
  }
  function flushPanelRefresh(){
    cancelPanelRefresh();
    runPanelRefresh();
  }

  // ---------- Find ----------
  const findPlaceholders={
    resi:'289 or 300-310',
    resn:'ARG',
    atom:'CA',
    chain:'A',
    elem:'C'
  };
  function updateFindPlaceholder(){
    const type=$('findType').value;
    $('findInput').placeholder=findPlaceholders[type]||'';
  }
  function runFind(){
    const type=$('findType').value, q=normText($('findInput').value);
    findMatches=[]; findIndex=-1;
    if(!q){ $('findCount').textContent='0 matches'; $('findSel').textContent=''; return; }
    const keymap={resi:'resi',resn:'resn',atom:'atom',chain:'chain',elem:'elem'};
    const key=keymap[type];
    const seen=new Set();
    atoms.forEach(a=>{
      let v = key==='elem'?atomElem(a):a[key];
      if(v==null)return;
      if(matchScalar(v,q,key)){
        const entry=a._entryName||'',prefix=entries.length>1?(a._entryTitle||entry)+' ':'';
        if(type==='atom'){
          if(!seen.has(a.serial)){
            seen.add(a.serial);
            findMatches.push({sel:{serial:a.serial},label:prefix+(a.chain||'')+' '+(a.resn||'')+a.resi+' '+a.atom});
          }
        }else if(type==='chain'){
          const gk=entry+':'+(a.chain||'');
          if(!seen.has(gk)){
            seen.add(gk);
            findMatches.push({sel:{_entryName:entry,chain:a.chain},label:prefix+'Chain '+(a.chain||'-')});
          }
        }else{
          const gk=entry+':'+(a.chain||'')+':'+a.resi;
          if(!seen.has(gk)){
            seen.add(gk);
            findMatches.push({sel:{_entryName:entry,chain:a.chain,resi:a.resi,resn:a.resn},label:prefix+(a.chain||'')+' '+(a.resn||'')+' '+a.resi});
          }
        }
      }
    });
    $('findCount').textContent=findMatches.length+' match'+(findMatches.length===1?'':'es');
    if(findMatches.length){ findIndex=0; gotoFindMatch(); } else { $('findSel').textContent='No match; selection kept'; setStatus('Find: no matches'); }
  }
  function gotoFindMatch(){
    if(findIndex<0||findIndex>=findMatches.length)return;
    const m=findMatches[findIndex];
    setSelection(m.sel,{}); focus(m.sel);
    $('findSel').textContent=(findIndex+1)+'/'+findMatches.length+'  '+m.label;
  }
  function stepFind(d){ if(!findMatches.length)return; findIndex=(findIndex+d+findMatches.length)%findMatches.length; gotoFindMatch(); }

  // ---------- Load ----------
  function isMaestroFormat(fmt){
    fmt=normText(fmt).toLowerCase();
    return fmt==='mae'||fmt==='maegz'||fmt==='mae.gz';
  }
  function urlFileName(url){
    const raw=normText(url);
    try{
      const parsed=new URL(raw,window.location.href);
      const part=parsed.pathname.split('/').filter(Boolean).pop();
      return part?decodeURIComponent(part):raw;
    }catch(err){
      return raw.split(/[\\/]/).filter(Boolean).pop()||raw;
    }
  }
  async function convertStructureBuffer(buffer,fmt,name,title,pdbId){
    const params=new URLSearchParams({
      fmt:fmt||'',
      name:name||'structure',
      title:title||name||'structure',
      pdbId:pdbId||''
    });
    const result=await fetchJsonResult(STRUCTURE_CONVERT_API+'?'+params.toString(),{
      method:'POST',
      headers:{'Content-Type':'application/octet-stream'},
      body:buffer
    });
    if(!result.ok)throw new Error('Structure conversion failed: '+persistenceErrorText(result));
    const entry=normalizeStructureEntry(result.data&&result.data.entry);
    if(!entry)throw new Error('Structure conversion returned no coordinates.');
    return entry;
  }
  async function loadUrl(url,fmt,name,title,pdbId){
    const entryName=name||urlFileName(url)||url;
    const displayTitle=title||entryName;
    const explicitFmt=normText(fmt).toLowerCase();
    let sourceFmt=explicitFmt||inferFormat(entryName);
    if(!explicitFmt&&sourceFmt==='pdb'&&entryName!==url)sourceFmt=inferFormat(url);
    setStatus('Loading: '+(displayTitle||url));
    const res=await fetch(url); if(!res.ok)throw new Error(res.status+' '+res.statusText);
    if(isMaestroFormat(sourceFmt)){
      const entry=await convertStructureBuffer(await res.arrayBuffer(),sourceFmt,entryName,displayTitle,pdbId||'');
      return persistAndLoadEntry(entryWithFreshIdentity(entry,displayTitle));
    }
    const data=await res.text();
    const e=entryWithFreshIdentity({name:entryName,title:displayTitle,pdbId:pdbId||'',data,fmt:sourceFmt||'pdb'},displayTitle);
    return persistAndLoadEntry(e);
  }
  async function persistAndLoadEntry(e){
    e=normalizeStructureEntry(e);
    if(!e)throw new Error('Invalid structure data');
    const loaded=loadEntry(e,{persist:false});
    if(!await saveViewerSessionEntryDeferred(loaded,{status:false}))setStatus('Loaded but not saved on server: '+loaded.title);
    return loaded;
  }
  function includedEntries(){ return entries.filter(e=>entryChecked[e.name]!==false); }
  function entryStructureKey(e){
    const record=e&&entryModelCache.get(e.name);
    return record&&record.cacheKey?record.cacheKey:structureCacheKey(e);
  }
  function entryForStructureKey(key,list){
    if(!key)return null;
    const source=list||entries;
    return (source||[]).find(e=>entryStructureKey(e)===key)||null;
  }
  function displayedStructureKey(list){
    if(list.length===1)return entryStructureKey(list[0]);
    return list.length?'multi-'+list.length+'-'+fnv1aHex(list.map(entryStructureKey).join('|')):'';
  }
  function resetSelectionState(){
    state.selectionSel=null;
    selectionAtoms=[];
    state.focusTarget=null;
    state.selectionOptions=defaultSelectionOptions();
    hierarchySelectionAnchorKey='';
  }
  function resetDisplayRulesForStructure(){
    state.styleRules=[];
    state.hiddenRules=[];
    resetSelectionState();
    state.visibility={protein:true,ligands:true,solvents:true,other:true};
    state.chainVisible={};
    state.groupVisible={};
    state.hierarchyCollapsed={};
  }
  function hasObjectKeys(o){ return !!(o&&Object.keys(o).length); }
  function displayStateHasOverrides(){
    return !!(
      state.styleRules.length||
      state.hiddenRules.length||
      hasObjectKeys(state.chainVisible)||
      hasObjectKeys(state.groupVisible)||
      state.visibility.protein!==true||
      state.visibility.ligands!==true||
      state.visibility.solvents!==true||
      state.visibility.other!==true
    );
  }
  function residueOrderValue(v){
    const n=Number(v);
    return Number.isFinite(n)?n:null;
  }
  function secondaryResidueRecords(sourceAtoms,proteinKeys){
    const by=new Map();
    (sourceAtoms||[]).forEach((a,order)=>{
      if(!proteinKeys.has(proteinResidueClassKey(a)))return;
      const key=proteinResidueClassKey(a);
      let rec=by.get(key);
      if(!rec){
        rec={key,chain:normText(a.chain),resi:a.resi,resn:a.resn,order,atoms:[],atomByName:new Map()};
        by.set(key,rec);
      }
      rec.atoms.push(a);
      const name=atomName(a);
      if(name&&!rec.atomByName.has(name)&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&Number.isFinite(a.z)){
        rec.atomByName.set(name,a);
      }
    });
    return Array.from(by.values()).sort((a,b)=>{
      if(a.chain!==b.chain)return a.chain<b.chain?-1:1;
      const an=residueOrderValue(a.resi),bn=residueOrderValue(b.resi);
      if(an!=null&&bn!=null&&an!==bn)return an-bn;
      return a.order-b.order;
    });
  }
  function residueAtom(rec,name){ return rec&&rec.atomByName.get(name)||null; }
  function secondaryCandidate(phi,psi){
    if(!Number.isFinite(phi)||!Number.isFinite(psi))return 'c';
    if(phi>=-95&&phi<=-35&&psi>=-75&&psi<=-10)return 'h';
    if(phi>=-170&&phi<=-80&&((psi>=80&&psi<=180)||(psi>=-180&&psi<=-150)))return 's';
    return 'c';
  }
  function keepSecondaryRuns(chars,type,minLen){
    let start=0;
    while(start<chars.length){
      while(start<chars.length&&chars[start]!==type)start++;
      let end=start;
      while(end<chars.length&&chars[end]===type)end++;
      if(end-start>0&&end-start<minLen){
        for(let i=start;i<end;i++)chars[i]='c';
      }
      start=end+1;
    }
  }
  function setResidueSecondary(chainResidues,chars){
    for(let i=0;i<chainResidues.length;i++){
      const ss=chars[i]||'c',rec=chainResidues[i];
      rec.atoms.forEach(a=>{
        a.ss=ss;
        delete a.ssbegin;
        delete a.ssend;
      });
    }
    for(let i=0;i<chainResidues.length;i++){
      const ss=chars[i]||'c';
      if(ss==='c')continue;
      const prev=i>0?chars[i-1]:'c',next=i<chars.length-1?chars[i+1]:'c';
      chainResidues[i].atoms.forEach(a=>{
        if(prev!==ss)a.ssbegin=true;
        if(next!==ss)a.ssend=true;
      });
    }
  }
  function assignSecondaryStructureFallback(sourceAtoms,proteinKeys){
    if(!proteinKeys||!proteinKeys.size)return;
    const proteinAtoms=(sourceAtoms||[]).filter(a=>proteinKeys.has(proteinResidueClassKey(a)));
    const hasAnnotated=proteinAtoms.some(a=>{ const s=normText(a.ss).toLowerCase(); return s==='h'||s==='s'; });
    if(hasAnnotated)return;
    const residues=secondaryResidueRecords(sourceAtoms,proteinKeys),byChain=new Map();
    residues.forEach(r=>{
      if(!byChain.has(r.chain))byChain.set(r.chain,[]);
      byChain.get(r.chain).push(r);
    });
    byChain.forEach(chainResidues=>{
      const chars=new Array(chainResidues.length).fill('c');
      for(let i=1;i<chainResidues.length-1;i++){
        const prev=chainResidues[i-1],cur=chainResidues[i],next=chainResidues[i+1];
        const prevC=residueAtom(prev,'C'),n=residueAtom(cur,'N'),ca=residueAtom(cur,'CA'),c=residueAtom(cur,'C'),nextN=residueAtom(next,'N');
        if(!prevC||!n||!ca||!c||!nextN)continue;
        const phi=dihedralDeg(prevC,n,ca,c),psi=dihedralDeg(n,ca,c,nextN);
        chars[i]=secondaryCandidate(phi,psi);
      }
      keepSecondaryRuns(chars,'h',4);
      keepSecondaryRuns(chars,'s',4);
      setResidueSecondary(chainResidues,chars);
    });
  }
  function normalizeParsedAtoms(sourceAtoms){
    const proteinKeys=proteinResidueLikeKeysForAtoms(sourceAtoms);
    if(!proteinKeys.size)return;
    (sourceAtoms||[]).forEach(a=>{
      if(proteinKeys.has(proteinResidueClassKey(a)))a.hetflag=false;
    });
    assignSecondaryStructureFallback(sourceAtoms,proteinKeys);
  }
  function prepareDisplayedAtoms(entry,list,serialStart){
    list.forEach(a=>{
      a._entryName=entry.name;
      a._entryTitle=entry.title;
      a._sourceSerial=a.serial==null?a.index:a.serial;
      a.serial=serialStart++;
    });
    return serialStart;
  }
  function hideCachedEntry(record){
    if(!viewer||!record||!record.atoms)return;
    if(record.model&&typeof record.model.setStyle==='function')record.model.setStyle({},{});
    else{
      const serials=serialsForAtoms(record.atoms);
      if(serials.length)viewer.setStyle({serial:serials},{});
    }
    record.sceneBuilt=false;
    record._molAgentShown=false;
  }
  function disposeInteractionIndexForKey(key){
    if(!key)return;
    removeQueuedInteractionBuild(key);
    const worker=interactionWorkers.get(key);
    if(worker){ try{ worker.terminate(); }catch(e){} interactionWorkers.delete(key); }
    interactionIndexByKey.delete(key);
  }
  function structureKeyStillReferenced(key,exceptName,sourceEntries){
    if(!key)return false;
    return (sourceEntries||entries).some(e=>e.name!==exceptName&&structureCacheKey(e)===key);
  }
  function disposeEntryRecord(entryNameOrRecord,referenceEntries){
    const record=typeof entryNameOrRecord==='string'?entryModelCache.get(entryNameOrRecord):entryNameOrRecord;
    if(!record)return;
    const name=record.entry&&record.entry.name;
    hideCachedEntry(record);
    if(viewer&&record.model&&typeof viewer.removeModel==='function'){
      try{ viewer.removeModel(record.model); }catch(e){}
    }
    if(name)entryModelCache.delete(name);
    if(record.cacheKey&&!structureKeyStillReferenced(record.cacheKey,name,referenceEntries))disposeInteractionIndexForKey(record.cacheKey);
  }
  function disposeAllEntryRecords(){
    Array.from(entryModelCache.values()).forEach(record=>disposeEntryRecord(record,[]));
    interactionWorkers.forEach(worker=>{ try{ worker.terminate(); }catch(e){} });
    interactionWorkers.clear();
    interactionBuildQueue.splice(0,interactionBuildQueue.length);
    interactionIndexByKey.clear();
    if(wideLineLayer)wideLineLayer.clear();
    if(viewer)clearInteractionShapes();
    else{ interactionShapes=[]; interactionWideLines=[]; }
    updateInteractionAggregate([]);
  }
  function disposeRecordsOutside(entriesToKeep){
    const nextByName=new Map((entriesToKeep||[]).map(e=>[e.name,structureCacheKey(e)]));
    Array.from(entryModelCache.values()).forEach(record=>{
      const name=record.entry&&record.entry.name;
      if(!nextByName.has(name)||nextByName.get(name)!==record.cacheKey)disposeEntryRecord(record,entriesToKeep);
    });
  }
  function ensureEntryModel(entry){
    const cacheKey=structureCacheKey(entry);
    const cached=entryModelCache.get(entry.name);
    if(cached&&cached.cacheKey===cacheKey)return cached;
    validateStructureCoordinates(entry);
    const m=viewer.addModel(entry.data,entry.fmt||'pdb',{keepH:true});
    const list=m.selectedAtoms({});
    if(!list||!list.length){
      if(viewer&&typeof viewer.removeModel==='function'){
        try{ viewer.removeModel(m); }catch(e){}
      }
      throw new Error('No atoms parsed from '+entry.name+'.');
    }
    nextAtomSerial=prepareDisplayedAtoms(entry,list,nextAtomSerial);
    normalizeParsedAtoms(list);
    const record={entry,model:m,atoms:list,cacheKey,atomMaps:buildAtomMapBundle(list),extent:atomExtent(list),stats:entryStatsForAtoms(list),hierarchy:buildEntryHierarchyCache(entry,list),sceneBuilt:false,_molAgentShown:false};
    if(cached)disposeEntryRecord(cached);
    entryModelCache.set(entry.name,record);
    return record;
  }
  function showEntryRecord(record){
    if(!record||!record.model||!record.model.show)return;
    if(record._molAgentShown===true)return;
    record.model.show();
    record._molAgentShown=true;
  }
  function hideEntryRecord(record){
    if(!record||!record.model||!record.model.hide)return;
    if(record._molAgentShown===false)return;
    record.model.hide();
    record._molAgentShown=false;
  }
  function combineRecordAtoms(records){
    if(!records||!records.length)return [];
    if(records.length===1)return records[0].atoms||[];
    const out=[];
    records.forEach(record=>{
      const list=record&&record.atoms||[];
      for(let i=0;i<list.length;i++)out.push(list[i]);
    });
    return out;
  }
  function buildAtomMapBundle(list){
    const bundle={
      atomByIndex:new Map(),
      atomByEntryIndex:new Map(),
      atomByEntrySourceSerial:new Map(),
      atomBySerial:new Map(),
      atomsByEntry:new Map(),
      atomsByChain:new Map(),
      atomsByEntryChain:new Map(),
      atomsByEntryChainResidue:new Map(),
      atomsByEntryChainResidueName:new Map()
    };
    (list||[]).forEach((a,i)=>{
      atomElem(a);
      if(a.index!=null){
        if(!bundle.atomByIndex.has(a.index))bundle.atomByIndex.set(a.index,a);
        bundle.atomByEntryIndex.set(atomEntryIndexKey(a._entryName,a.index),a);
      }
      if(atomSourceSerial(a)!=null)bundle.atomByEntrySourceSerial.set(atomEntryIndexKey(a._entryName,atomSourceSerial(a)),a);
      if(a.serial!=null)bundle.atomBySerial.set(Number(a.serial),a);
      pushAtomIndex(bundle.atomsByEntry,selectorTextKey(a._entryName),a);
      pushAtomIndex(bundle.atomsByChain,selectorTextKey(a.chain),a);
      pushAtomIndex(bundle.atomsByEntryChain,selectorEntryChainKey(a._entryName,a.chain),a);
      pushAtomIndex(bundle.atomsByEntryChainResidue,selectorEntryChainResidueKey(a._entryName,a.chain,a.resi),a);
      pushAtomIndex(bundle.atomsByEntryChainResidueName,selectorEntryChainResidueNameKey(a._entryName,a.chain,a.resi,a.resn),a);
    });
    return bundle;
  }
  function installAtomMapBundle(bundle){
    atomByIndex=bundle.atomByIndex;
    atomByEntryIndex=bundle.atomByEntryIndex;
    atomByEntrySourceSerial=bundle.atomByEntrySourceSerial;
    atomBySerial=bundle.atomBySerial;
    atomsByEntry=bundle.atomsByEntry;
    atomsByChain=bundle.atomsByChain;
    atomsByEntryChain=bundle.atomsByEntryChain;
    atomsByEntryChainResidue=bundle.atomsByEntryChainResidue;
    atomsByEntryChainResidueName=bundle.atomsByEntryChainResidueName;
  }
  function mergeMapKeepFirst(target,source){ source.forEach((v,k)=>{ if(!target.has(k))target.set(k,v); }); }
  function mergeArrayMap(target,source){
    source.forEach((list,k)=>{
      const prev=target.get(k);
      target.set(k,prev?prev.concat(list):list);
    });
  }
  function mergeAtomMapBundles(records){
    const valid=(records||[]).filter(r=>r&&r.atomMaps);
    if(!valid.length)return null;
    if(valid.length===1)return valid[0].atomMaps;
    const out={
      atomByIndex:new Map(),
      atomByEntryIndex:new Map(),
      atomByEntrySourceSerial:new Map(),
      atomBySerial:new Map(),
      atomsByEntry:new Map(),
      atomsByChain:new Map(),
      atomsByEntryChain:new Map(),
      atomsByEntryChainResidue:new Map(),
      atomsByEntryChainResidueName:new Map()
    };
    valid.forEach(record=>{
      const maps=record.atomMaps;
      mergeMapKeepFirst(out.atomByIndex,maps.atomByIndex);
      maps.atomByEntryIndex.forEach((v,k)=>out.atomByEntryIndex.set(k,v));
      maps.atomByEntrySourceSerial.forEach((v,k)=>out.atomByEntrySourceSerial.set(k,v));
      maps.atomBySerial.forEach((v,k)=>out.atomBySerial.set(k,v));
      mergeArrayMap(out.atomsByEntry,maps.atomsByEntry);
      mergeArrayMap(out.atomsByChain,maps.atomsByChain);
      mergeArrayMap(out.atomsByEntryChain,maps.atomsByEntryChain);
      mergeArrayMap(out.atomsByEntryChainResidue,maps.atomsByEntryChainResidue);
      mergeArrayMap(out.atomsByEntryChainResidueName,maps.atomsByEntryChainResidueName);
    });
    return out;
  }
  function atomsForEntry(entry){
    const record=entryModelCache.get(entry&&entry.name);
    if(record&&record.atoms)return record.atoms;
    return atomsByEntry.get(selectorTextKey(entry&&entry.name))||[];
  }
  function entryStatsForAtoms(list){
    const residues=new Set(),chains=new Set(),ligands=new Set(),proteinChains=new Set(),seenRes=new Set();
    let charge=0;
    (list||[]).forEach(a=>{
      const rk=(a._entryName||'')+':'+(a.chain||'')+':'+a.resi+':'+(a.resn||'');
      residues.add(rk);
      chains.add(a.chain||'?');
      if(isLigand(a))ligands.add(rk);
      if(isProtein(a))proteinChains.add(a.chain||'?');
      if(!seenRes.has(rk)){
        seenRes.add(rk);
        charge+=chargeOf(a.resn);
      }
    });
    return {atoms:(list||[]).length,residues:residues.size,chains:Array.from(chains),ligands:ligands.size,proteinChains:Array.from(proteinChains),charge};
  }
  function residueGroupFromAtom(map,a){
    const key=residueGroupKey(a);
    let g=map.get(key);
    if(!g){
      g={entry:a._entryName||'',entryTitle:a._entryTitle||a._entryName||'',chain:a.chain||'',resn:a.resn||'',resi:a.resi,atoms:[]};
      map.set(key,g);
    }
    g.atoms.push(a);
  }
  function buildEntryHierarchyCache(entry,list){
    const counts={protein:0,ligands:0,solvents:0,other:0};
    const ligandGroups=new Map(),solventGroups=new Map(),otherGroups=new Map(),proteinChains=new Map();
    (list||[]).forEach(a=>{
      const c=atomCategory(a);
      counts[c]++;
      if(c==='protein'){
        const key=(a._entryName||'')+'\u0001'+(a.chain||'?');
        let g=proteinChains.get(key);
        if(!g){
          g={entry:a._entryName||'',entryTitle:a._entryTitle||a._entryName||'',chain:a.chain||'?',atoms:[]};
          proteinChains.set(key,g);
        }
        g.atoms.push(a);
      }else if(c==='ligands')residueGroupFromAtom(ligandGroups,a);
      else if(c==='solvents')residueGroupFromAtom(solventGroups,a);
      else if(c==='other')residueGroupFromAtom(otherGroups,a);
    });
    return {
      entryName:entry&&entry.name||'',
      counts,
      ligands:Array.from(ligandGroups.values()).sort(compareHierarchyGroups),
      solvents:Array.from(solventGroups.values()).sort(compareHierarchyGroups),
      other:Array.from(otherGroups.values()).sort(compareHierarchyGroups),
      proteinChains:Array.from(proteinChains.values()).sort(compareHierarchyGroups)
    };
  }
  function restyleEntryRecord(record){
    if(!record||!record.atoms||!record.atoms.length)return;
    applyBaseStylesForRecord(record);
    record.styleGeneration=styleGeneration;
    record.sceneBuilt=false;
  }
  function refreshAtomMaps(records){
    const bundle=mergeAtomMapBundles(records);
    installAtomMapBundle(bundle||buildAtomMapBundle(atoms));
    resetAtomLevelCache();
  }
  function finishStructureRefresh(visible,opts){
    opts=opts||{};
    currentStructureKey=displayedStructureKey(visible);
    setupAtomEvents();
    applyStylesFull(false);
    if(opts.preserveView&&opts.view)restoreViewNoRender(opts.view);
    else if(opts.zoom!==false) fitVisible({render:false});
    presentViewer(visibleEntryRecords(),true);
    buildEntriesList(); buildHierarchy(); updateStatusBar();
    showHover(null);
    if(visible.length){
      setStatus(visible.length===1?(visible[0].title||visible[0].name)+' \u00b7 '+atoms.length.toLocaleString()+' atoms':visible.length+' entries displayed');
      startInteractionIndexBuild();
    }else{
      clearInteractionShapes();
      updateInteractionAggregate(visible);
      updateInteractionSummary(0);
      setStatus('No entries displayed');
    }
  }
  function rebuildDisplayedEntries(opts){
    opts=opts||{};
    if(!viewer)initViewer();
    const view=opts.preserveView&&viewer&&viewer.getView?viewer.getView():null;
    const visible=includedEntries();
    const visibleNames=new Set(visible.map(e=>e.name));
    entryModelCache.forEach((record,name)=>{ if(!visibleNames.has(name))hideEntryRecord(record); });
    if(wideLineLayer)wideLineLayer.clear();
    interactionShapes=[]; interactionWideLines=[];
    viewer.setStyle({},{});
    models=[]; model=null; atoms=[];
    const visibleRecords=[];
    visible.forEach(e=>{
      const record=ensureEntryModel(e);
      showEntryRecord(record);
      models.push({entry:e,model:record.model});
      visibleRecords.push(record);
    });
    atoms=combineRecordAtoms(visibleRecords);
    model=models.length?models[0].model:null;
    refreshAtomMaps(visibleRecords);
    if(!model){
      currentStructureKey='';
      resetAtomLevelCache();
      clearInteractionShapes();
      updateInteractionAggregate([]);
      clearSelectionHighlight();
      buildEntriesList(); buildHierarchy(); updateStatusBar();
      showHover(null);
      presentViewer(null,false);
      updateInteractionSummary(0);
      setStatus('No entries displayed');
      return null;
    }
    finishStructureRefresh(visible,Object.assign({},opts,{view}));
    return visible;
  }
  function refreshDisplayedEntriesFast(opts){
    opts=opts||{};
    if(!viewer)initViewer();
    const view=opts.preserveView&&viewer&&viewer.getView?viewer.getView():null;
    const visible=includedEntries();
    const visibleNames=new Set(visible.map(e=>e.name));
    entryModelCache.forEach((record,name)=>{ if(!visibleNames.has(name))hideEntryRecord(record); });
    if(wideLineLayer)wideLineLayer.clearCollection('selection');
    clearSelectionHighlight();
    models=[]; model=null; atoms=[];
    const visibleRecords=[];
    const needsStyle=[];
    visible.forEach(e=>{
      const record=ensureEntryModel(e);
      showEntryRecord(record);
      models.push({entry:e,model:record.model});
      visibleRecords.push(record);
      if(record.styleGeneration!==styleGeneration)needsStyle.push(record);
    });
    atoms=combineRecordAtoms(visibleRecords);
    model=models.length?models[0].model:null;
    refreshAtomMaps(visibleRecords);
    if(!model){
      currentStructureKey='';
      resetAtomLevelCache();
      clearInteractionShapes();
      updateInteractionAggregate([]);
      updateInteractionSummary(0);
      if(wideLineLayer)wideLineLayer.clear();
      buildEntriesList();
      flushPanelRefresh();
      presentViewer(null,false);
      setStatus('No entries displayed');
      return null;
    }
    currentStructureKey=displayedStructureKey(visible);
    setupAtomEvents();
    resetAtomLevelCache();
    _catSer=null;
    if(needsStyle.length){
      _catSer=categorySerials();
      needsStyle.forEach(restyleEntryRecord);
      applyRuleOverlays();
      applyVisibility();
    }else{
      displayedCount=atoms.filter(isAtomVisibleNow).length;
    }
    redrawWideLineStyles();
    if(state.selectionSel){
      selectionAtoms=selectedAtomsForSelector(state.selectionSel);
      applySelectionHighlight(selectionAtoms);
      updateSelectionStatus(selectionInfo(state.selectionSel,selectionAtoms));
    }
    clearInteractionShapes();
    const needsFullRender=recordsNeedSceneRender(visibleRecords);
    if(opts.preserveView&&view)restoreViewNoRender(view);
    else if(opts.zoom!==false) fitVisible({render:false});
    presentViewer(visibleRecords,needsFullRender);
    buildEntriesList();
    showHover(null);
    schedulePanelRefresh(40);
    if(visible.length){
      setStatus(visible.length===1?(visible[0].title||visible[0].name)+' \u00b7 '+atoms.length.toLocaleString()+' atoms':visible.length+' entries displayed');
      if(readyInteractionSlots(visible).length)redrawInteractions(true);
      else{
        updateInteractionAggregate(visible);
        updateInteractionSummary(0);
      }
      scheduleInteractionIndexBuild(120);
    }else{
      updateInteractionAggregate(visible);
      updateInteractionSummary(0);
      setStatus('No entries displayed');
    }
    return visible;
  }
  function setEntryIncluded(entry,on){
    entryChecked[entry.name]=!!on;
    refreshDisplayedEntriesFast({preserveView:true,zoom:false});
    saveViewerSessionState();
  }
  function entryNeedsBusy(entry){
    const record=entryModelCache.get(entry&&entry.name);
    return !!((record&&record.atoms&&record.atoms.length>=HUGE_FIT_ATOM_LIMIT)||String(entry&&entry.data||'').length>=5*1024*1024);
  }
  function setEntryIncludedWithBusy(entry,on){
    const label=(on?'Showing ':'Hiding ')+(entry&&entry.title||entry&&entry.name||'entry')+'...';
    if(entryNeedsBusy(entry))return withBusy(label,()=>setEntryIncluded(entry,on)).catch(err=>setStatus('Entry update failed: '+(err&&err.message||err)));
    return setEntryIncluded(entry,on);
  }
  function deleteEntry(entry){
    const idx=entries.findIndex(e=>e.name===entry.name);
    if(idx<0)return null;
    entries.splice(idx,1);
    delete entryChecked[entry.name];
    disposeEntryRecord(entry.name);
    resetSelectionState();
    rebuildDisplayedEntries({preserveView:true,zoom:false});
    deleteViewerSessionEntry(entry.name,{status:false}).then(ok=>{
      if(!ok)saveViewerSession().then(saved=>{ if(!saved)setStatus('Deleted locally but not saved on server: '+entry.title); });
    });
    setStatus('Deleted entry: '+entry.title);
    return entry;
  }
  function entryByIdentifier(value){
    if(value&&typeof value==='object')value=value.name||value.title||value.pdbId||value.entry||'';
    const key=normText(value);
    return entries.find(e=>e.name===key||e.title===key||e.pdbId===key)||null;
  }
  function refreshEntryTitleReferences(entry){
    const record=entryModelCache.get(entry&&entry.name);
    if(record){
      record.entry=entry;
      (record.atoms||[]).forEach(a=>{ a._entryTitle=entry.title; });
      record.hierarchy=buildEntryHierarchyCache(entry,record.atoms||[]);
    }
    interactionIndexByKey.forEach(rec=>{
      if(rec&&rec.entryName===entry.name)rec.entryTitle=entry.title;
    });
  }
  async function renameEntry(value,title,opts){
    opts=opts||{};
    const entry=entryByIdentifier(value);
    if(!entry)throw new Error('Entry not found: '+normText(value||''));
    const nextTitle=normText(title);
    if(!nextTitle)throw new Error('Entry title cannot be empty.');
    if(entry.title===nextTitle)return {name:entry.name,title:entry.title,pdbId:entry.pdbId,fmt:entry.fmt};
    entry.title=nextTitle;
    refreshEntryTitleReferences(entry);
    buildEntriesList();
    buildHierarchy();
    updateInteractionAggregate();
    updateStatusBar();
    if(opts.persist!==false){
      const saved=await saveViewerSessionEntryTitle(entry.name,nextTitle,{status:false});
      if(!saved)setStatus('Renamed locally but not saved on server: '+nextTitle);
      else setStatus('Renamed entry: '+nextTitle);
    }else{
      setStatus('Renamed entry: '+nextTitle);
    }
    return {name:entry.name,title:entry.title,pdbId:entry.pdbId,fmt:entry.fmt};
  }
  function removeEntry(value){
    const entry=entryByIdentifier(value);
    if(!entry)throw new Error('Entry not found: '+normText(value||''));
    const removed=deleteEntry(entry);
    return removed?{name:removed.name,title:removed.title,pdbId:removed.pdbId,fmt:removed.fmt}:null;
  }
  function loadEntry(e,opts){
    opts=opts||{};
    e=normalizeStructureEntry(e);
    if(!e)throw new Error('Invalid structure data');
    if(!viewer)initViewer();
    ensureEntryModel(e);
    const hadOverrides=displayStateHasOverrides();
    const existingEntry=entries.findIndex(x=>x.name===e.name);
    if(existingEntry>=0)entries[existingEntry]=e; else entries.push(e);
    entryChecked[e.name]=true;
    resetDisplayRulesForStructure();
    if(existingEntry>=0||hadOverrides)rebuildDisplayedEntries({zoom:true});
    else refreshDisplayedEntriesFast({zoom:true});
    if(opts.persist!==false)saveViewerSessionEntryDeferred(e,{status:false}).then(ok=>{ if(!ok)setStatus('Loaded but not saved on server: '+e.title); });
    return e;
  }
  function inferFormat(n){ n=normText(n).toLowerCase(); if(n.endsWith('.maegz')||n.endsWith('.mae.gz'))return 'maegz'; if(n.endsWith('.mae'))return 'mae'; if(n.endsWith('.sdf')||n.endsWith('.mol'))return 'sdf'; if(n.endsWith('.mol2'))return 'mol2'; if(n.endsWith('.xyz'))return 'xyz'; if(n.endsWith('.cif')||n.endsWith('.mmcif'))return 'cif'; return 'pdb'; }
  function hasLineMatch(text,pattern){ return pattern.test(String(text||'')); }
  function validateStructureCoordinates(entry){
    const fmt=normText(entry&&entry.fmt||'').toLowerCase();
    const data=String(entry&&entry.data||'');
    if(fmt==='cif'||fmt==='mmcif'){
      if(!hasLineMatch(data,/^_atom_site\./m)){
        if(hasLineMatch(data,/^_(refln|reflns|diffrn|diffrn_reflns)\./m)){
          throw new Error(entry.name+' appears to be a structure-factor/reflection CIF, not a coordinate mmCIF.');
        }
        throw new Error(entry.name+' has no _atom_site coordinate table.');
      }
      if(!hasLineMatch(data,/^_atom_site\.Cartn_x\b/m)||!hasLineMatch(data,/^_atom_site\.Cartn_y\b/m)||!hasLineMatch(data,/^_atom_site\.Cartn_z\b/m)){
        throw new Error(entry.name+' has no Cartesian coordinate columns.');
      }
    }
  }
  async function loadLocalStructureFiles(files){
    const list=Array.from(files||[]);
    const loaded=[],failed=[];
    suppressSessionPollUntil=Math.max(suppressSessionPollUntil,Date.now()+60000);
    for(const f of list){
      try{
        const fmt=inferFormat(f.name);
        let e2;
        if(isMaestroFormat(fmt))e2=entryWithFreshIdentity(await convertStructureBuffer(await f.arrayBuffer(),fmt,f.name,f.name,''),f.name);
        else e2=entryWithFreshIdentity({name:f.name,title:f.name,pdbId:'',data:await f.text(),fmt},f.name);
        await persistAndLoadEntry(e2);
        loaded.push(f.name);
      }catch(err){
        failed.push({name:f.name,message:(err&&err.message)||String(err)});
      }
    }
    const countText=loaded.length+'/'+list.length+' file'+(list.length===1?'':'s');
    suppressSessionPollUntil=Math.max(suppressSessionPollUntil,Date.now()+5000);
    if(failed.length){
      const failedText=failed.map(item=>item.name+': '+item.message).join('; ');
      if(!loaded.length)throw new Error(failedText);
      setStatus('Loaded '+countText+'. Failed: '+failedText);
      return {loaded,failed};
    }
    setStatus('Loaded '+countText+'.');
    return {loaded,failed};
  }
  async function loadInitialStructure(){
    const saved=(await loadViewerSession()) || (await loadLastStructure());
    if(saved){
      try{ restoreViewerSession(saved); return; }catch(err){}
    }
    restoreEmptyViewerSession();
    setStatus('Open a structure file to begin.');
    return null;
  }

  const CLIP_MIN=-200, CLIP_MAX=200, CLIP_GAP=2;
  const clip={near:-100, far:100};
  function clipPct(v){ return (v-CLIP_MIN)/(CLIP_MAX-CLIP_MIN)*100; }
  function renderClipUI(){
    const nh=$('clipNearH'),fh=$('clipFarH'),rg=$('clipRange'),val=$('clipVal'),cap=document.querySelector('#clipControl .clip-cap'),ctrl=$('clipControl');
    if(!nh||!fh)return;
    const np=clipPct(clip.near),fp=clipPct(clip.far);
    const active=clip.near!==-100||clip.far!==100;
    nh.style.left=np+'%'; fh.style.left=fp+'%';
    if(rg){ rg.style.left=np+'%'; rg.style.width=Math.max(0,fp-np)+'%'; }
    if(val)val.textContent=Math.round(clip.near)+' / '+Math.round(clip.far);
    if(cap)cap.textContent='Clip';
    if(ctrl)ctrl.classList.toggle('is-active',active);
  }
  function applyClip(){
    renderClipUI();
    if(!viewer)return;
    const near=clip.near,far=clip.far;
    try{ if(viewer.setSlab)viewer.setSlab(near,far); else { if(viewer.setSlabNear)viewer.setSlabNear(near); if(viewer.setSlabFar)viewer.setSlabFar(far); } viewer.render(); }catch(e){}
  }
  function setClipValue(which,v){
    v=Math.max(CLIP_MIN,Math.min(CLIP_MAX,v));
    if(which==='near')clip.near=Math.min(v,clip.far-CLIP_GAP);
    else clip.far=Math.max(v,clip.near+CLIP_GAP);
    applyClip();
  }
  function clipValueFromEvent(ev){
    const bar=$('clipBar'); if(!bar)return null;
    const r=bar.getBoundingClientRect(); if(!r.width)return null;
    const pct=Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width));
    return CLIP_MIN+pct*(CLIP_MAX-CLIP_MIN);
  }
  function bindClipHandle(id,which){
    const h=$(id); if(!h)return;
    h.addEventListener('pointerdown',function(e){
      e.preventDefault(); e.stopPropagation();
      try{ h.setPointerCapture(e.pointerId); }catch(_){}
      function move(ev){ const v=clipValueFromEvent(ev); if(v!=null)setClipValue(which,v); }
      function up(){ try{ h.releasePointerCapture(e.pointerId); }catch(_){} window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); }
      window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
    });
  }
  function bindClipControl(){
    bindClipHandle('clipNearH','near'); bindClipHandle('clipFarH','far');
    const bar=$('clipBar');
    if(bar)bar.addEventListener('pointerdown',function(e){
      if(e.target&&e.target.classList&&e.target.classList.contains('clip-handle'))return;
      const v=clipValueFromEvent(e); if(v==null)return;
      const which=Math.abs(v-clip.near)<=Math.abs(v-clip.far)?'near':'far';
      setClipValue(which,v);
    });
    renderClipUI();
  }

  // ---------- Mouse (ported) ----------
  function stopMouseEvent(e){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  function eventPagePoint(e){ if(e.pageX!=null&&e.pageY!=null)return {x:e.pageX,y:e.pageY}; if(e.clientX!=null)return {x:e.clientX+window.pageXOffset,y:e.clientY+window.pageYOffset}; return null; }
  function pointInsideViewer(p){ const r=viewerEl.getBoundingClientRect(),x=p.x-window.pageXOffset,y=p.y-window.pageYOffset; return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom; }
  function viewerPageBounds(){ const r=viewerEl.getBoundingClientRect(); return {left:r.left+window.pageXOffset,right:r.right+window.pageXOffset,top:r.top+window.pageYOffset,bottom:r.bottom+window.pageYOffset}; }
  function normalizedPageRect(a,b){ const bd=viewerPageBounds(); return {left:Math.max(bd.left,Math.min(a.x,b.x)),right:Math.min(bd.right,Math.max(a.x,b.x)),top:Math.max(bd.top,Math.min(a.y,b.y)),bottom:Math.min(bd.bottom,Math.max(a.y,b.y))}; }
  function updateDragSelectBox(a,b){ const r=normalizedPageRect(a,b),bd=viewerPageBounds(); dragSelectBoxEl.style.left=(r.left-bd.left)+'px'; dragSelectBoxEl.style.top=(r.top-bd.top)+'px'; dragSelectBoxEl.style.width=Math.max(0,r.right-r.left)+'px'; dragSelectBoxEl.style.height=Math.max(0,r.bottom-r.top)+'px'; dragSelectBoxEl.style.display='block'; }
  function hideDragSelectBox(){ dragSelectBoxEl.style.display='none'; }
  function atomResidueKey(a){ return (a._entryName||'')+'\u0001'+(a.chain||'')+'\u0001'+(a.resi==null?'':a.resi)+'\u0001'+(a.resn||''); }
  function serialSelectorForAtoms(list){ const ser=[],seen=new Set(); for(const a of list){ if(a.serial==null||seen.has(a.serial))continue; seen.add(a.serial); ser.push(a.serial); } return ser.length?{serial:ser}:null; }
  function serialTextSet(list){ const out=new Set(); (list||[]).forEach(a=>{ if(a&&a.serial!=null)out.add(String(a.serial)); }); return out; }
  function removeSerialsFromDirectRules(rules,serials){
    return (rules||[]).filter(rule=>{
      const sel=rule&&rule.selector;
      if(!sel||typeof sel!=='object'||Array.isArray(sel)||!Object.prototype.hasOwnProperty.call(sel,'serial'))return true;
      const raw=Array.isArray(sel.serial)?sel.serial:[sel.serial], kept=raw.filter(s=>!serials.has(String(s)));
      if(!kept.length)return false;
      rule.selector=Object.assign({},sel,{serial:kept});
      return true;
    });
  }
  function atomLevelStyleSpecForAtoms(rep,opts,selected){
    const spec=styleSpec(rep,opts);
    const protein=[],other=[];
    selected.forEach(a=>{
      if(a.serial==null)return;
      if(isProtein(a))protein.push(a.serial);
      else other.push(a.serial);
    });
    if(protein.length)viewer.setStyle({serial:protein},mergeStyleSpecs(proteinBackboneStyleSpec(),spec));
    if(other.length)viewer.setStyle({serial:other},spec);
  }
  function atomLevelHideStyleForAtoms(selected){
    const protein=[],other=[];
    selected.forEach(a=>{
      if(a.serial==null)return;
      if(isProtein(a))protein.push(a.serial);
      else other.push(a.serial);
    });
    if(protein.length)viewer.setStyle({serial:protein},proteinBackboneStyleSpec());
    if(other.length)viewer.setStyle({serial:other},{});
  }
  function selectedAtomsForRule(rule){ const opts=rule&&rule.options||{}; return filterAtoms(styleSelection(rule&&rule.selector,opts)); }
  function applyAtomLevelStyleRule(rule){
    const rep=normText(rule.representation).toLowerCase();
    if(!ATOM_REPS.has(rep))return;
    const selected=selectedAtomsForRule(rule).filter(isAtomVisibleNow);
    if(selected.length)atomLevelStyleSpecForAtoms(rep,rule.options||{},selected);
  }
  function applyAtomLevelHideRule(rule){
    const selected=selectedAtomsForRule(rule);
    if(selected.length)atomLevelHideStyleForAtoms(selected);
  }
  function currentSelectionToolbarAtoms(){
    const selected=state.selectionSel?selectedAtomsForSelector(state.selectionSel):[];
    if(!selected.length)setStatus('No selected atoms');
    return selected;
  }
  function showSelectionToolbarAtoms(selected){
    const serials=serialTextSet(selected);
    state.hiddenRules=removeSerialsFromDirectRules(state.hiddenRules,serials);
  }
  function ensureSelectionToolbarDefaultLine(selected){
    const targets=(selected||[]).filter(a=>isAtomVisibleNow(a)&&!isAtomLevelShown(a)), sel=serialSelectorForAtoms(targets);
    if(!sel)return 0;
    state.styleRules=removeSerialsFromDirectRules(state.styleRules,serialTextSet(targets));
    state.styleRules.push({selector:sel,representation:'line',options:{source:'selection-toolbar',atomLevel:true,defaultVisible:true}});
    return targets.length;
  }
  function hideSelectionToolbarAtoms(){
    const selected=currentSelectionToolbarAtoms(), sel=serialSelectorForAtoms(selected);
    if(!sel)return;
    const serials=serialTextSet(selected);
    state.hiddenRules=removeSerialsFromDirectRules(state.hiddenRules,serials);
    state.hiddenRules.push({selector:sel,representation:'hide',options:{source:'selection-toolbar',atomLevel:true}});
    applyStylesFull(true);
    setStatus('Hidden selected atoms: '+selected.length.toLocaleString());
  }
  function showSelectionToolbarAction(){
    const selected=currentSelectionToolbarAtoms();
    if(!selected.length)return;
    showSelectionToolbarAtoms(selected);
    const defaulted=ensureSelectionToolbarDefaultLine(selected);
    applyStylesFull(true);
    setStatus('Shown selected atoms: '+selected.length.toLocaleString()+(defaulted?' (default line: '+defaulted.toLocaleString()+')':''));
  }
  function showSelectionToolbarHeavyOnly(){
    const selected=currentSelectionToolbarAtoms();
    if(!selected.length)return;
    showSelectionToolbarAtoms(selected);
    const hiddenHydrogens=selected.filter(a=>isHydrogenAtom(a)&&!isPolarHydrogen(a)), visibleAtoms=selected.filter(a=>!isHydrogenAtom(a)||isPolarHydrogen(a)), hsel=serialSelectorForAtoms(hiddenHydrogens);
    if(hsel)state.hiddenRules.push({selector:hsel,representation:'hide',options:{source:'selection-toolbar',atomLevel:true}});
    ensureSelectionToolbarDefaultLine(visibleAtoms);
    applyStylesFull(true);
    setStatus('Selected heavy atoms + polar H visible: '+visibleAtoms.length.toLocaleString()+' / '+selected.length.toLocaleString());
  }
  function setSelectionToolbarRepresentation(rep){
    const selected=currentSelectionToolbarAtoms(), sel=serialSelectorForAtoms(selected);
    if(!sel)return;
    const serials=serialTextSet(selected);
    state.hiddenRules=removeSerialsFromDirectRules(state.hiddenRules,serials);
    state.styleRules=removeSerialsFromDirectRules(state.styleRules,serials);
    state.styleRules.push({selector:sel,representation:rep,options:{source:'selection-toolbar',atomLevel:true}});
    applyStylesFull(true);
    setStatus('Selected atoms set to '+rep+': '+selected.length.toLocaleString());
  }
  function runSelectionToolbarAction(action){
    action=normText(action).toLowerCase();
    if(action==='hide')return hideSelectionToolbarAtoms();
    if(action==='show')return showSelectionToolbarAction();
    if(action==='heavy')return showSelectionToolbarHeavyOnly();
    if(ATOM_REPS.has(action))return setSelectionToolbarRepresentation(action);
  }
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
  function selectorFromDragHits(hits){
    if(!hits.length)return null;
    if(state.selectionMode==='model'){
      const entriesHit=new Set(hits.map(a=>a._entryName||''));
      return serialSelectorForAtoms(atoms.filter(a=>entriesHit.has(a._entryName||'')));
    }
    if(state.selectionMode==='atom')return serialSelectorForAtoms(hits);
    if(state.selectionMode==='chain'){
      const ch=new Set(hits.map(a=>(a._entryName||'')+'\u0001'+(a.chain||'')));
      return serialSelectorForAtoms(atoms.filter(a=>ch.has((a._entryName||'')+'\u0001'+(a.chain||''))));
    }
    const res=new Set(hits.map(atomResidueKey));
    return serialSelectorForAtoms(atoms.filter(a=>res.has(atomResidueKey(a))));
  }
  function selectDragRange(start,end,e){ const rect=normalizedPageRect(start,end),hits=atomsInPageRect(rect),sel=selectorFromDragHits(hits); if(!sel){ clearSelection(); return; } setSelection(sel,{additive:e&&e.shiftKey}); }
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
    function beginDrag(e){ if(overUiPanel(e))return; const b=mouseButtonKey(e); if(!b)return; focusViewerKeyboardTarget(); if(!isCustomMousePreset())return; const action=settings.mouse.buttons[b]||'none'; stopMouseEvent(e); if(state.locked||!viewer)return; const p=eventPagePoint(e); if(!p)return; drag.mode=action;drag.button=b;drag.startX=p.x;drag.startY=p.y;drag.moved=false; drag.startQuaternion=viewer.rotationGroup&&viewer.rotationGroup.quaternion?viewer.rotationGroup.quaternion.clone():null; drag.startModelPos=viewer.modelGroup&&viewer.modelGroup.position?viewer.modelGroup.position.clone():null; drag.startZoom=viewer.rotationGroup&&viewer.rotationGroup.position?viewer.rotationGroup.position.z:0; hideDragSelectBox(); }
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
  function overUiPanel(e){ const t=e&&e.target; return !!(t&&t.closest&&t.closest('#interPanel,#settingsOverlay')); }
  function bindWheelZoom(){ viewerEl.addEventListener('wheel',function(e){ if(overUiPanel(e))return; if(!viewer||state.locked)return; if(!isCustomMousePreset())return; if(settings.mouse.wheel!=='zoom')return; stopMouseEvent(e); const delta=e.deltaY||-e.wheelDelta||1,amount=Math.max(1,Math.min(4,Math.abs(delta)/100)),step=Math.pow(1.12,amount); viewer.zoom(delta<0?step:1/step); },{capture:true,passive:false}); }

  function startFpsOverlay(){
    const fpsEl=$('fpsOverlay'); let frames=0,last=performance.now(),running=false;
    function tick(){ if(document.hidden){ running=false; return; } frames++; requestAnimationFrame(tick); }
    function start(){ if(running||document.hidden)return; running=true; requestAnimationFrame(tick); }
    function update(){ if(document.hidden){ fpsEl.textContent='FPS --'; frames=0; last=performance.now(); return; } const now=performance.now(),el=now-last; fpsEl.textContent='FPS '+Math.round(frames*1000/el); frames=0; last=now; start(); }
    document.addEventListener('visibilitychange',function(){ frames=0; last=performance.now(); if(!document.hidden)start(); });
    setInterval(update,500); start();
  }

  function initViewer(){
    focusViewerKeyboardTarget();
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

  // ---------- Settings ----------
  function toHex(col){ if(/^#[0-9a-f]{6}$/i.test(col))return col; try{ const cx=document.createElement('canvas').getContext('2d'); cx.fillStyle=col; if(/^#[0-9a-f]{6}$/i.test(cx.fillStyle))return cx.fillStyle; }catch(e){} return '#888888'; }
  function setBackground(c,opts){
    opts=opts||{};
    state.bgColor=toHex(c);
    if(viewer&&viewer.setBackgroundColor){ viewer.setBackgroundColor(state.bgColor); viewer.render(); }
    if($('bgCustom'))$('bgCustom').value=state.bgColor;
    document.querySelectorAll('#bgSwatches [data-bg]').forEach(b=>{ b.style.borderColor=(b.getAttribute('data-bg').toLowerCase()===state.bgColor.toLowerCase())?'#3a7bd5':'#777'; });
    if(opts.persist!==false)savePreferences();
  }
  function normalizeEditableColor(color){
    const value=normText(color);
    if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Color must be a #RRGGBB value.');
    return value.toLowerCase();
  }
  function colorTextForBackground(color){
    const hex=toHex(color).slice(1);
    const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
    return (0.299*r+0.587*g+0.114*b)>150?'#1a1a1a':'#fff';
  }
  function updateColorInputTile(input,color){
    if(!input)return;
    const hex=normalizeEditableColor(color);
    input.value=hex;
    const tile=input.closest('.color-tile');
    if(tile){
      tile.style.background=hex;
      tile.title=(input.dataset.chain?'Chain '+input.dataset.chain:input.dataset.atom)+' '+hex;
      const label=tile.querySelector('.color-tile-label');
      if(label)label.style.color=colorTextForBackground(hex);
    }
  }
  function makeColorTile(kind,key,color,onChange){
    const lab=document.createElement('label');
    lab.className='color-tile';
    const inp=document.createElement('input');
    inp.type='color';
    if(kind==='chain')inp.dataset.chain=key;
    else inp.dataset.atom=key;
    inp.oninput=function(){ onChange(inp.value); };
    const sp=document.createElement('span');
    sp.className='color-tile-label';
    sp.textContent=kind==='atom'?elementDisplayLabel(key):key;
    lab.appendChild(inp);
    lab.appendChild(sp);
    updateColorInputTile(inp,color);
    return lab;
  }
  function elementDisplayLabel(element){
    const key=normText(element).toUpperCase();
    return key.length>1?key[0]+key.slice(1).toLowerCase():key;
  }
  function setChainColor(chain,color,opts){
    const key=normText(chain).toUpperCase();
    if(!/^[A-Z]$/.test(key))throw new Error('Chain color key must be A-Z.');
    chainColors[key]=normalizeEditableColor(color);
    const input=document.querySelector('#chainColorList input[data-chain="'+key+'"]');
    updateColorInputTile(input,chainColors[key]);
    applyStylesFull(true); buildHierarchy();
    if(!opts||opts.persist!==false)savePreferences();
    return chainColors[key];
  }
  function isEditableElementKey(key){ return Object.prototype.hasOwnProperty.call(defaultElementColors,key); }
  function setAtomColor(element,color,opts){
    const key=normText(element).toUpperCase();
    if(!isEditableElementKey(key))throw new Error('Unsupported atom color key: '+key);
    elemColors[key]=normalizeEditableColor(color);
    const input=document.querySelector('#atomColorList input[data-atom="'+key+'"]');
    updateColorInputTile(input,elemColors[key]);
    applyStylesFull(true); buildHierarchy();
    if(!opts||opts.persist!==false)savePreferences();
    return elemColors[key];
  }
  function resetChainColors(opts){
    Object.keys(chainColors).forEach(k=>delete chainColors[k]);
    Object.assign(chainColors,defaultChainColors);
    applyStylesFull(true); buildHierarchy(); buildChainColorList();
    if(!opts||opts.persist!==false)savePreferencesNow();
  }
  function resetAtomColors(opts){
    Object.keys(elemColors).forEach(k=>delete elemColors[k]);
    Object.assign(elemColors,defaultElementColors);
    applyStylesFull(true); buildHierarchy(); buildAtomColorList();
    if(!opts||opts.persist!==false)savePreferencesNow();
  }
  function resetColorSchemes(opts){
    Object.keys(chainColors).forEach(k=>delete chainColors[k]);
    Object.assign(chainColors,defaultChainColors);
    Object.keys(elemColors).forEach(k=>delete elemColors[k]);
    Object.assign(elemColors,defaultElementColors);
    applyStylesFull(true); buildHierarchy(); buildChainColorList(); buildAtomColorList();
    if(!opts||opts.persist!==false)savePreferencesNow();
  }
  function buildChainColorList(){
    const wrap=$('chainColorList'); if(!wrap)return; wrap.innerHTML='';
    const chains='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    chains.forEach(c=>{ wrap.appendChild(makeColorTile('chain',c,toHex(chainColor(c)),function(value){ setChainColor(c,value,{persist:true}); })); });
  }
  function buildAtomColorList(){
    const wrap=$('atomColorList'); if(!wrap)return; wrap.innerHTML='';
    elementColorKeys.forEach(k=>{ wrap.appendChild(makeColorTile('atom',k,toHex(elemColors[k]),function(value){ setAtomColor(k,value,{persist:true}); })); });
  }
  // Each of the 3 buttons holds exactly one action; checking a cell that is taken by another
  // button swaps them, so no action is ever assigned to two buttons. (Wheel is fixed to zoom.)
  const MOUSE_ACTIONS=[['rotate','Rotate'],['pan','Pan'],['zoom','Zoom'],['select','Select']];
  const MOUSE_BTNS=[['left','Left'],['right','Right'],['middle','Middle']];
  const MOUSE_ACTION_VALUES=new Set(MOUSE_ACTIONS.map(a=>a[0]).concat(['none']));
  const WHEEL_ACTION_VALUES=new Set(['zoom','none']);
  function setMouseAction(btn,action){
    const cur=settings.mouse.buttons; if(cur[btn]===action){ buildMouseMatrix(); return; }
    const prev=cur[btn];
    ['left','right','middle'].forEach(b=>{ if(b!==btn&&cur[b]===action)cur[b]=prev; });
    cur[btn]=action; state.mousePreset='custom'; resetMouseDrag(); buildMouseMatrix();
    savePreferencesNow();
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
        const box=document.createElement('input');
        box.type='checkbox';
        box.checked=on;
        box.setAttribute('aria-label',b[1]+' '+a[1]);
        box.style.cssText='width:18px;height:18px;accent-color:#2f86d6;cursor:pointer';
        box.onclick=function(e){ e.preventDefault(); e.stopPropagation(); setMouseAction(b[0],a[0]); };
        cell.appendChild(box); cell.onclick=function(){ setMouseAction(b[0],a[0]); };
        grid.appendChild(cell);
      });
    });
    wrap.appendChild(grid);
  }
  function openSettings(){
    buildMouseMatrix();
    $('setCarbonByChain').checked=state.carbonByChain;
    setBackground(state.bgColor,{persist:false}); buildChainColorList(); buildAtomColorList();
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
  function setMousePreset(preset,opts){
    opts=opts||{};
    const next=preset==='default'?'default':(preset==='custom'?'custom':'select-left');
    state.mousePreset=next;
    if(next==='select-left'){ settings.mouse.buttons=Object.assign({},mousePresets['select-left'].buttons); settings.mouse.wheel=mousePresets['select-left'].wheel; }
    resetMouseDrag();
    buildMouseMatrix();
    if(opts.persist!==false)savePreferencesNow();
    if(opts.status!==false)setStatus('Mouse preset: '+next);
    setupAtomEvents();
    if(viewer&&model&&recordsNeedSceneRender(visibleEntryRecords()))presentViewer(visibleEntryRecords(),true);
    return next;
  }
  function setMouseActions(actions,opts){
    opts=opts||{};
    if(!actions||typeof actions!=='object'||Array.isArray(actions))throw new Error('Mouse actions must be an object.');
    const next=actions, buttons=next.buttons||next, nextButtons=Object.assign({},settings.mouse.buttons);
    ['left','right','middle'].forEach(btn=>{
      if(buttons[btn]==null)return;
      const action=normText(buttons[btn]).toLowerCase();
      if(!MOUSE_ACTION_VALUES.has(action))throw new Error('Unsupported mouse action for '+btn+': '+action);
      nextButtons[btn]=action;
    });
    const used=new Set();
    ['left','right','middle'].forEach(btn=>{
      const action=nextButtons[btn];
      if(action==='none')return;
      if(used.has(action))throw new Error('Mouse button actions must be distinct: '+action);
      used.add(action);
    });
    const wheelValue=next.wheel!=null?next.wheel:next.wheelAction;
    let nextWheel=settings.mouse.wheel;
    if(wheelValue!=null){
      nextWheel=normText(wheelValue).toLowerCase();
      if(!WHEEL_ACTION_VALUES.has(nextWheel))throw new Error('Unsupported wheel action: '+nextWheel);
    }
    settings.mouse.buttons=nextButtons;
    settings.mouse.wheel=nextWheel;
    state.mousePreset=opts.preset==='select-left'?'select-left':'custom';
    resetMouseDrag();
    buildMouseMatrix();
    if(opts.persist!==false)savePreferencesNow();
    if(opts.status!==false)setStatus('Mouse: L '+settings.mouse.buttons.left+' / R '+settings.mouse.buttons.right+' / M '+settings.mouse.buttons.middle+' / W '+settings.mouse.wheel);
    setupAtomEvents();
    if(viewer&&model&&recordsNeedSceneRender(visibleEntryRecords()))presentViewer(visibleEntryRecords(),true);
    return cloneMouseSettings();
  }
  function clearStyles(){ state.styleRules=[]; state.hiddenRules=[]; applyStylesFull(true); }
  function setProteinBackboneStyle(representation,opts){
    opts=opts||{};
    let rep=normText(representation||'cartoon').toLowerCase();
    if(rep==='hide')rep='off';
    state.baseProtein=(rep==='tube'||rep==='off')?rep:'cartoon';
    if($('repBackbone'))$('repBackbone').value=state.baseProtein;
    applyStylesFull(true);
    if(opts.persist!==false)savePreferencesNow();
    return state.baseProtein;
  }
  function setProteinAtomStyle(representation,opts){
    opts=opts||{};
    let rep=normText(representation||'off').toLowerCase();
    if(rep==='hide')rep='off';
    state.proteinAtoms=ATOM_REPS.has(rep)?rep:'off';
    if($('repProtein'))$('repProtein').value=state.proteinAtoms;
    applyStylesFull(true);
    if(opts.persist!==false)savePreferencesNow();
    return state.proteinAtoms;
  }
  function setBaseStyle(representation,opts){
    const rep=normText(representation||'cartoon').toLowerCase();
    if(ATOM_REPS.has(rep))return setProteinAtomStyle(rep,opts);
    return setProteinBackboneStyle(rep,opts);
  }
  function setLigandStyle(representation,opts){ opts=opts||{}; let rep=normText(representation||'stick').toLowerCase(); if(rep==='hide')rep='off'; state.ligand=(rep==='off'||ATOM_REPS.has(rep))?rep:'stick'; if($('repLigand'))$('repLigand').value=state.ligand; applyStylesFull(true); if(opts.persist!==false)savePreferencesNow(); return state.ligand; }
  function setSolventStyle(representation,opts){ opts=opts||{}; let rep=normText(representation||'off').toLowerCase(); if(rep==='hide')rep='off'; state.solvent=(rep==='off'||ATOM_REPS.has(rep))?rep:'off'; if($('repSolvent'))$('repSolvent').value=state.solvent; applyStylesFull(true); if(opts.persist!==false)savePreferencesNow(); return state.solvent; }
  function setOtherStyle(representation,opts){ opts=opts||{}; let rep=normText(representation||'stick').toLowerCase(); if(rep==='hide')rep='off'; state.other=(rep==='off'||ATOM_REPS.has(rep))?rep:'stick'; if($('repOther'))$('repOther').value=state.other; applyStylesFull(true); if(opts.persist!==false)savePreferencesNow(); return state.other; }
  function shouldBusyForStyleChange(rep){
    const r=normText(rep).toLowerCase();
    return atoms.length>=HUGE_FIT_ATOM_LIMIT||(r==='line'&&atoms.length>=20000);
  }
  function runStyleChange(label,rep,work,after){
    const doneLabel=label.replace(/^Applying /,'Applied ').replace(/\.\.\.$/,'');
    const run=function(){ const out=work(); if(after)after(); setStatus(doneLabel); return out; };
    if(shouldBusyForStyleChange(rep))return withBusy(label,run).catch(err=>setStatus('Style failed: '+(err&&err.message||err)));
    try{ return run(); }catch(err){ setStatus('Style failed: '+(err&&err.message||err)); }
  }
  function runCompat(command){
    if(!command||typeof command!=='object'||Array.isArray(command))throw new Error('String commands are disabled. Use structured molAgent API calls.');
    const type=normText(command.type||command.action).toLowerCase();
    if(type==='selection'||type==='setselection')return setSelection(command.selector||command.target||{},command.options||command);
    if(type==='clearselection')return clearSelection();
    if(type==='focus')return focus(command.selector||command.target||state.selectionSel);
    if(type==='style'){ state.styleRules.push({selector:command.selector||command.target||{},representation:command.representation||command.style||'cartoon',options:command.options||command}); applyStylesFull(true); return state.styleRules[state.styleRules.length-1]; }
    if(type==='hide'){ state.hiddenRules.push({selector:command.selector||command.target||{},representation:'hide',options:command.options||command}); applyStylesFull(true); return state.hiddenRules[state.hiddenRules.length-1]; }
    if(type==='renameentry'||type==='setentrytitle')return renameEntry(command.name||command.entry||command.target,command.title||command.newTitle||command.value,command.options||command);
    if(type==='removeentry'||type==='deleteentry')return removeEntry(command.name||command.entry||command.target);
    throw new Error('Unsupported run() command type: '+(type||'-'));
  }
  window.molAgent={
    setSelection, setSelectionHighlight, clearSelection, focus,
    style:function(selector,representation,options){ const rule={selector:selector||{},representation:representation||'cartoon',options:options||{}}; state.styleRules.push(rule); applyStylesFull(true); return rule; },
    clearStyle:clearStyles, clearStyles, setBaseStyle, setProteinBackboneStyle, setProteinAtomStyle, setLigandStyle, setSolventStyle, setOtherStyle,
    setChainColor, resetChainColors, getChainColors:function(){ return Object.assign({},chainColors); },
    setAtomColor, resetAtomColors, resetColorSchemes, getAtomColors:function(){ return Object.assign({},elemColors); },
    getPreferences:preferencesPayload, savePreferences:savePreferencesNow,
    setMousePreset, getMousePreset:function(){ return state.mousePreset; }, setMouseActions, getMouseActions:cloneMouseSettings,
    selectAtoms:function(selector){ return filterAtoms(selector).map(a=>Object.assign({},a)); },
    getState:function(){ return {entries:entries.map(e=>({name:e.name,title:e.title,included:entryChecked[e.name]!==false})),includedEntries:includedEntries().map(e=>e.name),atoms:atoms.length,proteinBackbone:state.baseProtein,proteinAtoms:state.proteinAtoms,ligand:state.ligand,solvent:state.solvent,other:state.other,mousePreset:state.mousePreset,mouseActions:cloneMouseSettings(),selection:cloneSelector(state.selectionSel),selectionHighlight:{representation:state.selectionRepresentation,options:cloneSelector(state.selectionOptions)},styleRules:cloneSelector(state.styleRules),hiddenRules:cloneSelector(state.hiddenRules)}; },
    getInteractionIndex:function(){ updateInteractionAggregate(); return clonePlain({status:interactionIndex.status,source:interactionIndex.source,structureKey:interactionIndex.structureKey||currentStructureKey,counts:interactionIndex.counts,readyEntries:interactionIndex.readyEntries||0,totalEntries:interactionIndex.totalEntries||0,error:interactionIndex.error,entries:visibleInteractionSlots().map(slot=>({name:slot.entry.name,title:slot.entry.title,status:slot.record&&slot.record.status||'missing',counts:slot.record&&slot.record.counts||{}}))}); },
    rebuildInteractionIndex:function(){ startInteractionIndexBuild(); return clonePlain({status:interactionIndex.status,counts:interactionIndex.counts}); },
    getVisualConfig:function(){ return clonePlain(visualConfig); },
    reloadVisualConfig:function(){ return loadVisualConfig().then(function(cfg){ applyStylesFull(true); return cfg; }); },
    loadUrl, removeEntry, renameEntry, setEntryTitle:renameEntry, run:runCompat, viewer:function(){ return viewer; }, model:function(){ return model; }, models:function(){ return models.map(x=>x.model); }
  };

  // ---------- Wire UI ----------
  $('selLevel').onchange=function(){ state.selectionMode=$('selLevel').value; setStatus('Selection level: '+state.selectionMode); };
  $('qsP').onclick=function(){ const prot=atoms.filter(isProtein),sel=serialSelectorForAtoms(prot); if(sel)setSelection(sel,{}); else setStatus('No protein'); };
  $('qsL').onclick=function(){ const lig=atoms.filter(isLigand); const sel=serialSelectorForAtoms(lig); if(sel)setSelection(sel,{}); else setStatus('No ligand'); };
  $('qsS').onclick=function(){ setSelection({resn:Array.from(waterNames)},{}); if(state.solvent==='off')setStatus('Solvents selected; solvent representation is off.'); };
  $('qsAll').onclick=function(){ setSelection({},{}); };
  $('interBtn').onclick=toggleInterPanel;
  $('interToggle').onclick=function(){ interState.enabled=!interState.enabled; updateInterToggle(); redrawInteractions(true); };
  $('interClose').onclick=closeInterPanel;
  document.querySelectorAll('[data-selection-action]').forEach(btn=>{
    btn.onclick=function(){ runSelectionToolbarAction(btn.getAttribute('data-selection-action')); };
  });
  $('repBackbone').onchange=function(){ const rep=$('repBackbone').value; runStyleChange('Applying backbone '+rep+'...',rep,function(){ return setProteinBackboneStyle(rep); }); };
  $('repProtein').onchange=function(){ const rep=$('repProtein').value; runStyleChange('Applying protein atoms '+rep+'...',rep,function(){ return setProteinAtomStyle(rep); }); };
  $('repLigand').onchange=function(){ const rep=$('repLigand').value; runStyleChange('Applying ligand '+rep+'...',rep,function(){ return setLigandStyle(rep); }); };
  $('repSolvent').onchange=function(){ const rep=$('repSolvent').value; runStyleChange('Applying solvent '+rep+'...',rep,function(){ return setSolventStyle(rep); },buildHierarchy); };
  $('repOther').onchange=function(){ const rep=$('repOther').value; runStyleChange('Applying other '+rep+'...',rep,function(){ return setOtherStyle(rep); },buildHierarchy); };
  bindClipControl();
  $('clipReset').onclick=function(){ clip.near=-100; clip.far=100; applyClip(); };
  $('settingsBtn').onclick=function(){ if($('settingsOverlay').style.display==='flex')closeSettings(); else openSettings(); };
  $('settingsClose').onclick=closeSettings;
  $('settingsDone').onclick=closeSettings;
  $('settingsOverlay').addEventListener('mousedown',function(e){ if(e.target===$('settingsOverlay'))closeSettings(); });
  $('setCarbonByChain').onchange=function(){ state.carbonByChain=$('setCarbonByChain').checked; applyStylesFull(true); savePreferencesNow(); };
  document.querySelectorAll('#bgSwatches [data-bg]').forEach(b=>{ b.onclick=function(){ setBackground(b.getAttribute('data-bg'),{persist:true}); }; });
  $('bgCustom').oninput=function(){ setBackground($('bgCustom').value,{persist:true}); };
  $('resetColorSchemes').onclick=function(){ resetColorSchemes(); };
  $('settingsReset').onclick=function(){ resetColorSchemes({persist:false}); state.baseProtein='cartoon'; state.proteinAtoms='off'; state.ligand='stick'; state.solvent='off'; state.other='stick'; if($('repBackbone'))$('repBackbone').value=state.baseProtein; if($('repProtein'))$('repProtein').value=state.proteinAtoms; if($('repLigand'))$('repLigand').value=state.ligand; if($('repSolvent'))$('repSolvent').value=state.solvent; if($('repOther'))$('repOther').value=state.other; state.carbonByChain=true; state.hbondCutoff=2.8; state.saltCutoff=5.0; resetInteractionSettings(); state.selectionRepresentation='line'; state.selectionOptions=defaultSelectionOptions(); settings.mouse.buttons=Object.assign({},mousePresets['select-left'].buttons); settings.mouse.wheel='zoom'; state.mousePreset='select-left'; resetMouseDrag(); setBackground('#000000',{persist:false}); applyStylesFull(true); buildHierarchy(); savePreferencesNow(); openSettings(); };
  $('saveView').onclick=function(){ if(viewer){ savedView=viewer.getView(); setStatus('View saved'); } };
  $('restoreView').onclick=function(){ if(viewer&&savedView){ viewer.setView(savedView); viewer.render(); setStatus('View restored'); } };
  $('lockView').onclick=function(){ state.locked=!state.locked; setBtnActive($('lockView'),state.locked); setStatus(state.locked?'View locked':'View unlocked'); };
  $('findGo').onclick=runFind;
  $('findType').onchange=updateFindPlaceholder;
  $('findInput').addEventListener('keydown',function(e){ if(e.key==='Enter'){ runFind(); e.preventDefault(); } });
  $('findClear').onclick=function(){ $('findInput').value=''; findMatches=[]; findIndex=-1; $('findCount').textContent='0 matches'; $('findSel').textContent=''; clearSelection(); };
  $('findPrev').onclick=function(){ stepFind(-1); };
  $('findNext').onclick=function(){ stepFind(1); };
  $('fileInput').onchange=async function(e){
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    try{
      const label=files.length===1?'Loading '+files[0].name+'...':'Loading '+files.length+' files...';
      await withBusy(label,function(){ return loadLocalStructureFiles(files); });
    }catch(err){ setStatus('Load failed: '+err.message); }
    e.target.value='';
  };

  window.addEventListener('keydown',function(e){
    const ae=document.activeElement;
    const tag=ae&&ae.tagName;
    if(isFocusHotkey(e)){
      if(ae&&ae.closest&&ae.closest('#findGo,#findPrev,#findNext,#findClear,#findType'))return;
      if(ae&&ae.id==='findInput')e.preventDefault();
      else if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      if(!e.repeat)toggleFocus();
      return;
    }
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
    if(e.key==='Escape'){ if($('settingsOverlay').style.display==='flex'){ closeSettings(); } else if(!$('interPanel').hidden){ closeInterPanel(); } else clearSelection(); }
  });

  $('interPanel').hidden=true;
  buildInterPanel();
  updateInterToggle();
  initViewer();
  startFpsOverlay();
  $('selLevel').value=state.selectionMode;
  updateFindPlaceholder();
  loadVisualConfig().then(function(){
    return loadPreferences();
  }).then(function(){
    return loadInitialStructure();
  }).then(function(){
    startSessionSync();
  }).catch(err=>setStatus('Load failed: '+err.message+'  (use Open file)'));
}
const waitFor3DmolStartedAt = Date.now();
function waitFor3Dmol(){
  if(window.$3Dmol){ boot(); return; }
  if(Date.now()-waitFor3DmolStartedAt>10000){
    const status=document.getElementById('status');
    if(status)status.textContent='3Dmol failed to load; check assets/3Dmol-min.js.';
    return;
  }
  setTimeout(waitFor3Dmol, 40);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitFor3Dmol);
else waitFor3Dmol();
})();
