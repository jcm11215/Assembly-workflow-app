/** Daily notes: progress, issues and next steps, per job or shop-wide. */
import { html, useState } from '../vendor/index.js';
import { useStore } from '../lib/store.js';
import { addNotes, deleteNote } from '../lib/actions.js';
import { useCan } from '../lib/permissions.js';
import { fmtDate } from '../lib/format.js';
import { jobLink } from '../lib/router.js';
import { todayISO } from '../../shared/dates.js';
import { Empty, Field, Select, submitting } from '../ui/kit.js';
import { openModal, Sheet, confirmAction, toast, toastError } from '../ui/overlays.js';

const TYPE_LABEL = { Progress: 'Progress', Issue: 'Issue', NextSteps: 'Next steps' };

export function Notes(){
  const notes = useStore(s => s.notes);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? notes.filter(n => [n.jobNumber, n.body, n.authorName].some(v => String(v || '').toLowerCase().includes(needle)))
    : notes;
  return html`
    <div class="toolbar">
      <input type="search" class="search" placeholder="Search notes by job #, text or name…" value=${q}
             onInput=${e => setQ(e.currentTarget.value)} aria-label="Search notes" />
    </div>
    <div class="list">
      ${shown.length ? shown.map(n => html`<${NoteCard} key=${n.id} note=${n} showJob=${true} />`)
                     : html`<${Empty} icon="📝">${notes.length ? 'No notes match.' : 'No notes yet.'}<//>`}
    </div>
    <div class="row-actions"><button class="btn btn-primary" onClick=${() => openModal(NoteForm)}>+ Add a note</button></div>`;
}

export function NoteCard({ note: n, showJob }){
  const canDelete = useCan('note.delete');
  const remove = async () => {
    if(!(await confirmAction({ title: 'Delete note', message: 'Delete this note? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    deleteNote(n).then(() => toast('Note deleted.'), toastError);
  };
  return html`
    <div class=${`note note-${n.type.toLowerCase()}`}>
      <div class="note-head">
        <span>
          <span class="note-type">${TYPE_LABEL[n.type] || n.type}</span>
          ${showJob && (n.jobId ? html`<a href=${jobLink(n.jobId)}>${n.jobNumber}</a>` : 'Shop-wide')}
        </span>
        <span>${fmtDate(n.date)}</span>
      </div>
      <div class="note-body">${n.body}</div>
      <div class="note-foot">
        ${n.authorName && html`<span>— ${n.authorName}</span>`}
        ${canDelete && html`<button class="link-btn" onClick=${remove}>Delete</button>`}
      </div>
    </div>`;
}

/** One form, up to three notes: what got done, what came up, what's next. */
export function NoteForm({ jobId, close }){
  const jobs = useStore(s => s.jobs);
  const submit = submitting(async f => {
    const entries = [
      { type: 'Progress', body: f.progress },
      { type: 'Issue', body: f.issues },
      { type: 'NextSteps', body: f.next }
    ].filter(e => e.body.trim());
    if(!entries.length) throw new Error('Write at least one of the three.');
    await addNotes({ jobId: f.jobId || null, date: f.date, entries });
    toast('Note saved.', { kind: 'ok' });
    close();
  });
  return html`
    <${Sheet} title="Add a daily note" close=${close}>
      <form onSubmit=${submit}>
        <div class="field-row">
          <${Field} label="Date"><input name="date" type="date" required defaultValue=${todayISO()} /><//>
          <${Field} label="Job">
            <${Select} name="jobId" value=${jobId || ''}
                       options=${[{ value: '', label: 'Shop-wide' }, ...jobs.map(j => ({ value: j.id, label: `${j.jobNumber} -- ${j.customer}` }))]} />
          <//>
        </div>
        <${Field} label="Progress"><textarea name="progress" rows="2" placeholder="What got done?"></textarea><//>
        <${Field} label="Issues"><textarea name="issues" rows="2" placeholder="Anything that came up?"></textarea><//>
        <${Field} label="Next steps"><textarea name="next" rows="2" placeholder="What's next?"></textarea><//>
        <button type="submit" class="btn btn-primary btn-block">Save note</button>
      </form>
    <//>`;
}
