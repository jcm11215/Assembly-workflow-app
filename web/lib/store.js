/**
 * The app's state: one object, replaced (never mutated) on every change,
 * with components subscribing to the slices they use.
 *
 * Records arrive from the server already in the shape the screens use --
 * from GET /api/state at start-up, from the response to each change, and
 * from live updates -- and are merged in by id, so the same record
 * arriving twice (a response and its live echo) is harmless.
 */
import { useEffect, useState, useRef } from '../vendor/index.js';

const initial = {
  phase: 'starting',          // starting | signed-out | setup | ready
  me: null,
  team: [],
  jobs: [],
  blockers: [],
  notes: [],
  errors: [],
  tasks: [],
  completions: [],
  ai: { provider: 'gemini', label: 'Google Gemini', ready: false },
  activity: null,             // loaded when the Activity screen first opens
  jobFilter: 'all',           // the dashboard filter; the metric tiles set it too
  aiPull: null,               // a local model downloading (admins only): { model, status, total, completed, done? }
  assistantDraft: '',         // a question another screen hands to the assistant
  connection: 'connecting',   // connecting | live | reconnecting
  loadedAt: null
};

let state = initial;
const listeners = new Set();

export const getState = () => state;

/** `patch` is an object to merge, or a function of the current state
 *  returning one. */
export function setState(patch){
  const next = typeof patch === 'function' ? patch(state) : patch;
  if(!next) return;
  state = { ...state, ...next };
  listeners.forEach(fn => fn(state));
}

export function resetState(extra){ state = { ...initial, ...extra }; listeners.forEach(fn => fn(state)); }

export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Re-renders the component when `select(state)` changes.
 *
 * Effects run after the browser paints, so a change can land between this
 * component's first render and its subscription (a fast response at
 * start-up, say). Checking once more right after subscribing is what keeps
 * that change from being missed -- without it the app could sit on
 * "Loading" with its data already in hand.
 */
export function useStore(select = s => s){
  const [value, setValue] = useState(() => select(state));
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const check = s => {
      const next = selectRef.current(s);
      setValue(prev => (Object.is(prev, next) ? prev : next));
    };
    const unsubscribe = subscribe(check);
    check(state);
    return unsubscribe;
  }, []);
  return value;
}

/* ---------------- collection helpers ---------------- */

/** Replaces the record with the same id, or adds it (at the front when
 *  `prepend`, for newest-first lists). */
export function upsert(list, record, { prepend = false } = {}){
  const i = list.findIndex(x => x.id === record.id);
  if(i === -1) return prepend ? [record, ...list] : [...list, record];
  const copy = list.slice();
  copy[i] = record;
  return copy;
}

export const without = (list, id) => list.filter(x => x.id !== id);
