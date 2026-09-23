/**
 * The frame around every screen: header, metric readouts, navigation, and
 * the screen the route names.
 */
import { html, useEffect } from '../vendor/index.js';
import { useStore, setState } from '../lib/store.js';
import { useRoute, navigate } from '../lib/router.js';
import { can as roleCan } from '../../shared/roles.js';
import { metrics } from '../lib/jobs.js';
import { reloadState } from '../lib/actions.js';
import { Icon } from '../ui/icons.js';
import { openModal, toast, toastError } from '../ui/overlays.js';
import { lazy } from '../ui/lazy.js';

import { Dashboard } from '../screens/Dashboard.js';
import { Board } from '../screens/Board.js';
import { JobPage } from '../screens/JobPage.js';
import { Blockers } from '../screens/Blockers.js';
import { Errors } from '../screens/Errors.js';
import { Tasks } from '../screens/Tasks.js';
import { Notes } from '../screens/Notes.js';
import { Activity } from '../screens/Activity.js';
import { Settings } from '../screens/Settings.js';

// The assistant and the admin screens are the heavy, occasional ones:
// fetched the first time they are opened.
const Assistant = lazy(() => import('../screens/Assistant.js'), 'Assistant');
const Admin = lazy(() => import('../screens/Admin.js'), 'Admin');
const Knowledge = lazy(() => import('../screens/Knowledge.js'), 'Knowledge');

const NAV = [
  { group: 'Production' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'blockers', label: 'Blockers', icon: 'blockers' },
  { id: 'errors', label: 'Errors', icon: 'errors' },
  { group: 'Shop' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { group: 'Tools' },
  { id: 'assistant', label: 'Assistant', icon: 'assistant' },
  { id: 'knowledge', label: 'Knowledge', icon: 'knowledge', perm: 'knowledge.manage' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'admin', label: 'Admin', icon: 'admin', perm: 'team.manage' }
];

const SCREENS = { dashboard: Dashboard, board: Board, blockers: Blockers, errors: Errors, tasks: Tasks,
                  notes: Notes, assistant: Assistant, knowledge: Knowledge, activity: Activity, admin: Admin };

export function Shell(){
  const route = useRoute();
  const role = useStore(s => s.me && s.me.role);
  const connection = useStore(s => s.connection);
  const me = useStore(s => s.me);
  const hasBlocked = useStore(s => s.blockers.some(b => b.status !== 'Resolved'));

  useEffect(() => {
    document.title = route.name === 'job' ? 'Job · Assembly Workflow' : 'Assembly Workflow Tracker';
  }, [route.name]);

  const Screen = route.name === 'job' ? null : SCREENS[route.name] || Dashboard;
  const refresh = async () => {
    try { await reloadState(); toast('Up to date.', { kind: 'ok', ms: 2000 }); }
    catch (e) { toastError(e); }
  };

  return html`
    <div class="app">
      <header class="appbar">
        <a class="brand" href="#/">
          <img class="brand-mark" src="/assets/isc-mfg-logo.webp" alt="" width="38" height="38" />
          <div class="brand-text">
            <div class="brand-name">Assembly Workflow Tracker</div>
            <div class="brand-sub">
              <span class=${`conn conn-${connection}`} title=${connection === 'live' ? 'Live' : 'Reconnecting'}></span>
              ${dateLine()}${me ? ` · ${me.fullName}` : ''}
            </div>
          </div>
        </a>
        <div class="appbar-actions">
          <span class="stamp">Industrial Screw Conveyors</span>
          <button class="tool-btn" onClick=${refresh} title="Refresh" aria-label="Refresh"><${Icon} name="refresh" /></button>
          <button class="tool-btn" onClick=${() => openModal(Settings)} title="Settings" aria-label="Settings"><${Icon} name="settings" /></button>
        </div>
        <div class="belt" aria-hidden="true"></div>
      </header>

      ${route.name !== 'job' && html`<${Metrics} />`}

      <main id="main">
        ${route.name === 'job' ? html`<${JobPage} id=${route.id} key=${route.id} />` : html`<${Screen} />`}
      </main>

      <nav class="nav" aria-label="Main">
        ${NAV.filter(n => !n.perm || roleCan(role, n.perm)).map(n => n.group
          ? html`<div class="nav-group" aria-hidden="true">${n.group}</div>`
          : html`<a href=${`#/${n.id === 'dashboard' ? '' : n.id}`} class=${`nav-btn${route.name === n.id ? ' active' : ''}`}
                    aria-current=${route.name === n.id ? 'page' : undefined}>
                   <${Icon} name=${n.icon} />
                   <span>${n.label}</span>
                   ${n.id === 'blockers' && hasBlocked && html`<span class="dot" aria-label="open blockers"></span>`}
                 </a>`)}
      </nav>
    </div>`;
}

function dateLine(){
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** The readouts under the header. Tapping one opens the dashboard
 *  filtered to exactly those jobs. */
function Metrics(){
  const jobs = useStore(s => s.jobs);
  const blockers = useStore(s => s.blockers);
  const active = useStore(s => s.jobFilter);
  const m = metrics(jobs, blockers);
  const tiles = [
    { id: 'inprogress', n: m.inProgress, label: 'In Progress', tone: 'blue' },
    { id: 'ready', n: m.ready, label: 'Ready to Start', tone: 'yellow' },
    { id: 'blocked', n: m.blocked, label: 'Blocked', tone: 'red' },
    { id: 'week', n: m.dueThisWeek, label: 'Due This Week', tone: 'amber' },
    { id: 'overdue', n: m.overdue, label: 'Overdue', tone: 'red' }
  ];
  const open = id => { setState({ jobFilter: active === id ? 'all' : id }); navigate(''); };
  return html`
    <div class="metrics">
      ${tiles.map(t => html`
        <button key=${t.id} class=${`metric tone-${t.tone}${active === t.id ? ' active' : ''}${t.n === 0 ? ' zero' : ''}`}
                onClick=${() => open(t.id)} aria-pressed=${active === t.id}>
          <span class="metric-n">${t.n}</span>
          <span class="metric-label">${t.label}</span>
        </button>`)}
    </div>`;
}
