/** Generic collection helpers. */

export function distinctValues(field, arr, extra){
  const set = new Set((extra||[]));
  arr.forEach(x=>{ if(x[field]) set.add(x[field]); });
  return [...set].filter(v=>v && v!=='Unassigned').sort();
}
