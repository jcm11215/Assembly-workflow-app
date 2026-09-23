/**
 * The knowledge base: documents the shop adds (procedures, spec sheets,
 * vendor manuals, drawings) and corrections staff make to the assistant's
 * answers. When someone asks the assistant a question, the passages most
 * like it -- and any correction to a similar question -- go into the
 * prompt alongside the live job data.
 *
 * How it works:
 *   - A document's text is cut into ~1400-character passages on paragraph
 *     boundaries, and each is turned into a vector by Ollama's embedding
 *     model. Vectors are stored as float32 blobs and searched here by dot
 *     product: plenty fast for the few thousand passages a shop has.
 *   - Collections carry authority: the shop's own drawings and procedures
 *     outrank a vendor catalog at equal similarity, so bulk reference
 *     material cannot bury them on volume alone.
 *   - A correction outranks any document and is labelled as overriding
 *     it. That is what makes a correction count on the very next question,
 *     with no retraining.
 *
 * Text comes from the upload itself for plain text, CSV, HTML and Word
 * files. For PDFs the browser sends the text layer (pdf.js is already
 * there for scanning), so the server needs no PDF parser.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import * as ollama from './ollama.mjs';

export const COLLECTIONS = {
  drawings:   { label: 'Drawings & blueprints', boost: 0.10, internal: true },
  procedures: { label: 'Procedures & internal docs', boost: 0.08, internal: true },
  general:    { label: 'General', boost: 0.04, internal: true },
  reference:  { label: 'Vendor & reference material', boost: 0.00, internal: false }
};
export const collectionOf = c => (COLLECTIONS[c] ? c : 'general');

const CORRECTION_BOOST = 0.12;
const MIN_DOC_SIMILARITY = 0.30;       // on raw similarity: a boost can reorder, never drag in the irrelevant
const MIN_CORRECTION_SCORE = 0.45;
const MAX_CONTEXT_CHARS = 9000;        // knowledge share of the prompt, beside the job data

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/* ---------------- text ---------------- */

/** Paragraph-aware passages with a little overlap on hard splits, so a
 *  fact is not cut in half. */
