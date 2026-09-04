/**
 * Central mutable app state. Single instance imported by every module.
 * Phase 7 replaces direct mutation with realtime-driven reconciliation;
 * keeping all state here means that change is contained.
 */

export const state = {
  tab: 'dashboard',
  jobs: [],
  blockers: [],
  notes: [],
  jobFilter: 'all',
  jobSearch: '',
  blockerFilter: 'active',
  noteSearch: '',
  activity: [],
  activitySearch: '',
  chat: []
};

export let selectedBlueprintFile = null;


// selectedBlueprintFile is reassigned by the file picker, so it needs a setter
// (ES module bindings are read-only to importers).
export function setSelectedBlueprintFile(f){ selectedBlueprintFile = f; }
export function getSelectedBlueprintFile(){ return selectedBlueprintFile; }
