/**
 * Provider dispatch. callAI() is the ONLY entry point the rest of the app
 * uses; swapping or adding a provider touches nothing outside this file.
 * `content` shape is provider-neutral: a string, or an array of
 * {type:'text'|'image', ...} blocks.
 */


import { DEFAULT_GEMINI_MODEL, getAiProvider, getApiKey, getGeminiModel, getOpenRouterKey, getOpenRouterModel,
         getLocalAiUrl, getLocalAiKey, getLocalAiFallback } from './keys.js';

/** Kept as a live getter, not a constant: the model is a setting now,
 *  because an overloaded model is fixed by using a different one. */
export { DEFAULT_GEMINI_MODEL };
export const GEMINI_MODEL = DEFAULT_GEMINI_MODEL;

/**
 * Models to fall back to when the chosen one is too busy to answer.
 *
 * Ordered by how close each is to the default's job -- reading a dense
 * engineering drawing -- so a substitution degrades gently rather than
 * landing on whatever happened to be free. Only used when the provider
 * says the model itself is overloaded, never to paper over a bad key or
 * a genuine refusal.
 */
const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-pro-latest'];

// Two interchangeable AI backends, picked in Settings -- Google's free
// Gemini API by default, or OpenRouter as a backup/alternative (useful if
// Gemini's free-tier rate limit gets hit, or to try a different model for
// blueprint reading). Both keys are stored only in this browser and sent
// directly to their respective provider; never to each other or anywhere
// else. `content` uses the same shape either way: a plain string, or an
// array of {type:'text', text} / {type:'image', source:{media_type, data}}.

// Two interchangeable AI backends, picked in Settings -- Google's free
// Gemini API by default, or OpenRouter as a backup/alternative (useful if
// Gemini's free-tier rate limit gets hit, or to try a different model for
// blueprint reading). Both keys are stored only in this browser and sent
// directly to their respective provider; never to each other or anywhere
// else. `content` uses the same shape either way: a plain string, or an
// array of {type:'text', text} / {type:'image', source:{media_type, data}}.
export function toGeminiParts(content){
  if(typeof content === 'string') return [{ text: content }];
  return content.map(block=>{
    if(block.type === 'image'){
      return { inline_data: { mime_type: block.source.media_type, data: block.source.data } };
    }
    return { text: block.text || '' };
  });
}

/**
 * How long Google says to wait, in ms, or null.
 *
 * A 429 carries a RetryInfo detail with the exact delay ("retryDelay":
 * "1.719814202s"), and the message repeats it. Honouring the number the
 * server gave beats any backoff curve we could invent: too short and the
 * retry is refused as well, too long and a scan sits idle for no reason.
 */
export function retryAfterMs(data, headers){
  const details = (data && data.error && data.error.details) || [];
  for(const d of details){
    const v = d && (d.retryDelay || d.retry_delay);
    const m = /^([\d.]+)s$/.exec(String(v || ''));
    if(m) return Math.ceil(parseFloat(m[1]) * 1000);
  }
  const msg = (data && data.error && data.error.message) || '';
  const inline = /retry in ([\d.]+)\s*s/i.exec(msg);
  if(inline) return Math.ceil(parseFloat(inline[1]) * 1000);
  const header = headers && typeof headers.get === 'function' && headers.get('retry-after');
  if(header && /^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  return null;
}

async function callGeminiOnce(systemPrompt, content, model){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('NO_API_KEY');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: toGeminiParts(content) }]
    })
  });
  const raw = await response.text();
  let data;
  try{ data = JSON.parse(raw); }catch(e){ throw new Error('Unexpected response from Gemini (not JSON). Please try again.'); }
  if(!response.ok){
    const apiMsg = (data && data.error && data.error.message) ? data.error.message : `Request failed (${response.status})`;
    const err = new Error(apiMsg);
    err.status = response.status;
    // Carried so the retry loop can wait exactly as long as told to.
    if(response.status === 429) err.retryAfterMs = retryAfterMs(data, response.headers);
    err.model = model;
    throw err;
  }
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return parts ? parts.map(p=>p.text||'').filter(Boolean).join('\n') : '';
}

/** A server-side wobble, as opposed to anything about the request. The
 *  provider's own advice for these is to try again. */
