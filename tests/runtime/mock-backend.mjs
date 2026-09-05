// Mock Supabase: PostgREST + Storage + GoTrue + Gemini.
export const DB = {
  jobs: [], job_checklist: [], blockers: [], notes: [],
  activity_log: [], profiles: [{id:'u-lead', full_name:'Test Lead', role:'lead', active:true}],
  blueprints: [], blueprint_components: [], app_data: []
};
export const CALLS = [];
let seq = 0;
const uid = p => `${p}-${++seq}`;

function parseFilters(qs){
  const f = {};
  for(const [k,v] of new URLSearchParams(qs)){
    if(['select','order','limit','offset','on_conflict'].includes(k)) continue;
    const m = /^(eq|gte|lte|gt|lt|in|is|neq)\.(.*)$/.exec(v);
    if(m) f[k] = {op:m[1], val:m[2]};
  }
  return f;
}
function match(row, filters){
  return Object.entries(filters).every(([col,{op,val}])=>{
    const rv = row[col];
    if(op==='eq') return String(rv) === val.replace(/^"|"$/g,'');
    if(op==='neq') return String(rv) !== val;
    if(op==='is') return val==='null' ? rv==null : val==='true' ? rv===true : rv===false;
    if(op==='in'){ const set = val.replace(/^\(|\)$/g,'').split(',').map(x=>x.replace(/^"|"$/g,'')); return set.includes(String(rv)); }
    if(op==='gte') return String(rv) >= val;
    if(op==='lte') return String(rv) <= val;
    return true;
  });
}

globalThis.fetch = async (url, opt={}) => {
  const u = String(url); const m = (opt.method||'GET').toUpperCase();
  const body = opt.body ? JSON.parse(opt.body) : null;
  CALLS.push(`${m} ${u.split('?')[0].split('/').pop()}`);
  const ok = d => ({ ok:true, status:200, text:async()=>JSON.stringify(d), json:async()=>d, blob:async()=>new Blob(['x']) });

  if(u.includes('generativelanguage') || u.includes('openrouter')){
    const txt = u.includes('openrouter')
      ? JSON.stringify({choices:[{message:{content:'[]'}}]})
      : JSON.stringify({candidates:[{content:{parts:[{text:'{"conveyorType":"screw","overall":{},"components":[]}'}]}}]});
    return { ok:true, status:200, text:async()=>txt, json:async()=>JSON.parse(txt) };
  }
  if(u.includes('/auth/v1/')){
    if(u.includes('token')) return ok({access_token:'t', refresh_token:'r', expires_in:3600, user:{id:'u-lead', email:'lead@shop.com'}});
    return ok({});
  }
  if(u.includes('/storage/v1/')) return ok({});

  const rm = /\/rest\/v1\/([a-z_]+)/.exec(u);
  if(!rm) return ok([]);
  const table = rm[1];
  if(!DB[table]) DB[table] = [];
  const qs = u.split('?')[1] || '';
  const filters = parseFilters(qs);

  if(m==='GET'){
    let rows = DB[table].filter(r=>match(r,filters));
    const om = /order=([a-z_]+)\.(asc|desc)/.exec(qs);
    if(om) rows = [...rows].sort((a,b)=> om[2]==='desc' ? (b[om[1]]>a[om[1]]?1:-1) : (a[om[1]]>b[om[1]]?1:-1));
    const lm = /limit=(\d+)/.exec(qs);
    if(lm) rows = rows.slice(0, +lm[1]);
    // emulate embedded resources like jobs(job_number)
    rows = rows.map(r=>{
      const c = {...r};
      if(qs.includes('jobs(')) c.jobs = DB.jobs.find(j=>j.id===r.job_id) || null;
      if(qs.includes('blueprints(')) c.blueprints = DB.blueprints.find(b=>b.id===r.blueprint_id) || null;
      return c;
    });
    return ok(rows);
  }
  if(m==='POST'){
    const rows = Array.isArray(body)?body:[body];
    const out = rows.map(r=>{
      const conflictCols = (/on_conflict=([a-z_,]+)/.exec(qs)||[])[1];
      if(conflictCols){
        const cols = conflictCols.split(',');
        const existing = DB[table].find(x=>cols.every(c=>String(x[c])===String(r[c])));
        if(existing){ Object.assign(existing, r); return existing; }
      }
      const row = { id: r.id || uid(table), version: 1, ...r };
      DB[table].push(row); return row;
    });
    return ok(out);
  }
  if(m==='PATCH'){
    const hits = DB[table].filter(r=>match(r,filters));
    hits.forEach(r=>{ Object.assign(r, body); if('version' in r) r.version++; });
    return ok(hits);
  }
  if(m==='DELETE'){
    const before = DB[table].length;
    DB[table] = DB[table].filter(r=>!match(r,filters));
    return ok([]);
  }
  return ok([]);
};
