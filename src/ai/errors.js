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
  // A rejected key, said plainly. Google's own wording for this is
  // "Request had invalid authentication credentials. Expected OAuth 2
  // access token, login cookie or other valid authentication credential"
  // followed by a link to the developer console -- which reads like the
  // app is broken rather than like a key needs replacing, and sends
  // people looking for a fault in their drawing instead of in Settings.
  if(/invalid authentication|API key not valid|API_KEY_INVALID|unauthorized|401|403|permission denied/i.test(msg)){
    return `${providerName} rejected the API key. Open Settings (the gear icon, top right) and paste a current key, or switch providers.`;
  }
  if(/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(msg)){
    return `${providerName} is rate-limiting this key. Wait a few minutes, or switch providers in Settings.`;
  }
  return msg || 'Please try again.';
}
