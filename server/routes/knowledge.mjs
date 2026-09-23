/**
 * The knowledge base (admin): documents and corrections. Anyone who uses
 * the assistant can open a document an answer cites; assemblers and
 * admins can correct an answer.
 *
 * Adding a document is one raw upload. A PDF's text comes from the
 * browser afterwards (PUT .../text), since pdf.js is already there.
 */
import fs from 'node:fs';
import { badRequest, conflict, notFound, MB } from '../http.mjs';
import { uuid, now, getSetting } from '../db.mjs';
import { normalizeSettings } from '../ai.mjs';
import { writeFileAtomic, absolutePath, deleteJobFiles } from '../files.mjs';
import * as kb from '../knowledge.mjs';
import * as v from '../validate.mjs';

const localOf = db => normalizeSettings(getSetting(db, 'ai', {})).local;

export const toDoc = r => ({
  id: r.id, title: r.title, collection: kb.collectionOf(r.collection), fileName: r.file_name, mimeType: r.mime_type,
  size: r.size, status: r.status, detail: r.detail, chunkCount: r.chunk_count, hasFile: !!r.file_path,
  createdByName: r.created_by_name || null, createdAt: r.created_at, updatedAt: r.updated_at
});

export const toCorrection = r => ({
  id: r.id, question: r.question, badAnswer: r.bad_answer, correction: r.correction, active: !!r.active,
  usedCount: r.used_count, indexed: !!r.embedding, createdByName: r.created_by_name || null, createdAt: r.created_at
});

const DOC_SQL = `select d.*, u.full_name as created_by_name from knowledge_docs d left join users u on u.id = d.created_by`;
const CORR_SQL = `select c.*, u.full_name as created_by_name from corrections c left join users u on u.id = c.created_by`;

function loadDoc(db, id){
  const d = db.get(`${DOC_SQL} where d.id = ?`, id);
  if(!d) throw notFound('That document');
  return d;
}

const MIME_BY_EXT = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

