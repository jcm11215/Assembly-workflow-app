/**
 * Shop assembly procedure + Kanban stage definitions.
 * Pure domain data and pure functions -- the single source of truth for
 * what the stages are and which procedure steps gate each one.
 */

export const STAGES = [
  {id:'ready',    label:'Ready for Assembly'},
  {id:'layout',   label:'Layout'},
  {id:'bearings', label:'Bearings Installed'},
  {id:'drive',    label:'Drive Installed'},
  {id:'final',    label:'Final Assembly'},
  {id:'testing',  label:'Testing'},
  {id:'qc',       label:'Ready for QC'},
  {id:'complete', label:'Complete'}
];

export const stageLabel = id => (STAGES.find(s=>s.id===id)||{}).label || id;

// Shop-standard assembly procedure -- tracked per job as a checklist so
// assemblers can check off each step as they physically complete it.

// Shop-standard assembly procedure -- tracked per job as a checklist so
// assemblers can check off each step as they physically complete it.
export const PROCEDURE = [
  { title:'Verify Hardware & Purchased Components', items:[
    'Verify all hardware and purchased components against the approved drawing and BOM.',
    'Confirm the correct quantity, size, type, and specification of each component.',
    'Verify bearings, seals, sprockets, shafts, couplings, drives, and other purchased components are correct for the job.',
    'Inspect all components for damage or defects.',
    'Set aside any incorrect, damaged, or missing components and notify the assembly lead/supervisor.'
  ]},
  { title:'Verify Fabricated Parts', items:[
    'Verify all fabricated parts against the approved drawing and BOM.',
    'Confirm all measurements and dimensions are correct.',
    'Verify hole locations, mounting patterns, lengths, widths, and overall configuration.',
    'Inspect fabricated parts for defects that could affect assembly.',
    'Report any discrepancies before beginning assembly.'
  ]},
  { title:'Assemble Troughs', items:[
    'Assemble trough sections in the correct order according to the approved drawing.',
    'Verify proper orientation of each trough section.',
    'Align and join the trough sections.',
    'Install the required hardware.',
    'Verify the assembled trough is straight, square, and properly aligned.'
  ]},
  { title:'Assemble Screws, Troughs, Couplings & Shafts', items:[
    'Install screw sections into the assembled troughs in the correct order and orientation.',
    'Assemble and connect screw sections using the specified couplings and hardware.',
    'Install required shafts according to the approved drawing.',
    'Verify screw flight direction and positioning.',
    'Verify proper shaft and coupling alignment.',
    'Secure all coupling and shaft connections.'
  ]},
  { title:'Assemble Drive End', items:[
    'Install the required waste pack, flange gland, and/or bearings at the drive end, as specified by the drawing.',
    'Install and secure the drive shaft and drive components.',
    'Install the drive plate and required hardware.',
    'Verify proper alignment of the shaft, bearings, seals, and drive.',
    'Ensure all components are properly positioned and secured.'
  ]},
  { title:'Mark, Drill & Install Hanger Bearings', items:[
    'Mark hanger bearing locations according to the approved drawing.',
    'Verify hanger locations and spacing before drilling.',
    'Drill the required mounting holes.',
    'Remove burrs and clean the drilled areas.',
    'Install hanger bearings and required hardware.',
    'Verify hanger bearing alignment with the screw shaft.',
    'Secure all hanger bearing hardware.'
  ]},
  { title:'Assemble Tail End', items:[
    'Install the tail end onto the conveyor.',
    'Install any required bearings, seals, waste pack, or flange gland as specified by the drawing.',
    'Install the tail shaft and associated hardware, if applicable.',
    'Verify proper shaft and bearing alignment.',
    'Secure all hardware and ensure the tail end is properly positioned.'
  ]}
];

export const PROCEDURE_TOTAL = PROCEDURE.reduce((n,s)=>n+s.items.length, 0);
// "2-1" -> "Assemble Troughs / Verify proper orientation..." for the log.

// "2-1" -> "Assemble Troughs / Verify proper orientation..." for the log.
export function checklistItemLabel(key){
  const [si, ii] = String(key).split('-').map(Number);
  const step = PROCEDURE[si];
  if(!step) return key;
  const item = step.items[ii];
  return item ? `${step.title} / ${item}` : step.title;
}

// Maps each Board stage to the procedure step(s) that must be completed
// while a job sits in that stage, before it can advance to the next one.
// Indices refer to PROCEDURE above. Stages not listed (testing, qc,
// complete) have no gating checklist -- they're sign-off stages, not
// build steps.

// Maps each Board stage to the procedure step(s) that must be completed
// while a job sits in that stage, before it can advance to the next one.
// Indices refer to PROCEDURE above. Stages not listed (testing, qc,
// complete) have no gating checklist -- they're sign-off stages, not
// build steps.
export const STAGE_PROCEDURE = {
  ready:    [0, 1], // Verify Hardware & Purchased Components, Verify Fabricated Parts
  layout:   [2, 3], // Assemble Troughs, Assemble Screws/Couplings/Shafts
  bearings: [5],    // Mark, Drill & Install Hanger Bearings
  drive:    [4],    // Assemble Drive End
  final:    [6]     // Assemble Tail End
};

export function stageChecklistProgress(job, stageId){
  const stepIdxs = STAGE_PROCEDURE[stageId] || [];
  const checked = job.checklist || {};
  let total = 0, done = 0;
  stepIdxs.forEach(si=> PROCEDURE[si].items.forEach((_,ii)=>{
    total++;
    if(checked[si+'-'+ii]) done++;
  }));
  return { done, total };
}

// Automation: quick stage moves (arrows / mover / dashboard advance) snap
// percent-complete to a sensible baseline for that stage, so the Lead
// doesn't have to separately open a form and drag a slider every time.

// Automation: quick stage moves (arrows / mover / dashboard advance) snap
// percent-complete to a sensible baseline for that stage, so the Lead
// doesn't have to separately open a form and drag a slider every time.
export const STAGE_DEFAULT_PERCENT = {
  ready:0, layout:15, bearings:30, drive:50, final:65, testing:80, qc:92, complete:100
};
