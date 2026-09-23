/**
 * Getting the local AI working with as little asked of an admin as
 * possible. There are three jobs -- answering questions, reading
 * drawings, searching documents -- and each needs a model.
 *
 * Models already installed are put to work on their own (`fillGaps`),
 * and setting up downloads the recommended model for any job still
 * uncovered: one download at a time, each put to work as it lands.
 */
import { getSetting, putSetting } from './db.mjs';
import { aiSettings, aiSummary, listModels } from './ai.mjs';
import * as ollama from './ollama.mjs';
import { broadcast } from './live.mjs';
import { can } from '../shared/roles.js';

/** The jobs, and the model recommended for each. */
export const JOBS = [
  { key: 'chatModel', label: 'Answers questions', model: 'qwen2.5:7b', sizeGb: 4.7 },
  // Qwen2.5-VL reads documents and points at things on them better than
  // MiniCPM-V, which installs that already have it can keep using.
  { key: 'visionModel', label: 'Reads drawings', model: 'qwen2.5vl:7b', sizeGb: 6.0 },
  { key: 'embedModel', label: 'Searches documents', model: 'nomic-embed-text', sizeGb: 0.3 }
];

/** Downloads: embedding first (small, so a quick win), then the rest. */
const SETUP_ORDER = ['embedModel', 'chatModel', 'visionModel'];

/** "minicpm-v" and "minicpm-v:latest" are the same model. */
const full = name => (String(name || '').includes(':') ? String(name) : `${name}:latest`);
export const sameModel = (a, b) => !!a && !!b && full(a) === full(b);
const findModel = (models, name) => models.find(m => sameModel(m.id, name));

/** The model to put on a job nobody picked a model for: the
 *  recommended one if it's installed, else a sensibly sized one. */
function pick(models, job){
  const fits = models.filter(m => (job.key === 'visionModel' ? m.vision : !m.embedding && !m.vision));
  const rec = findModel(fits, job.model);
  if(rec) return rec.id;
  const bySize = [...fits].sort((a, b) => b.sizeGb - a.sizeGb);
  return (bySize.find(m => m.sizeGb <= 10) || bySize[bySize.length - 1] || {}).id || '';
}

/**
 * Puts installed models on the jobs that have none. Returns the
 * settings as they now are, and what was picked. The embedding model
 * always has one (the default), so it is left alone: changing it means
 * re-indexing the knowledge base.
 */
export function fillGaps(db, models, log = null){
  const raw = getSetting(db, 'ai', {});
  const s = aiSettings(raw);
  const picked = {};
  for(const job of JOBS){
    if(job.key === 'embedModel' || s[job.key]) continue;
    const id = pick(models, job);
    if(id) picked[job.key] = id;
  }
  if(!Object.keys(picked).length) return { settings: s, picked };
  const next = aiSettings({ ...s, ...picked });
  putSetting(db, 'ai', next);
  broadcast('ai', aiSummary(next));
  log?.('AI models picked', { text: Object.values(picked).join(', ') });
  return { settings: next, picked };
}

/** fillGaps against whatever Ollama has now; quiet if it isn't running. */
export async function autoPick(db){
  try { fillGaps(db, await listModels(getSetting(db, 'ai', {}))); }
  catch { /* Ollama not up yet: Settings shows that */ }
}

/** Each job: its model, and whether that model is installed. */
export function jobsStatus(settings, models){
  return JOBS.map(job => {
    const model = settings[job.key];
    return { key: job.key, label: job.label, model, installed: !!findModel(models, model),
      recommended: job.model, sizeGb: job.sizeGb };
  });
}

/* ---------------- downloads ---------------- */

/** Waiting downloads, the one running, and the last failure. One at a
 *  time: two big downloads at once only make both slower. */
const downloads = { queue: [], current: null, error: null };
/** model name -> the job to put it on as soon as it has downloaded. */
const assignOnLand = new Map();
const toAdmins = u => can(u.role, 'settings.manage');
const snapshot = () => ({ current: downloads.current, queue: [...downloads.queue], error: downloads.error });
const announce = () => broadcast('ai-models', snapshot(), toAdmins);

