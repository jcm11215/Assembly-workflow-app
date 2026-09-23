/**
 * The AI, called from the server: the shop's own models, run by Ollama
 * (ollama.mjs). Nothing leaves the shop's hardware.
 *
 * The app sends a system prompt and content blocks to POST /api/ai/chat;
 * drawings go to the vision model, everything else to the chat model.
 *
 * Content is a string or an array of blocks:
 *   { type: 'text', text }
 *   { type: 'image', source: { media_type, data }, textLayer?: { page, text } }
 */
import * as ollama from './ollama.mjs';

/* ---------------- settings ---------------- */

const int = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

const KEYS = ['url', 'chatModel', 'visionModel', 'embedModel', 'contextTokens', 'visionContextTokens', 'temperature'];

/**
 * The saved AI settings, cleaned. Settings saved by an earlier version
 * (with a provider and the local ones under `local`) read the same.
 */
export function aiSettings(raw){
  const l = { ...(raw?.local || {}), ...Object.fromEntries(KEYS.filter(k => raw && raw[k] !== undefined).map(k => [k, raw[k]])) };
  return {
    url: ollama.normalizeOllamaUrl(l.url),
    chatModel: String(l.chatModel || '').trim(),
    visionModel: String(l.visionModel || '').trim(),
    embedModel: String(l.embedModel || '').trim() || ollama.DEFAULT_EMBED_MODEL,
    contextTokens: int(l.contextTokens, 8192, 2048, 131072),
    visionContextTokens: int(l.visionContextTokens, 16384, 2048, 131072),
    temperature: Number.isFinite(Number(l.temperature)) && l.temperature !== '' && l.temperature != null
      ? Math.min(2, Math.max(0, Number(l.temperature))) : 0.3
  };
}

const isReady = s => !!(s.chatModel || s.visionModel);

/** What any signed-in person may know: whether the AI is set up. */
export function aiSummary(raw){
  const s = aiSettings(raw);
  return { label: 'Local AI', ready: isReady(s) };
}

/** Applies an admin's edit; fields left out stay as they were. */
export function applyEdit(raw, edit){
  const next = aiSettings(raw);
  for(const k of KEYS) if(edit && edit[k] !== undefined) next[k] = edit[k];
  return aiSettings(next);
}

/* ---------------- errors ---------------- */

export class AiError extends Error {
  constructor(message, { status, unreachable, notConfigured } = {}){
    super(message);
    Object.assign(this, { status, unreachable, notConfigured });
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- asking ---------------- */

/**
 * One answer: `{ text }`. A model error can be a one-off (the model was
 * still loading), so a 500 is tried once more; anything else is shown as
 * it is -- "too large" is answered by the scan pipeline splitting pages.
 */
export async function callAI(raw, system, content){
  const s = aiSettings(raw);
  if(!isReady(s)) throw new AiError('The AI isn\'t set up yet. An admin can set it up in one click under Settings → AI.', { notConfigured: true });
  for(let attempt = 1; ; attempt++){
    try {
      return { text: (await ollama.chat(s, system, content)).text };
    } catch (e) {
      if(!(e instanceof ollama.OllamaError)) throw e;
      if(e.status === 500 && attempt < 2){ await sleep(1500); continue; }
      throw new AiError(e.message, { status: e.status || null, unreachable: e.unreachable });
    }
  }
}

const EMBEDDING = /embed|bge|minilm|nomic|snowflake-arctic/i;
const VISION = /minicpm-v|llava|vision|qwen2\.5vl|qwen2-vl|[-_.]vl\b|gemma3|moondream|mistral-small3/i;

/** The models Ollama has installed, and which can read images or only
 *  embed text. */
export async function listModels(raw){
  try {
    return (await ollama.listModels(aiSettings(raw).url)).map(m => {
      const families = [m.details?.family, ...(m.details?.families || [])].filter(Boolean).join(' ');
      const embedding = EMBEDDING.test(m.name) || /bert/i.test(families);
      return {
        id: m.name, name: m.name, sizeGb: Math.round((m.size || 0) / 1e8) / 10,
        family: m.details?.family || '', params: m.details?.parameter_size || '',
        embedding, vision: !embedding && (VISION.test(m.name) || /clip|mllama/i.test(families))
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    throw new AiError(e.message, { unreachable: e.unreachable });
  }
}
