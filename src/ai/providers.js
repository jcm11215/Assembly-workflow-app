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

export async function callGeminiAPI(systemPrompt, content){
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
    throw new Error(apiMsg);
  }
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return parts ? parts.map(p=>p.text||'').filter(Boolean).join('\n') : '';
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

export async function callOpenRouterAPI(systemPrompt, content){
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
