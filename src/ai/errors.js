/** Provider-aware error explanation. */


import { getAiProvider } from './keys.js';

export function explainFetchError(err){
  const msg = (err && err.message) || '';
  const providerName = getAiProvider()==='openrouter' ? 'OpenRouter' : 'Google Gemini';
  if(msg === 'NO_API_KEY'){
    return `Add your ${providerName} API key in Settings (the gear icon, top right) to use AI features.`;
  }
  if(/Failed to fetch|NetworkError|Load failed/i.test(msg)){
    return `Couldn't reach ${providerName}. Check your API key in Settings and your internet connection, then try again.`;
  }
  return msg || 'Please try again.';
}
