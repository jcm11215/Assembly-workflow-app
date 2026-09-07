/**
 * Notes repository. Individual inserts replace persistNotes().
 * A null job_id means a shop-wide note, matching the old '' convention.
 */
import { db, currentUserId } from './supabaseClient.js';
import { rowToNote, noteToRow } from './mappers.js';

const SEL = 'select=id,job_id,note_type,body,note_date,created_at,author,jobs(job_number)';

function flatten(row){
  return rowToNote({
    ...row,
    job_number: row.jobs ? row.jobs.job_number : ''
  });
}

export async function listNotes(limit = 500){
  const rows = await db.select('notes', `${SEL}&order=note_date.desc,created_at.desc&limit=${limit}`);
  return rows.map(flatten);
}

export async function createNote(note){
  const jobId = note.jobId || (note.jobNumber ? await resolveJobId(note.jobNumber) : null);
  const row = noteToRow(note, jobId);
  row.author = currentUserId();
  const [created] = await db.insert('notes', row);
  return flatten({ ...created, jobs: note.jobNumber ? { job_number: note.jobNumber } : null });
}

/** Bulk create -- the note form submits Progress/Issue/NextSteps together. */
export async function createNotes(notes){
  if(!notes.length) return [];
  const jobNumbers = [...new Set(notes.map(n => n.jobNumber).filter(Boolean))];
  const idMap = await resolveJobIds(jobNumbers);
  const rows = notes.map(n => {
    const row = noteToRow(n, n.jobNumber ? idMap[n.jobNumber] : null);
    row.author = currentUserId();
    return row;
  });
  const created = await db.insert('notes', rows);
  return created.map((c, i) => flatten({ ...c, jobs: notes[i].jobNumber ? { job_number: notes[i].jobNumber } : null }));
}

export async function deleteNote(id){
  await db.remove('notes', `id=eq.${id}`);
}

async function resolveJobId(jobNumber){
  const m = await resolveJobIds([jobNumber]);
  return m[jobNumber] || null;
}

async function resolveJobIds(jobNumbers){
  if(!jobNumbers.length) return {};
  const list = jobNumbers.map(n => `"${n}"`).join(',');
  const rows = await db.select('jobs', `select=id,job_number&job_number=in.(${list})`);
  const map = {};
  rows.forEach(r => { map[r.job_number] = r.id; });
  return map;
}
