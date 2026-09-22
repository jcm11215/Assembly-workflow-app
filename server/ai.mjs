/**
 * AI providers, called from the server.
 *
 * The keys live here, set once by an admin in Settings, instead of on
 * every phone and tablet. The app sends a prompt and content blocks to
 * POST /api/ai/chat; this module sends them to whichever provider is
 * chosen:
 *
 *   gemini      Google Gemini API (key + model)
 *   openrouter  OpenRouter (key + model)
 *   local       the shop's own AI server, OpenAI-compatible
 *               (address + access key), optionally falling back to
 *               OpenRouter when it is off
 *
 * Content is a string or an array of blocks:
 *   { type: 'text', text }
 *   { type: 'image', source: { media_type, data }, textLayer?: { page, text } }
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';

/** Models to try, in order, when the chosen Gemini model is overloaded --
 *  closest to the job of reading a dense drawing first. */
const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-pro-latest'];

export const PROVIDERS = ['gemini', 'openrouter', 'local'];
export const PROVIDER_LABELS = { gemini: 'Google Gemini', openrouter: 'OpenRouter', local: 'Local AI' };

/* ---------------- settings ---------------- */

export function normalizeSettings(s){
  s = s || {};
  return {
    provider: PROVIDERS.includes(s.provider) ? s.provider : 'gemini',
    gemini: { key: s.gemini?.key || '', model: s.gemini?.model || DEFAULT_GEMINI_MODEL },
    openrouter: { key: s.openrouter?.key || '', model: s.openrouter?.model || DEFAULT_OPENROUTER_MODEL },
    local: {
      url: normalizeUrl(s.local?.url || ''),
      key: s.local?.key || '',
      fallback: s.local?.fallback !== false
    }
  };
}

/** "desktop.tailnet.ts.net" -> "https://desktop.tailnet.ts.net"; trailing
 *  slashes and a pasted "/v1" dropped. */
export function normalizeUrl(url){
  let u = String(url || '').trim();
  if(!u) return '';
  if(!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function isReady(s){
  if(s.provider === 'gemini') return !!s.gemini.key;
  if(s.provider === 'openrouter') return !!s.openrouter.key;
  return !!(s.local.url && s.local.key);
}

/** What any signed-in person may know: which provider, and whether it is
 *  set up. Never the keys. */
export function aiSummary(raw){
  const s = normalizeSettings(raw);
  return { provider: s.provider, label: PROVIDER_LABELS[s.provider], ready: isReady(s) };
}

const hint = key => (key ? `…${key.slice(-4)}` : '');

/** What an admin sees in Settings: everything but the keys themselves. */
export function adminView(raw){
  const s = normalizeSettings(raw);
  return {
    provider: s.provider,
    gemini: { model: s.gemini.model, keySet: !!s.gemini.key, keyHint: hint(s.gemini.key) },
    openrouter: { model: s.openrouter.model, keySet: !!s.openrouter.key, keyHint: hint(s.openrouter.key) },
    local: { url: s.local.url, fallback: s.local.fallback, keySet: !!s.local.key, keyHint: hint(s.local.key) }
  };
}

/**
 * Applies an admin's edit. For each key: absent leaves it as is, '' clears
 * it, anything else replaces it -- so a form can be saved without
 * re-entering keys it never showed.
 */
export function applyEdit(raw, edit){
  const s = normalizeSettings(raw);
  if(edit.provider !== undefined){
    if(!PROVIDERS.includes(edit.provider)) throw new Error('Unknown AI provider.');
    s.provider = edit.provider;
  }
  for(const p of ['gemini', 'openrouter', 'local']){
    const e = edit[p];
    if(!e) continue;
    if(e.key !== undefined) s[p].key = String(e.key).trim();
    if(e.model !== undefined && p !== 'local') s[p].model = String(e.model).trim() || s[p].model;
  }
  if(edit.local){
    if(edit.local.url !== undefined) s.local.url = normalizeUrl(edit.local.url);
    if(edit.local.fallback !== undefined) s.local.fallback = !!edit.local.fallback;
  }
  return s;
}

/* ---------------- errors ---------------- */

export class AiError extends Error {
  constructor(message, { provider, status, retryAfterMs, unreachable, notConfigured } = {}){
    super(message);
    Object.assign(this, { provider, status, retryAfterMs, unreachable, notConfigured });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readJson(res, provider){
  const raw = await res.text();
  try { return JSON.parse(raw); }
  catch { throw new AiError(`Unexpected response from ${PROVIDER_LABELS[provider]} (not JSON).`, { provider, status: res.status }); }
}

/* ---------------- Gemini ---------------- */

function toGeminiParts(content){
  if(typeof content === 'string') return [{ text: content }];
  return content.map(b => b.type === 'image'
    ? { inline_data: { mime_type: b.source.media_type, data: b.source.data } }
    : { text: b.text || '' });
}

/** How long Google says to wait after a 429, in ms, or null. */
export function retryAfterMs(data, headers){
  for(const d of data?.error?.details || []){
    const m = /^([\d.]+)s$/.exec(String(d?.retryDelay || ''));
    if(m) return Math.ceil(parseFloat(m[1]) * 1000);
  }
  const inline = /retry in ([\d.]+)\s*s/i.exec(data?.error?.message || '');
  if(inline) return Math.ceil(parseFloat(inline[1]) * 1000);
  const header = headers?.get?.('retry-after');
  return header && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : null;
}

async function geminiOnce(s, system, content, model){
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.gemini.key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: toGeminiParts(content) }]
      }),
      signal: AbortSignal.timeout(5 * 60000)
    });
  const data = await readJson(res, 'gemini');
  if(!res.ok){
    throw new AiError(data?.error?.message || `Gemini request failed (${res.status})`, {
      provider: 'gemini', status: res.status, retryAfterMs: res.status === 429 ? retryAfterMs(data, res.headers) : null
    });
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').filter(Boolean).join('\n');
}

