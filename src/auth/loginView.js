/**
 * Login screen. Replaces the first-run name modal when AUTH_ENABLED is
 * true. Uses the same non-dismissible pattern the name-gate used -- no
 * data-close-overlay, so there is no way to interact with the app before
 * authenticating.
 */
import { signIn, requestPasswordReset, toLoginEmail } from './authService.js';
import { showSignup, handleSignupAction } from './signupView.js';
import { showToast } from '../ui/components/toast.js';

let onSuccess = null;

function loginHtml(mode){
  if(mode === 'reset'){
    return `
    <div class="modal-sheet">
      <div class="modal-title">Reset Password</div>
      <div class="bp-hint" style="margin-bottom:10px;">
        Enter your email and we will send a reset link. If you sign in with a username rather than an
        email, ask a supervisor to reset it for you &mdash; there's no inbox to send a link to.
      </div>
      <form id="resetForm">
        <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
        <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Send Reset Link</button></div>
      </form>
      <div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="login-back">Back to Sign In</button></div>
    </div>`;
  }
  return `
  <div class="modal-sheet">
    <div class="modal-title">Sign In</div>
    <div class="bp-hint" style="margin-bottom:10px;">Sign in to Assembly Workflow Tracker.</div>
    <form id="loginForm">
      <div class="field"><label>Username or Email</label>
        <input name="email" required autocomplete="username" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"></div>
      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Sign In</button></div>
    </form>
    <div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="login-signup">Create Account</button></div>
    <div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="login-forgot">Forgot Password?</button></div>
  </div>`;
}

function paint(mode){
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay auth-screen"><div class="auth-stack">
      <div class="auth-brand">
        <img class="auth-logo" src="./src/assets/isc-mfg-logo.webp" alt="ISC Manufacturing" width="88" height="88">
        <div class="auth-name">Assembly Workflow Tracker</div>
        <div class="auth-sub">Industrial Screw Conveyors</div>
      </div>
      ${loginHtml(mode)}
    </div></div>`;
  const login = document.getElementById('loginForm');
  if(login) login.addEventListener('submit', handleLogin);
  const reset = document.getElementById('resetForm');
  if(reset) reset.addEventListener('submit', handleReset);
  const first = root.querySelector('input');
  if(first) setTimeout(() => first.focus(), 50);
}

async function handleLogin(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = (fd.get('email') || '').trim();
  const password = fd.get('password') || '';
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Signing in...';
  try {
    await signIn(toLoginEmail(email), password);
    document.getElementById('modalRoot').innerHTML = '';
    if(onSuccess) onSuccess();
  } catch (err) {
    showToast(err.message || 'Sign in failed', 5000);
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

async function handleReset(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const email = (fd.get('email') || '').trim();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    await requestPasswordReset(email);
    showToast('Reset link sent -- check your email');
    paint('login');
  } catch (err) {
    showToast(err.message || 'Could not send the reset email', 5000);
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
}

/** Wired from the global event router; returns true if it handled the action. */
export function handleLoginAction(action){
  if(action === 'login-forgot'){ paint('reset'); return true; }
  if(action === 'login-back'){ paint('login'); return true; }
  if(action === 'login-signup'){ showSignup(onSuccess); return true; }
  return false;
}

/** The signup screen lives inside the same overlay, so the login router owns its actions too. */
export function handleAuthScreenAction(action){
  if(action === 'signup-back'){ paint('login'); return true; }
  if(action.startsWith('signup-')) return handleSignupAction(action);
  return handleLoginAction(action);
}

/** callback runs once sign-in succeeds. */
export function showLogin(callback){
  onSuccess = callback;
  paint('login');
}
