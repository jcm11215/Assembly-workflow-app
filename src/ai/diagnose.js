/**
 * "Test connection" for the AI provider.
 *
 * WHY THIS EXISTS. When a scan fails with a provider error, nobody can
 * see what actually went wrong: the app paraphrases the message, the
 * paraphrase is a guess, and the only way to find out more was to read
 * the browser console or have someone query the activity log. That turns
 * a thirty-second problem ("wrong kind of key") into a long
 * back-and-forth where each side is guessing at the other's evidence.
 *
 * So this asks the provider directly, in the smallest possible call, and
 * reports what it says VERBATIM. It checks the things that fail
 * independently -- is the key the right shape, is the key accepted, does
 * the configured model exist, can it actually take an image -- because
 * each one produces a different error and needs a different fix.
 *
 * Nothing here is interpreted away. The provider's own sentence is
 * always included, so if the reasoning below is wrong the raw evidence
 * is still in front of the person reading it.
 */
import { getAiProvider, getApiKey, getOpenRouterKey, getOpenRouterModel,
         getLocalAiUrl, getLocalAiToken, getLocalAiFallback, localAiUrlProblem } from './keys.js';
import { getGeminiModel } from './keys.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** One line of the report. `ok` false marks the step that failed. */
const step = (name, ok, detail, raw) => ({ name, ok, detail, raw: raw || '' });

async function readJson(res){
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; }
  catch { return { json: null, text }; }
}

/** The provider's own error sentence, wherever it buried it. */
function providerMessage(json, text, status){
  const m = json && (
    (json.error && (json.error.message || json.error)) ||
    json.message || json.detail
  );
  if(typeof m === 'string') return m;
  if(m) return JSON.stringify(m);
  return (text || '').slice(0, 300) || `HTTP ${status}`;
}

/* ============================ Gemini ============================ */

/**
 * A Gemini API key is `AIza` + 35 more characters. Anything else is a
 * different kind of Google credential, and the difference matters:
 * an OAuth access token or an AI Studio ephemeral token (these start
 * `AQ.`) is sent as a Bearer header, not as ?key=, so passing one here
 * gets "Request had invalid authentication credentials. Expected OAuth 2
 * access token, login cookie or other valid authentication credential"
 * -- which reads like the app is broken rather than like the key is the
 * wrong type.
 */
export function describeGeminiKeyShape(key){
  const k = (key || '').trim();
  if(!k) return { ok: false, why: 'No Gemini key is saved on this device.' };
  if(/^AIza[\w-]{35}$/.test(k)) return { ok: true, why: 'Looks like a Gemini API key (AIza + 35 characters).' };
  if(/^AQ\./.test(k)) return { ok: true, why: 'An AI Studio key beginning "AQ." -- Google accepts these on this endpoint.' };
  if(/^AIza/.test(k)) return { ok: false, why: `Starts with AIza but is ${k.length} characters; a Gemini API key is 39. Check for a truncated or double-pasted value.` };
  if(/^ya29\./.test(k)) return { ok: false, why: 'This is an OAuth access token (starts "ya29."), not an API key. Get a key from aistudio.google.com/apikey -- it will start with "AIza".' };
  if(/^sk-or-/.test(k)) return { ok: false, why: 'This is an OpenRouter key (starts "sk-or-"), saved in the Gemini field. Either switch the provider to OpenRouter, or paste a Google key here.' };
  if(/^sk-/.test(k)) return { ok: false, why: 'This looks like an OpenAI-style key, not a Google one. Get a key from aistudio.google.com/apikey -- it will start with "AIza".' };
  return { ok: false, why: `Does not look like a Gemini API key (expected "AIza" + 35 characters, got ${k.length} characters starting "${k.slice(0, 4)}"). Get one from aistudio.google.com/apikey.` };
}