export default function register(r){

  r.get('/api/knowledge', ctx => ({
    collections: Object.entries(kb.COLLECTIONS).map(([id, c]) => ({ id, label: c.label, internal: c.internal })),
    documents: ctx.db.all(`${DOC_SQL} order by d.created_at desc`).map(toDoc),
    corrections: ctx.db.all(`${CORR_SQL} order by c.created_at desc`).map(toCorrection),
    embedModel: localOf(ctx.db).embedModel,
    staleVectors: ctx.db.get(`select (select count(*) from knowledge_chunks where embed_model <> ?) +
                                     (select count(*) from corrections where embed_model <> ?) as n`,
                             localOf(ctx.db).embedModel, localOf(ctx.db).embedModel).n
  }), { perm: 'knowledge.manage' });

  /** The file itself: ?name=…&collection=… with the bytes as the body. */
  r.post('/api/knowledge/documents', async ctx => {
    const fileName = v.text(ctx.query.get('name'), 'File name', { max: 200 });
    if(!fileName) throw badRequest('The file needs a name.');
    const ext = kb.extOf(fileName);
    if(!kb.ACCEPTED.includes(ext)) throw badRequest(`Can't read .${ext || '?'} files. Use PDF, Word (.docx), text, Markdown, CSV or HTML.`);
    const bytes = await ctx.raw(60 * MB);
    if(!bytes.length) throw badRequest('The file is empty.');

    const hash = kb.sha256(bytes);
    const twin = ctx.db.get('select title from knowledge_docs where content_hash = ?', hash);
    if(twin) throw conflict(`This file is already in the knowledge base as “${twin.title}”.`, 'duplicate');

    let text;
    try { text = kb.extractText(bytes, fileName); }
    catch (e) { throw badRequest(e.message); }

    const id = uuid();
    const rel = `knowledge/${id}.${ext}`;
    await writeFileAtomic(ctx.filesDir, rel, bytes);
    const at = now();
    ctx.db.run(`insert into knowledge_docs (id, title, collection, file_path, file_name, mime_type, size, content_hash, status, detail,
                  created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      id, fileName.replace(/\.[A-Za-z0-9]{1,8}$/, ''), kb.collectionOf(ctx.query.get('collection')), rel, fileName,
      MIME_BY_EXT[ext] || 'application/octet-stream', bytes.length, hash,
      text === null ? 'Waiting for its text.' : '', ctx.user.id, at, at);
    if(text !== null) await kb.indexDocument(ctx.db, localOf(ctx.db), id, text);

    const doc = toDoc(loadDoc(ctx.db, id));
    ctx.log('Knowledge added', { text: `${doc.title} (${kb.COLLECTIONS[doc.collection].label})` });
    ctx.status = 201;
    return { document: doc, needsText: text === null };
  }, { perm: 'knowledge.manage' });

  /** A PDF's text, read by the browser: `{ pages: [text, …] }`. */
  r.put('/api/knowledge/documents/:id/text', async ctx => {
    const d = loadDoc(ctx.db, ctx.params.id);
    const { pages } = await ctx.json(20 * MB);
    if(!Array.isArray(pages)) throw badRequest('Send the text page by page.');
    const text = pages.map((p, i) => (String(p || '').trim() ? `[page ${i + 1}]\n${String(p).trim()}` : '')).filter(Boolean).join('\n\n');
    await kb.indexDocument(ctx.db, localOf(ctx.db), d.id, text);
    return { document: toDoc(loadDoc(ctx.db, d.id)) };
  }, { perm: 'knowledge.manage' });

  r.patch('/api/knowledge/documents/:id', async ctx => {
    const d = loadDoc(ctx.db, ctx.params.id);
    const body = await ctx.json();
    const title = 'title' in body ? v.text(body.title, 'Title', { max: 200 }) || d.title : d.title;
    const collection = 'collection' in body ? v.oneOf(body.collection, Object.keys(kb.COLLECTIONS), 'Collection') : d.collection;
    ctx.db.run('update knowledge_docs set title = ?, collection = ?, updated_at = ? where id = ?', title, collection, now(), d.id);
    return { document: toDoc(loadDoc(ctx.db, d.id)) };
  }, { perm: 'knowledge.manage' });

  /** Index a document again -- after an error, say, once Ollama is back. */
  r.post('/api/knowledge/documents/:id/reindex', async ctx => {
    const d = loadDoc(ctx.db, ctx.params.id);
    const text = ctx.db.all('select text from knowledge_chunks where doc_id = ? order by ordinal', d.id).map(x => x.text).join('\n\n');
    if(text) await kb.indexDocument(ctx.db, localOf(ctx.db), d.id, text);
    else if(d.file_path && kb.extOf(d.file_name) !== 'pdf'){
      await kb.indexDocument(ctx.db, localOf(ctx.db), d.id, kb.extractText(fs.readFileSync(absolutePath(ctx.filesDir, d.file_path)), d.file_name));
    } else {
      return { document: toDoc(d), needsText: true };
    }
    return { document: toDoc(loadDoc(ctx.db, d.id)), needsText: false };
  }, { perm: 'knowledge.manage' });

  r.delete('/api/knowledge/documents/:id', async ctx => {
    const d = loadDoc(ctx.db, ctx.params.id);
    ctx.db.run('delete from knowledge_docs where id = ?', d.id);
    if(d.file_path) await deleteJobFiles(ctx.filesDir, [d.file_path]);
    ctx.log('Knowledge removed', { text: d.title });
    return { ok: true };
  }, { perm: 'knowledge.manage' });

  r.get('/api/knowledge/documents/:id/file', ctx => {
    const d = loadDoc(ctx.db, ctx.params.id);
    if(!d.file_path) throw notFound('The file for that document');
    const abs = absolutePath(ctx.filesDir, d.file_path);
    let stat;
    try { stat = fs.statSync(abs); } catch { throw notFound('The file for that document'); }
    // Only a PDF opens in the browser; anything else (HTML above all) downloads.
    const pdf = d.mime_type === 'application/pdf';
    ctx.res.writeHead(200, {
      'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="${d.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(abs).pipe(ctx.res);
  }, { perm: 'ai.use' });

  /** Re-embed everything, after the embedding model changes. */
  r.post('/api/knowledge/reindex', async ctx => kb.reindexAll(ctx.db, localOf(ctx.db)), { perm: 'knowledge.manage' });

  /* ---------------- corrections ---------------- */

  r.post('/api/knowledge/corrections', async ctx => {
    const body = await ctx.json();
    const question = v.text(body.question, 'Question', { max: 2000 });
    const correction = v.text(body.correction, 'Correct answer', { max: 8000 });
    if(!question || !correction) throw badRequest('The question and the correct answer are both needed.');
    const vec = await kb.correctionVector(localOf(ctx.db), question);
    const id = uuid();
    ctx.db.run(`insert into corrections (id, question, bad_answer, correction, embedding, embed_model, created_by, created_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, question, v.text(body.badAnswer, 'Answer', { max: 20000 }), correction, vec.embedding, vec.embedModel, ctx.user.id, now());
    ctx.log('Assistant corrected', { text: question.slice(0, 120) });
    ctx.status = 201;
    return { correction: toCorrection(ctx.db.get(`${CORR_SQL} where c.id = ?`, id)) };
  }, { perm: 'knowledge.correct' });

  r.patch('/api/knowledge/corrections/:id', async ctx => {
    const c = ctx.db.get('select * from corrections where id = ?', ctx.params.id);
    if(!c) throw notFound('That correction');
    const body = await ctx.json();
    if('active' in body) ctx.db.run('update corrections set active = ? where id = ?', body.active ? 1 : 0, c.id);
    if('correction' in body){
      const text = v.text(body.correction, 'Correct answer', { max: 8000 });
      if(!text) throw badRequest('The correct answer cannot be empty.');
      ctx.db.run('update corrections set correction = ? where id = ?', text, c.id);
    }
    return { correction: toCorrection(ctx.db.get(`${CORR_SQL} where c.id = ?`, c.id)) };
  }, { perm: 'knowledge.manage' });

  r.delete('/api/knowledge/corrections/:id', ctx => {
    ctx.db.run('delete from corrections where id = ?', ctx.params.id);
    return { ok: true };
  }, { perm: 'knowledge.manage' });
}