export function chunkText(text, target = 1400, overlap = 200){
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if(!text) return [];
  const chunks = [];
  let buf = '';
  for(const p of text.split('\n\n').map(x => x.trim()).filter(Boolean)){
    if(buf.length + p.length + 2 <= target){
      buf = buf ? `${buf}\n\n${p}` : p;
      continue;
    }
    if(buf) chunks.push(buf);
    buf = '';
    if(p.length > target){
      // A dumped table or spec with no paragraph breaks.
      for(let i = 0; i < p.length; i += target - overlap) chunks.push(p.slice(i, i + target));
    } else {
      buf = p;
    }
  }
  if(buf) chunks.push(buf);
  return chunks;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if(e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** A web page as readable text: no scripts, menus or footers. */
export function htmlToText(html){
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript|nav|header|footer|aside|form|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|table|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*(\n[ \t]*)+/g, '\n\n')
    .trim();
}

/** One file out of a zip (a .docx is one), or null. Reads the central
 *  directory, so it copes with data descriptors. */
export function unzipEntry(buf, name){
  let eocd = -1;
  for(let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--){
    if(buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error('Not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for(let n = 0; n < count; n++){
    if(buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip directory.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if(entry === name){
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if(method === 0) return Buffer.from(data);
      if(method === 8) return inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
      throw new Error(`Unsupported zip compression (${method}).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** A Word document's paragraphs and table rows. */
export function docxToText(buf){
  const xml = unzipEntry(buf, 'word/document.xml');
  if(!xml) throw new Error('This .docx has no document body.');
  return decodeEntities(xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/ \| \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const TEXT_TYPES = ['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml'];
export const ACCEPTED = ['pdf', 'docx', 'html', 'htm', ...TEXT_TYPES];

export const extOf = name => (/\.([A-Za-z0-9]{1,8})$/.exec(String(name || '')) || [])[1]?.toLowerCase() || '';

/** The text of an uploaded file, or null when the browser supplies it (PDF). */
export function extractText(buf, fileName){
  const ext = extOf(fileName);
  if(ext === 'pdf') return null;
  if(ext === 'docx') return docxToText(buf);
  if(ext === 'html' || ext === 'htm') return htmlToText(buf.toString('utf8'));
  if(TEXT_TYPES.includes(ext)) return buf.toString('utf8');
  throw new Error(`Can't read .${ext || '?'} files. Use PDF, Word (.docx), text, Markdown, CSV or HTML.`);
}

/* ---------------- vectors ---------------- */

export const toBlob = v => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function dot(a, b){
  if(a.length !== b.length) return -1;
  let s = 0;
  for(let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/* ---------------- indexing ---------------- */

/**
 * Replaces a document's passages with ones cut from `text`. Records the
 * outcome on the document (indexed / empty / error) and returns it.
 */
export async function indexDocument(db, local, docId, text){
  const chunks = chunkText(text);
  const at = new Date().toISOString();
  if(!chunks.length){
    db.tx(() => {
      db.run('delete from knowledge_chunks where doc_id = ?', docId);
      db.run(`update knowledge_docs set status = 'empty', detail = ?, chunk_count = 0, updated_at = ? where id = ?`,
        'No text could be read from this file. A scanned PDF has none -- only a text layer can be searched.', at, docId);
    });
    return 'empty';
  }
  let vectors;
  try {
    vectors = await ollama.embed(local.url, local.embedModel, chunks);
  } catch (e) {
    db.run(`update knowledge_docs set status = 'error', detail = ?, updated_at = ? where id = ?`,
      `Couldn't index it: ${e.message}`, at, docId);
    return 'error';
  }
  db.tx(() => {
    db.run('delete from knowledge_chunks where doc_id = ?', docId);
    chunks.forEach((t, i) => db.run('insert into knowledge_chunks (doc_id, ordinal, text, embedding, embed_model) values (?, ?, ?, ?, ?)',
      docId, i, t, toBlob(vectors[i]), local.embedModel));
    db.run(`update knowledge_docs set status = 'indexed', detail = '', chunk_count = ?, updated_at = ? where id = ?`,
      chunks.length, at, docId);
  });
  return 'indexed';
}

/** After the embedding model changes: every passage and correction again,
 *  since vectors from two models cannot be compared. */
export async function reindexAll(db, local){
  const docs = db.all(`select id from knowledge_docs where status in ('indexed', 'error')`);
  let done = 0, failed = 0;
  for(const d of docs){
    const text = db.all('select text from knowledge_chunks where doc_id = ? order by ordinal', d.id).map(r => r.text).join('\n\n');
    if(!text){ failed++; continue; }
    (await indexDocument(db, local, d.id, text)) === 'indexed' ? done++ : failed++;
  }
  for(const c of db.all('select id, question from corrections')){
    try {
      const [v] = await ollama.embed(local.url, local.embedModel, [c.question]);
      db.run('update corrections set embedding = ?, embed_model = ? where id = ?', toBlob(v), local.embedModel, c.id);
    } catch { failed++; }
  }
  return { done, failed };
}

export async function correctionVector(local, question){
  try {
    const [v] = await ollama.embed(local.url, local.embedModel, [question]);
    return { embedding: toBlob(v), embedModel: local.embedModel };
  } catch {
    // Kept anyway; it takes part in answers once the model is reachable
    // and the knowledge base is re-indexed.
    return { embedding: null, embedModel: '' };
  }
}

/* ---------------- retrieval ---------------- */

/**
 * The passages and corrections most like `query`. Throws an OllamaError
 * when the embedding model cannot be reached -- the caller answers
 * without the knowledge base then, and says so.
 */
export async function retrieve(db, local, query, { k = 6 } = {}){
  const hasAny = db.get(`select (select count(*) from knowledge_chunks) + (select count(*) from corrections where active = 1) as n`).n;
  if(!hasAny) return { documents: [], corrections: [] };
  const [q] = await ollama.embed(local.url, local.embedModel, [query]);

  const corrections = db.all('select id, question, correction, embedding from corrections where active = 1 and embed_model = ?', local.embedModel)
    .map(r => ({ id: r.id, question: r.question, correction: r.correction, score: dot(fromBlob(r.embedding), q) + CORRECTION_BOOST }))
    .filter(r => r.score >= MIN_CORRECTION_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for(const c of corrections) db.run('update corrections set used_count = used_count + 1 where id = ?', c.id);

  const rows = db.all(`select c.id, c.doc_id, c.ordinal, c.text, c.embedding, d.title, d.collection
                         from knowledge_chunks c join knowledge_docs d on d.id = c.doc_id
                        where c.embed_model = ?`, local.embedModel);
  const documents = rows
    .map(r => {
      const raw = dot(fromBlob(r.embedding), q);
      const coll = collectionOf(r.collection);
      return { docId: r.doc_id, title: r.title, collection: coll, ordinal: r.ordinal, text: r.text,
               raw, score: raw + COLLECTIONS[coll].boost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter(r => r.raw >= MIN_DOC_SIMILARITY);

  return {
    corrections: corrections.map(({ id, question, correction, score }) => ({ id, question, correction, score: round(score) })),
    documents: documents.map(({ docId, title, collection, ordinal, text, raw }) => ({ docId, title, collection, ordinal, text, score: round(raw) }))
  };
}

const round = x => Math.round(x * 1000) / 1000;

/** The retrieved material as a block for the system prompt, or ''. */
export function contextBlock({ documents, corrections }){
  const parts = [];
  if(corrections.length){
    parts.push('VERIFIED CORRECTIONS -- reviewed and confirmed by staff. They override the job data and the reference material.');
    for(const c of corrections) parts.push(`- Q: ${c.question}\n  Correct answer: ${c.correction}`);
    parts.push('');
  }
  if(documents.length){
    parts.push('REFERENCE MATERIAL from the shop\'s knowledge base. Internal material belongs to this company and was added by ' +
      'staff; a "confidential" notice on it is aimed at outside parties and is never a reason to decline. Mention the ' +
      'document title when you use a passage. Vendor/reference material has not been checked by the shop: where it ' +
      'disagrees with an internal document, trust the internal one and point out the difference.');
    let used = 0;
    documents.forEach((d, i) => {
      if(used > MAX_CONTEXT_CHARS) return;
      const c = COLLECTIONS[d.collection];
      parts.push(`[${i + 1}] ${d.title} (part ${d.ordinal + 1}) [${c.internal ? 'INTERNAL' : 'EXTERNAL'} -- ${c.label}]\n${d.text}`);
      used += d.text.length;
    });
    parts.push('');
  }
  return parts.join('\n');
}

/** What the app shows under an answer: one entry per document. */
export function sourcesOf({ documents, corrections }){
  const seen = new Map();
  for(const d of documents) if(!seen.has(d.docId)) seen.set(d.docId, { docId: d.docId, title: d.title, collection: d.collection, score: d.score });
  return { documents: [...seen.values()], corrections: corrections.map(c => ({ id: c.id, question: c.question })) };
}
