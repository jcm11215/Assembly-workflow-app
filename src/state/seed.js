/** First-run demo data. */


/* ---------------- Seed data (first run only) ---------------- */
import { todayISO } from '../utils/date.js';
import { uid } from '../utils/id.js';

export function seedJobs(){
  const t = new Date();
  const iso = off => { const d=new Date(t); d.setDate(d.getDate()+off); return d.toISOString().slice(0,10); };
  return [
    {id:uid('job'), jobNumber:'SC-4471', customer:'Midwest Grain Co.', description:'14" x 40ft screw conveyor, carbon steel trough, drive end gearmotor', dueDate: iso(-2), priority:'High', assignedAssembler:'D. Reyes', assemblyStatus:'testing', percentComplete:80},
    {id:uid('job'), jobNumber:'SC-4472', customer:'Prairie Feed Systems', description:'9" x 22ft shafted conveyor, stainless, sanitary flush ends', dueDate: iso(1), priority:'High', assignedAssembler:'M. Okafor', assemblyStatus:'drive', percentComplete:55},
    {id:uid('job'), jobNumber:'SC-4473', customer:'Redline Aggregates', description:'16" shaftless conveyor, U-trough, abrasion resistant liner', dueDate: iso(6), priority:'Medium', assignedAssembler:'J. Whitfield', assemblyStatus:'layout', percentComplete:20},
    {id:uid('job'), jobNumber:'SC-4474', customer:'Great Lakes Cement', description:'12" x 30ft incline conveyor, 15deg incline, flighting cleats', dueDate: iso(10), priority:'Low', assignedAssembler:'Unassigned', assemblyStatus:'ready', percentComplete:0},
    {id:uid('job'), jobNumber:'SC-4465', customer:'Heartland Ethanol', description:'10" x 18ft transfer conveyor, replacement unit', dueDate: iso(-6), priority:'High', assignedAssembler:'D. Reyes', assemblyStatus:'qc', percentComplete:95},
    {id:uid('job'), jobNumber:'SC-4468', customer:'Bluegrass Milling', description:'8" x 12ft short-run conveyor, painted mild steel', dueDate: iso(3), priority:'Medium', assignedAssembler:'M. Okafor', assemblyStatus:'bearings', percentComplete:35},
    {id:uid('job'), jobNumber:'SC-4460', customer:'Delta Ag Processing', description:'20" x 45ft high-capacity conveyor, twin drive', dueDate: iso(-1), priority:'High', assignedAssembler:'J. Whitfield', assemblyStatus:'final', percentComplete:70},
    {id:uid('job'), jobNumber:'SC-4455', customer:'Northstar Fertilizer', description:'12" x 25ft conveyor, epoxy coated trough', dueDate: iso(-10), priority:'Medium', assignedAssembler:'D. Reyes', assemblyStatus:'complete', percentComplete:100}
  ];
}

export function seedBlockers(jobs){
  const j1 = jobs.find(j=>j.jobNumber==='SC-4472');
  const j2 = jobs.find(j=>j.jobNumber==='SC-4468');
  return [
    {id:uid('blk'), jobNumber:j1?j1.jobNumber:'SC-4472', issueDescription:'Gearmotor shipment delayed from vendor, ETA unknown', responsibleDepartment:'Purchasing', dateReported: todayISO(), severity:'Critical', status:'Open'},
    {id:uid('blk'), jobNumber:j2?j2.jobNumber:'SC-4468', issueDescription:'Bearing bore size mismatch, needs engineering review', responsibleDepartment:'Engineering', dateReported: todayISO(), severity:'High', status:'In Progress'}
  ];
}

export function seedNotes(jobs){
  return [
    {id:uid('note'), date: todayISO(), jobNumber:'SC-4471', noteType:'Progress', notes:'Trough sections aligned and tack welded, moving into final testing tomorrow.'},
    {id:uid('note'), date: todayISO(), jobNumber:'SC-4472', noteType:'Issue', notes:'Waiting on gearmotor from vendor, cannot proceed to drive install.'},
    {id:uid('note'), date: todayISO(), jobNumber:'SC-4472', noteType:'NextSteps', notes:'Follow up with purchasing on gearmotor ETA first thing tomorrow.'}
  ];
}

/* ---------------- Storage ----------------
   Data lives in a Supabase project, in one table (app_data: key text
   primary key, value jsonb). The "anon" key below is meant to be public
   -- Supabase's model is that access control happens via database
   policies, not by hiding this key -- so unlike a GitHub token, there's
   nothing here for a scanner to find and revoke, and nothing sensitive
   in this page's source. Set SUPABASE_URL and SUPABASE_ANON_KEY to your
   project's values (Project Settings -> API). */
