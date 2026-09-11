/**
 * Account creation screen. Reached from the login screen, and shares its
 * non-dismissible overlay -- there is nothing to see behind it until an
 * account exists.
 *
 * Two ways in, because half the floor has a work email and half doesn't:
 * a plain username, or a real email address. Everyone sets their own
 * password. Everyone lands as an 'assembler'; promoting someone to lead
 * or admin is a separate, deliberate act.
 */
import { createAccount } from './authService.js';
import { showToast } from '../ui/components/toast.js';

let onSuccess = null;
let mode = 'username';          // 'username' | 'email'

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const MIN_PASSWORD = 8;

function loginFieldHtml(){
  if(mode === 'email'){
    return `
      <div class="field">
        <label>Work Email</label>
        <input type="email" name="loginId" required autocomplete="username" placeholder="you@company.com">
      </div>
      <div class="bp-hint" style="margin:-4px 0 10px;">You'll be able to reset your own password by email.</div>`;
  }
  return `
    <div class="field">
      <label>Username</label>
      <input name="loginId" required autocomplete="username" placeholder="e.g. dreyes"
             autocapitalize="off" spellcheck="false">
    </div>
    <div class="bp-hint" style="margin:-4px 0 10px;">
      Letters, numbers, dots and dashes. No email needed &mdash; but a lost password has to be reset for you.
    </div>`;
}

function signupHtml(){
  return `
  <div class="modal-sheet">
    <div class="modal-title">Create Account</div>
    <div class="bp-hint" style="margin-bottom:10px;">
      You need the shop access code from your supervisor to create an account.
    </div>
    <form id="signupForm">
      <div class="field"><label>Your Name</label>
        <input name="fullName" required placeholder="e.g. D. Reyes" autocomplete="name"></div>

      <div class="field"><label>Sign in with</label>
        <div class="fab-row">
          <button type="button" class="btn ${mode === 'username' ? 'btn-primary' : 'btn-outline'}"
                  data-action="signup-mode-username">A Username</button>
          <button type="button" class="btn ${mode === 'email' ? 'btn-primary' : 'btn-outline'}"
                  data-action="signup-mode-email">An Email</button>
        </div>
      </div>

      ${loginFieldHtml()}

      <div class="field"><label>Password</label>
        <input type="password" name="password" required autocomplete="new-password"
               minlength="${MIN_PASSWORD}"></div>
      <div class="field"><label>Confirm Password</label>
        <input type="password" name="confirm" required autocomplete="new-password"></div>
      <div class="field"><label>Shop Access Code</label>
        <input name="accessCode" required autocomplete="off" spellcheck="false"></div>

      <div class="fab-row"><button type="submit" class="btn btn-primary btn-block">Create Account</button></div>
    </form>
    <div class="fab-row"><button type="button" class="btn btn-outline btn-block" data-action="signup-back">Back to Sign In</button></div>
  </div>`;
}

function paint(){
  const root = document.getElementById('modalRoot');
  // Switching username/email repaints the form; carry what was already
  // typed across so the choice isn't punished by retyping everything.
  const prev = document.getElementById('signupForm');
  const kept = prev ? Object.fromEntries(new FormData(prev)) : {};
  delete kept.loginId;

  root.innerHTML = `
    <div class="modal-overlay auth-screen"><div class="auth-stack">
      <div class="auth-brand">
        <img class="auth-logo" src="./src/assets/isc-mfg-logo.webp" alt="ISC Manufacturing" width="88" height="88">
        <div class="auth-name">Assembly Workflow Tracker</div>
        <div class="auth-sub">Industrial Screw Conveyors</div>
      </div>
      ${signupHtml()}
    </div></div>`;
  const form = document.getElementById('signupForm');
  form.addEventListener('submit', handleSignup);
  for(const [name, value] of Object.entries(kept)){
    const input = form.elements[name];
    if(input) input.value = value;
  }
  const focus = prev ? form.elements.loginId : root.querySelector('input');
  if(focus) setTimeout(() => focus.focus(), 50);
}

/** Returns an error string, or null when the form is good to send. */
function validate({ fullName, loginId, password, confirm, accessCode }){
  if(!fullName) return 'Enter your name.';
  if(!accessCode) return 'Enter the shop access code.';
  if(password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if(password !== confirm) return 'The two passwords do not match.';
  if(mode === 'email'){
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginId)) return 'Enter a valid email address.';
  } else {
    if(loginId.includes('@')) return 'Pick "An Email" above to sign in with an email address.';
    if(!USERNAME_RE.test(loginId.toLowerCase())){
      return 'Username must be 3-30 characters: letters, numbers, dots or dashes.';
    }
  }
  return null;
}

async function handleSignup(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  const fields = {
    fullName: (fd.get('fullName') || '').trim(),
    loginId: (fd.get('loginId') || '').trim(),
    password: fd.get('password') || '',
    confirm: fd.get('confirm') || '',
    accessCode: (fd.get('accessCode') || '').trim()
  };

  const problem = validate(fields);
  if(problem){ showToast(problem, 5000); return; }

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Creating account...';
  try {
    await createAccount(fields);
    document.getElementById('modalRoot').innerHTML = '';
    showToast(`Welcome, ${fields.fullName} -- you sign in as ${fields.loginId.toLowerCase()}`, 6000);
    if(onSuccess) onSuccess();
  } catch (err) {
    showToast(err.message || 'Could not create the account', 6000);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

/** Wired from the global event router; returns true if it handled the action. */
export function handleSignupAction(action){
  if(action === 'signup-mode-username'){ mode = 'username'; paint(); return true; }
  if(action === 'signup-mode-email'){ mode = 'email'; paint(); return true; }
  return false;
}

/** callback runs once the account is created and signed in. */
export function showSignup(callback){
  onSuccess = callback;
  mode = 'username';
  paint();
}
