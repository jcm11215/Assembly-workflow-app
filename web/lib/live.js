/**
 * Live updates. One EventSource to /api/events; each event carries a whole
 * record (or the id of one removed) and is merged into the store.
 *
 * EventSource reconnects by itself. Whatever happened while the stream
 * was down is picked up by one full reload when it comes back.
 */
import { getState, setState, upsert, without } from './store.js';
import { applyJob, applyKey, applyScan, reloadState } from './actions.js';

let source = null;
let droppedSince = null;

const handlers = {
  job: job => applyJob(job),
  'job-removed': ({ id }) => setState(s => ({
    jobs: without(s.jobs, id),
    blockers: s.blockers.filter(b => b.jobId !== id),
    notes: s.notes.filter(n => n.jobId !== id),
    errors: s.errors.filter(e => e.jobId !== id),
    tasks: s.tasks.filter(t => t.jobId !== id)
  })),
  blocker: b => setState(s => ({ blockers: upsert(s.blockers, b, { prepend: true }) })),
  'blocker-removed': ({ id }) => setState(s => ({ blockers: without(s.blockers, id) })),
  note: n => setState(s => ({ notes: upsert(s.notes, n, { prepend: true }) })),
  'note-removed': ({ id }) => setState(s => ({ notes: without(s.notes, id) })),
  // Not "error": EventSource fires its own "error" when the connection drops.
  'job-error': e => setState(s => ({ errors: upsert(s.errors, e, { prepend: true }) })),
  'job-error-removed': ({ id }) => setState(s => ({ errors: without(s.errors, id) })),
  task: t => setState(s => ({ tasks: upsert(s.tasks, t, { prepend: true }) })),
  'task-removed': ({ id }) => setState(s => ({
    tasks: without(s.tasks, id),
    completions: s.completions.filter(c => c.taskId !== id)
  })),
  completion: c => setState(s => ({
    completions: [c, ...s.completions.filter(x => !(x.taskId === c.taskId && x.dueOn === c.dueOn))]
  })),
  'completion-removed': ({ taskId, dueOn }) => setState(s => ({
    completions: s.completions.filter(x => !(x.taskId === taskId && x.dueOn === dueOn))
  })),
  user: u => setState(s => ({
    team: upsert(s.team, u),
    me: s.me && s.me.id === u.id ? { ...s.me, fullName: u.fullName, role: u.role } : s.me
  })),
  'user-removed': ({ id }) => setState(s => ({ team: (s.team || []).filter(u => u.id !== id) })),
  activity: a => setState(s => (s.activity ? { activity: [a, ...s.activity.filter(x => x.id !== a.id)].slice(0, 500) } : null)),
  ai: summary => setState({ ai: summary }),
  scan: sc => applyScan(sc),
  calibration: key => applyKey(key),
  'ai-models': downloads => setState({ aiDownloads: downloads })
};

export function startLive(){
  stopLive();
  source = new EventSource('/api/events');

  source.addEventListener('hello', () => {
    const wasDown = droppedSince;
    droppedSince = null;
    setState({ connection: 'live' });
    // Back after a drop: re-read once to cover what was missed.
    if(wasDown) reloadState().catch(e => console.error('reload after reconnect failed', e));
  });

  for(const [type, fn] of Object.entries(handlers)){
    source.addEventListener(type, e => {
      try { fn(JSON.parse(e.data)); } catch (err) { console.error(`live ${type} event failed`, err); }
    });
  }

  source.onerror = () => {
    if(!droppedSince) droppedSince = Date.now();
    if(getState().connection !== 'reconnecting') setState({ connection: 'reconnecting' });
    // A stream refused outright (signed out, server gone) is not retried
    // by the browser; check the session and try again shortly.
    if(source.readyState === EventSource.CLOSED){
      setTimeout(() => {
        if(getState().phase === 'ready') reloadState().then(startLive).catch(() => setTimeout(startLive, 5000));
      }, 3000);
    }
  };
}

export function stopLive(){
  if(source){ source.close(); source = null; }
}
