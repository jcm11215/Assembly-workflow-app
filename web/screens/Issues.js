/**
 * Issues: what is stopping jobs right now (blockers), and the log of
 * engineering and purchasing errors -- two tabs of one screen.
 */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { useCan } from '../lib/permissions.js';
import { PageHeader, Tabs } from '../ui/kit.js';
import { Icon } from '../ui/icons.js';
import { openModal } from '../ui/overlays.js';
import { Blockers, BlockerForm } from './Blockers.js';
import { Errors, ErrorForm } from './Errors.js';

export function Issues({ query = {} }){
  const [tab, setTab] = useState(query.tab === 'errors' ? 'errors' : 'blockers');
  const openBlockers = useStore(s => s.blockers.filter(b => b.status !== 'Resolved').length);
  const openErrors = useStore(s => s.errors.filter(e => e.status !== 'Corrected').length);
  const canLog = useCan('error.log');

  const action = tab === 'blockers'
    ? html`<button class="btn btn-primary" onClick=${() => openModal(BlockerForm)}><${Icon} name="plus" />Report a blocker</button>`
    : canLog && html`<button class="btn btn-primary" onClick=${() => openModal(ErrorForm)}><${Icon} name="plus" />Log an error</button>`;

  return html`
    <${PageHeader} title="Issues" sub="Blockers stopping jobs, and the engineering and purchasing error log" actions=${action} />
    <${Tabs} label="Issues" value=${tab} onChange=${setTab} options=${[
      { id: 'blockers', label: 'Blockers', count: openBlockers },
      { id: 'errors', label: 'Error log', count: openErrors }
    ]} />
    ${tab === 'blockers' ? html`<${Blockers} />` : html`<${Errors} />`}`;
}