/**
 * Rate limited (429): wait as long as Google says, retry the same model.
 * Server wobble (5xx): back off briefly, retry. Model overloaded: after
 * a couple of tries move to another model, and say which one answered.
 * A bad key or missing model is never retried.
 */
async function callGemini(s, system, content){
  if(!s.gemini.key) throw new AiError('No Gemini key is set. An admin can add one in Settings.', { provider: 'gemini', notConfigured: true });
  const preferred = s.gemini.model;
  const chain = [preferred, ...GEMINI_FALLBACKS.filter(m => m !== preferred)];
  let last;
  for(let m = 0; m < chain.length; m++){
    for(let attempt = 1; attempt <= 3; attempt++){
      try {
        const text = await geminiOnce(s, system, content, chain[m]);
        return { text, substitution: m > 0 ? { asked: preferred, used: chain[m] } : null };
      } catch (err) {
        last = err;
        const status = err.status;
        const overloaded = status === 503 || /overloaded|high demand|currently experiencing/i.test(err.message);
        const retryable = status === 429 || [500, 502, 503, 504].includes(status);
        if(!retryable) throw err;
        if(attempt === 3){
          if(overloaded && m < chain.length - 1) break;
          throw err;
        }
        await sleep(status === 429 ? Math.max(1000, (err.retryAfterMs || 2000 * attempt) + 250) : 800 * attempt);
      }
    }
  }
  throw last;
}

/* ---------------- OpenRouter ---------------- */

function toOpenAiContent(content, { withTextLayers = false } = {}){
  if(typeof content === 'string') return content;
  const out = [];
  for(const b of content){
    if(b.type === 'image'){
      out.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      // The local model gets each PDF page's selectable text beside its
      // image: exact part numbers beat squinting at a render. Cloud
      // providers read the image alone, as they always have.
      if(withTextLayers && b.textLayer?.text) out.push({ type: 'text', text: textLayerNote(b.textLayer) });
    } else {
      out.push({ type: 'text', text: b.text || '' });
    }
  }
  return out;
}

export function textLayerNote(layer){
  return `Selectable text in the PDF on page ${layer.page} -- the exact characters, but reading ` +
    `order can be jumbled, and anything drawn as lines rather than text is missing. Use it to ` +
    `get part numbers, sizes and table entries exactly right; the image shows where each one sits:\n` +
    layer.text;
}