async function diagnoseGemini(){
  const steps = [];
  const key = getApiKey();

  const shape = describeGeminiKeyShape(key);
  if(!key){
    steps.push(step('Key format', false, shape.why));
    return { provider: 'Google Gemini', steps, models: [] };
  }

  // Listing models proves the key independently of the model name, so a
  // rejected key and a model that does not exist stop looking alike.
  let models = [];
  try {
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(key)}`);
    const { json, text } = await readJson(res);
    if(!res.ok){
      const msg = providerMessage(json, text, res.status);
      const busy = res.status === 503 || /overloaded|high demand|currently experiencing/i.test(msg);
      const reason = json && json.error && json.error.status;
      const isWrongType = res.status === 401 || /Expected OAuth 2|unregistered callers/i.test(msg);
      if(!shape.ok) steps.push(step('Key format', false, shape.why));
      steps.push(step('Key accepted by Google', false,
        isWrongType
          ? 'Google got a credential but not one it accepts here -- this is the signature of the wrong KIND of key, not a wrong or expired key. A Gemini API key from aistudio.google.com/apikey (starting "AIza") is what this endpoint wants.'
          : (reason === 'INVALID_ARGUMENT' || /API key not valid/i.test(msg))
            ? 'Google rejected the key itself. Regenerate it at aistudio.google.com/apikey, and check the Generative Language API is enabled for that project.'
            : 'Google refused the request.',
        `HTTP ${res.status} -- ${msg}`));
      return { provider: 'Google Gemini', steps, models: [] };
    }
    models = ((json && json.models) || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''));
    // Google accepting the key settles the format question, whatever the
    // shape rule above thinks. Reporting a format failure next to "40
    // models available" sends people to replace a key that works.
    steps.push(step('Key accepted by Google', true, `${models.length} usable models available to this key.`));
  } catch (e) {
    steps.push(step('Reach Google', false,
      'The request never completed. On a phone this is usually the connection; on a desktop it can also be an extension or a network blocking the request.',
      String(e && e.message || e)));
    return { provider: 'Google Gemini', steps, models: [] };
  }

  const configured = getGeminiModel();
  const exists = models.includes(configured);
  steps.push(step(`Model "${configured}" exists`, exists,
    exists ? 'The configured model is available to this key.'
           : `This key cannot see a model called "${configured}". Available: ${models.slice(0, 8).join(', ')}${models.length > 8 ? ', ...' : ''}`));

  if(exists){
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${configured}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }] })
      });
      const { json, text } = await readJson(res);
      const msg = providerMessage(json, text, res.status);
      const busy = res.status === 503 || /overloaded|high demand|currently experiencing/i.test(msg);
      // A quota error is not a broken setup and must not read like one:
      // everything above it passed, and the fix is time, not a new key.
      const quota = res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg);
      const cap = /limit:\s*(\d+)/i.exec(msg);
      steps.push(res.ok
        ? step('A real request works', true, 'Google answered a test prompt.')
        : step('A real request works', false,
               busy
                 ? `Nothing is wrong with the key or the model -- "${configured}" is just too busy right now, which is a property of the hour rather than of your setup. Scans retry and then move to another model on their own; if this keeps happening, pick a different one under Model below.`
                 : quota
                 ? `Nothing is wrong with the key or the model -- this account is simply out of free-tier requests for the moment${cap ? ` (cap: ${cap[1]} per minute)` : ''}. A scan spends three or four, and testing spends two. Wait a minute and try again, scan fewer pages at once, or switch to OpenRouter in Settings. Scans now wait and retry on their own, so this is a pause rather than a failure.`
                 : 'The key and model are fine but the call was refused.',
               `HTTP ${res.status} -- ${msg}`));
    } catch (e) {
      steps.push(step('A real request works', false, 'The request never completed.', String(e && e.message || e)));
    }
  }

  return { provider: 'Google Gemini', steps, models };
}

/* ========================== OpenRouter ========================== */

async function diagnoseOpenRouter(){
  const steps = [];
  const key = getOpenRouterKey();
  const configured = getOpenRouterModel();

  const looksRight = /^sk-or-/.test(key);
  steps.push(step('Key format', !!key && looksRight,
    !key ? 'No OpenRouter key is saved on this device.'
         : looksRight ? 'Looks like an OpenRouter key (sk-or-...).'
         : `An OpenRouter key starts "sk-or-"; this one starts "${key.slice(0, 6)}". If it is a Google key, switch the provider to Gemini instead.`));

  // The model list needs no key, so it separates "cannot reach
  // OpenRouter at all" from "the key is bad" -- two failures that both
  // arrive as "Failed to fetch" otherwise.
  let visionFree = [];
  let ids = [];
  try {
    const res = await fetch(`${OPENROUTER_BASE}/models`);
    const { json, text } = await readJson(res);
    if(!res.ok) throw new Error(providerMessage(json, text, res.status));
    const all = (json && json.data) || [];
    ids = all.map(m => m.id);
    visionFree = all
      .filter(m => ((m.architecture && m.architecture.input_modalities) || []).includes('image'))
      .filter(m => /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0))
      .map(m => m.id);
    steps.push(step('Reach OpenRouter', true, `${ids.length} models listed, ${visionFree.length} of them free and able to read images.`));
  } catch (e) {
    steps.push(step('Reach OpenRouter', false,
      'Could not even load the public model list, which needs no key -- so this is the connection, a firewall, or an extension, not your key.',
      String(e && e.message || e)));
    return { provider: 'OpenRouter', steps, models: [] };
  }

  if(ids.length){
    const exists = ids.includes(configured);
    steps.push(step(`Model "${configured}" exists`, exists,
      exists ? 'The configured model is a real model ID.'
             : `There is no model with the ID "${configured}", so every scan fails before it starts. Free models that can read drawings: ${visionFree.slice(0, 6).join(', ') || '(none listed right now)'}`));
  }

  if(!key) return { provider: 'OpenRouter', steps, models: visionFree };

  // This endpoint exists only to validate a key and report its limits.
  try {
    const res = await fetch(`${OPENROUTER_BASE}/key`, { headers: { Authorization: `Bearer ${key}` } });
    const { json, text } = await readJson(res);
    if(!res.ok){
      steps.push(step('Key accepted by OpenRouter', false,
        res.status === 401 ? 'OpenRouter rejected the key. Regenerate it at openrouter.ai/keys.' : 'OpenRouter refused the request.',
        `HTTP ${res.status} -- ${providerMessage(json, text, res.status)}`));
      return { provider: 'OpenRouter', steps, models: visionFree };
    }
    const d = (json && json.data) || {};
    const limit = d.limit == null ? 'no spend limit' : `limit ${d.limit}, used ${d.usage ?? 0}`;
    steps.push(step('Key accepted by OpenRouter', true, `Key is valid (${limit}).`));
  } catch (e) {
    steps.push(step('Key accepted by OpenRouter', false, 'The request never completed.', String(e && e.message || e)));
    return { provider: 'OpenRouter', steps, models: visionFree };
  }

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Assembly Workflow Tracker' },
      body: JSON.stringify({ model: configured, max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
    });
    const { json, text } = await readJson(res);
    const failed = !res.ok || (json && json.error);
    steps.push(failed
      ? step('A real request works', false, 'The key is valid but this model refused the call.',
             `HTTP ${res.status} -- ${providerMessage(json, text, res.status)}`)
      : step('A real request works', true, 'OpenRouter answered a test prompt.'));
  } catch (e) {
    steps.push(step('A real request works', false, 'The request never completed.', String(e && e.message || e)));
  }

  return { provider: 'OpenRouter', steps, models: visionFree };
}

/* =========================== Local AI =========================== */

/**
 * Each step fails for a different reason with a different fix: the
 * address, the desktop being off, the key, no vision model, Ollama
 * down. "Failed to fetch" covers the first two alike, so the unguarded
 * health check runs before anything that needs the key.
 */
export async function diagnoseLocal(){
  const PROVIDER = 'Local AI';
  const steps = [];
  const base = getLocalAiUrl();
  const key = getLocalAiToken();

  const problem = base ? localAiUrlProblem(base)
    : 'The shop\'s server address hasn\'t been set yet. An admin sets it once in Settings -> Shop Server, for every device.';
  steps.push(step('Address', !problem, problem || `Using ${base}`));
  if(problem) return { provider: PROVIDER, steps, models: [] };

  try {
    const res = await fetch(`${base}/api/health`);
    const { json, text } = await readJson(res);
    if(!res.ok || !(json && json.ok)){
      steps.push(step('Reach the local AI', false,
        res.status === 502 || res.status === 504
          ? 'Tailscale answered but the local AI behind it did not -- the service is stopped, or the desktop is asleep. On the desktop: sudo systemctl restart localai'
          : 'Something answered at that address, but not the local AI. Check the address.',
        `HTTP ${res.status} -- ${providerMessage(json, text, res.status)}`));
      return { provider: PROVIDER, steps, models: [] };
    }
    steps.push(step('Reach the local AI', true, 'The server is up.'));
  } catch (e) {
    steps.push(step('Reach the local AI', false,
      'The request never completed. Either the desktop is off or off Tailscale, the address is wrong, ' +
      `or the local AI doesn't allow this page's address (${(typeof location !== 'undefined' && location.origin) || 'this site'}) ` +
      '-- that is "tracker_origin" in its config.json.',
      String(e && e.message || e)));
    return { provider: PROVIDER, steps, models: [] };
  }

  if(!key){
    steps.push(step('Sign-in accepted', false, 'Not signed in on this device -- sign in to the tracker and try again.'));
    return { provider: PROVIDER, steps, models: [] };
  }

  let info;
  try {
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
    const { json, text } = await readJson(res);
    if(!res.ok){
      steps.push(step('Sign-in accepted', false,
        res.status === 401 ? 'The local AI didn\'t accept your tracker sign-in. Sign out and back in; if it still fails, ' +
                             'the desktop needs its latest update (it checks sign-ins with Supabase), or your account is deactivated.'
                           : 'The local AI refused the request.',
        `HTTP ${res.status} -- ${providerMessage(json, text, res.status)}`));
      return { provider: PROVIDER, steps, models: [] };
    }
    info = json || {};
    steps.push(step('Sign-in accepted', true, 'The local AI recognized your tracker sign-in.'));
  } catch (e) {
    steps.push(step('Sign-in accepted', false, 'The request never completed.', String(e && e.message || e)));
    return { provider: PROVIDER, steps, models: [] };
  }

  const models = ((info.data) || []).map(m => m.id);
  if(!info.ollama_up){
    steps.push(step('Ollama running', false,
      'The local AI is up but Ollama, which runs the models, is not answering. On the desktop: sudo systemctl restart ollama'));
    return { provider: PROVIDER, steps, models };
  }
  const vision = info.vision_model || '';
  const visionInstalled = !!vision && models.includes(vision);
  steps.push(step('Vision model for drawings', visionInstalled,
    !vision ? 'No vision model is set, so blueprint scans will be refused (the assistant still works). Pick one on the local AI under System -> Vision; minicpm-v runs well on this desktop.'
    : visionInstalled ? `Scans are read by ${vision}.`
    : `The vision model is set to "${vision}" but it isn't installed. Pull it from the local AI's Models tab.`));

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'auto', max_tokens: 8, stream: false,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }] })
    });
    const { json, text } = await readJson(res);
    const failed = !res.ok || (json && json.error);
    steps.push(failed
      ? step('A real request works', false, `The chat model (${info.chat_model || 'unset'}) refused the call.`,
             `HTTP ${res.status} -- ${providerMessage(json, text, res.status)}`)
      : step('A real request works', true, `${info.chat_model || 'The chat model'} answered a test prompt.`));
  } catch (e) {
    steps.push(step('A real request works', false, 'The request never completed.', String(e && e.message || e)));
  }

  // Not a pass/fail: whether a dead desktop stops scans or not.
  const backup = getLocalAiFallback() && !!getOpenRouterKey();
  steps.push(step('Backup when the desktop is off', true,
    backup ? 'OpenRouter reads drawings when the local AI can\'t be reached.'
           : getLocalAiFallback() ? 'None -- add an OpenRouter key to keep scanning while the desktop is off.'
           : 'Off -- scans fail while the desktop is off.'));

  return { provider: PROVIDER, steps, models };
}

/**
 * @returns {{provider, steps, models, ok, firstFailure}} steps in the
 *          order they were tried; the first failing one is the thing to
 *          fix, since each step depends on the ones before it.
 */
export async function diagnoseActiveProvider(){
  const p = getAiProvider();
  const result = p === 'local' ? await diagnoseLocal()
    : p === 'openrouter' ? await diagnoseOpenRouter() : await diagnoseGemini();
  const firstFailure = result.steps.find(s => !s.ok) || null;
  return { ...result, ok: !firstFailure, firstFailure };
}
