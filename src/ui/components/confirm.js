/**
 * Confirmation dialog for destructive actions.
 *
 * Replaces window.confirm(), which on Android draws a system dialog that
 * looks nothing like the app, ignores the shop-floor touch sizing, and
 * puts its buttons wherever the OS decides.
 *
 * A confirm usually covers a modal that's already open (delete reached
 * from the job detail sheet), and #modalRoot only holds one at a time --
 * so the covered modal's refresher is captured and re-opened on cancel,
 * rather than dumping the person back to the list they came from.
 */
import { closeModal, modalRefresh, openModal } from './modal.js';
import { escapeHtml } from '../../utils/dom.js';

let onYes = null;
let coveredRefresher = null;

export function confirmAction({ title, message, confirmLabel = 'Delete', onConfirm }){
  onYes = onConfirm || null;
  coveredRefresher = modalRefresh;
  openModal(`
    <div class="modal-sheet">
      <div class="modal-title">${escapeHtml(title)}</div>
      <div class="confirm-message">${escapeHtml(message)}</div>
      <div class="fab-row">
        <button class="btn btn-danger btn-block" data-action="confirm-yes">${escapeHtml(confirmLabel)}</button>
      </div>
      <div class="fab-row">
        <button class="btn btn-outline btn-block" data-action="confirm-no">Cancel</button>
      </div>
    </div>`);
}

/** Runs the pending action. The dialog closes first so the action's own
 *  toast/render isn't painted underneath it. */
export function acceptConfirm(){
  const fn = onYes;
  onYes = null; coveredRefresher = null;
  closeModal();
  if(fn) fn();
}

/** Dismisses, restoring whatever modal the dialog covered. */
export function dismissConfirm(){
  const back = coveredRefresher;
  onYes = null; coveredRefresher = null;
  if(back) openModal(back(), back);
  else closeModal();
}