async function openRouterOnce(s, system, content){
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openrouter.key}`, 'X-Title': 'Assembly Workflow Tracker' },
    body: JSON.stringify({
      model: s.openrouter.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: toOpenAiContent(content) }]
    }),
    signal: AbortSignal.timeout(5 * 60000)
  });
  const data = await readJson(res, 'openrouter');
  if(!res.ok || data?.error){
    let msg = data?.error?.message || `OpenRouter request failed (${res.status})`;
    // The real reason is often one level down, in error.metadata.raw.
    const meta = data?.error?.metadata;
    if(meta?.raw){
      let raw = meta.raw;
      try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; raw = p?.error?.message || p?.message || raw; } catch { /* not JSON */ }
      msg += `: ${raw}`;
    } else if(meta?.provider_name){
      msg += ` (from ${meta.provider_name})`;
    }
    throw new AiError(msg, { provider: 'openrouter', status: res.status });
  }
  const message = data?.choices?.[0]?.message;
  if(!message) throw new AiError('OpenRouter returned no answer. The model may not read images -- pick another in Settings.', { provider: 'openrouter' });
  return message.content || '';
}

/** Retries only failures a fresh attempt can fix (gateway errors, rate
 *  limits, a free-tier backend with no capacity). */
async function callOpenRouter(s, system, content){
  if(!s.openrouter.key) throw new AiError('No OpenRouter key is set. An admin can add one in Settings.', { provider: 'openrouter', notConfigured: true });
  let last;
  for(let attempt = 1; attempt <= 3; attempt++){
    try {
      return { text: await openRouterOnce(s, system, content), substitution: null };
    } catch (err) {
      last = err;
      const transient = /502|bad gateway|failed to apply prompt replacement|timeout|rate.?limit|no.*provider.*available/i.test(err.message);
      if(attempt === 3 || !transient) throw err;
      await sleep(700 * attempt);
    }
  }
  throw last;
}

/* ---------------- Local AI ---------------- */

export const LOCAL_TIMEOUT_MS = 10 * 60000;
const LOCAL_DOWN_MS = 60000;
let localDownUntil = 0;
export function resetLocalState(){ localDownUntil = 0; }

async function localOnce(s, system, content){
  let res;
  try {
    res = await fetch(`${s.local.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.local.key}` },
      body: JSON.stringify({
        model: 'auto',   // the local server picks its vision or chat model
        stream: false,
        messages: [{ role: 'system', content: system }, { role: 'user', content: toOpenAiContent(content, { withTextLayers: true }) }]
      }),
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS)
    });
  } catch (e) {
    const hung = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new AiError(hung
      ? `The local AI took longer than ${LOCAL_TIMEOUT_MS / 60000} minutes to answer.`
      : `Couldn't reach the local AI at ${s.local.url} (${e?.cause?.code || e?.message || 'network error'}).`,
    { provider: 'local', unreachable: true });
  }
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* handled below */ }
  if(!res.ok || data?.error){
    // 502/504: Tailscale saying the machine didn't answer; 503: the
    // server saying its model runtime didn't.
    const unreachable = [502, 503, 504].includes(res.status) || data?.error?.type === 'upstream_unavailable';
    throw new AiError(data?.error?.message || `Local AI request failed (${res.status})`, { provider: 'local', status: res.status, unreachable });
  }
  if(!data) throw new AiError('Unexpected response from the local AI (not JSON).', { provider: 'local', unreachable: true });
  const message = data.choices?.[0]?.message;
  if(!message) throw new AiError('The local AI returned no answer.', { provider: 'local' });
  return message.content || '';
}

async function callLocal(s, system, content){
  if(!s.local.url || !s.local.key){
    throw new AiError('The local AI address and access key are not set. An admin can add them in Settings.', { provider: 'local', notConfigured: true });
  }
  const canFallBack = s.local.fallback && !!s.openrouter.key;
  const fallBack = async why => {
    try {
      const out = await callOpenRouter(s, system, content);
      return { text: out.text, substitution: { asked: 'the local AI', used: `OpenRouter (${s.openrouter.model})`, reason: why } };
    } catch (err) {
      err.message = `The local AI ${why}, and OpenRouter failed too: ${err.message}`;
      throw err;
    }
  };

  if(Date.now() < localDownUntil && canFallBack) return fallBack('was unreachable a moment ago');

  let last;
  for(let attempt = 1; attempt <= 2; attempt++){
    try {
      const text = await localOnce(s, system, content);
      localDownUntil = 0;
      return { text, substitution: null };
    } catch (err) {
      last = err;
      if(err.unreachable){ localDownUntil = Date.now() + LOCAL_DOWN_MS; break; }
      // A model error can be a one-off (it was being loaded); once more.
      if(err.status !== 500 || attempt === 2) break;
      await sleep(1500);
    }
  }
  // Only an unreachable server or a crashing model is routed around. A
  // wrong key or a missing model is a setup problem, shown as it is.
  if((last.unreachable || last.status === 500) && canFallBack){
    return fallBack(last.unreachable ? 'was unreachable' : `failed (${last.message})`);
  }
  throw last;
}

/* ---------------- entry points ---------------- */

export function callAI(rawSettings, system, content){
  const s = normalizeSettings(rawSettings);
  if(s.provider === 'local') return callLocal(s, system, content);
  if(s.provider === 'openrouter') return callOpenRouter(s, system, content);
  return callGemini(s, system, content);
}

/** Models an admin can pick from, live from the provider. */
export async function listModels(rawSettings, provider){
  const s = normalizeSettings(rawSettings);
  if(provider === 'gemini'){
    if(!s.gemini.key) throw new AiError('Save a Gemini key first.', { provider, notConfigured: true });
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { headers: { 'x-goog-api-key': s.gemini.key }, signal: AbortSignal.timeout(20000) });
    const data = await readJson(res, 'gemini');
    if(!res.ok) throw new AiError(data?.error?.message || `Gemini returned ${res.status}`, { provider, status: res.status });
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
      .filter(m => !/-tts$|embedding|aqa|imagen|veo/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  if(provider === 'openrouter'){
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
    const data = await readJson(res, 'openrouter');
    if(!res.ok) throw new AiError(`OpenRouter returned ${res.status}`, { provider, status: res.status });
    return (data.data || [])
      .filter(m => (m.architecture?.input_modalities || []).includes('image'))
      .map(m => ({ id: m.id, name: m.name || m.id, free: /:free$/.test(m.id) || Number(m.pricing?.prompt) === 0 }))
      .sort((a, b) => (b.free - a.free) || a.name.localeCompare(b.name));
  }
  throw new AiError('The local AI picks its own model.', { provider });
}