function isTransientServerError(status){
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** The model itself is too busy, which no amount of retrying the SAME
 *  model reliably fixes -- a different one does. */
function isModelOverloaded(status, message){
  return status === 503 || /overloaded|high demand|currently experiencing/i.test(message || '');
}

/**
 * Gemini had no retry at all, which made a passing failure fatal to a
 * scan rather than a short pause: one 429 and the reading was lost.
 *
 * Three kinds of failure, three responses:
 *   - rate limited (429): wait exactly as long as the server says, and
 *     try the same model again. The quota clears on its own.
 *   - server wobble (500/502/503/504): back off briefly and retry. The
 *     provider's own advice for these is to try again.
 *   - model overloaded: retrying the same model is what Google is
 *     telling us not to do -- "spikes in demand are usually temporary"
 *     is about that model. So after a couple of attempts it moves to
 *     another model the key can use, and says which one answered rather
 *     than silently changing what read the drawing.
 *   - a rejected key or a missing model is never retried, since neither
 *     resolves itself and retrying only delays the real message.
 */
export async function callGeminiAPI(systemPrompt, content){
  const preferred = getGeminiModel();
  const chain = [preferred, ...GEMINI_FALLBACKS.filter(m => m !== preferred)];
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for(let m = 0; m < chain.length; m++){
    const model = chain[m];
    for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++){
      try {
        const out = await callGeminiOnce(systemPrompt, content, model);
        if(model !== preferred){
          console.warn(`Gemini: "${preferred}" was unavailable; "${model}" answered instead`);
          lastSubstitution = { asked: preferred, used: model };
        }
        return out;
      } catch (err) {
        lastErr = err;
        if(err.message === 'NO_API_KEY') throw err;

        const status = err.status;
        const overloaded = isModelOverloaded(status, err.message);
        const retryable = status === 429 || isTransientServerError(status);
        if(!retryable) throw err;                       // bad key, missing model, refusal

        // Out of attempts on this model. An overloaded one is worth
        // swapping; a plain wobble means the whole service is unhappy
        // and another model will not help.
        if(attempt === MAX_ATTEMPTS){
          if(overloaded && m < chain.length - 1) break; // try the next model
          throw err;
        }

        const wait = status === 429
          ? Math.max(1000, (err.retryAfterMs || 2000 * attempt) + 250)
          : 800 * attempt;
        console.warn(`Gemini ${status} on "${model}"; waiting ${wait}ms before attempt ${attempt + 1}`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// Which model actually answered, when it was not the one asked for. Read
// by the scan so a substitution is reported rather than silent.
let lastSubstitution = null;
export function takeModelSubstitution(){
  const s = lastSubstitution;
  lastSubstitution = null;
  return s;
}

export function toOpenRouterContent(content){
  if(typeof content === 'string') return content;
  return content.map(block=>{
    if(block.type === 'image'){
      return { type:'image_url', image_url:{ url:`data:${block.source.media_type};base64,${block.source.data}` } };
    }
    return { type:'text', text: block.text || '' };
  });
}

// Errors worth retrying: a fresh call to openrouter/free can route to a
// different backend, which resolves transient gateway failures and the
// occasional multi-image template bug on some free-tier providers.
// Deliberately narrow -- an auth error or "model doesn't support images"
// will fail identically on every attempt, so retrying just wastes time
// and delays the real error reaching the person.
function isTransientOpenRouterError(message){
  return /502|bad gateway|failed to apply prompt replacement|timeout|rate.?limit|no.*provider.*available/i.test(message || '');
}

async function callOpenRouterOnce(systemPrompt, content){
  const apiKey = getOpenRouterKey();
  if(!apiKey) throw new Error('NO_API_KEY');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Title': 'Assembly Workflow Tracker'
    },
    body: JSON.stringify({
      model: getOpenRouterModel(),
      messages: [
        { role:'system', content: systemPrompt },
        { role:'user', content: toOpenRouterContent(content) }
      ]
    })
  });
  const raw = await response.text();
  let data;
  try{ data = JSON.parse(raw); }catch(e){ throw new Error('Unexpected response from OpenRouter (not JSON). Please try again.'); }
  if(!response.ok || (data && data.error)){
    let apiMsg = (data && data.error && data.error.message) ? data.error.message : `Request failed (${response.status})`;
    // OpenRouter often wraps the real reason one level deeper -- e.g. a
    // generic "Provider returned error" with the actual cause sitting in
    // error.metadata.raw (sometimes itself JSON from the underlying model).
    const meta = data && data.error && data.error.metadata;
    if(meta){
      if(meta.raw){
        let rawDetail = meta.raw;
        try{
          const parsedRaw = typeof rawDetail === 'string' ? JSON.parse(rawDetail) : rawDetail;
          rawDetail = (parsedRaw.error && parsedRaw.error.message) || parsedRaw.message || rawDetail;
        }catch(e){ /* raw wasn't JSON -- use it as-is */ }
        apiMsg += `: ${rawDetail}`;
      }else if(meta.provider_name){
        apiMsg += ` (from ${meta.provider_name})`;
      }
    }
    throw new Error(apiMsg);
  }
  const choice = data && data.choices && data.choices[0];
  if(!choice || !choice.message){
    throw new Error('OpenRouter returned no response content. The selected model may not support image input -- check Settings.');
  }
  return (choice.message.content) || '';
}

export async function callOpenRouterAPI(systemPrompt, content){
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++){
    try{
      return await callOpenRouterOnce(systemPrompt, content);
    }catch(err){
      lastErr = err;
      if(err.message === 'NO_API_KEY') throw err;   // never retry -- won't self-resolve
      if(attempt === MAX_ATTEMPTS || !isTransientOpenRouterError(err.message)) throw err;
      // Brief pause before retrying -- gives a busy free-tier backend a
      // moment to clear, and avoids hammering the same failure instantly.
      await new Promise(r => setTimeout(r, 700 * attempt));
    }
  }
  throw lastErr;
}
/* ============================ Local AI ============================
 *
 * The shop's own server. It speaks the same OpenAI chat shape OpenRouter
 * does, so the request is built the same way -- with one addition: the
 * PDF's selectable text travels next to each page image. A small local
 * vision model squinting at a 1600px render of a D-size sheet misreads
 * part numbers that the PDF states outright; handing it the exact
 * characters (and letting the image settle where they sit) is the
 * cheapest accuracy there is. Cloud providers never see this text --
 * their conversions ignore the field -- so their behaviour is unchanged.
 */

/** Longest a request may run before it's treated as hung. A 10-sheet
 *  set on a desktop GPU is a minute or two; this is only for true hangs. */
export const LOCAL_TIMEOUT_MS = 10 * 60 * 1000;

/** After the local AI turns out to be unreachable, how long later calls
 *  skip straight to the fallback rather than each waiting to fail. */
export const LOCAL_DOWN_MS = 60 * 1000;
let localDownUntil = 0;

/** Test hook: forget that the local AI was recently down. */
export function resetLocalAiState(){ localDownUntil = 0; lastSubstitution = null; }

export function textLayerNote(layer){
  return `Selectable text in the PDF on page ${layer.page} -- the exact characters, but reading ` +
    `order can be jumbled, and anything drawn as lines rather than text is missing. Use it to ` +
    `get part numbers, sizes and table entries exactly right; the image shows where each one sits:\n` +
    layer.text;
}

export function toLocalContent(content){
  if(typeof content === 'string') return content;
  const out = [];
  for(const block of content){
    if(block.type === 'image'){
      out.push({ type:'image_url', image_url:{ url:`data:${block.source.media_type};base64,${block.source.data}` } });
      // After its image, before the next page's label, so the server's
      // "images in order: PDF page 1; PDF page 2" still pairs up.
      if(block.textLayer && block.textLayer.text) out.push({ type:'text', text: textLayerNote(block.textLayer) });
    }else{
      out.push({ type:'text', text: block.text || '' });
    }
  }
  return out;
}

function localError(message, extra){
  const err = new Error(message);
  err.provider = 'local';
  return Object.assign(err, extra || {});
}

async function callLocalOnce(systemPrompt, content){
  const base = getLocalAiUrl();
  const key = getLocalAiKey();
  if(!base || !key) throw localError('NO_API_KEY');

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), LOCAL_TIMEOUT_MS) : null;
  let response;
  try{
    response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'auto',            // the server picks: its vision model for drawings, chat model otherwise
        stream: false,
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user', content: toLocalContent(content) }
        ]
      }),
      signal: ctrl ? ctrl.signal : undefined
    });
  }catch(e){
    const hung = e && e.name === 'AbortError';
    throw localError(hung
      ? `The local AI took longer than ${LOCAL_TIMEOUT_MS / 60000} minutes to answer.`
      : `Couldn't reach the local AI at ${base} (${(e && e.message) || 'network error'}).`,
      { unreachable: true });
  }finally{
    if(timer) clearTimeout(timer);
  }

  const raw = await response.text();
  let data = null;
  try{ data = JSON.parse(raw); }catch(e){ /* handled below */ }

  if(!response.ok || (data && data.error)){
    const msg = (data && data.error && data.error.message) || `Request failed (${response.status})`;
    const kind = data && data.error && data.error.type;
    // 502/504 are Tailscale saying the desktop (or the service on it)
    // didn't answer; 503 is the server saying Ollama didn't.
    const unreachable = [502, 503, 504].includes(response.status) || kind === 'upstream_unavailable';
    throw localError(msg, { status: response.status, kind, unreachable });
  }
  if(!data){
    throw localError('Unexpected response from the local AI (not JSON).', { status: response.status, unreachable: true });
  }
  const choice = data.choices && data.choices[0];
  if(!choice || !choice.message) throw localError('The local AI returned no answer.');
  return choice.message.content || '';
}

