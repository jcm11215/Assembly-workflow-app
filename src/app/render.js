/** View router. Maps state.tab to the owning feature module. */


/* ================= RENDER ROUTER ================= */
import { renderActivity } from '../activity/index.js';
import { renderAssistant } from '../ai/assistantView.js';
import { renderBlockers } from '../blockers/index.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseReady } from '../db/config.js';
import { loadAll } from '../db/repository.js';
import { renderBoard } from '../jobs/board.js';
import { renderDashboard, renderMetrics } from '../jobs/dashboard.js';
import { renderNotes } from '../notes/index.js';
import { state } from '../state/store.js';

/**
 * A render replaces all of #content, which is the scroll container
 * (`main{overflow-y:auto}`) and holds the search inputs. Without this,
 * any realtime event from another device scrolled you back to the top and
 * dropped your cursor mid-word.
 */
let renderedTab = null;

function captureUiState(){
  const content = document.getElementById('content');
  const active = document.activeElement;
  const focused = active && active.id && content && content.contains(active) ? active : null;
  let selStart = null, selEnd = null;
  if(focused){
    // Reading selectionStart throws on input types that don't support it.
    try { selStart = focused.selectionStart; selEnd = focused.selectionEnd; } catch { /* not a text field */ }
  }
  return { scrollTop: content ? content.scrollTop : 0, focusId: focused ? focused.id : null, selStart, selEnd };
}

function restoreUiState(snap){
  // Only carry position across a re-render of the *same* view. Switching
  // tabs is a fresh view and should start at the top, as it did before.
  const sameTab = renderedTab === state.tab;
  renderedTab = state.tab;
  if(!sameTab) return;
  const content = document.getElementById('content');
  if(content && snap.scrollTop) content.scrollTop = snap.scrollTop;
  if(!snap.focusId) return;
  const el = document.getElementById(snap.focusId);
  if(!el) return;
  el.focus({ preventScroll: true });
  if(snap.selStart != null && el.setSelectionRange){
    try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch { /* not a text field */ }
  }
}

export function render(){
  const ui = captureUiState();
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.classList.toggle('active', b.getAttribute('data-tab')===state.tab);
  });
  if(!supabaseReady()){
    document.getElementById('metricsStrip').innerHTML = '';
    document.getElementById('content').innerHTML = `
      <div class="focus-banner" style="margin-top:20px;">
        <div class="focus-banner-head">Setup Needed</div>
        <div style="font-size:13px;line-height:1.5;">
          This app isn't connected to its data store yet. If you're setting this up: create a Supabase project,
          set SUPABASE_URL and SUPABASE_ANON_KEY near the top of this file, then republish. If you're
          not the one who set this up, let them know this message is showing.
        </div>
      </div>`;
    return;
  }
  renderMetrics();
  if(state.tab==='dashboard') renderDashboard();
  else if(state.tab==='board') renderBoard();
  else if(state.tab==='blockers') renderBlockers();
  else if(state.tab==='notes') renderNotes();
  else if(state.tab==='assistant') renderAssistant();
  else if(state.tab==='activity') renderActivity();
  restoreUiState(ui);
}

export function updateDateSub(){
  const el = document.getElementById('dateSub');
  const now = new Date();
  const hr = now.getHours();
  const shift = hr < 14 ? 'Day Shift' : hr < 22 ? 'Afternoon Shift' : 'Night Shift';
  el.textContent = `${shift} \u2014 ${now.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})}`;
}
