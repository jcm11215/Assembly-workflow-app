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

export function render(){
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
}

export function updateDateSub(){
  const el = document.getElementById('dateSub');
  const now = new Date();
  const hr = now.getHours();
  const shift = hr < 14 ? 'Day Shift' : hr < 22 ? 'Afternoon Shift' : 'Night Shift';
  el.textContent = `${shift} \u2014 ${now.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'})}`;
}
