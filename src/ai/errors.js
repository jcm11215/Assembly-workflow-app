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
  // "High demand" is about that model at that moment, not about the
  // setup, so it must not read like something the person broke.
  if(/overloaded|high demand|currently experiencing|503/i.test(msg)){
    return `The AI model is too busy to answer right now -- that is ${providerName}'s load, not your key or your drawing. ` +
           `It already retried and tried other models. Give it a few minutes, or pick a different model in Settings.`;
  }
  if(/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(msg)){
    // The app already waited and retried several times before this
    // surfaced, so "try again" on its own would be poor advice. A free
    // tier caps requests per minute, and one scan spends three or four.
    const limit = /limit:\s*(\d+)/i.exec(msg);
    return `${providerName}'s free tier is out of requests for the moment${limit ? ` (cap: ${limit[1]} per minute)` : ''}. ` +
           `It already waited and retried. Give it a minute, scan fewer pages at once, or switch providers in Settings.`;
  }
  return msg || 'Please try again.';
}
