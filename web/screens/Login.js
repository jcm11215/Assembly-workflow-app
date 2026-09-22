/**
 * The screens before the app: sign in, create an account with the shop
 * access code, and -- on a brand-new server -- set up the first admin.
 */
import { html, useState } from '../vendor/index.js';
import { signIn, signUp, setUp } from '../lib/actions.js';
import { Field, submitting } from '../ui/kit.js';
import { toast } from '../ui/overlays.js';

const USERNAME_HINT = 'A username (letters, numbers, dots, dashes) or your work email.';

export function AuthScreen({ mode: initialMode, onSignedIn }){
  const [mode, setMode] = useState(initialMode);

  return html`
    <div class="auth">
      <div class="auth-brand">
        <img src="/assets/isc-mfg-logo.webp" alt="ISC Manufacturing" width="88" height="88" />
        <div class="auth-name">Assembly Workflow Tracker</div>
        <div class="auth-sub">Industrial Screw Conveyors</div>
      </div>
      <div class="auth-card">
        ${mode === 'setup' && html`<${SetupForm} onDone=${onSignedIn} />`}
        ${mode === 'signin' && html`<${SignInForm} onDone=${onSignedIn} onSignUp=${() => setMode('signup')} />`}
        ${mode === 'signup' && html`<${SignUpForm} onDone=${onSignedIn} onBack=${() => setMode('signin')} />`}
      </div>
    </div>`;
}

function SignInForm({ onDone, onSignUp }){
  const [forgot, setForgot] = useState(false);
  return html`
    <h1>Sign in</h1>
    <form onSubmit=${submitting(async v => { await signIn(v.login, v.password); onDone(); })}>
      <${Field} label="Username or email">
        <input name="login" required autocomplete="username" autocapitalize="off" spellcheck="false" />
      <//>
      <${Field} label="Password">
        <input name="password" type="password" required autocomplete="current-password" />
      <//>
      <button type="submit" class="btn btn-primary btn-block">Sign in</button>
    </form>
    <button type="button" class="btn btn-block" onClick=${onSignUp}>Create an account</button>
    <button type="button" class="link-btn" onClick=${() => setForgot(!forgot)}>Forgot your password?</button>
    ${forgot && html`<p class="hint">Ask an admin to set a new one for you -- they can do it from the Admin screen, under Team.</p>`}`;
}

function SignUpForm({ onDone, onBack }){
  const submit = submitting(async v => {
    if(v.password !== v.confirm) throw new Error('The two passwords do not match.');
    await signUp({ fullName: v.fullName, login: v.login, password: v.password, accessCode: v.accessCode });
    toast(`Welcome, ${v.fullName}. You sign in as ${v.login.trim().toLowerCase()}.`, { ms: 6000, kind: 'ok' });
    onDone();
  });
  return html`
    <h1>Create an account</h1>
    <p class="hint">You need the shop access code from your supervisor.</p>
    <form onSubmit=${submit}>
      <${Field} label="Your name"><input name="fullName" required autocomplete="name" placeholder="e.g. D. Reyes" /><//>
      <${Field} label="Username" hint=${USERNAME_HINT}>
        <input name="login" required autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="e.g. dreyes" />
      <//>
      <${Field} label="Password" hint="At least 8 characters.">
        <input name="password" type="password" required minlength="8" autocomplete="new-password" />
      <//>
      <${Field} label="Confirm password"><input name="confirm" type="password" required autocomplete="new-password" /><//>
      <${Field} label="Shop access code"><input name="accessCode" required autocomplete="off" spellcheck="false" /><//>
      <button type="submit" class="btn btn-primary btn-block">Create account</button>
    </form>
    <button type="button" class="btn btn-block" onClick=${onBack}>Back to sign in</button>`;
}

function SetupForm({ onDone }){
  const submit = submitting(async v => {
    if(v.password !== v.confirm) throw new Error('The two passwords do not match.');
    await setUp({ setupCode: v.setupCode, fullName: v.fullName, login: v.login, password: v.password });
    toast('Set up. Add your team from the Admin screen.', { ms: 6000, kind: 'ok' });
    onDone();
  });
  return html`
    <h1>Set up this server</h1>
    <p class="hint">
      No accounts exist yet. Create the first admin account. The setup code is printed in the
      server's log (<code>journalctl -u assembly-workflow</code>).
    </p>
    <form onSubmit=${submit}>
      <${Field} label="Setup code"><input name="setupCode" required autocomplete="off" spellcheck="false" autocapitalize="characters" /><//>
      <${Field} label="Your name"><input name="fullName" required autocomplete="name" /><//>
      <${Field} label="Username" hint=${USERNAME_HINT}>
        <input name="login" required autocomplete="username" autocapitalize="off" spellcheck="false" />
      <//>
      <${Field} label="Password" hint="At least 8 characters.">
        <input name="password" type="password" required minlength="8" autocomplete="new-password" />
      <//>
      <${Field} label="Confirm password"><input name="confirm" type="password" required autocomplete="new-password" /><//>
      <button type="submit" class="btn btn-primary btn-block">Create admin account</button>
    </form>`;
}
