/**
 * AI settings (admin), the one endpoint the app uses to talk to the AI
 * (POST /api/ai/chat), and managing the local models Ollama runs.
 */
import { HttpError, badRequest, conflict, MB } from '../http.mjs';
import { getSetting, putSetting } from '../db.mjs';
import { callAI, listModels, adminView, applyEdit, aiSummary, AiError, PROVIDER_LABELS, normalizeSettings } from '../ai.mjs';
import * as ollama from '../ollama.mjs';
import * as kb from '../knowledge.mjs';
import { broadcast } from '../live.mjs';
import { can } from '../../shared/roles.js';

/** The model download in progress, if any. One at a time: two big
 *  downloads at once only make both slower. */
let pulling = null;
const toAdmins = u => can(u.role, 'settings.manage');

/** Turns a provider failure into a response the app can show. The
 *  provider's own message is kept: "API key not valid" is exactly what
 *  the admin needs to read. */
function aiFailure(err){
  if(!(err instanceof AiError)) return err;
  const status = err.notConfigured ? 409 : err.status === 429 ? 429 : 502;
  return new HttpError(status, err.message, err.notConfigured ? 'ai_not_configured' : 'ai_failed', {
    provider: err.provider, providerStatus: err.status || null, unreachable: !!err.unreachable
  });
}

export default function register(r){

  r.get('/api/settings/ai', ctx => adminView(getSetting(ctx.db, 'ai', {})), { perm: 'settings.manage' });

  r.put('/api/settings/ai', async ctx => {
    const edit = await ctx.json();
    let next;
    try { next = applyEdit(getSetting(ctx.db, 'ai', {}), edit); }
    catch (e) { throw badRequest(e.message); }
    putSetting(ctx.db, 'ai', next);
    ctx.log('AI settings changed', { text: `Provider: ${PROVIDER_LABELS[next.provider]}` });
    broadcast('ai', aiSummary(next));
    return adminView(next);
  }, { perm: 'settings.manage' });

  /**
   * `{ system, content }` in, `{ text, substitution }` out. `substitution`
   * says when a different model or provider answered than the one set,
   * so the app can say so rather than change it silently.
   *
   * With `knowledge: "<question>"`, the knowledge base passages and staff
   * corrections most like the question are added to the system prompt,
   * and `sources` lists them. Whichever provider answers, the search
   * itself runs on the local embedding model; if that is off, the answer
   * comes without them and `knowledgeNote` says why.
   */
  r.post('/api/ai/chat', async ctx => {
    const body = await ctx.json(80 * MB);
    if(typeof body.system !== 'string' || !body.system) throw badRequest('Missing the system prompt.');
    if(!(typeof body.content === 'string' || Array.isArray(body.content))) throw badRequest('Missing the content.');
    const settings = getSetting(ctx.db, 'ai', {});
    let system = body.system, sources = null, knowledgeNote = null;
    if(typeof body.knowledge === 'string' && body.knowledge.trim()){
      try {
        const found = await kb.retrieve(ctx.db, normalizeSettings(settings).local, body.knowledge.trim().slice(0, 4000));
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

  /** Is Ollama up, what is installed and loaded, and any download running. */
  r.get('/api/ai/local', async ctx => {
    const local = normalizeSettings(getSetting(ctx.db, 'ai', {})).local;
    try {
      const [models, loaded, version] = await Promise.all([
        listModels(getSetting(ctx.db, 'ai', {}), 'local'),
        ollama.loadedModels(local.url).catch(() => []),
        ollama.version(local.url)
      ]);
      return { up: true, url: local.url, version, models, loaded: loaded.map(m => m.name), pulling };
    } catch (err) {
      return { up: false, url: local.url, error: err.message, models: [], loaded: [], pulling };
    }
  }, { perm: 'settings.manage' });

  /** Starts downloading a model; progress arrives as 'ai-pull' events. */
  r.post('/api/ai/local/pull', async ctx => {
    const { model } = await ctx.json();
    const name = String(model || '').trim();
    if(!/^[A-Za-z0-9._\-\/:]{1,120}$/.test(name)) throw badRequest('Give a model name like minicpm-v or qwen2.5:7b.');
    if(pulling) throw conflict(`Already downloading ${pulling.model}. Wait for it to finish.`, 'busy');
    const local = normalizeSettings(getSetting(ctx.db, 'ai', {})).local;
    pulling = { model: name, status: 'starting', total: 0, completed: 0 };
    broadcast('ai-pull', pulling, toAdmins);
    ctx.log('AI model download', { text: name });
    let last = 0;
    ollama.pull(local.url, name, p => {
      pulling = { model: name, status: p.status || '', total: p.total || pulling.total, completed: p.completed || 0 };
      if(Date.now() - last > 500){ last = Date.now(); broadcast('ai-pull', pulling, toAdmins); }
    }).then(() => {
      broadcast('ai-pull', { model: name, status: 'done', done: true }, toAdmins);
    }).catch(err => {
      broadcast('ai-pull', { model: name, status: 'failed', error: err.message, done: true }, toAdmins);
    }).finally(() => { pulling = null; });
    ctx.status = 202;
    return { pulling };
  }, { perm: 'settings.manage' });

  /** A tiny real request to the chosen provider, for the Settings "Test"
   *  button: proves the key, the model and the network path in one go. */
  r.post('/api/ai/test', async ctx => {
    const settings = getSetting(ctx.db, 'ai', {});
    const s = normalizeSettings(settings);
    const started = Date.now();
    try {
      const out = await callAI(settings, 'You are a connectivity check. Reply with the single word OK.', 'Reply with OK.');
      return { ok: true, provider: s.provider, ms: Date.now() - started, reply: out.text.slice(0, 200), substitution: out.substitution };
    } catch (err) {
      if(!(err instanceof AiError)) throw err;
      return { ok: false, provider: s.provider, ms: Date.now() - started, error: err.message };
    }
  }, { perm: 'settings.manage' });

  r.get('/api/ai/models', async ctx => {
    try {
      return { models: await listModels(getSetting(ctx.db, 'ai', {}), ctx.query.get('provider')) };
    } catch (err) {
      throw aiFailure(err);
    }
  }, { perm: 'settings.manage' });
}
