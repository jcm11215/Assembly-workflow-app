/** Date helpers. All app date math funnels through here. */

export function todayISO(){ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }

export function daysUntil(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  const t = new Date(todayISO()+'T00:00:00');
  return Math.round((d-t)/86400000);
}

export function fmtDate(dateStr){
  if(!dateStr) return '--';
  const d = new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

export function fmtWhen(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.round((now-d)/60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins/60);
  if(hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' ' +
         d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

/* ================= ASSISTANT ================= */
