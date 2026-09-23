/**
 * Brings what the old stand-alone Local AI Assistant learned into this
 * app: its documents (with their files and passages -- no re-indexing
 * needed when the embedding model is the same), its corrections, and its
 * model choices.
 *
 *   node server/cli.mjs import-localai /home/you/localai
 *
 * Its copies of tracker data (the "Job & production data" collection and
 * data/tracker/) are left behind: the assistant here reads the jobs live.
 * Safe to run twice -- a document or correction already here is skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { uuid, getSetting, putSetting } from './db.mjs';
import { aiSettings, applyEdit } from './ai.mjs';
import { writeFileAtomic } from './files.mjs';
import { collectionOf, extOf, sha256, ACCEPTED } from './knowledge.mjs';

const iso = secs => new Date((Number(secs) || Date.now() / 1000) * 1000).toISOString();

export async function importLocalAi(db, filesDir, folder, log = console.log){
  const dbFile = path.join(folder, 'data', 'memory.db');
  if(!fs.existsSync(dbFile)) throw new Error(`No ${dbFile} -- give the folder the Local AI was installed in.`);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(folder, 'config.json'), 'utf8')); } catch { /* defaults */ }
  const embedModel = cfg.embed_model || 'nomic-embed-text';

  // Its model choices, where this app has none yet.
  const saved = getSetting(db, 'ai', null);
  const current = aiSettings(saved);
  const edit = {};
  if(!current.chatModel && cfg.chat_model) edit.chatModel = cfg.chat_model;
  if(!current.visionModel && cfg.vision_model) edit.visionModel = cfg.vision_model;
  if(!(saved?.embedModel || saved?.local?.embedModel)) edit.embedModel = embedModel;
  if(cfg.ollama_url && !(saved?.url || saved?.local?.url)) edit.url = cfg.ollama_url;
  if(cfg.context_tokens) edit.contextTokens = cfg.context_tokens;
  if(cfg.vision_context_tokens) edit.visionContextTokens = cfg.vision_context_tokens;
  if(cfg.temperature != null) edit.temperature = cfg.temperature;
  putSetting(db, 'ai', applyEdit(saved, edit));

  const old = new DatabaseSync(dbFile, { readOnly: true });
  const cols = new Set(old.prepare('pragma table_info(documents)').all().map(c => c.name));
  const docs = old.prepare(`select * from documents order by id`).all();
  const stats = { documents: 0, skipped: 0, noFile: 0, corrections: 0 };

  for(const d of docs){
    const collection = cols.has('collection') ? d.collection : (d.source_type === 'web' ? 'reference' : 'general');
    if(collection === 'jobs' || /[\\/]data[\\/]tracker[\\/]/.test(d.path || '')){ stats.skipped++; continue; }
    const hash = d.content_hash || '';
    if(hash && db.get('select 1 from knowledge_docs where content_hash = ?', hash)){ stats.skipped++; continue; }
    const chunks = old.prepare('select ordinal, text, embedding from chunks where doc_id = ? order by ordinal').all(d.id);
    if(!chunks.length){ stats.skipped++; continue; }

    const id = uuid();
    const fileName = path.basename(d.path || `${d.title || 'document'}.txt`);
    const ext = extOf(fileName);
    let rel = null, size = 0, digest = hash;
    try {
      const bytes = fs.readFileSync(d.path);
      if(ACCEPTED.includes(ext)){
        rel = `knowledge/${id}.${ext}`;
        await writeFileAtomic(filesDir, rel, bytes);
        size = bytes.length;
        digest = digest || sha256(bytes);
      }
    } catch { stats.noFile++; }

    const at = iso(d.added_at);
    db.tx(() => {
      db.run(`insert into knowledge_docs (id, title, collection, file_path, file_name, mime_type, size, content_hash, status,
                chunk_count, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?)`,
        id, d.title || fileName, collectionOf(collection), rel, fileName,
        ext === 'pdf' ? 'application/pdf' : 'application/octet-stream', size, digest, chunks.length, at, at);
      for(const c of chunks){
        db.run('insert into knowledge_chunks (doc_id, ordinal, text, embedding, embed_model) values (?, ?, ?, ?, ?)',
          id, c.ordinal, c.text, c.embedding, c.embedding ? embedModel : '');
      }
    });
    stats.documents++;
  }

  for(const c of old.prepare('select * from corrections order by id').all()){
    if(db.get('select 1 from corrections where question = ? and correction = ?', c.question, c.correction)) continue;
    db.run(`insert into corrections (id, question, bad_answer, correction, active, used_count, embedding, embed_model, created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid(), c.question, c.bad_answer || '', c.correction, c.active ? 1 : 0, c.used_count || 0,
      c.embedding, c.embedding ? embedModel : '', iso(c.created_at));
    stats.corrections++;
  }
  old.close();

  log(`Imported ${stats.documents} document(s) and ${stats.corrections} correction(s).` +
    (stats.skipped ? ` Skipped ${stats.skipped} (already here, tracker copies, or empty).` : '') +
    (stats.noFile ? ` ${stats.noFile} had no file left on disk; their text came across.` : ''));
  return stats;
}
