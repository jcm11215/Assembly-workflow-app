// Picks the theme before the page draws, so it never flashes the wrong
// one: dark unless this device chose light, or to match the device.
// web/lib/theme.js changes it later (Settings).
(function(){
  var pref = 'dark';
  try { pref = localStorage.getItem('awt.theme') || 'dark'; } catch (e) { /* private mode */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var meta = document.querySelector('meta[name=theme-color]');
  if(meta) meta.setAttribute('content', dark ? '#181818' : '#ffffff');
})();