/** Worth answering from OpenRouter instead: the server is gone, or the
 *  model on it keeps falling over. A wrong key, a request that's too big
 *  (the scan splits those) or a missing vision model are setup problems
 *  and are shown as they are -- quietly routing around them would hide
 *  a broken setup behind scans that seem to work. */
function localNeedsFallback(err){
  return !!(err && (err.unreachable || err.status === 500));
}

function canFallBack(){
  return getLocalAiFallback() && !!getOpenRouterKey();
}

async function fallBackToOpenRouter(systemPrompt, content, why){
  try{
    const out = await callOpenRouterAPI(systemPrompt, content);
    lastSubstitution = { asked: 'the local AI', used: `OpenRouter (${getOpenRouterModel()})`, reason: why };
    console.warn(`Local AI ${why}; OpenRouter answered instead`);
    return out;
  }catch(err){
    // Both failed. The OpenRouter error is the actionable one now, but
    // the person needs to know it's the backup that failed.
    err.provider = 'openrouter';
    err.afterLocalFallback = why;
    throw err;
  }
}

export async function callLocalAPI(systemPrompt, content){
  if(Date.now() < localDownUntil && canFallBack()){
    return fallBackToOpenRouter(systemPrompt, content, 'was unreachable a moment ago');
  }
  let lastErr;
  for(let attempt = 1; attempt <= 2; attempt++){
    try{
      const out = await callLocalOnce(systemPrompt, content);
      localDownUntil = 0;
      return out;
    }catch(err){
      lastErr = err;
      if(err.message === 'NO_API_KEY') throw err;
      if(err.unreachable){
        localDownUntil = Date.now() + LOCAL_DOWN_MS;
        break;                                 // retrying a machine that's off only delays the fallback
      }
      // A model error can be a one-off (it was being swapped out of
      // memory); once more, then give up on it.
      if(err.status !== 500 || attempt === 2) break;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  if(localNeedsFallback(lastErr) && canFallBack()){
    return fallBackToOpenRouter(systemPrompt, content,
      lastErr.unreachable ? 'was unreachable' : `failed (${lastErr.message})`);
  }
  throw lastErr;
}

// Every call site in the app goes through this one function -- it routes
// to whichever provider is currently selected, so nothing else needs to
// know or care which backend is active.
export async function callClaudeAPI(systemPrompt, content){
  const p = getAiProvider();
  if(p === 'local') return callLocalAPI(systemPrompt, content);
  return p === 'openrouter'
    ? callOpenRouterAPI(systemPrompt, content)
    : callGeminiAPI(systemPrompt, content);
}

export { callClaudeAPI as callAI };
