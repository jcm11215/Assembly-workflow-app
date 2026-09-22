/**
 * AI settings (admin) and the one endpoint the app uses to talk to the
 * AI: POST /api/ai/chat.
 */
import { HttpError, badRequest, MB } from '../http.mjs';
import { getSetting, putSetting } from '../db.mjs';
import { callAI, listModels, adminView, applyEdit, aiSummary, AiError, PROVIDER_LABELS, normalizeSettings } from '../ai.mjs';
import { broadcast } from '../live.mjs';

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
   */
  r.post('/api/ai/chat', async ctx => {
    const body = await ctx.json(80 * MB);
    if(typeof body.system !== 'string' || !body.system) throw badRequest('Missing the system prompt.');
    if(!(typeof body.content === 'string' || Array.isArray(body.content))) throw badRequest('Missing the content.');
    try {
      return await callAI(getSetting(ctx.db, 'ai', {}), body.system, body.content);
    } catch (err) {
      throw aiFailure(err);
    }
  }, { perm: 'ai.use' });

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
