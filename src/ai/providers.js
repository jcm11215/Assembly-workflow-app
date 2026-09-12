/**
 * Provider dispatch. callAI() is the ONLY entry point the rest of the app
 * uses; swapping or adding a provider touches nothing outside this file.
 * `content` shape is provider-neutral: a string, or an array of
 * {type:'text'|'image', ...} blocks.
 */


import { getAiProvider, getApiKey, getOpenRouterKey, getOpenRouterModel } from './keys.js';

export const GEMINI_MODEL = 'gemini-3.6-flash';

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

async function callGeminiOnce(systemPrompt, content){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('NO_API_KEY');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
    throw err;
  }
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return parts ? parts.map(p=>p.text||'').filter(Boolean).join('\n') : '';
}

/**
 * Gemini had no retry at all, which made the free tier's per-minute cap
 * fatal to a scan rather than a short pause: one 429 and the pass was
 * lost. A quota error is the most retryable failure there is -- the
 * server even says how long to wait -- so it waits and tries again.
 * A rejected key or a missing model is not retried, since neither
 * resolves itself and retrying only delays the real message.
 */
export async function callGeminiAPI(systemPrompt, content){
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++){
    try {
      return await callGeminiOnce(systemPrompt, content);
    } catch (err) {
      lastErr = err;
      if(err.message === 'NO_API_KEY' || err.status !== 429 || attempt === MAX_ATTEMPTS) throw err;
      // Google's own number, plus a little, and never less than a second.
      const wait = Math.max(1000, (err.retryAfterMs || 2000 * attempt) + 250);
      console.warn(`Gemini rate-limited; waiting ${wait}ms before attempt ${attempt + 1}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
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
// Every call site in the app goes through this one function -- it routes
// to whichever provider is currently selected, so nothing else needs to
// know or care which backend is active.

// Every call site in the app goes through this one function -- it routes
// to whichever provider is currently selected, so nothing else needs to
// know or care which backend is active.
export async function callClaudeAPI(systemPrompt, content){
  return getAiProvider()==='openrouter'
    ? callOpenRouterAPI(systemPrompt, content)
    : callGeminiAPI(systemPrompt, content);
}

export { callClaudeAPI as callAI };