export const downloadState = snapshot;

/** Is this model downloading or waiting to? */
const pending = name => (downloads.current && sameModel(downloads.current.model, name)) || downloads.queue.some(q => sameModel(q, name));

/**
 * Queues models to download. Each one, as it lands, is put on any job
 * still without a model. `log` records it in the activity log.
 */
export function enqueue(db, names, log = null){
  const added = names.filter(n => n && !pending(n));
  if(!added.length) return snapshot();
  downloads.queue.push(...added);
  downloads.error = null;
  log?.('AI model download', { text: added.join(', ') });
  announce();
  if(!downloads.current) run(db, log);
  return snapshot();
}

async function run(db, log){
  while(downloads.queue.length){
    const model = downloads.queue.shift();
    downloads.current = { model, status: 'Starting', total: 0, completed: 0 };
    announce();
    // Ollama reports each layer separately; the sum of them is the model.
    const layers = new Map();
    let last = 0;
    try {
      await ollama.pull(aiSettings(getSetting(db, 'ai', {})).url, model, p => {
        if(p.digest && p.total) layers.set(p.digest, { total: p.total, completed: p.completed || 0 });
        let total = 0, completed = 0;
        for(const l of layers.values()){ total += l.total; completed += l.completed; }
        downloads.current = { model, status: statusText(p.status), total, completed };
        if(Date.now() - last > 500){ last = Date.now(); announce(); }
      });
      const installed = await listModels(getSetting(db, 'ai', {}));
      const key = [...assignOnLand].find(([name]) => sameModel(name, model));
      if(key){
        assignOnLand.delete(key[0]);
        const found = findModel(installed, model);
        if(found) assign(db, key[1], found.id, log);
      }
      fillGaps(db, installed, log);
    } catch (err) {
      // The rest of the queue would fail the same way if Ollama is gone.
      downloads.error = { model, message: err.message };
      if(err.unreachable) downloads.queue.length = 0;
    }
  }
  downloads.current = null;
  announce();
}

function statusText(s){
  s = String(s || '');
  if(s.startsWith('pulling manifest')) return 'Starting';
  if(s.startsWith('pulling')) return 'Downloading';
  if(s.startsWith('verifying')) return 'Checking';
  if(s.startsWith('writing') || s === 'success') return 'Finishing';
  return s ? s[0].toUpperCase() + s.slice(1) : 'Downloading';
}

/** Puts a model on a job and tells everyone the AI's state. */
function assign(db, key, id, log){
  const next = aiSettings({ ...aiSettings(getSetting(db, 'ai', {})), [key]: id });
  putSetting(db, 'ai', next);
  broadcast('ai', aiSummary(next));
  log?.('AI model switched', { text: `${JOBS.find(j => j.key === key).label}: ${id}` });
}

/**
 * Switches a job to a model: straight away when it is installed,
 * otherwise once it has downloaded, so the old model keeps working in
 * the meantime. The embedding model isn't offered: changing it means
 * re-indexing the knowledge base, a deliberate step on its own.
 */
export async function useModel(db, key, model, log = null){
  if(!['chatModel', 'visionModel'].includes(key)) throw new Error('Only the question and drawing models can be switched here.');
  const installed = await listModels(getSetting(db, 'ai', {}));
  const found = findModel(installed, model);
  if(found){ assign(db, key, found.id, log); return { switched: true, downloads: snapshot() }; }
  assignOnLand.set(model, key);
  return { switched: false, downloads: enqueue(db, [model], log) };
}

/**
 * One-click setup: puts installed models to work, then downloads the
 * models still missing -- the one picked for a job if it has gone, else
 * the recommended one. Returns what it queued.
 */
export async function setup(db, log = null){
  const models = await listModels(getSetting(db, 'ai', {}));
  const { settings } = fillGaps(db, models, log);
  const want = [];
  for(const key of SETUP_ORDER){
    const job = JOBS.find(j => j.key === key);
    const name = settings[key] || job.model;
    if(!findModel(models, name)) want.push(name);
  }
  return { queued: want, downloads: enqueue(db, want, log) };
}

