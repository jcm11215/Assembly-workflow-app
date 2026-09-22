/**
 * Hash routes, so every screen has a link and the phone's back gesture
 * works without the server knowing about routes:
 *
 *   #/            dashboard      #/jobs/<id>   a job's page
 *   #/board  #/blockers  #/errors  #/tasks  #/notes
 *   #/assistant  #/activity  #/admin
 */
import { useEffect, useState } from '../vendor/index.js';

export const TABS = ['dashboard', 'board', 'blockers', 'errors', 'tasks', 'notes', 'assistant', 'activity', 'admin'];

export function parseRoute(hash = location.hash){
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if(parts[0] === 'jobs' && parts[1]) return { name: 'job', id: decodeURIComponent(parts[1]) };
  if(TABS.includes(parts[0])) return { name: parts[0] };
  return { name: 'dashboard' };
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
      document.querySelector('main')?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
