/**
 * Global event router. All UI interaction funnels through delegated
 * listeners bound once at boot -- no per-render listener churn.
 * Handlers here only orchestrate; every mutation lives in a feature module.
 */
import { loadActivity, updateActivityList } from '../activity/index.js';
import { sendChat } from '../ai/assistant.js';
import { goToAssistantWithPrompt, sendActionRequest, confirmProposedAction, cancelProposedAction } from '../ai/assistantView.js';
import { setAiProvider, setApiKey, setOpenRouterKey } from '../ai/keys.js';
import { render } from './render.js';
import { openBlockerForm, updateBlockersList } from '../blockers/index.js';
import { extractComponents, extractNewJobFromBlueprint } from '../blueprints/extract.js';
import { openBlueprintFullscreen, openBlueprintModal, openNewJobBlueprintModal, verificationReportHtml } from '../blueprints/ui.js';
import { logActivity, persistBlockers, persistJobs, reloadFromStorage } from '../db/repository.js';
import { attemptAdvance, confirmAdvance, moveJobToStage, openMover, stepStage } from '../jobs/actions.js';
import { updateDashboardList } from '../jobs/dashboard.js';
import { openJobDetail } from '../jobs/detail.js';
import { openJobForm } from '../jobs/jobForm.js';
import { toggleStageChecklistItem } from '../jobs/stageGate.js';
import { MODEL_MODES, disposeModel, modelMode, modelState, setModelMode, showDimensions, toggleModelPart, toggleShowDimensions } from '../models/geometry.js';
import { openNoteForm, updateNotesList } from '../notes/index.js';
import { setSelectedBlueprintFile, state } from '../state/store.js';
import { closeModal, modalRefresh, openModal, refreshOpenModal, setModalRefresh } from '../ui/components/modal.js';
import { copyToClipboard, showToast } from '../ui/components/toast.js';
import { openSettingsModal } from '../ui/settings.js';
import { escapeHtml } from '../utils/dom.js';
import { openMigrationDashboard, handleMigrationAction } from '../admin/migrationDashboard.js';
import { handleLoginAction } from '../auth/loginView.js';
import { signOut } from '../auth/authService.js';
import { stopJobsRealtime } from '../realtime/jobsRealtime.js';
import { stopBlockersRealtime } from '../realtime/blockersRealtime.js';
import { stopNotesRealtime } from '../realtime/notesRealtime.js';
import { stopActivityRealtime } from '../realtime/activityRealtime.js';
import { disconnectAll } from '../realtime/realtimeClient.js';
import * as blueprintsRepo from '../db/blueprintsRepo.js';
import { openVersionHistory, toggleCompareSelection, compareModalHtml } from '../blueprints/ui.js';
import { openHealthDashboard, refreshHealthDashboard } from '../admin/healthDashboard.js';


