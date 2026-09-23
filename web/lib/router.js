/**
 * Hash routes, so every screen has a link and the phone's back gesture
 * works without the server knowing about routes:
 *
 *   #/                 home           #/jobs/<id>   a job's page
 *   #/jobs             every job      #/jobs?view=board&filter=overdue
 *   #/issues           blockers and the error log (?tab=errors)
 *   #/tasks  #/notes  #/assistant  #/knowledge  #/team  #/activity  #/settings
 *
 * Links from before the redesign (#/board, #/blockers, #/errors, #/admin)
 * still land in the right place.
 */
import { useEffect, useState } from '../vendor/index.js';

export const SCREENS = ['home', 'jobs', 'issues', 'tasks', 'notes', 'assistant', 'knowledge', 'team', 'activity', 'settings'];

const ALIASES = {
  dashboard: { name: 'home' },
  board: { name: 'jobs', query: { view: 'board' } },
  blockers: { name: 'issues', query: { tab: 'blockers' } },
  errors: { name: 'issues', query: { tab: 'errors' } },
  admin: { name: 'team' }
};

export function parseRoute(hash = location.hash){
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const parts = path.split('/').filter(Boolean);
  if(parts[0] === 'jobs' && parts[1]) return { name: 'job', id: decodeURIComponent(parts[1]), query };
  if(ALIASES[parts[0]]) return { ...ALIASES[parts[0]], query: { ...(ALIASES[parts[0]].query || {}), ...query } };
  if(SCREENS.includes(parts[0])) return { name: parts[0], query };
  return { name: 'home', query };
}

export function navigate(to){
  const hash = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`;
  if(location.hash !== hash) location.hash = hash;
}

export const jobLink = id => `#/jobs/${encodeURIComponent(id)}`;

export function useRoute(){
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
