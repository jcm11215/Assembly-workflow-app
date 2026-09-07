/** Transient notifications. */


/* ---------------- Toast ---------------- */
import { escapeHtml } from '../../utils/dom.js';

export let toastTimer=null;

export function showToast(msg, duration){
  const root = document.getElementById('toastRoot');
  root.innerHTML = `<div class="toast">${escapeHtml(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ root.innerHTML=''; }, duration || 2200);
}

export function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(()=>showToast('Copied to clipboard')).catch(()=>showToast('Could not copy'));
  }else{
    showToast('Copy not supported on this device');
  }
}
