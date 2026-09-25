/**
 * The activity log, newest first. Admins see the whole shop's, with who
 * is on the app now, when each person last signed in and used it, and
 * filters by person and by what was done. Everyone else sees their own.
 * New entries arrive live.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { useStore, setState, getState } from '../lib/store.js';
import { api } from '../lib/api.js';
import { loadActivity } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtWhen, plural } from '../lib/format.js';
import { Chips, Empty, PageHeader, Section } from '../ui/kit.js';
import { toastError } from '../ui/overlays.js';

const PAGE = 100;
const SIGN_INS = ['Signed in', 'Signed out', 'Sign-in failed', 'Sign-in refused'];
const KINDS = [
  { id: 'all', label: 'Everything' },
  { id: 'work', label: 'Work done' },
  { id: 'signins', label: 'Sign-ins' },
  { id: 'failed', label: 'Failed sign-ins' }
];

/** The server-side filter for a kind of entry; `kindMatch` applies it to live ones. */
const kindQuery = kind => (kind === 'failed' ? { action: 'Sign-in failed' } : kind === 'all' ? {} : { kind });
const kindMatch = (kind, a) => kind === 'all' ? true
  : kind === 'work' ? !SIGN_INS.includes(a.action)
  : kind === 'signins' ? SIGN_INS.includes(a.action)
  : a.action === 'Sign-in failed';

export function Activity(){
  const entries = useStore(s => s.activity);
  const seesAll = useCan('activity.all');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState(null);
  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('all');

  const load = async (before) => {
    setLoading(true);
    try {
      const res = await loadActivity({ limit: PAGE, before, actor: person || null, ...kindQuery(kind) });
      setState({ activity: before ? [...(getState().activity || []), ...res.entries] : res.entries });
      setMore(res.more);
    } catch (e) { toastError(e); }
    finally { setLoading(false); }
  };
  const loadPeople = () => api.get('/api/activity/people').then(d => setPeople(d.people)).catch(toastError);

  useEffect(() => { load(); }, [person, kind]);
  useEffect(() => {
    if(!seesAll) return;
    loadPeople();
    const t = setInterval(loadPeople, 60000);
    return () => clearInterval(t);
  }, [seesAll]);
  // A new sign-in or sign-out changes who is on; refresh the people list.
  const newest = entries && entries[0];
  useEffect(() => { if(seesAll && newest && SIGN_INS.includes(newest.action)) loadPeople(); }, [newest && newest.id]);

  if(!entries) return html`<${Empty}>Loading…<//>`;
  // Live entries arrive unfiltered; show only those the filters allow.
  const shown = entries.filter(a => (!person || a.actorId === person) && kindMatch(kind, a));
  const chosen = people && people.find(p => p.id === person);

  return html`
    <${PageHeader} title="Activity" sub=${seesAll ? 'Who is using the app, and everything done in it' : "What you've done, newest first"} />

    ${seesAll && people && html`
      <${Section} title="People" count=${`${people.filter(p => p.online).length} on now`}>
        <div class="card people-list">
          ${people.map(p => html`
            <button key=${p.id} type="button" class=${`person-row${person === p.id ? ' selected' : ''}${p.active ? '' : ' inactive'}`}
                    aria-pressed=${person === p.id} onClick=${() => setPerson(person === p.id ? '' : p.id)}>
              <span class=${`presence${p.online ? ' on' : ''}`} title=${p.online ? 'Has the app open now' : 'Not on the app'}></span>
              <span class="person-main">
                <b>${p.fullName}</b>${!p.active && html` <span class="hint">· switched off</span>`}
                <span class="hint">${p.online ? 'On the app now' : p.lastActive ? `Last on ${fmtWhen(p.lastActive)}` : 'Never used the app'}
                  ${p.lastSignIn && ` · signed in ${fmtWhen(p.lastSignIn)}${p.device ? ` on ${p.device}` : ''}`}</span>
              </span>
              <span class="person-stats hint">
                ${plural(p.weekActions, 'change')} this week
                ${p.weekFailed > 0 && html`<span class="error-text"> · ${plural(p.weekFailed, 'failed sign-in')}</span>`}
              </span>
            </button>`)}
        </div>
      <//>`}

    ${seesAll && html`
      <div class="activity-filters">
        <${Chips} label="Show" options=${KINDS} value=${kind} onChange=${setKind} />
        ${chosen && html`<button class="chip active" onClick=${() => setPerson('')}>${chosen.fullName} ✕</button>`}
      </div>`}

    <div class="activity">
      ${shown.length ? shown.map(a => html`
        <div key=${a.id} class=${`activity-row${a.action === 'Sign-in failed' || a.action === 'Sign-in refused' ? ' activity-warn' : ''}`}>
          <div class="activity-when">${fmtWhen(a.at)}</div>
          <div>
            <b>${a.actorName}</b> <span class="activity-action">${a.action.toLowerCase()}</span>
            ${a.detail && a.detail.text && html`<div class="activity-detail">${a.detail.text}</div>`}
          </div>
        </div>`) : html`<${Empty} icon="activity">${loading ? 'Loading…' : 'Nothing here.'}<//>`}
    </div>
    ${more && html`<button class="btn btn-block" disabled=${loading} onClick=${() => load(entries[entries.length - 1].id)}>
      ${loading ? 'Loading…' : 'Load older'}</button>`}`;
}
