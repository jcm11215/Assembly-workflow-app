/**
 * Cutover dry run.
 *
 * Answers one question without taking any risk: "if we flipped reads to
 * relational right now, would the shop floor see the same thing?"
 *
 * Loads both stores side by side and diffs exactly what the UI would
 * render. Serves nothing, mutates nothing, and needs no revert because
 * nothing changed.
 */
import { db, supabaseReady } from './supabaseClient.js';
import * as jobsRepo from './jobsRepo.js';
import * as blockersRepo from './blockersRepo.js';
import * as notesRepo from './notesRepo.js';
import { getMode, MODE, describeMode, setMode } from './cutover.js';

async function legacy(key){
  if(!supabaseReady()) return [];
  try {
    const rows = await db.select('app_data', `select=value&key=eq.${key}`);
    return rows.length && Array.isArray(rows[0].value) ? rows[0].value : [];
  } catch { return []; }
}

/** What the dashboard's "would users notice?" line is computed from. */
function renderShape(jobs){
  return jobs
    .map(j => [
      j.jobNumber, j.assemblyStatus, j.percentComplete,
      j.priority, (j.dueDate || '').slice(0, 10),
      Object.values(j.checklist || {}).filter(Boolean).length
    ].join('|'))
    .sort();
}

export async function simulateCutover(){
  const t0 = Date.now();
  const [lJobs, rJobs, lBlockers, rBlockers, lNotes, rNotes] = await Promise.all([
    legacy('jobs'), jobsRepo.listJobs(),
    legacy('blockers'), blockersRepo.listBlockers(),
    legacy('notes'), notesRepo.listNotes(2000)
  ]);

  const lShape = renderShape(lJobs);
  const rShape = renderShape(rJobs);
  const lSet = new Set(lShape), rSet = new Set(rShape);

  const onlyLegacy     = lShape.filter(s => !rSet.has(s));
  const onlyRelational = rShape.filter(s => !lSet.has(s));

  const identical =
    onlyLegacy.length === 0 &&
    onlyRelational.length === 0 &&
    lBlockers.length === rBlockers.length &&
    lNotes.length === rNotes.length;

  return {
    durationMs: Date.now() - t0,
    currentMode: getMode(),
    wouldBecome: MODE.RELATIONAL_READS,
    identical,
    counts: {
      jobs:     { legacy: lJobs.length,     relational: rJobs.length },
      blockers: { legacy: lBlockers.length, relational: rBlockers.length },
      notes:    { legacy: lNotes.length,    relational: rNotes.length }
    },
    visibleDifferences: {
      jobsOnlyInLegacy: onlyLegacy.slice(0, 25),
      jobsOnlyInRelational: onlyRelational.slice(0, 25),
      truncated: onlyLegacy.length > 25 || onlyRelational.length > 25
    },
    recommendation: identical
      ? 'Relational reads would render identically. Safe to proceed.'
      : 'Differences detected. Resolve them before switching reads.'
  };
}

/** One call to switch reads, and one to undo it. Writes are unaffected. */
export function applyCutover(){ return { mode: setMode(MODE.RELATIONAL_READS), ...describeMode(MODE.RELATIONAL_READS) }; }
export function revertCutover(){ return { mode: setMode(MODE.LEGACY_READS), ...describeMode(MODE.LEGACY_READS) }; }
