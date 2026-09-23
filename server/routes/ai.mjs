/**
 * AI settings (admin), the one endpoint the app uses to talk to the AI
 * (POST /api/ai/chat), and setting up the local models Ollama runs.
 */
import { HttpError, badRequest, MB } from '../http.mjs';
import { getSetting, putSetting } from '../db.mjs';
import { callAI, listModels, aiSettings, applyEdit, aiSummary, AiError } from '../ai.mjs';
import * as ollama from '../ollama.mjs';
import * as kb from '../knowledge.mjs';
import * as models from '../models.mjs';
import { broadcast } from '../live.mjs';

/** Turns an AI failure into a response the app can show. Ollama's own
 *  message is kept: "model not found" is exactly what the admin needs. */
function aiFailure(err){
  if(!(err instanceof AiError)) return err;
  return new HttpError(err.notConfigured ? 409 : 502, err.message, err.notConfigured ? 'ai_not_configured' : 'ai_failed', {
    aiStatus: err.status || null, unreachable: !!err.unreachable
  });
}

export default function register(r){

  r.get('/api/settings/ai', ctx => aiSettings(getSetting(ctx.db, 'ai', {})), { perm: 'settings.manage' });

  r.put('/api/settings/ai', async ctx => {
    const edit = await ctx.json();
    let next;
    try { next = applyEdit(getSetting(ctx.db, 'ai', {}), edit); }
    catch (e) { throw badRequest(e.message); }
    putSetting(ctx.db, 'ai', next);
    ctx.log('AI settings changed', { text: [next.chatModel, next.visionModel].filter(Boolean).join(', ') || 'No models picked' });
    broadcast('ai', aiSummary(next));
    return next;
  }, { perm: 'settings.manage' });

  /**
   * `{ system, content }` in, `{ text }` out.
   *
   * With `knowledge: "<question>"`, the knowledge base passages and staff
   * corrections most like the question are added to the system prompt,
   * and `sources` lists them. If the embedding model can't be reached,
   * the answer comes without them and `knowledgeNote` says why.
   */
  r.post('/api/ai/chat', async ctx => {
    const body = await ctx.json(80 * MB);
    if(typeof body.system !== 'string' || !body.system) throw badRequest('Missing the system prompt.');
    if(!(typeof body.content === 'string' || Array.isArray(body.content))) throw badRequest('Missing the content.');
    const settings = getSetting(ctx.db, 'ai', {});
    let system = body.system, sources = null, knowledgeNote = null;
    if(typeof body.knowledge === 'string' && body.knowledge.trim()){
      try {
        const found = await kb.retrieve(ctx.db, aiSettings(settings), body.knowledge.trim().slice(0, 4000));
        const block = kb.contextBlock(found);
        if(block) system = `${system}\n\n${block}`;
        sources = kb.sourcesOf(found);
      } catch (err) {
        if(!(err instanceof ollama.OllamaError)) throw err;
        knowledgeNote = `Answered without the knowledge base: ${err.message}`;
      }
    }
    try {
      return { ...(await callAI(settings, system, body.content)), sources, knowledgeNote };
    } catch (err) {
      throw aiFailure(err);
    }
  }, { perm: 'ai.use' });

  /* ---------------- local models ---------------- */

  /**
   * Everything the Settings screen shows about the local AI: is Ollama
   * up, what is installed, which model does each job, and downloads.
   * Installed models are put on any job without one as a side effect,
   * so a model installed by hand is picked up by opening Settings.
   */
  r.get('/api/ai/local', async ctx => {
    let settings = aiSettings(getSetting(ctx.db, 'ai', {}));
    const base = { url: settings.url, downloads: models.downloadState() };
    let installed, loaded, version;
    try {
      [installed, loaded, version] = await Promise.all([
        listModels(getSetting(ctx.db, 'ai', {})),
        ollama.loadedModels(settings.url).catch(() => []),
        ollama.version(settings.url)
      ]);
    } catch (err) {
      return { ...base, up: false, error: err.message, settings, models: [], loaded: [],
        jobs: models.jobsStatus(settings, []), ready: false };
    }
    settings = models.fillGaps(ctx.db, installed, ctx.log).settings;
    const jobs = models.jobsStatus(settings, installed);
    return { ...base, up: true, version, settings, models: installed, loaded: loaded.map(m => m.name),
      jobs, ready: jobs.every(j => j.installed) };
  }, { perm: 'settings.manage' });

  /** One click: downloads whatever the jobs are missing. Progress
   *  arrives as 'ai-models' events. */
  r.post('/api/ai/local/setup', async ctx => {
    try {
      const out = await models.setup(ctx.db, ctx.log);
      ctx.status = 202;
      return out;
    } catch (err) {
      throw aiFailure(err);
    }
  }, { perm: 'settings.manage' });

  /** Downloads one model by name. */
  r.post('/api/ai/local/pull', async ctx => {
    const { model } = await ctx.json();
    const name = String(model || '').trim();
    if(!/^[A-Za-z0-9._\-\/:]{1,120}$/.test(name)) throw badRequest('Give a model name like minicpm-v or qwen2.5:7b.');
    ctx.status = 202;
    return { downloads: models.enqueue(ctx.db, [name], ctx.log) };
  }, { perm: 'settings.manage' });

  /** A tiny real request, for the Settings "Test" button: proves Ollama
   *  answers and the chat model loads. */
  r.post('/api/ai/test', async ctx => {
    const started = Date.now();
    try {
      const out = await callAI(getSetting(ctx.db, 'ai', {}), 'You are a connectivity check. Reply with the single word OK.', 'Reply with OK.');
      return { ok: true, ms: Date.now() - started, reply: out.text.slice(0, 200) };
    } catch (err) {
      if(!(err instanceof AiError)) throw err;
      return { ok: false, ms: Date.now() - started, error: err.message };
    }
  }, { perm: 'settings.manage' });
}
