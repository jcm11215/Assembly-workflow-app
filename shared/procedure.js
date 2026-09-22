/**
 * The shop's assembly procedure: the stages a job moves through, the
 * checklist that gates each one, and the rule for whether a stage move
 * is allowed.
 *
 * Imported by both the server (which enforces the rule) and the browser
 * (which uses it to explain a refusal before sending anything), so there
 * is exactly one definition of what a legal move is.
 */

export const STAGES = [
  { id: 'ready',    label: 'Ready for Assembly' },
  { id: 'layout',   label: 'Layout' },
  { id: 'bearings', label: 'Bearings Installed' },
  { id: 'drive',    label: 'Drive Installed' },
  { id: 'final',    label: 'Final Assembly' },
  { id: 'testing',  label: 'Testing' },
  { id: 'qc',       label: 'Ready for QC' },
  { id: 'complete', label: 'Complete' }
];

export const STAGE_IDS = STAGES.map(s => s.id);
export const stageLabel = id => (STAGES.find(s => s.id === id) || {}).label || id;
export const stageIndex = id => STAGE_IDS.indexOf(id);

/** Moving a job into these means signing the work off. Trainees may not. */
export const SIGNOFF_STAGES = ['qc', 'complete'];

/** Where percent-complete snaps to when a job enters each stage. */
export const STAGE_DEFAULT_PERCENT = {
  ready: 0, layout: 15, bearings: 30, drive: 50, final: 65, testing: 80, qc: 92, complete: 100
};

export const PROCEDURE = [
  { title: 'Verify Hardware & Purchased Components', items: [
    'Verify all hardware and purchased components against the approved drawing and BOM.',
    'Confirm the correct quantity, size, type, and specification of each component.',
    'Verify bearings, seals, sprockets, shafts, couplings, drives, and other purchased components are correct for the job.',
    'Inspect all components for damage or defects.',
    'Set aside any incorrect, damaged, or missing components and notify the assembly lead/supervisor.'
  ]},
  { title: 'Verify Fabricated Parts', items: [
    'Verify all fabricated parts against the approved drawing and BOM.',
    'Confirm all measurements and dimensions are correct.',
    'Verify hole locations, mounting patterns, lengths, widths, and overall configuration.',
    'Inspect fabricated parts for defects that could affect assembly.',
    'Report any discrepancies before beginning assembly.'
  ]},
  { title: 'Assemble Troughs', items: [
    'Assemble trough sections in the correct order according to the approved drawing.',
    'Verify proper orientation of each trough section.',
    'Align and join the trough sections.',
    'Install the required hardware.',
    'Verify the assembled trough is straight, square, and properly aligned.'
  ]},
  { title: 'Assemble Screws, Troughs, Couplings & Shafts', items: [
    'Install screw sections into the assembled troughs in the correct order and orientation.',
    'Assemble and connect screw sections using the specified couplings and hardware.',
    'Install required shafts according to the approved drawing.',
    'Verify screw flight direction and positioning.',
    'Verify proper shaft and coupling alignment.',
    'Secure all coupling and shaft connections.'
  ]},
  { title: 'Assemble Drive End', items: [
    'Install the required waste pack, flange gland, and/or bearings at the drive end, as specified by the drawing.',
    'Install and secure the drive shaft and drive components.',
    'Install the drive plate and required hardware.',
    'Verify proper alignment of the shaft, bearings, seals, and drive.',
    'Ensure all components are properly positioned and secured.'
  ]},
  { title: 'Mark, Drill & Install Hanger Bearings', items: [
    'Mark hanger bearing locations according to the approved drawing.',
    'Verify hanger locations and spacing before drilling.',
    'Drill the required mounting holes.',
    'Remove burrs and clean the drilled areas.',
    'Install hanger bearings and required hardware.',
    'Verify hanger bearing alignment with the screw shaft.',
    'Secure all hanger bearing hardware.'
  ]},
  { title: 'Assemble Tail End', items: [
    'Install the tail end onto the conveyor.',
    'Install any required bearings, seals, waste pack, or flange gland as specified by the drawing.',
    'Install the tail shaft and associated hardware, if applicable.',
    'Verify proper shaft and bearing alignment.',
    'Secure all hardware and ensure the tail end is properly positioned.'
  ]}
];

/** The procedure steps (indexes into PROCEDURE) that must be finished
 *  while a job sits in each stage. Testing, QC and Complete are sign-off
 *  stages with no checklist of their own. */
export const STAGE_STEPS = {
  ready:    [0, 1],
  layout:   [2, 3],
  bearings: [5],
  drive:    [4],
  final:    [6]
};

/** A checklist item is identified by "step-item", e.g. "2-1". */
export const checklistKey = (step, item) => `${step}-${item}`;

export function parseChecklistKey(key){
  const m = /^(\d+)-(\d+)$/.exec(String(key));
  if(!m) return null;
  const step = Number(m[1]), item = Number(m[2]);
  if(!PROCEDURE[step] || item >= PROCEDURE[step].items.length) return null;
  return { step, item };
}

/** "2-1" -> "Assemble Troughs / Verify proper orientation of ..." */
export function checklistItemLabel(key){
  const k = parseChecklistKey(key);
  if(!k) return String(key);
  return `${PROCEDURE[k.step].title} / ${PROCEDURE[k.step].items[k.item]}`;
}

/** How much of a stage's checklist is ticked. `checklist` is the
 *  {"step-item": true} map carried on a job. */
export function stageProgress(checklist, stageId){
  const done = checklist || {};
  let total = 0, ticked = 0;
  for(const step of STAGE_STEPS[stageId] || []){
    PROCEDURE[step].items.forEach((_, item) => {
      total++;
      if(done[checklistKey(step, item)]) ticked++;
    });
  }
  return { done: ticked, total };
}

/**
 * May `job` move from its current stage to `to`, for someone with `role`?
 * Returns { ok: true } or { ok: false, code, reason }.
 *
 * Backward moves are always allowed -- correcting a mistake must never be
 * blocked. Forward moves go one stage at a time, need the current stage's
 * checklist complete, and a trainee may not sign work off.
 */
export function checkStageMove(job, to, role){
  const from = stageIndex(job.stage);
  const target = stageIndex(to);
  if(target < 0) return refuse('unknown_stage', `Unknown stage "${to}".`);
  if(from < 0) return refuse('unknown_stage', 'The job is in an unknown stage.');
  if(from === target) return refuse('same_stage', 'The job is already in that stage.');
  if(target < from) return { ok: true };

  if(role === 'trainee' && SIGNOFF_STAGES.includes(to)){
    return refuse('trainee_signoff',
      `Trainees can't sign a job into ${stageLabel(to)}. Ask an experienced assembler or an admin.`);
  }
  if(target > from + 1){
    return refuse('skip',
      `Can't skip from ${stageLabel(job.stage)} to ${stageLabel(to)}. Advance one stage at a time.`);
  }
  const { done, total } = stageProgress(job.checklist, job.stage);
  if(done < total){
    return refuse('checklist', `${stageLabel(job.stage)} checklist is ${done}/${total} complete.`);
  }
  return { ok: true };
}

function refuse(code, reason){ return { ok: false, code, reason }; }

export const nextStage = id => STAGE_IDS[stageIndex(id) + 1] || null;
export const prevStage = id => (stageIndex(id) > 0 ? STAGE_IDS[stageIndex(id) - 1] : null);
