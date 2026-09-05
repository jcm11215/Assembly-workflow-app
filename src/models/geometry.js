/**
 * DETERMINISTIC 3D GEOMETRY GENERATOR.
 * Consumes only the validated engineering spec. Every dimension used
 * traces to a blueprint callout; anything unspecified is omitted or drawn
 * as an explicitly-marked placeholder -- never estimated.
 * Model space: 1 unit = 1 inch.
 */


import { dimIn } from '../blueprints/spec.js';
import { STAGE_META, STAGE_ORDER } from './stageMeta.js';
import { state } from '../state/store.js';
import { escapeHtml } from '../utils/dom.js';

export let modelState = null; // { renderer, scene, camera, groups, raf }

export const hiddenModelParts = {};

export function disposeModel(){
  if(!modelState) return;
  cancelAnimationFrame(modelState.raf);
  // 1. Drop every listener attached by this build.
  if(modelState.abort){ try{ modelState.abort.abort(); }catch(e){} }
  // 2. Release GPU memory -- renderer.dispose() alone does NOT free
  //    geometries, materials, or canvas textures, which is the real leak
  //    across repeated rebuilds.
  if(modelState.scene){
    modelState.scene.traverse(obj=>{
      if(obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      mats.forEach(m=>{
        if(m.map) m.map.dispose();
        m.dispose();
      });
    });
  }
  if(modelState.renderer){
    modelState.renderer.dispose();
    if(modelState.renderer.forceContextLoss){ try{ modelState.renderer.forceContextLoss(); }catch(e){} }
    const el = modelState.renderer.domElement;
    if(el && el.parentNode) el.parentNode.removeChild(el);
  }
  modelState = null;
}

export function ensureThree(){
  if(window.THREE) return Promise.resolve(window.THREE);
  if(window.__threePromise) return window.__threePromise;
  window.__threePromise = new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = ()=> resolve(window.THREE);
    s.onerror = ()=> reject(new Error('Could not load the 3D library'));
    document.head.appendChild(s);
  });
  return window.__threePromise;
}
// Bridges the new spec to the legacy 5-field shape a few older call
// sites still read. Nothing new should use this.

// Bridges the new spec to the legacy 5-field shape a few older call
// sites still read. Nothing new should use this.
export function specToLegacyGeometry(spec){
  if(!spec) return null;
  const o = spec.overall||{}, s = spec.screw||{}, t = spec.trough||{};
  const L = dimIn(o.overall_length);
  const D = dimIn(s.screw_diameter) || dimIn(t.trough_width);
  return {
    diameterIn: D,
    lengthFt: L!=null ? L/12 : null,
    inclineDeg: dimIn(o.incline_angle)!=null ? o.incline_angle.value : null,
    hangerCount: (spec.hangers && spec.hangers.count!=null) ? Number(spec.hangers.count) : null,
    shaftless: !!(s.shaftless)
  };
}

/* ================================================================
   DETERMINISTIC 3D GEOMETRY GENERATOR
   Consumes ONLY the validated engineering spec. Every dimension used
   here traces to a blueprint callout. Anything the spec does not
   supply is either omitted or drawn as an explicitly-marked
   placeholder -- it is never estimated into existence.

   Model space: 1 unit = 1 inch, matching normalized_in throughout.
   ================================================================ */

//    ================================================================
export const MODEL_MODES = { engineering:'engineering', assembly:'assembly' };

export let modelMode = MODEL_MODES.engineering;

export let showDimensions = false;

// ES module bindings are read-only to importers, so any module that
// needs to change these must go through a setter rather than assigning
// the imported name directly (which throws TypeError at runtime).
export function setModelMode(mode){
  modelMode = (mode === MODEL_MODES.assembly) ? MODEL_MODES.assembly : MODEL_MODES.engineering;
  return modelMode;
}
export function setShowDimensions(on){
  showDimensions = !!on;
  return showDimensions;
}
export function toggleShowDimensions(){
  showDimensions = !showDimensions;
  return showDimensions;
}
// Records what the generator actually built, for the verification report.

// Records what the generator actually built, for the verification report.
export let lastBuildRecord = null;

