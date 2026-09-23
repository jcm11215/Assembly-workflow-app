/**
 * Asking the AI. The server runs it (Ollama, on the shop's hardware); the
 * app sends a system prompt and content blocks and gets text back.
 */
import { api } from './api.js';

/**
 * With `knowledge` (the question as asked), the server adds the knowledge
 * base passages and staff corrections that match it, and `sources` says
 * which ones.
 */
export async function askAI(system, content, { knowledge } = {}){
  const res = await api.post('/api/ai/chat', { system, content, ...(knowledge ? { knowledge } : {}) });
  return { text: res.text || '', sources: res.sources || null, knowledgeNote: res.knowledgeNote || null };
}

/** A failure explained for the person who hit it. */
export function explainAiError(err){
  const msg = String((err && err.message) || err || '');
  if(err && err.code === 'ai_not_configured') return `${msg}`;
  if(err && err.status === 0) return "Couldn't reach the shop server. Check this device is on the network, then try again.";
  if(err && err.data && err.data.unreachable){
    return `The local AI isn't answering. Check that Ollama is running on the server. (${msg})`;
  }
  return msg || 'The AI request failed.';
}
