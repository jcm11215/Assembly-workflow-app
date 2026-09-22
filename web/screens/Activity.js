/**
 * The activity log, newest first. Admins see the whole shop's; everyone
 * else sees their own. New entries arrive live.
 */
import { html, useEffect, useState } from '../vendor/index.js';
import { useStore, setState, getState } from '../lib/store.js';
import { loadActivity } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtWhen } from '../lib/format.js';
import { Empty } from '../ui/kit.js';
import { toastError } from '../ui/overlays.js';

const PAGE = 100;

export function Activity(){
  const entries = useStore(s => s.activity);
  const seesAll = useCan('activity.all');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (before) => {
    setLoading(true);
    try {
      const res = await loadActivity({ limit: PAGE, before });
      setState({ activity: before ? [...(getState().activity || []), ...res.entries] : res.entries });
      setMore(res.more);
    } catch (e) { toastError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if(!entries) return html`<${Empty}>Loading…<//>`;
  return html`
    <h2 class="screen-title">${seesAll ? "The shop's activity" : 'Your activity'}</h2>
    ${!seesAll && html`<p class="hint">You see what you've done. Admins see the whole shop's log.</p>`}
    <div class="activity">
      ${entries.length ? entries.map(a => html`
        <div key=${a.id} class="activity-row">
          <div class="activity-when">${fmtWhen(a.at)}</div>
          <div>
            <b>${a.actorName}</b> <span class="activity-action">${a.action.toLowerCase()}</span>
            ${a.detail && a.detail.text && html`<div class="activity-detail">${a.detail.text}</div>`}
          </div>
        </div>`) : html`<${Empty} icon="📈">Nothing yet.<//>`}
    </div>
    ${more && html`<button class="btn btn-block" disabled=${loading} onClick=${() => load(entries[entries.length - 1].id)}>
      ${loading ? 'Loading…' : 'Load older'}</button>`}`;
}