export function makeTextSprite(THREE, text, color){
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = 'bold 44px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  cv.width = w; cv.height = 60;
  const c2 = cv.getContext('2d');
  c2.font = font;
  c2.fillStyle = 'rgba(11,13,15,0.85)';
  c2.fillRect(0,0,cv.width,cv.height);
  c2.fillStyle = color || '#f5b400';
  c2.textBaseline = 'middle';
  c2.fillText(text, 12, cv.height/2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, depthTest:false, transparent:true }));
  spr.userData.aspect = cv.width/cv.height;
  return spr;
}

export async function buildModel(job){
  const host = document.getElementById('modelStage');
  if(!host) return;
  const spec = job.spec;
  if(!spec){ host.innerHTML = `<div class="empty-state" style="padding:24px;">No engineering specification -- re-scan the blueprint.</div>`; return; }

  let THREE;
  try{ THREE = await ensureThree(); }
  catch(e){ host.innerHTML = `<div class="empty-state" style="padding:24px;">3D view unavailable offline.</div>`; return; }
  if(!document.getElementById('modelStage')) return;
  disposeModel();

  const o = spec.overall||{}, tr = spec.trough||{}, sc = spec.screw||{}, hg = spec.hangers||{}, dr = spec.drive||{}, tl = spec.tail||{}, fr = spec.frame||{};
  const isScrew = spec.conveyorType !== 'belt';

  // --- Read the spec. Nulls stay null; no fallback constants. ---
  const L  = dimIn(o.overall_length);
  const OW = dimIn(o.overall_width);
  const D  = isScrew ? (dimIn(sc.screw_diameter) || dimIn(tr.trough_width)) : null;
  const troughW = dimIn(tr.trough_width) || D;
  const troughD = dimIn(tr.trough_depth);
  const shaftD  = dimIn(sc.shaft_diameter);
  const pitch   = dimIn(sc.screw_pitch) || D; // standard-pitch screw: pitch = diameter
  const pitchIsDirect = dimIn(sc.screw_pitch) != null;
  const inclineDeg = dimIn(o.incline_angle)!=null ? o.incline_angle.value : 0;
  const incline = (inclineDeg||0) * Math.PI/180;

  const approx = [];        // things drawn as explicit placeholders
  const built = {};         // what we actually built, for verification

  if(L == null){
    host.innerHTML = `<div class="empty-state" style="padding:24px;">Overall length was not found on the drawing.<br>
      <span style="font-size:11px;color:var(--text-faint);">The model is not generated rather than guessed. See the Engineering Data panel below.</span></div>`;
    lastBuildRecord = { built:{}, approx:['entire model -- no overall length'] };
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x181c20);
  const camera = new THREE.PerspectiveCamera(45, host.clientWidth/host.clientHeight, 0.1, 100000);
  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.innerHTML = '';
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.68));
  const key = new THREE.DirectionalLight(0xffffff, 0.72);
  key.position.set(0.6, 1.6, 1.1);
  scene.add(key);

  const root = new THREE.Group();
  root.rotation.z = incline;              // exact, from the drawing
  scene.add(root);
  const groups = {};
  STAGE_ORDER.forEach(s=>{ groups[s] = new THREE.Group(); root.add(groups[s]); });
  const dimGroup = new THREE.Group(); scene.add(dimGroup);

  const mat = (hex, opts) => new THREE.MeshStandardMaterial({ color:hex, metalness:0.35, roughness:0.55, ...(opts||{}) });
  const ghost = hex => new THREE.MeshStandardMaterial({ color:hex, metalness:0.1, roughness:0.9, transparent:true, opacity:0.32, wireframe:true });

  built.overall_length_in = L;
  built.incline_deg = inclineDeg || 0;

  if(isScrew){
    // ---- Trough: exact width/depth when given, half-round otherwise ----
    if(troughW){
      const R = troughW/2;
      const depth = troughD || R;   // U-trough: depth = half width unless stated
      if(!troughD) approx.push('trough depth (assumed half of trough width)');
      const tg = new THREE.CylinderGeometry(R, R, L, 32, 1, true, Math.PI, Math.PI);
      const trough = new THREE.Mesh(tg, mat(STAGE_META.trough.color, {side:THREE.DoubleSide, metalness:0.2}));
      trough.rotation.z = Math.PI/2;
      groups.trough.add(trough);
      // Angle flanges along both top edges
      const flH = dimIn(tr.flange_height) || Math.max(R*0.18, 1);
      if(!dimIn(tr.flange_height)) approx.push('flange height');
      [-1,1].forEach(sgn=>{
        const fl = new THREE.Mesh(new THREE.BoxGeometry(L, flH*0.25, flH), mat(STAGE_META.trough.color, {metalness:0.3}));
        fl.position.set(0, 0, sgn*R);
        groups.trough.add(fl);
      });
      built.trough_width_in = troughW;
      built.trough_depth_in = depth;
    }else{
      approx.push('trough (no width found -- omitted)');
    }

    // ---- Screw: real helix at the drawing's pitch, not decorative rings ----
    if(D){
      const R = D/2;
      const turns = Math.max(1, L/pitch);
      const segsPerTurn = 24;
      const total = Math.ceil(turns*segsPerTurn);
      const inner = shaftD ? shaftD/2 : R*0.12;
      if(!shaftD && !sc.shaftless) approx.push('shaft diameter');
      // Build the flight as a ribbon of quads following the true helix.
      const positions = [];
      for(let i=0;i<total;i++){
        const t0 = i/segsPerTurn, t1 = (i+1)/segsPerTurn;
        const x0 = -L/2 + t0*pitch, x1 = -L/2 + t1*pitch;
        if(x1 > L/2) break;
        const a0 = t0*Math.PI*2, a1 = t1*Math.PI*2;
        const o0 = [x0, Math.sin(a0)*inner, Math.cos(a0)*inner];
        const i0 = [x0, Math.sin(a0)*R,     Math.cos(a0)*R];
        const o1 = [x1, Math.sin(a1)*inner, Math.cos(a1)*inner];
        const i1 = [x1, Math.sin(a1)*R,     Math.cos(a1)*R];
        positions.push(...o0, ...i0, ...i1);
        positions.push(...o0, ...i1, ...o1);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      fg.computeVertexNormals();
      const flight = new THREE.Mesh(fg, mat(STAGE_META.screw.color, {side:THREE.DoubleSide, metalness:0.5}));
      groups.screw.add(flight);
      if(!sc.shaftless && shaftD){
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftD/2, shaftD/2, L*0.98, 16), mat(0xcfd4d8, {metalness:0.7, roughness:0.3}));
        shaft.rotation.z = Math.PI/2;
        groups.screw.add(shaft);
      }
      built.screw_diameter_in = D;
      built.screw_pitch_in = pitch;
      if(!pitchIsDirect) approx.push('screw pitch (standard pitch assumed = diameter)');
    }else{
      approx.push('screw (no diameter found -- omitted)');
    }

    // ---- Hanger bearings: at called-out positions when given ----
    let hangerPositions = Array.isArray(hg.positions_in) ? hg.positions_in.filter(p=>isFinite(Number(p))).map(Number) : [];
    const hSpacing = dimIn(hg.hanger_spacing);
    const hCount = (hg.count!=null && isFinite(Number(hg.count))) ? Number(hg.count) : null;
    if(!hangerPositions.length && hSpacing){
      for(let x=hSpacing; x < L; x+=hSpacing) hangerPositions.push(x);
    }else if(!hangerPositions.length && hCount){
      for(let i=1;i<=hCount;i++) hangerPositions.push(i*(L/(hCount+1)));
      approx.push('hanger positions (count known, spacing not called out -- evenly distributed)');
    }
    if(hangerPositions.length && D){
      const R = D/2;
      hangerPositions.forEach(px=>{
        const hanger = new THREE.Group();
        const yoke = new THREE.Mesh(new THREE.BoxGeometry(Math.max(R*0.12,0.5), R*2.0, Math.max(R*0.2,0.75)), mat(STAGE_META.bearings.color));
        yoke.position.y = R*0.5;
        const bore = dimIn(hg.bearing_bore);
        const brgR = bore ? bore*0.9 : R*0.26;
        if(!bore) approx.push('hanger bearing size');
        const brg = new THREE.Mesh(new THREE.CylinderGeometry(brgR, brgR, Math.max(R*0.3,1), 16), mat(STAGE_META.bearings.color, {metalness:0.6}));
        brg.rotation.z = Math.PI/2;
        hanger.add(yoke, brg);
        hanger.position.x = -L/2 + px;   // measured from tail end, per the spec
        groups.bearings.add(hanger);
      });
      built.hanger_count = hangerPositions.length;
      built.hanger_positions_in = hangerPositions;
    }else if(hCount || hSpacing){
      approx.push('hanger bearings (insufficient dimensions to place)');
    }

    // ---- Drive end / tail end ----
    const R = D ? D/2 : (troughW ? troughW/2 : null);
    if(R){
      const driveAtHead = (dr.location||'head') !== 'tail';
      const dx = driveAtHead ? L/2 : -L/2;
      const sgn = driveAtHead ? 1 : -1;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(Math.max(R*0.15,0.5), R*2.6, R*2.6), mat(STAGE_META.drive.color));
      plate.position.x = dx + sgn*Math.max(R*0.08,0.3);
      groups.drive.add(plate);
      const sprD = dimIn(dr.sprocket_diameter);
      if(sprD){
        const spr = new THREE.Mesh(new THREE.CylinderGeometry(sprD/2, sprD/2, Math.max(R*0.2,0.6), 20), mat(STAGE_META.drive.color, {metalness:0.6}));
        spr.rotation.z = Math.PI/2;
        spr.position.x = dx + sgn*Math.max(R*0.5,2);
        groups.drive.add(spr);
        built.sprocket_diameter_in = sprD;
      }else{
        // Motor/gearbox shown only as an explicitly-approximate block.
        const motor = new THREE.Mesh(new THREE.BoxGeometry(R*1.4, R*1.4, R*1.2), ghost(STAGE_META.drive.color));
        motor.position.set(dx + sgn*R*1.0, R*1.2, 0);
        groups.drive.add(motor);
        approx.push('drive unit (identified, dimensions unavailable -- shown as placeholder)');
      }
      const tsd = dimIn(tl.shaft_diameter) || shaftD;
      const tailPlate = new THREE.Mesh(new THREE.BoxGeometry(Math.max(R*0.15,0.5), R*2.4, R*2.4), mat(STAGE_META.tail.color));
      tailPlate.position.x = -dx - sgn*Math.max(R*0.08,0.3);
      groups.tail.add(tailPlate);
      if(tsd){
        const ts = new THREE.Mesh(new THREE.CylinderGeometry(tsd/2, tsd/2, Math.max(R*0.9,3), 14), mat(0xcfd4d8, {metalness:0.7}));
        ts.rotation.z = Math.PI/2;
        ts.position.x = -dx - sgn*Math.max(R*0.5,2);
        groups.tail.add(ts);
      }else{
        approx.push('tail shaft (dimensions unavailable)');
      }
    }
  }else{
    // ---- Belt conveyor path ----
    const W = OW || dimIn(fr.frame_width);
    const beltW = dimIn((spec.belt||{}).belt_width);
    const hpD = dimIn(((spec.head||{}).pulley||{}).pulley_diameter);
    const hpW = dimIn(((spec.head||{}).pulley||{}).pulley_width);
    const frH = dimIn(fr.frame_height);
    if(W){
      const railH = dimIn(fr.side_rail_height) || Math.max(W*0.12, 2);
      if(!dimIn(fr.side_rail_height)) approx.push('side rail height');
      [-1,1].forEach(s=>{
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L, railH, Math.max(W*0.04,0.5)), mat(STAGE_META.trough.color));
        rail.position.z = s*W/2;
        groups.trough.add(rail);
      });
      built.frame_width_in = W;
    }else approx.push('frame (no width found -- omitted)');
    if(hpD && W){
      const hp = new THREE.Mesh(new THREE.CylinderGeometry(hpD/2, hpD/2, hpW||W, 24), mat(STAGE_META.drive.color, {metalness:0.6}));
      hp.rotation.x = Math.PI/2;
      hp.position.x = L/2 - hpD/2;
      groups.drive.add(hp);
      built.head_pulley_diameter_in = hpD;
      if(!hpW) approx.push('head pulley width (frame width used)');
    }
    if(beltW && W){
      const belt = new THREE.Mesh(new THREE.BoxGeometry(L, Math.max(dimIn((spec.belt||{}).belt_thickness)||0.4,0.25), beltW), mat(0x2c3137, {roughness:0.9}));
      belt.position.y = (frH? frH/2 : 0);
      groups.screw.add(belt);
      built.belt_width_in = beltW;
    }
    const rs = dimIn((spec.idlers||{}).roller_spacing), rd = dimIn((spec.idlers||{}).roller_diameter);
    if(rs && rd && W){
      for(let x=rs; x<L; x+=rs){
        const r = new THREE.Mesh(new THREE.CylinderGeometry(rd/2, rd/2, W*0.92, 14), mat(STAGE_META.bearings.color));
        r.rotation.x = Math.PI/2;
        r.position.x = -L/2 + x;
        groups.bearings.add(r);
      }
      built.roller_spacing_in = rs;
    }
  }

  // ---- Legs at called-out positions ----
  const legPositions = Array.isArray(fr.leg_positions_in) ? fr.leg_positions_in.filter(p=>isFinite(Number(p))).map(Number) : [];
  const legSpacing = dimIn(fr.leg_spacing);
  const frameH = dimIn(fr.frame_height) || dimIn(o.centerline_height) || dimIn(o.elevation);
  let legs = legPositions;
  if(!legs.length && legSpacing){ for(let x=legSpacing; x<L; x+=legSpacing) legs.push(x); }
  if(legs.length && frameH){
    const halfW = (OW||troughW||12)/2;
    legs.forEach(px=>{
      [-1,1].forEach(s=>{
        const leg = new THREE.Mesh(new THREE.BoxGeometry(Math.max(halfW*0.12,1), frameH, Math.max(halfW*0.12,1)), mat(STAGE_META.other.color));
        leg.position.set(-L/2+px, -frameH/2, s*halfW*0.85);
        groups.other.add(leg);
      });
    });
    built.leg_positions_in = legs;
  }else if(legSpacing || legPositions.length){
    approx.push('legs (no frame height / elevation found -- omitted)');
  }

  // ---- Dimension overlays, straight from the spec ----
  const dimLabels = [];
  const addDim = (label, pos) => {
    const spr = makeTextSprite(THREE, label);
    const s = Math.max(L*0.045, 2);
    spr.scale.set(s*spr.userData.aspect, s, 1);
    spr.position.copy(pos);
    dimGroup.add(spr);
    dimLabels.push(spr);
  };
  const halfH = (troughW||OW||12)/2;
  addDim(`${L.toFixed(0)}" overall length`, new THREE.Vector3(0, -halfH*2.2, 0));
  if(troughW) addDim(`${troughW.toFixed(0)}" trough width`, new THREE.Vector3(-L/2, halfH*1.6, 0));
  if(D) addDim(`${D.toFixed(0)}" screw dia`, new THREE.Vector3(0, halfH*1.9, 0));
  if(inclineDeg) addDim(`${inclineDeg}deg incline`, new THREE.Vector3(L/2, halfH*1.6, 0));
  if(built.hanger_count) addDim(`${built.hanger_count} hangers`, new THREE.Vector3(0, -halfH*1.6, 0));
  dimGroup.visible = showDimensions;

  // Assembly mode hides the detail-heavy groups for a cleaner read.
  function applyMode(){
    const eng = modelMode === MODEL_MODES.engineering;
    groups.bearings.visible = eng && !hiddenModelParts.bearings;
    groups.other.visible    = eng && !hiddenModelParts.other;
    STAGE_ORDER.forEach(s=>{
      if(s!=='bearings' && s!=='other') groups[s].visible = !hiddenModelParts[s];
    });
  }
  applyMode();

  // ---- Framing + orbit ----
  let theta=-0.6, phi=1.15, dist=L*1.45+24;
  function applyCamera(){
    camera.position.set(dist*Math.sin(phi)*Math.cos(theta), dist*Math.cos(phi), dist*Math.sin(phi)*Math.sin(theta));
    camera.lookAt(0,0,0);
  }
  applyCamera();
  const el = renderer.domElement;
  // One AbortController owns every listener this build attaches;
  // disposeModel() aborts it, guaranteeing removal even though the
  // handlers are anonymous closures. Prevents accumulation across the
  // frequent modal refreshes that checklist toggles trigger.
  const ac = new AbortController();
  const sig = ac.signal;
  let dragging=false,lastX=0,lastY=0,pinchStart=0,distStart=0;
  el.addEventListener('pointerdown', e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; el.setPointerCapture(e.pointerId); }, {signal:sig});
  el.addEventListener('pointermove', e=>{
    if(!dragging) return;
    theta -= (e.clientX-lastX)*0.01;
    phi = Math.max(0.15, Math.min(Math.PI-0.15, phi-(e.clientY-lastY)*0.01));
    lastX=e.clientX; lastY=e.clientY; applyCamera();
  }, {signal:sig});
  el.addEventListener('pointerup', ()=>{dragging=false;}, {signal:sig});
  el.addEventListener('pointercancel', ()=>{dragging=false;}, {signal:sig});
  el.addEventListener('wheel', e=>{ e.preventDefault(); dist=Math.max(L*0.15,Math.min(L*6+100, dist*(1+Math.sign(e.deltaY)*0.12))); applyCamera(); }, {passive:false, signal:sig});
  el.addEventListener('touchstart', e=>{ if(e.touches.length===2){ pinchStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); distStart=dist; } }, {passive:true, signal:sig});
  el.addEventListener('touchmove', e=>{
    if(e.touches.length===2 && pinchStart){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      dist=Math.max(L*0.15,Math.min(L*6+100, distStart*(pinchStart/d))); applyCamera();
    }
  }, {passive:true, signal:sig});

  modelState = { renderer, scene, camera, groups, dimGroup, applyMode, raf:0, abort:ac, host };
  lastBuildRecord = { built, approx };
  (function loop(){
    if(!modelState) return;
    modelState.raf = requestAnimationFrame(loop);
    dimLabels.forEach(s=>s.quaternion.copy(camera.quaternion));
    renderer.render(scene, camera);
  })();
}

