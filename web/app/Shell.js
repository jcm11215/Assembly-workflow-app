/**
 * The frame around every screen: a sidebar on wide screens; on a phone a
 * top bar and five tabs along the bottom, with the rest under "More".
 */
import { html, useEffect } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { useRoute } from '../lib/router.js';
import { can } from '../../shared/roles.js';
import { roleLabel } from '../../shared/roles.js';
import { Icon } from '../ui/icons.js';
import { initials, Logo } from '../ui/kit.js';
import { openModal, Sheet } from '../ui/overlays.js';
import { lazy } from '../ui/lazy.js';

import { Home } from '../screens/Home.js';
import { Jobs } from '../screens/Jobs.js';
import { JobPage } from '../screens/JobPage.js';
import { Issues } from '../screens/Issues.js';
import { Tasks } from '../screens/Tasks.js';
import { Notes } from '../screens/Notes.js';
import { Settings } from '../screens/Settings.js';

// The heavy, occasional screens are fetched the first time they open.
const Assistant = lazy(() => import('../screens/Assistant.js'), 'Assistant');
const Knowledge = lazy(() => import('../screens/Knowledge.js'), 'Knowledge');
const Team = lazy(() => import('../screens/Admin.js'), 'Admin');
const Activity = lazy(() => import('../screens/Activity.js'), 'Activity');

const NAV = [
  { id: 'home', label: 'Home', icon: 'home', href: '#/' },
  { id: 'jobs', label: 'Jobs', icon: 'jobs' },
  { id: 'issues', label: 'Issues', icon: 'issues' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'assistant', label: 'Assistant', icon: 'sparkle' },
  { group: 'Admin', perm: 'team.manage' },
  { id: 'knowledge', label: 'Knowledge', icon: 'book', perm: 'knowledge.manage' },
  { id: 'team', label: 'Team', icon: 'team', perm: 'team.manage' },
  { id: 'activity', label: 'Activity', icon: 'activity', perm: 'activity.all' }
];
const TABS = ['home', 'jobs', 'issues', 'tasks'];

const SCREENS = { home: Home, jobs: Jobs, issues: Issues, tasks: Tasks, notes: Notes, assistant: Assistant,
                  knowledge: Knowledge, team: Team, activity: Activity, settings: Settings };
const TITLES = { home: 'Home', jobs: 'Jobs', job: 'Job', issues: 'Issues', tasks: 'Tasks', notes: 'Notes', assistant: 'Assistant',
                 knowledge: 'Knowledge', team: 'Team', activity: 'Activity', settings: 'Settings' };

const hrefOf = n => n.href || `#/${n.id}`;

export function Shell(){
  const route = useRoute();
  const me = useStore(s => s.me);
  const connection = useStore(s => s.connection);
  const hasBlocked = useStore(s => s.blockers.some(b => b.status !== 'Resolved'));
  const allowed = NAV.filter(n => !n.perm || can(me.role, n.perm));
  const current = route.name === 'job' ? 'jobs' : route.name;

  useEffect(() => { document.title = `${TITLES[route.name] || 'Home'} · Assembly Workflow`; }, [route.name]);

  const Screen = SCREENS[route.name] || Home;
  const dot = n => n.id === 'issues' && hasBlocked && html`<span class="dot" aria-label="open blockers"></span>`;

  return html`
    <div class="app">
      <aside class="sidebar">
        <a class="brand" href="#/" aria-label="Assembly Workflow home">
          <${Logo} class="brand-logo" />
          <span class="brand-app">Assembly<br />Workflow</span>
        </a>
        <nav class="nav" aria-label="Main">
          ${allowed.map((n, i) => n.group
            ? html`<div key=${`g${i}`} class="nav-group">${n.group}</div>`
            : html`<a key=${n.id} href=${hrefOf(n)} class=${`nav-link${current === n.id ? ' active' : ''}`}
                      aria-current=${current === n.id ? 'page' : undefined}>
                     <${Icon} name=${n.icon} size=${20} /><span>${n.label}</span>${dot(n)}
                   </a>`)}
        </nav>
        <a class="me" href="#/settings" title="Settings">
          <span class="avatar">${initials(me.fullName)}</span>
          <span class="me-text">
            <span class="me-name">${me.fullName}</span>
            <span class="me-role"><span class=${`conn conn-${connection}`} title=${connection === 'live' ? 'Connected' : 'Reconnecting…'}></span>${roleLabel(me.role)}</span>
          </span>
          <${Icon} name="settings" size=${18} />
        </a>
      </aside>

      <header class="topbar">
        <a href="#/" class="topbar-home" aria-label="Home"><${Logo} class="topbar-logo" /></a>
        <div class="topbar-title">${TITLES[route.name] || 'Home'}</div>
        <span class=${`conn conn-${connection}`} title=${connection === 'live' ? 'Connected' : 'Reconnecting…'}></span>
        <a class="avatar" href="#/settings" aria-label="Settings">${initials(me.fullName)}</a>
      </header>

      <main id="main">
        <div class="page">
          ${route.name === 'job'
            ? html`<${JobPage} id=${route.id} key=${route.id} />`
            : html`<${Screen} query=${route.query} key=${`${route.name}?${new URLSearchParams(route.query)}`} />`}
        </div>
      </main>

      <nav class="tabbar" aria-label="Main">
        ${TABS.map(id => allowed.find(n => n.id === id)).filter(Boolean).map(n => html`
          <a key=${n.id} href=${hrefOf(n)} class=${`tab-btn${current === n.id ? ' active' : ''}`} aria-current=${current === n.id ? 'page' : undefined}>
            <${Icon} name=${n.icon} size=${22} /><span>${n.label}</span>${dot(n)}
          </a>`)}
        <button type="button" class=${`tab-btn${!TABS.includes(current) && current !== 'home' ? ' active' : ''}`}
                onClick=${() => openModal(MoreSheet, { items: allowed.filter(n => !n.group && !TABS.includes(n.id)) })}>
          <${Icon} name="menu" size=${22} /><span>More</span>
        </button>
      </nav>
    </div>`;
}

/** Everything that isn't a bottom tab, on a phone. */
function MoreSheet({ items, close }){
  const go = () => close();
  return html`
    <${Sheet} title="More" close=${close} small>
      <div class="stage-picker">
        ${[...items, { id: 'settings', label: 'Settings', icon: 'settings' }].map(n => html`
          <a key=${n.id} class="btn" href=${hrefOf(n)} onClick=${go} style=${{ justifyContent: 'flex-start' }}>
            <${Icon} name=${n.icon} />${n.label}
          </a>`)}
      </div>
    <//>`;
}
