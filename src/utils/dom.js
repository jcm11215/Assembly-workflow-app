/** DOM + formatting helpers. No app state, no imports from app modules. */




export function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function datalistHtml(id, values){
  return `<datalist id="${id}">${values.map(v=>`<option value="${escapeHtml(v)}">`).join('')}</datalist>`;
}



/* ---------------- Modal helpers ---------------- */
// Modals that need to update themselves in place (checklist toggles, a
// stage advancing while its detail view is open) register a refresher
// here instead of hardcoding which modal to redraw.