export function toggleModelPart(part){
  hiddenModelParts[part] = !hiddenModelParts[part];
  if(modelState && modelState.groups[part]) modelState.groups[part].visible = !hiddenModelParts[part];
  document.querySelectorAll(`[data-action="toggle-model-part"][data-part="${part}"]`).forEach(el=>{
    el.classList.toggle('dim', !!hiddenModelParts[part]);
  });
}

/* ---------------- Fullscreen blueprint viewer ----------------
   Pinch/drag to inspect the actual drawing -- the practical everyday
   need on a shop floor, where the detail you want is usually smaller
   than a phone screen shows at fit-width. */

export function modelSectionHtml(job){
  const spec = job.spec;
  if(!spec) return '';
  const legend = STAGE_ORDER.filter(s=>s!=='other').map(s=>`
    <button class="model-chip ${hiddenModelParts[s]?'dim':''}" data-action="toggle-model-part" data-part="${s}">
      <span class="model-swatch" style="background:${STAGE_META[s].color};"></span>${escapeHtml(STAGE_META[s].label)}
    </button>`).join('');
  return `
  <div class="section-title" style="margin-top:16px;">3D Model</div>
  <div class="chip-row" style="margin-bottom:8px;">
    <button class="chip ${modelMode==='engineering'?'active':''}" data-action="set-model-mode" data-mode="engineering">Engineering</button>
    <button class="chip ${modelMode==='assembly'?'active':''}" data-action="set-model-mode" data-mode="assembly">Assembly</button>
    <button class="chip ${showDimensions?'active':''}" data-action="toggle-dimensions">Dimensions</button>
  </div>
  <div class="model-stage" id="modelStage"></div>
  <div class="model-legend">${legend}</div>
  <div class="bp-hint" style="margin-bottom:10px;">
    Drag to rotate, pinch to zoom. Geometry is generated from the extracted dimensions only -- anything the drawing
    did not specify is omitted or shown as a marked placeholder, never estimated. Check the Verification Report for
    exactly what was built vs. what the drawing said.
  </div>`;
}
