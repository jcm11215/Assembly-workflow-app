/** A component fetched on first use: `lazy(() => import('./X.js'), 'X')`. */
import { html, useEffect, useState } from '../vendor/index.js';

export function lazy(load, exportName){
  let loaded = null;
  return function Lazy(props){
    const [Component, setComponent] = useState(() => loaded);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if(Component) return;
      load().then(mod => { loaded = mod[exportName]; setComponent(() => loaded); })
        .catch(e => { console.error(e); setFailed(true); });
    }, []);
    if(failed) return html`<div class="empty">Could not load this screen. Check the connection and try again.</div>`;
    if(!Component) return html`<div class="empty">Loading…</div>`;
    return html`<${Component} ...${props} />`;
  };
}
