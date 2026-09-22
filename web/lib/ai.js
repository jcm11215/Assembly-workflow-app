/**
 * Asking the AI. The server holds the keys and picks the provider; the app
 * sends a system prompt and content blocks and gets text back.
 *
 * `substitution` is set when a different model or provider answered than
 * the one configured (a busy Gemini model, or the local AI being off), so
 * the caller can say so instead of changing things silently.
 */
import { api } from './api.js';

export async function askAI(system, content){
  const res = await api.post('/api/ai/chat', { system, content });
  return { text: res.text || '', substitution: res.substitution || null };
}

/** A failure explained for the person who hit it. */
export function explainAiError(err){
  const msg = String((err && err.message) || err || '');
  if(err && err.code === 'ai_not_configured') return `${msg}`;
  if(err && err.status === 0) return "Couldn't reach the shop server. Check this device is on the network, then try again.";
  if(/quota|rate.?limit|RESOURCE_EXHAUSTED|429|too many requests/i.test(msg)){
    return `The AI provider is rate-limiting requests right now. Wait a minute and try again. (${msg})`;
  }
  if(/api key not valid|invalid api key|unauthor|401|403/i.test(msg)){
    return `The AI provider rejected the key. An admin can check it in Settings. (${msg})`;
  }
  return msg || 'The AI request failed.';
}
