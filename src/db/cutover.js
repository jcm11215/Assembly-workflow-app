/**
 * Cutover control.
 *
 * Governs which store the app READS from while both are being written.
 * Writes go to the relational tables in every mode -- the legacy blob is
 * only ever read, never written, so it cannot drift forward and become
 * the thing we have to migrate again.
 *
 * Setting lives in localStorage so a single device can be flipped to
 * relational reads and observed before the whole shop follows.
 */

export const MODE = {
  /** Read legacy blob, write relational. Safest -- users see the old data. */
  LEGACY_READS:     'legacy_reads',
  /** Read relational, write relational. The real cutover. */
  RELATIONAL_READS: 'relational_reads',
  /** Relational only; legacy blob no longer consulted at all. */
  RELATIONAL_ONLY:  'relational_only'
};

const KEY = 'awt_cutover_mode';
const DRY_RUN_KEY = 'awt_cutover_dryrun';

const ORDER = [MODE.LEGACY_READS, MODE.RELATIONAL_READS, MODE.RELATIONAL_ONLY];

export function getMode(){
  const m = localStorage.getItem(KEY);
  return ORDER.includes(m) ? m : MODE.LEGACY_READS;   // safe default
}

export function setMode(mode){
  if(!ORDER.includes(mode)) throw new Error(`Unknown cutover mode: ${mode}`);
  localStorage.setItem(KEY, mode);
  return mode;
}

/** Instant revert -- one call, no data movement, because writes never stopped. */
export function revertToLegacy(){
  return setMode(MODE.LEGACY_READS);
}

export const USE_RELATIONAL_READS = () =>
  getMode() === MODE.RELATIONAL_READS || getMode() === MODE.RELATIONAL_ONLY;

export const USE_LEGACY_FALLBACK = () => getMode() !== MODE.RELATIONAL_ONLY;

/**
 * Dry run: read BOTH stores and compare, but keep serving whichever the
 * current mode says. Lets us measure a cutover without taking one.
 */
export function isDryRun(){ return localStorage.getItem(DRY_RUN_KEY) === '1'; }
export function setDryRun(on){ localStorage.setItem(DRY_RUN_KEY, on ? '1' : '0'); }

export function describeMode(mode = getMode()){
  switch(mode){
    case MODE.LEGACY_READS:
      return { label:'Legacy Reads + Dual Writes', risk:'low',
               detail:'Users see legacy data. Relational tables are written and can be verified safely.' };
    case MODE.RELATIONAL_READS:
      return { label:'Relational Reads + Dual Writes', risk:'medium',
               detail:'Users see relational data. Legacy remains available for instant revert.' };
    case MODE.RELATIONAL_ONLY:
      return { label:'Relational Only', risk:'committed',
               detail:'Legacy store is no longer read. Revert requires a redeploy.' };
    default:
      return { label:'Unknown', risk:'unknown', detail:'' };
  }
}
