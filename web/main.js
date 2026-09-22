/**
 * Start-up: find out who is signed in, load the shop's data, open the
 * live update stream, and show the app -- or the sign-in screen.
 */
import { html, render } from './vendor/index.js';
import { api, setSignedOutHandler } from './lib/api.js';
import { useStore, setState, resetState } from './lib/store.js';
import { reloadState } from './lib/actions.js';
import { startLive, stopLive } from './lib/live.js';
import { Overlays, closeAllModals } from './ui/overlays.js';
import { AuthScreen } from './screens/Login.js';
import { Shell } from './app/Shell.js';

async function start(){
  try {
    const session = await api.get('/api/session');
    if(!session.user){
      setState({ phase: session.setupNeeded ? 'setup' : 'signed-out' });
      return;
    }
    await enter();
  } catch (e) {
    console.error(e);
    setState({ phase: 'unreachable' });
  }
}

async function enter(){
  await reloadState();
  startLive();
}

/** Any request that finds the session gone lands here. */
setSignedOutHandler(() => {
  stopLive();
  closeAllModals();
  resetState({ phase: 'signed-out' });
});

function Root(){
  const phase = useStore(s => s.phase);
  let body;
  if(phase === 'ready') body = html`<${Shell} />`;
  else if(phase === 'signed-out' || phase === 'setup'){
    body = html`<${AuthScreen} mode=${phase === 'setup' ? 'setup' : 'signin'} onSignedIn=${enter} />`;
  } else if(phase === 'unreachable'){
    body = html`
      <div class="auth"><div class="auth-card">
        <h1>Can't reach the server</h1>
        <p class="hint">The app couldn't reach the shop server. Check that this device is on the Tailscale network, then try again.</p>
        <button class="btn btn-primary btn-block" onClick=${() => { setState({ phase: 'starting' }); start(); }}>Try again</button>
      </div></div>`;
  } else {
    body = html`<div class="splash">Loading shop data…</div>`;
  }
  return html`${body}<${Overlays} />`;
}

render(html`<${Root} />`, document.getElementById('root'));
start();