export function initEventRouter(){
  document.addEventListener('click', e=>{
    const btn = e.target.closest('[data-action]');
    const tabBtn = e.target.closest('.tab-btn');
    if(tabBtn){
      state.tab = tabBtn.getAttribute('data-tab');
      render();
      window.scrollTo(0,0);
      return;
    }
    if(!btn) return;
    const action = btn.getAttribute('data-action');

  // Migration diagnostics own their own action namespace.
  if(action.startsWith('mig-')){ handleMigrationAction(action, btn); return; }
  if(action === 'open-migration'){ openMigrationDashboard(); return; }
  if(action === 'open-health'){ openHealthDashboard(); return; }
  if(action === 'health-refresh'){ refreshHealthDashboard(); return; }

  // Login screen owns its own namespace too.
  if(action.startsWith('login-')){ handleLoginAction(action); return; }
  if(action === 'account-sign-out'){
    stopJobsRealtime(); stopBlockersRealtime(); stopNotesRealtime(); stopActivityRealtime();
    disconnectAll();
    signOut().then(() => window.location.reload());
    return;
  }
    const id = btn.getAttribute('data-id');

    switch(action){
      case 'open-settings':
        openSettingsModal();
        break;
      case 'clear-api-key':
        setApiKey('');
        closeModal();
        showToast('API key removed');
        break;
      case 'clear-openrouter-key':
        setOpenRouterKey('');
        closeModal();
        showToast('OpenRouter key removed');
        break;
      case 'set-ai-provider':
        setAiProvider(btn.getAttribute('data-provider'));
        openSettingsModal(); // re-render so the right key section shows
        break;
      case 'bp-approve':
        blueprintsRepo.approveVersion(id).then((row)=>{
          logActivity('Blueprint approved', { jobNumber: state.jobs.find(j=>j.blueprintId===id)?.jobNumber || '', version: row && row.version }, {type:'blueprint', id});
          showToast('Blueprint version approved');
          reloadFromStorage(false);
        }).catch(e=>showToast(`Could not approve: ${e.message}`, 5000));
        break;
      case 'bp-reject':
        blueprintsRepo.rejectVersion(id).then((row)=>{
          logActivity('Blueprint rejected', { jobNumber: state.jobs.find(j=>j.blueprintId===id)?.jobNumber || '', version: row && row.version }, {type:'blueprint', id});
          showToast('Blueprint version rejected');
          reloadFromStorage(false);
        }).catch(e=>showToast(`Could not reject: ${e.message}`, 5000));
        break;
      case 'bp-show-versions':
        openVersionHistory(id);
        break;
      case 'bp-toggle-compare':
        toggleCompareSelection(id);
        refreshOpenModal();
        break;
      case 'bp-compare': {
        // compareSelection lives in ui.js; read it back via the two
        // checked boxes currently rendered rather than re-importing state.
        const checked = [...document.querySelectorAll('[data-action="bp-toggle-compare"]:checked')]
          .map(el => el.getAttribute('data-id'));
        if(checked.length !== 2){ showToast('Select exactly two versions to compare'); break; }
        blueprintsRepo.compareVersions(checked[0], checked[1]).then(diff=>{
          openModal(compareModalHtml(diff));
        }).catch(e=>showToast(`Could not compare: ${e.message}`, 5000));
        break;
      }
      case 'refresh-activity':
        loadActivity();
        showToast('Activity refreshed');
        break;
      case 'manual-sync':
        reloadFromStorage(true);
        break;
      case 'goto-filter':
        state.tab = 'dashboard';
        state.jobFilter = btn.getAttribute('data-filter');
        render();
        window.scrollTo(0,0);
        break;
      case 'filter-jobs':
        state.jobFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#jobFilterChips .chip').forEach(c=>c.classList.toggle('active', c.getAttribute('data-filter')===state.jobFilter));
        updateDashboardList();
        break;
      case 'filter-blockers':
        state.blockerFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#blockerFilterChips .chip').forEach(c=>c.classList.toggle('active', c.getAttribute('data-filter')===state.blockerFilter));
        updateBlockersList();
        break;
      case 'new-job':
        openJobForm(null);
        break;
      case 'new-job-from-blueprint':
        openNewJobBlueprintModal();
        break;
      case 'edit-job':
        openJobForm(id);
        break;
      case 'open-job-detail':
        openJobDetail(id);
        break;
      case 'delete-job': {
        const job = state.jobs.find(j=>j.id===id);
        if(job && confirm(`Delete job ${job.jobNumber}? This cannot be undone.`)){
          state.jobs = state.jobs.filter(j=>j.id!==id);
          persistJobs();
          logActivity('Job deleted', `${job.jobNumber} (${job.customer})`);
          closeModal();
          showToast('Job deleted');
          render();
        }
        break;
      }
      case 'attempt-advance':
        attemptAdvance(id);
        break;
      case 'report-blocker':
        openBlockerForm(btn.getAttribute('data-jobnumber'));
        break;
      case 'new-blocker':
        openBlockerForm(null);
        break;
      case 'delete-blocker': {
        const delBlk = state.blockers.find(b=>b.id===id);
        state.blockers = state.blockers.filter(b=>b.id!==id);
        persistBlockers();
        if(delBlk) logActivity('Blocker deleted', `${delBlk.jobNumber}: ${delBlk.issueDescription}`);
        showToast('Blocker deleted');
        render();
        break;
      }
      case 'cycle-blocker-status': {
        const b = state.blockers.find(b=>b.id===id);
        if(b){
          const order = ['Open','In Progress','Resolved'];
          const next = order[(order.indexOf(b.status)+1) % order.length];
          b.status = next;
          persistBlockers();
          logActivity('Blocker status changed', `${b.jobNumber}: ${next} -- ${b.issueDescription}`);
          showToast(`Status: ${next}`);
          render();
        }
        break;
      }
      case 'new-note':
        openNoteForm(null);
        break;
      case 'stage-prev':
        stepStage(id, -1);
        break;
      case 'open-mover':
        openMover(id);
        break;
      case 'pick-stage': {
        // Previously called moveJobToStage() directly and always closed the
        // modal -- the checklist bypass. Now it is validated like every
        // other path, and the picker stays open if the move is refused.
        const verdict = moveJobToStage(id, btn.getAttribute('data-stage'), { openGateOnBlock:true });
        if(verdict.allowed) closeModal();
        break;
      }
      case 'quick-prompt':
        sendChat(btn.getAttribute('data-prompt'));
        break;
      case 'send-chat':
        sendChat();
        break;
      case 'send-ai-action':
        sendActionRequest();
        break;
      case 'confirm-ai-action':
        confirmProposedAction(btn.getAttribute('data-proposal-id'));
        break;
      case 'cancel-ai-action':
        cancelProposedAction(btn.getAttribute('data-proposal-id'));
        break;
      case 'copy-msg': {
        const idx = parseInt(btn.getAttribute('data-index'),10);
        const msg = state.chat[idx];
        if(msg) copyToClipboard(msg.text);
        break;
      }
      case 'ask-ai-focus':
        goToAssistantWithPrompt('What should the team focus on today?');
        break;
      case 'open-blueprint-fullscreen':
        openBlueprintFullscreen(id);
        break;
      case 'set-model-mode':
        setModelMode(btn.getAttribute('data-mode')==='assembly' ? MODEL_MODES.assembly : MODEL_MODES.engineering);
        if(modelState && modelState.applyMode) modelState.applyMode();
        document.querySelectorAll('[data-action="set-model-mode"]').forEach(el=>{
          el.classList.toggle('active', el.getAttribute('data-mode')===modelMode);
        });
        break;
      case 'toggle-dimensions': {
        const nowShowing = toggleShowDimensions();
        if(modelState && modelState.dimGroup) modelState.dimGroup.visible = nowShowing;
        btn.classList.toggle('active', nowShowing);
        break;
      }
      case 'show-verification': {
        const vjob = state.jobs.find(j=>j.id===id);
        if(vjob){
          const prev = modalRefresh, prevHtml = document.getElementById('modalRoot').innerHTML;
          disposeModel();
          document.getElementById('modalRoot').innerHTML =
            `<div class="modal-overlay" data-close-overlay>${verificationReportHtml(vjob)}</div>`;
          setModalRefresh(()=>verificationReportHtml(vjob));
        }
        break;
      }
      case 'toggle-model-part':
        toggleModelPart(btn.getAttribute('data-part'));
        break;
      case 'open-blueprint':
        openBlueprintModal(id);
        break;
      case 'extract-bom':
        extractComponents(id);
        break;
      case 'extract-new-job':
        extractNewJobFromBlueprint();
        break;
      case 'toggle-stage-checklist-item':
        toggleStageChecklistItem(id, btn.getAttribute('data-key'));
        break;
      case 'confirm-advance':
        confirmAdvance(id);
        break;
    }
  });
  document.addEventListener('change', e=>{
    if(e.target.id === 'bpFileInput'){
      const file = e.target.files[0];
      setSelectedBlueprintFile(file || null);
      const btn = document.getElementById('bpExtractBtn');
      const preview = document.getElementById('bpPreviewArea');
      if(!file){
        if(btn) btn.disabled = true;
        if(preview) preview.innerHTML = '';
        return;
      }
      if(btn){ btn.disabled = false; btn.textContent = 'Extract Components'; }
      if(preview){
        if(file.type === 'application/pdf'){
          preview.innerHTML = `<div class="bp-file-chip">&#128196; ${escapeHtml(file.name)}</div>`;
        }else{
          const url = URL.createObjectURL(file);
          preview.innerHTML = `<img src="${url}" class="bp-preview-img" alt="Blueprint preview">`;
        }
      }
    }
  });
  document.addEventListener('input', e=>{
    if(e.target.id==='dashSearch'){
      state.jobSearch = e.target.value;
      updateDashboardList();
    }else if(e.target.id==='noteSearch'){
      state.noteSearch = e.target.value;
      updateNotesList();
    }else if(e.target.id==='actSearch'){
      state.activitySearch = e.target.value;
      updateActivityList();
    }
  });
  document.addEventListener('keydown', e=>{
    if(e.key==='Enter' && e.target.id==='chatInput'){
      e.preventDefault();
      sendChat();
    }
  });

}
